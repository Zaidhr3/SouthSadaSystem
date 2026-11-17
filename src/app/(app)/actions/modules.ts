"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { actionUser, assertTenderAccess } from "@/lib/auth";
import { run, runVoid, type ActionState } from "@/lib/action";
import { AppError, can } from "@/lib/permissions";
import { removeLinkedBankTx, upsertLinkedBankTx } from "@/lib/finance";
import { deleteAttachmentsFor, saveAttachments } from "@/lib/uploads";
import { DIRECTION, EQUIPMENT_STATUS, OWNERSHIP, SUBCONTRACT_STATUS } from "@/lib/labels";
import { fmtJOD, round3, todayUTC } from "@/lib/format";
import { getSettings, SETTING_DEFAULTS, type SettingKey } from "@/lib/settings";
import { computeSubCertificate } from "@/lib/deductions";
import { notify } from "@/lib/notify";
import { ADMIN_ALERT_EMAIL, emailLayout, mailConfigured, sendMail, smtpInfo, verifyMail } from "@/lib/mailer";
import { computeNotifications } from "@/lib/notifications";
import { runAlertJob } from "@/lib/alert-job";
import { formObject, zDate, zEnum, zMoney, zOptDate, zOptId, zOptMoney, zOptText, zPositiveMoney, zText } from "@/lib/validation";
import { alertScheduleLabel } from "@/lib/alert-schedule";

const refresh = () => revalidatePath("/", "layout");
const zInt = (label: string) => z.preprocess((v) => (v === "" || v == null ? 0 : Number(v)), z.number({ invalid_type_error: `${label} غير صالح` }).int(`${label} عدد صحيح`));
const zSignedMoney = (label: string) =>
  z.preprocess((v) => (v === "" || v == null ? undefined : Number(String(v).replace(/,/g, ""))), z.number({ required_error: `${label} مطلوب`, invalid_type_error: `${label} غير صالح` }).transform(round3));

/* ═══════════════ أوامر التغيير ═══════════════ */

const voSchema = z.object({
  title: zText("عنوان أمر التغيير"),
  description: zOptText,
  amount: zSignedMoney("القيمة"),
  extraDays: zInt("المدة الإضافية"),
  clientRef: zOptText,
  requestDate: zDate("تاريخ الطلب"),
});

/** تسجيل أمر تغيير (المدير العام أو مدير المشروع المسند) — يبقى معلقاً حتى يعتمده المدير العام */
export async function createVariation(tenderId: number, _: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await actionUser(can.fieldOps);
    await assertTenderAccess(user, tenderId);
    const data = voSchema.parse(formObject(fd));
    const count = await db.variationOrder.count({ where: { tenderId } });
    const vo = await db.variationOrder.create({ data: { ...data, tenderId, number: count + 1, createdById: user.id } });
    await saveAttachments(fd, "variation", vo.id, user.id);
    refresh();
    return "تم تسجيل أمر التغيير";
  });
}

/** الاعتماد يعدّل قيمة العقد ومدته تلقائياً، والإلغاء يعكس الأثر */
export async function decideVariation(id: number, decision: "APPROVED" | "REJECTED" | "PENDING") {
  const result = await runVoid(async () => {
    const user = await actionUser(can.approveVariations);
    const vo = await db.variationOrder.findUnique({ where: { id }, include: { tender: true } });
    if (!vo) throw new AppError("أمر التغيير غير موجود");
    if (vo.status === decision) return;
    const wasApproved = vo.status === "APPROVED";
    const nowApproved = decision === "APPROVED";
    await db.$transaction(async (tx) => {
      await tx.variationOrder.update({ where: { id }, data: { status: decision, decisionDate: decision === "PENDING" ? null : todayUTC() } });
      if (wasApproved !== nowApproved) {
        const sign = nowApproved ? 1 : -1;
        await tx.tender.update({
          where: { id: vo.tenderId },
          data: { variationTotal: { increment: round3(sign * vo.amount) }, variationDays: { increment: sign * vo.extraDays } },
        });
      }
    });
    if (decision !== "PENDING") {
      await notify([{ managerOf: vo.tenderId }, "ACCOUNTANT"], {
        title: decision === "APPROVED" ? `اعتُمد أمر التغيير رقم ${vo.number}` : `رُفض أمر التغيير رقم ${vo.number}`,
        body: `${vo.tender.name} — ${vo.title} — ${fmtJOD(vo.amount)}${vo.extraDays ? ` و${vo.extraDays} يوماً` : ""}`,
        href: `/tenders/${vo.tenderId}?tab=variations`,
      }, { exclude: user.id });
    }
  });
  refresh();
  return result;
}

export async function deleteVariation(id: number) {
  const result = await runVoid(async () => {
    await actionUser(can.approveVariations);
    const vo = await db.variationOrder.findUnique({ where: { id } });
    if (!vo) throw new AppError("أمر التغيير غير موجود");
    await db.$transaction(async (tx) => {
      if (vo.status === "APPROVED") {
        await tx.tender.update({ where: { id: vo.tenderId }, data: { variationTotal: { decrement: vo.amount }, variationDays: { decrement: vo.extraDays } } });
      }
      await tx.variationOrder.delete({ where: { id } });
    });
    await deleteAttachmentsFor("variation", id);
  });
  refresh();
  return result;
}

/* ═══════════════ مقاولو الباطن ═══════════════ */

const subSchema = z.object({ name: zText("الاسم"), trade: zText("الاختصاص"), phone: zOptText, notes: zOptText });

export async function saveSubcontractor(id: number | null, _: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    await actionUser(can.manageSubcontracts);
    const data = subSchema.parse(formObject(fd));
    if (id) await db.subcontractor.update({ where: { id }, data });
    else await db.subcontractor.create({ data });
    refresh();
    return id ? "تم تحديث بيانات المقاول" : "تمت إضافة مقاول الباطن";
  });
}

const agreementSchema = z.object({
  tenderId: z.preprocess(Number, z.number({ invalid_type_error: "اختر المشروع" }).int().positive("اختر المشروع")),
  subcontractorId: z.preprocess(Number, z.number({ invalid_type_error: "اختر المقاول" }).int().positive("اختر المقاول")),
  scope: zText("نطاق الأعمال"),
  value: zPositiveMoney("قيمة الاتفاقية"),
  advance: zMoney("الدفعة المقدمة"),
  retentionPct: z.preprocess((v) => (v === "" || v == null ? undefined : Number(v)), z.number().min(0).max(30, "النسبة بين 0 و 30").optional()),
  startDate: zDate("تاريخ البدء"),
  endDate: zOptDate,
  notes: zOptText,
});

export async function createSubcontract(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await actionUser(can.manageSubcontracts);
    const data = agreementSchema.parse(formObject(fd));
    if (data.advance > data.value) throw new AppError("الدفعة المقدمة أكبر من قيمة الاتفاقية");
    const settings = await getSettings();
    const sc = await db.subcontract.create({ data: { ...data, retentionPct: data.retentionPct ?? settings.subRetentionPct } });
    await saveAttachments(fd, "subcontract", sc.id, user.id);
    const sub = await db.subcontractor.findUnique({ where: { id: data.subcontractorId } });
    await notify([{ managerOf: data.tenderId }, "ACCOUNTANT"], { title: "اتفاقية مقاولة باطن جديدة", body: `${sub?.name} — ${data.scope} — ${fmtJOD(data.value)}`, href: `/tenders/${data.tenderId}?tab=subcontracts` }, { exclude: user.id });
    refresh();
    return "تم تسجيل الاتفاقية";
  });
}

export async function setSubcontractStatus(id: number, status: string) {
  const result = await runVoid(async () => {
    await actionUser(can.manageSubcontracts);
    if (!(status in SUBCONTRACT_STATUS)) throw new AppError("حالة غير صالحة");
    await db.subcontract.update({ where: { id }, data: { status } });
  });
  refresh();
  return result;
}

function certTotals(certs: { kind: string; status: string; workValue: number; advanceRecovery: number; retention: number; net: number }[]) {
  const valid = certs.filter((c) => c.status !== "REJECTED");
  const progress = valid.filter((c) => c.kind === "PROGRESS");
  return {
    workDone: round3(progress.reduce((s, c) => s + c.workValue, 0)),
    advanceRecovered: round3(progress.reduce((s, c) => s + c.advanceRecovery, 0)),
    retentionHeld: round3(progress.reduce((s, c) => s + c.retention, 0)),
    retentionReleased: round3(valid.filter((c) => c.kind === "RETENTION_RELEASE").reduce((s, c) => s + c.net, 0)),
    advancePaid: round3(valid.filter((c) => c.kind === "ADVANCE").reduce((s, c) => s + c.net, 0)),
  };
}

const certSchema = z.object({ date: zDate("التاريخ"), workValue: zPositiveMoney("قيمة الأعمال المنجزة"), otherDeductions: zOptMoney, notes: zOptText });

/** مستخلص باطن: يمنع تجاوز قيمة الاتفاقية ويحسب استرداد الدفعة المقدمة والمحجوزات تلقائياً */
export async function createCertificate(subcontractId: number, _: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await actionUser();
    const sc = await db.subcontract.findUnique({ where: { id: subcontractId }, include: { certificates: true, subcontractor: true, tender: true } });
    if (!sc) throw new AppError("الاتفاقية غير موجودة");
    if (user.role === "ACCOUNTANT") throw new AppError("تُرفع المستخلصات من مدير المشروع أو المدير العام");
    await assertTenderAccess(user, sc.tenderId);
    if (sc.status !== "ACTIVE") throw new AppError("الاتفاقية غير سارية");
    const data = certSchema.parse(formObject(fd));
    const t = certTotals(sc.certificates);
    if (t.workDone + data.workValue > sc.value + 0.001) {
      throw new AppError(`تجاوز قيمة الاتفاقية: المنجز سابقاً ${fmtJOD(t.workDone)} والمتبقي ${fmtJOD(sc.value - t.workDone)} فقط`);
    }
    const calc = computeSubCertificate({
      workValue: data.workValue,
      contractValue: sc.value,
      advance: sc.advance,
      advanceRecovered: t.advanceRecovered,
      retentionPct: sc.retentionPct,
      otherDeductions: data.otherDeductions ?? 0,
    });
    if (calc.net < 0) throw new AppError("الخصومات أكبر من قيمة الأعمال");
    const number = sc.certificates.filter((c) => c.kind === "PROGRESS").length + 1;
    const cert = await db.subcontractCertificate.create({
      data: { subcontractId, kind: "PROGRESS", number, date: data.date, workValue: data.workValue, otherDeductions: data.otherDeductions ?? 0, notes: data.notes, ...calc, status: user.role === "ADMIN" ? "APPROVED" : "SUBMITTED", createdById: user.id },
    });
    await saveAttachments(fd, "certificate", cert.id, user.id);
    refresh();
    return `تم تسجيل المستخلص رقم ${number} — الصافي ${fmtJOD(calc.net)}`;
  });
}

/** صرف الدفعة المقدمة أو الإفراج عن المحجوزات: يُنشئ مستخلصاً معتمداً جاهزاً للدفع */
export async function createSpecialCertificate(subcontractId: number, kind: "ADVANCE" | "RETENTION_RELEASE") {
  const result = await runVoid(async () => {
    const user = await actionUser(can.manageSubcontracts);
    const sc = await db.subcontract.findUnique({ where: { id: subcontractId }, include: { certificates: true, subcontractor: true, tender: true } });
    if (!sc) throw new AppError("الاتفاقية غير موجودة");
    const t = certTotals(sc.certificates);
    const amount = kind === "ADVANCE" ? round3(sc.advance - t.advancePaid) : round3(t.retentionHeld - t.retentionReleased);
    if (amount <= 0) throw new AppError(kind === "ADVANCE" ? "لا توجد دفعة مقدمة متبقية" : "لا توجد محجوزات للإفراج عنها");
    const number = sc.certificates.filter((c) => c.kind === kind).length + 1;
    await db.$transaction(async (tx) => {
      await tx.subcontractCertificate.create({
        data: { subcontractId, kind, number, date: todayUTC(), workValue: 0, net: amount, status: "APPROVED", createdById: user.id, notes: kind === "ADVANCE" ? "صرف الدفعة المقدمة" : "الإفراج عن محجوزات الباطن" },
      });
      if (kind === "RETENTION_RELEASE") await tx.subcontract.update({ where: { id: subcontractId }, data: { retentionReleasedDate: todayUTC() } });
    });
  });
  refresh();
  return result;
}

export async function decideCertificate(id: number, decision: "APPROVED" | "REJECTED") {
  const result = await runVoid(async () => {
    await actionUser(can.manageSubcontracts);
    const c = await db.subcontractCertificate.findUnique({ where: { id }, include: { subcontract: { include: { subcontractor: true } } } });
    if (!c) throw new AppError("المستخلص غير موجود");
    if (c.status === "PAID") throw new AppError("المستخلص مدفوع");
    await db.subcontractCertificate.update({ where: { id }, data: { status: decision } });
  });
  refresh();
  return result;
}

/** دفع المستخلص (المحاسب): مصروف «مقاولو باطن» على المشروع + خصم من البنك */
export async function payCertificate(id: number) {
  const result = await runVoid(async () => {
    const user = await actionUser(can.manageFinance);
    const c = await db.subcontractCertificate.findUnique({ where: { id }, include: { subcontract: { include: { subcontractor: true, tender: true } } } });
    if (!c) throw new AppError("المستخلص غير موجود");
    if (c.status !== "APPROVED") throw new AppError("يجب اعتماد المستخلص من المدير العام قبل الدفع");
    const kindLabel = c.kind === "ADVANCE" ? "دفعة مقدمة" : c.kind === "RETENTION_RELEASE" ? "إفراج محجوزات" : `مستخلص رقم ${c.number}`;
    const desc = `${kindLabel} — ${c.subcontract.subcontractor.name} — ${c.subcontract.scope}`;
    const today = todayUTC();
    await db.$transaction(async (tx) => {
      await tx.subcontractCertificate.update({ where: { id }, data: { status: "PAID", paidDate: today } });
      const exp = await tx.expense.create({
        data: { tenderId: c.subcontract.tenderId, category: "SUBCONTRACT", amount: c.net, date: today, description: desc, vendor: c.subcontract.subcontractor.name, paymentMethod: "COMPANY", autoSource: `subcert:${id}`, createdById: user.id },
      });
      await upsertLinkedBankTx(tx, "EXPENSE", exp.id, { date: today, type: "OUT", amount: c.net, description: desc, tenderId: c.subcontract.tenderId });
    });
    await notify([{ managerOf: c.subcontract.tenderId }], { title: "تم دفع مستخلص باطن", body: `${desc} — ${fmtJOD(c.net)}`, href: `/subcontractors?tender=${c.subcontract.tenderId}` }, { exclude: user.id });
  });
  refresh();
  return result;
}

/* ═══════════════ المواد الموقعية ═══════════════ */

const materialSchema = z.object({
  boqItemId: zOptId,
  material: zText("المادة"),
  unit: zText("الوحدة"),
  quantity: zPositiveMoney("الكمية"),
  unitCost: zOptMoney,
  supplier: zOptText,
  deliveryNote: zOptText,
  date: zDate("تاريخ التوريد"),
  notes: zOptText,
});

export async function createMaterialReceipt(tenderId: number, _: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await actionUser(can.fieldOps);
    await assertTenderAccess(user, tenderId);
    const data = materialSchema.parse(formObject(fd));
    if (data.boqItemId) {
      const item = await db.boqItem.findFirst({ where: { id: data.boqItemId, tenderId } });
      if (!item) throw new AppError("البند لا يتبع هذا المشروع");
    }
    const r = await db.materialReceipt.create({ data: { ...data, tenderId, receivedById: user.id } });
    const n = await saveAttachments(fd, "material", r.id, user.id);
    refresh();
    return n ? `تم تسجيل التوريد مع ${n} صورة إثبات` : "تم تسجيل التوريد";
  });
}

export async function deleteMaterialReceipt(id: number) {
  const result = await runVoid(async () => {
    const user = await actionUser(can.fieldOps);
    const r = await db.materialReceipt.findUnique({ where: { id } });
    if (!r) throw new AppError("السجل غير موجود");
    if (user.role !== "ADMIN" && r.receivedById !== user.id) throw new AppError("يمكنك حذف سجلاتك فقط");
    await db.materialReceipt.delete({ where: { id } });
    await deleteAttachmentsFor("material", id);
  });
  refresh();
  return result;
}

/* ═══════════════ الآليات والمعدات ═══════════════ */

const equipSchema = z.object({
  name: zText("اسم المعدة"),
  type: zText("النوع"),
  ownership: zEnum(OWNERSHIP, "الملكية"),
  identifier: zOptText,
  dailyRate: zMoney("الكلفة اليومية"),
  vendor: zOptText,
  status: zEnum(Object.fromEntries(Object.keys(EQUIPMENT_STATUS).map((k) => [k, k])), "الحالة"),
  notes: zOptText,
});

export async function saveEquipment(id: number | null, _: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    await actionUser(can.manageFleet);
    const data = equipSchema.parse({ status: "AVAILABLE", ...formObject(fd) });
    if (id) await db.equipment.update({ where: { id }, data });
    else await db.equipment.create({ data });
    refresh();
    return id ? "تم تحديث المعدة" : "تمت إضافة المعدة";
  });
}

const logSchema = z.object({
  equipmentId: z.preprocess(Number, z.number({ invalid_type_error: "اختر المعدة" }).int().positive("اختر المعدة")),
  startDate: zDate("تاريخ البدء"),
  days: zPositiveMoney("عدد الأيام"),
  dailyRate: zOptMoney,
  operator: zOptText,
  notes: zOptText,
});

/** تشغيل معدة على مشروع: تُحمّل الكلفة على المشروع (داخلياً لمعدات الشركة، ومن البنك للمستأجرة) */
export async function logEquipment(tenderId: number, _: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await actionUser(can.fieldOps);
    await assertTenderAccess(user, tenderId);
    const data = logSchema.parse(formObject(fd));
    const eq = await db.equipment.findUnique({ where: { id: data.equipmentId } });
    if (!eq) throw new AppError("المعدة غير موجودة");
    if (eq.status === "RETIRED") throw new AppError("المعدة خارج الخدمة");
    const rate = data.dailyRate ?? eq.dailyRate;
    const cost = round3(rate * data.days);
    await db.$transaction(async (tx) => {
      const log = await tx.equipmentLog.create({ data: { ...data, dailyRate: rate, cost, tenderId, loggedById: user.id } });
      if (cost > 0) {
        const desc = `تشغيل ${eq.name} — ${data.days} يوم × ${rate} د.أ`;
        const exp = await tx.expense.create({
          data: { tenderId, category: "EQUIPMENT", amount: cost, date: data.startDate, description: desc, vendor: eq.vendor, paymentMethod: eq.ownership === "OWNED" ? "INTERNAL" : "COMPANY", autoSource: `equip:${log.id}`, createdById: user.id },
        });
        if (eq.ownership === "RENTED") {
          await upsertLinkedBankTx(tx, "EXPENSE", exp.id, { date: data.startDate, type: "OUT", amount: cost, description: desc, tenderId });
        }
      }
      if (eq.status === "AVAILABLE") await tx.equipment.update({ where: { id: eq.id }, data: { status: "ASSIGNED" } });
    });
    refresh();
    return `تم التسجيل وتحميل ${fmtJOD(cost)} على المشروع`;
  });
}

export async function deleteEquipmentLog(id: number) {
  const result = await runVoid(async () => {
    const user = await actionUser(can.fieldOps);
    const log = await db.equipmentLog.findUnique({ where: { id } });
    if (!log) throw new AppError("السجل غير موجود");
    if (user.role !== "ADMIN" && log.loggedById !== user.id) throw new AppError("يمكنك حذف سجلاتك فقط");
    await db.$transaction(async (tx) => {
      const exp = await tx.expense.findFirst({ where: { autoSource: `equip:${id}` } });
      if (exp) {
        await removeLinkedBankTx(tx, "EXPENSE", exp.id);
        await tx.expense.delete({ where: { id: exp.id } });
      }
      await tx.equipmentLog.delete({ where: { id } });
    });
  });
  refresh();
  return result;
}

/* ═══════════════ الصادر والوارد ═══════════════ */

const corrSchema = z.object({
  direction: zEnum(DIRECTION, "النوع"),
  date: zDate("التاريخ"),
  party: zText("الجهة"),
  subject: zText("الموضوع"),
  theirRef: zOptText,
  tenderId: zOptId,
  notes: zOptText,
});

/** ترقيم تلقائي: ص/2026/0001 للصادر و و/2026/0001 للوارد */
export async function createCorrespondence(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await actionUser();
    const data = corrSchema.parse(formObject(fd));
    if (user.role === "PM") {
      if (!data.tenderId) throw new AppError("اختر المشروع");
      await assertTenderAccess(user, data.tenderId);
    }
    const year = data.date.getUTCFullYear();
    const rec = await db.$transaction(async (tx) => {
      const last = await tx.correspondence.aggregate({ where: { direction: data.direction, year }, _max: { seq: true } });
      const seq = (last._max.seq ?? 0) + 1;
      const refNo = `${DIRECTION[data.direction].prefix}/${year}/${String(seq).padStart(4, "0")}`;
      return tx.correspondence.create({ data: { ...data, year, seq, refNo, createdById: user.id } });
    });
    await saveAttachments(fd, "correspondence", rec.id, user.id);
    if (data.direction === "IN" && data.tenderId) {
      await notify([{ managerOf: data.tenderId }, "ADMIN"], { title: `كتاب وارد ${rec.refNo}`, body: `${rec.party}: ${rec.subject}`, href: "/correspondence" }, { exclude: user.id });
    }
    refresh();
    return `تم التسجيل برقم ${rec.refNo}`;
  });
}

export async function deleteCorrespondence(id: number) {
  const result = await runVoid(async () => {
    await actionUser(can.manageTenders);
    await db.correspondence.delete({ where: { id } });
    await deleteAttachmentsFor("correspondence", id);
  });
  refresh();
  return result;
}

/* ═══════════════ إعدادات النظام ═══════════════ */

export async function saveSettings(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    await actionUser(can.manageSettings);
    const entries = Object.keys(SETTING_DEFAULTS) as SettingKey[];
    const current = await getSettings();
    for (const key of entries) {
      const raw = fd.get(key);
      if (raw == null || raw === "") continue;
      const n = Number(raw);
      const max = key === "gmApprovalThreshold" ? 10_000_000 : 100;
      if (!Number.isFinite(n) || n < 0 || n > max) throw new AppError(key === "gmApprovalThreshold" ? "حد الموافقة غير صالح" : "النسب يجب أن تكون بين 0 و 100");
      if (current[key] === n) continue; // يُحفظ (ويُسجل في الرقابة) ما تغيّر فقط
      await db.setting.upsert({ where: { key }, create: { key, value: String(n) }, update: { value: String(n) } });
    }
    refresh();
    return "تم حفظ الإعدادات";
  });
}

export async function sendTestEmail(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await actionUser(can.manageSettings);
    const raw = String(fd.get("to") ?? "").trim();
    const to = z.string().email("بريد إلكتروني غير صالح").parse(raw || ADMIN_ALERT_EMAIL);
    if (!mailConfigured()) throw new AppError("أكمل إعدادات SMTP (SMTP_HOST, SMTP_USER, SMTP_PASS) في ملف .env ثم أعد تشغيل الخادم");
    const info = smtpInfo();

    // 1) فحص الاتصال والمصادقة
    const t0 = Date.now();
    try {
      await verifyMail();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const hint = /auth|535|534|credentials|Username and Password/i.test(msg)
        ? " — تحقق من SMTP_USER و SMTP_PASS (لـ Gmail استخدم كلمة مرور التطبيق وليس كلمة مرور الحساب)"
        : /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|getaddrinfo/i.test(msg)
          ? ` — تعذر الوصول إلى ${info.host}:${info.port} (تحقق من الخادم والمنفذ والإنترنت)`
          : "";
      throw new AppError(`فشل فحص SMTP: ${msg}${hint}`);
    }
    const verifyMs = Date.now() - t0;

    // 2) ملخص التنبيهات الحالية التي ستصل للمدير العام
    const admin = await db.user.findUnique({ where: { id: user.id } });
    const notes = await computeNotifications(user);
    const byKind = notes.reduce<Record<string, number>>((m, n) => ((m[n.kind] = (m[n.kind] ?? 0) + 1), m), {});
    const kindLabels: Record<string, string> = {
      cheque: "الشيكات", guarantee: "الكفالات", retention: "المحجوزات", deadline: "مواعيد التقديم", site_visit: "زيارات المواقع",
      fund: "طلبات التمويل", variation: "أوامر التغيير", certificate: "مستخلصات الباطن", document: "وثائق الشركة",
      liquidity: "السيولة", collection: "المطالبات غير المقبوضة", event: "إشعارات الأحداث", debt: "أقساط الديون",
    };
    const recipients = await db.user.count({ where: { active: true, notifyEmail: true, OR: [{ email: { not: null } }, { role: "ADMIN" }] } });
    const schedule = alertScheduleLabel();

    // 3) إرسال رسالة التشخيص
    const t1 = Date.now();
    const status = await sendMail({
      key: `test:${user.id}:${Date.now()}`,
      to,
      subject: "✅ صدى الجنوب: تشخيص البريد — الاتصال يعمل",
      html: emailLayout(
        "تشخيص نظام البريد",
        [
          { title: "✓ الاتصال والمصادقة ناجحان", body: `الخادم ${info.host} — المنفذ ${info.port} (${info.security}) — المستخدم ${info.user} — زمن الفحص ${verifyMs} ملّي ثانية`, tone: "info" },
          { title: "المرسل", body: info.from, tone: "info" },
          { title: "بريد المدير العام للتنبيهات", body: `${admin?.email || ADMIN_ALERT_EMAIL}${admin?.notifyEmail === false ? " — ⚠️ التنبيهات البريدية موقوفة لهذا الحساب" : ""}`, tone: admin?.notifyEmail === false ? "warning" : "info" },
          { title: "الفحص التلقائي", body: schedule ? `${schedule} — ${recipients} مستلمين` : "معطّل (ALERT_INTERVAL_MINUTES=0)", tone: schedule ? "info" : "warning" },
          {
            title: `التنبيهات النشطة الآن: ${notes.length}`,
            body: notes.length ? Object.entries(byKind).map(([k, n]) => `${kindLabels[k] ?? k}: ${n}`).join(" • ") : "لا توجد تنبيهات حالياً",
            href: "/notifications",
            tone: notes.some((n) => n.severity === "critical") ? "critical" : "info",
          },
          {
            title: "ما يُرسل تلقائياً إلى هذا البريد",
            body: "الشيكات (قبل 3 أيام، اليوم، المتأخرة) • تحذيرات السيولة والمطالبات غير المقبوضة • انتهاء كفالات الدخول وحسن التنفيذ والصيانة واسترداد المحجوزات • مواعيد التقديم وزيارات المواقع • طلبات التمويل وأوامر التغيير ومستخلصات الباطن المعلقة • انتهاء التصنيف والسجل التجاري وتراخيص المركبات",
            tone: "info",
          },
        ],
        `مرحباً ${user.name}، هذه رسالة تشخيص من نظام صدى الجنوب. وصولها يعني أن إعدادات SMTP تعمل بلا أخطاء.`,
      ),
      text: `تشخيص البريد: الاتصال ناجح — ${info.host}:${info.port} — ${notes.length} تنبيهات نشطة`,
    });
    if (status !== "sent") throw new AppError("نجح فحص الاتصال لكن فشل الإرسال — راجع «آخر الرسائل المرسلة» أدناه لمعرفة السبب");
    return `✓ SMTP يعمل (${verifyMs}ms) — أُرسلت رسالة التشخيص إلى ${to} خلال ${Date.now() - t1}ms`;
  });
}

/** نسخة احتياطية فورية إلى التخزين السحابي (بالإضافة للنسخة اليومية التلقائية) */
export async function backupNow(_: ActionState, __: FormData): Promise<ActionState> {
  return run(async () => {
    await actionUser(can.manageSettings);
    const { runCloudBackup } = await import("@/lib/cloud-backup");
    const r = await runCloudBackup();
    if (!r.configured) throw new AppError("النسخ السحابي غير مُعد — يلزم SUPABASE_SERVICE_ROLE_KEY على الخادم");
    return `تم حفظ النسخة ${r.file} (${r.rows} سجلاً، ${r.sizeKb} كيلوبايت) — ملفات جديدة: ${r.filesCopied}${r.filesPending ? ` (والباقي ${r.filesPending} في التشغيلة القادمة)` : ""}`;
  });
}

export async function runAlertsNow(_: ActionState, __: FormData): Promise<ActionState> {
  return run(async () => {
    await actionUser(can.manageSettings);
    const r = await runAlertJob();
    if (!r.configured) throw new AppError("البريد غير مُعد — أكمل إعدادات SMTP في ملف .env");
    return `تم الفحص: ${r.alerts} تنبيهات جديدة — أُرسلت ${r.sent} رسائل`;
  });
}

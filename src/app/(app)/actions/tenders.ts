"use server";

import { provisionClient } from "@/lib/portal";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { actionUser, assertTenderAccess } from "@/lib/auth";
import { auditEvent, run, runVoid, type ActionState } from "@/lib/action";
import { AppError, can } from "@/lib/permissions";
import { createCompanyExpense, removeLinkedBankTx } from "@/lib/finance";
import { deleteAttachmentsFor, saveAttachments, validateAttachments } from "@/lib/uploads";
import { assertDepositSlip, saveDepositSlip } from "@/lib/deposit";
import { normalizeText } from "@/lib/text";
import { formObject, zDate, zMoney, zOptDate, zOptId, zOptMoney, zOptText, zText } from "@/lib/validation";
import { fmtDate, fmtJOD, round3, todayUTC } from "@/lib/format";
import { isAwardedStage, isStageSlot, STAGE_OPTIONS, STAGE_SLOTS, STAGE_VALUES, stageToFields, type StageSlot, type StageValue } from "@/lib/project-phase";
import type { Prisma } from "@prisma/client";
import { notify } from "@/lib/notify";
import { archiveCheck, assertNotLocked, syncArchive } from "@/lib/archive";

const tenderSchema = z.object({
  name: zText("اسم العطاء"),
  number: zText("رقم العطاء"),
  entity: zText("الجهة المالكة"),
  location: zOptText,
  classification: zOptText,
  purchaseDate: zDate("تاريخ شراء الوثائق"),
  docFee: zMoney("ثمن الوثائق"),
  deadline: zDate("آخر موعد للتقديم"),
  siteVisitDate: zOptDate,
  siteVisitNotes: zOptText,
  managerId: zOptId,
  notes: zOptText,
  kind: z.enum(["GOV", "PRIVATE"]).catch("GOV"),
});

const zOptInt = (label: string, min: number, max: number) =>
  z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number({ invalid_type_error: `${label} غير صالح` }).int(`${label} عدد صحيح`).min(min, `${label} غير صالح`).max(max, `${label} غير صالح`).nullable());
const zCheckbox = z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean());

/** بيانات المراحل الاختيارية عند إدخال عطاء/مشروع قديم في أي مرحلة */
const historySchema = z.object({
  stage: z.enum(STAGE_VALUES).catch("PURCHASED"),
  archive: zCheckbox,
  bidAmount: zOptMoney,
  awardedValue: zOptMoney,
  awardLetterNo: zOptText,
  awardLetterDate: zOptDate,
  stampFee: zOptMoney,
  commenceOrderDate: zOptDate,
  durationDays: zOptInt("مدة التنفيذ", 1, 5000),
  progress: zOptInt("نسبة الإنجاز", 0, 100),
  preliminaryHandoverDate: zOptDate,
  maintenanceMonths: z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.union([z.literal(12), z.literal(24)]).nullable()),
  finalHandoverDate: zOptDate,
  maintenanceReleaseDate: zOptDate,
});

/** توحيد رقم العطاء للمقارنة: أرقام عربية/فارسية ← إنجليزية، والفواصل (- \\ . _ مسافة) ← / */
function tenderNoKey(s: string) {
  return s
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .toLowerCase()
    .replace(/[\s\-\\._–—]+/g, "/")
    .replace(/\/+/g, "/")
    .replace(/^\/|\/$/g, "");
}

/** منع تكرار العطاء: نفس الرقم لنفس الجهة مسجل مسبقاً ← رفض مع رابط العطاء الموجود */
async function assertNotDuplicate(number: string, entity: string, exceptId?: number) {
  const key = tenderNoKey(number);
  const ent = normalizeText(entity);
  if (!key) return;
  const all = await db.tender.findMany({ where: exceptId ? { id: { not: exceptId } } : {}, select: { id: true, number: true, entity: true, name: true } });
  const dup = all.find((t) => tenderNoKey(t.number) === key && normalizeText(t.entity) === ent);
  if (dup) throw new AppError(`العطاء رقم «${dup.number}» لدى «${dup.entity}» مسجل مسبقاً (${dup.name}) — لا يمكن تسجيله مرتين.`, { href: `/tenders/${dup.id}`, label: "فتح العطاء المسجل" });
}

/** تسجيل عطاء جديد — أو إدخال عطاء/مشروع قديم مباشرة في مرحلته الفعلية (أرشفة) */
export async function createTender(_: ActionState, fd: FormData): Promise<ActionState> {
  let newId = 0;
  const res = await run(async () => {
    const user = await actionUser(can.manageTenders);
    const raw = formObject(fd);
    const data = tenderSchema.parse(raw);
    const h = historySchema.parse(raw);
    if (data.deadline < data.purchaseDate) throw new AppError("آخر موعد للتقديم يجب أن يكون بعد تاريخ الشراء");
    const awarded = isAwardedStage(h.stage);
    if (awarded && h.awardedValue == null) throw new AppError("أدخل قيمة الإحالة — مطلوبة للمشاريع المحالة على الشركة");
    // قبل إنشاء أي سجل: لا تكرار، والمرفقات صالحة (لا يبقى عطاء فارغ إن فشل المرفق)
    await assertNotDuplicate(data.number, data.entity);
    await validateAttachments(fd, user.id);
    const { status, phase } = stageToFields(h.stage);
    const lateStage = ["P3", "P4", "P5", "CLOSED"].includes(h.stage);
    const tender = await db.$transaction(async (tx) => {
      const t = await tx.tender.create({
        data: {
          ...data,
          supervisorName: String(raw.supervisorName ?? "").trim() || undefined,
          status,
          phase,
          ...(awarded
            ? {
                bidAmount: h.bidAmount ?? h.awardedValue,
                awardedValue: h.awardedValue,
                awardLetterNo: h.awardLetterNo,
                awardLetterDate: h.awardLetterDate,
                stampFee: h.stampFee,
                stampFeeDate: h.stampFee ? h.awardLetterDate : null,
                commenceOrderDate: h.commenceOrderDate,
                durationDays: h.durationDays,
                progress: h.progress ?? (lateStage ? 100 : 0),
                preliminaryHandoverDate: h.preliminaryHandoverDate,
                maintenanceMonths: h.maintenanceMonths,
                finalHandoverDate: h.finalHandoverDate,
                maintenanceReleaseDate: h.maintenanceReleaseDate,
                closedAt: h.stage === "CLOSED" ? (h.maintenanceReleaseDate ?? h.finalHandoverDate ?? new Date()) : null,
              }
            : { bidAmount: h.bidAmount }),
        },
      });
      // العطاءات القديمة (أرشفة): لا تُنشأ أي حركات مالية تلقائية بأثر رجعي
      if (!h.archive && data.docFee > 0) {
        await createCompanyExpense(tx, {
          tenderId: t.id,
          category: "TENDER_DOCS",
          amount: data.docFee,
          date: data.purchaseDate,
          description: `ثمن وثائق العطاء ${t.number}`,
          autoSource: `tender-docs:${t.id}`,
          userId: user.id,
        });
        if (awarded && h.stampFee && h.stampFee > 0) {
          await createCompanyExpense(tx, {
            tenderId: t.id,
            category: "STAMP_FEES",
            amount: h.stampFee,
            date: h.awardLetterDate ?? data.purchaseDate,
            description: `رسوم طوابع العطاء ${t.number}`,
            autoSource: `stamp:${t.id}`,
            userId: user.id,
          });
        }
      }
      return t;
    });
    try {
      await saveAttachments(fd, "tender", tender.id, user.id);
    } catch (e) {
      // فشل حفظ المرفقات بعد الإنشاء ← يُلغى العطاء بالكامل (مع مصاريفه التلقائية) حتى لا يبقى سجل مكرر فارغ
      await rollbackNewTender(tender.id).catch((err) => console.error("[tender rollback]", err));
      throw e instanceof AppError ? e : new AppError("تعذر حفظ المرفقات — لم يُسجَّل العطاء. أعد المحاولة");
    }
    newId = tender.id;
    // مشروع خاص من طلب الموقع: ربط الطلب ونقل دراسته ومرفقاته إلى المشروع
    const quoteId = Number(raw.quoteId) || 0;
    if (quoteId && tender.kind === "PRIVATE") {
      const q = await db.quoteRequest.findUnique({ where: { id: quoteId }, select: { id: true, tenderId: true, status: true } });
      if (q && !q.tenderId) {
        await db.quoteRequest.update({ where: { id: q.id }, data: { tenderId: tender.id, ...(q.status === "ADMIN_REVIEW" ? { status: "APPROVED", decidedAt: new Date() } : {}) } });
        await db.attachment.updateMany({ where: { entityType: "quote", entityId: q.id }, data: { entityType: "tender", entityId: tender.id } });
        await db.quoteEvent.create({ data: { quoteId: q.id, action: "PROJECT", note: `فُتح مشروع خاص: ${tender.name}`, userId: user.id, userName: user.name } }).catch(() => undefined);
      }
    }
    // حساب صاحب المشروع في بوابة العملاء (الدخول بالبريد + كلمة السر)
    const clientEmail = String(raw.clientEmail ?? "").trim();
    if (tender.kind === "PRIVATE" && clientEmail) {
      const c = await provisionClient({
        tenderId: tender.id,
        projectName: tender.name,
        name: String(raw.clientName ?? "").trim() || tender.entity,
        email: clientEmail,
        phone: String(raw.clientPhone ?? "").trim() || null,
        password: String(raw.clientPassword ?? "").trim() || null,
        createdById: user.id,
        sendEmail: raw.clientSendEmail === "on",
      }).catch(async (e) => {
        // المشروع أُنشئ: فشل الحساب لا يلغيه — يُضاف الحساب لاحقاً من «بوابة العميل»
        await notify([user.id], { title: "تعذر إنشاء حساب صاحب المشروع", body: `${tender.name}: ${e instanceof Error ? e.message : e} — أضفه من صفحة بوابة العميل`, href: `/tenders/${tender.id}/portal` });
        return null;
      });
      if (c) await auditEvent("CREATE", "Client", `حساب بوابة لصاحب المشروع ${clientEmail}${c.existing ? " (حساب موجود رُبط بالمشروع)" : c.mailed ? " — أُرسلت بيانات الدخول بالبريد" : ""}`, user, { recordId: tender.id });
    }
    if (data.managerId) {
      await notify([data.managerId], { title: awarded ? "تم إسناد مشروع إليك" : "تم إسناد عطاء جديد إليك", body: awarded ? tender.name : `${tender.name} — آخر موعد للتقديم ${fmtDate(tender.deadline)}`, href: `/tenders/${tender.id}` }, { exclude: user.id });
    }
  });
  if (res.ok) {
    revalidatePath("/", "layout");
    redirect(`/tenders/${newId}`);
  }
  return res;
}

/** إلغاء عطاء أُنشئ للتو (فشل مرفقاته): حركاته البنكية ومصاريفه التلقائية ومرفقاته */
async function rollbackNewTender(id: number) {
  const expenses = await db.expense.findMany({ where: { tenderId: id }, select: { id: true } });
  await db.$transaction([
    db.bankTransaction.deleteMany({ where: { sourceType: "EXPENSE", sourceId: { in: expenses.map((e) => e.id) } } }),
    db.expense.deleteMany({ where: { tenderId: id } }),
    db.tender.delete({ where: { id } }),
  ]);
  await deleteAttachmentsFor("tender", id);
}

export async function updateTender(id: number, _: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await actionUser(can.manageTenders);
    await assertNotLocked(user, id);
    const data = tenderSchema.parse(formObject(fd));
    await assertNotDuplicate(data.number, data.entity, id);
    await db.tender.update({ where: { id }, data });
    revalidatePath("/", "layout");
    return "تم تحديث بيانات العطاء";
  });
}

/** مراحل العطاء قبل الإحالة (المدير العام) + المرحلة الأولى: الإحالة والتعاقد (المدير العام والمحاسب) */
const adminSteps = {
  site: z.object({ siteVisitDate: zOptDate, siteVisitNotes: zOptText }),
  submit: z.object({ bidAmount: zOptMoney }),
  result: z.object({
    status: z.enum(["SUBMITTED", "NEGOTIATION", "WON", "LOST"], { errorMap: () => ({ message: "اختر النتيجة" }) }),
    bidAmount: zOptMoney,
    negotiationDiscount: zOptMoney,
    awardedValue: zOptMoney,
    resultDate: zOptDate,
  }),
  award: z.object({ stampFee: zOptMoney, stampFeeDate: zOptDate, awardLetterNo: zOptText, awardLetterDate: zOptDate, noExpense: zCheckbox }),
  commence: z.object({ advancePayment: zOptMoney, advanceDate: zOptDate, commenceOrderDate: zDate("تاريخ أمر المباشرة"), durationDays: z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().int().positive("مدة غير صالحة").nullable()) }),
  /** تغيير المرحلة الحالية يدوياً + الإسناد (المدير العام) — لأرشفة المشاريع القديمة وتصحيح المراحل */
  stage: z.object({ stage: z.enum(STAGE_VALUES, { errorMap: () => ({ message: "اختر المرحلة" }) }), managerId: zOptId, awardedValue: zOptMoney, progress: zOptInt("نسبة الإنجاز", 0, 100) }),
} as const;

const AWARD_STEPS = new Set(["award", "commence"]);

const zMonths = z.preprocess((v) => (v === "" || v == null ? 12 : Number(v)), z.number().int().refine((n) => n === 12 || n === 24, "مدة الصيانة سنة أو سنتان"));

/** المراحل 2–5 (من التنفيذ حتى الإغلاق) — المدير العام والمحاسب ومدير المشروع المسند */
const projectSteps = {
  progress: z.object({ progress: z.preprocess((v) => Number(v), z.number().int().min(0).max(100, "النسبة بين 0 و 100")) }),
  prelimInspection: z.object({ prelimInspectionDate: zDate("تاريخ كشف اللجنة"), prelimCommittee: zOptText, prelimSnags: zOptText }),
  snagsCleared: z.object({ prelimSnagsClearedDate: zDate("تاريخ معالجة النواقص") }),
  prelimHandover: z.object({ preliminaryHandoverDate: zDate("تاريخ محضر الاستلام الابتدائي"), maintenanceMonths: zMonths }),
  maintDelivered: z.object({ date: zDate("تاريخ تسليم كفالة الصيانة") }),
  perfReleased: z.object({ date: zDate("تاريخ الإفراج عن كفالة حسن التنفيذ") }),
  finalInspection: z.object({ finalInspectionDate: zDate("تاريخ كشف لجنة الاستلام النهائي"), finalCommittee: zOptText, finalNotes: zOptText }),
  finalHandover: z.object({ finalHandoverDate: zDate("تاريخ محضر الاستلام النهائي") }),
  maintReleased: z.object({ maintenanceReleaseDate: zDate("تاريخ قرار الإفراج عن كفالة الصيانة") }),
  close: z.object({}),
} as const;

export type LifecycleStep = keyof typeof adminSteps | keyof typeof projectSteps;

/** خانات المستندات التي يرفعها كل إجراء (حقل الملف: file_<slot>) — كلها اختيارية */
const STEP_SLOTS: Partial<Record<LifecycleStep, StageSlot[]>> = {
  award: ["award_letter", "stamp_receipt"],
  commence: ["commence_order", "performance_guarantee"],
  prelimInspection: ["prelim_inspection"],
  prelimHandover: ["prelim_handover"],
  maintDelivered: ["maintenance_guarantee"],
  perfReleased: ["performance_release"],
  finalInspection: ["final_inspection"],
  finalHandover: ["final_handover"],
  maintReleased: ["maintenance_release"],
};

const hasNewFile = (fd: FormData, slot: StageSlot) => fd.getAll(`file_${slot}`).some((f) => typeof f === "object" && f !== null && "size" in f && (f as File).size > 0);

async function saveSlotFiles(fd: FormData, tenderId: number, userId: number, slots: StageSlot[]) {
  for (const slot of slots) await saveAttachments(fd, "tender", tenderId, userId, `file_${slot}`, { label: STAGE_SLOTS[slot].label, slot });
}

const ACTIVE = ["WON", "EXECUTION", "MAINTENANCE"];

/** يمنع فقط التناقض المنطقي في التواريخ (تاريخ لاحق قبل سابقه) — دون فرض تسلسل أو مرفقات */
function assertOrder(later: Date, earlier: Date | null | undefined, msg: string) {
  if (earlier && later < earlier) throw new AppError(msg);
}
function assertNotFuture(d: Date, today: Date, what: string) {
  if (d > today) throw new AppError(`لا يمكن تسجيل ${what} بتاريخ مستقبلي`);
}

export async function updateLifecycle(id: number, step: LifecycleStep, _: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const isProjectStep = step in projectSteps;
    const user = await actionUser(isProjectStep ? can.manageProjectLifecycle : AWARD_STEPS.has(step) ? can.manageAward : can.manageTenders);
    await assertNotLocked(user, id);
    // مدير المشروع: مشاريعه المسندة فقط
    await assertTenderAccess(user, id);
    const tender = await db.tender.findUnique({ where: { id }, include: { guarantees: true } });
    if (!tender) throw new AppError("العطاء غير موجود");
    if (isProjectStep && !ACTIVE.includes(tender.status)) {
      throw new AppError(tender.status === "CLOSED" ? "المشروع مغلق — لإعادة فتحه غيّر مرحلته من زر «المرحلة والإسناد» (المدير العام)" : "هذه المرحلة تبدأ بعد الإحالة على الشركة");
    }

    const schema = (isProjectStep ? projectSteps[step as keyof typeof projectSteps] : adminSteps[step as keyof typeof adminSteps]) as z.ZodTypeAny;
    const parsed = schema.parse(formObject(fd)) as Record<string, unknown>;
    const data: Record<string, unknown> = { ...parsed };
    const today = todayUTC();
    const maint = tender.guarantees.filter((g) => g.type === "MAINTENANCE");
    const perf = tender.guarantees.filter((g) => g.type === "PERFORMANCE");
    const guaranteeOps: { where: Prisma.GuaranteeWhereInput; data: Prisma.GuaranteeUpdateManyMutationInput }[] = [];
    let message = "تم تحديث مرحلة المشروع";
    // حقول مساعدة لا تُحفظ على المشروع
    if (step === "maintDelivered" || step === "perfReleased") delete data.date;
    if (step === "award") delete data.noExpense;
    if (step === "stage") delete data.stage;

    switch (step) {
      case "submit":
        if (["PURCHASED", "PRICING"].includes(tender.status)) data.status = "SUBMITTED";
        break;
      case "result":
        if (parsed.status === "WON" && parsed.awardedValue == null) {
          const bid = (parsed.bidAmount as number | null) ?? tender.bidAmount;
          if (bid == null) throw new AppError("أدخل قيمة العرض أو قيمة الإحالة النهائية");
          data.awardedValue = round3(bid - ((parsed.negotiationDiscount as number | null) ?? 0));
        }
        break;
      case "stage": {
        const stage = parsed.stage as StageValue;
        const { status, phase } = stageToFields(stage);
        data.status = status;
        data.phase = phase;
        if (isAwardedStage(stage) && (parsed.awardedValue ?? tender.awardedValue) == null) throw new AppError("أدخل قيمة الإحالة — مطلوبة للمشاريع المحالة على الشركة");
        if (parsed.awardedValue == null) delete data.awardedValue;
        if (parsed.progress == null) {
          delete data.progress;
          if (["P3", "P4", "P5", "CLOSED"].includes(stage) && tender.progress < 100) data.progress = 100;
        }
        data.closedAt = stage === "CLOSED" ? (tender.closedAt ?? new Date()) : null;
        message = `تم نقل المشروع إلى: ${STAGE_OPTIONS.find((o) => o.value === stage)?.label}`;
        break;
      }
      case "commence":
        if (["WON", "NEGOTIATION"].includes(tender.status)) data.status = "EXECUTION";
        data.advancePayment = (parsed.advancePayment as number | null) ?? 0;
        break;
      case "prelimInspection":
        assertNotFuture(parsed.prelimInspectionDate as Date, today, "كشف لجنة");
        assertOrder(parsed.prelimInspectionDate as Date, tender.commenceOrderDate, "تاريخ كشف اللجنة قبل أمر المباشرة");
        // تغيّر قائمة النواقص يُلغي تسجيل معالجة سابقة
        if ((parsed.prelimSnags ?? null) !== tender.prelimSnags) data.prelimSnagsClearedDate = null;
        message = parsed.prelimSnags ? "تم تسجيل كشف اللجنة والنواقص" : "تم تسجيل كشف اللجنة — الأعمال مطابقة";
        break;
      case "snagsCleared":
        assertOrder(parsed.prelimSnagsClearedDate as Date, tender.prelimInspectionDate, "تاريخ المعالجة قبل تاريخ الكشف");
        break;
      case "prelimHandover": {
        assertNotFuture(parsed.preliminaryHandoverDate as Date, today, "محضر استلام");
        assertOrder(parsed.preliminaryHandoverDate as Date, tender.prelimInspectionDate, "تاريخ محضر الاستلام قبل تاريخ كشف اللجنة");
        if (["WON", "EXECUTION"].includes(tender.status)) data.status = "MAINTENANCE";
        data.progress = 100;
        // كفالة صيانة صدرت بلا تاريخ انتهاء: تُحسب من تاريخ الاستلام الابتدائي + مدة الصيانة
        const end = new Date(parsed.preliminaryHandoverDate as Date);
        end.setUTCMonth(end.getUTCMonth() + (parsed.maintenanceMonths as number));
        guaranteeOps.push({ where: { tenderId: id, type: "MAINTENANCE", expiryDate: null }, data: { expiryDate: end } });
        message = "تم اعتماد محضر الاستلام الابتدائي — بدأت فترة الصيانة";
        break;
      }
      case "maintDelivered":
        if (maint.length === 0) throw new AppError("لا توجد كفالة صيانة مسجلة — تُسجَّل أولاً من «+ كفالة صيانة»");
        guaranteeOps.push({ where: { tenderId: id, type: "MAINTENANCE", status: "ISSUED" }, data: { status: "SUBMITTED", submittedDate: parsed.date as Date } });
        message = "تم تسجيل تسليم كفالة الصيانة لصاحب العمل";
        break;
      case "perfReleased":
        if (perf.length === 0) throw new AppError("لا توجد كفالة حسن تنفيذ مسجلة لهذا المشروع");
        guaranteeOps.push({ where: { tenderId: id, type: "PERFORMANCE", status: { in: ["ISSUED", "SUBMITTED"] } }, data: { status: "RETRIEVED", retrievedDate: parsed.date as Date } });
        message = "تم استلام كفالة حسن التنفيذ من صاحب العمل — يعيدها المحاسب للبنك";
        break;
      case "finalInspection":
        assertNotFuture(parsed.finalInspectionDate as Date, today, "كشف لجنة");
        assertOrder(parsed.finalInspectionDate as Date, tender.preliminaryHandoverDate, "تاريخ كشف الاستلام النهائي قبل الاستلام الابتدائي");
        break;
      case "finalHandover":
        assertNotFuture(parsed.finalHandoverDate as Date, today, "محضر استلام");
        assertOrder(parsed.finalHandoverDate as Date, tender.finalInspectionDate, "تاريخ المحضر قبل تاريخ كشف اللجنة");
        assertOrder(parsed.finalHandoverDate as Date, tender.preliminaryHandoverDate, "الاستلام النهائي قبل الاستلام الابتدائي");
        message = "تم اعتماد محضر الاستلام النهائي";
        break;
      case "maintReleased":
        assertOrder(parsed.maintenanceReleaseDate as Date, tender.finalHandoverDate, "تاريخ القرار قبل محضر الاستلام النهائي");
        guaranteeOps.push({ where: { tenderId: id, type: "MAINTENANCE", status: { in: ["ISSUED", "SUBMITTED"] } }, data: { status: "RETRIEVED", retrievedDate: parsed.maintenanceReleaseDate as Date } });
        message = "تم تسجيل قرار الإفراج عن كفالة الصيانة";
        break;
      case "close":
        data.status = "CLOSED";
        data.phase = 5;
        data.closedAt = new Date();
        message = "تم إغلاق المشروع رسمياً";
        break;
    }

    // الدفعة المقدمة تُودع في حساب الشركة: وصل الإيداع إلزامي لغير الإدارة (مرة لكل مبلغ جديد)
    if (step === "commence") {
      const adv = (data.advancePayment as number) ?? 0;
      if (adv > 0) {
        const hasSlip = await db.attachment.count({ where: { entityType: "tender", entityId: id, slot: "deposit:ADVANCE" } });
        if (!hasSlip || adv !== (tender.advancePayment ?? 0)) await assertDepositSlip(fd, user);
      }
    }
    await db.$transaction(async (tx) => {
      await tx.tender.update({ where: { id }, data });
      for (const op of guaranteeOps) await tx.guarantee.updateMany(op);
      // الدفعة المقدمة من صاحب العمل: إيداع بنكي تُسترد لاحقاً من المطالبات
      if (step === "commence") {
        await tx.bankTransaction.deleteMany({ where: { sourceType: "ADVANCE", sourceId: id } });
        const adv = (data.advancePayment as number) ?? 0;
        if (adv > 0) {
          await tx.bankTransaction.create({
            data: { date: (parsed.advanceDate as Date | null) ?? (parsed.commenceOrderDate as Date), type: "IN", amount: adv, description: `دفعة مقدمة من صاحب العمل — ${tender.name}`, category: "CLAIM", tenderId: id, sourceType: "ADVANCE", sourceId: id },
          });
        }
      }
      if (step === "award" && parsed.stampFee && (parsed.stampFee as number) > 0 && !parsed.noExpense) {
        // إعادة احتساب مصروف الطوابع عند تعديله
        const old = await tx.expense.findFirst({ where: { autoSource: `stamp:${id}` } });
        if (old) {
          await removeLinkedBankTx(tx, "EXPENSE", old.id);
          await tx.expense.delete({ where: { id: old.id } });
        }
        await createCompanyExpense(tx, {
          tenderId: id,
          category: "STAMP_FEES",
          amount: parsed.stampFee as number,
          date: (parsed.stampFeeDate as Date | null) ?? new Date(),
          description: `رسوم طوابع العطاء ${tender.number}`,
          autoSource: `stamp:${id}`,
          userId: user.id,
        });
      }
    });
    const slots = STEP_SLOTS[step];
    if (slots) await saveSlotFiles(fd, id, user.id, slots);
    else await saveAttachments(fd, "tender", id, user.id);
    if (step === "commence") await saveDepositSlip(fd, "ADVANCE", id, user);

    // توجيه الإشعارات
    const href = `/tenders/${id}`;
    const others = { exclude: user.id };
    if (step === "stage" && parsed.managerId && parsed.managerId !== tender.managerId) {
      await notify([parsed.managerId as number], { title: "تم إسناد مشروع إليك", body: `${tender.name} (${tender.number})`, href });
    }
    if (step === "result" && parsed.status === "WON" && tender.status !== "WON") {
      await notify(["ACCOUNTANT", { managerOf: id }], { title: "عطاء محال على الشركة", body: `${tender.name} — قيمة الإحالة ${fmtJOD((data.awardedValue as number) ?? (parsed.awardedValue as number) ?? 0)}`, href }, others);
    }
    if (step === "commence") {
      await notify(["ACCOUNTANT", { managerOf: id }], { title: "صدر أمر المباشرة", body: `${tender.name} — بدء التنفيذ ${fmtDate(parsed.commenceOrderDate as Date)}`, href }, others);
    }
    if (step === "progress" && user.role === "PM") {
      await notify(["ADMIN"], { title: `تحديث الإنجاز: ${parsed.progress}%`, body: `${tender.name} — بواسطة ${user.name}`, href });
    }
    if (step === "prelimInspection") {
      await notify(["ADMIN", { managerOf: id }], { title: "كشف لجنة الاستلام الابتدائي", body: `${tender.name} — ${parsed.prelimSnags ? "توجد نواقص للمعالجة" : "الأعمال مطابقة"}`, href }, others);
    }
    if (step === "prelimHandover") {
      await notify(["ADMIN", "ACCOUNTANT", { managerOf: id }], { title: "تم الاستلام الابتدائي — المطلوب: المطالبة النهائية وكفالة الصيانة", body: `${tender.name} — مدة الصيانة ${parsed.maintenanceMonths === 24 ? "سنتان" : "سنة"} من ${fmtDate(parsed.preliminaryHandoverDate as Date)}`, href }, others);
    }
    if (step === "perfReleased" || step === "maintReleased") {
      await notify(["ADMIN", "ACCOUNTANT"], { title: step === "perfReleased" ? "أُفرج عن كفالة حسن التنفيذ — أعدها للبنك" : "أُفرج عن كفالة الصيانة — أعدها للبنك واسترد المحجوزات", body: tender.name, href: `${href}?tab=guarantees` }, others);
    }
    if (step === "finalHandover" || step === "close") {
      await notify(["ADMIN", "ACCOUNTANT", { managerOf: id }], { title: step === "close" ? "تم إغلاق المشروع رسمياً" : "تم الاستلام النهائي", body: `${tender.name} — بواسطة ${user.name}`, href }, others);
    }
    revalidatePath("/", "layout");
    return message;
  });
}

/** رفع مستندات إضافية لخانة مرحلة (المرحلة الأولى للمدير العام، المراحل 2–5 لمدير المشروع المسند أيضاً) */
export async function uploadStageFile(id: number, slot: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    if (!isStageSlot(slot)) throw new AppError("خانة مستند غير معروفة");
    const user = await actionUser(STAGE_SLOTS[slot].phase === 1 ? can.manageAward : can.manageProjectLifecycle);
    await assertNotLocked(user, id);
    await assertTenderAccess(user, id);
    if (!hasNewFile(fd, slot)) throw new AppError("اختر ملفاً للرفع");
    await saveSlotFiles(fd, id, user.id, [slot]);
    revalidatePath("/", "layout");
    return `تم رفع «${STAGE_SLOTS[slot].label}»`;
  });
}

export async function deleteTender(id: number) {
  const result = await runVoid(async () => {
    const user = await actionUser();
    await assertNotLocked(user, id);
    if (user.role !== "ADMIN") throw new AppError("حذف العطاءات للمدير العام فقط");
    const [claims, guarantees, expenses] = await Promise.all([
      db.claim.findMany({ where: { tenderId: id }, select: { id: true } }),
      db.guarantee.findMany({ where: { tenderId: id }, select: { id: true } }),
      db.expense.findMany({ where: { tenderId: id }, select: { id: true } }),
    ]);
    await db.$transaction([
      db.bankTransaction.deleteMany({ where: { sourceType: "CLAIM", sourceId: { in: claims.map((c) => c.id) } } }),
      db.bankTransaction.deleteMany({ where: { sourceType: "EXPENSE", sourceId: { in: expenses.map((e) => e.id) } } }),
      db.expense.deleteMany({ where: { tenderId: id } }),
      db.tender.delete({ where: { id } }),
    ]);
    for (const c of claims) await deleteAttachmentsFor("claim", c.id);
    for (const g of guarantees) await deleteAttachmentsFor("guarantee", g.id);
    for (const e of expenses) await deleteAttachmentsFor("expense", e.id);
    await deleteAttachmentsFor("tender", id);
  });
  if (!result.ok) return result;
  revalidatePath("/", "layout");
  redirect("/tenders");
}

/** الأرشيف: ترحيل يدوي (عند اكتمال الشروط) أو إعادة المشروع من الأرشيف — الإعادة للمدير العام فقط */
export async function setArchive(id: number, action: "archive" | "final" | "restore", _: ActionState, fd: FormData): Promise<ActionState> {
  const result = await run(async () => {
    const user = await actionUser(action === "restore" ? (r) => r === "ADMIN" : can.manageProjectLifecycle);
    if (action === "restore" && user.baseRole !== "ADMIN") throw new AppError("إعادة المشروع من الأرشيف صلاحية المدير العام فقط (لا تنتقل بالتفويض)");
    const t = await db.tender.findUnique({ where: { id }, include: { guarantees: { select: { type: true, status: true, expiryDate: true } }, claims: { select: { type: true, status: true } } } });
    if (!t) throw new AppError("المشروع غير موجود");
    const note = String(fd.get("note") ?? "").trim();
    if (action === "restore") {
      if (!note) throw new AppError("اكتب سبب إعادة المشروع من الأرشيف — يُوثّق في سجل الرقابة");
      if (t.archiveStage === 0) throw new AppError("المشروع ليس في الأرشيف");
      // الإعادة درجة واحدة: من النهائي إلى أرشيف الصيانة، ومن أرشيف الصيانة إلى النشط
      const to = t.archiveStage - 1;
      await db.tender.update({ where: { id }, data: { archiveStage: to, ...(to === 1 ? { finalArchivedAt: null, status: "MAINTENANCE", closedAt: null } : { archivedAt: null }), archiveNote: `أُعيد من الأرشيف بواسطة ${user.name} (${fmtDate(new Date())}): ${note}` } });
      return to === 1 ? "أُعيد المشروع إلى أرشيف فترة الصيانة — يمكن التعديل عليه الآن" : "أُعيد المشروع إلى المشاريع النشطة";
    }
    const c = archiveCheck(t);
    if (action === "archive") {
      if (t.archiveStage !== 0) throw new AppError("المشروع في الأرشيف مسبقاً");
      if (!c.stage1Ready) throw new AppError(`لا يمكن الترحيل للأرشيف بعد: ${c.stage1Blockers.join("، ")}`);
      await db.tender.update({ where: { id }, data: { archiveStage: 1, archivedAt: new Date(), archiveNote: note || null } });
      await syncArchive(id);
      return "رُحّل المشروع لأرشيف فترة الصيانة";
    }
    if (t.archiveStage !== 1) throw new AppError("الإفراج النهائي يكون للمشاريع في أرشيف فترة الصيانة");
    if (!c.stage2Ready) throw new AppError(`لا يمكن الإفراج النهائي بعد: ${c.stage2Blockers.join("، ")}`);
    const now = new Date();
    await db.tender.update({ where: { id }, data: { archiveStage: 2, finalArchivedAt: now, status: "CLOSED", closedAt: t.closedAt ?? now, archiveNote: note || t.archiveNote } });
    return "تم الإفراج النهائي — المشروع في الأرشيف النهائي ومقفل";
  });
  if (result.ok) revalidatePath("/", "layout");
  return result;
}

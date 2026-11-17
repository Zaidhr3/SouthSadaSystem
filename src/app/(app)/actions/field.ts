"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { actionUser, assertTenderAccess } from "@/lib/auth";
import { auditEvent, run, runVoid, type ActionState } from "@/lib/action";
import { AppError, can } from "@/lib/permissions";
import { upsertLinkedBankTx } from "@/lib/finance";
import { attachedFileTypes, deleteAttachmentsFor, saveAttachments } from "@/lib/uploads";
import { claimNet } from "@/lib/deductions";
import { previousCumulative } from "@/lib/surveys";
import { claimEvent, claimFromSurvey } from "@/lib/claim-flow";
import { notify } from "@/lib/notify";
import { issueClaimInvoice } from "@/lib/jofotara";
import { parseNum } from "@/lib/num";
import { fmtJOD, round3, todayUTC } from "@/lib/format";
import { MANUAL_PAYMENT_METHOD } from "@/lib/labels";
import { formObject, zDate, zOptDate, zOptMoney, zOptText, zPositiveMoney, zText } from "@/lib/validation";

const refresh = () => revalidatePath("/", "layout");

/* ═══════════════ الحصر الفعلي (المرحلة ب — مدير المشروع) ═══════════════ */

const surveySchema = z.object({ date: zDate("تاريخ الحصر"), title: zOptText, notes: zOptText, kind: z.enum(["INTERIM", "FINAL"]).catch("INTERIM") });

/** حصر جديد — مدير المشروع المسند (أو المدير العام)، بعد اعتماد جدول الكميات التعاقدي */
export async function createSurvey(tenderId: number, _: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await actionUser(can.fieldOps);
    await assertTenderAccess(user, tenderId);
    const data = surveySchema.parse(formObject(fd));
    const tender = await db.tender.findUnique({ where: { id: tenderId }, select: { boqApprovedAt: true, _count: { select: { boqItems: true } } } });
    if (!tender?._count.boqItems) throw new AppError("لا يوجد جدول كميات لهذا المشروع");
    if (!tender.boqApprovedAt) throw new AppError("جدول الكميات لم يعتمده المحاسب بعد — يبدأ الحصر بعد اعتماد الجدول التعاقدي");
    const open = await db.survey.findFirst({ where: { tenderId, status: { in: ["DRAFT", "SUBMITTED"] } } });
    if (open) throw new AppError(open.status === "DRAFT" ? `يوجد حصر قيد الإعداد (رقم ${open.number}) — أكمله أو احذفه أولاً` : `الحصر رقم ${open.number} لدى المحاسب لإعداد المطالبة — انتظر صدورها`);
    const count = await db.survey.count({ where: { tenderId } });
    await db.survey.create({ data: { ...data, tenderId, number: count + 1, createdById: user.id } });
    refresh();
    return "تم فتح حصر جديد — أدخل الكميات التراكمية المنفذة فعلياً";
  });
}

async function editableSurvey(surveyId: number) {
  const user = await actionUser(can.fieldOps);
  const s = await db.survey.findUnique({ where: { id: surveyId } });
  if (!s) throw new AppError("الحصر غير موجود");
  await assertTenderAccess(user, s.tenderId);
  if (s.status !== "DRAFT") throw new AppError("الحصر مُرسل للمحاسب ومقفل — لا يمكن تعديله");
  return { user, s };
}

/** حفظ الكميات التراكمية المقاسة في الموقع: الحقول qty_<boqItemId> و note_<boqItemId> */
export async function saveSurveyLines(surveyId: number, _: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const { user, s } = await editableSurvey(surveyId);
    const items = await db.boqItem.findMany({ where: { tenderId: s.tenderId }, select: { id: true } });
    let saved = 0;
    await db.$transaction(async (tx) => {
      for (const it of items) {
        const qty = parseNum(fd.get(`qty_${it.id}`));
        const note = String(fd.get(`note_${it.id}`) ?? "").trim() || null;
        if (qty == null) {
          await tx.surveyLine.deleteMany({ where: { surveyId, boqItemId: it.id } });
          continue;
        }
        if (!Number.isFinite(qty) || qty < 0) throw new AppError("الكميات يجب أن تكون أرقاماً موجبة");
        await tx.surveyLine.upsert({
          where: { surveyId_boqItemId: { surveyId, boqItemId: it.id } },
          create: { surveyId, boqItemId: it.id, cumulativeQty: round3(qty), notes: note },
          update: { cumulativeQty: round3(qty), notes: note },
        });
        saved++;
      }
    });
    await saveAttachments(fd, "survey", surveyId, user.id);
    refresh();
    return `تم حفظ ${saved} بنداً من الحصر`;
  });
}

export async function deleteSurvey(surveyId: number) {
  const result = await runVoid(async () => {
    const { user, s } = await editableSurvey(surveyId);
    if (user.role !== "ADMIN" && s.createdById !== user.id) throw new AppError("يمكنك حذف الحصر الذي أنشأته فقط");
    if (s.claimId) throw new AppError("هذا الحصر مرتبط بمطالبة معادة للتعديل — عدّل الكميات ثم أعد تقديمها");
    await db.survey.delete({ where: { id: surveyId } });
    await deleteAttachmentsFor("survey", surveyId);
  });
  refresh();
  return result;
}

/** يرسل رسالة داخلية رسمية + إشعاراً فورياً */
async function systemMessage(fromId: number, toIds: number[], subject: string, body: string, tenderId: number, href: string) {
  for (const to of toIds) {
    if (to === fromId) continue;
    const m = await db.message.create({ data: { senderId: fromId, recipientId: to, subject, body, tenderId } });
    await notify([to], { title: subject, body: body.slice(0, 180), href: href || `/messages/${m.id}` });
  }
}

/**
 * الخطوة الأولى في دورة المطالبة: مدير المشروع يرسل المطالبة للمحاسب من الحصر الفعلي
 * (حصر مرحلي → مطالبة مرحلية، الحصر النهائي → مطالبة نهائية). المطالبة المرفوضة تُعاد بنفس الرقم بعد تعديل الحصر.
 */
export async function submitSurveyToAccountant(surveyId: number) {
  const result = await runVoid(async () => {
    const { user, s } = await editableSurvey(surveyId);
    const { claim, resubmitted } = await claimFromSurvey(surveyId, user);
    const tender = await db.tender.findUniqueOrThrow({ where: { id: s.tenderId }, select: { name: true } });
    await auditEvent("workflow", "Claim", `${resubmitted ? "إعادة تقديم" : "إرسال"} المطالبة رقم ${claim.number} للمحاسب من الحصر رقم ${s.number} — ${tender.name}`, user, { recordId: claim.id });
  });
  refresh();
  return result;
}

/** المحاسب يعيد الحصر لمدير المشروع لتصحيح القياس (قبل إصدار المطالبة) */
export async function returnSurveyToPM(surveyId: number, _: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await actionUser(can.manageFinance);
    const reason = zText("سبب الإرجاع").parse(fd.get("reason"));
    const s = await db.survey.findUnique({ where: { id: surveyId }, include: { tender: { select: { id: true, name: true, managerId: true } } } });
    if (!s) throw new AppError("الحصر غير موجود");
    if (s.status !== "SUBMITTED") throw new AppError("يمكن إرجاع الحصر المرسل فقط");
    await db.survey.update({ where: { id: surveyId }, data: { status: "DRAFT", submittedAt: null } });
    if (s.tender.managerId) {
      await systemMessage(user.id, [s.tender.managerId], `أُعيد الحصر رقم ${s.number} للتصحيح — ${s.tender.name}`, `أعاد المحاسب الحصر رقم ${s.number} لتصحيح القياس:\n\n${reason}`, s.tender.id, `/tenders/${s.tender.id}?tab=surveys`);
    }
    await auditEvent("workflow", "Survey", `إرجاع الحصر رقم ${s.number} لمدير المشروع — ${s.tender.name} — ${reason}`, user);
    refresh();
    return "أُعيد الحصر لمدير المشروع";
  });
}

/* ═══════════════ الاعتماد النهائي للمطالبة (المرحلة د — المدير العام) ═══════════════ */

/** المدير العام: «اعتماد نهائي وقفل» للمطالبة الجاهزة — وتُحدّث نسبة الإنجاز حسب الكميات الفعلية */
export async function approveDraftClaim(claimId: number) {
  const result = await runVoid(async () => {
    const user = await actionUser(can.approveClaims, { readOnlyOk: true });
    const c = await db.claim.findUnique({ where: { id: claimId }, include: { lines: true, tender: { include: { boqItems: true } } } });
    if (!c) throw new AppError("المطالبة غير موجودة");
    if (c.status !== "READY" && c.status !== "REVIEW") throw new AppError("المطالبة لم يرفعها المحاسب للإدارة بعد");
    const boqTotal = c.tender.boqItems.reduce((s, b) => s + b.quantity * b.unitPrice, 0);
    const prev = await previousCumulative(c.tenderId);
    const measuredValue = c.tender.boqItems.reduce((s, b) => s + (prev.get(b.id) ?? 0) * b.unitPrice, 0);
    const measuredPct = boqTotal > 0 && c.lines.length ? Math.min(100, Math.round((measuredValue / boqTotal) * 100)) : c.tender.progress;
    await db.$transaction([
      db.claim.update({ where: { id: claimId }, data: { status: "SUBMITTED", approvedById: user.id, lockedAt: new Date(), returnReason: null } }),
      db.tender.update({ where: { id: c.tenderId }, data: { progress: Math.max(c.tender.progress, measuredPct) } }),
    ]);
    await claimEvent(c.id, "approved", user, `صافي ${fmtJOD(claimNet(c))}`);
    // الفاتورة الضريبية تُرسل تلقائياً لنظام الفوترة الوطني (جفوتارا) لجلب UUID ورمز QR
    const inv = await issueClaimInvoice(c.id);
    await claimEvent(c.id, inv.ok ? "einvoice" : inv.rejected ? "einvoice_rejected" : "einvoice_pending", null, inv.message);
    if (inv.rejected) {
      await notify(["ACCOUNTANT", "ADMIN"], { title: `رفض نظام الفوترة فاتورة المطالبة رقم ${c.number} — أُعيدت للمحاسب`, body: inv.message, href: `/claims/${c.id}` });
      await auditEvent("workflow", "Claim", `رفض نظام الفوترة فاتورة المطالبة رقم ${c.number} — ${c.tender.name} — أُعيدت للمحاسب مع الفاتورتين`, user);
      return;
    }
    if (!inv.ok) await notify(["ACCOUNTANT"], { title: `فاتورة المطالبة رقم ${c.number} لم تُعتمد من نظام الفوترة`, body: inv.message, href: `/claims/${c.id}` });
    await auditEvent("workflow", "Claim", `موافقة الإدارة على المطالبة رقم ${c.number} — ${c.tender.name} — صافي ${fmtJOD(claimNet(c))}`, user);
    await notify([{ managerOf: c.tenderId }, "ACCOUNTANT"], {
      title: `تمت الموافقة على المطالبة رقم ${c.number} — بانتظار الصرف`,
      body: `${c.tender.name} — صافي ${fmtJOD(claimNet(c))}${c.lines.length ? ` — الإنجاز حسب الكميات الفعلية ${measuredPct}%` : ""}`,
      href: `/claims/${c.id}`,
    }, { exclude: user.id });
  });
  refresh();
  return result;
}

/** إرجاع مطالبة «جاهزة» إلى مسودة لتعديلها (المحاسب أو المدير العام) — تُخفى عن مدير المشروع حتى تمر بالبوابة مجدداً */
export async function returnDraftClaim(claimId: number) {
  const result = await runVoid(async () => {
    const user = await actionUser(can.manageFinance);
    const c = await db.claim.findUnique({ where: { id: claimId }, include: { tender: true } });
    if (!c) throw new AppError("المطالبة غير موجودة");
    if (c.status !== "READY" && c.status !== "REVIEW") throw new AppError("يمكن إرجاع المطالبات الجاهزة غير المقفلة فقط");
    await db.claim.update({ where: { id: claimId }, data: { status: "DRAFT", readyAt: null } });
    await claimEvent(c.id, "withdrawn", user);
    await auditEvent("workflow", "Claim", `سحب المطالبة رقم ${c.number} من الإدارة للتعديل — ${c.tender.name}`, user);
    if (user.role === "ADMIN") {
      await notify(["ACCOUNTANT"], { title: `أُعيدت المطالبة رقم ${c.number} للتعديل`, body: `${c.tender.name} — راجع الأرقام ثم أكّد التدقيق وأرسل إشعار الجاهزية مجدداً`, href: `/claims/${c.id}` }, { exclude: user.id });
    }
  });
  refresh();
  return result;
}

/* ═══════════════ اليومية الموقعية ═══════════════ */

const diarySchema = z.object({
  date: zDate("التاريخ"),
  weather: zOptText,
  workforce: z.preprocess((v) => (v === "" || v == null ? 0 : Number(v)), z.number({ invalid_type_error: "عدد العمال غير صالح" }).int().min(0)),
  workDone: zText("الأعمال المنفذة"),
  equipment: zOptText,
  materials: zOptText,
  issues: zOptText,
});

export async function saveDiary(tenderId: number, _: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await actionUser(can.fieldOps);
    await assertTenderAccess(user, tenderId);
    const data = diarySchema.parse(formObject(fd));
    if (data.date > todayUTC()) throw new AppError("لا يمكن تسجيل يومية بتاريخ مستقبلي");
    const d = await db.siteDiary.upsert({
      where: { tenderId_date: { tenderId, date: data.date } },
      create: { ...data, tenderId, createdById: user.id },
      update: data,
    });
    const n = await saveAttachments(fd, "diary", d.id, user.id);
    if (data.issues) {
      await notify(["ADMIN"], { title: "ملاحظة/عائق في اليومية الموقعية", body: data.issues.slice(0, 200), href: `/tenders/${tenderId}?tab=diary` }, { exclude: user.id });
    }
    refresh();
    return n ? `تم حفظ اليومية مع ${n} صورة` : "تم حفظ اليومية";
  });
}

export async function deleteDiary(id: number) {
  const result = await runVoid(async () => {
    const user = await actionUser(can.fieldOps);
    const d = await db.siteDiary.findUnique({ where: { id } });
    if (!d) throw new AppError("اليومية غير موجودة");
    if (user.role !== "ADMIN" && d.createdById !== user.id) throw new AppError("يمكنك حذف يومياتك فقط");
    await db.siteDiary.delete({ where: { id } });
    await deleteAttachmentsFor("diary", id);
  });
  refresh();
  return result;
}

/* ═══════════════ معرض الصور ═══════════════ */

export async function uploadPhotos(tenderId: number, _: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await actionUser(can.fieldOps);
    await assertTenderAccess(user, tenderId);
    const types = await attachedFileTypes(fd, user.id);
    if (types.length === 0) throw new AppError("اختر صورة واحدة على الأقل");
    if (types.some((t) => !t.startsWith("image/"))) throw new AppError("معرض الصور يقبل الصور فقط");
    const n = await saveAttachments(fd, "photo", tenderId, user.id);
    refresh();
    return `تم رفع ${n} صورة`;
  });
}

/* ═══════════════ ديزل وصيانة الآليات ═══════════════ */

const fleetSchema = z.object({
  equipmentId: z.preprocess(Number, z.number({ invalid_type_error: "اختر المعدة" }).int().positive("اختر المعدة")),
  tenderId: z.preprocess(Number, z.number({ invalid_type_error: "اختر المشروع" }).int().positive("اختر المشروع")),
  kind: z.enum(["FUEL", "MAINTENANCE"], { errorMap: () => ({ message: "اختر النوع" }) }),
  liters: zOptMoney,
  amount: zPositiveMoney("المبلغ"),
  date: zOptDate,
  vendor: zOptText,
  notes: zOptText,
  paymentMethod: z.string().optional(),
});

/** تسجيل ديزل أو صيانة لمعدة على مشروع — يُحمّل على كلفة المشروع ويُربط بالمعدة */
export async function logFleetExpense(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await actionUser();
    const data = fleetSchema.parse(formObject(fd));
    if (user.role === "PM") await assertTenderAccess(user, data.tenderId);
    const eq = await db.equipment.findUnique({ where: { id: data.equipmentId } });
    if (!eq) throw new AppError("المعدة غير موجودة");
    if (data.kind === "FUEL" && !data.liters) throw new AppError("أدخل عدد اللترات");
    const method = user.role === "PM" ? "CUSTODY" : data.paymentMethod && data.paymentMethod in MANUAL_PAYMENT_METHOD && data.paymentMethod !== "CHEQUE" ? data.paymentMethod : "COMPANY";
    const date = data.date ?? todayUTC();
    const description = data.kind === "FUEL"
      ? `ديزل ${data.liters} لتر — ${eq.name} (${round3(data.amount / (data.liters || 1))} د.أ/لتر)${data.notes ? ` — ${data.notes}` : ""}`
      : `صيانة ${eq.name}${data.notes ? ` — ${data.notes}` : ""}`;
    const exp = await db.$transaction(async (tx) => {
      const e = await tx.expense.create({
        data: {
          tenderId: data.tenderId,
          equipmentId: eq.id,
          fuelLiters: data.kind === "FUEL" ? data.liters : null,
          category: data.kind,
          amount: data.amount,
          date,
          description,
          vendor: data.vendor,
          paymentMethod: method,
          createdById: user.id,
        },
      });
      if (method === "COMPANY") await upsertLinkedBankTx(tx, "EXPENSE", e.id, { date, type: "OUT", amount: e.amount, description, tenderId: e.tenderId });
      return e;
    });
    await saveAttachments(fd, "expense", exp.id, user.id);
    refresh();
    return data.kind === "FUEL" ? `تم تسجيل ${data.liters} لتر ديزل بقيمة ${fmtJOD(data.amount)}` : `تم تسجيل الصيانة بقيمة ${fmtJOD(data.amount)}`;
  });
}

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { actionUser, assertTenderAccess } from "@/lib/auth";
import { run, runVoid, type ActionState } from "@/lib/action";
import { AppError, can } from "@/lib/permissions";
import { removeLinkedBankTx, upsertLinkedBankTx } from "@/lib/finance";
import { deleteAttachmentsFor, saveAttachments } from "@/lib/uploads";
import { CLAIM_STATUS, CLAIM_TYPE } from "@/lib/labels";
import { fmtJOD, round3, todayUTC } from "@/lib/format";
import { getSettings } from "@/lib/settings";
import { claimNet, computeClaimDeductions, heldRetention, LOCKED_CLAIM } from "@/lib/deductions";
import { notify } from "@/lib/notify";
import { recordLiability } from "@/lib/tax";
import { formObject, zDate, zEnum, zOptMoney, zOptText, zPositiveMoney } from "@/lib/validation";
import { claimEvent, resolveDeduction } from "@/lib/claim-flow";
import { assertDepositSlip, saveDepositSlip } from "@/lib/deposit";

const schema = z.object({
  type: zEnum(CLAIM_TYPE, "نوع المطالبة"),
  number: z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().int().positive().nullable()),
  submittedDate: zDate("تاريخ التقديم"),
  grossAmount: zPositiveMoney("قيمة المطالبة"),
  retention: zOptMoney,
  stampDuty: zOptMoney,
  deductions: zOptMoney,
  deductionNotes: zOptText,
  notes: zOptText,
});

/**
 * مراجعة المطالبة قبل اعتمادها (المحاسب أو المدير العام): الخصومات وأسبابها وملاحظات المراجعة.
 * متاحة للمسودة فقط — بعد تأكيد التدقيق تُعاد للمسودة لأي تعديل.
 */
const reviewSchema = z.object({
  deductionMode: z.enum(["none", "pct", "amount"]).optional(),
  deductionValue: zOptMoney,
  /** توافق مع النموذج القديم: مبلغ ثابت */
  deductions: zOptMoney,
  deductionNotes: zOptText,
  notes: zOptText,
});

export async function reviewDraftClaim(id: number, _: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await actionUser(can.manageFinance);
    const claim = await db.claim.findUnique({ where: { id }, select: { status: true, grossAmount: true, retention: true, stampDuty: true, deductions: true } });
    if (!claim) throw new AppError("المطالبة غير موجودة");
    if (claim.status !== "DRAFT") throw new AppError("المراجعة والخصومات على المطالبة قيد التدقيق فقط — اسحبها للتعديل أولاً");
    const data = reviewSchema.parse(formObject(fd));
    const mode = data.deductionMode ?? ((data.deductions ?? 0) > 0 ? "amount" : "none");
    const ded = resolveDeduction(claim.grossAmount, claim, { mode, value: data.deductionValue ?? data.deductions, notes: data.deductionNotes });
    await db.claim.update({ where: { id }, data: { ...ded, notes: data.notes } });
    if (ded.deductions !== claim.deductions) {
      await claimEvent(id, "deduction", user, ded.deductions ? `${ded.deductionRate ? `${ded.deductionRate}% = ` : ""}${fmtJOD(ded.deductions)} — ${ded.deductionNotes}` : "أُلغي الحسم");
    }
    revalidatePath("/", "layout");
    return ded.deductions > 0 ? "تم حفظ المراجعة والحسومات" : "تم حفظ ملاحظات المراجعة";
  });
}

export async function createClaim(tenderId: number, _: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    // المطالبة اليدوية (مقطوعة) للمدير العام فقط — مدير المشروع يُصدر المطالبات من الحصر الفعلي
    const user = await actionUser(can.manageTenders);
    const tender = await assertTenderAccess(user, tenderId);
    const data = schema.parse(formObject(fd));
    const full = await db.tender.findUniqueOrThrow({ where: { id: tender.id }, include: { claims: { select: { retention: true, advanceRecovery: true, status: true } } } });
    const settings = await getSettings();
    // حاسبة المستقطعات الأردنية: محجوزات (مع السقف) + ضريبة دخل مقتطعة + طوابع
    const auto = computeClaimDeductions({
      gross: data.grossAmount,
      contractValue: (full.awardedValue ?? 0) + full.variationTotal,
      retentionHeld: heldRetention(full.claims),
      settings,
    });
    const row = {
      ...data,
      retention: data.retention ?? auto.retention,
      withholdingTax: 0,
      stampDuty: data.stampDuty ?? auto.stampDuty,
      advanceRecovery: 0,
      deductions: data.deductions ?? 0,
    };
    if (claimNet(row) < 0) throw new AppError("مجموع المستقطعات أكبر من قيمة المطالبة");
    const max = await db.claim.aggregate({ where: { tenderId }, _max: { number: true } });
    if (data.number && (await db.claim.findFirst({ where: { tenderId, number: data.number } }))) throw new AppError(`يوجد مطالبة برقم ${data.number} على هذا المشروع`);
    const claim = await db.claim.create({ data: { ...row, tenderId, number: data.number ?? (max._max.number ?? 0) + 1, status: "SUBMITTED", preparedById: user.id, approvedById: user.id, lockedAt: new Date() } });
    await claimEvent(claim.id, "approved", user, "مطالبة يدوية (مبلغ مقطوع) أنشأتها الإدارة — بانتظار الصرف");
    await saveAttachments(fd, "claim", claim.id, user.id);
    await notify(["ADMIN", "ACCOUNTANT"], { title: `مطالبة جديدة رقم ${claim.number}`, body: `${full.name} — إجمالي ${fmtJOD(claim.grossAmount)} — صافي متوقع ${fmtJOD(claimNet(claim))}`, href: `/tenders/${tenderId}?tab=claims` }, { exclude: user.id });
    revalidatePath("/", "layout");
    return `تم تسجيل المطالبة — الصافي المتوقع ${fmtJOD(claimNet(claim))}`;
  });
}

const paySchema = z.object({ paidDate: zDate("تاريخ القبض"), paidAmount: zOptMoney, deductions: zOptMoney, deductionNotes: zOptText, taxAmount: zOptMoney });

/** قبض المطالبة: يسجل إيداعاً في الحساب البنكي تلقائياً */
export async function markClaimPaid(id: number, _: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await actionUser(can.manageFinance);
    const data = paySchema.parse(formObject(fd));
    const claim = await db.claim.findUnique({ where: { id }, include: { tender: true } });
    if (!claim) throw new AppError("المطالبة غير موجودة");
    if (!LOCKED_CLAIM(claim.status)) throw new AppError("يجب أن يعتمد المدير العام المطالبة ويقفلها قبل تسجيل القبض");
    await assertDepositSlip(fd, user);
    const deductions = data.deductions ?? claim.deductions;
    const paidAmount = data.paidAmount ?? claimNet({ ...claim, deductions });
    await db.$transaction(async (tx) => {
      await tx.claim.update({
        where: { id },
        data: {
          status: "PAID",
          paidDate: data.paidDate,
          paidAmount,
          deductions,
          deductionNotes: data.deductionNotes ?? claim.deductionNotes,
          approvedDate: claim.approvedDate ?? data.paidDate,
        },
      });
      await upsertLinkedBankTx(tx, "CLAIM", id, {
        date: data.paidDate,
        type: "IN",
        amount: paidAmount,
        description: `قبض ${CLAIM_TYPE[claim.type]} رقم ${claim.number} — ${claim.tender.name}`,
        tenderId: claim.tenderId,
      });
    });
    // الضريبة المستحقة على المقبوض: فارغ = حسب النسبة في الإعدادات، 0 = لا ضريبة
    const settings = await getSettings();
    const tax = data.taxAmount ?? round3(claim.grossAmount * (settings.withholdingTaxPct / 100));
    if (tax > 0 && !(await db.taxEntry.findFirst({ where: { claimId: id, kind: "LIABILITY" } }))) {
      await recordLiability(
        { tenderId: claim.tenderId, claimId: id, base: claim.grossAmount, rate: data.taxAmount == null ? settings.withholdingTaxPct : null, amount: tax, date: data.paidDate, description: `ضريبة دخل مستحقة على قبض المطالبة رقم ${claim.number} — ${claim.tender.name}`, reference: null },
        user,
      );
    }
    await saveAttachments(fd, "claim", id, user.id);
    await saveDepositSlip(fd, "CLAIM", id, user);
    await claimEvent(id, "paid", user, fmtJOD(paidAmount));
    await notify(["ADMIN", { managerOf: claim.tenderId }], { title: `تم صرف المطالبة رقم ${claim.number}`, body: `${claim.tender.name} — ${fmtJOD(paidAmount)}`, href: `/tenders/${claim.tenderId}?tab=claims` }, { exclude: user.id });
    revalidatePath("/", "layout");
    return "تم تسجيل القبض وإيداعه في الحساب البنكي";
  });
}

export async function setClaimStatus(id: number, status: "APPROVED" | "REJECTED" | "SUBMITTED") {
  const result = await runVoid(async () => {
    const user = await actionUser(can.manageFinance);
    const current = await db.claim.findUnique({ where: { id }, select: { status: true } });
    if (current && ["DRAFT", "READY", "REVIEW", "RETURNED"].includes(current.status)) throw new AppError("المطالبة لم توافق عليها الإدارة بعد");
    await claimEvent(id, "employer", user, CLAIM_STATUS[status]?.label);
    await db.$transaction(async (tx) => {
      await tx.claim.update({
        where: { id },
        data: { status, approvedDate: status === "APPROVED" ? todayUTC() : undefined, paidDate: null, paidAmount: null, archivedAt: null, payStage: null },
      });
      await removeLinkedBankTx(tx, "CLAIM", id);
      // إلغاء القبض يلغي الضريبة المستحقة المرتبطة به
      await tx.taxEntry.deleteMany({ where: { claimId: id, kind: "LIABILITY" } });
    });
  });
  revalidatePath("/", "layout");
  return result;
}

export async function deleteClaim(id: number) {
  const result = await runVoid(async () => {
    const user = await actionUser(can.manageFinance);
    const c = await db.claim.findUnique({ where: { id }, select: { status: true } });
    if (!c) throw new AppError("المطالبة غير موجودة");
    if (c.status !== "DRAFT" && user.role !== "ADMIN") throw new AppError("المطالبة مقدمة للتدقيق أو مقفلة — حذفها للمدير العام فقط");
    await db.$transaction(async (tx) => {
      await removeLinkedBankTx(tx, "CLAIM", id);
      // الحصر يعود لقائمة المحاسب (مُرسل) لإعادة إعداد المطالبة
      await tx.survey.updateMany({ where: { claimId: id }, data: { status: "SUBMITTED", claimId: null } });
      await tx.taxEntry.deleteMany({ where: { claimId: id, kind: "LIABILITY" } });
      await tx.claim.delete({ where: { id } });
    });
    await deleteAttachmentsFor("claim", id);
  });
  revalidatePath("/", "layout");
  return result;
}

const releaseSchema = z.object({ date: zDate("تاريخ الاسترداد"), amount: zOptMoney });

/** استرداد المحجوزات بعد انتهاء فترة الصيانة: إيداع بنكي + إغلاق رصيد المحجوزات */
export async function releaseRetention(tenderId: number, _: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await actionUser(can.manageFinance);
    const data = releaseSchema.parse(formObject(fd));
    const t = await db.tender.findUnique({ where: { id: tenderId }, include: { claims: { select: { retention: true, status: true } } } });
    if (!t) throw new AppError("المشروع غير موجود");
    const held = heldRetention(t.claims);
    if (held <= 0) throw new AppError("لا توجد محجوزات على هذا المشروع");
    const amount = data.amount ?? held;
    if (amount > held) throw new AppError(`المبلغ أكبر من المحجوزات المتراكمة (${fmtJOD(held)})`);
    await assertDepositSlip(fd, user);
    await db.$transaction(async (tx) => {
      await tx.tender.update({ where: { id: tenderId }, data: { retentionReleasedAmount: amount, retentionReleasedDate: data.date } });
      await tx.bankTransaction.deleteMany({ where: { sourceType: "RETENTION", sourceId: tenderId } });
      await tx.bankTransaction.create({
        data: { date: data.date, type: "IN", amount, description: `استرداد محجوزات — ${t.name}`, category: "CLAIM", tenderId, sourceType: "RETENTION", sourceId: tenderId },
      });
    });
    await saveDepositSlip(fd, "RETENTION", tenderId, user);
    await notify(["ADMIN"], { title: "تم استرداد المحجوزات", body: `${t.name} — ${fmtJOD(amount)}`, href: `/tenders/${tenderId}?tab=claims` }, { exclude: user.id });
    revalidatePath("/", "layout");
    return `تم استرداد ${fmtJOD(amount)} وإيداعها في البنك`;
  });
}

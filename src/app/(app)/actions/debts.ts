"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { actionUser } from "@/lib/auth";
import { auditEvent, run, runVoid, type ActionState } from "@/lib/action";
import { AppError, can } from "@/lib/permissions";
import { removeLinkedBankTx, upsertLinkedBankTx } from "@/lib/finance";
import { assertDepositSlip, saveDepositSlip } from "@/lib/deposit";
import { deleteAttachmentsFor, saveAttachments, validateAttachments } from "@/lib/uploads";
import { buildSchedule, computeInterest, syncLoan } from "@/lib/loans";
import { notify } from "@/lib/notify";
import { fmtDate, fmtJOD, round3 } from "@/lib/format";
import { LOAN_FREQUENCY, LOAN_INTEREST_TYPE, LOAN_LENDER_TYPE, LOAN_PAY_METHOD, LOAN_RECEIVED_VIA } from "@/lib/labels";
import { formObject, zDate, zEnum, zOptId, zOptMoney, zOptText, zPositiveMoney, zText } from "@/lib/validation";

const refresh = () => revalidatePath("/", "layout");

const zCount = z.preprocess((v) => (v === "" || v == null ? 1 : Number(v)), z.number().int("عدد الأقساط رقم صحيح").min(1, "عدد الأقساط 1 على الأقل").max(360, "عدد الأقساط كبير جداً"));
const zRate = z.preprocess((v) => (v === "" || v == null ? null : Number(String(v).replace(",", "."))), z.number().min(0, "نسبة غير صالحة").max(100, "نسبة غير صالحة").nullable());

const infoSchema = z.object({
  lender: zText("الجهة الدائنة"),
  lenderType: zEnum(LOAN_LENDER_TYPE, "نوع الجهة"),
  lenderContact: zOptText,
  reference: zOptText,
  purpose: zText("الغرض من الدين"),
  collateral: zOptText,
  tenderId: zOptId,
  notes: zOptText,
});

const createSchema = infoSchema.extend({
  principal: zPositiveMoney("أصل الدين"),
  receivedDate: zDate("تاريخ الاستلام"),
  receivedVia: zEnum(LOAN_RECEIVED_VIA, "طريقة الاستلام"),
  interestType: zEnum(LOAN_INTEREST_TYPE, "نوع الفائدة"),
  interestRate: zRate,
  interestAmount: zOptMoney,
  fees: zOptMoney,
  frequency: zEnum(LOAN_FREQUENCY, "دورية السداد"),
  installmentCount: zCount,
  firstDueDate: zDate("تاريخ أول قسط"),
});

/** تسجيل دين جديد: جدول الأقساط تلقائياً + إيداع في الحساب البنكي (مع وصل الإيداع الإلزامي لغير الإدارة) */
export async function createLoan(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await actionUser(can.manageDebts);
    const d = createSchema.parse(formObject(fd));
    if (d.firstDueDate < d.receivedDate) throw new AppError("تاريخ أول قسط قبل تاريخ استلام الدين");
    if (d.interestType === "PERCENT" && !d.interestRate) throw new AppError("أدخل نسبة الفائدة السنوية");
    if (d.interestType === "FIXED" && !d.interestAmount) throw new AppError("أدخل مبلغ الفائدة");
    const installmentCount = d.frequency === "ONCE" ? 1 : d.installmentCount;
    const interestAmount = computeInterest({ ...d, installmentCount });
    const fees = d.fees ?? 0;
    const totalDue = round3(d.principal + interestAmount + fees);
    if (d.receivedVia === "BANK") await assertDepositSlip(fd, user);
    await validateAttachments(fd, user.id);

    const loan = await db.$transaction(async (tx) => {
      const l = await tx.loan.create({
        data: {
          lender: d.lender,
          lenderType: d.lenderType,
          lenderContact: d.lenderContact,
          reference: d.reference,
          purpose: d.purpose,
          collateral: d.collateral,
          tenderId: d.tenderId,
          notes: d.notes,
          principal: d.principal,
          receivedDate: d.receivedDate,
          receivedVia: d.receivedVia,
          interestType: d.interestType,
          interestRate: d.interestType === "PERCENT" ? d.interestRate : null,
          interestAmount,
          fees,
          totalDue,
          frequency: d.frequency,
          installmentCount,
          firstDueDate: d.firstDueDate,
          createdById: user.id,
        },
      });
      await tx.loanInstallment.createMany({ data: buildSchedule(totalDue, installmentCount, d.frequency, d.firstDueDate).map((i) => ({ ...i, loanId: l.id })) });
      if (d.receivedVia === "BANK") {
        await upsertLinkedBankTx(tx, "LOAN", l.id, { date: d.receivedDate, type: "IN", amount: d.principal, description: `استلام دين من ${d.lender} — ${d.purpose}`, tenderId: d.tenderId });
      }
      return l;
    });
    await saveAttachments(fd, "loan", loan.id, user.id, "files", { label: "عقد / مستندات الدين" });
    if (d.receivedVia === "BANK") await saveDepositSlip(fd, "LOAN", loan.id, user);
    await notify(["ADMIN", "CHAIRMAN", "ACCOUNTANT"], { title: `دين جديد على الشركة: ${fmtJOD(d.principal)}`, body: `${d.lender} — ${d.purpose} — ${installmentCount} ${installmentCount > 1 ? "أقساط" : "دفعة"} تبدأ ${fmtDate(d.firstDueDate)}`, href: `/debts/${loan.id}` }, { exclude: user.id });
    refresh();
    return `تم تسجيل الدين — المستحق الكلي ${fmtJOD(totalDue)}`;
  });
}

/** تعديل بيانات الدين الوصفية (المبالغ والجدول عبر «إعادة الجدولة») */
export async function updateLoanInfo(id: number, _: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await actionUser(can.manageDebts);
    const d = infoSchema.parse(formObject(fd));
    const loan = await db.loan.findUnique({ where: { id } });
    if (!loan) throw new AppError("الدين غير موجود");
    await db.$transaction(async (tx) => {
      await tx.loan.update({ where: { id }, data: d });
      if (loan.receivedVia === "BANK") {
        await tx.bankTransaction.updateMany({ where: { sourceType: "LOAN", sourceId: id }, data: { description: `استلام دين من ${d.lender} — ${d.purpose}`, tenderId: d.tenderId } });
      }
    });
    await saveAttachments(fd, "loan", id, user.id);
    refresh();
    return "تم حفظ بيانات الدين";
  });
}

const paySchema = z.object({
  date: zDate("تاريخ السداد"),
  amount: zPositiveMoney("مبلغ السداد"),
  method: zEnum(LOAN_PAY_METHOD, "طريقة السداد"),
  reference: zOptText,
  notes: zOptText,
});

/** سداد دفعة (قسط كامل أو جزئي أو سداد مبكر) — تُوزع على الأقساط الأقدم أولاً */
export async function addLoanPayment(id: number, _: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await actionUser(can.manageDebts);
    const d = paySchema.parse(formObject(fd));
    const loan = await db.loan.findUnique({ where: { id }, include: { payments: { select: { amount: true } } } });
    if (!loan) throw new AppError("الدين غير موجود");
    if (loan.status === "SETTLED") throw new AppError("هذا الدين مسدد بالكامل");
    if (d.date < loan.receivedDate) throw new AppError("تاريخ السداد قبل تاريخ استلام الدين");
    const remaining = round3(loan.totalDue - loan.payments.reduce((s, p) => s + p.amount, 0));
    if (d.amount > remaining + 0.0005) throw new AppError(`المبلغ أكبر من المتبقي على الدين (${fmtJOD(remaining)}) — لتسوية بخصم استخدم «إعادة الجدولة»`);
    await validateAttachments(fd, user.id);
    const res = await db.$transaction(async (tx) => {
      const p = await tx.loanPayment.create({ data: { loanId: id, date: d.date, amount: d.amount, method: d.method, reference: d.reference, notes: d.notes, createdById: user.id } });
      if (d.method !== "CASH") {
        await upsertLinkedBankTx(tx, "LOAN_PAY", p.id, { date: d.date, type: "OUT", amount: d.amount, description: `سداد دين لـ ${loan.lender}${d.reference ? ` — مرجع ${d.reference}` : ""}`, tenderId: loan.tenderId });
      }
      return { p, ...(await syncLoan(tx, id)) };
    });
    await saveAttachments(fd, "loan_payment", res.p.id, user.id, "files", { label: "إيصال السداد" });
    if (res.settled) {
      await notify(["ADMIN", "CHAIRMAN", "ACCOUNTANT"], { title: `تم سداد دين ${loan.lender} بالكامل`, body: `${fmtJOD(loan.totalDue)} — ${loan.purpose}`, href: `/debts/${id}` }, { exclude: user.id });
    }
    refresh();
    return res.settled ? "تم السداد — أُغلق الدين بالكامل" : `تم تسجيل السداد — المتبقي ${fmtJOD(res.remaining)}`;
  });
}

export async function deleteLoanPayment(paymentId: number) {
  const result = await runVoid(async () => {
    const user = await actionUser(can.deleteDebts);
    const p = await db.loanPayment.findUnique({ where: { id: paymentId }, include: { loan: { select: { lender: true } } } });
    if (!p) throw new AppError("الدفعة غير موجودة");
    await db.$transaction(async (tx) => {
      await removeLinkedBankTx(tx, "LOAN_PAY", paymentId);
      await tx.loanPayment.delete({ where: { id: paymentId } });
      await syncLoan(tx, p.loanId);
    });
    await deleteAttachmentsFor("loan_payment", paymentId);
    await auditEvent("delete", "LoanPayment", `حذف دفعة سداد ${fmtJOD(p.amount)} بتاريخ ${fmtDate(p.date)} — ${p.loan.lender}`, user, { recordId: paymentId });
  });
  refresh();
  return result;
}

const rescheduleSchema = z.object({
  newTotal: zOptMoney,
  reason: zText("سبب إعادة الجدولة"),
  frequency: zEnum(LOAN_FREQUENCY, "دورية السداد"),
  installmentCount: zCount,
  firstDueDate: zDate("تاريخ أول قسط جديد"),
});

/**
 * إعادة الجدولة: الأقساط المسددة تبقى كما هي، والمتبقي يُوزع على جدول جديد.
 * يمكن تعديل إجمالي المستحق (فوائد تأخير إضافية، أو خصم/إعفاء عند التسوية) مع ذكر السبب.
 */
export async function rescheduleLoan(id: number, _: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await actionUser(can.manageDebts);
    const d = rescheduleSchema.parse(formObject(fd));
    const loan = await db.loan.findUnique({ where: { id }, include: { installments: { orderBy: { seq: "asc" } }, payments: { select: { amount: true } } } });
    if (!loan) throw new AppError("الدين غير موجود");
    const paid = round3(loan.payments.reduce((s, p) => s + p.amount, 0));
    const totalDue = d.newTotal ?? loan.totalDue;
    if (totalDue < paid - 0.0005) throw new AppError(`الإجمالي الجديد أقل من المسدد فعلاً (${fmtJOD(paid)})`);
    const remaining = round3(totalDue - paid);
    const count = d.frequency === "ONCE" ? 1 : d.installmentCount;
    await db.$transaction(async (tx) => {
      // نُبقي الأقساط المسددة بالكامل (مبالغها كما هي)، ونستبدل الباقي
      let kept = 0;
      let keptSum = 0;
      for (const i of loan.installments) {
        if (i.paidAmount >= i.amount - 0.0005 && keptSum + i.amount <= paid + 0.0005) {
          kept++;
          keptSum = round3(keptSum + i.amount);
        } else break;
      }
      const keep = loan.installments.slice(0, kept).map((i) => i.id);
      await tx.loanInstallment.deleteMany({ where: { loanId: id, id: { notIn: keep.length ? keep : [-1] } } });
      const rest = round3(totalDue - keptSum);
      if (rest > 0) {
        await tx.loanInstallment.createMany({ data: buildSchedule(rest, count, d.frequency, d.firstDueDate, kept + 1).map((i) => ({ ...i, loanId: id })) });
      }
      const note = `${fmtDate(new Date())}: إعادة جدولة — ${d.reason}${d.newTotal != null && d.newTotal !== loan.totalDue ? ` (المستحق ${fmtJOD(loan.totalDue)} ← ${fmtJOD(totalDue)})` : ""}`;
      await tx.loan.update({ where: { id }, data: { totalDue, frequency: d.frequency, installmentCount: kept + (rest > 0 ? count : 0), notes: [loan.notes, note].filter(Boolean).join("\n") } });
      await syncLoan(tx, id);
    });
    await notify(["ADMIN", "CHAIRMAN", "ACCOUNTANT"], { title: `إعادة جدولة دين ${loan.lender}`, body: `المتبقي ${fmtJOD(remaining)} على ${count} ${count > 1 ? "أقساط" : "دفعة"} — ${d.reason}`, href: `/debts/${id}` }, { exclude: user.id });
    refresh();
    return remaining > 0 ? `أُعيدت الجدولة — المتبقي ${fmtJOD(remaining)}` : "أُغلق الدين بالكامل";
  });
}

export async function deleteLoan(id: number) {
  const result = await runVoid(async () => {
    const user = await actionUser(can.deleteDebts);
    const loan = await db.loan.findUnique({ where: { id }, include: { payments: { select: { id: true } } } });
    if (!loan) throw new AppError("الدين غير موجود");
    const payIds = loan.payments.map((p) => p.id);
    await db.$transaction(async (tx) => {
      await removeLinkedBankTx(tx, "LOAN", id);
      if (payIds.length) await tx.bankTransaction.deleteMany({ where: { sourceType: "LOAN_PAY", sourceId: { in: payIds } } });
      await tx.loan.delete({ where: { id } });
    });
    await deleteAttachmentsFor("loan", id);
    for (const pid of payIds) await deleteAttachmentsFor("loan_payment", pid);
    await auditEvent("delete", "Loan", `حذف دين ${loan.lender} — ${fmtJOD(loan.principal)} مع ${payIds.length} دفعات وحركاتها البنكية`, user, { recordId: id });
  });
  refresh();
  return result;
}

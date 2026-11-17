"use server";

import { revalidatePath } from "next/cache";
import { userSees } from "@/lib/brand";
import { z } from "zod";
import { db } from "@/lib/db";
import { actionUser, assertTenderAccess } from "@/lib/auth";
import { run, runVoid, type ActionState } from "@/lib/action";
import { AppError, can } from "@/lib/permissions";
import { removeLinkedBankTx, upsertLinkedBankTx } from "@/lib/finance";
import { assertDepositSlip, saveDepositSlip } from "@/lib/deposit";
import { attachedFileCount, deleteAttachmentsFor, saveAttachments } from "@/lib/uploads";
import { BANK_TX_CATEGORY, EXPENSE_CATEGORY, PAYMENT_METHOD } from "@/lib/labels";
import { fmtJOD, todayUTC } from "@/lib/format";
import { notify } from "@/lib/notify";
import { formObject, zDate, zEnum, zOptDate, zOptId, zOptText, zPositiveMoney, zText } from "@/lib/validation";

const refresh = () => revalidatePath("/", "layout");

/* ───────────── المصاريف ───────────── */

/** فاتورة أقدم من هذه المدة يمكن حفظها بلا صورة مع علامة تحذير حمراء للمحاسب */
const OLD_INVOICE_DAYS = 7;


const expenseSchema = z.object({
  tenderId: zOptId,
  category: zEnum(EXPENSE_CATEGORY, "التصنيف"),
  amount: zPositiveMoney("المبلغ"),
  date: zDate("التاريخ"),
  description: zText("البيان"),
  vendor: zOptText,
  paymentMethod: zEnum(PAYMENT_METHOD, "طريقة الدفع"),
  chequeId: zOptId,
});

export async function createExpense(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await actionUser();
    const data = expenseSchema.parse({ paymentMethod: "CUSTODY", ...formObject(fd) });
    if (user.role === "PM") {
      if (!data.tenderId) throw new AppError("اختر المشروع");
      await assertTenderAccess(user, data.tenderId);
      data.paymentMethod = "CUSTODY";
      data.chequeId = null;
    }
    if (data.paymentMethod === "INTERNAL") throw new AppError("التحميل الداخلي يُسجل تلقائياً من سجل الآليات فقط");
    if (data.paymentMethod !== "CHEQUE") data.chequeId = null;

    // حوكمة الفواتير: صورة الفاتورة إلزامية — والفاتورة القديمة بلا صورة تُحفظ مع علامة «للتحقيق»
    const ageDays = Math.floor((todayUTC().getTime() - data.date.getTime()) / 86_400_000);
    const noFile = (await attachedFileCount(fd, user.id)) === 0;
    if (noFile && ageDays <= OLD_INVOICE_DAYS) throw new AppError("أرفق صورة الفاتورة أو الإيصال (إلزامي)");
    const invoiceFlag = noFile ? "OLD_NO_ATTACHMENT" : null;

    const expense = await db.$transaction(async (tx) => {
      const e = await tx.expense.create({ data: { ...data, invoiceFlag, createdById: user.id } });
      if (e.paymentMethod === "COMPANY") {
        await upsertLinkedBankTx(tx, "EXPENSE", e.id, {
          date: e.date,
          type: "OUT",
          amount: e.amount,
          description: `${EXPENSE_CATEGORY[e.category]}: ${e.description}`,
          tenderId: e.tenderId,
        });
      }
      return e;
    });
    const n = await saveAttachments(fd, "expense", expense.id, user.id);
    if (invoiceFlag) {
      await notify(["ACCOUNTANT", "ADMIN"], { title: "فاتورة بتاريخ قديم بدون مرفق — للتحقيق", body: `${expense.description} — ${fmtJOD(expense.amount)} — بتاريخ قبل ${ageDays} يوماً — أدخلها ${user.name}`, href: "/expenses?flag=1" }, { exclude: user.id });
    }
    refresh();
    return invoiceFlag ? "حُفظ المصروف مع علامة «فاتورة بتاريخ قديم بدون مرفق — للتحقيق» — أرفق الصورة لاحقاً لإزالتها" : `تم تسجيل المصروف مع ${n} مرفق`;
  });
}

export async function deleteExpense(id: number) {
  const result = await runVoid(async () => {
    const user = await actionUser();
    const exp = await db.expense.findUnique({ where: { id } });
    if (!exp) throw new AppError("المصروف غير موجود");
    if (exp.autoSource?.startsWith("subcert:")) throw new AppError("هذا المصروف ناتج عن دفع مستخلص باطن — لا يُحذف من هنا");
    if (exp.autoSource?.startsWith("equip:")) throw new AppError("هذا المصروف ناتج عن سجل الآليات — احذف سجل التشغيل بدلاً منه");
    if (!can.manageFinance(user.role)) {
      const ageHours = (Date.now() - exp.createdAt.getTime()) / 3600000;
      if (exp.createdById !== user.id || ageHours > 48) throw new AppError("يمكنك حذف مصاريفك خلال 48 ساعة فقط — راجع المحاسب");
    }
    await db.$transaction(async (tx) => {
      await removeLinkedBankTx(tx, "EXPENSE", id);
      await tx.expense.delete({ where: { id } });
    });
    await deleteAttachmentsFor("expense", id);
  });
  refresh();
  return result;
}

/* ───────────── الشيكات ───────────── */

const chequeSchema = z.object({
  number: zText("رقم الشيك"),
  bank: zText("البنك"),
  payee: zText("المستفيد"),
  amount: zPositiveMoney("المبلغ"),
  issueDate: zDate("تاريخ التحرير"),
  dueDate: zDate("تاريخ الاستحقاق"),
  tenderId: zOptId,
  notes: zOptText,
});

export async function createCheque(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await actionUser(can.manageFinance);
    const data = chequeSchema.parse(formObject(fd));
    if (data.dueDate < data.issueDate) throw new AppError("تاريخ الاستحقاق قبل تاريخ التحرير");
    const c = await db.cheque.create({ data });
    await saveAttachments(fd, "cheque", c.id, user.id);
    refresh();
    return "تم تسجيل الشيك";
  });
}

export async function setChequeStatus(id: number, status: "CASHED" | "DEFERRED" | "RETURNED" | "CANCELLED") {
  const result = await runVoid(async () => {
    await actionUser(can.manageFinance);
    await db.$transaction(async (tx) => {
      const c = await tx.cheque.update({
        where: { id },
        data: { status, cashedDate: status === "CASHED" ? todayUTC() : null },
      });
      if (status === "CASHED") {
        await upsertLinkedBankTx(tx, "CHEQUE", id, {
          date: todayUTC(),
          type: "OUT",
          amount: c.amount,
          description: `صرف شيك رقم ${c.number} — ${c.payee}`,
          tenderId: c.tenderId,
        });
      } else {
        await removeLinkedBankTx(tx, "CHEQUE", id);
      }
    });
  });
  refresh();
  return result;
}

export async function deleteCheque(id: number) {
  const result = await runVoid(async () => {
    await actionUser(can.manageFinance);
    await db.$transaction(async (tx) => {
      await removeLinkedBankTx(tx, "CHEQUE", id);
      await tx.cheque.delete({ where: { id } });
    });
    await deleteAttachmentsFor("cheque", id);
  });
  refresh();
  return result;
}

/* ───────────── التمويل والعهد ───────────── */

const fundSchema = z.object({ amount: zPositiveMoney("المبلغ"), reason: zText("سبب الطلب"), tenderId: zOptId });

/** طلب تمويل (المحاسب أو مدير المشروع) - ينتظر موافقة المدير العام */
export async function requestFunds(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await actionUser();
    const data = fundSchema.parse(formObject(fd));
    if (data.tenderId && user.role === "PM") await assertTenderAccess(user, data.tenderId);
    await db.fundRequest.create({ data: { ...data, requesterId: user.id, recipientId: user.id } });
    refresh();
    return "تم إرسال طلب التمويل للمدير العام";
  });
}

/** المدير العام يموّل مدير مشروع أو المحاسب مباشرة (ضخ رأس مال للعهدة) */
export async function fundUser(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const admin = await actionUser(can.approveFunds);
    const data = fundSchema.extend({ recipientId: z.preprocess(Number, z.number().int().positive("اختر المستلم")), date: zOptDate }).parse(formObject(fd));
    const recipient = await db.user.findUnique({ where: { id: data.recipientId } });
    if (!recipient) throw new AppError("المستلم غير موجود");
    const date = data.date ?? todayUTC();
    await db.$transaction(async (tx) => {
      const f = await tx.fundRequest.create({
        data: {
          amount: data.amount,
          reason: data.reason,
          tenderId: data.tenderId,
          requesterId: admin.id,
          recipientId: data.recipientId,
          status: "APPROVED",
          decidedById: admin.id,
          decidedAt: date,
        },
      });
      await upsertLinkedBankTx(tx, "FUND", f.id, {
        date,
        type: "OUT",
        amount: f.amount,
        description: `عهدة لـ ${recipient.name}: ${f.reason}`,
        tenderId: f.tenderId,
      });
    });
    await notify([recipient.id, "ACCOUNTANT"], { title: `تمويل عهدة: ${fmtJOD(data.amount)}`, body: `إلى ${recipient.name} — ${data.reason}`, href: "/funds" }, { exclude: admin.id });
    refresh();
    return `تم تحويل التمويل إلى ${recipient.name}`;
  });
}

export async function decideFund(id: number, decision: "APPROVED" | "REJECTED") {
  const result = await runVoid(async () => {
    const admin = await actionUser(can.approveFunds);
    const req = await db.fundRequest.findUnique({ where: { id } });
    await db.$transaction(async (tx) => {
      const f = await tx.fundRequest.findUnique({ where: { id }, include: { recipient: true } });
      if (!f) throw new AppError("الطلب غير موجود");
      if (f.status !== "PENDING") throw new AppError("تم البت في هذا الطلب مسبقاً");
      await tx.fundRequest.update({ where: { id }, data: { status: decision, decidedById: admin.id, decidedAt: new Date() } });
      if (decision === "APPROVED") {
        await upsertLinkedBankTx(tx, "FUND", id, {
          date: todayUTC(),
          type: "OUT",
          amount: f.amount,
          description: `عهدة لـ ${f.recipient.name}: ${f.reason}`,
          tenderId: f.tenderId,
        });
      }
    });
    if (req) {
      await notify([req.recipientId, "ACCOUNTANT"], {
        title: decision === "APPROVED" ? `تمت الموافقة على طلب التمويل` : `رُفض طلب التمويل`,
        body: `${fmtJOD(req.amount)} — ${req.reason}`,
        href: "/funds",
      }, { exclude: admin.id });
    }
  });
  refresh();
  return result;
}

/* ───────────── الحساب البنكي (المدير العام فقط) ───────────── */

const bankSchema = z.object({
  date: zDate("التاريخ"),
  type: z.enum(["IN", "OUT"], { errorMap: () => ({ message: "اختر نوع الحركة" }) }),
  amount: zPositiveMoney("المبلغ"),
  description: zText("البيان"),
  category: zEnum(BANK_TX_CATEGORY, "التصنيف"),
  tenderId: zOptId,
});

export async function addBankTx(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const bu = await actionUser();
    if (!(await userSees(bu, "bank"))) throw new AppError("ليست لديك صلاحية على الحساب البنكي");
    const data = bankSchema.parse(formObject(fd));
    if (data.type === "IN") await assertDepositSlip(fd, bu);
    const t = await db.bankTransaction.create({ data: { ...data, sourceType: "MANUAL" } });
    if (data.type === "IN") await saveDepositSlip(fd, "MANUAL", t.id, bu);
    else await saveAttachments(fd, "bank", t.id, bu.id);
    refresh();
    return "تم تسجيل الحركة البنكية";
  });
}

export async function deleteBankTx(id: number) {
  const result = await runVoid(async () => {
    const bu = await actionUser();
    if (!(await userSees(bu, "bank"))) throw new AppError("ليست لديك صلاحية على الحساب البنكي");
    const tx = await db.bankTransaction.findUnique({ where: { id } });
    if (!tx) throw new AppError("الحركة غير موجودة");
    if (tx.sourceType !== "MANUAL") throw new AppError("هذه الحركة مرتبطة بمصدرها (مطالبة/شيك/مصروف/عهدة) — عدّل المصدر بدلاً منها");
    await db.bankTransaction.delete({ where: { id } });
    await deleteAttachmentsFor("bank", id);
  });
  refresh();
  return result;
}

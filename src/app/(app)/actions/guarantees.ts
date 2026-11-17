"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { syncArchive } from "@/lib/archive";
import { actionUser } from "@/lib/auth";
import { run, runVoid, type ActionState } from "@/lib/action";
import { AppError, can } from "@/lib/permissions";
import { createCompanyExpense } from "@/lib/finance";
import { deleteAttachmentsFor, saveAttachments } from "@/lib/uploads";
import { GUARANTEE_FORM, GUARANTEE_TYPE } from "@/lib/labels";
import { addYears, todayUTC } from "@/lib/format";
import { formObject, zDate, zEnum, zOptDate, zOptMoney, zOptText, zPositiveMoney, zText } from "@/lib/validation";

const schema = z.object({
  type: zEnum(GUARANTEE_TYPE, "نوع الكفالة"),
  form: zEnum(GUARANTEE_FORM, "شكل الكفالة"),
  bank: zText("البنك"),
  referenceNo: zOptText,
  amount: zPositiveMoney("قيمة الكفالة"),
  bankFee: zOptMoney,
  issueDate: zDate("تاريخ الإصدار"),
  expiryDate: zOptDate,
  validityYears: z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().int().min(1).max(5).nullable()),
  submittedDate: zOptDate,
  depositBox: zOptText,
  notes: zOptText,
});

export async function createGuarantee(tenderId: number, _: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await actionUser(can.manageGuarantees);
    const { validityYears, ...data } = schema.parse(formObject(fd));
    const tender = await db.tender.findUnique({ where: { id: tenderId } });
    if (!tender) throw new AppError("العطاء غير موجود");

    const bankFee = data.bankFee ?? GUARANTEE_FORM[data.form].fee;
    let expiryDate = data.expiryDate;
    if (!expiryDate && data.type === "MAINTENANCE") expiryDate = addYears(tender.preliminaryHandoverDate ?? data.issueDate, validityYears ?? 1);

    const today = todayUTC();
    const created = await db.$transaction(async (tx) => {
      const g = await tx.guarantee.create({
        data: { ...data, tenderId, bankFee, expiryDate, status: data.submittedDate ? "SUBMITTED" : "ISSUED" },
      });
      // تسلسل الكفالات: حسن التنفيذ تحرر كفالة الدخول تلقائياً.
      // أما الإفراج عن حسن التنفيذ مقابل كفالة الصيانة فيُسجَّل بكتاب الإفراج من صاحب العمل (المرحلة الرابعة)
      const releases = data.type === "PERFORMANCE" ? "BID" : null;
      if (releases) {
        await tx.guarantee.updateMany({
          where: { tenderId, type: releases, status: { in: ["ISSUED", "SUBMITTED"] } },
          data: { status: "RETRIEVED", retrievedDate: today },
        });
      }
      await createCompanyExpense(tx, {
        tenderId,
        category: "BANK_FEES",
        amount: bankFee,
        date: data.issueDate,
        description: `عمولة إصدار ${GUARANTEE_TYPE[data.type]} (${GUARANTEE_FORM[data.form].label}) — عطاء ${tender.number}`,
        autoSource: `guarantee-fee:${g.id}`,
        userId: user.id,
      });
      return g;
    });
    await saveAttachments(fd, "guarantee", created.id, user.id);
    revalidatePath("/", "layout");
    return "تم تسجيل الكفالة";
  });
}

export async function setGuaranteeStatus(id: number, status: "SUBMITTED" | "RETRIEVED" | "RETURNED") {
  const result = await runVoid(async () => {
    await actionUser(can.manageGuarantees);
    const today = todayUTC();
    const data =
      status === "SUBMITTED"
        ? { status, submittedDate: today }
        : status === "RETRIEVED"
          ? { status, retrievedDate: today }
          : { status, returnedDate: today };
    const g = await db.guarantee.update({ where: { id }, data });
    // الإفراج عن كفالة حسن التنفيذ أو الصيانة قد يُرحّل المشروع للأرشيف
    if (status !== "SUBMITTED") await syncArchive(g.tenderId);
  });
  revalidatePath("/", "layout");
  return result;
}

export async function deleteGuarantee(id: number) {
  const result = await runVoid(async () => {
    await actionUser(can.manageGuarantees);
    await db.guarantee.delete({ where: { id } });
    await deleteAttachmentsFor("guarantee", id);
  });
  revalidatePath("/", "layout");
  return result;
}

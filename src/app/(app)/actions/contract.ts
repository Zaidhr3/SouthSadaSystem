"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { actionUser } from "@/lib/auth";
import { auditEvent, run, type ActionState } from "@/lib/action";
import { AppError, can } from "@/lib/permissions";
import { createCompanyExpense } from "@/lib/finance";
import { GUARANTEE_FORM, GUARANTEE_TYPE } from "@/lib/labels";
import { addYears, fmtJOD, todayUTC } from "@/lib/format";
import { formObject, zOptDate, zOptMoney, zOptText } from "@/lib/validation";

const optInt = (max: number) => z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().int().min(1).max(max).nullable());
const schema = z.object({
  commenceOrderDate: zOptDate,
  durationDays: optInt(5000),
  maintenanceMonths: optInt(60),
  supervisorName: zOptText,
  supervisorPhone: z.preprocess((v) => (v == null || String(v).trim() === "" ? null : String(v).replace(/[^\d+]/g, "")), z.string().min(7, "رقم الهاتف غير صالح").max(16).nullable()),
  employerTin: zOptText,
  employerPhone: zOptText,
  perfAmount: zOptMoney,
  perfBank: zOptText,
  perfIssue: zOptDate,
  perfExpiry: zOptDate,
  maintAmount: zOptMoney,
  maintBank: zOptText,
  maintIssue: zOptDate,
  maintExpiry: zOptDate,
});

/**
 * نافذة الإحالة والعقد السريعة: أمر المباشرة ومدة العطاء، المهندس المشرف، كفالة حسن التنفيذ وكفالة الصيانة وتواريخهما
 * — في خطوة واحدة. الكفالات تتبع نفس منطق «إصدار كفالة» (عمولة البنك كمصروف، تحرير كفالة الدخول).
 */
export async function saveContractQuick(tenderId: number, _: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await actionUser(can.manageAward);
    const d = schema.parse(formObject(fd));
    const tender = await db.tender.findUnique({ where: { id: tenderId }, include: { guarantees: true } });
    if (!tender) throw new AppError("العطاء غير موجود");
    if (tender.awardedValue == null) throw new AppError("سجّل الإحالة وقيمة العقد أولاً");
    const wantsG = (d.perfAmount ?? 0) > 0 || (d.maintAmount ?? 0) > 0;
    if (wantsG && !can.manageGuarantees(user.role)) throw new AppError("تسجيل الكفالات للمدير العام — اترك حقول الكفالات فارغة");
    for (const [amt, bank, label] of [[d.perfAmount, d.perfBank, "حسن التنفيذ"], [d.maintAmount, d.maintBank, "الصيانة"]] as const) {
      if ((amt ?? 0) > 0 && !bank) throw new AppError(`اكتب اسم البنك لكفالة ${label}`);
    }
    const today = todayUTC();
    const created: string[] = [];
    await db.$transaction(async (tx) => {
      await tx.tender.update({
        where: { id: tenderId },
        data: {
          ...(d.commenceOrderDate ? { commenceOrderDate: d.commenceOrderDate } : {}),
          ...(d.durationDays ? { durationDays: d.durationDays } : {}),
          ...(d.maintenanceMonths ? { maintenanceMonths: d.maintenanceMonths } : {}),
          supervisorName: d.supervisorName,
          supervisorPhone: d.supervisorPhone,
          employerTin: d.employerTin,
          employerPhone: d.employerPhone,
          ...(d.commenceOrderDate && ["WON"].includes(tender.status) ? { status: "EXECUTION" } : {}),
        },
      });
      const add = async (type: "PERFORMANCE" | "MAINTENANCE", amount: number | null, bank: string | null, issue: Date | null, expiry: Date | null) => {
        if (!amount || amount <= 0 || !bank) return;
        const issueDate = issue ?? today;
        const expiryDate = expiry ?? (type === "MAINTENANCE" ? addYears(tender.preliminaryHandoverDate ?? issueDate, 1) : null);
        const form = "BANK_GUARANTEE";
        const g = await tx.guarantee.create({ data: { tenderId, type, form, bank, amount, bankFee: GUARANTEE_FORM[form].fee, issueDate, expiryDate, status: "ISSUED" } });
        if (type === "PERFORMANCE") {
          await tx.guarantee.updateMany({ where: { tenderId, type: "BID", status: { in: ["ISSUED", "SUBMITTED"] } }, data: { status: "RETRIEVED", retrievedDate: today } });
        }
        await createCompanyExpense(tx, {
          tenderId,
          category: "BANK_FEES",
          amount: GUARANTEE_FORM[form].fee,
          date: issueDate,
          description: `عمولة إصدار ${GUARANTEE_TYPE[type]} (${GUARANTEE_FORM[form].label}) — عطاء ${tender.number}`,
          autoSource: `guarantee-fee:${g.id}`,
          userId: user.id,
        });
        created.push(`${GUARANTEE_TYPE[type]} ${fmtJOD(amount)}`);
      };
      await add("PERFORMANCE", d.perfAmount, d.perfBank, d.perfIssue, d.perfExpiry);
      await add("MAINTENANCE", d.maintAmount, d.maintBank, d.maintIssue, d.maintExpiry);
    });
    await auditEvent("workflow", "Tender", `بيانات العقد السريعة — ${tender.name}${created.length ? ` — ${created.join("، ")}` : ""}${d.supervisorName ? ` — المهندس المشرف ${d.supervisorName}` : ""}`, user, { recordId: tenderId });
    revalidatePath("/", "layout");
    return created.length ? `تم حفظ بيانات العقد وتسجيل ${created.join(" و")}` : "تم حفظ بيانات العقد";
  });
}

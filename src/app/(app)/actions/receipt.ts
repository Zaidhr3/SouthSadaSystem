"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { actionUser, assertTenderAccess } from "@/lib/auth";
import { auditEvent, run, runVoid, type ActionState } from "@/lib/action";
import { AppError, can } from "@/lib/permissions";
import { notify } from "@/lib/notify";
import { attachedFileCount, saveAttachments } from "@/lib/uploads";
import { claimNet } from "@/lib/deductions";
import { fmtDate, fmtJOD } from "@/lib/format";
import { accountantIds, claimEvent, claimMessage } from "@/lib/claim-flow";
import { finalizeClaimPayment } from "@/lib/claim-pay";
import { assertDepositSlip, saveDepositSlip } from "@/lib/deposit";
import { issueClaimInvoice } from "@/lib/jofotara";
import { formObject, zDate, zOptMoney, zOptText, zText } from "@/lib/validation";

const refresh = () => revalidatePath("/", "layout");


const receiptSchema = z.object({
  receiptDate: zDate("تاريخ القبض"),
  receiptAmount: zOptMoney,
  receiptMethod: z.enum(["CHEQUE", "TRANSFER"]).catch("CHEQUE"),
  receiptRef: zOptText,
});

/**
 * دورة القبض — الخطوة الأولى (مدير المشروع / المحاسب / الإدارة):
 * «تم صرف الشيك / قبض المبلغ» — صورة الشيك أو الحوالة شرط إلزامي للحفظ، ثم إشعار فوري للمحاسب.
 */
export async function submitReceipt(id: number, _: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await actionUser(can.manageProjectLifecycle);
    const c = await db.claim.findUnique({ where: { id }, include: { tender: { select: { id: true, name: true, managerId: true } } } });
    if (!c) throw new AppError("المطالبة غير موجودة");
    await assertTenderAccess(user, c.tenderId);
    if (!["SUBMITTED", "APPROVED"].includes(c.status)) throw new AppError("يُسجَّل القبض بعد موافقة الإدارة على المطالبة");
    if (c.payStage === "RECEIVED" || c.payStage === "AUDITED") throw new AppError("القبض مسجل وبانتظار التدقيق والموافقة");
    if ((await attachedFileCount(fd, user.id)) === 0) throw new AppError("صورة الشيك أو الحوالة إلزامية لحفظ القبض");
    const d = receiptSchema.parse(formObject(fd));
    const amount = d.receiptAmount ?? claimNet(c);
    if (amount <= 0) throw new AppError("المبلغ المقبوض غير صالح");
    // الشيك يودعه شخص في البنك: وصل الإيداع إلزامي لغير الإدارة (الحوالة تصل الحساب مباشرة وإشعارها هو الإثبات)
    if (d.receiptMethod === "CHEQUE") await assertDepositSlip(fd, user);
    await saveAttachments(fd, "claim", id, user.id, "files", { label: d.receiptMethod === "CHEQUE" ? "صورة الشيك" : "إشعار الحوالة" });
    if (d.receiptMethod === "CHEQUE") await saveDepositSlip(fd, "CLAIM", id, user);
    await db.claim.update({
      where: { id },
      data: { payStage: "RECEIVED", receiptAmount: amount, receiptDate: d.receiptDate, receiptMethod: d.receiptMethod, receiptRef: d.receiptRef, receiptById: user.id, receiptAt: new Date(), receiptNote: null, disbursementStage: "CHEQUE", disbursementUpdatedAt: new Date() },
    });
    const what = `${d.receiptMethod === "CHEQUE" ? "شيك" : "حوالة"}${d.receiptRef ? ` رقم ${d.receiptRef}` : ""} بمبلغ ${fmtJOD(amount)} بتاريخ ${fmtDate(d.receiptDate)}`;
    await claimEvent(id, "receipt", user, what);
    await claimMessage(user.id, await accountantIds(), c, `قبض المطالبة رقم ${c.number} — بانتظار تدقيقك`, `سُجّل قبض ${what} مع صورة ${d.receiptMethod === "CHEQUE" ? "الشيك" : "الحوالة"}.\nيرجى تدقيق المبلغ والمرفق ثم رفعه للإدارة للموافقة.`);
    await auditEvent("workflow", "Claim", `تسجيل قبض المطالبة رقم ${c.number} — ${c.tender.name} — ${what}`, user, { recordId: id });
    refresh();
    return d.receiptMethod === "CHEQUE" ? "سُجّل القبض مع صورة الشيك ووصل الإيداع — أُبلغ المحاسب للتدقيق" : "سُجّل القبض مع إشعار الحوالة — أُبلغ المحاسب للتدقيق";
  });
}

/** الخطوة الثانية — المحاسب: تدقيق المبلغ والمرفق ورفعه للإدارة */
export async function auditReceipt(id: number) {
  const result = await runVoid(async () => {
    const user = await actionUser(can.manageFinance);
    const c = await db.claim.findUnique({ where: { id }, include: { tender: { select: { name: true } } } });
    if (!c || c.payStage !== "RECEIVED") throw new AppError("لا يوجد قبض بانتظار التدقيق");
    await db.claim.update({ where: { id }, data: { payStage: "AUDITED", receiptAuditedById: user.id, receiptAuditedAt: new Date() } });
    await claimEvent(id, "receipt_audited", user, fmtJOD(c.receiptAmount ?? 0));
    await notify(["ADMIN", "CHAIRMAN"], { title: `قبض المطالبة رقم ${c.number} بانتظار موافقتك`, body: `${c.tender.name} — ${fmtJOD(c.receiptAmount ?? 0)} — دققه ${user.name}`, href: `/claims/${id}` }, { exclude: user.id });
    await auditEvent("workflow", "Claim", `تدقيق قبض المطالبة رقم ${c.number} — ${c.tender.name}`, user, { recordId: id });
  });
  refresh();
  return result;
}

/** رفض القبض (المحاسب أو الإدارة) مع السبب — يعود لمن سجّله لتصحيحه */
export async function rejectReceipt(id: number, _: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await actionUser((r) => can.manageFinance(r) || can.approveClaims(r), { readOnlyOk: true });
    const reason = zText("سبب الرفض").parse(fd.get("reason"));
    const c = await db.claim.findUnique({ where: { id }, include: { tender: { select: { id: true, name: true, managerId: true } } } });
    if (!c || !["RECEIVED", "AUDITED"].includes(c.payStage ?? "")) throw new AppError("لا يوجد قبض بانتظار القرار");
    if (c.payStage === "AUDITED" && !can.approveClaims(user.role)) throw new AppError("القبض مرفوع للإدارة");
    if (c.payStage === "RECEIVED" && !can.manageFinance(user.role)) throw new AppError("القبض بانتظار تدقيق المحاسب");
    await db.claim.update({ where: { id }, data: { payStage: null, receiptNote: reason } });
    await claimEvent(id, "receipt_rejected", user, reason);
    const to = [c.receiptById, c.tender.managerId].filter((x): x is number => !!x);
    await claimMessage(user.id, to, c, `رفض قبض المطالبة رقم ${c.number}`, `السبب: ${reason}\nصحّح البيانات أو الصورة ثم سجّل القبض من جديد.`);
    refresh();
    return "أُعيد القبض للتصحيح";
  });
}

/**
 * الخطوة الثالثة — الإدارة (المدير العام / المشرف الأعلى): الموافقة النهائية على القبض
 * ← إيداع فعلي في حساب الشركة البنكي ← نقل المطالبة للأرشيف.
 */
export async function approveReceipt(id: number) {
  const result = await runVoid(async () => {
    const user = await actionUser(can.approveClaims, { readOnlyOk: true });
    const c = await db.claim.findUnique({ where: { id }, include: { tender: { select: { name: true, managerId: true } } } });
    if (!c || c.payStage !== "AUDITED") throw new AppError("القبض لم يدققه المحاسب بعد");
    const amount = c.receiptAmount ?? claimNet(c);
    await finalizeClaimPayment(id, { paidDate: c.receiptDate ?? new Date(), paidAmount: amount, archive: true }, user);
    await claimEvent(id, "paid", user, `${fmtJOD(amount)} — أُودع في حساب الشركة ونُقلت المطالبة للأرشيف`);
    await notify(["ACCOUNTANT", { managerOf: c.tenderId }], { title: `تم صرف المطالبة رقم ${c.number} وإيداعها`, body: `${c.tender.name} — ${fmtJOD(amount)}`, href: `/claims/${id}` }, { exclude: user.id });
    await auditEvent("workflow", "Claim", `موافقة الإدارة على قبض المطالبة رقم ${c.number} — ${c.tender.name} — إيداع ${fmtJOD(amount)} وأرشفة`, user, { recordId: id });
  });
  refresh();
  return result;
}

/** إرسال واعتماد الفاتورة من نظام الفوترة الوطني (إعادة المحاولة يدوياً) — المحاسب والإدارة */
export async function sendClaimInvoice(id: number) {
  const result = await runVoid(async () => {
    const user = await actionUser((r) => can.manageFinance(r) || can.approveClaims(r), { readOnlyOk: true });
    const c = await db.claim.findUnique({ where: { id } });
    if (!c || !["SUBMITTED", "APPROVED", "PAID"].includes(c.status)) throw new AppError("تُرسل الفاتورة بعد موافقة الإدارة على المطالبة");
    const r = await issueClaimInvoice(id);
    await claimEvent(id, r.ok ? "einvoice" : r.rejected ? "einvoice_rejected" : "einvoice_failed", user, r.message);
    if (r.rejected) await notify(["ACCOUNTANT", "ADMIN"], { title: `رفض نظام الفوترة فاتورة المطالبة رقم ${c.number} — أُعيدت للمحاسب`, body: r.message, href: `/claims/${id}` });
    if (!r.ok) throw new AppError(r.message);
  });
  refresh();
  return result;
}

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { actionUser, assertTenderAccess } from "@/lib/auth";
import { auditEvent, run, runVoid, type ActionState } from "@/lib/action";
import { AppError, can } from "@/lib/permissions";
import { upsertLinkedBankTx } from "@/lib/finance";
import { getSettings } from "@/lib/settings";
import { notify } from "@/lib/notify";
import { fmtJOD, todayUTC } from "@/lib/format";
import { REQUEST_KIND, REQUEST_PAYMENT } from "@/lib/labels";
import { formObject, zEnum, zOptId, zOptMoney, zOptText, zPositiveMoney, zText } from "@/lib/validation";

const refresh = () => revalidatePath("/", "layout");

const createSchema = z.object({
  tenderId: z.preprocess(Number, z.number({ invalid_type_error: "اختر المشروع" }).int().positive("اختر المشروع")),
  boqItemId: zOptId,
  kind: zEnum(REQUEST_KIND, "نوع الطلب"),
  title: zText("عنوان الطلب"),
  details: zOptText,
  quantity: zOptMoney,
  unit: zOptText,
  estimatedAmount: zPositiveMoney("القيمة التقديرية"),
});

/** مدير المشروع يرفع طلب مواد أو عهدة مرتبطاً بمشروعه (وبند من جدول الكميات اختيارياً) */
export async function createFieldRequest(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await actionUser(can.fieldOps);
    const d = createSchema.parse(formObject(fd));
    await assertTenderAccess(user, d.tenderId);
    if (d.boqItemId && !(await db.boqItem.findFirst({ where: { id: d.boqItemId, tenderId: d.tenderId } }))) throw new AppError("البند لا يتبع هذا المشروع");
    const r = await db.fieldRequest.create({ data: { ...d, requesterId: user.id } });
    await auditEvent("workflow", "FieldRequest", `طلب ${REQUEST_KIND[d.kind]} #${r.id}: ${d.title} — ${fmtJOD(d.estimatedAmount)}`, user);
    refresh();
    return `أُرسل الطلب للمحاسب للتدقيق (${fmtJOD(d.estimatedAmount)})`;
  });
}

const auditSchema = z.object({
  decision: z.enum(["APPROVE", "REJECT"], { errorMap: () => ({ message: "اختر القرار" }) }),
  approvedAmount: zOptMoney,
  paymentMethod: z.string().optional(),
  auditNote: zOptText,
});

/**
 * المحاسب يدقق توفر الميزانية ويحدد طريقة الدفع.
 * إن تجاوز المبلغ حد الموافقة (إعدادات النظام) يُحال للمدير العام، وإلا يُعتمد مباشرة.
 */
export async function auditFieldRequest(id: number, _: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await actionUser(can.manageFinance);
    const d = auditSchema.parse(formObject(fd));
    const r = await db.fieldRequest.findUnique({ where: { id }, include: { tender: { select: { name: true } } } });
    if (!r) throw new AppError("الطلب غير موجود");
    if (r.status !== "PENDING_AUDIT") throw new AppError("تم تدقيق هذا الطلب مسبقاً");
    if (d.decision === "REJECT") {
      if (!d.auditNote) throw new AppError("اكتب سبب الرفض");
      await db.fieldRequest.update({ where: { id }, data: { status: "REJECTED", auditedById: user.id, auditedAt: new Date(), auditNote: d.auditNote } });
      await notify([r.requesterId], { title: `رُفض طلبك: ${r.title}`, body: d.auditNote, href: "/requests" }, { exclude: user.id });
      await auditEvent("workflow", "FieldRequest", `رفض المحاسب الطلب #${id}: ${d.auditNote}`, user);
      refresh();
      return "رُفض الطلب وأُبلغ مدير المشروع";
    }
    if (!d.paymentMethod || !(d.paymentMethod in REQUEST_PAYMENT)) throw new AppError("حدد طريقة الدفع");
    const amount = d.approvedAmount ?? r.estimatedAmount;
    if (amount <= 0) throw new AppError("المبلغ المعتمد غير صالح");
    const { gmApprovalThreshold } = await getSettings();
    const needsGM = amount > gmApprovalThreshold && user.role !== "ADMIN";
    await db.fieldRequest.update({
      where: { id },
      data: { status: needsGM ? "PENDING_GM" : "APPROVED", approvedAmount: amount, paymentMethod: d.paymentMethod, auditedById: user.id, auditedAt: new Date(), auditNote: d.auditNote, ...(needsGM ? {} : { decidedById: user.id, decidedAt: new Date() }) },
    });
    if (needsGM) {
      await notify(["ADMIN"], { title: `طلب ${REQUEST_KIND[r.kind]} بانتظار موافقتك — ${fmtJOD(amount)}`, body: `${r.tender.name} — ${r.title} — دققه ${user.name}${d.auditNote ? `: ${d.auditNote}` : ""}`, href: "/requests?status=PENDING_GM" });
    } else {
      await notify([r.requesterId], { title: `اعتُمد طلبك: ${r.title}`, body: `${fmtJOD(amount)} — ${REQUEST_PAYMENT[d.paymentMethod]}`, href: "/requests" }, { exclude: user.id });
    }
    await auditEvent("workflow", "FieldRequest", `تدقيق الطلب #${id} — ${fmtJOD(amount)} — ${REQUEST_PAYMENT[d.paymentMethod]}${needsGM ? ` — أُحيل للمدير العام (يتجاوز ${fmtJOD(gmApprovalThreshold)})` : " — معتمد"}`, user);
    refresh();
    return needsGM ? `المبلغ يتجاوز ${fmtJOD(gmApprovalThreshold)} — أُحيل للمدير العام للموافقة` : "اعتُمد الطلب";
  });
}

/** المدير العام يوافق أو يرفض الطلبات عالية القيمة */
export async function decideFieldRequest(id: number, decision: "APPROVED" | "REJECTED") {
  const result = await runVoid(async () => {
    const user = await actionUser(can.approveFunds);
    const r = await db.fieldRequest.findUnique({ where: { id } });
    if (!r) throw new AppError("الطلب غير موجود");
    if (r.status !== "PENDING_GM") throw new AppError("الطلب ليس بانتظار موافقتك");
    await db.fieldRequest.update({ where: { id }, data: { status: decision, decidedById: user.id, decidedAt: new Date() } });
    await notify([r.requesterId, "ACCOUNTANT"], { title: decision === "APPROVED" ? `وافق المدير العام على الطلب: ${r.title}` : `رفض المدير العام الطلب: ${r.title}`, body: fmtJOD(r.approvedAmount ?? r.estimatedAmount), href: "/requests" }, { exclude: user.id });
    await auditEvent("workflow", "FieldRequest", `${decision === "APPROVED" ? "موافقة" : "رفض"} المدير العام على الطلب #${id} — ${fmtJOD(r.approvedAmount ?? r.estimatedAmount)}`, user);
  });
  refresh();
  return result;
}

/**
 * الصرف/التوريد (المحاسب): الدفع نقداً يُصرف كعهدة لمدير المشروع (يُخصم من البنك ويُضاف لرصيد عهدته)،
 * والشيك أو ذمة المورد يُسجل مرجعه هنا ثم يُقيد في دفتر الشيكات/المصاريف.
 */
export async function fulfillFieldRequest(id: number, _: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await actionUser(can.manageFinance);
    const note = zOptText.parse(fd.get("fulfillNote"));
    const r = await db.fieldRequest.findUnique({ where: { id }, include: { tender: { select: { name: true } } } });
    if (!r) throw new AppError("الطلب غير موجود");
    if (r.status !== "APPROVED") throw new AppError("الطلب غير معتمد");
    const amount = r.approvedAmount ?? r.estimatedAmount;
    await db.$transaction(async (tx) => {
      if (r.paymentMethod === "CASH") {
        const f = await tx.fundRequest.create({
          data: { requesterId: r.requesterId, recipientId: r.requesterId, tenderId: r.tenderId, amount, reason: `${REQUEST_KIND[r.kind]}: ${r.title}`, status: "APPROVED", decidedById: user.id, decidedAt: new Date() },
        });
        await upsertLinkedBankTx(tx, "FUND", f.id, { date: todayUTC(), type: "OUT", amount, description: `عهدة لطلب ميداني #${r.id}: ${r.title}`, tenderId: r.tenderId });
      }
      await tx.fieldRequest.update({ where: { id }, data: { status: "FULFILLED", fulfilledAt: new Date(), fulfillNote: note } });
    });
    await notify([r.requesterId], { title: `تم صرف/توريد طلبك: ${r.title}`, body: `${fmtJOD(amount)} — ${REQUEST_PAYMENT[r.paymentMethod ?? ""] ?? ""}${note ? ` — ${note}` : ""}`, href: "/requests" }, { exclude: user.id });
    await auditEvent("workflow", "FieldRequest", `صرف الطلب #${id} — ${fmtJOD(amount)} — ${REQUEST_PAYMENT[r.paymentMethod ?? ""] ?? ""}`, user);
    refresh();
    return r.paymentMethod === "CASH" ? `صُرفت ${fmtJOD(amount)} عهدة لمدير المشروع` : "سُجل الطلب كمنفّذ — قيّد الشيك/الفاتورة في وحدتها";
  });
}

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { actionUser, assertTenderAccess } from "@/lib/auth";
import { auditEvent, run, runVoid, type ActionState } from "@/lib/action";
import { AppError, can } from "@/lib/permissions";
import { notify } from "@/lib/notify";
import { accountantIds, claimEvent, claimMessage } from "@/lib/claim-flow";
import { DISBURSE_STAGE } from "@/lib/labels";
import { fmtDate } from "@/lib/format";
import { formObject, zEnum, zOptDate, zOptText, zText } from "@/lib/validation";

const refresh = () => revalidatePath("/", "layout");
const AWAITING = ["DRAFT", "READY", "REVIEW"];

/**
 * الخطوة الثالثة (رفض الإدارة) — أو إرجاع المحاسب أثناء التدقيق — مع سبب واضح.
 * المطالبة تصبح «مرفوضة — معادة للتعديل»، ويُعاد الحصر المرتبط لمدير المشروع ليعدّله ويعيد تقديمها.
 */
export async function returnClaim(id: number, _: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await actionUser((r) => can.manageFinance(r) || can.approveClaims(r), { readOnlyOk: true });
    const mgmt = can.approveClaims(user.role);
    const reason = zText(mgmt ? "سبب الرفض" : "سبب الإرجاع").parse(fd.get("reason"));
    const c = await db.claim.findUnique({ where: { id }, include: { tender: { select: { id: true, name: true, managerId: true } } } });
    if (!c) throw new AppError("المطالبة غير موجودة");
    if (!AWAITING.includes(c.status)) throw new AppError("لا يمكن رفض مطالبة وافقت عليها الإدارة أو صُرفت");
    if (!mgmt && c.status !== "DRAFT") throw new AppError("المطالبة مرفوعة للإدارة — اسحبها للتعديل أولاً أو انتظر قرار الإدارة");
    const survey = await db.survey.findFirst({ where: { claimId: id } });
    const now = new Date();
    await db.$transaction(async (tx) => {
      await tx.claim.update({ where: { id }, data: { status: "RETURNED", returnReason: reason, returnedAt: now, readyAt: null } });
      if (survey) await tx.survey.update({ where: { id: survey.id }, data: { status: "DRAFT", submittedAt: null } });
    });
    const rejected = mgmt;
    await claimEvent(id, rejected ? "rejected" : "returned", user, reason);
    const to = [...(c.tender.managerId ? [c.tender.managerId] : []), ...(rejected ? await accountantIds() : [])];
    await claimMessage(
      user.id,
      to,
      c,
      `${rejected ? "رفض" : "إرجاع"} المطالبة رقم ${c.number} — ${c.tender.name}`,
      `${rejected ? "رفضت الإدارة" : "أعاد المحاسب"} المطالبة رقم ${c.number} للتعديل.\n\nالسبب: ${reason}\n\nافتح «تعديل المطالبة وإعادة الإرسال» لتعديل الكميات والحسومات ثم إعادة إرسالها للتدقيق.`,
      `/claims/new?tender=${c.tenderId}&claim=${c.id}`,
    );
    await auditEvent("workflow", "Claim", `${rejected ? "رفض الإدارة" : "إرجاع المحاسب"} للمطالبة رقم ${c.number} — ${c.tender.name} — السبب: ${reason}`, user, { recordId: id });
    refresh();
    return c.tender.managerId ? "أُعيدت المطالبة لمدير المشروع مع السبب" : "أُعيدت المطالبة للتعديل مع السبب";
  });
}

/** مطالبة معادة بلا حصر مرتبط (أنشأها المحاسب): يعيد المحاسب فتحها للتدقيق والتعديل */
export async function reopenClaim(id: number) {
  const result = await runVoid(async () => {
    const user = await actionUser(can.manageFinance);
    const c = await db.claim.findUnique({ where: { id } });
    if (!c || c.status !== "RETURNED") throw new AppError("المطالبة ليست معادة للتعديل");
    if (await db.survey.findFirst({ where: { claimId: id } })) throw new AppError("المطالبة مرتبطة بحصر — يعيد مدير المشروع تقديمها بعد تعديل الحصر");
    await db.claim.update({ where: { id }, data: { status: "DRAFT" } });
    await claimEvent(id, "reopened", user);
  });
  refresh();
  return result;
}

const disburseSchema = z.object({ stage: zEnum(DISBURSE_STAGE, "مرحلة الصرف"), date: zOptDate, note: zOptText });

/**
 * متابعة إجراءات الصرف بعد موافقة الإدارة — مدير المشروع المسند والمحاسب والإدارة.
 * «متوقفة — يوجد معيق» تُبلغ الإدارة والمحاسب فوراً وتتطلب توضيح المعيق.
 */
export async function updateDisbursement(id: number, _: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await actionUser(can.manageProjectLifecycle);
    const c = await db.claim.findUnique({ where: { id }, include: { tender: { select: { id: true, name: true } } } });
    if (!c) throw new AppError("المطالبة غير موجودة");
    await assertTenderAccess(user, c.tenderId);
    if (!["SUBMITTED", "APPROVED"].includes(c.status)) throw new AppError(c.status === "PAID" ? "المطالبة مصروفة" : "متابعة الصرف بعد موافقة الإدارة على المطالبة");
    const d = disburseSchema.parse(formObject(fd));
    if (d.stage === "BLOCKED" && !d.note) throw new AppError("وضّح المعيق الذي يوقف الصرف");
    const label = DISBURSE_STAGE[d.stage].label;
    const note = [d.date ? `بتاريخ ${fmtDate(d.date)}` : null, d.note].filter(Boolean).join(" — ") || null;
    await db.claim.update({ where: { id }, data: { disbursementStage: d.stage, disbursementNote: d.note, disbursementUpdatedAt: new Date() } });
    await claimEvent(id, "disbursement", user, `${label}${note ? ` — ${note}` : ""}`);
    if (d.stage === "BLOCKED") {
      await notify(["ADMIN", "ACCOUNTANT", { managerOf: c.tenderId }], { title: `معيق في صرف المطالبة رقم ${c.number}`, body: `${c.tender.name} — ${d.note}`, href: `/claims/${id}` }, { exclude: user.id });
    } else {
      await notify(["ADMIN", "ACCOUNTANT"], { title: `صرف المطالبة رقم ${c.number}: ${label}`, body: `${c.tender.name} — بواسطة ${user.name}`, href: `/claims/${id}` }, { exclude: user.id, email: false });
    }
    refresh();
    return `تم تحديث إجراءات الصرف: ${label}`;
  });
}

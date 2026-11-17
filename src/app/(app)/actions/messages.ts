"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { actionUser, assertTenderAccess } from "@/lib/auth";
import { auditEvent, run, runVoid, type ActionState } from "@/lib/action";
import { AppError } from "@/lib/permissions";
import { notify } from "@/lib/notify";
import { formObject, zOptId, zText } from "@/lib/validation";

const schema = z.object({
  recipientId: z.preprocess(Number, z.number({ invalid_type_error: "اختر المستلم" }).int().positive("اختر المستلم")),
  subject: zText("الموضوع"),
  body: zText("نص الرسالة"),
  tenderId: zOptId,
  claimId: zOptId,
  parentId: zOptId,
});

/** إرسال رسالة داخلية — يصل للمستلم إشعار فوري داخل النظام وبالبريد */
export async function sendMessage(_: ActionState, fd: FormData): Promise<ActionState> {
  let target = 0;
  const res = await run(async () => {
    const user = await actionUser(undefined, { readOnlyOk: true });
    const d = schema.parse(formObject(fd));
    if (d.recipientId === user.id) throw new AppError("لا يمكن مراسلة نفسك");
    const recipient = await db.user.findUnique({ where: { id: d.recipientId } });
    if (!recipient || !recipient.active) throw new AppError("المستلم غير موجود أو معطّل");
    if (d.parentId) {
      // الرد يرث ربط المحادثة الأصلية بالعطاء
      const parent = await db.message.findUnique({ where: { id: d.parentId } });
      if (!parent || (parent.senderId !== user.id && parent.recipientId !== user.id)) throw new AppError("الرسالة الأصلية غير متاحة");
      d.tenderId = parent.tenderId;
      d.claimId = parent.claimId;
    } else if (d.claimId) {
      // مراسلة حول مطالبة: لمن يملك الاطلاع على مشروعها
      const claim = await db.claim.findUnique({ where: { id: d.claimId }, select: { tenderId: true } });
      if (!claim) throw new AppError("المطالبة غير موجودة");
      await assertTenderAccess(user, claim.tenderId, { allowLocked: true });
      d.tenderId = claim.tenderId;
    } else if (d.tenderId) {
      await assertTenderAccess(user, d.tenderId, { allowLocked: true });
    }
    const m = await db.message.create({ data: { ...d, senderId: user.id } });
    await notify([recipient.id], { title: `رسالة من ${user.name}: ${d.subject}`, body: d.body.slice(0, 180), href: d.claimId ? `/claims/${d.claimId}#claim-messages` : `/messages/${m.id}` });
    // رسالة جديدة → فتح المحادثة؛ الرد ورسائل المطالبة → تبقى في نفس الصفحة مع رسالة تأكيد
    target = d.parentId || fd.get("stay") ? 0 : m.id;
    return `أُرسلت الرسالة إلى ${recipient.name}`;
  });
  revalidatePath("/", "layout");
  if (res.ok && target) redirect(`/messages/${target}`);
  return res;
}

/**
 * سياسة عدم الحذف: لا يستطيع المرسل ولا المستلم (مدير المشروع/المحاسب) حذف أي رسالة.
 * الحذف للمدير العام فقط، ويُسجل في سجل الرقابة.
 */
export async function deleteMessage(id: number) {
  const result = await runVoid(async () => {
    const user = await actionUser();
    if (user.role !== "ADMIN") throw new AppError("حذف المراسلات للمدير العام فقط");
    const m = await db.message.findUnique({ where: { id }, include: { sender: { select: { name: true } }, recipient: { select: { name: true } } } });
    if (!m) throw new AppError("الرسالة غير موجودة");
    await db.message.delete({ where: { id } });
    await auditEvent("delete", "Message", `حذف رسالة #${id} من ${m.sender.name} إلى ${m.recipient.name}: «${m.subject}»`, user);
  });
  revalidatePath("/", "layout");
  return result;
}

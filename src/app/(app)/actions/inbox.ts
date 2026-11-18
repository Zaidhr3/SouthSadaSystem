"use server";

import { revalidatePath } from "next/cache";
import { actionUser } from "@/lib/auth";
import { auditEvent } from "@/lib/action";
import { can } from "@/lib/permissions";
import { conversationToQuote, conversations, sendReply, suggestInboxReply } from "@/lib/inbox";

export type InboxState = { error?: string; ok?: string; suggestion?: string; quoteId?: number };
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function findConv(platform: "messenger" | "instagram", convId: string) {
  const list = await conversations(platform, 50);
  const c = list.find((x) => x.id === convId);
  if (!c) throw new Error("المحادثة غير موجودة — حدّث الصفحة");
  return c;
}

export async function suggestInboxAction(platform: "messenger" | "instagram", convId: string, _: InboxState, __: FormData): Promise<InboxState> {
  try {
    await actionUser(can.manageMarketing);
    return { suggestion: await suggestInboxReply((await findConv(platform, convId)).messages) };
  } catch (e) {
    return { error: `تعذر الاقتراح: ${msg(e)}` };
  }
}

export async function sendInboxAction(platform: "messenger" | "instagram", recipientId: string, _: InboxState, fd: FormData): Promise<InboxState> {
  try {
    const user = await actionUser(can.manageMarketing);
    const text = String(fd.get("message") ?? "").trim();
    if (!text) return { error: "اكتب الرد" };
    await sendReply(recipientId, text);
    await auditEvent("CREATE", "Inbox", `رد على رسالة ${platform === "messenger" ? "ماسنجر" : "إنستغرام"}`, user);
    revalidatePath("/marketing/inbox");
    return { ok: "أُرسل الرد ✓" };
  } catch (e) {
    const m = msg(e);
    return { error: /24|window|outside/i.test(m) ? "انتهت نافذة الـ24 ساعة لهذه المحادثة — تواصل مع العميل هاتفياً أو انتظر رسالته التالية" : `لم يُرسل: ${m}` };
  }
}

export async function inboxToQuoteAction(platform: "messenger" | "instagram", convId: string, _: InboxState, __: FormData): Promise<InboxState> {
  try {
    const user = await actionUser(can.manageMarketing);
    const q = await conversationToQuote(await findConv(platform, convId), user.id);
    revalidatePath("/quotes");
    return { ok: `أُنشئ طلب التسعير ${q.ref} ووُجّه لمدراء المشاريع`, quoteId: q.id };
  } catch (e) {
    return { error: `تعذر التحويل: ${msg(e)}` };
  }
}

"use server";

import { revalidatePath } from "next/cache";
import { actionUser } from "@/lib/auth";
import { auditEvent, run, runVoid, type ActionState } from "@/lib/action";
import { AppError, can } from "@/lib/permissions";
import { checkMeta, connectMeta, MetaError, replyToComment } from "@/lib/meta";
import { deleteSecret } from "@/lib/secret-box";
import { humanizeClean } from "@/lib/content-skills/humanizer";
import { runSkill } from "@/lib/content-skills/skills";

const t = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const metaMsg = (e: unknown) => (e instanceof MetaError ? e.message : e instanceof Error ? e.message : "خطأ غير متوقع");

/** ربط الصفحة: الرمز يُشفّر ولا يُعرض مجدداً ولا يدخل سجل الرقابة (يُسجّل الحدث فقط) */
export async function connectMetaAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = await run(async () => {
    const user = await actionUser(can.manageSettings);
    const token = t(fd, "token");
    if (!token) throw new AppError("الصق رمز الوصول");
    try {
      const st = await connectMeta({ token, pageId: t(fd, "pageId") || undefined, appId: t(fd, "appId") || undefined, appSecret: t(fd, "appSecret") || undefined }, user.name);
      await auditEvent("CONNECT", "Integration", `ربط صفحة فيسبوك «${st.pageName}»${st.igUsername ? ` وإنستغرام @${st.igUsername}` : ""}`, user);
      return `تم الربط: ${st.pageName}${st.missingScopes?.length ? ` — ⚠️ صلاحيات ناقصة: ${st.missingScopes.join(", ")}` : ""}${st.igUsername ? ` + إنستغرام @${st.igUsername}` : " — لا يوجد حساب إنستغرام أعمال مرتبط بالصفحة"}${st.expiresAt ? ` — تنتهي صلاحية الرمز ${new Date(st.expiresAt).toLocaleDateString("en-GB")}` : " — رمز دائم"}`;
    } catch (e) {
      throw new AppError(`فشل الربط: ${metaMsg(e)}`);
    }
  });
  revalidatePath("/system");
  revalidatePath("/marketing");
  return r;
}

export async function checkMetaAction(_: ActionState, __: FormData): Promise<ActionState> {
  const r = await run(async () => {
    await actionUser(can.manageSettings);
    const st = await checkMeta();
    if (!st.ok) throw new AppError(`الاتصال لا يعمل: ${st.error}`);
    return `الاتصال سليم: ${st.pageName}${st.igUsername ? ` + @${st.igUsername}` : ""}`;
  });
  revalidatePath("/system");
  return r;
}

export async function disconnectMeta() {
  const r = await runVoid(async () => {
    const user = await actionUser(can.manageSettings);
    await deleteSecret("meta");
    await auditEvent("DISCONNECT", "Integration", "فصل ربط فيسبوك/إنستغرام", user);
  });
  revalidatePath("/system");
  revalidatePath("/marketing");
  return r;
}

export type ReplyState = { error?: string; ok?: string; suggestion?: string };

/** الرد على تعليق مباشرة من النظام (يمر بالمؤنسن قبل الإرسال) */
export async function replyCommentAction(itemId: number, platform: "facebook" | "instagram", commentId: string, _: ReplyState, fd: FormData): Promise<ReplyState> {
  try {
    const user = await actionUser(can.manageMarketing);
    const text = humanizeClean(t(fd, "message")).text.trim();
    if (!text) return { error: "اكتب الرد" };
    if (text.length > 2000) return { error: "الرد طويل جداً" };
    await replyToComment(platform, commentId, text);
    await auditEvent("REPLY", "MarketingItem", `رد على تعليق ${platform === "facebook" ? "فيسبوك" : "إنستغرام"}: ${text.slice(0, 120)}`, user, { recordId: itemId });
    revalidatePath(`/marketing/${itemId}`);
    return { ok: "أُرسل الرد" };
  } catch (e) {
    return { error: e instanceof AppError ? e.message : `لم يُرسل: ${metaMsg(e)}` };
  }
}

/** اقتراح رد ذكي على تعليق واحد (مهارة li-reply) */
export async function suggestReplyAction(comment: { author: string; text: string; post: string }, _: ReplyState, __: FormData): Promise<ReplyState> {
  try {
    await actionUser(can.manageMarketing);
    const r = await runSkill("reply", { text: `منشورنا: ${comment.post.slice(0, 600)}\n\nالتعليق:\n${comment.author}: ${comment.text}\n\nأعطني الرد الجاهز فقط (بلا فرز ولا عناوين).` });
    return { suggestion: r.text.replace(/^.*?:\s*/s, (m) => (m.length < 40 ? "" : m)).trim() };
  } catch (e) {
    return { error: `تعذر الاقتراح: ${metaMsg(e)}` };
  }
}

/** مراجعة المحتوى الحالي على الصفحة وإنشاء مقترحات التحسين */
export async function runPageAuditAction(_: ActionState, __: FormData): Promise<ActionState> {
  const r = await run(async () => {
    const user = await actionUser(can.manageMarketing);
    const { auditPage } = await import("@/lib/page-audit");
    try {
      const a = await auditPage(user.id);
      if (!a.fetched && a.errors.length) throw new AppError(a.errors.join(" | "));
      return `سُحب ${a.fetched} منشوراً — جُهّزت ${a.reviewed} مراجعة (${a.kept} جيدة كما هي)${a.skipped ? `، و${a.skipped} رُوجعت سابقاً` : ""}${a.errors.length ? ` — تنبيه: ${a.errors.join(" | ")}` : ""}`;
    } catch (e) {
      throw e instanceof AppError ? e : new AppError(`تعذرت المراجعة: ${metaMsg(e)}`);
    }
  });
  revalidatePath("/marketing");
  return r;
}

/** تطبيق الصياغة المحسّنة على منشور فيسبوك القائم */
export async function applyFacebookEdit(itemId: number, _: ActionState, __: FormData): Promise<ActionState> {
  const r = await run(async () => {
    const user = await actionUser(can.manageMarketing);
    const { applyToFacebook } = await import("@/lib/page-audit");
    try {
      await applyToFacebook(itemId);
    } catch (e) {
      throw new AppError(`لم يُعدَّل: ${metaMsg(e)}`);
    }
    await auditEvent("UPDATE", "MarketingItem", "تعديل نص منشور قائم على فيسبوك", user, { recordId: itemId });
    return "عُدّل المنشور على فيسبوك";
  });
  revalidatePath(`/marketing/${itemId}`);
  revalidatePath("/marketing");
  return r;
}

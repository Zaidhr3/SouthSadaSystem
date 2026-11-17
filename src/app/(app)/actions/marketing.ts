"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { actionUser } from "@/lib/auth";
import { run, runVoid, type ActionState } from "@/lib/action";
import { AppError, can } from "@/lib/permissions";
import { saveAttachments, validateAttachments } from "@/lib/uploads";
import { brainstorm, eventPost, fromIdea, MKT_CATEGORY, refineItem, suggestWeek } from "@/lib/marketing";
import { metaConfigured } from "@/lib/meta";
import { publishItem } from "@/lib/marketing-publish";
import { humanizeClean } from "@/lib/content-skills/humanizer";
import { checkFacts } from "@/lib/content-skills/fact-guard";
import { knownNames } from "@/lib/content-skills/known-names";
import { runSkill, SKILLS, type SkillId } from "@/lib/content-skills/skills";

const t = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const done = (id?: number) => {
  revalidatePath("/marketing");
  if (id) revalidatePath(`/marketing/${id}`);
};
const aiError = (e: unknown) => {
  throw new AppError(e instanceof Error ? `تعذر توليد المحتوى: ${e.message}` : "تعذر توليد المحتوى");
};

export async function generateWeek(_: ActionState, __: FormData): Promise<ActionState> {
  const r = await run(async () => {
    const user = await actionUser(can.manageMarketing);
    const items = await suggestWeek(user.id).catch(aiError);
    const failed = "failed" in items ? (items.failed as string[]) : [];
    if (!items.length) return "خطة الأسبوع مكتملة مسبقاً — لا ينقصها منشورات أو قصص";
    return `جُهّز ${items.length} عنصراً (منشورات وقصص) للأسبوع القادم — راجعها في الجدول${failed.length ? ` (تعذّر جزء: ${failed.join("؛ ")} — اضغط مجدداً لإكماله)` : ""}`;
  });
  done();
  return r;
}

/** عصف أفكار سريع: 6 أفكار بصيغ تسويقية حديثة مختلفة */
export async function generateBrainstorm(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = await run(async () => {
    const user = await actionUser(can.manageMarketing);
    const items = await brainstorm(t(fd, "focus").slice(0, 300), user.id).catch(aiError);
    return `وُلدت ${items.length} أفكار بصيغ حديثة (ريل، قبل/بعد، كاروسيل، خرافة/حقيقة، كواليس، سلسلة) — تجدها في «بانتظار المراجعة»`;
  });
  done();
  return r;
}

export async function generateFromIdea(_: ActionState, fd: FormData): Promise<ActionState> {
  let firstId = 0;
  const r = await run(async () => {
    const user = await actionUser(can.manageMarketing);
    const idea = t(fd, "idea");
    if (idea.length < 5) throw new AppError("اكتب الفكرة بجملة على الأقل");
    const kind = (["POST", "STORY", "BOTH"].includes(t(fd, "kind")) ? t(fd, "kind") : "BOTH") as "POST" | "STORY" | "BOTH";
    const items = await fromIdea(idea, kind, user.id).catch(aiError);
    firstId = items[0]?.id ?? 0;
    return "صيغت الفكرة";
  });
  if (r.ok && firstId) redirect(`/marketing/${firstId}`);
  done();
  return r;
}

export async function generateEvent(_: ActionState, fd: FormData): Promise<ActionState> {
  let firstId = 0;
  const r = await run(async () => {
    const user = await actionUser(can.manageMarketing);
    const type = t(fd, "type") as "CONGRATS" | "CONDOLENCE" | "DENOUNCE";
    if (!["CONGRATS", "CONDOLENCE", "DENOUNCE"].includes(type)) throw new AppError("اختر نوع الحدث");
    const details = t(fd, "details");
    if (details.length < 8) throw new AppError("اكتب تفاصيل الحدث (الأسماء والصفات كما يجب أن تُذكر)");
    const items = await eventPost(type, details, user.id).catch(aiError);
    firstId = items[0]?.id ?? 0;
    return "صيغ المحتوى";
  });
  if (r.ok && firstId) redirect(`/marketing/${firstId}`);
  done();
  return r;
}

export async function chatOnItem(id: number, _: ActionState, fd: FormData): Promise<ActionState> {
  const r = await run(async () => {
    const user = await actionUser(can.manageMarketing);
    const msg = t(fd, "message");
    if (!msg) throw new AppError("اكتب طلبك");
    const it = await db.marketingItem.findUnique({ where: { id }, select: { status: true } });
    if (!it) throw new AppError("العنصر غير موجود");
    if (it.status === "PUBLISHED") throw new AppError("العنصر منشور — أنشئ نسخة جديدة بدلاً من التعديل");
    return await refineItem(id, msg, user.name).catch(aiError);
  });
  done(id);
  return r;
}

export async function saveItem(id: number, _: ActionState, fd: FormData): Promise<ActionState> {
  const r = await run(async () => {
    const user = await actionUser(can.manageMarketing);
    const it = await db.marketingItem.findUnique({ where: { id } });
    if (!it) throw new AppError("العنصر غير موجود");
    if (it.status === "PUBLISHED") throw new AppError("العنصر منشور ولا يُعدّل");
    const caption = t(fd, "caption");
    if (!caption) throw new AppError("النص مطلوب");
    await validateAttachments(fd, user.id);
    const sched = t(fd, "scheduledFor");
    await db.marketingItem.update({
      where: { id },
      data: {
        kind: t(fd, "kind") === "STORY" ? "STORY" : "POST",
        category: t(fd, "category") in MKT_CATEGORY ? t(fd, "category") : it.category,
        title: t(fd, "title") || it.title,
        caption,
        hashtags: t(fd, "hashtags") || null,
        storyText: t(fd, "storyText") || null,
        visualBrief: t(fd, "visualBrief") || null,
        cta: t(fd, "cta") || null,
        scheduledFor: sched ? new Date(sched) : null,
        status: it.status === "SUGGESTED" ? "IN_REVIEW" : it.status === "FAILED" ? "APPROVED" : it.status,
      },
    });
    const n = await saveAttachments(fd, "marketing", id, user.id);
    if (n) {
      const img = await db.attachment.findFirst({ where: { entityType: "marketing", entityId: id, mimeType: { startsWith: "image/" } }, orderBy: { id: "desc" } });
      if (img) await db.marketingItem.update({ where: { id }, data: { imageAttachmentId: img.id } });
    }
    return "حُفظت التعديلات";
  });
  done(id);
  return r;
}

/** اعتماد الإدارة ثم النشر: تلقائي عبر Meta إن كان مربوطاً، وإلا يبقى «معتمداً — جاهز للنشر اليدوي» */
/** اعتماد الإدارة ثم النشر: فوراً، أو مجدولاً في موعده (المهمة اليومية تنشره تلقائياً) */
export async function approveAndPublish(id: number, _: ActionState, fd: FormData): Promise<ActionState> {
  const r = await run(async () => {
    const user = await actionUser(can.manageMarketing);
    const it = await db.marketingItem.findUnique({ where: { id } });
    if (!it) throw new AppError("العنصر غير موجود");
    if (it.status === "PUBLISHED") throw new AppError("منشور مسبقاً");
    if (it.kind === "STORY" && !it.imageAttachmentId) throw new AppError("القصة تحتاج صورة تصميم قبل الاعتماد — ارفعها من «التحرير اليدوي»");
    const connected = await metaConfigured();
    const schedule = fd.get("mode") === "schedule";
    const at = schedule ? new Date(String(fd.get("publishAt") || "")) : null;
    if (schedule && (!at || isNaN(+at) || +at < Date.now() - 60_000)) throw new AppError("اختر موعد نشر في المستقبل");
    await db.marketingItem.update({ where: { id }, data: { status: "APPROVED", approvedById: user.id, approvedAt: new Date(), publishAt: at } });
    if (!connected) return "اعتُمد — النشر التلقائي غير مربوط بعد: اربط الصفحة من «إعدادات النظام»، أو انشره يدوياً ثم اضغط «تم النشر يدوياً»";
    if (schedule) return `اعتُمد وجُدول — يُنشر تلقائياً في ${at!.toLocaleDateString("en-GB")} مع المهمة الصباحية`;
    const p = await publishItem(id);
    if (!p.ok) throw new AppError(`اعتُمد لكن النشر فشل: ${p.message}`);
    return p.message;
  });
  done(id);
  return r;
}

/** إعادة محاولة نشر عنصر فشل نشره */
export async function retryPublish(id: number, _: ActionState, __: FormData): Promise<ActionState> {
  const r = await run(async () => {
    await actionUser(can.manageMarketing);
    const p = await publishItem(id);
    if (!p.ok) throw new AppError(p.message);
    return p.message;
  });
  done(id);
  return r;
}

export async function setItemStatus(id: number, status: "PUBLISHED" | "REJECTED" | "IN_REVIEW") {
  const r = await runVoid(async () => {
    const user = await actionUser(can.manageMarketing);
    await db.marketingItem.update({ where: { id }, data: { status, ...(status === "PUBLISHED" ? { publishedAt: new Date(), publishLog: `نُشر يدوياً — ${user.name}` } : {}) } });
  });
  done(id);
  return r;
}

export async function deleteItem(id: number) {
  const r = await runVoid(async () => {
    await actionUser(can.manageMarketing);
    await db.marketingItem.delete({ where: { id } });
  });
  done();
  return r;
}

export type SkillState = { factWarning?: string; error?: string; text?: string; caption?: string; options?: { label: string; text: string }[]; at?: number };

/** تشغيل مهارة محتوى (المؤنسن، الخطافات، الكاروسيل، الردود...) على عنصر أو على نص حر */
export async function runSkillAction(skillId: SkillId, itemId: number | null, _: SkillState, fd: FormData): Promise<SkillState> {
  try {
    await actionUser(can.manageMarketing);
    const def = SKILLS.find((s) => s.id === skillId);
    if (!def) return { error: "مهارة غير معروفة" };
    if (def.scope === "item") {
      const it = itemId ? await db.marketingItem.findUnique({ where: { id: itemId } }) : null;
      if (!it) return { error: "العنصر غير موجود" };
      return { ...(await runSkill(skillId, { caption: it.caption, kind: it.kind })), at: Date.now() };
    }
    const text = String(fd.get("text") ?? "").trim();
    if (text.length < 10) return { error: `الصق ${def.inputLabel ?? "النص"} أولاً` };
    if (text.length > 30_000) return { error: "النص طويل جداً (الحد 30 ألف حرف)" };
    return { ...(await runSkill(skillId, { text })), at: Date.now() };
  } catch (e) {
    return { error: e instanceof AppError ? e.message : `تعذر تشغيل المهارة: ${e instanceof Error ? e.message : ""}` };
  }
}

/** اعتماد نسخة جديدة من النص (ناتج مهارة) — تُحفظ النسخة السابقة في سجل المحادثة */
export async function applyCaption(id: number, _: ActionState, fd: FormData): Promise<ActionState> {
  const r = await run(async () => {
    const user = await actionUser(can.manageMarketing);
    const it = await db.marketingItem.findUnique({ where: { id } });
    if (!it) throw new AppError("العنصر غير موجود");
    if (it.status === "PUBLISHED") throw new AppError("العنصر منشور ولا يُعدّل");
    const caption = humanizeClean(String(fd.get("caption") ?? "")).text.trim();
    if (!caption) throw new AppError("النص فارغ");
    // حارس الحقائق: لا يُعتمد نص فقد رقماً أو اسماً من الأصل أو أضاف رقماً جديداً (إلا بتأكيد صريح)
    if (fd.get("force") !== "1") {
      const fc = checkFacts(it.caption, caption, await knownNames());
      if (!fc.ok) throw new AppError(`حارس الحقائق أوقف الاعتماد — ${[fc.missing.length ? `مفقود: ${fc.missing.join("، ")}` : "", fc.added.length ? `مضاف: ${fc.added.join("، ")}` : ""].filter(Boolean).join(" | ")}. عدّل النص يدوياً إن كان التغيير مقصوداً.`);
    }
    const chat = (Array.isArray(it.chat) ? it.chat : []) as unknown[];
    const skill = String(fd.get("skill") ?? "مهارة");
    await db.marketingItem.update({
      where: { id },
      data: { caption, status: it.status === "SUGGESTED" ? "IN_REVIEW" : it.status, chat: [...chat, { role: "assistant", text: `طُبّق ناتج «${skill}» بواسطة ${user.name}. النسخة السابقة:
${it.caption}`, at: new Date().toISOString() }] as never },
    });
    return "طُبّق النص الجديد";
  });
  done(id);
  return r;
}

/** التنظيف الآلي فقط (بلا ذكاء اصطناعي): المحارف الخفية والطباعة والحشو */
export async function autoClean(id: number) {
  const r = await runVoid(async () => {
    await actionUser(can.manageMarketing);
    const it = await db.marketingItem.findUnique({ where: { id } });
    if (!it || it.status === "PUBLISHED") throw new AppError("لا يمكن تعديل هذا العنصر");
    await db.marketingItem.update({ where: { id }, data: { caption: humanizeClean(it.caption).text, storyText: it.storyText ? humanizeClean(it.storyText).text : null } });
  });
  done(id);
  return r;
}

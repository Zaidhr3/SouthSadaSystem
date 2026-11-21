"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { actionUser } from "@/lib/auth";
import { auditEvent } from "@/lib/action";
import { can } from "@/lib/permissions";
import { analyzeStudio, sanitizePlan, INTENTS, type StudioPlan } from "@/lib/design/studio";
import { geminiConfigured } from "@/lib/ai/gemini";

/**
 * استوديو الصور الذكي — مسار منظم بخطوات:
 *   1+2) studioAnalyze: فهم النية + الخطة الإبداعية (نص فقط — بلا تكلفة صور)
 *   ⏸  إذن البدء: الواجهة تعرض الخطة وتنتظر «ابدأ التنفيذ» (أو موافقة تلقائية يفعّلها المستخدم بنفسه)
 *   3)   studioGenerate: توليد الصورة (خدمة Gemini للصور — لها تكلفة) + فحص العبارة + تركيبها بقالب الهوية
 *   4)   معاينة ← تعديل وإعادة توليد (studioRefine) أو حفظ/تنزيل/فتح للنشر — النشر نفسه يبقى باعتماد منفصل في صفحة العنصر
 * مفاتيح الخدمات على الخادم فقط؛ الواجهة لا ترى إلا الخطة والنتيجة.
 */
type R<T> = { ok: true; data: T } | { ok: false; error: string };
const fail = (e: unknown): { ok: false; error: string } => ({ ok: false, error: e instanceof Error ? e.message : "حدث خطأ غير متوقع" });

export async function studioAnalyze(prompt: string, format: "POST" | "STORY"): Promise<R<StudioPlan>> {
  try {
    await actionUser(can.manageMarketing);
    const p = prompt.trim();
    if (p.length < 2) throw new Error("اكتب طلبك بكلمة أو جملة (مثلاً: جمعة مباركة)");
    if (!geminiConfigured()) throw new Error("خدمة الذكاء الاصطناعي غير مضبوطة على الخادم");
    return { ok: true, data: await analyzeStudio(p.slice(0, 600), format === "STORY" ? "STORY" : "POST") };
  } catch (e) {
    return fail(e);
  }
}

export async function studioRefine(previous: StudioPlan, change: string): Promise<R<StudioPlan>> {
  try {
    await actionUser(can.manageMarketing);
    const prev = sanitizePlan(previous);
    if (change.trim().length < 2) throw new Error("اكتب التعديل المطلوب");
    return { ok: true, data: await analyzeStudio(prev.prompt, prev.format, { previous: prev, change: change.trim().slice(0, 400) }) };
  } catch (e) {
    return fail(e);
  }
}

export type StudioResult = { itemId: number; slides: number[]; baked: boolean; phrase: string; ms: number };

/** الخطوة 3 — لا تُستدعى إلا بعد «ابدأ التنفيذ» */
export async function studioGenerate(raw: StudioPlan, itemId: number | null): Promise<R<StudioResult>> {
  const started = Date.now();
  try {
    const user = await actionUser(can.manageMarketing);
    const plan = sanitizePlan(raw);
    if (!plan.concept) throw new Error("الخطة ناقصة — أعد التحليل");
    let id = itemId;
    if (id) {
      const it = await db.marketingItem.findUnique({ where: { id }, select: { status: true } });
      if (!it || it.status === "PUBLISHED") id = null;
    }
    if (!id) {
      const it = await db.marketingItem.create({
        data: { kind: plan.format, source: "USER", category: INTENTS[plan.intent].category, title: plan.title, idea: plan.prompt, caption: plan.caption || plan.phrase || plan.title, storyText: plan.phrase || null, visualBrief: plan.concept, status: "IN_REVIEW", createdById: user.id },
      });
      id = it.id;
    } else {
      await db.marketingItem.update({ where: { id }, data: { title: plan.title, caption: plan.caption || undefined, storyText: plan.phrase || null, visualBrief: plan.concept } });
    }
    const { renderScene } = await import("@/lib/design/scene");
    const { composeItem, itemSlides } = await import("@/lib/design/compose");
    const r = await renderScene({ phrase: plan.phrase, concept: plan.concept, mood: plan.mood }, plan.format === "STORY" ? "9:16" : "4:5", user.id, { title: plan.phrase || plan.title });
    await composeItem(id, { template: "scene", mediaIds: [r.assetId], headline: plan.phrase || plan.title, bakedText: r.baked }, user.id);
    await auditEvent("AI_IMAGE", "MarketingItem", `استوديو الصور: «${plan.prompt.slice(0, 80)}» (${plan.intentLabel})`, user, { recordId: id });
    revalidatePath("/marketing");
    revalidatePath(`/marketing/${id}`);
    return { ok: true, data: { itemId: id, slides: await itemSlides(id), baked: r.baked, phrase: plan.phrase, ms: Date.now() - started } };
  } catch (e) {
    return fail(e);
  }
}

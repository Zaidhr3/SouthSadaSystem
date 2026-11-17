import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { geminiConfigured, generateJson } from "./gemini";

/**
 * كاتب المحتوى الذكي (التسويق، فحص الطلبات الوهمية): Claude أولاً (ANTHROPIC_API_KEY)، وإن لم يُضبط فـ Gemini.
 * المخرجات دائماً JSON مطابق للمخطط (Structured Outputs).
 */
export const CLAUDE_MODEL = () => process.env.ANTHROPIC_MODEL || "claude-opus-5-5";
export const claudeConfigured = () => !!process.env.ANTHROPIC_API_KEY;
export const writerConfigured = () => claudeConfigured() || geminiConfigured();
export const writerName = () => (claudeConfigured() ? `Claude (${CLAUDE_MODEL()})` : geminiConfigured() ? "Gemini" : null);

/** مخطط JSON بسيط (object/array/string/number/boolean/enum) — يُكيَّف لكل مزود */
export type JsonSchema = {
  type: "object" | "array" | "string" | "number" | "integer" | "boolean";
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: string[];
  description?: string;
};

/** Claude يشترط additionalProperties:false وكل الحقول مطلوبة في المخرجات المهيكلة */
function forClaude(s: JsonSchema): Record<string, unknown> {
  if (s.type === "object") {
    const props = Object.fromEntries(Object.entries(s.properties ?? {}).map(([k, v]) => [k, forClaude(v)]));
    return { type: "object", properties: props, required: Object.keys(props), additionalProperties: false, ...(s.description ? { description: s.description } : {}) };
  }
  if (s.type === "array") return { type: "array", items: forClaude(s.items!), ...(s.description ? { description: s.description } : {}) };
  return { ...s };
}

/** Gemini يعتبر الحقول اختيارية ما لم تُذكر في required — فيُسقط أحياناً الحقل الأهم (النص). كلها مطلوبة وبترتيبها المكتوب */
function forGemini(s: JsonSchema): Record<string, unknown> {
  if (s.type === "object") {
    const props = Object.fromEntries(Object.entries(s.properties ?? {}).map(([k, v]) => [k, forGemini(v)]));
    return { type: "object", properties: props, required: s.required ?? Object.keys(props), propertyOrdering: Object.keys(props), ...(s.description ? { description: s.description } : {}) };
  }
  if (s.type === "array") return { type: "array", items: forGemini(s.items!), ...(s.description ? { description: s.description } : {}) };
  return { ...s };
}

let client: Anthropic | null = null;
const anthropic = () => (client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 120_000, maxRetries: 1 }));

export type Turn = { role: "user" | "assistant"; text: string };

/**
 * timeoutMs: الميزانية الزمنية الكاملة للاستدعاء (تبقى أقل من maxDuration للصفحة حتى لا تنقطع الدالة على Vercel).
 * effort يتحكم أيضاً بعمق «تفكير» Gemini: low = سريع للمحتوى القصير.
 */
export async function writeJson<T>(opts: { system: string; turns: Turn[]; schema: JsonSchema; effort?: "low" | "medium" | "high"; timeoutMs?: number; maxTokens?: number }): Promise<{ data: T; model: string }> {
  const timeoutMs = opts.timeoutMs ?? 100_000;
  if (claudeConfigured()) {
    const res = await anthropic().beta.messages.create({
      model: CLAUDE_MODEL(),
      max_tokens: opts.maxTokens ?? 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: opts.system,
      output_config: { effort: opts.effort ?? "medium", format: { type: "json_schema", schema: forClaude(opts.schema) } },
      messages: opts.turns.map((t) => ({ role: t.role, content: t.text })),
    } as Anthropic.Beta.MessageCreateParamsNonStreaming, { timeout: timeoutMs, maxRetries: timeoutMs > 60_000 ? 1 : 0 });
    if (res.stop_reason === "refusal") throw new Error("اعتذر النموذج عن صياغة هذا المحتوى — عدّل الفكرة وحاول مجدداً");
    if (res.stop_reason === "max_tokens") throw new Error("المحتوى أطول من المسموح — اختصر الطلب");
    const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    try {
      return { data: JSON.parse(text) as T, model: res.model };
    } catch {
      throw new Error("أرجع النموذج بيانات غير صالحة — حاول مجدداً");
    }
  }
  if (!geminiConfigured()) throw new Error("لا يوجد مزود ذكاء اصطناعي مضبوط — أضف ANTHROPIC_API_KEY على الخادم");
  // Gemini: المحادثة تُدمج نصاً واحداً (مع الحفاظ على الأدوار)
  const transcript = opts.turns.length === 1 ? opts.turns[0].text : opts.turns.map((t) => `${t.role === "user" ? "### المستخدم" : "### ردك السابق"}\n${t.text}`).join("\n\n");
  const r = await generateJson<T>({ system: opts.system, parts: [{ text: transcript }], schema: forGemini(opts.schema), temperature: 0.7, timeoutMs, maxOutputTokens: opts.maxTokens ?? 12_000, thinking: opts.effort === "high" ? "low" : "minimal" });
  return { data: r.data, model: r.model };
}

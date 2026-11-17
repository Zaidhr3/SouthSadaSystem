import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { db } from "../db";
import type { AppUser } from "../permissions";
import { CLAUDE_MODEL, claudeConfigured } from "../ai/writer";
import { geminiConfigured, geminiModel } from "../ai/gemini";
import { TOOLS, toolByName } from "./tools";
import { SYSTEM_KNOWLEDGE } from "./knowledge";
import { skillsPrompt } from "./skills";

/**
 * مساعد النظام الذكي: وكيل يفهم النظام من الألف إلى الياء ويستخدم الأدوات بنفسه
 * (بنية القاعدة، استعلامات قراءة فقط، التنبيهات، المالية، فحص السلامة، الحسابات، سجل المشاكل).
 * Claude إن ضُبط ANTHROPIC_API_KEY، وإلا Gemini باستدعاء الدوال — بنفس الأدوات والسلوك.
 */
export type ToolLog = { name: string; args: Record<string, unknown>; ms: number; ok: boolean; error?: string };
type Turn = { role: "user" | "assistant"; text: string };

const MAX_STEPS = 12;
const BUDGET_MS = 110_000;

async function systemPrompt(user: AppUser) {
  const today = new Date().toLocaleDateString("en-GB", { timeZone: "Asia/Amman" });
  return `${SYSTEM_KNOWLEDGE}

المستخدم الحالي: ${user.name} (الدور: ${user.role}). تاريخ اليوم (عمّان): ${today}.${await skillsPrompt("assistant")}`;
}

async function runTool(name: string, args: Record<string, unknown>, user: AppUser, log: ToolLog[]) {
  const t = toolByName(name);
  const started = Date.now();
  if (!t) {
    log.push({ name, args, ms: 0, ok: false, error: "أداة غير معروفة" });
    return { error: `أداة غير معروفة: ${name}` };
  }
  try {
    const out = await t.run(args ?? {}, user);
    log.push({ name, args, ms: Date.now() - started, ok: true });
    const s = JSON.stringify(out);
    // حد حجم النتيجة حتى لا يغرق السياق
    return s.length > 24_000 ? { truncated: true, data: s.slice(0, 24_000) } : out;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.push({ name, args, ms: Date.now() - started, ok: false, error: msg.slice(0, 300) });
    return { error: msg };
  }
}

/* ───────────── Claude ───────────── */
let client: Anthropic | null = null;
const anthropic = () => (client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 90_000, maxRetries: 1 }));

async function runClaude(system: string, history: Turn[], user: AppUser, log: ToolLog[], started: number) {
  const tools = TOOLS.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
  const messages: Anthropic.MessageParam[] = history.map((h) => ({ role: h.role, content: h.text }));
  for (let step = 0; step < MAX_STEPS; step++) {
    const res = await anthropic().messages.create({
      model: CLAUDE_MODEL(),
      max_tokens: 8000,
      system,
      tools: tools as Anthropic.Tool[],
      thinking: { type: "adaptive" },
      messages,
    } as Anthropic.MessageCreateParamsNonStreaming);
    messages.push({ role: "assistant", content: res.content });
    const calls = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
    if (res.stop_reason !== "tool_use" || !calls.length || Date.now() - started > BUDGET_MS) return { text: text || "لم أصل لإجابة — أعد صياغة السؤال.", model: res.model };
    const results = await Promise.all(calls.map(async (c) => ({ type: "tool_result" as const, tool_use_id: c.id, content: JSON.stringify(await runTool(c.name, c.input as Record<string, unknown>, user, log)) })));
    messages.push({ role: "user", content: results });
  }
  return { text: "توقفت بعد عدد كبير من الخطوات — جزّئ الطلب.", model: CLAUDE_MODEL() };
}

/* ───────────── Gemini ───────────── */
type GPart = { text?: string; functionCall?: { name: string; args?: Record<string, unknown> }; functionResponse?: { name: string; response: unknown }; thoughtSignature?: string; thought?: boolean };
type GContent = { role: "user" | "model"; parts: GPart[] };

async function runGemini(system: string, history: Turn[], user: AppUser, log: ToolLog[], started: number) {
  const model = process.env.ASSISTANT_GEMINI_MODEL || geminiModel();
  const decls = TOOLS.map((t) => ({ name: t.name, description: t.description, ...(Object.keys(t.parameters.properties).length ? { parameters: t.parameters } : {}) }));
  const contents: GContent[] = history.map((h) => ({ role: h.role === "user" ? "user" : "model", parts: [{ text: h.text }] }));
  for (let step = 0; step < MAX_STEPS; step++) {
    const left = BUDGET_MS - (Date.now() - started);
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY || "" },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents, tools: [{ functionDeclarations: decls }], generationConfig: { temperature: 0.3, maxOutputTokens: 8192, ...(/^gemini-[3-9]/.test(model) ? { thinkingConfig: { thinkingLevel: "low" } } : {}) } }),
      signal: AbortSignal.timeout(Math.max(15_000, Math.min(left, 75_000))),
      cache: "no-store",
    });
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string }; candidates?: { content?: GContent; finishReason?: string }[] };
    if (!res.ok) throw new Error(`Gemini: ${body.error?.message ?? res.status}`);
    const content = body.candidates?.[0]?.content;
    if (!content?.parts?.length) throw new Error("لم يُرجع النموذج رداً");
    // يُعاد المحتوى كما هو (مع توقيعات التفكير) — شرط لاستمرار استدعاء الدوال في Gemini 3
    contents.push({ role: "model", parts: content.parts });
    const calls = content.parts.filter((p) => p.functionCall);
    const text = content.parts.filter((p) => p.text && !p.thought).map((p) => p.text).join("").trim();
    if (!calls.length || Date.now() - started > BUDGET_MS) return { text: text || "لم أصل لإجابة — أعد صياغة السؤال.", model };
    const responses = await Promise.all(calls.map(async (c) => ({ functionResponse: { name: c.functionCall!.name, response: { result: await runTool(c.functionCall!.name, c.functionCall!.args ?? {}, user, log) } } })));
    contents.push({ role: "user", parts: responses });
  }
  return { text: "توقفت بعد عدد كبير من الخطوات — جزّئ الطلب.", model };
}

export const assistantEngine = () => (claudeConfigured() ? `Claude (${CLAUDE_MODEL()})` : geminiConfigured() ? `Gemini (${process.env.ASSISTANT_GEMINI_MODEL || geminiModel()})` : null);

/** رسالة جديدة في محادثة: يحفظ السؤال، يشغّل الوكيل، يحفظ الرد مع سجل الأدوات */
export async function ask(threadId: number, message: string, user: AppUser) {
  const started = Date.now();
  await db.assistantMessage.create({ data: { threadId, role: "user", text: message } });
  const past = await db.assistantMessage.findMany({ where: { threadId }, orderBy: { id: "desc" }, take: 16, select: { role: true, text: true } });
  const history = past.reverse().map((m) => ({ role: m.role as Turn["role"], text: m.text }));
  const system = await systemPrompt(user);
  const log: ToolLog[] = [];
  let out: { text: string; model: string };
  try {
    out = claudeConfigured() ? await runClaude(system, history, user, log, started) : await runGemini(system, history, user, log, started);
  } catch (e) {
    out = { text: `تعذر الوصول للمساعد الآن: ${e instanceof Error ? e.message : e}`, model: "error" };
  }
  const msg = await db.assistantMessage.create({ data: { threadId, role: "assistant", text: out.text, tools: log, model: out.model } });
  await db.assistantThread.update({ where: { id: threadId }, data: { updatedAt: new Date() } });
  return msg;
}

import "server-only";
import { generateJson } from "../ai/gemini";
import { DEFAULT_BOARD, SEATS, type Seat } from "./seats";

/**
 * غرفة النقد (Roast Room) داخل النظام — مبنية على nateherkai/roast-room (MIT).
 * سبعة مستشارين (محاكاة لأطر عمل منشورة) يقرأ كل منهم القرار من زاويته بالتوازي، ثم «الرئيس» يلخص الحكم.
 * قاعدة صارمة: لا أرقام ولا وقائع خارج ما في نص القرار وبيانات الشركة المرفقة — ما ليس معروفاً يُطرح كسؤال.
 */
export type SeatTake = { key: string; name: string; initials: string; color: string; pillar: string; stance: "FOR" | "AGAINST" | "CONDITIONAL"; score: number; headline: string; argument: string; risk: string; question: string };
export type RoastResult = { at: string; decision: string; seats: SeatTake[]; verdict: { call: "GO" | "NO_GO" | "GO_IF"; confidence: number; summary: string; conditions: string[]; killCriteria: string[]; nextSteps: string[] }; model: string };

const RULES = `أنت مقعد في «غرفة النقد» لمجلس إدارة شركة صدى الجنوب للمقاولات الإنشائية (الأردن).
- أنت محاكاة مبنية على أطر عمل منشورة لهذا الشخص، ولست هو. لا تنسب له اقتباساً.
- اكتب بالعربية الواضحة المختصرة (لهجة مهنية)، بلا مبالغة ولا حشو.
- ممنوع اختراع أي رقم أو مكان أو عميل أو واقعة غير موجودة في نص القرار. إن احتجت معلومة غير موجودة فاطرحها كسؤال.
- طبّق إطار عملك على واقع شركة مقاولات (عطاءات حكومية، سيولة، كفالات، مقاولو باطن، معدات).`;

const SEAT_SCHEMA = {
  type: "object",
  properties: {
    stance: { type: "string", enum: ["FOR", "AGAINST", "CONDITIONAL"] },
    score: { type: "integer", description: "0-100 مدى قوة القرار من زاويتك" },
    headline: { type: "string", description: "حكمك في جملة واحدة (≤ 14 كلمة)" },
    argument: { type: "string", description: "الحجة الأساسية بإطار عملك (2-4 جمل)" },
    risk: { type: "string", description: "أخطر نقطة ضعف تراها (جملة أو جملتان)" },
    question: { type: "string", description: "السؤال الذي يجب أن يجيب عليه المجلس قبل التصويت" },
  },
  required: ["stance", "score", "headline", "argument", "risk", "question"],
};

const VERDICT_SCHEMA = {
  type: "object",
  properties: {
    call: { type: "string", enum: ["GO", "NO_GO", "GO_IF"] },
    confidence: { type: "integer" },
    summary: { type: "string", description: "خلاصة الحكم في 2-3 جمل" },
    conditions: { type: "array", items: { type: "string" }, description: "شروط الموافقة (إن وجدت) — 0 إلى 4" },
    killCriteria: { type: "array", items: { type: "string" }, description: "متى نوقف/نتراجع — 1 إلى 3" },
    nextSteps: { type: "array", items: { type: "string" }, description: "خطوات عملية تالية — 2 إلى 4" },
  },
  required: ["call", "confidence", "summary", "conditions", "killCriteria", "nextSteps"],
};

async function seatTake(seat: Seat, decision: string): Promise<SeatTake> {
  const { data } = await generateJson<Omit<SeatTake, "key" | "name" | "initials" | "color" | "pillar">>({
    system: `${RULES}\n\nمقعدك: ${seat.pillar}. سؤالك الذي تملكه: «${seat.question}»\n\nورقة عقلك (أطر ومبادئ ${seat.name}):\n${seat.hot}`,
    parts: [{ text: `القرار المعروض على المجلس:\n${decision}\n\nأعطِ رأيك من زاويتك فقط.` }],
    schema: SEAT_SCHEMA,
    temperature: 0.6,
    maxOutputTokens: 1400,
    timeoutMs: 75_000,
    thinking: "low",
  });
  return { key: seat.key, name: seat.name, initials: seat.initials, color: seat.color, pillar: seat.pillar, ...data, score: Math.max(0, Math.min(100, Math.round(data.score))) };
}

export async function runRoast(decision: string, seatKeys: string[] = DEFAULT_BOARD): Promise<RoastResult> {
  const seats = SEATS.filter((s) => seatKeys.includes(s.key)).slice(0, 7);
  if (!seats.length) throw new Error("اختر مقعداً واحداً على الأقل");
  const settled = await Promise.allSettled(seats.map((s) => seatTake(s, decision)));
  const takes = settled.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  if (takes.length < Math.min(3, seats.length)) {
    const err = settled.find((r): r is PromiseRejectedResult => r.status === "rejected");
    throw new Error(`تعذر انعقاد غرفة النقد: ${err?.reason instanceof Error ? err.reason.message : "النموذج لم يستجب"}`);
  }
  const board = takes.map((t) => `• ${t.name} (${t.pillar}) — ${t.stance} ${t.score}/100: ${t.headline}. ${t.argument} الخطر: ${t.risk}`).join("\n");
  const { data, model } = await generateJson<RoastResult["verdict"]>({
    system: `أنت رئيس الجلسة في «غرفة النقد». توازن آراء المقاعد وتكتب حكماً عملياً بالعربية لمجلس إدارة شركة مقاولات أردنية. لا تخترع أرقاماً أو وقائع غير موجودة في القرار أو آراء المقاعد. جمل قصيرة بلا حشو.`,
    parts: [{ text: `القرار:\n${decision}\n\nآراء المقاعد:\n${board}` }],
    schema: VERDICT_SCHEMA,
    temperature: 0.3,
    maxOutputTokens: 1600,
    timeoutMs: 60_000,
    thinking: "low",
  });
  return { at: new Date().toISOString(), decision, seats: takes, verdict: { ...data, confidence: Math.max(0, Math.min(100, Math.round(data.confidence))) }, model };
}

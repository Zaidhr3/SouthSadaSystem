import "server-only";
import { CONCEPTS } from "./scene";

/**
 * استوديو الصور الذكي — الخطوتان 1 و2 (نص فقط، بلا تكلفة صور):
 *  1) فهم النية وسياق العلامة: هل هي جمعة مباركة؟ مناسبة دينية/وطنية؟ تهنئة؟ إنجاز عطاء؟ تحديث مشروع؟ منشور هوية؟ عرض؟
 *  2) الاتجاه الإبداعي وإثراء الوصف: العبارة التي تُكتب داخل الصورة، المشهد الإنشائي، الأجواء، والنص المرافق للمنشور
 * الخطوة 3 (توليد الصورة — لها تكلفة) لا تبدأ إلا بإذن صريح من المستخدم.
 */
export const INTENTS: Record<string, { label: string; category: string }> = {
  FRIDAY: { label: "تهنئة يوم الجمعة", category: "OCCASION" },
  RELIGIOUS: { label: "مناسبة دينية (عيد/رمضان…)", category: "OCCASION" },
  NATIONAL: { label: "مناسبة وطنية", category: "OCCASION" },
  CONGRATS: { label: "تهنئة ومباركة", category: "CONGRATS" },
  TENDER_MILESTONE: { label: "إنجاز عطاء / توقيع عقد", category: "ACHIEVEMENT" },
  PROJECT_UPDATE: { label: "تحديث من مشروع", category: "PROGRESS" },
  BRAND: { label: "هوية وقيم الشركة", category: "BRAND" },
  OFFER: { label: "عرض / خدمة", category: "OFFER" },
  TIP: { label: "نصيحة إنشائية", category: "TIP" },
};

export type StudioPlan = {
  prompt: string;
  format: "POST" | "STORY";
  intent: string;
  intentLabel: string;
  title: string;
  phrase: string;
  concept: string;
  mood: string;
  caption: string;
  reasoning: string;
};

const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];

export async function analyzeStudio(prompt: string, format: "POST" | "STORY", tweak?: { previous: StudioPlan; change: string }): Promise<StudioPlan> {
  const { writeJson } = await import("../ai/writer");
  const seed = pick(CONCEPTS);
  const { data } = await writeJson<Omit<StudioPlan, "prompt" | "format" | "intentLabel">>({
    system: `أنت المدير الإبداعي لـ«شركة صدى الجنوب للمقاولات الإنشائية» — مقاول أبنية مصنّف (الفئة الرابعة) في الأردن.
مهمتك تحويل طلب قصير من الإدارة إلى خطة تصميم صورة احترافية لفيسبوك وإنستغرام.
- intent: واحد من: ${Object.keys(INTENTS).join(", ")} (جمعة مباركة ← FRIDAY؛ عيد/رمضان/المولد ← RELIGIOUS؛ عيد الاستقلال/الجيش ← NATIONAL؛ مباركة لشخص/جهة ← CONGRATS).
- title: عنوان داخلي قصير للمنشور بالعربية.
- phrase: 2–5 كلمات عربية تُكتب داخل الصورة، بلا تشكيل ولا أرقام (مثل: جمعة مباركة، عيد أضحى مبارك، نبني بثقة). إن ذكر المستخدم نصاً محدداً فاستعمله حرفياً.
- concept: وصف المشهد بالإنجليزية (2–3 جمل) بطابع إنشائي/معماري فاخر: عنصر حقيقي من عالم البناء (رافعة، جرافة، سقالة، مبنى قيد الإنشاء، مخطط، خرسانة، فولاذ) يحمل أو يعرض العبارة. بلا رسوم كرتونية ولا صور عامة لا علاقة لها بالبناء. إن وصف المستخدم مشهداً فنفّذه حرفياً؛ وإلا استلهم من: «${seed}».
- mood: كلمتان بالإنجليزية.
- caption: نص منشور قصير بالعربية (2–4 أسطر) بلهجة مهنية دافئة باسم الشركة، بلا أرقام أو مشاريع أو أسماء غير مذكورة في الطلب، وبلا وسوم كثيرة (وسمان كحد أقصى).
- reasoning: سطر واحد بالعربية يشرح لماذا اخترت هذا المشهد.`,
    effort: "low",
    timeoutMs: 45_000,
    maxTokens: 1600,
    schema: {
      type: "object",
      properties: { intent: { type: "string", enum: Object.keys(INTENTS) }, title: { type: "string" }, phrase: { type: "string" }, concept: { type: "string" }, mood: { type: "string" }, caption: { type: "string" }, reasoning: { type: "string" } },
      required: ["intent", "title", "phrase", "concept", "mood", "caption", "reasoning"],
    },
    turns: [
      {
        role: "user",
        text: tweak
          ? `الطلب الأصلي: «${prompt}»\nالخطة السابقة: ${JSON.stringify({ phrase: tweak.previous.phrase, concept: tweak.previous.concept, mood: tweak.previous.mood })}\nالتعديل المطلوب الآن (طبّقه حرفياً وأبقِ الباقي): «${tweak.change}»`
          : `الطلب: «${prompt}»\nالشكل: ${format === "STORY" ? "ستوري عمودي 9:16" : "منشور 4:5"}`,
      },
    ],
  });
  const intent = data.intent in INTENTS ? data.intent : "BRAND";
  return {
    prompt,
    format,
    intent,
    intentLabel: INTENTS[intent].label,
    title: (data.title || prompt).slice(0, 120),
    phrase: (data.phrase || "").replace(/[ً-ْ]/g, "").replace(/\d/g, "").trim().split(/\s+/).slice(0, 6).join(" "),
    concept: (data.concept || seed).slice(0, 900),
    mood: (data.mood || "").slice(0, 60),
    caption: (data.caption || "").slice(0, 1200),
    reasoning: (data.reasoning || "").slice(0, 300),
  };
}

/** تنظيف خطة قادمة من المتصفح قبل استخدامها في التوليد (لا نثق بأي حقل كما هو) */
export function sanitizePlan(p: Partial<StudioPlan>): StudioPlan {
  const intent = p.intent && p.intent in INTENTS ? p.intent : "BRAND";
  const str = (v: unknown, n: number) => String(v ?? "").slice(0, n);
  return {
    prompt: str(p.prompt, 600),
    format: p.format === "STORY" ? "STORY" : "POST",
    intent,
    intentLabel: INTENTS[intent].label,
    title: str(p.title, 120) || "منشور",
    phrase: str(p.phrase, 60).replace(/[ً-ْ]/g, "").replace(/\d/g, "").trim(),
    concept: str(p.concept, 900),
    mood: str(p.mood, 60),
    caption: str(p.caption, 1200),
    reasoning: str(p.reasoning, 300),
  };
}

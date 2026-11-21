import "server-only";
import { db } from "../db";
import { saveAttachments } from "../uploads";
import { generateImage } from "./imagegen";
import { generateJson } from "../ai/gemini";
import { composeItem } from "./compose";
import { MKT_CATEGORY } from "../marketing";

/**
 * «المشهد الذكي»: صورة سينمائية مولّدة بالذكاء الاصطناعي تمثّل الشركة — مختلفة كل مرة.
 * مثال: تهنئة الجمعة ← رافعة برجية عند الغروب تحمل لوحة فولاذية مكتوب عليها «جمعة مباركة».
 *  1) الكاتب يختار العبارة القصيرة (من نص المنشور فقط) والمفهوم البصري — مع استبعاد آخر المفاهيم المستخدمة
 *  2) توليد الصورة بالعبارة مكتوبة داخل المشهد
 *  3) فحص بصري آلي: هل العبارة العربية صحيحة حرفياً وبلا نص زائد/مشوّه؟ — إعادة مرة واحدة
 *  4) إن فشل: مشهد بلا نص بمساحة فارغة، والعبارة تُكتب فوقه بخط الهوية (دقة 100%)
 */
export const CONCEPTS = [
  "a tower crane at golden hour lifting a large brushed-steel sign panel high above a construction site; the Arabic phrase is displayed on the hanging panel",
  "a yellow hydraulic excavator raising its bucket toward the sky, with an elegant banner hanging from the bucket that carries the Arabic phrase",
  "a modern building under construction at blue hour, the Arabic phrase glowing as large warm illuminated letters mounted on the scaffolding",
  "an architect's desk with rolled blueprints, a precise white architectural model of a villa, and the Arabic phrase as embossed gold metal letters standing on the desk",
  "a sunrise over the hills of Amman with a tower crane silhouette, and a long fabric banner with the Arabic phrase hanging from the crane jib",
  "a smooth fair-faced concrete wall in soft side light with the Arabic phrase engraved deeply and inlaid with gold",
  "structural steel beams being assembled by a crane, arranged to frame a large navy plaque bearing the Arabic phrase in gold",
  "a white safety helmet, a spirit level and a measuring tape on a wooden workbench in morning light, next to a polished gold plaque engraved with the Arabic phrase",
  "a night cityscape with a high-rise under construction, the Arabic phrase displayed in lights across the top floor",
  "aerial drone view at dusk of a construction site where the Arabic phrase is laid out in large lit letters on the ground",
  "a mobile crane on a desert road in southern Jordan at sunset lifting a big signboard with the Arabic phrase",
  "a concrete mixer truck in front of a finished stone villa, a large stone plaque on the villa facade carved with the Arabic phrase",
];
const TIMES = ["golden hour", "soft sunrise", "blue hour", "clear midday with dramatic clouds", "warm sunset", "night with warm lights"];
const LENSES = ["wide-angle 24mm", "35mm cinematic", "low-angle hero shot", "50mm shallow depth of field", "aerial drone perspective"];
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];

export const STYLE =
  "Ultra-detailed photorealistic cinematic photograph, premium corporate advertising quality, rich color grading with deep navy blue (#0b2545) and warm gold (#f2b134) tones with subtle orange (#e8590c) accents, sharp focus, volumetric light. No people's faces in close-up. No logos, no watermarks, no brand names.";

export type Concept = { phrase: string; concept: string; mood: string };

export async function planConcept(it: { title: string; caption: string; category: string; kind: string }, avoid: string[], brief?: string): Promise<Concept> {
  const { writeJson } = await import("../ai/writer");
  const seed = pick(CONCEPTS.filter((c) => !avoid.some((a) => a && c.startsWith(a.slice(0, 30))))) ?? pick(CONCEPTS);
  const { data } = await writeJson<Concept>({
    system: `أنت مدير فني لشركة مقاولات أردنية (صدى الجنوب). تختار لتصميم المنشور: عبارة عربية قصيرة جداً تُكتب داخل الصورة، ومشهداً بصرياً فخماً يمثّل شركة إنشاءات.
- phrase: 2–4 كلمات عربية فصيحة مأخوذة من نص المنشور أو مناسبته فقط (مثل: جمعة مباركة، عيد أضحى مبارك، كل عام وأنتم بخير، نبني بثقة). بلا تشكيل وبلا أرقام. اتركها "" إن كان المنشور لا يناسبه نص داخل الصورة.
${brief ? `- طلب المستخدم بكلماته (الأولوية المطلقة — نفّذه حرفياً ولا تستبدله بفكرة أخرى): «${brief}»
  · إن ذكر نصاً يُكتب (بين علامات تنصيص أو بعد «مكتوب عليها/عليه») فهو الـ phrase حرفياً.
  · concept: ترجم طلبه إلى وصف مشهد إنجليزي دقيق وغني (العناصر، الوقت، الإضاءة، الزاوية) دون إضافة عناصر تخالف طلبه.` : `- concept: وصف المشهد بالإنجليزية في جملة أو جملتين، مبني على هذه الفكرة المقترحة مع تعديلها لتناسب المنشور: «${seed}». المشهد يجب أن يحمل العبارة على عنصر إنشائي حقيقي (لوحة، لافتة، حروف مضيئة، نقش).`}
- mood: كلمتان بالإنجليزية للأجواء.
${brief ? "" : "لا تكرر هذه المفاهيم الأخيرة:"} ${brief ? "" : avoid.filter(Boolean).slice(0, 5).join(" | ") || "لا شيء"}`,
    effort: "low",
    timeoutMs: 40_000,
    maxTokens: 1200,
    schema: { type: "object", properties: { phrase: { type: "string" }, concept: { type: "string" }, mood: { type: "string" } }, required: ["phrase", "concept", "mood"] },
    turns: [{ role: "user", text: `المنشور (${MKT_CATEGORY[it.category] ?? it.category}${it.kind === "STORY" ? "، ستوري" : ""}): ${it.title}\n${it.caption.slice(0, 900)}` }],
  });
  return { phrase: (data.phrase || "").replace(/[ً-ْ]/g, "").trim().split(/\s+/).slice(0, 5).join(" "), concept: data.concept || seed, mood: data.mood || "" };
}

/** فحص بصري: العبارة العربية صحيحة حرفياً، ولا نص آخر أو حروف مشوّهة */
async function verifyText(img: Buffer, mime: string, phrase: string) {
  try {
    const { data } = await generateJson<{ exact: boolean; garbled: boolean; extraText: boolean; quality: number }>({
      system: "You are a strict QA reviewer for Arabic typography in AI-generated advertising images.",
      parts: [
        { inline_data: { mime_type: mime, data: img.toString("base64") } },
        { text: `The image must contain exactly this Arabic phrase, spelled correctly with correctly joined letters: «${phrase}». Answer: exact = the phrase appears and is spelled exactly right; garbled = any Arabic or Latin text looks malformed/gibberish; extraText = any other visible text besides the phrase; quality = overall advertising quality 0-100.` },
      ],
      schema: { type: "object", properties: { exact: { type: "boolean" }, garbled: { type: "boolean" }, extraText: { type: "boolean" }, quality: { type: "integer" } }, required: ["exact", "garbled", "extraText", "quality"] },
      maxOutputTokens: 300,
      timeoutMs: 40_000,
    });
    return data.exact && !data.garbled && !data.extraText;
  } catch {
    return false;
  }
}

async function saveScene(buf: Buffer, mime: string, title: string, tag: string, userId: number) {
  const one = new FormData();
  one.append("files", new File([new Uint8Array(buf)], `scene-${Date.now()}.${mime.includes("png") ? "png" : "jpg"}`, { type: mime }));
  await saveAttachments(one, "media_asset", 0, userId);
  const att = await db.attachment.findFirst({ where: { entityType: "media_asset", entityId: 0, uploadedById: userId }, orderBy: { id: "desc" } });
  if (!att) throw new Error("تعذر حفظ الصورة المولّدة");
  const a = await db.mediaAsset.create({ data: { title: `مشهد: ${title}`.slice(0, 180), category: "ILLUSTRATION", tags: `${tag}, مشهد مولّد بالذكاء الاصطناعي`, attachmentId: att.id, createdById: userId } });
  await db.attachment.update({ where: { id: att.id }, data: { entityId: a.id } });
  return a.id;
}

export async function sceneCompose(itemId: number, userId: number, brief?: string) {
  const it = await db.marketingItem.findUnique({ where: { id: itemId } });
  if (!it) throw new Error("العنصر غير موجود");
  if (it.category === "CONDOLENCE") throw new Error("التعزية تبقى بالقالب الرصين — لا مشاهد مولّدة");
  const recent = await db.mediaAsset.findMany({ where: { tags: { contains: "scene:" } }, orderBy: { id: "desc" }, take: 6, select: { tags: true } });
  const avoid = recent.map((r) => (r.tags?.match(/scene:([^,]+)/)?.[1] ?? "").trim());
  const c = await planConcept(it, avoid, brief?.trim().slice(0, 600) || undefined);
  const aspect = it.kind === "STORY" ? "9:16" : "4:5";
  const time = brief ? "as described" : pick(TIMES);
  const lens = brief ? "as described" : pick(LENSES);
  const tag = `scene:${c.concept.slice(0, 60).replace(/,/g, " ")}`;

  const r = await renderScene(c, aspect, userId, { time, lens, tag, title: c.phrase || it.title });
  const res = await composeItem(itemId, { template: "scene", mediaIds: [r.assetId], headline: c.phrase || it.storyText || it.title, bakedText: r.baked }, userId);
  return { ...res, phrase: c.phrase, concept: c.concept, baked: r.baked };
}

/**
 * توليد المشهد نفسه (يُستخدم من المصمم واستوديو الصور):
 * العبارة داخل الصورة مع فحص بصري آلي ومحاولتين، وإلا مشهد بلا نص تُكتب العبارة فوقه بخط الهوية.
 */
export async function renderScene(c: Concept, aspect: "4:5" | "9:16" | "1:1", userId: number, o: { time?: string; lens?: string; tag?: string; title?: string } = {}) {
  const time = o.time ?? pick(TIMES);
  const lens = o.lens ?? pick(LENSES);
  const tag = o.tag ?? `scene:${c.concept.slice(0, 60).replace(/,/g, " ")}`;
  const title = o.title ?? (c.phrase || "مشهد");
  if (c.phrase) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const { buf, mime } = await generateImage(
        `${STYLE} Scene: ${c.concept}. Time: ${time}. Camera: ${lens}. Mood: ${c.mood}. The ONLY text in the entire image is this exact Arabic phrase, written right-to-left in elegant bold Arabic (Naskh/Kufi) calligraphy with correctly connected letters, large and perfectly legible: "${c.phrase}". Do not add any other words, numbers, or letters anywhere. Keep the upper-right corner clean for a logo.`,
        aspect,
      );
      if (await verifyText(buf, mime, c.phrase)) return { assetId: await saveScene(buf, mime, title, tag, userId), baked: true };
    }
  }
  // بديل مضمون: المشهد نفسه بلا نص، بمساحة هادئة أسفل الصورة، والعبارة بخط الهوية فوقه
  const { buf, mime } = await generateImage(
    `${STYLE} Scene: ${c.concept.replace(/ ?(the|with|bearing|carrying|displaying)? ?(the )?Arabic phrase[^,.;]*/gi, " a blank clean sign")}. Time: ${time}. Camera: ${lens}. Mood: ${c.mood}. Absolutely no text, letters, numbers or symbols anywhere — every sign and panel is blank. Leave the lower third calm and darker for overlaid typography, and the upper-right corner clean for a logo.`,
    aspect,
  );
  return { assetId: await saveScene(buf, mime, title, tag, userId), baked: false };
}

import "server-only";
import { db } from "../db";
import { saveAttachments } from "../uploads";

/**
 * توليد الرسومات الهندسية بالذكاء الاصطناعي (Gemini Image) — لقالب «شكل هندسي»: رافعة، جرافة، خزان، مغسلة، فيلا...
 * سياسة صارمة: رسومات توضيحية فقط (خطوط هندسية أو مجسمات) بهوية الشركة — لا صور واقعية توحي بمشاريع لم ننفذها.
 * كل رسم يُحفظ في مكتبة الوسائط بتصنيف «رسومات مولّدة» ويُعاد استخدامه للموضوع نفسه بدل التوليد من جديد.
 */
export const imageModel = () => process.env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-image";

const STYLES = {
  line: "precise technical line illustration, isometric engineering drawing style, deep navy (#0b2545) clean strokes with selective gold (#f2b134) and orange (#e8590c) accent fills",
  render: "soft 3D isometric clay render, matte materials in deep navy (#0b2545), warm gold (#f2b134) and orange (#e8590c) accents, gentle studio shadow",
} as const;
export type MotifStyle = keyof typeof STYLES;

export async function generateImage(prompt: string, aspect: "1:1" | "4:5" | "9:16" | "16:9" = "1:1"): Promise<{ buf: Buffer; mime: string }> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY غير مضبوط");
  let last = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(imageModel())}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: aspect } } }),
      signal: AbortSignal.timeout(90_000),
      cache: "no-store",
    });
    const j = (await res.json().catch(() => ({}))) as { error?: { message?: string }; candidates?: { content?: { parts?: { inlineData?: { mimeType: string; data: string } }[] }; finishReason?: string }[] };
    const part = j.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
    if (res.ok && part?.inlineData) return { buf: Buffer.from(part.inlineData.data, "base64"), mime: part.inlineData.mimeType };
    last = j.error?.message ?? j.candidates?.[0]?.finishReason ?? `HTTP ${res.status}`;
    if (res.status === 400 || res.status === 403) break;
  }
  throw new Error(`تعذر توليد الصورة: ${last}`);
}

/** رسم الموضوع (يُعاد استخدام رسم سابق لنفس الموضوع والنمط إن وُجد) ← رقم أصل مكتبة الوسائط */
export async function motifAsset(subject: string, userId: number, style: MotifStyle = "line", fresh = false): Promise<number> {
  const tag = `motif2:${style}:${subject.trim().toLowerCase()}`;
  if (!fresh) {
    const hit = await db.mediaAsset.findFirst({ where: { category: "ILLUSTRATION", tags: { contains: tag } }, orderBy: { id: "desc" } });
    if (hit) return hit.id;
  }
  const { buf, mime } = await generateImage(
    `${STYLES[style]} of: ${subject}. Single centered subject, full object visible with generous empty margins, pure flat white background (#ffffff) edge to edge with no vignette, no paper texture, no ground shadow plane. Absolutely no text, no letters, no numbers, no logos, no watermark, no people's faces.`,
    "1:1",
  );
  const one = new FormData();
  one.append("files", new File([new Uint8Array(buf)], `motif-${subject.replace(/[^\w]+/g, "-").slice(0, 40)}.${mime.includes("png") ? "png" : "jpg"}`, { type: mime }));
  await saveAttachments(one, "media_asset", 0, userId);
  const att = await db.attachment.findFirst({ where: { entityType: "media_asset", entityId: 0, uploadedById: userId }, orderBy: { id: "desc" } });
  if (!att) throw new Error("تعذر حفظ الرسم");
  const a = await db.mediaAsset.create({ data: { title: `رسم: ${subject}`, category: "ILLUSTRATION", tags: `${tag}, مولّدة بالذكاء الاصطناعي`, attachmentId: att.id, createdById: userId } });
  await db.attachment.update({ where: { id: att.id }, data: { entityId: a.id } });
  return a.id;
}

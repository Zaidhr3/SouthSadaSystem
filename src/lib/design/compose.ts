import "server-only";
import { db } from "../db";
import { readAttachmentData, saveAttachments } from "../uploads";
import { renderImages } from "./render";
import { renderTemplate, SIZES, TEMPLATES, type SlideInput, type TemplateId } from "./templates";
import { MKT_CATEGORY } from "../marketing";

/**
 * يركّب تصميم عنصر تسويقي: صور حقيقية من مكتبة الوسائط + القالب المؤسسي + نص العنصر نفسه (لا نص جديد).
 * - منشور: صورة واحدة، أو كاروسيل (شريحة لكل صورة مختارة + شريحة الغلاف)
 * - قصة: 1080×1920
 * - رقم الكتالوج «SJ · 0NN» متسلسل مع المنشورات، والقالب يتناوب تلقائياً (إطار ← مخطط ← مقسوم) لتبدو شبكة إنستغرام ككتالوج متناسق.
 */
/** تناوب رباعي على شبكة ثلاثية: كل صف يبدأ بقالب مختلف فلا يتكرر الشكل عمودياً ولا أفقياً */
export const GRID_CYCLE: TemplateId[] = ["frame", "motif", "split", "blueprint"];

/** رقم بارز حقيقي من النص (مساحة، حجم، طوابق، أيام…) — لقالب «رقم بارز» */
export function pickStat(text: string): SlideInput["stat"] {
  const m = text.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).match(/(\d[\d,.]*)\s*(م²|م2|م³|م3|متر مربع|متر|طابق|طوابق|يوم|أيام|عامل|طن|دونم)/);
  if (!m) return null;
  const unit = m[2].replace("م2", "م²").replace("م3", "م³").replace("متر مربع", "م²");
  return { value: m[1], unit };
}

const firstParagraph = (s: string) => s.split(/\n\s*\n/)[0].replace(/#[^\s#]+/g, "").trim();
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, s.lastIndexOf(" ", n) > n * 0.6 ? s.lastIndexOf(" ", n) : n) + "…" : s);

async function assetDataUrl(assetId: number) {
  const a = await db.mediaAsset.findUnique({ where: { id: assetId } });
  if (!a) return null;
  const att = await db.attachment.findUnique({ where: { id: a.attachmentId } });
  if (!att) return null;
  const buf = await readAttachmentData(att);
  return buf ? `data:${att.mimeType};base64,${buf.toString("base64")}` : null;
}

export async function nextCatalogNo() {
  const n = await db.marketingItem.count({ where: { kind: "POST", template: { not: null } } });
  return n + 1;
}

export type ComposeOptions = { template?: TemplateId | "auto"; mediaIds: number[]; headline?: string; sub?: string; carousel?: boolean; bakedText?: boolean };

export async function composeItem(itemId: number, opts: ComposeOptions, userId: number) {
  const it = await db.marketingItem.findUnique({ where: { id: itemId } });
  if (!it) throw new Error("العنصر غير موجود");
  const isStory = it.kind === "STORY";
  const photos = (await Promise.all(opts.mediaIds.slice(0, 10).map(assetDataUrl))).filter((x): x is string => !!x);
  const catalogNo = it.template ? Number((it.mediaIds && JSON.parse(it.mediaIds)?.catalog) || 0) || (await nextCatalogNo()) : await nextCatalogNo();
  const catalog = `SJ · ${String(catalogNo).padStart(3, "0")}`;
  const sensitive = it.category === "CONDOLENCE" ? "condolence" : it.category === "OCCASION" || it.category === "CONGRATS" || it.category === "DENOUNCE" ? "occasion" : null;
  let template: TemplateId = opts.template && opts.template !== "auto" ? opts.template : sensitive ?? (isStory ? "story" : GRID_CYCLE[(catalogNo - 1) % GRID_CYCLE.length]);
  if (TEMPLATES[template].photo === "required" && !photos.length) template = "blueprint";
  // قالب «شكل هندسي» للرسومات فقط — الصورة الواقعية تُعرض بإطار
  if (template === "motif" && opts.mediaIds.length) {
    const first = await db.mediaAsset.findUnique({ where: { id: opts.mediaIds[0] }, select: { category: true } });
    if (first?.category !== "ILLUSTRATION") template = "frame";
  }
  if (template === "stat" && !pickStat(it.caption)) template = photos.length ? "frame" : "blueprint";

  const headline = (opts.headline?.trim() || it.storyText || it.title).slice(0, 140);
  // السطر الفرعي: أول فقرة من النص بلا تكرار العنوان (إن بدأت به يُحذف منها)
  const squash = (x: string) => x.replace(/[^ء-يa-zA-Z0-9]/g, "");
  let para = firstParagraph(it.caption).trim();
  const h = headline.trim();
  if (para.startsWith(h)) para = para.slice(h.length).replace(/^[\s،,.:\-–—]+/, "");
  else if (squash(para).startsWith(squash(h))) para = "";
  if (squash(para).length < 8 || squash(para) === squash(headline)) para = "";
  // نفس المعنى بكلمات متقاربة (أكثر من نصف كلمات السطر موجودة في العنوان) = تكرار — يُحذف
  const words = (x: string) => x.split(/\s+/).map(squash).filter((w) => w.length > 2);
  const hw = new Set(words(h).map((w) => w.replace(/^(ال|بال|وال|لل)/, "")));
  const pw = words(para).map((w) => w.replace(/^(ال|بال|وال|لل)/, ""));
  if (pw.length && pw.length <= 14 && pw.filter((w) => hw.has(w)).length / pw.length > 0.5) para = "";
  const sub = opts.sub !== undefined ? opts.sub.trim() || undefined : sensitive || isStory ? undefined : clip(para, 150) || undefined;
  const base: SlideInput = { bakedText: template === "scene" && !!opts.bakedText, headline, sub: template === "scene" ? undefined : sub, label: sensitive ? undefined : MKT_CATEGORY[it.category], catalog, photo: photos[0] ?? null, stat: template === "stat" ? pickStat(it.caption) : null, cta: it.cta || null };

  const pages: { html: string; w: number; h: number }[] = [];
  const size = isStory ? SIZES.story : SIZES.post;
  pages.push({ html: renderTemplate(template, base, size), ...size });
  if (!isStory && opts.carousel && photos.length > 1) {
    // شرائح الكاروسيل: كل صورة إضافية بإطار هندسي وفقرة من النص نفسه بالترتيب، ثم شريحة ختام بالتواصل
    const paras = it.caption.split(/\n\s*\n/).map((p) => p.replace(/#[^\s#]+/g, "").trim()).filter((p) => p.length > 8).slice(1);
    photos.slice(1).forEach((photo, i) => {
      pages.push({ html: renderTemplate("frame", { headline: clip(paras[i] ?? headline, 110), catalog, photo, point: null, label: `${i + 2} / ${photos.length + 1}` }, SIZES.post), ...SIZES.post });
    });
    pages.push({ html: renderTemplate("blueprint", { headline: it.cta || "ابدأ مشروعك معنا", sub: "واتساب 0781142003 — أو اطلب عرض سعر من موقعنا", catalog }, SIZES.post), ...SIZES.post });
  }
  const images = await renderImages(pages);

  // استبدال الشرائح السابقة
  await db.attachment.deleteMany({ where: { entityType: "marketing", entityId: itemId, slot: { startsWith: "slide:" } } });
  const fd = new FormData();
  images.forEach((buf, i) => fd.append("files", new File([new Uint8Array(buf)], `sada-${itemId}-${i + 1}.jpg`, { type: "image/jpeg" })));
  // حفظ بترتيب الشرائح (slot = slide:N)
  for (let i = 0; i < images.length; i++) {
    const one = new FormData();
    one.append("files", fd.getAll("files")[i]);
    await saveAttachments(one, "marketing", itemId, userId, "files", { slot: `slide:${i + 1}`, label: `تصميم ${i + 1}` });
  }
  const first = await db.attachment.findFirst({ where: { entityType: "marketing", entityId: itemId, slot: "slide:1" }, orderBy: { id: "desc" } });
  await db.marketingItem.update({ where: { id: itemId }, data: { template, mediaIds: JSON.stringify({ ids: opts.mediaIds, catalog: catalogNo }), imageAttachmentId: first?.id ?? null, canvaDesignId: null } });
  if (opts.mediaIds.length) await db.mediaAsset.updateMany({ where: { id: { in: opts.mediaIds } }, data: { usageCount: { increment: 1 } } });
  return { template, slides: images.length, catalog };
}

/** شرائح العنصر بالترتيب (للنشر كاروسيل) */
export async function itemSlides(itemId: number) {
  const rows = await db.attachment.findMany({ where: { entityType: "marketing", entityId: itemId, slot: { startsWith: "slide:" } }, select: { id: true, slot: true } });
  return rows.sort((a, b) => Number(a.slot!.slice(6)) - Number(b.slot!.slice(6))).map((r) => r.id);
}

/**
 * المصمم الذكي: يقرأ نص المنشور ومكتبة الوسائط وآخر قوالب الشبكة، ثم يقرر وحده:
 *  - صورة حقيقية مناسبة من المكتبة (إن وُجدت فعلاً للموضوع) ← قالب صور (إطار/مقسوم)
 *  - أو شكل هندسي مرسوم للموضوع (رافعة، جرافة، خزان، مغسلة...) ← قالب «شكل هندسي» (يُولَّد ويُحفظ للمكتبة)
 *  - أو مخطط أزرق للنصائح والقيم
 * مع منع تكرار القالب نفسه مع آخر منشورين في الشبكة، وعنوان قصير للتصميم من نص المنشور نفسه.
 */
export async function smartCompose(itemId: number, userId: number, opts: { style?: "line" | "render"; fresh?: boolean } = {}) {
  const it = await db.marketingItem.findUnique({ where: { id: itemId } });
  if (!it) throw new Error("العنصر غير موجود");
  // المناسبات والتهاني (مثل جمعة مباركة): مشهد سينمائي مولّد يحمل العبارة — مختلف كل مرة
  if (it.category === "OCCASION" || it.category === "CONGRATS" || it.category === "BRAND") {
    const { sceneCompose } = await import("./scene");
    const r = await sceneCompose(itemId, userId);
    return { template: r.template, slides: r.slides, catalog: r.catalog, why: `مشهد مولّد: ${r.phrase || "بلا نص"}${r.baked ? " (العبارة داخل الصورة ومدققة آلياً)" : " (العبارة بخط الهوية فوق المشهد)"}`, motif: undefined as string | undefined };
  }
  const { writeJson } = await import("../ai/writer");
  const { motifAsset } = await import("./imagegen");
  const [assets, recent] = await Promise.all([
    db.mediaAsset.findMany({ where: { category: { not: "ILLUSTRATION" } }, orderBy: [{ usageCount: "asc" }, { id: "desc" }], take: 80, select: { id: true, title: true, category: true, tags: true, usageCount: true } }),
    db.marketingItem.findMany({ where: { kind: "POST", template: { not: null }, id: { not: itemId } }, orderBy: [{ publishedAt: "desc" }, { id: "desc" }], take: 4, select: { template: true } }),
  ]);
  const lastTpl = recent.map((r) => r.template).filter(Boolean) as string[];
  const { data } = await writeJson<{ mode: "photo" | "motif" | "text"; mediaId: number; motif: string; template: string; headline: string; why: string }>({
    system: `أنت مدير فني لحسابات شركة مقاولات (صدى الجنوب). اختر التصميم الأنسب للمنشور:
- mode=photo: فقط إن وُجدت في المكتبة صورة حقيقية تطابق موضوع المنشور فعلاً (نفس المشروع/المعدة/النوع). mediaId رقمها. template: frame أو split.
- mode=motif: موضوع هندسي يُرسم كشكل (motif بالإنجليزية، اسم شيء محسوس واحد دقيق: "tower crane", "tracked excavator", "bobcat skid steer loader", "stainless steel water tank", "bathroom sink with faucet", "concrete mixer truck", "rebar cage", "two-storey villa", "measuring level and plumb bob"...). template=motif.
- mode=text: نصيحة/قيمة/مناسبة بلا عنصر بصري واضح. template=blueprint.
نوّع: لا تكرر قالب آخر منشورين (${lastTpl.slice(0, 2).join("، ") || "لا شيء"}). headline عنوان التصميم 3–8 كلمات من نص المنشور نفسه بلا أرقام جديدة.`,
    effort: "low",
    timeoutMs: 45_000,
    maxTokens: 2000,
    schema: { type: "object", properties: { mode: { type: "string", enum: ["photo", "motif", "text"] }, mediaId: { type: "integer", description: "0 إن لم تُستخدم صورة" }, motif: { type: "string" }, template: { type: "string", enum: ["frame", "split", "motif", "blueprint"] }, headline: { type: "string" }, why: { type: "string" } } },
    turns: [{ role: "user", text: `المنشور (${MKT_CATEGORY[it.category] ?? it.category}): ${it.title}\n${it.caption.slice(0, 1200)}\n\nمكتبة الصور الحقيقية:\n${assets.map((a) => `#${a.id} [${a.category}] ${a.title}${a.tags ? ` — ${a.tags}` : ""}`).join("\n") || "فارغة"}` }],
  });
  let template = (["frame", "split", "motif", "blueprint"].includes(data.template) ? data.template : "blueprint") as TemplateId;
  let mediaIds: number[] = [];
  if (data.mode === "photo" && assets.some((a) => a.id === data.mediaId)) {
    mediaIds = [data.mediaId];
    if (template !== "frame" && template !== "split") template = lastTpl[0] === "frame" ? "split" : "frame";
  } else if (data.mode === "motif" && data.motif?.trim()) {
    mediaIds = [await motifAsset(data.motif.trim().slice(0, 80), userId, opts.style ?? "line", opts.fresh)];
    template = "motif";
  } else template = "blueprint";
  const res = await composeItem(itemId, { template, mediaIds, headline: data.headline?.trim() || undefined }, userId);
  return { ...res, why: data.why, motif: data.mode === "motif" ? data.motif : undefined };
}

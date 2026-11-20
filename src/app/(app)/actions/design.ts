"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { actionUser } from "@/lib/auth";
import { auditEvent, run, runVoid, type ActionState } from "@/lib/action";
import { AppError, can } from "@/lib/permissions";
import { saveAttachments, validateAttachments } from "@/lib/uploads";
import { composeItem, smartCompose } from "@/lib/design/compose";
import { TEMPLATES, coverHtml, profileHtml, type TemplateId } from "@/lib/design/templates";
import { renderImages } from "@/lib/design/render";
import { CanvaError, designIdFrom, exportDesign, pushImageToCanva, saveCanvaApp } from "@/lib/canva";
import { readAttachmentData } from "@/lib/uploads";
import { SIZES } from "@/lib/design/templates";
import { deleteSecret } from "@/lib/secret-box";
import { applyPageImage, MetaError } from "@/lib/meta";

const t = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const CATS = ["EQUIPMENT", "PROJECT", "SITE", "TANK", "TEAM", "ILLUSTRATION", "OTHER"];

/** رفع صور لمكتبة الوسائط (صور حقيقية فقط: معدات، مشاريع، مواقع) */
export async function uploadMedia(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = await run(async () => {
    const user = await actionUser(can.manageMarketing);
    const category = CATS.includes(t(fd, "category")) ? t(fd, "category") : "OTHER";
    const title = t(fd, "title");
    if (!title) throw new AppError("اكتب وصفاً للصور (مثال: بوبكات الشركة في موقع مادبا)");
    await validateAttachments(fd, user.id);
    const files = fd.getAll("files").filter((f): f is File => typeof f === "object" && "size" in f && f.size > 0);
    if (!files.length) throw new AppError("اختر صورة واحدة على الأقل");
    let n = 0;
    for (const f of files) {
      if (!["image/jpeg", "image/png", "image/webp"].includes(f.type)) throw new AppError(`«${f.name}» ليست صورة JPG/PNG/WEBP`);
      const one = new FormData();
      one.append("files", f);
      await saveAttachments(one, "media_asset", 0, user.id);
      const att = await db.attachment.findFirst({ where: { entityType: "media_asset", entityId: 0, uploadedById: user.id }, orderBy: { id: "desc" } });
      if (!att) continue;
      const a = await db.mediaAsset.create({ data: { title: files.length > 1 ? `${title} (${++n})` : title, category, tags: t(fd, "tags") || null, tenderId: Number(t(fd, "tenderId")) || null, attachmentId: att.id, createdById: user.id } });
      await db.attachment.update({ where: { id: att.id }, data: { entityId: a.id } });
    }
    return `أُضيفت ${files.length} صورة للمكتبة`;
  });
  revalidatePath("/marketing/media");
  return r;
}

export async function deleteMedia(id: number) {
  const r = await runVoid(async () => {
    await actionUser(can.manageMarketing);
    const a = await db.mediaAsset.findUnique({ where: { id } });
    if (!a) return;
    await db.mediaAsset.delete({ where: { id } });
    await db.attachment.deleteMany({ where: { id: a.attachmentId } });
  });
  revalidatePath("/marketing/media");
  return r;
}

/** توليد تصميم العنصر من القالب المؤسسي وصور المكتبة */
export async function composeAction(itemId: number, _: ActionState, fd: FormData): Promise<ActionState> {
  const r = await run(async () => {
    const user = await actionUser(can.manageMarketing);
    const it = await db.marketingItem.findUnique({ where: { id: itemId }, select: { status: true } });
    if (!it || it.status === "PUBLISHED") throw new AppError("لا يمكن تعديل تصميم عنصر منشور");
    const tpl = t(fd, "template");
    const mediaIds = fd.getAll("mediaIds").map(Number).filter((n) => n > 0);
    try {
      const res = await composeItem(itemId, { template: tpl in TEMPLATES ? (tpl as TemplateId) : "auto", mediaIds, headline: t(fd, "headline") || undefined, sub: fd.has("sub") ? t(fd, "sub") : undefined, carousel: fd.get("carousel") === "on" }, user.id);
      return `صُمّم: ${TEMPLATES[res.template].name} — ${res.slides} ${res.slides > 1 ? "شرائح كاروسيل" : "صورة"} — ${res.catalog}`;
    } catch (e) {
      throw new AppError(`تعذر التصميم: ${e instanceof Error ? e.message : e}`);
    }
  });
  revalidatePath(`/marketing/${itemId}`);
  revalidatePath("/marketing/grid");
  return r;
}

/** المصمم الذكي: يختار الصورة أو يرسم الشكل المناسب ويختار القالب بنفسه */
export async function smartComposeAction(itemId: number, _: ActionState, fd: FormData): Promise<ActionState> {
  const r = await run(async () => {
    const user = await actionUser(can.manageMarketing);
    const it = await db.marketingItem.findUnique({ where: { id: itemId }, select: { status: true } });
    if (!it || it.status === "PUBLISHED") throw new AppError("لا يمكن تعديل تصميم عنصر منشور");
    try {
      const res = await smartCompose(itemId, user.id, { style: fd.get("style") === "render" ? "render" : "line", fresh: fd.get("fresh") === "on" });
      return `${TEMPLATES[res.template].name}${res.motif ? ` — رسم: ${res.motif}` : ""} (${res.catalog}). ${res.why ?? ""}`;
    } catch (e) {
      throw new AppError(`تعذر التصميم الذكي: ${e instanceof Error ? e.message : e}`);
    }
  });
  revalidatePath(`/marketing/${itemId}`);
  revalidatePath("/marketing/grid");
  return r;
}

/** استيراد تصميم Canva جاهز (كل صفحاته شرائح) بدل قالب النظام */
export async function importCanva(itemId: number, _: ActionState, fd: FormData): Promise<ActionState> {
  const r = await run(async () => {
    const user = await actionUser(can.manageMarketing);
    const designId = designIdFrom(t(fd, "link"));
    if (!designId) throw new AppError("الصق رابط تصميم Canva (canva.com/design/…)");
    try {
      const ex = await exportDesign(designId);
      await db.attachment.deleteMany({ where: { entityType: "marketing", entityId: itemId, slot: { startsWith: "slide:" } } });
      for (let i = 0; i < ex.images.length; i++) {
        const one = new FormData();
        one.append("files", new File([new Uint8Array(ex.images[i])], `canva-${designId}-${i + 1}.jpg`, { type: "image/jpeg" }));
        await saveAttachments(one, "marketing", itemId, user.id, "files", { slot: `slide:${i + 1}`, label: `Canva ${i + 1}` });
      }
      const first = await db.attachment.findFirst({ where: { entityType: "marketing", entityId: itemId, slot: "slide:1" }, orderBy: { id: "desc" } });
      await db.marketingItem.update({ where: { id: itemId }, data: { canvaDesignId: designId, template: "canva", imageAttachmentId: first?.id ?? null } });
      return `استُورد تصميم Canva${ex.title ? ` «${ex.title}»` : ""}: ${ex.images.length} ${ex.images.length > 1 ? "شرائح" : "صورة"}`;
    } catch (e) {
      throw new AppError(e instanceof CanvaError ? e.message : `تعذر الاستيراد: ${e instanceof Error ? e.message : e}`);
    }
  });
  revalidatePath(`/marketing/${itemId}`);
  return r;
}

export async function saveCanvaAppAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = await run(async () => {
    const user = await actionUser(can.manageSettings);
    const id = t(fd, "clientId");
    const secret = t(fd, "clientSecret");
    if (!/^[A-Za-z0-9_-]{8,}$/.test(id) || secret.length < 10) throw new AppError("أدخل Client ID وClient Secret من Canva Developer Portal");
    await saveCanvaApp(id, secret).catch((e) => {
      throw new AppError(e instanceof Error ? e.message : "تعذر حفظ بيانات Canva");
    });
    await auditEvent("UPDATE", "Integration", "حفظ بيانات تكامل Canva", user);
    return "تحقق النظام من Client ID وSecret مع Canva ✓ — اضغط «ربط حساب Canva» لإتمام التفويض";
  });
  revalidatePath("/system");
  return r;
}

export async function disconnectCanva() {
  const r = await runVoid(async () => {
    const user = await actionUser(can.manageSettings);
    await deleteSecret("canva");
    await auditEvent("DISCONNECT", "Integration", "فصل Canva", user);
  });
  revalidatePath("/system");
  return r;
}

/** هوية الحسابات: توليد الصورة الشخصية والغلاف الجديدين (نفس الشعار، طابع جديد) للمعاينة قبل الاعتماد */
export async function generateBrandKit(_: ActionState, __: FormData): Promise<ActionState> {
  const r = await run(async () => {
    const user = await actionUser(can.manageMarketing);
    // خلفية الغلاف: رسم هندسي احترافي مولّد بهوية الشركة (موقع بناء برافعات وهياكل) — الشعار والنص فوقه بالقالب
    let art: string | undefined;
    try {
      const { generateImage } = await import("@/lib/design/imagegen");
      const g = await generateImage(
        "Wide cinematic panoramic illustration for a construction company cover: modern building skeleton under construction with two tower cranes at dusk, precise architectural line-art blended with soft volumetric light, deep navy blue (#0b2545) dominant palette with warm gold (#f2b134) and orange (#e8590c) glowing accents, subtle blueprint grid overlay, elegant and premium, calm empty area in the center. Absolutely no text, no letters, no logos, no watermark, no people.",
        "16:9",
      );
      art = `data:${g.mime};base64,${g.buf.toString("base64")}`;
    } catch {
      art = undefined; // بلا ذكاء اصطناعي: الغلاف بالتصميم الهندسي الثابت
    }
    const [profile, cover] = await renderImages([
      { html: profileHtml(1080), w: 1080, h: 1080 },
      { html: coverHtml(1640, 624, art), w: 1640, h: 624 },
    ]);
    await db.attachment.deleteMany({ where: { entityType: "brand", entityId: 1 } });
    for (const [slot, buf] of [["profile", profile], ["cover", cover]] as const) {
      const one = new FormData();
      one.append("files", new File([new Uint8Array(buf)], `sada-${slot}.jpg`, { type: "image/jpeg" }));
      await saveAttachments(one, "brand", 1, user.id, "files", { slot, label: slot === "profile" ? "الصورة الشخصية" : "صورة الغلاف" });
    }
    return "جُهّزت الصورة الشخصية والغلاف — راجعهما ثم اعتمد التطبيق على الصفحة";
  });
  revalidatePath("/marketing/brand");
  return r;
}

/** تطبيق الصورة الشخصية أو الغلاف على صفحة فيسبوك (إنستغرام لا يسمح بتغيير الصورة الشخصية برمجياً) */
export async function applyBrandImage(slot: "profile" | "cover", _: ActionState, __: FormData): Promise<ActionState> {
  const r = await run(async () => {
    const user = await actionUser(can.manageMarketing);
    const att = await db.attachment.findFirst({ where: { entityType: "brand", entityId: 1, slot }, orderBy: { id: "desc" } });
    if (!att) throw new AppError("ولّد التصاميم أولاً");
    try {
      await applyPageImage(slot, att.id);
    } catch (e) {
      throw new AppError(e instanceof MetaError && e.kind === "PERMISSION" ? `فيسبوك يتطلب صلاحية إضافية لتغيير ${slot === "profile" ? "الصورة الشخصية" : "الغلاف"} (pages_manage_metadata) — نزّل الصورة وارفعها من الصفحة يدوياً، أو أضف الصلاحية للرمز` : `لم يُطبَّق: ${e instanceof Error ? e.message : e}`);
    }
    await auditEvent("UPDATE", "Integration", `تغيير ${slot === "profile" ? "الصورة الشخصية" : "صورة الغلاف"} لصفحة فيسبوك`, user);
    return `طُبّقت ${slot === "profile" ? "الصورة الشخصية" : "صورة الغلاف"} على فيسبوك`;
  });
  revalidatePath("/marketing/brand");
  return r;
}

/** تصميم جماعي ذكي: المنشورات المقترحة/المعتمدة بلا تصميم (4 في كل ضغطة) */
export async function designPending(_: ActionState, __: FormData): Promise<ActionState> {
  const r = await run(async () => {
    const user = await actionUser(can.manageMarketing);
    const todo = await db.marketingItem.findMany({ where: { kind: "POST", imageAttachmentId: null, status: { in: ["SUGGESTED", "IN_REVIEW", "APPROVED"] }, source: { notIn: ["AUDIT_FB", "AUDIT_IG"] } }, orderBy: [{ publishAt: "asc" }, { scheduledFor: "asc" }], take: 4, select: { id: true } });
    if (!todo.length) return "كل المنشورات مصممة ✓";
    const done: string[] = [];
    const failed: string[] = [];
    // بالتتابع: رقم الكتالوج والتناوب يعتمدان على ما قبله
    for (const t of todo) {
      try {
        const res = await smartCompose(t.id, user.id);
        done.push(`${res.catalog}${res.motif ? ` (${res.motif})` : ""}`);
      } catch (e) {
        failed.push(`#${t.id}: ${e instanceof Error ? e.message : e}`);
      }
    }
    const left = await db.marketingItem.count({ where: { kind: "POST", imageAttachmentId: null, status: { in: ["SUGGESTED", "IN_REVIEW", "APPROVED"] }, source: { notIn: ["AUDIT_FB", "AUDIT_IG"] } } });
    return `صُمّم ${done.length}: ${done.join("، ")}${left ? ` — بقي ${left}، اضغط مجدداً` : ""}${failed.length ? ` (تعذّر: ${failed.join(" | ")})` : ""}`;
  });
  revalidatePath("/marketing/grid");
  revalidatePath("/marketing");
  return r;
}

/** «عدّل في Canva»: يرسل التصميم الحالي إلى Canva كتصميم قابل للتحرير بنفس المقاس، ويعيد رابط التحرير */
export async function pushToCanva(itemId: number, _: ActionState, __: FormData): Promise<ActionState> {
  const r = await run(async () => {
    await actionUser(can.manageMarketing);
    const it = await db.marketingItem.findUnique({ where: { id: itemId }, select: { id: true, title: true, kind: true, imageAttachmentId: true } });
    if (!it) throw new AppError("العنصر غير موجود");
    const att = it.imageAttachmentId ? await db.attachment.findUnique({ where: { id: it.imageAttachmentId } }) : await db.attachment.findFirst({ where: { entityType: "marketing", entityId: itemId, slot: "slide:1" }, orderBy: { id: "desc" } });
    if (!att) throw new AppError("صمّم العنصر أولاً ثم أرسله إلى Canva");
    const buf = await readAttachmentData(att);
    if (!buf) throw new AppError("تعذر قراءة صورة التصميم");
    try {
      const size = it.kind === "STORY" ? SIZES.story : SIZES.post;
      const d = await pushImageToCanva(buf, `صدى الجنوب — ${it.title}`, size);
      await db.marketingItem.update({ where: { id: itemId }, data: { canvaDesignId: d.designId, canvaEditUrl: d.editUrl } });
      return "أُرسل التصميم إلى Canva — اضغط «افتح في Canva» للتعديل، ثم «استورد تعديلاتي»";
    } catch (e) {
      throw new AppError(e instanceof CanvaError ? e.message : `تعذر الإرسال إلى Canva: ${e instanceof Error ? e.message : e}`);
    }
  });
  revalidatePath(`/marketing/${itemId}`);
  return r;
}

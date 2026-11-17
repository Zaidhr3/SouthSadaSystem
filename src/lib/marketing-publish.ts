import "server-only";
import { db } from "./db";
import { MetaError, metaConfigured, publishToMeta } from "./meta";
import { humanizeClean } from "./content-skills/humanizer";
import { notify } from "./notify";

/**
 * نشر عنصر معتمد على فيسبوك وإنستغرام — مشترك بين زر «اعتماد ونشر» والنشر المجدول (المهمة اليومية).
 * النص يمر بالمؤنسن دائماً قبل الإرسال. الفشل المؤقت (شبكة/حد استخدام) يُبقي العنصر «معتمداً» ليُعاد في التشغيلة التالية،
 * والفشل الدائم (رمز منتهٍ، صلاحية، محتوى مرفوض) يُعلّمه «فشل النشر» مع السبب.
 */
export async function publishItem(id: number): Promise<{ ok: boolean; message: string }> {
  const it = await db.marketingItem.findUnique({ where: { id } });
  if (!it) return { ok: false, message: "العنصر غير موجود" };
  if (it.status === "PUBLISHED") return { ok: true, message: "منشور مسبقاً" };
  if (!(await metaConfigured())) return { ok: false, message: "النشر التلقائي غير مربوط — اربط الصفحة من إعدادات النظام" };
  const caption = humanizeClean(it.caption).text;
  if (caption !== it.caption) await db.marketingItem.update({ where: { id }, data: { caption } });
  try {
    const { itemSlides } = await import("./design/compose");
    const p = await publishToMeta({ ...it, caption, slides: await itemSlides(id) });
    await db.marketingItem.update({
      where: { id },
      data: { status: "PUBLISHED", publishedAt: new Date(), publishAt: null, fbPostId: p.fbPostId ?? null, igMediaId: p.igMediaId ?? null, imageUrl: p.imageUrl ?? null, publishLog: p.log.join("\n") },
    });
    return { ok: true, message: `${p.partial ? "نُشر جزئياً" : "نُشر"}: ${p.log.join(" — ")}` };
  } catch (e) {
    const err = e instanceof MetaError ? e : new MetaError("UNKNOWN", e instanceof Error ? e.message : String(e));
    const temporary = err.kind === "NETWORK" || err.kind === "RATE";
    await db.marketingItem.update({ where: { id }, data: { status: temporary && it.publishAt ? "APPROVED" : "FAILED", publishLog: `${new Date().toISOString().slice(0, 16).replace("T", " ")} — ${err.message}${temporary && it.publishAt ? " (سيُعاد في التشغيلة القادمة)" : ""}` } });
    return { ok: false, message: err.message };
  }
}

/** المهمة اليومية: نشر العناصر المعتمدة التي حلّ موعدها */
export async function publishDue() {
  if (!(await metaConfigured())) return { published: 0, failed: 0, skipped: "غير مربوط" };
  const due = await db.marketingItem.findMany({ where: { status: "APPROVED", publishAt: { lte: new Date() } }, select: { id: true, title: true }, orderBy: { publishAt: "asc" }, take: 20 });
  let published = 0;
  const failed: string[] = [];
  for (const d of due) {
    const r = await publishItem(d.id);
    if (r.ok) published++;
    else failed.push(`${d.title}: ${r.message}`);
  }
  if (failed.length) await notify(["ADMIN"], { title: `تعذر نشر ${failed.length} من المحتوى المجدول`, body: failed.join(" | ").slice(0, 400), href: "/marketing?view=review" });
  return { published, failed: failed.length };
}

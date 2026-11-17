import "server-only";
import { db } from "./db";
import { callMeta, getMetaConfig, MetaError } from "./meta";
import { humanizeClean } from "./content-skills/humanizer";
import { saveAttachments } from "./uploads";
import { composeItem } from "./design/compose";
import { addDays, todayUTC } from "./format";
import { writeJson } from "./ai/writer";
import { SYS as EDITOR } from "./page-audit";
import { checkFacts } from "./content-skills/fact-guard";
import { knownNames } from "./content-skills/known-names";

/**
 * إعادة إطلاق الصفحة: تحويل المنشورات القديمة (صور عشوائية بنصوص متفاوتة) إلى كتالوج هندسي موحد.
 *   1) سحب المنشورات القديمة من فيسبوك وإنستغرام (مع دمج المنشور المكرر على المنصتين)
 *   2) لكل منشور مختار: صورته الأصلية ← مكتبة الوسائط، النص المحسّن (المعتمد في مراجعة الصفحة إن وُجد، وإلا الأصل بعد المؤنسن)،
 *      وتصميم بقالب الكتالوج (رقم SJ · 0NN وتناوب القوالب) — بترتيب زمني: الأقدم يُنشر أولاً فيبقى الأحدث أعلى الشبكة
 *   3) يدخل «قيد المراجعة» بموعد نشر يومي متتابع — لا يُنشر شيء دون اعتماد الإدارة
 *   4) بعد نشر النسخة الجديدة: حذف المنشور القديم من فيسبوك بضغطة (وإنستغرام إن سمحت Meta، وإلا أرشفة يدوية برابطه)
 */
export type OldPost = { key: string; fb?: string; ig?: string; fbLink?: string; igLink?: string; text: string; at: string; picture?: string; relaunched?: number };
export type RelaunchRef = { fb?: string; ig?: string; fbLink?: string; igLink?: string; at: string; retired?: { fb?: string; ig?: string } };

const norm = (s: string) => s.replace(/[^ء-يa-zA-Z0-9]/g, "").slice(0, 60);

export async function oldPosts(limit = 60): Promise<{ posts: OldPost[]; errors: string[] }> {
  const cfg = await getMetaConfig();
  if (!cfg) throw new MetaError("AUTH", "لم تُربط الصفحة بعد — اربطها من إعدادات النظام");
  const errors: string[] = [];
  const posts: OldPost[] = [];
  try {
    const r = await callMeta<{ data: { id: string; message?: string; created_time: string; full_picture?: string; permalink_url?: string; from?: { id: string } }[] }>("GET", `${cfg.pageId}/posts`, { fields: "id,message,created_time,full_picture,permalink_url,from{id}", limit: String(limit) });
    for (const p of r.data ?? []) if (p.full_picture && (!p.from || p.from.id === cfg.pageId)) posts.push({ key: `fb:${p.id}`, fb: p.id, fbLink: p.permalink_url, text: p.message?.trim() ?? "", at: p.created_time, picture: p.full_picture });
  } catch (e) {
    errors.push(`فيسبوك: ${e instanceof Error ? e.message : e}`);
  }
  if (cfg.igUserId) {
    try {
      const r = await callMeta<{ data: { id: string; caption?: string; timestamp: string; media_type?: string; media_url?: string; thumbnail_url?: string; permalink?: string }[] }>("GET", `${cfg.igUserId}/media`, { fields: "id,caption,timestamp,media_type,media_url,thumbnail_url,permalink", limit: String(limit) });
      for (const p of r.data ?? []) {
        const text = p.caption?.trim() ?? "";
        const twin = text ? posts.find((x) => x.fb && !x.ig && norm(x.text) === norm(text)) : undefined;
        if (twin) Object.assign(twin, { ig: p.id, igLink: p.permalink });
        else posts.push({ key: `ig:${p.id}`, ig: p.id, igLink: p.permalink, text, at: p.timestamp, picture: p.media_type === "VIDEO" ? p.thumbnail_url : (p.media_url ?? p.thumbnail_url) });
      }
    } catch (e) {
      errors.push(`إنستغرام: ${e instanceof Error ? e.message : e}`);
    }
  }
  // ما أُعيد إطلاقه مسبقاً (أو منشوراتنا الجديدة نفسها) لا يظهر كمرشح جديد
  const items = await db.marketingItem.findMany({ where: { OR: [{ relaunchOf: { not: null } }, { status: "PUBLISHED", source: { notIn: ["AUDIT_FB", "AUDIT_IG"] } }] }, select: { id: true, relaunchOf: true, fbPostId: true, igMediaId: true } });
  const ours = new Set(items.flatMap((i) => [i.fbPostId, i.igMediaId]).filter(Boolean) as string[]);
  const done = new Map<string, number>();
  for (const i of items) {
    if (!i.relaunchOf) continue;
    const r = JSON.parse(i.relaunchOf) as RelaunchRef;
    if (r.fb) done.set(r.fb, i.id);
    if (r.ig) done.set(r.ig, i.id);
  }
  return {
    posts: posts
      .filter((p) => !(p.fb && ours.has(p.fb)) && !(p.ig && ours.has(p.ig)))
      .map((p) => ({ ...p, relaunched: done.get(p.fb ?? "") ?? done.get(p.ig ?? "") }))
      .sort((a, b) => +new Date(a.at) - +new Date(b.at)),
    errors,
  };
}

/** صورة المنشور بجودتها الأصلية (روابط Meta مؤقتة — تُجلب الآن) */
async function download(url: string) {
  const r = await fetch(url, { signal: AbortSignal.timeout(30_000), cache: "no-store" });
  if (!r.ok) throw new Error(`تعذر تنزيل صورة المنشور (HTTP ${r.status})`);
  const type = (r.headers.get("content-type") || "image/jpeg").split(";")[0];
  return { buf: Buffer.from(await r.arrayBuffer()), type: ["image/jpeg", "image/png", "image/webp"].includes(type) ? type : "image/jpeg" };
}

const firstLine = (t: string) =>
  (t
    .split(/\n/)
    .map((l) => l.replace(/[#@]\S+/g, "").replace(/[️‍]/g, "").replace(/[\u{1F300}-\u{1FAFF}☀-➿�"“”]/gu, "").trim())
    .find((l) => l.length > 6) ?? "من أعمال صدى الجنوب").slice(0, 90);

/**
 * صياغة النسخة الجديدة: عنوان قصير للتصميم + نص محسّن — بنفس الحقائق حرفياً.
 * حارس الحقائق يرفض أي صياغة فقدت رقماً/اسماً أو أضافت رقماً، فيبقى الأصل.
 */
async function polish(posts: { key: string; text: string }[]) {
  const out = new Map<string, { headline: string; caption?: string }>();
  const list = posts.filter((p) => p.text.trim());
  if (!list.length) return out;
  try {
    const names = await knownNames();
    const { data } = await writeJson<{ results: { key: string; headline: string; caption: string }[] }>({
      system: `${EDITOR}

إضافة لإعادة الإطلاق: headline عنوان للتصميم من 3 إلى 8 كلمات، فخم وواضح، من حقائق النص فقط (لا رقم جديد). caption النص المحسّن الكامل (احتفظ بكل رقم واسم ومكان وسنة ورقم هاتف حرفياً)، مع وسوم مناسبة في آخره.`,
      effort: "low",
      timeoutMs: 70_000,
      maxTokens: 8000,
      schema: { type: "object", properties: { results: { type: "array", items: { type: "object", properties: { key: { type: "string" }, headline: { type: "string" }, caption: { type: "string" } } } } } },
      turns: [{ role: "user", text: list.map((p) => `### key=${p.key}\n${p.text}`).join("\n\n") }],
    });
    for (const r of data.results ?? []) {
      const src = list.find((p) => p.key === r.key);
      if (!src) continue;
      const head = r.headline?.trim();
      const headOk = head && head.length <= 60 && checkFacts(src.text, head, []).added.length === 0;
      const capOk = r.caption?.trim() && checkFacts(src.text, r.caption, names).ok;
      out.set(r.key, { headline: headOk ? head : "", caption: capOk ? r.caption : undefined });
    }
  } catch (e) {
    console.warn("[relaunch] polish skipped:", e instanceof Error ? e.message : e);
  }
  return out;
}

/** تجهيز دفعة (حتى 4 منشورات لكل استدعاء — التصميم بالمتصفح يستغرق ثوانٍ لكل منشور) */
export async function prepareRelaunch(keys: string[], userId: number, opts: { start?: Date; everyDays?: number } = {}) {
  const { posts } = await oldPosts();
  const todo = posts.filter((p) => keys.includes(p.key) && !p.relaunched && p.picture);
  const picked = todo.slice(0, 4);
  if (!picked.length) return { prepared: 0, remaining: 0, errors: ["لا توجد منشورات مختارة جاهزة (ربما جُهّزت مسبقاً أو بلا صورة)"] };
  // الموعد: بعد آخر عنصر إعادة إطلاق مجدول، يوماً بيوم
  const last = await db.marketingItem.findFirst({ where: { relaunchOf: { not: null }, status: { notIn: ["PUBLISHED", "REJECTED"] }, publishAt: { not: null } }, orderBy: { publishAt: "desc" }, select: { publishAt: true } });
  const every = Math.max(1, opts.everyDays ?? 1);
  let next = last?.publishAt ? addDays(last.publishAt, every) : (opts.start ?? addDays(todayUTC(), 1));
  const audits = await db.marketingItem.findMany({
    where: { source: { in: ["AUDIT_FB", "AUDIT_IG"] }, OR: [{ fbPostId: { in: picked.map((p) => p.fb).filter(Boolean) as string[] } }, { igMediaId: { in: picked.map((p) => p.ig).filter(Boolean) as string[] } }] },
    select: { fbPostId: true, igMediaId: true, caption: true, title: true },
  });
  const errors: string[] = [];
  let prepared = 0;
  // عنوان التصميم لكل منشور، والنص المحسّن يُستخدم فقط إن لم توجد صياغة معتمدة من «مراجعة الصفحة»
  const polished = await polish(picked.map((p) => ({ key: p.key, text: p.text })));
  for (const p of picked) {
    try {
      const img = await download(p.picture!);
      const audit = audits.find((a) => (p.fb && a.fbPostId === p.fb) || (p.ig && a.igMediaId === p.ig));
      const pol = polished.get(p.key);
      const caption = humanizeClean(audit?.caption || pol?.caption || p.text || "من أعمال صدى الجنوب للمقاولات الإنشائية").text;
      const title = (pol?.headline || firstLine(audit?.caption || p.text || "")).slice(0, 120);
      // الصورة الأصلية ← مكتبة الوسائط (تُستخدم في التصميم وتبقى للمستقبل)
      const one = new FormData();
      one.append("files", new File([new Uint8Array(img.buf)], `relaunch-${p.fb ?? p.ig}.${img.type.split("/")[1]}`, { type: img.type }));
      await saveAttachments(one, "media_asset", 0, userId);
      const att = await db.attachment.findFirst({ where: { entityType: "media_asset", entityId: 0, uploadedById: userId }, orderBy: { id: "desc" } });
      if (!att) throw new Error("تعذر حفظ الصورة");
      const asset = await db.mediaAsset.create({ data: { title: `${title} (منشور ${p.at.slice(0, 10)})`, category: "PROJECT", tags: "إعادة إطلاق", attachmentId: att.id, createdById: userId } });
      await db.attachment.update({ where: { id: att.id }, data: { entityId: asset.id } });
      const ref: RelaunchRef = { fb: p.fb, ig: p.ig, fbLink: p.fbLink, igLink: p.igLink, at: p.at };
      const item = await db.marketingItem.create({
        data: {
          kind: "POST",
          source: "RELAUNCH",
          category: "ACHIEVEMENT",
          title,
          idea: p.text || null,
          caption,
          status: "IN_REVIEW",
          scheduledFor: next,
          publishAt: next,
          relaunchOf: JSON.stringify(ref),
          createdById: userId,
          chat: [],
          publishLog: `إعادة إطلاق منشور ${p.at.slice(0, 10)} — ${[p.fbLink, p.igLink].filter(Boolean).join(" ")}`,
        },
      });
      await composeItem(item.id, { template: "auto", mediaIds: [asset.id], headline: title }, userId);
      next = addDays(next, every);
      prepared++;
    } catch (e) {
      errors.push(`${firstLine(p.text)}: ${e instanceof Error ? e.message : e}`);
    }
  }
  return { prepared, remaining: Math.max(0, todo.length - picked.length), errors };
}

/** حذف المنشور القديم بعد نشر النسخة الجديدة — فيسبوك عبر API، وإنستغرام إن سمحت Meta وإلا يدوياً برابطه */
export async function retireOld(itemId: number) {
  const it = await db.marketingItem.findUnique({ where: { id: itemId } });
  if (!it?.relaunchOf) throw new MetaError("INPUT", "هذا العنصر ليس إعادة إطلاق");
  if (it.status !== "PUBLISHED") throw new MetaError("INPUT", "انشر النسخة الجديدة أولاً ثم احذف القديم");
  const ref = JSON.parse(it.relaunchOf) as RelaunchRef;
  const retired = { ...(ref.retired ?? {}) };
  const log: string[] = [];
  if (ref.fb && !retired.fb) {
    try {
      await callMeta("DELETE", ref.fb);
      retired.fb = new Date().toISOString();
      log.push("✓ حُذف المنشور القديم من فيسبوك");
    } catch (e) {
      log.push(`✗ فيسبوك: ${e instanceof Error ? e.message : e}`);
    }
  }
  if (ref.ig && !retired.ig) {
    try {
      await callMeta("DELETE", ref.ig);
      retired.ig = new Date().toISOString();
      log.push("✓ حُذف المنشور القديم من إنستغرام");
    } catch {
      log.push(`إنستغرام لم يسمح بالحذف عبر API — أرشفه من التطبيق (⋯ ← أرشفة) ثم اضغط «تمت الأرشفة»: ${ref.igLink ?? ""}`);
    }
  }
  await db.marketingItem.update({ where: { id: itemId }, data: { relaunchOf: JSON.stringify({ ...ref, retired }), publishLog: `${it.publishLog ?? ""}\n${log.join("\n")}`.trim() } });
  return log;
}

/** تأكيد الأرشفة اليدوية للمنشور القديم على إنستغرام */
export async function markIgRetired(itemId: number) {
  const it = await db.marketingItem.findUnique({ where: { id: itemId } });
  if (!it?.relaunchOf) return;
  const ref = JSON.parse(it.relaunchOf) as RelaunchRef;
  await db.marketingItem.update({ where: { id: itemId }, data: { relaunchOf: JSON.stringify({ ...ref, retired: { ...(ref.retired ?? {}), ig: `manual:${new Date().toISOString()}` } }) } });
}

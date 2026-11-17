import "server-only";
import { db } from "./db";
import { callMeta, getMetaConfig, MetaError } from "./meta";
import { writeJson } from "./ai/writer";

/**
 * مركز الحسابات: لقطة حية لمنشورات فيسبوك وإنستغرام + الأداء + حكم المحلل الذكي لكل منشور:
 *   KEEP (يبقى) · IMPROVE (يُحسّن نصه/تصميمه) · HIDE (يُخفى/يؤرشف) · DELETE (يُحذف) · BOOST (يستحق التمويل)
 * الحكم مبني على الأداء النسبي مقارنة بمتوسط الحساب، والجودة، والتكرار، ووجود نسخة أحدث من «إعادة الإطلاق».
 */
export const VERDICT: Record<string, { label: string; tone: "green" | "blue" | "orange" | "red" | "purple" }> = {
  KEEP: { label: "يبقى", tone: "green" },
  IMPROVE: { label: "يُحسّن", tone: "blue" },
  HIDE: { label: "يُخفى", tone: "orange" },
  DELETE: { label: "يُحذف", tone: "red" },
  BOOST: { label: "يستحق التمويل", tone: "purple" },
};

export type Metrics = { likes: number; comments: number; shares: number; views?: number; engagement: number };

type FbRaw = { id: string; message?: string; created_time: string; full_picture?: string; permalink_url?: string; status_type?: string; from?: { id: string }; attachments?: { data?: { media_type?: string; type?: string }[] }; reactions?: { summary?: { total_count?: number } }; comments?: { summary?: { total_count?: number } }; shares?: { count?: number } };
type IgRaw = { id: string; caption?: string; media_type?: string; media_product_type?: string; media_url?: string; thumbnail_url?: string; permalink?: string; timestamp: string; like_count?: number; comments_count?: number };

/** سحب آخر المنشورات من المنصتين وتحديث اللقطة في قاعدة البيانات */
export async function syncSocial(limit = 50) {
  const cfg = await getMetaConfig();
  if (!cfg) throw new MetaError("AUTH", "لم تُربط الصفحة بعد — اربطها من إعدادات النظام");
  const errors: string[] = [];
  const seen: { FB: string[]; IG: string[] } = { FB: [], IG: [] };
  try {
    const r = await callMeta<{ data: FbRaw[] }>("GET", `${cfg.pageId}/posts`, {
      fields: "id,message,created_time,full_picture,permalink_url,status_type,from{id},attachments{media_type,type},reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0),shares",
      limit: String(limit),
    });
    for (const p of r.data ?? []) {
      if (p.from && p.from.id !== cfg.pageId) continue;
      const media = p.attachments?.data?.[0]?.media_type?.toUpperCase();
      const m: Metrics = { likes: p.reactions?.summary?.total_count ?? 0, comments: p.comments?.summary?.total_count ?? 0, shares: p.shares?.count ?? 0, engagement: 0 };
      m.engagement = m.likes + m.comments * 3 + m.shares * 5;
      seen.FB.push(p.id);
      const data = { platform: "FB", mediaType: media === "VIDEO" ? "VIDEO" : media === "ALBUM" ? "CAROUSEL" : p.full_picture ? "IMAGE" : "TEXT", text: p.message ?? null, picture: p.full_picture ?? null, permalink: p.permalink_url ?? null, postedAt: new Date(p.created_time), metrics: m, gone: false, fetchedAt: new Date() };
      await db.socialPost.upsert({ where: { id: p.id }, create: { id: p.id, ...data }, update: data });
    }
  } catch (e) {
    errors.push(`فيسبوك: ${e instanceof Error ? e.message : e}`);
  }
  if (cfg.igUserId) {
    try {
      const r = await callMeta<{ data: IgRaw[] }>("GET", `${cfg.igUserId}/media`, { fields: "id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count", limit: String(limit) });
      for (const p of r.data ?? []) {
        const m: Metrics = { likes: p.like_count ?? 0, comments: p.comments_count ?? 0, shares: 0, engagement: 0 };
        m.engagement = m.likes + m.comments * 3;
        seen.IG.push(p.id);
        const type = p.media_product_type === "REELS" ? "REEL" : p.media_type === "CAROUSEL_ALBUM" ? "CAROUSEL" : p.media_type === "VIDEO" ? "VIDEO" : "IMAGE";
        const data = { platform: "IG", mediaType: type, text: p.caption ?? null, picture: p.media_type === "VIDEO" ? (p.thumbnail_url ?? null) : (p.media_url ?? p.thumbnail_url ?? null), permalink: p.permalink ?? null, postedAt: new Date(p.timestamp), metrics: m, gone: false, fetchedAt: new Date() };
        await db.socialPost.upsert({ where: { id: p.id }, create: { id: p.id, ...data }, update: data });
      }
    } catch (e) {
      errors.push(`إنستغرام: ${e instanceof Error ? e.message : e}`);
    }
  }
  // ما لم يعد موجوداً على الحساب (ضمن نافذة السحب) = حُذف أو أُرشف
  for (const pf of ["FB", "IG"] as const) {
    if (!seen[pf].length) continue;
    const oldest = await db.socialPost.findFirst({ where: { id: { in: seen[pf] } }, orderBy: { postedAt: "asc" }, select: { postedAt: true } });
    if (oldest) await db.socialPost.updateMany({ where: { platform: pf, id: { notIn: seen[pf] }, postedAt: { gte: oldest.postedAt }, gone: false }, data: { gone: true } });
  }
  const [followers, fans] = await Promise.all([
    cfg.igUserId ? callMeta<{ followers_count?: number; media_count?: number; username?: string }>("GET", cfg.igUserId, { fields: "followers_count,media_count,username" }).catch(() => null) : null,
    callMeta<{ followers_count?: number; fan_count?: number; name?: string }>("GET", cfg.pageId, { fields: "followers_count,fan_count,name" }).catch(() => null),
  ]);
  return { fb: seen.FB.length, ig: seen.IG.length, errors, accounts: { facebook: fans, instagram: followers } };
}

const SYS = `أنت مدير حسابات تواصل اجتماعي خبير لشركة «صدى الجنوب للمقاولات الإنشائية» (أردنية، مصنفة درجة رابعة).
مهمتك: الحكم على كل منشور قائم في الحساب لبناء صفحة احترافية ككتالوج هندسي:
- KEEP: منشور جيد يمثل الشركة (عمل حقيقي، صورة واضحة، نص لائق).
- IMPROVE: الفكرة جيدة لكن النص أو التصميم ضعيف — يُعاد إطلاقه بقالب الشركة.
- HIDE: لا يليق بالصورة الاحترافية لكن لا داعي لحذفه (قديم جداً، صورة ضعيفة، خارج التخصص كإعلان بيع أرض، فكاهي) — يُخفى/يؤرشف.
- DELETE: مكرر، أو له نسخة أحدث منشورة، أو صورة رديئة جداً، أو محتوى قد يضر بالسمعة.
- BOOST: أداؤه أعلى بوضوح من متوسط الحساب ويعرض عملاً حقيقياً أو خدمة واضحة — يستحق تمويلاً إعلانياً.
boostScore من 0 إلى 100 = جدارة التمويل (الأداء النسبي، الجودة، وضوح الدعوة للتواصل، صلته بخدمة مطلوبة). اكتب السبب بجملة أو جملتين بالدليل (الأرقام مقارنة بالمتوسط). لا تخترع أرقاماً.`;

/** تحليل المنشورات (الجديدة أو التي تغيرت أرقامها) بدفعات متوازية */
export async function analyzeSocial(opts: { all?: boolean } = {}) {
  const posts = await db.socialPost.findMany({ where: { gone: false, ...(opts.all ? {} : { OR: [{ analyzedAt: null }, { analyzedAt: { lt: new Date(Date.now() - 3 * 86400_000) } }] }) }, orderBy: { postedAt: "desc" }, take: 80 });
  if (!posts.length) return { analyzed: 0 };
  const all = await db.socialPost.findMany({ where: { gone: false }, select: { platform: true, metrics: true } });
  const avg = (pf: string) => {
    const xs = all.filter((p) => p.platform === pf).map((p) => (p.metrics as Metrics | null)?.engagement ?? 0);
    return xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : 0;
  };
  const avgs = { FB: avg("FB"), IG: avg("IG") };
  // نسخ «إعادة الإطلاق» المنشورة: المنشور الأصلي له بديل أحدث
  const relaunched = await db.marketingItem.findMany({ where: { relaunchOf: { not: null }, status: "PUBLISHED" }, select: { relaunchOf: true, fbPostId: true, igMediaId: true } });
  const replaced = new Set<string>();
  const ours = new Set<string>();
  for (const r of relaunched) {
    const ref = JSON.parse(r.relaunchOf!) as { fb?: string; ig?: string };
    if (ref.fb) replaced.add(ref.fb);
    if (ref.ig) replaced.add(ref.ig);
  }
  (await db.marketingItem.findMany({ where: { status: "PUBLISHED" }, select: { fbPostId: true, igMediaId: true } })).forEach((m) => [m.fbPostId, m.igMediaId].forEach((x) => x && ours.add(x)));
  const fbShort = (id: string) => id.split("_").pop()!;
  const isOurs = (id: string) => ours.has(id) || [...ours].some((o) => fbShort(o) === fbShort(id));

  let analyzed = 0;
  const batches: (typeof posts)[] = [];
  for (let i = 0; i < posts.length; i += 10) batches.push(posts.slice(i, i + 10));
  await Promise.allSettled(
    batches.map(async (batch) => {
      const { data } = await writeJson<{ results: { id: string; verdict: string; reason: string; boostScore: number }[] }>({
        system: SYS,
        effort: "low",
        timeoutMs: 80_000,
        maxTokens: 6000,
        schema: { type: "object", properties: { results: { type: "array", items: { type: "object", properties: { id: { type: "string" }, verdict: { type: "string", enum: Object.keys(VERDICT) }, reason: { type: "string" }, boostScore: { type: "integer" } } } } } },
        turns: [
          {
            role: "user",
            text: `متوسط التفاعل الموزون (إعجاب + 3×تعليق + 5×مشاركة): فيسبوك ${avgs.FB} — إنستغرام ${avgs.IG}\n\n${batch
              .map((p) => {
                const m = (p.metrics as Metrics | null) ?? { likes: 0, comments: 0, shares: 0, engagement: 0 };
                const flags = [replaced.has(p.id) ? "له نسخة أحدث منشورة من النظام (إعادة إطلاق)" : "", isOurs(p.id) ? "منشور حديث من النظام بقالب الشركة" : "", !p.picture ? "بلا صورة" : ""].filter(Boolean).join("، ");
                return `### id=${p.id} | ${p.platform === "FB" ? "فيسبوك" : "إنستغرام"} | ${p.mediaType} | ${p.postedAt.toISOString().slice(0, 10)} | إعجاب ${m.likes} تعليق ${m.comments} مشاركة ${m.shares} (تفاعل ${m.engagement})${flags ? ` | ${flags}` : ""}\n${(p.text ?? "— بلا نص —").slice(0, 500)}`;
              })
              .join("\n\n")}`,
          },
        ],
      });
      for (const r of data.results ?? []) {
        const p = batch.find((x) => x.id === r.id);
        if (!p) continue;
        // قواعد ثابتة فوق رأي النموذج: الأصل المستبدل يُحذف، ومنشورات النظام الحديثة لا تُحذف
        let verdict = r.verdict in VERDICT ? r.verdict : "KEEP";
        let reason = r.reason?.slice(0, 500) ?? "";
        let score = Math.max(0, Math.min(100, Math.round(r.boostScore ?? 0)));
        const ageDays = (Date.now() - +p.postedAt) / 86400_000;
        if (replaced.has(p.id)) {
          verdict = "DELETE";
          score = 0;
          reason = "نُشرت نسخة أحدث منه بقالب الشركة (إعادة إطلاق) — احذف الأصل لتجنب التكرار في الشبكة.";
        } else if (isOurs(p.id) && (verdict === "DELETE" || verdict === "HIDE")) {
          verdict = "IMPROVE";
          reason = `منشور حديث من النظام — ${reason}`.slice(0, 500);
        }
        // التمويل يحتاج دليلاً: منشور عمره أقل من 3 أيام لا يُحكم عليه بالتمويل بعد
        if (ageDays < 3) {
          score = Math.min(score, 40);
          if (verdict === "BOOST") {
            verdict = "KEEP";
            reason = `جديد (أقل من 3 أيام) — يُعاد تقييم جدارة التمويل بعد تجمّع التفاعل. ${reason}`.slice(0, 500);
          }
        }
        await db.socialPost.update({ where: { id: p.id }, data: { verdict, reason, boostScore: score, analyzedAt: new Date() } });
        analyzed++;
      }
    }),
  );
  return { analyzed };
}

/** ملخص للعرض وللمساعد الذكي */
export async function socialSnapshot() {
  const posts = await db.socialPost.findMany({ where: { gone: false }, orderBy: { postedAt: "desc" } });
  const by = (pf: string) => posts.filter((p) => p.platform === pf);
  const count = (v: string) => posts.filter((p) => p.verdict === v && !p.decision).length;
  return {
    totals: { facebook: by("FB").length, instagram: by("IG").length },
    pending: Object.fromEntries(Object.keys(VERDICT).map((v) => [v, count(v)])),
    topBoost: posts.filter((p) => (p.boostScore ?? 0) >= 60).sort((a, b) => (b.boostScore ?? 0) - (a.boostScore ?? 0)).slice(0, 5).map((p) => ({ id: p.id, platform: p.platform, score: p.boostScore, reason: p.reason, text: p.text?.slice(0, 120) })),
    toDelete: posts.filter((p) => p.verdict === "DELETE" && !p.decision).map((p) => ({ id: p.id, platform: p.platform, reason: p.reason, text: p.text?.slice(0, 100) })),
  };
}

/** تنفيذ قرار: حذف أو إخفاء (فيسبوك عبر API؛ إنستغرام يحاول ثم يطلب الأرشفة اليدوية) */
export async function applyDecision(id: string, action: "DELETE" | "HIDE" | "IGNORE") {
  const p = await db.socialPost.findUnique({ where: { id } });
  if (!p) throw new MetaError("INPUT", "المنشور غير موجود في اللقطة — حدّث الحسابات");
  if (action === "IGNORE") {
    await db.socialPost.update({ where: { id }, data: { decision: "IGNORED" } });
    return "تُجوهل الحكم — يبقى المنشور كما هو";
  }
  if (action === "DELETE") {
    try {
      await callMeta("DELETE", id);
    } catch (e) {
      if (p.platform === "IG") return `إنستغرام لم يسمح بالحذف عبر API — احذفه أو أرشفه من التطبيق: ${p.permalink ?? ""}`;
      throw e;
    }
    await db.socialPost.update({ where: { id }, data: { decision: "DONE", gone: true } });
    return `حُذف المنشور من ${p.platform === "FB" ? "فيسبوك" : "إنستغرام"}`;
  }
  // HIDE: فيسبوك يدعم إخفاء منشور الصفحة من الجدول الزمني
  if (p.platform === "FB") {
    await callMeta("POST", id, { is_hidden: "true" });
    await db.socialPost.update({ where: { id }, data: { decision: "DONE" } });
    return "أُخفي المنشور من صفحة فيسبوك (يمكن إظهاره لاحقاً)";
  }
  return `إنستغرام: الأرشفة من التطبيق فقط (⋯ ← أرشفة) — ${p.permalink ?? ""}`;
}

import "server-only";
import { db } from "./db";
import { callMeta, getMetaConfig, MetaError } from "./meta";
import { writeJson } from "./ai/writer";
import { detect, humanizeClean, structuralFlags } from "./content-skills/humanizer";
import { HUMAN_RULES } from "./content-skills/skills";
import { checkFacts } from "./content-skills/fact-guard";
import { knownNames } from "./content-skills/known-names";

/**
 * مراجعة المحتوى الحالي على صفحة فيسبوك وحساب إنستغرام:
 *  يسحب آخر المنشورات ← يفحص البصمة البشرية ← يقترح صياغة محسّنة بنفس الحقائق حرفياً (لا أرقام ولا تفاصيل جديدة)
 *  ← تُعرض للمراجعة في التسويق (المصدر AUDIT_FB / AUDIT_IG) ← تطبيق على فيسبوك بضغطة (تعديل المنشور نفسه)،
 *  وإنستغرام يدوياً (واجهة Meta لا تسمح بتعديل نص منشور إنستغرام).
 */
type Post = { platform: "FB" | "IG"; id: string; text: string; at: string; picture?: string; permalink?: string };

async function fetchPosts(limit: number): Promise<{ posts: Post[]; errors: string[] }> {
  const cfg = await getMetaConfig();
  if (!cfg) throw new MetaError("AUTH", "لم تُربط الصفحة بعد");
  const posts: Post[] = [];
  const errors: string[] = [];
  try {
    const r = await callMeta<{ data: { id: string; message?: string; created_time: string; full_picture?: string; permalink_url?: string; from?: { id: string } }[] }>("GET", `${cfg.pageId}/posts`, { fields: "id,message,created_time,full_picture,permalink_url,from{id}", limit: String(limit) });
    for (const p of r.data ?? []) if (p.message?.trim() && (!p.from || p.from.id === cfg.pageId)) posts.push({ platform: "FB", id: p.id, text: p.message, at: p.created_time, picture: p.full_picture, permalink: p.permalink_url });
  } catch (e) {
    errors.push(`فيسبوك: ${e instanceof Error ? e.message : e}`);
  }
  if (cfg.igUserId) {
    try {
      const r = await callMeta<{ data: { id: string; caption?: string; timestamp: string; media_url?: string; thumbnail_url?: string; permalink?: string }[] }>("GET", `${cfg.igUserId}/media`, { fields: "id,caption,timestamp,media_url,thumbnail_url,permalink", limit: String(limit) });
      for (const p of r.data ?? []) if (p.caption?.trim()) posts.push({ platform: "IG", id: p.id, text: p.caption, at: p.timestamp, picture: p.thumbnail_url ?? p.media_url, permalink: p.permalink });
    } catch (e) {
      errors.push(`إنستغرام: ${e instanceof Error ? e.message : e}`);
    }
  }
  return { posts, errors };
}

export const SYS = `أنت محرر أول لمحتوى «صدى الجنوب للمقاولات الإنشائية» على فيسبوك وإنستغرام. مهمتك تحسين منشورات منشورة فعلاً.
قواعد لا استثناء لها:
1. حافظ على كل الحقائق حرفياً: الأسماء، الأماكن، الأرقام، التواريخ، أرقام الهواتف، الروابط. ممنوع إضافة أي رقم أو مشروع أو تفصيل أو وعد غير موجود في النص الأصلي.
2. حسّن الصياغة فقط: فخامة هندسية، وضوح، خطاف أقوى في السطر الأول، فقرات قصيرة، دعوة فعل واحدة إن وُجدت أصلاً.
3. المناسبات الحساسة (تعزية، استنكار) تبقى رصينة بلا وسوم ولا دعوة فعل.
4. إن كان المنشور ممتازاً أصلاً فأعده كما هو وضع keep=true.
${HUMAN_RULES}`;

export async function auditPage(userId: number, limit = 25) {
  const { posts, errors } = await fetchPosts(limit);
  const done = new Set(
    (await db.marketingItem.findMany({ where: { source: { in: ["AUDIT_FB", "AUDIT_IG"] } }, select: { fbPostId: true, igMediaId: true } })).flatMap((x) => [x.fbPostId, x.igMediaId]).filter(Boolean) as string[],
  );
  const todo = posts.filter((p) => !done.has(p.id));
  const names = await knownNames();
  let created = 0;
  let kept = 0;
  for (let i = 0; i < todo.length; i += 6) {
    const batch = todo.slice(i, i + 6);
    const { data, model } = await writeJson<{ results: { id: string; keep: boolean; rewrite: string; notes: string; title: string }[] }>({
      system: SYS,
      effort: "medium",
      schema: { type: "object", properties: { results: { type: "array", items: { type: "object", properties: { id: { type: "string" }, keep: { type: "boolean" }, title: { type: "string", description: "عنوان داخلي قصير" }, rewrite: { type: "string" }, notes: { type: "string", description: "ما الذي تحسّن ولماذا، باختصار" } } } } } },
      turns: [{ role: "user", text: batch.map((p) => `### id=${p.id} (${p.platform === "FB" ? "فيسبوك" : "إنستغرام"}، ${p.at.slice(0, 10)})\n${p.text}`).join("\n\n") }],
    });
    for (const p of batch) {
      const r = data.results?.find((x) => x.id === p.id);
      if (!r) continue;
      let proposal = humanizeClean(r.keep ? p.text : r.rewrite || p.text).text;
      // حارس الحقائق: صياغة فقدت رقماً أو اسماً أو أضافت رقماً تُرفض ويبقى الأصل مع ملاحظة
      const fc = checkFacts(p.text, proposal, names);
      if (!fc.ok) {
        r.notes = `رُفضت الصياغة المقترحة (حارس الحقائق: ${[...fc.missing, ...fc.added].join("، ")}) — أُبقي الأصل`;
        proposal = humanizeClean(p.text).text;
      }
      const before = detect(p.text);
      const after = detect(proposal);
      if (r.keep) kept++;
      await db.marketingItem.create({
        data: {
          kind: "POST",
          source: p.platform === "FB" ? "AUDIT_FB" : "AUDIT_IG",
          category: "BRAND",
          title: (r.title || p.text.split("\n")[0]).slice(0, 120),
          idea: p.text,
          caption: proposal,
          status: r.keep && proposal === p.text ? "PUBLISHED" : "IN_REVIEW",
          fbPostId: p.platform === "FB" ? p.id : null,
          igMediaId: p.platform === "IG" ? p.id : null,
          imageUrl: p.picture ?? null,
          aiModel: model,
          createdById: userId,
          publishedAt: new Date(p.at),
          publishLog: `${p.permalink ?? ""}\nالبصمة البشرية: ${before.overall} ← ${after.overall}${structuralFlags(p.text).length ? ` — أنماط في الأصل: ${structuralFlags(p.text).map((f) => f.name).join("، ")}` : ""}\n${r.notes}`.trim(),
          chat: [],
        },
      });
      created++;
    }
  }
  return { fetched: posts.length, reviewed: created, kept, skipped: posts.length - todo.length, errors };
}

/** تطبيق الصياغة المعتمدة على منشور فيسبوك القائم (تعديل نص المنشور نفسه) */
export async function applyToFacebook(itemId: number) {
  const it = await db.marketingItem.findUnique({ where: { id: itemId } });
  if (!it || it.source !== "AUDIT_FB" || !it.fbPostId) throw new MetaError("INPUT", "هذا العنصر ليس مراجعة لمنشور فيسبوك");
  const text = humanizeClean(it.caption).text;
  await callMeta("POST", it.fbPostId, { message: text });
  await db.marketingItem.update({ where: { id: itemId }, data: { status: "PUBLISHED", caption: text, publishLog: `${it.publishLog ?? ""}\n✓ عُدّل المنشور على فيسبوك ${new Date().toISOString().slice(0, 16).replace("T", " ")}` } });
}

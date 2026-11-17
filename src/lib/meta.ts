import "server-only";
import { db } from "./db";
import { readAttachmentData } from "./uploads";
import { getSecret, patchSecretMeta, setSecret } from "./secret-box";

/**
 * تكامل Meta Graph API: نشر المنشورات والقصص على فيسبوك وإنستغرام، وقراءة التعليقات والرد عليها.
 *
 * مصدر الإعداد (بالأولوية):
 *   1) متغيرات البيئة: META_PAGE_TOKEN (+ META_PAGE_ID، META_IG_USER_ID)
 *   2) الربط من «إعدادات النظام»: رمز مشفّر AES-256-GCM في IntegrationSecret («meta»)
 * الصلاحيات المطلوبة للرمز: pages_show_list, pages_read_engagement, pages_manage_posts,
 *   pages_manage_engagement, instagram_basic, instagram_content_publish, instagram_manage_comments
 *
 * معالجة الأخطاء: تصنيف كل خطأ (رمز منتهٍ، صلاحية ناقصة، حد استخدام، انقطاع شبكة، مدخل غير صالح)،
 * إعادة المحاولة تلقائياً للأخطاء المؤقتة، وعند انتهاء الرمز تُعلَّم الحالة «غير صالح» ويُنبَّه المدير العام مرة واحدة.
 */
export const DEFAULT_PAGE_ID = "106112717962500";
const V = () => process.env.META_GRAPH_VERSION || "v23.0";
const SECRET = "meta";
const PUBLIC_BUCKET = "sada-marketing";

export type MetaConfig = { pageId: string; token: string; igUserId: string | null; source: "env" | "settings"; pageName?: string; igUsername?: string };
/** الصلاحيات اللازمة لكل وظائف النظام (النشر، التعليقات، إنستغرام) */
export const REQUIRED_SCOPES = ["pages_show_list", "pages_read_engagement", "pages_manage_posts", "pages_manage_engagement", "instagram_basic", "instagram_content_publish", "instagram_manage_comments"];
export type MetaStatus = { missingScopes?: string[]; ok: boolean; checkedAt?: string; error?: string; errorKind?: MetaErrorKind; pageName?: string; igUsername?: string; expiresAt?: string | null; connectedBy?: string; connectedAt?: string };

export async function getMetaConfig(): Promise<MetaConfig | null> {
  if (process.env.META_PAGE_TOKEN) {
    return { pageId: process.env.META_PAGE_ID || DEFAULT_PAGE_ID, token: process.env.META_PAGE_TOKEN, igUserId: process.env.META_IG_USER_ID || null, source: "env" };
  }
  const s = await getSecret<{ pageId: string; token: string; igUserId: string | null }>(SECRET);
  if (!s?.value.token) return null;
  return { ...s.value, source: "settings", pageName: s.meta.pageName as string | undefined, igUsername: s.meta.igUsername as string | undefined };
}
export async function metaStatus(): Promise<(MetaStatus & { configured: boolean; source?: "env" | "settings"; pageId?: string; hasInstagram?: boolean }) | null> {
  const cfg = await getMetaConfig();
  if (!cfg) return { ok: false, configured: false };
  const s = cfg.source === "settings" ? await getSecret(SECRET) : null;
  return { ...(s?.meta as MetaStatus | undefined), ok: (s?.meta as MetaStatus | undefined)?.ok ?? true, configured: true, source: cfg.source, pageId: cfg.pageId, hasInstagram: !!cfg.igUserId };
}
export const metaConfigured = async () => !!(await getMetaConfig());

// ───────── الأخطاء ─────────
export type MetaErrorKind = "AUTH" | "PERMISSION" | "RATE" | "NETWORK" | "INPUT" | "NOT_READY" | "UNKNOWN";
const KIND_AR: Record<MetaErrorKind, string> = {
  AUTH: "رمز الوصول منتهٍ أو غير صالح — أعد الربط من إعدادات النظام",
  PERMISSION: "الرمز ينقصه صلاحية لهذه العملية",
  RATE: "تجاوزنا حد الاستخدام المؤقت لدى Meta — يُعاد لاحقاً",
  NETWORK: "تعذر الاتصال بخوادم Meta",
  INPUT: "رفضت Meta المحتوى المرسل",
  NOT_READY: "إنستغرام لم ينتهِ من معالجة الصورة",
  UNKNOWN: "خطأ غير متوقع من Meta",
};
export class MetaError extends Error {
  constructor(
    public kind: MetaErrorKind,
    public detail: string,
    public code?: number,
  ) {
    super(`${KIND_AR[kind]}${detail ? ` (${detail})` : ""}`);
  }
  get retryable() {
    return this.kind === "RATE" || this.kind === "NETWORK" || this.kind === "NOT_READY";
  }
}

function classify(status: number, err: { code?: number; error_subcode?: number; message?: string; type?: string; is_transient?: boolean }): MetaError {
  const code = err.code ?? 0;
  const msg = err.message ?? `HTTP ${status}`;
  if (code === 190 || code === 102 || (code === 2500 && /token/i.test(msg)) || err.type === "OAuthException" && /expired|session|token/i.test(msg)) return new MetaError("AUTH", msg, code);
  if (code === 10 || code === 200 || (code >= 200 && code < 300) || code === 3 || (code === 100 && /permission/i.test(msg))) return new MetaError("PERMISSION", msg, code);
  if ([4, 17, 32, 613, 80001, 80002, 80004, 80006].includes(code)) return new MetaError("RATE", msg, code);
  if (err.is_transient || code === 1 || code === 2 || status >= 500) return new MetaError("NETWORK", msg, code);
  if (code === 9007 || /not ready|is not available/i.test(msg)) return new MetaError("NOT_READY", msg, code);
  if (code === 100 || code === 368 || code === 324 || code === 36003) return new MetaError("INPUT", msg, code);
  return new MetaError("UNKNOWN", msg, code);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** نداء Graph واحد مع مهلة، وإعادة محاولة (حتى مرتين) للأخطاء المؤقتة */
async function graph<T = Record<string, unknown>>(method: "GET" | "POST" | "DELETE", path: string, params: Record<string, string>, token: string, attempt = 0): Promise<T> {
  const url = new URL(`https://graph.facebook.com/${V()}/${path}`);
  const body = new URLSearchParams({ ...params, access_token: token });
  if (method === "GET") body.forEach((v, k) => url.searchParams.set(k, v));
  let res: Response;
  try {
    res = await fetch(url, { method, ...(method === "GET" ? {} : { body, headers: { "Content-Type": "application/x-www-form-urlencoded" } }), signal: AbortSignal.timeout(25_000), cache: "no-store" });
  } catch (e) {
    const err = new MetaError("NETWORK", e instanceof Error ? (e.name === "TimeoutError" ? "انتهت المهلة" : e.message) : "");
    if (attempt < 2) {
      await sleep(1000 * 3 ** attempt);
      return graph(method, path, params, token, attempt + 1);
    }
    throw err;
  }
  const json = (await res.json().catch(() => ({}))) as T & { error?: Parameters<typeof classify>[1] };
  if (!res.ok || json.error) {
    const err = classify(res.status, json.error ?? {});
    if (err.retryable && err.kind !== "NOT_READY" && attempt < 2) {
      await sleep(1500 * 3 ** attempt);
      return graph(method, path, params, token, attempt + 1);
    }
    throw err;
  }
  return json;
}

/** نداء باسم الصفحة المربوطة — عند انتهاء الرمز تُسجّل الحالة ويُنبَّه المدير العام */
export const callMeta = <T = Record<string, unknown>>(method: "GET" | "POST" | "DELETE", path: string, params: Record<string, string> = {}) => call<T>(method, path, params);
async function call<T = Record<string, unknown>>(method: "GET" | "POST" | "DELETE", path: string, params: Record<string, string> = {}): Promise<T> {
  const cfg = await getMetaConfig();
  if (!cfg) throw new MetaError("AUTH", "لم تُربط صفحة فيسبوك بعد");
  try {
    return await graph<T>(method, path, params, cfg.token);
  } catch (e) {
    if (e instanceof MetaError && (e.kind === "AUTH" || e.kind === "PERMISSION")) await markBroken(e);
    throw e;
  }
}

async function markBroken(e: MetaError) {
  const cur = await getSecret(SECRET);
  const already = cur && (cur.meta as MetaStatus).ok === false && (cur.meta as MetaStatus).errorKind === e.kind;
  await patchSecretMeta(SECRET, { ok: false, error: e.message, errorKind: e.kind, checkedAt: new Date().toISOString() });
  if (!already && e.kind === "AUTH") {
    const { notify } = await import("./notify");
    await notify(["ADMIN"], { title: "انقطع ربط فيسبوك/إنستغرام", body: `${e.message} — النشر التلقائي متوقف حتى إعادة الربط`, href: "/system#meta" });
  }
}

// ───────── الربط ─────────
/**
 * يقبل رمز صفحة، أو رمز مستخدم (يُستخرج منه رمز الصفحة)، ويحوّله لرمز طويل الأمد إن زُوّد بمعرّف التطبيق وسرّه.
 * رمز الصفحة المشتق من رمز مستخدم طويل الأمد لا تنتهي صلاحيته (إلا بتغيير كلمة المرور أو سحب الصلاحية).
 */
export async function connectMeta(input: { token: string; pageId?: string; appId?: string; appSecret?: string }, by: string) {
  const pageId = (input.pageId || DEFAULT_PAGE_ID).trim();
  let token = input.token.trim();
  if (!/^[A-Za-z0-9_\-|.]{40,}$/.test(token)) throw new MetaError("INPUT", "صيغة الرمز غير صحيحة — انسخه كاملاً");
  if (input.appId && input.appSecret) {
    const ex = await graph<{ access_token?: string }>("GET", "oauth/access_token", { grant_type: "fb_exchange_token", client_id: input.appId.trim(), client_secret: input.appSecret.trim(), fb_exchange_token: token }, token);
    if (ex.access_token) token = ex.access_token;
  }
  const me = await graph<{ id: string; name?: string }>("GET", "me", { fields: "id,name" }, token);
  let pageToken = token;
  if (me.id !== pageId) {
    // رمز مستخدم: نطلب رمز الصفحة (يتطلب أن يكون المستخدم مديراً للصفحة)
    const p = await graph<{ access_token?: string }>("GET", pageId, { fields: "access_token" }, token).catch(() => ({ access_token: undefined }));
    if (!p.access_token) throw new MetaError("PERMISSION", `الرمز لا يخص الصفحة ${pageId} ولا يملك صلاحية إدارتها`);
    pageToken = p.access_token;
  }
  const page = await graph<{ id: string; name: string; instagram_business_account?: { id: string; username?: string } }>("GET", pageId, { fields: "id,name,instagram_business_account{id,username}" }, pageToken);
  let expiresAt: string | null = null;
  let missingScopes: string[] | undefined;
  try {
    const dbg = await graph<{ data?: { expires_at?: number; scopes?: string[] } }>("GET", "debug_token", { input_token: pageToken }, pageToken);
    const exp = dbg.data?.expires_at;
    expiresAt = exp ? new Date(exp * 1000).toISOString() : null;
    if (dbg.data?.scopes) missingScopes = REQUIRED_SCOPES.filter((x) => !dbg.data!.scopes!.includes(x));
  } catch {
    /* debug_token اختياري */
  }
  const igUserId = page.instagram_business_account?.id ?? null;
  const status: MetaStatus = { ok: true, missingScopes, pageName: page.name, igUsername: page.instagram_business_account?.username, expiresAt, checkedAt: new Date().toISOString(), connectedBy: by, connectedAt: new Date().toISOString() };
  await setSecret(SECRET, { pageId, token: pageToken, igUserId }, status);
  return status;
}

/** فحص صحة الاتصال (يُستدعى من الإعدادات ومن المهمة اليومية) */
export async function checkMeta(): Promise<MetaStatus> {
  const cfg = await getMetaConfig();
  if (!cfg) return { ok: false, error: "غير مربوط" };
  try {
    const page = await graph<{ name: string; instagram_business_account?: { username?: string } }>("GET", cfg.pageId, { fields: "name,instagram_business_account{username}" }, cfg.token);
    const st: MetaStatus = { ok: true, pageName: page.name, igUsername: page.instagram_business_account?.username, checkedAt: new Date().toISOString(), error: undefined, errorKind: undefined };
    if (cfg.source === "settings") await patchSecretMeta(SECRET, st);
    return st;
  } catch (e) {
    const err = e instanceof MetaError ? e : new MetaError("UNKNOWN", String(e));
    if (cfg.source === "settings" && (err.kind === "AUTH" || err.kind === "PERMISSION")) await markBroken(err);
    return { ok: false, error: err.message, errorKind: err.kind, checkedAt: new Date().toISOString() };
  }
}

// ───────── النشر ─────────
/** إنستغرام يشترط صورة برابط عام: تُرفع صورة العنصر المعتمد لحاوية عامة عند النشر فقط */
async function publicImageUrl(itemId: number, attachmentId: number) {
  const att = await db.attachment.findUnique({ where: { id: attachmentId } });
  if (!att) throw new MetaError("INPUT", "صورة المنشور غير موجودة");
  if (!["image/jpeg", "image/png"].includes(att.mimeType)) throw new MetaError("INPUT", "إنستغرام يقبل JPG أو PNG فقط — ارفع الصورة بإحدى الصيغتين");
  const buf = await readAttachmentData(att);
  if (!buf) throw new MetaError("INPUT", "تعذر قراءة الصورة");
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/+$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) throw new MetaError("INPUT", "التخزين السحابي غير مُعد (SUPABASE_SERVICE_ROLE_KEY)");
  const path = `${itemId}-${att.id}.${att.mimeType === "image/png" ? "png" : "jpg"}`;
  const res = await fetch(`${base}/storage/v1/object/${PUBLIC_BUCKET}/${path}`, { method: "POST", headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": att.mimeType, "x-upsert": "true" }, body: new Uint8Array(buf), cache: "no-store" }).catch(() => null);
  if (!res?.ok) throw new MetaError("NETWORK", `رفع الصورة للتخزين العام فشل${res ? ` (${res.status})` : ""}`);
  return `${base}/storage/v1/object/public/${PUBLIC_BUCKET}/${path}`;
}

/** حاوية إنستغرام: انتظار انتهاء المعالجة قبل النشر (حتى ~40 ثانية) */
async function igPublish(igUserId: string, params: Record<string, string>) {
  const c = await call<{ id: string }>("POST", `${igUserId}/media`, params);
  for (let i = 0; i < 12; i++) {
    const s = await call<{ status_code?: string; status?: string }>("GET", c.id, { fields: "status_code,status" });
    if (s.status_code === "FINISHED" || !s.status_code) break;
    if (s.status_code === "ERROR" || s.status_code === "EXPIRED") throw new MetaError("INPUT", `إنستغرام رفض الوسائط: ${s.status ?? s.status_code}`);
    await sleep(i < 3 ? 2000 : 4000);
  }
  for (let i = 0; ; i++) {
    try {
      return await call<{ id: string }>("POST", `${igUserId}/media_publish`, { creation_id: c.id });
    } catch (e) {
      if (e instanceof MetaError && e.kind === "NOT_READY" && i < 4) {
        await sleep(5000);
        continue;
      }
      throw e;
    }
  }
}

export type PublishResult = { fbPostId?: string; igMediaId?: string; imageUrl?: string; log: string[]; partial: boolean };

export async function publishToMeta(item: { id: number; kind: string; caption: string; hashtags: string | null; imageAttachmentId: number | null; slides?: number[] }): Promise<PublishResult> {
  const cfg = await getMetaConfig();
  if (!cfg) throw new MetaError("AUTH", "لم تُربط صفحة فيسبوك بعد — اربطها من إعدادات النظام");
  const log: string[] = [];
  const text = [item.caption, item.hashtags].filter(Boolean).join("\n\n");
  const imageUrl = item.imageAttachmentId ? await publicImageUrl(item.id, item.imageAttachmentId) : undefined;
  const out: PublishResult = { imageUrl, log, partial: false };
  const errors: MetaError[] = [];
  const attempt = async (label: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      const err = e instanceof MetaError ? e : new MetaError("UNKNOWN", e instanceof Error ? e.message : String(e));
      errors.push(err);
      log.push(`${label}: ✗ ${err.message}`);
    }
  };

  if (item.kind === "STORY") {
    if (!imageUrl) throw new MetaError("INPUT", "القصة تحتاج صورة تصميم — ارفعها أولاً");
    await attempt("قصة فيسبوك", async () => {
      const photo = await call<{ id: string }>("POST", `${cfg.pageId}/photos`, { url: imageUrl, published: "false" });
      const story = await call<{ post_id?: string; id?: string }>("POST", `${cfg.pageId}/photo_stories`, { photo_id: photo.id });
      out.fbPostId = story.post_id ?? story.id;
      log.push("قصة فيسبوك: ✓");
    });
    if (cfg.igUserId)
      await attempt("قصة إنستغرام", async () => {
        out.igMediaId = (await igPublish(cfg.igUserId!, { image_url: imageUrl, media_type: "STORIES" })).id;
        log.push("قصة إنستغرام: ✓");
      });
  } else if ((item.slides?.length ?? 0) > 1) {
    // كاروسيل: كل الشرائح بروابط عامة، ثم منشور فيسبوك متعدد الصور + كاروسيل إنستغرام (حتى 10)
    const urls: string[] = [];
    for (const a of item.slides!.slice(0, 10)) urls.push(await publicImageUrl(item.id, a));
    out.imageUrl = urls[0];
    await attempt("ألبوم فيسبوك", async () => {
      const media: Record<string, string> = { message: text };
      for (let i = 0; i < urls.length; i++) {
        const ph = await call<{ id: string }>("POST", `${cfg.pageId}/photos`, { url: urls[i], published: "false" });
        media[`attached_media[${i}]`] = JSON.stringify({ media_fbid: ph.id });
      }
      const r = await call<{ id: string }>("POST", `${cfg.pageId}/feed`, media);
      out.fbPostId = r.id;
      log.push(`ألبوم فيسبوك (${urls.length} صور): ✓`);
    });
    if (cfg.igUserId)
      await attempt("كاروسيل إنستغرام", async () => {
        const children: string[] = [];
        for (const u of urls) children.push((await call<{ id: string }>("POST", `${cfg.igUserId}/media`, { image_url: u, is_carousel_item: "true" })).id);
        out.igMediaId = (await igPublish(cfg.igUserId!, { media_type: "CAROUSEL", children: children.join(","), caption: text })).id;
        log.push(`كاروسيل إنستغرام (${urls.length} شرائح): ✓`);
      });
  } else {
    await attempt("منشور فيسبوك", async () => {
      const r = imageUrl ? await call<{ id: string; post_id?: string }>("POST", `${cfg.pageId}/photos`, { url: imageUrl, caption: text }) : await call<{ id: string; post_id?: string }>("POST", `${cfg.pageId}/feed`, { message: text });
      // صورة الصفحة تُرجع post_id (المنشور) و id (الصورة) — التعليقات على المنشور
      out.fbPostId = r.post_id ?? r.id;
      log.push("منشور فيسبوك: ✓");
    });
    if (cfg.igUserId) {
      if (!imageUrl) log.push("إنستغرام: تخطي — إنستغرام يتطلب صورة");
      else
        await attempt("منشور إنستغرام", async () => {
          out.igMediaId = (await igPublish(cfg.igUserId!, { image_url: imageUrl, caption: text })).id;
          log.push("منشور إنستغرام: ✓");
        });
    }
  }
  if (!out.fbPostId && !out.igMediaId) {
    // لم ينجح أي نشر: يُرفع أخطر خطأ (الرمز أولاً)
    throw errors.find((e) => e.kind === "AUTH") ?? errors.find((e) => e.kind === "PERMISSION") ?? errors[0] ?? new MetaError("UNKNOWN", "لم يُنشر شيء");
  }
  out.partial = errors.length > 0;
  return out;
}

// ───────── التعليقات ─────────
export type MetaComment = { id: string; platform: "facebook" | "instagram"; author: string; text: string; at: string; replies: { id: string; author: string; text: string; at: string; mine: boolean }[] };

export async function fetchComments(item: { fbPostId: string | null; igMediaId: string | null; kind: string }): Promise<{ comments: MetaComment[]; errors: string[] }> {
  const cfg = await getMetaConfig();
  if (!cfg || item.kind === "STORY") return { comments: [], errors: [] };
  const comments: MetaComment[] = [];
  const errors: string[] = [];
  if (item.fbPostId) {
    try {
      const r = await call<{ data: { id: string; message?: string; created_time: string; from?: { id: string; name: string }; comments?: { data: { id: string; message?: string; created_time: string; from?: { id: string; name: string } }[] } }[] }>("GET", `${item.fbPostId}/comments`, {
        fields: "id,message,created_time,from{id,name},comments.limit(20){id,message,created_time,from{id,name}}",
        filter: "toplevel",
        order: "reverse_chronological",
        limit: "50",
      });
      for (const c of r.data ?? [])
        comments.push({
          id: c.id,
          platform: "facebook",
          author: c.from?.name ?? "مستخدم فيسبوك",
          text: c.message ?? "",
          at: c.created_time,
          replies: (c.comments?.data ?? []).map((x) => ({ id: x.id, author: x.from?.name ?? "", text: x.message ?? "", at: x.created_time, mine: x.from?.id === cfg.pageId })),
        });
    } catch (e) {
      errors.push(`فيسبوك: ${e instanceof Error ? e.message : e}`);
    }
  }
  if (item.igMediaId && cfg.igUserId) {
    try {
      const r = await call<{ data: { id: string; text?: string; timestamp: string; username?: string; replies?: { data: { id: string; text?: string; timestamp: string; username?: string }[] } }[] }>("GET", `${item.igMediaId}/comments`, { fields: "id,text,timestamp,username,replies{id,text,timestamp,username}", limit: "50" });
      const me = (await getMetaConfig())?.igUsername;
      for (const c of r.data ?? [])
        comments.push({ id: c.id, platform: "instagram", author: c.username ?? "مستخدم إنستغرام", text: c.text ?? "", at: c.timestamp, replies: (c.replies?.data ?? []).map((x) => ({ id: x.id, author: x.username ?? "", text: x.text ?? "", at: x.timestamp, mine: !!me && x.username === me })) });
    } catch (e) {
      errors.push(`إنستغرام: ${e instanceof Error ? e.message : e}`);
    }
  }
  comments.sort((a, b) => +new Date(b.at) - +new Date(a.at));
  return { comments, errors };
}

export async function replyToComment(platform: "facebook" | "instagram", commentId: string, message: string) {
  if (!/^[\d_]+$/.test(commentId)) throw new MetaError("INPUT", "معرّف تعليق غير صالح");
  return platform === "facebook" ? call<{ id: string }>("POST", `${commentId}/comments`, { message }) : call<{ id: string }>("POST", `${commentId}/replies`, { message });
}

// ───────── هوية الصفحة ─────────
/**
 * تغيير الصورة الشخصية أو الغلاف لصفحة فيسبوك (يتطلب pages_manage_metadata).
 * إنستغرام لا يتيح تغيير الصورة الشخصية عبر الواجهة البرمجية — يُرفع يدوياً من التطبيق.
 */
// graph مباشرة (لا call): رفض هذه الصلاحية الإضافية لا يُعلّم ربط النشر كله «منقطعاً»
export async function applyPageImage(slot: "profile" | "cover", attachmentId: number) {
  const cfg = await getMetaConfig();
  if (!cfg) throw new MetaError("AUTH", "لم تُربط الصفحة بعد");
  const url = await publicImageUrl(900000 + (slot === "profile" ? 1 : 2), attachmentId);
  if (slot === "profile") {
    await graph("POST", `${cfg.pageId}/picture`, { picture: url }, cfg.token);
    return;
  }
  const photo = await graph<{ id: string }>("POST", `${cfg.pageId}/photos`, { url, published: "false" }, cfg.token);
  await graph("POST", cfg.pageId, { cover: photo.id, no_feed_story: "true" }, cfg.token);
}

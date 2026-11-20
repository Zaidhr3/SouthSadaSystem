import "server-only";
import { db } from "./db";
import { writeJson } from "./ai/writer";
import { getSecret, setSecret } from "./secret-box";
import { getMetaConfig } from "./meta";
import type { Metrics } from "./social";

/**
 * التمويل الإعلاني الذكي:
 *  1) المستشار يقرأ أداء المنشور مقارنة بمتوسط الحساب ومحتواه ونوعه (الريل أولى) ويحكم: يستحق أم لا، ومقترح الميزانية والمدة والجمهور.
 *  2) التمويل الفعلي عبر Meta Marketing API (حملة ← مجموعة إعلانية ← تصميم من المنشور نفسه ← إعلان) —
 *     لا يُنشأ إلا بموافقة صريحة من المدير العام، وضمن سقف شهري، وبرمز إعلانات مستقل (ads_management).
 */
export type AdsConfig = { token: string; adAccountId: string; monthlyCap: number; currency?: string };
const SECRET = "meta_ads";
const V = () => process.env.META_GRAPH_VERSION || "v23.0";

export async function adsConfig(): Promise<AdsConfig | null> {
  if (process.env.META_ADS_TOKEN && process.env.META_AD_ACCOUNT_ID) return { token: process.env.META_ADS_TOKEN, adAccountId: process.env.META_AD_ACCOUNT_ID, monthlyCap: Number(process.env.BOOST_MONTHLY_CAP || 100) };
  const s = await getSecret<AdsConfig & { fromMeta?: boolean }>(SECRET);
  if (!s?.value) return null;
  // حساب إعلاني مختار من ربط فيسبوك نفسه: الرمز يُقرأ من الربط الحالي (يتجدد معه)
  if (s.value.fromMeta) {
    const cfg = await getMetaConfig();
    if (!cfg?.userToken) return null;
    return { ...s.value, token: cfg.userToken };
  }
  return s.value;
}

/** الحسابات الإعلانية المتاحة عبر ربط فيسبوك (إن مُنحت ads_management/ads_read) */
export async function metaAdAccounts(): Promise<{ id: string; name: string; currency: string; active: boolean }[]> {
  const cfg = await getMetaConfig();
  if (!cfg?.userToken) return [];
  const r = await ads<{ data: { id: string; name?: string; currency?: string; account_status?: number }[] }>("GET", "me/adaccounts", { fields: "id,name,currency,account_status", limit: "50" }, cfg.userToken).catch(() => ({ data: [] }));
  return r.data.map((a) => ({ id: a.id, name: a.name ?? a.id, currency: a.currency ?? "", active: a.account_status === 1 }));
}

/** اختيار حساب إعلاني من ربط فيسبوك بدل إدخال رمز منفصل */
export async function selectMetaAdAccount(adAccountId: string, monthlyCap: number) {
  const cfg = await getMetaConfig();
  if (!cfg?.userToken) throw new Error("ربط فيسبوك الحالي لا يتضمن صلاحيات الإعلانات — أعد الربط برمز مستخدم فيه ads_management");
  const acc = await ads<{ name?: string; currency?: string; account_status?: number }>("GET", adAccountId, { fields: "name,currency,account_status" }, cfg.userToken);
  if (acc.account_status !== 1) throw new Error("الحساب الإعلاني غير فعّال — فعّله من Meta Ads Manager");
  await setSecret(SECRET, { token: "", adAccountId, monthlyCap, currency: acc.currency, fromMeta: true }, { name: acc.name, savedAt: new Date().toISOString() });
  return { name: acc.name, currency: acc.currency };
}

async function ads<T>(method: "GET" | "POST", path: string, params: Record<string, string>, token: string): Promise<T> {
  const url = new URL(`https://graph.facebook.com/${V()}/${path}`);
  const body = new URLSearchParams({ ...params, access_token: token });
  if (method === "GET") body.forEach((v, k) => url.searchParams.set(k, v));
  const res = await fetch(url, { method, ...(method === "POST" ? { body } : {}), signal: AbortSignal.timeout(30_000), cache: "no-store" });
  const j = (await res.json().catch(() => ({}))) as T & { error?: { message?: string; error_user_msg?: string; code?: number } };
  if (!res.ok || j.error) throw new Error(`Meta Ads: ${j.error?.error_user_msg || j.error?.message || res.status}`);
  return j;
}

/** حفظ إعداد الإعلانات بعد التحقق من الحساب الإعلاني والرمز */
export async function saveAdsConfig(token: string, adAccountId: string, monthlyCap: number) {
  const id = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId.replace(/\D/g, "")}`;
  const acc = await ads<{ name?: string; currency?: string; account_status?: number }>("GET", id, { fields: "name,currency,account_status" }, token);
  if (acc.account_status !== 1) throw new Error("الحساب الإعلاني غير فعّال (معطل أو بانتظار الدفع) — فعّله من Meta Ads Manager");
  await setSecret(SECRET, { token, adAccountId: id, monthlyCap, currency: acc.currency }, { name: acc.name, savedAt: new Date().toISOString() });
  return { name: acc.name, currency: acc.currency };
}

/** صرف الشهر الحالي (المخطط) من الحملات النشطة/المنتهية */
async function monthSpend() {
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  const rows = await db.adBoost.findMany({ where: { status: { in: ["ACTIVE", "DONE", "PAUSED"] }, createdAt: { gte: start } }, select: { dailyBudget: true, days: true } });
  return rows.reduce((a, r) => a + r.dailyBudget * r.days, 0);
}

export type BoostAdvice = { worth: boolean; score: number; summary: string; suggestedDaily: number; suggestedDays: number; audience: string; objective: string };

export async function boostAdvice(postId: string): Promise<BoostAdvice> {
  const p = await db.socialPost.findUnique({ where: { id: postId } });
  if (!p) throw new Error("المنشور غير موجود — حدّث الحسابات");
  const peers = await db.socialPost.findMany({ where: { platform: p.platform, gone: false }, select: { metrics: true, mediaType: true } });
  const eng = (m: unknown) => (m as Metrics | null)?.engagement ?? 0;
  const avg = peers.length ? peers.reduce((a, x) => a + eng(x.metrics), 0) / peers.length : 0;
  const best = Math.max(0, ...peers.map((x) => eng(x.metrics)));
  const m = (p.metrics as Metrics | null) ?? { likes: 0, comments: 0, shares: 0, engagement: 0 };
  const cfg = await adsConfig();
  const { data } = await writeJson<BoostAdvice>({
    system: `أنت مستشار إعلانات Meta محترف لشركة مقاولات أردنية صغيرة (صدى الجنوب، درجة رابعة). قرر بصدق إن كان هذا المنشور يستحق التمويل الآن.
المعايير: الأداء النسبي مقابل متوسط الحساب وأفضل منشور، نوع المحتوى (الريل والفيديو والقبل/بعد أعلى أداءً في الإعلانات)، وضوح الخدمة والدعوة للتواصل (واتساب/عرض سعر)، جودة الصورة، وارتباطه بعمل حقيقي. منشور ضعيف التفاعل لا يُموَّل — المال يضخّم الناجح ولا يصلح الضعيف.
الميزانية المقترحة صغيرة وواقعية لحساب صغير (بعملة الحساب ${cfg?.currency ?? "USD"})، والجمهور: الأردن، المهتمون بالبناء والعقار وأصحاب الأراضي، 25–60. الهدف: رسائل/تفاعل. لا تخترع أرقام أداء غير المعطاة.`,
    effort: "medium",
    timeoutMs: 60_000,
    maxTokens: 3000,
    schema: { type: "object", properties: { worth: { type: "boolean" }, score: { type: "integer" }, summary: { type: "string", description: "الحكم والسبب بالدليل، 2–4 جمل" }, suggestedDaily: { type: "number" }, suggestedDays: { type: "integer" }, audience: { type: "string" }, objective: { type: "string" } } },
    turns: [{ role: "user", text: `المنصة: ${p.platform === "FB" ? "فيسبوك" : "إنستغرام"} | النوع: ${p.mediaType} | التاريخ: ${p.postedAt.toISOString().slice(0, 10)}\nالأداء: إعجاب ${m.likes}، تعليق ${m.comments}، مشاركة ${m.shares} — تفاعل موزون ${m.engagement}\nمتوسط الحساب ${avg.toFixed(1)}، أفضل منشور ${best}، عدد المنشورات ${peers.length}\nالنص:\n${p.text ?? "— بلا نص —"}` }],
  });
  const advice = { ...data, score: Math.max(0, Math.min(100, Math.round(data.score))), suggestedDays: Math.max(1, Math.min(30, Math.round(data.suggestedDays || 5))), suggestedDaily: Math.max(1, Number(data.suggestedDaily) || 5) };
  await db.socialPost.update({ where: { id: postId }, data: { boostScore: advice.score } });
  await db.adBoost.create({ data: { postId, platform: p.platform, dailyBudget: advice.suggestedDaily, days: advice.suggestedDays, analysis: JSON.stringify(advice), status: "DRAFT", createdById: 0 } });
  return advice;
}

const ZERO_DECIMAL = new Set(["JPY", "KRW", "CLP", "COP", "CRC", "HUF", "ISK", "IDR", "PYG", "TWD", "VND"]);

export async function createBoost(postId: string, opts: { daily: number; days: number }, userId: number) {
  const cfg = await adsConfig();
  if (!cfg) throw new Error("التمويل غير مُعد: أضف رمز الإعلانات (ads_management) ورقم الحساب الإعلاني من «إعداد التمويل»");
  const p = await db.socialPost.findUnique({ where: { id: postId } });
  if (!p) throw new Error("المنشور غير موجود");
  if (!(opts.daily > 0 && opts.days >= 1 && opts.days <= 30)) throw new Error("حدد ميزانية يومية ومدة (1–30 يوماً)");
  const total = opts.daily * opts.days;
  const spent = await monthSpend();
  if (spent + total > cfg.monthlyCap) throw new Error(`يتجاوز السقف الشهري (${cfg.monthlyCap} ${cfg.currency ?? ""}) — المخطط هذا الشهر ${spent.toFixed(2)}، والمطلوب ${total.toFixed(2)}`);
  const meta = await getMetaConfig();
  if (!meta) throw new Error("صفحة فيسبوك غير مربوطة");
  const minor = (v: number) => String(Math.round(v * (ZERO_DECIMAL.has(cfg.currency ?? "") ? 1 : 100)));
  const boost = await db.adBoost.create({ data: { postId, platform: p.platform, dailyBudget: opts.daily, days: opts.days, status: "DRAFT", createdById: userId } });
  const log: string[] = [];
  try {
    const name = `صدى الجنوب — ${p.platform} ${p.postedAt.toISOString().slice(0, 10)} (#${boost.id})`;
    const camp = await ads<{ id: string }>("POST", `${cfg.adAccountId}/campaigns`, { name, objective: "OUTCOME_ENGAGEMENT", status: "ACTIVE", special_ad_categories: "[]", is_adset_budget_sharing_enabled: "false" }, cfg.token);
    log.push(`حملة ${camp.id}`);
    const start = new Date(Date.now() + 10 * 60_000);
    const end = new Date(start.getTime() + opts.days * 86400_000);
    const set = await ads<{ id: string }>(
      "POST",
      `${cfg.adAccountId}/adsets`,
      {
        name,
        campaign_id: camp.id,
        daily_budget: minor(opts.daily),
        billing_event: "IMPRESSIONS",
        optimization_goal: "POST_ENGAGEMENT",
        bid_strategy: "LOWEST_COST_WITHOUT_CAP",
        targeting: JSON.stringify({ geo_locations: { countries: ["JO"] }, age_min: 25, age_max: 60, publisher_platforms: p.platform === "IG" ? ["instagram"] : ["facebook"] }),
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        status: "ACTIVE",
        promoted_object: JSON.stringify({ page_id: meta.pageId }),
      },
      cfg.token,
    );
    log.push(`مجموعة ${set.id}`);
    const creative = await ads<{ id: string }>(
      "POST",
      `${cfg.adAccountId}/adcreatives`,
      p.platform === "FB"
        ? { name, object_story_id: p.id.includes("_") ? p.id : `${meta.pageId}_${p.id}` }
        : { name, object_id: meta.pageId, ...(meta.igUserId ? { instagram_user_id: meta.igUserId } : {}), source_instagram_media_id: p.id },
      cfg.token,
    );
    const ad = await ads<{ id: string }>("POST", `${cfg.adAccountId}/ads`, { name, adset_id: set.id, creative: JSON.stringify({ creative_id: creative.id }), status: "ACTIVE" }, cfg.token);
    log.push(`إعلان ${ad.id}`);
    await db.adBoost.update({ where: { id: boost.id }, data: { status: "ACTIVE", campaignId: camp.id, adSetId: set.id, adId: ad.id, log: log.join(" · ") } });
    await db.socialPost.update({ where: { id: postId }, data: { decision: "DONE" } });
    return { id: boost.id, message: `انطلق التمويل: ${opts.daily} ${cfg.currency ?? ""} يومياً لمدة ${opts.days} أيام — يمكنك متابعته وإيقافه من Meta Ads Manager` };
  } catch (e) {
    await db.adBoost.update({ where: { id: boost.id }, data: { status: "FAILED", log: `${log.join(" · ")}\n${e instanceof Error ? e.message : e}` } });
    throw e;
  }
}

/**
 * «من استقطبت إعلاناتك»: نتائج كل إعلان ممول من Meta Insights مقسمة حسب العمر والجنس والمحافظة
 * (الوصول والنقرات والتفاعل والإنفاق) — تُحفظ مع التمويل وتُجمع في لوحة الجمهور.
 */
export type AudienceRow = { k: string; reach: number; clicks: number; engagement: number; spend: number };
export type Audience = { age: AudienceRow[]; gender: AudienceRow[]; region: AudienceRow[]; reach: number; clicks: number; spend: number; at: string };

type InsightRow = { reach?: string; clicks?: string; spend?: string; actions?: { action_type: string; value: string }[]; age?: string; gender?: string; region?: string };
const GENDER_AR: Record<string, string> = { male: "ذكور", female: "إناث", unknown: "غير محدد" };

function rows(data: InsightRow[], key: "age" | "gender" | "region"): AudienceRow[] {
  const m = new Map<string, AudienceRow>();
  for (const r of data) {
    const raw = r[key] ?? "—";
    const k = key === "gender" ? GENDER_AR[raw] ?? raw : raw.replace(/ Governorate$/i, "");
    const cur = m.get(k) ?? { k, reach: 0, clicks: 0, engagement: 0, spend: 0 };
    cur.reach += Number(r.reach || 0);
    cur.clicks += Number(r.clicks || 0);
    cur.spend += Number(r.spend || 0);
    cur.engagement += Number(r.actions?.find((a) => a.action_type === "post_engagement")?.value || 0);
    m.set(k, cur);
  }
  return Array.from(m.values()).sort((a, b) => b.reach - a.reach);
}

export async function fetchAudience(adId: string): Promise<Audience> {
  const cfg = await adsConfig();
  if (!cfg) throw new Error("التمويل غير مُعد");
  const q = (breakdowns: string) => ads<{ data: InsightRow[] }>("GET", `${adId}/insights`, { fields: "reach,clicks,spend,actions", breakdowns, date_preset: "maximum", limit: "200" }, cfg.token);
  const [ag, rg, tot] = await Promise.all([q("age,gender"), q("region"), ads<{ data: InsightRow[] }>("GET", `${adId}/insights`, { fields: "reach,clicks,spend", date_preset: "maximum" }, cfg.token)]);
  const t = tot.data?.[0] ?? {};
  return { age: rows(ag.data ?? [], "age"), gender: rows(ag.data ?? [], "gender"), region: rows(rg.data ?? [], "region").slice(0, 12), reach: Number(t.reach || 0), clicks: Number(t.clicks || 0), spend: Number(t.spend || 0), at: new Date().toISOString() };
}

/** تحديث جمهور كل الإعلانات الممولة (النشطة والمنتهية خلال 60 يوماً) */
export async function refreshAudiences() {
  const list = await db.adBoost.findMany({ where: { adId: { not: null }, status: { in: ["ACTIVE", "DONE", "PAUSED"] }, createdAt: { gte: new Date(Date.now() - 60 * 86400_000) } }, take: 20 });
  let ok = 0;
  const errors: string[] = [];
  for (const b of list) {
    try {
      const aud = await fetchAudience(b.adId!);
      await db.adBoost.update({ where: { id: b.id }, data: { audience: JSON.parse(JSON.stringify(aud)) } });
      ok++;
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  return { ok, total: list.length, error: errors[0] };
}

/** دمج جمهور عدة إعلانات في صورة واحدة */
export function mergeAudiences(list: Audience[]): Audience | null {
  if (!list.length) return null;
  const merge = (pick: (a: Audience) => AudienceRow[]) => {
    const m = new Map<string, AudienceRow>();
    list.flatMap(pick).forEach((r) => {
      const c = m.get(r.k) ?? { k: r.k, reach: 0, clicks: 0, engagement: 0, spend: 0 };
      c.reach += r.reach; c.clicks += r.clicks; c.engagement += r.engagement; c.spend += r.spend;
      m.set(r.k, c);
    });
    return Array.from(m.values()).sort((a, b) => b.reach - a.reach);
  };
  return { age: merge((a) => a.age), gender: merge((a) => a.gender), region: merge((a) => a.region).slice(0, 10), reach: list.reduce((s, a) => s + a.reach, 0), clicks: list.reduce((s, a) => s + a.clicks, 0), spend: list.reduce((s, a) => s + a.spend, 0), at: list.map((a) => a.at).sort().pop()! };
}

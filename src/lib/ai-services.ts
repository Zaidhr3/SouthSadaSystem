import "server-only";
import { getSecret, setSecret } from "./secret-box";

/**
 * خدمات الذكاء الاصطناعي الخارجية — المفاتيح مشفّرة في قاعدة البيانات (أو متغيرات الخادم)، وكل خدمة تعمل متى وُجد مفتاحها:
 *  - Perplexity (Sonar): بحث ويب حيّ بمصادر — للمساعد (أسعار، أنظمة، أخبار عطاءات، منافسون)
 *  - Firecrawl: قراءة أي صفحة ويب كنص نظيف وبحث الويب — للمساعد (مواقع العطاءات، الموردون)
 *  - ElevenLabs: تعليق صوتي عربي لسكربتات الريلز والقصص
 */
export type ServiceKey = "perplexity" | "firecrawl" | "elevenlabs";
const ENV: Record<ServiceKey, string> = { perplexity: "PERPLEXITY_API_KEY", firecrawl: "FIRECRAWL_API_KEY", elevenlabs: "ELEVENLABS_API_KEY" };
export const SERVICE_LABEL: Record<ServiceKey, { name: string; use: string; url: string }> = {
  perplexity: { name: "Perplexity", use: "بحث ويب حيّ بمصادر للمساعد الذكي", url: "https://www.perplexity.ai/account/api" },
  firecrawl: { name: "Firecrawl", use: "قراءة المواقع (العطاءات، الموردون، المنافسون) للمساعد", url: "https://www.firecrawl.dev/app/api-keys" },
  elevenlabs: { name: "ElevenLabs", use: "تعليق صوتي عربي للريلز والقصص", url: "https://elevenlabs.io/app/settings/api-keys" },
};

type Keys = Partial<Record<ServiceKey, string>>;
export async function serviceKey(s: ServiceKey): Promise<string | null> {
  if (process.env[ENV[s]]) return process.env[ENV[s]]!;
  const k = await getSecret<Keys>("ai_services");
  return k?.value[s] || null;
}
export async function servicesStatus() {
  const k = await getSecret<Keys>("ai_services");
  return Object.fromEntries((Object.keys(ENV) as ServiceKey[]).map((s) => [s, !!(process.env[ENV[s]] || k?.value[s])])) as Record<ServiceKey, boolean>;
}
export async function saveServiceKey(s: ServiceKey, key: string | null) {
  const cur = await getSecret<Keys>("ai_services");
  const value: Keys = { ...(cur?.value ?? {}) };
  if (key) value[s] = key;
  else delete value[s];
  await setSecret("ai_services", value, { ...(cur?.meta ?? {}), [`${s}SavedAt`]: new Date().toISOString() });
}

async function need(s: ServiceKey) {
  const k = await serviceKey(s);
  if (!k) throw new Error(`${SERVICE_LABEL[s].name} غير مُعد — أضف المفتاح من إعدادات النظام ← خدمات الذكاء الاصطناعي`);
  return k;
}

/* ───────── Perplexity ───────── */
export async function webResearch(query: string, opts: { recencyDays?: number } = {}) {
  const key = await need("perplexity");
  const res = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.PERPLEXITY_MODEL || "sonar-pro",
      messages: [
        { role: "system", content: "ابحث بدقة وأجب بالعربية باختصار مع الأرقام والتواريخ كما وردت في المصادر. ركّز على الأردن عند الاقتضاء." },
        { role: "user", content: query },
      ],
      ...(opts.recencyDays ? { search_recency_filter: opts.recencyDays <= 1 ? "day" : opts.recencyDays <= 7 ? "week" : opts.recencyDays <= 31 ? "month" : "year" } : {}),
    }),
    signal: AbortSignal.timeout(60_000),
    cache: "no-store",
  });
  const j = (await res.json().catch(() => ({}))) as { choices?: { message?: { content?: string } }[]; citations?: string[]; search_results?: { title?: string; url: string }[]; error?: { message?: string } };
  if (!res.ok) throw new Error(`Perplexity: ${j.error?.message ?? res.status}`);
  return { answer: j.choices?.[0]?.message?.content ?? "", sources: j.search_results?.map((r) => ({ title: r.title, url: r.url })) ?? j.citations?.map((url) => ({ url })) ?? [] };
}

/* ───────── Firecrawl ───────── */
async function fc<T>(path: string, body: unknown): Promise<T> {
  const key = await need("firecrawl");
  const res = await fetch(`https://api.firecrawl.dev/v2/${path}`, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(60_000), cache: "no-store" });
  const j = (await res.json().catch(() => ({}))) as T & { success?: boolean; error?: string };
  if (!res.ok || j.success === false) throw new Error(`Firecrawl: ${j.error ?? res.status}`);
  return j;
}
export async function scrapeUrl(url: string) {
  if (!/^https?:\/\//i.test(url)) throw new Error("رابط غير صالح");
  const j = await fc<{ data?: { markdown?: string; metadata?: { title?: string; sourceURL?: string } } }>("scrape", { url, formats: ["markdown"], onlyMainContent: true });
  return { title: j.data?.metadata?.title, url: j.data?.metadata?.sourceURL ?? url, markdown: (j.data?.markdown ?? "").slice(0, 20_000) };
}
export async function webSearch(query: string, limit = 5) {
  const j = await fc<{ data?: { web?: { url: string; title?: string; description?: string }[] } | { url: string; title?: string; description?: string }[] }>("search", { query, limit, country: "jo" });
  const list = Array.isArray(j.data) ? j.data : (j.data?.web ?? []);
  return list.map((r) => ({ url: r.url, title: r.title, description: r.description }));
}

/* ───────── ElevenLabs ───────── */
export async function voices() {
  const key = await need("elevenlabs");
  const res = await fetch("https://api.elevenlabs.io/v1/voices", { headers: { "xi-api-key": key }, signal: AbortSignal.timeout(20_000), next: { revalidate: 3600 } });
  const j = (await res.json().catch(() => ({}))) as { voices?: { voice_id: string; name: string; labels?: Record<string, string> }[] };
  if (!res.ok) throw new Error(`ElevenLabs: HTTP ${res.status}`);
  return (j.voices ?? []).map((v) => ({ id: v.voice_id, name: v.name, desc: [v.labels?.gender, v.labels?.accent, v.labels?.age].filter(Boolean).join(" · ") }));
}
/** نص ← MP3 (نموذج متعدد اللغات يدعم العربية) */
export async function textToSpeech(text: string, voiceId: string) {
  const key = await need("elevenlabs");
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({ text: text.slice(0, 2500), model_id: process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2", voice_settings: { stability: 0.5, similarity_boost: 0.8, style: 0.2 } }),
    signal: AbortSignal.timeout(90_000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`ElevenLabs: ${(await res.text().catch(() => "")).slice(0, 200) || res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

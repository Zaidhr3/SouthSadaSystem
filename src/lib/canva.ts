import "server-only";
import { createHash, randomBytes } from "crypto";
import { getSecret, patchSecretMeta, setSecret } from "./secret-box";

/**
 * تكامل Canva Connect API:
 *  - ربط OAuth 2.0 مع PKCE (S256) — معرّف التكامل وسرّه ورموز الوصول مشفّرة في IntegrationSecret («canva»)
 *  - استيراد تصميم من رابطه: تصدير JPG بقياس 1080 (كل الصفحات = شرائح كاروسيل) ← تنزيل ← حفظ كشرائح العنصر
 * رموز الوصول قصيرة العمر وتُجدَّد تلقائياً برمز التحديث (يتغير مع كل تجديد — يُحفظ الجديد فوراً).
 * ملاحظة: الملء التلقائي لقوالب العلامة (Autofill / Brand Templates) يتطلب اشتراك Canva Enterprise.
 */
const API = "https://api.canva.com/rest/v1";
const SECRET = "canva";
/** الصلاحيات المطلوبة فقط: تصدير التصميم (content) + اسمه (meta). يجب تفعيلها بنفس الأسماء في Developer Portal ← Scopes */
export const CANVA_SCOPES = "design:content:read design:meta:read";
/** وضع احتياطي إن لم تُفعَّل design:meta:read: التصدير يعمل بدون اسم التصميم */
export const CANVA_MIN_SCOPES = "design:content:read";

type CanvaSecret = { clientId: string; clientSecret: string; accessToken?: string; refreshToken?: string; expiresAt?: number };

export class CanvaError extends Error {}

export const redirectUri = () => `${(process.env.APP_URL || "https://south-sada.vercel.app").replace(/\/+$/, "")}/api/integrations/canva/callback`;

export async function canvaStatus() {
  const s = await getSecret<CanvaSecret>(SECRET);
  return { configured: !!s?.value.clientId, connected: !!s?.value.refreshToken, meta: (s?.meta ?? {}) as { user?: string; connectedAt?: string; error?: string } };
}

/** تحقق فوري من Client ID/Secret: رمز وهمي ← invalid_grant يعني أن بيانات التكامل صحيحة، invalid_client يعني خطأها */
export async function verifyCanvaClient(clientId: string, clientSecret: string) {
  const res = await fetch(`${API}/oauth/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code: "verify-only", code_verifier: "v".repeat(64) }),
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  }).catch(() => null);
  if (!res) return; // تعذر الوصول لـ Canva الآن — لا نمنع الحفظ
  const j = (await res.json().catch(() => ({}))) as { error?: string; error_description?: string };
  if (j.error === "invalid_client" || res.status === 401) throw new CanvaError("Canva رفض Client ID أو Client Secret — انسخهما من جديد من Developer Portal (أنشئ Secret جديداً إن لزم)");
}

export async function saveCanvaApp(clientId: string, clientSecret: string) {
  await verifyCanvaClient(clientId, clientSecret);
  const cur = await getSecret<CanvaSecret>(SECRET);
  await setSecret(SECRET, { ...(cur?.value ?? {}), clientId, clientSecret }, cur?.meta ?? {});
}

/** بداية الربط: رابط التفويض + verifier/state (يُحفظان في كوكي httpOnly قصير العمر) */
export async function authorizeUrl(minimal = false) {
  const s = await getSecret<CanvaSecret>(SECRET);
  if (!s?.value.clientId) throw new CanvaError("أدخل Client ID وClient Secret لتكامل Canva أولاً");
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomBytes(24).toString("base64url");
  const u = new URL("https://www.canva.com/api/oauth/authorize");
  u.search = new URLSearchParams({ client_id: s.value.clientId, redirect_uri: redirectUri(), scope: minimal ? CANVA_MIN_SCOPES : CANVA_SCOPES, response_type: "code", code_challenge: challenge, code_challenge_method: "S256", state }).toString();
  return { url: u.toString(), verifier, state };
}

async function tokenRequest(s: CanvaSecret, body: Record<string, string>) {
  const res = await fetch(`${API}/oauth/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${s.clientId}:${s.clientSecret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  const j = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string; message?: string };
  if (!res.ok || !j.access_token) throw new CanvaError(`Canva رفض الطلب: ${j.error_description ?? j.message ?? j.error ?? res.status}`);
  return { accessToken: j.access_token, refreshToken: j.refresh_token ?? s.refreshToken, expiresAt: Date.now() + (j.expires_in ?? 3600) * 1000 - 60_000 };
}

export async function exchangeCode(code: string, verifier: string, by: string) {
  const s = await getSecret<CanvaSecret>(SECRET);
  if (!s) throw new CanvaError("تكامل Canva غير مُعد");
  // redirect_uri إلزامي هنا لأنه أُرسل في رابط التفويض — بدونه يرفض Canva التبادل
  const t = await tokenRequest(s.value, { grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: redirectUri() });
  await setSecret(SECRET, { ...s.value, ...t }, { connectedAt: new Date().toISOString(), user: by, error: undefined });
}

async function accessToken() {
  const s = await getSecret<CanvaSecret>(SECRET);
  if (!s?.value.refreshToken) throw new CanvaError("Canva غير مربوط — اربطه من إعدادات النظام");
  if (s.value.accessToken && (s.value.expiresAt ?? 0) > Date.now()) return s.value.accessToken;
  try {
    const t = await tokenRequest(s.value, { grant_type: "refresh_token", refresh_token: s.value.refreshToken });
    await setSecret(SECRET, { ...s.value, ...t }, s.meta);
    return t.accessToken;
  } catch (e) {
    await patchSecretMeta(SECRET, { error: e instanceof Error ? e.message : "انتهى الربط" });
    throw new CanvaError("انتهت صلاحية ربط Canva — أعد الربط من إعدادات النظام");
  }
}

async function api<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, { method, headers: { Authorization: `Bearer ${await accessToken()}`, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(25_000), cache: "no-store" });
  const j = (await res.json().catch(() => ({}))) as T & { message?: string; code?: string };
  if (res.status === 429) throw new CanvaError("حد استخدام Canva مؤقت — حاول بعد دقيقة");
  if (!res.ok) throw new CanvaError(`Canva: ${j.message ?? j.code ?? res.status}`);
  return j;
}

/** معرّف التصميم من رابط Canva (canva.com/design/DAxxxx/...) أو المعرّف نفسه */
export function designIdFrom(input: string) {
  const m = input.match(/design\/([A-Za-z0-9_-]{8,})/) ?? input.trim().match(/^([A-Za-z0-9_-]{8,})$/);
  return m?.[1] ?? null;
}

/** تصدير التصميم JPG بعرض 1080 وتنزيل كل الصفحات (بالترتيب) */
export async function exportDesign(designId: string): Promise<{ title?: string; images: Buffer[] }> {
  const meta = await api<{ design?: { title?: string } }>("GET", `/designs/${encodeURIComponent(designId)}`).catch(() => ({ design: undefined }));
  let job = (await api<{ job: { id: string; status: string; urls?: string[]; error?: { message?: string } } }>("POST", "/exports", { design_id: designId, format: { type: "jpg", quality: 92, width: 1080 } })).job;
  for (let i = 0; job.status === "in_progress" && i < 30; i++) {
    await new Promise((r) => setTimeout(r, i < 5 ? 1500 : 3000));
    job = (await api<{ job: typeof job }>("GET", `/exports/${job.id}`)).job;
  }
  if (job.status !== "success" || !job.urls?.length) throw new CanvaError(`فشل تصدير التصميم: ${job.error?.message ?? job.status}`);
  const images: Buffer[] = [];
  for (const u of job.urls.slice(0, 10)) {
    const r = await fetch(u, { signal: AbortSignal.timeout(30_000) });
    if (!r.ok) throw new CanvaError("تعذر تنزيل صورة التصدير");
    images.push(Buffer.from(await r.arrayBuffer()));
  }
  return { title: meta.design?.title, images };
}

/** آخر تصاميم الحساب في Canva (للاستيراد بضغطة بلا نسخ روابط) */
export async function listDesigns(limit = 12): Promise<{ id: string; title: string; thumb?: string; updated?: number }[]> {
  const j = await api<{ items?: { id: string; title?: string; thumbnail?: { url?: string }; updated_at?: number }[] }>("GET", `/designs?ownership=owned&sort_by=modified_descending&limit=${limit}`);
  return (j.items ?? []).map((d) => ({ id: d.id, title: d.title || "بلا عنوان", thumb: d.thumbnail?.url, updated: d.updated_at }));
}

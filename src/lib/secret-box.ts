import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { db } from "./db";

/**
 * تخزين أسرار التكاملات مشفّرة (AES-256-GCM) في جدول IntegrationSecret:
 * المفتاح مشتق من AUTH_SECRET (لا يُخزن في قاعدة البيانات) — تسريب قاعدة البيانات وحدها لا يكشف الرموز.
 * الجدول خارج سجل الرقابة، ومسحوبة صلاحياته من الواجهة العامة (RLS).
 */
function key() {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16) throw new Error("AUTH_SECRET missing");
  return createHash("sha256").update(`${s}:integration-secrets:v1`).digest();
}

export function seal(plain: string) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `v1.${iv.toString("base64url")}.${c.getAuthTag().toString("base64url")}.${enc.toString("base64url")}`;
}

export function open(sealed: string) {
  const [v, iv, tag, enc] = sealed.split(".");
  if (v !== "v1" || !iv || !tag || !enc) throw new Error("bad secret format");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(enc, "base64url")), d.final()]).toString("utf8");
}

export async function getSecret<T = Record<string, unknown>>(name: string): Promise<{ value: T; meta: Record<string, unknown>; updatedAt: Date } | null> {
  const row = await db.integrationSecret.findUnique({ where: { key: name } });
  if (!row) return null;
  try {
    return { value: JSON.parse(open(row.cipher)) as T, meta: row.meta ? JSON.parse(row.meta) : {}, updatedAt: row.updatedAt };
  } catch {
    return null;
  }
}

export async function setSecret(name: string, value: unknown, meta: Record<string, unknown> = {}) {
  const cipher = seal(JSON.stringify(value));
  await db.integrationSecret.upsert({ where: { key: name }, create: { key: name, cipher, meta: JSON.stringify(meta) }, update: { cipher, meta: JSON.stringify(meta) } });
}

/** تحديث البيانات الوصفية فقط (حالة الاتصال، آخر خطأ) دون لمس الرمز */
export async function patchSecretMeta(name: string, patch: Record<string, unknown>) {
  const row = await db.integrationSecret.findUnique({ where: { key: name }, select: { meta: true } });
  if (!row) return;
  await db.integrationSecret.update({ where: { key: name }, data: { meta: JSON.stringify({ ...(row.meta ? JSON.parse(row.meta) : {}), ...patch }) } });
}

export async function deleteSecret(name: string) {
  await db.integrationSecret.deleteMany({ where: { key: name } });
}

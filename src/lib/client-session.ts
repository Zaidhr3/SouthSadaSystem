import "server-only";
import { createHash } from "crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { jwtVerify, SignJWT } from "jose";
import { db } from "./db";

/**
 * جلسة بوابة العملاء — منفصلة تماماً عن جلسة الموظفين:
 *  - كوكي مختلف ومفتاح توقيع مشتق مختلف (رمز العميل لا يُقبل أبداً كجلسة موظف والعكس)
 *  - بصمة كلمة المرور داخل الرمز: تغيير كلمة المرور أو إيقاف الحساب يُنهي كل الجلسات فوراً
 */
export const CLIENT_COOKIE = "sada_client";
const MAX_AGE = 60 * 60 * 24 * 7;

function key() {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16) throw new Error("AUTH_SECRET missing");
  return new TextEncoder().encode(createHash("sha256").update(`${s}:client-portal`).digest("hex"));
}
const pwv = (hash: string) => createHash("sha256").update(hash).digest("hex").slice(0, 16);

export async function startClientSession(c: { id: number; passwordHash: string }) {
  const token = await new SignJWT({ cid: c.id, v: pwv(c.passwordHash) }).setProtectedHeader({ alg: "HS256" }).setAudience("client").setIssuedAt().setExpirationTime(`${MAX_AGE}s`).sign(key());
  cookies().set(CLIENT_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: MAX_AGE });
}

export function endClientSession() {
  cookies().delete(CLIENT_COOKIE);
}

export const getClient = cache(async () => {
  const token = cookies().get(CLIENT_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { audience: "client" });
    if (typeof payload.cid !== "number") return null;
    const c = await db.client.findUnique({ where: { id: payload.cid }, include: { accesses: { select: { tenderId: true } } } });
    if (!c || !c.active || payload.v !== pwv(c.passwordHash)) return null;
    return c;
  } catch {
    return null;
  }
});

export async function requireClient() {
  const c = await getClient();
  if (!c) redirect("/portal/login");
  return c;
}

/** يتأكد أن المشروع مربوط بحساب العميل */
export async function requireClientProject(tenderId: number) {
  const c = await requireClient();
  if (!c.accesses.some((a) => a.tenderId === tenderId)) redirect("/portal");
  return c;
}

export function clientIp() {
  return (headers().get("x-forwarded-for") || "").split(",")[0].trim() || headers().get("x-real-ip") || null;
}

// Edge-safe session token helpers (used by middleware and server code).
import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "ssc_session";
export const SESSION_MAX_AGE = 60 * 60 * 12; // 12 ساعة
/** وقت آخر نشاط للجلسة — القفل التلقائي بعد دقيقتين من الخمول */
export const SEEN_COOKIE = "ssc_seen";
export const IDLE_LIMIT_MS = 2 * 60 * 1000;
/** هامش لتأخر الشبكة/مؤقتات الهاتف قبل اعتبار الجلسة خاملة على الخادم */
export const IDLE_GRACE_MS = 20 * 1000;

export type SessionPayload = { uid: number; role: string };

function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16) throw new Error("AUTH_SECRET is missing or too short in .env");
  return new TextEncoder().encode(s);
}

export async function signSession(payload: SessionPayload) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .sign(secret());
}

export async function verifySession(token: string | undefined): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    if (typeof payload.uid !== "number" || typeof payload.role !== "string") return null;
    return { uid: payload.uid, role: payload.role };
  } catch {
    return null;
  }
}

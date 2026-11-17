"use server";

import bcrypt from "bcryptjs";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { SEEN_COOKIE, SESSION_COOKIE, SESSION_MAX_AGE, signSession } from "@/lib/session";
import { auditEvent, clientInfo } from "@/lib/action";

type LoginState = { error?: string; suspended?: string };
const DEFAULT_SUSPEND = "الرجاء مراجعة إدارة الشركة";

// حماية من التخمين محفوظة في قاعدة البيانات (تعمل عبر كل خوادم السحابة):
//  - 5 محاولات فاشلة لنفس اسم المستخدم خلال 15 دقيقة (منذ آخر دخول ناجح) = إيقاف مؤقت
//  - 20 محاولة فاشلة من نفس عنوان IP خلال 15 دقيقة = إيقاف مؤقت
const WINDOW_MS = 15 * 60_000;
const MAX_PER_USER = 5;
const MAX_PER_IP = 20;

async function recentFailures(username: string, ip: string | null) {
  const windowStart = new Date(Date.now() - WINDOW_MS);
  const lastOk = await db.auditLog.findFirst({
    where: { action: "login", summary: `تسجيل دخول ${username}`, createdAt: { gte: windowStart } },
    orderBy: { id: "desc" },
    select: { createdAt: true },
  });
  const since = lastOk?.createdAt ?? windowStart;
  const [user, fromIp] = await Promise.all([
    db.auditLog.count({ where: { action: "login_failed", createdAt: { gt: since }, summary: { contains: `«${username}»` } } }),
    ip ? db.auditLog.count({ where: { action: "login_failed", createdAt: { gte: windowStart }, ip } }) : Promise.resolve(0),
  ]);
  return { user, fromIp };
}

export async function login(_: LoginState, fd: FormData): Promise<LoginState> {
  const username = String(fd.get("username") ?? "").trim().toLowerCase();
  const password = String(fd.get("password") ?? "");
  if (!username || !password) return { error: "يرجى إدخال اسم المستخدم وكلمة المرور" };

  const fails = await recentFailures(username, clientInfo().ip);
  if (fails.user >= MAX_PER_USER || fails.fromIp >= MAX_PER_IP) return { error: "محاولات كثيرة، يرجى الانتظار 15 دقيقة ثم المحاولة" };

  const user = await db.user.findUnique({ where: { username } });
  const valid = !!user && (await bcrypt.compare(password, user.passwordHash));
  if (!valid || !user) {
    const count = fails.user + 1;
    // محاولة دخول فاشلة — تُسجل مع عنوان IP والجهاز (مهم عند فتح النظام على الإنترنت)
    await auditEvent("login_failed", "Session", `محاولة دخول فاشلة لاسم المستخدم «${username}» (المحاولة ${count})`, user ? { id: user.id, name: user.name, role: user.role } : undefined);
    return { error: "اسم المستخدم أو كلمة المرور غير صحيحة" };
  }
  // حساب موقوف: تظهر رسالة الإدارة فقط بعد التحقق من كلمة المرور (لا تُكشف لمن يخمّن)
  if (!user.active) {
    await auditEvent("login_blocked", "Session", `محاولة دخول لحساب موقوف «${user.username}»`, { id: user.id, name: user.name, role: user.role }, { recordId: user.id });
    return { suspended: user.suspendReason?.trim() || DEFAULT_SUSPEND };
  }
  await auditEvent("login", "Session", `تسجيل دخول ${user.username}`, { id: user.id, name: user.name, role: user.role }, { recordId: user.id });

  const token = await signSession({ uid: user.id, role: user.role });
  cookies().set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    // آمن تلقائياً عند الوصول عبر HTTPS (Cloudflare Tunnel)
    secure: process.env.COOKIE_SECURE === "true" || headers().get("x-forwarded-proto") === "https",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  cookies().set(SEEN_COOKIE, String(Date.now()), { httpOnly: true, sameSite: "lax", secure: process.env.COOKIE_SECURE === "true" || headers().get("x-forwarded-proto") === "https", path: "/", maxAge: SESSION_MAX_AGE });
  redirect("/");
}

export async function logout() {
  cookies().delete(SESSION_COOKIE);
  cookies().delete(SEEN_COOKIE);
  redirect("/login");
}

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SEEN_COOKIE, SESSION_COOKIE, verifySession } from "@/lib/session";
import { db } from "@/lib/db";
import { auditEvent } from "@/lib/action";

/** القفل التلقائي بعد الخمول: إنهاء الجلسة وتوثيقه في سجل التدقيق الأمني */
export const dynamic = "force-dynamic";
export async function POST() {
  const session = await verifySession(cookies().get(SESSION_COOKIE)?.value);
  if (session) {
    const u = await db.user.findUnique({ where: { id: session.uid }, select: { id: true, name: true, role: true, username: true } });
    if (u) await auditEvent("session_locked", "Session", `قفل تلقائي للجلسة بعد دقيقتين من الخمول — ${u.username}`, { id: u.id, name: u.name, role: u.role }, { recordId: u.id }).catch(() => undefined);
  }
  const res = new NextResponse(null, { status: 204 });
  res.cookies.delete(SESSION_COOKIE);
  res.cookies.delete(SEEN_COOKIE);
  return res;
}

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { computeNotifications } from "@/lib/notifications";
import { db } from "@/lib/db";

/**
 * عدّاد التنبيهات الحي (يُستدعى كل 30 ثانية من المتصفح أثناء فتح النظام):
 * عدد التنبيهات غير المقروءة + أحدثها لعرض إشعار على الجهاز — دون إعادة تحميل الصفحة.
 * لا يُعدّ نشاطاً من المستخدم (لا يمدد الجلسة — انظر middleware).
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const [notes, messages] = await Promise.all([computeNotifications(user), db.message.count({ where: { recipientId: user.id, readAt: null } })]);
  const top = notes[0];
  return NextResponse.json(
    { count: notes.length, messages, keys: notes.slice(0, 20).map((n) => n.key), top: top ? { key: top.key, title: top.title, body: top.body, href: top.href } : null },
    { headers: { "Cache-Control": "no-store" } },
  );
}

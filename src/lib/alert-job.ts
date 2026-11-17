import "server-only";
import { db } from "./db";
import { emailLayout, mailConfigured, recipientFor, sendMail } from "./mailer";
import { computeNotifications } from "./notifications";
import { fmtDate, todayUTC } from "./format";
import type { Role } from "./permissions";

/**
 * مهمة التنبيهات البريدية: لكل مستخدم لديه بريد، تُرسل رسالة واحدة تجمع
 * التنبيهات الجديدة فقط (الشيكات، الكفالات، مواعيد التقديم، الزيارات، طلبات التمويل، المحجوزات...).
 * كل تنبيه يُرسل مرة واحدة لكل مرحلة (قبل 3 أيام، اليوم، متأخر) بفضل سجل EmailLog.
 */
export async function runAlertJob() {
  if (!mailConfigured()) return { configured: false, users: 0, alerts: 0, sent: 0 };
  // كل المستخدمين المفعّلين ولديهم بريد + المدير العام دائماً (يُرسل لبريده أو للبريد الافتراضي)
  const users = await db.user.findMany({ where: { active: true, notifyEmail: true, OR: [{ email: { not: null } }, { role: "ADMIN" }] } });
  let alerts = 0;
  let sent = 0;
  for (const u of users) {
    const to = recipientFor(u);
    if (!to) continue;
    const appUser = { id: u.id, name: u.name, username: u.username, role: u.role as Role, title: u.title };
    const notes = (await computeNotifications(appUser)).filter((n) => n.kind !== "event");
    if (notes.length === 0) continue;
    const keys = notes.map((n) => `alert:${u.id}:${n.key}`);
    const already = new Set((await db.emailLog.findMany({ where: { key: { in: keys }, status: "SENT" }, select: { key: true } })).map((r) => r.key));
    const fresh = notes.filter((n) => !already.has(`alert:${u.id}:${n.key}`));
    if (fresh.length === 0) continue;
    alerts += fresh.length;
    const critical = fresh.filter((n) => n.severity === "critical").length;
    const subject = critical ? `⚠️ صدى الجنوب: ${critical} تنبيهات عاجلة — ${fmtDate(todayUTC())}` : `صدى الجنوب: ${fresh.length} تنبيهات جديدة — ${fmtDate(todayUTC())}`;
    const status = await sendMail({
      key: `digest:${u.id}:${Date.now()}`,
      to,
      subject,
      html: emailLayout(
        "ملخص التنبيهات",
        fresh.map((n) => ({ title: n.title, body: n.body, href: n.href, tone: n.severity })),
        `مرحباً ${u.name}، هذه التنبيهات الجديدة التي تحتاج متابعتك:`,
      ),
      text: fresh.map((n) => `• ${n.title} — ${n.body}`).join("\n"),
    });
    if (status === "sent") {
      sent++;
      await db.emailLog.createMany({
        data: fresh.map((n) => ({ key: `alert:${u.id}:${n.key}`, to, subject: n.title, status: "SENT" })),
      });
    }
  }
  return { configured: true, users: users.length, alerts, sent };
}

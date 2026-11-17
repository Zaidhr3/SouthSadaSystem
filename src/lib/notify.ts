import "server-only";
import { db } from "./db";
import { emailLayout, recipientFor, sendMail } from "./mailer";

type Target = number | "ADMIN" | "ACCOUNTANT" | "CHAIRMAN" | { managerOf: number };

/** تحويل الأهداف (مستخدم، دور، مدير مشروع معين) إلى معرفات مستخدمين فعّالين */
async function resolve(targets: Target[], excludeUserId?: number) {
  const ids = new Set<number>();
  for (const t of targets) {
    if (typeof t === "number") ids.add(t);
    else if (t === "ADMIN" || t === "ACCOUNTANT" || t === "CHAIRMAN") {
      // الإدارة = المدير العام + المشرف الأعلى (أبو أحمد): كل ما يصل للمدير العام يصل للمشرف الأعلى أيضاً
      const roles = t === "ADMIN" ? (["ADMIN", "CHAIRMAN"] as const) : ([t] as const);
      (await db.user.findMany({ where: { role: { in: [...roles] }, active: true }, select: { id: true } })).forEach((u) => ids.add(u.id));
    } else {
      const tender = await db.tender.findUnique({ where: { id: t.managerOf }, select: { managerId: true } });
      if (tender?.managerId) ids.add(tender.managerId);
    }
  }
  if (excludeUserId) ids.delete(excludeUserId);
  return Array.from(ids);
}

/**
 * توجيه الإشعارات: يُنشئ إشعاراً داخل النظام لكل مستخدم مستهدف ويرسل بريداً (إن كان SMTP مُعداً).
 * لا يفشل الإجراء الأصلي أبداً بسبب الإشعار.
 */
export async function notify(targets: Target[], n: { title: string; body: string; href: string }, opts: { exclude?: number; email?: boolean } = {}) {
  try {
    const ids = await resolve(targets, opts.exclude);
    if (ids.length === 0) return;
    const users = await db.user.findMany({ where: { id: { in: ids }, active: true } });
    // البريد يُنتظر حتى يُرسل (على Vercel تتوقف الدالة بعد الرد فيضيع البريد غير المنتظر) — بحد أقصى 12 ثانية
    const mails: Promise<unknown>[] = [];
    for (const u of users) {
      const ev = await db.notificationEvent.create({ data: { userId: u.id, title: n.title, body: n.body, href: n.href } });
      const to = recipientFor(u);
      if (to && u.notifyEmail && opts.email !== false) {
        mails.push(sendMail({
          key: `event:${ev.id}`,
          to,
          subject: `صدى الجنوب: ${n.title}`,
          html: emailLayout(n.title, [{ title: n.title, body: n.body, href: n.href, tone: "info" }]),
          text: `${n.title}\n${n.body}`,
        }));
      }
    }
    if (mails.length) await Promise.race([Promise.allSettled(mails), new Promise((r) => setTimeout(r, 12_000))]);
  } catch (e) {
    console.error("[notify]", e);
  }
}

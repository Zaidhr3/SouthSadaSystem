import "server-only";
import nodemailer, { type Transporter } from "nodemailer";
import { db } from "./db";

/**
 * إرسال البريد عبر أي مزود SMTP مجاني (Gmail App Password أو Brevo).
 * الإعداد بالكامل من ملف .env: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
 */
let transporter: Transporter | null = null;

/**
 * بريد المدير العام لكل التنبيهات الحرجة والملخصات.
 * يُستخدم إذا لم يكن لحساب المدير بريد مسجل، ويمكن تغييره من .env (ADMIN_ALERT_EMAIL).
 */
export const ADMIN_ALERT_EMAIL = process.env.ADMIN_ALERT_EMAIL?.trim() || "zaidalhrini2003@gmail.com";

/** عنوان استلام التنبيهات لمستخدم: بريده، أو بريد المدير الافتراضي لحسابات المدير العام */
export function recipientFor(u: { email: string | null; role: string }) {
  return u.email || (u.role === "ADMIN" ? ADMIN_ALERT_EMAIL : null);
}

export function smtpInfo() {
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER || "";
  return {
    host: process.env.SMTP_HOST || "—",
    port,
    security: port === 465 ? "SSL/TLS" : "STARTTLS",
    user: user.replace(/^(.{3}).*(@.*)$/, "$1•••$2"),
    from: process.env.SMTP_FROM || user || "—",
  };
}

export function mailConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function getTransport() {
  if (!mailConfigured()) return null;
  if (!transporter) {
    const port = Number(process.env.SMTP_PORT || 587);
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      pool: true,
      maxConnections: 2,
      // مهلات قصيرة: فشل الاتصال يظهر للمستخدم خلال ثوانٍ بدل انتظار دقائق
      connectionTimeout: 15_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
  }
  return transporter;
}

export function appUrl() {
  return (process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, "");
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** قالب بريد RTL بسيط ومتوافق مع برامج البريد */
export function emailLayout(title: string, items: { title: string; body: string; href?: string; tone?: "critical" | "warning" | "info" }[], intro?: string) {
  const color = { critical: "#d70015", warning: "#b25e00", info: "#0071e3" };
  const rows = items
    .map(
      (i) => `<tr><td style="padding:12px 16px;border-bottom:1px solid #eee;border-right:4px solid ${color[i.tone ?? "info"]}">
        <div style="font-weight:700;font-size:15px;color:#1d1d1f">${esc(i.title)}</div>
        <div style="font-size:13px;color:#6e6e73;margin-top:4px">${esc(i.body)}</div>
        ${i.href ? `<a href="${appUrl()}${i.href}" style="font-size:13px;color:#0071e3;text-decoration:none">فتح في النظام ←</a>` : ""}
      </td></tr>`,
    )
    .join("");
  return `<!doctype html><html lang="ar" dir="rtl"><body style="margin:0;background:#f5f5f7;font-family:Tahoma,Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
  <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:16px;overflow:hidden" dir="rtl">
    <tr><td style="background:#1d1d1f;color:#fff;padding:18px 20px;font-size:17px;font-weight:700">صدى الجنوب للمقاولات — ${esc(title)}</td></tr>
    ${intro ? `<tr><td style="padding:14px 16px;font-size:14px;color:#424245">${esc(intro)}</td></tr>` : ""}
    ${rows}
    <tr><td style="padding:14px 16px;font-size:11px;color:#86868b">رسالة آلية من نظام إدارة الشركة — لإيقاف الرسائل عدّل إعدادات حسابك.</td></tr>
  </table></td></tr></table></body></html>`;
}

/**
 * يرسل رسالة مع منع التكرار عبر مفتاح فريد.
 * يعيد "sent" | "skipped" | "duplicate" | "failed"
 */
export async function sendMail(opts: { key: string; to: string; subject: string; html: string; text?: string }) {
  const t = getTransport();
  if (!t) return "skipped" as const;
  const exists = await db.emailLog.findUnique({ where: { key: opts.key } });
  if (exists && exists.status === "SENT") return "duplicate" as const;
  try {
    await t.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
    });
    await db.emailLog.upsert({
      where: { key: opts.key },
      create: { key: opts.key, to: opts.to, subject: opts.subject, status: "SENT" },
      update: { status: "SENT", error: null },
    });
    return "sent" as const;
  } catch (e) {
    const error = e instanceof Error ? e.message.slice(0, 500) : String(e);
    console.error("[mail]", error);
    await db.emailLog.upsert({
      where: { key: opts.key },
      create: { key: opts.key, to: opts.to, subject: opts.subject, status: "FAILED", error },
      update: { status: "FAILED", error },
    });
    return "failed" as const;
  }
}

export async function verifyMail() {
  const t = getTransport();
  if (!t) throw new Error("إعدادات SMTP غير مكتملة في ملف .env");
  await t.verify();
}

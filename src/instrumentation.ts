/**
 * مجدول التنبيهات البريدية الداخلي: يعمل مع تشغيل الخادم ويستدعي /api/cron/alerts دورياً.
 * الفترة من ALERT_INTERVAL_MINUTES (افتراضياً 30 دقيقة). يُعطّل بوضع القيمة 0.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // على Vercel لا يوجد خادم دائم — الفحص يتم عبر Vercel Cron (vercel.json)
  if (process.env.VERCEL) return;
  const g = globalThis as unknown as { __sscAlertTimer?: ReturnType<typeof setInterval> };
  if (g.__sscAlertTimer) return;

  const minutes = Number(process.env.ALERT_INTERVAL_MINUTES ?? 30);
  if (!Number.isFinite(minutes) || minutes <= 0) return;
  const secret = process.env.CRON_SECRET || process.env.AUTH_SECRET;
  if (!secret || !process.env.SMTP_HOST) return;

  const url = `http://127.0.0.1:${process.env.PORT || 3000}/api/cron/alerts`;
  const tick = async () => {
    try {
      const res = await fetch(url, { headers: { "x-cron-secret": secret }, cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (body?.sent) console.log(`[alerts] ${new Date().toISOString()} sent ${body.sent} email digest(s)`);
    } catch (e) {
      console.error("[alerts] scheduler tick failed:", e instanceof Error ? e.message : e);
    }
  };
  setTimeout(tick, 20_000);
  g.__sscAlertTimer = setInterval(tick, minutes * 60_000);
  console.log(`[alerts] email alert scheduler active — every ${minutes} min`);
}

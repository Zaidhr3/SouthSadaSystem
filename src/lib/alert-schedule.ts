/** وصف موعد الفحص التلقائي للتنبيهات البريدية (محلياً: مؤقت داخلي — على Vercel: Cron يومي) */
export function alertScheduleLabel(): string | null {
  if (process.env.VERCEL) return "يومياً الساعة 8:00 صباحاً (Vercel Cron)";
  const interval = Number(process.env.ALERT_INTERVAL_MINUTES ?? 30);
  return interval > 0 ? `كل ${interval} دقيقة أثناء تشغيل الخادم` : null;
}

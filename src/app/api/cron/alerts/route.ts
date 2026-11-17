import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { runAlertJob } from "@/lib/alert-job";
import { cleanupStaging } from "@/lib/storage";
import { runCloudBackup } from "@/lib/cloud-backup";
import { syncAllArchives } from "@/lib/archive";
import { suggestWeek } from "@/lib/marketing";
import { writerConfigured } from "@/lib/ai/writer";
import { publishDue } from "@/lib/marketing-publish";
import { checkMeta, metaConfigured } from "@/lib/meta";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(req: Request) {
  const secret = process.env.CRON_SECRET || process.env.AUTH_SECRET || "";
  // Vercel Cron يرسل Authorization: Bearer <CRON_SECRET>
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  const given = req.headers.get("x-cron-secret") || bearer || new URL(req.url).searchParams.get("secret") || "";
  if (!secret || given.length !== secret.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(secret));
}

/** نقطة تشغيل مهمة التنبيهات البريدية — يستدعيها المجدول الداخلي أو Vercel Cron أو Windows Task Scheduler */
export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // النسخة الاحتياطية اليومية أولاً ومستقلة: فشل التنبيهات لا يمنعها، وفشلها لا يوقف التنبيهات
  const backup = await runCloudBackup().catch((e) => {
    console.error("[cron/backup]", e);
    return { error: e instanceof Error ? e.message : "error" };
  });
  // الأرشفة التلقائية (انقضاء مدد الصيانة) واقتراحات التسويق الصباحية — كلٌ مستقل
  const archives = await syncAllArchives().catch((e) => ({ error: e instanceof Error ? e.message : "error" }));
  const marketing = writerConfigured() ? await suggestWeek(null, new Date().getUTCDay() === 6 ? "AI_WEEKLY" : "AI_DAILY").then((x) => x.length).catch((e) => ({ error: e instanceof Error ? e.message : "error" })) : 0;
  // فحص صحة ربط فيسبوك/إنستغرام (ينبّه المدير عند انتهاء الرمز) ثم نشر المحتوى المجدول الذي حلّ موعده
  const meta = (await metaConfigured()) ? await checkMeta().then((s) => ({ ok: s.ok, error: s.error })).catch((e) => ({ ok: false, error: String(e) })) : { ok: false, error: "not configured" };
  const scheduled = meta.ok ? await publishDue().catch((e) => ({ error: e instanceof Error ? e.message : "error" })) : { skipped: meta.error };
  try {
    const result = await runAlertJob();
    // تنظيف منطقة عبور الرفع المباشر (ملفات رُفعت ولم يُحفظ نموذجها)
    const staging = await cleanupStaging().catch((e) => ({ removed: 0, error: e instanceof Error ? e.message : "error" }));
    return NextResponse.json({ ok: true, ...result, staging, backup, archives, marketing, meta, scheduled, at: new Date().toISOString() });
  } catch (e) {
    console.error("[cron/alerts]", e);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "error", backup }, { status: 500 });
  }
}

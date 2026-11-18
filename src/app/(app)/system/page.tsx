import { CheckCircle2, DatabaseBackup, Download, Mail, XCircle } from "lucide-react";
import { backupConfigured, listDbBackups } from "@/lib/cloud-backup";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { getSettings, SETTING_LABELS, type SettingKey } from "@/lib/settings";
import { ADMIN_ALERT_EMAIL, mailConfigured, smtpInfo } from "@/lib/mailer";
import { Badge, Card, PageHeader } from "@/components/ui";
import { ActionForm, Grid, Input } from "@/components/forms";
import { backupNow, runAlertsNow, saveSettings, sendTestEmail } from "../actions/modules";
import { alertScheduleLabel } from "@/lib/alert-schedule";
import { einvReadiness, getEinvSettings, jofotaraConfigured } from "@/lib/jofotara";
import { EinvoiceSettings } from "./einvoice-settings";
import { BrandSettings } from "./brand-settings";
import { MetaSettings } from "./meta-settings";
import { CanvaSettings } from "./canva-settings";
import { AiServicesSettings } from "./ai-services-settings";
import { getBrand } from "@/lib/brand";

export const metadata = { title: "إعدادات النظام والبريد" };

export default async function SystemPage({ searchParams }: { searchParams?: { canva?: string } }) {
  const user = await requireUser(can.manageSettings);
  const [settings, logs, me, withEmail] = await Promise.all([
    getSettings(),
    db.emailLog.findMany({ where: { NOT: { key: { startsWith: "alert:" } } }, orderBy: { id: "desc" }, take: 15 }),
    db.user.findUnique({ where: { id: user.id }, select: { email: true } }),
    db.user.count({ where: { active: true, email: { not: null }, notifyEmail: true } }),
  ]);
  const [einv, backups] = await Promise.all([getEinvSettings(), backupConfigured() ? listDbBackups().catch(() => null) : Promise.resolve(null)]);
  const configured = mailConfigured();
  const info = smtpInfo();
  const adminTo = me?.email || ADMIN_ALERT_EMAIL;
  const schedule = alertScheduleLabel();
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Amman", dateStyle: "short", timeStyle: "short" });

  return (
    <>
      <PageHeader title="إعدادات النظام والبريد" subtitle="نسب المستقطعات الأردنية وتنبيهات البريد الإلكتروني" />
      <div className="grid gap-5 xl:grid-cols-2">
        <Card title="حاسبة المستقطعات والمحجوزات">
          <ActionForm action={saveSettings} submitLabel="حفظ النسب">
            <Grid>
              {(Object.keys(SETTING_LABELS) as SettingKey[]).map((k) => (
                <Input key={k} name={k} label={SETTING_LABELS[k].label} hint={SETTING_LABELS[k].hint} type="number" step="0.01" min={0} max={k === "gmApprovalThreshold" ? undefined : 100} defaultValue={settings[k]} />
              ))}
            </Grid>
            <p className="rounded-xl bg-warn-soft px-3 py-2 text-xs font-semibold text-warn">
              راجع النسب مع المحاسب القانوني وشروط العقد — تختلف حسب الجهة ونوع العقد. التغيير يطبق على المطالبات الجديدة فقط.
            </p>
          </ActionForm>
        </Card>

        <div className="space-y-5">
          <BrandSettings {...await (async () => { const b = await getBrand(); return { slogan: b.slogan, profitRoles: [...b.profitRoles], bankRoles: [...b.bankRoles] }; })()} />
          <MetaSettings />
          <CanvaSettings notice={searchParams?.canva} />
          <AiServicesSettings />
          <EinvoiceSettings s={einv} keysSet={jofotaraConfigured()} readiness={einvReadiness(einv)} />
          <Card title={<span className="flex items-center gap-2"><Mail className="h-5 w-5" /> التنبيهات البريدية</span>} action={configured ? <Badge tone="green"><CheckCircle2 className="h-3.5 w-3.5" /> SMTP مُعد</Badge> : <Badge tone="red"><XCircle className="h-3.5 w-3.5" /> غير مُعد</Badge>}>
            <ul className="mb-4 space-y-1.5 text-sm text-ink-soft">
              <li>• الفحص التلقائي: <b>{schedule ?? "معطّل"}</b></li>
              <li>• بريد المدير العام للتنبيهات: <b dir="ltr">{adminTo}</b></li>
              {configured && <li>• الخادم: <b dir="ltr">{info.host}:{info.port}</b> ({info.security}) — المستخدم <b dir="ltr">{info.user}</b></li>}
              <li>• المستخدمون المستلمون: <b>{withEmail}</b> (أضف البريد من صفحة المستخدمين)</li>
              <li>• كل تنبيه يُرسل مرة واحدة لكل مرحلة (قبل 3 أيام، اليوم، متأخر)</li>
            </ul>
            {!configured && (
              <div className="mb-4 rounded-xl bg-canvas p-3 text-xs leading-6">
                أضف إلى ملف <code dir="ltr">.env</code> ثم أعد تشغيل الخادم:
                <pre dir="ltr" className="mt-2 overflow-x-auto rounded-lg bg-ink p-3 text-[11px] text-white">{`SMTP_HOST="smtp.gmail.com"
SMTP_PORT="587"
SMTP_USER="your.account@gmail.com"
SMTP_PASS="xxxx xxxx xxxx xxxx"   # App Password
SMTP_FROM="South Sada ERP <your.account@gmail.com>"`}</pre>
              </div>
            )}
            <ActionForm action={sendTestEmail} submitLabel="تشخيص البريد وإرسال رسالة اختبار" resetOnSuccess={false}>
              <Input name="to" label="إرسال رسالة التشخيص إلى" type="email" dir="ltr" defaultValue={adminTo} hint="يفحص الاتصال والمصادقة ثم يرسل تقريراً بالإعدادات والتنبيهات النشطة" />
            </ActionForm>
            <div className="mt-4 border-t border-line pt-4">
              <ActionForm action={runAlertsNow} submitLabel="فحص التنبيهات وإرسالها الآن">
                <p className="text-sm text-ink-muted">يرسل فوراً ملخص التنبيهات الجديدة لكل مستخدم لديه بريد.</p>
              </ActionForm>
            </div>
          </Card>

          <Card
            title={<span className="flex items-center gap-2"><DatabaseBackup className="h-5 w-5" /> النسخ الاحتياطي</span>}
            action={backupConfigured() ? <Badge tone="green"><CheckCircle2 className="h-3.5 w-3.5" /> تلقائي يومياً</Badge> : <Badge tone="red"><XCircle className="h-3.5 w-3.5" /> غير مُعد</Badge>}
          >
            <p className="mb-3 text-sm text-ink-muted">نسخة كاملة من كل البيانات تُحفظ تلقائياً كل يوم في تخزين سحابي خاص (آخر 35 يوماً + نسخة لكل شهر لمدة سنة)، والمرفقات تُنسخ مرة واحدة.</p>
            {backups && backups.length > 0 ? (
              <ul className="mb-4 max-h-56 divide-y divide-line overflow-y-auto text-sm">
                {backups.slice(0, 40).map((b) => (
                  <li key={b.name} className="flex items-center justify-between gap-3 py-2">
                    <span className="num font-semibold">{b.name.replace(".json.gz", "")}</span>
                    <span className="flex items-center gap-3">
                      <span className="num text-xs text-ink-muted">{Math.max(1, Math.round(b.size / 1024))} KB</span>
                      <a href={`/api/system/backups/${b.name}`} className="btn-ghost btn-sm"><Download className="h-4 w-4" /> تنزيل</a>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mb-4 rounded-xl bg-canvas px-3 py-2 text-xs text-ink-muted">{backups ? "لم تُحفظ أي نسخة بعد — أول نسخة تلقائية الليلة، أو اضغط «نسخة احتياطية الآن»." : "تعذّرت قراءة قائمة النسخ."}</p>
            )}
            <ActionForm action={backupNow} submitLabel="نسخة احتياطية الآن">
              <span />
            </ActionForm>
          </Card>

          <Card title="آخر الرسائل المرسلة">
            {logs.length === 0 ? (
              <p className="py-4 text-center text-sm text-ink-muted">لا توجد رسائل بعد</p>
            ) : (
              <ul className="divide-y divide-line text-sm">
                {logs.map((l) => (
                  <li key={l.id} className="flex items-start justify-between gap-3 py-2">
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{l.subject}</span>
                      <span className="text-xs text-ink-muted" dir="ltr">{l.to}</span>
                      {l.error && <span className="block text-xs text-bad">{l.error}</span>}
                    </span>
                    <span className="shrink-0 text-end">
                      <Badge tone={l.status === "SENT" ? "green" : "red"}>{l.status === "SENT" ? "أُرسلت" : "فشلت"}</Badge>
                      <span className="num block text-[11px] text-ink-muted">{time.format(l.createdAt)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

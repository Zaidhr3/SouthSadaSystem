import { CheckCircle2, Facebook, Instagram, Unplug, XCircle } from "lucide-react";
import { Badge, Card } from "@/components/ui";
import { ActionForm, ConfirmButton, Input } from "@/components/forms";
import { ALL_SCOPES, CAPABILITIES, capabilityOn, DEFAULT_PAGE_ID, metaStatus } from "@/lib/meta";
import { checkMetaAction, connectMetaAction, disconnectMeta } from "../actions/meta";

const fmt = (iso?: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "Asia/Amman", dateStyle: "short", timeStyle: "short" }) : "—");

/** ربط صفحة فيسبوك وحساب إنستغرام — الرمز يُشفّر في قاعدة البيانات ولا يُعرض بعد الحفظ */
export async function MetaSettings() {
  const s = await metaStatus();
  const connected = !!s?.configured;
  return (
    <Card
      title={
        <span id="meta" className="flex items-center gap-2">
          <Facebook className="h-5 w-5 text-[#1877f2]" /> <Instagram className="h-5 w-5 text-[#d6249f]" /> ربط فيسبوك وإنستغرام
        </span>
      }
      action={connected ? s!.ok ? <Badge tone="green"><CheckCircle2 className="h-3.5 w-3.5" /> متصل</Badge> : <Badge tone="red"><XCircle className="h-3.5 w-3.5" /> منقطع</Badge> : <Badge tone="gray">غير مربوط</Badge>}
    >
      {connected && (
        <ul className="mb-4 space-y-1.5 text-sm text-ink-soft">
          <li>• الصفحة: <b>{s!.pageName ?? "—"}</b> <span className="num text-xs text-ink-muted">({s!.pageId})</span></li>
          <li>• إنستغرام: <b>{s!.igUsername ? `@${s!.igUsername}` : s!.hasInstagram ? "مربوط" : "لا يوجد حساب أعمال مرتبط بالصفحة"}</b></li>
          <li>• مصدر الرمز: <b>{s!.source === "env" ? "متغيرات الخادم (.env)" : "مشفّر في قاعدة البيانات"}</b>{s!.connectedBy && ` — ربطه ${s!.connectedBy} ${fmt(s!.connectedAt)}`}</li>
          <li>• صلاحية الرمز: <b>{s!.expiresAt ? `تنتهي ${fmt(s!.expiresAt)}` : "دائم (رمز صفحة طويل الأمد)"}</b></li>
          <li>• آخر فحص: <b>{fmt(s!.checkedAt)}</b></li>
          {s!.error && <li className="rounded-xl bg-bad-soft px-3 py-2 font-semibold text-bad">{s!.error}</li>}
          {!!s!.missingScopes?.length && (
            <li className="rounded-xl bg-warn-soft px-3 py-2 font-semibold text-warn">
              صلاحيات ناقصة في الرمز (النشر/التعليقات/إنستغرام لن تعمل): <span dir="ltr" className="font-mono text-xs">{s!.missingScopes.join(", ")}</span> — أعد إنشاء الرمز مع هذه الصلاحيات.
            </li>
          )}
        </ul>
      )}
      {connected && (
        <div className="mb-4 rounded-2xl border border-line p-3">
          <p className="mb-2 text-sm font-bold">الميزات حسب الصلاحيات الممنوحة {s!.scopes ? <span className="font-normal text-ink-muted">({s!.scopes.length} صلاحية)</span> : <span className="font-normal text-ink-muted">— اضغط «اختبار الاتصال» لقراءتها</span>}</p>
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {CAPABILITIES.map((c) => {
              const on = capabilityOn(s!.scopes, c.key);
              return (
                <li key={c.key} className={on ? "flex items-start gap-2 rounded-xl bg-good-soft/60 px-2.5 py-1.5 text-sm" : "flex items-start gap-2 rounded-xl bg-black/[0.03] px-2.5 py-1.5 text-sm text-ink-muted"}>
                  {on ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-good" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-ink-faint" />}
                  <span className="min-w-0">
                    <b className={on ? "text-ink" : ""}>{c.label}</b>
                    {!on && <span dir="ltr" className="block font-mono text-[10px]">{c.scopes.filter((x) => !s!.scopes?.includes(x)).join(c.any ? " أو " : ", ")}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {connected && (
        <div className="mb-4 flex flex-wrap gap-2">
          <ActionForm action={checkMetaAction} submitLabel="اختبار الاتصال" resetOnSuccess={false}>
            <span />
          </ActionForm>
          {s!.source === "settings" && (
            <ConfirmButton action={disconnectMeta} confirm="فصل الربط؟ يتوقف النشر التلقائي والرد على التعليقات حتى إعادة الربط." className="btn-danger btn-sm">
              <Unplug className="h-4 w-4" /> فصل
            </ConfirmButton>
          )}
        </div>
      )}
      {s?.source !== "env" && (
        <ActionForm action={connectMetaAction} submitLabel={connected ? "تحديث الرمز" : "ربط الصفحة"}>
          <Input name="token" label="رمز الوصول (Access Token)" type="password" dir="ltr" autoComplete="off" required hint="رمز صفحة أو رمز مستخدم مدير للصفحة — يُشفّر فوراً ولا يظهر مجدداً" />
          <Input name="pageId" label="معرّف الصفحة" dir="ltr" defaultValue={s?.pageId ?? DEFAULT_PAGE_ID} />
          <details className="rounded-xl bg-canvas p-3 text-sm">
            <summary className="cursor-pointer font-semibold">تحويل لرمز دائم (اختياري — موصى به)</summary>
            <p className="my-2 text-xs text-ink-muted">رمز «Graph API Explorer» العادي ينتهي خلال ساعات. بإدخال معرّف التطبيق وسرّه يُحوَّل لرمز طويل الأمد، ويُستخرج منه رمز صفحة دائم. السر لا يُخزّن.</p>
            <Input name="appId" label="App ID" dir="ltr" autoComplete="off" />
            <Input name="appSecret" label="App Secret" type="password" dir="ltr" autoComplete="off" />
          </details>
          <details className="rounded-xl border border-line p-3 text-sm leading-7">
            <summary className="cursor-pointer font-semibold">كيف أحصل على الرمز؟</summary>
            <ol className="mt-2 list-decimal space-y-1 ps-5 text-ink-soft">
              <li>ادخل developers.facebook.com بحساب مدير صفحة «صدى الجنوب» ← My Apps ← Create App (نوع Business).</li>
              <li>أضف المنتجين: «Facebook Login for Business» و«Instagram» (واربط حساب إنستغرام بالصفحة كحساب أعمال من إعدادات الصفحة).</li>
              <li>
                افتح Tools ← Graph API Explorer، اختر تطبيقك، ثم Get User Access Token وفعّل كل الصلاحيات التالية (كل صلاحية تشغّل ميزتها في النظام تلقائياً):
                <code dir="ltr" className="mt-1 block select-all break-all rounded-lg bg-black/[0.05] p-2 font-mono text-[11px] leading-5">{ALL_SCOPES.join(",")}</code>
                بعض الصلاحيات (الرسائل، الإحصاءات، الإعلانات، العملاء المحتملون) تعمل فوراً لمديري التطبيق نفسه، ولغيرهم تحتاج مراجعة Meta (App Review).
              </li>
              <li>انسخ الرمز والصقه هنا، وأدخل App ID وApp Secret (من App settings ← Basic) ليصبح الرمز دائماً.</li>
            </ol>
          </details>
        </ActionForm>
      )}
      <p className="mt-3 text-xs text-ink-faint">عند انتهاء صلاحية الرمز أو سحب الصلاحيات: يتوقف النشر بأمان (لا يضيع المحتوى المعتمد)، تظهر حالة «منقطع» هنا، ويصلك تنبيه فوري. الفحص يتكرر كل صباح تلقائياً.</p>
    </Card>
  );
}

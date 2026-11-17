import { CheckCircle2, Link2, Unplug } from "lucide-react";
import { Badge, Card } from "@/components/ui";
import { ActionForm, ConfirmButton, Input } from "@/components/forms";
import { canvaStatus, CANVA_SCOPES, redirectUri } from "@/lib/canva";
import { disconnectCanva, saveCanvaAppAction } from "../actions/design";

/** ربط Canva Connect (OAuth + PKCE) — لاستيراد التصاميم الجاهزة كشرائح منشورات */
export async function CanvaSettings({ notice }: { notice?: string }) {
  const s = await canvaStatus();
  return (
    <Card title={<span id="canva" className="flex items-center gap-2"><span className="grid h-6 w-6 place-items-center rounded-full bg-gradient-to-br from-[#00c4cc] to-[#7d2ae8] text-[11px] font-black text-white">C</span> ربط Canva</span>} action={s.connected ? <Badge tone="green"><CheckCircle2 className="h-3.5 w-3.5" /> متصل</Badge> : <Badge tone="gray">غير مربوط</Badge>}>
      {notice && <p className={`mb-3 rounded-xl px-3 py-2 text-sm font-semibold ${notice === "ok" ? "bg-good-soft text-good" : "bg-bad-soft text-bad"}`}>{notice === "ok" ? "تم ربط Canva بنجاح" : notice}</p>}
      {s.connected && (
        <ul className="mb-3 space-y-1 text-sm text-ink-soft">
          <li>• ربطه: <b>{s.meta.user ?? "—"}</b> {s.meta.connectedAt ? new Date(s.meta.connectedAt).toLocaleDateString("en-GB") : ""}</li>
          {s.meta.error && <li className="rounded-xl bg-bad-soft px-3 py-2 font-semibold text-bad">{s.meta.error}</li>}
        </ul>
      )}
      <ActionForm action={saveCanvaAppAction} submitLabel={s.configured ? "تحديث بيانات التكامل" : "حفظ بيانات التكامل"}>
        <Input name="clientId" label="Client ID" dir="ltr" autoComplete="off" required />
        <Input name="clientSecret" label="Client Secret" type="password" dir="ltr" autoComplete="off" required hint="يُشفّر ولا يظهر مجدداً" />
      </ActionForm>
      <div className="mt-3 flex flex-wrap gap-2">
        {s.configured && <a href="/api/integrations/canva/start" className="btn-primary btn-sm"><Link2 className="h-4 w-4" /> {s.connected ? "إعادة ربط حساب Canva" : "ربط حساب Canva"}</a>}
        {s.configured && (
          <ConfirmButton action={disconnectCanva} confirm="فصل Canva وحذف بيانات التكامل؟" className="btn-danger btn-sm"><Unplug className="h-4 w-4" /> فصل</ConfirmButton>
        )}
      </div>
      <details open={!s.connected} className="mt-3 rounded-xl border border-line p-3 text-sm leading-7">
        <summary className="cursor-pointer font-semibold">إعداد التكامل في Canva — خطوة بخطوة</summary>
        <ol className="mt-2 list-decimal space-y-2 ps-5 text-ink-soft">
          <li>
            افتح <a href="https://www.canva.com/developers/integrations/connect-api" target="_blank" rel="noreferrer" className="font-semibold text-accent underline">Canva Developer Portal</a> ← تطبيقك (Connect API / Outside Canva).
          </li>
          <li>
            <b>Scopes</b>: فعّل <u>فقط</u> هاتين (Read) ثم احفظ:
            <div className="mt-1 flex flex-wrap gap-1.5" dir="ltr">
              {CANVA_SCOPES.split(" ").map((sc) => (
                <code key={sc} className="select-all rounded-lg bg-black/[0.05] px-2 py-0.5 font-mono text-xs">{sc}</code>
              ))}
            </div>
            <span className="text-xs text-ink-muted">إن فُعّلت design:content:read وحدها يعمل الاستيراد أيضاً (النظام يتكيف تلقائياً).</span>
          </li>
          <li>
            <b>Authentication ← Redirect URLs</b>: أضف هذا الرابط حرفياً (بلا / في آخره):
            <code dir="ltr" className="mt-1 block select-all break-all rounded-lg bg-black/[0.05] px-2 py-1 font-mono text-xs">{redirectUri()}</code>
          </li>
          <li><b>Configuration</b>: انسخ Client ID، وأنشئ Client Secret جديداً (يظهر مرة واحدة) — الصقهما أعلاه واحفظ. النظام يتحقق منهما مع Canva فوراً.</li>
          <li>اضغط «ربط حساب Canva» ووافق من حسابك — تعود هنا وتظهر «متصل».</li>
        </ol>
        <p className="mt-2 text-xs text-ink-muted">الملء التلقائي لقوالب العلامة (Brand Templates Autofill) ميزة في Canva Enterprise فقط — النظام يولّد تصاميمه بالقوالب المؤسسية الخاصة به، ويستورد من Canva ما تصممه يدوياً.</p>
      </details>
    </Card>
  );
}

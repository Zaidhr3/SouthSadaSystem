import { CheckCircle2, Sparkles, Trash2 } from "lucide-react";
import { Badge, Card } from "@/components/ui";
import { ActionForm, ConfirmButton, Input } from "@/components/forms";
import { SERVICE_LABEL, servicesStatus, type ServiceKey } from "@/lib/ai-services";
import { removeServiceAction, saveServiceAction } from "../actions/ai-services";

/** مفاتيح خدمات الذكاء الاصطناعي الخارجية — تُختبر مع المزوّد قبل الحفظ، وتُشفّر */
export async function AiServicesSettings() {
  const st = await servicesStatus();
  return (
    <Card title={<span id="ai-services" className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-accent" /> خدمات الذكاء الاصطناعي</span>}>
      <div className="grid gap-4 lg:grid-cols-3">
        {(Object.keys(SERVICE_LABEL) as ServiceKey[]).map((k) => (
          <div key={k} className="rounded-2xl border border-line p-3">
            <p className="flex items-center gap-2 font-bold">
              {SERVICE_LABEL[k].name}
              {st[k] ? <Badge tone="green"><CheckCircle2 className="h-3.5 w-3.5" /> يعمل</Badge> : <Badge tone="gray">غير مُعد</Badge>}
            </p>
            <p className="mb-2 text-xs text-ink-muted">{SERVICE_LABEL[k].use} — <a href={SERVICE_LABEL[k].url} target="_blank" rel="noreferrer" className="font-semibold text-accent underline">احصل على المفتاح</a></p>
            <ActionForm action={saveServiceAction.bind(null, k)} submitLabel={st[k] ? "تحديث المفتاح" : "حفظ واختبار"} resetOnSuccess>
              <Input name="key" label="API Key" type="password" dir="ltr" autoComplete="off" required />
            </ActionForm>
            {st[k] && (
              <ConfirmButton action={removeServiceAction.bind(null, k)} confirm={`حذف مفتاح ${SERVICE_LABEL[k].name}؟`} className="btn-ghost btn-sm mt-2">
                <Trash2 className="h-4 w-4" /> حذف
              </ConfirmButton>
            )}
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-ink-faint">يُختبر كل مفتاح مع مزوّده قبل الحفظ ويُشفّر ولا يظهر مجدداً. المساعد الذكي يستخدم Perplexity وFirecrawl تلقائياً متى توفرا، والتعليق الصوتي يظهر في صفحة كل منشور.</p>
    </Card>
  );
}

import { CheckCircle2, ReceiptText, XCircle } from "lucide-react";
import { Badge, Card } from "@/components/ui";
import { ActionForm, Grid, Input, Select } from "@/components/forms";
import type { EinvSettings } from "@/lib/jofotara";
import { saveEinvSettings } from "../actions/einvoice";

/** إعدادات الربط مع نظام الفوترة الوطني الأردني (جفوتارا) */
export function EinvoiceSettings({ s, keysSet, readiness }: { s: EinvSettings; keysSet: boolean; readiness: string | null }) {
  return (
    <Card
      title={<span className="flex items-center gap-2"><ReceiptText className="h-5 w-5" /> نظام الفوترة الوطني (جفوتارا)</span>}
      action={readiness ? <Badge tone="orange"><XCircle className="h-3.5 w-3.5" /> غير جاهز</Badge> : <Badge tone="green"><CheckCircle2 className="h-3.5 w-3.5" /> جاهز</Badge>}
    >
      <ActionForm action={saveEinvSettings} submitLabel="حفظ إعدادات الفوترة" draft={false}>
        <p className={`rounded-xl px-3 py-2 text-xs font-semibold ${keysSet ? "bg-good-soft text-good" : "bg-bad-soft text-bad"}`}>
          {keysSet ? "مفاتيح الربط (Client-Id و Secret-Key) مضبوطة بأمان على الخادم ولا تظهر في الواجهة." : "مفاتيح الربط غير مضبوطة على الخادم (JOFOTARA_CLIENT_ID / JOFOTARA_SECRET_KEY)."}
        </p>
        <Grid>
          <Input name="tin" label="الرقم الضريبي للشركة" dir="ltr" defaultValue={s.tin} required hint="كما في شهادة التسجيل لدى دائرة ضريبة الدخل والمبيعات" />
          <Input name="activityNo" label="رقم تسلسل مصدر الدخل" dir="ltr" defaultValue={s.activityNo} required hint="من بوابة جفوتارا ← بيانات المنشأة" />
        </Grid>
        <Input name="companyName" label="الاسم المسجل لدى الضريبة" defaultValue={s.companyName} />
        <Grid>
          <Select name="kind" label="نوع الفاتورة" options={{ income: "فاتورة دخل (غير مسجل بضريبة المبيعات)", sales: "فاتورة ضريبة مبيعات عامة" }} defaultValue={s.kind} />
          <Input name="taxPct" label="نسبة ضريبة المبيعات (%)" inputMode="decimal" defaultValue={s.taxPct} hint="تُطبق على فواتير المبيعات فقط" />
        </Grid>
        <Select
          name="priceMode"
          label="أسعار المطالبات والضريبة"
          options={{ inclusive: "شاملة ضريبة المبيعات — إجمالي الفاتورة = قيمة المطالبة (الضريبة من داخل المبلغ)", exclusive: "غير شاملة — تُضاف الضريبة فوق قيمة المطالبة" }}
          defaultValue={s.inclusive ? "inclusive" : "exclusive"}
        />
        <Select
          name="zeroCategory"
          label="عند نسبة 0% في فاتورة المبيعات"
          options={{ Z: "معفاة من ضريبة المبيعات (Z)", O: "خاضعة بنسبة صفر (O)" }}
          defaultValue={s.zeroCategory}
          hint="غير المسجل بضريبة المبيعات يختار «فاتورة دخل» أعلاه ولا يحتاج هذا الخيار"
        />
        <Input name="buyerCity" label="رمز محافظة المشتري الافتراضي" dir="ltr" defaultValue={s.buyerCity} hint="مثل JO-AM عمّان، JO-TA الطفيلة، JO-KA الكرك، JO-MA معان" />
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input type="checkbox" name="enabled" defaultChecked={s.enabled} /> تفعيل الإرسال التلقائي للفاتورة عند الموافقة النهائية على المطالبة
        </label>
        {readiness && <p className="rounded-xl bg-warn-soft px-3 py-2 text-xs font-semibold text-warn">{readiness}</p>}
        <p className="text-xs text-ink-muted">الإرسال لنظام الفوترة إجراء ضريبي رسمي. تُرسل الفاتورة مرة واحدة لكل مطالبة، ويُحفظ الـ UUID ورمز QR ويُطبعان معها.</p>
      </ActionForm>
    </Card>
  );
}

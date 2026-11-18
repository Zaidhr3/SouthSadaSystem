import type { Tender } from "@prisma/client";
import { Grid, Input, Select, Textarea, FileInput } from "@/components/forms";
import { toInputDate } from "@/lib/format";
import { STAGE_OPTIONS } from "@/lib/project-phase";

/** بيانات صاحب المشروع الخاص لحساب البوابة (تُعبّأ تلقائياً من طلب الموقع) */
export type ClientPrefill = { name?: string; email?: string | null; phone?: string | null; quoteId?: number; password?: string };

export function TenderFields({ t, managers, withFiles, kind: kindProp, client }: { t?: Partial<Tender>; managers: { id: number; name: string }[]; withFiles?: boolean; kind?: "GOV" | "PRIVATE"; client?: ClientPrefill }) {
  const priv = (t?.kind ?? kindProp) === "PRIVATE";
  if (priv) return <PrivateFields t={t} managers={managers} withFiles={withFiles} client={client} />;
  return (
    <>
      <input type="hidden" name="kind" value="GOV" />
      <Input name="name" label="اسم العطاء / المشروع" required defaultValue={t?.name} placeholder="مثال: إنشاء مدرسة الحسا الأساسية المختلطة" />
      <Grid>
        <Input name="number" label="رقم العطاء" required defaultValue={t?.number} placeholder="ع/2026/45" />
        <Input name="entity" label="الجهة المالكة / صاحب العمل" required defaultValue={t?.entity} placeholder="وزارة الأشغال العامة والإسكان" list="entities" />
      </Grid>
      <datalist id="entities">
        {[
          "وزارة الأشغال العامة والإسكان",
          "وزارة التربية والتعليم",
          "وزارة الصحة",
          "دائرة العطاءات الحكومية",
          "وزارة الأوقاف والشؤون والمقدسات الإسلامية",
          "بلدية الكرك الكبرى",
          "بلدية الطفيلة الكبرى",
          "بلدية معان الكبرى",
          "سلطة منطقة العقبة الاقتصادية الخاصة",
          "وزارة الشباب",
        ].map((e) => (
          <option key={e} value={e} />
        ))}
      </datalist>
      <Grid>
        <Input name="location" label="الموقع" defaultValue={t?.location ?? ""} placeholder="الكرك - المزار الجنوبي" />
        <Input name="classification" label="التصنيف المطلوب" defaultValue={t?.classification ?? "أبنية - رابعة"} />
      </Grid>
      <Grid cols={3}>
        <Input name="purchaseDate" label="تاريخ شراء الوثائق" type="date" required defaultValue={toInputDate(t?.purchaseDate) || new Date().toISOString().slice(0, 10)} />
        <Input name="docFee" label="ثمن الوثائق (د.أ)" type="number" required defaultValue={t?.docFee ?? 50} hint="25 / 50 / 75 د.أ عادةً" />
        <Input name="deadline" label="آخر موعد للتقديم" type="date" required defaultValue={toInputDate(t?.deadline)} />
      </Grid>
      <Grid>
        <Input name="siteVisitDate" label="موعد زيارة الموقع" type="date" defaultValue={toInputDate(t?.siteVisitDate)} />
        <Select name="managerId" label="مدير المشروع المسؤول" options={managers.map((m) => ({ value: m.id, label: m.name }))} placeholder="— غير مسند —" defaultValue={t?.managerId ?? ""} />
      </Grid>
      <Textarea name="siteVisitNotes" label="ملاحظات زيارة الموقع" defaultValue={t?.siteVisitNotes ?? ""} />
      <Textarea name="notes" label="ملاحظات عامة" defaultValue={t?.notes ?? ""} />
      {withFiles && <FileInput label="وثائق العطاء (دعوة العطاء، المخططات، جدول الكميات)" />}
    </>
  );
}

/**
 * إدخال عطاء/مشروع قديم في مرحلته الفعلية (أرشفة): اختيار المرحلة الحالية + بيانات المراحل السابقة.
 * كل الحقول اختيارية ما عدا قيمة الإحالة للمشاريع المحالة. المرفقات تُرفع لاحقاً متى توفرت.
 */
export function StageFields() {
  return (
    <section className="space-y-4 rounded-2xl border border-accent/20 bg-accent-soft/30 p-4">
      <div>
        <p className="font-bold">المرحلة الحالية</p>
        <p className="text-xs text-ink-muted">لعطاء جديد اتركها «تم شراء الوثائق». لإدخال مشروع سابق اختر مرحلته الفعلية وأدخل ما يتوفر من بياناته — كل شيء قابل للتعديل والإكمال لاحقاً.</p>
      </div>
      <Select name="stage" label="المرحلة" options={STAGE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))} defaultValue="PURCHASED" />
      <label className="flex items-start gap-2 text-sm font-semibold text-ink-soft">
        <input type="checkbox" name="archive" className="mt-0.5 h-4 w-4 accent-[#0071e3]" />
        <span>
          عطاء قديم (أرشفة) — لا تُنشئ مصاريف تلقائية
          <span className="block text-xs font-normal text-ink-muted">ثمن الوثائق ورسوم الطوابع لا تُسجل كمصاريف ولا تؤثر على رصيد البنك</span>
        </span>
      </label>
      <details className="group rounded-xl bg-white p-3">
        <summary className="cursor-pointer text-sm font-bold text-accent">بيانات الإحالة والتنفيذ والاستلام (للمشاريع المحالة)</summary>
        <div className="mt-3 space-y-4">
          <Grid>
            <Input name="awardedValue" label="قيمة الإحالة (د.أ)" type="number" hint="مطلوبة للمراحل 1–5 والمشاريع المغلقة" />
            <Input name="bidAmount" label="قيمة العرض المقدم (د.أ)" type="number" hint="فارغ = قيمة الإحالة" />
          </Grid>
          <Grid cols={3}>
            <Input name="awardLetterNo" label="رقم ورقة الإحالة" />
            <Input name="awardLetterDate" label="تاريخ الإحالة" type="date" />
            <Input name="stampFee" label="رسوم الطوابع (د.أ)" type="number" />
          </Grid>
          <Grid cols={3}>
            <Input name="commenceOrderDate" label="تاريخ أمر المباشرة" type="date" />
            <Input name="durationDays" label="مدة التنفيذ (يوم)" type="number" step="1" />
            <Input name="progress" label="نسبة الإنجاز (%)" type="number" step="1" min={0} max={100} hint="فارغ = 100% للمراحل 3–5" />
          </Grid>
          <Grid>
            <Input name="preliminaryHandoverDate" label="تاريخ الاستلام الابتدائي" type="date" />
            <Select name="maintenanceMonths" label="مدة الصيانة" options={[{ value: 12, label: "سنة واحدة" }, { value: 24, label: "سنتان" }]} placeholder="—" />
          </Grid>
          <Grid>
            <Input name="finalHandoverDate" label="تاريخ الاستلام النهائي" type="date" />
            <Input name="maintenanceReleaseDate" label="تاريخ الإفراج عن كفالة الصيانة" type="date" />
          </Grid>
          <p className="text-xs text-ink-muted">الكفالات والمطالبات السابقة تُضاف بعد الحفظ من تبويبي «الكفالات» و«المطالبات».</p>
        </div>
      </details>
    </section>
  );
}

/** مشروع خاص (غير حكومي): مالك فرد أو شركة — بلا ثمن وثائق ولا دائرة عطاءات */
function PrivateFields({ t, managers, withFiles, client }: { t?: Partial<Tender>; managers: { id: number; name: string }[]; withFiles?: boolean; client?: ClientPrefill }) {
  const today = new Date().toISOString().slice(0, 10);
  return (
    <>
      <input type="hidden" name="kind" value="PRIVATE" />
      <input type="hidden" name="docFee" value="0" />
      <Input name="name" label="اسم المشروع" required defaultValue={t?.name} placeholder="مثال: فيلا سكنية — عبدون" />
      <Grid>
        <Input name="number" label="الرقم المرجعي" required defaultValue={t?.number ?? `PRV-${today.slice(0, 4)}-`} hint="رقم داخلي أو رقم العقد" />
        <Input name="entity" label="المالك / صاحب العمل" required defaultValue={t?.entity} placeholder="اسم المالك أو الشركة" />
      </Grid>
      <Grid>
        <Input name="location" label="موقع المشروع" defaultValue={t?.location ?? ""} />
        <Input name="classification" label="نوع المشروع" defaultValue={t?.classification ?? ""} placeholder="فيلا، عمارة سكنية، هيكل خرساني…" />
      </Grid>
      <Grid>
        <Input name="purchaseDate" label="تاريخ استلام الطلب" type="date" required defaultValue={toInputDate(t?.purchaseDate) || today} />
        <Input name="deadline" label="موعد تقديم عرض السعر" type="date" required defaultValue={toInputDate(t?.deadline) || today} />
      </Grid>
      <Grid>
        <Input name="supervisorName" label="المهندس المشرف (من طرف المالك)" defaultValue={t?.supervisorName ?? ""} />
        <Select name="managerId" label="مدير المشروع المسؤول" options={managers.map((m) => ({ value: m.id, label: m.name }))} placeholder="— غير مسند —" defaultValue={t?.managerId ?? ""} />
      </Grid>
      <Textarea name="notes" label="وصف المشروع وملاحظات" defaultValue={t?.notes ?? ""} />
      {withFiles && <FileInput label="المخططات والمواصفات وجداول الكميات والمستلزمات" />}
      {!t?.id && (
        <section className="rounded-2xl border border-accent/30 bg-accent-soft/40 p-4">
          {client?.quoteId && <input type="hidden" name="quoteId" value={client.quoteId} />}
          <p className="mb-1 font-bold text-accent">حساب صاحب المشروع في بوابة العملاء</p>
          <p className="mb-3 text-xs leading-6 text-ink-muted">يدخل صاحب المشروع بالبريد الإلكتروني وكلمة السر ويتابع إجراءات مشروعه (المراحل، نسبة الإنجاز، خطة العمل، اليوميات، المراسلات والتواقيع). تُرسل بيانات الدخول لبريده، وتُطلب منه كلمة سر جديدة عند أول دخول. اترك البريد فارغاً إن لم تُرد إنشاء حساب الآن.</p>
          <Grid>
            <Input name="clientName" label="اسم صاحب المشروع" defaultValue={client?.name ?? ""} />
            <Input name="clientPhone" label="رقم الهاتف" dir="ltr" defaultValue={client?.phone ?? ""} />
          </Grid>
          <Grid>
            <Input name="clientEmail" label="البريد الإلكتروني (اسم الدخول)" type="email" dir="ltr" defaultValue={client?.email ?? ""} />
            <Input name="clientPassword" label="كلمة السر" dir="ltr" autoComplete="off" defaultValue={client?.password ?? ""} hint="8 أحرف على الأقل — مقترحة تلقائياً ويمكنك تغييرها" />
          </Grid>
          <label className="mt-2 flex items-center gap-2 text-sm font-semibold"><input type="checkbox" name="clientSendEmail" defaultChecked /> أرسل بيانات الدخول لبريد صاحب المشروع</label>
        </section>
      )}
    </>
  );
}

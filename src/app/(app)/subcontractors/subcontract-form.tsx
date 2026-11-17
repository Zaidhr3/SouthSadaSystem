import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { toInputDate, todayUTC } from "@/lib/format";
import { FileInput, Grid, Input, ModalForm, Select, Textarea } from "@/components/forms";
import { createSubcontract } from "../actions/modules";

/** نموذج اتفاقية مقاولة باطن (المدير العام) */
export async function SubcontractForm({ tenders, fixedTenderId }: { tenders: { id: number; name: string }[]; fixedTenderId?: number }) {
  const [subs, settings] = await Promise.all([db.subcontractor.findMany({ where: { active: true }, orderBy: { name: "asc" } }), getSettings()]);
  return (
    <ModalForm title="اتفاقية مقاولة باطن جديدة" trigger="+ اتفاقية باطن" action={createSubcontract} wide>
      {subs.length === 0 && <p className="rounded-xl bg-warn-soft px-3 py-2 text-sm font-semibold text-warn">أضف مقاولي الباطن أولاً من صفحة «مقاولو الباطن».</p>}
      <Grid>
        {fixedTenderId ? (
          <input type="hidden" name="tenderId" value={fixedTenderId} />
        ) : (
          <Select name="tenderId" label="المشروع" options={tenders.map((t) => ({ value: t.id, label: t.name }))} placeholder="— اختر —" />
        )}
        <Select name="subcontractorId" label="مقاول الباطن" options={subs.map((s) => ({ value: s.id, label: `${s.name} — ${s.trade}` }))} placeholder="— اختر —" />
      </Grid>
      <Input name="scope" label="نطاق الأعمال" required placeholder="أعمال القصارة الداخلية والخارجية كاملة" />
      <Grid cols={3}>
        <Input name="value" label="قيمة الاتفاقية (د.أ)" type="number" required />
        <Input name="advance" label="الدفعة المقدمة (د.أ)" type="number" defaultValue={0} />
        <Input name="retentionPct" label="نسبة المحجوزات %" type="number" defaultValue={settings.subRetentionPct} />
      </Grid>
      <Grid>
        <Input name="startDate" label="تاريخ البدء" type="date" required defaultValue={toInputDate(todayUTC())} />
        <Input name="endDate" label="تاريخ الانتهاء المتوقع" type="date" />
      </Grid>
      <Textarea name="notes" label="ملاحظات وشروط" />
      <FileInput label="الاتفاقية الموقعة" />
    </ModalForm>
  );
}

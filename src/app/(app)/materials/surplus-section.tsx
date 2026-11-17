import { Recycle, Trash2 } from "lucide-react";
import type { SurplusItem } from "@prisma/client";
import { Card, EmptyState } from "@/components/ui";
import { ConfirmButton, Grid, Input, ModalForm, Select, Textarea } from "@/components/forms";
import { addSurplus, allocateSurplus, deleteSurplus } from "../actions/surplus";

const nf = new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 });

/** مستودع المواد الفائضة: إدخال المتبقي من المشاريع وتدويره لمشاريع أخرى (يُسجل توريداً في المشروع المستلم) */
export function SurplusSection({
  items,
  projects,
  canEdit,
  canDelete,
}: {
  items: (SurplusItem & { fromName?: string | null })[];
  projects: { id: number; name: string }[];
  canEdit: boolean;
  canDelete: boolean;
}) {
  const opts = projects.map((p) => ({ value: p.id, label: p.name }));
  const value = items.reduce((s, i) => s + i.quantity * (i.unitCost ?? 0), 0);
  return (
    <Card
      className="mb-5"
      title={
        <span className="flex items-center gap-2">
          <Recycle className="h-5 w-5 text-good" aria-hidden /> مستودع المواد الفائضة — للتدوير
          {value > 0 && <span className="num rounded-full bg-good-soft px-2 py-0.5 text-xs text-good">{nf.format(value)} د.أ</span>}
        </span>
      }
      action={
        canEdit && (
          <ModalForm title="إدخال مادة فائضة" trigger="+ مادة فائضة" action={addSurplus}>
            <Grid>
              <Input name="material" label="المادة" required placeholder="حديد 12 ملم / بلوك 15 / إسمنت" />
              <Input name="unit" label="الوحدة" required placeholder="طن / حبة / كيس" />
            </Grid>
            <Grid>
              <Input name="quantity" label="الكمية المتبقية" inputMode="decimal" required />
              <Input name="unitCost" label="التكلفة للوحدة (د.أ)" inputMode="decimal" hint="اختياري — لتقييم المخزون" />
            </Grid>
            <Grid>
              <Select name="fromTenderId" label="متبقٍ من مشروع" options={opts} placeholder="مخزون الشركة" />
              <Input name="location" label="مكان التخزين" placeholder="مستودع الطفيلة / الموقع" />
            </Grid>
            <Textarea name="notes" label="ملاحظات (الحالة، المواصفات)" />
          </ModalForm>
        )
      }
    >
      {items.length === 0 ? (
        <EmptyState icon={Recycle} title="لا توجد مواد فائضة" hint="سجّل ما يتبقى من المشاريع لتدويره بدل الشراء من جديد" />
      ) : (
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>المادة</th>
                <th className="text-end">الكمية المتاحة</th>
                <th className="text-end">التكلفة/وحدة</th>
                <th>المصدر</th>
                <th>المكان</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id}>
                  <td className="font-semibold">{i.material}{i.notes && <span className="block text-xs font-normal text-ink-muted">{i.notes}</span>}</td>
                  <td className="num text-end font-bold">{nf.format(i.quantity)} {i.unit}</td>
                  <td className="num text-end">{i.unitCost != null ? nf.format(i.unitCost) : "—"}</td>
                  <td className="text-ink-soft">{i.fromName ?? "مخزون الشركة"}</td>
                  <td className="text-ink-soft">{i.location ?? "—"}</td>
                  <td className="whitespace-nowrap">
                    {canEdit && (
                      <ModalForm title={`تدوير: ${i.material}`} trigger="تدوير لمشروع" triggerClass="btn-ghost btn-sm" action={allocateSurplus.bind(null, i.id)}>
                        <Select name="toTenderId" label="المشروع المستلم" options={opts} required />
                        <Input name="quantity" label={`الكمية (المتاح ${nf.format(i.quantity)} ${i.unit})`} inputMode="decimal" defaultValue={i.quantity} required />
                        <p className="text-xs text-ink-muted">تُسجل توريداً في تبويب «المواد» للمشروع المستلم بتكلفتها الدفترية.</p>
                      </ModalForm>
                    )}
                    {canDelete && (
                      <ConfirmButton action={deleteSurplus.bind(null, i.id)} confirm="حذف المادة من المستودع؟" className="btn-danger btn-sm" title="حذف">
                        <Trash2 className="h-4 w-4" />
                      </ConfirmButton>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

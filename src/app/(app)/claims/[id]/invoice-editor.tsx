"use client";

import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { ConfirmButton, Grid, Input, ModalForm, Textarea } from "@/components/forms";
import { parseNum } from "@/lib/num";
import { resetInvoiceOverride, saveInvoiceOverride } from "../../actions/invoice";

type Line = { description: string; unit: string; qty: string; price: string };
const nf = new Intl.NumberFormat("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 });

/**
 * تعديل الفاتورة من المدير العام: كل شيء قابل للتعديل (البنود، الوحدات، الكميات، الأسعار الشاملة، الخصم، بيانات المشتري، ملاحظة).
 * المعاينة تحسب المجموع لحظياً؛ الضريبة تُستخرج من داخل المبلغ (الأسعار شاملة) عند الحفظ.
 */
export function InvoiceEditor({
  claimId,
  initial,
  edited,
}: {
  claimId: number;
  initial: { lines: { description: string; unit: string; qty: number; price: number }[]; discount: number; buyerName: string; buyerTin: string; buyerPhone: string; note: string };
  edited: boolean;
}) {
  const [lines, setLines] = useState<Line[]>(() => initial.lines.map((l) => ({ description: l.description, unit: l.unit, qty: String(l.qty), price: String(l.price) })));
  const [discount, setDiscount] = useState(initial.discount ? String(initial.discount) : "");
  const set = (i: number, p: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...p } : l)));
  const total = useMemo(() => lines.reduce((s, l) => s + (parseNum(l.qty) || 0) * (parseNum(l.price) || 0), 0) - (parseNum(discount) || 0), [lines, discount]);
  const payload = JSON.stringify(lines.map((l) => ({ description: l.description, unit: l.unit, qty: l.qty, price: l.price })));

  return (
    <>
      <ModalForm title="تعديل الفاتورة (المدير العام)" trigger={edited ? "تعديل الفاتورة (معدّلة)" : "تعديل الفاتورة"} triggerClass="btn-secondary" action={saveInvoiceOverride.bind(null, claimId)} submitLabel="حفظ الفاتورة" wide draft={false}>
        <input type="hidden" name="lines" value={payload} />
        <p className="rounded-xl bg-canvas px-3 py-2 text-xs text-ink-muted">
          الأسعار شاملة ضريبة المبيعات — إجمالي الفاتورة = مجموع البنود − الخصم، والضريبة تُستخرج من داخله. التعديل يُسجَّل في سجل المطالبة ويُقفل بعد اعتماد الفاتورة من نظام الفوترة.
        </p>
        <div className="max-h-[45vh] overflow-auto rounded-xl border border-line">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="sticky top-0 bg-canvas text-xs text-ink-muted">
              <tr>
                <th className="p-2 text-start">الوصف</th>
                <th className="w-20 p-2">الوحدة</th>
                <th className="w-24 p-2">الكمية</th>
                <th className="w-28 p-2">السعر الشامل</th>
                <th className="w-28 p-2">القيمة</th>
                <th className="w-10 p-2" />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i} className="border-t border-line align-top">
                  <td className="p-1.5"><textarea aria-label="الوصف" className="input min-h-[2.75rem] resize-y text-sm" rows={1} value={l.description} onChange={(e) => set(i, { description: e.target.value })} /></td>
                  <td className="p-1.5"><input aria-label="الوحدة" className="input text-sm" value={l.unit} onChange={(e) => set(i, { unit: e.target.value })} /></td>
                  <td className="p-1.5"><input aria-label="الكمية" className="input text-sm num" inputMode="decimal" value={l.qty} onChange={(e) => set(i, { qty: e.target.value })} /></td>
                  <td className="p-1.5"><input aria-label="السعر" className="input text-sm num" inputMode="decimal" value={l.price} onChange={(e) => set(i, { price: e.target.value })} /></td>
                  <td className="p-1.5 pt-3 text-end num">{nf.format((parseNum(l.qty) || 0) * (parseNum(l.price) || 0))}</td>
                  <td className="p-1.5">
                    <button type="button" className="grid h-11 w-11 place-items-center rounded-lg text-bad hover:bg-bad-soft" aria-label="حذف البند" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button type="button" className="btn-secondary btn-sm" onClick={() => setLines((ls) => [...ls, { description: "", unit: "", qty: "1", price: "" }])}>
          <Plus className="h-4 w-4" /> إضافة بند
        </button>
        <Grid cols={3}>
          <Input name="discount" label="الخصم (د.أ، شامل)" inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.currentTarget.value)} />
          <Input name="buyerName" label="اسم المشتري" defaultValue={initial.buyerName} />
          <Input name="buyerTin" label="الرقم الضريبي للمشتري" dir="ltr" defaultValue={initial.buyerTin} />
        </Grid>
        <Grid cols={2}>
          <Input name="buyerPhone" label="هاتف المشتري" dir="ltr" defaultValue={initial.buyerPhone} />
          <Textarea name="note" label="ملاحظة/سبب التعديل" defaultValue={initial.note} />
        </Grid>
        <p className="text-end text-sm font-bold">إجمالي الفاتورة: <span className="num">{nf.format(total)}</span> د.أ</p>
      </ModalForm>
      {edited && (
        <ConfirmButton action={resetInvoiceOverride.bind(null, claimId)} confirm="إلغاء التعديل اليدوي والعودة لحساب الفاتورة تلقائياً من المطالبة؟" className="btn-secondary">
          استعادة الحساب التلقائي
        </ConfirmButton>
      )}
    </>
  );
}

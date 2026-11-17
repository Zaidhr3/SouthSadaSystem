"use client";

import { useMemo, useState } from "react";
import clsx from "clsx";
import { AlertTriangle, Save } from "lucide-react";
import { ActionForm, ConfirmButton, FileInput, type ActionState } from "@/components/forms";
import { cleanNumInput, parseNum, r3 } from "@/lib/num";

export type SurveyRow = {
  boqItemId: number;
  itemNo: string | null;
  description: string;
  unit: string;
  unitPrice: number;
  boqQty: number;
  previousQty: number;
  cumulativeQty: number | null;
  note: string | null;
};

const nf = new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 });

/**
 * محرر الحصر الفعلي: يُدخل مدير المشروع الكمية التراكمية المنفذة المقاسة في الموقع لكل بند.
 * يحسب فورياً: كمية الفترة (منذ آخر مطالبة)، الفرق عن كمية جدول الكميات، وقيمة الفترة.
 */
export function SurveyEditor({
  rows,
  saveAction,
  submitAction,
  resubmit,
  surveyNumber,
  claimFormHref,
}: {
  rows: SurveyRow[];
  saveAction: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  submitAction: () => Promise<unknown>;
  resubmit?: boolean;
  surveyNumber: number;
  /** رابط نموذج المطالبة الكامل (الحسومات ونوع المطالبة) */
  claimFormHref?: string;
}) {
  const [values, setValues] = useState<Record<number, string>>(() =>
    Object.fromEntries(rows.map((r) => [r.boqItemId, r.cumulativeQty == null ? "" : String(r.cumulativeQty)])),
  );
  const [saved, setSaved] = useState(values);
  const dirty = useMemo(() => rows.some((r) => (values[r.boqItemId] ?? "") !== (saved[r.boqItemId] ?? "")), [rows, values, saved]);

  const calc = rows.map((r) => {
    const raw = values[r.boqItemId] ?? "";
    const parsed = parseNum(raw);
    const valid = parsed == null || (Number.isFinite(parsed) && parsed >= 0);
    const cum = parsed == null || !valid ? null : parsed;
    const period = cum == null ? 0 : r3(cum - r.previousQty);
    const variancePct = cum != null && r.boqQty > 0 ? ((cum - r.boqQty) / r.boqQty) * 100 : 0;
    return { r, cum, valid, period, amount: r3(period * r.unitPrice), variancePct };
  });
  const invalid = calc.filter((c) => !c.valid).length;
  const periodTotal = r3(calc.reduce((s, c) => s + c.amount, 0));
  const boqTotal = r3(rows.reduce((s, r) => s + r.boqQty * r.unitPrice, 0));
  const cumTotal = r3(calc.reduce((s, c) => s + (c.cum ?? c.r.previousQty) * c.r.unitPrice, 0));
  const measuredPct = boqTotal > 0 ? (cumTotal / boqTotal) * 100 : 0;
  const over = calc.filter((c) => c.cum != null && c.variancePct > 0.5).length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-2xl bg-canvas p-3">
          <p className="text-[11px] text-ink-muted">قيمة أعمال هذه الفترة</p>
          <p className={clsx("num text-lg font-bold", periodTotal < 0 && "text-bad")}>{nf.format(periodTotal)} د.أ</p>
        </div>
        <div className="rounded-2xl bg-canvas p-3">
          <p className="text-[11px] text-ink-muted">القيمة التراكمية المنفذة</p>
          <p className="num text-lg font-bold">{nf.format(cumTotal)} د.أ</p>
        </div>
        <div className="rounded-2xl bg-canvas p-3">
          <p className="text-[11px] text-ink-muted">الإنجاز حسب الحصر</p>
          <p className="num text-lg font-bold">{measuredPct.toFixed(1)}%</p>
        </div>
        <div className={clsx("rounded-2xl p-3", over ? "bg-warn-soft" : "bg-canvas")}>
          <p className="text-[11px] text-ink-muted">بنود تجاوزت كمية جدول الكميات</p>
          <p className={clsx("num text-lg font-bold", over && "text-warn")}>{over}</p>
        </div>
      </div>

      <ActionForm action={saveAction} submitLabel="حفظ الحصر" onSuccess={() => setSaved(values)} className="space-y-3">
        <div className="-mx-5 overflow-x-auto sm:-mx-6">
          <table className="tbl">
            <thead>
              <tr>
                <th>#</th>
                <th>البند</th>
                <th className="text-end">كمية جدول الكميات</th>
                <th className="text-end">مطالب به سابقاً</th>
                <th className="text-end">التراكمي المقاس فعلياً</th>
                <th className="text-end">كمية الفترة</th>
                <th>الفرق عن جدول الكميات</th>
                <th className="text-end">قيمة الفترة</th>
                <th>ملاحظة</th>
              </tr>
            </thead>
            <tbody>
              {calc.map(({ r, cum, valid, period, amount, variancePct }, i) => (
                <tr key={r.boqItemId} className={clsx(cum != null && "bg-accent-soft/30")}>
                  <td className="num text-ink-muted">{r.itemNo || i + 1}</td>
                  <td className="min-w-[220px] max-w-[320px]">
                    <span className="block font-semibold">{r.description}</span>
                    <span className="text-xs text-ink-muted">{r.unit} × {nf.format(r.unitPrice)} د.أ</span>
                  </td>
                  <td className="num text-end">{nf.format(r.boqQty)}</td>
                  <td className="num text-end text-ink-muted">{nf.format(r.previousQty)}</td>
                  <td className="text-end">
                    <input
                      name={`qty_${r.boqItemId}`}
                      inputMode="decimal"
                      aria-label={`الكمية التراكمية المقاسة — ${r.description}`}
                      value={values[r.boqItemId] ?? ""}
                      onChange={(e) => setValues((v) => ({ ...v, [r.boqItemId]: e.target.value }))}
                      onBlur={(e) => {
                        const clean = cleanNumInput(e.target.value);
                        setValues((v) => ({ ...v, [r.boqItemId]: clean }));
                      }}
                      autoComplete="off"
                      aria-invalid={!valid || undefined}
                      placeholder="—"
                      className={clsx("input num w-28 py-1.5 text-end", !valid && "input-error")}
                    />
                  </td>
                  <td className={clsx("num text-end font-semibold", period < 0 && "text-bad")}>{cum == null ? "—" : nf.format(period)}</td>
                  <td>
                    {cum == null ? (
                      <span className="text-xs text-ink-faint">—</span>
                    ) : Math.abs(variancePct) <= 0.5 ? (
                      <span className="text-xs font-semibold text-good">مطابق</span>
                    ) : variancePct > 0 ? (
                      <span className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-semibold text-warn">
                        <AlertTriangle className="h-3.5 w-3.5" /> زيادة {variancePct.toFixed(1)}% ({nf.format(cum - r.boqQty)} {r.unit})
                      </span>
                    ) : (
                      <span className="whitespace-nowrap text-xs text-ink-muted">أقل بـ {Math.abs(variancePct).toFixed(1)}%</span>
                    )}
                  </td>
                  <td className={clsx("num text-end font-bold", amount < 0 && "text-bad")}>{cum == null ? "—" : nf.format(amount)}</td>
                  <td>
                    <input name={`note_${r.boqItemId}`} defaultValue={r.note ?? ""} placeholder="الموقع/المحور" aria-label="ملاحظة" className="input w-36 py-1.5 text-xs" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-ink-muted">
          أدخل <b>الكمية التراكمية المنفذة حتى تاريخه</b> كما قيست في الموقع (مثلاً: البلاط 27 م² وإن كانت كمية الجدول 25). كمية الفترة = التراكمي − المطالب به سابقاً. الزيادة عن جدول الكميات قد تستلزم أمر تغيير.
        </p>
        <FileInput label="مرفقات الحصر (جداول القياس الموقعة، صور)" />
      </ActionForm>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line p-4">
        <p className="text-sm text-ink-soft">
          {dirty ? (
            <span className="flex items-center gap-1.5 font-semibold text-warn"><Save className="h-4 w-4" /> لديك تعديلات غير محفوظة — احفظ الحصر قبل إرسال المطالبة</span>
          ) : (
            <>بعد اكتمال القياس: أرسل المطالبة للمحاسب ليدقق الحسابات والكميات والخصومات ويرفعها للإدارة. يُقفل الحصر بعد الإرسال.</>
          )}
        </p>
        {invalid > 0 && <span className="text-sm font-semibold text-bad">{invalid} حقول بأرقام غير صالحة</span>}
        <div className="flex flex-wrap gap-2">
        {!dirty && claimFormHref && periodTotal !== 0 && (
          <a href={claimFormHref} className="btn-secondary">نموذج المطالبة (الحسومات والتفاصيل)</a>
        )}
        {!dirty && invalid === 0 && periodTotal !== 0 && (
          <ConfirmButton
            action={submitAction}
            confirm={`${resubmit ? "إعادة تقديم" : "إرسال"} المطالبة للمحاسب من الحصر رقم ${surveyNumber}؟ (قيمة أعمال الفترة ${nf.format(periodTotal)} د.أ) — يُقفل الحصر بعد الإرسال`}
            className="btn-primary"
          >
            {resubmit ? "إعادة تقديم المطالبة" : "إرسال المطالبة للمحاسب"}
          </ConfirmButton>
        )}
        </div>
      </div>
    </div>
  );
}

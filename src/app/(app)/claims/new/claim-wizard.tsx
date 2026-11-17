"use client";

import { useState } from "react";
import clsx from "clsx";
import { AlertTriangle, ReceiptText, Ruler } from "lucide-react";
import { computeInvoice, EINV_KIND_LABEL, type EinvKind } from "@/lib/einvoice";
import { ActionForm, Grid, Input, Select, Textarea, type ActionState } from "@/components/forms";
import { cleanNumInput, deductionAmount, parseNum, r3 } from "@/lib/num";

export type WizardRow = {
  boqItemId: number;
  itemNo: string | null;
  description: string;
  unit: string;
  unitPrice: number;
  boqQty: number;
  previousQty: number;
  /** الكمية السابقة قابلة للإدخال (بند غير مقاس سابقاً مع وجود مطالبات مقطوعة) */
  prevEditable: boolean;
  surveyQty: number | null;
  initial: number | null;
};

type DeductionMode = "none" | "pct" | "amount";

export type WizardContext = {
  contract: number;
  capPct: number;
  retentionHeldOthers: number;
  rates: { retentionPct: number; stampPct: number };
  type: string;
  date: string;
  notes: string;
  surveyId: number | null;
  surveyLabel: string | null;
  editing: boolean;
  submitLabel: string;
  /** نسب المحجوزات والطوابع: المحاسب والإدارة فقط */
  canEditRates: boolean;
  deduction: { mode: DeductionMode; value: number | null; notes: string };
  lumpSum: { count: number; gross: number; numbers: number[] };
  claimedGrossOthers: number;
  /** الفاتورة الضريبية (جفوتارا): نوعها ونسبة ضريبة المبيعات */
  einv: { kind: EinvKind; taxPct: number; buyer: string; inclusive?: boolean };
};

const nf = new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 });
/** قيمة الحقل كرقم (0 للفارغ أو غير الصالح) */
const numOr0 = (s: string) => {
  const n = parseNum(s);
  return n == null || !Number.isFinite(n) ? 0 : n;
};
const isBad = (s: string) => {
  const n = parseNum(s);
  return n != null && (!Number.isFinite(n) || n < 0);
};

/**
 * نموذج إنشاء وتعديل المطالبة المالية (مرحلية/نهائية).
 * كل الحسابات لحظية من حالة واحدة لكل بند:
 *   كمية الفترة = التراكمي الفعلي − السابق · قيمة الفترة = كمية الفترة × سعر الوحدة · القيمة التراكمية = التراكمي الفعلي × سعر الوحدة
 * المدخلات تقبل الأرقام العربية والإنجليزية وفواصل الآلاف (1,250.5 أو ١٬٢٥٠٫٥).
 */
export function ClaimWizard({ rows, ctx, action }: { rows: WizardRow[]; ctx: WizardContext; action: (prev: ActionState, fd: FormData) => Promise<ActionState> }) {
  const [qty, setQty] = useState<Record<number, string>>(() => Object.fromEntries(rows.map((r) => [r.boqItemId, r.initial == null ? "" : String(r.initial)])));
  const [prevIn, setPrevIn] = useState<Record<number, string>>(() => Object.fromEntries(rows.filter((r) => r.prevEditable).map((r) => [r.boqItemId, r.previousQty ? String(r.previousQty) : ""])));
  const [rates, setRates] = useState({ retentionPct: String(ctx.rates.retentionPct), stampPct: String(ctx.rates.stampPct) });
  const [type, setType] = useState(ctx.type);
  const [dMode, setDMode] = useState<DeductionMode>(ctx.deduction.mode);
  const [dValue, setDValue] = useState(ctx.deduction.value == null ? "" : String(ctx.deduction.value));

  const setRowQty = (id: number, v: string) => setQty((q) => ({ ...q, [id]: v }));
  const setRowPrev = (id: number, v: string) => setPrevIn((p) => ({ ...p, [id]: v }));

  const lines = rows.map((row) => {
    const pvRaw = row.prevEditable ? parseNum(prevIn[row.boqItemId]) : row.previousQty;
    const previousQty = pvRaw != null && Number.isFinite(pvRaw) && pvRaw >= 0 ? pvRaw : 0;
    const raw = qty[row.boqItemId] ?? "";
    const parsed = parseNum(raw);
    const valid = parsed == null || (Number.isFinite(parsed) && parsed >= 0);
    const cum = parsed == null || !valid ? null : parsed;
    const period = cum == null ? 0 : r3(cum - previousQty);
    const differsFromSurvey = row.surveyQty != null && cum != null && Math.abs(cum - row.surveyQty) > 0.0005;
    return {
      r: { ...row, previousQty },
      cum,
      valid,
      period,
      amount: r3(period * row.unitPrice),
      cumValue: r3((cum ?? previousQty) * row.unitPrice),
      differsFromSurvey,
    };
  });
  const invalid = lines.filter((l) => !l.valid).length + rows.filter((r) => r.prevEditable && isBad(prevIn[r.boqItemId] ?? "")).length;
  const gross = r3(lines.reduce((s, l) => s + l.amount, 0));
  const boqTotal = r3(rows.reduce((s, r) => s + r.boqQty * r.unitPrice, 0));
  const cumTotal = r3(lines.reduce((s, l) => s + l.cumValue, 0));
  const prevTotal = r3(cumTotal - gross);
  const retPct = numOr0(rates.retentionPct);
  const stampPct = numOr0(rates.stampPct);
  let retention = gross * (retPct / 100);
  if (ctx.capPct > 0 && ctx.contract > 0) retention = Math.max(0, Math.min(retention, ctx.contract * (ctx.capPct / 100) - ctx.retentionHeldOthers));
  retention = r3(retention);
  const stamp = r3(gross * (stampPct / 100));
  const dNum = numOr0(dValue);
  const deduction = dMode === "none" ? 0 : deductionAmount(gross, dMode === "pct" ? { rate: dNum, amount: null } : { rate: null, amount: dNum });
  const dBad = dMode !== "none" && (isBad(dValue) || (dMode === "pct" && dNum > 100));
  const net = r3(gross - retention - stamp - deduction);
  const changed = lines.filter((l) => l.differsFromSurvey).length;
  const claimedToDate = r3(ctx.claimedGrossOthers + gross);
  const overContract = ctx.contract > 0 && claimedToDate > ctx.contract;
  const over = lines.filter((l) => l.cum != null && l.cum > l.r.boqQty * 1.005).length;
  // الشاشة الثالثة: الفاتورة الضريبية تُبنى لحظياً من نفس الكميات والأسعار
  const invoice = computeInvoice({
    lines: lines.filter((l) => l.period !== 0).map((l) => ({ description: l.r.description, unit: l.r.unit, qty: l.period, price: l.r.unitPrice })),
    gross,
    deductions: deduction,
    kind: ctx.einv.kind,
    taxPct: ctx.einv.taxPct,
    inclusive: ctx.einv.inclusive,
    fallbackLabel: "قيمة الأعمال المنجزة",
  });

  const summary: [string, number, string?][] = [
    ["قيمة الأعمال المنجزة التراكمية", cumTotal],
    ["ينزل: قيمة الأعمال المطالب بها سابقاً", -prevTotal],
    ["إجمالي قيمة هذه المطالبة", gross, "bold"],
    [`المحجوزات (${retPct}%${ctx.capPct ? ` بسقف ${ctx.capPct}% من العقد` : ""})`, -retention],
    [`رسوم طوابع الواردات (${stampPct}%)`, -stamp],
    ...(deduction ? ([[`الحسم${dMode === "pct" ? ` (${dNum}%)` : ""}`, -deduction]] as [string, number][]) : []),
  ];

  return (
    <ActionForm action={action} submitLabel={ctx.submitLabel} className="space-y-5">
      {ctx.surveyId && <input type="hidden" name="surveyId" value={ctx.surveyId} />}
      <section className="card card-pad">
        <h2 className="mb-4 text-[17px] font-bold">بيانات المطالبة</h2>
        <Grid cols={3}>
          <Select name="type" label="نوع المطالبة" options={{ INTERIM: "مطالبة مرحلية (مستخلص جاري)", FINAL: "مطالبة نهائية (ختامية)" }} value={type} onChange={(e) => setType(e.target.value)} />
          <Input name="date" label="تاريخ المطالبة" type="date" required defaultValue={ctx.date} />
          <div className="rounded-xl bg-canvas p-3 text-xs text-ink-soft">
            <span className="flex items-center gap-1.5 font-semibold text-ink"><Ruler className="h-4 w-4 text-accent" /> مصدر الكميات</span>
            {ctx.surveyLabel ?? "لا يوجد حصر مفتوح — الكميات تبدأ من المطالب به سابقاً"}
          </div>
        </Grid>
        {type === "FINAL" && <p className="mt-3 rounded-xl bg-accent-soft px-3 py-2 text-xs text-[#0058b0]">المطالبة النهائية (الختامية): أدخل الكميات النهائية المنفذة لكل بند حسب الحصر النهائي.</p>}
      </section>

      {ctx.lumpSum.count > 0 && (
        <div className="flex gap-3 rounded-2xl border border-warn/30 bg-warn-soft p-4 text-sm text-warn">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="font-bold">
              توجد مطالبات سابقة بمبالغ مقطوعة (رقم {ctx.lumpSum.numbers.join("، ")}) بقيمة {nf.format(ctx.lumpSum.gross)} د.أ دون كميات.
            </p>
            <p className="mt-1">أدخل في عمود «سابق» الكميات التي شملتها تلك المطالبات لكل بند، حتى تُحسب كمية الفترة صحيحة ولا تتكرر المطالبة.</p>
          </div>
        </div>
      )}

      <section className="card">
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-5 sm:px-6">
          <h2 className="text-[17px] font-bold">الأعمال المنجزة — الكميات الفعلية</h2>
          <span className="flex flex-wrap gap-2 text-xs">
            {invalid > 0 && <span className="rounded-full bg-bad-soft px-2.5 py-1 font-semibold text-bad">{invalid} حقول بأرقام غير صالحة</span>}
            {changed > 0 && <span className="rounded-full bg-accent-soft px-2.5 py-1 font-semibold text-[#0058b0]">{changed} بنود معدلة عن حصر الموقع</span>}
            {over > 0 && <span className="rounded-full bg-warn-soft px-2.5 py-1 font-semibold text-warn">{over} بنود تتجاوز كمية الجدول</span>}
          </span>
        </div>
        <p className="px-5 pt-1 text-xs text-ink-muted sm:px-6">أدخل <b>التراكمي الفعلي</b> لكل بند — تُقبل الفواصل العشرية وفواصل الآلاف والأرقام العربية (مثال: 1,250.75).</p>
        <div className="mt-3 overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>#</th>
                <th>البند</th>
                <th className="text-end">كمية العقد</th>
                <th className="text-end">قيمة العقد</th>
                <th className="text-end">سابق</th>
                <th className="text-end">حصر الموقع</th>
                <th className="text-end">التراكمي الفعلي</th>
                <th className="text-end">كمية الفترة</th>
                <th className="text-end">قيمة الفترة</th>
                <th className="text-end">القيمة التراكمية</th>
              </tr>
            </thead>
            <tbody>
              {lines.map(({ r, cum, valid, period, amount, cumValue, differsFromSurvey }, i) => (
                <tr key={r.boqItemId} className={clsx(period !== 0 && "bg-accent-soft/30")}>
                  <td className="num text-ink-muted">{r.itemNo || i + 1}</td>
                  <td className="min-w-[220px] max-w-[320px]">
                    <span className="block font-semibold">{r.description}</span>
                    <span className="text-xs text-ink-muted">{r.unit} × {nf.format(r.unitPrice)}</span>
                  </td>
                  <td className="num text-end">{nf.format(r.boqQty)}</td>
                  <td className="num text-end text-ink-muted">{nf.format(r3(r.boqQty * r.unitPrice))}</td>
                  <td className="num text-end text-ink-muted">
                    {r.prevEditable ? (
                      <input
                        name={`prev_${r.boqItemId}`}
                        inputMode="decimal"
                        autoComplete="off"
                        aria-label={`الكمية المطالب بها سابقاً — ${r.description}`}
                        value={prevIn[r.boqItemId] ?? ""}
                        onChange={(e) => setRowPrev(r.boqItemId, e.target.value)}
                        onBlur={(e) => setRowPrev(r.boqItemId, cleanNumInput(e.target.value))}
                        placeholder="0"
                        className={clsx("input num w-24 border-warn/50 py-1.5 text-end", isBad(prevIn[r.boqItemId] ?? "") && "input-error")}
                      />
                    ) : (
                      nf.format(r.previousQty)
                    )}
                  </td>
                  <td className="num text-end">
                    {r.surveyQty == null ? (
                      "—"
                    ) : (
                      <button type="button" className="num font-semibold text-accent hover:underline" title="استخدام كمية حصر الموقع" onClick={() => setRowQty(r.boqItemId, String(r.surveyQty))}>
                        {nf.format(r.surveyQty)}
                      </button>
                    )}
                  </td>
                  <td className="text-end">
                    <input
                      name={`qty_${r.boqItemId}`}
                      inputMode="decimal"
                      autoComplete="off"
                      aria-label={`الكمية التراكمية الفعلية — ${r.description}`}
                      aria-invalid={!valid || undefined}
                      value={qty[r.boqItemId] ?? ""}
                      onChange={(e) => setRowQty(r.boqItemId, e.target.value)}
                      onBlur={(e) => setRowQty(r.boqItemId, cleanNumInput(e.target.value))}
                      placeholder={nf.format(r.previousQty)}
                      className={clsx("input num w-28 py-1.5 text-end", !valid && "input-error", differsFromSurvey && "border-accent")}
                    />
                    {!valid && <span className="mt-0.5 block text-[11px] font-semibold text-bad">رقم غير صالح</span>}
                    {cum != null && cum > r.boqQty * 1.005 && (
                      <span className="mt-0.5 flex items-center justify-end gap-1 text-[11px] font-semibold text-warn">
                        <AlertTriangle className="h-3 w-3" /> +{nf.format(r3(cum - r.boqQty))}
                      </span>
                    )}
                  </td>
                  <td className={clsx("num text-end font-semibold", period < 0 && "text-bad")}>{period ? nf.format(period) : "—"}</td>
                  <td className={clsx("num text-end font-bold", amount < 0 && "text-bad")}>{amount ? nf.format(amount) : "—"}</td>
                  <td className="num text-end text-ink-soft">{cum != null || r.previousQty ? nf.format(cumValue) : "—"}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3} className="px-5 py-3 font-bold sm:px-6">المجموع</td>
                <td className="num px-3 py-3 text-end font-bold">{nf.format(boqTotal)}</td>
                <td colSpan={4} />
                <td className="num px-3 py-3 text-end text-base font-bold">{nf.format(gross)}</td>
                <td className="num px-3 py-3 text-end font-bold">{nf.format(cumTotal)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-[1fr_1.2fr]">
        <div className="space-y-5">
          <section className="card card-pad">
            <h2 className="mb-4 text-[17px] font-bold">الحسومات</h2>
            <Grid>
              <Select
                name="deductionMode"
                label="نوع الحسم"
                options={{ none: "بدون حسم", pct: "نسبة من قيمة المطالبة (%)", amount: "مبلغ ثابت (د.أ)" }}
                value={dMode}
                onChange={(e) => setDMode(e.target.value as DeductionMode)}
              />
              {dMode !== "none" && (
                <Input
                  name="deductionValue"
                  label={dMode === "pct" ? "نسبة الحسم %" : "مبلغ الحسم (د.أ)"}
                  inputMode="decimal"
                  autoComplete="off"
                  value={dValue}
                  onChange={(e) => setDValue(e.target.value)}
                  onBlur={(e) => setDValue(cleanNumInput(e.target.value))}
                  className={clsx("num text-end", dBad && "input-error")}
                  hint={dBad ? (dMode === "pct" ? "أدخل نسبة بين 0 و 100" : "مبلغ غير صالح") : dMode === "pct" && deduction ? `= ${nf.format(deduction)} د.أ` : undefined}
                />
              )}
            </Grid>
            {dMode !== "none" && (
              <Input name="deductionNotes" label="سبب الحسم" required defaultValue={ctx.deduction.notes} placeholder="مثال: نواقص في أعمال الدهان / غرامة تأخير" wrapClass="mt-4" />
            )}
            <p className="mt-3 text-xs text-ink-muted">يظهر الحسم وسببه في المطالبة الرسمية، ويراجعه المحاسب قبل رفعها للإدارة. الحسم بالنسبة يُعاد احتسابه تلقائياً إذا تغيرت الكميات.</p>
          </section>
          <section className="card card-pad">
            <h2 className="mb-4 text-[17px] font-bold">نسب المستقطعات لهذه المطالبة</h2>
            <Grid>
              <Input name="retentionPct" label="المحجوزات %" inputMode="decimal" value={rates.retentionPct} readOnly={!ctx.canEditRates} onChange={(e) => setRates((x) => ({ ...x, retentionPct: e.target.value }))} />
              <Input name="stampPct" label="الطوابع %" inputMode="decimal" value={rates.stampPct} readOnly={!ctx.canEditRates} onChange={(e) => setRates((x) => ({ ...x, stampPct: e.target.value }))} hint="0.3% = 3 بالألف" />
            </Grid>
            <p className="mt-3 text-xs text-ink-muted">
              {ctx.canEditRates ? "القيم الافتراضية من «إعدادات النظام»." : "تُحدد نسب المحجوزات والطوابع من المحاسب والإدارة."} ضريبة الدخل لا تُخصم في المطالبة — تُسجل في وحدة «الضريبة» عند قبض المطالبة.
            </p>
            <Textarea name="notes" label="ملاحظات" defaultValue={ctx.notes} wrapClass="mt-4" />
          </section>
        </div>
        <section className="card card-pad self-start">
          <h2 className="mb-3 text-[17px] font-bold">المطالبة (المستخلص) — الخلاصة</h2>
          <dl className="divide-y divide-line text-sm">
            {summary.map(([label, v, style]) => (
              <div key={label} className={clsx("flex items-center justify-between gap-3 py-2", style === "bold" && "font-bold")}>
                <dt>{label}</dt>
                <dd className={clsx("num", v < 0 && "text-bad")}>{nf.format(v || 0)}</dd>
              </div>
            ))}
            <div className="flex items-center justify-between gap-3 rounded-xl bg-ink px-3 py-3 text-white">
              <dt className="font-bold">صافي المبلغ المستحق للصرف</dt>
              <dd className="num text-lg font-bold">{nf.format(net)} د.أ</dd>
            </div>
          </dl>
          <div className="mt-5 rounded-2xl border border-accent/20 bg-accent-soft/40 p-4">
            <h3 className="mb-2 flex items-center gap-2 text-sm font-bold"><ReceiptText className="h-4 w-4 text-accent" aria-hidden /> الفاتورة الضريبية الرسمية — تتعبأ تلقائياً</h3>
            <p className="mb-2 text-[11px] text-ink-muted">{EINV_KIND_LABEL[invoice.kind]}{invoice.inclusive ? ` (الأسعار شاملة الضريبة ${invoice.taxPct}% — الإجمالي = قيمة المطالبة)` : ""} — المشتري: {ctx.einv.buyer} — {invoice.lines.length} بنود. تُرسل لنظام الفوترة الوطني (جفوتارا) عند الموافقة النهائية.</p>
            <dl className="divide-y divide-line/70 text-sm">
              {([
                ["قيمة البنود", invoice.subtotal],
                ["الخصم", -invoice.discount],
                ...(invoice.kind === "sales" ? [[`ضريبة المبيعات ${invoice.taxPct}%`, invoice.tax]] : []),
              ] as [string, number][]).map(([l, v]) => (
                <div key={l} className="flex justify-between gap-3 py-1.5"><dt>{l}</dt><dd className={clsx("num", v < 0 && "text-bad")}>{nf.format(v || 0)}</dd></div>
              ))}
              <div className="flex justify-between gap-3 py-2 font-bold"><dt>إجمالي الفاتورة</dt><dd className="num">{nf.format(invoice.total)} د.أ</dd></div>
            </dl>
          </div>
          {gross <= 0 && <p className="mt-3 text-sm font-semibold text-bad">لا توجد كميات جديدة منذ آخر مطالبة.</p>}
          {net < 0 && <p className="mt-3 text-sm font-semibold text-bad">الحسم يتجاوز صافي المطالبة.</p>}
          {overContract && (
            <p className="mt-3 flex gap-2 rounded-xl bg-bad-soft p-3 text-xs font-semibold text-bad">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              إجمالي المطالبات حتى تاريخه {nf.format(claimedToDate)} د.أ يتجاوز قيمة العقد {nf.format(ctx.contract)} د.أ — راجع الكميات أو سجّل أمر تغيير قبل التقديم.
            </p>
          )}
        </section>
      </div>
    </ActionForm>
  );
}

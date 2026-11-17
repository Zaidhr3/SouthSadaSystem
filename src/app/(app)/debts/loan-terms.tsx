"use client";

import { useEffect, useRef, useState } from "react";
import { Calculator } from "lucide-react";
import { Grid, Input, Select } from "@/components/forms";
import { LOAN_FREQUENCY, LOAN_INTEREST_TYPE, LOAN_RECEIVED_VIA } from "@/lib/labels";
import { buildSchedule, computeInterest } from "@/lib/loan-math";
import { fmtDate, toInputDate, todayUTC } from "@/lib/format";

const nf = new Intl.NumberFormat("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const num = (v: FormDataEntryValue | null) => {
  const n = Number(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const date = (v: FormDataEntryValue | null) => (v ? new Date(`${v}T00:00:00.000Z`) : null);

type Preview = { interest: number; total: number; first: number; last: number; count: number; lastDate: Date } | null;

/** شروط الدين مع معاينة فورية للفائدة والقسط وتاريخ آخر قسط (الحساب النهائي على الخادم) */
export function LoanTermsFields() {
  const ref = useRef<HTMLDivElement>(null);
  const [interestType, setInterestType] = useState("NONE");
  const [frequency, setFrequency] = useState("MONTHLY");
  const [preview, setPreview] = useState<Preview>(null);

  useEffect(() => {
    const form = ref.current?.closest("form");
    if (!form) return;
    const calc = () => {
      const fd = new FormData(form);
      const it = String(fd.get("interestType") || "NONE");
      const fr = String(fd.get("frequency") || "MONTHLY");
      setInterestType(it);
      setFrequency(fr);
      const principal = num(fd.get("principal"));
      const received = date(fd.get("receivedDate"));
      const first = date(fd.get("firstDueDate"));
      const count = fr === "ONCE" ? 1 : Math.max(1, Math.round(num(fd.get("installmentCount")) || 1));
      if (!principal || !received || !first) return setPreview(null);
      const interest = computeInterest({ principal, interestType: it, interestRate: num(fd.get("interestRate")), interestAmount: num(fd.get("interestAmount")), frequency: fr, installmentCount: count, receivedDate: received, firstDueDate: first });
      const total = principal + interest + num(fd.get("fees"));
      const s = buildSchedule(total, count, fr, first);
      setPreview({ interest, total, first: s[0].amount, last: s[s.length - 1].amount, count: s.length, lastDate: s[s.length - 1].dueDate });
    };
    calc();
    form.addEventListener("input", calc);
    form.addEventListener("change", calc);
    return () => {
      form.removeEventListener("input", calc);
      form.removeEventListener("change", calc);
    };
  }, []);

  return (
    <div ref={ref} className="space-y-4">
      <Grid>
        <Input name="principal" label="أصل الدين المستلم (د.أ)" type="number" required />
        <Input name="receivedDate" label="تاريخ الاستلام" type="date" required defaultValue={toInputDate(todayUTC())} />
      </Grid>
      <Select name="receivedVia" label="طريقة الاستلام" options={LOAN_RECEIVED_VIA} defaultValue="BANK" />
      <Grid cols={3}>
        <Select name="interestType" label="الفائدة" options={LOAN_INTEREST_TYPE} defaultValue="NONE" />
        {interestType === "PERCENT" && <Input name="interestRate" label="النسبة السنوية %" type="number" step="0.01" required />}
        {interestType === "FIXED" && <Input name="interestAmount" label="مبلغ الفائدة (د.أ)" type="number" required />}
        <Input name="fees" label="عمولات ورسوم (د.أ)" type="number" hint="اختياري" />
      </Grid>
      <Grid cols={3}>
        <Select name="frequency" label="دورية السداد" options={LOAN_FREQUENCY} defaultValue="MONTHLY" />
        {frequency !== "ONCE" && <Input name="installmentCount" label="عدد الأقساط" type="number" step="1" min={1} defaultValue={12} required />}
        <Input name="firstDueDate" label={frequency === "ONCE" ? "تاريخ الاستحقاق" : "تاريخ أول قسط"} type="date" required />
      </Grid>
      <div className="flex items-start gap-3 rounded-xl border border-navy/10 bg-navy/[0.04] p-3 text-sm" aria-live="polite">
        <Calculator className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden />
        {preview ? (
          <div className="grid flex-1 grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
            <span>الفائدة: <b className="num">{nf.format(preview.interest)}</b></span>
            <span>المستحق الكلي: <b className="num text-accent">{nf.format(preview.total)}</b></span>
            <span>{preview.count > 1 ? "القسط" : "الدفعة"}: <b className="num">{nf.format(preview.first)}</b>{preview.last !== preview.first && <span className="text-ink-muted"> (الأخير {nf.format(preview.last)})</span>}</span>
            <span>آخر استحقاق: <b className="num">{fmtDate(preview.lastDate)}</b></span>
          </div>
        ) : (
          <span className="text-ink-muted">أدخل المبلغ والتواريخ لمعاينة القسط والمستحق الكلي.</span>
        )}
      </div>
    </div>
  );
}

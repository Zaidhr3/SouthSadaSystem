/** حسابات الدين (بلا قاعدة بيانات) — مشتركة بين الخادم ومعاينة النموذج في المتصفح */
import { addMonths, round3 } from "./format";
import { LOAN_FREQUENCY_MONTHS } from "./labels";

/** مدة الدين بالأشهر (لحساب الفائدة السنوية): عدد الأقساط × دوريتها، أو من الاستلام حتى الاستحقاق للدفعة الواحدة */
export function termMonths(p: { frequency: string; installmentCount: number; receivedDate: Date; firstDueDate: Date }) {
  const step = LOAN_FREQUENCY_MONTHS[p.frequency] ?? 1;
  if (step > 0) return step * Math.max(1, p.installmentCount);
  const days = Math.max(0, (p.firstDueDate.getTime() - p.receivedDate.getTime()) / 86400000);
  return days / 30.4375;
}

/** الفائدة: نسبة سنوية بسيطة على أصل الدين طوال المدة، أو مبلغ مقطوع */
export function computeInterest(p: { principal: number; interestType: string; interestRate: number | null; interestAmount: number | null; frequency: string; installmentCount: number; receivedDate: Date; firstDueDate: Date }) {
  if (p.interestType === "PERCENT") return round3((p.principal * (p.interestRate ?? 0)) / 100 * (termMonths(p) / 12));
  if (p.interestType === "FIXED") return round3(p.interestAmount ?? 0);
  return 0;
}

/** أقساط متساوية (الفرق الناتج عن التقريب يُضاف للقسط الأخير) */
export function buildSchedule(total: number, count: number, frequency: string, firstDueDate: Date, startSeq = 1) {
  const n = frequency === "ONCE" ? 1 : Math.max(1, count);
  const step = LOAN_FREQUENCY_MONTHS[frequency] ?? 1;
  const each = Math.floor((total / n) * 1000) / 1000;
  return Array.from({ length: n }, (_, i) => ({
    seq: startSeq + i,
    dueDate: addMonths(firstDueDate, step * i),
    amount: i === n - 1 ? round3(total - each * (n - 1)) : each,
  }));
}

/**
 * حساب الفاتورة الضريبية للمطالبة (مشترك بين المعاينة اللحظية في المتصفح، والطباعة، والإرسال لجفوتارا).
 * - فاتورة «دخل» (غير مسجل بضريبة المبيعات): بلا ضريبة.
 * - فاتورة «مبيعات عامة»: ضريبة المبيعات (16% افتراضياً) على قيمة الأعمال بعد الحسم.
 * قيمة الفاتورة = قيمة أعمال المطالبة (الإجمالي) − الحسومات. المحجوزات والطوابع ليست خصماً من الفاتورة (احتجاز من الدفعة).
 * الكميات السالبة (تصحيح كميات سابقة) تُعامل كخصم على الفاتورة لأن نظام الفوترة لا يقبل كميات سالبة.
 */
export type EinvKind = "income" | "sales";

export type EinvLineIn = { description: string; unit: string; qty: number; price: number };

const r3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;

/**
 * inclusive = الأسعار شاملة ضريبة المبيعات (أسعار العطاء الحكومي): إجمالي الفاتورة = قيمة المطالبة بعد الحسم تماماً،
 * والضريبة تُستخرج من داخل المبلغ (الصافي = الشامل ÷ 1.16) — لا يزيد المبلغ ولا ينقص.
 * غير الشامل: الضريبة تُضاف فوق الصافي.
 */
export function computeInvoice(input: { lines: EinvLineIn[]; gross: number; deductions: number; kind: EinvKind; taxPct: number; fallbackLabel: string; inclusive?: boolean }) {
  let lines = input.lines.filter((l) => l.qty > 0 && l.price >= 0).map((l) => ({ ...l, amount: r3(l.qty * l.price), discount: 0 }));
  const negative = r3(input.lines.filter((l) => l.qty < 0).reduce((s, l) => s + Math.abs(l.qty * l.price), 0));
  // مطالبة مقطوعة بلا بنود: سطر واحد بقيمة الأعمال
  if (lines.length === 0) lines = [{ description: input.fallbackLabel, unit: "مقطوعية", qty: 1, price: r3(input.gross), amount: r3(input.gross), discount: 0 }];
  const entered = r3(lines.reduce((s, l) => s + l.amount, 0));
  const discountIn = r3(Math.min(entered, negative + Math.max(0, input.deductions)));
  // الخصم يُحمَّل على البنود بالترتيب من الأكبر (نظام الفوترة يشترط تطابق مجموع خصومات البنود مع خصم الفاتورة)
  let left = discountIn;
  for (const l of [...lines].sort((a, b) => b.amount - a.amount)) {
    if (left <= 0) break;
    const d = r3(Math.min(l.amount, left));
    l.discount = d;
    left = r3(left - d);
  }
  const rate = input.kind === "sales" ? input.taxPct : 0;
  const inclusive = !!input.inclusive && rate > 0;
  const f = 1 + rate / 100;
  const out = lines.map((l) => {
    if (!inclusive) {
      const net = r3(l.amount - l.discount);
      const tax = r3(net * (rate / 100));
      return { ...l, priceIncl: l.price, net, tax, total: r3(net + tax) };
    }
    // الشامل: المجموع النهائي للبند = المدخل بعد الخصم تماماً، والضريبة = الفرق
    const total = r3(l.amount - l.discount);
    const amount = r3(l.amount / f);
    const discount = r3(l.discount / f);
    const net = r3(amount - discount);
    return { ...l, priceIncl: l.price, price: l.qty ? amount / l.qty : 0, amount, discount, net, tax: r3(total - net), total };
  });
  const sum = (k: "amount" | "discount" | "net" | "tax" | "total") => r3(out.reduce((s, l) => s + l[k], 0));
  return { lines: out, subtotal: sum("amount"), discount: sum("discount"), taxable: sum("net"), taxPct: rate, tax: sum("tax"), total: sum("total"), kind: input.kind, inclusive };
}

export type ComputedInvoice = ReturnType<typeof computeInvoice>;

export const EINV_KIND_LABEL: Record<EinvKind, string> = {
  income: "فاتورة دخل (غير خاضعة لضريبة المبيعات)",
  sales: "فاتورة ضريبة مبيعات عامة",
};

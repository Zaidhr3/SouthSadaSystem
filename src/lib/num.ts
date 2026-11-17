/**
 * قراءة الأرقام المُدخلة يدوياً بشكل موحّد (المتصفح والخادم):
 * - الأرقام العربية (٠-٩) والفارسية (۰-۹) → إنجليزية
 * - الفاصلة العشرية العربية «٫» → «.»
 * - فواصل الآلاف «,» و«٬» و«،» والمسافات → تُحذف
 * يعيد null للحقل الفارغ، وNaN للنص غير الصالح.
 */
export function parseNum(input: unknown): number | null {
  if (input == null) return null;
  if (typeof input === "number") return Number.isFinite(input) ? input : NaN;
  let s = String(input).trim();
  if (s === "") return null;
  s = s
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/٫/g, ".")
    .replace(/[,٬،\s ‏‎]/g, "")
    .replace(/^−/, "-");
  if (s === "" || !/^[-+]?(\d+\.?\d*|\.\d+)$/.test(s)) return NaN;
  return Number(s);
}

/** نسخة نظيفة من المُدخل لعرضها في الحقل بعد مغادرته (مثلاً «١٬٢٣٤٫٥» → «1234.5») */
export function cleanNumInput(input: string): string {
  const n = parseNum(input);
  return n == null || Number.isNaN(n) ? input : String(n);
}

/** تقريب لثلاث منازل عشرية (الفلس) دون أخطاء الفاصلة العائمة */
export const r3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;

/**
 * الحسم الإضافي على المطالبة: نسبة من قيمة أعمال المطالبة أو مبلغ ثابت.
 * عند إدخال نسبة يُعاد احتساب المبلغ تلقائياً كلما تغيرت قيمة الأعمال.
 */
export function deductionAmount(gross: number, d: { rate: number | null; amount: number | null }) {
  if (d.rate != null && d.rate > 0) return r3(gross * (d.rate / 100));
  return r3(Math.max(0, d.amount ?? 0));
}

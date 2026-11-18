/** طبقة ثانية: حجب أي قيمة حساسة تصل للنتائج (حتى عبر SELECT * أو row_to_json) قبل إرسالها لمزوّد الذكاء الاصطناعي */
const SENSITIVE_KEY = /(password|passwd|hash|secret|token|api_?key|otp|totp|verifier)/i;
const SENSITIVE_VALUE = /\$2[aby]?\$\d{2}\$[./A-Za-z0-9]{53}|\bv1\.[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,}|\beyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,}/g;
export function redact(v: unknown, depth = 0): unknown {
  if (depth > 8) return "[…]";
  if (typeof v === "string") return v.replace(SENSITIVE_VALUE, "[محجوب]");
  if (Array.isArray(v)) return v.map((x) => redact(x, depth + 1));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, SENSITIVE_KEY.test(k) ? "[محجوب]" : redact(x, depth + 1)]));
  return v;
}

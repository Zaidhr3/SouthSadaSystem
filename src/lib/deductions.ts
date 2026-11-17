import { round3 } from "./format";

/**
 * حاسبة المستقطعات والمحجوزات:
 *   الصافي = الإجمالي − المحجوزات − ضريبة الدخل المقتطعة − رسوم الطوابع − الخصومات الأخرى
 * المحجوزات تتوقف عند بلوغ السقف المحدد كنسبة من قيمة العقد المعدّلة (شاملة أوامر التغيير).
 */
export function computeClaimDeductions(input: {
  gross: number;
  contractValue: number;
  retentionHeld: number;
  settings: { retentionPct: number; retentionCapPct: number; withholdingTaxPct: number; stampDutyPct: number };
}) {
  const { gross, contractValue, retentionHeld, settings } = input;
  let retention = gross * (settings.retentionPct / 100);
  if (settings.retentionCapPct > 0 && contractValue > 0) {
    const cap = contractValue * (settings.retentionCapPct / 100);
    retention = Math.max(0, Math.min(retention, cap - retentionHeld));
  }
  return {
    retention: round3(retention),
    withholdingTax: round3(gross * (settings.withholdingTaxPct / 100)),
    stampDuty: round3(gross * (settings.stampDutyPct / 100)),
  };
}

/**
 * صافي المطالبة = قيمة الأعمال − المحجوزات − رسوم الطوابع − الخصومات الأخرى.
 * ضريبة الدخل واسترداد المقدمة لا تُخصم في المطالبات (الضريبة لها وحدة مستقلة).
 */
export function claimNet(c: { grossAmount: number; retention: number; stampDuty: number; deductions: number }) {
  return round3(c.grossAmount - c.retention - c.stampDuty - c.deductions);
}

/** المطالبات المعتمدة من المدير العام فما بعد (المسودات وقيد التدقيق والمرفوضة لا تُحتسب محجوزاتها) */
export const COUNTED_CLAIM = (s: string) => s === "SUBMITTED" || s === "APPROVED" || s === "PAID";
/** المطالبة مقفلة بعد اعتماد المدير العام */
export const LOCKED_CLAIM = COUNTED_CLAIM;

export function heldRetention(claims: { retention: number; status: string }[]) {
  return round3(claims.filter((c) => COUNTED_CLAIM(c.status)).reduce((s, c) => s + c.retention, 0));
}

/** استرداد الدفعة المقدمة من صاحب العمل: بنسبة المقدمة إلى قيمة العقد، حتى استردادها كاملة */
export function computeAdvanceRecovery(gross: number, advance: number, contractValue: number, recoveredSoFar: number) {
  if (advance <= 0 || contractValue <= 0) return 0;
  return round3(Math.max(0, Math.min(gross * (advance / contractValue), advance - recoveredSoFar)));
}

/** مستخلص مقاول باطن: استرداد الدفعة المقدمة بنسبة قيمة الأعمال + محجوزات */
export function computeSubCertificate(input: {
  workValue: number;
  contractValue: number;
  advance: number;
  advanceRecovered: number;
  retentionPct: number;
  otherDeductions: number;
}) {
  const remainingAdvance = Math.max(0, input.advance - input.advanceRecovered);
  const proportional = input.contractValue > 0 ? input.workValue * (input.advance / input.contractValue) : 0;
  const advanceRecovery = round3(Math.min(remainingAdvance, proportional));
  const retention = round3(input.workValue * (input.retentionPct / 100));
  const net = round3(input.workValue - advanceRecovery - retention - input.otherDeductions);
  return { advanceRecovery, retention, net };
}

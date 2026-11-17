/**
 * دورة حياة المشروع التعاقدية (أصول المقاولات في الأردن) — المرجع الوحيد للمراحل وخانات المستندات.
 *
 *  0. مرحلة العطاء (قبل الإحالة): شراء الوثائق ← زيارة الموقع ← التسعير ← كفالة الدخول والتقديم ← النتيجة
 *  1. الإحالة والتعاقد: ورقة الإحالة + رسوم الطوابع، أمر المباشرة + كفالة حسن التنفيذ
 *  2. التنفيذ والحصر المرحلي: الإنجاز، الحصر الفعلي، المطالبات المرحلية (مراجعة واعتماد مع الخصومات)
 *  3. الاستلام الابتدائي: كشف اللجنة ← معالجة النواقص ← محضر الاستلام الابتدائي الموقّع
 *  4. المطالبة النهائية وتسليم الكفالات: المطالبة النهائية + كفالة الصيانة مقابل الإفراج عن حسن التنفيذ
 *  5. الاستلام النهائي والإغلاق: بعد انقضاء مدة الصيانة ← كشف اللجنة ← الإفراج عن كفالة الصيانة ← إغلاق
 */

export type PhaseNo = 1 | 2 | 3 | 4 | 5;

export const PHASES: Record<PhaseNo, { title: string; short: string }> = {
  1: { title: "المرحلة الأولى: الإحالة والتعاقد", short: "الإحالة والتعاقد" },
  2: { title: "المرحلة الثانية: التنفيذ والحصر المرحلي", short: "التنفيذ والحصر المرحلي" },
  3: { title: "المرحلة الثالثة: الاستلام الابتدائي", short: "الاستلام الابتدائي" },
  4: { title: "المرحلة الرابعة: المطالبة النهائية وتسليم الكفالات", short: "المطالبة النهائية والكفالات" },
  5: { title: "المرحلة الخامسة: الاستلام النهائي وإغلاق المشروع", short: "الاستلام النهائي والإغلاق" },
};

/** خانات المستندات المستقلة لكل مرحلة — كل خانة تقبل ملفاتها الخاصة */
export const STAGE_SLOTS = {
  award_letter: { label: "ورقة الإحالة", phase: 1 },
  stamp_receipt: { label: "إيصال رسوم الطوابع", phase: 1 },
  commence_order: { label: "أمر المباشرة", phase: 1 },
  performance_guarantee: { label: "كفالة حسن التنفيذ", phase: 1 },
  prelim_inspection: { label: "محضر كشف لجنة الاستلام وقائمة النواقص", phase: 3 },
  prelim_handover: { label: "محضر الاستلام الابتدائي الموقّع من اللجنة", phase: 3 },
  maintenance_guarantee: { label: "كفالة الصيانة (المسلّمة لصاحب العمل)", phase: 4 },
  performance_release: { label: "كتاب الإفراج عن كفالة حسن التنفيذ", phase: 4 },
  final_inspection: { label: "محضر كشف لجنة الاستلام النهائي", phase: 5 },
  final_handover: { label: "محضر الاستلام النهائي", phase: 5 },
  maintenance_release: { label: "قرار الإفراج عن كفالة الصيانة", phase: 5 },
} as const satisfies Record<string, { label: string; phase: PhaseNo }>;

export type StageSlot = keyof typeof STAGE_SLOTS;
export const isStageSlot = (s: string): s is StageSlot => s in STAGE_SLOTS;

type PhaseInput = {
  status: string;
  /** المرحلة المحددة يدوياً من الإدارة (للمشاريع القديمة) */
  phase: number | null;
  awardLetterDate: Date | null;
  commenceOrderDate: Date | null;
  prelimInspectionDate: Date | null;
  preliminaryHandoverDate: Date | null;
  maintenanceMonths: number | null;
  finalHandoverDate: Date | null;
  maintenanceReleaseDate: Date | null;
  guarantees: { type: string; status: string; expiryDate: Date | null }[];
  claims: { type: string; status: string }[];
};

const ISSUED_CLAIM = ["SUBMITTED", "APPROVED", "PAID"];
const HELD = ["ISSUED", "SUBMITTED"];

/** نهاية مدة الصيانة: تاريخ انتهاء كفالة الصيانة، أو الاستلام الابتدائي + مدة الصيانة (افتراضياً 12 شهراً) */
export function maintenanceEnd(t: Pick<PhaseInput, "preliminaryHandoverDate" | "maintenanceMonths" | "guarantees">): Date | null {
  const g = t.guarantees.find((x) => x.type === "MAINTENANCE" && x.expiryDate);
  if (g?.expiryDate) return g.expiryDate;
  if (!t.preliminaryHandoverDate) return null;
  const d = new Date(t.preliminaryHandoverDate);
  d.setUTCMonth(d.getUTCMonth() + (t.maintenanceMonths ?? 12));
  return d;
}

/** حالة اكتمال كل مرحلة: من البيانات المسجلة، أو لأن الإدارة نقلت المشروع لمرحلة لاحقة */
export function phaseStatus(t: PhaseInput): Record<PhaseNo, boolean> {
  const d = derivedStatus(t);
  const manual = t.phase ?? 0;
  const closed = t.status === "CLOSED";
  return { 1: closed || d[1] || manual > 1, 2: closed || d[2] || manual > 2, 3: closed || d[3] || manual > 3, 4: closed || d[4] || manual > 4, 5: closed };
}

function derivedStatus(t: PhaseInput): Record<PhaseNo, boolean> {
  const perf = t.guarantees.filter((g) => g.type === "PERFORMANCE");
  const maint = t.guarantees.filter((g) => g.type === "MAINTENANCE");
  const finalClaim = t.claims.some((c) => c.type === "FINAL" && ISSUED_CLAIM.includes(c.status));
  return {
    1: !!t.awardLetterDate && !!t.commenceOrderDate && perf.length > 0,
    2: !!t.prelimInspectionDate || !!t.preliminaryHandoverDate,
    3: !!t.preliminaryHandoverDate,
    4: finalClaim && maint.length > 0 && !perf.some((g) => HELD.includes(g.status)),
    5: t.status === "CLOSED",
  };
}

/** المرحلة الحالية للمشروع (0 = ما زال عطاءً قبل الإحالة، null = غير محال/ملغى) */
export function currentPhase(t: PhaseInput): PhaseNo | 0 | null {
  if (t.status === "LOST" || t.status === "CANCELLED") return null;
  if (!["WON", "EXECUTION", "MAINTENANCE", "CLOSED"].includes(t.status)) return 0;
  if (t.status === "CLOSED") return 5;
  const done = derivedStatus(t);
  let derived: PhaseNo = 5;
  for (const p of [1, 2, 3, 4, 5] as PhaseNo[]) if (!done[p]) { derived = p; break; }
  const manual = t.phase && t.phase >= 1 && t.phase <= 5 ? (t.phase as PhaseNo) : 1;
  return (Math.max(derived, manual) as PhaseNo);
}

/** وصف مختصر لحالة المشروع للقوائم والتقارير */
export function phaseLabel(t: PhaseInput): string | null {
  const p = currentPhase(t);
  if (p === null) return null;
  if (p === 0) return "مرحلة العطاء";
  if (t.status === "CLOSED") return "مغلق — استلام نهائي";
  if (p === 5) {
    const end = maintenanceEnd(t);
    return end && end > new Date() ? `فترة الصيانة حتى ${end.toISOString().slice(0, 10)}` : "بانتظار الاستلام النهائي";
  }
  return PHASES[p].short;
}

/** أيام متبقية حتى نهاية الصيانة (سالبة = انقضت) */
export function daysToMaintenanceEnd(t: Parameters<typeof maintenanceEnd>[0], today: Date): number | null {
  const end = maintenanceEnd(t);
  if (!end) return null;
  return Math.round((end.getTime() - today.getTime()) / 86_400_000);
}


/**
 * «المرحلة الحالية» كما تختارها الإدارة يدوياً (إنشاء عطاء قديم أو تصحيح مرحلة مشروع):
 * مراحل العطاء قبل الإحالة + المراحل الخمس + الإغلاق + غير محال/ملغى.
 */
export const STAGE_OPTIONS = [
  { value: "PURCHASED", label: "عطاء — تم شراء الوثائق", group: "pre" },
  { value: "PRICING", label: "عطاء — قيد التسعير", group: "pre" },
  { value: "SUBMITTED", label: "عطاء — تم تقديم العرض", group: "pre" },
  { value: "NEGOTIATION", label: "عطاء — قيد التفاوض", group: "pre" },
  { value: "P1", label: "المرحلة 1 — الإحالة والتعاقد", group: "project" },
  { value: "P2", label: "المرحلة 2 — التنفيذ والحصر المرحلي", group: "project" },
  { value: "P3", label: "المرحلة 3 — الاستلام الابتدائي (الأعمال منجزة)", group: "project" },
  { value: "P4", label: "المرحلة 4 — المطالبة النهائية وتسليم الكفالات", group: "project" },
  { value: "P5", label: "المرحلة 5 — فترة الصيانة / الاستلام النهائي", group: "project" },
  { value: "CLOSED", label: "مغلق — استلام نهائي وإفراج عن كفالة الصيانة", group: "project" },
  { value: "LOST", label: "غير محال", group: "other" },
  { value: "CANCELLED", label: "ملغى", group: "other" },
] as const;
export type StageValue = (typeof STAGE_OPTIONS)[number]["value"];
export const STAGE_VALUES = STAGE_OPTIONS.map((o) => o.value) as [StageValue, ...StageValue[]];
export const isAwardedStage = (s: StageValue) => /^P[1-5]$/.test(s) || s === "CLOSED";

/** تحويل المرحلة المختارة إلى حالة المشروع والمرحلة المخزنة */
export function stageToFields(s: StageValue): { status: string; phase: number | null } {
  switch (s) {
    case "P1": return { status: "WON", phase: 1 };
    case "P2": return { status: "EXECUTION", phase: 2 };
    case "P3": return { status: "EXECUTION", phase: 3 };
    case "P4": return { status: "MAINTENANCE", phase: 4 };
    case "P5": return { status: "MAINTENANCE", phase: 5 };
    case "CLOSED": return { status: "CLOSED", phase: 5 };
    default: return { status: s, phase: null };
  }
}

/** المرحلة الحالية بصيغة خيار القائمة (القيمة الافتراضية لنموذج تغيير المرحلة) */
export function stageOf(t: PhaseInput): StageValue {
  if (t.status === "CLOSED") return "CLOSED";
  const p = currentPhase(t);
  if (p === null || p === 0) return (STAGE_VALUES.includes(t.status as StageValue) ? t.status : "PURCHASED") as StageValue;
  return `P${p}` as StageValue;
}

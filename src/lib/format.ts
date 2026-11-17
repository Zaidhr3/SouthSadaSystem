// تنسيق العملة والتواريخ. التواريخ تُخزن كمنتصف ليل UTC لليوم المقصود.

const numFmt = new Intl.NumberFormat("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 3 });
const compactFmt = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

export function round3(n: number) {
  return Math.round(n * 1000) / 1000;
}

export function fmtNum(n: number | null | undefined) {
  return numFmt.format(n ?? 0);
}

export function fmtJOD(n: number | null | undefined) {
  return `${numFmt.format(n ?? 0)} د.أ`;
}

export function fmtCompactJOD(n: number | null | undefined) {
  return `${compactFmt.format(n ?? 0)} د.أ`;
}

export function fmtDate(d: Date | string | null | undefined) {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${day}/${m}/${y}`;
}

export function toInputDate(d: Date | null | undefined) {
  return d ? d.toISOString().slice(0, 10) : "";
}

/** تاريخ اليوم بتوقيت عمّان كمنتصف ليل UTC */
export function todayUTC(): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Amman",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return new Date(`${parts}T00:00:00.000Z`);
}

export function addDays(d: Date, days: number) {
  return new Date(d.getTime() + days * 86400000);
}

/** إضافة أشهر مع تثبيت اليوم (31 يناير + شهر = 28/29 فبراير) */
export function addMonths(d: Date, months: number) {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + months;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d.getUTCDate(), last)));
}

export function addYears(d: Date, years: number) {
  const r = new Date(d);
  r.setUTCFullYear(r.getUTCFullYear() + years);
  return r;
}

/** عدد الأيام من اليوم حتى التاريخ (سالب = متأخر) */
export function daysUntil(d: Date) {
  return Math.round((d.getTime() - todayUTC().getTime()) / 86400000);
}

export function daysBetween(a: Date, b: Date) {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

export function relativeDays(d: Date) {
  const n = daysUntil(d);
  if (n === 0) return "اليوم";
  if (n === 1) return "غداً";
  if (n === -1) return "أمس";
  if (n > 0) return n <= 10 ? `بعد ${n} أيام` : `بعد ${n} يوماً`;
  const a = -n;
  return a <= 10 ? `منذ ${a} أيام` : `منذ ${a} يوماً`;
}

/** قيمة الأعمال المنجزة = قيمة العقد × نسبة الإنجاز (أساس هامش الربح للمشاريع الجارية) */
export function earnedValue(contractValue: number, progress: number) {
  return round3(contractValue * (Math.max(0, Math.min(100, progress)) / 100));
}

export function pct(n: number, digits = 1) {
  return `${n >= 0 ? "+" : ""}${n.toFixed(digits)}%`;
}

const monthNames = ["كانون الثاني", "شباط", "آذار", "نيسان", "أيار", "حزيران", "تموز", "آب", "أيلول", "تشرين الأول", "تشرين الثاني", "كانون الأول"];
export function monthLabel(year: number, monthIdx: number) {
  return `${monthNames[monthIdx]} ${String(year).slice(2)}`;
}

import "server-only";
import { db } from "./db";
import { round3 } from "./format";

/**
 * قسم الرواتب والأجور:
 *  - عمال المياومة: الأجر = أيام الحضور × الأجر اليومي + الساعات الإضافية (125% من أجر الساعة = اليومي ÷ 8) — قانون العمل الأردني م.59
 *  - الشهريون: الراتب + البدلات، مع التناسب لمن بدأ أو انتهى خلال الشهر
 *  - الضمان الاجتماعي للمشمولين: 7.5% من الموظف و14.25% على الشركة من (الأساسي + البدلات)
 *  - السلف والخصومات والمكافآت تُحتسب في مسير شهرها
 */
export const SS_EMPLOYEE = 0.075;
export const SS_EMPLOYER = 0.1425;
export const OT_FACTOR = 1.25;

export const PAY_TYPE: Record<string, string> = { DAILY: "مياومة (يومي)", MONTHLY: "شهري" };
export const EMP_CATEGORY: Record<string, string> = {
  WORKER: "عامل",
  SKILLED: "عامل فني / حرفي",
  FOREMAN: "مراقب / فورمن",
  OPERATOR: "مشغّل آليات",
  DRIVER: "سائق",
  ENGINEER: "مهندس",
  PM: "مدير مشروع",
  ACCOUNTANT: "محاسب",
  ADMIN: "إداري / إدارة",
  GUARD: "حارس",
  OTHER: "أخرى",
};
export const PAY_METHOD_PR: Record<string, string> = { CASH: "نقداً", BANK: "تحويل بنكي", CLIQ: "كليك CliQ" };
export const ADJ_TYPE: Record<string, { label: string; sign: 1 | -1 }> = {
  ADVANCE: { label: "سلفة", sign: -1 },
  DEDUCTION: { label: "خصم", sign: -1 },
  BONUS: { label: "مكافأة / حافز", sign: 1 },
};
export const RUN_STATUS: Record<string, { label: string; tone: "gray" | "blue" | "green" | "orange" | "red" | "purple" }> = {
  DRAFT: { label: "مسودة — قيد الإعداد", tone: "gray" },
  SUBMITTED: { label: "أمام مجلس الإدارة", tone: "blue" },
  APPROVED: { label: "معتمد — جاهز للصرف", tone: "orange" },
  PAID: { label: "مصروف", tone: "green" },
};

export const periodOf = (d = new Date()) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
export function periodRange(period: string) {
  const [y, m] = period.split("-").map(Number);
  const from = new Date(Date.UTC(y, m - 1, 1));
  const to = new Date(Date.UTC(y, m, 1));
  return { from, to, daysInMonth: Math.round((to.getTime() - from.getTime()) / 86400000) };
}
export const periodLabel = (period: string) => {
  const { from } = periodRange(period);
  return new Intl.DateTimeFormat("ar-JO-u-nu-latn", { month: "long", year: "numeric", timeZone: "UTC" }).format(from);
};

export type LineCalc = {
  employeeId: number; payType: string; days: number; rate: number; base: number; allowances: number; overtime: number; bonus: number;
  advances: number; deductions: number; ssEmployee: number; ssEmployer: number; net: number; payMethod: string; tenderId: number | null;
};

/** احتساب أسطر مسير شهر كامل من بيانات الموظفين والحضور والتسويات */
export async function computePayroll(period: string): Promise<LineCalc[]> {
  const { from, to, daysInMonth } = periodRange(period);
  const [emps, days, adjs] = await Promise.all([
    db.employee.findMany({
      where: { OR: [{ active: true }, { endDate: { gte: from } }], AND: [{ OR: [{ startDate: null }, { startDate: { lt: to } }] }] },
      orderBy: [{ payType: "asc" }, { name: "asc" }],
    }),
    db.workDay.findMany({ where: { date: { gte: from, lt: to } } }),
    db.payAdjustment.findMany({ where: { period } }),
  ]);
  const lines: LineCalc[] = [];
  for (const e of emps) {
    const mine = days.filter((d) => d.employeeId === e.id);
    const adj = adjs.filter((a) => a.employeeId === e.id);
    const sum = (t: string) => adj.filter((a) => a.type === t).reduce((s, a) => s + a.amount, 0);
    let workDays = 0, rate = 0, base = 0, overtime = 0, allowances = 0;
    let tenderId: number | null = e.tenderId;
    if (e.payType === "DAILY") {
      rate = e.dailyRate ?? 0;
      workDays = mine.reduce((s, d) => s + d.days, 0);
      base = workDays * rate;
      overtime = mine.reduce((s, d) => s + d.overtimeHours, 0) * (rate / 8) * OT_FACTOR;
      // المشروع الذي عمل فيه أكثر أيام الشهر يتحمل كلفته
      const by = new Map<number, number>();
      mine.forEach((d) => d.tenderId && by.set(d.tenderId, (by.get(d.tenderId) ?? 0) + d.days));
      if (by.size) tenderId = Array.from(by.entries()).sort((a, b) => b[1] - a[1])[0][0];
      if (workDays === 0 && !adj.length) continue;
    } else {
      // التناسب: أيام الخدمة داخل الشهر
      const s = e.startDate && e.startDate > from ? e.startDate : from;
      const en = e.endDate && e.endDate < to ? new Date(e.endDate.getTime() + 86400000) : to;
      workDays = Math.max(0, Math.round((en.getTime() - s.getTime()) / 86400000));
      if (workDays === 0) continue;
      const ratio = Math.min(1, workDays / daysInMonth);
      rate = e.monthlySalary ?? 0;
      base = rate * ratio;
      allowances = e.allowances * ratio;
    }
    const insurable = base + allowances;
    const ssEmployee = e.socialSecurity ? insurable * SS_EMPLOYEE : 0;
    const ssEmployer = e.socialSecurity ? insurable * SS_EMPLOYER : 0;
    const bonus = sum("BONUS");
    const advances = sum("ADVANCE");
    const deductions = sum("DEDUCTION");
    const net = base + allowances + overtime + bonus - advances - deductions - ssEmployee;
    lines.push({
      employeeId: e.id, payType: e.payType, days: workDays, rate: round3(rate), base: round3(base), allowances: round3(allowances), overtime: round3(overtime), bonus: round3(bonus),
      advances: round3(advances), deductions: round3(deductions), ssEmployee: round3(ssEmployee), ssEmployer: round3(ssEmployer), net: round3(net), payMethod: e.payMethod, tenderId,
    });
  }
  return lines;
}

export function totals(lines: { base: number; allowances: number; overtime: number; bonus: number; net: number; ssEmployer: number; payMethod: string }[]) {
  const gross = lines.reduce((s, l) => s + l.base + l.allowances + l.overtime + l.bonus, 0);
  const net = lines.reduce((s, l) => s + l.net, 0);
  const employerSS = lines.reduce((s, l) => s + l.ssEmployer, 0);
  const byMethod = (m: string) => lines.filter((l) => l.payMethod === m).reduce((s, l) => s + l.net, 0);
  return { gross: round3(gross), net: round3(net), employerSS: round3(employerSS), cash: round3(byMethod("CASH")), bank: round3(byMethod("BANK") + byMethod("CLIQ")), cost: round3(gross + employerSS) };
}

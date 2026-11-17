import "server-only";
import { db, type Tx } from "./db";
import { round3, todayUTC } from "./format";

export { buildSchedule, computeInterest, termMonths } from "./loan-math";

/**
 * يعيد توزيع مجموع الدفعات على الأقساط (الأقدم أولاً) ويحدّث حالة الدين:
 * المسدد بالكامل يُغلق تلقائياً، وأي حذف لدفعة يعيده «قائماً».
 */
export async function syncLoan(tx: Tx, loanId: number) {
  const loan = await tx.loan.findUniqueOrThrow({
    where: { id: loanId },
    include: { installments: { orderBy: { seq: "asc" } }, payments: { orderBy: [{ date: "asc" }, { id: "asc" }] } },
  });
  let pool = round3(loan.payments.reduce((s, p) => s + p.amount, 0));
  const totalPaid = pool;
  // تاريخ اكتمال كل قسط = تاريخ الدفعة التي أوصلت المجموع التراكمي إلى نهايته
  const cum: { date: Date; total: number }[] = [];
  let run = 0;
  for (const p of loan.payments) cum.push({ date: p.date, total: (run = round3(run + p.amount)) });
  let threshold = 0;
  for (const i of loan.installments) {
    const paid = round3(Math.min(i.amount, Math.max(0, pool)));
    pool = round3(pool - paid);
    threshold = round3(threshold + i.amount);
    const done = paid >= i.amount - 0.0005;
    const paidDate = done ? (cum.find((c) => c.total >= threshold - 0.0005)?.date ?? null) : null;
    if (paid !== i.paidAmount || (paidDate?.getTime() ?? null) !== (i.paidDate?.getTime() ?? null)) {
      await tx.loanInstallment.update({ where: { id: i.id }, data: { paidAmount: paid, paidDate } });
    }
  }
  const settled = totalPaid >= loan.totalDue - 0.0005;
  const status = settled ? "SETTLED" : "ACTIVE";
  if (status !== loan.status) {
    await tx.loan.update({ where: { id: loanId }, data: { status, settledAt: settled ? (loan.payments.at(-1)?.date ?? new Date()) : null } });
  }
  return { totalPaid, remaining: round3(Math.max(0, loan.totalDue - totalPaid)), settled };
}

export type LoanSummary = {
  count: number;
  principal: number;
  totalDue: number;
  paid: number;
  remaining: number;
  overdue: number;
  overdueCount: number;
  dueSoon: number;
  dueSoonCount: number;
};

/** ملخص الديون القائمة (للوحات التحكم والتقارير) */
export async function loanSummary(client: Tx | typeof db = db): Promise<LoanSummary> {
  const today = todayUTC();
  const soon = new Date(today.getTime() + 30 * 86400000);
  const loans = await client.loan.findMany({ where: { status: "ACTIVE" }, select: { principal: true, totalDue: true, installments: { select: { dueDate: true, amount: true, paidAmount: true } } } });
  const s: LoanSummary = { count: loans.length, principal: 0, totalDue: 0, paid: 0, remaining: 0, overdue: 0, overdueCount: 0, dueSoon: 0, dueSoonCount: 0 };
  for (const l of loans) {
    s.principal += l.principal;
    s.totalDue += l.totalDue;
    for (const i of l.installments) {
      s.paid += i.paidAmount;
      const left = round3(i.amount - i.paidAmount);
      if (left <= 0) continue;
      if (i.dueDate < today) {
        s.overdue += left;
        s.overdueCount++;
      } else if (i.dueDate <= soon) {
        s.dueSoon += left;
        s.dueSoonCount++;
      }
    }
  }
  s.remaining = round3(s.totalDue - s.paid);
  for (const k of ["principal", "totalDue", "paid", "overdue", "dueSoon"] as const) s[k] = round3(s[k]);
  return s;
}

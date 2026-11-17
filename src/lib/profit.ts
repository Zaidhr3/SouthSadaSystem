import "server-only";
import { db } from "./db";
import { round3 } from "./format";

export type ProjectProfit = {
  tenderId: number;
  received: number;
  retentionReleased: number;
  expenses: number;
  subcontract: number;
  materials: number;
  other: number;
  profit: number;
  margin: number;
};

/**
 * تقرير الربحية الفعلي للمشروع:
 *   الربح = المطالبات المقبوضة (+ المحجوزات المستردة) − إجمالي المصاريف (شاملة مقاولي الباطن والمشتريات والمواد)
 * المصاريف كلها من سجل المصاريف المرتبط بالمشروع (دفعات الباطن تُرحَّل إليه تلقائياً).
 */
export async function projectProfit(tenderIds: number[]): Promise<Map<number, ProjectProfit>> {
  const out = new Map<number, ProjectProfit>();
  if (tenderIds.length === 0) return out;
  const [claims, expenses, tenders] = await Promise.all([
    db.claim.groupBy({ by: ["tenderId"], where: { tenderId: { in: tenderIds }, status: "PAID" }, _sum: { paidAmount: true } }),
    db.expense.groupBy({ by: ["tenderId", "category"], where: { tenderId: { in: tenderIds } }, _sum: { amount: true } }),
    db.tender.findMany({ where: { id: { in: tenderIds } }, select: { id: true, retentionReleasedAmount: true } }),
  ]);
  for (const t of tenders) {
    const received = round3(claims.find((c) => c.tenderId === t.id)?._sum.paidAmount ?? 0);
    const rows = expenses.filter((e) => e.tenderId === t.id);
    const sum = (cats?: string[]) => round3(rows.filter((r) => !cats || cats.includes(r.category)).reduce((s, r) => s + (r._sum.amount ?? 0), 0));
    const total = sum();
    const subcontract = sum(["SUBCONTRACT"]);
    const materials = sum(["MATERIALS"]);
    const retentionReleased = round3(t.retentionReleasedAmount ?? 0);
    const income = round3(received + retentionReleased);
    const profit = round3(income - total);
    out.set(t.id, { tenderId: t.id, received, retentionReleased, expenses: total, subcontract, materials, other: round3(total - subcontract - materials), profit, margin: income > 0 ? Math.round((profit / income) * 1000) / 10 : 0 });
  }
  return out;
}

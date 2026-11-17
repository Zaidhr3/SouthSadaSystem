import "server-only";

import { db, type Tx } from "./db";
import { round3 } from "./format";



export async function bankBalance(client: Tx | typeof db = db) {
  const rows = await client.bankTransaction.groupBy({ by: ["type"], _sum: { amount: true } });
  const inn = rows.find((r) => r.type === "IN")?._sum.amount ?? 0;
  const out = rows.find((r) => r.type === "OUT")?._sum.amount ?? 0;
  return { totalIn: round3(inn), totalOut: round3(out), balance: round3(inn - out) };
}

/** حركة بنكية مرتبطة بمصدر (مطالبة/شيك/مصروف/تمويل) لضمان عدم التكرار */
export async function upsertLinkedBankTx(
  tx: Tx,
  sourceType: "CLAIM" | "CHEQUE" | "EXPENSE" | "FUND" | "TAX" | "LOAN" | "LOAN_PAY",
  sourceId: number,
  data: { date: Date; type: "IN" | "OUT"; amount: number; description: string; tenderId?: number | null },
) {
  await tx.bankTransaction.deleteMany({ where: { sourceType, sourceId } });
  if (data.amount <= 0) return;
  await tx.bankTransaction.create({
    data: { ...data, amount: round3(data.amount), category: sourceType, sourceType, sourceId },
  });
}

export async function removeLinkedBankTx(tx: Tx, sourceType: string, sourceId: number) {
  await tx.bankTransaction.deleteMany({ where: { sourceType, sourceId } });
}

/** مصروف تلقائي من حساب الشركة (رسوم وثائق، عمولات كفالات، طوابع) */
export async function createCompanyExpense(
  tx: Tx,
  data: { tenderId: number; category: string; amount: number; date: Date; description: string; autoSource: string; userId: number },
) {
  if (data.amount <= 0) return;
  const existing = await tx.expense.findFirst({ where: { autoSource: data.autoSource } });
  if (existing) return;
  const exp = await tx.expense.create({
    data: {
      tenderId: data.tenderId,
      category: data.category,
      amount: round3(data.amount),
      date: data.date,
      description: data.description,
      paymentMethod: "COMPANY",
      autoSource: data.autoSource,
      createdById: data.userId,
    },
  });
  await upsertLinkedBankTx(tx, "EXPENSE", exp.id, {
    date: data.date,
    type: "OUT",
    amount: exp.amount,
    description: data.description,
    tenderId: data.tenderId,
  });
}

/** أرصدة العهد: التمويل المعتمد ناقص المصاريف المدفوعة من العهدة */
export async function custodyBalances(userIds?: number[]) {
  const whereUser = userIds ? { in: userIds } : undefined;
  const [funded, spent] = await Promise.all([
    db.fundRequest.groupBy({
      by: ["recipientId"],
      where: { status: "APPROVED", ...(whereUser ? { recipientId: whereUser } : {}) },
      _sum: { amount: true },
    }),
    db.expense.groupBy({
      by: ["createdById"],
      where: { paymentMethod: "CUSTODY", ...(whereUser ? { createdById: whereUser } : {}) },
      _sum: { amount: true },
    }),
  ]);
  const map = new Map<number, { funded: number; spent: number; balance: number }>();
  for (const f of funded) {
    map.set(f.recipientId, { funded: f._sum.amount ?? 0, spent: 0, balance: 0 });
  }
  for (const s of spent) {
    const cur = map.get(s.createdById) ?? { funded: 0, spent: 0, balance: 0 };
    cur.spent = s._sum.amount ?? 0;
    map.set(s.createdById, cur);
  }
  map.forEach((v) => (v.balance = round3(v.funded - v.spent)));
  return map;
}

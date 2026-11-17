/** اختبار محرك الديون على قاعدة البيانات داخل معاملة تُلغى بالكامل في النهاية (لا يبقى أي أثر) */
import "./load-env";
import "./no-server-only";
import assert from "node:assert/strict";
import { db } from "../src/lib/db";
import { buildSchedule, computeInterest, syncLoan, loanSummary } from "../src/lib/loans";
import { upsertLinkedBankTx } from "../src/lib/finance";
import { addMonths } from "../src/lib/format";

const D = (s: string) => new Date(`${s}T00:00:00.000Z`);
// 1) دوال بحتة
assert.equal(addMonths(D("2026-01-31"), 1).toISOString().slice(0, 10), "2026-02-28");
assert.equal(addMonths(D("2026-11-30"), 3).toISOString().slice(0, 10), "2027-02-28");
const s = buildSchedule(1000, 3, "MONTHLY", D("2026-12-01"));
assert.deepEqual(s.map((x) => x.amount), [333.333, 333.333, 333.334]);
assert.equal(s.reduce((a, x) => a + x.amount, 0).toFixed(3), "1000.000");
assert.equal(s[2].dueDate.toISOString().slice(0, 10), "2027-02-01");
assert.equal(buildSchedule(500, 12, "ONCE", D("2027-01-01")).length, 1);
assert.equal(buildSchedule(1200, 4, "QUARTERLY", D("2027-01-15"))[3].dueDate.toISOString().slice(0, 10), "2027-10-15");
// 10,000 بنسبة 8% سنوياً على 12 قسط شهري = 800
assert.equal(computeInterest({ principal: 10000, interestType: "PERCENT", interestRate: 8, interestAmount: null, frequency: "MONTHLY", installmentCount: 12, receivedDate: D("2026-11-16"), firstDueDate: D("2026-12-16") }), 800);
assert.equal(computeInterest({ principal: 10000, interestType: "FIXED", interestRate: null, interestAmount: 250, frequency: "MONTHLY", installmentCount: 12, receivedDate: D("2026-11-16"), firstDueDate: D("2026-12-16") }), 250);
assert.equal(computeInterest({ principal: 10000, interestType: "NONE", interestRate: 5, interestAmount: 9, frequency: "MONTHLY", installmentCount: 12, receivedDate: D("2026-11-16"), firstDueDate: D("2026-12-16") }), 0);
console.log("✓ الحسابات البحتة");

class Rollback extends Error {}
async function main() {
  const before = await loanSummary();
  try {
    await db.$transaction(async (tx) => {
      const l = await tx.loan.create({ data: { lender: "اختبار", purpose: "اختبار", principal: 900, totalDue: 1000, interestAmount: 100, receivedDate: D("2026-10-01"), firstDueDate: D("2026-11-01"), installmentCount: 4, createdById: 1 } });
      await tx.loanInstallment.createMany({ data: buildSchedule(1000, 4, "MONTHLY", D("2026-11-01")).map((i) => ({ ...i, loanId: l.id })) });
      await upsertLinkedBankTx(tx, "LOAN", l.id, { date: D("2026-10-01"), type: "IN", amount: 900, description: "t" });
      assert.equal(await tx.bankTransaction.count({ where: { sourceType: "LOAN", sourceId: l.id, type: "IN", amount: 900 } }), 1);
      // دفعة جزئية 300: القسط الأول (250) مكتمل، والثاني 50
      await tx.loanPayment.create({ data: { loanId: l.id, date: D("2026-11-02"), amount: 300, createdById: 1 } });
      let r = await syncLoan(tx, l.id);
      let ins = await tx.loanInstallment.findMany({ where: { loanId: l.id }, orderBy: { seq: "asc" } });
      assert.deepEqual(ins.map((i) => i.paidAmount), [250, 50, 0, 0]);
      assert.equal(ins[0].paidDate?.toISOString().slice(0, 10), "2026-11-02");
      assert.equal(ins[1].paidDate, null);
      assert.equal(r.remaining, 700);
      assert.equal(r.settled, false);
      // سداد الباقي على دفعتين → يُغلق تلقائياً
      await tx.loanPayment.create({ data: { loanId: l.id, date: D("2026-12-05"), amount: 450, createdById: 1 } });
      await tx.loanPayment.create({ data: { loanId: l.id, date: D("2027-01-05"), amount: 250, createdById: 1 } });
      r = await syncLoan(tx, l.id);
      ins = await tx.loanInstallment.findMany({ where: { loanId: l.id }, orderBy: { seq: "asc" } });
      assert.deepEqual(ins.map((i) => i.paidAmount), [250, 250, 250, 250]);
      assert.deepEqual(ins.map((i) => i.paidDate?.toISOString().slice(0, 10)), ["2026-11-02", "2026-12-05", "2026-12-05", "2027-01-05"]);
      assert.equal(r.settled, true);
      assert.equal((await tx.loan.findUniqueOrThrow({ where: { id: l.id } })).status, "SETTLED");
      // حذف آخر دفعة → يعود قائماً
      const last = await tx.loanPayment.findFirstOrThrow({ where: { loanId: l.id }, orderBy: { date: "desc" } });
      await tx.loanPayment.delete({ where: { id: last.id } });
      r = await syncLoan(tx, l.id);
      const ln = await tx.loan.findUniqueOrThrow({ where: { id: l.id } });
      assert.equal(ln.status, "ACTIVE");
      assert.equal(ln.settledAt, null);
      assert.equal(r.remaining, 250);
      console.log("✓ توزيع الدفعات والإغلاق التلقائي وإعادة الفتح");
      const sum = await loanSummary(tx);
      assert.equal(sum.count, before.count + 1);
      console.log("✓ ملخص الديون");
      // حذف الدين يحذف أقساطه ودفعاته (Cascade)
      await tx.loan.delete({ where: { id: l.id } });
      assert.equal(await tx.loanInstallment.count({ where: { loanId: l.id } }), 0);
      assert.equal(await tx.loanPayment.count({ where: { loanId: l.id } }), 0);
      console.log("✓ الحذف المتسلسل");
      throw new Rollback();
    }, { timeout: 60000 });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
  const after = await loanSummary();
  assert.deepEqual(after, before);
  console.log("✓ أُلغيت المعاملة — لم يبقَ أي أثر في قاعدة البيانات");
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });

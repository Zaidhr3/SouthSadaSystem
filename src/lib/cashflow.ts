import "server-only";
import * as React from "react";
import { db } from "./db";
import { addDays, daysBetween, round3, todayUTC } from "./format";
import { claimNet, heldRetention } from "./deductions";
import { bankBalance } from "./finance";

/** تخزين لكل طلب داخل Next — وخارجه (السكربتات) استدعاء مباشر بلا تخزين */
const cache: <T extends (...args: never[]) => unknown>(fn: T) => T = (React as { cache?: <T>(fn: T) => T }).cache ?? ((fn) => fn);

export type FlowItem = { date: string; type: "IN" | "OUT"; amount: number; label: string; source: string; href: string; overdue: boolean };
export type Projection = {
  opening: number;
  days: { date: string; inflow: number; outflow: number; balance: number }[];
  items: FlowItem[];
  totalIn: number;
  totalOut: number;
  closing: number;
  minBalance: number;
  minDate: string;
  avgTurnaround: number;
};

/**
 * توقع التدفق النقدي لـ 30 يوماً (للمدير العام):
 *  الوارد: المطالبات المقدمة/المعتمدة غير المقبوضة (بتاريخ متوقع = التقديم + متوسط مدة القبض التاريخية)،
 *          واسترداد المحجوزات مع انتهاء كفالات الصيانة.
 *  الصادر: الشيكات المؤجلة بتواريخ استحقاقها، أقساط الديون الخارجية، مستخلصات الباطن المعتمدة غير المدفوعة، طلبات التمويل المعلقة.
 *  المستحقات المتأخرة تُحسب في اليوم الأول.
 */
export const projectCashFlow = cache(projectCashFlowImpl);

async function projectCashFlowImpl(horizon = 30): Promise<Projection> {
  const today = todayUTC();
  const end = addDays(today, horizon);
  const [bank, paidHistory, openClaims, cheques, certs, funds, maint, installments] = await Promise.all([
    bankBalance(),
    db.claim.findMany({ where: { status: "PAID", paidDate: { not: null } }, select: { submittedDate: true, paidDate: true }, orderBy: { paidDate: "desc" }, take: 40 }),
    db.claim.findMany({ where: { status: { in: ["READY", "REVIEW", "SUBMITTED", "APPROVED"] } }, include: { tender: { select: { id: true, name: true } } } }),
    db.cheque.findMany({ where: { status: "DEFERRED", dueDate: { lte: end } } }),
    db.subcontractCertificate.findMany({ where: { status: "APPROVED" }, include: { subcontract: { include: { subcontractor: true, tender: { select: { id: true } } } } } }),
    db.fundRequest.findMany({ where: { status: "PENDING" }, include: { requester: { select: { name: true } } } }),
    db.guarantee.findMany({
      where: { type: "MAINTENANCE", expiryDate: { not: null, lte: end }, tender: { retentionReleasedDate: null } },
      include: { tender: { select: { id: true, name: true, claims: { select: { retention: true, status: true } } } } },
    }),
    db.loanInstallment.findMany({ where: { dueDate: { lte: end }, loan: { status: "ACTIVE" } }, include: { loan: { select: { id: true, lender: true } } } }),
  ]);

  const avgTurnaround = paidHistory.length
    ? Math.round(paidHistory.reduce((s, c) => s + daysBetween(c.submittedDate, c.paidDate!), 0) / paidHistory.length)
    : 30;

  const items: FlowItem[] = [];
  const clamp = (d: Date) => (d < today ? today : d);

  for (const c of openClaims) {
    // قيد التدقيق: لم تُقدم للجهة بعد — يُتوقع قبضها بعد متوسط مدة القبض من اليوم
    const review = c.status === "READY" || c.status === "REVIEW";
    const expected = addDays(review ? today : c.submittedDate, avgTurnaround);
    if (expected > end) continue;
    items.push({ date: clamp(expected).toISOString(), type: "IN", amount: claimNet(c), label: `مطالبة رقم ${c.number} — ${c.tender.name}`, source: review ? "مطالبة جاهزة (قبل التسليم)" : "مطالبة", href: `/claims/${c.id}`, overdue: !review && expected < today });
  }
  for (const g of maint) {
    const held = heldRetention(g.tender.claims);
    if (held <= 0) continue;
    items.push({ date: clamp(g.expiryDate!).toISOString(), type: "IN", amount: held, label: `استرداد محجوزات — ${g.tender.name}`, source: "محجوزات", href: `/tenders/${g.tender.id}?tab=claims`, overdue: g.expiryDate! < today });
  }
  for (const c of cheques) {
    items.push({ date: clamp(c.dueDate).toISOString(), type: "OUT", amount: c.amount, label: `شيك ${c.number} — ${c.payee}`, source: "شيك", href: "/cheques", overdue: c.dueDate < today });
  }
  for (const i of installments) {
    const left = round3(i.amount - i.paidAmount);
    if (left <= 0) continue;
    items.push({ date: clamp(i.dueDate).toISOString(), type: "OUT", amount: left, label: `قسط دين رقم ${i.seq} — ${i.loan.lender}`, source: "دين", href: `/debts/${i.loan.id}`, overdue: i.dueDate < today });
  }
  for (const c of certs) {
    items.push({ date: today.toISOString(), type: "OUT", amount: c.net, label: `مستخلص باطن — ${c.subcontract.subcontractor.name}`, source: "مقاول باطن", href: `/subcontractors?tender=${c.subcontract.tender.id}`, overdue: false });
  }
  for (const f of funds) {
    items.push({ date: today.toISOString(), type: "OUT", amount: f.amount, label: `طلب تمويل معلق — ${f.requester.name}`, source: "تمويل", href: "/funds", overdue: false });
  }
  items.sort((a, b) => a.date.localeCompare(b.date));

  let balance = bank.balance;
  let minBalance = balance;
  let minDate = today.toISOString();
  const days: Projection["days"] = [];
  for (let i = 0; i <= horizon; i++) {
    const d = addDays(today, i).toISOString();
    const dayItems = items.filter((x) => x.date.slice(0, 10) === d.slice(0, 10));
    const inflow = round3(dayItems.filter((x) => x.type === "IN").reduce((s, x) => s + x.amount, 0));
    const outflow = round3(dayItems.filter((x) => x.type === "OUT").reduce((s, x) => s + x.amount, 0));
    balance = round3(balance + inflow - outflow);
    if (balance < minBalance) {
      minBalance = balance;
      minDate = d;
    }
    days.push({ date: d, inflow, outflow, balance });
  }
  const totalIn = round3(items.filter((x) => x.type === "IN").reduce((s, x) => s + x.amount, 0));
  const totalOut = round3(items.filter((x) => x.type === "OUT").reduce((s, x) => s + x.amount, 0));
  return { opening: bank.balance, days, items, totalIn, totalOut, closing: balance, minBalance, minDate, avgTurnaround };
}

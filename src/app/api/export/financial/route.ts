import { userSees } from "@/lib/brand";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { addKeyValueSheet, addTable, newWorkbook, workbookResponse } from "@/lib/excel";
import { CHEQUE_STATUS, CLAIM_STATUS, CLAIM_TYPE, EXPENSE_CATEGORY, LOAN_PAY_METHOD, LOAN_STATUS, PAYMENT_METHOD, TENDER_STATUS } from "@/lib/labels";
import { phaseLabel } from "@/lib/project-phase";
import { claimNet, heldRetention } from "@/lib/deductions";
import { fmtDate, monthLabel, round3 } from "@/lib/format";
import { auditEvent } from "@/lib/action";

export const dynamic = "force-dynamic";

function parseDate(s: string | null) {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return new Date(`${s}T00:00:00.000Z`);
}

/** تقرير مالي شامل لفترة محددة */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!can.viewAll(user.role)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const sp = new URL(req.url).searchParams;
  const from = parseDate(sp.get("from"));
  const toDay = parseDate(sp.get("to"));
  if (!from || !toDay || toDay < from) return NextResponse.json({ error: "invalid date range" }, { status: 400 });
  const to = new Date(toDay.getTime() + 86400000); // حصري
  const range = { gte: from, lt: to };
  const isAdmin = await userSees(user, "bank");

  const [expenses, paidClaims, submittedClaims, cheques, certs, variations, projects, periodExp, periodPaid] = await Promise.all([
    db.expense.findMany({ where: { date: range }, include: { tender: { select: { name: true } }, createdBy: { select: { name: true } } }, orderBy: { date: "asc" } }),
    db.claim.findMany({ where: { status: "PAID", paidDate: range }, include: { tender: { select: { name: true } } }, orderBy: { paidDate: "asc" } }),
    db.claim.findMany({ where: { submittedDate: range }, include: { tender: { select: { name: true } } }, orderBy: { submittedDate: "asc" } }),
    db.cheque.findMany({ where: { OR: [{ issueDate: range }, { dueDate: range }, { cashedDate: range }] }, include: { tender: { select: { name: true } } }, orderBy: { dueDate: "asc" } }),
    db.subcontractCertificate.findMany({ where: { status: "PAID", paidDate: range }, include: { subcontract: { include: { subcontractor: true, tender: { select: { name: true } } } } }, orderBy: { paidDate: "asc" } }),
    db.variationOrder.findMany({ where: { decisionDate: range, status: "APPROVED" }, include: { tender: { select: { name: true } } } }),
    db.tender.findMany({ where: { status: { in: ["WON", "EXECUTION", "MAINTENANCE", "CLOSED"] } }, include: { claims: { select: { paidAmount: true, retention: true, status: true, type: true } }, guarantees: { select: { type: true, status: true, expiryDate: true } } } }),
    db.expense.groupBy({ by: ["tenderId"], where: { date: range }, _sum: { amount: true } }),
    db.claim.groupBy({ by: ["tenderId"], where: { status: "PAID", paidDate: range }, _sum: { paidAmount: true } }),
  ]);
  const allExp = await db.expense.groupBy({ by: ["tenderId"], where: { tenderId: { in: projects.map((p) => p.id) } }, _sum: { amount: true } });

  const wb = newWorkbook();
  const period = `${fmtDate(from)} — ${fmtDate(toDay)}`;
  const sum = (xs: number[]) => round3(xs.reduce((a, b) => a + b, 0));
  const summary: [string, unknown, ("money" | "date" | "pct")?][] = [
    ["الفترة", period],
    ["إجمالي المصاريف", sum(expenses.map((e) => e.amount)), "money"],
    ["  منها من حساب الشركة", sum(expenses.filter((e) => e.paymentMethod === "COMPANY").map((e) => e.amount)), "money"],
    ["  منها من العهد", sum(expenses.filter((e) => e.paymentMethod === "CUSTODY").map((e) => e.amount)), "money"],
    ["  منها بشيكات", sum(expenses.filter((e) => e.paymentMethod === "CHEQUE").map((e) => e.amount)), "money"],
    ["  منها تحميل داخلي للمعدات", sum(expenses.filter((e) => e.paymentMethod === "INTERNAL").map((e) => e.amount)), "money"],
    ["المطالبات المقبوضة", sum(paidClaims.map((c) => c.paidAmount ?? 0)), "money"],
    ["المطالبات المقدمة (إجمالي)", sum(submittedClaims.map((c) => c.grossAmount)), "money"],
    ["المحجوزات المقتطعة من المطالبات المقدمة", sum(submittedClaims.map((c) => c.retention)), "money"],
    ["مستخلصات الباطن المدفوعة", sum(certs.map((c) => c.net)), "money"],
    ["أوامر التغيير المعتمدة", sum(variations.map((v) => v.amount)), "money"],
    ["شيكات مستحقة في الفترة (مؤجلة)", sum(cheques.filter((c) => c.status === "DEFERRED" && c.dueDate >= from && c.dueDate < to).map((c) => c.amount)), "money"],
  ];

  if (isAdmin) {
    const [before, txs] = await Promise.all([
      db.bankTransaction.groupBy({ by: ["type"], where: { date: { lt: from } }, _sum: { amount: true } }),
      db.bankTransaction.findMany({ where: { date: range }, include: { tender: { select: { name: true } } }, orderBy: [{ date: "asc" }, { id: "asc" }] }),
    ]);
    const opening = round3((before.find((b) => b.type === "IN")?._sum.amount ?? 0) - (before.find((b) => b.type === "OUT")?._sum.amount ?? 0));
    const inn = sum(txs.filter((t) => t.type === "IN").map((t) => t.amount));
    const out = sum(txs.filter((t) => t.type === "OUT").map((t) => t.amount));
    summary.push(["الرصيد البنكي الافتتاحي", opening, "money"], ["الوارد للبنك", inn, "money"], ["الصادر من البنك", out, "money"], ["الرصيد البنكي الختامي", round3(opening + inn - out), "money"]);
    addKeyValueSheet(wb, "ملخص الفترة", `التقرير المالي للفترة ${period}`, summary);

    let running = opening;
    addTable(
      wb,
      "الحساب البنكي",
      `كشف الحساب البنكي — رصيد افتتاحي ${opening.toLocaleString("en-US")} د.أ`,
      [
        { header: "التاريخ", key: "d", type: "date" },
        { header: "البيان", key: "desc", width: 44, type: "text" },
        { header: "المشروع", key: "p", width: 26 },
        { header: "وارد", key: "in", type: "money" },
        { header: "صادر", key: "out", type: "money" },
        { header: "الرصيد", key: "bal", type: "money" },
      ],
      txs.map((t) => {
        running = round3(running + (t.type === "IN" ? t.amount : -t.amount));
        return { d: t.date, desc: t.description, p: t.tender?.name, in: t.type === "IN" ? t.amount : null, out: t.type === "OUT" ? t.amount : null, bal: running };
      }),
      { totals: ["in", "out"] },
    );

    const months = new Map<string, { label: string; in: number; out: number }>();
    for (const t of txs) {
      const k = `${t.date.getUTCFullYear()}-${String(t.date.getUTCMonth() + 1).padStart(2, "0")}`;
      const m = months.get(k) ?? { label: monthLabel(t.date.getUTCFullYear(), t.date.getUTCMonth()), in: 0, out: 0 };
      if (t.type === "IN") m.in += t.amount;
      else m.out += t.amount;
      months.set(k, m);
    }
    addTable(
      wb,
      "التدفق النقدي الشهري",
      "التدفق النقدي الشهري",
      [
        { header: "الشهر", key: "m" },
        { header: "الوارد", key: "in", type: "money" },
        { header: "الصادر", key: "out", type: "money" },
        { header: "الصافي", key: "net", type: "money" },
      ],
      Array.from(months.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([, m]) => ({ m: m.label, in: round3(m.in), out: round3(m.out), net: round3(m.in - m.out) })),
      { totals: ["in", "out", "net"] },
    );
  } else {
    addKeyValueSheet(wb, "ملخص الفترة", `التقرير المالي للفترة ${period}`, summary);
  }

  addTable(
    wb,
    "المصاريف",
    `المصاريف — ${period}`,
    [
      { header: "التاريخ", key: "d", type: "date" },
      { header: "المشروع", key: "p", width: 28 },
      { header: "البيان", key: "desc", width: 38, type: "text" },
      { header: "التصنيف", key: "cat", width: 16 },
      { header: "المورد", key: "v", width: 18 },
      { header: "طريقة الدفع", key: "m", width: 16 },
      { header: "المبلغ", key: "a", type: "money" },
      { header: "أدخله", key: "by", width: 16 },
    ],
    expenses.map((e) => ({ d: e.date, p: e.tender?.name ?? "عام", desc: e.description, cat: EXPENSE_CATEGORY[e.category], v: e.vendor, m: PAYMENT_METHOD[e.paymentMethod], a: e.amount, by: e.createdBy.name })),
    { totals: ["a"] },
  );

  const claimCols = [
    { header: "المشروع", key: "p", width: 28 },
    { header: "المطالبة", key: "c", width: 18 },
    { header: "التقديم", key: "s", type: "date" as const },
    { header: "الإجمالي", key: "g", type: "money" as const },
    { header: "المحجوزات", key: "r", type: "money" as const },
    { header: "الطوابع", key: "t", type: "money" as const },
    { header: "خصومات أخرى", key: "o", type: "money" as const },
    { header: "الصافي", key: "n", type: "money" as const },
    { header: "المقبوض", key: "pa", type: "money" as const },
    { header: "تاريخ القبض", key: "pd", type: "date" as const },
    { header: "الحالة", key: "st" },
  ];
  type C = (typeof paidClaims)[number];
  const claimRow = (c: C) => ({ p: c.tender.name, c: `${CLAIM_TYPE[c.type]} ${c.number}`, s: c.submittedDate, g: c.grossAmount, r: c.retention, t: c.stampDuty, o: c.deductions, n: claimNet(c), pa: c.paidAmount, pd: c.paidDate, st: CLAIM_STATUS[c.status]?.label });
  addTable(wb, "المطالبات المقبوضة", `المطالبات المقبوضة — ${period}`, claimCols, paidClaims.map(claimRow), { totals: ["g", "r", "t", "o", "n", "pa"] });
  addTable(wb, "المطالبات المقدمة", `المطالبات المقدمة — ${period}`, claimCols, submittedClaims.map(claimRow), { totals: ["g", "r", "t", "o", "n"] });

  addTable(
    wb,
    "الشيكات",
    `الشيكات (تحرير/استحقاق/صرف في الفترة)`,
    [
      { header: "رقم الشيك", key: "n", width: 12 },
      { header: "المستفيد", key: "p", width: 28 },
      { header: "المشروع", key: "t", width: 24 },
      { header: "التحرير", key: "i", type: "date" },
      { header: "الاستحقاق", key: "d", type: "date" },
      { header: "المبلغ", key: "a", type: "money" },
      { header: "الحالة", key: "s" },
    ],
    cheques.map((c) => ({ n: c.number, p: c.payee, t: c.tender?.name ?? "عام", i: c.issueDate, d: c.dueDate, a: c.amount, s: CHEQUE_STATUS[c.status]?.label })),
    { totals: ["a"] },
  );

  // الديون الخارجية: كل الديون القائمة + المسددة خلال الفترة، ودفعات السداد في الفترة
  const [loans, loanPays] = await Promise.all([
    db.loan.findMany({ where: { OR: [{ status: "ACTIVE" }, { receivedDate: range }, { settledAt: range }] }, include: { installments: { select: { amount: true, paidAmount: true, dueDate: true } } }, orderBy: { receivedDate: "asc" } }),
    db.loanPayment.findMany({ where: { date: range }, include: { loan: { select: { lender: true, purpose: true } } }, orderBy: { date: "asc" } }),
  ]);
  addTable(
    wb,
    "الديون",
    `الديون الخارجية على الشركة — كما في ${fmtDate(toDay)}`,
    [
      { header: "الجهة الدائنة", key: "l", width: 26 },
      { header: "الغرض", key: "p", width: 30 },
      { header: "تاريخ الاستلام", key: "r", type: "date" },
      { header: "أصل الدين", key: "pr", type: "money" },
      { header: "الفائدة والرسوم", key: "i", type: "money" },
      { header: "المستحق الكلي", key: "t", type: "money" },
      { header: "المسدد", key: "pd", type: "money" },
      { header: "المتبقي", key: "lf", type: "money" },
      { header: "متأخر", key: "o", type: "money" },
      { header: "الحالة", key: "s" },
    ],
    loans.map((l) => {
      const pd = round3(l.installments.reduce((a, i) => a + i.paidAmount, 0));
      const o = round3(l.installments.filter((i) => i.dueDate < to && i.paidAmount < i.amount).reduce((a, i) => a + i.amount - i.paidAmount, 0));
      return { l: l.lender, p: l.purpose, r: l.receivedDate, pr: l.principal, i: round3(l.interestAmount + l.fees), t: l.totalDue, pd, lf: round3(l.totalDue - pd), o, s: LOAN_STATUS[l.status]?.label };
    }),
    { totals: ["pr", "i", "t", "pd", "lf", "o"] },
  );
  addTable(
    wb,
    "سداد الديون",
    `دفعات سداد الديون — ${period}`,
    [
      { header: "التاريخ", key: "d", type: "date" },
      { header: "الجهة الدائنة", key: "l", width: 26 },
      { header: "الغرض", key: "p", width: 30 },
      { header: "الطريقة", key: "m", width: 22 },
      { header: "المرجع", key: "r", width: 14 },
      { header: "المبلغ", key: "a", type: "money" },
    ],
    loanPays.map((x) => ({ d: x.date, l: x.loan.lender, p: x.loan.purpose, m: LOAN_PAY_METHOD[x.method], r: x.reference ?? "", a: x.amount })),
    { totals: ["a"] },
  );

  addTable(
    wb,
    "مستخلصات الباطن",
    `مستخلصات الباطن المدفوعة — ${period}`,
    [
      { header: "المقاول", key: "s", width: 24 },
      { header: "المشروع", key: "p", width: 26 },
      { header: "المستند", key: "k", width: 16 },
      { header: "تاريخ الدفع", key: "d", type: "date" },
      { header: "قيمة الأعمال", key: "w", type: "money" },
      { header: "الصافي المدفوع", key: "n", type: "money" },
    ],
    certs.map((c) => ({ s: c.subcontract.subcontractor.name, p: c.subcontract.tender.name, k: c.kind === "PROGRESS" ? `مستخلص ${c.number}` : c.kind === "ADVANCE" ? "دفعة مقدمة" : "إفراج محجوزات", d: c.paidDate, w: c.workValue, n: c.net })),
    { totals: ["w", "n"] },
  );

  addTable(
    wb,
    "ملخص المشاريع",
    "ملخص المشاريع المحالة",
    [
      { header: "المشروع", key: "p", width: 34 },
      { header: "الحالة", key: "s", width: 14 },
      { header: "المرحلة التعاقدية", key: "ph", width: 24 },
      { header: "قيمة العقد المعدّلة", key: "v", type: "money" },
      { header: "الإنجاز", key: "pr", type: "pct", width: 10 },
      { header: "مقبوض في الفترة", key: "pp", type: "money" },
      { header: "مصاريف الفترة", key: "pe", type: "money" },
      { header: "المقبوض التراكمي", key: "cp", type: "money" },
      { header: "المصاريف التراكمية", key: "ce", type: "money" },
      { header: "المحجوزات", key: "r", type: "money" },
    ],
    projects.map((p) => ({
      p: p.name,
      s: TENDER_STATUS[p.status]?.label,
      ph: phaseLabel(p) ?? "—",
      v: round3((p.awardedValue ?? 0) + p.variationTotal),
      pr: p.progress / 100,
      pp: periodPaid.find((x) => x.tenderId === p.id)?._sum.paidAmount ?? 0,
      pe: periodExp.find((x) => x.tenderId === p.id)?._sum.amount ?? 0,
      cp: round3(p.claims.reduce((s, c) => s + (c.paidAmount ?? 0), 0)),
      ce: allExp.find((x) => x.tenderId === p.id)?._sum.amount ?? 0,
      r: heldRetention(p.claims),
    })),
    { totals: ["v", "pp", "pe", "cp", "ce", "r"] },
  );

  await auditEvent("export", "Report", `تصدير التقرير المالي ${period}`, user);
  return workbookResponse(wb, `تقرير-مالي-${sp.get("from")}-${sp.get("to")}.xlsx`);
}

import { userSees } from "@/lib/brand";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { can, tenderScope } from "@/lib/permissions";
import { addKeyValueSheet, addTable, newWorkbook, workbookResponse } from "@/lib/excel";
import { BOQ_CATEGORY, CERT_STATUS, CHEQUE_STATUS, CLAIM_STATUS, CLAIM_TYPE, EXPENSE_CATEGORY, GUARANTEE_FORM, GUARANTEE_STATUS, GUARANTEE_TYPE, PAYMENT_METHOD, TENDER_STATUS, VO_STATUS } from "@/lib/labels";
import { maintenanceEnd, phaseLabel } from "@/lib/project-phase";
import { claimNet, heldRetention } from "@/lib/deductions";
import { daysBetween, earnedValue, round3 } from "@/lib/format";
import { auditEvent } from "@/lib/action";

export const dynamic = "force-dynamic";

/** تصدير شامل لعطاء/مشروع إلى Excel */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = Number(new URL(req.url).searchParams.get("id"));
  const t = await db.tender.findFirst({
    where: { id: Number.isInteger(id) ? id : 0, ...tenderScope(user) },
    include: {
      manager: true,
      boqItems: { orderBy: { sortOrder: "asc" } },
      guarantees: { orderBy: { issueDate: "asc" } },
      claims: { orderBy: { number: "asc" }, include: { lines: true } },
      expenses: { orderBy: { date: "asc" }, include: { createdBy: { select: { name: true } } } },
      cheques: { orderBy: { dueDate: "asc" } },
      variations: { orderBy: { number: "asc" } },
      subcontracts: { include: { subcontractor: true, certificates: { orderBy: { createdAt: "asc" } } } },
      materials: { orderBy: { date: "asc" } },
      equipmentLogs: { include: { equipment: true }, orderBy: { startDate: "asc" } },
    },
  });
  if (!t) return NextResponse.json({ error: "not found" }, { status: 404 });

  // رؤى الأسعار التاريخية: نفس البند في عطاءات أخرى
  const history = await db.boqItem.findMany({
    where: { normalized: { in: t.boqItems.map((b) => b.normalized) }, tenderId: { not: t.id } },
    include: { tender: { select: { purchaseDate: true, name: true } } },
  });
  const histFor = (norm: string, unit: string) => {
    const h = history.filter((x) => x.normalized === norm && x.unit === unit).sort((a, b) => b.tender.purchaseDate.getTime() - a.tender.purchaseDate.getTime());
    if (h.length === 0) return { count: 0, last: null as number | null, lastYear: null as number | null, avg: null as number | null };
    return { count: h.length, last: h[0].unitPrice, lastYear: h[0].tender.purchaseDate.getUTCFullYear(), avg: round3(h.reduce((s, x) => s + x.unitPrice, 0) / h.length) };
  };

  const contract = t.awardedValue != null ? t.awardedValue + t.variationTotal : null;
  const expTotal = t.expenses.reduce((s, e) => s + e.amount, 0);
  const boqTotal = t.boqItems.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
  const collected = t.claims.reduce((s, c) => s + (c.paidAmount ?? 0), 0);
  const retention = heldRetention(t.claims);
  const wb = newWorkbook();

  const summary: [string, unknown, ("money" | "date" | "pct" | "text")?][] = [
    ["اسم العطاء / المشروع", t.name],
    ["رقم العطاء", t.number],
    ["الجهة المالكة", t.entity],
    ["الموقع", t.location],
    ["الحالة", TENDER_STATUS[t.status]?.label],
    ["المرحلة التعاقدية", phaseLabel(t) ?? "—"],
    ["مدير المشروع", t.manager?.name ?? "غير مسند"],
    ["تاريخ شراء الوثائق", t.purchaseDate, "date"],
    ["ثمن الوثائق", t.docFee, "money"],
    ["آخر موعد للتقديم", t.deadline, "date"],
    ["زيارة الموقع", t.siteVisitDate, "date"],
    ["إجمالي جدول الكميات", round3(boqTotal), "money"],
    ["قيمة العرض المقدم", t.bidAmount, "money"],
    ["تخفيض التفاوض", t.negotiationDiscount, "money"],
    ["قيمة الإحالة", t.awardedValue, "money"],
    ["أوامر التغيير المعتمدة", t.variationTotal, "money"],
    ["قيمة العقد المعدّلة", contract, "money"],
    ["ورقة الإحالة", t.awardLetterDate, "date"],
    ["رسوم الطوابع", t.stampFee, "money"],
    ["أمر المباشرة", t.commenceOrderDate, "date"],
    ["مدة التنفيذ (يوم) شاملة أوامر التغيير", t.durationDays != null ? t.durationDays + t.variationDays : null],
    ["نسبة الإنجاز", t.progress / 100, "pct"],
    ["كشف لجنة الاستلام الابتدائي", t.prelimInspectionDate, "date"],
    ["النواقص", t.prelimSnags],
    ["معالجة النواقص", t.prelimSnagsClearedDate, "date"],
    ["محضر الاستلام الابتدائي", t.preliminaryHandoverDate, "date"],
    ["مدة الصيانة (شهر)", t.maintenanceMonths],
    ["نهاية مدة الصيانة", maintenanceEnd(t), "date"],
    ["كشف لجنة الاستلام النهائي", t.finalInspectionDate, "date"],
    ["محضر الاستلام النهائي", t.finalHandoverDate, "date"],
    ["قرار الإفراج عن كفالة الصيانة", t.maintenanceReleaseDate, "date"],
    ["تاريخ إغلاق المشروع", t.closedAt, "date"],
    ["إجمالي المطالبات", round3(t.claims.reduce((s, c) => s + c.grossAmount, 0)), "money"],
    ["المقبوض", round3(collected), "money"],
    ["المحجوزات المتراكمة", round3(retention), "money"],
    ["المحجوزات المستردة", t.retentionReleasedAmount, "money"],
    ["إجمالي المصاريف", round3(expTotal), "money"],
  ];
  if ((await userSees(user, "profit")) && contract) {
    const earned = earnedValue(contract, t.progress);
    summary.push(["قيمة الأعمال المنجزة", earned, "money"], ["الربح المحقق", round3(earned - expTotal), "money"], ["هامش الربح", earned ? (earned - expTotal) / earned : null, "pct"]);
  }
  addKeyValueSheet(wb, "ملخص المشروع", `تقرير المشروع: ${t.name}`, summary);

  addTable(
    wb,
    "جدول الكميات",
    "جدول الكميات المسعّر مع رؤى الأسعار التاريخية",
    [
      { header: "رقم", key: "no", width: 7 },
      { header: "الوصف", key: "desc", width: 46, type: "text" },
      { header: "التصنيف", key: "cat", width: 16 },
      { header: "الوحدة", key: "unit", width: 9 },
      { header: "الكمية", key: "qty", type: "number", width: 11 },
      { header: "سعر الوحدة", key: "price", type: "money" },
      { header: "المجموع", key: "total", type: "money" },
      { header: "المورد / المواصفات", key: "sup", width: 26, type: "text" },
      { header: "مرات التسعير سابقاً", key: "hc", type: "number", width: 12 },
      { header: "آخر سعر سابق", key: "hl", type: "money" },
      { header: "سنة آخر سعر", key: "hy", width: 10 },
      { header: "متوسط الأسعار السابقة", key: "ha", type: "money" },
      { header: "الفرق عن آخر سعر", key: "hd", type: "pct", width: 12 },
    ],
    t.boqItems.map((b, i) => {
      const h = histFor(b.normalized, b.unit);
      return {
        no: b.itemNo || i + 1,
        desc: b.description,
        cat: BOQ_CATEGORY[b.category] ?? b.category,
        unit: b.unit,
        qty: b.quantity,
        price: b.unitPrice,
        total: round3(b.quantity * b.unitPrice),
        sup: [b.supplier, b.specs].filter(Boolean).join(" — "),
        hc: h.count,
        hl: h.last,
        hy: h.lastYear,
        ha: h.avg,
        hd: h.last ? (b.unitPrice - h.last) / h.last : null,
      };
    }),
    { totals: ["total"] },
  );

  addTable(
    wb,
    "الكفالات",
    "الكفالات وعمولاتها البنكية",
    [
      { header: "النوع", key: "type" },
      { header: "الشكل", key: "form" },
      { header: "البنك", key: "bank" },
      { header: "الرقم", key: "ref", width: 14 },
      { header: "القيمة", key: "amount", type: "money" },
      { header: "العمولة البنكية", key: "fee", type: "money" },
      { header: "الإصدار", key: "issue", type: "date" },
      { header: "الانتهاء", key: "exp", type: "date" },
      { header: "الحالة", key: "status" },
    ],
    t.guarantees.map((g) => ({ type: GUARANTEE_TYPE[g.type], form: GUARANTEE_FORM[g.form]?.label, bank: g.bank, ref: g.referenceNo, amount: g.amount, fee: g.bankFee, issue: g.issueDate, exp: g.expiryDate, status: GUARANTEE_STATUS[g.status]?.label })),
    { totals: ["fee"] },
  );

  addTable(
    wb,
    "أوامر التغيير",
    "أوامر التغيير والأعمال الإضافية",
    [
      { header: "#", key: "n", width: 6 },
      { header: "العنوان", key: "title", width: 36, type: "text" },
      { header: "التاريخ", key: "d", type: "date" },
      { header: "القيمة", key: "amount", type: "money" },
      { header: "مدة إضافية", key: "days", type: "number" },
      { header: "الحالة", key: "status" },
    ],
    t.variations.map((v) => ({ n: v.number, title: v.title, d: v.requestDate, amount: v.amount, days: v.extraDays, status: VO_STATUS[v.status]?.label })),
    { totals: ["amount"] },
  );

  addTable(
    wb,
    "المطالبات",
    "المطالبات والمستقطعات",
    [
      { header: "المطالبة", key: "c", width: 20 },
      { header: "التقديم", key: "sub", type: "date" },
      { header: "الإجمالي", key: "gross", type: "money" },
      { header: "المحجوزات", key: "ret", type: "money" },
      { header: "الطوابع", key: "stamp", type: "money" },
      { header: "خصومات أخرى", key: "ded", type: "money" },
      { header: "الصافي", key: "net", type: "money" },
      { header: "المقبوض", key: "paid", type: "money" },
      { header: "تاريخ القبض", key: "pd", type: "date" },
      { header: "مدة القبض (يوم)", key: "days", type: "number" },
      { header: "الحالة", key: "status" },
    ],
    t.claims.map((c) => ({
      c: `${CLAIM_TYPE[c.type]} ${c.number}`,
      sub: c.submittedDate,
      gross: c.grossAmount,
      ret: c.retention,
      stamp: c.stampDuty,
      ded: c.deductions,
      net: claimNet(c),
      paid: c.paidAmount,
      pd: c.paidDate,
      days: c.paidDate ? daysBetween(c.submittedDate, c.paidDate) : null,
      status: CLAIM_STATUS[c.status]?.label,
    })),
    { totals: ["gross", "ret", "stamp", "ded", "net", "paid"] },
  );

  addTable(
    wb,
    "الحصر الفعلي",
    "بنود المطالبات حسب الحصر الفعلي للكميات المنفذة",
    [
      { header: "المطالبة", key: "c", width: 12 },
      { header: "البند", key: "d", width: 40, type: "text" },
      { header: "الوحدة", key: "u", width: 9 },
      { header: "سعر الوحدة", key: "p", type: "money" },
      { header: "كمية الجدول", key: "b", type: "number" },
      { header: "مطالب سابقاً", key: "prev", type: "number" },
      { header: "التراكمي المقاس", key: "cum", type: "number" },
      { header: "كمية الفترة", key: "per", type: "number" },
      { header: "الفرق عن الجدول", key: "var", type: "pct", width: 12 },
      { header: "القيمة", key: "a", type: "money" },
    ],
    t.claims.flatMap((c) =>
      c.lines.map((l) => ({ c: `${c.number} (${CLAIM_STATUS[c.status]?.label ?? c.status})`, d: l.description, u: l.unit, p: l.unitPrice, b: l.boqQty, prev: l.previousQty, cum: l.cumulativeQty, per: l.periodQty, var: l.boqQty ? (l.cumulativeQty - l.boqQty) / l.boqQty : null, a: l.amount })),
    ),
    { totals: ["a"] },
  );

  addTable(
    wb,
    "المصاريف",
    "مصاريف المشروع",
    [
      { header: "التاريخ", key: "d", type: "date" },
      { header: "البيان", key: "desc", width: 40, type: "text" },
      { header: "التصنيف", key: "cat", width: 16 },
      { header: "المورد", key: "vendor", width: 20 },
      { header: "طريقة الدفع", key: "m", width: 16 },
      { header: "المبلغ", key: "amount", type: "money" },
      { header: "أدخله", key: "by", width: 18 },
    ],
    t.expenses.map((e) => ({ d: e.date, desc: e.description, cat: EXPENSE_CATEGORY[e.category], vendor: e.vendor, m: PAYMENT_METHOD[e.paymentMethod], amount: e.amount, by: e.createdBy.name })),
    { totals: ["amount"] },
  );

  if (can.viewAll(user.role)) {
    addTable(
      wb,
      "الشيكات",
      "الشيكات المرتبطة بالمشروع",
      [
        { header: "رقم الشيك", key: "n", width: 12 },
        { header: "المستفيد", key: "payee", width: 28 },
        { header: "البنك", key: "bank" },
        { header: "المبلغ", key: "amount", type: "money" },
        { header: "الاستحقاق", key: "due", type: "date" },
        { header: "الحالة", key: "status" },
      ],
      t.cheques.map((c) => ({ n: c.number, payee: c.payee, bank: c.bank, amount: c.amount, due: c.dueDate, status: CHEQUE_STATUS[c.status]?.label })),
      { totals: ["amount"] },
    );
  }

  addTable(
    wb,
    "مقاولو الباطن",
    "اتفاقيات ومستخلصات مقاولي الباطن",
    [
      { header: "المقاول", key: "sub", width: 22 },
      { header: "النطاق", key: "scope", width: 28, type: "text" },
      { header: "قيمة الاتفاقية", key: "value", type: "money" },
      { header: "المستند", key: "kind", width: 16 },
      { header: "التاريخ", key: "d", type: "date" },
      { header: "قيمة الأعمال", key: "work", type: "money" },
      { header: "استرداد مقدمة", key: "adv", type: "money" },
      { header: "محجوزات", key: "ret", type: "money" },
      { header: "الصافي", key: "net", type: "money" },
      { header: "الحالة", key: "status" },
    ],
    t.subcontracts.flatMap((s) =>
      s.certificates.map((c) => ({
        sub: s.subcontractor.name,
        scope: s.scope,
        value: s.value,
        kind: c.kind === "PROGRESS" ? `مستخلص ${c.number}` : c.kind === "ADVANCE" ? "دفعة مقدمة" : "إفراج محجوزات",
        d: c.date,
        work: c.workValue,
          ret: c.retention,
        net: c.net,
        status: CERT_STATUS[c.status]?.label,
      })),
    ),
    { totals: ["work", "adv", "ret", "net"] },
  );

  addTable(
    wb,
    "المواد",
    "توريدات المواد للموقع",
    [
      { header: "التاريخ", key: "d", type: "date" },
      { header: "المادة", key: "m", width: 30 },
      { header: "الكمية", key: "q", type: "number" },
      { header: "الوحدة", key: "u", width: 9 },
      { header: "المورد", key: "s", width: 20 },
      { header: "إشعار التسليم", key: "dn", width: 14 },
      { header: "البند المرتبط", key: "b", width: 34, type: "text" },
    ],
    t.materials.map((m) => ({ d: m.date, m: m.material, q: m.quantity, u: m.unit, s: m.supplier, dn: m.deliveryNote, b: t.boqItems.find((b) => b.id === m.boqItemId)?.description })),
  );

  addTable(
    wb,
    "الآليات",
    "تشغيل الآليات والمعدات",
    [
      { header: "التاريخ", key: "d", type: "date" },
      { header: "المعدة", key: "e", width: 28 },
      { header: "الملكية", key: "o" },
      { header: "الأيام", key: "days", type: "number" },
      { header: "الكلفة اليومية", key: "rate", type: "money" },
      { header: "الكلفة", key: "cost", type: "money" },
    ],
    t.equipmentLogs.map((l) => ({ d: l.startDate, e: l.equipment.name, o: l.equipment.ownership === "OWNED" ? "ملك" : "مستأجرة", days: l.days, rate: l.dailyRate, cost: l.cost })),
    { totals: ["cost"] },
  );

  await auditEvent("export", "Report", `تصدير تقرير المشروع ${t.name} (#${t.id})`, user);
  return workbookResponse(wb, `مشروع-${t.number.replace(/[\\/]/g, "-")}.xlsx`);
}

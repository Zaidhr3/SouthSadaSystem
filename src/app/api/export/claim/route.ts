import { NextResponse } from "next/server";
import type ExcelJS from "exceljs";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { tenderScope } from "@/lib/permissions";
import { newWorkbook, workbookResponse } from "@/lib/excel";
import { CLAIM_STATUS, CLAIM_TYPE } from "@/lib/labels";
import { round3 } from "@/lib/format";
import { tafqeetJOD } from "@/lib/tafqeet";
import { claimNet } from "@/lib/deductions";
import { auditEvent } from "@/lib/action";

export const dynamic = "force-dynamic";

const BORDER: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: "FF999999" } },
  bottom: { style: "thin", color: { argb: "FF999999" } },
  left: { style: "thin", color: { argb: "FF999999" } },
  right: { style: "thin", color: { argb: "FF999999" } },
};
const HEAD: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8E8ED" } };
const MONEY = "#,##0.000";
const QTY = "#,##0.###";
const font = (o: Partial<ExcelJS.Font> = {}): Partial<ExcelJS.Font> => ({ name: "Arial", size: 10, ...o });

function title(ws: ExcelJS.Worksheet, cols: number, lines: string[]) {
  lines.forEach((text, i) => {
    ws.mergeCells(i + 1, 1, i + 1, cols);
    const c = ws.getCell(i + 1, 1);
    c.value = text;
    c.font = font({ bold: i < 2, size: i === 0 ? 14 : 11 });
    c.alignment = { horizontal: "center", vertical: "middle" };
  });
}

/**
 * تصدير المطالبة إلى Excel بثلاث أوراق مترابطة بمعادلات حية:
 *  الحصر ← الأعمال المنجزة ← الخلاصة (أي تعديل في كميات الحصر ينعكس على الخلاصة)
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = Number(new URL(req.url).searchParams.get("id"));
  const claim = await db.claim.findFirst({
    where: { id: Number.isInteger(id) ? id : 0, tender: tenderScope(user) },
    include: { lines: { orderBy: { id: "asc" } }, tender: { include: { claims: { select: { number: true, grossAmount: true, status: true } } } } },
  });
  if (!claim) return NextResponse.json({ error: "not found" }, { status: 404 });
  const t = claim.tender;
  const previousGross = round3(t.claims.filter((c) => c.number < claim.number && c.status !== "REJECTED").reduce((s, c) => s + c.grossAmount, 0));
  const head = [`شركة صدى الجنوب للمقاولات الإنشائية`, `${CLAIM_TYPE[claim.type]} رقم (${claim.number}) — ${t.name}`, `صاحب العمل: ${t.entity} — رقم العطاء: ${t.number} — الحالة: ${CLAIM_STATUS[claim.status]?.label ?? claim.status}`];
  const wb = newWorkbook();
  // ترتيب الأوراق = ترتيب الإنشاء: الخلاصة ← الأعمال المنجزة ← الحصر
  const ss = wb.addWorksheet("الخلاصة", { views: [{ rightToLeft: true }], pageSetup: { orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 1, paperSize: 9 } });
  const ws = wb.addWorksheet("الأعمال المنجزة", { views: [{ rightToLeft: true, state: "frozen", ySplit: 5 }], pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 } });

  // ── ورقة الحصر ──
  const hs = wb.addWorksheet("الحصر", { views: [{ rightToLeft: true, state: "frozen", ySplit: 5 }], pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 } });
  hs.columns = [{ width: 6 }, { width: 46 }, { width: 9 }, { width: 13 }, { width: 13 }, { width: 13 }, { width: 13 }];
  title(hs, 7, [...head.slice(0, 2), "الحصر الفعلي للكميات المنفذة في الموقع"]);
  const hsHeader = hs.getRow(5);
  ["#", "وصف البند", "الوحدة", "كمية العقد", "الكمية السابقة", "الكمية التراكمية المقاسة", "الفرق عن العقد %"].forEach((h, i) => {
    const c = hsHeader.getCell(i + 1);
    c.value = h;
    c.font = font({ bold: true });
    c.fill = HEAD;
    c.border = BORDER;
    c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  });
  hsHeader.height = 32;
  claim.lines.forEach((l, i) => {
    const r = 6 + i;
    const row = hs.getRow(r);
    row.values = [i + 1, l.description, l.unit, l.boqQty, l.previousQty, l.cumulativeQty];
    row.getCell(7).value = { formula: `IF(D${r}=0,"",(F${r}-D${r})/D${r})` };
    row.eachCell({ includeEmpty: true }, (c, col) => {
      if (col > 7) return;
      c.border = BORDER;
      c.font = font();
      if (col >= 4 && col <= 6) c.numFmt = QTY;
      if (col === 7) c.numFmt = "0.0%";
      c.alignment = { vertical: "top", wrapText: col === 2, horizontal: col === 2 ? "right" : "center" };
    });
  });

  // ── ورقة الأعمال المنجزة ──
  ws.columns = [{ width: 6 }, { width: 44 }, { width: 8 }, { width: 11 }, { width: 12 }, { width: 14 }, { width: 11 }, { width: 11 }, { width: 11 }, { width: 14 }, { width: 14 }];
  title(ws, 11, [...head.slice(0, 2), "جدول الأعمال المنجزة"]);
  const wh = ws.getRow(5);
  ["#", "وصف البند", "الوحدة", "كمية العقد", "سعر الوحدة", "قيمة العقد", "الكمية السابقة", "كمية الفترة", "الكمية التراكمية", "قيمة الفترة", "القيمة التراكمية"].forEach((h, i) => {
    const c = wh.getCell(i + 1);
    c.value = h;
    c.font = font({ bold: true });
    c.fill = HEAD;
    c.border = BORDER;
    c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  });
  wh.height = 32;
  const first = 6;
  claim.lines.forEach((l, i) => {
    const r = first + i;
    const src = 6 + i; // نفس الصف في ورقة الحصر
    const row = ws.getRow(r);
    row.getCell(1).value = i + 1;
    row.getCell(2).value = { formula: `'الحصر'!B${src}`, result: l.description };
    row.getCell(3).value = { formula: `'الحصر'!C${src}`, result: l.unit };
    row.getCell(4).value = { formula: `'الحصر'!D${src}`, result: l.boqQty };
    row.getCell(5).value = l.unitPrice;
    row.getCell(6).value = { formula: `D${r}*E${r}`, result: round3(l.boqQty * l.unitPrice) };
    row.getCell(7).value = { formula: `'الحصر'!E${src}`, result: l.previousQty };
    row.getCell(9).value = { formula: `'الحصر'!F${src}`, result: l.cumulativeQty };
    row.getCell(8).value = { formula: `I${r}-G${r}`, result: l.periodQty };
    row.getCell(10).value = { formula: `H${r}*E${r}`, result: l.amount };
    row.getCell(11).value = { formula: `I${r}*E${r}`, result: round3(l.cumulativeQty * l.unitPrice) };
    for (let col = 1; col <= 11; col++) {
      const c = row.getCell(col);
      c.border = BORDER;
      c.font = font({ bold: col === 8 || col === 10 });
      if ([5, 6, 10, 11].includes(col)) c.numFmt = MONEY;
      if ([4, 7, 8, 9].includes(col)) c.numFmt = QTY;
      c.alignment = { vertical: "top", wrapText: col === 2, horizontal: col === 2 ? "right" : "center" };
    }
  });
  const last = first + Math.max(claim.lines.length, 1) - 1;
  const totalRow = ws.getRow(last + 1);
  totalRow.getCell(2).value = "المجموع";
  totalRow.getCell(6).value = { formula: `SUM(F${first}:F${last})` };
  totalRow.getCell(10).value = { formula: `SUM(J${first}:J${last})`, result: claim.grossAmount };
  totalRow.getCell(11).value = { formula: `SUM(K${first}:K${last})` };
  for (let col = 1; col <= 11; col++) {
    const c = totalRow.getCell(col);
    c.font = font({ bold: true });
    c.fill = HEAD;
    c.border = BORDER;
    if ([6, 10, 11].includes(col)) c.numFmt = MONEY;
  }
  const grossRef = claim.lines.length ? `'الأعمال المنجزة'!J${last + 1}` : null;

  // ── ورقة الخلاصة ──
  ss.columns = [{ width: 52 }, { width: 12 }, { width: 20 }];
  title(ss, 3, [head[0], `${CLAIM_TYPE[claim.type]} رقم (${claim.number}) — الخلاصة`, head[2]]);
  ss.getCell("A5").value = `المشروع: ${t.name}`;
  ss.getCell("A6").value = `التاريخ: ${claim.submittedDate.toLocaleDateString("en-GB", { timeZone: "UTC" })} — قيمة العقد: ${round3((t.awardedValue ?? 0) + t.variationTotal)} د.أ`;
  ["A5", "A6"].forEach((a) => (ss.getCell(a).font = font()));
  const rate = (stored: number | null, amount: number) => (stored != null ? stored : claim.grossAmount ? (amount / claim.grossAmount) * 100 : 0) / 100;
  const rows: [string, ExcelJS.CellValue, ExcelJS.CellValue, boolean?][] = [
    ["قيمة الأعمال المنجزة حتى تاريخه (تراكمي)", null, { formula: "C10+C11", result: round3(previousGross + claim.grossAmount) }],
    ["ينزل: قيمة المطالبات السابقة", null, previousGross],
    ["قيمة الأعمال المنجزة لهذه المطالبة", null, grossRef ? { formula: grossRef, result: claim.grossAmount } : claim.grossAmount, true],
    ["ينزل: التأمينات المحجوزة", rate(claim.retentionRate, claim.retention), claim.retention],
    ["ينزل: رسوم طوابع الواردات", rate(claim.stampRate, claim.stampDuty), { formula: "ROUND(C11*B13,3)", result: claim.stampDuty }],
    [`ينزل: ${claim.deductionNotes || "خصومات أخرى"}`, null, claim.deductions],
    ["صافي المبلغ المستحق للصرف", null, { formula: "C11-C12-C13-C14", result: claimNet(claim) }, true],
  ];
  // الصف 9 = التراكمي، 10 = السابق، 11 = هذه المطالبة ...
  rows.forEach(([label, r, v, strong], i) => {
    const row = ss.getRow(9 + i);
    row.getCell(1).value = label;
    row.getCell(2).value = r;
    row.getCell(3).value = v;
    row.eachCell({ includeEmpty: true }, (c, col) => {
      if (col > 3) return;
      c.border = BORDER;
      c.font = font({ bold: !!strong, size: strong ? 11 : 10 });
      if (col === 2) c.numFmt = "0.00%";
      if (col === 3) c.numFmt = MONEY;
      if (strong) c.fill = HEAD;
    });
  });
  ss.getCell("C12").note = "المحجوزات محسوبة بالنسبة مع سقف المحجوزات من قيمة العقد — القيمة ثابتة كما اعتُمدت";
  ss.mergeCells("A17:C17");
  ss.getCell("A17").value = tafqeetJOD(claimNet(claim));
  ss.getCell("A17").font = font({ bold: true, size: 11 });
  ss.getCell("A17").alignment = { horizontal: "center" };
  // جدول التواقيع الرسمي (3 أعمدة) + توقيع وختم المقاول
  ["تنظيم المقاول", "تدقيق رئيس القسم", "ممثل صاحب العمل"].forEach((h, i) => {
    const col = i + 1;
    const cells = [ss.getCell(20, col), ss.getCell(21, col), ss.getCell(22, col)];
    cells[0].value = h;
    cells[1].value = "الاسم :- ....................";
    cells[2].value = "التوقيع :- ....................";
    cells.forEach((c, k) => {
      c.border = BORDER;
      c.font = font({ bold: k === 0 });
      c.alignment = { horizontal: k === 0 ? "center" : "right", vertical: "middle" };
    });
  });
  ss.getRow(21).height = 30;
  ss.getRow(22).height = 30;
  ss.mergeCells("A24:C25");
  const sealCell = ss.getCell("A24");
  sealCell.value = "توقيع وختم المقاول:";
  sealCell.font = font({ bold: true });
  sealCell.alignment = { horizontal: "right", vertical: "top" };
  sealCell.border = BORDER;
  ss.getRow(24).height = 30;
  ss.getRow(25).height = 30;

  await auditEvent("export", "Report", `تصدير المطالبة رقم ${claim.number} — ${t.name}`, user);
  return workbookResponse(wb, `مطالبة-${claim.number}-${t.number.replace(/[\\/]/g, "-")}.xlsx`);
}

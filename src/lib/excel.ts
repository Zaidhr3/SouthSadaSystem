import "server-only";
import ExcelJS from "exceljs";

export type Col = { header: string; key: string; width?: number; type?: "money" | "date" | "number" | "pct" | "text" };

const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1D1D1F" } };
const TOTAL_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F5F7" } };
const BORDER: Partial<ExcelJS.Borders> = { bottom: { style: "thin", color: { argb: "FFE5E5EA" } } };

export function newWorkbook() {
  const wb = new ExcelJS.Workbook();
  wb.creator = "South Sada Contracting ERP";
  wb.created = new Date();
  // إعادة احتساب كل المعادلات عند فتح الملف في Excel
  wb.calcProperties.fullCalcOnLoad = true;
  return wb;
}

/** ورقة بيانات منسقة باتجاه عربي، رأس ثابت، تنسيقات للعملة والتاريخ، وصف إجمالي اختياري */
export function addTable(
  wb: ExcelJS.Workbook,
  name: string,
  title: string,
  cols: Col[],
  rows: Record<string, unknown>[],
  opts: { totals?: string[]; subtitle?: string } = {},
) {
  const ws = wb.addWorksheet(name.slice(0, 31), { views: [{ rightToLeft: true, state: "frozen", ySplit: 3 }], pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  ws.columns = cols.map((c) => ({ key: c.key, width: c.width ?? (c.type === "money" ? 16 : c.type === "date" ? 13 : 22) }));

  ws.mergeCells(1, 1, 1, Math.max(1, cols.length));
  const t = ws.getCell(1, 1);
  t.value = title;
  t.font = { bold: true, size: 14, name: "Arial" };
  t.alignment = { horizontal: "right", vertical: "middle" };
  ws.getRow(1).height = 26;
  ws.mergeCells(2, 1, 2, Math.max(1, cols.length));
  ws.getCell(2, 1).value = opts.subtitle ?? `صدى الجنوب للمقاولات الإنشائية — أُعد في ${new Date().toLocaleDateString("en-GB", { timeZone: "Asia/Amman" })}`;
  ws.getCell(2, 1).font = { size: 10, color: { argb: "FF6E6E73" }, name: "Arial" };
  ws.getCell(2, 1).alignment = { horizontal: "right" };

  const header = ws.getRow(3);
  cols.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.value = c.header;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, name: "Arial", size: 10 };
    cell.fill = HEADER_FILL;
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  });
  header.height = 30;

  for (const r of rows) {
    const row = ws.addRow(cols.map((c) => normalize(r[c.key], c.type)));
    row.eachCell((cell, i) => {
      const c = cols[i - 1];
      cell.border = BORDER;
      cell.font = { name: "Arial", size: 10 };
      cell.alignment = { vertical: "top", wrapText: c.type === "text" || !c.type, horizontal: c.type && c.type !== "text" ? "center" : "right" };
      if (c.type === "money") cell.numFmt = "#,##0.000";
      if (c.type === "number") cell.numFmt = "#,##0.###";
      if (c.type === "pct") cell.numFmt = "0.0%";
      if (c.type === "date") cell.numFmt = "dd/mm/yyyy";
    });
  }

  if (opts.totals && rows.length > 0) {
    const first = 4;
    const last = 3 + rows.length;
    const totalRow = ws.addRow(cols.map((c, i) => (i === 0 ? "الإجمالي" : opts.totals!.includes(c.key) ? { formula: `SUM(${colLetter(i + 1)}${first}:${colLetter(i + 1)}${last})` } : null)));
    totalRow.eachCell((cell, i) => {
      cell.font = { bold: true, name: "Arial", size: 10 };
      cell.fill = TOTAL_FILL;
      if (cols[i - 1]?.type === "money") cell.numFmt = "#,##0.000";
    });
  }
  if (rows.length === 0) ws.addRow(["لا توجد بيانات"]);
  return ws;
}

/** ورقة «بطاقة» من أزواج مفتاح/قيمة */
export function addKeyValueSheet(wb: ExcelJS.Workbook, name: string, title: string, pairs: [string, unknown, Col["type"]?][]) {
  const ws = wb.addWorksheet(name.slice(0, 31), { views: [{ rightToLeft: true }] });
  ws.columns = [{ width: 34 }, { width: 46 }];
  ws.mergeCells(1, 1, 1, 2);
  ws.getCell(1, 1).value = title;
  ws.getCell(1, 1).font = { bold: true, size: 14, name: "Arial" };
  ws.getRow(1).height = 26;
  ws.addRow([]);
  for (const [k, v, type] of pairs) {
    const row = ws.addRow([k, normalize(v, type)]);
    row.getCell(1).font = { bold: true, name: "Arial", size: 10, color: { argb: "FF424245" } };
    row.getCell(1).fill = TOTAL_FILL;
    const c = row.getCell(2);
    c.font = { name: "Arial", size: 11 };
    c.alignment = { horizontal: "right", wrapText: true };
    if (type === "money") c.numFmt = "#,##0.000";
    if (type === "date") c.numFmt = "dd/mm/yyyy";
    if (type === "pct") c.numFmt = "0.0%";
    row.eachCell((cell) => (cell.border = BORDER));
  }
  return ws;
}

function normalize(v: unknown, type?: Col["type"]) {
  if (v === null || v === undefined || v === "") return null;
  if (type === "date") return v instanceof Date ? v : new Date(String(v));
  if (type === "money" || type === "number" || type === "pct") return typeof v === "number" ? v : Number(v);
  return v as ExcelJS.CellValue;
}

function colLetter(n: number) {
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export async function workbookResponse(wb: ExcelJS.Workbook, filename: string) {
  const buf = await wb.xlsx.writeBuffer();
  return new Response(buf as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="report.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "no-store",
    },
  });
}

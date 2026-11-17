import "server-only";
import { db } from "./db";
import { getEinvSettings, invoiceForClaim, type ReturnLine } from "./jofotara";

type ClaimLike = Parameters<typeof invoiceForClaim>[0] & { einvSigned: string | null };

const num = (s: string | undefined) => (s == null ? 0 : Number(s));

/**
 * بنود الفاتورة كما اعتمدها نظام الفوترة (من النسخة الموقّعة المحفوظة) — المرجع الملزم لفاتورة الإرجاع.
 * إن لم تتوفر النسخة الموقّعة تُحسب من المطالبة (المقفلة منذ الموافقة).
 */
export async function originalInvoiceLines(c: ClaimLike): Promise<ReturnLine[]> {
  if (c.einvSigned) {
    try {
      const xml = Buffer.from(c.einvSigned, "base64").toString("utf8");
      const out: ReturnLine[] = [];
      for (const m of xml.matchAll(/<cac:InvoiceLine>([\s\S]*?)<\/cac:InvoiceLine>/g)) {
        const b = m[1];
        const get = (re: RegExp) => b.match(re)?.[1];
        const name = get(/<cbc:Name>([\s\S]*?)<\/cbc:Name>/) ?? "";
        const unit = name.match(/\(([^()]*)\)\s*$/)?.[1] ?? "";
        const description = name.replace(/\s*\([^()]*\)\s*$/, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");
        out.push({
          lineNo: Number(get(/<cbc:ID>(\d+)<\/cbc:ID>/) ?? out.length + 1),
          description,
          unit,
          qty: num(get(/<cbc:InvoicedQuantity[^>]*>([\d.]+)</)),
          price: num(get(/<cbc:PriceAmount[^>]*>([\d.]+)</)),
          discount: num(get(/<cac:AllowanceCharge>[\s\S]*?<cbc:Amount[^>]*>([\d.]+)</)),
        });
      }
      if (out.length) return out;
    } catch {
      /* نسخة غير مقروءة — الحساب من المطالبة */
    }
  }
  const inv = invoiceForClaim(c, await getEinvSettings());
  return inv.lines.map((l, i) => ({ lineNo: i + 1, description: l.description, unit: l.unit, qty: l.qty, price: l.price, discount: l.discount }));
}

/** الكميات المرتجعة سابقاً لكل بند (فواتير الإرجاع غير المرفوضة) */
export async function returnedQty(claimId: number) {
  const rows = await db.einvReturn.findMany({ where: { claimId, status: { notIn: ["REJECTED", "DECLINED", "AUTHORIZED"] } }, select: { lines: true } });
  const m = new Map<number, number>();
  for (const r of rows) for (const l of JSON.parse(r.lines) as ReturnLine[]) m.set(l.lineNo, (m.get(l.lineNo) ?? 0) + l.qty);
  return m;
}

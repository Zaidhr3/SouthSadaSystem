import "server-only";
import { db } from "./db";
import { round3 } from "./format";

import { normalizeText } from "./text";
export { normalizeText };

export type PriceOccurrence = {
  boqItemId: number;
  tenderId: number;
  tenderName: string;
  tenderNumber: string;
  entity: string;
  date: string;
  year: number;
  status: string;
  description: string;
  unit: string;
  category: string;
  quantity: number;
  unitPrice: number;
  supplier: string | null;
  specs: string | null;
};

export type PriceGroup = {
  key: string;
  description: string;
  unit: string;
  category: string;
  occurrences: PriceOccurrence[];
  count: number;
  latestPrice: number;
  latestYear: number;
  oldestPrice: number;
  oldestYear: number;
  minPrice: number;
  maxPrice: number;
  avgPrice: number;
  changePct: number;
  annualPct: number;
  suggestedPrice: number;
};

/** البحث في كل البنود المسعّرة سابقاً، مع استبعاد عطاء معين */
export async function searchPriceHistory(query: string, opts: { excludeTenderId?: number; category?: string; limit?: number } = {}) {
  const tokens = normalizeText(query).split(" ").filter((t) => t.length >= 2);
  if (tokens.length === 0 && !opts.category) return [];
  const items = await db.boqItem.findMany({
    where: {
      AND: tokens.map((t) => ({ normalized: { contains: t } })),
      ...(opts.excludeTenderId ? { tenderId: { not: opts.excludeTenderId } } : {}),
      ...(opts.category ? { category: opts.category } : {}),
    },
    include: { tender: { select: { id: true, name: true, number: true, entity: true, purchaseDate: true, status: true } } },
    orderBy: { tender: { purchaseDate: "desc" } },
    take: opts.limit ?? 400,
  });
  return groupOccurrences(
    items.map((i) => ({
      boqItemId: i.id,
      tenderId: i.tender.id,
      tenderName: i.tender.name,
      tenderNumber: i.tender.number,
      entity: i.tender.entity,
      date: i.tender.purchaseDate.toISOString(),
      year: i.tender.purchaseDate.getUTCFullYear(),
      status: i.tender.status,
      description: i.description,
      unit: i.unit,
      category: i.category,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      supplier: i.supplier,
      specs: i.specs,
    })),
    i => normalizeText(i.description) + "|" + i.unit,
  );
}

export function groupOccurrences(rows: PriceOccurrence[], keyFn: (r: PriceOccurrence) => string): PriceGroup[] {
  const groups = new Map<string, PriceOccurrence[]>();
  for (const r of rows) {
    const k = keyFn(r);
    const list = groups.get(k) ?? [];
    list.push(r);
    groups.set(k, list);
  }
  const currentYear = new Date().getUTCFullYear();
  const result: PriceGroup[] = [];
  groups.forEach((occ, key) => {
    const sorted = [...occ].sort((a, b) => b.date.localeCompare(a.date));
    const latest = sorted[0];
    const oldest = sorted[sorted.length - 1];
    const prices = sorted.map((o) => o.unitPrice);
    const years = Math.max(0, (Date.parse(latest.date) - Date.parse(oldest.date)) / (365.25 * 86400000));
    const changePct = oldest.unitPrice > 0 ? ((latest.unitPrice - oldest.unitPrice) / oldest.unitPrice) * 100 : 0;
    const annualPct =
      years >= 0.5 && oldest.unitPrice > 0 ? (Math.pow(latest.unitPrice / oldest.unitPrice, 1 / years) - 1) * 100 : 0;
    // السعر المقترح: آخر سعر معدّل باتجاه التضخم السنوي للسنوات المنقضية (بحد أقصى ±15%)
    const elapsed = Math.max(0, currentYear - latest.year);
    const adj = Math.max(-0.15, Math.min(0.15, Math.pow(1 + annualPct / 100, elapsed) - 1));
    result.push({
      key,
      description: latest.description,
      unit: latest.unit,
      category: latest.category,
      occurrences: sorted,
      count: sorted.length,
      latestPrice: latest.unitPrice,
      latestYear: latest.year,
      oldestPrice: oldest.unitPrice,
      oldestYear: oldest.year,
      minPrice: Math.min(...prices),
      maxPrice: Math.max(...prices),
      avgPrice: round3(prices.reduce((a, b) => a + b, 0) / prices.length),
      changePct,
      annualPct,
      suggestedPrice: round3(latest.unitPrice * (1 + adj)),
    });
  });
  return result.sort((a, b) => b.count - a.count || b.latestYear - a.latestYear);
}

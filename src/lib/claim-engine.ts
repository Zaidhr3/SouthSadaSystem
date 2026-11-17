import "server-only";
import { db } from "./db";
import { round3 } from "./format";
import { getSettings } from "./settings";
import { previousCumulative } from "./surveys";
import { AppError } from "./permissions";
import { parseNum } from "./num";

export type ClaimRates = { retentionPct: number; stampPct: number };

/**
 * محرك احتساب المطالبة (مشترك بين معالج المحاسب وحصر مدير المشروع):
 *   كمية الفترة = التراكمي الفعلي − التراكمي المطالب به سابقاً
 *   قيمة الفترة = كمية الفترة × سعر الوحدة
 *   المحجوزات = الإجمالي × النسبة، بحد أقصى (سقف المحجوزات − المحتجز سابقاً)
 *   رسوم الطوابع = الإجمالي × النسبة
 *   (ضريبة الدخل واسترداد المقدمة لا تدخل في المطالبة — الضريبة في وحدة مستقلة)
 * excludeClaimId: عند تعديل مسودة قائمة حتى لا تُحتسب على نفسها.
 */
/** الرقم التالي للمطالبة = أعلى رقم + 1 (لا يتكرر حتى لو أُدخلت أرقام يدوياً أو حُذفت مطالبات) */
export async function nextClaimNumber(tenderId: number) {
  const max = await db.claim.aggregate({ where: { tenderId }, _max: { number: true } });
  return (max._max.number ?? 0) + 1;
}

/** المطالبات اليدوية (مبالغ مقطوعة بلا بنود حصر) — كمياتها غير معروفة للنظام */
export async function lumpSumClaims(tenderId: number, excludeClaimId?: number) {
  const rows = await db.claim.findMany({ where: { tenderId, status: { not: "REJECTED" }, lines: { none: {} }, ...(excludeClaimId ? { id: { not: excludeClaimId } } : {}) }, select: { number: true, grossAmount: true } });
  return { count: rows.length, gross: round3(rows.reduce((s, r) => s + r.grossAmount, 0)), numbers: rows.map((r) => r.number) };
}

export async function computeClaim(
  tenderId: number,
  cumulative: Map<number, number>,
  opts: { rates?: Partial<ClaimRates>; excludeClaimId?: number; previousOverride?: Map<number, number> } = {},
) {
  const tender = await db.tender.findUnique({
    where: { id: tenderId },
    include: { boqItems: { orderBy: { sortOrder: "asc" } }, claims: { select: { id: true, retention: true, advanceRecovery: true, status: true } } },
  });
  if (!tender) throw new AppError("العطاء غير موجود");
  if (tender.awardedValue == null) throw new AppError("لا يمكن إصدار مطالبة قبل الإحالة");
  const settings = await getSettings();
  const rates: ClaimRates = {
    retentionPct: opts.rates?.retentionPct ?? settings.retentionPct,
    stampPct: opts.rates?.stampPct ?? settings.stampDutyPct,
  };
  for (const v of Object.values(rates)) if (!Number.isFinite(v) || v < 0 || v > 100) throw new AppError("النسب يجب أن تكون بين 0 و 100");

  const prev = await previousCumulative(tenderId, opts.excludeClaimId);
  // الكميات السابقة اليدوية: مسموحة فقط للبنود غير المقاسة سابقاً وعند وجود مطالبات مقطوعة
  if (opts.previousOverride && opts.previousOverride.size > 0) {
    const lump = await lumpSumClaims(tenderId, opts.excludeClaimId);
    if (lump.count === 0) throw new AppError("الكميات السابقة تُحسب تلقائياً من المطالبات المقاسة — لا يمكن تعديلها");
    opts.previousOverride.forEach((q, id) => {
      if (!prev.has(id)) prev.set(id, round3(q));
    });
  }
  const lines = tender.boqItems
    .filter((b) => cumulative.has(b.id))
    .map((b) => {
      const cum = round3(cumulative.get(b.id)!);
      const previousQty = prev.get(b.id) ?? 0;
      const periodQty = round3(cum - previousQty);
      return { boqItemId: b.id, description: b.description, unit: b.unit, unitPrice: b.unitPrice, boqQty: b.quantity, previousQty, cumulativeQty: cum, periodQty, amount: round3(periodQty * b.unitPrice) };
    })
    .filter((l) => l.periodQty !== 0);
  if (lines.length === 0) throw new AppError("لا توجد كميات جديدة منذ آخر مطالبة — الكميات الفعلية مساوية للمطالب به سابقاً");
  const gross = round3(lines.reduce((s, l) => s + l.amount, 0));
  if (gross <= 0) throw new AppError(`قيمة أعمال الفترة ${gross} — لا يمكن إصدار مطالبة بقيمة سالبة أو صفر`);

  const others = tender.claims.filter((c) => c.status !== "REJECTED" && c.id !== opts.excludeClaimId);
  const contract = tender.awardedValue + tender.variationTotal;
  let retention = gross * (rates.retentionPct / 100);
  if (settings.retentionCapPct > 0 && contract > 0) {
    const held = others.reduce((s, c) => s + c.retention, 0);
    retention = Math.max(0, Math.min(retention, contract * (settings.retentionCapPct / 100) - held));
  }
  return {
    tender,
    rates,
    lines,
    gross,
    retention: round3(retention),
    withholdingTax: 0,
    stampDuty: round3(gross * (rates.stampPct / 100)),
    advanceRecovery: 0,
  };
}

/** يقرأ الحقول qty_<boqItemId> من النموذج */
export function readQuantities(fd: FormData, itemIds: number[]) {
  const map = new Map<number, number>();
  for (const id of itemIds) {
    const n = parseNum(fd.get(`qty_${id}`));
    if (n == null) continue;
    if (!Number.isFinite(n) || n < 0) throw new AppError("الكميات يجب أن تكون أرقاماً موجبة (مثال: 1,250.75)");
    map.set(id, n);
  }
  return map;
}

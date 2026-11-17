import "server-only";
import { db } from "./db";

/**
 * الكميات التراكمية المطالب بها سابقاً لكل بند (من أحدث مطالبة غير مرفوضة تحتوي البند).
 * المسودات تُحتسب حتى لا تُطالب الكمية مرتين قبل اعتمادها.
 */
export async function previousCumulative(tenderId: number, excludeClaimId?: number) {
  const claims = await db.claim.findMany({
    where: { tenderId, status: { not: "REJECTED" }, ...(excludeClaimId ? { id: { not: excludeClaimId } } : {}), lines: { some: {} } },
    include: { lines: { select: { boqItemId: true, cumulativeQty: true } } },
    orderBy: { number: "desc" },
  });
  const map = new Map<number, number>();
  for (const c of claims) {
    for (const l of c.lines) {
      if (l.boqItemId != null && !map.has(l.boqItemId)) map.set(l.boqItemId, l.cumulativeQty);
    }
  }
  return map;
}

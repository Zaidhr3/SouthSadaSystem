import "server-only";
import { db } from "../db";

/** أسماء المشاريع والجهات المسجلة في النظام — يحرسها «حارس الحقائق» من الحذف أو التحريف */
export async function knownNames() {
  const t = await db.tender.findMany({ select: { name: true, entity: true, location: true }, take: 500 });
  return [...new Set(t.flatMap((x) => [x.name, x.entity, x.location ?? ""]).map((s) => s.trim()).filter((s) => s.length >= 4))];
}

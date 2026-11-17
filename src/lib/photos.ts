import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "./db";
import type { Photo } from "@/components/field";

const SOURCE: Record<string, string> = {
  photo: "معرض",
  tender: "وثائق",
  diary: "يومية",
  material: "توريد",
  survey: "حصر",
  claim: "مطالبة",
  expense: "فاتورة",
  variation: "أمر تغيير",
};

/** خزنة الصور: كل صور المشروع من اليوميات والتوريدات والحصر والمطالبات والمعرض */
export async function tenderPhotos(tenderIds: number[], limit = 300): Promise<Photo[]> {
  if (tenderIds.length === 0) return [];
  const [diaries, materials, surveys, claims, expenses, variations, tenders] = await Promise.all([
    db.siteDiary.findMany({ where: { tenderId: { in: tenderIds } }, select: { id: true, tenderId: true } }),
    db.materialReceipt.findMany({ where: { tenderId: { in: tenderIds } }, select: { id: true, tenderId: true } }),
    db.survey.findMany({ where: { tenderId: { in: tenderIds } }, select: { id: true, tenderId: true } }),
    db.claim.findMany({ where: { tenderId: { in: tenderIds } }, select: { id: true, tenderId: true } }),
    db.expense.findMany({ where: { tenderId: { in: tenderIds } }, select: { id: true, tenderId: true } }),
    db.variationOrder.findMany({ where: { tenderId: { in: tenderIds } }, select: { id: true, tenderId: true } }),
    db.tender.findMany({ where: { id: { in: tenderIds } }, select: { id: true, name: true } }),
  ]);
  const owner = new Map<string, number>();
  tenderIds.forEach((id) => {
    owner.set(`photo:${id}`, id);
    owner.set(`tender:${id}`, id);
  });
  const groups: [string, { id: number; tenderId: number | null }[]][] = [
    ["diary", diaries],
    ["material", materials],
    ["survey", surveys],
    ["claim", claims],
    ["expense", expenses],
    ["variation", variations],
  ];
  const or: Prisma.AttachmentWhereInput[] = [{ entityType: { in: ["photo", "tender"] }, entityId: { in: tenderIds } }];
  for (const [type, rows] of groups) {
    if (rows.length === 0) continue;
    rows.forEach((r) => r.tenderId != null && owner.set(`${type}:${r.id}`, r.tenderId));
    or.push({ entityType: type, entityId: { in: rows.map((r) => r.id) } });
  }
  const atts = await db.attachment.findMany({
    where: { mimeType: { startsWith: "image/" }, OR: or },
    include: { uploadedBy: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  const names = new Map(tenders.map((t) => [t.id, t.name]));
  return atts
    .map((a): Photo | null => {
      const tenderId = owner.get(`${a.entityType}:${a.entityId}`);
      if (!tenderId) return null;
      return { id: a.id, fileName: a.fileName, label: a.label, createdAt: a.createdAt, source: SOURCE[a.entityType] ?? a.entityType, uploader: a.uploadedBy.name, tenderId, tenderName: names.get(tenderId) };
    })
    .filter((p): p is Photo => p !== null);
}

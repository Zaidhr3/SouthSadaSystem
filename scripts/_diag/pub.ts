import "../load-env";
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
(async () => {
  const it = await db.marketingItem.findMany({ where: { OR: [{ status: { in: ["PUBLISHED", "APPROVED", "FAILED"] }, source: { notIn: ["AUDIT_FB", "AUDIT_IG"] } }] }, select: { id: true, source: true, status: true, title: true, publishedAt: true, fbPostId: true, igMediaId: true, approvedById: true, approvedAt: true, publishAt: true } , orderBy: { id: "asc" } });
  console.log(it);
  const a = await db.auditLog.findMany({ where: { createdAt: { gte: new Date("2026-11-17T20:00:00Z") } }, select: { createdAt: true, userName: true, action: true, model: true, summary: true }, orderBy: { id: "asc" }, take: 60 });
  console.log(a);
  await db.$disconnect();
})();

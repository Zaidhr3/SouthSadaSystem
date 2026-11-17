import "./load-env";
import { PrismaClient } from "@prisma/client";

/** فحص سلامة البيانات: قيم سالبة، روابط يتيمة، حالات متناقضة — قراءة فقط */
const db = new PrismaClient();
const q = async (label: string, sql: string) => {
  const r = (await db.$queryRawUnsafe<{ n: bigint }[]>(sql))[0];
  const n = Number(r?.n ?? 0);
  console.log(`${n ? "⚠️ " : "✅"} ${label}: ${n}`);
  return n;
};
(async () => {
  // كل الأعمدة العددية العشرية: لا قيم سالبة (عدا ما يسمح منطقياً — يُراجع يدوياً)
  const cols = await db.$queryRawUnsafe<{ table_name: string; column_name: string }[]>(
    `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public' AND data_type IN ('double precision','integer','numeric') AND column_name NOT IN ('id') AND column_name NOT LIKE '%Id'`,
  );
  for (const c of cols) {
    const r = await db.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) n FROM "${c.table_name}" WHERE "${c.column_name}" < 0`);
    if (Number(r[0].n)) console.log(`⚠️ قيم سالبة ${c.table_name}.${c.column_name}: ${r[0].n}`);
  }
  // مفاتيح أجنبية يتيمة لكل عمود ينتهي بـ Id ويشير لجدول موجود
  const fks = await db.$queryRawUnsafe<{ table_name: string; column_name: string; ref: string }[]>(
    `SELECT tc.table_name, kcu.column_name, ccu.table_name ref FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu ON tc.constraint_name=kcu.constraint_name
     JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name=tc.constraint_name
     WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_schema='public'`,
  );
  console.log(`✅ قيود المفاتيح الأجنبية المفعّلة: ${fks.length} (القاعدة تمنع اليتيم فيها)`);
  await q("عطاءات نسبة إنجاز خارج 0–100", `SELECT count(*) n FROM "Tender" WHERE progress < 0 OR progress > 100`);
  await q("عطاءات قيد التنفيذ بلا مدير مشروع", `SELECT count(*) n FROM "Tender" WHERE status='EXECUTION' AND "managerId" IS NULL`);
  await q("عطاءات مؤرشفة نهائياً بلا تاريخ أرشفة", `SELECT count(*) n FROM "Tender" WHERE "archiveStage" = 2 AND "finalArchivedAt" IS NULL`);
  await q("كفالات بمبلغ صفر أو أقل", `SELECT count(*) n FROM "Guarantee" WHERE amount <= 0`);
  await q("كفالات تاريخ انتهائها قبل إصدارها", `SELECT count(*) n FROM "Guarantee" WHERE "expiryDate" < "issueDate"`);
  await q("كفالات سارية منتهية الصلاحية (تنبيه عمل)", `SELECT count(*) n FROM "Guarantee" WHERE status='ISSUED' AND "expiryDate" < now()`);
  await q("مرفقات عطاءات تشير لعطاء محذوف", `SELECT count(*) n FROM "Attachment" a WHERE a."entityType"='tender' AND NOT EXISTS (SELECT 1 FROM "Tender" t WHERE t.id=a."entityId")`);
  await q("مرفقات تسويق تشير لعنصر محذوف", `SELECT count(*) n FROM "Attachment" a WHERE a."entityType"='marketing' AND NOT EXISTS (SELECT 1 FROM "MarketingItem" m WHERE m.id=a."entityId")`);
  await q("صور مكتبة وسائط بلا سجل (رفع غير مكتمل)", `SELECT count(*) n FROM "Attachment" a WHERE a."entityType"='media_asset' AND NOT EXISTS (SELECT 1 FROM "MediaAsset" m WHERE m.id=a."entityId")`);
  await q("سجلات مكتبة وسائط بلا ملف", `SELECT count(*) n FROM "MediaAsset" m WHERE NOT EXISTS (SELECT 1 FROM "Attachment" a WHERE a.id=m."attachmentId")`);
  await q("طلبات تسعير مفتوحة بلا مدير مشروع", `SELECT count(*) n FROM "QuoteRequest" WHERE status IN ('PM_REVIEW','RETURNED') AND "assignedPmId" IS NULL`);
  await q("عناصر تسويق منشورة بلا تاريخ نشر", `SELECT count(*) n FROM "MarketingItem" WHERE status='PUBLISHED' AND "publishedAt" IS NULL`);
  await q("عناصر معتمدة متأخرة لم تُنشر (أقدم من يومين)", `SELECT count(*) n FROM "MarketingItem" WHERE status='APPROVED' AND "publishAt" < now() - interval '2 days'`);
  await q("مستخدمون فعّالون بلا كلمة مرور", `SELECT count(*) n FROM "User" WHERE active AND ("passwordHash" IS NULL OR "passwordHash"='')`).catch(() => 0);
  await q("مدراء عامون فعّالون", `SELECT count(*) n FROM "User" WHERE active AND role='ADMIN'`).then((n) => n === 0 && console.log("❌ لا يوجد مدير عام فعّال!"));
  await q("أقساط قروض مدفوعة أكثر من قيمتها", `SELECT count(*) n FROM "LoanInstallment" i WHERE (SELECT coalesce(sum(p.amount),0) FROM "LoanPayment" p WHERE p."installmentId"=i.id) > i.amount + 0.01`).catch((e) => console.log("  (تخطي القروض:", (e as Error).message.slice(0, 80), ")"));
  const t = await db.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) n FROM pg_tables WHERE schemaname='public' AND NOT rowsecurity`);
  console.log(`${Number(t[0].n) ? "⚠️" : "✅"} جداول بلا RLS: ${t[0].n}`);
  const size = await db.$queryRawUnsafe<{ s: string }[]>(`SELECT pg_size_pretty(pg_database_size(current_database())) s`);
  console.log(`ℹ️ حجم قاعدة البيانات: ${size[0].s}`);
  await db.$disconnect();
})();

import { db } from "../db";

/** فحص سلامة البيانات (قراءة فقط): يعيد قائمة بالنتائج — ok=false تعني شيئاً يستحق المراجعة */
export type CheckResult = { label: string; count: number; ok: boolean; hint?: string };

const CHECKS: { label: string; sql: string; hint?: string; warnOnly?: boolean }[] = [
  { label: "عطاءات نسبة إنجاز خارج 0–100", sql: `SELECT count(*) n FROM "Tender" WHERE progress < 0 OR progress > 100` },
  { label: "مشاريع قيد التنفيذ بلا مدير مشروع", sql: `SELECT count(*) n FROM "Tender" WHERE status='EXECUTION' AND "managerId" IS NULL`, hint: "أسند مديراً من صفحة المشروع" },
  { label: "أرشيف نهائي بلا تاريخ أرشفة", sql: `SELECT count(*) n FROM "Tender" WHERE "archiveStage" = 2 AND "finalArchivedAt" IS NULL` },
  { label: "كفالات بمبلغ صفر أو أقل", sql: `SELECT count(*) n FROM "Guarantee" WHERE amount <= 0` },
  { label: "كفالات تنتهي قبل إصدارها", sql: `SELECT count(*) n FROM "Guarantee" WHERE "expiryDate" < "issueDate"` },
  { label: "كفالات سارية انتهت صلاحيتها", sql: `SELECT count(*) n FROM "Guarantee" WHERE status='ISSUED' AND "expiryDate" < now()`, hint: "مددها أو استردها", warnOnly: true },
  { label: "مرفقات لعطاءات محذوفة", sql: `SELECT count(*) n FROM "Attachment" a WHERE a."entityType"='tender' AND NOT EXISTS (SELECT 1 FROM "Tender" t WHERE t.id=a."entityId")` },
  { label: "مرفقات تسويق لعناصر محذوفة", sql: `SELECT count(*) n FROM "Attachment" a WHERE a."entityType"='marketing' AND NOT EXISTS (SELECT 1 FROM "MarketingItem" m WHERE m.id=a."entityId")` },
  { label: "سجلات مكتبة وسائط بلا ملف", sql: `SELECT count(*) n FROM "MediaAsset" m WHERE NOT EXISTS (SELECT 1 FROM "Attachment" a WHERE a.id=m."attachmentId")` },
  { label: "طلبات تسعير مفتوحة بلا مدير مشروع", sql: `SELECT count(*) n FROM "QuoteRequest" WHERE status IN ('PM_REVIEW','RETURNED') AND "assignedPmId" IS NULL`, hint: "أسندها من صفحة الطلب" },
  { label: "طلبات تسعير عالقة أكثر من 3 أيام", sql: `SELECT count(*) n FROM "QuoteRequest" WHERE status IN ('PM_REVIEW','RETURNED','ACCOUNTANT_REVIEW','ADMIN_REVIEW') AND "updatedAt" < now() - interval '3 days'`, warnOnly: true },
  { label: "عناصر تسويق منشورة بلا تاريخ نشر", sql: `SELECT count(*) n FROM "MarketingItem" WHERE status='PUBLISHED' AND "publishedAt" IS NULL` },
  { label: "عناصر تسويق معتمدة متأخرة لم تُنشر", sql: `SELECT count(*) n FROM "MarketingItem" WHERE status='APPROVED' AND "publishAt" < now() - interval '2 days'`, hint: "تحقق من ربط فيسبوك والمهمة الصباحية" },
  { label: "عناصر تسويق فشل نشرها", sql: `SELECT count(*) n FROM "MarketingItem" WHERE status='FAILED'`, warnOnly: true },
  { label: "أقساط قروض مدفوعة أكثر من قيمتها", sql: `SELECT count(*) n FROM "LoanInstallment" WHERE "paidAmount" > amount + 0.01` },
  { label: "مستخدمون فعّالون بلا كلمة مرور", sql: `SELECT count(*) n FROM "User" WHERE active AND ("passwordHash" IS NULL OR "passwordHash"='')` },
  { label: "جداول بلا حماية RLS", sql: `SELECT count(*) n FROM pg_tables WHERE schemaname='public' AND NOT rowsecurity`, hint: "شغّل npm run db:rls" },
];

export async function runIntegrityChecks(): Promise<{ results: CheckResult[]; negatives: string[]; admins: number; dbSize: string }> {
  const results: CheckResult[] = [];
  for (const c of CHECKS) {
    try {
      const r = await db.$queryRawUnsafe<{ n: bigint }[]>(c.sql);
      const count = Number(r[0]?.n ?? 0);
      results.push({ label: c.label, count, ok: count === 0, hint: count ? c.hint : undefined });
    } catch (e) {
      results.push({ label: c.label, count: -1, ok: false, hint: `تعذر الفحص: ${e instanceof Error ? e.message.slice(0, 120) : e}` });
    }
  }
  // قيم سالبة في أي عمود رقمي (عدا المعرفات)
  const negatives: string[] = [];
  const cols = await db.$queryRawUnsafe<{ table_name: string; column_name: string }[]>(
    `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public' AND data_type IN ('double precision','integer','numeric') AND column_name <> 'id' AND column_name NOT LIKE '%Id'`,
  );
  for (const c of cols) {
    const r = await db.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) n FROM "${c.table_name}" WHERE "${c.column_name}" < 0`);
    if (Number(r[0].n)) negatives.push(`${c.table_name}.${c.column_name}: ${r[0].n}`);
  }
  const admins = await db.user.count({ where: { active: true, role: "ADMIN" } });
  const size = await db.$queryRawUnsafe<{ s: string }[]>(`SELECT pg_size_pretty(pg_database_size(current_database())) s`);
  return { results, negatives, admins, dbSize: size[0]?.s ?? "?" };
}

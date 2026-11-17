/**
 * حماية Supabase بعد كل تحديث للجداول (يُشغّل تلقائياً بعد db:push):
 *  - تفعيل Row Level Security على كل جداول المخطط public (بما فيها أي جدول جديد)
 *  - سحب أي صلاحية من أدوار الواجهة العامة anon/authenticated (حماية مضاعفة لمفتاح Supabase العام)
 * النظام يتصل بصلاحية مالك الجداول فلا يتأثر. على SQLite لا يفعل شيئاً.
 */
import "./load-env";
import { PrismaClient } from "@prisma/client";

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (!/^postgres(ql)?:\/\//.test(url)) {
    console.log("RLS: قاعدة SQLite محلية — لا حاجة لتفعيل RLS.");
    return;
  }
  const db = new PrismaClient();
  try {
    await db.$executeRawUnsafe(`DO $$ DECLARE t record; BEGIN
      FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
      END LOOP;
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon';
        EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon';
        EXECUTE 'REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon';
        EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon';
        EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon';
      END IF;
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated';
        EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM authenticated';
        EXECUTE 'REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM authenticated';
        EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM authenticated';
        EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM authenticated';
      END IF;
    END $$;`);
    const rows = await db.$queryRawUnsafe<{ tablename: string; rowsecurity: boolean }[]>(
      `SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
    );
    const off = rows.filter((r) => !r.rowsecurity);
    if (off.length) throw new Error(`جداول بلا RLS: ${off.map((r) => r.tablename).join(", ")}`);
    console.log(`✅ RLS مفعّل على كل الجداول (${rows.length}/${rows.length}) وصلاحيات الواجهة العامة مسحوبة.`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error("❌ تعذر تفعيل RLS:", e instanceof Error ? e.message : e);
  process.exit(1);
});

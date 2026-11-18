/**
 * دور قاعدة بيانات مستقل لاستعلامات المساعد الذكي (إصلاح الثغرة F3):
 *  - الدور assistant_ro بلا تسجيل دخول (NOLOGIN)، يستخدمه النظام عبر SET LOCAL ROLE داخل معاملة القراءة فقط
 *  - لا يملك أي صلاحية على جداول public — يرى فقط views في المخطط ai
 *  - كل view نسخة من جدول بلا الأعمدة الحساسة (كلمات المرور، الرموز، الأسرار)، والجداول السرية مستبعدة كلياً
 * يُعاد تشغيله بعد كل تغيير في الجداول (مضمّن في db:push) ليبقى المخطط ai مطابقاً.
 * بعد التشغيل الأول: أضف ASSISTANT_DB_ROLE=assistant_ro إلى متغيرات البيئة (Vercel + .env) ثم أعد النشر.
 */
import "./load-env";
import { PrismaClient } from "@prisma/client";

const ROLE = "assistant_ro";
/** جداول لا تظهر للمساعد إطلاقاً */
const EXCLUDED_TABLES = ["IntegrationSecret", "AttachmentBlob", "UploadTicket", "Setting", "_prisma_migrations"];
/** أعمدة تُحذف من كل view (نفس منطق الحجب في lib/assistant/tools.ts) */
const SENSITIVE_COLUMN = /(password|passwd|hash|secret|token|api_?key|otp|totp|verifier)/i;

const q = (s: string) => `"${s.replace(/"/g, '""')}"`;

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (!/^postgres(ql)?:\/\//.test(url)) {
    console.log("assistant role: قاعدة SQLite محلية — لا حاجة.");
    return;
  }
  const db = new PrismaClient();
  try {
    await db.$executeRawUnsafe(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${ROLE}') THEN CREATE ROLE ${ROLE} NOLOGIN; END IF;
    END $$`);
    // المستخدم الذي يتصل به النظام يحتاج عضوية الدور لينفّذ SET ROLE
    await db.$executeRawUnsafe(`GRANT ${ROLE} TO CURRENT_USER`);
    // إعادة بناء المخطط ai من الصفر في كل تشغيل (لا بقايا أعمدة قديمة)
    await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ai CASCADE`);
    await db.$executeRawUnsafe(`CREATE SCHEMA ai`);

    const cols = await db.$queryRawUnsafe<{ table_name: string; column_name: string }[]>(`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, ordinal_position`);
    const byTable = new Map<string, string[]>();
    for (const c of cols) {
      if (EXCLUDED_TABLES.includes(c.table_name)) continue;
      if (SENSITIVE_COLUMN.test(c.column_name)) continue;
      byTable.set(c.table_name, [...(byTable.get(c.table_name) ?? []), c.column_name]);
    }
    for (const [table, list] of byTable) {
      await db.$executeRawUnsafe(`CREATE VIEW ai.${q(table)} AS SELECT ${list.map(q).join(", ")} FROM public.${q(table)}`);
    }

    await db.$executeRawUnsafe(`REVOKE ALL ON SCHEMA public FROM ${ROLE}`);
    await db.$executeRawUnsafe(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${ROLE}`);
    await db.$executeRawUnsafe(`GRANT USAGE ON SCHEMA ai TO ${ROLE}`);
    await db.$executeRawUnsafe(`GRANT SELECT ON ALL TABLES IN SCHEMA ai TO ${ROLE}`);
    // أدوار الواجهة العامة لا ترى المخطط ai (حماية لمفتاح Supabase العام)
    await db.$executeRawUnsafe(`DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN EXECUTE 'REVOKE ALL ON SCHEMA ai FROM anon'; END IF;
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN EXECUTE 'REVOKE ALL ON SCHEMA ai FROM authenticated'; END IF;
    END $$`);

    // تحقق ذاتي: الدور لا يقرأ جدول المستخدمين الأصلي، والـ view لا يحوي عمود كلمة المرور
    const [p] = await db.$queryRawUnsafe<{ base: boolean; hash: boolean }[]>(
      `SELECT has_table_privilege('${ROLE}', 'public."User"', 'SELECT') AS base,
              EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'ai' AND column_name ILIKE '%password%') AS hash`,
    );
    if (p.base || p.hash) throw new Error(`${ROLE}: فشل التحقق (وصول لـ public: ${p.base}، عمود كلمة مرور في ai: ${p.hash})`);
    console.log(`✅ ${ROLE}: ${byTable.size} view في المخطط ai، ولا وصول لجداول public. أضف ASSISTANT_DB_ROLE=${ROLE} للبيئة.`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * تجهيز الرفع المباشر إلى Supabase Storage (يُشغّل مرة واحدة، وآمن لإعادة التشغيل): npm run storage:setup
 *
 *  - حاوية خاصة sada-staging (غير عامة) بحد 20 ميغابايت للملف وأنواع ملفات محددة
 *  - سياسات RLS على storage.objects: الدور العام anon (مفتاح المتصفح) لا يكتب ولا يقرأ ولا يحذف
 *    إلا مساراً له «تذكرة رفع» أصدرها الخادم في جدول UploadTicket:
 *       كتابة  ← تذكرة غير مستهلكة ولم تنتهِ صلاحيتها (15 دقيقة)
 *       قراءة  ← تذكرة غير مستهلكة (الخادم يسحب الملف ثم يستهلكها)
 *       حذف    ← أي تذكرة (التنظيف بعد الاستهلاك)
 *  - الفحص بدالة SECURITY DEFINER في مخطط منفصل (sada_storage) لأن جدول التذاكر محمي بـ RLS
 *    ومسحوبة صلاحياته من anon — فلا يستطيع المتصفح قراءة التذاكر نفسها.
 * المسارات عشوائية (UUID) ولا تُعرف إلا لصاحب الرفع والخادم.
 */
import "./load-env";
import { PrismaClient } from "@prisma/client";

const BUCKET = process.env.STORAGE_BUCKET || "sada-staging";
const MAX_MB = Number(process.env.NEXT_PUBLIC_MAX_STAGED_MB || 20);
const MIME = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/zip",
  "application/x-zip-compressed",
  "application/acad",
  "image/vnd.dwg",
  "application/octet-stream",
];

async function main() {
  const url = process.env.DIRECT_URL || process.env.DATABASE_URL || "";
  if (!/^postgres(ql)?:\/\//.test(url)) {
    console.log("Storage: قاعدة SQLite محلية — الرفع المباشر يعمل على Supabase فقط.");
    return;
  }
  const db = new PrismaClient({ datasources: { db: { url } } });
  const sql = (s: string) => db.$executeRawUnsafe(s);
  try {
    const mime = MIME.map((m) => `'${m}'`).join(",");
    await sql(`INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      VALUES ('${BUCKET}', '${BUCKET}', false, ${MAX_MB * 1024 * 1024}, ARRAY[${mime}])
      ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types`);

    // حاوية النسخ الاحتياطية اليومية: خاصة بلا أي سياسة — لا يصلها إلا الخادم بمفتاح الخدمة
    await sql(`INSERT INTO storage.buckets (id, name, public) VALUES ('sada-backups', 'sada-backups', false) ON CONFLICT (id) DO UPDATE SET public = false`);
    // صور المنشورات المعتمدة للنشر على إنستغرام/فيسبوك: عامة القراءة (تُرفع من الخادم فقط بعد اعتماد الإدارة)
    await sql(`INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES ('sada-marketing', 'sada-marketing', true, 10485760, ARRAY['image/jpeg','image/png']) ON CONFLICT (id) DO UPDATE SET public = true`);
    await sql(`CREATE SCHEMA IF NOT EXISTS sada_storage`);
    await sql(`REVOKE ALL ON SCHEMA sada_storage FROM PUBLIC`);
    await sql(`GRANT USAGE ON SCHEMA sada_storage TO anon, authenticated`);
    await sql(`CREATE OR REPLACE FUNCTION sada_storage.ticket_ok(p_name text, p_mode text)
      RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $f$
        SELECT EXISTS (
          SELECT 1 FROM public."UploadTicket" t
          WHERE t."path" = p_name
            AND (p_mode = 'delete' OR t."usedAt" IS NULL)
            AND (p_mode <> 'insert' OR t."expiresAt" > (now() AT TIME ZONE 'utc'))
        )
      $f$`);
    await sql(`REVOKE ALL ON FUNCTION sada_storage.ticket_ok(text, text) FROM PUBLIC`);
    await sql(`GRANT EXECUTE ON FUNCTION sada_storage.ticket_ok(text, text) TO anon, authenticated`);

    const policies: [string, string, string][] = [
      ["sada_staging_insert", "INSERT", `WITH CHECK (bucket_id = '${BUCKET}' AND sada_storage.ticket_ok(name, 'insert'))`],
      ["sada_staging_select", "SELECT", `USING (bucket_id = '${BUCKET}' AND sada_storage.ticket_ok(name, 'read'))`],
      ["sada_staging_delete", "DELETE", `USING (bucket_id = '${BUCKET}' AND sada_storage.ticket_ok(name, 'delete'))`],
    ];
    for (const [name, cmd, rule] of policies) {
      await sql(`DROP POLICY IF EXISTS ${name} ON storage.objects`);
      await sql(`CREATE POLICY ${name} ON storage.objects FOR ${cmd} TO anon, authenticated ${rule}`);
    }
    const b = await db.$queryRawUnsafe<{ id: string; public: boolean; file_size_limit: bigint }[]>(`SELECT id, public, file_size_limit FROM storage.buckets WHERE id = '${BUCKET}'`);
    const p = await db.$queryRawUnsafe<{ policyname: string }[]>(`SELECT policyname FROM pg_policies WHERE schemaname = 'storage' AND policyname LIKE 'sada_staging_%'`);
    console.log(`Storage: الحاوية ${b[0]?.id} (خاصة=${!b[0]?.public}, الحد ${Number(b[0]?.file_size_limit) / 1048576} ميغابايت) — السياسات: ${p.map((x) => x.policyname).join(", ")}`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

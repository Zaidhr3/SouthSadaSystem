/**
 * نقل كل بيانات النظام من SQLite المحلي إلى PostgreSQL (Supabase) دون فقدان أي سجل.
 *
 * التشغيل (بعد وضع DATABASE_URL و DIRECT_URL الخاصين بـ Supabase في .env):
 *   npm run cloud:migrate
 * المصدر الافتراضي: prisma/southsada.db (يمكن تغييره بـ SQLITE_PATH)
 *
 * يضمن:
 *  - الحفاظ على المعرفات (id) كما هي → كل الروابط بين الجداول تبقى صحيحة
 *  - تحويل التواريخ (ميلي ثانية في SQLite) والقيم المنطقية (0/1)
 *  - ضبط عدادات المعرفات في PostgreSQL بعد النقل
 *  - تفعيل RLS على كل الجداول (يمنع الوصول عبر واجهة Supabase العامة/المفتاح العام)
 *  - التحقق: عدد السجلات ومجاميع المبالغ متطابقة جدولاً جدولاً
 *  - يرفض العمل إن كانت قاعدة الهدف تحتوي بيانات (لا يكتب فوق شيء)
 */
import "./load-env";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";
import { Prisma, PrismaClient } from "@prisma/client";

const SOURCE = path.resolve(process.env.SQLITE_PATH || "prisma/southsada.db");

// ترتيب يراعي العلاقات (الأب قبل الابن)
const ORDER = [
  "User", "Tender", "Equipment", "Subcontractor", "BoqItem", "Guarantee", "Claim", "ClaimLine", "ClaimEvent", "Cheque", "Expense",
  "BankTransaction", "FundRequest", "CompanyDocument", "Attachment", "AttachmentBlob", "NotificationDismissal", "NotificationEvent",
  "VariationOrder", "Subcontract", "SubcontractCertificate", "MaterialReceipt", "EquipmentLog", "Correspondence",
  "Survey", "SurveyLine", "SiteDiary", "TaxEntry", "Message", "FieldRequest", "AuditLog", "EmailLog", "Setting",
];

// حقول مالية للتحقق من المجاميع
const SUMS: Record<string, string[]> = {
  BankTransaction: ["amount"], Claim: ["grossAmount", "paidAmount"], Expense: ["amount"], Cheque: ["amount"],
  BoqItem: ["unitPrice"], FundRequest: ["amount"], TaxEntry: ["amount"], Guarantee: ["amount"],
};

const delegate = (model: string) => model.charAt(0).toLowerCase() + model.slice(1);

async function main() {
  if (!fs.existsSync(SOURCE)) throw new Error(`ملف SQLite غير موجود: ${SOURCE}`);
  const url = process.env.DATABASE_URL || "";
  if (!/^postgres/i.test(url)) throw new Error("DATABASE_URL يجب أن يشير إلى PostgreSQL (Supabase)");

  // للقراءة فقط: يضمن عدم الكتابة على ملف SQLite الأصلي (مدعوم في Node 22.12+)
  const src = new DatabaseSync(SOURCE, { readOnly: true } as unknown as ConstructorParameters<typeof DatabaseSync>[1]);
  const db = new PrismaClient();
  const models = new Map(Prisma.dmmf.datamodel.models.map((m) => [m.name, m]));
  const missing = [...models.keys()].filter((m) => !ORDER.includes(m));
  if (missing.length) throw new Error(`جداول غير مدرجة في ترتيب النقل: ${missing.join(", ")}`);

  console.log(`⏳ المصدر: ${SOURCE}`);
  // 0) الترميز يجب أن يكون UTF8 (Supabase افتراضياً) — وإلا تفشل النصوص العربية والرموز
  const enc = (await db.$queryRawUnsafe<{ server_encoding: string }[]>("SHOW server_encoding"))[0]?.server_encoding;
  if (enc !== "UTF8") throw new Error(`ترميز قاعدة الهدف ${enc} — يجب أن يكون UTF8`);
  // 1) الأمان: الهدف يجب أن يكون فارغاً
  for (const name of ORDER) {
    const n = await (db as any)[delegate(name)].count();
    if (n > 0) throw new Error(`قاعدة الهدف تحتوي بيانات في الجدول ${name} (${n} سجل) — توقف النقل لتجنب الكتابة فوق بيانات قائمة`);
  }

  // 2) النقل — داخل معاملة واحدة: إما أن تُنقل كل البيانات أو لا شيء
  const srcTables = new Set((src.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((r) => r.name));
  const report: { table: string; rows: number }[] = [];
  await db.$transaction(async (tx) => {
  for (const name of ORDER) {
    const model = models.get(name)!;
    if (!srcTables.has(name)) {
      report.push({ table: name, rows: 0 });
      continue;
    }
    const scalar = model.fields.filter((f) => f.kind === "scalar");
    const rows = src.prepare(`SELECT * FROM "${name}"`).all() as Record<string, unknown>[];
    const data = rows.map((r) => {
      const o: Record<string, unknown> = {};
      for (const f of scalar) {
        const v = r[f.name];
        if (v === undefined) continue;
        if (v === null) o[f.name] = null;
        else if (f.type === "DateTime") o[f.name] = new Date(typeof v === "number" || /^\d+$/.test(String(v)) ? Number(v) : String(v));
        else if (f.type === "Boolean") o[f.name] = v === 1 || v === "1" || v === true;
        else if (f.type === "Int") o[f.name] = Number(v);
        else if (f.type === "Float") o[f.name] = Number(v);
        else o[f.name] = v;
      }
      return o;
    });
    for (let i = 0; i < data.length; i += 500) {
      await (tx as any)[delegate(name)].createMany({ data: data.slice(i, i + 500) });
    }
    report.push({ table: name, rows: data.length });
    if (data.length) console.log(`  ✓ ${name}: ${data.length}`);
  }

  // 3) عدادات المعرفات
  for (const name of ORDER) {
    const idField = models.get(name)!.fields.find((f) => f.name === "id" && f.type === "Int");
    if (!idField) continue;
    await tx.$executeRawUnsafe(
      `SELECT setval(pg_get_serial_sequence('"${name}"', 'id'), COALESCE((SELECT MAX(id) FROM "${name}"), 1), (SELECT MAX(id) IS NOT NULL FROM "${name}"))`,
    );
  }

  // 4) حماية Supabase: تفعيل RLS على كل الجداول (النظام يتصل بصلاحية المالك فلا يتأثر، بينما تُمنع واجهة REST العامة)
  await tx.$executeRawUnsafe(`DO $$ DECLARE t record; BEGIN
    FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
    END LOOP; END $$;`);
  }, { timeout: 30 * 60_000, maxWait: 60_000 });

  // 5) التحقق
  let ok = true;
  for (const { table, rows } of report) {
    const n = await (db as any)[delegate(table)].count();
    if (n !== rows) {
      ok = false;
      console.error(`  ✗ ${table}: المصدر ${rows} ≠ الهدف ${n}`);
    }
    for (const field of SUMS[table] ?? []) {
      const s = (src.prepare(`SELECT COALESCE(SUM("${field}"),0) AS s FROM "${table}"`).get() as { s: number }).s;
      const t = (await (db as any)[delegate(table)].aggregate({ _sum: { [field]: true } }))._sum[field] ?? 0;
      if (Math.abs(s - t) > 0.0005) {
        ok = false;
        console.error(`  ✗ ${table}.${field}: مجموع المصدر ${s} ≠ الهدف ${t}`);
      }
    }
  }
  src.close();
  await db.$disconnect();
  if (!ok) throw new Error("فشل التحقق — راجع الأخطاء أعلاه. البيانات المحلية لم تُمس.");
  const total = report.reduce((s, r) => s + r.rows, 0);
  console.log(`✅ تم النقل والتحقق: ${total} سجلاً في ${report.filter((r) => r.rows).length} جدولاً — الأعداد والمجاميع المالية متطابقة. RLS مفعّل.`);
}

main().catch((e) => {
  console.error("❌", e instanceof Error ? e.message : e);
  process.exit(1);
});

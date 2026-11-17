// يضبط مزود قاعدة البيانات في prisma/schema.prisma تلقائياً حسب DATABASE_URL في .env:
//   file:...              → SQLite (محلي)
//   postgres(ql)://...    → PostgreSQL (Supabase) مع directUrl للترحيلات
// يُشغَّل تلقائياً قبل البناء والتشغيل وأوامر قاعدة البيانات، فلا يتعطل النظام قبل الانتقال للسحابة.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// fileURLToPath يفك ترميز المسار (مجلد المشروع باسم عربي «موقع الشركة» يصل مُرمّزاً %D9%85… فلا يُعثر على .env)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readEnv(name) {
  if (process.env[name]) return process.env[name];
  const file = path.join(root, ".env");
  if (!fs.existsSync(file)) return undefined;
  const m = fs.readFileSync(file, "utf8").match(new RegExp(`^${name}\\s*=\\s*"?([^"\\r\\n]*)"?`, "m"));
  return m ? m[1] : undefined;
}

const url = readEnv("DATABASE_URL") || "";
const pg = /^postgres(ql)?:\/\//i.test(url);
if (!pg && !url.startsWith("file:")) {
  console.error(`[db] DATABASE_URL غير صالح: يجب أن يبدأ بـ file: (محلي) أو postgresql:// (Supabase)`);
  process.exit(1);
}
if (pg && !readEnv("DIRECT_URL")) {
  console.error("[db] DIRECT_URL مطلوب مع Supabase (الاتصال المباشر على المنفذ 5432 للترحيلات)");
  process.exit(1);
}

const schemaPath = path.join(root, "prisma", "schema.prisma");
const schema = fs.readFileSync(schemaPath, "utf8");
const block = pg
  ? `datasource db {\n  provider  = "postgresql"\n  url       = env("DATABASE_URL")\n  directUrl = env("DIRECT_URL")\n}`
  : `datasource db {\n  provider = "sqlite"\n  url      = env("DATABASE_URL")\n}`;
const next = schema.replace(/datasource db \{[\s\S]*?\n\}/, block);
if (next !== schema) fs.writeFileSync(schemaPath, next);
console.log(`[db] قاعدة البيانات: ${pg ? "PostgreSQL (Supabase)" : "SQLite (محلي)"}`);

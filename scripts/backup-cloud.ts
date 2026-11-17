/**
 * نسخة احتياطية كاملة لقاعدة البيانات (Supabase أو المحلية) إلى backups/db-<التاريخ>.json
 * تقرأ الجداول مباشرة من قاعدة البيانات (SQL خام) — فتعمل دائماً حتى قبل/بعد أي تحديث لهيكل الجداول.
 * تشمل كل الجداول ومحتوى المرفقات. التشغيل: npm run db:backup
 */
import "./load-env";
import fs from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";

async function main() {
  const db = new PrismaClient();
  const pg = /^postgres/i.test(process.env.DATABASE_URL ?? "");
  const out: Record<string, unknown[]> = {};
  let total = 0;
  try {
    const tables = pg
      ? (await db.$queryRawUnsafe<{ t: string }[]>(`SELECT tablename AS t FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE '\\_prisma%' ORDER BY tablename`)).map((r) => r.t)
      : (await db.$queryRawUnsafe<{ t: string }[]>(`SELECT name AS t FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite%' AND name NOT LIKE '\\_prisma%' ESCAPE '\\' ORDER BY name`)).map((r) => r.t);
    for (const t of tables) {
      const rows = await db.$queryRawUnsafe<Record<string, unknown>[]>(`SELECT * FROM "${t}"`);
      out[t] = rows;
      total += rows.length;
    }
  } finally {
    await db.$disconnect();
  }
  const dir = path.resolve("backups");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 16);
  const file = path.join(dir, `db-${stamp}.json`);
  const replacer = (_: string, v: unknown) => {
    if (typeof v === "bigint") return Number(v);
    if (v && typeof v === "object" && (v as { type?: string }).type === "Buffer" && Array.isArray((v as { data?: unknown }).data)) return { $bytes: Buffer.from((v as { data: number[] }).data).toString("base64") };
    return v;
  };
  fs.writeFileSync(file, JSON.stringify({ createdAt: new Date().toISOString(), total, tables: out }, replacer));
  console.log(`✅ نسخة احتياطية: ${path.relative(process.cwd(), file)} — ${total} سجلاً في ${Object.keys(out).length} جدولاً`);
}
main().catch((e) => { console.error("❌", e instanceof Error ? e.message : e); process.exit(1); });

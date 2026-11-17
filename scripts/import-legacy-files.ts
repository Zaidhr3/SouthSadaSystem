/**
 * ينقل الملفات القديمة المحفوظة على القرص (storage/uploads) إلى قاعدة البيانات
 * حتى تعمل على السحابة (Vercel لا يملك قرصاً دائماً). آمن للتكرار: يتجاهل ما نُقل سابقاً.
 * التشغيل: npm run files:import
 */
import "./load-env";
import { readFile } from "fs/promises";
import path from "path";
import { createHash } from "crypto";
import { PrismaClient } from "@prisma/client";

const dir = path.resolve(process.env.UPLOAD_DIR || "./storage/uploads");

async function main() {
  const db = new PrismaClient();
  try {
    const atts = await db.attachment.findMany({ where: { blob: null }, select: { id: true, storedName: true, size: true, fileName: true } });
    let moved = 0, missing = 0;
    for (const a of atts) {
      const buf = await readFile(path.join(dir, path.basename(a.storedName))).catch(() => null);
      if (!buf) { missing++; console.warn(`  ⚠️ غير موجود على القرص: ${a.fileName} (#${a.id})`); continue; }
      await db.attachmentBlob.create({ data: { attachmentId: a.id, data: buf } });
      const back = await db.attachmentBlob.findUniqueOrThrow({ where: { attachmentId: a.id } });
      const same = createHash("sha256").update(buf).digest("hex") === createHash("sha256").update(Buffer.from(back.data)).digest("hex");
      if (!same) throw new Error(`عدم تطابق محتوى الملف #${a.id}`);
      moved++;
      console.log(`  ✓ ${a.fileName} (${(buf.length / 1024).toFixed(0)} KB) — المحتوى مطابق`);
    }
    console.log(`✅ نُقل ${moved} ملف إلى قاعدة البيانات${missing ? ` — ${missing} غير موجود` : ""}. الملفات الأصلية على القرص لم تُحذف.`);
  } finally {
    await db.$disconnect();
  }
}
main().catch((e) => { console.error("❌", e instanceof Error ? e.message : e); process.exit(1); });

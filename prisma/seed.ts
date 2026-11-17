/**
 * تهيئة نظيفة لنظام صدى الجنوب للمقاولات:
 *  - يمسح كل البيانات (عطاءات، مشاريع، شيكات، مطالبات، مقاولو باطن، سجلات مالية، مرفقات)
 *  - يُنشئ حسابات المستخدمين الأساسية فقط
 * تشغيل: npm run db:seed   (أو npm run setup لأول مرة)
 * للبيانات التجريبية الكاملة (تدريب فقط): npm run db:demo
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { readdir, unlink } from "fs/promises";
import path from "path";

const db = new PrismaClient();

async function main() {
  // الملفات التي تخص قاعدة البيانات هذه فقط (لا يُحذف أي ملف غير مسجل فيها)
  const ownedFiles = (await db.attachment.findMany({ select: { storedName: true } })).map((a) => a.storedName);

  console.log("⏳ مسح كل البيانات...");
  // الترتيب يراعي العلاقات بين الجداول
  await db.auditLog.deleteMany();
  await db.notificationEvent.deleteMany();
  await db.notificationDismissal.deleteMany();
  await db.emailLog.deleteMany();
  await db.attachment.deleteMany();
  await db.bankTransaction.deleteMany();
  await db.fundRequest.deleteMany();
  await db.subcontractCertificate.deleteMany();
  await db.subcontract.deleteMany();
  await db.subcontractor.deleteMany();
  await db.variationOrder.deleteMany();
  await db.materialReceipt.deleteMany();
  await db.equipmentLog.deleteMany();
  await db.equipment.deleteMany();
  await db.correspondence.deleteMany();
  await db.expense.deleteMany();
  await db.cheque.deleteMany();
  await db.claim.deleteMany();
  await db.guarantee.deleteMany();
  await db.boqItem.deleteMany();
  await db.tender.deleteMany();
  await db.companyDocument.deleteMany();
  await db.setting.deleteMany();
  await db.user.deleteMany();

  // حذف ملفات المرفقات المسجلة في قاعدة البيانات هذه فقط
  const dir = path.resolve(process.cwd(), process.env.UPLOAD_DIR || "./storage/uploads");
  const present = new Set(await readdir(dir).catch(() => [] as string[]));
  let removed = 0;
  for (const name of ownedFiles) {
    if (!present.has(path.basename(name))) continue;
    await unlink(path.join(dir, path.basename(name))).catch(() => undefined);
    removed++;
  }

  console.log("👥 إنشاء الحسابات الأساسية...");
  const pw = (p: string) => bcrypt.hashSync(p, 10);
  await db.user.createMany({
    data: [
      { username: "zaid", name: "م. زيد محمد جبر الهريني", title: "المدير العام", role: "ADMIN", email: "zaidalhrini2003@gmail.com", notifyEmail: true, passwordHash: pw("Admin@2026") },
      { username: "accountant", name: "محاسب الشركة", title: "المحاسب", role: "ACCOUNTANT", passwordHash: pw("Sada@2026") },
      { username: "emad", name: "م. عماد", title: "مدير مشاريع", role: "PM", passwordHash: pw("Sada@2026") },
      { username: "ahmad", name: "م. أحمد", title: "مدير مشاريع", role: "PM", passwordHash: pw("Sada@2026") },
    ],
  });

  console.log(`✅ قاعدة بيانات نظيفة: 4 مستخدمين، 0 عطاءات، ${removed} مرفقات قديمة حُذفت`);
  console.log("⚠️  غيّر كلمات المرور فوراً من صفحة «المستخدمون» وأضف عناوين البريد للتنبيهات.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());

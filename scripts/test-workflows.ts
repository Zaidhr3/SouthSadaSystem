/** اختبار منطق الأرشفة (مع/بدون كفالات) وفحص الطلبات الوهمية — قراءة فقط، لا يكتب في قاعدة البيانات */
import "./load-env";
import "./no-server-only";
import assert from "node:assert/strict";
import { archiveCheck } from "../src/lib/archive";
import { spamCheck } from "../src/lib/quotes";
import { db } from "../src/lib/db";

const D = (s: string) => new Date(`${s}T00:00:00.000Z`);
const base = { id: 1, status: "MAINTENANCE", archiveStage: 0, preliminaryHandoverDate: null as Date | null, maintenanceMonths: null as number | null, guarantees: [] as { type: string; status: string; expiryDate: Date | null }[], claims: [{ type: "FINAL", status: "PAID" }] };

// 1) بلا أي كفالات ولا مدة صيانة: يُؤرشف مباشرة للمرحلتين
let c = archiveCheck(base);
assert.ok(c.stage1Ready && c.stage2Ready, "no guarantees → both stages");
// 2) المطالبة النهائية غير مصروفة: لا أرشفة
c = archiveCheck({ ...base, claims: [{ type: "FINAL", status: "APPROVED" }] });
assert.ok(!c.stage1Ready && c.stage1Blockers.some((b) => b.includes("المطالبة النهائية")));
// 3) كفالة حسن تنفيذ قائمة تمنع المرحلة 1، والمفرج عنها لا تمنع
assert.ok(!archiveCheck({ ...base, guarantees: [{ type: "PERFORMANCE", status: "SUBMITTED", expiryDate: null }] }).stage1Ready);
assert.ok(archiveCheck({ ...base, guarantees: [{ type: "PERFORMANCE", status: "RETRIEVED", expiryDate: null }] }).stage1Ready);
// 4) كفالة صيانة فقط (بلا حسن تنفيذ): المرحلة 1 جاهزة، والنهائي ينتظر الإفراج عنها
c = archiveCheck({ ...base, guarantees: [{ type: "MAINTENANCE", status: "SUBMITTED", expiryDate: D("2099-01-01") }] });
assert.ok(c.stage1Ready && !c.stage2Ready, "maintenance guarantee held");
// 5) مدة صيانة بلا كفالة: ينتظر انقضاء المدة
c = archiveCheck({ ...base, preliminaryHandoverDate: new Date(), maintenanceMonths: 12 });
assert.ok(c.stage1Ready && !c.stage2Ready && c.stage2Blockers[0].includes("مدة الصيانة"));
c = archiveCheck({ ...base, preliminaryHandoverDate: D("2020-01-01"), maintenanceMonths: 12 });
assert.ok(c.stage2Ready, "maintenance period ended");
// 6) عطاء غير محال لا يُؤرشف
assert.ok(!archiveCheck({ ...base, status: "SUBMITTED" }).stage1Ready);
console.log("✅ archive rules OK");

(async () => {
  const bot = await spamCheck({ name: "xx", phone: "123", type: "فيلا", details: "buy cheap seo http://spam.ru now", honeypot: "x", elapsedMs: 800 }, null);
  assert.ok(bot.spam, `bot flagged (${bot.score})`);
  const real = await spamCheck({ name: "محمد العمري", phone: "0791234567", type: "فيلا / سكن خاص", city: "عمّان", area: "350", details: "بدي أبني فيلا طابقين على أرض بخلدا، المخططات جاهزة ومرخصة", elapsedMs: 95_000 }, null);
  assert.ok(!real.spam, `real passes (${real.score}: ${real.reasons.join(",")})`);
  console.log(`✅ spam check OK — bot ${bot.score}% [${bot.reasons.join(" | ")}], real ${real.score}%`);
  await db.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });

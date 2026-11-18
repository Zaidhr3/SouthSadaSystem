/**
 * اختبارات انحدار لإصلاحات الأمان:
 *  F1 — نوع الملف يُشتق من الامتداد، ولا يُعرض داخل المتصفح إلا ما لا ينفّذ سكربت
 *  F3 — حجب كلمات المرور والأسرار من نتائج استعلامات المساعد قبل إرسالها لمزوّد الذكاء الاصطناعي
 */
import assert from "node:assert/strict";
import { attachmentHeaders, mimeFor } from "../src/lib/file-types";
import { redact } from "../src/lib/assistant/redact";

let n = 0;
const t = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log(`  ✓ ${name}`);
};

console.log("F1 — المرفقات");
t("النوع من الامتداد وليس من المتصفح", () => {
  assert.equal(mimeFor("x.png"), "image/png");
  assert.equal(mimeFor("REPORT.PDF"), "application/pdf");
  assert.equal(mimeFor("evil.svg"), "application/octet-stream");
  assert.equal(mimeFor("page.html"), "application/octet-stream");
});
t("سجل قديم محفوظ بنوع image/svg+xml واسم .png يُقدَّم كـ image/png", () => {
  const h = attachmentHeaders({ fileName: "x.png" });
  assert.equal(h["Content-Type"], "image/png");
  assert.match(h["Content-Disposition"], /^inline/);
  assert.match(h["Content-Security-Policy"], /sandbox/);
  assert.equal(h["X-Content-Type-Options"], "nosniff");
});
t("ملف بامتداد غير آمن يُنزَّل ولا يُعرض", () => {
  const h = attachmentHeaders({ fileName: "a.svg" });
  assert.match(h["Content-Disposition"], /^attachment/);
  assert.match(h["Content-Security-Policy"], /sandbox/);
});
t("PDF يُعرض inline بلا sandbox (عارض Chrome)", () => {
  const h = attachmentHeaders({ fileName: "letter.pdf" });
  assert.match(h["Content-Disposition"], /^inline/);
  assert.equal(h["Content-Security-Policy"], undefined);
});
t("الاسم العربي يُرمَّز في Content-Disposition", () => {
  assert.match(attachmentHeaders({ fileName: "كتاب.pdf" })["Content-Disposition"], /filename\*=UTF-8''%D9/);
});

console.log("F3 — نتائج المساعد");
const bcrypt = "$2a$10$" + "a".repeat(53);
t("SELECT * على جدول المستخدمين لا يكشف البصمة", () => {
  const out = redact([{ id: 1, username: "admin", passwordHash: bcrypt }]) as Record<string, unknown>[];
  assert.equal(out[0].passwordHash, "[محجوب]");
  assert.equal(out[0].username, "admin");
});
t("row_to_json / أعمدة باسم مستعار لا تكشف البصمة", () => {
  const out = redact([{ x: { id: 1, passwordHash: bcrypt }, y: `row(${bcrypt})` }]) as Record<string, Record<string, unknown> | string>[];
  assert.equal((out[0].x as Record<string, unknown>).passwordHash, "[محجوب]");
  assert.ok(!String(out[0].y).includes(bcrypt));
});
t("الأسرار المشفّرة ورموز JWT تُحجب داخل النصوص", () => {
  const sealed = "v1.abcdefghijkl.mnopqrstuvwx.yzABCDEFGHIJ";
  const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJ1aWQiOjEsInJvbGUiOiJBRE1JTiJ9.c2lnbmF0dXJlLXZhbHVl";
  const out = redact({ note: `${sealed} ${jwt}` }) as Record<string, string>;
  assert.ok(!out.note.includes(sealed) && !out.note.includes(jwt));
});
t("البيانات العادية تبقى كما هي", () => {
  assert.deepEqual(redact([{ name: "مشروع الطفيلة", value: 125000.5, date: "2026-11-18" }]), [{ name: "مشروع الطفيلة", value: 125000.5, date: "2026-11-18" }]);
});

console.log(`✅ security OK (${n})`);

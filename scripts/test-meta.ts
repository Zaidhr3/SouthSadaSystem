/** اختبار معالجة أخطاء Meta: رمز مزيف، صيغة خاطئة، وتشفير الأسرار ذهاباً وإياباً (لا يكتب في قاعدة البيانات) */
import "./load-env";
import "./no-server-only";
import assert from "node:assert/strict";
import { connectMeta, MetaError } from "../src/lib/meta";
import { open, seal } from "../src/lib/secret-box";

(async () => {
  const s = seal(JSON.stringify({ token: "abc" }));
  assert.equal(JSON.parse(open(s)).token, "abc");
  assert.throws(() => open(s.slice(0, -4) + "AAAA"), "tampered secret rejected");
  console.log("✅ secret box: encrypt/decrypt + tamper detection");

  await assert.rejects(connectMeta({ token: "short" }, "test"), (e: unknown) => e instanceof MetaError && e.kind === "INPUT");
  console.log("✅ bad token format → INPUT");

  const fake = "EAAB" + "x".repeat(180);
  try {
    await connectMeta({ token: fake }, "test");
    assert.fail("should fail");
  } catch (e) {
    assert.ok(e instanceof MetaError, "MetaError");
    console.log(`✅ fake token against graph.facebook.com → ${e.kind} (code ${e.code}): ${e.message}`);
    assert.equal(e.kind, "AUTH");
  }
})().catch((e) => { console.error("❌", e); process.exit(1); });

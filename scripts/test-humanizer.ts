/** اختبار المؤنسن: التنظيف الآلي ولوحة الفحص على نص مولّد نموذجي ونص بشري */
import assert from "node:assert/strict";
import { detect, humanizeClean } from "../src/lib/content-skills/humanizer";

const ai = `في عالمنا المتسارع، لا يخفى على أحد أن البناء ليس مجرد خرسانة، بل هو رحلة استثنائية.​
نحن نقدم الجودة، الدقة، والالتزام. علاوة على ذلك نلعب دوراً محورياً في المجتمع — ونؤمن بالتميز.
والنتيجة؟
في الختام، ما رأيكم؟ 🚀🔥 #بناء #مقاولات #الأردن #عمان #جودة #فلل #هندسة #تشطيبات #خرسانة #تصميم #عقارات`;
const r = humanizeClean(ai);
assert.ok(!r.text.includes("​"), "invisible removed");
assert.ok(!r.text.includes("—"), "em dash removed");
assert.ok(!r.text.includes("في عالمنا المتسارع"), "slop replaced");
const ids = r.flags.map((f) => f.id);
for (const id of ["ليس-مجرد", "ثلاثية", "سطر-سؤال", "خاتمة-إنشائية", "rocket", "hashtag-wall"]) assert.ok(ids.includes(id), `flag ${id} (got ${ids.join(",")})`);
const before = detect(ai), after = detect(r.text);
assert.ok(after.checks.FINGERPRINT.score > before.checks.FINGERPRINT.score, "fingerprint improves");

const human = `صبّينا اليوم سقف الطابق الثاني بفيلا عبدون، 86 م³ خرسانة من الساعة 5 الفجر.
الشباب كانوا 14 عامل، وخلّصنا قبل الظهر.
المالك أبو أحمد مرّ علينا الساعة 9 وجاب قهوة للكل، يعطيه العافية.
بكرا بنبلّش نرش مي على السقف 7 أيام متواصلة، هاي أهم خطوة بعد الصب وكتير ناس بتنساها.
إذا عندك سقف بدك تصبّه، احكينا على الواتساب ونحكيلك شو لازم تجهّز قبل بأسبوع.`;
const h = detect(human);
console.log("AI text  :", before.overall, before.verdict, "->", after.overall, after.verdict, "| flags:", ids.join(", "));
console.log("human txt:", h.overall, h.verdict, Object.entries(h.checks).map(([k, v]) => `${k}=${v.score}`).join(" "));
assert.ok(h.overall > before.overall, "human scores higher than AI");
console.log("✅ humanizer OK");

/** اختبار الكاتب الذكي والمهارات على المزود المضبوط (لا يكتب في قاعدة البيانات) */
import "./load-env";
import "./no-server-only";
import { runSkill } from "../src/lib/content-skills/skills";
import { detect } from "../src/lib/content-skills/humanizer";
import { writerName } from "../src/lib/ai/writer";

(async () => {
  console.log("writer:", writerName());
  const caption = `في عالمنا المتسارع، البناء ليس مجرد خرسانة، بل هو رحلة استثنائية — نحن نقدم الجودة، الدقة، والالتزام.\nصبّينا سقف فيلا في خلدا هذا الأسبوع بمساحة 320 م².\nما رأيكم؟`;
  const t0 = Date.now();
  const h = await runSkill("humanize", { caption, kind: "POST" });
  console.log(`humanize (${Date.now() - t0}ms):\n${h.caption}\n-- ${h.text}\nscore before ${detect(caption).overall} → after ${detect(h.caption!).overall}`);
  const hooks = await runSkill("hooks", { caption: h.caption, kind: "POST" });
  console.log("hooks:", hooks.options?.map((o) => `${o.label}: ${o.text.split("\n")[0]}`).join("\n       "), "\n", hooks.text);
  const r = await runSkill("reply", { text: "أبو خالد: كم سعر متر العظم عندكم بعمان؟\nسارة: يعطيكم العافية 👏\nمحمد: شغلكم بطيء وتأخرتوا علينا شهرين" });
  console.log("reply:\n" + r.text.slice(0, 900));
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });

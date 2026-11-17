/** فحص سلامة البيانات من سطر الأوامر: npm run db:check (قراءة فقط) */
import "./load-env";
import "./no-server-only";
import { runIntegrityChecks } from "../src/lib/assistant/integrity";

(async () => {
  const r = await runIntegrityChecks();
  for (const c of r.results) console.log(`${c.ok ? "✅" : "⚠️ "} ${c.label}: ${c.count}${c.hint ? ` — ${c.hint}` : ""}`);
  console.log(r.negatives.length ? `⚠️  قيم سالبة: ${r.negatives.join("، ")}` : "✅ لا قيم سالبة");
  console.log(`${r.admins ? "✅" : "❌"} مدراء عامون فعّالون: ${r.admins}`);
  console.log(`ℹ️  حجم قاعدة البيانات: ${r.dbSize}`);
  process.exit(0);
})();

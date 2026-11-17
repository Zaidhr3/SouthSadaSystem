/** اختبار النسخ الاحتياطي السحابي: ينشئ نسخة اليوم، ثم ينزّلها ويتحقق من عدد السجلات */
import "./load-env";
import "./no-server-only";
import { gunzipSync } from "zlib";
import { runCloudBackup, listDbBackups, downloadBackup } from "../src/lib/cloud-backup";
import { db } from "../src/lib/db";

(async () => {
  const r = await runCloudBackup();
  console.log("backup:", JSON.stringify(r));
  const list = await listDbBackups();
  console.log("list:", list.map((b) => `${b.name} ${b.size}B`).join(", "));
  const buf = await downloadBackup(list[0].name);
  const j = JSON.parse(gunzipSync(buf!).toString());
  console.log("downloaded rows:", j.total, "tables:", Object.keys(j.tables).length);
  await db.$disconnect();
})().catch((e) => { console.error("ERR", e); process.exit(1); });

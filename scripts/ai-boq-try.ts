/**
 * تجربة الاستخراج الآلي لجدول كميات حقيقي بنفس كود النظام (تشخيص على الجهاز فقط — لا يحفظ شيئاً):
 *   npx tsx scripts/ai-boq-try.ts <file.pdf> [fromPage] [toPage]
 */
import "./load-env";
import "./no-server-only";
import fs from "node:fs";
import path from "node:path";
import { fileToParts, geminiModel } from "../src/lib/ai/gemini";
import { extractBoq, type ExtractedBoqItem } from "../src/lib/ai/extract";
import { chunkRanges, pdfPageCount, pdfSlice } from "../src/lib/ai/pdf";

async function main() {
  const file = process.argv[2];
  const data = fs.readFileSync(file);
  const name = path.basename(file);
  const total = await pdfPageCount(data);
  const from = Number(process.argv[3] || 1), to = Number(process.argv[4] || total);
  const ranges = chunkRanges(to - from + 1).map(([a, b]) => [a + from - 1, b + from - 1] as [number, number]);
  const t0 = Date.now();
  const items: ExtractedBoqItem[] = [];
  const times: string[] = [];
  const failed: string[] = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (i < ranges.length) {
        const [a, b] = ranges[i++];
        const s = Date.now();
        try {
          const slice = await pdfSlice(data, a, b);
          const { parts } = await fileToParts({ name, type: "application/pdf", data: slice });
          const r = await extractBoq(parts, { from: a, to: b, total });
          items.push(...r.items);
          times.push(`ص${a}-${b}: ${r.items.length}/${((Date.now() - s) / 1000).toFixed(0)}ث`);
        } catch (e) {
          failed.push(`ص${a}-${b}: ${e instanceof Error ? e.message : e}`);
        }
      }
    }),
  );
  items.sort((x, y) => (x.page ?? 0) - (y.page ?? 0));
  console.log(JSON.stringify({ file: name, mb: +(data.length / 1048576).toFixed(1), pages: `${from}-${to}/${total}`, model: geminiModel(), seconds: +((Date.now() - t0) / 1000).toFixed(1), items: items.length }));
  console.log("  " + times.join(" | "));
  if (failed.length) console.log("  فشل: " + failed.join(" | "));
  for (const it of items.slice(0, Number(process.env.SHOW || 5))) console.log(`  [ص${it.page ?? "?"}] ${it.itemNo ?? "-"} | ${it.description.slice(0, Number(process.env.DESC || 60))} | ${it.unit ?? "?"} | ${it.quantity ?? "?"} | سعر: ${it.unitPrice ?? "فارغ"}`);
  console.log(`  بلا كمية: ${items.filter((x) => x.quantity == null).length} | بلا وحدة: ${items.filter((x) => !x.unit).length} | فيها سعر: ${items.filter((x) => x.unitPrice != null).length}`);
}
main().catch((e) => {
  console.error("ERR", e instanceof Error ? e.message : e);
  process.exit(1);
});

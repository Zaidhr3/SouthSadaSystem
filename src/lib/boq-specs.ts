import "server-only";
import { db } from "./db";
import { generateJson } from "./ai/gemini";
import { normalizeText } from "./text";

/**
 * «المواصفات المهمة» لبنود جدول الكميات:
 * الذكاء الاصطناعي يقرأ وصف البند الطويل ويستخرج فقط ما يغيّر السعر (المادة، الدرجة/الرتبة، الأبعاد/السماكة/القطر، طريقة التنفيذ أو النوع)
 * ويتجاهل الحشو العام («حسب المواصفات وتعليمات المهندس، شاملاً كل ما يلزم...»).
 * البصمة specKey = المادة|الدرجة|البعد|الطريقة|الوحدة بصيغة موحدة — بندان بنفس البصمة = نفس المواصفات حتى لو اختلفت الصياغة.
 */
export type KeySpecs = { material: string; grade: string; size: string; method: string; specs: { k: string; v: string }[] };
export type SpecMatch = { boqItemId: number; tenderId: number; tenderName: string; place: string; year: number; unitPrice: number; unit: string; quantity: number; status: string; exact: boolean };

const SYSTEM = `أنت مهندس كميات خبير في عطاءات الأردن. لكل بند من جدول الكميات استخرج فقط المواصفات التي تغيّر السعر، وتجاهل الحشو العام (حسب المواصفات، شاملاً التوريد والتركيب، وتعليمات المهندس…).
اكتب الحقول الأربعة بصيغة موحدة قصيرة بالإنجليزية الصغيرة (lowercase) لتتطابق البنود المتشابهة مهما اختلفت صياغتها:
- material: المادة/العنصر الأساسي، مثل concrete, rebar, block, plaster, tiles-porcelain, paint-emulsion, excavation, asphalt, pipe-upvc, waterproofing-bitumen.
- grade: الرتبة أو القوة أو الصنف بصيغة موحدة — أو "" إن لم توجد:
  • الخرسانة دائماً b + قوة الكسر بالكغم/سم² (300 كغم/سم² = b300، B250 = b250، C25 = b300، C30 = b350، C20 = b250).
  • حديد التسليح: grade60 أو grade40. البلاط/الدهان: الصنف أو المنشأ إن ذُكر (first-class, imported).
- size: البعد الحاسم مع وحدته بصيغة موحدة: السماكة t20cm، القطر d110mm، المقاس 60x60cm، السعة 80l — أو "".
- method: طريقة التنفيذ/العنصر إن كانت تغيّر السعر، من القائمة فقط: ready-mix, site-mix, foundations, columns, slabs, beams, walls, rock, soil, 2-coats, 3-coats — أو "".
- specs: قائمة 2-5 مواصفات مهمة بالعربية القصيرة (k: اسم المواصفة، v: قيمتها) كما ستُعرض للمسعّر.
لا تخترع مواصفات غير مذكورة في النص.`;

const SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          i: { type: "integer" },
          material: { type: "string" },
          grade: { type: "string" },
          size: { type: "string" },
          method: { type: "string" },
          specs: { type: "array", items: { type: "object", properties: { k: { type: "string" }, v: { type: "string" } }, required: ["k", "v"] } },
        },
        required: ["i", "material", "grade", "size", "method", "specs"],
      },
    },
  },
  required: ["items"],
};

const clean = (s: string) => normalizeText(s || "").replace(/\s+/g, "").toLowerCase();
const unitKey = (u: string) => normalizeText(u).replace(/[³3]/g, "3").replace(/[²2]/g, "2").replace(/\s+/g, "");
export const buildSpecKey = (k: Pick<KeySpecs, "material" | "grade" | "size" | "method">, unit: string) => [clean(k.material), clean(k.grade), clean(k.size), clean(k.method), unitKey(unit)].join("|");

export async function extractKeySpecs(rows: { description: string; unit: string; specs?: string | null }[]): Promise<KeySpecs[]> {
  const out: KeySpecs[] = rows.map(() => ({ material: "", grade: "", size: "", method: "", specs: [] }));
  const CHUNK = 30;
  const chunks: number[][] = [];
  for (let s = 0; s < rows.length; s += CHUNK) chunks.push(Array.from({ length: Math.min(CHUNK, rows.length - s) }, (_, j) => s + j));
  await Promise.all(
    chunks.map(async (idx) => {
      const text = idx.map((n) => `${n}) [${rows[n].unit}] ${rows[n].description.slice(0, 700)}${rows[n].specs ? ` — ${rows[n].specs}` : ""}`).join("\n");
      const { data } = await generateJson<{ items: (KeySpecs & { i: number })[] }>({ system: SYSTEM, parts: [{ text }], schema: SCHEMA, temperature: 0, maxOutputTokens: 6000, timeoutMs: 90_000, thinking: "low" });
      for (const it of data.items ?? []) if (idx.includes(it.i)) out[it.i] = { material: it.material, grade: it.grade, size: it.size, method: it.method, specs: (it.specs ?? []).slice(0, 5) };
    }),
  );
  return out;
}

/** فهرسة بنود (عطاء معين أو السجل التاريخي) لا بصمة لها بعد */
export async function indexSpecs(where: { tenderId?: number }, limit = 120) {
  const items = await db.boqItem.findMany({ where: { specKey: null, ...(where.tenderId ? { tenderId: where.tenderId } : { unitPrice: { gt: 0 } }) }, select: { id: true, description: true, unit: true, specs: true }, orderBy: { id: "desc" }, take: limit });
  if (!items.length) return { done: 0, left: 0 };
  const specs = await extractKeySpecs(items);
  await db.$transaction(items.map((it, n) => db.boqItem.update({ where: { id: it.id }, data: { specKey: specs[n].material ? buildSpecKey(specs[n], it.unit) : "~", keySpecs: JSON.stringify(specs[n].specs) } })));
  const left = await db.boqItem.count({ where: { specKey: null, ...(where.tenderId ? { tenderId: where.tenderId } : { unitPrice: { gt: 0 } }) } });
  return { done: items.length, left };
}

const placeOf = (t: { location: string | null; entity: string }) => t.location?.trim() || t.entity;

/** مطابقات البصمة لعدة بنود: نفس المواصفات تماماً، ثم «قريبة» (نفس المادة والرتبة والوحدة بأبعاد مختلفة) */
export async function matchesForKeys(keys: string[], excludeTenderId?: number): Promise<Map<string, SpecMatch[]>> {
  const real = Array.from(new Set(keys.filter((k) => k && k !== "~")));
  const map = new Map<string, SpecMatch[]>();
  if (!real.length) return map;
  const near = (k: string) => { const p = k.split("|"); return `${p[0]}|${p[1]}|`; };
  const rows = await db.boqItem.findMany({
    where: { unitPrice: { gt: 0 }, ...(excludeTenderId ? { tenderId: { not: excludeTenderId } } : {}), OR: [{ specKey: { in: real } }, ...Array.from(new Set(real.map(near))).map((p) => ({ specKey: { startsWith: p } }))] },
    select: { id: true, specKey: true, unitPrice: true, unit: true, quantity: true, tender: { select: { id: true, name: true, location: true, entity: true, purchaseDate: true, status: true } } },
    orderBy: { tender: { purchaseDate: "desc" } },
    take: 600,
  });
  for (const k of real) {
    const unit = k.split("|")[4];
    const list = rows
      .filter((r) => r.specKey === k || (r.specKey?.startsWith(near(k)) && r.specKey.split("|")[4] === unit))
      .map((r) => ({ boqItemId: r.id, tenderId: r.tender.id, tenderName: r.tender.name, place: placeOf(r.tender), year: r.tender.purchaseDate.getUTCFullYear(), unitPrice: r.unitPrice, unit: r.unit, quantity: r.quantity, status: r.tender.status, exact: r.specKey === k }))
      .sort((a, b) => Number(b.exact) - Number(a.exact) || b.year - a.year)
      .slice(0, 8);
    if (list.length) map.set(k, list);
  }
  return map;
}

/** للمسعّر أثناء الكتابة: يستخرج مواصفات البند المكتوب ويبحث عن نفس المواصفات في كل العطاءات السابقة */
export async function matchTyped(description: string, unit: string, excludeTenderId?: number) {
  const [k] = await extractKeySpecs([{ description, unit }]);
  if (!k.material) return { specs: k.specs, key: null, matches: [] as SpecMatch[] };
  const key = buildSpecKey(k, unit || "");
  const m = await matchesForKeys([key], excludeTenderId);
  return { specs: k.specs, key, matches: m.get(key) ?? [] };
}

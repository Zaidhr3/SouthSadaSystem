/**
 * اختبارات منطق السكن التشاركي النقي (بلا قاعدة بيانات): قواعد الاختيار، التقدير، عدّ الأشهر.
 * التشغيل: npx tsx scripts/test-cobuild.ts
 */
import assert from "node:assert/strict";
import { buyerMonth, defaultQtyFor, estimate, normalizeSelection, wholeMonths, type CatalogLite } from "../src/lib/cobuild-core";

const item = (o: Partial<CatalogLite> & { id: number }): CatalogLite => ({ code: `T${o.id}`, phase: "PLASTER_FLOOR", category: "x", name: `i${o.id}`, specs: null, unit: "م²", price: 10, mode: "OPTION", choiceGroup: null, qtyPerSqm: 0, defaultQty: 1, qtyEditable: false, ...o });
const items = [
  item({ id: 1, mode: "INCLUDED", qtyPerSqm: 1 }),
  item({ id: 2, mode: "REQUIRED", choiceGroup: "FLOOR", qtyPerSqm: 0.85, price: 18 }),
  item({ id: 3, mode: "OPTION", choiceGroup: "FLOOR", qtyPerSqm: 0.85, price: 38 }),
  item({ id: 4, mode: "REQUIRED", defaultQty: 1, price: 280 }),
  item({ id: 5, mode: "OPTION", qtyEditable: true, defaultQty: 4, price: 75 }),
];
let n = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log(`✓ ${name}`);
};

ok("الإلزامي يُضاف تلقائياً والمشمول بالعظم لا يُحسب", () => {
  const s = normalizeSelection(items, [], 100);
  assert.deepEqual(s.map((x) => x.itemId).sort(), [2, 4]);
  assert.equal(s.find((x) => x.itemId === 2)!.qty, 85);
});
ok("اختيار بديل من نفس المجموعة يستبدل الإلزامي", () => {
  const s = normalizeSelection(items, [{ itemId: 3, qty: 1 }], 100);
  assert.ok(!s.some((x) => x.itemId === 2));
  assert.equal(s.find((x) => x.itemId === 3)!.qty, 85);
});
ok("المتصفح لا يفرض كمية البنود غير القابلة للتعديل", () => {
  const s = normalizeSelection(items, [{ itemId: 3, qty: 9999 }], 100);
  assert.equal(s.find((x) => x.itemId === 3)!.qty, 85);
});
ok("الكمية القابلة للتعديل محصورة بين 0 و200 وتُقرَّب", () => {
  assert.equal(normalizeSelection(items, [{ itemId: 5, qty: 7.6 }], 100).find((x) => x.itemId === 5)!.qty, 8);
  assert.equal(normalizeSelection(items, [{ itemId: 5, qty: 5000 }], 100).find((x) => x.itemId === 5)!.qty, 200);
  assert.ok(!normalizeSelection(items, [{ itemId: 5, qty: -3 }], 100).some((x) => x.itemId === 5));
});
ok("بند غير موجود أو مشمول يُتجاهل", () => {
  const s = normalizeSelection(items, [{ itemId: 999, qty: 1 }, { itemId: 1, qty: 5 }], 100);
  assert.ok(!s.some((x) => x.itemId === 999 || x.itemId === 1));
});
ok("التقدير = العظم + التشطيب − الحوافز", () => {
  const e = estimate({ skeletonPrice: 40000, lines: [{ itemId: 2, qty: 85, price: 18 }, { itemId: 4, qty: 1, price: 280 }], credits: 1500 });
  assert.equal(e.finishing, 1810);
  assert.equal(e.total, 40310);
});
ok("الكمية حسب المساحة", () => assert.equal(defaultQtyFor({ qtyPerSqm: 2.8, defaultQty: 1 }, 150), 420));
ok("عدّ الأشهر التقويمي", () => {
  const a = new Date("2026-01-15T00:00:00Z");
  assert.equal(wholeMonths(a, new Date("2026-06-14T00:00:00Z")), 4);
  assert.equal(wholeMonths(a, new Date("2026-06-15T00:00:00Z")), 5);
  assert.equal(buyerMonth(a, new Date("2026-06-15T00:00:00Z")), 6);
  assert.equal(buyerMonth(a, a), 1);
});
console.log(`\n✅ السكن التشاركي: ${n} اختبارات ناجحة`);

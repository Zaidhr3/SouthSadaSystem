import "server-only";
import { db } from "../db";

/**
 * إحداثيات مواقع المشاريع: جدول مدمج لمدن ومناطق الأردن (فوري وبلا اتصال)، ثم Nominatim (OpenStreetMap — من قائمة public-apis)
 * كاحتياط للأسماء غير المعروفة. النتيجة تُحفظ في المشروع فلا يُبحث عنها مرة أخرى.
 */
const PLACES: [string[], number, number][] = [
  [["عمان", "عمّان", "amman"], 31.9539, 35.9106],
  [["عبدون", "دابوق", "خلدا", "الشميساني", "الجبيهة", "تلاع العلي", "مرج الحمام", "أبو نصير", "ابو نصير", "طبربور", "ماركا"], 31.98, 35.87],
  [["ناعور", "سيل حسبان", "حسبان"], 31.876, 35.83],
  [["الزرقاء", "الرصيفة", "zarqa"], 32.0728, 36.0879],
  [["إربد", "اربد", "الرمثا", "irbid"], 32.5556, 35.85],
  [["السلط", "البلقاء", "salt"], 32.0392, 35.7272],
  [["مادبا", "ذيبان", "madaba"], 31.7167, 35.8],
  [["الكرك", "karak"], 31.1853, 35.7048],
  [["الطفيلة", "tafileh", "tafila"], 30.8375, 35.6042],
  [["معان", "الشوبك", "وادي موسى", "البتراء", "maan"], 30.1962, 35.736],
  [["العقبة", "وادي عربة", "aqaba"], 29.532, 35.0063],
  [["جرش", "jerash"], 32.2747, 35.8961],
  [["عجلون", "ajloun"], 32.3326, 35.7517],
  [["المفرق", "mafraq"], 32.3429, 36.2081],
  [["الرويشد", "الريشة", "حقل الريشة"], 32.5, 38.2],
  [["الأغوار", "الاغوار", "الشونة", "دير علا"], 32.2, 35.6],
  [["سحاب", "الجيزة", "الموقر"], 31.87, 36.0],
];

export function knownPlace(text: string | null | undefined): { lat: number; lon: number } | null {
  if (!text) return null;
  const t = text.toLowerCase();
  // الأدق أولاً (المناطق قبل المحافظات): الجدول مرتب بحيث تُفحص الأسماء الأطول قبل عمّان العامة
  const hits = PLACES.flatMap(([names, lat, lon]) => names.filter((n) => t.includes(n.toLowerCase())).map((n) => ({ n, lat, lon })));
  if (!hits.length) return null;
  hits.sort((a, b) => b.n.length - a.n.length);
  return { lat: hits[0].lat, lon: hits[0].lon };
}

async function nominatim(q: string) {
  const u = new URL("https://nominatim.openstreetmap.org/search");
  u.search = new URLSearchParams({ q: `${q}, الأردن`, format: "json", limit: "1", countrycodes: "jo" }).toString();
  const r = await fetch(u, { headers: { "User-Agent": "SadaERP/1.0 (construction ERP; github.com/Zaidhr3/SouthSadaSystem)", "Accept-Language": "ar" }, signal: AbortSignal.timeout(6000), next: { revalidate: 86400 * 30 } });
  if (!r.ok) return null;
  const j = (await r.json()) as { lat: string; lon: string }[];
  return j[0] ? { lat: Number(j[0].lat), lon: Number(j[0].lon) } : null;
}

/** إحداثيات مشروع (من المحفوظ، أو الجدول، أو البحث) — وتُحفظ للمرات القادمة */
export async function tenderCoords(t: { id: number; location: string | null; name: string; lat: number | null; lon: number | null }) {
  if (t.lat != null && t.lon != null) return { lat: t.lat, lon: t.lon };
  const c = knownPlace(t.location) ?? knownPlace(t.name) ?? (t.location ? await nominatim(t.location).catch(() => null) : null);
  if (c) await db.tender.update({ where: { id: t.id }, data: { lat: c.lat, lon: c.lon } }).catch(() => undefined);
  return c;
}

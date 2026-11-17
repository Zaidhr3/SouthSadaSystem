/**
 * حارس الحقائق: أي إعادة صياغة (المؤنسن، المحادثة، المهارات، مراجعة الصفحة) يجب أن تحتفظ حرفياً بـ:
 * الأرقام والكميات، الأبعاد (12×15)، المساحات والأحجام (م² / م³)، عدد الطوابق، أرقام الهواتف، أرقام العقود والعطاءات،
 * وأسماء المشاريع والجهات المعروفة في النظام — ولا تضيف رقماً جديداً لم يرد في الأصل.
 */
const toLatin = (s: string) => s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
const WORD_NUM: Record<string, string> = { "طابقين": "2 طابق", "طابقان": "2 طابق", "ثلاث طوابق": "3 طابق", "ثلاثة طوابق": "3 طابق", "أربع طوابق": "4 طابق", "أربعة طوابق": "4 طابق" };

export type Facts = { numbers: string[]; dims: string[]; phones: string[]; refs: string[]; names: string[] };

export function extractFacts(text: string, knownNames: string[] = []): Facts {
  let t = toLatin(text);
  for (const [w, n] of Object.entries(WORD_NUM)) t = t.split(w).join(n);
  const phones = [...new Set(t.match(/(?:\+?962|0)7[789]\d{7}/g) ?? [])];
  const noPhones = phones.reduce((s, p) => s.split(p).join(" "), t);
  const dims = [...new Set((noPhones.match(/\d+(?:\.\d+)?\s*[×xX*]\s*\d+(?:\.\d+)?/g) ?? []).map((d) => d.replace(/\s+/g, "").replace(/[xX*]/g, "×")))];
  const refs = [...new Set(noPhones.match(/[A-Za-z؀-ۿ]{1,4}\s?\/\s?\d{2,4}\s?\/\s?\d{1,4}|\b[A-Z]{2,5}-\d{2,6}(?:-\d+)?\b/g) ?? [])];
  const numbers = [...new Set(noPhones.replace(/\d+(?:\.\d+)?\s*[×xX*]\s*\d+(?:\.\d+)?/g, " ").match(/\d+(?:[.,]\d+)?/g) ?? [])].map((n) => n.replace(",", "."));
  const names = knownNames.filter((n) => n.length >= 4 && text.includes(n));
  return { numbers, dims, phones, refs, names };
}

export type FactCheck = { ok: boolean; missing: string[]; added: string[] };

/** يقارن الأصل بالصياغة الجديدة: المفقود (يجب أن يكون صفراً) والمضاف (أرقام لم ترد في الأصل) */
export function checkFacts(original: string, rewrite: string, knownNames: string[] = []): FactCheck {
  const a = extractFacts(original, knownNames);
  const b = extractFacts(rewrite, knownNames);
  const has = (list: string[], v: string) => list.includes(v);
  const missing = [
    ...a.phones.filter((p) => !has(b.phones, p)).map((p) => `هاتف ${p}`),
    ...a.dims.filter((d) => !has(b.dims, d)).map((d) => `بُعد ${d}`),
    ...a.refs.filter((r) => !rewrite.includes(r)).map((r) => `مرجع ${r}`),
    ...a.numbers.filter((n) => !has(b.numbers, n) && !b.dims.some((d) => d.split("×").includes(n))).map((n) => `رقم ${n}`),
    ...a.names.filter((n) => !rewrite.includes(n)).map((n) => `اسم «${n}»`),
  ];
  const added = [
    ...b.phones.filter((p) => !has(a.phones, p)).map((p) => `هاتف ${p}`),
    ...b.numbers.filter((n) => !has(a.numbers, n) && !a.dims.some((d) => d.split("×").includes(n))).map((n) => `رقم ${n}`),
  ];
  return { ok: missing.length === 0 && added.length === 0, missing, added };
}

const JO_PLACES = ["عمان", "عمّان", "الزرقاء", "إربد", "اربد", "السلط", "مادبا", "الكرك", "الطفيلة", "معان", "العقبة", "جرش", "عجلون", "المفرق", "الرصيفة", "سحاب", "الجيزة", "ناعور", "دابوق", "عبدون", "خلدا", "الشميساني", "أبو نصير", "طبربور", "الرمثا", "الأغوار", "ذيبان", "الشوبك", "وادي موسى", "البتراء"];
const CLAIM_NUM = /(\d+(?:[.,]\d+)?)\s*(?:%|٪|كيلو|كم|كلم|ملم|مليمتر|ميليمتر|سم|سنتيمتر|سنتمتر|دينار|د\.أ|ألف|مليون|م²|م2|متر|م³|طن|عامل|مشروع|مشاريع|سنة|سنوات|عاماً|عميل|عملاء|فيلا|فلل|شقة|شقق|طابق|طوابق|يوماً قبل)/g;
const STORY_CLAIM = /(مشروع|عميل|صاحب|مالك|وفّرنا|وفرنا|نفّذنا|نفذنا|سلّمنا|سلمنا|أنجزنا|بنينا|موقعنا)/;

/**
 * كشف الاختلاق في محتوى مولَّد من الصفر: أرقام ادعائية (مبالغ، نسب، مساحات، أعداد مشاريع/سنوات)
 * أو مواقع بقصة عمل — لم ترد في «حقائق الشركة». يعيد قائمة الأسباب (فارغة = نظيف).
 */
export function fabricationIssues(text: string, factsText: string): string[] {
  const t = toLatin(text);
  const f = toLatin(factsText);
  const known = new Set(extractFacts(f).numbers);
  const out: string[] = [];
  for (const m of t.matchAll(CLAIM_NUM)) {
    const n = m[1].replace(",", ".");
    if (!known.has(n)) out.push(`رقم غير موثق «${m[0].trim()}»`);
  }
  for (const sentence of t.split(/[.!؟?\n]/)) {
    if (!STORY_CLAIM.test(sentence)) continue;
    for (const p of JO_PLACES) if (sentence.includes(p) && !f.includes(p)) out.push(`موقع غير موثق «${p}»`);
  }
  return [...new Set(out)];
}

// تفقيط المبالغ بالدينار الأردني (فقط ... لا غير) للمستندات الرسمية

const ONES = ["", "واحد", "اثنان", "ثلاثة", "أربعة", "خمسة", "ستة", "سبعة", "ثمانية", "تسعة", "عشرة", "أحد عشر", "اثنا عشر", "ثلاثة عشر", "أربعة عشر", "خمسة عشر", "ستة عشر", "سبعة عشر", "ثمانية عشر", "تسعة عشر"];
const TENS = ["", "", "عشرون", "ثلاثون", "أربعون", "خمسون", "ستون", "سبعون", "ثمانون", "تسعون"];
const HUNDREDS = ["", "مئة", "مئتان", "ثلاثمئة", "أربعمئة", "خمسمئة", "ستمئة", "سبعمئة", "ثمانمئة", "تسعمئة"];

/** رقم من 0 إلى 999 */
function below1000(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  const parts: string[] = [];
  if (h) parts.push(HUNDREDS[h]);
  if (r) {
    if (r < 20) parts.push(ONES[r]);
    else {
      const u = r % 10;
      const t = Math.floor(r / 10);
      parts.push(u ? `${ONES[u]} و${TENS[t]}` : TENS[t]);
    }
  }
  return parts.join(" و");
}

const SCALES: [string, string, string, string][] = [
  ["ألف", "ألفان", "آلاف", "ألفاً"],
  ["مليون", "مليونان", "ملايين", "مليوناً"],
  ["مليار", "ملياران", "مليارات", "ملياراً"],
];

function scaled(g: number, s: [string, string, string, string]) {
  if (g === 1) return s[0];
  if (g === 2) return s[1];
  const r = g % 100;
  if (r >= 3 && r <= 10) return `${below1000(g)} ${s[2]}`;
  if (r >= 11) return `${below1000(g)} ${s[3]}`;
  return `${below1000(g)} ${s[0]}`;
}

export function numberToArabicWords(n: number): string {
  n = Math.floor(Math.abs(n));
  if (n === 0) return "صفر";
  const groups: number[] = [];
  while (n > 0) {
    groups.push(n % 1000);
    n = Math.floor(n / 1000);
  }
  const parts: string[] = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i];
    if (!g) continue;
    parts.push(i === 0 ? below1000(g) : scaled(g, SCALES[i - 1]));
  }
  return parts.join(" و");
}

/** تمييز العدد: 3–10 جمع، 11–99 مفرد منصوب، والمئات والآلاف المكتملة مفرد مجرور */
function counted(n: number, f: { one: string; two: string; plural: string; acc: string; gen: string }) {
  const r = n % 100;
  if (n === 1) return f.one;
  if (n === 2) return f.two;
  if (r === 1 || r === 2) return `${numberToArabicWords(n)} ${f.gen}`;
  if (r >= 3 && r <= 10) return `${numberToArabicWords(n)} ${f.plural}`;
  if (r >= 11) return `${numberToArabicWords(n)} ${f.acc}`;
  // إضافة: «أحد عشر ألف دينار»، «ألفا دينار»، «مليونا دينار»
  const words = numberToArabicWords(n).replace(/(ألف|مليون|مليار)اً$/, "$1").replace(/(ألف|مليون|مليار)ان$/, "$1ا");
  return `${words} ${f.gen}`;
}

const dinarWord = (n: number) => counted(n, { one: "دينار أردني واحد", two: "ديناران أردنيان", plural: "دنانير أردنية", acc: "ديناراً أردنياً", gen: "دينار أردني" });
const filsWord = (n: number) => counted(n, { one: "فلس واحد", two: "فلسان", plural: "فلسات", acc: "فلساً", gen: "فلس" });

/** مثال: 418.5 → «فقط أربعمئة وثمانية عشر ديناراً أردنياً وخمسمئة فلس لا غير» */
export function tafqeetJOD(amount: number): string {
  const neg = amount < 0;
  const abs = Math.abs(Math.round(amount * 1000) / 1000);
  const dinars = Math.floor(abs);
  const fils = Math.round((abs - dinars) * 1000);
  const parts: string[] = [];
  if (dinars) parts.push(dinarWord(dinars));
  if (fils) parts.push(filsWord(fils));
  if (parts.length === 0) parts.push("صفر دينار");
  return `${neg ? "سالب " : ""}فقط ${parts.join(" و")} لا غير`;
}

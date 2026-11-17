/**
 * المؤنسن (Humanizer) — منقول إلى TypeScript من مهارة li-human في linkedin-agent-skill
 * (MIT © 2026 Jake Schincariol — vendor/LICENSE)، مع تكييف كامل للعربية:
 *  - التنظيف الآلي: المحارف الخفية (بصمة النصوص المولّدة)، الطباعة (الشرطة الطويلة، الاقتباسات المعقوفة)، معجم العبارات الجاهزة (إنجليزي + عربي)
 *  - الأنماط البنيوية تُعلَّم ولا تُعاد كتابتها آلياً (تحتاج حكماً بشرياً أو إعادة صياغة بالكاتب الذكي)
 *  - لوحة الفحص الخماسية: التنوع، التحديد، كثافة الحشو، البصمة، الصوت — الحكم = 60% المتوسط + 40% أضعف فحص
 * هذه مؤشرات محلية تقريبية، وليست GPTZero أو غيره، ولا تَعِد بنتيجتها.
 */
import slop from "./vendor/slop.json";

type Lex = { find: string; replace: string };
type Structure = { id: string; name: string; fix: string; re: RegExp };

/** معجم الحشو العربي الشائع في النصوص المولّدة ← بديل طبيعي (فارغ = حذف) */
const AR_LEX: Lex[] = [
  { find: "في عالمنا المتسارع", replace: "اليوم" },
  { find: "في ظل التطورات المتسارعة", replace: "اليوم" },
  { find: "في عصرنا الحالي", replace: "اليوم" },
  { find: "في عصر السرعة", replace: "اليوم" },
  { find: "لا يخفى على أحد أن", replace: "" },
  { find: "مما لا شك فيه أن", replace: "" },
  { find: "تجدر الإشارة إلى أن", replace: "" },
  { find: "من الجدير بالذكر أن", replace: "" },
  { find: "علاوة على ذلك", replace: "وكمان" },
  { find: "فضلاً عن ذلك", replace: "وكمان" },
  { find: "في نهاية المطاف", replace: "بالآخر" },
  { find: "حجر الزاوية", replace: "الأساس" },
  { find: "نقلة نوعية", replace: "فرق واضح" },
  { find: "رحلة استثنائية", replace: "تجربة" },
  { find: "شهادة حية على", replace: "دليل على" },
  { find: "يأخذك في رحلة", replace: "يعرّفك على" },
  { find: "دعونا نستكشف", replace: "خلّينا نشوف" },
  { find: "هل تساءلت يوماً", replace: "فكّرت مرة" },
  { find: "لا مثيل لها", replace: "مميزة" },
  { find: "تجربة لا تُنسى", replace: "تجربة مميزة" },
  { find: "بشكل سلس", replace: "بسهولة" },
  { find: "على حد سواء", replace: "معاً" },
  { find: "يلعب دوراً محورياً", replace: "مهم" },
  { find: "دوراً محورياً", replace: "دوراً مهماً" },
];

/** الأنماط البنيوية العربية (تُضاف لأنماط المهارة الأصلية الإنجليزية) */
const AR_STRUCTURES: Structure[] = [
  { id: "ليس-مجرد", name: "«ليس مجرد X، بل Y»", fix: "قل الشيء الذي تعنيه مباشرة واحذف نصف التمهيد.", re: /ليس(?:ت)? مجرد [^.!؟\n]{2,60}[،,.]? ?بل/g },
  { id: "ليس-فقط", name: "«ليس فقط X بل أيضاً Y»", fix: "قسّمها لجملتين أو احذف الأضعف.", re: /ليس فقط[^.!؟\n]{2,80}بل/g },
  { id: "الأمر-ليس", name: "«الأمر ليس عن X، بل عن Y»", fix: "ابدأ بـ Y مباشرة — الانقلاب هو البصمة.", re: /(?:الأمر|القضية) (?:ليس|ليست) (?:عن|في|مجرد) [^.!؟\n]{2,60}[.!،] ?(?:بل|إنه|إنها)/g },
  { id: "سطر-سؤال", name: "سطر سؤال استعراضي («والنتيجة؟»)", fix: "أجب داخل الجملة بدل تمثيل المفاجأة.", re: /^\s*(?:و?النتيجة|السر|الأجمل|المفاجأة|والأهم)[؟?]\s*$/gm },
  { id: "إليكم", name: "«إليكم ما تعلمناه»", fix: "قل الدرس مباشرة بلا إعلان.", re: /إليك(?:م)? (?:ما تعلمناه|ما تعلمته|السر|الحقيقة)/g },
  { id: "ثلاثية", name: "الثلاثية الإيقاعية (X، Y، وZ.)", fix: "عنصران أو أربعة — الثلاثة إيقاع النموذج الافتراضي.", re: /[؀-ۿ]{2,}، [؀-ۿ]{2,}،? و[؀-ۿ]{2,}[.!]/g },
  { id: "خاتمة-إنشائية", name: "افتتاحية خاتمة إنشائية («في الختام»)", fix: "المنشور لا يحتاج فقرة خاتمة.", re: /^\s*(?:في الختام|ختاماً|خلاصة القول|وفي الختام)/gm },
  { id: "طُعم-تفاعل", name: "طُعم تفاعل تلقائي («ما رأيكم؟»)", fix: "اسأل سؤالاً لا يسأله غيرك، عن الشيء المحدد أعلاه.", re: /(?:ما رأيكم|شاركونا آراءكم|شاركونا رأيكم|من يوافقني|هل توافقون)[؟?]?\s*$/gm },
  { id: "بصفتي-نموذج", name: "إشارة النموذج لنفسه", fix: "احذف الجملة.", re: /بصفتي (?:نموذج|ذكاء اصطناعي)/g },
];

const JS_STRUCTURES: Structure[] = (slop.structures as { id: string; name: string; fix: string; regex: string }[])
  .map((s) => {
    try {
      // تحويل صيغة بايثون: (?i) ← علم i، و\U0001F680 ← \u{1F680}
      const ci = s.regex.startsWith("(?i)");
      const src = s.regex.replace(/^\(\?i\)/, "").replace(/\\U([0-9A-Fa-f]{8})/g, (_, h) => `\\u{${parseInt(h, 16).toString(16)}}`);
      // جدار الوسوم في فيسبوك/إنستغرام: 10+ (لينكدإن 5+)
      const final = s.id === "hashtag-wall" ? "(?:#[\\p{L}\\p{N}_]+[ \\t\\n]*){10,}" : src;
      return { id: s.id, name: s.name, fix: s.id === "hashtag-wall" ? "حتى 9 وسوم في فيسبوك/إنستغرام — الجدار يقلل الثقة." : s.fix, re: new RegExp(final, `g${ci ? "i" : ""}mu`) };
    } catch {
      return null;
    }
  })
  .filter((x): x is Structure => !!x);

const STRUCTURES = [...JS_STRUCTURES, ...AR_STRUCTURES];
const EN_LEX: Lex[] = [...(slop.words as Lex[]), ...(slop.phrases as Lex[])];

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const arabicRatio = (t: string) => (t.match(/[؀-ۿ]/g)?.length ?? 0) / Math.max(1, t.match(/[\p{L}]/gu)?.length ?? 1);

export type CleanResult = { text: string; changes: string[]; flags: { id: string; name: string; fix: string; sample: string }[] };

/** التنظيف الآلي (آمن دائماً): لا يغيّر المعنى، يزيل البصمة الطباعية والحشو */
export function humanizeClean(input: string): CleanResult {
  let text = input;
  const changes: string[] = [];
  // 1) المحارف الخفية — كل محرف تنسيق (Cf) ما عدا محارف الوصل اللازمة للعربية
  const before = text.length;
  text = text.replace(/[​⁠﻿­᠎؜‎‏‪-‮⁦-⁩]|[\u{E0000}-\u{E007F}]/gu, "");
  if (text.length !== before) changes.push(`حُذف ${before - text.length} محرفاً خفياً`);
  const spaces = text.match(/[      ]/g)?.length ?? 0;
  if (spaces) {
    text = text.replace(/[      ]/g, " ");
    changes.push(`${spaces} مسافة خاصة ← مسافة عادية`);
  }
  // 2) الطباعة
  const em = text.match(/\s*—\s*/g)?.length ?? 0;
  if (em) {
    text = text.replace(/\s*—\s*/g, arabicRatio(text) > 0.5 ? "، " : ", ").replace(/([،,])\s*([،,.!؟?])/g, "$2");
    changes.push(`${em} شرطة طويلة ← فاصلة`);
  }
  const typo: [RegExp, string, string][] = [
    [/–/g, "-", "شرطة متوسطة"],
    [/[‘’]/g, "'", "اقتباس مفرد معقوف"],
    [/[“”]/g, '"', "اقتباس مزدوج معقوف"],
    [/…/g, "...", "علامة حذف"],
    [/^\s*•\s*/gm, "- ", "نقطة تعداد"],
  ];
  for (const [re, to, name] of typo) {
    const n = text.match(re)?.length ?? 0;
    if (n) {
      text = text.replace(re, to);
      changes.push(`${n} ${name}`);
    }
  }
  // 3) معجم الحشو (الروابط محمية)
  const urls: string[] = [];
  text = text.replace(/https?:\/\/\S+/g, (u) => `\u0000${urls.push(u) - 1}\u0000`);
  for (const e of [...AR_LEX, ...EN_LEX].sort((a, b) => b.find.length - a.find.length)) {
    const latin = /[A-Za-z]/.test(e.find);
    const re = new RegExp(latin ? `\\b${esc(e.find).replace(/\\ /g, "\\s+")}\\b` : esc(e.find), latin ? "gi" : "g");
    const n = text.match(re)?.length ?? 0;
    if (!n) continue;
    text = text.replace(re, (m) => (latin && m[0] === m[0].toUpperCase() && e.replace ? e.replace[0].toUpperCase() + e.replace.slice(1) : e.replace));
    changes.push(`«${e.find}» ← ${e.replace ? `«${e.replace}»` : "حُذفت"}`);
  }
  text = text.replace(/\u0000(\d+)\u0000/g, (_, i) => urls[Number(i)]).replace(/[ \t]{2,}/g, " ").replace(/ +([،,.!؟?])/g, "$1").replace(/^ +/gm, "");
  return { text, changes, flags: structuralFlags(text) };
}

export function structuralFlags(text: string) {
  const out: CleanResult["flags"] = [];
  for (const s of STRUCTURES) {
    s.re.lastIndex = 0;
    const m = text.match(s.re);
    if (m?.length) out.push({ id: s.id, name: s.name, fix: s.fix, sample: m[0].trim().slice(0, 80) });
  }
  return out;
}

// ───── لوحة الفحص الخماسية ─────
const clamp = (n: number) => Math.max(0, Math.min(100, n));
const scale = (v: number, human: number, machine: number) => (human === machine ? 50 : clamp(((v - machine) / (human - machine)) * 100));
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
const pstdev = (a: number[]) => {
  const m = mean(a);
  return Math.sqrt(mean(a.map((x) => (x - m) ** 2)));
};
const PLACES = /عمّان|عمان|الزرقاء|إربد|اربد|البلقاء|السلط|مادبا|الكرك|الطفيلة|معان|العقبة|المفرق|جرش|عجلون|عبدون|دابوق|خلدا|المزار|الحسا|الشوبك|وادي موسى/g;
const UNITS = /م²|م2|متر|طن|كيس|يوم|أيام|شهر|عامل|طابق|سقف|دونم|سم|ملم|كغ/g;
const PERSON_AR = /(?:^|\s)(?:أنا|انا|نحن|احنا|إحنا|انت|أنت|أنتم|انتو|إنتو)(?=\s|$|[،.!؟])|[؀-ۿ]{2,}(?:نا|كم)(?=\s|$|[،.!؟])/g;
const DIALECT = /(?:^|\s)(?:شو|هيك|هلأ|هسا|هسه|مش|بدك|بدكم|منيح|كتير|عشان|مشان|ليش|وين|إشي|اشي|يعطيكم|تعبنا|خلّينا|خلينا)(?=\s|$|[،.!؟])/g;

export type CheckName = "BURSTINESS" | "SPECIFICITY" | "SLOP" | "FINGERPRINT" | "VOICE";
export const CHECK_LABEL: Record<CheckName, { label: string; hint: string }> = {
  BURSTINESS: { label: "تنوّع الجمل", hint: "البشر ينوّعون طول الجمل بقوة، والنموذج يكتب بإيقاع متساوٍ" },
  SPECIFICITY: { label: "التحديد", hint: "أرقام وأماكن ووحدات ملموسة — الحشو مجرد" },
  SLOP: { label: "خلو من الحشو", hint: "كثافة العبارات الجاهزة" },
  FINGERPRINT: { label: "البصمة الطباعية", hint: "محارف خفية، شرطات طويلة، اقتباسات معقوفة" },
  VOICE: { label: "الصوت البشري", hint: "ضمائر المتكلم والمخاطب، لمسة اللهجة، وغياب الأنماط البنيوية" },
};

export type Detection = { checks: Record<CheckName, { score: number; detail: string }>; overall: number; verdict: "PASS" | "REVIEW" | "FLAGGED"; weakest: CheckName };

export function detect(text: string): Detection {
  const ar = arabicRatio(text) > 0.5;
  // العربية تصل الجمل بالفاصلة كثيراً: «،» حدّ جملة في النص العربي (وتُحسب الجمل القصيرة جداً لأنها جزء من الإيقاع)
  const sents = (text.match(ar ? /[^.!?؟،\n]+[.!?؟،]*/g : /[^.!?؟\n]+[.!?؟]*/g) ?? []).map((s) => s.trim()).filter((s) => s.split(/\s+/).length > (ar ? 1 : 2));
  const words = text.match(/[A-Za-z'؀-ۿ]+/g) ?? [];
  const per100 = 100 / Math.max(1, words.length);
  const checks = {} as Detection["checks"];

  const lens = sents.map((s) => s.split(/\s+/).length);
  if (lens.length < 4) checks.BURSTINESS = { score: 50, detail: "النص قصير للحكم" };
  else {
    const cv = pstdev(lens) / Math.max(1, mean(lens));
    checks.BURSTINESS = { score: scale(cv, 0.7, 0.22), detail: `تباين ${cv.toFixed(2)} عبر ${lens.length} جمل (المطلوب 0.55+)` };
  }

  if (words.length < 25) checks.SPECIFICITY = { score: 50, detail: "النص قصير للحكم" };
  else {
    const nums = text.match(/[0-9٠-٩][0-9٠-٩,.]*%?/g)?.length ?? 0;
    const places = new Set(text.match(PLACES) ?? []).size;
    const units = text.match(UNITS)?.length ?? 0;
    const proper = ar ? 0 : new Set(text.match(/(?<![.!?]\s)\b[A-Z][a-z]{2,}\b/g) ?? []).size;
    const hits = nums + places + units + proper;
    checks.SPECIFICITY = { score: scale(hits * per100, 6, 0.5), detail: `${hits} علامة ملموسة (${nums} أرقام، ${places} أماكن، ${units} وحدات) — ${(hits * per100).toFixed(1)} لكل 100 كلمة` };
  }

  {
    let hits = 0;
    const found: string[] = [];
    for (const e of [...AR_LEX, ...EN_LEX]) {
      const latin = /[A-Za-z]/.test(e.find);
      const n = text.match(new RegExp(latin ? `\\b${esc(e.find).replace(/\\ /g, "\\s+")}\\b` : esc(e.find), latin ? "gi" : "g"))?.length ?? 0;
      if (n) {
        hits += n;
        found.push(e.find);
      }
    }
    checks.SLOP = { score: words.length ? scale(hits * per100, 0, 4) : 50, detail: `${hits} عبارة جاهزة${found.length ? ` (${found.slice(0, 4).join("، ")})` : ""}` };
  }

  {
    const invisible = text.match(/[​⁠﻿­᠎؜‎‏‪-‮⁦-⁩]/g)?.length ?? 0;
    const em = text.match(/—/g)?.length ?? 0;
    const curly = text.match(/[‘’“”]/g)?.length ?? 0;
    const ell = text.match(/…/g)?.length ?? 0;
    const nb = text.match(/[   ]/g)?.length ?? 0;
    const per1k = ((invisible * 4 + em * 2 + curly + ell + nb) * 1000) / Math.max(1, text.length);
    checks.FINGERPRINT = { score: scale(per1k, 0, 12), detail: `${invisible} خفي، ${em} شرطة طويلة، ${curly} اقتباس معقوف، ${ell} حذف، ${nb} مسافة خاصة` };
  }

  if (words.length < 25) checks.VOICE = { score: 50, detail: "النص قصير للحكم" };
  else {
    const flags = structuralFlags(text);
    const person = (ar ? text.match(PERSON_AR)?.length ?? 0 : text.match(/\b(i|me|my|we|us|our|you|your)\b/gi)?.length ?? 0) * per100;
    const casual = (ar ? text.match(DIALECT)?.length ?? 0 : text.match(/\b\w+'(?:s|t|re|ve|ll|d|m)\b/gi)?.length ?? 0) * per100;
    let score = scale(casual, 3, 0) * 0.3 + scale(person, 8, 1) * 0.4 + clamp(100 - flags.length * 22) * 0.3;
    const bullets = (text.match(/^\s*[-*•]\s+(.+)$/gm) ?? []).map((b) => b.split(/\s+/).length);
    const uniform = bullets.length >= 3 && pstdev(bullets) < 1.6;
    if (uniform) score -= 12;
    checks.VOICE = { score: clamp(score), detail: `${person.toFixed(1)} ضمائر شخصية و${casual.toFixed(1)} لمسة عفوية لكل 100 كلمة، ${flags.length} نمط بنيوي${uniform ? "، نقاط متساوية الطول" : ""}` };
  }

  const scores = Object.values(checks).map((c) => c.score);
  const overall = mean(scores) * 0.6 + Math.min(...scores) * 0.4;
  const verdict = overall >= 70 && Math.min(...scores) >= 55 ? "PASS" : overall >= 50 ? "REVIEW" : "FLAGGED";
  const weakest = (Object.keys(checks) as CheckName[]).sort((a, b) => checks[a].score - checks[b].score)[0];
  for (const k of Object.keys(checks) as CheckName[]) checks[k].score = Math.round(checks[k].score);
  return { checks, overall: Math.round(overall), verdict, weakest };
}

export const VERDICT: Record<Detection["verdict"], { label: string; tone: "green" | "orange" | "red" }> = {
  PASS: { label: "صوت بشري — جاهز", tone: "green" },
  REVIEW: { label: "يحتاج مراجعة", tone: "orange" },
  FLAGGED: { label: "بصمة آلية واضحة", tone: "red" },
};

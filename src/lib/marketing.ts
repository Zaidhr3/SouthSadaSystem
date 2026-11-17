import "server-only";
import { db } from "./db";
import { addDays, fmtDate, todayUTC } from "./format";
import { writeJson, type JsonSchema, type Turn } from "./ai/writer";
import { HOOK_PROMPT, HUMAN_RULES, PLAN_PROMPT } from "./content-skills/skills";
import { humanizeClean } from "./content-skills/humanizer";
import { checkFacts, fabricationIssues } from "./content-skills/fact-guard";
import { knownNames } from "./content-skills/known-names";

/**
 * قسم التسويق والعلاقات العامة الذكي:
 *  - استراتيجية النشر: 1–2 منشور دائم أسبوعياً، و1–2 قصة يومياً
 *  - مسار الاقتراح الذكي (يومي/أسبوعي + رادار المناسبات) ومسار فكرة المستخدم
 *  - المحتوى مبني على حقائق الشركة الفعلية من النظام (لا أرقام ولا إنجازات مختلقة)
 */
export const MKT_KIND: Record<string, { label: string; tone: "blue" | "purple" }> = {
  POST: { label: "منشور دائم", tone: "blue" },
  STORY: { label: "قصة يومية", tone: "purple" },
};
export const MKT_CATEGORY: Record<string, string> = {
  ACHIEVEMENT: "إنجازات ومشاريع",
  PROGRESS: "من قلب الموقع",
  TIP: "نصيحة إنشائية",
  BRAND: "هوية وقيم الشركة",
  OFFER: "عروض وخدمات",
  OCCASION: "مناسبة وطنية/دينية",
  CONGRATS: "تهنئة ومباركة",
  CONDOLENCE: "تعزية ونعي",
  DENOUNCE: "استنكار",
  ENGAGEMENT: "تفاعل وأسئلة",
};
export const MKT_STATUS: Record<string, { label: string; tone: "gray" | "blue" | "green" | "orange" | "red" | "purple" }> = {
  SUGGESTED: { label: "مقترح", tone: "gray" },
  IN_REVIEW: { label: "قيد المراجعة", tone: "orange" },
  APPROVED: { label: "معتمد — جاهز للنشر", tone: "blue" },
  PUBLISHED: { label: "منشور", tone: "green" },
  REJECTED: { label: "مرفوض", tone: "red" },
  FAILED: { label: "فشل النشر", tone: "red" },
};
const SENSITIVE = ["CONDOLENCE", "DENOUNCE"];

/** المناسبات الأردنية الثابتة (ميلادي) */
const FIXED: [number, number, string][] = [
  [1, 30, "عيد ميلاد جلالة الملك عبدالله الثاني"],
  [2, 7, "يوم الوفاء والبيعة (ذكرى رحيل الملك الحسين وتولي الملك عبدالله الثاني)"],
  [3, 4, "اليوم العالمي للهندسة"],
  [3, 21, "عيد الأم وذكرى معركة الكرامة"],
  [5, 1, "عيد العمال — تحية لعمال البناء"],
  [5, 25, "عيد الاستقلال الأردني"],
  [6, 9, "ذكرى الجلوس الملكي"],
  [6, 10, "ذكرى الثورة العربية الكبرى ويوم الجيش"],
  [11, 14, "ذكرى ميلاد المغفور له الملك الحسين بن طلال"],
  [12, 31, "نهاية العام الميلادي"],
];
/** المناسبات الهجرية (تُحسب بتقويم أم القرى) */
const HIJRI: [number, number, string][] = [
  [1, 1, "رأس السنة الهجرية"],
  [3, 12, "ذكرى المولد النبوي الشريف"],
  [7, 27, "ذكرى الإسراء والمعراج"],
  [9, 1, "حلول شهر رمضان المبارك"],
  [10, 1, "عيد الفطر السعيد"],
  [12, 9, "يوم عرفة"],
  [12, 10, "عيد الأضحى المبارك"],
];
const hijri = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura", { day: "numeric", month: "numeric", timeZone: "UTC" });

export function occasionsBetween(from: Date, days: number) {
  const out: { date: Date; name: string }[] = [];
  for (let i = 0; i < days; i++) {
    const d = addDays(from, i);
    for (const [m, day, name] of FIXED) if (d.getUTCMonth() + 1 === m && d.getUTCDate() === day) out.push({ date: d, name });
    const p = Object.fromEntries(hijri.formatToParts(d).map((x) => [x.type, x.value]));
    for (const [m, day, name] of HIJRI) if (Number(p.month) === m && Number(p.day) === day) out.push({ date: d, name });
  }
  return out;
}

/** حقائق الشركة الحية من النظام — مادة المحتوى (المنشورات لا تذكر إلا ما هو موجود هنا) */
async function companyFacts() {
  const since = addDays(todayUTC(), -21);
  const [active, done, diaries] = await Promise.all([
    db.tender.findMany({ where: { status: { in: ["EXECUTION", "WON"] }, archiveStage: 0 }, select: { name: true, location: true, progress: true, classification: true }, take: 12 }),
    db.tender.findMany({ where: { OR: [{ status: { in: ["MAINTENANCE", "CLOSED"] } }, { archiveStage: { gt: 0 } }] }, select: { name: true, location: true }, orderBy: { updatedAt: "desc" }, take: 8 }),
    db.siteDiary.findMany({ where: { date: { gte: since } }, select: { date: true, workDone: true, workforce: true, tender: { select: { name: true } } }, orderBy: { date: "desc" }, take: 15 }),
  ]);
  return [
    "الشركة: صدى الجنوب للمقاولات الإنشائية — مقاول أبنية مصنّف بالدرجة الرابعة في الأردن. الشعار: «نبني بثقة، وننفّذ بدقّة، ونسلّم في الموعد».",
    "الخدمات: فلل وسكن خاص، عمارات وإسكانات، هياكل خرسانية، خزانات مياه، بنية تحتية وحفر وهدم، تشطيبات. المناطق: كل محافظات المملكة.",
    "التواصل: واتساب 0781142003 — فيسبوك sadaaljanoob8 — إنستغرام sada_aljanoob — موقع sadaaljanoub-website.vercel.app",
    active.length ? `مشاريع قيد التنفيذ الآن:\n${active.map((t) => `- ${t.name}${t.location ? ` (${t.location})` : ""} — إنجاز ${t.progress}%`).join("\n")}` : "لا توجد مشاريع معلنة قيد التنفيذ حالياً.",
    done.length ? `مشاريع منجزة/مسلّمة:\n${done.map((t) => `- ${t.name}${t.location ? ` (${t.location})` : ""}`).join("\n")}` : "",
    diaries.length ? `آخر أعمال الموقع (يوميات):\n${diaries.map((d) => `- ${fmtDate(d.date)} ${d.tender.name}: ${d.workDone.slice(0, 160)}${d.workforce ? ` (${d.workforce} عامل)` : ""}`).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * دليل التسويق الحديث (2025–2026) لقطاع المقاولات: صيغ المحتوى الأعلى أداءً على فيسبوك وإنستغرام.
 * كل فكرة تختار صيغة محددة منها — لا منشورات «إعلانية» عامة.
 */
const MODERN_PLAYBOOK = `دليل التسويق الحديث — اختر لكل فكرة صيغة محددة واذكرها في visualBrief (بين قوسين في أوله):
• [ريل] فيديو عمودي 15–30 ثانية: خطاف بصري في أول ثانيتين (صبّ، رفع حديد، مقارنة)، نص على الشاشة، صوت الموقع الحقيقي، ونهاية تعيد المشاهدة (loop).
• [قبل/بعد] نفس الزاوية في مرحلتين — أقوى إثبات للعمل الحقيقي.
• [كاروسيل تعليمي] 5–7 شرائح: «أخطاء تكلّف المالك»، «خطوات قبل الصب»، «كيف تقرأ عرض السعر» — قابل للحفظ (Save) وهو أقوى إشارة للخوارزمية.
• [خرافة ضد حقيقة] تصحيح معتقد شائع عند أصحاب البيوت بثقة مهندس.
• [من وراء الكواليس / POV] يوم في الموقع بعين المهندس أو العامل — صدق وبساطة، بلا تمثيل.
• [سلسلة] حلقات بعنوان ثابت ورقم (مثل «دفتر الموقع #3») تبني عادة متابعة.
• [سؤال/تصويت] قصة تفاعلية تجمع رأي الجمهور وتولد رسائل خاصة.
• [عرض بدعوة واضحة] خدمة محددة + سبب للتواصل الآن (معاينة/تسعير مجاني) بلا مبالغة.
• [ثقة] شرح التصنيف، الالتزام بالمخطط، الأمان في الموقع — بالدليل لا بالشعارات.
مبادئ: القيمة قبل البيع (80/20)، خطاف يوقف التمرير في السطر الأول، جملة واحدة لكل فكرة، دعوة فعل واحدة، تحسين للبحث داخل المنصات (كلمات يبحث بها الناس: «مقاول فلل عمان»، «سعر بناء عظم»)، والوسوم 3–6 فقط وذات صلة.`;

const SYSTEM_BASE = `أنت رئيس قسم التسويق والعلاقات العامة في «صدى الجنوب للمقاولات الإنشائية» — كاتب محتوى عربي من الطراز الرفيع يجمع دقة المهندس وبلاغة الأديب وحس صانع العلامات الفاخرة.

الصوت: فخم، واثق، دافئ، أردني الروح، بلا ابتذال ولا مبالغات فارغة. لغة عربية فصيحة سلسة قريبة من الناس (لمسة لهجة أردنية خفيفة مسموحة في القصص). صور بلاغية هندسية مدهشة (الخرسانة، الحديد، الأساسات، الاستقامة، الميزان، الشاقول، صبّ السقف، الأمانة في الكميات).

قواعد صارمة:
1. الحقائق فقط: لا تذكر مشروعاً أو رقماً أو عميلاً أو إنجازاً غير موجود في «حقائق الشركة». إن احتجت مثالاً فاجعله عاماً دون ادعاء.
2. المنشور الدائم (POST): سطر افتتاحي خاطف يوقف التمرير ← قيمة حقيقية أو قصة ← دعوة لفعل واضحة (واتساب/طلب عرض سعر من الموقع) ← 5–9 وسوم (عربية وإنجليزية). الطول 60–160 كلمة.
3. القصة (STORY): نص الشاشة storyText قصير جداً (≤ 12 كلمة) وقوي، مع اقتراح عنصر تفاعلي (تصويت/سؤال/عدّاد/شريط) داخل visualBrief. caption سطر أو سطران.
4. visualBrief: وصف دقيق للمصمم/المصور: اللقطة، الزاوية، الإضاءة، ألوان الهوية (كحلي #0b2545، ذهبي #f2b134، برتقالي #e8590c)، مكان الشعار، النص على الصورة.
5. المناسبات الحساسة (تعزية، نعي، استنكار): رصانة تامة، بلا وسوم تسويقية، بلا دعوة لفعل، بلا رموز تعبيرية، وبصيغة تليق بمؤسسة أردنية محترمة. التهاني الوطنية والدينية: فخر واعتزاز دون تسويق مباشر.
6. التنويع: لا تكرر نفس الافتتاحيات أو الصور بين العناصر. وازن بين: إنجازات، من قلب الموقع، نصيحة إنشائية للمالك، قيم الشركة، تفاعل.
7. كل النصوص بالعربية. الرموز التعبيرية باعتدال في المحتوى العادي فقط.

${HUMAN_RULES}

${HOOK_PROMPT}

${MODERN_PLAYBOOK}`;
const SYSTEM = SYSTEM_BASE;

const ITEM: JsonSchema = {
  type: "object",
  properties: {
    kind: { type: "string", enum: ["POST", "STORY"] },
    category: { type: "string", enum: Object.keys(MKT_CATEGORY) },
    title: { type: "string", description: "عنوان داخلي قصير للفكرة" },
    caption: { type: "string", description: "النص الكامل للنشر" },
    hashtags: { type: "string", description: "الوسوم مفصولة بمسافة، أو فارغ للمحتوى الحساس" },
    storyText: { type: "string", description: "نص الشاشة للقصة (فارغ للمنشور)" },
    visualBrief: { type: "string", description: "توجيه بصري للمصمم بالعربية فقط — 25 إلى 60 كلمة" },
    cta: { type: "string", description: "دعوة الفعل أو فارغ" },
    dayOffset: { type: "integer", description: "اليوم المقترح للنشر: 0 = اليوم ... 6" },
  },
};
type GenItem = { kind: "POST" | "STORY"; category: string; title: string; caption: string; hashtags: string; storyText: string; visualBrief: string; cta: string; dayOffset: number };

async function save(items: GenItem[], source: string, model: string, userId: number | null, idea?: string) {
  const today = todayUTC();
  const rows = [];
  for (const it of items) {
    rows.push(
      await db.marketingItem.create({
        data: {
          kind: it.kind === "STORY" ? "STORY" : "POST",
          source,
          category: it.category in MKT_CATEGORY ? it.category : "BRAND",
          title: it.title.slice(0, 200),
          idea: idea ?? null,
          caption: humanizeClean(it.caption).text,
          hashtags: SENSITIVE.includes(it.category) ? null : it.hashtags || null,
          storyText: it.storyText ? humanizeClean(it.storyText).text : null,
          visualBrief: it.visualBrief || null,
          cta: SENSITIVE.includes(it.category) ? null : it.cta || null,
          scheduledFor: addDays(today, Math.min(Math.max(Math.round(it.dayOffset || 0), 0), 13)),
          aiModel: model,
          createdById: userId,
          chat: [],
        },
      }),
    );
  }
  return rows;
}

/** نص منهار (حلقة تكرار أو خليط إنجليزي عشوائي) — يُرفض ولا يُحفظ */
function looksBroken(i: GenItem) {
  const all = `${i.title} ${i.caption} ${i.storyText}`;
  return !i.caption?.trim() || all.length > 2500 || /[A-Za-z]{2,}(?:\s+[A-Za-z]{2,}){5,}/.test(`${i.title} ${i.caption.replace(/#\S+/g, "")} ${i.storyText}`) || /(.{12,40})\1{3,}/.test(all);
}

/** طلب احتياطي متوازٍ: إن تأخر الأول بدأ ثانٍ (أسرع) — والنتيجة لأول ما ينجح. يحمي من بطء/تعثر النموذج العشوائي. */
const HEDGE_AFTER_MS = 30_000;
function hedged<T>(make: (attempt: number) => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let pending = 0;
    let started = 0;
    let lastErr: unknown;
    const start = () => {
      if (settled || started >= 2) return;
      const n = started++;
      pending++;
      make(n).then(
        (v) => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve(v);
          }
        },
        (e) => {
          lastErr = e;
          pending--;
          if (started < 2) start();
          else if (!pending && !settled) {
            settled = true;
            reject(lastErr);
          }
        },
      );
    };
    const timer = setTimeout(start, HEDGE_AFTER_MS);
    start();
  });
}

/**
 * خطة الأسبوع: منشوران + قصة يومياً + رادار المناسبات.
 * سريعة ومتينة: تُقسم إلى استدعاءات صغيرة متوازية (منشورات / قصص / مناسبات) لكل منها مهلة مستقلة —
 * ما ينجح يُحفظ فوراً، وفشل جزء لا يُسقط الباقي، ولا يتجاوز الزمن الكلي حد الصفحة على Vercel.
 */
export async function suggestWeek(userId: number | null, source: "AI_WEEKLY" | "AI_DAILY" = "AI_WEEKLY", opts: { budgetMs?: number } = {}) {
  const today = todayUTC();
  const days = source === "AI_DAILY" ? 2 : 7;
  const [facts, planned, recent] = await Promise.all([
    companyFacts(),
    db.marketingItem.findMany({ where: { scheduledFor: { gte: today, lt: addDays(today, days + 2) }, status: { notIn: ["REJECTED"] } }, select: { kind: true, title: true, category: true, scheduledFor: true } }),
    db.marketingItem.findMany({ where: { createdAt: { gte: addDays(today, -21) } }, select: { title: true }, orderBy: { id: "desc" }, take: 20 }),
  ]);
  const offset = (d: Date) => Math.round((+d - +today) / 86400000);
  const occ = occasionsBetween(today, days + 2).filter((o) => !planned.some((p) => p.category === "OCCASION" && p.scheduledFor && +p.scheduledFor === +o.date));
  const postsPlanned = planned.filter((p) => p.kind === "POST" && p.scheduledFor && +p.scheduledFor < +addDays(today, days)).length;
  const wantPosts = source === "AI_DAILY" ? 0 : Math.max(0, 2 - postsPlanned);
  const storyDays = Array.from({ length: days }, (_, i) => i).filter((i) => !planned.some((p) => p.kind === "STORY" && p.scheduledFor && +p.scheduledFor === +addDays(today, i)));
  const avoid = [...planned.map((p) => p.title), ...recent.map((r) => r.title)].slice(0, 25).join("؛ ") || "لا شيء";
  const base = `ممنوع منعاً باتاً: قصص عملاء أو مبالغ توفير أو نسب أو مساحات أو أسماء مدن/مواقع أو أعداد (سنوات/مشاريع) غير مذكورة حرفياً في «حقائق الشركة» أدناه. النصيحة الهندسية العامة مسموحة بلا أرقام ادعائية.
اليوم ${fmtDate(today)}.
عناوين مخططة أو حديثة (لا تكررها ولا تكرر زواياها): ${avoid}

حقائق الشركة:
${facts}`;

  type Job = { label: string; prompt: string; effort: "low" | "medium"; max: number; check: (i: GenItem) => boolean };
  const jobs: Job[] = [];
  if (wantPosts > 0)
    jobs.push({ label: "المنشورات", effort: "medium", max: wantPosts, check: (i) => i.kind === "POST", prompt: `اكتب ${wantPosts} منشور دائم (POST) فقط، على أيام متباعدة ضمن dayOffset من 0 إلى ${days - 1} (يفضّل مساء الأحد/الأربعاء أو الجمعة). نوّع الزاوية بين: إنجاز من الحقائق، نصيحة إنشائية للمالك، قيم الشركة، عرض خدمة.

${PLAN_PROMPT}` });
  // القصص قصيرة: دفعات من 4 أيام بالتوازي
  for (let k = 0; k < storyDays.length; k += 4) {
    const chunk = storyDays.slice(k, k + 4);
    jobs.push({ label: "القصص", effort: "low", max: chunk.length, check: (i) => i.kind === "STORY", prompt: `اكتب قصة (STORY) واحدة لكل يوم من الأيام (dayOffset): ${chunk.join("، ")} — ${chunk.length} قصص فقط. storyText ≤ 12 كلمة، caption سطر أو سطران، ونوّع بين: من قلب الموقع، نصيحة سريعة، تفاعل (تصويت/سؤال)، قيم الشركة.` });
  }
  if (occ.length)
    jobs.push({ label: "المناسبات", effort: "low", max: occ.length * 2, check: () => true, prompt: `رادار المناسبات: ${occ.map((o) => `${o.name} بتاريخ ${fmtDate(o.date)} (dayOffset ${offset(o.date)})`).join("؛ ")}.
لكل مناسبة قصة (STORY, category=OCCASION) في يومها، وإن كانت كبرى (الاستقلال، الأعياد، رمضان، الجلوس الملكي، ميلاد الملك) فأضف منشوراً دائماً (POST, category=OCCASION) أيضاً. فخر واعتزاز دون تسويق مباشر.` });
  if (!jobs.length) return [];

  const budget = opts.budgetMs ?? 110_000;
  const results = await Promise.allSettled(
    jobs.map((j) =>
      hedged((n) =>
        writeJson<{ items: GenItem[] }>({
          system: SYSTEM,
          effort: n === 0 ? j.effort : "low",
          timeoutMs: budget - n * HEDGE_AFTER_MS,
          maxTokens: j.label === "المنشورات" ? 9000 : 6000,
          schema: { type: "object", properties: { items: { type: "array", items: ITEM } } },
          turns: [{ role: "user", text: `${j.prompt}

${base}` }],
        }).then((r) => {
          const all = (r.data.items ?? []).filter((i) => j.check(i) && !looksBroken(i));
          // حارس الاختلاق: أي رقم ادعائي أو موقع عمل غير موجود في حقائق الشركة يُسقط العنصر
          const ok = all.filter((i) => {
            const bad = fabricationIssues(`${i.caption}
${i.storyText}`, facts);
            if (bad.length) console.warn("[marketing] dropped fabricated:", i.title, bad);
            return !bad.length;
          });
          if (!ok.length) throw new Error(all.length ? "صاغ النموذج أرقاماً أو مواقع غير موثقة فرُفضت — أُعيدت المحاولة" : "أرجع النموذج نصاً غير صالح — أُعيدت المحاولة");
          return { items: ok, model: r.model };
        }),
      ).then(({ items, model }) => save(items.slice(0, j.max), source, model, userId)),
    ),
  );
  const rows = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  const failed = results.map((r, i) => (r.status === "rejected" ? `${jobs[i].label}: ${r.reason instanceof Error ? r.reason.message : r.reason}` : null)).filter(Boolean) as string[];
  if (!rows.length && failed.length) throw new Error(failed[0]);
  if (failed.length) console.warn("[marketing] partial plan:", failed);
  return Object.assign(rows, { failed });
}

/** مسار فكرة المستخدم: يحوّل فكرة حرة إلى منشور أو قصة (أو الاثنين) */
/** توليد سريع لعناصر قليلة: طلب احتياطي متوازٍ + رفض النص المنهار والأرقام غير الموجودة في المصدر */
async function quickItems(source: string, opts: { turns: Turn[] }) {
  return hedged((n) =>
    writeJson<{ items: GenItem[] }>({
      system: SYSTEM,
      effort: n === 0 ? "medium" : "low",
      timeoutMs: 90_000 - n * HEDGE_AFTER_MS,
      maxTokens: 7000,
      schema: { type: "object", properties: { items: { type: "array", items: ITEM } } },
      turns: opts.turns,
    }).then((r) => {
      const items = (r.data.items ?? []).filter((i) => !looksBroken(i) && !fabricationIssues(`${i.caption}
${i.storyText}`, source).length);
      if (!items.length) throw new Error("صاغ النموذج نصاً غير صالح أو بأرقام غير موثقة — أُعيدت المحاولة");
      return { data: { items }, model: r.model };
    }),
  );
}

/**
 * عصف الأفكار السريع: 6 أفكار مبتكرة بصيغ حديثة مختلفة (ريل، قبل/بعد، كاروسيل، خرافة/حقيقة، كواليس، سلسلة...)
 * باستدعاءين متوازيين سريعين (~10 ثوانٍ) — تُحفظ كمقترحات للمراجعة، ومحمية بحارس الاختلاق.
 */
export async function brainstorm(focus: string, userId: number) {
  const [facts, recent] = await Promise.all([companyFacts(), db.marketingItem.findMany({ where: { createdAt: { gte: addDays(todayUTC(), -30) } }, select: { title: true }, orderBy: { id: "desc" }, take: 30 })]);
  const avoid = recent.map((r) => r.title).join("؛ ") || "لا شيء";
  const angles = [
    "ريل، قبل/بعد، كاروسيل تعليمي",
    "خرافة ضد حقيقة، من وراء الكواليس/POV، سلسلة بعنوان ثابت",
  ];
  const results = await Promise.allSettled(
    angles.map((a) =>
      hedged((n) =>
        writeJson<{ items: GenItem[] }>({
          system: SYSTEM,
          effort: n === 0 ? "high" : "low",
          timeoutMs: 80_000 - n * HEDGE_AFTER_MS,
          maxTokens: 7000,
          schema: { type: "object", properties: { items: { type: "array", items: ITEM } } },
          turns: [
            {
              role: "user",
              text: `عصف أفكار: 3 أفكار مبتكرة وغير متوقعة بالصيغ: ${a} (فكرة لكل صيغة). ${focus ? `التركيز المطلوب: «${focus}».` : "اختر أقوى الزوايا من الحقائق."}
كل فكرة كاملة جاهزة: kind=POST (أو STORY إن كانت تفاعلية)، خطاف أول سطر يوقف التمرير، caption كامل، visualBrief يبدأ بالصيغة بين قوسين ويصف اللقطات بدقة، dayOffset من 0 إلى 6.
ممنوع: أي رقم أو مبلغ أو موقع أو قصة عميل غير موجودة حرفياً في الحقائق. لا تكرر هذه العناوين: ${avoid}

حقائق الشركة:
${facts}`,
            },
          ],
        }).then((r) => {
          const ok = (r.data.items ?? []).filter((i) => !looksBroken(i) && !fabricationIssues(`${i.caption}\n${i.storyText}`, facts).length);
          if (!ok.length) throw new Error("أفكار غير صالحة — أُعيدت المحاولة");
          return { items: ok.slice(0, 3), model: r.model };
        }),
      ).then(({ items, model }) => save(items, "AI_IDEA", model, userId, focus || undefined)),
    ),
  );
  const rows = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  if (!rows.length) {
    const e = results.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
    throw e?.reason instanceof Error ? e.reason : new Error("تعذر توليد الأفكار");
  }
  return rows;
}

export async function fromIdea(idea: string, kind: "POST" | "STORY" | "BOTH", userId: number) {
  const facts = await companyFacts();
  const { data, model } = await quickItems(`${facts}
${idea}`, {
    turns: [{ role: "user", text: `فكرة من إدارة الشركة: «${idea}»\nحوّلها إلى ${kind === "BOTH" ? "منشور دائم واحد + قصة واحدة مكمّلة" : kind === "POST" ? "منشور دائم واحد" : "قصة واحدة"} بأعلى مستوى إبداعي ممكن. إن كانت الفكرة مناسبة حساسة (تعزية/نعي/استنكار) فالتزم بقواعد الرصانة. dayOffset = 0 ما لم تحدد الفكرة موعداً.\n\nحقائق الشركة:\n${facts}` }],
  });
  return save((data.items ?? []).slice(0, 2), "USER", model, userId, idea);
}

/** رادار الأحداث الطارئة: تهنئة/مباركة، تعزية/نعي، استنكار — بنص الحدث كما يُدخله المستخدم */
export async function eventPost(type: "CONGRATS" | "CONDOLENCE" | "DENOUNCE", details: string, userId: number) {
  const { data, model } = await quickItems(details, {
    turns: [{ role: "user", text: `حدث يتطلب موقفاً رسمياً من الشركة — النوع: ${MKT_CATEGORY[type]}.\nالتفاصيل كما وردت: «${details}»\nاكتب منشوراً دائماً (category=${type}) وقصة مرافقة (category=${type}). التزم حرفياً بالأسماء والصفات الواردة في التفاصيل ولا تضف معلومات غير مذكورة.` }],
  });
  return save((data.items ?? []).slice(0, 2).map((i) => ({ ...i, category: type })), "AI_EVENT", model, userId, details);
}

/** المحادثة على عنصر: تعديل بالتوجيه، ويُحفظ سجل المحادثة */
export async function refineItem(itemId: number, message: string, userName: string) {
  const it = await db.marketingItem.findUnique({ where: { id: itemId } });
  if (!it) throw new Error("العنصر غير موجود");
  const history = (Array.isArray(it.chat) ? it.chat : []) as { role: "user" | "assistant"; text: string; at: string; by?: string }[];
  const current = JSON.stringify({ kind: it.kind, category: it.category, title: it.title, caption: it.caption, hashtags: it.hashtags ?? "", storyText: it.storyText ?? "", visualBrief: it.visualBrief ?? "", cta: it.cta ?? "" });
  const turns: Turn[] = [
    { role: "user", text: `هذا هو المحتوى الحالي (JSON):\n${current}\n\nسأطلب تعديلات أو أسألك عنه. في كل رد: أعد النسخة الكاملة المحدثة من الحقول، ورداً قصيراً (reply) تشرح فيه ما غيّرت ولماذا.` },
    { role: "assistant", text: "تمام — جاهز لتعديلاتك." },
    ...history.slice(-10).map((h) => ({ role: h.role, text: h.text })),
    { role: "user", text: message },
  ];
  const names = await knownNames();
  const { data, model } = await writeJson<GenItem & { reply: string }>({
    system: SYSTEM,
    effort: "medium",
    schema: { type: "object", properties: { ...ITEM.properties, reply: { type: "string" } } },
    turns,
  });
  const now = new Date().toISOString();
  // حارس الحقائق: تحذير في المحادثة إن تغيّر رقم أو اسم (قد يكون بطلبك — راجعه)
  const fc = data.caption ? checkFacts(it.caption, data.caption, names) : { ok: true, missing: [], added: [] };
  const factNote = fc.ok ? "" : `

⚠️ حارس الحقائق: ${[fc.missing.length ? `مفقود: ${fc.missing.join("، ")}` : "", fc.added.length ? `مضاف: ${fc.added.join("، ")}` : ""].filter(Boolean).join(" | ")}`;
  await db.marketingItem.update({
    where: { id: itemId },
    data: {
      kind: data.kind === "STORY" ? "STORY" : "POST",
      category: data.category in MKT_CATEGORY ? data.category : it.category,
      title: data.title || it.title,
      caption: data.caption ? humanizeClean(data.caption).text : it.caption,
      hashtags: data.hashtags || null,
      storyText: data.storyText || null,
      visualBrief: data.visualBrief || null,
      cta: data.cta || null,
      aiModel: model,
      status: it.status === "SUGGESTED" ? "IN_REVIEW" : it.status,
      chat: [...history, { role: "user", text: message, at: now, by: userName }, { role: "assistant", text: data.reply + factNote, at: now }],
    },
  });
  return data.reply + factNote;
}

import "server-only";
import hooksFile from "./vendor/hooks.json";
import { humanizeClean, structuralFlags } from "./humanizer";
import { writeJson } from "../ai/writer";
import { checkFacts } from "./fact-guard";
import { knownNames } from "./known-names";

/**
 * مهارات المحتوى الإحدى عشرة — مكيّفة من linkedin-agent-skill (MIT © 2026 Jake Schincariol)
 * لمنصات صدى الجنوب (فيسبوك وإنستغرام) وللعربية. كل مخرَج يمر بالمؤنسن قبل عرضه (كما تشترط li-post).
 */
type Hook = { id: number; name: string; template: string; example: string; best_for: string; trap: string };
export const HOOKS = hooksFile.hooks as Hook[];
const HOOK_AR: Record<number, string> = {
  1: "الرأي المعاكس", 2: "كشف الرقم", 3: "اعتراف بخطأ", 4: "قبل / بعد", 5: "وعد القائمة", 6: "سرّ من الداخل", 7: "النداء المباشر", 8: "فخ السؤال", 9: "افتتاحية قصة", 10: "الإيصال (الدليل)", 11: "كسر خرافة",
  12: "المقارنة", 13: "إذن بالتصرف", 14: "كسر النمط", 15: "التحذير", 16: "جيد مقابل ممتاز", 17: "مرساة الزمن", 18: "القاعدة غير الشعبية", 19: "فجوة الفضول", 20: "الانسحاب", 21: "القيمة المباشرة",
};
export const hookName = (id: number) => `#${id} ${HOOK_AR[id] ?? HOOKS.find((h) => h.id === id)?.name ?? ""}`;
const HOOK_GUIDE = HOOKS.map((h) => `#${h.id} ${HOOK_AR[h.id]} (${h.name}): ${h.template} — مناسبة لـ: ${h.best_for} — الفخ: ${h.trap}`).join("\n");
const HOOK_RULES = (hooksFile.rules as string[]).join(" | ");

/** قواعد المؤنسن تُحقن في كل توليد (تمنع البصمة من الأساس بدل تنظيفها لاحقاً) */
export const HUMAN_RULES = `قواعد الصوت البشري (مهارة li-human):
- ممنوع الشرطة الطويلة «—» والاقتباسات المعقوفة والمحارف الخفية.
- ممنوع الحشو الجاهز: «في عالمنا المتسارع»، «لا يخفى على أحد»، «علاوة على ذلك»، «حجر الزاوية»، «نقلة نوعية»، «رحلة استثنائية»، «يلعب دوراً محورياً»، «تجدر الإشارة».
- ممنوع الأنماط البنيوية: «ليس مجرد X بل Y»، «ليس فقط... بل أيضاً»، الثلاثيات الإيقاعية (X، Y، وZ)، سطر سؤال استعراضي («والنتيجة؟»)، «في الختام»، طُعم التفاعل العام («ما رأيكم؟»)، رموز 🚀🔥💡✨🎯.
- نوّع طول الجمل بقوة: جملة من ثلاث كلمات ثم جملة طويلة.
- ارفع التحديد: أرقام، أماكن، كميات، أيام، أسماء مشاريع (من الحقائق فقط).
- صوت متكلم (نحن/احنا) يخاطب القارئ (إنت/إنتو)، ولمسة أردنية خفيفة حيث تناسب.`;

export const HOOK_PROMPT = `صيغ الخطاف الـ21 (مهارة li-post) — اختر الأنسب لكل فكرة ونوّع بينها:\n${HOOK_GUIDE}\nقواعد الخطاف: ${HOOK_RULES}\nشكل المنشور: السطر 1 خطاف وحده (يصمد عند القص ~140 حرفاً) ← السطر 2 مكافأة الخطاف لا تمهيد ← فقرات قصيرة 1–3 أسطر بينها سطر فارغ ← سطر «الانعطافة» يعيد تأطير ما سبق ← خاتمة: سؤال محدد واحد أو توجيه واحد، لا الاثنان.`;

export const PLAN_PROMPT = `منهجية الخطة الأسبوعية (مهارة li-plan): نوّع الأنواع ولا تكرر نوعين متتاليين — دليل/إنجاز برقم (أسبوعياً)، رأي مهني جريء (أسبوعياً)، تعليم: شيء يفعله المالك اليوم (أسبوعياً)، قصة: مشهد بحوار وكلفة (كل أسبوعين)، عرض: ما نبيعه بوضوح بلا اعتذار (كل أسبوعين). لكل عنصر زاوية محددة مما حدث فعلاً لا موضوعاً عاماً، ورقم صيغة الخطاف المناسبة. أفضل أوقات جمهور المالكين في الأردن: المساء 8–10 والجمعة صباحاً — والسطر الأول أهم من التوقيت.`;

export type SkillId = "humanize" | "hooks" | "post" | "carousel" | "ads" | "repurpose" | "reply" | "comment" | "dm" | "inbox" | "audit" | "profile";
export type SkillDef = { id: SkillId; source: string; name: string; desc: string; scope: "item" | "free"; inputLabel?: string; placeholder?: string };

export const SKILLS: SkillDef[] = [
  { id: "humanize", source: "li-human", name: "المؤنسن", desc: "يعيد كتابة الأسطر الموسومة بالبصمة الآلية مع الحفاظ على المعنى، ثم يفحص بالخماسية", scope: "item" },
  { id: "hooks", source: "li-post", name: "3 خطافات بديلة", desc: "ثلاث افتتاحيات من ثلاث صيغ مختلفة من الـ21، مع ترشيح الأقوى", scope: "item" },
  { id: "post", source: "li-post", name: "إعادة البناء كمنشور", desc: "خطاف ← مكافأة ← فقرات قصيرة ← انعطافة ← خاتمة واحدة", scope: "item" },
  { id: "ads", source: "ad-creative + ads-copy-ar", name: "إعلان ممول عربي + إنجليزي", desc: "5 زوايا إعلانية (مباشر، ألم، نتيجة، فضول، قصير UGC) بنسخة عربية وإنجليزية، مع عناوين Meta ونصوص CTA والجمهور المقترح — من الحقائق فقط", scope: "item" },
  { id: "carousel", source: "li-carousel", name: "كاروسيل إنستغرام", desc: "يحوّل الفكرة إلى شرائح متسلسلة (غلاف، شرائح، خاتمة) مع نص كل شريحة وتوجيهها البصري", scope: "item" },
  { id: "repurpose", source: "li-repurpose", name: "إعادة التدوير", desc: "يستخرج من نص طويل (محضر، مقابلة، تقرير) ادعاءات وأرقاماً وقصصاً تصلح 4–6 منشورات للأسبوع", scope: "free", inputLabel: "النص الطويل", placeholder: "الصق محضر اجتماع، تقرير موقع، مقابلة..." },
  { id: "reply", source: "li-reply", name: "الرد على التعليقات", desc: "يفرز تعليقات منشورنا (عميل محتمل، مضمون، زميل، دعم، إزعاج) ويكتب رداً لكل فئة", scope: "free", inputLabel: "التعليقات", placeholder: "الصق التعليقات مع أسماء أصحابها" },
  { id: "comment", source: "li-comment", name: "تعليق على منشور جهة أخرى", desc: "تعليق يضيف قيمة على منشور شريك أو جهة رسمية أو عميل — بلا ترويج", scope: "free", inputLabel: "المنشور", placeholder: "الصق المنشور الذي نريد التعليق عليه واسم الجهة" },
  { id: "dm", source: "li-dm", name: "رسالة خاصة", desc: "رسالة أولى أو متابعة لعميل محتمل أو شريك، قصيرة وشخصية بلا بيع مباشر", scope: "free", inputLabel: "لمن ولماذا", placeholder: "مثال: مالك أرض في دابوق سأل عن سعر عظم فيلا قبل أسبوعين ولم يرد" },
  { id: "inbox", source: "li-inbox", name: "فرز صندوق الرسائل", desc: "يفرز رسائل ماسنجر/إنستغرام حسب الأولوية ويقترح الرد لكل منها", scope: "free", inputLabel: "الرسائل", placeholder: "الصق الرسائل الواردة" },
  { id: "audit", source: "li-audit", name: "تدقيق الأداء", desc: "من أرقام منشوراتنا (وصول، تفاعل، تعليقات): ما الذي ينجح فعلاً ولماذا — بالدليل", scope: "free", inputLabel: "أرقام المنشورات", placeholder: "كل منشور: النص المختصر، الوصول، التفاعلات، التعليقات، المشاركات" },
  { id: "profile", source: "li-profile", name: "تدقيق نبذة الصفحة", desc: "يقيّم نبذة صفحة فيسبوك/إنستغرام ويكتب نسخة أقوى", scope: "free", inputLabel: "النبذة الحالية", placeholder: "الصق نبذة الصفحة الحالية" },
];

const FREE_TASK: Partial<Record<SkillId, string>> = {
  repurpose: "استخرج ولا تلخّص: عدّ الادعاءات والأرقام والقصص والآليات والأخطاء والجمل القابلة للاقتباس، ثم ابنِ أسبوعاً: كل مستخرج منشور قائم بذاته، مع رقم صيغة خطاف مختلفة لكل واحد، الأقوى أولاً والقصة منتصف الأسبوع. إن كان النص فقيراً (أقل من 4 مستخرجات) قل ذلك صراحة.",
  reply: "افرز كل تعليق في واحدة من خمس: عميل محتمل (جواب حقيقي + باب مفتوح بجملة)، مضمون (أطول رد)، زميل/جهة (رد يعطيهم شيئاً)، دعم («يعطيك العافية» ونحوها: رد 3–8 كلمات)، إزعاج (لا شيء). اذكر العدد لكل فئة ثم الردود بالترتيب. استخدم الاسم مرة واحدة بلا علامة تعجب، وطابق طول التعليق، وللناقد: اعترف بالجزء الصحيح بكلماته ثم اثبت على ما تراه.",
  comment: "تعليق واحد قوي (2–4 أسطر) يضيف معلومة أو تجربة من الموقع، باسم الشركة، بلا ترويج ولا روابط. ثم بديلان أقصر.",
  dm: "رسالة أولى قصيرة (≤ 60 كلمة) شخصية تذكر سبب التواصل المحدد، بلا عرض سعر ولا ضغط، وتنتهي بسؤال واحد سهل. ثم رسالة متابعة بعد 4 أيام إن لم يرد.",
  inbox: "صنّف كل رسالة: عاجل (عميل جاهز)، فرصة (استفسار جاد)، متابعة، عام، إزعاج. رتّبها بالأولوية واقترح رداً جاهزاً لكل واحدة غير الإزعاج.",
  audit: "احسب لكل منشور: معدل التفاعل = (تفاعلات+تعليقات+مشاركات)/الوصول، ونسبة التعليقات = تعليقات/تفاعلات. رتّب حسب المعدل لا الوصول. قارن الأعلى 5 بالأدنى 5 وابحث عن الفارق: صيغة الخطاف، الشكل، الطول، الموضوع، ثم التوقيت أخيراً. صرّح بدرجة الثقة؛ مع أقل من 10 منشورات قل إن النمط غير مؤكد.",
  profile: "قيّم النبذة من 100 على: الوضوح (ماذا نبني ولمن)، الدليل (تصنيف، مشاريع، أرقام)، الثقة، دعوة الفعل (واتساب/موقع)، الطول المناسب للمنصة. ثم اكتب نبذة جديدة لفيسبوك (≤ 255 حرفاً) ولإنستغرام (≤ 150 حرفاً).",
};

export type SkillOutput = { text: string; caption?: string; options?: { label: string; text: string }[]; factWarning?: string };

/** يمرّر ناتج المهارات على العنصر بحارس الحقائق ويرفق تحذيراً واضحاً إن فُقد أو أُضيف رقم أو اسم */
async function guard(original: string | undefined, out: SkillOutput): Promise<SkillOutput> {
  if (!original) return out;
  const names = await knownNames();
  const texts = [out.caption, ...(out.options ?? []).map((o) => o.text)].filter(Boolean) as string[];
  const issues = texts.map((t) => checkFacts(original, t, names)).filter((c) => !c.ok);
  if (!issues.length) return out;
  const c = issues[0];
  return { ...out, factWarning: `حارس الحقائق: ${c.missing.length ? `مفقود: ${c.missing.join("، ")}` : ""}${c.missing.length && c.added.length ? " — " : ""}${c.added.length ? `مضاف غير موجود بالأصل: ${c.added.join("، ")}` : ""}. راجع قبل الاعتماد.` };
}

const SYS = `أنت فريق المحتوى في «صدى الجنوب للمقاولات الإنشائية» (مقاول أبنية مصنف رابعة في الأردن، يعمل للمالكين والجهات). تكتب بالعربية لفيسبوك وإنستغرام.\nحافظ حرفياً على كل رقم وبُعد ومساحة وعدد طوابق وهاتف واسم مشروع أو جهة أو رقم عقد ورد في المدخل. ممنوع منعاً باتاً اختلاق أي واقعة أو سبب أو رقم أو اسم غير موجود في المدخل (خاصة في الردود على الشكاوى): ما لا تعرفه اتركه فراغاً بين معقوفين ليملأه الموظف، مثل [سبب التأخير الفعلي]، أو اعرض التواصل على الخاص.\n${HUMAN_RULES}`;

export async function runSkill(id: SkillId, input: { caption?: string; kind?: string; text?: string }): Promise<SkillOutput> {
  const out = await runSkillRaw(id, input);
  return id === "humanize" || id === "hooks" || id === "post" || id === "ads" ? guard(input.caption, out) : out;
}

async function runSkillRaw(id: SkillId, input: { caption?: string; kind?: string; text?: string }): Promise<SkillOutput> {
  if (id === "humanize") {
    const pre = humanizeClean(input.caption ?? "");
    const flags = structuralFlags(pre.text);
    const { data } = await writeJson<{ caption: string; notes: string }>({
      system: SYS,
      effort: "medium",
      schema: { type: "object", properties: { caption: { type: "string" }, notes: { type: "string", description: "ما الذي غيّرته باختصار" } } },
      turns: [{ role: "user", text: `أعد كتابة هذا النص ليبدو بشرياً بالكامل مع الحفاظ على المعنى والطول التقريبي والوسوم:\n\n${pre.text}\n\nالأنماط الموسومة التي يجب إعادة كتابتها بيدك:\n${flags.map((f) => `- ${f.name}: «${f.sample}» — ${f.fix}`).join("\n") || "- لا أنماط بنيوية؛ ركّز على تنويع طول الجمل والتحديد والصوت"}` }],
    });
    const out = humanizeClean(data.caption);
    return { caption: out.text, text: `${data.notes}${pre.changes.length || out.changes.length ? `\nتنظيف آلي: ${[...pre.changes, ...out.changes].join("، ")}` : ""}` };
  }
  if (id === "hooks") {
    const { data } = await writeJson<{ options: { formula: number; hook: string }[]; pick: number; why: string }>({
      system: `${SYS}\n${HOOK_PROMPT}`,
      effort: "medium",
      schema: { type: "object", properties: { options: { type: "array", items: { type: "object", properties: { formula: { type: "integer" }, hook: { type: "string" } } } }, pick: { type: "integer", description: "رقم الخيار الأفضل 1-3" }, why: { type: "string" } } },
      turns: [{ role: "user", text: `اقترح 3 خطافات (سطر أول) لهذا ${input.kind === "STORY" ? "القصة" : "المنشور"} من 3 صيغ مختلفة فعلاً، كل خطاف ≤ 140 حرفاً، من الحقائق الموجودة في النص فقط:\n\n${input.caption}` }],
    });
    const body = (input.caption ?? "").split("\n").slice(1).join("\n").trim();
    return {
      text: `الترشيح: الخيار ${data.pick} — ${data.why}`,
      options: (data.options ?? []).slice(0, 3).map((o) => ({ label: hookName(o.formula), text: humanizeClean(`${o.hook}\n${body}`).text })),
    };
  }
  if (id === "ads") {
    const { data } = await writeJson<{ angles: { angle: string; ar: string; en: string; headlineAr: string; headlineEn: string; cta: string }[]; audience: string; notes: string }>({
      system: `${SYS}
أنت أيضاً كاتب إعلانات Direct Response محترف بالعربية والإنجليزية لإعلانات Meta الممولة (مهارتا ad-creative وads-copy-ar).
البنية لكل إعلان: Hook قوي ← المشكلة ← الوعد/الحل ← الإثبات (من الحقائق فقط) ← CTA واحد.
حدود Meta: النص الأساسي يظهر منه ~125 حرفاً قبل «المزيد» فاجعل أول سطر يكفي وحده؛ العنوان ≤ 40 حرفاً.
الإنجليزية ليست ترجمة حرفية: اكتبها لقارئ إنجليزي (مغتربون، شركات، جهات) بنفس الحقائق.
ممنوع الوعود غير القابلة للإثبات والأرقام المختلقة.`,
      effort: "medium",
      schema: {
        type: "object",
        properties: {
          angles: { type: "array", items: { type: "object", properties: { angle: { type: "string" }, ar: { type: "string" }, en: { type: "string" }, headlineAr: { type: "string" }, headlineEn: { type: "string" }, cta: { type: "string", description: "زر Meta المقترح: WHATSAPP_MESSAGE أو LEARN_MORE أو GET_QUOTE أو CALL_NOW" } }, required: ["angle", "ar", "en", "headlineAr", "headlineEn", "cta"] } },
          audience: { type: "string", description: "الجمهور المقترح للاستهداف (المناطق، الأعمار، الاهتمامات) بجملتين" },
          notes: { type: "string", description: "أي زاوية تبدأ بها ولماذا" },
        },
        required: ["angles", "audience", "notes"],
      },
      turns: [{ role: "user", text: `اكتب 5 إعلانات ممولة بالزوايا: مباشر للبيع، الألم، النتيجة، الفضول، قصير جداً بأسلوب UGC — من هذا المحتوى فقط:

${input.caption}` }],
    });
    return {
      text: `الجمهور المقترح: ${data.audience}
${data.notes}`,
      options: (data.angles ?? []).slice(0, 5).map((a) => ({ label: `${a.angle} · ${a.cta}`, text: humanizeClean(`${a.headlineAr}
${a.ar}

— English —
${a.headlineEn}
${a.en}`).text })),
    };
  }
  if (id === "post" || id === "carousel") {
    const { data } = await writeJson<{ caption: string; notes: string }>({
      system: `${SYS}\n${HOOK_PROMPT}`,
      effort: "medium",
      schema: { type: "object", properties: { caption: { type: "string" }, notes: { type: "string" } } },
      turns: [
        {
          role: "user",
          text:
            id === "post"
              ? `أعد بناء هذا النص كمنشور فيسبوك/إنستغرام بالشكل المطلوب (600–1,100 حرف)، بنفس الحقائق والوسوم، واذكر في notes رقم صيغة الخطاف المستخدمة:\n\n${input.caption}`
              : `حوّل هذا إلى كاروسيل إنستغرام من 6–8 شرائح. اكتب في caption: «الشريحة 1 (الغلاف): ...» ثم كل شريحة بسطر عنوان + سطرين كحد أقصى + توجيه بصري قصير بين قوسين، ثم سطر فارغ ونص المنشور المرافق. الشريحة الأخيرة: دعوة فعل واحدة.\n\n${input.caption}`,
        },
      ],
    });
    return { caption: humanizeClean(data.caption).text, text: data.notes };
  }
  const { data } = await writeJson<{ result: string }>({
    system: `${SYS}\n${HOOK_PROMPT}`,
    effort: "medium",
    schema: { type: "object", properties: { result: { type: "string", description: "الناتج كاملاً جاهزاً للنسخ، بعناوين واضحة" } } },
    turns: [{ role: "user", text: `${FREE_TASK[id]}\n\nالمدخل:\n${input.text}` }],
  });
  return { text: humanizeClean(data.result).text };
}

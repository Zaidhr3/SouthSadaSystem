import "server-only";
import { randomInt } from "crypto";
import { db } from "./db";
import { notify } from "./notify";
import { writeJson, writerConfigured } from "./ai/writer";

/**
 * طلبات التسعير الواردة من موقع الشركة:
 *   فحص ذكي للطلبات الوهمية ← مدير المشروع (دراسة وتسعير) ← المحاسب (تدقيق: قبول أو إرجاع للتعديل) ← الإدارة (اعتماد نهائي أو رفض)
 */
export const QUOTE_STATUS: Record<string, { label: string; tone: "gray" | "blue" | "purple" | "orange" | "green" | "red" }> = {
  PM_REVIEW: { label: "لدى مدير المشروع — دراسة وتسعير", tone: "blue" },
  RETURNED: { label: "مُعاد من المحاسب للتعديل", tone: "orange" },
  ACCOUNTANT_REVIEW: { label: "لدى المحاسب — تدقيق", tone: "purple" },
  ADMIN_REVIEW: { label: "لدى الإدارة — اعتماد نهائي", tone: "purple" },
  APPROVED: { label: "معتمد", tone: "green" },
  REJECTED: { label: "مرفوض", tone: "red" },
  SPAM: { label: "طلب وهمي (محجوز)", tone: "gray" },
};
export const OPEN_QUOTE = ["PM_REVIEW", "RETURNED", "ACCOUNTANT_REVIEW", "ADMIN_REVIEW"];

export type RfqInput = { name: string; phone: string; email?: string | null; type: string; city?: string | null; area?: string | null; details: string; offer?: string | null; honeypot?: string | null; elapsedMs?: number };

const JO_MOBILE = /^(?:\+?962|00962|0)?7[789]\d{7}$/;
const toLatin = (s: string) => s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
export const normalizePhone = (p: string) => {
  const d = toLatin(p).replace(/[^\d+]/g, "");
  const m = d.match(/7[789]\d{7}$/);
  return m ? `0${m[0]}` : d;
};

/** درجة الاشتباه (0–100+) مع الأسباب — قواعد ثابتة سريعة، ثم رأي الذكاء الاصطناعي للحالات الرمادية */
export async function spamCheck(input: RfqInput, ip: string | null) {
  let score = 0;
  const reasons: string[] = [];
  const add = (n: number, why: string) => {
    score += n;
    reasons.push(why);
  };
  const text = `${input.name} ${input.details}`;
  if (input.honeypot) add(70, "تعبئة حقل مخفي (روبوت)");
  if (input.elapsedMs != null && input.elapsedMs < 3000) add(40, "إرسال خلال أقل من 3 ثوانٍ من فتح النموذج");
  if (/https?:\/\/|www\.|\.ru\b|\.xyz\b|bit\.ly|t\.me\//i.test(text)) add(30, "روابط داخل الطلب");
  if (!JO_MOBILE.test(toLatin(input.phone).replace(/[\s-]/g, ""))) add(30, "رقم هاتف أردني غير صالح");
  if (!/[؀-ۿ]/.test(input.details) && /[a-z]{4,}/i.test(input.details)) add(20, "وصف بلا أي نص عربي");
  if (/\d/.test(input.name) || input.name.trim().length < 3) add(15, "اسم غير طبيعي");
  if (/(.)\1{5,}/.test(input.details) || input.details.trim().split(/\s+/).length < 3) add(15, "وصف عشوائي أو قصير جداً");
  const since = new Date(Date.now() - 24 * 3600_000);
  const phone = normalizePhone(input.phone);
  const [dupPhone, fromIp] = await Promise.all([
    db.quoteRequest.count({ where: { phone, createdAt: { gt: since } } }),
    ip ? db.quoteRequest.count({ where: { ip, createdAt: { gt: new Date(Date.now() - 3600_000) } } }) : Promise.resolve(0),
  ]);
  if (dupPhone >= 2) add(25, `تكرار من نفس الرقم (${dupPhone} خلال 24 ساعة)`);
  if (fromIp >= 4) add(30, `طلبات كثيرة من نفس العنوان (${fromIp} خلال ساعة)`);

  // منطقة رمادية: رأي النموذج اللغوي (لا يُستدعى للطلبات الواضحة توفيراً للتكلفة)
  if (score >= 15 && score < 60 && writerConfigured()) {
    try {
      const { data } = await writeJson<{ spam: boolean; confidence: number; reason: string }>({
        system: "أنت مدقق طلبات عروض أسعار لشركة مقاولات أردنية. قرر إن كان الطلب وهمياً (إعلان، عبث، اختبار، محتوى لا علاقة له بالبناء) أم طلباً حقيقياً من عميل محتمل. الطلبات الحقيقية قد تكون مختصرة أو بلهجة عامية — لا تعتبرها وهمية لذلك.",
        turns: [{ role: "user", text: `الاسم: ${input.name}\nالهاتف: ${input.phone}\nنوع المشروع: ${input.type}\nالمدينة: ${input.city ?? ""}\nالمساحة: ${input.area ?? ""}\nالتفاصيل: ${input.details}\nملاحظات الفحص الآلي: ${reasons.join("، ")}` }],
        schema: { type: "object", properties: { spam: { type: "boolean" }, confidence: { type: "integer", description: "0-100" }, reason: { type: "string", description: "سبب مختصر بالعربية" } } },
        effort: "low",
      });
      if (data.spam && data.confidence >= 60) add(40, `الفحص الذكي: ${data.reason}`);
      else if (!data.spam && data.confidence >= 70) {
        score = Math.max(0, score - 15);
        reasons.push(`الفحص الذكي: طلب حقيقي — ${data.reason}`);
      }
    } catch (e) {
      console.error("[rfq ai]", e);
    }
  }
  return { score: Math.min(score, 100), reasons, spam: score >= 60, phone };
}

/** مدير المشروع الأقل انشغالاً بطلبات مفتوحة */
export async function pickPm() {
  const pms = await db.user.findMany({ where: { role: "PM", active: true }, select: { id: true } });
  if (!pms.length) return null;
  const load = await db.quoteRequest.groupBy({ by: ["assignedPmId"], where: { status: { in: ["PM_REVIEW", "RETURNED"] }, assignedPmId: { in: pms.map((p) => p.id) } }, _count: true });
  const count = new Map(load.map((l) => [l.assignedPmId, l._count]));
  return pms.sort((a, b) => (count.get(a.id) ?? 0) - (count.get(b.id) ?? 0))[0].id;
}

export async function receiveQuote(input: RfqInput, meta: { ip: string | null; userAgent: string | null }) {
  const check = await spamCheck(input, meta.ip);
  const pm = check.spam ? null : await pickPm();
  const d = new Date();
  const ref = `RFQ-${String(d.getUTCFullYear()).slice(2)}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}-${randomInt(1000, 9999)}`;
  const q = await db.quoteRequest.create({
    data: {
      ref,
      name: input.name.slice(0, 120),
      phone: check.phone.slice(0, 30),
      email: input.email?.slice(0, 160) || null,
      projectType: input.type.slice(0, 120),
      city: input.city?.slice(0, 60) || null,
      area: input.area?.slice(0, 40) || null,
      details: input.details.slice(0, 4000),
      offer: input.offer?.slice(0, 120) || null,
      ip: meta.ip,
      userAgent: meta.userAgent?.slice(0, 300) ?? null,
      spamScore: check.score,
      spamReasons: check.reasons.join(" | ") || null,
      status: check.spam ? "SPAM" : "PM_REVIEW",
      assignedPmId: pm,
      events: { create: { action: check.spam ? "SPAM" : "RECEIVED", note: check.spam ? `حُجز كطلب وهمي (${check.score}%): ${check.reasons.join("، ")}` : pm ? "وصل من الموقع ووُجّه تلقائياً لمدير المشروع" : "وصل من الموقع — لا يوجد مدير مشروع فعّال، بانتظار الإدارة" } },
    },
  });
  if (!check.spam) {
    // يصل للإدارة (المدير العام + المشرف الأعلى) ولكل مدراء المشاريع، والمُكلَّف يُذكر بالاسم
    const pms = (await db.user.findMany({ where: { role: "PM", active: true }, select: { id: true, name: true } }));
    const assigned = pms.find((p) => p.id === pm);
    await notify([...pms.map((p) => p.id), "ADMIN"], {
      title: `طلب تسعير جديد من الموقع: ${q.projectType}`,
      body: `${q.name} — ${q.phone}${q.city ? ` — ${q.city}` : ""} (${q.ref})${assigned ? ` · مُكلَّف: ${assigned.name}` : " · بانتظار تكليف مدير مشروع"}`,
      href: `/quotes/${q.id}`,
    });
  } else {
    // المحجوز كوهمي لا يضيع: تنبيه داخلي هادئ للإدارة (بلا بريد) لمراجعته واسترجاعه إن كان حقيقياً
    await notify(["ADMIN"], { title: `طلب من الموقع حُجز كوهمي (${check.score}%)`, body: `${q.name} — ${q.phone} (${q.ref}) — راجعه واسترجعه إن كان حقيقياً`, href: `/quotes/${q.id}` }, { email: false });
  }
  return q;
}

import "server-only";
import { randomInt } from "crypto";
import { db } from "./db";
import { callMeta, getMetaConfig, MetaError } from "./meta";
import { writeJson } from "./ai/writer";
import { humanizeClean } from "./content-skills/humanizer";
import { notify } from "./notify";
import { pickPm } from "./quotes";

/**
 * صندوق الرسائل الموحد: ماسنجر (pages_messaging) ورسائل إنستغرام الخاصة (instagram_manage_messages).
 * يعمل تلقائياً متى مُنحت الصلاحية. الرد ضمن نافذة الـ24 ساعة من آخر رسالة للعميل (سياسة Meta).
 * المحادثة الجادة تتحول بضغطة إلى «طلب تسعير» يدخل مسار مدير المشروع ← المحاسب ← الإدارة.
 */
export type InboxMessage = { id: string; text: string; from: string; fromId: string; mine: boolean; at: string };
export type Conversation = { id: string; platform: "messenger" | "instagram"; name: string; userId: string; updated: string; unread: number; messages: InboxMessage[] };

type RawConv = { id: string; updated_time: string; unread_count?: number; participants?: { data: { id: string; name?: string; username?: string }[] }; messages?: { data: { id: string; message?: string; from?: { id: string; name?: string; username?: string }; created_time: string }[] } };

export async function conversations(platform: "messenger" | "instagram", limit = 25): Promise<Conversation[]> {
  const cfg = await getMetaConfig();
  if (!cfg) throw new MetaError("AUTH", "لم تُربط الصفحة بعد");
  const r = await callMeta<{ data: RawConv[] }>("GET", `${cfg.pageId}/conversations`, {
    platform,
    fields: "id,updated_time,unread_count,participants,messages.limit(8){id,message,from,created_time}",
    limit: String(limit),
  });
  const mine = new Set([cfg.pageId, cfg.igUserId].filter(Boolean) as string[]);
  return (r.data ?? []).map((c) => {
    const other = c.participants?.data.find((p) => !mine.has(p.id));
    return {
      id: c.id,
      platform,
      name: other?.name ?? other?.username ?? "عميل",
      userId: other?.id ?? "",
      updated: c.updated_time,
      unread: c.unread_count ?? 0,
      messages: (c.messages?.data ?? [])
        .map((m) => ({ id: m.id, text: m.message ?? "📎 مرفق", from: m.from?.name ?? m.from?.username ?? "", fromId: m.from?.id ?? "", mine: mine.has(m.from?.id ?? ""), at: m.created_time }))
        .reverse(),
    };
  });
}

/** إرسال رد (يمر بالمؤنسن) — ضمن نافذة 24 ساعة من آخر رسالة للعميل */
export async function sendReply(recipientId: string, text: string) {
  const cfg = await getMetaConfig();
  if (!cfg) throw new MetaError("AUTH", "لم تُربط الصفحة بعد");
  const message = humanizeClean(text).text.slice(0, 1900);
  await callMeta("POST", `${cfg.pageId}/messages`, { recipient: JSON.stringify({ id: recipientId }), message: JSON.stringify({ text: message }), messaging_type: "RESPONSE" });
  return message;
}

const SYS = `أنت موظف خدمة العملاء في «صدى الجنوب للمقاولات الإنشائية» (الأردن، مقاول أبنية درجة رابعة، واتساب 0781142003).
اكتب رداً واحداً قصيراً (1–3 جمل) بلهجة أردنية مهذبة ودافئة على آخر رسالة للعميل:
- أجب عن سؤاله بما تعرفه عن خدمات الشركة (أبنية وفلل، إسكانات، هياكل خرسانية، خزانات، بنية تحتية وهدم، تشطيبات) في كل المحافظات.
- لا تذكر أسعاراً أو مدداً أو أرقاماً — التسعير يحتاج معاينة: اطلب الموقع والمساحة التقريبية ونوع العمل ورقم الهاتف للتواصل.
- لا وعود ولا مبالغة، ولا تكرر التحية إن سبقت في المحادثة. بدون رموز تعبيرية كثيرة.`;

export async function suggestInboxReply(messages: InboxMessage[]) {
  const transcript = messages.slice(-8).map((m) => `${m.mine ? "الشركة" : "العميل"}: ${m.text}`).join("\n");
  const { data } = await writeJson<{ reply: string }>({ system: SYS, effort: "low", timeoutMs: 40_000, maxTokens: 1500, schema: { type: "object", properties: { reply: { type: "string" } } }, turns: [{ role: "user", text: transcript }] });
  return humanizeClean(data.reply).text;
}

/** تحويل محادثة جادة إلى طلب تسعير (يُستخرج الاسم والهاتف ونوع المشروع من المحادثة نفسها) */
export async function conversationToQuote(c: Conversation, userId: number) {
  const transcript = c.messages.map((m) => `${m.mine ? "الشركة" : c.name}: ${m.text}`).join("\n");
  const { data } = await writeJson<{ phone: string; projectType: string; city: string; area: string; details: string }>({
    system: "استخرج من محادثة عميل مع شركة مقاولات بيانات طلب التسعير كما وردت حرفياً. ما لم يُذكر اتركه فارغاً — لا تخترع.",
    effort: "low",
    timeoutMs: 40_000,
    maxTokens: 1500,
    schema: { type: "object", properties: { phone: { type: "string" }, projectType: { type: "string" }, city: { type: "string" }, area: { type: "string" }, details: { type: "string", description: "ملخص الطلب بكلمات العميل" } } },
    turns: [{ role: "user", text: transcript }],
  });
  const d = new Date();
  const ref = `RFQ-${String(d.getUTCFullYear()).slice(2)}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}-${randomInt(1000, 9999)}`;
  const pms = await db.user.findMany({ where: { role: "PM", active: true }, select: { id: true } });
  const q = await db.quoteRequest.create({
    data: {
      ref,
      name: c.name.slice(0, 120),
      phone: (data.phone || "—").slice(0, 30),
      projectType: (data.projectType || "غير محدد").slice(0, 120),
      city: data.city || null,
      area: data.area || null,
      details: `${data.details || "من محادثة"}\n\n— المحادثة (${c.platform === "messenger" ? "ماسنجر" : "إنستغرام"}):\n${transcript}`.slice(0, 4000),
      source: c.platform === "messenger" ? "MESSENGER" : "INSTAGRAM",
      status: "PM_REVIEW",
      assignedPmId: await pickPm(),
      events: { create: { action: "RECEIVED", note: `حُوّل من محادثة ${c.platform === "messenger" ? "ماسنجر" : "إنستغرام"}`, userId } },
    },
  });
  await notify([...pms.map((p) => p.id), "ADMIN"], { title: `طلب تسعير من ${c.platform === "messenger" ? "ماسنجر" : "إنستغرام"}: ${q.projectType}`, body: `${q.name} (${q.ref})`, href: `/quotes/${q.id}` });
  return q;
}

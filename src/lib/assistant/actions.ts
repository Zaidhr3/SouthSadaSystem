import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "../db";
import type { AppUser } from "../permissions";
import { auditEvent } from "../action";
import { notify } from "../notify";

/**
 * المساعد المنفّذ: كل أداة كتابة هنا «تقترح» إجراءً فقط (AssistantAction بحالة PROPOSED)،
 * ولا يُنفَّذ إلا بعد موافقة المستخدم من واجهة المحادثة — وبصلاحياته هو (المدير العام فقط ينفّذ).
 *
 * الحدود الصارمة (يدوي دائماً):
 *  - كل ما يمس المال: البنك، الشيكات، القروض، المصاريف، التمويل والعهد، الضريبة، الفوترة، المطالبات، الكفالات،
 *    وأي حقل مبلغ/قيمة/سعر/رسوم في أي جدول
 *  - المستخدمون والصلاحيات وكلمات المرور والأسرار والإعدادات، وسجل الرقابة
 *  - الحذف بأنواعه
 */

/** الجداول المسموح تعديلها عبر المساعد، وحقولها الممنوعة الإضافية */
const EDITABLE: Record<string, { label: string; create?: boolean; deny?: string[]; guard?: (row: Record<string, unknown>) => string | null }> = {
  Tender: { label: "العطاءات والمشاريع", deny: ["archiveStage", "archivedAt", "finalArchivedAt", "kind", "lat", "lon"] },
  SiteDiary: { label: "اليومية الموقعية", create: true },
  WorkPlanItem: { label: "خطة العمل", create: true },
  QuoteRequest: { label: "طلبات التسعير", deny: ["status", "spamScore", "spamReasons", "ip", "userAgent", "ref", "decidedAt", "tenderId"] },
  MarketingItem: { label: "التسويق", create: false, deny: ["fbPostId", "igMediaId", "publishLog", "publishedAt", "approvedById", "approvedAt", "relaunchOf", "imageAttachmentId", "mediaIds", "chat"], guard: (r) => (r.status === "PUBLISHED" ? "العنصر منشور — لا يُعدّل" : null) },
  Correspondence: { label: "الصادر والوارد (المسودات)", deny: ["refNo", "seq", "year", "letterStatus", "approvedById", "approvedAt", "accountantById"], guard: (r) => (r.letterStatus === "APPROVED" ? "الكتاب معتمد برقم صادر — لا يُعدّل" : null) },
  Subcontractor: { label: "مقاولو الباطن", create: true },
  Equipment: { label: "الآليات والمعدات", create: true },
  CompanyDocument: { label: "أوراق الشركة", create: true },
  Client: { label: "حسابات العملاء (البيانات فقط)", deny: ["email", "mustChangePassword", "lastLoginAt"] },
  MediaAsset: { label: "مكتبة الوسائط", deny: ["attachmentId", "usageCount"] },
  SystemIssue: { label: "سجل المشاكل", create: true },
  AiSkill: { label: "المهارات", deny: ["content", "sourceUrl"] },
};
const ALWAYS_DENY = /^(id|createdAt|updatedAt|createdById|uploadedById|passwordHash)$/;
const MONEY = /amount|value|price|fee|paid|balance|budget|discount|cost|rate|salary|retention|advance|bid|total|vat|tax/i;
export const SENSITIVE_NOTE = "الأقسام المالية (البنك، الشيكات، القروض، المصاريف، التمويل، الضريبة، الفوترة، المطالبات، الكفالات) وأي مبلغ، والمستخدمون والصلاحيات والأسرار، والحذف — يدوي فقط.";

const models = () => Prisma.dmmf.datamodel.models;

/** تحقق وتحويل القيم حسب نوع الحقل في المخطط — يرفض أي حقل غير مسموح */
function cleanData(model: string, data: Record<string, unknown>, forCreate: boolean) {
  const spec = EDITABLE[model];
  if (!spec) throw new Error(`«${model}» قسم غير متاح للمساعد — ${SENSITIVE_NOTE}`);
  const m = models().find((x) => x.name === model);
  if (!m) throw new Error(`جدول غير معروف: ${model}`);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data ?? {})) {
    const f = m.fields.find((x) => x.name === k);
    if (!f || f.kind === "object") throw new Error(`الحقل «${k}» غير موجود في ${model}`);
    if (ALWAYS_DENY.test(k) || spec.deny?.includes(k)) throw new Error(`الحقل «${k}» محمي — يُعدّل يدوياً`);
    if (MONEY.test(k) && (f.type === "Float" || f.type === "Int" || f.type === "Decimal")) throw new Error(`«${k}» حقل مالي — المبالغ يدوية فقط`);
    if (v === null) {
      if (f.isRequired) throw new Error(`الحقل «${k}» مطلوب ولا يكون فارغاً`);
      out[k] = null;
      continue;
    }
    switch (f.type) {
      case "Int":
        if (!Number.isInteger(Number(v))) throw new Error(`«${k}» رقم صحيح`);
        out[k] = Number(v);
        break;
      case "Float":
        if (!Number.isFinite(Number(v))) throw new Error(`«${k}» رقم`);
        out[k] = Number(v);
        break;
      case "Boolean":
        out[k] = v === true || v === "true";
        break;
      case "DateTime": {
        const d = new Date(String(v));
        if (isNaN(+d)) throw new Error(`«${k}» تاريخ غير صالح`);
        out[k] = d;
        break;
      }
      case "Json":
        out[k] = v;
        break;
      default:
        out[k] = String(v).slice(0, 8000);
    }
  }
  if (forCreate) {
    const missing = m.fields.filter((f) => f.kind !== "object" && f.isRequired && !f.hasDefaultValue && !f.isUpdatedAt && !(f.name in out) && f.name !== "createdById");
    if (missing.length) throw new Error(`حقول مطلوبة ناقصة: ${missing.map((f) => f.name).join("، ")}`);
    if (m.fields.some((f) => f.name === "createdById")) out.createdById = -1; // يُستبدل بالمنفّذ
  }
  return out;
}

const delegate = (model: string) => (db as unknown as Record<string, { findUnique: (a: unknown) => Promise<Record<string, unknown> | null>; update: (a: unknown) => Promise<Record<string, unknown>>; create: (a: unknown) => Promise<Record<string, unknown>> }>)[model.charAt(0).toLowerCase() + model.slice(1)];

/* ───────── المنفّذات: تعمل فقط بعد الموافقة ───────── */
type Exec = (args: Record<string, unknown>, user: AppUser) => Promise<string>;
export const EXECUTORS: Record<string, { describe: (a: Record<string, unknown>) => string; validate: (a: Record<string, unknown>) => Promise<void>; run: Exec }> = {
  update_record: {
    describe: (a) => `تعديل ${EDITABLE[String(a.model)]?.label ?? a.model} #${a.id}: ${Object.entries((a.data as Record<string, unknown>) ?? {}).map(([k, v]) => `${k} ← ${String(v).slice(0, 60)}`).join("، ")}`,
    validate: async (a) => {
      cleanData(String(a.model), a.data as Record<string, unknown>, false);
      const row = await delegate(String(a.model)).findUnique({ where: { id: Number(a.id) } });
      if (!row) throw new Error(`السجل #${a.id} غير موجود`);
      const g = EDITABLE[String(a.model)].guard?.(row);
      if (g) throw new Error(g);
    },
    run: async (a, user) => {
      const model = String(a.model);
      const before = await delegate(model).findUnique({ where: { id: Number(a.id) } });
      const g = before && EDITABLE[model].guard?.(before);
      if (g) throw new Error(g);
      const data = cleanData(model, a.data as Record<string, unknown>, false);
      await delegate(model).update({ where: { id: Number(a.id) }, data });
      await auditEvent("UPDATE", model, `المساعد الذكي (بموافقة ${user.name}): ${Object.keys(data).join("، ")}`, user, { recordId: Number(a.id) });
      return `عُدّل ${EDITABLE[model].label} #${a.id}`;
    },
  },
  create_record: {
    describe: (a) => `إضافة سجل في ${EDITABLE[String(a.model)]?.label ?? a.model}: ${Object.entries((a.data as Record<string, unknown>) ?? {}).map(([k, v]) => `${k}: ${String(v).slice(0, 50)}`).join("، ")}`,
    validate: async (a) => {
      if (!EDITABLE[String(a.model)]?.create) throw new Error(`الإضافة غير متاحة في «${a.model}» عبر المساعد`);
      cleanData(String(a.model), a.data as Record<string, unknown>, true);
    },
    run: async (a, user) => {
      const model = String(a.model);
      const data = cleanData(model, a.data as Record<string, unknown>, true);
      if (data.createdById === -1) data.createdById = user.id;
      const row = await delegate(model).create({ data });
      await auditEvent("CREATE", model, `المساعد الذكي (بموافقة ${user.name})`, user, { recordId: Number(row.id) });
      return `أُضيف ${EDITABLE[model].label} #${row.id}`;
    },
  },
  assign_quote: {
    describe: (a) => `إسناد طلب التسعير #${a.quoteId} لمدير المشروع #${a.pmId}`,
    validate: async (a) => {
      const [q, pm] = await Promise.all([db.quoteRequest.findUnique({ where: { id: Number(a.quoteId) } }), db.user.findFirst({ where: { id: Number(a.pmId), active: true, role: { in: ["PM", "ADMIN"] } } })]);
      if (!q) throw new Error("الطلب غير موجود");
      if (!pm) throw new Error("مدير المشروع غير موجود أو غير فعّال");
    },
    run: async (a, user) => {
      const q = await db.quoteRequest.update({ where: { id: Number(a.quoteId) }, data: { assignedPmId: Number(a.pmId) } });
      await db.quoteEvent.create({ data: { quoteId: q.id, action: "ASSIGNED", note: "أُسند عبر المساعد الذكي", userId: user.id, userName: user.name } });
      await notify([Number(a.pmId)], { title: `أُسند إليك طلب تسعير: ${q.ref}`, body: `${q.projectType} — ${q.name}`, href: `/quotes/${q.id}` }, { exclude: user.id });
      return `أُسند الطلب ${q.ref}`;
    },
  },
  send_message: {
    describe: (a) => `رسالة داخلية إلى المستخدم #${a.toUserId}: «${String(a.subject).slice(0, 60)}»`,
    validate: async (a) => {
      if (!(await db.user.findFirst({ where: { id: Number(a.toUserId), active: true } }))) throw new Error("المستلم غير موجود");
      if (!String(a.body ?? "").trim()) throw new Error("نص الرسالة فارغ");
    },
    run: async (a, user) => {
      const m = await db.message.create({ data: { senderId: user.id, recipientId: Number(a.toUserId), subject: String(a.subject || "رسالة").slice(0, 200), body: String(a.body).slice(0, 4000), tenderId: a.tenderId ? Number(a.tenderId) : null } });
      await notify([Number(a.toUserId)], { title: `رسالة من ${user.name}: ${m.subject}`, body: m.body.slice(0, 140), href: "/messages" }, { exclude: user.id });
      return `أُرسلت الرسالة #${m.id}`;
    },
  },
  notify_team: {
    describe: (a) => `تنبيه ${(a.targets as string[])?.join("، ")}: «${String(a.title).slice(0, 60)}»`,
    validate: async (a) => {
      if (!Array.isArray(a.targets) || !a.targets.length) throw new Error("حدد المستلمين");
    },
    run: async (a, user) => {
      const targets = (a.targets as (string | number)[]).map((t) => (/^\d+$/.test(String(t)) ? Number(t) : (String(t) as "ADMIN" | "ACCOUNTANT" | "CHAIRMAN"))).filter((t) => typeof t === "number" || ["ADMIN", "ACCOUNTANT", "CHAIRMAN"].includes(t as string));
      const pms = (a.targets as string[]).includes("PM") ? (await db.user.findMany({ where: { role: "PM", active: true }, select: { id: true } })).map((u) => u.id) : [];
      await notify([...targets, ...pms] as never[], { title: String(a.title).slice(0, 200), body: String(a.body ?? "").slice(0, 600), href: String(a.href || "/notifications") }, { exclude: user.id });
      return "أُرسل التنبيه";
    },
  },
  marketing_idea: {
    describe: (a) => `صياغة محتوى تسويقي من الفكرة: «${String(a.idea).slice(0, 80)}» (${a.kind ?? "منشور + قصة"})`,
    validate: async (a) => {
      if (String(a.idea ?? "").length < 5) throw new Error("الفكرة قصيرة");
    },
    run: async (a, user) => {
      const { fromIdea } = await import("../marketing");
      const items = await fromIdea(String(a.idea), (["POST", "STORY", "BOTH"].includes(String(a.kind)) ? a.kind : "BOTH") as "POST" | "STORY" | "BOTH", user.id);
      return `صيغ ${items.length} عنصر — بانتظار مراجعتك في التسويق: ${items.map((i) => `/marketing/${i.id}`).join(" ")}`;
    },
  },
  design_post: {
    describe: (a) => `تصميم ذكي للمنشور #${a.itemId}`,
    validate: async (a) => {
      const it = await db.marketingItem.findUnique({ where: { id: Number(a.itemId) }, select: { status: true } });
      if (!it) throw new Error("العنصر غير موجود");
      if (it.status === "PUBLISHED") throw new Error("العنصر منشور");
    },
    run: async (a, user) => {
      const { smartCompose } = await import("../design/compose");
      const r = await smartCompose(Number(a.itemId), user.id);
      return `صُمّم ${r.catalog} (${r.template}${r.motif ? ` — ${r.motif}` : ""})`;
    },
  },
  schedule_post: {
    describe: (a) => `اعتماد المنشور #${a.itemId} وجدولة نشره على فيسبوك وإنستغرام في ${String(a.publishAt).slice(0, 16)}`,
    validate: async (a) => {
      const it = await db.marketingItem.findUnique({ where: { id: Number(a.itemId) }, select: { status: true, imageAttachmentId: true, kind: true } });
      if (!it) throw new Error("العنصر غير موجود");
      if (it.status === "PUBLISHED") throw new Error("منشور مسبقاً");
      if (!it.imageAttachmentId) throw new Error("صمّم المنشور أولاً");
      const d = new Date(String(a.publishAt));
      if (isNaN(+d) || +d < Date.now() - 60_000) throw new Error("موعد النشر يجب أن يكون في المستقبل");
    },
    run: async (a, user) => {
      await db.marketingItem.update({ where: { id: Number(a.itemId) }, data: { status: "APPROVED", approvedById: user.id, approvedAt: new Date(), publishAt: new Date(String(a.publishAt)) } });
      await auditEvent("APPROVE", "MarketingItem", `اعتماد وجدولة عبر المساعد (بموافقة ${user.name})`, user, { recordId: Number(a.itemId) });
      return `اعتُمد وجُدول — يُنشر تلقائياً في موعده`;
    },
  },
  resolve_issue: {
    describe: (a) => `تعليم المشكلة #${a.id} «${a.status === "DISMISSED" ? "ليست مشكلة" : "محلولة"}»`,
    validate: async (a) => {
      if (!(await db.systemIssue.findUnique({ where: { id: Number(a.id) } }))) throw new Error("المشكلة غير موجودة");
    },
    run: async (a) => {
      await db.systemIssue.update({ where: { id: Number(a.id) }, data: { status: a.status === "DISMISSED" ? "DISMISSED" : "RESOLVED", resolvedAt: new Date() } });
      return "حُدّثت حالة المشكلة";
    },
  },
  refresh_accounts: {
    describe: () => "تحديث حسابات فيسبوك وإنستغرام وتحليلها",
    validate: async () => undefined,
    run: async () => {
      const { syncSocial, analyzeSocial } = await import("../social");
      const s = await syncSocial();
      const r = await analyzeSocial();
      return `سُحب ${s.fb} + ${s.ig} منشور وحُلّل ${r.analyzed}`;
    },
  },
};

/** إنشاء اقتراح (لا تنفيذ) — يُستدعى من أدوات المساعد */
export async function propose(tool: string, args: Record<string, unknown>, ctx: { threadId: number; userId: number }) {
  const ex = EXECUTORS[tool];
  if (!ex) throw new Error("إجراء غير معروف");
  await ex.validate(args);
  const a = await db.assistantAction.create({ data: { threadId: ctx.threadId, userId: ctx.userId, tool, args: args as Prisma.InputJsonValue, summary: ex.describe(args) } });
  return { proposed: true, actionId: a.id, summary: a.summary, note: "اقتراح بانتظار موافقة المستخدم — لم يُنفَّذ بعد. لا تقل إنه تم." };
}

/** تنفيذ اقتراح بعد الموافقة — بصلاحيات المستخدم (المدير العام فقط) */
export async function executeAction(id: number, user: AppUser) {
  if (user.role !== "ADMIN") throw new Error("التنفيذ للمدير العام فقط — المساعد يعمل بصلاحياتك");
  const a = await db.assistantAction.findUnique({ where: { id } });
  if (!a || a.userId !== user.id) throw new Error("الإجراء غير موجود");
  if (a.status !== "PROPOSED") throw new Error("الإجراء نُفّذ أو أُلغي مسبقاً");
  const claimed = await db.assistantAction.updateMany({ where: { id, status: "PROPOSED" }, data: { status: "EXECUTING" } });
  if (!claimed.count) throw new Error("الإجراء قيد التنفيذ");
  try {
    const ex = EXECUTORS[a.tool];
    await ex.validate(a.args as Record<string, unknown>);
    const result = await ex.run(a.args as Record<string, unknown>, user);
    await db.assistantAction.update({ where: { id }, data: { status: "EXECUTED", result, executedAt: new Date() } });
    return { ok: true, result, action: a };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db.assistantAction.update({ where: { id }, data: { status: "FAILED", result: msg } });
    return { ok: false, result: msg, action: a };
  }
}

/** وصف القدرات للمساعد (يُضاف لموجّهه) */
export const EDIT_GUIDE = `## التنفيذ (أنت منفّذ لا محلل فقط)
عند طلب مهمة: افهمها، اجمع البيانات اللازمة بأدوات القراءة (الأرقام والمعرّفات الصحيحة)، ثم **استدعِ أدوات «propose_*» فوراً في نفس الرد** لكل خطوة — الاقتراح نفسه لا يغيّر شيئاً، بل يظهر للمستخدم بزر «نفّذ» وهذه هي خطوة الموافقة. لا تسأل «موافق أرفعها؟» قبل الاقتراح.
بعد الاقتراح اكتب الخطة باختصار: «بدي أعمل كذا وكذا — إذا تمام اضغط نفّذ (أو نفّذ الكل)». لا تقل أبداً إن شيئاً تمّ قبل أن يصلك تأكيد التنفيذ.
إن رُفض اقتراح لسبب (حقل محمي أو مالي) فاشرح ذلك واقترح البديل المسموح.
الجداول المتاحة للتعديل/الإضافة: ${Object.entries(EDITABLE).map(([k, v]) => `${k} (${v.label}${v.create ? "، إضافة" : ""})`).join("؛ ")}.
ممنوع عليك (اشرح للمستخدم أنها يدوية وأين يعدّلها): ${SENSITIVE_NOTE}`;

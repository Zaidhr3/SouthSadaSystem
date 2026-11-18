import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "../db";
import type { AppUser } from "../permissions";
import { computeNotifications } from "../notifications";
import { bankBalance } from "../finance";
import { projectCashFlow } from "../cashflow";
import { metaStatus } from "../meta";
import { socialSnapshot } from "../social";
import { runIntegrityChecks } from "./integrity";
import * as labels from "../labels";
import { QUOTE_STATUS } from "../quotes";
import { MKT_STATUS } from "../marketing";
import { propose } from "./actions";
import { redact } from "./redact";
import { tenderCoords } from "../external/geo";
import { forecast } from "../external/weather";
import { jodRates } from "../external/fx";
import { scrapeUrl, webResearch, webSearch } from "../ai-services";

/**
 * أدوات مساعد النظام — قراءة فقط (عدا تسجيل مشكلة في سجل المشاكل).
 * الاستعلام الحر يعمل داخل معاملة READ ONLY على Postgres، ويُمنع من الجداول/الأعمدة الحساسة.
 */
export type ToolDef = { name: string; description: string; parameters: { type: "object"; properties: Record<string, { type: string; description?: string; enum?: string[] }>; required?: string[] } };
export type ToolCtx = { threadId: number };
type Handler = (args: Record<string, unknown>, user: AppUser, ctx: ToolCtx) => Promise<unknown>;

const FORBIDDEN = /("?IntegrationSecret"?|"?AttachmentBlob"?|passwordHash|"?UploadTicket"?|"?Setting"?\b|pg_shadow|pg_authid|\bauth\.|\bstorage\.|current_setting|set_config|dblink|\bpg_\w+\s*\(|\blo_\w+|copy\s|(query|table|schema|database|cursor)_to_(xml|json)|xpath|\bexecute\b|\bprepare\b)/i;

/**
 * الحماية الأساسية للاستعلام الحر (ثغرة F3): تشغيله بدور قاعدة بيانات للقراءة فقط
 * لا يرى إلا views منقّاة في المخطط ai (بلا كلمات مرور ولا أسرار) — scripts/setup-assistant-role.ts.
 * القائمة السوداء أعلاه وتنقية النتائج أدناه طبقة ثانية فقط: يمكن الالتفاف على أي قائمة نصية.
 */
const ASSISTANT_ROLE = (process.env.ASSISTANT_DB_ROLE || "").trim();
let warnedNoRole = false;


/** ملخص بنية قاعدة البيانات من Prisma (الجداول، الحقول، العلاقات) — مصدر فهم المساعد للنظام */
function schemaDoc(filter?: string) {
  const models = Prisma.dmmf.datamodel.models.filter((m) => !["IntegrationSecret", "AttachmentBlob", "UploadTicket", "Setting"].includes(m.name));
  const pick = filter ? models.filter((m) => m.name.toLowerCase().includes(filter.toLowerCase())) : models;
  return pick
    .map((m) => {
      const fields = m.fields
        .filter((f) => f.name !== "passwordHash")
        .map((f) => (f.kind === "object" ? `${f.name}→${f.type}${f.isList ? "[]" : ""}` : `${f.name}:${f.type}${f.isRequired ? "" : "?"}`))
        .join(", ");
      return `"${m.name}"${m.documentation ? ` (${m.documentation.replace(/\n/g, " ")})` : ""}: ${fields}`;
    })
    .join("\n");
}

const json = (v: unknown) => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? Number(x) : x)));

export const TOOLS: (ToolDef & { run: Handler })[] = [
  {
    name: "db_schema",
    description: "بنية قاعدة بيانات النظام: كل جدول وحقوله وعلاقاته (أسماء الجداول والأعمدة كما في Postgres، بعلامات تنصيص). استخدمها قبل أي استعلام SQL. filter اختياري لاسم الجدول.",
    parameters: { type: "object", properties: { filter: { type: "string", description: "جزء من اسم الجدول (اختياري)" } } },
    run: async (a) => schemaDoc(a.filter ? String(a.filter) : undefined),
  },
  {
    name: "status_labels",
    description: "معاني رموز الحالات (status) في كل وحدة: العطاءات، الكفالات، المطالبات، الشيكات، القروض، طلبات التسعير، التسويق... لترجمة القيم للعربية.",
    parameters: { type: "object", properties: {} },
    run: async () => {
      const maps: Record<string, Record<string, string>> = {};
      for (const [k, v] of Object.entries(labels)) if (k.endsWith("_STATUS") && v && typeof v === "object") maps[k] = Object.fromEntries(Object.entries(v as Record<string, { label: string }>).map(([s, x]) => [s, x.label]));
      maps.QUOTE_STATUS = Object.fromEntries(Object.entries(QUOTE_STATUS).map(([s, x]) => [s, x.label]));
      maps.MARKETING_STATUS = Object.fromEntries(Object.entries(MKT_STATUS).map(([s, x]) => [s, x.label]));
      return maps;
    },
  },
  {
    name: "sql_query",
    description: "استعلام SELECT حر للقراءة فقط على قاعدة البيانات (Postgres). أسماء الجداول والأعمدة camelCase بين علامتي تنصيص مزدوجة مثل \"Tender\".\"awardedValue\". أقصى 200 صف. استخدمه للإجابة الدقيقة بالأرقام.",
    parameters: { type: "object", properties: { sql: { type: "string", description: "استعلام SELECT واحد" } }, required: ["sql"] },
    run: async (a) => {
      const sql = String(a.sql ?? "").trim().replace(/;+\s*$/, "");
      if (!/^(select|with)\b/i.test(sql) || sql.includes(";")) throw new Error("مسموح باستعلام SELECT واحد فقط");
      if (FORBIDDEN.test(sql)) throw new Error("هذا الجدول أو العمود محمي (أسرار/كلمات مرور/ملفات) ولا يُقرأ من المساعد");
      const rows = await db.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
        await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '8s'");
        if (/^[a-z_][a-z0-9_]{0,62}$/.test(ASSISTANT_ROLE)) {
          await tx.$executeRawUnsafe(`SET LOCAL ROLE ${ASSISTANT_ROLE}`);
          await tx.$executeRawUnsafe("SET LOCAL search_path = ai");
        } else if (!warnedNoRole) {
          warnedNoRole = true;
          console.warn("[assistant] ASSISTANT_DB_ROLE غير مضبوط — الاستعلام الحر يعمل بصلاحية النظام الكاملة مع الحماية النصية فقط. شغّل npm run db:assistant");
        }
        return tx.$queryRawUnsafe<Record<string, unknown>[]>(`SELECT * FROM (${sql}) q LIMIT 200`);
      });
      return { rows: redact(json(rows)), count: rows.length };
    },
  },
  {
    name: "system_alerts",
    description: "التنبيهات الحية في النظام كما يراها المستخدم: كفالات تنتهي، شيكات مستحقة، مطالبات متأخرة، أقساط، مهام معلقة — مع الخطورة.",
    parameters: { type: "object", properties: {} },
    run: async (_a, user) => {
      const n = await computeNotifications(user);
      return n.slice(0, 60).map((x) => ({ title: x.title, body: x.body, severity: x.severity, href: x.href }));
    },
  },
  {
    name: "finance_snapshot",
    description: "لقطة مالية: رصيد البنك الحالي والتدفق النقدي المتوقع (الداخل والخارج القادم والمتأخر).",
    parameters: { type: "object", properties: {} },
    run: async () => {
      const [balance, flow] = await Promise.all([bankBalance(), projectCashFlow(60).catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }))]);
      const f = flow as { items?: unknown[] } & Record<string, unknown>;
      return { bankBalance: balance, cashflow: f.items ? { ...f, items: (f.items as unknown[]).slice(0, 40) } : f };
    },
  },
  {
    name: "integrity_check",
    description: "فحص سلامة البيانات الشامل: قيم سالبة، روابط يتيمة، حالات متناقضة، RLS، القروض، الكفالات، عناصر التسويق العالقة. استخدمه عند طلب «افحص النظام».",
    parameters: { type: "object", properties: {} },
    run: async () => runIntegrityChecks(),
  },
  {
    name: "social_accounts",
    description: "حالة حسابات فيسبوك وإنستغرام وآخر المنشورات مع الأداء (الوصول، التفاعل، المشاهدات) وحكم كل منشور (إبقاء/إخفاء/حذف/تمويل).",
    parameters: { type: "object", properties: {} },
    run: async () => {
      const [st, snap] = await Promise.all([metaStatus(), socialSnapshot().catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }))]);
      return { status: st, snapshot: snap };
    },
  },
  {
    name: "recent_activity",
    description: "آخر العمليات في سجل الرقابة (من فعل ماذا ومتى)، وإخفاقات البريد ونشر التسويق — لتحليل المشاكل.",
    parameters: { type: "object", properties: { limit: { type: "number", description: "عدد السجلات (افتراضي 40)" } } },
    run: async (a) => {
      const n = Math.min(Number(a.limit) || 40, 150);
      const [audit, mailFail, mktFail] = await Promise.all([
        db.auditLog.findMany({ orderBy: { id: "desc" }, take: n, select: { id: true, createdAt: true, userName: true, userRole: true, action: true, model: true, recordId: true, summary: true } }),
        db.emailLog.findMany({ where: { status: { not: "SENT" } }, orderBy: { id: "desc" }, take: 15 }).catch(() => []),
        db.marketingItem.findMany({ where: { status: "FAILED" }, select: { id: true, title: true, publishLog: true, updatedAt: true }, take: 10 }),
      ]);
      return json({ audit, mailFailures: mailFail, marketingFailures: mktFail });
    },
  },
  {
    name: "site_weather",
    description: "طقس مواقع المشاريع النشطة لثلاثة أيام (MET Norway) مع تنبيهات العمل: مطر يؤجل الصب، رياح توقف الرافعات، حر أو برد يؤثر على الخرسانة. tenderId اختياري لمشروع واحد.",
    parameters: { type: "object", properties: { tenderId: { type: "number", description: "رقم المشروع (اختياري)" } } },
    run: async (a) => {
      const ts = await db.tender.findMany({ where: a.tenderId ? { id: Number(a.tenderId) } : { status: { in: ["WON", "EXECUTION"] }, archiveStage: 0 }, select: { id: true, name: true, location: true, lat: true, lon: true }, take: 10 });
      return Promise.all(ts.map(async (t) => {
        const c = await tenderCoords(t).catch(() => null);
        return { id: t.id, name: t.name, location: t.location, forecast: c ? await forecast(c.lat, c.lon, 3).catch((e: unknown) => ({ error: String(e) })) : "الموقع غير محدد" };
      }));
    },
  },
  {
    name: "exchange_rates",
    description: "أسعار صرف الدينار الأردني الحالية (دولار، يورو، درهم، ريال، جنيه، ليرة تركية، يوان) — لتسعير المواد المستوردة وعروض الموردين.",
    parameters: { type: "object", properties: {} },
    run: async () => (await jodRates()) ?? { error: "تعذر جلب الأسعار الآن" },
  },
  {
    name: "web_research",
    description: "بحث ويب حيّ بمصادر (Perplexity): أسعار مواد البناء في الأردن، أنظمة وتعليمات دائرة العطاءات، أخبار القطاع، منافسون. استخدمه لأي معلومة خارج بيانات النظام. recencyDays اختياري لحداثة النتائج.",
    parameters: { type: "object", properties: { query: { type: "string" }, recencyDays: { type: "number" } }, required: ["query"] },
    run: async (a) => webResearch(String(a.query), { recencyDays: a.recencyDays ? Number(a.recencyDays) : undefined }),
  },
  {
    name: "read_website",
    description: "قراءة صفحة ويب كنص نظيف (Firecrawl): إعلانات العطاءات، كتالوج مورد، صفحة منافس. أعطه الرابط الكامل.",
    parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
    run: async (a) => scrapeUrl(String(a.url)),
  },
  {
    name: "web_search",
    description: "بحث ويب سريع يعيد روابط وعناوين (Firecrawl) — ثم استخدم read_website لقراءة الأنسب.",
    parameters: { type: "object", properties: { query: { type: "string" }, limit: { type: "number" } }, required: ["query"] },
    run: async (a) => webSearch(String(a.query), Math.min(Number(a.limit) || 5, 10)),
  },
  {
    name: "list_issues",
    description: "سجل مشاكل النظام المفتوحة والمحلولة (لتجنب تكرار تسجيل نفس المشكلة).",
    parameters: { type: "object", properties: { status: { type: "string", enum: ["OPEN", "RESOLVED", "ALL"] } } },
    run: async (a) => db.systemIssue.findMany({ where: a.status && a.status !== "ALL" ? { status: String(a.status) } : {}, orderBy: { id: "desc" }, take: 50 }),
  },
  {
    name: "log_issue",
    description: "تسجيل مشكلة مكتشفة في سجل مشاكل النظام (مع الخطورة والمجال والحل المقترح). لا تسجل مشكلة موجودة مسبقاً.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        detail: { type: "string", description: "الوصف بالدليل (الأرقام، السجلات المعنية)" },
        severity: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"] },
        area: { type: "string", description: "مالية، عطاءات، كفالات، تسويق، بيانات، أمان، أداء..." },
        suggestion: { type: "string", description: "الحل المقترح خطوة بخطوة" },
      },
      required: ["title", "detail", "severity"],
    },
    run: async (a, user) => {
      const title = String(a.title).slice(0, 200);
      const dup = await db.systemIssue.findFirst({ where: { status: "OPEN", title } });
      if (dup) return { duplicate: true, id: dup.id };
      const sev = ["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(String(a.severity)) ? String(a.severity) : "MEDIUM";
      const it = await db.systemIssue.create({ data: { title, detail: String(a.detail).slice(0, 4000), severity: sev, area: a.area ? String(a.area).slice(0, 60) : null, suggestion: a.suggestion ? String(a.suggestion).slice(0, 3000) : null, source: "AI", createdById: user.id } });
      return { logged: true, id: it.id };
    },
  },
];


/** أدوات الاقتراح: كل واحدة تُنشئ إجراءً بانتظار موافقة المستخدم (لا تنفيذ مباشر) */
const parseJson = (v: unknown) => {
  if (v && typeof v === "object") return v as Record<string, unknown>;
  try {
    return JSON.parse(String(v ?? "{}")) as Record<string, unknown>;
  } catch {
    throw new Error("dataJson ليس JSON صالحاً");
  }
};
const P = (name: string, description: string, properties: ToolDef["parameters"]["properties"], required: string[], map: (a: Record<string, unknown>) => [string, Record<string, unknown>]): ToolDef & { run: Handler } => ({
  name,
  description: `${description} (اقتراح بانتظار موافقة المستخدم)`,
  parameters: { type: "object", properties, required },
  run: async (a, user, ctx) => {
    const [tool, args] = map(a);
    return propose(tool, args, { threadId: ctx.threadId, userId: user.id });
  },
});
TOOLS.push(
  P("propose_update_record", "اقتراح تعديل حقول سجل (اسم، موقع، مدير، تواريخ، ملاحظات، حالة غير مالية...). model اسم الجدول كما في db_schema، dataJson كائن JSON بالحقول الجديدة فقط", { model: { type: "string" }, id: { type: "number" }, dataJson: { type: "string", description: 'مثال: {"managerId": 35, "notes": "..."}' } }, ["model", "id", "dataJson"], (a) => ["update_record", { model: String(a.model), id: Number(a.id), data: parseJson(a.dataJson) }]),
  P("propose_create_record", "اقتراح إضافة سجل جديد (يومية موقع، بند خطة عمل، مقاول باطن، معدة، وثيقة شركة، مشكلة)", { model: { type: "string" }, dataJson: { type: "string" } }, ["model", "dataJson"], (a) => ["create_record", { model: String(a.model), data: parseJson(a.dataJson) }]),
  P("propose_assign_quote", "اقتراح إسناد طلب تسعير لمدير مشروع", { quoteId: { type: "number" }, pmId: { type: "number" } }, ["quoteId", "pmId"], (a) => ["assign_quote", { quoteId: Number(a.quoteId), pmId: Number(a.pmId) }]),
  P("propose_send_message", "اقتراح رسالة داخلية لموظف (مع تنبيه)", { toUserId: { type: "number" }, subject: { type: "string" }, body: { type: "string" }, tenderId: { type: "number" } }, ["toUserId", "subject", "body"], (a) => ["send_message", { toUserId: Number(a.toUserId), subject: String(a.subject), body: String(a.body), tenderId: a.tenderId ? Number(a.tenderId) : null }]),
  P("propose_notify", "اقتراح تنبيه داخل النظام. targets مفصولة بفاصلة: ADMIN أو ACCOUNTANT أو CHAIRMAN أو PM (كل مدراء المشاريع) أو أرقام مستخدمين", { targets: { type: "string" }, title: { type: "string" }, body: { type: "string" }, href: { type: "string" } }, ["targets", "title"], (a) => ["notify_team", { targets: String(a.targets).split(/[,،\s]+/).filter(Boolean), title: String(a.title), body: String(a.body ?? ""), href: String(a.href ?? "/notifications") }]),
  P("propose_marketing_idea", "اقتراح صياغة منشور/قصة من فكرة (تدخل مراجعة التسويق)", { idea: { type: "string" }, kind: { type: "string", enum: ["POST", "STORY", "BOTH"] } }, ["idea"], (a) => ["marketing_idea", { idea: String(a.idea), kind: String(a.kind ?? "BOTH") }]),
  P("propose_design_post", "اقتراح تصميم ذكي لمنشور (صورة من المكتبة أو رسم هندسي)", { itemId: { type: "number" } }, ["itemId"], (a) => ["design_post", { itemId: Number(a.itemId) }]),
  P("propose_schedule_post", "اقتراح اعتماد منشور مصمم وجدولة نشره على فيسبوك وإنستغرام. publishAt بصيغة ISO", { itemId: { type: "number" }, publishAt: { type: "string" } }, ["itemId", "publishAt"], (a) => ["schedule_post", { itemId: Number(a.itemId), publishAt: String(a.publishAt) }]),
  P("propose_resolve_issue", "اقتراح إغلاق مشكلة في سجل المشاكل", { id: { type: "number" }, status: { type: "string", enum: ["RESOLVED", "DISMISSED"] } }, ["id"], (a) => ["resolve_issue", { id: Number(a.id), status: String(a.status ?? "RESOLVED") }]),
  P("propose_refresh_accounts", "اقتراح تحديث وتحليل حسابات فيسبوك وإنستغرام", {}, [], () => ["refresh_accounts", {}]),
);

export const toolByName = (n: string) => TOOLS.find((t) => t.name === n);

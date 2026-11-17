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

/**
 * أدوات مساعد النظام — قراءة فقط (عدا تسجيل مشكلة في سجل المشاكل).
 * الاستعلام الحر يعمل داخل معاملة READ ONLY على Postgres، ويُمنع من الجداول/الأعمدة الحساسة.
 */
export type ToolDef = { name: string; description: string; parameters: { type: "object"; properties: Record<string, { type: string; description?: string; enum?: string[] }>; required?: string[] } };
type Handler = (args: Record<string, unknown>, user: AppUser) => Promise<unknown>;

const FORBIDDEN = /("?IntegrationSecret"?|"?AttachmentBlob"?|passwordHash|"?UploadTicket"?|"?Setting"?\b|pg_shadow|pg_authid|\bauth\.|\bstorage\.|current_setting|dblink|pg_read|pg_ls|lo_import|copy\s)/i;

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
        return tx.$queryRawUnsafe<Record<string, unknown>[]>(`SELECT * FROM (${sql}) q LIMIT 200`);
      });
      return { rows: json(rows), count: rows.length };
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

export const toolByName = (n: string) => TOOLS.find((t) => t.name === n);

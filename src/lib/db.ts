import { PrismaClient } from "@prisma/client";
import { requestContext } from "./context";

const WRITE_OPS = new Set(["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"]);
const SKIP_MODELS = new Set(["AuditLog", "NotificationDismissal", "NotificationEvent", "EmailLog", "AttachmentBlob", "ClaimEvent", "AiExtraction", "UploadTicket", "IntegrationSecret"]);
const SECRET_KEYS = new Set(["passwordHash", "password"]);
const MAX_JSON = 200_000;

/** تسلسل JSON كامل (مع إخفاء كلمات المرور) — بلا اقتطاع إلا للحالات الضخمة جداً */
export function auditJson(value: unknown) {
  if (value === undefined) return null;
  try {
    const json = JSON.stringify(value, (k, v) => (SECRET_KEYS.has(k) ? "•••" : v), 2);
    return json.length > MAX_JSON ? json.slice(0, MAX_JSON) + "\n…(اقتُطع)" : json;
  } catch {
    return null;
  }
}

const delegateName = (model: string) => model.charAt(0).toLowerCase() + model.slice(1);

/** قراءة الحالة السابقة بحد زمني — لا تُعطّل المعاملة أبداً (عند تجاوز المهلة تُسجل «غير متاحة») */
async function readBefore(base: PrismaClient, model: string, operation: string, where: unknown) {
  if (!where) return null;
  const d = (base as unknown as Record<string, { findUnique: (a: unknown) => Promise<unknown>; findMany: (a: unknown) => Promise<unknown> }>)[delegateName(model)];
  if (!d) return null;
  const read = operation.endsWith("Many") ? d.findMany({ where, take: 100 }) : d.findUnique({ where });
  const timeout = new Promise((resolve) => setTimeout(() => resolve({ __unavailable: "تعذرت قراءة الحالة السابقة ضمن المهلة" }), 1500));
  try {
    return await Promise.race([read, timeout]);
  } catch {
    return null;
  }
}

function createClient() {
  const base = new PrismaClient({ log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"] });
  /**
   * سجل الرقابة العميق: كل عملية كتابة تُلتقط تلقائياً مع الحالة قبلها وبعدها (JSON كامل)
   * وتُحفظ دفعة واحدة بعد نجاح الإجراء مع المستخدم والدور وعنوان IP والجهاز ومعرّف الطلب.
   */
  return base.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const ctx = requestContext.getStore();
          const track = ctx && WRITE_OPS.has(operation) && !SKIP_MODELS.has(model);
          const a = args as { data?: unknown; where?: { id?: unknown } };
          const before = track && operation !== "create" && operation !== "createMany" ? await readBefore(base, model, operation, a.where) : null;
          const result = await query(args);
          if (track) {
            const r = result as { id?: unknown; count?: number } | null;
            const recordId = typeof r?.id === "number" ? r.id : typeof a.where?.id === "number" ? a.where.id : null;
            const after = operation.startsWith("delete") ? null : operation === "createMany" || operation === "updateMany" ? { data: a.data, count: r?.count } : result;
            const u = args as { create?: unknown; update?: unknown };
            const payload = operation.startsWith("delete") ? { where: a.where } : operation === "upsert" ? { where: a.where, create: u.create, update: u.update } : operation.startsWith("update") ? { where: a.where, data: a.data } : a.data;
            ctx.audit.push({
              action: operation,
              model,
              recordId,
              summary: (auditJson(payload) ?? "").replace(/\s+/g, " ").slice(0, 600) + (typeof r?.count === "number" ? ` (عدد السجلات: ${r.count})` : ""),
              before: auditJson(before),
              after: auditJson(after),
            });
          }
          return result;
        },
      },
    },
  });
}

type DB = ReturnType<typeof createClient>;
const globalForPrisma = globalThis as unknown as { prisma?: DB };

export const db: DB = globalForPrisma.prisma ?? createClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;

/** نوع عميل المعاملة (interactive transaction) */
export type Tx = Parameters<Parameters<DB["$transaction"]>[0]>[0];

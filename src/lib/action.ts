import "server-only";
import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { ZodError } from "zod";
import { isRedirectError } from "next/dist/client/components/redirect";
import { AppError } from "./permissions";
import { requestContext, type RequestContext } from "./context";
import { auditJson, db } from "./db";

export type ActionState = {
  ok?: boolean;
  error?: string;
  message?: string;
  fieldErrors?: Record<string, string>;
  /** رابط يُعرض مع رسالة الخطأ */
  link?: { href: string; label: string };
  ts?: number;
};

/** عنوان IP الحقيقي (Cloudflare يمرره في CF-Connecting-IP) ومعرّف المتصفح/الجهاز */
export function clientInfo() {
  try {
    const h = headers();
    // على Vercel: x-real-ip يضعه Vercel نفسه (لا يمكن للزائر تزويره) — cf-connecting-ip يُعتمد فقط خلف Cloudflare
    const ip = process.env.VERCEL
      ? h.get("x-real-ip") || h.get("x-forwarded-for")?.split(",")[0]?.trim() || null
      : h.get("cf-connecting-ip") || h.get("x-real-ip") || h.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
    const country = process.env.VERCEL ? h.get("x-vercel-ip-country") : h.get("cf-ipcountry");
    return { ip: ip ? (country ? `${ip} (${country})` : ip) : null, userAgent: h.get("user-agent") };
  } catch {
    return { ip: null, userAgent: null };
  }
}

/** حفظ قيود التدقيق المتجمعة في سياق الطلب */
async function flushAudit(ctx: RequestContext) {
  if (ctx.audit.length === 0) return;
  const rows = ctx.audit.splice(0).map((e) => ({
    ...e,
    before: e.before ?? null,
    after: e.after ?? null,
    userId: ctx.userId ?? null,
    userName: ctx.userName ?? null,
    userRole: ctx.userRole ?? null,
    ip: ctx.ip ?? null,
    userAgent: ctx.userAgent ?? null,
    requestId: ctx.requestId,
  }));
  try {
    await db.auditLog.createMany({ data: rows });
  } catch (e) {
    console.error("[audit] failed to write", e);
  }
}

async function withContext<T>(fn: () => Promise<T>): Promise<T> {
  const existing = requestContext.getStore();
  if (existing) return fn();
  const ctx: RequestContext = { audit: [], requestId: randomUUID(), ...clientInfo() };
  return requestContext.run(ctx, async () => {
    try {
      return await fn();
    } finally {
      await flushAudit(ctx);
    }
  });
}

/** يغلف منطق الإجراء: يحول أخطاء التحقق والصلاحيات إلى رسائل عربية للنموذج ويكتب سجل التدقيق */
export async function run(fn: () => Promise<string | void>): Promise<ActionState> {
  return withContext(async () => {
    try {
      const message = await fn();
      return { ok: true, message: message || "تم الحفظ بنجاح", ts: Date.now() };
    } catch (e) {
      if (isRedirectError(e)) throw e;
      if (e instanceof ZodError) {
        const fieldErrors: Record<string, string> = {};
        for (const issue of e.issues) {
          const key = String(issue.path[0] ?? "_");
          if (!fieldErrors[key]) fieldErrors[key] = issue.message;
        }
        return { ok: false, error: "يرجى تصحيح الحقول المشار إليها", fieldErrors, ts: Date.now() };
      }
      if (e instanceof AppError) return { ok: false, error: e.message, ...(e.link ? { link: e.link } : {}), ts: Date.now() };
      console.error("[action]", e);
      return { ok: false, error: "حدث خطأ غير متوقع أثناء الحفظ", ts: Date.now() };
    }
  });
}

export type VoidResult = { ok: true } | { ok: false; error: string };

/**
 * لإجراءات الأزرار البسيطة (بدون حالة نموذج).
 * تُعيد الخطأ كقيمة بدل رميه: Next.js يُخفي رسائل الأخطاء المرمية في نسخة الإنتاج،
 * فيرى المستخدم رسالة عامة بدل السبب العربي الحقيقي.
 */
export async function runVoid(fn: () => Promise<void>): Promise<VoidResult> {
  return withContext(async () => {
    try {
      await fn();
      return { ok: true } as const;
    } catch (e) {
      if (isRedirectError(e)) throw e;
      if (e instanceof AppError) return { ok: false, error: e.message } as const;
      console.error("[action]", e);
      return { ok: false, error: "تعذر تنفيذ الإجراء" } as const;
    }
  });
}

/**
 * قيد تدقيق صريح لأحداث سير العمل (تسجيل دخول، تصدير، اعتماد، بوابة البريد...)
 * details: بيانات إضافية كاملة تُحفظ كـ JSON (أسباب، حالة البريد، أرقام...)
 */
export async function auditEvent(
  action: string,
  model: string,
  summary: string,
  user?: { id: number; name: string; role?: string },
  details?: { recordId?: number | null; before?: unknown; after?: unknown },
) {
  const ctx = requestContext.getStore();
  const info = ctx ? { ip: ctx.ip ?? null, userAgent: ctx.userAgent ?? null } : clientInfo();
  await db.auditLog
    .create({
      data: {
        action,
        model,
        summary,
        recordId: details?.recordId ?? null,
        before: auditJson(details?.before),
        after: auditJson(details?.after),
        userId: user?.id ?? ctx?.userId ?? null,
        userName: user?.name ?? ctx?.userName ?? null,
        userRole: user?.role ?? ctx?.userRole ?? null,
        requestId: ctx?.requestId ?? randomUUID(),
        ...info,
      },
    })
    .catch(() => undefined);
}

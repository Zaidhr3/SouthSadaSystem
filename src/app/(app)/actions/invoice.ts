"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { actionUser } from "@/lib/auth";
import { auditEvent, run, runVoid, type ActionState } from "@/lib/action";
import { AppError } from "@/lib/permissions";
import { claimEvent } from "@/lib/claim-flow";
import { parseNum } from "@/lib/num";
import type { InvoiceOverride } from "@/lib/jofotara";
import { confirmAuditAndSendReadiness } from "./invoicing";

const refresh = (id: number) => revalidatePath(`/claims/${id}`);
const optText = (max: number) => z.preprocess((v) => (v == null ? null : String(v).trim() || null), z.string().max(max).nullable());

const lineSchema = z.object({
  description: z.string().trim().min(2, "وصف البند قصير").max(1000),
  unit: z.string().trim().min(1, "الوحدة مطلوبة").max(40),
  qty: z.number().finite().positive("الكمية يجب أن تكون أكبر من صفر"),
  price: z.number().finite().min(0, "السعر سالب"),
});

/**
 * تعديل الفاتورة من الإدارة (المدير العام فقط): البنود والكميات والأسعار والخصم وبيانات المشتري والملاحظة.
 * يحل محل الحساب التلقائي من المطالبة — ويُقفل بعد اعتماد الفاتورة من نظام الفوترة الوطني.
 */
export async function saveInvoiceOverride(claimId: number, _: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await actionUser();
    if (user.role !== "ADMIN") throw new AppError("تعديل الفاتورة للمدير العام فقط");
    const c = await db.claim.findUnique({ where: { id: claimId }, select: { id: true, number: true, einvStatus: true, status: true } });
    if (!c) throw new AppError("المطالبة غير موجودة");
    if (c.einvStatus === "SUBMITTED") throw new AppError("الفاتورة معتمدة من نظام الفوترة الوطني — لا يمكن تعديلها (التصحيح بإشعار دائن)");
    let raw: unknown;
    try {
      raw = JSON.parse(String(fd.get("lines") || "[]"));
    } catch {
      throw new AppError("بنود الفاتورة غير صالحة");
    }
    const rows = (Array.isArray(raw) ? raw : []).map((r) => ({
      description: String((r as Record<string, unknown>).description ?? ""),
      unit: String((r as Record<string, unknown>).unit ?? ""),
      qty: parseNum(String((r as Record<string, unknown>).qty ?? "")) ?? NaN,
      price: parseNum(String((r as Record<string, unknown>).price ?? "")) ?? NaN,
    }));
    const lines = z.array(lineSchema).min(1, "أضف بنداً واحداً على الأقل").max(500).parse(rows);
    const discountRaw = String(fd.get("discount") ?? "").trim();
    const discount = discountRaw === "" ? null : parseNum(discountRaw);
    if (discount != null && (Number.isNaN(discount) || discount < 0)) throw new AppError("الخصم غير صالح");
    const meta = z.object({ buyerName: optText(200), buyerTin: optText(20), buyerPhone: optText(30), note: optText(500) }).parse({
      buyerName: fd.get("buyerName"),
      buyerTin: fd.get("buyerTin"),
      buyerPhone: fd.get("buyerPhone"),
      note: fd.get("note"),
    });
    if (meta.buyerTin && !/^\d{6,15}$/.test(meta.buyerTin)) throw new AppError("الرقم الضريبي للمشتري: أرقام فقط (6–15 رقماً)");
    const override: InvoiceOverride = { lines, discount, ...meta };
    await db.claim.update({ where: { id: claimId }, data: { invoiceOverride: JSON.stringify(override), invoiceEditedById: user.id, invoiceEditedAt: new Date() } });
    await claimEvent(claimId, "invoice_edited", user, `${lines.length} بنداً${discount != null ? ` — خصم ${discount}` : ""}${meta.note ? ` — ${meta.note}` : ""}`);
    await auditEvent("update", "Claim", `تعديل الفاتورة يدوياً للمطالبة رقم ${c.number} (${lines.length} بنداً)`, user, { recordId: claimId, after: override });
    refresh(claimId);
    return "حُفظت الفاتورة المعدّلة — تُرسل لنظام الفوترة بهذه البيانات";
  });
}

/** إلغاء التعديل اليدوي والعودة للحساب التلقائي من المطالبة */
export async function resetInvoiceOverride(claimId: number) {
  const r = await runVoid(async () => {
    const user = await actionUser();
    if (user.role !== "ADMIN") throw new AppError("تعديل الفاتورة للمدير العام فقط");
    const c = await db.claim.findUnique({ where: { id: claimId }, select: { number: true, einvStatus: true } });
    if (!c) throw new AppError("المطالبة غير موجودة");
    if (c.einvStatus === "SUBMITTED") throw new AppError("الفاتورة معتمدة — لا يمكن تعديلها");
    await db.claim.update({ where: { id: claimId }, data: { invoiceOverride: null, invoiceEditedById: null, invoiceEditedAt: null } });
    await claimEvent(claimId, "invoice_reset", user);
    await auditEvent("update", "Claim", `إلغاء التعديل اليدوي على فاتورة المطالبة رقم ${c.number} — العودة للحساب التلقائي`, user, { recordId: claimId });
  });
  refresh(claimId);
  return r;
}

/**
 * «قبول وتدقيق» من المحاسب مع اختيار الفاتورة:
 *   TAX     = الفاتورة الضريبية (تُرسل لجفوتارا عند الموافقة) + الفاتورة العادية
 *   REGULAR = الفاتورة العادية فقط — السبب إلزامي ويظهر للإدارة
 */
export async function auditClaimWithInvoice(claimId: number, _: ActionState, fd: FormData): Promise<ActionState> {
  const mode = fd.get("invoiceMode") === "REGULAR" ? "REGULAR" : "TAX";
  const reason = String(fd.get("invoiceModeReason") ?? "").trim().slice(0, 500) || null;
  if (mode === "REGULAR" && (!reason || reason.length < 5)) return { ok: false, error: "اكتب سبب الاكتفاء بالفاتورة العادية (يظهر للإدارة)", fieldErrors: { invoiceModeReason: "السبب مطلوب" }, ts: Date.now() };
  const pre = await run(async () => {
    const user = await actionUser();
    if (!(user.role === "ADMIN" || user.role === "ACCOUNTANT")) throw new AppError("ليست لديك صلاحية لتنفيذ هذا الإجراء");
    const c = await db.claim.findUnique({ where: { id: claimId }, select: { status: true, einvStatus: true } });
    if (!c) throw new AppError("المطالبة غير موجودة");
    if (c.status !== "DRAFT") throw new AppError("المطالبة ليست مسودة — مرت بالبوابة مسبقاً");
    await db.claim.update({ where: { id: claimId }, data: { invoiceMode: mode, invoiceModeReason: mode === "REGULAR" ? reason : null } });
    await claimEvent(claimId, "invoice_mode", user, mode === "REGULAR" ? `فاتورة عادية فقط — السبب: ${reason}` : "فاتورة ضريبية (جفوتارا) + فاتورة عادية");
  });
  if (!pre.ok) return pre;
  const r = await confirmAuditAndSendReadiness(claimId);
  return r.ok ? { ok: true, message: mode === "REGULAR" ? "رُفعت للإدارة مع الفاتورة العادية فقط وسببها" : "رُفعت للإدارة مع الفاتورة الضريبية والعادية", ts: Date.now() } : { ok: false, error: r.error, ts: Date.now() };
}

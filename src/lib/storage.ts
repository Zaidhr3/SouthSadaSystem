import "server-only";
import { randomUUID } from "crypto";
import path from "path";
import { db } from "./db";
import { AppError } from "./permissions";

/**
 * الرفع المباشر (Direct Upload) إلى Supabase Storage لتجاوز حد Vercel (4.5 ميغابايت للطلب الواحد):
 *   1) الخادم يصدر «تذكرة رفع» لمسار عشوائي صالحة 15 دقيقة (createTickets)
 *   2) المتصفح يرفع الملف مباشرة إلى الحاوية sada-staging بالمفتاح العام — سياسات RLS في التخزين
 *      ترفض أي مسار ليست له تذكرة صالحة (scripts/setup-storage.ts)
 *   3) الإجراء على الخادم يستلم رمز التذكرة فقط، ويسحب الملف من التخزين (لا حد للحجم بين الخادم وSupabase)
 *      ثم يحفظه في المرفقات أو يرسله إلى Gemini، ويحذفه من منطقة العبور.
 */
export const STAGING_BUCKET = process.env.STORAGE_BUCKET || "sada-staging";
export const STAGED_MAX_MB = Number(process.env.NEXT_PUBLIC_MAX_STAGED_MB || 20);
export const STAGED_MAX_BYTES = STAGED_MAX_MB * 1024 * 1024;
const TICKET_TTL_MS = 15 * 60 * 1000;
/** بعد انتهاء صلاحية الرفع يبقى الملف قابلاً للاستلام هذه المدة (نموذج طويل لم يُحفظ بعد) */
const CLAIM_WINDOW_MS = 6 * 60 * 60 * 1000;

const ALLOWED_EXT = new Set([".pdf", ".jpg", ".jpeg", ".png", ".webp", ".heic", ".doc", ".docx", ".xls", ".xlsx", ".dwg", ".zip"]);

export const directUploadEnabled = () => process.env.NEXT_PUBLIC_DIRECT_UPLOAD === "1" && !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function storageBase() {
  return `${(process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/+$/, "")}/storage/v1`;
}
function authHeaders() {
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  return { apikey: key, Authorization: `Bearer ${key}` };
}
const objectPath = (p: string) => p.split("/").map(encodeURIComponent).join("/");

export type TicketRequest = { name: string; size: number; type: string };
export type Ticket = { token: string; uploadUrl: string; name: string };

export async function createTickets(userId: number, files: TicketRequest[], purpose: string | null): Promise<Ticket[]> {
  if (!directUploadEnabled()) throw new AppError("الرفع المباشر غير مفعّل على هذا الخادم");
  if (files.length === 0 || files.length > 10) throw new AppError("اختر من ملف إلى 10 ملفات");
  // حد إساءة الاستخدام: 60 ملفاً في الساعة لكل مستخدم
  const recent = await db.uploadTicket.count({ where: { userId, createdAt: { gt: new Date(Date.now() - 3600_000) } } });
  if (recent + files.length > 60) throw new AppError("تجاوزت حد الرفع (60 ملفاً في الساعة) — حاول لاحقاً");
  const out: Ticket[] = [];
  for (const f of files) {
    const ext = path.extname(f.name || "").toLowerCase();
    if (!ALLOWED_EXT.has(ext)) throw new AppError(`نوع الملف غير مدعوم: ${f.name}`);
    if (!(f.size > 0)) throw new AppError(`الملف ${f.name} فارغ`);
    if (f.size > STAGED_MAX_BYTES) throw new AppError(`حجم الملف ${f.name} يتجاوز ${STAGED_MAX_MB} ميغابايت`);
    const token = randomUUID();
    const p = `u${userId}/${token}${ext}`;
    await db.uploadTicket.create({
      data: { token, path: p, userId, fileName: f.name.slice(0, 250), mimeType: (f.type || "application/octet-stream").slice(0, 120), size: Math.round(f.size), purpose, expiresAt: new Date(Date.now() + TICKET_TTL_MS) },
    });
    out.push({ token, name: f.name, uploadUrl: `${storageBase()}/object/${STAGING_BUCKET}/${objectPath(p)}` });
  }
  return out;
}

export type StagedFile = { ticketId: number; token: string; path: string; fileName: string; mimeType: string; size: number; data: Buffer };

/** يسحب ملفاً مرفوعاً مباشرة — يتحقق أن التذكرة لنفس المستخدم وغير مستهلكة وأن الحجم مطابق */
export async function fetchStaged(token: string, userId: number): Promise<StagedFile> {
  const t = await db.uploadTicket.findUnique({ where: { token: String(token).trim() } });
  if (!t || t.userId !== userId || t.usedAt || t.createdAt.getTime() < Date.now() - CLAIM_WINDOW_MS) {
    throw new AppError("انتهت صلاحية الملف المرفوع أو استُخدم سابقاً — أعد اختياره");
  }
  const res = await fetch(`${storageBase()}/object/authenticated/${STAGING_BUCKET}/${objectPath(t.path)}`, { headers: authHeaders(), cache: "no-store" }).catch(() => null);
  if (!res || !res.ok) throw new AppError(`لم يكتمل رفع الملف «${t.fileName}» — أعد اختياره`);
  const data = Buffer.from(await res.arrayBuffer());
  if (data.length !== t.size || data.length > STAGED_MAX_BYTES) throw new AppError(`الملف «${t.fileName}» لا يطابق ما أُعلن عند الرفع — أعد اختياره`);
  return { ticketId: t.id, token: t.token, path: t.path, fileName: t.fileName, mimeType: t.mimeType, size: t.size, data };
}

async function removeObject(p: string) {
  await fetch(`${storageBase()}/object/${STAGING_BUCKET}/${objectPath(p)}`, { method: "DELETE", headers: authHeaders(), cache: "no-store" }).catch(() => undefined);
}

/** بعد الحفظ: تُستهلك التذكرة ويُحذف الملف من منطقة العبور */
export async function consumeStaged(f: Pick<StagedFile, "ticketId" | "path">) {
  // الحذف أولاً (سياسة القراءة/الحذف تشترط تذكرة غير مستهلكة) ثم الاستهلاك
  await removeObject(f.path);
  await db.uploadTicket.update({ where: { id: f.ticketId }, data: { usedAt: new Date() } });
}

/** رموز الملفات المرفوعة مباشرة في حقل النموذج (field__staged) */
export function stagedTokens(fd: FormData, field = "files") {
  return fd.getAll(`${field}__staged`).map((v) => (typeof v === "string" ? v.trim() : "")).filter((v) => /^[0-9a-f-]{36}$/i.test(v));
}

/** تذاكر صالحة (للتحقق المسبق قبل إنشاء السجل — مثل إلزامية صورة الفاتورة أو الشيك) */
export async function validStagedTickets(fd: FormData, userId: number, field = "files") {
  const tokens = stagedTokens(fd, field);
  if (tokens.length === 0) return [];
  return db.uploadTicket.findMany({ where: { token: { in: tokens }, userId, usedAt: null, createdAt: { gt: new Date(Date.now() - CLAIM_WINDOW_MS) } } });
}

/** تنظيف دوري (مع مهمة cron): ملفات لم تُستلم، وتذاكر قديمة */
export async function cleanupStaging() {
  if (!directUploadEnabled()) return { removed: 0 };
  const stale = await db.uploadTicket.findMany({ where: { usedAt: null, createdAt: { lt: new Date(Date.now() - CLAIM_WINDOW_MS) } }, take: 200 });
  for (const t of stale) await removeObject(t.path);
  if (stale.length) await db.uploadTicket.updateMany({ where: { id: { in: stale.map((t) => t.id) } }, data: { usedAt: new Date() } });
  await db.uploadTicket.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 7 * 24 * 3600_000) } } });
  return { removed: stale.length };
}

/** حذف ملف مرفوع مباشرة دون تنزيله (بعد انتهاء قراءته على دفعات) */
export async function discardStaged(token: string, userId: number) {
  const t = await db.uploadTicket.findUnique({ where: { token: String(token).trim() } });
  if (!t || t.userId !== userId || t.usedAt) return;
  await consumeStaged({ ticketId: t.id, path: t.path });
}

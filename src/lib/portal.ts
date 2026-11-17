import "server-only";
import { createHash, randomBytes } from "crypto";
import { db } from "./db";
import { AppError } from "./permissions";
import { readAttachmentData, saveAttachments } from "./uploads";

/** أنواع المرفقات التي يحق للعميل رؤيتها (ضمن مشروعه فقط) */
export const CLIENT_VISIBLE = ["portal_message", "sign_request", "diary"] as const;

export const SIGN_STATUS: Record<string, { label: string; tone: "orange" | "blue" | "green" | "red" }> = {
  PENDING_CLIENT: { label: "بانتظار توقيع العميل", tone: "orange" },
  PENDING_COMPANY: { label: "بانتظار توقيع الشركة", tone: "blue" },
  COMPLETED: { label: "موقّع من الطرفين", tone: "green" },
  REJECTED: { label: "مرفوض", tone: "red" },
};

export const tempPassword = () => randomBytes(9).toString("base64url").replace(/[-_]/g, "x").slice(0, 10);

/** التوقيع المرسوم: صورة PNG صغيرة فقط */
export function checkSignature(sig: string, signerName: string) {
  if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(sig) || sig.length < 1500) throw new AppError("ارسم توقيعك داخل المربع أولاً");
  if (sig.length > 400_000) throw new AppError("صورة التوقيع كبيرة جداً — امسح وأعد التوقيع");
  if (signerName.trim().length < 3) throw new AppError("اكتب اسمك الكامل كما يظهر في التوقيع");
}

/** بصمة SHA-256 لمحتوى المستند لحظة الإنشاء — أي تغيير لاحق في الملف يظهر عند التحقق */
export async function documentHash(attachmentId: number) {
  const att = await db.attachment.findUnique({ where: { id: attachmentId }, select: { id: true, storedName: true } });
  if (!att) return null;
  const buf = await readAttachmentData(att);
  return buf ? createHash("sha256").update(buf).digest("hex") : null;
}

/** مرفقات يرفعها العميل: تُنسب لمدير المشروع (أو المدير العام) كمستلم، مع وسم «من العميل» */
export async function saveClientFiles(fd: FormData, entityType: "portal_message" | "sign_request", entityId: number, tenderId: number, clientName: string) {
  const files = fd.getAll("files").filter((f): f is File => typeof f === "object" && f !== null && "size" in f && f.size > 0);
  if (!files.length) return 0;
  const t = await db.tender.findUnique({ where: { id: tenderId }, select: { managerId: true } });
  const receiver = t?.managerId ?? (await db.user.findFirst({ where: { role: "ADMIN", active: true }, select: { id: true }, orderBy: { id: "asc" } }))?.id;
  if (!receiver) throw new AppError("تعذر حفظ المرفق");
  return saveAttachments(fd, entityType, entityId, receiver, "files", { label: `من العميل — ${clientName}` });
}

/** نسبة الإنجاز الموزونة من خطة العمل (إن وُجدت) */
export function planProgress(items: { weight: number; progress: number }[]) {
  const w = items.reduce((s, i) => s + i.weight, 0);
  return w > 0 ? Math.round(items.reduce((s, i) => s + i.weight * i.progress, 0) / w) : null;
}

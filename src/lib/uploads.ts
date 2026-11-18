import "server-only";
import { randomUUID } from "crypto";
import { readFile } from "fs/promises";
import path from "path";
import { db } from "./db";
import { AppError } from "./permissions";
import { mimeFor } from "./file-types";
import { consumeStaged, fetchStaged, stagedTokens, validStagedTickets, STAGED_MAX_BYTES } from "./storage";

/** على Vercel حد الطلب الواحد 4.5 ميغابايت؛ محلياً 20 ميغابايت */
export const MAX_FILE_MB = Number(process.env.NEXT_PUBLIC_MAX_UPLOAD_MB || 20);
export const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024;
const ALLOWED_EXT = new Set([".pdf", ".jpg", ".jpeg", ".png", ".webp", ".heic", ".doc", ".docx", ".xls", ".xlsx", ".dwg", ".zip", ".mp3"]);

export { attachmentHeaders, mimeFor } from "./file-types";

export type EntityType =
  | "tender"
  | "expense"
  | "claim"
  | "guarantee"
  | "cheque"
  | "document"
  | "variation"
  | "subcontract"
  | "certificate"
  | "material"
  | "correspondence"
  | "survey"
  | "diary"
  | "photo"
  /** حركة بنكية يدوية (وصل الإيداع) */
  | "bank"
  /** دين خارجي: العقد، وصل الإيداع، الضمانات */
  | "loan"
  /** دفعة سداد دين: إيصال السداد */
  | "loan_payment"
  /** دراسة طلب التسعير من الموقع */
  | "quote"
  /** صورة منشور/قصة تسويقية */
  | "marketing"
  /** مرفقات مراسلات بوابة العميل والمستندات للتوقيع */
  | "portal_message"
  | "sign_request"
  /** مكتبة الوسائط التسويقية (صور المعدات والمشاريع) وهوية الحسابات (الصورة الشخصية والغلاف) */
  | "media_asset"
  | "brand";

/** يحدد العطاء/المشروع الذي يتبع له المرفق (لفحص صلاحية مدير المشروع) */
export async function attachmentTenderId(entityType: string, entityId: number): Promise<number | null> {
  switch (entityType) {
    case "tender":
      return entityId;
    case "claim":
      return (await db.claim.findUnique({ where: { id: entityId } }))?.tenderId ?? null;
    case "guarantee":
      return (await db.guarantee.findUnique({ where: { id: entityId } }))?.tenderId ?? null;
    case "expense":
      return (await db.expense.findUnique({ where: { id: entityId } }))?.tenderId ?? null;
    case "variation":
      return (await db.variationOrder.findUnique({ where: { id: entityId } }))?.tenderId ?? null;
    case "subcontract":
      return (await db.subcontract.findUnique({ where: { id: entityId } }))?.tenderId ?? null;
    case "certificate":
      return (await db.subcontractCertificate.findUnique({ where: { id: entityId }, include: { subcontract: true } }))?.subcontract.tenderId ?? null;
    case "material":
      return (await db.materialReceipt.findUnique({ where: { id: entityId } }))?.tenderId ?? null;
    case "survey":
      return (await db.survey.findUnique({ where: { id: entityId } }))?.tenderId ?? null;
    case "diary":
      return (await db.siteDiary.findUnique({ where: { id: entityId } }))?.tenderId ?? null;
    case "photo":
      return entityId;
    case "quote":
      return null;
    case "portal_message":
      return (await db.portalMessage.findUnique({ where: { id: entityId } }))?.tenderId ?? null;
    case "sign_request":
      return (await db.signRequest.findUnique({ where: { id: entityId } }))?.tenderId ?? null;
    case "correspondence":
      return (await db.correspondence.findUnique({ where: { id: entityId } }))?.tenderId ?? null;
    default:
      return null;
  }
}

export function uploadDir() {
  return path.resolve(process.cwd(), process.env.UPLOAD_DIR || "./storage/uploads");
}

/** يصلح أسماء الملفات العربية التي تصل مشوّهة (UTF-8 قُرئت كـ Latin-1 في بعض المتصفحات) */
export function fixFileName(name: string) {
  if (!/[\u0080-\u00ff]/.test(name) || /[^\u0000-\u00ff]/.test(name)) return name;
  const decoded = Buffer.from(name, "latin1").toString("utf8");
  return decoded.includes("\ufffd") ? name : decoded;
}

/** مجلد الملفات القديمة المحفوظة على القرص (قبل الانتقال لتخزينها داخل قاعدة البيانات) */
export async function saveAttachments(fd: FormData, entityType: EntityType, entityId: number, userId: number, field = "files", opts: { label?: string; slot?: string } = {}) {
  const files = fd.getAll(field).filter((f): f is File => typeof f === "object" && f !== null && "arrayBuffer" in f && f.size > 0);
  // الملفات الكبيرة المرفوعة مباشرة إلى Supabase Storage تصل كرموز تذاكر فقط
  const tokens = stagedTokens(fd, field);
  if (files.length === 0 && tokens.length === 0) return 0;

  for (const f of files) {
    const ext = path.extname(f.name).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) throw new AppError(`نوع الملف غير مدعوم: ${f.name}`);
    if (f.size > MAX_FILE_BYTES) throw new AppError(`حجم الملف ${f.name} يتجاوز ${MAX_FILE_MB} ميغابايت`);
  }

  const label = opts.label ?? ((fd.get("attachmentLabel") as string | null)?.trim() || null);
  const items: { name: string; type: string; size: number; data: () => Promise<Buffer>; done?: () => Promise<void> }[] = files.map((f) => ({ name: f.name, type: f.type, size: f.size, data: async () => Buffer.from(await f.arrayBuffer()) }));
  for (const t of tokens) {
    const st = await fetchStaged(t, userId);
    const ext = path.extname(st.fileName).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) throw new AppError(`نوع الملف غير مدعوم: ${st.fileName}`);
    if (st.size > STAGED_MAX_BYTES) throw new AppError(`حجم الملف ${st.fileName} يتجاوز الحد`);
    items.push({ name: st.fileName, type: st.mimeType, size: st.size, data: async () => st.data, done: () => consumeStaged(st) });
  }

  for (const f of items) {
    const storedName = `${randomUUID()}${path.extname(f.name).toLowerCase()}`;
    const data = await f.data();
    const att = await db.attachment.create({
      data: {
        entityType,
        entityId,
        fileName: fixFileName(f.name),
        storedName,
        mimeType: mimeFor(f.name),
        size: f.size,
        label,
        slot: opts.slot ?? null,
        uploadedById: userId,
      },
    });
    // المحتوى في جدول منفصل (لا يدخل في سجل الرقابة ولا في قوائم المرفقات)
    await db.attachmentBlob.create({ data: { attachmentId: att.id, data } });
    await f.done?.();
  }
  return items.length;
}

/**
 * فحص المرفقات قبل إنشاء السجل: النوع والحجم للملفات العادية، وصلاحية تذاكر الملفات المرفوعة مباشرة.
 * يمنع إنشاء سجل (عطاء مثلاً) ثم فشل مرفقه وبقاء سجل فارغ يعيد المستخدم إنشاءه فيتكرر.
 */
export async function validateAttachments(fd: FormData, userId: number, field = "files") {
  const files = fd.getAll(field).filter((f): f is File => typeof f === "object" && f !== null && "arrayBuffer" in f && f.size > 0);
  for (const f of files) {
    if (!ALLOWED_EXT.has(path.extname(f.name).toLowerCase())) throw new AppError(`نوع الملف غير مدعوم: ${f.name}`);
    if (f.size > MAX_FILE_BYTES) throw new AppError(`حجم الملف ${f.name} يتجاوز ${MAX_FILE_MB} ميغابايت — اختره مجدداً ليُرفع مباشرة للتخزين السحابي`);
  }
  const tokens = stagedTokens(fd, field);
  if (tokens.length) {
    const valid = await validStagedTickets(fd, userId, field);
    if (valid.length !== new Set(tokens).size) throw new AppError("انتهت صلاحية أحد الملفات المرفوعة أو لم يكتمل رفعه — أعد اختيار المرفقات ثم احفظ");
    for (const t of valid) if (!ALLOWED_EXT.has(path.extname(t.fileName).toLowerCase())) throw new AppError(`نوع الملف غير مدعوم: ${t.fileName}`);
  }
}

/** عدد المرفقات في النموذج (العادية + المرفوعة مباشرة بتذكرة صالحة) — للتحقق من المرفقات الإلزامية */
export async function attachedFileCount(fd: FormData, userId: number, field = "files") {
  const inline = fd.getAll(field).filter((f) => typeof f === "object" && f !== null && "size" in f && (f as File).size > 0).length;
  return inline + (await validStagedTickets(fd, userId, field)).length;
}

/** أنواع الملفات في النموذج (لفحص «صور فقط» مثلاً) */
export async function attachedFileTypes(fd: FormData, userId: number, field = "files") {
  const inline = fd.getAll(field).filter((f): f is File => typeof f === "object" && f !== null && "size" in f && (f as File).size > 0).map((f) => mimeFor(f.name));
  return inline.concat((await validStagedTickets(fd, userId, field)).map((t) => mimeFor(t.fileName)));
}

export async function deleteAttachmentsFor(entityType: EntityType, entityId: number) {
  // المحتوى يُحذف تلقائياً مع المرفق (onDelete: Cascade)
  await db.attachment.deleteMany({ where: { entityType, entityId } });
}

/** محتوى المرفق: من قاعدة البيانات، أو من القرص للملفات القديمة */
export async function readAttachmentData(att: { id: number; storedName: string }): Promise<Buffer | null> {
  const blob = await db.attachmentBlob.findUnique({ where: { attachmentId: att.id } });
  if (blob) return Buffer.from(blob.data);
  return readFile(path.join(uploadDir(), path.basename(att.storedName))).catch(() => null);
}

export async function attachmentsMap(entityType: EntityType, ids: number[]) {
  if (ids.length === 0) return new Map<number, { id: number; fileName: string; mimeType: string; size: number }[]>();
  const atts = await db.attachment.findMany({
    where: { entityType, entityId: { in: ids } },
    select: { id: true, entityId: true, fileName: true, mimeType: true, size: true },
    orderBy: { createdAt: "asc" },
  });
  const map = new Map<number, { id: number; fileName: string; mimeType: string; size: number }[]>();
  for (const a of atts) {
    const list = map.get(a.entityId) ?? [];
    list.push(a);
    map.set(a.entityId, list);
  }
  return map;
}

/** أسماء ملفات المرفقات في النموذج (العادية + المرفوعة مباشرة) — لقائمة «المرفقات» في الكتاب الرسمي */
export async function attachedFileNames(fd: FormData, userId: number, field = "files") {
  const inline = fd.getAll(field).filter((f): f is File => typeof f === "object" && f !== null && "size" in f && (f as File).size > 0).map((f) => fixFileName(f.name));
  return inline.concat((await validStagedTickets(fd, userId, field)).map((t) => t.fileName));
}

"use server";

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { actionUser, assertTenderAccess } from "@/lib/auth";
import { run, runVoid, type ActionState } from "@/lib/action";
import { AppError, can } from "@/lib/permissions";
import { attachmentTenderId, deleteAttachmentsFor, saveAttachments, type EntityType } from "@/lib/uploads";
import { DOCUMENT_TYPE, ROLE_LABELS } from "@/lib/labels";
import { formObject, zEnum, zOptDate, zOptText, zText } from "@/lib/validation";

const refresh = () => revalidatePath("/", "layout");

/* ───────────── أوراق الشركة ───────────── */

const docSchema = z.object({
  title: zText("اسم الوثيقة"),
  type: zEnum(DOCUMENT_TYPE, "نوع الوثيقة"),
  number: zOptText,
  issuer: zOptText,
  issueDate: zOptDate,
  expiryDate: zOptDate,
  notes: zOptText,
});

export async function saveDocument(id: number | null, _: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await actionUser(can.manageDocuments);
    const data = docSchema.parse(formObject(fd));
    const doc = id ? await db.companyDocument.update({ where: { id }, data }) : await db.companyDocument.create({ data });
    await saveAttachments(fd, "document", doc.id, user.id);
    refresh();
    return id ? "تم تحديث الوثيقة" : "تمت إضافة الوثيقة";
  });
}

export async function deleteDocument(id: number) {
  const result = await runVoid(async () => {
    await actionUser(can.manageDocuments);
    await db.companyDocument.delete({ where: { id } });
    await deleteAttachmentsFor("document", id);
  });
  refresh();
  return result;
}

/* ───────────── المرفقات ───────────── */

async function assertEntityAccess(userRole: string, userId: number, entityType: EntityType, entityId: number) {
  const user = { id: userId, role: userRole } as Parameters<typeof assertTenderAccess>[0];
  if (user.role === "ADMIN") return;
  // المحاسب: المرفقات المالية فقط
  if (user.role === "ACCOUNTANT") {
    if (["expense", "claim", "cheque", "certificate", "correspondence"].includes(entityType)) return;
    throw new AppError("ليست لديك صلاحية على هذا السجل");
  }
  // مدير المشروع: سجلات مشاريعه فقط
  if (entityType === "expense") {
    const e = await db.expense.findUnique({ where: { id: entityId }, include: { tender: true } });
    if (e && (e.createdById === user.id || e.tender?.managerId === user.id)) return;
  }
  const tenderId = await attachmentTenderId(entityType, entityId);
  if (tenderId && ["tender", "claim", "variation", "certificate", "material", "correspondence"].includes(entityType)) return assertTenderAccess(user, tenderId);
  throw new AppError("ليست لديك صلاحية على هذا السجل");
}

export async function addAttachments(entityType: EntityType, entityId: number, _: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await actionUser();
    await assertEntityAccess(user.role, user.id, entityType, entityId);
    const n = await saveAttachments(fd, entityType, entityId, user.id);
    if (!n) throw new AppError("اختر ملفاً واحداً على الأقل");
    // إرفاق صورة الفاتورة يزيل علامة «فاتورة قديمة بدون مرفق»
    if (entityType === "expense") await db.expense.updateMany({ where: { id: entityId, invoiceFlag: { not: null } }, data: { invoiceFlag: null } });
    refresh();
    return `تم رفع ${n} ملف`;
  });
}

export async function deleteAttachment(id: number) {
  const result = await runVoid(async () => {
    const user = await actionUser();
    const att = await db.attachment.findUnique({ where: { id } });
    if (!att) throw new AppError("المرفق غير موجود");
    if (user.role !== "ADMIN" && att.uploadedById !== user.id) throw new AppError("لا يمكنك حذف مرفق رفعه مستخدم آخر");
    await db.attachment.delete({ where: { id } });
  });
  refresh();
  return result;
}

/* ───────────── المستخدمون ───────────── */

const userSchema = z.object({
  name: zText("الاسم"),
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,32}$/, "اسم المستخدم: أحرف إنجليزية وأرقام فقط (3 أحرف على الأقل)"),
  role: zEnum(ROLE_LABELS, "الدور"),
  title: zOptText,
  phone: zOptText,
  email: z.preprocess((v) => (v === "" || v == null ? null : String(v).trim()), z.string().email("بريد إلكتروني غير صالح").nullable()),
  notifyEmail: z.preprocess((v) => v === "on" || v === "true", z.boolean()),
  password: z.string().optional(),
  boardSeat: z.preprocess((v) => (v === "CHAIR" || v === "MEMBER" ? v : null), z.enum(["CHAIR", "MEMBER"]).nullable()),
});

export async function saveUser(id: number | null, _: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const admin = await actionUser(can.manageUsers);
    const data = userSchema.parse(formObject(fd));
    const pwd = (data.password ?? "").trim();
    if (!id && pwd.length < 8) throw new AppError("كلمة المرور يجب أن تكون 8 أحرف على الأقل");
    if (id && pwd && pwd.length < 8) throw new AppError("كلمة المرور يجب أن تكون 8 أحرف على الأقل");
    if (id === admin.id && data.role !== "ADMIN") throw new AppError("لا يمكنك إزالة صلاحية المدير العام عن نفسك");
    const exists = await db.user.findFirst({ where: { username: data.username, NOT: id ? { id } : undefined } });
    if (exists) throw new AppError("اسم المستخدم مستخدم مسبقاً");
    // رئيس مجلس الإدارة واحد فقط
    if (data.boardSeat === "CHAIR") {
      const other = await db.user.findFirst({ where: { boardSeat: "CHAIR", NOT: id ? { id } : undefined } });
      if (other) throw new AppError(`رئيس مجلس الإدارة الحالي هو ${other.name} — غيّر مقعده أولاً`);
    }
    if (data.boardSeat && (data.role === "PM" || data.role === "AUDITOR" || data.role === "CHAIRMAN")) throw new AppError("عضوية المجلس (التصويت) تحتاج دور المدير العام أو المحاسب — أدوار الاطلاع لا تصوّت");
    const base = { name: data.name, username: data.username, role: data.role, title: data.title, phone: data.phone, email: data.email, notifyEmail: data.notifyEmail, boardSeat: data.boardSeat };
    if (id) {
      await db.user.update({ where: { id }, data: { ...base, ...(pwd ? { passwordHash: await bcrypt.hash(pwd, 10) } : {}) } });
    } else {
      await db.user.create({ data: { ...base, passwordHash: await bcrypt.hash(pwd, 10) } });
    }
    refresh();
    return id ? "تم تحديث المستخدم" : "تمت إضافة المستخدم";
  });
}

/** تفعيل حساب موقوف (يمسح سبب الإيقاف) */
export async function toggleUserActive(id: number) {
  const result = await runVoid(async () => {
    const admin = await actionUser(can.manageUsers);
    if (id === admin.id) throw new AppError("لا يمكنك تعطيل حسابك");
    const u = await db.user.findUnique({ where: { id } });
    if (!u) throw new AppError("المستخدم غير موجود");
    await db.user.update({ where: { id }, data: u.active ? { active: false } : { active: true, suspendReason: null } });
  });
  refresh();
  return result;
}

/** إيقاف حساب مع رسالة تظهر للمستخدم عند محاولة الدخول — يسري فوراً حتى على الجلسات المفتوحة */
export async function suspendUser(id: number, _: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const admin = await actionUser(can.manageUsers);
    if (id === admin.id) throw new AppError("لا يمكنك إيقاف حسابك");
    const reason = String(fd.get("reason") ?? "").trim().slice(0, 1000) || null;
    await db.user.update({ where: { id }, data: { active: false, suspendReason: reason } });
    refresh();
    return "تم إيقاف الحساب";
  });
}

/** تعميم إلزامي يظهر للمستخدم عند الدخول ولا يُغلق إلا بتأكيد الاطلاع (فارغ = إلغاء التعميم) */
export async function setUserNotice(id: number, _: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    await actionUser(can.manageUsers);
    const notice = String(fd.get("notice") ?? "").trim().slice(0, 4000) || null;
    await db.user.update({ where: { id }, data: notice ? { notice, noticeSetAt: new Date(), noticeAckAt: null } : { notice: null, noticeSetAt: null, noticeAckAt: null } });
    refresh();
    return notice ? "تم إرسال التعميم — سيظهر للمستخدم فور دخوله" : "تم إلغاء التعميم";
  });
}

/** تأكيد المستخدم اطلاعه على التعميم (يُسجل في سجل التدقيق) */
export async function acknowledgeNotice() {
  const result = await runVoid(async () => {
    const user = await actionUser(undefined, { readOnlyOk: true });
    await db.user.updateMany({ where: { id: user.id, notice: { not: null }, noticeAckAt: null }, data: { noticeAckAt: new Date() } });
  });
  refresh();
  return result;
}

export async function changeOwnPassword(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await actionUser(undefined, { readOnlyOk: true });
    const current = String(fd.get("current") ?? "");
    const next = String(fd.get("next") ?? "");
    const confirm = String(fd.get("confirm") ?? "");
    const row = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    if (!(await bcrypt.compare(current, row.passwordHash))) throw new AppError("كلمة المرور الحالية غير صحيحة");
    if (next.length < 8) throw new AppError("كلمة المرور الجديدة يجب أن تكون 8 أحرف على الأقل");
    if (next !== confirm) throw new AppError("تأكيد كلمة المرور غير مطابق");
    await db.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(next, 10) } });
    return "تم تغيير كلمة المرور";
  });
}

/* ───────────── التنبيهات ───────────── */

async function dismissKey(userId: number, key: string) {
  if (key.startsWith("event:")) {
    await db.notificationEvent.updateMany({ where: { id: Number(key.slice(6)) || 0, userId }, data: { readAt: new Date() } });
    return;
  }
  await db.notificationDismissal.upsert({ where: { userId_key: { userId, key } }, create: { userId, key }, update: {} });
}

export async function dismissNotification(key: string) {
  const user = await actionUser(undefined, { readOnlyOk: true });
  await dismissKey(user.id, key);
  refresh();
}

export async function dismissAllNotifications(keys: string[]) {
  const user = await actionUser(undefined, { readOnlyOk: true });
  for (const key of keys.slice(0, 500)) await dismissKey(user.id, key);
  refresh();
}

/** تُستدعى تلقائياً عند فتح الصفحة المرتبطة بتنبيه — تسجّل القراءة في قاعدة البيانات دون إعادة تحميل كامل */
export async function markNotificationsSeen(keys: string[]) {
  const user = await actionUser(undefined, { readOnlyOk: true });
  for (const key of keys.slice(0, 50)) {
    if (typeof key === "string" && key.length < 200) await dismissKey(user.id, key);
  }
}

export async function restoreNotifications() {
  const user = await actionUser(undefined, { readOnlyOk: true });
  await db.notificationDismissal.deleteMany({ where: { userId: user.id } });
  await db.notificationEvent.updateMany({ where: { userId: user.id }, data: { readAt: null } });
  refresh();
}

"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { actionUser, assertTenderAccess } from "@/lib/auth";
import { run, runVoid, type ActionState } from "@/lib/action";
import { AppError, can } from "@/lib/permissions";
import { appUrl, emailLayout, mailConfigured, sendMail } from "@/lib/mailer";
import { saveAttachments, validateAttachments } from "@/lib/uploads";
import { checkSignature, documentHash, tempPassword } from "@/lib/portal";

const t = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const done = (tenderId: number) => revalidatePath(`/tenders/${tenderId}/portal`);
const ip = () => (headers().get("x-forwarded-for") || "").split(",")[0].trim() || null;

async function mailCredentials(to: string, name: string, password: string, project: string) {
  if (!mailConfigured()) return false;
  const url = `${appUrl().replace(/\/+$/, "")}/portal/login`;
  await sendMail({
    key: `client-cred:${to}:${Date.now()}`,
    to,
    subject: "حسابك في بوابة عملاء صدى الجنوب للمقاولات",
    html: emailLayout("بوابة العملاء", [{ title: `مرحباً ${name}`, body: `أُنشئ لك حساب لمتابعة مشروع «${project}»: نسبة الإنجاز، خطة العمل، اليوميات، المراسلات والتواقيع.<br><br>البريد: <b dir="ltr">${to}</b><br>كلمة المرور المؤقتة: <b dir="ltr">${password}</b><br><br>ستُطلب منك كلمة مرور جديدة عند أول دخول.`, href: url, tone: "info" }]),
  }).catch(() => undefined);
  return true;
}

/** الإدارة: إنشاء حساب عميل (أو ربط حساب موجود بنفس البريد) بالمشروع */
export async function addClient(tenderId: number, _: ActionState, fd: FormData): Promise<ActionState> {
  const r = await run(async () => {
    const user = await actionUser(can.manageClients);
    const email = t(fd, "email").toLowerCase();
    const name = t(fd, "name");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AppError("بريد إلكتروني غير صالح");
    const tender = await db.tender.findUnique({ where: { id: tenderId }, select: { name: true } });
    if (!tender) throw new AppError("المشروع غير موجود");
    const existing = await db.client.findUnique({ where: { email } });
    if (existing) {
      await db.clientAccess.upsert({ where: { clientId_tenderId: { clientId: existing.id, tenderId } }, create: { clientId: existing.id, tenderId }, update: {} });
      return `الحساب ${email} موجود مسبقاً — رُبط بهذا المشروع ويرى مشاريعه كلها من نفس الدخول`;
    }
    if (name.length < 3) throw new AppError("اكتب اسم العميل");
    const password = tempPassword();
    await db.client.create({
      data: { name, email, phone: t(fd, "phone") || null, kind: t(fd, "kind") === "SUPERVISOR" ? "SUPERVISOR" : "OWNER", passwordHash: await bcrypt.hash(password, 10), createdById: user.id, accesses: { create: { tenderId } } },
    });
    const mailed = await mailCredentials(email, name, password, tender.name);
    return `أُنشئ الحساب. كلمة المرور المؤقتة: ${password}${mailed ? " — وأُرسلت للعميل بالبريد" : " — أرسلها للعميل (البريد غير مُعد)"}`;
  });
  done(tenderId);
  return r;
}

export async function clientAccountAction(tenderId: number, clientId: number, action: "revoke" | "toggle") {
  const r = await runVoid(async () => {
    await actionUser(can.manageClients);
    const c = await db.client.findUnique({ where: { id: clientId } });
    if (!c) throw new AppError("الحساب غير موجود");
    if (action === "revoke") await db.clientAccess.deleteMany({ where: { clientId, tenderId } });
    else await db.client.update({ where: { id: clientId }, data: { active: !c.active } });
  });
  done(tenderId);
  return r;
}

/** كلمة مرور مؤقتة جديدة (تُنهي كل جلسات العميل الحالية) */
export async function resetClientPassword(tenderId: number, clientId: number, _: ActionState, __: FormData): Promise<ActionState> {
  const r = await run(async () => {
    await actionUser(can.manageClients);
    const c = await db.client.findUnique({ where: { id: clientId } });
    if (!c) throw new AppError("الحساب غير موجود");
    const password = tempPassword();
    await db.client.update({ where: { id: clientId }, data: { passwordHash: await bcrypt.hash(password, 10), mustChangePassword: true } });
    const tender = await db.tender.findUnique({ where: { id: tenderId }, select: { name: true } });
    const mailed = await mailCredentials(c.email, c.name, password, tender?.name ?? "");
    return `كلمة المرور المؤقتة الجديدة: ${password}${mailed ? " — أُرسلت للعميل بالبريد" : ""}`;
  });
  done(tenderId);
  return r;
}

/** خطة العمل: إضافة/تعديل بند (مدير المشروع أو الإدارة) */
export async function saveWorkItem(tenderId: number, itemId: number | null, _: ActionState, fd: FormData): Promise<ActionState> {
  const r = await run(async () => {
    const user = await actionUser(can.managePortal);
    await assertTenderAccess(user, tenderId);
    const title = t(fd, "title");
    const startDate = new Date(t(fd, "startDate"));
    const endDate = new Date(t(fd, "endDate"));
    const progress = Math.round(Number(t(fd, "progress") || 0));
    const weight = Number(t(fd, "weight") || 1);
    if (!title) throw new AppError("اكتب اسم البند");
    if (isNaN(+startDate) || isNaN(+endDate) || endDate < startDate) throw new AppError("تاريخ النهاية يجب أن يكون بعد البداية");
    if (!(progress >= 0 && progress <= 100)) throw new AppError("نسبة الإنجاز بين 0 و100");
    if (!(weight > 0 && weight <= 100)) throw new AppError("الوزن النسبي بين 0.1 و100");
    const data = { title, startDate, endDate, progress, weight, notes: t(fd, "notes") || null, sortOrder: Number(t(fd, "sortOrder") || 0) };
    if (itemId) {
      const it = await db.workPlanItem.findFirst({ where: { id: itemId, tenderId } });
      if (!it) throw new AppError("البند غير موجود");
      await db.workPlanItem.update({ where: { id: itemId }, data });
    } else await db.workPlanItem.create({ data: { ...data, tenderId } });
    return "حُفظ البند — يظهر للعميل فوراً";
  });
  done(tenderId);
  return r;
}

export async function deleteWorkItem(tenderId: number, itemId: number) {
  const r = await runVoid(async () => {
    const user = await actionUser(can.managePortal);
    await assertTenderAccess(user, tenderId);
    await db.workPlanItem.deleteMany({ where: { id: itemId, tenderId } });
  });
  done(tenderId);
  return r;
}

export async function staffPortalMessage(tenderId: number, _: ActionState, fd: FormData): Promise<ActionState> {
  const r = await run(async () => {
    const user = await actionUser(can.managePortal);
    await assertTenderAccess(user, tenderId);
    const body = t(fd, "body");
    if (!body) throw new AppError("اكتب الرسالة");
    await validateAttachments(fd, user.id);
    const m = await db.portalMessage.create({ data: { tenderId, fromUserId: user.id, senderName: `${user.name} — صدى الجنوب`, body, readByStaffAt: new Date() } });
    await saveAttachments(fd, "portal_message", m.id, user.id);
    await db.portalMessage.updateMany({ where: { tenderId, fromClientId: { not: null }, readByStaffAt: null }, data: { readByStaffAt: new Date() } });
    return "أُرسلت الرسالة للعميل";
  });
  done(tenderId);
  return r;
}

/** مستند للتوقيع المتبادل: الشركة ترفع المستند وتوقّعه ← العميل يوقّع */
export async function createSignRequest(tenderId: number, _: ActionState, fd: FormData): Promise<ActionState> {
  const r = await run(async () => {
    const user = await actionUser(can.managePortal);
    await assertTenderAccess(user, tenderId);
    const title = t(fd, "title");
    const signerName = t(fd, "signerName") || user.name;
    const signature = t(fd, "signature");
    if (!title) throw new AppError("اكتب عنوان المستند");
    checkSignature(signature, signerName);
    await validateAttachments(fd, user.id);
    const s = await db.signRequest.create({
      data: { tenderId, title, description: t(fd, "description") || null, initiatedBy: "COMPANY", status: "PENDING_CLIENT", companySignerId: user.id, companySignerName: signerName, companySignature: signature, companySignedAt: new Date(), companyIp: ip() },
    });
    const n = await saveAttachments(fd, "sign_request", s.id, user.id);
    if (!n) {
      await db.signRequest.delete({ where: { id: s.id } });
      throw new AppError("أرفق المستند المطلوب توقيعه (PDF أو صورة)");
    }
    const att = await db.attachment.findFirst({ where: { entityType: "sign_request", entityId: s.id }, orderBy: { id: "asc" } });
    if (att) await db.signRequest.update({ where: { id: s.id }, data: { attachmentId: att.id, docHash: await documentHash(att.id) } });
    return "وُقّع المستند من الشركة وأُرسل للعميل للتوقيع";
  });
  done(tenderId);
  return r;
}

/** توقيع الشركة على مستند رفعه العميل */
export async function companySign(tenderId: number, signId: number, _: ActionState, fd: FormData): Promise<ActionState> {
  const r = await run(async () => {
    const user = await actionUser(can.managePortal);
    await assertTenderAccess(user, tenderId);
    const s = await db.signRequest.findFirst({ where: { id: signId, tenderId } });
    if (!s || s.status !== "PENDING_COMPANY") throw new AppError("المستند ليس بانتظار توقيع الشركة");
    if (fd.get("reject") === "1") {
      const reason = t(fd, "reason");
      if (!reason) throw new AppError("اكتب سبب الرفض");
      await db.signRequest.update({ where: { id: signId }, data: { status: "REJECTED", rejectReason: `الشركة: ${reason}` } });
      return "رُفض المستند";
    }
    const signerName = t(fd, "signerName") || user.name;
    const signature = t(fd, "signature");
    checkSignature(signature, signerName);
    await db.signRequest.update({ where: { id: signId }, data: { status: "COMPLETED", companySignerId: user.id, companySignerName: signerName, companySignature: signature, companySignedAt: new Date(), companyIp: ip() } });
    return "وُقّع المستند — مكتمل من الطرفين";
  });
  done(tenderId);
  return r;
}

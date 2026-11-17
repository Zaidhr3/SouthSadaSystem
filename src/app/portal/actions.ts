"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { clientIp, endClientSession, getClient, requireClientProject, startClientSession } from "@/lib/client-session";
import { checkSignature, saveClientFiles } from "@/lib/portal";
import { notify } from "@/lib/notify";

export type PortalState = { error?: string; ok?: string };
const t = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const fail = (error: string): PortalState => ({ error });

/** محاولات الدخول الفاشلة: 8 خلال 15 دقيقة لكل بريد ← إيقاف مؤقت (في ذاكرة نسخة الخادم — حماية أساسية من التخمين) */
const failures = new Map<string, number[]>();
const DUMMY_HASH = bcrypt.hashSync("no-such-client", 10);

export async function clientLogin(_: PortalState, fd: FormData): Promise<PortalState> {
  const email = t(fd, "email").toLowerCase();
  const password = String(fd.get("password") ?? "");
  const now = Date.now();
  const recent = (failures.get(email) ?? []).filter((x) => now - x < 15 * 60_000);
  if (recent.length >= 8) return fail("محاولات كثيرة — حاول بعد 15 دقيقة");
  const c = await db.client.findUnique({ where: { email } });
  // مقارنة دائماً (حتى لو البريد غير موجود) حتى لا يُكشف وجود الحساب من زمن الاستجابة
  const ok = await bcrypt.compare(password, c?.passwordHash ?? DUMMY_HASH);
  if (!c || !ok) {
    failures.set(email, [...recent, now]);
    return fail("البريد أو كلمة المرور غير صحيحة");
  }
  if (!c.active) return fail("الحساب موقوف — تواصل مع شركة صدى الجنوب");
  failures.delete(email);
  await db.client.update({ where: { id: c.id }, data: { lastLoginAt: new Date() } });
  await startClientSession(c);
  redirect(c.mustChangePassword ? "/portal/password" : "/portal");
}

export async function clientLogout() {
  endClientSession();
  redirect("/portal/login");
}

export async function clientChangePassword(_: PortalState, fd: FormData): Promise<PortalState> {
  const c = await getClient();
  if (!c) redirect("/portal/login");
  const current = String(fd.get("current") ?? "");
  const next = String(fd.get("next") ?? "");
  if (!(await bcrypt.compare(current, c.passwordHash))) return fail("كلمة المرور الحالية غير صحيحة");
  if (next.length < 8 || !/\d/.test(next) || !/\D/.test(next)) return fail("كلمة المرور الجديدة 8 خانات على الأقل وتجمع أحرفاً وأرقاماً");
  if (next !== String(fd.get("confirm") ?? "")) return fail("تأكيد كلمة المرور غير مطابق");
  const updated = await db.client.update({ where: { id: c.id }, data: { passwordHash: await bcrypt.hash(next, 10), mustChangePassword: false } });
  await startClientSession(updated);
  redirect("/portal");
}

export async function clientMessage(tenderId: number, _: PortalState, fd: FormData): Promise<PortalState> {
  const c = await requireClientProject(tenderId);
  const body = t(fd, "body");
  if (!body) return fail("اكتب رسالتك");
  if (body.length > 5000) return fail("الرسالة طويلة جداً");
  try {
    const m = await db.portalMessage.create({ data: { tenderId, fromClientId: c.id, senderName: `${c.name} (${c.kind === "OWNER" ? "المالك" : "المهندس المشرف"})`, body, readByClientAt: new Date() } });
    await saveClientFiles(fd, "portal_message", m.id, tenderId, c.name);
    await db.portalMessage.updateMany({ where: { tenderId, fromUserId: { not: null }, readByClientAt: null }, data: { readByClientAt: new Date() } });
    await notify(["ADMIN", { managerOf: tenderId }], { title: `رسالة من العميل: ${c.name}`, body: body.slice(0, 160), href: `/tenders/${tenderId}/portal` });
  } catch (e) {
    return fail(e instanceof Error ? e.message : "تعذر الإرسال");
  }
  revalidatePath(`/portal/${tenderId}`);
  return { ok: "أُرسلت رسالتك" };
}

/** العميل يوقّع مستنداً أرسلته الشركة، أو يرفضه بسبب */
export async function clientSign(tenderId: number, signId: number, _: PortalState, fd: FormData): Promise<PortalState> {
  const c = await requireClientProject(tenderId);
  const s = await db.signRequest.findFirst({ where: { id: signId, tenderId } });
  if (!s || s.status !== "PENDING_CLIENT") return fail("المستند ليس بانتظار توقيعك");
  if (fd.get("reject") === "1") {
    const reason = t(fd, "reason");
    if (!reason) return fail("اكتب سبب الرفض");
    await db.signRequest.update({ where: { id: signId }, data: { status: "REJECTED", clientId: c.id, rejectReason: `العميل (${c.name}): ${reason}` } });
  } else {
    const signerName = t(fd, "signerName");
    const signature = t(fd, "signature");
    if (fd.get("agree") !== "on") return fail("أكّد اطلاعك على المستند وموافقتك عليه");
    try {
      checkSignature(signature, signerName);
    } catch (e) {
      return fail(e instanceof Error ? e.message : "توقيع غير صالح");
    }
    await db.signRequest.update({ where: { id: signId }, data: { status: "COMPLETED", clientId: c.id, clientSignerName: signerName, clientSignature: signature, clientSignedAt: new Date(), clientIp: clientIp() } });
  }
  await notify(["ADMIN", { managerOf: tenderId }], { title: `${fd.get("reject") === "1" ? "رفض" : "وقّع"} العميل: ${s.title}`, body: c.name, href: `/tenders/${tenderId}/portal` });
  revalidatePath(`/portal/${tenderId}`);
  return { ok: fd.get("reject") === "1" ? "سُجّل رفضك" : "تم التوقيع — شكراً لك" };
}

/** العميل يرفع مستنداً ويوقّعه ← بانتظار توقيع الشركة */
export async function clientCreateSign(tenderId: number, _: PortalState, fd: FormData): Promise<PortalState> {
  const c = await requireClientProject(tenderId);
  const title = t(fd, "title");
  const signerName = t(fd, "signerName");
  const signature = t(fd, "signature");
  if (!title) return fail("اكتب عنوان المستند");
  try {
    checkSignature(signature, signerName);
    const s = await db.signRequest.create({ data: { tenderId, title, description: t(fd, "description") || null, initiatedBy: "CLIENT", status: "PENDING_COMPANY", clientId: c.id, clientSignerName: signerName, clientSignature: signature, clientSignedAt: new Date(), clientIp: clientIp() } });
    const n = await saveClientFiles(fd, "sign_request", s.id, tenderId, c.name);
    if (!n) {
      await db.signRequest.delete({ where: { id: s.id } });
      return fail("أرفق المستند المطلوب توقيعه");
    }
    const { documentHash } = await import("@/lib/portal");
    const att = await db.attachment.findFirst({ where: { entityType: "sign_request", entityId: s.id }, orderBy: { id: "asc" } });
    if (att) await db.signRequest.update({ where: { id: s.id }, data: { attachmentId: att.id, docHash: await documentHash(att.id) } });
    await notify(["ADMIN", { managerOf: tenderId }], { title: `مستند من العميل بانتظار توقيع الشركة`, body: `${title} — ${c.name}`, href: `/tenders/${tenderId}/portal` });
  } catch (e) {
    return fail(e instanceof Error ? e.message : "تعذر الحفظ");
  }
  revalidatePath(`/portal/${tenderId}`);
  return { ok: "أُرسل المستند موقّعاً منك — بانتظار توقيع الشركة" };
}

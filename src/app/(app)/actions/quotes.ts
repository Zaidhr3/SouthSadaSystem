"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { actionUser } from "@/lib/auth";
import { run, type ActionState } from "@/lib/action";
import { AppError, can, type AppUser } from "@/lib/permissions";
import { notify } from "@/lib/notify";
import { saveAttachments, validateAttachments } from "@/lib/uploads";
import { todayUTC } from "@/lib/format";
import { pickPm } from "@/lib/quotes";

const num = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").replace(/,/g, "").trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) throw new AppError("قيمة رقمية غير صالحة");
  return n;
};
const text = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

async function load(id: number) {
  const q = await db.quoteRequest.findUnique({ where: { id } });
  if (!q) throw new AppError("الطلب غير موجود");
  return q;
}
async function log(quoteId: number, user: AppUser, action: string, note?: string | null) {
  await db.quoteEvent.create({ data: { quoteId, action, note: note || null, userId: user.id, userName: user.name } });
}
const done = (id: number) => {
  revalidatePath("/quotes");
  revalidatePath(`/quotes/${id}`);
};

/** مدير المشروع: دراسة الطلب وتقدير التكلفة والسعر المقترح ← المحاسب */
export async function pmSubmitQuote(id: number, _: ActionState, fd: FormData): Promise<ActionState> {
  const r = await run(async () => {
    const user = await actionUser(can.handleQuotes);
    const q = await load(id);
    if (!["PM_REVIEW", "RETURNED"].includes(q.status)) throw new AppError("الطلب ليس في مرحلة دراسة مدير المشروع");
    if (user.role === "PM" && q.assignedPmId !== user.id) throw new AppError("هذا الطلب غير مسند إليك");
    const pmNotes = text(fd, "pmNotes");
    const pmPrice = num(fd.get("pmPrice"));
    if (!pmNotes) throw new AppError("اكتب دراستك للطلب (نطاق العمل، الملاحظات، المتطلبات)");
    if (pmPrice == null) throw new AppError("أدخل السعر المقترح للعرض");
    await validateAttachments(fd, user.id);
    await db.quoteRequest.update({ where: { id }, data: { pmNotes, pmEstimate: num(fd.get("pmEstimate")), pmPrice, pmSubmittedAt: new Date(), status: "ACCOUNTANT_REVIEW", assignedPmId: q.assignedPmId ?? user.id } });
    await saveAttachments(fd, "quote", id, user.id);
    await log(id, user, "PM_SUBMITTED", `السعر المقترح ${pmPrice.toLocaleString("en-US")} د.أ`);
    await notify(["ACCOUNTANT"], { title: `طلب تسعير بانتظار التدقيق: ${q.ref}`, body: `${q.projectType} — ${q.name}`, href: `/quotes/${id}` }, { exclude: user.id });
    return "أُرسلت الدراسة للمحاسب للتدقيق";
  });
  done(id);
  return r;
}

/** المحاسب: قبول ورفع للإدارة، أو إرجاع لمدير المشروع للتعديل بملاحظات */
export async function accountantQuote(id: number, decision: "accept" | "return", _: ActionState, fd: FormData): Promise<ActionState> {
  const r = await run(async () => {
    const user = await actionUser(can.auditQuotes);
    const q = await load(id);
    if (q.status !== "ACCOUNTANT_REVIEW") throw new AppError("الطلب ليس لدى المحاسب");
    const note = text(fd, "note");
    if (decision === "return") {
      if (!note) throw new AppError("اكتب ملاحظات الإرجاع لمدير المشروع");
      await db.quoteRequest.update({ where: { id }, data: { status: "RETURNED", accountantNotes: note } });
      await log(id, user, "RETURNED", note);
      if (q.assignedPmId) await notify([q.assignedPmId], { title: `أُعيد طلب التسعير للتعديل: ${q.ref}`, body: note, href: `/quotes/${id}` });
      return "أُعيد الطلب لمدير المشروع للتعديل";
    }
    await db.quoteRequest.update({ where: { id }, data: { status: "ADMIN_REVIEW", accountantNotes: note || q.accountantNotes } });
    await log(id, user, "AUDITED", note);
    await notify(["ADMIN"], { title: `طلب تسعير بانتظار الاعتماد: ${q.ref}`, body: `${q.projectType} — ${q.name} — ${q.pmPrice?.toLocaleString("en-US") ?? ""} د.أ`, href: `/quotes/${id}` }, { exclude: user.id });
    return "دُقق الطلب ورُفع للإدارة للاعتماد";
  });
  done(id);
  return r;
}

/** الإدارة: اعتماد نهائي (مع إنشاء مشروع خاص اختيارياً) أو رفض */
export async function adminQuote(id: number, decision: "approve" | "reject", _: ActionState, fd: FormData): Promise<ActionState> {
  const r = await run(async () => {
    const user = await actionUser(can.approveQuotes);
    const q = await load(id);
    if (q.status !== "ADMIN_REVIEW") throw new AppError("الطلب ليس بانتظار اعتماد الإدارة");
    const note = text(fd, "note");
    if (decision === "reject") {
      if (!note) throw new AppError("اكتب سبب الرفض");
      await db.quoteRequest.update({ where: { id }, data: { status: "REJECTED", adminNotes: note, decidedAt: new Date() } });
      await log(id, user, "REJECTED", note);
      if (q.assignedPmId) await notify([q.assignedPmId], { title: `رُفض طلب التسعير ${q.ref}`, body: note, href: `/quotes/${id}` });
      return "رُفض الطلب";
    }
    let tenderId: number | null = null;
    if (fd.get("createProject") === "on") {
      const today = todayUTC();
      const t = await db.tender.create({
        data: {
          kind: "PRIVATE",
          name: `${q.projectType} — ${q.name}`.slice(0, 200),
          number: q.ref,
          entity: q.name,
          location: q.city,
          classification: q.projectType,
          status: "SUBMITTED",
          purchaseDate: today,
          deadline: today,
          docFee: 0,
          bidAmount: q.pmPrice,
          managerId: q.assignedPmId,
          notes: `من طلب الموقع ${q.ref}\nالهاتف: ${q.phone}\n${q.details}${q.pmNotes ? `\n\nدراسة مدير المشروع:\n${q.pmNotes}` : ""}`,
        },
      });
      tenderId = t.id;
      // نقل مرفقات الدراسة للمشروع الجديد
      await db.attachment.updateMany({ where: { entityType: "quote", entityId: id }, data: { entityType: "tender", entityId: t.id } });
    }
    await db.quoteRequest.update({ where: { id }, data: { status: "APPROVED", adminNotes: note || null, decidedAt: new Date(), tenderId } });
    await log(id, user, "APPROVED", tenderId ? `${note ? note + " — " : ""}أُنشئ مشروع خاص` : note);
    if (q.assignedPmId) await notify([q.assignedPmId], { title: `اعتُمد عرض السعر ${q.ref}`, body: `${q.projectType} — ${q.name}. تواصل مع العميل على ${q.phone}`, href: tenderId ? `/tenders/${tenderId}` : `/quotes/${id}` });
    return tenderId ? "اعتُمد العرض وأُنشئ مشروع خاص" : "اعتُمد العرض";
  });
  done(id);
  return r;
}

/** الإدارة: حجز كوهمي / استعادة طلب حُجز بالخطأ / إعادة الإسناد */
export async function manageQuote(id: number, action: "spam" | "restore" | "assign", _: ActionState, fd: FormData): Promise<ActionState> {
  const r = await run(async () => {
    const user = await actionUser(can.approveQuotes);
    const q = await load(id);
    if (action === "spam") {
      await db.quoteRequest.update({ where: { id }, data: { status: "SPAM" } });
      await log(id, user, "SPAM", text(fd, "note") || "حُجز يدوياً كطلب وهمي");
      return "حُجز الطلب كوهمي";
    }
    let pmId = Number(fd.get("pmId")) || null;
    // الاستعادة بلا اختيار: يُسند تلقائياً لمدير المشروع الأقل انشغالاً حتى لا يبقى الطلب بلا مسؤول
    if (!pmId && action === "restore" && !q.assignedPmId) pmId = await pickPm();
    if (pmId) {
      const pm = await db.user.findFirst({ where: { id: pmId, active: true, role: { in: ["PM", "ADMIN"] } } });
      if (!pm) throw new AppError("اختر مدير مشروع فعّالاً");
    }
    await db.quoteRequest.update({ where: { id }, data: { assignedPmId: pmId ?? q.assignedPmId, ...(action === "restore" ? { status: "PM_REVIEW" } : {}) } });
    await log(id, user, action === "restore" ? "RESTORED" : "ASSIGNED", text(fd, "note") || null);
    if (pmId) await notify([pmId], { title: `أُسند إليك طلب تسعير: ${q.ref}`, body: `${q.projectType} — ${q.name}`, href: `/quotes/${id}` }, { exclude: user.id });
    return action === "restore" ? "استُعيد الطلب ووُجّه لمدير المشروع" : "أُعيد إسناد الطلب";
  });
  done(id);
  return r;
}

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db, type Tx } from "@/lib/db";
import { actionUser, assertTenderAccess } from "@/lib/auth";
import { auditEvent, run, type ActionState } from "@/lib/action";
import { AppError, type AppUser } from "@/lib/permissions";
import { DIRECTION } from "@/lib/labels";
import { formObject, zDate, zOptId, zOptText, zText } from "@/lib/validation";
import { attachedFileNames, saveAttachments, validateAttachments } from "@/lib/uploads";
import { canEditLetter, canReviewLetter, firstLetterStep, letterState } from "@/lib/letter-flow";
import { notify } from "@/lib/notify";

const schema = z.object({
  date: zDate("التاريخ"),
  party: zText("الجهة الموجه لها الكتاب"),
  subject: zText("موضوع الكتاب"),
  body: z.preprocess((v) => (typeof v === "string" ? v.trim() : v), z.string({ required_error: "نص الكتاب مطلوب" }).min(10, "نص الكتاب قصير").max(20000, "نص الكتاب طويل جداً")),
  cc: zOptText,
  tenderId: zOptId,
  replyToId: zOptId,
  attachmentNames: zOptText,
});

const href = (id: number) => `/correspondence/letters/${id}`;

function refresh(id: number, tenderId: number | null) {
  revalidatePath("/correspondence");
  revalidatePath(href(id));
  if (tenderId) revalidatePath(`/tenders/${tenderId}`);
}

/** الرد والمشروع والصلاحية — مشترك بين الإنشاء والتعديل */
async function resolveLinks(user: AppUser, d: z.infer<typeof schema>) {
  let replyTo = null as Awaited<ReturnType<typeof db.correspondence.findUnique>>;
  if (d.replyToId) {
    replyTo = await db.correspondence.findUnique({ where: { id: d.replyToId } });
    if (!replyTo || replyTo.direction !== "IN") throw new AppError("الكتاب المردود عليه يجب أن يكون كتاباً وارداً");
    if (!d.tenderId && replyTo.tenderId) d.tenderId = replyTo.tenderId;
  }
  if (user.role === "PM" && !d.tenderId) throw new AppError("اختر المشروع");
  if (d.tenderId) await assertTenderAccess(user, d.tenderId);
  return replyTo;
}

/** الاعتماد النهائي: يُعطى رقم الصادر التسلسلي (ص/السنة/التسلسل) بتاريخ الكتاب */
async function approveAndNumber(tx: Tx, id: number, date: Date, userId: number) {
  const year = date.getUTCFullYear();
  const last = await tx.correspondence.aggregate({ where: { direction: "OUT", year }, _max: { seq: true } });
  const seq = (last._max.seq ?? 0) + 1;
  return tx.correspondence.update({
    where: { id },
    data: { year, seq, refNo: `${DIRECTION.OUT.prefix}/${year}/${String(seq).padStart(4, "0")}`, letterStatus: "APPROVED", approvedById: userId, approvedAt: new Date(), reviewNote: null },
  });
}

/** إشعار المحطة التالية بعد تقديم/اعتماد/إعادة */
async function routeNotice(rec: { id: number; subject: string; refNo: string; letterStatus: string | null; createdById: number; tenderId: number | null; reviewNote: string | null }, by: AppUser) {
  const link = href(rec.id);
  if (rec.letterStatus === "PENDING_ACCOUNTANT") await notify(["ACCOUNTANT"], { title: "كتاب رسمي بانتظار مراجعتك", body: `${by.name}: «${rec.subject}»`, href: link }, { exclude: by.id });
  else if (rec.letterStatus === "PENDING_ADMIN") await notify(["ADMIN"], { title: "كتاب رسمي بانتظار اعتمادك", body: `${by.name}: «${rec.subject}»`, href: link }, { exclude: by.id });
  else if (rec.letterStatus === "APPROVED") {
    await notify([rec.createdById, ...(rec.tenderId ? [{ managerOf: rec.tenderId }] : [])], { title: `اعتُمد الكتاب ${rec.refNo} — جاهز للطباعة`, body: `«${rec.subject}» — نزّل نسخة PDF على ورقة الشركة واطبعها`, href: link }, { exclude: by.id });
  } else if (rec.letterStatus === "RETURNED") {
    await notify([rec.createdById], { title: "أُعيد كتاب رسمي للتعديل", body: `«${rec.subject}» — ${by.name}: ${rec.reviewNote ?? ""}`, href: link }, { exclude: by.id });
  }
}

/**
 * إنشاء كتاب رسمي صادر: يُحفظ مسودة ويمر بمسار الاعتماد (مدير المشروع ← المحاسب ← المدير العام)،
 * ورقم الصادر يُعطى عند الاعتماد النهائي، وبعدها تُطبع نسخة PDF على ورقة الشركة الرسمية.
 * المعززات تُحفظ في أرشيف الكتاب (وتظهر في ملف العطاء).
 */
export async function createOfficialLetter(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await actionUser();
    const d = schema.parse(formObject(fd));
    const replyTo = await resolveLinks(user, d);
    await validateAttachments(fd, user.id);
    const fileNames = await attachedFileNames(fd, user.id);
    const listed = (d.attachmentNames ?? "").split("\n").map((s) => s.trim()).filter(Boolean);
    const attachments = listed.length ? listed : fileNames.map((n) => n.replace(/\.[^.]+$/, ""));

    let rec = await db.$transaction(async (tx) => {
      // رقم مؤقت فريد حتى الاعتماد (لا يُستهلك رقم صادر لكتاب لم يُعتمد)
      const tmp = -Math.floor(Math.random() * 1e9) - 1;
      const c = await tx.correspondence.create({
        data: {
          direction: "OUT", year: 0, seq: tmp, refNo: `مسودة${tmp}`, date: d.date, party: d.party, subject: d.subject,
          body: d.body, cc: d.cc, tenderId: d.tenderId, replyToId: replyTo?.id ?? null, theirRef: null,
          letterAttachments: attachments.join("\n") || null, letterStatus: "PENDING_ACCOUNTANT", createdById: user.id,
        },
      });
      return tx.correspondence.update({ where: { id: c.id }, data: { seq: -c.id, refNo: `مسودة-${c.id}`, letterStatus: firstLetterStep() } });
    });
    try {
      await saveAttachments(fd, "correspondence", rec.id, user.id, "files", { label: "معززات الكتاب" });
    } catch (e) {
      await db.attachment.deleteMany({ where: { entityType: "correspondence", entityId: rec.id } }).catch(() => undefined);
      await db.correspondence.delete({ where: { id: rec.id } }).catch(() => undefined);
      throw e instanceof AppError ? e : new AppError("تعذر حفظ معززات الكتاب — لم يُحفظ الكتاب. أعد المحاولة");
    }
    rec = (await db.correspondence.findUnique({ where: { id: rec.id } }))!;
    await auditEvent("create", "Correspondence", `كتاب رسمي (مسودة بانتظار المحاسب) إلى ${rec.party}: ${rec.subject}${replyTo ? ` — رداً على ${replyTo.refNo}` : ""}`, user, { recordId: rec.id });
    await routeNotice(rec, user);
    refresh(rec.id, rec.tenderId);
    return "حُفظ الكتاب وأُرسل إلى المحاسب للمراجعة، ثم المدير العام للاعتماد — يُعطى رقم الصادر ويُطبع بعد الاعتماد";
  });
}

/** تعديل الكتاب قبل اعتماده (المنشئ عند الإعادة، أو المراجع في محطته). تعديل المنشئ لكتاب مُعاد = إعادة تقديم. */
export async function updateOfficialLetter(id: number, _: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await actionUser();
    const cur = await db.correspondence.findUnique({ where: { id } });
    if (!cur || !letterState(cur)) throw new AppError("الكتاب غير موجود");
    if (!canEditLetter(user, cur)) throw new AppError("لا يمكنك تعديل هذا الكتاب في مرحلته الحالية");
    const d = schema.parse(formObject(fd));
    const replyTo = await resolveLinks(user, d);
    const listed = (d.attachmentNames ?? "").split("\n").map((s) => s.trim()).filter(Boolean);
    const resubmit = cur.letterStatus === "RETURNED" && cur.createdById === user.id;
    let rec = await db.correspondence.update({
        where: { id },
        data: {
          date: d.date, party: d.party, subject: d.subject, body: d.body, cc: d.cc, tenderId: d.tenderId, replyToId: replyTo?.id ?? null,
          letterAttachments: listed.length ? listed.join("\n") : cur.letterAttachments,
          ...(resubmit ? { letterStatus: firstLetterStep(), reviewNote: null, accountantById: null, accountantAt: null } : {}),
        },
      });
    await saveAttachments(fd, "correspondence", id, user.id, "files", { label: "معززات الكتاب" });
    rec = (await db.correspondence.findUnique({ where: { id } }))!;
    await auditEvent("update", "Correspondence", `تعديل الكتاب الرسمي «${rec.subject}»${resubmit ? " وإعادة تقديمه" : ""}`, user, { recordId: id, before: cur, after: rec });
    if (resubmit) await routeNotice(rec, user);
    refresh(id, rec.tenderId);
    return resubmit ? "عُدّل الكتاب وأُعيد تقديمه — بانتظار مراجعة المحاسب" : "حُفظت التعديلات";
  });
}

/** قرار المراجع: اعتماد (ينتقل للمحطة التالية أو يُعطى رقم الصادر) أو إعادة للمنشئ بملاحظة */
export async function reviewOfficialLetter(id: number, _: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await actionUser();
    const decision = String(fd.get("decision") ?? "");
    const note = String(fd.get("note") ?? "").trim() || null;
    const cur = await db.correspondence.findUnique({ where: { id } });
    if (!cur || !letterState(cur)) throw new AppError("الكتاب غير موجود");
    if (!canReviewLetter(user, cur)) throw new AppError("الكتاب ليس بانتظار قرارك");
    if (decision === "return") {
      if (!note) throw new AppError("اكتب سبب الإعادة والتعديل المطلوب");
      const rec = await db.correspondence.update({ where: { id }, data: { letterStatus: "RETURNED", reviewNote: note } });
      await auditEvent("update", "Correspondence", `إعادة الكتاب الرسمي «${rec.subject}» للتعديل: ${note}`, user, { recordId: id });
      await routeNotice(rec, user);
      refresh(id, rec.tenderId);
      return "أُعيد الكتاب إلى منشئه مع الملاحظة";
    }
    if (decision !== "approve") throw new AppError("قرار غير معروف");
    const rec = await db.$transaction(async (tx) => {
      if (user.role === "ADMIN") {
        if (note) await tx.correspondence.update({ where: { id }, data: { notes: [cur.notes, `المدير العام: ${note}`].filter(Boolean).join(" | ") } });
        return approveAndNumber(tx, id, cur.date, user.id);
      }
      return tx.correspondence.update({ where: { id }, data: { letterStatus: "PENDING_ADMIN", accountantById: user.id, accountantAt: new Date(), reviewNote: null, ...(note ? { notes: [cur.notes, `المحاسب: ${note}`].filter(Boolean).join(" | ") } : {}) } });
    });
    await auditEvent("update", "Correspondence", rec.letterStatus === "APPROVED" ? `اعتماد الكتاب الرسمي ${rec.refNo} «${rec.subject}»` : `مراجعة المحاسب للكتاب «${rec.subject}» ورفعه للمدير العام`, user, { recordId: id });
    await routeNotice(rec, user);
    refresh(id, rec.tenderId);
    return rec.letterStatus === "APPROVED" ? `اعتُمد الكتاب برقم الصادر ${rec.refNo} — أصبح جاهزاً للطباعة` : "رُفع الكتاب إلى المدير العام للاعتماد";
  });
}

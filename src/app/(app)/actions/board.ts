"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { actionUser } from "@/lib/auth";
import { auditEvent, run, type ActionState } from "@/lib/action";
import { AppError, can } from "@/lib/permissions";
import { notify } from "@/lib/notify";
import { closeMotion, createMotion, notifyBoard, seatOf, sendFastTrackMemo, tally, MOTION_KIND } from "@/lib/board/motions";
import { runRoast } from "@/lib/board/roast";
import { DEFAULT_BOARD } from "@/lib/board/seats";

const t = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const done = (id?: number) => {
  revalidatePath("/board");
  if (id) revalidatePath(`/board/${id}`);
};

/** رفع بند جديد للمجلس (يمر أولاً على تدقيق المحاسب) */
export async function submitMotion(_: ActionState, fd: FormData): Promise<ActionState> {
  let id = 0;
  const r = await run(async () => {
    const user = await actionUser((r) => r === "ADMIN" || r === "ACCOUNTANT");
    const kind = t(fd, "kind");
    if (!(kind in MOTION_KIND)) throw new AppError("اختر نوع البند");
    const title = t(fd, "title");
    const details = t(fd, "details");
    if (title.length < 4) throw new AppError("اكتب عنواناً واضحاً للبند");
    if (details.length < 10) throw new AppError("اشرح البند ومبرراته (10 أحرف على الأقل)");
    const amountRaw = t(fd, "amount").replace(/,/g, "");
    const amount = amountRaw ? Number(amountRaw) : null;
    if (amount != null && (!Number.isFinite(amount) || amount < 0)) throw new AppError("قيمة غير صالحة");
    const refId = Number(t(fd, "refId")) || null;
    if (kind === "FUND" && refId) {
      const f = await db.fundRequest.findUnique({ where: { id: refId } });
      if (!f || f.status !== "PENDING") throw new AppError("طلب التمويل غير موجود أو تم البت فيه");
    }
    const m = await createMotion({ kind, refId, title, details, amount }, user);
    await auditEvent("CREATE", "BoardMotion", `رفع بند لمجلس الإدارة ${m.ref}: ${title}`, user, { recordId: m.id });
    id = m.id;
    return `رُفع البند ${m.ref} — بانتظار تدقيق المحاسب`;
  });
  done();
  if (r.ok && id) redirect(`/board/${id}`);
  return r;
}

/** المحاسب: تدقيق البند ← رفعه للمجلس، أو إعادته لمقدّمه بملاحظات */
export async function auditMotion(id: number, decision: "pass" | "return", _: ActionState, fd: FormData): Promise<ActionState> {
  const r = await run(async () => {
    const user = await actionUser(can.auditBoard);
    const m = await db.boardMotion.findUnique({ where: { id } });
    if (!m || m.status !== "AUDIT") throw new AppError("البند ليس بانتظار التدقيق");
    const note = t(fd, "note");
    if (decision === "return") {
      if (note.length < 5) throw new AppError("اكتب ملاحظات الإرجاع");
      await db.boardMotion.update({ where: { id }, data: { status: "RETURNED", auditorId: user.id, auditNote: note, auditedAt: new Date() } });
      await notify([m.submittedById], { title: `أُعيد البند ${m.ref} من المحاسب`, body: note, href: `/board/${id}` });
      return "أُعيد البند لمقدّمه";
    }
    if (note.length < 5) throw new AppError("اكتب خلاصة تدقيقك (الأرقام، المستندات، الملاحظات) — يقرؤها الأعضاء قبل التصويت");
    await db.boardMotion.update({ where: { id }, data: { status: "VOTING", auditorId: user.id, auditNote: note, auditedAt: new Date() } });
    await notifyBoard(id, `بند للتصويت: ${m.title}`, `دققه المحاسب: ${note.slice(0, 140)}`, user.id);
    return "دُقق البند ورُفع لمجلس الإدارة للتصويت";
  });
  done(id);
  return r;
}

/** تصويت عضو المجلس (يمكن تعديل الصوت قبل الحسم) — يُحسم البند تلقائياً عند بلوغ الأغلبية */
export async function castVote(id: number, vote: "YES" | "NO" | "ABSTAIN", _: ActionState, fd: FormData): Promise<ActionState> {
  const r = await run(async () => {
    const user = await actionUser();
    if (!(await seatOf(user.id))) throw new AppError("التصويت لأعضاء مجلس الإدارة فقط");
    const m = await db.boardMotion.findUnique({ where: { id } });
    if (!m || m.status !== "VOTING") throw new AppError("البند ليس مفتوحاً للتصويت");
    const note = t(fd, "note") || null;
    if (vote === "NO" && !note) throw new AppError("اكتب سبب عدم الموافقة — يظهر لباقي الأعضاء");
    await db.boardVote.upsert({ where: { motionId_userId: { motionId: id, userId: user.id } }, create: { motionId: id, userId: user.id, userName: user.name, vote, note }, update: { vote, note } });
    await auditEvent("VOTE", "BoardMotion", `صوت ${user.name} على ${m.ref}: ${vote}`, user, { recordId: id });
    const tl = await tally(id);
    if (tl.outcome) {
      await closeMotion(id, tl.outcome, "VOTE", user);
      return tl.outcome === "APPROVED" ? `سُجل صوتك — واعتُمد البند بأغلبية ${tl.yes} من ${tl.seats}` : `سُجل صوتك — ورُفض البند بأغلبية ${tl.no} من ${tl.seats}`;
    }
    return `سُجل صوتك (${tl.cast} من ${tl.seats} صوّتوا — الحسم عند ${tl.need})`;
  });
  done(id);
  return r;
}

/**
 * رئيس المجلس: قرار فوري دون انتظار التصويت.
 * إلزامي: سبب الاستعجال — يُرسل تلقائياً كمراسلة داخلية لكل عضو في المجلس، ويُوثق في البند وسجل الرقابة.
 */
export async function chairFastTrack(id: number, outcome: "APPROVED" | "REJECTED", _: ActionState, fd: FormData): Promise<ActionState> {
  const r = await run(async () => {
    const user = await actionUser();
    if ((await seatOf(user.id)) !== "CHAIR") throw new AppError("القرار الفوري لرئيس مجلس الإدارة فقط");
    const m = await db.boardMotion.findUnique({ where: { id } });
    if (!m || !["AUDIT", "VOTING"].includes(m.status)) throw new AppError("تم البت في هذا البند مسبقاً");
    const reason = t(fd, "reason");
    if (reason.length < 15) throw new AppError("اكتب سبب القرار الفوري بوضوح (15 حرفاً على الأقل) — سيصل لأعضاء المجلس كمراسلة داخلية");
    const sent = await sendFastTrackMemo(m, user, reason, outcome);
    await closeMotion(id, outcome, "CHAIR_FAST", user, reason);
    await auditEvent("CHAIR_FAST", "BoardMotion", `قرار فوري من رئيس المجلس (${outcome}) على ${m.ref} — السبب: ${reason}`, user, { recordId: id });
    return `${outcome === "APPROVED" ? "اعتُمد" : "رُفض"} البند فوراً، وأُرسلت مذكرة السبب إلى ${sent} ${sent === 1 ? "عضو" : "أعضاء"}`;
  });
  done(id);
  revalidatePath("/messages");
  return r;
}

export async function withdrawMotion(id: number, _: ActionState, __: FormData): Promise<ActionState> {
  const r = await run(async () => {
    const user = await actionUser();
    const m = await db.boardMotion.findUnique({ where: { id } });
    if (!m || !["AUDIT", "VOTING", "RETURNED"].includes(m.status)) throw new AppError("لا يمكن سحب هذا البند");
    if (m.submittedById !== user.id && (await seatOf(user.id)) !== "CHAIR") throw new AppError("يسحب البند مقدّمه أو رئيس المجلس فقط");
    await db.boardMotion.update({ where: { id }, data: { status: "WITHDRAWN" } });
    return "سُحب البند";
  });
  done(id);
  return r;
}

/** غرفة النقد: يعرض البند (أو أي قرار) على 7 مستشارين بالذكاء الاصطناعي قبل التصويت */
export type RoastState = ActionState & { result?: Awaited<ReturnType<typeof runRoast>> };
export async function roastAction(motionId: number | null, _: RoastState, fd: FormData): Promise<RoastState> {
  try {
    const user = await actionUser();
    if (!(user.role === "ADMIN" || user.role === "ACCOUNTANT")) throw new AppError("غرفة النقد للإدارة والمحاسب");
    const seats = fd.getAll("seats").map(String).filter(Boolean);
    let decision = t(fd, "decision");
    if (motionId) {
      const m = await db.boardMotion.findUnique({ where: { id: motionId } });
      if (!m) throw new AppError("البند غير موجود");
      decision = `${MOTION_KIND[m.kind] ?? m.kind}: ${m.title}\n${m.details}${m.amount ? `\nالقيمة: ${m.amount.toLocaleString("en-US")} دينار أردني` : ""}${m.auditNote ? `\nملاحظات تدقيق المحاسب: ${m.auditNote}` : ""}${decision ? `\nسياق إضافي: ${decision}` : ""}`;
    }
    if (decision.length < 15) throw new AppError("اشرح القرار بجملة أو أكثر حتى يناقشه المستشارون");
    const result = await runRoast(decision, seats.length ? seats : DEFAULT_BOARD);
    if (motionId) {
      await db.boardMotion.update({ where: { id: motionId }, data: { roast: JSON.parse(JSON.stringify(result)) } });
      done(motionId);
    }
    return { ok: true, message: "انعقدت غرفة النقد", result, ts: Date.now() };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "تعذر تشغيل غرفة النقد", ts: Date.now() };
  }
}

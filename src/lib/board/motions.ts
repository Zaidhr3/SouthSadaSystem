import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "../db";
import { notify } from "../notify";
import { AppError, type AppUser } from "../permissions";

/**
 * مجلس الإدارة — دورة البند:
 *   AUDIT (تدقيق المحاسب) ← VOTING (تصويت الأعضاء) ← APPROVED / REJECTED
 *   أو: اعتماد فوري من رئيس المجلس في أي مرحلة، بسبب مكتوب يصل لكل الأعضاء كمراسلة داخلية.
 * النصاب: القرار يُحسم حين تبلغ «نعم» أو «لا» أغلبية المقاعد (أكثر من النصف) — الامتناع لا يحسم.
 */
export const MOTION_KIND: Record<string, string> = {
  QUOTE: "عرض سعر لعميل",
  FUND: "طلب تمويل / عهدة",
  VARIATION: "أمر تغيير",
  PURCHASE: "شراء / التزام مالي",
  TENDER: "دخول عطاء",
  PAYROLL: "مسير رواتب",
  GENERAL: "قرار إداري",
};
export const MOTION_STATUS: Record<string, { label: string; tone: "gray" | "blue" | "green" | "orange" | "red" | "purple" }> = {
  AUDIT: { label: "بانتظار تدقيق المحاسب", tone: "orange" },
  VOTING: { label: "أمام المجلس للتصويت", tone: "blue" },
  APPROVED: { label: "معتمد", tone: "green" },
  REJECTED: { label: "مرفوض", tone: "red" },
  RETURNED: { label: "أُعيد لمقدّمه", tone: "gray" },
  WITHDRAWN: { label: "مسحوب", tone: "gray" },
};
export const VOTE_LABEL: Record<string, string> = { YES: "موافق", NO: "غير موافق", ABSTAIN: "ممتنع" };

export async function boardSeats() {
  return db.user.findMany({ where: { boardSeat: { not: null }, active: true }, select: { id: true, name: true, boardSeat: true, title: true, avatarId: true, bio: true }, orderBy: [{ boardSeat: "asc" }, { id: "asc" }] });
}

export async function seatOf(userId: number) {
  return (await db.user.findUnique({ where: { id: userId }, select: { boardSeat: true } }))?.boardSeat ?? null;
}

async function nextRef() {
  const y = new Date().getUTCFullYear();
  const n = await db.boardMotion.count({ where: { ref: { startsWith: `BM-${y}-` } } });
  return `BM-${y}-${String(n + 1).padStart(3, "0")}`;
}

export async function createMotion(data: { kind: string; refId?: number | null; title: string; details: string; amount?: number | null; audited?: boolean }, user: AppUser) {
  const open = data.refId ? await db.boardMotion.findFirst({ where: { kind: data.kind, refId: data.refId, status: { in: ["AUDIT", "VOTING"] } } }) : null;
  if (open) return open;
  const m = await db.boardMotion.create({
    data: {
      ref: await nextRef(),
      kind: data.kind,
      refId: data.refId ?? null,
      title: data.title,
      details: data.details,
      amount: data.amount ?? null,
      submittedById: user.id,
      status: data.audited ? "VOTING" : "AUDIT",
      ...(data.audited ? { auditorId: user.id, auditedAt: new Date(), auditNote: "دُقق ضمن مسار الطلب الأصلي" } : {}),
    },
  });
  if (data.audited) await notifyBoard(m.id, `بند جديد للتصويت: ${m.title}`, m.details.slice(0, 160), user.id);
  else await notify(["ACCOUNTANT"], { title: `بند مجلس إدارة بانتظار تدقيقك: ${m.ref}`, body: m.title, href: `/board/${m.id}` }, { exclude: user.id });
  return m;
}

export async function notifyBoard(motionId: number, title: string, body: string, exclude?: number) {
  const seats = await boardSeats();
  await notify(seats.map((s) => s.id), { title, body, href: `/board/${motionId}` }, { exclude });
}

/** تطبيق القرار على الطلب الأصلي المرتبط (عرض السعر / التمويل) — بلا أي التفاف على قيود الطلب */
async function applyOutcome(m: { id: number; kind: string; refId: number | null; ref: string }, approved: boolean, by: AppUser, note: string) {
  if (!m.refId) return;
  if (m.kind === "QUOTE") {
    const q = await db.quoteRequest.findUnique({ where: { id: m.refId } });
    if (!q || q.status !== "ADMIN_REVIEW") return;
    await db.quoteRequest.update({ where: { id: q.id }, data: { status: approved ? "APPROVED" : "REJECTED", adminNotes: `قرار مجلس الإدارة ${m.ref}: ${note}`.slice(0, 2000), decidedAt: new Date() } });
    await db.quoteEvent.create({ data: { quoteId: q.id, action: approved ? "APPROVED" : "REJECTED", note: `قرار مجلس الإدارة ${m.ref}`, userId: by.id, userName: by.name } });
    if (q.assignedPmId) await notify([q.assignedPmId], { title: approved ? `اعتمد مجلس الإدارة عرض السعر ${q.ref}` : `رفض مجلس الإدارة عرض السعر ${q.ref}`, body: `${q.projectType} — ${q.name}`, href: `/quotes/${q.id}` });
  }
  if (m.kind === "PAYROLL") {
    const r = await db.payrollRun.findUnique({ where: { id: m.refId } });
    if (!r || r.status !== "SUBMITTED") return;
    await db.payrollRun.update({ where: { id: r.id }, data: approved ? { status: "APPROVED", approvedAt: new Date() } : { status: "DRAFT", note: `رُفض من المجلس (${m.ref}): ${note}`.slice(0, 1000) } });
    await notify(["ACCOUNTANT"], { title: approved ? `اعتُمد مسير الرواتب ${r.period} — جاهز للصرف` : `أُعيد مسير الرواتب ${r.period}`, body: note, href: `/payroll/runs/${r.id}` });
  }
  if (m.kind === "FUND") {
    const f = await db.fundRequest.findUnique({ where: { id: m.refId } });
    if (!f || f.status !== "PENDING") return;
    // التمويل المعتمد يمر عبر إجراء الاعتماد المالي نفسه (القيد البنكي والإشعارات)
    const { decideFund } = await import("@/app/(app)/actions/finance");
    await decideFund(f.id, approved ? "APPROVED" : "REJECTED");
  }
}

export async function closeMotion(motionId: number, outcome: "APPROVED" | "REJECTED", how: "VOTE" | "CHAIR_FAST", by: AppUser, reason?: string) {
  const m = await db.boardMotion.findUnique({ where: { id: motionId } });
  if (!m) throw new AppError("البند غير موجود");
  if (!["AUDIT", "VOTING"].includes(m.status)) throw new AppError("تم البت في هذا البند مسبقاً");
  await db.boardMotion.update({ where: { id: m.id }, data: { status: outcome, decidedBy: how, decidedById: by.id, decidedAt: new Date(), fastReason: how === "CHAIR_FAST" ? reason ?? null : null } });
  await applyOutcome(m, outcome === "APPROVED", by, reason ?? (how === "VOTE" ? "بالتصويت" : ""));
  const word = outcome === "APPROVED" ? "اعتُمد" : "رُفض";
  await notifyBoard(m.id, `${word} البند ${m.ref}: ${m.title}`, how === "CHAIR_FAST" ? `قرار فوري من رئيس المجلس — السبب: ${reason}` : "بأغلبية أصوات المجلس", by.id);
  await notify([m.submittedById, "ACCOUNTANT"], { title: `${word} البند ${m.ref}`, body: m.title, href: `/board/${m.id}` }, { exclude: by.id });
}

/** فرز الأصوات: أغلبية المقاعد تحسم */
export async function tally(motionId: number) {
  const [seats, votes] = await Promise.all([boardSeats(), db.boardVote.findMany({ where: { motionId } })]);
  const seatIds = new Set(seats.map((s) => s.id));
  const valid = votes.filter((v) => seatIds.has(v.userId));
  const yes = valid.filter((v) => v.vote === "YES").length;
  const no = valid.filter((v) => v.vote === "NO").length;
  const need = Math.floor(seats.length / 2) + 1;
  return { seats: seats.length, need, yes, no, abstain: valid.filter((v) => v.vote === "ABSTAIN").length, cast: valid.length, outcome: yes >= need ? ("APPROVED" as const) : no >= need ? ("REJECTED" as const) : null };
}

/** المراسلة الداخلية الإلزامية عند الاعتماد الفوري: تصل لكل عضو في المجلس بسبب الاستعجال */
export async function sendFastTrackMemo(m: { id: number; ref: string; title: string; amount: number | null }, chair: AppUser, reason: string, outcome: "APPROVED" | "REJECTED") {
  const seats = (await boardSeats()).filter((s) => s.id !== chair.id);
  const subject = `مذكرة رئيس المجلس: ${outcome === "APPROVED" ? "اعتماد" : "رفض"} فوري للبند ${m.ref}`;
  const body = `الإخوة أعضاء مجلس الإدارة المحترمين،\n\nاتخذتُ قراراً فورياً بـ${outcome === "APPROVED" ? "اعتماد" : "رفض"} البند «${m.title}»${m.amount ? ` بقيمة ${m.amount.toLocaleString("en-US")} د.أ` : ""} دون انتظار التصويت، للسبب التالي:\n\n${reason}\n\nالبند وتفاصيله وسجله في تبويب مجلس الإدارة.\n\n${chair.name}\nرئيس مجلس الإدارة`;
  const rows: Prisma.MessageCreateManyInput[] = seats.map((s) => ({ senderId: chair.id, recipientId: s.id, subject, body }));
  if (rows.length) await db.message.createMany({ data: rows });
  return seats.length;
}

"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { actionUser } from "@/lib/auth";
import { auditEvent, run, runVoid, type ActionState } from "@/lib/action";
import { AppError, can, type AppUser } from "@/lib/permissions";
import { claimEvent } from "@/lib/claim-flow";
import { notify } from "@/lib/notify";
import { parseNum } from "@/lib/num";
import { originalInvoiceLines, returnedQty } from "@/lib/einv-lines";
import { issueInvoiceReturn, type ReturnLine } from "@/lib/jofotara";

/**
 * فاتورة الإرجاع (إشعار دائن) — يعدّها المحاسب ويرسلها لنظام الفوترة، بإذن المدير العام:
 *   1) المحاسب يطلب (البنود + السبب) ← إشعار ومراسلة داخلية للمدير العام ← موافقة ← المحاسب يرسل
 *   2) المدير العام يكلّف المحاسب بمراسلة داخلية ← المحاسب يعدّها ويرسلها مباشرة (الإذن قائم)
 */

const r3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;
const refresh = (claimId: number) => {
  revalidatePath(`/claims/${claimId}`);
  revalidatePath("/messages");
};

async function loadClaim(claimId: number) {
  const c = await db.claim.findUnique({ where: { id: claimId }, include: { lines: true, tender: true } });
  if (!c) throw new AppError("المطالبة غير موجودة");
  if (c.einvStatus !== "SUBMITTED") throw new AppError("فاتورة الإرجاع تصدر على فاتورة معتمدة من نظام الفوترة فقط");
  return c;
}

/** مراسلة داخلية مرتبطة بالمطالبة + إشعار */
async function sendInternal(from: AppUser, toRole: "ADMIN" | "ACCOUNTANT", claim: { id: number; tenderId: number }, subject: string, body: string) {
  const to = await db.user.findMany({ where: { role: toRole, active: true }, select: { id: true } });
  for (const u of to) if (u.id !== from.id) await db.message.create({ data: { senderId: from.id, recipientId: u.id, subject, body, tenderId: claim.tenderId, claimId: claim.id } });
  await notify([toRole], { title: subject, body, href: `/claims/${claim.id}` }, { exclude: from.id });
}

/** البنود المرتجعة من النموذج — كل بند حتى المتبقي غير المرتجع، بأسعار وأرقام الفاتورة المعتمدة */
async function parseLines(c: Awaited<ReturnType<typeof loadClaim>>, fd: FormData): Promise<ReturnLine[]> {
  let wanted: { lineNo: number; qty: string }[] = [];
  try {
    wanted = JSON.parse(String(fd.get("lines") || "[]"));
  } catch {
    throw new AppError("بنود الإرجاع غير صالحة");
  }
  const original = await originalInvoiceLines(c);
  const used = await returnedQty(c.id);
  const out: ReturnLine[] = [];
  for (const w of wanted) {
    const q = parseNum(String(w.qty ?? ""));
    if (q == null || q === 0) continue;
    if (Number.isNaN(q) || q < 0) throw new AppError("الكمية المرتجعة يجب أن تكون رقماً موجباً");
    const o = original.find((x) => x.lineNo === Number(w.lineNo));
    if (!o) throw new AppError("بند غير موجود في الفاتورة الأصلية");
    const left = r3(o.qty - (used.get(o.lineNo) ?? 0));
    if (q > left + 0.0005) throw new AppError(`الكمية المرتجعة للبند ${o.lineNo} أكبر من المتبقي (${left})`);
    out.push({ lineNo: o.lineNo, description: o.description, unit: o.unit, qty: r3(q), price: o.price, discount: r3(o.qty ? (o.discount * q) / o.qty : 0) });
  }
  if (out.length === 0) throw new AppError("حدد كمية مرتجعة لبند واحد على الأقل");
  return out;
}

const total = (lines: ReturnLine[]) => r3(lines.reduce((s, l) => s + l.qty * l.price - l.discount, 0));

/** إرسال فعلي لنظام الفوترة + توثيق وإشعار */
async function submit(user: AppUser, id: number) {
  const r = await db.einvReturn.findUniqueOrThrow({ where: { id } });
  const c = await db.claim.findUniqueOrThrow({ where: { id: r.claimId }, include: { tender: true } });
  const res = await issueInvoiceReturn(id);
  const fresh = await db.einvReturn.findUniqueOrThrow({ where: { id } });
  await claimEvent(r.claimId, res.ok ? "einv_return" : "einv_return_failed", user, `SADA-${fresh.number ?? "—"} — ${r.amount} — ${r.reason}${res.ok ? "" : ` — ${res.message}`}`);
  await auditEvent("update", "EinvReturn", `إرسال فاتورة إرجاع SADA-${fresh.number ?? "—"} على الفاتورة SADA-${c.invoiceNo} (المطالبة رقم ${c.number} — ${c.tender.name}) بقيمة ${r.amount}: ${res.message}`, user, { recordId: id });
  await notify(["ADMIN", "ACCOUNTANT"], { title: `فاتورة إرجاع SADA-${fresh.number ?? "—"} — المطالبة رقم ${c.number}`, body: `${c.tender.name} — ${r.amount} د.أ — ${res.ok ? "اعتُمدت من نظام الفوترة" : `لم تُعتمد: ${res.message}`}`, href: `/claims/${c.id}` }, { exclude: user.id });
  return res;
}

/**
 * المحاسب: إعداد فاتورة إرجاع. إن وُجد تكليف قائم من المدير العام تُرسل مباشرة،
 * وإلا تُرفع طلباً للمدير العام (إشعار + مراسلة داخلية) ولا تُرسل قبل موافقته.
 */
export async function requestInvoiceReturn(claimId: number, _: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await actionUser(can.manageFinance);
    const c = await loadClaim(claimId);
    const lines = await parseLines(c, fd);
    const amount = total(lines);
    const permit = await db.einvReturn.findFirst({ where: { claimId, status: "AUTHORIZED" }, orderBy: { id: "asc" } });
    let reason = String(fd.get("reason") ?? "").trim();
    if (permit && reason.length < 5) reason = permit.reason;
    if (reason.length < 5) throw new AppError("اكتب سبب الإرجاع (إلزامي لدى نظام الفوترة)");
    if (permit) {
      await db.einvReturn.update({ where: { id: permit.id }, data: { lines: JSON.stringify(lines), amount, reason, status: "APPROVED", requestedById: user.id } });
      const res = await submit(user, permit.id);
      refresh(claimId);
      if (!res.ok) throw new AppError(`لم يعتمد نظام الفوترة فاتورة الإرجاع: ${res.message} — أعد الإرسال من صفحة المطالبة`);
      return res.message;
    }
    const r = await db.einvReturn.create({ data: { claimId, lines: JSON.stringify(lines), amount, reason, status: "REQUESTED", requestedById: user.id } });
    await claimEvent(claimId, "einv_return_requested", user, `${amount} — ${reason}`);
    await auditEvent("create", "EinvReturn", `طلب إذن فاتورة إرجاع على الفاتورة SADA-${c.invoiceNo} (المطالبة رقم ${c.number}) بقيمة ${amount} — ${reason}`, user, { recordId: r.id });
    await sendInternal(user, "ADMIN", c, `طلب إذن: فاتورة إرجاع على المطالبة رقم ${c.number}`, `يطلب ${user.name} إذنك بإصدار فاتورة إرجاع على الفاتورة SADA-${c.invoiceNo} — ${c.tender.name}\nالقيمة: ${amount} د.أ (${lines.length} بنود)\nالسبب: ${reason}\nللموافقة أو الرفض: صفحة المطالبة ← فواتير الإرجاع.`);
    refresh(claimId);
    return "أُرسل طلب الإذن للمدير العام — تُرسل فاتورة الإرجاع لنظام الفوترة بعد موافقته";
  });
}

/** المدير العام: تكليف المحاسب بإصدار فاتورة إرجاع (مراسلة داخلية) — الإذن قائم فيرسلها المحاسب مباشرة */
export async function authorizeInvoiceReturn(claimId: number, _: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await actionUser();
    if (user.role !== "ADMIN") throw new AppError("التكليف بفاتورة الإرجاع للمدير العام");
    const c = await loadClaim(claimId);
    const reason = String(fd.get("reason") ?? "").trim();
    if (reason.length < 5) throw new AppError("اكتب سبب الإرجاع والتعليمات للمحاسب");
    const r = await db.einvReturn.create({ data: { claimId, reason, status: "AUTHORIZED", requestedById: user.id, approvedById: user.id, approvedAt: new Date() } });
    await claimEvent(claimId, "einv_return_authorized", user, reason);
    await auditEvent("create", "EinvReturn", `تكليف المحاسب بفاتورة إرجاع على الفاتورة SADA-${c.invoiceNo} (المطالبة رقم ${c.number}) — ${reason}`, user, { recordId: r.id });
    await sendInternal(user, "ACCOUNTANT", c, `تكليف: أصدر فاتورة إرجاع على المطالبة رقم ${c.number}`, `يطلب المدير العام إصدار فاتورة إرجاع على الفاتورة SADA-${c.invoiceNo} — ${c.tender.name}\nالسبب والتعليمات: ${reason}\nمن صفحة المطالبة ← فواتير الإرجاع ← «إعداد وإرسال فاتورة الإرجاع».`);
    refresh(claimId);
    return "أُرسل التكليف للمحاسب بمراسلة داخلية";
  });
}

/** المدير العام: موافقة على طلب المحاسب (أو رفضه مع ملاحظة) */
export async function decideInvoiceReturn(id: number, approve: boolean, _: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await actionUser();
    if (user.role !== "ADMIN") throw new AppError("الإذن بفاتورة الإرجاع للمدير العام");
    const r = await db.einvReturn.findUnique({ where: { id } });
    if (!r || r.status !== "REQUESTED") throw new AppError("الطلب غير موجود أو تم البت فيه");
    const c = await db.claim.findUniqueOrThrow({ where: { id: r.claimId } });
    const note = String(fd.get("adminNote") ?? "").trim() || null;
    if (!approve && !note) throw new AppError("اكتب سبب رفض الطلب");
    await db.einvReturn.update({ where: { id }, data: { status: approve ? "APPROVED" : "DECLINED", approvedById: user.id, approvedAt: new Date(), adminNote: note } });
    await claimEvent(r.claimId, approve ? "einv_return_approved" : "einv_return_declined", user, note);
    await auditEvent("update", "EinvReturn", `${approve ? "موافقة" : "رفض"} المدير العام على طلب فاتورة إرجاع بقيمة ${r.amount} (المطالبة رقم ${c.number})${note ? ` — ${note}` : ""}`, user, { recordId: id });
    await sendInternal(user, "ACCOUNTANT", c, approve ? `موافقة: أرسل فاتورة الإرجاع للمطالبة رقم ${c.number}` : `رُفض طلب فاتورة الإرجاع للمطالبة رقم ${c.number}`, approve ? `وافق المدير العام على فاتورة الإرجاع بقيمة ${r.amount} د.أ — أرسلها لنظام الفوترة من صفحة المطالبة.${note ? `\nملاحظة: ${note}` : ""}` : `السبب: ${note}`);
    refresh(r.claimId);
    return approve ? "تمت الموافقة — أُبلغ المحاسب ليرسلها لنظام الفوترة" : "رُفض الطلب وأُبلغ المحاسب";
  });
}

/** المحاسب: إرسال فاتورة إرجاع موافق عليها (أو إعادة إرسال ما لم يُعتمد بسبب عطل) */
export async function sendInvoiceReturn(id: number) {
  const row = await db.einvReturn.findUnique({ where: { id } });
  const result = await runVoid(async () => {
    const user = await actionUser(can.manageFinance);
    if (!row) throw new AppError("فاتورة الإرجاع غير موجودة");
    if (!["APPROVED", "FAILED"].includes(row.status)) throw new AppError(row.status === "REQUESTED" ? "بانتظار إذن المدير العام" : "لا يمكن إرسال فاتورة الإرجاع في حالتها الحالية");
    const res = await submit(user, id);
    if (!res.ok) throw new AppError(res.message);
  });
  if (row) refresh(row.claimId);
  return result;
}

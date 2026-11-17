"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { actionUser, assertTenderAccess } from "@/lib/auth";
import { auditEvent, run, runVoid, type ActionState } from "@/lib/action";
import { emailLayout, mailConfigured, recipientFor, sendMail } from "@/lib/mailer";
import { notify } from "@/lib/notify";
import { claimNet } from "@/lib/deductions";
import { fmtJOD, round3 } from "@/lib/format";
import { parseNum } from "@/lib/num";
import { tafqeetJOD } from "@/lib/tafqeet";
import { AppError, can } from "@/lib/permissions";
import { computeClaim, nextClaimNumber, readQuantities } from "@/lib/claim-engine";
import { CLAIM_TYPE } from "@/lib/labels";
import { formObject, zDate, zEnum, zOptId, zOptMoney, zOptText } from "@/lib/validation";
import { accountantIds, claimEvent, claimMessage, resolveDeduction } from "@/lib/claim-flow";

const pct = (label: string) =>
  z.preprocess((v) => (v === "" || v == null ? undefined : parseNum(v)), z.number({ invalid_type_error: `${label} غير صالحة` }).min(0, `${label} لا تقل عن 0`).max(100, `${label} لا تزيد عن 100`).optional());

const headerSchema = z.object({
  type: zEnum(CLAIM_TYPE, "نوع المطالبة"),
  date: zDate("تاريخ المطالبة"),
  retentionPct: pct("نسبة المحجوزات"),
  stampPct: pct("نسبة الطوابع"),
  surveyId: zOptId,
  notes: zOptText,
  deductionMode: z.enum(["none", "pct", "amount"]).catch("none"),
  deductionValue: zOptMoney,
  deductionNotes: zOptText,
});

/** مزامنة كميات الحصر المرتبط مع كميات المطالبة (حتى لا يبقى حصر مفتوح بكميات مختلفة) */
type Tx = Omit<typeof db, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">;
async function syncSurveyLines(tx: Tx, surveyId: number, qty: Map<number, number>) {
  await tx.surveyLine.deleteMany({ where: { surveyId, boqItemId: { notIn: Array.from(qty.keys()) } } });
  for (const [boqItemId, q] of Array.from(qty.entries())) {
    await tx.surveyLine.upsert({
      where: { surveyId_boqItemId: { surveyId, boqItemId } },
      create: { surveyId, boqItemId, cumulativeQty: round3(q) },
      update: { cumulativeQty: round3(q) },
    });
  }
}

/**
 * نموذج إنشاء وتعديل المطالبة المالية (مرحلية/نهائية):
 * - مدير المشروع (مشاريعه فقط): ينشئ المطالبة مع الحسومات ويرسلها للمحاسب، ويعدّل المطالبة المرفوضة ويعيد إرسالها.
 * - المحاسب والإدارة: ينشئون ويعدّلون المسودة قيد التدقيق (بما فيها النسب والحسومات)، ويعدّلون المرفوضة.
 * بعد الحفظ تعود المطالبة إلى «لدى المحاسب — قيد التدقيق» في المسار الطبيعي: مدير المشروع ← المحاسب ← الإدارة.
 */
export async function saveWizardClaim(tenderId: number, claimId: number | null, _: ActionState, fd: FormData): Promise<ActionState> {
  let target = 0;
  const res = await run(async () => {
    const user = await actionUser(can.manageProjectLifecycle);
    await assertTenderAccess(user, tenderId);
    const fin = can.manageFinance(user.role);
    const h = headerSchema.parse(formObject(fd));
    const items = await db.boqItem.findMany({ where: { tenderId }, select: { id: true } });
    const qty = readQuantities(fd, items.map((i) => i.id));
    const prevOverride = new Map<number, number>();
    for (const it of items) {
      const n = parseNum(fd.get(`prev_${it.id}`));
      if (n == null) continue;
      if (!Number.isFinite(n) || n < 0) throw new AppError("الكميات السابقة يجب أن تكون أرقاماً موجبة");
      if (n > 0) prevOverride.set(it.id, n);
    }
    if (qty.size === 0) throw new AppError("لا توجد كميات — أدخل الكميات الفعلية المنفذة");

    const existing = claimId ? await db.claim.findUnique({ where: { id: claimId } }) : null;
    if (claimId) {
      if (!existing || existing.tenderId !== tenderId) throw new AppError("المطالبة غير موجودة");
      if (existing.status === "DRAFT") {
        if (!fin) throw new AppError("المطالبة لدى المحاسب قيد التدقيق — تُعدَّل بعد إعادتها إليك");
      } else if (existing.status !== "RETURNED") {
        throw new AppError("المطالبة مرفوعة للإدارة أو معتمدة — لا يمكن تعديلها");
      }
    }
    // نسب المحجوزات والطوابع قرار مالي: للمحاسب والإدارة فقط — مدير المشروع يرث النسب القائمة أو الافتراضية
    const rates = fin
      ? { retentionPct: h.retentionPct, stampPct: h.stampPct }
      : { retentionPct: existing?.retentionRate ?? undefined, stampPct: existing?.stampRate ?? undefined };
    const calc = await computeClaim(tenderId, qty, { rates, excludeClaimId: claimId ?? undefined, previousOverride: prevOverride });
    const ded = resolveDeduction(calc.gross, { retention: calc.retention, stampDuty: calc.stampDuty }, { mode: h.deductionMode, value: h.deductionValue, notes: h.deductionNotes });
    const data = {
      type: h.type,
      submittedDate: h.date,
      grossAmount: calc.gross,
      retention: calc.retention,
      withholdingTax: calc.withholdingTax,
      stampDuty: calc.stampDuty,
      advanceRecovery: calc.advanceRecovery,
      retentionRate: calc.rates.retentionPct,
      taxRate: null,
      stampRate: calc.rates.stampPct,
      notes: h.notes,
      ...ded,
    };
    const net = claimNet({ grossAmount: calc.gross, retention: calc.retention, stampDuty: calc.stampDuty, deductions: ded.deductions });
    const summary = `${calc.lines.length} بنداً — إجمالي ${fmtJOD(calc.gross)}${ded.deductions ? ` — حسم ${ded.deductionRate ? `${ded.deductionRate}% = ` : ""}${fmtJOD(ded.deductions)}` : ""} — صافي ${fmtJOD(net)}`;
    const tName = calc.tender.name;

    // ── تعديل مطالبة قائمة ──
    if (existing) {
      const wasReturned = existing.status === "RETURNED";
      const linked = await db.survey.findFirst({ where: { claimId: existing.id } });
      await db.$transaction(async (tx) => {
        await tx.claimLine.deleteMany({ where: { claimId: existing.id } });
        await tx.claim.update({ where: { id: existing.id }, data: { ...data, ...(wasReturned ? { status: "DRAFT", readyAt: null } : {}), invoiceOverride: null, invoiceEditedById: null, invoiceEditedAt: null, lines: { create: calc.lines } } });
        if (linked && linked.status === "DRAFT") {
          await syncSurveyLines(tx, linked.id, qty);
          await tx.survey.update({ where: { id: linked.id }, data: { status: "CLAIMED", submittedAt: new Date() } });
        }
      });
      target = existing.id;
      if (!wasReturned) return "تم تحديث المسودة";
      const byAccountant = user.role === "ACCOUNTANT";
      await claimEvent(existing.id, byAccountant ? "reopened" : "resubmitted", user, summary);
      if (!byAccountant) {
        await claimMessage(user.id, await accountantIds(), existing, `إعادة تقديم المطالبة رقم ${existing.number} للتدقيق — ${tName}`, `عُدّلت المطالبة بعد الرفض وأُعيد إرسالها للتدقيق.\n${summary}\nيرجى تدقيق الكميات والحسابات والحسومات ثم رفعها للإدارة.`);
      }
      await auditEvent("workflow", "Claim", `إعادة إرسال المطالبة رقم ${existing.number} بعد التعديل — ${tName} — ${summary}`, user, { recordId: existing.id });
      return "أُعيدت المطالبة إلى مسار التدقيق";
    }

    // ── مطالبة جديدة ──
    let source: { id: number; status: string } | null = null;
    if (h.surveyId) {
      const s = await db.survey.findUnique({ where: { id: h.surveyId } });
      const okStatus = !!s && (s.status === "SUBMITTED" || (s.status === "DRAFT" && can.fieldOps(user.role)));
      if (!s || s.tenderId !== tenderId || !okStatus || s.claimId) throw new AppError("الحصر المصدر غير متاح (صدرت منه مطالبة أو لم يعد مفتوحاً)");
      source = s;
    }
    const number = await nextClaimNumber(tenderId);
    const claim = await db.$transaction(async (tx) => {
      const c = await tx.claim.create({ data: { ...data, tenderId, number, status: "DRAFT", preparedById: user.id, lines: { create: calc.lines } } });
      if (source) {
        if (source.status === "DRAFT") await syncSurveyLines(tx, source.id, qty);
        await tx.survey.update({ where: { id: source.id }, data: { status: "CLAIMED", claimId: c.id, submittedAt: new Date() } });
      }
      return c;
    });
    target = claim.id;
    if (fin) {
      await claimEvent(claim.id, "created", user, summary);
      return "تم إنشاء المطالبة والخلاصة";
    }
    // مدير المشروع: الخطوة الأولى — الإرسال للمحاسب
    await claimEvent(claim.id, "submitted", user, summary);
    await claimMessage(user.id, await accountantIds(), claim, `مطالبة جديدة للتدقيق: المطالبة رقم ${claim.number} — ${tName}`, `أرسل مدير المشروع المطالبة (${claim.type === "FINAL" ? "نهائية" : "مرحلية"}).\n${summary}\nيرجى تدقيق الكميات والحسابات والحسومات ثم رفعها للإدارة.`);
    await auditEvent("workflow", "Claim", `إرسال المطالبة رقم ${claim.number} للمحاسب — ${tName} — ${summary}`, user, { recordId: claim.id });
    return "أُرسلت المطالبة للمحاسب";
  });
  if (res.ok && target) {
    revalidatePath("/", "layout");
    redirect(`/claims/${target}`);
  }
  return res;
}

/**
 * بوابة البريد الإجبارية (المرحلة ج):
 * «تأكيد التدقيق وإرسال إشعار الجاهزية بالبريد الإلكتروني» — يرسل بريداً رسمياً (SMTP) للمدير العام
 * ولمدير المشروع المسند. لا تنتقل المطالبة إلى «جاهزة للطباعة والتسليم» إلا بعد نجاح الإرسال للمدير العام.
 */
export async function confirmAuditAndSendReadiness(claimId: number) {
  const result = await runVoid(async () => {
    const user = await actionUser(can.manageFinance);
    const c = await db.claim.findUnique({ where: { id: claimId }, include: { lines: true, tender: { include: { manager: true } } } });
    if (!c) throw new AppError("المطالبة غير موجودة");
    if (c.status !== "DRAFT") throw new AppError("المطالبة ليست مسودة — مرت بالبوابة مسبقاً");
    if (!mailConfigured()) throw new AppError("البريد غير مُعد (SMTP) — لا يمكن تجاوز بوابة البريد الإجبارية");

    const admins = await db.user.findMany({ where: { role: "ADMIN", active: true } });
    const gmEmails = Array.from(new Set(admins.map((a) => recipientFor(a)).filter((x): x is string => !!x)));
    if (gmEmails.length === 0) throw new AppError("لا يوجد بريد للمدير العام");
    const pmEmail = c.tender.manager ? recipientFor(c.tender.manager) : null;
    const net = claimNet(c);
    const items = [
      { title: `${CLAIM_TYPE[c.type]} رقم ${c.number} — ${c.tender.name}`, body: `صاحب العمل: ${c.tender.entity} — رقم العطاء: ${c.tender.number}`, href: `/claims/${c.id}`, tone: "info" as const },
      { title: `قيمة الأعمال لهذه المطالبة: ${fmtJOD(c.grossAmount)}`, body: `المحجوزات ${fmtJOD(c.retention)} — الطوابع ${fmtJOD(c.stampDuty)}${c.deductions ? ` — خصومات أخرى ${fmtJOD(c.deductions)}` : ""}`, tone: "info" as const },
      { title: `صافي المبلغ المستحق للصرف: ${fmtJOD(net)}`, body: tafqeetJOD(net), tone: "warning" as const },
      c.invoiceMode === "REGULAR"
        ? { title: "الفاتورة المرفقة: فاتورة عادية فقط (بدون فاتورة ضريبية)", body: `السبب: ${c.invoiceModeReason ?? "—"}`, tone: "warning" as const }
        : { title: "الفاتورة المرفقة: الفاتورة الضريبية (جفوتارا) + الفاتورة العادية", body: "تُرسل الفاتورة الضريبية لنظام الفوترة الوطني تلقائياً عند الموافقة النهائية.", tone: "info" as const },
      { title: "تأكيد التدقيق", body: `قام ${user.name} بتدقيق الأرقام ومطابقتها مع النظام (${c.lines.length} بنداً من الحصر الفعلي) ورفع المطالبة للإدارة للموافقة.`, tone: "info" as const },
    ];
    const html = emailLayout("مطالبة مالية مرفوعة للإدارة", items, "إشعار رسمي من نظام صدى الجنوب — المحاسب أكد تدقيق المطالبة التالية:");
    const subject = `صدى الجنوب: المطالبة رقم ${c.number} — ${c.tender.name} مرفوعة للإدارة بانتظار الموافقة (صافي ${fmtJOD(net)})`;
    const stamp = Date.now();

    // الإرسال للمدير العام إجباري — الفشل يوقف الانتقال
    const gmStatus = await sendMail({ key: `claim-ready:${c.id}:gm:${stamp}`, to: gmEmails.join(", "), subject, html, text: `${subject}\n${tafqeetJOD(net)}` });
    if (gmStatus !== "sent") throw new AppError("فشل إرسال البريد للمدير العام — لم تتغير حالة المطالبة. راجع إعدادات البريد ثم أعد المحاولة");
    let pmNote = "";
    let pmStatus: string | null = null;
    if (pmEmail && !gmEmails.includes(pmEmail)) {
      pmStatus = await sendMail({ key: `claim-ready:${c.id}:pm:${stamp}`, to: pmEmail, subject, html, text: subject });
      pmNote = pmStatus === "sent" ? ` ومدير المشروع (${pmEmail})` : " — تعذر الإرسال لمدير المشروع";
    } else if (!pmEmail && c.tender.manager) {
      pmNote = ` — لا يوجد بريد لمدير المشروع ${c.tender.manager.name}`;
    }

    await db.claim.update({ where: { id: claimId }, data: { status: "READY", readyAt: new Date(), auditedById: user.id, returnReason: null } });
    await claimEvent(claimId, "audited", user, `صافي ${fmtJOD(net)}${c.deductions ? ` — خصومات ${fmtJOD(c.deductions)}` : ""}`);
    await auditEvent("workflow", "Claim", `بوابة البريد: تأكيد تدقيق المطالبة رقم ${c.number} — ${c.tender.name} — صافي ${fmtJOD(net)} — أُرسل البريد للمدير العام (${gmEmails.join(", ")})${pmNote}`, user, {
      recordId: c.id,
      before: { status: "DRAFT" },
      after: { status: "READY", emailGateway: { gm: { to: gmEmails, status: gmStatus }, pm: pmEmail ? { to: pmEmail, status: pmStatus ?? "skipped" } : null, subject }, gross: c.grossAmount, retention: c.retention, stampDuty: c.stampDuty, deductions: c.deductions, net, lines: c.lines.map((l) => ({ boqItemId: l.boqItemId, description: l.description, previousQty: l.previousQty, cumulativeQty: l.cumulativeQty, periodQty: l.periodQty, amount: l.amount })) },
    });
    // إشعار داخل النظام فقط (البريد الرسمي أُرسل أعلاه)
    await notify(["ADMIN", { managerOf: c.tenderId }], { title: `المطالبة رقم ${c.number} مرفوعة للإدارة — بانتظار الموافقة`, body: `${c.tender.name} — صافي ${fmtJOD(net)} — دققها ${user.name}`, href: `/claims/${c.id}` }, { exclude: user.id, email: false });
  });
  revalidatePath("/", "layout");
  return result;
}

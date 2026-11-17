import "server-only";
import { db } from "./db";
import { AppError, type AppUser } from "./permissions";
import { computeClaim, nextClaimNumber } from "./claim-engine";
import { notify } from "./notify";
import { claimNet } from "./deductions";
import { deductionAmount } from "./num";

/** الحسم الإضافي (نسبة من قيمة الأعمال أو مبلغ ثابت) مع التحقق — مشترك بين نموذج المطالبة ومراجعة المحاسب */
export function resolveDeduction(
  gross: number,
  base: { retention: number; stampDuty: number },
  d: { mode: "none" | "pct" | "amount"; value: number | null; notes: string | null },
) {
  let rate: number | null = null;
  let amount = 0;
  if (d.mode === "pct") {
    if (d.value == null || !(d.value > 0) || d.value > 100) throw new AppError("نسبة الحسم يجب أن تكون أكبر من 0 ولا تزيد عن 100");
    rate = d.value;
  } else if (d.mode === "amount") {
    amount = d.value ?? 0;
  }
  const deductions = deductionAmount(gross, { rate, amount });
  if (deductions > 0 && !d.notes) throw new AppError("اكتب سبب الحسم (يظهر في المطالبة الرسمية)");
  if (claimNet({ grossAmount: gross, retention: base.retention, stampDuty: base.stampDuty, deductions }) < 0) throw new AppError("الحسم يتجاوز صافي المطالبة");
  return { deductions, deductionRate: deductions > 0 ? rate : null, deductionNotes: deductions > 0 ? d.notes : null };
}

/** سجل دورة المطالبة (يظهر في صفحة المطالبة كخط زمني) */
export async function claimEvent(claimId: number, action: string, user: Pick<AppUser, "id" | "name" | "role"> | null, note?: string | null) {
  await db.claimEvent.create({ data: { claimId, action, note: note ?? null, userId: user?.id ?? null, userName: user?.name ?? null, userRole: user?.role ?? null } });
}

/** رسالة داخلية رسمية مرتبطة بالمطالبة + إشعار فوري */
export async function claimMessage(fromId: number, toIds: number[], claim: { id: number; tenderId: number }, subject: string, body: string, href?: string) {
  for (const to of new Set(toIds)) {
    if (to === fromId) continue;
    await db.message.create({ data: { senderId: fromId, recipientId: to, subject, body, tenderId: claim.tenderId, claimId: claim.id } });
    await notify([to], { title: subject, body: body.slice(0, 180), href: href ?? `/claims/${claim.id}` });
  }
}

/** مستلمو مراسلات المطالبة: المحاسبون (أو المدير العام عند عدم وجود محاسب) */
export async function accountantIds() {
  const acc = (await db.user.findMany({ where: { role: "ACCOUNTANT", active: true }, select: { id: true } })).map((u) => u.id);
  if (acc.length) return acc;
  return (await db.user.findMany({ where: { role: "ADMIN", active: true }, select: { id: true } })).map((u) => u.id);
}

/**
 * الخطوة الأولى: مدير المشروع يرسل المطالبة للمحاسب من الحصر الفعلي.
 * - حصر مرحلي → مطالبة مرحلية · الحصر النهائي → مطالبة نهائية
 * - إن كانت مطالبة هذا الحصر «مرفوضة — معادة للتعديل» تُعاد حساباتها من الكميات المعدّلة وتُقدَّم من جديد بنفس الرقم
 */
export async function claimFromSurvey(surveyId: number, user: AppUser) {
  const s = await db.survey.findUniqueOrThrow({ where: { id: surveyId }, include: { lines: true, tender: { select: { id: true, name: true } } } });
  const qty = new Map(s.lines.map((l) => [l.boqItemId, l.cumulativeQty]));
  if (qty.size === 0) throw new AppError("أدخل كميات الحصر واحفظها أولاً");
  const prior = s.claimId ? await db.claim.findUnique({ where: { id: s.claimId } }) : null;
  const reuse = prior && prior.status === "RETURNED" ? prior : null;
  const calc = await computeClaim(s.tenderId, qty, {
    excludeClaimId: reuse?.id,
    rates: reuse ? { retentionPct: reuse.retentionRate ?? undefined, stampPct: reuse.stampRate ?? undefined } : undefined,
  });
  const data = {
    type: s.kind === "FINAL" ? "FINAL" : "INTERIM",
    submittedDate: s.date,
    grossAmount: calc.gross,
    retention: calc.retention,
    withholdingTax: calc.withholdingTax,
    stampDuty: calc.stampDuty,
    advanceRecovery: calc.advanceRecovery,
    retentionRate: calc.rates.retentionPct,
    stampRate: calc.rates.stampPct,
    status: "DRAFT",
    readyAt: null,
  };
  const lines = calc.lines;
  const ded = reuse
    ? resolveDeduction(calc.gross, { retention: calc.retention, stampDuty: calc.stampDuty }, {
        mode: reuse.deductionRate ? "pct" : reuse.deductions > 0 ? "amount" : "none",
        value: reuse.deductionRate ?? reuse.deductions,
        notes: reuse.deductionNotes,
      })
    : null;

  const claim = await db.$transaction(async (tx) => {
    let c;
    if (reuse) {
      await tx.claimLine.deleteMany({ where: { claimId: reuse.id } });
      c = await tx.claim.update({ where: { id: reuse.id }, data: { ...data, ...ded, lines: { create: lines } } });
    } else {
      c = await tx.claim.create({
        data: { ...data, tenderId: s.tenderId, number: await nextClaimNumber(s.tenderId), deductions: 0, preparedById: user.id, notes: `من ${s.kind === "FINAL" ? "الحصر النهائي" : "الحصر الفعلي"} رقم ${s.number}`, lines: { create: lines } },
      });
    }
    await tx.survey.update({ where: { id: surveyId }, data: { status: "CLAIMED", claimId: c.id, submittedAt: new Date() } });
    return c;
  });
  await claimEvent(claim.id, reuse ? "resubmitted" : "submitted", user, `${lines.length} بنداً من ${s.kind === "FINAL" ? "الحصر النهائي" : "الحصر"} رقم ${s.number}`);
  await claimMessage(
    user.id,
    await accountantIds(),
    claim,
    `${reuse ? "إعادة تقديم" : "مطالبة جديدة"} للتدقيق: المطالبة رقم ${claim.number} — ${s.tender.name}`,
    `${reuse ? "عدّل مدير المشروع المطالبة وأعاد تقديمها" : "أرسل مدير المشروع المطالبة"} (${claim.type === "FINAL" ? "نهائية" : "مرحلية"}) — ${lines.length} بنداً.\nيرجى تدقيق الكميات والحسابات والخصومات ثم رفعها للإدارة.`,
  );
  return { claim, resubmitted: !!reuse };
}

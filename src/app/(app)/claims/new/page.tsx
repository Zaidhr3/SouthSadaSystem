import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, FileText } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { can, tenderScope } from "@/lib/permissions";
import { getSettings } from "@/lib/settings";
import { previousCumulative } from "@/lib/surveys";
import { lumpSumClaims } from "@/lib/claim-engine";
import { fmtDate, round3, toInputDate, todayUTC } from "@/lib/format";
import { Badge, Card, EmptyState, Money, PageHeader } from "@/components/ui";
import { saveWizardClaim } from "../../actions/invoicing";
import { ClaimWizard } from "./claim-wizard";
import { getEinvSettings } from "@/lib/jofotara";

export const metadata = { title: "إنشاء مطالبة" };

export default async function NewClaimPage({ searchParams }: { searchParams: { tender?: string; claim?: string } }) {
  // مدير المشروع (مشاريعه فقط) والمحاسب والإدارة — والخادم يتحقق مجدداً عند الحفظ
  const user = await requireUser(can.manageProjectLifecycle);
  const fin = can.manageFinance(user.role);
  const tenderId = Number(searchParams.tender) || 0;

  // ── الخطوة 1: اختيار العطاء ──
  if (!tenderId) {
    const tenders = await db.tender.findMany({
      where: { ...tenderScope(user), awardedValue: { not: null }, status: { in: ["WON", "EXECUTION", "MAINTENANCE"] }, boqItems: { some: {} } },
      include: { surveys: { where: { status: fin ? "SUBMITTED" : "DRAFT", claimId: null }, include: { _count: { select: { lines: true } } } }, claims: { orderBy: { number: "desc" }, take: 1 } },
      orderBy: { updatedAt: "desc" },
    });
    return (
      <>
        <PageHeader title="إنشاء مطالبة مالية" subtitle="الخطوة 1: اختر العطاء — تُجلب الكميات الفعلية من آخر حصر لمدير المشروع تلقائياً" back={{ href: "/claims", label: "المطالبات" }} />
        {tenders.length === 0 ? (
          <Card><EmptyState icon={FileText} title="لا توجد مشاريع محالة بجدول كميات" /></Card>
        ) : (
          <div className="stagger grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {tenders.map((t) => (
              <Link key={t.id} href={`/claims/new?tender=${t.id}`} className="card card-pad block transition hover:-translate-y-0.5 hover:shadow-pop">
                <p className="font-bold">{t.name}</p>
                <p className="text-xs text-ink-muted">{t.entity} — {t.number}</p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {t.surveys[0] ? <Badge tone="green">{fin ? "حصر مُرسل من مدير المشروع" : "حصر مفتوح"}: {t.surveys[0]._count.lines} بنود ({fmtDate(t.surveys[0].date)})</Badge> : <Badge>{fin ? "لا يوجد حصر بانتظار التدقيق" : "لا يوجد حصر مفتوح"}</Badge>}
                  {t.claims[0] && <Badge tone="gray">آخر مطالبة رقم {t.claims[0].number}</Badge>}
                </div>
                <p className="mt-3 text-sm">قيمة العقد <Money value={(t.awardedValue ?? 0) + t.variationTotal} strong /></p>
              </Link>
            ))}
          </div>
        )}
      </>
    );
  }

  // ── الخطوة 2: المراجعة والإنشاء ──
  const claimId = Number(searchParams.claim) || null;
  const tender = await db.tender.findFirst({
    where: { id: tenderId, ...tenderScope(user) },
    include: {
      boqItems: { orderBy: { sortOrder: "asc" } },
      claims: { select: { id: true, retention: true, advanceRecovery: true, status: true } },
      // مصدر الكميات: الحصر المُرسل (للمحاسب) أو الحصر المفتوح لمدير المشروع
      surveys: { where: { claimId: null, status: { in: fin ? (can.fieldOps(user.role) ? ["SUBMITTED", "DRAFT"] : ["SUBMITTED"]) : ["DRAFT"] } }, include: { lines: true }, orderBy: { status: "desc" } },
    },
  });
  if (!tender || tender.awardedValue == null) notFound();
  const existing = claimId ? await db.claim.findUnique({ where: { id: claimId }, include: { lines: true } }) : null;
  if (claimId && (!existing || existing.tenderId !== tenderId)) notFound();
  // التعديل: المسودة قيد التدقيق للمحاسب والإدارة، والمرفوضة (معادة للتعديل) لمدير المشروع والمحاسب والإدارة
  const editable = !existing || existing.status === "RETURNED" || (existing.status === "DRAFT" && fin);
  if (existing && !editable) {
    return (
      <Card>
        <EmptyState
          title={existing.status === "DRAFT" ? "المطالبة لدى المحاسب قيد التدقيق — تُعدَّل بعد إعادتها إليك" : "المطالبة مرفوعة للإدارة أو معتمدة — لا يمكن تعديلها"}
          action={<Link href={`/claims/${existing.id}`} className="btn-primary">عرض المطالبة</Link>}
        />
      </Card>
    );
  }
  const returned = existing?.status === "RETURNED";
  // المطالبة المعادة المرتبطة بحصر عدّله مدير المشروع بعد الرفض: تُقرأ الكميات الأحدث من الحصر
  const linkedSurvey = returned ? await db.survey.findFirst({ where: { claimId: existing!.id, status: "DRAFT" }, include: { lines: true } }) : null;

  const einv = await getEinvSettings();
  const [settings, prev, lump] = await Promise.all([getSettings(), previousCumulative(tenderId, claimId ?? undefined), lumpSumClaims(tenderId, claimId ?? undefined)]);
  const survey = existing ? null : tender.surveys.find((x) => x.lines.length > 0) ?? null;
  const others = tender.claims.filter((c) => c.status !== "REJECTED" && c.id !== claimId);
  const fromSurvey = new Map(survey?.lines.map((l) => [l.boqItemId, l.cumulativeQty]) ?? []);
  const fromClaim = new Map<number, number>(linkedSurvey && linkedSurvey.lines.length ? linkedSurvey.lines.map((l) => [l.boqItemId, l.cumulativeQty]) : existing?.lines.map((l) => [l.boqItemId ?? 0, l.cumulativeQty]) ?? []);
  const prevFromClaim = new Map(existing?.lines.map((l) => [l.boqItemId ?? 0, l.previousQty]) ?? []);
  const claimedGrossOthers = round3(
    (await db.claim.findMany({ where: { tenderId, status: { not: "REJECTED" }, ...(claimId ? { id: { not: claimId } } : {}) }, select: { grossAmount: true } })).reduce((s, c) => s + c.grossAmount, 0),
  );

  return (
    <>
      <PageHeader
        title={existing ? (returned ? `تعديل المطالبة رقم ${existing.number} وإعادة الإرسال` : `تعديل المطالبة رقم ${existing.number} (قيد التدقيق)`) : "إنشاء مطالبة مالية"}
        subtitle={<>{tender.name} — {tender.entity} — {tender.number}</>}
        back={{ href: existing ? `/claims/${existing.id}` : "/claims/new", label: existing ? "المطالبة" : "اختيار عطاء آخر" }}
      />
      {returned && (
        <div className="mb-5 flex gap-3 rounded-2xl border border-bad/25 bg-bad-soft p-4 text-sm" role="alert">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-bad" aria-hidden />
          <div>
            <p className="font-bold text-bad">مرفوضة — معادة للتعديل{existing!.returnedAt ? ` بتاريخ ${fmtDate(existing!.returnedAt)}` : ""}</p>
            <p className="mt-1 whitespace-pre-line text-ink">السبب: {existing!.returnReason ?? "—"}</p>
            <p className="mt-1 text-xs text-ink-muted">عدّل الكميات أو الحسومات ثم اضغط «حفظ وإعادة الإرسال للتدقيق» — تعود المطالبة بنفس رقمها إلى المحاسب ثم الإدارة.</p>
          </div>
        </div>
      )}
      <ClaimWizard
        key={`${tenderId}-${existing?.id ?? "new"}-${existing?.status ?? ""}-${survey?.id ?? 0}`}
        action={saveWizardClaim.bind(null, tenderId, claimId)}
        rows={tender.boqItems.map((b) => ({
          boqItemId: b.id,
          itemNo: b.itemNo,
          description: b.description,
          unit: b.unit,
          unitPrice: b.unitPrice,
          boqQty: b.quantity,
          previousQty: prev.get(b.id) ?? prevFromClaim.get(b.id) ?? 0,
          prevEditable: lump.count > 0 && !prev.has(b.id),
          surveyQty: fromSurvey.get(b.id) ?? null,
          initial: fromClaim.get(b.id) ?? fromSurvey.get(b.id) ?? null,
        }))}
        ctx={{
          contract: round3(tender.awardedValue + tender.variationTotal),
          capPct: settings.retentionCapPct,
          retentionHeldOthers: round3(others.reduce((s, c) => s + c.retention, 0)),
          rates: {
            retentionPct: existing?.retentionRate ?? settings.retentionPct,
            stampPct: existing?.stampRate ?? settings.stampDutyPct,
          },
          // الحصر النهائي من مدير المشروع يُنتج المطالبة النهائية (الختامية)
          type: existing?.type ?? (survey?.kind === "FINAL" ? "FINAL" : "INTERIM"),
          date: toInputDate(existing?.submittedDate ?? survey?.date ?? todayUTC()),
          notes: existing?.notes ?? (survey ? `من الحصر الفعلي رقم ${survey.number}` : ""),
          surveyId: survey?.id ?? null,
          surveyLabel: survey ? `${survey.kind === "FINAL" ? "الحصر النهائي — " : ""}${survey.status === "DRAFT" ? "الحصر المفتوح" : "حصر مدير المشروع"} رقم ${survey.number} بتاريخ ${fmtDate(survey.date)} — ${survey.lines.length} بنود مقاسة — راجع الكميات قبل الإرسال` : existing ? (linkedSurvey?.lines.length ? `الحصر رقم ${linkedSurvey.number} (بعد تعديله)` : "كميات المطالبة المحفوظة") : null,
          editing: !!existing,
          submitLabel: !existing ? (fin ? "إنشاء المطالبة والفاتورة" : "تم وإرسال للمحاسب") : returned ? (user.role === "ACCOUNTANT" ? "حفظ وإعادة الفتح للتدقيق" : "حفظ وإعادة الإرسال للتدقيق") : "حفظ التعديلات والخلاصة",
          canEditRates: fin,
          einv: { kind: einv.kind, taxPct: einv.taxPct, buyer: tender.entity, inclusive: einv.inclusive },
          deduction: {
            mode: existing?.deductionRate ? "pct" : existing?.deductions ? "amount" : "none",
            value: existing?.deductionRate ?? (existing?.deductions || null),
            notes: existing?.deductionNotes ?? "",
          },
          lumpSum: lump,
          claimedGrossOthers,
        }}
      />
    </>
  );
}

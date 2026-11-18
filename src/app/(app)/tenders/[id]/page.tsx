import { Suspense } from "react";
import { SiteWeather } from "@/components/site-conditions";
import { OfficialLetterForm } from "@/components/letters";
import { userSees } from "@/lib/brand";
import { notFound } from "next/navigation";
import { FileSpreadsheet, Lock, MapPin, Pencil, Trash2, Unlock, UserCog } from "lucide-react";
import { getCurrentUser, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { can, tenderScope } from "@/lib/permissions";
import { PRE_AWARD_STATUSES, PROJECT_STATUSES, TENDER_STATUS } from "@/lib/labels";
const isProjectStatus = (s: string) => (PROJECT_STATUSES as readonly string[]).includes(s);
import { currentPhase, PHASES, phaseStatus, STAGE_OPTIONS, stageOf, type PhaseNo } from "@/lib/project-phase";
import { PhaseStepper } from "@/components/phase-stepper";
import { daysUntil, earnedValue, fmtDate, fmtJOD, round3, toInputDate, todayUTC } from "@/lib/format";
import { attachmentsMap } from "@/lib/uploads";
import { heldRetention } from "@/lib/deductions";
import { getSettings } from "@/lib/settings";
import { ArchivePanel } from "./archive-panel";
import { Card, KeyValue, Money, PageHeader, ProgressBar, StatCard, StatusBadge, TabPanel, Tabs } from "@/components/ui";
import { ConfirmButton, Grid, Input, ModalForm, Select } from "@/components/forms";
import { AttachmentGrid, ClaimTable, ExpenseFormFields, ExpenseTable, GuaranteeTable, UploadButton } from "@/components/tables";
import {
  analyzeMaterials,
  CorrespondenceForm,
  CorrespondenceTable,
  EquipmentLogForm,
  EquipmentLogTable,
  MaterialAnalysisTable,
  MaterialForm,
  MaterialReceiptTable,
  SubcontractCard,
  VariationForm,
  VariationTable,
} from "@/components/modules";
import { deleteTender, updateLifecycle, updateTender } from "../../actions/tenders";
import { createGuarantee } from "../../actions/guarantees";
import { createClaim, releaseRetention } from "../../actions/claims";
import { createExpense } from "../../actions/finance";
import { TenderFields } from "../tender-fields";
import { ClaimFields, GuaranteeFields, Lifecycle } from "./lifecycle";
import { BoqEditor } from "./boq-editor";
import { ContractQuick } from "./contract-quick";
import { AiBoqImport } from "./ai-boq-import";
import { geminiConfigured, geminiModel } from "@/lib/ai/gemini";
import { ProfitReport } from "@/components/profit-report";
import { projectProfit } from "@/lib/profit";
import { approveBoqBaseline, unlockBoqBaseline } from "../../actions/boq";
import { SubcontractForm } from "../../subcontractors/subcontract-form";
import { DiaryForm, DiaryList, FleetExpenseForm, PhotoGrid, PhotoUpload, SurveySection } from "@/components/field";
import { previousCumulative } from "@/lib/surveys";
import { tenderPhotos } from "@/lib/photos";
import { depositSlipRequired } from "@/lib/deposit";
import { DepositSlipInput } from "@/components/deposit-slip";

/** القراءة الآلية (Gemini) وإرسال الفاتورة الإلكترونية قد تستغرق حتى دقيقة */
export const maxDuration = 60;

export async function generateMetadata({ params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return { title: "عطاء" };
  const t = await db.tender.findFirst({ where: { id: Number(params.id) || 0, ...tenderScope(user) }, select: { name: true } });
  return { title: t?.name ?? "عطاء" };
}

const TabTitle = ({ children }: { children: React.ReactNode }) => <span className="px-5 sm:px-6">{children}</span>;

export default async function TenderPage({ params, searchParams }: { params: { id: string }; searchParams: { tab?: string } }) {
  const user = await requireUser();
  const seesProfit = await userSees(user, "profit");
  const id = Number(params.id);
  if (!Number.isInteger(id)) notFound();

  const tender = await db.tender.findFirst({
    where: { id, ...tenderScope(user) },
    include: {
      manager: { select: { id: true, name: true } },
      boqItems: { orderBy: { sortOrder: "asc" } },
      guarantees: { orderBy: { issueDate: "asc" } },
      claims: { orderBy: { number: "asc" }, include: { lines: true } },
      expenses: { orderBy: { date: "desc" }, include: { createdBy: { select: { name: true } } } },
      variations: { orderBy: { number: "asc" } },
      subcontracts: { include: { subcontractor: true, certificates: { orderBy: { createdAt: "asc" } }, tender: { select: { id: true, name: true, managerId: true } } }, orderBy: { startDate: "asc" } },
      materials: { orderBy: { date: "desc" } },
      equipmentLogs: { include: { equipment: true }, orderBy: { startDate: "desc" } },
      correspondence: { orderBy: { date: "desc" }, include: { replyTo: { select: { id: true, refNo: true } }, replies: { select: { id: true, refNo: true } } } },
      surveys: { include: { lines: true }, orderBy: { number: "desc" } },
      diaries: { orderBy: { date: "desc" }, take: 60 },
    },
  });
  if (!tender) notFound();

  const tab = searchParams.tab ?? "overview";
  const admin = can.manageTenders(user.role);
  const fin = can.manageFinance(user.role);
  const field = can.fieldOps(user.role);
  const isProject = PROJECT_STATUSES.includes(tender.status);
  const boqTotal = tender.boqItems.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
  const expTotal = tender.expenses.reduce((s, e) => s + e.amount, 0);
  const collected = tender.claims.reduce((s, c) => s + (c.paidAmount ?? 0), 0);
  const contract = tender.awardedValue != null ? round3(tender.awardedValue + tender.variationTotal) : null;
  const value = contract ?? tender.bidAmount ?? boqTotal;
  const earned = earnedValue(contract ?? 0, tender.progress);
  const retentionHeld = heldRetention(tender.claims);
  const maintenance = tender.guarantees.find((g) => g.type === "MAINTENANCE");

  const [managers, gAtts, cAtts, eAtts, vAtts, sAtts, certAtts, mAtts, corrAtts, tenderFiles, cheques, equipment, settings, receivers] = await Promise.all([
    db.user.findMany({ where: { active: true, role: { in: ["PM", "ADMIN"] } }, orderBy: { name: "asc" } }),
    attachmentsMap("guarantee", tender.guarantees.map((g) => g.id)),
    attachmentsMap("claim", tender.claims.map((c) => c.id)),
    attachmentsMap("expense", tender.expenses.map((e) => e.id)),
    attachmentsMap("variation", tender.variations.map((v) => v.id)),
    attachmentsMap("subcontract", tender.subcontracts.map((s) => s.id)),
    attachmentsMap("certificate", tender.subcontracts.flatMap((s) => s.certificates.map((c) => c.id))),
    attachmentsMap("material", tender.materials.map((m) => m.id)),
    attachmentsMap("correspondence", tender.correspondence.map((c) => c.id)),
    db.attachment.findMany({ where: { entityType: "tender", entityId: id }, include: { uploadedBy: { select: { name: true } } }, orderBy: { createdAt: "desc" } }),
    fin ? db.cheque.findMany({ where: { status: "DEFERRED" }, select: { id: true, number: true, payee: true } }) : Promise.resolve([]),
    db.equipment.findMany({ orderBy: { name: "asc" } }),
    getSettings(),
    db.user.findMany({ select: { id: true, name: true } }),
  ]);
  const [previous, surveyAtts, diaryAtts, photos] = await Promise.all([
    previousCumulative(id, tender.surveys.find((s) => s.status === "DRAFT")?.claimId ?? undefined),
    attachmentsMap("survey", tender.surveys.map((s) => s.id)),
    attachmentsMap("diary", tender.diaries.map((d) => d.id)),
    tab === "photos" ? tenderPhotos([id]) : Promise.resolve([]),
  ]);
  const canAccess = user.role !== "PM" || tender.managerId === user.id;
  // تقرير الربحية حسب إعداد «الرؤية» من المدير العام
  const profit = isProjectStatus(tender.status) && seesProfit ? (await projectProfit([id])).get(id) ?? null : null;
  const targetProfit = (await getSettings()).targetProfitPct;
  // تقدم البنود من الحصر الفعلي: أعلى كمية تراكمية مقاسة لكل بند مقابل الكمية التعاقدية
  const measured = new Map<number, number>();
  for (const s of tender.surveys) for (const l of s.lines) measured.set(l.boqItemId, Math.max(measured.get(l.boqItemId) ?? 0, l.cumulativeQty));
  const boqProgress = {
    total: tender.boqItems.length,
    started: tender.boqItems.filter((i) => (measured.get(i.id) ?? 0) > 0).length,
    completed: tender.boqItems.filter((i) => i.quantity > 0 && (measured.get(i.id) ?? 0) >= i.quantity * 0.999).length,
  };
  const nameOf = new Map(receivers.map((u) => [u.id, u.name]));
  const boqApprover = tender.boqApprovedById ? nameOf.get(tender.boqApprovedById) : null;

  const tabs = [
    { key: "overview", label: "دورة الحياة" },
    { key: "boq", label: "جدول الكميات", count: tender.boqItems.length },
    { key: "surveys", label: "الحصر الفعلي", count: tender.surveys.length },
    { key: "claims", label: "المطالبات", count: tender.claims.length },
    { key: "guarantees", label: "الكفالات", count: tender.guarantees.length },
    { key: "files", label: "الوثائق", count: tenderFiles.length },
    { key: "variations", label: "أوامر التغيير", count: tender.variations.length, more: true },
    { key: "expenses", label: "المصاريف", count: tender.expenses.length, more: true },
    { key: "diary", label: "اليومية", count: tender.diaries.length, more: true },
    { key: "photos", label: "الصور", more: true },
    { key: "materials", label: "المواد", count: tender.materials.length, more: true },
    { key: "equipment", label: "الآليات", count: tender.equipmentLogs.length, more: true },
    { key: "subcontracts", label: "مقاولو الباطن", count: tender.subcontracts.length, more: true },
    { key: "correspondence", label: "المراسلات", count: tender.correspondence.length, more: true },
  ];
  const phaseDone = phaseStatus(tender);
  const phaseNow = currentPhase(tender);
  const closed = tender.status === "CLOSED";
  const preAward = PRE_AWARD_STATUSES.includes(tender.status);
  const daysLeft = daysUntil(tender.deadline);
  const canProj = can.manageProjectLifecycle(user.role) && canAccess;
  const quick: { href: string; label: string }[] = [
    ...(isProject && !closed && typeof phaseNow === "number" && phaseNow > 0 ? [{ href: `#phase-${phaseNow}`, label: "المرحلة الحالية" }] : []),
    ...(isProject && canProj ? [{ href: `/tenders/${id}?tab=surveys`, label: "الحصر الفعلي" }] : []),
    ...(isProject && canProj && canAccess ? [{ href: `/claims/new?tender=${id}`, label: "إعداد مطالبة" }] : []),
    ...(isProject && field && canAccess ? [{ href: `/tenders/${id}?tab=diary`, label: "اليومية" }, { href: `/tenders/${id}?tab=photos`, label: "الصور" }] : []),
    ...(preAward ? [{ href: `/tenders/${id}?tab=boq`, label: "التسعير" }] : []),
    { href: `/tenders/${id}?tab=files`, label: "الوثائق" },
    ...(isProject && canAccess && user.role !== "AUDITOR" ? [{ href: `/tenders/${id}/portal`, label: "بوابة العميل وخطة العمل" }] : []),
  ];

  const analysis = analyzeMaterials(tender.boqItems, tender.materials, tender.progress, settings.wasteTolerancePct, previous);
  const overruns = analysis.filter((a) => a.flag === "over").length;

  return (
    <>
      <PageHeader
        back={{ href: "/tenders", label: user.role === "PM" ? "مشاريعي" : "العطاءات" }}
        title={tender.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <StatusBadge map={TENDER_STATUS} value={tender.status} />
            {tender.kind === "PRIVATE" && <span className="rounded-full bg-gold-soft px-2 py-0.5 text-xs font-bold text-warn">مشروع خاص</span>}
            <span>{tender.number}</span>
            <span>{tender.entity}</span>
            {tender.location && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5" />
                {tender.location}
              </span>
            )}
          </span>
        }
        actions={
          <>
            <a href={`/api/export/tender?id=${id}`} className="btn-secondary" download>
              <FileSpreadsheet className="h-4 w-4" /> تصدير Excel
            </a>
            {can.manageAward(user.role) && tender.awardedValue != null && <ContractQuick tender={tender} guarantees={tender.guarantees} canGuarantees={can.manageGuarantees(user.role)} />}
            {admin && (
              <ModalForm title="المرحلة الحالية والإسناد" trigger={<><UserCog className="h-4 w-4" /> المرحلة والإسناد</>} triggerClass="btn-secondary" action={updateLifecycle.bind(null, id, "stage")}>
                <p className="rounded-xl bg-accent-soft px-3 py-2 text-sm text-[#0058b0]">انقل المشروع لأي مرحلة تطابق واقعه — مناسب لإدخال المشاريع القديمة أو تصحيح المرحلة. البيانات والمرفقات المسجلة تبقى كما هي.</p>
                <Select name="stage" label="المرحلة الحالية" options={STAGE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))} defaultValue={stageOf(tender)} />
                <Grid>
                  <Input name="awardedValue" label="قيمة الإحالة (د.أ)" type="number" defaultValue={tender.awardedValue ?? ""} hint="مطلوبة للمراحل 1–5" />
                  <Input name="progress" label="نسبة الإنجاز (%)" type="number" step="1" min={0} max={100} defaultValue={tender.progress} />
                </Grid>
                <Select name="managerId" label="مدير المشروع" options={managers.map((m) => ({ value: m.id, label: m.name }))} placeholder="— غير مسند —" defaultValue={tender.managerId ?? ""} />
              </ModalForm>
            )}
            {admin && (
              <ModalForm title="تعديل بيانات العطاء" trigger={<><Pencil className="h-4 w-4" /> تعديل</>} triggerClass="btn-secondary" action={updateTender.bind(null, id)} wide>
                <TenderFields t={tender} managers={managers} />
              </ModalForm>
            )}
            {admin && (
              <ConfirmButton action={deleteTender.bind(null, id)} confirm="سيتم حذف العطاء وكل بياناته المرتبطة نهائياً. متابعة؟" className="btn-danger" title="حذف العطاء">
                <Trash2 className="h-4 w-4" />
              </ConfirmButton>
            )}
          </>
        }
      />

      <ArchivePanel
        t={{ ...tender, maintenanceExpenses: tender.expenses.filter((e) => e.category === "MAINTENANCE_WORKS").reduce((x, e) => x + e.amount, 0) }}
        canManage={can.manageProjectLifecycle(user.role)}
        isAdmin={user.baseRole === "ADMIN"}
      />
      {tender.archiveStage === 2 && <p className="mb-5 rounded-2xl bg-ink px-4 py-2.5 text-sm font-bold text-white">🔒 هذا المشروع في الأرشيف النهائي — للاطلاع فقط.</p>}
      {["WON", "EXECUTION"].includes(tender.status) && tender.archiveStage === 0 && (
        <div className="mb-5"><Suspense fallback={null}><SiteWeather tenderId={tender.id} /></Suspense></div>
      )}
      {/* بطاقة الحالة: أين المشروع الآن + أزرار سريعة */}
      <section className="card card-pad mb-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[13px] font-semibold text-ink-muted">{isProject ? "المرحلة الحالية" : "مرحلة العطاء"}</p>
            <p className="mt-0.5 text-xl font-bold leading-snug">
              {closed ? "مغلق — استلام نهائي" : isProject && typeof phaseNow === "number" && phaseNow > 0 ? PHASES[phaseNow as PhaseNo].title : TENDER_STATUS[tender.status]?.label ?? tender.status}
            </p>
            {preAward && <p className="mt-1 text-sm text-ink-soft">آخر موعد للتقديم {fmtDate(tender.deadline)}{daysLeft >= 0 ? ` — متبقٍ ${daysLeft} يوماً` : ""}</p>}
          </div>
          {isProject && (
            <div className="w-full max-w-[220px]">
              <p className="mb-1 text-xs font-semibold text-ink-muted">الإنجاز — مدير المشروع: {tender.manager?.name ?? "غير مسند"}</p>
              <ProgressBar value={tender.progress} />
            </div>
          )}
        </div>
        {isProject && (
          <div className="mt-4">
            <PhaseStepper done={phaseDone} current={typeof phaseNow === "number" && phaseNow > 0 ? (phaseNow as PhaseNo) : null} closed={closed} linkBase={tab === "overview" ? "" : `/tenders/${id}`} />
          </div>
        )}
        <div className="mt-4 flex gap-2 overflow-x-auto pb-0.5">
          {quick.map((q) => (
            <a key={q.label} href={q.href} className="btn-secondary btn-sm shrink-0">{q.label}</a>
          ))}
        </div>
      </section>

      <div className="stagger mb-5 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard
          label={contract != null ? (tender.variationTotal ? "قيمة العقد المعدّلة" : "قيمة الإحالة") : tender.bidAmount ? "قيمة العرض" : "إجمالي جدول الكميات"}
          value={<Money value={value} />}
          sub={tender.variationTotal ? `شاملة أوامر تغيير ${fmtJOD(tender.variationTotal)}` : tender.negotiationDiscount ? `بعد تخفيض ${tender.negotiationDiscount} د.أ` : undefined}
        />
        <StatCard label="المصاريف" value={<Money value={expTotal} />} tone="orange" sub={`${tender.expenses.length} حركة`} />
        <StatCard label="المقبوض من المطالبات" value={<Money value={collected} />} tone="green" sub={contract ? `${((collected / contract) * 100).toFixed(0)}% من قيمة العقد — محجوزات ${fmtJOD(retentionHeld)}` : undefined} />
        {seesProfit && isProject && earned > 0 ? (
          <StatCard
            label={tender.progress >= 100 ? "الربح التقديري" : "الربح المحقق حتى الآن"}
            value={<Money value={earned - expTotal} />}
            tone={earned - expTotal >= 0 ? "green" : "red"}
            sub={`هامش ${(((earned - expTotal) / earned) * 100).toFixed(1)}% على أعمال منجزة بقيمة ${fmtJOD(earned)}`}
          />
        ) : (
          <div className="card card-pad">
            <p className="text-[13px] font-semibold text-ink-muted">نسبة الإنجاز</p>
            <ProgressBar value={tender.progress} className="mt-4" />
            <p className="mt-2 text-xs text-ink-muted">مدير المشروع: {tender.manager?.name ?? "غير مسند"}</p>
          </div>
        )}
      </div>

      <Tabs tabs={tabs} active={tab} base={`/tenders/${id}`} />
      <TabPanel tab={tab}>

      {tab === "overview" && profit && (tender.finalHandoverDate || tender.closedAt || profit.received > 0) && (
        <div className="mb-5"><ProfitReport p={profit} final={!!(tender.finalHandoverDate || tender.closedAt)} target={targetProfit} /></div>
      )}
      {tab === "overview" && (
        <div className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
          <Card title={isProject ? "مراحل المشروع التعاقدية" : "مراحل العطاء"}>
            <Lifecycle
              tender={tender}
              boqCount={tender.boqItems.length}
              boqTotal={boqTotal}
              user={user}
              stageFiles={tenderFiles.filter((f) => f.slot)}
              guaranteeFiles={gAtts}
              boqProgress={boqProgress}
              surveyCount={tender.surveys.length}
              finalSurvey={tender.surveys.some((s) => s.kind === "FINAL" && s.status !== "DRAFT")}
            />
          </Card>
          <Card title="البيانات الأساسية">
            <KeyValue
              items={[
                { label: "الجهة المالكة", value: tender.entity },
                { label: "رقم العطاء", value: tender.number },
                { label: "التصنيف", value: tender.classification },
                { label: "الموقع", value: tender.location },
                { label: "تاريخ الشراء", value: fmtDate(tender.purchaseDate) },
                { label: "ثمن الوثائق", value: <Money value={tender.docFee} /> },
                { label: "آخر موعد للتقديم", value: fmtDate(tender.deadline) },
                { label: "زيارة الموقع", value: fmtDate(tender.siteVisitDate) },
                { label: "أمر المباشرة", value: fmtDate(tender.commenceOrderDate) },
                { label: "مدة التنفيذ", value: tender.durationDays ? `${tender.durationDays + tender.variationDays} يوماً${tender.variationDays ? ` (منها ${tender.variationDays} بأوامر تغيير)` : ""}` : "—" },
                { label: "مدير المشروع", value: tender.manager?.name ?? "غير مسند" },
                { label: "المهندس المشرف", value: tender.supervisorName ? <span>{tender.supervisorName}{tender.supervisorPhone && <a href={`tel:${tender.supervisorPhone}`} className="num ms-2 font-semibold text-accent">{tender.supervisorPhone}</a>}</span> : "—" },
                { label: "نسبة الإنجاز", value: `${tender.progress}%` },
              ]}
            />
            {tender.notes && <p className="mt-5 whitespace-pre-line rounded-xl bg-canvas p-3 text-sm text-ink-soft">{tender.notes}</p>}
          </Card>
        </div>
      )}

      {tab === "boq" && (
        <section className={`card card-pad mb-5 flex flex-wrap items-center justify-between gap-3 ${tender.boqApprovedAt ? "border-good/30" : "border-warn/30"}`}>
          <div className="flex items-start gap-3">
            {tender.boqApprovedAt ? <Lock className="mt-0.5 h-5 w-5 text-good" /> : <Unlock className="mt-0.5 h-5 w-5 text-warn" />}
            <div>
              <p className="font-bold">{tender.boqApprovedAt ? "جدول الكميات التعاقدي معتمد ومقفل" : "جدول الكميات بانتظار اعتماد المحاسب"}</p>
              <p className="text-sm text-ink-muted">
                {tender.boqApprovedAt
                  ? `اعتمده ${boqApprover ?? "المحاسب"} بتاريخ ${fmtDate(tender.boqApprovedAt)} — الأسعار والكميات الأصلية مقفلة، وأي تغيير يتم بأمر تغيير يعتمده المدير العام.`
                  : "يدخل مدير المشروع البنود والكميات والأسعار، ثم يدققها المحاسب ويعتمدها كأساس تعاقدي. يبدأ الحصر الميداني بعد الاعتماد."}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            {!tender.boqApprovedAt && fin && tender.boqItems.length > 0 && (
              <ConfirmButton action={approveBoqBaseline.bind(null, id)} confirm={`اعتماد جدول الكميات التعاقدي (${tender.boqItems.length} بنداً بإجمالي ${fmtJOD(boqTotal)})؟ ستُقفل الأسعار والكميات.`} className="btn-primary">
                اعتماد جدول الكميات التعاقدي
              </ConfirmButton>
            )}
            {tender.boqApprovedAt && admin && (
              <ConfirmButton action={unlockBoqBaseline.bind(null, id)} confirm="فك قفل جدول الكميات المعتمد؟ (استثناء للمدير العام — يُسجل في سجل الرقابة)" className="btn-secondary">
                فك القفل (المدير العام)
              </ConfirmButton>
            )}
          </div>
        </section>
      )}

      {tab === "boq" && (
        <>
          {!tender.boqApprovedAt && (admin || user.role === "ACCOUNTANT" || (user.role === "PM" && tender.managerId === user.id)) && (
            <AiBoqImport tenderId={id} configured={geminiConfigured()} model={geminiModel()} canApply={admin || (user.role === "PM" && tender.managerId === user.id)} />
          )}
          <BoqEditor
            tenderId={id}
            canEdit={!tender.boqApprovedAt && (admin || (user.role === "PM" && tender.managerId === user.id))}
            showEdits={user.role !== "PM"}
            items={tender.boqItems.map((i) => ({ id: i.id, itemNo: i.itemNo, description: i.description, category: i.category, unit: i.unit, quantity: i.quantity, unitPrice: i.unitPrice, costPrice: i.costPrice, supplier: i.supplier, specs: i.specs, source: i.source, sourcePage: i.sourcePage, sourceRef: i.sourceRef, editNote: i.editNote, editedAt: i.editedAt?.toISOString() ?? null }))}
          />
        </>
      )}

      {tab === "variations" && (
        <Card
          pad={false}
          className="pt-5"
          title={<TabTitle>أوامر التغيير — المعتمد: <Money value={tender.variationTotal} /> {tender.variationDays ? `و ${tender.variationDays} يوماً` : ""}</TabTitle>}
          action={field && isProject && <TabTitle><VariationForm tenderId={id} /></TabTitle>}
        >
          <VariationTable rows={tender.variations} user={user} atts={vAtts} />
        </Card>
      )}

      {tab === "guarantees" && (
        <Card
          pad={false}
          className="pt-5"
          title={<TabTitle>الكفالات البنكية والشيكات المصدقة</TabTitle>}
          action={can.manageGuarantees(user.role) && (
            <TabTitle>
              <ModalForm title="كفالة جديدة" trigger="+ كفالة" action={createGuarantee.bind(null, id)} wide>
                <GuaranteeFields tender={tender} />
              </ModalForm>
            </TabTitle>
          )}
        >
          <GuaranteeTable rows={tender.guarantees} user={user} atts={gAtts} />
        </Card>
      )}

      {tab === "claims" && (
        <div className="space-y-5">
          {isProject && (
            <div className="stagger grid grid-cols-2 gap-4 xl:grid-cols-4">
              <StatCard label="إجمالي المطالبات" value={<Money value={tender.claims.reduce((s, c) => s + c.grossAmount, 0)} />} />
              <StatCard label="المحجوزات المتراكمة" value={<Money value={retentionHeld} />} tone="purple" sub={settings.retentionCapPct ? `السقف ${settings.retentionCapPct}% = ${fmtJOD(((contract ?? 0) * settings.retentionCapPct) / 100)}` : undefined} />
              <StatCard label="ضريبة وطوابع مقتطعة" value={<Money value={tender.claims.reduce((s, c) => s + c.withholdingTax + c.stampDuty, 0)} />} tone="orange" />
              <div className="card card-pad">
                <p className="text-[13px] font-semibold text-ink-muted">استرداد المحجوزات</p>
                {tender.retentionReleasedDate ? (
                  <p className="mt-2 text-sm">استُردت <b><Money value={tender.retentionReleasedAmount} /></b> بتاريخ {fmtDate(tender.retentionReleasedDate)}</p>
                ) : (
                  <>
                    <p className="mt-2 text-sm text-ink-soft">{maintenance?.expiryDate ? `مجدول مع انتهاء كفالة الصيانة ${fmtDate(maintenance.expiryDate)}` : "تُجدول مع كفالة الصيانة"}</p>
                    {fin && retentionHeld > 0 && (
                      <ModalForm title="استرداد المحجوزات" trigger="تسجيل الاسترداد" triggerClass="btn-ghost btn-sm mt-2" action={releaseRetention.bind(null, id)}>
                        <Grid>
                          <Input name="date" label="تاريخ الاسترداد" type="date" required defaultValue={toInputDate(todayUTC())} />
                          <Input name="amount" label="المبلغ" type="number" defaultValue={retentionHeld} />
                        </Grid>
                        <p className="text-xs text-ink-muted">يُسجل كإيداع في الحساب البنكي تلقائياً.</p>
                        <DepositSlipInput required={depositSlipRequired(user)} />
                      </ModalForm>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
          <Card
            pad={false}
            className="pt-5"
            title={<TabTitle>المطالبات المرحلية والنهائية</TabTitle>}
            action={isProject && (
              <TabTitle>
                <span className="flex flex-wrap gap-2">
                  {can.manageProjectLifecycle(user.role) && canAccess && <a href={`/claims/new?tender=${id}`} className="btn-primary btn-sm">إنشاء مطالبة</a>}
                  {user.role === "PM" && <a href={`/tenders/${id}?tab=surveys`} className="btn-primary btn-sm">مطالبة من الحصر الفعلي</a>}
                  {admin && (
                    <ModalForm title="مطالبة يدوية (مبلغ مقطوع)" trigger="+ مطالبة يدوية" triggerClass="btn-secondary btn-sm" action={createClaim.bind(null, id)} wide>
                      <p className="rounded-xl bg-warn-soft px-3 py-2 text-xs font-semibold text-warn">للحالات الخاصة فقط — الطريقة المعتمدة هي إصدار المطالبة من الحصر الفعلي للكميات.</p>
                      <ClaimFields />
                    </ModalForm>
                  )}
                </span>
              </TabTitle>
            )}
          >
            <ClaimTable rows={tender.claims} user={user} atts={cAtts} />
          </Card>
        </div>
      )}

      {tab === "subcontracts" && (
        <div className="space-y-4">
          {can.manageSubcontracts(user.role) && isProject && (
            <div className="flex justify-end">
              <SubcontractForm tenders={[{ id, name: tender.name }]} fixedTenderId={id} />
            </div>
          )}
          {tender.subcontracts.length === 0 ? (
            <Card><p className="py-8 text-center text-sm text-ink-muted">لا توجد اتفاقيات مقاولة باطن على هذا المشروع</p></Card>
          ) : (
            tender.subcontracts.map((sc) => <SubcontractCard key={sc.id} sc={sc} user={user} atts={sAtts} certAtts={certAtts} />)
          )}
        </div>
      )}

      {tab === "surveys" && (
        <SurveySection
          tenderId={id}
          surveys={tender.surveys}
          boqItems={tender.boqItems}
          previous={previous}
          user={user}
          isProject={isProject}
          canAccess={canAccess}
          claimNumbers={new Map(tender.claims.map((c) => [c.id, c.number]))}
          atts={surveyAtts}
          boqApproved={!!tender.boqApprovedAt}
          claimInfo={new Map(tender.claims.map((c) => [c.id, { number: c.number, status: c.status, returnReason: c.returnReason }]))}
        />
      )}

      {tab === "diary" && (
        <div className="space-y-4">
          {field && isProject && (
            <div className="flex justify-end">
              <DiaryForm tenderId={id} />
            </div>
          )}
          <DiaryList rows={tender.diaries} user={user} atts={diaryAtts} />
        </div>
      )}

      {tab === "photos" && (
        <Card title={`معرض صور الموقع (${photos.length})`} action={field && <PhotoUpload tenderId={id} />}>
          <PhotoGrid photos={photos} />
        </Card>
      )}

      {tab === "materials" && (
        <div className="space-y-5">
          <Card pad={false} className="pt-5" title={<TabTitle>مقارنة التوريد مع جدول الكميات {overruns > 0 && <span className="text-sm text-bad">— {overruns} بنود متجاوزة</span>}</TabTitle>}>
            <MaterialAnalysisTable rows={analysis} tolerance={settings.wasteTolerancePct} />
          </Card>
          <Card
            pad={false}
            className="pt-5"
            title={<TabTitle>سجل التوريدات للموقع</TabTitle>}
            action={field && <TabTitle><MaterialForm tenderId={id} boqItems={tender.boqItems} /></TabTitle>}
          >
            <MaterialReceiptTable
              rows={tender.materials.map((m) => ({ ...m, boqLabel: tender.boqItems.find((b) => b.id === m.boqItemId)?.description ?? null, receivedBy: { name: nameOf.get(m.receivedById) ?? "" } }))}
              user={user}
              atts={mAtts}
            />
          </Card>
        </div>
      )}

      {tab === "equipment" && (
        <Card
          pad={false}
          className="pt-5"
          title={<TabTitle>تشغيل الآليات — الكلفة المحملة: <Money value={tender.equipmentLogs.reduce((s, l) => s + l.cost, 0)} /></TabTitle>}
          action={field && <TabTitle><span className="flex flex-wrap gap-2"><FleetExpenseForm equipment={equipment} tenders={[]} user={user} fixedTenderId={id} /><EquipmentLogForm tenderId={id} equipment={equipment} /></span></TabTitle>}
        >
          <EquipmentLogTable rows={tender.equipmentLogs} user={user} />
        </Card>
      )}

      {tab === "expenses" && (
        <Card
          pad={false}
          className="pt-5"
          title={<TabTitle>مصاريف المشروع — <Money value={expTotal} /></TabTitle>}
          action={(fin || user.role === "PM") && (
            <TabTitle>
              <ModalForm title="مصروف جديد" trigger="+ مصروف" action={createExpense}>
                <ExpenseFormFields tenders={[]} user={user} fixedTenderId={id} cheques={cheques} />
              </ModalForm>
            </TabTitle>
          )}
        >
          <ExpenseTable rows={tender.expenses} user={user} atts={eAtts} />
        </Card>
      )}

      {tab === "correspondence" && (
        <Card pad={false} className="pt-5" title={<TabTitle>الصادر والوارد للمشروع</TabTitle>} action={<TabTitle><span className="flex flex-wrap gap-2"><OfficialLetterForm tenders={[]} fixedTenderId={id} today={toInputDate(todayUTC())} incoming={tender.correspondence.filter((c) => c.direction === "IN").map((c) => ({ id: c.id, refNo: c.refNo, party: c.party, subject: c.subject, theirRef: c.theirRef, tenderId: c.tenderId, date: fmtDate(c.date) }))} /><CorrespondenceForm tenders={[]} fixedTenderId={id} /></span></TabTitle>}>
          <CorrespondenceTable rows={tender.correspondence} user={user} atts={corrAtts} />
        </Card>
      )}

      {tab === "files" && (
        <Card title="وثائق العطاء والمشروع" action={(admin || user.role === "PM") && <UploadButton entityType="tender" entityId={id} />}>
          <AttachmentGrid items={tenderFiles} canDelete={admin} />
        </Card>
      )}
      </TabPanel>
    </>
  );
}

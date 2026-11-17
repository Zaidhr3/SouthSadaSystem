import Link from "next/link";
import { notFound } from "next/navigation";
import { FileSpreadsheet, Lock, Pencil } from "lucide-react";
import { getCurrentUser, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { can, tenderScope } from "@/lib/permissions";
import { CLAIM_STATUS, CLAIM_TYPE } from "@/lib/labels";
import { claimNet, COUNTED_CLAIM } from "@/lib/deductions";
import { fmtDate, round3 } from "@/lib/format";
import { tafqeetJOD } from "@/lib/tafqeet";
import { StatusBadge } from "@/components/ui";
import { ConfirmButton, Grid, Input, ModalForm, Select, Textarea } from "@/components/forms";
import { PrintButton } from "@/components/print-button";
import { Logo } from "@/components/logo";
import { approveDraftClaim, returnDraftClaim } from "../../actions/field";
import { auditClaimWithInvoice } from "../../actions/invoice";
import { InvoiceEditor } from "./invoice-editor";
import { AuthorizeReturn, DecideReturn, InvoiceReturnForm } from "./invoice-return";
import { ReturnInvoiceDoc } from "@/components/tax-invoice";
import { ConfirmButton as RetryButton } from "@/components/forms";
import { sendInvoiceReturn } from "../../actions/einv-return";
import { computeReturn, type ReturnLine } from "@/lib/jofotara";
import { originalInvoiceLines, returnedQty } from "@/lib/einv-lines";
import { getBrand } from "@/lib/brand";
import { reviewDraftClaim } from "../../actions/claims";
import { reopenClaim, returnClaim } from "../../actions/claim-flow";
import { ClaimFlowPanel } from "@/components/claim-flow-panel";
import { ReceiptPanel } from "@/components/receipt-panel";
import { TaxInvoiceDoc } from "@/components/tax-invoice";
import { einvReadiness, getEinvSettings, invoiceBuyer, invoiceForClaim, parseInvoiceOverride, regularInvoiceForClaim } from "@/lib/jofotara";
import { isReadOnly } from "@/lib/permissions";
import { depositSlipRequired } from "@/lib/deposit";

/** القراءة الآلية (Gemini) وإرسال الفاتورة الإلكترونية قد تستغرق حتى دقيقة */
export const maxDuration = 60;

export async function generateMetadata({ params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  const c = user ? await db.claim.findFirst({ where: { id: Number(params.id) || 0, tender: tenderScope(user) }, select: { number: true, tender: { select: { name: true } } } }) : null;
  return { title: c ? `مطالبة ${c.number} — ${c.tender.name}` : "مطالبة" };
}

const nf = new Intl.NumberFormat("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const qf = new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 });

/** المستند الرسمي للمطالبة (الخلاصة + الأعمال المنجزة) — جاهز للطباعة الورقية أو الحفظ PDF */
export default async function ClaimDocumentPage({ params }: { params: { id: string } }) {
  const user = await requireUser();
  const id = Number(params.id);
  const claim = await db.claim.findFirst({
    where: { id: Number.isInteger(id) ? id : 0, tender: tenderScope(user) },
    include: { lines: { orderBy: { id: "asc" } }, tender: { include: { manager: { select: { name: true } }, claims: { select: { id: true, number: true, grossAmount: true, retention: true, status: true } } } } },
  });
  if (!claim) notFound();
  const t = claim.tender;
  const [preparer, approver, survey, events, messages, people] = await Promise.all([
    claim.preparedById ? db.user.findUnique({ where: { id: claim.preparedById }, select: { name: true, role: true } }) : null,
    claim.approvedById ? db.user.findUnique({ where: { id: claim.approvedById }, select: { name: true } }) : null,
    db.survey.findFirst({ where: { claimId: claim.id }, select: { number: true, date: true } }),
    db.claimEvent.findMany({ where: { claimId: claim.id }, orderBy: { createdAt: "asc" } }),
    db.message.findMany({ where: { claimId: claim.id }, include: { sender: { select: { name: true } }, recipient: { select: { name: true } } }, orderBy: { createdAt: "asc" } }),
    db.user.findMany({ where: { active: true, OR: [{ role: { in: ["ADMIN", "ACCOUNTANT"] } }, { id: claim.tender.managerId ?? -1 }] }, select: { id: true, name: true, role: true }, orderBy: { name: "asc" } }),
  ]);
  const pmOwn = user.role === "PM" && claim.tender.managerId === user.id;
  const canDisburse = can.manageProjectLifecycle(user.role) && (user.role !== "PM" || pmOwn);

  const earlier = t.claims.filter((c) => c.number < claim.number && c.status !== "REJECTED");
  const previousGross = round3(earlier.reduce((s, c) => s + c.grossAmount, 0));
  const cumulativeGross = round3(previousGross + claim.grossAmount);
  const contract = round3((t.awardedValue ?? 0) + t.variationTotal);
  const net = claimNet(claim);
  const rate = (stored: number | null, amount: number) => (stored != null ? stored : claim.grossAmount ? round3((amount / claim.grossAmount) * 100) : 0);
  const retentionToDate = round3(t.claims.filter((c) => c.number <= claim.number && (COUNTED_CLAIM(c.status) || c.id === claim.id)).reduce((s, c) => s + c.retention, 0));
  const fin = can.manageFinance(user.role);
  const admin = can.manageTenders(user.role);
  const canApprove = can.approveClaims(user.role);
  const einv = await getEinvSettings();
  const brand = await getBrand();
  const seller = { name: einv.companyName, tin: einv.tin, slogan: brand.slogan };
  // فواتير الإرجاع (إشعارات دائنة) على الفاتورة المعتمدة
  const returns = await db.einvReturn.findMany({ where: { claimId: claim.id }, orderBy: { id: "asc" } });
  // المحاسب يعدّ فاتورة الإرجاع ويرسلها، بإذن المدير العام (طلب ← موافقة، أو تكليف مسبق)
  const returnable = claim.einvStatus === "SUBMITTED" && (fin || user.role === "ADMIN");
  const permit = returns.find((r) => r.status === "AUTHORIZED");
  const origLines = returnable ? await originalInvoiceLines(claim) : [];
  const usedQty = returnable ? await returnedQty(claim.id) : new Map<number, number>();
  const invoice = invoiceForClaim(claim, einv);
  const regularInvoice = regularInvoiceForClaim(claim);
  const buyerInfo = invoiceBuyer(claim);
  const override = parseInvoiceOverride(claim.invoiceOverride);
  const regularOnly = claim.invoiceMode === "REGULAR";
  // تعديل الفاتورة: المدير العام قبل اعتمادها من نظام الفوترة
  const canEditInvoice = user.role === "ADMIN" && claim.einvStatus !== "SUBMITTED" && !regularOnly;
  const title = `${CLAIM_TYPE[claim.type]} رقم (${claim.number})`;

  const summary: { label: string; value: number; strong?: boolean; neg?: boolean }[] = [
    { label: "قيمة الأعمال المنجزة حتى تاريخه (تراكمي)", value: cumulativeGross },
    { label: "ينزل: قيمة المطالبات السابقة", value: previousGross, neg: true },
    { label: "قيمة الأعمال المنجزة لهذه المطالبة", value: claim.grossAmount, strong: true },
    { label: `ينزل: التأمينات المحجوزة (${rate(claim.retentionRate, claim.retention)}%)`, value: claim.retention, neg: true },
    { label: `ينزل: رسوم طوابع الواردات (${rate(claim.stampRate, claim.stampDuty)}%)`, value: claim.stampDuty, neg: true },
    ...(claim.deductions ? [{ label: `ينزل: ${claim.deductionNotes || "خصومات أخرى"}${claim.deductionRate ? ` (${claim.deductionRate}%)` : ""}`, value: claim.deductions, neg: true }] : []),
  ];

  return (
    <>
      <style>{`@page { size: A4 landscape; margin: 10mm; } @media print { body { background: #fff !important; } .doc { box-shadow: none !important; border: none !important; padding: 0 !important; } }`}</style>

      {/* شريط الإجراءات — لا يُطبع */}
      <div className="no-print mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href={`/tenders/${t.id}?tab=claims`} className="text-sm font-semibold text-accent hover:underline">‹ {t.name}</Link>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-muted">
            <StatusBadge map={CLAIM_STATUS} value={claim.status} />
            {claim.lockedAt && <span className="inline-flex items-center gap-1"><Lock className="h-3.5 w-3.5" /> وافقت عليها الإدارة {fmtDate(claim.lockedAt)}{approver ? ` — ${approver.name}` : ""}</span>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {/* الخطوة الثانية — المحاسب: تدقيق الحسابات والكميات والخصومات ثم الرفع للإدارة */}
          {claim.status === "DRAFT" && fin && (
            <>
              <Link href={`/claims/new?tender=${t.id}&claim=${claim.id}`} className="btn-secondary"><Pencil className="h-4 w-4" /> تعديل الكميات</Link>
              <ModalForm title="مراجعة المطالبة: الملاحظات والحسومات" trigger="الملاحظات والحسومات" triggerClass="btn-secondary" action={reviewDraftClaim.bind(null, claim.id)}>
                <p className="rounded-xl bg-canvas px-3 py-2 text-xs text-ink-muted">يُخصم من صافي المطالبة ويظهر في المستند الرسمي مع سببه (مثل: نواقص لم تُنفذ، مخالفة مواصفات، غرامة تأخير). النسبة تُحتسب من قيمة أعمال هذه المطالبة ({nf.format(claim.grossAmount)} د.أ).</p>
                <Grid cols={3}>
                  <Select name="deductionMode" label="نوع الحسم" options={{ none: "بدون حسم", pct: "نسبة %", amount: "مبلغ ثابت (د.أ)" }} defaultValue={claim.deductionRate ? "pct" : claim.deductions ? "amount" : "none"} />
                  <Input name="deductionValue" label="النسبة أو المبلغ" inputMode="decimal" defaultValue={claim.deductionRate ?? (claim.deductions || "")} />
                  <Input name="deductionNotes" label="سبب الحسم" defaultValue={claim.deductionNotes ?? ""} placeholder="نواقص في أعمال الدهان" />
                </Grid>
                <Textarea name="notes" label="ملاحظات المراجعة" defaultValue={claim.notes ?? ""} />
              </ModalForm>
              {(survey || t.managerId) && (
                <ModalForm title="رفض / تعديل — إرجاع لمدير المشروع" trigger="رفض / تعديل" triggerClass="btn-secondary" action={returnClaim.bind(null, claim.id)} submitLabel="إرجاع مع الملاحظات">
                  <Textarea name="reason" label="سبب الإرجاع (يظهر لمدير المشروع)" required placeholder="مثال: كمية البند 4 تتجاوز المنفذ فعلياً — يرجى إعادة القياس" />
                </ModalForm>
              )}
              <ModalForm title="قبول وتدقيق — الرفع للإدارة" trigger="قبول وتدقيق" action={auditClaimWithInvoice.bind(null, claim.id)} submitLabel="قبول وتدقيق ورفع للإدارة">
                <p className="rounded-xl bg-canvas px-3 py-2 text-xs text-ink-muted">تُرفع المطالبة للإدارة ويُرسل بريد رسمي للمدير العام ومدير المشروع. اختر الفاتورة المرفقة:</p>
                <Select name="invoiceMode" label="الفاتورة" options={{ TAX: "الفاتورة الضريبية (جفوتارا) + الفاتورة العادية", REGULAR: "الفاتورة العادية فقط — بدون فاتورة ضريبية" }} defaultValue={claim.invoiceMode === "REGULAR" ? "REGULAR" : "TAX"} />
                <Textarea name="invoiceModeReason" label="سبب الاكتفاء بالفاتورة العادية (إلزامي إن اخترتها — يظهر للإدارة)" defaultValue={claim.invoiceModeReason ?? ""} placeholder="مثال: صاحب العمل طلب فاتورة عادية لهذه الدفعة" />
              </ModalForm>
            </>
          )}
          {(claim.status === "READY" || claim.status === "REVIEW") && fin && !canApprove && (
            <ConfirmButton action={returnDraftClaim.bind(null, claim.id)} confirm="سحب المطالبة من الإدارة لتعديلها؟" className="btn-secondary">سحب للتعديل</ConfirmButton>
          )}
          {/* الخطوة الثالثة — الإدارة: موافقة أو رفض مع السبب */}
          {(claim.status === "READY" || claim.status === "REVIEW") && canApprove && (
            <>
              <ModalForm title={`رفض المطالبة رقم ${claim.number}`} trigger="رفض مع السبب" triggerClass="btn-danger" action={returnClaim.bind(null, claim.id)} submitLabel="رفض وإعادة للتعديل" allowReadOnly>
                <Textarea name="reason" label="سبب الرفض (يظهر لمدير المشروع والمحاسب)" required placeholder="مثال: نسبة الإنجاز المطالب بها في بند الخرسانة أعلى من الواقع" />
                <p className="text-xs text-ink-muted">{t.managerId ? "تُعاد لمدير المشروع لتعديل الكميات والحسومات ثم إعادة إرسالها للتدقيق." : "تعود المطالبة للمحاسب ليعدّلها ويعيد رفعها."}</p>
              </ModalForm>
              <ConfirmButton action={approveDraftClaim.bind(null, claim.id)} confirm={regularOnly ? `الموافقة النهائية على المطالبة بصافي ${nf.format(net)} د.أ مع الفاتورة العادية فقط (بدون فاتورة ضريبية — السبب: ${claim.invoiceModeReason ?? "—"})؟` : `الموافقة النهائية على المطالبة بصافي ${nf.format(net)} د.أ؟ تُعتمد رسمياً وتُرسل الفاتورة لنظام الفوترة الوطني (جفوتارا) تلقائياً.`} className="btn-primary" allowReadOnly><Lock className="h-4 w-4" /> موافقة نهائية</ConfirmButton>
            </>
          )}
          {claim.status === "RETURNED" && (pmOwn || fin) && (
            <Link href={`/claims/new?tender=${t.id}&claim=${claim.id}`} className="btn-primary"><Pencil className="h-4 w-4" /> تعديل المطالبة وإعادة الإرسال</Link>
          )}
          {claim.status === "RETURNED" && fin && !survey && !t.managerId && (
            <ConfirmButton action={reopenClaim.bind(null, claim.id)} confirm="إعادة فتح المطالبة للتدقيق دون تعديل؟" className="btn-secondary">إعادة فتح للتدقيق</ConfirmButton>
          )}
          <a href={`/api/export/claim?id=${claim.id}`} className="btn-secondary" download><FileSpreadsheet className="h-4 w-4" /> تصدير Excel</a>
          <PrintButton />
        </div>
      </div>

      <ClaimFlowPanel
        claim={claim}
        events={events}
        messages={messages}
        recipients={people.filter((p) => p.id !== user.id)}
        canDisburse={canDisburse}
        canMessage={!isReadOnly(user.role) || user.role === "CHAIRMAN"}
        hasSurvey={!!survey}
      />

      {claim.einvStatus === "REJECTED" && claim.status === "DRAFT" && (
        <div className="no-print mb-4 rounded-2xl border border-bad/40 bg-bad-soft px-4 py-3 text-sm text-bad" role="alert">
          <p className="font-bold">رفض نظام الفوترة الوطني الفاتورة — أُعيدت المطالبة للمحاسب مع الفاتورتين (الضريبية والعادية).</p>
          <p className="mt-1 break-words text-xs" dir="auto">{claim.einvError}</p>
          <p className="mt-1 text-xs">صحّح السبب (إعدادات الفوترة أو تعديل الفاتورة من الإدارة) ثم «قبول وتدقيق» ← موافقة الإدارة ← يُعاد الإرسال بنفس رقم الفاتورة SADA-{claim.invoiceNo}.</p>
        </div>
      )}
      {regularOnly && (
        <p className="no-print mb-4 rounded-2xl border border-warn/40 bg-warn-soft px-4 py-3 text-sm font-semibold text-warn" role="status">
          أرفق المحاسب الفاتورة العادية فقط (بدون فاتورة ضريبية — لن تُرسل لنظام الفوترة). السبب: {claim.invoiceModeReason ?? "—"}
        </p>
      )}
      {canEditInvoice && (
        <div className="no-print mb-4 flex flex-wrap items-center gap-2">
          <InvoiceEditor
            claimId={claim.id}
            edited={!!override}
            initial={{
              lines: override?.lines ?? (claim.lines.filter((l) => l.periodQty > 0).length ? claim.lines.filter((l) => l.periodQty > 0).map((l) => ({ description: l.description, unit: l.unit, qty: l.periodQty, price: l.unitPrice })) : [{ description: `قيمة الأعمال المنجزة — المطالبة رقم ${claim.number} — ${t.name}`, unit: "مقطوعية", qty: 1, price: claim.grossAmount }]),
              discount: override?.discount ?? claim.deductions,
              buyerName: buyerInfo.name,
              buyerTin: buyerInfo.tin ?? "",
              buyerPhone: buyerInfo.phone ?? "",
              note: buyerInfo.note ?? "",
            }}
          />
          {override && <span className="text-xs text-ink-muted">الفاتورة معدّلة يدوياً{claim.invoiceEditedAt ? ` بتاريخ ${fmtDate(claim.invoiceEditedAt)}` : ""} — تُرسل بهذه البيانات.</span>}
        </div>
      )}
      <ReceiptPanel claim={claim} net={net} canReceipt={canDisburse} fin={fin} canApprove={canApprove} einvReady={einvReadiness(einv)} slipRequired={depositSlipRequired(user)} />
      {(returnable || returns.length > 0) && (
        <section id="returns" className="no-print card card-pad mb-5 scroll-mt-24">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-bold">فواتير الإرجاع (إشعارات دائنة)</h2>
            <span className="flex flex-wrap gap-2">
              {returnable && fin && user.role !== "ADMIN" && claim.invoiceNo && (
                <InvoiceReturnForm claimId={claim.id} invoiceNo={claim.invoiceNo} permitReason={permit?.reason ?? null} lines={origLines.map((l) => ({ ...l, left: Math.max(0, Math.round((l.qty - (usedQty.get(l.lineNo) ?? 0)) * 1000) / 1000) }))} />
              )}
              {returnable && user.role === "ADMIN" && !permit && <AuthorizeReturn claimId={claim.id} />}
            </span>
          </div>
          {permit && (
            <p className="mb-2 rounded-xl bg-warn-soft px-3 py-2 text-sm font-semibold text-warn">
              تكليف من المدير العام بفاتورة إرجاع: {permit.reason}{fin ? " — اضغط «إعداد وإرسال فاتورة الإرجاع»." : " — بانتظار المحاسب."}
            </p>
          )}
          {returns.filter((r) => r.status !== "AUTHORIZED").length === 0 ? (
            <p className="text-sm text-ink-muted">لا توجد فواتير إرجاع على هذه الفاتورة.</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {returns
                .filter((r) => r.status !== "AUTHORIZED")
                .map((r) => {
                  const st: Record<string, [string, string]> = {
                    REQUESTED: ["بانتظار إذن المدير العام", "bg-warn-soft text-warn"],
                    APPROVED: ["موافق عليها — بانتظار إرسال المحاسب", "bg-accent-soft text-accent"],
                    SUBMITTED: ["معتمدة من نظام الفوترة", "bg-good-soft text-good"],
                    FAILED: ["لم تصل لنظام الفوترة — أعد الإرسال", "bg-bad-soft text-bad"],
                    REJECTED: ["رفضها نظام الفوترة", "bg-bad-soft text-bad"],
                    DECLINED: ["رفض المدير العام الطلب", "bg-black/[0.05] text-ink-muted"],
                  };
                  const [label, tone] = st[r.status] ?? [r.status, "bg-black/[0.05]"];
                  return (
                    <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <span>
                        <b className="num">{r.number ? `SADA-${r.number}` : "—"}</b> — <span className="num">{nf.format(r.amount)}</span> د.أ — {r.reason}
                        <span className={`ms-2 rounded-full px-2 py-0.5 text-[11px] font-bold ${tone}`}>{label}</span>
                        {r.adminNote && <span className="mt-1 block text-xs text-ink-muted">ملاحظة الإدارة: {r.adminNote}</span>}
                        {r.error && r.status !== "SUBMITTED" && <span className="mt-1 block text-xs text-bad">{r.error}</span>}
                      </span>
                      {r.status === "REQUESTED" && user.role === "ADMIN" && <DecideReturn id={r.id} />}
                      {(r.status === "APPROVED" || r.status === "FAILED") && fin && (
                        <RetryButton action={sendInvoiceReturn.bind(null, r.id)} confirm="إرسال فاتورة الإرجاع لنظام الفوترة الوطني؟ (إجراء ضريبي رسمي)" className="btn-primary btn-sm">
                          {r.status === "FAILED" ? "إعادة الإرسال" : "إرسال لنظام الفوترة"}
                        </RetryButton>
                      )}
                    </li>
                  );
                })}
            </ul>
          )}
        </section>
      )}

      {/* المستند الرسمي */}
      <article className="doc card bg-white p-6 text-[13px] leading-relaxed text-black sm:p-10 print:text-[11px]">
        {["DRAFT", "READY", "REVIEW", "RETURNED", "REJECTED"].includes(claim.status) && (
          <p className="mb-3 rounded border border-dashed border-black/40 py-1 text-center text-xs font-bold tracking-widest text-black/60">
            {claim.status === "DRAFT" ? "قيد التدقيق لدى المحاسب — غير صالحة للتسليم" : claim.status === "RETURNED" ? "مرفوضة — معادة للتعديل" : claim.status === "REJECTED" ? "مرفوضة من صاحب العمل" : "بانتظار موافقة الإدارة — غير صالحة للتسليم"}
          </p>
        )}
        <div className="flex items-start justify-between gap-6 border-b-2 border-black pb-4">
          <div className="flex items-center gap-3">
            <Logo height={64} />
            <div>
              <p className="text-lg font-bold">شركة صدى الجنوب للمقاولات الإنشائية</p>
              <p className="text-xs">مقاول مصنف — فئة رابعة أبنية — المملكة الأردنية الهاشمية</p>
            </div>
          </div>
          <div className="text-end text-xs">
            <p>التاريخ: <b className="num">{fmtDate(claim.submittedDate)}</b></p>
            <p>المرجع: <b className="num">م/{t.number}/{claim.number}</b></p>
            {survey && <p>بموجب الحصر الفعلي رقم {survey.number} بتاريخ {fmtDate(survey.date)}</p>}
          </div>
        </div>

        <h1 className="my-4 text-center text-xl font-bold underline underline-offset-8">{title} — الخلاصة</h1>

        <table className="mb-5 w-full border-collapse text-[12px] print:text-[10.5px]">
          <tbody>
            {[
              ["صاحب العمل", t.entity, "رقم العطاء", t.number],
              ["المشروع", t.name, "الموقع", t.location ?? "—"],
              ["قيمة العقد (شاملة أوامر التغيير)", `${nf.format(contract)} د.أ`, "تاريخ أمر المباشرة", fmtDate(t.commenceOrderDate)],
              ["مدة التنفيذ", t.durationDays ? `${t.durationDays + t.variationDays} يوماً` : "—", "مدير المشروع", t.manager?.name ?? "—"],
            ].map((row, i) => (
              <tr key={i}>
                <th className="w-[18%] border border-black/50 bg-black/[0.04] px-2 py-1.5 text-start font-bold">{row[0]}</th>
                <td className="w-[32%] border border-black/50 px-2 py-1.5">{row[1]}</td>
                <th className="w-[18%] border border-black/50 bg-black/[0.04] px-2 py-1.5 text-start font-bold">{row[2]}</th>
                <td className="w-[32%] border border-black/50 px-2 py-1.5 num" style={{ direction: "rtl" }}>{row[3]}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <table className="mx-auto mb-3 w-full max-w-3xl border-collapse">
          <tbody>
            {summary.map((s) => (
              <tr key={s.label} className={s.strong ? "bg-black/[0.05] font-bold" : ""}>
                <td className="border border-black/50 px-3 py-1.5">{s.label}</td>
                <td className="w-44 border border-black/50 px-3 py-1.5 text-end num">{s.neg && s.value ? `(${nf.format(s.value)})` : nf.format(s.value)}</td>
              </tr>
            ))}
            <tr className="bg-black text-white">
              <td className="border border-black px-3 py-2 font-bold">صافي المبلغ المستحق للصرف</td>
              <td className="border border-black px-3 py-2 text-end text-base font-bold num">{nf.format(net)} د.أ</td>
            </tr>
          </tbody>
        </table>
        <p className="mx-auto mb-2 max-w-3xl text-center font-bold">{tafqeetJOD(net)}</p>
        <p className="mx-auto mb-6 max-w-3xl text-center text-[11px] text-black/70">
          إجمالي التأمينات المحجوزة حتى تاريخه: {nf.format(retentionToDate)} د.أ
        </p>

        {claim.lines.length > 0 && (
          <div className="print:break-before-page">
            <h2 className="mb-2 text-center text-base font-bold">جدول الأعمال المنجزة — حسب الحصر الفعلي للكميات</h2>
            <table className="w-full border-collapse text-[11.5px] print:text-[9.5px]">
              <thead>
                <tr className="bg-black/[0.06]">
                  {["#", "وصف البند", "الوحدة", "كمية العقد", "سعر الوحدة", "قيمة العقد", "الكمية السابقة", "كمية الفترة", "الكمية التراكمية", "قيمة الفترة", "القيمة التراكمية"].map((h) => (
                    <th key={h} className="border border-black/50 px-1.5 py-1.5 text-center font-bold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {claim.lines.map((l, i) => (
                  <tr key={l.id}>
                    <td className="border border-black/50 px-1.5 py-1 text-center num">{i + 1}</td>
                    <td className="border border-black/50 px-1.5 py-1">{l.description}</td>
                    <td className="border border-black/50 px-1.5 py-1 text-center">{l.unit}</td>
                    <td className="border border-black/50 px-1.5 py-1 text-end num">{qf.format(l.boqQty)}</td>
                    <td className="border border-black/50 px-1.5 py-1 text-end num">{nf.format(l.unitPrice)}</td>
                    <td className="border border-black/50 px-1.5 py-1 text-end num">{nf.format(round3(l.boqQty * l.unitPrice))}</td>
                    <td className="border border-black/50 px-1.5 py-1 text-end num">{qf.format(l.previousQty)}</td>
                    <td className="border border-black/50 px-1.5 py-1 text-end num font-bold">{qf.format(l.periodQty)}</td>
                    <td className={`border border-black/50 px-1.5 py-1 text-end num ${l.cumulativeQty > l.boqQty ? "font-bold underline" : ""}`}>{qf.format(l.cumulativeQty)}</td>
                    <td className="border border-black/50 px-1.5 py-1 text-end num font-bold">{nf.format(l.amount)}</td>
                    <td className="border border-black/50 px-1.5 py-1 text-end num">{nf.format(round3(l.cumulativeQty * l.unitPrice))}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-black/[0.06] font-bold">
                  <td colSpan={5} className="border border-black/50 px-1.5 py-1.5">المجموع</td>
                  <td className="border border-black/50 px-1.5 py-1.5 text-end num">{nf.format(round3(claim.lines.reduce((s, l) => s + l.boqQty * l.unitPrice, 0)))}</td>
                  <td colSpan={3} className="border border-black/50" />
                  <td className="border border-black/50 px-1.5 py-1.5 text-end num">{nf.format(claim.grossAmount)}</td>
                  <td className="border border-black/50 px-1.5 py-1.5 text-end num">{nf.format(round3(claim.lines.reduce((s, l) => s + l.cumulativeQty * l.unitPrice, 0)))}</td>
                </tr>
              </tfoot>
            </table>
            <p className="mt-1 text-[10px] text-black/60">الكميات المسطّرة تتجاوز كمية العقد وفق القياس الفعلي في الموقع.</p>
          </div>
        )}

        {/* جدول التواقيع الرسمي: تنظيم المقاول | تدقيق رئيس القسم | ممثل صاحب العمل */}
        <table className="mt-10 w-full table-fixed border-collapse text-[12.5px] print:mt-8 print:break-inside-avoid print:text-[11px]">
          <thead>
            <tr>
              {["تنظيم المقاول", "تدقيق رئيس القسم", "ممثل صاحب العمل"].map((h) => (
                <th key={h} className="border border-black/60 bg-black/[0.05] px-3 py-2 text-center font-bold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {["الاسم :- ....................", "التوقيع :- ...................."].map((label) => (
              <tr key={label}>
                {[0, 1, 2].map((i) => (
                  <td key={i} className="h-12 border border-black/60 px-3 py-2 text-start align-middle">{label}</td>
                ))}
              </tr>
            ))}
            <tr>
              <td colSpan={3} className="h-24 border border-black/60 px-3 py-2 text-start align-top font-bold">توقيع وختم المقاول:</td>
            </tr>
          </tbody>
        </table>
        {claim.notes && <p className="mt-6 border-t border-black/30 pt-2 text-[11px]">ملاحظات: {claim.notes}</p>}
      </article>

      {/* الفاتورة الضريبية (إلا إن اختار المحاسب العادية فقط) ثم الفاتورة العادية — تُطبعان مع المطالبة */}
      {!regularOnly && (
        <TaxInvoiceDoc
          inv={invoice}
          seller={seller}
          buyer={{ name: buyerInfo.name, tin: buyerInfo.tin, project: t.name, tenderNo: t.number }}
          meta={{ invoiceNo: claim.invoiceNo, uuid: claim.einvUuid, qr: claim.einvQr, date: claim.submittedDate, claimLabel: `${title} — م/${t.number}/${claim.number}`, submittedAt: claim.einvSubmittedAt, einvNumber: claim.einvNumber }}
          edited={!!override}
          note={buyerInfo.note}
        />
      )}
      <TaxInvoiceDoc
        variant="regular"
        inv={regularInvoice}
        seller={seller}
        buyer={{ name: buyerInfo.name, tin: buyerInfo.tin, project: t.name, tenderNo: t.number }}
        meta={{ invoiceNo: claim.invoiceNo, uuid: null, qr: null, date: claim.submittedDate, claimLabel: `${title} — م/${t.number}/${claim.number}`, submittedAt: null, einvNumber: null }}
        note={regularOnly ? `فاتورة عادية فقط — ${claim.invoiceModeReason ?? ""}` : buyerInfo.note}
      />
      {returns.filter((r) => ["SUBMITTED", "APPROVED", "FAILED", "REQUESTED"].includes(r.status) && r.lines !== "[]").map((r) => {
        const rl = JSON.parse(r.lines) as ReturnLine[];
        return (
          <ReturnInvoiceDoc
            key={r.id}
            inv={computeReturn(rl, einv)}
            lineNos={rl.map((l) => l.lineNo)}
            seller={seller}
            buyer={{ name: buyerInfo.name, tin: buyerInfo.tin, project: t.name, tenderNo: t.number }}
            ret={{ number: r.number ?? 0, origNo: claim.invoiceNo, origUuid: claim.einvUuid, reason: r.reason, qr: r.qr, uuid: r.uuid, date: r.submittedAt ?? r.createdAt, claimLabel: `${title} — م/${t.number}/${claim.number}` }}
          />
        );
      })}
    </>
  );
}

import { BadgeCheck, Banknote, FileCheck2, Landmark, ReceiptText } from "lucide-react";
import type { Claim } from "@prisma/client";
import { Badge, StatusBadge } from "./ui";
import { ConfirmButton, FileInput, Grid, Input, ModalForm, Select, Textarea } from "./forms";
import { EINV_STATUS, PAY_STAGE } from "@/lib/labels";
import { fmtDate, toInputDate, todayUTC } from "@/lib/format";
import { approveReceipt, auditReceipt, rejectReceipt, sendClaimInvoice, submitReceipt } from "@/app/(app)/actions/receipt";
import { DepositSlipInput } from "./deposit-slip";

const nf = new Intl.NumberFormat("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 });

/**
 * بعد موافقة الإدارة: الفاتورة الإلكترونية + دورة القبض الثلاثية
 * (1) مدير المشروع: تم صرف الشيك مع صورته إلزامياً ← (2) المحاسب: تدقيق ← (3) الإدارة: موافقة ← إيداع بنكي وأرشفة.
 */
export function ReceiptPanel({
  claim,
  net,
  canReceipt,
  fin,
  canApprove,
  einvReady,
  slipRequired = true,
}: {
  claim: Claim;
  net: number;
  canReceipt: boolean;
  fin: boolean;
  canApprove: boolean;
  einvReady: string | null;
  /** وصل الإيداع إلزامي للمودع من غير الإدارة عند القبض بشيك */
  slipRequired?: boolean;
}) {
  const approved = ["SUBMITTED", "APPROVED", "PAID"].includes(claim.status);
  if (!approved) return null;
  const stage = claim.status === "PAID" ? "DONE" : claim.payStage;
  const steps = [
    { t: "قبض الشيك", on: !!claim.receiptAt || claim.status === "PAID" },
    { t: "تدقيق المحاسب", on: stage === "AUDITED" || stage === "DONE" || claim.status === "PAID" },
    { t: "موافقة الإدارة والإيداع", on: claim.status === "PAID" },
  ];
  return (
    <div className="no-print mb-5 grid gap-4 lg:grid-cols-2">
      {/* الفاتورة الإلكترونية */}
      <section className="card card-pad">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-base font-bold"><ReceiptText className="h-5 w-5 text-accent" aria-hidden /> الفاتورة الإلكترونية (جفوتارا)</h2>
          {claim.einvStatus && <StatusBadge map={EINV_STATUS} value={claim.einvStatus} />}
        </div>
        {claim.invoiceMode === "REGULAR" ? (
          <p className="rounded-xl bg-warn-soft p-3 text-sm font-semibold text-warn">
            فاتورة عادية فقط بقرار المحاسب — لا تُرسل لنظام الفوترة الوطني. السبب: {claim.invoiceModeReason ?? "—"}
          </p>
        ) : claim.einvStatus === "SUBMITTED" ? (
          <p className="text-sm text-ink-soft">
            فاتورة رقم <b className="num">SADA-{claim.invoiceNo}</b> معتمدة بتاريخ {fmtDate(claim.einvSubmittedAt)} — <span className="num text-xs" dir="ltr">{claim.einvUuid}</span>
            <span className="mt-1 block text-xs text-ink-muted">رمز QR والفاتورة المعتمدة أسفل المطالبة — «طباعة» تطبعهما معاً كمعاملة واحدة.</span>
          </p>
        ) : (
          <>
            <p className="rounded-xl bg-canvas p-3 text-sm text-ink-soft">
              {claim.einvError ?? einvReady ?? "لم تُرسل بعد — تُرسل تلقائياً عند موافقة الإدارة."}
            </p>
            {(fin || canApprove) && claim.einvStatus !== "REJECTED" && ["SUBMITTED", "APPROVED", "PAID"].includes(claim.status) && (
              <div className="mt-3">
                <ConfirmButton action={sendClaimInvoice.bind(null, claim.id)} confirm="إرسال الفاتورة لنظام الفوترة الوطني واعتمادها؟ (إجراء رسمي لدى دائرة الضريبة)" className="btn-primary btn-sm" allowReadOnly>
                  <FileCheck2 className="h-4 w-4" /> إرسال واعتماد من الضريبة
                </ConfirmButton>
              </div>
            )}
          </>
        )}
      </section>

      {/* دورة القبض */}
      <section className="card card-pad">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-base font-bold"><Banknote className="h-5 w-5 text-good" aria-hidden /> قبض المطالبة</h2>
          {stage && <StatusBadge map={PAY_STAGE} value={stage} />}
        </div>
        <ol className="mb-3 grid grid-cols-3 gap-2" aria-label="مراحل القبض">
          {steps.map((s, i) => (
            <li key={s.t} className="text-center text-[11px] font-semibold">
              <span className={`mb-1 block h-1.5 rounded-full ${s.on ? "bg-good" : "bg-black/10"}`} />
              <span className={s.on ? "text-good" : "text-ink-muted"}>{i + 1}. {s.t}</span>
            </li>
          ))}
        </ol>

        {claim.receiptAt && (
          <p className="mb-3 rounded-xl bg-canvas p-3 text-sm">
            {claim.receiptMethod === "TRANSFER" ? "حوالة" : "شيك"}{claim.receiptRef ? ` رقم ${claim.receiptRef}` : ""} — <b className="num">{nf.format(claim.receiptAmount ?? 0)} د.أ</b> بتاريخ {fmtDate(claim.receiptDate)}
            <span className="block text-xs text-ink-muted">الصورة ضمن مرفقات المطالبة</span>
          </p>
        )}
        {claim.receiptNote && !claim.payStage && claim.status !== "PAID" && (
          <p className="mb-3 rounded-xl bg-bad-soft p-3 text-sm font-semibold text-bad">رُفض القبض السابق: {claim.receiptNote}</p>
        )}

        {claim.status === "PAID" ? (
          <p className="flex items-center gap-2 text-sm font-semibold text-good"><Landmark className="h-4 w-4" /> أُودع {nf.format(claim.paidAmount ?? 0)} د.أ في حساب الشركة {claim.archivedAt ? "ونُقلت المطالبة للأرشيف" : ""}</p>
        ) : !claim.payStage ? (
          canReceipt ? (
            <ModalForm title={`تم صرف الشيك — المطالبة رقم ${claim.number}`} trigger={<><BadgeCheck className="h-4 w-4" /> تم صرف الشيك / قبض المبلغ</>} triggerClass="btn-primary btn-sm" action={submitReceipt.bind(null, claim.id)}>
              <Grid>
                <Select name="receiptMethod" label="طريقة القبض" options={{ CHEQUE: "شيك", TRANSFER: "حوالة بنكية" }} defaultValue="CHEQUE" />
                <Input name="receiptRef" label="رقم الشيك / الحوالة" dir="ltr" />
              </Grid>
              <Grid>
                <Input name="receiptDate" label="تاريخ القبض" type="date" required defaultValue={toInputDate(todayUTC())} />
                <Input name="receiptAmount" label="المبلغ المقبوض (د.أ)" inputMode="decimal" defaultValue={net} />
              </Grid>
              <FileInput label="صورة الشيك أو إشعار الحوالة (إلزامية)" />
              <DepositSlipInput required={slipRequired} hint={slipRequired ? "عند القبض بشيك: صورة وصل إيداع الشيك في حساب الشركة إلزامية (الحوالة لا تحتاج وصلاً)" : undefined} />
              <p className="text-xs text-ink-muted">يُبلَّغ المحاسب فوراً لتدقيق المبلغ والصورة، ثم ترفع للإدارة للموافقة، وبعدها يُودع المبلغ في حساب الشركة وتُؤرشف المطالبة.</p>
            </ModalForm>
          ) : (
            <p className="text-sm text-ink-muted">بانتظار قبض الشيك من صاحب العمل.</p>
          )
        ) : claim.payStage === "RECEIVED" ? (
          fin ? (
            <div className="flex flex-wrap gap-2">
              <ConfirmButton action={auditReceipt.bind(null, claim.id)} confirm="تأكيد مطابقة المبلغ وصورة الشيك ورفع القبض للإدارة؟" className="btn-primary btn-sm">قبول وتدقيق القبض</ConfirmButton>
              <ModalForm title="رفض القبض" trigger="رفض / تصحيح" triggerClass="btn-danger btn-sm" action={rejectReceipt.bind(null, claim.id)}>
                <Textarea name="reason" label="السبب" required placeholder="المبلغ لا يطابق الشيك / الصورة غير واضحة" />
              </ModalForm>
            </div>
          ) : (
            <p className="text-sm text-ink-muted">بانتظار تدقيق المحاسب.</p>
          )
        ) : claim.payStage === "AUDITED" ? (
          canApprove ? (
            <div className="flex flex-wrap gap-2">
              <ConfirmButton action={approveReceipt.bind(null, claim.id)} confirm={`الموافقة النهائية وإيداع ${nf.format(claim.receiptAmount ?? net)} د.أ في حساب الشركة ونقل المطالبة للأرشيف؟`} className="btn-primary btn-sm" allowReadOnly>
                <Landmark className="h-4 w-4" /> موافقة وإيداع وأرشفة
              </ConfirmButton>
              <ModalForm title="رفض القبض" trigger="رفض" triggerClass="btn-danger btn-sm" action={rejectReceipt.bind(null, claim.id)} allowReadOnly>
                <Textarea name="reason" label="السبب" required />
              </ModalForm>
            </div>
          ) : (
            <p className="text-sm text-ink-muted">بانتظار موافقة الإدارة.</p>
          )
        ) : null}
        {claim.status !== "PAID" && <Badge tone="gray" className="mt-3">صافي المطالبة {nf.format(net)} د.أ</Badge>}
      </section>
    </div>
  );
}

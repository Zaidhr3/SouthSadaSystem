import Link from "next/link";
import { InvoiceAutoFill } from "./invoice-autofill";
import { Trash2 } from "lucide-react";
import type { Claim, ClaimLine, Expense, Guarantee } from "@prisma/client";
import { AttachmentList, Badge, EmptyState, ExpiryBadge, Money, StatusBadge } from "./ui";
import { ConfirmButton, FileInput, Grid, Input, ModalForm, Select } from "./forms";
import { CLAIM_STATUS, CLAIM_TYPE, EXPENSE_CATEGORY, GUARANTEE_FORM, GUARANTEE_STATUS, GUARANTEE_TYPE, MANUAL_PAYMENT_METHOD, PAYMENT_METHOD } from "@/lib/labels";
import { claimNet } from "@/lib/deductions";
import { daysBetween, fmtDate, fmtNum, round3, toInputDate, todayUTC } from "@/lib/format";
import { approveDraftClaim, returnDraftClaim } from "@/app/(app)/actions/field";
import { confirmAuditAndSendReadiness } from "@/app/(app)/actions/invoicing";
import { can, type AppUser } from "@/lib/permissions";
import { deleteGuarantee, setGuaranteeStatus } from "@/app/(app)/actions/guarantees";
import { deleteClaim, markClaimPaid, setClaimStatus } from "@/app/(app)/actions/claims";
import { deleteExpense } from "@/app/(app)/actions/finance";
import { addAttachments, deleteAttachment } from "@/app/(app)/actions/admin";
import type { EntityType } from "@/lib/uploads";

type Att = Map<number, { id: number; fileName: string; size: number }[]>;
type TenderRef = { tender?: { id: number; name: string; number: string } | null };

export function UploadButton({ entityType, entityId }: { entityType: EntityType; entityId: number }) {
  return (
    <ModalForm title="رفع معززات / مرفقات" trigger="+ مرفق" triggerClass="btn-ghost btn-sm" action={addAttachments.bind(null, entityType, entityId)} submitLabel="رفع">
      <Input name="attachmentLabel" label="وصف المرفق (اختياري)" placeholder="فاتورة المورد، شهادة فحص..." />
      <FileInput />
    </ModalForm>
  );
}

export function GuaranteeTable({ rows, user, atts, showTender }: { rows: (Guarantee & TenderRef)[]; user: AppUser; atts: Att; showTender?: boolean }) {
  const fin = can.manageGuarantees(user.role);
  if (rows.length === 0) return <EmptyState title="لا توجد كفالات" />;
  return (
    <div className="overflow-x-auto">
      <table className="tbl">
        <thead>
          <tr>
            <th>الكفالة</th>
            {showTender && <th>العطاء</th>}
            <th>البنك</th>
            <th className="text-end">القيمة</th>
            <th>الصلاحية</th>
            <th>الحالة</th>
            {fin && <th>إجراءات</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((g) => (
            <tr key={g.id}>
              <td>
                <span className="block font-bold">{GUARANTEE_TYPE[g.type]}</span>
                <span className="text-xs text-ink-muted">
                  {GUARANTEE_FORM[g.form]?.label} {g.referenceNo ? `— ${g.referenceNo}` : ""} — عمولة {g.bankFee} د.أ
                </span>
                {g.depositBox && <span className="block text-xs text-ink-muted">الإيداع: {g.depositBox}</span>}
                <AttachmentList items={atts.get(g.id)} />
              </td>
              {showTender && (
                <td className="max-w-[220px]">
                  {g.tender && (
                    <Link href={`/tenders/${g.tender.id}?tab=guarantees`} className="font-semibold hover:text-accent">
                      {g.tender.name}
                    </Link>
                  )}
                </td>
              )}
              <td className="text-ink-soft">{g.bank}</td>
              <td className="text-end">
                <Money value={g.amount} strong />
              </td>
              <td>
                {["ISSUED", "SUBMITTED"].includes(g.status) ? <ExpiryBadge date={g.expiryDate} /> : <span className="text-xs text-ink-muted">{g.expiryDate ? fmtDate(g.expiryDate) : "—"}</span>}
                <span className="block text-xs text-ink-muted">صدرت {fmtDate(g.issueDate)}</span>
              </td>
              <td>
                <StatusBadge map={GUARANTEE_STATUS} value={g.status} />
                {g.retrievedDate && <span className="block text-xs text-ink-muted">استُردت {fmtDate(g.retrievedDate)}</span>}
                {g.returnedDate && <span className="block text-xs text-ink-muted">أُعيدت {fmtDate(g.returnedDate)}</span>}
              </td>
              {fin && (
                <td className="whitespace-nowrap">
                  {g.status === "ISSUED" && (
                    <ConfirmButton action={setGuaranteeStatus.bind(null, g.id, "SUBMITTED")} className="btn-ghost btn-sm">
                      تسليم للجهة
                    </ConfirmButton>
                  )}
                  {g.status === "SUBMITTED" && (
                    <ConfirmButton action={setGuaranteeStatus.bind(null, g.id, "RETRIEVED")} confirm="تأكيد استرداد الكفالة من الجهة؟" className="btn-ghost btn-sm">
                      استرداد من الجهة
                    </ConfirmButton>
                  )}
                  {g.status === "RETRIEVED" && (
                    <ConfirmButton action={setGuaranteeStatus.bind(null, g.id, "RETURNED")} confirm="تأكيد إعادة الكفالة للبنك وإلغائها؟" className="btn-ghost btn-sm">
                      إعادة للبنك
                    </ConfirmButton>
                  )}
                  <UploadButton entityType="guarantee" entityId={g.id} />
                  <ConfirmButton action={deleteGuarantee.bind(null, g.id)} confirm="حذف الكفالة نهائياً؟" className="btn-danger btn-sm" title="حذف">
                    <Trash2 className="h-4 w-4" />
                  </ConfirmButton>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ClaimTable({ rows, user, atts, showTender }: { rows: (Claim & TenderRef & { lines?: ClaimLine[] })[]; user: AppUser; atts: Att; showTender?: boolean }) {
  const fin = can.manageFinance(user.role);
  const admin = can.manageTenders(user.role);
  const canApprove = can.approveClaims(user.role);
  if (rows.length === 0) return <EmptyState title="لا توجد مطالبات" hint="تُسجل المطالبات المرحلية والنهائية مع معززاتها من صفحة المشروع" />;
  return (
    <div className="overflow-x-auto">
      <table className="tbl">
        <thead>
          <tr>
            <th>المطالبة</th>
            {showTender && <th>المشروع</th>}
            <th className="text-end">القيمة</th>
            <th className="text-end">المستقطعات</th>
            <th className="text-end">الصافي / المقبوض</th>
            <th>الحالة</th>
            <th>إجراءات</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => {
            const net = claimNet(c);
            const parts = [
              { label: "محجوزات", v: c.retention },
              { label: "طوابع", v: c.stampDuty },
              { label: c.deductionNotes || "خصومات", v: c.deductions },
            ].filter((p) => p.v > 0);
            const totalDed = round3(parts.reduce((s, p) => s + p.v, 0));
            const turnaround = c.paidDate ? daysBetween(c.submittedDate, c.paidDate) : null;
            return (
              <tr key={c.id}>
                <td>
                  <span className="block font-bold">
                    {CLAIM_TYPE[c.type]} رقم {c.number}
                  </span>
                  <span className="text-xs text-ink-muted">{c.status === "DRAFT" || c.status === "READY" || c.status === "REVIEW" ? "بتاريخ" : "قُدمت للجهة"} {fmtDate(c.submittedDate)}{c.lockedAt ? " — 🔒 مقفلة" : ""}</span>
                  {c.lines && c.lines.length > 0 && (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-xs font-semibold text-accent">بنود الحصر الفعلي ({c.lines.length})</summary>
                      <table className="mt-2 w-full min-w-[520px] text-[11px]">
                        <thead>
                          <tr className="text-ink-muted">
                            <th className="py-1 text-start font-semibold">البند</th>
                            <th className="py-1 text-end font-semibold">الجدول</th>
                            <th className="py-1 text-end font-semibold">سابق</th>
                            <th className="py-1 text-end font-semibold">تراكمي</th>
                            <th className="py-1 text-end font-semibold">الفترة</th>
                            <th className="py-1 text-end font-semibold">القيمة</th>
                          </tr>
                        </thead>
                        <tbody>
                          {c.lines.map((l) => (
                            <tr key={l.id} className="border-t border-line/60">
                              <td className="max-w-[200px] py-1 pe-2">{l.description} <span className="text-ink-faint">({l.unit} × {fmtNum(l.unitPrice)})</span></td>
                              <td className="num py-1 text-end">{fmtNum(l.boqQty)}</td>
                              <td className="num py-1 text-end">{fmtNum(l.previousQty)}</td>
                              <td className={`num py-1 text-end ${l.cumulativeQty > l.boqQty ? "font-bold text-warn" : ""}`}>{fmtNum(l.cumulativeQty)}</td>
                              <td className="num py-1 text-end">{fmtNum(l.periodQty)}</td>
                              <td className="num py-1 text-end font-semibold">{fmtNum(l.amount)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </details>
                  )}
                  <AttachmentList items={atts.get(c.id)} />
                </td>
                {showTender && (
                  <td className="max-w-[220px]">
                    {c.tender && (
                      <Link href={`/tenders/${c.tender.id}?tab=claims`} className="font-semibold hover:text-accent">
                        {c.tender.name}
                      </Link>
                    )}
                  </td>
                )}
                <td className="text-end">
                  <Money value={c.grossAmount} />
                </td>
                <td className="text-end">
                  {totalDed > 0 ? (
                    <>
                      <Money value={totalDed} className="text-bad" />
                      {parts.map((p) => (
                        <span key={p.label} className="block text-[11px] text-ink-muted">
                          {p.label}: <span className="num">{new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(p.v)}</span>
                        </span>
                      ))}
                    </>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="text-end">
                  <Money value={c.paidAmount ?? net} strong />
                </td>
                <td>
                  <StatusBadge map={CLAIM_STATUS} value={c.status} />
                  {c.paidDate && (
                    <span className="block text-xs text-ink-muted">
                      قُبضت {fmtDate(c.paidDate)} — خلال {turnaround} يوماً
                    </span>
                  )}
                </td>
                <td className="whitespace-nowrap">
                  <Link href={`/claims/${c.id}`} className="btn-ghost btn-sm">عرض / طباعة</Link>
                  {c.status === "RETURNED" && (fin || user.role === "PM") && (
                    <Link href={`/claims/new?tender=${c.tenderId}&claim=${c.id}`} className="btn-primary btn-sm">تعديل وإعادة الإرسال</Link>
                  )}
                  {c.status === "DRAFT" && fin && (
                    <>
                      <Link href={`/claims/new?tender=${c.tenderId}&claim=${c.id}`} className="btn-ghost btn-sm">تعديل</Link>
                      <ConfirmButton action={confirmAuditAndSendReadiness.bind(null, c.id)} confirm="قبول وتدقيق المطالبة والفاتورة ورفعهما معاً للإدارة؟ يُرسل بريد رسمي للمدير العام ومدير المشروع." className="btn-primary btn-sm">
                        قبول وتدقيق
                      </ConfirmButton>
                    </>
                  )}
                  {(c.status === "READY" || c.status === "REVIEW") && canApprove && (
                    <ConfirmButton action={approveDraftClaim.bind(null, c.id)} confirm={`الموافقة النهائية على المطالبة رقم ${c.number} بصافي ${fmtNum(net)} د.أ؟ تُرسل الفاتورة لنظام الفوترة تلقائياً.`} className="btn-primary btn-sm" allowReadOnly>
                      موافقة نهائية
                    </ConfirmButton>
                  )}
                  {(c.status === "READY" || c.status === "REVIEW") && canApprove && (
                    <Link href={`/claims/${c.id}`} className="btn-ghost btn-sm text-bad">رفض مع السبب</Link>
                  )}
                  {(c.status === "READY" || c.status === "REVIEW") && fin && !canApprove && (
                    <ConfirmButton action={returnDraftClaim.bind(null, c.id)} confirm="سحب المطالبة من الإدارة لتعديلها؟" className="btn-ghost btn-sm">
                      سحب للتعديل
                    </ConfirmButton>
                  )}
                  {(c.status === "READY" || c.status === "REVIEW") && !canApprove && <span className="me-2 text-xs text-ink-muted">بانتظار موافقة الإدارة</span>}
                  {(c.status === "SUBMITTED" || c.status === "APPROVED") && (
                    <Link href={`/claims/${c.id}`} className="btn-ghost btn-sm">{c.payStage === "RECEIVED" ? "تدقيق القبض" : c.payStage === "AUDITED" ? "موافقة القبض" : "تم صرف الشيك"}</Link>
                  )}
                  {fin && c.status === "SUBMITTED" && (
                    <ConfirmButton action={setClaimStatus.bind(null, c.id, "APPROVED")} className="btn-ghost btn-sm">
                      اعتماد صاحب العمل
                    </ConfirmButton>
                  )}
                  {fin && c.status === "PAID" && (
                    <ConfirmButton action={setClaimStatus.bind(null, c.id, "APPROVED")} confirm="إلغاء تسجيل القبض وحذف الإيداع البنكي المرتبط؟" className="btn-ghost btn-sm">
                      إلغاء الصرف
                    </ConfirmButton>
                  )}
                  <UploadButton entityType="claim" entityId={c.id} />
                  {((fin && c.status === "DRAFT") || admin) && (
                    <ConfirmButton action={deleteClaim.bind(null, c.id)} confirm={c.status === "DRAFT" ? "حذف المسودة؟" : "حذف مطالبة مقفلة نهائياً؟"} className="btn-danger btn-sm" title="حذف">
                      <Trash2 className="h-4 w-4" />
                    </ConfirmButton>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function ExpenseTable({
  rows,
  user,
  atts,
  showTender,
}: {
  rows: (Expense & TenderRef & { createdBy?: { name: string } | null })[];
  user: AppUser;
  atts: Att;
  showTender?: boolean;
}) {
  if (rows.length === 0) return <EmptyState title="لا توجد مصاريف" />;
  return (
    <div className="overflow-x-auto">
      <table className="tbl">
        <thead>
          <tr>
            <th>التاريخ</th>
            <th>البيان</th>
            {showTender && <th>المشروع</th>}
            <th>التصنيف</th>
            <th>الدفع</th>
            <th className="text-end">المبلغ</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => (
            <tr key={e.id}>
              <td className="num whitespace-nowrap text-ink-soft">{fmtDate(e.date)}</td>
              <td className="max-w-[300px]">
                <span className="block font-semibold">{e.description}</span>
                <span className="text-xs text-ink-muted">
                  {[e.vendor, e.createdBy?.name && `أدخله ${e.createdBy.name}`].filter(Boolean).join(" — ")}
                  {e.autoSource && " — تلقائي"}
                </span>
                {e.invoiceFlag === "OLD_NO_ATTACHMENT" && (
                  <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-bad px-2 py-0.5 text-[11px] font-bold text-white">⚠ فاتورة بتاريخ قديم بدون مرفق — للتحقيق</span>
                )}
                <AttachmentList items={atts.get(e.id)} />
              </td>
              {showTender && (
                <td className="max-w-[200px] text-ink-soft">
                  {e.tender ? (
                    <Link href={`/tenders/${e.tender.id}?tab=expenses`} className="hover:text-accent">
                      {e.tender.name}
                    </Link>
                  ) : (
                    "عام"
                  )}
                </td>
              )}
              <td>
                <Badge>{EXPENSE_CATEGORY[e.category] ?? e.category}</Badge>
              </td>
              <td className="text-xs text-ink-soft">{PAYMENT_METHOD[e.paymentMethod]}</td>
              <td className="text-end">
                <Money value={e.amount} strong />
              </td>
              <td className="whitespace-nowrap text-end">
                <UploadButton entityType="expense" entityId={e.id} />
                {!e.autoSource?.match(/^(subcert|equip):/) && (can.manageFinance(user.role) || e.createdById === user.id) && (
                  <ConfirmButton action={deleteExpense.bind(null, e.id)} confirm="حذف المصروف؟" className="btn-danger btn-sm" title="حذف">
                    <Trash2 className="h-4 w-4" />
                  </ConfirmButton>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AttachmentGrid({ items, canDelete }: { items: { id: number; fileName: string; size: number; mimeType: string; label: string | null; createdAt: Date; uploadedBy: { name: string } }[]; canDelete: boolean }) {
  if (items.length === 0) return <EmptyState title="لا توجد مرفقات" />;
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((a) => (
        <li key={a.id} className="flex items-center gap-3 rounded-2xl border border-line p-3">
          <a href={`/api/files/${a.id}`} target="_blank" rel="noreferrer" className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-xl bg-canvas text-[11px] font-bold uppercase text-ink-muted">
            {a.mimeType.startsWith("image/") ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/api/files/${a.id}`} alt="" className="h-full w-full object-cover" />
            ) : (
              a.fileName.split(".").pop()
            )}
          </a>
          <div className="min-w-0 flex-1">
            <a href={`/api/files/${a.id}`} target="_blank" rel="noreferrer" className="block truncate text-sm font-semibold hover:text-accent">
              {a.label || a.fileName}
            </a>
            <p className="text-xs text-ink-muted">
              {(a.size / 1024).toFixed(0)} KB — {a.uploadedBy.name} — {fmtDate(a.createdAt)}
            </p>
          </div>
          {canDelete && (
            <ConfirmButton action={deleteAttachment.bind(null, a.id)} confirm="حذف المرفق؟" className="btn-danger btn-sm" title="حذف">
              <Trash2 className="h-4 w-4" />
            </ConfirmButton>
          )}
        </li>
      ))}
    </ul>
  );
}

export function ExpenseFormFields({ tenders, user, fixedTenderId, cheques, aiReady = !!process.env.GEMINI_API_KEY }: { tenders: { id: number; name: string; number: string }[]; user: AppUser; fixedTenderId?: number; cheques?: { id: number; number: string; payee: string }[]; aiReady?: boolean }) {
  return (
    <>
      {fixedTenderId ? (
        <input type="hidden" name="tenderId" value={fixedTenderId} />
      ) : (
        <SelectTender tenders={tenders} required={user.role === "PM"} />
      )}
      <Grid>
        <Input name="amount" label="المبلغ (د.أ)" type="number" required autoFocus />
        <Input name="date" label="التاريخ" type="date" required defaultValue={toInputDate(todayUTC())} />
      </Grid>
      <SelectCategory />
      <Input name="description" label="البيان" required placeholder="مثال: أجور عمال صب سقف الطابق الأول" />
      <Input name="vendor" label="المورد / المستفيد" />
      {user.role !== "PM" && <SelectPayment cheques={cheques ?? []} />}
      <FileInput label="صورة الفاتورة / الإيصال (إلزامية — الفاتورة الأقدم من 7 أيام بلا صورة تُعلَّم «للتحقيق»)" />
      {aiReady && <InvoiceAutoFill />}
    </>
  );
}

function SelectTender({ tenders, required }: { tenders: { id: number; name: string; number: string }[]; required: boolean }) {
  return <Select name="tenderId" label="المشروع / العطاء" options={tenders.map((t) => ({ value: t.id, label: `${t.name} (${t.number})` }))} placeholder={required ? "— اختر المشروع —" : "— مصروف عام —"} required={required} />;
}
function SelectCategory() {
  return <Select name="category" label="التصنيف" options={EXPENSE_CATEGORY} defaultValue="MATERIALS" />;
}
function SelectPayment({ cheques }: { cheques: { id: number; number: string; payee: string }[] }) {
  return (
    <Grid>
      <Select name="paymentMethod" label="طريقة الدفع" options={MANUAL_PAYMENT_METHOD} defaultValue="COMPANY" hint="حساب الشركة = يُخصم من البنك فوراً" />
      <Select name="chequeId" label="الشيك (إن وجد)" options={cheques.map((c) => ({ value: c.id, label: `${c.number} — ${c.payee}` }))} placeholder="—" />
    </Grid>
  );
}

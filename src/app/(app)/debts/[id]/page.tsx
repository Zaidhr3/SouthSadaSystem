import { notFound } from "next/navigation";
import Link from "next/link";
import { CalendarClock, CheckCircle2, Landmark, Pencil, Scale, Trash2, Wallet } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { can, see } from "@/lib/permissions";
import { LOAN_FREQUENCY, LOAN_INTEREST_TYPE, LOAN_LENDER_TYPE, LOAN_PAY_METHOD, LOAN_RECEIVED_VIA, LOAN_STATUS } from "@/lib/labels";
import { attachmentsMap } from "@/lib/uploads";
import { fmtDate, relativeDays, round3, toInputDate, todayUTC } from "@/lib/format";
import { AttachmentList, Badge, Card, KeyValue, Money, PageHeader, ProgressBar, StatCard, StatusBadge } from "@/components/ui";
import { ConfirmButton, FileInput, Grid, Input, ModalForm, Select, Textarea } from "@/components/forms";
import { UploadButton } from "@/components/tables";
import { addLoanPayment, deleteLoan, deleteLoanPayment, rescheduleLoan, updateLoanInfo } from "../../actions/debts";
import { LoanInfoFields } from "../loan-info";

export const metadata = { title: "ملف الدين" };

export default async function DebtPage({ params }: { params: { id: string } }) {
  const user = await requireUser(see.finance);
  const id = Number(params.id);
  if (!Number.isInteger(id)) notFound();
  const [loan, tenders] = await Promise.all([
    db.loan.findUnique({
      where: { id },
      include: { tender: { select: { id: true, name: true } }, installments: { orderBy: { seq: "asc" } }, payments: { orderBy: [{ date: "desc" }, { id: "desc" }] } },
    }),
    db.tender.findMany({ where: { status: { notIn: ["LOST", "CANCELLED"] } }, select: { id: true, name: true, number: true }, orderBy: { id: "desc" } }),
  ]);
  if (!loan) notFound();
  const [docs, payAtts, users] = await Promise.all([
    attachmentsMap("loan", [id]),
    attachmentsMap("loan_payment", loan.payments.map((p) => p.id)),
    db.user.findMany({ where: { id: { in: [loan.createdById, ...loan.payments.map((p) => p.createdById)] } }, select: { id: true, name: true } }),
  ]);
  const who = new Map(users.map((u) => [u.id, u.name]));
  const today = todayUTC();
  const paid = round3(loan.payments.reduce((s, p) => s + p.amount, 0));
  const left = round3(Math.max(0, loan.totalDue - paid));
  const open = loan.installments.filter((i) => i.paidAmount < i.amount - 0.0005);
  const next = open[0];
  const overdue = round3(open.filter((i) => i.dueDate < today).reduce((s, i) => s + i.amount - i.paidAmount, 0));
  const manage = can.manageDebts(user.role);
  const admin = can.deleteDebts(user.role);
  const active = loan.status === "ACTIVE";

  return (
    <>
      <PageHeader
        back={{ href: "/debts", label: "الديون والقروض" }}
        title={`دين ${loan.lender}`}
        subtitle={<span className="flex flex-wrap items-center gap-2"><StatusBadge map={LOAN_STATUS} value={loan.status} /> {loan.purpose}</span>}
        actions={
          <>
            {manage && active && (
              <ModalForm title={`سداد — ${loan.lender}`} trigger={<><Wallet className="h-4 w-4" /> تسجيل سداد</>} action={addLoanPayment.bind(null, id)}>
                <Grid>
                  <Input name="amount" label="المبلغ المسدد (د.أ)" type="number" required defaultValue={next ? round3(next.amount - next.paidAmount) : left} hint={`المتبقي الكلي ${new Intl.NumberFormat("en-US", { minimumFractionDigits: 3 }).format(left)}`} />
                  <Input name="date" label="تاريخ السداد" type="date" required defaultValue={toInputDate(today)} />
                </Grid>
                <Grid>
                  <Select name="method" label="طريقة السداد" options={LOAN_PAY_METHOD} defaultValue="BANK" />
                  <Input name="reference" label="رقم الشيك / الحوالة / الإيصال" dir="ltr" />
                </Grid>
                <Textarea name="notes" label="ملاحظات" />
                <FileInput label="إيصال السداد / إشعار البنك" />
                <p className="text-xs text-ink-muted">يُوزَّع المبلغ على الأقساط الأقدم استحقاقاً أولاً (يقبل الجزئي والسداد المبكر). التحويل والشيك يُخصمان من الحساب البنكي تلقائياً.</p>
              </ModalForm>
            )}
            {manage && active && (
              <ModalForm title="إعادة جدولة الدين" trigger={<><CalendarClock className="h-4 w-4" /> إعادة جدولة</>} triggerClass="btn-secondary" action={rescheduleLoan.bind(null, id)}>
                <p className="rounded-xl bg-gold-soft px-3 py-2 text-sm">الأقساط المسددة تبقى كما هي، والمتبقي (<b className="num">{left.toFixed(3)}</b> د.أ) يُوزع على جدول جديد.</p>
                <Input name="newTotal" label="إجمالي المستحق بعد التعديل (اختياري)" type="number" defaultValue="" hint={`الحالي ${loan.totalDue.toFixed(3)} — ارفعه لفوائد تأخير أو اخفضه لخصم/إعفاء عند التسوية`} />
                <Grid cols={3}>
                  <Select name="frequency" label="الدورية" options={LOAN_FREQUENCY} defaultValue={loan.frequency} />
                  <Input name="installmentCount" label="عدد الأقساط الجديدة" type="number" step="1" min={1} defaultValue={Math.max(1, open.length)} />
                  <Input name="firstDueDate" label="أول قسط جديد" type="date" required defaultValue={toInputDate(next?.dueDate ?? today)} />
                </Grid>
                <Textarea name="reason" label="سبب إعادة الجدولة" required placeholder="اتفاق مع الدائن على تأجيل / تسوية بخصم" />
              </ModalForm>
            )}
            {manage && (
              <ModalForm title="تعديل بيانات الدين" trigger={<><Pencil className="h-4 w-4" /> تعديل</>} triggerClass="btn-secondary" action={updateLoanInfo.bind(null, id)} wide>
                <LoanInfoFields loan={loan} tenders={tenders} />
                <FileInput label="مستندات إضافية" />
              </ModalForm>
            )}
            {admin && (
              <ConfirmButton action={deleteLoan.bind(null, id)} confirm="حذف الدين نهائياً مع كل دفعاته وحركاته البنكية؟" className="btn-danger" title="حذف الدين" redirectTo="/debts">
                <Trash2 className="h-4 w-4" />
              </ConfirmButton>
            )}
          </>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard label="المستحق الكلي" value={<Money value={loan.totalDue} />} sub={`أصل ${loan.principal.toFixed(3)}${loan.interestAmount ? ` + فائدة ${loan.interestAmount.toFixed(3)}` : ""}${loan.fees ? ` + رسوم ${loan.fees.toFixed(3)}` : ""}`} icon={Scale} tone="blue" />
        <StatCard label="المسدد" value={<Money value={paid} />} sub={<ProgressBar value={loan.totalDue ? (paid / loan.totalDue) * 100 : 0} />} icon={CheckCircle2} tone="green" />
        <StatCard label="المتبقي" value={<Money value={left} />} sub={`${open.length} أقساط مفتوحة`} icon={Landmark} tone={left ? "orange" : "green"} />
        <StatCard label={overdue ? "متأخر السداد" : "القسط القادم"} value={<Money value={overdue || (next ? round3(next.amount - next.paidAmount) : 0)} />} sub={next ? `${fmtDate(next.dueDate)} — ${relativeDays(next.dueDate)}` : "لا أقساط مفتوحة"} icon={CalendarClock} tone={overdue ? "red" : "gray"} />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card title="جدول الأقساط" pad={false}>
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>الاستحقاق</th>
                    <th className="text-end">القسط</th>
                    <th className="text-end">المسدد</th>
                    <th>الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  {loan.installments.map((i) => {
                    const done = i.paidAmount >= i.amount - 0.0005;
                    const late = !done && i.dueDate < today;
                    return (
                      <tr key={i.id} className={late ? "bg-bad-soft/50" : undefined}>
                        <td className="num">{i.seq}</td>
                        <td className="num whitespace-nowrap">{fmtDate(i.dueDate)}</td>
                        <td className="text-end"><Money value={i.amount} /></td>
                        <td className="text-end">{i.paidAmount ? <Money value={i.paidAmount} className="text-good" /> : "—"}</td>
                        <td>
                          {done ? (
                            <Badge tone="green">مسدد {i.paidDate ? fmtDate(i.paidDate) : ""}</Badge>
                          ) : late ? (
                            <Badge tone="red">متأخر {relativeDays(i.dueDate).replace("منذ ", "")}</Badge>
                          ) : i.paidAmount > 0 ? (
                            <Badge tone="orange">جزئي</Badge>
                          ) : (
                            <Badge tone="gray">{relativeDays(i.dueDate)}</Badge>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="دفعات السداد" pad={false}>
            {loan.payments.length === 0 ? (
              <p className="p-5 text-sm text-ink-muted">لم تُسجل أي دفعة بعد.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>التاريخ</th>
                      <th className="text-end">المبلغ</th>
                      <th>الطريقة</th>
                      <th>المرفقات</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {loan.payments.map((p) => (
                      <tr key={p.id}>
                        <td className="num whitespace-nowrap">{fmtDate(p.date)}</td>
                        <td className="text-end"><Money value={p.amount} strong /></td>
                        <td>
                          {LOAN_PAY_METHOD[p.method]}
                          {p.reference && <span className="num block text-xs text-ink-muted">{p.reference}</span>}
                          {p.notes && <span className="block text-xs text-ink-muted">{p.notes}</span>}
                          <span className="block text-xs text-ink-faint">سجّلها {who.get(p.createdById) ?? "—"}</span>
                        </td>
                        <td><AttachmentList items={payAtts.get(p.id)} /></td>
                        <td className="whitespace-nowrap">
                          {manage && <UploadButton entityType="loan_payment" entityId={p.id} />}
                          {admin && (
                            <ConfirmButton action={deleteLoanPayment.bind(null, p.id)} confirm="حذف الدفعة؟ تُلغى حركتها البنكية ويُعاد احتساب الأقساط." className="btn-danger btn-sm" title="حذف">
                              <Trash2 className="h-4 w-4" />
                            </ConfirmButton>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <Card title="بيانات الدين">
            <KeyValue
              cols={2}
              items={[
                { label: "الجهة", value: `${loan.lender} — ${LOAN_LENDER_TYPE[loan.lenderType]}` },
                { label: "الاتصال", value: loan.lenderContact || "—" },
                { label: "رقم العقد", value: loan.reference || "—" },
                { label: "الاستلام", value: `${fmtDate(loan.receivedDate)} — ${LOAN_RECEIVED_VIA[loan.receivedVia]}` },
                { label: "الفائدة", value: loan.interestType === "PERCENT" ? `${loan.interestRate}% سنوياً` : LOAN_INTEREST_TYPE[loan.interestType] },
                { label: "السداد", value: `${LOAN_FREQUENCY[loan.frequency]} — ${loan.installmentCount} ${loan.installmentCount > 1 ? "أقساط" : "دفعة"}` },
                { label: "الضمانات", value: loan.collateral || "—" },
                { label: "المشروع", value: loan.tender ? <Link href={`/tenders/${loan.tender.id}`} className="text-accent hover:underline">{loan.tender.name}</Link> : "عام للشركة" },
                { label: "سجّله", value: `${who.get(loan.createdById) ?? "—"} — ${fmtDate(loan.createdAt)}` },
                ...(loan.settledAt ? [{ label: "أُغلق", value: fmtDate(loan.settledAt) }] : []),
              ]}
            />
            {loan.notes && <p className="mt-3 whitespace-pre-line rounded-xl bg-canvas p-3 text-sm">{loan.notes}</p>}
          </Card>
          <Card title="العقد والمستندات" action={manage ? <UploadButton entityType="loan" entityId={id} /> : undefined}>
            {docs.get(id)?.length ? <AttachmentList items={docs.get(id)} /> : <p className="text-sm text-ink-muted">لا توجد مستندات مرفقة.</p>}
          </Card>
        </div>
      </div>
    </>
  );
}

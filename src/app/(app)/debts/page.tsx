import Link from "next/link";
import clsx from "clsx";
import { AlarmClock, CalendarClock, CheckCircle2, HandCoins, Plus, Scale } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { can, depositSlipRequired, see } from "@/lib/permissions";
import { LOAN_LENDER_TYPE, LOAN_STATUS } from "@/lib/labels";
import { loanSummary } from "@/lib/loans";
import { fmtDate, relativeDays, round3, todayUTC } from "@/lib/format";
import { Badge, Card, EmptyState, Money, PageHeader, ProgressBar, StatCard, StatusBadge } from "@/components/ui";
import { FileInput, ModalForm } from "@/components/forms";
import { DepositSlipInput } from "@/components/deposit-slip";
import { createLoan } from "../actions/debts";
import { LoanInfoFields } from "./loan-info";
import { LoanTermsFields } from "./loan-terms";

export const metadata = { title: "الديون والقروض" };

export default async function DebtsPage({ searchParams }: { searchParams: { status?: string } }) {
  const user = await requireUser(see.finance);
  const status = searchParams.status === "SETTLED" ? "SETTLED" : searchParams.status === "ALL" ? undefined : "ACTIVE";
  const today = todayUTC();
  const [loans, tenders, sum, settledCount] = await Promise.all([
    db.loan.findMany({
      where: status ? { status } : {},
      include: { tender: { select: { id: true, name: true } }, installments: { orderBy: { seq: "asc" } } },
      orderBy: [{ status: "asc" }, { receivedDate: "desc" }],
    }),
    db.tender.findMany({ where: { status: { notIn: ["LOST", "CANCELLED", "CLOSED"] } }, select: { id: true, name: true, number: true }, orderBy: { id: "desc" } }),
    loanSummary(),
    db.loan.count({ where: { status: "SETTLED" } }),
  ]);
  const manage = can.manageDebts(user.role);

  return (
    <>
      <PageHeader
        title="الديون والقروض"
        subtitle="الديون الخارجية على الشركة — جدول الأقساط، السداد، التنبيهات قبل الاستحقاق، وربطها بالحساب البنكي والتدفق النقدي"
        actions={
          manage && (
            <ModalForm title="تسجيل دين جديد" trigger={<><Plus className="h-4 w-4" /> دين جديد</>} action={createLoan} wide>
              <LoanInfoFields tenders={tenders} />
              <LoanTermsFields />
              <DepositSlipInput required={depositSlipRequired(user)} hint={depositSlipRequired(user) ? "عند الاستلام بإيداع في حساب الشركة: وصل الإيداع إلزامي" : undefined} />
              <FileInput label="عقد الدين / سند / مستندات الضمان" />
            </ModalForm>
          )
        }
      />
      <div className="mb-5 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard label="المتبقي على الشركة" value={<Money value={sum.remaining} />} sub={`${sum.count} ديون قائمة — أصلها ${new Intl.NumberFormat("en-US").format(Math.round(sum.principal))} د.أ`} icon={Scale} tone="orange" />
        <StatCard label="أقساط متأخرة" value={<Money value={sum.overdue} />} sub={`${sum.overdueCount} أقساط`} icon={AlarmClock} tone={sum.overdueCount ? "red" : "gray"} />
        <StatCard label="تستحق خلال 30 يوماً" value={<Money value={sum.dueSoon} />} sub={`${sum.dueSoonCount} أقساط`} icon={CalendarClock} tone={sum.dueSoonCount ? "blue" : "gray"} />
        <StatCard label="المسدد من الديون القائمة" value={<Money value={sum.paid} />} sub={`${settledCount} ديون مسددة بالكامل`} icon={CheckCircle2} tone="green" />
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        {[
          ["ACTIVE", "القائمة"],
          ["SETTLED", "المسددة"],
          ["ALL", "الكل"],
        ].map(([k, label]) => (
          <Link key={k} href={`/debts?status=${k}`} className={clsx("btn-sm", (status ?? "ALL") === k ? "btn-primary" : "btn-secondary")}>
            {label}
          </Link>
        ))}
      </div>
      <Card pad={false}>
        {loans.length === 0 ? (
          <EmptyState icon={HandCoins} title={status === "SETTLED" ? "لا توجد ديون مسددة" : "لا توجد ديون قائمة على الشركة"} hint={manage ? "سجّل أي دين خارجي من «دين جديد» ليُجدول ويُتابع تلقائياً" : undefined} />
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>الجهة الدائنة</th>
                  <th>الغرض</th>
                  <th className="text-end">المستحق الكلي</th>
                  <th className="text-end">المتبقي</th>
                  <th>القسط القادم</th>
                  <th>الحالة</th>
                </tr>
              </thead>
              <tbody>
                {loans.map((l) => {
                  const paid = round3(l.installments.reduce((s, i) => s + i.paidAmount, 0));
                  const left = round3(l.totalDue - paid);
                  const next = l.installments.find((i) => i.paidAmount < i.amount - 0.0005);
                  const overdue = l.installments.filter((i) => i.paidAmount < i.amount - 0.0005 && i.dueDate < today).length;
                  return (
                    <tr key={l.id}>
                      <td>
                        <Link href={`/debts/${l.id}`} className="font-bold hover:text-accent">{l.lender}</Link>
                        <span className="block text-xs text-ink-muted">{LOAN_LENDER_TYPE[l.lenderType]}{l.reference ? ` — ${l.reference}` : ""}</span>
                      </td>
                      <td className="max-w-[240px]">
                        {l.purpose}
                        {l.tender && <Link href={`/tenders/${l.tender.id}`} className="block text-xs text-ink-muted hover:text-accent">{l.tender.name}</Link>}
                      </td>
                      <td className="text-end"><Money value={l.totalDue} /></td>
                      <td className="min-w-[140px] text-end">
                        <Money value={left} strong className={left > 0 ? "text-accent" : "text-good"} />
                        <ProgressBar value={l.totalDue ? (paid / l.totalDue) * 100 : 0} className="mt-1" />
                      </td>
                      <td className="whitespace-nowrap">
                        {next ? (
                          <>
                            <span className="num block">{fmtDate(next.dueDate)} — <Money value={round3(next.amount - next.paidAmount)} /></span>
                            <Badge tone={next.dueDate < today ? "red" : next.dueDate.getTime() - today.getTime() <= 7 * 86400000 ? "orange" : "gray"}>{relativeDays(next.dueDate)}</Badge>
                            {overdue > 1 && <Badge tone="red" className="ms-1">{overdue} متأخرة</Badge>}
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td><StatusBadge map={LOAN_STATUS} value={l.status} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

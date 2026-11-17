import { userSees } from "@/lib/brand";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, Landmark, Lock, Plus, Trash2 } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { can, depositSlipRequired } from "@/lib/permissions";
import { bankBalance } from "@/lib/finance";
import { BANK_TX_CATEGORY } from "@/lib/labels";
import { fmtDate, toInputDate, todayUTC } from "@/lib/format";
import { AttachmentList, Badge, Card, Money, PageHeader, StatCard } from "@/components/ui";
import { ConfirmButton, Grid, Input, ModalForm, Select } from "@/components/forms";
import { addBankTx, deleteBankTx } from "../actions/finance";
import { DepositSlipInput } from "@/components/deposit-slip";
import { depositSlipsFor } from "@/lib/deposit";

export const metadata = { title: "الحساب البنكي" };

const SOURCE: Record<string, string> = { MANUAL: "يدوي", CLAIM: "مطالبة", CHEQUE: "شيك", EXPENSE: "مصروف", FUND: "عهدة", TAX: "ضريبة", RETENTION: "محجوزات", ADVANCE: "دفعة مقدمة", LOAN: "دين مستلم", LOAN_PAY: "سداد دين" };

export default async function BankPage({ searchParams }: { searchParams: { year?: string } }) {
  const viewer = await requireUser();
  if (!(await userSees(viewer, "bank"))) redirect("/");
  const bal = await bankBalance();
  const year = Number(searchParams.year) || todayUTC().getUTCFullYear();
  const from = new Date(Date.UTC(year, 0, 1));
  const to = new Date(Date.UTC(year + 1, 0, 1));
  const [txs, before, tenders, years] = await Promise.all([
    db.bankTransaction.findMany({ where: { date: { gte: from, lt: to } }, include: { tender: { select: { id: true, name: true } } }, orderBy: [{ date: "asc" }, { id: "asc" }] }),
    db.bankTransaction.groupBy({ by: ["type"], where: { date: { lt: from } }, _sum: { amount: true } }),
    db.tender.findMany({ select: { id: true, name: true }, where: { status: { notIn: ["LOST", "CANCELLED"] } } }),
    db.bankTransaction.findMany({ select: { date: true }, orderBy: { date: "asc" }, take: 1 }),
  ]);
  const slips = await depositSlipsFor(txs);
  const opening = (before.find((b) => b.type === "IN")?._sum.amount ?? 0) - (before.find((b) => b.type === "OUT")?._sum.amount ?? 0);
  let running = opening;
  const rows = txs.map((t) => {
    running += t.type === "IN" ? t.amount : -t.amount;
    return { ...t, running };
  });
  const firstYear = years[0]?.date.getUTCFullYear() ?? year;
  const yearList = Array.from({ length: todayUTC().getUTCFullYear() - firstYear + 1 }, (_, i) => firstYear + i).reverse();
  const yIn = txs.filter((t) => t.type === "IN").reduce((s, t) => s + t.amount, 0);
  const yOut = txs.filter((t) => t.type === "OUT").reduce((s, t) => s + t.amount, 0);

  return (
    <>
      <PageHeader
        title="الحساب البنكي الرئيسي"
        subtitle={<span className="inline-flex items-center gap-1.5"><Lock className="h-3.5 w-3.5" /> سري — مرئي للمدير العام فقط. الحركات المرتبطة تُنشأ تلقائياً من المطالبات والشيكات والمصاريف والعهد.</span>}
        actions={
          <ModalForm title="حركة بنكية يدوية" trigger={<><Plus className="h-4 w-4" /> حركة جديدة</>} action={addBankTx}>
            <Grid>
              <Select name="type" label="نوع الحركة" options={{ IN: "إيداع (وارد)", OUT: "سحب (صادر)" }} />
              <Select name="category" label="التصنيف" options={BANK_TX_CATEGORY} defaultValue="CAPITAL" />
            </Grid>
            <Grid>
              <Input name="amount" label="المبلغ (د.أ)" type="number" required />
              <Input name="date" label="التاريخ" type="date" required defaultValue={toInputDate(todayUTC())} />
            </Grid>
            <Input name="description" label="البيان" required />
            <Select name="tenderId" label="المشروع (اختياري)" options={tenders.map((t) => ({ value: t.id, label: t.name }))} placeholder="—" />
            <DepositSlipInput required={depositSlipRequired(viewer)} hint={depositSlipRequired(viewer) ? "للإيداع (وارد): وصل الإيداع إلزامي" : undefined} />
          </ModalForm>
        }
      />
      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="الرصيد الحالي" value={<Money value={bal.balance} />} icon={Landmark} tone={bal.balance >= 0 ? "green" : "red"} />
        <StatCard label={`وارد ${year}`} value={<Money value={yIn} />} icon={ArrowDownLeft} tone="blue" />
        <StatCard label={`صادر ${year}`} value={<Money value={yOut} />} icon={ArrowUpRight} tone="orange" />
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        {yearList.map((y) => (
          <Link key={y} href={`/bank?year=${y}`} className={y === year ? "btn-primary btn-sm" : "btn-secondary btn-sm"}>
            {y}
          </Link>
        ))}
      </div>
      <Card pad={false}>
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>التاريخ</th>
                <th>البيان</th>
                <th>المصدر</th>
                <th className="text-end">وارد</th>
                <th className="text-end">صادر</th>
                <th className="text-end">الرصيد</th>
                <th />
              </tr>
            </thead>
            <tbody>
              <tr className="bg-canvas/60">
                <td colSpan={5} className="font-semibold text-ink-muted">رصيد افتتاحي {year}</td>
                <td className="text-end"><Money value={opening} strong /></td>
                <td />
              </tr>
              {rows.map((t) => (
                <tr key={t.id}>
                  <td className="num whitespace-nowrap">{fmtDate(t.date)}</td>
                  <td className="max-w-[340px]">
                    {t.description}
                    {t.tender && <Link href={`/tenders/${t.tender.id}`} className="block text-xs text-ink-muted hover:text-accent">{t.tender.name}</Link>}
                    {t.sourceType === "LOAN" || t.sourceType === "LOAN_PAY" ? <Link href={`/debts/${t.sourceId}`} className="block text-xs text-ink-muted hover:text-accent">فتح ملف الدين</Link> : null}
                    {slips.has(t.id) && <span className="mt-1 flex items-center gap-1 text-xs font-semibold text-good">وصل الإيداع: <AttachmentList items={slips.get(t.id)} /></span>}
                  </td>
                  <td><Badge>{SOURCE[t.sourceType] ?? t.sourceType}{t.category && t.sourceType === "MANUAL" ? ` — ${BANK_TX_CATEGORY[t.category] ?? t.category}` : ""}</Badge></td>
                  <td className="text-end">{t.type === "IN" ? <Money value={t.amount} className="text-good" strong /> : ""}</td>
                  <td className="text-end">{t.type === "OUT" ? <Money value={t.amount} /> : ""}</td>
                  <td className="text-end"><Money value={t.running} strong className={t.running < 0 ? "text-bad" : ""} /></td>
                  <td>
                    {t.sourceType === "MANUAL" && (
                      <ConfirmButton action={deleteBankTx.bind(null, t.id)} confirm="حذف الحركة؟" className="btn-danger btn-sm" title="حذف">
                        <Trash2 className="h-4 w-4" />
                      </ConfirmButton>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

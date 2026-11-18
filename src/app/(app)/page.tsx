import Link from "next/link";
import {
  AlertTriangle,
  Banknote,
  Briefcase,
  CalendarClock,
  CheckCircle2,
  FileCheck2,
  HandCoins,
  Landmark,
  Plus,
  Receipt,
  ShieldCheck,
  Trophy,
  Wallet,
  XCircle,
  Printer,
} from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { bankBalance, custodyBalances } from "@/lib/finance";
import { ACTIVE_PROJECT_STATUSES, CLAIM_STATUS, EXPENSE_CATEGORY, PRE_AWARD_STATUSES, PROJECT_STATUSES, TENDER_STATUS } from "@/lib/labels";
import { addDays, daysUntil, fmtDate, fmtJOD, monthLabel, relativeDays, todayUTC } from "@/lib/format";
import { tenderScope, type AppUser } from "@/lib/permissions";
import { Badge, BarList, Card, EmptyState, Money, PageHeader, ProgressBar, StatCard, StatusBadge } from "@/components/ui";
import { CashFlowChart } from "@/components/charts";
import { earnedValue } from "@/lib/format";
import { ConfirmButton, Input, ModalForm, Select, Textarea, Grid } from "@/components/forms";
import { decideFund, fundUser, requestFunds } from "./actions/finance";
import { notificationsForRequest } from "@/lib/notifications";
import { LiveAlerts } from "@/components/live-alerts";
import { claimNet } from "@/lib/deductions";
import { projectCashFlow } from "@/lib/cashflow";
import { loanSummary } from "@/lib/loans";
import { ChairmanDashboard } from "./chairman-dashboard";
import { Suspense } from "react";
import { FxRates, SiteWeather } from "@/components/site-conditions";

export const dynamic = "force-dynamic";

function greeting() {
  const h = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: "Asia/Amman" }).format(new Date()));
  return h < 12 ? "صباح الخير" : "مساء الخير";
}

function last12Months() {
  const t = todayUTC();
  const out: { key: string; label: string; full: string }[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - i, 1));
    out.push({
      key: `${d.getUTCFullYear()}-${d.getUTCMonth()}`,
      label: `${d.getUTCMonth() + 1}/${String(d.getUTCFullYear()).slice(2)}`,
      full: monthLabel(d.getUTCFullYear(), d.getUTCMonth()),
    });
  }
  return out;
}
function monthKey(d: Date) {
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
}

export default async function DashboardPage() {
  const user = await requireUser();
  if (user.role === "PM") return <PMDashboard user={user} />;
  if (user.role === "CHAIRMAN") return <ChairmanDashboard user={user} />;
  return <ManagementDashboard user={user} />;
}

async function ManagementDashboard({ user }: { user: AppUser }) {
  const isAdmin = user.role === "ADMIN";
  const today = todayUTC();
  const yearAgo = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 11, 1));

  const [activeProjects, claimsAgg, expensesAgg, guaranteesAgg, tenderStatusCounts, upcomingTenders, pendingFunds, upcomingCheques, staff, notes] =
    await Promise.all([
      db.tender.findMany({
        where: { status: { in: PROJECT_STATUSES } },
        select: { id: true, name: true, number: true, status: true, awardedValue: true, variationTotal: true, progress: true, manager: { select: { name: true } } },
      }),
      db.claim.findMany({ where: { status: { in: ["SUBMITTED", "APPROVED", "PAID"] } }, select: { status: true, grossAmount: true, retention: true, withholdingTax: true, stampDuty: true, advanceRecovery: true, deductions: true, paidAmount: true } }),
      db.expense.aggregate({ _sum: { amount: true } }),
      db.guarantee.aggregate({ where: { status: { in: ["ISSUED", "SUBMITTED"] } }, _sum: { amount: true }, _count: true }),
      db.tender.groupBy({ by: ["status"], _count: true }),
      db.tender.findMany({
        where: { status: { in: PRE_AWARD_STATUSES }, deadline: { gte: today, lte: addDays(today, 21) } },
        orderBy: { deadline: "asc" },
        take: 6,
      }),
      db.fundRequest.findMany({ where: { status: "PENDING" }, include: { requester: true, tender: true }, orderBy: { createdAt: "asc" } }),
      db.cheque.findMany({ where: { status: "DEFERRED", dueDate: { lte: addDays(today, 30) } }, orderBy: { dueDate: "asc" }, take: 6 }),
      db.user.findMany({ where: { active: true, role: { in: ["PM", "ACCOUNTANT"] } }, orderBy: { name: "asc" } }),
      notificationsForRequest(user),
    ]);

  const contractValue = activeProjects.filter((p) => ACTIVE_PROJECT_STATUSES.includes(p.status)).reduce((s, p) => s + (p.awardedValue ?? 0) + p.variationTotal, 0);
  const collected = claimsAgg.filter((c) => c.status === "PAID").reduce((s, c) => s + (c.paidAmount ?? 0), 0);
  const pendingClaims = claimsAgg.filter((c) => c.status !== "PAID").reduce((s, c) => s + claimNet(c), 0);
  const totalExpenses = expensesAgg._sum.amount ?? 0;
  const countOf = (s: string[]) => tenderStatusCounts.filter((t) => s.includes(t.status)).reduce((a, t) => a + t._count, 0);
  const won = countOf(PROJECT_STATUSES);
  const lost = countOf(["LOST"]);
  const winRate = won + lost > 0 ? (won / (won + lost)) * 100 : 0;
  const deferredCheques30 = upcomingCheques.reduce((s, c) => s + c.amount, 0);

  // التدفق النقدي الشهري
  const months = last12Months();
  let flow: { month: string; full: string; in: number; out: number }[];
  if (isAdmin) {
    const txs = await db.bankTransaction.findMany({ where: { date: { gte: yearAgo } }, select: { date: true, type: true, amount: true } });
    flow = months.map((m) => ({
      month: m.label,
      full: m.full,
      in: txs.filter((t) => t.type === "IN" && monthKey(t.date) === m.key).reduce((s, t) => s + t.amount, 0),
      out: txs.filter((t) => t.type === "OUT" && monthKey(t.date) === m.key).reduce((s, t) => s + t.amount, 0),
    }));
  } else {
    const [paid, exps] = await Promise.all([
      db.claim.findMany({ where: { status: "PAID", paidDate: { gte: yearAgo } }, select: { paidDate: true, paidAmount: true } }),
      db.expense.findMany({ where: { date: { gte: yearAgo } }, select: { date: true, amount: true } }),
    ]);
    flow = months.map((m) => ({
      month: m.label,
      full: m.full,
      in: paid.filter((c) => c.paidDate && monthKey(c.paidDate) === m.key).reduce((s, c) => s + (c.paidAmount ?? 0), 0),
      out: exps.filter((e) => monthKey(e.date) === m.key).reduce((s, e) => s + e.amount, 0),
    }));
  }

  // الربحية (المدير العام فقط)
  let bank: Awaited<ReturnType<typeof bankBalance>> | null = null;
  const [projection, debts] = isAdmin ? await Promise.all([projectCashFlow(30), loanSummary()]) : [null, null];
  let margins: { id: number; name: string; margin: number; earned: number; cost: number; done: boolean }[] = [];
  if (isAdmin) {
    bank = await bankBalance();
    const costs = await db.expense.groupBy({ by: ["tenderId"], where: { tenderId: { in: activeProjects.map((p) => p.id) } }, _sum: { amount: true } });
    margins = activeProjects
      .filter((p) => (p.awardedValue ?? 0) > 0 && p.progress > 0)
      .map((p) => {
        const cost = costs.find((c) => c.tenderId === p.id)?._sum.amount ?? 0;
        const earned = earnedValue((p.awardedValue ?? 0) + p.variationTotal, p.progress);
        return { id: p.id, name: p.name, earned, cost, margin: ((earned - cost) / earned) * 100, done: ["MAINTENANCE", "CLOSED"].includes(p.status) };
      })
      .sort((a, b) => b.margin - a.margin)
      .slice(0, 10);
  }
  const avgMargin = (list: typeof margins) => (list.length ? list.reduce((s, m) => s + m.margin, 0) / list.length : 0);

  // المصاريف حسب التصنيف (للمحاسب)
  let byCategory: { name: string; value: number }[] = [];
  if (!isAdmin) {
    const cat = await db.expense.groupBy({ by: ["category"], _sum: { amount: true } });
    byCategory = cat.map((c) => ({ name: EXPENSE_CATEGORY[c.category] ?? c.category, value: c._sum.amount ?? 0 })).sort((a, b) => b.value - a.value);
  }

  const custody = await custodyBalances(staff.map((s) => s.id));
  const liquidity =
    bank == null
      ? null
      : bank.balance <= 0
        ? { label: "حرجة", tone: "red" as const, icon: AlertTriangle }
        : bank.balance < (deferredCheques30 + (debts ? debts.dueSoon + debts.overdue : 0)) * 1.5
          ? { label: "تحت المراقبة", tone: "orange" as const, icon: AlertTriangle }
          : { label: "جيدة", tone: "green" as const, icon: CheckCircle2 };

  const tenderOptions = activeProjects.filter((p) => ACTIVE_PROJECT_STATUSES.includes(p.status)).map((p) => ({ value: p.id, label: `${p.number} — ${p.name}` }));

  return (
    <>
      <PageHeader
        title={`${greeting()}، ${user.name.split(" ").slice(0, 2).join(" ")}`}
        subtitle={`${fmtDate(today)} — ${notes.length ? `لديك ${notes.length} تنبيهات تحتاج متابعة` : "لا توجد تنبيهات عاجلة"}`}
        actions={
          <>
            {isAdmin && (
              <Link href="/tenders/new" className="btn-primary">
                <Plus className="h-4 w-4" /> عطاء جديد
              </Link>
            )}
            {!isAdmin && (
              <ModalForm title="طلب تمويل من المدير العام" trigger={<><HandCoins className="h-4 w-4" /> طلب تمويل</>} triggerClass="btn-secondary" action={requestFunds} submitLabel="إرسال الطلب">
                <Input name="amount" label="المبلغ المطلوب (د.أ)" type="number" required />
                <Select name="tenderId" label="العطاء / المشروع" options={tenderOptions} placeholder="— عام —" />
                <Textarea name="reason" label="سبب الطلب" required placeholder="مثال: دفعة مورد الحديد لمشروع مدرسة الحسا" />
              </ModalForm>
            )}
          </>
        }
      />

      {isAdmin && bank && liquidity && (
        <section className="card mb-5 overflow-hidden">
          <div className="grid gap-0 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
            <div className="sidebar-navy p-6 text-white">
              <div className="flex items-center gap-2 text-[13px] font-semibold text-white/70">
                <Landmark className="h-4 w-4" /> الحساب البنكي الرئيسي للشركة
                <span className="ms-auto whitespace-nowrap rounded-full bg-white/10 px-2 py-0.5 text-[11px]">سري</span>
              </div>
              <p className="mt-3 text-[34px] font-bold leading-none">
                <span className="num">{new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(bank.balance)}</span>
                <span className="ms-2 text-base font-semibold text-white/60">د.أ</span>
              </p>
              <p className="mt-3 flex items-center gap-1.5 text-sm">
                <liquidity.icon className="h-4 w-4 shrink-0" />
                <span className="whitespace-nowrap">
                  حالة السيولة: <b>{liquidity.label}</b>
                </span>
              </p>
              <p className="mt-1 text-xs text-white/60">شيكات مؤجلة تستحق خلال 30 يوماً: {fmtJOD(deferredCheques30)}</p>
              {debts && debts.count > 0 && (
                <Link href="/debts" className="mt-1 block text-xs text-white/60 hover:text-white">
                  ديون قائمة على الشركة: {fmtJOD(debts.remaining)} — أقساط خلال 30 يوماً {fmtJOD(debts.dueSoon)}
                  {debts.overdue > 0 && <b className="text-[#ff8a80]"> — متأخر {fmtJOD(debts.overdue)}</b>}
                </Link>
              )}
              {projection && (
                <Link href="/cashflow" className="mt-3 block rounded-xl bg-white/10 px-3 py-2 text-xs transition hover:bg-white/15">
                  التوقع لـ 30 يوماً: أدنى رصيد <b className={projection.minBalance < 0 ? "text-[#ff8a80]" : ""}>{fmtJOD(projection.minBalance)}</b> بتاريخ {fmtDate(projection.minDate)} — الرصيد المتوقع بعد 30 يوماً <b>{fmtJOD(projection.closing)}</b> ←
                </Link>
              )}
            </div>
            <div className="border-b border-line p-5 md:border-b-0 md:border-e">
              <p className="text-[13px] font-semibold text-ink-muted">إجمالي الوارد</p>
              <p className="mt-2 text-xl font-bold"><Money value={bank.totalIn} /></p>
            </div>
            <div className="border-b border-line p-5 md:border-b-0 md:border-e">
              <p className="text-[13px] font-semibold text-ink-muted">إجمالي الصادر</p>
              <p className="mt-2 text-xl font-bold"><Money value={bank.totalOut} /></p>
            </div>
            <div className="flex flex-col justify-center gap-2 p-5">
              <Link href="/bank" className="btn-secondary">كشف الحساب</Link>
              <ModalForm title="تمويل مدير مشروع / عهدة" trigger={<><HandCoins className="h-4 w-4" /> تمويل عهدة</>} action={fundUser} submitLabel="تحويل التمويل">
                <Select name="recipientId" label="المستلم" options={staff.map((s) => ({ value: s.id, label: s.name }))} placeholder="— اختر —" required />
                <Grid>
                  <Input name="amount" label="المبلغ (د.أ)" type="number" required />
                  <Input name="date" label="التاريخ" type="date" defaultValue={today.toISOString().slice(0, 10)} />
                </Grid>
                <Select name="tenderId" label="المشروع" options={tenderOptions} placeholder="— عام —" />
                <Textarea name="reason" label="البيان" required />
              </ModalForm>
            </div>
          </div>
        </section>
      )}

      <LiveAlerts notes={notes} />

      <div className="stagger mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="قيمة العقود النشطة" value={<Money value={contractValue} />} sub={`${activeProjects.filter((p) => ACTIVE_PROJECT_STATUSES.includes(p.status)).length} مشاريع قيد التنفيذ والصيانة`} icon={Briefcase} href="/tenders?view=projects" />
        <StatCard label="المطالبات المقبوضة" value={<Money value={collected} />} sub={<>بانتظار القبض: <b className="text-ink"><Money value={pendingClaims} /></b></>} icon={Receipt} tone="green" href="/claims" />
        <StatCard label="إجمالي المصاريف" value={<Money value={totalExpenses} />} sub="على جميع العطاءات والمشاريع" icon={Wallet} tone="orange" href="/expenses" />
        <StatCard label="الكفالات السارية" value={<Money value={guaranteesAgg._sum.amount ?? 0} />} sub={`${guaranteesAgg._count} كفالات لدى الجهات`} icon={ShieldCheck} tone="purple" href="/guarantees" />
      </div>

      {/* ظروف المواقع: الطقس وتنبيهات الصب والرافعات + أسعار الصرف (تُحمّل دون إبطاء اللوحة) */}
      <div className="mb-5 grid gap-5 xl:grid-cols-3">
        <div className="xl:col-span-2"><Suspense fallback={null}><SiteWeather /></Suspense></div>
        <Suspense fallback={null}><FxRates /></Suspense>
      </div>

      <div className="stagger mb-5 grid gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-2" title={isAdmin ? "التدفق النقدي الشهري" : "المقبوضات مقابل المصاريف"} action={<span className="text-xs text-ink-muted">آخر 12 شهراً</span>}>
          <CashFlowChart data={flow} inLabel={isAdmin ? "الوارد للبنك" : "مطالبات مقبوضة"} outLabel={isAdmin ? "الصادر من البنك" : "مصاريف"} />
        </Card>
        <Card title="نسبة الفوز بالعطاءات">
          <div className="flex items-end gap-2">
            <span className="num text-[44px] font-bold leading-none">{winRate.toFixed(0)}%</span>
            <span className="mb-1 text-sm text-ink-muted">من العطاءات المحسومة</span>
          </div>
          <div className="mt-4 flex h-3 gap-[2px] overflow-hidden rounded-full" role="img" aria-label={`فوز ${won} وخسارة ${lost}`}>
            <div className="h-full rounded-s-full bg-[#2a78d6]" style={{ width: `${winRate}%` }} />
            <div className="h-full flex-1 rounded-e-full bg-[#eb6834]" />
          </div>
          <div className="mt-4 grid grid-cols-3 gap-3 text-center">
            <div className="rounded-xl bg-canvas p-3">
              <Trophy className="mx-auto h-4 w-4 text-[#2a78d6]" />
              <p className="num mt-1 text-lg font-bold">{won}</p>
              <p className="text-[11px] text-ink-muted">محالة</p>
            </div>
            <div className="rounded-xl bg-canvas p-3">
              <XCircle className="mx-auto h-4 w-4 text-[#eb6834]" />
              <p className="num mt-1 text-lg font-bold">{lost}</p>
              <p className="text-[11px] text-ink-muted">غير محالة</p>
            </div>
            <div className="rounded-xl bg-canvas p-3">
              <CalendarClock className="mx-auto h-4 w-4 text-ink-muted" />
              <p className="num mt-1 text-lg font-bold">{countOf(PRE_AWARD_STATUSES)}</p>
              <p className="text-[11px] text-ink-muted">قيد الدراسة</p>
            </div>
          </div>
        </Card>
      </div>

      <div className="stagger mb-5 grid gap-5 xl:grid-cols-3">
        {isAdmin ? (
          <Card className="xl:col-span-2" title="هوامش الربح حسب المشروع" action={<span className="text-xs text-ink-muted">قيمة الأعمال المنجزة مقابل المصاريف المسجلة</span>}>
            {margins.length ? (
              <>
                <div className="mb-4 grid grid-cols-2 gap-3">
                  <div className="rounded-xl bg-canvas p-3">
                    <p className="text-xs text-ink-muted">متوسط هامش المشاريع المنجزة</p>
                    <p className="num text-lg font-bold">{avgMargin(margins.filter((m) => m.done)).toFixed(1)}%</p>
                  </div>
                  <div className="rounded-xl bg-canvas p-3">
                    <p className="text-xs text-ink-muted">متوسط هامش المشاريع الجارية</p>
                    <p className="num text-lg font-bold">{avgMargin(margins.filter((m) => !m.done)).toFixed(1)}%</p>
                  </div>
                </div>
                <BarList
                  max={40}
                  format={(n) => `${n.toFixed(1)}%`}
                  rows={margins.map((m) => ({
                    label: m.name,
                    value: m.margin,
                    href: `/tenders/${m.id}`,
                    sub: `${m.done ? "منجز" : "جارٍ"} — أعمال منجزة ${fmtJOD(m.earned)} مقابل تكاليف ${fmtJOD(m.cost)}`,
                  }))}
                />
              </>
            ) : (
              <EmptyState title="لا توجد مشاريع محالة بعد" />
            )}
          </Card>
        ) : (
          <Card className="xl:col-span-2" title="المصاريف حسب التصنيف">
            <BarList rows={byCategory.map((c) => ({ label: c.name, value: c.value }))} format={(n) => fmtJOD(n)} />
          </Card>
        )}

        <Card title="أرصدة العهد" action={<Link href="/funds" className="text-sm font-semibold text-accent">التفاصيل</Link>}>
          <ul className="divide-y divide-line">
            {staff.map((s) => {
              const c = custody.get(s.id);
              return (
                <li key={s.id} className="flex items-center justify-between gap-3 py-2.5">
                  <span>
                    <span className="block text-sm font-bold">{s.name}</span>
                    <span className="text-xs text-ink-muted">مصروف {fmtJOD(c?.spent ?? 0)} من {fmtJOD(c?.funded ?? 0)}</span>
                  </span>
                  <Money value={c?.balance ?? 0} strong className={(c?.balance ?? 0) < 0 ? "text-bad" : ""} />
                </li>
              );
            })}
          </ul>
        </Card>
      </div>

      <h2 className="mb-3 mt-8 text-lg font-bold">مركز الإجراءات السريعة</h2>
      <div className="grid gap-5 lg:grid-cols-3">
        <Card title={<span className="flex items-center gap-2"><HandCoins className="h-5 w-5 text-warn" /> طلبات تمويل معلقة</span>}>
          {pendingFunds.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink-muted">لا توجد طلبات معلقة</p>
          ) : (
            <ul className="space-y-3">
              {pendingFunds.map((f) => (
                <li key={f.id} className="rounded-xl bg-canvas p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-bold">{f.requester.name}</p>
                      <p className="truncate text-xs text-ink-muted">{f.reason}{f.tender ? ` — ${f.tender.number}` : ""}</p>
                    </div>
                    <Money value={f.amount} strong />
                  </div>
                  {isAdmin ? (
                    <div className="mt-2 flex gap-2">
                      <ConfirmButton action={decideFund.bind(null, f.id, "APPROVED")} confirm={`الموافقة على تحويل ${fmtJOD(f.amount)} إلى ${f.requester.name}؟`} className="btn-primary btn-sm flex-1">
                        موافقة وتحويل
                      </ConfirmButton>
                      <ConfirmButton action={decideFund.bind(null, f.id, "REJECTED")} confirm="رفض الطلب؟" className="btn-danger btn-sm">
                        رفض
                      </ConfirmButton>
                    </div>
                  ) : (
                    <p className="mt-2 text-xs font-semibold text-warn">بانتظار موافقة المدير العام</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title={<span className="flex items-center gap-2"><FileCheck2 className="h-5 w-5 text-accent" /> مواعيد تقديم قريبة</span>} action={<Link href="/tenders" className="text-sm font-semibold text-accent">الكل</Link>}>
          {upcomingTenders.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink-muted">لا مواعيد خلال 3 أسابيع</p>
          ) : (
            <ul className="divide-y divide-line">
              {upcomingTenders.map((t) => {
                const d = daysUntil(t.deadline);
                return (
                  <li key={t.id}>
                    <Link href={`/tenders/${t.id}`} className="flex items-center justify-between gap-3 py-2.5 hover:opacity-80">
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-bold">{t.name}</span>
                        <span className="text-xs text-ink-muted">{t.entity}</span>
                      </span>
                      <Badge tone={d <= 3 ? "red" : d <= 7 ? "orange" : "gray"}>{relativeDays(t.deadline)}</Badge>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card title={<span className="flex items-center gap-2"><Banknote className="h-5 w-5 text-good" /> شيكات مستحقة (30 يوماً)</span>} action={<Link href="/cheques" className="text-sm font-semibold text-accent">الدفتر</Link>}>
          {upcomingCheques.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink-muted">لا شيكات مستحقة</p>
          ) : (
            <ul className="divide-y divide-line">
              {upcomingCheques.map((c) => {
                const d = daysUntil(c.dueDate);
                return (
                  <li key={c.id} className="flex items-center justify-between gap-3 py-2.5">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-bold">{c.payee}</span>
                      <span className="text-xs text-ink-muted">شيك {c.number} — {fmtDate(c.dueDate)}</span>
                    </span>
                    <span className="text-end">
                      <Money value={c.amount} strong />
                      <Badge tone={d <= 0 ? "red" : d <= 3 ? "orange" : "gray"} className="mt-0.5">{relativeDays(c.dueDate)}</Badge>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

async function PMDashboard({ user }: { user: AppUser }) {
  const [projects, recent, custody, myRequests] = await Promise.all([
    db.tender.findMany({
      where: { ...tenderScope(user), status: { notIn: ["LOST", "CANCELLED"] } },
      include: { _count: { select: { claims: true, expenses: true } } },
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    }),
    db.expense.findMany({ where: { createdById: user.id }, orderBy: { createdAt: "desc" }, take: 6, include: { tender: { select: { name: true } } } }),
    custodyBalances([user.id]),
    db.fundRequest.findMany({ where: { recipientId: user.id }, orderBy: { createdAt: "desc" }, take: 4 }),
  ]);
  const notes = await notificationsForRequest(user);
  // مطالبات مرت ببوابة تدقيق المحاسب — جاهزة للطباعة والتسليم لصاحب العمل
  const readyClaims = await db.claim.findMany({
    where: { tender: tenderScope(user), status: { in: ["READY", "REVIEW", "SUBMITTED", "APPROVED"] } },
    include: { tender: { select: { name: true } } },
    orderBy: [{ readyAt: "desc" }, { id: "desc" }],
    take: 6,
  });
  // الكتب الرسمية المعتمدة حديثاً لمشاريعه أو التي أنشأها — جاهزة للطباعة على ورقة الشركة
  const readyLetters = await db.correspondence.findMany({
    where: { direction: "OUT", letterStatus: "APPROVED", approvedAt: { gte: new Date(Date.now() - 30 * 86400_000) }, OR: [{ createdById: user.id }, { tender: { managerId: user.id } }] },
    select: { id: true, refNo: true, subject: true, approvedAt: true, tender: { select: { name: true } } },
    orderBy: { approvedAt: "desc" },
    take: 6,
  });
  const c = custody.get(user.id) ?? { funded: 0, spent: 0, balance: 0 };
  const spentByProject = await db.expense.groupBy({ by: ["tenderId"], where: { tenderId: { in: projects.map((p) => p.id) } }, _sum: { amount: true } });

  return (
    <>
      <PageHeader title={`${greeting()}، ${user.name.split(" ").slice(0, 2).join(" ")}`} subtitle="مشاريعك وعهدتك في مكان واحد" />
      <div className="mb-5"><Suspense fallback={null}><SiteWeather managerId={user.id} /></Suspense></div>
      {readyLetters.length > 0 && (
        <Card className="mb-5" title={<span className="flex items-center gap-2"><Printer className="h-5 w-5 text-accent" /> كتب رسمية معتمدة — جاهزة للطباعة</span>}>
          <ul className="divide-y divide-line">
            {readyLetters.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <Link href={`/correspondence/letters/${l.id}`} className="font-bold text-ink hover:text-accent">{l.subject}</Link>
                  <p className="text-xs text-ink-muted"><span dir="ltr" className="num">{l.refNo}</span>{l.tender ? ` — ${l.tender.name}` : ""}{l.approvedAt ? ` · اعتُمد ${fmtDate(l.approvedAt)}` : ""}</p>
                </div>
                <a href={`/api/letters/${l.id}/pdf`} target="_blank" rel="noopener" className="btn-primary btn-sm"><Printer className="h-4 w-4" /> طباعة</a>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <LiveAlerts notes={notes} limit={3} />

      <div className="stagger mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="رصيد العهدة الحالي" value={<Money value={c.balance} />} sub={`استلمت ${fmtJOD(c.funded)} — صرفت ${fmtJOD(c.spent)}`} icon={Wallet} tone={c.balance < 0 ? "red" : "green"} href="/funds" />
        <StatCard label="مشاريعي النشطة" value={projects.filter((p) => ACTIVE_PROJECT_STATUSES.includes(p.status)).length} icon={Briefcase} href="/tenders" />
        <div className="card card-pad flex flex-col justify-center gap-2">
          <Link href="/expenses/new" className="btn-primary w-full py-3 text-[15px]">
            <Plus className="h-5 w-5" /> تسجيل مصروف ميداني
          </Link>
          <ModalForm title="طلب تمويل عهدة" trigger={<><HandCoins className="h-4 w-4" /> طلب تمويل</>} triggerClass="btn-secondary w-full" action={requestFunds} submitLabel="إرسال الطلب">
            <Input name="amount" label="المبلغ المطلوب (د.أ)" type="number" required />
            <Select name="tenderId" label="المشروع" options={projects.map((p) => ({ value: p.id, label: p.name }))} placeholder="— اختر —" />
            <Textarea name="reason" label="سبب الطلب" required />
          </ModalForm>
        </div>
      </div>

      <h2 className="mb-3 text-lg font-bold">مشاريعي</h2>
      {projects.length === 0 ? (
        <Card>
          <EmptyState icon={Briefcase} title="لا توجد مشاريع مسندة إليك" hint="سيظهر هنا كل مشروع يسنده إليك المدير العام" />
        </Card>
      ) : (
        <div className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {projects.map((p) => (
            <Link key={p.id} href={`/tenders/${p.id}`} className="card card-pad block min-w-0 transition hover:-translate-y-0.5 hover:shadow-pop">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold">{p.name}</p>
                  <p className="text-xs text-ink-muted">{p.entity} — {p.number}</p>
                </div>
                <StatusBadge map={TENDER_STATUS} value={p.status} />
              </div>
              <ProgressBar value={p.progress} className="mt-4" />
              <div className="mt-3 flex justify-between text-xs text-ink-muted">
                <span>مصاريف: <b className="text-ink">{fmtJOD(spentByProject.find((s) => s.tenderId === p.id)?._sum.amount ?? 0)}</b></span>
                <span>{p._count.claims} مطالبات</span>
              </div>
            </Link>
          ))}
        </div>
      )}

      {readyClaims.length > 0 && (
        <Card title="المطالبات الجاهزة للطباعة والتسليم" className="mb-5">
          <ul className="divide-y divide-line">
            {readyClaims.map((k) => (
              <li key={k.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                <span className="min-w-0">
                  <span className="block text-sm font-bold">مطالبة رقم {k.number} — {k.tender.name}</span>
                  <span className="text-xs text-ink-muted">صافي {fmtJOD(claimNet(k))} — <StatusBadge map={CLAIM_STATUS} value={k.status} /></span>
                </span>
                <span className="flex gap-2">
                  <Link href={`/claims/${k.id}`} className="btn-primary btn-sm">طباعة / PDF</Link>
                  <a href={`/api/export/claim?id=${k.id}`} className="btn-secondary btn-sm" download>Excel</a>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="آخر مصاريفي" action={<Link href="/expenses" className="text-sm font-semibold text-accent">الكل</Link>}>
          {recent.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink-muted">لم تسجل مصاريف بعد</p>
          ) : (
            <ul className="divide-y divide-line">
              {recent.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-3 py-2.5">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-bold">{e.description}</span>
                    <span className="text-xs text-ink-muted">{e.tender?.name ?? "عام"} — {fmtDate(e.date)}</span>
                  </span>
                  <Money value={e.amount} strong />
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="طلبات التمويل">
          {myRequests.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink-muted">لا طلبات</p>
          ) : (
            <ul className="divide-y divide-line">
              {myRequests.map((f) => (
                <li key={f.id} className="flex items-center justify-between gap-3 py-2.5">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-bold">{f.reason}</span>
                    <span className="text-xs text-ink-muted">{fmtDate(f.createdAt)}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <Money value={f.amount} />
                    <Badge tone={f.status === "APPROVED" ? "green" : f.status === "REJECTED" ? "red" : "orange"}>
                      {f.status === "APPROVED" ? "مستلم" : f.status === "REJECTED" ? "مرفوض" : "معلق"}
                    </Badge>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

export const metadata = { title: "لوحة التحكم" };

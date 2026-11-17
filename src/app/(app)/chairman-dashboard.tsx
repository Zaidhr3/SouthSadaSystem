import Link from "next/link";
import clsx from "clsx";
import {
  Briefcase,
  ChevronLeft,
  ClipboardCheck,
  HandCoins,
  Landmark,
  MessagesSquare,
  NotebookTabs,
  Receipt,
  ScrollText,
  ShieldAlert,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { db } from "@/lib/db";
import { bankBalance } from "@/lib/finance";
import { ACTIVE_PROJECT_STATUSES } from "@/lib/labels";
import { addDays, todayUTC } from "@/lib/format";
import { claimNet } from "@/lib/deductions";
import type { AppUser } from "@/lib/permissions";
import { phaseLabel } from "@/lib/project-phase";
import { projectProfit } from "@/lib/profit";
import { fmtDate } from "@/lib/format";
import { GUARANTEE_TYPE } from "@/lib/labels";

const n0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

function greeting() {
  const h = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: "Asia/Amman" }).format(new Date()));
  return h < 12 ? "صباح الخير" : "مساء الخير";
}

type TileTone = "blue" | "green" | "orange" | "red" | "ink";
const TONE: Record<TileTone, string> = {
  blue: "bg-[#0058b0]",
  green: "bg-[#146c2e]",
  orange: "bg-[#9a4a00]",
  red: "bg-[#b00012]",
  ink: "bg-[#1d1d1f]",
};

/** بطاقة كبيرة بضغطة واحدة — خط كبير وتباين عالٍ للقراءة السهلة حتى تحت أشعة الشمس */
function Tile({ href, icon: Icon, label, value, unit, sub, tone }: { href: string; icon: LucideIcon; label: string; value: string; unit?: string; sub?: string; tone: TileTone }) {
  return (
    <Link href={href} className={clsx("pressable flex min-h-[150px] flex-col justify-between rounded-[28px] p-5 text-white shadow-pop sm:p-6", TONE[tone])}>
      <span className="flex items-center justify-between gap-3">
        <span className="text-[19px] font-bold leading-snug">{label}</span>
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white/20">
          <Icon className="h-7 w-7" aria-hidden />
        </span>
      </span>
      <span className="mt-3 block">
        <span className="num text-[38px] font-bold leading-none tracking-tight sm:text-[44px]">{value}</span>
        {unit && <span className="ms-2 text-[18px] font-bold text-white/90">{unit}</span>}
      </span>
      {sub && <span className="mt-2 flex items-center gap-1 text-[16px] font-semibold text-white/90">{sub} <ChevronLeft className="h-5 w-5" aria-hidden /></span>}
    </Link>
  );
}

/** لوحة المشرف الأعلى (أبو أحمد): اطلاع شامل بنظرة واحدة — بلا أي أزرار تعديل */
export async function ChairmanDashboard({ user }: { user: AppUser }) {
  const today = todayUTC();
  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const [guaranteesActive, receiptsAwaiting, diaries, finished] = await Promise.all([
    db.guarantee.groupBy({ by: ["type"], where: { status: { in: ["ISSUED", "SUBMITTED"] } }, _sum: { amount: true }, _count: true }),
    db.claim.aggregate({ where: { payStage: "AUDITED" }, _sum: { receiptAmount: true }, _count: true }),
    db.siteDiary.findMany({ orderBy: [{ date: "desc" }, { id: "desc" }], take: 5, include: { tender: { select: { id: true, name: true } } } }),
    db.tender.findMany({ where: { OR: [{ finalHandoverDate: { not: null } }, { status: "CLOSED" }] }, select: { id: true, name: true }, orderBy: { updatedAt: "desc" }, take: 6 }),
  ]);
  const profits = await projectProfit(finished.map((t) => t.id));
  const [bank, projects, claims, monthExpenses, readyClaims, pendingRequests, messagesToday, unreadMine, expiringGuarantees, chequesWeek] = await Promise.all([
    bankBalance(),
    db.tender.findMany({
      where: { status: { in: ACTIVE_PROJECT_STATUSES } },
      select: { id: true, name: true, status: true, phase: true, awardedValue: true, variationTotal: true, progress: true, manager: { select: { name: true } }, awardLetterDate: true, commenceOrderDate: true, prelimInspectionDate: true, preliminaryHandoverDate: true, maintenanceMonths: true, finalHandoverDate: true, maintenanceReleaseDate: true, guarantees: { select: { type: true, status: true, expiryDate: true } }, claims: { select: { type: true, status: true } } },
      orderBy: { progress: "desc" },
    }),
    db.claim.findMany({ where: { status: { in: ["SUBMITTED", "APPROVED", "PAID"] } }, select: { status: true, grossAmount: true, retention: true, withholdingTax: true, stampDuty: true, advanceRecovery: true, deductions: true, paidAmount: true } }),
    db.expense.aggregate({ where: { date: { gte: monthStart } }, _sum: { amount: true } }),
    db.claim.count({ where: { status: { in: ["READY", "REVIEW"] } } }),
    db.fieldRequest.count({ where: { status: { in: ["PENDING_AUDIT", "PENDING_GM", "APPROVED"] } } }),
    db.message.count({ where: { createdAt: { gte: today } } }),
    db.message.count({ where: { recipientId: user.id, readAt: null } }),
    db.guarantee.count({ where: { status: { in: ["ISSUED", "SUBMITTED"] }, expiryDate: { lte: addDays(today, 30) } } }),
    db.cheque.aggregate({ where: { status: "DEFERRED", dueDate: { lte: addDays(today, 7) } }, _sum: { amount: true }, _count: true }),
  ]);

  const contractValue = projects.reduce((s, p) => s + (p.awardedValue ?? 0) + p.variationTotal, 0);
  const collected = claims.filter((c) => c.status === "PAID").reduce((s, c) => s + (c.paidAmount ?? 0), 0);
  const receivable = claims.filter((c) => c.status !== "PAID").reduce((s, c) => s + claimNet(c), 0);
  const firstName = user.name.replace(/^م\.\s*/, "");

  return (
    <div className="page-enter">
      <header className="mb-6">
        <p className="text-[20px] font-semibold text-ink-soft">{greeting()}،</p>
        <h1 className="text-[32px] font-bold leading-tight sm:text-[38px]">{firstName}</h1>
        <p className="mt-1 text-[17px] font-semibold text-ink-soft">صورة كاملة عن الشركة — اضغط أي بطاقة لعرض التفاصيل</p>
      </header>

      <div className="stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Tile href="/bank" icon={Landmark} tone="ink" label="رصيد البنك" value={n0.format(bank.balance)} unit="دينار" sub="الحساب البنكي" />
        <Tile href="/tenders?view=projects" icon={Briefcase} tone="blue" label="المشاريع الجارية" value={String(projects.length)} unit="مشروع" sub={`قيمة العقود ${n0.format(contractValue)} د.أ`} />
        <Tile href="/claims" icon={Receipt} tone="green" label="المبالغ المقبوضة" value={n0.format(collected)} unit="دينار" sub={`مستحق لم يُقبض ${n0.format(receivable)} د.أ`} />
        <Tile href="/expenses" icon={Wallet} tone="orange" label="مصاريف هذا الشهر" value={n0.format(monthExpenses._sum.amount ?? 0)} unit="دينار" sub="كل المصاريف" />
        <Tile href="/claims?status=READY" icon={ClipboardCheck} tone={readyClaims > 0 ? "red" : "blue"} label="مطالبات بانتظار موافقتك" value={String(readyClaims)} unit="مطالبة" sub="الموافقة النهائية — المدير العام أو أنت" />
        <Tile href="/claims" icon={Landmark} tone={receiptsAwaiting._count > 0 ? "red" : "green"} label="قبض بانتظار موافقتك" value={n0.format(receiptsAwaiting._sum.receiptAmount ?? 0)} unit="دينار" sub={`${receiptsAwaiting._count} شيك دققه المحاسب`} />
        <Tile href="/requests" icon={HandCoins} tone={pendingRequests > 0 ? "orange" : "blue"} label="طلبات مواد وعهد مفتوحة" value={String(pendingRequests)} unit="طلب" sub="طلبات المواد والعهد" />
        <Tile href="/messages?box=all" icon={MessagesSquare} tone="blue" label="مراسلات اليوم" value={String(messagesToday)} unit="رسالة" sub={unreadMine > 0 ? `${unreadMine} رسالة لك لم تُقرأ` : "كل المراسلات"} />
        <Tile href="/cheques" icon={NotebookTabs} tone={chequesWeek._count > 0 ? "red" : "ink"} label="شيكات تستحق خلال أسبوع" value={n0.format(chequesWeek._sum.amount ?? 0)} unit="دينار" sub={`${chequesWeek._count} شيك`} />
        <Tile href="/guarantees" icon={ShieldAlert} tone={expiringGuarantees > 0 ? "red" : "green"} label="كفالات تنتهي خلال شهر" value={String(expiringGuarantees)} unit="كفالة" sub="الكفالات" />
      </div>

      <section className="mt-8 grid gap-4 lg:grid-cols-2">
        <div className="card p-5">
          <h2 className="mb-3 flex items-center gap-2 text-[22px] font-bold"><ShieldAlert className="h-6 w-6" aria-hidden /> ملخص الكفالات القائمة</h2>
          {guaranteesActive.length === 0 ? (
            <p className="text-[17px] text-ink-soft">لا توجد كفالات قائمة</p>
          ) : (
            <ul className="space-y-2 text-[17px]">
              {guaranteesActive.map((g) => (
                <li key={g.type} className="flex justify-between gap-3 rounded-2xl bg-canvas px-4 py-3">
                  <span className="font-bold">{GUARANTEE_TYPE[g.type] ?? g.type} <span className="text-ink-soft">({g._count})</span></span>
                  <span className="num font-bold">{n0.format(g._sum.amount ?? 0)} د.أ</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="card p-5">
          <h2 className="mb-3 flex items-center gap-2 text-[22px] font-bold"><NotebookTabs className="h-6 w-6" aria-hidden /> آخر تقارير الإنجاز اليومية</h2>
          {diaries.length === 0 ? (
            <p className="text-[17px] text-ink-soft">لا توجد يوميات بعد</p>
          ) : (
            <ul className="space-y-2">
              {diaries.map((d) => (
                <li key={d.id}>
                  <Link href={`/tenders/${d.tender.id}?tab=diary`} className="pressable block rounded-2xl bg-canvas px-4 py-3">
                    <span className="block text-[16px] font-bold">{d.tender.name} — <span className="num">{fmtDate(d.date)}</span></span>
                    <span className="line-clamp-2 text-[15px] text-ink-soft">{d.workDone}{d.workforce ? ` — ${d.workforce} عامل` : ""}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {finished.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-[24px] font-bold">ربحية المشاريع المسلّمة نهائياً</h2>
          <ul className="stagger grid gap-3 sm:grid-cols-2">
            {finished.map((t) => {
              const p = profits.get(t.id)!;
              return (
                <li key={t.id}>
                  <Link href={`/tenders/${t.id}`} className="pressable card block p-5">
                    <span className="block text-[18px] font-bold">{t.name}</span>
                    <span className={clsx("num mt-2 block text-[28px] font-bold", p.profit >= 0 ? "text-[#146c2e]" : "text-[#b00012]")}>{n0.format(p.profit)} د.أ</span>
                    <span className="text-[15px] font-semibold text-ink-soft">مقبوض <span className="num">{n0.format(p.received)}</span> − مصاريف <span className="num">{n0.format(p.expenses)}</span> · هامش <span className="num">{p.margin}%</span></span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="mt-8">
        <h2 className="mb-3 text-[24px] font-bold">نسبة إنجاز المشاريع</h2>
        {projects.length === 0 ? (
          <p className="card card-pad text-[18px] text-ink-soft">لا توجد مشاريع جارية حالياً</p>
        ) : (
          <ul className="stagger space-y-3">
            {projects.map((p) => (
              <li key={p.id}>
                <Link href={`/tenders/${p.id}`} className="pressable card block p-5">
                  <span className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-[19px] font-bold leading-snug">
                      {p.name}
                      <span className="mt-1 block text-[16px] font-semibold text-[#0058b0]">المرحلة: {phaseLabel(p)}</span>
                    </span>
                    <span className="num text-[26px] font-bold text-[#0058b0]">{Math.round(p.progress)}%</span>
                  </span>
                  <span className="mt-3 block h-4 overflow-hidden rounded-full bg-black/[0.08]" role="progressbar" aria-valuenow={p.progress} aria-valuemin={0} aria-valuemax={100}>
                    <span className="block h-full rounded-full bg-[#0058b0]" style={{ width: `${Math.max(0, Math.min(100, p.progress))}%` }} />
                  </span>
                  <span className="mt-2 block text-[16px] font-semibold text-ink-soft">
                    مدير المشروع: {p.manager?.name ?? "—"} · قيمة العقد <span className="num">{n0.format((p.awardedValue ?? 0) + p.variationTotal)}</span> د.أ
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Link href="/audit" className="pressable card mt-6 flex items-center gap-4 p-5">
        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-black/[0.06]">
          <ScrollText className="h-6 w-6" aria-hidden />
        </span>
        <span className="flex-1">
          <span className="block text-[19px] font-bold">سجل الرقابة والتدقيق</span>
          <span className="block text-[16px] font-semibold text-ink-soft">كل عملية في النظام: من قام بها ومتى وماذا تغيّر</span>
        </span>
        <ChevronLeft className="h-6 w-6 text-ink-soft" aria-hidden />
      </Link>
    </div>
  );
}

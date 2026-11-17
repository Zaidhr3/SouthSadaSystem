import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { Briefcase, Plus, Search } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { can, tenderScope } from "@/lib/permissions";
import { PRE_AWARD_STATUSES, PROJECT_STATUSES, TENDER_STATUS } from "@/lib/labels";
import { currentPhase, phaseLabel, phaseStatus, type PhaseNo } from "@/lib/project-phase";
import { PhaseStepper } from "@/components/phase-stepper";
import { daysUntil, fmtDate, relativeDays } from "@/lib/format";
import { Badge, Card, EmptyState, Money, PageHeader, ProgressBar, StatusBadge } from "@/components/ui";
import clsx from "clsx";
import { ARCHIVE_STAGE } from "@/lib/archive";

export const metadata = { title: "العطاءات والمشاريع" };

const VIEWS = [
  { key: "all", label: "الكل" },
  { key: "pipeline", label: "قيد الدراسة والتقديم" },
  { key: "projects", label: "المشاريع المحالة" },
  { key: "lost", label: "غير المحالة والملغاة" },
  { key: "private", label: "المشاريع الخاصة" },
  { key: "archive", label: "الأرشيف" },
];

export default async function TendersPage({ searchParams }: { searchParams: { view?: string; q?: string } }) {
  const user = await requireUser();
  const view = searchParams.view ?? (user.role === "PM" ? "projects" : "all");
  const q = (searchParams.q ?? "").trim();

  const where: Prisma.TenderWhereInput = { ...tenderScope(user) };
  if (view === "pipeline") where.status = { in: PRE_AWARD_STATUSES };
  if (view === "projects") where.status = { in: PROJECT_STATUSES };
  if (view === "lost") where.status = { in: ["LOST", "CANCELLED"] };
  if (view === "private") where.kind = "PRIVATE";
  // الأرشيف منفصل: المشاريع المؤرشفة لا تزحم القوائم اليومية
  where.archiveStage = view === "archive" ? { gt: 0 } : 0;
  if (q) where.OR = [{ name: { contains: q } }, { number: { contains: q } }, { entity: { contains: q } }, { location: { contains: q } }];

  const tenders = await db.tender.findMany({
    where,
    include: { manager: { select: { name: true } }, _count: { select: { boqItems: true } }, guarantees: { select: { type: true, status: true, expiryDate: true } }, claims: { select: { type: true, status: true } } },
    orderBy: [{ deadline: "desc" }],
    take: 300,
  });

  return (
    <>
      <PageHeader
        title={user.role === "PM" ? "مشاريعي" : "العطاءات والمشاريع"}
        subtitle="دورة حياة العطاء من شراء الوثائق حتى الاستلام النهائي"
        actions={
          can.manageTenders(user.role) && (
            <Link href="/tenders/new" className="btn-primary">
              <Plus className="h-4 w-4" /> عطاء جديد
            </Link>
          )
        }
      />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <nav className="flex gap-1 overflow-x-auto rounded-2xl bg-black/[0.04] p-1">
          {VIEWS.map((v) => (
            <Link
              key={v.key}
              href={`/tenders?view=${v.key}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
              className={clsx("shrink-0 rounded-xl px-3.5 py-2 text-sm font-semibold transition", view === v.key ? "bg-white shadow-card" : "text-ink-muted hover:text-ink")}
            >
              {v.label}
            </Link>
          ))}
        </nav>
        <form className="relative sm:w-72">
          <input type="hidden" name="view" value={view} />
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
          <input name="q" defaultValue={q} placeholder="بحث بالاسم أو الرقم أو الجهة" className="input ps-9" />
        </form>
      </div>

      <Card pad={false}>
        {tenders.length === 0 ? (
          <EmptyState icon={Briefcase} title="لا توجد نتائج" hint="جرّب تغيير الفلتر أو كلمات البحث" />
        ) : (
          <>
          {/* الجوال: بطاقات واضحة بلمسة واحدة */}
          <ul className="divide-y divide-line md:hidden">
            {tenders.map((t) => {
              const pre = PRE_AWARD_STATUSES.includes(t.status);
              const proj = PROJECT_STATUSES.includes(t.status);
              const p = currentPhase(t);
              const d = daysUntil(t.deadline);
              return (
                <li key={t.id}>
                  <Link href={`/tenders/${t.id}`} className="pressable block px-4 py-3.5">
                    <span className="flex items-start justify-between gap-3">
                      <span className="min-w-0">
                        <span className="block font-bold leading-snug text-ink">{t.name}</span>
                        <span className="mt-0.5 block truncate text-xs text-ink-muted">{t.entity} — {t.number}</span>
                      </span>
                      <StatusBadge map={TENDER_STATUS} value={t.status} />{t.archiveStage > 0 && <Badge tone={ARCHIVE_STAGE[t.archiveStage].tone} className="ms-1">{ARCHIVE_STAGE[t.archiveStage].label}</Badge>}{t.kind === "PRIVATE" && <Badge tone="orange" className="ms-1">خاص</Badge>}
                    </span>
                    {proj && (
                      <span className="mt-2.5 flex items-center justify-between gap-3">
                        <PhaseStepper compact done={phaseStatus(t)} current={typeof p === "number" && p > 0 ? (p as PhaseNo) : null} closed={t.status === "CLOSED"} />
                        {t.status !== "CLOSED" && <span className="truncate text-xs font-semibold text-ink-soft">{phaseLabel(t)}</span>}
                      </span>
                    )}
                    <span className="mt-2 flex items-center justify-between gap-3 text-sm">
                      {pre ? (
                        <span className="text-ink-soft">آخر موعد {fmtDate(t.deadline)}{d >= 0 && t.status !== "SUBMITTED" ? <Badge tone={d <= 3 ? "red" : d <= 7 ? "orange" : "gray"} className="ms-2">{relativeDays(t.deadline)}</Badge> : null}</span>
                      ) : proj ? (
                        <ProgressBar value={t.progress} className="w-32" />
                      ) : (
                        <span />
                      )}
                      {t.awardedValue ? <Money value={t.awardedValue} strong /> : t.bidAmount ? <Money value={t.bidAmount} className="text-ink-muted" /> : null}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
          <div className="hidden overflow-x-auto md:block">
            <table className="tbl">
              <thead>
                <tr>
                  <th>العطاء</th>
                  <th>الجهة</th>
                  <th>الحالة</th>
                  <th>آخر موعد / الإنجاز</th>
                  <th>القيمة</th>
                  <th>مدير المشروع</th>
                </tr>
              </thead>
              <tbody>
                {tenders.map((t) => {
                  const pre = PRE_AWARD_STATUSES.includes(t.status);
                  const d = daysUntil(t.deadline);
                  return (
                    <tr key={t.id}>
                      <td className="max-w-[320px]">
                        <Link href={`/tenders/${t.id}`} className="block font-bold text-ink hover:text-accent">
                          {t.name}
                        </Link>
                        <span className="text-xs text-ink-muted">
                          {t.number} — {t.location ?? ""} {t._count.boqItems > 0 && `— ${t._count.boqItems} بند`}
                        </span>
                      </td>
                      <td className="text-ink-soft">{t.entity}</td>
                      <td>
                        <StatusBadge map={TENDER_STATUS} value={t.status} />{t.archiveStage > 0 && <Badge tone={ARCHIVE_STAGE[t.archiveStage].tone} className="ms-1">{ARCHIVE_STAGE[t.archiveStage].label}</Badge>}{t.kind === "PRIVATE" && <Badge tone="orange" className="ms-1">خاص</Badge>}
                        {PROJECT_STATUSES.includes(t.status) && (
                          <span className="mt-1.5 flex flex-col gap-1">
                            <PhaseStepper compact done={phaseStatus(t)} current={(() => { const p = currentPhase(t); return typeof p === "number" && p > 0 ? (p as PhaseNo) : null; })()} closed={t.status === "CLOSED"} />
                            {t.status !== "CLOSED" && <span className="text-xs font-semibold text-ink-muted">{phaseLabel(t)}</span>}
                          </span>
                        )}
                      </td>
                      <td className="min-w-[150px]">
                        {pre ? (
                          <span className="flex flex-col">
                            <span className="text-sm">{fmtDate(t.deadline)}</span>
                            {d >= 0 && t.status !== "SUBMITTED" && <Badge tone={d <= 3 ? "red" : d <= 7 ? "orange" : "gray"} className="w-fit">{relativeDays(t.deadline)}</Badge>}
                          </span>
                        ) : PROJECT_STATUSES.includes(t.status) ? (
                          <ProgressBar value={t.progress} />
                        ) : (
                          <span className="text-ink-faint">—</span>
                        )}
                      </td>
                      <td>{t.awardedValue ? <Money value={t.awardedValue} strong /> : t.bidAmount ? <Money value={t.bidAmount} className="text-ink-muted" /> : "—"}</td>
                      <td className="text-ink-soft">{t.manager?.name ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </>
        )}
      </Card>
    </>
  );
}

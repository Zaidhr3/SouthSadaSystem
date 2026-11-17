import Link from "next/link";
import clsx from "clsx";
import type { Prisma } from "@prisma/client";
import { Inbox, ShieldAlert, Sparkles } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { see } from "@/lib/permissions";
import { OPEN_QUOTE, QUOTE_STATUS } from "@/lib/quotes";
import { fmtDate } from "@/lib/format";
import { Badge, Card, EmptyState, Money, PageHeader, StatCard, StatusBadge } from "@/components/ui";

export const metadata = { title: "طلبات التسعير من الموقع" };

/** الطلب «بانتظاري» حسب دور المستخدم في دورة الاعتماد */
function mineWhere(role: string, userId: number): Prisma.QuoteRequestWhereInput {
  if (role === "PM") return { assignedPmId: userId, status: { in: ["PM_REVIEW", "RETURNED"] } };
  if (role === "ACCOUNTANT") return { status: "ACCOUNTANT_REVIEW" };
  if (role === "ADMIN") return { status: "ADMIN_REVIEW" };
  return { status: { in: OPEN_QUOTE } };
}

export default async function QuotesPage({ searchParams }: { searchParams: { view?: string } }) {
  const user = await requireUser(see.quotes);
  const view = searchParams.view ?? "mine";
  const scope: Prisma.QuoteRequestWhereInput = user.role === "PM" ? { assignedPmId: user.id } : {};
  const where: Prisma.QuoteRequestWhereInput =
    view === "mine" ? mineWhere(user.role, user.id) : view === "open" ? { ...scope, status: { in: OPEN_QUOTE } } : view === "spam" ? { status: "SPAM" } : view === "done" ? { ...scope, status: { in: ["APPROVED", "REJECTED"] } } : { ...scope, NOT: { status: "SPAM" } };
  const [rows, counts, pms] = await Promise.all([
    db.quoteRequest.findMany({ where, orderBy: { createdAt: "desc" }, take: 200 }),
    db.quoteRequest.groupBy({ by: ["status"], where: scope, _count: true }),
    db.user.findMany({ where: { role: { in: ["PM", "ADMIN"] } }, select: { id: true, name: true } }),
  ]);
  const c = (s: string[]) => counts.filter((x) => s.includes(x.status)).reduce((a, x) => a + x._count, 0);
  const pmName = new Map(pms.map((p) => [p.id, p.name]));
  const views = [
    ["mine", "بانتظاري"],
    ["open", "قيد المعالجة"],
    ["done", "المعتمدة والمرفوضة"],
    ["all", "الكل"],
    ...(user.role !== "PM" ? [["spam", `الوهمية المحجوزة (${c(["SPAM"])})`]] : []),
  ];

  return (
    <>
      <PageHeader title="طلبات التسعير من الموقع" subtitle="كل طلب «عرض سعر» من موقع الشركة يُفحص آلياً ضد الطلبات الوهمية، ثم يمر: مدير المشروع ← المحاسب ← الإدارة" />
      <div className="mb-5 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard label="لدى مديري المشاريع" value={c(["PM_REVIEW", "RETURNED"])} icon={Inbox} tone="blue" />
        <StatCard label="لدى المحاسب" value={c(["ACCOUNTANT_REVIEW"])} icon={Inbox} tone="orange" />
        <StatCard label="بانتظار اعتماد الإدارة" value={c(["ADMIN_REVIEW"])} icon={Sparkles} tone="green" />
        <StatCard label="وهمية محجوزة" value={c(["SPAM"])} icon={ShieldAlert} tone="gray" />
      </div>
      <nav className="mb-4 flex gap-1 overflow-x-auto rounded-2xl bg-black/[0.04] p-1">
        {views.map(([k, label]) => (
          <Link key={k} href={`/quotes?view=${k}`} className={clsx("whitespace-nowrap rounded-xl px-3 py-1.5 text-sm font-bold transition", view === k ? "bg-white text-accent shadow-card" : "text-ink-muted hover:text-ink")}>
            {label}
          </Link>
        ))}
      </nav>
      <Card pad={false}>
        {rows.length === 0 ? (
          <EmptyState icon={Inbox} title="لا توجد طلبات هنا" hint="الطلبات الجديدة من الموقع تظهر تلقائياً وتصلك بتنبيه" />
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>الطلب</th>
                  <th>العميل</th>
                  <th>المشروع</th>
                  <th>مدير المشروع</th>
                  <th className="text-end">السعر المقترح</th>
                  <th>الحالة</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((q) => (
                  <tr key={q.id}>
                    <td>
                      <Link href={`/quotes/${q.id}`} className="num font-bold hover:text-accent">{q.ref}</Link>
                      <span className="block text-xs text-ink-muted">{fmtDate(q.createdAt)}</span>
                    </td>
                    <td>
                      <span className="font-semibold">{q.name}</span>
                      <span className="num block text-xs text-ink-muted">{q.phone}</span>
                    </td>
                    <td className="max-w-[260px]">
                      {q.projectType} {q.city && <span className="text-ink-muted">— {q.city}</span>}
                      <span className="block truncate text-xs text-ink-muted">{q.details}</span>
                    </td>
                    <td>{q.assignedPmId ? pmName.get(q.assignedPmId) : <span className="text-ink-faint">—</span>}</td>
                    <td className="text-end">{q.pmPrice != null ? <Money value={q.pmPrice} /> : "—"}</td>
                    <td>
                      <StatusBadge map={QUOTE_STATUS} value={q.status} />
                      {q.status === "SPAM" && <Badge tone="gray" className="ms-1">{q.spamScore}%</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

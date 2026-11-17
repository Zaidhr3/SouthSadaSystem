import Link from "next/link";
import clsx from "clsx";
import { GitPullRequestArrow } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { tenderScope } from "@/lib/permissions";
import { VO_STATUS } from "@/lib/labels";
import { attachmentsMap } from "@/lib/uploads";
import { Card, Money, PageHeader, StatCard } from "@/components/ui";
import { VariationTable } from "@/components/modules";

export const metadata = { title: "أوامر التغيير" };

export default async function VariationsPage({ searchParams }: { searchParams: { status?: string } }) {
  const user = await requireUser();
  const status = searchParams.status && searchParams.status in VO_STATUS ? searchParams.status : undefined;
  const scope = { tender: tenderScope(user) };
  const [rows, agg] = await Promise.all([
    db.variationOrder.findMany({ where: { ...scope, ...(status ? { status } : {}) }, include: { tender: { select: { id: true, name: true } } }, orderBy: [{ status: "desc" }, { requestDate: "desc" }] }),
    db.variationOrder.groupBy({ by: ["status"], where: scope, _sum: { amount: true, extraDays: true }, _count: true }),
  ]);
  const atts = await attachmentsMap("variation", rows.map((r) => r.id));
  const s = (k: string) => agg.find((a) => a.status === k);

  return (
    <>
      <PageHeader title="أوامر التغيير والأعمال الإضافية" subtitle="تُسجل من صفحة المشروع — الاعتماد يعدّل قيمة العقد ومدته تلقائياً ويُبلغ مدير المشروع والمحاسب" />
      <div className="stagger mb-5 grid grid-cols-2 gap-4 xl:grid-cols-3">
        <StatCard label="بانتظار الاعتماد" value={<Money value={s("PENDING")?._sum.amount ?? 0} />} sub={`${s("PENDING")?._count ?? 0} أوامر`} icon={GitPullRequestArrow} tone="orange" />
        <StatCard label="معتمدة (أُضيفت للعقود)" value={<Money value={s("APPROVED")?._sum.amount ?? 0} />} sub={`${s("APPROVED")?._count ?? 0} أوامر — ${s("APPROVED")?._sum.extraDays ?? 0} يوماً إضافية`} tone="green" />
        <StatCard label="مرفوضة" value={s("REJECTED")?._count ?? 0} tone="gray" />
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        <Link href="/variations" className={clsx("btn-sm", !status ? "btn-primary" : "btn-secondary")}>الكل</Link>
        {Object.entries(VO_STATUS).map(([k, v]) => (
          <Link key={k} href={`/variations?status=${k}`} className={clsx("btn-sm", status === k ? "btn-primary" : "btn-secondary")}>{v.label}</Link>
        ))}
      </div>
      <Card pad={false}>
        <VariationTable rows={rows} user={user} atts={atts} showTender />
      </Card>
    </>
  );
}

import Link from "next/link";
import type { Prisma } from "@prisma/client";
import clsx from "clsx";
import { ShieldCheck } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { can, see } from "@/lib/permissions";
import { GUARANTEE_TYPE } from "@/lib/labels";
import { attachmentsMap } from "@/lib/uploads";
import { Card, Money, PageHeader, StatCard } from "@/components/ui";
import { GuaranteeTable } from "@/components/tables";

export const metadata = { title: "الكفالات" };

export default async function GuaranteesPage({ searchParams }: { searchParams: { type?: string; show?: string } }) {
  const user = await requireUser(see.finance);
  const type = searchParams.type && searchParams.type in GUARANTEE_TYPE ? searchParams.type : undefined;
  const showAll = searchParams.show === "all";
  const where: Prisma.GuaranteeWhereInput = { ...(type ? { type } : {}), ...(showAll ? {} : { status: { in: ["ISSUED", "SUBMITTED", "RETRIEVED"] } }) };
  const rows = await db.guarantee.findMany({ where, include: { tender: { select: { id: true, name: true, number: true } } }, orderBy: [{ expiryDate: "asc" }] });
  const atts = await attachmentsMap("guarantee", rows.map((r) => r.id));
  const active = await db.guarantee.groupBy({ by: ["type"], where: { status: { in: ["ISSUED", "SUBMITTED"] } }, _sum: { amount: true }, _count: true });
  const awaitingReturn = await db.guarantee.count({ where: { status: "RETRIEVED" } });
  const sumOf = (t: string) => active.find((a) => a.type === t);

  const link = (p: Record<string, string | undefined>) => {
    const s = new URLSearchParams(Object.entries({ type, show: showAll ? "all" : undefined, ...p }).filter(([, v]) => v) as [string, string][]);
    return `/guarantees?${s}`;
  };

  return (
    <>
      <PageHeader title="الكفالات" subtitle="كفالات الدخول وحسن التنفيذ والصيانة — من الإصدار حتى الإعادة للبنك. تُضاف الكفالات من صفحة العطاء." />
      <div className="mb-5 grid grid-cols-2 gap-4 xl:grid-cols-4">
        {Object.entries(GUARANTEE_TYPE).map(([k, label]) => (
          <StatCard key={k} label={`${label} سارية`} value={<Money value={sumOf(k)?._sum.amount ?? 0} />} sub={`${sumOf(k)?._count ?? 0} كفالات`} icon={ShieldCheck} tone="purple" />
        ))}
        <StatCard label="مستردة بانتظار الإعادة للبنك" value={awaitingReturn} sub="أعدها للبنك لفك الحجز" tone={awaitingReturn ? "orange" : "gray"} />
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        <Link href={link({ type: undefined })} className={clsx("btn-sm", !type ? "btn-primary" : "btn-secondary")}>الكل</Link>
        {Object.entries(GUARANTEE_TYPE).map(([k, v]) => (
          <Link key={k} href={link({ type: k })} className={clsx("btn-sm", type === k ? "btn-primary" : "btn-secondary")}>
            {v}
          </Link>
        ))}
        <Link href={link({ show: showAll ? undefined : "all" })} className="btn-ghost btn-sm ms-auto">
          {showAll ? "إخفاء المعادة للبنك" : "إظهار الأرشيف"}
        </Link>
      </div>
      <Card pad={false}>
        <GuaranteeTable rows={rows} user={user} atts={atts} showTender />
      </Card>
    </>
  );
}

import { userSees } from "@/lib/brand";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, Landmark, TrendingDown } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { projectCashFlow } from "@/lib/cashflow";
import { fmtDate } from "@/lib/format";
import { Badge, Card, EmptyState, Money, PageHeader, StatCard } from "@/components/ui";
import { BalanceProjectionChart } from "@/components/charts";

export const metadata = { title: "التدفق النقدي المتوقع" };

export default async function CashflowPage() {
  const viewer = await requireUser();
  if (!(await userSees(viewer, "bank"))) redirect("/");
  const p = await projectCashFlow(30);

  return (
    <>
      <PageHeader
        title="التدفق النقدي المتوقع — 30 يوماً"
        subtitle={`سري — للمدير العام فقط. الوارد المتوقع للمطالبات = تاريخ التقديم + متوسط مدة القبض التاريخية (${p.avgTurnaround} يوماً). المستحقات المتأخرة تُحتسب اليوم.`}
      />
      <div className="stagger mb-5 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard label="الرصيد الحالي" value={<Money value={p.opening} />} icon={Landmark} />
        <StatCard label="وارد متوقع" value={<Money value={p.totalIn} />} icon={ArrowDownLeft} tone="green" />
        <StatCard label="صادر متوقع" value={<Money value={p.totalOut} />} icon={ArrowUpRight} tone="orange" />
        <StatCard
          label="أدنى رصيد متوقع"
          value={<Money value={p.minBalance} />}
          sub={`بتاريخ ${fmtDate(p.minDate)} — بعد 30 يوماً: ${new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(p.closing)} د.أ`}
          icon={TrendingDown}
          tone={p.minBalance < 0 ? "red" : "blue"}
        />
      </div>

      <Card title="الرصيد المتوقع يومياً" className="mb-5">
        <BalanceProjectionChart data={p.days.map((d) => ({ date: fmtDate(d.date).slice(0, 5), full: fmtDate(d.date), balance: d.balance, inflow: d.inflow, outflow: d.outflow }))} />
      </Card>

      <Card title="الحركات المتوقعة" pad={false} className="pt-5 [&>div:first-child]:px-6">
        {p.items.length === 0 ? (
          <EmptyState title="لا توجد حركات متوقعة خلال 30 يوماً" />
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>التاريخ المتوقع</th>
                  <th>البيان</th>
                  <th>المصدر</th>
                  <th className="text-end">وارد</th>
                  <th className="text-end">صادر</th>
                </tr>
              </thead>
              <tbody>
                {p.items.map((x, i) => (
                  <tr key={i}>
                    <td className="num whitespace-nowrap">
                      {fmtDate(x.date)} {x.overdue && <Badge tone="red">متأخر</Badge>}
                    </td>
                    <td><Link href={x.href} className="hover:text-accent">{x.label}</Link></td>
                    <td><Badge>{x.source}</Badge></td>
                    <td className="text-end">{x.type === "IN" ? <Money value={x.amount} className="text-good" strong /> : ""}</td>
                    <td className="text-end">{x.type === "OUT" ? <Money value={x.amount} strong /> : ""}</td>
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

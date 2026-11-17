import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { BOQ_CATEGORY, TENDER_STATUS } from "@/lib/labels";
import { searchPriceHistory } from "@/lib/pricing";
import { fmtDate } from "@/lib/format";
import { Card, Money, PageHeader, StatCard, StatusBadge } from "@/components/ui";
import { PriceTrendChart } from "@/components/charts";

export const metadata = { title: "سجل سعر بند" };
const nf = new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 });

export default async function PriceItemPage({ searchParams }: { searchParams: { key?: string } }) {
  await requireUser();
  const key = searchParams.key ?? "";
  const [desc] = key.split("|");
  if (!desc) notFound();
  const group = (await searchPriceHistory(desc, { limit: 1000 })).find((g) => g.key === key);
  if (!group) notFound();

  const chronological = [...group.occurrences].reverse();
  const chart = chronological.map((o) => ({ label: `${fmtDate(o.date).slice(3)}`, price: o.unitPrice, tender: o.tenderName }));

  return (
    <>
      <PageHeader back={{ href: "/pricing", label: "مكتبة الأسعار" }} title={group.description} subtitle={`${BOQ_CATEGORY[group.category] ?? group.category} — لكل ${group.unit}`} />
      <div className="mb-5 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard label={`آخر سعر (${group.latestYear})`} value={<Money value={group.latestPrice} />} />
        <StatCard label={`أقدم سعر (${group.oldestYear})`} value={<Money value={group.oldestPrice} />} />
        <StatCard label="التغير الكلي" value={`${group.changePct >= 0 ? "+" : ""}${group.changePct.toFixed(1)}%`} tone={group.changePct > 0 ? "orange" : "green"} sub={`سنوياً ${group.annualPct >= 0 ? "+" : ""}${group.annualPct.toFixed(1)}%`} />
        <StatCard label="السعر المقترح الآن" value={<Money value={group.suggestedPrice} />} tone="blue" sub="آخر سعر معدّل باتجاه التضخم" />
      </div>
      <Card title="اتجاه السعر عبر العطاءات" className="mb-5">
        {chart.length > 1 ? <PriceTrendChart data={chart} unit={group.unit} /> : <p className="py-8 text-center text-sm text-ink-muted">سُعّر مرة واحدة فقط</p>}
      </Card>
      <Card title="كل مرات التسعير" pad={false} className="pt-5 [&>div:first-child]:px-6">
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>العطاء</th>
                <th>التاريخ</th>
                <th>النتيجة</th>
                <th>المورد / المواصفات</th>
                <th className="text-end">الكمية</th>
                <th className="text-end">سعر الوحدة</th>
              </tr>
            </thead>
            <tbody>
              {group.occurrences.map((o) => (
                <tr key={o.boqItemId}>
                  <td>
                    <Link href={`/tenders/${o.tenderId}?tab=boq`} className="font-semibold hover:text-accent">
                      {o.tenderName}
                    </Link>
                    <span className="block text-xs text-ink-muted">{o.entity}</span>
                  </td>
                  <td className="num">{fmtDate(o.date)}</td>
                  <td>
                    <StatusBadge map={TENDER_STATUS} value={o.status} />
                  </td>
                  <td className="text-ink-soft">{[o.supplier, o.specs].filter(Boolean).join(" — ") || "—"}</td>
                  <td className="num text-end">{nf.format(o.quantity)}</td>
                  <td className="num text-end font-bold">{nf.format(o.unitPrice)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

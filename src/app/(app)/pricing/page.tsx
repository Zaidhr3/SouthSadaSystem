import Link from "next/link";
import { Library, Search, TrendingDown, TrendingUp } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { BOQ_CATEGORY } from "@/lib/labels";
import { groupOccurrences, normalizeText, searchPriceHistory, type PriceGroup } from "@/lib/pricing";
import { Card, EmptyState, PageHeader, StatCard } from "@/components/ui";
import clsx from "clsx";

export const metadata = { title: "مكتبة الأسعار الذكية" };

const nf = new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 });

async function allGroups(category?: string): Promise<PriceGroup[]> {
  const items = await db.boqItem.findMany({
    where: category ? { category } : {},
    include: { tender: { select: { id: true, name: true, number: true, entity: true, purchaseDate: true, status: true } } },
    take: 3000,
  });
  return groupOccurrences(
    items.map((i) => ({
      boqItemId: i.id,
      tenderId: i.tender.id,
      tenderName: i.tender.name,
      tenderNumber: i.tender.number,
      entity: i.tender.entity,
      date: i.tender.purchaseDate.toISOString(),
      year: i.tender.purchaseDate.getUTCFullYear(),
      status: i.tender.status,
      description: i.description,
      unit: i.unit,
      category: i.category,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      supplier: i.supplier,
      specs: i.specs,
    })),
    (r) => normalizeText(r.description) + "|" + r.unit,
  );
}

export default async function PricingPage({ searchParams }: { searchParams: { q?: string; cat?: string } }) {
  await requireUser();
  const q = (searchParams.q ?? "").trim();
  const cat = searchParams.cat && searchParams.cat in BOQ_CATEGORY ? searchParams.cat : undefined;
  const groups = q ? await searchPriceHistory(q, { category: cat, limit: 1000 }) : await allGroups(cat);
  const [itemCount, tenderCount] = await Promise.all([db.boqItem.count(), db.tender.count({ where: { boqItems: { some: {} } } })]);
  const multi = groups.filter((g) => g.count > 1);
  const avgAnnual = multi.length ? multi.reduce((s, g) => s + g.annualPct, 0) / multi.length : 0;

  return (
    <>
      <PageHeader title="مكتبة الأسعار الذكية" subtitle="كل بند سعّرته الشركة مفهرس تلقائياً — تتبع اتجاهات الأسعار وحماية هوامش الربح" />

      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="بنود مفهرسة" value={nf.format(itemCount)} sub={`من ${tenderCount} جداول كميات`} icon={Library} />
        <StatCard label="مواد فريدة" value={nf.format(groups.length)} sub={q || cat ? "ضمن نتائج البحث" : "في الكتالوج"} />
        <StatCard label="متوسط التضخم السنوي" value={`${avgAnnual >= 0 ? "+" : ""}${avgAnnual.toFixed(1)}%`} sub="للمواد المسعّرة أكثر من مرة" tone={avgAnnual > 0 ? "orange" : "green"} />
      </div>

      <form className="mb-4 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
          <input name="q" defaultValue={q} placeholder="ابحث عن مادة: حديد، خرسانة B300، سخان أريستون، خزان ستانلس..." className="input ps-9" />
        </div>
        <select name="cat" defaultValue={cat ?? ""} className="input sm:w-52">
          <option value="">كل التصنيفات</option>
          {Object.entries(BOQ_CATEGORY).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <button className="btn-primary">بحث</button>
      </form>

      <Card pad={false}>
        {groups.length === 0 ? (
          <EmptyState icon={Library} title="لا توجد بنود مطابقة" hint="البنود تُضاف تلقائياً عند تسعير جداول الكميات" />
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>المادة / البند</th>
                  <th>التصنيف</th>
                  <th>الوحدة</th>
                  <th className="text-end">مرات التسعير</th>
                  <th className="text-end">آخر سعر</th>
                  <th className="text-end">المدى</th>
                  <th className="text-end">التغير الكلي</th>
                  <th className="text-end">سنوياً</th>
                </tr>
              </thead>
              <tbody>
                {groups.slice(0, 300).map((g) => (
                  <tr key={g.key}>
                    <td className="max-w-[380px]">
                      <Link href={`/pricing/item?key=${encodeURIComponent(g.key)}`} className="font-semibold hover:text-accent">
                        {g.description}
                      </Link>
                      <span className="block text-xs text-ink-muted">
                        {g.oldestYear === g.latestYear ? g.latestYear : `${g.oldestYear} – ${g.latestYear}`}
                      </span>
                    </td>
                    <td className="text-ink-soft">{BOQ_CATEGORY[g.category] ?? g.category}</td>
                    <td>{g.unit}</td>
                    <td className="num text-end">{g.count}</td>
                    <td className="num text-end font-bold">{nf.format(g.latestPrice)}</td>
                    <td className="num text-end text-ink-muted">
                      {g.count > 1 ? `${nf.format(g.minPrice)} – ${nf.format(g.maxPrice)}` : "—"}
                    </td>
                    <td className="text-end">
                      {g.count > 1 ? (
                        <span className={clsx("inline-flex items-center gap-1 font-bold", g.changePct > 0 ? "text-warn" : g.changePct < 0 ? "text-good" : "text-ink-muted")}>
                          {g.changePct > 0 ? <TrendingUp className="h-3.5 w-3.5" /> : g.changePct < 0 ? <TrendingDown className="h-3.5 w-3.5" /> : null}
                          <span className="num">{`${g.changePct > 0 ? "+" : ""}${g.changePct.toFixed(1)}%`}</span>
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="num text-end text-ink-soft">{g.count > 1 && g.annualPct ? `${g.annualPct > 0 ? "+" : ""}${g.annualPct.toFixed(1)}%` : "—"}</td>
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

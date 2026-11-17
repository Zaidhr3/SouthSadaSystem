import { TrendingDown, TrendingUp } from "lucide-react";
import clsx from "clsx";
import type { ProjectProfit } from "@/lib/profit";
import { Card } from "./ui";

const nf = new Intl.NumberFormat("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 });

/** تقرير الربحية الختامي — يصدر تلقائياً بعد التسليم النهائي */
export function ProfitReport({ p, final, target }: { p: ProjectProfit; final: boolean; target?: number }) {
  const below = target != null && p.margin < target;
  const up = p.profit >= 0;
  const rows: [string, number, boolean?][] = [
    ["المطالبات المقبوضة", p.received],
    ...(p.retentionReleased ? ([["المحجوزات المستردة", p.retentionReleased]] as [string, number][]) : []),
    ["ينزل: مقاولو الباطن", -p.subcontract],
    ["ينزل: المواد والمشتريات", -p.materials],
    ["ينزل: باقي المصاريف (أجور، آليات، رسوم…)", -p.other],
  ];
  return (
    <Card title={final ? "تقرير الربحية الختامي (بعد التسليم النهائي)" : "الربحية حتى تاريخه"} className="print:break-inside-avoid">
      <dl className="divide-y divide-line text-sm">
        {rows.map(([l, v]) => (
          <div key={l} className="flex justify-between gap-3 py-2">
            <dt>{l}</dt>
            <dd className={clsx("num", v < 0 && "text-bad")}>{v < 0 ? `(${nf.format(-v)})` : nf.format(v)}</dd>
          </div>
        ))}
      </dl>
      <div className={clsx("mt-3 flex items-center justify-between gap-3 rounded-2xl px-4 py-3 text-white", up ? "bg-[#146c2e]" : "bg-[#b00012]")}>
        <span className="flex items-center gap-2 font-bold">{up ? <TrendingUp className="h-5 w-5" /> : <TrendingDown className="h-5 w-5" />} صافي {up ? "الربح" : "الخسارة"}</span>
        <span className="text-end">
          <b className="num block text-lg">{nf.format(Math.abs(p.profit))} د.أ</b>
          <span className="num text-xs opacity-90">هامش {p.margin}%</span>
        </span>
      </div>
      {target != null && (
        <p className={clsx("mt-2 rounded-xl px-3 py-2 text-sm font-semibold", below ? "bg-bad-soft text-bad" : "bg-good-soft text-good")}>
          الهامش المستهدف {target}% — {below ? `أقل من المستهدف بـ ${Math.round((target - p.margin) * 10) / 10} نقطة` : "محقق أو أعلى"}
        </p>
      )}
      <p className="mt-2 text-xs text-ink-muted">المقبوض فعلياً − إجمالي مصاريف المشروع المسجلة (تشمل دفعات مقاولي الباطن والمشتريات تلقائياً).</p>
    </Card>
  );
}

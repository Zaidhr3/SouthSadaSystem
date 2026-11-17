"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from "recharts";

// لوحة ألوان مُتحقق منها لعمى الألوان (الترتيب ثابت)
const SERIES_1 = "#2a78d6"; // أزرق
const SERIES_2 = "#eb6834"; // برتقالي
const GRID = "#ececf0";
const AXIS = "#86868b";

const nf = new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 });
const cf = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

function TipBox({ title, rows }: { title: string; rows: { color?: string; label: string; value: string }[] }) {
  return (
    <div dir="rtl" className="min-w-[170px] rounded-xl border border-black/5 bg-white/95 px-3 py-2 text-xs shadow-pop backdrop-blur">
      <p className="mb-1 font-bold text-ink">{title}</p>
      {rows.map((r) => (
        <div key={r.label} className="flex items-center justify-between gap-4 py-0.5">
          <span className="flex items-center gap-1.5 text-ink-muted">
            {r.color && <span className="h-2.5 w-2.5 rounded-sm" style={{ background: r.color }} />}
            {r.label}
          </span>
          <span className="num font-bold text-ink">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

function Legend({ items }: { items: { color: string; label: string }[] }) {
  return (
    <div className="mb-3 flex flex-wrap gap-4 text-xs font-semibold text-ink-soft">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

export function CashFlowChart({ data, inLabel = "الوارد", outLabel = "الصادر" }: { data: { month: string; full: string; in: number; out: number }[]; inLabel?: string; outLabel?: string }) {
  return (
    <div>
      <Legend items={[{ color: SERIES_1, label: inLabel }, { color: SERIES_2, label: outLabel }]} />
      <div dir="ltr" className="h-[260px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} barGap={2} barCategoryGap="22%" margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis dataKey="month" reversed tick={{ fill: AXIS, fontSize: 11 }} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={8} height={28} />
            <YAxis orientation="right" tickFormatter={(v) => cf.format(v)} tick={{ fill: AXIS, fontSize: 11 }} axisLine={false} tickLine={false} width={44} />
            <Tooltip
              cursor={{ fill: "rgba(0,0,0,0.04)" }}
              content={({ active, payload }: TooltipProps<number, string>) =>
                active && payload?.length ? (
                  <TipBox
                    title={String(payload[0]?.payload.full ?? "")}
                    rows={[
                      { color: SERIES_1, label: inLabel, value: `${nf.format(Number(payload[0]?.payload.in ?? 0))} د.أ` },
                      { color: SERIES_2, label: outLabel, value: `${nf.format(Number(payload[0]?.payload.out ?? 0))} د.أ` },
                      { label: "الصافي", value: `${nf.format(Number(payload[0]?.payload.in ?? 0) - Number(payload[0]?.payload.out ?? 0))} د.أ` },
                    ]}
                  />
                ) : null
              }
            />
            <Bar dataKey="in" fill={SERIES_1} radius={[4, 4, 0, 0]} maxBarSize={18} animationDuration={500} />
            <Bar dataKey="out" fill={SERIES_2} radius={[4, 4, 0, 0]} maxBarSize={18} animationDuration={500} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** الرصيد البنكي المتوقع يومياً (سلسلة واحدة مع خط الصفر) */
export function BalanceProjectionChart({ data }: { data: { date: string; full: string; balance: number; inflow: number; outflow: number }[] }) {
  return (
    <div dir="ltr" className="h-[260px]">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 10, right: 8, left: 8, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis dataKey="date" reversed tick={{ fill: AXIS, fontSize: 11 }} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={12} />
          <YAxis orientation="right" tickFormatter={(v) => cf.format(v)} tick={{ fill: AXIS, fontSize: 11 }} axisLine={false} tickLine={false} width={48} />
          <ReferenceLine y={0} stroke="#e34948" strokeDasharray="4 4" />
          <Tooltip
            cursor={{ stroke: "#c7c7cc", strokeWidth: 1 }}
            content={({ active, payload }: TooltipProps<number, string>) => {
              const p = payload?.[0]?.payload as { full: string; balance: number; inflow: number; outflow: number } | undefined;
              return active && p ? (
                <TipBox
                  title={p.full}
                  rows={[
                    { color: SERIES_1, label: "الرصيد المتوقع", value: `${nf.format(p.balance)} د.أ` },
                    { label: "وارد", value: `${nf.format(p.inflow)} د.أ` },
                    { label: "صادر", value: `${nf.format(p.outflow)} د.أ` },
                  ]}
                />
              ) : null;
            }}
          />
          <Line type="stepAfter" dataKey="balance" stroke={SERIES_1} strokeWidth={2} dot={false} activeDot={{ r: 5 }} animationDuration={500} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** اتجاه سعر البند عبر السنوات */
export function PriceTrendChart({ data, unit }: { data: { label: string; price: number; tender: string }[]; unit: string }) {
  return (
    <div dir="ltr" className="h-[240px]">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 10, right: 8, left: 8, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis dataKey="label" reversed tick={{ fill: AXIS, fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis orientation="right" tickFormatter={(v) => nf.format(v)} tick={{ fill: AXIS, fontSize: 11 }} axisLine={false} tickLine={false} width={48} domain={["auto", "auto"]} />
          <Tooltip
            cursor={{ stroke: "#c7c7cc", strokeWidth: 1 }}
            content={({ active, payload }: TooltipProps<number, string>) => {
              const p = payload?.[0]?.payload as { label: string; price: number; tender: string } | undefined;
              return active && p ? (
                <TipBox title={p.label} rows={[{ color: SERIES_1, label: `سعر ${unit}`, value: `${nf.format(p.price)} د.أ` }, { label: "العطاء", value: p.tender }]} />
              ) : null;
            }}
          />
          <Line type="monotone" dataKey="price" stroke={SERIES_1} strokeWidth={2} dot={{ r: 4, fill: SERIES_1, stroke: "#fff", strokeWidth: 2 }} activeDot={{ r: 6 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

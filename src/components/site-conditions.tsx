import Link from "next/link";
import { AlertTriangle, CloudSun, Coins } from "lucide-react";
import { db } from "@/lib/db";
import { tenderCoords } from "@/lib/external/geo";
import { forecast, weatherIcon, type DayForecast } from "@/lib/external/weather";
import { jodRates } from "@/lib/external/fx";
import { Card } from "./ui";

const dayName = (d: string, i: number) => (i === 0 ? "اليوم" : i === 1 ? "بكرة" : new Date(`${d}T12:00:00Z`).toLocaleDateString("ar-JO", { weekday: "long" }));

/** طقس مواقع المشاريع النشطة (3 أيام) مع تنبيهات الصب والرافعات */
export async function SiteWeather({ managerId, tenderId, compact }: { managerId?: number; tenderId?: number; compact?: boolean }) {
  const tenders = await db.tender.findMany({
    where: tenderId ? { id: tenderId } : { status: { in: ["WON", "EXECUTION"] }, archiveStage: 0, ...(managerId ? { managerId } : {}) },
    select: { id: true, name: true, location: true, lat: true, lon: true },
    orderBy: { id: "desc" },
    take: 6,
  });
  if (!tenders.length) return null;
  const rows = (
    await Promise.all(
      tenders.map(async (t) => {
        const c = await tenderCoords(t).catch(() => null);
        if (!c) return null;
        const days = await forecast(c.lat, c.lon, 3).catch(() => null);
        return days ? { t, days } : null;
      }),
    )
  ).filter(Boolean) as { t: (typeof tenders)[number]; days: DayForecast[] }[];
  if (!rows.length) return null;
  const alerts = rows.reduce((a, r) => a + r.days.slice(0, 2).filter((d) => d.warnings.length).length, 0);
  return (
    <Card
      title={<span className="flex items-center gap-2"><CloudSun className="h-5 w-5 text-gold" /> {tenderId ? "طقس الموقع" : "طقس المواقع"}</span>}
      action={alerts ? <span className="flex items-center gap-1 rounded-full bg-warn-soft px-2.5 py-0.5 text-xs font-bold text-warn"><AlertTriangle className="h-3.5 w-3.5" /> {alerts} تنبيه عمل</span> : <span className="text-xs text-ink-faint">MET Norway</span>}
    >
      <ul className="space-y-3">
        {rows.map(({ t, days }) => (
          <li key={t.id}>
            {!tenderId && <Link href={`/tenders/${t.id}`} className="mb-1.5 block truncate text-sm font-bold text-navy hover:text-accent">{t.name}</Link>}
            <div className="grid grid-cols-3 gap-2">
              {days.map((d, i) => (
                <div key={d.date} className={d.warnings.length ? "rounded-xl bg-warn-soft/70 p-2" : "rounded-xl bg-black/[0.03] p-2"}>
                  <p className="text-[11px] font-bold text-ink-muted">{dayName(d.date, i)}</p>
                  <p className="text-lg leading-tight"><span aria-hidden>{weatherIcon(d.symbol)}</span> <span className="num text-sm font-black text-ink">{d.max}°</span><span className="num text-xs text-ink-muted"> / {d.min}°</span></p>
                  <p className="num text-[11px] text-ink-muted">💨 {d.windMax} كم/س{d.rain ? ` · 💧${d.rain} ملم` : ""}</p>
                  {!compact && d.warnings.map((w) => <p key={w} className="mt-1 text-[11px] font-semibold leading-4 text-warn">⚠ {w}</p>)}
                </div>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** أسعار صرف الدينار (للمواد المستوردة وعروض الموردين) */
export async function FxRates() {
  const fx = await jodRates();
  if (!fx) return null;
  return (
    <Card title={<span className="flex items-center gap-2"><Coins className="h-5 w-5 text-gold" /> أسعار الصرف مقابل الدينار</span>} action={<span className="num text-xs text-ink-faint">{fx.date}</span>}>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {fx.rates.map((r) => (
          <li key={r.code} className="rounded-xl bg-black/[0.03] px-3 py-2">
            <p className="text-[11px] font-bold text-ink-muted">{r.name}</p>
            <p className="num text-sm font-black text-ink" dir="ltr">1 {r.code} = {r.jodPer.toFixed(r.jodPer < 0.1 ? 4 : 3)} JOD</p>
          </li>
        ))}
      </ul>
    </Card>
  );
}

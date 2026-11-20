"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";

const TZ = "Asia/Amman";
const fmtTime = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true, timeZone: TZ });
/** نظام 12 ساعة: الساعة والدقيقة والثانية + ص/م */
function parts(d: Date) {
  const p = fmtTime.formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return { h: g("hour"), m: g("minute"), s: g("second"), ap: g("dayPeriod").toUpperCase() === "AM" ? "صباحاً" : "مساءً" };
}
const fmtDay = new Intl.DateTimeFormat("ar-JO-u-nu-latn", { weekday: "long", day: "numeric", month: "long", timeZone: TZ });
const fmtHijri = new Intl.DateTimeFormat("ar-SA-u-ca-islamic-umalqura-nu-latn", { day: "numeric", month: "long", year: "numeric", timeZone: TZ });

/** ساعة النظام الحية بتوقيت عمّان — تتحدث كل ثانية (بلا أي اتصال بالخادم) */
function useNow() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    // مزامنة مع بداية الثانية حتى لا تتأخر العقارب
    let t: ReturnType<typeof setInterval>;
    const s = setTimeout(() => {
      setNow(new Date());
      t = setInterval(() => setNow(new Date()), 1000);
    }, 1000 - (Date.now() % 1000));
    return () => {
      clearTimeout(s);
      clearInterval(t);
    };
  }, []);
  return now;
}

/** ساعة مدمجة لشريط الرأس */
export function LiveClock({ className, seconds = true }: { className?: string; seconds?: boolean }) {
  const now = useNow();
  const { h, m, s, ap } = now ? parts(now) : { h: "--", m: "--", s: "--", ap: "" };
  return (
    <time className={clsx("num inline-flex items-baseline font-black tabular-nums tracking-tight", className)} suppressHydrationWarning dateTime={now?.toISOString()} title={now ? `${fmtDay.format(now)} — ${fmtHijri.format(now)}` : undefined}>
      {h}
      <span className="clock-colon mx-[1px]">:</span>
      {m}
      {seconds && <span className="ms-1 text-[0.62em] font-bold opacity-55">{s}</span>}
      {ap && <span className="ms-2 self-center rounded-md border px-1.5 py-[1px] font-black leading-[1.5] opacity-85" style={{ direction: "rtl", borderColor: "color-mix(in srgb, currentColor 35%, transparent)", fontSize: "max(11px, 0.42em)" }}>{ap}</span>}
    </time>
  );
}

/** بطاقة الساعة الكبيرة: الوقت + اليوم + التاريخ الهجري */
export function ClockCard({ className, tone = "light" }: { className?: string; tone?: "light" | "dark" }) {
  const now = useNow();
  return (
    <div className={clsx("leading-tight", className)}>
      <LiveClock className={clsx("text-[34px] sm:text-[40px]", tone === "dark" ? "text-white" : "text-navy")} />
      <p className={clsx("mt-1 text-[13px] font-bold", tone === "dark" ? "text-white/80" : "text-ink-soft")} suppressHydrationWarning>{now ? fmtDay.format(now) : " "}</p>
      <p className={clsx("text-[12px] font-semibold", tone === "dark" ? "text-gold" : "text-accent")} suppressHydrationWarning>{now ? fmtHijri.format(now) : " "}</p>
    </div>
  );
}

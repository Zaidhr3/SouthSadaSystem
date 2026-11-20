"use client";

import Link from "next/link";
import { useLayoutEffect, useRef, useState } from "react";
import clsx from "clsx";

export type SegTab = { key: string; label: string; count?: number; more?: boolean };

/**
 * تبويبات الصفحة بنمط iOS الحديث: «عدسة» زجاجية تنزلق بنابض بين التبويبات،
 * وتنتقل فوراً عند اللمس (قبل اكتمال تحميل الصفحة) فيبدو التنقل لحظياً.
 */
export function SegmentedTabs({ tabs, active, base }: { tabs: SegTab[]; active: string; base: string }) {
  const [current, setCurrent] = useState(active);
  const [lens, setLens] = useState<{ x: number; w: number } | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => setCurrent(active), [active]);
  useLayoutEffect(() => {
    const el = wrap.current?.querySelector<HTMLElement>(`[data-k="${CSS.escape(current)}"]`);
    if (!el || !wrap.current) return;
    setLens({ x: el.offsetLeft, w: el.offsetWidth });
    el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [current, tabs.length]);

  const primary = tabs.filter((t) => !t.more || t.key === current);
  const more = tabs.filter((t) => t.more && t.key !== current);
  return (
    <nav className="seg no-print relative z-20 mb-5 flex items-center gap-1 rounded-[16px] p-1" aria-label="أقسام">
      <div ref={wrap} className="relative flex min-w-0 flex-1 gap-1 overflow-x-auto [scrollbar-width:none]">
        {lens && <span aria-hidden className="seg-lens" style={{ transform: `translateX(${lens.x}px)`, width: lens.w }} />}
        {primary.map((t) => (
          <Link
            key={t.key}
            data-k={t.key}
            href={`${base}?tab=${t.key}`}
            scroll={false}
            onClick={() => setCurrent(t.key)}
            className={clsx("relative z-[1] flex shrink-0 items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-bold transition-colors duration-300", current === t.key ? "text-navy" : "text-ink-muted hover:text-ink")}
            aria-current={current === t.key ? "page" : undefined}
          >
            {t.label}
            {typeof t.count === "number" && t.count > 0 && <span className={clsx("num rounded-full px-1.5 text-[11px] font-black", current === t.key ? "bg-accent text-white" : "bg-black/[0.07]")}>{t.count}</span>}
          </Link>
        ))}
      </div>
      {more.length > 0 && (
        <details className="group relative shrink-0">
          <summary className="flex cursor-pointer list-none items-center gap-1 rounded-xl px-3 py-2 text-sm font-semibold text-ink-muted hover:text-ink [&::-webkit-details-marker]:hidden">
            المزيد
            <span className="num rounded-full bg-black/[0.06] px-1.5 text-[11px]">{more.length}</span>
          </summary>
          <div className="glass-panel absolute end-0 top-full z-30 mt-2 w-56 origin-top animate-pop-in rounded-2xl p-1.5 shadow-pop">
            {more.map((t) => (
              <Link key={t.key} href={`${base}?tab=${t.key}`} scroll={false} onClick={() => setCurrent(t.key)} className="flex w-full items-center justify-between rounded-xl px-3.5 py-2 text-sm font-semibold hover:bg-accent-soft hover:text-accent">
                {t.label}
                {typeof t.count === "number" && t.count > 0 && <span className="num rounded-full bg-black/[0.06] px-1.5 text-[11px]">{t.count}</span>}
              </Link>
            ))}
          </div>
        </details>
      )}
    </nav>
  );
}

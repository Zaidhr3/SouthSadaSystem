"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import clsx from "clsx";
import { useLiquidScrub } from "./liquid-scrub";

export type SegTab = { key: string; label: string; count?: number; more?: boolean };

/**
 * تبويبات الصفحات بزجاج iOS: نفس محرك العدسة في الشريط السفلي (liquid-scrub.ts)
 * — اضغط واسحب عبر التبويبات والعدسة تتبع إصبعك/الفأرة بنابض، والإفلات يفتح التبويب؛ النقرة تفتحه فوراً.
 */
export function SegmentedTabs({ tabs, active, base }: { tabs: SegTab[]; active: string; base: string }) {
  const router = useRouter();
  const [current, setCurrent] = useState(active);
  useEffect(() => setCurrent(active), [active]);
  const primary = tabs.filter((t) => !t.more || t.key === current);
  const more = tabs.filter((t) => t.more && t.key !== current);
  const href = (k: string) => `${base}?tab=${k}`;
  const { container, lens } = useLiquidScrub({
    onCommit: (i) => {
      const t = primary[i];
      if (!t) return;
      setCurrent(t.key);
      router.push(href(t.key), { scroll: false });
    },
    deps: [primary.map((t) => t.key).join("|")],
    liftScale: 1.06,
  });

  return (
    <nav className="seg liquid-seg no-print relative z-20 mb-5 flex items-center gap-1 rounded-[18px] p-1" aria-label="أقسام">
      <div ref={container as React.RefObject<HTMLDivElement>} className="relative flex min-w-0 flex-1 touch-pan-y gap-1 overflow-x-auto [scrollbar-width:none]">
        <span ref={lens as React.RefObject<HTMLSpanElement>} aria-hidden className="seg-lens" />
        {primary.map((t) => {
          const on = current === t.key;
          return (
            <Link
              key={t.key}
              data-scrub-item=""
              {...(on ? { "data-scrub-active": "" } : {})}
              href={href(t.key)}
              scroll={false}
              draggable={false}
              onClick={() => setCurrent(t.key)}
              className={clsx("seg-item relative z-[1] flex shrink-0 select-none items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-bold transition-[color,transform] duration-200", on ? "text-navy" : "text-ink-muted hover:text-ink")}
              aria-current={on ? "page" : undefined}
            >
              {t.label}
              {typeof t.count === "number" && t.count > 0 && <span className={clsx("num rounded-full px-1.5 text-[11px] font-black", on ? "bg-accent text-white" : "bg-black/[0.07]")}>{t.count}</span>}
            </Link>
          );
        })}
      </div>
      {more.length > 0 && (
        <details className="group relative shrink-0">
          <summary className="flex cursor-pointer list-none items-center gap-1 rounded-xl px-3 py-2 text-sm font-semibold text-ink-muted hover:text-ink [&::-webkit-details-marker]:hidden">
            المزيد
            <span className="num rounded-full bg-black/[0.06] px-1.5 text-[11px]">{more.length}</span>
          </summary>
          <div className="glass-panel absolute end-0 top-full z-30 mt-2 w-56 origin-top animate-pop-in rounded-2xl p-1.5 shadow-pop">
            {more.map((t) => (
              <Link key={t.key} href={href(t.key)} scroll={false} onClick={() => setCurrent(t.key)} className="flex w-full items-center justify-between rounded-xl px-3.5 py-2 text-sm font-semibold hover:bg-accent-soft hover:text-accent">
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

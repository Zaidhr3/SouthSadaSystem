"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import clsx from "clsx";
import { type LucideIcon } from "lucide-react";
import { isActive } from "./nav-config";
import { useLiquidScrub } from "./liquid-scrub";

export type LiquidTab = { href?: string; label: string; icon: LucideIcon; badge?: number; dot?: boolean; primary?: boolean; onSelect?: () => void };

function haptic(ms = 6) {
  try {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(ms);
  } catch {
    /* غير مدعوم */
  }
}

/**
 * شريط التبويب الزجاجي العائم (Liquid Glass) بنمط iOS 26:
 *  - اضغط واسحب يميناً/يساراً: العدسة الزجاجية تتبع إصبعك بنابض فيزيائي (liquid-scrub.ts — بلا إعادة رسم أثناء السحب)،
 *    التبويب تحت الإصبع يكبر ويتميّز، والإفلات ينقلك إليه. النقرة السريعة تنتقل فوراً.
 *  - Gesture-Driven Switching: اسحب الصفحة نفسها أفقياً للتبويب المجاور.
 *  - التبويبات تُعرَّف في shell.tsx ← TabBar، والأنماط في globals.css ← «Liquid Glass Tab Bar».
 */
export function LiquidTabBar({ tabs }: { tabs: LiquidTab[] }) {
  const router = useRouter();
  const real = usePathname();
  const [tapped, setTapped] = useState<string | null>(null);
  useEffect(() => setTapped(null), [real]);
  const pathname = tapped ?? real;
  const activeIdx = tabs.findIndex((t) => t.href && isActive(pathname, t.href));
  const tabsKey = tabs.map((t) => t.href ?? t.label).join("|");

  const select = (i: number) => {
    const t = tabs[i];
    if (!t) return;
    if (t.onSelect) return t.onSelect();
    if (t.href) {
      setTapped(t.href);
      router.push(t.href);
    }
  };
  const { container, lens } = useLiquidScrub({ onCommit: select, deps: [tabsKey], liftScale: 1.16, axisLock: "none" });

  // التبديل بإيماءة السحب على الصفحة نفسها (بين تبويبات المسارات فقط، دون زر الإضافة والأقسام)
  useEffect(() => {
    if (!window.matchMedia("(pointer: coarse)").matches) return;
    const routeTabs = tabs.filter((t) => t.href && !t.primary);
    const cur = routeTabs.findIndex((t) => t.href === real);
    if (cur < 0) return; // فقط في صفحات التبويب الجذرية
    const main = document.getElementById("app-main");
    if (!main) return;
    let st: { x: number; y: number; t: number } | null = null;
    let active = false;
    const blocked = (el: EventTarget | null) => !!(el as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable], .overflow-x-auto, table, .seg, .liquid-tabbar, .liquid-seg, [data-scrub-item], [data-no-swipe], [role='dialog']");
    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      if (e.touches.length !== 1 || t.clientX < 30 || t.clientX > window.innerWidth - 30 || blocked(e.target)) return;
      st = { x: t.clientX, y: t.clientY, t: Date.now() };
      active = false;
    };
    const onMove = (e: TouchEvent) => {
      if (!st) return;
      const t = e.touches[0];
      const dx = t.clientX - st.x;
      const dy = t.clientY - st.y;
      if (!active) {
        if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { st = null; return; }
        if (Math.abs(dx) < 14) return;
        active = true;
      }
      // إصبع نحو اليمين = التبويب التالي (RTL)، ومقاومة عند الطرفين
      const next = dx > 0 ? cur + 1 : cur - 1;
      const resist = next < 0 || next >= routeTabs.length ? 0.25 : 1;
      main.style.transition = "none";
      main.style.transform = `translate3d(${dx * resist * 0.9}px,0,0)`;
      main.style.opacity = String(1 - Math.min(0.35, Math.abs(dx) / window.innerWidth));
      e.preventDefault();
    };
    const onEnd = (e: TouchEvent) => {
      if (!st) return;
      const s = st;
      st = null;
      if (!active) return;
      active = false;
      const dx = e.changedTouches[0].clientX - s.x;
      const v = Math.abs(dx) / Math.max(1, Date.now() - s.t);
      const next = dx > 0 ? cur + 1 : cur - 1;
      const go = (Math.abs(dx) > window.innerWidth * 0.28 || (v > 0.5 && Math.abs(dx) > 50)) && next >= 0 && next < routeTabs.length;
      if (go) {
        haptic(10);
        main.style.transition = "transform .22s cubic-bezier(.2,.8,.2,1), opacity .22s";
        main.style.transform = `translate3d(${Math.sign(dx) * window.innerWidth * 0.6}px,0,0)`;
        main.style.opacity = "0";
        const href = routeTabs[next].href!;
        setTapped(href);
        setTimeout(() => {
          router.push(href);
          setTimeout(() => { main.style.transition = ""; main.style.transform = ""; main.style.opacity = ""; }, 80);
        }, 160);
      } else {
        main.style.transition = "transform .45s cubic-bezier(.3,1.3,.5,1), opacity .3s";
        main.style.transform = "";
        main.style.opacity = "";
      }
    };
    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onEnd, { passive: true });
    document.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", onEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabsKey, real, router]);

  return (
    <nav ref={container as React.RefObject<HTMLElement>} className="tabbar liquid-tabbar no-print lg:hidden" aria-label="التنقل السريع">
      <span ref={lens as React.RefObject<HTMLSpanElement>} aria-hidden className="tab-lens" />
      {tabs.map((t, i) => {
        const on = i === activeIdx;
        const Icon = t.icon;
        const inner = (
          <>
            <span className="relative">
              <Icon className={t.primary ? "h-6 w-6" : "h-[23px] w-[23px]"} strokeWidth={on || t.primary ? 2.4 : 1.9} aria-hidden />
              {!!t.badge && t.badge > 0 && <span className="num absolute -end-2.5 -top-1.5 min-w-[18px] rounded-full bg-bad px-1 text-center text-[10px] font-bold leading-[18px] text-white">{t.badge > 99 ? "99+" : t.badge}</span>}
              {t.dot && <span className="absolute -end-1 -top-0.5 h-2.5 w-2.5 rounded-full bg-accent ring-2 ring-white" />}
            </span>
            <span>{t.label}</span>
          </>
        );
        const common = { "data-scrub-item": "", ...(on ? { "data-scrub-active": "" } : {}) };
        const cls = clsx("tab", on && "tab-active", t.primary && "tab-primary");
        return t.href ? (
          <Link key={t.label} {...common} href={t.href} draggable={false} onClick={() => { haptic(); setTapped(t.href!); }} className={cls} aria-current={on ? "page" : undefined}>
            {inner}
          </Link>
        ) : (
          <button key={t.label} {...common} type="button" onClick={() => { haptic(); t.onSelect?.(); }} className={cls} aria-label={t.label}>
            {inner}
          </button>
        );
      })}
    </nav>
  );
}

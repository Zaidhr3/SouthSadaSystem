"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
/** اهتزاز خفيف (حيث يدعمه الجهاز) — محلي لتجنب الاستيراد الدائري مع forms */
function haptic(ms = 8) {
  try {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(ms);
  } catch {
    /* غير مدعوم */
  }
}

/**
 * سحب من حافة الشاشة للرجوع — مثل iPhone:
 * تبدأ اللمسة من الحافة (يمين أو يسار، 24px)، فتنزلق الصفحة مع الإصبع، وعند تجاوز ثلث العرض أو بسرعة كافية ← رجوع للصفحة السابقة.
 * لا يتعارض مع التمرير العمودي أو الجداول (يبدأ من الحافة فقط، ويُلغى إن كانت الحركة عمودية).
 */
export function EdgeSwipeBack({ targetId = "app-main" }: { targetId?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const path = useRef(pathname);
  path.current = pathname;

  useEffect(() => {
    if (!window.matchMedia("(pointer: coarse)").matches) return;
    const EDGE = 26;
    let start: { x: number; y: number; t: number; side: 1 | -1 } | null = null;
    let active = false;
    let el: HTMLElement | null = null;
    let shade: HTMLDivElement | null = null;

    const reset = (animate: boolean) => {
      if (!el) return;
      el.style.transition = animate ? "transform .42s var(--spring-soft), box-shadow .3s" : "";
      el.style.transform = "";
      el.style.boxShadow = "";
      if (shade) { shade.style.transition = "opacity .3s"; shade.style.opacity = "0"; }
      setTimeout(() => { if (el) { el.style.transition = ""; el.style.willChange = ""; } shade?.remove(); shade = null; }, 450);
    };

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1 || path.current === "/" || document.querySelector("[aria-modal='true']")) return;
      const t = e.touches[0];
      const w = window.innerWidth;
      const side = t.clientX > w - EDGE ? 1 : t.clientX < EDGE ? -1 : 0;
      if (!side) return;
      start = { x: t.clientX, y: t.clientY, t: Date.now(), side: side as 1 | -1 };
      active = false;
    };
    const onMove = (e: TouchEvent) => {
      if (!start) return;
      const t = e.touches[0];
      const dx = (start.x - t.clientX) * start.side; // موجب = نحو داخل الشاشة
      const dy = Math.abs(t.clientY - start.y);
      if (!active) {
        if (dy > 12 && dy > Math.abs(dx)) { start = null; return; }
        if (dx < 8) return;
        active = true;
        el = document.getElementById(targetId);
        if (!el) { start = null; return; }
        el.style.willChange = "transform";
        shade = document.createElement("div");
        shade.className = "swipe-shade";
        document.body.appendChild(shade);
        haptic(6);
      }
      e.preventDefault();
      const x = Math.max(0, dx);
      el!.style.transform = `translate3d(${-x * start.side}px,0,0)`;
      el!.style.boxShadow = `${start.side * 18}px 0 40px -20px rgba(11,37,69,.35)`;
      if (shade) shade.style.opacity = String(Math.max(0, 0.28 - (x / window.innerWidth) * 0.28));
    };
    const onEnd = (e: TouchEvent) => {
      if (!start) return;
      const s = start;
      start = null;
      if (!active || !el) return;
      const t = e.changedTouches[0];
      const dx = (s.x - t.clientX) * s.side;
      const v = dx / Math.max(1, Date.now() - s.t);
      if (dx > window.innerWidth * 0.33 || (v > 0.45 && dx > 40)) {
        haptic(10);
        el.style.transition = "transform .25s cubic-bezier(.2,.8,.2,1)";
        el.style.transform = `translate3d(${-window.innerWidth * s.side}px,0,0)`;
        setTimeout(() => {
          if (window.history.length > 1) router.back();
          else router.push("/");
          setTimeout(() => reset(false), 60);
        }, 200);
      } else reset(true);
      active = false;
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
  }, [router, targetId]);
  return null;
}

/**
 * سحب الورقة للأسفل لإغلاقها (Bottom Sheet) — على الهاتف بدل زر X.
 * يُركَّب على عنصر اللوحة؛ يبدأ السحب من «المقبض» أو الرأس، أو من أي مكان حين يكون المحتوى في أعلاه.
 */
export function useSheetDrag(onClose: () => void, enabled = true) {
  const panel = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const cb = useRef(onClose);
  cb.current = onClose;

  useEffect(() => {
    const p = panel.current;
    if (!p || !enabled) return;
    p.style.transform = "";
    p.style.transition = "";
    if (!window.matchMedia("(max-width: 639px)").matches) return;
    let y0 = 0, t0 = 0, dy = 0, dragging = false, armed = false;
    const fromHandle = (target: EventTarget | null) => !!(target as HTMLElement | null)?.closest?.("[data-sheet-handle]");
    const onStart = (e: TouchEvent) => {
      const sc = scroller.current;
      armed = fromHandle(e.target) || !sc || sc.scrollTop <= 0;
      if ((e.target as HTMLElement).closest?.("input, textarea, select, [contenteditable]")) armed = fromHandle(e.target);
      y0 = e.touches[0].clientY; t0 = Date.now(); dy = 0; dragging = false;
    };
    const onMove = (e: TouchEvent) => {
      if (!armed) return;
      dy = e.touches[0].clientY - y0;
      if (!dragging) {
        if (dy < 6) { if (dy < -4) armed = false; return; }
        dragging = true;
        p.style.transition = "none";
      }
      e.preventDefault();
      const d = dy < 0 ? dy * 0.2 : dy;
      p.style.transform = `translate3d(0,${d}px,0)`;
      const bd = p.parentElement?.querySelector<HTMLElement>(".modal-backdrop");
      if (bd) bd.style.opacity = String(Math.max(0.15, 1 - dy / 500));
    };
    const onEnd = () => {
      if (!dragging) return;
      dragging = false;
      const v = dy / Math.max(1, Date.now() - t0);
      const bd = p.parentElement?.querySelector<HTMLElement>(".modal-backdrop");
      if (dy > 120 || (v > 0.6 && dy > 30)) {
        haptic(8);
        p.style.transition = "transform .24s ease-in";
        p.style.transform = "translate3d(0,100%,0)";
        if (bd) { bd.style.transition = "opacity .24s"; bd.style.opacity = "0"; }
        setTimeout(() => cb.current(), 200);
      } else {
        p.style.transition = "transform .45s var(--spring-soft)";
        p.style.transform = "";
        if (bd) { bd.style.transition = "opacity .3s"; bd.style.opacity = ""; }
      }
    };
    p.addEventListener("touchstart", onStart, { passive: true });
    p.addEventListener("touchmove", onMove, { passive: false });
    p.addEventListener("touchend", onEnd, { passive: true });
    p.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      p.removeEventListener("touchstart", onStart);
      p.removeEventListener("touchmove", onMove);
      p.removeEventListener("touchend", onEnd);
      p.removeEventListener("touchcancel", onEnd);
    };
  }, [enabled]);
  return { panel, scroller };
}

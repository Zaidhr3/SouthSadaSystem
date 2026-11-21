"use client";

import { useEffect, useRef } from "react";

/**
 * محرك «العدسة الزجاجية» المشترك لكل أشرطة التبويب (السفلي وتبويبات الصفحات):
 *  - اضغط واسحب أفقياً: العدسة تتبع إصبعك بنابض فيزيائي (stiffness/damping) عبر requestAnimationFrame
 *    وتحديث مباشر للـ DOM — بلا أي إعادة رسم لـ React أثناء السحب.
 *  - التبويب تحت الإصبع يُميَّز (data-hover) ويكبر قليلاً، واهتزاز خفيف عند الانتقال لتبويب جديد.
 *  - الإفلات: العدسة تستقر على التبويب ويُفعَّل. النقرة السريعة بلا سحب تعمل كنقرة عادية.
 *  - عناصر التبويب: أي عنصر داخل الحاوية يحمل data-scrub-item (وdata-scrub-active للنشط).
 */
type Spring = { v: number; vel: number; target: number; k: number; c: number };
/** نابض «الاستقرار البطيء» بعد الإفلات أو النقر: صلابة منخفضة وتخميد قريب من الحرج ← انزلاق ناعم كالـ Liquid Glass (~0.55 ث) */
const SETTLE = { k: 170, c: 23 };
/** نابض سريع لتكبير العدسة وعرضها أثناء السحب (الموضع نفسه لا يمر بأي نابض — يتبع الإصبع 1:1) */
const LIFT = { k: 620, c: 42 };
/** تتبّع العدسة في وضع التطوير: window.__sadaLens + console.debug (أو localStorage["sada:lensDebug"]="1" في الإنتاج) */
const lensDebug = () => {
  try {
    return process.env.NODE_ENV !== "production" || localStorage.getItem("sada:lensDebug") === "1";
  } catch {
    return false;
  }
};

function vibrate(ms: number) {
  try {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(ms);
  } catch {
    /* غير مدعوم */
  }
}

export function useLiquidScrub(opts: {
  /** يُستدعى عند الإفلات على تبويب مختلف بعد السحب */
  onCommit: (index: number) => void;
  /** يتغير عند تغيّر التبويب النشط أو عدد التبويبات — لإعادة تموضع العدسة */
  deps: unknown[];
  /** تكبير العدسة أثناء السحب */
  liftScale?: number;
  /** "x": الحركة العمودية في البداية تُترك لتمرير الصفحة (تبويبات الصفحات). "none": الشريط يملك كل الحركة (الشريط السفلي) */
  axisLock?: "x" | "none";
}) {
  const container = useRef<HTMLElement | null>(null);
  const lens = useRef<HTMLElement | null>(null);
  const commit = useRef(opts.onCommit);
  commit.current = opts.onCommit;
  const lift = opts.liftScale ?? 1.12;
  const axisLock = opts.axisLock ?? "x";

  useEffect(() => {
    const root = container.current;
    const ln = lens.current;
    if (!root || !ln) return;
    const x: Spring = { v: 0, vel: 0, target: 0, ...SETTLE };
    const w: Spring = { v: 0, vel: 0, target: 0, ...SETTLE };
    const sc: Spring = { v: 1, vel: 0, target: 1, ...LIFT };
    const debug = lensDebug();
    let lastLog = 0;
    let raf = 0;
    let last = 0;
    let initialized = false;

    const items = () => Array.from(root.querySelectorAll<HTMLElement>("[data-scrub-item]"));
    // القياس بالتخطيط (offsetLeft/offsetWidth) لا بالمستطيل المرئي — تكبير التبويب أثناء السحب لا يحرف موضع الاستقرار
    const rectOf = (el: HTMLElement) => {
      if (el.offsetParent === root) return { left: el.offsetLeft, width: el.offsetWidth };
      const r = el.getBoundingClientRect();
      const c = root.getBoundingClientRect();
      return { left: r.left - c.left + root.scrollLeft, width: el.offsetWidth || r.width };
    };
    const paint = () => {
      ln.style.transform = `translate3d(${x.v}px,0,0) scale(${sc.v})`;
      ln.style.width = `${Math.max(0, w.v)}px`;
    };
    const step = (s: Spring, dt: number) => {
      const f = -s.k * (s.v - s.target) - s.c * s.vel;
      s.vel += f * dt;
      s.v += s.vel * dt;
    };
    const tick = (t: number) => {
      const dt = Math.min(0.032, last ? (t - last) / 1000 : 0.016);
      last = t;
      step(x, dt);
      step(w, dt);
      step(sc, dt);
      paint();
      const settled = [x, w, sc].every((s) => Math.abs(s.v - s.target) < 0.3 && Math.abs(s.vel) < 0.3);
      if (settled) {
        x.v = x.target; w.v = w.target; sc.v = sc.target;
        paint();
        raf = 0;
        last = 0;
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    const kick = () => {
      if (!raf) raf = requestAnimationFrame(tick);
    };
    const snapTo = (el: HTMLElement | undefined, instant = false) => {
      if (!el) {
        ln.style.opacity = "0";
        return;
      }
      ln.style.opacity = "1";
      const r = rectOf(el);
      x.target = r.left;
      w.target = r.width;
      sc.target = 1;
      Object.assign(x, SETTLE);
      Object.assign(w, SETTLE);
      Object.assign(sc, SETTLE);
      if (instant || !initialized) {
        x.v = x.target; w.v = w.target; sc.v = 1; x.vel = w.vel = sc.vel = 0;
        paint();
        initialized = true;
        return;
      }
      kick();
    };
    const activeEl = () => items().find((el) => el.hasAttribute("data-scrub-active"));
    snapTo(activeEl(), true);

    let drag: { id: number; sx: number; sy: number; moved: boolean; held: boolean; idx: number; lx: number; lt: number; vx: number } | null = null;
    let holdTimer: ReturnType<typeof setTimeout> | null = null;
    const clearHold = () => { if (holdTimer) clearTimeout(holdTimer); holdTimer = null; };
    let suppressClick = false;
    // تحديد التبويب تحت الإصبع بمواضع التخطيط (لا بالمستطيل المكبَّر) — لا ارتجاف عند الحدود بين التبويبات
    const indexAt = (clientX: number) => {
      const c = root.getBoundingClientRect();
      const px = clientX - c.left - root.clientLeft + root.scrollLeft;
      const list = items();
      let best = 0, bd = Infinity;
      list.forEach((el, i) => {
        const r = rectOf(el);
        const d = px < r.left ? r.left - px : px > r.left + r.width ? px - (r.left + r.width) : 0;
        if (d < bd) { bd = d; best = i; }
      });
      return best;
    };
    /** فتح العدسة (تكبير + حلقة ضوء) — عند الضغط المطوّل أو أول حركة أفقية */
    const openLoupe = (e: PointerEvent) => {
      try { root.setPointerCapture(e.pointerId); } catch { /* */ }
      root.classList.add("is-scrubbing");
      sc.target = lift;
      Object.assign(sc, LIFT);
      Object.assign(w, LIFT);
      kick();
    };
    const setHover = (i: number | null) => items().forEach((el, k) => (k === i ? el.setAttribute("data-hover", "") : el.removeAttribute("data-hover")));

    const down = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      clearHold();
      drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, moved: false, held: false, idx: indexAt(e.clientX), lx: e.clientX, lt: performance.now(), vx: 0 };
      // الضغط المطوّل (180ms) بلا حركة: تُفتح العدسة فوق التبويب المضغوط وتبقى الإيماءة حية للتصفح
      const ev = e;
      holdTimer = setTimeout(() => {
        holdTimer = null;
        if (!drag || drag.moved || drag.id !== ev.pointerId) return;
        drag.held = true;
        openLoupe(ev);
        const el = items()[drag.idx];
        if (el) {
          const r = rectOf(el);
          x.target = r.left; w.target = r.width;
          Object.assign(x, LIFT);
          kick();
        }
        setHover(drag.idx);
        vibrate(8);
      }, 180);
    };
    const move = (e: PointerEvent) => {
      if (!drag || drag.id !== e.pointerId) return;
      if (!drag.moved) {
        const dx = Math.abs(e.clientX - drag.sx), dy = Math.abs(e.clientY - drag.sy);
        if (!drag.held) {
          if (dx < 7) {
            // حركة عمودية واضحة قبل أي أفقية: في تبويبات الصفحة تُترك للتمرير؛ في الشريط السفلي نتجاهلها ونبقي الإيماءة حية
            if (axisLock === "x" && dy > 10) { clearHold(); drag = null; }
            return;
          }
          if (axisLock === "x" && dy > dx * 1.2) { clearHold(); drag = null; return; }
          openLoupe(e);
          vibrate(5);
        }
        clearHold();
        drag.moved = true;
      }
      e.preventDefault();
      // صف تبويبات أطول من الشاشة: يتمرر تلقائياً حين يقترب الإصبع من الحافة
      if (root.scrollWidth > root.clientWidth + 2) {
        const c0 = root.getBoundingClientRect();
        if (e.clientX < c0.left + 28) root.scrollLeft -= 10;
        else if (e.clientX > c0.right - 28) root.scrollLeft += 10;
      }
      const list = items();
      const i = indexAt(e.clientX);
      const r = rectOf(list[i]);
      const c = root.getBoundingClientRect();
      // العدسة تتمركز تحت الإصبع، محصورة داخل الشريط
      const fx = e.clientX - c.left - root.clientLeft + root.scrollLeft - r.width / 2;
      const minX = rectOf(list[0]).left;
      const lastR = rectOf(list[list.length - 1]);
      const firstR = rectOf(list[0]);
      const lo = Math.min(minX, lastR.left);
      const hi = Math.max(firstR.left, lastR.left);
      // 1:1 مع الإصبع: الموضع يُكتب مباشرة (بلا نابض ولا انتظار لحالة React)، ويُحسب معدل حركة الإصبع لاستعماله عند الإفلات
      const now = performance.now();
      const nx = Math.max(lo, Math.min(hi, fx));
      const dt = Math.max(1, now - drag.lt);
      drag.vx = 0.7 * drag.vx + 0.3 * (((nx - x.v) / dt) * 1000);
      drag.lt = now;
      drag.lx = e.clientX;
      x.v = x.target = nx;
      x.vel = 0;
      w.v = w.target = r.width;
      w.vel = 0;
      paint();
      if (debug && now - lastLog > 120) {
        lastLog = now;
        const tf = getComputedStyle(ln).transform;
        (window as unknown as { __sadaLens?: unknown }).__sadaLens = { x: Math.round(nx), fingerX: Math.round(e.clientX), tab: i, transform: tf };
        console.debug(`[liquid-lens] x=${Math.round(nx)}px finger=${Math.round(e.clientX)} tab=${i} transform=${tf}`);
      }
      if (i !== drag.idx) {
        drag.idx = i;
        vibrate(4);
      }
      setHover(i);
      kick();
    };
    const up = (e: PointerEvent) => {
      if (!drag || drag.id !== e.pointerId) return;
      const d = drag;
      drag = null;
      clearHold();
      root.classList.remove("is-scrubbing");
      setHover(null);
      if (!d.moved && !d.held) return; // نقرة عادية — يتولاها الرابط/الزر
      // نقطة الإفلات نفسها تحدد التبويب (أدق من آخر حدث حركة)
      if (Number.isFinite(e.clientX) && e.clientX > 0) d.idx = indexAt(e.clientX);
      if (debug) console.debug(`[liquid-lens] release idx=${d.idx} finger=${Math.round(e.clientX)} lastMoveX=${Math.round(d.lx)}`);
      suppressClick = true;
      setTimeout(() => (suppressClick = false), 60);
      const list = items();
      snapTo(list[d.idx]);
      // استقرار بطيء يرث سرعة الإصبع (زخم طبيعي) بدل قفزة حادة
      x.vel = Math.max(-2500, Math.min(2500, d.vx));
      kick();
      vibrate(10);
      if (!list[d.idx]?.hasAttribute("data-scrub-active")) commit.current(d.idx);
    };
    const cancel = () => {
      clearHold();
      drag = null;
      root.classList.remove("is-scrubbing");
      setHover(null);
      snapTo(activeEl());
    };
    const click = (e: MouseEvent) => {
      if (suppressClick) { e.preventDefault(); e.stopPropagation(); }
    };
    const onResize = () => { if (!drag) snapTo(activeEl(), true); };

    root.addEventListener("pointerdown", down);
    root.addEventListener("pointermove", move);
    root.addEventListener("pointerup", up);
    root.addEventListener("pointercancel", cancel);
    root.addEventListener("click", click, true);
    window.addEventListener("resize", onResize);
    // إعادة التموضع عند تغيّر التبويب النشط من الخارج (نقرة/تنقل)
    const mo = new MutationObserver(() => { if (!drag) snapTo(activeEl()); });
    mo.observe(root, { attributes: true, subtree: true, attributeFilter: ["data-scrub-active"] });
    // أي تغيّر في مقاس الشريط أو التبويبات (تحميل صفحة، شارة جديدة، تدوير الشاشة) ← إعادة تموضع العدسة على التبويب النشط
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => { if (!drag) snapTo(activeEl()); }) : null;
    ro?.observe(root);
    items().forEach((el) => ro?.observe(el));
    return () => {
      cancelAnimationFrame(raf);
      mo.disconnect();
      ro?.disconnect();
      root.removeEventListener("pointerdown", down);
      root.removeEventListener("pointermove", move);
      root.removeEventListener("pointerup", up);
      root.removeEventListener("pointercancel", cancel);
      root.removeEventListener("click", click, true);
      window.removeEventListener("resize", onResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, opts.deps);

  return { container, lens };
}

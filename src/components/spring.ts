"use client";

/**
 * نابض فيزيائي موحّد للإيماءات (أوراق، نوافذ، عدسة): يحرّك قيمة رقمية من موضعها الحالي إلى الهدف
 * مع وراثة سرعة الإصبع (px/s) — حركة متصلة بلا قفزات، وبطيئة قليلاً كـ iOS (تخميد قريب من الحرج).
 */
export const SPRING_SHEET = { k: 210, c: 26 };
export const SPRING_SOFT = { k: 170, c: 23 };

export function animateSpring(o: {
  from: number;
  to: number;
  velocity?: number;
  k?: number;
  c?: number;
  onUpdate: (v: number) => void;
  onDone?: () => void;
  /** يتوقف عند العبور إلى الهدف (للإغلاق: لا ارتداد بعد الخروج من الشاشة) */
  clamp?: boolean;
}) {
  const k = o.k ?? SPRING_SHEET.k;
  const c = o.c ?? SPRING_SHEET.c;
  let v = o.from;
  let vel = o.velocity ?? 0;
  let last = 0;
  let raf = 0;
  let stopped = false;
  const tick = (t: number) => {
    if (stopped) return;
    const dt = Math.min(0.032, last ? (t - last) / 1000 : 0.016);
    last = t;
    vel += (-k * (v - o.to) - c * vel) * dt;
    v += vel * dt;
    const crossed = o.clamp && (o.from < o.to ? v >= o.to : v <= o.to);
    if (crossed || (Math.abs(v - o.to) < 0.4 && Math.abs(vel) < 4)) {
      o.onUpdate(o.to);
      o.onDone?.();
      return;
    }
    o.onUpdate(v);
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
  };
}

/** سرعة الإصبع اللحظية من آخر ~90ms من العينات (لا من بداية اللمسة) */
export function velocityTracker() {
  const samples: { t: number; y: number }[] = [];
  return {
    push(y: number) {
      const t = performance.now();
      samples.push({ t, y });
      while (samples.length > 2 && t - samples[0].t > 90) samples.shift();
    },
    /** px/s */
    get() {
      if (samples.length < 2) return 0;
      const a = samples[0], b = samples[samples.length - 1];
      return ((b.y - a.y) / Math.max(1, b.t - a.t)) * 1000;
    },
    reset() {
      samples.length = 0;
    },
  };
}

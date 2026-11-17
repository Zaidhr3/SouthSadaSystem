"use client";

import { useEffect, useLayoutEffect, useState } from "react";

// يبدأ العد قبل أول رسم بعد التحميل (بلا وميض للقيمة النهائية ثم الصفر)
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * عدّاد متحرك للأرقام في البطاقات: يعدّ من الصفر إلى القيمة مع الحفاظ على تنسيقها
 * (الفواصل والكسور والوحدة مثل «1,470 د.أ» أو «100%»). يحترم إعداد تقليل الحركة.
 */
export function CountUp({ text, ms = 900 }: { text: string; ms?: number }) {
  const m = text.match(/-?[\d,]+(?:\.\d+)?/);
  const [shown, setShown] = useState(text);
  useIsoLayoutEffect(() => {
    if (!m) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const raw = m[0];
    const target = Number(raw.replace(/,/g, ""));
    if (!Number.isFinite(target) || target === 0) return;
    const decimals = raw.includes(".") ? raw.split(".")[1].length : 0;
    const grouped = raw.includes(",");
    const fmt = (v: number) => {
      const s = v.toFixed(decimals);
      if (!grouped) return s;
      const [i, d] = s.split(".");
      return i.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (d ? `.${d}` : "");
    };
    setShown(text.replace(raw, fmt(0)));
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / ms);
      const e = 1 - Math.pow(1 - p, 3);
      setShown(text.replace(raw, fmt(target * e)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);
  return <>{shown}</>;
}

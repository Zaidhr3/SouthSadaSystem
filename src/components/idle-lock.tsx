"use client";

import { useEffect, useRef, useState } from "react";
import { Lock } from "lucide-react";

/** مدة الخمول قبل القفل التلقائي (دقيقتان) — يجب أن تطابق IDLE_MS في middleware */
export const IDLE_MS = 2 * 60 * 1000;
const WARN_MS = 15 * 1000;
const PING_EVERY = 45 * 1000;

/**
 * القفل التلقائي للجلسة: بعد دقيقتين بلا لمس أو كتابة أو تمرير يُسجَّل الخروج ويعود المستخدم لشاشة الدخول.
 * - تحذير قبل القفل بـ 15 ثانية (أي حركة تلغيه).
 * - إن بقي التطبيق في الخلفية أكثر من دقيقتين (إغلاق الهاتف) يُقفل فور العودة.
 * - أثناء النشاط (الكتابة في نموذج طويل مثلاً) تُبلَّغ الجلسة على الخادم بأنها نشطة.
 * المسودات غير المحفوظة تبقى محفوظة محلياً وتُستعاد بعد الدخول.
 */
export function IdleLock() {
  const last = useRef(Date.now());
  const lastPing = useRef(Date.now());
  const locking = useRef(false);
  const [left, setLeft] = useState<number | null>(null);

  useEffect(() => {
    const lock = () => {
      if (locking.current) return;
      locking.current = true;
      fetch("/api/session/lock", { method: "POST", keepalive: true })
        .catch(() => undefined)
        .finally(() => window.location.replace("/login?idle=1"));
    };
    const active = () => {
      if (locking.current) return;
      const now = Date.now();
      if (now - last.current >= IDLE_MS) return lock();
      last.current = now;
      setLeft(null);
      if (now - lastPing.current > PING_EVERY) {
        lastPing.current = now;
        fetch("/api/session/ping", { cache: "no-store" }).then((r) => { if (r.status === 401) lock(); }).catch(() => undefined);
      }
    };
    const tick = () => {
      const idle = Date.now() - last.current;
      if (idle >= IDLE_MS) lock();
      else if (idle >= IDLE_MS - WARN_MS) setLeft(Math.ceil((IDLE_MS - idle) / 1000));
    };
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - last.current >= IDLE_MS) lock();
    };
    // ssc-busy: عمل طويل جارٍ (قراءة جدول كميات على دفعات، رفع ملف كبير) — لا تُقفل الجلسة أثناءه
    const events = ["pointerdown", "keydown", "touchstart", "wheel", "scroll", "input", "ssc-busy"] as const;
    events.forEach((e) => window.addEventListener(e, active, { passive: true, capture: true }));
    let lastMove = 0;
    const move = () => { const n = Date.now(); if (n - lastMove > 2000) { lastMove = n; active(); } };
    window.addEventListener("pointermove", move, { passive: true });
    document.addEventListener("visibilitychange", onVisible);
    const id = window.setInterval(tick, 1000);
    return () => {
      events.forEach((e) => window.removeEventListener(e, active, { capture: true }));
      window.removeEventListener("pointermove", move);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(id);
    };
  }, []);

  if (left == null) return null;
  return (
    <div role="alert" className="no-print fixed inset-x-0 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-[70] flex justify-center px-4 lg:bottom-6">
      <div className="flex animate-pop-in items-center gap-3 rounded-2xl bg-ink px-4 py-3 text-sm font-semibold text-white shadow-pop">
        <Lock className="h-4 w-4 shrink-0" aria-hidden />
        <span>ستُقفل الجلسة لعدم النشاط خلال <b className="num">{left}</b> ثانية — المس الشاشة للمتابعة</span>
      </div>
    </div>
  );
}

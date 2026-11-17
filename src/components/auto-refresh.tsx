"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** تحديث صامت لبيانات الخادم دورياً عندما تكون الصفحة ظاهرة (تنبيهات لحظية في لوحة التحكم) */
export function AutoRefresh({ seconds = 60 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const id = setInterval(tick, seconds * 1000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [router, seconds]);
  return null;
}

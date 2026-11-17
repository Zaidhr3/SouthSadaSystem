"use client";

import { useEffect } from "react";

/** تسجيل عامل الخدمة (يعمل فقط عبر https أو localhost) */
export function PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
  }, []);
  return null;
}

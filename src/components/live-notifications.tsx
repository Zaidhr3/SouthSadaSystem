"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BellRing, X } from "lucide-react";

const POLL_MS = 30_000;

/**
 * التنبيهات الحية: يفحص كل 30 ثانية (والصفحة ظاهرة) — عند وصول تنبيه جديد:
 * يُحدّث العدّاد والقوائم فوراً، ويعرض بطاقة منبثقة داخل النظام، وإشعاراً على الجهاز إن سمح المستخدم.
 */
export function LiveNotifications({ initialKeys }: { initialKeys: string[] }) {
  const router = useRouter();
  const seen = useRef(new Set(initialKeys));
  const [popup, setPopup] = useState<{ title: string; body: string; href: string } | null>(null);
  const [perm, setPerm] = useState<NotificationPermission | "unsupported">("default");

  useEffect(() => {
    setPerm(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
  }, []);

  useEffect(() => {
    let stop = false;
    const check = async () => {
      if (stop || document.visibilityState !== "visible") return;
      try {
        const res = await fetch("/api/notifications/count", { cache: "no-store" });
        if (!res.ok) return;
        const j = (await res.json()) as { count: number; keys: string[]; top: { key: string; title: string; body: string; href: string } | null };
        const fresh = j.keys.filter((k) => !seen.current.has(k));
        j.keys.forEach((k) => seen.current.add(k));
        document.title = document.title.replace(/^\(\d+\)\s*/, "");
        if (j.count > 0) document.title = `(${j.count}) ${document.title}`;
        if (fresh.length && j.top) {
          router.refresh();
          setPopup({ title: j.top.title, body: j.top.body, href: j.top.href });
          if (typeof Notification !== "undefined" && Notification.permission === "granted") {
            try {
              const n = new Notification(j.top.title, { body: j.top.body, icon: "/icon.svg", tag: j.top.key, lang: "ar", dir: "rtl" });
              n.onclick = () => {
                window.focus();
                router.push(j.top!.href);
                n.close();
              };
            } catch {
              /* بعض المتصفحات تمنع الإشعار المباشر */
            }
          }
        }
      } catch {
        /* انقطاع مؤقت — المحاولة التالية بعد 30 ثانية */
      }
    };
    const id = window.setInterval(check, POLL_MS);
    const onVisible = () => document.visibilityState === "visible" && void check();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stop = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router]);

  useEffect(() => {
    if (!popup) return;
    const t = window.setTimeout(() => setPopup(null), 12_000);
    return () => window.clearTimeout(t);
  }, [popup]);

  return (
    <>
      {perm === "default" && (
        <button
          type="button"
          className="no-print fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom))] end-4 z-[60] flex items-center gap-2 rounded-full bg-ink px-4 py-2.5 text-xs font-bold text-white shadow-pop lg:bottom-6"
          onClick={async () => setPerm(await Notification.requestPermission())}
        >
          <BellRing className="h-4 w-4" aria-hidden /> تفعيل إشعارات الجهاز
        </button>
      )}
      {popup && (
        <div role="status" className="no-print fixed inset-x-4 top-4 z-[80] mx-auto flex max-w-md animate-pop-in items-start gap-3 rounded-2xl bg-white p-4 shadow-pop ring-1 ring-black/5">
          <BellRing className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden />
          <button type="button" className="min-w-0 flex-1 text-start" onClick={() => { router.push(popup.href); setPopup(null); }}>
            <p className="text-sm font-bold">{popup.title}</p>
            <p className="mt-0.5 line-clamp-2 text-xs text-ink-muted">{popup.body}</p>
          </button>
          <button type="button" className="grid h-8 w-8 shrink-0 place-items-center rounded-full hover:bg-black/5" aria-label="إغلاق" onClick={() => setPopup(null)}>
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
    </>
  );
}

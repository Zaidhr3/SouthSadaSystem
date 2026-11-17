import Link from "next/link";
import clsx from "clsx";
import { AlertOctagon, AlertTriangle, BellRing, Info } from "lucide-react";
import type { AppNotification } from "@/lib/notifications";
import { AutoRefresh } from "./auto-refresh";
import { NotificationLink } from "./notification-link";

const SEV = {
  critical: { icon: AlertOctagon, cls: "bg-bad-soft text-bad" },
  warning: { icon: AlertTriangle, cls: "bg-warn-soft text-warn" },
  info: { icon: Info, cls: "bg-accent-soft text-accent" },
};

/** لوحة التنبيهات اللحظية في لوحة التحكم — تتحدث تلقائياً كل دقيقة */
export function LiveAlerts({ notes, limit = 6 }: { notes: AppNotification[]; limit?: number }) {
  const shown = notes.slice(0, limit);
  return (
    <section className="card mb-5 overflow-hidden">
      <AutoRefresh seconds={60} />
      <div className="flex items-center justify-between gap-3 px-5 pb-2 pt-5 sm:px-6">
        <h2 className="flex items-center gap-2 text-[17px] font-bold">
          <span className="relative flex h-2.5 w-2.5">
            {notes.some((n) => n.severity === "critical") && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-bad opacity-60" />}
            <span className={clsx("relative inline-flex h-2.5 w-2.5 rounded-full", notes.length ? "bg-bad" : "bg-good")} />
          </span>
          التنبيهات اللحظية
          <span className="num rounded-full bg-black/[0.06] px-2 text-xs">{notes.length}</span>
        </h2>
        <Link href="/notifications" className="text-sm font-semibold text-accent">مركز التنبيهات</Link>
      </div>
      {shown.length === 0 ? (
        <p className="flex items-center gap-2 px-6 pb-5 text-sm text-ink-muted"><BellRing className="h-4 w-4" /> لا توجد تنبيهات — كل الاستحقاقات تحت السيطرة</p>
      ) : (
        <ul className="stagger grid gap-2 px-5 pb-5 sm:px-6 md:grid-cols-2 xl:grid-cols-3">
          {shown.map((n) => {
            const s = SEV[n.severity];
            return (
              <li key={n.key}>
                <NotificationLink nkey={n.key} href={n.href} read={false} className="flex h-full items-start gap-3 rounded-2xl border border-line p-3 transition hover:-translate-y-0.5 hover:shadow-card">
                  <span className={clsx("grid h-8 w-8 shrink-0 place-items-center rounded-lg", s.cls)}>
                    <s.icon className="h-4 w-4" aria-hidden />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-bold leading-snug">{n.title}</span>
                    <span className="line-clamp-2 text-xs text-ink-muted">{n.body}</span>
                  </span>
                </NotificationLink>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

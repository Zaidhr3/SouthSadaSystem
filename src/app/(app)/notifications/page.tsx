import clsx from "clsx";
import { AlertOctagon, AlertTriangle, BellOff, Check, CheckCheck, Info } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { computeNotifications, type NotificationKind } from "@/lib/notifications";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { ConfirmButton } from "@/components/forms";
import { NotificationLink } from "@/components/notification-link";
import { dismissAllNotifications, dismissNotification, restoreNotifications } from "../actions/admin";

export const metadata = { title: "التنبيهات" };

const KIND: Record<NotificationKind, string> = {
  cheque: "شيكات",
  deadline: "مواعيد التقديم",
  site_visit: "زيارات المواقع",
  guarantee: "الكفالات",
  document: "أوراق الشركة",
  fund: "طلبات التمويل",
  event: "إشعار",
  retention: "المحجوزات",
  variation: "أوامر التغيير",
  certificate: "مستخلصات الباطن",
  liquidity: "السيولة",
  collection: "التحصيل",
  claim: "المطالبات",
  tax: "الضريبة",
  message: "مراسلة داخلية",
  request: "طلبات المواد والعهد",
  debt: "الديون والأقساط",
};

const SEV = {
  critical: { icon: AlertOctagon, cls: "bg-bad-soft text-bad", label: "عاجل" },
  warning: { icon: AlertTriangle, cls: "bg-warn-soft text-warn", label: "قريب" },
  info: { icon: Info, cls: "bg-accent-soft text-accent", label: "للعلم" },
};

export default async function NotificationsPage() {
  const user = await requireUser();
  const all = await computeNotifications(user, { includeDismissed: true });
  const unread = all.filter((n) => !n.dismissed);
  const read = all.filter((n) => n.dismissed);

  return (
    <>
      <PageHeader
        title="مركز التنبيهات"
        subtitle={unread.length ? `${unread.length} غير مقروءة — الضغط على أي تنبيه يعلّمه «تم الفتح»` : "لا توجد تنبيهات غير مقروءة"}
        actions={
          <>
            {unread.length > 0 && (
              <ConfirmButton action={dismissAllNotifications.bind(null, unread.map((n) => n.key))} className="btn-secondary">
                <CheckCheck className="h-4 w-4" /> تعليم الكل كمقروء
              </ConfirmButton>
            )}
            {read.length > 0 && (
              <ConfirmButton action={restoreNotifications} className="btn-ghost">
                إعادة الكل غير مقروء
              </ConfirmButton>
            )}
          </>
        }
      />
      {all.length === 0 ? (
        <Card>
          <EmptyState icon={BellOff} title="لا توجد تنبيهات" hint="كل شيء تحت السيطرة — سيظهر هنا أي استحقاق قادم" />
        </Card>
      ) : (
        <ul className="space-y-2.5">
          {[...unread, ...read].map((n) => {
            const s = SEV[n.severity];
            return (
              <li
                key={n.key}
                className={clsx(
                  "card flex items-start gap-3 p-4 transition",
                  n.dismissed ? "bg-white/60 opacity-70" : "border-s-4 border-s-accent",
                )}
              >
                <span className={clsx("grid h-10 w-10 shrink-0 place-items-center rounded-xl", n.dismissed ? "bg-black/[0.04] text-ink-faint" : s.cls)}>
                  <s.icon className="h-5 w-5" aria-hidden />
                </span>
                <NotificationLink nkey={n.key} href={n.href} read={n.dismissed} className="min-w-0 flex-1">
                  <p className={clsx("flex flex-wrap items-center gap-2", n.dismissed ? "font-semibold text-ink-soft" : "font-bold")}>
                    {!n.dismissed && <span className="h-2 w-2 shrink-0 rounded-full bg-accent" aria-label="غير مقروء" />}
                    {n.title}
                    {n.dismissed ? (
                      <span className="rounded-full bg-black/[0.05] px-2 py-0.5 text-[11px] font-semibold text-ink-muted">✓ تم الفتح</span>
                    ) : (
                      <span className={clsx("rounded-full px-2 py-0.5 text-[11px] font-bold", s.cls)}>{s.label}</span>
                    )}
                    <span className="rounded-full bg-black/[0.05] px-2 py-0.5 text-[11px] font-semibold text-ink-muted">{KIND[n.kind]}</span>
                  </p>
                  <p className="mt-0.5 text-sm text-ink-muted">{n.body}</p>
                </NotificationLink>
                {!n.dismissed && (
                  <ConfirmButton action={dismissNotification.bind(null, n.key)} className="btn-ghost btn-sm" title="تعليم كمقروء">
                    <Check className="h-4 w-4" />
                  </ConfirmButton>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

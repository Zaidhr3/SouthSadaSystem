import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { notificationsForRequest } from "@/lib/notifications";
import { ROLE_LABELS } from "@/lib/labels";
import { AppShell } from "@/components/shell";
import { MandatoryNotice } from "@/components/mandatory-notice";
import { LiveNotifications } from "@/components/live-notifications";
import { userSees } from "@/lib/brand";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const [notes, unreadMessages, me, bankVisible] = await Promise.all([
    notificationsForRequest(user),
    db.message.count({ where: { recipientId: user.id, readAt: null } }),
    db.user.findUnique({ where: { id: user.id }, select: { notice: true, noticeSetAt: true, noticeAckAt: true } }),
    userSees(user, "bank"),
  ]);
  const pendingNotice = me?.notice && !me.noticeAckAt ? me : null;
  return (
    <AppShell user={{ name: user.name, role: user.role }} roleLabel={user.title || ROLE_LABELS[user.role]} unread={notes.length} unreadMessages={unreadMessages} notes={notes.map((n) => ({ key: n.key, href: n.href }))} bankVisible={bankVisible}>
      {user.actingFor && (
        <p className="no-print mb-4 rounded-2xl border border-warn/30 bg-warn-soft px-4 py-2.5 text-sm font-bold text-warn" role="status">
          تفويض مؤقت نافذ: تعمل الآن بصلاحيات «{ROLE_LABELS[user.actingFor.role]}» نيابةً عن {user.actingFor.name} حتى {user.actingFor.until.toLocaleDateString("en-GB")} — كل إجراء يُوثَّق «نيابة عن».
        </p>
      )}
      <LiveNotifications initialKeys={notes.map((n) => n.key)} />
      {children}
      {pendingNotice && <MandatoryNotice notice={pendingNotice.notice!} setAt={pendingNotice.noticeSetAt?.toISOString() ?? null} />}
    </AppShell>
  );
}

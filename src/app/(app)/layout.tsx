import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { notificationsForRequest } from "@/lib/notifications";
import { ROLE_LABELS } from "@/lib/labels";
import { AppShell } from "@/components/shell";
import { MandatoryNotice } from "@/components/mandatory-notice";
import { LiveNotifications } from "@/components/live-notifications";
import { userSees } from "@/lib/brand";
import { presetCss } from "@/lib/profile-presets";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const [notes, unreadMessages, me, bankVisible] = await Promise.all([
    notificationsForRequest(user),
    db.message.count({ where: { recipientId: user.id, readAt: null } }),
    db.user.findUnique({ where: { id: user.id }, select: { notice: true, noticeSetAt: true, noticeAckAt: true, boardSeat: true, avatarId: true, wallpaperId: true, wallpaperPreset: true } }),
    userSees(user, "bank"),
  ]);
  // شارة مجلس الإدارة: بنود تنتظر صوتي (للأعضاء) + بنود تنتظر تدقيقي (للمحاسب)
  const boardPending =
    (me?.boardSeat ? await db.boardMotion.count({ where: { status: "VOTING", votes: { none: { userId: user.id } } } }) : 0) +
    (user.role === "ACCOUNTANT" ? await db.boardMotion.count({ where: { status: "AUDIT" } }) : 0);
  const pendingNotice = me?.notice && !me.noticeAckAt ? me : null;
  return (
    <AppShell user={{ name: user.name, role: user.role }} roleLabel={user.title || ROLE_LABELS[user.role]} unread={notes.length} unreadMessages={unreadMessages} boardPending={boardPending} avatarId={me?.avatarId ?? null} wallpaper={me?.wallpaperId ? `url(/api/files/${me.wallpaperId}) center/cover no-repeat` : presetCss(me?.wallpaperPreset)} notes={notes.map((n) => ({ key: n.key, href: n.href }))} bankVisible={bankVisible}>
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

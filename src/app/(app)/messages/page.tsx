import Link from "next/link";
import clsx from "clsx";
import { Eye, Inbox, MessagesSquare, Send, Trash2 } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { ROLE_LABELS } from "@/lib/labels";
import { see } from "@/lib/permissions";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { ConfirmButton } from "@/components/forms";
import { deleteMessage } from "../actions/messages";
import { ComposeMessage } from "./compose";

export const metadata = { title: "المراسلات الداخلية" };

const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Amman", day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });

export default async function MessagesPage({ searchParams }: { searchParams: { box?: string; user?: string } }) {
  const user = await requireUser();
  // المدير العام والمشرف الأعلى: رقابة على كل المراسلات (الحذف للمدير العام فقط)
  const admin = see.allMessages(user.role);
  const canDelete = user.role === "ADMIN";
  const box = searchParams.box === "sent" ? "sent" : searchParams.box === "all" && admin ? "all" : "inbox";
  const filterUser = Number(searchParams.user) || undefined;

  // المدير العام: رقابة كاملة على كل المراسلات بين جميع المستخدمين
  const where: Prisma.MessageWhereInput =
    box === "inbox"
      ? { recipientId: user.id }
      : box === "sent"
        ? { senderId: user.id }
        : filterUser
          ? { OR: [{ senderId: filterUser }, { recipientId: filterUser }] }
          : {};
  const [rows, unread, users] = await Promise.all([
    db.message.findMany({
      where,
      include: { sender: { select: { name: true, role: true } }, recipient: { select: { name: true, role: true } } },
      orderBy: { createdAt: "desc" },
      take: 300,
    }),
    db.message.count({ where: { recipientId: user.id, readAt: null } }),
    admin ? db.user.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }) : Promise.resolve([]),
  ]);
  const tenderNames = new Map(
    (await db.tender.findMany({ where: { id: { in: rows.map((r) => r.tenderId).filter((x): x is number => x != null) } }, select: { id: true, name: true } })).map((t) => [t.id, t.name]),
  );
  const tab = (key: string, label: React.ReactNode, href: string) => (
    <Link href={href} className={clsx("flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold", box === key ? "bg-white shadow-card" : "text-ink-muted")}>{label}</Link>
  );

  return (
    <>
      <PageHeader title="المراسلات الداخلية" subtitle="مراسلات مباشرة بين الإدارة ومدراء المشاريع والمحاسب — لا يمكن حذف أي رسالة إلا من المدير العام" actions={<ComposeMessage user={user} />} />
      <nav className="mb-4 flex flex-wrap gap-1 rounded-2xl bg-black/[0.04] p-1 sm:w-fit">
        {tab("inbox", <><Inbox className="h-4 w-4" /> الوارد {unread > 0 && <span className="num rounded-full bg-accent px-1.5 text-[11px] text-white">{unread}</span>}</>, "/messages")}
        {tab("sent", <><Send className="h-4 w-4" /> المرسل</>, "/messages?box=sent")}
        {admin && tab("all", <><Eye className="h-4 w-4" /> كل المراسلات (رقابة)</>, "/messages?box=all")}
      </nav>
      {box === "all" && (
        <form className="mb-4 flex gap-2 sm:w-96">
          <input type="hidden" name="box" value="all" />
          <select name="user" defaultValue={searchParams.user ?? ""} className="input">
            <option value="">كل المستخدمين</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <button className="btn-primary">تصفية</button>
        </form>
      )}
      <Card pad={false}>
        {rows.length === 0 ? (
          <EmptyState icon={MessagesSquare} title={box === "inbox" ? "لا توجد رسائل واردة" : box === "sent" ? "لم ترسل رسائل بعد" : "لا توجد مراسلات"} />
        ) : box === "all" ? (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>الوقت</th>
                  <th>من</th>
                  <th>إلى</th>
                  <th>الموضوع</th>
                  <th>العطاء</th>
                  <th>الحالة</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => (
                  <tr key={m.id}>
                    <td className="num whitespace-nowrap text-xs">{time.format(m.createdAt)}</td>
                    <td className="whitespace-nowrap"><span className="block font-semibold">{m.sender.name}</span><span className="text-[11px] text-ink-muted">{ROLE_LABELS[m.sender.role]}</span></td>
                    <td className="whitespace-nowrap"><span className="block font-semibold">{m.recipient.name}</span><span className="text-[11px] text-ink-muted">{ROLE_LABELS[m.recipient.role]}</span></td>
                    <td className="max-w-[320px]">
                      <Link href={`/messages/${m.id}`} className="block truncate font-semibold hover:text-accent">{m.subject}</Link>
                      <span className="block truncate text-xs text-ink-muted">{m.body}</span>
                    </td>
                    <td className="text-xs text-ink-soft">{m.tenderId ? <Link href={`/tenders/${m.tenderId}`} className="hover:text-accent">{tenderNames.get(m.tenderId)}</Link> : "—"}</td>
                    <td className="whitespace-nowrap text-[11px]">{m.readAt ? <span className="text-good">✓✓ قُرئت {time.format(m.readAt)}</span> : <span className="text-ink-muted">✓ لم تُقرأ</span>}</td>
                    <td>
                      {canDelete && (
                      <ConfirmButton action={deleteMessage.bind(null, m.id)} confirm="حذف هذه الرسالة نهائياً؟ (يُسجل في سجل الرقابة مع نصها الكامل)" className="btn-danger btn-sm" title="حذف الرسالة">
                        <Trash2 className="h-4 w-4" />
                      </ConfirmButton>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((m) => {
              const isUnread = box === "inbox" && !m.readAt;
              return (
                <li key={m.id}>
                  <Link href={`/messages/${m.id}`} className={clsx("flex items-start gap-3 px-5 py-3.5 transition hover:bg-canvas sm:px-6", isUnread && "bg-accent-soft/40")}>
                    <span className={clsx("mt-2 h-2 w-2 shrink-0 rounded-full", isUnread ? "bg-accent" : "bg-transparent")} aria-label={isUnread ? "غير مقروءة" : undefined} />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className={clsx("text-sm", isUnread ? "font-bold" : "font-semibold text-ink-soft")}>{box === "inbox" ? m.sender.name : `إلى: ${m.recipient.name}`}</span>
                        <span className="num text-xs text-ink-muted">{time.format(m.createdAt)}</span>
                      </span>
                      <span className={clsx("block truncate text-sm", isUnread ? "font-bold text-ink" : "text-ink-soft")}>{m.subject}</span>
                      <span className="block truncate text-xs text-ink-muted">
                        {m.tenderId && <span className="me-1 rounded bg-black/[0.05] px-1.5">{tenderNames.get(m.tenderId)}</span>}
                        {m.body}
                      </span>
                    </span>
                    {box === "sent" && <span className="shrink-0 text-[11px] text-ink-muted">{m.readAt ? "✓✓ تمت القراءة" : "✓ أُرسلت"}</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}

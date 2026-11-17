import Link from "next/link";
import { notFound } from "next/navigation";
import clsx from "clsx";
import { Reply } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { see } from "@/lib/permissions";
import { Card, PageHeader } from "@/components/ui";
import { ActionForm, ConfirmButton, Textarea } from "@/components/forms";
import { deleteMessage, sendMessage } from "../../actions/messages";

export const metadata = { title: "رسالة" };

const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Amman", dateStyle: "short", timeStyle: "short" });

/** عرض المحادثة — فتحها يعلّم الرسائل الواردة «تمت القراءة» ويغلق إشعارها */
export default async function MessageThreadPage({ params }: { params: { id: string } }) {
  const user = await requireUser();
  const id = Number(params.id);
  const msg = await db.message.findUnique({
    where: { id: Number.isInteger(id) ? id : 0 },
    include: { sender: { select: { id: true, name: true } }, recipient: { select: { id: true, name: true } } },
  });
  const admin = see.allMessages(user.role);
  const participant = !!msg && (msg.senderId === user.id || msg.recipientId === user.id);
  // المدير العام يطّلع على أي محادثة (رقابة)؛ غيره يرى محادثاته فقط
  if (!msg || (!participant && !admin)) notFound();
  const rootId = msg.parentId ?? msg.id;
  const thread = await db.message.findMany({
    where: { OR: [{ id: rootId }, { parentId: rootId }], ...(admin ? {} : { AND: { OR: [{ senderId: user.id }, { recipientId: user.id }] } }) },
    include: { sender: { select: { id: true, name: true } }, recipient: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });
  const root = thread.find((m) => m.id === rootId) ?? msg;

  // تعليم الوارد كمقروء + إغلاق إشعارات هذه الرسائل
  const unreadIds = thread.filter((m) => m.recipientId === user.id && !m.readAt).map((m) => m.id);
  if (unreadIds.length) {
    const now = new Date();
    await db.message.updateMany({ where: { id: { in: unreadIds } }, data: { readAt: now } });
    await db.notificationEvent.updateMany({ where: { userId: user.id, readAt: null, href: { in: unreadIds.map((i) => `/messages/${i}`) } }, data: { readAt: now } });
  }
  const other = root.senderId === user.id ? root.recipient : root.sender;
  const oversight = admin && root.senderId !== user.id && root.recipientId !== user.id;
  const tender = root.tenderId ? await db.tender.findUnique({ where: { id: root.tenderId }, select: { id: true, name: true } }) : null;

  return (
    <>
      <PageHeader back={{ href: "/messages", label: "المراسلات" }} title={root.subject} subtitle={<>{oversight ? <>رقابة الإدارة: محادثة بين {root.sender.name} و{root.recipient.name}</> : <>محادثة مع {other.name}</>}{tender && <> — <Link href={`/tenders/${tender.id}`} className="text-accent hover:underline">{tender.name}</Link></>}{root.claimId && <> — <Link href={`/claims/${root.claimId}#claim-messages`} className="text-accent hover:underline">فتح المطالبة</Link></>}</>} />
      <div className="mx-auto max-w-3xl space-y-3">
        {thread.map((m) => {
          const mine = oversight ? m.senderId === root.senderId : m.senderId === user.id;
          return (
            <div key={m.id} className={clsx("flex", mine ? "justify-start" : "justify-end")}>
              <div className={clsx("max-w-[85%] rounded-2xl px-4 py-3 shadow-card", mine ? "bg-accent text-white" : "border border-line bg-white")}>
                <p className={clsx("mb-1 text-xs font-semibold", mine ? "text-white/80" : "text-ink-muted")}>{m.sender.name} ← {m.recipient.name} — <span className="num">{time.format(m.createdAt)}</span></p>
                <p className="whitespace-pre-line text-[15px] leading-relaxed">{m.body}</p>
                {(mine || oversight) && <p className={clsx("mt-1 text-end text-[11px]", mine ? "text-white/80" : "text-ink-muted")}>{m.readAt ? `✓✓ تمت القراءة ${time.format(m.readAt)}` : "✓ أُرسلت"}</p>}
                {user.role === "ADMIN" && (
                  <div className="mt-1 text-end">
                    <ConfirmButton action={deleteMessage.bind(null, m.id)} confirm="حذف هذه الرسالة نهائياً؟ (صلاحية المدير العام فقط — تُسجل في سجل الرقابة)" className={clsx("text-[11px] font-semibold underline", mine ? "text-white/80" : "text-bad")} title="حذف الرسالة">
                      حذف
                    </ConfirmButton>
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {oversight ? (
          <p className="rounded-xl bg-canvas p-3 text-center text-sm text-ink-muted">وضع الرقابة: أنت تطّلع على محادثة لست طرفاً فيها — لا يغيّر الاطلاع حالة القراءة لدى المستلم.</p>
        ) : (
        <Card title={<span className="flex items-center gap-2"><Reply className="h-5 w-5" /> رد</span>}>
          <ActionForm action={sendMessage} submitLabel="إرسال الرد" resetOnSuccess allowReadOnly>
            <input type="hidden" name="recipientId" value={other.id} />
            <input type="hidden" name="subject" value={root.subject.startsWith("رد:") ? root.subject : `رد: ${root.subject}`} />
            <input type="hidden" name="parentId" value={rootId} />
            {root.claimId && <input type="hidden" name="claimId" value={root.claimId} />}
            {root.tenderId && <input type="hidden" name="tenderId" value={root.tenderId} />}
            <Textarea name="body" label={`إلى ${other.name}`} required rows={4} />
          </ActionForm>
        </Card>
        )}
      </div>
    </>
  );
}

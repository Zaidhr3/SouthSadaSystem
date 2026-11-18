"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { Facebook, FileInput, Instagram, Loader2, Send, Wand2 } from "lucide-react";
import clsx from "clsx";
import { inboxToQuoteAction, sendInboxAction, suggestInboxAction, type InboxState } from "../../actions/inbox";
import type { Conversation } from "@/lib/inbox";

function Btn({ children, className }: { children: React.ReactNode; className: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={className}>
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
      {children}
    </button>
  );
}

/** محادثة واحدة: الرسائل + رد مباشر + اقتراح ذكي + تحويل لطلب تسعير */
export function ConversationCard({ c, canReply }: { c: Conversation; canReply: boolean }) {
  const [sent, send] = useFormState<InboxState, FormData>(sendInboxAction.bind(null, c.platform, c.userId), {});
  const [sug, suggest] = useFormState<InboxState, FormData>(suggestInboxAction.bind(null, c.platform, c.id), {});
  const [quote, toQuote] = useFormState<InboxState, FormData>(inboxToQuoteAction.bind(null, c.platform, c.id), {});
  const [text, setText] = useState("");
  useEffect(() => {
    if (sug.suggestion) setText(sug.suggestion);
  }, [sug]);
  useEffect(() => {
    if (sent.ok) setText("");
  }, [sent]);
  const Icon = c.platform === "messenger" ? Facebook : Instagram;
  const lastFromClient = [...c.messages].reverse().find((m) => !m.mine);
  const windowOpen = lastFromClient ? Date.now() - +new Date(lastFromClient.at) < 24 * 3600_000 : false;
  return (
    <div className={clsx("card p-4", c.unread > 0 && "border-s-4 border-s-accent")}>
      <p className="mb-2 flex items-center gap-2 text-sm">
        <Icon className={c.platform === "messenger" ? "h-4 w-4 text-[#1877f2]" : "h-4 w-4 text-[#d6249f]"} />
        <b className="text-navy">{c.name}</b>
        {c.unread > 0 && <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-black text-white">{c.unread} جديدة</span>}
        <span className="ms-auto text-xs text-ink-muted">{new Date(c.updated).toLocaleString("en-GB", { timeZone: "Asia/Amman", dateStyle: "short", timeStyle: "short" })}</span>
      </p>
      <ul className="max-h-72 space-y-1.5 overflow-y-auto rounded-xl bg-black/[0.03] p-2.5">
        {c.messages.map((m) => (
          <li key={m.id} className={clsx("flex", m.mine ? "justify-end" : "justify-start")}>
            <span className={clsx("max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-1.5 text-sm", m.mine ? "bg-navy text-white" : "bg-white shadow-card")}>{m.text}</span>
          </li>
        ))}
      </ul>
      {canReply && (
        <div className="mt-3 space-y-2">
          {!windowOpen && <p className="rounded-xl bg-warn-soft px-3 py-1.5 text-xs font-semibold text-warn">مرّت 24 ساعة على آخر رسالة للعميل — Meta لا تسمح بالرد من النظام الآن. تواصل معه هاتفياً.</p>}
          <form action={send} className="space-y-2">
            <textarea name="message" value={text} onChange={(e) => setText(e.target.value)} className="input min-h-[64px] text-sm" placeholder="اكتب الرد…" required />
            <Btn className="btn-primary btn-sm"><Send className="h-4 w-4 -scale-x-100" /> إرسال</Btn>
          </form>
          <div className="flex flex-wrap gap-2">
            <form action={suggest}>
              <Btn className="btn-ghost btn-sm"><Wand2 className="h-4 w-4" /> اقتراح رد ذكي</Btn>
            </form>
            <form action={toQuote}>
              <Btn className="btn-secondary btn-sm"><FileInput className="h-4 w-4" /> حوّلها لطلب تسعير</Btn>
            </form>
          </div>
          {sent.ok && <p className="text-sm font-semibold text-good">{sent.ok}</p>}
          {quote.ok && <p className="text-sm font-semibold text-good">{quote.ok} {quote.quoteId && <Link href={`/quotes/${quote.quoteId}`} className="underline">فتح الطلب</Link>}</p>}
          {[sent.error, sug.error, quote.error].filter(Boolean).map((e) => <p key={e} className="text-sm font-semibold text-bad">{e}</p>)}
        </div>
      )}
    </div>
  );
}

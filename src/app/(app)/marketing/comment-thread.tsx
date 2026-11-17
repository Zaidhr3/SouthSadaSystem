"use client";

import { useEffect, useRef, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { Facebook, Instagram, Loader2, Send, Wand2 } from "lucide-react";
import { replyCommentAction, suggestReplyAction, type ReplyState } from "../actions/meta";
import type { MetaComment } from "@/lib/meta";

function Btn({ children, className }: { children: React.ReactNode; className: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={className}>
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
      {children}
    </button>
  );
}

/** تعليق واحد مع ردوده، ورد مباشر على المنصة (مع اقتراح رد ذكي) */
export function CommentThread({ comment: c, itemId, post, canReply }: { comment: MetaComment; itemId: number; post: string; canReply: boolean }) {
  const [sent, send] = useFormState<ReplyState, FormData>(replyCommentAction.bind(null, itemId, c.platform, c.id), {});
  const [sug, suggest] = useFormState<ReplyState, FormData>(suggestReplyAction.bind(null, { author: c.author, text: c.text, post }), {});
  const [text, setText] = useState("");
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (sug.suggestion) setText(sug.suggestion);
  }, [sug]);
  useEffect(() => {
    if (sent.ok) setText("");
  }, [sent]);
  const Icon = c.platform === "facebook" ? Facebook : Instagram;
  return (
    <div className="rounded-2xl border border-line p-3">
      <p className="flex items-center gap-2 text-sm">
        <Icon className={c.platform === "facebook" ? "h-4 w-4 text-[#1877f2]" : "h-4 w-4 text-[#d6249f]"} />
        <b>{c.author}</b>
        <span className="text-xs text-ink-muted">{new Date(c.at).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" })}</span>
      </p>
      <p className="mt-1 whitespace-pre-wrap text-[15px]">{c.text}</p>
      {c.replies.length > 0 && (
        <ul className="mt-2 space-y-1.5 border-s-2 border-line ps-3">
          {c.replies.map((r) => (
            <li key={r.id} className={r.mine ? "text-sm text-accent" : "text-sm"}>
              <b>{r.mine ? "صدى الجنوب" : r.author}:</b> {r.text}
            </li>
          ))}
        </ul>
      )}
      {canReply && (
        <div className="mt-3 space-y-2">
          <form action={send} className="space-y-2">
            <textarea ref={area} name="message" value={text} onChange={(e) => setText(e.target.value)} className="input min-h-[70px] text-sm" placeholder="اكتب الرد…" required />
            <div className="flex flex-wrap gap-2">
              <Btn className="btn-primary btn-sm"><Send className="h-4 w-4" /> رد على {c.platform === "facebook" ? "فيسبوك" : "إنستغرام"}</Btn>
            </div>
          </form>
          <form action={suggest}>
            <Btn className="btn-ghost btn-sm"><Wand2 className="h-4 w-4" /> اقتراح رد ذكي</Btn>
          </form>
          {sent.ok && <p className="text-sm font-semibold text-good">{sent.ok}</p>}
          {(sent.error || sug.error) && <p className="text-sm font-semibold text-bad">{sent.error || sug.error}</p>}
        </div>
      )}
    </div>
  );
}

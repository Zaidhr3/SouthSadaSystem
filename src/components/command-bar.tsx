"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { Bot, Loader2, Send, Sparkles } from "lucide-react";
import { askAssistant } from "@/app/(app)/actions/assistant";

function greeting(h: number) {
  if (h < 5) return "مسا الخير";
  if (h < 12) return "صباح الخير";
  if (h < 17) return "يعطيك العافية";
  return "مسا الخير";
}

function SendBtn() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-gold to-accent text-navy shadow-glow transition hover:brightness-110 disabled:opacity-70" aria-label="اسأل">
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4 -scale-x-100" />}
    </button>
  );
}

/** شريط القيادة أعلى الصفحات: تحية + التاريخ (ميلادي وهجري) + سؤال سريع للمساعد الذكي من أي صفحة */
export function CommandBar({ name, canAsk }: { name: string; canAsk: boolean }) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  const hour = now ? Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: "Asia/Amman" }).format(now)) : 9;
  const greg = now ? new Intl.DateTimeFormat("ar-JO-u-nu-latn", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Amman" }).format(now) : "";
  const hijri = now ? new Intl.DateTimeFormat("ar-SA-u-ca-islamic-umalqura-nu-latn", { day: "numeric", month: "long", timeZone: "Asia/Amman" }).format(now) : "";
  return (
    <div className="no-print mb-5 flex flex-col gap-3 rounded-3xl border border-white/60 bg-white/70 px-4 py-3 shadow-card backdrop-blur-md sm:flex-row sm:items-center">
      <div className="flex min-w-0 items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-navy to-navy-3 text-gold"><Sparkles className="h-5 w-5" /></span>
        <div className="min-w-0 leading-tight">
          <p className="truncate text-[15px] font-extrabold text-navy">{greeting(hour)}، {name.replace(/^م\.\s*/, "").split(" ")[0]}</p>
          <p className="truncate text-xs font-semibold text-ink-muted" suppressHydrationWarning>{greg}{hijri ? ` · ${hijri}` : ""}</p>
        </div>
      </div>
      {canAsk && (
        <form action={async (fd) => { await askAssistant(null, {}, fd); }} className="flex flex-1 items-center gap-2 rounded-2xl border border-line bg-white px-2 py-1.5 sm:ms-auto sm:max-w-xl">
          <Bot className="ms-1 h-5 w-5 shrink-0 text-accent" />
          <input name="message" required minLength={2} autoComplete="off" placeholder="اسأل المساعد عن أي إشي بالشركة… مثلاً: شو المستحق علينا هالأسبوع؟" className="min-w-0 flex-1 bg-transparent py-1.5 text-sm outline-none placeholder:text-ink-faint" />
          <SendBtn />
        </form>
      )}
    </div>
  );
}

/** حقل «اسأل المساعد» — لرأس لوحة التحكم */
export function CommandBarInput() {
  return (
    <form action={async (fd) => { await askAssistant(null, {}, fd); }} className="flex items-center gap-2 rounded-2xl bg-white/95 px-2 py-1.5 shadow-card ring-1 ring-black/5">
      <Bot className="ms-1 h-5 w-5 shrink-0 text-accent" />
      <input name="message" required minLength={2} autoComplete="off" placeholder="اسأل المساعد… مثلاً: شو المستحق علينا هالأسبوع؟" className="min-w-0 flex-1 bg-transparent py-1.5 text-sm text-ink outline-none placeholder:text-ink-faint" />
      <SendBtn />
    </form>
  );
}

/** زر المساعد العائم (للحاسوب) */
export function AssistantFab() {
  return (
    <Link href="/assistant" className="no-print fixed bottom-6 end-6 z-30 hidden items-center gap-2 rounded-full bg-gradient-to-l from-navy to-navy-3 px-4 py-3 text-sm font-bold text-white shadow-pop ring-2 ring-gold/60 transition hover:-translate-y-0.5 lg:flex" title="المساعد الذكي">
      <Bot className="h-5 w-5 text-gold" /> المساعد
    </Link>
  );
}

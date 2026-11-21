"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { Bot, CornerDownLeft, Plus, Search, type LucideIcon } from "lucide-react";
import { navFor, type Role } from "./nav-config";
import { normalizeText } from "@/lib/text";
import { askAssistant } from "@/app/(app)/actions/assistant";

type Cmd = { id: string; label: string; hint?: string; icon: LucideIcon; tint?: string; run: () => void; keys: string };

const QUICK: { label: string; href: string; roles?: Role[]; keys: string }[] = [
  { label: "مصروف جديد", href: "/expenses/new", roles: ["ADMIN", "ACCOUNTANT", "PM"], keys: "صرف مصروف" },
  { label: "عطاء جديد", href: "/tenders/new", roles: ["ADMIN"], keys: "عطاء مشروع" },
  { label: "مطالبة جديدة", href: "/claims/new", roles: ["ADMIN", "ACCOUNTANT", "PM"], keys: "مطالبة مستخلص" },
  { label: "بند جديد لمجلس الإدارة", href: "/board", roles: ["ADMIN", "ACCOUNTANT"], keys: "مجلس تصويت قرار" },
  { label: "غرفة النقد — اعرض قراراً على 7 مستشارين", href: "/board?tab=roast", roles: ["ADMIN", "ACCOUNTANT"], keys: "roast نقد مستشار" },
  { label: "منشور أو ستوري جديد", href: "/marketing", roles: ["ADMIN"], keys: "تسويق تصميم canva" },
  { label: "صورة بالذكاء الاصطناعي (جمعة مباركة، تهنئة…)", href: "/marketing/studio", roles: ["ADMIN"], keys: "استوديو صورة تهنئة جمعة" },
];

/** لوحة الأوامر (Ctrl/⌘ + K): انتقال فوري لأي قسم، إجراءات سريعة، وسؤال المساعد الذكي */
export function CommandPalette({ role, bankVisible, canAsk }: { role: Role; bankVisible?: boolean; canAsk: boolean }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);

  const close = useCallback(() => { setOpen(false); setQ(""); setSel(0); }, []);
  const go = useCallback((href: string) => { close(); router.push(href); }, [close, router]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen((o) => !o); }
      else if (e.key === "Escape") close();
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("sada:palette", onOpen);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("sada:palette", onOpen); };
  }, [close]);
  useEffect(() => { if (open) setTimeout(() => input.current?.focus(), 30); }, [open]);

  const all = useMemo<Cmd[]>(() => {
    const nav = navFor(role, bankVisible).flatMap((g) => g.items.map((i) => ({ id: i.href, label: i.label, hint: g.section || "الرئيسية", icon: i.icon, tint: i.tint, run: () => go(i.href), keys: `${i.label} ${g.section} ${i.keywords ?? ""}` })));
    const quick = QUICK.filter((x) => !x.roles || x.roles.includes(role)).map((x) => ({ id: `q:${x.href}:${x.label}`, label: x.label, hint: "إجراء سريع", icon: Plus, tint: "#e8590c", run: () => go(x.href), keys: `${x.label} ${x.keys}` }));
    return [...quick, ...nav];
  }, [role, bankVisible, go]);

  const items = useMemo(() => {
    const n = normalizeText(q);
    const base = n ? all.filter((c) => n.split(" ").every((t) => normalizeText(c.keys).includes(t))) : all;
    const ask: Cmd[] = canAsk && q.trim().length >= 3 ? [{ id: "ask", label: `اسأل المساعد: «${q.trim()}»`, hint: "الذكاء الاصطناعي", icon: Bot, tint: "#a78bfa", keys: "", run: () => { const fd = new FormData(); fd.set("message", q.trim()); close(); void askAssistant(null, {}, fd); } }] : [];
    return [...base.slice(0, 40), ...ask];
  }, [q, all, canAsk, close]);

  useEffect(() => setSel(0), [q]);
  useEffect(() => { list.current?.querySelector<HTMLElement>(`[data-i="${sel}"]`)?.scrollIntoView({ block: "nearest" }); }, [sel]);

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-start justify-center px-3 pt-[10vh]" role="dialog" aria-modal="true" aria-label="البحث السريع">
      <div className="absolute inset-0 animate-fade-in bg-navy/50 backdrop-blur-sm" onClick={close} />
      <div className="lg-chrome relative w-full max-w-xl animate-pop-in overflow-hidden rounded-[22px] shadow-pop">
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Search className="h-5 w-5 shrink-0 text-accent" />
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(items.length - 1, s + 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
              else if (e.key === "Enter") { e.preventDefault(); items[sel]?.run(); }
            }}
            placeholder={canAsk ? "اذهب لأي قسم، أو اكتب سؤالاً للمساعد…" : "اذهب لأي قسم…"}
            className="h-14 min-w-0 flex-1 bg-transparent text-[16px] font-semibold outline-none placeholder:text-ink-faint focus:outline-none focus-visible:outline-none"
          />
          <kbd className="hidden rounded-md border border-line px-1.5 py-0.5 text-[11px] font-bold text-ink-muted sm:block">Esc</kbd>
        </div>
        <ul ref={list} className="max-h-[56vh] overflow-y-auto p-2">
          {items.length === 0 && <li className="p-6 text-center text-sm text-ink-muted">لا نتائج</li>}
          {items.map((c, i) => {
            const Icon = c.icon;
            return (
              <li key={c.id}>
                <button type="button" data-i={i} onMouseMove={() => setSel(i)} onClick={c.run}
                  className={clsx("flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-start transition", sel === i ? "bg-navy text-white" : "text-ink hover:bg-canvas")}>
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg" style={{ background: sel === i ? "rgba(255,255,255,.12)" : `${c.tint ?? "#0b2545"}22`, color: sel === i ? "#f2b134" : c.tint }}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[14px] font-bold">{c.label}</span>
                  <span className={clsx("shrink-0 text-[11px] font-semibold", sel === i ? "text-white/60" : "text-ink-faint")}>{c.hint}</span>
                  {sel === i && <CornerDownLeft className="h-4 w-4 shrink-0 text-gold" />}
                </button>
              </li>
            );
          })}
        </ul>
        <p className="border-t border-line px-4 py-2 text-[11px] text-ink-faint">↑↓ للتنقل · Enter للفتح · Ctrl/⌘ + K للفتح من أي مكان</p>
      </div>
    </div>,
    document.body,
  );
}

export const openPalette = () => window.dispatchEvent(new Event("sada:palette"));

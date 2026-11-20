"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { Bell, Briefcase, ChevronDown, Eye, Gavel, Home, LayoutGrid, LogOut, MessagesSquare, Plus, Receipt, Search, type LucideIcon } from "lucide-react";
import { SeenTracker } from "./seen-tracker";
import { IdleLock } from "./idle-lock";
import { logout } from "@/app/login/actions";
import { Logo } from "./logo";
import { CraneMark } from "./crane-mark";
import { ReadOnlyProvider, haptic } from "./forms";
import { AssistantFab } from "./command-bar";
import { CommandPalette, openPalette } from "./command-palette";
import { LiveClock, ClockCard } from "./clock";
import { EdgeSwipeBack, useSheetDrag } from "./ios-gestures";
import { currentItem, isActive, navFor, type Role } from "./nav-config";
import { Avatar } from "./profile-card";

const READ_ONLY: Role[] = ["CHAIRMAN", "AUDITOR"];
type Counts = { unread: number; unreadMessages: number; board: number };

function Badge({ n, tone = "accent", active }: { n: number; tone?: "accent" | "bad"; active?: boolean }) {
  if (!n) return null;
  return <span className={clsx("num min-w-[20px] rounded-full px-1.5 text-center text-[11px] font-black leading-5", active ? "bg-navy text-white" : tone === "bad" ? "badge-ping bg-bad text-white" : "bg-accent text-white")}>{n > 99 ? "99+" : n}</span>;
}

const badgeFor = (href: string, c: Counts) => (href === "/messages" ? c.unreadMessages : href === "/notifications" ? c.unread : href === "/board" ? c.board : 0);

/* ───────────── الشريط الجانبي (الحاسوب) ───────────── */
function Sidebar({ role, bankVisible, counts, name, roleLabel, avatarId }: { role: Role; bankVisible?: boolean; counts: Counts; name: string; roleLabel: string; avatarId?: number | null }) {
  const pathname = usePathname();
  const groups = useMemo(() => navFor(role, bankVisible), [role, bankVisible]);
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  useEffect(() => {
    try { setClosed(JSON.parse(localStorage.getItem("sada:nav") || "{}")); } catch { /* */ }
  }, []);
  const toggle = (id: string) => setClosed((c) => { const n = { ...c, [id]: !c[id] }; try { localStorage.setItem("sada:nav", JSON.stringify(n)); } catch { /* */ } return n; });

  return (
    <aside className="sidebar-navy sidebar-grand sticky top-0 hidden h-[100dvh] w-[312px] shrink-0 flex-col overflow-hidden text-white lg:flex">
      <CraneMark className="pointer-events-none absolute -bottom-12 -start-16 h-96 w-96 text-white/[0.035]" />
      <div className="sb-brand relative px-5 pb-4 pt-6">
        <Link href="/" className="flex items-center gap-3.5">
          <span className="sb-logo grid h-[62px] w-[62px] shrink-0 place-items-center rounded-[20px] bg-white"><Logo height={46} /></span>
          <span className="leading-tight">
            <span className="block text-[22px] font-black tracking-tight text-white">صدى الجنوب</span>
            <span className="sb-gold-text block text-[13px] font-extrabold">للمقاولات الإنشائية</span>
          </span>
        </Link>
      </div>
      <div className="px-4 pb-3">
        <button type="button" onClick={openPalette} className="flex w-full items-center gap-3 rounded-2xl bg-white/[0.07] px-4 py-3 text-[15px] font-bold text-white/65 ring-1 ring-white/10 transition hover:bg-white/[0.12] hover:text-white">
          <Search className="h-5 w-5 text-gold" /> ابحث أو انتقل…
          <kbd className="ms-auto rounded-md bg-white/10 px-1.5 py-0.5 text-[11px] font-bold text-white/70" dir="ltr">Ctrl K</kbd>
        </button>
      </div>
      <nav className="relative flex-1 space-y-1.5 overflow-y-auto px-4 pb-5 [scrollbar-width:thin]" aria-label="القائمة الرئيسية">
        {groups.map((g) => {
          const hasActive = g.items.some((i) => isActive(pathname, i.href));
          const isClosed = !!g.section && closed[g.id] && !hasActive;
          const groupCount = g.items.reduce((s, i) => s + badgeFor(i.href, counts), 0);
          return (
            <div key={g.id} className={clsx(g.section && "pt-3")}>
              {g.section && (
                <button type="button" onClick={() => toggle(g.id)} className="sb-section group mb-1.5 flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13px] font-black tracking-wide transition" aria-expanded={!isClosed}>
                  <span className="sb-rule w-4" aria-hidden />
                  <span className="sb-gold-text">{g.section}</span>
                  <span className="sb-rule flex-1" aria-hidden />
                  {isClosed && groupCount > 0 && <span className="num rounded-full bg-accent px-2 text-[11px] text-white">{groupCount}</span>}
                  <ChevronDown className={clsx("h-4 w-4 text-gold/70 transition-transform duration-300", isClosed && "rotate-90")} />
                </button>
              )}
              <ul className={clsx("grid transition-[grid-template-rows] duration-300 ease-out", isClosed ? "grid-rows-[0fr]" : "grid-rows-[1fr]")}>
                <li className="min-h-0 overflow-hidden">
                  <ul className="space-y-1">
                    {g.items.map((item) => {
                      const active = isActive(pathname, item.href);
                      const Icon = item.icon;
                      return (
                        <li key={item.href}>
                          <Link
                            href={item.href}
                            className={clsx("nav-link group relative flex items-center gap-3.5 rounded-2xl px-3 py-[9px] text-[16px] font-bold transition", active ? "nav-active text-navy" : "text-white/80 hover:bg-white/[0.08] hover:text-white")}
                            aria-current={active ? "page" : undefined}
                          >
                            <span className={clsx("sb-icon grid h-9 w-9 shrink-0 place-items-center rounded-xl transition", active ? "bg-navy text-gold" : "bg-white/[0.07] group-hover:bg-white/[0.12]")} style={active ? undefined : { color: item.tint }}>
                              <Icon className="h-[19px] w-[19px]" aria-hidden />
                            </span>
                            <span className="flex-1 truncate">{role === "PM" && item.pmLabel ? item.pmLabel : item.label}</span>
                            <Badge n={badgeFor(item.href, counts)} tone={item.href === "/notifications" ? "bad" : "accent"} active={active} />
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              </ul>
            </div>
          );
        })}
      </nav>
      <div className="sb-foot p-4">
        <div className="flex items-center gap-3 rounded-[20px] bg-white/[0.07] p-3 ring-1 ring-gold/25">
          <Link href="/settings"><Avatar name={name} avatarId={avatarId} size={48} ring /></Link>
          <Link href="/settings" className="min-w-0 flex-1 leading-tight">
            <span className="block truncate text-[16px] font-black text-white">{name}</span>
            <span className="sb-gold-text block truncate text-[12.5px] font-bold">{roleLabel}</span>
          </Link>
          <form action={logout}>
            <button type="submit" className="grid h-10 w-10 place-items-center rounded-full text-white/60 transition hover:bg-white/10 hover:text-[#ff9b9b]" title="تسجيل الخروج" aria-label="تسجيل الخروج">
              <LogOut className="h-5 w-5" />
            </button>
          </form>
        </div>
      </div>
    </aside>
  );
}

/* ───────────── شريط الرأس (الحاسوب) ───────────── */
function TopBar({ counts }: { counts: Counts }) {
  const pathname = usePathname();
  const item = currentItem(pathname);
  const Icon = item?.icon;
  return (
    <header className="topbar no-print sticky top-0 z-30 hidden h-[76px] items-center gap-3 px-6 lg:flex xl:px-10">
      <div className="flex min-w-0 items-center gap-2.5">
        {Icon && <span className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-navy to-navy-3 text-gold shadow-card ring-1 ring-gold/30"><Icon className="h-5 w-5" /></span>}
        <span className="truncate text-[20px] font-black text-navy">{item?.label ?? "صدى الجنوب"}</span>
      </div>
      <div className="ms-auto flex items-center gap-2">
        <button type="button" onClick={openPalette} className="flex h-12 w-72 items-center gap-2 rounded-2xl border border-line bg-white/80 px-4 text-[15px] font-semibold text-ink-faint shadow-[0_1px_2px_rgba(0,0,0,.04)] transition hover:border-accent/40 hover:text-ink-muted xl:w-80">
          <Search className="h-4 w-4 text-accent" /> ابحث، انتقل، أو اسأل المساعد…
          <kbd className="ms-auto rounded-md bg-canvas px-1.5 text-[10px] font-bold text-ink-muted" dir="ltr">Ctrl K</kbd>
        </button>
        <div className="flex h-10 items-center gap-2 rounded-xl bg-navy px-3 text-white shadow-card" title="توقيت عمّان">
          <span className="h-2 w-2 rounded-full bg-good shadow-[0_0_8px_#1e8e3e]" aria-hidden />
          <LiveClock className="text-[17px]" />
        </div>
        <IconLink href="/messages" icon={MessagesSquare} n={counts.unreadMessages} label="المراسلات" />
        <IconLink href="/notifications" icon={Bell} n={counts.unread} label="التنبيهات" bad />
      </div>
    </header>
  );
}

function IconLink({ href, icon: Icon, n, label, bad }: { href: string; icon: LucideIcon; n: number; label: string; bad?: boolean }) {
  return (
    <Link href={href} className="relative grid h-12 w-12 place-items-center rounded-2xl border border-line bg-white/80 text-ink-soft transition hover:border-accent/40 hover:text-accent" aria-label={`${label}${n ? ` (${n})` : ""}`} title={label}>
      <Icon className="h-[22px] w-[22px]" />
      {n > 0 && <span className={clsx("num absolute -end-1.5 -top-1.5 min-w-[18px] rounded-full px-1 text-center text-[10px] font-black leading-[18px] text-white ring-2 ring-white", bad ? "bg-bad" : "bg-accent")}>{n > 99 ? "99+" : n}</span>}
    </Link>
  );
}

/* ───────────── رأس الهاتف (نمط iOS) ───────────── */
function MobileHeader({ counts, name, onMore, avatarId }: { counts: Counts; name: string; onMore: () => void; avatarId?: number | null }) {
  const pathname = usePathname();
  const item = currentItem(pathname);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 24);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  return (
    <header className={clsx("ios-header no-print sticky top-0 z-30 flex items-center gap-2 px-3 lg:hidden", scrolled && "ios-header-scrolled")}>
      <button type="button" onClick={() => { haptic(); onMore(); }} className="rounded-full shadow-glow" aria-label="القائمة وحسابي">
        <Avatar name={name} avatarId={avatarId} size={40} />
      </button>
      <div className="flex min-w-0 flex-1 items-center justify-center gap-2">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-white shadow-card"><Logo height={24} /></span>
        <span className={clsx("truncate text-[15px] font-extrabold text-navy transition-opacity duration-300", scrolled ? "opacity-100" : "opacity-0")}>{pathname === "/" ? "صدى الجنوب" : item?.label ?? "صدى الجنوب"}</span>
      </div>
      <button type="button" onClick={openPalette} className="grid h-10 w-10 place-items-center rounded-full text-navy active:bg-black/5" aria-label="بحث">
        <Search className="h-5 w-5" />
      </button>
      <Link href="/notifications" className="relative grid h-10 w-10 place-items-center rounded-full text-navy active:bg-black/5" aria-label={`التنبيهات (${counts.unread})`}>
        <Bell className="h-5 w-5" />
        {counts.unread > 0 && <span className="badge-ping num absolute end-0.5 top-0.5 min-w-[18px] rounded-full bg-bad px-1 text-center text-[10px] font-black leading-[18px] text-white">{counts.unread}</span>}
      </Link>
    </header>
  );
}

/* ───────────── ورقة «كل الأقسام» (الهاتف) — شبكة أيقونات بنمط iOS، تُسحب للأسفل للإغلاق ───────────── */
function MoreSheet({ open, onClose, role, bankVisible, counts, name, roleLabel, avatarId }: { open: boolean; onClose: () => void; role: Role; bankVisible?: boolean; counts: Counts; name: string; roleLabel: string; avatarId?: number | null }) {
  const { panel, scroller } = useSheetDrag(onClose, open);
  const groups = useMemo(() => navFor(role, bankVisible), [role, bankVisible]);
  const pathname = usePathname();
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="كل الأقسام">
      <div className="modal-backdrop absolute inset-0 animate-fade-in bg-navy/45 backdrop-blur-[3px]" onClick={onClose} />
      <div ref={panel} className="sheet-mobile absolute inset-x-0 bottom-0 flex max-h-[90dvh] flex-col overflow-hidden rounded-t-[30px] bg-[#e6e9ed] shadow-pop">
        <div data-sheet-handle className="sidebar-navy relative shrink-0 px-5 pb-4 pt-2.5 text-white">
          <div className="mb-3 flex justify-center"><span className="h-[5px] w-10 rounded-full bg-white/30" /></div>
          <div className="flex items-center gap-3">
            <ClockCard tone="dark" className="flex-1" />
            <div className="flex flex-col items-end text-end">
              <Link href="/settings" onClick={onClose}><Avatar name={name} avatarId={avatarId} size={44} ring /></Link>
              <p className="mt-1 max-w-[150px] truncate text-sm font-extrabold">{name}</p>
              <p className="max-w-[150px] truncate text-[11px] text-white/60">{roleLabel}</p>
              <form action={logout} className="mt-1.5">
                <button type="submit" className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-bold text-[#ffb4b4]"><LogOut className="h-3 w-3" /> خروج</button>
              </form>
            </div>
          </div>
        </div>
        <div ref={scroller} className="flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-4">
          {groups.map((g) => (
            <section key={g.id}>
              {g.section && <p className="mb-2 px-1 text-[12px] font-black text-ink-muted">{g.section}</p>}
              <ul className="grid grid-cols-4 gap-x-2 gap-y-3 rounded-[22px] bg-white p-3 shadow-card">
                {g.items.map((item) => {
                  const Icon = item.icon;
                  const n = badgeFor(item.href, counts);
                  const active = isActive(pathname, item.href);
                  return (
                    <li key={item.href}>
                      <Link href={item.href} onClick={() => { haptic(); onClose(); }} className="pressable flex flex-col items-center gap-1.5 text-center">
                        <span className={clsx("relative grid h-[52px] w-[52px] place-items-center rounded-[16px] shadow-[0_6px_14px_-8px_rgba(11,37,69,.55)]", active ? "ring-2 ring-accent ring-offset-2" : "")} style={{ background: `linear-gradient(145deg, #13315c, #0b2545)` }}>
                          <Icon className="h-6 w-6" style={{ color: item.tint }} />
                          {n > 0 && <span className="num absolute -end-1.5 -top-1.5 min-w-[20px] rounded-full bg-bad px-1 text-[10px] font-black leading-5 text-white ring-2 ring-white">{n > 99 ? "99+" : n}</span>}
                        </span>
                        <span className="line-clamp-2 text-[11px] font-bold leading-tight text-ink">{role === "PM" && item.pmLabel ? item.pmLabel : item.label}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ───────────── شريط التبويب السفلي (الهاتف) ───────────── */
function TabBar({ role, counts, onMore }: { role: Role; counts: Counts; onMore: () => void }) {
  const real = usePathname();
  // تنقل متفائل: العدسة تنزلق فوراً عند اللمس قبل اكتمال تحميل الصفحة
  const [tapped, setTapped] = useState<string | null>(null);
  useEffect(() => setTapped(null), [real]);
  const pathname = tapped ?? real;
  const canExpense = role === "ADMIN" || role === "ACCOUNTANT" || role === "PM";
  const tabs: { href: string; label: string; icon: LucideIcon; badge?: number }[] = [
    { href: "/", label: "الرئيسية", icon: Home },
    { href: "/tenders", label: role === "PM" ? "مشاريعي" : "المشاريع", icon: Briefcase },
    ...(canExpense ? [{ href: "/expenses/new", label: "مصروف", icon: Plus }] : [{ href: "/claims", label: "المطالبات", icon: Receipt }]),
    role === "PM" ? { href: "/messages", label: "الرسائل", icon: MessagesSquare, badge: counts.unreadMessages } : { href: "/board", label: "المجلس", icon: Gavel, badge: counts.board },
  ];
  return (
    <nav className="tabbar no-print lg:hidden" aria-label="التنقل السريع">
      {(() => {
        const idx = tabs.findIndex((t) => isActive(pathname, t.href));
        if (idx < 0) return null;
        const n = tabs.length + 1;
        return <span aria-hidden className="tab-lens" style={{ width: `calc((100% - 12px) / ${n})`, transform: `translateX(calc(${-idx} * 100%))` }} />;
      })()}
      {tabs.map((t) => {
        const active = isActive(pathname, t.href);
        const Icon = t.icon;
        const primary = t.href === "/expenses/new";
        return (
          <Link key={t.href} href={t.href} onClick={() => { haptic(); setTapped(t.href); }} className={clsx("tab", active && "tab-active", primary && "tab-primary")} aria-current={active ? "page" : undefined}>
            <span className="relative">
              <Icon className={primary ? "h-6 w-6" : "h-[23px] w-[23px]"} strokeWidth={active || primary ? 2.4 : 1.9} aria-hidden />
              {!!t.badge && t.badge > 0 && <span className="num absolute -end-2.5 -top-1.5 min-w-[18px] rounded-full bg-bad px-1 text-center text-[10px] font-bold leading-[18px] text-white">{t.badge > 99 ? "99+" : t.badge}</span>}
            </span>
            <span>{t.label}</span>
          </Link>
        );
      })}
      <button type="button" onClick={() => { haptic(); onMore(); }} className="tab" aria-label="كل الأقسام">
        <span className="relative">
          <LayoutGrid className="h-[23px] w-[23px]" strokeWidth={1.9} aria-hidden />
          {counts.unreadMessages > 0 && role !== "PM" && <span className="absolute -end-1 -top-0.5 h-2.5 w-2.5 rounded-full bg-accent ring-2 ring-white" />}
        </span>
        <span>الأقسام</span>
      </button>
    </nav>
  );
}

export function AppShell({
  user,
  roleLabel,
  unread,
  unreadMessages = 0,
  boardPending = 0,
  avatarId = null,
  wallpaper = null,
  notes = [],
  bankVisible,
  children,
}: {
  user: { name: string; role: Role };
  roleLabel: string;
  unread: number;
  unreadMessages?: number;
  boardPending?: number;
  avatarId?: number | null;
  /** خلفية النظام الشخصية (CSS background) — تظهر خلف الزجاج */
  wallpaper?: string | null;
  notes?: { key: string; href: string }[];
  bankVisible?: boolean;
  children: React.ReactNode;
}) {
  const [more, setMore] = useState(false);
  const pathname = usePathname();
  useEffect(() => setMore(false), [pathname]);
  const readOnly = READ_ONLY.includes(user.role);
  const counts: Counts = { unread, unreadMessages, board: boardPending };
  const canAsk = user.role === "ADMIN" || user.role === "CHAIRMAN";

  return (
    <ReadOnlyProvider value={readOnly}>
      <SeenTracker notes={notes} />
      <IdleLock />
      <CommandPalette role={user.role} bankVisible={bankVisible} canAsk={canAsk} />
      <EdgeSwipeBack />
      {wallpaper && <div aria-hidden className="user-wallpaper no-print" style={{ background: wallpaper }} />}
      <div className={clsx("min-h-[100dvh] lg:flex", user.role === "CHAIRMAN" && "senior", wallpaper && "has-wallpaper")}>
        <Sidebar role={user.role} bankVisible={bankVisible} counts={counts} name={user.name} roleLabel={roleLabel} avatarId={avatarId} />
        <div className="min-w-0 flex-1">
          <TopBar counts={counts} />
          <MobileHeader counts={counts} name={user.name} onMore={() => setMore(true)} avatarId={avatarId} />
          <main id="app-main" className="app-main min-w-0 px-4 pb-[calc(6.5rem+env(safe-area-inset-bottom))] pt-4 sm:px-6 lg:px-8 lg:pb-12 lg:pt-6 xl:px-10">
            <div className="mx-auto max-w-[1320px]">
              {readOnly && (
                <p className="no-print mb-4 flex items-center gap-2 rounded-2xl bg-navy px-4 py-2.5 text-sm font-bold text-gold shadow-card">
                  <Eye className="h-4 w-4 shrink-0" aria-hidden /> وضع الاطلاع — يمكنك مشاهدة كل البيانات دون تعديل
                </p>
              )}
              {children}
            </div>
          </main>
        </div>
        {canAsk && !pathname.startsWith("/assistant") && <AssistantFab />}
        <TabBar role={user.role} counts={counts} onMore={() => setMore(true)} />
        <MoreSheet open={more} onClose={() => setMore(false)} role={user.role} bankVisible={bankVisible} counts={counts} name={user.name} roleLabel={roleLabel} avatarId={avatarId} />
      </div>
    </ReadOnlyProvider>
  );
}

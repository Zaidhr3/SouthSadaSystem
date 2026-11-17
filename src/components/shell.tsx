"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import clsx from "clsx";
import { SeenTracker } from "./seen-tracker";
import { IdleLock } from "./idle-lock";
import {
  Bell,
  Briefcase,
  ClipboardCheck,
  ClipboardList,
  MessagesSquare,
  Percent,
  FileSpreadsheet,
  Images,
  TrendingUp,
  FolderArchive,
  GitPullRequestArrow,
  HandCoins,
  HardHat,
  Mail,
  PackageCheck,
  ScrollText,
  SlidersHorizontal,
  Truck,
  Landmark,
  LayoutDashboard,
  Library,
  LogOut,
  Menu,
  Home,
  Eye,
  NotebookTabs,
  Plus,
  Receipt,
  Settings,
  ShieldCheck,
  Users,
  Wallet,
  X,
  type LucideIcon,
  ReceiptText, Scale, Inbox, Megaphone
} from "lucide-react";
import { logout } from "@/app/login/actions";
import { Logo } from "./logo";
import { CraneMark } from "./crane-mark";
import { ReadOnlyProvider, haptic } from "./forms";

type Role = "ADMIN" | "ACCOUNTANT" | "PM" | "CHAIRMAN" | "AUDITOR";
const READ_ONLY: Role[] = ["CHAIRMAN", "AUDITOR"];
type NavItem = { href: string; label: string; icon: LucideIcon; roles?: Role[]; pmLabel?: string };

const NAV: { section: string; items: NavItem[] }[] = [
  {
    section: "",
    items: [
      { href: "/", label: "لوحة التحكم", icon: LayoutDashboard },
      { href: "/notifications", label: "التنبيهات", icon: Bell },
      { href: "/messages", label: "المراسلات الداخلية", icon: MessagesSquare },
    ],
  },
  {
    section: "العطاءات والمشاريع",
    items: [
      { href: "/tenders", label: "العطاءات والمشاريع", pmLabel: "مشاريعي", icon: Briefcase },
      { href: "/quotes", label: "طلبات التسعير من الموقع", icon: Inbox },
      { href: "/pricing", label: "مكتبة الأسعار الذكية", icon: Library },
      { href: "/variations", label: "أوامر التغيير", icon: GitPullRequestArrow },
      { href: "/guarantees", label: "الكفالات", icon: ShieldCheck, roles: ["ADMIN", "ACCOUNTANT", "CHAIRMAN", "AUDITOR"] },
      { href: "/claims", label: "المطالبات المالية والفواتير", icon: Receipt },
    ],
  },
  {
    section: "الموقع والعمليات",
    items: [
      { href: "/diary", label: "اليومية الموقعية", icon: ClipboardList },
      { href: "/photos", label: "خزنة صور المواقع", icon: Images },
      { href: "/subcontractors", label: "مقاولو الباطن", icon: HardHat },
      { href: "/materials", label: "المستودعات والمواد", icon: PackageCheck },
      { href: "/fleet", label: "الآليات والمعدات", icon: Truck },
      { href: "/correspondence", label: "الصادر والوارد", icon: Mail },
    ],
  },
  {
    section: "المالية",
    items: [
      { href: "/expenses", label: "المصاريف", icon: Wallet },
      { href: "/requests", label: "طلبات المواد والعهد", icon: ClipboardCheck },
      { href: "/funds", label: "التمويل والعهد", icon: HandCoins },
      { href: "/cheques", label: "دفتر الشيكات", icon: NotebookTabs, roles: ["ADMIN", "ACCOUNTANT", "CHAIRMAN", "AUDITOR"] },
      { href: "/debts", label: "الديون والقروض", icon: Scale, roles: ["ADMIN", "ACCOUNTANT", "CHAIRMAN", "AUDITOR"] },
      { href: "/taxes", label: "الضريبة", icon: Percent, roles: ["ADMIN", "ACCOUNTANT", "CHAIRMAN", "AUDITOR"] },
      { href: "/einvoices", label: "فواتير نظام الفوترة", icon: ReceiptText, roles: ["ADMIN", "ACCOUNTANT", "CHAIRMAN", "AUDITOR"] },
      { href: "/bank", label: "الحساب البنكي", icon: Landmark, roles: ["ADMIN", "CHAIRMAN"] },
      { href: "/cashflow", label: "التدفق النقدي المتوقع", icon: TrendingUp, roles: ["ADMIN", "CHAIRMAN"] },
      { href: "/reports", label: "التقارير والتصدير", icon: FileSpreadsheet, roles: ["ADMIN", "ACCOUNTANT", "CHAIRMAN", "AUDITOR"] },
    ],
  },
  {
    section: "الإدارة",
    items: [
      { href: "/marketing", label: "التسويق والعلاقات العامة", icon: Megaphone, roles: ["ADMIN", "CHAIRMAN"] },
      { href: "/documents", label: "أوراق الشركة", icon: FolderArchive, roles: ["ADMIN", "ACCOUNTANT", "CHAIRMAN", "AUDITOR"] },
      { href: "/users", label: "المستخدمون", icon: Users, roles: ["ADMIN"] },
      { href: "/audit", label: "سجل الرقابة والتدقيق", icon: ScrollText, roles: ["ADMIN", "CHAIRMAN", "AUDITOR"] },
      { href: "/system", label: "إعدادات النظام والبريد", icon: SlidersHorizontal, roles: ["ADMIN"] },
      { href: "/settings", label: "حسابي", icon: Settings },
    ],
  },
];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");
}

function NavList({ role, unread, unreadMessages, onNavigate, bankVisible }: { role: Role; unread: number; unreadMessages: number; onNavigate?: () => void; bankVisible?: boolean }) {
  const pathname = usePathname();
  return (
    <nav className="space-y-5" aria-label="القائمة الرئيسية">
      {NAV.map((group, gi) => {
        // البنك والتدفق النقدي: حسب إعداد «الرؤية» من المدير العام
        const items = group.items.filter((i) => (i.href === "/bank" || i.href === "/cashflow" ? !!bankVisible : !i.roles || i.roles.includes(role)));
        if (items.length === 0) return null;
        return (
          <div key={gi}>
            {group.section && <p className="mb-1.5 flex items-center gap-2 px-3 text-[11px] font-bold tracking-wide text-gold/80"><span aria-hidden className="h-px w-3 bg-gold/60" />{group.section}</p>}
            <ul className="space-y-0.5">
              {items.map((item) => {
                const active = isActive(pathname, item.href);
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      className={clsx(
                        "group flex items-center gap-3 rounded-xl px-3 py-2 text-[14px] font-semibold transition",
                        active ? "nav-active text-navy shadow-glow" : "text-white/75 hover:-translate-x-1 hover:bg-white/[0.08] hover:text-white",
                      )}
                      aria-current={active ? "page" : undefined}
                    >
                      <Icon className={clsx("h-[18px] w-[18px] shrink-0 transition", active ? "" : "text-white/55 group-hover:text-gold")} aria-hidden />
                      <span className="flex-1">{role === "PM" && item.pmLabel ? item.pmLabel : item.label}</span>
                      {item.href === "/messages" && unreadMessages > 0 && (
                        <span className={clsx("num min-w-[20px] rounded-full px-1.5 text-center text-[11px] font-bold", active ? "bg-navy text-white" : "bg-accent text-white")}>
                          {unreadMessages}
                        </span>
                      )}
                      {item.href === "/notifications" && unread > 0 && (
                        <span className={clsx("num min-w-[20px] rounded-full px-1.5 text-center text-[11px] font-bold", active ? "bg-navy text-white" : "badge-ping bg-bad text-white")}>
                          {unread}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-3 px-2">
      <span className="grid h-11 w-12 shrink-0 place-items-center overflow-hidden rounded-xl bg-white shadow-card ring-2 ring-gold/70">
        <Logo height={36} />
      </span>
      <span className="leading-tight">
        <span className="block text-[15px] font-extrabold text-white">صدى الجنوب</span>
        <span className="block text-[11px] font-semibold text-gold">للمقاولات الإنشائية</span>
      </span>
    </Link>
  );
}

function UserBox({ name, roleLabel }: { name: string; roleLabel: string }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-white/[0.08] p-2.5 ring-1 ring-white/10">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-gold to-accent text-sm font-bold text-navy">{name.replace(/^م\.\s*/, "").charAt(0)}</span>
      <span className="min-w-0 flex-1 leading-tight">
        <span className="block truncate text-[13px] font-bold text-white">{name}</span>
        <span className="block text-[11px] text-white/60">{roleLabel}</span>
      </span>
      <form action={logout}>
        <button type="submit" className="grid h-8 w-8 place-items-center rounded-full text-white/60 transition hover:bg-white/10 hover:text-[#ff9b9b]" title="تسجيل الخروج" aria-label="تسجيل الخروج">
          <LogOut className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}

export function AppShell({
  user,
  roleLabel,
  unread,
  unreadMessages = 0,
  notes = [],
  bankVisible,
  children,
}: {
  user: { name: string; role: Role };
  roleLabel: string;
  unread: number;
  unreadMessages?: number;
  notes?: { key: string; href: string }[];
  bankVisible?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => setOpen(false), [pathname]);
  const readOnly = READ_ONLY.includes(user.role);

  return (
    <ReadOnlyProvider value={readOnly}>
    <SeenTracker notes={notes} />
    <IdleLock />
    <div className={clsx("min-h-screen lg:flex", user.role === "CHAIRMAN" && "senior")}>
      {/* Desktop sidebar */}
      <aside className="sidebar-navy sticky top-0 hidden h-screen w-[268px] shrink-0 flex-col gap-6 overflow-hidden px-3 py-5 text-white shadow-pop lg:flex">
        <CraneMark className="pointer-events-none absolute -bottom-6 -start-10 h-72 w-72 text-white/[0.05]" />
        <Brand />
        <div className="relative flex-1 overflow-y-auto [scrollbar-width:thin]">
          <NavList role={user.role} bankVisible={bankVisible} unread={unread} unreadMessages={unreadMessages} />
        </div>
        <UserBox name={user.name} roleLabel={roleLabel} />
      </aside>

      {/* Mobile top bar */}
      <header className="sidebar-navy sticky top-0 z-30 flex items-center justify-between px-4 py-3 text-white shadow-pop lg:hidden">
        <button type="button" onClick={() => setOpen(true)} className="grid h-10 w-10 place-items-center rounded-full hover:bg-white/10" aria-label="فتح القائمة">
          <Menu className="h-5 w-5" />
        </button>
        <Brand />
        <Link href="/notifications" className="relative grid h-10 w-10 place-items-center rounded-full hover:bg-white/10" aria-label={`التنبيهات (${unread})`}>
          <Bell className="h-5 w-5" />
          {unread > 0 && <span className="badge-ping num absolute end-1 top-1 min-w-[18px] rounded-full bg-bad px-1 text-center text-[10px] font-bold leading-[18px] text-white">{unread}</span>}
        </Link>
      </header>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true">
          <div className="absolute inset-0 animate-fade-in bg-black/30" onClick={() => setOpen(false)} />
          <div className="sidebar-navy absolute inset-y-0 end-auto start-0 flex w-[84%] max-w-[300px] animate-slide-in flex-col gap-5 px-3 py-5 text-white shadow-pop">
            <div className="flex items-center justify-between">
              <Brand />
              <button type="button" onClick={() => setOpen(false)} className="grid h-9 w-9 place-items-center rounded-full bg-white/10" aria-label="إغلاق القائمة">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <NavList role={user.role} bankVisible={bankVisible} unread={unread} unreadMessages={unreadMessages} onNavigate={() => setOpen(false)} />
            </div>
            <UserBox name={user.name} roleLabel={roleLabel} />
          </div>
        </div>
      )}

      <main className="min-w-0 flex-1 px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-5 sm:px-6 lg:px-10 lg:pb-12 lg:pt-8">
        <div className="mx-auto max-w-[1280px]">
          {readOnly && (
            <p className="no-print mb-4 flex items-center gap-2 rounded-2xl bg-navy px-4 py-2.5 text-sm font-bold text-gold shadow-card">
              <Eye className="h-4 w-4 shrink-0" aria-hidden /> وضع الاطلاع — يمكنك مشاهدة كل البيانات دون تعديل
            </p>
          )}
          {children}
        </div>
      </main>

      <TabBar role={user.role} unread={unread} unreadMessages={unreadMessages} onMore={() => setOpen(true)} />
    </div>
    </ReadOnlyProvider>
  );
}

/** شريط التبويب السفلي للهاتف (بنمط iOS): كبير وسهل الوصول بالإبهام، مع مراعاة حافة الشاشة السفلية */
function TabBar({ role, unread, unreadMessages, onMore }: { role: Role; unread: number; unreadMessages: number; onMore: () => void }) {
  const pathname = usePathname();
  const canExpense = role === "ADMIN" || role === "ACCOUNTANT" || role === "PM";
  const tabs: { href: string; label: string; icon: LucideIcon; badge?: number }[] = [
    { href: "/", label: "الرئيسية", icon: Home },
    { href: "/tenders", label: role === "PM" ? "مشاريعي" : "المشاريع", icon: Briefcase },
    ...(canExpense ? [{ href: "/expenses/new", label: "مصروف", icon: Plus }] : [{ href: "/claims", label: "المطالبات", icon: Receipt }]),
    { href: "/messages", label: "الرسائل", icon: MessagesSquare, badge: unreadMessages },
    { href: "/notifications", label: "التنبيهات", icon: Bell, badge: unread },
  ];
  return (
    <nav className="tabbar no-print lg:hidden" aria-label="التنقل السريع">
      {tabs.map((t) => {
        const active = isActive(pathname, t.href);
        const Icon = t.icon;
        const primary = t.href === "/expenses/new";
        return (
          <Link key={t.href} href={t.href} onClick={() => haptic()} className={clsx("tab", active && "tab-active", primary && "tab-primary")} aria-current={active ? "page" : undefined}>
            <span className="relative">
              <Icon className={primary ? "h-6 w-6" : "h-[22px] w-[22px]"} strokeWidth={active || primary ? 2.4 : 2} aria-hidden />
              {!!t.badge && t.badge > 0 && <span className="num absolute -end-2.5 -top-1.5 min-w-[18px] rounded-full bg-bad px-1 text-center text-[10px] font-bold leading-[18px] text-white">{t.badge > 99 ? "99+" : t.badge}</span>}
            </span>
            <span>{t.label}</span>
          </Link>
        );
      })}
      <button type="button" onClick={() => { haptic(); onMore(); }} className="tab" aria-label="كل الأقسام">
        <Menu className="h-[22px] w-[22px]" aria-hidden />
        <span>المزيد</span>
      </button>
    </nav>
  );
}

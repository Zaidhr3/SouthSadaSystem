import Link from "next/link";
import clsx from "clsx";
import { ArrowLeft, type LucideIcon } from "lucide-react";
import { ClockCard, LiveClock } from "./clock";
import { CommandBarInput } from "./command-bar";

export type InboxItem = { href: string; label: string; n: number; icon: LucideIcon; tone: "gold" | "orange" | "blue" | "red" | "green" };
const TONE: Record<InboxItem["tone"], string> = {
  gold: "from-[#f7c55a] to-[#f2b134] text-navy",
  orange: "from-[#ff8a3d] to-accent text-white",
  blue: "from-[#3b82f6] to-navy-3 text-white",
  red: "from-[#ff4d5e] to-bad text-white",
  green: "from-[#34c26b] to-good text-white",
};

/** رأس لوحة التحكم: التحية والساعة الحية + «صندوق القرارات» (ما ينتظرك أنت الآن) */
export function DashboardHero({ name, subtitle, inbox, actions, canAsk }: { name: string; subtitle: string; inbox: InboxItem[]; actions?: React.ReactNode; canAsk?: boolean }) {
  const h = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: "Asia/Amman" }).format(new Date()));
  const hello = h < 5 ? "مسا الخير" : h < 12 ? "صباح الخير" : h < 17 ? "يعطيك العافية" : "مسا الخير";
  const live = inbox.filter((i) => i.n > 0);
  return (
    <section className="hero-exec relative mb-6 overflow-hidden rounded-[28px] text-white shadow-pop">
      <div className="relative grid gap-6 p-5 sm:p-7 lg:grid-cols-[1fr_auto]">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-[13px] font-bold text-gold">{hello}<span className="lg:hidden text-white/50">·</span><LiveClock className="text-[15px] text-white lg:hidden" /></p>
          <h1 className="mt-1 text-[26px] font-black leading-tight tracking-tight sm:text-[32px]">{name}</h1>
          <p className="mt-1.5 text-[14px] text-white/70">{subtitle}</p>
          {actions && <div className="mt-4 flex flex-wrap gap-2">{actions}</div>}
          {canAsk && <div className="mt-4 max-w-xl"><CommandBarInput /></div>}
        </div>
        <ClockCard tone="dark" className="hidden self-start rounded-2xl bg-white/[0.07] px-5 py-4 ring-1 ring-white/10 lg:block lg:min-w-[230px]" />
      </div>
      <div className="relative border-t border-white/10 bg-black/[0.12] px-3 py-3 sm:px-5">
        {live.length === 0 ? (
          <p className="px-2 py-1 text-sm font-semibold text-white/70">✓ لا شيء ينتظر قرارك الآن</p>
        ) : (
          <ul className="flex gap-2 overflow-x-auto [scrollbar-width:none]">
            {live.map((i) => {
              const Icon = i.icon;
              return (
                <li key={i.href + i.label} className="shrink-0">
                  <Link href={i.href} className="pressable group flex items-center gap-2.5 rounded-2xl bg-white/[0.08] py-2 pe-3 ps-2 ring-1 ring-white/10 transition hover:bg-white/[0.14]">
                    <span className={clsx("grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br shadow-card", TONE[i.tone])}><Icon className="h-[18px] w-[18px]" /></span>
                    <span className="leading-tight">
                      <span className="num block text-[18px] font-black">{i.n}</span>
                      <span className="block text-[11px] font-bold text-white/70">{i.label}</span>
                    </span>
                    <ArrowLeft className="h-4 w-4 text-white/40 transition group-hover:-translate-x-0.5 group-hover:text-gold" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

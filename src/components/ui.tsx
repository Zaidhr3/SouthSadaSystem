import Link from "next/link";
import clsx from "clsx";
import { CountUp } from "./count-up";
import { FileText, Paperclip, type LucideIcon } from "lucide-react";
import type { Tone } from "@/lib/labels";
import { daysUntil, fmtDate, relativeDays } from "@/lib/format";

export function PageHeader({
  title,
  subtitle,
  actions,
  back,
}: {
  title: string;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  back?: { href: string; label: string };
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {back && (
          <Link href={back.href} className="mb-1 inline-block text-sm font-semibold text-accent hover:underline">
            ‹ {back.label}
          </Link>
        )}
        <span aria-hidden className="title-bar mb-2 block h-1.5 w-12 rounded-full" />
        <h1 className="text-gradient text-2xl font-extrabold sm:text-[30px]">{title}</h1>
        {subtitle && <div className="mt-1 text-[15px] text-ink-muted">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ className, children, title, action, pad = true }: { className?: string; children: React.ReactNode; title?: React.ReactNode; action?: React.ReactNode; pad?: boolean }) {
  return (
    <section className={clsx("card", pad && "card-pad", className)}>
      {(title || action) && (
        <div className="mb-4 flex items-center justify-between gap-3">
          {title && <h2 className="text-[17px] font-bold text-ink">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

const toneClass: Record<Tone, string> = {
  gray: "bg-black/[0.05] text-ink-soft",
  blue: "bg-[#e7f0fb] text-navy-3",
  green: "bg-good-soft text-good",
  orange: "bg-warn-soft text-warn",
  red: "bg-bad-soft text-bad",
  purple: "bg-[#f1edfd] text-[#5b3fc4]",
};

export function Badge({ tone = "gray", children, className }: { tone?: Tone; children: React.ReactNode; className?: string }) {
  return (
    <span className={clsx("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold", toneClass[tone], className)}>
      {children}
    </span>
  );
}

export function StatusBadge({ map, value }: { map: Record<string, { label: string; tone: Tone }>; value: string }) {
  const s = map[value] ?? { label: value, tone: "gray" as Tone };
  // الحالات المعلّقة (برتقالي/بنفسجي) بنقطة نابضة تلفت النظر
  const live = s.tone === "orange" || s.tone === "purple";
  return (
    <Badge tone={s.tone}>
      <span aria-hidden className={clsx("relative inline-flex h-1.5 w-1.5 rounded-full bg-current", live && "dot-live")} />
      {s.label}
    </Badge>
  );
}

/** شارة انتهاء صلاحية مع النص (ليست بالألوان فقط) */
export function ExpiryBadge({ date, warnDays = 30 }: { date: Date | null; warnDays?: number }) {
  if (!date) return <Badge>بدون تاريخ انتهاء</Badge>;
  const d = daysUntil(date);
  if (d < 0) return <Badge tone="red">● منتهية {relativeDays(date)}</Badge>;
  if (d === 0) return <Badge tone="red">● تنتهي اليوم</Badge>;
  if (d <= warnDays) return <Badge tone="orange">▲ تنتهي {relativeDays(date)}</Badge>;
  return <Badge tone="green">✓ سارية حتى {fmtDate(date)}</Badge>;
}

const statIcon: Record<Tone, string> = {
  blue: "bg-gradient-to-br from-navy-3 to-[#3b82c4]",
  green: "bg-gradient-to-br from-[#0f8a5f] to-[#34c58b]",
  orange: "bg-gradient-to-br from-accent to-gold",
  red: "bg-gradient-to-br from-[#c81e3a] to-[#f2617a]",
  purple: "bg-gradient-to-br from-[#5b3fc4] to-[#9b7cf0]",
  gray: "bg-gradient-to-br from-navy to-navy-3",
};
const statGlow: Record<Tone, string> = { blue: "bg-navy-3", green: "bg-[#0f8a5f]", orange: "bg-accent", red: "bg-[#c81e3a]", purple: "bg-[#5b3fc4]", gray: "bg-navy" };

export function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  tone = "blue",
  href,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  icon?: LucideIcon;
  tone?: Tone;
  href?: string;
}) {
  const body = (
    <div className={clsx("card card-pad group relative h-full overflow-hidden transition hover-lift", href && "cursor-pointer")}>
      <span aria-hidden className={clsx("pointer-events-none absolute -end-10 -top-10 h-28 w-28 rounded-full opacity-[0.13] blur-2xl", statGlow[tone])} />
      <div className="relative flex items-start justify-between gap-3">
        <p className="text-[13px] font-bold text-ink-muted">{label}</p>
        {Icon && (
          <span className={clsx("grid h-10 w-10 shrink-0 place-items-center rounded-2xl text-white shadow-card transition duration-500 group-hover:-rotate-6 group-hover:scale-110", statIcon[tone])}>
            <Icon className="h-5 w-5" aria-hidden />
          </span>
        )}
      </div>
      <p className="num relative mt-2 text-end text-2xl font-extrabold text-ink sm:text-[26px]" style={{ direction: "rtl" }}>
        {typeof value === "string" || typeof value === "number" ? <CountUp text={String(value)} /> : value}
      </p>
      <span aria-hidden className={clsx("absolute inset-x-0 bottom-0 h-1 origin-right scale-x-0 transition-transform duration-500 group-hover:scale-x-100", statIcon[tone])} />
      {sub && <div className="mt-1 text-[13px] text-ink-muted">{sub}</div>}
    </div>
  );
  return href ? (
    <Link href={href} className="block">
      {body}
    </Link>
  ) : (
    body
  );
}

export function EmptyState({ icon: Icon = FileText, title, hint, action }: { icon?: LucideIcon; title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <span className="float-y grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-gold-soft to-accent-soft text-accent shadow-card">
        <Icon className="h-7 w-7" aria-hidden />
      </span>
      <p className="mt-4 font-bold text-ink">{title}</p>
      {hint && <p className="mt-1 max-w-sm text-sm text-ink-muted">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Money({ value, className, strong }: { value: number | null | undefined; className?: string; strong?: boolean }) {
  const n = value ?? 0;
  return (
    <span className={clsx("whitespace-nowrap", strong && "font-bold", className)}>
      <span className="num">{new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(n)}</span>
      <span className="ms-1 text-[0.8em] text-ink-muted">د.أ</span>
    </span>
  );
}

export function KeyValue({ items, cols = 2 }: { items: { label: string; value: React.ReactNode }[]; cols?: 2 | 3 | 4 }) {
  return (
    <dl className={clsx("grid gap-x-6 gap-y-4", cols === 2 && "sm:grid-cols-2", cols === 3 && "sm:grid-cols-3", cols === 4 && "sm:grid-cols-2 lg:grid-cols-4")}>
      {items.map((it) => (
        <div key={it.label} className="min-w-0">
          <dt className="text-xs font-semibold text-ink-muted">{it.label}</dt>
          <dd className="mt-0.5 break-words text-[15px] font-semibold text-ink">{it.value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

export function AttachmentList({ items }: { items?: { id: number; fileName: string; size: number }[] }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((a) => (
        <a
          key={a.id}
          href={`/api/files/${a.id}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex max-w-[220px] items-center gap-1 rounded-lg bg-canvas px-2 py-1 text-xs font-semibold text-accent hover:bg-accent-soft"
          title={a.fileName}
        >
          <Paperclip className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="truncate">{a.fileName}</span>
        </a>
      ))}
    </div>
  );
}

export function ProgressBar({ value, className }: { value: number; className?: string }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className={clsx("flex items-center gap-2", className)}>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-black/[0.06]" role="progressbar" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100}>
        <div className="progress-fill h-full rounded-full transition-all duration-700" style={{ width: `${v}%` }} />
      </div>
      <span className="num w-10 text-end text-xs font-bold text-ink-soft">{v}%</span>
    </div>
  );
}

/** قائمة أشرطة أفقية بلغة RTL الأصلية مع قيم مكتوبة مباشرة (بديل عن الرسوم الأفقية) */
export function BarList({
  rows,
  format = (n) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n),
  max,
}: {
  rows: { label: string; value: number; sub?: string; href?: string }[];
  format?: (n: number) => string;
  max?: number;
}) {
  const top = max ?? Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  return (
    <ul className="space-y-3">
      {rows.map((r) => {
        const w = Math.max(1.5, (Math.abs(r.value) / top) * 100);
        const neg = r.value < 0;
        const label = r.href ? (
          <Link href={r.href} className="truncate hover:text-accent">
            {r.label}
          </Link>
        ) : (
          <span className="truncate">{r.label}</span>
        );
        return (
          <li key={r.label} title={r.sub ? `${r.label} — ${r.sub}` : r.label}>
            <div className="mb-1 flex items-baseline justify-between gap-3 text-[13px]">
              <span className="flex min-w-0 font-semibold text-ink-soft">{label}</span>
              <span className={clsx("num shrink-0 font-bold", neg ? "text-bad" : "text-ink")}>{format(r.value)}</span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-black/[0.05]">
              <div className={clsx("bar-grow h-full rounded-full bg-gradient-to-l", neg ? "from-[#c81e3a] to-[#f2617a]" : "from-navy-3 to-[#3b9bd6]")} style={{ width: `${Math.min(100, w)}%` }} />
            </div>
            {r.sub && <p className="mt-0.5 text-[11px] text-ink-muted">{r.sub}</p>}
          </li>
        );
      })}
    </ul>
  );
}

type TabItem = { key: string; label: string; count?: number; more?: boolean };

/** تبويبات الصفحة: الرئيسية ظاهرة دائماً، والثانوية تحت «المزيد» (تبقى نظيفة على الجوال) */
/** محتوى التبويب: يدخل بحركة ناعمة عند كل تبديل */
export function TabPanel({ tab, children }: { tab: string; children: React.ReactNode }) {
  return (
    <div key={tab} className="tab-enter">
      {children}
    </div>
  );
}

export function Tabs({ tabs, active, base }: { tabs: TabItem[]; active: string; base: string }) {
  const primary = tabs.filter((t) => !t.more || t.key === active);
  const more = tabs.filter((t) => t.more && t.key !== active);
  const pill = (t: TabItem, inMenu = false) => (
    <Link
      key={t.key}
      href={`${base}?tab=${t.key}`}
      scroll={false}
      className={clsx(
        "flex shrink-0 items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-semibold transition",
        inMenu ? "w-full justify-between hover:bg-accent-soft hover:text-accent" : active === t.key ? "bg-gradient-to-l from-accent to-[#f59f0b] text-white shadow-glow" : "text-ink-muted hover:bg-white hover:text-ink",
      )}
    >
      {t.label}
      {typeof t.count === "number" && t.count > 0 && <span className={clsx("num rounded-full px-1.5 text-[11px]", active === t.key && !inMenu ? "bg-white/25" : "bg-black/[0.06]")}>{t.count}</span>}
    </Link>
  );
  return (
    <nav className="no-print relative z-20 mb-5 flex items-center gap-1 rounded-2xl bg-white/70 p-1 shadow-card ring-1 ring-black/[0.04] backdrop-blur" aria-label="أقسام">
      <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto">{primary.map((t) => pill(t))}</div>
      {more.length > 0 && (
        <details className="group relative shrink-0">
          <summary className="flex cursor-pointer list-none items-center gap-1 rounded-xl px-3 py-2 text-sm font-semibold text-ink-muted hover:text-ink [&::-webkit-details-marker]:hidden">
            المزيد
            <span className="num rounded-full bg-black/[0.06] px-1.5 text-[11px]">{more.length}</span>
          </summary>
          <div className="absolute end-0 top-full z-30 mt-2 w-56 origin-top animate-pop-in rounded-2xl border border-line bg-white p-1.5 shadow-pop">{more.map((t) => pill(t, true))}</div>
        </details>
      )}
    </nav>
  );
}

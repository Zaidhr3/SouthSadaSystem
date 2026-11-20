/* eslint-disable @next/next/no-img-element */
import clsx from "clsx";

/**
 * شعار شركة صدى الجنوب — رسم متجهي (public/logo-mark.svg): ثلاثة أبراج زجاجية بعمق ثلاثي الأبعاد وقوس الأرض.
 * حاد بأي مقاس وأي شاشة (لا تغبيش)، نسبة الأبعاد 120×112.
 */
export function Logo({ className, height = 40 }: { className?: string; height?: number }) {
  return (
    <img
      src="/logo-mark.svg"
      alt="شركة صدى الجنوب للمقاولات الإنشائية"
      width={Math.round((height * 120) / 112)}
      height={height}
      draggable={false}
      className={clsx("shrink-0 select-none object-contain", className)}
      style={{ height, width: "auto" }}
    />
  );
}

/** الشعار مع الاسم — للرؤوس وصفحات الدخول */
export function LogoLockup({ className, size = 44, tone = "dark" }: { className?: string; size?: number; tone?: "dark" | "light" }) {
  return (
    <span className={clsx("inline-flex items-center gap-3", className)}>
      <span className="grid shrink-0 place-items-center rounded-[30%] bg-white shadow-[0_6px_18px_-6px_rgba(0,0,0,.35)] ring-1 ring-black/5" style={{ width: size + 8, height: size + 8 }}>
        <Logo height={size * 0.82} />
      </span>
      <span className="leading-tight">
        <span className={clsx("block font-black tracking-tight", tone === "light" ? "text-white" : "text-navy")} style={{ fontSize: Math.max(14, size * 0.36) }}>صدى الجنوب</span>
        <span className="block text-[11px] font-bold text-gold">للمقاولات الإنشائية</span>
      </span>
    </span>
  );
}

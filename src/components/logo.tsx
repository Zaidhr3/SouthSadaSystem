/* eslint-disable @next/next/no-img-element */
import clsx from "clsx";

/** شعار شركة صدى الجنوب (public/logo.JPG — 136×123) بأبعاده الأصلية دون تمدد أو قص */
export function Logo({ className, height = 40 }: { className?: string; height?: number }) {
  return (
    <img
      src="/logo.JPG"
      alt="شركة صدى الجنوب للمقاولات الإنشائية"
      width={Math.round((height * 136) / 123)}
      height={height}
      className={clsx("shrink-0 object-contain", className)}
      style={{ height, width: "auto" }}
    />
  );
}

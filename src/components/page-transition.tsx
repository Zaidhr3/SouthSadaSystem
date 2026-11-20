"use client";

import { usePathname } from "next/navigation";
import { useRef } from "react";

let lastPath: string | null = null;

const depth = (p: string) => p.split("/").filter(Boolean).length;

/**
 * انتقالات الصفحات بنمط iOS:
 * - push: فتح صفحة داخل قسم (مثلاً المشاريع ← مشروع) — الصفحة الجديدة تنزلق من الحافة القيادية
 * - pop: الرجوع لمستوى أعلى — الصفحة السابقة تعود من إزاحة خفيفة (بارالاكس)
 * - fade: التبديل بين الأقسام الرئيسية (كتبويبات iOS) — تلاشٍ وتكبير خفيف
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const kind = useRef<string>("page-fade");
  const decided = useRef(false);
  if (!decided.current) {
    decided.current = true;
    const prev = lastPath;
    if (prev && prev !== pathname) {
      if (pathname.startsWith(prev === "/" ? "/__none__" : prev + "/") || (depth(pathname) > depth(prev) && pathname.split("/")[1] === prev.split("/")[1])) kind.current = "page-push";
      else if (prev.startsWith(pathname + "/") || (depth(pathname) < depth(prev) && pathname.split("/")[1] === prev.split("/")[1])) kind.current = "page-pop";
    }
    lastPath = pathname;
  }
  return <div className={kind.current}>{children}</div>;
}

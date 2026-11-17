"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { markNotificationsSeen } from "@/app/(app)/actions/admin";

/**
 * حالة القراءة مرتبطة بقاعدة البيانات: بمجرد فتح الصفحة التي يشير إليها تنبيه غير مقروء
 * (من أي مكان — القائمة، رابط البريد، لوحة التحكم) يُسجَّل «مقروء» فوراً وتختفي الشارة الحمراء،
 * ولا يعود التنبيه نفسه عند الخروج والدخول مجدداً.
 */
export function SeenTracker({ notes }: { notes: { key: string; href: string }[] }) {
  const pathname = usePathname();
  const router = useRouter();
  const sent = useRef(new Set<string>());

  useEffect(() => {
    if (pathname === "/" || pathname.startsWith("/notifications")) return;
    const keys = notes
      .filter((n) => n.href.split(/[?#]/)[0] === pathname && !sent.current.has(n.key))
      .map((n) => n.key);
    if (keys.length === 0) return;
    keys.forEach((k) => sent.current.add(k));
    markNotificationsSeen(keys)
      .then(() => router.refresh())
      .catch(() => keys.forEach((k) => sent.current.delete(k)));
  }, [pathname, notes, router]);

  return null;
}

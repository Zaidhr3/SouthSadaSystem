"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import clsx from "clsx";
import { dismissNotification } from "@/app/(app)/actions/admin";

/**
 * رابط إشعار: عند الضغط يُعلَّم «تم الفتح» في قاعدة البيانات أولاً
 * ثم ينتقل للصفحة المرتبطة — فيتحدث عداد الجرس فوراً.
 */
export function NotificationLink({ nkey, href, read, className, children }: { nkey: string; href: string; read: boolean; className?: string; children: React.ReactNode }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <a
      href={href}
      className={clsx(className, pending && "opacity-60")}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        start(async () => {
          if (!read) await dismissNotification(nkey).catch(() => undefined);
          router.push(href);
          router.refresh();
        });
      }}
    >
      {children}
    </a>
  );
}

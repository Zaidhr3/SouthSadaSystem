import Link from "next/link";
import { LogOut } from "lucide-react";
import { getClient } from "@/lib/client-session";
import { Logo } from "@/components/logo";
import { clientLogout } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: { default: "بوابة العملاء", template: "%s — بوابة عملاء صدى الجنوب" }, robots: { index: false } };

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const client = await getClient();
  if (!client) return <>{children}</>;
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-white/10 text-white" style={{ background: "linear-gradient(100deg, #0b2545 0%, #13315c 60%, #0a1f3b 100%)" }}>
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <Link href="/portal" className="flex items-center gap-3">
            <span className="grid h-11 w-12 place-items-center rounded-xl bg-white ring-2 ring-gold/70">
              <Logo height={34} />
            </span>
            <span>
              <span className="block text-[15px] font-extrabold">صدى الجنوب للمقاولات</span>
              <span className="block text-xs text-gold">بوابة العملاء</span>
            </span>
          </Link>
          <div className="flex items-center gap-3">
            <span className="hidden text-end text-sm sm:block">
              <span className="block font-bold">{client.name}</span>
              <span className="block text-xs text-white/60">{client.kind === "OWNER" ? "المالك" : "المهندس المشرف"}</span>
            </span>
            <form action={clientLogout}>
              <button className="grid h-10 w-10 place-items-center rounded-xl bg-white/10 transition hover:bg-white/20" title="تسجيل الخروج" aria-label="تسجيل الخروج">
                <LogOut className="h-5 w-5" />
              </button>
            </form>
          </div>
        </div>
        <span className="title-bar block h-1" aria-hidden />
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 page-enter">{children}</main>
      <footer className="pb-10 pt-4 text-center text-xs text-ink-muted">صدى الجنوب للمقاولات الإنشائية — كل البيانات تُعرض مباشرة من نظام إدارة المشاريع</footer>
    </div>
  );
}

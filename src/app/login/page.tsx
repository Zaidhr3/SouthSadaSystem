import type { Metadata } from "next";
import { LoginForm } from "./login-form";
import { Logo } from "@/components/logo";
import { CraneMark } from "@/components/crane-mark";

export const metadata: Metadata = { title: "تسجيل الدخول" };

export default function LoginPage({ searchParams }: { searchParams: { suspended?: string; idle?: string } }) {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(60% 50% at 85% 0%, rgba(242,177,52,0.30), transparent 70%), radial-gradient(50% 45% at 0% 100%, rgba(232,89,12,0.22), transparent 70%), linear-gradient(160deg, #0b2545 0%, #13315c 55%, #0a1f3b 100%)",
        }}
      />
      <CraneMark className="pointer-events-none absolute -bottom-10 -start-16 h-[520px] w-[520px] text-white/[0.06]" />
      <div className="relative w-full max-w-[400px] animate-pop-in">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 grid h-28 w-32 place-items-center rounded-[28px] bg-white shadow-pop ring-4 ring-gold/70">
            <Logo height={84} />
          </div>
          <h1 className="text-2xl font-extrabold text-white">صدى الجنوب للمقاولات</h1>
          <p className="mt-1 text-sm text-gold">مقاولات إنشائية — مصنفة رابعة أبنية</p>
        </div>
        <div className="card p-6 sm:p-8">
          {searchParams.idle !== undefined && (
            <p role="status" className="mb-4 rounded-xl bg-accent-soft px-3 py-2.5 text-center text-sm font-semibold text-accent">قُفلت الجلسة تلقائياً بعد دقيقتين من عدم النشاط — سجّل الدخول للمتابعة. مسوداتك محفوظة.</p>
          )}
          <LoginForm suspended={searchParams.suspended !== undefined} />
        </div>
        <p className="mt-6 text-center text-xs text-white/60">نظام آمن — اتصال مشفّر وكل عملية مسجلة في سجل الرقابة</p>
      </div>
    </main>
  );
}

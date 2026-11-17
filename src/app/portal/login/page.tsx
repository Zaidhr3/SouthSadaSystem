import { redirect } from "next/navigation";
import { getClient } from "@/lib/client-session";
import { Logo } from "@/components/logo";
import { CraneMark } from "@/components/crane-mark";
import { PortalForm } from "../portal-form";
import { clientLogin } from "../actions";

export const metadata = { title: "دخول العملاء" };

export default async function PortalLogin() {
  if (await getClient()) redirect("/portal");
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(60% 50% at 85% 0%, rgba(242,177,52,0.30), transparent 70%), radial-gradient(50% 45% at 0% 100%, rgba(232,89,12,0.22), transparent 70%), linear-gradient(160deg, #0b2545 0%, #13315c 55%, #0a1f3b 100%)" }}
      />
      <CraneMark className="pointer-events-none absolute -bottom-10 -start-16 h-[520px] w-[520px] text-white/[0.06]" />
      <div className="relative w-full max-w-[400px] animate-pop-in">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 grid h-28 w-32 place-items-center rounded-[28px] bg-white shadow-pop ring-4 ring-gold/70">
            <Logo height={84} />
          </div>
          <h1 className="text-2xl font-extrabold text-white">بوابة عملاء صدى الجنوب</h1>
          <p className="mt-1 text-sm text-gold">تابع مشروعك لحظة بلحظة: الإنجاز، خطة العمل، اليوميات والمراسلات</p>
        </div>
        <div className="card p-6 sm:p-8">
          <PortalForm action={clientLogin} submitLabel="دخول">
            <div>
              <label htmlFor="email" className="label">البريد الإلكتروني</label>
              <input id="email" name="email" type="email" autoComplete="email" className="input" dir="ltr" required autoFocus />
            </div>
            <div>
              <label htmlFor="password" className="label">كلمة المرور</label>
              <input id="password" name="password" type="password" autoComplete="current-password" className="input" dir="ltr" required />
            </div>
          </PortalForm>
        </div>
        <p className="mt-6 text-center text-xs text-white/60">حسابك تنشئه إدارة الشركة — للمساعدة تواصل مع مدير مشروعك</p>
      </div>
    </main>
  );
}

"use client";

import { useFormState, useFormStatus } from "react-dom";
import { Loader2, Lock } from "lucide-react";
import { login } from "./actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn-primary w-full py-3 text-[15px]">
      {pending && <Loader2 className="h-4 w-4 animate-spin" />}
      تسجيل الدخول
    </button>
  );
}

export function SuspendedNotice({ message }: { message: string }) {
  return (
    <div className="notice-in mb-5 rounded-2xl border border-bad/20 bg-bad-soft p-4 text-center" role="alert">
      <span className="mx-auto mb-2 grid h-11 w-11 place-items-center rounded-full bg-bad text-white">
        <Lock className="h-5 w-5" aria-hidden />
      </span>
      <p className="text-[15px] font-bold text-bad">تم إيقاف حسابك</p>
      <p className="mt-1 whitespace-pre-line text-[15px] leading-relaxed text-ink">{message}</p>
    </div>
  );
}

export function LoginForm({ suspended }: { suspended?: boolean }) {
  const [state, action] = useFormState(login, {});
  return (
    <form action={action} className="space-y-4">
      {state.suspended ? <SuspendedNotice message={state.suspended} /> : suspended && <SuspendedNotice message="تم إيقاف حسابك أثناء الجلسة. الرجاء مراجعة إدارة الشركة" />}
      <div>
        <label htmlFor="username" className="label">
          اسم المستخدم
        </label>
        <input id="username" name="username" autoComplete="username" autoFocus className="input" dir="ltr" required />
      </div>
      <div>
        <label htmlFor="password" className="label">
          كلمة المرور
        </label>
        <input id="password" name="password" type="password" autoComplete="current-password" className="input" dir="ltr" required />
      </div>
      {state.error && (
        <p className="rounded-xl bg-bad-soft px-3 py-2 text-sm font-semibold text-bad" role="alert">
          {state.error}
        </p>
      )}
      <Submit />
    </form>
  );
}

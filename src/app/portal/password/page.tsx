import { requireClient } from "@/lib/client-session";
import { PortalForm } from "../portal-form";
import { clientChangePassword } from "../actions";

export const metadata = { title: "كلمة المرور" };

export default async function PortalPassword() {
  const c = await requireClient();
  return (
    <div className="mx-auto max-w-md">
      <div className="card p-6">
        <h1 className="text-xl font-extrabold">{c.mustChangePassword ? "اختر كلمة مرور خاصة بك" : "تغيير كلمة المرور"}</h1>
        <p className="mb-5 mt-1 text-sm text-ink-muted">{c.mustChangePassword ? "كلمة المرور الحالية مؤقتة — غيّرها قبل المتابعة." : "8 خانات على الأقل تجمع أحرفاً وأرقاماً."}</p>
        <PortalForm action={clientChangePassword} submitLabel="حفظ كلمة المرور">
          <div>
            <label className="label" htmlFor="current">كلمة المرور الحالية</label>
            <input id="current" name="current" type="password" className="input" dir="ltr" required autoComplete="current-password" />
          </div>
          <div>
            <label className="label" htmlFor="next">كلمة المرور الجديدة</label>
            <input id="next" name="next" type="password" className="input" dir="ltr" required minLength={8} autoComplete="new-password" />
          </div>
          <div>
            <label className="label" htmlFor="confirm">تأكيد كلمة المرور</label>
            <input id="confirm" name="confirm" type="password" className="input" dir="ltr" required minLength={8} autoComplete="new-password" />
          </div>
        </PortalForm>
      </div>
    </div>
  );
}

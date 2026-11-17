import { requireUser } from "@/lib/auth";
import { ROLE_LABELS } from "@/lib/labels";
import { Card, KeyValue, PageHeader } from "@/components/ui";
import { ActionForm, Input } from "@/components/forms";
import { changeOwnPassword } from "../actions/admin";

export const metadata = { title: "حسابي" };

export default async function SettingsPage() {
  const user = await requireUser();
  return (
    <>
      <PageHeader title="حسابي" />
      <div className="grid max-w-4xl gap-5 lg:grid-cols-2">
        <Card title="معلومات الحساب">
          <KeyValue
            items={[
              { label: "الاسم", value: user.name },
              { label: "اسم المستخدم", value: <span dir="ltr">{user.username}</span> },
              { label: "الدور", value: ROLE_LABELS[user.role] },
              { label: "المسمى", value: user.title ?? "—" },
            ]}
          />
        </Card>
        <Card title="تغيير كلمة المرور">
          <ActionForm action={changeOwnPassword} submitLabel="تغيير كلمة المرور" resetOnSuccess allowReadOnly>
            <Input name="current" label="كلمة المرور الحالية" type="password" required dir="ltr" autoComplete="current-password" />
            <Input name="next" label="كلمة المرور الجديدة" type="password" required dir="ltr" autoComplete="new-password" hint="8 أحرف على الأقل" />
            <Input name="confirm" label="تأكيد كلمة المرور" type="password" required dir="ltr" autoComplete="new-password" />
          </ActionForm>
        </Card>
      </div>
    </>
  );
}

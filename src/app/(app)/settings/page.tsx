import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { ROLE_LABELS } from "@/lib/labels";
import { Card, KeyValue, PageHeader } from "@/components/ui";
import { ActionForm, FileInput, Input, Textarea } from "@/components/forms";
import { ProfileCard } from "@/components/profile-card";
import { PresetPicker, RemoveAvatar } from "@/components/profile-editor";
import { changeOwnPassword } from "../actions/admin";
import { saveBio, uploadProfileImage } from "../actions/profile";

export const metadata = { title: "حسابي" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await requireUser();
  const me = await db.user.findUniqueOrThrow({ where: { id: user.id }, select: { name: true, title: true, bio: true, avatarId: true, coverId: true, coverPreset: true, wallpaperId: true, wallpaperPreset: true, boardSeat: true } });
  const img = "JPG أو PNG أو WEBP — الصور الكبيرة تُصغّر تلقائياً";
  return (
    <>
      <PageHeader title="حسابي" subtitle="ملفك الشخصي: صورتك، الغلاف، خلفية النظام الخاصة بك، وسيرتك الذاتية" />
      <div className="grid gap-5 xl:grid-cols-[1.1fr_1fr]">
        <div className="space-y-5">
          <ProfileCard p={me} />
          <Card title="السيرة الذاتية">
            <ActionForm action={saveBio} submitLabel="حفظ السيرة" allowReadOnly draft={false}>
              <Textarea name="bio" label="نبذة عنك (تظهر للزملاء في مجلس الإدارة والملفات)" rows={5} defaultValue={me.bio ?? ""} maxLength={1200} />
            </ActionForm>
          </Card>
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
        </div>
        <div className="space-y-5">
          <Card title="الصورة الشخصية" action={me.avatarId ? <RemoveAvatar /> : null}>
            <ActionForm action={uploadProfileImage.bind(null, "avatar")} submitLabel="رفع الصورة" allowReadOnly draft={false}>
              <FileInput label="صورتك" hint={`${img} — يفضّل صورة مربعة`} />
            </ActionForm>
          </Card>
          <Card title="صورة الغلاف">
            <PresetPicker slot="cover" current={me.coverId ? null : me.coverPreset ?? "navy-gold"} />
            <div className="mt-4">
              <ActionForm action={uploadProfileImage.bind(null, "cover")} submitLabel="رفع غلاف" allowReadOnly draft={false}>
                <FileInput label="أو ارفع صورة غلاف" hint={`${img} — يفضّل عرضية 3:1`} />
              </ActionForm>
            </div>
          </Card>
          <Card title="خلفية النظام (تظهر خلف الزجاج في كل الصفحات — لك أنت فقط)">
            <PresetPicker slot="wallpaper" current={me.wallpaperId ? null : me.wallpaperPreset} />
            <div className="mt-4">
              <ActionForm action={uploadProfileImage.bind(null, "wallpaper")} submitLabel="رفع خلفية" allowReadOnly draft={false}>
                <FileInput label="أو ارفع صورتك كخلفية" hint={img} />
              </ActionForm>
            </div>
          </Card>
          <Card title="تغيير كلمة المرور">
            <ActionForm action={changeOwnPassword} submitLabel="تغيير كلمة المرور" resetOnSuccess allowReadOnly>
              <Input name="current" label="كلمة المرور الحالية" type="password" required dir="ltr" autoComplete="current-password" />
              <Input name="next" label="كلمة المرور الجديدة" type="password" required dir="ltr" autoComplete="new-password" hint="8 أحرف على الأقل" />
              <Input name="confirm" label="تأكيد كلمة المرور" type="password" required dir="ltr" autoComplete="new-password" />
            </ActionForm>
          </Card>
        </div>
      </div>
    </>
  );
}

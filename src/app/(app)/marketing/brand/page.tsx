import { Download, Facebook, Instagram, Palette } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { can, see } from "@/lib/permissions";
import { metaStatus } from "@/lib/meta";
import { Card, PageHeader } from "@/components/ui";
import { ActionForm } from "@/components/forms";
import { applyBrandImage, generateBrandKit } from "../../actions/design";

export const metadata = { title: "هوية الحسابات" };
/** توليد التصاميم بالمتصفح + النشر (كاروسيل) قد يستغرقان دقيقة */
export const maxDuration = 120;

/** الصورة الشخصية وصورة الغلاف بطابع جديد مع نفس الشعار — معاينة ثم تطبيق */
export default async function BrandPage() {
  const user = await requireUser(see.marketing);
  const manage = can.manageMarketing(user.role);
  const [atts, meta] = await Promise.all([db.attachment.findMany({ where: { entityType: "brand", entityId: 1 }, orderBy: { id: "desc" } }), metaStatus()]);
  const profile = atts.find((a) => a.slot === "profile");
  const cover = atts.find((a) => a.slot === "cover");
  const connected = !!meta?.configured && meta.ok;
  return (
    <>
      <PageHeader
        back={{ href: "/marketing", label: "التسويق" }}
        title="هوية الحسابات"
        subtitle="الصورة الشخصية والغلاف لفيسبوك وإنستغرام بطابع هندسي جديد — نفس الشعار الأصلي دون أي تعديل عليه"
        actions={
          manage && (
            <ActionForm action={generateBrandKit} submitLabel={profile ? "إعادة التوليد" : "توليد التصاميم"}>
              <span />
            </ActionForm>
          )
        }
      />
      {!profile ? (
        <Card>
          <p className="py-8 text-center text-sm text-ink-muted"><Palette className="mx-auto mb-2 h-8 w-8 text-gold" />اضغط «توليد التصاميم» لإنشاء الصورة الشخصية والغلاف</p>
        </Card>
      ) : (
        <div className="space-y-5">
          <Card title="صورة الغلاف — فيسبوك (1640×624)">
            <img src={`/api/files/${cover?.id}`} alt="الغلاف" className="w-full rounded-xl border border-line" />
            <div className="mt-3 flex flex-wrap gap-2">
              <a href={`/api/files/${cover?.id}`} download="sada-cover.jpg" className="btn-secondary btn-sm"><Download className="h-4 w-4" /> تنزيل</a>
              {manage && connected && (
                <ActionForm action={applyBrandImage.bind(null, "cover")} submitLabel="تطبيق على فيسبوك">
                  <span />
                </ActionForm>
              )}
            </div>
            <p className="mt-2 text-xs text-ink-muted">العناصر في المنتصف ضمن المنطقة الآمنة — تظهر كاملة على الهاتف والحاسوب.</p>
          </Card>
          <Card title="الصورة الشخصية — فيسبوك وإنستغرام (1080×1080)">
            <div className="flex flex-wrap items-center gap-6">
              <img src={`/api/files/${profile.id}`} alt="الصورة الشخصية" className="h-48 w-48 rounded-full border border-line" />
              <img src={`/api/files/${profile.id}`} alt="" className="h-20 w-20 rounded-full border border-line" title="بحجم ظهورها في التعليقات" />
              <div className="flex flex-col gap-2">
                <a href={`/api/files/${profile.id}`} download="sada-profile.jpg" className="btn-secondary btn-sm"><Download className="h-4 w-4" /> تنزيل</a>
                {manage && connected && (
                  <ActionForm action={applyBrandImage.bind(null, "profile")} submitLabel="تطبيق على فيسبوك">
                    <span />
                  </ActionForm>
                )}
              </div>
            </div>
            <p className="mt-3 flex items-start gap-2 text-xs text-ink-muted">
              <Facebook className="h-4 w-4 shrink-0 text-[#1877f2]" /> فيسبوك: يُطبّق مباشرة إن كان الرمز يملك صلاحية pages_manage_metadata، وإلا نزّل الصورة وارفعها من الصفحة.
            </p>
            <p className="mt-1 flex items-start gap-2 text-xs text-ink-muted">
              <Instagram className="h-4 w-4 shrink-0 text-[#d6249f]" /> إنستغرام: لا يسمح بتغيير الصورة الشخصية برمجياً — نزّلها وغيّرها من التطبيق (تعديل الملف الشخصي ← تغيير الصورة).
            </p>
            <p className="mt-1 text-xs text-ink-faint">ملاحظة: الشعار الأصلي المتوفر بدقة 136×123 — لنتيجة أنقى أرسل نسخة عالية الدقة (PNG أو SVG) وسأستبدلها دون تغيير التصميم.</p>
          </Card>
        </div>
      )}
    </>
  );
}

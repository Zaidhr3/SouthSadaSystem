import Link from "next/link";
import clsx from "clsx";
import { ImagePlus, Images, Trash2 } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { can, see } from "@/lib/permissions";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { ConfirmButton, FileInput, Grid, Input, ModalForm, Select } from "@/components/forms";
import { deleteMedia, uploadMedia } from "../../actions/design";
import { MEDIA_CATEGORY } from "@/lib/design/media";

export const metadata = { title: "مكتبة الوسائط" };

export default async function MediaPage({ searchParams }: { searchParams: { cat?: string } }) {
  const user = await requireUser(see.marketing);
  const manage = can.manageMarketing(user.role);
  const cat = searchParams.cat && searchParams.cat in MEDIA_CATEGORY ? searchParams.cat : undefined;
  const [assets, tenders] = await Promise.all([
    db.mediaAsset.findMany({ where: cat ? { category: cat } : {}, orderBy: { id: "desc" }, take: 300 }),
    db.tender.findMany({ where: { status: { in: ["WON", "EXECUTION", "MAINTENANCE", "CLOSED"] } }, select: { id: true, name: true }, orderBy: { id: "desc" } }),
  ]);
  const tName = new Map(tenders.map((t) => [t.id, t.name]));
  return (
    <>
      <PageHeader
        back={{ href: "/marketing", label: "التسويق" }}
        title="مكتبة الوسائط"
        subtitle="صور حقيقية لمعدات الشركة ومشاريعها ومواقعها — تُدمج تلقائياً مع القوالب المؤسسية. صور حقيقية فقط: لا صور مولّدة أو مقتبسة توحي بأعمال ليست لنا."
        actions={
          manage && (
            <ModalForm title="إضافة صور للمكتبة" trigger={<><ImagePlus className="h-4 w-4" /> إضافة صور</>} action={uploadMedia} wide>
              <Input name="title" label="الوصف" required placeholder="مثال: بوبكات الشركة أثناء الحفر — مادبا" />
              <Grid>
                <Select name="category" label="التصنيف" options={Object.entries(MEDIA_CATEGORY).map(([value, label]) => ({ value, label }))} defaultValue="EQUIPMENT" />
                <Select name="tenderId" label="المشروع (اختياري)" options={tenders.map((t) => ({ value: t.id, label: t.name }))} placeholder="— بلا مشروع —" />
              </Grid>
              <Input name="tags" label="كلمات مفتاحية (اختياري)" placeholder="بوبكات، حفر، أساسات" />
              <FileInput label="الصور (JPG/PNG/WEBP — يُفضّل أفقية أو عمودية بجودة عالية)" />
            </ModalForm>
          )
        }
      />
      <nav className="mb-4 flex gap-1 overflow-x-auto rounded-2xl bg-black/[0.04] p-1">
        {[["", "الكل"], ...Object.entries(MEDIA_CATEGORY)].map(([k, label]) => (
          <Link key={k} href={k ? `/marketing/media?cat=${k}` : "/marketing/media"} className={clsx("whitespace-nowrap rounded-xl px-3 py-1.5 text-sm font-bold transition", (cat ?? "") === k ? "bg-white text-accent shadow-card" : "text-ink-muted hover:text-ink")}>
            {label}
          </Link>
        ))}
      </nav>
      {assets.length === 0 ? (
        <Card>
          <EmptyState icon={Images} title="المكتبة فارغة" hint="ارفع صور البوبكات والجرافات وخزانات الستانلس والمشاريع المنجزة — ستظهر في «التصميم» داخل كل منشور" />
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {assets.map((a) => (
            <figure key={a.id} className="card overflow-hidden">
              <img src={`/api/files/${a.attachmentId}`} alt={a.title} loading="lazy" className="aspect-square w-full object-cover" />
              <figcaption className="p-2.5">
                <p className="truncate text-sm font-bold" title={a.title}>{a.title}</p>
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  <Badge tone="blue">{MEDIA_CATEGORY[a.category]}</Badge>
                  {a.usageCount > 0 && <Badge tone="gray">استُخدمت {a.usageCount}</Badge>}
                </div>
                {a.tenderId && <p className="mt-1 truncate text-xs text-ink-muted">{tName.get(a.tenderId)}</p>}
                {manage && (
                  <ConfirmButton action={deleteMedia.bind(null, a.id)} confirm="حذف الصورة من المكتبة؟" className="btn-danger btn-sm mt-1" title="حذف">
                    <Trash2 className="h-4 w-4" />
                  </ConfirmButton>
                )}
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </>
  );
}

import Link from "next/link";
import { LayoutGrid } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { see } from "@/lib/permissions";
import { callMeta, getMetaConfig } from "@/lib/meta";
import { TEMPLATES, type TemplateId } from "@/lib/design/templates";
import { fmtDate } from "@/lib/format";
import { Badge, Card, PageHeader } from "@/components/ui";
import { ActionForm } from "@/components/forms";
import { designPending } from "../../actions/design";

export const metadata = { title: "شبكة إنستغرام" };
export const maxDuration = 300;

type Tile = { key: string; src: string; href: string; upcoming: boolean; label?: string; date?: Date | null; template?: string | null; carousel?: boolean };

/**
 * مخطط شبكة إنستغرام: المنشورات القادمة (المعتمدة والمصممة) فوق آخر المنشورات الفعلية من الحساب —
 * لترى قبل النشر كيف ستبدو الصفحة ككتالوج هندسي متناسق (القالب يتناوب: إطار ← مخطط ← مقسوم).
 */
export default async function GridPage() {
  await requireUser(see.marketing);
  const [upcoming, cfg] = await Promise.all([
    db.marketingItem.findMany({
      where: { kind: "POST", imageAttachmentId: { not: null }, status: { in: ["APPROVED", "IN_REVIEW", "SUGGESTED"] }, source: { notIn: ["AUDIT_FB", "AUDIT_IG"] } },
      orderBy: [{ publishAt: "desc" }, { scheduledFor: "desc" }, { id: "desc" }],
      take: 9,
    }),
    getMetaConfig(),
  ]);
  const slideCounts = await db.attachment.groupBy({ by: ["entityId"], where: { entityType: "marketing", entityId: { in: upcoming.map((u) => u.id) }, slot: { startsWith: "slide:" } }, _count: true });
  const multi = new Set(slideCounts.filter((c) => c._count > 1).map((c) => c.entityId));
  let live: Tile[] = [];
  let liveError: string | null = null;
  if (cfg?.igUserId) {
    try {
      const r = await callMeta<{ data: { id: string; media_url?: string; thumbnail_url?: string; permalink?: string; media_type?: string; timestamp: string }[] }>("GET", `${cfg.igUserId}/media`, { fields: "id,media_url,thumbnail_url,permalink,media_type,timestamp", limit: "18" });
      live = (r.data ?? []).map((m) => ({ key: m.id, src: m.thumbnail_url ?? m.media_url ?? "", href: m.permalink ?? "#", upcoming: false, date: new Date(m.timestamp), carousel: m.media_type === "CAROUSEL_ALBUM" }));
    } catch (e) {
      liveError = e instanceof Error ? e.message : "تعذر جلب منشورات إنستغرام";
    }
  }
  const tiles: Tile[] = [
    ...upcoming.map((u) => ({ key: `u${u.id}`, src: `/api/files/${u.imageAttachmentId}`, href: `/marketing/${u.id}`, upcoming: true, label: u.title, date: u.publishAt ?? u.scheduledFor, template: u.template, carousel: multi.has(u.id) })),
    ...live,
  ];
  return (
    <>
      <PageHeader
        back={{ href: "/marketing", label: "التسويق" }}
        title="شبكة إنستغرام"
        subtitle="المنشورات القادمة (بإطار ذهبي) فوق آخر منشورات الحساب الفعلية — كما ستظهر للزائر. كل مربع بشكل مختلف: صورة بإطار، شكل هندسي مرسوم، مقسوم، مخطط."
        actions={
          <ActionForm action={designPending} submitLabel="صمّم كل الناقص ذكياً">
            <span />
          </ActionForm>
        }
      />
      {liveError && <p className="mb-4 rounded-xl bg-warn-soft px-3 py-2 text-sm text-warn">{liveError}</p>}
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="mx-auto max-w-[620px] overflow-hidden rounded-[28px] border border-line bg-white p-1 shadow-card">
            <div className="grid grid-cols-3 gap-1" dir="ltr">
              {tiles.map((t) => (
                <Link key={t.key} href={t.href} target={t.upcoming ? undefined : "_blank"} className="group relative block aspect-[4/5] overflow-hidden bg-canvas">
                  {t.src && <img src={t.src} alt="" loading="lazy" className="h-full w-full object-cover transition group-hover:scale-105" />}
                  {t.upcoming && <span className="pointer-events-none absolute inset-0 ring-4 ring-inset ring-gold" />}
                  {t.carousel && <LayoutGrid className="absolute right-2 top-2 h-5 w-5 text-white drop-shadow" />}
                  {t.upcoming && <span className="absolute bottom-1 left-1 rounded-md bg-gold px-1.5 py-0.5 text-[10px] font-black text-navy">قادم{t.date ? ` ${fmtDate(t.date)}` : ""}</span>}
                </Link>
              ))}
            </div>
            {tiles.length === 0 && <p className="p-10 text-center text-sm text-ink-muted">لا توجد منشورات مصممة بعد — صمّم منشوراً من صفحته</p>}
          </div>
        </div>
        <Card title="قواعد الكتالوج الهندسي">
          <ul className="space-y-2 text-sm leading-7 text-ink-soft">
            <li>• كل منشور يحمل رقم كتالوج متسلسل <b dir="ltr">SJ · 0NN</b> أسفل التصميم.</li>
            <li>• القالب يتناوب تلقائياً: {(["frame", "motif", "split", "blueprint"] as TemplateId[]).map((t) => TEMPLATES[t].name).join(" ← ")} — دورة رباعية على شبكة ثلاثية فلا يتكرر الشكل في صف ولا عمود.</li>
            <li>• المقاس 1080×1350 (4:5) لكل المنشورات: يملأ مساحة الشبكة الجديدة دون قص.</li>
            <li>• الكاروسيل لعرض مراحل المشروع (قبل/أثناء/بعد) بشرائح متسلسلة وشريحة ختام بالتواصل.</li>
            <li>• الألوان ثابتة: كحلي، ذهبي، برتقالي — والشعار الأصلي في نفس المكان دائماً.</li>
            <li>• «شكل هندسي»: رسم يولّده الذكاء الاصطناعي لموضوع المنشور (رافعة، جرافة، خزان، مغسلة...) — رسم توضيحي لا يُقدَّم كصورة مشروع حقيقي.</li>
          </ul>
          <div className="mt-4 flex flex-wrap gap-2">
            {upcoming.length > 0 && <Badge tone="orange">{upcoming.length} قادم</Badge>}
            <Badge tone="gray">{live.length} منشور فعلي</Badge>
          </div>
        </Card>
      </div>
    </>
  );
}

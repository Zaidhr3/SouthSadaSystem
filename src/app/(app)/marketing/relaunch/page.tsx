import Link from "next/link";
import { ArrowLeftRight, CheckCircle2, ExternalLink, Facebook, Instagram, RefreshCcw } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { can, see } from "@/lib/permissions";
import { oldPosts, type OldPost, type RelaunchRef } from "@/lib/relaunch";
import { MKT_STATUS } from "@/lib/marketing";
import { fmtDate } from "@/lib/format";
import { Badge, Card, PageHeader, StatusBadge } from "@/components/ui";
import { ActionForm, Select } from "@/components/forms";
import { approveAllRelaunch, markIgRetiredAction, prepareRelaunchAction, retireOldAction } from "../../actions/relaunch";

export const metadata = { title: "إعادة إطلاق الصفحة" };
/** تنزيل الصور + التصميم بالمتصفح لعدة منشورات */
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export default async function RelaunchPage() {
  const user = await requireUser(see.marketing);
  const manage = can.manageMarketing(user.role);
  let posts: OldPost[] = [];
  let errors: string[] = [];
  try {
    ({ posts, errors } = await oldPosts());
  } catch (e) {
    errors = [e instanceof Error ? e.message : "تعذر جلب المنشورات"];
  }
  const items = await db.marketingItem.findMany({ where: { source: "RELAUNCH" }, orderBy: [{ publishAt: "asc" }, { id: "asc" }] });
  const candidates = posts.filter((p) => !p.relaunched);
  const waiting = items.filter((i) => ["IN_REVIEW", "SUGGESTED"].includes(i.status)).length;
  return (
    <>
      <PageHeader
        back={{ href: "/marketing", label: "التسويق" }}
        title="إعادة إطلاق الصفحة"
        subtitle="تحويل المنشورات القديمة إلى كتالوج هندسي موحد: نفس الصورة الأصلية بقالب الشركة ورقم كتالوج، نص محسّن بلا أي رقم مختلق، نشر متتابع — ثم حذف القديم"
        actions={
          manage &&
          waiting > 0 && (
            <ActionForm action={approveAllRelaunch} submitLabel={`اعتماد الجاهز (${waiting}) وجدولته`}>
              <span />
            </ActionForm>
          )
        }
      />
      {errors.length > 0 && <p className="mb-4 rounded-xl bg-warn-soft px-3 py-2 text-sm text-warn">{errors.join(" — ")}</p>}

      {items.length > 0 && (
        <Card title={`النسخ الجديدة (${items.length})`} className="mb-5">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {items.map((it) => {
              const ref = JSON.parse(it.relaunchOf ?? "{}") as RelaunchRef;
              const published = it.status === "PUBLISHED";
              const fbOpen = !!ref.fb && !ref.retired?.fb;
              const igOpen = !!ref.ig && !ref.retired?.ig;
              return (
                <div key={it.id} className="card overflow-hidden">
                  <Link href={`/marketing/${it.id}`} className="block aspect-[4/5] bg-canvas">
                    {it.imageAttachmentId && <img src={`/api/files/${it.imageAttachmentId}`} alt="" loading="lazy" className="h-full w-full object-cover" />}
                  </Link>
                  <div className="space-y-2 p-3 text-sm">
                    <p className="line-clamp-2 font-bold">{it.title}</p>
                    <div className="flex flex-wrap items-center gap-1">
                      <StatusBadge map={MKT_STATUS} value={it.status} />
                      {it.publishAt && !published && <Badge tone="blue">{fmtDate(it.publishAt)}</Badge>}
                      <Badge tone="gray">الأصل {ref.at?.slice(0, 10)}</Badge>
                    </div>
                    <div className="flex flex-wrap gap-3 text-xs">
                      {ref.fbLink && (
                        <a href={ref.fbLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[#1877f2]">
                          <Facebook className="h-3.5 w-3.5" /> القديم{ref.retired?.fb ? " (حُذف)" : ""}
                        </a>
                      )}
                      {ref.igLink && (
                        <a href={ref.igLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[#d6249f]">
                          <Instagram className="h-3.5 w-3.5" /> القديم{ref.retired?.ig ? " (مؤرشف)" : ""}
                        </a>
                      )}
                    </div>
                    {manage && published && (fbOpen || igOpen) && (
                      <div className="flex flex-wrap gap-2">
                        <ActionForm action={retireOldAction.bind(null, it.id)} submitLabel="حذف المنشور القديم">
                          <span />
                        </ActionForm>
                        {igOpen && (
                          <ActionForm action={markIgRetiredAction.bind(null, it.id)} submitLabel="تمت أرشفة إنستغرام يدوياً">
                            <span />
                          </ActionForm>
                        )}
                      </div>
                    )}
                    {published && !fbOpen && !igOpen && (
                      <p className="flex items-center gap-1 text-xs font-semibold text-good">
                        <CheckCircle2 className="h-4 w-4" /> اكتمل الاستبدال
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <Card title={<span className="flex items-center gap-2"><RefreshCcw className="h-4 w-4 text-gold" /> المنشورات القديمة ({candidates.length})</span>}>
        {candidates.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-muted">لا توجد منشورات قديمة بصور بانتظار إعادة الإطلاق</p>
        ) : manage ? (
          <ActionForm action={prepareRelaunchAction} submitLabel="تجهيز المختار بقالب الكتالوج (4 في كل دفعة)">
            <p className="text-xs leading-6 text-ink-muted">
              الأقدم يُنشر أولاً فيبقى الأحدث أعلى الشبكة. النص: الصياغة المعتمدة في «مراجعة الصفحة» إن وُجدت، وإلا الأصل بعد المؤنسن — دون إضافة أي رقم. ألغِ تحديد ما لا يناسب الكتالوج (مثل إعلانات البيع).
            </p>
            <Select name="every" label="الفاصل بين المنشورات" options={[{ value: "1", label: "منشور كل يوم" }, { value: "2", label: "كل يومين" }, { value: "3", label: "كل 3 أيام" }]} defaultValue="1" />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {candidates.map((p) => (
                <label key={p.key} className="card flex cursor-pointer gap-3 p-2.5 has-[:checked]:ring-2 has-[:checked]:ring-gold">
                  <input type="checkbox" name="keys" value={p.key} defaultChecked={!!p.text.trim() && !/للبيع|للايجار|للإيجار/.test(p.text)} className="mt-1 h-4 w-4 shrink-0 accent-[#f2b134]" />
                  {p.picture && <img src={p.picture} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-20 w-16 shrink-0 rounded-lg object-cover" />}
                  <span className="min-w-0 text-xs leading-5">
                    <span className="mb-1 flex items-center gap-1.5 font-semibold text-ink-soft">
                      {p.fb && <Facebook className="h-3.5 w-3.5 text-[#1877f2]" />}
                      {p.ig && <Instagram className="h-3.5 w-3.5 text-[#d6249f]" />}
                      {p.at.slice(0, 10)}
                      {(p.fbLink || p.igLink) && <ExternalLink className="h-3 w-3 text-ink-faint" />}
                    </span>
                    <span className="line-clamp-3 text-ink-muted">{p.text || "— بلا نص —"}</span>
                  </span>
                </label>
              ))}
            </div>
          </ActionForm>
        ) : (
          <p className="text-sm text-ink-muted">{candidates.length} منشوراً قديماً</p>
        )}
        <p className="mt-3 flex items-start gap-2 text-xs text-ink-muted">
          <ArrowLeftRight className="h-4 w-4 shrink-0" /> بعد نشر كل نسخة جديدة: «حذف المنشور القديم» يحذفه من فيسبوك مباشرة. إنستغرام يُحذف إن سمحت Meta، وإلا أرشفه من التطبيق (⋯ ← أرشفة) — الأرشفة تخفيه من الشبكة ويمكن استرجاعه.
        </p>
      </Card>
    </>
  );
}

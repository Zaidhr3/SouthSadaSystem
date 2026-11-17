import Link from "next/link";
import clsx from "clsx";
import type { Prisma } from "@prisma/client";
import { RefreshCcw, Images, LayoutGrid, Palette } from "lucide-react";
import { CalendarDays, Fingerprint, Lightbulb, Megaphone, Radar, Sparkles, Wand2 } from "lucide-react";
import { runPageAuditAction } from "../actions/meta";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { can, see } from "@/lib/permissions";
import { MKT_CATEGORY, MKT_KIND, MKT_STATUS, occasionsBetween } from "@/lib/marketing";
import { writerName } from "@/lib/ai/writer";
import { metaStatus } from "@/lib/meta";
import { fmtDate, todayUTC } from "@/lib/format";
import { Badge, Card, EmptyState, PageHeader, StatCard, StatusBadge } from "@/components/ui";
import { ActionForm, Input, Select, Textarea } from "@/components/forms";
import { generateBrainstorm, generateEvent, generateFromIdea, generateWeek, runSkillAction } from "../actions/marketing";
import { SKILLS } from "@/lib/content-skills/skills";
import { SkillRunner } from "./skill-runner";

export const metadata = { title: "التسويق والعلاقات العامة" };
export const maxDuration = 300;

const VIEWS: [string, string, Prisma.MarketingItemWhereInput][] = [
  ["review", "بانتظار المراجعة", { status: { in: ["SUGGESTED", "IN_REVIEW", "FAILED"] }, source: { notIn: ["AUDIT_FB", "AUDIT_IG"] } }],
  ["audit", "مراجعة محتوى الصفحة", { source: { in: ["AUDIT_FB", "AUDIT_IG"] } }],
  ["approved", "معتمد — جاهز للنشر", { status: "APPROVED" }],
  ["published", "المنشور", { status: "PUBLISHED" }],
  ["all", "الكل", {}],
];

export default async function MarketingPage({ searchParams }: { searchParams: { view?: string } }) {
  const user = await requireUser(see.marketing);
  const manage = can.manageMarketing(user.role);
  const view = VIEWS.find((v) => v[0] === searchParams.view) ?? VIEWS[0];
  const today = todayUTC();
  const weekAgo = new Date(+today - 7 * 86400000);
  const [items, counts, postsWeek, storiesToday] = await Promise.all([
    db.marketingItem.findMany({ where: view[2], orderBy: [{ scheduledFor: "asc" }, { id: "desc" }], take: 200 }),
    db.marketingItem.groupBy({ by: ["status"], _count: true }),
    db.marketingItem.count({ where: { kind: "POST", status: "PUBLISHED", publishedAt: { gte: weekAgo } } }),
    db.marketingItem.count({ where: { kind: "STORY", status: "PUBLISHED", publishedAt: { gte: today } } }),
  ]);
  const c = (s: string[]) => counts.filter((x) => s.includes(x.status)).reduce((a, x) => a + x._count, 0);
  const occ = occasionsBetween(today, 30);
  const ai = writerName();
  const meta = await metaStatus();

  return (
    <>
      <PageHeader
        title="التسويق والعلاقات العامة"
        actions={
          <>
            <Link href="/marketing/grid" className="btn-secondary"><LayoutGrid className="h-4 w-4" /> شبكة إنستغرام</Link>
            <Link href="/marketing/media" className="btn-secondary"><Images className="h-4 w-4" /> مكتبة الوسائط</Link>
            <Link href="/marketing/brand" className="btn-secondary"><Palette className="h-4 w-4" /> هوية الحسابات</Link>
            <Link href="/marketing/relaunch" className="btn-secondary"><RefreshCcw className="h-4 w-4" /> إعادة إطلاق الصفحة</Link>
          </>
        }
        subtitle={<>محتوى ذكي مبني على مشاريع الشركة الفعلية — الاستراتيجية: 1–2 منشور أسبوعياً و1–2 قصة يومياً. {ai ? <Badge tone="purple">الكاتب: {ai}</Badge> : <Badge tone="red">الذكاء الاصطناعي غير مُعد</Badge>} {meta?.configured ? (meta.ok ? <Badge tone="green">فيسبوك{meta.hasInstagram ? " + إنستغرام" : ""} مربوط{meta.pageName ? ` — ${meta.pageName}` : ""}</Badge> : <Badge tone="red">انقطع ربط فيسبوك — أعد الربط من الإعدادات</Badge>) : <Badge tone="gray">النشر التلقائي غير مربوط — نشر يدوي</Badge>}</>}
      />
      <div className="mb-5 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard label="بانتظار المراجعة" value={c(["SUGGESTED", "IN_REVIEW", "FAILED"])} icon={Lightbulb} tone="orange" />
        <StatCard label="معتمد للنشر" value={c(["APPROVED"])} icon={Sparkles} tone="blue" />
        <StatCard label="منشورات هذا الأسبوع" value={`${postsWeek} / 2`} sub="الهدف 1–2 أسبوعياً" icon={Megaphone} tone={postsWeek >= 1 ? "green" : "gray"} />
        <StatCard label="قصص اليوم" value={`${storiesToday} / 2`} sub="الهدف 1–2 يومياً" icon={CalendarDays} tone={storiesToday >= 1 ? "green" : "gray"} />
      </div>

      {manage && (
        <div className="mb-5 grid gap-5 lg:grid-cols-3">
          {meta?.configured && meta.ok && (
            <Card className="lg:col-span-3" title={<span className="flex items-center gap-2"><Fingerprint className="h-5 w-5 text-navy-3" /> مراجعة محتوى الصفحة الحالي</span>}>
              <p className="mb-3 text-sm text-ink-muted">يسحب آخر 25 منشوراً من فيسبوك و25 من إنستغرام، يفحص البصمة البشرية، ويقترح صياغة أرقى بنفس الحقائق حرفياً (لا أرقام ولا تفاصيل جديدة). فيسبوك: تطبيق التعديل بضغطة. إنستغرام: نسخ ولصق (Meta لا تسمح بتعديل نص إنستغرام برمجياً).</p>
              <ActionForm action={runPageAuditAction} submitLabel="ابدأ المراجعة">
                <span />
              </ActionForm>
            </Card>
          )}
          <Card title={<span className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-accent" /> الاقتراح الذكي</span>}>
            <p className="mb-3 text-sm text-ink-muted">خطة أسبوع كاملة: منشوران وقصة لكل يوم، من إنجازات المشاريع ويوميات المواقع ونصائح إنشائية ومناسبات قادمة. (تُقترح تلقائياً كل صباح أيضاً)</p>
            <ActionForm action={generateWeek} submitLabel="اقترح خطة الأسبوع">
              <span />
            </ActionForm>
          </Card>
          <Card title={<span className="flex items-center gap-2"><Wand2 className="h-5 w-5 text-accent" /> عصف أفكار سريع</span>}>
            <p className="mb-3 text-sm text-ink-muted">6 أفكار مبتكرة خلال ثوانٍ، كل واحدة بصيغة حديثة مختلفة: ريل، قبل/بعد، كاروسيل تعليمي، خرافة ضد حقيقة، كواليس الموقع، سلسلة متابعة.</p>
            <ActionForm action={generateBrainstorm} submitLabel="اخترع أفكاراً الآن">
              <Input name="focus" label="التركيز (اختياري)" placeholder="مثال: خزانات المياه قبل الصيف، أو جذب ملاك أراضٍ في مادبا" />
            </ActionForm>
          </Card>
          <Card title={<span className="flex items-center gap-2"><Lightbulb className="h-5 w-5 text-gold" /> عندي فكرة</span>}>
            <ActionForm action={generateFromIdea} submitLabel="صِغها باحتراف">
              <Textarea name="idea" label="الفكرة بكلماتك" rows={3} required placeholder="مثال: صبّينا اليوم سقف فيلا عبدون والعمال اشتغلوا من الفجر" />
              <Select name="kind" label="الشكل" options={[{ value: "BOTH", label: "منشور + قصة" }, { value: "POST", label: "منشور دائم" }, { value: "STORY", label: "قصة يومية" }]} defaultValue="BOTH" />
            </ActionForm>
          </Card>
          <Card title={<span className="flex items-center gap-2"><Radar className="h-5 w-5 text-navy-3" /> رادار الأحداث</span>}>
            <ActionForm action={generateEvent} submitLabel="صياغة الموقف الرسمي">
              <Select name="type" label="نوع الحدث" options={[{ value: "CONGRATS", label: "تهنئة / مباركة" }, { value: "CONDOLENCE", label: "تعزية / نعي" }, { value: "DENOUNCE", label: "استنكار" }]} defaultValue="CONGRATS" />
              <Textarea name="details" label="التفاصيل كما يجب أن تُذكر" rows={2} required placeholder="الأسماء والصفات والمناسبة بدقة" />
            </ActionForm>
          </Card>
        </div>
      )}

      {manage && (
        <details className="card card-pad mb-5">
          <summary className="cursor-pointer list-none">
            <span className="flex items-center justify-between gap-3">
              <span>
                <span className="flex items-center gap-2 text-[17px] font-bold"><Wand2 className="h-5 w-5 text-accent" /> مهارات المحتوى الذكية</span>
                <span className="text-xs text-ink-muted">الرد على التعليقات والرسائل، التعليق على منشورات الجهات، إعادة التدوير، تدقيق الأداء ونبذة الصفحة — والمؤنسن والخطافات والكاروسيل داخل كل منشور</span>
              </span>
              <span className="btn-secondary btn-sm">فتح</span>
            </span>
          </summary>
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {SKILLS.filter((s) => s.scope === "free").map((s) => (
              <SkillRunner key={s.id} skill={s} action={runSkillAction.bind(null, s.id, null)} />
            ))}
          </div>
        </details>
      )}

      {occ.length > 0 && (
        <div className="mb-5 flex flex-wrap items-center gap-2 rounded-2xl bg-gold-soft px-4 py-3 text-sm">
          <span className="font-bold text-warn">مناسبات خلال 30 يوماً:</span>
          {occ.map((o) => (
            <Badge key={o.name + +o.date} tone="orange">{o.name} — {fmtDate(o.date)}</Badge>
          ))}
        </div>
      )}

      <nav className="mb-4 flex gap-1 overflow-x-auto rounded-2xl bg-black/[0.04] p-1">
        {VIEWS.map(([k, label]) => (
          <Link key={k} href={`/marketing?view=${k}`} className={clsx("whitespace-nowrap rounded-xl px-3 py-1.5 text-sm font-bold transition", view[0] === k ? "bg-white text-accent shadow-card" : "text-ink-muted hover:text-ink")}>
            {label}
          </Link>
        ))}
      </nav>
      <Card pad={false}>
        {items.length === 0 ? (
          <EmptyState icon={Megaphone} title="لا يوجد محتوى هنا" hint={manage ? "اضغط «اقترح خطة الأسبوع» أو اكتب فكرتك" : undefined} />
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>الموعد</th>
                  <th>النوع</th>
                  <th>الفكرة</th>
                  <th>التصنيف</th>
                  <th>الحالة</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id}>
                    <td className="num whitespace-nowrap">{it.scheduledFor ? fmtDate(it.scheduledFor) : "—"}</td>
                    <td><StatusBadge map={MKT_KIND} value={it.kind} /></td>
                    <td className="max-w-[420px]">
                      <Link href={`/marketing/${it.id}`} className="font-bold hover:text-accent">{it.title}</Link>
                      <span className="block truncate text-xs text-ink-muted">{it.storyText || it.caption}</span>
                    </td>
                    <td className="whitespace-nowrap text-sm">{MKT_CATEGORY[it.category] ?? it.category}{it.source === "USER" && <Badge tone="gray" className="ms-1">فكرتك</Badge>}{it.source === "AUDIT_FB" && <Badge tone="blue" className="ms-1">مراجعة فيسبوك</Badge>}{it.source === "AUDIT_IG" && <Badge tone="purple" className="ms-1">مراجعة إنستغرام</Badge>}{it.source === "RELAUNCH" && <Badge tone="orange" className="ms-1">إعادة إطلاق</Badge>}{it.source === "AI_IDEA" && <Badge tone="purple" className="ms-1">عصف أفكار</Badge>}</td>
                    <td><StatusBadge map={MKT_STATUS} value={it.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

import Link from "next/link";
import { Building, ChevronLeft, Layers, Plus, Users, Wallet } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { Card, EmptyState, Money, PageHeader, ProgressBar, StatCard, StatusBadge } from "@/components/ui";
import { Grid, Input, ModalForm, Select, Textarea } from "@/components/forms";
import { ACTIVE_BUYER, PROJECT_STATUS } from "@/lib/cobuild-core";
import { committedWhere } from "@/lib/cobuild";
import { createProject } from "../actions/cobuild";

export const metadata = { title: "السكن التشاركي" };
export const dynamic = "force-dynamic";

export default async function CoBuildPage() {
  const user = await requireUser();
  const manage = can.manageCoBuild(user.role);
  const [projects, catalogCount, tenders, held] = await Promise.all([
    db.coBuildProject.findMany({ orderBy: { id: "desc" }, include: { _count: { select: { units: true } } } }),
    db.catalogItem.count({ where: { isActive: true } }),
    manage ? db.tender.findMany({ select: { id: true, name: true, number: true }, orderBy: { id: "desc" }, take: 80 }) : Promise.resolve([]),
    db.coBuildBuyer.aggregate({ where: { custodyStatus: "held_pending_go", status: { in: ACTIVE_BUYER } }, _sum: { chequeAmount: true }, _count: true }),
  ]);
  const committed = await Promise.all(projects.map((p) => db.coBuildBuyer.count({ where: committedWhere(p.id) })));

  return (
    <>
      <PageHeader
        eyebrow="ابنِ شقتك بشفافية — من العظم إلى المفتاح"
        title="السكن التشاركي"
        subtitle="مشاريع شقق بنصاب التزام (مثلاً 7 من 8) بشيكات مصدقة بالأمانة حتى «تم»، مع كتالوج تشطيب قابل للتعديل بالكامل، حوافز الانتظار و«جيب جارك»، وبوابة للمالك تعرض وين وصل المشروع وشو عنده وشو بكرا."
        actions={
          <>
            <Link href="/cobuild/catalog" className="btn-secondary"><Layers className="h-4 w-4" /> كتالوج المواد والأسعار</Link>
            {manage && (
              <ModalForm trigger={<><Plus className="h-4 w-4" /> مشروع جديد</>} title="مشروع سكن تشاركي جديد" action={createProject} submitLabel="إنشاء المشروع" wide>
                <Grid>
                  <Input name="name" label="اسم المشروع" required placeholder="مثال: إسكان صدى — دابوق" />
                  <Input name="location" label="الموقع" required placeholder="مثال: دابوق / المقابلين" />
                </Grid>
                <Grid cols={3}>
                  <Input name="parcel" label="رقم القطعة" />
                  <Input name="basin" label="الحوض" />
                  <Select name="tenderId" label="ربط بمشروع تنفيذ (اختياري)" placeholder="— بلا ربط —" options={tenders.map((x) => ({ value: x.id, label: `${x.number} — ${x.name}` }))} />
                </Grid>
                <Grid cols={3}>
                  <Input name="totalUnits" label="عدد الشقق" type="number" step="1" defaultValue={8} required />
                  <Input name="launchThreshold" label="نصاب الانطلاق «تم»" type="number" step="1" defaultValue={7} required />
                  <Input name="perFloor" label="شقق كل طابق" type="number" step="1" defaultValue={2} />
                </Grid>
                <Grid cols={3}>
                  <Select name="startFloor" label="أول طابق سكني" options={[{ value: 1, label: "الأرضي (التسوية للكراجات والخدمات)" }, { value: 0, label: "التسوية" }]} defaultValue={1} />
                  <Input name="area" label="مساحة الشقة الافتراضية (م²)" type="number" step="0.1" required />
                  <Input name="skeletonPrice" label="سعر الشقة على العظم (د.أ)" type="number" step="1" required hint="يُعدَّل لكل شقة لاحقاً حسب الطابق والواجهة" />
                </Grid>
                <Textarea name="description" label="وصف المشروع (يظهر للمشترين)" rows={3} />
                <p className="text-xs text-ink-muted">تُنشأ الشقق تلقائياً بأرقامها وطوابقها، والشقة الأخيرة تُعلَّم «احتياطية» (خارج النصاب وتباع لاحقاً) إذا كان النصاب أقل من عدد الشقق.</p>
              </ModalForm>
            )}
          </>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard label="المشاريع" value={projects.length} icon={Building} tone="blue" />
        <StatCard label="بانتظار «تم»" value={projects.filter((p) => p.status === "collecting_buyers" || p.status === "ready_to_launch").length} icon={Users} tone="orange" />
        <StatCard label="شيكات مصدقة بالأمانة" value={<Money value={held._sum.chequeAmount ?? 0} />} sub={`${held._count} شيكات — لا تُحرَّر قبل «تم»`} icon={Wallet} tone="purple" />
        <StatCard label="بنود الكتالوج الفعّالة" value={catalogCount} icon={Layers} tone="green" href="/cobuild/catalog" />
      </div>

      {projects.length === 0 ? (
        <Card>
          <EmptyState icon={Building} title="لا مشاريع سكن تشاركي بعد" hint={manage ? "ابدأ بتعبئة كتالوج المواد والأسعار، ثم أنشئ أول مشروع" : undefined} />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {projects.map((p, i) => (
            <Link key={p.id} href={`/cobuild/${p.id}`} className="card card-pad pressable hover-lift block">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-bold text-ink-muted">{p.ref}</p>
                  <p className="truncate text-lg font-black text-navy">{p.name}</p>
                  <p className="text-sm text-ink-muted">{p.location} — {p._count.units} شقق</p>
                </div>
                <ChevronLeft className="h-5 w-5 shrink-0 text-ink-faint" />
              </div>
              <div className="mt-3 flex items-center justify-between gap-2">
                <StatusBadge map={PROJECT_STATUS} value={p.status} />
                <span className="num text-sm font-black text-accent">{committed[i]} / {p.launchThreshold}</span>
              </div>
              <ProgressBar className="mt-2" value={p.launchedAt ? p.progress : Math.round((committed[i] / p.launchThreshold) * 100)} />
              <p className="mt-1 text-xs text-ink-muted">{p.launchedAt ? `الإنجاز — ${p.phaseLabel ?? ""}` : "جاهزية المجموعة للانطلاق"}</p>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

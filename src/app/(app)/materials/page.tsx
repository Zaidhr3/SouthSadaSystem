import Link from "next/link";
import { PackageCheck } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { can, tenderScope } from "@/lib/permissions";
import { SurplusSection } from "./surplus-section";
import { attachmentsMap } from "@/lib/uploads";
import { getSettings } from "@/lib/settings";
import { previousCumulative } from "@/lib/surveys";
import { Badge, Card, EmptyState, PageHeader, StatCard } from "@/components/ui";
import { analyzeMaterials, MaterialReceiptTable } from "@/components/modules";

export const metadata = { title: "المستودعات والمواد" };

export default async function MaterialsPage() {
  const user = await requireUser();
  const settings = await getSettings();
  const projects = await db.tender.findMany({
    where: { ...tenderScope(user), materials: { some: {} } },
    include: { boqItems: true, materials: true },
  });
  const recent = await db.materialReceipt.findMany({ where: { tender: tenderScope(user) }, include: { tender: { select: { id: true, name: true } } }, orderBy: { date: "desc" }, take: 100 });
  const [atts, users] = await Promise.all([attachmentsMap("material", recent.map((r) => r.id)), db.user.findMany({ select: { id: true, name: true } })]);
  const nameOf = new Map(users.map((u) => [u.id, u.name]));
  const measured = await Promise.all(projects.map((p) => previousCumulative(p.id)));
  const summaries = projects.map((p, i) => {
    const a = analyzeMaterials(p.boqItems, p.materials, p.progress, settings.wasteTolerancePct, measured[i]);
    return { p, over: a.filter((x) => x.flag === "over"), ahead: a.filter((x) => x.flag === "ahead") };
  });
  const totalOver = summaries.reduce((s, x) => s + x.over.length, 0);
  const [surplus, active] = await Promise.all([
    db.surplusItem.findMany({ where: { status: "AVAILABLE" }, orderBy: { createdAt: "desc" } }),
    db.tender.findMany({ where: { ...tenderScope(user), status: { in: ["WON", "EXECUTION", "MAINTENANCE"] } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const tName = new Map((await db.tender.findMany({ where: { id: { in: surplus.map((x) => x.fromTenderId ?? 0) } }, select: { id: true, name: true } })).map((t) => [t.id, t.name]));

  return (
    <>
      <PageHeader title="المستودعات والمواد الموقعية" subtitle={`توريدات المواد بصور الإثبات ومقارنتها بالاستهلاك النظري لجدول الكميات — تسامح الهدر ${settings.wasteTolerancePct}%`} />
      <div className="stagger mb-5 grid grid-cols-2 gap-4 xl:grid-cols-3">
        <StatCard label="توريدات مسجلة" value={recent.length} icon={PackageCheck} />
        <StatCard label="مشاريع تُتابع موادها" value={projects.length} />
        <StatCard label="بنود متجاوزة للكمية التعاقدية" value={totalOver} tone={totalOver ? "red" : "green"} sub="هدر محتمل يستوجب المراجعة" />
      </div>

      <SurplusSection items={surplus.map((x) => ({ ...x, fromName: x.fromTenderId ? tName.get(x.fromTenderId) : null }))} projects={active} canEdit={can.manageProjectLifecycle(user.role)} canDelete={can.manageFinance(user.role)} />

      {summaries.length > 0 && (
        <div className="stagger mb-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {summaries.map(({ p, over, ahead }) => (
            <Link key={p.id} href={`/tenders/${p.id}?tab=materials`} className="card card-pad block transition hover:-translate-y-0.5 hover:shadow-pop">
              <p className="font-bold">{p.name}</p>
              <p className="text-xs text-ink-muted">إنجاز {p.progress}% — {p.materials.length} توريدات</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {over.length > 0 ? <Badge tone="red">{over.length} بنود متجاوزة</Badge> : <Badge tone="green">✓ لا تجاوزات</Badge>}
                {ahead.length > 0 && <Badge tone="orange">{ahead.length} فوق الاستهلاك النظري</Badge>}
              </div>
            </Link>
          ))}
        </div>
      )}

      <Card pad={false} title={<span className="px-5 pt-5 sm:px-6">آخر التوريدات — تُسجل من تبويب «المواد» في صفحة المشروع</span>}>
        {recent.length === 0 ? (
          <EmptyState icon={PackageCheck} title="لا توجد توريدات" />
        ) : (
          <MaterialReceiptTable rows={recent.map((r) => ({ ...r, receivedBy: { name: nameOf.get(r.receivedById) ?? "" } }))} user={user} atts={atts} showTender />
        )}
      </Card>
    </>
  );
}

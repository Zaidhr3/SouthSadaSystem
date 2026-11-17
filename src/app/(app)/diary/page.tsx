import Link from "next/link";
import { HardHat } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { can, tenderScope } from "@/lib/permissions";
import { attachmentsMap } from "@/lib/uploads";
import { daysUntil, fmtDate, todayUTC } from "@/lib/format";
import { Badge, Card, PageHeader, StatCard } from "@/components/ui";
import { DiaryForm, DiaryList } from "@/components/field";

export const metadata = { title: "اليومية الموقعية" };

export default async function DiaryPage({ searchParams }: { searchParams: { tender?: string } }) {
  const user = await requireUser();
  const filter = Number(searchParams.tender) || undefined;
  const projects = await db.tender.findMany({
    where: { ...tenderScope(user), status: { in: ["EXECUTION", "WON", "MAINTENANCE"] } },
    select: { id: true, name: true, diaries: { select: { date: true }, orderBy: { date: "desc" }, take: 1 } },
    orderBy: { name: "asc" },
  });
  const rows = await db.siteDiary.findMany({
    where: { tender: tenderScope(user), ...(filter ? { tenderId: filter } : {}) },
    orderBy: [{ date: "desc" }, { id: "desc" }],
    take: 100,
  });
  const atts = await attachmentsMap("diary", rows.map((r) => r.id));
  const names = new Map((await db.tender.findMany({ where: { id: { in: Array.from(new Set(rows.map((r) => r.tenderId))) } }, select: { id: true, name: true } })).map((t) => [t.id, t.name]));
  const today = todayUTC().getTime();
  const missingToday = projects.filter((p) => !p.diaries[0] || p.diaries[0].date.getTime() < today);

  return (
    <>
      <PageHeader title="اليومية الموقعية الرقمية" subtitle="سجل يومي للأعمال المنفذة والعمالة والآليات والعوائق مع صور الموقع" />
      <div className="stagger mb-5 grid grid-cols-2 gap-4 xl:grid-cols-3">
        <StatCard label="مشاريع قيد التنفيذ" value={projects.length} icon={HardHat} />
        <StatCard label="بدون يومية اليوم" value={missingToday.length} tone={missingToday.length ? "orange" : "green"} />
        <StatCard label="يوميات مسجلة (آخر 100)" value={rows.length} tone="gray" />
      </div>

      {projects.length > 0 && (
        <Card title="حالة اليومية لكل مشروع" className="mb-5">
          <ul className="divide-y divide-line">
            {projects.map((p) => {
              const last = p.diaries[0]?.date;
              const gap = last ? -daysUntil(last) : null;
              return (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                  <Link href={`/diary?tender=${p.id}`} className="font-semibold hover:text-accent">{p.name}</Link>
                  <span className="flex items-center gap-2">
                    {gap === 0 ? <Badge tone="green">✓ سُجلت اليوم</Badge> : <Badge tone="orange">{last ? `آخر يومية ${fmtDate(last)}` : "لا توجد يوميات"}</Badge>}
                    {can.fieldOps(user.role) && <DiaryForm tenderId={p.id} />}
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {filter && (
        <p className="mb-3 text-sm">
          مفلتر على مشروع واحد — <Link href="/diary" className="font-semibold text-accent">عرض الكل</Link>
        </p>
      )}
      <DiaryList rows={rows} user={user} atts={atts} tenderNames={names} />
    </>
  );
}

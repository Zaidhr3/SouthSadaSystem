import Link from "next/link";
import clsx from "clsx";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { tenderScope } from "@/lib/permissions";
import { tenderPhotos } from "@/lib/photos";
import { Card, PageHeader } from "@/components/ui";
import { PhotoGrid } from "@/components/field";

export const metadata = { title: "خزنة صور المواقع" };

export default async function PhotosPage({ searchParams }: { searchParams: { tender?: string } }) {
  const user = await requireUser();
  const projects = await db.tender.findMany({ where: { ...tenderScope(user), status: { in: ["WON", "EXECUTION", "MAINTENANCE", "CLOSED"] } }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  const filter = Number(searchParams.tender) || undefined;
  const ids = filter ? projects.filter((p) => p.id === filter).map((p) => p.id) : projects.map((p) => p.id);
  const photos = await tenderPhotos(ids, 400);

  return (
    <>
      <PageHeader title="خزنة صور المواقع" subtitle="كل صور المشاريع في مكان واحد: اليوميات، التوريدات، الحصر، المطالبات، والمعرض — تُرفع من صفحة المشروع" />
      <div className="mb-4 flex flex-wrap gap-2">
        <Link href="/photos" className={clsx("btn-sm", !filter ? "btn-primary" : "btn-secondary")}>كل المشاريع</Link>
        {projects.map((p) => (
          <Link key={p.id} href={`/photos?tender=${p.id}`} className={clsx("btn-sm", filter === p.id ? "btn-primary" : "btn-secondary")}>{p.name}</Link>
        ))}
      </div>
      <Card title={`${photos.length} صورة`}>
        <PhotoGrid photos={photos} />
      </Card>
    </>
  );
}

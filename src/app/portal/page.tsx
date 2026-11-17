import Link from "next/link";
import { redirect } from "next/navigation";
import { Building2, ChevronLeft } from "lucide-react";
import { db } from "@/lib/db";
import { requireClient } from "@/lib/client-session";
import { fmtDate } from "@/lib/format";
import { ProgressBar } from "@/components/ui";

export const metadata = { title: "مشاريعي" };

export default async function PortalHome() {
  const c = await requireClient();
  if (c.mustChangePassword) redirect("/portal/password");
  const ids = c.accesses.map((a) => a.tenderId);
  if (ids.length === 1) redirect(`/portal/${ids[0]}`);
  const projects = await db.tender.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, location: true, progress: true, commenceOrderDate: true, updatedAt: true }, orderBy: { id: "desc" } });
  return (
    <>
      <h1 className="text-gradient mb-1 text-2xl font-extrabold">أهلاً {c.name}</h1>
      <p className="mb-6 text-ink-muted">اختر المشروع لمتابعته</p>
      {projects.length === 0 ? (
        <div className="card p-8 text-center text-ink-muted">لا توجد مشاريع مربوطة بحسابك بعد — تواصل مع الشركة.</div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {projects.map((p) => (
            <Link key={p.id} href={`/portal/${p.id}`} className="card card-pad pressable hover-lift block">
              <div className="flex items-start justify-between gap-3">
                <span className="grid h-11 w-11 place-items-center rounded-xl bg-gold-soft text-warn"><Building2 className="h-5 w-5" /></span>
                <ChevronLeft className="h-5 w-5 text-ink-faint" />
              </div>
              <p className="mt-3 text-lg font-extrabold">{p.name}</p>
              <p className="text-sm text-ink-muted">{p.location ?? ""}{p.commenceOrderDate ? ` — بدأ ${fmtDate(p.commenceOrderDate)}` : ""}</p>
              <div className="mt-3 flex items-center gap-3">
                <ProgressBar value={p.progress} className="flex-1" />
                <span className="num font-bold text-accent">{p.progress}%</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

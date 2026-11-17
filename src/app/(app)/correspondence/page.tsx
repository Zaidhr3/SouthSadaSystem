import Link from "next/link";
import clsx from "clsx";
import type { Prisma } from "@prisma/client";
import { FilePenLine, Mail, Search } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { tenderScope } from "@/lib/permissions";
import { DIRECTION, LETTER_STATUS } from "@/lib/labels";
import { attachmentsMap } from "@/lib/uploads";
import { Card, PageHeader, StatCard, StatusBadge } from "@/components/ui";
import { CorrespondenceForm, CorrespondenceTable } from "@/components/modules";
import { OfficialLetterForm } from "@/components/letters";
import { toInputDate, todayUTC, fmtDate } from "@/lib/format";

export const metadata = { title: "الصادر والوارد" };

export default async function CorrespondencePage({ searchParams }: { searchParams: { dir?: string; q?: string } }) {
  const user = await requireUser();
  const dir = searchParams.dir && searchParams.dir in DIRECTION ? searchParams.dir : undefined;
  const q = (searchParams.q ?? "").trim();
  const where: Prisma.CorrespondenceWhereInput = {
    ...(user.role === "PM" ? { tender: tenderScope(user) } : {}),
    ...(dir ? { direction: dir } : {}),
    ...(q ? { OR: [{ subject: { contains: q } }, { party: { contains: q } }, { refNo: { contains: q } }, { theirRef: { contains: q } }] } : {}),
  };
  const [rows, tenders, counts] = await Promise.all([
    db.correspondence.findMany({ where, include: { tender: { select: { id: true, name: true } }, replyTo: { select: { id: true, refNo: true } }, replies: { select: { id: true, refNo: true } } }, orderBy: [{ date: "desc" }, { id: "desc" }], take: 300 }),
    db.tender.findMany({ where: { ...tenderScope(user), status: { notIn: ["LOST", "CANCELLED"] } }, select: { id: true, name: true } }),
    db.correspondence.groupBy({ by: ["direction"], where: { ...(user.role === "PM" ? { tender: tenderScope(user) } : {}), OR: [{ letterStatus: null }, { letterStatus: "APPROVED" }] }, _count: true }),
  ]);
  // كتب رسمية بانتظار قراري (المحاسب/المدير العام) أو مُعادة إليّ للتعديل
  const waitingWhere: Prisma.CorrespondenceWhereInput[] = [{ letterStatus: "RETURNED", createdById: user.id }];
  if (user.role === "ACCOUNTANT" || user.role === "ADMIN") waitingWhere.push({ letterStatus: "PENDING_ACCOUNTANT" });
  if (user.role === "ADMIN") waitingWhere.push({ letterStatus: "PENDING_ADMIN" });
  const waiting = await db.correspondence.findMany({ where: { OR: waitingWhere }, orderBy: { id: "asc" }, take: 30, select: { id: true, subject: true, party: true, letterStatus: true, date: true } });
  const atts = await attachmentsMap("correspondence", rows.map((r) => r.id));
  // الكتب الواردة المتاحة للرد عليها (ضمن نطاق المستخدم)
  const incoming = await db.correspondence.findMany({ where: { direction: "IN", ...(user.role === "PM" ? { tender: tenderScope(user) } : {}) }, orderBy: [{ date: "desc" }, { id: "desc" }], take: 200 });
  const incomingRefs = incoming.map((i) => ({ id: i.id, refNo: i.refNo, party: i.party, subject: i.subject, theirRef: i.theirRef, tenderId: i.tenderId, date: fmtDate(i.date) }));

  return (
    <>
      <PageHeader title="الصادر والوارد والمراسلات الرسمية" subtitle="كتب رسمية على ورقة الشركة تمر على المحاسب والمدير العام ثم تُطبع PDF، وأرشيف الوارد بترقيم تلقائي" actions={<><OfficialLetterForm tenders={tenders} incoming={incomingRefs} today={toInputDate(todayUTC())} /><CorrespondenceForm tenders={tenders} /></>} />
      {waiting.length > 0 && (
        <section className="mb-5 overflow-hidden rounded-3xl border border-accent/20 bg-gradient-to-l from-accent-soft via-white to-white p-4 shadow-card sm:p-5">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-ink">
            <FilePenLine className="h-4 w-4 text-accent" /> كتب رسمية بانتظارك ({waiting.length})
          </h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {waiting.map((w) => (
              <li key={w.id}>
                <Link href={`/correspondence/letters/${w.id}`} className="pressable flex items-center justify-between gap-3 rounded-2xl bg-white px-3 py-2.5 ring-1 ring-black/5 hover:ring-accent/40">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-bold">{w.subject}</span>
                    <span className="block truncate text-xs text-ink-muted">إلى {w.party} — {fmtDate(w.date)}</span>
                  </span>
                  <StatusBadge map={LETTER_STATUS} value={w.letterStatus!} />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="stagger mb-5 grid grid-cols-2 gap-4">
        <StatCard label="صادر" value={counts.find((c) => c.direction === "OUT")?._count ?? 0} icon={Mail} />
        <StatCard label="وارد" value={counts.find((c) => c.direction === "IN")?._count ?? 0} tone="purple" />
      </div>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="flex gap-2">
          <Link href="/correspondence" className={clsx("btn-sm", !dir ? "btn-primary" : "btn-secondary")}>الكل</Link>
          <Link href="/correspondence?dir=OUT" className={clsx("btn-sm", dir === "OUT" ? "btn-primary" : "btn-secondary")}>صادر</Link>
          <Link href="/correspondence?dir=IN" className={clsx("btn-sm", dir === "IN" ? "btn-primary" : "btn-secondary")}>وارد</Link>
        </div>
        <form className="relative sm:ms-auto sm:w-72">
          {dir && <input type="hidden" name="dir" value={dir} />}
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
          <input name="q" defaultValue={q} placeholder="بحث بالموضوع أو الجهة أو الرقم" className="input ps-9" />
        </form>
      </div>
      <Card pad={false}>
        <CorrespondenceTable rows={rows} user={user} atts={atts} showTender />
      </Card>
    </>
  );
}

import Link from "next/link";
import clsx from "clsx";
import { Plus, Receipt } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { can, tenderScope } from "@/lib/permissions";
import { CLAIM_STATUS } from "@/lib/labels";
import { attachmentsMap } from "@/lib/uploads";
import { daysBetween } from "@/lib/format";
import { claimNet } from "@/lib/deductions";
import { Card, Money, PageHeader, StatCard } from "@/components/ui";
import { ClaimTable } from "@/components/tables";

export const maxDuration = 60;

export const metadata = { title: "المطالبات" };

export default async function ClaimsPage({ searchParams }: { searchParams: { status?: string; view?: string } }) {
  const user = await requireUser();
  const status = searchParams.status && searchParams.status in CLAIM_STATUS ? searchParams.status : undefined;
  // مدير المشروع لا يرى المطالبات قبل مرورها ببوابة تدقيق المحاسب
  const scope = { tender: tenderScope(user) };
  // المطالبات المقبوضة والمودعة تنتقل للأرشيف تلقائياً لتنظيف الشاشة الرئيسية
  const archive = searchParams.view === "archive";
  const view = archive ? { archivedAt: { not: null } } : { archivedAt: null };
  const [rows, all] = await Promise.all([
    db.claim.findMany({ where: { ...scope, ...view, ...(status ? { status } : {}) }, include: { tender: { select: { id: true, name: true, number: true } }, lines: true }, orderBy: [{ submittedDate: "desc" }, { number: "desc" }] }),
    db.claim.findMany({ where: scope, select: { status: true, grossAmount: true, retention: true, withholdingTax: true, stampDuty: true, advanceRecovery: true, deductions: true, paidAmount: true, submittedDate: true, paidDate: true } }),
  ]);
  const atts = await attachmentsMap("claim", rows.map((r) => r.id));
  const pending = all.filter((c) => c.status === "SUBMITTED" || c.status === "APPROVED");
  const paid = all.filter((c) => c.status === "PAID");
  const timed = paid.filter((c) => c.paidDate);
  const avgDays = timed.length ? timed.reduce((s, c) => s + daysBetween(c.submittedDate, c.paidDate!), 0) / timed.length : 0;

  return (
    <>
      <PageHeader
        title="المطالبات المالية والفواتير"
        subtitle="الحصر الفعلي ← المطالبة والخلاصة ← تدقيق واعتماد المدير العام وقفلها ← القبض"
        actions={can.manageProjectLifecycle(user.role) && <Link href="/claims/new" className="btn-primary"><Plus className="h-4 w-4" /> إنشاء مطالبة</Link>}
      />
      <div className="mb-5 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard label="بانتظار القبض" value={<Money value={pending.reduce((s, c) => s + claimNet(c), 0)} />} sub={`${pending.length} مطالبات`} icon={Receipt} tone="orange" />
        <StatCard label="المقبوض" value={<Money value={paid.reduce((s, c) => s + (c.paidAmount ?? 0), 0)} />} sub={`${paid.length} مطالبات`} tone="green" />
        <StatCard label="إجمالي الخصومات" value={<Money value={all.reduce((s, c) => s + c.deductions, 0)} />} tone="red" />
        <StatCard label="متوسط مدة القبض" value={`${avgDays.toFixed(0)} يوماً`} sub="من التقديم حتى القبض" />
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        <Link href="/claims?view=archive" className={clsx("btn-sm", archive ? "btn-primary" : "btn-secondary")}>الأرشيف</Link>
        <Link href="/claims" className={clsx("btn-sm", !status && !archive ? "btn-primary" : "btn-secondary")}>الكل (النشطة)</Link>
        {Object.entries(CLAIM_STATUS).map(([k, v]) => (
          <Link key={k} href={`/claims?status=${k}`} className={clsx("btn-sm", status === k ? "btn-primary" : "btn-secondary")}>
            {v.label}
          </Link>
        ))}
      </div>
      <Card pad={false}>
        <ClaimTable rows={rows} user={user} atts={atts} showTender />
      </Card>
    </>
  );
}

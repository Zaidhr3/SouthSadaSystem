import Link from "next/link";
import clsx from "clsx";
import { HardHat, Pencil, Plus } from "lucide-react";
import type { Subcontractor } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { can, tenderScope } from "@/lib/permissions";
import { TRADES } from "@/lib/labels";
import { attachmentsMap } from "@/lib/uploads";
import { Card, EmptyState, Money, PageHeader, StatCard } from "@/components/ui";
import { Grid, Input, ModalForm, Textarea } from "@/components/forms";
import { SubcontractCard, subcontractTotals } from "@/components/modules";
import { saveSubcontractor } from "../actions/modules";
import { SubcontractForm } from "./subcontract-form";

export const metadata = { title: "مقاولو الباطن" };

function SubFields({ s }: { s?: Subcontractor }) {
  return (
    <>
      <Grid>
        <Input name="name" label="اسم المقاول / المصنعية" required defaultValue={s?.name} />
        <Input name="trade" label="الاختصاص" required list="trades" defaultValue={s?.trade} />
      </Grid>
      <datalist id="trades">{TRADES.map((t) => <option key={t} value={t} />)}</datalist>
      <Input name="phone" label="الهاتف" dir="ltr" defaultValue={s?.phone ?? ""} />
      <Textarea name="notes" label="ملاحظات" defaultValue={s?.notes ?? ""} />
    </>
  );
}

export default async function SubcontractorsPage({ searchParams }: { searchParams: { tender?: string } }) {
  const user = await requireUser();
  const admin = can.manageSubcontracts(user.role);
  const tenderFilter = Number(searchParams.tender) || undefined;
  const [agreements, subs, tenders] = await Promise.all([
    db.subcontract.findMany({
      where: { tender: tenderScope(user), ...(tenderFilter ? { tenderId: tenderFilter } : {}) },
      include: { subcontractor: true, certificates: { orderBy: { createdAt: "asc" } }, tender: { select: { id: true, name: true, managerId: true } } },
      orderBy: [{ status: "asc" }, { startDate: "desc" }],
    }),
    can.viewAll(user.role) ? db.subcontractor.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { subcontracts: true } } } }) : Promise.resolve([]),
    db.tender.findMany({ where: { ...tenderScope(user), status: { in: ["WON", "EXECUTION", "MAINTENANCE"] } }, select: { id: true, name: true } }),
  ]);
  const [atts, certAtts] = await Promise.all([
    attachmentsMap("subcontract", agreements.map((a) => a.id)),
    attachmentsMap("certificate", agreements.flatMap((a) => a.certificates.map((c) => c.id))),
  ]);
  const totals = agreements.map((a) => ({ a, t: subcontractTotals(a) }));
  const active = totals.filter((x) => x.a.status === "ACTIVE");
  const awaitingPay = agreements.flatMap((a) => a.certificates).filter((c) => c.status === "APPROVED");

  return (
    <>
      <PageHeader
        title="مقاولو الباطن والمصنعيات"
        subtitle="الاتفاقيات والمستخلصات واسترداد الدفعات المقدمة والمحجوزات — مع منع تجاوز قيمة الاتفاقية"
        actions={
          admin && (
            <>
              <ModalForm title="مقاول باطن جديد" trigger={<><Plus className="h-4 w-4" /> مقاول جديد</>} triggerClass="btn-secondary" action={saveSubcontractor.bind(null, null)}>
                <SubFields />
              </ModalForm>
              <SubcontractForm tenders={tenders} />
            </>
          )
        }
      />
      <div className="stagger mb-5 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard label="اتفاقيات سارية" value={active.length} icon={HardHat} />
        <StatCard label="قيمة الاتفاقيات السارية" value={<Money value={active.reduce((s, x) => s + x.a.value, 0)} />} />
        <StatCard label="المتبقي للتنفيذ" value={<Money value={active.reduce((s, x) => s + x.t.remaining, 0)} />} tone="purple" />
        <StatCard label="مستخلصات بانتظار الدفع" value={<Money value={awaitingPay.reduce((s, c) => s + c.net, 0)} />} sub={`${awaitingPay.length} مستخلصات`} tone={awaitingPay.length ? "orange" : "gray"} />
      </div>

      {tenderFilter && (
        <p className="mb-3 text-sm">
          مفلتر على مشروع واحد — <Link href="/subcontractors" className="font-semibold text-accent">عرض الكل</Link>
        </p>
      )}

      <div className="mb-8 space-y-4">
        {agreements.length === 0 ? (
          <Card>
            <EmptyState icon={HardHat} title="لا توجد اتفاقيات" hint={admin ? "أضف مقاولاً ثم أنشئ اتفاقية على مشروع محال" : undefined} />
          </Card>
        ) : (
          agreements.map((sc) => <SubcontractCard key={sc.id} sc={sc} user={user} atts={atts} certAtts={certAtts} />)
        )}
      </div>

      {subs.length > 0 && (
        <Card title="دليل مقاولي الباطن" pad={false} className="pt-5 [&>div:first-child]:px-6">
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>المقاول</th>
                  <th>الاختصاص</th>
                  <th>الهاتف</th>
                  <th>الاتفاقيات</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {subs.map((s) => (
                  <tr key={s.id} className={clsx(!s.active && "opacity-50")}>
                    <td className="font-semibold">{s.name}{s.notes && <span className="block text-xs font-normal text-ink-muted">{s.notes}</span>}</td>
                    <td>{s.trade}</td>
                    <td className="num">{s.phone ?? "—"}</td>
                    <td className="num">{s._count.subcontracts}</td>
                    <td>
                      {admin && (
                        <ModalForm title="تعديل المقاول" trigger={<Pencil className="h-4 w-4" />} triggerClass="btn-ghost btn-sm" action={saveSubcontractor.bind(null, s.id)}>
                          <SubFields s={s} />
                        </ModalForm>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}

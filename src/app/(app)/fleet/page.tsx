import Link from "next/link";
import { Fuel, Pencil, Plus, Truck, Wrench } from "lucide-react";
import type { Equipment } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { can, expenseScope, tenderScope } from "@/lib/permissions";
import { fmtDate } from "@/lib/format";
import { FleetExpenseForm } from "@/components/field";
import { EQUIPMENT_STATUS, EQUIPMENT_TYPES, OWNERSHIP } from "@/lib/labels";
import { Badge, Card, EmptyState, Money, PageHeader, StatCard, StatusBadge } from "@/components/ui";
import { Grid, Input, ModalForm, Select, Textarea } from "@/components/forms";
import { EquipmentLogTable } from "@/components/modules";
import { saveEquipment } from "../actions/modules";

export const metadata = { title: "الآليات والمعدات" };

function EquipFields({ e }: { e?: Equipment }) {
  return (
    <>
      <Grid>
        <Input name="name" label="اسم المعدة" required defaultValue={e?.name} placeholder="حفارة كاتربيلر 320 / طوبار خشب 200 لوح" />
        <Input name="type" label="النوع" required list="eq-types" defaultValue={e?.type} />
      </Grid>
      <datalist id="eq-types">{EQUIPMENT_TYPES.map((t) => <option key={t} value={t} />)}</datalist>
      <Grid cols={3}>
        <Select name="ownership" label="الملكية" options={OWNERSHIP} defaultValue={e?.ownership ?? "OWNED"} />
        <Input name="dailyRate" label="الكلفة اليومية (د.أ)" type="number" required defaultValue={e?.dailyRate} hint="للمملوكة: كلفة التحميل الداخلي" />
        <Select name="status" label="الحالة" options={Object.fromEntries(Object.entries(EQUIPMENT_STATUS).map(([k, v]) => [k, v.label]))} defaultValue={e?.status ?? "AVAILABLE"} />
      </Grid>
      <Grid>
        <Input name="identifier" label="رقم اللوحة / التسلسلي" defaultValue={e?.identifier ?? ""} />
        <Input name="vendor" label="المؤجر (للمستأجرة)" defaultValue={e?.vendor ?? ""} />
      </Grid>
      <Textarea name="notes" label="ملاحظات" defaultValue={e?.notes ?? ""} />
    </>
  );
}

export default async function FleetPage() {
  const user = await requireUser();
  const admin = can.manageFleet(user.role);
  const [equipment, logs, fleetExp, tenders] = await Promise.all([
    db.equipment.findMany({ orderBy: [{ status: "asc" }, { name: "asc" }], include: { logs: { select: { days: true, cost: true } }, expenses: { select: { category: true, amount: true, fuelLiters: true } } } }),
    db.equipmentLog.findMany({ where: { tender: tenderScope(user) }, include: { equipment: true, tender: { select: { id: true, name: true } } }, orderBy: { startDate: "desc" }, take: 150 }),
    db.expense.findMany({ where: { equipmentId: { not: null }, ...expenseScope(user) }, include: { equipment: { select: { name: true } }, tender: { select: { id: true, name: true } }, createdBy: { select: { name: true } } }, orderBy: [{ date: "desc" }, { id: "desc" }], take: 100 }),
    db.tender.findMany({ where: { ...tenderScope(user), status: { in: ["WON", "EXECUTION", "MAINTENANCE"] } }, select: { id: true, name: true } }),
  ]);
  const fuelLiters = fleetExp.reduce((s, e) => s + (e.fuelLiters ?? 0), 0);
  const fuelCost = fleetExp.filter((e) => e.category === "FUEL").reduce((s, e) => s + e.amount, 0);
  const maintCost = fleetExp.filter((e) => e.category === "MAINTENANCE").reduce((s, e) => s + e.amount, 0);
  const totalCost = logs.reduce((s, l) => s + l.cost, 0);

  return (
    <>
      <PageHeader
        title="الآليات والمعدات والعدد"
        subtitle="معدات الشركة والمستأجرة — يُسجل التشغيل من تبويب «الآليات» في صفحة المشروع وتُحمّل الكلفة عليه تلقائياً"
        actions={
          <>
            {equipment.length > 0 && tenders.length > 0 && <FleetExpenseForm equipment={equipment} tenders={tenders} user={user} />}
            {admin && (
              <ModalForm title="معدة جديدة" trigger={<><Plus className="h-4 w-4" /> معدة جديدة</>} action={saveEquipment.bind(null, null)}>
                <EquipFields />
              </ModalForm>
            )}
          </>
        }
      />
      <div className="stagger mb-5 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard label="المعدات المسجلة" value={equipment.length} icon={Truck} />
        <StatCard label="في المواقع" value={equipment.filter((e) => e.status === "ASSIGNED").length} tone="blue" />
        <StatCard label="في الصيانة" value={equipment.filter((e) => e.status === "MAINTENANCE").length} tone="orange" />
        <StatCard label="الكلفة المحملة على المشاريع" value={<Money value={totalCost} />} tone="purple" />
      </div>
      <div className="stagger mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="ديزل مستهلك" value={`${new Intl.NumberFormat("en-US").format(Math.round(fuelLiters))} لتر`} icon={Fuel} tone="orange" sub={fuelLiters ? `متوسط ${(fuelCost / fuelLiters).toFixed(3)} د.أ/لتر` : undefined} />
        <StatCard label="كلفة الديزل" value={<Money value={fuelCost} />} tone="orange" />
        <StatCard label="كلفة الصيانة" value={<Money value={maintCost} />} icon={Wrench} tone="red" />
      </div>

      <Card pad={false} className="mb-5" title={<span className="px-5 pt-5 sm:px-6">سجل المعدات</span>}>
        {equipment.length === 0 ? (
          <EmptyState icon={Truck} title="لا توجد معدات" hint={admin ? "أضف الحفارات والشاحنات والطوبار والجكات..." : undefined} />
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>المعدة</th>
                  <th>الملكية</th>
                  <th className="text-end">الكلفة اليومية</th>
                  <th className="text-end">أيام التشغيل</th>
                  <th className="text-end">الكلفة المحملة</th>
                  <th className="text-end">ديزل (لتر)</th>
                  <th className="text-end">صيانة</th>
                  <th>الحالة</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {equipment.map((e) => (
                  <tr key={e.id}>
                    <td>
                      <span className="block font-semibold">{e.name}</span>
                      <span className="text-xs text-ink-muted">{e.type}{e.identifier ? ` — ${e.identifier}` : ""}</span>
                    </td>
                    <td><Badge tone={e.ownership === "OWNED" ? "gray" : "purple"}>{OWNERSHIP[e.ownership]}</Badge>{e.vendor && <span className="block text-xs text-ink-muted">{e.vendor}</span>}</td>
                    <td className="text-end"><Money value={e.dailyRate} /></td>
                    <td className="num text-end">{e.logs.reduce((s, l) => s + l.days, 0)}</td>
                    <td className="text-end"><Money value={e.logs.reduce((s, l) => s + l.cost, 0)} strong /></td>
                    <td className="num text-end">{new Intl.NumberFormat("en-US").format(e.expenses.reduce((s, x) => s + (x.fuelLiters ?? 0), 0))}</td>
                    <td className="text-end"><Money value={e.expenses.filter((x) => x.category === "MAINTENANCE").reduce((s, x) => s + x.amount, 0)} /></td>
                    <td><StatusBadge map={EQUIPMENT_STATUS} value={e.status} /></td>
                    <td>
                      {admin && (
                        <ModalForm title="تعديل المعدة" trigger={<Pencil className="h-4 w-4" />} triggerClass="btn-ghost btn-sm" action={saveEquipment.bind(null, e.id)}>
                          <EquipFields e={e} />
                        </ModalForm>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card pad={false} className="mb-5" title={<span className="px-5 pt-5 sm:px-6">سجل الديزل والصيانة</span>}>
        {fleetExp.length === 0 ? (
          <EmptyState icon={Fuel} title="لا توجد تعبئة ديزل أو صيانة مسجلة" />
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>التاريخ</th>
                  <th>المعدة</th>
                  <th>البيان</th>
                  <th>المشروع</th>
                  <th className="text-end">لتر</th>
                  <th className="text-end">المبلغ</th>
                </tr>
              </thead>
              <tbody>
                {fleetExp.map((x) => (
                  <tr key={x.id}>
                    <td className="num whitespace-nowrap">{fmtDate(x.date)}</td>
                    <td className="font-semibold">{x.equipment?.name}</td>
                    <td className="max-w-[300px] text-ink-soft">{x.description}<span className="block text-xs text-ink-muted">{x.createdBy.name}</span></td>
                    <td>{x.tender && <Link href={`/tenders/${x.tender.id}?tab=equipment`} className="hover:text-accent">{x.tender.name}</Link>}</td>
                    <td className="num text-end">{x.fuelLiters ?? "—"}</td>
                    <td className="text-end"><Money value={x.amount} strong /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card pad={false} title={<span className="px-5 pt-5 sm:px-6">آخر سجلات التشغيل</span>}>
        <EquipmentLogTable rows={logs} user={user} showTender />
      </Card>
    </>
  );
}

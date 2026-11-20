import Link from "next/link";
import clsx from "clsx";
import { Banknote, CalendarCheck, HandCoins, HardHat, Pencil, Plus, Power, Trash2, Users } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { Badge, Card, EmptyState, Money, PageHeader, StatCard, StatusBadge, Tabs } from "@/components/ui";
import { ActionForm, ConfirmButton, Grid, Input, ModalForm, Select, Textarea } from "@/components/forms";
import { ADJ_TYPE, EMP_CATEGORY, PAY_METHOD_PR, PAY_TYPE, RUN_STATUS, periodLabel, periodOf, periodRange } from "@/lib/payroll";
import { fmtDate, todayUTC } from "@/lib/format";
import { addAdjustment, buildRun, deleteAdjustment, deleteWorkDay, recordDays, saveEmployee, toggleEmployee } from "../actions/payroll";

export const metadata = { title: "الرواتب والأجور" };
export const dynamic = "force-dynamic";

type Emp = Awaited<ReturnType<typeof db.employee.findMany>>[number];

function EmployeeFields({ e, tenders, users }: { e?: Emp; tenders: { value: number; label: string }[]; users: { value: number; label: string }[] }) {
  return (
    <>
      <Grid>
        <Input name="name" label="الاسم الكامل" required defaultValue={e?.name} />
        <Input name="jobTitle" label="المسمى" defaultValue={e?.jobTitle ?? ""} placeholder="مثال: حداد مسلح، مهندس موقع" />
      </Grid>
      <Grid cols={3}>
        <Select name="payType" label="نوع الأجر" options={PAY_TYPE} defaultValue={e?.payType ?? "DAILY"} />
        <Select name="category" label="الفئة" options={EMP_CATEGORY} defaultValue={e?.category ?? "WORKER"} />
        <Select name="payMethod" label="طريقة الصرف" options={PAY_METHOD_PR} defaultValue={e?.payMethod ?? "CASH"} />
      </Grid>
      <Grid cols={3}>
        <Input name="dailyRate" label="الأجر اليومي (د.أ) — للمياومة" inputMode="decimal" defaultValue={e?.dailyRate ?? ""} />
        <Input name="monthlySalary" label="الراتب الشهري (د.أ) — للشهري" inputMode="decimal" defaultValue={e?.monthlySalary ?? ""} />
        <Input name="allowances" label="بدلات شهرية (د.أ)" inputMode="decimal" defaultValue={e?.allowances ?? ""} />
      </Grid>
      <Grid cols={3}>
        <Input name="nationalId" label="الرقم الوطني / الإقامة" defaultValue={e?.nationalId ?? ""} />
        <Input name="phone" label="الهاتف" inputMode="tel" defaultValue={e?.phone ?? ""} />
        <Input name="iban" label="IBAN / اسم كليك" dir="ltr" defaultValue={e?.iban ?? ""} />
      </Grid>
      <Grid cols={3}>
        <Select name="tenderId" label="المشروع الافتراضي" options={tenders} placeholder="— إدارة عامة —" defaultValue={e?.tenderId ?? ""} />
        <Input name="startDate" label="تاريخ المباشرة" type="date" defaultValue={e?.startDate?.toISOString().slice(0, 10) ?? ""} />
        <Select name="userId" label="حساب النظام (إن وجد)" options={users} placeholder="— لا يوجد —" defaultValue={e?.userId ?? ""} />
      </Grid>
      <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" name="socialSecurity" defaultChecked={e?.socialSecurity ?? false} /> مشمول بالضمان الاجتماعي (7.5% من الموظف + 14.25% على الشركة)</label>
      <Textarea name="notes" label="ملاحظات" defaultValue={e?.notes ?? ""} rows={2} />
    </>
  );
}

export default async function PayrollPage({ searchParams }: { searchParams: { tab?: string; m?: string } }) {
  const user = await requireUser();
  const manage = can.managePayroll(user.role);
  const viewAll = manage || user.role === "CHAIRMAN" || user.role === "AUDITOR";
  const tabs = viewAll
    ? [{ key: "staff", label: "الموظفون والعمال" }, { key: "days", label: "يوميات الحضور" }, { key: "adjust", label: "السلف والخصومات" }, { key: "runs", label: "مسيرات الرواتب" }]
    : [{ key: "days", label: "يوميات الحضور" }];
  const tab = tabs.some((x) => x.key === searchParams.tab) ? searchParams.tab! : tabs[0].key;
  const month = /^\d{4}-\d{2}$/.test(searchParams.m ?? "") ? searchParams.m! : periodOf(todayUTC());
  const { from, to } = periodRange(month);

  const pmTenders = user.role === "PM" ? { managerId: user.id } : {};
  const [emps, tendersRaw, usersRaw, monthDays, adjs, runs] = await Promise.all([
    db.employee.findMany({ where: user.role === "PM" ? { payType: "DAILY", active: true } : {}, orderBy: [{ active: "desc" }, { payType: "asc" }, { name: "asc" }] }),
    db.tender.findMany({ where: { status: { in: ["WON", "EXECUTION", "MAINTENANCE", "PRICING", "SUBMITTED"] }, ...pmTenders }, select: { id: true, name: true, number: true }, orderBy: { id: "desc" } }),
    manage ? db.user.findMany({ where: { active: true }, select: { id: true, name: true } }) : Promise.resolve([]),
    db.workDay.findMany({ where: { date: { gte: from, lt: to }, ...(user.role === "PM" ? { OR: [{ tenderId: { in: (await db.tender.findMany({ where: { managerId: user.id }, select: { id: true } })).map((x) => x.id) } }, { recordedById: user.id }] } : {}) }, include: { employee: { select: { name: true, dailyRate: true } } }, orderBy: [{ date: "desc" }] }),
    viewAll ? db.payAdjustment.findMany({ where: { period: month }, include: { employee: { select: { name: true } } }, orderBy: { id: "desc" } }) : Promise.resolve([]),
    viewAll ? db.payrollRun.findMany({ orderBy: { period: "desc" }, take: 24, include: { _count: { select: { lines: true } } } }) : Promise.resolve([]),
  ]);
  const tenders = tendersRaw.map((x) => ({ value: x.id, label: `${x.number} — ${x.name}` }));
  const tenderName = new Map(tendersRaw.map((x) => [x.id, x.name]));
  const users = usersRaw.map((u) => ({ value: u.id, label: u.name }));
  const active = emps.filter((e) => e.active);
  const daily = active.filter((e) => e.payType === "DAILY");
  const monthly = active.filter((e) => e.payType === "MONTHLY");
  const monthlyBill = monthly.reduce((s, e) => s + (e.monthlySalary ?? 0) + e.allowances, 0);
  const dayCost = monthDays.reduce((s, w) => s + w.days * (w.employee.dailyRate ?? 0), 0);
  const empOptions = active.map((e) => ({ value: e.id, label: `${e.name} — ${PAY_TYPE[e.payType]}` }));
  const monthNav = (delta: number) => { const d = new Date(from); d.setUTCMonth(d.getUTCMonth() + delta); return `/payroll?tab=${tab}&m=${periodOf(d)}`; };

  return (
    <>
      <PageHeader
        title="الرواتب والأجور"
        subtitle="عمال المياومة، الموظفون الشهريون، المهندسون والمدراء والمحاسبون — الحضور والسلف والمسيرات والصرف في مكان واحد"
        actions={
          manage && (
            <ModalForm title="إضافة موظف / عامل" trigger={<><Plus className="h-4 w-4" /> موظف / عامل</>} action={saveEmployee.bind(null, null)} wide>
              <EmployeeFields tenders={tenders} users={users} />
            </ModalForm>
          )
        }
      />

      {viewAll && (
        <div className="stagger mb-5 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
          <StatCard label="عمال المياومة" value={daily.length} sub="على رأس العمل" icon={HardHat} tone="orange" />
          <StatCard label="الموظفون الشهريون" value={monthly.length} sub={<>كلفة شهرية <Money value={monthlyBill} /></>} icon={Users} />
          <StatCard label={`يوميات ${periodLabel(month)}`} value={monthDays.reduce((s, w) => s + w.days, 0)} sub={<>كلفة تقديرية <Money value={dayCost} /></>} icon={CalendarCheck} tone="green" />
          <StatCard label="سلف وخصومات الشهر" value={<Money value={adjs.filter((a) => a.type !== "BONUS").reduce((s, a) => s + a.amount, 0)} />} sub={`${adjs.length} حركة`} icon={HandCoins} tone="purple" />
        </div>
      )}

      <Tabs base="/payroll" active={tab} tabs={tabs} />

      {(tab === "days" || tab === "adjust") && (
        <div className="mb-4 flex items-center justify-between gap-2">
          <Link href={monthNav(-1)} className="btn-secondary btn-sm">‹ الشهر السابق</Link>
          <p className="text-[15px] font-black text-navy">{periodLabel(month)}</p>
          <Link href={monthNav(1)} className="btn-secondary btn-sm">الشهر التالي ›</Link>
        </div>
      )}

      {tab === "staff" && (
        emps.length === 0 ? <EmptyState icon={Users} title="لا يوجد موظفون بعد" hint="أضف العمال والموظفين والمهندسين والمحاسبين — كل من يتقاضى أجراً من الشركة." /> : (
          <Card pad={false}>
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead><tr><th>الاسم</th><th>الفئة</th><th>نوع الأجر</th><th className="text-end">الأجر</th><th>المشروع</th><th>الصرف</th><th>الضمان</th>{manage && <th />}</tr></thead>
                <tbody>
                  {emps.map((e) => (
                    <tr key={e.id} className={clsx(!e.active && "opacity-50")}>
                      <td><span className="block font-bold">{e.name}</span><span className="text-xs text-ink-muted">{e.jobTitle ?? ""}{e.phone ? ` · ${e.phone}` : ""}</span></td>
                      <td>{EMP_CATEGORY[e.category] ?? e.category}</td>
                      <td><Badge tone={e.payType === "DAILY" ? "orange" : "blue"}>{PAY_TYPE[e.payType]}</Badge></td>
                      <td className="text-end">{e.payType === "DAILY" ? <><Money value={e.dailyRate ?? 0} /> <span className="text-xs text-ink-muted">/يوم</span></> : <><Money value={e.monthlySalary ?? 0} />{e.allowances ? <span className="block text-xs text-ink-muted">+ بدلات {e.allowances}</span> : null}</>}</td>
                      <td className="text-ink-soft">{e.tenderId ? tenderName.get(e.tenderId) ?? `#${e.tenderId}` : "إدارة عامة"}</td>
                      <td>{PAY_METHOD_PR[e.payMethod]}</td>
                      <td>{e.socialSecurity ? <Badge tone="green">مشمول</Badge> : "—"}</td>
                      {manage && (
                        <td className="whitespace-nowrap text-end">
                          <ModalForm title={`تعديل — ${e.name}`} trigger={<Pencil className="h-4 w-4" />} triggerClass="btn-ghost btn-sm" action={saveEmployee.bind(null, e.id)} wide>
                            <EmployeeFields e={e} tenders={tenders} users={users} />
                          </ModalForm>
                          <ConfirmButton action={toggleEmployee.bind(null, e.id)} confirm={e.active ? `إنهاء خدمة ${e.name}؟ (يبقى في السجلات)` : `إعادة ${e.name} للعمل؟`} title={e.active ? "إنهاء الخدمة" : "إعادة"} className="btn-ghost btn-sm"><Power className="h-4 w-4" /></ConfirmButton>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )
      )}

      {tab === "days" && (
        <div className="grid gap-5 lg:grid-cols-[380px_1fr]">
          <Card title="تسجيل يومية">
            {daily.length === 0 ? <p className="text-sm text-ink-muted">لا يوجد عمال مياومة فعّالون — أضفهم من «الموظفون والعمال».</p> : (
              <ActionForm action={recordDays} submitLabel="سجّل اليومية" draft={false}>
                <Grid>
                  <Input name="date" label="التاريخ" type="date" required defaultValue={todayUTC().toISOString().slice(0, 10)} />
                  <Select name="days" label="الحضور" options={[{ value: "1", label: "يوم كامل" }, { value: "0.5", label: "نصف يوم" }, { value: "1.5", label: "يوم ونصف" }]} defaultValue="1" />
                </Grid>
                <Grid>
                  <Select name="tenderId" label="المشروع" options={tenders} placeholder={user.role === "PM" ? "— اختر —" : "— إدارة عامة —"} required={user.role === "PM"} />
                  <Input name="overtimeHours" label="ساعات إضافية" inputMode="decimal" placeholder="0" />
                </Grid>
                <div>
                  <p className="label">العمال الحاضرون</p>
                  <div className="grid max-h-64 gap-1.5 overflow-y-auto rounded-2xl bg-white/40 p-2">
                    {daily.map((w) => (
                      <label key={w.id} className="flex items-center gap-2 rounded-xl px-2 py-1.5 text-sm font-semibold hover:bg-white/60">
                        <input type="checkbox" name="employeeIds" value={w.id} /> {w.name} <span className="ms-auto text-xs text-ink-muted">{w.dailyRate} د.أ</span>
                      </label>
                    ))}
                  </div>
                </div>
                <Input name="note" label="ملاحظة" />
              </ActionForm>
            )}
          </Card>
          <Card pad={false} title={<span className="px-5 pt-5 sm:px-6">يوميات {periodLabel(month)} ({monthDays.length})</span>}>
            {monthDays.length === 0 ? <p className="px-6 py-10 text-center text-sm text-ink-muted">لا يوميات مسجلة لهذا الشهر</p> : (
              <div className="overflow-x-auto">
                <table className="tbl">
                  <thead><tr><th>التاريخ</th><th>العامل</th><th>الحضور</th><th>إضافي</th><th>المشروع</th><th className="text-end">الأجر</th><th /></tr></thead>
                  <tbody>
                    {monthDays.map((w) => (
                      <tr key={w.id}>
                        <td className="num">{fmtDate(w.date)}</td>
                        <td className="font-semibold">{w.employee.name}</td>
                        <td>{w.days === 1 ? "يوم" : w.days === 0.5 ? "نصف يوم" : `${w.days} يوم`}</td>
                        <td className="num">{w.overtimeHours ? `${w.overtimeHours} س` : "—"}</td>
                        <td className="text-ink-soft">{w.tenderId ? tenderName.get(w.tenderId) ?? "—" : "إدارة عامة"}</td>
                        <td className="text-end"><Money value={w.days * (w.employee.dailyRate ?? 0)} /></td>
                        <td><ConfirmButton action={deleteWorkDay.bind(null, w.id)} confirm="حذف هذه اليومية؟" className="btn-danger btn-sm" title="حذف"><Trash2 className="h-4 w-4" /></ConfirmButton></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}

      {tab === "adjust" && (
        <div className="grid gap-5 lg:grid-cols-[380px_1fr]">
          {manage && (
            <Card title="سلفة / خصم / مكافأة">
              <ActionForm action={addAdjustment} submitLabel="تسجيل" resetOnSuccess draft={false}>
                <Select name="employeeId" label="الموظف / العامل" options={empOptions} placeholder="— اختر —" required />
                <Grid>
                  <Select name="type" label="النوع" options={Object.fromEntries(Object.entries(ADJ_TYPE).map(([k, v]) => [k, v.label]))} defaultValue="ADVANCE" />
                  <Input name="amount" label="المبلغ (د.أ)" inputMode="decimal" required />
                </Grid>
                <Input name="period" label="يُحتسب في مسير شهر" type="month" required defaultValue={month} />
                <Input name="note" label="البيان" placeholder="مثال: سلفة نقدية لظرف عائلي" />
              </ActionForm>
            </Card>
          )}
          <Card pad={false} title={<span className="px-5 pt-5 sm:px-6">حركات {periodLabel(month)}</span>}>
            {adjs.length === 0 ? <p className="px-6 py-10 text-center text-sm text-ink-muted">لا سلف ولا خصومات لهذا الشهر</p> : (
              <div className="overflow-x-auto">
                <table className="tbl">
                  <thead><tr><th>الموظف</th><th>النوع</th><th className="text-end">المبلغ</th><th>البيان</th>{manage && <th />}</tr></thead>
                  <tbody>
                    {adjs.map((a) => (
                      <tr key={a.id}>
                        <td className="font-semibold">{a.employee.name}</td>
                        <td><Badge tone={a.type === "BONUS" ? "green" : a.type === "ADVANCE" ? "orange" : "red"}>{ADJ_TYPE[a.type]?.label}</Badge></td>
                        <td className="text-end"><Money value={a.amount} /></td>
                        <td className="text-ink-soft">{a.note ?? "—"}</td>
                        {manage && <td><ConfirmButton action={deleteAdjustment.bind(null, a.id)} confirm="حذف الحركة؟" className="btn-danger btn-sm" title="حذف"><Trash2 className="h-4 w-4" /></ConfirmButton></td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}

      {tab === "runs" && (
        <div className="space-y-5">
          {manage && (
            <Card title={<span className="flex items-center gap-2"><Banknote className="h-5 w-5 text-good" /> إعداد مسير شهري</span>}>
              <ActionForm action={buildRun} submitLabel="احسب المسير" draft={false}>
                <p className="text-sm leading-7 text-ink-soft">يحسب النظام لكل موظف: الأساسي أو أيام الحضور × الأجر اليومي، الساعات الإضافية (125%)، البدلات، المكافآت، السلف والخصومات، والضمان الاجتماعي — ثم ترفعه لمجلس الإدارة للاعتماد، وبعدها تصرفه.</p>
                <Input name="period" label="الشهر" type="month" required defaultValue={periodOf(todayUTC())} />
              </ActionForm>
            </Card>
          )}
          {runs.length === 0 ? <EmptyState icon={Banknote} title="لا مسيرات بعد" /> : (
            <ul className="stagger grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {runs.map((r) => (
                <li key={r.id}>
                  <Link href={`/payroll/runs/${r.id}`} className="card card-pad pressable hover-lift block">
                    <div className="flex items-center justify-between gap-2"><p className="text-[17px] font-black text-navy">{periodLabel(r.period)}</p><StatusBadge map={RUN_STATUS} value={r.status} /></div>
                    <p className="mt-2 text-sm text-ink-muted">{r._count.lines} موظفاً · الإجمالي <Money value={r.gross} /></p>
                    <p className="mt-1 text-lg font-black">الصافي <Money value={r.net} strong /></p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  );
}

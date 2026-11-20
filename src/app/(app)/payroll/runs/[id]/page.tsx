import Link from "next/link";
import { notFound } from "next/navigation";
import { Gavel, Printer, RefreshCw, Send, Trash2, Wallet } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { Card, Money, PageHeader, StatCard, StatusBadge } from "@/components/ui";
import { ActionForm, ConfirmButton, Input, ModalForm } from "@/components/forms";
import { PrintButton } from "@/components/print-button";
import { EMP_CATEGORY, PAY_METHOD_PR, PAY_TYPE, RUN_STATUS, periodLabel, totals } from "@/lib/payroll";
import { buildRun, deleteRun, payRun, submitRun } from "../../../actions/payroll";

export const dynamic = "force-dynamic";

export default async function RunPage({ params }: { params: { id: string } }) {
  const user = await requireUser((r) => r !== "PM");
  const id = Number(params.id);
  const run = await db.payrollRun.findUnique({ where: { id }, include: { lines: { include: { employee: { select: { name: true, category: true, jobTitle: true } } }, orderBy: [{ payType: "asc" }, { id: "asc" }] } } });
  if (!run) notFound();
  const manage = can.managePayroll(user.role);
  const tt = totals(run.lines);
  const motion = await db.boardMotion.findFirst({ where: { kind: "PAYROLL", refId: id }, orderBy: { id: "desc" }, select: { id: true, ref: true, status: true } });
  const tenders = new Map((await db.tender.findMany({ where: { id: { in: run.lines.map((l) => l.tenderId ?? 0) } }, select: { id: true, name: true } })).map((x) => [x.id, x.name]));
  const byProject = new Map<string, number>();
  run.lines.forEach((l) => { const k = l.tenderId ? tenders.get(l.tenderId) ?? `#${l.tenderId}` : "إدارة عامة"; byProject.set(k, (byProject.get(k) ?? 0) + l.base + l.allowances + l.overtime + l.bonus + l.ssEmployer); });

  return (
    <>
      <PageHeader
        back={{ href: "/payroll?tab=runs", label: "مسيرات الرواتب" }}
        title={`مسير رواتب ${periodLabel(run.period)}`}
        subtitle={<span className="flex flex-wrap items-center gap-2"><StatusBadge map={RUN_STATUS} value={run.status} /> {run.lines.length} موظفاً{run.note ? ` · ${run.note}` : ""}</span>}
        actions={
          <>
            <PrintButton />
            {motion && <Link href={`/board/${motion.id}`} className="btn-secondary"><Gavel className="h-4 w-4" /> بند المجلس {motion.ref}</Link>}
            {manage && run.status === "DRAFT" && (
              <>
                <ActionForm action={buildRun} submitLabel="أعد الاحتساب" draft={false}><input type="hidden" name="period" value={run.period} /></ActionForm>
                <ModalForm title="رفع المسير لمجلس الإدارة" trigger={<><Send className="h-4 w-4" /> ارفع للمجلس</>} action={submitRun.bind(null, id)} submitLabel="ارفع للتصويت">
                  <p className="text-sm leading-7">يُرفع المسير كبند «مسير رواتب» لمجلس الإدارة بصافي <b><Money value={tt.net} /></b>. بعد الاعتماد (بالتصويت أو قرار رئيس المجلس) تصرفه من هنا.</p>
                </ModalForm>
                <ConfirmButton action={deleteRun.bind(null, id)} confirm="حذف المسودة؟" redirectTo="/payroll?tab=runs" className="btn-danger" title="حذف"><Trash2 className="h-4 w-4" /></ConfirmButton>
              </>
            )}
            {manage && run.status === "APPROVED" && (
              <ModalForm title="صرف المسير" trigger={<><Wallet className="h-4 w-4" /> اصرف الرواتب</>} action={payRun.bind(null, id)} submitLabel="تأكيد الصرف">
                <p className="text-sm leading-7">التحويلات (بنك/كليك): <b><Money value={tt.bank} /></b> — تُقيَّد صادراً على الحساب البنكي. النقدي: <b><Money value={tt.cash} /></b>.</p>
                <Input name="date" label="تاريخ الصرف" type="date" defaultValue={new Date().toISOString().slice(0, 10)} />
                <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" name="ssFromBank" defaultChecked /> قيّد اشتراكات الضمان (حصة الموظف + الشركة) على الحساب البنكي أيضاً</label>
              </ModalForm>
            )}
          </>
        }
      />

      <div className="stagger mb-5 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard label="إجمالي الرواتب والأجور" value={<Money value={tt.gross} />} icon={Wallet} />
        <StatCard label="الصافي للموظفين" value={<Money value={tt.net} />} sub={<>نقداً <Money value={tt.cash} /> · تحويل <Money value={tt.bank} /></>} icon={Wallet} tone="green" />
        <StatCard label="حصة الشركة من الضمان" value={<Money value={tt.employerSS} />} icon={RefreshCw} tone="purple" />
        <StatCard label="الكلفة الكلية على الشركة" value={<Money value={tt.cost} />} icon={Printer} tone="orange" />
      </div>

      <Card pad={false} className="mb-5">
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr><th>الموظف</th><th>النوع</th><th className="text-end">أيام</th><th className="text-end">الأساسي</th><th className="text-end">بدلات</th><th className="text-end">إضافي</th><th className="text-end">مكافأة</th><th className="text-end">سلف</th><th className="text-end">خصومات</th><th className="text-end">ضمان</th><th className="text-end">الصافي</th><th>الصرف</th></tr>
            </thead>
            <tbody>
              {run.lines.map((l) => (
                <tr key={l.id}>
                  <td><span className="block font-bold">{l.employee.name}</span><span className="text-xs text-ink-muted">{l.employee.jobTitle ?? EMP_CATEGORY[l.employee.category]}</span></td>
                  <td>{PAY_TYPE[l.payType]}</td>
                  <td className="num text-end">{l.days}</td>
                  <td className="text-end"><Money value={l.base} /></td>
                  <td className="text-end"><Money value={l.allowances} /></td>
                  <td className="text-end"><Money value={l.overtime} /></td>
                  <td className="text-end"><Money value={l.bonus} /></td>
                  <td className="text-end text-warn"><Money value={l.advances} /></td>
                  <td className="text-end text-bad"><Money value={l.deductions} /></td>
                  <td className="text-end"><Money value={l.ssEmployee} /></td>
                  <td className="text-end font-black"><Money value={l.net} strong /></td>
                  <td>{PAY_METHOD_PR[l.payMethod]}{l.paid ? " ✓" : ""}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr><td colSpan={10} className="px-5 py-3 text-end font-black sm:px-6">الصافي الكلي</td><td className="px-3 py-3 text-end font-black"><Money value={tt.net} strong /></td><td /></tr>
            </tfoot>
          </table>
        </div>
      </Card>

      <Card title="توزيع كلفة العمالة على المشاريع">
        <ul className="space-y-2">
          {Array.from(byProject.entries()).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
            <li key={k} className="flex items-center justify-between gap-3 rounded-xl bg-white/40 px-3 py-2 text-sm"><span className="font-semibold">{k}</span><Money value={v} strong /></li>
          ))}
        </ul>
      </Card>
    </>
  );
}

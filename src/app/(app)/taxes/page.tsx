import Link from "next/link";
import { Percent, Plus, Trash2, Wallet } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { can, see } from "@/lib/permissions";
import { taxByTender, taxSummary } from "@/lib/tax";
import { getSettings } from "@/lib/settings";
import { fmtDate, toInputDate, todayUTC } from "@/lib/format";
import { Badge, Card, EmptyState, Money, PageHeader, StatCard } from "@/components/ui";
import { ConfirmButton, Grid, Input, ModalForm, Select, Textarea } from "@/components/forms";
import { addTaxLiability, deleteTaxEntry, recalcClaimTaxes, recordTaxPayment, updateTaxEntry } from "../actions/tax";
import { Pencil } from "lucide-react";

export const metadata = { title: "الضريبة" };

export default async function TaxesPage() {
  const me = await requireUser(see.finance);
  const isAdmin = me.role === "ADMIN";
  const [summary, byTender, entries, tenders, settings, unpaidClaims] = await Promise.all([
    taxSummary(),
    taxByTender(),
    db.taxEntry.findMany({ orderBy: [{ date: "desc" }, { id: "desc" }], take: 300 }),
    db.tender.findMany({ where: { awardedValue: { not: null } }, select: { id: true, name: true, number: true }, orderBy: { name: "asc" } }),
    getSettings(),
    // مطالبات مقبوضة لم تُسجل عليها ضريبة بعد
    db.claim.findMany({ where: { status: "PAID" }, select: { id: true, number: true, grossAmount: true, paidDate: true, tenderId: true, tender: { select: { name: true } } } }),
  ]);
  const taxedClaims = new Set(entries.filter((e) => e.claimId).map((e) => e.claimId));
  const untaxed = unpaidClaims.filter((c) => !taxedClaims.has(c.id));
  const names = new Map(tenders.map((t) => [t.id, t.name]));
  const users = new Map((await db.user.findMany({ select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const tenderOpts = tenders.map((t) => ({ value: t.id, label: `${t.name} (${t.number})` }));

  return (
    <>
      <PageHeader
        title="الضريبة والمديونية الضريبية"
        subtitle="ضريبة الدخل منفصلة تماماً عن المطالبات: تُسجل المديونية عند قبض المطالبات أو يدوياً، ويُسجل السداد لدائرة الضريبة (يُخصم من البنك). تذكير شهري بالبريد بالمديونية القائمة."
        actions={
          <>
            <ModalForm title="تسجيل مديونية ضريبية" trigger={<><Plus className="h-4 w-4" /> مديونية ضريبية</>} triggerClass="btn-secondary" action={addTaxLiability}>
              <Select name="tenderId" label="المشروع / العطاء" options={tenderOpts} placeholder="— عام —" />
              <Grid cols={3}>
                <Input name="base" label="الأساس الخاضع (د.أ)" type="number" hint="مثلاً قيمة المطالبة المقبوضة" />
                <Input name="rate" label="النسبة %" type="number" step="0.01" defaultValue={settings.withholdingTaxPct || ""} />
                <Input name="amount" label="أو المبلغ مباشرة" type="number" hint="يتقدم على الأساس × النسبة" />
              </Grid>
              <Grid>
                <Input name="date" label="التاريخ" type="date" required defaultValue={toInputDate(todayUTC())} />
                <Input name="reference" label="المرجع" />
              </Grid>
              <Input name="description" label="البيان" required placeholder="ضريبة دخل على مقبوضات مشروع ..." />
            </ModalForm>
            <ModalForm title="سداد لدائرة ضريبة الدخل والمبيعات" trigger={<><Wallet className="h-4 w-4" /> تسجيل سداد</>} action={recordTaxPayment}>
              <p className="rounded-xl bg-canvas p-3 text-sm">المديونية القائمة: <b><Money value={summary.outstanding} /></b> — يُخصم السداد من الحساب البنكي تلقائياً.</p>
              <Grid>
                <Input name="amount" label="المبلغ المسدد (د.أ)" type="number" required defaultValue={summary.outstanding > 0 ? summary.outstanding : ""} />
                <Input name="date" label="تاريخ السداد" type="date" required defaultValue={toInputDate(todayUTC())} />
              </Grid>
              <Grid>
                <Select name="tenderId" label="المشروع (اختياري)" options={tenderOpts} placeholder="— عام —" />
                <Input name="reference" label="رقم الإيصال / الحوالة" />
              </Grid>
              <Textarea name="description" label="البيان (اختياري)" />
            </ModalForm>
          </>
        }
      />

      <div className="stagger mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="مديونية الضريبة القائمة" value={<Money value={summary.outstanding} />} icon={Percent} tone={summary.outstanding > 0 ? "red" : "green"} sub={summary.outstanding > 0 ? "غير مسددة — تذكير شهري بالبريد" : "لا مديونية قائمة"} />
        <StatCard label="إجمالي الضريبة المستحقة" value={<Money value={summary.accrued} />} tone="orange" />
        <StatCard label="إجمالي المسدد" value={<Money value={summary.paid} />} tone="green" />
      </div>

      {untaxed.length > 0 && (
        <Card title="مطالبات مقبوضة لم تُسجل عليها ضريبة" className="mb-5">
          <ul className="divide-y divide-line">
            {untaxed.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                <span className="text-sm">
                  <Link href={`/claims/${c.id}`} className="font-semibold hover:text-accent">مطالبة رقم {c.number}</Link> — {c.tender.name} — قُبضت {fmtDate(c.paidDate)}
                </span>
                <ModalForm title={`ضريبة على المطالبة رقم ${c.number}`} trigger="تسجيل الضريبة" triggerClass="btn-ghost btn-sm" action={addTaxLiability}>
                  <input type="hidden" name="claimId" value={c.id} />
                  <input type="hidden" name="tenderId" value={c.tenderId} />
                  <Grid cols={3}>
                    <Input name="base" label="الأساس (قيمة المطالبة)" type="number" defaultValue={c.grossAmount} />
                    <Input name="rate" label="النسبة %" type="number" step="0.01" defaultValue={settings.withholdingTaxPct || ""} />
                    <Input name="amount" label="أو المبلغ مباشرة" type="number" />
                  </Grid>
                  <Input name="date" label="التاريخ" type="date" required defaultValue={toInputDate(c.paidDate ?? todayUTC())} />
                  <Input name="description" label="البيان" required defaultValue={`ضريبة دخل مستحقة على قبض المطالبة رقم ${c.number} — ${c.tender.name}`} />
                </ModalForm>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {byTender.size > 0 && (
        <Card title="المديونية حسب المشروع" pad={false} className="mb-5 pt-5 [&>div:first-child]:px-6">
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>المشروع</th>
                  <th className="text-end">المستحق</th>
                  <th className="text-end">المسدد</th>
                  <th className="text-end">القائم</th>
                </tr>
              </thead>
              <tbody>
                {Array.from(byTender.entries()).map(([tid, v]) => (
                  <tr key={tid ?? 0}>
                    <td className="font-semibold">{tid ? <Link href={`/tenders/${tid}`} className="hover:text-accent">{names.get(tid) ?? `#${tid}`}</Link> : "عام / غير مخصص"}</td>
                    <td className="text-end"><Money value={v.accrued} /></td>
                    <td className="text-end"><Money value={v.paid} /></td>
                    <td className="text-end"><Money value={v.outstanding} strong className={v.outstanding > 0 ? "text-bad" : ""} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {isAdmin && entries.some((e) => e.kind === "LIABILITY" && e.claimId && e.base != null && e.rate !== settings.withholdingTaxPct) && (
        <p className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-warn-soft px-4 py-3 text-sm font-semibold text-warn">
          بعض مديونيات المطالبات محسوبة بنسبة غير النسبة الحالية في الإعدادات ({settings.withholdingTaxPct}%).
          <ConfirmButton action={recalcClaimTaxes} confirm={`إعادة احتساب مديونية كل المطالبات المقبوضة بنسبة ${settings.withholdingTaxPct}%؟`} className="btn-primary btn-sm">إعادة الاحتساب بـ {settings.withholdingTaxPct}%</ConfirmButton>
        </p>
      )}
      <Card title="سجل الضريبة" pad={false} className="pt-5 [&>div:first-child]:px-6">
        {entries.length === 0 ? (
          <EmptyState icon={Percent} title="لا توجد قيود ضريبية" hint="تُسجل تلقائياً عند قبض المطالبات (حسب النسبة في الإعدادات) أو يدوياً" />
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>التاريخ</th>
                  <th>النوع</th>
                  <th>البيان</th>
                  <th>المشروع</th>
                  <th className="text-end">المبلغ</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id}>
                    <td className="num whitespace-nowrap">{fmtDate(e.date)}</td>
                    <td>{e.kind === "LIABILITY" ? <Badge tone="orange">مستحقة</Badge> : <Badge tone="green">سداد</Badge>}</td>
                    <td className="max-w-[380px]">
                      {e.description}
                      <span className="block text-xs text-ink-muted">
                        {[e.base != null && e.rate != null ? `${e.rate}% من ${e.base}` : null, e.reference && `مرجع ${e.reference}`, users.get(e.createdById)].filter(Boolean).join(" — ")}
                      </span>
                    </td>
                    <td className="text-ink-soft">{e.tenderId ? names.get(e.tenderId) ?? `#${e.tenderId}` : "عام"}</td>
                    <td className="text-end"><Money value={e.kind === "PAYMENT" ? -e.amount : e.amount} strong /></td>
                    <td className="flex items-center gap-1">
                      {isAdmin && e.kind === "LIABILITY" && (
                        <ModalForm title="تعديل مديونية ضريبية" trigger={<><Pencil className="h-4 w-4" aria-hidden /><span className="sr-only">تعديل المديونية</span></>} triggerClass="btn-ghost btn-sm" action={updateTaxEntry.bind(null, e.id)}>
                          <Grid cols={3}>
                            <Input name="base" label="الأساس" type="number" step="0.001" defaultValue={e.base ?? ""} />
                            <Input name="rate" label="النسبة %" type="number" step="0.01" defaultValue={e.rate ?? ""} />
                            <Input name="amount" label="أو المبلغ مباشرة" type="number" step="0.001" hint="يتقدم على الأساس × النسبة" />
                          </Grid>
                          <Input name="description" label="البيان" required defaultValue={e.description} />
                        </ModalForm>
                      )}
                      <ConfirmButton action={deleteTaxEntry.bind(null, e.id)} confirm={e.kind === "PAYMENT" ? "حذف السداد وعكس خصمه من البنك؟" : "حذف المديونية؟"} className="btn-danger btn-sm" title="حذف">
                        <Trash2 className="h-4 w-4" />
                      </ConfirmButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

import Link from "next/link";
import clsx from "clsx";
import { NotebookTabs, Plus, Trash2 } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { can, see } from "@/lib/permissions";
import { CHEQUE_STATUS } from "@/lib/labels";
import { addDays, daysUntil, fmtDate, relativeDays, toInputDate, todayUTC } from "@/lib/format";
import { attachmentsMap } from "@/lib/uploads";
import { AttachmentList, Badge, Card, EmptyState, Money, PageHeader, StatCard, StatusBadge } from "@/components/ui";
import { ConfirmButton, FileInput, Grid, Input, ModalForm, Select, Textarea } from "@/components/forms";
import { UploadButton } from "@/components/tables";
import { createCheque, deleteCheque, setChequeStatus } from "../actions/finance";

export const metadata = { title: "دفتر الشيكات" };

export default async function ChequesPage({ searchParams }: { searchParams: { status?: string } }) {
  await requireUser(see.finance);
  const status = searchParams.status && searchParams.status in CHEQUE_STATUS ? searchParams.status : undefined;
  const today = todayUTC();
  const [rows, tenders, agg, dueWeek] = await Promise.all([
    db.cheque.findMany({ where: status ? { status } : {}, include: { tender: { select: { id: true, name: true } } }, orderBy: [{ status: "asc" }, { dueDate: "asc" }], take: 500 }),
    db.tender.findMany({ where: { status: { notIn: ["LOST", "CANCELLED", "CLOSED"] } }, select: { id: true, name: true, number: true } }),
    db.cheque.groupBy({ by: ["status"], _sum: { amount: true }, _count: true }),
    db.cheque.aggregate({ where: { status: "DEFERRED", dueDate: { lte: addDays(today, 7) } }, _sum: { amount: true }, _count: true }),
  ]);
  const atts = await attachmentsMap("cheque", rows.map((r) => r.id));
  const s = (k: string) => agg.find((a) => a.status === k);

  return (
    <>
      <PageHeader
        title="دفتر الشيكات"
        subtitle="الشيكات الصادرة عن الشركة — تنبيه قبل 3 أيام من الاستحقاق وفي يومه"
        actions={
          <ModalForm title="شيك جديد" trigger={<><Plus className="h-4 w-4" /> شيك جديد</>} action={createCheque}>
            <Grid>
              <Input name="number" label="رقم الشيك" required />
              <Input name="bank" label="البنك" required defaultValue="البنك العربي" />
            </Grid>
            <Input name="payee" label="المستفيد" required placeholder="مصنع حديد العقبة / مورد الخرسانة" />
            <Grid>
              <Input name="amount" label="المبلغ (د.أ)" type="number" required />
              <Select name="tenderId" label="المشروع" options={tenders.map((t) => ({ value: t.id, label: `${t.name} (${t.number})` }))} placeholder="— عام —" />
            </Grid>
            <Grid>
              <Input name="issueDate" label="تاريخ التحرير" type="date" required defaultValue={toInputDate(today)} />
              <Input name="dueDate" label="تاريخ الاستحقاق" type="date" required />
            </Grid>
            <Textarea name="notes" label="ملاحظات" />
            <FileInput label="صورة الشيك" />
          </ModalForm>
        }
      />
      <div className="mb-5 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard label="شيكات مؤجلة" value={<Money value={s("DEFERRED")?._sum.amount ?? 0} />} sub={`${s("DEFERRED")?._count ?? 0} شيكات`} icon={NotebookTabs} tone="orange" />
        <StatCard label="تستحق خلال 7 أيام" value={<Money value={dueWeek._sum.amount ?? 0} />} sub={`${dueWeek._count} شيكات`} tone={dueWeek._count ? "red" : "gray"} />
        <StatCard label="مدفوعة / مصروفة" value={<Money value={s("CASHED")?._sum.amount ?? 0} />} sub={`${s("CASHED")?._count ?? 0} شيكات`} tone="green" />
        <StatCard label="مرتجعة" value={s("RETURNED")?._count ?? 0} tone={s("RETURNED")?._count ? "red" : "gray"} />
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        <Link href="/cheques" className={clsx("btn-sm", !status ? "btn-primary" : "btn-secondary")}>الكل</Link>
        {Object.entries(CHEQUE_STATUS).map(([k, v]) => (
          <Link key={k} href={`/cheques?status=${k}`} className={clsx("btn-sm", status === k ? "btn-primary" : "btn-secondary")}>
            {v.label}
          </Link>
        ))}
      </div>
      <Card pad={false}>
        {rows.length === 0 ? (
          <EmptyState icon={NotebookTabs} title="لا توجد شيكات" />
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>رقم الشيك</th>
                  <th>المستفيد</th>
                  <th>المشروع</th>
                  <th>الاستحقاق</th>
                  <th className="text-end">المبلغ</th>
                  <th>الحالة</th>
                  <th>إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const d = daysUntil(c.dueDate);
                  return (
                    <tr key={c.id}>
                      <td>
                        <span className="num block font-bold">{c.number}</span>
                        <span className="text-xs text-ink-muted">{c.bank}</span>
                        <AttachmentList items={atts.get(c.id)} />
                      </td>
                      <td className="max-w-[220px]">
                        {c.payee}
                        {c.notes && <span className="block text-xs text-ink-muted">{c.notes}</span>}
                      </td>
                      <td className="max-w-[200px] text-ink-soft">{c.tender ? <Link href={`/tenders/${c.tender.id}`} className="hover:text-accent">{c.tender.name}</Link> : "عام"}</td>
                      <td className="whitespace-nowrap">
                        <span className="num block">{fmtDate(c.dueDate)}</span>
                        {c.status === "DEFERRED" && <Badge tone={d < 0 ? "red" : d <= 3 ? "orange" : "gray"}>{d === 0 ? "يستحق اليوم" : relativeDays(c.dueDate)}</Badge>}
                      </td>
                      <td className="text-end">
                        <Money value={c.amount} strong />
                      </td>
                      <td>
                        <StatusBadge map={CHEQUE_STATUS} value={c.status} />
                        {c.cashedDate && <span className="block text-xs text-ink-muted">صُرف {fmtDate(c.cashedDate)}</span>}
                      </td>
                      <td className="whitespace-nowrap">
                        {c.status === "DEFERRED" && (
                          <>
                            <ConfirmButton action={setChequeStatus.bind(null, c.id, "CASHED")} confirm="تأكيد صرف الشيك؟ سيُخصم من الحساب البنكي." className="btn-ghost btn-sm">
                              تم الصرف
                            </ConfirmButton>
                            <ConfirmButton action={setChequeStatus.bind(null, c.id, "RETURNED")} confirm="تسجيل الشيك كمرتجع؟" className="btn-ghost btn-sm">
                              مرتجع
                            </ConfirmButton>
                            <ConfirmButton action={setChequeStatus.bind(null, c.id, "CANCELLED")} confirm="إلغاء الشيك؟" className="btn-ghost btn-sm">
                              إلغاء
                            </ConfirmButton>
                          </>
                        )}
                        {c.status !== "DEFERRED" && (
                          <ConfirmButton action={setChequeStatus.bind(null, c.id, "DEFERRED")} confirm="إعادة الشيك لحالة مؤجل؟" className="btn-ghost btn-sm">
                            إرجاع لمؤجل
                          </ConfirmButton>
                        )}
                        <UploadButton entityType="cheque" entityId={c.id} />
                        <ConfirmButton action={deleteCheque.bind(null, c.id)} confirm="حذف الشيك نهائياً؟" className="btn-danger btn-sm" title="حذف">
                          <Trash2 className="h-4 w-4" />
                        </ConfirmButton>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

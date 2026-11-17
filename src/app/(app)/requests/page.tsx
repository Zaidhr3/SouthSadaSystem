import Link from "next/link";
import clsx from "clsx";
import { ClipboardCheck, Plus } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { can, tenderScope } from "@/lib/permissions";
import { getSettings } from "@/lib/settings";
import { REQUEST_KIND, REQUEST_PAYMENT, REQUEST_STATUS } from "@/lib/labels";
import { fmtDate, fmtJOD, round3 } from "@/lib/format";
import { Badge, Card, EmptyState, Money, PageHeader, StatCard, StatusBadge } from "@/components/ui";
import { ConfirmButton, Grid, Input, ModalForm, Select, Textarea } from "@/components/forms";
import { auditFieldRequest, createFieldRequest, decideFieldRequest, fulfillFieldRequest } from "../actions/requests";

export const metadata = { title: "طلبات المواد والعهد" };

export default async function RequestsPage({ searchParams }: { searchParams: { status?: string } }) {
  const user = await requireUser();
  const status = searchParams.status && searchParams.status in REQUEST_STATUS ? searchParams.status : undefined;
  const scope: Prisma.FieldRequestWhereInput = user.role === "PM" ? { tender: tenderScope(user) } : {};
  const [rows, counts, settings, projects] = await Promise.all([
    db.fieldRequest.findMany({ where: { ...scope, ...(status ? { status } : {}) }, include: { tender: { select: { id: true, name: true, awardedValue: true, variationTotal: true } } }, orderBy: [{ createdAt: "desc" }], take: 200 }),
    db.fieldRequest.groupBy({ by: ["status"], where: scope, _count: true, _sum: { estimatedAmount: true } }),
    getSettings(),
    db.tender.findMany({ where: { ...tenderScope(user), status: { in: ["WON", "EXECUTION", "MAINTENANCE"] } }, select: { id: true, name: true, boqItems: { select: { id: true, description: true, unit: true }, orderBy: { sortOrder: "asc" } } } }),
  ]);
  // معلومات الميزانية للمحاسب: قيمة العقد والمصروف حتى الآن لكل مشروع
  const tenderIds = Array.from(new Set(rows.map((r) => r.tenderId)));
  const spent = can.viewAll(user.role) ? await db.expense.groupBy({ by: ["tenderId"], where: { tenderId: { in: tenderIds } }, _sum: { amount: true } }) : [];
  const users = new Map((await db.user.findMany({ select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const boqName = new Map(projects.flatMap((p) => p.boqItems.map((b) => [b.id, b.description] as const)));
  const c = (k: string) => counts.find((x) => x.status === k);
  const fin = can.manageFinance(user.role);
  const admin = can.approveFunds(user.role);

  return (
    <>
      <PageHeader
        title="طلبات المواد والعهد الميدانية"
        subtitle={`مدير المشروع يطلب ← المحاسب يدقق الميزانية ويحدد طريقة الدفع ← المدير العام يوافق على ما يتجاوز ${fmtJOD(settings.gmApprovalThreshold)} ← الصرف`}
        actions={
          can.fieldOps(user.role) && projects.length > 0 && (
            <ModalForm title="طلب مواد أو عهدة" trigger={<><Plus className="h-4 w-4" /> طلب جديد</>} action={createFieldRequest} wide>
              <Grid>
                <Select name="kind" label="نوع الطلب" options={REQUEST_KIND} />
                <Select name="tenderId" label="المشروع" options={projects.map((p) => ({ value: p.id, label: p.name }))} placeholder="— اختر —" />
              </Grid>
              <Select name="boqItemId" label="بند جدول الكميات (اختياري)" options={projects.flatMap((p) => p.boqItems.map((b) => ({ value: b.id, label: `${p.name.slice(0, 22)} — ${b.description} (${b.unit})` })))} placeholder="— غير مرتبط ببند —" />
              <Input name="title" label="عنوان الطلب" required placeholder="حديد 12 ملم للسقف / عهدة أجور عمال الأسبوع" />
              <Grid cols={3}>
                <Input name="quantity" label="الكمية" type="number" />
                <Input name="unit" label="الوحدة" placeholder="طن / م³ / عدد" />
                <Input name="estimatedAmount" label="القيمة التقديرية (د.أ)" type="number" required />
              </Grid>
              <Textarea name="details" label="التفاصيل والمبررات" />
            </ModalForm>
          )
        }
      />
      <div className="stagger mb-5 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard label="بانتظار تدقيق المحاسب" value={c("PENDING_AUDIT")?._count ?? 0} icon={ClipboardCheck} tone="orange" sub={fmtJOD(c("PENDING_AUDIT")?._sum.estimatedAmount ?? 0)} />
        <StatCard label="بانتظار المدير العام" value={c("PENDING_GM")?._count ?? 0} tone="purple" />
        <StatCard label="معتمد بانتظار الصرف" value={c("APPROVED")?._count ?? 0} tone="blue" />
        <StatCard label="تم الصرف" value={c("FULFILLED")?._count ?? 0} tone="green" />
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        <Link href="/requests" className={clsx("btn-sm", !status ? "btn-primary" : "btn-secondary")}>الكل</Link>
        {Object.entries(REQUEST_STATUS).map(([k, v]) => (
          <Link key={k} href={`/requests?status=${k}`} className={clsx("btn-sm", status === k ? "btn-primary" : "btn-secondary")}>{v.label}</Link>
        ))}
      </div>
      <Card pad={false}>
        {rows.length === 0 ? (
          <EmptyState icon={ClipboardCheck} title="لا توجد طلبات" />
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>الطلب</th>
                  <th>المشروع</th>
                  <th className="text-end">القيمة</th>
                  <th>الدفع</th>
                  <th>الحالة</th>
                  <th>إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const contract = round3((r.tender.awardedValue ?? 0) + r.tender.variationTotal);
                  const spentSoFar = spent.find((s) => s.tenderId === r.tenderId)?._sum.amount ?? 0;
                  return (
                    <tr key={r.id}>
                      <td className="max-w-[320px]">
                        <span className="block font-bold">{r.title}</span>
                        <span className="text-xs text-ink-muted">
                          <Badge className="me-1">{REQUEST_KIND[r.kind]}</Badge>
                          {r.quantity ? `${r.quantity} ${r.unit ?? ""} — ` : ""}
                          {r.boqItemId ? `بند: ${boqName.get(r.boqItemId) ?? r.boqItemId} — ` : ""}
                          {users.get(r.requesterId)} — {fmtDate(r.createdAt)}
                        </span>
                        {r.details && <span className="block text-xs text-ink-soft">{r.details}</span>}
                        {r.auditNote && <span className="block text-xs text-[#5b3fc4]">ملاحظة المحاسب: {r.auditNote}</span>}
                        {r.fulfillNote && <span className="block text-xs text-good">الصرف: {r.fulfillNote}</span>}
                      </td>
                      <td className="text-ink-soft"><Link href={`/tenders/${r.tender.id}`} className="hover:text-accent">{r.tender.name}</Link></td>
                      <td className="text-end">
                        <Money value={r.approvedAmount ?? r.estimatedAmount} strong />
                        {r.approvedAmount != null && r.approvedAmount !== r.estimatedAmount && <span className="block text-[11px] text-ink-muted">مطلوب {fmtJOD(r.estimatedAmount)}</span>}
                      </td>
                      <td className="text-xs">{r.paymentMethod ? REQUEST_PAYMENT[r.paymentMethod] : "—"}</td>
                      <td><StatusBadge map={REQUEST_STATUS} value={r.status} /></td>
                      <td className="whitespace-nowrap">
                        {fin && r.status === "PENDING_AUDIT" && (
                          <ModalForm title={`تدقيق الطلب: ${r.title}`} trigger="تدقيق" triggerClass="btn-primary btn-sm" action={auditFieldRequest.bind(null, r.id)}>
                            <div className="rounded-xl bg-canvas p-3 text-sm">
                              <p>قيمة العقد: <b>{fmtJOD(contract)}</b> — المصروف على المشروع حتى الآن: <b>{fmtJOD(spentSoFar)}</b></p>
                              <p>المتبقي من قيمة العقد بعد هذا الطلب: <b className={contract - spentSoFar - r.estimatedAmount < 0 ? "text-bad" : ""}>{fmtJOD(round3(contract - spentSoFar - r.estimatedAmount))}</b></p>
                              {r.estimatedAmount > settings.gmApprovalThreshold && <p className="mt-1 font-semibold text-[#5b3fc4]">يتجاوز {fmtJOD(settings.gmApprovalThreshold)} — سيُحال للمدير العام بعد اعتمادك</p>}
                            </div>
                            <Select name="decision" label="القرار" options={{ APPROVE: "اعتماد (الميزانية متوفرة)", REJECT: "رفض" }} />
                            <Grid>
                              <Input name="approvedAmount" label="المبلغ المعتمد" type="number" defaultValue={r.estimatedAmount} />
                              <Select name="paymentMethod" label="طريقة الدفع" options={REQUEST_PAYMENT} placeholder="— اختر —" />
                            </Grid>
                            <Textarea name="auditNote" label="ملاحظات التدقيق (إلزامية عند الرفض)" />
                          </ModalForm>
                        )}
                        {admin && r.status === "PENDING_GM" && (
                          <>
                            <ConfirmButton action={decideFieldRequest.bind(null, r.id, "APPROVED")} confirm={`الموافقة على ${fmtJOD(r.approvedAmount ?? r.estimatedAmount)}؟`} className="btn-primary btn-sm">موافقة</ConfirmButton>
                            <ConfirmButton action={decideFieldRequest.bind(null, r.id, "REJECTED")} confirm="رفض الطلب؟" className="btn-danger btn-sm">رفض</ConfirmButton>
                          </>
                        )}
                        {fin && r.status === "APPROVED" && (
                          <ModalForm title={`صرف / توريد: ${r.title}`} trigger="تسجيل الصرف" triggerClass="btn-ghost btn-sm" action={fulfillFieldRequest.bind(null, r.id)}>
                            <p className="rounded-xl bg-canvas p-3 text-sm">
                              {r.paymentMethod === "CASH"
                                ? `سيُصرف ${fmtJOD(r.approvedAmount ?? r.estimatedAmount)} عهدة لمدير المشروع (يُخصم من البنك ويُضاف لرصيد عهدته).`
                                : "سجّل مرجع الشيك أو فاتورة المورد — ثم قيّدها في دفتر الشيكات أو المصاريف."}
                            </p>
                            <Input name="fulfillNote" label="المرجع / ملاحظات" placeholder="شيك رقم ... / فاتورة المورد ..." />
                          </ModalForm>
                        )}
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

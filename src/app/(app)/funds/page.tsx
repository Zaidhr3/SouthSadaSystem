import { HandCoins } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { can, tenderScope } from "@/lib/permissions";
import { custodyBalances } from "@/lib/finance";
import { FUND_STATUS } from "@/lib/labels";
import { fmtDate, toInputDate, todayUTC } from "@/lib/format";
import { Card, EmptyState, Money, PageHeader, StatCard, StatusBadge } from "@/components/ui";
import { ConfirmButton, Grid, Input, ModalForm, Select, Textarea } from "@/components/forms";
import { decideFund, fundUser, requestFunds } from "../actions/finance";

export const metadata = { title: "التمويل والعهد" };

export default async function FundsPage() {
  const user = await requireUser();
  const isAdmin = user.role === "ADMIN";
  const seeAll = can.viewAll(user.role);
  const [requests, staff, tenders] = await Promise.all([
    db.fundRequest.findMany({
      where: seeAll ? {} : { recipientId: user.id },
      include: { requester: { select: { name: true } }, recipient: { select: { name: true } }, tender: { select: { name: true } }, decidedBy: { select: { name: true } } },
      orderBy: [{ status: "desc" }, { createdAt: "desc" }],
      take: 300,
    }),
    db.user.findMany({ where: { active: true, role: { in: ["PM", "ACCOUNTANT"] } }, orderBy: { name: "asc" } }),
    db.tender.findMany({ where: { ...tenderScope(user), status: { in: ["WON", "EXECUTION", "MAINTENANCE", "PURCHASED", "PRICING", "SUBMITTED"] } }, select: { id: true, name: true, number: true } }),
  ]);
  const ids = seeAll ? staff.map((s) => s.id) : [user.id];
  const custody = await custodyBalances(ids);
  const people = seeAll ? staff : [{ id: user.id, name: user.name }];
  const tenderOpts = tenders.map((t) => ({ value: t.id, label: `${t.name} (${t.number})` }));

  return (
    <>
      <PageHeader
        title="التمويل والعهد"
        subtitle="ضخ التمويل لمدراء المشاريع وطلبات التمويل وأرصدة العهد"
        actions={
          <>
            {isAdmin ? (
              <ModalForm title="تمويل عهدة مباشر" trigger={<><HandCoins className="h-4 w-4" /> تمويل عهدة</>} action={fundUser} submitLabel="تحويل">
                <Select name="recipientId" label="المستلم" options={staff.map((s) => ({ value: s.id, label: s.name }))} placeholder="— اختر —" />
                <Grid>
                  <Input name="amount" label="المبلغ (د.أ)" type="number" required />
                  <Input name="date" label="التاريخ" type="date" defaultValue={toInputDate(todayUTC())} />
                </Grid>
                <Select name="tenderId" label="المشروع" options={tenderOpts} placeholder="— عام —" />
                <Textarea name="reason" label="البيان" required />
              </ModalForm>
            ) : (
              <ModalForm title="طلب تمويل" trigger={<><HandCoins className="h-4 w-4" /> طلب تمويل</>} action={requestFunds} submitLabel="إرسال">
                <Input name="amount" label="المبلغ (د.أ)" type="number" required />
                <Select name="tenderId" label="العطاء / المشروع" options={tenderOpts} placeholder="— عام —" />
                <Textarea name="reason" label="سبب الطلب" required />
              </ModalForm>
            )}
          </>
        }
      />

      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {people.map((p) => {
          const c = custody.get(p.id) ?? { funded: 0, spent: 0, balance: 0 };
          return (
            <StatCard
              key={p.id}
              label={`عهدة ${p.name}`}
              value={<Money value={c.balance} />}
              sub={<>استلم <Money value={c.funded} /> — صرف <Money value={c.spent} /></>}
              icon={HandCoins}
              tone={c.balance < 0 ? "red" : "green"}
            />
          );
        })}
      </div>

      <Card pad={false} title={<span className="px-5 pt-5 sm:px-6">سجل التمويل والطلبات</span>}>
        {requests.length === 0 ? (
          <EmptyState icon={HandCoins} title="لا توجد حركات تمويل" />
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>التاريخ</th>
                  <th>المستلم</th>
                  <th>البيان</th>
                  <th className="text-end">المبلغ</th>
                  <th>الحالة</th>
                  {isAdmin && <th />}
                </tr>
              </thead>
              <tbody>
                {requests.map((f) => (
                  <tr key={f.id}>
                    <td className="num whitespace-nowrap">{fmtDate(f.decidedAt ?? f.createdAt)}</td>
                    <td>
                      <span className="block font-semibold">{f.recipient.name}</span>
                      {f.requester.name !== f.recipient.name && <span className="text-xs text-ink-muted">بواسطة {f.requester.name}</span>}
                    </td>
                    <td className="max-w-[320px]">
                      {f.reason}
                      {f.tender && <span className="block text-xs text-ink-muted">{f.tender.name}</span>}
                    </td>
                    <td className="text-end">
                      <Money value={f.amount} strong />
                    </td>
                    <td>
                      <StatusBadge map={FUND_STATUS} value={f.status} />
                    </td>
                    {isAdmin && (
                      <td className="whitespace-nowrap">
                        {f.status === "PENDING" && (
                          <>
                            <ConfirmButton action={decideFund.bind(null, f.id, "APPROVED")} confirm="الموافقة وتحويل المبلغ من حساب الشركة؟" className="btn-primary btn-sm">
                              موافقة
                            </ConfirmButton>{" "}
                            <ConfirmButton action={decideFund.bind(null, f.id, "REJECTED")} confirm="رفض الطلب؟" className="btn-danger btn-sm">
                              رفض
                            </ConfirmButton>
                          </>
                        )}
                      </td>
                    )}
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

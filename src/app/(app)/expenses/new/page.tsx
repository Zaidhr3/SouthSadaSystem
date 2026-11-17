import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { can, tenderScope } from "@/lib/permissions";
import { custodyBalances } from "@/lib/finance";
import { Card, Money, PageHeader } from "@/components/ui";
import { ActionForm } from "@/components/forms";
import { ExpenseFormFields } from "@/components/tables";
import { createExpense } from "../../actions/finance";

/** القراءة الآلية (Gemini) وإرسال الفاتورة الإلكترونية قد تستغرق حتى دقيقة */
export const maxDuration = 60;

export const metadata = { title: "مصروف جديد" };

/** إدخال ميداني سريع ومناسب للهاتف — النموذج يُفرغ بعد كل حفظ لإدخال متتالٍ */
export default async function NewExpensePage() {
  const user = await requireUser();
  const [tenders, custody, cheques] = await Promise.all([
    db.tender.findMany({ where: { ...tenderScope(user), status: { in: ["WON", "EXECUTION", "MAINTENANCE", "PURCHASED", "PRICING", "SUBMITTED", "NEGOTIATION"] } }, select: { id: true, name: true, number: true }, orderBy: { updatedAt: "desc" } }),
    custodyBalances([user.id]),
    can.manageFinance(user.role) ? db.cheque.findMany({ where: { status: "DEFERRED" }, select: { id: true, number: true, payee: true } }) : Promise.resolve([]),
  ]);
  const c = custody.get(user.id);
  return (
    <>
      <PageHeader title="مصروف جديد" back={{ href: "/expenses", label: "المصاريف" }} subtitle={user.role === "PM" ? <>رصيد عهدتك: <Money value={c?.balance ?? 0} strong /></> : undefined} />
      <Card className="mx-auto max-w-xl">
        <ActionForm action={createExpense} submitLabel="حفظ المصروف" resetOnSuccess>
          <ExpenseFormFields tenders={tenders} user={user} cheques={cheques} />
        </ActionForm>
      </Card>
    </>
  );
}

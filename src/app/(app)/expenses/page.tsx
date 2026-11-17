import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { Plus, Wallet } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { can, expenseScope, tenderScope } from "@/lib/permissions";
import { EXPENSE_CATEGORY, PAYMENT_METHOD } from "@/lib/labels";
import { attachmentsMap } from "@/lib/uploads";
import { Card, Money, PageHeader, StatCard } from "@/components/ui";
import { ExpenseFormFields, ExpenseTable } from "@/components/tables";
import { ModalForm } from "@/components/forms";
import { createExpense } from "../actions/finance";

/** القراءة الآلية (Gemini) وإرسال الفاتورة الإلكترونية قد تستغرق حتى دقيقة */
export const maxDuration = 60;

export const metadata = { title: "المصاريف" };

export default async function ExpensesPage({ searchParams }: { searchParams: { tender?: string; cat?: string; from?: string; to?: string; method?: string; flag?: string } }) {
  const user = await requireUser();
  const where: Prisma.ExpenseWhereInput = { AND: [expenseScope(user)] };
  const and = where.AND as Prisma.ExpenseWhereInput[];
  if (searchParams.tender) and.push({ tenderId: searchParams.tender === "none" ? null : Number(searchParams.tender) });
  if (searchParams.cat && searchParams.cat in EXPENSE_CATEGORY) and.push({ category: searchParams.cat });
  if (searchParams.method && searchParams.method in PAYMENT_METHOD) and.push({ paymentMethod: searchParams.method });
  if (searchParams.from) and.push({ date: { gte: new Date(`${searchParams.from}T00:00:00Z`) } });
  if (searchParams.to) and.push({ date: { lte: new Date(`${searchParams.to}T00:00:00Z`) } });
  if (searchParams.flag) and.push({ invoiceFlag: { not: null } });

  const [rows, agg, tenders, cheques] = await Promise.all([
    db.expense.findMany({ where, include: { tender: { select: { id: true, name: true, number: true } }, createdBy: { select: { name: true } } }, orderBy: [{ date: "desc" }, { id: "desc" }], take: 500 }),
    db.expense.aggregate({ where, _sum: { amount: true }, _count: true }),
    db.tender.findMany({ where: { ...tenderScope(user), status: { notIn: ["LOST", "CANCELLED"] } }, select: { id: true, name: true, number: true }, orderBy: { updatedAt: "desc" } }),
    can.manageFinance(user.role) ? db.cheque.findMany({ where: { status: "DEFERRED" }, select: { id: true, number: true, payee: true } }) : Promise.resolve([]),
  ]);
  const atts = await attachmentsMap("expense", rows.map((r) => r.id));
  const byMethod = await db.expense.groupBy({ by: ["paymentMethod"], where, _sum: { amount: true } });

  const flagged = await db.expense.count({ where: { AND: [expenseScope(user), { invoiceFlag: { not: null } }] } });
  return (
    <>
      <PageHeader
        title="المصاريف"
        subtitle="مصنفة ومرتبطة بالعطاءات والمشاريع مع المعززات"
        actions={
          <>
            <Link href="/expenses/new" className="btn-secondary lg:hidden">
              <Plus className="h-4 w-4" /> إدخال سريع
            </Link>
            <ModalForm title="مصروف جديد" trigger={<><Plus className="h-4 w-4" /> مصروف جديد</>} action={createExpense}>
              <ExpenseFormFields tenders={tenders} user={user} cheques={cheques} />
            </ModalForm>
          </>
        }
      />
      {flagged > 0 && (
        <Link href={searchParams.flag ? "/expenses" : "/expenses?flag=1"} className="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-bad/30 bg-bad-soft px-4 py-3 text-sm font-bold text-bad">
          <span>⚠ {flagged} فاتورة بتاريخ قديم بدون مرفق — للتحقيق</span>
          <span className="text-xs underline">{searchParams.flag ? "عرض الكل" : "عرضها فقط"}</span>
        </Link>
      )}
      <div className="mb-5 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard label="إجمالي النتائج" value={<Money value={agg._sum.amount ?? 0} />} sub={`${agg._count} حركة`} icon={Wallet} tone="orange" />
        {Object.entries(PAYMENT_METHOD).map(([k, v]) => (
          <StatCard key={k} label={v} value={<Money value={byMethod.find((b) => b.paymentMethod === k)?._sum.amount ?? 0} />} tone="gray" />
        ))}
      </div>

      <form className="card mb-4 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
        <select name="tender" defaultValue={searchParams.tender ?? ""} className="input">
          <option value="">كل المشاريع</option>
          <option value="none">مصاريف عامة</option>
          {tenders.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <select name="cat" defaultValue={searchParams.cat ?? ""} className="input">
          <option value="">كل التصنيفات</option>
          {Object.entries(EXPENSE_CATEGORY).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <input type="date" name="from" defaultValue={searchParams.from} className="input" aria-label="من تاريخ" />
        <input type="date" name="to" defaultValue={searchParams.to} className="input" aria-label="إلى تاريخ" />
        <div className="flex gap-2">
          <button className="btn-primary flex-1">تصفية</button>
          <Link href="/expenses" className="btn-secondary">مسح</Link>
        </div>
      </form>

      <Card pad={false}>
        <ExpenseTable rows={rows} user={user} atts={atts} showTender />
      </Card>
    </>
  );
}

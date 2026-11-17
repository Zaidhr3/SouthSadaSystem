import Link from "next/link";
import { FileX2, ReceiptText } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { see } from "@/lib/permissions";
import { fmtDate } from "@/lib/format";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";

export const metadata = { title: "فواتير نظام الفوترة" };
const nf = new Intl.NumberFormat("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 });

/**
 * سجل الفواتير الصادرة عبر نظام الفوترة الوطني: اختر الفاتورة التي فيها خطأ ← «فاتورة إرجاع» عليها
 * (يعدّها المحاسب بإذن المدير العام — كما في نظام الفوترة تماماً)، ثم تُصدر فاتورة صحيحة بدلها.
 */
export default async function EinvoicesPage({ searchParams }: { searchParams: { q?: string } }) {
  const user = await requireUser(see.finance);
  const q = (searchParams.q ?? "").trim();
  const num = Number(q.replace(/^SADA-/i, ""));
  const claims = await db.claim.findMany({
    where: {
      invoiceNo: { not: null },
      ...(q ? { OR: [...(Number.isInteger(num) && num > 0 ? [{ invoiceNo: num }] : []), { tender: { name: { contains: q } } }, { tender: { number: { contains: q } } }] } : {}),
    },
    include: { tender: { select: { name: true, number: true, entity: true } } },
    orderBy: { invoiceNo: "desc" },
    take: 300,
  });
  const returns = await db.einvReturn.findMany({ where: { claimId: { in: claims.map((c) => c.id) }, status: { notIn: ["AUTHORIZED", "DECLINED"] } }, orderBy: { id: "asc" } });
  const byClaim = new Map<number, typeof returns>();
  for (const r of returns) byClaim.set(r.claimId, [...(byClaim.get(r.claimId) ?? []), r]);
  const fin = user.role === "ACCOUNTANT" || user.role === "ADMIN";

  return (
    <>
      <PageHeader
        title="فواتير نظام الفوترة"
        subtitle="كل الفواتير الصادرة عبر نظام الفوترة الوطني. فاتورة فيها خطأ؟ اخترها ← «فاتورة إرجاع» (يعدّها المحاسب بإذن المدير العام) ثم تُصدر الفاتورة الصحيحة."
      />
      <form className="mb-4 flex max-w-md gap-2" action="/einvoices">
        <input name="q" defaultValue={q} className="input" placeholder="رقم الفاتورة (SADA-12) أو اسم/رقم المشروع" aria-label="بحث في الفواتير" />
        <button className="btn-secondary" type="submit">بحث</button>
      </form>
      <Card pad={false}>
        {claims.length === 0 ? (
          <EmptyState icon={ReceiptText} title="لا توجد فواتير صادرة" hint="تصدر الفاتورة عند الموافقة النهائية على المطالبة" />
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>الفاتورة</th>
                  <th>المشروع / المطالبة</th>
                  <th>التاريخ</th>
                  <th className="text-end">الإجمالي</th>
                  <th>الحالة</th>
                  <th>فواتير الإرجاع</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {claims.map((c) => {
                  const rs = byClaim.get(c.id) ?? [];
                  const returned = rs.filter((r) => r.status === "SUBMITTED").reduce((s, r) => s + r.amount, 0);
                  return (
                    <tr key={c.id}>
                      <td className="num font-bold">SADA-{c.invoiceNo}</td>
                      <td>
                        <Link href={`/claims/${c.id}`} className="font-semibold hover:text-accent">{c.tender.name}</Link>
                        <span className="block text-xs text-ink-muted">مطالبة رقم {c.number} — {c.tender.entity}</span>
                      </td>
                      <td className="num whitespace-nowrap">{fmtDate(c.einvSubmittedAt)}</td>
                      <td className="text-end num">{nf.format(c.einvTotal ?? 0)}</td>
                      <td>
                        {c.einvStatus === "SUBMITTED" ? <Badge tone="green">معتمدة</Badge> : c.einvStatus === "REJECTED" ? <Badge tone="red">مرفوضة — أُعيدت للمحاسب</Badge> : <Badge tone="orange">لم تُعتمد بعد</Badge>}
                      </td>
                      <td className="text-xs">
                        {rs.length === 0 ? "—" : rs.map((r) => <span key={r.id} className="block num">{r.number ? `SADA-${r.number}` : "طلب"} · {nf.format(r.amount)}{r.status === "SUBMITTED" ? "" : " (قيد الإجراء)"}</span>)}
                        {returned > 0 && <span className="block font-bold text-bad num">المرتجع: {nf.format(returned)}</span>}
                      </td>
                      <td>
                        {c.einvStatus === "SUBMITTED" && fin && (
                          <Link href={`/claims/${c.id}#returns`} className="btn-secondary btn-sm whitespace-nowrap">
                            <FileX2 className="h-4 w-4" /> فاتورة إرجاع
                          </Link>
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

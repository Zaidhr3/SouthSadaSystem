import { userSees } from "@/lib/brand";
import { Download, FileSpreadsheet } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { toInputDate, todayUTC } from "@/lib/format";
import { Card, PageHeader } from "@/components/ui";

export const metadata = { title: "التقارير والتصدير" };

export default async function ReportsPage() {
  const user = await requireUser(can.viewAll);
  const tenders = await db.tender.findMany({ select: { id: true, name: true, number: true }, orderBy: { updatedAt: "desc" } });
  const t = todayUTC();
  const monthStart = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1));

  return (
    <>
      <PageHeader title="التقارير والتصدير إلى Excel" subtitle="ملفات Excel منسقة باتجاه عربي (RTL) جاهزة للطباعة والمراجعة" />
      <div className="stagger grid gap-5 lg:grid-cols-2">
        <Card title={<span className="flex items-center gap-2"><FileSpreadsheet className="h-5 w-5 text-good" /> تقرير مالي لفترة</span>}>
          <p className="mb-4 text-sm text-ink-muted">
            يشمل: ملخص الفترة، كل المصاريف، المطالبات المقبوضة والمقدمة، الشيكات، مستخلصات الباطن، أوامر التغيير، ملخص المشاريع
            {(await userSees(user, "bank")) ? "، وكشف الحساب البنكي والتدفق النقدي الشهري." : "."}
          </p>
          <form action="/api/export/financial" method="get" className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="from">من تاريخ</label>
                <input id="from" name="from" type="date" className="input" required defaultValue={toInputDate(monthStart)} />
              </div>
              <div>
                <label className="label" htmlFor="to">إلى تاريخ</label>
                <input id="to" name="to" type="date" className="input" required defaultValue={toInputDate(t)} />
              </div>
            </div>
            <button className="btn-primary w-full"><Download className="h-4 w-4" /> تنزيل التقرير المالي</button>
          </form>
        </Card>
        <Card title={<span className="flex items-center gap-2"><FileSpreadsheet className="h-5 w-5 text-accent" /> تقرير عطاء / مشروع</span>}>
          <p className="mb-4 text-sm text-ink-muted">
            يشمل: بيانات العطاء ومراحله، جدول الكميات كاملاً مع رؤى الأسعار التاريخية لكل بند، الكفالات وعمولاتها، أوامر التغيير، المطالبات ومستقطعاتها، المصاريف، الشيكات، مقاولو الباطن، المواد والآليات.
          </p>
          <form action="/api/export/tender" method="get" className="space-y-4">
            <div>
              <label className="label" htmlFor="id">العطاء / المشروع</label>
              <select id="id" name="id" className="input" required>
                {tenders.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.number})</option>)}
              </select>
            </div>
            <button className="btn-primary w-full" disabled={tenders.length === 0}><Download className="h-4 w-4" /> تنزيل تقرير المشروع</button>
          </form>
        </Card>
      </div>
    </>
  );
}

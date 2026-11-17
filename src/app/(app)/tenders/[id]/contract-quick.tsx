import { FileSignature } from "lucide-react";
import type { Guarantee, Tender } from "@prisma/client";
import { Grid, Input, ModalForm } from "@/components/forms";
import { toInputDate } from "@/lib/format";
import { saveContractQuick } from "../../actions/contract";

/** نافذة سريعة: بيانات العقد بعد الإحالة — أمر المباشرة والمدة، المهندس المشرف، الكفالات، بيانات صاحب العمل الضريبية */
export function ContractQuick({ tender, guarantees, canGuarantees }: { tender: Tender; guarantees: Guarantee[]; canGuarantees: boolean }) {
  const has = (t: string) => guarantees.some((g) => g.type === t && g.status !== "RETURNED");
  return (
    <ModalForm title="بيانات العقد (نافذة سريعة)" trigger={<><FileSignature className="h-4 w-4" /> بيانات العقد</>} triggerClass="btn-secondary" action={saveContractQuick.bind(null, tender.id)} wide>
      <p className="text-sm font-bold">التنفيذ</p>
      <Grid cols={3}>
        <Input name="commenceOrderDate" label="تاريخ أمر المباشرة" type="date" defaultValue={toInputDate(tender.commenceOrderDate)} />
        <Input name="durationDays" label="مدة العطاء (يوم)" type="number" step="1" defaultValue={tender.durationDays ?? ""} />
        <Input name="maintenanceMonths" label="مدة الصيانة (شهر)" type="number" step="1" defaultValue={tender.maintenanceMonths ?? 12} />
      </Grid>
      <p className="pt-2 text-sm font-bold">المهندس المشرف (صاحب العمل)</p>
      <Grid>
        <Input name="supervisorName" label="اسم المهندس المشرف" defaultValue={tender.supervisorName ?? ""} />
        <Input name="supervisorPhone" label="رقم الهاتف" inputMode="tel" dir="ltr" defaultValue={tender.supervisorPhone ?? ""} placeholder="07XXXXXXXX" />
      </Grid>
      <p className="pt-2 text-sm font-bold">صاحب العمل (للفاتورة الإلكترونية)</p>
      <Grid>
        <Input name="employerTin" label="الرقم الضريبي لصاحب العمل" dir="ltr" defaultValue={tender.employerTin ?? ""} hint="اختياري — يظهر في فاتورة جفوتارا" />
        <Input name="employerPhone" label="هاتف صاحب العمل" inputMode="tel" dir="ltr" defaultValue={tender.employerPhone ?? ""} />
      </Grid>
      {canGuarantees && (
        <>
          <p className="pt-2 text-sm font-bold">كفالة حسن التنفيذ {has("PERFORMANCE") && <span className="text-xs font-normal text-good">(مسجلة — املأ الحقول فقط لإضافة كفالة جديدة)</span>}</p>
          <Grid>
            <Input name="perfAmount" label="القيمة (د.أ)" inputMode="decimal" />
            <Input name="perfBank" label="البنك" />
            <Input name="perfIssue" label="تاريخ الإصدار" type="date" />
            <Input name="perfExpiry" label="تاريخ الانتهاء" type="date" />
          </Grid>
          <p className="pt-2 text-sm font-bold">كفالة الصيانة {has("MAINTENANCE") && <span className="text-xs font-normal text-good">(مسجلة)</span>}</p>
          <Grid>
            <Input name="maintAmount" label="القيمة (د.أ)" inputMode="decimal" />
            <Input name="maintBank" label="البنك" />
            <Input name="maintIssue" label="تاريخ الإصدار" type="date" />
            <Input name="maintExpiry" label="تاريخ الانتهاء" type="date" hint="فارغ = سنة من الاستلام الابتدائي" />
          </Grid>
        </>
      )}
    </ModalForm>
  );
}

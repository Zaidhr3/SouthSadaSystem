import type { Loan } from "@prisma/client";
import { Grid, Input, Select, Textarea } from "@/components/forms";
import { LOAN_LENDER_TYPE } from "@/lib/labels";

/** بيانات الجهة الدائنة والغرض والضمانات (مشتركة بين الإنشاء والتعديل) */
export function LoanInfoFields({ loan, tenders }: { loan?: Loan; tenders: { id: number; name: string; number: string }[] }) {
  return (
    <>
      <Grid>
        <Input name="lender" label="الجهة الدائنة" required placeholder="البنك العربي / اسم الشخص أو الشركة" defaultValue={loan?.lender} />
        <Select name="lenderType" label="نوع الجهة" options={LOAN_LENDER_TYPE} defaultValue={loan?.lenderType ?? "BANK"} />
      </Grid>
      <Grid>
        <Input name="lenderContact" label="هاتف / جهة الاتصال" dir="ltr" defaultValue={loan?.lenderContact ?? ""} />
        <Input name="reference" label="رقم العقد / المرجع" dir="ltr" defaultValue={loan?.reference ?? ""} />
      </Grid>
      <Input name="purpose" label="الغرض من الدين" required placeholder="تمويل رواتب / شراء حديد لمشروع ... / سيولة تشغيلية" defaultValue={loan?.purpose} />
      <Grid>
        <Select name="tenderId" label="المشروع المرتبط" options={tenders.map((t) => ({ value: t.id, label: `${t.name} (${t.number})` }))} placeholder="— عام للشركة —" defaultValue={loan?.tenderId ?? ""} />
        <Input name="collateral" label="الضمانات المقدمة" placeholder="شيكات ضمان / كمبيالة / رهن / كفيل" defaultValue={loan?.collateral ?? ""} />
      </Grid>
      <Textarea name="notes" label="ملاحظات" defaultValue={loan?.notes ?? ""} />
    </>
  );
}

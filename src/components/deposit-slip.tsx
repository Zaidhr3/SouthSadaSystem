import { FileInput } from "./forms";

/** حقل «وصل الإيداع البنكي» — إلزامي لغير الإدارة (والتحقق الفعلي على الخادم) */
export function DepositSlipInput({ required, hint }: { required: boolean; hint?: string }) {
  return (
    <div className={required ? "rounded-xl border border-gold/60 bg-gold-soft p-3" : undefined}>
      <FileInput
        name="depositSlip"
        label={required ? "وصل الإيداع البنكي (إلزامي)" : "وصل الإيداع البنكي (اختياري للإدارة)"}
        hint={hint ?? (required ? "صورة واضحة لوصل الإيداع الصادر من البنك — لا يُحفظ الإيداع بدونه" : "يُحفظ مع الحركة في الحساب البنكي")}
      />
    </div>
  );
}

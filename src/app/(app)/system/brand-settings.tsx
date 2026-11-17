import { Eye } from "lucide-react";
import { Card } from "@/components/ui";
import { ActionForm, Input } from "@/components/forms";
import { ROLE_LABELS } from "@/lib/labels";
import type { Role } from "@/lib/permissions";
import { saveBrandSettings } from "../actions/brand";

const ROLES: Role[] = ["CHAIRMAN", "ACCOUNTANT", "AUDITOR", "PM"];

/** الهوية والرؤية: شعار/رؤية الشركة على الفواتير والمستندات، ومن يرى الأرباح والحساب البنكي */
export function BrandSettings({ slogan, profitRoles, bankRoles }: { slogan: string; profitRoles: Role[]; bankRoles: Role[] }) {
  const boxes = (name: string, on: Role[]) => (
    <div className="flex flex-wrap gap-3">
      <label className="flex items-center gap-2 text-sm text-ink-muted"><input type="checkbox" checked disabled /> المدير العام (دائماً)</label>
      {ROLES.map((r) => (
        <label key={r} className="flex min-h-11 items-center gap-2 text-sm font-semibold">
          <input type="checkbox" name={name} value={r} defaultChecked={on.includes(r)} /> {ROLE_LABELS[r]}
        </label>
      ))}
    </div>
  );
  return (
    <Card title={<span className="flex items-center gap-2"><Eye className="h-5 w-5" /> الهوية والرؤية</span>}>
      <ActionForm action={saveBrandSettings} submitLabel="حفظ الهوية والرؤية" draft={false}>
        <Input name="slogan" label="رؤية / شعار الشركة على الفواتير والمستندات" defaultValue={slogan} maxLength={120} hint="يظهر تحت اسم الشركة في شريط الهوية أعلى كل فاتورة" />
        <fieldset>
          <legend className="mb-1 text-sm font-bold">من يرى أرباح المشاريع وهوامشها</legend>
          {boxes("profit", profitRoles)}
        </fieldset>
        <fieldset>
          <legend className="mb-1 text-sm font-bold">من يرى الحساب البنكي والتدفق النقدي</legend>
          {boxes("bank", bankRoles)}
        </fieldset>
        <p className="text-xs text-ink-muted">نسبة الربح المستهدفة ونسب الضريبة والمحجوزات في «حاسبة المستقطعات» أعلاه.</p>
      </ActionForm>
    </Card>
  );
}

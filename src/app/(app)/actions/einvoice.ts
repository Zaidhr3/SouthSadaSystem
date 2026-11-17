"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { actionUser } from "@/lib/auth";
import { auditEvent, run, type ActionState } from "@/lib/action";
import { can } from "@/lib/permissions";
import { formObject, zOptText } from "@/lib/validation";
import { parseNum } from "@/lib/num";

const digits = (label: string) =>
  z.preprocess((v) => (v == null ? "" : String(v).replace(/\s/g, "")), z.string().regex(/^\d*$/, `${label}: أرقام فقط`).max(15, `${label} طويل`));

const schema = z.object({
  enabled: z.preprocess((v) => v === "on" || v === "1" || v === "true", z.boolean()),
  tin: digits("الرقم الضريبي"),
  activityNo: digits("تسلسل مصدر الدخل"),
  companyName: zOptText,
  kind: z.enum(["income", "sales"]).catch("income"),
  // يقبل «16» و«16%» و«١٦» و«8.5» — والصفر قيمة صالحة
  taxPct: z.preprocess((v) => (v === "" || v == null ? 16 : parseNum(String(v).replace(/[%٪\s]/g, ""))), z.number({ invalid_type_error: "نسبة الضريبة رقم من 0 إلى 100" }).finite("نسبة الضريبة رقم من 0 إلى 100").min(0, "نسبة الضريبة لا تقل عن 0").max(100, "نسبة الضريبة لا تزيد عن 100")),
  priceMode: z.enum(["inclusive", "exclusive"]).catch("inclusive"),
  zeroCategory: z.enum(["Z", "O"]).catch("Z"),
  buyerCity: z.preprocess((v) => (v == null || v === "" ? "JO-AM" : String(v).trim().toUpperCase()), z.string().regex(/^JO-[A-Z]{2}$/, "رمز المحافظة بصيغة JO-AM")),
});

/** إعدادات نظام الفوترة الوطني (المدير العام) — المفاتيح السرية في متغيرات الخادم وليست هنا */
export async function saveEinvSettings(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await actionUser(can.manageSettings);
    const d = schema.parse(formObject(fd));
    const rows: [string, string][] = [
      ["einv.enabled", d.enabled ? "1" : "0"],
      ["einv.tin", d.tin],
      ["einv.activityNo", d.activityNo],
      ["einv.companyName", d.companyName ?? "شركة صدى الجنوب للمقاولات الإنشائية"],
      ["einv.kind", d.kind],
      ["einv.taxPct", String(d.taxPct)],
      ["einv.buyerCity", d.buyerCity],
      ["einv.priceMode", d.priceMode],
      ["einv.zeroCategory", d.zeroCategory],
    ];
    for (const [key, value] of rows) await db.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
    await auditEvent("update", "Setting", `إعدادات الفوترة الإلكترونية — ${d.enabled ? "الإرسال مفعّل" : "الإرسال معطّل"} — ${d.kind === "sales" ? `مبيعات ${d.taxPct}% ${d.priceMode === "inclusive" ? "(الأسعار شاملة الضريبة)" : "(تُضاف فوق السعر)"}` : "دخل"}`, user);
    revalidatePath("/", "layout");
    return d.enabled ? "حُفظت الإعدادات — الإرسال التلقائي مفعّل عند الموافقة النهائية" : "حُفظت الإعدادات";
  });
}

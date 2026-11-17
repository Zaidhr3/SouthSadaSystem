import "server-only";
import { db } from "./db";

/** إعدادات المستقطعات الافتراضية — قابلة للتعديل من «إعدادات النظام» (المدير العام) */
export const SETTING_DEFAULTS = {
  /** نسبة المحجوزات (الاحتفاظ) من كل مطالبة */
  retentionPct: 10,
  /** الحد الأقصى للمحجوزات كنسبة من قيمة العقد (0 = بلا حد) */
  retentionCapPct: 10,
  /** ضريبة الدخل المقتطعة من المنبع */
  withholdingTaxPct: 0,
  /** رسوم الطوابع على المطالبة */
  stampDutyPct: 0,
  /** نسبة المحجوزات الافتراضية لمقاولي الباطن */
  subRetentionPct: 5,
  /** نسبة الهدر المسموحة في المواد قبل التنبيه */
  wasteTolerancePct: 5,
  /** حد قيمة طلبات المواد/العهد التي تحتاج موافقة المدير العام (د.أ) */
  gmApprovalThreshold: 500,
  /** نسبة الربح المستهدفة للمشاريع — تقرير الربحية يقارن بها */
  targetProfitPct: 15,
} as const;

export type SettingKey = keyof typeof SETTING_DEFAULTS;
export type Settings = Record<SettingKey, number>;

export const SETTING_LABELS: Record<SettingKey, { label: string; hint: string }> = {
  retentionPct: { label: "نسبة المحجوزات من كل مطالبة (%)", hint: "تُحتجز من صافي المطالبة وتُسترد بعد انتهاء فترة الصيانة" },
  retentionCapPct: { label: "سقف المحجوزات من قيمة العقد (%)", hint: "يتوقف الاحتجاز عند بلوغ هذا السقف — 0 بلا سقف" },
  withholdingTaxPct: { label: "نسبة ضريبة الدخل المستحقة (%) — لوحدة الضريبة", hint: "تُقترح تلقائياً على المقبوضات في وحدة الضريبة — لا تُخصم من المطالبات" },
  stampDutyPct: { label: "رسوم الطوابع على المطالبات (%)", hint: "إن كانت الجهة تقتطعها من الدفعات" },
  subRetentionPct: { label: "محجوزات مقاولي الباطن الافتراضية (%)", hint: "تُطبق على كل مستخلص باطن جديد" },
  wasteTolerancePct: { label: "نسبة الهدر المسموحة في المواد (%)", hint: "تنبيه عند تجاوز التوريد كمية جدول الكميات بهذه النسبة" },
  targetProfitPct: { label: "نسبة الربح المستهدفة للمشاريع (%)", hint: "تقرير الربحية يقارن هامش كل مشروع بها ويُلوّنه أحمر إن نزل عنها" },
  gmApprovalThreshold: { label: "حد موافقة المدير العام على طلبات المواد والعهد (د.أ)", hint: "الطلبات الأعلى من هذا المبلغ تحتاج موافقة المدير العام بعد تدقيق المحاسب" },
};

export async function getSettings(): Promise<Settings> {
  const rows = await db.setting.findMany();
  const out = { ...SETTING_DEFAULTS } as Settings;
  for (const r of rows) {
    if (r.key in SETTING_DEFAULTS) {
      const n = Number(r.value);
      if (Number.isFinite(n)) out[r.key as SettingKey] = n;
    }
  }
  return out;
}

import type { Prisma } from "@prisma/client";

/**
 * ADMIN: المدير العام · ACCOUNTANT: المحاسب · PM: مدير مشروع
 * CHAIRMAN: المشرف الأعلى (أبو أحمد) — اطلاع كامل على كل شيء بلا أي تعديل
 * AUDITOR: مراقب ومدقق — اطلاع على الوحدات التشغيلية والمالية وسجل التدقيق بلا أي تعديل
 */
export type Role = "ADMIN" | "ACCOUNTANT" | "PM" | "CHAIRMAN" | "AUDITOR";
export const ROLES: Role[] = ["ADMIN", "ACCOUNTANT", "PM", "CHAIRMAN", "AUDITOR"];
export type AppUser = {
  id: number;
  name: string;
  username: string;
  role: Role;
  title: string | null;
  /** تفويض مؤقت نافذ: يعمل المستخدم بصلاحيات هذا الشخص (الدور أعلاه هو دور المفوِّض) */
  actingFor?: { name: string; role: Role; until: Date } | null;
  /** الدور الأصلي للمستخدم قبل التفويض */
  baseRole?: Role;
};

export class AppError extends Error {
  /** رابط اختياري يظهر مع رسالة الخطأ (مثل فتح العطاء المسجل مسبقاً) */
  constructor(message: string, public link?: { href: string; label: string }) {
    super(message);
  }
}

/** أدوار الاطلاع فقط — يُمنع عليها أي إجراء كتابة على مستوى الخادم (actionUser) */
export const isReadOnly = (r: Role) => r === "CHAIRMAN" || r === "AUDITOR";

const A = (r: Role) => r === "ADMIN";
const AF = (r: Role) => r === "ADMIN" || r === "ACCOUNTANT";
const AP = (r: Role) => r === "ADMIN" || r === "PM";
const AC = (r: Role) => r === "ADMIN" || r === "CHAIRMAN";
const ACA = (r: Role) => r === "ADMIN" || r === "CHAIRMAN" || r === "AUDITOR";
const NOT_PM = (r: Role) => r !== "PM";

/**
 * مصفوفة صلاحيات الكتابة — المرجع الوحيد في النظام.
 * أدوار الاطلاع (المشرف الأعلى والمراقب) لا تملك أي صلاحية هنا.
 */
export const can = {
  /** رصيد الحساب البنكي الرئيسي والسيولة ورأس المال (عرض) */
  seeBank: AC,
  /** أرباح الشركة وهوامش المشاريع (عرض) */
  seeProfit: AC,
  /** إنشاء/تعديل/حذف العطاءات، جداول الكميات، مراحل دورة الحياة */
  manageTenders: A,
  /** إصدار وإدارة الكفالات */
  manageGuarantees: A,
  /** اعتماد أوامر التغيير */
  approveVariations: A,
  /** إنشاء اتفاقيات مقاولي الباطن واعتماد مستخلصاتهم */
  manageSubcontracts: A,
  /** سجل الآليات والمعدات */
  manageFleet: A,
  manageDocuments: A,
  approveFunds: A,
  manageUsers: A,
  manageSettings: A,
  /** سجل الرقابة والتدقيق (عرض) */
  viewAudit: ACA,
  /** التسجيل المالي: المصاريف، قبض المطالبات، الشيكات، دفع مستخلصات الباطن */
  manageFinance: AF,
  /** الديون الخارجية: تسجيل الدين والأقساط والسداد وإعادة الجدولة */
  manageDebts: AF,
  /** حذف دين أو دفعة سداد (يلغي حركاتها البنكية) */
  deleteDebts: A,
  /** طلبات التسعير من الموقع: دراسة (مدير المشروع)، تدقيق (المحاسب)، اعتماد (الإدارة) */
  handleQuotes: AP,
  auditQuotes: AF,
  approveQuotes: A,
  /** مجلس الإدارة: تدقيق البنود قبل رفعها للتصويت (المحاسب، والإدارة احتياطاً) */
  auditBoard: AF,
  /** الرواتب: ملفات الموظفين، السلف، إعداد المسيرات وصرفها (المحاسب والإدارة). مدير المشروع يسجل يوميات عمال مشاريعه فقط */
  managePayroll: AF,
  /** التسويق والعلاقات العامة: الإدارة تصيغ وتعتمد وتنشر */
  manageMarketing: A,
  /** بوابة العملاء: حسابات العملاء (الإدارة) وخطة العمل والمراسلات والتواقيع (الإدارة ومدير المشروع) */
  manageClients: A,
  managePortal: AP,
  /** عرض كل العطاءات والمشاريع والبيانات المالية */
  viewAll: NOT_PM,
  seeAllExpenses: NOT_PM,
  /** العمليات الميدانية: نسبة الإنجاز، توريد المواد، تشغيل المعدات، المراسلات */
  fieldOps: AP,
  /** المرحلة الأولى (الإحالة والتعاقد): ورقة الإحالة والطوابع، أمر المباشرة والدفعة المقدمة — المدير العام والمحاسب */
  manageAward: AF,
  /**
   * مراحل المشروع من التنفيذ حتى الإغلاق (المراحل 2–5): الحصر، لجان الاستلام الابتدائي والنهائي،
   * المحاضر، تسليم كفالة الصيانة واستلام كتب الإفراج، وإغلاق المشروع — مع رفع مستندات كل مرحلة.
   * المدير العام والمحاسب على كل المشاريع، ومدير المشروع على مشاريعه المسندة فقط.
   * القيود المالية (إصدار الكفالات من البنك وإعادتها، اعتماد وقفل المطالبات، القبض والصرف، الحذف)
   * تبقى للمحاسب والإدارة العليا.
   */
  manageProjectLifecycle: (r: Role) => r === "ADMIN" || r === "PM" || r === "ACCOUNTANT",
  /** الاعتماد النهائي للمطالبات وقبض الشيكات: الإدارة (المدير العام والمشرف الأعلى أبو أحمد) */
  approveClaims: AC,
};

/** الإدارة: المدير العام والمشرف الأعلى */
export const isManagementRole = (r: Role) => r === "ADMIN" || r === "CHAIRMAN";
/** وصل الإيداع البنكي إلزامي لغير الإدارة — بالدور الأصلي للشخص (المفوَّض بصلاحيات المدير العام يبقى ملزماً) */
export const depositSlipRequired = (user: Pick<AppUser, "role" | "baseRole">) => !isManagementRole(user.baseRole ?? user.role);

/** صلاحيات الاطلاع على الصفحات */
export const see = {
  quotes: (_: Role) => true,
  marketing: AC,
  /** الوحدات المالية (الكفالات، الشيكات، المصاريف، الضرائب، التمويل) */
  finance: NOT_PM,
  /** رقابة كل المراسلات الداخلية */
  allMessages: AC,
  /** إدارة المستخدمين والإعدادات (عرض) */
  admin: AC,
};

/** نطاق العطاءات المرئية: مدير المشروع يرى مشاريعه فقط */
export function tenderScope(user: AppUser): Prisma.TenderWhereInput {
  return user.role === "PM" ? { managerId: user.id } : {};
}

export function expenseScope(user: AppUser): Prisma.ExpenseWhereInput {
  if (user.role !== "PM") return {};
  return { OR: [{ createdById: user.id }, { tender: { managerId: user.id } }] };
}

export function assertRole(user: AppUser, check: (r: Role) => boolean) {
  if (!check(user.role)) throw new AppError("ليست لديك صلاحية لتنفيذ هذا الإجراء");
}

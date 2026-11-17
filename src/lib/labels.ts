// المصطلحات العربية المعتمدة لكل الحالات والتصنيفات

export type Tone = "gray" | "blue" | "green" | "orange" | "red" | "purple";

export const ROLE_LABELS: Record<string, string> = {
  ADMIN: "المدير العام",
  ACCOUNTANT: "المحاسب",
  PM: "مدير مشروع",
  CHAIRMAN: "المشرف الأعلى",
  AUDITOR: "مراقب ومدقق",
};

export const TENDER_STATUS: Record<string, { label: string; tone: Tone }> = {
  PURCHASED: { label: "تم شراء الوثائق", tone: "gray" },
  PRICING: { label: "قيد التسعير", tone: "blue" },
  SUBMITTED: { label: "تم تقديم العرض", tone: "purple" },
  NEGOTIATION: { label: "قيد التفاوض", tone: "orange" },
  WON: { label: "محال — الإحالة والتعاقد", tone: "green" },
  LOST: { label: "غير محال", tone: "red" },
  EXECUTION: { label: "قيد التنفيذ", tone: "blue" },
  MAINTENANCE: { label: "استلام ابتدائي — فترة الصيانة", tone: "purple" },
  CLOSED: { label: "مغلق - استلام نهائي", tone: "gray" },
  CANCELLED: { label: "ملغى", tone: "gray" },
};

export const PRE_AWARD_STATUSES = ["PURCHASED", "PRICING", "SUBMITTED", "NEGOTIATION"];
export const PROJECT_STATUSES = ["WON", "EXECUTION", "MAINTENANCE", "CLOSED"];
export const ACTIVE_PROJECT_STATUSES = ["WON", "EXECUTION", "MAINTENANCE"];

export const GUARANTEE_TYPE: Record<string, string> = {
  BID: "كفالة دخول",
  PERFORMANCE: "كفالة حسن تنفيذ",
  MAINTENANCE: "كفالة صيانة",
};

export const GUARANTEE_FORM: Record<string, { label: string; fee: number }> = {
  BANK_GUARANTEE: { label: "كفالة بنكية", fee: 15 },
  CERTIFIED_CHEQUE: { label: "شيك مصدق", fee: 5 },
};

export const GUARANTEE_STATUS: Record<string, { label: string; tone: Tone }> = {
  ISSUED: { label: "صادرة من البنك", tone: "blue" },
  SUBMITTED: { label: "مقدمة للجهة", tone: "orange" },
  RETRIEVED: { label: "مستردة من الجهة", tone: "purple" },
  RETURNED: { label: "معادة للبنك", tone: "gray" },
};

export const CLAIM_TYPE: Record<string, string> = { INTERIM: "مطالبة مرحلية", FINAL: "مطالبة نهائية" };

/**
 * دورة المطالبة: مدير المشروع يرسل ← المحاسب يدقق ويرفع للإدارة ← الإدارة توافق أو ترفض بالسبب
 * ← «تمت الموافقة — بانتظار الصرف» ← متابعة إجراءات الصرف لدى صاحب العمل ← تم الصرف (القبض)
 */
export const CLAIM_STATUS: Record<string, { label: string; tone: Tone }> = {
  DRAFT: { label: "لدى المحاسب — قيد التدقيق", tone: "gray" },
  READY: { label: "مرفوعة للإدارة — بانتظار الموافقة", tone: "purple" },
  REVIEW: { label: "مرفوعة للإدارة — بانتظار الموافقة", tone: "purple" },
  RETURNED: { label: "مرفوضة — معادة للتعديل", tone: "red" },
  SUBMITTED: { label: "تمت الموافقة — بانتظار الصرف", tone: "orange" },
  APPROVED: { label: "معتمدة من صاحب العمل — قيد الصرف", tone: "blue" },
  PAID: { label: "تم الصرف", tone: "green" },
  REJECTED: { label: "مرفوضة من صاحب العمل", tone: "red" },
}

/** مراحل متابعة الصرف لدى صاحب العمل (يحدّثها مدير المشروع أو المحاسب أو الإدارة) */
export const DISBURSE_STAGE: Record<string, { label: string; tone: Tone }> = {
  DELIVERED: { label: "سُلّمت لصاحب العمل", tone: "gray" },
  ENGINEER: { label: "قيد التدقيق لدى المهندس المشرف / الجهة", tone: "purple" },
  FINANCE: { label: "محالة للمالية / الخزينة", tone: "blue" },
  CHEQUE: { label: "صدر أمر الصرف / الشيك", tone: "green" },
  BLOCKED: { label: "متوقفة — يوجد معيق", tone: "red" },
};

export const CLAIM_EVENT: Record<string, string> = {
  submitted: "أرسلها مدير المشروع للمحاسب",
  resubmitted: "أعاد مدير المشروع تقديمها بعد التعديل",
  created: "أنشأها المحاسب",
  audited: "دققها المحاسب ورفعها للإدارة",
  invoice_mode: "اختار المحاسب نوع الفاتورة",
  einv_return: "أُرسلت فاتورة إرجاع لنظام الفوترة",
  einv_return_failed: "لم تُعتمد فاتورة الإرجاع",
  einv_return_requested: "طلب المحاسب إذن فاتورة إرجاع",
  einv_return_authorized: "كلّف المدير العام المحاسب بفاتورة إرجاع",
  einv_return_approved: "وافق المدير العام على فاتورة الإرجاع",
  einv_return_declined: "رفض المدير العام طلب فاتورة الإرجاع",
  einvoice_rejected: "رفض نظام الفوترة الفاتورة — أُعيدت للمحاسب مع الفاتورتين",
  invoice_edited: "عدّلت الإدارة الفاتورة",
  invoice_reset: "أعادت الإدارة الفاتورة للحساب التلقائي",
  withdrawn: "سحبها المحاسب للتعديل",
  returned: "أعادها المحاسب لمدير المشروع",
  rejected: "رفضتها الإدارة",
  reopened: "أُعيد فتحها للتدقيق",
  deduction: "تعديل الحسومات (المحاسب)",
  approved: "وافقت الإدارة — بانتظار الصرف",
  disbursement: "تحديث إجراءات الصرف",
  employer: "قرار صاحب العمل",
  paid: "تم الصرف وإيداع المبلغ",
  receipt: "سُجّل قبض الشيك / الحوالة (مع الصورة)",
  receipt_audited: "دقق المحاسب القبض ورفعه للإدارة",
  receipt_rejected: "رُفض القبض وأُعيد للتصحيح",
  einvoice: "اعتُمدت الفاتورة من نظام الفوترة الوطني",
  einvoice_pending: "الفاتورة الإلكترونية بانتظار الإرسال",
  einvoice_failed: "تعذر اعتماد الفاتورة من نظام الفوترة",
};

export const PAY_STAGE: Record<string, { label: string; tone: Tone }> = {
  RECEIVED: { label: "قُبض الشيك — بانتظار تدقيق المحاسب", tone: "orange" },
  AUDITED: { label: "دُقق القبض — بانتظار موافقة الإدارة", tone: "blue" },
  DONE: { label: "أُودع في البنك — مؤرشفة", tone: "green" },
};

export const EINV_STATUS: Record<string, { label: string; tone: Tone }> = {
  SUBMITTED: { label: "معتمدة من نظام الفوترة", tone: "green" },
  PENDING: { label: "بانتظار الإرسال للضريبة", tone: "orange" },
  FAILED: { label: "لم تصل لنظام الفوترة — أعد الإرسال", tone: "red" },
  REJECTED: { label: "رفضها نظام الفوترة — أُعيدت للمحاسب", tone: "red" },
};

export const EXPENSE_CATEGORY: Record<string, string> = {
  MATERIALS: "مواد بناء",
  LABOR: "أجور عمال",
  EQUIPMENT: "معدات وآليات",
  SUBCONTRACT: "مقاولو باطن",
  TRANSPORT: "نقل وتحميل",
  FUEL: "محروقات (ديزل)",
  MAINTENANCE: "صيانة آليات",
  MAINTENANCE_WORKS: "أعمال صيانة — فترة الكفالة",
  TESTS: "فحوصات مخبرية",
  TENDER_DOCS: "شراء وثائق عطاءات",
  BANK_FEES: "عمولات ورسوم بنكية",
  STAMP_FEES: "رسوم طوابع",
  GOVERNMENT: "رسوم حكومية",
  OFFICE: "مصاريف إدارية",
  OTHER: "أخرى",
};

export const PAYMENT_METHOD: Record<string, string> = {
  CUSTODY: "من العهدة",
  COMPANY: "حساب الشركة",
  CHEQUE: "شيك",
  INTERNAL: "تحميل داخلي (معدات الشركة)",
};

/** طرق الدفع المتاحة للإدخال اليدوي */
export const MANUAL_PAYMENT_METHOD: Record<string, string> = {
  CUSTODY: "من العهدة",
  COMPANY: "حساب الشركة",
  CHEQUE: "شيك",
};

export const SURVEY_STATUS: Record<string, { label: string; tone: Tone }> = {
  DRAFT: { label: "قيد الإعداد", tone: "orange" },
  SUBMITTED: { label: "مُرسل للمحاسب — مقفل", tone: "purple" },
  CLAIMED: { label: "صدرت منه مطالبة", tone: "green" },
};

export const REQUEST_KIND: Record<string, string> = { MATERIAL: "طلب مواد", CUSTODY: "طلب عهدة نقدية" };

export const REQUEST_STATUS: Record<string, { label: string; tone: Tone }> = {
  PENDING_AUDIT: { label: "بانتظار تدقيق المحاسب", tone: "orange" },
  PENDING_GM: { label: "بانتظار موافقة المدير العام", tone: "purple" },
  APPROVED: { label: "معتمد — بانتظار الصرف", tone: "blue" },
  FULFILLED: { label: "تم الصرف / التوريد", tone: "green" },
  REJECTED: { label: "مرفوض", tone: "red" },
};

export const REQUEST_PAYMENT: Record<string, string> = { CASH: "نقداً (عهدة)", CHEQUE: "شيك", SUPPLIER_CREDIT: "ذمة مورد (آجل)" };

export const WEATHER = ["مشمس", "غائم جزئياً", "غائم", "ماطر", "رياح شديدة", "عاصفة رملية", "بارد جداً", "حار جداً"];

export const VO_STATUS: Record<string, { label: string; tone: Tone }> = {
  PENDING: { label: "بانتظار الاعتماد", tone: "orange" },
  APPROVED: { label: "معتمد", tone: "green" },
  REJECTED: { label: "مرفوض", tone: "red" },
};

export const SUBCONTRACT_STATUS: Record<string, { label: string; tone: Tone }> = {
  ACTIVE: { label: "سارية", tone: "blue" },
  COMPLETED: { label: "منجزة", tone: "green" },
  TERMINATED: { label: "منهاة", tone: "gray" },
};

export const CERT_STATUS: Record<string, { label: string; tone: Tone }> = {
  SUBMITTED: { label: "مقدم", tone: "orange" },
  APPROVED: { label: "معتمد — بانتظار الدفع", tone: "blue" },
  PAID: { label: "مدفوع", tone: "green" },
  REJECTED: { label: "مرفوض", tone: "red" },
};

export const TRADES = ["أعمال الهيكل الخرساني", "القصارة", "البلاط", "الدهان", "الكهرباء", "التمديدات الصحية", "الألمنيوم", "النجارة", "الحدادة", "العزل", "الحفريات", "أخرى"];

export const EQUIPMENT_TYPES = ["حفارة", "باجر / لودر", "شاحنة نقل", "قلاب", "رافعة", "خلاطة خرسانة", "هزاز خرسانة", "مولد كهرباء", "طوبار خشب", "جكات / دعامات", "سقالات", "عدة يدوية", "أخرى"];

export const EQUIPMENT_STATUS: Record<string, { label: string; tone: Tone }> = {
  AVAILABLE: { label: "متاحة", tone: "green" },
  ASSIGNED: { label: "في موقع", tone: "blue" },
  MAINTENANCE: { label: "صيانة", tone: "orange" },
  RETIRED: { label: "خارج الخدمة", tone: "gray" },
};

export const OWNERSHIP: Record<string, string> = { OWNED: "ملك الشركة", RENTED: "مستأجرة" };

export const DIRECTION: Record<string, { label: string; tone: Tone; prefix: string }> = {
  OUT: { label: "صادر", tone: "blue", prefix: "ص" },
  IN: { label: "وارد", tone: "purple", prefix: "و" },
};

export const CHEQUE_STATUS: Record<string, { label: string; tone: Tone }> = {
  DEFERRED: { label: "مؤجل", tone: "orange" },
  CASHED: { label: "مدفوع / مصروف", tone: "green" },
  RETURNED: { label: "مرتجع", tone: "red" },
  CANCELLED: { label: "ملغى", tone: "gray" },
};

export const FUND_STATUS: Record<string, { label: string; tone: Tone }> = {
  PENDING: { label: "بانتظار الموافقة", tone: "orange" },
  APPROVED: { label: "تمت الموافقة", tone: "green" },
  REJECTED: { label: "مرفوض", tone: "red" },
};

export const BOQ_CATEGORY: Record<string, string> = {
  CONCRETE: "خرسانة",
  STEEL: "حديد تسليح",
  MASONRY: "طوب وبلوك",
  FINISHES: "تشطيبات وبلاط",
  PLASTER_PAINT: "قصارة ودهان",
  PLUMBING: "تمديدات صحية",
  WATER_HEATERS: "سخانات مياه",
  TANKS: "خزانات مياه",
  ELECTRICAL: "أعمال كهربائية",
  EARTHWORKS: "حفريات وردم",
  INSULATION: "عزل",
  DOORS_WINDOWS: "أبواب وشبابيك",
  OTHER: "أخرى",
};

export const BOQ_UNITS = ["م³", "م²", "م.ط", "طن", "كغم", "عدد", "مقطوعية", "نقطة", "لتر"];

export const BANK_TX_CATEGORY: Record<string, string> = {
  CAPITAL: "رأس مال / إيداع شركاء",
  CLAIM: "قبض مطالبة",
  CHEQUE: "صرف شيك",
  EXPENSE: "مصروف",
  FUND: "تمويل / عهدة",
  LOAN: "تسهيلات بنكية",
  LOAN_PAY: "سداد دين",
  OTHER: "أخرى",
};

/* ───────────── الديون الخارجية ───────────── */
export const LOAN_LENDER_TYPE: Record<string, string> = {
  BANK: "بنك / تسهيلات بنكية",
  PERSON: "شخص",
  COMPANY: "شركة",
  PARTNER: "شريك",
  SUPPLIER: "مورد (دين تجاري)",
  OTHER: "أخرى",
};
export const LOAN_STATUS: Record<string, { label: string; tone: Tone }> = {
  ACTIVE: { label: "قائم", tone: "orange" },
  SETTLED: { label: "مسدد بالكامل", tone: "green" },
};
export const LOAN_FREQUENCY: Record<string, string> = {
  ONCE: "دفعة واحدة",
  MONTHLY: "شهري",
  QUARTERLY: "كل 3 أشهر",
  SEMIANNUAL: "كل 6 أشهر",
  ANNUAL: "سنوي",
};
export const LOAN_FREQUENCY_MONTHS: Record<string, number> = { ONCE: 0, MONTHLY: 1, QUARTERLY: 3, SEMIANNUAL: 6, ANNUAL: 12 };
export const LOAN_RECEIVED_VIA: Record<string, string> = {
  BANK: "إيداع في حساب الشركة البنكي",
  CASH: "نقداً (خارج الحساب البنكي)",
  DIRECT: "دُفع مباشرة لجهة نيابة عن الشركة",
};
export const LOAN_INTEREST_TYPE: Record<string, string> = {
  NONE: "بدون فائدة",
  PERCENT: "نسبة سنوية %",
  FIXED: "مبلغ مقطوع",
};
export const LOAN_PAY_METHOD: Record<string, string> = {
  BANK: "تحويل / خصم من حساب الشركة",
  CHEQUE: "شيك (يُخصم من الحساب)",
  CASH: "نقداً (خارج الحساب البنكي)",
};

export const DOCUMENT_TYPE: Record<string, string> = {
  CLASSIFICATION: "شهادة التصنيف",
  COMMERCIAL_REGISTER: "السجل التجاري",
  PROFESSION_LICENSE: "رخصة المهن",
  CHAMBER: "عضوية غرفة التجارة / الصناعة",
  CONTRACTORS_UNION: "عضوية نقابة المقاولين",
  TAX: "شهادة ضريبية",
  SOCIAL_SECURITY: "براءة ذمة الضمان الاجتماعي",
  INSURANCE: "بوليصة تأمين",
  VEHICLE_LICENSE: "ترخيص مركبة / آلية",
  BANK: "وثائق بنكية",
  OTHER: "أخرى",
};

/** مسار اعتماد الكتاب الرسمي الصادر: مدير المشروع ← المحاسب ← المدير العام ← جاهز للطباعة */
export const LETTER_STATUS: Record<string, { label: string; tone: Tone }> = {
  PENDING_ACCOUNTANT: { label: "بانتظار المحاسب", tone: "orange" },
  PENDING_ADMIN: { label: "بانتظار المدير العام", tone: "purple" },
  RETURNED: { label: "مُعاد للتعديل", tone: "red" },
  APPROVED: { label: "معتمد — جاهز للطباعة", tone: "green" },
};

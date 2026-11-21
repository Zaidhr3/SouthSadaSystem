/**
 * قالب الكتالوج المبدئي «من العظم إلى المفتاح» — أسعار تقديرية للبدء فقط (د.أ، توريد وتركيب)،
 * تُراجع وتُعدَّل كلها من شاشة الكتالوج قبل اعتمادها لأي مشروع. لا تُسحب أي أسعار خارجية تلقائياً.
 * price = سعر البيع للمالك؛ تُقسم إلى كلفة (85%) وهامش (15%) ويمكن تعديل كل منهما.
 */
type Seed = {
  code: string;
  phase: string;
  category: string;
  name: string;
  specs?: string;
  unit: string;
  price: number;
  mode: "INCLUDED" | "REQUIRED" | "OPTION";
  group?: string;
  perSqm?: number;
  qty?: number;
  editable?: boolean;
};

export const CATALOG_SEED: Seed[] = [
  // 1) الأرض والعظم والهيكل الإنشائي — ضمن سعر العظم (للشفافية)
  { code: "L01", phase: "LAND_SKELETON", category: "حصة الأرض", name: "حصة الأرض والتسوية والكراجات", specs: "تُحدَّد لكل مشروع حسب الطابق والواجهة — محسوبة ضمن سعر العظم", unit: "م²", price: 0, mode: "INCLUDED", perSqm: 1 },
  { code: "L02", phase: "LAND_SKELETON", category: "الحفر والأساسات", name: "الحفر والأساسات والجدران الاستنادية", specs: "حفر وردم ودك، أساسات منفصلة/حصيرة حسب التقرير الجيوتقني، جدران استنادية خرسانية", unit: "م²", price: 38, mode: "INCLUDED", perSqm: 1 },
  { code: "L03", phase: "LAND_SKELETON", category: "العزل", name: "العزل المائي والحراري للأساسات والسطح", specs: "رولات بيتومين 4 مم للأساسات + عزل سطح مع طبقة حماية وميلان تصريف", unit: "م²", price: 9, mode: "INCLUDED", perSqm: 1 },
  { code: "L04", phase: "LAND_SKELETON", category: "الهيكل الخرساني", name: "الأعمدة والجسور والعقدات والدرج", specs: "خرسانة جاهزة B300 مع حديد تسليح، عقدات ريبس/هوردي أو مصمتة حسب التصميم الإنشائي", unit: "م²", price: 95, mode: "INCLUDED", perSqm: 1 },
  { code: "L05", phase: "LAND_SKELETON", category: "الهيكل الخرساني", name: "بيت الدرج وتأسيس المصعد", specs: "حصة الشقة من الدرج المشترك وبئر المصعد", unit: "م²", price: 6, mode: "INCLUDED", perSqm: 1 },

  // 2) الواجهات والأعمال الخارجية
  { code: "F01", phase: "FACADE", category: "الحجر", name: "حجر واجهات أردني", specs: "حجر معان/عجلون مسمسم أو مفجّر سماكة 5–7 سم مع ربط وتكحيل", unit: "م²", price: 32, mode: "INCLUDED", perSqm: 0.6 },
  { code: "F02", phase: "FACADE", category: "القصارة الخارجية", name: "قصارة خارجية للأجزاء غير المحجّرة", unit: "م²", price: 6, mode: "INCLUDED", perSqm: 0.3 },
  { code: "F03", phase: "FACADE", category: "العزل الحراري", name: "عزل حراري للجدران الخارجية", specs: "ألواح بوليسترين 5 سم بين الحجر والطوب", unit: "م²", price: 7, mode: "INCLUDED", perSqm: 0.6 },
  { code: "F04", phase: "FACADE", category: "الشبابيك والألمنيوم", name: "شبابيك ألمنيوم سحاب دبل جلاس", specs: "قطاعات ألمنيوم محلية مع زجاج مزدوج 4+12+4 ومنخل", unit: "م²", price: 58, mode: "REQUIRED", group: "WINDOWS", perSqm: 0.14 },
  { code: "F05", phase: "FACADE", category: "الشبابيك والألمنيوم", name: "شبابيك ألمنيوم قطع حراري (Thermal Break)", specs: "قطاعات قطع حراري مع زجاج مزدوج عاكس — عزل أعلى للحرارة والصوت", unit: "م²", price: 85, mode: "OPTION", group: "WINDOWS", perSqm: 0.14 },
  { code: "F06", phase: "FACADE", category: "الدرابزين والمداخل", name: "درابزين البلكونات والدرج", specs: "حديد مشغول أو زجاج سكريت مع قبضة ستانلس", unit: "م.ط", price: 45, mode: "INCLUDED", qty: 6 },
  { code: "F07", phase: "FACADE", category: "الدرابزين والمداخل", name: "المدخل الرئيسي والبهو المشترك", specs: "حصة الشقة من تشطيب المدخل والإنارة الخارجية", unit: "مقطوعية", price: 350, mode: "INCLUDED", qty: 1 },

  // 3) التأسيسات الكهروميكانيكية
  { code: "M01", phase: "MEP", category: "الكهرباء", name: "تمديدات كهرباء كاملة (أنابيب وأسلاك)", specs: "أنابيب PVC وأسلاك نحاس حسب كود الكهرباء الأردني — لكل نقطة إنارة/فيش", unit: "نقطة", price: 22, mode: "REQUIRED", perSqm: 0.55 },
  { code: "M02", phase: "MEP", category: "الكهرباء", name: "طبلون كهرباء رئيسي مع القواطع", specs: "قواطع مع حماية تسريب أرضي RCD", unit: "قطعة", price: 280, mode: "REQUIRED", qty: 1 },
  { code: "M03", phase: "MEP", category: "التكييف", name: "تأسيس تكييف (نقطة نحاس وتصريف)", specs: "مواسير نحاس معزولة مع تصريف وكهرباء مستقلة لكل وحدة", unit: "نقطة", price: 75, mode: "OPTION", qty: 4, editable: true },
  { code: "M04", phase: "MEP", category: "التدفئة", name: "تدفئة أرضية (أنابيب PEX مع مجمعات)", specs: "أنابيب PEX مع عزل ومجمعات توزيع لكل غرفة", unit: "م²", price: 28, mode: "OPTION", group: "HEATING", perSqm: 0.85 },
  { code: "M05", phase: "MEP", category: "التدفئة", name: "تدفئة مركزية بالرديترات", specs: "رديترات ألمنيوم مع تمديدات وصمامات حرارية", unit: "م²", price: 22, mode: "OPTION", group: "HEATING", perSqm: 0.85 },
  { code: "M06", phase: "MEP", category: "التدفئة", name: "بويلر تدفئة مع مضخات وخزان تمدد", unit: "طقم", price: 1450, mode: "OPTION", qty: 1 },
  { code: "M07", phase: "MEP", category: "الصحي", name: "تمديدات صحية (مياه حار/بارد وصرف)", specs: "لكل منطقة رطبة (حمام أو مطبخ أو غسيل): مواسير PPR وصرف UPVC", unit: "طقم", price: 520, mode: "REQUIRED", qty: 3, editable: true },
  { code: "M08", phase: "MEP", category: "الخزانات", name: "خزان مياه ستانلس ستيل 304 سعة 2 م³", specs: "ستانلس 304 صالح لمياه الشرب مع قاعدة ووصلات", unit: "قطعة", price: 720, mode: "REQUIRED", group: "TANK", qty: 1 },
  { code: "M09", phase: "MEP", category: "الخزانات", name: "خزان مياه بولي إيثيلين سعة 2 م³", unit: "قطعة", price: 260, mode: "OPTION", group: "TANK", qty: 1 },
  { code: "M10", phase: "MEP", category: "الطاقة", name: "سخان شمسي مع لوحين", unit: "طقم", price: 650, mode: "OPTION", qty: 1 },
  { code: "M11", phase: "MEP", category: "الكهرباء", name: "تأسيس إنترنت وتلفزيون وإنتركم", unit: "نقطة", price: 18, mode: "OPTION", qty: 6, editable: true },

  // 4) القصارة والأرضيات والبلاط
  { code: "P01", phase: "PLASTER_FLOOR", category: "القصارة", name: "قصارة داخلية (طبقتين مع زوايا)", specs: "جدران وأسقف — زوايا معدنية وشبك عند الالتقاءات", unit: "م²", price: 4.2, mode: "REQUIRED", perSqm: 3.2 },
  { code: "P02", phase: "PLASTER_FLOOR", category: "الأرضيات", name: "بورسلان أرضيات 60×120 درجة أولى", specs: "بورسلان مطفي/لامع مع لاصق ومسافات منتظمة", unit: "م²", price: 18, mode: "REQUIRED", group: "FLOOR", perSqm: 0.85 },
  { code: "P03", phase: "PLASTER_FLOOR", category: "الأرضيات", name: "سيراميك أرضيات 60×60", unit: "م²", price: 12, mode: "OPTION", group: "FLOOR", perSqm: 0.85 },
  { code: "P04", phase: "PLASTER_FLOOR", category: "الأرضيات", name: "رخام أرضيات محلي (جلالة/سلطاني)", specs: "رخام مع جلي وتلميع بعد التركيب", unit: "م²", price: 38, mode: "OPTION", group: "FLOOR", perSqm: 0.85 },
  { code: "P05", phase: "PLASTER_FLOOR", category: "الأرضيات", name: "باركيه HDF مقاوم للرطوبة (غرف النوم)", unit: "م²", price: 20, mode: "OPTION", perSqm: 0.3 },
  { code: "P06", phase: "PLASTER_FLOOR", category: "البلاط", name: "بلاط حمام جدران وأرضيات (للحمام الواحد)", specs: "حتى السقف مع زوايا ألمنيوم", unit: "طقم", price: 650, mode: "REQUIRED", qty: 2, editable: true },
  { code: "P07", phase: "PLASTER_FLOOR", category: "البلاط", name: "بلاط جدران المطبخ (بين الخزائن)", unit: "م²", price: 16, mode: "REQUIRED", qty: 8 },
  { code: "P08", phase: "PLASTER_FLOOR", category: "البلاط", name: "نعّالات", unit: "م.ط", price: 4.5, mode: "REQUIRED", perSqm: 0.9 },

  // 5) الدهانات والأسقف والجبصين
  { code: "C01", phase: "PAINT_CEIL", category: "الدهانات", name: "معجونة 3 وجوه + دهان بلاستيك داخلي", specs: "معجونة وصنفرة ووجه أساس ووجهي دهان — اختيار الألوان من كتالوج الدهان", unit: "م²", price: 3.6, mode: "REQUIRED", group: "PAINT", perSqm: 2.8 },
  { code: "C02", phase: "PAINT_CEIL", category: "الدهانات", name: "دهان داخلي فاخر قابل للغسل (مطفي/سلك)", unit: "م²", price: 5.2, mode: "OPTION", group: "PAINT", perSqm: 2.8 },
  { code: "C03", phase: "PAINT_CEIL", category: "الجبصين", name: "أسقف جبصين بورد مع إطار معدني", specs: "جبصين بورد 12.5 مم، أسقف معلقة ومستويات للصالة والممرات", unit: "م²", price: 14, mode: "OPTION", perSqm: 0.35 },
  { code: "C04", phase: "PAINT_CEIL", category: "الإنارة المخفية", name: "إنارة مخفية (بروفايل LED)", unit: "م.ط", price: 9, mode: "OPTION", perSqm: 0.25 },
  { code: "C05", phase: "PAINT_CEIL", category: "الدهانات", name: "دهان خارجي للبلكونات", unit: "م²", price: 4, mode: "INCLUDED", qty: 20 },

  // 6) الأبواب والنجارة والمطابخ
  { code: "D01", phase: "DOORS_KITCHEN", category: "الباب الرئيسي", name: "باب رئيسي أمان فولاذ", specs: "فولاذ مع قفل متعدد النقاط وعين سحرية", unit: "قطعة", price: 520, mode: "REQUIRED", group: "MAIN_DOOR", qty: 1 },
  { code: "D02", phase: "DOORS_KITCHEN", category: "الباب الرئيسي", name: "باب رئيسي فاخر مصفّح بتلبيس خشب", unit: "قطعة", price: 950, mode: "OPTION", group: "MAIN_DOOR", qty: 1 },
  { code: "D03", phase: "DOORS_KITCHEN", category: "الأبواب الداخلية", name: "باب داخلي MDF مع حلق ومفصلات", specs: "شامل الإطار والمسكات والقفل", unit: "قطعة", price: 165, mode: "REQUIRED", group: "INT_DOOR", qty: 6, editable: true },
  { code: "D04", phase: "DOORS_KITCHEN", category: "الأبواب الداخلية", name: "باب داخلي خشب طبيعي (زان/سنديان)", unit: "قطعة", price: 260, mode: "OPTION", group: "INT_DOOR", qty: 6, editable: true },
  { code: "D05", phase: "DOORS_KITCHEN", category: "المطابخ", name: "مطبخ MDF مع سطح جرانيت", specs: "خزائن علوية وسفلية — السعر للمتر الطولي", unit: "م.ط", price: 210, mode: "OPTION", group: "KITCHEN", qty: 6, editable: true },
  { code: "D06", phase: "DOORS_KITCHEN", category: "المطابخ", name: "مطبخ أكريليك مع سطح كوارتز", unit: "م.ط", price: 320, mode: "OPTION", group: "KITCHEN", qty: 6, editable: true },
  { code: "D07", phase: "DOORS_KITCHEN", category: "النجارة", name: "خزائن حائط لغرف النوم", unit: "م.ط", price: 180, mode: "OPTION", qty: 3, editable: true },

  // 7) الأدوات الصحية والكهربائيات النهائية والتسليم
  { code: "X01", phase: "FIXTURES_HANDOVER", category: "الأدوات الصحية", name: "طقم حمام كامل (مغسلة، مرحاض معلّق، خلاطات)", unit: "طقم", price: 480, mode: "REQUIRED", group: "BATH_SET", qty: 2, editable: true },
  { code: "X02", phase: "FIXTURES_HANDOVER", category: "الأدوات الصحية", name: "طقم حمام فاخر (أوروبي)", unit: "طقم", price: 950, mode: "OPTION", group: "BATH_SET", qty: 2, editable: true },
  { code: "X03", phase: "FIXTURES_HANDOVER", category: "الأدوات الصحية", name: "شاور بوكس زجاج سكريت 8 مم", unit: "قطعة", price: 260, mode: "OPTION", qty: 1, editable: true },
  { code: "X04", phase: "FIXTURES_HANDOVER", category: "الكهربائيات", name: "مفاتيح وأفياش", specs: "لكل نقطة كهرباء مؤسسة", unit: "نقطة", price: 4.5, mode: "REQUIRED", perSqm: 0.55 },
  { code: "X05", phase: "FIXTURES_HANDOVER", category: "الكهربائيات", name: "سبوتات LED", unit: "قطعة", price: 7, mode: "OPTION", qty: 20, editable: true },
  { code: "X06", phase: "FIXTURES_HANDOVER", category: "التسليم", name: "التنظيف النهائي للشقة", unit: "مقطوعية", price: 120, mode: "REQUIRED", qty: 1 },
  { code: "X07", phase: "FIXTURES_HANDOVER", category: "التسليم", name: "فحص الاستلام الهندسي", specs: "فحص كهرباء وصحي وعزل وتشطيب بقائمة تدقيق موقّعة", unit: "مقطوعية", price: 0, mode: "REQUIRED", qty: 1 },
  { code: "X08", phase: "FIXTURES_HANDOVER", category: "التسليم", name: "محضر التسليم وتسليم المفتاح «مفتاح الشقة»", unit: "مقطوعية", price: 0, mode: "REQUIRED", qty: 1 },
];

export const seedRow = (s: Seed, i: number) => {
  const unitCost = Math.round(s.price * 0.85 * 100) / 100;
  return {
    code: s.code,
    phase: s.phase,
    category: s.category,
    name: s.name,
    specs: s.specs ?? null,
    unit: s.unit,
    unitCost,
    margin: Math.round((s.price - unitCost) * 100) / 100,
    mode: s.mode,
    choiceGroup: s.group ?? null,
    qtyPerSqm: s.perSqm ?? 0,
    defaultQty: s.qty ?? 1,
    qtyEditable: !!s.editable,
    sortOrder: i,
  };
};

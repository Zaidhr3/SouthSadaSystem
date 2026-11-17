/**
 * بيانات تجريبية واقعية لشركة صدى الجنوب للمقاولات (2018 – 2026)
 * التواريخ النشطة محسوبة نسبة لتاريخ اليوم كي تعمل التنبيهات مباشرة.
 * تشغيل: npm run db:demo   (يمسح البيانات الحالية! للتجربة والتدريب فقط)
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { normalizeText } from "../src/lib/text";

const db = new PrismaClient();

// ───────── أدوات ─────────
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const todayStr = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Amman", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const TODAY = new Date(`${todayStr}T00:00:00.000Z`);
const rel = (days: number) => new Date(TODAY.getTime() + days * 86400000);
const ymd = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
let seed = 42;
const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const between = (a: number, b: number) => a + rand() * (b - a);

// ───────── مكتبة المواد وأسعارها عبر السنوات ─────────
type Mat = { key: string; desc: string; cat: string; unit: string; p2018: number; p2026: number; supplier?: string; specs?: string };
const MATS: Mat[] = [
  { key: "steel", desc: "حديد تسليح محلي مطابق للمواصفة الأردنية (توريد وتركيب)", cat: "STEEL", unit: "طن", p2018: 520, p2026: 735, supplier: "حديد الأردن" },
  { key: "b300", desc: "خرسانة جاهزة B300 للأساسات والأعمدة والجسور", cat: "CONCRETE", unit: "م³", p2018: 48, p2026: 62, supplier: "خرسانة الجنوب الجاهزة" },
  { key: "b250", desc: "خرسانة جاهزة B250 للأرضيات والبلاطات", cat: "CONCRETE", unit: "م³", p2018: 44, p2026: 57 },
  { key: "b150", desc: "خرسانة نظافة B150 تحت الأساسات", cat: "CONCRETE", unit: "م³", p2018: 36, p2026: 45 },
  { key: "block15", desc: "طوب إسمنتي مفرغ 15 سم للجدران الداخلية", cat: "MASONRY", unit: "م²", p2018: 7.5, p2026: 10 },
  { key: "block20", desc: "طوب إسمنتي مفرغ 20 سم للجدران الخارجية", cat: "MASONRY", unit: "م²", p2018: 8.5, p2026: 11.5 },
  { key: "plaster", desc: "قصارة داخلية ثلاث وجوه مع الزوايا المعدنية", cat: "PLASTER_PAINT", unit: "م²", p2018: 4.2, p2026: 5.6 },
  { key: "paint", desc: "دهان داخلي إملشن ثلاثة وجوه مع المعجونة", cat: "PLASTER_PAINT", unit: "م²", p2018: 2.4, p2026: 3.4 },
  { key: "porcelain", desc: "بلاط بورسلان 60×60 سم درجة أولى مع التركيب", cat: "FINISHES", unit: "م²", p2018: 14, p2026: 19 },
  { key: "ariston80", desc: "سخان مياه كهربائي أريستون 80 لتر عمودي", cat: "WATER_HEATERS", unit: "عدد", p2018: 95, p2026: 128, supplier: "الوكيل المعتمد لأريستون - عمان", specs: "Ariston PRO1 R 80V — 1.8 كيلوواط — ضمان 5 سنوات" },
  { key: "ariston50", desc: "سخان مياه كهربائي أريستون 50 لتر", cat: "WATER_HEATERS", unit: "عدد", p2018: 78, p2026: 105, supplier: "الوكيل المعتمد لأريستون - عمان", specs: "Ariston PRO1 R 50V" },
  { key: "solar", desc: "سخان شمسي 200 لتر مع لوحين وقاعدة مجلفنة", cat: "WATER_HEATERS", unit: "عدد", p2018: 360, p2026: 470 },
  { key: "grp", desc: "خزان مياه GRP مقطعي سعة 2 م³ مع القاعدة", cat: "TANKS", unit: "عدد", p2018: 310, p2026: 420, specs: "فايبرغلاس مقطعي معزول" },
  { key: "stainless", desc: "خزان مياه ستانلس ستيل سعة 1.5 م³", cat: "TANKS", unit: "عدد", p2018: 420, p2026: 610, specs: "ستانلس ستيل 304 — سماكة 1 ملم" },
  { key: "poly", desc: "خزان مياه بولي إيثيلين ثلاث طبقات سعة 2 م³", cat: "TANKS", unit: "عدد", p2018: 140, p2026: 185 },
  { key: "light", desc: "نقطة إنارة كاملة مع التمديدات والمفتاح", cat: "ELECTRICAL", unit: "نقطة", p2018: 9, p2026: 13 },
  { key: "socket", desc: "نقطة أبريز 16 أمبير مع التمديدات", cat: "ELECTRICAL", unit: "نقطة", p2018: 10, p2026: 14 },
  { key: "excav", desc: "حفريات أساسات في تربة عادية مع الترحيل", cat: "EARTHWORKS", unit: "م³", p2018: 3.5, p2026: 5 },
  { key: "bitumen", desc: "عزل أسطح بالبيتومين مع طبقة حماية خرسانية", cat: "INSULATION", unit: "م²", p2018: 6, p2026: 8.5 },
  { key: "door", desc: "باب خشب داخلي مع الحلق والإكسسوارات", cat: "DOORS_WINDOWS", unit: "عدد", p2018: 150, p2026: 210 },
  { key: "window", desc: "شباك ألمنيوم سحاب مع زجاج مزدوج", cat: "DOORS_WINDOWS", unit: "م²", p2018: 55, p2026: 78 },
  { key: "wc", desc: "تمديدات صحية لوحدة حمام كاملة مع الأطقم", cat: "PLUMBING", unit: "مقطوعية", p2018: 380, p2026: 520 },
];

const STEEL_BY_YEAR: Record<number, number> = { 2018: 520, 2019: 540, 2020: 565, 2021: 690, 2022: 820, 2023: 765, 2024: 705, 2025: 715, 2026: 735 };

function priceFor(m: Mat, year: number) {
  if (m.key === "steel") return r3(STEEL_BY_YEAR[year] * between(0.98, 1.02));
  const t = (year - 2018) / 8;
  const spike = year === 2022 ? 1.06 : year === 2021 ? 1.03 : 1;
  return r3((m.p2018 + (m.p2026 - m.p2018) * t) * spike * between(0.97, 1.03));
}

// ───────── المشاريع ─────────
type Plan = {
  name: string;
  number: string;
  entity: string;
  location: string;
  year: number;
  month: number;
  status: string;
  mgr: "zaid" | "emad" | "ahmad" | null;
  mats: [string, number][]; // key, qty
  discount?: number;
  progress?: number;
  rel?: { purchase: number; deadline: number; site?: number; result?: number; commence?: number; prelim?: number };
};

const PLANS: Plan[] = [
  { name: "إنشاء مدرسة ذيبان الأساسية المختلطة", number: "ع/ت/2018/14", entity: "وزارة التربية والتعليم", location: "مادبا - ذيبان", year: 2018, month: 3, status: "CLOSED", mgr: "zaid", mats: [["excav", 900], ["b150", 60], ["b300", 420], ["steel", 48], ["block20", 1100], ["block15", 700], ["plaster", 3200], ["paint", 3200], ["porcelain", 950], ["light", 160], ["ariston80", 4], ["grp", 3]] },
  { name: "صيانة وتأهيل مركز صحي الحسا", number: "ص/2019/33", entity: "وزارة الصحة", location: "الطفيلة - الحسا", year: 2019, month: 5, status: "LOST", mgr: null, mats: [["plaster", 900], ["paint", 1600], ["porcelain", 300], ["ariston50", 6], ["stainless", 2], ["light", 60], ["socket", 40], ["wc", 4]] },
  { name: "إنشاء مسجد بلدة العيص", number: "أوقاف/2020/7", entity: "وزارة الأوقاف والشؤون والمقدسات الإسلامية", location: "الطفيلة - العيص", year: 2020, month: 2, status: "CLOSED", mgr: "emad", mats: [["excav", 450], ["b150", 30], ["b300", 210], ["steel", 24], ["block20", 650], ["plaster", 1500], ["paint", 1500], ["porcelain", 420], ["ariston80", 2], ["poly", 2], ["light", 70], ["bitumen", 380]] },
  { name: "توسعة مدرسة غور الصافي الثانوية للبنين", number: "أ ع/2021/118", entity: "وزارة الأشغال العامة والإسكان", location: "الكرك - غور الصافي", year: 2021, month: 4, status: "CLOSED", mgr: "ahmad", mats: [["excav", 600], ["b150", 40], ["b300", 300], ["b250", 120], ["steel", 34], ["block20", 800], ["block15", 500], ["plaster", 2400], ["paint", 2400], ["porcelain", 700], ["window", 140], ["door", 18], ["ariston80", 3], ["grp", 2], ["light", 120], ["socket", 80]] },
  { name: "إنشاء مركز شباب الشوبك", number: "شباب/2022/21", entity: "وزارة الشباب", location: "معان - الشوبك", year: 2022, month: 6, status: "LOST", mgr: null, mats: [["excav", 500], ["b300", 260], ["steel", 30], ["block20", 700], ["plaster", 1900], ["paint", 1900], ["porcelain", 520], ["solar", 2], ["stainless", 2], ["light", 90]] },
  { name: "إنشاء مبنى بلدية القطرانة", number: "ب ق/2023/4", entity: "بلدية القطرانة", location: "الكرك - القطرانة", year: 2023, month: 3, status: "MAINTENANCE", mgr: "emad", mats: [["excav", 520], ["b150", 35], ["b300", 280], ["steel", 31], ["block20", 760], ["block15", 400], ["plaster", 2100], ["paint", 2100], ["porcelain", 600], ["window", 110], ["door", 14], ["ariston50", 4], ["grp", 2], ["light", 110], ["socket", 70], ["bitumen", 600]] },
  { name: "صيانة وتأهيل مدارس لواء المزار الجنوبي", number: "ت ت/2024/62", entity: "وزارة التربية والتعليم", location: "الكرك - المزار الجنوبي", year: 2024, month: 2, status: "MAINTENANCE", mgr: "ahmad", mats: [["plaster", 2600], ["paint", 5200], ["porcelain", 800], ["ariston80", 8], ["ariston50", 6], ["stainless", 4], ["light", 240], ["socket", 160], ["wc", 10], ["door", 30], ["bitumen", 1800]] },
  { name: "إنشاء مركز صحي الطفيلة الشامل — المرحلة الأولى", number: "أ ع/2025/39", entity: "وزارة الأشغال العامة والإسكان", location: "الطفيلة", year: 2025, month: 4, status: "EXECUTION", mgr: "emad", progress: 72, mats: [["excav", 1300], ["b150", 80], ["b300", 640], ["b250", 220], ["steel", 72], ["block20", 1500], ["block15", 1100], ["plaster", 4600], ["paint", 4600], ["porcelain", 1500], ["window", 220], ["door", 40], ["ariston80", 6], ["solar", 4], ["stainless", 4], ["grp", 4], ["light", 340], ["socket", 260], ["wc", 12], ["bitumen", 1200]] },
  { name: "إنشاء غرف صفية إضافية — مدرسة معان الثانوية للبنات", number: "ت ت/2025/88", entity: "وزارة التربية والتعليم", location: "معان", year: 2025, month: 9, status: "EXECUTION", mgr: "ahmad", progress: 38, mats: [["excav", 380], ["b150", 25], ["b300", 190], ["steel", 22], ["block20", 520], ["block15", 300], ["plaster", 1400], ["paint", 1400], ["porcelain", 420], ["window", 80], ["door", 10], ["ariston50", 2], ["poly", 2], ["light", 90], ["socket", 60]] },
  { name: "إنشاء مدرسة الحسا الأساسية المختلطة", number: "أ ع/2026/45", entity: "وزارة الأشغال العامة والإسكان", location: "الطفيلة - الحسا", year: 2026, month: 0, status: "WON", mgr: "zaid", progress: 0, discount: 100, rel: { purchase: -75, deadline: -45, site: -55, result: -12 }, mats: [["excav", 1000], ["b150", 65], ["b300", 470], ["steel", 53], ["block20", 1200], ["block15", 800], ["plaster", 3500], ["paint", 3500], ["porcelain", 1050], ["window", 160], ["door", 24], ["ariston80", 5], ["stainless", 3], ["light", 180], ["socket", 130], ["wc", 6]] },
  { name: "إنشاء مبنى مديرية زراعة الكرك", number: "د ع ح/2026/112", entity: "دائرة العطاءات الحكومية", location: "الكرك - المرج", year: 2026, month: 0, status: "SUBMITTED", mgr: null, rel: { purchase: -40, deadline: -6, site: -25 }, mats: [["excav", 700], ["b150", 45], ["b300", 330], ["steel", 37], ["block20", 900], ["plaster", 2500], ["paint", 2500], ["porcelain", 700], ["ariston80", 3], ["grp", 2], ["light", 140]] },
  { name: "تأهيل وصيانة مركز صحي الربة", number: "ص/2026/19", entity: "وزارة الصحة", location: "الكرك - الربة", year: 2026, month: 0, status: "NEGOTIATION", mgr: null, rel: { purchase: -50, deadline: -20, site: -35 }, mats: [["plaster", 800], ["paint", 1500], ["porcelain", 260], ["ariston50", 4], ["stainless", 1], ["light", 50], ["socket", 40], ["wc", 3]] },
  { name: "صيانة مبنى متصرفية لواء القصر", number: "أ ع/2026/131", entity: "وزارة الأشغال العامة والإسكان", location: "الكرك - القصر", year: 2026, month: 0, status: "PRICING", mgr: null, rel: { purchase: -14, deadline: 2, site: 1 }, mats: [["plaster", 600], ["paint", 1300], ["ariston80", 2], ["light", 45]] },
  { name: "إنشاء سور واستراحة حديقة العقبة العامة", number: "سلطة/2026/77", entity: "سلطة منطقة العقبة الاقتصادية الخاصة", location: "العقبة", year: 2026, month: 0, status: "PURCHASED", mgr: null, rel: { purchase: -3, deadline: 12, site: 3 }, mats: [] },
];

const CUSTODY_CATS: [string, number][] = [["LABOR", 0.5], ["TRANSPORT", 0.15], ["FUEL", 0.15], ["MATERIALS", 0.2]];
const COMPANY_CATS: [string, number][] = [["MATERIALS", 0.62], ["SUBCONTRACT", 0.22], ["EQUIPMENT", 0.12], ["TESTS", 0.04]];

async function main() {
  console.log("⏳ مسح البيانات الحالية...");
  await db.auditLog.deleteMany();
  await db.notificationEvent.deleteMany();
  await db.emailLog.deleteMany();
  await db.subcontractCertificate.deleteMany();
  await db.subcontract.deleteMany();
  await db.subcontractor.deleteMany();
  await db.variationOrder.deleteMany();
  await db.materialReceipt.deleteMany();
  await db.equipmentLog.deleteMany();
  await db.equipment.deleteMany();
  await db.correspondence.deleteMany();
  await db.notificationDismissal.deleteMany();
  await db.attachment.deleteMany();
  await db.bankTransaction.deleteMany();
  await db.fundRequest.deleteMany();
  await db.expense.deleteMany();
  await db.cheque.deleteMany();
  await db.claim.deleteMany();
  await db.guarantee.deleteMany();
  await db.boqItem.deleteMany();
  await db.tender.deleteMany();
  await db.companyDocument.deleteMany();
  await db.user.deleteMany();

  console.log("👥 المستخدمون...");
  const pw = (p: string) => bcrypt.hashSync(p, 10);
  const zaid = await db.user.create({ data: { username: "zaid", name: "م. زيد محمد جبر الهريني", title: "المدير العام", role: "ADMIN", passwordHash: pw("Admin@2026") } });
  const accountant = await db.user.create({ data: { username: "accountant", name: "محاسب الشركة", title: "المحاسب", role: "ACCOUNTANT", passwordHash: pw("Sada@2026") } });
  const emad = await db.user.create({ data: { username: "emad", name: "م. عماد", title: "مدير مشاريع", role: "PM", passwordHash: pw("Sada@2026") } });
  const ahmad = await db.user.create({ data: { username: "ahmad", name: "م. أحمد", title: "مدير مشاريع", role: "PM", passwordHash: pw("Sada@2026") } });
  const users = { zaid, emad, ahmad };

  // رأس المال الافتتاحي
  await db.bankTransaction.create({ data: { date: ymd(2018, 1, 2), type: "IN", amount: 120000, description: "رأس المال الافتتاحي — إيداع الشركاء", category: "CAPITAL" } });
  await db.bankTransaction.create({ data: { date: ymd(2024, 1, 15), type: "IN", amount: 60000, description: "تسهيلات بنكية جارية مدينة — البنك العربي", category: "LOAN" } });

  async function companyExpense(tenderId: number, category: string, amount: number, date: Date, description: string, by: number, autoSource?: string) {
    const e = await db.expense.create({ data: { tenderId, category, amount: r3(amount), date, description, paymentMethod: "COMPANY", createdById: by, autoSource } });
    await db.bankTransaction.create({ data: { date, type: "OUT", amount: e.amount, description: `${description}`, category: "EXPENSE", tenderId, sourceType: "EXPENSE", sourceId: e.id } });
    return e;
  }

  async function guarantee(tenderId: number, number: string, g: { type: string; form: string; amount: number; issue: Date; expiry: Date | null; status: string; submitted?: Date; retrieved?: Date; returned?: Date; bank?: string }) {
    const fee = g.form === "BANK_GUARANTEE" ? 15 : 5;
    const row = await db.guarantee.create({
      data: {
        tenderId,
        type: g.type,
        form: g.form,
        bank: g.bank ?? "البنك العربي",
        referenceNo: `${g.form === "BANK_GUARANTEE" ? "LG" : "CC"}-${Math.floor(between(100000, 999999))}`,
        amount: r3(g.amount),
        bankFee: fee,
        issueDate: g.issue,
        expiryDate: g.expiry,
        submittedDate: g.submitted ?? null,
        depositBox: g.type === "BID" ? "صندوق العطاءات الرئيسي" : "قسم العقود",
        status: g.status,
        retrievedDate: g.retrieved ?? null,
        returnedDate: g.returned ?? null,
      },
    });
    const label = { BID: "كفالة دخول", PERFORMANCE: "كفالة حسن تنفيذ", MAINTENANCE: "كفالة صيانة" }[g.type];
    await companyExpense(tenderId, "BANK_FEES", fee, g.issue, `عمولة إصدار ${label} — عطاء ${number}`, accountant.id, `guarantee-fee:${row.id}`);
    return row;
  }

  console.log("📋 العطاءات وجداول الكميات...");
  const projectIds: Record<string, number> = {};
  for (const p of PLANS) {
    const isRel = !!p.rel;
    const purchase = isRel ? rel(p.rel!.purchase) : ymd(p.year, p.month, 5);
    const deadline = isRel ? rel(p.rel!.deadline) : new Date(purchase.getTime() + 28 * 86400000);
    const site = isRel && p.rel!.site != null ? rel(p.rel!.site) : new Date(purchase.getTime() + 10 * 86400000);
    const year = purchase.getUTCFullYear();
    const items = p.mats.map(([k, qty], i) => {
      const m = MATS.find((x) => x.key === k)!;
      const unitPrice = priceFor(m, year);
      return { itemNo: `${i + 1}`, description: m.desc, normalized: normalizeText(m.desc), category: m.cat, unit: m.unit, quantity: qty, unitPrice, costPrice: r3(unitPrice * between(0.8, 0.88)), supplier: m.supplier ?? null, specs: m.specs ?? null, sortOrder: i + 1 };
    });
    const boqTotal = r3(items.reduce((s, i) => s + i.quantity * i.unitPrice, 0) * 1.12); // + أعمال متفرقة
    const docFee = boqTotal > 150000 ? 75 : boqTotal > 50000 ? 50 : 25;
    const won = ["WON", "EXECUTION", "MAINTENANCE", "CLOSED"].includes(p.status);
    const decided = won || p.status === "LOST";
    const discount = p.discount ?? (won ? Math.round(boqTotal * 0.01) : 0);
    const awarded = won ? r3(boqTotal - discount) : null;
    const resultDate = isRel && p.rel!.result != null ? rel(p.rel!.result) : decided ? new Date(deadline.getTime() + 30 * 86400000) : null;
    const awardLetter = won && resultDate ? new Date(resultDate.getTime() + 5 * 86400000) : null;
    const commence = won && awardLetter && p.status !== "WON" ? new Date(awardLetter.getTime() + 7 * 86400000) : null;
    const duration = boqTotal > 200000 ? 365 : boqTotal > 80000 ? 240 : 150;
    const prelim = ["MAINTENANCE", "CLOSED"].includes(p.status) && commence ? new Date(commence.getTime() + duration * 86400000) : null;

    // مشاريع الصيانة: الاستلام الابتدائي بحيث تنتهي كفالة الصيانة قريباً
    let prelimDate = prelim;
    if (p.number === "ب ق/2023/4") prelimDate = rel(-365 - 10); // انتهت فترة الصيانة منذ 10 أيام
    if (p.number === "ت ت/2024/62") prelimDate = rel(-365 + 25); // تنتهي خلال 25 يوماً
    const finalHandover = p.status === "CLOSED" && prelimDate ? new Date(prelimDate.getTime() + 370 * 86400000) : null;

    const t = await db.tender.create({
      data: {
        name: p.name,
        number: p.number,
        entity: p.entity,
        location: p.location,
        classification: "أبنية - رابعة",
        status: p.status,
        purchaseDate: purchase,
        docFee,
        deadline,
        siteVisitDate: site,
        siteVisitNotes: "تمت معاينة الموقع: الوصول متاح للشاحنات، التربة صخرية جزئياً، مصدر الكهرباء على بعد 150م.",
        bidAmount: ["PURCHASED", "PRICING"].includes(p.status) ? null : boqTotal,
        negotiationDiscount: won ? discount : null,
        awardedValue: awarded,
        resultDate,
        stampFee: won ? r3((awarded ?? 0) * 0.003) : null,
        stampFeeDate: awardLetter,
        awardLetterNo: won ? `إحالة/${year}/${Math.floor(between(100, 999))}` : null,
        awardLetterDate: awardLetter,
        commenceOrderDate: commence,
        durationDays: won ? duration : null,
        progress: p.progress ?? (["MAINTENANCE", "CLOSED"].includes(p.status) ? 100 : 0),
        preliminaryHandoverDate: prelimDate,
        finalHandoverDate: finalHandover,
        managerId: p.mgr ? users[p.mgr].id : null,
        boqItems: { create: items },
      },
    });
    projectIds[p.number] = t.id;

    await companyExpense(t.id, "TENDER_DOCS", docFee, purchase, `ثمن وثائق العطاء ${p.number}`, accountant.id, `tender-docs:${t.id}`);
    if (won && awardLetter) await companyExpense(t.id, "STAMP_FEES", r3((awarded ?? 0) * 0.003), awardLetter, `رسوم طوابع العطاء ${p.number}`, accountant.id, `stamp:${t.id}`);

    // ── الكفالات ──
    if (!["PURCHASED", "PRICING"].includes(p.status)) {
      const bidForm = boqTotal < 40000 ? "CERTIFIED_CHEQUE" : "BANK_GUARANTEE";
      const bidAmt = Math.round(boqTotal * 0.03 / 100) * 100;
      const bidIssue = new Date(deadline.getTime() - 3 * 86400000);
      const bidExp = new Date(deadline.getTime() + 90 * 86400000);
      const bidStatus = won ? (p.status === "WON" ? "RETRIEVED" : "RETURNED") : p.status === "LOST" ? "RETURNED" : "SUBMITTED";
      await guarantee(t.id, p.number, {
        type: "BID",
        form: bidForm,
        amount: bidAmt,
        issue: bidIssue,
        expiry: p.status === "NEGOTIATION" ? rel(20) : bidExp,
        status: bidStatus,
        submitted: deadline,
        retrieved: bidStatus !== "SUBMITTED" ? (resultDate ?? deadline) : undefined,
        returned: bidStatus === "RETURNED" ? new Date((resultDate ?? deadline).getTime() + 10 * 86400000) : undefined,
      });
    }
    if (won && awardLetter) {
      const perfStatus = ["MAINTENANCE", "CLOSED"].includes(p.status) ? "RETURNED" : "SUBMITTED";
      await guarantee(t.id, p.number, {
        type: "PERFORMANCE",
        form: "BANK_GUARANTEE",
        amount: Math.round((awarded ?? 0) * 0.1 / 100) * 100,
        issue: awardLetter,
        expiry: new Date(awardLetter.getTime() + (duration + 120) * 86400000),
        status: perfStatus,
        submitted: new Date(awardLetter.getTime() + 2 * 86400000),
        retrieved: prelimDate ?? undefined,
        returned: prelimDate ? new Date(prelimDate.getTime() + 7 * 86400000) : undefined,
        bank: "بنك الإسكان للتجارة والتمويل",
      });
    }
    if (prelimDate) {
      const maintExpiry = new Date(prelimDate.getTime() + 365 * 86400000);
      const closed = p.status === "CLOSED";
      await guarantee(t.id, p.number, {
        type: "MAINTENANCE",
        form: "BANK_GUARANTEE",
        amount: Math.round((awarded ?? 0) * 0.05 / 100) * 100,
        issue: prelimDate,
        expiry: maintExpiry,
        status: closed ? "RETURNED" : "SUBMITTED",
        submitted: new Date(prelimDate.getTime() + 2 * 86400000),
        retrieved: closed ? maintExpiry : undefined,
        returned: closed ? new Date(maintExpiry.getTime() + 5 * 86400000) : undefined,
        bank: "بنك الإسكان للتجارة والتمويل",
      });
    }

    // ── المطالبات والمصاريف للمشاريع المنفذة ──
    if (won && commence && awarded) {
      const pm = p.mgr ? users[p.mgr] : zaid;
      const progress = (p.progress ?? 100) / 100;
      const endDate = prelimDate && prelimDate < TODAY ? prelimDate : TODAY;
      const months = Math.max(1, Math.round((endDate.getTime() - commence.getTime()) / (30 * 86400000)));
      // المشاريع الجارية: جزء من التكاليف يُدفع بشيكات تُضاف لاحقاً، فنخفض المصاريف النقدية
      const costRatio = between(0.8, 0.88) * (p.status === "EXECUTION" ? 0.72 : 1);
      const totalCost = awarded * costRatio * progress;

      // المصاريف الشهرية
      for (let mi = 0; mi < months; mi++) {
        const monthStart = new Date(commence.getTime() + mi * 30 * 86400000);
        if (monthStart > TODAY) break;
        const monthCost = (totalCost / months) * between(0.7, 1.3);
        const custodyShare = monthCost * 0.3;
        let custodySpent = 0;
        for (const [cat, share] of CUSTODY_CATS) {
          const amt = r3(custodyShare * share);
          const date = new Date(monthStart.getTime() + Math.floor(between(1, 27)) * 86400000);
          if (date > TODAY) continue;
          custodySpent += amt;
          await db.expense.create({
            data: {
              tenderId: t.id,
              category: cat,
              amount: amt,
              date,
              description: { LABOR: "أجور عمال المياومة", TRANSPORT: "نقل مواد وتحميل", FUEL: "محروقات الآليات والمولد", MATERIALS: "مواد صغيرة من السوق المحلي" }[cat]!,
              vendor: cat === "FUEL" ? "محطة محروقات المناصير" : null,
              paymentMethod: "CUSTODY",
              createdById: pm.id,
            },
          });
        }
        // تمويل العهدة للشهر
        if (custodySpent > 0) {
          const fundAmt = Math.ceil((custodySpent * 1.05) / 100) * 100;
          const fr = await db.fundRequest.create({
            data: { requesterId: zaid.id, recipientId: pm.id, tenderId: t.id, amount: fundAmt, reason: `عهدة شهرية — ${p.name}`, status: "APPROVED", decidedById: zaid.id, decidedAt: monthStart, createdAt: monthStart },
          });
          await db.bankTransaction.create({ data: { date: monthStart, type: "OUT", amount: fundAmt, description: `عهدة لـ ${pm.name}: عهدة شهرية — ${p.name}`, category: "FUND", tenderId: t.id, sourceType: "FUND", sourceId: fr.id } });
        }
        for (const [cat, share] of COMPANY_CATS) {
          const date = new Date(monthStart.getTime() + Math.floor(between(1, 27)) * 86400000);
          if (date > TODAY) continue;
          const desc = { MATERIALS: "توريد حديد وخرسانة جاهزة", SUBCONTRACT: "دفعة مقاول باطن — أعمال التشطيبات", EQUIPMENT: "استئجار حفارة ورافعة", TESTS: "فحوصات مكعبات الخرسانة — مختبر الجمعية العلمية الملكية" }[cat]!;
          await companyExpense(t.id, cat, monthCost * 0.7 * share, date, desc, accountant.id);
        }
      }

      // المطالبات المرحلية
      const claimCount = Math.max(1, Math.floor(months / 2));
      const billable = awarded * progress;
      for (let ci = 0; ci < claimCount; ci++) {
        const submitted = new Date(commence.getTime() + (ci + 1) * 60 * 86400000);
        if (submitted > TODAY) break;
        const isLastFinal = p.status !== "EXECUTION" && ci === claimCount - 1;
        const gross = r3((billable / claimCount) * between(0.92, 1.08));
        const turnaround = Math.floor(between(18, 45));
        const paidDate = new Date(submitted.getTime() + turnaround * 86400000);
        const isPaid = paidDate <= rel(-3) && !(p.status === "EXECUTION" && ci === claimCount - 1);
        const deductions = isLastFinal ? 80 : ci % 3 === 2 ? r3(gross * 0.005) : 0;
        const c = await db.claim.create({
          data: {
            tenderId: t.id,
            type: isLastFinal ? "FINAL" : "INTERIM",
            number: ci + 1,
            submittedDate: submitted,
            grossAmount: gross,
            deductions,
            deductionNotes: deductions ? (isLastFinal ? "ملاحظات إنارة وكهرباء بسيطة" : "غرامة تأخير توريد عينات") : null,
            status: isPaid ? "PAID" : ci % 2 ? "APPROVED" : "SUBMITTED",
            approvedDate: isPaid ? new Date(submitted.getTime() + 10 * 86400000) : null,
            paidDate: isPaid ? paidDate : null,
            paidAmount: isPaid ? r3(gross - deductions) : null,
          },
        });
        if (isPaid) {
          await db.bankTransaction.create({ data: { date: paidDate, type: "IN", amount: r3(gross - deductions), description: `قبض ${isLastFinal ? "مطالبة نهائية" : "مطالبة مرحلية"} رقم ${ci + 1} — ${p.name}`, category: "CLAIM", tenderId: t.id, sourceType: "CLAIM", sourceId: c.id } });
        }
      }
    }
  }

  console.log("🧾 الشيكات...");
  const tafila = projectIds["أ ع/2025/39"];
  const maan = projectIds["ت ت/2025/88"];
  const hasa = projectIds["أ ع/2026/45"];
  const cheques: { number: string; payee: string; amount: number; issue: number; due: number; status: string; tenderId: number | null; cat: string }[] = [
    { number: "200451", payee: "مصنع حديد الأردن", amount: 18450, issue: -40, due: 0, status: "DEFERRED", tenderId: tafila, cat: "MATERIALS" },
    { number: "200452", payee: "شركة خرسانة الجنوب الجاهزة", amount: 7320, issue: -30, due: 2, status: "DEFERRED", tenderId: tafila, cat: "MATERIALS" },
    { number: "200453", payee: "مؤسسة الحسيني لمواد البناء", amount: 3150.5, issue: -20, due: 3, status: "DEFERRED", tenderId: maan, cat: "MATERIALS" },
    { number: "200454", payee: "الوكيل المعتمد لأريستون - عمان", amount: 1640, issue: -10, due: 15, status: "DEFERRED", tenderId: maan, cat: "MATERIALS" },
    { number: "200455", payee: "مقاول الألمنيوم — أبو خليل", amount: 9800, issue: -5, due: 40, status: "DEFERRED", tenderId: tafila, cat: "SUBCONTRACT" },
    { number: "200456", payee: "شركة الشرق لتأجير المعدات", amount: 2200, issue: -35, due: -1, status: "DEFERRED", tenderId: hasa, cat: "EQUIPMENT" },
    { number: "200440", payee: "مصنع حديد الأردن", amount: 15600, issue: -120, due: -60, status: "CASHED", tenderId: tafila, cat: "MATERIALS" },
    { number: "200441", payee: "شركة خرسانة الجنوب الجاهزة", amount: 6240, issue: -100, due: -45, status: "CASHED", tenderId: maan, cat: "MATERIALS" },
    { number: "200442", payee: "مؤسسة الطراونة للتجارة", amount: 980, issue: -90, due: -50, status: "RETURNED", tenderId: null, cat: "OFFICE" },
  ];
  for (const c of cheques) {
    const ch = await db.cheque.create({
      data: { number: c.number, bank: "البنك العربي", payee: c.payee, amount: c.amount, issueDate: rel(c.issue), dueDate: rel(c.due), status: c.status, cashedDate: c.status === "CASHED" ? rel(c.due) : null, tenderId: c.tenderId },
    });
    if (c.status !== "RETURNED") {
      await db.expense.create({ data: { tenderId: c.tenderId, category: c.cat, amount: c.amount, date: rel(c.issue), description: `دفعة بشيك رقم ${c.number} — ${c.payee}`, vendor: c.payee, paymentMethod: "CHEQUE", chequeId: ch.id, createdById: accountant.id } });
    }
    if (c.status === "CASHED") {
      await db.bankTransaction.create({ data: { date: rel(c.due), type: "OUT", amount: c.amount, description: `صرف شيك رقم ${c.number} — ${c.payee}`, category: "CHEQUE", tenderId: c.tenderId, sourceType: "CHEQUE", sourceId: ch.id } });
    }
  }

  console.log("💰 طلبات تمويل معلقة...");
  await db.fundRequest.create({ data: { requesterId: accountant.id, recipientId: accountant.id, tenderId: projectIds["د ع ح/2026/112"], amount: 3500, reason: "تجهيز كفالة حسن التنفيذ المتوقعة ورسوم الطوابع", status: "PENDING" } });
  await db.fundRequest.create({ data: { requesterId: emad.id, recipientId: emad.id, tenderId: tafila, amount: 1500, reason: "أجور عمال صب سقف الطابق الثاني", status: "PENDING", createdAt: rel(-1) } });

  console.log("🗂️ أوراق الشركة...");
  const docs = [
    { title: "شهادة التصنيف — مقاول أبنية فئة رابعة", type: "CLASSIFICATION", number: "تص/4/1187", issuer: "وزارة الأشغال العامة والإسكان — دائرة تصنيف المقاولين", issue: -245, exp: 120 },
    { title: "السجل التجاري", type: "COMMERCIAL_REGISTER", number: "58421", issuer: "وزارة الصناعة والتجارة والتموين", issue: -345, exp: 20 },
    { title: "رخصة المهن — بلدية الكرك الكبرى", type: "PROFESSION_LICENSE", number: "م/2025/3390", issuer: "بلدية الكرك الكبرى", issue: -370, exp: -5 },
    { title: "عضوية غرفة تجارة الكرك", type: "CHAMBER", number: "9912", issuer: "غرفة تجارة الكرك", issue: -165, exp: 200 },
    { title: "عضوية نقابة مقاولي الإنشاءات الأردنيين", type: "CONTRACTORS_UNION", number: "ن/4/772", issuer: "نقابة مقاولي الإنشاءات الأردنيين", issue: -65, exp: 300 },
    { title: "براءة ذمة الضمان الاجتماعي", type: "SOCIAL_SECURITY", number: "ض/2026/10455", issuer: "المؤسسة العامة للضمان الاجتماعي", issue: -80, exp: 10 },
    { title: "بوليصة تأمين جميع أخطار المقاول — مركز صحي الطفيلة", type: "INSURANCE", number: "CAR-2025-0631", issuer: "شركة التأمين الأردنية", issue: -215, exp: 150 },
  ];
  for (const d of docs) {
    await db.companyDocument.create({ data: { title: d.title, type: d.type, number: d.number, issuer: d.issuer, issueDate: rel(d.issue), expiryDate: rel(d.exp) } });
  }

  const [inn, out] = await Promise.all([
    db.bankTransaction.aggregate({ where: { type: "IN" }, _sum: { amount: true } }),
    db.bankTransaction.aggregate({ where: { type: "OUT" }, _sum: { amount: true } }),
  ]);
  const counts = await Promise.all([db.tender.count(), db.boqItem.count(), db.expense.count(), db.claim.count(), db.guarantee.count()]);
  console.log(`✅ تم: ${counts[0]} عطاءات، ${counts[1]} بنود، ${counts[2]} مصاريف، ${counts[3]} مطالبات، ${counts[4]} كفالات`);
  console.log(`🏦 رصيد البنك: ${r3((inn._sum.amount ?? 0) - (out._sum.amount ?? 0)).toLocaleString("en-US")} د.أ`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());

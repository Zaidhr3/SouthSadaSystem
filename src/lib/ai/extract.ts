import "server-only";
import { z } from "zod";
import { BOQ_CATEGORY, EXPENSE_CATEGORY } from "../labels";
import { generateJson, type GeminiPart } from "./gemini";

/* ═════════════ جدول الكميات (BOQ) ═════════════ */

const BOQ_SYSTEM = `أنت مهندس كميات خبير في العطاءات الحكومية الأردنية. مهمتك قراءة وثيقة جدول كميات (BOQ) واستخراج بنودها كما هي حرفياً.
قواعد صارمة:
1) لا تفترض ولا تخمّن أي قيمة غير مكتوبة في المستند. أي حقل غير موجود = null (الأسعار غالباً فارغة في وثيقة العطاء — اتركها null).
2) انسخ الوصف كاملاً بلغته الأصلية دون تلخيص، واحذف فقط فواصل الأسطر الزائدة.
3) رقم البند كما في المستند (مثل 1-2 أو 3.4.1). page = رقم صفحة PDF التي ظهر فيها البند (يبدأ من 1)، وفي Excel رقم الورقة. ref = مرجع إضافي إن وجد (رقم الصف R في Excel أو عنوان القسم).
4) الكمية والسعر والإجمالي أرقام فقط (بدون فواصل آلاف أو عملة). حوّل الأرقام العربية إلى إنجليزية.
5) العناوين والمجاميع الفرعية ("المجموع"، "يرحل"، "Total") ليست بنوداً — لا تُدرجها.
6) section = عنوان القسم/الباب الذي يقع تحته البند إن وُجد.
7) category = أقرب تصنيف من القائمة المحددة حسب طبيعة العمل.
8) confidence من 0 إلى 1 حسب وضوح قراءة البند (صورة رديئة أو خط غير واضح = أقل).
9) البند الرئيسي الذي تتفرع منه بنود فرعية (أ، ب، ج… أو 1، 2…) بلا كمية خاصة به: لا تُدرجه بنداً مستقلاً، بل ضع نصّه كاملاً في بداية وصف كل بند فرعي ثم وصف الفرعي، ورقم البند = رقم الرئيسي ثم حرف الفرعي (مثل "1/1 أ"). الوصف الكامل ضروري لمقارنة الأسعار والتسعير لاحقاً.
10) البند الذي يمتد وصفه على عدة أسطر أو أعمدة: اجمع الوصف كاملاً في حقل واحد. صحّح فقط أخطاء استخراج النص الظاهرة دون تغيير المعنى أو الأرقام: في ملفات PDF العربية يظهر حرف «لا» مقلوباً «ال» (البالط← البلاط، االزالة← الإزالة، لالسطح← للأسطح، االبواب← الأبواب، الستقبال← لاستقبال، االحدث← الأحدث، التقل← لا تقل)، والأقواس معكوسة «)0.55*0.5(» ← «(0.55*0.5)»، وحروف متقطعة «ق ص» ← «قص»، «ت قديم» ← «تقديم». اكتب النص العربي سليماً كما يُقرأ في الصفحة.`;

const BOQ_SCHEMA = {
  type: "OBJECT",
  properties: {
    items: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          itemNo: { type: "STRING", nullable: true },
          description: { type: "STRING" },
          unit: { type: "STRING", nullable: true },
          quantity: { type: "NUMBER", nullable: true },
          unitPrice: { type: "NUMBER", nullable: true },
          total: { type: "NUMBER", nullable: true },
          page: { type: "INTEGER", nullable: true },
          ref: { type: "STRING", nullable: true },
          section: { type: "STRING", nullable: true },
          category: { type: "STRING", enum: Object.keys(BOQ_CATEGORY) },
          confidence: { type: "NUMBER" },
        },
        required: ["description", "category", "confidence"],
      },
    },
    documentTitle: { type: "STRING", nullable: true },
    notes: { type: "STRING", nullable: true },
  },
  required: ["items"],
};

const num = z.preprocess((v) => (v === "" || v == null ? null : typeof v === "string" ? Number(v.replace(/,/g, "")) : v), z.number().finite().nullable());
export const boqItemSchema = z.object({
  itemNo: z.string().trim().max(40).nullable().catch(null),
  description: z.string().trim().min(2).max(4000),
  unit: z.string().trim().max(40).nullable().catch(null),
  quantity: num.catch(null),
  unitPrice: num.catch(null),
  total: num.catch(null),
  page: z.number().int().min(1).max(5000).nullable().catch(null),
  ref: z.string().trim().max(200).nullable().catch(null),
  section: z.string().trim().max(300).nullable().catch(null),
  category: z.string().refine((c) => c in BOQ_CATEGORY).catch("OTHER"),
  confidence: z.number().min(0).max(1).catch(0.5),
});
/**
 * إصلاح ثابت لعيب شائع في طبقة النص لملفات PDF العربية: حرف «لا» يُستخرج مقلوباً «ال»
 * فتظهر «االعمال، االزالة، لالسطح». الكلمة العربية لا تبدأ بـ «اال» ولا بـ «لال» + حرف — تصحيح آمن لا يغير المعنى.
 */
export function repairArabicPdfText(s: string) {
  return s
    .replace(/(^|[s(«"-/،,:])اال(?=[ء-ي])/g, "$1الا")
    .replace(/(^|[s(«"-/،,:])لال(?=[ء-ي])/g, "$1للا")
    .replace(/[ 	]{2,}/g, " ");
}

export type ExtractedBoqItem = z.infer<typeof boqItemSchema> & { mismatch: boolean };

/**
 * range: عند قراءة مقطع من PDF طويل (الصفحات from..to من الأصل) — يُطلب رقم الصفحة داخل المقطع
 * ثم يُحوَّل هنا إلى رقم الصفحة في المستند الأصلي (أدق من مطالبة النموذج بالحساب).
 */
export async function extractBoq(parts: GeminiPart[], range?: { from: number; to: number; total: number }, timeoutMs?: number) {
  const ask = range
    ? `هذا مقطع من مستند أطول: يضم الصفحات ${range.from} إلى ${range.to} من أصل ${range.total}. page = رقم الصفحة داخل هذا المقطع (أول صفحة فيه = 1). إن لم يحتوِ المقطع بنود جدول كميات (غلاف، شروط، مواصفات) أعد items فارغة. البند المقطوع في آخر المقطع أدرجه بما ظهر منه. استخرج كل البنود وفق القواعد. أعد JSON فقط.`
    : "استخرج كل بنود جدول الكميات من هذا المستند وفق القواعد. أعد JSON فقط.";
  const r = await generateJson<{ items?: unknown[]; documentTitle?: string | null; notes?: string | null }>({
    system: BOQ_SYSTEM,
    parts: [...parts, { text: ask }],
    schema: BOQ_SCHEMA,
    timeoutMs,
  });
  const items: ExtractedBoqItem[] = [];
  let dropped = 0;
  for (const raw of r.data.items ?? []) {
    const p = boqItemSchema.safeParse(raw);
    if (!p.success) { dropped++; continue; }
    const it = p.data;
    it.description = repairArabicPdfText(it.description);
    if (it.section) it.section = repairArabicPdfText(it.section);
    if (range) it.page = it.page == null ? null : Math.min(range.to, Math.max(range.from, range.from + it.page - 1));
    // تحقق حسابي: الكمية × السعر = الإجمالي (عند وجود الثلاثة) — اختلاف يُعلَّم للمراجعة ولا يُصحَّح تلقائياً
    const mismatch = it.quantity != null && it.unitPrice != null && it.total != null && Math.abs(it.quantity * it.unitPrice - it.total) > Math.max(0.01, Math.abs(it.total) * 0.005);
    items.push({ ...it, mismatch });
  }
  return { items, dropped, title: r.data.documentTitle ?? null, notes: r.data.notes ?? null, model: r.model, ms: r.ms };
}

/* ═════════════ الفواتير ═════════════ */

const INVOICE_SYSTEM = `أنت محاسب أردني خبير. اقرأ صورة/ملف فاتورة شراء واستخرج بياناتها كما هي حرفياً.
قواعد صارمة:
1) لا تفترض أي قيمة غير مكتوبة — الحقل غير الموجود = null.
2) التاريخ بصيغة YYYY-MM-DD كما في الفاتورة.
3) المبالغ أرقام فقط بالدينار الأردني (بدون فواصل). total = الإجمالي النهائي المستحق الدفع.
4) category = أقرب تصنيف مصروف من القائمة حسب محتوى الفاتورة.
5) projectId = رقم المشروع من القائمة المرفقة فقط إذا ذُكر اسمه أو موقعه صراحة في الفاتورة، وإلا null.`;

const INVOICE_SCHEMA = {
  type: "OBJECT",
  properties: {
    supplier: { type: "STRING", nullable: true },
    supplierTin: { type: "STRING", nullable: true },
    invoiceNo: { type: "STRING", nullable: true },
    date: { type: "STRING", nullable: true },
    subtotal: { type: "NUMBER", nullable: true },
    tax: { type: "NUMBER", nullable: true },
    total: { type: "NUMBER", nullable: true },
    category: { type: "STRING", enum: Object.keys(EXPENSE_CATEGORY) },
    description: { type: "STRING", nullable: true },
    projectId: { type: "INTEGER", nullable: true },
    items: {
      type: "ARRAY",
      items: { type: "OBJECT", properties: { description: { type: "STRING" }, quantity: { type: "NUMBER", nullable: true }, unit: { type: "STRING", nullable: true }, unitPrice: { type: "NUMBER", nullable: true }, total: { type: "NUMBER", nullable: true } }, required: ["description"] },
    },
    confidence: { type: "NUMBER" },
  },
  required: ["category", "confidence"],
};

export const invoiceSchema = z.object({
  supplier: z.string().trim().max(200).nullable().catch(null),
  supplierTin: z.string().trim().max(30).nullable().catch(null),
  invoiceNo: z.string().trim().max(60).nullable().catch(null),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().catch(null),
  subtotal: num.catch(null),
  tax: num.catch(null),
  total: num.catch(null),
  category: z.string().refine((c) => c in EXPENSE_CATEGORY).catch("OTHER"),
  description: z.string().trim().max(500).nullable().catch(null),
  projectId: z.number().int().nullable().catch(null),
  items: z.array(z.object({ description: z.string(), quantity: num.catch(null), unit: z.string().nullable().catch(null), unitPrice: num.catch(null), total: num.catch(null) })).catch([]),
  confidence: z.number().min(0).max(1).catch(0.5),
});
export type ExtractedInvoice = z.infer<typeof invoiceSchema>;

export async function extractInvoice(parts: GeminiPart[], projects: { id: number; name: string; location: string | null }[]) {
  const list = projects.map((p) => `${p.id}: ${p.name}${p.location ? ` — ${p.location}` : ""}`).join("\n");
  const r = await generateJson<unknown>({
    system: INVOICE_SYSTEM,
    parts: [...parts, { text: `المشاريع النشطة (رقم: الاسم — الموقع):\n${list || "لا يوجد"}\nاستخرج بيانات الفاتورة. أعد JSON فقط.` }],
    schema: INVOICE_SCHEMA,
  });
  const data = invoiceSchema.parse(r.data);
  if (data.projectId != null && !projects.some((p) => p.id === data.projectId)) data.projectId = null;
  return { data, model: r.model, ms: r.ms };
}

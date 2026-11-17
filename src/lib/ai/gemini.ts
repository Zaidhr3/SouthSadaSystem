import "server-only";

/**
 * عميل Google Gemini (REST) — يعمل على الخادم فقط. المفتاح في GEMINI_API_KEY ولا يُرسل للمتصفح أبداً.
 * النموذج قابل للتغيير عبر GEMINI_MODEL (الافتراضي gemini-2.5-flash).
 * المخرجات JSON صارم (responseSchema) ثم تُتحقق في الخادم قبل أي حفظ.
 */
export const geminiModel = () => process.env.GEMINI_MODEL || "gemini-3.5-flash";
/** مهلة الاستدعاء — أقل من maxDuration للصفحة على Vercel */
const TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS || 55_000);
/**
 * مستوى «التفكير» (GEMINI_THINKING): low/medium/high لنماذج Gemini 3، أو رقم (ميزانية رموز) لنماذج 2.5 — 0 يعطّله.
 * الاستخراج نسخ حرفي لا يحتاج تفكيراً طويلاً، وتقليله يختصر زمن القراءة كثيراً.
 */
function thinkingConfig(override: string | undefined, model: string) {
  // مستويات التفكير النصية لنماذج Gemini 3 فقط — نماذج 2.x تبقى على إعداد البيئة
  const v = ((override && /^gemini-[3-9]/.test(model) ? override : undefined) ?? process.env.GEMINI_THINKING ?? "").trim();
  if (!v) return {};
  return { thinkingConfig: /^\d+$/.test(v) ? { thinkingBudget: Number(v) } : { thinkingLevel: v } };
}
export const geminiConfigured = () => !!process.env.GEMINI_API_KEY;

export type GeminiPart = { text: string } | { inline_data: { mime_type: string; data: string } } | { file_data: { mime_type: string; file_uri: string } };
export type InputFile = { name: string; type: string; data: Buffer };

/** ما فوقه يُرفع إلى Gemini Files API بدل التضمين (حد الطلب المضمَّن 20 ميغابايت بعد ترميز base64) */
const INLINE_MAX_BYTES = 14 * 1024 * 1024;
const apiBase = () => process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com";

/** رفع ملف كبير إلى Gemini Files API (رفع قابل للاستئناف) ثم انتظار جاهزيته — يُحذف تلقائياً من Google بعد 48 ساعة */
async function uploadToGeminiFiles(file: InputFile, mime: string): Promise<{ uri: string; name: string }> {
  const key = process.env.GEMINI_API_KEY || "";
  const start = await fetch(`${apiBase()}/upload/v1beta/files`, {
    method: "POST",
    headers: {
      "x-goog-api-key": key,
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(file.data.length),
      "X-Goog-Upload-Header-Content-Type": mime,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ file: { display_name: file.name.replace(/[^\w.-]+/g, "_").slice(0, 100) || "document" } }),
    cache: "no-store",
  });
  const url = start.headers.get("x-goog-upload-url");
  if (!start.ok || !url) throw new Error(`تعذر رفع الملف إلى Gemini (HTTP ${start.status})`);
  const up = await fetch(url, {
    method: "POST",
    headers: { "Content-Length": String(file.data.length), "X-Goog-Upload-Offset": "0", "X-Goog-Upload-Command": "upload, finalize" },
    body: new Uint8Array(file.data),
    cache: "no-store",
  });
  const j = (await up.json().catch(() => ({}))) as { file?: { uri?: string; name?: string; state?: string } };
  if (!up.ok || !j.file?.uri || !j.file.name) throw new Error(`تعذر رفع الملف إلى Gemini (HTTP ${up.status})`);
  let state = j.file.state;
  for (let i = 0; state === "PROCESSING" && i < 20; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const g = (await (await fetch(`${apiBase()}/v1beta/${j.file.name}`, { headers: { "x-goog-api-key": key }, cache: "no-store" })).json().catch(() => ({}))) as { state?: string };
    state = g.state;
  }
  if (state === "FAILED") throw new Error("تعذر على Gemini معالجة الملف — تأكد أنه PDF أو صورة سليمة");
  return { uri: j.file.uri, name: j.file.name };
}

/** حذف ملف مؤقت من Gemini Files API (أفضل جهد) */
export async function deleteGeminiFile(name: string) {
  await fetch(`${apiBase()}/v1beta/${name}`, { method: "DELETE", headers: { "x-goog-api-key": process.env.GEMINI_API_KEY || "" }, cache: "no-store" }).catch(() => undefined);
}

const SUPPORTED_INLINE = ["application/pdf", "image/png", "image/jpeg", "image/webp", "image/heic", "image/heif"];
const EXCEL = ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.ms-excel"];

/** تحويل ملف مرفوع إلى أجزاء يفهمها النموذج: PDF والصور مباشرة، و Excel كنص جدولي مع أرقام الأوراق والصفوف */
export async function fileToParts(file: InputFile): Promise<{ parts: GeminiPart[]; kind: "pdf" | "image" | "excel"; geminiFile?: string }> {
  const buf = file.data;
  const name = file.name.toLowerCase();
  const type = file.type || (name.endsWith(".pdf") ? "application/pdf" : name.endsWith(".xlsx") ? EXCEL[0] : "");
  if (EXCEL.includes(type) || name.endsWith(".xlsx")) {
    const ExcelJS = (await import("exceljs")).default; // تحميل عند الحاجة فقط (أسرع لملفات PDF والصور)
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const sheets: string[] = [];
    wb.eachSheet((ws) => {
      const rows: string[] = [];
      ws.eachRow({ includeEmpty: false }, (row, n) => {
        const cells = (row.values as unknown[]).slice(1).map((v) => {
          if (v == null) return "";
          if (typeof v === "object") {
            const o = v as { result?: unknown; text?: unknown; richText?: { text: string }[] };
            if (o.result != null) return String(o.result);
            if (o.richText) return o.richText.map((r) => r.text).join("");
            if (o.text != null) return String(o.text);
          }
          return String(v).replace(/\s+/g, " ").trim();
        });
        if (cells.some((c) => c !== "")) rows.push(`R${n}\t${cells.join("\t")}`);
      });
      sheets.push(`### ورقة: ${ws.name} (الصفحة = ترتيب الورقة ${ws.id})\n${rows.join("\n")}`);
    });
    const text = sheets.join("\n\n").slice(0, 400_000);
    return { parts: [{ text: `محتوى ملف Excel «${file.name}» (كل سطر يبدأ برقم الصف R):\n${text}` }], kind: "excel" };
  }
  if (!SUPPORTED_INLINE.includes(type)) throw new Error("نوع الملف غير مدعوم — ارفع PDF أو صورة (JPG/PNG) أو Excel (xlsx)");
  const kind = type === "application/pdf" ? "pdf" : "image";
  if (buf.length > INLINE_MAX_BYTES) {
    const up = await uploadToGeminiFiles(file, type);
    return { parts: [{ file_data: { mime_type: type, file_uri: up.uri } }], kind, geminiFile: up.name };
  }
  return { parts: [{ inline_data: { mime_type: type, data: buf.toString("base64") } }], kind };
}

/** استدعاء Gemini مع مخطط JSON صارم — يعيد الكائن المحلَّل أو يرمي خطأً واضحاً بالعربية */
class Retryable extends Error {
  constructor(message: string, public delayMs: number, public daily = false) {
    super(message);
  }
}

/**
 * يعيد المحاولة تلقائياً عند تجاوز حد الطلبات (429) أو انشغال النموذج (503) — بالمهلة التي يحددها Google —
 * ما دام الوقت المتبقي يسمح (حد زمن الطلب على Vercel).
 */
/** النموذج البديل عند نفاد الحصة اليومية للنموذج الأساسي (الخطة المجانية: 20 طلباً يومياً لـ Flash) */
export const geminiFallbackModel = () => (process.env.GEMINI_FALLBACK_MODEL ?? "gemini-3.5-flash-lite").trim();

/** آخر نفاد للحصة اليومية للنموذج الأساسي — يتجنب طلبات مرفوضة مؤكدة لساعة */
let primaryExhaustedAt = 0;

export async function generateJson<T>(opts: { system: string; parts: GeminiPart[]; schema: object; temperature?: number; timeoutMs?: number; model?: string; thinking?: string; maxOutputTokens?: number }): Promise<{ data: T; model: string; ms: number }> {
  const started = Date.now();
  // الميزانية الزمنية الكلية للاستدعاء (مع إعادات المحاولة) — دفعات جدول الكميات تمرر مهلة أطول عبر مسار API
  const budget = opts.timeoutMs ?? TIMEOUT_MS;
  for (let attempt = 0; ; attempt++) {
    try {
      const fallback = geminiFallbackModel();
      const useFallback = !opts.model && fallback && Date.now() - primaryExhaustedAt < 3600_000;
      return await generateJsonOnce<T>({ ...opts, model: opts.model ?? (useFallback ? fallback : undefined), timeoutMs: Math.max(10_000, budget - (Date.now() - started)) });
    } catch (e) {
      // نفاد الحصة اليومية: لا فائدة من الانتظار — يُكمل فوراً بالنموذج البديل
      if (e instanceof Retryable && e.daily && !opts.model && geminiFallbackModel()) {
        primaryExhaustedAt = Date.now();
        if (attempt < 4) continue;
      }
      if (!(e instanceof Retryable) || attempt >= 4) throw e;
      const wait = Math.min(Math.max(e.delayMs, 2000 * (attempt + 1)), 30_000);
      if (Date.now() - started + wait + 15_000 > budget) throw new Error(e.message);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

async function generateJsonOnce<T>(opts: { system: string; parts: GeminiPart[]; schema: object; temperature?: number; timeoutMs?: number; model?: string; thinking?: string; maxOutputTokens?: number }): Promise<{ data: T; model: string; ms: number }> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("مفتاح Google Gemini غير مضبوط على الخادم (GEMINI_API_KEY)");
  const model = opts.model ?? geminiModel();
  const base = apiBase();
  const started = Date.now();
  const ctrl = new AbortController();
  const limit = opts.timeoutMs ?? TIMEOUT_MS;
  const timer = setTimeout(() => ctrl.abort(), limit);
  try {
    const res = await fetch(`${base}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: opts.system }] },
        contents: [{ role: "user", parts: opts.parts }],
        generationConfig: { responseMimeType: "application/json", responseSchema: opts.schema, temperature: opts.temperature ?? 0, maxOutputTokens: opts.maxOutputTokens ?? 65_536, ...thinkingConfig(opts.thinking, model) },
      }),
      signal: ctrl.signal,
      cache: "no-store",
    });
    const body = (await res.json().catch(() => ({}))) as {
      error?: { message?: string; status?: string; details?: { retryDelay?: string }[] };
      candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
      promptFeedback?: { blockReason?: string };
    };
    if (!res.ok) {
      const msg = body.error?.message ?? `HTTP ${res.status}`;
      if (res.status === 400 && /API key/i.test(msg)) throw new Error("مفتاح Gemini غير صالح");
      const delay = Number(body.error?.details?.find((d) => d.retryDelay)?.retryDelay?.replace(/s$/, "") || 0) * 1000;
      if (res.status === 429) {
        const daily = /per day|PerDay|free_tier_requests/i.test(msg);
        throw new Retryable(daily ? "نفدت الحصة اليومية لـ Gemini (الخطة المجانية) — فعّل الفوترة في Google AI Studio أو حاول غداً" : "تجاوزت حد الاستخدام لـ Gemini مؤقتاً — حاول بعد دقيقة", delay, daily);
      }
      if (res.status === 503 || res.status === 500) throw new Retryable("نموذج Gemini مشغول حالياً — حاول بعد قليل", delay);
      throw new Error(`خطأ من Gemini: ${msg}`);
    }
    if (body.promptFeedback?.blockReason) throw new Error(`رفض النموذج المستند (${body.promptFeedback.blockReason})`);
    const cand = body.candidates?.[0];
    const text = cand?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    if (cand?.finishReason === "MAX_TOKENS") throw new Retryable(opts.maxOutputTokens ? "خرج النموذج عن الطول المحدد — أُعيدت المحاولة" : "المستند طويل جداً لقراءة واحدة — قسّمه إلى ملفات أصغر (مثلاً كل قسم على حدة)", 0);
    if (!text) throw new Retryable("لم يُرجع النموذج أي بيانات — أُعيدت المحاولة", 0);
    let data: T;
    try {
      data = JSON.parse(text) as T;
    } catch {
      throw new Error("أرجع النموذج بيانات غير صالحة (ليست JSON)");
    }
    return { data, model, ms: Date.now() - started };
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") throw new Error(`انتهت مهلة القراءة (${Math.round(limit / 1000)} ثانية) — جرّب ملفاً أصغر أو قسّم المستند`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

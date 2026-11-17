"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { actionUser, assertTenderAccess } from "@/lib/auth";
import { auditEvent } from "@/lib/action";
import { AppError, tenderScope, type AppUser } from "@/lib/permissions";
import { deleteGeminiFile, fileToParts, geminiConfigured, geminiModel, type InputFile } from "@/lib/ai/gemini";
import { chunkRanges, PAGES_PER_CHUNK, pdfPageCount, pdfSlice } from "@/lib/ai/pdf";
import { boqItemSchema } from "@/lib/ai/extract";
import { consumeStaged, discardStaged, fetchStaged, stagedTokens, STAGED_MAX_BYTES, STAGED_MAX_MB, type StagedFile } from "@/lib/storage";
import { extractBoq, extractInvoice, type ExtractedBoqItem, type ExtractedInvoice } from "@/lib/ai/extract";
import { normalizeText, searchPriceHistory } from "@/lib/pricing";
import { BOQ_CATEGORY } from "@/lib/labels";
import { round3 } from "@/lib/format";

type Picked = InputFile & { size: number; staged?: StagedFile };

/**
 * الملف المراد قراءته: إما مرفوع مباشرة إلى Supabase Storage (رمز تذكرة — للملفات الكبيرة، يُسحب من التخزين على الخادم)
 * أو مرسل مع الطلب (الملفات الصغيرة).
 */
async function pickFile(fd: FormData, userId: number): Promise<Picked> {
  const token = stagedTokens(fd, "file")[0] ?? stagedTokens(fd, "files")[0];
  if (token) {
    const st = await fetchStaged(token, userId);
    return { name: st.fileName, type: st.mimeType, data: st.data, size: st.size, staged: st };
  }
  const f = fd.getAll("file").concat(fd.getAll("files")).find((x): x is File => typeof x === "object" && x !== null && "arrayBuffer" in x && (x as File).size > 0);
  if (!f) throw new AppError("اختر ملفاً");
  if (f.size > STAGED_MAX_BYTES) throw new AppError(`حجم الملف أكبر من ${STAGED_MAX_MB} ميغابايت — قسّم المستند أو صوّر الصفحات المطلوبة`);
  return { name: f.name, type: f.type, data: Buffer.from(await f.arrayBuffer()), size: f.size };
}

async function assertBoqEditor(user: AppUser, tenderId: number) {
  const t = await db.tender.findUnique({ where: { id: tenderId }, select: { managerId: true, boqApprovedAt: true } });
  if (!t) throw new AppError("العطاء غير موجود");
  if (!(user.role === "ADMIN" || user.role === "ACCOUNTANT" || (user.role === "PM" && t.managerId === user.id))) throw new AppError("ليست لديك صلاحية على جدول كميات هذا العطاء");
  if (t.boqApprovedAt) throw new AppError("جدول الكميات معتمد ومقفل — الإضافة بأمر تغيير");
}

/** مقارنة الأسعار التاريخية (كل العطاءات السابقة) والجغرافية (نفس الجهة/المنطقة) */
async function withPriceHints(tenderId: number, list: ExtractedBoqItem[]) {
  const tender = await db.tender.findUniqueOrThrow({ where: { id: tenderId }, select: { entity: true } });
  const items = [] as (ExtractedBoqItem & { hint: PriceHint | null })[];
  for (const [i, it] of list.entries()) {
    let hint: PriceHint | null = null;
    if (i < 200) {
      const groups = await searchPriceHistory(it.description, { excludeTenderId: tenderId, limit: 60 });
      const g = groups.find((x) => !it.unit || x.unit === it.unit) ?? groups[0];
      if (g) {
        const same = g.occurrences.filter((o) => o.entity === tender.entity);
        hint = { avg: g.avgPrice, latest: g.latestPrice, suggested: g.suggestedPrice, count: g.count, sameEntityAvg: same.length ? round3(same.reduce((s, o) => s + o.unitPrice, 0) / same.length) : null, years: g.oldestYear === g.latestYear ? String(g.latestYear) : `${g.oldestYear}–${g.latestYear}` };
      }
    }
    items.push({ ...it, hint });
  }
  return items;
}

export type PriceHint = { avg: number; latest: number; suggested: number; count: number; sameEntityAvg: number | null; years: string };
export type BoqExtractionResult =
  | { ok: true; extractionId: number; items: (ExtractedBoqItem & { hint: PriceHint | null })[]; dropped: number; title: string | null; notes: string | null; model: string; ms: number }
  | { ok: false; error: string };

/** الاستخراج الآلي لجدول الكميات من PDF/صورة/Excel — النتيجة للمراجعة فقط ولا تُحفظ في الجدول قبل الاعتماد */
export async function aiExtractBoq(tenderId: number, fd: FormData): Promise<BoqExtractionResult> {
  let user: AppUser | null = null;
  let file: Picked | null = null;
  let geminiFile: string | undefined;
  try {
    user = await actionUser();
    await assertBoqEditor(user, tenderId);
    if (!geminiConfigured()) throw new AppError("الاستخراج الآلي غير مفعّل: مفتاح Google Gemini غير مضبوط على الخادم");
    file = await pickFile(fd, user.id);
    const prepared = await fileToParts(file);
    geminiFile = prepared.geminiFile;
    const r = await extractBoq(prepared.parts);
    if (r.items.length === 0) throw new AppError("لم يُعثر على بنود جدول كميات في المستند");
    const items = await withPriceHints(tenderId, r.items);
    const log = await db.aiExtraction.create({ data: { kind: "BOQ", tenderId, fileName: file.name, mimeType: file.type, model: r.model, status: "OK", result: JSON.stringify(r.items), durationMs: r.ms, userId: user.id } });
    // ملف جدول الكميات لا يُحفظ كمرفق — يُحذف من منطقة العبور بعد نجاح القراءة (يبقى عند الفشل لإعادة المحاولة)
    if (file.staged) await consumeStaged(file.staged).catch(() => undefined);
    await auditEvent("ai_extract", "BoqItem", `استخراج آلي لجدول الكميات (${r.model}) من «${file.name}» — ${r.items.length} بنداً بانتظار المراجعة`, user, { recordId: tenderId });
    return { ok: true, extractionId: log.id, items, dropped: r.dropped, title: r.title, notes: r.notes, model: r.model, ms: r.ms };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "تعذر الاستخراج";
    if (user && file) await db.aiExtraction.create({ data: { kind: "BOQ", tenderId, fileName: file.name, mimeType: file.type, model: geminiModel(), status: "ERROR", error: msg.slice(0, 900), userId: user.id } }).catch(() => undefined);
    return { ok: false, error: msg };
  } finally {
    if (geminiFile) await deleteGeminiFile(geminiFile);
  }
}

const applySchema = z.array(
  z.object({
    idx: z.number().int().min(0),
    itemNo: z.string().trim().max(40).nullable(),
    description: z.string().trim().min(2, "وصف البند قصير").max(4000),
    unit: z.string().trim().min(1, "الوحدة مطلوبة").max(40),
    quantity: z.number().finite().min(0, "الكمية سالبة"),
    unitPrice: z.number().finite().min(0, "السعر سالب"),
    category: z.string().refine((c) => c in BOQ_CATEGORY, "تصنيف غير صالح"),
  }),
).min(1, "اختر بنداً واحداً على الأقل").max(1500);

/** اعتماد البنود بعد المراجعة اليدوية: تُضاف لجدول الكميات مع رقم الصفحة والمرجع والقيم الأصلية كما قرأها النموذج */
export async function aiApplyBoq(tenderId: number, extractionId: number, items: unknown): Promise<{ ok: boolean; message: string }> {
  try {
    const user = await actionUser();
    await assertBoqEditor(user, tenderId);
    if (user.role === "ACCOUNTANT") throw new AppError("إدخال البنود لمدير المشروع المسند أو المدير العام");
    const ex = await db.aiExtraction.findUnique({ where: { id: extractionId } });
    if (!ex || ex.tenderId !== tenderId || ex.kind !== "BOQ" || ex.status !== "OK") throw new AppError("عملية الاستخراج غير موجودة");
    if (ex.appliedAt) throw new AppError("اعتُمدت بنود هذا الاستخراج مسبقاً");
    const rows = applySchema.parse(items);
    const original = JSON.parse(ex.result ?? "[]") as ExtractedBoqItem[];
    const max = await db.boqItem.aggregate({ where: { tenderId }, _max: { sortOrder: true } });
    let order = max._max.sortOrder ?? 0;
    await db.$transaction([
      db.boqItem.createMany({
        data: rows.map((r) => {
          const o = original[r.idx];
          return {
            tenderId,
            itemNo: r.itemNo,
            description: r.description,
            normalized: normalizeText(r.description),
            unit: r.unit,
            quantity: round3(r.quantity),
            unitPrice: round3(r.unitPrice),
            category: r.category,
            sortOrder: ++order,
            source: "AI",
            sourcePage: o?.page ?? null,
            sourceRef: [o?.ref, o?.section].filter(Boolean).join(" — ").slice(0, 300) || null,
            aiOriginal: o ? JSON.stringify({ itemNo: o.itemNo, description: o.description, unit: o.unit, quantity: o.quantity, unitPrice: o.unitPrice, total: o.total, page: o.page }) : null,
          };
        }),
      }),
      db.aiExtraction.update({ where: { id: extractionId }, data: { appliedAt: new Date() } }),
      db.tender.updateMany({ where: { id: tenderId, status: "PURCHASED" }, data: { status: "PRICING" } }),
    ]);
    await auditEvent("ai_apply", "BoqItem", `اعتماد ${rows.length} بنداً مستخرجاً آلياً بعد المراجعة — عطاء #${tenderId}`, user, { recordId: tenderId });
    revalidatePath(`/tenders/${tenderId}`);
    return { ok: true, message: `أُضيف ${rows.length} بنداً لجدول الكميات` };
  } catch (e) {
    return { ok: false, message: e instanceof z.ZodError ? e.issues[0]?.message ?? "بيانات غير صالحة" : e instanceof Error ? e.message : "تعذر الحفظ" };
  }
}

export type InvoiceExtractionResult = { ok: true; data: ExtractedInvoice; model: string } | { ok: false; error: string };

/** قراءة فاتورة شراء آلياً لتعبئة نموذج المصروف — يراجعها المستخدم ويعدّلها قبل الحفظ */
export async function aiExtractInvoice(fd: FormData): Promise<InvoiceExtractionResult> {
  let user: AppUser | null = null;
  let file: Picked | null = null;
  let geminiFile: string | undefined;
  try {
    user = await actionUser();
    if (!geminiConfigured()) throw new AppError("القراءة الآلية غير مفعّلة: مفتاح Google Gemini غير مضبوط على الخادم");
    file = await pickFile(fd, user.id);
    const prepared = await fileToParts(file);
    geminiFile = prepared.geminiFile;
    const { parts } = prepared;
    const projects = await db.tender.findMany({ where: { ...tenderScope(user), status: { in: ["WON", "EXECUTION", "MAINTENANCE"] } }, select: { id: true, name: true, location: true } });
    const r = await extractInvoice(parts, projects);
    if (r.data.projectId) await assertTenderAccess(user, r.data.projectId).catch(() => (r.data.projectId = null));
    await db.aiExtraction.create({ data: { kind: "INVOICE", tenderId: r.data.projectId, fileName: file.name, mimeType: file.type, model: r.model, status: "OK", result: JSON.stringify(r.data), durationMs: r.ms, userId: user.id } });
    return { ok: true, data: r.data, model: r.model };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "تعذرت القراءة";
    if (user && file) await db.aiExtraction.create({ data: { kind: "INVOICE", fileName: file.name, mimeType: file.type, model: geminiModel(), status: "ERROR", error: msg.slice(0, 900), userId: user.id } }).catch(() => undefined);
    return { ok: false, error: msg };
  } finally {
    // ملف الفاتورة المرفوع مباشرة يبقى في منطقة العبور ليُرفق بالمصروف عند الحفظ
    if (geminiFile) await deleteGeminiFile(geminiFile);
  }
}

export async function aiStatus() {
  await actionUser(undefined, { readOnlyOk: true });
  return { configured: geminiConfigured(), model: geminiModel(), canSee: true };
}


/* ═════ القراءة على دفعات للمستندات الطويلة (PDF) ═════
 * كل دفعة صفحتان في طلب قصير مستقل (ضمن حد زمن Vercel وحدود Gemini)، يديرها المتصفح بالتوازي مع شريط تقدم،
 * ثم تُدمج البنود بأرقام صفحاتها الأصلية وتُعرض للمراجعة كالمعتاد. */

export type BoqPlan = { ok: true; pages: number; ranges: [number, number][]; concurrency: number; model: string } | { ok: false; error: string };

export async function aiBoqStart(tenderId: number, fd: FormData): Promise<BoqPlan> {
  try {
    const user = await actionUser();
    await assertBoqEditor(user, tenderId);
    if (!geminiConfigured()) throw new AppError("الاستخراج الآلي غير مفعّل: مفتاح Google Gemini غير مضبوط على الخادم");
    const file = await pickFile(fd, user.id);
    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) return { ok: true, pages: 0, ranges: [], concurrency: 1, model: geminiModel() };
    let pages = 0;
    try {
      pages = await pdfPageCount(file.data);
    } catch {
      // تعذر تقسيمه (محمي/بنية غير معتادة) — يُرسل كاملاً في قراءة واحدة
      return { ok: true, pages: 0, ranges: [], concurrency: 1, model: geminiModel() };
    }
    if (pages > 600) throw new AppError(`المستند ${pages} صفحة — قسّمه إلى ملفات أصغر (حتى 600 صفحة)`);
    // مستند قصير: قراءة واحدة
    if (pages <= PAGES_PER_CHUNK) return { ok: true, pages, ranges: [], concurrency: 1, model: geminiModel() };
    return { ok: true, pages, ranges: chunkRanges(pages), concurrency: Math.max(1, Number(process.env.GEMINI_CONCURRENCY || 3)), model: geminiModel() };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "تعذر تجهيز الملف" };
  }
}

export type BoqChunkResult = { ok: true; items: ExtractedBoqItem[]; dropped: number; title: string | null; ms: number; model: string } | { ok: false; error: string };

export async function aiBoqChunk(tenderId: number, fd: FormData, from: number, to: number, timeoutMs?: number): Promise<BoqChunkResult> {
  try {
    const user = await actionUser();
    await assertBoqEditor(user, tenderId);
    const file = await pickFile(fd, user.id);
    const total = await pdfPageCount(file.data);
    const a = Math.max(1, Math.floor(from));
    const b = Math.min(total, Math.floor(to));
    if (!(a <= b) || b - a + 1 > 10) throw new AppError("نطاق صفحات غير صالح");
    const slice = await pdfSlice(file.data, a, b);
    const { parts } = await fileToParts({ name: file.name, type: "application/pdf", data: slice });
    const r = await extractBoq(parts, { from: a, to: b, total }, timeoutMs);
    return { ok: true, items: r.items, dropped: r.dropped, title: r.title, ms: r.ms, model: r.model };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "تعذرت قراءة الصفحات" };
  }
}

/** دمج الدفعات: تحقق من البنود (المخطط نفسه) + مقارنة الأسعار + سجل الاستخراج + حذف الملف من منطقة العبور */
export async function aiBoqFinish(
  tenderId: number,
  fd: FormData,
  payload: { items: unknown[]; title: string | null; fileName: string; failed: string[]; ms: number; dropped: number; models?: string[] },
): Promise<BoqExtractionResult> {
  try {
    const user = await actionUser();
    await assertBoqEditor(user, tenderId);
    const list: ExtractedBoqItem[] = [];
    let dropped = Number(payload.dropped) || 0;
    for (const raw of (Array.isArray(payload.items) ? payload.items : []).slice(0, 3000)) {
      const p = boqItemSchema.safeParse(raw);
      if (!p.success) {
        dropped++;
        continue;
      }
      const it = p.data;
      const mismatch = it.quantity != null && it.unitPrice != null && it.total != null && Math.abs(it.quantity * it.unitPrice - it.total) > Math.max(0.01, Math.abs(it.total) * 0.005);
      list.push({ ...it, mismatch });
    }
    list.sort((x, y) => (x.page ?? 0) - (y.page ?? 0));
    const failed = (Array.isArray(payload.failed) ? payload.failed : []).map(String).slice(0, 100);
    if (list.length === 0) throw new AppError(failed.length ? `تعذرت قراءة الصفحات: ${failed.join("، ")}` : "لم يُعثر على بنود جدول كميات في المستند");
    const items = await withPriceHints(tenderId, list);
    const fileName = String(payload.fileName || "مستند").slice(0, 250);
    const notes = failed.length ? `تعذرت قراءة الصفحات ${failed.join("، ")} — راجع بنودها يدوياً أو أعد الاستخراج` : null;
    const ms = Math.round(Number(payload.ms) || 0);
    // النموذج الذي قرأ فعلاً (الأساسي، أو البديل عند نفاد الحصة اليومية)
    const usedModel = [...new Set((payload.models ?? []).map(String).filter((m) => /^[w.-]{3,60}$/.test(m)))].join() || geminiModel();
    const log = await db.aiExtraction.create({ data: { kind: "BOQ", tenderId, fileName, mimeType: "application/pdf", model: usedModel, status: "OK", result: JSON.stringify(list), durationMs: ms, error: notes, userId: user.id } });
    const token = stagedTokens(fd, "file")[0];
    if (token) await discardStaged(token, user.id).catch(() => undefined);
    await auditEvent("ai_extract", "BoqItem", `استخراج آلي لجدول الكميات (${usedModel}) من «${fileName}» على دفعات — ${list.length} بنداً بانتظار المراجعة${failed.length ? ` (تعذرت ${failed.length} دفعة)` : ""}`, user, { recordId: tenderId });
    return { ok: true, extractionId: log.id, items, dropped, title: payload.title ?? null, notes, model: usedModel, ms };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "تعذر دمج النتائج" };
  }
}

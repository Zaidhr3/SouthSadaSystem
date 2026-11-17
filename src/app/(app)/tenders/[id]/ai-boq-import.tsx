"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { AlertTriangle, FileUp, Loader2, Sparkles, Wand2 } from "lucide-react";
import { useToast } from "@/components/toast";
import { BOQ_CATEGORY } from "@/lib/labels";
import { parseNum } from "@/lib/num";
import { aiApplyBoq, aiBoqFinish, aiBoqStart, aiExtractBoq, type BoqExtractionResult } from "../../actions/ai";
import { DIRECT_UPLOAD, INLINE_MAX_MB, MAX_FILE_MB, uploadDirect } from "@/lib/direct-upload";

type Ok = Extract<BoqExtractionResult, { ok: true }>;
type ChunkResult = { ok: true; items: unknown[]; dropped: number; title: string | null; model?: string } | { ok: false; error: string };

/** دفعة صفحات عبر مسار API (تعمل بالتوازي فعلاً، بخلاف Server Actions التي تُنفذ بالدور) */
async function readChunk(tenderId: number, base: FormData, from: number, to: number): Promise<ChunkResult> {
  const fd = new FormData();
  base.forEach((v, k) => fd.append(k, v));
  fd.set("tenderId", String(tenderId));
  fd.set("from", String(from));
  fd.set("to", String(to));
  try {
    const res = await fetch("/api/ai/boq/chunk", { method: "POST", body: fd, cache: "no-store" });
    if (res.status === 401) return { ok: false, error: "انتهت الجلسة — سجّل الدخول مجدداً" };
    const j = (await res.json().catch(() => null)) as ChunkResult | null;
    return j ?? { ok: false, error: `HTTP ${res.status}` };
  } catch {
    return { ok: false, error: "انقطع الاتصال" };
  } finally {
    window.dispatchEvent(new Event("ssc-busy"));
  }
}
type Row = { idx: number; on: boolean; itemNo: string; description: string; unit: string; quantity: string; unitPrice: string; category: string; src: Ok["items"][number] };

const nf = new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 });

/**
 * التفريغ الآلي لجدول الكميات (Google Gemini): رفع وثيقة العطاء (PDF / صور / Excel)
 * ← استخراج البنود والوحدات والكميات مع رقم الصفحة ← مراجعة وتعديل يدوي ← تسعير بمقارنة الأسعار التاريخية ← اعتماد.
 * لا يُحفظ أي بند قبل المراجعة والاعتماد.
 */
export function AiBoqImport({ tenderId, configured, model, canApply }: { tenderId: number; configured: boolean; model: string; canApply: boolean }) {
  const toast = useToast();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [saving, startSave] = useTransition();
  const [res, setRes] = useState<Ok | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [upPct, setUpPct] = useState<number | null>(null);
  // تقدم القراءة على دفعات (المستندات الطويلة): عدد الدفعات المنجزة من الكل
  const [readProg, setReadProg] = useState<{ done: number; total: number; pages: number } | null>(null);
  // الملف الكبير يُرفع مرة واحدة إلى التخزين السحابي — إعادة المحاولة تستخدم نفس الرفع
  const stagedRef = useRef<{ key: string; token: string } | null>(null);

  /** المستند الطويل يُقرأ على دفعات صفحات متوازية (كل دفعة طلب قصير) ثم تُدمج — والقصير/الصور/Excel قراءة واحدة */
  const readDocument = async (fd: FormData, fileName: string): Promise<BoqExtractionResult> => {
    const plan = await aiBoqStart(tenderId, fd);
    if (!plan.ok) return plan;
    if (plan.ranges.length === 0) return aiExtractBoq(tenderId, fd);
    const started = Date.now();
    const items: unknown[] = [];
    const failed: string[] = [];
    let title: string | null = null;
    let dropped = 0;
    const models = new Set<string>();
    let next = 0;
    let done = 0;
    setReadProg({ done: 0, total: plan.ranges.length, pages: plan.pages });
    // الجلسة لا تُقفل تلقائياً أثناء القراءة الطويلة
    const keepAlive = window.setInterval(() => window.dispatchEvent(new Event("ssc-busy")), 20_000);
    const worker = async () => {
      while (next < plan.ranges.length) {
        const [a, b] = plan.ranges[next++];
        let r = await readChunk(tenderId, fd, a, b);
        // إعادة محاولة الدفعة الفاشلة مرتين بعد انتظار متزايد (حدود الاستخدام المؤقتة)
        for (let i = 1; !r.ok && i <= 2; i++) {
          await new Promise((ok) => setTimeout(ok, 8000 * i));
          r = await readChunk(tenderId, fd, a, b);
        }
        if (r.ok) {
          items.push(...r.items);
          dropped += r.dropped;
          title = title ?? r.title;
          if (r.model) models.add(r.model);
        } else failed.push(a === b ? String(a) : `${a}–${b}`);
        setReadProg({ done: ++done, total: plan.ranges.length, pages: plan.pages });
      }
    };
    try {
      await Promise.all(Array.from({ length: Math.min(plan.concurrency, plan.ranges.length) }, worker));
      return await aiBoqFinish(tenderId, fd, { items, title, fileName, failed, ms: Date.now() - started, dropped, models: [...models] });
    } finally {
      window.clearInterval(keepAlive);
      setReadProg(null);
    }
  };

  const extract = () => {
    const f = fileRef.current?.files?.[0];
    if (!f) return setErr("اختر ملف جدول الكميات أولاً");
    setErr(null);
    const big = f.size > INLINE_MAX_MB * 1024 * 1024;
    if (big && !DIRECT_UPLOAD) return setErr(`حجم الملف أكبر من ${INLINE_MAX_MB} ميغابايت — قسّم المستند أو صوّر الصفحات المطلوبة`);
    if (f.size > MAX_FILE_MB * 1024 * 1024) return setErr(`حجم الملف أكبر من ${MAX_FILE_MB} ميغابايت — قسّم المستند إلى أجزاء`);
    start(async () => {
      const fd = new FormData();
      if (big) {
        const key = `${f.name}:${f.size}:${f.lastModified}`;
        if (stagedRef.current?.key !== key) {
          try {
            setUpPct(0);
            const [ref] = await uploadDirect([f], setUpPct, "boq");
            stagedRef.current = { key, token: ref.token };
          } catch (e) {
            const m = e instanceof Error ? e.message : "تعذر رفع الملف";
            setErr(m);
            toast("error", m);
            return;
          } finally {
            setUpPct(null);
          }
        }
        fd.set("file__staged", stagedRef.current!.token);
      } else fd.set("file", f);
      const r = await readDocument(fd, f.name);
      if (r.ok) stagedRef.current = null;
      if (!r.ok) {
        setErr(r.error);
        toast("error", r.error);
        return;
      }
      setRes(r);
      setRows(
        r.items.map((it, idx) => ({
          idx,
          on: true,
          itemNo: it.itemNo ?? "",
          description: it.description,
          unit: it.unit ?? "",
          quantity: it.quantity == null ? "" : String(it.quantity),
          unitPrice: it.unitPrice == null ? "" : String(it.unitPrice),
          category: it.category,
          src: it,
        })),
      );
      toast("success", `استُخرج ${r.items.length} بنداً — راجعها قبل الاعتماد`);
    });
  };

  const set = (idx: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.idx === idx ? { ...r, ...patch } : r)));
  const chosen = rows.filter((r) => r.on);
  const problems = chosen.filter((r) => !r.unit.trim() || parseNum(r.quantity) == null || Number.isNaN(parseNum(r.quantity) as number) || Number.isNaN((parseNum(r.unitPrice) ?? 0) as number));
  const total = chosen.reduce((s, r) => s + (parseNum(r.quantity) || 0) * (parseNum(r.unitPrice) || 0), 0);

  const apply = () => {
    if (!res) return;
    if (problems.length) return toast("error", `${problems.length} بنود ينقصها وحدة أو كمية صالحة — أكملها أو ألغِ تحديدها`);
    startSave(async () => {
      const r = await aiApplyBoq(
        tenderId,
        res.extractionId,
        chosen.map((x) => ({ idx: x.idx, itemNo: x.itemNo.trim() || null, description: x.description.trim(), unit: x.unit.trim(), quantity: parseNum(x.quantity) ?? 0, unitPrice: parseNum(x.unitPrice) ?? 0, category: x.category })),
      );
      toast(r.ok ? "success" : "error", r.message);
      if (r.ok) {
        setRes(null);
        setRows([]);
        if (fileRef.current) fileRef.current.value = "";
        router.refresh();
      }
    });
  };

  return (
    <section className="card card-pad mb-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-[17px] font-bold"><Wand2 className="h-5 w-5 text-accent" aria-hidden /> التفريغ الآلي لجدول الكميات (الذكاء الاصطناعي)</h2>
        <span className="rounded-full bg-black/[0.05] px-2.5 py-1 text-[11px] font-semibold text-ink-muted" dir="ltr">Google {model}</span>
      </div>
      {!configured ? (
        <p className="rounded-xl bg-warn-soft px-3 py-2 text-sm font-semibold text-warn">الاستخراج الآلي غير مفعّل بعد — يحتاج المدير العام لضبط مفتاح Google Gemini على الخادم.</p>
      ) : (
        <>
          <p className="mb-3 text-sm text-ink-muted">ارفع وثيقة العطاء (PDF أو صور الصفحات أو Excel حتى {MAX_FILE_MB} ميغابايت{DIRECT_UPLOAD ? " — الملفات الكبيرة تُرفع مباشرة للتخزين السحابي" : ""}). يستخرج النظام رقم البند والوصف والوحدة والكمية مع رقم الصفحة — دون افتراض أي قيمة غير مكتوبة — ثم تراجعها وتسعّرها قبل الإضافة.</p>
          <div className="flex flex-wrap items-center gap-2">
            <input ref={fileRef} type="file" accept=".pdf,image/*,.xlsx" className="input max-w-sm" aria-label="ملف جدول الكميات" />
            <button type="button" onClick={extract} disabled={pending} className="btn-primary">
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />} {upPct !== null ? `جارٍ الرفع… ${upPct}%` : readProg ? `جارٍ القراءة… ${Math.round((readProg.done / readProg.total) * 100)}%` : pending ? "جارٍ القراءة…" : "استخراج البنود"}
            </button>
          </div>
          {upPct !== null && (
            <div className="mt-2 h-1.5 max-w-sm overflow-hidden rounded-full bg-black/[0.06]" role="progressbar" aria-valuenow={upPct} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full rounded-full bg-accent transition-[width] duration-200" style={{ width: `${upPct}%` }} />
            </div>
          )}
          {readProg && (
            <div className="mt-2 max-w-sm">
              <div className="h-1.5 overflow-hidden rounded-full bg-black/[0.06]" role="progressbar" aria-valuenow={readProg.done} aria-valuemin={0} aria-valuemax={readProg.total}>
                <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${(readProg.done / readProg.total) * 100}%` }} />
              </div>
              <p className="mt-1 text-xs text-ink-muted">
                مستند من {readProg.pages} صفحة — قُرئت {readProg.done} من {readProg.total} دفعة (صفحتان لكل دفعة). لا تغلق الصفحة.
              </p>
            </div>
          )}
          {pending && upPct === null && !readProg && <p className="mt-2 text-xs text-ink-muted">قد تستغرق القراءة حتى دقيقة حسب حجم المستند…</p>}
          {err && <p className="mt-2 rounded-xl bg-bad-soft px-3 py-2 text-sm font-semibold text-bad" role="alert">{err}</p>}
        </>
      )}

      {res && rows.length > 0 && (
        <div className="mt-5 animate-fade-in">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="font-bold">
              مراجعة {rows.length} بنداً{res.title ? ` — ${res.title}` : ""} <span className="font-normal text-ink-muted">({(res.ms / 1000).toFixed(1)} ث{res.dropped ? ` — تُجوهل ${res.dropped} سطراً غير صالح` : ""})</span>
            </span>
            <span className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={() => setRows((rs) => rs.map((r) => (r.unitPrice === "" && r.src.hint ? { ...r, unitPrice: String(r.src.hint.suggested) } : r)))}
              >
                <Sparkles className="h-4 w-4" /> تعبئة الأسعار الفارغة بالمقترحة
              </button>
            </span>
          </div>
          {res.notes && (
            <p className={clsx("mb-2 rounded-xl px-3 py-2 text-xs", res.notes.startsWith("تعذرت قراءة") ? "bg-warn-soft font-semibold text-warn" : "bg-canvas text-ink-soft")}>
              {res.notes.startsWith("تعذرت قراءة") ? res.notes : `ملاحظة النموذج: ${res.notes}`}
            </p>
          )}
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th />
                  <th>رقم</th>
                  <th>الوصف</th>
                  <th>الوحدة</th>
                  <th className="text-end">الكمية</th>
                  <th className="text-end">سعر الوحدة</th>
                  <th>السعر التاريخي</th>
                  <th>التصنيف</th>
                  <th>المرجع</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const h = r.src.hint;
                  const low = r.src.confidence < 0.6;
                  return (
                    <tr key={r.idx} className={clsx(!r.on && "opacity-40", (r.src.mismatch || low) && r.on && "bg-warn-soft/40")}>
                      <td><input type="checkbox" checked={r.on} onChange={(e) => set(r.idx, { on: e.target.checked })} aria-label="تضمين البند" /></td>
                      <td><input className="input w-20 py-1.5 text-xs" value={r.itemNo} onChange={(e) => set(r.idx, { itemNo: e.target.value })} aria-label="رقم البند" /></td>
                      <td className="min-w-[260px]">
                        <textarea className="input min-h-[60px] py-1.5 text-xs" value={r.description} onChange={(e) => set(r.idx, { description: e.target.value })} aria-label="الوصف" />
                        {(r.src.mismatch || low) && (
                          <span className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-warn">
                            <AlertTriangle className="h-3 w-3" /> {r.src.mismatch ? `الكمية × السعر ≠ الإجمالي في المستند (${nf.format(r.src.total ?? 0)})` : "قراءة غير واضحة — تحقق من المستند"}
                          </span>
                        )}
                      </td>
                      <td><input className={clsx("input w-20 py-1.5 text-xs", !r.unit.trim() && r.on && "input-error")} value={r.unit} onChange={(e) => set(r.idx, { unit: e.target.value })} aria-label="الوحدة" /></td>
                      <td><input inputMode="decimal" className={clsx("input num w-24 py-1.5 text-end text-xs", r.on && parseNum(r.quantity) == null && "input-error")} value={r.quantity} onChange={(e) => set(r.idx, { quantity: e.target.value })} aria-label="الكمية" /></td>
                      <td><input inputMode="decimal" className="input num w-24 py-1.5 text-end text-xs" value={r.unitPrice} onChange={(e) => set(r.idx, { unitPrice: e.target.value })} placeholder="سعّر" aria-label="سعر الوحدة" /></td>
                      <td className="min-w-[150px] text-[11px]">
                        {h ? (
                          <button type="button" className="text-start hover:underline" onClick={() => set(r.idx, { unitPrice: String(h.suggested) })} title="استخدام السعر المقترح">
                            <b className="num text-accent">{nf.format(h.suggested)}</b> مقترح
                            <span className="block text-ink-muted">متوسط {nf.format(h.avg)} ({h.count} مرة، {h.years})</span>
                            {h.sameEntityAvg != null && <span className="block text-good">نفس الجهة: {nf.format(h.sameEntityAvg)}</span>}
                          </button>
                        ) : (
                          <span className="text-ink-faint">لا سابقة</span>
                        )}
                      </td>
                      <td>
                        <select className="input py-1.5 text-xs" value={r.category} onChange={(e) => set(r.idx, { category: e.target.value })} aria-label="التصنيف">
                          {Object.entries(BOQ_CATEGORY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                        </select>
                      </td>
                      <td className="whitespace-nowrap text-[11px] text-ink-muted">{r.src.page ? `ص ${r.src.page}` : "—"}{r.src.ref ? ` · ${r.src.ref}` : ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm">
              {chosen.length} بنداً محدداً — الإجمالي المسعّر <b className="num">{nf.format(total)}</b> د.أ
              {problems.length > 0 && <span className="ms-2 font-semibold text-bad">{problems.length} بنود ناقصة</span>}
            </span>
            {canApply ? (
              <button type="button" onClick={apply} disabled={saving || chosen.length === 0} className="btn-primary">
                {saving && <Loader2 className="h-4 w-4 animate-spin" />} اعتماد وإضافة للجدول
              </button>
            ) : (
              <span className="text-xs text-ink-muted">الإضافة للجدول لمدير المشروع المسند أو المدير العام</span>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

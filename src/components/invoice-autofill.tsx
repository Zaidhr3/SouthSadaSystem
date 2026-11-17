"use client";

import { useRef, useState, useTransition } from "react";
import { Loader2, ScanText } from "lucide-react";
import { useToast } from "./toast";
import { aiExtractInvoice } from "@/app/(app)/actions/ai";
import { EXPENSE_CATEGORY } from "@/lib/labels";

function setField(form: HTMLFormElement, name: string, value: string | number | null | undefined) {
  if (value == null || value === "") return false;
  const el = form.elements.namedItem(name);
  if (!(el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement)) return false;
  if (el instanceof HTMLSelectElement && !Array.from(el.options).some((o) => o.value === String(value))) return false;
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, String(value));
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  return true;
}

/**
 * قراءة الفاتورة آلياً (Google Gemini): تُقرأ صورة الفاتورة المرفقة وتُعبأ حقول المصروف
 * (المبلغ، التاريخ، المورد، البيان، التصنيف، المشروع إن ذُكر) — يراجعها المستخدم ويعدّلها قبل الحفظ.
 */
export function InvoiceAutoFill() {
  const ref = useRef<HTMLDivElement>(null);
  const toast = useToast();
  const [pending, start] = useTransition();
  const [info, setInfo] = useState<string | null>(null);

  const run = () => {
    const form = ref.current?.closest("form");
    const input = form?.querySelector<HTMLInputElement>('input[type="file"][name="files"]');
    const file = input?.files?.[0];
    // الملف الكبير يكون قد رُفع مباشرة للتخزين السحابي — يُرسل رمزه فقط
    const staged = form?.querySelector<HTMLInputElement>('input[type="hidden"][name="files__staged"]')?.value;
    if (!form || (!file && !staged)) return toast("error", "أرفق صورة الفاتورة أولاً ثم اضغط «قراءة الفاتورة آلياً»");
    const fd = new FormData();
    if (file) fd.set("file", file);
    else fd.set("file__staged", staged!);
    start(async () => {
      const r = await aiExtractInvoice(fd);
      if (!r.ok) return void toast("error", r.error);
      const d = r.data;
      const filled = [
        setField(form, "amount", d.total ?? d.subtotal),
        setField(form, "date", d.date),
        setField(form, "vendor", d.supplier),
        setField(form, "description", d.description ?? (d.items.length ? d.items.slice(0, 3).map((i) => i.description).join("، ") : null)),
        setField(form, "category", d.category),
        setField(form, "tenderId", d.projectId),
      ].filter(Boolean).length;
      setInfo(`${d.supplier ?? "مورد غير مقروء"}${d.invoiceNo ? ` — فاتورة ${d.invoiceNo}` : ""} — ${EXPENSE_CATEGORY[d.category] ?? ""}${d.confidence < 0.6 ? " — قراءة غير واضحة، تحقق من الحقول" : ""}`);
      toast("success", `عُبئ ${filled} حقول من الفاتورة — راجعها قبل الحفظ`);
    });
  };

  return (
    <div ref={ref} className="rounded-xl border border-dashed border-accent/40 bg-accent-soft/40 p-3">
      <button type="button" onClick={run} disabled={pending} className="btn-secondary btn-sm">
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanText className="h-4 w-4" />} {pending ? "جارٍ قراءة الفاتورة…" : "قراءة الفاتورة آلياً"}
      </button>
      <p className="mt-1 text-[11px] text-ink-muted">{info ?? "أرفق صورة الفاتورة أدناه ثم اضغط — تُعبأ الحقول تلقائياً للمراجعة (لا شيء يُحفظ قبل ضغط «حفظ»)."}</p>
    </div>
  );
}

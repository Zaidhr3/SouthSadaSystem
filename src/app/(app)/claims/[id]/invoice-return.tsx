"use client";

import { useState } from "react";
import { ModalForm, Textarea } from "@/components/forms";
import { parseNum } from "@/lib/num";
import { authorizeInvoiceReturn, decideInvoiceReturn, requestInvoiceReturn } from "../../actions/einv-return";

type Line = { lineNo: number; description: string; unit: string; qty: number; price: number; discount: number; left: number };
const nf = new Intl.NumberFormat("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 });

/**
 * المحاسب: إعداد فاتورة إرجاع — كمية لكل بند حتى المتبقي + السبب.
 * permitReason = تكليف قائم من المدير العام ← تُرسل مباشرة لنظام الفوترة؛ وإلا تُرفع طلب إذن للمدير العام.
 */
export function InvoiceReturnForm({ claimId, lines, invoiceNo, permitReason }: { claimId: number; lines: Line[]; invoiceNo: number; permitReason?: string | null }) {
  const [qty, setQty] = useState<Record<number, string>>({});
  const total = lines.reduce((s, l) => {
    const q = parseNum(qty[l.lineNo] ?? "") || 0;
    return s + q * l.price - (l.qty ? (l.discount * q) / l.qty : 0);
  }, 0);
  if (!lines.some((l) => l.left > 0)) return <span className="text-xs text-ink-muted">أُرجعت كامل بنود الفاتورة SADA-{invoiceNo}</span>;
  const direct = !!permitReason;
  return (
    <ModalForm
      title={`فاتورة إرجاع على الفاتورة SADA-${invoiceNo}`}
      trigger={direct ? "إعداد وإرسال فاتورة الإرجاع" : "طلب فاتورة إرجاع"}
      triggerClass={direct ? "btn-primary" : "btn-secondary"}
      action={requestInvoiceReturn.bind(null, claimId)}
      submitLabel={direct ? "إرسال لنظام الفوترة" : "إرسال طلب الإذن للمدير العام"}
      wide
      draft={false}
    >
      <input type="hidden" name="lines" value={JSON.stringify(lines.map((l) => ({ lineNo: l.lineNo, qty: qty[l.lineNo] ?? "" })))} />
      <p className={`rounded-xl px-3 py-2 text-xs font-semibold ${direct ? "bg-warn-soft text-warn" : "bg-canvas text-ink-muted"}`}>
        {direct
          ? `بتكليف من المدير العام: ${permitReason} — تُرسل فاتورة الإرجاع لنظام الفوترة الوطني فوراً (إجراء ضريبي رسمي).`
          : "يُرفع الطلب للمدير العام (إشعار ومراسلة داخلية) — بعد موافقته ترسلها لنظام الفوترة. الأسعار وأرقام البنود كما في الفاتورة المعتمدة."}
      </p>
      <div className="flex justify-end">
        <button type="button" className="btn-secondary btn-sm" onClick={() => setQty(Object.fromEntries(lines.map((l) => [l.lineNo, l.left ? String(l.left) : ""])))}>
          إرجاع كامل المتبقي
        </button>
      </div>
      <div className="max-h-[45vh] overflow-auto rounded-xl border border-line">
        <table className="w-full min-w-[600px] text-sm">
          <thead className="sticky top-0 bg-canvas text-xs text-ink-muted">
            <tr>
              <th className="p-2">#</th>
              <th className="p-2 text-start">البند</th>
              <th className="p-2">المباع</th>
              <th className="p-2">المتبقي</th>
              <th className="p-2">السعر</th>
              <th className="w-28 p-2">الكمية المرتجعة</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.lineNo} className="border-t border-line">
                <td className="p-2 text-center num">{l.lineNo}</td>
                <td className="p-2">{l.description} <span className="text-xs text-ink-muted">({l.unit})</span></td>
                <td className="p-2 text-center num">{l.qty}</td>
                <td className="p-2 text-center num">{l.left}</td>
                <td className="p-2 text-end num">{nf.format(l.price)}</td>
                <td className="p-1.5">
                  <input aria-label={`الكمية المرتجعة للبند ${l.lineNo}`} className="input text-sm num" inputMode="decimal" disabled={l.left <= 0} value={qty[l.lineNo] ?? ""} onChange={(e) => setQty((q) => ({ ...q, [l.lineNo]: e.target.value }))} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Textarea name="reason" label="سبب الإرجاع (إلزامي — يُرسل لنظام الفوترة)" required={!direct} defaultValue={permitReason ?? ""} placeholder="مثال: تخفيض قيمة البند 2 بعد إعادة القياس من المهندس المشرف" />
      <p className="text-end text-sm font-bold">قيمة الإرجاع: <span className="num">{nf.format(total)}</span> د.أ</p>
    </ModalForm>
  );
}

/** المدير العام: تكليف المحاسب بفاتورة إرجاع (مراسلة داخلية) */
export function AuthorizeReturn({ claimId }: { claimId: number }) {
  return (
    <ModalForm title="تكليف المحاسب بفاتورة إرجاع" trigger="تكليف المحاسب بفاتورة إرجاع" triggerClass="btn-secondary" action={authorizeInvoiceReturn.bind(null, claimId)} submitLabel="إرسال التكليف للمحاسب" draft={false}>
      <p className="rounded-xl bg-canvas px-3 py-2 text-xs text-ink-muted">تصل للمحاسب مراسلة داخلية وإشعار — يعدّ البنود ويرسلها لنظام الفوترة مباشرة بهذا الإذن.</p>
      <Textarea name="reason" label="سبب الإرجاع والتعليمات" required placeholder="مثال: أرجع البند 3 كاملاً — أعادت الجهة قياسه وخُفضت الكمية" />
    </ModalForm>
  );
}

/** المدير العام: البت في طلب المحاسب */
export function DecideReturn({ id }: { id: number }) {
  return (
    <span className="flex flex-wrap gap-2">
      <ModalForm title="موافقة على فاتورة الإرجاع" trigger="موافقة" triggerClass="btn-primary btn-sm" action={decideInvoiceReturn.bind(null, id, true)} submitLabel="موافقة وإبلاغ المحاسب" draft={false}>
        <Textarea name="adminNote" label="ملاحظة للمحاسب (اختياري)" />
      </ModalForm>
      <ModalForm title="رفض طلب فاتورة الإرجاع" trigger="رفض" triggerClass="btn-danger btn-sm" action={decideInvoiceReturn.bind(null, id, false)} submitLabel="رفض الطلب" draft={false}>
        <Textarea name="adminNote" label="سبب الرفض" required />
      </ModalForm>
    </span>
  );
}

import QRCode from "qrcode";
import type { ComputedInvoice } from "@/lib/einvoice";
import { fmtDate } from "@/lib/format";
import { tafqeetJOD } from "@/lib/tafqeet";
import { Logo } from "./logo";
import { CraneMark } from "./crane-mark";

const nf = new Intl.NumberFormat("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const qf = new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 });

type Seller = { name: string; tin: string; slogan?: string };
type Buyer = { name: string; tin: string | null; project: string; tenderNo: string };
type Meta = { invoiceNo: number | null; uuid: string | null; qr: string | null; date: Date; claimLabel: string; submittedAt: Date | null; einvNumber: string | null };

const exact = "print:[-webkit-print-color-adjust:exact] print:[print-color-adjust:exact]";

/** إطار المستند الرسمي: شريط الهوية، الرافعة كعلامة مائية، العنوان، ورمز QR */
async function InvoiceFrame({
  label,
  title,
  badge,
  seller,
  qr,
  qrPlaceholder,
  printable,
  pending,
  children,
}: {
  label: string;
  title: string;
  badge?: string;
  seller: Seller;
  qr?: string | null;
  qrPlaceholder?: string;
  printable: boolean;
  pending?: string;
  children: React.ReactNode;
}) {
  const qrSvg = qr ? await QRCode.toString(qr, { type: "svg", margin: 0, errorCorrectionLevel: "M" }) : null;
  return (
    <article
      className={`doc card relative mt-6 overflow-hidden bg-white p-0 text-[13px] leading-relaxed text-black print:mt-0 print:break-before-page print:text-[11px] ${printable ? "" : "print:hidden"}`}
      aria-label={label}
    >
      {/* العلامة المائية: رافعة برجية */}
      <CraneMark className="pointer-events-none absolute -bottom-6 -start-10 h-[420px] w-[400px] text-[#0b2545] opacity-[0.06] print:opacity-[0.07]" />
      {/* شريط الهوية */}
      <header className={`relative flex items-center justify-between gap-4 bg-[#0b2545] px-6 py-4 text-white sm:px-10 ${exact}`}>
        <div className="flex items-center gap-3">
          <span className="rounded-xl bg-white p-1.5"><Logo height={48} /></span>
          <div>
            <p className="text-lg font-extrabold tracking-tight">{seller.name}</p>
            {seller.slogan && <p className="text-[11px] font-semibold text-[#f2b134]">{seller.slogan}</p>}
            {seller.tin && <p className="text-[11px] text-white/80">الرقم الضريبي: <b className="num">{seller.tin}</b></p>}
          </div>
        </div>
        {qrSvg ? (
          <div className="h-24 w-24 shrink-0 rounded-lg bg-white p-1.5" dangerouslySetInnerHTML={{ __html: qrSvg }} aria-label="رمز الاستجابة السريعة لنظام الفوترة" />
        ) : qrPlaceholder ? (
          <div className="grid h-24 w-24 shrink-0 place-items-center rounded-lg border border-dashed border-white/50 text-center text-[10px] text-white/80">{qrPlaceholder}</div>
        ) : null}
      </header>
      <div className={`h-1.5 bg-[#f2b134] ${exact}`} />
      <div className="relative px-6 pb-6 pt-4 sm:px-10">
        {pending && <p className="mb-3 rounded border border-dashed border-black/40 py-1 text-center text-xs font-bold text-black/60">{pending}</p>}
        <div className="mb-4 flex items-end justify-between gap-3 border-b-2 border-[#0b2545] pb-2">
          <h1 className="text-2xl font-extrabold text-[#0b2545]">{title}</h1>
          {badge && <span className="rounded-full bg-[#0b2545]/[0.07] px-3 py-1 text-[11px] font-bold text-[#0b2545]">{badge}</span>}
        </div>
        {children}
      </div>
    </article>
  );
}

function InfoTable({ rows }: { rows: [string, string, string, string][] }) {
  return (
    <table className="mb-5 w-full border-collapse text-[12px] print:text-[10.5px]">
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            <th className="w-[18%] border border-black/40 bg-[#0b2545]/[0.05] px-2 py-1.5 text-start font-bold">{r[0]}</th>
            <td className="w-[32%] border border-black/40 px-2 py-1.5">{r[1]}</td>
            <th className="w-[18%] border border-black/40 bg-[#0b2545]/[0.05] px-2 py-1.5 text-start font-bold">{r[2]}</th>
            <td className="w-[32%] border border-black/40 px-2 py-1.5 num" style={{ direction: "rtl" }}>{r[3]}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function LinesTable({ inv, withTax, lineNos }: { inv: ComputedInvoice; withTax: boolean; lineNos?: number[] }) {
  return (
    <table className="w-full border-collapse text-[11.5px] print:text-[9.5px]">
      <thead>
        <tr className={`bg-[#0b2545] text-white ${exact}`}>
          {["#", "الوصف", "الوحدة", "الكمية", "سعر الوحدة", "القيمة", "الخصم", ...(withTax ? [`الضريبة ${inv.taxPct}%`] : []), "الإجمالي"].map((h) => (
            <th key={h} className="border border-[#0b2545] px-1.5 py-1.5 text-center font-bold">{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {inv.lines.map((l, i) => (
          <tr key={i} className="odd:bg-black/[0.015]">
            <td className="border border-black/40 px-1.5 py-1 text-center num">{lineNos?.[i] ?? i + 1}</td>
            <td className="border border-black/40 px-1.5 py-1">{l.description}</td>
            <td className="border border-black/40 px-1.5 py-1 text-center">{l.unit}</td>
            <td className="border border-black/40 px-1.5 py-1 text-end num">{qf.format(l.qty)}</td>
            <td className="border border-black/40 px-1.5 py-1 text-end num">{nf.format(l.price)}</td>
            <td className="border border-black/40 px-1.5 py-1 text-end num">{nf.format(l.amount)}</td>
            <td className="border border-black/40 px-1.5 py-1 text-end num">{l.discount ? nf.format(l.discount) : "—"}</td>
            {withTax && <td className="border border-black/40 px-1.5 py-1 text-end num">{nf.format(l.tax)}</td>}
            <td className="border border-black/40 px-1.5 py-1 text-end num font-bold">{nf.format(l.total)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Totals({ rows, total, totalLabel }: { rows: [string, number][]; total: number; totalLabel: string }) {
  return (
    <>
      <table className="ms-auto mt-4 w-full max-w-sm border-collapse">
        <tbody>
          {rows.map(([l, v]) => (
            <tr key={l}>
              <td className="border border-black/40 px-3 py-1.5">{l}</td>
              <td className="w-40 border border-black/40 px-3 py-1.5 text-end num">{nf.format(v)}</td>
            </tr>
          ))}
          <tr className={`bg-[#0b2545] text-white ${exact}`}>
            <td className="border border-[#0b2545] px-3 py-2 font-bold">{totalLabel}</td>
            <td className="border border-[#0b2545] px-3 py-2 text-end font-extrabold num">{nf.format(total)} د.أ</td>
          </tr>
        </tbody>
      </table>
      <p className="mt-2 text-center font-bold">{tafqeetJOD(total)}</p>
    </>
  );
}

/**
 * الفاتورة الإلكترونية (نظام الفوترة الوطني — جفوتارا) — تُطبع مع المطالبة كمعاملة واحدة.
 * لا تُطبع قبل الاعتماد وصدور رمز QR؛ قبلها معاينة على الشاشة فقط.
 */
export async function TaxInvoiceDoc({
  inv,
  seller,
  buyer,
  meta,
  variant = "tax",
  edited,
  note,
}: {
  inv: ComputedInvoice;
  seller: Seller;
  buyer: Buyer;
  meta: Meta;
  /** regular = الفاتورة العادية: نفس البنود بلا ضريبة مبيعات ولا رمز QR ولا إرسال لنظام الفوترة */
  variant?: "tax" | "regular";
  edited?: boolean;
  note?: string | null;
}) {
  if (variant === "regular") return <RegularInvoiceDoc inv={inv} seller={seller} buyer={buyer} meta={meta} note={note} />;
  const approved = !!meta.qr;
  const sales = inv.kind === "sales";
  return (
    <InvoiceFrame
      label="الفاتورة الضريبية"
      title={sales ? "فاتورة ضريبية" : "فاتورة"}
      badge="فاتورة إلكترونية — نظام الفوترة الوطني"
      seller={seller}
      qr={meta.qr}
      qrPlaceholder="رمز QR يصدر بعد الاعتماد"
      printable={approved}
      pending={approved ? undefined : "معاينة — بانتظار اعتماد نظام الفوترة الوطني (لا تُطبع قبل صدور رمز QR)"}
    >
      {(inv.inclusive || edited) && (
        <p className="-mt-2 mb-3 text-[11px] text-black/70">
          {inv.inclusive ? `الأسعار شاملة ضريبة المبيعات ${inv.taxPct}% — الضريبة مستخرجة من داخل المبلغ` : ""}
          {inv.inclusive && edited ? " · " : ""}
          {edited ? "عُدّلت يدوياً من الإدارة" : ""}
        </p>
      )}
      <InfoTable
        rows={[
          ["رقم الفاتورة", meta.invoiceNo ? `SADA-${meta.invoiceNo}` : "—", "تاريخ الإصدار", fmtDate(meta.submittedAt ?? meta.date)],
          ["المشتري (صاحب العمل)", buyer.name, "الرقم الضريبي للمشتري", buyer.tin ?? "—"],
          ["المشروع", buyer.project, "رقم العطاء", buyer.tenderNo],
          ["المرجع", meta.claimLabel, "طريقة الدفع", "ذمم (آجل)"],
        ]}
      />
      <LinesTable inv={inv} withTax={sales} />
      <Totals
        rows={[["المجموع قبل الخصم", inv.subtotal], ["الخصم", inv.discount], ...(sales ? ([["الصافي الخاضع", inv.taxable], [`ضريبة المبيعات ${inv.taxPct}%`, inv.tax]] as [string, number][]) : [])]}
        total={inv.total}
        totalLabel="إجمالي الفاتورة"
      />
      {note && <p className="mt-3 border-t border-black/30 pt-2 text-[11px]">ملاحظة: {note}</p>}
      {approved && (
        <p className="mt-4 break-all text-center text-[10px] text-black/60 num" style={{ direction: "ltr" }}>
          UUID: {meta.uuid}{meta.einvNumber ? ` · EINV: ${meta.einvNumber}` : ""}
        </p>
      )}
      <p className="mt-1 text-center text-[10px] text-black/60">صادرة إلكترونياً عبر نظام الفوترة الوطني الأردني (JoFotara)</p>
    </InvoiceFrame>
  );
}

/** الفاتورة العادية — تُطبع مع المطالبة (مع الإلكترونية أو وحدها حسب اختيار المحاسب) */
async function RegularInvoiceDoc({ inv, seller, buyer, meta, note }: { inv: ComputedInvoice; seller: Seller; buyer: Buyer; meta: Meta; note?: string | null }) {
  return (
    <InvoiceFrame label="الفاتورة العادية" title="فاتورة" badge="فاتورة عادية" seller={seller} printable>
      <InfoTable
        rows={[
          ["المشتري (صاحب العمل)", buyer.name, "التاريخ", fmtDate(meta.date)],
          ["المشروع", buyer.project, "رقم العطاء", buyer.tenderNo],
          ["المرجع", meta.claimLabel, "طريقة الدفع", "ذمم (آجل)"],
        ]}
      />
      <LinesTable inv={inv} withTax={false} />
      <Totals rows={[["المجموع", inv.subtotal], ["الخصم", inv.discount]]} total={inv.total} totalLabel="الإجمالي المستحق" />
      {note && <p className="mt-3 border-t border-black/30 pt-2 text-[11px]">ملاحظة: {note}</p>}
      <table className="mt-8 w-full border-collapse text-center text-[12px]">
        <tbody>
          <tr>
            <td className="h-20 w-1/2 border border-black/50 px-3 py-2 align-top font-bold">المحاسب</td>
            <td className="h-20 w-1/2 border border-black/50 px-3 py-2 align-top font-bold">توقيع وختم الشركة</td>
          </tr>
        </tbody>
      </table>
    </InvoiceFrame>
  );
}

/** فاتورة الإرجاع (إشعار دائن) — تُطبع بعد اعتمادها من نظام الفوترة ومعها رمز QR */
export async function ReturnInvoiceDoc({
  inv,
  seller,
  buyer,
  ret,
  lineNos,
}: {
  inv: ComputedInvoice;
  seller: Seller;
  buyer: Buyer;
  ret: { number: number; origNo: number | null; origUuid: string | null; reason: string; qr: string | null; uuid: string | null; date: Date; claimLabel: string };
  lineNos: number[];
}) {
  const approved = !!ret.qr;
  const sales = inv.kind === "sales";
  return (
    <InvoiceFrame
      label="فاتورة الإرجاع"
      title={sales ? "فاتورة إرجاع ضريبية" : "فاتورة إرجاع"}
      badge="إشعار دائن — نظام الفوترة الوطني"
      seller={seller}
      qr={ret.qr}
      qrPlaceholder="رمز QR يصدر بعد الاعتماد"
      printable={approved}
      pending={approved ? undefined : "بانتظار اعتماد نظام الفوترة الوطني — لا تُطبع قبل صدور رمز QR"}
    >
      <InfoTable
        rows={[
          ["رقم فاتورة الإرجاع", ret.number ? `SADA-${ret.number}` : "يُحدد عند الإرسال", "التاريخ", fmtDate(ret.date)],
          ["الفاتورة الأصلية", ret.origNo ? `SADA-${ret.origNo}` : "—", "المشتري", buyer.name],
          ["المشروع", buyer.project, "المرجع", ret.claimLabel],
        ]}
      />
      <p className="mb-3 rounded border border-black/30 bg-black/[0.02] px-3 py-2 text-[12px]"><b>سبب الإرجاع:</b> {ret.reason}</p>
      <LinesTable inv={inv} withTax={sales} lineNos={lineNos} />
      <Totals rows={[["قيمة المرتجع", inv.subtotal], ["الخصم", inv.discount], ...(sales ? ([[`ضريبة المبيعات ${inv.taxPct}%`, inv.tax]] as [string, number][]) : [])]} total={inv.total} totalLabel="إجمالي الإرجاع" />
      {approved && (
        <p className="mt-4 break-all text-center text-[10px] text-black/60 num" style={{ direction: "ltr" }}>
          UUID: {ret.uuid} · ORIGINAL: {ret.origUuid}
        </p>
      )}
    </InvoiceFrame>
  );
}

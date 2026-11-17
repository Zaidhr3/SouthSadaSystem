import "server-only";
import { randomUUID } from "crypto";
import { db } from "./db";
import { computeInvoice, type ComputedInvoice, type EinvKind } from "./einvoice";

/**
 * التكامل مع نظام الفوترة الوطني الأردني (JoFotara) — دائرة ضريبة الدخل والمبيعات.
 * - المفاتيح (Client-Id و Secret-Key) في متغيرات بيئة الخادم فقط: JOFOTARA_CLIENT_ID و JOFOTARA_SECRET_KEY.
 * - الفاتورة بصيغة UBL 2.1 (XML) مرمّزة Base64، وتُرسل إلى ‎/core/invoices/‎.
 * - الرد يتضمن: EINV_STATUS، EINV_INV_UUID، EINV_NUM، EINV_QR (رمز الاستجابة السريعة)، EINV_SINGED_INVOICE.
 * - بيانات المنشأة (الرقم الضريبي، تسلسل مصدر الدخل، الاسم، نوع الفاتورة) من «إعدادات النظام».
 */

export type EinvSettings = {
  enabled: boolean;
  tin: string;
  activityNo: string;
  companyName: string;
  kind: EinvKind;
  taxPct: number;
  buyerCity: string;
  /** الأسعار شاملة ضريبة المبيعات (الافتراضي) */
  inclusive: boolean;
  /** تصنيف الضريبة للنسبة 0% في فاتورة المبيعات: Z = معفاة، O = خاضعة بنسبة صفر (S للنسب الموجبة فقط) */
  zeroCategory: "Z" | "O";
};

export const EINV_KEYS = ["einv.enabled", "einv.tin", "einv.activityNo", "einv.companyName", "einv.kind", "einv.taxPct", "einv.buyerCity", "einv.priceMode", "einv.zeroCategory"] as const;

export async function getEinvSettings(): Promise<EinvSettings> {
  const rows = await db.setting.findMany({ where: { key: { in: [...EINV_KEYS] } } });
  const v = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    enabled: v["einv.enabled"] === "1",
    tin: v["einv.tin"] ?? "",
    activityNo: v["einv.activityNo"] ?? "",
    companyName: v["einv.companyName"] ?? "شركة صدى الجنوب للمقاولات الإنشائية",
    kind: v["einv.kind"] === "sales" ? "sales" : "income",
    // صفر قيمة صالحة (لا تُستبدل بـ 16) — الافتراضي 16 فقط إن لم يُحفظ شيء
    taxPct: v["einv.taxPct"] != null && v["einv.taxPct"] !== "" && Number.isFinite(Number(v["einv.taxPct"])) ? Number(v["einv.taxPct"]) : 16,
    buyerCity: v["einv.buyerCity"] || "JO-AM",
    inclusive: v["einv.priceMode"] !== "exclusive",
    zeroCategory: v["einv.zeroCategory"] === "O" ? "O" : "Z",
  };
}

export const jofotaraConfigured = () => !!process.env.JOFOTARA_CLIENT_ID && !!process.env.JOFOTARA_SECRET_KEY;

/** هل الإرسال الآلي جاهز؟ يعيد سبب عدم الجاهزية إن وجد */
export function einvReadiness(s: EinvSettings): string | null {
  if (!jofotaraConfigured()) return "مفاتيح الربط (Client-Id / Secret-Key) غير مضبوطة على الخادم";
  if (!s.enabled) return "الإرسال لنظام الفوترة غير مفعّل من «إعدادات النظام»";
  if (!/^\d{6,15}$/.test(s.tin)) return "الرقم الضريبي للشركة غير مُدخل في «إعدادات النظام»";
  if (!/^\d{1,15}$/.test(s.activityNo)) return "رقم تسلسل مصدر الدخل غير مُدخل في «إعدادات النظام»";
  return null;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
const amt = (n: number) => n.toFixed(3);
const qtyF = (n: number) => n.toFixed(3);
/** سعر الوحدة بدقة 9 منازل (السعر الصافي المستخرج من الشامل) حتى يطابق الكمية × السعر قيمة البند */
const priceF = (n: number) => n.toFixed(9).replace(/(\.\d{3}\d*?)0+$/, "$1");

type ClaimForInvoice = {
  id: number;
  number: number;
  type: string;
  grossAmount: number;
  deductions: number;
  submittedDate: Date;
  lines: { description: string; unit: string; periodQty: number; unitPrice: number }[];
  tender: { name: string; number: string; entity: string; employerTin: string | null; employerPhone: string | null };
  invoiceOverride?: string | null;
};

/** تعديل الإدارة على الفاتورة (يحل محل الحساب التلقائي من المطالبة) */
export type InvoiceOverride = {
  lines: { description: string; unit: string; qty: number; price: number }[];
  discount: number | null;
  buyerName: string | null;
  buyerTin: string | null;
  buyerPhone: string | null;
  note: string | null;
};

export function parseInvoiceOverride(raw: string | null | undefined): InvoiceOverride | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as InvoiceOverride;
    return Array.isArray(o.lines) ? o : null;
  } catch {
    return null;
  }
}

/** بيانات المشتري كما ستظهر في الفاتورة (مع تعديل الإدارة إن وجد) */
export function invoiceBuyer(c: ClaimForInvoice) {
  const o = parseInvoiceOverride(c.invoiceOverride);
  return { name: o?.buyerName || c.tender.entity, tin: o?.buyerTin || c.tender.employerTin, phone: o?.buyerPhone || c.tender.employerPhone, note: o?.note ?? null, edited: !!o };
}

function invoiceInput(c: ClaimForInvoice) {
  const o = parseInvoiceOverride(c.invoiceOverride);
  return {
    lines: o ? o.lines : c.lines.map((l) => ({ description: l.description, unit: l.unit, qty: l.periodQty, price: l.unitPrice })),
    gross: c.grossAmount,
    deductions: o && o.discount != null ? o.discount : c.deductions,
    fallbackLabel: `قيمة الأعمال المنجزة — ${c.type === "FINAL" ? "المطالبة النهائية" : "المطالبة"} رقم ${c.number} — ${c.tender.name}`,
  };
}

/** الفاتورة العادية: نفس البنود والمبالغ بلا ضريبة مبيعات ولا إرسال لجفوتارا */
export function regularInvoiceForClaim(c: ClaimForInvoice): ComputedInvoice {
  return computeInvoice({ ...invoiceInput(c), kind: "income", taxPct: 0 });
}

export function invoiceForClaim(c: ClaimForInvoice, s: Pick<EinvSettings, "kind" | "taxPct" | "inclusive">): ComputedInvoice {
  return computeInvoice({ ...invoiceInput(c), kind: s.kind, taxPct: s.taxPct, inclusive: s.inclusive });
}

/** بناء فاتورة UBL 2.1 حسب مواصفات نظام الفوترة الوطني */
/** فاتورة الإرجاع: مرجع الفاتورة الأصلية + السبب (إلزامي) + أرقام بنود الأصل */
export type ReturnRef = { origId: string; origUuid: string; origTotal: number; reason: string; lineIds: number[] };

export function buildInvoiceXml(c: ClaimForInvoice, inv: ComputedInvoice, s: EinvSettings, meta: { invoiceNo: number; uuid: string; issueDate: Date; ret?: ReturnRef }) {
  const ret = meta.ret;
  const sales = inv.kind === "sales";
  // 0 + (2 = ذمم) + (1 = دخل | 2 = مبيعات عامة)
  const typeName = sales ? "022" : "021";
  const cur = 'currencyID="JO"';
  const lineTax = (l: ComputedInvoice["lines"][number]) =>
    sales
      ? `<cac:TaxTotal><cbc:TaxAmount ${cur}>${amt(l.tax)}</cbc:TaxAmount><cbc:RoundingAmount ${cur}>${amt(l.total)}</cbc:RoundingAmount><cac:TaxSubtotal><cbc:TaxAmount ${cur}>${amt(l.tax)}</cbc:TaxAmount><cac:TaxCategory><cbc:ID schemeAgencyID="6" schemeID="UN/ECE 5305">${inv.taxPct > 0 ? "S" : s.zeroCategory}</cbc:ID><cbc:Percent>${inv.taxPct}</cbc:Percent><cac:TaxScheme><cbc:ID schemeAgencyID="6" schemeID="UN/ECE 5153">VAT</cbc:ID></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal></cac:TaxTotal>`
      : "";
  const lines = inv.lines
    .map(
      (l, i) =>
        `<cac:InvoiceLine><cbc:ID>${ret?.lineIds[i] ?? i + 1}</cbc:ID><cbc:InvoicedQuantity unitCode="PCE">${qtyF(l.qty)}</cbc:InvoicedQuantity><cbc:LineExtensionAmount ${cur}>${amt(l.net)}</cbc:LineExtensionAmount>${lineTax(l)}<cac:Item><cbc:Name>${esc(`${l.description} (${l.unit})`.slice(0, 250))}</cbc:Name></cac:Item><cac:Price><cbc:PriceAmount ${cur}>${priceF(l.price)}</cbc:PriceAmount><cac:AllowanceCharge><cbc:ChargeIndicator>false</cbc:ChargeIndicator><cbc:AllowanceChargeReason>DISCOUNT</cbc:AllowanceChargeReason><cbc:Amount ${cur}>${amt(l.discount)}</cbc:Amount></cac:AllowanceCharge></cac:Price></cac:InvoiceLine>`,
    )
    .join("");
  const buyer = invoiceBuyer(c);
  const buyerId = buyer.tin ? `<cac:PartyIdentification><cbc:ID schemeID="TN">${esc(buyer.tin)}</cbc:ID></cac:PartyIdentification>` : "";
  const phone = buyer.phone ? `<cac:AccountingContact><cbc:Telephone>${esc(buyer.phone)}</cbc:Telephone></cac:AccountingContact>` : "";
  const note = `${c.type === "FINAL" ? "المطالبة النهائية" : "مطالبة مرحلية"} رقم ${c.number} — ${c.tender.name} — عطاء ${c.tender.number}`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2" xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2"><cbc:ProfileID>reporting:1.0</cbc:ProfileID><cbc:ID>SADA-${meta.invoiceNo}</cbc:ID><cbc:UUID>${meta.uuid}</cbc:UUID><cbc:IssueDate>${meta.issueDate.toISOString().slice(0, 10)}</cbc:IssueDate><cbc:InvoiceTypeCode name="${typeName}">${ret ? "381" : "388"}</cbc:InvoiceTypeCode><cbc:Note>${esc(note)}</cbc:Note><cbc:DocumentCurrencyCode>JOD</cbc:DocumentCurrencyCode><cbc:TaxCurrencyCode>JOD</cbc:TaxCurrencyCode>${ret ? `<cac:BillingReference><cac:InvoiceDocumentReference><cbc:ID>${esc(ret.origId)}</cbc:ID><cbc:UUID>${esc(ret.origUuid)}</cbc:UUID><cbc:DocumentDescription>${amt(ret.origTotal)}</cbc:DocumentDescription></cac:InvoiceDocumentReference></cac:BillingReference>` : ""}<cac:AdditionalDocumentReference><cbc:ID>ICV</cbc:ID><cbc:UUID>${meta.invoiceNo}</cbc:UUID></cac:AdditionalDocumentReference><cac:AccountingSupplierParty><cac:Party><cac:PostalAddress><cac:Country><cbc:IdentificationCode>JO</cbc:IdentificationCode></cac:Country></cac:PostalAddress><cac:PartyTaxScheme><cbc:CompanyID>${esc(s.tin)}</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme><cac:PartyLegalEntity><cbc:RegistrationName>${esc(s.companyName)}</cbc:RegistrationName></cac:PartyLegalEntity></cac:Party></cac:AccountingSupplierParty><cac:AccountingCustomerParty><cac:Party>${buyerId}<cac:PostalAddress><cbc:CountrySubentityCode>${esc(s.buyerCity)}</cbc:CountrySubentityCode><cac:Country><cbc:IdentificationCode>JO</cbc:IdentificationCode></cac:Country></cac:PostalAddress><cac:PartyTaxScheme><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme><cac:PartyLegalEntity><cbc:RegistrationName>${esc(buyer.name)}</cbc:RegistrationName></cac:PartyLegalEntity></cac:Party>${phone}</cac:AccountingCustomerParty><cac:SellerSupplierParty><cac:Party><cac:PartyIdentification><cbc:ID>${esc(s.activityNo)}</cbc:ID></cac:PartyIdentification></cac:Party></cac:SellerSupplierParty>${ret ? `<cac:PaymentMeans><cbc:PaymentMeansCode listID="UN/ECE 4461">10</cbc:PaymentMeansCode><cbc:InstructionNote>${esc(ret.reason.slice(0, 250))}</cbc:InstructionNote></cac:PaymentMeans>` : ""}<cac:AllowanceCharge><cbc:ChargeIndicator>false</cbc:ChargeIndicator><cbc:AllowanceChargeReason>discount</cbc:AllowanceChargeReason><cbc:Amount ${cur}>${amt(inv.discount)}</cbc:Amount></cac:AllowanceCharge>${sales ? `<cac:TaxTotal><cbc:TaxAmount ${cur}>${amt(inv.tax)}</cbc:TaxAmount></cac:TaxTotal>` : ""}<cac:LegalMonetaryTotal><cbc:TaxExclusiveAmount ${cur}>${amt(inv.subtotal)}</cbc:TaxExclusiveAmount><cbc:TaxInclusiveAmount ${cur}>${amt(inv.total)}</cbc:TaxInclusiveAmount><cbc:AllowanceTotalAmount ${cur}>${amt(inv.discount)}</cbc:AllowanceTotalAmount><cbc:PayableAmount ${cur}>${amt(inv.total)}</cbc:PayableAmount></cac:LegalMonetaryTotal>${lines}</Invoice>`;
}

/** الرقم التالي في تسلسل مستندات الشركة (الفواتير وفواتير الإرجاع معاً) */
export async function nextInvoiceNo() {
  const [a, b] = await Promise.all([db.claim.aggregate({ _max: { invoiceNo: true } }), db.einvReturn.aggregate({ _max: { number: true } })]);
  return Math.max(a._max.invoiceNo ?? 0, b._max.number ?? 0) + 1;
}

export type ReturnLine = { lineNo: number; description: string; unit: string; qty: number; price: number; discount: number };

/** الفاتورة المحسوبة لفاتورة الإرجاع من البنود المرتجعة (أسعار الأصل الصافية وحصة الخصم) */
export function computeReturn(lines: ReturnLine[], s: Pick<EinvSettings, "kind" | "taxPct">): ComputedInvoice {
  const rate = s.kind === "sales" ? s.taxPct : 0;
  const r3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;
  const out = lines.map((l) => {
    const amount = r3(l.qty * l.price);
    const net = r3(amount - l.discount);
    const tax = r3(net * (rate / 100));
    return { description: l.description, unit: l.unit, qty: l.qty, price: l.price, priceIncl: l.price, amount, discount: r3(l.discount), net, tax, total: r3(net + tax) };
  });
  const sum = (k: "amount" | "discount" | "net" | "tax" | "total") => r3(out.reduce((t, l) => t + l[k], 0));
  return { lines: out, subtotal: sum("amount"), discount: sum("discount"), taxable: sum("net"), taxPct: rate, tax: sum("tax"), total: sum("total"), kind: s.kind, inclusive: false };
}

/** إصدار فاتورة إرجاع لدى نظام الفوترة (أو إعادة المحاولة) — لا يرمي أخطاء */
export async function issueInvoiceReturn(returnId: number): Promise<{ ok: boolean; message: string }> {
  const s = await getEinvSettings();
  const notReady = einvReadiness(s);
  if (notReady) return { ok: false, message: notReady };
  const r = await db.einvReturn.findUniqueOrThrow({ where: { id: returnId } });
  if (r.status === "SUBMITTED") return { ok: true, message: "فاتورة الإرجاع معتمدة مسبقاً" };
  const c = await db.claim.findUniqueOrThrow({ where: { id: r.claimId }, include: { lines: true, tender: true } });
  if (c.einvStatus !== "SUBMITTED" || !c.einvUuid || !c.invoiceNo) return { ok: false, message: "الفاتورة الأصلية غير معتمدة من نظام الفوترة" };
  const lines = JSON.parse(r.lines) as ReturnLine[];
  if (lines.length === 0) return { ok: false, message: "لم تُحدد بنود الإرجاع بعد" };
  const inv = computeReturn(lines, s);
  // رقم المستند يُحجز عند أول إرسال ويبقى ثابتاً عند إعادة المحاولة
  const number = r.number ?? (await nextInvoiceNo());
  if (!r.number) await db.einvReturn.update({ where: { id: r.id }, data: { number } });
  const uuid = r.uuid ?? randomUUID();
  const xml = buildInvoiceXml(c, inv, s, {
    invoiceNo: number,
    uuid,
    issueDate: new Date(),
    ret: { origId: `SADA-${c.invoiceNo}`, origUuid: c.einvUuid, origTotal: c.einvTotal ?? 0, reason: r.reason, lineIds: lines.map((l) => l.lineNo) },
  });
  await db.einvReturn.update({ where: { id: r.id }, data: { uuid } });
  const res = await submitToJofotara(xml);
  if (!res.ok) {
    await db.einvReturn.update({ where: { id: r.id }, data: { status: res.rejected ? "REJECTED" : "FAILED", error: res.error } });
    return { ok: false, message: res.error };
  }
  await db.einvReturn.update({ where: { id: r.id }, data: { status: "SUBMITTED", uuid: res.uuid || uuid, qr: res.qr, einvNumber: res.number, signed: res.signed, error: null, submittedAt: new Date() } });
  return { ok: true, message: `اعتُمدت فاتورة الإرجاع SADA-${number} من نظام الفوترة الوطني` };
}

/** rejected = رفض النظام للفاتورة نفسها (أخطاء تحقق) — بخلاف أعطال الاتصال/المهلة/المفاتيح التي يُعاد فيها الإرسال */
export type EinvResult = { ok: true; uuid: string; number: string | null; qr: string; signed: string | null; status: string } | { ok: false; error: string; rejected?: boolean };

/** الإرسال الفعلي لبوابة الفوترة (مهلة 30 ثانية) */
export async function submitToJofotara(xml: string): Promise<EinvResult> {
  const url = process.env.JOFOTARA_URL || "https://backend.jofotara.gov.jo/core/invoices/";
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Client-Id": process.env.JOFOTARA_CLIENT_ID ?? "", "Secret-Key": process.env.JOFOTARA_SECRET_KEY ?? "", "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ invoice: Buffer.from(xml, "utf8").toString("base64") }),
      signal: ctrl.signal,
      cache: "no-store",
    });
    const text = await res.text();
    let j: Record<string, unknown> = {};
    try {
      j = JSON.parse(text);
    } catch {
      return { ok: false, error: `رد غير متوقع من نظام الفوترة (HTTP ${res.status}): ${text.slice(0, 300)}` };
    }
    const status = String(j.EINV_STATUS ?? "");
    const qr = typeof j.EINV_QR === "string" ? j.EINV_QR : "";
    if (res.ok && qr && /SUBMITTED/i.test(status || "SUBMITTED")) {
      return { ok: true, uuid: String(j.EINV_INV_UUID ?? ""), number: j.EINV_NUM != null ? String(j.EINV_NUM) : null, qr, signed: typeof j.EINV_SINGED_INVOICE === "string" ? j.EINV_SINGED_INVOICE : null, status };
    }
    const results = (j.EINV_RESULTS ?? {}) as { ERRORS?: { EINV_MESSAGE?: string; EINV_CODE?: string }[] };
    const errs = (results.ERRORS ?? []).map((e) => `${e.EINV_CODE ?? ""} ${e.EINV_MESSAGE ?? ""}`.trim()).filter(Boolean);
    const authIssue = res.status === 401 || res.status === 403;
    return { ok: false, rejected: errs.length > 0 && !authIssue, error: errs.length ? errs.join(" | ").slice(0, 900) : `رفض نظام الفوترة الفاتورة (HTTP ${res.status}${status ? ` — ${status}` : ""})` };
  } catch (e) {
    return { ok: false, error: e instanceof Error && e.name === "AbortError" ? "انتهت مهلة الاتصال بنظام الفوترة" : `تعذر الاتصال بنظام الفوترة: ${e instanceof Error ? e.message : e}` };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * إصدار الفاتورة الإلكترونية لمطالبة معتمدة: رقم فاتورة متسلسل للشركة، UUID، الإرسال، وتخزين الـ QR و UUID.
 * لا يرمي أخطاء — يعيد النتيجة ويخزن سبب الفشل في المطالبة ليعيد المحاسب المحاولة.
 */
export async function issueClaimInvoice(claimId: number): Promise<{ ok: boolean; message: string; rejected?: boolean }> {
  const s = await getEinvSettings();
  const notReady = einvReadiness(s);
  if (notReady) {
    await db.claim.update({ where: { id: claimId }, data: { einvStatus: "PENDING", einvError: notReady } });
    return { ok: false, message: notReady };
  }
  const c = await db.claim.findUniqueOrThrow({ where: { id: claimId }, include: { lines: true, tender: true } });
  if (c.einvStatus === "SUBMITTED") return { ok: true, message: "الفاتورة معتمدة مسبقاً" };
  // اختار المحاسب «فاتورة عادية فقط» (مع السبب) — لا إرسال لنظام الفوترة
  if (c.invoiceMode === "REGULAR") return { ok: true, message: `فاتورة عادية فقط بقرار المحاسب — لم تُرسل لنظام الفوترة${c.invoiceModeReason ? ` (السبب: ${c.invoiceModeReason})` : ""}` };
  // رقم الفاتورة يُحجز مرة واحدة ويبقى ثابتاً عند إعادة المحاولة
  const invoiceNo = c.invoiceNo ?? (await nextInvoiceNo());
  const uuid = c.einvUuid && c.einvStatus !== "SUBMITTED" ? c.einvUuid : randomUUID();
  const inv = invoiceForClaim(c, s);
  const xml = buildInvoiceXml(c, inv, s, { invoiceNo, uuid, issueDate: new Date() });
  await db.claim.update({ where: { id: claimId }, data: { invoiceNo, einvUuid: uuid, einvTax: inv.tax, einvTotal: inv.total } });
  const r = await submitToJofotara(xml);
  if (!r.ok) {
    if (r.rejected) {
      // رفض النظام الفاتورة: تعود المطالبة للمحاسب «قيد التدقيق» مع الفاتورتين (الضريبية والعادية) وسبب الرفض
      // ليُعاد إدخالهما معاً ثم موافقة الإدارة مجدداً — يبقى رقم الفاتورة نفسه (لم يُسجَّل لدى النظام)
      await db.claim.update({
        where: { id: claimId },
        data: { einvStatus: "REJECTED", einvError: r.error, status: "DRAFT", readyAt: null, lockedAt: null, approvedById: null, returnReason: `رفض نظام الفوترة الوطني الفاتورة SADA-${invoiceNo}: ${r.error}` },
      });
      return { ok: false, rejected: true, message: `رفض نظام الفوترة الفاتورة — أُعيدت المطالبة للمحاسب مع الفاتورتين: ${r.error}` };
    }
    await db.claim.update({ where: { id: claimId }, data: { einvStatus: "FAILED", einvError: r.error } });
    return { ok: false, message: r.error };
  }
  await db.claim.update({
    where: { id: claimId },
    data: { einvStatus: "SUBMITTED", einvUuid: r.uuid || uuid, einvNumber: r.number, einvQr: r.qr, einvSigned: r.signed, einvError: null, einvSubmittedAt: new Date() },
  });
  return { ok: true, message: `اعتُمدت الفاتورة رقم SADA-${invoiceNo} من نظام الفوترة الوطني` };
}

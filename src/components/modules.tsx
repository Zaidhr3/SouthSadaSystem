import Link from "next/link";

import { AlertTriangle, CheckCircle2, FileText, Trash2 } from "lucide-react";
import type { BoqItem, Correspondence, Equipment, EquipmentLog, MaterialReceipt, Subcontract, SubcontractCertificate, Subcontractor, VariationOrder } from "@prisma/client";
import { AttachmentList, Badge, EmptyState, Money, ProgressBar, StatusBadge } from "./ui";
import { ConfirmButton, FileInput, Grid, Input, ModalForm, Select, Textarea } from "./forms";
import { UploadButton } from "./tables";
import { CERT_STATUS, DIRECTION, LETTER_STATUS, SUBCONTRACT_STATUS, VO_STATUS, BOQ_UNITS } from "@/lib/labels";
import { isLetterApproved, isOfficialLetter, letterState } from "@/lib/letter-flow";
import { fmtDate, round3, toInputDate, todayUTC } from "@/lib/format";
import { can, type AppUser } from "@/lib/permissions";
import {
  createCertificate,
  createCorrespondence,
  createMaterialReceipt,
  createSpecialCertificate,
  createVariation,
  decideCertificate,
  decideVariation,
  deleteCorrespondence,
  deleteEquipmentLog,
  deleteMaterialReceipt,
  deleteVariation,
  logEquipment,
  payCertificate,
  setSubcontractStatus,
} from "@/app/(app)/actions/modules";

type Att = Map<number, { id: number; fileName: string; size: number }[]>;
type TenderRef = { tender?: { id: number; name: string; number?: string } | null };
const nf = new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 });

/* ═══════════════ أوامر التغيير ═══════════════ */

export function VariationForm({ tenderId }: { tenderId: number }) {
  return (
    <ModalForm title="أمر تغيير / أعمال إضافية" trigger="+ أمر تغيير" action={createVariation.bind(null, tenderId)} wide>
      <Input name="title" label="العنوان" required placeholder="إضافة غرفة حارس / تعديل مواصفة البلاط" />
      <Textarea name="description" label="التفاصيل" />
      <Grid cols={3}>
        <Input name="amount" label="القيمة (د.أ) — سالب للإنقاص" type="number" required />
        <Input name="extraDays" label="مدة إضافية (يوم)" type="number" step="1" defaultValue={0} />
        <Input name="requestDate" label="تاريخ الطلب" type="date" required defaultValue={toInputDate(todayUTC())} />
      </Grid>
      <Input name="clientRef" label="مرجع كتاب صاحب العمل" />
      <FileInput label="كتاب أمر التغيير / المخططات" />
    </ModalForm>
  );
}

export function VariationTable({ rows, user, atts, showTender }: { rows: (VariationOrder & TenderRef)[]; user: AppUser; atts: Att; showTender?: boolean }) {
  if (rows.length === 0) return <EmptyState title="لا توجد أوامر تغيير" hint="الأوامر المعتمدة تعدّل قيمة العقد ومدته تلقائياً" />;
  const admin = can.approveVariations(user.role);
  return (
    <div className="overflow-x-auto">
      <table className="tbl">
        <thead>
          <tr>
            <th>#</th>
            <th>أمر التغيير</th>
            {showTender && <th>المشروع</th>}
            <th className="text-end">القيمة</th>
            <th>المدة</th>
            <th>الحالة</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((v) => (
            <tr key={v.id}>
              <td className="num">{v.number}</td>
              <td className="max-w-[320px]">
                <span className="block font-bold">{v.title}</span>
                <span className="text-xs text-ink-muted">
                  {fmtDate(v.requestDate)}
                  {v.clientRef ? ` — مرجع ${v.clientRef}` : ""}
                  {v.description ? ` — ${v.description}` : ""}
                </span>
                <AttachmentList items={atts.get(v.id)} />
              </td>
              {showTender && <td>{v.tender && <Link href={`/tenders/${v.tender.id}?tab=variations`} className="font-semibold hover:text-accent">{v.tender.name}</Link>}</td>}
              <td className="text-end">
                <Money value={v.amount} strong className={v.amount < 0 ? "text-bad" : ""} />
              </td>
              <td className="num">{v.extraDays ? `+${v.extraDays} يوم` : "—"}</td>
              <td>
                <StatusBadge map={VO_STATUS} value={v.status} />
              </td>
              <td className="whitespace-nowrap">
                {admin && v.status !== "APPROVED" && (
                  <ConfirmButton action={decideVariation.bind(null, v.id, "APPROVED")} confirm="اعتماد أمر التغيير؟ ستُعدل قيمة العقد ومدته." className="btn-ghost btn-sm">
                    اعتماد
                  </ConfirmButton>
                )}
                {admin && v.status === "PENDING" && (
                  <ConfirmButton action={decideVariation.bind(null, v.id, "REJECTED")} confirm="رفض أمر التغيير؟" className="btn-ghost btn-sm">
                    رفض
                  </ConfirmButton>
                )}
                {admin && v.status === "APPROVED" && (
                  <ConfirmButton action={decideVariation.bind(null, v.id, "PENDING")} confirm="إلغاء الاعتماد وعكس أثره على قيمة العقد؟" className="btn-ghost btn-sm">
                    إلغاء الاعتماد
                  </ConfirmButton>
                )}
                <UploadButton entityType="variation" entityId={v.id} />
                {admin && (
                  <ConfirmButton action={deleteVariation.bind(null, v.id)} confirm="حذف أمر التغيير؟" className="btn-danger btn-sm" title="حذف">
                    <Trash2 className="h-4 w-4" />
                  </ConfirmButton>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ═══════════════ مقاولو الباطن ═══════════════ */

type FullSubcontract = Subcontract & { subcontractor: Subcontractor; certificates: SubcontractCertificate[]; tender: { id: number; name: string; managerId: number | null } };

export function subcontractTotals(sc: FullSubcontract) {
  const valid = sc.certificates.filter((c) => c.status !== "REJECTED");
  const progress = valid.filter((c) => c.kind === "PROGRESS");
  const workDone = round3(progress.reduce((s, c) => s + c.workValue, 0));
  const advanceRecovered = round3(progress.reduce((s, c) => s + c.advanceRecovery, 0));
  const retentionHeld = round3(progress.reduce((s, c) => s + c.retention, 0));
  const retentionReleased = round3(valid.filter((c) => c.kind === "RETENTION_RELEASE").reduce((s, c) => s + c.net, 0));
  const advancePaid = round3(valid.filter((c) => c.kind === "ADVANCE").reduce((s, c) => s + c.net, 0));
  const paid = round3(valid.filter((c) => c.status === "PAID").reduce((s, c) => s + c.net, 0));
  return { workDone, advanceRecovered, retentionHeld, retentionReleased, advancePaid, paid, remaining: round3(sc.value - workDone) };
}

const KIND_LABEL: Record<string, string> = { PROGRESS: "مستخلص", ADVANCE: "دفعة مقدمة", RETENTION_RELEASE: "إفراج محجوزات" };

export function SubcontractCard({ sc, user, atts, certAtts }: { sc: FullSubcontract; user: AppUser; atts: Att; certAtts: Att }) {
  const t = subcontractTotals(sc);
  const admin = can.manageSubcontracts(user.role);
  const fin = can.manageFinance(user.role);
  const canSubmit = sc.status === "ACTIVE" && (admin || (user.role === "PM" && sc.tender.managerId === user.id));
  const pct = sc.value > 0 ? Math.round((t.workDone / sc.value) * 100) : 0;
  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 p-5 pb-3 sm:px-6">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-[17px] font-bold">
            {sc.subcontractor.name}
            <Badge>{sc.subcontractor.trade}</Badge>
            <StatusBadge map={SUBCONTRACT_STATUS} value={sc.status} />
          </p>
          <p className="mt-0.5 text-sm text-ink-muted">
            {sc.scope} — <Link href={`/tenders/${sc.tender.id}?tab=subcontracts`} className="hover:text-accent">{sc.tender.name}</Link> — من {fmtDate(sc.startDate)}
          </p>
          <AttachmentList items={atts.get(sc.id)} />
        </div>
        <div className="flex flex-wrap gap-1">
          {canSubmit && (
            <ModalForm title={`مستخلص جديد — ${sc.subcontractor.name}`} trigger="+ مستخلص" triggerClass="btn-primary btn-sm" action={createCertificate.bind(null, sc.id)}>
              <p className="rounded-xl bg-canvas p-3 text-sm">
                المتبقي من الاتفاقية: <b className="num">{nf.format(t.remaining)}</b> د.أ — يُستقطع تلقائياً: استرداد الدفعة المقدمة بالتناسب + محجوزات {sc.retentionPct}%
              </p>
              <Grid>
                <Input name="workValue" label="قيمة الأعمال المنجزة لهذه الفترة" type="number" required max={t.remaining} />
                <Input name="date" label="التاريخ" type="date" required defaultValue={toInputDate(todayUTC())} />
              </Grid>
              <Input name="otherDeductions" label="خصومات أخرى (غرامات، مواد مسلمة)" type="number" />
              <Textarea name="notes" label="ملاحظات" />
              <FileInput label="المستخلص الموقّع / جدول الكميات المنفذة" />
            </ModalForm>
          )}
          {admin && sc.advance - t.advancePaid > 0 && (
            <ConfirmButton action={createSpecialCertificate.bind(null, sc.id, "ADVANCE")} confirm={`اعتماد صرف الدفعة المقدمة (${nf.format(sc.advance - t.advancePaid)} د.أ)؟`} className="btn-secondary btn-sm">
              صرف الدفعة المقدمة
            </ConfirmButton>
          )}
          {admin && t.retentionHeld - t.retentionReleased > 0 && (
            <ConfirmButton action={createSpecialCertificate.bind(null, sc.id, "RETENTION_RELEASE")} confirm={`الإفراج عن محجوزات الباطن (${nf.format(t.retentionHeld - t.retentionReleased)} د.أ)؟`} className="btn-secondary btn-sm">
              الإفراج عن المحجوزات
            </ConfirmButton>
          )}
          {admin && sc.status === "ACTIVE" && (
            <ConfirmButton action={setSubcontractStatus.bind(null, sc.id, "COMPLETED")} confirm="إغلاق الاتفاقية كمنجزة؟" className="btn-ghost btn-sm">
              إغلاق
            </ConfirmButton>
          )}
          <UploadButton entityType="subcontract" entityId={sc.id} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 px-5 pb-4 sm:grid-cols-4 sm:px-6">
        <div className="rounded-xl bg-canvas p-3">
          <p className="text-[11px] text-ink-muted">قيمة الاتفاقية</p>
          <Money value={sc.value} strong />
          <ProgressBar value={pct} className="mt-2" />
        </div>
        <div className="rounded-xl bg-canvas p-3">
          <p className="text-[11px] text-ink-muted">المنجز / المتبقي</p>
          <Money value={t.workDone} strong />
          <p className="text-[11px] text-ink-muted">متبقٍ <span className="num">{nf.format(t.remaining)}</span></p>
        </div>
        <div className="rounded-xl bg-canvas p-3">
          <p className="text-[11px] text-ink-muted">الدفعة المقدمة (مستردة)</p>
          <Money value={sc.advance} strong />
          <p className="text-[11px] text-ink-muted">استُرد <span className="num">{nf.format(t.advanceRecovered)}</span></p>
        </div>
        <div className="rounded-xl bg-canvas p-3">
          <p className="text-[11px] text-ink-muted">المحجوزات ({sc.retentionPct}%)</p>
          <Money value={t.retentionHeld - t.retentionReleased} strong />
          <p className="text-[11px] text-ink-muted">مدفوع إجمالاً <span className="num">{nf.format(t.paid)}</span></p>
        </div>
      </div>
      {sc.certificates.length > 0 && (
        <div className="overflow-x-auto border-t border-line">
          <table className="tbl">
            <thead>
              <tr>
                <th>المستخلص</th>
                <th className="text-end">الأعمال</th>
                <th className="text-end">استرداد مقدمة</th>
                <th className="text-end">محجوزات</th>
                <th className="text-end">خصومات</th>
                <th className="text-end">الصافي</th>
                <th>الحالة</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sc.certificates.map((c) => (
                <tr key={c.id}>
                  <td>
                    <span className="block font-semibold">{KIND_LABEL[c.kind]} {c.kind === "PROGRESS" ? c.number : ""}</span>
                    <span className="text-xs text-ink-muted">{fmtDate(c.date)}{c.notes ? ` — ${c.notes}` : ""}</span>
                    <AttachmentList items={certAtts.get(c.id)} />
                  </td>
                  <td className="num text-end">{c.workValue ? nf.format(c.workValue) : "—"}</td>
                  <td className="num text-end">{c.advanceRecovery ? nf.format(c.advanceRecovery) : "—"}</td>
                  <td className="num text-end">{c.retention ? nf.format(c.retention) : "—"}</td>
                  <td className="num text-end">{c.otherDeductions ? nf.format(c.otherDeductions) : "—"}</td>
                  <td className="text-end"><Money value={c.net} strong /></td>
                  <td>
                    <StatusBadge map={CERT_STATUS} value={c.status} />
                    {c.paidDate && <span className="block text-xs text-ink-muted">دُفع {fmtDate(c.paidDate)}</span>}
                  </td>
                  <td className="whitespace-nowrap">
                    {admin && c.status === "SUBMITTED" && (
                      <>
                        <ConfirmButton action={decideCertificate.bind(null, c.id, "APPROVED")} className="btn-ghost btn-sm">اعتماد</ConfirmButton>
                        <ConfirmButton action={decideCertificate.bind(null, c.id, "REJECTED")} confirm="رفض المستخلص؟" className="btn-ghost btn-sm">رفض</ConfirmButton>
                      </>
                    )}
                    {fin && c.status === "APPROVED" && (
                      <ConfirmButton action={payCertificate.bind(null, c.id)} confirm={`دفع ${nf.format(c.net)} د.أ من حساب الشركة؟`} className="btn-primary btn-sm">
                        دفع
                      </ConfirmButton>
                    )}
                    <UploadButton entityType="certificate" entityId={c.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/* ═══════════════ المواد الموقعية ═══════════════ */

type Analysis = { item: BoqItem; received: number; theoretical: number; overrunPct: number; flag: "ok" | "ahead" | "over" };

/**
 * مقارنة التوريد الفعلي مع كميات جدول الكميات والاستهلاك النظري.
 * الاستهلاك النظري = الكمية المقاسة في آخر حصر فعلي للبند، وإلا (كمية الجدول × نسبة الإنجاز).
 */
export function analyzeMaterials(items: BoqItem[], receipts: MaterialReceipt[], progress: number, tolerancePct: number, measured?: Map<number, number>): Analysis[] {
  return items
    .map((item) => {
      const received = round3(receipts.filter((r) => r.boqItemId === item.id).reduce((s, r) => s + r.quantity, 0));
      const theoretical = round3(measured?.get(item.id) ?? item.quantity * (progress / 100));
      const overrunPct = item.quantity > 0 ? ((received - item.quantity) / item.quantity) * 100 : 0;
      const flag: Analysis["flag"] = received > item.quantity * (1 + tolerancePct / 100) ? "over" : progress > 0 && received > theoretical * (1 + tolerancePct / 100) + 0.0001 ? "ahead" : "ok";
      return { item, received, theoretical, overrunPct, flag };
    })
    .filter((a) => a.received > 0);
}

export function MaterialAnalysisTable({ rows, tolerance }: { rows: Analysis[]; tolerance: number }) {
  if (rows.length === 0) return <p className="px-6 py-6 text-center text-sm text-ink-muted">اربط التوريدات ببنود جدول الكميات لتظهر المقارنة</p>;
  return (
    <div className="overflow-x-auto">
      <table className="tbl">
        <thead>
          <tr>
            <th>البند</th>
            <th className="text-end">كمية جدول الكميات</th>
            <th className="text-end">المنفذ حسب الحصر / الإنجاز</th>
            <th className="text-end">الموَرّد فعلياً</th>
            <th>المؤشر</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.item.id}>
              <td className="max-w-[320px] font-semibold">{a.item.description}</td>
              <td className="num text-end">{nf.format(a.item.quantity)} {a.item.unit}</td>
              <td className="num text-end">{nf.format(a.theoretical)}</td>
              <td className="num text-end font-bold">{nf.format(a.received)}</td>
              <td>
                {a.flag === "over" ? (
                  <Badge tone="red"><AlertTriangle className="h-3 w-3" /> تجاوز الكمية التعاقدية {a.overrunPct.toFixed(1)}% — هدر محتمل</Badge>
                ) : a.flag === "ahead" ? (
                  <Badge tone="orange">▲ فوق الاستهلاك النظري (مخزون موقع أو هدر) — تسامح {tolerance}%</Badge>
                ) : (
                  <Badge tone="green"><CheckCircle2 className="h-3 w-3" /> ضمن الحدود</Badge>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function MaterialForm({ tenderId, boqItems }: { tenderId: number; boqItems: { id: number; description: string; unit: string }[] }) {
  return (
    <ModalForm title="تسجيل توريد مواد للموقع" trigger="+ توريد مواد" action={createMaterialReceipt.bind(null, tenderId)} wide>
      <Select name="boqItemId" label="بند جدول الكميات المرتبط (للمقارنة)" options={boqItems.map((b) => ({ value: b.id, label: `${b.description} (${b.unit})` }))} placeholder="— غير مرتبط —" />
      <Grid cols={3}>
        <Input name="material" label="المادة" required placeholder="حديد 16 ملم / إسمنت / خزان GRP" />
        <Input name="unit" label="الوحدة" required list="mat-units" />
        <Input name="quantity" label="الكمية" type="number" required />
      </Grid>
      <datalist id="mat-units">{[...BOQ_UNITS, "كيس", "لوح", "قطعة"].map((u) => <option key={u} value={u} />)}</datalist>
      <Grid cols={3}>
        <Input name="date" label="تاريخ الوصول" type="date" required defaultValue={toInputDate(todayUTC())} />
        <Input name="supplier" label="المورد" />
        <Input name="deliveryNote" label="رقم إشعار التسليم" />
      </Grid>
      <Input name="unitCost" label="سعر الوحدة (اختياري — للمرجعية)" type="number" />
      <Textarea name="notes" label="ملاحظات" />
      <FileInput label="صور الإثبات (الحمولة، إشعار التسليم)" />
    </ModalForm>
  );
}

export function MaterialReceiptTable({ rows, user, atts, showTender }: { rows: (MaterialReceipt & TenderRef & { boqLabel?: string | null; receivedBy?: { name: string } })[]; user: AppUser; atts: Att; showTender?: boolean }) {
  if (rows.length === 0) return <EmptyState title="لا توجد توريدات مسجلة" />;
  return (
    <div className="overflow-x-auto">
      <table className="tbl">
        <thead>
          <tr>
            <th>التاريخ</th>
            <th>المادة</th>
            {showTender && <th>المشروع</th>}
            <th className="text-end">الكمية</th>
            <th>المورد / الإشعار</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="num whitespace-nowrap">{fmtDate(r.date)}</td>
              <td className="max-w-[300px]">
                <span className="block font-semibold">{r.material}</span>
                {r.boqLabel && <span className="text-xs text-ink-muted">بند: {r.boqLabel}</span>}
                <AttachmentList items={atts.get(r.id)} />
              </td>
              {showTender && <td>{r.tender && <Link href={`/tenders/${r.tender.id}?tab=materials`} className="hover:text-accent">{r.tender.name}</Link>}</td>}
              <td className="num text-end font-bold">{nf.format(r.quantity)} {r.unit}</td>
              <td className="text-xs text-ink-soft">{[r.supplier, r.deliveryNote && `إشعار ${r.deliveryNote}`, r.receivedBy && `استلمه ${r.receivedBy.name}`].filter(Boolean).join(" — ") || "—"}</td>
              <td className="whitespace-nowrap">
                <UploadButton entityType="material" entityId={r.id} />
                {(user.role === "ADMIN" || r.receivedById === user.id) && (
                  <ConfirmButton action={deleteMaterialReceipt.bind(null, r.id)} confirm="حذف التوريد؟" className="btn-danger btn-sm" title="حذف">
                    <Trash2 className="h-4 w-4" />
                  </ConfirmButton>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ═══════════════ الآليات ═══════════════ */

export function EquipmentLogForm({ tenderId, equipment }: { tenderId: number; equipment: Equipment[] }) {
  return (
    <ModalForm title="تسجيل تشغيل معدة على المشروع" trigger="+ تشغيل معدة" action={logEquipment.bind(null, tenderId)}>
      <Select
        name="equipmentId"
        label="المعدة"
        options={equipment.filter((e) => e.status !== "RETIRED").map((e) => ({ value: e.id, label: `${e.name} — ${e.ownership === "OWNED" ? "ملك" : "مستأجرة"} — ${e.dailyRate} د.أ/يوم` }))}
        placeholder="— اختر —"
      />
      <Grid cols={3}>
        <Input name="startDate" label="من تاريخ" type="date" required defaultValue={toInputDate(todayUTC())} />
        <Input name="days" label="عدد الأيام" type="number" required step="0.5" />
        <Input name="dailyRate" label="الكلفة اليومية" type="number" hint="فارغ = سعر المعدة" />
      </Grid>
      <Input name="operator" label="المشغّل / السائق" />
      <Textarea name="notes" label="ملاحظات" />
      <p className="text-xs text-ink-muted">تُحمّل الكلفة على المشروع تلقائياً: معدات الشركة تحميل داخلي، والمستأجرة تُخصم من حساب الشركة.</p>
    </ModalForm>
  );
}

export function EquipmentLogTable({ rows, user, showTender }: { rows: (EquipmentLog & TenderRef & { equipment: Equipment })[]; user: AppUser; showTender?: boolean }) {
  if (rows.length === 0) return <EmptyState title="لا يوجد تشغيل مسجل" />;
  return (
    <div className="overflow-x-auto">
      <table className="tbl">
        <thead>
          <tr>
            <th>التاريخ</th>
            <th>المعدة</th>
            {showTender && <th>المشروع</th>}
            <th className="text-end">الأيام</th>
            <th className="text-end">الكلفة</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((l) => (
            <tr key={l.id}>
              <td className="num whitespace-nowrap">{fmtDate(l.startDate)}</td>
              <td>
                <span className="block font-semibold">{l.equipment.name}</span>
                <span className="text-xs text-ink-muted">{l.equipment.ownership === "OWNED" ? "ملك الشركة — تحميل داخلي" : `مستأجرة${l.equipment.vendor ? ` من ${l.equipment.vendor}` : ""}`}{l.operator ? ` — ${l.operator}` : ""}</span>
              </td>
              {showTender && <td>{l.tender && <Link href={`/tenders/${l.tender.id}?tab=equipment`} className="hover:text-accent">{l.tender.name}</Link>}</td>}
              <td className="num text-end">{nf.format(l.days)} × {nf.format(l.dailyRate)}</td>
              <td className="text-end"><Money value={l.cost} strong /></td>
              <td>
                {(user.role === "ADMIN" || l.loggedById === user.id) && (
                  <ConfirmButton action={deleteEquipmentLog.bind(null, l.id)} confirm="حذف السجل وعكس كلفته؟" className="btn-danger btn-sm" title="حذف">
                    <Trash2 className="h-4 w-4" />
                  </ConfirmButton>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ═══════════════ الصادر والوارد ═══════════════ */

export function CorrespondenceForm({ tenders, fixedTenderId }: { tenders: { id: number; name: string }[]; fixedTenderId?: number }) {
  return (
    <ModalForm title="تسجيل كتاب صادر / وارد" trigger="+ كتاب" action={createCorrespondence} wide>
      <Grid cols={3}>
        <Select name="direction" label="النوع" options={{ OUT: "صادر", IN: "وارد" }} />
        <Input name="date" label="التاريخ" type="date" required defaultValue={toInputDate(todayUTC())} />
        <Input name="theirRef" label="رقم كتاب الجهة" />
      </Grid>
      <Input name="party" label="الجهة" required list="parties" placeholder="وزارة الأشغال العامة والإسكان — مديرية أشغال الطفيلة" />
      <datalist id="parties">
        {["وزارة الأشغال العامة والإسكان", "وزارة التربية والتعليم", "وزارة الصحة", "دائرة العطاءات الحكومية", "الإشراف الهندسي"].map((p) => <option key={p} value={p} />)}
      </datalist>
      <Input name="subject" label="الموضوع" required />
      {fixedTenderId ? <input type="hidden" name="tenderId" value={fixedTenderId} /> : <Select name="tenderId" label="المشروع" options={tenders.map((t) => ({ value: t.id, label: t.name }))} placeholder="— عام —" />}
      <Textarea name="notes" label="ملاحظات" />
      <FileInput label="نسخة الكتاب (PDF)" />
      <p className="text-xs text-ink-muted">يُعطى رقم مرجعي تلقائي: ص/السنة/التسلسل للصادر و و/السنة/التسلسل للوارد.</p>
    </ModalForm>
  );
}

type CorrLinks = { replyTo?: { id: number; refNo: string } | null; replies?: { id: number; refNo: string }[] };

export function CorrespondenceTable({ rows, user, atts, showTender }: { rows: (Correspondence & TenderRef & CorrLinks)[]; user: AppUser; atts: Att; showTender?: boolean }) {
  if (rows.length === 0) return <EmptyState title="لا توجد مراسلات" />;
  return (
    <div className="overflow-x-auto">
      <table className="tbl">
        <thead>
          <tr>
            <th>الرقم</th>
            <th>التاريخ</th>
            <th>الجهة والموضوع</th>
            {showTender && <th>المشروع</th>}
            <th>المرفقات</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id}>
              <td className="whitespace-nowrap">
                <Badge tone={DIRECTION[c.direction].tone}>{DIRECTION[c.direction].label}</Badge>
                {isOfficialLetter(c) && !isLetterApproved(c) ? (
                  <span className="mt-1 block"><StatusBadge map={LETTER_STATUS} value={letterState(c)!} /></span>
                ) : (
                  <span className="num mt-1 block font-bold">{c.refNo}</span>
                )}
              </td>
              <td className="num whitespace-nowrap">{fmtDate(c.date)}</td>
              <td className="max-w-[360px]">
                {isOfficialLetter(c) ? (
                  <Link href={`/correspondence/letters/${c.id}`} className="block font-semibold hover:text-accent">{c.subject}</Link>
                ) : (
                  <span className="block font-semibold">{c.subject}</span>
                )}
                <span className="text-xs text-ink-muted">{c.party}{c.theirRef ? ` — رقمهم ${c.theirRef}` : ""}</span>
                {c.replyTo && <span className="mt-1 block text-xs font-semibold text-accent">رداً على الوارد <span className="num">{c.replyTo.refNo}</span></span>}
                {c.replies && c.replies.length > 0 && <span className="mt-1 block text-xs font-semibold text-good">رُدّ عليه بـ {c.replies.map((r) => r.refNo).join("، ")}</span>}
              </td>
              {showTender && <td className="text-ink-soft">{c.tender ? <Link href={`/tenders/${c.tender.id}?tab=correspondence`} className="hover:text-accent">{c.tender.name}</Link> : "عام"}</td>}
              <td><AttachmentList items={atts.get(c.id)} /></td>
              <td className="whitespace-nowrap">
                {isOfficialLetter(c) &&
                  (isLetterApproved(c) ? (
                    <a href={`/api/letters/${c.id}/pdf`} target="_blank" rel="noopener" className="btn-secondary btn-sm me-1" title="طباعة الكتاب على ورقة الشركة الرسمية">
                      <FileText className="h-4 w-4" /> PDF
                    </a>
                  ) : (
                    <Link href={`/correspondence/letters/${c.id}`} className="btn-secondary btn-sm me-1">فتح</Link>
                  ))}
                <UploadButton entityType="correspondence" entityId={c.id} />
                {user.role === "ADMIN" && (
                  <ConfirmButton action={deleteCorrespondence.bind(null, c.id)} confirm="حذف السجل؟" className="btn-danger btn-sm" title="حذف">
                    <Trash2 className="h-4 w-4" />
                  </ConfirmButton>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}



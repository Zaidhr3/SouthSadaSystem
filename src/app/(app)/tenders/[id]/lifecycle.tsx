import type { Claim, Guarantee, Tender } from "@prisma/client";
import clsx from "clsx";
import { Check, ChevronDown, FileCheck2, FileX2, Upload } from "lucide-react";
import { FileInput, Grid, Input, ModalForm, Select, Textarea } from "@/components/forms";
import { Badge, Money, ProgressBar, StatusBadge } from "@/components/ui";
import { fmtDate, fmtJOD, toInputDate, todayUTC, addDays } from "@/lib/format";
import { CLAIM_STATUS, CLAIM_TYPE, GUARANTEE_FORM, GUARANTEE_STATUS, GUARANTEE_TYPE } from "@/lib/labels";
import { can, depositSlipRequired, type AppUser } from "@/lib/permissions";
import { currentPhase, maintenanceEnd, PHASES, phaseStatus, STAGE_SLOTS, type PhaseNo, type StageSlot } from "@/lib/project-phase";
import { updateLifecycle, uploadStageFile } from "../../actions/tenders";
import { createGuarantee } from "../../actions/guarantees";
import { DepositSlipInput } from "@/components/deposit-slip";

export function GuaranteeFields({ type, tender }: { type?: string; tender: Tender }) {
  const today = todayUTC();
  const defaultExpiry = type === "BID" ? toInputDate(addDays(tender.deadline, 90)) : "";
  return (
    <>
      <Grid>
        <Select name="type" label="نوع الكفالة" options={GUARANTEE_TYPE} defaultValue={type ?? "BID"} />
        <Select name="form" label="شكل الكفالة" options={Object.fromEntries(Object.entries(GUARANTEE_FORM).map(([k, v]) => [k, `${v.label} (عمولة ${v.fee} د.أ)`]))} />
      </Grid>
      <Grid>
        <Input name="bank" label="البنك" required list="banks" placeholder="البنك العربي" />
        <Input name="referenceNo" label="رقم الكفالة / الشيك" />
      </Grid>
      <datalist id="banks">
        {["البنك العربي", "بنك الإسكان للتجارة والتمويل", "البنك الأهلي الأردني", "بنك القاهرة عمان", "بنك الاتحاد", "البنك الإسلامي الأردني", "بنك صفوة الإسلامي", "البنك الأردني الكويتي"].map((b) => (
          <option key={b} value={b} />
        ))}
      </datalist>
      <Grid>
        <Input name="amount" label="قيمة الكفالة (د.أ)" type="number" required />
        <Input name="bankFee" label="عمولة البنك (د.أ)" type="number" hint="فارغ = 15 للكفالة البنكية / 5 للشيك المصدق" />
      </Grid>
      <Grid>
        <Input name="issueDate" label="تاريخ الإصدار" type="date" required defaultValue={toInputDate(today)} />
        <Input name="expiryDate" label="تاريخ الانتهاء" type="date" defaultValue={defaultExpiry} />
      </Grid>
      {type === "MAINTENANCE" && (
        <Select name="validityYears" label="مدة الصيانة (عيوب المصنعية)" options={[{ value: 1, label: "سنة واحدة" }, { value: 2, label: "سنتان" }]} defaultValue={tender.maintenanceMonths === 24 ? 2 : 1} hint="تُحسب من تاريخ الاستلام الابتدائي إذا تُرك تاريخ الانتهاء فارغاً" />
      )}
      <Grid>
        <Input name="submittedDate" label="تاريخ التسليم للجهة" type="date" />
        <Input name="depositBox" label="صندوق الإيداع / مكان التسليم" placeholder="صندوق العطاءات - الطابق الثاني" />
      </Grid>
      <Textarea name="notes" label="ملاحظات" />
      <FileInput label="صورة الكفالة / الشيك المصدق" />
    </>
  );
}

export function ClaimFields() {
  return (
    <>
      <Grid>
        <Select name="type" label="نوع المطالبة" options={{ INTERIM: "مطالبة مرحلية", FINAL: "مطالبة نهائية" }} />
        <Input name="number" label="رقم المطالبة" type="number" step="1" hint="فارغ = الرقم التالي تلقائياً" />
      </Grid>
      <Grid>
        <Input name="submittedDate" label="تاريخ التقديم" type="date" required defaultValue={toInputDate(todayUTC())} />
        <Input name="grossAmount" label="قيمة المطالبة (د.أ)" type="number" required />
      </Grid>
      <div className="rounded-2xl bg-canvas p-3.5">
        <p className="mb-3 text-sm font-bold">حاسبة المستقطعات</p>
        <p className="mb-3 text-xs text-ink-muted">اترك الحقول فارغة ليحسبها النظام تلقائياً حسب النسب المعتمدة (مع سقف المحجوزات). ضريبة الدخل تُسجل في وحدة «الضريبة» وليس في المطالبة.</p>
        <Grid>
          <Input name="retention" label="المحجوزات" type="number" placeholder="تلقائي" />
          <Input name="stampDuty" label="رسوم الطوابع" type="number" placeholder="تلقائي" />
        </Grid>
        <Grid>
          <Input name="deductions" label="خصومات أخرى (د.أ)" type="number" wrapClass="mt-4" />
          <Input name="deductionNotes" label="سبب الخصم" placeholder="ملاحظات إنارة وكهرباء بسيطة" wrapClass="mt-4" />
        </Grid>
      </div>
      <Textarea name="notes" label="ملاحظات" />
      <FileInput label="معززات المطالبة (مذكرات الموقع، شهادات الفحص، الفواتير)" />
    </>
  );
}

type StageFile = { id: number; fileName: string; slot: string | null; createdAt: Date; uploadedBy: { name: string } };
type BoqProgress = { total: number; started: number; completed: number };

type Props = {
  tender: Tender & { guarantees: Guarantee[]; claims: Claim[] };
  boqCount: number;
  boqTotal: number;
  user: AppUser;
  stageFiles: StageFile[];
  guaranteeFiles: Map<number, { id: number; fileName: string }[]>;
  boqProgress: BoqProgress;
  surveyCount: number;
  finalSurvey: boolean;
};

type Item = { title: string; done: boolean; body: React.ReactNode; action?: React.ReactNode; slots?: React.ReactNode };

const ISSUED_CLAIM = ["SUBMITTED", "APPROVED", "PAID"];
const HELD = ["ISSUED", "SUBMITTED"];
const dayFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "2-digit", month: "2-digit", year: "numeric" });

/** خانة مستند مستقلة: حالة الإرفاق + الملفات + زر رفع خاص بها */
function SlotRow({ tenderId, slot, files, extra, canUpload }: { tenderId: number; slot: StageSlot; files: StageFile[]; extra?: { id: number; fileName: string }[]; canUpload: boolean }) {
  const all = [...files.map((f) => ({ id: f.id, fileName: f.fileName, meta: `${f.uploadedBy.name} — ${dayFmt.format(f.createdAt)}` })), ...(extra ?? []).map((f) => ({ ...f, meta: "مرفق مع سجل الكفالة" }))];
  const ok = all.length > 0;
  return (
    <div className={clsx("flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2", ok ? "border-good/30 bg-good-soft/40" : "border-dashed border-line bg-white")}>
      {ok ? <FileCheck2 className="h-4 w-4 shrink-0 text-good" aria-hidden /> : <FileX2 className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden />}
      <span className="text-[13px] font-bold">{STAGE_SLOTS[slot].label}</span>
      {!ok && <span className="text-xs text-ink-muted">لم يُرفق</span>}
      <span className="flex min-w-0 flex-1 flex-wrap gap-x-3 gap-y-1">
        {all.map((f) => (
          <a key={f.id} href={`/api/files/${f.id}`} target="_blank" rel="noreferrer" className="max-w-[220px] truncate text-xs font-semibold text-accent hover:underline" title={f.meta}>
            {f.fileName}
          </a>
        ))}
      </span>
      {canUpload && (
        <ModalForm title={`رفع: ${STAGE_SLOTS[slot].label}`} trigger={<><Upload className="h-3.5 w-3.5" /> {ok ? "إضافة" : "رفع"}</>} triggerClass="btn-ghost btn-sm" action={uploadStageFile.bind(null, tenderId, slot)} submitLabel="رفع">
          <FileInput name={`file_${slot}`} label={STAGE_SLOTS[slot].label} />
        </ModalForm>
      )}
    </div>
  );
}

function PhaseCard({ no, done, current, upcoming, items, note }: { no: PhaseNo; done: boolean; current: boolean; upcoming: boolean; items: Item[]; note?: React.ReactNode }) {
  const count = items.filter((i) => i.done).length;
  return (
    <details id={`phase-${no}`} open={current} className={clsx("group scroll-mt-24 rounded-2xl border transition", current ? "border-accent/40 bg-accent-soft/25 shadow-card" : done ? "border-good/25 bg-white" : "border-line bg-white", upcoming && !current && "bg-canvas/40")}>
      <summary className="flex cursor-pointer list-none items-center gap-3 p-4 [&::-webkit-details-marker]:hidden">
        <span className={clsx("grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-bold", done ? "bg-good text-white" : current ? "bg-accent text-white ring-4 ring-accent/20" : "bg-canvas text-ink-muted ring-1 ring-line")}>
          {done ? <Check className="h-4 w-4" aria-label="مكتملة" /> : no}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-bold leading-snug">{PHASES[no].title}</span>
          <span className="num block text-xs font-semibold text-ink-muted">{count} من {items.length} خطوات</span>
        </span>
        {done ? <Badge tone="green">مكتملة</Badge> : current ? <Badge tone="blue">الحالية</Badge> : null}
        <ChevronDown className="h-5 w-5 shrink-0 text-ink-muted transition group-open:rotate-180" aria-hidden />
      </summary>
      <div className="px-4 pb-4">
        {note && <div className="mb-3">{note}</div>}
        <ol className="space-y-3">
          {items.map((it) => (
            <li key={it.title} className="rounded-xl bg-white/80 p-3 ring-1 ring-black/[0.04]">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="flex items-center gap-2 text-sm font-bold">
                  <span className={clsx("grid h-5 w-5 place-items-center rounded-full", it.done ? "bg-good text-white" : "bg-white ring-1 ring-line")}>{it.done && <Check className="h-3 w-3" aria-hidden />}</span>
                  {it.title}
                </p>
                {it.action}
              </div>
              <div className="mt-1 text-sm text-ink-soft">{it.body}</div>
              {it.slots && <div className="mt-2 space-y-1.5">{it.slots}</div>}
            </li>
          ))}
        </ol>
      </div>
    </details>
  );
}

export function Lifecycle({ tender: t, boqCount, boqTotal, user, stageFiles, guaranteeFiles, boqProgress, surveyCount, finalSurvey }: Props) {
  const admin = can.manageTenders(user.role);
  // المرحلة الأولى: المدير العام والمحاسب
  const award = can.manageAward(user.role);
  const fin = can.manageGuarantees(user.role);
  // المراحل 2–5: المدير العام + مدير المشروع المسند (التنفيذ ← الاستلام ← الإغلاق)
  const proj = can.manageProjectLifecycle(user.role) && (user.role !== "PM" || t.managerId === user.id);
  const today = todayUTC();
  const bid = t.guarantees.filter((g) => g.type === "BID");
  const perf = t.guarantees.filter((g) => g.type === "PERFORMANCE");
  const maint = t.guarantees.filter((g) => g.type === "MAINTENANCE");
  const decided = ["WON", "LOST", "EXECUTION", "MAINTENANCE", "CLOSED"].includes(t.status);
  const won = ["WON", "EXECUTION", "MAINTENANCE", "CLOSED"].includes(t.status);
  const active = ["WON", "EXECUTION", "MAINTENANCE"].includes(t.status);
  const lost = t.status === "LOST";
  const done = phaseStatus(t);
  const phase = currentPhase(t);
  const files = (slot: StageSlot) => stageFiles.filter((f) => f.slot === slot);
  const slot = (s: StageSlot, canUpload: boolean, extra?: { id: number; fileName: string }[]) => <SlotRow key={s} tenderId={t.id} slot={s} files={files(s)} extra={extra} canUpload={canUpload} />;
  const can1 = award && won && t.status !== "CLOSED";
  const slipRequired = depositSlipRequired(user);
  const canP = proj && active;
  const perfFiles = perf.flatMap((g) => guaranteeFiles.get(g.id) ?? []);
  const maintFiles = maint.flatMap((g) => guaranteeFiles.get(g.id) ?? []);
  const interim = t.claims.filter((c) => c.type === "INTERIM");
  const finals = t.claims.filter((c) => c.type === "FINAL");
  const mEnd = maintenanceEnd(t);
  const mDays = mEnd ? Math.round((mEnd.getTime() - today.getTime()) / 86_400_000) : null;
  const gLine = (g: Guarantee) => (
    <span key={g.id} className="flex flex-wrap items-center gap-2">
      {GUARANTEE_TYPE[g.type]} — {g.bank} — <Money value={g.amount} />
      {g.expiryDate && <span className="text-ink-muted">حتى {fmtDate(g.expiryDate)}</span>}
      <StatusBadge map={GUARANTEE_STATUS} value={g.status} />
    </span>
  );

  /* ═════ مرحلة العطاء (قبل الإحالة) ═════ */
  const pre: Item[] = [
    { title: "شراء وثائق العطاء", done: true, body: <>اشتُريت بتاريخ {fmtDate(t.purchaseDate)} بمبلغ {fmtJOD(t.docFee)} — آخر موعد للتقديم <b>{fmtDate(t.deadline)}</b></> },
    {
      title: "زيارة الموقع",
      done: !!t.siteVisitDate && t.siteVisitDate <= today,
      body: t.siteVisitDate ? <>{fmtDate(t.siteVisitDate)} {t.siteVisitNotes && <span className="block text-ink-muted">{t.siteVisitNotes}</span>}</> : "لم يُحدد موعد",
      action: admin && (
        <ModalForm title="زيارة الموقع" trigger="تحديث" triggerClass="btn-ghost btn-sm" action={updateLifecycle.bind(null, t.id, "site")}>
          <Input name="siteVisitDate" label="تاريخ الزيارة" type="date" defaultValue={toInputDate(t.siteVisitDate)} />
          <Textarea name="siteVisitNotes" label="ملاحظات الموقع" defaultValue={t.siteVisitNotes ?? ""} rows={4} />
          <FileInput label="صور الموقع" />
        </ModalForm>
      ),
    },
    { title: "تسعير جدول الكميات", done: boqCount > 0, body: boqCount > 0 ? <>{boqCount} بنداً — الإجمالي <Money value={boqTotal} strong /></> : "لم يبدأ التسعير — استخدم مساعد التسعير الذكي في تبويب جدول الكميات" },
    {
      title: "كفالة الدخول وتقديم العرض",
      done: bid.length > 0 || ["SUBMITTED", "NEGOTIATION"].includes(t.status) || decided,
      body: (
        <>
          {bid.length ? bid.map(gLine) : "لا توجد كفالة دخول"}
          {t.bidAmount != null && <span className="block">قيمة العرض المقدم: <Money value={t.bidAmount} strong /></span>}
        </>
      ),
      action: (
        <span className="flex flex-wrap gap-1">
          {fin && (
            <ModalForm title="إصدار كفالة دخول" trigger="+ كفالة دخول" triggerClass="btn-ghost btn-sm" action={createGuarantee.bind(null, t.id)} wide>
              <GuaranteeFields type="BID" tender={t} />
            </ModalForm>
          )}
          {admin && (
            <ModalForm title="تقديم العرض" trigger="تسجيل التقديم" triggerClass="btn-ghost btn-sm" action={updateLifecycle.bind(null, t.id, "submit")}>
              <Input name="bidAmount" label="قيمة العرض المقدم (د.أ)" type="number" defaultValue={t.bidAmount ?? (boqTotal || "")} hint={boqTotal ? `إجمالي جدول الكميات: ${fmtJOD(boqTotal)}` : undefined} />
            </ModalForm>
          )}
        </span>
      ),
    },
    {
      title: "فتح العروض والتقييم والتفاوض",
      done: decided,
      body: decided ? (
        lost ? (
          <span className="font-semibold text-bad">لم يُحل العطاء علينا — استرد كفالة الدخول وأعدها للبنك</span>
        ) : (
          <>
            محال بقيمة <Money value={t.awardedValue} strong />
            {t.variationTotal !== 0 && (
              <span className="block">
                قيمة العقد المعدّلة بأوامر التغيير: <Money value={(t.awardedValue ?? 0) + t.variationTotal} strong />
                {t.variationDays ? ` — مدة إضافية ${t.variationDays} يوماً` : ""}
              </span>
            )}
            {t.negotiationDiscount ? <span className="text-ink-muted"> بعد تخفيض تفاوضي {fmtJOD(t.negotiationDiscount)}</span> : null}
          </>
        )
      ) : t.status === "NEGOTIATION" ? "قيد التفاوض مع الجهة" : "بانتظار فتح العروض",
      action: admin && t.status !== "CLOSED" && (
        <ModalForm title="نتيجة العطاء" trigger="تسجيل النتيجة" triggerClass="btn-ghost btn-sm" action={updateLifecycle.bind(null, t.id, "result")}>
          <Select name="status" label="النتيجة" options={{ SUBMITTED: "بانتظار الفتح", NEGOTIATION: "قيد التفاوض", WON: "محال علينا (فوز)", LOST: "غير محال" }} defaultValue={["SUBMITTED", "NEGOTIATION", "WON", "LOST"].includes(t.status) ? t.status : "WON"} />
          <Grid>
            <Input name="bidAmount" label="قيمة العرض المقدم" type="number" defaultValue={t.bidAmount ?? ""} />
            <Input name="negotiationDiscount" label="تخفيض التفاوض" type="number" defaultValue={t.negotiationDiscount ?? ""} />
          </Grid>
          <Grid>
            <Input name="awardedValue" label="قيمة الإحالة النهائية" type="number" defaultValue={t.awardedValue ?? ""} hint="فارغ = العرض − التخفيض" />
            <Input name="resultDate" label="تاريخ النتيجة" type="date" defaultValue={toInputDate(t.resultDate ?? today)} />
          </Grid>
        </ModalForm>
      ),
    },
  ];

  const preList = (
    <ol className="space-y-2">
      {pre.map((s) => (
        <li key={s.title} className="flex gap-3 rounded-xl p-2">
          <span className={clsx("mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full", s.done ? "bg-good text-white" : "bg-white ring-1 ring-line")}>{s.done && <Check className="h-3.5 w-3.5" aria-hidden />}</span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-bold">{s.title}</p>
              {s.action}
            </div>
            <div className="text-sm text-ink-soft">{s.body}</div>
          </div>
        </li>
      ))}
    </ol>
  );

  if (!won) {
    return (
      <div className="space-y-4">
        <p className="text-sm font-semibold text-ink-muted">مرحلة العطاء (قبل الإحالة)</p>
        {preList}
        {!lost && <p className="rounded-xl bg-canvas p-3 text-sm text-ink-muted">بعد الإحالة على الشركة تظهر مراحل المشروع الخمس: الإحالة والتعاقد ← التنفيذ والحصر المرحلي ← الاستلام الابتدائي ← المطالبة النهائية والكفالات ← الاستلام النهائي والإغلاق.</p>}
      </div>
    );
  }

  /* ═════ المرحلة الأولى: الإحالة والتعاقد ═════ */
  const p1: Item[] = [
    {
      title: "ورقة الإحالة ورسوم الطوابع",
      done: !!t.awardLetterDate && files("award_letter").length > 0 && files("stamp_receipt").length > 0,
      body: t.awardLetterDate ? (
        <>ورقة الإحالة {t.awardLetterNo ? `رقم ${t.awardLetterNo}` : ""} بتاريخ {fmtDate(t.awardLetterDate)}{t.stampFee ? <> — رسوم طوابع <Money value={t.stampFee} /> (سُجلت كمصروف)</> : null}</>
      ) : "بانتظار دفع رسوم الطوابع واستلام ورقة الإحالة",
      action: can1 && (
        <ModalForm title="ورقة الإحالة ورسوم الطوابع" trigger="تحديث" triggerClass="btn-ghost btn-sm" action={updateLifecycle.bind(null, t.id, "award")}>
          <Grid>
            <Input name="awardLetterNo" label="رقم ورقة الإحالة" defaultValue={t.awardLetterNo ?? ""} />
            <Input name="awardLetterDate" label="تاريخ ورقة الإحالة" type="date" defaultValue={toInputDate(t.awardLetterDate)} />
          </Grid>
          <Grid>
            <Input name="stampFee" label="رسوم الطوابع (د.أ)" type="number" defaultValue={t.stampFee ?? ""} hint="تُسجل كمصروف تلقائياً" />
            <Input name="stampFeeDate" label="تاريخ الدفع" type="date" defaultValue={toInputDate(t.stampFeeDate ?? today)} />
          </Grid>
          <label className="flex items-center gap-2 text-sm font-semibold text-ink-soft">
            <input type="checkbox" name="noExpense" className="h-4 w-4 accent-[#0071e3]" /> رسوم الطوابع مسجلة سابقاً — لا تُنشئ مصروفاً
          </label>
          <p className="text-xs text-ink-muted">المرفقات اختيارية ويمكن رفعها لاحقاً من خانة كل مستند.</p>
          <FileInput name="file_award_letter" label="الملف الأول: ورقة الإحالة" />
          <FileInput name="file_stamp_receipt" label="الملف الثاني: إيصال رسوم الطوابع" />
        </ModalForm>
      ),
      slots: <>{slot("award_letter", can1)}{slot("stamp_receipt", can1)}</>,
    },
    {
      title: "أمر المباشرة وكفالة حسن التنفيذ",
      done: !!t.commenceOrderDate && perf.length > 0,
      body: (
        <>
          {t.commenceOrderDate ? (
            <span className="block">أمر المباشرة: <b>{fmtDate(t.commenceOrderDate)}</b>{t.durationDays ? ` — مدة التنفيذ ${t.durationDays} يوماً` : ""}</span>
          ) : (
            <span className="block text-ink-muted">بانتظار أمر المباشرة (عادةً بعد أسبوع من الإحالة)</span>
          )}
          {perf.length ? perf.map(gLine) : <span className="block">لم تصدر كفالة حسن التنفيذ من البنك</span>}
        </>
      ),
      action: (
        <span className="flex flex-wrap gap-1">
          {fin && t.status !== "CLOSED" && (
            <ModalForm title="إصدار كفالة حسن التنفيذ" trigger="+ كفالة حسن تنفيذ" triggerClass="btn-ghost btn-sm" action={createGuarantee.bind(null, t.id)} wide>
              <p className="rounded-xl bg-accent-soft px-3 py-2 text-sm text-[#0058b0]">عند الحفظ تُعلَّم كفالة الدخول كمستردة من الجهة تمهيداً لإعادتها للبنك.</p>
              <GuaranteeFields type="PERFORMANCE" tender={t} />
            </ModalForm>
          )}
          {can1 && (
            <ModalForm title="أمر المباشرة وكفالة حسن التنفيذ" trigger="أمر المباشرة" triggerClass="btn-ghost btn-sm" action={updateLifecycle.bind(null, t.id, "commence")}>
              <Grid>
                <Input name="commenceOrderDate" label="تاريخ أمر المباشرة" type="date" required defaultValue={toInputDate(t.commenceOrderDate)} />
                <Input name="durationDays" label="مدة التنفيذ (يوم)" type="number" step="1" defaultValue={t.durationDays ?? ""} />
              </Grid>
              <Grid>
                <Input name="advancePayment" label="الدفعة المقدمة من صاحب العمل (د.أ)" type="number" defaultValue={t.advancePayment || ""} hint="تُودع بالبنك (لا تُخصم من المطالبات)" />
                <Input name="advanceDate" label="تاريخ استلام المقدمة" type="date" defaultValue={toInputDate(t.advanceDate)} />
              </Grid>
              <DepositSlipInput required={slipRequired} hint={slipRequired ? "عند تسجيل دفعة مقدمة: وصل إيداعها في حساب الشركة إلزامي" : undefined} />
              <p className="text-xs text-ink-muted">مرفقات أمر المباشرة والكفالة اختيارية ويمكن رفعها لاحقاً من خانة كل مستند.</p>
              <FileInput name="file_commence_order" label="الملف الأول: أمر المباشرة" />
              <FileInput name="file_performance_guarantee" label="الملف الثاني: صورة كفالة حسن التنفيذ" />
            </ModalForm>
          )}
        </span>
      ),
      slots: <>{slot("commence_order", can1)}{slot("performance_guarantee", can1, perfFiles)}</>,
    },
  ];

  /* ═════ المرحلة الثانية: التنفيذ والحصر المرحلي ═════ */
  const claimLine = (c: Claim) => (
    <a key={c.id} href={`/claims/${c.id}`} className="flex flex-wrap items-center gap-2 hover:underline">
      {CLAIM_TYPE[c.type]} رقم {c.number} — <Money value={c.grossAmount} />
      {c.deductions > 0 && <span className="text-bad">خصومات <Money value={c.deductions} /></span>}
      <StatusBadge map={CLAIM_STATUS} value={c.status} />
    </a>
  );
  const p2: Item[] = [
    {
      title: "نسبة الإنجاز",
      done: t.progress >= 100,
      body: <ProgressBar value={t.progress} className="max-w-sm" />,
      action: canP && (
        <ModalForm title="تحديث نسبة الإنجاز" trigger="تحديث الإنجاز" triggerClass="btn-ghost btn-sm" action={updateLifecycle.bind(null, t.id, "progress")}>
          <Input name="progress" label="نسبة الإنجاز الفعلية (%)" type="number" step="1" min={0} max={100} defaultValue={t.progress} />
          <FileInput label="صور التقدم من الموقع" />
        </ModalForm>
      ),
    },
    {
      title: "الحصر الفعلي للبنود",
      done: boqProgress.total > 0 && boqProgress.completed === boqProgress.total,
      body: boqProgress.total ? (
        <>
          <b className="num">{boqProgress.completed}</b> بنداً منجزاً بالكامل من أصل <b className="num">{boqProgress.total}</b> — بدأ العمل في <b className="num">{boqProgress.started}</b> بنداً
          <span className="block text-ink-muted">{surveyCount} حصر مسجل — يُدخل مدير المشروع الكميات التراكمية المنفذة فيدققها المحاسب ويصدر منها المطالبة</span>
        </>
      ) : "لا يوجد جدول كميات لهذا المشروع",
      action: (proj || can.manageFinance(user.role)) && <a href={`/tenders/${t.id}?tab=surveys`} className="btn-ghost btn-sm">الحصر الفعلي</a>,
    },
    {
      title: "المطالبات المرحلية — المراجعة والاعتماد",
      done: interim.some((c) => ISSUED_CLAIM.includes(c.status)),
      body: interim.length ? (
        <span className="flex flex-col gap-1">{interim.map(claimLine)}</span>
      ) : (
        "لا مطالبات مرحلية بعد — تُصدر من الحصر الفعلي، يراجعها المحاسب (مع الملاحظات والخصومات) ويعتمدها المدير العام"
      ),
      action: <a href={`/tenders/${t.id}?tab=claims`} className="btn-ghost btn-sm">المطالبات</a>,
    },
  ];

  /* ═════ المرحلة الثالثة: الاستلام الابتدائي ═════ */
  const p3: Item[] = [
    {
      title: "كشف لجنة الاستلام الابتدائي",
      done: !!t.prelimInspectionDate,
      body: t.prelimInspectionDate ? (
        <>
          نزلت اللجنة بتاريخ <b>{fmtDate(t.prelimInspectionDate)}</b>
          {t.prelimCommittee && <span className="block">أعضاء اللجنة: {t.prelimCommittee}</span>}
          {t.prelimSnags ? <span className="mt-1 block whitespace-pre-line rounded-lg bg-warn-soft px-2 py-1 text-warn">النواقص والملاحظات: {t.prelimSnags}</span> : <span className="block font-semibold text-good">الأعمال مطابقة — لا نواقص</span>}
        </>
      ) : "عند انتهاء الأعمال تُطلب لجنة الاستلام لكشف الأعمال وتسجيل النواقص أو الخصومات",
      action: canP && (
        <ModalForm title="كشف لجنة الاستلام الابتدائي" trigger={t.prelimInspectionDate ? "تعديل الكشف" : "تسجيل الكشف"} triggerClass="btn-ghost btn-sm" action={updateLifecycle.bind(null, t.id, "prelimInspection")}>
          <Input name="prelimInspectionDate" label="تاريخ نزول اللجنة" type="date" required defaultValue={toInputDate(t.prelimInspectionDate ?? today)} />
          <Input name="prelimCommittee" label="أعضاء اللجنة" defaultValue={t.prelimCommittee ?? ""} placeholder="م. ... (رئيساً)، م. ...، مندوب صاحب العمل" />
          <Textarea name="prelimSnags" label="النواقص والملاحظات (فارغ = الأعمال مطابقة)" defaultValue={t.prelimSnags ?? ""} rows={4} />
          <FileInput name="file_prelim_inspection" label="محضر الكشف / قائمة النواقص" />
        </ModalForm>
      ),
      slots: slot("prelim_inspection", canP),
    },
    ...(t.prelimSnags
      ? [
          {
            title: "معالجة النواقص",
            done: !!t.prelimSnagsClearedDate,
            body: t.prelimSnagsClearedDate ? <>عولجت النواقص بتاريخ {fmtDate(t.prelimSnagsClearedDate)}</> : "بانتظار معالجة النواقص وإعادة الكشف من اللجنة",
            action: canP && (
              <ModalForm title="معالجة النواقص" trigger="تمت المعالجة" triggerClass="btn-ghost btn-sm" action={updateLifecycle.bind(null, t.id, "snagsCleared")}>
                <Input name="prelimSnagsClearedDate" label="تاريخ إنهاء المعالجة ومطابقة اللجنة" type="date" required defaultValue={toInputDate(t.prelimSnagsClearedDate ?? today)} />
              </ModalForm>
            ),
          } satisfies Item,
        ]
      : []),
    {
      title: "محضر الاستلام الابتدائي",
      done: !!t.preliminaryHandoverDate,
      body: t.preliminaryHandoverDate ? (
        <>اعتُمد محضر الاستلام الابتدائي بتاريخ <b>{fmtDate(t.preliminaryHandoverDate)}</b> — مدة الصيانة {t.maintenanceMonths === 24 ? "سنتان" : "سنة واحدة"}</>
      ) : "يُعتمد بعد مطابقة الأعمال، موقّعاً من لجنة الاستلام",
      action: canP && (
        <ModalForm title="محضر الاستلام الابتدائي" trigger={t.preliminaryHandoverDate ? "تعديل" : "اعتماد المحضر"} triggerClass="btn-ghost btn-sm" action={updateLifecycle.bind(null, t.id, "prelimHandover")}>
          <Grid>
            <Input name="preliminaryHandoverDate" label="تاريخ محضر الاستلام الابتدائي" type="date" required defaultValue={toInputDate(t.preliminaryHandoverDate ?? today)} />
            <Select name="maintenanceMonths" label="مدة الصيانة حسب العقد" options={[{ value: 12, label: "سنة واحدة" }, { value: 24, label: "سنتان" }]} defaultValue={t.maintenanceMonths ?? 12} />
          </Grid>
          <FileInput name="file_prelim_handover" label="محضر الاستلام الابتدائي الموقّع (اختياري — يمكن رفعه لاحقاً)" />
          <p className="text-xs text-ink-muted">عند الاعتماد: تبدأ فترة الصيانة، ويُبلَّغ المدير العام والمحاسب بإعداد المطالبة النهائية وكفالة الصيانة.</p>
        </ModalForm>
      ),
      slots: slot("prelim_handover", canP),
    },
  ];

  /* ═════ المرحلة الرابعة: المطالبة النهائية وتسليم الكفالات ═════ */
  const finalIssued = finals.some((c) => ISSUED_CLAIM.includes(c.status));
  const p4: Item[] = [
    {
      title: "المطالبة النهائية (الختامية)",
      done: finalIssued,
      body: finals.length ? <span className="flex flex-col gap-1">{finals.map(claimLine)}</span> : finalSurvey ? "الحصر النهائي لدى المحاسب لإعداد المطالبة النهائية" : "يُدخل مدير المشروع «الحصر النهائي» فيعدّ المحاسب المطالبة النهائية لتحصيل كامل المستحقات",
      action: proj && active && <a href={`/tenders/${t.id}?tab=surveys`} className="btn-ghost btn-sm">الحصر النهائي</a>,
    },
    {
      title: "تقديم كفالة الصيانة",
      done: maint.some((g) => g.status !== "ISSUED"),
      body: maint.length ? <span className="flex flex-col gap-1">{maint.map(gLine)}</span> : <>لم تصدر من البنك بعد — تضمن عيوب المصنعية لمدة {t.maintenanceMonths === 24 ? "سنتين" : "سنة"} {fin ? "" : "(يصدرها المدير العام)"}</>,
      action: (
        <span className="flex flex-wrap gap-1">
          {fin && active && (
            <ModalForm title="إصدار كفالة الصيانة" trigger="+ كفالة صيانة" triggerClass="btn-ghost btn-sm" action={createGuarantee.bind(null, t.id)} wide>
              <p className="rounded-xl bg-accent-soft px-3 py-2 text-sm text-[#0058b0]">تُقدَّم مقابل الإفراج عن كفالة حسن التنفيذ — تاريخ الانتهاء الافتراضي: الاستلام الابتدائي + مدة الصيانة.</p>
              <GuaranteeFields type="MAINTENANCE" tender={t} />
            </ModalForm>
          )}
          {canP && maint.some((g) => g.status === "ISSUED") && (
            <ModalForm title="تسليم كفالة الصيانة لصاحب العمل" trigger="تسجيل التسليم" triggerClass="btn-ghost btn-sm" action={updateLifecycle.bind(null, t.id, "maintDelivered")}>
              <Input name="date" label="تاريخ التسليم" type="date" required defaultValue={toInputDate(today)} />
              <FileInput name="file_maintenance_guarantee" label="صورة الكفالة / إيصال التسليم" />
            </ModalForm>
          )}
        </span>
      ),
      slots: slot("maintenance_guarantee", canP, maintFiles),
    },
    {
      title: "الإفراج عن كفالة حسن التنفيذ",
      done: perf.length > 0 && !perf.some((g) => HELD.includes(g.status)),
      body: perf.length ? <span className="flex flex-col gap-1">{perf.map(gLine)}<span className="text-xs text-ink-muted">إعادتها للبنك يسجلها المحاسب/المدير العام من تبويب الكفالات</span></span> : "لا توجد كفالة حسن تنفيذ مسجلة",
      action: canP && perf.some((g) => HELD.includes(g.status)) && (
        <ModalForm title="استلام كفالة حسن التنفيذ من صاحب العمل" trigger="تسجيل الإفراج" triggerClass="btn-ghost btn-sm" action={updateLifecycle.bind(null, t.id, "perfReleased")}>
          <Input name="date" label="تاريخ الإفراج / الاستلام" type="date" required defaultValue={toInputDate(today)} />
          <FileInput name="file_performance_release" label="كتاب الإفراج عن كفالة حسن التنفيذ" />
        </ModalForm>
      ),
      slots: slot("performance_release", canP),
    },
  ];

  /* ═════ المرحلة الخامسة: الاستلام النهائي وإغلاق المشروع ═════ */
  const p5: Item[] = [
    {
      title: "انقضاء مدة الصيانة",
      done: mDays != null && mDays <= 0,
      body: mEnd ? (
        mDays! > 0 ? <>تنتهي مدة الصيانة بتاريخ <b>{fmtDate(mEnd)}</b> — متبقٍ <b className="num">{mDays}</b> يوماً</> : <>انقضت مدة الصيانة بتاريخ <b>{fmtDate(mEnd)}</b> — يمكن طلب لجنة الاستلام النهائي</>
      ) : "تبدأ بعد الاستلام الابتدائي (سنة أو سنتان حسب العقد)",
    },
    {
      title: "كشف لجنة الاستلام النهائي",
      done: !!t.finalInspectionDate,
      body: t.finalInspectionDate ? (
        <>
          نزلت اللجنة بتاريخ <b>{fmtDate(t.finalInspectionDate)}</b>
          {t.finalCommittee && <span className="block">أعضاء اللجنة: {t.finalCommittee}</span>}
          {t.finalNotes && <span className="block whitespace-pre-line text-ink-muted">{t.finalNotes}</span>}
        </>
      ) : "بعد انقضاء مدة الصيانة تُشكَّل لجنة للتأكد من سلامة الأعمال",
      action: canP && (
        <ModalForm title="كشف لجنة الاستلام النهائي" trigger={t.finalInspectionDate ? "تعديل" : "تسجيل الكشف"} triggerClass="btn-ghost btn-sm" action={updateLifecycle.bind(null, t.id, "finalInspection")}>
          {mDays != null && mDays > 0 && <p className="rounded-xl bg-warn-soft px-3 py-2 text-sm font-semibold text-warn">مدة الصيانة لم تنقضِ بعد (تنتهي {fmtDate(mEnd)}) — سجّل الكشف إن كان قد تم فعلاً</p>}
          <Input name="finalInspectionDate" label="تاريخ نزول اللجنة" type="date" required defaultValue={toInputDate(t.finalInspectionDate ?? today)} />
          <Input name="finalCommittee" label="أعضاء اللجنة" defaultValue={t.finalCommittee ?? ""} />
          <Textarea name="finalNotes" label="نتيجة الكشف / الملاحظات" defaultValue={t.finalNotes ?? ""} />
          <FileInput name="file_final_inspection" label="محضر كشف اللجنة" />
        </ModalForm>
      ),
      slots: slot("final_inspection", canP),
    },
    {
      title: "محضر الاستلام النهائي",
      done: !!t.finalHandoverDate,
      body: t.finalHandoverDate ? <>اعتُمد محضر الاستلام النهائي بتاريخ <b>{fmtDate(t.finalHandoverDate)}</b></> : "يُعتمد بعد تأكد اللجنة من سلامة الأعمال",
      action: canP && (
        <ModalForm title="محضر الاستلام النهائي" trigger={t.finalHandoverDate ? "تعديل" : "اعتماد المحضر"} triggerClass="btn-ghost btn-sm" action={updateLifecycle.bind(null, t.id, "finalHandover")}>
          <Input name="finalHandoverDate" label="تاريخ محضر الاستلام النهائي" type="date" required defaultValue={toInputDate(t.finalHandoverDate ?? today)} />
          <FileInput name="file_final_handover" label="محضر الاستلام النهائي الموقّع (اختياري — يمكن رفعه لاحقاً)" />
        </ModalForm>
      ),
      slots: slot("final_handover", canP),
    },
    {
      title: "قرار الإفراج عن كفالة الصيانة",
      done: !!t.maintenanceReleaseDate,
      body: t.maintenanceReleaseDate ? <>صدر قرار الإفراج بتاريخ <b>{fmtDate(t.maintenanceReleaseDate)}</b></> : "يصدر بعد محضر الاستلام النهائي",
      action: canP && (
        <ModalForm title="قرار الإفراج عن كفالة الصيانة" trigger={t.maintenanceReleaseDate ? "تعديل" : "تسجيل القرار"} triggerClass="btn-ghost btn-sm" action={updateLifecycle.bind(null, t.id, "maintReleased")}>
          <Input name="maintenanceReleaseDate" label="تاريخ القرار" type="date" required defaultValue={toInputDate(t.maintenanceReleaseDate ?? today)} />
          <FileInput name="file_maintenance_release" label="قرار الإفراج عن كفالة الصيانة (اختياري — يمكن رفعه لاحقاً)" />
        </ModalForm>
      ),
      slots: slot("maintenance_release", canP),
    },
    {
      title: "إغلاق المشروع رسمياً",
      done: t.status === "CLOSED",
      body: t.status === "CLOSED" ? <>المشروع مغلق{t.closedAt ? ` منذ ${fmtDate(t.closedAt)}` : ""}</> : "بعد محضر الاستلام النهائي وقرار الإفراج عن كفالة الصيانة",
      action: canP && (
        <ModalForm title="إغلاق المشروع رسمياً" trigger="إغلاق المشروع" triggerClass="btn-primary btn-sm" action={updateLifecycle.bind(null, t.id, "close")} submitLabel="تأكيد الإغلاق">
          <p className="text-sm">سيُغلق المشروع ويُبلَّغ المدير العام والمحاسب لاسترداد المحجوزات وإعادة الكفالات للبنك. لا يمكن تعديل المراحل بعد الإغلاق إلا بإعادة فتحه من المدير العام.</p>
        </ModalForm>
      ),
    },
  ];

  const phases: { no: PhaseNo; items: Item[]; note?: React.ReactNode }[] = [
    { no: 1, items: p1 },
    { no: 2, items: p2 },
    { no: 3, items: p3 },
    { no: 4, items: p4 },
    { no: 5, items: p5 },
  ];

  return (
    <div className="space-y-4">
      <details className="rounded-2xl border border-line bg-white p-3">
        <summary className="cursor-pointer text-sm font-bold text-ink-soft">مرحلة العطاء (قبل الإحالة) — مكتملة</summary>
        <div className="mt-2">{preList}</div>
      </details>
      {phases.map((p) => (
        <PhaseCard key={p.no} no={p.no} items={p.items} note={p.note} done={done[p.no]} current={phase === p.no && t.status !== "CLOSED"} upcoming={typeof phase === "number" && p.no > phase && !done[p.no]} />
      ))}
      {user.role === "PM" && proj && (
        <p className="rounded-xl bg-canvas p-3 text-xs text-ink-muted">
          صلاحياتك كمدير للمشروع: تحديث المراحل من الثانية حتى الإغلاق ورفع محاضرها في أي وقت (المرفقات اختيارية). إصدار الكفالات من البنك وإعادتها، واعتماد المطالبات وقبضها، والحذف — للمحاسب والمدير العام.
        </p>
      )}
    </div>
  );
}

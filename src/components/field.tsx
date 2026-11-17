import Link from "next/link";
import { CloudSun, HardHat, ImageIcon, Ruler, Trash2, Users } from "lucide-react";
import type { BoqItem, Equipment, SiteDiary, Survey, SurveyLine } from "@prisma/client";
import { AttachmentList, Badge, Card, EmptyState, StatusBadge } from "./ui";
import { ConfirmButton, FileInput, Grid, Input, ModalForm, Select, Textarea } from "./forms";
import { SURVEY_STATUS, WEATHER, CLAIM_STATUS } from "@/lib/labels";
import { fmtDate, toInputDate, todayUTC } from "@/lib/format";
import { can, type AppUser } from "@/lib/permissions";
import { createSurvey, deleteDiary, deleteSurvey, logFleetExpense, returnSurveyToPM, saveDiary, saveSurveyLines, submitSurveyToAccountant, uploadPhotos } from "@/app/(app)/actions/field";
import { SurveyEditor } from "@/app/(app)/tenders/[id]/survey-editor";

type Att = Map<number, { id: number; fileName: string; size: number }[]>;

/* ═══════════════ الحصر الفعلي ═══════════════ */

export function SurveySection({
  tenderId,
  surveys,
  boqItems,
  previous,
  user,
  isProject,
  canAccess,
  claimNumbers,
  atts,
  boqApproved,
  claimInfo,
}: {
  tenderId: number;
  surveys: (Survey & { lines: SurveyLine[] })[];
  boqItems: BoqItem[];
  previous: Map<number, number>;
  user: AppUser;
  isProject: boolean;
  canAccess: boolean;
  claimNumbers: Map<number, number>;
  atts: Att;
  boqApproved: boolean;
  /** حالة المطالبة المرتبطة بكل حصر (للرفض مع السبب وإعادة التقديم) */
  claimInfo?: Map<number, { number: number; status: string; returnReason: string | null }>;
}) {
  const draft = surveys.find((s) => s.status === "DRAFT");
  const submitted = surveys.find((s) => s.status === "SUBMITTED");
  const field = can.fieldOps(user.role) && canAccess;
  const fin = can.manageFinance(user.role);
  return (
    <div className="space-y-5">
      <Card
        title={
          <span className="flex items-center gap-2">
            <Ruler className="h-5 w-5 text-accent" /> الدورة المستندية: الحصر (مدير المشروع) ← التدقيق والمطالبة (المحاسب) ← الاعتماد النهائي (المدير العام)
          </span>
        }
        action={
          field && isProject && !draft && !submitted && boqApproved && boqItems.length > 0 && (
            <ModalForm title="حصر فعلي جديد في الموقع" trigger="+ حصر جديد" action={createSurvey.bind(null, tenderId)}>
              <Grid>
                <Input name="date" label="تاريخ القياس" type="date" required defaultValue={toInputDate(todayUTC())} />
                <Input name="title" label="العنوان" placeholder="حصر نهاية الشهر / حصر الطابق الأول" />
              </Grid>
              <Select name="kind" label="نوع الحصر" options={{ INTERIM: "حصر مرحلي — لمطالبة مرحلية (مستخلص جاري)", FINAL: "الحصر النهائي — لمطالبة نهائية بعد الاستلام الابتدائي" }} defaultValue="INTERIM" />
              <Textarea name="notes" label="ملاحظات (حضور الإشراف، طريقة القياس)" />
            </ModalForm>
          )
        }
      >
        {!isProject ? (
          <p className="text-sm text-ink-muted">يبدأ الحصر بعد الإحالة وأمر المباشرة.</p>
        ) : boqItems.length === 0 ? (
          <p className="text-sm text-ink-muted">لا يوجد جدول كميات مسعّر لهذا المشروع.</p>
        ) : !boqApproved ? (
          <p className="rounded-xl bg-warn-soft p-3 text-sm font-semibold text-warn">يبدأ الحصر بعد اعتماد المحاسب لجدول الكميات التعاقدي (تبويب «جدول الكميات»).</p>
        ) : submitted ? (
          <div className="space-y-3">
            <p className="font-bold">
              {submitted.kind === "FINAL" ? "الحصر النهائي — " : ""}الحصر رقم {submitted.number} — {fmtDate(submitted.date)} <StatusBadge map={SURVEY_STATUS} value={submitted.status} />
            </p>
            <p className="text-sm text-ink-soft">
              أُرسل للمحاسب {submitted.submittedAt ? `بتاريخ ${fmtDate(submitted.submittedAt)}` : ""} — {submitted.lines.length} بنداً مقاساً. {fin ? "دقق الكميات وأعد المطالبة المالية من المعالج." : "بانتظار إعداد المحاسب للمطالبة المالية."}
            </p>
            {fin && (
              <div className="flex flex-wrap gap-2">
                <a href={`/claims/new?tender=${tenderId}`} className="btn-primary">تدقيق الحصر وإعداد المطالبة</a>
                <ModalForm title={`إرجاع الحصر رقم ${submitted.number} لمدير المشروع`} trigger="إرجاع لمدير المشروع" triggerClass="btn-secondary" action={returnSurveyToPM.bind(null, submitted.id)} submitLabel="إرجاع">
                  <Textarea name="reason" label="سبب الإرجاع / الملاحظات على القياس" required />
                </ModalForm>
              </div>
            )}
          </div>
        ) : draft ? (
          <div>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <p className="font-bold">
                {draft.kind === "FINAL" ? "الحصر النهائي — " : ""}الحصر رقم {draft.number} — {fmtDate(draft.date)} {draft.title ? `— ${draft.title}` : ""} <StatusBadge map={SURVEY_STATUS} value={draft.status} />
              </p>
              {field && (user.role === "ADMIN" || draft.createdById === user.id) && (
                <ConfirmButton action={deleteSurvey.bind(null, draft.id)} confirm="حذف هذا الحصر؟" className="btn-danger btn-sm" title="حذف">
                  <Trash2 className="h-4 w-4" /> حذف
                </ConfirmButton>
              )}
            </div>
            {draft.claimId && claimInfo?.get(draft.claimId)?.status === "RETURNED" && (
              <div className="mb-4 rounded-xl border border-bad/25 bg-bad-soft p-3 text-sm">
                <p className="font-bold text-bad">المطالبة رقم {claimInfo.get(draft.claimId)!.number} مرفوضة — معادة للتعديل</p>
                <p className="mt-1 whitespace-pre-line">السبب: {claimInfo.get(draft.claimId)!.returnReason}</p>
                <p className="mt-1 text-xs text-ink-muted">عدّل الكميات واحفظها ثم اضغط «إعادة تقديم المطالبة». <Link href={`/claims/${draft.claimId}`} className="font-semibold text-accent">عرض المطالبة والمراسلات</Link></p>
              </div>
            )}
            {field ? (
              <SurveyEditor
                surveyNumber={draft.number}
                saveAction={saveSurveyLines.bind(null, draft.id)}
                submitAction={submitSurveyToAccountant.bind(null, draft.id)}
                resubmit={!!draft.claimId}
                claimFormHref={draft.claimId ? `/claims/new?tender=${tenderId}&claim=${draft.claimId}` : `/claims/new?tender=${tenderId}`}
                rows={boqItems.map((b) => {
                  const line = draft.lines.find((l) => l.boqItemId === b.id);
                  return {
                    boqItemId: b.id,
                    itemNo: b.itemNo,
                    description: b.description,
                    unit: b.unit,
                    unitPrice: b.unitPrice,
                    boqQty: b.quantity,
                    previousQty: previous.get(b.id) ?? 0,
                    cumulativeQty: line?.cumulativeQty ?? null,
                    note: line?.notes ?? null,
                  };
                })}
              />
            ) : (
              <p className="text-sm text-ink-muted">حصر قيد الإعداد من مدير المشروع ({draft.lines.length} بنداً مقاساً).</p>
            )}
          </div>
        ) : (
          <p className="text-sm text-ink-muted">لا يوجد حصر مفتوح. {field ? "افتح حصراً جديداً لتسجيل الكميات المنفذة فعلياً قبل أي مطالبة." : ""}</p>
        )}
      </Card>

      {surveys.filter((s) => s.status === "CLAIMED").length > 0 && (
        <Card title="سجل الحصر" pad={false} className="pt-5 [&>div:first-child]:px-6">
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>الحصر</th>
                  <th>التاريخ</th>
                  <th className="text-end">بنود مقاسة</th>
                  <th>الحالة</th>
                  <th>المطالبة</th>
                  <th>المرفقات</th>
                </tr>
              </thead>
              <tbody>
                {surveys
                  .filter((s) => s.status === "CLAIMED")
                  .map((s) => (
                    <tr key={s.id}>
                      <td className="font-semibold">رقم {s.number}{s.title ? ` — ${s.title}` : ""}</td>
                      <td className="num">{fmtDate(s.date)}</td>
                      <td className="num text-end">{s.lines.length}</td>
                      <td><StatusBadge map={SURVEY_STATUS} value={s.status} /></td>
                      <td>{s.claimId ? (
                        <span className="flex flex-wrap items-center gap-2">
                          <Link href={`/claims/${s.claimId}`} className="font-semibold text-accent">مطالبة رقم {claimNumbers.get(s.claimId) ?? "—"}</Link>
                          {claimInfo?.get(s.claimId) && <StatusBadge map={CLAIM_STATUS} value={claimInfo.get(s.claimId)!.status} />}
                        </span>
                      ) : "—"}</td>
                      <td><AttachmentList items={atts.get(s.id)} /></td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

/* ═══════════════ اليومية الموقعية ═══════════════ */

export function DiaryForm({ tenderId, d }: { tenderId: number; d?: SiteDiary }) {
  return (
    <ModalForm title={d ? `يومية ${fmtDate(d.date)}` : "يومية موقع جديدة"} trigger={d ? "تعديل" : "+ يومية اليوم"} triggerClass={d ? "btn-ghost btn-sm" : "btn-primary"} action={saveDiary.bind(null, tenderId)} wide>
      <Grid cols={3}>
        <Input name="date" label="التاريخ" type="date" required defaultValue={toInputDate(d?.date ?? todayUTC())} />
        <Select name="weather" label="الطقس" options={WEATHER.map((w) => ({ value: w, label: w }))} defaultValue={d?.weather ?? "مشمس"} />
        <Input name="workforce" label="عدد العمال في الموقع" type="number" step="1" defaultValue={d?.workforce ?? ""} />
      </Grid>
      <Textarea name="workDone" label="الأعمال المنفذة اليوم" required rows={4} defaultValue={d?.workDone} placeholder="صب سقف الطابق الأول — 45 م³ — المحور A-D" />
      <Grid>
        <Textarea name="equipment" label="الآليات العاملة" defaultValue={d?.equipment ?? ""} />
        <Textarea name="materials" label="المواد الواردة / المستهلكة" defaultValue={d?.materials ?? ""} />
      </Grid>
      <Textarea name="issues" label="عوائق، ملاحظات الإشراف، حوادث (تُرسل للمدير العام)" defaultValue={d?.issues ?? ""} />
      <FileInput label="صور الموقع لهذا اليوم" />
    </ModalForm>
  );
}

export function DiaryList({ rows, user, atts, tenderNames }: { rows: SiteDiary[]; user: AppUser; atts: Att; tenderNames?: Map<number, string> }) {
  if (rows.length === 0) return <EmptyState icon={HardHat} title="لا توجد يوميات مسجلة" hint="سجّل يومية الموقع كل يوم: الأعمال المنفذة والعمالة والآليات والعوائق" />;
  return (
    <ul className="stagger space-y-3">
      {rows.map((d) => (
        <li key={d.id} className="card p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="font-bold">{fmtDate(d.date)}{tenderNames && <Link href={`/tenders/${d.tenderId}?tab=diary`} className="ms-2 text-sm font-semibold text-accent">{tenderNames.get(d.tenderId)}</Link>}</p>
              <p className="mt-0.5 flex flex-wrap gap-3 text-xs text-ink-muted">
                {d.weather && <span className="inline-flex items-center gap-1"><CloudSun className="h-3.5 w-3.5" /> {d.weather}</span>}
                <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" /> {d.workforce} عامل</span>
              </p>
            </div>
            <div className="flex gap-1">
              {can.fieldOps(user.role) && (user.role === "ADMIN" || d.createdById === user.id) && (
                <>
                  <DiaryForm tenderId={d.tenderId} d={d} />
                  <ConfirmButton action={deleteDiary.bind(null, d.id)} confirm="حذف اليومية؟" className="btn-danger btn-sm" title="حذف">
                    <Trash2 className="h-4 w-4" />
                  </ConfirmButton>
                </>
              )}
            </div>
          </div>
          <p className="mt-3 whitespace-pre-line text-sm">{d.workDone}</p>
          {(d.equipment || d.materials) && (
            <div className="mt-2 grid gap-2 text-xs text-ink-soft sm:grid-cols-2">
              {d.equipment && <p><b>الآليات:</b> {d.equipment}</p>}
              {d.materials && <p><b>المواد:</b> {d.materials}</p>}
            </div>
          )}
          {d.issues && <p className="mt-2 rounded-xl bg-warn-soft px-3 py-2 text-xs font-semibold text-warn">⚠ {d.issues}</p>}
          <div className="mt-2"><AttachmentList items={atts.get(d.id)} /></div>
        </li>
      ))}
    </ul>
  );
}

/* ═══════════════ معرض الصور ═══════════════ */

export type Photo = { id: number; fileName: string; label: string | null; createdAt: Date; source: string; uploader: string; tenderId: number; tenderName?: string };

export function PhotoUpload({ tenderId }: { tenderId: number }) {
  return (
    <ModalForm title="رفع صور إلى معرض الموقع" trigger="+ رفع صور" action={uploadPhotos.bind(null, tenderId)}>
      <Input name="attachmentLabel" label="الوصف" placeholder="تسليح سقف الطابق الأول قبل الصب" />
      <FileInput label="الصور" hint="يمكن التقاط الصور مباشرة من كاميرا الهاتف" />
    </ModalForm>
  );
}

export function PhotoGrid({ photos }: { photos: Photo[] }) {
  if (photos.length === 0) return <EmptyState icon={ImageIcon} title="لا توجد صور بعد" hint="صور اليوميات والتوريدات والحصر تظهر هنا تلقائياً" />;
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {photos.map((p) => (
        <li key={p.id} className="group overflow-hidden rounded-2xl border border-line bg-white">
          <a href={`/api/files/${p.id}`} target="_blank" rel="noreferrer" className="block aspect-[4/3] overflow-hidden bg-canvas">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/files/${p.id}`} alt={p.label || p.fileName} loading="lazy" className="h-full w-full object-cover transition duration-300 group-hover:scale-105" />
          </a>
          <div className="p-2.5">
            <p className="truncate text-xs font-semibold">{p.label || p.fileName}</p>
            <p className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-ink-muted">
              <Badge className="!px-1.5 !py-0 !text-[10px]">{p.source}</Badge> {fmtDate(p.createdAt)} — {p.uploader}
            </p>
            {p.tenderName && <Link href={`/tenders/${p.tenderId}?tab=photos`} className="block truncate text-[11px] text-accent">{p.tenderName}</Link>}
          </div>
        </li>
      ))}
    </ul>
  );
}

/* ═══════════════ ديزل وصيانة ═══════════════ */

export function FleetExpenseForm({ equipment, tenders, user, fixedTenderId }: { equipment: Equipment[]; tenders: { id: number; name: string }[]; user: AppUser; fixedTenderId?: number }) {
  return (
    <ModalForm title="تسجيل ديزل / صيانة آلية" trigger="+ ديزل / صيانة" triggerClass="btn-secondary" action={logFleetExpense}>
      <Grid>
        <Select name="kind" label="النوع" options={{ FUEL: "تعبئة ديزل", MAINTENANCE: "صيانة / قطع غيار" }} />
        <Select name="equipmentId" label="المعدة" options={equipment.filter((e) => e.status !== "RETIRED").map((e) => ({ value: e.id, label: e.name }))} placeholder="— اختر —" />
      </Grid>
      {fixedTenderId ? (
        <input type="hidden" name="tenderId" value={fixedTenderId} />
      ) : (
        <Select name="tenderId" label="المشروع المحمّل عليه" options={tenders.map((t) => ({ value: t.id, label: t.name }))} placeholder="— اختر —" />
      )}
      <Grid cols={3}>
        <Input name="liters" label="اللترات (للديزل)" type="number" />
        <Input name="amount" label="المبلغ (د.أ)" type="number" required />
        <Input name="date" label="التاريخ" type="date" defaultValue={toInputDate(todayUTC())} />
      </Grid>
      <Grid>
        <Input name="vendor" label="المحطة / الورشة" />
        <Input name="notes" label="ملاحظات" placeholder="تغيير زيت وفلاتر / عداد 12,450 ساعة" />
      </Grid>
      {user.role !== "PM" && <Select name="paymentMethod" label="طريقة الدفع" options={{ COMPANY: "حساب الشركة", CUSTODY: "من العهدة" }} />}
      <FileInput label="صورة الفاتورة / الإيصال" />
      {user.role === "PM" && <p className="text-xs text-ink-muted">يُسجل من عهدتك ويُحمّل على كلفة المشروع.</p>}
    </ModalForm>
  );
}


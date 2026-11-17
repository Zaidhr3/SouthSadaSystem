import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, MessageCircle, Phone, RotateCcw, ShieldAlert, Undo2, XCircle } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { can, see } from "@/lib/permissions";
import { QUOTE_STATUS } from "@/lib/quotes";
import { attachmentsMap } from "@/lib/uploads";
import { fmtDate } from "@/lib/format";
import { AttachmentList, Badge, Card, KeyValue, Money, PageHeader, StatusBadge } from "@/components/ui";
import { ActionForm, FileInput, Grid, Input, ModalForm, Select, Textarea } from "@/components/forms";
import { accountantQuote, adminQuote, manageQuote, pmSubmitQuote } from "../../actions/quotes";

export const metadata = { title: "طلب تسعير" };

const ACTION_LABEL: Record<string, string> = {
  RECEIVED: "وصل من الموقع",
  SPAM: "حُجز كوهمي",
  PM_SUBMITTED: "أرسل مدير المشروع الدراسة",
  RETURNED: "أعاده المحاسب للتعديل",
  AUDITED: "دققه المحاسب ورفعه للإدارة",
  APPROVED: "اعتمدته الإدارة",
  REJECTED: "رفضته الإدارة",
  RESTORED: "استُعيد من الوهمية",
  ASSIGNED: "أُعيد الإسناد",
};

export default async function QuotePage({ params }: { params: { id: string } }) {
  const user = await requireUser(see.quotes);
  const id = Number(params.id);
  const q = await db.quoteRequest.findUnique({ where: { id }, include: { events: { orderBy: { createdAt: "asc" } } } });
  if (!q || (user.role === "PM" && q.assignedPmId !== user.id)) notFound();
  const [pms, files] = await Promise.all([db.user.findMany({ where: { active: true, role: { in: ["PM", "ADMIN"] } }, select: { id: true, name: true }, orderBy: { name: "asc" } }), attachmentsMap("quote", [id])]);
  const pm = pms.find((p) => p.id === q.assignedPmId);
  const pmTurn = ["PM_REVIEW", "RETURNED"].includes(q.status) && can.handleQuotes(user.role) && (user.role === "ADMIN" || q.assignedPmId === user.id);
  const accTurn = q.status === "ACCOUNTANT_REVIEW" && can.auditQuotes(user.role);
  const adminTurn = q.status === "ADMIN_REVIEW" && can.approveQuotes(user.role);
  const wa = `https://wa.me/962${q.phone.replace(/^0/, "")}`;

  return (
    <>
      <PageHeader
        back={{ href: "/quotes", label: "طلبات التسعير" }}
        title={`${q.projectType} — ${q.name}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge map={QUOTE_STATUS} value={q.status} />
            <span className="num">{q.ref}</span>
            <span>{fmtDate(q.createdAt)}</span>
            {q.offer && <Badge tone="orange">{q.offer}</Badge>}
          </span>
        }
        actions={
          <>
            <a href={`tel:${q.phone}`} className="btn-secondary"><Phone className="h-4 w-4" /> اتصال</a>
            <a href={wa} target="_blank" rel="noopener" className="btn-secondary"><MessageCircle className="h-4 w-4" /> واتساب</a>
            {can.approveQuotes(user.role) && q.status !== "SPAM" && !["APPROVED", "REJECTED"].includes(q.status) && (
              <ModalForm title="حجز الطلب كوهمي" trigger={<><ShieldAlert className="h-4 w-4" /> وهمي</>} triggerClass="btn-danger" action={manageQuote.bind(null, id, "spam")}>
                <Textarea name="note" label="السبب (اختياري)" />
              </ModalForm>
            )}
          </>
        }
      />

      {q.status === "SPAM" && (
        <section className="mb-5 rounded-[20px] border border-ink/15 bg-ink/[0.04] p-4">
          <p className="font-bold">حُجز كطلب وهمي — درجة الاشتباه {q.spamScore}%</p>
          <p className="mt-1 text-sm text-ink-soft">{q.spamReasons ?? "—"}</p>
          {can.approveQuotes(user.role) && (
            <div className="mt-3">
              <ModalForm title="استعادة الطلب كحقيقي" trigger={<><RotateCcw className="h-4 w-4" /> طلب حقيقي — استعادة</>} triggerClass="btn-secondary btn-sm" action={manageQuote.bind(null, id, "restore")}>
                <Select name="pmId" label="توجيه إلى مدير المشروع" options={pms.map((p) => ({ value: p.id, label: p.name }))} defaultValue={q.assignedPmId ?? ""} required />
              </ModalForm>
            </div>
          )}
        </section>
      )}

      <div className="grid gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <Card title="طلب العميل">
            <KeyValue
              items={[
                { label: "الاسم", value: q.name },
                { label: "الهاتف", value: <span className="num">{q.phone}</span> },
                { label: "نوع المشروع", value: q.projectType },
                { label: "الموقع", value: q.city ?? "—" },
                { label: "المساحة التقريبية", value: q.area ? `${q.area} م²` : "—" },
                { label: "المصدر", value: "موقع الشركة" },
              ]}
            />
            <p className="mt-4 whitespace-pre-wrap rounded-xl bg-canvas p-3 text-[15px] leading-7">{q.details}</p>
          </Card>

          {(q.pmNotes || pmTurn) && (
            <Card title="دراسة مدير المشروع" action={pm && <Badge tone="blue">{pm.name}</Badge>}>
              {q.status === "RETURNED" && q.accountantNotes && (
                <p className="mb-3 rounded-xl bg-warn-soft px-3 py-2 text-sm font-semibold text-warn">ملاحظات المحاسب: {q.accountantNotes}</p>
              )}
              {pmTurn ? (
                <ActionForm action={pmSubmitQuote.bind(null, id)} submitLabel="إرسال للمحاسب">
                  <Textarea name="pmNotes" label="نطاق العمل والدراسة الفنية" defaultValue={q.pmNotes ?? ""} rows={6} required hint="المواصفات، الكميات التقديرية، المدة، ما يشمله العرض وما لا يشمله" />
                  <Grid>
                    <Input name="pmEstimate" label="التكلفة التقديرية (د.أ)" type="number" step="0.001" defaultValue={q.pmEstimate ?? ""} />
                    <Input name="pmPrice" label="السعر المقترح للعرض (د.أ)" type="number" step="0.001" defaultValue={q.pmPrice ?? ""} required />
                  </Grid>
                  <FileInput label="مرفقات الدراسة (صور الموقع، مخططات، جدول كميات)" />
                </ActionForm>
              ) : (
                <>
                  <p className="whitespace-pre-wrap text-[15px] leading-7">{q.pmNotes}</p>
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <div className="rounded-xl bg-canvas p-3"><p className="text-xs text-ink-muted">التكلفة التقديرية</p><Money value={q.pmEstimate} strong /></div>
                    <div className="rounded-xl bg-accent-soft p-3"><p className="text-xs text-ink-muted">السعر المقترح</p><Money value={q.pmPrice} strong className="text-accent" /></div>
                  </div>
                </>
              )}
              <div className="mt-3"><AttachmentList items={files.get(id)} /></div>
            </Card>
          )}

          {accTurn && (
            <Card title="تدقيق المحاسب">
              <div className="grid gap-3 sm:grid-cols-2">
                <ModalForm title="قبول ورفع للإدارة" trigger={<><CheckCircle2 className="h-4 w-4" /> قبول ورفع للإدارة</>} action={accountantQuote.bind(null, id, "accept")}>
                  <Textarea name="note" label="ملاحظات التدقيق (اختياري)" />
                </ModalForm>
                <ModalForm title="إرجاع لمدير المشروع" trigger={<><Undo2 className="h-4 w-4" /> إرجاع للتعديل</>} triggerClass="btn-secondary" action={accountantQuote.bind(null, id, "return")}>
                  <Textarea name="note" label="ما المطلوب تعديله؟" required />
                </ModalForm>
              </div>
            </Card>
          )}

          {adminTurn && (
            <Card title="اعتماد الإدارة">
              {q.accountantNotes && <p className="mb-3 text-sm text-ink-soft">ملاحظات المحاسب: {q.accountantNotes}</p>}
              <div className="grid gap-3 sm:grid-cols-2">
                <ModalForm title="اعتماد نهائي" trigger={<><CheckCircle2 className="h-4 w-4" /> اعتماد نهائي</>} action={adminQuote.bind(null, id, "approve")}>
                  <label className="flex items-center gap-2 rounded-xl bg-gold-soft p-3 text-sm font-semibold">
                    <input type="checkbox" name="createProject" defaultChecked /> إنشاء «مشروع خاص» من هذا الطلب (ينقل الدراسة والمرفقات)
                  </label>
                  <Textarea name="note" label="ملاحظات (اختياري)" />
                </ModalForm>
                <ModalForm title="رفض الطلب" trigger={<><XCircle className="h-4 w-4" /> رفض</>} triggerClass="btn-danger" action={adminQuote.bind(null, id, "reject")}>
                  <Textarea name="note" label="سبب الرفض" required />
                </ModalForm>
              </div>
            </Card>
          )}
          {q.tenderId && (
            <Link href={`/tenders/${q.tenderId}`} className="card card-pad block font-bold text-accent hover:underline">فتح المشروع الخاص المُنشأ من هذا الطلب ←</Link>
          )}
        </div>

        <div className="space-y-5">
          {can.approveQuotes(user.role) && q.status !== "SPAM" && !["APPROVED", "REJECTED"].includes(q.status) && (
            <Card title="الإسناد">
              <ActionForm action={manageQuote.bind(null, id, "assign")} submitLabel="حفظ الإسناد">
                <Select name="pmId" label="مدير المشروع" options={pms.map((p) => ({ value: p.id, label: p.name }))} defaultValue={q.assignedPmId ?? ""} required />
              </ActionForm>
            </Card>
          )}
          <Card title="مسار الطلب">
            <ol className="relative space-y-4 border-s-2 border-line ps-4">
              {q.events.map((e) => (
                <li key={e.id} className="relative">
                  <span className="absolute -start-[23px] top-1 h-3 w-3 rounded-full bg-accent ring-4 ring-white" />
                  <p className="text-sm font-bold">{ACTION_LABEL[e.action] ?? e.action}</p>
                  <p className="text-xs text-ink-muted">{e.userName ?? "النظام"} — {fmtDate(e.createdAt)}</p>
                  {e.note && <p className="mt-1 text-sm text-ink-soft">{e.note}</p>}
                </li>
              ))}
            </ol>
          </Card>
          {q.spamReasons && q.status !== "SPAM" && (
            <Card title="الفحص الآلي">
              <p className="text-sm text-ink-soft">درجة الاشتباه {q.spamScore}% — {q.spamReasons}</p>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

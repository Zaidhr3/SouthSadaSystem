import { notFound } from "next/navigation";
import { CalendarRange, ExternalLink, FileSignature, KeyRound, MessagesSquare, Pencil, Plus, Trash2, UserPlus, Users } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { can, tenderScope } from "@/lib/permissions";
import { attachmentsMap } from "@/lib/uploads";
import { planProgress, SIGN_STATUS } from "@/lib/portal";
import { fmtDate, toInputDate } from "@/lib/format";
import { AttachmentList, Badge, Card, EmptyState, PageHeader, ProgressBar, StatusBadge } from "@/components/ui";
import { ActionForm, ConfirmButton, FileInput, Grid, Input, ModalForm, Select, Textarea } from "@/components/forms";
import { SignaturePad } from "@/components/signature-pad";
import { addClient, clientAccountAction, companySign, createSignRequest, deleteWorkItem, resetClientPassword, saveWorkItem, staffPortalMessage } from "../../../actions/portal";

export const metadata = { title: "بوابة العميل وخطة العمل" };

type Item = { id: number; title: string; startDate: Date; endDate: Date; progress: number; weight: number; notes: string | null; sortOrder: number };

function WorkItemFields({ it }: { it?: Item }) {
  return (
    <>
      <Input name="title" label="البند / النشاط" required defaultValue={it?.title} placeholder="صب سقف الطابق الأول" />
      <Grid>
        <Input name="startDate" label="البداية" type="date" required defaultValue={toInputDate(it?.startDate)} />
        <Input name="endDate" label="النهاية" type="date" required defaultValue={toInputDate(it?.endDate)} />
      </Grid>
      <Grid cols={3}>
        <Input name="progress" label="الإنجاز %" type="number" min={0} max={100} defaultValue={it?.progress ?? 0} />
        <Input name="weight" label="الوزن النسبي" type="number" step="0.1" min={0.1} defaultValue={it?.weight ?? 1} hint="أهمية البند في الإنجاز الكلي" />
        <Input name="sortOrder" label="الترتيب" type="number" defaultValue={it?.sortOrder ?? 0} />
      </Grid>
      <Textarea name="notes" label="ملاحظات تظهر للعميل" defaultValue={it?.notes ?? ""} />
    </>
  );
}

export default async function TenderPortalPage({ params }: { params: { id: string } }) {
  const user = await requireUser(can.managePortal);
  const id = Number(params.id);
  const tender = await db.tender.findFirst({
    where: { id, ...tenderScope(user) },
    include: {
      clientAccesses: { include: { client: true }, orderBy: { createdAt: "asc" } },
      workPlan: { orderBy: [{ sortOrder: "asc" }, { startDate: "asc" }] },
      portalMessages: { orderBy: { createdAt: "asc" }, take: 200 },
      signRequests: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!tender) notFound();
  const [msgFiles, signFiles] = await Promise.all([attachmentsMap("portal_message", tender.portalMessages.map((m) => m.id)), attachmentsMap("sign_request", tender.signRequests.map((s) => s.id))]);
  const admin = can.manageClients(user.role);
  const plan = planProgress(tender.workPlan);
  const min = tender.workPlan.length ? Math.min(...tender.workPlan.map((i) => +i.startDate)) : 0;
  const max = tender.workPlan.length ? Math.max(...tender.workPlan.map((i) => +i.endDate)) : 1;
  const span = Math.max(max - min, 86400000);
  const today = Date.now();
  const unread = tender.portalMessages.filter((m) => m.fromClientId && !m.readByStaffAt).length;

  return (
    <>
      <PageHeader
        back={{ href: `/tenders/${id}`, label: tender.name }}
        title="بوابة العميل وخطة العمل"
        subtitle="ما تدخله هنا (خطة العمل، الإنجاز، اليوميات، الرسائل، المستندات) يظهر مباشرة للمالك والمهندس المشرف في بوابتهم"
        actions={<a href="/portal/login" target="_blank" className="btn-secondary"><ExternalLink className="h-4 w-4" /> فتح بوابة العملاء</a>}
      />

      <div className="grid gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <Card
            title={<span className="flex items-center gap-2"><CalendarRange className="h-5 w-5" /> خطة العمل (البرنامج الزمني)</span>}
            action={
              <ModalForm title="بند جديد في خطة العمل" trigger={<><Plus className="h-4 w-4" /> بند</>} triggerClass="btn-primary btn-sm" action={saveWorkItem.bind(null, id, null)}>
                <WorkItemFields />
              </ModalForm>
            }
          >
            <div className="mb-4 grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-canvas p-3"><p className="text-xs text-ink-muted">نسبة الإنجاز المعلنة للمشروع</p><p className="num text-xl font-extrabold">{tender.progress}%</p></div>
              <div className="rounded-xl bg-canvas p-3"><p className="text-xs text-ink-muted">الإنجاز الموزون من خطة العمل</p><p className="num text-xl font-extrabold">{plan == null ? "—" : `${plan}%`}</p></div>
            </div>
            {tender.workPlan.length === 0 ? (
              <EmptyState icon={CalendarRange} title="لا توجد خطة عمل بعد" hint="أضف بنود البرنامج الزمني ليتابعها العميل" />
            ) : (
              <ul className="space-y-3">
                {tender.workPlan.map((it) => {
                  const left = ((+it.startDate - min) / span) * 100;
                  const width = Math.max(((+it.endDate - +it.startDate) / span) * 100, 2);
                  const late = +it.endDate < today && it.progress < 100;
                  return (
                    <li key={it.id} className="rounded-xl border border-line p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-bold">{it.title} {late && <Badge tone="red">متأخر</Badge>}</p>
                        <div className="flex items-center gap-1">
                          <span className="num text-sm font-bold text-accent">{it.progress}%</span>
                          <ModalForm title="تعديل البند" trigger={<Pencil className="h-4 w-4" />} triggerClass="btn-ghost btn-sm" action={saveWorkItem.bind(null, id, it.id)}>
                            <WorkItemFields it={it} />
                          </ModalForm>
                          <ConfirmButton action={deleteWorkItem.bind(null, id, it.id)} confirm="حذف البند من خطة العمل؟" className="btn-danger btn-sm" title="حذف">
                            <Trash2 className="h-4 w-4" />
                          </ConfirmButton>
                        </div>
                      </div>
                      <p className="num text-xs text-ink-muted">{fmtDate(it.startDate)} ← {fmtDate(it.endDate)}</p>
                      <div className="relative mt-2 h-3 rounded-full bg-canvas">
                        <div className="absolute inset-y-0 overflow-hidden rounded-full bg-navy/15" style={{ insetInlineStart: `${left}%`, width: `${width}%` }}>
                          <div className="progress-fill h-full" style={{ width: `${it.progress}%` }} />
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card title={<span className="flex items-center gap-2"><MessagesSquare className="h-5 w-5" /> المراسلات مع العميل {unread > 0 && <Badge tone="red">{unread} جديدة</Badge>}</span>}>
            <div className="mb-4 max-h-[460px] space-y-3 overflow-y-auto">
              {tender.portalMessages.length === 0 && <p className="py-6 text-center text-sm text-ink-muted">لا توجد رسائل بعد</p>}
              {tender.portalMessages.map((m) => (
                <div key={m.id} className={m.fromClientId ? "me-10 rounded-2xl rounded-ss-sm bg-gold-soft p-3" : "ms-10 rounded-2xl rounded-se-sm bg-navy/[0.06] p-3"}>
                  <p className="text-xs font-bold text-ink-muted">{m.senderName} — {fmtDate(m.createdAt)}</p>
                  <p className="mt-1 whitespace-pre-wrap text-[15px]">{m.body}</p>
                  <AttachmentList items={msgFiles.get(m.id)} />
                </div>
              ))}
            </div>
            <ActionForm action={staffPortalMessage.bind(null, id)} submitLabel="إرسال للعميل" resetOnSuccess>
              <Textarea name="body" label="رسالة للعميل" required />
              <FileInput label="مرفقات (اختياري)" />
            </ActionForm>
          </Card>
        </div>

        <div className="space-y-5">
          <Card
            title={<span className="flex items-center gap-2"><Users className="h-5 w-5" /> حسابات العميل</span>}
            action={
              admin && (
                <ModalForm title="حساب عميل جديد" trigger={<><UserPlus className="h-4 w-4" /> إضافة</>} triggerClass="btn-primary btn-sm" action={addClient.bind(null, id)}>
                  <Input name="name" label="الاسم" required />
                  <Input name="email" label="البريد الإلكتروني (اسم الدخول)" type="email" dir="ltr" required />
                  <Grid>
                    <Input name="phone" label="الهاتف" dir="ltr" />
                    <Select name="kind" label="الصفة" options={[{ value: "OWNER", label: "المالك" }, { value: "SUPERVISOR", label: "المهندس المشرف" }]} defaultValue="OWNER" />
                  </Grid>
                  <p className="text-xs text-ink-muted">تُنشأ كلمة مرور مؤقتة وتظهر لك (وتُرسل بالبريد إن كان مُعداً). إن كان البريد مسجلاً يُربط الحساب بهذا المشروع أيضاً.</p>
                </ModalForm>
              )
            }
          >
            {tender.clientAccesses.length === 0 ? (
              <p className="py-4 text-center text-sm text-ink-muted">لا يوجد حساب عميل لهذا المشروع{admin ? "" : " — تُنشأ الحسابات من الإدارة"}</p>
            ) : (
              <ul className="divide-y divide-line">
                {tender.clientAccesses.map(({ client: c }) => (
                  <li key={c.id} className="py-2.5">
                    <p className="font-bold">{c.name} <Badge tone={c.kind === "OWNER" ? "orange" : "blue"}>{c.kind === "OWNER" ? "المالك" : "المهندس المشرف"}</Badge> {!c.active && <Badge tone="red">موقوف</Badge>}</p>
                    <p className="text-xs text-ink-muted" dir="ltr">{c.email}</p>
                    <p className="text-xs text-ink-muted">آخر دخول: {c.lastLoginAt ? fmtDate(c.lastLoginAt) : "لم يدخل بعد"}</p>
                    {admin && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        <ModalForm title={`كلمة مرور جديدة — ${c.name}`} trigger={<><KeyRound className="h-3.5 w-3.5" /> كلمة مرور</>} triggerClass="btn-ghost btn-sm" action={resetClientPassword.bind(null, id, c.id)} submitLabel="إنشاء كلمة مرور مؤقتة">
                          <p className="text-sm text-ink-soft">تُنهى كل جلسات العميل الحالية ويُطلب منه تغييرها عند الدخول.</p>
                        </ModalForm>
                        <ConfirmButton action={clientAccountAction.bind(null, id, c.id, "toggle")} confirm={c.active ? "إيقاف دخول هذا العميل لكل مشاريعه؟" : "إعادة تفعيل الحساب؟"} className="btn-ghost btn-sm">{c.active ? "إيقاف" : "تفعيل"}</ConfirmButton>
                        <ConfirmButton action={clientAccountAction.bind(null, id, c.id, "revoke")} confirm="فك ربط الحساب بهذا المشروع؟" className="btn-danger btn-sm">فك الربط</ConfirmButton>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card
            title={<span className="flex items-center gap-2"><FileSignature className="h-5 w-5" /> مستندات للتوقيع</span>}
            action={
              <ModalForm title="مستند للتوقيع المتبادل" trigger={<><Plus className="h-4 w-4" /> مستند</>} triggerClass="btn-primary btn-sm" action={createSignRequest.bind(null, id)} wide>
                <Input name="title" label="عنوان المستند" required placeholder="محضر استلام أعمال الهيكل" />
                <Textarea name="description" label="وصف (اختياري)" />
                <FileInput label="المستند (PDF أو صورة)" />
                <Input name="signerName" label="اسم الموقّع عن الشركة" defaultValue={user.name} required />
                <SignaturePad />
                <p className="text-xs text-ink-muted">يُحفظ مع التوقيع: بصمة SHA-256 للمستند، والوقت، وعنوان الشبكة — لإثبات أن المستند لم يتغير بعد التوقيع.</p>
              </ModalForm>
            }
          >
            {tender.signRequests.length === 0 ? (
              <p className="py-4 text-center text-sm text-ink-muted">لا توجد مستندات</p>
            ) : (
              <ul className="space-y-3">
                {tender.signRequests.map((s) => (
                  <li key={s.id} className="rounded-xl border border-line p-3">
                    <p className="font-bold">{s.title}</p>
                    <StatusBadge map={SIGN_STATUS} value={s.status} />
                    <div className="mt-2 space-y-0.5 text-xs text-ink-muted">
                      {s.companySignedAt && <p>الشركة: {s.companySignerName} — {fmtDate(s.companySignedAt)}</p>}
                      {s.clientSignedAt && <p>العميل: {s.clientSignerName} — {fmtDate(s.clientSignedAt)}</p>}
                      {s.rejectReason && <p className="text-bad">{s.rejectReason}</p>}
                      {s.docHash && <p className="num truncate" dir="ltr" title={s.docHash}>SHA-256 {s.docHash.slice(0, 24)}…</p>}
                    </div>
                    <AttachmentList items={signFiles.get(s.id)} />
                    <div className="mt-2 flex gap-2">
                      {s.companySignature && <img src={s.companySignature} alt="توقيع الشركة" className="h-12 rounded border border-line bg-white" />}
                      {s.clientSignature && <img src={s.clientSignature} alt="توقيع العميل" className="h-12 rounded border border-line bg-white" />}
                    </div>
                    {s.status === "PENDING_COMPANY" && (
                      <div className="mt-2 flex gap-2">
                        <ModalForm title={`توقيع: ${s.title}`} trigger="توقيع الشركة" triggerClass="btn-primary btn-sm" action={companySign.bind(null, id, s.id)}>
                          <Input name="signerName" label="اسم الموقّع" defaultValue={user.name} required />
                          <SignaturePad />
                        </ModalForm>
                        <ModalForm title="رفض المستند" trigger="رفض" triggerClass="btn-danger btn-sm" action={companySign.bind(null, id, s.id)}>
                          <input type="hidden" name="reject" value="1" />
                          <Textarea name="reason" label="سبب الرفض" required />
                        </ModalForm>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <ProgressBar value={tender.progress} />
        </div>
      </div>
    </>
  );
}

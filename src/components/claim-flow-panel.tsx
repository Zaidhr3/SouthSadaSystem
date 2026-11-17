import clsx from "clsx";
import { AlertTriangle, Check, MessagesSquare, X } from "lucide-react";
import type { Claim, ClaimEvent } from "@prisma/client";
import { ActionForm, Input, ModalForm, Select, Textarea } from "@/components/forms";
import { Badge, StatusBadge } from "@/components/ui";
import { CLAIM_EVENT, DISBURSE_STAGE, ROLE_LABELS } from "@/lib/labels";
import { toInputDate, todayUTC } from "@/lib/format";
import { updateDisbursement } from "@/app/(app)/actions/claim-flow";
import { sendMessage } from "@/app/(app)/actions/messages";

const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Amman", dateStyle: "short", timeStyle: "short" });

const STEPS = [
  { title: "مدير المشروع", sub: "إدخال وإرسال" },
  { title: "المحاسب", sub: "تدقيق ورفع للإدارة" },
  { title: "الإدارة", sub: "موافقة أو رفض" },
  { title: "الصرف", sub: "متابعة حتى القبض" },
];

/** موقع المطالبة في الدورة: 0 مدير المشروع · 1 المحاسب · 2 الإدارة · 3 الصرف · 4 مكتملة */
function stepOf(status: string) {
  switch (status) {
    case "RETURNED": return 0;
    case "DRAFT": return 1;
    case "READY":
    case "REVIEW": return 2;
    case "SUBMITTED":
    case "APPROVED":
    case "REJECTED": return 3;
    case "PAID": return 4;
    default: return 1;
  }
}

type Msg = { id: number; subject: string; body: string; createdAt: Date; sender: { name: string }; recipient: { name: string } };

export function ClaimFlowPanel({
  claim,
  events,
  messages,
  recipients,
  canDisburse,
  canMessage,
  hasSurvey,
}: {
  claim: Claim & { tender: { id: number; name: string } };
  events: ClaimEvent[];
  messages: Msg[];
  recipients: { id: number; name: string; role: string }[];
  canDisburse: boolean;
  canMessage: boolean;
  hasSurvey: boolean;
}) {
  const step = stepOf(claim.status);
  const returned = claim.status === "RETURNED";
  const afterApproval = ["SUBMITTED", "APPROVED", "PAID", "REJECTED"].includes(claim.status);
  const blocked = claim.disbursementStage === "BLOCKED" && claim.status !== "PAID";
  // رسالة واحدة لعدة مستلمين تُعرض مرة واحدة «إلى: أ، ب»
  const grouped: { key: number; sender: string; to: string[]; body: string; createdAt: Date }[] = [];
  for (const m of messages) {
    const prev = grouped[grouped.length - 1];
    if (prev && prev.sender === m.sender.name && prev.body === m.body && Math.abs(prev.createdAt.getTime() - m.createdAt.getTime()) < 60_000) prev.to.push(m.recipient.name);
    else grouped.push({ key: m.id, sender: m.sender.name, to: [m.recipient.name], body: m.body, createdAt: m.createdAt });
  }

  return (
    <div className="no-print mb-5 space-y-4">
      {/* مسار الدورة */}
      <section className="card card-pad">
        <ol className="grid grid-cols-4 gap-2" aria-label="مسار اعتماد المطالبة">
          {STEPS.map((s, i) => {
            const done = i < step;
            const cur = i === step;
            const bad = cur && (returned || (i === 3 && (blocked || claim.status === "REJECTED")));
            return (
              <li key={s.title} className="flex flex-col" aria-current={cur ? "step" : undefined}>
                <span className={clsx("h-1.5 rounded-full", done ? "bg-good" : bad ? "bg-bad" : cur ? "bg-accent" : "bg-black/10")} />
                <span className="mt-2 flex items-center gap-1.5">
                  <span className={clsx("grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold", done ? "bg-good text-white" : bad ? "bg-bad text-white" : cur ? "bg-accent text-white ring-4 ring-accent/15" : "bg-canvas text-ink-muted ring-1 ring-line")}>
                    {done ? <Check className="h-3.5 w-3.5" aria-hidden /> : bad ? <X className="h-3.5 w-3.5" aria-hidden /> : i + 1}
                  </span>
                  <span className="min-w-0 leading-tight">
                    <span className={clsx("block text-[13px] font-bold", cur ? "text-ink" : "text-ink-muted")}>{s.title}</span>
                    <span className="hidden text-[11px] text-ink-muted sm:block">{s.sub}</span>
                  </span>
                </span>
              </li>
            );
          })}
        </ol>
        {returned && (
          <div className="mt-4 rounded-xl border border-bad/25 bg-bad-soft p-3 text-sm">
            <p className="flex items-center gap-2 font-bold text-bad"><AlertTriangle className="h-4 w-4" aria-hidden /> مرفوضة — معادة للتعديل{claim.returnedAt ? ` (${time.format(claim.returnedAt)})` : ""}</p>
            <p className="mt-1 whitespace-pre-line text-ink">السبب: {claim.returnReason}</p>
            <p className="mt-1 text-xs text-ink-muted">{hasSurvey ? "اضغط «تعديل المطالبة وإعادة الإرسال» لتعديل الكميات والحسومات (أو عدّل الحصر من تبويب الحصر الفعلي) — تعود بنفس رقمها إلى المحاسب ثم الإدارة." : "اضغط «تعديل المطالبة وإعادة الإرسال» لتعديل الكميات والحسومات — تعود بنفس رقمها إلى المحاسب ثم الإدارة."}</p>
          </div>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* متابعة إجراءات الصرف */}
        <section className="card card-pad">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-bold">إجراءات الصرف</h2>
            {claim.disbursementStage && claim.status !== "PAID" && <StatusBadge map={DISBURSE_STAGE} value={claim.disbursementStage} />}
            {claim.status === "PAID" && <Badge tone="green">تم الصرف</Badge>}
          </div>
          {!afterApproval ? (
            <p className="text-sm text-ink-muted">تبدأ متابعة الصرف بعد موافقة الإدارة على المطالبة.</p>
          ) : claim.status === "PAID" ? (
            <p className="text-sm text-ink-soft">صُرفت المطالبة وأُودع المبلغ في الحساب البنكي.</p>
          ) : (
            <>
              <p className={clsx("rounded-xl p-3 text-sm", blocked ? "bg-bad-soft text-bad" : "bg-canvas text-ink-soft")}>
                {claim.disbursementStage ? (
                  <>
                    <b>{DISBURSE_STAGE[claim.disbursementStage]?.label}</b>
                    {claim.disbursementNote && <span className="mt-0.5 block whitespace-pre-line">{claim.disbursementNote}</span>}
                    {claim.disbursementUpdatedAt && <span className="mt-0.5 block text-xs opacity-80">آخر تحديث {time.format(claim.disbursementUpdatedAt)}</span>}
                  </>
                ) : (
                  "تمت الموافقة — بانتظار تسليمها لصاحب العمل وبدء إجراءات الصرف"
                )}
              </p>
              {canDisburse && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <ModalForm title="تحديث إجراءات الصرف" trigger="تحديث الصرف" triggerClass="btn-primary btn-sm" action={updateDisbursement.bind(null, claim.id)}>
                    <Select name="stage" label="المرحلة" options={Object.fromEntries(Object.entries(DISBURSE_STAGE).map(([k, v]) => [k, v.label]))} defaultValue={claim.disbursementStage ?? "DELIVERED"} />
                    <Input name="date" label="التاريخ" type="date" defaultValue={toInputDate(todayUTC())} />
                    <Textarea name="note" label="ملاحظات / وصف المعيق" placeholder="مثال: الجهة طلبت كشف كميات إضافي، أو بانتظار توقيع المهندس المشرف" />
                  </ModalForm>
                  <ModalForm title="الإبلاغ عن معيق في الصرف" trigger="الإبلاغ عن معيق" triggerClass="btn-danger btn-sm" action={updateDisbursement.bind(null, claim.id)}>
                    <input type="hidden" name="stage" value="BLOCKED" />
                    <Textarea name="note" label="ما المعيق؟" required placeholder="مثال: المالية أوقفت الصرف لعدم إرفاق براءة ذمة الضمان الاجتماعي" />
                    <p className="text-xs text-ink-muted">تُبلَّغ الإدارة والمحاسب فوراً. استخدم «المراسلات حول المطالبة» لتوثيق التفاصيل.</p>
                  </ModalForm>
                </div>
              )}
            </>
          )}
        </section>

        {/* سجل الدورة */}
        <section className="card card-pad">
          <h2 className="mb-3 text-base font-bold">سجل المطالبة</h2>
          {events.length === 0 ? (
            <p className="text-sm text-ink-muted">لا توجد أحداث مسجلة بعد.</p>
          ) : (
            <ol className="relative space-y-3 border-s border-line ps-4">
              {events.map((e) => (
                <li key={e.id} className="relative">
                  <span className={clsx("absolute -start-[21px] top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-white", ["rejected", "returned"].includes(e.action) || (e.action === "disbursement" && e.note?.startsWith(DISBURSE_STAGE.BLOCKED.label)) ? "bg-bad" : ["approved", "paid"].includes(e.action) ? "bg-good" : "bg-accent")} />
                  <p className="text-sm font-semibold">{CLAIM_EVENT[e.action] ?? e.action}</p>
                  {e.note && <p className="whitespace-pre-line text-sm text-ink-soft">{e.note}</p>}
                  <p className="text-xs text-ink-muted">
                    {e.userName ?? "النظام"}{e.userRole ? ` (${ROLE_LABELS[e.userRole as keyof typeof ROLE_LABELS] ?? e.userRole})` : ""} — <span className="num">{time.format(e.createdAt)}</span>
                  </p>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      {/* المراسلات الداخلية حول المطالبة */}
      <section id="claim-messages" className="card card-pad scroll-mt-24">
        <h2 className="mb-3 flex items-center gap-2 text-base font-bold"><MessagesSquare className="h-5 w-5 text-accent" aria-hidden /> المراسلات حول المطالبة</h2>
        {messages.length === 0 ? (
          <p className="mb-3 text-sm text-ink-muted">لا توجد مراسلات بعد — وثّق هنا أي معيقات أو توضيحات بين الإدارة والموقع والمحاسب.</p>
        ) : (
          <ul className="mb-4 space-y-2.5">
            {grouped.map((m) => (
              <li key={m.key} className="rounded-xl bg-canvas p-3">
                <p className="text-xs font-semibold text-ink-muted">{m.sender} ← {m.to.join("، ")} — <span className="num">{time.format(m.createdAt)}</span></p>
                <p className="mt-1 whitespace-pre-line text-sm">{m.body}</p>
              </li>
            ))}
          </ul>
        )}
        {canMessage && recipients.length > 0 && (
          <ActionForm action={sendMessage} submitLabel="إرسال الرسالة" resetOnSuccess allowReadOnly>
            <input type="hidden" name="claimId" value={claim.id} />
            <input type="hidden" name="subject" value={`بخصوص المطالبة رقم ${claim.number} — ${claim.tender.name}`} />
            <input type="hidden" name="stay" value="1" />
            <Select name="recipientId" label="إلى" options={recipients.map((r) => ({ value: r.id, label: `${r.name} — ${ROLE_LABELS[r.role as keyof typeof ROLE_LABELS] ?? r.role}` }))} />
            <Textarea name="body" label="الرسالة" required rows={3} placeholder="اكتب التوضيح أو المعيق..." />
          </ActionForm>
        )}
      </section>
    </div>
  );
}

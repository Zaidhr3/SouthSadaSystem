import Link from "next/link";
import { notFound } from "next/navigation";
import clsx from "clsx";
import { Check, Download, Eye, Printer } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { tenderScope } from "@/lib/permissions";
import { LETTER_STATUS } from "@/lib/labels";
import { fmtDate, toInputDate } from "@/lib/format";
import { letterHtml } from "@/lib/letter";
import { letterDataOf, loadLetter, LETTER_PDF_LABEL } from "@/lib/letter-load";
import { canEditLetter, canReviewLetter, letterState } from "@/lib/letter-flow";
import { AttachmentList, Card, PageHeader, StatusBadge } from "@/components/ui";
import { LetterEditForm, LetterReview } from "@/components/letters";

export const metadata = { title: "كتاب رسمي" };

export default async function LetterPage({ params }: { params: { id: string } }) {
  const user = await requireUser();
  const c = await loadLetter(Number(params.id), user);
  if (!c) notFound();
  const state = letterState(c)!;
  const approved = state === "APPROVED";
  const ids = [c.createdById, c.accountantById, c.approvedById].filter((x): x is number => !!x);
  const [people, evidence, tenders, incoming] = await Promise.all([
    db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }),
    db.attachment.findMany({ where: { entityType: "correspondence", entityId: c.id, NOT: { label: LETTER_PDF_LABEL } }, select: { id: true, fileName: true, size: true }, orderBy: { id: "asc" } }),
    db.tender.findMany({ where: { ...tenderScope(user), status: { notIn: ["LOST", "CANCELLED"] } }, select: { id: true, name: true } }),
    db.correspondence.findMany({ where: { direction: "IN", ...(user.role === "PM" ? { tender: tenderScope(user) } : {}) }, orderBy: [{ date: "desc" }, { id: "desc" }], take: 200 }),
  ]);
  const who = (id: number | null) => people.find((p) => p.id === id)?.name ?? "—";
  const canEdit = canEditLetter(user, c);
  const canReview = canReviewLetter(user, c);
  const resubmit = state === "RETURNED" && c.createdById === user.id;
  const pdf = `/api/letters/${c.id}/pdf`;

  const steps = [
    { label: "كتابة الكتاب", by: who(c.createdById), done: true },
    { label: "مراجعة المحاسب", by: c.accountantById ? who(c.accountantById) : null, done: !!c.accountantById || approved, current: state === "PENDING_ACCOUNTANT" },
    { label: "اعتماد المدير العام", by: c.approvedById ? who(c.approvedById) : null, done: approved, current: state === "PENDING_ADMIN" },
    { label: "الطباعة", by: approved ? "جاهز" : null, done: approved },
  ];

  return (
    <>
      <PageHeader
        back={{ href: "/correspondence", label: "الصادر والوارد" }}
        title={approved ? `الكتاب ${c.refNo}` : "كتاب رسمي (قيد الاعتماد)"}
        subtitle={<span className="flex flex-wrap items-center gap-2"><StatusBadge map={LETTER_STATUS} value={state} /> <span>إلى {c.party} — {c.subject}</span></span>}
        actions={
          <>
            {approved ? (
              <>
                <a href={pdf} target="_blank" rel="noopener" className="btn-primary"><Printer className="h-4 w-4" /> طباعة PDF</a>
                <a href={`${pdf}?download`} className="btn-secondary"><Download className="h-4 w-4" /> تنزيل</a>
              </>
            ) : (
              <a href={pdf} target="_blank" rel="noopener" className="btn-secondary"><Eye className="h-4 w-4" /> معاينة PDF (مسودة)</a>
            )}
            {canEdit && (
              <LetterEditForm
                id={c.id}
                resubmit={resubmit}
                tenders={tenders}
                incoming={incoming.map((i) => ({ id: i.id, refNo: i.refNo, party: i.party, subject: i.subject, theirRef: i.theirRef, tenderId: i.tenderId, date: fmtDate(i.date) }))}
                init={{ date: toInputDate(c.date), party: c.party, subject: c.subject, body: c.body ?? "", cc: c.cc ?? "", tenderId: c.tenderId ? String(c.tenderId) : "", replyToId: c.replyToId ? String(c.replyToId) : "", attachmentNames: c.letterAttachments ?? "" }}
              />
            )}
          </>
        }
      />

      <ol className="stagger mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {steps.map((s, i) => (
          <li key={s.label} className={clsx("flex items-center gap-3 rounded-2xl border px-3 py-3", s.current ? "border-accent bg-accent-soft" : s.done ? "border-good/30 bg-good-soft" : "border-line bg-white")}>
            <span className={clsx("grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-bold", s.done ? "bg-good text-white" : s.current ? "bg-accent text-white" : "bg-canvas text-ink-muted")}>
              {s.done ? <Check className="h-4 w-4" /> : i + 1}
            </span>
            <span className="min-w-0 leading-tight">
              <span className="block text-sm font-bold">{s.label}</span>
              <span className="block truncate text-xs text-ink-muted">{s.current ? "بانتظار القرار" : s.by ?? "—"}</span>
            </span>
          </li>
        ))}
      </ol>

      {state === "RETURNED" && c.reviewNote && (
        <p className="mb-4 rounded-2xl bg-bad-soft px-4 py-3 text-sm font-semibold text-bad" role="alert">
          أُعيد الكتاب للتعديل: {c.reviewNote}
          {resubmit && <span className="mt-1 block text-xs text-ink-soft">عدّل الكتاب من زر «تعديل وإعادة تقديم» ليعود لمسار الاعتماد.</span>}
        </p>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <Card pad={false} className="overflow-hidden">
          <iframe title="معاينة الكتاب" srcDoc={letterHtml({ ...letterDataOf(c), preview: true })} className="block aspect-[830/1190] max-h-[85vh] w-full border-0 bg-[#dfe4ec]" />
        </Card>
        <div className="space-y-5">
          {canReview && (
            <Card title={state === "PENDING_ADMIN" || user.role === "ADMIN" ? "قرار الاعتماد" : "مراجعة المحاسب"}>
              <LetterReview id={c.id} final={user.role === "ADMIN"} />
            </Card>
          )}
          <Card title="بيانات الكتاب">
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-3"><dt className="text-ink-muted">رقم الصادر</dt><dd className="num font-bold">{approved ? c.refNo : "يُعطى عند الاعتماد"}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-ink-muted">التاريخ</dt><dd className="num">{fmtDate(c.date)}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-ink-muted">المشروع</dt><dd>{c.tender ? <Link href={`/tenders/${c.tender.id}?tab=correspondence`} className="text-accent hover:underline">{c.tender.name}</Link> : "عام"}</dd></div>
              {c.replyTo && <div className="flex justify-between gap-3"><dt className="text-ink-muted">رداً على</dt><dd className="num">{c.replyTo.refNo}</dd></div>}
              <div className="flex justify-between gap-3"><dt className="text-ink-muted">أنشأه</dt><dd>{who(c.createdById)}</dd></div>
              {c.notes && <div><dt className="text-ink-muted">ملاحظات المراجعة</dt><dd>{c.notes}</dd></div>}
            </dl>
          </Card>
          <Card title="المعززات">
            {evidence.length ? <AttachmentList items={evidence} /> : <p className="text-sm text-ink-muted">لا توجد معززات</p>}
            {approved && <p className="mt-3 text-xs text-ink-muted">نسخة PDF المعتمدة تُحفظ في أرشيف الكتاب ({LETTER_PDF_LABEL}).</p>}
          </Card>
        </div>
      </div>
    </>
  );
}

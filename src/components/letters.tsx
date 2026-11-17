"use client";

import { useState } from "react";
import clsx from "clsx";
import { CheckCircle2, FilePenLine, Pencil, Undo2 } from "lucide-react";
import { ActionForm, FileInput, Grid, Input, ModalForm, Select, Textarea } from "./forms";
import { createOfficialLetter, reviewOfficialLetter, updateOfficialLetter } from "@/app/(app)/actions/letters";

export type IncomingRef = { id: number; refNo: string; party: string; subject: string; theirRef: string | null; tenderId: number | null; date: string };
export type LetterDefaults = { date: string; party: string; subject: string; body: string; cc: string; tenderId: string; replyToId: string; attachmentNames: string };

const COMPANY = "شركة صدى الجنوب للمقاولات الإنشائية";
const PARTIES = ["وزارة الأشغال العامة والإسكان", "وزارة التربية والتعليم", "وزارة الصحة", "دائرة العطاءات الحكومية", "الإشراف الهندسي"];

/** حقول الكتاب (مشتركة بين الإنشاء والتعديل) — الرد على وارد يعبّئ الجهة والموضوع والمشروع */
function LetterFields({ tenders, incoming, fixedTenderId, init, withFiles }: { tenders: { id: number; name: string }[]; incoming: IncomingRef[]; fixedTenderId?: number; init: LetterDefaults; withFiles?: boolean }) {
  const [replyId, setReplyId] = useState(init.replyToId);
  const [party, setParty] = useState(init.party);
  const [subject, setSubject] = useState(init.subject);
  const [tenderId, setTenderId] = useState(fixedTenderId ? String(fixedTenderId) : init.tenderId);
  const reply = incoming.find((i) => String(i.id) === replyId);

  const pickReply = (id: string) => {
    setReplyId(id);
    const r = incoming.find((i) => String(i.id) === id);
    if (!r) return;
    setParty(r.party);
    if (!subject.trim()) setSubject(`رد على: ${r.subject}`);
    if (!fixedTenderId && r.tenderId) setTenderId(String(r.tenderId));
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 rounded-xl bg-accent-soft px-3 py-2 text-xs font-semibold text-ink-soft">
        <span className="text-ink-muted">من:</span> <span className="font-bold text-ink">{COMPANY}</span>
        <span className="text-ink-muted">— تُكتب تلقائياً في توقيع الكتاب، ويُطبع على ورقة الشركة الرسمية PDF</span>
      </div>
      <Grid cols={2}>
        <Select
          name="replyToId"
          label="رد على كتاب وارد (اختياري)"
          options={incoming.map((i) => ({ value: i.id, label: `${i.refNo} — ${i.party}: ${i.subject}`.slice(0, 110) }))}
          placeholder="— كتاب جديد (ليس رداً) —"
          value={replyId}
          onChange={(e) => pickReply(e.currentTarget.value)}
        />
        <Input name="date" label="تاريخ الكتاب" type="date" required defaultValue={init.date} />
      </Grid>
      {reply && (
        <p className="rounded-xl bg-canvas px-3 py-2 text-xs font-semibold text-accent">
          رداً على الوارد {reply.refNo} بتاريخ {reply.date}{reply.theirRef ? ` (رقم كتابهم ${reply.theirRef})` : ""} — تُضاف فقرة الإشارة إليه تلقائياً.
        </p>
      )}
      <Input name="party" label="الجهة الموجه إليها الكتاب (السادة / …)" required list="letter-parties" value={party} onChange={(e) => setParty(e.currentTarget.value)} placeholder="وزارة الأشغال العامة والإسكان — مديرية أشغال الطفيلة" />
      <datalist id="letter-parties">
        {PARTIES.map((p) => <option key={p} value={p} />)}
      </datalist>
      <Input name="subject" label="الموضوع" required value={subject} onChange={(e) => setSubject(e.currentTarget.value)} />
      {fixedTenderId ? (
        <input type="hidden" name="tenderId" value={fixedTenderId} />
      ) : (
        <Select name="tenderId" label="ملف العطاء / المشروع" options={tenders.map((t) => ({ value: t.id, label: t.name }))} placeholder="— عام (غير مرتبط بعطاء) —" value={tenderId} onChange={(e) => setTenderId(e.currentTarget.value)} />
      )}
      <Textarea name="body" label="نص الكتاب (المشروحات)" required rows={9} defaultValue={init.body} placeholder={"نود إعلامكم بأن…\n(كل سطر فقرة مستقلة — «تحية طيبة وبعد» والخاتمة والتوقيع تُضاف تلقائياً)"} />
      <Grid cols={2}>
        <Textarea name="attachmentNames" label="المرفقات المذكورة في الكتاب (سطر لكل مرفق)" hint="إن تُرك فارغاً تُذكر أسماء ملفات المعززات" rows={3} defaultValue={init.attachmentNames} />
        <Textarea name="cc" label="نسخة إلى (سطر لكل جهة)" rows={3} defaultValue={init.cc} placeholder={"المهندس المشرف\nملف العطاء"} />
      </Grid>
      {withFiles && <FileInput label="المعززات (تُحفظ مع الكتاب وفي ملف العطاء)" />}
    </>
  );
}

const empty = (today: string, tenderId?: number): LetterDefaults => ({ date: today, party: "", subject: "", body: "", cc: "", tenderId: tenderId ? String(tenderId) : "", replyToId: "", attachmentNames: "" });

/** إنشاء كتاب رسمي صادر: يمر على المحاسب ثم المدير العام، وبعد الاعتماد يُعطى رقم الصادر ويُطبع PDF */
export function OfficialLetterForm({ tenders, incoming, fixedTenderId, today }: { tenders: { id: number; name: string }[]; incoming: IncomingRef[]; fixedTenderId?: number; today: string }) {
  return (
    <ModalForm title="إنشاء كتاب رسمي" trigger={<><FilePenLine className="h-4 w-4" /> إنشاء كتاب رسمي</>} action={createOfficialLetter} submitLabel="حفظ وإرسال للاعتماد" wide>
      <ol className="grid grid-cols-4 gap-1 text-center text-[11px] font-bold text-ink-muted">
        {["كتابة الكتاب", "المحاسب", "المدير العام", "طباعة PDF"].map((s, i) => (
          <li key={s} className={clsx("rounded-lg px-1 py-1.5", i === 0 ? "bg-accent text-white" : "bg-canvas")}>{i + 1}. {s}</li>
        ))}
      </ol>
      <LetterFields tenders={tenders} incoming={incoming} fixedTenderId={fixedTenderId} init={empty(today, fixedTenderId)} withFiles />
    </ModalForm>
  );
}

export function LetterEditForm({ id, tenders, incoming, init, resubmit }: { id: number; tenders: { id: number; name: string }[]; incoming: IncomingRef[]; init: LetterDefaults; resubmit?: boolean }) {
  return (
    <ModalForm
      title={resubmit ? "تعديل الكتاب وإعادة تقديمه" : "تعديل الكتاب"}
      trigger={<><Pencil className="h-4 w-4" /> {resubmit ? "تعديل وإعادة تقديم" : "تعديل النص"}</>}
      triggerClass={resubmit ? "btn-primary" : "btn-secondary"}
      action={updateOfficialLetter.bind(null, id)}
      submitLabel={resubmit ? "حفظ وإعادة التقديم" : "حفظ التعديلات"}
      wide
      draft={false}
    >
      <LetterFields tenders={tenders} incoming={incoming} init={init} withFiles />
    </ModalForm>
  );
}

/** قرار المراجع (المحاسب أو المدير العام) */
export function LetterReview({ id, final }: { id: number; final: boolean }) {
  const [decision, setDecision] = useState<"approve" | "return">("approve");
  return (
    <ActionForm action={reviewOfficialLetter.bind(null, id)} submitLabel={decision === "approve" ? (final ? "اعتماد وإعطاء رقم صادر" : "موافقة ورفع للمدير العام") : "إعادة للتعديل"} draft={false}>
      <input type="hidden" name="decision" value={decision} />
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="القرار">
        <button type="button" role="radio" aria-checked={decision === "approve"} onClick={() => setDecision("approve")} className={clsx("pressable flex items-center justify-center gap-2 rounded-2xl border-2 px-3 py-3 text-sm font-bold", decision === "approve" ? "border-good bg-good-soft text-good" : "border-line text-ink-muted")}>
          <CheckCircle2 className="h-5 w-5" /> {final ? "اعتماد الكتاب" : "موافقة"}
        </button>
        <button type="button" role="radio" aria-checked={decision === "return"} onClick={() => setDecision("return")} className={clsx("pressable flex items-center justify-center gap-2 rounded-2xl border-2 px-3 py-3 text-sm font-bold", decision === "return" ? "border-bad bg-bad-soft text-bad" : "border-line text-ink-muted")}>
          <Undo2 className="h-5 w-5" /> إعادة للتعديل
        </button>
      </div>
      <Textarea name="note" label={decision === "return" ? "سبب الإعادة والتعديل المطلوب" : "ملاحظة (اختياري)"} rows={3} required={decision === "return"} />
    </ActionForm>
  );
}

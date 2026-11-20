import Link from "next/link";
import { notFound } from "next/navigation";
import clsx from "clsx";
import { CheckCircle2, Crown, Flame, MinusCircle, ScanSearch, Undo2, XCircle, Zap } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { Badge, Card, KeyValue, Money, PageHeader, StatusBadge } from "@/components/ui";
import { ModalForm, Textarea } from "@/components/forms";
import { boardSeats, MOTION_KIND, MOTION_STATUS, tally, VOTE_LABEL } from "@/lib/board/motions";
import { DEFAULT_BOARD, SEATS } from "@/lib/board/seats";
import type { RoastResult } from "@/lib/board/roast";
import { fmtDate } from "@/lib/format";
import { auditMotion, castVote, chairFastTrack, withdrawMotion } from "../../actions/board";
import { RoastRoom } from "../roast-room";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const VOTE_TONE = { YES: "bg-good-soft text-good", NO: "bg-bad-soft text-bad", ABSTAIN: "bg-black/[0.05] text-ink-soft" } as const;

export default async function MotionPage({ params }: { params: { id: string } }) {
  const user = await requireUser((r) => r !== "PM");
  const id = Number(params.id);
  const m = await db.boardMotion.findUnique({ where: { id }, include: { votes: { orderBy: { createdAt: "asc" } } } });
  if (!m) notFound();
  const [seats, me, tl, people] = await Promise.all([
    boardSeats(),
    db.user.findUnique({ where: { id: user.id }, select: { boardSeat: true } }),
    tally(id),
    db.user.findMany({ where: { id: { in: [m.submittedById, m.auditorId ?? 0, m.decidedById ?? 0] } }, select: { id: true, name: true } }),
  ]);
  const nameOf = (uid?: number | null) => people.find((p) => p.id === uid)?.name ?? "—";
  const seat = me?.boardSeat;
  const open = m.status === "AUDIT" || m.status === "VOTING";
  const myVote = m.votes.find((v) => v.userId === user.id);
  const link = m.kind === "QUOTE" && m.refId ? { href: `/quotes/${m.refId}`, label: "فتح طلب التسعير" } : m.kind === "FUND" && m.refId ? { href: "/funds", label: "طلبات التمويل" } : null;

  return (
    <>
      <PageHeader
        back={{ href: "/board", label: "مجلس الإدارة" }}
        title={m.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span className="num font-black text-accent">{m.ref}</span>
            <Badge tone="purple">{MOTION_KIND[m.kind] ?? m.kind}</Badge>
            <StatusBadge map={MOTION_STATUS} value={m.status} />
            {m.decidedBy === "CHAIR_FAST" && <Badge tone="orange">قرار فوري من الرئيس</Badge>}
          </span>
        }
        actions={link && <Link href={link.href} className="btn-secondary">{link.label}</Link>}
      />

      <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
        <div className="space-y-5">
          <Card title="البند">
            <p className="whitespace-pre-line text-[15px] leading-8 text-ink">{m.details}</p>
            <div className="mt-4">
              <KeyValue
                cols={3}
                items={[
                  { label: "القيمة", value: m.amount != null ? <Money value={m.amount} strong /> : "—" },
                  { label: "قدّمه", value: nameOf(m.submittedById) },
                  { label: "التاريخ", value: fmtDate(m.createdAt) },
                ]}
              />
            </div>
          </Card>

          {(m.auditNote || m.status === "AUDIT") && (
            <Card title={<span className="flex items-center gap-2"><ScanSearch className="h-5 w-5 text-navy-3" /> تدقيق المحاسب</span>}>
              {m.auditNote ? (
                <>
                  <p className="whitespace-pre-line leading-7 text-ink">{m.auditNote}</p>
                  <p className="mt-2 text-xs text-ink-muted">{nameOf(m.auditorId)} · {m.auditedAt ? fmtDate(m.auditedAt) : ""}</p>
                </>
              ) : (
                <p className="text-sm text-ink-muted">لم يُدقق بعد.</p>
              )}
              {m.status === "AUDIT" && can.auditBoard(user.role) && (
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  <ModalForm title="تدقيق ورفع للمجلس" trigger={<><CheckCircle2 className="h-4 w-4" /> دُقق — ارفعه للمجلس</>} action={auditMotion.bind(null, id, "pass")}>
                    <Textarea name="note" label="خلاصة التدقيق (يقرؤها الأعضاء)" required rows={5} placeholder="المبالغ مطابقة للمستندات، الأثر على السيولة، ملاحظات…" />
                  </ModalForm>
                  <ModalForm title="إعادة لمقدّم البند" trigger={<><Undo2 className="h-4 w-4" /> إعادة بملاحظات</>} triggerClass="btn-secondary" action={auditMotion.bind(null, id, "return")}>
                    <Textarea name="note" label="ما المطلوب استكماله؟" required />
                  </ModalForm>
                </div>
              )}
            </Card>
          )}

          <Card title={<span className="flex items-center gap-2"><Flame className="h-5 w-5 text-accent" /> غرفة النقد</span>}>
            <RoastRoom seats={SEATS.map(({ hot: _h, ...s }) => s)} defaults={DEFAULT_BOARD} motionId={id} initial={(m.roast as unknown as RoastResult) ?? null} canRun={open && (user.role === "ADMIN" || user.role === "ACCOUNTANT")} />
          </Card>
        </div>

        <aside className="space-y-5">
          <Card title="التصويت">
            <div className="mb-4 grid grid-cols-3 gap-2 text-center">
              {[
                { l: "موافق", v: tl.yes, c: "text-good" },
                { l: "غير موافق", v: tl.no, c: "text-bad" },
                { l: "ممتنع", v: tl.abstain, c: "text-ink-soft" },
              ].map((x) => (
                <div key={x.l} className="rounded-2xl bg-canvas p-3">
                  <p className={clsx("num text-2xl font-black", x.c)}>{x.v}</p>
                  <p className="text-xs font-bold text-ink-muted">{x.l}</p>
                </div>
              ))}
            </div>
            <p className="mb-3 text-xs text-ink-muted">يُحسم البند عند {tl.need} أصوات متطابقة من {tl.seats} مقاعد.</p>
            <ul className="space-y-2">
              {seats.map((s) => {
                const v = m.votes.find((x) => x.userId === s.id);
                return (
                  <li key={s.id} className="flex items-start gap-2 rounded-2xl border border-line p-2.5">
                    {s.boardSeat === "CHAIR" ? <Crown className="mt-0.5 h-4 w-4 shrink-0 text-gold" /> : <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-navy-3" />}
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-bold text-ink">{s.name}</span>
                      {v?.note && <span className="block text-xs leading-5 text-ink-muted">{v.note}</span>}
                    </span>
                    <span className={clsx("rounded-full px-2 py-0.5 text-xs font-black", v ? VOTE_TONE[v.vote as keyof typeof VOTE_TONE] : "bg-black/[0.04] text-ink-faint")}>{v ? VOTE_LABEL[v.vote] : "لم يصوّت"}</span>
                  </li>
                );
              })}
            </ul>

            {m.status === "VOTING" && seat && (
              <div className="mt-4 space-y-2">
                <p className="text-sm font-bold text-navy">{myVote ? `صوتك الحالي: ${VOTE_LABEL[myVote.vote]} — يمكنك تغييره قبل الحسم` : "صوتك:"}</p>
                <div className="grid grid-cols-3 gap-2">
                  <ModalForm title="موافق" trigger={<><CheckCircle2 className="h-4 w-4" /> موافق</>} triggerClass="btn bg-good text-white" action={castVote.bind(null, id, "YES")} submitLabel="تأكيد الموافقة">
                    <Textarea name="note" label="ملاحظة (اختياري)" />
                  </ModalForm>
                  <ModalForm title="غير موافق" trigger={<><XCircle className="h-4 w-4" /> لا</>} triggerClass="btn bg-bad text-white" action={castVote.bind(null, id, "NO")} submitLabel="تأكيد الرفض">
                    <Textarea name="note" label="السبب (إلزامي — يراه الأعضاء)" required />
                  </ModalForm>
                  <ModalForm title="امتناع" trigger={<><MinusCircle className="h-4 w-4" /> امتناع</>} triggerClass="btn-secondary" action={castVote.bind(null, id, "ABSTAIN")} submitLabel="تأكيد الامتناع">
                    <Textarea name="note" label="ملاحظة (اختياري)" />
                  </ModalForm>
                </div>
              </div>
            )}
          </Card>

          {seat === "CHAIR" && open && (
            <Card className="border-2 border-gold/60 bg-gradient-to-b from-gold-soft to-white" title={<span className="flex items-center gap-2"><Zap className="h-5 w-5 text-accent" /> قرار فوري — رئيس المجلس</span>}>
              <p className="mb-3 text-sm leading-6 text-ink-soft">تستطيع البت دون انتظار المجلس. السبب إلزامي، ويُرسل تلقائياً كمراسلة داخلية لكل عضو، ويوثق في سجل الرقابة.</p>
              <div className="grid grid-cols-2 gap-2">
                <ModalForm title="اعتماد فوري دون المجلس" trigger={<><CheckCircle2 className="h-4 w-4" /> اعتماد فوري</>} action={chairFastTrack.bind(null, id, "APPROVED")} submitLabel="اعتمد وأرسل المذكرة">
                  <Textarea name="reason" label="لماذا الاستعجال؟ (يصل للأعضاء كما هو)" required minLength={15} rows={5} placeholder="مثال: العميل يشترط التوقيع اليوم قبل الساعة 3 وإلا يذهب للمنافس، والسعر ضمن هامشنا المعتاد." />
                </ModalForm>
                <ModalForm title="رفض فوري دون المجلس" trigger={<><XCircle className="h-4 w-4" /> رفض فوري</>} triggerClass="btn-danger" action={chairFastTrack.bind(null, id, "REJECTED")} submitLabel="ارفض وأرسل المذكرة">
                  <Textarea name="reason" label="السبب (يصل للأعضاء)" required minLength={15} rows={4} />
                </ModalForm>
              </div>
            </Card>
          )}

          {m.decidedAt && (
            <Card title="القرار">
              <p className={clsx("text-lg font-black", m.status === "APPROVED" ? "text-good" : "text-bad")}>{MOTION_STATUS[m.status]?.label}</p>
              <p className="text-sm text-ink-muted">{m.decidedBy === "CHAIR_FAST" ? `قرار فوري من ${nameOf(m.decidedById)}` : "بأغلبية أصوات المجلس"} · {fmtDate(m.decidedAt)}</p>
              {m.fastReason && <p className="mt-3 rounded-xl bg-canvas p-3 text-sm leading-7"><b>سبب الاستعجال: </b>{m.fastReason}</p>}
            </Card>
          )}

          {open && (m.submittedById === user.id || seat === "CHAIR") && (
            <ModalForm title="سحب البند" trigger={<>سحب البند</>} triggerClass="btn-ghost w-full" action={withdrawMotion.bind(null, id)} submitLabel="تأكيد السحب">
              <p className="text-sm">يُغلق البند دون قرار. يمكن رفعه من جديد لاحقاً.</p>
            </ModalForm>
          )}
        </aside>
      </div>
    </>
  );
}

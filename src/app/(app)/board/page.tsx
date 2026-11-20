import Link from "next/link";
import clsx from "clsx";
import { Crown, Flame, Gavel, Landmark, Plus, ScanSearch, Users } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { Badge, Card, EmptyState, Money, PageHeader, StatusBadge, Tabs } from "@/components/ui";
import { Input, ModalForm, Select, Textarea } from "@/components/forms";
import { boardSeats, MOTION_KIND, MOTION_STATUS } from "@/lib/board/motions";
import { DEFAULT_BOARD, SEATS } from "@/lib/board/seats";
import { fmtDate } from "@/lib/format";
import { submitMotion } from "../actions/board";
import { RoastRoom } from "./roast-room";
import { Avatar } from "@/components/profile-card";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const TABS = [
  { key: "vote", label: "للتصويت" },
  { key: "audit", label: "بانتظار التدقيق" },
  { key: "decided", label: "القرارات" },
  { key: "roast", label: "غرفة النقد" },
];

export default async function BoardPage({ searchParams }: { searchParams: { tab?: string } }) {
  const user = await requireUser((r) => r !== "PM");
  const tab = TABS.some((x) => x.key === searchParams.tab) ? searchParams.tab! : "vote";
  const [seats, me, counts, motions, funds] = await Promise.all([
    boardSeats(),
    db.user.findUnique({ where: { id: user.id }, select: { boardSeat: true } }),
    db.boardMotion.groupBy({ by: ["status"], _count: true }),
    tab === "roast"
      ? Promise.resolve([])
      : db.boardMotion.findMany({
          where: tab === "vote" ? { status: "VOTING" } : tab === "audit" ? { status: { in: ["AUDIT", "RETURNED"] } } : { status: { in: ["APPROVED", "REJECTED", "WITHDRAWN"] } },
          include: { votes: { select: { userId: true, vote: true } } },
          orderBy: { createdAt: "desc" },
          take: 100,
        }),
    db.fundRequest.findMany({ where: { status: "PENDING" }, select: { id: true, amount: true, reason: true }, orderBy: { id: "desc" }, take: 30 }),
  ]);
  const count = (s: string[]) => counts.filter((c) => s.includes(c.status)).reduce((a, c) => a + c._count, 0);
  const seat = me?.boardSeat;
  const canSubmit = user.role !== "CHAIRMAN" && user.role !== "AUDITOR";
  const need = Math.floor(seats.length / 2) + 1;

  return (
    <>
      <PageHeader
        title="مجلس الإدارة"
        subtitle={<>البنود تُدقق من المحاسب ثم تُرفع للمجلس — تُحسم بأغلبية {need} من {seats.length} مقاعد</>}
        actions={
          canSubmit && (
            <ModalForm title="رفع بند لمجلس الإدارة" trigger={<><Plus className="h-4 w-4" /> بند جديد</>} action={submitMotion} wide>
              <div className="grid gap-4 sm:grid-cols-2">
                <Select name="kind" label="نوع البند" required options={Object.entries(MOTION_KIND).filter(([k]) => k !== "QUOTE" && k !== "PAYROLL").map(([value, label]) => ({ value, label }))} />
                <Input name="amount" label="القيمة (د.أ) — إن وُجدت" inputMode="decimal" />
              </div>
              <Input name="title" label="عنوان البند" required placeholder="مثال: شراء حفارة مستعملة لمشروع الطفيلة" />
              <Textarea name="details" label="التفاصيل والمبررات" required rows={5} placeholder="ما المطلوب؟ لماذا الآن؟ البدائل؟ أثره على السيولة؟" />
              {funds.length > 0 && (
                <Select name="refId" label="ربط بطلب تمويل معلّق (لنوع «طلب تمويل» فقط — يُنفَّذ تلقائياً بعد الاعتماد)" options={[{ value: "", label: "— بلا ربط —" }, ...funds.map((f) => ({ value: String(f.id), label: `#${f.id} · ${f.amount.toLocaleString("en-US")} د.أ · ${f.reason.slice(0, 50)}` }))]} />
              )}
            </ModalForm>
          )
        }
      />

      {/* المقاعد */}
      <section className="mb-6 grid gap-3 sm:grid-cols-3">
        {seats.map((s) => (
          <div key={s.id} className={clsx("card flex items-start gap-3 p-4", s.boardSeat === "CHAIR" && "ring-2 ring-gold/70")}>
            <span className="relative shrink-0">
              <Avatar name={s.name} avatarId={s.avatarId} size={52} ring />
              {s.boardSeat === "CHAIR" && <Crown className="absolute -end-1.5 -top-2 h-5 w-5 rotate-12 text-gold drop-shadow" />}
            </span>
            <span className="min-w-0 flex-1 leading-tight">
              <span className="flex items-center gap-2"><span className="truncate font-extrabold text-ink">{s.name}</span>{s.id === user.id && <Badge tone="orange">أنت</Badge>}</span>
              <span className="block text-xs font-semibold text-accent">{s.boardSeat === "CHAIR" ? "رئيس مجلس الإدارة" : "عضو مجلس الإدارة"}</span>
              {s.bio && <span className="mt-1 line-clamp-2 block text-[12px] leading-5 text-ink-muted">{s.bio}</span>}
            </span>
          </div>
        ))}
        {seats.length === 0 && <p className="text-sm text-ink-muted">لا يوجد أعضاء — حدّد المقاعد من صفحة المستخدمين.</p>}
      </section>

      <Tabs
        base="/board"
        active={tab}
        tabs={TABS.map((x) => ({ ...x, count: x.key === "vote" ? count(["VOTING"]) : x.key === "audit" ? count(["AUDIT"]) : undefined }))}
      />

      {tab === "roast" ? (
        <Card title={<span className="flex items-center gap-2"><Flame className="h-5 w-5 text-accent" /> غرفة النقد — اعرض أي قرار على 7 مستشارين قبل أن تقرر</span>}>
          <RoastRoom seats={SEATS.map(({ hot: _h, ...s }) => s)} defaults={DEFAULT_BOARD} motionId={null} canRun={user.role === "ADMIN" || user.role === "ACCOUNTANT"} />
        </Card>
      ) : motions.length === 0 ? (
        <EmptyState icon={tab === "audit" ? ScanSearch : tab === "vote" ? Gavel : Landmark} title={tab === "vote" ? "لا توجد بنود مفتوحة للتصويت" : tab === "audit" ? "لا شيء بانتظار التدقيق" : "لا توجد قرارات بعد"} hint="البنود تُرفع من هنا أو تلقائياً بعد تدقيق المحاسب لعروض الأسعار." />
      ) : (
        <ul className="stagger grid gap-3 lg:grid-cols-2">
          {motions.map((m) => {
            const yes = m.votes.filter((v) => v.vote === "YES").length;
            const no = m.votes.filter((v) => v.vote === "NO").length;
            const mine = m.votes.find((v) => v.userId === user.id);
            return (
              <li key={m.id}>
                <Link href={`/board/${m.id}`} className="card card-pad pressable hover-lift block">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className="num text-xs font-black text-accent">{m.ref}</span>
                    <Badge tone="purple">{MOTION_KIND[m.kind] ?? m.kind}</Badge>
                    <StatusBadge map={MOTION_STATUS} value={m.status} />
                    {m.decidedBy === "CHAIR_FAST" && <Badge tone="orange">قرار فوري من الرئيس</Badge>}
                    {m.roast && <Badge tone="red"><Flame className="me-1 inline h-3 w-3" />نُقد</Badge>}
                  </div>
                  <p className="text-[16px] font-extrabold leading-7 text-ink">{m.title}</p>
                  <p className="mt-1 line-clamp-2 text-sm leading-6 text-ink-muted">{m.details}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
                    {m.amount != null && <Money value={m.amount} strong />}
                    {m.status === "VOTING" && (
                      <span className="flex items-center gap-1.5 font-bold text-ink-soft"><Users className="h-4 w-4" /> <span className="num text-good">{yes}✓</span> <span className="num text-bad">{no}✗</span> من {seats.length}</span>
                    )}
                    {m.status === "VOTING" && seat && !mine && <span className="dot-live relative ms-auto rounded-full bg-accent px-2.5 py-0.5 text-xs font-black text-white">صوتك مطلوب</span>}
                    <span className="ms-auto text-xs text-ink-faint">{fmtDate(m.createdAt)}</span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

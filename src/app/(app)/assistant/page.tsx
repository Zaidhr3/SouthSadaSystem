import Link from "next/link";
import clsx from "clsx";
import { Bot, BookOpen, Bug, CheckCircle2, Github, MessageSquarePlus, Sparkles, Stethoscope, Trash2, Wrench } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { assistantEngine, type ToolLog } from "@/lib/assistant/agent";
import { Badge, Card, PageHeader } from "@/components/ui";
import { ActionForm, ConfirmButton, Input, Select, Textarea } from "@/components/forms";
import { Markdown } from "@/components/markdown";
import { approveAllAssistantActions, approveAssistantAction, askAssistant, deleteSkill, deleteThread, fullCheckup, importSkillAction, rejectAssistantAction, setIssueStatus, toggleSkill } from "../actions/assistant";

export const metadata = { title: "المساعد الذكي" };
/** الوكيل قد يستخدم عدة أدوات متتالية */
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const TOOL_LABEL: Record<string, string> = {
  db_schema: "قرأ بنية البيانات",
  status_labels: "قرأ معاني الحالات",
  sql_query: "استعلم من قاعدة البيانات",
  system_alerts: "راجع التنبيهات",
  finance_snapshot: "راجع المالية",
  integrity_check: "فحص سلامة البيانات",
  social_accounts: "راجع حسابات التواصل",
  recent_activity: "راجع سجل النشاط",
  list_issues: "راجع سجل المشاكل",
  log_issue: "سجّل مشكلة",
  site_weather: "راجع طقس المواقع",
  exchange_rates: "راجع أسعار الصرف",
  web_research: "بحث في الويب (Perplexity)",
  read_website: "قرأ موقعاً (Firecrawl)",
  web_search: "بحث روابط (Firecrawl)",
};
const SEV: Record<string, { label: string; tone: "red" | "orange" | "blue" | "gray" }> = {
  CRITICAL: { label: "حرجة", tone: "red" },
  HIGH: { label: "عالية", tone: "orange" },
  MEDIUM: { label: "متوسطة", tone: "blue" },
  LOW: { label: "منخفضة", tone: "gray" },
};
const SUGGESTIONS = ["شو أهم إشي لازم أنتبهله هالأسبوع؟", "حلّل ربحية كل مشروع ومين الأضعف ولیش", "وين واقفة طلبات التسعير ومين متأخر فيها؟", "شو وضع حساباتنا على فيس وإنستا وشو بتنصحني أعمل؟", "اعمللي توقع للسيولة لآخر الشهر", "في أي تناقض أو خطأ بالبيانات؟"];

export default async function AssistantPage({ searchParams }: { searchParams: { t?: string; tab?: string } }) {
  const user = await requireUser((r: Role) => r === "ADMIN" || r === "CHAIRMAN");
  const admin = user.role === "ADMIN";
  const tab = searchParams.tab === "issues" ? "issues" : searchParams.tab === "skills" ? "skills" : "chat";
  const threadId = Number(searchParams.t) || null;
  const [threads, thread, issues, skills, openCount] = await Promise.all([
    db.assistantThread.findMany({ where: { userId: user.id }, orderBy: { updatedAt: "desc" }, take: 30 }),
    threadId ? db.assistantThread.findFirst({ where: { id: threadId, userId: user.id }, include: { messages: { orderBy: { id: "asc" } } } }) : null,
    tab === "issues" ? db.systemIssue.findMany({ orderBy: [{ status: "asc" }, { id: "desc" }], take: 100 }) : [],
    tab === "skills" ? db.aiSkill.findMany({ orderBy: { name: "asc" } }) : [],
    db.systemIssue.count({ where: { status: "OPEN" } }),
  ]);
  const actions = thread ? await db.assistantAction.findMany({ where: { threadId: thread.id }, orderBy: { id: "asc" } }) : [];
  const pendingCount = actions.filter((a) => a.status === "PROPOSED").length;
  const engine = assistantEngine();
  return (
    <>
      <PageHeader
        title="المساعد الذكي"
        subtitle={<>يفهم النظام من الألف إلى الياء: يقرأ البيانات الحية، يحلل، يكتشف المشاكل ويسجلها، ويقترح الحل. {engine ? <Badge tone="purple">{engine}</Badge> : <Badge tone="red">الذكاء الاصطناعي غير مُعد</Badge>}</>}
        actions={
          <ActionForm action={fullCheckup} submitLabel="فحص شامل للنظام">
            <span />
          </ActionForm>
        }
      />
      <nav className="mb-4 flex gap-1 rounded-2xl bg-black/[0.04] p-1">
        {[["chat", "المحادثة", Sparkles], ["issues", `سجل المشاكل${openCount ? ` (${openCount})` : ""}`, Bug], ["skills", "المهارات", BookOpen]].map(([k, label, Icon]) => {
          const I = Icon as typeof Bug;
          return (
            <Link key={k as string} href={`/assistant?tab=${k}`} className={clsx("flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-bold transition", tab === k ? "bg-white text-accent shadow-card" : "text-ink-muted hover:text-ink")}>
              <I className="h-4 w-4" /> {label as string}
            </Link>
          );
        })}
      </nav>

      {tab === "chat" && (
        <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
          <Card title="المحادثات" className="h-fit">
            <Link href="/assistant" className="btn-secondary btn-sm mb-2 w-full justify-center"><MessageSquarePlus className="h-4 w-4" /> محادثة جديدة</Link>
            <ul className="max-h-[60vh] space-y-1 overflow-y-auto">
              {threads.map((th) => (
                <li key={th.id} className="group flex items-center gap-1">
                  <Link href={`/assistant?t=${th.id}`} className={clsx("min-w-0 flex-1 truncate rounded-lg px-2 py-1.5 text-sm", th.id === threadId ? "bg-accent-soft font-bold text-accent" : "hover:bg-black/[0.04]")}>{th.title}</Link>
                  <ConfirmButton action={deleteThread.bind(null, th.id)} confirm="حذف المحادثة؟" className="rounded-lg p-1 text-ink-faint opacity-0 hover:text-bad group-hover:opacity-100" title="حذف"><Trash2 className="h-3.5 w-3.5" /></ConfirmButton>
                </li>
              ))}
              {!threads.length && <li className="px-2 py-3 text-xs text-ink-muted">لا محادثات بعد</li>}
            </ul>
          </Card>
          <div className="space-y-4">
            {!thread && (
              <Card>
                <div className="py-4 text-center">
                  <span className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-navy to-navy-3 text-gold shadow-card"><Bot className="h-8 w-8" /></span>
                  <p className="text-lg font-black text-navy">أهلاً {user.name.split(" ")[0]} — اسألني أي إشي عن الشركة</p>
                  <p className="mt-1 text-sm text-ink-muted">بقرأ الأرقام الحقيقية من النظام، وما بخمّن.</p>
                </div>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {SUGGESTIONS.map((s) => (
                    <ActionForm key={s} action={askAssistant.bind(null, null)} submitLabel={s} className="[&_button]:w-full [&_button]:justify-start [&_button]:whitespace-normal [&_button]:text-start">
                      <input type="hidden" name="message" value={s} />
                    </ActionForm>
                  ))}
                </div>
              </Card>
            )}
            {thread?.messages.map((m) => (
              <div key={m.id} className={clsx("flex", m.role === "user" ? "justify-start" : "justify-end")}>
                <div className={clsx("max-w-[92%] rounded-2xl px-4 py-3 text-sm shadow-card", m.role === "user" ? "bg-navy text-white" : "border border-line bg-white")}>
                  {m.role === "user" ? (
                    <p className="whitespace-pre-wrap leading-7">{m.text}</p>
                  ) : (
                    <>
                      {Array.isArray(m.tools) && (m.tools as ToolLog[]).length > 0 && (
                        <details className="mb-2 text-xs text-ink-muted">
                          <summary className="flex cursor-pointer items-center gap-1"><Wrench className="h-3.5 w-3.5" /> استخدم {(m.tools as ToolLog[]).length} أداة</summary>
                          <ul className="mt-1 space-y-0.5 ps-5">
                            {(m.tools as ToolLog[]).map((t, i) => (
                              <li key={i} className={t.ok ? "" : "text-bad"}>{TOOL_LABEL[t.name] ?? t.name} <span className="text-ink-faint">({t.ms}ms)</span>{t.args?.sql ? <code dir="ltr" className="mt-0.5 block truncate font-mono text-[10px] text-ink-faint">{String(t.args.sql)}</code> : null}</li>
                            ))}
                          </ul>
                        </details>
                      )}
                      <Markdown text={m.text} />
                      {actions.filter((a) => a.messageId === m.id).length > 0 && (
                        <ul className="mt-3 space-y-2 border-t border-line pt-3">
                          {actions.filter((a) => a.messageId === m.id).map((a) => (
                            <li key={a.id} className={clsx("rounded-xl border p-2.5", a.status === "PROPOSED" ? "border-accent/40 bg-accent-soft/40" : a.status === "EXECUTED" ? "border-good/30 bg-good-soft/50" : "border-line bg-black/[0.03]")}>
                              <p className="text-[13px] font-semibold leading-6">
                                <span className="me-1">{a.status === "PROPOSED" ? "⏳" : a.status === "EXECUTED" ? "✅" : a.status === "REJECTED" ? "✖" : a.status === "EXECUTING" ? "⚙️" : "⚠️"}</span>
                                {a.summary}
                              </p>
                              {a.result && a.status !== "PROPOSED" && <p className="mt-0.5 text-xs text-ink-muted">{a.result}</p>}
                              {a.status === "PROPOSED" && admin && (
                                <div className="mt-2 flex gap-2">
                                  <ConfirmButton action={approveAssistantAction.bind(null, a.id)} confirm={`تنفيذ: ${a.summary}؟`} className="btn-primary btn-sm">نفّذ</ConfirmButton>
                                  <ConfirmButton action={rejectAssistantAction.bind(null, a.id)} confirm="إلغاء هذا الإجراء؟" className="btn-ghost btn-sm">لا</ConfirmButton>
                                </div>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </>
                  )}
                </div>
              </div>
            ))}
            {thread && pendingCount > 1 && admin && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border-2 border-accent/40 bg-accent-soft/50 px-4 py-3">
                <p className="text-sm font-bold text-accent">{pendingCount} إجراءات مقترحة بانتظار موافقتك</p>
                <ConfirmButton action={approveAllAssistantActions.bind(null, thread.id)} confirm={`تنفيذ كل الإجراءات (${pendingCount}) بالترتيب؟`} className="btn-primary btn-sm">نفّذ الكل</ConfirmButton>
              </div>
            )}
            <Card>
              <ActionForm action={askAssistant.bind(null, thread?.id ?? null)} submitLabel="إرسال" resetOnSuccess>
                <Textarea name="message" label={thread ? "تابع المحادثة" : "سؤالك"} rows={3} required placeholder="مثال: ليش المطالبة رقم 2 متأخرة؟ وشو لازم أعمل؟" />
              </ActionForm>
              <p className="mt-2 text-xs text-ink-faint">المساعد يفهم المهمة ويقترح الخطة، ولا ينفّذ شيئاً إلا بعد ضغطك «نفّذ» — وبصلاحياتك. المالية (البنك، الشيكات، القروض، المصاريف، التمويل، الضريبة، الفوترة، المطالبات، الكفالات) والمستخدمون والأسرار والحذف: يدوي فقط.</p>
            </Card>
          </div>
        </div>
      )}

      {tab === "issues" && (
        <Card title={<span className="flex items-center gap-2"><Stethoscope className="h-5 w-5 text-accent" /> سجل مشاكل النظام</span>}>
          {!issues.length ? (
            <p className="py-8 text-center text-sm text-ink-muted"><CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-good" />لا مشاكل مسجلة — اضغط «فحص شامل للنظام»</p>
          ) : (
            <ul className="space-y-3">
              {issues.map((i) => (
                <li key={i.id} className={clsx("rounded-2xl border p-4", i.status === "OPEN" ? "border-line bg-white" : "border-transparent bg-black/[0.03] opacity-70")}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-ink-faint">#{i.id}</span>
                    <Badge tone={SEV[i.severity]?.tone ?? "gray"}>{SEV[i.severity]?.label ?? i.severity}</Badge>
                    {i.area && <Badge tone="gray">{i.area}</Badge>}
                    <b className="text-navy">{i.title}</b>
                    {i.status !== "OPEN" && <Badge tone="green">{i.status === "RESOLVED" ? "محلولة" : "مُستبعدة"}</Badge>}
                  </div>
                  <div className="mt-2 text-sm text-ink-soft"><Markdown text={i.detail} /></div>
                  {i.suggestion && <div className="mt-2 rounded-xl bg-good-soft/60 p-3 text-sm"><b className="text-good">الحل المقترح: </b><Markdown text={i.suggestion} /></div>}
                  {admin && (
                    <div className="mt-3 flex gap-2">
                      {i.status === "OPEN" ? (
                        <>
                          <ConfirmButton action={setIssueStatus.bind(null, i.id, "RESOLVED")} confirm="تأكيد حل المشكلة؟" className="btn-secondary btn-sm">تم الحل</ConfirmButton>
                          <ConfirmButton action={setIssueStatus.bind(null, i.id, "DISMISSED")} confirm="استبعاد (ليست مشكلة)؟" className="btn-ghost btn-sm">ليست مشكلة</ConfirmButton>
                        </>
                      ) : (
                        <ConfirmButton action={setIssueStatus.bind(null, i.id, "OPEN")} confirm="إعادة فتح؟" className="btn-ghost btn-sm">إعادة فتح</ConfirmButton>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {tab === "skills" && (
        <div className="grid gap-5 lg:grid-cols-3">
          {admin && (
            <Card title={<span className="flex items-center gap-2"><Github className="h-5 w-5" /> استيراد من GitHub</span>} className="h-fit">
              <ActionForm action={importSkillAction} submitLabel="استيراد">
                <Input name="url" label="رابط GitHub" dir="ltr" required placeholder="https://github.com/owner/repo  أو  …/blob/main/x/SKILL.md" />
                <Select name="scope" label="يستخدمها" options={[{ value: "both", label: "المساعد والتسويق" }, { value: "assistant", label: "المساعد فقط" }, { value: "marketing", label: "التسويق فقط" }]} defaultValue="both" />
              </ActionForm>
              <p className="mt-3 text-xs leading-6 text-ink-muted">رابط مستودع أو مجلد يجمع كل ملفات SKILL.md داخله (حتى 25)، أو رابط ملف واحد. المهارة تعليمات تُضاف لعقل المساعد/كاتب التسويق. استورد من مصادر تثق بها فقط.</p>
            </Card>
          )}
          <Card title={`المهارات (${skills.length})`} className={admin ? "lg:col-span-2" : "lg:col-span-3"}>
            {!skills.length ? (
              <p className="py-6 text-center text-sm text-ink-muted">لا مهارات مستوردة بعد</p>
            ) : (
              <ul className="divide-y divide-line">
                {skills.map((s) => (
                  <li key={s.id} className="flex items-start gap-3 py-3">
                    <BookOpen className={clsx("mt-0.5 h-5 w-5 shrink-0", s.enabled ? "text-accent" : "text-ink-faint")} />
                    <div className="min-w-0 flex-1">
                      <p className="font-bold">{s.name} <Badge tone="gray">{s.scope === "both" ? "الكل" : s.scope === "assistant" ? "المساعد" : "التسويق"}</Badge>{!s.enabled && <Badge tone="orange" className="ms-1">موقوفة</Badge>}</p>
                      <p className="text-xs leading-5 text-ink-muted">{s.description}</p>
                      {s.sourceUrl && <a href={s.sourceUrl} target="_blank" rel="noreferrer" dir="ltr" className="block truncate text-[11px] text-ink-faint underline">{s.sourceUrl}</a>}
                    </div>
                    {admin && (
                      <div className="flex shrink-0 gap-1">
                        <ConfirmButton action={toggleSkill.bind(null, s.id)} confirm={s.enabled ? "إيقاف المهارة؟" : "تفعيل المهارة؟"} className="btn-ghost btn-sm">{s.enabled ? "إيقاف" : "تفعيل"}</ConfirmButton>
                        <ConfirmButton action={deleteSkill.bind(null, s.id)} confirm="حذف المهارة؟" className="btn-danger btn-sm"><Trash2 className="h-4 w-4" /></ConfirmButton>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </>
  );
}

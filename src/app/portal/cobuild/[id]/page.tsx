import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import clsx from "clsx";
import { BadgeCheck, Bell, CalendarClock, Camera, ChevronRight, Circle, Gift, Hammer, HandHeart, ListTodo, Plane, Users } from "lucide-react";
import { db } from "@/lib/db";
import { requireClient } from "@/lib/client-session";
import { fmtDate } from "@/lib/format";
import { ProgressBar, StatusBadge } from "@/components/ui";
import { ACTIVE_BUYER, BUYER_STATUS, CREDIT_KIND, CREDIT_STATUS, LAUNCHED, PRE_LAUNCH, PROJECT_STATUS, TASK_KIND, buyerMonth, r3 } from "@/lib/cobuild-core";
import { catalogLite, committedWhere } from "@/lib/cobuild";
import { PortalForm } from "../../portal-form";
import { setNeighbor, setRemote, signTask } from "../../cobuild-actions";
import { Configurator } from "./configurator";

export const metadata = { title: "شقتي — من العظم إلى المفتاح" };

export default async function BuyerPortalPage({ params }: { params: { id: string } }) {
  const c = await requireClient();
  if (c.mustChangePassword) redirect("/portal/password");
  const id = Number(params.id);
  if (!Number.isInteger(id)) notFound();
  const b = await db.coBuildBuyer.findFirst({
    where: { id, clientId: c.id },
    include: {
      unit: true,
      project: { include: { milestones: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }, updates: { orderBy: { createdAt: "desc" }, take: 20 } } },
      selections: true,
      credits: { orderBy: { id: "asc" } },
    },
  });
  if (!b) redirect("/portal");
  const p = b.project;
  const active = ACTIVE_BUYER.includes(b.status);
  const [committed, items, tasks, notices, neighbors, files] = await Promise.all([
    db.coBuildBuyer.count({ where: committedWhere(p.id) }),
    catalogLite(),
    db.coBuildTask.findMany({ where: { projectId: p.id, OR: [{ buyerId: b.id }, { buyerId: null }] }, orderBy: [{ status: "asc" }, { dueDate: "asc" }] }),
    db.coBuildNotice.findMany({ where: { projectId: p.id, OR: [{ buyerId: b.id }, { buyerId: null }], createdAt: { gte: b.joinedAt } }, orderBy: { createdAt: "desc" }, take: 25 }),
    p.neighborIntro ? db.coBuildBuyer.findMany({ where: { projectId: p.id, neighborOptIn: true, status: { in: ACTIVE_BUYER }, id: { not: b.id } }, select: { id: true, name: true, neighborBio: true, unit: { select: { floor: true } } } }) : Promise.resolve([]),
    db.attachment.findMany({ where: { entityType: "cobuild_update", entityId: { in: p.updates.map((u) => u.id) } }, select: { id: true, entityId: true, fileName: true } }),
  ]);
  const lastSeen = c.noticeSeenAt;
  await db.client.update({ where: { id: c.id }, data: { noticeSeenAt: new Date() } });

  const credits = r3(b.credits.filter((x) => x.status !== "FORFEITED").reduce((s, x) => s + x.amount, 0));
  const pre = PRE_LAUNCH.includes(p.status);
  const launched = LAUNCHED.includes(p.status);
  const month = buyerMonth(b.joinedAt, p.launchedAt ?? new Date());
  // البند العام يُعد منجزاً لي إن وقّعتُ نسختي الخاصة منه
  const mySigned = new Set(tasks.filter((t) => t.buyerId === b.id && t.signedAt).map((t) => t.title));
  const openTasks = tasks.filter((t) => t.status === "OPEN" && !(t.buyerId === null && mySigned.has(t.title)));
  const history = tasks.filter((t) => t.buyerId === b.id && t.status === "DONE");
  const next = p.milestones.filter((m) => !m.doneAt).slice(0, 3);
  const isImg = (n: string) => /\.(jpe?g|png|webp)$/i.test(n);
  const isVid = (n: string) => /\.(mp4|mov)$/i.test(n);

  return (
    <>
      <Link href="/portal" className="mb-2 inline-flex items-center gap-0.5 text-sm font-bold text-accent"><ChevronRight className="h-4 w-4" /> مشاريعي</Link>
      <section className="mb-6 overflow-hidden rounded-[28px] text-white shadow-pop" style={{ background: "linear-gradient(120deg,#0b2545 0%,#13315c 55%,#1d4a7d 100%)" }}>
        <div className="p-5 sm:p-7">
          <p className="text-xs font-black text-gold">ابنِ شقتك بشفافية — من العظم إلى المفتاح</p>
          <h1 className="mt-1 text-2xl font-black sm:text-3xl">{p.name}</h1>
          <p className="mt-1 text-sm text-white/70">الشقة {b.unit.unitCode} — {b.unit.floor} — {b.unit.areaSqm} م²{b.unit.facadeView ? ` — ${b.unit.facadeView}` : ""} · {p.location}</p>
          <div className="mt-3 flex flex-wrap gap-2"><StatusBadge map={PROJECT_STATUS} value={p.status} /><StatusBadge map={BUYER_STATUS} value={b.status} />{b.earlyBird && <span className="rounded-full bg-gold px-2.5 py-0.5 text-xs font-black text-navy">من الأوائل</span>}{b.groupCloser && <span className="rounded-full bg-gold px-2.5 py-0.5 text-xs font-black text-navy">مكمّل المجموعة</span>}</div>
          <div className="mt-5 grid gap-4 sm:grid-cols-3">
            <div className="rounded-2xl bg-white/10 p-4">
              <p className="text-xs font-bold text-white/70">جاهزية المجموعة</p>
              <p className="num mt-1 text-3xl font-black">{committed} <span className="text-lg text-white/60">/ {p.launchThreshold}</span></p>
              <div className="mt-2 flex gap-1">{Array.from({ length: p.launchThreshold }, (_, i) => <span key={i} className={clsx("h-2 flex-1 rounded-full", i < committed ? "bg-gold" : "bg-white/15")} />)}</div>
              <p className="mt-2 text-xs text-white/70">{launched ? `تم! انطلق في ${fmtDate(p.launchedAt)}` : p.status === "ready_to_launch" ? "اكتمل النصاب — بانتظار إعلان «تم»" : p.status === "cancelled_reset" ? "أُلغي المشروع وأُعيدت الشيكات" : `باقي ${Math.max(0, p.launchThreshold - committed)} للانطلاق`}</p>
            </div>
            <div className="rounded-2xl bg-white/10 p-4">
              <p className="text-xs font-bold text-white/70">حوافزك</p>
              <p className="num mt-1 text-3xl font-black text-gold">{credits.toLocaleString("en-US")} <span className="text-base text-white/60">د.أ</span></p>
              <p className="mt-2 text-xs text-white/70">{pre ? `أنت في الشهر ${month} — من الشهر ${p.waitStartMonth} يُضاف ${p.waitPerMonth} د.أ شهرياً (حتى ${p.waitPerMonth * p.waitMaxMonths})` : "طُبّقت على رصيد عقدك"}</p>
            </div>
            <div className="rounded-2xl bg-white/10 p-4">
              <p className="text-xs font-bold text-white/70">وين وصل المشروع</p>
              <p className="num mt-1 text-3xl font-black">{launched ? `${p.progress}%` : "—"}</p>
              <p className="mt-2 text-xs text-white/70">{launched ? p.phaseLabel ?? "" : "يبدأ التنفيذ بعد «تم»"}</p>
            </div>
          </div>
        </div>
      </section>

      {notices.length > 0 && (
        <details className="card mb-6" open={notices.some((n) => !lastSeen || n.createdAt > lastSeen)}>
          <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-4 font-black text-navy"><Bell className="h-5 w-5 text-accent" /> الإشعارات {notices.filter((n) => !lastSeen || n.createdAt > lastSeen).length ? <span className="rounded-full bg-accent px-2 text-xs text-white">{notices.filter((n) => !lastSeen || n.createdAt > lastSeen).length} جديد</span> : null}</summary>
          <ul className="divide-y divide-black/5 border-t border-black/5">
            {notices.map((n) => (
              <li key={n.id} className={clsx("px-5 py-3", (!lastSeen || n.createdAt > lastSeen) && "bg-gold/[0.08]")}>
                <p className="font-bold">{n.title}</p>
                <p className="text-sm text-ink-soft">{n.body}</p>
                <p className="text-xs text-ink-muted">{fmtDate(n.createdAt)}</p>
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="mb-6 grid gap-5 lg:grid-cols-2">
        <div className="card card-pad">
          <h2 className="mb-3 flex items-center gap-2 text-lg font-black text-navy"><ListTodo className="h-5 w-5 text-accent" /> شو عندك</h2>
          {openTasks.length === 0 ? <p className="text-sm text-ink-muted">ما عندك شي معلّق حالياً.</p> : (
            <ul className="space-y-3">
              {openTasks.map((t) => (
                <li key={t.id} className="rounded-2xl bg-black/[0.03] p-3">
                  <p className="flex items-center gap-2 font-bold"><Circle className="h-4 w-4 text-warn" /> {t.title}</p>
                  <p className="text-xs text-ink-muted">{TASK_KIND[t.kind]}{t.amount ? ` — ${t.amount.toLocaleString("en-US")} د.أ` : ""}{t.dueDate ? ` — قبل ${fmtDate(t.dueDate)}` : ""}</p>
                  {t.details && <p className="mt-1 text-sm">{t.details}</p>}
                  {active && t.kind !== "PAYMENT" && (
                    <details className="mt-2">
                      <summary className="btn-secondary btn-sm cursor-pointer list-none">موافقة رقمية</summary>
                      <div className="mt-2">
                        <PortalForm action={signTask.bind(null, b.id, t.id)} submitLabel="أوافق" submitClass="btn-primary btn-sm">
                          <input name="signedName" className="input" placeholder="اسمك الكامل" defaultValue={c.name} required />
                          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="agree" required /> اطلعت وأوافق على «{t.title}»</label>
                        </PortalForm>
                      </div>
                    </details>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="card card-pad">
          <h2 className="mb-3 flex items-center gap-2 text-lg font-black text-navy"><CalendarClock className="h-5 w-5 text-navy-3" /> شو بكرا</h2>
          {launched && <ProgressBar value={p.progress} className="mb-3" />}
          {next.length === 0 ? <p className="text-sm text-ink-muted">{launched ? "ستظهر المراحل القادمة هنا." : "تُعلن المراحل بعد «تم»."}</p> : (
            <ol className="space-y-2.5">
              {next.map((m, i) => (
                <li key={m.id} className="flex items-center justify-between gap-2">
                  <span className={clsx("flex items-center gap-2 font-bold", i === 0 && "text-accent")}><Hammer className="h-4 w-4" /> {m.title}</span>
                  <span className="num text-xs text-ink-muted">{m.plannedDate ? fmtDate(m.plannedDate) : ""}</span>
                </li>
              ))}
            </ol>
          )}
          {p.milestones.some((m) => m.doneAt) && <p className="mt-3 text-xs text-ink-muted">أُنجز: {p.milestones.filter((m) => m.doneAt).map((m) => m.title).join(" · ")}</p>}
        </div>
      </div>

      <h2 className="mb-3 text-xl font-black text-navy">شقتك من العظم إلى المفتاح</h2>
      <Configurator
        buyerId={b.id}
        items={items}
        areaSqm={b.unit.areaSqm}
        skeletonPrice={b.unit.skeletonPrice}
        credits={credits}
        initial={b.selections.map((s) => ({ itemId: s.itemId, qty: s.qty, lockedPrice: s.lockedPrice }))}
        locked={!!b.pricesLockedAt}
        readOnly={!active || b.status === "HANDED_OVER" || ["cancelled_reset", "handover_completed"].includes(p.status)}
      />

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <div className="card card-pad">
          <h2 className="mb-3 flex items-center gap-2 text-lg font-black text-navy"><Gift className="h-5 w-5 text-gold" /> حوافزك</h2>
          {b.credits.length === 0 ? <p className="text-sm text-ink-muted">لا حوافز بعد. «جيب جارك»: إذا وقّع جارك عقده بإحالتك تحصل على {p.referrerBonus} د.أ ويحصل هو على {p.referredBonus} د.أ.</p> : (
            <ul className="space-y-2 text-sm">
              {b.credits.map((x) => (
                <li key={x.id} className="flex items-center justify-between gap-2"><span>{CREDIT_KIND[x.kind] ?? x.kind}{x.note ? ` — ${x.note}` : ""}</span><span className="flex items-center gap-1.5"><b className="num">{x.amount}</b><StatusBadge map={CREDIT_STATUS} value={x.status} /></span></li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs leading-5 text-ink-muted">قبل «تم» تقدر تنسحب بأي وقت ويرجعلك شيكك المصدق كاملاً بلا رسوم — وتسقط الحوافز المستحقة. سقف الحوافز للشقة {p.unitIncentiveCap.toLocaleString("en-US")} د.أ.</p>
        </div>
        <div className="card card-pad">
          <h2 className="mb-3 flex items-center gap-2 text-lg font-black text-navy"><Plane className="h-5 w-5 text-navy-3" /> وضع المغترب</h2>
          <p className="mb-3 text-sm text-ink-muted">تابع من أي مكان: سجل صور وفيديو أسبوعي، وموافقات رقمية بدل الحضور.</p>
          {active && (
            <PortalForm action={setRemote.bind(null, b.id)} submitLabel="حفظ" submitClass="btn-secondary btn-sm">
              <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" name="remote" defaultChecked={b.remoteMode} /> أنا مقيم خارج الأردن / أتابع عن بُعد</label>
            </PortalForm>
          )}
          {history.length > 0 && (
            <>
              <p className="mb-1 mt-4 text-sm font-black">سجل موافقاتك</p>
              <ul className="space-y-1 text-xs">{history.map((t) => <li key={t.id} className="flex items-center gap-1.5"><BadgeCheck className="h-4 w-4 text-good" /> {t.title}{t.signedAt ? ` — ${t.signedName} — ${fmtDate(t.signedAt)}` : ""}</li>)}</ul>
            </>
          )}
        </div>
      </div>

      <div className="card card-pad mt-6">
        <h2 className="mb-3 flex items-center gap-2 text-lg font-black text-navy"><Camera className="h-5 w-5 text-accent" /> سجل الموقع</h2>
        {p.updates.length === 0 ? <p className="text-sm text-ink-muted">تظهر صور وفيديو الموقع هنا أسبوعياً بعد «تم».</p> : (
          <ul className="space-y-5">
            {p.updates.map((u) => {
              const fs = files.filter((f) => f.entityId === u.id);
              return (
                <li key={u.id}>
                  <p className="font-black">{u.title}</p>
                  <p className="text-xs text-ink-muted">{fmtDate(u.createdAt)}</p>
                  <p className="mt-1 whitespace-pre-line text-sm leading-7">{u.body}</p>
                  {fs.length > 0 && (
                    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {fs.map((f) =>
                        isImg(f.fileName) ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <a key={f.id} href={`/portal/files/${f.id}`} target="_blank" rel="noreferrer"><img src={`/portal/files/${f.id}`} alt={u.title} loading="lazy" className="aspect-[4/3] w-full rounded-xl object-cover" /></a>
                        ) : isVid(f.fileName) ? (
                          <video key={f.id} src={`/portal/files/${f.id}`} controls preload="metadata" className="aspect-[4/3] w-full rounded-xl bg-black object-cover" />
                        ) : (
                          <a key={f.id} href={`/portal/files/${f.id}`} className="btn-secondary btn-sm" target="_blank" rel="noreferrer">{f.fileName}</a>
                        ),
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {p.neighborIntro && active && (
        <div className="card card-pad mt-6">
          <h2 className="mb-3 flex items-center gap-2 text-lg font-black text-navy"><Users className="h-5 w-5 text-navy-3" /> تعرّف على جيرانك</h2>
          <p className="mb-3 text-sm text-ink-muted">اختياري تماماً: يظهر اسمك الأول وطابقك ونبذتك فقط لجيرانك الذين وافقوا أيضاً — لا أرقام ولا بريد.</p>
          <PortalForm action={setNeighbor.bind(null, b.id)} submitLabel="حفظ" submitClass="btn-secondary btn-sm">
            <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" name="optIn" defaultChecked={b.neighborOptIn} /> أوافق على ظهور تعريفي لجيراني</label>
            <textarea name="bio" className="input min-h-[70px]" maxLength={280} placeholder="مثال: عائلة من 4، نحب الهدوء والزراعة على البلكونة" defaultValue={b.neighborBio ?? ""} />
          </PortalForm>
          {b.neighborOptIn && (
            <ul className="mt-4 grid gap-3 sm:grid-cols-2">
              {neighbors.map((n) => (
                <li key={n.id} className="rounded-2xl bg-black/[0.03] p-3">
                  <p className="flex items-center gap-1.5 font-bold"><HandHeart className="h-4 w-4 text-accent" /> {n.name.split(" ")[0]} — {n.unit.floor}</p>
                  {n.neighborBio && <p className="mt-1 text-sm text-ink-soft">{n.neighborBio}</p>}
                </li>
              ))}
              {!neighbors.length && <li className="text-sm text-ink-muted">لم يفعّل أي جار تعريفه بعد.</li>}
            </ul>
          )}
        </div>
      )}
    </>
  );
}

import { notFound, redirect } from "next/navigation";
import { CalendarRange, ClipboardList, FileSignature, HardHat, MessagesSquare, Paperclip, Timer, TrendingUp, Users } from "lucide-react";
import { db } from "@/lib/db";
import { requireClientProject } from "@/lib/client-session";
import { planProgress, SIGN_STATUS } from "@/lib/portal";
import { addDays, fmtDate } from "@/lib/format";
import { Badge, StatusBadge } from "@/components/ui";
import { SignaturePad } from "@/components/signature-pad";
import { Disclosure, PortalForm } from "../portal-form";
import { clientCreateSign, clientMessage, clientSign } from "../actions";

export const metadata = { title: "مشروعي" };

type Att = { id: number; fileName: string; entityId: number };
function Files({ items }: { items?: Att[] }) {
  if (!items?.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {items.map((a) => (
        <a key={a.id} href={`/portal/files/${a.id}`} target="_blank" className="inline-flex max-w-full items-center gap-1 rounded-lg bg-white/70 px-2 py-1 text-xs font-semibold text-navy-3 ring-1 ring-line hover:text-accent">
          <Paperclip className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{a.fileName}</span>
        </a>
      ))}
    </div>
  );
}

function Section({ icon: Icon, title, children, action }: { icon: typeof Timer; title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="card card-pad">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg font-extrabold"><span className="grid h-9 w-9 place-items-center rounded-xl bg-navy text-gold"><Icon className="h-5 w-5" /></span>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export default async function PortalProject({ params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!Number.isInteger(id)) notFound();
  const c = await requireClientProject(id);
  if (c.mustChangePassword) redirect("/portal/password");
  const t = await db.tender.findUnique({
    where: { id },
    include: {
      manager: { select: { name: true } },
      workPlan: { orderBy: [{ sortOrder: "asc" }, { startDate: "asc" }] },
      diaries: { orderBy: { date: "desc" }, take: 30 },
      portalMessages: { orderBy: { createdAt: "asc" }, take: 300 },
      signRequests: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!t) notFound();
  const atts = await db.attachment.findMany({
    where: {
      OR: [
        { entityType: "diary", entityId: { in: t.diaries.map((d) => d.id) } },
        { entityType: "portal_message", entityId: { in: t.portalMessages.map((m) => m.id) } },
        { entityType: "sign_request", entityId: { in: t.signRequests.map((s) => s.id) } },
      ],
    },
    select: { id: true, fileName: true, entityType: true, entityId: true, mimeType: true },
    orderBy: { id: "asc" },
  });
  const by = (type: string, eid: number) => atts.filter((a) => a.entityType === type && a.entityId === eid);
  // الرسائل من الشركة تُعلَّم مقروءة عند فتح العميل للصفحة
  await db.portalMessage.updateMany({ where: { tenderId: id, fromUserId: { not: null }, readByClientAt: null }, data: { readByClientAt: new Date() } });

  const plan = planProgress(t.workPlan);
  const days = (t.durationDays ?? 0) + (t.variationDays ?? 0);
  const finish = t.commenceOrderDate && days ? addDays(t.commenceOrderDate, days) : null;
  const elapsed = t.commenceOrderDate && days ? Math.min(100, Math.max(0, Math.round(((Date.now() - +t.commenceOrderDate) / (days * 86400000)) * 100))) : null;
  const min = t.workPlan.length ? Math.min(...t.workPlan.map((i) => +i.startDate)) : 0;
  const span = t.workPlan.length ? Math.max(Math.max(...t.workPlan.map((i) => +i.endDate)) - min, 86400000) : 1;
  const pendingSign = t.signRequests.filter((s) => s.status === "PENDING_CLIENT").length;

  return (
    <div className="space-y-5">
      {/* الواجهة: الإنجاز الكلي */}
      <section className="relative overflow-hidden rounded-[24px] p-6 text-white shadow-pop" style={{ background: "radial-gradient(60% 80% at 100% 0%, rgba(242,177,52,.35), transparent 70%), linear-gradient(135deg, #0b2545, #1d4e89)" }}>
        <p className="text-sm text-gold">مشروعك</p>
        <h1 className="mt-1 text-2xl font-extrabold sm:text-3xl">{t.name}</h1>
        <p className="mt-1 text-sm text-white/70">{t.location ?? ""}{t.manager ? ` — مدير المشروع: ${t.manager.name}` : ""}</p>
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <div>
            <p className="text-xs text-white/60">نسبة الإنجاز</p>
            <p className="num text-4xl font-black text-gold">{t.progress}%</p>
            <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-white/15"><div className="progress-fill h-full bar-grow" style={{ width: `${t.progress}%` }} /></div>
          </div>
          <div>
            <p className="text-xs text-white/60">المدة المنقضية</p>
            <p className="num text-2xl font-extrabold">{elapsed == null ? "—" : `${elapsed}%`}</p>
            <p className="text-xs text-white/60">{t.commenceOrderDate ? `منذ ${fmtDate(t.commenceOrderDate)}` : "لم يُحدد تاريخ البدء"}</p>
          </div>
          <div>
            <p className="text-xs text-white/60">التسليم المتوقع</p>
            <p className="num text-2xl font-extrabold">{finish ? fmtDate(finish) : "—"}</p>
            {pendingSign > 0 && <Badge tone="orange" className="mt-1">{pendingSign} مستند بانتظار توقيعك</Badge>}
          </div>
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-5">
        <div className="space-y-5 lg:col-span-3">
          <Section icon={CalendarRange} title="خطة العمل">
            {t.workPlan.length === 0 ? (
              <p className="py-4 text-center text-sm text-ink-muted">ستظهر خطة العمل هنا فور إعدادها من مدير المشروع</p>
            ) : (
              <>
                {plan != null && <p className="mb-3 text-sm text-ink-muted">الإنجاز حسب البرنامج الزمني: <b className="num text-ink">{plan}%</b></p>}
                <ul className="space-y-3">
                  {t.workPlan.map((it) => {
                    const done = it.progress >= 100;
                    const late = !done && +it.endDate < Date.now();
                    return (
                      <li key={it.id}>
                        <div className="flex items-center justify-between gap-2 text-sm">
                          <span className="font-bold">{it.title} {done && <Badge tone="green">مكتمل</Badge>}{late && <Badge tone="red">متأخر</Badge>}</span>
                          <span className="num font-bold text-accent">{it.progress}%</span>
                        </div>
                        <div className="relative mt-1.5 h-3 rounded-full bg-canvas">
                          <div className="absolute inset-y-0 overflow-hidden rounded-full bg-navy/15" style={{ insetInlineStart: `${((+it.startDate - min) / span) * 100}%`, width: `${Math.max(((+it.endDate - +it.startDate) / span) * 100, 2)}%` }}>
                            <div className="progress-fill h-full" style={{ width: `${it.progress}%` }} />
                          </div>
                        </div>
                        <p className="num mt-0.5 text-xs text-ink-muted">{fmtDate(it.startDate)} ← {fmtDate(it.endDate)}{it.notes ? ` — ${it.notes}` : ""}</p>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </Section>

          <Section icon={ClipboardList} title="يوميات الموقع">
            {t.diaries.length === 0 ? (
              <p className="py-4 text-center text-sm text-ink-muted">لا توجد يوميات بعد</p>
            ) : (
              <ol className="relative space-y-5 border-s-2 border-gold/50 ps-5">
                {t.diaries.map((d) => (
                  <li key={d.id} className="relative">
                    <span className="absolute -start-[27px] top-1 h-3.5 w-3.5 rounded-full bg-accent ring-4 ring-white" />
                    <p className="num text-sm font-extrabold">{fmtDate(d.date)}</p>
                    <p className="mt-1 flex flex-wrap gap-3 text-xs text-ink-muted">
                      {d.workforce > 0 && <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" /> {d.workforce} عامل</span>}
                      {d.weather && <span>الطقس: {d.weather}</span>}
                      {d.equipment && <span className="inline-flex items-center gap-1"><HardHat className="h-3.5 w-3.5" /> {d.equipment}</span>}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-[15px] leading-7">{d.workDone}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {by("diary", d.id).filter((a) => a.mimeType.startsWith("image/")).map((a) => (
                        <a key={a.id} href={`/portal/files/${a.id}`} target="_blank"><img src={`/portal/files/${a.id}`} alt={a.fileName} loading="lazy" className="h-24 w-32 rounded-xl object-cover ring-1 ring-line" /></a>
                      ))}
                    </div>
                    <Files items={by("diary", d.id).filter((a) => !a.mimeType.startsWith("image/"))} />
                  </li>
                ))}
              </ol>
            )}
          </Section>
        </div>

        <div className="space-y-5 lg:col-span-2">
          <Section icon={MessagesSquare} title="المراسلات">
            <div className="mb-4 max-h-[420px] space-y-3 overflow-y-auto">
              {t.portalMessages.length === 0 && <p className="py-4 text-center text-sm text-ink-muted">ابدأ المراسلة مع فريق المشروع</p>}
              {t.portalMessages.map((m) => (
                <div key={m.id} className={m.fromClientId ? "ms-8 rounded-2xl rounded-se-sm bg-gold-soft p-3" : "me-8 rounded-2xl rounded-ss-sm bg-navy/[0.06] p-3"}>
                  <p className="text-xs font-bold text-ink-muted">{m.senderName} — {fmtDate(m.createdAt)}</p>
                  <p className="mt-1 whitespace-pre-wrap text-[15px]">{m.body}</p>
                  <Files items={by("portal_message", m.id)} />
                </div>
              ))}
            </div>
            <PortalForm action={clientMessage.bind(null, id)} submitLabel="إرسال" reset>
              <textarea name="body" className="input min-h-[90px]" placeholder="اكتب رسالتك لفريق المشروع…" required />
              <input type="file" name="files" multiple accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.doc,.docx,.xls,.xlsx" className="block w-full text-sm" />
            </PortalForm>
          </Section>

          <Section
            icon={FileSignature}
            title="المستندات والتواقيع"
            action={
              <Disclosure trigger="+ مستند للتوقيع">
                <PortalForm action={clientCreateSign.bind(null, id)} submitLabel="توقيع وإرسال للشركة" reset>
                  <input name="title" className="input" placeholder="عنوان المستند" required />
                  <textarea name="description" className="input" placeholder="وصف (اختياري)" />
                  <input type="file" name="files" accept=".pdf,.jpg,.jpeg,.png,.webp" className="block w-full text-sm" required />
                  <input name="signerName" className="input" placeholder="اسمك الكامل" defaultValue={c.name} required />
                  <SignaturePad />
                </PortalForm>
              </Disclosure>
            }
          >
            {t.signRequests.length === 0 ? (
              <p className="py-4 text-center text-sm text-ink-muted">لا توجد مستندات</p>
            ) : (
              <ul className="space-y-3">
                {t.signRequests.map((s) => (
                  <li key={s.id} className="rounded-xl border border-line p-3">
                    <p className="font-bold">{s.title}</p>
                    <StatusBadge map={SIGN_STATUS} value={s.status} />
                    {s.description && <p className="mt-1 text-sm text-ink-soft">{s.description}</p>}
                    <Files items={by("sign_request", s.id)} />
                    <div className="mt-2 space-y-0.5 text-xs text-ink-muted">
                      {s.companySignedAt && <p>وقّع عن الشركة: {s.companySignerName} — {fmtDate(s.companySignedAt)}</p>}
                      {s.clientSignedAt && <p>وقّع: {s.clientSignerName} — {fmtDate(s.clientSignedAt)}</p>}
                      {s.rejectReason && <p className="text-bad">{s.rejectReason}</p>}
                      {s.docHash && <p className="num truncate" dir="ltr">SHA-256 {s.docHash.slice(0, 20)}…</p>}
                    </div>
                    {s.status === "PENDING_CLIENT" && (
                      <div className="mt-3 space-y-2">
                        <Disclosure trigger="مراجعة وتوقيع">
                          <PortalForm action={clientSign.bind(null, id, s.id)} submitLabel="توقيع المستند">
                            <input name="signerName" className="input" placeholder="اسمك الكامل" defaultValue={c.name} required />
                            <SignaturePad />
                            <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="agree" required className="mt-1" /> اطلعت على المستند المرفق وأوافق على محتواه</label>
                          </PortalForm>
                        </Disclosure>
                        <Disclosure trigger="رفض">
                          <PortalForm action={clientSign.bind(null, id, s.id)} submitLabel="تسجيل الرفض" submitClass="btn-danger w-full">
                            <input type="hidden" name="reject" value="1" />
                            <textarea name="reason" className="input" placeholder="سبب الرفض" required />
                          </PortalForm>
                        </Disclosure>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section icon={TrendingUp} title="معلومات المشروع">
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div><dt className="text-xs text-ink-muted">الرقم المرجعي</dt><dd className="num font-bold">{t.number}</dd></div>
              <div><dt className="text-xs text-ink-muted">المدة التعاقدية</dt><dd className="font-bold">{days ? `${days} يوماً` : "—"}</dd></div>
              <div><dt className="text-xs text-ink-muted">المهندس المشرف</dt><dd className="font-bold">{t.supervisorName ?? "—"}</dd></div>
              <div><dt className="text-xs text-ink-muted">آخر تحديث</dt><dd className="num font-bold">{fmtDate(t.updatedAt)}</dd></div>
            </dl>
          </Section>
        </div>
      </div>
    </div>
  );
}

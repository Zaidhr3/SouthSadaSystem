import { notFound } from "next/navigation";
import clsx from "clsx";
import { BadgeCheck, CalendarClock, CheckCircle2, Circle, FileSignature, Globe, Hammer, KeyRound, Lock, Pencil, PlayCircle, Plus, RefreshCcw, Settings2, Trash2, UserMinus, UserPlus, Wallet, XCircle } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { AttachmentList, Badge, Card, EmptyState, KeyValue, Money, PageHeader, ProgressBar, StatusBadge, TabPanel, Tabs } from "@/components/ui";
import { ConfirmButton, FileInput, Grid, Input, ModalForm, Select, Textarea } from "@/components/forms";
import { fmtDate } from "@/lib/format";
import { ACTIVE_BUYER, BUYER_STATUS, CREDIT_KIND, CREDIT_STATUS, CUSTODY, LAUNCHED, PRE_LAUNCH, PROJECT_STATUS, TASK_KIND, UNIT_STATUS, buyerMonth, priceOf, r3 } from "@/lib/cobuild-core";
import { committedWhere } from "@/lib/cobuild";
import {
  addBuyer, addMilestone, addTask, cancelAction, completeTask, deleteMilestone, giveBuyerPortal, handOver, launchAction, lockPrices, markContracted,
  postUpdate, saveProgress, saveProjectSettings, saveUnit, settleCheque, syncIncentivesAction, toggleMilestone, updateCheque, withdrawAction,
} from "../../actions/cobuild";

export const dynamic = "force-dynamic";
export const metadata = { title: "مشروع سكن تشاركي" };

export default async function CoBuildProjectPage({ params, searchParams }: { params: { id: string }; searchParams: { tab?: string } }) {
  const user = await requireUser();
  const id = Number(params.id);
  if (!Number.isInteger(id)) notFound();
  const p = await db.coBuildProject.findUnique({
    where: { id },
    include: {
      tender: { select: { name: true } },
      units: { orderBy: { sortOrder: "asc" } },
      buyers: { orderBy: { seq: "asc" }, include: { unit: true, credits: { orderBy: { id: "asc" } }, selections: { include: { item: true } }, referredBy: { select: { name: true } }, client: { select: { email: true, lastLoginAt: true } } } },
      milestones: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
      updates: { orderBy: { createdAt: "desc" }, take: 30 },
      tasks: { orderBy: [{ status: "asc" }, { dueDate: "asc" }], include: { buyer: { select: { name: true } } } },
      events: { orderBy: { createdAt: "desc" }, take: 150 },
    },
  });
  if (!p) notFound();
  const manage = can.manageCoBuild(user.role);
  const deals = can.coBuildDeals(user.role);
  const site = can.coBuildSite(user.role);
  const pre = PRE_LAUNCH.includes(p.status);
  const launched = LAUNCHED.includes(p.status);
  const committed = await db.coBuildBuyer.count({ where: committedWhere(p.id) });
  const files = await db.attachment.findMany({ where: { entityType: "cobuild_update", entityId: { in: p.updates.map((u) => u.id) } }, select: { id: true, entityId: true, fileName: true, size: true } });
  const active = p.buyers.filter((b) => ACTIVE_BUYER.includes(b.status));
  const heldSum = p.buyers.filter((b) => b.custodyStatus === "held_pending_go" && ACTIVE_BUYER.includes(b.status)).reduce((s, b) => s + (b.chequeAmount ?? 0), 0);
  const fin = (b: (typeof p.buyers)[number]) => {
    const finishing = r3(b.selections.reduce((s, x) => s + x.qty * (x.lockedPrice ?? priceOf(x.item)), 0));
    const credits = r3(b.credits.filter((c) => c.status !== "FORFEITED").reduce((s, c) => s + c.amount, 0));
    return { finishing, credits, total: r3(b.unit.skeletonPrice + finishing - credits) };
  };
  const tabs = [
    { key: "overview", label: "نظرة عامة" },
    { key: "buyers", label: "المشترون والشيكات", count: active.length },
    { key: "units", label: "الشقق", count: p.units.length },
    { key: "progress", label: "الإنجاز وشو بكرا" },
    { key: "tasks", label: "شو عندك", count: p.tasks.filter((t) => t.status === "OPEN").length },
    { key: "log", label: "سجل الأحداث", more: true },
  ];
  const tab = tabs.some((t) => t.key === searchParams.tab) ? searchParams.tab! : "overview";
  const availableUnits = p.units.filter((u) => u.status === "available");
  const nextMs = p.milestones.find((m) => !m.doneAt);
  const pct = Math.min(100, Math.round((committed / p.launchThreshold) * 100));

  return (
    <>
      <PageHeader
        back={{ href: "/cobuild", label: "السكن التشاركي" }}
        eyebrow={`${p.ref} — ${p.location}`}
        title={p.name}
        subtitle={<span className="flex flex-wrap items-center gap-2"><StatusBadge map={PROJECT_STATUS} value={p.status} />{p.isPublic && <Badge tone="green"><Globe className="me-1 inline h-3.5 w-3.5" />معروض على الموقع</Badge>}{p.tender && <Badge tone="blue">مرتبط بـ {p.tender.name}</Badge>}</span>}
        actions={
          <>
            {manage && p.status === "ready_to_launch" && (
              <ConfirmButton action={launchAction.bind(null, p.id)} confirm={`إعلان «تم» لـ ${p.name}؟ ستُحرَّر ${committed} شيكات مصدقة للتنفيذ وتُثبَّت الشقق وتُطبَّق الحوافز — لا رجعة.`} className="btn-primary">
                <PlayCircle className="h-4 w-4" /> تم — ابدأ التنفيذ
              </ConfirmButton>
            )}
            {manage && (
              <ModalForm triggerClass="btn-secondary" trigger={<><Settings2 className="h-4 w-4" /> الإعدادات والحوافز</>} title="إعدادات المشروع والحوافز" action={saveProjectSettings.bind(null, p.id)} wide>
                <Grid>
                  <Input name="name" label="الاسم" defaultValue={p.name} />
                  <Input name="location" label="الموقع" defaultValue={p.location} />
                </Grid>
                <Grid cols={3}>
                  <Input name="parcel" label="القطعة" defaultValue={p.parcel ?? ""} />
                  <Input name="basin" label="الحوض" defaultValue={p.basin ?? ""} />
                  <Input name="launchThreshold" label={`نصاب «تم» (من ${p.totalUnits})`} type="number" step="1" defaultValue={p.launchThreshold} disabled={!pre} />
                </Grid>
                <Textarea name="description" label="الوصف (يظهر للمشترين والموقع)" rows={3} defaultValue={p.description ?? ""} />
                <p className="mt-2 text-sm font-black text-navy">حوافز الانتظار</p>
                <Grid cols={3}>
                  <Input name="waitStartMonth" label="من الشهر" type="number" step="1" defaultValue={p.waitStartMonth} />
                  <Input name="waitPerMonth" label="لكل شهر (د.أ)" type="number" defaultValue={p.waitPerMonth} />
                  <Input name="waitMaxMonths" label="حتى عدد أشهر" type="number" step="1" defaultValue={p.waitMaxMonths} />
                </Grid>
                <p className="mt-2 text-sm font-black text-navy">جيب جارك والمزايا</p>
                <Grid cols={3}>
                  <Input name="referrerBonus" label="للمُحيل (د.أ)" type="number" defaultValue={p.referrerBonus} />
                  <Input name="referredBonus" label="للجار (د.أ)" type="number" defaultValue={p.referredBonus} />
                  <Input name="unitIncentiveCap" label="سقف الحوافز للشقة (د.أ)" type="number" defaultValue={p.unitIncentiveCap} hint="يحمي الهامش" />
                </Grid>
                <Grid cols={3}>
                  <Input name="earlyBirdCount" label="عدد الأوائل" type="number" step="1" defaultValue={p.earlyBirdCount} />
                  <Input name="earlyBirdBonus" label="ميزة الأوائل (د.أ، 0 = شارة فقط)" type="number" defaultValue={p.earlyBirdBonus} />
                  <Input name="closerBonus" label="ميزة مكمّل المجموعة (د.أ)" type="number" defaultValue={p.closerBonus} />
                </Grid>
                <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" name="neighborIntro" defaultChecked={p.neighborIntro} /> تفعيل «تعرّف على جيرانك» (بموافقة كل مشترٍ)</label>
                <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" name="isPublic" defaultChecked={p.isPublic} /> عرض المشروع وعدّاد الجاهزية على موقع الشركة (بلا أسماء)</label>
              </ModalForm>
            )}
          </>
        }
      />
      <Tabs tabs={tabs} active={tab} base={`/cobuild/${p.id}`} />

      <TabPanel tab={tab}>
        {tab === "overview" && (
          <div className="grid gap-5 lg:grid-cols-3">
            <Card className="lg:col-span-2" title="جاهزية المجموعة">
              <div className="flex items-end justify-between gap-4">
                <p className="num text-[44px] font-black leading-none text-navy">{committed}<span className="text-2xl text-ink-muted"> / {p.launchThreshold}</span></p>
                <p className="text-end text-sm text-ink-muted">ملتزمين بشيكات مصدقة<br />من أصل {p.totalUnits} شقق</p>
              </div>
              <div className="mt-4 flex gap-1.5" aria-hidden>
                {Array.from({ length: p.totalUnits }, (_, i) => (
                  <span key={i} className={clsx("h-3 flex-1 rounded-full", i < committed ? "bg-gradient-to-l from-gold to-accent" : i < p.launchThreshold ? "bg-black/[0.08]" : "bg-black/[0.03] ring-1 ring-dashed ring-black/10")} />
                ))}
              </div>
              <p className="mt-3 text-sm text-ink-muted">{launched ? `انطلق في ${fmtDate(p.launchedAt)} — الإنجاز ${p.progress}%` : p.status === "ready_to_launch" ? "اكتمل النصاب — بانتظار إعلان «تم» من الإدارة." : p.status === "cancelled_reset" ? "المشروع ملغى وأُعيدت الشيكات." : `باقي ${Math.max(0, p.launchThreshold - committed)} ملتزمين للانطلاق (${pct}%).`}</p>
              {launched && <ProgressBar className="mt-3" value={p.progress} />}
            </Card>
            <Card title="الشيكات والحوافز">
              <KeyValue cols={2} items={[
                { label: "بالأمانة حتى «تم»", value: <Money value={heldSum} strong /> },
                { label: "حوافز مستحقة/مطبّقة", value: <Money value={p.buyers.flatMap((b) => b.credits).filter((c) => c.status !== "FORFEITED").reduce((s, c) => s + c.amount, 0)} /> },
                { label: "حافز الانتظار", value: `${p.waitPerMonth} × ${p.waitMaxMonths} من الشهر ${p.waitStartMonth}` },
                { label: "جيب جارك", value: `${p.referrerBonus} / ${p.referredBonus}` },
              ]} />
              {deals && pre && (
                <div className="mt-4">
                  <ConfirmButton action={syncIncentivesAction.bind(null, p.id)} className="btn-secondary btn-sm"><RefreshCcw className="h-4 w-4" /> احتساب حوافز الانتظار الآن</ConfirmButton>
                  <p className="mt-1 text-xs text-ink-muted">تُحتسب تلقائياً يومياً — والزر للتحديث الفوري.</p>
                </div>
              )}
            </Card>
            <Card className="lg:col-span-2" title="بيانات المشروع">
              <KeyValue cols={3} items={[
                { label: "الموقع", value: p.location },
                { label: "القطعة / الحوض", value: [p.parcel, p.basin].filter(Boolean).join(" — ") || "—" },
                { label: "بدء جمع الملتزمين", value: fmtDate(p.openedAt) },
                { label: "المرحلة الحالية", value: p.phaseLabel ?? "—" },
                { label: "شو بكرا", value: nextMs ? `${nextMs.title}${nextMs.plannedDate ? ` — ${fmtDate(nextMs.plannedDate)}` : ""}` : "—" },
                { label: "تعرّف على جيرانك", value: p.neighborIntro ? "مفعّل" : "غير مفعّل" },
              ]} />
              {p.description && <p className="mt-4 whitespace-pre-line text-sm leading-7 text-ink-soft">{p.description}</p>}
            </Card>
            {manage && pre && (
              <Card title="إلغاء المشروع">
                <p className="mb-3 text-sm text-ink-muted">قبل «تم» فقط: تُعاد كل الشيكات المصدقة كاملة وتسقط الحوافز وتُفرَّغ الشقق، ويصل السبب لكل المشترين.</p>
                <ModalForm triggerClass="btn-danger btn-sm" trigger={<><XCircle className="h-4 w-4" /> إلغاء وإعادة الشيكات</>} title="إلغاء المشروع قبل الانطلاق" action={cancelAction.bind(null, p.id)} submitLabel="ألغِ المشروع">
                  <Textarea name="reason" label="السبب (يصل للمشترين)" rows={3} required />
                </ModalForm>
              </Card>
            )}
          </div>
        )}

        {tab === "buyers" && (
          <>
            {deals && pre && (
              <div className="mb-4">
                {availableUnits.length ? (
                  <ModalForm trigger={<><UserPlus className="h-4 w-4" /> مشترٍ ملتزم جديد</>} title="التزام مشترٍ جديد (بشيك مصدق)" action={addBuyer.bind(null, p.id)} submitLabel="سجّل الالتزام" wide>
                    <Grid cols={3}>
                      <Input name="name" label="الاسم الكامل" required />
                      <Input name="phone" label="الهاتف" inputMode="tel" />
                      <Input name="email" label="البريد (لحساب البوابة)" type="email" dir="ltr" />
                    </Grid>
                    <Grid>
                      <Select name="unitId" label="الشقة" required options={availableUnits.map((u) => ({ value: u.id, label: `${u.unitCode} — ${u.floor} — ${u.areaSqm} م² — ${u.skeletonPrice} د.أ${u.isBuffer ? " (احتياطية)" : ""}` }))} />
                      <Select name="referredById" label="بإحالة من (جيب جارك)" placeholder="— بلا إحالة —" options={active.map((b) => ({ value: b.id, label: `${b.name} — ${b.unit.unitCode}` }))} />
                    </Grid>
                    <p className="mt-1 text-sm font-black text-navy">الشيك المصدق (يبقى بالأمانة حتى «تم»)</p>
                    <Grid cols={2}>
                      <Input name="chequeNumber" label="رقم الشيك" required dir="ltr" />
                      <Input name="bankName" label="البنك" required />
                    </Grid>
                    <Grid cols={2}>
                      <Input name="chequeAmount" label="المبلغ (د.أ)" type="number" required />
                      <Input name="chequeIssuedAt" label="تاريخ الإصدار" type="date" />
                    </Grid>
                    <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" name="portal" defaultChecked /> أنشئ حساب البوابة للمشتري (بالبريد أعلاه)</label>
                  </ModalForm>
                ) : (
                  <Badge tone="gray">لا شقق متاحة</Badge>
                )}
              </div>
            )}
            {p.buyers.length === 0 ? (
              <Card><EmptyState icon={UserPlus} title="لا ملتزمين بعد" /></Card>
            ) : (
              <div className="grid gap-4 lg:grid-cols-2">
                {p.buyers.map((b) => {
                  const f = fin(b);
                  const month = buyerMonth(b.joinedAt, p.launchedAt ?? new Date());
                  const isActive = ACTIVE_BUYER.includes(b.status);
                  return (
                    <div key={b.id} className={clsx("card card-pad", !isActive && "opacity-60")}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-lg font-black text-navy">#{b.seq} {b.name}</p>
                          <p className="text-sm text-ink-muted">الشقة {b.unit.unitCode} — {b.unit.floor} — {b.unit.areaSqm} م² {b.phone && <span dir="ltr">· {b.phone}</span>}</p>
                          <div className="mt-1 flex flex-wrap gap-1">
                            <StatusBadge map={BUYER_STATUS} value={b.status} />
                            {b.earlyBird && <Badge tone="purple">من الأوائل</Badge>}
                            {b.groupCloser && <Badge tone="purple">مكمّل المجموعة</Badge>}
                            {b.referredBy && <Badge tone="blue">بإحالة {b.referredBy.name}</Badge>}
                            {b.remoteMode && <Badge tone="gray">مغترب</Badge>}
                            {b.pricesLockedAt && <Badge tone="blue"><Lock className="me-1 inline h-3 w-3" />أسعار مقفولة</Badge>}
                            {b.client ? <Badge tone="green">البوابة{b.client.lastLoginAt ? " ✓" : ""}</Badge> : <Badge tone="gray">بلا بوابة</Badge>}
                          </div>
                        </div>
                        {pre && isActive && <span className="num shrink-0 rounded-xl bg-gold-soft px-2.5 py-1 text-xs font-black text-warn">الشهر {month}</span>}
                      </div>
                      <div className="mt-3 rounded-2xl bg-black/[0.03] p-3 text-sm">
                        <p className="flex flex-wrap items-center justify-between gap-2"><span className="font-bold"><Wallet className="me-1 inline h-4 w-4" />شيك {b.chequeNumber ?? "—"} — {b.bankName ?? ""}</span><Money value={b.chequeAmount} strong /></p>
                        <div className="mt-1 flex items-center justify-between gap-2"><StatusBadge map={CUSTODY} value={b.custodyStatus} /><span className="text-xs text-ink-muted">{b.chequeIssuedAt ? `صدر ${fmtDate(b.chequeIssuedAt)}` : ""}</span></div>
                      </div>
                      <dl className="mt-3 grid grid-cols-4 gap-2 text-center text-xs">
                        <div><dt className="text-ink-muted">العظم</dt><dd className="font-bold"><Money value={b.unit.skeletonPrice} /></dd></div>
                        <div><dt className="text-ink-muted">التشطيب</dt><dd className="font-bold"><Money value={f.finishing} /></dd></div>
                        <div><dt className="text-ink-muted">الحوافز</dt><dd className="font-bold text-good">−<Money value={f.credits} /></dd></div>
                        <div><dt className="text-ink-muted">التقدير</dt><dd className="font-black text-navy"><Money value={f.total} /></dd></div>
                      </dl>
                      {b.credits.length > 0 && (
                        <ul className="mt-2 space-y-1 text-xs">
                          {b.credits.map((c) => (
                            <li key={c.id} className="flex items-center justify-between gap-2"><span>{CREDIT_KIND[c.kind] ?? c.kind}{c.note ? ` — ${c.note}` : ""}</span><span className="flex items-center gap-1"><Money value={c.amount} /><StatusBadge map={CREDIT_STATUS} value={c.status} /></span></li>
                          ))}
                        </ul>
                      )}
                      {deals && isActive && (
                        <div className="mt-3 flex flex-wrap gap-1.5 border-t border-black/5 pt-3">
                          {b.status === "ACTIVE" && <ConfirmButton action={markContracted.bind(null, b.id)} confirm={`تأكيد توقيع عقد ${b.name}؟${b.referredBy ? " (يُحتسب حافز جيب جارك)" : ""}`} className="btn-secondary btn-sm"><FileSignature className="h-4 w-4" /> وقّع العقد</ConfirmButton>}
                          {!b.pricesLockedAt && <ConfirmButton action={lockPrices.bind(null, b.id)} confirm={`قفل أسعار ${b.selections.length} بنود تشطيب لـ ${b.name}؟ لن تتأثر بأي تعديل لاحق على الكتالوج.`} className="btn-secondary btn-sm"><Lock className="h-4 w-4" /> قفل الأسعار</ConfirmButton>}
                          {b.custodyStatus === "held_pending_go" && (
                            <ModalForm triggerClass="btn-ghost btn-sm" trigger={<><Pencil className="h-4 w-4" /> الشيك</>} title={`شيك ${b.name}`} action={updateCheque.bind(null, b.id)}>
                              <Grid><Input name="chequeNumber" label="رقم الشيك" dir="ltr" defaultValue={b.chequeNumber ?? ""} /><Input name="bankName" label="البنك" defaultValue={b.bankName ?? ""} /></Grid>
                              <Grid><Input name="chequeAmount" label="المبلغ" type="number" defaultValue={b.chequeAmount ?? ""} /><Input name="chequeIssuedAt" label="تاريخ الإصدار" type="date" defaultValue={b.chequeIssuedAt?.toISOString().slice(0, 10) ?? ""} /></Grid>
                            </ModalForm>
                          )}
                          {!b.client && (
                            <ModalForm triggerClass="btn-ghost btn-sm" trigger={<><KeyRound className="h-4 w-4" /> حساب البوابة</>} title={`حساب البوابة لـ ${b.name}`} action={giveBuyerPortal.bind(null, b.id)}>
                              <Input name="email" label="البريد الإلكتروني" type="email" dir="ltr" defaultValue={b.email ?? ""} required />
                            </ModalForm>
                          )}
                          {pre && (
                            <ModalForm triggerClass="btn-ghost btn-sm text-bad" trigger={<><UserMinus className="h-4 w-4" /> انسحاب</>} title={`انسحاب ${b.name} قبل «تم»`} action={withdrawAction.bind(null, b.id)} submitLabel="سجّل الانسحاب وأعد الشيك">
                              <p className="mb-2 text-sm text-ink-muted">يُعاد الشيك المصدق كاملاً بلا رسوم (الشهر {month}).{f.credits ? ` تسقط حوافزه المستحقة (${f.credits} د.أ).` : ""} وتعود الشقة {b.unit.unitCode} متاحة.</p>
                              <Textarea name="reason" label="السبب" rows={2} required />
                            </ModalForm>
                          )}
                          {manage && launched && b.status !== "HANDED_OVER" && <ConfirmButton action={handOver.bind(null, b.id)} confirm={`تسليم مفتاح الشقة ${b.unit.unitCode} إلى ${b.name}؟`} className="btn-primary btn-sm"><KeyRound className="h-4 w-4" /> سلّم المفتاح</ConfirmButton>}
                          {manage && b.custodyStatus === "released_on_go" && (
                            <ModalForm triggerClass="btn-ghost btn-sm" trigger="تسوية الشيك" title={`تسوية شيك ${b.name} بقرار`} action={settleCheque.bind(null, b.id)}>
                              <Textarea name="reason" label="السبب ومرجع القرار" rows={3} required />
                            </ModalForm>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {tab === "units" && (
          <Card pad={false}>
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead><tr><th>الشقة</th><th>الطابق</th><th>المساحة</th><th>الواجهة</th><th>سعر العظم</th><th>الحالة</th><th>المشتري</th>{manage && <th />}</tr></thead>
                <tbody>
                  {p.units.map((u) => {
                    const owner = p.buyers.find((b) => b.unitId === u.id && ACTIVE_BUYER.includes(b.status));
                    return (
                      <tr key={u.id}>
                        <td className="font-black">{u.unitCode}{u.isBuffer && <Badge tone="purple" className="ms-1">احتياطية</Badge>}</td>
                        <td>{u.floor}</td>
                        <td className="num">{u.areaSqm} م²</td>
                        <td>{u.facadeView ?? "—"}</td>
                        <td><Money value={u.skeletonPrice} strong /></td>
                        <td><StatusBadge map={UNIT_STATUS} value={u.status} /></td>
                        <td>{owner?.name ?? "—"}</td>
                        {manage && (
                          <td>
                            <ModalForm triggerClass="btn-ghost btn-sm" trigger={<Pencil className="h-4 w-4" />} title={`الشقة ${u.unitCode}`} action={saveUnit.bind(null, u.id)}>
                              <Grid cols={3}><Input name="unitCode" label="الرقم" defaultValue={u.unitCode} /><Input name="floor" label="الطابق" defaultValue={u.floor} /><Input name="facadeView" label="الواجهة" defaultValue={u.facadeView ?? ""} placeholder="أمامية / جنوبية" /></Grid>
                              <Grid><Input name="areaSqm" label="المساحة (م²)" type="number" defaultValue={u.areaSqm} /><Input name="skeletonPrice" label="سعر العظم (د.أ)" type="number" defaultValue={u.skeletonPrice} /></Grid>
                              <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" name="isBuffer" defaultChecked={u.isBuffer} /> شقة احتياطية (تباع لاحقاً بهامش كامل)</label>
                              {u.status !== "available" && <p className="text-xs text-warn">محجوزة — السعر والمساحة مثبّتان للمشتري.</p>}
                            </ModalForm>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {tab === "progress" && (
          <div className="grid gap-5 lg:grid-cols-2">
            <Card title={<span className="flex items-center gap-2"><Hammer className="h-5 w-5 text-gold" /> وين وصل المشروع</span>}>
              <ProgressBar value={p.progress} />
              <p className="mt-2 text-sm text-ink-muted">{p.phaseLabel ?? (launched ? "" : "يبدأ التسجيل بعد «تم»")}</p>
              {site && launched && (
                <ModalForm triggerClass="btn-secondary btn-sm mt-3" trigger="تحديث الإنجاز" title="تحديث الإنجاز" action={saveProgress.bind(null, p.id)}>
                  <Grid>
                    <Input name="progress" label="نسبة الإنجاز %" type="number" step="1" defaultValue={p.progress} />
                    <Select name="status" label="المرحلة" options={LAUNCHED.map((k) => ({ value: k, label: PROJECT_STATUS[k].label }))} defaultValue={p.status} />
                  </Grid>
                  <Input name="phaseLabel" label="وصف المرحلة الحالية" defaultValue={p.phaseLabel ?? ""} placeholder="مثال: صب عقدة الطابق الثاني" />
                </ModalForm>
              )}
            </Card>
            <Card title={<span className="flex items-center gap-2"><CalendarClock className="h-5 w-5 text-navy-3" /> المراحل — شو بكرا</span>}>
              <ul className="space-y-2">
                {p.milestones.map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2">
                      {site ? (
                        <ConfirmButton action={toggleMilestone.bind(null, m.id)} title={m.doneAt ? "إلغاء الإنجاز" : "أُنجزت"} className="btn-ghost btn-sm !px-1">{m.doneAt ? <CheckCircle2 className="h-5 w-5 text-good" /> : <Circle className="h-5 w-5 text-ink-faint" />}</ConfirmButton>
                      ) : m.doneAt ? <CheckCircle2 className="h-5 w-5 text-good" /> : <Circle className="h-5 w-5 text-ink-faint" />}
                      <span className={clsx("font-semibold", m.doneAt && "text-ink-muted line-through")}>{m.title}</span>
                    </span>
                    <span className="flex items-center gap-1 text-xs text-ink-muted">{m.doneAt ? `أُنجزت ${fmtDate(m.doneAt)}` : m.plannedDate ? fmtDate(m.plannedDate) : ""}{site && <ConfirmButton action={deleteMilestone.bind(null, m.id)} confirm="حذف المرحلة؟" title="حذف"><Trash2 className="h-3.5 w-3.5" /></ConfirmButton>}</span>
                  </li>
                ))}
                {!p.milestones.length && <li className="text-sm text-ink-muted">لا مراحل بعد.</li>}
              </ul>
              {site && (
                <ModalForm triggerClass="btn-secondary btn-sm mt-3" trigger={<><Plus className="h-4 w-4" /> مرحلة</>} title="مرحلة جديدة" action={addMilestone.bind(null, p.id)}>
                  <Grid><Input name="title" label="المرحلة" required placeholder="صب عقدة السطح" /><Input name="plannedDate" label="الموعد المخطط" type="date" /></Grid>
                </ModalForm>
              )}
            </Card>
            <Card className="lg:col-span-2" title="سجل الموقع الأسبوعي (صور وفيديو للمشترين والمغتربين)">
              {site && (
                <ModalForm triggerClass="btn-primary btn-sm mb-4" trigger={<><Plus className="h-4 w-4" /> نشر تحديث</>} title="تحديث جديد للمشترين" action={postUpdate.bind(null, p.id)} wide>
                  <Input name="title" label="العنوان" required placeholder="الأسبوع 12: صب أعمدة الطابق الأول" />
                  <Textarea name="body" label="التفاصيل" rows={4} required />
                  <FileInput label="صور وفيديو من الموقع" />
                </ModalForm>
              )}
              <ul className="space-y-4">
                {p.updates.map((u) => (
                  <li key={u.id} className="rounded-2xl bg-black/[0.03] p-4">
                    <p className="font-black text-navy">{u.title}</p>
                    <p className="text-xs text-ink-muted">{u.createdBy} — {fmtDate(u.createdAt)}</p>
                    <p className="mt-2 whitespace-pre-line text-sm leading-7">{u.body}</p>
                    <div className="mt-2"><AttachmentList items={files.filter((f) => f.entityId === u.id)} /></div>
                  </li>
                ))}
                {!p.updates.length && <li className="text-sm text-ink-muted">لا تحديثات بعد.</li>}
              </ul>
            </Card>
          </div>
        )}

        {tab === "tasks" && (
          <Card title="شو عندك — دفعات وموافقات واختيارات وبنود تسليم">
            {site && (
              <ModalForm triggerClass="btn-primary btn-sm mb-4" trigger={<><Plus className="h-4 w-4" /> بند جديد</>} title="بند جديد في «شو عندك»" action={addTask.bind(null, p.id)}>
                <Grid>
                  <Select name="kind" label="النوع" options={TASK_KIND} defaultValue="SIGNOFF" />
                  <Select name="buyerId" label="لمن" placeholder="— كل المشترين —" options={active.map((b) => ({ value: b.id, label: `${b.name} — ${b.unit.unitCode}` }))} />
                </Grid>
                <Input name="title" label="العنوان" required placeholder="اعتماد لون الدهان / الدفعة الثانية" />
                <Textarea name="details" label="التفاصيل" rows={2} />
                <Grid><Input name="amount" label="المبلغ (للدفعات)" type="number" /><Input name="dueDate" label="الموعد" type="date" /></Grid>
              </ModalForm>
            )}
            <ul className="divide-y divide-black/5">
              {p.tasks.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <span className="min-w-0">
                    <span className="flex items-center gap-2 font-bold">{t.status === "DONE" ? <BadgeCheck className="h-5 w-5 text-good" /> : <Circle className="h-5 w-5 text-warn" />}{t.title}</span>
                    <span className="block text-xs text-ink-muted">{TASK_KIND[t.kind]} — {t.buyer?.name ?? "كل المشترين"}{t.amount ? ` — ${t.amount} د.أ` : ""}{t.dueDate ? ` — قبل ${fmtDate(t.dueDate)}` : ""}{t.signedName ? ` — وافق: ${t.signedName} ${fmtDate(t.signedAt)}` : ""}</span>
                  </span>
                  {site && t.status === "OPEN" && <ConfirmButton action={completeTask.bind(null, t.id)} confirm={`إغلاق «${t.title}»؟`} className="btn-secondary btn-sm">تم</ConfirmButton>}
                </li>
              ))}
              {!p.tasks.length && <li className="py-3 text-sm text-ink-muted">لا بنود.</li>}
            </ul>
          </Card>
        )}

        {tab === "log" && (
          <Card title="سجل الأحداث (تدقيق كامل)">
            <ul className="space-y-2.5">
              {p.events.map((e) => (
                <li key={e.id} className="text-sm">
                  <span className="font-semibold">{e.note}</span>
                  <span className="block text-xs text-ink-muted">{e.actor} — {fmtDate(e.createdAt)} {e.createdAt.toISOString().slice(11, 16)} · {e.action}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </TabPanel>
    </>
  );
}

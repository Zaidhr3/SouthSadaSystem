import Link from "next/link";
import clsx from "clsx";
import { EyeOff, Facebook, Heart, Instagram, MessageCircle, Rocket, Share2, Trash2, Wand2 } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { can, see } from "@/lib/permissions";
import { VERDICT, type Metrics } from "@/lib/social";
import { adsConfig, mergeAudiences, metaAdAccounts, type Audience, type AudienceRow, type BoostAdvice } from "@/lib/boost";
import { metaCan } from "@/lib/meta";
import { Badge, Card, PageHeader } from "@/components/ui";
import { ActionForm, Input, Select } from "@/components/forms";
import { adviseBoost, decidePost, launchBoost, pickAdAccountAction, refreshAccounts, refreshAudienceAction, saveAdsAction } from "../../actions/social";

export const metadata = { title: "حساباتي — فيسبوك وإنستغرام" };
export const maxDuration = 300;
export const dynamic = "force-dynamic";

function AudBars({ title, rows, total }: { title: string; rows: AudienceRow[]; total: number }) {
  return (
    <div>
      <p className="mb-2 text-sm font-black text-navy">{title}</p>
      {rows.length === 0 ? <p className="text-xs text-ink-muted">لا بيانات</p> : (
        <ul className="space-y-1.5">
          {rows.slice(0, 8).map((r) => {
            const pct = total ? (r.reach / total) * 100 : 0;
            return (
              <li key={r.k} className="text-[13px]">
                <div className="flex justify-between gap-2"><span className="font-semibold">{r.k}</span><span className="num text-ink-muted">{pct.toFixed(0)}% · {r.clicks} نقرة</span></div>
                <div className="mt-0.5 h-2 overflow-hidden rounded-full bg-black/[0.06]"><div className="bar-grow h-full rounded-full bg-gradient-to-l from-accent to-gold" style={{ width: `${Math.max(2, pct)}%` }} /></div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default async function AccountsPage({ searchParams }: { searchParams: { f?: string; p?: string } }) {
  const user = await requireUser(see.marketing);
  const manage = can.manageMarketing(user.role);
  const admin = user.role === "ADMIN";
  const filter = searchParams.f && searchParams.f in VERDICT ? searchParams.f : undefined;
  const platform = searchParams.p === "FB" || searchParams.p === "IG" ? searchParams.p : undefined;
  const [posts, all, ads, drafts] = await Promise.all([
    db.socialPost.findMany({ where: { gone: false, ...(filter ? { verdict: filter, decision: null } : {}), ...(platform ? { platform } : {}) }, orderBy: { postedAt: "desc" }, take: 120 }),
    db.socialPost.findMany({ where: { gone: false }, select: { platform: true, verdict: true, decision: true, metrics: true, fetchedAt: true } }),
    adsConfig(),
    db.adBoost.findMany({ orderBy: { id: "desc" }, take: 200 }),
  ]);
  const metaAccounts = admin && (await metaCan("ads")) ? await metaAdAccounts() : [];
  const lastBoost = new Map<string, (typeof drafts)[number]>();
  drafts.forEach((d) => !lastBoost.has(d.postId) && lastBoost.set(d.postId, d));
  const cnt = (v: string) => all.filter((p) => p.verdict === v && !p.decision).length;
  const plat = (pf: string) => all.filter((p) => p.platform === pf);
  const avg = (pf: string) => {
    const xs = plat(pf).map((p) => (p.metrics as Metrics | null)?.engagement ?? 0);
    return xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1) : "0";
  };
  const fetched = all.reduce<Date | null>((a, p) => (!a || p.fetchedAt > a ? p.fetchedAt : a), null);
  const q = (o: Record<string, string | undefined>) => {
    const s = new URLSearchParams(Object.entries({ f: filter, p: platform, ...o }).filter(([, v]) => v) as [string, string][]).toString();
    return `/marketing/accounts${s ? `?${s}` : ""}`;
  };
  return (
    <>
      <PageHeader
        back={{ href: "/marketing", label: "التسويق" }}
        title="حساباتي — فيسبوك وإنستغرام"
        subtitle={`كل منشور بأرقامه وحكم المحلل الذكي: يبقى، يُحسّن، يُخفى، يُحذف، أو يستحق التمويل.${fetched ? ` آخر تحديث ${fetched.toLocaleString("en-GB", { timeZone: "Asia/Amman" })}` : ""}`}
        actions={
          manage && (
            <ActionForm action={refreshAccounts} submitLabel="تحديث وتحليل">
              <span />
            </ActionForm>
          )
        }
      />
      {(() => {
        const aud = mergeAudiences(drafts.map((d) => d.audience as unknown as Audience | null).filter((a): a is Audience => !!a));
        const funded = drafts.filter((d) => d.adId).length;
        if (!funded && !aud) return null;
        const top = aud?.region[0];
        const topAge = aud?.age[0];
        const topGender = aud?.gender[0];
        return (
          <Card className="mb-4" title={<span className="flex items-center gap-2"><Rocket className="h-5 w-5 text-accent" /> من استقطبت إعلاناتك الممولة</span>} action={manage && <ActionForm action={refreshAudienceAction} submitLabel="حدّث من Meta" draft={false}><span /></ActionForm>}>
            {!aud ? (
              <p className="text-sm text-ink-muted">لديك {funded} إعلانات ممولة — اضغط «حدّث من Meta» لمعرفة الأعمار والجنس والمحافظات التي وصلت لها.</p>
            ) : (
              <>
                <p className="mb-4 rounded-2xl bg-gold-soft p-3 text-sm font-bold leading-7 text-navy">
                  وصلت إعلاناتك إلى <span className="num">{aud.reach.toLocaleString("en-US")}</span> شخص ({aud.clicks.toLocaleString("en-US")} نقرة، إنفاق <span className="num">{aud.spend.toFixed(2)}</span>).
                  {top && <> أكثر جمهور من <b>{top.k}</b></>}{topAge && <>، وأكثر فئة عمرية <b className="num">{topAge.k}</b></>}{topGender && <> و<b>{topGender.k}</b> هم الأغلبية</>}.
                </p>
                <div className="grid gap-5 md:grid-cols-3">
                  <AudBars title="المحافظات" rows={aud.region} total={aud.reach} />
                  <AudBars title="الفئات العمرية" rows={aud.age} total={aud.reach} />
                  <AudBars title="الجنس" rows={aud.gender} total={aud.reach} />
                </div>
                <p className="mt-3 text-xs text-ink-muted">آخر تحديث {new Date(aud.at).toLocaleString("en-GB", { timeZone: "Asia/Amman" })} — استخدمها لتوجيه الإعلان القادم للجمهور الذي تفاعل فعلاً.</p>
              </>
            )}
          </Card>
        );
      })()}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card className="!p-4">
          <p className="flex items-center gap-2 text-sm font-bold text-[#1877f2]"><Facebook className="h-4 w-4" /> فيسبوك</p>
          <p className="mt-1 text-2xl font-black">{plat("FB").length} <span className="text-sm font-semibold text-ink-muted">منشور</span></p>
          <p className="text-xs text-ink-muted">متوسط التفاعل {avg("FB")}</p>
        </Card>
        <Card className="!p-4">
          <p className="flex items-center gap-2 text-sm font-bold text-[#d6249f]"><Instagram className="h-4 w-4" /> إنستغرام</p>
          <p className="mt-1 text-2xl font-black">{plat("IG").length} <span className="text-sm font-semibold text-ink-muted">منشور</span></p>
          <p className="text-xs text-ink-muted">متوسط التفاعل {avg("IG")}</p>
        </Card>
        <Card className="!p-4 lg:col-span-2">
          <p className="mb-2 text-sm font-bold">بانتظار قرارك</p>
          <div className="flex flex-wrap gap-1.5">
            <Link href={q({ f: undefined })} className={clsx("rounded-full px-3 py-1 text-xs font-bold", !filter ? "bg-navy text-white" : "bg-black/[0.05]")}>الكل</Link>
            {Object.entries(VERDICT).map(([k, v]) => (
              <Link key={k} href={q({ f: k })} className={clsx("rounded-full px-3 py-1 text-xs font-bold", filter === k ? "bg-navy text-white" : "bg-black/[0.05]")}>
                {v.label} {cnt(k)}
              </Link>
            ))}
          </div>
        </Card>
      </div>
      <nav className="mb-4 flex gap-1 rounded-2xl bg-black/[0.04] p-1 text-sm font-bold">
        {[["", "المنصتان"], ["FB", "فيسبوك"], ["IG", "إنستغرام"]].map(([k, l]) => (
          <Link key={k} href={q({ p: k || undefined })} className={clsx("rounded-xl px-3 py-1.5", (platform ?? "") === k ? "bg-white text-accent shadow-card" : "text-ink-muted")}>{l}</Link>
        ))}
      </nav>

      {!all.length ? (
        <Card><p className="py-10 text-center text-sm text-ink-muted">اضغط «تحديث وتحليل» لسحب منشورات الحسابين وتحليلها</p></Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {posts.map((p) => {
            const m = (p.metrics as Metrics | null) ?? { likes: 0, comments: 0, shares: 0, engagement: 0 };
            const v = p.verdict ? VERDICT[p.verdict] : null;
            const b = lastBoost.get(p.id);
            const advice = b?.analysis ? (JSON.parse(b.analysis) as BoostAdvice) : null;
            return (
              <div key={p.id} className="card flex flex-col overflow-hidden">
                <a href={p.permalink ?? "#"} target="_blank" rel="noreferrer" className="relative block aspect-[4/3] bg-canvas">
                  {p.picture ? <img src={p.picture} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover" /> : <span className="grid h-full place-items-center p-4 text-center text-sm text-ink-muted">{p.text?.slice(0, 120)}</span>}
                  <span className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-bold">
                    {p.platform === "FB" ? <Facebook className="h-3.5 w-3.5 text-[#1877f2]" /> : <Instagram className="h-3.5 w-3.5 text-[#d6249f]" />}
                    {p.mediaType === "REEL" ? "ريل" : p.mediaType === "VIDEO" ? "فيديو" : p.mediaType === "CAROUSEL" ? "ألبوم" : "صورة"} · {p.postedAt.toISOString().slice(0, 10)}
                  </span>
                  {v && <span className="absolute bottom-2 left-2"><Badge tone={v.tone}>{v.label}</Badge></span>}
                </a>
                <div className="flex flex-1 flex-col gap-2 p-3 text-sm">
                  <div className="flex items-center gap-3 text-xs text-ink-muted">
                    <span className="flex items-center gap-1"><Heart className="h-3.5 w-3.5" /> {m.likes}</span>
                    <span className="flex items-center gap-1"><MessageCircle className="h-3.5 w-3.5" /> {m.comments}</span>
                    {p.platform === "FB" && <span className="flex items-center gap-1"><Share2 className="h-3.5 w-3.5" /> {m.shares}</span>}
                    {m.reach != null && <span title="الوصول">👁 {m.reach}</span>}
                    {m.views != null && <span title="المشاهدات">▶ {m.views}</span>}
                    {m.saves != null && <span title="الحفظ">🔖 {m.saves}</span>}
                    {p.boostScore != null && (
                      <span className="ms-auto flex items-center gap-1" title="جدارة التمويل">
                        <Rocket className="h-3.5 w-3.5 text-accent" />
                        <span className="h-1.5 w-14 overflow-hidden rounded-full bg-black/10"><span className="block h-full rounded-full bg-accent" style={{ width: `${p.boostScore}%` }} /></span>
                        {p.boostScore}
                      </span>
                    )}
                  </div>
                  <p className="line-clamp-2 text-xs text-ink-soft">{p.text ?? "— بلا نص —"}</p>
                  {p.reason && <p className="rounded-xl bg-black/[0.03] p-2 text-xs leading-5 text-ink-soft">{p.reason}</p>}
                  {advice && (
                    <p className={clsx("rounded-xl p-2 text-xs leading-5", advice.worth ? "bg-accent-soft text-accent" : "bg-black/[0.03] text-ink-muted")}>
                      <b>مستشار التمويل ({advice.score}/100):</b> {advice.summary} {advice.worth && `— مقترح: ${advice.suggestedDaily} يومياً × ${advice.suggestedDays} أيام · ${advice.audience}`}
                    </p>
                  )}
                  {b && b.status !== "DRAFT" && <Badge tone={b.status === "ACTIVE" ? "green" : b.status === "FAILED" ? "red" : "gray"}>تمويل: {b.status === "ACTIVE" ? "نشط" : b.status === "FAILED" ? "فشل" : b.status}</Badge>}
                  {manage && !p.decision && (
                    <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
                      {(p.verdict === "DELETE" || p.verdict === "HIDE") && (
                        <ActionForm action={decidePost.bind(null, p.id, "DELETE")} submitLabel="احذفه">
                          <span />
                        </ActionForm>
                      )}
                      {p.verdict === "HIDE" && p.platform === "FB" && (
                        <ActionForm action={decidePost.bind(null, p.id, "HIDE")} submitLabel="أخفِه">
                          <span />
                        </ActionForm>
                      )}
                      {p.verdict === "IMPROVE" && <Link href="/marketing/relaunch" className="btn-secondary btn-sm"><Wand2 className="h-4 w-4" /> أعد إطلاقه</Link>}
                      <ActionForm action={adviseBoost.bind(null, p.id)} submitLabel="هل يستحق التمويل؟">
                        <span />
                      </ActionForm>
                      {p.verdict && p.verdict !== "KEEP" && (
                        <ActionForm action={decidePost.bind(null, p.id, "IGNORE")} submitLabel="تجاهل الحكم">
                          <span />
                        </ActionForm>
                      )}
                    </div>
                  )}
                  {admin && advice?.worth && ads && !p.decision && (
                    <details className="rounded-xl border border-accent/30 p-2 text-xs">
                      <summary className="cursor-pointer font-bold text-accent"><Rocket className="me-1 inline h-3.5 w-3.5" /> موّل هذا المنشور</summary>
                      <ActionForm action={launchBoost.bind(null, p.id)} submitLabel="ابدأ التمويل">
                        <div className="grid grid-cols-2 gap-2">
                          <Input name="daily" label={`يومياً (${ads.currency ?? ""})`} type="number" step="0.5" min="1" defaultValue={String(advice.suggestedDaily)} required />
                          <Input name="days" label="عدد الأيام" type="number" min="1" max="30" defaultValue={String(advice.suggestedDays)} required />
                        </div>
                        <label className="flex items-center gap-2 font-semibold"><input type="checkbox" name="confirm" className="h-4 w-4 accent-[#e8590c]" /> أوافق على صرف المبلغ من الحساب الإعلاني</label>
                      </ActionForm>
                    </details>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {admin && (
        <Card className="mt-6" title={<span className="flex items-center gap-2"><Rocket className="h-5 w-5 text-accent" /> إعداد التمويل الإعلاني</span>}>
          {ads ? <p className="mb-3 text-sm">الحساب الإعلاني مربوط: <b dir="ltr">{ads.adAccountId}</b> — السقف الشهري <b>{ads.monthlyCap} {ads.currency}</b></p> : <p className="mb-3 text-sm text-ink-muted">لتفعيل التمويل من النظام: أنشئ رمزاً بصلاحية <code dir="ltr">ads_management</code> من Graph API Explorer، وانسخ رقم الحساب الإعلاني من Ads Manager.</p>}
          {metaAccounts.length > 0 && (
            <div className="mb-4 rounded-2xl bg-good-soft/50 p-3">
              <p className="mb-2 text-sm font-bold text-good">ربط فيسبوك يملك صلاحيات الإعلانات — اختر الحساب الإعلاني مباشرة (بلا رمز منفصل)</p>
              <ActionForm action={pickAdAccountAction} submitLabel="استخدم هذا الحساب">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Select name="account" label="الحساب الإعلاني" options={metaAccounts.map((a) => ({ value: a.id, label: `${a.name} (${a.currency})${a.active ? "" : " — غير فعّال"}` }))} defaultValue={ads?.adAccountId ?? metaAccounts.find((a) => a.active)?.id} />
                  <Input name="cap" label="السقف الشهري" type="number" min="1" defaultValue={String(ads?.monthlyCap ?? 100)} required />
                </div>
              </ActionForm>
            </div>
          )}
          <ActionForm action={saveAdsAction} submitLabel={ads ? "تحديث" : "ربط الحساب الإعلاني"}>
            <div className="grid gap-3 sm:grid-cols-3">
              <Input name="token" label="رمز الإعلانات" type="password" dir="ltr" autoComplete="off" required />
              <Input name="account" label="رقم الحساب الإعلاني" dir="ltr" placeholder="act_123456789" required />
              <Input name="cap" label="السقف الشهري" type="number" min="1" defaultValue={String(ads?.monthlyCap ?? 100)} required />
            </div>
          </ActionForm>
          <p className="mt-2 flex items-center gap-1 text-xs text-ink-faint"><EyeOff className="h-3.5 w-3.5" /> يُشفّر ولا يظهر مجدداً. لا تُصرف أي أموال دون ضغطك «ابدأ التمويل» مع تأكيد الموافقة، وضمن السقف.</p>
          <p className="mt-1 flex items-center gap-1 text-xs text-ink-faint"><Trash2 className="h-3.5 w-3.5" /> حذف منشور من فيسبوك نهائي. إنستغرام قد يرفض الحذف عبر API — عندها يظهر رابط المنشور لأرشفته من التطبيق.</p>
        </Card>
      )}
    </>
  );
}

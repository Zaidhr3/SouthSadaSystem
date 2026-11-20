import { notFound } from "next/navigation";
import { Bot, CheckCircle2, Download, Facebook, Instagram, Send, Trash2, XCircle } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { can, see } from "@/lib/permissions";
import { MKT_CATEGORY, MKT_KIND, MKT_STATUS } from "@/lib/marketing";
import { fetchComments, metaStatus } from "@/lib/meta";
import { CommentThread } from "../comment-thread";
import { retryPublish } from "../../actions/marketing";
import { fmtDate, toInputDate } from "@/lib/format";
import { Badge, Card, PageHeader, StatusBadge } from "@/components/ui";
import { ActionForm, ConfirmButton, FileInput, Grid, Input, ModalForm, Select, Textarea } from "@/components/forms";
import { CopyButton } from "@/components/copy-button";
import { applyCaption, approveAndPublish, autoClean, chatOnItem, deleteItem, runSkillAction, saveItem, setItemStatus } from "../../actions/marketing";
import { CHECK_LABEL, detect, structuralFlags, VERDICT, type CheckName } from "@/lib/content-skills/humanizer";
import { SKILLS } from "@/lib/content-skills/skills";
import { SkillRunner } from "../skill-runner";
import { CalendarClock, Fingerprint, MessagesSquare, Mic, Palette, Sparkles } from "lucide-react";
import { composeAction, importCanva, pushToCanva, smartComposeAction } from "../../actions/design";
import { TEMPLATES, type TemplateId } from "@/lib/design/templates";
import { canvaStatus, listDesigns } from "@/lib/canva";
import { servicesStatus, voices as elVoices } from "@/lib/ai-services";
import { voiceoverAction } from "../../actions/ai-services";

export const metadata = { title: "محتوى تسويقي" };
/** توليد التصاميم بالمتصفح + النشر (كاروسيل) قد يستغرقان دقيقة */
export const maxDuration = 120;

type Msg = { role: "user" | "assistant"; text: string; at: string; by?: string };

export default async function MarketingItemPage({ params }: { params: { id: string } }) {
  const user = await requireUser(see.marketing);
  const manage = can.manageMarketing(user.role);
  const id = Number(params.id);
  const it = await db.marketingItem.findUnique({ where: { id } });
  if (!it) notFound();
  const chat = (Array.isArray(it.chat) ? it.chat : []) as Msg[];
  const meta = await metaStatus();
  const audit = it.source === "AUDIT_FB" || it.source === "AUDIT_IG";
  const [assets, slides, canva] = await Promise.all([
    db.mediaAsset.findMany({ orderBy: [{ usageCount: "asc" }, { id: "desc" }], take: 120 }),
    db.attachment.findMany({ where: { entityType: "marketing", entityId: id, slot: { startsWith: "slide:" } }, select: { id: true, slot: true } }),
    canvaStatus(),
  ]);
  slides.sort((a, b) => Number(a.slot!.slice(6)) - Number(b.slot!.slice(6)));
  const canvaDesigns = canva.connected ? await listDesigns(8).catch(() => []) : [];
  const voiceOn = (await servicesStatus()).elevenlabs;
  const [voiceList, voiceAtt] = await Promise.all([voiceOn ? elVoices().catch(() => []) : [], db.attachment.findFirst({ where: { entityType: "marketing", entityId: id, slot: "voice" }, orderBy: { id: "desc" } })]);
  const chosen: number[] = it.mediaIds ? (JSON.parse(it.mediaIds).ids ?? []) : [];
  // متصل فعلياً للنشر: الرمز سليم ويملك صلاحية النشر
  const connected = !!meta?.configured && meta.ok && !meta.missingScopes?.includes("pages_manage_posts");
  // التعليقات الحية من فيسبوك وإنستغرام (للمنشورات المنشورة عبر النظام)
  const live = it.status === "PUBLISHED" && (it.fbPostId || it.igMediaId) && connected ? await fetchComments(it).catch((e) => ({ comments: [], errors: [e instanceof Error ? e.message : "تعذر جلب التعليقات"] })) : null;
  const full = [it.caption, it.hashtags].filter(Boolean).join("\n\n");
  const editable = manage && it.status !== "PUBLISHED";
  // لوحة البصمة البشرية (مهارة li-human): خمسة فحوص + الأنماط البنيوية الموسومة
  const det = detect(it.caption);
  const flags = structuralFlags(it.caption);

  return (
    <>
      <PageHeader
        back={{ href: "/marketing", label: "التسويق" }}
        title={it.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge map={MKT_KIND} value={it.kind} />
            <StatusBadge map={MKT_STATUS} value={it.status} />
            <span>{MKT_CATEGORY[it.category]}</span>
            {it.scheduledFor && <span>الموعد: {fmtDate(it.scheduledFor)}</span>}
            {it.aiModel && <Badge tone="gray">{it.aiModel}</Badge>}
          </span>
        }
        actions={
          manage && (
            <>
              {!audit && !["PUBLISHED", "FAILED"].includes(it.status) && !(it.status === "APPROVED" && it.publishAt) && (
                <ActionForm action={approveAndPublish.bind(null, id)} submitLabel={connected ? "اعتماد ونشر الآن" : "اعتماد"}>
                  <span />
                </ActionForm>
              )}
              {!audit && connected && !["PUBLISHED", "FAILED"].includes(it.status) && (
                <ModalForm title="اعتماد ونشر في موعد" trigger={<><CalendarClock className="h-4 w-4" /> جدولة</>} triggerClass="btn-secondary" action={approveAndPublish.bind(null, id)} submitLabel="اعتماد وجدولة">
                  <input type="hidden" name="mode" value="schedule" />
                  <Input name="publishAt" label="تاريخ النشر" type="date" required defaultValue={toInputDate(it.publishAt ?? it.scheduledFor)} hint="يُنشر تلقائياً صباح ذلك اليوم (حوالي 8:00) مع المهمة اليومية" />
                </ModalForm>
              )}
              {!audit && it.status === "FAILED" && connected && (
                <ActionForm action={retryPublish.bind(null, id)} submitLabel="إعادة محاولة النشر">
                  <span />
                </ActionForm>
              )}
              {it.status === "APPROVED" && it.publishAt && <Badge tone="blue">مجدول: {fmtDate(it.publishAt)}</Badge>}
              {(it.status === "APPROVED" || (audit && it.status !== "PUBLISHED")) && (
                <ConfirmButton action={setItemStatus.bind(null, id, "PUBLISHED")} confirm={audit ? "تأكيد أنك عدّلت النص على المنصة يدوياً؟" : "تأكيد أنك نشرته يدوياً على الصفحات؟"} className="btn-secondary">
                  <CheckCircle2 className="h-4 w-4" /> {audit ? "تم التعديل يدوياً" : "تم النشر يدوياً"}
                </ConfirmButton>
              )}
              {!["PUBLISHED", "REJECTED"].includes(it.status) && (
                <ConfirmButton action={setItemStatus.bind(null, id, "REJECTED")} confirm="رفض هذا المقترح؟" className="btn-secondary">
                  <XCircle className="h-4 w-4" /> رفض
                </ConfirmButton>
              )}
              <ConfirmButton action={deleteItem.bind(null, id)} confirm="حذف العنصر نهائياً؟" className="btn-danger" redirectTo="/marketing" title="حذف">
                <Trash2 className="h-4 w-4" />
              </ConfirmButton>
            </>
          )
        }
      />

      {audit && (
        <Card className="mb-5" title={it.source === "AUDIT_FB" ? "مراجعة منشور فيسبوك قائم" : "مراجعة منشور إنستغرام قائم"} action={it.status === "PUBLISHED" ? <Badge tone="green">تم</Badge> : (
          <span className="flex flex-wrap gap-2">
            <CopyButton text={it.caption} label="نسخ الصياغة" />
            {it.publishLog?.startsWith("http") && <a href={it.publishLog.split(/\r?\n/)[0]} target="_blank" rel="noopener" className="btn-secondary btn-sm">فتح المنشور للتعديل</a>}
          </span>
        )}>
          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <p className="mb-1 text-xs font-bold text-ink-muted">النص الحالي على المنصة — بصمة {detect(it.idea ?? "").overall}/100</p>
              <p className="whitespace-pre-wrap rounded-xl bg-canvas p-3 text-sm leading-7">{it.idea}</p>
            </div>
            <div>
              <p className="mb-1 text-xs font-bold text-accent">الصياغة المقترحة — بصمة {det.overall}/100 (عدّلها من «التحرير اليدوي» أو بالمحادثة)</p>
              <p className="whitespace-pre-wrap rounded-xl bg-accent-soft/50 p-3 text-sm leading-7">{it.caption}</p>
            </div>
          </div>
          {it.status !== "PUBLISHED" && <p className="mt-3 text-xs text-ink-muted">{it.source === "AUDIT_FB" ? "فيسبوك لا يسمح بتعديل منشورات نُشرت من خارج النظام عبر الواجهة البرمجية" : "إنستغرام لا يسمح بتعديل نص المنشور برمجياً"}: انسخ الصياغة، افتح المنشور وعدّله (⋯ ← تعديل المنشور)، ثم اضغط «تم النشر يدوياً». المنشورات الجديدة التي تُنشر من النظام تُدار بالكامل من هنا.</p>}
        </Card>
      )}
      {it.publishLog && <p className={`mb-5 whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm font-semibold ${it.status === "FAILED" ? "bg-bad-soft text-bad" : "bg-good-soft text-good"}`}>{it.publishLog}</p>}

      <div className="grid gap-5 xl:grid-cols-5">
        {/* معاينة كما ستظهر */}
        <div className="space-y-5 xl:col-span-2">
          <Card title="المعاينة" action={<CopyButton text={full} />}>
            {it.kind === "STORY" ? (
              <div className="mx-auto aspect-[9/16] w-full max-w-[280px] overflow-hidden rounded-[28px] p-5 text-white shadow-pop" style={{ background: it.imageAttachmentId ? `linear-gradient(to top, rgba(11,37,69,.85), transparent 55%), url(/api/files/${it.imageAttachmentId}) center/cover` : "linear-gradient(160deg,#0b2545,#1d4e89 60%,#e8590c)" }}>
                <div className="flex h-full flex-col justify-end">
                  <p className="text-2xl font-black leading-snug drop-shadow">{it.storyText || it.title}</p>
                  <p className="mt-2 text-xs text-white/80">صدى الجنوب للمقاولات</p>
                </div>
              </div>
            ) : (
              <div className="overflow-hidden rounded-2xl border border-line">
                <div className="flex items-center gap-2 p-3">
                  <span className="grid h-9 w-9 place-items-center rounded-full bg-navy text-xs font-black text-gold">ص</span>
                  <span className="text-sm font-bold">صدى الجنوب للمقاولات</span>
                </div>
                {it.imageAttachmentId && <img src={`/api/files/${it.imageAttachmentId}`} alt="" className="aspect-square w-full object-cover" />}
                <p className="whitespace-pre-wrap p-3 text-[15px] leading-7">{it.caption}</p>
                {it.hashtags && <p className="px-3 pb-3 text-sm text-navy-3">{it.hashtags}</p>}
              </div>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              {it.imageAttachmentId && <a href={`/api/files/${it.imageAttachmentId}`} download className="btn-secondary btn-sm"><Download className="h-4 w-4" /> تنزيل الصورة</a>}
              <a href="https://www.facebook.com/sadaaljanoob8" target="_blank" className="btn-ghost btn-sm"><Facebook className="h-4 w-4" /> الصفحة</a>
              <a href="https://www.instagram.com/sada_aljanoob/" target="_blank" className="btn-ghost btn-sm"><Instagram className="h-4 w-4" /> الحساب</a>
            </div>
          </Card>
          <Card
            title={<span className="flex items-center gap-2"><Fingerprint className="h-5 w-5 text-navy-3" /> البصمة البشرية</span>}
            action={<Badge tone={VERDICT[det.verdict].tone}>{det.overall}/100 — {VERDICT[det.verdict].label}</Badge>}
          >
            <ul className="space-y-2.5">
              {(Object.keys(det.checks) as CheckName[]).map((k) => (
                <li key={k} title={CHECK_LABEL[k].hint}>
                  <div className="flex items-center justify-between text-sm"><span className="font-semibold">{CHECK_LABEL[k].label}</span><span className="num font-bold">{det.checks[k].score}</span></div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-canvas"><div className={det.checks[k].score >= 70 ? "h-full bg-good" : det.checks[k].score >= 50 ? "h-full bg-gold" : "h-full bg-bad"} style={{ width: `${det.checks[k].score}%` }} /></div>
                  <p className="mt-0.5 text-[11px] text-ink-muted">{det.checks[k].detail}</p>
                </li>
              ))}
            </ul>
            {det.verdict !== "PASS" && <p className="mt-3 text-xs font-semibold text-warn">أضعف إشارة: {CHECK_LABEL[det.weakest].label} — ابدأ بإصلاحها.</p>}
            {flags.length > 0 && (
              <ul className="mt-3 space-y-1.5 rounded-xl bg-warn-soft/60 p-3 text-xs">
                {flags.map((f) => (
                  <li key={f.id}><b>{f.name}</b>: «{f.sample}» — {f.fix}</li>
                ))}
              </ul>
            )}
            {editable && (
              <div className="mt-3">
                <ConfirmButton action={autoClean.bind(null, id)} confirm="تنظيف آلي: حذف المحارف الخفية والشرطات الطويلة واستبدال العبارات الجاهزة؟" className="btn-secondary btn-sm">تنظيف آلي</ConfirmButton>
              </div>
            )}
            <p className="mt-3 text-[11px] text-ink-faint">مؤشرات محلية تقريبية (من مهارة li-human) — ليست أداة كشف تجارية ولا تَعِد بنتيجتها.</p>
          </Card>
          {it.visualBrief && (
            <Card title="توجيه التصميم والتصوير">
              <p className="whitespace-pre-wrap text-sm leading-7 text-ink-soft">{it.visualBrief}</p>
            </Card>
          )}
        </div>

        <div className="space-y-5 xl:col-span-3">
          <Card title={<span className="flex items-center gap-2"><Bot className="h-5 w-5 text-accent" /> المحادثة مع الكاتب الذكي</span>}>
            <div className="mb-4 max-h-[340px] space-y-3 overflow-y-auto">
              {chat.length === 0 && <p className="text-sm text-ink-muted">اطلب أي تعديل: «خليها أقصر»، «أضف لمسة وطنية»، «غيّر الافتتاحية»، «اكتبها بلهجة أردنية»، «اقترح صورة أقوى»…</p>}
              {chat.map((m, i) => (
                <div key={i} className={m.role === "user" ? "me-10 rounded-2xl rounded-ss-sm bg-navy/[0.06] p-3" : "ms-10 rounded-2xl rounded-se-sm bg-accent-soft p-3"}>
                  <p className="text-xs font-bold text-ink-muted">{m.role === "user" ? m.by ?? "أنت" : "الكاتب الذكي"}</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm">{m.text}</p>
                </div>
              ))}
            </div>
            {editable && (
              <ActionForm action={chatOnItem.bind(null, id)} submitLabel="أرسل" resetOnSuccess>
                <Textarea name="message" label="طلبك" rows={2} required />
              </ActionForm>
            )}
          </Card>

          {editable && !audit && (
            <Card title={<span className="flex items-center gap-2"><Palette className="h-5 w-5 text-accent" /> التصميم</span>} action={it.template && <Badge tone="purple">{it.template === "canva" ? "Canva" : TEMPLATES[it.template as TemplateId]?.name}</Badge>}>
              {slides.length > 0 && (
                <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
                  {slides.map((sl, i) => (
                    <a key={sl.id} href={`/api/files/${sl.id}`} target="_blank" className="shrink-0"><img src={`/api/files/${sl.id}`} alt={`شريحة ${i + 1}`} className={it.kind === "STORY" ? "h-48 rounded-xl border border-line" : "h-40 rounded-xl border border-line"} /></a>
                  ))}
                </div>
              )}
              <div className="mb-4 rounded-2xl border border-accent/25 bg-accent-soft/40 p-3">
                <p className="mb-2 text-sm font-bold text-accent">✦ المصمم الذكي — يختار الصورة الصح من المكتبة أو يرسم شكلاً هندسياً للموضوع (رافعة، جرافة، خزان، مغسلة...) ويختار القالب بما ينوّع الشبكة</p>
                <ActionForm action={smartComposeAction.bind(null, id)} submitLabel="صمّمه أنت">
                  <div className="flex flex-wrap items-end gap-3">
                    <Select name="style" label="أسلوب الرسم" options={[{ value: "line", label: "خطوط هندسية" }, { value: "render", label: "مجسم ثلاثي الأبعاد" }]} defaultValue="line" />
                    <label className="mb-2 flex items-center gap-2 text-sm font-semibold"><input type="checkbox" name="fresh" /> ارسم من جديد (لا تعيد استخدام رسم سابق)</label>
                  </div>
                </ActionForm>
              </div>
              <ActionForm action={composeAction.bind(null, id)} submitLabel={slides.length ? "إعادة التصميم" : "صمّم بالقالب المؤسسي"}>
                <Grid>
                  <Select name="template" label="القالب" options={[{ value: "auto", label: "تلقائي (تناسق شبكة إنستغرام)" }, ...Object.entries(TEMPLATES).map(([value, t]) => ({ value, label: `${t.name} — ${t.photo === "required" ? "بصورة" : t.photo === "none" ? "بلا صورة" : "صورة اختيارية"}` }))]} defaultValue="auto" />
                  <Input name="headline" label="العنوان على التصميم" defaultValue={it.storyText || it.title} hint="من نص المنشور نفسه — لا أرقام جديدة" />
                </Grid>
                <Input name="sub" label="السطر الثاني على التصميم (اختياري)" defaultValue="" hint="اتركه فارغاً لتصميم أنظف" />
                {assets.length === 0 ? (
                  <p className="rounded-xl bg-canvas p-3 text-sm text-ink-muted">مكتبة الوسائط فارغة — <a href="/marketing/media" className="font-bold text-accent">ارفع صور المعدات والمشاريع</a> لدمجها في التصميم.</p>
                ) : (
                  <div>
                    <p className="label">صور من المكتبة (بالترتيب — الأولى للغلاف)</p>
                    <div className="grid max-h-72 grid-cols-4 gap-2 overflow-y-auto sm:grid-cols-6">
                      {assets.map((a) => (
                        <label key={a.id} className="relative cursor-pointer" title={a.title}>
                          <input type="checkbox" name="mediaIds" value={a.id} defaultChecked={chosen.includes(a.id)} className="peer absolute right-1 top-1 z-10" />
                          <img src={`/api/files/${a.attachmentId}`} alt={a.title} loading="lazy" className="aspect-square w-full rounded-lg object-cover ring-accent peer-checked:ring-4" />
                        </label>
                      ))}
                    </div>
                  </div>
                )}
                {it.kind === "POST" && (
                  <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" name="carousel" /> كاروسيل: شريحة لكل صورة مختارة + شريحة ختام بالتواصل</label>
                )}
              </ActionForm>
              {canva.connected ? (
                <div className="mt-4 border-t border-line pt-4">
                  {slides.length > 0 && (
                    <div className="mb-4 rounded-2xl border border-[#7d2ae8]/25 bg-gradient-to-l from-[#7d2ae8]/[0.07] to-[#00c4cc]/[0.07] p-3">
                      <p className="mb-2 text-sm font-bold text-[#5b1fc0]">عدّل التصميم في Canva بنفس المقاس ({it.kind === "STORY" ? "ستوري 1080×1920" : "منشور 1080×1350"}) ثم أرجعه للنظام</p>
                      <div className="flex flex-wrap items-center gap-2">
                        <ActionForm action={pushToCanva.bind(null, id)} submitLabel={it.canvaEditUrl ? "أرسل النسخة الحالية من جديد" : "أرسل إلى Canva"} draft={false}><span /></ActionForm>
                        {it.canvaEditUrl && <a href={it.canvaEditUrl} target="_blank" rel="noopener" className="btn bg-[#7d2ae8] text-white">افتح في Canva ↗</a>}
                        {it.canvaDesignId && (
                          <ActionForm action={importCanva.bind(null, id)} submitLabel="استورد تعديلاتي من Canva" draft={false}>
                            <input type="hidden" name="link" value={it.canvaDesignId} />
                          </ActionForm>
                        )}
                      </div>
                    </div>
                  )}
                  {canvaDesigns.length > 0 && (
                    <div className="mb-3">
                      <p className="label">آخر تصاميمك في Canva — استيراد بضغطة</p>
                      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                        {canvaDesigns.map((d) => (
                          <ActionForm key={d.id} action={importCanva.bind(null, id)} submitLabel={d.title.slice(0, 22)} className="[&_button]:w-full [&_button]:text-xs">
                            <input type="hidden" name="link" value={d.id} />
                            {d.thumb && <img src={d.thumb} alt="" referrerPolicy="no-referrer" className="aspect-[4/5] w-full rounded-lg border border-line object-cover" />}
                          </ActionForm>
                        ))}
                      </div>
                    </div>
                  )}
                  <ActionForm action={importCanva.bind(null, id)} submitLabel="استيراد من Canva">
                    <Input name="link" label="أو استورد تصميماً جاهزاً من Canva" dir="ltr" placeholder="https://www.canva.com/design/…" hint="كل صفحات التصميم تصبح شرائح بالترتيب (JPG 1080)" />
                  </ActionForm>
                </div>
              ) : (
                <p className="mt-3 text-xs text-ink-muted">ربط Canva لاستيراد التصاميم الجاهزة من «إعدادات النظام».</p>
              )}
            </Card>
          )}

          {editable && !audit && (voiceOn || voiceAtt) && (
            <Card title={<span className="flex items-center gap-2"><Mic className="h-5 w-5 text-accent" /> تعليق صوتي للريل/القصة (ElevenLabs)</span>}>
              {voiceAtt && (
                <div className="mb-3 flex flex-wrap items-center gap-3">
                  <audio controls src={`/api/files/${voiceAtt.id}`} className="h-10 max-w-full" />
                  <a href={`/api/files/${voiceAtt.id}`} download={`sada-voice-${id}.mp3`} className="btn-secondary btn-sm">تنزيل MP3</a>
                </div>
              )}
              {voiceOn && (
                <ActionForm action={voiceoverAction.bind(null, id)} submitLabel={voiceAtt ? "إعادة التوليد" : "ولّد التعليق الصوتي"}>
                  <Select name="voice" label="الصوت" options={voiceList.map((v) => ({ value: v.id, label: `${v.name}${v.desc ? ` — ${v.desc}` : ""}` }))} defaultValue={voiceList[0]?.id} />
                  <Textarea name="script" label="نص التعليق (اختياري)" rows={3} placeholder="فارغ = نص الشاشة للقصة أو أول فقرتين من المنشور" />
                </ActionForm>
              )}
            </Card>
          )}

          {editable && (
            <Card title={<span className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-accent" /> مهارات المحتوى</span>}>
              <div className="grid gap-3 sm:grid-cols-2">
                {SKILLS.filter((s) => s.scope === "item").map((s) => (
                  <SkillRunner key={s.id} skill={s} action={runSkillAction.bind(null, s.id, id)} apply={applyCaption.bind(null, id)} />
                ))}
              </div>
            </Card>
          )}

          <Card title="التحرير اليدوي">
            {editable ? (
              <ActionForm action={saveItem.bind(null, id)} submitLabel="حفظ">
                <Grid cols={3}>
                  <Select name="kind" label="النوع" options={[{ value: "POST", label: "منشور دائم" }, { value: "STORY", label: "قصة يومية" }]} defaultValue={it.kind} />
                  <Select name="category" label="التصنيف" options={Object.entries(MKT_CATEGORY).map(([value, label]) => ({ value, label }))} defaultValue={it.category} />
                  <Input name="scheduledFor" label="موعد النشر" type="date" defaultValue={toInputDate(it.scheduledFor)} />
                </Grid>
                <Input name="title" label="العنوان الداخلي" defaultValue={it.title} />
                <Textarea name="caption" label="النص" rows={8} required defaultValue={it.caption} />
                <Input name="hashtags" label="الوسوم" defaultValue={it.hashtags ?? ""} />
                <Grid>
                  <Input name="storyText" label="نص الشاشة (للقصة)" defaultValue={it.storyText ?? ""} />
                  <Input name="cta" label="دعوة الفعل" defaultValue={it.cta ?? ""} />
                </Grid>
                <Textarea name="visualBrief" label="توجيه التصميم" rows={3} defaultValue={it.visualBrief ?? ""} />
                <FileInput label="صورة التصميم (JPG/PNG — مطلوبة لإنستغرام والقصص)" />
              </ActionForm>
            ) : (
              <p className="whitespace-pre-wrap text-sm">{it.caption}</p>
            )}
            {!connected && manage && (
              <p className="mt-4 flex items-start gap-2 rounded-xl bg-canvas p-3 text-xs text-ink-muted">
                <Send className="mt-0.5 h-4 w-4 shrink-0" /> {meta?.configured ? (meta.missingScopes?.includes("pages_manage_posts") ? "الرمز المربوط ينقصه صلاحية النشر (pages_manage_posts) — أعد إنشاء الرمز من إعدادات النظام." : "ربط فيسبوك منقطع (" + (meta.error ?? "") + ") — أعد الربط من إعدادات النظام.") : "النشر التلقائي يحتاج ربط صفحة فيسبوك من «إعدادات النظام» — بعد الربط يصبح زر «اعتماد ونشر» ينشر مباشرة."}
              </p>
            )}
          </Card>
        </div>
      </div>

      {live && (
        <Card className="mt-5" title={<span className="flex items-center gap-2"><MessagesSquare className="h-5 w-5 text-accent" /> التعليقات على المنشور ({live.comments.length})</span>} action={<a href={`/marketing/${id}`} className="btn-ghost btn-sm">تحديث</a>}>
          {live.errors.map((e) => <p key={e} className="mb-2 rounded-xl bg-bad-soft px-3 py-2 text-sm text-bad">{e}</p>)}
          {live.comments.length === 0 ? (
            <p className="py-4 text-center text-sm text-ink-muted">لا توجد تعليقات بعد</p>
          ) : (
            <div className="space-y-3">
              {live.comments.map((c) => (
                <CommentThread key={c.id} comment={c} itemId={id} post={it.caption} canReply={manage} />
              ))}
            </div>
          )}
        </Card>
      )}
    </>
  );
}

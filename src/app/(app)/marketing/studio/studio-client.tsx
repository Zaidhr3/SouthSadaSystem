"use client";

/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Brain, Check, Download, ExternalLink, ImageIcon, Loader2, PenLine, Play, RotateCcw, ShieldCheck, Sparkles, Wand2, X } from "lucide-react";
import { studioAnalyze, studioGenerate, studioRefine, type StudioResult } from "../../actions/studio";
import type { StudioPlan } from "@/lib/design/studio";

type Phase = "idle" | "analyzing" | "awaiting" | "generating" | "done";
const STEPS = [
  { k: "intent", label: "فهم الطلب وسياق الشركة", icon: Brain },
  { k: "brief", label: "الخطة الإبداعية", icon: PenLine },
  { k: "gen", label: "توليد الصورة", icon: Wand2 },
  { k: "review", label: "المعاينة والحفظ", icon: ImageIcon },
];
const QUICK = ["جمعة مباركة", "عيد أضحى مبارك", "تهنئة بعيد الاستقلال", "تهنئة بتوقيع عقد مشروع جديد", "منشور هوية: نبني بثقة", "بدي رافعة شايلة لوحة مكتوب عليها «جمعة مباركة» وقت الغروب"];
const GEN_TICKS = ["يرسم المشهد الإنشائي…", "يضبط الإضاءة وألوان الهوية…", "يكتب العبارة بالخط العربي…", "يفحص صحة الكتابة آلياً…", "يركّب الشعار وشريط التواصل…"];

function stepIndex(p: Phase) {
  return p === "idle" ? -1 : p === "analyzing" ? 0 : p === "awaiting" ? 2 : p === "generating" ? 2 : 4;
}

export function StudioClient() {
  const [prompt, setPrompt] = useState("");
  const [format, setFormat] = useState<"POST" | "STORY">("POST");
  const [phase, setPhase] = useState<Phase>("idle");
  const [plan, setPlan] = useState<StudioPlan | null>(null);
  const [result, setResult] = useState<StudioResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [auto, setAuto] = useState(false);
  const [tweak, setTweak] = useState("");
  const [tick, setTick] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    try { setAuto(localStorage.getItem("sada:studio:auto") === "1"); } catch { /* */ }
  }, []);
  useEffect(() => {
    if (phase !== "generating") return;
    setTick(0);
    timer.current = setInterval(() => setTick((t) => (t + 1) % GEN_TICKS.length), 6000);
    return () => clearInterval(timer.current);
  }, [phase]);
  const toggleAuto = () => setAuto((a) => { try { localStorage.setItem("sada:studio:auto", a ? "0" : "1"); } catch { /* */ } return !a; });

  const generate = async (p: StudioPlan) => {
    setPhase("generating");
    setError(null);
    const r = await studioGenerate(p, result?.itemId ?? null);
    if (!r.ok) { setError(r.error); setPhase("awaiting"); return; }
    setResult(r.data);
    setPhase("done");
  };
  const analyze = async (text = prompt) => {
    if (text.trim().length < 2) return;
    setPrompt(text);
    setError(null);
    setResult(null);
    setPhase("analyzing");
    const r = await studioAnalyze(text, format);
    if (!r.ok) { setError(r.error); setPhase("idle"); return; }
    setPlan(r.data);
    if (auto) return generate(r.data);
    setPhase("awaiting");
  };
  const refine = async (regenerate: boolean) => {
    if (!plan || tweak.trim().length < 2) return;
    setError(null);
    setPhase("analyzing");
    const r = await studioRefine(plan, tweak);
    if (!r.ok) { setError(r.error); setPhase(regenerate ? "done" : "awaiting"); return; }
    setPlan(r.data);
    setTweak("");
    if (auto) return generate(r.data);
    setPhase("awaiting");
  };
  const reset = () => { setPhase("idle"); setPlan(null); setResult(null); setError(null); setPrompt(""); };
  const si = stepIndex(phase);

  return (
    <div className="space-y-5">
      {/* شريط الخطوات المرتبة */}
      <ol className="card grid grid-cols-2 gap-2 p-3 sm:grid-cols-4">
        {STEPS.map((s, i) => {
          const done = si > i || phase === "done";
          const now = si === i || (phase === "awaiting" && i === 2);
          const Icon = s.icon;
          return (
            <li key={s.k} className={clsx("flex items-center gap-2.5 rounded-2xl px-3 py-2.5 transition", now ? "bg-navy text-white shadow-card" : done ? "bg-good-soft text-good" : "text-ink-muted")}>
              <span className={clsx("grid h-8 w-8 shrink-0 place-items-center rounded-xl", now ? "bg-white/15 text-gold" : done ? "bg-good text-white" : "bg-black/[0.05]")}>
                {done ? <Check className="h-4 w-4" /> : now && (phase === "analyzing" || phase === "generating") ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
              </span>
              <span className="text-[13.5px] font-black leading-tight"><span className="num me-1.5 opacity-60">{i + 1}.</span>{s.label}</span>
            </li>
          );
        })}
      </ol>

      {/* الطلب */}
      {(phase === "idle" || phase === "analyzing") && (
        <section className="card card-pad">
          <form onSubmit={(e) => { e.preventDefault(); void analyze(); }} className="space-y-4">
            <label className="label" htmlFor="studio-prompt">اطلب بكلامك — النظام يفهم النية ويكيّفها لهوية صدى الجنوب</label>
            <textarea id="studio-prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3} className="input text-[17px]" placeholder="مثلاً: جمعة مباركة — أو: سوي لي صورة تهنئة بعيد الاستقلال فيها مبنى قيد الإنشاء وعلم الأردن" />
            <div className="flex flex-wrap gap-2">
              {QUICK.map((q) => (
                <button key={q} type="button" onClick={() => void analyze(q)} disabled={phase === "analyzing"} className="pressable rounded-full bg-white/60 px-3.5 py-1.5 text-[13px] font-bold text-navy ring-1 ring-black/[0.06] hover:bg-gold-soft">{q}</button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="seg flex rounded-2xl p-1">
                {(["POST", "STORY"] as const).map((f) => (
                  <button key={f} type="button" onClick={() => setFormat(f)} className={clsx("rounded-xl px-4 py-2 text-sm font-black transition", format === f ? "bg-white text-navy shadow-card" : "text-ink-muted")}>{f === "POST" ? "منشور 4:5" : "ستوري 9:16"}</button>
                ))}
              </div>
              <button type="submit" disabled={phase === "analyzing" || prompt.trim().length < 2} className="btn-primary">
                {phase === "analyzing" ? <><Loader2 className="h-4 w-4 animate-spin" /> يفهم طلبك…</> : <><Sparkles className="h-4 w-4" /> افهم واقترح الخطة</>}
              </button>
              <label className="ms-auto flex cursor-pointer items-center gap-2 text-[13px] font-bold text-ink-soft">
                <input type="checkbox" checked={auto} onChange={toggleAuto} /> موافقة تلقائية (ابدأ التوليد فور جاهزية الخطة)
              </label>
            </div>
          </form>
        </section>
      )}

      {error && <p className="flex items-center gap-2 rounded-2xl bg-bad-soft p-3 text-sm font-bold text-bad" role="alert"><X className="h-4 w-4" /> {error}</p>}

      {/* الخطة + إذن البدء */}
      {plan && (phase === "awaiting" || phase === "generating") && (
        <section className="grid gap-5 lg:grid-cols-[1fr_360px]">
          <div className="card card-pad space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-navy px-3 py-1 text-[12px] font-black text-gold">النية: {plan.intentLabel}</span>
              <span className="rounded-full bg-white/60 px-3 py-1 text-[12px] font-bold text-ink-soft ring-1 ring-black/[0.06]">{plan.format === "STORY" ? "ستوري 9:16" : "منشور 4:5"}</span>
              <span className="text-[13px] text-ink-muted">«{plan.prompt}»</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label">العبارة داخل الصورة</label>
                <input className="input text-[18px] font-black" value={plan.phrase} disabled={phase === "generating"} onChange={(e) => setPlan({ ...plan, phrase: e.target.value })} placeholder="(بلا نص داخل الصورة)" />
              </div>
              <div>
                <label className="label">لماذا هذا المشهد</label>
                <p className="rounded-2xl bg-white/50 p-3 text-[14px] leading-7 text-ink-soft">{plan.reasoning || "—"}</p>
              </div>
            </div>
            <div>
              <label className="label">المشهد (يُرسل لمولّد الصور)</label>
              <textarea className="input text-[14px] leading-7" dir="ltr" rows={3} value={plan.concept} disabled={phase === "generating"} onChange={(e) => setPlan({ ...plan, concept: e.target.value })} />
            </div>
            <div>
              <label className="label">نص المنشور المرافق</label>
              <textarea className="input leading-7" rows={3} value={plan.caption} disabled={phase === "generating"} onChange={(e) => setPlan({ ...plan, caption: e.target.value })} />
            </div>
            {phase === "awaiting" && (
              <div className="flex flex-wrap items-end gap-2 border-t border-black/[0.06] pt-4">
                <div className="min-w-[220px] flex-1">
                  <label className="label">عدّل الخطة بكلامك</label>
                  <input className="input" value={tweak} onChange={(e) => setTweak(e.target.value)} placeholder="مثلاً: خليها بالليل مع إضاءة ذهبية، أو بدّل الرافعة بجرافة" />
                </div>
                <button type="button" onClick={() => void refine(false)} disabled={tweak.trim().length < 2} className="btn-secondary"><PenLine className="h-4 w-4" /> طبّق التعديل</button>
              </div>
            )}
          </div>

          <aside className="card card-pad order-first flex flex-col gap-4 border-2 !border-gold/60 lg:order-none">
            <p className="flex items-center gap-2 text-[17px] font-black text-navy"><ShieldCheck className="h-5 w-5 text-accent" /> إذن البدء</p>
            {plan.phrase && <p className="rounded-2xl bg-navy px-4 py-3 text-center text-[20px] font-black text-gold">«{plan.phrase}»</p>}
            <ol className="space-y-2 text-[14px] leading-6 text-ink-soft">
              <li><b className="num text-navy">1.</b> توليد صورة جديدة بخدمة Gemini للصور — <b>تستهلك رصيداً</b> من حساب Google.</li>
              <li><b className="num text-navy">2.</b> فحص آلي لصحة العبارة العربية (حتى محاولتين)، وإلا تُكتب بخط الهوية فوق المشهد.</li>
              <li><b className="num text-navy">3.</b> تركيب الشعار والكتالوج وشريط التواصل، وحفظها كعنصر «قيد المراجعة» في التسويق.</li>
              <li><b className="num text-navy">4.</b> <b>لا نشر</b> — النشر يبقى باعتمادك من صفحة العنصر.</li>
            </ol>
            {phase === "generating" ? (
              <div className="rounded-2xl bg-navy p-4 text-white">
                <p className="flex items-center gap-2 font-black"><Loader2 className="h-5 w-5 animate-spin text-gold" /> جارٍ التنفيذ…</p>
                <p className="mt-1 text-[13px] text-white/75">{GEN_TICKS[tick]}</p>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/15"><div className="progress-fill h-full w-2/3 rounded-full" /></div>
              </div>
            ) : (
              <div className="grid gap-2">
                <button type="button" onClick={() => plan && void generate(plan)} className="btn-primary !py-3 text-[16px]"><Play className="h-5 w-5" /> ابدأ التنفيذ</button>
                <button type="button" onClick={reset} className="btn-ghost">إلغاء</button>
              </div>
            )}
          </aside>
        </section>
      )}

      {/* النتيجة */}
      {phase === "done" && result && plan && (
        <section className="grid gap-5 lg:grid-cols-[minmax(0,460px)_1fr]">
          <div className="card overflow-hidden !p-0">
            {result.slides.map((id) => <img key={id} src={`/api/files/${id}`} alt={plan.phrase || plan.title} className="w-full" />)}
          </div>
          <div className="card card-pad space-y-4">
            <p className="text-[19px] font-black text-navy">جاهزة ✓ <span className="text-[13px] font-bold text-ink-muted">في {Math.round(result.ms / 1000)} ثانية</span></p>
            <p className="rounded-2xl bg-white/50 p-3 text-[14px] leading-7">{result.baked ? "العبارة مكتوبة داخل المشهد ومُدققة آلياً." : "العبارة كُتبت بخط الهوية فوق المشهد (المولّد لم يكتبها بدقة كافية)."} راجع الصورة بعينك قبل النشر.</p>
            <div className="flex flex-wrap gap-2">
              {result.slides[0] && <a href={`/api/files/${result.slides[0]}`} download={`sada-${result.itemId}.jpg`} className="btn-secondary"><Download className="h-4 w-4" /> تنزيل</a>}
              <Link href={`/marketing/${result.itemId}`} className="btn-primary"><ExternalLink className="h-4 w-4" /> افتح للنشر / Canva</Link>
              <button type="button" onClick={() => void generate(plan)} className="btn-secondary"><RotateCcw className="h-4 w-4" /> صورة أخرى بنفس الخطة</button>
              <button type="button" onClick={reset} className="btn-ghost">طلب جديد</button>
            </div>
            <div className="border-t border-black/[0.06] pt-4">
              <label className="label">عدّل وأعد التوليد</label>
              <div className="flex flex-wrap gap-2">
                <input className="input min-w-[200px] flex-1" value={tweak} onChange={(e) => setTweak(e.target.value)} placeholder="مثلاً: كبّر العبارة، خلي الجو ليلي، زيد لمسة ذهبية" />
                <button type="button" onClick={() => void refine(true)} disabled={tweak.trim().length < 2} className="btn-secondary"><PenLine className="h-4 w-4" /> عدّل الخطة</button>
              </div>
              <p className="mt-1 text-xs text-ink-muted">التعديل يحدّث الخطة أولاً، ثم يطلب إذنك قبل التوليد ({auto ? "الموافقة التلقائية مفعّلة" : "إلا إذا فعّلت الموافقة التلقائية"}).</p>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

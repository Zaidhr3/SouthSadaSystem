"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import clsx from "clsx";
import { Flame, Loader2, CheckCircle2, XCircle, AlertTriangle, HelpCircle } from "lucide-react";
import { roastAction, type RoastState } from "../actions/board";
import type { RoastResult } from "@/lib/board/roast";

type SeatInfo = { key: string; name: string; initials: string; color: string; pillar: string; question: string };

const STANCE = {
  FOR: { label: "مع", cls: "bg-good-soft text-good", icon: CheckCircle2 },
  AGAINST: { label: "ضد", cls: "bg-bad-soft text-bad", icon: XCircle },
  CONDITIONAL: { label: "بشروط", cls: "bg-warn-soft text-warn", icon: AlertTriangle },
} as const;
const CALL = {
  GO: { label: "امضِ", cls: "from-good to-[#36b35a]" },
  NO_GO: { label: "لا تمضِ", cls: "from-bad to-[#ff4d5e]" },
  GO_IF: { label: "امضِ بشروط", cls: "from-accent to-gold" },
} as const;

function Convene({ ready }: { ready: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending || !ready} className="btn-primary w-full sm:w-auto">
      {pending ? <><Loader2 className="h-4 w-4 animate-spin" /> المستشارون يتناقشون… (≈ 30 ثانية)</> : <><Flame className="h-4 w-4" /> اعقد غرفة النقد</>}
    </button>
  );
}

export function RoastRoom({ seats, defaults, motionId, initial, canRun }: { seats: SeatInfo[]; defaults: string[]; motionId: number | null; initial?: RoastResult | null; canRun: boolean }) {
  const [state, action] = useFormState<RoastState, FormData>(roastAction.bind(null, motionId), {});
  const [picked, setPicked] = useState<string[]>(defaults);
  const result = state.result ?? initial ?? null;
  const toggle = (k: string) => setPicked((p) => (p.includes(k) ? p.filter((x) => x !== k) : p.length >= 7 ? p : [...p, k]));

  return (
    <div className="space-y-5">
      {canRun && (
        <form action={action} className="space-y-4">
          {picked.map((k) => <input key={k} type="hidden" name="seats" value={k} />)}
          <div>
            <p className="label">المقاعد حول الطاولة ({picked.length}/7)</p>
            <div className="flex flex-wrap gap-2">
              {seats.map((s) => {
                const on = picked.includes(s.key);
                return (
                  <button key={s.key} type="button" onClick={() => toggle(s.key)} title={s.question}
                    className={clsx("pressable flex items-center gap-2 rounded-full border py-1 pe-3 ps-1 text-[13px] font-bold", on ? "border-transparent bg-navy text-white shadow-card" : "border-line bg-white text-ink-muted")}>
                    <span className="grid h-7 w-7 place-items-center rounded-full text-[11px] font-black text-white" style={{ background: s.color }}>{s.initials}</span>
                    {s.pillar}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <label className="label" htmlFor="decision">{motionId ? "سياق إضافي للمستشارين (اختياري)" : "القرار المطروح"}</label>
            <textarea id="decision" name="decision" rows={motionId ? 2 : 4} className="input" required={!motionId} minLength={motionId ? 0 : 15}
              placeholder={motionId ? "مثلاً: السيولة الحالية ضيقة، أو العميل جهة حكومية تتأخر بالدفع…" : "مثلاً: هل ندخل عطاء طرق الطفيلة بقيمة تقديرية 1.2 مليون، مع أن عندنا مشروعين قيد التنفيذ؟"} />
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Convene ready={picked.length > 0} />
            <p className="text-xs text-ink-muted">المقاعد محاكاة بالذكاء الاصطناعي لأطر عمل منشورة (Roast Room — MIT) — رأي استشاري لا يُغني عن تصويت المجلس.</p>
          </div>
          {state.error && <p className="rounded-xl bg-bad-soft p-3 text-sm font-bold text-bad" role="alert">{state.error}</p>}
        </form>
      )}

      {result && (
        <div className="space-y-4">
          <div className={clsx("relative overflow-hidden rounded-[24px] bg-gradient-to-l p-5 text-white shadow-pop", CALL[result.verdict.call].cls)}>
            <div className="flex flex-wrap items-center gap-3">
              <span className="rounded-full bg-white/20 px-3 py-1 text-sm font-black backdrop-blur">حكم الرئيس: {CALL[result.verdict.call].label}</span>
              <span className="num rounded-full bg-black/15 px-3 py-1 text-sm font-bold">ثقة {result.verdict.confidence}%</span>
              <span className="text-xs opacity-80" suppressHydrationWarning>{new Date(result.at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</span>
            </div>
            <p className="mt-3 text-[15px] font-semibold leading-7">{result.verdict.summary}</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {[
                { t: "شروط الموافقة", l: result.verdict.conditions },
                { t: "متى نتراجع", l: result.verdict.killCriteria },
                { t: "الخطوات التالية", l: result.verdict.nextSteps },
              ].map((b) => (
                <div key={b.t} className="rounded-2xl bg-white/15 p-3 backdrop-blur">
                  <p className="mb-1 text-xs font-black opacity-90">{b.t}</p>
                  {b.l.length ? <ul className="list-inside list-disc space-y-1 text-[13px] leading-6">{b.l.map((x, i) => <li key={i}>{x}</li>)}</ul> : <p className="text-[13px] opacity-75">—</p>}
                </div>
              ))}
            </div>
          </div>

          <div className="stagger grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {result.seats.map((s) => {
              const st = STANCE[s.stance];
              const Icon = st.icon;
              return (
                <article key={s.key} className="card card-pad flex flex-col gap-3">
                  <header className="flex items-center gap-3">
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-sm font-black text-white shadow-card" style={{ background: s.color }}>{s.initials}</span>
                    <span className="min-w-0 flex-1 leading-tight">
                      <span className="block truncate font-extrabold text-ink">{s.pillar}</span>
                      <span className="block text-xs text-ink-muted">مقعد {s.name}</span>
                    </span>
                    <span className={clsx("flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-black", st.cls)}><Icon className="h-3.5 w-3.5" /> {st.label}</span>
                  </header>
                  <div className="h-1.5 overflow-hidden rounded-full bg-black/[0.06]"><div className="bar-grow h-full rounded-full" style={{ width: `${s.score}%`, background: s.color }} /></div>
                  <p className="font-bold leading-7 text-navy">{s.headline}</p>
                  <p className="text-[13.5px] leading-7 text-ink-soft">{s.argument}</p>
                  <p className="rounded-xl bg-bad-soft/60 p-2.5 text-[13px] leading-6 text-ink"><b className="text-bad">الخطر: </b>{s.risk}</p>
                  <p className="flex gap-1.5 text-[13px] font-semibold leading-6 text-navy-3"><HelpCircle className="mt-1 h-4 w-4 shrink-0" />{s.question}</p>
                </article>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

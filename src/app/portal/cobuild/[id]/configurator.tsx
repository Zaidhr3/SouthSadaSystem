"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { Check, CheckCircle2, Loader2, Lock, Minus, Plus, Save } from "lucide-react";
import { PHASES, normalizeSelection, r3, type CatalogLite } from "@/lib/cobuild-core";
import { saveMySelections } from "../../cobuild-actions";

const fmt = (n: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(n);

/**
 * مكوّن «من العظم إلى المفتاح»: يختار المالك بنود التشطيب ويرى التفصيل الحي
 * (العظم + التشطيب − الحوافز = التقدير). نفس قواعد الخادم تماماً (normalizeSelection)،
 * والخادم يعيد احتساب كل شيء عند الحفظ — لا يُوثق بأسعار المتصفح.
 */
export function Configurator({
  buyerId,
  items,
  areaSqm,
  skeletonPrice,
  credits,
  initial,
  locked,
  readOnly,
}: {
  buyerId: number;
  items: CatalogLite[];
  areaSqm: number;
  skeletonPrice: number;
  credits: number;
  initial: { itemId: number; qty: number; lockedPrice: number | null }[];
  locked: boolean;
  readOnly: boolean;
}) {
  const start = initial.length ? initial.map((s) => ({ itemId: s.itemId, qty: s.qty })) : normalizeSelection(items, [], areaSqm);
  const [picked, setPicked] = useState(start);
  const [saved, setSaved] = useState(JSON.stringify(start));
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);
  const [pending, startTx] = useTransition();
  const router = useRouter();
  const frozen = locked || readOnly;
  const lockedPrice = new Map(initial.map((s) => [s.itemId, s.lockedPrice]));
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  const lines = useMemo(() => (frozen ? picked : normalizeSelection(items, picked, areaSqm)), [frozen, items, picked, areaSqm]);
  const qtyOf = new Map(lines.map((l) => [l.itemId, l.qty]));
  const priceFor = (id: number) => lockedPrice.get(id) ?? byId.get(id)?.price ?? 0;
  const finishing = r3(lines.reduce((s, l) => s + l.qty * priceFor(l.itemId), 0));
  const total = r3(skeletonPrice + finishing - credits);
  const dirty = JSON.stringify(lines) !== saved;

  const toggle = (it: CatalogLite) => {
    if (frozen || it.mode === "INCLUDED") return;
    setMsg(null);
    const on = qtyOf.has(it.id);
    if (on && it.mode === "REQUIRED" && !it.choiceGroup) return;
    if (on && it.choiceGroup && it.mode !== "OPTION") return; // البديل الإلزامي يبقى حتى يُختار غيره
    if (on) {
      setPicked(lines.filter((l) => l.itemId !== it.id));
      return;
    }
    const rest = lines.filter((l) => !it.choiceGroup || byId.get(l.itemId)?.choiceGroup !== it.choiceGroup);
    setPicked([...rest, { itemId: it.id, qty: it.defaultQty }]);
  };
  const setQty = (it: CatalogLite, q: number) => {
    if (frozen) return;
    setMsg(null);
    setPicked(lines.map((l) => (l.itemId === it.id ? { ...l, qty: Math.max(0, Math.min(200, q)) } : l)));
  };
  const save = () =>
    startTx(async () => {
      const r = await saveMySelections(buyerId, lines);
      setMsg(r);
      if (r.ok) {
        setSaved(JSON.stringify(lines));
        router.refresh();
      }
    });

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
      <div className="space-y-3">
        {PHASES.map((ph, pi) => {
          const rows = items.filter((i) => i.phase === ph.key);
          if (!rows.length) return null;
          const sum = r3(rows.reduce((s, i) => s + (qtyOf.get(i.id) ?? 0) * priceFor(i.id), 0));
          return (
            <details key={ph.key} open={pi > 1 && pi < 5} className="card overflow-hidden">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3.5">
                <span className="flex items-center gap-2.5">
                  <span className="num grid h-8 w-8 place-items-center rounded-xl bg-navy text-sm font-black text-gold">{pi + 1}</span>
                  <span className="font-black text-navy">{ph.label}</span>
                </span>
                <span className="num text-sm font-bold text-ink-muted">{ph.key === "LAND_SKELETON" || ph.key === "FACADE" ? "ضمن العظم" : `${fmt(sum)} د.أ`}</span>
              </summary>
              <ul className="divide-y divide-black/5 border-t border-black/5">
                {rows.map((it) => {
                  const on = it.mode === "INCLUDED" || qtyOf.has(it.id);
                  const q = qtyOf.get(it.id) ?? 0;
                  const fixed = it.mode === "INCLUDED" || (it.mode === "REQUIRED" && !it.choiceGroup);
                  return (
                    <li key={it.id} className={clsx("flex items-start gap-3 px-4 py-3 transition", on && it.mode !== "INCLUDED" && "bg-gold/[0.07]")}>
                      <button
                        type="button"
                        onClick={() => toggle(it)}
                        disabled={frozen || fixed}
                        aria-pressed={on}
                        aria-label={on ? `مختار: ${it.name}` : `اختر: ${it.name}`}
                        className={clsx("mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg border-2 transition", on ? "border-accent bg-accent text-white" : "border-black/15 bg-white", (frozen || fixed) && "opacity-70")}
                      >
                        {on && <Check className="h-4 w-4" />}
                      </button>
                      <div className="min-w-0 flex-1">
                        <p className="font-bold leading-6">{it.name}</p>
                        {it.specs && <p className="text-xs leading-5 text-ink-muted">{it.specs}</p>}
                        <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] font-bold">
                          {it.mode === "INCLUDED" ? <span className="rounded-full bg-black/[0.05] px-2 py-0.5 text-ink-muted">مشمول في سعر العظم</span> : it.mode === "REQUIRED" ? <span className="rounded-full bg-navy/10 px-2 py-0.5 text-navy">أساسي للتسليم{it.choiceGroup ? " — أو بديله" : ""}</span> : <span className="rounded-full bg-good-soft px-2 py-0.5 text-good">اختياري</span>}
                          {it.choiceGroup && <span className="text-ink-muted">اختر واحداً من المجموعة</span>}
                        </p>
                      </div>
                      <div className="shrink-0 text-end">
                        <p className="num text-sm font-black">{it.mode === "INCLUDED" ? "—" : `${fmt(priceFor(it.id))} د.أ`}<span className="text-[11px] font-semibold text-ink-muted"> / {it.unit}</span></p>
                        {on && it.mode !== "INCLUDED" && (
                          it.qtyEditable && !frozen ? (
                            <span className="mt-1 inline-flex items-center gap-1">
                              <button type="button" className="grid h-7 w-7 place-items-center rounded-lg bg-black/[0.06]" onClick={() => setQty(it, q - 1)} aria-label="إنقاص"><Minus className="h-3.5 w-3.5" /></button>
                              <span className="num w-8 text-center text-sm font-black">{q}</span>
                              <button type="button" className="grid h-7 w-7 place-items-center rounded-lg bg-black/[0.06]" onClick={() => setQty(it, q + 1)} aria-label="زيادة"><Plus className="h-3.5 w-3.5" /></button>
                            </span>
                          ) : (
                            <p className="num text-[11px] text-ink-muted">{q} {it.unit} = {fmt(r3(q * priceFor(it.id)))} د.أ</p>
                          )
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </details>
          );
        })}
      </div>

      <aside className="lg:sticky lg:top-24 lg:self-start">
        <div className="card overflow-hidden">
          <div className="px-5 py-4 text-white" style={{ background: "linear-gradient(120deg,#0b2545,#13315c)" }}>
            <p className="text-xs font-bold text-gold">التقدير الحي لشقتك</p>
            <p className="num mt-1 text-[32px] font-black leading-tight">{fmt(total)} <span className="text-base text-white/70">د.أ</span></p>
          </div>
          <dl className="space-y-2.5 px-5 py-4 text-sm">
            <div className="flex justify-between"><dt className="text-ink-muted">الشقة على العظم ({areaSqm} م²)</dt><dd className="num font-bold">{fmt(skeletonPrice)}</dd></div>
            <div className="flex justify-between"><dt className="text-ink-muted">+ التشطيب حتى المفتاح ({lines.length} بنداً)</dt><dd className="num font-bold">{fmt(finishing)}</dd></div>
            <div className="flex justify-between text-good"><dt>− حوافزك</dt><dd className="num font-bold">{fmt(credits)}</dd></div>
            <div className="flex justify-between border-t border-black/10 pt-2.5 text-base"><dt className="font-black">= التقدير الإجمالي</dt><dd className="num font-black text-navy">{fmt(total)}</dd></div>
          </dl>
          <div className="border-t border-black/5 px-5 py-4">
            {locked ? (
              <p className="flex items-center gap-2 text-sm font-bold text-navy"><Lock className="h-4 w-4" /> أسعارك مقفولة — لا تتأثر بتغيّر الكتالوج</p>
            ) : readOnly ? (
              <p className="text-sm text-ink-muted">الاختيارات مغلقة لهذه الشقة.</p>
            ) : (
              <button type="button" onClick={save} disabled={!dirty || pending} className="btn-primary w-full disabled:opacity-40">
                {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} {dirty ? "احفظ اختياراتي" : "محفوظة"}
              </button>
            )}
            {msg?.ok && <p className="mt-2 flex items-center gap-1.5 text-sm font-semibold text-good"><CheckCircle2 className="h-4 w-4" /> {msg.ok}</p>}
            {msg?.error && <p className="mt-2 text-sm font-semibold text-bad">{msg.error}</p>}
            <p className="mt-3 text-[11px] leading-5 text-ink-muted">تقدير مبني على أسعار الكتالوج الحالية حتى تُقفل أسعارك مع الشركة. الحوافز المستحقة قبل «تم» تُطبَّق على رصيد عقدك عند الانطلاق، وتسقط إذا انسحبت.</p>
          </div>
        </div>
      </aside>
    </div>
  );
}

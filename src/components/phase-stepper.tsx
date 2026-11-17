import clsx from "clsx";
import { Check } from "lucide-react";
import { PHASES, type PhaseNo } from "@/lib/project-phase";

const NOS: PhaseNo[] = [1, 2, 3, 4, 5];

/**
 * شريط المراحل الخمس — نظرة واحدة على موقع المشروع في دورته التعاقدية.
 * compact: نقاط صغيرة للقوائم · الافتراضي: خطوات بعناوين (روابط لبطاقة كل مرحلة)
 */
export function PhaseStepper({ done, current, closed, compact, linkBase }: { done: Record<PhaseNo, boolean>; current: PhaseNo | null; closed?: boolean; compact?: boolean; linkBase?: string }) {
  if (compact) {
    return (
      <span className="flex items-center gap-1" aria-label={current ? `المرحلة ${current} من 5` : "المراحل"}>
        {NOS.map((n) => (
          <span
            key={n}
            className={clsx("h-1.5 rounded-full transition-all", n === current && !closed ? "w-5 bg-accent" : done[n] || closed ? "w-2.5 bg-good" : "w-2.5 bg-black/10")}
          />
        ))}
      </span>
    );
  }
  return (
    <ol className="grid grid-cols-5 gap-1.5" aria-label="مراحل المشروع">
      {NOS.map((n) => {
        const isDone = closed || done[n];
        const isCur = n === current && !closed;
        const inner = (
          <>
            <span className={clsx("h-1.5 rounded-full", isDone ? "bg-good" : isCur ? "bg-accent" : "bg-black/10")} />
            <span className="mt-2 flex items-center gap-1.5">
              <span className={clsx("grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold", isDone ? "bg-good text-white" : isCur ? "bg-accent text-white ring-4 ring-accent/15" : "bg-canvas text-ink-muted ring-1 ring-line")}>
                {isDone ? <Check className="h-3.5 w-3.5" aria-hidden /> : n}
              </span>
              <span className={clsx("hidden text-[12px] font-semibold leading-tight sm:block", isCur ? "text-ink" : "text-ink-muted")}>{PHASES[n].short}</span>
            </span>
          </>
        );
        return (
          <li key={n} className="flex flex-col" aria-current={isCur ? "step" : undefined}>
            {linkBase ? <a href={`${linkBase}#phase-${n}`} className="pressable flex flex-col rounded-lg">{inner}</a> : inner}
          </li>
        );
      })}
    </ol>
  );
}

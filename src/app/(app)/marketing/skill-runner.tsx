"use client";

import { useFormState, useFormStatus } from "react-dom";
import { Loader2, Wand2 } from "lucide-react";
import { ActionForm } from "@/components/forms";
import { CopyButton } from "@/components/copy-button";
import type { ActionState } from "@/lib/action";
import type { SkillState } from "../actions/marketing";

type Skill = { id: string; name: string; desc: string; source: string; scope: "item" | "free"; inputLabel?: string; placeholder?: string };

function Run({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn-secondary btn-sm">
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />} {pending ? "يعمل…" : label}
    </button>
  );
}

function Apply({ apply, caption, skill }: { apply: (s: ActionState, fd: FormData) => Promise<ActionState>; caption: string; skill: string }) {
  return (
    <ActionForm action={apply} submitLabel="اعتماد هذا النص">
      <input type="hidden" name="caption" value={caption} />
      <input type="hidden" name="skill" value={skill} />
    </ActionForm>
  );
}

/** تشغيل مهارة محتوى وعرض ناتجها (مع نسخ، وتطبيق على العنصر حين يكون الناتج نصاً بديلاً) */
export function SkillRunner({ skill, action, apply }: { skill: Skill; action: (s: SkillState, fd: FormData) => Promise<SkillState>; apply?: (s: ActionState, fd: FormData) => Promise<ActionState> }) {
  const [state, run] = useFormState(action, {});
  return (
    <div className="rounded-2xl border border-line bg-white p-3">
      <form action={run} className="space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-bold">{skill.name}</p>
            <p className="text-xs text-ink-muted">{skill.desc}</p>
          </div>
          {skill.scope === "item" && <Run label="تشغيل" />}
        </div>
        {skill.scope === "free" && (
          <>
            <textarea name="text" className="input min-h-[90px] text-sm" placeholder={skill.placeholder} aria-label={skill.inputLabel} required />
            <Run label="تشغيل" />
          </>
        )}
      </form>
      {state.error && <p className="mt-2 rounded-xl bg-bad-soft px-3 py-2 text-sm font-semibold text-bad">{state.error}</p>}
      {state.factWarning && <p className="mt-2 rounded-xl bg-warn-soft px-3 py-2 text-sm font-semibold text-warn">⚠️ {state.factWarning}</p>}
      {state.text && (
        <div className="mt-3 rounded-xl bg-canvas p-3">
          <div className="mb-1 flex justify-end"><CopyButton text={state.text} label="نسخ" /></div>
          <p className="whitespace-pre-wrap text-sm leading-7">{state.text}</p>
        </div>
      )}
      {state.caption && (
        <div className="mt-3 space-y-2 rounded-xl border border-accent/20 bg-accent-soft/40 p-3">
          <p className="whitespace-pre-wrap text-sm leading-7">{state.caption}</p>
          <div className="flex flex-wrap items-center gap-2">
            <CopyButton text={state.caption} label="نسخ" />
            {apply && <Apply apply={apply} caption={state.caption} skill={skill.name} />}
          </div>
        </div>
      )}
      {state.options?.map((o, i) => (
        <div key={`${state.at}-${i}`} className="mt-3 space-y-2 rounded-xl border border-line p-3">
          <p className="text-xs font-bold text-accent">{o.label}</p>
          <p className="whitespace-pre-wrap text-sm leading-7">{o.text.split("\n")[0]}</p>
          <div className="flex flex-wrap items-center gap-2">
            <CopyButton text={o.text} label="نسخ" />
            {apply && <Apply apply={apply} caption={o.text} skill={`${skill.name} ${o.label}`} />}
          </div>
        </div>
      ))}
    </div>
  );
}

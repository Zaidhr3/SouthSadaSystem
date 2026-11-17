"use client";

import { useEffect, useRef } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { CheckCircle2, Loader2 } from "lucide-react";
import type { PortalState } from "./actions";

function Submit({ label, className }: { label: string; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={className ?? "btn-primary w-full"}>
      {pending && <Loader2 className="h-4 w-4 animate-spin" />}
      {label}
    </button>
  );
}

export function PortalForm({ action, children, submitLabel, submitClass, reset }: { action: (s: PortalState, fd: FormData) => Promise<PortalState>; children: React.ReactNode; submitLabel: string; submitClass?: string; reset?: boolean }) {
  const [state, formAction] = useFormState(action, {});
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok && reset) ref.current?.reset();
  }, [state, reset]);
  return (
    <form ref={ref} action={formAction} className="space-y-4">
      {children}
      {state.error && <p role="alert" className="rounded-xl bg-bad-soft px-3 py-2 text-sm font-semibold text-bad">{state.error}</p>}
      {state.ok && (
        <p role="status" className="flex items-center gap-2 rounded-xl bg-good-soft px-3 py-2 text-sm font-semibold text-good">
          <CheckCircle2 className="h-4 w-4" /> {state.ok}
        </p>
      )}
      <Submit label={submitLabel} className={submitClass} />
    </form>
  );
}

/** نافذة منبثقة بسيطة بعنصر details (بلا JavaScript إضافي) */
export function Disclosure({ trigger, children, className }: { trigger: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <details className={className}>
      <summary className="btn-secondary btn-sm cursor-pointer list-none">{trigger}</summary>
      <div className="mt-3 rounded-2xl border border-line bg-white p-4">{children}</div>
    </details>
  );
}

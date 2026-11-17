"use client";

import { createContext, useCallback, useContext, useState } from "react";
import { CheckCircle2, AlertCircle } from "lucide-react";

type Toast = { id: number; kind: "success" | "error"; text: string };
const Ctx = createContext<(kind: Toast["kind"], text: string) => void>(() => undefined);

export function useToast() {
  return useContext(Ctx);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((kind: Toast["kind"], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3800);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[100] flex flex-col items-center gap-2 px-4 lg:bottom-6" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="toast-in pointer-events-auto flex items-center gap-2.5 rounded-full border border-white/10 bg-navy/95 px-4 py-2.5 text-sm font-semibold text-white shadow-pop backdrop-blur"
          >
            {t.kind === "success" ? (
              <CheckCircle2 className="h-5 w-5 text-good" aria-hidden />
            ) : (
              <AlertCircle className="h-5 w-5 text-bad" aria-hidden />
            )}
            {t.text}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

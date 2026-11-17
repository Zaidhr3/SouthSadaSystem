"use client";

import { AlertTriangle } from "lucide-react";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="card flex flex-col items-center px-6 py-14 text-center">
      <span className="grid h-14 w-14 place-items-center rounded-2xl bg-bad-soft text-bad">
        <AlertTriangle className="h-7 w-7" />
      </span>
      <p className="mt-4 font-bold">حدث خطأ أثناء تحميل الصفحة</p>
      <p className="mt-1 max-w-md text-sm text-ink-muted">{error.message || "خطأ غير متوقع"}</p>
      <button onClick={reset} className="btn-primary mt-5">
        إعادة المحاولة
      </button>
    </div>
  );
}

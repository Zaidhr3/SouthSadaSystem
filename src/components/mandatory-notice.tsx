"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, Megaphone } from "lucide-react";
import { acknowledgeNotice } from "@/app/(app)/actions/admin";
import { haptic } from "./forms";

const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Amman", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

/**
 * تعميم إلزامي من المدير العام: يغطي الشاشة ولا يُغلق (لا زر إغلاق، لا Esc، لا نقر خارجي)
 * حتى يؤكد المستخدم اطلاعه — ويُسجل التأكيد بوقته في سجل الرقابة.
 */
export function MandatoryNotice({ notice, setAt }: { notice: string; setAt: string | null }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);
  if (!mounted) return null;
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end justify-center p-0 sm:items-center sm:p-4" role="alertdialog" aria-modal="true" aria-labelledby="notice-title" aria-describedby="notice-body">
      <div className="absolute inset-0 animate-fade-in bg-black/50 backdrop-blur-md" />
      <div className="notice-in relative w-full max-w-lg overflow-hidden rounded-t-[28px] bg-white shadow-pop sm:rounded-[28px]" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        <div className="bg-gradient-to-l from-accent to-[#2b8ef0] px-6 pb-5 pt-6 text-white">
          <span className="mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-white/20">
            <Megaphone className="h-6 w-6" aria-hidden />
          </span>
          <h2 id="notice-title" className="text-xl font-bold">تعميم من إدارة الشركة</h2>
          {setAt && <p className="mt-1 text-sm text-white/85">بتاريخ <span className="num">{fmt.format(new Date(setAt))}</span></p>}
        </div>
        <div className="max-h-[50vh] overflow-y-auto px-6 py-5">
          <p id="notice-body" className="whitespace-pre-line text-[17px] font-semibold leading-loose text-ink">{notice}</p>
        </div>
        <div className="border-t border-line px-6 py-4">
          {error && <p className="mb-3 rounded-xl bg-bad-soft px-3 py-2 text-sm font-semibold text-bad" role="alert">{error}</p>}
          <button
            type="button"
            disabled={pending}
            className="btn-primary w-full py-3.5 text-[17px]"
            onClick={async () => {
              haptic(15);
              setPending(true);
              setError(null);
              const r = await acknowledgeNotice().catch(() => ({ ok: false as const, error: "تعذر الاتصال بالخادم، حاول مجدداً" }));
              if (r && "ok" in r && r.ok === false) {
                setError(r.error);
                setPending(false);
                return;
              }
              router.refresh();
            }}
          >
            {pending ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : <CheckCircle2 className="h-5 w-5" aria-hidden />}
            اطّلعت على التعميم
          </button>
          <p className="mt-2 text-center text-xs text-ink-muted">لا يمكن متابعة العمل قبل تأكيد الاطلاع — يُسجل التأكيد بوقته لدى الإدارة</p>
        </div>
      </div>
    </div>,
    document.body,
  );
}

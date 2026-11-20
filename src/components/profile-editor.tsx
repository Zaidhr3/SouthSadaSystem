"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { Check, Loader2 } from "lucide-react";
import { PRESETS } from "@/lib/profile-presets";
import { setProfilePreset } from "@/app/(app)/actions/profile";
import { useToast } from "./toast";

/** شبكة القوالب الجاهزة للغلاف أو الخلفية — تطبيق بلمسة */
export function PresetPicker({ slot, current }: { slot: "cover" | "wallpaper"; current?: string | null }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const toast = useToast();
  const pick = (k: string | null) =>
    start(async () => {
      const r = await setProfilePreset(slot, k);
      toast(r.ok ? "success" : "error", r.ok ? r.message ?? "تم" : r.error ?? "تعذر");
      router.refresh();
    });
  return (
    <div>
      <div className="grid grid-cols-5 gap-2">
        {Object.entries(PRESETS).map(([k, p]) => (
          <button key={k} type="button" disabled={pending} onClick={() => pick(k)} title={p.name}
            className={clsx("pressable relative aspect-[4/3] rounded-xl ring-1 ring-black/10", current === k && "ring-2 ring-accent ring-offset-2")} style={{ background: p.css }}>
            {current === k && <Check className="absolute inset-0 m-auto h-5 w-5 text-white drop-shadow" />}
          </button>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-2 text-xs">
        {pending && <Loader2 className="h-4 w-4 animate-spin text-accent" />}
        {slot === "wallpaper" && <button type="button" onClick={() => pick(null)} className="font-bold text-ink-muted hover:text-bad">بلا خلفية (الرمادي الافتراضي)</button>}
      </div>
    </div>
  );
}

export function RemoveAvatar() {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <button type="button" disabled={pending} className="btn-ghost btn-sm" onClick={() => start(async () => { await setProfilePreset("avatar", null); router.refresh(); })}>
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : "إزالة الصورة"}
    </button>
  );
}

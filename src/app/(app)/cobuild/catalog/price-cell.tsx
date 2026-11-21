"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { useToast } from "@/components/toast";
import { inlinePrice } from "../../actions/cobuild";

/** تعديل سريع داخل الجدول: الكلفة وسعر البيع — الهامش يُحسب تلقائياً ويظهر فوراً */
export function PriceCell({ id, cost, price }: { id: number; cost: number; price: number }) {
  const [c, setC] = useState(String(cost));
  const [p, setP] = useState(String(price));
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const dirty = Number(c) !== cost || Number(p) !== price;
  const margin = Math.round((Number(p) - Number(c)) * 1000) / 1000;
  const save = () => {
    const fd = new FormData();
    fd.set("unitCost", c);
    fd.set("price", p);
    start(async () => {
      const r = await inlinePrice(id, {}, fd);
      if (r.ok) {
        toast("success", r.message ?? "حُفظ");
        router.refresh();
      } else toast("error", r.error ?? "تعذر الحفظ");
    });
  };
  return (
    <div className="flex items-center gap-1.5" onKeyDown={(e) => e.key === "Enter" && dirty && save()}>
      <input aria-label="الكلفة" className="input num !h-9 w-20 !px-2 text-end text-sm" inputMode="decimal" value={c} onChange={(e) => setC(e.target.value)} />
      <span className={`num w-16 text-center text-xs font-bold ${margin < 0 ? "text-bad" : "text-good"}`} title="الهامش">{Number.isFinite(margin) ? (margin > 0 ? `+${margin}` : margin) : "—"}</span>
      <input aria-label="سعر البيع" className="input num !h-9 w-24 !px-2 text-end text-sm font-bold" inputMode="decimal" value={p} onChange={(e) => setP(e.target.value)} />
      <button type="button" onClick={save} disabled={!dirty || pending} className="btn-primary btn-sm !h-9 !px-2.5 disabled:opacity-30" aria-label="حفظ السعر">
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
      </button>
    </div>
  );
}

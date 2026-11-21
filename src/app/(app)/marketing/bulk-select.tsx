"use client";

import { createContext, useContext, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { CheckSquare, Loader2, Square, Trash2, X } from "lucide-react";
import { useToast } from "@/components/toast";
import { haptic } from "@/components/forms";
import { deleteItems } from "../actions/marketing";

type Ctx = { on: boolean; sel: Set<number>; toggle: (id: number) => void; all: boolean; toggleAll: () => void };
const C = createContext<Ctx | null>(null);

/** تحديد المنشورات (واحد / عدة / الكل) ثم حذفها — زر «تحديد» يفعّل وضع الاختيار */
export function BulkSelect({ ids, children }: { ids: number[]; children: React.ReactNode }) {
  const [on, setOn] = useState(false);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const all = ids.length > 0 && ids.every((i) => sel.has(i));

  const toggle = (id: number) => {
    haptic(5);
    setSel((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };
  const toggleAll = () => setSel(all ? new Set() : new Set(ids));
  const exit = () => {
    setOn(false);
    setSel(new Set());
  };
  const remove = () => {
    const list = Array.from(sel);
    if (!list.length) return;
    if (!window.confirm(list.length === 1 ? "حذف المنشور المحدد نهائياً؟" : `حذف ${list.length} منشوراً نهائياً؟ لا يمكن التراجع.`)) return;
    start(async () => {
      const r = await deleteItems(list);
      if (r.ok) {
        haptic(12);
        toast("success", `حُذف ${list.length === 1 ? "المنشور" : `${list.length} منشوراً`}`);
        exit();
        router.refresh();
      } else toast("error", r.error);
    });
  };

  return (
    <C.Provider value={{ on, sel, toggle, all, toggleAll }}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {!on ? (
          <button type="button" className="btn-secondary btn-sm" onClick={() => setOn(true)} disabled={!ids.length}>
            <CheckSquare className="h-4 w-4" /> تحديد
          </button>
        ) : (
          <>
            <button type="button" className="btn-secondary btn-sm" onClick={toggleAll}>
              {all ? <Square className="h-4 w-4" /> : <CheckSquare className="h-4 w-4" />} {all ? "إلغاء تحديد الكل" : `تحديد الكل (${ids.length})`}
            </button>
            <span className="text-sm font-bold text-ink-muted">المحدد: <b className="num text-ink">{sel.size}</b></span>
            <button type="button" className="btn-danger btn-sm" onClick={remove} disabled={!sel.size || pending}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} حذف{sel.size ? ` (${sel.size})` : ""}
            </button>
            <button type="button" className="btn-ghost btn-sm" onClick={exit} disabled={pending}>
              <X className="h-4 w-4" /> إلغاء
            </button>
          </>
        )}
      </div>
      {children}
    </C.Provider>
  );
}

export function SelectHead() {
  const c = useContext(C);
  if (!c?.on) return null;
  return (
    <th className="w-10">
      <input type="checkbox" aria-label="تحديد الكل" className="h-5 w-5 accent-[#0b2545]" checked={c.all} onChange={c.toggleAll} />
    </th>
  );
}

export function SelectCell({ id }: { id: number }) {
  const c = useContext(C);
  if (!c?.on) return null;
  const checked = c.sel.has(id);
  return (
    <td className={clsx("w-10", checked && "bg-gold/10")} onClick={() => c.toggle(id)}>
      <input type="checkbox" aria-label="تحديد" className="h-5 w-5 accent-[#0b2545]" checked={checked} onChange={() => c.toggle(id)} onClick={(e) => e.stopPropagation()} />
    </td>
  );
}

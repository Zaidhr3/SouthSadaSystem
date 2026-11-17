"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { History, Loader2, Pencil, Sparkles, Trash2, TrendingDown, TrendingUp, Upload } from "lucide-react";
import clsx from "clsx";
import { ActionForm, ConfirmButton, Grid, Input, ModalForm, Select, Textarea } from "@/components/forms";
import { BOQ_CATEGORY, BOQ_UNITS } from "@/lib/labels";
import type { PriceGroup } from "@/lib/pricing";
import { addBoqItem, deleteBoqItem, importBoqItems, lookupPriceHistory, updateBoqItem } from "../../actions/boq";

export type BoqRow = {
  id: number;
  itemNo: string | null;
  description: string;
  category: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  costPrice: number | null;
  supplier: string | null;
  specs: string | null;
  /** مستخرج آلياً: الصفحة والمرجع في المستند */
  source?: string | null;
  sourcePage?: number | null;
  sourceRef?: string | null;
  /** تعديل مدير المشروع على بند مستخرج (يظهر للمحاسب والإدارة) */
  editNote?: string | null;
  editedAt?: string | null;
};

const nf = new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 });
const money = (n: number) => `${nf.format(n)} د.أ`;

function UnitList() {
  return (
    <datalist id="boq-units">
      {BOQ_UNITS.map((u) => (
        <option key={u} value={u} />
      ))}
    </datalist>
  );
}

function ItemFields({ item }: { item?: BoqRow }) {
  return (
    <>
      <Grid>
        <Input name="itemNo" label="رقم البند" defaultValue={item?.itemNo ?? ""} />
        <Select name="category" label="التصنيف" options={BOQ_CATEGORY} defaultValue={item?.category ?? "OTHER"} />
      </Grid>
      <Textarea name="description" label="وصف البند" required defaultValue={item?.description} />
      <Grid cols={3}>
        <Input name="unit" label="الوحدة" required list="boq-units" defaultValue={item?.unit} />
        <Input name="quantity" label="الكمية" type="number" required defaultValue={item?.quantity} />
        <Input name="unitPrice" label="سعر الوحدة" type="number" required defaultValue={item?.unitPrice} />
      </Grid>
      <Grid cols={3}>
        <Input name="costPrice" label="التكلفة التقديرية" type="number" defaultValue={item?.costPrice ?? ""} />
        <Input name="supplier" label="المورد" defaultValue={item?.supplier ?? ""} />
        <Input name="specs" label="المواصفات" defaultValue={item?.specs ?? ""} />
      </Grid>
      <UnitList />
    </>
  );
}

function Trend({ pct }: { pct: number }) {
  if (Math.abs(pct) < 0.05) return <span className="text-ink-muted">ثابت</span>;
  const up = pct > 0;
  return (
    <span className={clsx("inline-flex items-center gap-0.5 font-bold", up ? "text-warn" : "text-good")}>
      {up ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
      <span className="num">{`${up ? "+" : ""}${pct.toFixed(1)}%`}</span>
    </span>
  );
}

/** مساعد التسعير الذكي: يعرض الأسعار التاريخية للبند أثناء الكتابة */
function PricingAssistant({ query, tenderId, onApply }: { query: string; tenderId: number; onApply: (g: PriceGroup, price: number) => void }) {
  const [groups, setGroups] = useState<PriceGroup[]>([]);
  const [pending, start] = useTransition();
  const [open, setOpen] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 3) {
      setGroups([]);
      return;
    }
    const n = ++seq.current;
    const timer = setTimeout(() => {
      start(async () => {
        const res = await lookupPriceHistory(q, tenderId);
        if (n === seq.current) setGroups(res);
      });
    }, 350);
    return () => clearTimeout(timer);
  }, [query, tenderId]);

  if (query.trim().length < 3) {
    return (
      <div className="flex h-full flex-col items-center justify-center rounded-2xl border border-dashed border-line p-6 text-center text-sm text-ink-muted">
        <Sparkles className="mb-2 h-6 w-6 text-accent" />
        ابدأ بكتابة وصف البند وسيعرض المساعد أسعارك السابقة له من كل العطاءات منذ 2018
      </div>
    );
  }

  return (
    <div className="space-y-3" aria-live="polite">
      <p className="flex items-center gap-2 text-sm font-bold">
        <History className="h-4 w-4 text-accent" /> السجل السعري
        {pending && <Loader2 className="h-4 w-4 animate-spin text-ink-muted" />}
      </p>
      {groups.length === 0 && !pending && <p className="rounded-xl bg-canvas p-4 text-sm text-ink-muted">لم يُسعّر هذا البند من قبل — سيُفهرس تلقائياً بعد الحفظ.</p>}
      {groups.map((g) => (
        <div key={g.key} className="rounded-2xl border border-line bg-white p-3.5">
          <p className="text-sm font-bold leading-snug">{g.description}</p>
          <p className="mt-1 text-[13px] text-ink-soft">
            سعّرت هذا البند <b>{g.count}</b> {g.count === 1 ? "مرة" : "مرات"} من قبل
            {g.count > 1 && (
              <>
                {" "}— من <b className="num">{nf.format(g.oldestPrice)}</b> ({g.oldestYear}) إلى <b className="num">{nf.format(g.latestPrice)}</b> ({g.latestYear}) <Trend pct={g.changePct} />
              </>
            )}
          </p>
          <div className="mt-2.5 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg bg-canvas px-2 py-1.5">
              <p className="text-[10px] text-ink-muted">آخر سعر</p>
              <p className="num text-sm font-bold">{nf.format(g.latestPrice)}</p>
            </div>
            <div className="rounded-lg bg-canvas px-2 py-1.5">
              <p className="text-[10px] text-ink-muted">المتوسط</p>
              <p className="num text-sm font-bold">{nf.format(g.avgPrice)}</p>
            </div>
            <div className="rounded-lg bg-accent-soft px-2 py-1.5">
              <p className="text-[10px] text-[#0058b0]">المقترح</p>
              <p className="num text-sm font-bold text-[#0058b0]">{nf.format(g.suggestedPrice)}</p>
            </div>
          </div>
          {g.count > 1 && (
            <p className="mt-2 text-xs text-ink-muted">
              التضخم السنوي التقريبي: <Trend pct={g.annualPct} /> — المدى {nf.format(g.minPrice)} – {nf.format(g.maxPrice)} لكل {g.unit}
            </p>
          )}
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            <button type="button" className="btn-primary btn-sm" onClick={() => onApply(g, g.suggestedPrice)}>
              استخدم المقترح
            </button>
            <button type="button" className="btn-secondary btn-sm" onClick={() => onApply(g, g.latestPrice)}>
              آخر سعر
            </button>
            <button type="button" className="btn-ghost btn-sm" onClick={() => setOpen(open === g.key ? null : g.key)}>
              {open === g.key ? "إخفاء" : "التفاصيل"}
            </button>
          </div>
          {open === g.key && (
            <ul className="mt-2 divide-y divide-line rounded-xl bg-canvas px-3 text-xs">
              {g.occurrences.map((o) => (
                <li key={o.boqItemId} className="flex items-center justify-between gap-2 py-2">
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{o.tenderName}</span>
                    <span className="text-ink-muted">
                      {o.year} — {o.entity}
                      {o.supplier ? ` — المورد: ${o.supplier}` : ""}
                      {o.specs ? ` — ${o.specs}` : ""}
                    </span>
                  </span>
                  <span className="num shrink-0 font-bold">{nf.format(o.unitPrice)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

function AddItemPanel({ tenderId }: { tenderId: number }) {
  const [k, setK] = useState(0);
  const [desc, setDesc] = useState("");
  const [unit, setUnit] = useState("");
  const [category, setCategory] = useState("OTHER");
  const [price, setPrice] = useState("");
  const [supplier, setSupplier] = useState("");
  const [specs, setSpecs] = useState("");
  const [qty, setQty] = useState("");

  const apply = (g: PriceGroup, p: number) => {
    setPrice(String(p));
    setUnit(g.unit);
    setCategory(g.category);
    const last = g.occurrences[0];
    if (last?.supplier && !supplier) setSupplier(last.supplier);
    if (last?.specs && !specs) setSpecs(last.specs);
  };

  const total = Number(qty) * Number(price);

  return (
    <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
      <ActionForm
        key={k}
        action={addBoqItem.bind(null, tenderId)}
        submitLabel="إضافة البند"
        onSuccess={() => {
          setK((x) => x + 1);
          setDesc("");
          setUnit("");
          setPrice("");
          setQty("");
          setSupplier("");
          setSpecs("");
        }}
        footer={Number.isFinite(total) && total > 0 ? <span className="me-auto text-sm text-ink-muted">المجموع: <b className="num text-ink">{money(total)}</b></span> : null}
      >
        <Textarea name="description" label="وصف البند" required rows={2} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="مثال: حديد تسليح محلي مطابق للمواصفة الأردنية / سخان أريستون 80 لتر" />
        <Grid cols={3}>
          <Input name="itemNo" label="رقم البند" />
          <Select name="category" label="التصنيف" options={BOQ_CATEGORY} value={category} onChange={(e) => setCategory(e.target.value)} />
          <Input name="unit" label="الوحدة" required list="boq-units" value={unit} onChange={(e) => setUnit(e.target.value)} />
        </Grid>
        <Grid cols={3}>
          <Input name="quantity" label="الكمية" type="number" required value={qty} onChange={(e) => setQty(e.target.value)} />
          <Input name="unitPrice" label="سعر الوحدة (د.أ)" type="number" required value={price} onChange={(e) => setPrice(e.target.value)} />
          <Input name="costPrice" label="التكلفة التقديرية" type="number" />
        </Grid>
        <Grid>
          <Input name="supplier" label="المورد" value={supplier} onChange={(e) => setSupplier(e.target.value)} />
          <Input name="specs" label="المواصفات" value={specs} onChange={(e) => setSpecs(e.target.value)} />
        </Grid>
        <UnitList />
      </ActionForm>
      <div className="lg:border-s lg:border-line lg:ps-5">
        <PricingAssistant query={desc} tenderId={tenderId} onApply={apply} />
      </div>
    </div>
  );
}

export function BoqEditor({ tenderId, items, canEdit, showEdits }: { tenderId: number; items: BoqRow[]; canEdit: boolean; showEdits?: boolean }) {
  const total = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
  const cost = items.reduce((s, i) => s + i.quantity * (i.costPrice ?? 0), 0);
  const hasCost = items.some((i) => i.costPrice);

  return (
    <div className="space-y-5">
      {canEdit && (
        <section className="card card-pad">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-[17px] font-bold">
              <Sparkles className="h-5 w-5 text-accent" /> إضافة بند بمساعدة التسعير الذكي
            </h2>
            <ModalForm title="استيراد بنود من Excel" trigger={<><Upload className="h-4 w-4" /> لصق من Excel</>} triggerClass="btn-secondary btn-sm" action={importBoqItems.bind(null, tenderId)} submitLabel="استيراد" wide>
              <p className="text-sm text-ink-muted">انسخ الأعمدة من Excel بالترتيب: <b>الوصف | الوحدة | الكمية | سعر الوحدة (اختياري)</b> والصقها هنا، كل بند في سطر.</p>
              <Select name="category" label="تصنيف البنود" options={BOQ_CATEGORY} defaultValue="OTHER" />
              <Textarea name="rows" label="البنود" rows={10} required dir="auto" placeholder={"خرسانة جاهزة للأساسات B300\tم³\t120\t58\nطوب إسمنتي 15 سم\tم²\t850\t9.5"} />
            </ModalForm>
          </div>
          <AddItemPanel tenderId={tenderId} />
        </section>
      )}

      <section className="card">
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-5 sm:px-6">
          <h2 className="text-[17px] font-bold">جدول الكميات المسعّر ({items.length} بند)</h2>
          <p className="text-sm">
            الإجمالي: <b className="num text-lg">{money(total)}</b>
            {hasCost && <span className="ms-3 text-ink-muted">هامش تقديري: <b className="num">{total > 0 ? (((total - cost) / total) * 100).toFixed(1) : 0}%</b></span>}
          </p>
        </div>
        {items.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-ink-muted">لا توجد بنود بعد</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>#</th>
                  <th>الوصف</th>
                  <th>التصنيف</th>
                  <th>الوحدة</th>
                  <th className="text-end">الكمية</th>
                  <th className="text-end">سعر الوحدة</th>
                  <th className="text-end">المجموع</th>
                  {canEdit && <th />}
                </tr>
              </thead>
              <tbody>
                {items.map((i, idx) => (
                  <tr key={i.id}>
                    <td className="num text-ink-muted">{i.itemNo || idx + 1}</td>
                    <td className="max-w-[360px]">
                      <span className="block font-semibold">{i.description}</span>
                      {(i.supplier || i.specs) && <span className="text-xs text-ink-muted">{[i.supplier, i.specs].filter(Boolean).join(" — ")}</span>}
                      {i.source === "AI" && (
                        <span className="mt-1 me-1 inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-[#0058b0]">
                          <Sparkles className="h-3 w-3" aria-hidden /> مستخرج آلياً{i.sourcePage ? ` — ص ${i.sourcePage}` : ""}{i.sourceRef ? ` — ${i.sourceRef}` : ""}
                        </span>
                      )}
                      {showEdits && i.editNote && (
                        <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-bad px-2 py-0.5 text-[11px] font-bold text-white" title={i.editedAt ?? ""}>
                          ⚠ عدّله مدير المشروع: {i.editNote}
                        </span>
                      )}
                    </td>
                    <td className="text-ink-soft">{BOQ_CATEGORY[i.category] ?? i.category}</td>
                    <td>{i.unit}</td>
                    <td className="num text-end">{nf.format(i.quantity)}</td>
                    <td className="num text-end">{nf.format(i.unitPrice)}</td>
                    <td className="num text-end font-bold">{nf.format(i.quantity * i.unitPrice)}</td>
                    {canEdit && (
                      <td className="whitespace-nowrap text-end">
                        <ModalForm title="تعديل البند" trigger={<Pencil className="h-4 w-4" />} triggerClass="btn-ghost btn-sm" action={updateBoqItem.bind(null, i.id)} wide>
                          <ItemFields item={i} />
                        </ModalForm>
                        <ConfirmButton action={deleteBoqItem.bind(null, i.id)} confirm="حذف هذا البند؟" className="btn-danger btn-sm" title="حذف">
                          <Trash2 className="h-4 w-4" />
                        </ConfirmButton>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={6} className="px-5 py-3 text-end font-bold sm:px-6">الإجمالي</td>
                  <td className="num px-3 py-3 text-end text-base font-bold">{nf.format(total)}</td>
                  {canEdit && <td />}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

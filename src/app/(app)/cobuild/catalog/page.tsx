import clsx from "clsx";
import { Layers, Pencil, Percent, Plus, Power, Sparkles, Trash2 } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { Badge, Card, EmptyState, Money, PageHeader, StatusBadge } from "@/components/ui";
import { ActionForm, ConfirmButton, Grid, Input, ModalForm, Select, Textarea } from "@/components/forms";
import { MODE, PHASES, PHASE_LABEL, UNITS, priceOf } from "@/lib/cobuild-core";
import { bulkAdjust, deleteCatalogItem, saveCatalogItem, seedCatalog, toggleCatalogItem } from "../../actions/cobuild";
import { PriceCell } from "./price-cell";

export const metadata = { title: "كتالوج المواد والأسعار — السكن التشاركي" };
export const dynamic = "force-dynamic";

type Item = Awaited<ReturnType<typeof db.catalogItem.findMany>>[number];

function ItemFields({ it }: { it?: Item }) {
  return (
    <>
      <Grid>
        <Select name="phase" label="المرحلة" options={PHASES.map((p) => ({ value: p.key, label: p.label }))} defaultValue={it?.phase ?? "PLASTER_FLOOR"} />
        <Input name="category" label="الفئة" defaultValue={it?.category ?? ""} placeholder="مثال: الأرضيات" />
      </Grid>
      <Input name="name" label="اسم البند" required defaultValue={it?.name ?? ""} />
      <Textarea name="specs" label="المواصفات" rows={2} defaultValue={it?.specs ?? ""} />
      <Grid cols={3}>
        <Select name="unit" label="الوحدة" options={UNITS.map((u) => ({ value: u, label: u }))} defaultValue={it?.unit ?? "م²"} />
        <Input name="unitCost" label="الكلفة (د.أ)" type="number" required defaultValue={it?.unitCost ?? ""} />
        <Input name="price" label="سعر البيع (د.أ)" type="number" required defaultValue={it ? priceOf(it) : ""} hint="الهامش = السعر − الكلفة" />
      </Grid>
      <Grid cols={3}>
        <Select name="mode" label="نوع البند" options={Object.fromEntries(Object.entries(MODE).map(([k, v]) => [k, v.label]))} defaultValue={it?.mode ?? "OPTION"} />
        <Input name="choiceGroup" label="مجموعة خيارات (اختياري)" dir="ltr" defaultValue={it?.choiceGroup ?? ""} placeholder="FLOOR" hint="بنود نفس المجموعة: يُختار واحد فقط" />
        <Input name="qtyPerSqm" label="الكمية لكل م² من الشقة" type="number" defaultValue={it?.qtyPerSqm ?? 0} hint="0 = كمية ثابتة" />
      </Grid>
      <Grid cols={3}>
        <Input name="defaultQty" label="الكمية الثابتة/الافتراضية" type="number" defaultValue={it?.defaultQty ?? 1} />
        <label className="mt-7 flex items-center gap-2 text-sm font-semibold"><input type="checkbox" name="qtyEditable" defaultChecked={it?.qtyEditable ?? false} /> المالك يحدد الكمية</label>
        <label className="mt-7 flex items-center gap-2 text-sm font-semibold"><input type="checkbox" name="isPublic" defaultChecked={it?.isPublic ?? true} /> يظهر في حاسبة الموقع</label>
      </Grid>
    </>
  );
}

export default async function CatalogPage({ searchParams }: { searchParams: { phase?: string } }) {
  const user = await requireUser();
  const manage = can.manageCoBuild(user.role);
  const seeCost = manage || can.seeProfit(user.role);
  const phase = PHASE_LABEL[searchParams.phase ?? ""] ? searchParams.phase! : "ALL";
  const items = await db.catalogItem.findMany({ where: phase === "ALL" ? {} : { phase }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] });
  const locked = await db.coBuildSelection.groupBy({ by: ["itemId"], where: { lockedPrice: { not: null } }, _count: true });
  const lockedMap = new Map(locked.map((l) => [l.itemId, l._count]));
  const categories = Array.from(new Set(items.map((i) => i.category)));

  return (
    <>
      <PageHeader
        back={{ href: "/cobuild", label: "السكن التشاركي" }}
        title="كتالوج المواد والأعمال"
        subtitle="من العظم إلى مفتاح الشقة — كل الأسعار داخلية وتُعدَّل يدوياً فقط (لا أسعار خارجية تلقائية). تعديل الكتالوج لا يغيّر أسعار المشترين المقفولة."
        actions={
          manage && (
            <>
              <ModalForm trigger={<><Plus className="h-4 w-4" /> بند جديد</>} title="بند جديد في الكتالوج" action={saveCatalogItem.bind(null, null)} wide>
                <ItemFields />
              </ModalForm>
              <ModalForm triggerClass="btn-secondary" trigger={<><Percent className="h-4 w-4" /> تعديل جماعي</>} title="تعديل جماعي للأسعار" action={bulkAdjust} submitLabel="طبّق التعديل">
                <Grid>
                  <Select name="phase" label="النطاق" options={[{ value: "ALL", label: "كل المراحل" }, ...PHASES.map((p) => ({ value: p.key, label: p.label }))]} defaultValue={phase} />
                  <Input name="category" label="فئة محددة (اختياري)" list="cat-list" placeholder="كل الفئات" />
                </Grid>
                <datalist id="cat-list">{categories.map((c) => <option key={c} value={c} />)}</datalist>
                <Grid cols={3}>
                  <Select name="target" label="ما يُعدَّل" options={{ price: "سعر البيع", margin: "الهامش فقط", cost: "الكلفة فقط" }} />
                  <Select name="type" label="النوع" options={{ pct: "نسبة %", amount: "مبلغ د.أ" }} />
                  <Input name="value" label="القيمة (موجبة أو سالبة)" type="number" required placeholder="مثال: 5 أو -3" />
                </Grid>
                <p className="text-xs text-ink-muted">مبلغ على «سعر البيع» يُضاف للهامش (الكلفة الفعلية ثابتة). النسبة على سعر البيع تغيّر الكلفة والهامش بنفس النسبة. الحد: −50% إلى +100%.</p>
              </ModalForm>
            </>
          )
        }
      />

      <nav className="mb-4 flex gap-1 overflow-x-auto rounded-2xl bg-black/[0.04] p-1">
        {[{ key: "ALL", short: "الكل" }, ...PHASES].map((p) => (
          <a key={p.key} href={`/cobuild/catalog?phase=${p.key}`} className={clsx("whitespace-nowrap rounded-xl px-3 py-1.5 text-sm font-bold transition", phase === p.key ? "bg-white text-accent shadow-card" : "text-ink-muted hover:text-ink")}>
            {p.short}
          </a>
        ))}
      </nav>

      {items.length === 0 ? (
        <Card>
          <EmptyState icon={Layers} title="الكتالوج فارغ" hint="عبّئ القالب المبدئي (51 بنداً من العظم إلى المفتاح) ثم عدّل أسعاره" />
          {manage && (
            <div className="mx-auto max-w-sm pb-4">
              <ActionForm action={seedCatalog} submitLabel="عبّئ القالب المبدئي">
                <span />
              </ActionForm>
            </div>
          )}
        </Card>
      ) : (
        PHASES.filter((p) => phase === "ALL" || p.key === phase).map((p) => {
          const rows = items.filter((i) => i.phase === p.key);
          if (!rows.length) return null;
          return (
            <Card key={p.key} pad={false} className="mb-5" title={<span className="flex items-center gap-2 px-1"><Layers className="h-5 w-5 text-gold" /> {p.label} <Badge tone="gray">{rows.length}</Badge></span>}>
              <div className="overflow-x-auto">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>البند</th>
                      <th>الوحدة</th>
                      <th>النوع</th>
                      <th>الكمية</th>
                      <th>{seeCost ? "الكلفة · الهامش · سعر البيع" : "السعر"}</th>
                      {manage && <th />}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((it) => (
                      <tr key={it.id} className={clsx(!it.isActive && "opacity-45")}>
                        <td className="min-w-[240px] max-w-[380px]">
                          <span className="block font-bold">{it.name}</span>
                          <span className="block text-xs text-ink-muted">{it.category}{it.specs ? ` — ${it.specs}` : ""}</span>
                          <span className="mt-0.5 flex flex-wrap gap-1">
                            <Badge tone="gray" className="!text-[10px]">{it.code}</Badge>
                            {it.choiceGroup && <Badge tone="purple" className="!text-[10px]">مجموعة {it.choiceGroup}</Badge>}
                            {!it.isPublic && <Badge tone="gray" className="!text-[10px]">داخلي</Badge>}
                            {lockedMap.get(it.id) ? <Badge tone="blue" className="!text-[10px]">مقفول لـ {lockedMap.get(it.id)} شقق</Badge> : null}
                          </span>
                        </td>
                        <td className="whitespace-nowrap">{it.unit}</td>
                        <td><StatusBadge map={MODE} value={it.mode} /></td>
                        <td className="whitespace-nowrap text-xs text-ink-muted">{it.qtyPerSqm > 0 ? `${it.qtyPerSqm} × المساحة` : `${it.defaultQty} ثابتة`}{it.qtyEditable ? " · يحددها المالك" : ""}</td>
                        <td>{manage ? <PriceCell id={it.id} cost={it.unitCost} price={priceOf(it)} /> : seeCost ? <span className="text-sm"><Money value={it.unitCost} /> · <Money value={it.margin} /> · <Money value={priceOf(it)} strong /></span> : <Money value={priceOf(it)} strong />}</td>
                        {manage && (
                          <td className="whitespace-nowrap">
                            <ModalForm triggerClass="btn-ghost btn-sm" trigger={<Pencil className="h-4 w-4" />} title={`تعديل: ${it.name}`} action={saveCatalogItem.bind(null, it.id)} wide>
                              <ItemFields it={it} />
                            </ModalForm>
                            <ConfirmButton action={toggleCatalogItem.bind(null, it.id)} title={it.isActive ? "إيقاف" : "تفعيل"}><Power className={clsx("h-4 w-4", it.isActive ? "text-good" : "text-ink-faint")} /></ConfirmButton>
                            <ConfirmButton action={deleteCatalogItem.bind(null, it.id)} confirm={`حذف «${it.name}»؟`} title="حذف"><Trash2 className="h-4 w-4 text-bad" /></ConfirmButton>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          );
        })
      )}
      {manage && items.length > 0 && (
        <details className="card card-pad">
          <summary className="flex cursor-pointer list-none items-center gap-2 font-bold"><Sparkles className="h-5 w-5 text-gold" /> إضافة بنود القالب الناقصة</summary>
          <p className="my-2 text-sm text-ink-muted">يضيف فقط بنود القالب غير الموجودة (حسب الرمز) — لا يغيّر أي سعر عدّلته.</p>
          <ActionForm action={seedCatalog} submitLabel="أضف الناقص"><span /></ActionForm>
        </details>
      )}
    </>
  );
}

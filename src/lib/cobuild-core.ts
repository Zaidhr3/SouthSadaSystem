/**
 * السكن التشاركي «من العظم إلى المفتاح» — منطق نقي مشترك (الخادم، البوابة، الحاسبة):
 * التسميات، سعر البند، الكمية الافتراضية، وتفصيل السعر الحي.
 * لا يستورد قاعدة البيانات — آمن للاستخدام داخل مكونات العميل.
 */
import type { Tone } from "./labels";

export const PHASES: { key: string; label: string; short: string }[] = [
  { key: "LAND_SKELETON", label: "الأرض والعظم والهيكل الإنشائي", short: "العظم" },
  { key: "FACADE", label: "الواجهات والأعمال الخارجية", short: "الواجهات" },
  { key: "MEP", label: "التأسيسات الكهروميكانيكية", short: "التأسيسات" },
  { key: "PLASTER_FLOOR", label: "القصارة والأرضيات والبلاط", short: "الأرضيات" },
  { key: "PAINT_CEIL", label: "الدهانات والأسقف والجبصين", short: "الدهان والجبصين" },
  { key: "DOORS_KITCHEN", label: "الأبواب والنجارة والمطابخ", short: "الأبواب والمطابخ" },
  { key: "FIXTURES_HANDOVER", label: "الأدوات الصحية والكهربائيات النهائية والتسليم", short: "التسليم" },
];
export const PHASE_LABEL: Record<string, string> = Object.fromEntries(PHASES.map((p) => [p.key, p.label]));

export const UNITS = ["م²", "م.ط", "قطعة", "مقطوعية", "نقطة", "طقم"] as const;

export const MODE: Record<string, { label: string; tone: Tone; hint: string }> = {
  INCLUDED: { label: "ضمن سعر العظم", tone: "gray", hint: "مشمول في سعر الشقة على العظم — للشفافية فقط ولا يُضاف للمجموع" },
  REQUIRED: { label: "إلزامي للتسليم", tone: "blue", hint: "يُضاف تلقائياً لكل شقة تُسلَّم مفتاح" },
  OPTION: { label: "اختياري", tone: "green", hint: "يختاره المالك من المكوّن" },
};

export const PROJECT_STATUS: Record<string, { label: string; tone: Tone }> = {
  collecting_buyers: { label: "جمع الملتزمين", tone: "orange" },
  ready_to_launch: { label: "جاهز للانطلاق «تم»", tone: "purple" },
  in_construction_skeleton: { label: "تنفيذ العظم", tone: "blue" },
  finishing: { label: "مرحلة التشطيب", tone: "blue" },
  handover_completed: { label: "سُلّم المفتاح", tone: "green" },
  cancelled_reset: { label: "أُلغي وأُعيدت الشيكات", tone: "red" },
};
/** المشروع ما زال قبل «تم» (يقبل الانضمام والانسحاب المجاني وتتراكم حوافز الانتظار) */
export const PRE_LAUNCH = ["collecting_buyers", "ready_to_launch"];
export const LAUNCHED = ["in_construction_skeleton", "finishing", "handover_completed"];

export const UNIT_STATUS: Record<string, { label: string; tone: Tone }> = {
  available: { label: "متاحة", tone: "green" },
  reserved_cheque_held: { label: "محجوزة — الشيك بالأمانة", tone: "orange" },
  locked_active: { label: "مثبّتة — قيد التنفيذ", tone: "blue" },
  handed_over: { label: "سُلّمت", tone: "gray" },
};

export const BUYER_STATUS: Record<string, { label: string; tone: Tone }> = {
  ACTIVE: { label: "ملتزم", tone: "orange" },
  CONTRACTED: { label: "وقّع العقد", tone: "blue" },
  WITHDRAWN: { label: "انسحب", tone: "red" },
  HANDED_OVER: { label: "استلم المفتاح", tone: "green" },
};
export const ACTIVE_BUYER = ["ACTIVE", "CONTRACTED", "HANDED_OVER"];

export const CUSTODY: Record<string, { label: string; tone: Tone }> = {
  held_pending_go: { label: "بالأمانة حتى «تم»", tone: "orange" },
  released_on_go: { label: "حُرِّر عند «تم»", tone: "blue" },
  returned_withdrawn: { label: "أُعيد للمشتري", tone: "gray" },
  forfeited_or_settled: { label: "سُوّي / صودر بقرار", tone: "red" },
};

export const CREDIT_KIND: Record<string, string> = {
  WAITING: "حافز انتظار",
  REFERRER: "جيب جارك — للمُحيل",
  REFERRED: "جيب جارك — للجار",
  EARLY_BIRD: "الملتزمون الأوائل",
  CLOSER: "مكمّل المجموعة",
};
export const CREDIT_STATUS: Record<string, { label: string; tone: Tone }> = {
  ACCRUED: { label: "مستحق — يُطبَّق عند «تم»", tone: "orange" },
  APPLIED: { label: "مطبّق على رصيدك", tone: "green" },
  FORFEITED: { label: "سقط بالانسحاب", tone: "red" },
};

export const TASK_KIND: Record<string, string> = { PAYMENT: "دفعة", SELECTION: "اختيار تشطيب", SIGNOFF: "موافقة وتوقيع", HANDOVER: "بند تسليم" };

export type CatalogLite = {
  id: number;
  code: string;
  phase: string;
  category: string;
  name: string;
  specs: string | null;
  unit: string;
  price: number;
  mode: string;
  choiceGroup: string | null;
  qtyPerSqm: number;
  defaultQty: number;
  qtyEditable: boolean;
};

export const r3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;
export const priceOf = (i: { unitCost: number; margin: number }) => r3(i.unitCost + i.margin);

/** الكمية الافتراضية للبند لشقة بمساحة معينة */
export const defaultQtyFor = (i: { qtyPerSqm: number; defaultQty: number }, areaSqm: number) => (i.qtyPerSqm > 0 ? Math.round(areaSqm * i.qtyPerSqm * 10) / 10 : i.defaultQty);

/** حدود الكمية التي يحددها المالك (للبنود القابلة للتعديل) */
export const QTY_MAX = 200;

export type Line = { itemId: number; qty: number; price: number };

/** تفصيل السعر: العظم + بنود التشطيب − الحوافز = التقدير */
export function estimate(o: { skeletonPrice: number; lines: Line[]; credits: number }) {
  const finishing = r3(o.lines.reduce((s, l) => s + l.qty * l.price, 0));
  const credits = r3(Math.max(0, o.credits));
  return { base: r3(o.skeletonPrice), finishing, credits, total: r3(o.skeletonPrice + finishing - credits) };
}

/**
 * يطبّق قواعد الاختيار على بنود المالك: البنود الإلزامية دائماً موجودة، خيار واحد من كل مجموعة،
 * وكمية البنود غير القابلة للتعديل = الافتراضية حسب المساحة.
 */
export function normalizeSelection(items: CatalogLite[], picked: { itemId: number; qty: number }[], areaSqm: number) {
  const byId = new Map(items.map((i) => [i.id, i]));
  const out = new Map<number, number>();
  const groups = new Map<string, number>();
  for (const p of picked) {
    const it = byId.get(p.itemId);
    if (!it || it.mode === "INCLUDED") continue;
    if (it.choiceGroup) {
      const prev = groups.get(it.choiceGroup);
      if (prev != null) out.delete(prev);
      groups.set(it.choiceGroup, it.id);
    }
    const q = it.qtyEditable ? Math.min(QTY_MAX, Math.max(0, Math.round(Number(p.qty) || 0))) : defaultQtyFor(it, areaSqm);
    if (q > 0) out.set(it.id, q);
  }
  for (const it of items) {
    if (it.mode !== "REQUIRED" || out.has(it.id)) continue;
    if (it.choiceGroup && groups.has(it.choiceGroup)) continue;
    out.set(it.id, defaultQtyFor(it, areaSqm));
    if (it.choiceGroup) groups.set(it.choiceGroup, it.id);
  }
  return Array.from(out, ([itemId, qty]) => ({ itemId, qty }));
}

/** عدد الأشهر الكاملة بين تاريخين (تقويمياً) */
export function wholeMonths(from: Date, to: Date) {
  let m = (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
  if (to.getUTCDate() < from.getUTCDate()) m--;
  return Math.max(0, m);
}

/** الشهر الحالي للمشتري منذ التزامه (الشهر الأول = 1) */
export const buyerMonth = (joinedAt: Date, until: Date) => wholeMonths(joinedAt, until) + 1;

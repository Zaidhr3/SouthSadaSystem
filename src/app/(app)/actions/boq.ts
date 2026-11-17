"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { actionUser } from "@/lib/auth";
import { auditEvent, run, runVoid, type ActionState } from "@/lib/action";
import { AppError, can, type AppUser } from "@/lib/permissions";
import { BOQ_CATEGORY } from "@/lib/labels";
import { normalizeText, searchPriceHistory, type PriceGroup } from "@/lib/pricing";
import { notify } from "@/lib/notify";
import { fmtJOD } from "@/lib/format";
import { formObject, zEnum, zMoney, zOptMoney, zOptText, zPositiveMoney, zText } from "@/lib/validation";

const itemSchema = z.object({
  itemNo: zOptText,
  description: zText("وصف البند"),
  category: zEnum(BOQ_CATEGORY, "التصنيف"),
  unit: zText("الوحدة"),
  quantity: zPositiveMoney("الكمية"),
  unitPrice: zMoney("سعر الوحدة"),
  costPrice: zOptMoney,
  supplier: zOptText,
  specs: zOptText,
});

/**
 * المرحلة أ — جدول الكميات:
 *  يدخله مدير المشروع المسند (أو المدير العام)، ويعتمده المحاسب كأساس تعاقدي.
 *  بعد الاعتماد تُقفل الأسعار والكميات — أي تغيير يتم بأمر تغيير يعتمده المدير العام.
 */
async function assertBoqEditable(user: AppUser, tenderId: number) {
  const t = await db.tender.findUnique({ where: { id: tenderId }, select: { managerId: true, boqApprovedAt: true } });
  if (!t) throw new AppError("العطاء غير موجود");
  const allowed = user.role === "ADMIN" || (user.role === "PM" && t.managerId === user.id);
  if (!allowed) throw new AppError("إدخال جدول الكميات لمدير المشروع المسند أو المدير العام");
  if (t.boqApprovedAt) throw new AppError("جدول الكميات معتمد ومقفل — التعديل يتم بأمر تغيير يعتمده المدير العام");
}

async function markPricing(tenderId: number) {
  await db.tender.updateMany({ where: { id: tenderId, status: "PURCHASED" }, data: { status: "PRICING" } });
}

export async function addBoqItem(tenderId: number, _: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await actionUser();
    await assertBoqEditable(user, tenderId);
    const data = itemSchema.parse(formObject(fd));
    const max = await db.boqItem.aggregate({ where: { tenderId }, _max: { sortOrder: true } });
    await db.boqItem.create({
      data: { ...data, tenderId, normalized: normalizeText(data.description), sortOrder: (max._max.sortOrder ?? 0) + 1 },
    });
    await markPricing(tenderId);
    revalidatePath(`/tenders/${tenderId}`);
    return "تمت إضافة البند وفهرسته في مكتبة الأسعار";
  });
}

export async function updateBoqItem(id: number, _: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await actionUser();
    const current = await db.boqItem.findUnique({ where: { id }, select: { tenderId: true, source: true, description: true, unit: true, quantity: true, unitPrice: true } });
    if (!current) throw new AppError("البند غير موجود");
    await assertBoqEditable(user, current.tenderId);
    const data = itemSchema.parse(formObject(fd));
    // التسعير دور مدير المشروع — أما تعديله لوصف أو وحدة أو كمية بند مستخرج آلياً فيظهر بشارة للمحاسب والإدارة
    const changes = [
      data.description !== current.description && "الوصف",
      data.unit !== current.unit && "الوحدة",
      data.quantity !== current.quantity && `الكمية ${current.quantity}←${data.quantity}`,
    ].filter(Boolean).join("، ");
    const flag = user.role === "PM" && current.source === "AI" && changes ? { editedById: user.id, editedAt: new Date(), editNote: changes } : {};
    const item = await db.boqItem.update({ where: { id }, data: { ...data, ...flag, normalized: normalizeText(data.description) } });
    revalidatePath(`/tenders/${item.tenderId}`);
    return "تم تحديث البند";
  });
}

export async function deleteBoqItem(id: number) {
  const result = await runVoid(async () => {
    const user = await actionUser();
    const current = await db.boqItem.findUnique({ where: { id }, select: { tenderId: true } });
    if (!current) throw new AppError("البند غير موجود");
    await assertBoqEditable(user, current.tenderId);
    const item = await db.boqItem.delete({ where: { id } });
    revalidatePath(`/tenders/${item.tenderId}`);
  });
  return result;
}

/**
 * استيراد بنود ملصوقة من Excel: كل سطر = الوصف ⇥ الوحدة ⇥ الكمية ⇥ سعر الوحدة (اختياري)
 */
export async function importBoqItems(tenderId: number, _: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await actionUser();
    await assertBoqEditable(user, tenderId);
    const category = String(fd.get("category") ?? "OTHER");
    if (!(category in BOQ_CATEGORY)) throw new AppError("التصنيف غير صالح");
    const raw = String(fd.get("rows") ?? "").trim();
    if (!raw) throw new AppError("الصق البنود أولاً");
    const max = await db.boqItem.aggregate({ where: { tenderId }, _max: { sortOrder: true } });
    let order = max._max.sortOrder ?? 0;
    const rows = raw.split(/\r?\n/).map((l) => l.split(/\t|\s{2,}|;/).map((c) => c.trim())).filter((c) => c[0]);
    const data = [];
    for (const [i, cols] of rows.entries()) {
      const [description, unit, qty, price] = cols;
      const quantity = Number((qty ?? "").replace(/,/g, ""));
      const unitPrice = price ? Number(price.replace(/,/g, "")) : 0;
      if (!description || !unit || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitPrice)) {
        throw new AppError(`السطر ${i + 1} غير صالح: يجب أن يحتوي الوصف والوحدة والكمية`);
      }
      data.push({ tenderId, description, normalized: normalizeText(description), unit, quantity, unitPrice, category, sortOrder: ++order });
    }
    await db.boqItem.createMany({ data });
    await markPricing(tenderId);
    revalidatePath(`/tenders/${tenderId}`);
    return `تم استيراد ${data.length} بنداً`;
  });
}

/** المحاسب (أو المدير العام) يعتمد جدول الكميات كأساس تعاقدي ويقفله */
export async function approveBoqBaseline(tenderId: number) {
  const result = await runVoid(async () => {
    const user = await actionUser(can.manageFinance);
    const t = await db.tender.findUnique({ where: { id: tenderId }, include: { boqItems: { select: { quantity: true, unitPrice: true } } } });
    if (!t) throw new AppError("العطاء غير موجود");
    if (t.boqApprovedAt) throw new AppError("جدول الكميات معتمد مسبقاً");
    if (t.boqItems.length === 0) throw new AppError("لا توجد بنود لاعتمادها");
    if (t.boqItems.some((b) => b.unitPrice <= 0)) throw new AppError("يوجد بنود بدون سعر وحدة — يجب تسعيرها قبل الاعتماد");
    const total = t.boqItems.reduce((s, b) => s + b.quantity * b.unitPrice, 0);
    await db.tender.update({ where: { id: tenderId }, data: { boqApprovedAt: new Date(), boqApprovedById: user.id } });
    await auditEvent("workflow", "Tender", `اعتماد جدول الكميات التعاقدي — ${t.name} (#${t.id}) — ${t.boqItems.length} بنداً بإجمالي ${fmtJOD(total)}`, user);
    await notify(["ADMIN", { managerOf: tenderId }], { title: "اعتُمد جدول الكميات التعاقدي", body: `${t.name} — ${t.boqItems.length} بنداً — ${fmtJOD(total)}. الأسعار والكميات مقفلة الآن`, href: `/tenders/${tenderId}?tab=boq` }, { exclude: user.id });
  });
  revalidatePath("/", "layout");
  return result;
}

/** المدير العام فقط: فك قفل جدول الكميات (استثناء) */
export async function unlockBoqBaseline(tenderId: number) {
  const result = await runVoid(async () => {
    const user = await actionUser(can.manageTenders);
    const t = await db.tender.findUnique({ where: { id: tenderId } });
    if (!t?.boqApprovedAt) throw new AppError("جدول الكميات غير مقفل");
    await db.tender.update({ where: { id: tenderId }, data: { boqApprovedAt: null, boqApprovedById: null } });
    await auditEvent("workflow", "Tender", `فك قفل جدول الكميات — ${t.name} (#${t.id})`, user);
  });
  revalidatePath("/", "layout");
  return result;
}

/** مساعد التسعير الذكي: يُستدعى أثناء الكتابة */
export async function lookupPriceHistory(query: string, tenderId?: number): Promise<PriceGroup[]> {
  const user = await actionUser(undefined, { readOnlyOk: true });
  if (!can.viewAll(user.role) && user.role !== "PM") return [];
  if (query.trim().length < 2) return [];
  const groups = await searchPriceHistory(query, { excludeTenderId: tenderId, limit: 200 });
  return groups.slice(0, 6).map((g) => ({ ...g, occurrences: g.occurrences.slice(0, 8) }));
}

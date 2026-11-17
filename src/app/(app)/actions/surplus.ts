"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { actionUser, assertTenderAccess } from "@/lib/auth";
import { auditEvent, run, runVoid, type ActionState } from "@/lib/action";
import { AppError, can } from "@/lib/permissions";
import { round3, todayUTC } from "@/lib/format";
import { formObject, zOptId, zOptMoney, zOptText, zPositiveMoney, zText } from "@/lib/validation";

const refresh = () => revalidatePath("/", "layout");

const itemSchema = z.object({
  material: zText("المادة"),
  unit: zText("الوحدة"),
  quantity: zPositiveMoney("الكمية"),
  unitCost: zOptMoney,
  fromTenderId: zOptId,
  location: zOptText,
  notes: zOptText,
});

/** إدخال مادة فائضة للمستودع (متبقي من مشروع أو مخزون الشركة) */
export async function addSurplus(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await actionUser(can.manageProjectLifecycle);
    const d = itemSchema.parse(formObject(fd));
    if (d.fromTenderId) await assertTenderAccess(user, d.fromTenderId);
    const it = await db.surplusItem.create({ data: { ...d, createdById: user.id } });
    await auditEvent("create", "SurplusItem", `إدخال فائض: ${d.material} ${d.quantity} ${d.unit}`, user, { recordId: it.id });
    refresh();
    return "أُضيفت المادة لمستودع الفائض";
  });
}

const allocSchema = z.object({ toTenderId: zOptId, quantity: zPositiveMoney("الكمية") });

/**
 * تدوير فائض لمشروع: يُسجَّل كتوريد مواد في المشروع المستلم (بتكلفته الدفترية إن وُجدت)
 * ويُنقص المخزون — وعند نفاده تُعلَّم المادة «مُدوَّرة».
 */
export async function allocateSurplus(id: number, _: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await actionUser(can.manageProjectLifecycle);
    const d = allocSchema.parse(formObject(fd));
    if (!d.toTenderId) throw new AppError("اختر المشروع المستلم");
    await assertTenderAccess(user, d.toTenderId);
    const it = await db.surplusItem.findUnique({ where: { id } });
    if (!it || it.status !== "AVAILABLE") throw new AppError("المادة غير متاحة");
    if (d.quantity > it.quantity + 1e-9) throw new AppError(`الكمية المتاحة ${it.quantity} ${it.unit} فقط`);
    const left = round3(it.quantity - d.quantity);
    const to = await db.tender.findUniqueOrThrow({ where: { id: d.toTenderId }, select: { name: true } });
    await db.$transaction([
      db.materialReceipt.create({
        data: { tenderId: d.toTenderId, material: it.material, unit: it.unit, quantity: d.quantity, unitCost: it.unitCost, supplier: "مستودع الفائض (تدوير)", date: todayUTC(), notes: `تدوير من مستودع الفائض${it.location ? ` — ${it.location}` : ""}`, receivedById: user.id },
      }),
      db.surplusItem.update({
        where: { id },
        data: left > 0 ? { quantity: left } : { quantity: 0, status: "ALLOCATED", toTenderId: d.toTenderId, allocatedQty: d.quantity, allocatedAt: new Date() },
      }),
    ]);
    await auditEvent("workflow", "SurplusItem", `تدوير ${d.quantity} ${it.unit} ${it.material} إلى ${to.name}`, user, { recordId: id });
    refresh();
    return `دُوِّرت ${d.quantity} ${it.unit} إلى ${to.name}`;
  });
}

export async function deleteSurplus(id: number) {
  const result = await runVoid(async () => {
    const user = await actionUser(can.manageFinance);
    await db.surplusItem.delete({ where: { id } });
    await auditEvent("delete", "SurplusItem", `حذف مادة فائضة #${id}`, user, { recordId: id });
  });
  refresh();
  return result;
}

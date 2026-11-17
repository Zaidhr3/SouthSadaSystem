"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { actionUser } from "@/lib/auth";
import { run, runVoid, type ActionState } from "@/lib/action";
import { AppError, can } from "@/lib/permissions";
import { removeLinkedBankTx, upsertLinkedBankTx } from "@/lib/finance";
import { recordLiability, taxSummary } from "@/lib/tax";
import { fmtJOD, round3 } from "@/lib/format";
import { auditEvent } from "@/lib/action";
import { getSettings } from "@/lib/settings";
import { formObject, zDate, zOptId, zOptMoney, zOptText, zText } from "@/lib/validation";

const refresh = () => revalidatePath("/", "layout");

const liabilitySchema = z.object({
  tenderId: zOptId,
  claimId: zOptId,
  base: zOptMoney,
  rate: z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number({ invalid_type_error: "النسبة غير صالحة" }).min(0).max(100, "النسبة بين 0 و 100").nullable()),
  amount: zOptMoney,
  date: zDate("التاريخ"),
  description: zText("البيان"),
  reference: zOptText,
});

/** تسجيل مديونية ضريبية (يدوياً أو من قبض مطالبة) — يُبلَّغ المدير العام والمحاسب فوراً بالزيادة */
export async function addTaxLiability(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await actionUser(can.manageFinance);
    const d = liabilitySchema.parse(formObject(fd));
    const amount = d.amount ?? (d.base != null && d.rate != null ? round3(d.base * (d.rate / 100)) : null);
    if (!amount || amount <= 0) throw new AppError("أدخل مبلغ الضريبة، أو الأساس والنسبة");
    if (d.claimId) {
      const c = await db.claim.findUnique({ where: { id: d.claimId } });
      if (!c) throw new AppError("المطالبة غير موجودة");
      d.tenderId = c.tenderId;
    }
    await recordLiability({ ...d, amount }, user);
    refresh();
    return `أُضيفت مديونية ضريبية بقيمة ${fmtJOD(amount)}`;
  });
}

const paymentSchema = z.object({
  amount: z.preprocess((v) => (v === "" || v == null ? undefined : Number(String(v).replace(/,/g, ""))), z.number({ required_error: "المبلغ مطلوب", invalid_type_error: "المبلغ غير صالح" }).positive("المبلغ يجب أن يكون أكبر من صفر").transform(round3)),
  date: zDate("تاريخ السداد"),
  tenderId: zOptId,
  reference: zOptText,
  description: zOptText,
});

/** سداد لدائرة ضريبة الدخل — يُخصم من الحساب البنكي */
export async function recordTaxPayment(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await actionUser(can.manageFinance);
    const d = paymentSchema.parse(formObject(fd));
    const s = await taxSummary();
    if (d.amount > s.outstanding + 0.001) throw new AppError(`المبلغ أكبر من المديونية القائمة (${fmtJOD(s.outstanding)})`);
    const description = d.description || `سداد ضريبة دخل${d.reference ? ` — إيصال ${d.reference}` : ""}`;
    await db.$transaction(async (tx) => {
      const e = await tx.taxEntry.create({ data: { kind: "PAYMENT", amount: d.amount, date: d.date, tenderId: d.tenderId, reference: d.reference, description, createdById: user.id } });
      await upsertLinkedBankTx(tx, "TAX", e.id, { date: d.date, type: "OUT", amount: d.amount, description, tenderId: d.tenderId });
    });
    refresh();
    return `تم تسجيل سداد ${fmtJOD(d.amount)} — المديونية المتبقية ${fmtJOD(round3(s.outstanding - d.amount))}`;
  });
}

export async function deleteTaxEntry(id: number) {
  const result = await runVoid(async () => {
    await actionUser(can.manageFinance);
    const e = await db.taxEntry.findUnique({ where: { id } });
    if (!e) throw new AppError("القيد غير موجود");
    await db.$transaction(async (tx) => {
      if (e.kind === "PAYMENT") await removeLinkedBankTx(tx, "TAX", id);
      await tx.taxEntry.delete({ where: { id } });
    });
  });
  refresh();
  return result;
}

/** تعديل قيد مديونية ضريبية (المدير العام): النسبة أو المبلغ أو البيان — يُعاد الاحتساب من الأساس عند تغيير النسبة */
export async function updateTaxEntry(id: number, _: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await actionUser();
    if (user.role !== "ADMIN") throw new AppError("تعديل قيود الضريبة للمدير العام فقط");
    const e = await db.taxEntry.findUnique({ where: { id } });
    if (!e) throw new AppError("القيد غير موجود");
    if (e.kind !== "LIABILITY") throw new AppError("السداد يُحذف ويُعاد تسجيله");
    const d = z
      .object({ rate: liabilitySchema.shape.rate, amount: zOptMoney, base: zOptMoney, description: zText("البيان") })
      .parse(formObject(fd));
    const base = d.base ?? e.base;
    const amount = d.amount ?? (base != null && d.rate != null ? round3((base * d.rate) / 100) : e.amount);
    await db.taxEntry.update({ where: { id }, data: { rate: d.amount != null ? null : d.rate, base, amount, description: d.description } });
    await auditEvent("update", "TaxEntry", `تعديل مديونية ضريبية: ${fmtJOD(e.amount)} ← ${fmtJOD(amount)}${d.rate != null ? ` (${d.rate}%)` : ""} — ${d.description}`, user, { recordId: id });
    refresh();
    return "عُدّل القيد";
  });
}

/** إعادة احتساب مديونية المطالبات المقبوضة بالنسبة الحالية في الإعدادات (المدير العام) */
export async function recalcClaimTaxes() {
  const result = await runVoid(async () => {
    const user = await actionUser();
    if (user.role !== "ADMIN") throw new AppError("للمدير العام فقط");
    const pct = (await getSettings()).withholdingTaxPct;
    const rows = await db.taxEntry.findMany({ where: { kind: "LIABILITY", claimId: { not: null }, base: { not: null } } });
    let n = 0;
    for (const e of rows) {
      if (e.rate === pct) continue;
      const amount = round3(((e.base ?? 0) * pct) / 100);
      await db.taxEntry.update({ where: { id: e.id }, data: { rate: pct, amount } });
      n++;
    }
    await auditEvent("update", "TaxEntry", `إعادة احتساب مديونية ${n} مطالبة بالنسبة الحالية ${pct}%`, user);
  });
  refresh();
  return result;
}

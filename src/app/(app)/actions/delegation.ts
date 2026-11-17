"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { actionUser } from "@/lib/auth";
import { auditEvent, run, runVoid, type ActionState } from "@/lib/action";
import { AppError, can } from "@/lib/permissions";
import { notify } from "@/lib/notify";
import { ROLE_LABELS } from "@/lib/labels";
import { fmtDate } from "@/lib/format";
import { formObject, zDate, zOptId, zText } from "@/lib/validation";

const schema = z.object({
  fromUserId: zOptId,
  toUserId: zOptId,
  startsAt: zDate("بداية التفويض"),
  endsAt: zDate("نهاية التفويض"),
  reason: zText("سبب التفويض"),
});

/**
 * تفويض مؤقت (المدير العام فقط): ينقل صلاحيات مستخدم غائب لزميل خلال فترة محددة.
 * كل إجراء يُنفذه المفوَّض إليه يُوثَّق باسمه «نيابة عن» المفوِّض في السجلات وسجل المطالبة.
 */
export async function createDelegation(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await actionUser(can.manageUsers);
    const d = schema.parse(formObject(fd));
    if (!d.fromUserId || !d.toUserId) throw new AppError("اختر المفوِّض والمفوَّض إليه");
    if (d.fromUserId === d.toUserId) throw new AppError("لا يمكن التفويض لنفس المستخدم");
    // نهاية التفويض تشمل اليوم كاملاً
    const endsAt = new Date(d.endsAt.getTime() + 86_399_000);
    if (endsAt <= d.startsAt) throw new AppError("نهاية التفويض قبل بدايته");
    if (endsAt.getTime() - d.startsAt.getTime() > 90 * 86_400_000) throw new AppError("أقصى مدة للتفويض 90 يوماً");
    const [from, to] = await Promise.all([db.user.findUnique({ where: { id: d.fromUserId } }), db.user.findUnique({ where: { id: d.toUserId } })]);
    if (!from || !to || !to.active) throw new AppError("المستخدم غير موجود أو موقوف");
    const del = await db.delegation.create({ data: { fromUserId: from.id, toUserId: to.id, role: from.role, startsAt: d.startsAt, endsAt, reason: d.reason, createdById: user.id } });
    const label = ROLE_LABELS[from.role as keyof typeof ROLE_LABELS] ?? from.role;
    await auditEvent("workflow", "Delegation", `تفويض مؤقت: ${to.name} يعمل بصلاحيات ${from.name} (${label}) من ${fmtDate(d.startsAt)} إلى ${fmtDate(d.endsAt)} — ${d.reason}`, user, { recordId: del.id });
    await notify([to.id, from.id], { title: `تفويض مؤقت: ${to.name} نيابة عن ${from.name}`, body: `صلاحيات «${label}» من ${fmtDate(d.startsAt)} إلى ${fmtDate(d.endsAt)} — ${d.reason}`, href: "/" });
    revalidatePath("/", "layout");
    return `فُعِّل التفويض: ${to.name} نيابة عن ${from.name}`;
  });
}

export async function revokeDelegation(id: number) {
  const result = await runVoid(async () => {
    const user = await actionUser(can.manageUsers);
    const d = await db.delegation.update({ where: { id }, data: { revokedAt: new Date() } });
    await auditEvent("workflow", "Delegation", `إلغاء التفويض #${id}`, user, { recordId: d.id });
  });
  revalidatePath("/", "layout");
  return result;
}

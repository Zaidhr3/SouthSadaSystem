"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { actionUser } from "@/lib/auth";
import { auditEvent, run, type ActionState } from "@/lib/action";
import { AppError, can } from "@/lib/permissions";
import { markIgRetired, prepareRelaunch, retireOld } from "@/lib/relaunch";

const done = () => {
  revalidatePath("/marketing/relaunch");
  revalidatePath("/marketing/grid");
  revalidatePath("/marketing");
};

/** تجهيز المختار من المنشورات القديمة (دفعات من 4 — اضغط مجدداً لإكمال الباقي) */
export async function prepareRelaunchAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = await run(async () => {
    const user = await actionUser(can.manageMarketing);
    const keys = fd.getAll("keys").map(String).filter(Boolean);
    if (!keys.length) throw new AppError("اختر منشوراً قديماً واحداً على الأقل");
    const every = Math.min(Math.max(Number(fd.get("every")) || 1, 1), 7);
    const res = await prepareRelaunch(keys, user.id, { everyDays: every });
    if (!res.prepared && res.errors.length) throw new AppError(res.errors.join(" | "));
    return `صُمّم ${res.prepared} منشوراً بقالب الكتالوج${res.remaining ? ` — بقي ${res.remaining}: اضغط «تجهيز» مجدداً لإكمالها` : " — اكتمل المختار"}${res.errors.length ? ` (تعذّر: ${res.errors.join(" | ")})` : ""}`;
  });
  done();
  return r;
}

/** اعتماد كل منشورات إعادة الإطلاق الجاهزة: تُنشر تلقائياً بمواعيدها المتتابعة مع المهمة الصباحية */
export async function approveAllRelaunch(_: ActionState, __: FormData): Promise<ActionState> {
  const r = await run(async () => {
    const user = await actionUser(can.manageMarketing);
    const items = await db.marketingItem.findMany({ where: { source: "RELAUNCH", status: { in: ["IN_REVIEW", "SUGGESTED"] }, imageAttachmentId: { not: null } }, orderBy: { publishAt: "asc" }, select: { id: true, publishAt: true } });
    if (!items.length) throw new AppError("لا توجد منشورات جاهزة بانتظار الاعتماد");
    const now = Date.now();
    for (const it of items) {
      const at = it.publishAt && +it.publishAt > now ? it.publishAt : new Date(now + 3600_000);
      await db.marketingItem.update({ where: { id: it.id }, data: { status: "APPROVED", approvedById: user.id, approvedAt: new Date(), publishAt: at } });
    }
    await auditEvent("APPROVE", "Marketing", `اعتماد ${items.length} منشوراً لإعادة إطلاق الصفحة`, user);
    return `اعتُمد ${items.length} منشوراً — يُنشر كل منها تلقائياً في موعده (المهمة الصباحية)`;
  });
  done();
  return r;
}

export async function retireOldAction(id: number, _: ActionState, __: FormData): Promise<ActionState> {
  const r = await run(async () => {
    const user = await actionUser(can.manageMarketing);
    const log = await retireOld(id).catch((e) => {
      throw new AppError(e instanceof Error ? e.message : "تعذر الحذف");
    });
    await auditEvent("DELETE", "Marketing", `حذف منشور قديم بعد إعادة إطلاقه (#${id})`, user);
    return log.join(" — ");
  });
  done();
  return r;
}

export async function markIgRetiredAction(id: number, _: ActionState, __: FormData): Promise<ActionState> {
  const r = await run(async () => {
    await actionUser(can.manageMarketing);
    await markIgRetired(id);
    return "سُجّلت أرشفة المنشور القديم على إنستغرام";
  });
  done();
  return r;
}

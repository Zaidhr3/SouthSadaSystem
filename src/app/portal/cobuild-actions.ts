"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { clientIp, requireClient } from "@/lib/client-session";
import { notify } from "@/lib/notify";
import { ACTIVE_BUYER, normalizeSelection } from "@/lib/cobuild-core";
import { catalogLite, logEvent } from "@/lib/cobuild";
import type { PortalState } from "./actions";

const t = (fd: FormData, k: string, max = 1000) => String(fd.get(k) ?? "").trim().slice(0, max);

/** المشتري يملك هذه الصفقة (حسابه في البوابة) وهي فعّالة */
async function myBuyer(buyerId: number) {
  const c = await requireClient();
  const b = await db.coBuildBuyer.findFirst({ where: { id: buyerId, clientId: c.id }, include: { unit: true, project: true } });
  return { c, b };
}

/** حفظ اختيارات التشطيب من المكوّن — تُطبَّق قواعد الكتالوج على الخادم (لا يُوثق بأي سعر أو كمية من المتصفح) */
export async function saveMySelections(buyerId: number, picked: { itemId: number; qty: number }[]): Promise<PortalState> {
  const { c, b } = await myBuyer(buyerId);
  if (!b) return { error: "غير مسموح" };
  if (!ACTIVE_BUYER.includes(b.status) || b.status === "HANDED_OVER") return { error: "الاختيارات مغلقة لهذه الشقة" };
  if (b.pricesLockedAt) return { error: "أسعار شقتك مقفولة — لأي تعديل تواصل مع الشركة" };
  if (["cancelled_reset", "handover_completed"].includes(b.project.status)) return { error: "المشروع مغلق" };
  if (!Array.isArray(picked) || picked.length > 300) return { error: "اختيارات غير صالحة" };
  const clean = picked.filter((p) => p && Number.isInteger(Number(p.itemId))).map((p) => ({ itemId: Number(p.itemId), qty: Number(p.qty) || 0 }));
  const items = await catalogLite();
  const lines = normalizeSelection(items, clean, b.unit.areaSqm);
  await db.$transaction(async (tx) => {
    await tx.coBuildSelection.deleteMany({ where: { buyerId: b.id } });
    if (lines.length) await tx.coBuildSelection.createMany({ data: lines.map((l) => ({ buyerId: b.id, itemId: l.itemId, qty: l.qty })) });
  });
  await logEvent(db, b.projectId, "CONFIGURE", `حدّث ${b.name} اختيارات التشطيب (${lines.length} بنداً) من البوابة`, { name: c.name, clientId: c.id }, b.id);
  revalidatePath(`/portal/cobuild/${b.id}`);
  return { ok: "حُفظت اختياراتك — التقدير محدّث" };
}

/** موافقة رقمية على بند «شو عندك» (موافقة/اختيار/تسليم) بالاسم والوقت والعنوان — الدفعات تؤكدها الشركة */
export async function signTask(buyerId: number, taskId: number, _: PortalState, fd: FormData): Promise<PortalState> {
  const { c, b } = await myBuyer(buyerId);
  if (!b || !ACTIVE_BUYER.includes(b.status)) return { error: "غير مسموح" };
  const task = await db.coBuildTask.findFirst({ where: { id: taskId, projectId: b.projectId, OR: [{ buyerId: b.id }, { buyerId: null }] } });
  if (!task) return { error: "البند غير موجود" };
  if (task.kind === "PAYMENT") return { error: "الدفعات تؤكدها الشركة عند الاستلام" };
  if (task.signedAt) return { error: "سبق وتمت الموافقة" };
  const name = t(fd, "signedName", 120);
  if (name.length < 3) return { error: "اكتب اسمك الكامل للموافقة" };
  if (fd.get("agree") !== "on") return { error: "أكّد موافقتك" };
  // البند العام (لكل المشترين) لا يُغلق بموافقة مشترٍ واحد — تُنشأ نسخة موقعة خاصة به
  if (task.buyerId === null) {
    if (await db.coBuildTask.findFirst({ where: { projectId: b.projectId, buyerId: b.id, title: task.title, signedAt: { not: null } } })) return { error: "سبق وتمت موافقتك" };
    await db.coBuildTask.create({ data: { projectId: b.projectId, buyerId: b.id, kind: task.kind, title: task.title, details: task.details, dueDate: task.dueDate, status: "DONE", doneAt: new Date(), signedName: name, signedAt: new Date(), signedIp: clientIp(), createdById: task.createdById } });
  } else {
    await db.coBuildTask.update({ where: { id: task.id }, data: { status: "DONE", doneAt: new Date(), signedName: name, signedAt: new Date(), signedIp: clientIp() } });
  }
  await logEvent(db, b.projectId, "SIGNOFF", `وافق ${b.name} رقمياً على «${task.title}» باسم ${name}`, { name: c.name, clientId: c.id }, b.id);
  await notify(["ADMIN"], { title: `موافقة مشترٍ: ${task.title}`, body: `${b.name} — ${b.project.name}`, href: `/cobuild/${b.projectId}?tab=tasks` });
  revalidatePath(`/portal/cobuild/${b.id}`);
  return { ok: "سُجّلت موافقتك" };
}

/** تعرّف على جيرانك: بموافقة صريحة، ويظهر الاسم الأول والطابق والنبذة فقط */
export async function setNeighbor(buyerId: number, _: PortalState, fd: FormData): Promise<PortalState> {
  const { b } = await myBuyer(buyerId);
  if (!b || !ACTIVE_BUYER.includes(b.status)) return { error: "غير مسموح" };
  if (!b.project.neighborIntro) return { error: "الميزة غير مفعّلة لهذا المشروع" };
  const optIn = fd.get("optIn") === "on";
  await db.coBuildBuyer.update({ where: { id: b.id }, data: { neighborOptIn: optIn, neighborBio: optIn ? t(fd, "bio", 280) || null : null } });
  revalidatePath(`/portal/cobuild/${b.id}`);
  return { ok: optIn ? "يظهر تعريفك لجيرانك الآن" : "أُخفي تعريفك" };
}

/** وضع المغترب: تذكير بالتحديثات الأسبوعية والموافقات عن بُعد */
export async function setRemote(buyerId: number, _: PortalState, fd: FormData): Promise<PortalState> {
  const { b } = await myBuyer(buyerId);
  if (!b) return { error: "غير مسموح" };
  await db.coBuildBuyer.update({ where: { id: b.id }, data: { remoteMode: fd.get("remote") === "on" } });
  revalidatePath(`/portal/cobuild/${b.id}`);
  return { ok: "حُفظ" };
}

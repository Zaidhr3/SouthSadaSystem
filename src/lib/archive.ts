import "server-only";
import { db } from "./db";
import { AppError, type AppUser } from "./permissions";
import { maintenanceEnd } from "./project-phase";
import { fmtDate, todayUTC } from "./format";
import { notify } from "./notify";

/**
 * دورة الأرشفة بعد انتهاء المشروع (تراعي أن بعض العطاءات بلا كفالات، أو بكفالة دون أخرى):
 *
 *  المرحلة 1 «أرشيف فترة الصيانة» — تلقائياً عند اجتماع:
 *    • استلام آخر مطالبة مالية (المطالبة النهائية مصروفة)
 *    • ولا توجد كفالة حسن تنفيذ قائمة (أُفرج عنها، أو لم تكن مطلوبة أصلاً)
 *    يبقى المشروع مرئياً في «الأرشيف»: متابعة موعد انتهاء الصيانة وتسجيل أي أعمال صيانة كمصروف على المشروع.
 *
 *  المرحلة 2 «الأرشيف النهائي» — تلقائياً عند:
 *    • لا توجد كفالة صيانة قائمة (أُفرج عنها، أو لم تكن مطلوبة)
 *    • وانقضاء مدة الصيانة إن كانت معروفة (بلا مدة صيانة ولا كفالة ← مباشرة)
 *    مقفل تماماً: لا تعديل ولا إضافة على المشروع إلا بعد إعادته — والإعادة للمدير العام فقط.
 */

const HELD = ["ISSUED", "SUBMITTED"];
export const ARCHIVE_STAGE: Record<number, { label: string; tone: "purple" | "gray" }> = {
  1: { label: "الأرشيف — فترة الصيانة", tone: "purple" },
  2: { label: "الأرشيف النهائي (مقفل)", tone: "gray" },
};

type ArchiveInput = {
  id: number;
  status: string;
  archiveStage: number;
  preliminaryHandoverDate: Date | null;
  maintenanceMonths: number | null;
  guarantees: { type: string; status: string; expiryDate: Date | null }[];
  claims: { type: string; status: string }[];
};

export function archiveCheck(t: ArchiveInput) {
  const held = (type: string) => t.guarantees.some((g) => g.type === type && HELD.includes(g.status));
  const finalPaid = t.claims.some((c) => c.type === "FINAL" && c.status === "PAID");
  const awarded = ["WON", "EXECUTION", "MAINTENANCE", "CLOSED"].includes(t.status);
  const hasMaintGuarantee = t.guarantees.some((g) => g.type === "MAINTENANCE");
  const maintEnd = hasMaintGuarantee || t.preliminaryHandoverDate ? maintenanceEnd(t) : null;
  const today = todayUTC();
  const stage1Blockers: string[] = [];
  if (!awarded) stage1Blockers.push("المشروع غير محال");
  if (!finalPaid) stage1Blockers.push("لم تُستلم المطالبة النهائية بعد");
  if (held("PERFORMANCE")) stage1Blockers.push("كفالة حسن التنفيذ لم يُفرج عنها");
  const stage2Blockers: string[] = [];
  if (held("MAINTENANCE")) stage2Blockers.push("كفالة الصيانة لم يُفرج عنها");
  if (maintEnd && maintEnd > today) stage2Blockers.push(`مدة الصيانة تنتهي ${fmtDate(maintEnd)}`);
  return { stage1Ready: stage1Blockers.length === 0, stage2Ready: stage2Blockers.length === 0, stage1Blockers, stage2Blockers, maintEnd };
}

const select = {
  id: true,
  name: true,
  status: true,
  archiveStage: true,
  managerId: true,
  preliminaryHandoverDate: true,
  maintenanceMonths: true,
  guarantees: { select: { type: true, status: true, expiryDate: true } },
  claims: { select: { type: true, status: true } },
} as const;

/** يطبّق الأرشفة التلقائية على مشروع واحد (بعد قبض مطالبة أو الإفراج عن كفالة) — لا يفشل الإجراء الأصلي أبداً */
export async function syncArchive(tenderId: number) {
  try {
    const t = await db.tender.findUnique({ where: { id: tenderId }, select });
    if (!t || t.archiveStage >= 2) return;
    const c = archiveCheck(t);
    let stage = t.archiveStage;
    if (stage === 0 && c.stage1Ready) stage = 1;
    if (stage === 1 && c.stage2Ready) stage = 2;
    if (stage === t.archiveStage) return;
    const now = new Date();
    await db.tender.update({
      where: { id: t.id },
      data: {
        archiveStage: stage,
        ...(t.archiveStage === 0 ? { archivedAt: now } : {}),
        ...(stage === 2 ? { finalArchivedAt: now, status: "CLOSED", closedAt: now } : {}),
      },
    });
    const msg = stage === 2 ? "رُحّل للأرشيف النهائي (مقفل) بعد الإفراج النهائي" : `رُحّل لأرشيف فترة الصيانة${c.maintEnd ? ` — تنتهي الصيانة ${fmtDate(c.maintEnd)}` : ""}`;
    await notify(["ADMIN", "ACCOUNTANT", { managerOf: t.id }], { title: `أرشفة مشروع: ${t.name}`, body: msg, href: `/tenders/${t.id}` });
  } catch (e) {
    console.error("[archive]", e);
  }
}

/** الفحص اليومي لكل المشاريع غير المؤرشفة نهائياً (انقضاء مدد الصيانة) */
export async function syncAllArchives() {
  const ids = await db.tender.findMany({ where: { archiveStage: { lt: 2 }, status: { in: ["WON", "EXECUTION", "MAINTENANCE", "CLOSED"] } }, select: { id: true } });
  for (const { id } of ids) await syncArchive(id);
  return ids.length;
}

/** حماية الأرشيف النهائي: أي تعديل على مشروع مقفل مرفوض إلا للمدير العام (بصفته الأصلية لا بالتفويض) */
export async function assertNotLocked(user: Pick<AppUser, "role" | "baseRole">, tenderId: number | null | undefined) {
  if (!tenderId) return;
  const t = await db.tender.findUnique({ where: { id: tenderId }, select: { archiveStage: true } });
  if (t?.archiveStage === 2 && (user.baseRole ?? user.role) !== "ADMIN") {
    throw new AppError("المشروع في الأرشيف النهائي (مقفل) — لا يمكن تعديله. إعادته من الأرشيف صلاحية المدير العام فقط");
  }
}

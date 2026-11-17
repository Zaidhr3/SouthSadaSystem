import "server-only";
import { db } from "./db";
import { AppError, depositSlipRequired, type AppUser } from "./permissions";
import { attachedFileCount, saveAttachments, type EntityType } from "./uploads";

/**
 * وصل الإيداع البنكي — إلزامي لكل من يودع مبلغاً في حساب الشركة (مدير مشروع، محاسب، مدقق...)
 * والإدارة (المدير العام والمشرف الأعلى) معفاة. يُحكم بالدور الأصلي للشخص لا بدور التفويض:
 * مدير المشروع المفوَّض بصلاحيات المدير العام يبقى ملزماً بالوصل.
 */
export const DEPOSIT_SLIP_FIELD = "depositSlip";
export const DEPOSIT_SLIP_LABEL = "وصل الإيداع البنكي";

export { depositSlipRequired };

/** مصدر الحركة البنكية ← السجل الذي يُحفظ عليه الوصل */
const TARGET: Record<string, EntityType> = { CLAIM: "claim", RETENTION: "tender", ADVANCE: "tender", MANUAL: "bank", LOAN: "loan" };
const slotOf = (sourceType: string) => `deposit:${sourceType}`;

/** يُستدعى قبل أي كتابة: يرفض العملية إن لم يُرفق الوصل ممن يلزمه */
export async function assertDepositSlip(fd: FormData, user: AppUser) {
  if (!depositSlipRequired(user)) return;
  if ((await attachedFileCount(fd, user.id, DEPOSIT_SLIP_FIELD)) === 0) {
    throw new AppError(`${DEPOSIT_SLIP_LABEL} إلزامي — أرفق صورة وصل الإيداع الصادر من البنك لإتمام العملية`);
  }
}

/** حفظ الوصل على مصدر الإيداع (مطالبة/مشروع/دين/حركة يدوية) بخانة تميّزه */
export async function saveDepositSlip(fd: FormData, sourceType: keyof typeof TARGET, entityId: number, user: AppUser) {
  return saveAttachments(fd, TARGET[sourceType], entityId, user.id, DEPOSIT_SLIP_FIELD, { label: DEPOSIT_SLIP_LABEL, slot: slotOf(sourceType) });
}

/** وصولات الإيداع لحركات بنكية واردة — مفتاح الخريطة رقم الحركة */
export async function depositSlipsFor(txs: { id: number; type: string; sourceType: string; sourceId: number | null }[]) {
  const wanted = txs.filter((t) => t.type === "IN" && TARGET[t.sourceType]);
  const out = new Map<number, { id: number; fileName: string; size: number }[]>();
  if (!wanted.length) return out;
  const atts = await db.attachment.findMany({
    where: {
      OR: wanted.map((t) => ({ entityType: TARGET[t.sourceType], entityId: t.sourceType === "MANUAL" ? t.id : (t.sourceId ?? -1), slot: slotOf(t.sourceType) })),
    },
    select: { id: true, fileName: true, size: true, entityType: true, entityId: true, slot: true },
  });
  for (const t of wanted) {
    const entityId = t.sourceType === "MANUAL" ? t.id : t.sourceId;
    const mine = atts.filter((a) => a.entityType === TARGET[t.sourceType] && a.entityId === entityId && a.slot === slotOf(t.sourceType));
    if (mine.length) out.set(t.id, mine);
  }
  return out;
}

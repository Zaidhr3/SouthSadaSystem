import type { AppUser, Role } from "./permissions";

/** حالة الكتاب الفعلية (الكتب القديمة قبل مسار الاعتماد تُعامل كمعتمدة) */
export type LetterLike = { letterStatus: string | null; body: string | null; createdById: number; direction: string };
export const isOfficialLetter = (c: LetterLike) => c.direction === "OUT" && (c.letterStatus != null || c.body != null);
export const letterState = (c: LetterLike) => (c.letterStatus ?? (c.body != null ? "APPROVED" : null));
export const isLetterApproved = (c: LetterLike) => letterState(c) === "APPROVED";

/** كل كتاب — أياً كان منشئه — يمر على المحاسب ثم المدير العام: لا اعتماد تلقائي ولا تخطي لأي محطة */
export const firstLetterStep = (_role?: Role) => "PENDING_ACCOUNTANT" as const;

/** هل للمستخدم قرار (اعتماد/إعادة) على الكتاب في محطته الحالية؟ */
export function canReviewLetter(user: AppUser, c: LetterLike) {
  const s = letterState(c);
  if (s === "PENDING_ACCOUNTANT") return user.role === "ACCOUNTANT";
  if (s === "PENDING_ADMIN") return user.role === "ADMIN";
  return false;
}

/** التعديل: المنشئ عند الإعادة أو قبل أن يبتّ فيه أحد، والمراجع في محطته — الكتاب المعتمد لا يُعدّل */
export function canEditLetter(user: AppUser, c: LetterLike & { accountantById?: number | null }) {
  const s = letterState(c);
  if (!s || s === "APPROVED") return false;
  if (c.createdById === user.id && (s === "RETURNED" || s === "PENDING_ACCOUNTANT")) return true;
  return canReviewLetter(user, c);
}

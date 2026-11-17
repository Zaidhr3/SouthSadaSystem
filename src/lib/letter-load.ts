import "server-only";
import { db } from "./db";
import type { AppUser } from "./permissions";
import { isLetterApproved, isOfficialLetter } from "./letter-flow";
import type { LetterData } from "./letter";

/** تحميل كتاب رسمي مع التحقق من صلاحية الاطلاع (مدير المشروع: كتبه أو كتب مشاريعه فقط) */
export async function loadLetter(id: number, user: AppUser) {
  if (!Number.isInteger(id) || id <= 0) return null;
  const c = await db.correspondence.findUnique({
    where: { id },
    include: { tender: { select: { id: true, name: true, managerId: true } }, replyTo: { select: { id: true, refNo: true, theirRef: true, date: true, subject: true } } },
  });
  if (!c || !isOfficialLetter(c)) return null;
  if (user.role === "PM" && c.createdById !== user.id && c.tender?.managerId !== user.id) return null;
  return c;
}

export type LoadedLetter = NonNullable<Awaited<ReturnType<typeof loadLetter>>>;

export function letterDataOf(c: LoadedLetter): LetterData {
  const approved = isLetterApproved(c);
  return {
    refNo: approved ? c.refNo : null,
    date: c.date,
    party: c.party,
    subject: c.subject,
    body: c.body ?? "",
    cc: c.cc,
    attachments: (c.letterAttachments ?? "").split("\n").map((s) => s.trim()).filter(Boolean),
    replyTo: c.replyTo,
    draft: !approved,
  };
}

/** نسخة PDF المعتمدة المؤرشفة */
export const LETTER_PDF_LABEL = "الكتاب الرسمي (PDF)";

import "server-only";
import { db } from "./db";
import { upsertLinkedBankTx } from "./finance";
import { getSettings } from "./settings";
import { recordLiability } from "./tax";
import { round3 } from "./format";
import { CLAIM_TYPE } from "./labels";
import type { AppUser } from "./permissions";

/**
 * ترحيل قبض المطالبة: الحالة «تم الصرف»، إيداع فعلي في حساب الشركة البنكي مرتبط بالمشروع،
 * وتسجيل ضريبة الدخل المستحقة في وحدة الضريبة (لا تُخصم من المطالبة). archive = نقلها للأرشيف.
 */
export async function finalizeClaimPayment(
  claimId: number,
  p: { paidDate: Date; paidAmount: number; deductions?: number; deductionNotes?: string | null; taxAmount?: number | null; archive?: boolean },
  user: AppUser,
) {
  const claim = await db.claim.findUniqueOrThrow({ where: { id: claimId }, include: { tender: true } });
  await db.$transaction(async (tx) => {
    await tx.claim.update({
      where: { id: claimId },
      data: {
        status: "PAID",
        paidDate: p.paidDate,
        paidAmount: p.paidAmount,
        ...(p.deductions != null ? { deductions: p.deductions, deductionNotes: p.deductionNotes ?? claim.deductionNotes } : {}),
        approvedDate: claim.approvedDate ?? p.paidDate,
        ...(p.archive ? { archivedAt: new Date(), payStage: "DONE" } : {}),
      },
    });
    await upsertLinkedBankTx(tx, "CLAIM", claimId, {
      date: p.paidDate,
      type: "IN",
      amount: p.paidAmount,
      description: `قبض ${CLAIM_TYPE[claim.type]} رقم ${claim.number} — ${claim.tender.name}`,
      tenderId: claim.tenderId,
    });
  });
  const settings = await getSettings();
  const tax = p.taxAmount ?? round3(claim.grossAmount * (settings.withholdingTaxPct / 100));
  if (tax > 0 && !(await db.taxEntry.findFirst({ where: { claimId, kind: "LIABILITY" } }))) {
    await recordLiability(
      { tenderId: claim.tenderId, claimId, base: claim.grossAmount, rate: p.taxAmount == null ? settings.withholdingTaxPct : null, amount: tax, date: p.paidDate, description: `ضريبة دخل مستحقة على قبض المطالبة رقم ${claim.number} — ${claim.tender.name}`, reference: null },
      user,
    );
  }
  // قبض المطالبة النهائية قد يُرحّل المشروع لأرشيف فترة الصيانة
  if (claim.type === "FINAL") {
    const { syncArchive } = await import("./archive");
    await syncArchive(claim.tenderId);
  }
  return claim;
}

import "server-only";
import { db } from "./db";
import { fmtJOD, round3 } from "./format";
import { notify } from "./notify";

/** مديونية الضريبة = مجموع المستحقات (LIABILITY) − مجموع المسدد (PAYMENT) */
export async function taxSummary() {
  const rows = await db.taxEntry.groupBy({ by: ["kind"], _sum: { amount: true } });
  const accrued = round3(rows.find((r) => r.kind === "LIABILITY")?._sum.amount ?? 0);
  const paid = round3(rows.find((r) => r.kind === "PAYMENT")?._sum.amount ?? 0);
  return { accrued, paid, outstanding: round3(accrued - paid) };
}

export async function taxByTender() {
  const rows = await db.taxEntry.groupBy({ by: ["tenderId", "kind"], _sum: { amount: true } });
  const map = new Map<number | null, { accrued: number; paid: number; outstanding: number }>();
  for (const r of rows) {
    const cur = map.get(r.tenderId) ?? { accrued: 0, paid: 0, outstanding: 0 };
    if (r.kind === "LIABILITY") cur.accrued = round3(cur.accrued + (r._sum.amount ?? 0));
    else cur.paid = round3(cur.paid + (r._sum.amount ?? 0));
    cur.outstanding = round3(cur.accrued - cur.paid);
    map.set(r.tenderId, cur);
  }
  return map;
}

/** تسجيل مديونية ضريبية وإبلاغ المدير العام والمحاسب فوراً بالزيادة (يُستدعى من الإجراءات بعد التحقق من الصلاحية) */
export async function recordLiability(
  d: { tenderId: number | null; claimId: number | null; base: number | null; rate: number | null; amount: number; date: Date; description: string; reference: string | null },
  user: { id: number },
) {
  await db.taxEntry.create({ data: { kind: "LIABILITY", ...d, createdById: user.id } });
  const s = await taxSummary();
  await notify(["ADMIN", "ACCOUNTANT"], {
    title: `زادت مديونية الضريبة بمبلغ ${fmtJOD(d.amount)}`,
    body: `${d.description} — إجمالي المديونية الحالية ${fmtJOD(s.outstanding)}`,
    href: "/taxes",
  }, { exclude: user.id });
}

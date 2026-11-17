import "server-only";
import { db } from "./db";
import type { Role } from "./permissions";

/** هوية الشركة على المستندات + إعدادات الرؤية (من يرى الأرباح والبنك) — يعدّلها المدير العام */
export const BRAND_DEFAULT_SLOGAN = "نبني بثقة… ننجز بإتقان";
export const VISIBILITY_ROLES: Role[] = ["CHAIRMAN", "ACCOUNTANT", "AUDITOR", "PM"];

export async function getBrand() {
  const rows = await db.setting.findMany({ where: { key: { in: ["brand.slogan", "vis.profit", "vis.bank"] } } });
  const v = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const roles = (s: string | undefined, def: Role[]) => new Set<Role>(s == null ? def : (s.split(",").filter(Boolean) as Role[]));
  return {
    slogan: v["brand.slogan"] ?? BRAND_DEFAULT_SLOGAN,
    // الافتراضي كما كان: المشرف الأعلى فقط مع المدير العام
    profitRoles: roles(v["vis.profit"], ["CHAIRMAN"]),
    bankRoles: roles(v["vis.bank"], ["CHAIRMAN"]),
  };
}

/** هل يرى هذا المستخدم الأرباح/البنك؟ المدير العام دائماً */
export async function userSees(user: { role: Role }, what: "profit" | "bank") {
  if (user.role === "ADMIN") return true;
  const b = await getBrand();
  return (what === "profit" ? b.profitRoles : b.bankRoles).has(user.role);
}

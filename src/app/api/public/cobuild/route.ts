import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { PRE_LAUNCH, PROJECT_STATUS, priceOf } from "@/lib/cobuild-core";
import { committedWhere } from "@/lib/cobuild";

export const dynamic = "force-dynamic";

/**
 * بيانات حاسبة «من العظم إلى المفتاح» لموقع الشركة (عامة، للقراءة فقط):
 * سعر البيع فقط لبنود الكتالوج الفعّالة والمعروضة — لا كلفة ولا هامش —
 * والمشاريع المعروضة بعدّاد الجاهزية وحالة الشقق دون أي اسم أو بيانات مشترين.
 */
const DEFAULT_ORIGINS = ["https://sadaaljanoub-website.vercel.app", "https://sadaaljanoobcompany.com", "https://www.sadaaljanoobcompany.com"];
const allowed = (origin: string | null): origin is string => {
  if (!origin) return false;
  const list = [...DEFAULT_ORIGINS, process.env.WEBSITE_ORIGIN || "", ...(process.env.WEBSITE_EXTRA_ORIGINS || "").split(",")].map((s) => s.trim().replace(/\/+$/, "")).filter(Boolean);
  return list.includes(origin) || /^https:\/\/sadaaljanoub-website(-[a-z0-9-]+)?\.vercel\.app$/.test(origin) || (process.env.NODE_ENV !== "production" && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin));
};
const cors = (origin: string | null) => ({
  ...(allowed(origin) ? { "Access-Control-Allow-Origin": origin! } : {}),
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Accept",
  "Access-Control-Max-Age": "86400",
  Vary: "Origin",
});

export async function OPTIONS(req: Request) {
  return new NextResponse(null, { status: 204, headers: cors(req.headers.get("origin")) });
}

export async function GET(req: Request) {
  const headers = { ...cors(req.headers.get("origin")), "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" };
  try {
    const [items, projects] = await Promise.all([
      db.catalogItem.findMany({ where: { isActive: true, isPublic: true }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }),
      db.coBuildProject.findMany({ where: { isPublic: true, status: { not: "cancelled_reset" } }, include: { units: { orderBy: { sortOrder: "asc" } } }, orderBy: { id: "desc" }, take: 6 }),
    ]);
    const counts = await Promise.all(projects.map((p) => db.coBuildBuyer.count({ where: committedWhere(p.id) })));
    return NextResponse.json(
      {
        ok: true,
        catalog: items.map((i) => ({ id: i.id, phase: i.phase, category: i.category, name: i.name, specs: i.specs, unit: i.unit, price: priceOf(i), mode: i.mode, choiceGroup: i.choiceGroup, qtyPerSqm: i.qtyPerSqm, defaultQty: i.defaultQty, qtyEditable: i.qtyEditable })),
        projects: projects.map((p, k) => ({
          ref: p.ref,
          name: p.name,
          location: p.location,
          description: p.description,
          status: p.status,
          statusLabel: PROJECT_STATUS[p.status]?.label ?? p.status,
          open: PRE_LAUNCH.includes(p.status),
          committed: counts[k],
          threshold: p.launchThreshold,
          totalUnits: p.totalUnits,
          progress: p.progress,
          incentives: { waitStartMonth: p.waitStartMonth, waitPerMonth: p.waitPerMonth, waitMaxMonths: p.waitMaxMonths, referrer: p.referrerBonus, referred: p.referredBonus },
          units: p.units.map((u) => ({ code: u.unitCode, floor: u.floor, area: u.areaSqm, facade: u.facadeView, skeletonPrice: u.skeletonPrice, available: u.status === "available" })),
        })),
      },
      { headers },
    );
  } catch (e) {
    console.error("[public/cobuild]", e);
    return NextResponse.json({ ok: false }, { status: 500, headers });
  }
}

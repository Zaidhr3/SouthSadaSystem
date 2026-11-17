import { NextResponse } from "next/server";
import { z } from "zod";
import { receiveQuote } from "@/lib/quotes";

export const dynamic = "force-dynamic";

/**
 * استقبال «طلب عرض سعر» من موقع الشركة (طلب عام بلا تسجيل دخول).
 * يُقبل فقط من نطاق الموقع (CORS)، ويُفحص للطلبات الوهمية قبل أن يصل لأي موظف.
 * الطلب الوهمي يُرد عليه بنجاح ظاهري (لا يكشف للمرسل أنه حُجز).
 */
const DEFAULT_ORIGINS = ["https://sadaaljanoub-website.vercel.app", "https://sadaaljanoobcompany.com", "https://www.sadaaljanoobcompany.com"];
const ORIGINS = () =>
  [...DEFAULT_ORIGINS, process.env.WEBSITE_ORIGIN || "", ...(process.env.WEBSITE_EXTRA_ORIGINS || "").split(",")]
    .map((s) => s.trim().replace(/\/+$/, ""))
    .filter(Boolean);
/** نطاقات الموقع + نسخ المعاينة على Vercel (sadaaljanoub-website-xxxx.vercel.app) */
const allowed = (origin: string | null): origin is string => !!origin && (ORIGINS().includes(origin) || /^https:\/\/sadaaljanoub-website(-[a-z0-9-]+)?\.vercel\.app$/.test(origin));

function cors(origin: string | null) {
  const ok = allowed(origin);
  return {
    ...(ok ? { "Access-Control-Allow-Origin": origin } : {}),
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

const schema = z.object({
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(7).max(30),
  email: z.string().trim().max(160).optional().nullable(),
  type: z.string().trim().min(2).max(120),
  city: z.string().trim().max(60).optional().nullable(),
  area: z.string().trim().max(40).optional().nullable(),
  details: z.string().trim().min(3).max(4000),
  offer: z.string().trim().max(120).optional().nullable(),
  /** حقل فخ مخفي — يملؤه الروبوت فقط */
  company_website: z.string().optional().nullable(),
  /** زمن تعبئة النموذج بالمللي ثانية */
  _elapsed: z.coerce.number().optional(),
});

export async function OPTIONS(req: Request) {
  return new NextResponse(null, { status: 204, headers: cors(req.headers.get("origin")) });
}

export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  const headers = cors(origin);
  if (!allowed(origin)) { console.warn("[rfq] origin rejected:", origin); return NextResponse.json({ ok: false, error: "origin" }, { status: 403, headers }); }
  const len = Number(req.headers.get("content-length") || 0);
  if (len > 20_000) return NextResponse.json({ ok: false, error: "too large" }, { status: 413, headers });
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    console.warn("[rfq] invalid:", parsed.error.issues.map((i) => i.path.join(".")).join(","));
    return NextResponse.json({ ok: false, error: "invalid", fields: parsed.error.issues.map((i) => i.path.join(".")) }, { status: 400, headers });
  }
  const d = parsed.data;
  try {
    const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || req.headers.get("x-real-ip");
    const q = await receiveQuote({ ...d, honeypot: d.company_website, elapsedMs: d._elapsed }, { ip: ip || null, userAgent: req.headers.get("user-agent") });
    return NextResponse.json({ ok: true, ref: q.ref }, { headers });
  } catch (e) {
    console.error("[rfq]", e);
    return NextResponse.json({ ok: false, error: "server" }, { status: 500, headers });
  }
}

import { NextResponse } from "next/server";
import { aiBoqChunk } from "@/app/(app)/actions/ai";

/**
 * قراءة دفعة صفحات من جدول الكميات (POST multipart: tenderId, from, to, file أو file__staged).
 * مسار API وليس Server Action: إجراءات الخادم من الصفحة نفسها تُنفَّذ بالدور في Next.js،
 * أما طلبات API فتعمل بالتوازي فعلاً — فيُقرأ المستند الطويل أسرع بعدة مرات.
 * الصلاحيات تُفحص داخل aiBoqChunk (الجلسة + صلاحية تعديل جدول كميات العطاء).
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** مهلة Gemini لكل دفعة — أقل من maxDuration بهامش */
const CHUNK_TIMEOUT_MS = Number(process.env.GEMINI_CHUNK_TIMEOUT_MS || 240_000);

export async function POST(req: Request) {
  // حماية CSRF: الطلب من نفس الموقع فقط (كما تفعل Server Actions)
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  if (origin && host && new URL(origin).host !== host) return NextResponse.json({ ok: false, error: "طلب من مصدر غير مسموح" }, { status: 403 });
  let fd: FormData;
  try {
    fd = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "طلب غير صالح" }, { status: 400 });
  }
  const tenderId = Number(fd.get("tenderId"));
  const from = Number(fd.get("from"));
  const to = Number(fd.get("to"));
  if (!Number.isInteger(tenderId) || !Number.isInteger(from) || !Number.isInteger(to)) {
    return NextResponse.json({ ok: false, error: "بيانات الدفعة غير صالحة" }, { status: 400 });
  }
  const r = await aiBoqChunk(tenderId, fd, from, to, CHUNK_TIMEOUT_MS);
  return NextResponse.json(r, { headers: { "Cache-Control": "no-store" } });
}

import { NextResponse } from "next/server";

/** نبضة نشاط: الوسيط (middleware) يحدّث وقت آخر نشاط للجلسة — وتعيد 401 إن كانت الجلسة قد قُفلت */
export const dynamic = "force-dynamic";
export function GET() {
  return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}

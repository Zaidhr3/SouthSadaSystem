import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { attachmentHeaders, attachmentTenderId, readAttachmentData } from "@/lib/uploads";

export const dynamic = "force-dynamic";

/** تنزيل/عرض المرفقات مع التحقق من الصلاحيات */
export async function GET(_: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const att = await db.attachment.findUnique({ where: { id: Number(params.id) } });
  if (!att) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (!can.viewAll(user.role)) {
    let allowed = att.uploadedById === user.id;
    if (!allowed) {
      const tenderId = await attachmentTenderId(att.entityType, att.entityId);
      if (tenderId) allowed = (await db.tender.findUnique({ where: { id: tenderId } }))?.managerId === user.id;
    }
    if (!allowed) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const buf = await readAttachmentData(att);
  if (!buf) return NextResponse.json({ error: "file missing" }, { status: 410 });
  return new NextResponse(new Uint8Array(buf), {
    headers: attachmentHeaders(att, { "Content-Length": String(buf.length), "Cache-Control": "private, max-age=3600" }),
  });
}

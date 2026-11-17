import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getClient } from "@/lib/client-session";
import { readAttachmentData } from "@/lib/uploads";
import { CLIENT_VISIBLE } from "@/lib/portal";

export const dynamic = "force-dynamic";

/** ملفات بوابة العميل: فقط مرفقات المراسلات والمستندات واليوميات التابعة لمشروع مربوط بحسابه */
export async function GET(_: Request, { params }: { params: { id: string } }) {
  const client = await getClient();
  if (!client) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const att = await db.attachment.findUnique({ where: { id: Number(params.id) } });
  if (!att || !(CLIENT_VISIBLE as readonly string[]).includes(att.entityType)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const tenderId =
    att.entityType === "diary"
      ? (await db.siteDiary.findUnique({ where: { id: att.entityId }, select: { tenderId: true } }))?.tenderId
      : att.entityType === "portal_message"
        ? (await db.portalMessage.findUnique({ where: { id: att.entityId }, select: { tenderId: true } }))?.tenderId
        : (await db.signRequest.findUnique({ where: { id: att.entityId }, select: { tenderId: true } }))?.tenderId;
  if (!tenderId || !client.accesses.some((a) => a.tenderId === tenderId)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const buf = await readAttachmentData(att);
  if (!buf) return NextResponse.json({ error: "file missing" }, { status: 410 });
  const inline = att.mimeType.startsWith("image/") || att.mimeType === "application/pdf";
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": att.mimeType,
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(att.fileName)}`,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

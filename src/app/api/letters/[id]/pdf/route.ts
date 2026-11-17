import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { readAttachmentData } from "@/lib/uploads";
import { LETTER_PDF_LABEL, letterDataOf, loadLetter } from "@/lib/letter-load";
import { letterPdf } from "@/lib/letter-pdf";
import { letterPdfName } from "@/lib/letter";
import { isLetterApproved } from "@/lib/letter-flow";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const send = (buf: Buffer, name: string, download: boolean) =>
  new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(buf.length),
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });

/**
 * الكتاب الرسمي PDF على ورقة الشركة:
 * المعتمد ← يُولّد مرة واحدة ويُؤرشف كمرفق للكتاب (النسخة الرسمية كما صدرت) ثم يُقدَّم من الأرشيف؛
 * غير المعتمد ← معاينة بعلامة «مسودة — غير معتمد» لا تُحفظ.
 */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const c = await loadLetter(Number(params.id), user);
  if (!c) return NextResponse.json({ error: "not found" }, { status: 404 });
  const download = new URL(req.url).searchParams.has("download");
  const data = letterDataOf(c);
  const name = letterPdfName(data.refNo);
  try {
    if (!isLetterApproved(c)) return send(await letterPdf(data), name, download);
    const att = await db.attachment.findFirst({ where: { entityType: "correspondence", entityId: c.id, label: LETTER_PDF_LABEL }, orderBy: { id: "desc" } });
    if (att) {
      const buf = await readAttachmentData(att);
      if (buf) return send(buf, att.fileName, download);
    }
    const pdf = await letterPdf(data);
    const a = await db.attachment.create({
      data: { entityType: "correspondence", entityId: c.id, fileName: name, storedName: `${c.id}-letter.pdf`, mimeType: "application/pdf", size: pdf.length, label: LETTER_PDF_LABEL, uploadedById: c.approvedById ?? user.id },
    });
    await db.attachmentBlob.create({ data: { attachmentId: a.id, data: pdf } });
    return send(pdf, name, download);
  } catch (e) {
    console.error("[letter-pdf]", e);
    return NextResponse.json({ error: "تعذر توليد ملف PDF للكتاب — أعد المحاولة بعد لحظات" }, { status: 500 });
  }
}

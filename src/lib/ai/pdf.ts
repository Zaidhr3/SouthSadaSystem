import "server-only";
import { PDFDocument } from "pdf-lib";

/**
 * تقسيم PDF إلى مقاطع صفحات: جدول الكميات الطويل يُقرأ على دفعات صغيرة متوازية
 * (كل دفعة طلب قصير ضمن حد زمن Vercel) ثم تُدمج البنود مع أرقام الصفحات الأصلية.
 */
export const PAGES_PER_CHUNK = Math.max(1, Number(process.env.GEMINI_PAGES_PER_CHUNK || 2));

export async function pdfPageCount(data: Buffer): Promise<number> {
  const doc = await PDFDocument.load(data, { ignoreEncryption: true, updateMetadata: false });
  return doc.getPageCount();
}

/** صفحات from..to (من 1، شاملة) كملف PDF مستقل */
export async function pdfSlice(data: Buffer, from: number, to: number): Promise<Buffer> {
  const src = await PDFDocument.load(data, { ignoreEncryption: true, updateMetadata: false });
  const n = src.getPageCount();
  const a = Math.max(1, Math.min(from, n));
  const b = Math.max(a, Math.min(to, n));
  const out = await PDFDocument.create();
  const pages = await out.copyPages(src, Array.from({ length: b - a + 1 }, (_, i) => a - 1 + i));
  pages.forEach((p) => out.addPage(p));
  return Buffer.from(await out.save());
}

export function chunkRanges(pages: number, size = PAGES_PER_CHUNK): [number, number][] {
  const out: [number, number][] = [];
  for (let a = 1; a <= pages; a += size) out.push([a, Math.min(pages, a + size - 1)]);
  return out;
}

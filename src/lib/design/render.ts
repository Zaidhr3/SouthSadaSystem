import "server-only";
import { launchBrowser } from "../browser";

/** يرسم صفحات HTML إلى صور JPEG (إنستغرام يقبل JPG) — متصفح واحد لكل الدفعة */
export async function renderImages(pages: { html: string; w: number; h: number }[], quality = 92): Promise<Buffer[]> {
  const browser = await launchBrowser();
  try {
    const out: Buffer[] = [];
    for (const p of pages) {
      const page = await browser.newPage();
      await page.setViewport({ width: p.w, height: p.h, deviceScaleFactor: 1 });
      await page.setContent(p.html, { waitUntil: "load", timeout: 30_000 });
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      await page.waitForFunction("window.__ready === true", { timeout: 5_000 }).catch(() => undefined);
      out.push(Buffer.from(await page.screenshot({ type: "jpeg", quality })));
      await page.close();
    }
    return out;
  } finally {
    await browser.close().catch(() => undefined);
  }
}

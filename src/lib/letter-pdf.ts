import "server-only";
import { letterHtml, type LetterData } from "./letter";
import { launchBrowser } from "./browser";

/** يطبع الكتاب PDF (A4) */
export async function letterPdf(d: LetterData): Promise<Buffer> {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent(letterHtml(d), { waitUntil: "load", timeout: 30_000 });
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    // انتظار تثبيت الخاتمة والتوقيع أسفل الصفحة الأخيرة
    await page.waitForFunction("window.__laid === true", { timeout: 10_000 }).catch(() => undefined);
    const pdf = await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
    return Buffer.from(pdf);
  } finally {
    await browser.close().catch(() => undefined);
  }
}


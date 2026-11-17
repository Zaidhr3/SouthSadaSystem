import "server-only";
import fs from "node:fs";
import type { Browser } from "puppeteer-core";

/** مسار متصفح محلي (للتطوير والاختبار على الجهاز) — على Vercel يُستخدم Chromium المضمّن */
function localChrome() {
  const c = [
    process.env.CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].filter(Boolean) as string[];
  return c.find((p) => fs.existsSync(p));
}

/** متصفح بلا واجهة: Chromium المضغوط على Vercel، أو Chrome/Edge المحلي — مشترك بين PDF الكتب والتصاميم */
export async function launchBrowser(): Promise<Browser> {
  const puppeteer = (await import("puppeteer-core")).default;
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    const chromium = (await import("@sparticuz/chromium")).default;
    chromium.setGraphicsMode = false;
    return puppeteer.launch({ args: await puppeteer.defaultArgs({ args: chromium.args, headless: "shell" }), executablePath: await chromium.executablePath(), headless: "shell" });
  }
  const exe = localChrome();
  if (!exe) throw new Error("لا يوجد متصفح Chrome/Edge — عرّف CHROME_PATH");
  return puppeteer.launch({ executablePath: exe, headless: true, args: ["--no-sandbox", "--disable-gpu"] });
}

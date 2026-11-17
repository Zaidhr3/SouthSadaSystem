/** @type {import('next').NextConfig} */
const nextConfig = {
  // يسمح ببناء نسخة اختبار منفصلة دون المساس بالنسخة العاملة
  distDir: process.env.NEXT_DIST_DIR || ".next",
  experimental: {
    instrumentationHook: true,
    serverActions: {
      bodySizeLimit: "30mb",
      // النطاقات المسموح لها بتنفيذ الإجراءات (رابط Cloudflare العام) — من APP_URL أو ALLOWED_ORIGINS
      allowedOrigins: [process.env.APP_URL, ...(process.env.ALLOWED_ORIGINS || "").split(",")]
        .map((u) => (u || "").trim().replace(/^https?:\/\//, "").replace(/\/.*$/, ""))
        .filter(Boolean),
    },
    serverComponentsExternalPackages: ["@prisma/client", "bcryptjs", "nodemailer", "exceljs", "@sparticuz/chromium", "puppeteer-core"],
    // Chromium المضغوط (لطباعة الكتب الرسمية PDF) يُقرأ من مجلد bin وقت التشغيل — يُضمّن في دالة الطباعة فقط
    outputFileTracingIncludes: {
      "/api/letters/[id]/pdf": ["./node_modules/@sparticuz/chromium/bin/**"],
      // توليد التصاميم (القوالب المؤسسية وهوية الحسابات) بالمتصفح نفسه
      "/marketing/[id]": ["./node_modules/@sparticuz/chromium/bin/**"],
      "/marketing/brand": ["./node_modules/@sparticuz/chromium/bin/**"],
      "/marketing/relaunch": ["./node_modules/@sparticuz/chromium/bin/**"],
      "/marketing/grid": ["./node_modules/@sparticuz/chromium/bin/**"],
    },
  },
  poweredByHeader: false,
  // حد المرفقات في الطلب العادي: Vercel يرفض أي طلب أكبر من 4.5 ميغابايت (حد ثابت للمنصة لا يرفعه bodySizeLimit) — محلياً 20.
  // ما فوقه يُرفع مباشرة من المتصفح إلى Supabase Storage (حتى NEXT_PUBLIC_MAX_STAGED_MB) ويصل للخادم كرمز فقط.
  env: {
    NEXT_PUBLIC_MAX_UPLOAD_MB: process.env.NEXT_PUBLIC_MAX_UPLOAD_MB || (process.env.VERCEL ? "4" : "20"),
    NEXT_PUBLIC_DIRECT_UPLOAD: process.env.NEXT_PUBLIC_DIRECT_UPLOAD || (process.env.VERCEL ? "1" : "0"),
    NEXT_PUBLIC_MAX_STAGED_MB: process.env.NEXT_PUBLIC_MAX_STAGED_MB || "20",
  },
};
export default nextConfig;

import { NextResponse, type NextRequest } from "next/server";
import { MAINTENANCE_HTML } from "./lib/maintenance";
import { IDLE_GRACE_MS, IDLE_LIMIT_MS, SEEN_COOKIE, SESSION_COOKIE, verifySession } from "./lib/session";

const PREVIEW_COOKIE = "sada_preview";
/** /portal بوابة العملاء: لها جلستها المستقلة وتتحقق منها بنفسها (lib/client-session) */
const PUBLIC = ["/login", "/portal", "/manifest.webmanifest", "/sw.js", "/offline.html"];
/** نقاط آلية تتحقق من سرّها بنفسها */
const MACHINE = ["/api/cron/", "/api/public/"];

/**
 * طبقة أولى لحماية المسارات حسب الدور (الخادم يتحقق مجدداً في كل صفحة وإجراء).
 * الترتيب مهم: أول قاعدة مطابقة تُطبق.
 */
const RULES: { prefix: string; roles: string[] }[] = [
  { prefix: "/tenders/new", roles: ["ADMIN"] },
  { prefix: "/claims/new", roles: ["ADMIN", "ACCOUNTANT", "PM"] },
  { prefix: "/expenses/new", roles: ["ADMIN", "ACCOUNTANT", "PM"] },
  { prefix: "/users", roles: ["ADMIN"] },
  { prefix: "/system", roles: ["ADMIN"] },
  { prefix: "/audit", roles: ["ADMIN", "CHAIRMAN", "AUDITOR"] },
  { prefix: "/marketing", roles: ["ADMIN", "CHAIRMAN"] },
  { prefix: "/board", roles: ["ADMIN", "ACCOUNTANT", "CHAIRMAN", "AUDITOR"] },
  { prefix: "/assistant", roles: ["ADMIN", "CHAIRMAN"] },
  ...["/guarantees", "/cheques", "/debts", "/documents", "/reports", "/taxes", "/einvoices", "/api/export/financial"].map((prefix) => ({ prefix, roles: ["ADMIN", "ACCOUNTANT", "CHAIRMAN", "AUDITOR"] })),
];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  // وضع الصيانة (MAINTENANCE_MODE=1 على الخادم): كل الصفحات تعرض رسالة الصيانة، ولا تُنفذ أي عملية
  // المعاينة أثناء الصيانة: فتح /?preview=<MAINTENANCE_BYPASS> مرة واحدة يحفظ كوكي يتجاوز الصيانة على هذا الجهاز فقط
  const bypass = process.env.MAINTENANCE_BYPASS;
  if (process.env.MAINTENANCE_MODE === "1" && bypass && bypass.length >= 16 && req.nextUrl.searchParams.get("preview") === bypass) {
    const url = req.nextUrl.clone();
    url.searchParams.delete("preview");
    const res = NextResponse.redirect(url);
    res.cookies.set(PREVIEW_COOKIE, bypass, { httpOnly: true, sameSite: "lax", secure: req.nextUrl.protocol === "https:", path: "/", maxAge: 60 * 60 * 24 * 30 });
    return res;
  }
  const previewing = !!bypass && bypass.length >= 16 && req.cookies.get(PREVIEW_COOKIE)?.value === bypass;
  // طلبات عروض الأسعار من موقع الشركة تبقى مفتوحة حتى أثناء الصيانة (لا يضيع أي عميل)
  if (process.env.MAINTENANCE_MODE === "1" && !previewing && !pathname.startsWith("/api/public/rfq") && !pathname.startsWith("/api/cron/")) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "maintenance", message: "النظام تحت الصيانة — حاول بعد قليل" }, { status: 503, headers: { "Retry-After": "600" } });
    if (pathname !== "/sw.js" && pathname !== "/manifest.webmanifest") {
      return new NextResponse(MAINTENANCE_HTML, { status: 503, headers: { "Content-Type": "text/html; charset=utf-8", "Retry-After": "600", "Cache-Control": "no-store" } });
    }
  }
  if (MACHINE.some((p) => pathname.startsWith(p))) return NextResponse.next();

  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);

  if (PUBLIC.some((p) => pathname.startsWith(p))) {
    // حساب أُوقف أثناء الجلسة: تُمسح الجلسة وتظهر رسالة الإيقاف (بلا حلقة إعادة توجيه)
    if (pathname === "/login" && req.nextUrl.searchParams.has("suspended")) {
      const res = NextResponse.next();
      res.cookies.delete(SESSION_COOKIE);
      return res;
    }
    if (pathname === "/login" && req.nextUrl.searchParams.has("idle")) {
      const res = NextResponse.next();
      res.cookies.delete(SESSION_COOKIE);
      res.cookies.delete(SEEN_COOKIE);
      return res;
    }
    if (session && pathname === "/login") return NextResponse.redirect(new URL("/", req.url));
    return NextResponse.next();
  }
  if (!session) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    return NextResponse.redirect(new URL("/login", req.url));
  }
  // القفل التلقائي: جلسة خاملة أكثر من دقيقتين (مثلاً هاتف مُغلق ثم فُتح لاحقاً) تعود لشاشة الدخول
  const now = Date.now();
  const seen = Number(req.cookies.get(SEEN_COOKIE)?.value || 0);
  if (seen && now - seen > IDLE_LIMIT_MS + IDLE_GRACE_MS) {
    const res = pathname.startsWith("/api/") ? NextResponse.json({ error: "locked" }, { status: 401 }) : NextResponse.redirect(new URL("/login?idle=1", req.url));
    res.cookies.delete(SESSION_COOKIE);
    res.cookies.delete(SEEN_COOKIE);
    return res;
  }
  const rule = RULES.find((r) => pathname.startsWith(r.prefix));
  if (rule && !rule.roles.includes(session.role)) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    return NextResponse.redirect(new URL("/", req.url));
  }
  const res = NextResponse.next();
  // التحميل المسبق للروابط ليس نشاطاً من المستخدم.
  // والطلبات الطويلة (قراءة الذكاء الاصطناعي على دفعات) لا تحدّث وقت النشاط: الكوكي يُكتب عند انتهائها
  // بوقت بدايتها فيطغى على نبضات أحدث ويُقفل الجلسة خطأً — نبضات /api/session/ping تغطي فترة الانتظار.
  if (!req.headers.get("next-router-prefetch") && !req.headers.get("purpose")?.includes("prefetch") && !pathname.startsWith("/api/ai/") && pathname !== "/api/notifications/count") {
    res.cookies.set(SEEN_COOKIE, String(now), { httpOnly: true, sameSite: "lax", secure: req.nextUrl.protocol === "https:", path: "/", maxAge: 60 * 60 * 12 });
  }
  return res;
}

export const config = {
  // الصور العامة (الشعار والأيقونات) متاحة دون تسجيل دخول لتظهر في صفحة الدخول وعلى الشاشة الرئيسية للهاتف
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|icons/|.*\.(?:jpg|JPG|jpeg|png|svg|webp|ico)$).*)"],
};

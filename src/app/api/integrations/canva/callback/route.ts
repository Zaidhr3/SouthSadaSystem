import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { exchangeCode } from "@/lib/canva";
import { auditEvent } from "@/lib/action";

export const dynamic = "force-dynamic";

/** عودة Canva بعد الموافقة: تحقق state، تبادل الرمز مع verifier، حفظ مشفّر */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const back = (msg: string) => NextResponse.redirect(new URL(`/system?canva=${encodeURIComponent(msg)}#canva`, req.url));
  const user = await getCurrentUser();
  if (!user || !can.manageSettings(user.role)) return NextResponse.redirect(new URL("/login", req.url));
  const [state, verifier, mode] = (cookies().get("canva_pkce")?.value ?? "").split(".");
  const err = url.searchParams.get("error");
  if (err) {
    // صلاحية غير مفعّلة في التكامل: إعادة تلقائية بالحد الأدنى (design:content:read يكفي للاستيراد)
    if (err === "invalid_scope" && mode !== "min") return NextResponse.redirect(new URL("/api/integrations/canva/start?scope=min", req.url));
    const desc = url.searchParams.get("error_description");
    const hint =
      err === "invalid_scope"
        ? "فعّل design:content:read (و design:meta:read) في تكامل Canva ← Scopes ثم احفظ وأعد الربط"
        : err === "access_denied"
          ? "أُلغيت الموافقة من صفحة Canva"
          : /redirect/i.test(`${err} ${desc}`)
            ? "رابط العودة غير مسجل — أضف الرابط الظاهر أدناه في Canva ← Authentication ← Redirect URLs حرفياً"
            : "";
    return back(`رُفض الربط (${err}${desc ? `: ${desc}` : ""})${hint ? ` — ${hint}` : ""}`);
  }
  const code = url.searchParams.get("code");
  if (!code || !state || state !== url.searchParams.get("state") || !verifier) return back("انتهت جلسة الربط أو لا تطابق — أعد المحاولة");
  try {
    await exchangeCode(code, verifier, user.name);
    await auditEvent("CONNECT", "Integration", "ربط Canva", user);
    const res = back("ok");
    res.cookies.delete("canva_pkce");
    return res;
  } catch (e) {
    return back(e instanceof Error ? e.message : "فشل الربط");
  }
}

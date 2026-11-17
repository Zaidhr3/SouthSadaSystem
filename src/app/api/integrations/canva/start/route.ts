import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { authorizeUrl } from "@/lib/canva";

export const dynamic = "force-dynamic";

/** بداية ربط Canva (المدير العام فقط): PKCE + state في كوكي httpOnly لمدة 10 دقائق */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user || !can.manageSettings(user.role)) return NextResponse.redirect(new URL("/login", req.url));
  try {
    const minimal = new URL(req.url).searchParams.get("scope") === "min";
    const a = await authorizeUrl(minimal);
    const res = NextResponse.redirect(a.url);
    res.cookies.set("canva_pkce", `${a.state}.${a.verifier}.${minimal ? "min" : "full"}`, { httpOnly: true, secure: true, sameSite: "lax", path: "/api/integrations/canva", maxAge: 600 });
    return res;
  } catch (e) {
    return NextResponse.redirect(new URL(`/system?canva=${encodeURIComponent(e instanceof Error ? e.message : "error")}#canva`, req.url));
  }
}

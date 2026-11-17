"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { actionUser } from "@/lib/auth";
import { auditEvent, run, type ActionState } from "@/lib/action";
import { can } from "@/lib/permissions";
import { VISIBILITY_ROLES } from "@/lib/brand";

/** هوية الشركة ورؤيتها على المستندات + من يرى الأرباح والحساب البنكي — المدير العام فقط */
export async function saveBrandSettings(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await actionUser(can.manageSettings);
    const slogan = String(fd.get("slogan") ?? "").trim().slice(0, 120);
    const pick = (field: string) => VISIBILITY_ROLES.filter((r) => fd.getAll(field).map(String).includes(r)).join(",");
    const rows: [string, string][] = [
      ["brand.slogan", slogan],
      ["vis.profit", pick("profit")],
      ["vis.bank", pick("bank")],
    ];
    for (const [key, value] of rows) await db.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
    await auditEvent("update", "Setting", `الهوية والرؤية: الشعار «${slogan || "—"}» — يرى الأرباح: المدير العام${rows[1][1] ? "، " + rows[1][1] : ""} — يرى البنك: المدير العام${rows[2][1] ? "، " + rows[2][1] : ""}`, user);
    revalidatePath("/", "layout");
    return "حُفظت إعدادات الهوية والرؤية";
  });
}

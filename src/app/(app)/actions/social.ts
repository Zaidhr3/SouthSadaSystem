"use server";

import { revalidatePath } from "next/cache";
import { actionUser } from "@/lib/auth";
import { auditEvent, run, type ActionState } from "@/lib/action";
import { AppError, can } from "@/lib/permissions";
import { analyzeSocial, applyDecision, syncSocial } from "@/lib/social";
import { createBoost, boostAdvice, saveAdsConfig, selectMetaAdAccount } from "@/lib/boost";

const done = () => {
  revalidatePath("/marketing/accounts");
  revalidatePath("/marketing");
};

/** تحديث الحسابات: سحب المنشورات والأرقام ثم حكم المحلل الذكي */
export async function refreshAccounts(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = await run(async () => {
    await actionUser(can.manageMarketing);
    const s = await syncSocial().catch((e) => {
      throw new AppError(e instanceof Error ? e.message : "تعذر السحب");
    });
    const a = await analyzeSocial({ all: fd.get("all") === "1" });
    return `سُحب ${s.fb} منشور فيسبوك و${s.ig} إنستغرام — حُلّل ${a.analyzed}${s.errors.length ? ` (تنبيه: ${s.errors.join(" | ")})` : ""}`;
  });
  done();
  return r;
}

export async function decidePost(id: string, action: "DELETE" | "HIDE" | "IGNORE", _: ActionState, __: FormData): Promise<ActionState> {
  const r = await run(async () => {
    const user = await actionUser(can.manageMarketing);
    const msg = await applyDecision(id, action).catch((e) => {
      throw new AppError(e instanceof Error ? e.message : "تعذر التنفيذ");
    });
    await auditEvent(action === "DELETE" ? "DELETE" : "UPDATE", "SocialPost", `${action} ${id}: ${msg}`, user);
    return msg;
  });
  done();
  return r;
}

/** تحليل جدارة التمويل لمنشور (قراءة الأداء والمحتوى) */
export async function adviseBoost(id: string, _: ActionState, __: FormData): Promise<ActionState> {
  const r = await run(async () => {
    await actionUser(can.manageMarketing);
    const a = await boostAdvice(id).catch((e) => {
      throw new AppError(e instanceof Error ? e.message : "تعذر التحليل");
    });
    return a.worth ? `يستحق التمويل (${a.score}/100): ${a.summary}` : `لا أنصح بتمويله الآن (${a.score}/100): ${a.summary}`;
  });
  revalidatePath(`/marketing/accounts`);
  return r;
}

/** إنشاء حملة تمويل فعلية (بموافقة صريحة ومبلغ محدد) */
export async function launchBoost(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const r = await run(async () => {
    const user = await actionUser((x) => x === "ADMIN");
    const daily = Number(fd.get("daily"));
    const days = Number(fd.get("days"));
    if (fd.get("confirm") !== "on") throw new AppError("أكّد الموافقة على الصرف");
    const b = await createBoost(id, { daily, days }, user.id).catch((e) => {
      throw new AppError(e instanceof Error ? e.message : "تعذر إنشاء الحملة");
    });
    await auditEvent("CREATE", "AdBoost", `تمويل منشور ${id}: ${daily} يومياً × ${days} يوم`, user);
    return b.message;
  });
  done();
  return r;
}

/** إعداد التمويل: رمز الإعلانات + الحساب الإعلاني + السقف الشهري (يُتحقق منه مع Meta قبل الحفظ) */
export async function saveAdsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = await run(async () => {
    const user = await actionUser((x) => x === "ADMIN");
    const token = String(fd.get("token") ?? "").trim();
    const account = String(fd.get("account") ?? "").trim();
    const cap = Number(fd.get("cap"));
    if (token.length < 50 || !account || !(cap > 0)) throw new AppError("أدخل رمز الإعلانات ورقم الحساب الإعلاني والسقف الشهري");
    const a = await saveAdsConfig(token, account, cap).catch((e) => {
      throw new AppError(e instanceof Error ? e.message : "تعذر التحقق");
    });
    await auditEvent("UPDATE", "Integration", `إعداد التمويل الإعلاني: ${a.name} (${a.currency})، سقف ${cap}`, user);
    return `رُبط الحساب الإعلاني «${a.name}» (${a.currency}) — السقف الشهري ${cap}`;
  });
  done();
  return r;
}

/** اختيار حساب إعلاني من ربط فيسبوك (بلا رمز منفصل) */
export async function pickAdAccountAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = await run(async () => {
    const user = await actionUser((x) => x === "ADMIN");
    const account = String(fd.get("account") ?? "");
    const cap = Number(fd.get("cap"));
    if (!account.startsWith("act_") || !(cap > 0)) throw new AppError("اختر الحساب الإعلاني وحدد السقف الشهري");
    const a = await selectMetaAdAccount(account, cap).catch((e) => {
      throw new AppError(e instanceof Error ? e.message : "تعذر الربط");
    });
    await auditEvent("UPDATE", "Integration", `التمويل عبر ربط فيسبوك: ${a.name} (${a.currency})، سقف ${cap}`, user);
    return `رُبط الحساب الإعلاني «${a.name}» من ربط فيسبوك — السقف الشهري ${cap} ${a.currency ?? ""}`;
  });
  done();
  return r;
}

/** تحديث «من استقطبت إعلاناتك» من Meta Insights */
export async function refreshAudienceAction(_: ActionState, __: FormData): Promise<ActionState> {
  const r = await run(async () => {
    await actionUser(can.manageMarketing);
    const { refreshAudiences } = await import("@/lib/boost");
    const res = await refreshAudiences();
    if (!res.total) throw new AppError("لا توجد إعلانات ممولة منشورة بعد — موّل منشوراً أولاً");
    if (!res.ok) throw new AppError(`تعذر جلب الجمهور: ${res.error}`);
    return `حُدّث جمهور ${res.ok} من ${res.total} إعلانات`;
  });
  revalidatePath("/marketing/accounts");
  return r;
}

"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { actionUser } from "@/lib/auth";
import { run, type ActionState } from "@/lib/action";
import { AppError } from "@/lib/permissions";
import { saveAttachments, validateAttachments } from "@/lib/uploads";
import { PRESETS } from "@/lib/profile-presets";

type Slot = "avatar" | "cover" | "wallpaper";
const FIELD: Record<Slot, "avatarId" | "coverId" | "wallpaperId"> = { avatar: "avatarId", cover: "coverId", wallpaper: "wallpaperId" };
const LABEL: Record<Slot, string> = { avatar: "الصورة الشخصية", cover: "صورة الغلاف", wallpaper: "خلفية النظام" };

/** رفع صورة شخصية / غلاف / خلفية — لصاحب الحساب نفسه (كل الأدوار) */
export async function uploadProfileImage(slot: Slot, _: ActionState, fd: FormData): Promise<ActionState> {
  const r = await run(async () => {
    const user = await actionUser(undefined, { readOnlyOk: true });
    const f = fd.get("files");
    if (!(f && typeof f === "object" && "size" in f && f.size > 0) && !fd.getAll("files__staged").length) throw new AppError("اختر صورة");
    if (f && typeof f === "object" && "type" in f && f.size > 0 && !["image/jpeg", "image/png", "image/webp"].includes(f.type)) throw new AppError("الصورة يجب أن تكون JPG أو PNG أو WEBP");
    await validateAttachments(fd, user.id);
    await saveAttachments(fd, "user_profile", user.id, user.id, "files", { slot, label: LABEL[slot] });
    const att = await db.attachment.findFirst({ where: { entityType: "user_profile", entityId: user.id, slot }, orderBy: { id: "desc" } });
    if (!att) throw new AppError("تعذر حفظ الصورة");
    const prev = (await db.user.findUnique({ where: { id: user.id }, select: { [FIELD[slot]]: true } })) as Record<string, number | null> | null;
    await db.user.update({ where: { id: user.id }, data: { [FIELD[slot]]: att.id, ...(slot === "cover" ? { coverPreset: null } : slot === "wallpaper" ? { wallpaperPreset: null } : {}) } });
    const old = prev?.[FIELD[slot]];
    if (old && old !== att.id) await db.attachment.deleteMany({ where: { id: old, entityType: "user_profile", entityId: user.id } });
    return `حُدّثت ${LABEL[slot]}`;
  });
  revalidatePath("/", "layout");
  return r;
}

/** اختيار قالب جاهز للغلاف أو الخلفية، أو إزالة الصورة */
export async function setProfilePreset(slot: "cover" | "wallpaper" | "avatar", preset: string | null) {
  return run(async () => {
    const user = await actionUser(undefined, { readOnlyOk: true });
    if (preset && !PRESETS[preset]) throw new AppError("قالب غير معروف");
    const field = FIELD[slot];
    const cur = (await db.user.findUnique({ where: { id: user.id }, select: { [field]: true } })) as Record<string, number | null> | null;
    const old = cur?.[field];
    await db.user.update({ where: { id: user.id }, data: { [field]: null, ...(slot === "cover" ? { coverPreset: preset } : slot === "wallpaper" ? { wallpaperPreset: preset } : {}) } });
    if (old) await db.attachment.deleteMany({ where: { id: old, entityType: "user_profile", entityId: user.id } });
    revalidatePath("/", "layout");
    return preset ? "طُبّق القالب" : `أُزيلت ${LABEL[slot]}`;
  });
}

export async function saveBio(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = await run(async () => {
    const user = await actionUser(undefined, { readOnlyOk: true });
    const bio = String(fd.get("bio") ?? "").trim().slice(0, 1200);
    await db.user.update({ where: { id: user.id }, data: { bio: bio || null } });
    return "حُفظت السيرة الذاتية";
  });
  revalidatePath("/settings");
  revalidatePath("/board");
  return r;
}

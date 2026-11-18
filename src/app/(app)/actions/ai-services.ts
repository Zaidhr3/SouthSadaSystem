"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { actionUser } from "@/lib/auth";
import { auditEvent, run, runVoid, type ActionState } from "@/lib/action";
import { AppError, can } from "@/lib/permissions";
import { saveServiceKey, textToSpeech, voices, webResearch, scrapeUrl, type ServiceKey, SERVICE_LABEL } from "@/lib/ai-services";
import { saveAttachments } from "@/lib/uploads";

const KEYS: ServiceKey[] = ["perplexity", "firecrawl", "elevenlabs"];

/** حفظ مفتاح خدمة بعد اختباره فعلياً مع مزوّدها */
export async function saveServiceAction(service: ServiceKey, _: ActionState, fd: FormData): Promise<ActionState> {
  const r = await run(async () => {
    const user = await actionUser(can.manageSettings);
    if (!KEYS.includes(service)) throw new AppError("خدمة غير معروفة");
    const key = String(fd.get("key") ?? "").trim();
    if (key.length < 16) throw new AppError("الصق المفتاح كاملاً");
    await saveServiceKey(service, key);
    try {
      if (service === "perplexity") await webResearch("ما عاصمة الأردن؟ أجب بكلمة");
      if (service === "firecrawl") await scrapeUrl("https://example.com");
      if (service === "elevenlabs") await voices();
    } catch (e) {
      await saveServiceKey(service, null);
      throw new AppError(`المفتاح لم يعمل — لم يُحفظ: ${e instanceof Error ? e.message : e}`);
    }
    await auditEvent("UPDATE", "Integration", `مفتاح ${SERVICE_LABEL[service].name}`, user);
    return `تم التحقق والحفظ ✓ — ${SERVICE_LABEL[service].name} يعمل الآن`;
  });
  revalidatePath("/system");
  return r;
}

export async function removeServiceAction(service: ServiceKey) {
  const r = await runVoid(async () => {
    const user = await actionUser(can.manageSettings);
    await saveServiceKey(service, null);
    await auditEvent("DISCONNECT", "Integration", `حذف مفتاح ${SERVICE_LABEL[service].name}`, user);
  });
  revalidatePath("/system");
  return r;
}

/** تعليق صوتي عربي لعنصر تسويق (نص الشاشة للقصة أو أول فقرة للمنشور، أو نص مخصص) */
export async function voiceoverAction(itemId: number, _: ActionState, fd: FormData): Promise<ActionState> {
  const r = await run(async () => {
    const user = await actionUser(can.manageMarketing);
    const it = await db.marketingItem.findUnique({ where: { id: itemId } });
    if (!it) throw new AppError("العنصر غير موجود");
    const text = String(fd.get("script") ?? "").trim() || it.storyText || it.caption.replace(/#\S+/g, "").split(/\n\s*\n/).slice(0, 2).join("\n");
    const voice = String(fd.get("voice") ?? "");
    if (!voice) throw new AppError("اختر الصوت");
    const mp3 = await textToSpeech(text, voice).catch((e) => {
      throw new AppError(e instanceof Error ? e.message : "تعذر التوليد");
    });
    await db.attachment.deleteMany({ where: { entityType: "marketing", entityId: itemId, slot: "voice" } });
    const one = new FormData();
    one.append("files", new File([new Uint8Array(mp3)], `voice-${itemId}.mp3`, { type: "audio/mpeg" }));
    await saveAttachments(one, "marketing", itemId, user.id, "files", { slot: "voice", label: "تعليق صوتي" });
    return "جُهّز التعليق الصوتي — استمع إليه ونزّله لمونتاج الريل";
  });
  revalidatePath(`/marketing/${itemId}`);
  return r;
}

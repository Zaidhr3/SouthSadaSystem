"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { actionUser } from "@/lib/auth";
import { auditEvent, run, runVoid, type ActionState } from "@/lib/action";
import { AppError, type Role } from "@/lib/permissions";
import { ask } from "@/lib/assistant/agent";
import { importSkill } from "@/lib/assistant/skills";
import { executeAction } from "@/lib/assistant/actions";

const ALLOWED = (r: Role) => r === "ADMIN" || r === "CHAIRMAN";
const t = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

/** سؤال للمساعد — في محادثة قائمة أو جديدة */
export async function askAssistant(threadId: number | null, _: ActionState, fd: FormData): Promise<ActionState> {
  let newId = 0;
  const r = await run(async () => {
    const user = await actionUser(ALLOWED, { readOnlyOk: true });
    const msg = t(fd, "message");
    if (msg.length < 2) throw new AppError("اكتب سؤالك");
    let id = threadId;
    if (id) {
      const th = await db.assistantThread.findUnique({ where: { id } });
      if (!th || th.userId !== user.id) throw new AppError("المحادثة غير موجودة");
    } else {
      id = (await db.assistantThread.create({ data: { userId: user.id, title: msg.slice(0, 80) } })).id;
      newId = id;
    }
    await ask(id, msg.slice(0, 4000), user);
    return "✓";
  });
  if (r.ok && newId) redirect(`/assistant?t=${newId}`);
  revalidatePath("/assistant");
  return r;
}

/** فحص شامل بضغطة: المساعد يفحص النظام ويسجل ما يجده في سجل المشاكل */
export async function fullCheckup(_: ActionState, __: FormData): Promise<ActionState> {
  let newId = 0;
  const r = await run(async () => {
    const user = await actionUser(ALLOWED, { readOnlyOk: true });
    const th = await db.assistantThread.create({ data: { userId: user.id, title: `فحص شامل ${new Date().toISOString().slice(0, 10)}` } });
    newId = th.id;
    await ask(
      th.id,
      "افحص النظام كاملاً الآن: شغّل فحص السلامة، راجع التنبيهات الحية، اللقطة المالية، طلبات التسعير والتسويق والحسابات، وآخر النشاط. سجّل كل مشكلة حقيقية في سجل المشاكل (بعد التأكد أنها غير مسجلة)، ثم أعطني تقريراً مرتباً بالأولوية: الحرج أولاً، مع الحل لكل بند.",
      user,
    );
    return "✓";
  });
  if (r.ok && newId) redirect(`/assistant?t=${newId}`);
  return r;
}

export async function deleteThread(id: number) {
  const r = await runVoid(async () => {
    const user = await actionUser(ALLOWED, { readOnlyOk: true });
    await db.assistantThread.deleteMany({ where: { id, userId: user.id } });
  });
  revalidatePath("/assistant");
  return r;
}

export async function setIssueStatus(id: number, status: "RESOLVED" | "DISMISSED" | "OPEN") {
  const r = await runVoid(async () => {
    const user = await actionUser((x) => x === "ADMIN");
    await db.systemIssue.update({ where: { id }, data: { status, resolvedAt: status === "OPEN" ? null : new Date() } });
    await auditEvent("UPDATE", "SystemIssue", `مشكلة #${id} ← ${status}`, user);
  });
  revalidatePath("/assistant");
  return r;
}

/** استيراد مهارة من GitHub (SKILL.md أو أي ملف Markdown) */
export async function importSkillAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = await run(async () => {
    const user = await actionUser((x) => x === "ADMIN");
    const res = await importSkill(t(fd, "url"), (t(fd, "scope") || "both") as "assistant" | "marketing" | "both", user.id).catch((e) => {
      throw new AppError(e instanceof Error ? e.message : "تعذر الاستيراد");
    });
    await auditEvent("CREATE", "AiSkill", `استيراد مهارة ${res.names.join("، ")}`, user);
    return `استُوردت ${res.names.length} مهارة: ${res.names.join("، ")}`;
  });
  revalidatePath("/assistant");
  return r;
}

export async function toggleSkill(id: number) {
  const r = await runVoid(async () => {
    await actionUser((x) => x === "ADMIN");
    const s = await db.aiSkill.findUnique({ where: { id } });
    if (s) await db.aiSkill.update({ where: { id }, data: { enabled: !s.enabled } });
  });
  revalidatePath("/assistant");
  return r;
}

export async function deleteSkill(id: number) {
  const r = await runVoid(async () => {
    await actionUser((x) => x === "ADMIN");
    await db.aiSkill.delete({ where: { id } });
  });
  revalidatePath("/assistant");
  return r;
}

/** تنفيذ إجراء اقترحه المساعد — بعد موافقتك وبصلاحياتك */
export async function approveAssistantAction(id: number) {
  const r = await runVoid(async () => {
    const user = await actionUser((x) => x === "ADMIN");
    const res = await executeAction(id, user).catch((e) => {
      throw new AppError(e instanceof Error ? e.message : "تعذر التنفيذ");
    });
    await db.assistantMessage.create({ data: { threadId: res.action.threadId, role: "assistant", text: res.ok ? `✅ نُفّذ: ${res.action.summary}\n\n${res.result}` : `⚠️ لم يُنفَّذ: ${res.action.summary}\n\nالسبب: ${res.result}`, model: "system" } });
    await db.assistantThread.update({ where: { id: res.action.threadId }, data: { updatedAt: new Date() } });
  });
  revalidatePath("/assistant");
  return r;
}

/** تنفيذ كل الإجراءات المقترحة في المحادثة بالترتيب */
export async function approveAllAssistantActions(threadId: number) {
  const r = await runVoid(async () => {
    const user = await actionUser((x) => x === "ADMIN");
    const pending = await db.assistantAction.findMany({ where: { threadId, userId: user.id, status: "PROPOSED" }, orderBy: { id: "asc" } });
    const lines: string[] = [];
    for (const a of pending) {
      const res = await executeAction(a.id, user).catch((e) => ({ ok: false, result: e instanceof Error ? e.message : String(e), action: a }));
      lines.push(`${res.ok ? "✅" : "⚠️"} ${a.summary}${res.ok ? "" : ` — ${res.result}`}`);
    }
    if (lines.length) await db.assistantMessage.create({ data: { threadId, role: "assistant", text: `نتيجة التنفيذ:\n${lines.map((l) => `- ${l}`).join("\n")}`, model: "system" } });
  });
  revalidatePath("/assistant");
  return r;
}

export async function rejectAssistantAction(id: number) {
  const r = await runVoid(async () => {
    const user = await actionUser(ALLOWED, { readOnlyOk: true });
    await db.assistantAction.updateMany({ where: { id, userId: user.id, status: "PROPOSED" }, data: { status: "REJECTED" } });
  });
  revalidatePath("/assistant");
  return r;
}

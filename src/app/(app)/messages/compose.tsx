import { Send } from "lucide-react";
import { db } from "@/lib/db";
import { tenderScope, type AppUser } from "@/lib/permissions";
import { ROLE_LABELS } from "@/lib/labels";
import { Input, ModalForm, Select, Textarea } from "@/components/forms";
import { sendMessage } from "../actions/messages";

/** نافذة رسالة جديدة */
export async function ComposeMessage({ user, to, tenderId, subject, trigger }: { user: AppUser; to?: number; tenderId?: number; subject?: string; trigger?: React.ReactNode }) {
  const [users, tenders] = await Promise.all([
    db.user.findMany({ where: { active: true, id: { not: user.id } }, select: { id: true, name: true, role: true, title: true }, orderBy: { name: "asc" } }),
    db.tender.findMany({ where: { ...tenderScope(user), status: { notIn: ["LOST", "CANCELLED"] } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return (
    <ModalForm title="رسالة داخلية جديدة" trigger={trigger ?? <><Send className="h-4 w-4" /> رسالة جديدة</>} action={sendMessage} submitLabel="إرسال" wide allowReadOnly>
      <Select name="recipientId" label="إلى" options={users.map((u) => ({ value: u.id, label: `${u.name} — ${u.title || ROLE_LABELS[u.role]}` }))} placeholder="— اختر المستلم —" defaultValue={to ?? ""} />
      <Input name="subject" label="الموضوع" required defaultValue={subject} />
      <Select name="tenderId" label="ربط بعطاء / مشروع (اختياري)" options={tenders.map((t) => ({ value: t.id, label: t.name }))} placeholder="— بدون —" defaultValue={tenderId ?? ""} />
      <Textarea name="body" label="نص الرسالة" required rows={6} />
    </ModalForm>
  );
}

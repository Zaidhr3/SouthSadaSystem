import { UserCheck } from "lucide-react";
import type { Delegation, User } from "@prisma/client";
import { Badge, Card } from "@/components/ui";
import { ConfirmButton, Grid, Input, ModalForm, Select, Textarea } from "@/components/forms";
import { ROLE_LABELS } from "@/lib/labels";
import { fmtDate, toInputDate, todayUTC } from "@/lib/format";
import { createDelegation, revokeDelegation } from "../actions/delegation";

/** التفويض المؤقت: نقل الصلاحيات أو الاعتماد نيابة عن شخص غائب — موثّق في كل السجلات */
export function Delegations({ users, rows }: { users: User[]; rows: Delegation[] }) {
  const name = new Map(users.map((u) => [u.id, u.name]));
  const active = users.filter((u) => u.active);
  const now = new Date();
  const state = (d: Delegation) => (d.revokedAt ? { l: "ملغى", t: "gray" as const } : d.endsAt < now ? { l: "منتهٍ", t: "gray" as const } : d.startsAt > now ? { l: "مجدول", t: "blue" as const } : { l: "نافذ الآن", t: "green" as const });
  return (
    <Card
      className="mb-5"
      title={<span className="flex items-center gap-2"><UserCheck className="h-5 w-5" /> التفويض المؤقت</span>}
      action={
        <ModalForm title="تفويض مؤقت" trigger="+ تفويض" action={createDelegation}>
          <p className="rounded-xl bg-accent-soft px-3 py-2 text-sm text-[#0058b0]">يعمل المفوَّض إليه بصلاحيات المفوِّض خلال الفترة فقط، ويُوثَّق كل إجراء باسمه «نيابة عن» المفوِّض في سجل التدقيق وسجل المطالبات.</p>
          <Grid>
            <Select name="fromUserId" label="المفوِّض (الغائب)" options={active.map((u) => ({ value: u.id, label: `${u.name} — ${ROLE_LABELS[u.role] ?? u.role}` }))} required />
            <Select name="toUserId" label="المفوَّض إليه" options={active.map((u) => ({ value: u.id, label: `${u.name} — ${ROLE_LABELS[u.role] ?? u.role}` }))} required />
          </Grid>
          <Grid>
            <Input name="startsAt" label="من تاريخ" type="date" required defaultValue={toInputDate(todayUTC())} />
            <Input name="endsAt" label="إلى تاريخ (شاملاً)" type="date" required />
          </Grid>
          <Textarea name="reason" label="السبب" required placeholder="إجازة / سفر / اعتماد مطالبة عاجلة" />
        </ModalForm>
      }
    >
      {rows.length === 0 ? (
        <p className="text-sm text-ink-muted">لا توجد تفويضات.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((d) => {
            const s = state(d);
            return (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-canvas p-3 text-sm">
                <span>
                  <b>{name.get(d.toUserId)}</b> نيابة عن <b>{name.get(d.fromUserId)}</b> ({ROLE_LABELS[d.role] ?? d.role}) — {fmtDate(d.startsAt)} ← {fmtDate(d.endsAt)}
                  <span className="block text-xs text-ink-muted">{d.reason}</span>
                </span>
                <span className="flex items-center gap-2">
                  <Badge tone={s.t}>{s.l}</Badge>
                  {!d.revokedAt && d.endsAt >= now && (
                    <ConfirmButton action={revokeDelegation.bind(null, d.id)} confirm="إلغاء التفويض فوراً؟" className="btn-danger btn-sm">إلغاء</ConfirmButton>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

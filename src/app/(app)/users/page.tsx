import { Ban, Megaphone, Pencil, Plus, Users } from "lucide-react";
import type { User } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { ROLE_LABELS } from "@/lib/labels";
import { fmtDate } from "@/lib/format";
import { Badge, Card, PageHeader } from "@/components/ui";
import { ConfirmButton, Grid, Input, ModalForm, Select, Textarea } from "@/components/forms";
import { saveUser, setUserNotice, suspendUser, toggleUserActive } from "../actions/admin";
import { Delegations } from "./delegations";

export const metadata = { title: "المستخدمون والصلاحيات" };

function UserFields({ u }: { u?: User }) {
  return (
    <>
      <Grid>
        <Input name="name" label="الاسم الكامل" required defaultValue={u?.name} />
        <Input name="username" label="اسم المستخدم (إنجليزي)" required defaultValue={u?.username} dir="ltr" />
      </Grid>
      <Grid>
        <Select name="role" label="الدور" options={ROLE_LABELS} defaultValue={u?.role ?? "PM"} hint="المشرف الأعلى والمراقب: اطلاع فقط دون أي تعديل" />
        <Input name="title" label="المسمى الوظيفي" defaultValue={u?.title ?? ""} />
        <Select name="boardSeat" label="مقعد مجلس الإدارة" options={[{ value: "", label: "ليس عضواً" }, { value: "MEMBER", label: "عضو مجلس الإدارة (يصوّت)" }, { value: "CHAIR", label: "رئيس مجلس الإدارة (يصوّت ويقرر فوراً)" }]} defaultValue={u?.boardSeat ?? ""} />
      </Grid>
      <Grid>
        <Input name="phone" label="الهاتف" defaultValue={u?.phone ?? ""} dir="ltr" />
        <Input name="password" label={u ? "كلمة مرور جديدة (اختياري)" : "كلمة المرور"} type="password" dir="ltr" autoComplete="new-password" hint="8 أحرف على الأقل" />
      </Grid>
      <Input name="email" label="البريد الإلكتروني (للتنبيهات)" type="email" dir="ltr" defaultValue={u?.email ?? ""} />
      <label className="flex items-center gap-2 text-sm font-semibold text-ink-soft">
        <input type="checkbox" name="notifyEmail" defaultChecked={u?.notifyEmail ?? true} className="h-4 w-4 accent-[#0071e3]" />
        إرسال التنبيهات والإشعارات إلى البريد
      </label>
    </>
  );
}

type Cell = boolean | string;
const PERMS: { label: string; v: [Cell, Cell, Cell, Cell, Cell] }[] = [
  //                                                                          المدير   المحاسب   مدير المشروع   المشرف الأعلى   المراقب
  { label: "رصيد الحساب البنكي والسيولة ورأس المال والأرباح والتدفق النقدي", v: [true, false, false, "عرض", false] },
  { label: "العطاءات ومراحلها والكفالات", v: [true, "عرض", "مشاريعه (عرض)", "عرض", "عرض"] },
  { label: "أ — إدخال جدول الكميات (قبل الاعتماد)", v: [true, "تدقيق", "مشاريعه", "عرض", "عرض"] },
  { label: "أ — اعتماد جدول الكميات التعاقدي وقفله", v: [true, true, false, false, false] },
  { label: "ب — الحصر الميداني وإرساله للمحاسب", v: [true, "إرجاع للتصحيح", "مشاريعه", "عرض", "عرض"] },
  { label: "ج — إعداد المطالبة المالية + بوابة البريد الإجبارية", v: [true, true, false, "عرض", "عرض"] },
  { label: "د — الاعتماد النهائي وقفل المطالبة", v: [true, false, false, false, false] },
  { label: "طلبات المواد والعهد", v: ["موافقة فوق الحد", "تدقيق وصرف", "رفع الطلب", "عرض", "عرض"] },
  { label: "قبض المطالبات، الشيكات، الضريبة، المصاريف، مستخلصات الباطن", v: [true, true, "مصاريف عهدته", "عرض", "عرض"] },
  { label: "اليومية، الصور، الديزل، المواد، الإنجاز", v: [true, false, "مشاريعه فقط", "عرض", "عرض"] },
  { label: "المراسلات الداخلية: رقابة كل المحادثات", v: [true, false, false, "عرض", false] },
  { label: "حذف المراسلات الداخلية", v: [true, false, false, false, false] },
  { label: "سجل الرقابة والتدقيق", v: [true, false, false, "عرض", "عرض"] },
  { label: "المستخدمون، الإعدادات، التعاميم وإيقاف الحسابات", v: [true, false, false, false, false] },
];

const ROLE_TONE: Record<string, "purple" | "blue" | "gray" | "orange" | "green"> = { ADMIN: "purple", ACCOUNTANT: "blue", PM: "gray", CHAIRMAN: "orange", AUDITOR: "green" };
const stamp = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Amman", dateStyle: "short", timeStyle: "short" });

export default async function UsersPage() {
  const me = await requireUser(can.manageUsers);
  const users = await db.user.findMany({ orderBy: [{ active: "desc" }, { role: "asc" }, { name: "asc" }], include: { _count: { select: { managedTenders: true } } } });
  const delegations = await db.delegation.findMany({ orderBy: { createdAt: "desc" }, take: 30 });
  return (
    <>
      <PageHeader
        title="المستخدمون والصلاحيات"
        actions={
          <ModalForm title="مستخدم جديد" trigger={<><Plus className="h-4 w-4" /> مستخدم جديد</>} action={saveUser.bind(null, null)}>
            <UserFields />
          </ModalForm>
        }
      />
      {users.some((u) => u.active && !u.email) && (
        <p className="mb-5 rounded-2xl border border-warn/40 bg-warn-soft px-4 py-3 text-sm font-semibold text-warn" role="status">
          لا يصل البريد إلى: {users.filter((u) => u.active && !u.email).map((u) => u.name).join("، ")} — لا يوجد بريد مسجل. تصلهم التنبيهات داخل النظام فقط (مع إشعار الجهاز عند فتح النظام). أضف بريد كل مستخدم من «تعديل».
        </p>
      )}
      <Card pad={false} className="mb-5">
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>المستخدم</th>
                <th>الدور</th>
                <th>المشاريع المسندة</th>
                <th>تاريخ الإنشاء</th>
                <th>الحالة</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>
                    <span className="block font-bold">{u.name}</span>
                    <span className="text-xs text-ink-muted" dir="ltr">@{u.username}</span>
                    {u.title && <span className="block text-xs text-ink-muted">{u.title}</span>}
                    {u.email && <span className="block text-xs text-ink-muted" dir="ltr">✉ {u.email}{u.notifyEmail ? "" : " (التنبيهات موقوفة)"}</span>}
                  </td>
                  <td><Badge tone={ROLE_TONE[u.role] ?? "gray"}>{ROLE_LABELS[u.role] ?? u.role}</Badge></td>
                  <td className="num">{u._count.managedTenders}</td>
                  <td className="num">{fmtDate(u.createdAt)}</td>
                  <td>
                    {u.active ? <Badge tone="green">✓ فعّال</Badge> : <Badge tone="red">موقوف</Badge>}
                    {!u.active && u.suspendReason && <span className="mt-1 block max-w-[220px] truncate text-[11px] text-bad" title={u.suspendReason}>{u.suspendReason}</span>}
                    {u.notice && (
                      <span className="mt-1 block text-[11px] font-semibold">
                        {u.noticeAckAt ? <span className="text-good">✓ اطّلع على التعميم {stamp.format(u.noticeAckAt)}</span> : <span className="text-warn">⏳ تعميم بانتظار الاطلاع</span>}
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap">
                    <ModalForm title="تعديل المستخدم" trigger={<Pencil className="h-4 w-4" />} triggerClass="btn-ghost btn-sm" action={saveUser.bind(null, u.id)}>
                      <UserFields u={u} />
                    </ModalForm>
                    <ModalForm title={`تعميم إلزامي — ${u.name}`} trigger={<><Megaphone className="h-4 w-4" /> تعميم</>} triggerClass="btn-ghost btn-sm" action={setUserNotice.bind(null, u.id)} submitLabel="حفظ التعميم">
                      <p className="rounded-xl bg-accent-soft p-3 text-sm text-ink-soft">يظهر للمستخدم فور دخوله في نافذة لا تُغلق حتى يضغط «اطّلعت». حفظ نص جديد يعيد إظهاره حتى لو اطّلع سابقاً. اترك الحقل فارغاً لإلغاء التعميم.</p>
                      <Textarea name="notice" label="نص التعميم" rows={6} defaultValue={u.notice ?? ""} />
                    </ModalForm>
                    {u.id !== me.id &&
                      (u.active ? (
                        <ModalForm title={`إيقاف حساب ${u.name}`} trigger={<><Ban className="h-4 w-4" /> إيقاف</>} triggerClass="btn-danger btn-sm" action={suspendUser.bind(null, u.id)} submitLabel="إيقاف الحساب">
                          <p className="rounded-xl bg-bad-soft p-3 text-sm text-ink-soft">يُمنع الدخول فوراً وتنتهي جلساته المفتوحة. تظهر الرسالة أدناه للمستخدم عند محاولة الدخول بكلمة مرور صحيحة.</p>
                          <Textarea name="reason" label="رسالة الإيقاف للمستخدم (اختياري)" rows={4} placeholder="الرجاء مراجعة إدارة الشركة" />
                        </ModalForm>
                      ) : (
                        <ConfirmButton action={toggleUserActive.bind(null, u.id)} confirm="إعادة تفعيل المستخدم؟" className="btn-ghost btn-sm">
                          تفعيل
                        </ConfirmButton>
                      ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Delegations users={users} rows={delegations} />
      <Card title={<span className="flex items-center gap-2"><Users className="h-5 w-5" /> مصفوفة الصلاحيات</span>}>
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>الصلاحية</th>
                <th>المدير العام</th>
                <th>المحاسب</th>
                <th>مدير المشروع</th>
                <th>المشرف الأعلى</th>
                <th>المراقب والمدقق</th>
              </tr>
            </thead>
            <tbody>
              {PERMS.map((p) => (
                <tr key={p.label}>
                  <td className="font-semibold">{p.label}</td>
                  {p.v.map((v, i) => (
                    <td key={i}>{v === true ? <Badge tone="green">✓ كامل</Badge> : v === false ? <Badge>✕ لا</Badge> : <Badge tone="blue">{v}</Badge>}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

import { FolderArchive, Pencil, Plus, Trash2 } from "lucide-react";
import type { CompanyDocument } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { DOCUMENT_TYPE } from "@/lib/labels";
import { daysUntil, fmtDate, toInputDate } from "@/lib/format";
import { attachmentsMap } from "@/lib/uploads";
import { AttachmentList, Card, EmptyState, ExpiryBadge, PageHeader, StatCard } from "@/components/ui";
import { ConfirmButton, FileInput, Grid, Input, ModalForm, Select, Textarea } from "@/components/forms";
import { UploadButton } from "@/components/tables";
import { deleteDocument, saveDocument } from "../actions/admin";

export const metadata = { title: "أوراق الشركة الرسمية" };

function DocFields({ d }: { d?: CompanyDocument }) {
  return (
    <>
      <Grid>
        <Select name="type" label="نوع الوثيقة" options={DOCUMENT_TYPE} defaultValue={d?.type ?? "CLASSIFICATION"} />
        <Input name="title" label="اسم الوثيقة" required defaultValue={d?.title} placeholder="شهادة التصنيف - رابعة أبنية" />
      </Grid>
      <Grid>
        <Input name="number" label="الرقم" defaultValue={d?.number ?? ""} />
        <Input name="issuer" label="جهة الإصدار" defaultValue={d?.issuer ?? ""} placeholder="وزارة الأشغال العامة والإسكان" />
      </Grid>
      <Grid>
        <Input name="issueDate" label="تاريخ الإصدار" type="date" defaultValue={toInputDate(d?.issueDate)} />
        <Input name="expiryDate" label="تاريخ الانتهاء" type="date" defaultValue={toInputDate(d?.expiryDate)} />
      </Grid>
      <Textarea name="notes" label="ملاحظات" defaultValue={d?.notes ?? ""} />
      <FileInput label="نسخة الوثيقة" />
    </>
  );
}

export default async function DocumentsPage() {
  const user = await requireUser(can.viewAll);
  const admin = can.manageDocuments(user.role);
  const docs = await db.companyDocument.findMany({ orderBy: [{ expiryDate: "asc" }] });
  const atts = await attachmentsMap("document", docs.map((d) => d.id));
  const expired = docs.filter((d) => d.expiryDate && daysUntil(d.expiryDate) < 0).length;
  const soon = docs.filter((d) => d.expiryDate && daysUntil(d.expiryDate) >= 0 && daysUntil(d.expiryDate) <= 45).length;

  return (
    <>
      <PageHeader
        title="أوراق الشركة الرسمية"
        subtitle="شهادة التصنيف والسجل التجاري ورخصة المهن والتأمينات — مع تنبيه قبل الانتهاء بـ 45 يوماً"
        actions={
          admin && (
            <ModalForm title="وثيقة جديدة" trigger={<><Plus className="h-4 w-4" /> وثيقة جديدة</>} action={saveDocument.bind(null, null)}>
              <DocFields />
            </ModalForm>
          )
        }
      />
      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="إجمالي الوثائق" value={docs.length} icon={FolderArchive} />
        <StatCard label="تنتهي خلال 45 يوماً" value={soon} tone={soon ? "orange" : "gray"} />
        <StatCard label="منتهية — تحتاج تجديد" value={expired} tone={expired ? "red" : "gray"} />
      </div>
      {docs.length === 0 ? (
        <Card>
          <EmptyState icon={FolderArchive} title="لا توجد وثائق" />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {docs.map((d) => (
            <Card key={d.id} className="flex flex-col">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-ink-muted">{DOCUMENT_TYPE[d.type] ?? d.type}</p>
                  <h3 className="mt-0.5 font-bold">{d.title}</h3>
                </div>
                <ExpiryBadge date={d.expiryDate} warnDays={45} />
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                <div><dt className="text-xs text-ink-muted">الرقم</dt><dd className="num font-semibold">{d.number ?? "—"}</dd></div>
                <div><dt className="text-xs text-ink-muted">الانتهاء</dt><dd className="num font-semibold">{fmtDate(d.expiryDate)}</dd></div>
                <div className="col-span-2"><dt className="text-xs text-ink-muted">جهة الإصدار</dt><dd className="font-semibold">{d.issuer ?? "—"}</dd></div>
              </dl>
              {d.notes && <p className="mt-2 text-xs text-ink-muted">{d.notes}</p>}
              <div className="mt-3">
                <AttachmentList items={atts.get(d.id)} />
              </div>
              {admin && (
                <div className="mt-auto flex items-center gap-1 border-t border-line pt-3">
                  <ModalForm title="تعديل / تجديد الوثيقة" trigger={<><Pencil className="h-4 w-4" /> تعديل / تجديد</>} triggerClass="btn-ghost btn-sm" action={saveDocument.bind(null, d.id)}>
                    <DocFields d={d} />
                  </ModalForm>
                  <UploadButton entityType="document" entityId={d.id} />
                  <ConfirmButton action={deleteDocument.bind(null, d.id)} confirm="حذف الوثيقة؟" className="btn-danger btn-sm ms-auto" title="حذف">
                    <Trash2 className="h-4 w-4" />
                  </ConfirmButton>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

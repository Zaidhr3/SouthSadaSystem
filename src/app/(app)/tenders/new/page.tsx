import Link from "next/link";
import clsx from "clsx";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { Card, PageHeader } from "@/components/ui";
import { ActionForm } from "@/components/forms";
import { createTender } from "../../actions/tenders";
import { StageFields, TenderFields, type ClientPrefill } from "../tender-fields";
import { tempPassword } from "@/lib/portal";
import type { Tender } from "@prisma/client";

export const metadata = { title: "عطاء جديد" };

export default async function NewTenderPage({ searchParams }: { searchParams: { kind?: string; quote?: string } }) {
  await requireUser(can.manageTenders);
  // من طلب عرض سعر معتمد (الموقع): مشروع خاص معبأ ببيانات الطلب وصاحبه
  const quote = Number(searchParams.quote) ? await db.quoteRequest.findUnique({ where: { id: Number(searchParams.quote) } }) : null;
  const kind = quote || searchParams.kind === "PRIVATE" ? "PRIVATE" : "GOV";
  const managers = await db.user.findMany({ where: { active: true, role: { in: ["PM", "ADMIN"] } }, orderBy: { name: "asc" } });
  const prefill: Partial<Tender> | undefined = quote
    ? {
        kind: "PRIVATE",
        name: `${quote.projectType}${quote.city ? ` — ${quote.city}` : ""} — ${quote.name}`.slice(0, 200),
        number: quote.ref,
        entity: quote.name,
        location: quote.city,
        classification: quote.projectType,
        managerId: quote.assignedPmId,
        notes: `من طلب الموقع ${quote.ref}${quote.area ? `
المساحة التقريبية: ${quote.area} م²` : ""}
${quote.details}${quote.pmPrice ? `

سعر مدير المشروع: ${quote.pmPrice}` : ""}${quote.pmNotes ? `
دراسة مدير المشروع:
${quote.pmNotes}` : ""}`,
      }
    : undefined;
  const client: ClientPrefill | undefined = kind === "PRIVATE" ? { name: quote?.name, email: quote?.email, phone: quote?.phone, quoteId: quote?.id, password: tempPassword() } : undefined;
  return (
    <>
      <PageHeader title={quote ? `مشروع خاص من الطلب ${quote.ref}` : "تسجيل عطاء أو مشروع"} subtitle={quote ? "بيانات الطلب معبأة — راجعها، حدد المرحلة، وأنشئ حساب صاحب المشروع ليتابع مشروعه من البوابة" : "عطاء جديد، أو إدخال مشروع سابق مباشرة في مرحلته الحالية"} back={quote ? { href: `/quotes/${quote.id}`, label: `الطلب ${quote.ref}` } : { href: "/tenders", label: "العطاءات" }} />
      <nav className="mb-4 flex max-w-3xl gap-1 rounded-2xl bg-black/[0.04] p-1">
        {([["GOV", "عطاء حكومي"], ["PRIVATE", "مشروع خاص (مالك / شركة)"]] as const).map(([k, label]) => (
          <Link key={k} href={`/tenders/new?kind=${k}`} className={clsx("flex-1 rounded-xl px-3 py-2 text-center text-sm font-bold transition", kind === k ? "bg-white text-accent shadow-card" : "text-ink-muted hover:text-ink")}>
            {label}
          </Link>
        ))}
      </nav>
      <Card className="max-w-3xl">
        <ActionForm action={createTender} submitLabel={kind === "PRIVATE" ? "حفظ المشروع" : "حفظ العطاء"}>
          <StageFields />
          <TenderFields managers={managers} withFiles kind={kind} t={prefill} client={client} />
        </ActionForm>
      </Card>
    </>
  );
}

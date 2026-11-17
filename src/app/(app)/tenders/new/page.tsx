import Link from "next/link";
import clsx from "clsx";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { Card, PageHeader } from "@/components/ui";
import { ActionForm } from "@/components/forms";
import { createTender } from "../../actions/tenders";
import { StageFields, TenderFields } from "../tender-fields";

export const metadata = { title: "عطاء جديد" };

export default async function NewTenderPage({ searchParams }: { searchParams: { kind?: string } }) {
  const kind = searchParams.kind === "PRIVATE" ? "PRIVATE" : "GOV";
  await requireUser(can.manageTenders);
  const managers = await db.user.findMany({ where: { active: true, role: { in: ["PM", "ADMIN"] } }, orderBy: { name: "asc" } });
  return (
    <>
      <PageHeader title="تسجيل عطاء أو مشروع" subtitle="عطاء جديد، أو إدخال مشروع سابق مباشرة في مرحلته الحالية" back={{ href: "/tenders", label: "العطاءات" }} />
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
          <TenderFields managers={managers} withFiles kind={kind} />
        </ActionForm>
      </Card>
    </>
  );
}

import { requireUser } from "@/lib/auth";
import { see } from "@/lib/permissions";
import { PageHeader } from "@/components/ui";
import { StudioClient } from "./studio-client";

export const metadata = { title: "استوديو الصور الذكي" };
export const dynamic = "force-dynamic";
/** التوليد قد يستغرق حتى دقيقة ونصف (محاولتان + فحص + تركيب) */
export const maxDuration = 300;

export default async function StudioPage() {
  await requireUser(see.marketing);
  return (
    <>
      <PageHeader
        back={{ href: "/marketing", label: "التسويق" }}
        eyebrow="الذكاء الاصطناعي · صدى الجنوب"
        title="استوديو الصور الذكي"
        subtitle="اكتب طلبك بكلمة أو جملة — يفهم النية، يبني خطة تصميم بطابع إنشائي فاخر، ويطلب إذنك قبل أي توليد."
      />
      <StudioClient />
    </>
  );
}

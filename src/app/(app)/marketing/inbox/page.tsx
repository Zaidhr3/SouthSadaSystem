import Link from "next/link";
import clsx from "clsx";
import { Facebook, Instagram, Lock, MessagesSquare } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { can, see } from "@/lib/permissions";
import { metaCan } from "@/lib/meta";
import { conversations, type Conversation } from "@/lib/inbox";
import { Card, PageHeader } from "@/components/ui";
import { ConversationCard } from "./conversation";

export const metadata = { title: "صندوق الرسائل" };
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function InboxPage({ searchParams }: { searchParams: { p?: string } }) {
  const user = await requireUser(see.marketing);
  const manage = can.manageMarketing(user.role);
  const platform = searchParams.p === "instagram" ? "instagram" : "messenger";
  const [msgOn, igOn] = await Promise.all([metaCan("messenger"), metaCan("ig_dm")]);
  const enabled = platform === "messenger" ? msgOn : igOn;
  let list: Conversation[] = [];
  let error: string | null = null;
  if (enabled) {
    try {
      list = await conversations(platform);
    } catch (e) {
      error = e instanceof Error ? e.message : "تعذر جلب الرسائل";
    }
  }
  return (
    <>
      <PageHeader back={{ href: "/marketing", label: "التسويق" }} title="صندوق الرسائل" subtitle="رسائل ماسنجر وإنستغرام في مكان واحد — رد مباشر، اقتراح رد ذكي، وتحويل المحادثة الجادة إلى طلب تسعير" />
      <nav className="mb-4 flex gap-1 rounded-2xl bg-black/[0.04] p-1 text-sm font-bold">
        {([["messenger", "ماسنجر", Facebook, msgOn], ["instagram", "إنستغرام", Instagram, igOn]] as const).map(([k, l, I, on]) => (
          <Link key={k} href={`/marketing/inbox?p=${k}`} className={clsx("flex items-center gap-1.5 rounded-xl px-3 py-1.5", platform === k ? "bg-white text-accent shadow-card" : "text-ink-muted")}>
            <I className="h-4 w-4" /> {l} {!on && <Lock className="h-3.5 w-3.5" />}
          </Link>
        ))}
      </nav>
      {!enabled ? (
        <Card>
          <div className="py-8 text-center text-sm text-ink-muted">
            <Lock className="mx-auto mb-2 h-8 w-8 text-ink-faint" />
            <p className="font-bold text-ink">الميزة تنتظر الصلاحية <code dir="ltr">{platform === "messenger" ? "pages_messaging" : "instagram_manage_messages"}</code></p>
            <p className="mt-1">امنحها للتطبيق في developers.facebook.com، أعد إنشاء الرمز، ثم «تحديث الرمز» أو «اختبار الاتصال» من <Link href="/system#meta" className="font-bold text-accent">إعدادات النظام</Link> — تعمل فوراً.</p>
          </div>
        </Card>
      ) : error ? (
        <p className="rounded-xl bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>
      ) : !list.length ? (
        <Card><p className="py-8 text-center text-sm text-ink-muted"><MessagesSquare className="mx-auto mb-2 h-8 w-8" />لا محادثات بعد</p></Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {list.map((c) => <ConversationCard key={c.id} c={c} canReply={manage} />)}
        </div>
      )}
    </>
  );
}

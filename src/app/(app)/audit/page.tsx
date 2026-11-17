import Link from "next/link";
import type { Prisma } from "@prisma/client";
import clsx from "clsx";
import { ScrollText, X } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { ROLE_LABELS } from "@/lib/labels";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";

export const metadata = { title: "سجل الرقابة والتدقيق" };

type Tone = "green" | "blue" | "red" | "gray" | "purple" | "orange";
const ACTION: Record<string, { label: string; tone: Tone }> = {
  create: { label: "إنشاء", tone: "green" },
  createMany: { label: "إنشاء متعدد", tone: "green" },
  update: { label: "تعديل", tone: "blue" },
  updateMany: { label: "تعديل متعدد", tone: "blue" },
  upsert: { label: "حفظ", tone: "blue" },
  delete: { label: "حذف", tone: "red" },
  deleteMany: { label: "حذف متعدد", tone: "red" },
  login: { label: "تسجيل دخول", tone: "purple" },
  login_failed: { label: "دخول فاشل", tone: "red" },
  login_blocked: { label: "دخول حساب موقوف", tone: "red" },
  export: { label: "تصدير", tone: "gray" },
  workflow: { label: "سير العمل", tone: "orange" },
};

const MODEL: Record<string, string> = {
  Tender: "عطاء/مشروع", BoqItem: "بند كميات", Guarantee: "كفالة", Claim: "مطالبة", ClaimLine: "بند مطالبة", Expense: "مصروف", Cheque: "شيك", Loan: "دين خارجي", LoanInstallment: "قسط دين", LoanPayment: "سداد دين",
  BankTransaction: "حركة بنكية", FundRequest: "تمويل/عهدة", CompanyDocument: "وثيقة شركة", Attachment: "مرفق", User: "مستخدم",
  VariationOrder: "أمر تغيير", Subcontractor: "مقاول باطن", Subcontract: "اتفاقية باطن", SubcontractCertificate: "مستخلص باطن",
  MaterialReceipt: "توريد مواد", Equipment: "معدة", EquipmentLog: "تشغيل معدة", Correspondence: "مراسلة رسمية", Setting: "إعداد",
  Session: "جلسة", Report: "تقرير", Survey: "حصر فعلي", SurveyLine: "بند حصر", SiteDiary: "يومية موقع", TaxEntry: "قيد ضريبي",
  Message: "رسالة داخلية", FieldRequest: "طلب مواد/عهدة",
};

const PAGE = 100;
const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Amman", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });

/** وصف مختصر للجهاز والمتصفح من User-Agent */
function device(ua: string | null) {
  if (!ua) return "—";
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "متصفح آخر";
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Mac OS/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  const mobile = /Mobile|Android|iPhone/.test(ua) ? " — هاتف" : "";
  return `${browser}${os ? ` على ${os}` : ""}${mobile}`;
}

function parse(json: string | null): Record<string, unknown> | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : { value: v };
  } catch {
    return { raw: json };
  }
}

const show = (v: unknown) => (v === undefined ? "—" : v === null ? "null" : typeof v === "object" ? JSON.stringify(v) : String(v));

/** رابط السجل المتأثر (أو مشروعه) */
function recordHref(model: string, id: number | null, data: Record<string, unknown> | null) {
  const tenderId = typeof data?.tenderId === "number" ? data.tenderId : null;
  if (model === "Tender" && id) return `/tenders/${id}`;
  if (model === "Claim" && id) return `/claims/${id}`;
  if (model === "Message" && id) return `/messages/${id}`;
  if (model === "FieldRequest") return "/requests";
  if (model === "User") return "/users";
  if (model === "Cheque") return "/cheques";
  if (model === "Loan" && id) return `/debts/${id}`;
  if ((model === "LoanPayment" || model === "LoanInstallment") && typeof data?.loanId === "number") return `/debts/${data.loanId}`;
  if (model === "TaxEntry") return "/taxes";
  if (model === "BankTransaction") return "/bank";
  if (tenderId) return `/tenders/${tenderId}`;
  return null;
}

export default async function AuditPage({ searchParams }: { searchParams: { user?: string; model?: string; action?: string; page?: string; view?: string; request?: string } }) {
  await requireUser(can.viewAudit);
  const page = Math.max(1, Number(searchParams.page) || 1);
  const where: Prisma.AuditLogWhereInput = {
    ...(searchParams.user ? { userId: Number(searchParams.user) } : {}),
    ...(searchParams.model ? { model: searchParams.model } : {}),
    ...(searchParams.action ? { action: { startsWith: searchParams.action } } : {}),
    ...(searchParams.request ? { requestId: searchParams.request } : {}),
  };
  const [rows, total, users] = await Promise.all([
    db.auditLog.findMany({ where, orderBy: { id: "desc" }, skip: (page - 1) * PAGE, take: PAGE }),
    db.auditLog.count({ where }),
    db.user.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const params = (extra: Record<string, string | undefined>) =>
    new URLSearchParams(Object.entries({ ...searchParams, ...extra }).filter(([, v]) => v) as [string, string][]).toString();

  // ── تفاصيل القيد المختار ──
  const viewId = Number(searchParams.view) || 0;
  const entry = viewId ? await db.auditLog.findUnique({ where: { id: viewId } }) : null;
  const related = entry?.requestId ? await db.auditLog.findMany({ where: { requestId: entry.requestId, id: { not: entry.id } }, orderBy: { id: "asc" }, take: 100 }) : [];
  const before = parse(entry?.before ?? null);
  const after = parse(entry?.after ?? null);
  const keys = Array.from(new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]));
  const changed = (k: string) => show(before?.[k]) !== show(after?.[k]);
  const href = entry ? recordHref(entry.model, entry.recordId, after ?? before) : null;
  const closeHref = `/audit?${params({ view: undefined })}`;

  return (
    <>
      <PageHeader title="سجل الرقابة والتدقيق" subtitle="كل عملية تُسجل تلقائياً بالحالة قبلها وبعدها، مع المستخدم والدور وعنوان IP والجهاز — اضغط أي قيد لعرض كل تفاصيله. للمدير العام والمشرف الأعلى والمراقب (اطلاع فقط)." />
      <form className="card mb-4 grid gap-3 p-4 sm:grid-cols-4">
        <select name="user" defaultValue={searchParams.user ?? ""} className="input">
          <option value="">كل المستخدمين</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <select name="model" defaultValue={searchParams.model ?? ""} className="input">
          <option value="">كل الوحدات</option>
          {Object.entries(MODEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select name="action" defaultValue={searchParams.action ?? ""} className="input">
          <option value="">كل العمليات</option>
          {Object.entries(ACTION).filter(([k]) => !k.endsWith("Many")).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <div className="flex gap-2">
          <button className="btn-primary flex-1">تصفية</button>
          <Link href="/audit" className="btn-secondary">مسح</Link>
        </div>
      </form>
      {searchParams.request && (
        <p className="mb-3 text-sm">عرض عمليات طلب واحد — <Link href="/audit" className="font-semibold text-accent">عرض الكل</Link></p>
      )}

      <Card pad={false}>
        {rows.length === 0 ? (
          <EmptyState icon={ScrollText} title="لا توجد قيود" />
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>الوقت</th>
                  <th>المستخدم</th>
                  <th>العملية</th>
                  <th>الوحدة</th>
                  <th>الجهاز / IP</th>
                  <th>التفاصيل</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const a = ACTION[r.action] ?? { label: r.action, tone: "gray" as Tone };
                  const link = `/audit?${params({ view: String(r.id) })}`;
                  return (
                    <tr key={r.id} className={clsx("cursor-pointer", viewId === r.id && "bg-accent-soft/50")}>
                      <td className="num whitespace-nowrap text-xs"><Link href={link} scroll={false} className="block">{time.format(r.createdAt)}</Link></td>
                      <td className="whitespace-nowrap">
                        <Link href={link} scroll={false} className="block font-semibold">{r.userName ?? "النظام"}</Link>
                        {r.userRole && <span className="text-[11px] text-ink-muted">{ROLE_LABELS[r.userRole] ?? r.userRole}</span>}
                      </td>
                      <td><Link href={link} scroll={false}><Badge tone={a.tone}>{a.label}</Badge></Link></td>
                      <td className="whitespace-nowrap"><Link href={link} scroll={false}>{MODEL[r.model] ?? r.model}{r.recordId ? <span className="num text-ink-muted"> #{r.recordId}</span> : null}</Link></td>
                      <td className="whitespace-nowrap text-[11px] text-ink-muted"><Link href={link} scroll={false} className="block">{device(r.userAgent)}<span className="num block" dir="ltr">{r.ip ?? "—"}</span></Link></td>
                      <td className="max-w-[420px]"><Link href={link} scroll={false} className="block truncate text-[12px] text-ink-soft hover:text-accent" title="اضغط لعرض كل التفاصيل">{r.summary}</Link></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <div className="mt-4 flex items-center justify-between text-sm text-ink-muted">
        <span>{total} قيداً</span>
        <span className="flex gap-2">
          {page > 1 && <Link href={`/audit?${params({ page: String(page - 1), view: undefined })}`} className="btn-secondary btn-sm">السابق</Link>}
          {page * PAGE < total && <Link href={`/audit?${params({ page: String(page + 1), view: undefined })}`} className="btn-secondary btn-sm">التالي</Link>}
        </span>
      </div>

      {/* ── لوحة التفاصيل الكاملة ── */}
      {entry && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={`تفاصيل القيد ${entry.id}`}>
          <Link href={closeHref} scroll={false} className="absolute inset-0 animate-fade-in bg-black/30" aria-label="إغلاق" />
          <aside className="absolute inset-y-0 start-0 flex w-full max-w-3xl animate-slide-in flex-col bg-white shadow-pop">
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <h2 className="text-lg font-bold">
                تفاصيل القيد <span className="num">#{entry.id}</span> — {(ACTION[entry.action] ?? { label: entry.action }).label} {MODEL[entry.model] ?? entry.model}
              </h2>
              <Link href={closeHref} scroll={false} className="grid h-8 w-8 place-items-center rounded-full bg-canvas" aria-label="إغلاق"><X className="h-4 w-4" /></Link>
            </div>
            <div className="flex-1 space-y-5 overflow-y-auto p-5">
              <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                {[
                  ["الوقت (عمّان)", time.format(entry.createdAt)],
                  ["الوقت (UTC)", entry.createdAt.toISOString()],
                  ["المستخدم", entry.userName ?? "النظام"],
                  ["الدور", entry.userRole ? ROLE_LABELS[entry.userRole] ?? entry.userRole : "—"],
                  ["معرّف المستخدم", entry.userId ?? "—"],
                  ["عنوان IP", entry.ip ?? "—"],
                  ["الجهاز والمتصفح", device(entry.userAgent)],
                  ["نوع العملية", `${(ACTION[entry.action] ?? { label: entry.action }).label} (${entry.action})`],
                  ["الوحدة", `${MODEL[entry.model] ?? entry.model} (${entry.model})`],
                  ["رقم السجل", entry.recordId ?? "—"],
                  ["معرّف الطلب", entry.requestId ?? "—"],
                ].map(([k, v]) => (
                  <div key={String(k)}>
                    <dt className="text-xs font-semibold text-ink-muted">{k}</dt>
                    <dd className="num break-all font-semibold" style={{ direction: "rtl" }}>{String(v)}</dd>
                  </div>
                ))}
              </dl>
              {entry.userAgent && (
                <div>
                  <p className="text-xs font-semibold text-ink-muted">User-Agent الكامل</p>
                  <code dir="ltr" className="mt-1 block break-all rounded-lg bg-canvas p-2 text-[11px]">{entry.userAgent}</code>
                </div>
              )}
              {href && <Link href={href} className="btn-secondary btn-sm">فتح السجل المرتبط ←</Link>}

              <div>
                <p className="mb-1 text-sm font-bold">الوصف / البيانات المرسلة</p>
                <p className="whitespace-pre-wrap break-words rounded-xl bg-canvas p-3 text-sm">{entry.summary}</p>
              </div>

              {keys.length > 0 && (
                <div>
                  <p className="mb-2 text-sm font-bold">مقارنة الحقول (قبل ← بعد)</p>
                  <div className="overflow-x-auto rounded-xl border border-line">
                    <table className="w-full text-[12px]">
                      <thead className="bg-canvas">
                        <tr>
                          <th className="px-3 py-2 text-start font-semibold">الحقل</th>
                          <th className="px-3 py-2 text-start font-semibold">قبل</th>
                          <th className="px-3 py-2 text-start font-semibold">بعد</th>
                        </tr>
                      </thead>
                      <tbody>
                        {keys.map((k) => (
                          <tr key={k} className={clsx("border-t border-line", before && after && changed(k) && "bg-warn-soft/60 font-semibold")}>
                            <td className="px-3 py-1.5 font-mono" dir="ltr">{k}</td>
                            <td className="max-w-[260px] break-all px-3 py-1.5" dir="auto">{before ? show(before[k]) : "—"}</td>
                            <td className="max-w-[260px] break-all px-3 py-1.5" dir="auto">{after ? show(after[k]) : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {before && after && <p className="mt-1 text-[11px] text-ink-muted">الحقول المظللة تغيّرت في هذه العملية.</p>}
                </div>
              )}

              <details open={!keys.length}>
                <summary className="cursor-pointer text-sm font-bold">JSON الكامل</summary>
                <div className="mt-2 grid gap-3 lg:grid-cols-2">
                  <div>
                    <p className="mb-1 text-xs font-semibold text-ink-muted">قبل</p>
                    <pre dir="ltr" className="max-h-96 overflow-auto rounded-xl bg-ink p-3 text-[11px] text-white">{entry.before ?? "—"}</pre>
                  </div>
                  <div>
                    <p className="mb-1 text-xs font-semibold text-ink-muted">بعد</p>
                    <pre dir="ltr" className="max-h-96 overflow-auto rounded-xl bg-ink p-3 text-[11px] text-white">{entry.after ?? "—"}</pre>
                  </div>
                </div>
              </details>

              {related.length > 0 && (
                <div>
                  <p className="mb-2 text-sm font-bold">عمليات مرتبطة في نفس الطلب ({related.length})</p>
                  <ul className="divide-y divide-line rounded-xl border border-line text-[12px]">
                    {related.map((r) => (
                      <li key={r.id}>
                        <Link href={`/audit?${params({ view: String(r.id) })}`} scroll={false} className="flex items-center justify-between gap-3 px-3 py-2 hover:bg-canvas">
                          <span>
                            <Badge tone={(ACTION[r.action] ?? { tone: "gray" as Tone }).tone}>{(ACTION[r.action] ?? { label: r.action }).label}</Badge>{" "}
                            {MODEL[r.model] ?? r.model}{r.recordId ? ` #${r.recordId}` : ""}
                          </span>
                          <span className="truncate text-ink-muted">{r.summary.slice(0, 80)}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                  <Link href={`/audit?request=${entry.requestId}`} className="mt-2 inline-block text-xs font-semibold text-accent">عرض كل عمليات هذا الطلب في الجدول</Link>
                </div>
              )}
            </div>
          </aside>
        </div>
      )}
    </>
  );
}

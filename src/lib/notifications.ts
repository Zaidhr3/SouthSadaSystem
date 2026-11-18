import "server-only";
import * as React from "react";
import { db } from "./db";
import { addDays, daysUntil, fmtDate, fmtJOD, relativeDays, todayUTC } from "./format";
import { DOCUMENT_TYPE, GUARANTEE_TYPE, PRE_AWARD_STATUSES } from "./labels";
import { tenderScope, type AppUser } from "./permissions";
import { claimNet, heldRetention } from "./deductions";
import { projectCashFlow } from "./cashflow";
import { maintenanceEnd } from "./project-phase";

/** تخزين لكل طلب داخل Next — وخارجه (السكربتات) استدعاء مباشر بلا تخزين */
const cache: <T extends (...args: never[]) => unknown>(fn: T) => T = (React as { cache?: <T>(fn: T) => T }).cache ?? ((fn) => fn);

export type Severity = "critical" | "warning" | "info";
export type NotificationKind =
  | "cheque"
  | "deadline"
  | "site_visit"
  | "guarantee"
  | "document"
  | "fund"
  | "event"
  | "retention"
  | "variation"
  | "certificate"
  | "liquidity"
  | "collection"
  | "claim"
  | "tax"
  | "message"
  | "request"
  | "debt";

/** رقم الأسبوع (لتكرار تذكير السيولة أسبوعياً ما دامت المشكلة قائمة) */
function weekKey(d: Date) {
  const start = Date.UTC(d.getUTCFullYear(), 0, 1);
  return `${d.getUTCFullYear()}w${Math.floor((d.getTime() - start) / (7 * 86400000))}`;
}

export type AppNotification = {
  key: string;
  kind: NotificationKind;
  severity: Severity;
  title: string;
  body: string;
  date: string;
  href: string;
  dismissed: boolean;
};

function sev(days: number, warnWithin: number): Severity {
  if (days <= 0) return "critical";
  if (days <= warnWithin) return "warning";
  return "info";
}

/**
 * محرك التنبيهات: يُحسب لحظياً من التواريخ الفعلية فلا يفوت أي استحقاق.
 * - الشيكات: قبل 3 أيام وفي يوم الاستحقاق (والمتأخرة)
 * - آخر موعد لتقديم العطاءات وزيارات المواقع
 * - انتهاء الكفالات (دخول، حسن تنفيذ، صيانة) واسترداد كفالة الصيانة
 * - انتهاء أوراق الشركة الرسمية
 * - طلبات التمويل المعلقة (للمدير العام)
 */
export async function computeNotifications(user: AppUser, opts: { includeDismissed?: boolean } = {}) {
  const today = todayUTC();
  const items: Omit<AppNotification, "dismissed">[] = [];
  const isPM = user.role === "PM";

  // كل الأقسام مستقلة: تُنفذ استعلاماتها بالتوازي بدل التتابع (≈20 رحلة لقاعدة البيانات لكل صفحة) — الترتيب يُحسم بالفرز في النهاية
  const tasks: Promise<void>[] = [];
  const task = (fn: () => Promise<void>) => void tasks.push(fn());

  // 1) الشيكات المؤجلة
  task(async () => {
    if (!isPM) {
      const cheques = await db.cheque.findMany({
        where: { status: "DEFERRED", dueDate: { lte: addDays(today, 3) } },
        orderBy: { dueDate: "asc" },
      });
      for (const c of cheques) {
        const d = daysUntil(c.dueDate);
        const stage = d < 0 ? "overdue" : d === 0 ? "today" : "soon";
        items.push({
          key: `cheque:${c.id}:${stage}`,
          kind: "cheque",
          severity: d <= 0 ? "critical" : "warning",
          title: d < 0 ? `شيك متأخر رقم ${c.number}` : d === 0 ? `يستحق اليوم: شيك رقم ${c.number}` : `شيك يستحق ${relativeDays(c.dueDate)}`,
          body: `${c.payee} — ${fmtJOD(c.amount)} — ${c.bank} — الاستحقاق ${fmtDate(c.dueDate)}`,
          date: c.dueDate.toISOString(),
          href: "/cheques",
        });
      }
    }
  });

  // 1-ب) أقساط الديون الخارجية: قبل 7 أيام، قبل 3 أيام، يوم الاستحقاق، ومتأخرة
  task(async () => {
    if (!isPM) {
      const due = await db.loanInstallment.findMany({
        where: { dueDate: { lte: addDays(today, 7) }, loan: { status: "ACTIVE" } },
        include: { loan: { select: { id: true, lender: true, purpose: true } } },
        orderBy: { dueDate: "asc" },
      });
      for (const i of due) {
        const left = Math.round((i.amount - i.paidAmount) * 1000) / 1000;
        if (left <= 0) continue;
        const d = daysUntil(i.dueDate);
        const stage = d < 0 ? "overdue" : d === 0 ? "today" : d <= 3 ? "soon" : "week";
        items.push({
          key: `debt:${i.id}:${stage}`,
          kind: "debt",
          severity: d <= 0 ? "critical" : d <= 3 ? "warning" : "info",
          title: d < 0 ? `قسط دين متأخر — ${i.loan.lender}` : d === 0 ? `يستحق اليوم: قسط دين ${i.loan.lender}` : `قسط دين يستحق ${relativeDays(i.dueDate)}`,
          body: `${i.loan.lender} — القسط ${i.seq} — ${fmtJOD(left)} — الاستحقاق ${fmtDate(i.dueDate)}`,
          date: i.dueDate.toISOString(),
          href: `/debts/${i.loan.id}`,
        });
      }
    }
  });

  // 2) مواعيد تقديم العطاءات وزيارات المواقع
  task(async () => {
    const tenders = await db.tender.findMany({
      where: {
        ...tenderScope(user),
        status: { in: PRE_AWARD_STATUSES.filter((s) => s !== "NEGOTIATION") },
        OR: [
          { deadline: { gte: addDays(today, -1), lte: addDays(today, 7) } },
          { siteVisitDate: { gte: today, lte: addDays(today, 3) } },
        ],
      },
    });
    for (const t of tenders) {
      const dd = daysUntil(t.deadline);
      if (dd >= -1 && dd <= 7 && t.status !== "SUBMITTED") {
        items.push({
          key: `deadline:${t.id}:${dd <= 0 ? "due" : dd <= 3 ? "soon" : "week"}`,
          kind: "deadline",
          severity: sev(dd, 3),
          title: dd < 0 ? `فات موعد تقديم عطاء ${t.number}` : `آخر موعد لتقديم العطاء ${relativeDays(t.deadline)}`,
          body: `${t.name} — ${t.entity} — ${fmtDate(t.deadline)}`,
          date: t.deadline.toISOString(),
          href: `/tenders/${t.id}`,
        });
      }
      if (t.siteVisitDate) {
        const sd = daysUntil(t.siteVisitDate);
        if (sd >= 0 && sd <= 3) {
          items.push({
            key: `visit:${t.id}:${sd === 0 ? "today" : "soon"}`,
            kind: "site_visit",
            severity: sd === 0 ? "warning" : "info",
            title: `زيارة موقع ${relativeDays(t.siteVisitDate)}`,
            body: `${t.name} — ${t.entity} — ${fmtDate(t.siteVisitDate)}`,
            date: t.siteVisitDate.toISOString(),
            href: `/tenders/${t.id}`,
          });
        }
      }
    }
  });

  // 3) الكفالات
  task(async () => {
    const guarantees = await db.guarantee.findMany({
      where: {
        status: { in: ["ISSUED", "SUBMITTED"] },
        expiryDate: { not: null, lte: addDays(today, 30) },
        tender: tenderScope(user),
      },
      include: { tender: { select: { id: true, name: true, number: true } } },
    });
    for (const g of guarantees) {
      const d = daysUntil(g.expiryDate!);
      const isMaint = g.type === "MAINTENANCE";
      items.push({
        key: `guarantee:${g.id}:${d <= 0 ? "expired" : d <= 7 ? "week" : "month"}`,
        kind: "guarantee",
        severity: sev(d, 7),
        title:
          d <= 0
            ? isMaint
              ? `انتهت فترة الصيانة — استرد كفالة الصيانة من البنك`
              : `انتهت صلاحية ${GUARANTEE_TYPE[g.type]}`
            : `${GUARANTEE_TYPE[g.type]} تنتهي ${relativeDays(g.expiryDate!)}`,
        body: `${g.tender.name} (${g.tender.number}) — ${fmtJOD(g.amount)} — ${g.bank}`,
        date: g.expiryDate!.toISOString(),
        href: `/tenders/${g.tender.id}?tab=guarantees`,
      });
    }
  });

  // 4) أوراق الشركة الرسمية
  task(async () => {
    if (!isPM) {
      const docs = await db.companyDocument.findMany({
        where: { expiryDate: { not: null, lte: addDays(today, 45) } },
      });
      for (const doc of docs) {
        const d = daysUntil(doc.expiryDate!);
        items.push({
          key: `document:${doc.id}:${doc.expiryDate!.toISOString().slice(0, 10)}:${d <= 0 ? "expired" : d <= 14 ? "soon" : "month"}`,
          kind: "document",
          severity: sev(d, 14),
          title: d <= 0 ? `منتهية: ${doc.title}` : `${doc.title} تنتهي ${relativeDays(doc.expiryDate!)}`,
          body: `${DOCUMENT_TYPE[doc.type] ?? doc.type} — تاريخ الانتهاء ${fmtDate(doc.expiryDate)}`,
          date: doc.expiryDate!.toISOString(),
          href: "/documents",
        });
      }
    }
  });

  // 5) طلبات التمويل المعلقة
  task(async () => {
    if (user.role === "ADMIN") {
      const pending = await db.fundRequest.findMany({
        where: { status: "PENDING" },
        include: { requester: { select: { name: true } } },
      });
      for (const f of pending) {
        items.push({
          key: `fund:${f.id}`,
          kind: "fund",
          severity: "warning",
          title: `طلب تمويل من ${f.requester.name}`,
          body: `${fmtJOD(f.amount)} — ${f.reason}`,
          date: f.createdAt.toISOString(),
          href: "/funds",
        });
      }
    }
  });

  // 6) استرداد المحجوزات (بالتزامن مع انتهاء كفالة الصيانة)
  task(async () => {
    if (!isPM) {
      const maint = await db.guarantee.findMany({
        where: { type: "MAINTENANCE", expiryDate: { not: null, lte: addDays(today, 14) }, tender: { retentionReleasedDate: null } },
        include: { tender: { select: { id: true, name: true, claims: { select: { retention: true, status: true } } } } },
      });
      for (const g of maint) {
        const held = heldRetention(g.tender.claims);
        if (held <= 0) continue;
        const d = daysUntil(g.expiryDate!);
        items.push({
          key: `retention:${g.tender.id}:${d <= 0 ? "due" : "soon"}`,
          kind: "retention",
          severity: d <= 0 ? "critical" : "warning",
          title: d <= 0 ? "حان موعد استرداد المحجوزات" : `استرداد المحجوزات ${relativeDays(g.expiryDate!)}`,
          body: `${g.tender.name} — محجوزات بقيمة ${fmtJOD(held)} — مع انتهاء كفالة الصيانة ${fmtDate(g.expiryDate)}`,
          date: g.expiryDate!.toISOString(),
          href: `/tenders/${g.tender.id}?tab=claims`,
        });
      }
    }
  });

  // 6ب) مراحل الاستلام: إنجاز 100% بلا لجنة استلام ابتدائي، وانقضاء مدة الصيانة بلا لجنة استلام نهائي
  task(async () => {
    const handover = await db.tender.findMany({
      where: {
        ...tenderScope(user),
        OR: [
          { status: { in: ["WON", "EXECUTION"] }, progress: { gte: 100 }, prelimInspectionDate: null },
          { status: "MAINTENANCE", preliminaryHandoverDate: { not: null }, finalInspectionDate: null },
        ],
      },
      select: { id: true, name: true, status: true, preliminaryHandoverDate: true, maintenanceMonths: true, guarantees: { select: { type: true, status: true, expiryDate: true } } },
    });
    for (const t of handover) {
      if (t.status !== "MAINTENANCE") {
        items.push({
          key: `handover:prelim:${t.id}`,
          kind: "deadline",
          severity: "warning",
          title: "الأعمال منجزة 100% — اطلب لجنة الاستلام الابتدائي",
          body: `${t.name} — سجّل كشف اللجنة والنواقص ثم محضر الاستلام الابتدائي`,
          date: today.toISOString(),
          href: `/tenders/${t.id}`,
        });
        continue;
      }
      const end = maintenanceEnd(t);
      if (!end || end > addDays(today, 30)) continue;
      const d = daysUntil(end);
      items.push({
        key: `handover:final:${t.id}:${d <= 0 ? "due" : "soon"}`,
        kind: "deadline",
        severity: d <= 0 ? "critical" : "warning",
        title: d <= 0 ? "انقضت مدة الصيانة — اطلب لجنة الاستلام النهائي" : `تنتهي مدة الصيانة ${relativeDays(end)}`,
        body: `${t.name} — بعد الكشف: محضر الاستلام النهائي ثم قرار الإفراج عن كفالة الصيانة وإغلاق المشروع`,
        date: end.toISOString(),
        href: `/tenders/${t.id}`,
      });
    }
  });

  // 7) أوامر التغيير بانتظار الاعتماد (المدير العام)
  task(async () => {
    if (user.role === "ADMIN") {
      const vos = await db.variationOrder.findMany({ where: { status: "PENDING" }, include: { tender: { select: { id: true, name: true } } } });
      for (const v of vos) {
        items.push({
          key: `vo:${v.id}`,
          kind: "variation",
          severity: "warning",
          title: `أمر تغيير رقم ${v.number} بانتظار الاعتماد`,
          body: `${v.tender.name} — ${v.title} — ${fmtJOD(v.amount)}`,
          date: v.requestDate.toISOString(),
          href: `/tenders/${v.tender.id}?tab=variations`,
        });
      }
    }
  });

  // 8) مستخلصات مقاولي الباطن: بانتظار الاعتماد (المدير) أو بانتظار الدفع (المحاسب)
  task(async () => {
    if (!isPM) {
      const status = user.role === "ADMIN" ? "SUBMITTED" : "APPROVED";
      const certs = await db.subcontractCertificate.findMany({
        where: { status },
        include: { subcontract: { include: { subcontractor: { select: { name: true } }, tender: { select: { id: true, name: true } } } } },
      });
      for (const c of certs) {
        items.push({
          key: `cert:${c.id}:${status}`,
          kind: "certificate",
          severity: "warning",
          title: status === "SUBMITTED" ? `مستخلص باطن بانتظار الاعتماد — ${c.subcontract.subcontractor.name}` : `مستخلص باطن معتمد بانتظار الدفع — ${c.subcontract.subcontractor.name}`,
          body: `${c.subcontract.tender.name} — صافي ${fmtJOD(c.net)}`,
          date: c.date.toISOString(),
          href: `/subcontractors?tender=${c.subcontract.tender.id}`,
        });
      }
    }
  });

  // 10) تحذير السيولة (المدير العام فقط — سري): أدنى رصيد متوقع خلال 30 يوماً
  task(async () => {
    if (user.role === "ADMIN") {
      const p = await projectCashFlow(30);
      const hasActivity = p.items.length > 0 || p.opening !== 0;
      if (hasActivity && p.minBalance < 0) {
        const level = p.opening <= 0 || addDays(today, 7) >= new Date(p.minDate) ? "critical" : "warning";
        items.push({
          key: `liquidity:${level}:${weekKey(today)}`,
          kind: "liquidity",
          severity: level,
          title: p.opening <= 0 ? "تحذير سيولة: رصيد الحساب البنكي سالب أو صفر" : `تحذير سيولة: عجز متوقع بتاريخ ${fmtDate(p.minDate)}`,
          body: `الرصيد الحالي ${fmtJOD(p.opening)} — أدنى رصيد متوقع خلال 30 يوماً ${fmtJOD(p.minBalance)} — صادر متوقع ${fmtJOD(p.totalOut)} مقابل وارد ${fmtJOD(p.totalIn)}`,
          date: today.toISOString(),
          href: "/cashflow",
        });
      }

      // مطالبات مرت ببوابة تدقيق المحاسب والبريد — بانتظار الاعتماد النهائي والقفل
      const drafts = await db.claim.findMany({ where: { status: { in: ["READY", "REVIEW"] } }, include: { tender: { select: { id: true, name: true } } } });
      for (const c of drafts) {
        items.push({
          key: `claim-review:${c.id}`,
          kind: "claim",
          severity: "warning",
          title: `المطالبة رقم ${c.number} مرفوعة من المحاسب — بانتظار موافقتك`,
          body: `${c.tender.name} — إجمالي ${fmtJOD(c.grossAmount)} — صافي ${fmtJOD(claimNet(c))}`,
          date: c.createdAt.toISOString(),
          href: `/claims/${c.id}`,
        });
      }
    }
  });

  // 10أ) المشرف الأعلى (أبو أحمد) يعتمد المطالبات مع المدير العام
  task(async () => {
    if (user.role === "CHAIRMAN") {
      const drafts = await db.claim.findMany({ where: { status: { in: ["READY", "REVIEW"] } }, include: { tender: { select: { id: true, name: true } } } });
      for (const c of drafts) {
        items.push({ key: `claim-review:${c.id}`, kind: "claim", severity: "warning", title: `المطالبة رقم ${c.number} بانتظار الموافقة النهائية`, body: `${c.tender.name} — صافي ${fmtJOD(claimNet(c))}`, date: c.createdAt.toISOString(), href: `/claims/${c.id}` });
      }
    }
  });

  // 10ج) دورة القبض والفاتورة الإلكترونية
  task(async () => {
    {
      const mgmt = user.role === "ADMIN" || user.role === "CHAIRMAN";
      const accountant = user.role === "ACCOUNTANT" || user.role === "ADMIN";
      const pay = await db.claim.findMany({
        where: {
          OR: [
            ...(accountant ? [{ payStage: "RECEIVED" }, { einvStatus: "FAILED" }] : []),
            ...(mgmt ? [{ payStage: "AUDITED" }] : []),
          ],
        },
        include: { tender: { select: { id: true, name: true } } },
      });
      for (const c of pay) {
        const failed = c.einvStatus === "FAILED" && c.payStage !== "RECEIVED" && c.payStage !== "AUDITED";
        items.push({
          key: `claim-pay:${c.id}:${failed ? "einv" : c.payStage}:${(c.receiptAuditedAt ?? c.receiptAt ?? c.createdAt).getTime()}`,
          kind: "claim",
          severity: failed ? "critical" : "warning",
          title: failed ? `فاتورة المطالبة رقم ${c.number} رفضها نظام الفوترة` : c.payStage === "RECEIVED" ? `قبض المطالبة رقم ${c.number} بانتظار تدقيقك` : `قبض المطالبة رقم ${c.number} بانتظار الموافقة والإيداع`,
          body: `${c.tender.name} — ${failed ? c.einvError ?? "" : fmtJOD(c.receiptAmount ?? 0)}`,
          date: (c.receiptAuditedAt ?? c.receiptAt ?? c.createdAt).toISOString(),
          href: `/claims/${c.id}`,
        });
      }
    }
  });

  // 10ب) دورة المطالبة: ما ينتظر كل دور
  task(async () => {
    {
      const flow = await db.claim.findMany({
        where: {
          tender: tenderScope(user),
          OR: [
            ...(user.role === "ACCOUNTANT" ? [{ status: "DRAFT" }] : []),
            ...(isPM || user.role === "ADMIN" ? [{ status: "RETURNED" }] : []),
            { status: { in: ["SUBMITTED", "APPROVED"] }, disbursementStage: "BLOCKED" },
          ],
        },
        include: { tender: { select: { id: true, name: true } } },
      });
      for (const c of flow) {
        const blocked = c.disbursementStage === "BLOCKED" && c.status !== "RETURNED" && c.status !== "DRAFT";
        items.push({
          key: `claim-flow:${c.id}:${blocked ? "blocked" : c.status}:${(c.disbursementUpdatedAt ?? c.returnedAt ?? c.createdAt).getTime()}`,
          kind: "claim",
          severity: blocked || c.status === "RETURNED" ? "critical" : "warning",
          title: blocked
            ? `معيق في صرف المطالبة رقم ${c.number}`
            : c.status === "RETURNED"
              ? `المطالبة رقم ${c.number} مرفوضة — ${isPM ? "عدّلها وأعد تقديمها" : "بانتظار تعديل مدير المشروع"}`
              : `مطالبة رقم ${c.number} بانتظار تدقيقك`,
          body: `${c.tender.name} — ${blocked ? c.disbursementNote ?? "" : c.status === "RETURNED" ? `السبب: ${c.returnReason ?? ""}` : `إجمالي ${fmtJOD(c.grossAmount)}`}`,
          date: (c.disbursementUpdatedAt ?? c.returnedAt ?? c.createdAt).toISOString(),
          href: c.status === "RETURNED" && !blocked ? `/claims/new?tender=${c.tender.id}&claim=${c.id}` : `/claims/${c.id}`,
        });
      }
    }
  });

  // 11) مطالبات غير مقبوضة لفترة طويلة (30 / 60 / 90 يوماً من التقديم)
  task(async () => {
    {
      const stale = await db.claim.findMany({
        where: { tender: tenderScope(user), status: { in: ["SUBMITTED", "APPROVED"] }, submittedDate: { lte: addDays(today, -30) } },
        include: { tender: { select: { id: true, name: true } } },
        orderBy: { submittedDate: "asc" },
      });
      for (const c of stale) {
        const age = -daysUntil(c.submittedDate);
        const bucket = age >= 90 ? 90 : age >= 60 ? 60 : 30;
        const net = claimNet(c);
        items.push({
          key: `collection:${c.id}:${bucket}`,
          kind: "collection",
          severity: bucket >= 60 ? "critical" : "warning",
          title: `مطالبة بانتظار الصرف منذ ${age} يوماً`,
          body: `${c.tender.name} — مطالبة رقم ${c.number} — صافي ${fmtJOD(net)} — قُدمت ${fmtDate(c.submittedDate)}`,
          date: c.submittedDate.toISOString(),
          href: `/claims/${c.id}`,
        });
      }
    }
  });

  // 13) الدورة المستندية: حصر مُرسل بانتظار المحاسب، وطلبات المواد والعهد
  task(async () => {
    if (!isPM) {
      if (user.role !== "ADMIN") {
        const surveys = await db.survey.findMany({ where: { status: "SUBMITTED" }, include: { tender: { select: { id: true, name: true } } } });
        for (const s of surveys) {
          items.push({
            key: `survey-submitted:${s.id}`,
            kind: "claim",
            severity: "warning",
            title: `حصر جاهز للتدقيق وإعداد المطالبة — ${s.tender.name}`,
            body: `الحصر رقم ${s.number} أرسله مدير المشروع${s.submittedAt ? ` بتاريخ ${fmtDate(s.submittedAt)}` : ""}`,
            date: (s.submittedAt ?? s.createdAt).toISOString(),
            href: `/claims/new?tender=${s.tender.id}`,
          });
        }
      }
      const reqStatus = user.role === "ADMIN" ? "PENDING_GM" : "PENDING_AUDIT";
      const reqs = await db.fieldRequest.findMany({ where: { status: reqStatus }, include: { tender: { select: { name: true } } } });
      for (const r of reqs) {
        items.push({
          key: `request:${r.id}:${reqStatus}`,
          kind: "request",
          severity: "warning",
          title: reqStatus === "PENDING_GM" ? `طلب ميداني بانتظار موافقتك — ${fmtJOD(r.approvedAmount ?? r.estimatedAmount)}` : `طلب ميداني بانتظار التدقيق — ${r.title}`,
          body: `${r.tender.name} — ${r.title} — ${fmtJOD(r.approvedAmount ?? r.estimatedAmount)}`,
          date: r.createdAt.toISOString(),
          href: `/requests?status=${reqStatus}`,
        });
      }
    }
  });

  // 12) تذكير شهري بمديونية الضريبة القائمة (المدير العام والمحاسب) — يُرسل بالبريد مرة كل شهر
  task(async () => {
    if (!isPM) {
      const rows = await db.taxEntry.groupBy({ by: ["kind"], _sum: { amount: true } });
      const outstanding = (rows.find((r) => r.kind === "LIABILITY")?._sum.amount ?? 0) - (rows.find((r) => r.kind === "PAYMENT")?._sum.amount ?? 0);
      if (outstanding > 0.0005) {
        const month = today.toISOString().slice(0, 7);
        items.push({
          key: `tax:${month}`,
          kind: "tax",
          severity: "warning",
          title: `تذكير شهري: مديونية ضريبة الدخل ${fmtJOD(outstanding)}`,
          body: "مستحقات ضريبية غير مسددة لدائرة ضريبة الدخل والمبيعات — راجع وحدة الضريبة وسجّل السداد",
          date: today.toISOString(),
          href: "/taxes",
        });
      }
    }
  });
  // 9) إشعارات الأحداث الموجهة (إسناد، تمويل، اعتماد...)
  const eventsQ = db.notificationEvent.findMany({
    where: { userId: user.id, ...(opts.includeDismissed ? { createdAt: { gte: addDays(today, -30) } } : { readAt: null }) },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  const dismissedQ = db.notificationDismissal.findMany({ where: { userId: user.id }, select: { key: true } });
  const [events, dismissedRows] = await Promise.all([eventsQ, dismissedQ, ...tasks]);
  const eventItems: AppNotification[] = events.map((e) => ({
    key: `event:${e.id}`,
    kind: "event",
    severity: "info",
    title: e.title,
    body: e.body,
    date: e.createdAt.toISOString(),
    href: e.href,
    dismissed: !!e.readAt,
  }));

  const dismissed = new Set(dismissedRows.map((d) => d.key));
  const order: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };
  const computed = items
    .map((n) => ({ ...n, dismissed: dismissed.has(n.key) }))
    .filter((n) => opts.includeDismissed || !n.dismissed)
    .sort((a, b) => order[a.severity] - order[b.severity] || a.date.localeCompare(b.date));
  // الأحداث الجديدة (اعتماد كتاب، إسناد مشروع، طلب جديد...) في رأس القائمة — الأحدث أولاً، ثم الاستحقاقات حسب الخطورة
  const freshEvents = eventItems.filter((e) => !e.dismissed).sort((a, b) => b.date.localeCompare(a.date));
  const seenEvents = eventItems.filter((e) => e.dismissed).sort((a, b) => b.date.localeCompare(a.date));
  return [...freshEvents, ...computed, ...seenEvents];
}

/**
 * نسخة مخزنة لكل طلب: القالب العام (العداد والجرس) ولوحة التحكم يطلبان التنبيهات نفسها
 * لنفس المستخدم في الطلب الواحد — تُحسب مرة واحدة بدل مرتين.
 */
export const notificationsForRequest = cache((user: AppUser) => computeNotifications(user));

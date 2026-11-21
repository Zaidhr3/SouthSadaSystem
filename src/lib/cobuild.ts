import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { AppError } from "./permissions";
import { addMonths } from "./format";
import { ACTIVE_BUYER, PRE_LAUNCH, buyerMonth, priceOf, r3, type CatalogLite } from "./cobuild-core";

/** عميل قاعدة البيانات أو معاملة منه (نفس الواجهة) */
type Tx = Omit<typeof db, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">;
type Actor = { name: string; userId?: number | null; clientId?: number | null };

/* ───────────── السجل والإشعارات ───────────── */
export async function logEvent(tx: Tx, projectId: number, action: string, note: string, actor: Actor, buyerId?: number | null) {
  await tx.coBuildEvent.create({ data: { projectId, buyerId: buyerId ?? null, action, note, actor: actor.name, userId: actor.userId ?? null, clientId: actor.clientId ?? null } });
}

/** إشعار داخل البوابة — key يمنع التكرار (مثلاً تذكير موعد أو حافز شهر) */
export async function notice(tx: Tx, projectId: number, title: string, body: string, opts: { buyerId?: number | null; key?: string } = {}) {
  if (opts.key && (await tx.coBuildNotice.findUnique({ where: { key: opts.key } }))) return;
  await tx.coBuildNotice.create({ data: { projectId, buyerId: opts.buyerId ?? null, title, body, key: opts.key ?? null } });
}

/* ───────────── الالتزام والجاهزية ───────────── */
/** عدد الملتزمين فعلاً: مشترٍ فعّال وشيكه المصدق مسجل وبالأمانة (أو حُرّر عند «تم») */
export const committedWhere = (projectId: number): Prisma.CoBuildBuyerWhereInput => ({
  projectId,
  status: { in: ACTIVE_BUYER },
  chequeNumber: { not: null },
  custodyStatus: { in: ["held_pending_go", "released_on_go"] },
});

export async function committedCount(tx: Tx, projectId: number) {
  return tx.coBuildBuyer.count({ where: committedWhere(projectId) });
}

/** يحدّث حالة المشروع قبل «تم» حسب عدد الملتزمين (جمع ↔ جاهز) */
export async function refreshReadiness(tx: Tx, projectId: number) {
  const p = await tx.coBuildProject.findUnique({ where: { id: projectId }, select: { status: true, launchThreshold: true } });
  if (!p || !PRE_LAUNCH.includes(p.status)) return;
  const n = await committedCount(tx, projectId);
  const next = n >= p.launchThreshold ? "ready_to_launch" : "collecting_buyers";
  if (next !== p.status) await tx.coBuildProject.update({ where: { id: projectId }, data: { status: next } });
}

/* ───────────── الحوافز مع سقف الشقة ───────────── */
/** يضيف حافزاً دون تجاوز سقف الحوافز للشقة؛ لا يتكرر لنفس المفتاح. يعيد المبلغ المضاف فعلاً */
export async function grantCredit(tx: Tx, buyerId: number, o: { kind: string; key: string; amount: number; note?: string; applied?: boolean }) {
  if (o.amount <= 0) return 0;
  if (await tx.coBuildCredit.findUnique({ where: { buyerId_key: { buyerId, key: o.key } } })) return 0;
  const b = await tx.coBuildBuyer.findUnique({ where: { id: buyerId }, select: { project: { select: { unitIncentiveCap: true } } } });
  if (!b) return 0;
  const used = (await tx.coBuildCredit.aggregate({ where: { buyerId, status: { not: "FORFEITED" } }, _sum: { amount: true } }))._sum.amount ?? 0;
  const amount = r3(Math.min(o.amount, Math.max(0, b.project.unitIncentiveCap - used)));
  if (amount <= 0) return 0;
  await tx.coBuildCredit.create({ data: { buyerId, kind: o.kind, key: o.key, amount, status: o.applied ? "APPLIED" : "ACCRUED", note: amount < o.amount ? `${o.note ?? ""} (قُصّ عند سقف الحوافز للشقة)`.trim() : o.note ?? null } });
  return amount;
}

/**
 * حوافز الانتظار: لكل مشترٍ فعّال لم ينسحب، إن لم ينطلق المشروع بعد الشهر الخامس من التزامه
 * ← +waitPerMonth عن الشهر 6 ثم 7 ثم 8 (حتى waitMaxMonths). الأشهر تُحسب حتى «تم» فقط.
 */
export async function syncWaitingIncentives(projectId: number) {
  const p = await db.coBuildProject.findUnique({ where: { id: projectId } });
  if (!p || p.status === "cancelled_reset") return 0;
  const until = p.launchedAt ?? new Date();
  const buyers = await db.coBuildBuyer.findMany({ where: { projectId, status: { in: ACTIVE_BUYER } }, select: { id: true, name: true, joinedAt: true } });
  let added = 0;
  for (const b of buyers) {
    const month = buyerMonth(b.joinedAt, until);
    for (let m = p.waitStartMonth; m < p.waitStartMonth + p.waitMaxMonths && m <= month; m++) {
      // بداية الشهر m للمشتري يجب أن تسبق «تم» (لا حافز عن شهر بدأ بعد الانطلاق)
      if (p.launchedAt && addMonths(b.joinedAt, m - 1) >= p.launchedAt) break;
      const amt = await grantCredit(db, b.id, { kind: "WAITING", key: `WAITING:${m}`, amount: p.waitPerMonth, note: `الشهر ${m} من الانتظار`, applied: !!p.launchedAt });
      if (amt > 0) {
        added++;
        await notice(db, projectId, `حافز انتظار +${amt} د.أ`, `دخلت شهرك ${m} من الانتظار قبل انطلاق المشروع، فأُضيف لك ${amt} د.أ يُخصم من رصيد عقدك عند «تم». (يسقط هذا الحافز إذا انسحبت)`, { buyerId: b.id, key: `notice:wait:${b.id}:${m}` });
      }
    }
  }
  return added;
}

/* ───────────── الانضمام ───────────── */
export async function joinBuyer(input: {
  projectId: number;
  unitId: number;
  name: string;
  phone: string | null;
  email: string | null;
  clientId: number | null;
  referredById: number | null;
  cheque: { number: string; bank: string; amount: number; issuedAt: Date };
  createdBy: { id: number; name: string };
}) {
  return db.$transaction(async (tx) => {
    const p = await tx.coBuildProject.findUnique({ where: { id: input.projectId } });
    if (!p) throw new AppError("المشروع غير موجود");
    if (!PRE_LAUNCH.includes(p.status)) throw new AppError("المشروع انطلق أو أُلغي — الانضمام عبر هذا المسار قبل «تم» فقط. الشقق اللاحقة تباع بعقد مباشر");
    // حجز ذرّي للشقة: لا يحجزها مشتريان في نفس اللحظة
    const claimed = await tx.coBuildUnit.updateMany({ where: { id: input.unitId, projectId: p.id, status: "available" }, data: { status: "reserved_cheque_held" } });
    if (!claimed.count) throw new AppError("الشقة غير متاحة (محجوزة أو مثبّتة)");
    if (input.referredById) {
      const ref = await tx.coBuildBuyer.findFirst({ where: { id: input.referredById, projectId: p.id, status: { in: ACTIVE_BUYER } } });
      if (!ref) throw new AppError("المُحيل يجب أن يكون مشترياً فعّالاً في نفس المشروع");
    }
    const before = await committedCount(tx, p.id);
    const seq = ((await tx.coBuildBuyer.aggregate({ where: { projectId: p.id }, _max: { seq: true } }))._max.seq ?? 0) + 1;
    const earlyBird = before < p.earlyBirdCount;
    const groupCloser = before + 1 === p.launchThreshold;
    const b = await tx.coBuildBuyer.create({
      data: {
        projectId: p.id,
        unitId: input.unitId,
        clientId: input.clientId,
        name: input.name,
        phone: input.phone,
        email: input.email,
        seq,
        earlyBird,
        groupCloser,
        referredById: input.referredById,
        chequeNumber: input.cheque.number,
        bankName: input.cheque.bank,
        chequeAmount: input.cheque.amount,
        chequeIssuedAt: input.cheque.issuedAt,
        custodyStatus: "held_pending_go",
        custodyChangedAt: new Date(),
        createdById: input.createdBy.id,
      },
      include: { unit: { select: { unitCode: true } } },
    });
    if (earlyBird) await grantCredit(tx, b.id, { kind: "EARLY_BIRD", key: "EARLY_BIRD", amount: p.earlyBirdBonus, note: `من أول ${p.earlyBirdCount} ملتزمين` });
    if (groupCloser) await grantCredit(tx, b.id, { kind: "CLOSER", key: "CLOSER", amount: p.closerBonus, note: "أكمل نصاب المجموعة" });
    const actor = { name: input.createdBy.name, userId: input.createdBy.id };
    await logEvent(tx, p.id, "JOIN", `التزم ${b.name} بالشقة ${b.unit.unitCode} — شيك مصدق رقم ${input.cheque.number} (${input.cheque.bank}) بمبلغ ${input.cheque.amount} د.أ بالأمانة حتى «تم»${earlyBird ? " — من الأوائل" : ""}${groupCloser ? " — مكمّل المجموعة" : ""}`, actor, b.id);
    await refreshReadiness(tx, p.id);
    const n = before + 1;
    await notice(tx, p.id, "انضم ملتزم جديد", `اكتمل ${n} من ${p.launchThreshold} ملتزمين لانطلاق المشروع.${n >= p.launchThreshold ? " اكتمل النصاب — بانتظار إعلان «تم» من الإدارة." : ""}`);
    return b;
  });
}

/* ───────────── الانسحاب قبل «تم» ───────────── */
export async function withdrawBuyer(buyerId: number, reason: string, actor: Actor) {
  return db.$transaction(async (tx) => {
    const b = await tx.coBuildBuyer.findUnique({ where: { id: buyerId }, include: { project: true, unit: true } });
    if (!b) throw new AppError("المشتري غير موجود");
    if (!PRE_LAUNCH.includes(b.project.status)) throw new AppError("لا انسحاب عبر هذا المسار بعد «تم» — يُعالج حسب بنود العقد (تسوية الشيك بقرار)");
    const claimed = await tx.coBuildBuyer.updateMany({ where: { id: b.id, status: { in: ["ACTIVE", "CONTRACTED"] } }, data: { status: "WITHDRAWN", withdrawnAt: new Date(), custodyStatus: "returned_withdrawn", custodyChangedAt: new Date() } });
    if (!claimed.count) throw new AppError("المشتري منسحب مسبقاً");
    // تسقط كل حوافزه المستحقة، وحافز «جيب جارك» الذي ناله غيره بسببه (ما دام لم يُطبّق)
    const lost = await tx.coBuildCredit.aggregate({ where: { buyerId: b.id, status: "ACCRUED" }, _sum: { amount: true } });
    await tx.coBuildCredit.updateMany({ where: { buyerId: b.id, status: "ACCRUED" }, data: { status: "FORFEITED" } });
    await tx.coBuildCredit.updateMany({ where: { key: `REFERRER:${b.id}`, status: "ACCRUED" }, data: { status: "FORFEITED" } });
    await tx.coBuildUnit.update({ where: { id: b.unitId }, data: { status: "available" } });
    const month = buyerMonth(b.joinedAt, new Date());
    await logEvent(tx, b.projectId, "WITHDRAW", `انسحب ${b.name} (الشهر ${month}) — أُعيد الشيك ${b.chequeNumber ?? ""} كاملاً بلا رسوم${lost._sum.amount ? `، وسقطت حوافز بقيمة ${lost._sum.amount} د.أ` : ""}. السبب: ${reason}`, actor, b.id);
    await refreshReadiness(tx, b.projectId);
    const n = await committedCount(tx, b.projectId);
    await notice(tx, b.projectId, "تغيّر عدد الملتزمين", `أصبح عدد الملتزمين ${n} من ${b.project.launchThreshold}. الشقة ${b.unit.unitCode} متاحة من جديد.`);
    return { month, forfeited: lost._sum.amount ?? 0 };
  });
}

/* ───────────── «تم» — الانطلاق ───────────── */
export async function launchProject(projectId: number, actor: { id: number; name: string }) {
  await syncWaitingIncentives(projectId); // تُحتسب كل أشهر الانتظار المستحقة حتى لحظة الإعلان
  return db.$transaction(async (tx) => {
    const p = await tx.coBuildProject.findUnique({ where: { id: projectId } });
    if (!p) throw new AppError("المشروع غير موجود");
    const n = await committedCount(tx, p.id);
    if (n < p.launchThreshold) throw new AppError(`لم يكتمل النصاب: ${n} من ${p.launchThreshold} ملتزمين بشيكات مصدقة`);
    const now = new Date();
    const claimed = await tx.coBuildProject.updateMany({ where: { id: p.id, status: { in: PRE_LAUNCH } }, data: { status: "in_construction_skeleton", launchedAt: now, launchedById: actor.id, phaseLabel: p.phaseLabel ?? "بدء أعمال العظم" } });
    if (!claimed.count) throw new AppError("أُعلن «تم» لهذا المشروع مسبقاً");
    const buyers = await tx.coBuildBuyer.findMany({ where: committedWhere(p.id), select: { id: true, unitId: true } });
    const ids = buyers.map((b) => b.id);
    await tx.coBuildBuyer.updateMany({ where: { id: { in: ids }, custodyStatus: "held_pending_go" }, data: { custodyStatus: "released_on_go", custodyChangedAt: now } });
    await tx.coBuildUnit.updateMany({ where: { id: { in: buyers.map((b) => b.unitId) } }, data: { status: "locked_active" } });
    const applied = await tx.coBuildCredit.aggregate({ where: { buyerId: { in: ids }, status: "ACCRUED" }, _sum: { amount: true } });
    await tx.coBuildCredit.updateMany({ where: { buyerId: { in: ids }, status: "ACCRUED" }, data: { status: "APPLIED" } });
    await logEvent(tx, p.id, "LAUNCH", `أُعلن «تم» — ${n} ملتزمين، حُرّرت ${ids.length} شيكات مصدقة للتنفيذ وطُبّقت حوافز بقيمة ${applied._sum.amount ?? 0} د.أ على أرصدة العقود`, { name: actor.name, userId: actor.id });
    await notice(tx, p.id, "تم! انطلق المشروع", `اكتمل النصاب (${n} من ${p.totalUnits}) وبدأ التنفيذ رسمياً. حوافزك المستحقة طُبّقت على رصيد عقدك، وتابع «شو بكرا» لمواعيد المراحل.`);
    return { committed: n, released: ids.length };
  });
}

/** إلغاء المشروع قبل «تم»: إعادة كل الشيكات، إسقاط الحوافز، تفريغ الشقق */
export async function cancelProject(projectId: number, reason: string, actor: { id: number; name: string }) {
  return db.$transaction(async (tx) => {
    const p = await tx.coBuildProject.findUnique({ where: { id: projectId } });
    if (!p) throw new AppError("المشروع غير موجود");
    const claimed = await tx.coBuildProject.updateMany({ where: { id: p.id, status: { in: PRE_LAUNCH } }, data: { status: "cancelled_reset" } });
    if (!claimed.count) throw new AppError("الإلغاء متاح قبل «تم» فقط");
    const now = new Date();
    const buyers = await tx.coBuildBuyer.findMany({ where: { projectId: p.id, status: { in: ["ACTIVE", "CONTRACTED"] } }, select: { id: true } });
    const ids = buyers.map((b) => b.id);
    await tx.coBuildBuyer.updateMany({ where: { id: { in: ids } }, data: { status: "WITHDRAWN", withdrawnAt: now, custodyStatus: "returned_withdrawn", custodyChangedAt: now } });
    await tx.coBuildCredit.updateMany({ where: { buyerId: { in: ids }, status: "ACCRUED" }, data: { status: "FORFEITED" } });
    await tx.coBuildUnit.updateMany({ where: { projectId: p.id }, data: { status: "available" } });
    await logEvent(tx, p.id, "CANCEL", `أُلغي المشروع وأُعيدت ${ids.length} شيكات مصدقة لأصحابها. السبب: ${reason}`, { name: actor.name, userId: actor.id });
    await notice(tx, p.id, "أُلغي المشروع", `قررت الشركة إلغاء المشروع قبل الانطلاق وإعادة كل الشيكات المصدقة كاملة لأصحابها. السبب: ${reason}`);
  });
}

/* ───────────── «جيب جارك» ───────────── */
/** عند توقيع عقد الجار المُحال: 700 للمُحيل و300 للجار (ضمن سقف كل شقة) */
export async function qualifyReferral(tx: Tx, buyerId: number) {
  const b = await tx.coBuildBuyer.findUnique({ where: { id: buyerId }, include: { project: true, referredBy: true } });
  if (!b?.referredBy || !ACTIVE_BUYER.includes(b.referredBy.status)) return null;
  const applied = !PRE_LAUNCH.includes(b.project.status);
  const toReferrer = await grantCredit(tx, b.referredBy.id, { kind: "REFERRER", key: `REFERRER:${b.id}`, amount: b.project.referrerBonus, note: `أحال ${b.name}`, applied });
  const toReferred = await grantCredit(tx, b.id, { kind: "REFERRED", key: "REFERRED", amount: b.project.referredBonus, note: `بإحالة ${b.referredBy.name}`, applied });
  if (toReferrer) await notice(tx, b.projectId, `جيب جارك: +${toReferrer} د.أ`, `وقّع ${b.name} عقده بإحالتك — أُضيف لرصيدك ${toReferrer} د.أ.`, { buyerId: b.referredBy.id, key: `notice:ref:${b.id}` });
  if (toReferred) await notice(tx, b.projectId, `جيب جارك: +${toReferred} د.أ`, `أهلاً بك جاراً! أُضيف لرصيدك ${toReferred} د.أ بإحالة ${b.referredBy.name}.`, { buyerId: b.id, key: `notice:refd:${b.id}` });
  return { toReferrer, toReferred };
}

/* ───────────── الكتالوج والتقدير ───────────── */
export async function catalogLite(where: Prisma.CatalogItemWhereInput = {}): Promise<CatalogLite[]> {
  const items = await db.catalogItem.findMany({ where: { isActive: true, ...where }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] });
  return items.map((i) => ({ id: i.id, code: i.code, phase: i.phase, category: i.category, name: i.name, specs: i.specs, unit: i.unit, price: priceOf(i), mode: i.mode, choiceGroup: i.choiceGroup, qtyPerSqm: i.qtyPerSqm, defaultQty: i.defaultQty, qtyEditable: i.qtyEditable }));
}

/** ملخص مالي للمشتري: العظم + اختياراته (بالسعر المقفول إن وُجد) − حوافزه غير الساقطة */
export async function buyerFinance(buyerId: number) {
  const b = await db.coBuildBuyer.findUnique({ where: { id: buyerId }, include: { unit: true, selections: { include: { item: true } }, credits: true } });
  if (!b) return null;
  const lines = b.selections.map((s) => ({ itemId: s.itemId, qty: s.qty, price: s.lockedPrice ?? priceOf(s.item) }));
  const finishing = r3(lines.reduce((s, l) => s + l.qty * l.price, 0));
  const credits = r3(b.credits.filter((c) => c.status !== "FORFEITED").reduce((s, c) => s + c.amount, 0));
  return { base: b.unit.skeletonPrice, finishing, credits, total: r3(b.unit.skeletonPrice + finishing - credits) };
}

/* ───────────── حساب بوابة المشتري ───────────── */
/** ينشئ حساب البوابة للمشتري (أو يربط حساباً موجوداً بنفس البريد) — الدخول بالبريد وكلمة مرور مؤقتة */
export async function provisionBuyerClient(o: { name: string; email: string; phone: string | null; projectName: string; createdById: number }) {
  const email = o.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AppError("بريد المشتري غير صالح — الدخول للبوابة يكون بالبريد الإلكتروني");
  const existing = await db.client.findUnique({ where: { email } });
  if (existing) return { clientId: existing.id, password: null as string | null, mailed: false };
  const bcrypt = (await import("bcryptjs")).default;
  const { tempPassword, mailClientCredentials } = await import("./portal");
  const password = tempPassword();
  const c = await db.client.create({ data: { name: o.name, email, phone: o.phone, kind: "OWNER", passwordHash: await bcrypt.hash(password, 10), mustChangePassword: true, createdById: o.createdById } });
  const mailed = await mailClientCredentials(email, o.name, password, o.projectName);
  return { clientId: c.id, password, mailed };
}

/* ───────────── المهمة اليومية ───────────── */
/** حوافز الانتظار لكل المشاريع قبل «تم» + تذكير «شو عندك» قبل الموعد بثلاثة أيام */
export async function runCoBuildJobs() {
  const projects = await db.coBuildProject.findMany({ where: { status: { in: PRE_LAUNCH } }, select: { id: true } });
  let credits = 0;
  for (const p of projects) credits += await syncWaitingIncentives(p.id);
  const soon = new Date(Date.now() + 3 * 86400000);
  const due = await db.coBuildTask.findMany({ where: { status: "OPEN", dueDate: { lte: soon }, remindedAt: null } });
  for (const t of due) {
    await notice(db, t.projectId, `تذكير: ${t.title}`, `موعده ${t.dueDate!.toISOString().slice(0, 10)}${t.amount ? ` — المبلغ ${t.amount} د.أ` : ""}. تجده في «شو عندك».`, { buyerId: t.buyerId, key: `notice:task:${t.id}` });
    await db.coBuildTask.update({ where: { id: t.id }, data: { remindedAt: new Date() } });
  }
  return { projects: projects.length, credits, reminders: due.length };
}

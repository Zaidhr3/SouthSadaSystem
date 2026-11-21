"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { actionUser } from "@/lib/auth";
import { auditEvent, run, runVoid, type ActionState } from "@/lib/action";
import { AppError, can } from "@/lib/permissions";
import { saveAttachments } from "@/lib/uploads";
import { notify } from "@/lib/notify";
import { CATALOG_SEED, seedRow } from "@/lib/cobuild-catalog-seed";
import { ACTIVE_BUYER, LAUNCHED, MODE, PHASE_LABEL, PRE_LAUNCH, TASK_KIND, UNITS, priceOf, r3 } from "@/lib/cobuild-core";
import { cancelProject, joinBuyer, launchProject, logEvent, notice, provisionBuyerClient, qualifyReferral, refreshReadiness, syncWaitingIncentives, withdrawBuyer } from "@/lib/cobuild";

const t = (fd: FormData, k: string, max = 2000) => String(fd.get(k) ?? "").trim().slice(0, max);
const num = (fd: FormData, k: string, o: { min?: number; max?: number; label?: string; required?: boolean } = {}) => {
  const s = t(fd, k).replace(/,/g, "");
  if (!s) {
    if (o.required) throw new AppError(`${o.label ?? "القيمة"} مطلوبة`);
    return null;
  }
  const v = Number(s);
  if (!Number.isFinite(v)) throw new AppError(`${o.label ?? "القيمة"} غير صالحة`);
  if (o.min != null && v < o.min) throw new AppError(`${o.label ?? "القيمة"} لا تقل عن ${o.min}`);
  if (o.max != null && v > o.max) throw new AppError(`${o.label ?? "القيمة"} لا تزيد عن ${o.max}`);
  return v;
};
const date = (fd: FormData, k: string) => {
  const s = t(fd, k);
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new AppError("تاريخ غير صالح");
  return new Date(`${s}T00:00:00Z`);
};
const done = (projectId?: number) => {
  revalidatePath("/cobuild");
  revalidatePath("/cobuild/catalog");
  if (projectId) revalidatePath(`/cobuild/${projectId}`);
};
const actorOf = (u: { id: number; name: string }) => ({ name: u.name, userId: u.id });

/* ═════════════ الكتالوج والأسعار ═════════════ */

/** تعبئة قالب الكتالوج المبدئي — يضيف البنود الناقصة فقط ولا يلمس أسعاراً عدّلتها */
export async function seedCatalog(_: ActionState, __: FormData): Promise<ActionState> {
  const r = await run(async () => {
    const user = await actionUser(can.manageCoBuild);
    const have = new Set((await db.catalogItem.findMany({ select: { code: true } })).map((x) => x.code));
    const rows = CATALOG_SEED.map(seedRow).filter((x) => !have.has(x.code)).map((x) => ({ ...x, updatedById: user.id }));
    if (rows.length) await db.catalogItem.createMany({ data: rows });
    await auditEvent("SEED", "CatalogItem", `تعبئة قالب الكتالوج: أُضيف ${rows.length} بنداً`, user);
    return rows.length ? `أُضيف ${rows.length} بنداً بأسعار مبدئية — راجعها وعدّلها` : "كل بنود القالب موجودة مسبقاً";
  });
  done();
  return r;
}

function catalogData(fd: FormData) {
  const phase = t(fd, "phase");
  if (!PHASE_LABEL[phase]) throw new AppError("اختر المرحلة");
  const unit = t(fd, "unit");
  if (!(UNITS as readonly string[]).includes(unit)) throw new AppError("وحدة غير صالحة");
  const mode = t(fd, "mode");
  if (!MODE[mode]) throw new AppError("نوع البند غير صالح");
  const name = t(fd, "name", 200);
  if (name.length < 3) throw new AppError("اكتب اسم البند");
  const unitCost = num(fd, "unitCost", { min: 0, max: 1_000_000, label: "الكلفة", required: true })!;
  const priceIn = num(fd, "price", { min: 0, max: 1_000_000, label: "سعر البيع" });
  const margin = priceIn != null ? r3(priceIn - unitCost) : num(fd, "margin", { min: -1_000_000, max: 1_000_000, label: "الهامش" }) ?? 0;
  return {
    phase,
    unit,
    mode,
    name,
    category: t(fd, "category", 120) || "عام",
    specs: t(fd, "specs", 1000) || null,
    unitCost: r3(unitCost),
    margin: r3(margin),
    choiceGroup: t(fd, "choiceGroup", 40).toUpperCase().replace(/[^A-Z0-9_]/g, "") || null,
    qtyPerSqm: num(fd, "qtyPerSqm", { min: 0, max: 20, label: "معامل المساحة" }) ?? 0,
    defaultQty: num(fd, "defaultQty", { min: 0, max: 10_000, label: "الكمية الافتراضية" }) ?? 1,
    qtyEditable: fd.get("qtyEditable") === "on",
    isPublic: fd.get("isPublic") === "on",
  };
}

export async function saveCatalogItem(id: number | null, _: ActionState, fd: FormData): Promise<ActionState> {
  const r = await run(async () => {
    const user = await actionUser(can.manageCoBuild);
    const data = catalogData(fd);
    if (id) {
      await db.catalogItem.update({ where: { id }, data: { ...data, updatedById: user.id } });
    } else {
      const max = (await db.catalogItem.aggregate({ _max: { sortOrder: true } }))._max.sortOrder ?? 0;
      const count = await db.catalogItem.count();
      await db.catalogItem.create({ data: { ...data, code: `U${String(count + 1).padStart(3, "0")}-${Date.now().toString(36).slice(-4)}`, sortOrder: max + 1, updatedById: user.id } });
    }
    await auditEvent(id ? "UPDATE" : "CREATE", "CatalogItem", `${id ? "تعديل" : "إضافة"} بند الكتالوج «${data.name}» — كلفة ${data.unitCost} + هامش ${data.margin} = ${r3(data.unitCost + data.margin)} د.أ/${data.unit}`, user, { recordId: id });
    return id ? "حُفظ البند" : "أُضيف البند";
  });
  done();
  return r;
}

/** تعديل سريع داخل الجدول: الكلفة وسعر البيع (الهامش = الفرق) */
export async function inlinePrice(id: number, _: ActionState, fd: FormData): Promise<ActionState> {
  const r = await run(async () => {
    const user = await actionUser(can.manageCoBuild);
    const unitCost = num(fd, "unitCost", { min: 0, max: 1_000_000, label: "الكلفة", required: true })!;
    const price = num(fd, "price", { min: 0, max: 1_000_000, label: "سعر البيع", required: true })!;
    const it = await db.catalogItem.update({ where: { id }, data: { unitCost: r3(unitCost), margin: r3(price - unitCost), updatedById: user.id } });
    return price < unitCost ? `حُفظ — تنبيه: سعر البيع أقل من الكلفة (هامش ${r3(price - unitCost)})` : `«${it.name}»: ${price} د.أ (هامش ${r3(price - unitCost)})`;
  });
  done();
  return r;
}

export async function toggleCatalogItem(id: number) {
  const r = await runVoid(async () => {
    await actionUser(can.manageCoBuild);
    const it = await db.catalogItem.findUnique({ where: { id } });
    if (!it) throw new AppError("البند غير موجود");
    await db.catalogItem.update({ where: { id }, data: { isActive: !it.isActive } });
  });
  done();
  return r;
}

export async function deleteCatalogItem(id: number) {
  const r = await runVoid(async () => {
    await actionUser(can.manageCoBuild);
    const used = await db.coBuildSelection.count({ where: { itemId: id } });
    if (used) throw new AppError(`البند مختار في ${used} شقة — أوقفه بدل الحذف`);
    await db.catalogItem.delete({ where: { id } });
  });
  done();
  return r;
}

/**
 * تعديل جماعي للأسعار (ثبات الأسعار وضبط الهامش): نسبة ± أو مبلغ ± على الكلفة أو الهامش أو سعر البيع كاملاً.
 * لا يمس أسعار الشقق المقفولة (محفوظة بنسخة ثابتة في اختيارات المشتري).
 */
export async function bulkAdjust(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = await run(async () => {
    const user = await actionUser(can.manageCoBuild);
    const phase = t(fd, "phase");
    const category = t(fd, "category", 120);
    const target = t(fd, "target");
    const type = t(fd, "type");
    if (!["price", "cost", "margin"].includes(target)) throw new AppError("اختر ما يُعدَّل");
    if (!["pct", "amount"].includes(type)) throw new AppError("اختر نوع التعديل");
    const value = num(fd, "value", { label: "قيمة التعديل", required: true, min: type === "pct" ? -50 : -100_000, max: type === "pct" ? 100 : 100_000 })!;
    if (value === 0) throw new AppError("قيمة التعديل صفر");
    const items = await db.catalogItem.findMany({ where: { ...(phase && phase !== "ALL" ? { phase } : {}), ...(category ? { category } : {}) } });
    if (!items.length) throw new AppError("لا بنود ضمن هذا النطاق");
    const next = items.map((i) => {
      let { unitCost, margin } = i;
      const price = unitCost + margin;
      if (target === "cost") unitCost = type === "pct" ? unitCost * (1 + value / 100) : unitCost + value;
      else if (target === "margin") margin = type === "pct" ? margin * (1 + value / 100) : margin + value;
      else if (type === "pct") {
        unitCost *= 1 + value / 100;
        margin *= 1 + value / 100;
      } else margin += value; // مبلغ على سعر البيع يذهب للهامش (الكلفة الفعلية لا تتغير)
      if (unitCost < 0) throw new AppError(`التعديل يجعل كلفة «${i.name}» سالبة`);
      if (price > 0 && unitCost + margin < 0) throw new AppError(`التعديل يجعل سعر «${i.name}» سالباً`);
      return { id: i.id, unitCost: r3(unitCost), margin: r3(margin) };
    });
    await db.$transaction(next.map((n) => db.catalogItem.update({ where: { id: n.id }, data: { unitCost: n.unitCost, margin: n.margin, updatedById: user.id } })));
    const what = target === "cost" ? "الكلفة" : target === "margin" ? "الهامش" : "سعر البيع";
    const scope = `${phase && phase !== "ALL" ? PHASE_LABEL[phase] : "كل المراحل"}${category ? ` / ${category}` : ""}`;
    await auditEvent("BULK_PRICE", "CatalogItem", `تعديل جماعي: ${what} ${value > 0 ? "+" : ""}${value}${type === "pct" ? "%" : " د.أ"} على ${items.length} بنداً (${scope})`, user);
    return `عُدّل ${what} لـ ${items.length} بنداً — الأسعار المقفولة للمشترين لم تتغير`;
  });
  done();
  return r;
}

/* ═════════════ المشاريع والشقق ═════════════ */

const FLOORS = ["التسوية", "الأرضي", "الأول", "الثاني", "الثالث", "الرابع", "الخامس", "السادس", "السابع"];

export async function createProject(_: ActionState, fd: FormData): Promise<ActionState> {
  let id = 0;
  const r = await run(async () => {
    const user = await actionUser(can.manageCoBuild);
    const name = t(fd, "name", 160);
    const location = t(fd, "location", 160);
    if (name.length < 3 || location.length < 2) throw new AppError("اكتب اسم المشروع وموقعه");
    const totalUnits = num(fd, "totalUnits", { min: 2, max: 60, label: "عدد الشقق", required: true })!;
    const threshold = num(fd, "launchThreshold", { min: 1, max: totalUnits, label: "نصاب الانطلاق", required: true })!;
    const perFloor = num(fd, "perFloor", { min: 1, max: 8, label: "شقق كل طابق" }) ?? 2;
    const startFloor = num(fd, "startFloor", { min: 0, max: 1, label: "أول طابق" }) ?? 1;
    const area = num(fd, "area", { min: 30, max: 2000, label: "المساحة الافتراضية", required: true })!;
    const skeletonPrice = num(fd, "skeletonPrice", { min: 0, max: 10_000_000, label: "سعر العظم الافتراضي", required: true })!;
    const tenderId = Number(t(fd, "tenderId")) || null;
    if (tenderId && !(await db.tender.findUnique({ where: { id: tenderId }, select: { id: true } }))) throw new AppError("المشروع المرتبط غير موجود");
    const count = await db.coBuildProject.count();
    const p = await db.coBuildProject.create({
      data: {
        ref: `CB-${new Date().getUTCFullYear()}-${String(count + 1).padStart(3, "0")}`,
        name,
        location,
        parcel: t(fd, "parcel", 80) || null,
        basin: t(fd, "basin", 120) || null,
        description: t(fd, "description", 3000) || null,
        tenderId,
        totalUnits,
        launchThreshold: threshold,
        createdById: user.id,
        units: {
          create: Array.from({ length: totalUnits }, (_, i) => {
            const f = Math.floor(i / perFloor);
            return { unitCode: `${f + startFloor}0${(i % perFloor) + 1}`, floor: FLOORS[f + startFloor] ?? `الطابق ${f + startFloor}`, areaSqm: area, skeletonPrice, isBuffer: i === totalUnits - 1 && threshold < totalUnits, sortOrder: i };
          }),
        },
      },
    });
    id = p.id;
    await logEvent(db, p.id, "CREATE", `أُنشئ المشروع ${p.ref}: ${totalUnits} شقق، الانطلاق عند ${threshold} ملتزمين`, actorOf(user));
    return "أُنشئ المشروع";
  });
  done();
  if (r.ok && id) redirect(`/cobuild/${id}`);
  return r;
}

export async function saveProjectSettings(id: number, _: ActionState, fd: FormData): Promise<ActionState> {
  const r = await run(async () => {
    const user = await actionUser(can.manageCoBuild);
    const p = await db.coBuildProject.findUnique({ where: { id } });
    if (!p) throw new AppError("المشروع غير موجود");
    const pre = PRE_LAUNCH.includes(p.status);
    const threshold = num(fd, "launchThreshold", { min: 1, max: p.totalUnits, label: "نصاب الانطلاق", required: true })!;
    if (!pre && threshold !== p.launchThreshold) throw new AppError("لا يتغير النصاب بعد «تم»");
    const data = {
      name: t(fd, "name", 160) || p.name,
      location: t(fd, "location", 160) || p.location,
      parcel: t(fd, "parcel", 80) || null,
      basin: t(fd, "basin", 120) || null,
      description: t(fd, "description", 3000) || null,
      launchThreshold: threshold,
      waitStartMonth: num(fd, "waitStartMonth", { min: 2, max: 24, label: "شهر بدء الحافز", required: true })!,
      waitPerMonth: num(fd, "waitPerMonth", { min: 0, max: 10_000, label: "حافز الشهر", required: true })!,
      waitMaxMonths: num(fd, "waitMaxMonths", { min: 0, max: 12, label: "عدد أشهر الحافز", required: true })!,
      referrerBonus: num(fd, "referrerBonus", { min: 0, max: 10_000, label: "حافز المُحيل", required: true })!,
      referredBonus: num(fd, "referredBonus", { min: 0, max: 10_000, label: "حافز الجار", required: true })!,
      unitIncentiveCap: num(fd, "unitIncentiveCap", { min: 0, max: 100_000, label: "سقف الحوافز للشقة", required: true })!,
      earlyBirdCount: num(fd, "earlyBirdCount", { min: 0, max: p.totalUnits, label: "عدد الأوائل", required: true })!,
      earlyBirdBonus: num(fd, "earlyBirdBonus", { min: 0, max: 10_000, label: "حافز الأوائل" }) ?? 0,
      closerBonus: num(fd, "closerBonus", { min: 0, max: 10_000, label: "حافز مكمّل المجموعة" }) ?? 0,
      neighborIntro: fd.get("neighborIntro") === "on",
      isPublic: fd.get("isPublic") === "on",
    };
    await db.coBuildProject.update({ where: { id }, data });
    await refreshReadiness(db, id);
    await logEvent(db, id, "SETTINGS", `عُدّلت إعدادات المشروع: النصاب ${data.launchThreshold}، حافز الانتظار ${data.waitPerMonth}×${data.waitMaxMonths} من الشهر ${data.waitStartMonth}، جيب جارك ${data.referrerBonus}/${data.referredBonus}، السقف ${data.unitIncentiveCap}`, actorOf(user));
    return "حُفظت الإعدادات";
  });
  done(id);
  return r;
}

export async function saveUnit(id: number, _: ActionState, fd: FormData): Promise<ActionState> {
  let pid = 0;
  const r = await run(async () => {
    const user = await actionUser(can.manageCoBuild);
    const u = await db.coBuildUnit.findUnique({ where: { id } });
    if (!u) throw new AppError("الشقة غير موجودة");
    pid = u.projectId;
    const skeletonPrice = num(fd, "skeletonPrice", { min: 0, max: 10_000_000, label: "سعر العظم", required: true })!;
    const areaSqm = num(fd, "areaSqm", { min: 20, max: 3000, label: "المساحة", required: true })!;
    if (u.status !== "available" && (skeletonPrice !== u.skeletonPrice || areaSqm !== u.areaSqm)) throw new AppError("الشقة محجوزة لمشترٍ — سعرها ومساحتها مثبّتان له");
    const unitCode = t(fd, "unitCode", 20) || u.unitCode;
    if (unitCode !== u.unitCode && (await db.coBuildUnit.findUnique({ where: { projectId_unitCode: { projectId: u.projectId, unitCode } } }))) throw new AppError("رقم الشقة مستخدم");
    await db.coBuildUnit.update({ where: { id }, data: { unitCode, floor: t(fd, "floor", 40) || u.floor, facadeView: t(fd, "facadeView", 80) || null, skeletonPrice, areaSqm, isBuffer: fd.get("isBuffer") === "on" } });
    await logEvent(db, u.projectId, "UNIT", `عُدّلت الشقة ${unitCode}: ${areaSqm} م²، العظم ${skeletonPrice} د.أ`, actorOf(user));
    return "حُفظت الشقة";
  });
  done(pid);
  return r;
}

/** «تم» — إعلان الانطلاق: تحرير الشيكات وتثبيت الشقق وتطبيق الحوافز (ذرّياً) */
export async function launchAction(id: number) {
  const r = await runVoid(async () => {
    const user = await actionUser(can.manageCoBuild);
    const res = await launchProject(id, user);
    const p = await db.coBuildProject.findUnique({ where: { id }, select: { name: true, tenderId: true } });
    await notify(["ADMIN", "ACCOUNTANT"], { title: `تم! انطلق ${p?.name}`, body: `${res.committed} ملتزمين — حُرّرت ${res.released} شيكات مصدقة للتنفيذ`, href: `/cobuild/${id}` }, { exclude: user.id });
  });
  done(id);
  return r;
}

export async function cancelAction(id: number, _: ActionState, fd: FormData): Promise<ActionState> {
  const r = await run(async () => {
    const user = await actionUser(can.manageCoBuild);
    const reason = t(fd, "reason", 600);
    if (reason.length < 10) throw new AppError("اكتب سبب الإلغاء (يصل لكل المشترين)");
    await cancelProject(id, reason, user);
    return "أُلغي المشروع وأُعيدت الشيكات";
  });
  done(id);
  return r;
}

/* ═════════════ المشترون والشيكات ═════════════ */

export async function addBuyer(projectId: number, _: ActionState, fd: FormData): Promise<ActionState> {
  const r = await run(async () => {
    const user = await actionUser(can.coBuildDeals);
    const name = t(fd, "name", 120);
    if (name.length < 3) throw new AppError("اكتب اسم المشتري الكامل");
    const email = t(fd, "email", 160).toLowerCase() || null;
    const unitId = Number(t(fd, "unitId"));
    if (!unitId) throw new AppError("اختر الشقة");
    const chequeNumber = t(fd, "chequeNumber", 40);
    const bank = t(fd, "bankName", 80);
    if (!chequeNumber || !bank) throw new AppError("رقم الشيك المصدق والبنك مطلوبان — الالتزام يكون بشيك مصدق");
    const amount = num(fd, "chequeAmount", { min: 1, max: 10_000_000, label: "مبلغ الشيك", required: true })!;
    const issuedAt = date(fd, "chequeIssuedAt") ?? new Date();
    const b = await joinBuyer({
      projectId,
      unitId,
      name,
      phone: t(fd, "phone", 30) || null,
      email,
      clientId: null,
      referredById: Number(t(fd, "referredById")) || null,
      cheque: { number: chequeNumber, bank, amount, issuedAt },
      createdBy: user,
    });
    let extra = "";
    if (email && fd.get("portal") === "on") {
      const c = await provisionBuyerClient({ name, email, phone: b.phone, projectName: (await db.coBuildProject.findUnique({ where: { id: projectId }, select: { name: true } }))!.name, createdById: user.id });
      await db.coBuildBuyer.update({ where: { id: b.id }, data: { clientId: c.clientId } });
      extra = c.password ? ` — حساب البوابة: ${email} / كلمة مؤقتة ${c.password}${c.mailed ? " (أُرسلت بالبريد)" : ""}` : " — رُبط بحساب البوابة الموجود";
    }
    const p = await db.coBuildProject.findUnique({ where: { id: projectId }, select: { name: true, status: true, launchThreshold: true } });
    if (p?.status === "ready_to_launch") await notify(["ADMIN"], { title: `اكتمل نصاب ${p.name}`, body: `${p.launchThreshold} ملتزمين بشيكات مصدقة — جاهز لإعلان «تم»`, href: `/cobuild/${projectId}` });
    return `التزم ${name} بالشقة${extra}`;
  });
  done(projectId);
  return r;
}

export async function giveBuyerPortal(buyerId: number, _: ActionState, fd: FormData): Promise<ActionState> {
  let pid = 0;
  const r = await run(async () => {
    const user = await actionUser(can.coBuildDeals);
    const b = await db.coBuildBuyer.findUnique({ where: { id: buyerId }, include: { project: { select: { name: true } } } });
    if (!b) throw new AppError("المشتري غير موجود");
    pid = b.projectId;
    const email = (t(fd, "email", 160) || b.email || "").toLowerCase();
    const c = await provisionBuyerClient({ name: b.name, email, phone: b.phone, projectName: b.project.name, createdById: user.id });
    await db.coBuildBuyer.update({ where: { id: b.id }, data: { clientId: c.clientId, email } });
    await logEvent(db, b.projectId, "PORTAL", `فُعّل حساب البوابة لـ ${b.name} (${email})`, actorOf(user), b.id);
    return c.password ? `الدخول: ${email} — كلمة مؤقتة ${c.password}${c.mailed ? " (أُرسلت بالبريد)" : ""}` : "رُبط بحساب البوابة الموجود لنفس البريد";
  });
  done(pid);
  return r;
}

export async function updateCheque(buyerId: number, _: ActionState, fd: FormData): Promise<ActionState> {
  let pid = 0;
  const r = await run(async () => {
    const user = await actionUser(can.coBuildDeals);
    const b = await db.coBuildBuyer.findUnique({ where: { id: buyerId } });
    if (!b) throw new AppError("المشتري غير موجود");
    pid = b.projectId;
    if (b.custodyStatus !== "held_pending_go") throw new AppError("بيانات الشيك تُعدَّل فقط وهو بالأمانة قبل «تم»");
    const chequeNumber = t(fd, "chequeNumber", 40);
    const bankName = t(fd, "bankName", 80);
    if (!chequeNumber || !bankName) throw new AppError("رقم الشيك والبنك مطلوبان");
    const chequeAmount = num(fd, "chequeAmount", { min: 1, max: 10_000_000, label: "مبلغ الشيك", required: true })!;
    const chequeIssuedAt = date(fd, "chequeIssuedAt") ?? b.chequeIssuedAt;
    await db.coBuildBuyer.update({ where: { id: b.id }, data: { chequeNumber, bankName, chequeAmount, chequeIssuedAt } });
    await logEvent(db, b.projectId, "CHEQUE", `عُدّلت بيانات شيك ${b.name}: من ${b.chequeNumber} (${b.bankName}، ${b.chequeAmount}) إلى ${chequeNumber} (${bankName}، ${chequeAmount})`, actorOf(user), b.id);
    return "حُفظ الشيك";
  });
  done(pid);
  return r;
}

export async function withdrawAction(buyerId: number, _: ActionState, fd: FormData): Promise<ActionState> {
  let pid = 0;
  const r = await run(async () => {
    const user = await actionUser(can.coBuildDeals);
    const reason = t(fd, "reason", 600);
    if (reason.length < 5) throw new AppError("اكتب سبب الانسحاب");
    pid = (await db.coBuildBuyer.findUnique({ where: { id: buyerId }, select: { projectId: true } }))?.projectId ?? 0;
    const res = await withdrawBuyer(buyerId, reason, actorOf(user));
    return `سُجّل الانسحاب (الشهر ${res.month}) — يُعاد الشيك كاملاً${res.forfeited ? `، وسقطت حوافز ${res.forfeited} د.أ` : ""}`;
  });
  done(pid);
  return r;
}

/** تسوية/مصادرة الشيك بعد «تم» (نزاع عقدي) — بقرار الإدارة وسبب موثّق */
export async function settleCheque(buyerId: number, _: ActionState, fd: FormData): Promise<ActionState> {
  let pid = 0;
  const r = await run(async () => {
    const user = await actionUser(can.manageCoBuild);
    const reason = t(fd, "reason", 600);
    if (reason.length < 10) throw new AppError("اكتب سبب التسوية ومرجع القرار");
    const b = await db.coBuildBuyer.findUnique({ where: { id: buyerId } });
    if (!b) throw new AppError("المشتري غير موجود");
    pid = b.projectId;
    if (b.custodyStatus !== "released_on_go") throw new AppError("التسوية للشيكات المحررة بعد «تم» فقط — قبلها يُعاد الشيك بالانسحاب");
    await db.coBuildBuyer.update({ where: { id: b.id }, data: { custodyStatus: "forfeited_or_settled", custodyChangedAt: new Date() } });
    await logEvent(db, b.projectId, "SETTLE", `سُوّي شيك ${b.name} (${b.chequeNumber}) بقرار الإدارة: ${reason}`, actorOf(user), b.id);
    return "سُجّلت التسوية";
  });
  done(pid);
  return r;
}

export async function markContracted(buyerId: number) {
  let pid = 0;
  const r = await runVoid(async () => {
    const user = await actionUser(can.coBuildDeals);
    await db.$transaction(async (tx) => {
      const b = await tx.coBuildBuyer.findUnique({ where: { id: buyerId } });
      if (!b) throw new AppError("المشتري غير موجود");
      pid = b.projectId;
      const claimed = await tx.coBuildBuyer.updateMany({ where: { id: b.id, status: "ACTIVE" }, data: { status: "CONTRACTED", contractedAt: new Date() } });
      if (!claimed.count) throw new AppError("العقد موقّع مسبقاً أو المشتري غير فعّال");
      const ref = await qualifyReferral(tx, b.id);
      await logEvent(tx, b.projectId, "CONTRACT", `وقّع ${b.name} العقد${ref ? ` — جيب جارك: ${ref.toReferrer} للمُحيل و${ref.toReferred} للجار` : ""}`, actorOf(user), b.id);
    });
  });
  done(pid);
  return r;
}

/** قفل الأسعار: تُنسخ أسعار اختيارات المشتري الحالية فلا تتأثر بأي تعديل لاحق على الكتالوج */
export async function lockPrices(buyerId: number) {
  let pid = 0;
  const r = await runVoid(async () => {
    const user = await actionUser(can.coBuildDeals);
    await db.$transaction(async (tx) => {
      const b = await tx.coBuildBuyer.findUnique({ where: { id: buyerId }, include: { selections: { include: { item: true } } } });
      if (!b) throw new AppError("المشتري غير موجود");
      pid = b.projectId;
      if (b.pricesLockedAt) throw new AppError("الأسعار مقفولة مسبقاً");
      if (!ACTIVE_BUYER.includes(b.status)) throw new AppError("المشتري غير فعّال");
      for (const s of b.selections) await tx.coBuildSelection.update({ where: { id: s.id }, data: { lockedPrice: priceOf(s.item) } });
      await tx.coBuildBuyer.update({ where: { id: b.id }, data: { pricesLockedAt: new Date() } });
      const total = r3(b.selections.reduce((s, x) => s + x.qty * priceOf(x.item), 0));
      await logEvent(tx, b.projectId, "LOCK", `قُفلت أسعار ${b.name}: ${b.selections.length} بنداً بمجموع تشطيب ${total} د.أ`, actorOf(user), b.id);
      await notice(tx, b.projectId, "قُفلت أسعار تشطيبك", `ثُبّتت أسعار اختياراتك (${total} د.أ) — أي تغيير لاحق في الكتالوج لا يؤثر عليك.`, { buyerId: b.id });
    });
  });
  done(pid);
  return r;
}

export async function handOver(buyerId: number) {
  let pid = 0;
  const r = await runVoid(async () => {
    const user = await actionUser(can.manageCoBuild);
    await db.$transaction(async (tx) => {
      const b = await tx.coBuildBuyer.findUnique({ where: { id: buyerId }, include: { project: true, unit: true } });
      if (!b) throw new AppError("المشتري غير موجود");
      pid = b.projectId;
      if (!LAUNCHED.includes(b.project.status)) throw new AppError("التسليم بعد «تم» فقط");
      const open = await tx.coBuildTask.count({ where: { buyerId: b.id, status: "OPEN", kind: { in: ["PAYMENT", "HANDOVER"] } } });
      if (open) throw new AppError(`لا تسليم قبل إغلاق ${open} من الدفعات/بنود التسليم المفتوحة`);
      const claimed = await tx.coBuildBuyer.updateMany({ where: { id: b.id, status: { in: ["ACTIVE", "CONTRACTED"] } }, data: { status: "HANDED_OVER" } });
      if (!claimed.count) throw new AppError("سُلّم مسبقاً أو غير فعّال");
      await tx.coBuildUnit.update({ where: { id: b.unitId }, data: { status: "handed_over" } });
      await logEvent(tx, b.projectId, "HANDOVER", `سُلّم مفتاح الشقة ${b.unit.unitCode} إلى ${b.name}`, actorOf(user), b.id);
      await notice(tx, b.projectId, "مبروك! مفتاح شقتك", `سُلّمت الشقة ${b.unit.unitCode} رسمياً. أهلاً بك في بيتك.`, { buyerId: b.id });
    });
  });
  done(pid);
  return r;
}

export async function syncIncentivesAction(projectId: number) {
  const r = await runVoid(async () => {
    await actionUser(can.coBuildDeals);
    await syncWaitingIncentives(projectId);
  });
  done(projectId);
  return r;
}

/* ═════════════ الإنجاز والمراحل والسجل و«شو عندك» ═════════════ */

export async function saveProgress(projectId: number, _: ActionState, fd: FormData): Promise<ActionState> {
  const r = await run(async () => {
    const user = await actionUser(can.coBuildSite);
    const p = await db.coBuildProject.findUnique({ where: { id: projectId } });
    if (!p) throw new AppError("المشروع غير موجود");
    if (!LAUNCHED.includes(p.status)) throw new AppError("الإنجاز يُسجَّل بعد «تم»");
    const progress = num(fd, "progress", { min: 0, max: 100, label: "نسبة الإنجاز", required: true })!;
    const status = t(fd, "status");
    if (!LAUNCHED.includes(status)) throw new AppError("مرحلة غير صالحة");
    if (status === "handover_completed" && user.role !== "ADMIN") throw new AppError("إغلاق المشروع بالتسليم للإدارة");
    const phaseLabel = t(fd, "phaseLabel", 120) || null;
    await db.coBuildProject.update({ where: { id: projectId }, data: { progress: Math.round(progress), status, phaseLabel } });
    if (Math.round(progress) !== p.progress || status !== p.status) {
      await logEvent(db, projectId, "PROGRESS", `الإنجاز ${p.progress}% ← ${Math.round(progress)}%${phaseLabel ? ` — ${phaseLabel}` : ""}`, actorOf(user));
      await notice(db, projectId, `وين وصل المشروع: ${Math.round(progress)}%`, phaseLabel ? `المرحلة الحالية: ${phaseLabel}` : "تحدّثت نسبة الإنجاز");
    }
    return "حُفظ الإنجاز";
  });
  done(projectId);
  return r;
}

export async function addMilestone(projectId: number, _: ActionState, fd: FormData): Promise<ActionState> {
  const r = await run(async () => {
    await actionUser(can.coBuildSite);
    const title = t(fd, "title", 160);
    if (title.length < 3) throw new AppError("اكتب اسم المرحلة");
    const max = (await db.coBuildMilestone.aggregate({ where: { projectId }, _max: { sortOrder: true } }))._max.sortOrder ?? 0;
    await db.coBuildMilestone.create({ data: { projectId, title, plannedDate: date(fd, "plannedDate"), sortOrder: max + 1 } });
    return "أُضيفت المرحلة";
  });
  done(projectId);
  return r;
}

export async function toggleMilestone(id: number) {
  let pid = 0;
  const r = await runVoid(async () => {
    const user = await actionUser(can.coBuildSite);
    const m = await db.coBuildMilestone.findUnique({ where: { id } });
    if (!m) throw new AppError("غير موجودة");
    pid = m.projectId;
    await db.coBuildMilestone.update({ where: { id }, data: { doneAt: m.doneAt ? null : new Date() } });
    if (!m.doneAt) {
      await logEvent(db, m.projectId, "MILESTONE", `أُنجزت مرحلة: ${m.title}`, actorOf(user));
      await notice(db, m.projectId, `أُنجزت مرحلة: ${m.title}`, "تابع «شو بكرا» لمعرفة المرحلة التالية.", { key: `notice:ms:${m.id}` });
    }
  });
  done(pid);
  return r;
}

export async function deleteMilestone(id: number) {
  let pid = 0;
  const r = await runVoid(async () => {
    await actionUser(can.coBuildSite);
    const m = await db.coBuildMilestone.delete({ where: { id } });
    pid = m.projectId;
  });
  done(pid);
  return r;
}

export async function postUpdate(projectId: number, _: ActionState, fd: FormData): Promise<ActionState> {
  const r = await run(async () => {
    const user = await actionUser(can.coBuildSite);
    const title = t(fd, "title", 160);
    const body = t(fd, "body", 4000);
    if (title.length < 3 || body.length < 5) throw new AppError("اكتب العنوان والتفاصيل");
    const u = await db.coBuildUpdate.create({ data: { projectId, title, body, createdById: user.id, createdBy: user.name } });
    const n = await saveAttachments(fd, "cobuild_update", u.id, user.id);
    await notice(db, projectId, `سجل الموقع: ${title}`, `${body.slice(0, 160)}${n ? ` — ${n} صور/فيديو` : ""}`);
    return `نُشر في سجل المشروع${n ? ` مع ${n} ملفات` : ""}`;
  });
  done(projectId);
  return r;
}

export async function addTask(projectId: number, _: ActionState, fd: FormData): Promise<ActionState> {
  const r = await run(async () => {
    const user = await actionUser(can.coBuildSite);
    const kind = t(fd, "kind");
    if (!TASK_KIND[kind]) throw new AppError("نوع غير صالح");
    if (kind === "PAYMENT" && !can.coBuildDeals(user.role)) throw new AppError("طلبات الدفع للإدارة والمحاسب");
    const title = t(fd, "title", 160);
    if (title.length < 3) throw new AppError("اكتب العنوان");
    const buyerId = Number(t(fd, "buyerId")) || null;
    if (buyerId && !(await db.coBuildBuyer.findFirst({ where: { id: buyerId, projectId } }))) throw new AppError("المشتري ليس من هذا المشروع");
    const amount = num(fd, "amount", { min: 0, max: 10_000_000, label: "المبلغ" });
    const dueDate = date(fd, "dueDate");
    await db.coBuildTask.create({ data: { projectId, buyerId, kind, title, details: t(fd, "details", 1000) || null, amount, dueDate, createdById: user.id } });
    await notice(db, projectId, `شو عندك: ${title}`, `${TASK_KIND[kind]}${amount ? ` — ${amount} د.أ` : ""}${dueDate ? ` — قبل ${dueDate.toISOString().slice(0, 10)}` : ""}`, { buyerId });
    return "أُضيف البند لـ«شو عندك»";
  });
  done(projectId);
  return r;
}

export async function completeTask(id: number) {
  let pid = 0;
  const r = await runVoid(async () => {
    const user = await actionUser(can.coBuildSite);
    const task = await db.coBuildTask.findUnique({ where: { id } });
    if (!task) throw new AppError("غير موجود");
    pid = task.projectId;
    if (task.kind === "PAYMENT" && !can.coBuildDeals(user.role)) throw new AppError("تأكيد الدفعات للإدارة والمحاسب");
    const claimed = await db.coBuildTask.updateMany({ where: { id, status: "OPEN" }, data: { status: "DONE", doneAt: new Date() } });
    if (!claimed.count) throw new AppError("أُغلق مسبقاً");
    await logEvent(db, task.projectId, "TASK", `أُغلق: ${task.title}${task.amount ? ` (${task.amount} د.أ)` : ""}`, actorOf(user), task.buyerId);
  });
  done(pid);
  return r;
}

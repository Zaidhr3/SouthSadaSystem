"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { actionUser } from "@/lib/auth";
import { auditEvent, run, runVoid, type ActionState } from "@/lib/action";
import { AppError, can, type AppUser } from "@/lib/permissions";
import { computePayroll, periodLabel, totals, ADJ_TYPE, EMP_CATEGORY, PAY_METHOD_PR } from "@/lib/payroll";
import { upsertLinkedBankTx } from "@/lib/finance";
import { createMotion } from "@/lib/board/motions";
import { todayUTC } from "@/lib/format";

const t = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const n = (fd: FormData, k: string) => {
  const s = t(fd, k).replace(/,/g, "");
  if (!s) return null;
  const v = Number(s);
  if (!Number.isFinite(v) || v < 0) throw new AppError("قيمة رقمية غير صالحة");
  return v;
};
const d = (fd: FormData, k: string) => (t(fd, k) ? new Date(`${t(fd, k)}T00:00:00Z`) : null);
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const done = () => {
  revalidatePath("/payroll");
};

/* ───────────── الموظفون والعمال ───────────── */
export async function saveEmployee(id: number | null, _: ActionState, fd: FormData): Promise<ActionState> {
  const r = await run(async () => {
    const user = await actionUser(can.managePayroll);
    const name = t(fd, "name");
    if (name.length < 3) throw new AppError("اكتب الاسم الكامل");
    const payType = t(fd, "payType") === "DAILY" ? "DAILY" : "MONTHLY";
    const category = t(fd, "category") in EMP_CATEGORY ? t(fd, "category") : "OTHER";
    const dailyRate = n(fd, "dailyRate");
    const monthlySalary = n(fd, "monthlySalary");
    if (payType === "DAILY" && !dailyRate) throw new AppError("أدخل الأجر اليومي لعامل المياومة");
    if (payType === "MONTHLY" && !monthlySalary) throw new AppError("أدخل الراتب الشهري");
    const data = {
      name, payType, category,
      nationalId: t(fd, "nationalId") || null,
      phone: t(fd, "phone") || null,
      jobTitle: t(fd, "jobTitle") || null,
      dailyRate: payType === "DAILY" ? dailyRate : null,
      monthlySalary: payType === "MONTHLY" ? monthlySalary : null,
      allowances: payType === "MONTHLY" ? n(fd, "allowances") ?? 0 : 0,
      socialSecurity: fd.get("socialSecurity") === "on",
      payMethod: t(fd, "payMethod") in PAY_METHOD_PR ? t(fd, "payMethod") : "CASH",
      iban: t(fd, "iban") || null,
      tenderId: Number(t(fd, "tenderId")) || null,
      userId: Number(t(fd, "userId")) || null,
      startDate: d(fd, "startDate"),
      endDate: d(fd, "endDate"),
      notes: t(fd, "notes") || null,
    };
    if (id) await db.employee.update({ where: { id }, data });
    else await db.employee.create({ data });
    await auditEvent(id ? "UPDATE" : "CREATE", "Employee", `${id ? "تعديل" : "إضافة"} ملف ${name} (${data.payType === "DAILY" ? `${dailyRate} د.أ يومياً` : `${monthlySalary} د.أ شهرياً`})`, user, { recordId: id });
    return id ? "حُفظ الملف" : `أُضيف ${name}`;
  });
  done();
  return r;
}

export async function toggleEmployee(id: number) {
  const r = await runVoid(async () => {
    await actionUser(can.managePayroll);
    const e = await db.employee.findUnique({ where: { id } });
    if (!e) throw new AppError("غير موجود");
    await db.employee.update({ where: { id }, data: { active: !e.active, endDate: e.active ? todayUTC() : null } });
  });
  done();
  return r;
}

/* ───────────── يوميات الحضور (عمال المياومة) ───────────── */
async function assertSite(user: AppUser, tenderId: number | null) {
  if (can.managePayroll(user.role)) return;
  if (user.role !== "PM") throw new AppError("ليست لديك صلاحية");
  if (!tenderId) throw new AppError("اختر المشروع");
  const tn = await db.tender.findUnique({ where: { id: tenderId }, select: { managerId: true } });
  if (tn?.managerId !== user.id) throw new AppError("تسجّل يوميات عمال مشاريعك المسندة فقط");
}

export async function recordDays(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = await run(async () => {
    const user = await actionUser();
    const date = d(fd, "date");
    if (!date) throw new AppError("اختر التاريخ");
    if (date > new Date(Date.now() + 86400000)) throw new AppError("لا يمكن تسجيل يومية لتاريخ قادم");
    const tenderId = Number(t(fd, "tenderId")) || null;
    await assertSite(user, tenderId);
    const ids = fd.getAll("employeeIds").map(Number).filter((x) => x > 0);
    if (!ids.length) throw new AppError("اختر العمال الحاضرين");
    const days = Math.min(1.5, Math.max(0, Number(t(fd, "days") || 1)));
    const overtimeHours = Math.min(12, n(fd, "overtimeHours") ?? 0);
    const workers = await db.employee.findMany({ where: { id: { in: ids }, payType: "DAILY", active: true }, select: { id: true } });
    for (const w of workers) {
      await db.workDay.upsert({
        where: { employeeId_date: { employeeId: w.id, date } },
        create: { employeeId: w.id, date, days, overtimeHours, tenderId, note: t(fd, "note") || null, recordedById: user.id },
        update: { days, overtimeHours, tenderId, note: t(fd, "note") || null, recordedById: user.id },
      });
    }
    return `سُجلت يومية ${workers.length} عامل بتاريخ ${date.toISOString().slice(0, 10)}`;
  });
  done();
  return r;
}

export async function deleteWorkDay(id: number) {
  const r = await runVoid(async () => {
    const user = await actionUser();
    const w = await db.workDay.findUnique({ where: { id } });
    if (!w) return;
    await assertSite(user, w.tenderId);
    const locked = await db.payrollRun.findFirst({ where: { period: w.date.toISOString().slice(0, 7), status: { in: ["APPROVED", "PAID", "SUBMITTED"] } } });
    if (locked) throw new AppError("مسير هذا الشهر معتمد أو أمام المجلس — لا يمكن تعديل يومياته");
    await db.workDay.delete({ where: { id } });
  });
  done();
  return r;
}

/* ───────────── السلف والخصومات والمكافآت ───────────── */
export async function addAdjustment(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = await run(async () => {
    const user = await actionUser(can.managePayroll);
    const employeeId = Number(t(fd, "employeeId"));
    const type = t(fd, "type");
    const period = t(fd, "period");
    const amount = n(fd, "amount");
    if (!employeeId) throw new AppError("اختر الموظف");
    if (!(type in ADJ_TYPE)) throw new AppError("اختر النوع");
    if (!PERIOD.test(period)) throw new AppError("اختر شهر الاحتساب");
    if (!amount) throw new AppError("أدخل المبلغ");
    const locked = await db.payrollRun.findFirst({ where: { period, status: { in: ["APPROVED", "PAID", "SUBMITTED"] } } });
    if (locked) throw new AppError(`مسير ${periodLabel(period)} مقفل — اختر الشهر التالي`);
    const e = await db.employee.findUnique({ where: { id: employeeId }, select: { name: true } });
    await db.payAdjustment.create({ data: { employeeId, type, period, amount, note: t(fd, "note") || null, createdById: user.id } });
    await auditEvent("CREATE", "PayAdjustment", `${ADJ_TYPE[type].label} ${amount} د.أ لـ ${e?.name} (${period})`, user);
    return `سُجلت ${ADJ_TYPE[type].label} لـ ${e?.name}`;
  });
  done();
  return r;
}

export async function deleteAdjustment(id: number) {
  const r = await runVoid(async () => {
    await actionUser(can.managePayroll);
    const a = await db.payAdjustment.findUnique({ where: { id } });
    if (!a) return;
    const locked = await db.payrollRun.findFirst({ where: { period: a.period, status: { in: ["APPROVED", "PAID", "SUBMITTED"] } } });
    if (locked) throw new AppError("المسير مقفل");
    await db.payAdjustment.delete({ where: { id } });
  });
  done();
  return r;
}

/* ───────────── مسيرات الرواتب ───────────── */
/** إعداد (أو إعادة احتساب) مسير شهر — مسودة */
export async function buildRun(_: ActionState, fd: FormData): Promise<ActionState> {
  let id = 0;
  const r = await run(async () => {
    const user = await actionUser(can.managePayroll);
    const period = t(fd, "period");
    if (!PERIOD.test(period)) throw new AppError("اختر الشهر");
    const existing = await db.payrollRun.findUnique({ where: { period } });
    if (existing && existing.status !== "DRAFT") throw new AppError(`مسير ${periodLabel(period)} ${existing.status === "PAID" ? "مصروف" : "أمام المجلس أو معتمد"} — لا يُعاد احتسابه`);
    const lines = await computePayroll(period);
    if (!lines.length) throw new AppError("لا يوجد موظفون أو يوميات لهذا الشهر");
    const tt = totals(lines);
    const runRow = existing
      ? await db.payrollRun.update({ where: { id: existing.id }, data: { gross: tt.gross, net: tt.net, employerSS: tt.employerSS, note: null } })
      : await db.payrollRun.create({ data: { period, gross: tt.gross, net: tt.net, employerSS: tt.employerSS, createdById: user.id } });
    await db.payrollLine.deleteMany({ where: { runId: runRow.id } });
    await db.payrollLine.createMany({ data: lines.map((l) => ({ ...l, runId: runRow.id })) });
    id = runRow.id;
    return `أُعدّ مسير ${periodLabel(period)}: ${lines.length} موظفاً — الصافي ${tt.net.toLocaleString("en-US")} د.أ`;
  });
  done();
  if (r.ok && id) redirect(`/payroll/runs/${id}`);
  return r;
}

/** المحاسب: رفع المسير لمجلس الإدارة (مدقق ضمناً لأنه من إعداده) */
export async function submitRun(id: number, _: ActionState, __: FormData): Promise<ActionState> {
  const r = await run(async () => {
    const user = await actionUser(can.managePayroll);
    const rr = await db.payrollRun.findUnique({ where: { id }, include: { _count: { select: { lines: true } } } });
    if (!rr || rr.status !== "DRAFT") throw new AppError("المسير ليس مسودة");
    const lines = await db.payrollLine.findMany({ where: { runId: id } });
    const tt = totals(lines);
    await db.payrollRun.update({ where: { id }, data: { status: "SUBMITTED" } });
    const m = await createMotion(
      {
        kind: "PAYROLL",
        refId: id,
        audited: true,
        amount: tt.net,
        title: `مسير رواتب ${periodLabel(rr.period)} — ${rr._count.lines} موظفاً`,
        details: `إجمالي الرواتب والأجور: ${tt.gross.toLocaleString("en-US")} د.أ\nالصافي المستحق للموظفين: ${tt.net.toLocaleString("en-US")} د.أ (نقداً ${tt.cash.toLocaleString("en-US")} — تحويل ${tt.bank.toLocaleString("en-US")})\nحصة الشركة من الضمان: ${tt.employerSS.toLocaleString("en-US")} د.أ\nالكلفة الكلية على الشركة: ${tt.cost.toLocaleString("en-US")} د.أ`,
      },
      user,
    );
    await db.boardMotion.update({ where: { id: m.id }, data: { auditNote: `أعدّه ودققه ${user.name} — المسير التفصيلي: /payroll/runs/${id}` } });
    return `رُفع المسير لمجلس الإدارة (${m.ref})`;
  });
  done();
  revalidatePath(`/payroll/runs/${id}`);
  return r;
}

/** صرف المسير المعتمد: كل الأسطر تُعلَّم مصروفة، والتحويلات البنكية تُقيَّد على الحساب البنكي */
export async function payRun(id: number, _: ActionState, fd: FormData): Promise<ActionState> {
  const r = await run(async () => {
    const user = await actionUser(can.managePayroll);
    const rr = await db.payrollRun.findUnique({ where: { id } });
    if (!rr || rr.status !== "APPROVED") throw new AppError("المسير غير معتمد من مجلس الإدارة بعد");
    const date = d(fd, "date") ?? todayUTC();
    const lines = await db.payrollLine.findMany({ where: { runId: id } });
    const tt = totals(lines);
    await db.$transaction(async (tx) => {
      const claimed = await tx.payrollRun.updateMany({ where: { id, status: "APPROVED" }, data: { status: "PAID", paidAt: date } });
      if (!claimed.count) throw new AppError("صُرف هذا المسير مسبقاً");
      await tx.payrollLine.updateMany({ where: { runId: id }, data: { paid: true, paidAt: date } });
      await upsertLinkedBankTx(tx, "PAYROLL", id, { date, type: "OUT", amount: tt.bank + (fd.get("ssFromBank") === "on" ? tt.employerSS + lines.reduce((s, l) => s + l.ssEmployee, 0) : 0), description: `رواتب ${periodLabel(rr.period)} — تحويلات${fd.get("ssFromBank") === "on" ? " + اشتراكات الضمان" : ""}` });
    });
    await auditEvent("PAY", "PayrollRun", `صرف مسير ${rr.period}: صافي ${tt.net} د.أ`, user, { recordId: id });
    return `صُرف المسير — التحويلات ${tt.bank.toLocaleString("en-US")} د.أ قُيّدت على الحساب البنكي، والنقدي ${tt.cash.toLocaleString("en-US")} د.أ`;
  });
  done();
  revalidatePath(`/payroll/runs/${id}`);
  return r;
}

export async function deleteRun(id: number) {
  const r = await runVoid(async () => {
    await actionUser(can.managePayroll);
    const rr = await db.payrollRun.findUnique({ where: { id } });
    if (!rr || rr.status !== "DRAFT") throw new AppError("يُحذف المسير وهو مسودة فقط");
    await db.payrollRun.delete({ where: { id } });
  });
  done();
  return r;
}

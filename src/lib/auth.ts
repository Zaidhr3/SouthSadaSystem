import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db } from "./db";
import { SESSION_COOKIE, verifySession } from "./session";
import { AppError, isReadOnly, type AppUser, type Role } from "./permissions";
import { requestContext } from "./context";
import { assertNotLocked } from "./archive";

/** المستخدم الحالي (مرة واحدة لكل طلب) - يُقرأ الدور من قاعدة البيانات دائماً */
export const getCurrentUser = cache(async (): Promise<AppUser | null> => {
  const session = await verifySession(cookies().get(SESSION_COOKIE)?.value);
  if (!session) return null;
  // المستخدم والتفويض النافذ يُقرآن معاً (استعلام واحد ذهاباً وإياباً بدل اثنين متتاليين في كل صفحة)
  const now = new Date();
  const [user, del] = await Promise.all([
    db.user.findUnique({
      where: { id: session.uid },
      select: { id: true, name: true, username: true, role: true, title: true, active: true },
    }),
    db.delegation.findFirst({ where: { toUserId: session.uid, revokedAt: null, startsAt: { lte: now }, endsAt: { gte: now } }, orderBy: { createdAt: "desc" } }),
  ]);
  if (!user || !user.active) return null;
  const base: AppUser = { id: user.id, name: user.name, username: user.username, role: user.role as Role, title: user.title, baseRole: user.role as Role };
  // التفويض المؤقت النافذ: يعمل بصلاحيات المفوِّض ويُوثَّق اسمه «نيابة عن» في كل السجلات
  if (!del) return base;
  const from = await db.user.findUnique({ where: { id: del.fromUserId }, select: { name: true, role: true } });
  if (!from) return base;
  return { ...base, role: del.role as Role, name: `${user.name} (نيابة عن ${from.name})`, actingFor: { name: from.name, role: from.role as Role, until: del.endsAt } };
});

/** هل الجلسة الحالية لمستخدم أُوقف أثناء عمله؟ (لإظهار رسالة الإيقاف بدل صفحة دخول عادية) */
async function isSuspendedSession() {
  const session = await verifySession(cookies().get(SESSION_COOKIE)?.value);
  if (!session) return false;
  const u = await db.user.findUnique({ where: { id: session.uid }, select: { active: true } });
  return !!u && !u.active;
}

/** للصفحات: يعيد التوجيه لتسجيل الدخول أو للرئيسية عند عدم الصلاحية */
export async function requireUser(check?: (r: Role) => boolean): Promise<AppUser> {
  const user = await getCurrentUser();
  if (!user) redirect((await isSuspendedSession()) ? "/login?suspended=1" : "/login");
  if (check && !check(user.role)) redirect("/");
  return user;
}

/**
 * للإجراءات (server actions): يرمي خطأ يُعرض للمستخدم.
 * أدوار الاطلاع فقط (المشرف الأعلى، المراقب) محظورة من كل إجراء كتابة على الخادم،
 * إلا ما يُعلَّم صراحة بـ readOnlyOk (كلمة المرور الشخصية، إخفاء الإشعارات، تأكيد التعميم، المراسلة).
 */
export async function actionUser(check?: (r: Role) => boolean, opts?: { readOnlyOk?: boolean }): Promise<AppUser> {
  const user = await getCurrentUser();
  if (!user) throw new AppError("انتهت الجلسة أو أُوقف الحساب، يرجى تسجيل الدخول مجدداً");
  const ctx = requestContext.getStore();
  if (ctx) {
    ctx.userId = user.id;
    ctx.userName = user.name;
    ctx.userRole = user.role;
  }
  if (isReadOnly(user.role) && !opts?.readOnlyOk) throw new AppError("حسابك للاطلاع فقط — لا يمكنك إنشاء أو تعديل أو حذف أي بيانات");
  if (check && !check(user.role)) throw new AppError("ليست لديك صلاحية لتنفيذ هذا الإجراء");
  return user;
}

/** التحقق من صلاحية الوصول لعطاء/مشروع معين */
export async function assertTenderAccess(user: AppUser, tenderId: number, opts?: { allowLocked?: boolean }) {
  const tender = await db.tender.findUnique({ where: { id: tenderId }, select: { id: true, managerId: true } });
  if (!tender) throw new AppError("العطاء غير موجود");
  if (user.role === "PM" && tender.managerId !== user.id) throw new AppError("هذا المشروع غير مسند إليك");
  // الأرشيف النهائي مقفل لكل عمليات الكتابة إلا للمدير العام
  if (!opts?.allowLocked) await assertNotLocked(user, tenderId);
  return tender;
}

import {
  Bell,
  Bot,
  Briefcase,
  ClipboardCheck,
  ClipboardList,
  FileSpreadsheet,
  FolderArchive,
  GitPullRequestArrow,
  HandCoins,
  HardHat,
  Images,
  Inbox,
  Landmark,
  LayoutDashboard,
  Library,
  Mail,
  Megaphone,
  MessagesSquare,
  NotebookTabs,
  PackageCheck,
  Percent,
  Receipt,
  ReceiptText,
  Scale,
  ScrollText,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  TrendingUp,
  Truck,
  Users,
  Wallet,
  Gavel,
  Share2,
  BadgeDollarSign,
  Wand2,
  Building,
  type LucideIcon,
} from "lucide-react";

export type Role = "ADMIN" | "ACCOUNTANT" | "PM" | "CHAIRMAN" | "AUDITOR";
export type NavItem = { href: string; label: string; icon: LucideIcon; roles?: Role[]; pmLabel?: string; keywords?: string; tint: string };
export type NavGroup = { id: string; section: string; items: NavItem[] };

const FIN: Role[] = ["ADMIN", "ACCOUNTANT", "CHAIRMAN", "AUDITOR"];
const MGMT: Role[] = ["ADMIN", "CHAIRMAN"];

/** خريطة النظام — مرتبة حسب دورة العمل: القرار ← العطاء ← التنفيذ ← المال ← السوق ← الإدارة */
export const NAV: NavGroup[] = [
  {
    id: "home",
    section: "",
    items: [
      { href: "/", label: "لوحة التحكم", icon: LayoutDashboard, tint: "#f2b134", keywords: "الرئيسية dashboard home" },
      { href: "/board", label: "مجلس الإدارة", icon: Gavel, roles: FIN, tint: "#f2b134", keywords: "تصويت موافقات قرارات roast نقد" },
      { href: "/assistant", label: "المساعد الذكي", icon: Bot, roles: MGMT, tint: "#a78bfa", keywords: "ai ذكاء اصطناعي" },
      { href: "/messages", label: "المراسلات الداخلية", icon: MessagesSquare, tint: "#38bdf8", keywords: "رسائل بريد" },
      { href: "/notifications", label: "التنبيهات", icon: Bell, tint: "#f87171" },
    ],
  },
  {
    id: "tenders",
    section: "العطاءات والتسعير",
    items: [
      { href: "/tenders", label: "العطاءات والمشاريع", pmLabel: "مشاريعي", icon: Briefcase, tint: "#60a5fa", keywords: "مشروع عطاء" },
      { href: "/cobuild", label: "السكن التشاركي", icon: Building, tint: "#f59e0b", keywords: "عظم مفتاح شقق مشترين شيك مصدق تم كتالوج تشطيب حوافز جيب جارك cobuild" },
      { href: "/quotes", label: "طلبات التسعير من الموقع", icon: Inbox, tint: "#34d399", keywords: "عرض سعر rfq عملاء" },
      { href: "/pricing", label: "مكتبة الأسعار الذكية", icon: Library, tint: "#fbbf24", keywords: "أسعار جدول كميات boq مواصفات" },
      { href: "/variations", label: "أوامر التغيير", icon: GitPullRequestArrow, tint: "#c084fc" },
    ],
  },
  {
    id: "site",
    section: "التنفيذ والمواقع",
    items: [
      { href: "/diary", label: "اليومية الموقعية", icon: ClipboardList, tint: "#4ade80" },
      { href: "/photos", label: "خزنة صور المواقع", icon: Images, tint: "#f472b6" },
      { href: "/subcontractors", label: "مقاولو الباطن", icon: HardHat, tint: "#fb923c" },
      { href: "/materials", label: "المستودعات والمواد", icon: PackageCheck, tint: "#a3e635" },
      { href: "/fleet", label: "الآليات والمعدات", icon: Truck, tint: "#facc15" },
      { href: "/correspondence", label: "الصادر والوارد", icon: Mail, tint: "#93c5fd", keywords: "كتب رسمية" },
    ],
  },
  {
    id: "finance",
    section: "المالية",
    items: [
      { href: "/claims", label: "المطالبات والفواتير", icon: Receipt, tint: "#34d399", keywords: "مستخلص فاتورة" },
      { href: "/payroll", label: "الرواتب والأجور", pmLabel: "يوميات العمال", icon: BadgeDollarSign, tint: "#4ade80", keywords: "رواتب أجور عمال يومية مياومة سلف ضمان موظفين" },
      { href: "/expenses", label: "المصاريف", icon: Wallet, tint: "#fb7185" },
      { href: "/requests", label: "طلبات المواد والعهد", icon: ClipboardCheck, tint: "#fcd34d" },
      { href: "/funds", label: "التمويل والعهد", icon: HandCoins, tint: "#fdba74" },
      { href: "/guarantees", label: "الكفالات", icon: ShieldCheck, roles: FIN, tint: "#818cf8" },
      { href: "/cheques", label: "دفتر الشيكات", icon: NotebookTabs, roles: FIN, tint: "#67e8f9" },
      { href: "/debts", label: "الديون والقروض", icon: Scale, roles: FIN, tint: "#f87171" },
      { href: "/taxes", label: "الضريبة", icon: Percent, roles: FIN, tint: "#a5b4fc" },
      { href: "/einvoices", label: "فواتير نظام الفوترة", icon: ReceiptText, roles: FIN, tint: "#5eead4", keywords: "jofotara" },
      { href: "/bank", label: "الحساب البنكي", icon: Landmark, roles: MGMT, tint: "#fbbf24" },
      { href: "/cashflow", label: "التدفق النقدي المتوقع", icon: TrendingUp, roles: MGMT, tint: "#4ade80" },
      { href: "/reports", label: "التقارير والتصدير", icon: FileSpreadsheet, roles: FIN, tint: "#86efac", keywords: "excel تقرير" },
    ],
  },
  {
    id: "market",
    section: "التسويق والعلاقات العامة",
    items: [
      { href: "/marketing/studio", label: "استوديو الصور الذكي", icon: Wand2, roles: MGMT, tint: "#fbbf24", keywords: "صورة تصميم جمعة مباركة تهنئة ذكاء اصطناعي" },
      { href: "/marketing", label: "استوديو التسويق", icon: Megaphone, roles: MGMT, tint: "#f472b6", keywords: "منشور ستوري تصميم canva" },
      { href: "/marketing/accounts", label: "حساباتي والإعلانات", icon: Share2, roles: MGMT, tint: "#60a5fa", keywords: "فيسبوك انستغرام ممول جمهور" },
    ],
  },
  {
    id: "admin",
    section: "الإدارة والنظام",
    items: [
      { href: "/documents", label: "أوراق الشركة", icon: FolderArchive, roles: FIN, tint: "#fcd34d" },
      { href: "/users", label: "المستخدمون", icon: Users, roles: ["ADMIN"], tint: "#93c5fd" },
      { href: "/audit", label: "سجل الرقابة والتدقيق", icon: ScrollText, roles: ["ADMIN", "CHAIRMAN", "AUDITOR"], tint: "#cbd5e1" },
      { href: "/system", label: "إعدادات النظام", icon: SlidersHorizontal, roles: ["ADMIN"], tint: "#94a3b8" },
      { href: "/settings", label: "حسابي", icon: Settings, tint: "#e2e8f0" },
    ],
  },
];

export function navFor(role: Role, bankVisible?: boolean): NavGroup[] {
  return NAV.map((g) => ({
    ...g,
    items: g.items.filter((i) => (i.href === "/bank" || i.href === "/cashflow" ? !!bankVisible : !i.roles || i.roles.includes(role))),
  })).filter((g) => g.items.length > 0);
}

export function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  if (href === "/marketing") return pathname === "/marketing" || (pathname.startsWith("/marketing/") && !pathname.startsWith("/marketing/accounts") && !pathname.startsWith("/marketing/studio"));
  return pathname === href || pathname.startsWith(href + "/");
}

/** عنوان الصفحة الحالية (لشريط الرأس) */
export function currentItem(pathname: string): NavItem | undefined {
  let best: NavItem | undefined;
  for (const g of NAV) for (const i of g.items) if (isActive(pathname, i.href) && (!best || i.href.length > best.href.length)) best = i;
  return best;
}

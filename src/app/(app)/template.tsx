import { PageTransition } from "@/components/page-transition";

/** يُعاد تركيبه مع كل تنقل — حركة iOS: دفع للصفحة الأعمق، رجوع للأعلى، وتلاشٍ ناعم بين الأقسام */
export default function Template({ children }: { children: React.ReactNode }) {
  return <PageTransition>{children}</PageTransition>;
}

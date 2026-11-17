import type { Metadata, Viewport } from "next";
import "@fontsource/cairo/400.css";
import "@fontsource/cairo/500.css";
import "@fontsource/cairo/600.css";
import "@fontsource/cairo/700.css";
import "./globals.css";
import { ToastProvider } from "@/components/toast";
import { PwaRegister } from "@/components/pwa";

export const metadata: Metadata = {
  title: { default: "صدى الجنوب للمقاولات", template: "%s · صدى الجنوب" },
  description: "نظام الإدارة المتكامل لشركة صدى الجنوب للمقاولات الإنشائية",
  applicationName: "صدى الجنوب",
  // iOS: يُفتح كتطبيق مستقل بأيقونة الشعار واسم واضح بدل الحرف الأول
  appleWebApp: { capable: true, title: "صدى الجنوب", statusBarStyle: "default" },
  icons: {
    icon: [{ url: "/icons/favicon-48.png", sizes: "48x48", type: "image/png" }],
    apple: [
      { url: "/apple-icon.png", sizes: "180x180" },
      { url: "/icons/apple-icon-167.png", sizes: "167x167" },
      { url: "/icons/apple-icon-152.png", sizes: "152x152" },
    ],
  },
  formatDetection: { telephone: false, email: false, address: false },
  other: { "mobile-web-app-capable": "yes" },
};

export const viewport: Viewport = { themeColor: "#ffffff", width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body className="min-h-screen font-sans">
        <ToastProvider>{children}</ToastProvider>
        <PwaRegister />
      </body>
    </html>
  );
}

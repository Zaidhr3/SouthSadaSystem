import type { MetadataRoute } from "next";

/** تثبيت النظام كتطبيق على الهاتف (أندرويد و iOS) بأيقونة شعار الشركة */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "صدى الجنوب للمقاولات",
    short_name: "صدى الجنوب",
    description: "نظام الإدارة المتكامل لشركة صدى الجنوب للمقاولات الإنشائية",
    lang: "ar",
    dir: "rtl",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f5f5f7",
    theme_color: "#ffffff",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "مصروف جديد", url: "/expenses/new", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "المراسلات", url: "/messages", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}

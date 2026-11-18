import path from "path";

/**
 * نوع المحتوى يُشتق من الامتداد المسموح فقط — لا يُوثق أبداً بالنوع الذي يرسله المتصفح.
 * (ثغرة F1: ملف x.png بنوع image/svg+xml كان يُحفظ ويُعرض كـ SVG فيُنفَّذ سكربت بجلسة الموظف)
 */
const MIME_BY_EXT: Record<string, string> = {
  ".pdf": "application/pdf",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".heic": "image/heic",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".dwg": "application/acad",
  ".zip": "application/zip",
  ".mp3": "audio/mpeg",
};
export function mimeFor(fileName: string) {
  return MIME_BY_EXT[path.extname(fileName).toLowerCase()] ?? "application/octet-stream";
}

/** ما يُعرض داخل المتصفح (inline): صور نقطية وPDF فقط — لا شيء يمكنه تنفيذ سكربت */
const INLINE_SAFE = new Set(["image/png", "image/jpeg", "image/webp", "application/pdf"]);

/**
 * رؤوس الرد الآمنة لتقديم أي مرفق (للموظفين وبوابة العملاء):
 * النوع من الامتداد (يعالج السجلات القديمة المحفوظة بنوع مزوّر أيضاً)، nosniff، و CSP sandbox لغير PDF.
 */
export function attachmentHeaders(att: { fileName: string; storedName?: string | null }, extra: Record<string, string> = {}) {
  let type = mimeFor(att.fileName);
  if (type === "application/octet-stream" && att.storedName) type = mimeFor(att.storedName);
  const inline = INLINE_SAFE.has(type);
  const headers: Record<string, string> = {
    "Content-Type": type,
    "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(att.fileName)}`,
    "X-Content-Type-Options": "nosniff",
    ...extra,
  };
  // عارض PDF في Chrome لا يعمل داخل sandbox، وPDF لا يصل لصفحة النظام أصلاً؛ غيره يُعزل بالكامل
  if (type !== "application/pdf") headers["Content-Security-Policy"] = "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox";
  return headers;
}

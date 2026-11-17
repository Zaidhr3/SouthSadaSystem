"use client";

import { createUploadTickets } from "@/app/(app)/actions/upload";

/**
 * الرفع المباشر من المتصفح إلى Supabase Storage (يتجاوز حد Vercel 4.5 ميغابايت للطلب).
 * يعيد رموز التذاكر فقط — تُرسل مع النموذج في الحقل <name>__staged بدل الملف نفسه.
 */
export const DIRECT_UPLOAD = process.env.NEXT_PUBLIC_DIRECT_UPLOAD === "1" && !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
/** ما فوق هذا الحجم (مجموع النموذج) يُرفع مباشرة — حد الطلب العادي */
export const INLINE_MAX_MB = Number(process.env.NEXT_PUBLIC_MAX_UPLOAD_MB || 20);
export const STAGED_MAX_MB = Number(process.env.NEXT_PUBLIC_MAX_STAGED_MB || 20);
export const MAX_FILE_MB = DIRECT_UPLOAD ? Math.max(STAGED_MAX_MB, INLINE_MAX_MB) : INLINE_MAX_MB;

export type StagedRef = { token: string; name: string; size: number };

function put(url: string, file: File, onProgress: (loaded: number) => void) {
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.setRequestHeader("apikey", key);
    xhr.setRequestHeader("Authorization", `Bearer ${key}`);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.setRequestHeader("x-upsert", "false");
    xhr.setRequestHeader("cache-control", "no-store");
    xhr.upload.onprogress = (e) => {
      onProgress(e.loaded);
      window.dispatchEvent(new Event("ssc-busy"));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      let msg = `HTTP ${xhr.status}`;
      try {
        const j = JSON.parse(xhr.responseText) as { message?: string; error?: string };
        msg = j.message || j.error || msg;
      } catch {
        /* نص غير JSON */
      }
      reject(new Error(/exceeded|too large|413/i.test(msg) ? `الملف «${file.name}» أكبر من الحد المسموح` : `تعذر رفع «${file.name}»: ${msg}`));
    };
    xhr.onerror = () => reject(new Error(`انقطع الاتصال أثناء رفع «${file.name}» — تحقق من الشبكة وأعد المحاولة`));
    xhr.ontimeout = () => reject(new Error(`انتهت مهلة رفع «${file.name}»`));
    xhr.timeout = 10 * 60 * 1000;
    xhr.send(file);
  });
}

/** يرفع الملفات بالتوازي ويبلّغ بنسبة التقدم الإجمالية (0–100) */
export async function uploadDirect(files: File[], onProgress?: (pct: number) => void, purpose?: string): Promise<StagedRef[]> {
  const big = files.find((f) => f.size > STAGED_MAX_MB * 1024 * 1024);
  if (big) throw new Error(`حجم الملف «${big.name}» يتجاوز ${STAGED_MAX_MB} ميغابايت`);
  const r = await createUploadTickets(files.map((f) => ({ name: f.name, size: f.size, type: f.type })), purpose);
  if (!r.ok) throw new Error(r.error);
  const total = files.reduce((s, f) => s + f.size, 0) || 1;
  const loaded = files.map(() => 0);
  const report = () => onProgress?.(Math.min(100, Math.round((loaded.reduce((s, n) => s + n, 0) / total) * 100)));
  await Promise.all(
    files.map((f, i) =>
      put(r.tickets[i].uploadUrl, f, (n) => {
        loaded[i] = n;
        report();
      }),
    ),
  );
  onProgress?.(100);
  return files.map((f, i) => ({ token: r.tickets[i].token, name: f.name, size: f.size }));
}

"use server";

import { actionUser } from "@/lib/auth";
import { createTickets, type Ticket, type TicketRequest } from "@/lib/storage";

export type TicketResult = { ok: true; tickets: Ticket[] } | { ok: false; error: string };

/** إصدار تذاكر الرفع المباشر إلى Supabase Storage — الطلب يحمل أسماء الملفات وأحجامها فقط (لا محتوى) */
export async function createUploadTickets(files: TicketRequest[], purpose?: string): Promise<TicketResult> {
  try {
    // المشرف الأعلى يرفق صور الشيكات عند الموافقة — والحفظ الفعلي يتحقق من الصلاحية في كل إجراء
    const user = await actionUser(undefined, { readOnlyOk: true });
    const list = (Array.isArray(files) ? files : []).slice(0, 10).map((f) => ({ name: String(f?.name ?? ""), size: Number(f?.size ?? 0), type: String(f?.type ?? "") }));
    return { ok: true, tickets: await createTickets(user.id, list, purpose ? String(purpose).slice(0, 40) : null) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "تعذر تجهيز الرفع" };
  }
}

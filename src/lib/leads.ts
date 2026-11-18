import "server-only";
import { db } from "./db";
import { callMeta, getMetaConfig, metaCan } from "./meta";
import { normalizePhone, pickPm } from "./quotes";
import { notify } from "./notify";

/**
 * عملاء نماذج إعلانات فيسبوك/إنستغرام (leads_retrieval) ← طلبات تسعير تلقائياً.
 * كل عميل يُسجَّل مرة واحدة (الرقم المرجعي LEAD-<المعرف>) ويُوجَّه لمدير المشروع الأقل انشغالاً.
 */
type Lead = { id: string; created_time: string; form_id?: string; field_data: { name: string; values: string[] }[] };

const pick = (f: Lead["field_data"], ...keys: string[]) => f.find((x) => keys.some((k) => x.name.toLowerCase().includes(k)))?.values?.[0]?.trim() || "";

export async function syncLeads() {
  if (!(await metaCan("leads"))) return { skipped: "leads_retrieval غير ممنوحة" };
  const cfg = await getMetaConfig();
  if (!cfg) return { skipped: "غير مربوط" };
  const forms = await callMeta<{ data: { id: string; name: string; status?: string }[] }>("GET", `${cfg.pageId}/leadgen_forms`, { fields: "id,name,status", limit: "50" });
  const since = Math.floor((Date.now() - 14 * 86400_000) / 1000);
  let created = 0;
  for (const f of forms.data ?? []) {
    const leads = await callMeta<{ data: Lead[] }>("GET", `${f.id}/leads`, { fields: "id,created_time,field_data", limit: "100", filtering: JSON.stringify([{ field: "time_created", operator: "GREATER_THAN", value: since }]) }).catch(() => ({ data: [] as Lead[] }));
    for (const l of leads.data) {
      const ref = `LEAD-${l.id}`.slice(0, 60);
      if (await db.quoteRequest.findUnique({ where: { ref }, select: { id: true } })) continue;
      const fd = l.field_data ?? [];
      const name = pick(fd, "full_name", "name", "الاسم") || "عميل إعلان";
      const phone = normalizePhone(pick(fd, "phone", "هاتف", "رقم") || "—");
      const others = fd.filter((x) => !/full_name|phone|email/i.test(x.name)).map((x) => `${x.name}: ${x.values.join("، ")}`).join("\n");
      const q = await db.quoteRequest.create({
        data: {
          ref,
          name: name.slice(0, 120),
          phone: phone.slice(0, 30),
          email: pick(fd, "email", "بريد") || null,
          projectType: (pick(fd, "project", "نوع", "service", "خدمة") || f.name).slice(0, 120),
          city: pick(fd, "city", "مدينة", "محافظة", "الموقع") || null,
          details: `من نموذج إعلان «${f.name}»${others ? `\n${others}` : ""}`.slice(0, 4000),
          source: "FB_LEAD",
          status: "PM_REVIEW",
          assignedPmId: await pickPm(),
          createdAt: new Date(l.created_time),
          events: { create: { action: "RECEIVED", note: `عميل من نموذج إعلان «${f.name}»` } },
        },
      });
      const pms = await db.user.findMany({ where: { role: "PM", active: true }, select: { id: true } });
      await notify([...pms.map((p) => p.id), "ADMIN"], { title: `عميل جديد من إعلان: ${q.projectType}`, body: `${q.name} — ${q.phone} (${f.name})`, href: `/quotes/${q.id}` });
      created++;
    }
  }
  return { forms: forms.data?.length ?? 0, created };
}

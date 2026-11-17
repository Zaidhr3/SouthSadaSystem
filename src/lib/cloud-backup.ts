import "server-only";
import { gzipSync } from "zlib";
import { db } from "./db";

/**
 * النسخ الاحتياطي التلقائي اليومي إلى حاوية خاصة في Supabase Storage (sada-backups):
 *   db/<التاريخ>.json.gz   ← كل الجداول (عدا محتوى الملفات) — يومياً
 *   files/<رقم المرفق>     ← محتوى كل مرفق مرة واحدة فقط (المرفقات لا تتغير بعد رفعها)
 * الاحتفاظ: آخر 35 نسخة يومية + نسخة أول كل شهر لسنة كاملة.
 * الحاوية خاصة بالكامل: لا يصلها إلا الخادم بمفتاح الخدمة (SUPABASE_SERVICE_ROLE_KEY).
 */
export const BACKUP_BUCKET = "sada-backups";
const KEEP_DAILY = 35;
const KEEP_MONTHLY = 13;
/** حد الملفات المنسوخة في التشغيلة الواحدة (لا تتجاوز مدة الدالة) — الباقي في اليوم التالي */
const FILES_PER_RUN = 150;

export const backupConfigured = () => !!process.env.SUPABASE_SERVICE_ROLE_KEY && !!process.env.NEXT_PUBLIC_SUPABASE_URL;

const base = () => `${(process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/+$/, "")}/storage/v1`;
const headers = () => {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  return { apikey: key, Authorization: `Bearer ${key}` };
};

async function upload(path: string, body: Buffer, type: string) {
  const res = await fetch(`${base()}/object/${BACKUP_BUCKET}/${path}`, {
    method: "POST",
    headers: { ...headers(), "Content-Type": type, "x-upsert": "true" },
    body: new Uint8Array(body),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`رفع ${path} فشل: ${res.status} ${await res.text().catch(() => "")}`);
}

export type BackupObject = { name: string; size: number; createdAt: string };

async function list(prefix: string): Promise<BackupObject[]> {
  const out: BackupObject[] = [];
  for (let offset = 0; ; offset += 1000) {
    const res = await fetch(`${base()}/object/list/${BACKUP_BUCKET}`, {
      method: "POST",
      headers: { ...headers(), "Content-Type": "application/json" },
      body: JSON.stringify({ prefix, limit: 1000, offset, sortBy: { column: "name", order: "desc" } }),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`قراءة النسخ فشلت: ${res.status}`);
    const rows = (await res.json()) as { name: string; created_at: string; metadata?: { size?: number } }[];
    for (const r of rows) out.push({ name: r.name, size: r.metadata?.size ?? 0, createdAt: r.created_at });
    if (rows.length < 1000) return out;
  }
}

async function remove(paths: string[]) {
  if (!paths.length) return;
  await fetch(`${base()}/object/${BACKUP_BUCKET}`, {
    method: "DELETE",
    headers: { ...headers(), "Content-Type": "application/json" },
    body: JSON.stringify({ prefixes: paths }),
    cache: "no-store",
  });
}

export async function listDbBackups() {
  return (await list("db")).filter((o) => o.name.endsWith(".json.gz"));
}

export async function downloadBackup(name: string) {
  if (!/^[\w.-]+\.json\.gz$/.test(name)) return null;
  const res = await fetch(`${base()}/object/authenticated/${BACKUP_BUCKET}/db/${name}`, { headers: headers(), cache: "no-store" });
  return res.ok ? Buffer.from(await res.arrayBuffer()) : null;
}

const replacer = (_: string, v: unknown) => {
  if (typeof v === "bigint") return Number(v);
  if (v && typeof v === "object" && (v as { type?: string }).type === "Buffer" && Array.isArray((v as { data?: unknown }).data)) return { $bytes: Buffer.from((v as { data: number[] }).data).toString("base64") };
  return v;
};

export async function runCloudBackup() {
  if (!backupConfigured()) return { configured: false };
  const tables = (await db.$queryRawUnsafe<{ t: string }[]>(`SELECT tablename AS t FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE '\\_prisma%' ORDER BY tablename`)).map((r) => r.t);
  const data: Record<string, unknown[]> = {};
  let total = 0;
  for (const t of tables) {
    // محتوى الملفات يُنسخ منفصلاً (files/) — هنا يُحفظ رقم المرفق فقط
    const rows = await db.$queryRawUnsafe<Record<string, unknown>[]>(t === "AttachmentBlob" ? `SELECT "attachmentId" FROM "AttachmentBlob"` : `SELECT * FROM "${t}"`);
    data[t] = rows;
    total += rows.length;
  }
  const stamp = new Date().toISOString().slice(0, 10);
  const gz = gzipSync(Buffer.from(JSON.stringify({ createdAt: new Date().toISOString(), total, tables: data, files: `${BACKUP_BUCKET}/files/<attachmentId>` }, replacer)));
  await upload(`db/${stamp}.json.gz`, gz, "application/gzip");

  // الملفات الجديدة فقط
  const have = new Set((await list("files")).map((o) => o.name));
  const ids = (data.AttachmentBlob as { attachmentId: number }[]).map((r) => r.attachmentId).filter((id) => !have.has(String(id)));
  let filesCopied = 0;
  for (const id of ids.slice(0, FILES_PER_RUN)) {
    const blob = await db.attachmentBlob.findUnique({ where: { attachmentId: id } });
    if (!blob) continue;
    await upload(`files/${id}`, Buffer.from(blob.data), "application/octet-stream");
    filesCopied++;
  }

  // الاحتفاظ: آخر 35 يوماً + أول نسخة من كل شهر لـ13 شهراً
  const all = await listDbBackups();
  const keep = new Set(all.slice(0, KEEP_DAILY).map((o) => o.name));
  const months = new Map<string, string>();
  for (const o of [...all].reverse()) if (!months.has(o.name.slice(0, 7))) months.set(o.name.slice(0, 7), o.name);
  [...months.values()].slice(-KEEP_MONTHLY).forEach((n) => keep.add(n));
  const old = all.filter((o) => !keep.has(o.name)).map((o) => `db/${o.name}`);
  await remove(old);

  return { configured: true, file: `${stamp}.json.gz`, rows: total, sizeKb: Math.round(gz.length / 1024), filesCopied, filesPending: Math.max(0, ids.length - filesCopied), pruned: old.length };
}

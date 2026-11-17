import "server-only";
import { db } from "../db";

/**
 * مكتبة المهارات من GitHub: يقبل رابط ملف (…/blob/…/SKILL.md) أو مجلد/مستودع (يجمع كل SKILL.md داخله حتى 25).
 * المهارة = تعليمات Markdown مع ترويسة name/description — تُحقن في المساعد و/أو التسويق حسب النطاق.
 * المستودعات العامة لا تحتاج رمزاً؛ GITHUB_TOKEN (اختياري) يرفع حد الطلبات ويتيح المستودعات الخاصة.
 */
const headers = () => ({ "User-Agent": "sada-erp", Accept: "application/vnd.github+json", ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) });

function parse(md: string, fallback: string) {
  const fm = md.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  const meta: Record<string, string> = {};
  if (fm) for (const line of fm[1].split("\n")) {
    const m = line.match(/^(\w[\w-]*):\s*(.*)$/);
    if (m) meta[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
  }
  const body = fm ? md.slice(fm[0].length) : md;
  const name = (meta.name || fallback).slice(0, 80);
  const description = (meta.description || body.split("\n").find((l) => l.trim() && !l.startsWith("#")) || name).slice(0, 400);
  return { name, description, content: body.trim().slice(0, 20_000) };
}

async function raw(url: string) {
  const r = await fetch(url, { headers: { "User-Agent": "sada-erp", ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) }, signal: AbortSignal.timeout(20_000), cache: "no-store" });
  if (!r.ok) throw new Error(`تعذر قراءة الملف من GitHub (HTTP ${r.status})`);
  return r.text();
}

export async function importSkill(url: string, scope: "assistant" | "marketing" | "both", userId: number) {
  const u = url.trim();
  let files: { url: string; name: string }[] = [];
  const blob = u.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+\.md)$/i);
  const rawUrl = u.match(/^https:\/\/raw\.githubusercontent\.com\/.+\.md$/i);
  const tree = u.match(/^https:\/\/github\.com\/([^/]+)\/([^/#?]+)(?:\/tree\/([^/]+)(?:\/(.*))?)?\/?$/i);
  if (blob) files = [{ url: `https://raw.githubusercontent.com/${blob[1]}/${blob[2]}/${blob[3]}/${blob[4]}`, name: blob[4].split("/").slice(-2, -1)[0] || blob[4] }];
  else if (rawUrl) files = [{ url: u, name: u.split("/").slice(-2, -1)[0] }];
  else if (tree) {
    const [, owner, repo0, branch0, dir = ""] = tree;
    const repo = repo0.replace(/\.git$/, "");
    let branch = branch0;
    if (!branch) {
      const info = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers: headers(), signal: AbortSignal.timeout(15_000), cache: "no-store" });
      if (!info.ok) throw new Error(info.status === 404 ? "المستودع غير موجود أو خاص (أضف GITHUB_TOKEN للمستودعات الخاصة)" : `GitHub: HTTP ${info.status}`);
      branch = ((await info.json()) as { default_branch: string }).default_branch;
    }
    const t = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`, { headers: headers(), signal: AbortSignal.timeout(20_000), cache: "no-store" });
    if (!t.ok) throw new Error(t.status === 403 ? "تجاوزت حد طلبات GitHub المجاني — حاول بعد ساعة أو أضف GITHUB_TOKEN" : `GitHub: HTTP ${t.status}`);
    const tr = (await t.json()) as { tree: { path: string; type: string }[] };
    files = tr.tree
      .filter((x) => x.type === "blob" && /(^|\/)SKILL\.md$/i.test(x.path) && (!dir || x.path.startsWith(dir.replace(/\/$/, "") + "/") || x.path === dir))
      .slice(0, 25)
      .map((x) => ({ url: `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${x.path}`, name: x.path.split("/").slice(-2, -1)[0] || repo }));
    if (!files.length) throw new Error("لم أجد ملفات SKILL.md في هذا المسار — الصق رابط الملف نفسه");
  } else throw new Error("الصق رابط GitHub لملف .md أو لمجلد/مستودع مهارات");

  const names: string[] = [];
  for (const f of files) {
    const s = parse(await raw(f.url), f.name);
    await db.aiSkill.upsert({ where: { name: s.name }, create: { ...s, sourceUrl: f.url, scope, createdById: userId }, update: { description: s.description, content: s.content, sourceUrl: f.url, scope } });
    names.push(s.name);
  }
  return { names };
}

/** تعليمات المهارات المفعّلة لنطاق معين (تُلحق بموجّه النظام) */
export async function skillsPrompt(scope: "assistant" | "marketing") {
  const skills = await db.aiSkill.findMany({ where: { enabled: true, scope: { in: [scope, "both"] } }, select: { name: true, content: true } });
  if (!skills.length) return "";
  // سقف للحجم حتى لا تبطئ المهارات الردود: 3000 حرف لكل مهارة و20000 للمجموع
  let total = 0;
  const parts: string[] = [];
  for (const s of skills) {
    const part = `### ${s.name}\n${s.content.slice(0, 3000)}`;
    if (total + part.length > 20_000) break;
    parts.push(part);
    total += part.length;
  }
  return `\n\nمهارات مفعّلة (اتبعها حين تنطبق، وطبّقها على سياق شركة مقاولات أردنية):\n${parts.join("\n\n")}`;
}

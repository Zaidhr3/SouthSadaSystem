import React from "react";

/** عارض Markdown خفيف وآمن (بلا HTML خام): عناوين، قوائم، غامق، كود، روابط داخلية، فواصل، جداول بسيطة */
function inline(text: string, key: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\((\/[^)\s]*|https?:\/\/[^)\s]+)\)|(?<![\w/])\/[a-z][\w-]*(?:\/[\w-]+)*(?:\?[\w=&-]+)?)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const k = `${key}-${i++}`;
    if (tok.startsWith("**")) out.push(<b key={k} className="font-bold text-ink">{tok.slice(2, -2)}</b>);
    else if (tok.startsWith("`")) out.push(<code key={k} dir="ltr" className="rounded bg-black/[0.06] px-1 py-0.5 font-mono text-[0.85em]">{tok.slice(1, -1)}</code>);
    else if (tok.startsWith("[")) {
      const label = tok.slice(1, tok.indexOf("]"));
      const href = m[2];
      out.push(<a key={k} href={href} target={href.startsWith("http") ? "_blank" : undefined} rel="noreferrer" className="font-semibold text-accent underline underline-offset-2">{label}</a>);
    } else out.push(<a key={k} href={tok} dir="ltr" className="font-mono text-[0.9em] font-semibold text-accent underline underline-offset-2">{tok}</a>);
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r/g, "").split("\n");
  const blocks: React.ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let table: string[][] | null = null;
  const flush = () => {
    if (list) {
      const L = list.ordered ? "ol" : "ul";
      blocks.push(<L key={`l${blocks.length}`} className={list.ordered ? "list-decimal space-y-1 ps-6" : "list-disc space-y-1 ps-6 marker:text-gold"}>{list.items.map((it, i) => <li key={i}>{inline(it, `li${blocks.length}-${i}`)}</li>)}</L>);
      list = null;
    }
    if (table) {
      const [head, ...rows] = table.filter((r) => !r.every((c) => /^:?-{2,}:?$/.test(c)));
      blocks.push(
        <div key={`t${blocks.length}`} className="overflow-x-auto rounded-xl border border-line">
          <table className="tbl text-sm">
            <thead><tr>{head.map((c, i) => <th key={i}>{inline(c, `th${i}`)}</th>)}</tr></thead>
            <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{inline(c, `td${i}-${j}`)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
      table = null;
    }
  };
  lines.forEach((raw, idx) => {
    const line = raw.trimEnd();
    if (/^\s*\|.*\|\s*$/.test(line)) {
      if (list) flush();
      (table ??= []).push(line.trim().slice(1, -1).split("|").map((c) => c.trim()));
      return;
    }
    const li = line.match(/^\s*(?:([-*•])|(\d+)[.)])\s+(.*)$/);
    if (li) {
      if (table) flush();
      const ordered = !!li[2];
      if (!list || list.ordered !== ordered) {
        flush();
        list = { ordered, items: [] };
      }
      list.items.push(li[3]);
      return;
    }
    flush();
    if (!line.trim()) return;
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) blocks.push(<p key={idx} className={h[1].length <= 2 ? "mt-2 text-base font-black text-navy" : "mt-1 font-bold text-navy"}>{inline(h[2], `h${idx}`)}</p>);
    else if (/^-{3,}$|^\*{3,}$/.test(line.trim())) blocks.push(<hr key={idx} className="border-line" />);
    else if (line.startsWith("> ")) blocks.push(<blockquote key={idx} className="border-s-4 border-gold ps-3 text-ink-soft">{inline(line.slice(2), `q${idx}`)}</blockquote>);
    else blocks.push(<p key={idx}>{inline(line, `p${idx}`)}</p>);
  });
  flush();
  return <div className="space-y-2 leading-7">{blocks}</div>;
}

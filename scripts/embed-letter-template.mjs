// يستخرج ترويسة وتذييل ورقة الشركة الرسمية (templates/letter.docx) وخط Cairo
// ويضمّنها في src/lib/letterhead-data.ts لتوليد الكتب الرسمية PDF على Vercel دون ملفات خارجية.
// لتحديث الورقة: استبدل templates/letter.docx ثم شغّل: npm run letter:template
import fs from "node:fs";
import JSZip from "jszip";

const zip = await JSZip.loadAsync(fs.readFileSync("templates/letter.docx"));
async function partImage(part) {
  const rels = await zip.file(`word/_rels/${part}.xml.rels`).async("string");
  const target = rels.match(/Target="(media\/[^"]+)"/)[1];
  const buf = await zip.file(`word/${target}`).async("nodebuffer");
  const mime = target.endsWith(".png") ? "image/png" : "image/jpeg";
  return `data:${mime};base64,${buf.toString("base64")}`;
}
const font = (f) => `data:font/woff2;base64,${fs.readFileSync(`node_modules/@fontsource/cairo/files/${f}`).toString("base64")}`;
const out = {
  HEADER: await partImage("header1"),
  FOOTER: await partImage("footer1"),
  CAIRO_AR_400: font("cairo-arabic-400-normal.woff2"),
  CAIRO_AR_700: font("cairo-arabic-700-normal.woff2"),
  CAIRO_LA_400: font("cairo-latin-400-normal.woff2"),
  CAIRO_LA_700: font("cairo-latin-700-normal.woff2"),
};
fs.writeFileSync(
  "src/lib/letterhead-data.ts",
  `// مولّد تلقائياً بـ npm run letter:template — ترويسة وتذييل ورقة الشركة الرسمية وخط Cairo (Base64)\n` +
    Object.entries(out).map(([k, v]) => `export const ${k} =\n  "${v}";\n`).join(""),
);
console.log("embedded", Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.length])));

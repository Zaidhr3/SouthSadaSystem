import "server-only";
import { CAIRO_AR_400, CAIRO_AR_700, CAIRO_LA_400, CAIRO_LA_700, FOOTER, HEADER } from "./letterhead-data";

/**
 * الكتاب الرسمي الصادر على ورقة الشركة الرسمية:
 * الترويسة والتذييل مأخوذتان من templates/letter.docx كما هما (npm run letter:template)،
 * والمتن يُبنى HTML ثم يُطبع PDF بمتصفح Chromium (تشكيل عربي صحيح وصفحات متعددة بنفس الترويسة).
 * المرسِل دائماً الشركة — يُكتب اسمها تلقائياً في التوقيع.
 */
export const COMPANY_NAME = "شركة صدى الجنوب للمقاولات الإنشائية";

export type LetterData = {
  refNo: string | null; // null = مسودة لم تُعتمد بعد (الرقم يُعطى عند الاعتماد)
  date: Date;
  party: string;
  subject: string;
  body: string;
  replyTo?: { refNo: string; theirRef: string | null; date: Date; subject: string } | null;
  attachments?: string[];
  cc?: string | null;
  draft?: boolean;
  /** معاينة داخل النظام: تُصغَّر الورقة لتلائم عرض الإطار */
  preview?: boolean;
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export const fmtLetterDate = (d: Date) => `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;

const AR = "U+0600-06FF, U+0750-077F, U+0870-088E, U+0890-0891, U+0898-08E1, U+08E3-08FF, U+200C-200E, U+2010-2011, U+204F, U+2E41, U+FB50-FDFF, U+FE70-FE74, U+FE76-FEFC";
const LA = "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD";
const face = (src: string, weight: number, range: string) => `@font-face{font-family:Letter;font-weight:${weight};font-display:block;src:url(${src}) format("woff2");unicode-range:${range}}`;

/**
 * الخاتمة والتوقيع (ونسخة إلى) تُثبّت أسفل الصفحة الأخيرة فوق التذييل:
 * يُقاس طول المتن ويُضاف فراغ يدفع كتلة الختام لأسفل آخر صفحة (مساحة المتن في الصفحة = 297 − 50 − 30 = 217 ملم).
 */
const LAYOUT_JS = `(function(){var mm=96/25.4,H=217*mm,SAFE=5*mm;function lay(){document.body.style.zoom="1";var td=document.querySelector(".flow tbody td"),push=document.querySelector(".push"),end=document.querySelector(".endblk");if(!td||!push||!end)return;push.style.height="0px";var used=push.getBoundingClientRect().top-td.getBoundingClientRect().top,eh=end.getBoundingClientRect().height,total=used+eh,line=parseFloat(getComputedStyle(td).lineHeight)||24,pages=1;while(total+SAFE+(pages-1)*line*1.2>pages*H)pages++;var gap=pages*H-total-SAFE-(pages-1)*line*1.2;push.style.height=Math.max(0,gap)+"px";}window.__letterLayout=lay;(document.fonts?document.fonts.ready:Promise.resolve()).then(function(){lay();window.__laid=true;if(window.__fit)window.__fit();});})();`;
const PREVIEW_JS = `(function(){function f(){var w=document.documentElement.clientWidth;document.body.style.zoom=String(Math.min(1.2,w/830));}window.__fit=f;addEventListener("resize",function(){if(window.__letterLayout)window.__letterLayout();f();});})();`;

/** HTML الكتاب كاملاً (للمعاينة داخل النظام وللطباعة PDF) — مقاس A4 والترويسة/التذييل يتكرران في كل صفحة */
export function letterHtml(d: LetterData) {
  const navy = "#1f2a44";
  const body = d.body.replace(/\r/g, "").split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const cc = d.cc ? d.cc.replace(/\r/g, "").split(/\n|،|,/).map((s) => s.trim()).filter(Boolean) : [];
  const reply = d.replyTo
    ? `<p class="j">إشارةً إلى كتابكم ${d.replyTo.theirRef ? `رقم <span class="n">${esc(d.replyTo.theirRef)}</span>` : `المسجل لدينا برقم الوارد <span class="n">${esc(d.replyTo.refNo)}</span>`} تاريخ <span class="n">${fmtLetterDate(d.replyTo.date)}</span> بخصوص «${esc(d.replyTo.subject)}»،</p>`
    : "";
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${esc(d.refNo ?? "مسودة كتاب")} — ${esc(d.subject)}</title>
<style>
${face(CAIRO_AR_400, 400, AR)}${face(CAIRO_AR_700, 700, AR)}${face(CAIRO_LA_400, 400, LA)}${face(CAIRO_LA_700, 700, LA)}
@page{size:A4;margin:0}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{font-family:Letter,Arial,sans-serif;color:#1a1a1a;font-size:13pt;line-height:1.85;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.sheet{position:relative;width:210mm;min-height:297mm;background:#fff;margin:0 auto}
.hdr,.ftr{position:fixed;left:0;width:210mm;z-index:1}
.hdr{top:0;height:44.7mm}.ftr{bottom:0;height:21.8mm}
.hdr img,.ftr img{display:block;width:100%;height:100%}
@media screen{body{background:#dfe4ec;padding:18px 0}.sheet{box-shadow:0 10px 40px rgba(15,23,42,.18)}.hdr,.ftr{position:absolute}}
table.flow{position:relative;z-index:2;width:100%;border-collapse:collapse}
.flow td{padding:0 17mm}
.sp-top{height:50mm}.sp-bot{height:30mm}
.meta{direction:rtl;text-align:left;font-weight:700;color:${navy};font-size:12.5pt;line-height:1.7;margin-bottom:6mm}
.meta div{display:flex;justify-content:flex-end;gap:2mm}
.n{direction:ltr;unicode-bidi:isolate;font-variant-numeric:tabular-nums}
.to{font-weight:700;color:${navy};margin:0}
.subj{text-align:center;font-weight:700;color:${navy};margin:7mm 0 5mm}
.subj span{text-decoration:underline;text-underline-offset:5px}
p{margin:0 0 2.5mm;orphans:1;widows:1}
.j{text-align:justify;text-indent:10mm}
.greet{font-weight:700;margin-bottom:3mm}
.atts{margin-top:4mm;font-size:12pt}
.atts b{display:block}
.endblk{display:flow-root;break-inside:avoid;page-break-inside:avoid}
.close{text-align:center;font-weight:700;margin:6mm 0 5mm}
.sign{width:100mm;white-space:nowrap;margin-right:auto;text-align:center;font-weight:700;color:${navy};line-height:1.9;break-inside:avoid}
.sign .role{color:#1a1a1a;font-weight:400;margin-top:1mm}
.sign .line{height:14mm}
.cc{margin-top:6mm;font-size:11pt;color:#333;break-inside:avoid}
.cc b{display:block}
.wm{position:fixed;top:120mm;left:0;width:210mm;text-align:center;transform:rotate(-28deg);font-size:58pt;font-weight:700;color:rgba(200,30,30,.10);z-index:0;pointer-events:none;white-space:nowrap}
@media screen{.wm{position:absolute}}
.draftbar{margin:0 0 5mm;padding:2mm 4mm;border:1px dashed #c0392b;border-radius:3mm;color:#c0392b;font-size:10.5pt;font-weight:700;text-align:center}
</style></head><body><div class="sheet">
<div class="hdr"><img src="${HEADER}" alt=""></div>
<div class="ftr"><img src="${FOOTER}" alt=""></div>
${d.draft ? `<div class="wm">مسودة — غير معتمد</div>` : ""}
<table class="flow"><thead><tr><td><div class="sp-top"></div></td></tr></thead><tfoot><tr><td><div class="sp-bot"></div></td></tr></tfoot><tbody><tr><td>
${d.draft ? `<div class="draftbar">مسودة للمراجعة — لا تُطبع ولا تُرسل قبل اعتماد المدير العام</div>` : ""}
<div class="meta"><div><span>التاريخ :</span><span class="n">${fmtLetterDate(d.date)}</span></div><div><span>الرقم :</span><span>${d.refNo ? esc(d.refNo) : "يُعطى عند الاعتماد"}</span></div></div>
<p class="to">السادة / ${esc(d.party)}&nbsp;&nbsp;&nbsp;المحترمين</p>
<div class="subj"><span>الموضوع: ${esc(d.subject)}</span></div>
<p class="greet">تحية طيبة وبعد،،،</p>
${reply}
${body.map((l) => `<p class="j">${esc(l)}</p>`).join("\n")}
${d.attachments?.length ? `<div class="atts"><b>المرفقات (${d.attachments.length}):</b>${d.attachments.map((a, i) => `<div>${i + 1}. ${esc(a)}</div>`).join("")}</div>` : ""}
<div class="push"></div>
<div class="endblk"><p class="close">وأقبلوا فائق الاحترام والتقدير،،،</p>
<div class="sign"><div>${COMPANY_NAME}</div><div class="role">المدير التنفيذي</div><div class="line"></div></div>
${cc.length ? `<div class="cc"><b>نسخة إلى:</b>${cc.map((c) => `<div>- ${esc(c)}</div>`).join("")}</div>` : ""}</div>
</td></tr></tbody></table>
</div><script>${LAYOUT_JS}${d.preview ? PREVIEW_JS : ""}</script></body></html>`;
}

export const letterPdfName = (refNo: string | null) => (refNo ? `كتاب ${refNo.replace(/\//g, "-")}.pdf` : "مسودة كتاب.pdf");

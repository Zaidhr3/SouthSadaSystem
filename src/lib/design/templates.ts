import { FONT_CSS } from "./fonts";
import { BRAND as C, BRAND_CLASS, BRAND_EN, BRAND_NAME, BRAND_PHONE, LOGO_DATA_URL } from "./brand";

/**
 * القوالب المؤسسية لصدى الجنوب — HTML يُرسم صورة بمتصفح بلا واجهة (render.ts).
 * عناصر الهوية الثابتة: الشعار الأصلي، الإطار الهندسي (زوايا ذهبية + شبكة مخطط + خطوط أبعاد)، الكحلي/الذهبي/البرتقالي،
 * ورقم كتالوج «SJ·012» يجعل شبكة إنستغرام تبدو ككتالوج هندسي متسلسل.
 */
export type TemplateId = "frame" | "split" | "blueprint" | "motif" | "stat" | "story" | "occasion" | "condolence";
export const TEMPLATES: Record<TemplateId, { name: string; desc: string; photo: "required" | "optional" | "none" }> = {
  frame: { name: "إطار هندسي", desc: "صورة كاملة بإطار الزوايا الذهبية وشريط العنوان — للمشاريع والمعدات", photo: "required" },
  split: { name: "مقسوم", desc: "صورة في الأعلى ولوحة كحلية بالعنوان — للإنجازات ومن قلب الموقع", photo: "required" },
  blueprint: { name: "مخطط أزرق", desc: "خلفية مخطط هندسي بعنوان كبير — للنصائح والقيم بلا صورة", photo: "none" },
  motif: { name: "شكل هندسي", desc: "أرضية رملية فاتحة برسم هندسي كبير (رافعة، جرافة، خزان، مغسلة...) — يكسر تكرار الشبكة", photo: "required" },
  stat: { name: "رقم بارز", desc: "رقم حقيقي من النص (مساحة، طوابق، أيام) بحجم كبير", photo: "optional" },
  story: { name: "قصة عمودية", desc: "1080×1920 بنص الشاشة الكبير", photo: "optional" },
  occasion: { name: "مناسبة وطنية/دينية", desc: "رصين بزخرفة ذهبية", photo: "none" },
  condolence: { name: "تعزية", desc: "أبيض وأسود رصين بلا ألوان تسويقية", photo: "none" },
};

export type SlideInput = { headline: string; sub?: string; label?: string; catalog?: string; photo?: string | null; stat?: { value: string; unit: string } | null; point?: { n: number; of: number } | null; cta?: string | null };

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

const BASE = (w: number, h: number, body: string, extraCss = "") => `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><style>
${FONT_CSS}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${w}px;height:${h}px;overflow:hidden}
body{font-family:Cairo,sans-serif;color:#fff;background:${C.navy};-webkit-font-smoothing:antialiased;position:relative}
.grid{position:absolute;inset:0;background-image:linear-gradient(rgba(242,177,52,.07) 1px,transparent 1px),linear-gradient(90deg,rgba(242,177,52,.07) 1px,transparent 1px),linear-gradient(rgba(255,255,255,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.035) 1px,transparent 1px);background-size:120px 120px,120px 120px,24px 24px,24px 24px}
.corner{position:absolute;width:86px;height:86px;border-color:${C.gold};border-style:solid;border-width:0}
.tl{top:38px;left:38px;border-top-width:7px;border-left-width:7px}.tr{top:38px;right:38px;border-top-width:7px;border-right-width:7px}
.bl{bottom:38px;left:38px;border-bottom-width:7px;border-left-width:7px}.br{bottom:38px;right:38px;border-bottom-width:7px;border-right-width:7px}
.logo{position:absolute;top:66px;right:66px;background:#fff;border-radius:26px;padding:14px 18px;box-shadow:0 10px 30px rgba(0,0,0,.35);display:flex;align-items:center;gap:14px}
.logo img{height:74px;display:block}
.logo b{color:${C.navy};font-size:22px;font-weight:900;line-height:1.15}.logo small{display:block;color:${C.orange};font-size:15px;font-weight:800}
.pill{display:inline-block;background:${C.orange};color:#fff;font-weight:800;font-size:28px;padding:6px 26px;border-radius:999px;letter-spacing:.3px}
.cat{font-family:Cairo;font-weight:800;font-size:24px;letter-spacing:4px;color:${C.gold};direction:ltr}
.dim{position:absolute;height:2px;background:${C.gold};opacity:.85}.dim:before,.dim:after{content:"";position:absolute;top:-10px;width:2px;height:22px;background:${C.gold}}.dim:before{left:0}.dim:after{right:0}
.photo{position:absolute;background-size:cover;background-position:center}
h1{font-weight:900;line-height:1.22;text-wrap:balance}
p.sub{font-weight:600;line-height:1.6;color:rgba(255,255,255,.88)}
.foot{position:absolute;left:66px;right:66px;bottom:58px;display:flex;justify-content:space-between;align-items:center;font-weight:800;font-size:24px;color:rgba(255,255,255,.9)}
.foot .ph{direction:ltr;color:${C.gold}}
${extraCss}
</style></head><body>${body}
<script>
/* تصغير النص تلقائياً حتى يتسع لمكانه (العناوين الطويلة لا تُقص) */
document.querySelectorAll("[data-fit]").forEach(function(el){var s=parseFloat(getComputedStyle(el).fontSize),min=+el.dataset.fit||28;while((el.scrollHeight>el.clientHeight+2||el.scrollWidth>el.clientWidth+2)&&s>min){s-=2;el.style.fontSize=s+"px"}});
window.__ready=true;
</script></body></html>`;

const logo = () => `<div class="logo"><img src="${LOGO_DATA_URL}" alt=""><span><b>صدى الجنوب</b><small>للمقاولات الإنشائية</small></span></div>`;
const corners = () => `<div class="corner tl"></div><div class="corner tr"></div><div class="corner bl"></div><div class="corner br"></div>`;
/** سطر التواصل: الدعوة القصيرة فقط، والطويلة تُستبدل بالرقم (لا تزاحم رقم الكتالوج) */
const ctaLine = (s: SlideInput) => (s.cta && s.cta.length <= 34 ? esc(s.cta) : `واتساب ${BRAND_PHONE}`);
const foot = (s: SlideInput) => `<div class="foot"><span class="cat">${esc(s.catalog ?? "SADA")}</span><span class="ph">${ctaLine(s)}</span></div>`;

export function renderTemplate(t: TemplateId, s: SlideInput, size: { w: number; h: number }): string {
  const { w, h } = size;
  const label = s.label ? `<span class="pill">${esc(s.label)}</span>` : "";
  const sub = s.sub ? `<p class="sub" data-fit="22" style="font-size:34px;max-height:${Math.round(h * 0.16)}px;overflow:hidden;margin-top:18px">${esc(s.sub)}</p>` : "";
  switch (t) {
    case "frame":
      return BASE(w, h, `
<div class="photo" style="inset:0;background-image:url('${s.photo ?? ""}')"></div>
<div style="position:absolute;inset:0;background:linear-gradient(180deg,rgba(11,37,69,.15) 0%,rgba(11,37,69,0) 35%,rgba(11,37,69,.78) 66%,rgba(11,37,69,.97) 100%)"></div>
${corners()}${logo()}
<div style="position:absolute;right:76px;left:76px;bottom:150px">${label}
<h1 data-fit="40" style="font-size:76px;margin-top:22px;max-height:${Math.round(h * 0.27)}px;overflow:hidden">${esc(s.headline)}</h1>${sub}</div>
<div class="dim" style="left:76px;right:76px;bottom:122px"></div>${foot(s)}`);
    case "split":
      return BASE(w, h, `
<div class="photo" style="top:0;left:0;right:0;height:${Math.round(h * 0.58)}px;background-image:url('${s.photo ?? ""}')"></div>
<div class="grid" style="top:${Math.round(h * 0.58)}px"></div>
<div style="position:absolute;top:${Math.round(h * 0.58) - 8}px;left:0;right:0;height:8px;background:linear-gradient(90deg,${C.gold},${C.orange})"></div>
${logo()}
<div style="position:absolute;right:76px;left:76px;top:${Math.round(h * 0.58) + 54}px;bottom:150px;overflow:hidden">${label}
<h1 data-fit="36" style="font-size:66px;margin-top:20px;max-height:${Math.round(h * 0.2)}px;overflow:hidden">${esc(s.headline)}</h1>${sub}</div>
<div class="dim" style="left:76px;right:76px;bottom:122px"></div>${foot(s)}`);
    case "blueprint":
    case "stat": {
      const big = t === "stat" && s.stat ? `<div style="direction:ltr;text-align:right;line-height:1"><span style="font-size:250px;font-weight:900;color:${C.gold}">${esc(s.stat.value)}</span><span style="font-size:72px;font-weight:900;color:#fff;margin-left:14px">${esc(s.stat.unit)}</span></div>` : "";
      const point = s.point ? `<div style="font-size:150px;font-weight:900;color:transparent;-webkit-text-stroke:3px ${C.gold};line-height:1;direction:ltr;text-align:right">${String(s.point.n).padStart(2, "0")}<span style="font-size:40px;-webkit-text-stroke:0;color:rgba(255,255,255,.5)"> / ${String(s.point.of).padStart(2, "0")}</span></div>` : "";
      return BASE(w, h, `
<div style="position:absolute;inset:0;background:radial-gradient(70% 55% at 85% 10%,rgba(242,177,52,.22),transparent 70%),radial-gradient(60% 50% at 0% 100%,rgba(232,89,12,.2),transparent 70%),linear-gradient(160deg,${C.navy} 0%,${C.navy2} 60%,#0a1f3b 100%)"></div>
<div class="grid"></div>${s.photo ? `<div class="photo" style="inset:0;opacity:.16;background-image:url('${s.photo}')"></div>` : ""}${corners()}${logo()}
<div class="dim" style="right:76px;width:${Math.round(w * 0.36)}px;top:${Math.round(h * 0.25)}px"></div>
<div style="position:absolute;right:76px;left:76px;top:${Math.round(h * 0.29)}px;bottom:170px;display:flex;flex-direction:column;justify-content:center;overflow:hidden">${label ? `<div>${label}</div>` : ""}${big}${point}
<h1 data-fit="36" style="font-size:${big ? 58 : 84}px;margin-top:26px;max-height:${Math.round(h * (big ? 0.2 : 0.34))}px;overflow:hidden">${esc(s.headline)}</h1>${sub}</div>
<div class="dim" style="left:76px;right:76px;bottom:122px"></div>${foot(s)}`);
    }
    case "motif":
      return BASE(w, h, `
<div style="position:absolute;inset:0;background:#f5f1ea"></div>
<div style="position:absolute;inset:0;background-image:linear-gradient(rgba(11,37,69,.06) 1px,transparent 1px),linear-gradient(90deg,rgba(11,37,69,.06) 1px,transparent 1px);background-size:40px 40px"></div>
<div style="position:absolute;top:150px;left:90px;right:90px;height:${Math.round(h * 0.5)}px;background:url('${s.photo ?? ""}') center/contain no-repeat;mix-blend-mode:multiply;-webkit-mask-image:radial-gradient(closest-side,#000 82%,transparent 100%)"></div>
<div class="corner tl" style="border-color:${C.navy}"></div><div class="corner tr" style="border-color:${C.navy}"></div><div class="corner bl" style="border-color:${C.orange}"></div><div class="corner br" style="border-color:${C.orange}"></div>
${logo().replace('class="logo"', 'class="logo" style="box-shadow:0 6px 18px rgba(11,37,69,.18)"')}
<div style="position:absolute;right:86px;left:86px;top:${Math.round(h * 0.5) + 170}px;bottom:150px;overflow:hidden;color:${C.navy}">${label}
<h1 data-fit="34" style="font-size:64px;margin-top:18px;max-height:${Math.round(h * 0.17)}px;overflow:hidden;color:${C.navy}">${esc(s.headline)}</h1>${s.sub ? `<p data-fit="22" style="font-size:30px;font-weight:700;line-height:1.55;margin-top:12px;color:#38435a;max-height:${Math.round(h * 0.1)}px;overflow:hidden">${esc(s.sub)}</p>` : ""}</div>
<div class="dim" style="left:86px;right:86px;bottom:122px;background:${C.navy}"></div>
<div class="foot" style="color:${C.navy}"><span class="cat" style="color:${C.orange}">${esc(s.catalog ?? "SADA")}</span><span class="ph" style="color:${C.navy}">${ctaLine(s)}</span></div>`);
    case "story":
      return BASE(w, h, `
${s.photo ? `<div class="photo" style="inset:0;background-image:url('${s.photo}')"></div>` : `<div style="position:absolute;inset:0;background:linear-gradient(170deg,${C.navy} 0%,${C.navy3} 55%,${C.orange} 130%)"></div><div class="grid"></div>`}
<div style="position:absolute;inset:0;background:linear-gradient(180deg,rgba(11,37,69,.55) 0%,rgba(11,37,69,0) 22%,rgba(11,37,69,0) 45%,rgba(11,37,69,.92) 78%)"></div>
${corners()}${logo()}
<div style="position:absolute;right:80px;left:80px;bottom:300px">${label}
<h1 data-fit="48" style="font-size:104px;margin-top:26px;max-height:620px;overflow:hidden">${esc(s.headline)}</h1>${s.sub ? `<p class="sub" style="font-size:40px;margin-top:22px">${esc(s.sub)}</p>` : ""}</div>
<div style="position:absolute;left:80px;right:80px;bottom:150px;text-align:center"><span style="display:inline-block;background:#fff;color:${C.navy};font-weight:900;font-size:38px;padding:16px 46px;border-radius:999px">${esc(s.cta ?? `واتساب ${BRAND_PHONE}`)}</span></div>`);
    case "occasion":
      return BASE(w, h, `
<div style="position:absolute;inset:0;background:radial-gradient(60% 45% at 50% 40%,rgba(242,177,52,.25),transparent 70%),linear-gradient(180deg,${C.navy},#06182e)"></div>
<div style="position:absolute;inset:60px;border:3px solid ${C.gold};border-radius:28px"></div><div style="position:absolute;inset:78px;border:1px solid rgba(242,177,52,.45);border-radius:20px"></div>
<div style="position:absolute;top:130px;left:0;right:0;display:flex;justify-content:center"><div style="background:#fff;border-radius:28px;padding:18px 24px"><img src="${LOGO_DATA_URL}" style="height:110px;display:block"></div></div>
<div style="position:absolute;right:120px;left:120px;top:${Math.round(h * 0.33)}px;bottom:${Math.round(h * 0.2)}px;display:flex;flex-direction:column;justify-content:center;text-align:center">
<h1 data-fit="40" style="font-size:86px;color:${C.gold};max-height:${Math.round(h * 0.3)}px;overflow:hidden">${esc(s.headline)}</h1>${s.sub ? `<p class="sub" data-fit="24" style="font-size:38px;margin-top:26px;max-height:${Math.round(h * 0.18)}px;overflow:hidden">${esc(s.sub)}</p>` : ""}</div>
<div style="position:absolute;bottom:130px;left:0;right:0;text-align:center;font-weight:800;font-size:30px;color:rgba(255,255,255,.85)">${BRAND_NAME}</div>`);
    case "condolence":
      return BASE(w, h, `
<div style="position:absolute;inset:0;background:#111"></div>
<div style="position:absolute;inset:60px;border:2px solid rgba(255,255,255,.35)"></div>
<div style="position:absolute;right:120px;left:120px;top:${Math.round(h * 0.2)}px;bottom:${Math.round(h * 0.24)}px;display:flex;flex-direction:column;justify-content:center;text-align:center;filter:grayscale(1)">
<p style="font-size:40px;font-weight:600;color:#ddd;margin-bottom:30px">قال تعالى: ﴿إِنَّا لِلَّهِ وَإِنَّا إِلَيْهِ رَاجِعُونَ﴾</p>
<h1 data-fit="36" style="font-size:72px;color:#fff;max-height:${Math.round(h * 0.3)}px;overflow:hidden">${esc(s.headline)}</h1>${s.sub ? `<p class="sub" data-fit="22" style="font-size:34px;margin-top:24px;color:#ccc;max-height:${Math.round(h * 0.2)}px;overflow:hidden">${esc(s.sub)}</p>` : ""}</div>
<div style="position:absolute;bottom:120px;left:0;right:0;display:flex;justify-content:center;align-items:center;gap:18px;filter:grayscale(1)"><img src="${LOGO_DATA_URL}" style="height:64px;background:#fff;border-radius:12px;padding:6px"><span style="font-weight:800;font-size:28px;color:#ddd">${BRAND_NAME}</span></div>`);
  }
}

/** هوية الحسابات: الصورة الشخصية (مربعة) — نفس الشعار على طابع جديد */
export function profileHtml(size = 1080) {
  return BASE(size, size, `
<div style="position:absolute;inset:0;background:radial-gradient(55% 55% at 50% 45%,${C.navy3} 0%,${C.navy} 62%,#061629 100%)"></div>
<div class="grid" style="opacity:.6"></div>
<div style="position:absolute;inset:${size * 0.085}px;border-radius:50%;border:${size * 0.016}px solid ${C.gold};box-shadow:0 0 0 ${size * 0.008}px rgba(242,177,52,.25),inset 0 0 60px rgba(0,0,0,.35)"></div>
<div style="position:absolute;inset:${size * 0.2}px;border-radius:50%;background:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;box-shadow:0 20px 50px rgba(0,0,0,.4)">
<img src="${LOGO_DATA_URL}" style="width:${size * 0.34}px;image-rendering:auto">
<div style="margin-top:${size * 0.02}px;font-weight:900;font-size:${size * 0.06}px;color:${C.navy}">صدى الجنوب</div>
<div style="height:${size * 0.006}px;width:${size * 0.2}px;background:linear-gradient(90deg,${C.gold},${C.orange});border-radius:9px;margin-top:${size * 0.012}px"></div></div>`);
}

/** هوية الحسابات: الغلاف (فيسبوك 1640×624 — المنطقة الآمنة في الوسط لظهوره على الهاتف) */
const COVER_DECO = `<svg style="position:absolute;left:40px;bottom:0;opacity:.13" width="560" height="560" viewBox="0 0 200 200" fill="none" stroke="#fff" stroke-width="2"><path d="M40 200V40h8v160M44 40l120 0M44 40l30 -20 90 20M164 40v40M156 80h16v14h-16zM44 60l20 -20M44 80l20 -20M44 100l20 -20M44 120l20 -20M44 140l20 -20M44 160l20 -20M44 180l20 -20"/></svg>`;

export function coverHtml(w = 1640, h = 624, art?: string) {
  const services = ["أبنية وفلل", "إسكانات ومجمعات", "هياكل خرسانية", "خزانات مياه", "بنية تحتية", "تشطيبات"];
  return BASE(w, h, `
<div style="position:absolute;inset:0;background:radial-gradient(45% 80% at 85% 0%,rgba(242,177,52,.28),transparent 70%),radial-gradient(40% 90% at 0% 100%,rgba(232,89,12,.25),transparent 70%),linear-gradient(160deg,${C.navy} 0%,${C.navy2} 55%,#0a1f3b 100%)"></div>
${art ? `<div class="photo" style="inset:0;background-image:url('${art}')"></div><div style="position:absolute;inset:0;background:linear-gradient(90deg,rgba(6,22,41,.25) 0%,rgba(6,22,41,.86) 22%,rgba(6,22,41,.9) 78%,rgba(6,22,41,.25) 100%)"></div>` : ""}
<div class="grid" style="opacity:${art ? 0.45 : 1}"></div>
${art ? "" : COVER_DECO}
<div style="position:absolute;top:0;bottom:0;left:${w * 0.2}px;right:${w * 0.2}px;display:flex;align-items:center;justify-content:center;gap:44px">
<div style="background:#fff;border-radius:32px;padding:22px 26px;box-shadow:0 18px 40px rgba(0,0,0,.4)"><img src="${LOGO_DATA_URL}" style="height:150px;display:block"></div>
<div><div style="font-size:70px;font-weight:900;line-height:1.1">${BRAND_NAME}</div>
<div style="font-size:26px;font-weight:800;letter-spacing:5px;color:${C.gold};direction:ltr;text-align:right;margin-top:6px">${BRAND_EN}</div>
<div style="height:6px;width:260px;background:linear-gradient(90deg,${C.gold},${C.orange});border-radius:9px;margin:18px 0 16px"></div>
<div style="font-size:30px;font-weight:700;color:rgba(255,255,255,.92)">${BRAND_CLASS} · نبني بثقة، وننفّذ بدقّة، ونسلّم في الموعد</div>
<div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:20px">${services.map((x) => `<span style="border:2px solid rgba(242,177,52,.6);border-radius:999px;padding:4px 18px;font-weight:800;font-size:22px">${x}</span>`).join("")}</div></div></div>
<div class="dim" style="left:${w * 0.2}px;right:${w * 0.2}px;bottom:44px"></div>`);
}

export const SIZES = { post: { w: 1080, h: 1350 }, story: { w: 1080, h: 1920 } } as const;

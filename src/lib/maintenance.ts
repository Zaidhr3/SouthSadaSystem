/** صفحة «النظام تحت الصيانة» — تُعرض لكل الطلبات حين MAINTENANCE_MODE=1 (بلا قاعدة بيانات ولا ملفات خارجية) */
export const MAINTENANCE_HTML = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="120"><title>النظام تحت الصيانة — صدى الجنوب</title>
<style>
*{box-sizing:border-box}html,body{margin:0;height:100%}
body{font-family:Cairo,"Segoe UI",Tahoma,sans-serif;color:#fff;display:grid;place-items:center;padding:24px;overflow:hidden;
background:radial-gradient(60% 50% at 85% 0%,rgba(242,177,52,.32),transparent 70%),radial-gradient(50% 45% at 0% 100%,rgba(232,89,12,.25),transparent 70%),linear-gradient(160deg,#0b2545,#13315c 55%,#0a1f3b)}
.box{position:relative;max-width:520px;text-align:center;animation:in .8s cubic-bezier(.2,.8,.2,1) both}
.logo{width:120px;height:110px;margin:0 auto 22px;border-radius:28px;background:#fff;display:grid;place-items:center;box-shadow:0 20px 50px -15px rgba(0,0,0,.5);outline:4px solid rgba(242,177,52,.7)}
.logo img{height:82px}
h1{font-size:28px;margin:0 0 10px}
p{margin:0 0 6px;line-height:1.9;color:rgba(255,255,255,.82)}
.gold{color:#f2b134;font-weight:700}
.bar{margin:26px auto 0;width:220px;height:8px;border-radius:9px;background:rgba(255,255,255,.12);overflow:hidden}
.bar span{display:block;height:100%;width:40%;border-radius:9px;background:linear-gradient(90deg,#f2b134,#e8590c);animation:slide 1.6s ease-in-out infinite}
.crane{position:absolute;inset:auto auto -40px -60px;width:360px;opacity:.07}
@keyframes slide{0%{transform:translateX(160%)}100%{transform:translateX(-260%)}}
@keyframes in{from{opacity:0;transform:translateY(16px) scale(.97)}to{opacity:1;transform:none}}
</style></head><body>
<div class="box">
<div class="logo"><img src="/logo.JPG" alt="صدى الجنوب"></div>
<h1>النظام تحت الصيانة والتحديث</h1>
<p>نعمل الآن على تحديث نظام <span class="gold">شركة صدى الجنوب للمقاولات الإنشائية</span> وإضافة تحسينات جديدة.</p>
<p>بياناتكم محفوظة بالكامل — يرجى المحاولة بعد قليل.</p>
<div class="bar"><span></span></div>
</div></body></html>`;

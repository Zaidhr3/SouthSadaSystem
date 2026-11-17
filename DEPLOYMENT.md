# النشر السحابي: Supabase + Cloudflare Tunnel

## الصورة الكاملة (مهم)

```
[المتصفح في عمّان/العقبة/الطفيلة] ──HTTPS──► Cloudflare ──نفق مشفّر──► [جهاز الخادم: Node + cloudflared] ──► Supabase (قاعدة البيانات)
```

- **Supabase** يحفظ قاعدة البيانات في السحابة (نسخ احتياطي يومي تلقائي) — البيانات آمنة حتى لو تعطل الجهاز.
- **Cloudflare Tunnel** يعطي رابطاً عاماً آمناً (HTTPS) دون فتح منافذ في الراوتر.
- **لكن النظام نفسه (Next.js) يجب أن يعمل على جهاز يعمل باستمرار.** النفق ينشر خادماً قائماً؛ إن أُطفئ الجهاز يتوقف الرابط.
  الخيارات: جهاز مكتبي/Mini-PC يبقى يعمل في المكتب، أو خادم سحابي صغير (VPS ‏~5$ شهرياً) يُشغَّل عليه النظام و`cloudflared` بنفس الخطوات.
- **المرفقات** (صور، PDF) تُحفظ في `storage/uploads` على جهاز الخادم — انسخها احتياطياً، أو اطلب نقلها إلى Supabase Storage كخطوة لاحقة.

---

## 1) Supabase وقاعدة البيانات (مرة واحدة)

1. أنشئ مشروعاً في supabase.com — اختر المنطقة الأقرب (Frankfurt `eu-central-1`) وكلمة مرور قوية لقاعدة البيانات.
2. Project Settings → Database → Connection string:
   - **Transaction pooler** (المنفذ 6543) → `DATABASE_URL` وأضف في آخره: `?pgbouncer=true&connection_limit=5`
   - **Session pooler** (المنفذ 5432) → `DIRECT_URL`
3. في `.env` احذف سطر `DATABASE_URL="file:./southsada.db"` وضع السطرين:
   ```
   DATABASE_URL="postgresql://postgres.<ref>:<PASSWORD>@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=5"
   DIRECT_URL="postgresql://postgres.<ref>:<PASSWORD>@aws-0-eu-central-1.pooler.supabase.com:5432/postgres"
   ```
4. انقل كل البيانات (أوقف الخادم أولاً):
   ```powershell
   npm run cloud:migrate
   ```
   يقوم بـ: تحويل المزود إلى PostgreSQL ← إنشاء الجداول ← نسخ كل السجلات بمعرفاتها ← ضبط العدادات ← **تفعيل RLS على كل الجداول** ← مطابقة الأعداد والمجاميع المالية جدولاً جدولاً.
   - ملف SQLite الأصلي **لا يُمس** (يُفتح للقراءة فقط) — يبقى نسخة احتياطية.
   - يرفض العمل إن كانت قاعدة Supabase تحتوي بيانات.
5. `npm run build` ثم `npm start` — النظام يعمل الآن على Supabase.

> **الرجوع للمحلي:** أعد `DATABASE_URL="file:./southsada.db"` في `.env` ثم `npm run build`. المزود يُضبط تلقائياً قبل كل بناء.

> **لماذا RLS؟** Supabase ينشر جداول المخطط `public` عبر واجهة REST بالمفتاح العام. النظام لا يستخدم تلك الواجهة، لذلك نغلقها بالكامل؛ اتصال النظام عبر Prisma (صلاحية مالك الجداول) لا يتأثر.

---

## 2) Cloudflare Tunnel (مرة واحدة على جهاز الخادم)

يتطلب نطاقاً (Domain) مضافاً إلى حساب Cloudflare المجاني.

```powershell
winget install --id Cloudflare.cloudflared
cloudflared tunnel login                      # يفتح المتصفح لاختيار النطاق
cloudflared tunnel create southsada           # يطبع TUNNEL-ID وينشئ ملف الاعتماد
cloudflared tunnel route dns southsada erp.<your-domain>.com
```

انسخ `cloudflared/config.example.yml` إلى `C:\Users\<USER>\.cloudflared\config.yml` وضع `TUNNEL-ID` والمسار، ثم:

```powershell
cloudflared tunnel run southsada              # تجربة
cloudflared service install                   # تشغيل تلقائي كخدمة Windows مع بدء الجهاز
```

في `.env`:
```
APP_URL="https://erp.<your-domain>.com"
```
ثم أعد البناء والتشغيل. (`APP_URL` يُستخدم في روابط رسائل البريد، ونطاقه يُسمح له بتنفيذ العمليات.)

**تجربة سريعة بلا نطاق:** `cloudflared tunnel --url http://localhost:3000` يعطي رابطاً مؤقتاً `*.trycloudflare.com` — ضعه في `ALLOWED_ORIGINS` للتجربة فقط.

### طبقة أمان إضافية موصى بها: Cloudflare Access (مجاني حتى 50 مستخدماً)
Zero Trust → Access → Applications → Self-hosted → `erp.<your-domain>.com` → سياسة **Allow** لعناوين بريد الموظفين فقط.
يطلب Cloudflare رمزاً يُرسل لبريد الموظف **قبل** الوصول لصفحة دخول النظام — يحجب محاولات التخمين من الإنترنت.

---

## 3) تشغيل النظام تلقائياً مع بدء الجهاز

```powershell
npm install -g pm2 pm2-windows-startup
pm2 start npm --name southsada -- start
pm2 save
pm2-startup install
```

## 4) النسخ الاحتياطي بعد الانتقال
- قاعدة البيانات: Supabase يأخذ نسخة يومية تلقائياً (Database → Backups).
- المرفقات: انسخ `storage/uploads` يومياً (مهمة مجدولة `robocopy`).

## 5) ما يُسجَّل للرقابة عند العمل عبر الإنترنت
كل عملية في «سجل الرقابة والتدقيق» تحمل: عنوان IP الحقيقي للمستخدم (من Cloudflare مع رمز الدولة)، المتصفح والجهاز، الدور، والحالة قبل/بعد. محاولات الدخول الفاشلة تُسجل أيضاً.

---

## النشر على Vercel (الإنتاج الحالي)

الرابط الدائم: **https://south-sada.vercel.app** — الخوادم في فرانكفورت (`fra1`) بجوار قاعدة Supabase (`eu-central-1`، المشروع `south-sada-eu`) — الأقرب للأردن (~70ms). نُقلت من طوكيو في 2026-11-16 (المشروع القديم `south-sada-erp` احتياطي مؤقت).

| البند | الإعداد |
|---|---|
| البناء | `npm run build` = مزامنة مزود القاعدة + `prisma generate` + `next build` |
| المتغيرات | مضبوطة في Vercel ← Settings ← Environment Variables (الحساسة مشفّرة ولا تُعرض) |
| المرفقات | تُحفظ داخل قاعدة البيانات (جدول `AttachmentBlob`) — حد الإرسال الواحد 4 ميغابايت، والصور الكبيرة تُصغّر تلقائياً في المتصفح |
| التنبيهات البريدية | Vercel Cron يومياً الساعة 8:00 صباحاً بتوقيت عمّان (`vercel.json`) + الإشعارات الفورية عند كل حدث |
| الحماية من التخمين | 5 محاولات فاشلة للمستخدم أو 20 من نفس العنوان خلال 15 دقيقة = إيقاف مؤقت (محفوظ في القاعدة) |

**نشر تحديث جديد:** `npx vercel deploy --prod`
**نقل ملفات قديمة من القرص إلى القاعدة:** `npm run files:import`
**ملاحظة:** ملف `.env` و`prisma/*.db` و`storage/` لا تُرفع أبداً (`.vercelignore`).

# أدوات الذكاء الاصطناعي والتطوير — صدى الجنوب

## داخل النظام (للإدارة)
| الخدمة | الاستخدام | الإعداد |
|---|---|---|
| Perplexity | بحث ويب حيّ للمساعد الذكي (`web_research`) | إعدادات النظام ← خدمات الذكاء الاصطناعي، أو `PERPLEXITY_API_KEY` |
| Firecrawl | قراءة المواقع وبحث الويب للمساعد (`read_website`, `web_search`) | نفس المكان، أو `FIRECRAWL_API_KEY` |
| ElevenLabs | تعليق صوتي عربي للريلز والقصص (صفحة كل منشور) | نفس المكان، أو `ELEVENLABS_API_KEY` |
| Meta (كل الصلاحيات) | كل صلاحية تُمنح تفعّل ميزتها تلقائياً — القائمة الكاملة في إعدادات النظام ← ربط فيسبوك | `اختبار الاتصال` بعد منح الصلاحية |

## بيئة التطوير (Claude Code)
- **المهارات** في `.agents/skills` (المصدر: `skills-lock.json`) ومربوطة بـ Claude Code في `.claude/skills`:
  Remotion (16 مهارة فيديو)، HyperFrames (+Figma)، Impeccable (تصميم الواجهات)، Humanizer، find-skills.
  - استرجاعها على جهاز جديد: `npx skills experimental_install -a claude-code`
  - إضافة مهارة: `npx skills add <owner/repo> -a claude-code` — أو ابحث: `npx skills find <كلمة>`
- **Graphify** (خريطة معرفية للكود): `pip install graphifyy && graphify install --platform claude`، ثم `/graphify` داخل Claude Code.
- **خوادم MCP** في `.mcp.json`: Perplexity، Firecrawl، ElevenLabs — تقرأ المفاتيح من متغيرات البيئة
  (`PERPLEXITY_API_KEY`, `FIRECRAWL_API_KEY`, `ELEVENLABS_API_KEY`) فلا يُرفع أي سر للمستودع.
  ElevenLabs يعمل عبر `python -m uv tool run elevenlabs-mcp` (uv مثبت بـ pip).

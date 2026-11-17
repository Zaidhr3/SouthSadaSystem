/* عامل خدمة بسيط: لا يخزّن أي بيانات للشركة إطلاقاً — يعرض صفحة «لا يوجد اتصال» فقط عند انقطاع الشبكة */
const CACHE = "ssc-offline-v1";
const OFFLINE = "/offline.html";
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll([OFFLINE, "/icons/icon-192.png"])).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  if (e.request.mode !== "navigate") return; // كل شيء آخر يمر للشبكة مباشرة بلا تخزين
  e.respondWith(fetch(e.request).catch(() => caches.match(OFFLINE)));
});

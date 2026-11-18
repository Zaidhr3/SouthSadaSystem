import "server-only";

/**
 * طقس مواقع المشاريع — MET Norway Locationforecast (مجاني ويسمح بالاستخدام التجاري، CC BY 4.0؛ من قائمة public-apis/الطقس).
 * يُحوَّل التوقع الساعي إلى ملخص يومي + تنبيهات عمل للمقاول:
 *  - مطر: تأجيل الصب والعزل والأعمال الترابية
 *  - رياح ≥ 40 كم/س: إيقاف الرافعات والعمل على الارتفاعات (حد السلامة الشائع للرافعات البرجية ~ 50–72 كم/س؛ نحذّر مبكراً)
 *  - حرارة ≥ 35°: صب في الحر (تبريد الخلطة، صب مبكر، معالجة مكثفة)
 *  - حرارة ≤ 5°: صب في البرد (حماية الخرسانة من التجمد)
 */
export type DayForecast = { date: string; min: number; max: number; rain: number; windMax: number; symbol: string; warnings: string[] };

type MetSeries = { time: string; data: { instant: { details: { air_temperature: number; wind_speed: number; wind_speed_of_gust?: number } }; next_1_hours?: { summary: { symbol_code: string }; details: { precipitation_amount: number } }; next_6_hours?: { summary: { symbol_code: string }; details: { precipitation_amount: number } } } };

const UA = "SadaERP/1.0 github.com/Zaidhr3/SouthSadaSystem";
const ammanDate = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Amman" });

export const WEATHER_ICON: Record<string, string> = { clearsky: "☀️", fair: "🌤️", partlycloudy: "⛅", cloudy: "☁️", rain: "🌧️", lightrain: "🌦️", heavyrain: "🌧️", rainshowers: "🌦️", snow: "🌨️", sleet: "🌨️", fog: "🌫️", thunder: "⛈️" };
export const weatherIcon = (symbol: string) => {
  const s = symbol.replace(/_(day|night|polartwilight)$/, "");
  return WEATHER_ICON[s] ?? (s.includes("thunder") ? "⛈️" : s.includes("rain") ? "🌧️" : s.includes("snow") ? "🌨️" : s.includes("cloud") ? "☁️" : "🌤️");
};

export async function forecast(lat: number, lon: number, days = 3): Promise<DayForecast[]> {
  const r = await fetch(`https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat.toFixed(3)}&lon=${lon.toFixed(3)}`, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(6000),
    next: { revalidate: 1800 },
  });
  if (!r.ok) throw new Error(`MET Norway HTTP ${r.status}`);
  const j = (await r.json()) as { properties: { timeseries: MetSeries[] } };
  const by = new Map<string, MetSeries[]>();
  for (const s of j.properties.timeseries) {
    const d = ammanDate(s.time);
    (by.get(d) ?? by.set(d, []).get(d)!).push(s);
  }
  return [...by.entries()].slice(0, days).map(([date, rows]) => {
    const temps = rows.map((x) => x.data.instant.details.air_temperature);
    const winds = rows.map((x) => Math.max(x.data.instant.details.wind_speed, x.data.instant.details.wind_speed_of_gust ?? 0) * 3.6);
    // المطر: مجموع الساعي حيث يتوفر، وإلا فترات الست ساعات
    const rain = rows.reduce((a, x) => a + (x.data.next_1_hours?.details.precipitation_amount ?? 0), 0) || rows.filter((_, i) => i % 6 === 0).reduce((a, x) => a + (x.data.next_6_hours?.details.precipitation_amount ?? 0), 0);
    const midday = rows.find((x) => new Date(x.time).getUTCHours() === 10) ?? rows[Math.floor(rows.length / 2)];
    const symbol = midday.data.next_1_hours?.summary.symbol_code ?? midday.data.next_6_hours?.summary.symbol_code ?? "fair_day";
    const min = Math.round(Math.min(...temps));
    const max = Math.round(Math.max(...temps));
    const windMax = Math.round(Math.max(...winds));
    const warnings: string[] = [];
    if (rain >= 0.5) warnings.push(`مطر ${rain.toFixed(1)} ملم — أجّل الصب والعزل`);
    if (windMax >= 40) warnings.push(`رياح حتى ${windMax} كم/س — أوقف الرافعات والعمل على الارتفاعات`);
    if (max >= 35) warnings.push(`حر ${max}° — صب مبكر وتبريد ومعالجة مكثفة`);
    if (min <= 5) warnings.push(`برد ${min}° — احمِ الخرسانة من التجمد`);
    return { date, min, max, rain: Math.round(rain * 10) / 10, windMax, symbol, warnings };
  });
}

/** المهمة الصباحية: تنبيه مدير كل مشروع نشط بتحذيرات طقس «بكرة» في موقعه (مطر، رياح، حر، برد) */
export async function weatherAlerts() {
  const { db } = await import("../db");
  const { tenderCoords } = await import("./geo");
  const { notify } = await import("../notify");
  const ts = await db.tender.findMany({ where: { status: { in: ["WON", "EXECUTION"] }, archiveStage: 0 }, select: { id: true, name: true, location: true, lat: true, lon: true, managerId: true } });
  let sent = 0;
  for (const t of ts) {
    const c = await tenderCoords(t).catch(() => null);
    if (!c) continue;
    const days = await forecast(c.lat, c.lon, 2).catch(() => null);
    const tomorrow = days?.[1];
    if (!tomorrow?.warnings.length) continue;
    await notify([...(t.managerId ? [t.managerId] : []), "ADMIN"], { title: `طقس بكرة في موقع ${t.name}`, body: tomorrow.warnings.join(" · "), href: `/tenders/${t.id}` }, { email: true });
    sent++;
  }
  return { checked: ts.length, alerts: sent };
}

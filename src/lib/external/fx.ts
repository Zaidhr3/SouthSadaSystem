import "server-only";

/**
 * أسعار صرف الدينار الأردني — Currency-api (fawazahmed0، مجاني بلا مفتاح وبلا حدود؛ من قائمة public-apis/العملات)
 * لتسعير المواد المستوردة وعروض الموردين بالعملات الأجنبية. مصدر احتياطي تلقائي إن تعطل الأول.
 */
export const FX_CURRENCIES: Record<string, string> = { usd: "دولار أمريكي", eur: "يورو", aed: "درهم إماراتي", sar: "ريال سعودي", egp: "جنيه مصري", try: "ليرة تركية", cny: "يوان صيني" };

const SOURCES = ["https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/jod.json", "https://latest.currency-api.pages.dev/v1/currencies/jod.json"];

/** كم يساوي 1 دينار من كل عملة، و«كم دينار» لكل وحدة منها */
export async function jodRates(): Promise<{ date: string; rates: { code: string; name: string; perJod: number; jodPer: number }[] } | null> {
  for (const url of SOURCES) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(5000), next: { revalidate: 6 * 3600 } });
      if (!r.ok) continue;
      const j = (await r.json()) as { date: string; jod: Record<string, number> };
      return {
        date: j.date,
        rates: Object.entries(FX_CURRENCIES)
          .filter(([c]) => j.jod[c])
          .map(([code, name]) => ({ code: code.toUpperCase(), name, perJod: j.jod[code], jodPer: 1 / j.jod[code] })),
      };
    } catch {
      /* المصدر التالي */
    }
  }
  return null;
}

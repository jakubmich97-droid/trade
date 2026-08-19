import "server-only";
import type {
  AnalyzeRequest,
  InstrumentId,
  MacroContext,
  MacroEvent,
  MacroImpact,
  TradeAnalysis,
} from "@/lib/trade-analysis";

interface FmpEconomicEvent {
  date?: unknown;
  country?: unknown;
  currency?: unknown;
  event?: unknown;
  impact?: unknown;
  previous?: unknown;
  estimate?: unknown;
  actual?: unknown;
  unit?: unknown;
}

interface MacroSnapshot {
  provider: "FMP";
  status: "ACTIVE" | "UNAVAILABLE" | "ERROR";
  fetchedAt: string;
  events: MacroEvent[];
  riskLevel: MacroContext["risk_level"];
  blocksTrade: boolean;
  appliedRule: string;
  nearestEvent: MacroEvent | null;
  reanalysisAt: string | null;
}

interface MacroCacheEntry {
  expiresAt: number;
  events: FmpEconomicEvent[];
}

const macroCache = new Map<string, MacroCacheEntry>();
const IMPORTANT_EVENT = /(interest rate|rate decision|fomc|federal reserve|fed chair|powell|ecb|lagarde|central bank|inflation|consumer price|\bcpi\b|\bpce\b|non.?farm|payroll|employment change|unemployment|average hourly|gross domestic|\bgdp\b|retail sales|purchasing managers|\bpmi\b|\bism\b|jobless claims|consumer confidence|producer price|\bppi\b|industrial production|durable goods|\bjolts\b|zew|ifo|trade balance)/i;
const TARGET_CURRENCIES: Record<InstrumentId, string[]> = {
  DE40: ["EUR", "USD"],
  US100: ["USD"],
  US500: ["USD"],
  EURUSD: ["EUR", "USD"],
};
const COUNTRY_CURRENCY: Record<string, string> = {
  US: "USD",
  USA: "USD",
  "UNITED STATES": "USD",
  DE: "EUR",
  DEU: "EUR",
  GERMANY: "EUR",
  EU: "EUR",
  EA: "EUR",
  "EURO AREA": "EUR",
  EUROZONE: "EUR",
};

function dateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}

function parseEventDate(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const trimmed = value.trim();
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(trimmed)
    ? `${trimmed.replace(" ", "T")}${trimmed.length === 16 ? ":00" : ""}Z`
    : trimmed;
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? new Date(timestamp) : null;
}

function valueOrNull(value: unknown): number | string | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) return value.trim();
  return null;
}

function normalizeImpact(value: unknown): MacroImpact {
  const impact = typeof value === "string" ? value.toUpperCase() : "";
  if (impact.includes("HIGH")) return "HIGH";
  if (impact.includes("MEDIUM") || impact.includes("MODERATE")) return "MEDIUM";
  return "LOW";
}

function currencyFor(raw: FmpEconomicEvent) {
  if (typeof raw.currency === "string" && raw.currency.trim()) return raw.currency.trim().toUpperCase();
  const country = typeof raw.country === "string" ? raw.country.trim().toUpperCase() : "";
  return COUNTRY_CURRENCY[country] ?? "";
}

function normalizeEvent(raw: FmpEconomicEvent, analysisAt: Date): MacroEvent | null {
  const date = parseEventDate(raw.date);
  const event = typeof raw.event === "string" ? raw.event.trim() : "";
  if (!date || !event) return null;
  return {
    date: date.toISOString(),
    country: typeof raw.country === "string" ? raw.country.trim() : "",
    currency: currencyFor(raw),
    event,
    impact: normalizeImpact(raw.impact),
    previous: valueOrNull(raw.previous),
    estimate: valueOrNull(raw.estimate),
    actual: valueOrNull(raw.actual),
    unit: typeof raw.unit === "string" && raw.unit.trim() ? raw.unit.trim() : null,
    minutes_from_analysis: Math.round((date.getTime() - analysisAt.getTime()) / 60_000),
  };
}

function isRelevant(event: MacroEvent, instrument: InstrumentId) {
  if (!TARGET_CURRENCIES[instrument].includes(event.currency)) return false;
  if (!IMPORTANT_EVENT.test(event.event)) return false;
  // Americká data mají na DE40 sekundární dopad; blokujeme proto jen události označené jako High.
  if (instrument === "DE40" && event.currency === "USD" && event.impact !== "HIGH") return false;
  return event.impact === "HIGH" || event.impact === "MEDIUM";
}

function nextM15After(eventDate: string, quietMinutes: number) {
  const readyAt = Date.parse(eventDate) + quietMinutes * 60_000;
  const nextClose = Math.ceil(readyAt / (15 * 60_000)) * 15 * 60_000 + 60_000;
  return new Date(nextClose).toISOString();
}

function evaluateEvents(events: MacroEvent[]): Omit<MacroSnapshot, "provider" | "status" | "fetchedAt" | "events"> {
  const blockers = events.filter((event) => {
    if (event.impact === "HIGH") return event.minutes_from_analysis >= -15 && event.minutes_from_analysis <= 60;
    return event.minutes_from_analysis >= -10 && event.minutes_from_analysis <= 30;
  });
  const blocker = blockers.sort((a, b) => Math.abs(a.minutes_from_analysis) - Math.abs(b.minutes_from_analysis))[0] ?? null;
  const nearestEvent = events
    .slice()
    .sort((a, b) => {
      const aUpcoming = a.minutes_from_analysis >= 0 ? 0 : 1;
      const bUpcoming = b.minutes_from_analysis >= 0 ? 0 : 1;
      return aUpcoming - bUpcoming || Math.abs(a.minutes_from_analysis) - Math.abs(b.minutes_from_analysis);
    })[0] ?? null;

  if (blocker) {
    const quietMinutes = blocker.impact === "HIGH" ? 15 : 10;
    const before = blocker.minutes_from_analysis >= 0;
    return {
      riskLevel: blocker.impact,
      blocksTrade: true,
      appliedRule: before
        ? `${blocker.impact === "HIGH" ? "Významná" : "Středně významná"} událost nastane za ${blocker.minutes_from_analysis} min; nové vstupy jsou blokované.`
        : `Od zveřejnění události uplynulo ${Math.abs(blocker.minutes_from_analysis)} min; čekáme na uklidnění volatility a uzavření M15 svíčky.`,
      nearestEvent: blocker,
      reanalysisAt: nextM15After(blocker.date, quietMinutes),
    };
  }

  const highSoon = events.find((event) => event.impact === "HIGH" && event.minutes_from_analysis > 60 && event.minutes_from_analysis <= 240);
  return {
    riskLevel: highSoon ? "MEDIUM" : "LOW",
    blocksTrade: false,
    appliedRule: highSoon
      ? `Významná událost se čeká za ${highSoon.minutes_from_analysis} min. Obchod není blokovaný, ale neměl by být držen přes její zveřejnění bez nové analýzy.`
      : "V ochranném časovém okně není žádná relevantní makroekonomická událost.",
    nearestEvent,
    reanalysisAt: null,
  };
}

async function fetchFmpEvents(analysisAt: Date): Promise<FmpEconomicEvent[]> {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) return [];
  const fromDate = new Date(analysisAt.getTime() - 24 * 60 * 60_000);
  const toDate = new Date(analysisAt.getTime() + 48 * 60 * 60_000);
  const cacheKey = `${dateOnly(fromDate)}:${dateOnly(toDate)}`;
  const cached = macroCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.events;

  const url = new URL("https://financialmodelingprep.com/stable/economic-calendar");
  url.searchParams.set("from", dateOnly(fromDate));
  url.searchParams.set("to", dateOnly(toDate));
  url.searchParams.set("apikey", apiKey);
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error(`FMP economic calendar odpověděl stavem ${response.status}.`);
  const payload = await response.json() as unknown;
  if (!Array.isArray(payload)) throw new Error("FMP economic calendar vrátil neočekávaný formát.");
  const events = payload as FmpEconomicEvent[];
  macroCache.set(cacheKey, { events, expiresAt: Date.now() + 30 * 60_000 });
  return events;
}

export async function getMacroSnapshot(instrument: InstrumentId, analysisAtValue: string): Promise<MacroSnapshot> {
  const fetchedAt = new Date().toISOString();
  const analysisAt = new Date(analysisAtValue);
  if (!process.env.FMP_API_KEY) {
    return {
      provider: "FMP",
      status: "UNAVAILABLE",
      fetchedAt,
      events: [],
      riskLevel: "UNKNOWN",
      blocksTrade: false,
      appliedRule: "Makro filtr čeká na nastavení serverového klíče FMP_API_KEY.",
      nearestEvent: null,
      reanalysisAt: null,
    };
  }

  try {
    const rawEvents = await fetchFmpEvents(analysisAt);
    const events = rawEvents
      .map((event) => normalizeEvent(event, analysisAt))
      .filter((event): event is MacroEvent => Boolean(event))
      .filter((event) => isRelevant(event, instrument))
      .filter((event) => event.minutes_from_analysis >= -120 && event.minutes_from_analysis <= 24 * 60)
      .sort((a, b) => Date.parse(a.date) - Date.parse(b.date))
      .slice(0, 8);
    const evaluation = evaluateEvents(events);
    return { provider: "FMP", status: "ACTIVE", fetchedAt, events, ...evaluation };
  } catch (error) {
    console.error("FMP macro calendar error", error instanceof Error ? error.message : "unknown error");
    return {
      provider: "FMP",
      status: "ERROR",
      fetchedAt,
      events: [],
      riskLevel: "UNKNOWN",
      blocksTrade: true,
      appliedRule: "Makro kalendář je dočasně nedostupný; aktivní technický signál je z bezpečnostních důvodů blokovaný.",
      nearestEvent: null,
      reanalysisAt: new Date(analysisAt.getTime() + 15 * 60_000).toISOString(),
    };
  }
}

export function applyMacroFilter(analysis: TradeAnalysis, request: AnalyzeRequest, snapshot: MacroSnapshot): TradeAnalysis {
  const technicalVerdict = analysis.verdict;
  const context: MacroContext = {
    provider: snapshot.provider,
    status: snapshot.status,
    fetched_at: snapshot.fetchedAt,
    risk_level: snapshot.riskLevel,
    blocks_trade: snapshot.blocksTrade,
    technical_verdict: technicalVerdict,
    technical_confidence: analysis.confidence,
    applied_rule: snapshot.appliedRule,
    nearest_event: snapshot.nearestEvent,
    events: snapshot.events,
    reanalysis_at: snapshot.reanalysisAt,
  };

  const macroRisk = snapshot.status === "UNAVAILABLE"
    ? "Makroekonomický filtr není aktivní, dokud nebude na serveru nastaven bezplatný klíč FMP. Před vstupem zkontroluj ekonomický kalendář ručně."
    : snapshot.appliedRule;
  const base: TradeAnalysis = { ...analysis, macro_context: context, risks: [macroRisk, ...analysis.risks] };
  if (!snapshot.blocksTrade) return base;

  const eventName = snapshot.nearestEvent?.event ?? "nedostupnost ekonomického kalendáře";
  const recommendedAt = snapshot.reanalysisAt ?? new Date(Date.parse(request.xtbPriceAt) + 15 * 60_000).toISOString();
  const waitMinutes = Math.max(1, Math.ceil((Date.parse(recommendedAt) - Date.parse(request.xtbPriceAt)) / 60_000));
  return {
    ...base,
    verdict: "NO_TRADE",
    confidence: technicalVerdict === "NO_TRADE" ? analysis.confidence : Math.max(analysis.confidence, 85),
    market_read: technicalVerdict === "NO_TRADE"
      ? `${analysis.market_read} Makro filtr současně blokuje vstup kvůli události: ${eventName}.`
      : `Technický model původně vyhodnotil ${technicalVerdict}, ale makro filtr obchod zablokoval kvůli události: ${eventName}.`,
    setup: {
      entry_zone: "Bez vstupu – zvýšené makroekonomické riziko",
      entry_price: null,
      stop_loss: "Nestanovuje se",
      stop_loss_price: null,
      take_profit_1: "Nestanovuje se",
      take_profit_1_price: null,
      take_profit_2: "Nestanovuje se",
      take_profit_2_price: null,
      risk_reward: "Obchod se neotevírá",
      invalidation: `Počkej do ${recommendedAt} a spusť analýzu znovu s aktuální cenou XTB.`,
      holding_period: "Počkat na zveřejnění a uzavření M15 svíčky",
      holding_period_min_minutes: null,
      holding_period_max_minutes: null,
      time_stop_rule: "Bez aktivního obchodu.",
    },
    reasons: [`Makro filtr: ${snapshot.appliedRule}`, ...analysis.reasons],
    reanalysis: {
      wait_minutes: waitMinutes,
      recommended_at: recommendedAt,
      trigger_timeframe: "M15",
      reason: `Po události „${eventName}“ počkej na uzavření nové M15 svíčky a zadej čerstvou cenu z XTB.`,
    },
    next_step: `Nevstupuj podle původního technického signálu. Novou analýzu spusť přibližně za ${waitMinutes} min po uklidnění makro volatility.`,
  };
}

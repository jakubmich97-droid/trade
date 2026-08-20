import { NextResponse } from "next/server";
import { getRealTimeRates, type JsonItem } from "dukascopy-node";
import {
  buildTradeAnalysis,
  type CzkFxRates,
  type AnalysisTimeframe,
  type AnalyzeRequest,
  type InstrumentId,
  type MarketCandle,
  type MarketReferenceQuote,
} from "@/lib/trade-analysis";
import { persistAnalysis, type PersistenceResult } from "@/lib/trade-journal";

export const runtime = "nodejs";
export const maxDuration = 60;

const INSTRUMENTS = {
  DE40: "deuidxeur",
  US100: "usatechidxusd",
  US500: "usa500idxusd",
  EURUSD: "eurusd",
} as const;

const TIMEFRAMES = {
  H1: { api: "h1", duration: 60 * 60 * 1000 },
  M15: { api: "m15", duration: 15 * 60 * 1000 },
  M5: { api: "m5", duration: 5 * 60 * 1000 },
} as const;

interface CacheEntry {
  expiresAt: number;
  market: Record<AnalysisTimeframe, MarketCandle[]>;
  referenceQuote: MarketReferenceQuote;
}

const marketCache = new Map<InstrumentId, CacheEntry>();
let fxCache: { expiresAt: number; rates: CzkFxRates } | null = null;

const REFERENCE_MAX_AGE_MS = {
  M1: 10 * 60_000,
  M5: 20 * 60_000,
  H1: 2 * 60 * 60_000,
} as const;

class FreshReferenceQuoteError extends Error {
  constructor(instrument: InstrumentId) {
    super(`Dukascopy pro ${instrument} právě neposkytuje dostatečně čerstvou referenční cenu. Zkus analýzu později.`);
    this.name = "FreshReferenceQuoteError";
  }
}

function isInstrument(value: unknown): value is InstrumentId {
  return typeof value === "string" && value in INSTRUMENTS;
}

function validate(body: Partial<AnalyzeRequest>): string | null {
  if (!isInstrument(body.instrument)) return "Vyber podporovaný instrument.";
  if (!Number.isFinite(body.riskPercent) || !body.riskPercent || body.riskPercent < 0.1 || body.riskPercent > 5) {
    return "Riziko musí být mezi 0,1 a 5 %.";
  }
  if (!Number.isFinite(body.maxMarginPercent) || !body.maxMarginPercent || body.maxMarginPercent < 5 || body.maxMarginPercent > 100) {
    return "Maximální využití marže musí být mezi 5 a 100 %.";
  }
  if (!Number.isFinite(body.accountSize) || !body.accountSize || body.accountSize <= 0) return "Velikost účtu je povinná a musí být kladné číslo.";
  return null;
}

function isFreshReference(timestamp: number, maxAgeMs: number, now = Date.now()) {
  return timestamp <= now && now - timestamp <= maxAgeMs;
}

function quoteFromRows(
  rows: JsonItem[],
  timeframe: MarketReferenceQuote["timeframe"],
  duration: number,
  maxAgeMs: number,
): MarketReferenceQuote | null {
  const now = Date.now();
  const lastClosed = rows
    .filter((row) => row.timestamp + duration <= now && Number.isFinite(row.close) && row.close > 0)
    .at(-1);
  if (!lastClosed) return null;
  const timestamp = lastClosed.timestamp + duration;
  if (!isFreshReference(timestamp, maxAgeMs, now)) return null;
  return { price: lastClosed.close, timestamp, timeframe };
}

async function fetchM1ReferenceQuote(instrument: InstrumentId): Promise<MarketReferenceQuote | null> {
  for (const last of [10, 60]) {
    try {
      const rows = await getRealTimeRates({
        instrument: INSTRUMENTS[instrument],
        timeframe: "m1",
        format: "json",
        last,
        volumes: false,
        priceType: "bid",
      });
      const quote = quoteFromRows(rows as JsonItem[], "M1", 60_000, REFERENCE_MAX_AGE_MS.M1);
      if (quote) return quote;
    } catch (error) {
      console.warn("Dukascopy M1 reference attempt failed", { instrument, last, error: String(error) });
    }
  }
  return null;
}

function quoteFromMarketCandles(
  candles: MarketCandle[],
  timeframe: "M5" | "H1",
  duration: number,
): MarketReferenceQuote | null {
  const lastCandle = candles.at(-1);
  if (!lastCandle || !Number.isFinite(lastCandle.close) || lastCandle.close <= 0) return null;
  const timestamp = lastCandle.timestamp + duration;
  if (!isFreshReference(timestamp, REFERENCE_MAX_AGE_MS[timeframe])) return null;
  return { price: lastCandle.close, timestamp, timeframe };
}

function resolveReferenceQuote(
  instrument: InstrumentId,
  market: Record<AnalysisTimeframe, MarketCandle[]>,
  m1Quote: MarketReferenceQuote | null,
): MarketReferenceQuote {
  if (m1Quote) return m1Quote;
  const m5Quote = quoteFromMarketCandles(market.M5, "M5", TIMEFRAMES.M5.duration);
  if (m5Quote) return m5Quote;
  const h1Quote = quoteFromMarketCandles(market.H1, "H1", TIMEFRAMES.H1.duration);
  if (h1Quote) return h1Quote;
  throw new FreshReferenceQuoteError(instrument);
}

async function fetchEcbRate(currency: "CZK" | "USD") {
  const response = await fetch(`https://data-api.ecb.europa.eu/service/data/EXR/D.${currency}.EUR.SP00.A?format=csvdata&lastNObservations=1`, {
    cache: "no-store",
    headers: { Accept: "text/csv" },
  });
  if (!response.ok) throw new Error(`ECB kurz ${currency} není dostupný.`);
  const rows = (await response.text()).trim().split(/\r?\n/);
  const columns = rows.at(-1)?.split(",");
  const value = Number(columns?.[7]);
  const asOf = columns?.[6];
  if (!Number.isFinite(value) || !asOf) throw new Error(`ECB kurz ${currency} nemá platný formát.`);
  return { value, asOf };
}

async function getCzkFxRates(): Promise<CzkFxRates> {
  if (fxCache && fxCache.expiresAt > Date.now()) return fxCache.rates;
  const [czkPerEur, usdPerEur] = await Promise.all([fetchEcbRate("CZK"), fetchEcbRate("USD")]);
  const rates: CzkFxRates = {
    czkPerEur: czkPerEur.value,
    czkPerUsd: czkPerEur.value / usdPerEur.value,
    asOf: czkPerEur.asOf,
    source: "ECB",
  };
  fxCache = { rates, expiresAt: Date.now() + 6 * 60 * 60_000 };
  return rates;
}

async function fetchCandles(instrument: InstrumentId, timeframe: AnalysisTimeframe): Promise<MarketCandle[]> {
  const config = TIMEFRAMES[timeframe];
  const rows = await getRealTimeRates({
    instrument: INSTRUMENTS[instrument],
    timeframe: config.api,
    format: "json",
    last: 405,
    volumes: true,
    priceType: "bid",
  });
  const now = Date.now();
  return (rows as JsonItem[])
    .filter((row) => row.timestamp + config.duration <= now)
    .slice(-400)
    .map((row) => ({
      timestamp: row.timestamp,
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
      volume: row.volume ?? 0,
    }));
}

async function getMarketData(instrument: InstrumentId) {
  const cached = marketCache.get(instrument);
  if (cached && cached.expiresAt > Date.now()) return cached;

  const [H1, M15, M5, m1Quote] = await Promise.all([
    fetchCandles(instrument, "H1"),
    fetchCandles(instrument, "M15"),
    fetchCandles(instrument, "M5"),
    fetchM1ReferenceQuote(instrument),
  ]);
  const market = { H1, M15, M5 };
  const referenceQuote = resolveReferenceQuote(instrument, market, m1Quote);
  const entry = { market, referenceQuote, expiresAt: Date.now() + 60_000 };
  marketCache.set(instrument, entry);
  return entry;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<AnalyzeRequest>;
    const validationError = validate(body);
    if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });

    const input: AnalyzeRequest = {
      instrument: body.instrument!,
      riskPercent: body.riskPercent!,
      maxMarginPercent: body.maxMarginPercent!,
      accountSize: body.accountSize!,
    };
    const [{ market, referenceQuote }, fxRates] = await Promise.all([
      getMarketData(input.instrument),
      getCzkFxRates(),
    ]);
    const analysis = buildTradeAnalysis(input, market, referenceQuote, fxRates);
    let persistence: PersistenceResult = { stored: false, analysisId: null };
    try {
      persistence = await persistAnalysis(input, analysis);
    } catch (databaseError) {
      console.error("Neon persistence error", databaseError);
    }
    return NextResponse.json({ analysis, persistence });
  } catch (error) {
    console.error("Dukascopy analysis error", error);
    const isCurrencyError = error instanceof Error && error.message.startsWith("ECB kurz");
    const isReferenceError = error instanceof FreshReferenceQuoteError;
    return NextResponse.json(
      {
        error: isReferenceError
          ? error.message
          : isCurrencyError
            ? "Kurzová data ECB pro výpočet objemu nejsou právě dostupná. Zkus analýzu znovu za chvíli."
            : "Tržní data se teď nepodařilo načíst. Zkus analýzu znovu za chvíli.",
      },
      { status: isReferenceError ? 503 : 502 },
    );
  }
}

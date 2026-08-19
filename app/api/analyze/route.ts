import { NextResponse } from "next/server";
import { getRealTimeRates, type JsonItem } from "dukascopy-node";
import {
  buildTradeAnalysis,
  type CzkFxRates,
  type AnalysisTimeframe,
  type AnalyzeRequest,
  type InstrumentId,
  type MarketCandle,
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
}

const marketCache = new Map<InstrumentId, CacheEntry>();
let fxCache: { expiresAt: number; rates: CzkFxRates } | null = null;

function isInstrument(value: unknown): value is InstrumentId {
  return typeof value === "string" && value in INSTRUMENTS;
}

function validate(body: Partial<AnalyzeRequest>): string | null {
  if (!isInstrument(body.instrument)) return "Vyber podporovaný instrument.";
  if (!Number.isFinite(body.xtbPrice) || !body.xtbPrice || body.xtbPrice <= 0) return "Aktuální cena XTB je povinná a musí být kladné číslo.";
  if (typeof body.xtbPriceAt !== "string" || !body.xtbPriceAt) return "Čas ceny XTB je povinný.";
  const priceTime = Date.parse(body.xtbPriceAt);
  if (!Number.isFinite(priceTime)) return "Čas ceny XTB není platný.";
  const age = Date.now() - priceTime;
  if (age < -5 * 60_000) return "Čas ceny XTB nesmí být více než 5 minut v budoucnosti.";
  if (age > 30 * 60_000) return "Cena XTB je starší než 30 minut. Aktualizuj cenu a stiskni Nyní.";
  if (!Number.isFinite(body.riskPercent) || !body.riskPercent || body.riskPercent < 0.1 || body.riskPercent > 5) {
    return "Riziko musí být mezi 0,1 a 5 %.";
  }
  if (!Number.isFinite(body.maxMarginPercent) || !body.maxMarginPercent || body.maxMarginPercent < 5 || body.maxMarginPercent > 100) {
    return "Maximální využití marže musí být mezi 5 a 100 %.";
  }
  if (!Number.isFinite(body.accountSize) || !body.accountSize || body.accountSize <= 0) return "Velikost účtu je povinná a musí být kladné číslo.";
  return null;
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

async function getMarket(instrument: InstrumentId) {
  const cached = marketCache.get(instrument);
  if (cached && cached.expiresAt > Date.now()) return cached.market;

  const [H1, M15, M5] = await Promise.all([
    fetchCandles(instrument, "H1"),
    fetchCandles(instrument, "M15"),
    fetchCandles(instrument, "M5"),
  ]);
  const market = { H1, M15, M5 };
  marketCache.set(instrument, { market, expiresAt: Date.now() + 60_000 });
  return market;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<AnalyzeRequest>;
    const validationError = validate(body);
    if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });

    const input: AnalyzeRequest = {
      instrument: body.instrument!,
      xtbPrice: body.xtbPrice!,
      xtbPriceAt: body.xtbPriceAt!,
      riskPercent: body.riskPercent!,
      maxMarginPercent: body.maxMarginPercent!,
      accountSize: body.accountSize!,
    };
    const [market, fxRates] = await Promise.all([getMarket(input.instrument), getCzkFxRates()]);
    const analysis = buildTradeAnalysis(input, market, fxRates);
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
    return NextResponse.json(
      { error: isCurrencyError ? "Kurzová data ECB pro výpočet objemu nejsou právě dostupná. Zkus analýzu znovu za chvíli." : "Tržní data se teď nepodařilo načíst. Zkus analýzu znovu za chvíli." },
      { status: 502 },
    );
  }
}

import { NextResponse } from "next/server";
import { getRealTimeRates, type JsonItem } from "dukascopy-node";
import {
  buildTradeAnalysis,
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

function isInstrument(value: unknown): value is InstrumentId {
  return typeof value === "string" && value in INSTRUMENTS;
}

function validate(body: Partial<AnalyzeRequest>): string | null {
  if (!isInstrument(body.instrument)) return "Vyber podporovaný instrument.";
  if (body.xtbPrice !== null && body.xtbPrice !== undefined && (!Number.isFinite(body.xtbPrice) || body.xtbPrice <= 0)) {
    return "Aktuální cena XTB musí být kladné číslo.";
  }
  if (!Number.isFinite(body.riskPercent) || !body.riskPercent || body.riskPercent < 0.1 || body.riskPercent > 5) {
    return "Riziko musí být mezi 0,1 a 5 %.";
  }
  if (body.accountSize !== null && body.accountSize !== undefined && (!Number.isFinite(body.accountSize) || body.accountSize <= 0)) {
    return "Velikost účtu musí být kladné číslo.";
  }
  return null;
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
      xtbPrice: body.xtbPrice ?? null,
      riskPercent: body.riskPercent!,
      accountSize: body.accountSize ?? null,
    };
    const market = await getMarket(input.instrument);
    const analysis = buildTradeAnalysis(input, market);
    let persistence: PersistenceResult = { stored: false, analysisId: null, paperTradeId: null };
    try {
      persistence = await persistAnalysis(input, analysis);
    } catch (databaseError) {
      console.error("Neon persistence error", databaseError);
    }
    return NextResponse.json({ analysis, persistence });
  } catch (error) {
    console.error("Dukascopy analysis error", error);
    return NextResponse.json(
      { error: "Tržní data se teď nepodařilo načíst. Zkus analýzu znovu za chvíli." },
      { status: 502 },
    );
  }
}

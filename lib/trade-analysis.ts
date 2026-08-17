export type Verdict = "LONG" | "SHORT" | "NO_TRADE";
export type Signal = "bullish" | "bearish" | "neutral";
export type InstrumentId = "DE40" | "US100" | "EURUSD";
export type AnalysisTimeframe = "H1" | "M15" | "M5";

export interface MarketCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface IndicatorReading {
  name: string;
  reading: string;
  signal: Signal;
}

export interface TimeframeReading {
  timeframe: AnalysisTimeframe;
  signal: Signal;
  close: number;
  ema20: number;
  ema50: number;
  ema200: number;
  rsi14: number;
  atr14: number;
  candles: number;
}

export interface TradeAnalysis {
  verdict: Verdict;
  market_read: string;
  confidence: number;
  data_quality: "good" | "limited";
  detected: {
    instrument: InstrumentId;
    timeframes: TimeframeReading[];
    indicators: IndicatorReading[];
  };
  setup: {
    entry_zone: string;
    stop_loss: string;
    take_profit_1: string;
    take_profit_2: string;
    risk_reward: string;
    invalidation: string;
  };
  reasons: string[];
  risks: string[];
  next_step: string;
  disclaimer: string;
  data: {
    source: "Dukascopy";
    last_updated: string;
    source_price: number;
    xtb_price: number | null;
    price_offset: number;
  };
}

export interface AnalyzeRequest {
  instrument: InstrumentId;
  xtbPrice: number | null;
  riskPercent: number;
  accountSize: number | null;
}

interface Snapshot extends TimeframeReading {
  last: MarketCandle;
  previous: MarketCandle;
  recentHigh: number;
  recentLow: number;
  score: number;
  notes: string[];
}

const PRICE_DIGITS: Record<InstrumentId, number> = { DE40: 1, US100: 1, EURUSD: 5 };

function lastValue(values: number[]) {
  const value = values.at(-1);
  if (value === undefined || !Number.isFinite(value)) throw new Error("Pro výpočet indikátoru není dostatek platných dat.");
  return value;
}

function ema(values: number[], period: number) {
  if (values.length < period) throw new Error(`Pro EMA ${period} chybí data.`);
  const multiplier = 2 / (period + 1);
  let current = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  const result = Array(period - 1).fill(Number.NaN) as number[];
  result.push(current);
  for (let index = period; index < values.length; index += 1) {
    current = (values[index] - current) * multiplier + current;
    result.push(current);
  }
  return result;
}

function rsi(values: number[], period = 14) {
  if (values.length <= period) throw new Error("Pro RSI chybí data.");
  let gains = 0;
  let losses = 0;
  for (let index = 1; index <= period; index += 1) {
    const change = values[index] - values[index - 1];
    gains += Math.max(change, 0);
    losses += Math.max(-change, 0);
  }
  let averageGain = gains / period;
  let averageLoss = losses / period;
  let current = averageLoss === 0 ? 100 : 100 - 100 / (1 + averageGain / averageLoss);
  for (let index = period + 1; index < values.length; index += 1) {
    const change = values[index] - values[index - 1];
    averageGain = (averageGain * (period - 1) + Math.max(change, 0)) / period;
    averageLoss = (averageLoss * (period - 1) + Math.max(-change, 0)) / period;
    current = averageLoss === 0 ? 100 : 100 - 100 / (1 + averageGain / averageLoss);
  }
  return current;
}

function atr(candles: MarketCandle[], period = 14) {
  if (candles.length <= period) throw new Error("Pro ATR chybí data.");
  const ranges = candles.slice(1).map((candle, index) => {
    const previousClose = candles[index].close;
    return Math.max(candle.high - candle.low, Math.abs(candle.high - previousClose), Math.abs(candle.low - previousClose));
  });
  let current = ranges.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  for (let index = period; index < ranges.length; index += 1) current = (current * (period - 1) + ranges[index]) / period;
  return current;
}

function formatPrice(instrument: InstrumentId, value: number) {
  return value.toLocaleString("cs-CZ", { minimumFractionDigits: PRICE_DIGITS[instrument], maximumFractionDigits: PRICE_DIGITS[instrument] });
}

function signalFromScore(score: number): Signal {
  if (score >= 2) return "bullish";
  if (score <= -2) return "bearish";
  return "neutral";
}

function snapshot(timeframe: AnalysisTimeframe, candles: MarketCandle[]): Snapshot {
  if (candles.length < 220) throw new Error(`${timeframe}: dorazilo méně než 220 svíček.`);
  const closes = candles.map((candle) => candle.close);
  const last = candles.at(-1)!;
  const previous = candles.at(-2)!;
  const ema20 = lastValue(ema(closes, 20));
  const ema50 = lastValue(ema(closes, 50));
  const ema200 = lastValue(ema(closes, 200));
  const rsi14 = rsi(closes);
  const atr14 = atr(candles);
  const recent = candles.slice(-20, -1);
  const recentHigh = Math.max(...recent.map((candle) => candle.high));
  const recentLow = Math.min(...recent.map((candle) => candle.low));
  let score = 0;
  const notes: string[] = [];

  if (last.close > ema200 && ema50 > ema200) {
    score += 2;
    notes.push("cena i EMA 50 jsou nad EMA 200");
  } else if (last.close < ema200 && ema50 < ema200) {
    score -= 2;
    notes.push("cena i EMA 50 jsou pod EMA 200");
  }
  if (ema20 > ema50 && last.close > ema20) {
    score += 2;
    notes.push("krátké EMA potvrzují růst");
  } else if (ema20 < ema50 && last.close < ema20) {
    score -= 2;
    notes.push("krátké EMA potvrzují pokles");
  }
  if (rsi14 >= 52 && rsi14 <= 68) score += 1;
  else if (rsi14 <= 48 && rsi14 >= 32) score -= 1;
  else if (rsi14 > 72 || rsi14 < 28) notes.push("RSI je v extrémní oblasti");

  const range = Math.max(last.high - last.low, Number.EPSILON);
  const bodyStrength = Math.abs(last.close - last.open) / range;
  if (last.close > previous.high && last.close > last.open && bodyStrength >= 0.45) {
    score += 2;
    notes.push("poslední svíčka potvrzuje bullish průraz");
  } else if (last.close < previous.low && last.close < last.open && bodyStrength >= 0.45) {
    score -= 2;
    notes.push("poslední svíčka potvrzuje bearish průraz");
  }

  return { timeframe, signal: signalFromScore(score), close: last.close, ema20, ema50, ema200, rsi14, atr14, candles: candles.length, last, previous, recentHigh, recentLow, score, notes };
}

function timeframeReading(value: Snapshot): TimeframeReading {
  return { timeframe: value.timeframe, signal: value.signal, close: value.close, ema20: value.ema20, ema50: value.ema50, ema200: value.ema200, rsi14: value.rsi14, atr14: value.atr14, candles: value.candles };
}

export function buildTradeAnalysis(request: AnalyzeRequest, market: Record<AnalysisTimeframe, MarketCandle[]>): TradeAnalysis {
  const h1 = snapshot("H1", market.H1);
  const m15 = snapshot("M15", market.M15);
  const m5 = snapshot("M5", market.M5);
  const snapshots = [h1, m15, m5];
  const totalScore = snapshots.reduce((sum, item) => sum + item.score, 0);
  const longAligned = snapshots.every((item) => item.signal === "bullish");
  const shortAligned = snapshots.every((item) => item.signal === "bearish");
  const momentumSafeLong = m5.rsi14 < 72 && m15.rsi14 < 72;
  const momentumSafeShort = m5.rsi14 > 28 && m15.rsi14 > 28;
  let verdict: Verdict = "NO_TRADE";
  if (longAligned && totalScore >= 10 && momentumSafeLong) verdict = "LONG";
  if (shortAligned && totalScore <= -10 && momentumSafeShort) verdict = "SHORT";

  const sourcePrice = m5.close;
  const xtbPrice = request.xtbPrice && request.xtbPrice > 0 ? request.xtbPrice : null;
  const priceOffset = xtbPrice === null ? 0 : xtbPrice - sourcePrice;
  const entry = sourcePrice + priceOffset;
  const swingWindow = market.M5.slice(-12, -1);
  const swingLow = Math.min(...swingWindow.map((candle) => candle.low)) + priceOffset;
  const swingHigh = Math.max(...swingWindow.map((candle) => candle.high)) + priceOffset;
  let stop = entry;
  if (verdict === "LONG") stop = Math.min(swingLow - m5.atr14 * 0.15, entry - m5.atr14 * 0.9);
  if (verdict === "SHORT") stop = Math.max(swingHigh + m5.atr14 * 0.15, entry + m5.atr14 * 0.9);
  const riskDistance = Math.abs(entry - stop);
  const direction = verdict === "SHORT" ? -1 : 1;
  const tp1 = entry + direction * riskDistance * 1.5;
  const tp2 = entry + direction * riskDistance * 2;
  const confidence = verdict === "NO_TRADE" ? Math.min(86, 52 + Math.max(0, 8 - Math.abs(totalScore)) * 4) : Math.min(90, 58 + Math.abs(totalScore) * 2);
  const deviation = xtbPrice === null ? 0 : Math.abs(priceOffset / sourcePrice) * 100;
  const offsetWarning = deviation > (request.instrument === "EURUSD" ? 0.2 : 0.5) ? `Zadaná cena XTB se od Dukascopy liší o ${deviation.toFixed(2)} %. Přesné úrovně proto ověř přímo v xStation.` : null;

  const indicators: IndicatorReading[] = snapshots.flatMap((item) => [
    { name: `${item.timeframe} trend`, reading: `Close ${formatPrice(request.instrument, item.close)}, EMA 20/50/200: ${formatPrice(request.instrument, item.ema20)} / ${formatPrice(request.instrument, item.ema50)} / ${formatPrice(request.instrument, item.ema200)}`, signal: item.signal },
    { name: `${item.timeframe} RSI 14`, reading: item.rsi14.toFixed(1), signal: item.rsi14 >= 52 && item.rsi14 <= 68 ? "bullish" : item.rsi14 <= 48 && item.rsi14 >= 32 ? "bearish" : "neutral" },
  ]);
  const reasons = snapshots.map((item) => `${item.timeframe}: ${item.notes.length ? item.notes.join(", ") : "signály nejsou dostatečně jednoznačné"} (skóre ${item.score > 0 ? "+" : ""}${item.score}).`);
  const setup = verdict === "NO_TRADE" ? {
    entry_zone: "Bez vstupu – timeframy nejsou ve stejné silné konfluenci",
    stop_loss: "Nestanovuje se",
    take_profit_1: "Nestanovuje se",
    take_profit_2: "Nestanovuje se",
    risk_reward: "Obchod se neotevírá",
    invalidation: "Novou analýzu spusť až po uzavření další M5 svíčky.",
  } : {
    entry_zone: formatPrice(request.instrument, entry),
    stop_loss: formatPrice(request.instrument, stop),
    take_profit_1: formatPrice(request.instrument, tp1),
    take_profit_2: formatPrice(request.instrument, tp2),
    risk_reward: "TP1 1:1,5 · TP2 1:2",
    invalidation: verdict === "LONG" ? `M5 close pod ${formatPrice(request.instrument, stop)}` : `M5 close nad ${formatPrice(request.instrument, stop)}`,
  };

  return {
    verdict,
    market_read: verdict === "LONG" ? `H1, M15 i M5 jsou růstově srovnané. Celkové skóre ${totalScore} splnilo přísný filtr pro LONG.` : verdict === "SHORT" ? `H1, M15 i M5 jsou poklesově srovnané. Celkové skóre ${totalScore} splnilo přísný filtr pro SHORT.` : `Timeframy nebo momentum nejsou dostatečně srovnané. Celkové skóre je ${totalScore}; pro obchod požadujeme současně silný H1, M15 i M5 signál.`,
    confidence: Math.round(confidence),
    data_quality: snapshots.every((item) => item.candles >= 300) ? "good" : "limited",
    detected: { instrument: request.instrument, timeframes: snapshots.map(timeframeReading), indicators },
    setup,
    reasons,
    risks: [
      "Dukascopy a XTB používají odlišný CFD feed; směr trhu bývá podobný, přesné ceny se mohou lišit.",
      "Pravidla pracují pouze s technickými daty a nezohledňují makroekonomické zprávy ani náhlé události.",
      ...(offsetWarning ? [offsetWarning] : []),
      ...(request.accountSize ? [`Při riziku ${request.riskPercent} % je maximální plánovaná ztráta ${(request.accountSize * request.riskPercent / 100).toLocaleString("cs-CZ", { maximumFractionDigits: 0 })} Kč.`] : []),
    ],
    next_step: verdict === "NO_TRADE" ? "Počkej na uzavření další M5 svíčky a spusť analýzu znovu. Nevstupuj jen proto, že je trh aktivní." : "Před vstupem zkontroluj spread a aktuální cenu v XTB. Pokud se cena vzdálila od entry o více než 0,3 ATR M5, obchod přeskoč.",
    disclaimer: "Jde o automatickou vzdělávací technickou analýzu historických OHLC dat, nikoli finanční doporučení ani garanci výsledku.",
    data: { source: "Dukascopy", last_updated: new Date(m5.last.timestamp).toISOString(), source_price: sourcePrice, xtb_price: xtbPrice, price_offset: priceOffset },
  };
}

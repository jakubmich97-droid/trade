export type Verdict = "LONG" | "SHORT" | "NO_TRADE";
export type Signal = "bullish" | "bearish" | "neutral";
export type InstrumentId = "DE40" | "US100" | "US500" | "EURUSD";
export type AnalysisTimeframe = "H1" | "M15" | "M5";

export interface CzkFxRates {
  czkPerEur: number;
  czkPerUsd: number;
  asOf: string;
  source: "ECB";
}

export interface MarketCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MarketReferenceQuote {
  price: number;
  timestamp: number;
  timeframe: "M1" | "M5" | "H1";
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
    entry_price: number | null;
    stop_loss: string;
    stop_loss_price: number | null;
    take_profit_1: string;
    take_profit_1_price: number | null;
    take_profit_2: string;
    take_profit_2_price: number | null;
    distance_unit: "PIP" | "POINT";
    stop_loss_distance: number | null;
    take_profit_1_distance: number | null;
    take_profit_2_distance: number | null;
    risk_reward: string;
    invalidation: string;
    holding_period: string;
    holding_period_min_minutes: number | null;
    holding_period_max_minutes: number | null;
    time_stop_rule: string;
  };
  reasons: string[];
  risks: string[];
  position_sizing?: {
    account_size_czk: number;
    target_risk_percent: number;
    target_risk_czk: number;
    recommended_volume_lots: number | null;
    estimated_risk_czk: number | null;
    estimated_risk_percent: number | null;
    minimum_volume_lots: number;
    minimum_volume_risk_czk: number;
    risk_per_lot_czk: number;
    risk_based_volume_lots: number;
    max_margin_percent: number;
    margin_budget_czk: number;
    margin_based_volume_lots: number;
    required_margin_czk: number | null;
    required_margin_percent: number | null;
    minimum_volume_margin_czk: number;
    margin_per_lot_czk: number;
    leverage: number;
    limiting_factor: "RISK" | "MARGIN";
    contract_multiplier: number;
    quote_currency: "EUR" | "USD";
    conversion_rate_czk: number;
    conversion_rate_at: string;
    conversion_source: "ECB";
  } | null;
  reanalysis: {
    wait_minutes: number;
    recommended_at: string;
    trigger_timeframe: AnalysisTimeframe;
    reason: string;
  } | null;
  next_step: string;
  disclaimer: string;
  data: {
    source: "Dukascopy";
    last_updated: string;
    source_price: number;
    reference_price: number;
    reference_price_at: string;
    reference_timeframe: "M1" | "M5" | "H1";
    /** Legacy database compatibility fields; the value now comes from the freshest safe Dukascopy reference. */
    xtb_price: number;
    xtb_price_at: string;
    price_offset: number;
    total_score: number;
  };
}

interface ReanalysisAdvice {
  wait_minutes: number;
  recommended_at: string;
  trigger_timeframe: AnalysisTimeframe;
  reason: string;
}

export interface AnalyzeRequest {
  instrument: InstrumentId;
  volume?: number;
  riskPercent: number;
  maxMarginPercent: number;
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

const PRICE_DIGITS: Record<InstrumentId, number> = { DE40: 1, US100: 1, US500: 1, EURUSD: 5 };
const DISTANCE_SIZE: Record<InstrumentId, number> = { DE40: 1, US100: 1, US500: 1, EURUSD: 0.0001 };
const CONTRACTS: Record<InstrumentId, { multiplier: number; quoteCurrency: "EUR" | "USD"; leverage: number }> = {
  DE40: { multiplier: 25, quoteCurrency: "EUR", leverage: 20 },
  US100: { multiplier: 20, quoteCurrency: "USD", leverage: 20 },
  US500: { multiplier: 50, quoteCurrency: "USD", leverage: 20 },
  EURUSD: { multiplier: 100_000, quoteCurrency: "USD", leverage: 30 },
};
const MINIMUM_VOLUME_LOTS = 0.01;

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

function distanceValue(instrument: InstrumentId, priceDistance: number) {
  return Math.abs(priceDistance) / DISTANCE_SIZE[instrument];
}

function formatDistance(instrument: InstrumentId, priceDistance: number) {
  const value = distanceValue(instrument, priceDistance);
  const rendered = value.toLocaleString("cs-CZ", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return `${rendered} ${instrument === "EURUSD" ? "pipů" : "bodů"}`;
}

function roundPrice(instrument: InstrumentId, value: number) {
  return Number(value.toFixed(PRICE_DIGITS[instrument]));
}

export function rebaseTradeAnalysis(
  analysis: TradeAnalysis,
  actualEntryPrice: number,
  actualEntryAt = new Date().toISOString(),
): TradeAnalysis {
  if (analysis.verdict === "NO_TRADE") throw new Error("NO TRADE nemá cenové úrovně k přepočtu.");
  if (!Number.isFinite(actualEntryPrice) || actualEntryPrice <= 0) throw new Error("Aktuální cena z XTB musí být kladné číslo.");
  if (!Number.isFinite(Date.parse(actualEntryAt))) throw new Error("Čas aktuální ceny z XTB není platný.");

  const instrument = analysis.detected.instrument;
  const { stop_loss_distance: stopDistance, take_profit_1_distance: tp1Distance, take_profit_2_distance: tp2Distance } = analysis.setup;
  if (stopDistance === null || tp1Distance === null || tp2Distance === null) {
    throw new Error("Analýza nemá kompletní vzdálenosti SL a TP.");
  }

  const unitSize = DISTANCE_SIZE[instrument];
  const direction = analysis.verdict === "LONG" ? 1 : -1;
  const entry = roundPrice(instrument, actualEntryPrice);
  const stop = roundPrice(instrument, entry - direction * stopDistance * unitSize);
  const tp1 = roundPrice(instrument, entry + direction * tp1Distance * unitSize);
  const tp2 = roundPrice(instrument, entry + direction * tp2Distance * unitSize);
  const sizing = analysis.position_sizing;
  let rebasedSizing = sizing;

  if (sizing) {
    const marginPerLotCzk = entry * sizing.contract_multiplier * sizing.conversion_rate_czk / sizing.leverage;
    const marginBasedVolume = sizing.margin_budget_czk / marginPerLotCzk;
    const limitingFactor = marginBasedVolume < sizing.risk_based_volume_lots ? "MARGIN" : "RISK";
    const rawVolume = Math.min(sizing.risk_based_volume_lots, marginBasedVolume);
    const roundedVolume = Math.floor((rawVolume + Number.EPSILON) * 100) / 100;
    const recommendedVolume = roundedVolume >= sizing.minimum_volume_lots ? roundedVolume : null;
    const estimatedRiskCzk = recommendedVolume === null ? null : recommendedVolume * sizing.risk_per_lot_czk;
    const requiredMarginCzk = recommendedVolume === null ? null : recommendedVolume * marginPerLotCzk;
    rebasedSizing = {
      ...sizing,
      recommended_volume_lots: recommendedVolume,
      estimated_risk_czk: estimatedRiskCzk,
      estimated_risk_percent: estimatedRiskCzk === null ? null : estimatedRiskCzk / sizing.account_size_czk * 100,
      margin_based_volume_lots: marginBasedVolume,
      required_margin_czk: requiredMarginCzk,
      required_margin_percent: requiredMarginCzk === null ? null : requiredMarginCzk / sizing.account_size_czk * 100,
      minimum_volume_margin_czk: sizing.minimum_volume_lots * marginPerLotCzk,
      margin_per_lot_czk: marginPerLotCzk,
      limiting_factor: limitingFactor,
    };
  }

  const distanceLabel = analysis.setup.distance_unit === "PIP" ? "pipů" : "bodů";
  return {
    ...analysis,
    setup: {
      ...analysis.setup,
      entry_zone: `XTB vstup ${formatPrice(instrument, entry)}`,
      entry_price: entry,
      stop_loss: `${formatPrice(instrument, stop)} (${stopDistance.toLocaleString("cs-CZ", { maximumFractionDigits: 1 })} ${distanceLabel} proti směru)`,
      stop_loss_price: stop,
      take_profit_1: `${formatPrice(instrument, tp1)} (${tp1Distance.toLocaleString("cs-CZ", { maximumFractionDigits: 1 })} ${distanceLabel} ve směru)`,
      take_profit_1_price: tp1,
      take_profit_2: `${formatPrice(instrument, tp2)} (${tp2Distance.toLocaleString("cs-CZ", { maximumFractionDigits: 1 })} ${distanceLabel} ve směru)`,
      take_profit_2_price: tp2,
    },
    position_sizing: rebasedSizing,
    data: {
      ...analysis.data,
      xtb_price: entry,
      xtb_price_at: actualEntryAt,
      price_offset: entry - analysis.data.reference_price,
    },
  };
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

function buildReanalysisAdvice(h1: Snapshot, m15: Snapshot, m5: Snapshot): ReanalysisAdvice {
  let triggerTimeframe: AnalysisTimeframe = "M5";
  let reason = "Vyšší timeframy jsou použitelné, ale M5 zatím nepotvrdil dostatečně silný vstup.";

  const allBullish = h1.signal === "bullish" && m15.signal === "bullish" && m5.signal === "bullish";
  const allBearish = h1.signal === "bearish" && m15.signal === "bearish" && m5.signal === "bearish";
  const m15MomentumExtreme = (allBullish && m15.rsi14 >= 72) || (allBearish && m15.rsi14 <= 28);
  const m5MomentumExtreme = (allBullish && m5.rsi14 >= 72) || (allBearish && m5.rsi14 <= 28);

  if (h1.signal === "neutral") {
    triggerTimeframe = "H1";
    reason = "H1 nemá jasný směr. Dřívější přepočet by pravděpodobně pracoval se stejným vyšším trendem.";
  } else if (m15MomentumExtreme) {
    triggerTimeframe = "M15";
    reason = "Momentum na M15 je v extrému. Vyplatí se počkat na uzavření nové M15 svíčky.";
  } else if (m15.signal !== h1.signal) {
    triggerTimeframe = "M15";
    reason = "M15 není ve směru H1. Nový výpočet má smysl až po aktualizaci středního timeframe.";
  } else if (m5MomentumExtreme) {
    reason = "Momentum na M5 je v extrému. Další uzavřená M5 svíčka může potvrdit zklidnění nebo pokračování pohybu.";
  }

  const intervalMinutes: Record<AnalysisTimeframe, number> = { H1: 60, M15: 15, M5: 5 };
  const intervalMs = intervalMinutes[triggerTimeframe] * 60_000;
  const referenceTime = Date.now();
  const recommendedTime = Math.floor(referenceTime / intervalMs) * intervalMs + intervalMs + 60_000;

  return {
    wait_minutes: Math.max(1, Math.ceil((recommendedTime - referenceTime) / 60_000)),
    recommended_at: new Date(recommendedTime).toISOString(),
    trigger_timeframe: triggerTimeframe,
    reason,
  };
}

function buildPositionSizing(
  request: AnalyzeRequest,
  verdict: Verdict,
  entry: number,
  stop: number,
  fxRates: CzkFxRates,
): TradeAnalysis["position_sizing"] {
  if (verdict === "NO_TRADE" || !request.accountSize) return null;

  const contract = CONTRACTS[request.instrument];
  const conversionRate = contract.quoteCurrency === "EUR" ? fxRates.czkPerEur : fxRates.czkPerUsd;
  const targetRiskCzk = request.accountSize * request.riskPercent / 100;
  const riskPerLotCzk = Math.abs(entry - stop) * contract.multiplier * conversionRate;
  if (!Number.isFinite(riskPerLotCzk) || riskPerLotCzk <= 0) throw new Error("Riziko pozice se nepodařilo vypočítat.");

  const riskBasedVolume = targetRiskCzk / riskPerLotCzk;
  const marginBudgetCzk = request.accountSize * request.maxMarginPercent / 100;
  const marginPerLotCzk = entry * contract.multiplier * conversionRate / contract.leverage;
  if (!Number.isFinite(marginPerLotCzk) || marginPerLotCzk <= 0) throw new Error("Požadovanou marži se nepodařilo vypočítat.");
  const marginBasedVolume = marginBudgetCzk / marginPerLotCzk;
  const limitingFactor = marginBasedVolume < riskBasedVolume ? "MARGIN" : "RISK";
  const rawVolume = Math.min(riskBasedVolume, marginBasedVolume);
  const roundedVolume = Math.floor((rawVolume + Number.EPSILON) * 100) / 100;
  const recommendedVolume = roundedVolume >= MINIMUM_VOLUME_LOTS ? roundedVolume : null;
  const estimatedRiskCzk = recommendedVolume === null ? null : recommendedVolume * riskPerLotCzk;
  const requiredMarginCzk = recommendedVolume === null ? null : recommendedVolume * marginPerLotCzk;

  return {
    account_size_czk: request.accountSize,
    target_risk_percent: request.riskPercent,
    target_risk_czk: targetRiskCzk,
    recommended_volume_lots: recommendedVolume,
    estimated_risk_czk: estimatedRiskCzk,
    estimated_risk_percent: estimatedRiskCzk === null ? null : estimatedRiskCzk / request.accountSize * 100,
    minimum_volume_lots: MINIMUM_VOLUME_LOTS,
    minimum_volume_risk_czk: MINIMUM_VOLUME_LOTS * riskPerLotCzk,
    risk_per_lot_czk: riskPerLotCzk,
    risk_based_volume_lots: riskBasedVolume,
    max_margin_percent: request.maxMarginPercent,
    margin_budget_czk: marginBudgetCzk,
    margin_based_volume_lots: marginBasedVolume,
    required_margin_czk: requiredMarginCzk,
    required_margin_percent: requiredMarginCzk === null ? null : requiredMarginCzk / request.accountSize * 100,
    minimum_volume_margin_czk: MINIMUM_VOLUME_LOTS * marginPerLotCzk,
    margin_per_lot_czk: marginPerLotCzk,
    leverage: contract.leverage,
    limiting_factor: limitingFactor,
    contract_multiplier: contract.multiplier,
    quote_currency: contract.quoteCurrency,
    conversion_rate_czk: conversionRate,
    conversion_rate_at: fxRates.asOf,
    conversion_source: fxRates.source,
  };
}

export function buildTradeAnalysis(
  request: AnalyzeRequest,
  market: Record<AnalysisTimeframe, MarketCandle[]>,
  referenceQuote: MarketReferenceQuote,
  fxRates: CzkFxRates,
): TradeAnalysis {
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

  const sourcePrice = referenceQuote.price;
  const entry = sourcePrice;
  const swingWindow = market.M5.slice(-12, -1);
  const swingLow = Math.min(...swingWindow.map((candle) => candle.low));
  const swingHigh = Math.max(...swingWindow.map((candle) => candle.high));
  let stop = entry;
  if (verdict === "LONG") stop = Math.min(swingLow - m5.atr14 * 0.15, entry - m5.atr14 * 0.9);
  if (verdict === "SHORT") stop = Math.max(swingHigh + m5.atr14 * 0.15, entry + m5.atr14 * 0.9);
  const riskDistance = Math.abs(entry - stop);
  const direction = verdict === "SHORT" ? -1 : 1;
  const tp1 = entry + direction * riskDistance * 1.5;
  const tp2 = entry + direction * riskDistance * 2;
  const estimatedM15Candles = Math.max(
    3,
    Math.min(12, Math.ceil(Math.abs(tp2 - entry) / Math.max(m15.atr14 * 0.55, Number.EPSILON))),
  );
  const holdingMin = Math.max(45, estimatedM15Candles * 15);
  const holdingMax = Math.min(360, Math.max(holdingMin + 45, holdingMin * 2));
  const confidence = verdict === "NO_TRADE" ? Math.min(86, 52 + Math.max(0, 8 - Math.abs(totalScore)) * 4) : Math.min(90, 58 + Math.abs(totalScore) * 2);
  const reanalysis = verdict === "NO_TRADE" ? buildReanalysisAdvice(h1, m15, m5) : null;
  const positionSizing = buildPositionSizing(request, verdict, entry, stop, fxRates);
  const stopDistance = distanceValue(request.instrument, riskDistance);
  const tp1Distance = distanceValue(request.instrument, Math.abs(tp1 - entry));
  const tp2Distance = distanceValue(request.instrument, Math.abs(tp2 - entry));
  const distanceUnit: "PIP" | "POINT" = request.instrument === "EURUSD" ? "PIP" : "POINT";

  const indicators: IndicatorReading[] = snapshots.flatMap((item) => [
    { name: `${item.timeframe} trend`, reading: `Close ${formatPrice(request.instrument, item.close)}, EMA 20/50/200: ${formatPrice(request.instrument, item.ema20)} / ${formatPrice(request.instrument, item.ema50)} / ${formatPrice(request.instrument, item.ema200)}`, signal: item.signal },
    { name: `${item.timeframe} RSI 14`, reading: item.rsi14.toFixed(1), signal: item.rsi14 >= 52 && item.rsi14 <= 68 ? "bullish" : item.rsi14 <= 48 && item.rsi14 >= 32 ? "bearish" : "neutral" },
  ]);
  const reasons = snapshots.map((item) => `${item.timeframe}: ${item.notes.length ? item.notes.join(", ") : "signály nejsou dostatečně jednoznačné"} (skóre ${item.score > 0 ? "+" : ""}${item.score}).`);
  const setup = verdict === "NO_TRADE" ? {
    entry_zone: "Bez vstupu – timeframy nejsou ve stejné silné konfluenci",
    entry_price: null,
    stop_loss: "Nestanovuje se",
    stop_loss_price: null,
    take_profit_1: "Nestanovuje se",
    take_profit_1_price: null,
    take_profit_2: "Nestanovuje se",
    take_profit_2_price: null,
    distance_unit: distanceUnit,
    stop_loss_distance: null,
    take_profit_1_distance: null,
    take_profit_2_distance: null,
    risk_reward: "Obchod se neotevírá",
    invalidation: `Novou analýzu spusť po uzavření další ${reanalysis!.trigger_timeframe} svíčky.`,
    holding_period: "Nestanovuje se",
    holding_period_min_minutes: null,
    holding_period_max_minutes: null,
    time_stop_rule: "Bez aktivního obchodu.",
  } : {
    entry_zone: `Poblíž reference ${formatPrice(request.instrument, entry)}`,
    entry_price: entry,
    stop_loss: `${formatDistance(request.instrument, riskDistance)} proti směru`,
    stop_loss_price: stop,
    take_profit_1: `${formatDistance(request.instrument, tp1 - entry)} ve směru`,
    take_profit_1_price: tp1,
    take_profit_2: `${formatDistance(request.instrument, tp2 - entry)} ve směru`,
    take_profit_2_price: tp2,
    distance_unit: distanceUnit,
    stop_loss_distance: stopDistance,
    take_profit_1_distance: tp1Distance,
    take_profit_2_distance: tp2Distance,
    risk_reward: "TP1 1:1,5 · TP2 1:2",
    invalidation: `M5 close za SL, tedy přibližně ${formatDistance(request.instrument, riskDistance)} proti směru vstupu`,
    holding_period: `${holdingMin}–${holdingMax} minut`,
    holding_period_min_minutes: holdingMin,
    holding_period_max_minutes: holdingMax,
    time_stop_rule: `Pokud obchod do ${holdingMin} minut nedosáhne alespoň +0,5 R nebo se M15 uzavře proti směru, zvaž ukončení. Nedrž jej déle než ${holdingMax} minut bez nové analýzy.`,
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
      "SL a TP jsou uvedené jako vzdálenost od skutečné vstupní ceny v XTB; absolutní cena se mezi feedy může lišit.",
      "Technický model nedokáže předvídat neplánované zprávy, geopolitické události ani mimořádné projevy centrálních bankéřů.",
      ...(positionSizing ? ["Doporučený objem je odhad podle aktuálního SL a referenčního kurzu ECB. Spread, skluz a kurzová přirážka XTB mohou skutečnou ztrátu zvýšit."] : []),
      ...(request.accountSize ? [`Při riziku ${request.riskPercent} % je maximální plánovaná ztráta ${(request.accountSize * request.riskPercent / 100).toLocaleString("cs-CZ", { maximumFractionDigits: 0 })} Kč.`] : []),
    ],
    position_sizing: positionSizing,
    reanalysis,
    next_step: verdict === "NO_TRADE" ? `Počkej přibližně ${reanalysis!.wait_minutes} min do uzavření další ${reanalysis!.trigger_timeframe} svíčky a potom spusť analýzu znovu. Nevstupuj jen proto, že je trh aktivní.` : "V XTB použij vzdálenosti SL a TP od své skutečné vstupní ceny. Pokud se trh od referenční ceny mezitím výrazně vzdálil, spusť analýzu znovu.",
    disclaimer: "Jde o automatickou vzdělávací technickou analýzu historických OHLC dat, nikoli finanční doporučení ani garanci výsledku.",
    data: {
      source: "Dukascopy",
      last_updated: new Date(referenceQuote.timestamp).toISOString(),
      source_price: sourcePrice,
      reference_price: sourcePrice,
      reference_price_at: new Date(referenceQuote.timestamp).toISOString(),
      reference_timeframe: referenceQuote.timeframe,
      xtb_price: sourcePrice,
      xtb_price_at: new Date(referenceQuote.timestamp).toISOString(),
      price_offset: 0,
      total_score: totalScore,
    },
  };
}

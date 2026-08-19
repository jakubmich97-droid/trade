import "server-only";
import { getSql } from "@/lib/db";
import type { AnalyzeRequest, TradeAnalysis } from "@/lib/trade-analysis";

export const STRATEGY_VERSION = "v1.5.0";

export type ExitReason = "TP1" | "TP2" | "SL" | "BE" | "TIME_STOP" | "MANUAL";

export interface TradeJournalItem {
  tradeId: string;
  mode: "PAPER" | "LIVE";
  instrument: string;
  direction: "LONG" | "SHORT";
  status: "OPEN" | "WIN" | "LOSS" | "BREAKEVEN" | "CANCELLED" | "AMBIGUOUS";
  openedAt: string;
  openPrice: number;
  volume: number | null;
  accountSizeCzk: number | null;
  riskPercent: number | null;
  riskAmountCzk: number | null;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  recommendedHoldMinMinutes: number | null;
  recommendedHoldMaxMinutes: number | null;
  closedAt: string | null;
  closePrice: number | null;
  exitReason: string | null;
  closeNote: string | null;
  resultPoints: number | null;
  resultPercent: number | null;
  resultR: number | null;
  actualHoldMinutes: number | null;
  confidence: number;
  totalScore: number | null;
  strategyVersion: string;
}

interface StoredRow {
  id: string;
}

export interface PersistenceResult {
  stored: boolean;
  analysisId: string | null;
}

function tradeLevels(analysis: TradeAnalysis) {
  const { entry_price, stop_loss_price, take_profit_1_price, take_profit_2_price } = analysis.setup;
  if ([entry_price, stop_loss_price, take_profit_1_price, take_profit_2_price].some((value) => value === null)) {
    throw new Error("Aktivní signál nemá kompletní cenové úrovně.");
  }
  return {
    entry: entry_price!,
    stop: stop_loss_price!,
    tp1: take_profit_1_price!,
    tp2: take_profit_2_price!,
  };
}

export async function persistAnalysis(input: AnalyzeRequest, analysis: TradeAnalysis): Promise<PersistenceResult> {
  const sql = getSql();
  const rawAnalysis = JSON.stringify({ analysis, request: input });
  const rows = await sql`
    INSERT INTO analyses (
      strategy_version, instrument, verdict, confidence, total_score,
      source_candle_at, source_price, xtb_price, xtb_price_at, price_offset, market_read,
      timeframes, indicators, reasons, risks, raw_analysis
    ) VALUES (
      ${STRATEGY_VERSION}, ${analysis.detected.instrument}, ${analysis.verdict}, ${analysis.confidence}, ${analysis.data.total_score},
      ${analysis.data.last_updated}, ${analysis.data.source_price}, ${analysis.data.xtb_price}, ${input.xtbPriceAt}, ${analysis.data.price_offset}, ${analysis.market_read},
      ${JSON.stringify(analysis.detected.timeframes)}::jsonb,
      ${JSON.stringify(analysis.detected.indicators)}::jsonb,
      ${JSON.stringify(analysis.reasons)}::jsonb,
      ${JSON.stringify(analysis.risks)}::jsonb,
      ${rawAnalysis}::jsonb
    )
    ON CONFLICT (strategy_version, instrument, source_candle_at)
    DO UPDATE SET
      verdict = EXCLUDED.verdict,
      confidence = EXCLUDED.confidence,
      total_score = EXCLUDED.total_score,
      generated_at = now(),
      source_price = EXCLUDED.source_price,
      xtb_price = EXCLUDED.xtb_price,
      xtb_price_at = EXCLUDED.xtb_price_at,
      price_offset = EXCLUDED.price_offset,
      market_read = EXCLUDED.market_read,
      timeframes = EXCLUDED.timeframes,
      indicators = EXCLUDED.indicators,
      reasons = EXCLUDED.reasons,
      risks = EXCLUDED.risks,
      raw_analysis = EXCLUDED.raw_analysis
    RETURNING id
  ` as StoredRow[];
  const analysisId = rows[0].id;
  return { stored: true, analysisId };
}

export async function confirmLiveTrade(analysisId: string) {
  const sql = getSql();
  const rows = await sql`
    SELECT id, verdict, xtb_price, raw_analysis
    FROM analyses
    WHERE id = ${analysisId}
    LIMIT 1
  ` as Array<{ id: string; verdict: TradeAnalysis["verdict"]; xtb_price: string | null; raw_analysis: { analysis: TradeAnalysis; request: AnalyzeRequest } }>;

  const stored = rows[0];
  if (!stored) throw new Error("Uložená analýza nebyla nalezena.");
  if (stored.verdict === "NO_TRADE") throw new Error("NO TRADE nelze označit jako otevřený obchod.");
  if (stored.xtb_price === null) throw new Error("Pro reálný obchod nejdřív zadej aktuální cenu z XTB a spusť analýzu znovu.");

  const analysis = stored.raw_analysis.analysis;
  const input = stored.raw_analysis.request;
  const levels = tradeLevels(analysis);
  const sizing = analysis.position_sizing;
  const recommendedVolume = sizing?.recommended_volume_lots ?? input.volume ?? null;
  if (!recommendedVolume) {
    throw new Error("Pro nastavené riziko nelze doporučit ani minimální objem 0,01 lotu. Zvyš účet, uprav riziko nebo obchod vynech.");
  }
  const riskAmount = sizing?.estimated_risk_czk ?? (input.accountSize ? input.accountSize * input.riskPercent / 100 : null);
  const actualRiskPercent = sizing?.estimated_risk_percent ?? input.riskPercent;
  const trades = await sql`
    INSERT INTO trades (
      analysis_id, mode, direction, opened_at, entry_price, stop_loss,
      take_profit_1, take_profit_2, recommended_hold_min_minutes, recommended_hold_max_minutes,
      position_size, risk_percent, account_size_czk, risk_amount_czk,
      note
    ) VALUES (
      ${analysisId}, 'LIVE', ${stored.verdict}, ${input.xtbPriceAt}, ${levels.entry}, ${levels.stop},
      ${levels.tp1}, ${levels.tp2}, ${analysis.setup.holding_period_min_minutes}, ${analysis.setup.holding_period_max_minutes},
      ${recommendedVolume}, ${actualRiskPercent}, ${input.accountSize}, ${riskAmount},
      ${`Uživatel potvrdil vstup; cílové riziko ${input.riskPercent} %, max. marže ${input.maxMarginPercent} %, objem doporučen aplikací`}
    )
    ON CONFLICT (analysis_id, mode)
    DO UPDATE SET analysis_id = EXCLUDED.analysis_id
    RETURNING id
  ` as StoredRow[];

  return trades[0].id;
}

interface JournalDatabaseRow {
  trade_id: string;
  mode: "PAPER" | "LIVE";
  instrument: string;
  direction: "LONG" | "SHORT";
  status: TradeJournalItem["status"];
  opened_at: string;
  open_price: string;
  position_size: string | null;
  account_size_czk: string | null;
  risk_percent: string | null;
  risk_amount_czk: string | null;
  stop_loss: string;
  take_profit_1: string;
  take_profit_2: string;
  recommended_hold_min_minutes: number | null;
  recommended_hold_max_minutes: number | null;
  closed_at: string | null;
  close_price: string | null;
  exit_reason: string | null;
  close_note: string | null;
  result_points: string | null;
  result_percent: string | null;
  result_r: string | null;
  actual_hold_minutes: string | null;
  confidence: number;
  total_score: number | null;
  strategy_version: string;
}

function optionalNumber(value: string | number | null) {
  return value === null ? null : Number(value);
}

export async function getTradeJournal(limit = 100): Promise<TradeJournalItem[]> {
  const sql = getSql();
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 10_000);
  const rows = await sql`
    SELECT
      journal.trade_id, journal.mode, journal.instrument, journal.direction, journal.status,
      journal.opened_at, journal.open_price, source_trade.position_size,
      source_trade.account_size_czk, source_trade.risk_percent, source_trade.risk_amount_czk,
      journal.stop_loss, journal.take_profit_1, journal.take_profit_2,
      journal.recommended_hold_min_minutes, journal.recommended_hold_max_minutes,
      journal.closed_at, journal.close_price, journal.exit_reason, journal.close_note,
      journal.result_points, journal.result_percent, journal.result_r,
      journal.actual_hold_minutes, journal.confidence, journal.total_score,
      journal.strategy_version
    FROM v_trade_journal AS journal
    JOIN trades AS source_trade ON source_trade.id = journal.trade_id
    ORDER BY journal.opened_at DESC
    LIMIT ${safeLimit}
  ` as JournalDatabaseRow[];

  return rows.map((row) => ({
    tradeId: row.trade_id,
    mode: row.mode,
    instrument: row.instrument,
    direction: row.direction,
    status: row.status,
    openedAt: row.opened_at,
    openPrice: Number(row.open_price),
    volume: optionalNumber(row.position_size),
    accountSizeCzk: optionalNumber(row.account_size_czk),
    riskPercent: optionalNumber(row.risk_percent),
    riskAmountCzk: optionalNumber(row.risk_amount_czk),
    stopLoss: Number(row.stop_loss),
    takeProfit1: Number(row.take_profit_1),
    takeProfit2: Number(row.take_profit_2),
    recommendedHoldMinMinutes: row.recommended_hold_min_minutes,
    recommendedHoldMaxMinutes: row.recommended_hold_max_minutes,
    closedAt: row.closed_at,
    closePrice: optionalNumber(row.close_price),
    exitReason: row.exit_reason,
    closeNote: row.close_note,
    resultPoints: optionalNumber(row.result_points),
    resultPercent: optionalNumber(row.result_percent),
    resultR: optionalNumber(row.result_r),
    actualHoldMinutes: optionalNumber(row.actual_hold_minutes),
    confidence: row.confidence,
    totalScore: row.total_score,
    strategyVersion: row.strategy_version,
  }));
}

export async function closeTrade(input: {
  tradeId: string;
  closePrice: number;
  closedAt: string;
  exitReason: ExitReason;
  closeNote: string | null;
}) {
  const sql = getSql();
  const rows = await sql`
    UPDATE trades
    SET
      closed_at = ${input.closedAt},
      exit_price = ${input.closePrice},
      exit_reason = ${input.exitReason},
      close_note = ${input.closeNote}
    WHERE id = ${input.tradeId}
      AND status = 'OPEN'
    RETURNING id, status, result_r
  ` as Array<{ id: string; status: string; result_r: string | null }>;

  const trade = rows[0];
  if (!trade) throw new Error("Obchod nebyl nalezen nebo už je uzavřený.");

  const eventType: Record<ExitReason, string> = {
    TP1: "TP1_HIT",
    TP2: "TP2_HIT",
    SL: "SL_HIT",
    BE: "BREAKEVEN",
    TIME_STOP: "MANUAL_CLOSE",
    MANUAL: "MANUAL_CLOSE",
  };
  await sql`
    INSERT INTO trade_events (trade_id, event_type, occurred_at, price, source_timeframe, metadata)
    VALUES (
      ${input.tradeId}, ${eventType[input.exitReason]}, ${input.closedAt}, ${input.closePrice}, 'MANUAL',
      ${JSON.stringify({ exitReason: input.exitReason, note: input.closeNote })}::jsonb
    )
  `;

  return { tradeId: trade.id, status: trade.status, resultR: optionalNumber(trade.result_r) };
}

export async function deleteTrade(tradeId: string) {
  const sql = getSql();
  const rows = await sql`
    DELETE FROM trades
    WHERE id = ${tradeId}
    RETURNING id
  ` as StoredRow[];

  if (!rows[0]) throw new Error("Obchod nebyl nalezen nebo už byl odstraněn.");
  return rows[0].id;
}

export async function updateTrade(input: {
  tradeId: string;
  openedAt: string;
  openPrice: number;
  volume: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  closedAt: string | null;
  closePrice: number | null;
  exitReason: ExitReason | null;
}) {
  const sql = getSql();
  const rows = await sql`
    UPDATE trades
    SET
      opened_at = ${input.openedAt},
      entry_price = ${input.openPrice},
      position_size = ${input.volume},
      stop_loss = ${input.stopLoss},
      take_profit_1 = ${input.takeProfit1},
      take_profit_2 = ${input.takeProfit2},
      closed_at = ${input.closedAt},
      exit_price = ${input.closePrice},
      exit_reason = ${input.exitReason}
    WHERE id = ${input.tradeId}
    RETURNING id, status, result_r
  ` as Array<{ id: string; status: string; result_r: string | null }>;

  const trade = rows[0];
  if (!trade) throw new Error("Obchod nebyl nalezen.");
  return { tradeId: trade.id, status: trade.status, resultR: optionalNumber(trade.result_r) };
}

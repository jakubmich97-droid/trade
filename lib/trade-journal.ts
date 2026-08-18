import "server-only";
import { getSql } from "@/lib/db";
import type { AnalyzeRequest, TradeAnalysis } from "@/lib/trade-analysis";

export const STRATEGY_VERSION = "v1.1.0";

interface StoredRow {
  id: string;
}

export interface PersistenceResult {
  stored: boolean;
  analysisId: string | null;
  paperTradeId: string | null;
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
      source_candle_at, source_price, xtb_price, price_offset, market_read,
      timeframes, indicators, reasons, risks, raw_analysis
    ) VALUES (
      ${STRATEGY_VERSION}, ${analysis.detected.instrument}, ${analysis.verdict}, ${analysis.confidence}, ${analysis.data.total_score},
      ${analysis.data.last_updated}, ${analysis.data.source_price}, ${analysis.data.xtb_price}, ${analysis.data.price_offset}, ${analysis.market_read},
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

  if (analysis.verdict === "NO_TRADE") return { stored: true, analysisId, paperTradeId: null };

  const levels = tradeLevels(analysis);
  const riskAmount = input.accountSize ? input.accountSize * input.riskPercent / 100 : null;
  const trades = await sql`
    INSERT INTO trades (
      analysis_id, mode, direction, opened_at, entry_price, stop_loss,
      take_profit_1, take_profit_2, risk_percent, account_size_czk, risk_amount_czk,
      note
    ) VALUES (
      ${analysisId}, 'PAPER', ${analysis.verdict}, ${analysis.data.last_updated},
      ${levels.entry}, ${levels.stop}, ${levels.tp1}, ${levels.tp2},
      ${input.riskPercent}, ${input.accountSize}, ${riskAmount},
      'Automaticky vytvořený systémový obchod'
    )
    ON CONFLICT (analysis_id, mode)
    DO UPDATE SET analysis_id = EXCLUDED.analysis_id
    RETURNING id
  ` as StoredRow[];

  return { stored: true, analysisId, paperTradeId: trades[0].id };
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
  const riskAmount = input.accountSize ? input.accountSize * input.riskPercent / 100 : null;
  const trades = await sql`
    INSERT INTO trades (
      analysis_id, mode, direction, opened_at, entry_price, stop_loss,
      take_profit_1, take_profit_2, risk_percent, account_size_czk, risk_amount_czk,
      note
    ) VALUES (
      ${analysisId}, 'LIVE', ${stored.verdict}, now(), ${levels.entry}, ${levels.stop},
      ${levels.tp1}, ${levels.tp2}, ${input.riskPercent}, ${input.accountSize}, ${riskAmount},
      'Uživatel potvrdil vstup v XTB'
    )
    ON CONFLICT (analysis_id, mode)
    DO UPDATE SET analysis_id = EXCLUDED.analysis_id
    RETURNING id
  ` as StoredRow[];

  return trades[0].id;
}

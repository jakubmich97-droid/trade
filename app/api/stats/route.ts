import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PerformanceRow {
  mode: "PAPER" | "LIVE";
  instrument: string;
  total_trades: string;
  open_trades: string;
  wins: string;
  losses: string;
  breakeven: string;
  win_rate_percent: string | null;
  expectancy_r: string | null;
  total_r: string | null;
  profit_factor: string | null;
}

export async function GET() {
  try {
    const sql = getSql();
    const [analysisResult, performanceResult] = await Promise.all([
      sql`SELECT count(*) AS total FROM analyses`,
      sql`
        SELECT mode, instrument, total_trades, open_trades, wins, losses, breakeven,
               win_rate_percent, expectancy_r, total_r, profit_factor
        FROM v_trade_performance
        WHERE mode = 'LIVE'
        ORDER BY mode, instrument
      `,
    ]);
    const analysisRows = analysisResult as Array<{ total: string }>;
    const performance = performanceResult as PerformanceRow[];
    return NextResponse.json({
      savedAnalyses: Number(analysisRows[0].total),
      performance: performance.map((row) => ({
        mode: row.mode,
        instrument: row.instrument,
        totalTrades: Number(row.total_trades),
        openTrades: Number(row.open_trades),
        wins: Number(row.wins),
        losses: Number(row.losses),
        breakeven: Number(row.breakeven),
        winRatePercent: row.win_rate_percent === null ? null : Number(row.win_rate_percent),
        expectancyR: row.expectancy_r === null ? null : Number(row.expectancy_r),
        totalR: row.total_r === null ? null : Number(row.total_r),
        profitFactor: row.profit_factor === null ? null : Number(row.profit_factor),
      })),
    });
  } catch (error) {
    console.error("Stats loading error", error);
    return NextResponse.json({ error: "Statistiky se nepodařilo načíst." }, { status: 503 });
  }
}

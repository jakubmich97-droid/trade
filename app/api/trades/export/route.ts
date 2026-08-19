import { getTradeJournal } from "@/lib/trade-journal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CsvValue = string | number | null;

function csvCell(value: CsvValue) {
  if (value === null) return "";
  let text = String(value);
  if (typeof value === "string" && /^[\t\r ]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export async function GET() {
  try {
    const trades = await getTradeJournal(10_000);
    const headers = [
      "record_origin",
      "trade_id",
      "instrument",
      "direction",
      "status",
      "opened_at",
      "open_price",
      "volume_lots",
      "account_size_czk",
      "risk_percent",
      "risk_amount_czk",
      "stop_loss",
      "take_profit_1",
      "take_profit_2",
      "recommended_hold_min_minutes",
      "recommended_hold_max_minutes",
      "closed_at",
      "close_price",
      "exit_reason",
      "close_note",
      "result_points",
      "result_percent",
      "result_r",
      "actual_hold_minutes",
      "confidence",
      "total_score",
      "strategy_version",
    ];
    const rows: CsvValue[][] = trades.map((trade) => [
      trade.mode === "PAPER" ? "historical_signal" : "confirmed_entry",
      trade.tradeId,
      trade.instrument,
      trade.direction,
      trade.status,
      trade.openedAt,
      trade.openPrice,
      trade.volume,
      trade.accountSizeCzk,
      trade.riskPercent,
      trade.riskAmountCzk,
      trade.stopLoss,
      trade.takeProfit1,
      trade.takeProfit2,
      trade.recommendedHoldMinMinutes,
      trade.recommendedHoldMaxMinutes,
      trade.closedAt,
      trade.closePrice,
      trade.exitReason,
      trade.closeNote,
      trade.resultPoints,
      trade.resultPercent,
      trade.resultR,
      trade.actualHoldMinutes,
      trade.confidence,
      trade.totalScore,
      trade.strategyVersion,
    ]);
    const csv = [headers, ...rows].map((row) => row.map(csvCell).join(";")).join("\r\n");
    const filename = `tradelens-obchodni-denik-${new Date().toISOString().slice(0, 10)}.csv`;

    return new Response(`\uFEFF${csv}`, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Trade journal export error", error);
    return Response.json({ error: "CSV export se nepodařilo vytvořit." }, { status: 503 });
  }
}

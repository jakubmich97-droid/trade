import { NextResponse } from "next/server";
import { deleteTrade, updateTrade, type ExitReason } from "@/lib/trade-journal";

export const runtime = "nodejs";

const EXIT_REASONS = new Set<ExitReason>(["TP1", "TP2", "SL", "BE", "TIME_STOP", "MANUAL"]);

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ tradeId: string }> },
) {
  try {
    const { tradeId } = await params;
    if (!/^[0-9a-f-]{36}$/i.test(tradeId)) {
      return NextResponse.json({ error: "ID obchodu není platné." }, { status: 400 });
    }

    const body = (await request.json()) as Record<string, unknown>;
    if (
      !isPositiveNumber(body.openPrice) ||
      !isPositiveNumber(body.stopLoss) ||
      !isPositiveNumber(body.takeProfit1) ||
      !isPositiveNumber(body.takeProfit2)
    ) {
      return NextResponse.json({ error: "Open cena, SL, TP1 a TP2 musí být kladná čísla." }, { status: 400 });
    }
    if (!isPositiveNumber(body.volume) || body.volume > 1000) {
      return NextResponse.json({ error: "Objem musí být mezi 0 a 1 000 loty." }, { status: 400 });
    }
    if (typeof body.openedAt !== "string" || !Number.isFinite(Date.parse(body.openedAt))) {
      return NextResponse.json({ error: "Open čas není platný." }, { status: 400 });
    }
    if (Date.parse(body.openedAt) > Date.now() + 5 * 60_000) {
      return NextResponse.json({ error: "Open čas nesmí být více než 5 minut v budoucnosti." }, { status: 400 });
    }

    const staysOpen = body.closedAt === null && body.closePrice === null && body.exitReason === null;
    const closesTrade =
      typeof body.closedAt === "string" &&
      Number.isFinite(Date.parse(body.closedAt)) &&
      isPositiveNumber(body.closePrice) &&
      typeof body.exitReason === "string" &&
      EXIT_REASONS.has(body.exitReason as ExitReason);
    if (!staysOpen && !closesTrade) {
      return NextResponse.json({ error: "Close čas, cena a důvod musí být vyplněné společně." }, { status: 400 });
    }
    if (closesTrade && Date.parse(body.closedAt as string) < Date.parse(body.openedAt)) {
      return NextResponse.json({ error: "Close čas nesmí být před open časem." }, { status: 400 });
    }
    if (closesTrade && Date.parse(body.closedAt as string) > Date.now() + 5 * 60_000) {
      return NextResponse.json({ error: "Close čas nesmí být více než 5 minut v budoucnosti." }, { status: 400 });
    }

    const result = await updateTrade({
      tradeId,
      openedAt: body.openedAt,
      openPrice: body.openPrice,
      volume: body.volume,
      stopLoss: body.stopLoss,
      takeProfit1: body.takeProfit1,
      takeProfit2: body.takeProfit2,
      closedAt: closesTrade ? body.closedAt as string : null,
      closePrice: closesTrade ? body.closePrice as number : null,
      exitReason: closesTrade ? body.exitReason as ExitReason : null,
    });
    return NextResponse.json({ saved: true, result });
  } catch (error) {
    console.error("Trade update error", error);
    return NextResponse.json(
      { error: "Změny nelze uložit. Zkontroluj pořadí entry, SL a TP a návaznost časů." },
      { status: 400 },
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ tradeId: string }> },
) {
  try {
    const { tradeId } = await params;
    if (!/^[0-9a-f-]{36}$/i.test(tradeId)) {
      return NextResponse.json({ error: "ID obchodu není platné." }, { status: 400 });
    }
    const deletedTradeId = await deleteTrade(tradeId);
    return NextResponse.json({ deleted: true, tradeId: deletedTradeId });
  } catch (error) {
    console.error("Trade deletion error", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Obchod se nepodařilo odstranit." },
      { status: 404 },
    );
  }
}

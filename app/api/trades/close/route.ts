import { NextResponse } from "next/server";
import { closeTrade, type ExitReason } from "@/lib/trade-journal";

export const runtime = "nodejs";

const EXIT_REASONS = new Set<ExitReason>(["TP1", "TP2", "SL", "BE", "TIME_STOP", "MANUAL"]);

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      tradeId?: unknown;
      closePrice?: unknown;
      closedAt?: unknown;
      exitReason?: unknown;
      closeNote?: unknown;
    };

    if (typeof body.tradeId !== "string" || !/^[0-9a-f-]{36}$/i.test(body.tradeId)) {
      return NextResponse.json({ error: "Chybí platné ID obchodu." }, { status: 400 });
    }
    if (typeof body.closePrice !== "number" || !Number.isFinite(body.closePrice) || body.closePrice <= 0) {
      return NextResponse.json({ error: "Close cena musí být kladné číslo." }, { status: 400 });
    }
    if (typeof body.closedAt !== "string" || !Number.isFinite(Date.parse(body.closedAt))) {
      return NextResponse.json({ error: "Close čas není platný." }, { status: 400 });
    }
    if (Date.parse(body.closedAt) > Date.now() + 5 * 60_000) {
      return NextResponse.json({ error: "Close čas nesmí být více než 5 minut v budoucnosti." }, { status: 400 });
    }
    if (typeof body.exitReason !== "string" || !EXIT_REASONS.has(body.exitReason as ExitReason)) {
      return NextResponse.json({ error: "Vyber platný důvod ukončení." }, { status: 400 });
    }
    if (body.closeNote !== undefined && body.closeNote !== null && typeof body.closeNote !== "string") {
      return NextResponse.json({ error: "Poznámka nemá platný formát." }, { status: 400 });
    }

    const result = await closeTrade({
      tradeId: body.tradeId,
      closePrice: body.closePrice,
      closedAt: body.closedAt,
      exitReason: body.exitReason as ExitReason,
      closeNote: typeof body.closeNote === "string" && body.closeNote.trim() ? body.closeNote.trim().slice(0, 500) : null,
    });
    return NextResponse.json({ saved: true, result });
  } catch (error) {
    console.error("Trade close error", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Obchod se nepodařilo uzavřít." },
      { status: 400 },
    );
  }
}

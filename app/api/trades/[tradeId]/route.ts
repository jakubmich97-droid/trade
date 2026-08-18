import { NextResponse } from "next/server";
import { deleteTrade } from "@/lib/trade-journal";

export const runtime = "nodejs";

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

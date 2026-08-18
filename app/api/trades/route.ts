import { NextResponse } from "next/server";
import { getTradeJournal } from "@/lib/trade-journal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const trades = await getTradeJournal();
    return NextResponse.json({ trades });
  } catch (error) {
    console.error("Trade journal loading error", error);
    return NextResponse.json({ error: "Obchodní deník se nepodařilo načíst." }, { status: 503 });
  }
}

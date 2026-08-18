import { NextResponse } from "next/server";
import { confirmLiveTrade } from "@/lib/trade-journal";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { analysisId?: unknown };
    if (typeof body.analysisId !== "string" || !/^[0-9a-f-]{36}$/i.test(body.analysisId)) {
      return NextResponse.json({ error: "Chybí platné ID uložené analýzy." }, { status: 400 });
    }
    const tradeId = await confirmLiveTrade(body.analysisId);
    return NextResponse.json({ tradeId, saved: true });
  } catch (error) {
    console.error("Live trade confirmation error", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Obchod se nepodařilo uložit." },
      { status: 400 },
    );
  }
}

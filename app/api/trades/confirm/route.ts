import { NextResponse } from "next/server";
import { confirmLiveTrade } from "@/lib/trade-journal";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { analysisId?: unknown; executionPrice?: unknown; executionPriceAt?: unknown };
    if (typeof body.analysisId !== "string" || !/^[0-9a-f-]{36}$/i.test(body.analysisId)) {
      return NextResponse.json({ error: "Chybí platné ID uložené analýzy." }, { status: 400 });
    }
    let execution: { price: number; at: string } | undefined;
    if (body.executionPrice !== undefined || body.executionPriceAt !== undefined) {
      if (typeof body.executionPrice !== "number" || !Number.isFinite(body.executionPrice) || body.executionPrice <= 0) {
        return NextResponse.json({ error: "Aktuální cena z XTB není platná." }, { status: 400 });
      }
      if (typeof body.executionPriceAt !== "string" || !Number.isFinite(Date.parse(body.executionPriceAt))) {
        return NextResponse.json({ error: "Čas aktuální ceny z XTB není platný." }, { status: 400 });
      }
      const ageMs = Date.now() - Date.parse(body.executionPriceAt);
      if (ageMs < -60_000 || ageMs > 30 * 60_000) {
        return NextResponse.json({ error: "Cena z XTB je starší než 30 minut. Přepočítej úrovně znovu." }, { status: 400 });
      }
      execution = { price: body.executionPrice, at: body.executionPriceAt };
    }
    const tradeId = await confirmLiveTrade(body.analysisId, execution);
    return NextResponse.json({ tradeId, saved: true });
  } catch (error) {
    console.error("Live trade confirmation error", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Obchod se nepodařilo uložit." },
      { status: 400 },
    );
  }
}

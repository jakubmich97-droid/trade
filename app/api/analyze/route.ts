import { NextResponse } from "next/server";
import {
  type AnalyzeRequest,
  isTradeAnalysis,
  tradeAnalysisJsonSchema,
} from "@/lib/trade-analysis";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_IMAGE_CHARACTERS = 5_000_000;

const SYSTEM_PROMPT = `
Jsi konzervativní asistent technické analýzy finančních grafů. Analyzuješ pouze informace, které jsou skutečně viditelné na nahraném screenshotu, a metadata zadaná uživatelem. Odpovídáš česky.

Bezpečnostní a kvalitativní pravidla:
1. Nejsi finanční poradce. Vytváříš vzdělávací technický scénář, nikoli pokyn k nákupu nebo prodeji.
2. Nikdy nedoplňuj aktuální cenu, zprávy, fundamenty ani data, která na screenshotu nejsou.
3. Přesné cenové úrovně uveď jen tehdy, když je cenová osa spolehlivě čitelná. Jinak napiš „nelze spolehlivě určit ze screenu“ a popiš relativní úroveň.
4. Pokud je graf nečitelný, oříznutý, chybí timeframe, není zřejmý instrument, signály si odporují nebo není patrná dostatečná konfluence, výsledek musí být NO_TRADE.
5. Preferuj NO_TRADE také tehdy, když nelze sestavit smysluplný scénář s R:R alespoň přibližně 1:1,5.
6. Confidence je celé číslo 0–100, ale u jediné statické fotografie nesmí překročit 75. Při horší čitelnosti nesmí překročit 40.
7. Rozlišuj pozorování a interpretaci. U každého indikátoru napiš, co je vidět a zda je signál bullish, bearish nebo neutral.
8. Pokud uživatel označil indikátor, který na obrázku není čitelný, výslovně to přiznej.
9. Stop-loss musí být navázán na technickou invalidaci scénáře, ne na náhodné procento.
10. Do disclaimer vždy napiš, že jde o vzdělávací technickou analýzu z jediného screenu, nikoli finanční doporučení.
`;

function extractText(payload: Record<string, unknown>): string | null {
  if (typeof payload.output_text === "string") return payload.output_text;
  if (!Array.isArray(payload.output)) return null;

  for (const item of payload.output) {
    if (!item || typeof item !== "object") continue;
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const typed = part as { type?: string; text?: string; refusal?: string };
      if (typed.type === "output_text" && typeof typed.text === "string") {
        return typed.text;
      }
      if (typed.type === "refusal" && typeof typed.refusal === "string") {
        throw new Error(`Model analýzu odmítl: ${typed.refusal}`);
      }
    }
  }
  return null;
}

function validateRequest(body: Partial<AnalyzeRequest>): string | null {
  if (!body.image || typeof body.image !== "string") return "Chybí obrázek grafu.";
  if (!body.image.startsWith("data:image/")) return "Obrázek má neplatný formát.";
  if (body.image.length > MAX_IMAGE_CHARACTERS) return "Obrázek je příliš velký.";
  if (!body.instrument?.trim()) return "Doplň instrument nebo ticker.";
  if (!body.timeframe?.trim()) return "Vyber timeframe.";
  if (!body.style?.trim()) return "Vyber styl obchodu.";
  if (
    typeof body.riskPercent !== "number" ||
    body.riskPercent <= 0 ||
    body.riskPercent > 5
  ) {
    return "Riziko musí být mezi 0,1 a 5 %.";
  }
  return null;
}

export async function POST(request: Request) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "Na serveru chybí OPENAI_API_KEY. Doplň ho do proměnných prostředí." },
        { status: 503 },
      );
    }

    const body = (await request.json()) as Partial<AnalyzeRequest>;
    const validationError = validateRequest(body);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    const userContext = [
      `Instrument zadaný uživatelem: ${body.instrument}`,
      `Timeframe: ${body.timeframe}`,
      `Styl: ${body.style}`,
      `Označené indikátory: ${(body.indicators ?? []).join(", ") || "žádné"}`,
      `Maximální riziko na obchod: ${body.riskPercent} %`,
      body.accountSize ? `Velikost účtu: ${body.accountSize} Kč` : "Velikost účtu: neuvedena",
      body.notes?.trim() ? `Poznámka uživatele: ${body.notes.trim()}` : "Poznámka: žádná",
      "Nejprve ověř, zda metadata odpovídají tomu, co je vidět na screenu. Potom vrať strukturovaný scénář.",
    ].join("\n");

    const openAiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-5.6",
        input: [
          {
            role: "developer",
            content: [{ type: "input_text", text: SYSTEM_PROMPT }],
          },
          {
            role: "user",
            content: [
              { type: "input_text", text: userContext },
              { type: "input_image", image_url: body.image, detail: "original" },
            ],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "trade_chart_analysis",
            strict: true,
            schema: tradeAnalysisJsonSchema,
          },
        },
        max_output_tokens: 3200,
      }),
    });

    const payload = (await openAiResponse.json()) as Record<string, unknown>;
    if (!openAiResponse.ok) {
      const apiError = payload.error as { message?: string } | undefined;
      console.error("OpenAI API error", payload);
      return NextResponse.json(
        { error: apiError?.message || "AI analýzu se nepodařilo spustit." },
        { status: openAiResponse.status },
      );
    }

    const outputText = extractText(payload);
    if (!outputText) {
      return NextResponse.json(
        { error: "AI nevrátila dokončenou analýzu. Zkus kvalitnější screenshot." },
        { status: 502 },
      );
    }

    const analysis = JSON.parse(outputText) as unknown;
    if (!isTradeAnalysis(analysis)) {
      console.error("Invalid structured analysis", analysis);
      return NextResponse.json(
        { error: "Výstup analýzy nemá očekávanou strukturu." },
        { status: 502 },
      );
    }

    analysis.confidence = Math.max(0, Math.min(75, Math.round(analysis.confidence)));
    return NextResponse.json({ analysis });
  } catch (error) {
    console.error("Analyze route error", error);
    const message = error instanceof Error ? error.message : "Neočekávaná chyba analýzy.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

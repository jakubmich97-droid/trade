export type Verdict = "LONG" | "SHORT" | "NO_TRADE";
export type Signal = "bullish" | "bearish" | "neutral";

export interface IndicatorReading {
  name: string;
  reading: string;
  signal: Signal;
}

export interface TradeAnalysis {
  verdict: Verdict;
  market_read: string;
  confidence: number;
  image_quality: "good" | "usable" | "poor";
  detected: {
    instrument: string;
    timeframe: string;
    indicators: IndicatorReading[];
  };
  setup: {
    entry_zone: string;
    stop_loss: string;
    take_profit_1: string;
    take_profit_2: string;
    risk_reward: string;
    invalidation: string;
  };
  reasons: string[];
  risks: string[];
  next_step: string;
  disclaimer: string;
}

export interface AnalyzeRequest {
  image: string;
  instrument: string;
  timeframe: string;
  style: string;
  indicators: string[];
  riskPercent: number;
  accountSize: number | null;
  notes: string;
}

export const tradeAnalysisJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    verdict: { type: "string", enum: ["LONG", "SHORT", "NO_TRADE"] },
    market_read: { type: "string" },
    confidence: { type: "number" },
    image_quality: { type: "string", enum: ["good", "usable", "poor"] },
    detected: {
      type: "object",
      additionalProperties: false,
      properties: {
        instrument: { type: "string" },
        timeframe: { type: "string" },
        indicators: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              name: { type: "string" },
              reading: { type: "string" },
              signal: {
                type: "string",
                enum: ["bullish", "bearish", "neutral"],
              },
            },
            required: ["name", "reading", "signal"],
          },
        },
      },
      required: ["instrument", "timeframe", "indicators"],
    },
    setup: {
      type: "object",
      additionalProperties: false,
      properties: {
        entry_zone: { type: "string" },
        stop_loss: { type: "string" },
        take_profit_1: { type: "string" },
        take_profit_2: { type: "string" },
        risk_reward: { type: "string" },
        invalidation: { type: "string" },
      },
      required: [
        "entry_zone",
        "stop_loss",
        "take_profit_1",
        "take_profit_2",
        "risk_reward",
        "invalidation"
      ],
    },
    reasons: { type: "array", items: { type: "string" } },
    risks: { type: "array", items: { type: "string" } },
    next_step: { type: "string" },
    disclaimer: { type: "string" },
  },
  required: [
    "verdict",
    "market_read",
    "confidence",
    "image_quality",
    "detected",
    "setup",
    "reasons",
    "risks",
    "next_step",
    "disclaimer"
  ],
} as const;

export function isTradeAnalysis(value: unknown): value is TradeAnalysis {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<TradeAnalysis>;
  return (
    ["LONG", "SHORT", "NO_TRADE"].includes(candidate.verdict ?? "") &&
    typeof candidate.market_read === "string" &&
    typeof candidate.confidence === "number" &&
    Boolean(candidate.detected && Array.isArray(candidate.detected.indicators)) &&
    Boolean(candidate.setup && typeof candidate.setup.entry_zone === "string") &&
    Array.isArray(candidate.reasons) &&
    Array.isArray(candidate.risks) &&
    typeof candidate.next_step === "string"
  );
}

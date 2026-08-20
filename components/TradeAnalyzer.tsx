"use client";

import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Check,
  ChevronRight,
  Clock3,
  Database,
  Download,
  Gauge,
  LoaderCircle,
  Pencil,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Target,
  Trash2,
  TrendingUp,
  X,
  Zap,
} from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { InstrumentId, Signal, TradeAnalysis, Verdict } from "@/lib/trade-analysis";

const INSTRUMENTS: Array<{ id: InstrumentId; name: string; description: string }> = [
  { id: "DE40", name: "DE40", description: "Germany 40 / DAX" },
  { id: "US100", name: "US100", description: "Nasdaq 100 / US Tech" },
  { id: "US500", name: "US500", description: "S&P 500 / US Large Cap" },
  { id: "EURUSD", name: "EUR/USD", description: "Euro / US Dollar" },
];

const XTB_PRICE_CURRENCY: Record<InstrumentId, string> = {
  DE40: "EUR",
  US100: "USD",
  US500: "USD",
  EURUSD: "USD / 1 EUR",
};

interface HistoryItem {
  id: string;
  createdAt: string;
  instrument: InstrumentId;
  verdict: Verdict;
  confidence: number;
  analysis: TradeAnalysis;
}

interface PersistenceState {
  stored: boolean;
  analysisId: string | null;
}

interface PerformanceItem {
  mode: "PAPER" | "LIVE";
  instrument: string;
  totalTrades: number;
  openTrades: number;
  wins: number;
  losses: number;
  breakeven: number;
  winRatePercent: number | null;
  expectancyR: number | null;
  totalR: number | null;
  profitFactor: number | null;
}

interface StatsState {
  savedAnalyses: number;
  performance: PerformanceItem[];
}

interface TradeJournalItem {
  tradeId: string;
  mode: "PAPER" | "LIVE";
  instrument: InstrumentId;
  direction: "LONG" | "SHORT";
  status: "OPEN" | "WIN" | "LOSS" | "BREAKEVEN" | "CANCELLED" | "AMBIGUOUS";
  openedAt: string;
  openPrice: number;
  volume: number | null;
  accountSizeCzk: number | null;
  riskPercent: number | null;
  riskAmountCzk: number | null;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  recommendedHoldMinMinutes: number | null;
  recommendedHoldMaxMinutes: number | null;
  closedAt: string | null;
  closePrice: number | null;
  exitReason: string | null;
  resultPoints: number | null;
  resultPercent: number | null;
  resultR: number | null;
  actualHoldMinutes: number | null;
}

interface CloseForm {
  closePrice: string;
  closedAt: string;
  exitReason: "TP1" | "TP2" | "SL" | "BE" | "TIME_STOP" | "MANUAL";
}

interface EditForm {
  openedAt: string;
  openPrice: string;
  volume: string;
  stopLoss: string;
  takeProfit1: string;
  takeProfit2: string;
  closedAt: string;
  closePrice: string;
  exitReason: CloseForm["exitReason"];
}

const PRAGUE_TIME_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Prague",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function pragueParts(date: Date) {
  return Object.fromEntries(PRAGUE_TIME_FORMATTER.formatToParts(date).map((part) => [part.type, part.value]));
}

function pragueNowInput(date = new Date()) {
  const parts = pragueParts(date);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function pragueIsoToInput(value: string) {
  const parts = pragueParts(new Date(value));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function pragueInputToIso(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error("Čas nemá platný formát.");
  const desiredUtc = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]));
  const firstParts = pragueParts(new Date(desiredUtc));
  const renderedUtc = Date.UTC(Number(firstParts.year), Number(firstParts.month) - 1, Number(firstParts.day), Number(firstParts.hour), Number(firstParts.minute));
  const firstResult = desiredUtc - (renderedUtc - desiredUtc);
  const checkParts = pragueParts(new Date(firstResult));
  const checkUtc = Date.UTC(Number(checkParts.year), Number(checkParts.month) - 1, Number(checkParts.day), Number(checkParts.hour), Number(checkParts.minute));
  return new Date(firstResult + desiredUtc - checkUtc).toISOString();
}

function formatPragueTime(value: string) {
  return new Intl.DateTimeFormat("cs-CZ", {
    timeZone: "Europe/Prague",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatJournalPrice(instrument: InstrumentId, value: number) {
  return value.toLocaleString("cs-CZ", {
    minimumFractionDigits: instrument === "EURUSD" ? 5 : 1,
    maximumFractionDigits: instrument === "EURUSD" ? 5 : 1,
  });
}

function verdictLabel(verdict: Verdict) {
  return verdict === "NO_TRADE" ? "NO TRADE" : verdict;
}

function signalLabel(signal: Signal) {
  if (signal === "bullish") return "Bullish";
  if (signal === "bearish") return "Bearish";
  return "Neutral";
}

function parseLocalizedNumber(value: string) {
  return Number(value.replace(/\s/g, "").replace(",", "."));
}

function SetupField({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return <div className={`setup-field ${accent ? "setup-field--accent" : ""}`}><span>{label}</span><strong>{value}</strong></div>;
}

export function TradeAnalyzer() {
  const resultRef = useRef<HTMLElement>(null);
  const [instrument, setInstrument] = useState<InstrumentId>("DE40");
  const [xtbPrice, setXtbPrice] = useState("");
  const [xtbPriceAt, setXtbPriceAt] = useState(() => pragueNowInput());
  const [riskPercent, setRiskPercent] = useState(1);
  const [maxMarginPercent, setMaxMarginPercent] = useState(5);
  const [accountSize, setAccountSize] = useState("200000");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [analysis, setAnalysis] = useState<TradeAnalysis | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [persistence, setPersistence] = useState<PersistenceState | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmNotice, setConfirmNotice] = useState("");
  const [tradeDecision, setTradeDecision] = useState<"entered" | "skipped" | null>(null);
  const [stats, setStats] = useState<StatsState | null>(null);
  const [journal, setJournal] = useState<TradeJournalItem[]>([]);
  const [journalError, setJournalError] = useState("");
  const [closingTradeId, setClosingTradeId] = useState<string | null>(null);
  const [deletingTradeId, setDeletingTradeId] = useState<string | null>(null);
  const [editingTradeId, setEditingTradeId] = useState<string | null>(null);
  const [savingTradeId, setSavingTradeId] = useState<string | null>(null);
  const [closeForms, setCloseForms] = useState<Record<string, CloseForm>>({});
  const [editForms, setEditForms] = useState<Record<string, EditForm>>({});

  async function loadStats() {
    try {
      const response = await fetch("/api/stats", { cache: "no-store" });
      if (!response.ok) return;
      setStats((await response.json()) as StatsState);
    } catch {
      // Analýza funguje i při dočasně nedostupných statistikách.
    }
  }

  async function loadJournal() {
    try {
      const response = await fetch("/api/trades", { cache: "no-store" });
      const payload = (await response.json()) as { trades?: TradeJournalItem[]; error?: string };
      if (!response.ok || !payload.trades) throw new Error(payload.error || "Obchodní deník se nepodařilo načíst.");
      setJournal(payload.trades);
      setJournalError("");
    } catch (requestError) {
      setJournalError(requestError instanceof Error ? requestError.message : "Obchodní deník se nepodařilo načíst.");
    }
  }

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("tradelens-data-history");
      if (saved) setHistory(JSON.parse(saved) as HistoryItem[]);
    } catch {
      window.localStorage.removeItem("tradelens-data-history");
    }
    void Promise.all([loadStats(), loadJournal()]);
  }, []);

  const estimatedRisk = useMemo(() => {
    const size = Number(accountSize);
    return size > 0 ? Math.round(size * riskPercent / 100) : null;
  }, [accountSize, riskPercent]);
  const estimatedMarginBudget = useMemo(() => {
    const size = Number(accountSize);
    return size > 0 ? Math.round(size * maxMarginPercent / 100) : null;
  }, [accountSize, maxMarginPercent]);

  function saveHistory(nextAnalysis: TradeAnalysis) {
    const item: HistoryItem = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      instrument,
      verdict: nextAnalysis.verdict,
      confidence: nextAnalysis.confidence,
      analysis: nextAnalysis,
    };
    setHistory((current) => {
      const next = [item, ...current].slice(0, 6);
      window.localStorage.setItem("tradelens-data-history", JSON.stringify(next));
      return next;
    });
  }

  async function analyze() {
    setLoading(true);
    setError("");
    setAnalysis(null);
    setPersistence(null);
    setConfirmNotice("");
    setTradeDecision(null);
    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instrument,
          xtbPrice: parseLocalizedNumber(xtbPrice),
          xtbPriceAt: pragueInputToIso(xtbPriceAt),
          riskPercent,
          maxMarginPercent,
          accountSize: Number(accountSize),
        }),
      });
      const payload = (await response.json()) as { analysis?: TradeAnalysis; persistence?: PersistenceState; error?: string };
      if (!response.ok || !payload.analysis) throw new Error(payload.error || "Analýzu se nepodařilo dokončit.");
      setAnalysis(payload.analysis);
      setPersistence(payload.persistence ?? null);
      saveHistory(payload.analysis);
      void Promise.all([loadStats(), loadJournal()]);
      window.setTimeout(() => resultRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Analýza selhala.");
    } finally {
      setLoading(false);
    }
  }

  async function confirmLiveTrade() {
    if (!persistence?.analysisId) return;
    setConfirming(true);
    setConfirmNotice("");
    try {
      const response = await fetch("/api/trades/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analysisId: persistence.analysisId }),
      });
      const payload = (await response.json()) as { saved?: boolean; error?: string };
      if (!response.ok || !payload.saved) throw new Error(payload.error || "Obchod se nepodařilo uložit.");
      setTradeDecision("entered");
      setConfirmNotice("Obchod je uložený v deníku. Opakované potvrzení nevytvoří duplicitu.");
      void Promise.all([loadStats(), loadJournal()]);
    } catch (requestError) {
      setConfirmNotice(requestError instanceof Error ? requestError.message : "Uložení obchodu selhalo.");
    } finally {
      setConfirming(false);
    }
  }

  function skipTrade() {
    setTradeDecision("skipped");
    setConfirmNotice("Do tohoto obchodu nevstupuješ, proto se do obchodního deníku nic nezapsalo.");
  }

  function closeFormFor(tradeId: string): CloseForm {
    return closeForms[tradeId] ?? { closePrice: "", closedAt: pragueNowInput(), exitReason: "MANUAL" };
  }

  function updateCloseForm(tradeId: string, update: Partial<CloseForm>) {
    setCloseForms((current) => ({
      ...current,
      [tradeId]: {
        ...(current[tradeId] ?? { closePrice: "", closedAt: pragueNowInput(), exitReason: "MANUAL" }),
        ...update,
      },
    }));
  }

  async function submitClose(trade: TradeJournalItem) {
    const form = closeFormFor(trade.tradeId);
    const closePrice = parseLocalizedNumber(form.closePrice);
    if (!Number.isFinite(closePrice) || closePrice <= 0) {
      setJournalError("U uzavíraného obchodu zadej platnou close cenu.");
      return;
    }
    setClosingTradeId(trade.tradeId);
    setJournalError("");
    try {
      const response = await fetch("/api/trades/close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tradeId: trade.tradeId,
          closePrice,
          closedAt: pragueInputToIso(form.closedAt),
          exitReason: form.exitReason,
        }),
      });
      const payload = (await response.json()) as { saved?: boolean; error?: string };
      if (!response.ok || !payload.saved) throw new Error(payload.error || "Obchod se nepodařilo uzavřít.");
      setCloseForms((current) => {
        const next = { ...current };
        delete next[trade.tradeId];
        return next;
      });
      await Promise.all([loadJournal(), loadStats()]);
    } catch (requestError) {
      setJournalError(requestError instanceof Error ? requestError.message : "Obchod se nepodařilo uzavřít.");
    } finally {
      setClosingTradeId(null);
    }
  }

  async function removeTrade(trade: TradeJournalItem) {
    const confirmed = window.confirm(
      `Opravdu odstranit ${trade.mode} ${trade.direction} ${trade.instrument} z obchodního deníku? Tuto akci nelze vrátit zpět.`,
    );
    if (!confirmed) return;

    setDeletingTradeId(trade.tradeId);
    setJournalError("");
    try {
      const response = await fetch(`/api/trades/${trade.tradeId}`, { method: "DELETE" });
      const payload = (await response.json()) as { deleted?: boolean; error?: string };
      if (!response.ok || !payload.deleted) throw new Error(payload.error || "Obchod se nepodařilo odstranit.");
      await Promise.all([loadJournal(), loadStats()]);
    } catch (requestError) {
      setJournalError(requestError instanceof Error ? requestError.message : "Obchod se nepodařilo odstranit.");
    } finally {
      setDeletingTradeId(null);
    }
  }

  function startEditing(trade: TradeJournalItem) {
    setEditForms((current) => ({
      ...current,
      [trade.tradeId]: {
        openedAt: pragueIsoToInput(trade.openedAt),
        openPrice: String(trade.openPrice),
        volume: trade.volume === null ? "" : String(trade.volume),
        stopLoss: String(trade.stopLoss),
        takeProfit1: String(trade.takeProfit1),
        takeProfit2: String(trade.takeProfit2),
        closedAt: trade.closedAt ? pragueIsoToInput(trade.closedAt) : "",
        closePrice: trade.closePrice === null ? "" : String(trade.closePrice),
        exitReason: (trade.exitReason as EditForm["exitReason"] | null) ?? "MANUAL",
      },
    }));
    setEditingTradeId(trade.tradeId);
    setJournalError("");
  }

  function updateEditForm(tradeId: string, update: Partial<EditForm>) {
    setEditForms((current) => ({
      ...current,
      [tradeId]: { ...current[tradeId], ...update },
    }));
  }

  async function saveTradeEdit(trade: TradeJournalItem) {
    const form = editForms[trade.tradeId];
    if (!form) return;
    const openPrice = parseLocalizedNumber(form.openPrice);
    const parsedVolume = parseLocalizedNumber(form.volume);
    const stopLoss = parseLocalizedNumber(form.stopLoss);
    const takeProfit1 = parseLocalizedNumber(form.takeProfit1);
    const takeProfit2 = parseLocalizedNumber(form.takeProfit2);
    if ([openPrice, parsedVolume, stopLoss, takeProfit1, takeProfit2].some((value) => !Number.isFinite(value) || value <= 0)) {
      setJournalError("Open cena, objem, SL, TP1 a TP2 musí být kladná čísla.");
      return;
    }
    if (parsedVolume > 1000) {
      setJournalError("Objem nesmí být vyšší než 1 000 lotů.");
      return;
    }

    let closedAt: string | null = null;
    let closePrice: number | null = null;
    let exitReason: EditForm["exitReason"] | null = null;
    if (trade.status !== "OPEN") {
      closePrice = parseLocalizedNumber(form.closePrice);
      if (!form.closedAt || !Number.isFinite(closePrice) || closePrice <= 0) {
        setJournalError("U uzavřeného obchodu musí zůstat vyplněný close čas a kladná close cena.");
        return;
      }
      closedAt = pragueInputToIso(form.closedAt);
      exitReason = form.exitReason;
    }

    setSavingTradeId(trade.tradeId);
    setJournalError("");
    try {
      const response = await fetch(`/api/trades/${trade.tradeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          openedAt: pragueInputToIso(form.openedAt),
          openPrice,
          volume: parsedVolume,
          stopLoss,
          takeProfit1,
          takeProfit2,
          closedAt,
          closePrice,
          exitReason,
        }),
      });
      const payload = (await response.json()) as { saved?: boolean; error?: string };
      if (!response.ok || !payload.saved) throw new Error(payload.error || "Změny se nepodařilo uložit.");
      setEditingTradeId(null);
      await Promise.all([loadJournal(), loadStats()]);
    } catch (requestError) {
      setJournalError(requestError instanceof Error ? requestError.message : "Změny se nepodařilo uložit.");
    } finally {
      setSavingTradeId(null);
    }
  }

  const aggregate = () => {
    const rows = stats?.performance ?? [];
    const total = rows.reduce((sum, item) => sum + item.totalTrades, 0);
    const open = rows.reduce((sum, item) => sum + item.openTrades, 0);
    const wins = rows.reduce((sum, item) => sum + item.wins, 0);
    const losses = rows.reduce((sum, item) => sum + item.losses, 0);
    const decided = wins + losses;
    return { total, open, wins, losses, winRate: decided ? wins / decided * 100 : null };
  };

  const confirmedStats = aggregate();

  return (
    <main className="app-shell">
      <div className="ambient ambient--one" />
      <div className="ambient ambient--two" />

      <header className="topbar">
        <a className="brand" href="#top" aria-label="TradeLens domů">
          <span className="brand__mark"><TrendingUp size={20} /></span>
          <span>TradeLens <i>DATA</i></span>
        </a>
        <div className="topbar__meta">
          <span className="status"><i /> Datový feed připraven</span>
          <span className="secure"><Database size={14} /> Dukascopy + Neon · bez API klíče</span>
        </div>
      </header>

      <section className="hero" id="top">
        <div className="eyebrow"><Activity size={14} /> Automatická multi-timeframe analýza</div>
        <h1>Data místo screenu. <span>Přísnější signály.</span></h1>
        <p>Vyber trh a aplikace sama načte posledních 400 uzavřených svíček H1, M15 a M5. Obchod doporučí pouze při silné shodě všech tří timeframe.</p>
        <div className="hero__proof">
          <span><Check size={15} /> Bez OpenAI a poplatků</span>
          <span><Check size={15} /> EMA 20/50/200 · RSI · ATR</span>
          <span><Check size={15} /> LONG / SHORT / NO TRADE</span>
        </div>
      </section>

      <section className="analyzer-grid">
        <div className="panel data-panel">
          <div className="panel__heading">
            <div><span className="step">01</span><div><h2>Trh a datový kontext</h2><p>Zdroj se stáhne automaticky při spuštění analýzy.</p></div></div>
          </div>

          <div className="instrument-grid">
            {INSTRUMENTS.map((item) => (
              <button key={item.id} type="button" className={`instrument-card ${instrument === item.id ? "instrument-card--active" : ""}`} onClick={() => { setInstrument(item.id); setAnalysis(null); setXtbPrice(""); setXtbPriceAt(pragueNowInput()); }}>
                <span><BarChart3 size={19} /></span>
                <strong>{item.name}</strong>
                <small>{item.description}</small>
                {instrument === item.id && <Check size={16} />}
              </button>
            ))}
          </div>

          <div className="pipeline">
            <div className="pipeline__source"><Database size={22} /><div><span>Zdroj dat</span><strong>Dukascopy OHLCV</strong><small>Bid ceny · poslední uzavřené svíčky</small></div></div>
            {[
              ["H1", "Trend a režim trhu", "EMA 50/200"],
              ["M15", "Obchodní setup", "EMA 20/50 · RSI"],
              ["M5", "Vstupní trigger", "Price action · ATR"],
            ].map(([timeframe, title, detail]) => (
              <div className="pipeline__row" key={timeframe}><b>{timeframe}</b><div><strong>{title}</strong><span>{detail}</span></div><small>400 svíček</small></div>
            ))}
          </div>

          <div className="quality-tip"><ShieldCheck size={18} /><div><strong>Filtr zaměřený na kvalitu</strong><span>Pokud nejsou H1, M15 a M5 ve stejném směru nebo je RSI v extrému, výsledkem bude NO TRADE.</span></div></div>
        </div>

        <div className="panel settings-panel">
          <div className="panel__heading">
            <div><span className="step">02</span><div><h2>Nastavení obchodu</h2><p>Zadej aktuální cenu, velikost účtu a maximální přijatelné riziko.</p></div></div>
          </div>

          <div className="form-grid">
            <label className="field field--wide">
              <span>Aktuální cena v XTB <em>povinné · měna kotace {XTB_PRICE_CURRENCY[instrument]}</em></span>
              <div className="input-wrap price-input"><Gauge size={17} /><input required inputMode="decimal" value={xtbPrice} onChange={(event) => setXtbPrice(event.target.value)} placeholder={instrument === "EURUSD" ? "např. 1,16520" : "např. 24 850,5"} /><b>{XTB_PRICE_CURRENCY[instrument]}</b></div>
            </label>
            <label className="field field--wide">
              <span>Čas zadané ceny <em>Europe/Prague · povinné</em></span>
              <div className="datetime-wrap"><Clock3 size={17} /><input required type="datetime-local" value={xtbPriceAt} onChange={(event) => setXtbPriceAt(event.target.value)} /><button type="button" onClick={() => setXtbPriceAt(pragueNowInput())}>Nyní</button></div>
            </label>
            <label className="field">
              <span>Velikost účtu <em>povinné</em></span>
              <div className="suffix-input"><input required type="number" min="1" step="1" value={accountSize} onChange={(event) => setAccountSize(event.target.value)} placeholder="200 000" /><b>Kč</b></div>
            </label>
            <label className="field">
              <span>Maximální riziko <em>lze změnit</em></span>
              <div className="suffix-input"><input type="number" min="0.1" max="5" step="0.1" value={riskPercent} onChange={(event) => setRiskPercent(Number(event.target.value))} /><b>%</b></div>
            </label>
            <label className="field field--wide">
              <span>Maximální využití marže <em>lze změnit · doporučeno 30 %</em></span>
              <div className="suffix-input"><input type="number" min="5" max="100" step="5" value={maxMarginPercent} onChange={(event) => setMaxMarginPercent(Number(event.target.value))} /><b>%</b></div>
            </label>
            {estimatedRisk !== null && estimatedMarginBudget !== null && <div className="risk-preview"><ShieldCheck size={16} /><span>Limit ztráty při SL:</span><strong>{estimatedRisk.toLocaleString("cs-CZ")} Kč</strong><span className="risk-preview__divider">·</span><span>Maržový rozpočet:</span><strong>{estimatedMarginBudget.toLocaleString("cs-CZ")} Kč</strong><small>Objem se po analýze omezí přísnějším z obou limitů. Skutečnou marži vždy ověř v xStation.</small></div>}
          </div>

          <div className="rules-box">
            <span>Podmínky pro aktivní signál</span>
            <ul>
              <li><Check size={14} /> Shodný směr H1, M15 a M5</li>
              <li><Check size={14} /> Celkové skóre alespoň ±10</li>
              <li><Check size={14} /> RSI mimo extrémní oblast</li>
              <li><Check size={14} /> TP2 minimálně R:R 1:2</li>
            </ul>
          </div>

          {error && <div className="error-message"><AlertTriangle size={17} /><span>{error}</span></div>}
          <button className="analyze-button" type="button" onClick={analyze} disabled={loading || !xtbPrice.trim() || !xtbPriceAt || Number(accountSize) <= 0 || riskPercent < 0.1 || riskPercent > 5 || maxMarginPercent < 5 || maxMarginPercent > 100}>
            {loading ? <><LoaderCircle className="spin" size={19} /> Stahuji a počítám 1 200 svíček…</> : <><Zap size={19} /> Načíst data a analyzovat <ArrowRight size={18} /></>}
          </button>
          <p className="button-note"><RefreshCw size={13} /> Data se při opakování obnoví nejvýše jednou za minutu.</p>
        </div>
      </section>

      {analysis && (
        <section ref={resultRef} className={`result result--${analysis.verdict.toLowerCase()}`}>
          <div className="result__top">
            <div>
              <span className="result-kicker"><Database size={15} /> {analysis.detected.instrument} · XTB {formatJournalPrice(analysis.detected.instrument, analysis.data.xtb_price)} · {analysis.data.xtb_price_at ? formatPragueTime(analysis.data.xtb_price_at) : new Date(analysis.data.last_updated).toLocaleString("cs-CZ")}</span>
              <div className="verdict-line">
                <span className="verdict-icon">{analysis.verdict === "LONG" ? <ArrowUpRight /> : analysis.verdict === "SHORT" ? <ArrowDownRight /> : <X />}</span>
                <div><small>Verdikt</small><h2>{verdictLabel(analysis.verdict)}</h2></div>
              </div>
            </div>
            <div className="confidence" style={{ "--confidence": `${analysis.confidence * 3.6}deg` } as React.CSSProperties}><div><strong>{analysis.confidence}%</strong><span>síla filtru</span></div></div>
          </div>

          <div className="timeframe-strip">
            {analysis.detected.timeframes.map((item) => (
              <div key={item.timeframe}><span>{item.timeframe}</span><strong className={`text-signal text-signal--${item.signal}`}>{signalLabel(item.signal)}</strong><small>RSI {item.rsi14.toFixed(1)} · ATR {item.atr14.toFixed(instrument === "EURUSD" ? 5 : 1)}</small></div>
            ))}
          </div>
          <div className="market-read"><BarChart3 size={20} /><p>{analysis.market_read}</p></div>

          <div className="result-grid">
            <div className="result-card setup-card">
              <div className="result-card__title"><Target size={18} /><h3>Obchodní scénář</h3></div>
              <SetupField label="Vstupní zóna" value={analysis.setup.entry_zone} accent />
              <SetupField label="Stop-loss" value={analysis.setup.stop_loss} />
              <SetupField label="Take-profit 1" value={analysis.setup.take_profit_1} />
              <SetupField label="Take-profit 2" value={analysis.setup.take_profit_2} />
              <SetupField label="Doporučená doba" value={analysis.setup.holding_period} accent={analysis.verdict !== "NO_TRADE"} />
              {analysis.verdict !== "NO_TRADE" && analysis.position_sizing && (
                <div className={`position-sizing ${analysis.position_sizing.recommended_volume_lots === null ? "position-sizing--blocked" : ""}`}>
                  <div className="position-sizing__heading"><Gauge size={17} /><div><span>Doporučený objem</span><strong>{analysis.position_sizing.recommended_volume_lots === null ? "Obchod je pro tento limit příliš velký" : `${analysis.position_sizing.recommended_volume_lots.toLocaleString("cs-CZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} lot`}</strong></div></div>
                  {analysis.position_sizing.recommended_volume_lots === null ? (
                    <p>Minimálních 0,01 lotu překračuje {analysis.position_sizing.limiting_factor === "MARGIN" ? `maržový rozpočet ${analysis.position_sizing.margin_budget_czk.toLocaleString("cs-CZ", { maximumFractionDigits: 0 })} Kč (potřeba přibližně ${analysis.position_sizing.minimum_volume_margin_czk.toLocaleString("cs-CZ", { maximumFractionDigits: 0 })} Kč)` : `rizikový limit ${analysis.position_sizing.target_risk_czk.toLocaleString("cs-CZ", { maximumFractionDigits: 0 })} Kč (riziko přibližně ${analysis.position_sizing.minimum_volume_risk_czk.toLocaleString("cs-CZ", { maximumFractionDigits: 0 })} Kč)`}.</p>
                  ) : (
                    <dl>
                      <div><dt>Limit rizika</dt><dd>{analysis.position_sizing.target_risk_czk.toLocaleString("cs-CZ", { maximumFractionDigits: 0 })} Kč · {analysis.position_sizing.target_risk_percent.toLocaleString("cs-CZ")} %</dd></div>
                      <div><dt>Odhad při SL</dt><dd>{analysis.position_sizing.estimated_risk_czk!.toLocaleString("cs-CZ", { maximumFractionDigits: 0 })} Kč · {analysis.position_sizing.estimated_risk_percent!.toLocaleString("cs-CZ", { maximumFractionDigits: 2 })} %</dd></div>
                      {analysis.position_sizing.required_margin_czk !== undefined && analysis.position_sizing.required_margin_czk !== null && <div><dt>Požadovaná marže</dt><dd>{analysis.position_sizing.required_margin_czk.toLocaleString("cs-CZ", { maximumFractionDigits: 0 })} Kč · {analysis.position_sizing.required_margin_percent!.toLocaleString("cs-CZ", { maximumFractionDigits: 1 })} % účtu</dd></div>}
                      {analysis.position_sizing.limiting_factor && <div><dt>Objem omezuje</dt><dd>{analysis.position_sizing.limiting_factor === "MARGIN" ? "Maržový rozpočet" : "Riziko k SL"}</dd></div>}
                    </dl>
                  )}
                  <small>Násobitel XTB kontraktu {analysis.position_sizing.contract_multiplier.toLocaleString("cs-CZ")}{analysis.position_sizing.leverage ? ` · páka 1:${analysis.position_sizing.leverage}` : " · starší výpočet bez kontroly marže"} · kurz {analysis.position_sizing.quote_currency}/CZK podle ECB {analysis.position_sizing.conversion_rate_czk.toLocaleString("cs-CZ", { maximumFractionDigits: 4 })} · {analysis.position_sizing.conversion_rate_at}</small>
                </div>
              )}
              <div className="rr-row"><span>Risk / Reward</span><strong>{analysis.setup.risk_reward}</strong></div>
              <div className="invalidation"><AlertTriangle size={16} /><span><b>Invalidace:</b> {analysis.setup.invalidation}</span></div>
              {analysis.verdict === "NO_TRADE" && analysis.reanalysis && (
                <div className="reanalysis-advice">
                  <RefreshCw size={17} />
                  <div>
                    <span>Znovu analyzovat</span>
                    <strong>Za {analysis.reanalysis.wait_minutes} min · {formatPragueTime(analysis.reanalysis.recommended_at)}</strong>
                    <p>{analysis.reanalysis.reason}</p>
                  </div>
                </div>
              )}
              {analysis.verdict !== "NO_TRADE" && <div className="time-stop"><Clock3 size={16} /><span><b>Časový stop:</b> {analysis.setup.time_stop_rule}</span></div>}
              {analysis.verdict !== "NO_TRADE" && (
                <div className="trade-confirm">
                  <div><Database size={16} /><span>{analysis.position_sizing?.recommended_volume_lots === null ? "Nastavený rizikový nebo maržový limit neumožňuje ani minimální objem 0,01 lotu. Uprav limity a spusť analýzu znovu." : persistence?.stored ? "Analýza je uložená. Doporučený objem se do deníku zapíše až po tvém potvrzení vstupu." : "Analýza proběhla, ale databázový zápis se nepodařil."}</span></div>
                  <div className="trade-decision-buttons">
                    <button type="button" className="trade-decision-enter" onClick={confirmLiveTrade} disabled={confirming || !persistence?.analysisId || tradeDecision === "entered" || !analysis.position_sizing?.recommended_volume_lots}>
                      {confirming ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />} {tradeDecision === "entered" ? "Obchod zapsán" : "Ano, vstupuji"}
                    </button>
                    <button type="button" className="trade-decision-skip" onClick={skipTrade} disabled={confirming || tradeDecision === "entered"}>
                      <X size={16} /> Ne, obchod neberu
                    </button>
                  </div>
                  {confirmNotice && <p>{confirmNotice}</p>}
                </div>
              )}
            </div>

            <div className="result-card">
              <div className="result-card__title"><Activity size={18} /><h3>Vypočtené indikátory</h3></div>
              <div className="indicator-list">
                {analysis.detected.indicators.map((indicator, index) => (
                  <div className="indicator" key={`${indicator.name}-${index}`}><span className={`signal signal--${indicator.signal}`} /><div><strong>{indicator.name}</strong><p>{indicator.reading}</p></div><em>{signalLabel(indicator.signal)}</em></div>
                ))}
              </div>
            </div>

            <div className="result-card">
              <div className="result-card__title"><Check size={18} /><h3>Proč tento verdikt</h3></div>
              <ul className="reason-list">{analysis.reasons.map((reason, index) => <li key={index}><span>{index + 1}</span>{reason}</li>)}</ul>
            </div>

            <div className="result-card risk-card">
              <div className="result-card__title"><ShieldCheck size={18} /><h3>Rizika a další krok</h3></div>
              <ul>{analysis.risks.map((risk, index) => <li key={index}><AlertTriangle size={15} />{risk}</li>)}</ul>
              <div className="next-step"><Clock3 size={17} /><div><span>Co sledovat dál</span><strong>{analysis.next_step}</strong></div></div>
            </div>
          </div>
          <div className="disclaimer"><ShieldCheck size={15} />{analysis.disclaimer}</div>
        </section>
      )}

      <section className="journal-section">
        <div className="section-heading"><div><span>Neon databáze</span><h2>Obchodní deník</h2></div><div className="journal-heading-actions"><small>{journal.length} obchodů · čas Europe/Prague</small><a className="journal-export-button" href="/api/trades/export" download><Download size={14} /> Exportovat CSV</a></div></div>
        <p className="journal-intro">Každý nový aktivní signál má uloženou open cenu, čas a objem v lotech. U otevřeného obchodu doplň close cenu, čas a důvod ukončení; výsledek a R se dopočítají automaticky.</p>
        {journalError && <div className="error-message journal-error"><AlertTriangle size={17} /><span>{journalError}</span></div>}
        <div className="journal-table-wrap">
          <table className="journal-table">
            <thead><tr><th>Instrument</th><th>Směr</th><th>Open</th><th>Objem</th><th>Plán držení</th><th>Close</th><th>Výsledek</th><th>Akce</th></tr></thead>
            <tbody>
              {journal.length === 0 ? <tr><td className="journal-empty" colSpan={8}>Zatím tu není žádný uložený obchod.</td></tr> : journal.map((trade) => {
                const closeForm = closeFormFor(trade.tradeId);
                const editForm = editForms[trade.tradeId];
                return <Fragment key={trade.tradeId}>
                  <tr>
                    <td><strong>{trade.instrument}</strong><small>{formatPragueTime(trade.openedAt)}</small></td>
                    <td><span className={`direction-badge direction-badge--${trade.direction.toLowerCase()}`}>{trade.direction}</span></td>
                    <td><strong>{formatJournalPrice(trade.instrument, trade.openPrice)}</strong><small>vstupní cena</small></td>
                    <td><strong>{trade.volume === null ? "—" : trade.volume.toLocaleString("cs-CZ", { maximumFractionDigits: 4 })}</strong><small>{trade.volume === null ? "nezadáno" : "lot"}</small></td>
                    <td>{trade.recommendedHoldMinMinutes && trade.recommendedHoldMaxMinutes ? <><strong>{trade.recommendedHoldMinMinutes}–{trade.recommendedHoldMaxMinutes} min</strong><small>doporučení</small></> : <span>—</span>}</td>
                    <td className="journal-close-cell">
                      {trade.status === "OPEN" ? <div className="close-editor">
                        <input aria-label={`Close cena ${trade.instrument}`} inputMode="decimal" placeholder="Close cena" value={closeForm.closePrice} onChange={(event) => updateCloseForm(trade.tradeId, { closePrice: event.target.value })} />
                        <input aria-label={`Close čas ${trade.instrument}`} type="datetime-local" value={closeForm.closedAt} onChange={(event) => updateCloseForm(trade.tradeId, { closedAt: event.target.value })} />
                        <select aria-label={`Důvod ukončení ${trade.instrument}`} value={closeForm.exitReason} onChange={(event) => updateCloseForm(trade.tradeId, { exitReason: event.target.value as CloseForm["exitReason"] })}>
                          <option value="MANUAL">Ruční ukončení</option><option value="TP1">TP1</option><option value="TP2">TP2</option><option value="SL">Stop-loss</option><option value="BE">Break-even</option><option value="TIME_STOP">Časový stop</option>
                        </select>
                        <button type="button" onClick={() => submitClose(trade)} disabled={closingTradeId === trade.tradeId}>{closingTradeId === trade.tradeId ? <LoaderCircle className="spin" size={14} /> : <Check size={14} />} Uzavřít</button>
                      </div> : <><strong>{trade.closePrice === null ? "—" : formatJournalPrice(trade.instrument, trade.closePrice)}</strong><small>{trade.closedAt ? formatPragueTime(trade.closedAt) : trade.exitReason}</small></>}
                    </td>
                    <td><span className={`result-badge result-badge--${trade.status.toLowerCase()}`}>{trade.status}</span>{trade.resultR !== null && <small>{trade.resultR > 0 ? "+" : ""}{trade.resultR.toFixed(2)} R · {trade.resultPercent?.toFixed(2)} %</small>}</td>
                    <td><div className="action-buttons">
                      <button className="edit-trade-button" type="button" onClick={() => editingTradeId === trade.tradeId ? setEditingTradeId(null) : startEditing(trade)} aria-label={`Editovat ${trade.mode} ${trade.instrument}`} title="Editovat položku v deníku"><Pencil size={14} /><span>Editovat</span></button>
                      <button className="delete-trade-button" type="button" onClick={() => removeTrade(trade)} disabled={deletingTradeId === trade.tradeId} aria-label={`Odstranit ${trade.mode} ${trade.instrument}`} title="Odstranit položku z deníku">{deletingTradeId === trade.tradeId ? <LoaderCircle className="spin" size={14} /> : <Trash2 size={14} />}<span>Odstranit</span></button>
                    </div></td>
                  </tr>
                  {editingTradeId === trade.tradeId && editForm && <tr className="journal-edit-row"><td colSpan={8}>
                    <div className="journal-edit-panel">
                      <div className="journal-edit-heading"><div><strong>Editace {trade.direction} {trade.instrument}</strong><small>Instrument a směr zůstávají navázané na původní analýzu.</small></div></div>
                      <div className="journal-edit-grid">
                        <label><span>Open čas</span><input type="datetime-local" value={editForm.openedAt} onChange={(event) => updateEditForm(trade.tradeId, { openedAt: event.target.value })} /></label>
                        <label><span>Open cena</span><input inputMode="decimal" value={editForm.openPrice} onChange={(event) => updateEditForm(trade.tradeId, { openPrice: event.target.value })} /></label>
                        <label><span>Objem (lot)</span><input inputMode="decimal" value={editForm.volume} onChange={(event) => updateEditForm(trade.tradeId, { volume: event.target.value })} placeholder="např. 0,1" /></label>
                        <label><span>Stop-loss</span><input inputMode="decimal" value={editForm.stopLoss} onChange={(event) => updateEditForm(trade.tradeId, { stopLoss: event.target.value })} /></label>
                        <label><span>Take-profit 1</span><input inputMode="decimal" value={editForm.takeProfit1} onChange={(event) => updateEditForm(trade.tradeId, { takeProfit1: event.target.value })} /></label>
                        <label><span>Take-profit 2</span><input inputMode="decimal" value={editForm.takeProfit2} onChange={(event) => updateEditForm(trade.tradeId, { takeProfit2: event.target.value })} /></label>
                        {trade.status !== "OPEN" && <>
                          <label><span>Close čas</span><input type="datetime-local" value={editForm.closedAt} onChange={(event) => updateEditForm(trade.tradeId, { closedAt: event.target.value })} /></label>
                          <label><span>Close cena</span><input inputMode="decimal" value={editForm.closePrice} onChange={(event) => updateEditForm(trade.tradeId, { closePrice: event.target.value })} /></label>
                          <label><span>Důvod ukončení</span><select value={editForm.exitReason} onChange={(event) => updateEditForm(trade.tradeId, { exitReason: event.target.value as EditForm["exitReason"] })}><option value="MANUAL">Ruční ukončení</option><option value="TP1">TP1</option><option value="TP2">TP2</option><option value="SL">Stop-loss</option><option value="BE">Break-even</option><option value="TIME_STOP">Časový stop</option></select></label>
                        </>}
                      </div>
                      <div className="journal-edit-actions"><button type="button" className="journal-edit-save" onClick={() => saveTradeEdit(trade)} disabled={savingTradeId === trade.tradeId}>{savingTradeId === trade.tradeId ? <LoaderCircle className="spin" size={14} /> : <Check size={14} />} Uložit změny</button><button type="button" className="journal-edit-cancel" onClick={() => setEditingTradeId(null)}>Zrušit</button></div>
                    </div>
                  </td></tr>}
                </Fragment>;
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="performance-section">
        <div className="section-heading"><div><span>Neon databáze</span><h2>Výkonnost strategie</h2></div><small>{stats ? `${stats.savedAnalyses} uložených analýz` : "Načítám statistiky…"}</small></div>
        <div className="performance-grid">
          {[["OBCHODY V DENÍKU", "Historické záznamy a nové potvrzené vstupy", confirmedStats]].map(([mode, description, values]) => {
            const item = values as typeof confirmedStats;
            return <div className="performance-card" key={mode as string}>
              <div><strong>{mode as string}</strong><span>{description as string}</span></div>
              <dl>
                <div><dt>Obchody</dt><dd>{item.total}</dd></div>
                <div><dt>Otevřené</dt><dd>{item.open}</dd></div>
                <div><dt>W / L</dt><dd>{item.wins} / {item.losses}</dd></div>
                <div><dt>Win rate</dt><dd>{item.winRate === null ? "—" : `${item.winRate.toFixed(1)} %`}</dd></div>
              </dl>
            </div>;
          })}
        </div>
        <p className="performance-note">Win rate se začne počítat až po uzavření potvrzených obchodů. Samotná analýza už obchod ani výsledek nevytváří.</p>
      </section>

      {history.length > 0 && (
        <section className="history-section">
          <div className="section-heading"><div><span>Lokálně v tomto zařízení</span><h2>Poslední analýzy</h2></div><button onClick={() => { setHistory([]); localStorage.removeItem("tradelens-data-history"); }}><RotateCcw size={15} /> Vymazat historii</button></div>
          <div className="history-grid">
            {history.map((item) => (
              <button className="history-card" key={item.id} onClick={() => { setAnalysis(item.analysis); setPersistence(null); setTradeDecision(null); setConfirmNotice(""); window.setTimeout(() => resultRef.current?.scrollIntoView({ behavior: "smooth" }), 100); }}>
                <span className={`history-verdict history-verdict--${item.verdict.toLowerCase()}`}>{verdictLabel(item.verdict)}</span>
                <strong>{item.instrument}</strong><p>H1 · M15 · M5 · {new Date(item.createdAt).toLocaleString("cs-CZ")}</p>
                <div><span>Síla filtru {item.confidence}%</span><ChevronRight size={17} /></div>
              </button>
            ))}
          </div>
        </section>
      )}

      <footer><div className="brand"><span className="brand__mark"><TrendingUp size={18} /></span><span>TradeLens <i>DATA</i></span></div><p>Technická analýza jako druhý názor. Finální rozhodnutí je vždy na tobě.</p></footer>
    </main>
  );
}

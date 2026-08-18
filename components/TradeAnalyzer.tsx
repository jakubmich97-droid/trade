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
  Gauge,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Target,
  TrendingUp,
  X,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { InstrumentId, Signal, TradeAnalysis, Verdict } from "@/lib/trade-analysis";

const INSTRUMENTS: Array<{ id: InstrumentId; name: string; description: string }> = [
  { id: "DE40", name: "DE40", description: "Germany 40 / DAX" },
  { id: "US100", name: "US100", description: "Nasdaq 100 / US Tech" },
  { id: "US500", name: "US500", description: "S&P 500 / US Large Cap" },
  { id: "EURUSD", name: "EUR/USD", description: "Euro / US Dollar" },
];

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
  paperTradeId: string | null;
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
  const [riskPercent, setRiskPercent] = useState(1);
  const [accountSize, setAccountSize] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [analysis, setAnalysis] = useState<TradeAnalysis | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [persistence, setPersistence] = useState<PersistenceState | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmNotice, setConfirmNotice] = useState("");
  const [stats, setStats] = useState<StatsState | null>(null);

  async function loadStats() {
    try {
      const response = await fetch("/api/stats", { cache: "no-store" });
      if (!response.ok) return;
      setStats((await response.json()) as StatsState);
    } catch {
      // Analýza funguje i při dočasně nedostupných statistikách.
    }
  }

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("tradelens-data-history");
      if (saved) setHistory(JSON.parse(saved) as HistoryItem[]);
    } catch {
      window.localStorage.removeItem("tradelens-data-history");
    }
    void loadStats();
  }, []);

  const estimatedRisk = useMemo(() => {
    const size = Number(accountSize);
    return size > 0 ? Math.round(size * riskPercent / 100) : null;
  }, [accountSize, riskPercent]);

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
    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instrument,
          xtbPrice: xtbPrice ? parseLocalizedNumber(xtbPrice) : null,
          riskPercent,
          accountSize: accountSize ? Number(accountSize) : null,
        }),
      });
      const payload = (await response.json()) as { analysis?: TradeAnalysis; persistence?: PersistenceState; error?: string };
      if (!response.ok || !payload.analysis) throw new Error(payload.error || "Analýzu se nepodařilo dokončit.");
      setAnalysis(payload.analysis);
      setPersistence(payload.persistence ?? null);
      saveHistory(payload.analysis);
      void loadStats();
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
      setConfirmNotice("Reálný obchod je uložený jako LIVE. Opakované kliknutí nevytvoří duplicitu.");
      void loadStats();
    } catch (requestError) {
      setConfirmNotice(requestError instanceof Error ? requestError.message : "Uložení obchodu selhalo.");
    } finally {
      setConfirming(false);
    }
  }

  const aggregate = (mode: "PAPER" | "LIVE") => {
    const rows = stats?.performance.filter((item) => item.mode === mode) ?? [];
    const total = rows.reduce((sum, item) => sum + item.totalTrades, 0);
    const open = rows.reduce((sum, item) => sum + item.openTrades, 0);
    const wins = rows.reduce((sum, item) => sum + item.wins, 0);
    const losses = rows.reduce((sum, item) => sum + item.losses, 0);
    const decided = wins + losses;
    return { total, open, wins, losses, winRate: decided ? wins / decided * 100 : null };
  };

  const paperStats = aggregate("PAPER");
  const liveStats = aggregate("LIVE");

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
              <button key={item.id} type="button" className={`instrument-card ${instrument === item.id ? "instrument-card--active" : ""}`} onClick={() => { setInstrument(item.id); setAnalysis(null); setXtbPrice(""); }}>
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
            <div><span className="step">02</span><div><h2>Nastavení obchodu</h2><p>Cena z XTB zpřesní vstup, SL a TP.</p></div></div>
          </div>

          <div className="form-grid">
            <label className="field field--wide">
              <span>Aktuální cena v XTB <em>volitelné, ale doporučené</em></span>
              <div className="input-wrap"><Gauge size={17} /><input inputMode="decimal" value={xtbPrice} onChange={(event) => setXtbPrice(event.target.value)} placeholder={instrument === "EURUSD" ? "např. 1,16520" : "např. 24 850,5"} /></div>
            </label>
            <label className="field">
              <span>Riziko na obchod</span>
              <div className="suffix-input"><input type="number" min="0.1" max="5" step="0.1" value={riskPercent} onChange={(event) => setRiskPercent(Number(event.target.value))} /><b>%</b></div>
            </label>
            <label className="field">
              <span>Velikost účtu <em>volitelné</em></span>
              <div className="suffix-input"><input type="number" min="0" value={accountSize} onChange={(event) => setAccountSize(event.target.value)} placeholder="100 000" /><b>Kč</b></div>
            </label>
            {estimatedRisk !== null && <div className="risk-preview"><ShieldCheck size={16} /> Maximální plánované riziko: <strong>{estimatedRisk.toLocaleString("cs-CZ")} Kč</strong></div>}
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
          <button className="analyze-button" type="button" onClick={analyze} disabled={loading}>
            {loading ? <><LoaderCircle className="spin" size={19} /> Stahuji a počítám 1 200 svíček…</> : <><Zap size={19} /> Načíst data a analyzovat <ArrowRight size={18} /></>}
          </button>
          <p className="button-note"><RefreshCw size={13} /> Data se při opakování obnoví nejvýše jednou za minutu.</p>
        </div>
      </section>

      {analysis && (
        <section ref={resultRef} className={`result result--${analysis.verdict.toLowerCase()}`}>
          <div className="result__top">
            <div>
              <span className="result-kicker"><Database size={15} /> Dukascopy · {analysis.detected.instrument} · {new Date(analysis.data.last_updated).toLocaleString("cs-CZ")}</span>
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
              <div className="rr-row"><span>Risk / Reward</span><strong>{analysis.setup.risk_reward}</strong></div>
              <div className="invalidation"><AlertTriangle size={16} /><span><b>Invalidace:</b> {analysis.setup.invalidation}</span></div>
              {analysis.verdict !== "NO_TRADE" && <div className="time-stop"><Clock3 size={16} /><span><b>Časový stop:</b> {analysis.setup.time_stop_rule}</span></div>}
              {analysis.verdict !== "NO_TRADE" && (
                <div className="trade-confirm">
                  <div><Database size={16} /><span>{persistence?.stored ? "Signál i PAPER obchod jsou uložené v Neonu." : "Analýza proběhla, ale databázový zápis se nepodařil."}</span></div>
                  <button type="button" onClick={confirmLiveTrade} disabled={confirming || !persistence?.analysisId}>
                    {confirming ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />} Vstoupil jsem
                  </button>
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

      <section className="performance-section">
        <div className="section-heading"><div><span>Neon databáze</span><h2>Výkonnost strategie</h2></div><small>{stats ? `${stats.savedAnalyses} uložených analýz` : "Načítám statistiky…"}</small></div>
        <div className="performance-grid">
          {[
            ["PAPER", "Všechny systémové signály", paperStats],
            ["LIVE", "Obchody potvrzené v XTB", liveStats],
          ].map(([mode, description, values]) => {
            const item = values as typeof paperStats;
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
        <p className="performance-note">Win rate se začne počítat až po uzavření obchodů. PAPER a LIVE zůstávají oddělené, aby výsledek nezkresloval výběr jen některých signálů.</p>
      </section>

      {history.length > 0 && (
        <section className="history-section">
          <div className="section-heading"><div><span>Lokálně v tomto zařízení</span><h2>Poslední analýzy</h2></div><button onClick={() => { setHistory([]); localStorage.removeItem("tradelens-data-history"); }}><RotateCcw size={15} /> Vymazat historii</button></div>
          <div className="history-grid">
            {history.map((item) => (
              <button className="history-card" key={item.id} onClick={() => { setAnalysis(item.analysis); window.setTimeout(() => resultRef.current?.scrollIntoView({ behavior: "smooth" }), 100); }}>
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

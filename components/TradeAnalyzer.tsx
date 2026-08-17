"use client";

import {
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Check,
  ChevronRight,
  Clock3,
  ImagePlus,
  LoaderCircle,
  LockKeyhole,
  RotateCcw,
  ScanLine,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
  Upload,
  X,
  Zap,
} from "lucide-react";
import { ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from "react";
import type { TradeAnalysis, Verdict } from "@/lib/trade-analysis";

const INDICATORS = [
  "Price Action",
  "Volume",
  "RSI",
  "MACD",
  "EMA 20/50",
  "EMA 200",
  "VWAP",
  "Bollinger Bands",
  "Stochastic",
  "Supertrend",
];

const TIMEFRAMES = ["1m", "5m", "15m", "30m", "1h", "4h", "1D", "1W"];
const STYLES = ["Scalp", "Intraday", "Swing", "Position"];

const DEMO_ANALYSIS: TradeAnalysis = {
  verdict: "NO_TRADE",
  market_read:
    "Cena se drží nad krátkými EMA, ale momentum slábne pod lokální rezistencí. RSI je neutrální a objem nepotvrzuje pokračování pohybu.",
  confidence: 62,
  image_quality: "good",
  detected: {
    instrument: "BTCUSDT",
    timeframe: "15m",
    indicators: [
      { name: "EMA 20/50", reading: "Cena nad EMA, křivky se sbližují", signal: "bullish" },
      { name: "RSI", reading: "Přibližně 54, bez extrému", signal: "neutral" },
      { name: "Volume", reading: "Klesající objem v růstu", signal: "bearish" },
    ],
  },
  setup: {
    entry_zone: "Po potvrzeném průrazu lokální rezistence",
    stop_loss: "Pod poslední potvrzené higher low",
    take_profit_1: "Předchozí swing high",
    take_profit_2: "Další viditelná rezistenční zóna",
    risk_reward: "Čekat na scénář alespoň 1:1,8",
    invalidation: "Close zpět pod EMA 50 a poslední higher low",
  },
  reasons: [
    "Krátkodobá struktura zůstává mírně rostoucí.",
    "Objem zatím nepotvrzuje sílu kupujících.",
    "Vstup před rezistencí by měl slabé R:R.",
  ],
  risks: [
    "Jde jen o jeden statický screenshot bez vyššího timeframe.",
    "Průraz může skončit falešným breakoutem.",
  ],
  next_step: "Počkat na close svíčky nad rezistencí a následný retest s rostoucím objemem.",
  disclaimer: "Vzdělávací technická analýza z jediného screenu, nikoli finanční doporučení.",
};

interface HistoryItem {
  id: string;
  createdAt: string;
  instrument: string;
  timeframe: string;
  verdict: Verdict;
  confidence: number;
  analysis: TradeAnalysis;
}

function verdictLabel(verdict: Verdict) {
  return verdict === "NO_TRADE" ? "NO TRADE" : verdict;
}

function compressImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Obrázek se nepodařilo načíst."));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("Soubor není podporovaný obrázek."));
      image.onload = () => {
        const maxSide = 2200;
        const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
        const width = Math.round(image.width * scale);
        const height = Math.round(image.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");
        if (!context) return reject(new Error("Obrázek se nepodařilo zpracovat."));
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, width, height);
        context.drawImage(image, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.88));
      };
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

function SetupField({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`setup-field ${accent ? "setup-field--accent" : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function TradeAnalyzer() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLElement>(null);
  const [image, setImage] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [instrument, setInstrument] = useState("BTCUSDT");
  const [timeframe, setTimeframe] = useState("15m");
  const [style, setStyle] = useState("Intraday");
  const [indicators, setIndicators] = useState<string[]>(["Price Action", "Volume", "RSI"]);
  const [riskPercent, setRiskPercent] = useState(1);
  const [accountSize, setAccountSize] = useState("");
  const [notes, setNotes] = useState("");
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [analysis, setAnalysis] = useState<TradeAnalysis | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("tradelens-history");
      if (saved) setHistory(JSON.parse(saved) as HistoryItem[]);
    } catch {
      window.localStorage.removeItem("tradelens-history");
    }
  }, []);

  const estimatedRisk = useMemo(() => {
    const size = Number(accountSize);
    return size > 0 ? Math.round((size * riskPercent) / 100) : null;
  }, [accountSize, riskPercent]);

  async function processFile(file?: File) {
    if (!file) return;
    setError("");
    if (!file.type.match(/^image\/(png|jpe?g|webp)$/)) {
      setError("Nahraj PNG, JPG nebo WEBP screenshot.");
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      setError("Soubor je příliš velký. Maximum je 15 MB.");
      return;
    }
    try {
      const compressed = await compressImage(file);
      setImage(compressed);
      setFileName(file.name);
      setAnalysis(null);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Obrázek se nepodařilo načíst.");
    }
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    void processFile(event.target.files?.[0]);
    event.target.value = "";
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    void processFile(event.dataTransfer.files?.[0]);
  }

  function toggleIndicator(indicator: string) {
    setIndicators((current) =>
      current.includes(indicator)
        ? current.filter((item) => item !== indicator)
        : [...current, indicator],
    );
  }

  function saveHistory(nextAnalysis: TradeAnalysis) {
    const item: HistoryItem = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      instrument,
      timeframe,
      verdict: nextAnalysis.verdict,
      confidence: nextAnalysis.confidence,
      analysis: nextAnalysis,
    };
    setHistory((current) => {
      const next = [item, ...current].slice(0, 6);
      window.localStorage.setItem("tradelens-history", JSON.stringify(next));
      return next;
    });
  }

  async function analyze() {
    if (!image) {
      setError("Nejdřív nahraj screenshot grafu.");
      return;
    }
    if (!instrument.trim()) {
      setError("Doplň instrument nebo ticker.");
      return;
    }

    setLoading(true);
    setError("");
    setAnalysis(null);
    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image,
          instrument: instrument.trim(),
          timeframe,
          style,
          indicators,
          riskPercent,
          accountSize: accountSize ? Number(accountSize) : null,
          notes,
        }),
      });
      const payload = (await response.json()) as { analysis?: TradeAnalysis; error?: string };
      if (!response.ok || !payload.analysis) {
        throw new Error(payload.error || "Analýzu se nepodařilo dokončit.");
      }
      setAnalysis(payload.analysis);
      saveHistory(payload.analysis);
      window.setTimeout(() => resultRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Analýza selhala.");
    } finally {
      setLoading(false);
    }
  }

  function showDemo() {
    setAnalysis(DEMO_ANALYSIS);
    setError("");
    window.setTimeout(() => resultRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
  }

  function reset() {
    setImage(null);
    setFileName("");
    setAnalysis(null);
    setError("");
  }

  return (
    <main className="app-shell">
      <div className="ambient ambient--one" />
      <div className="ambient ambient--two" />

      <header className="topbar">
        <a className="brand" href="#top" aria-label="TradeLens domů">
          <span className="brand__mark"><TrendingUp size={20} /></span>
          <span>TradeLens <i>AI</i></span>
        </a>
        <div className="topbar__meta">
          <span className="status"><i /> AI připravena</span>
          <span className="secure"><LockKeyhole size={14} /> Klíč zůstává na serveru</span>
        </div>
      </header>

      <section className="hero" id="top">
        <div className="eyebrow"><Sparkles size={14} /> AI chart intelligence</div>
        <h1>Z grafu k <span>jasnému scénáři.</span></h1>
        <p>
          Nahraj screenshot, označ použité indikátory a získej technický setup
          s transparentním zdůvodněním a risk managementem.
        </p>
        <div className="hero__proof">
          <span><Check size={15} /> LONG / SHORT / NO TRADE</span>
          <span><Check size={15} /> Bez domýšlení nečitelných cen</span>
          <span><Check size={15} /> Obrázek se neukládá do historie</span>
        </div>
      </section>

      <section className="analyzer-grid">
        <div className="panel upload-panel">
          <div className="panel__heading">
            <div><span className="step">01</span><div><h2>Screenshot grafu</h2><p>Nech viditelnou cenovou osu, timeframe a indikátory.</p></div></div>
            {image && <button className="icon-button" onClick={reset} title="Odstranit obrázek"><X size={18} /></button>}
          </div>

          <input ref={fileInputRef} className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" onChange={onFileChange} />
          <div
            className={`dropzone ${dragging ? "dropzone--dragging" : ""} ${image ? "dropzone--filled" : ""}`}
            onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => !image && fileInputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => event.key === "Enter" && fileInputRef.current?.click()}
          >
            {image ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="chart-preview" src={image} alt="Náhled nahraného trading grafu" />
                <div className="preview-bar">
                  <span><ScanLine size={16} /> {fileName}</span>
                  <button onClick={(event) => { event.stopPropagation(); fileInputRef.current?.click(); }}>Změnit</button>
                </div>
              </>
            ) : (
              <div className="dropzone__empty">
                <span className="upload-orbit"><ImagePlus size={30} /></span>
                <strong>Přetáhni sem screenshot grafu</strong>
                <p>nebo vyber obrázek z telefonu či počítače</p>
                <button type="button"><Upload size={17} /> Vybrat screenshot</button>
                <small>PNG, JPG nebo WEBP · max. 15 MB</small>
              </div>
            )}
          </div>

          <div className="quality-tip">
            <ShieldCheck size={18} />
            <div><strong>Tip pro kvalitní výsledek</strong><span>Graf neořezávej těsně. AI potřebuje vidět strukturu ceny, čas i hodnoty indikátorů.</span></div>
          </div>
        </div>

        <div className="panel settings-panel">
          <div className="panel__heading">
            <div><span className="step">02</span><div><h2>Kontext analýzy</h2><p>Pomoz AI správně přečíst tvůj setup.</p></div></div>
          </div>

          <div className="form-grid">
            <label className="field field--wide">
              <span>Instrument / ticker</span>
              <div className="input-wrap"><BarChart3 size={17} /><input value={instrument} onChange={(event) => setInstrument(event.target.value.toUpperCase())} placeholder="např. BTCUSDT, EURUSD, AAPL" /></div>
            </label>

            <label className="field">
              <span>Timeframe</span>
              <select value={timeframe} onChange={(event) => setTimeframe(event.target.value)}>{TIMEFRAMES.map((item) => <option key={item}>{item}</option>)}</select>
            </label>
            <label className="field">
              <span>Styl obchodu</span>
              <select value={style} onChange={(event) => setStyle(event.target.value)}>{STYLES.map((item) => <option key={item}>{item}</option>)}</select>
            </label>

            <div className="field field--wide">
              <span>Co je na grafu vidět?</span>
              <div className="chips">
                {INDICATORS.map((indicator) => (
                  <button key={indicator} type="button" className={indicators.includes(indicator) ? "chip chip--active" : "chip"} onClick={() => toggleIndicator(indicator)}>
                    {indicators.includes(indicator) && <Check size={13} />} {indicator}
                  </button>
                ))}
              </div>
            </div>

            <label className="field">
              <span>Riziko na obchod</span>
              <div className="suffix-input"><input type="number" min="0.1" max="5" step="0.1" value={riskPercent} onChange={(event) => setRiskPercent(Number(event.target.value))} /><b>%</b></div>
            </label>
            <label className="field">
              <span>Velikost účtu <em>volitelné</em></span>
              <div className="suffix-input"><input type="number" min="0" value={accountSize} onChange={(event) => setAccountSize(event.target.value)} placeholder="100 000" /><b>Kč</b></div>
            </label>

            {estimatedRisk !== null && (
              <div className="risk-preview field--wide"><ShieldCheck size={16} /> Maximální plánované riziko: <strong>{estimatedRisk.toLocaleString("cs-CZ")} Kč</strong></div>
            )}

            <label className="field field--wide">
              <span>Vlastní poznámka <em>volitelné</em></span>
              <textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={500} placeholder="Např. čekám na retest rezistence, sleduji divergence…" />
            </label>
          </div>

          {error && <div className="error-message"><AlertTriangle size={17} /><span>{error}</span></div>}

          <button className="analyze-button" type="button" onClick={analyze} disabled={loading}>
            {loading ? <><LoaderCircle className="spin" size={19} /> Analyzuji strukturu grafu…</> : <><Zap size={19} /> Analyzovat graf <ArrowRight size={18} /></>}
          </button>
          <button className="demo-button" type="button" onClick={showDemo}>Nemáš teď screenshot? Zobrazit ukázkový výsledek</button>
        </div>
      </section>

      {analysis && (
        <section ref={resultRef} className={`result result--${analysis.verdict.toLowerCase()}`}>
          <div className="result__top">
            <div>
              <span className="result-kicker"><Sparkles size={15} /> Výsledek technické analýzy</span>
              <div className="verdict-line">
                <span className="verdict-icon">
                  {analysis.verdict === "LONG" ? <ArrowUpRight /> : analysis.verdict === "SHORT" ? <ArrowDownRight /> : <X />}
                </span>
                <div><small>Verdikt</small><h2>{verdictLabel(analysis.verdict)}</h2></div>
              </div>
            </div>
            <div className="confidence" style={{ "--confidence": `${analysis.confidence * 3.6}deg` } as React.CSSProperties}>
              <div><strong>{analysis.confidence}%</strong><span>jistota</span></div>
            </div>
          </div>

          <div className="market-read"><BarChart3 size={20} /><p>{analysis.market_read}</p></div>

          <div className="result-grid">
            <div className="result-card setup-card">
              <div className="result-card__title"><Target size={18} /><h3>Obchodní scénář</h3></div>
              <SetupField label="Vstupní zóna" value={analysis.setup.entry_zone} accent />
              <SetupField label="Stop-loss" value={analysis.setup.stop_loss} />
              <SetupField label="Take-profit 1" value={analysis.setup.take_profit_1} />
              <SetupField label="Take-profit 2" value={analysis.setup.take_profit_2} />
              <div className="rr-row"><span>Risk / Reward</span><strong>{analysis.setup.risk_reward}</strong></div>
              <div className="invalidation"><AlertTriangle size={16} /><span><b>Invalidace:</b> {analysis.setup.invalidation}</span></div>
            </div>

            <div className="result-card">
              <div className="result-card__title"><ScanLine size={18} /><h3>Čtení indikátorů</h3></div>
              <div className="indicator-list">
                {analysis.detected.indicators.map((indicator, index) => (
                  <div className="indicator" key={`${indicator.name}-${index}`}>
                    <span className={`signal signal--${indicator.signal}`} />
                    <div><strong>{indicator.name}</strong><p>{indicator.reading}</p></div>
                    <em>{indicator.signal === "bullish" ? "Bullish" : indicator.signal === "bearish" ? "Bearish" : "Neutral"}</em>
                  </div>
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

      {history.length > 0 && (
        <section className="history-section">
          <div className="section-heading"><div><span>Lokálně v tomto zařízení</span><h2>Poslední analýzy</h2></div><button onClick={() => { setHistory([]); localStorage.removeItem("tradelens-history"); }}><RotateCcw size={15} /> Vymazat historii</button></div>
          <div className="history-grid">
            {history.map((item) => (
              <button className="history-card" key={item.id} onClick={() => { setAnalysis(item.analysis); window.setTimeout(() => resultRef.current?.scrollIntoView({ behavior: "smooth" }), 100); }}>
                <span className={`history-verdict history-verdict--${item.verdict.toLowerCase()}`}>{verdictLabel(item.verdict)}</span>
                <strong>{item.instrument}</strong><p>{item.timeframe} · {new Date(item.createdAt).toLocaleDateString("cs-CZ")}</p>
                <div><span>Jistota {item.confidence}%</span><ChevronRight size={17} /></div>
              </button>
            ))}
          </div>
        </section>
      )}

      <footer>
        <div className="brand"><span className="brand__mark"><TrendingUp size={18} /></span><span>TradeLens <i>AI</i></span></div>
        <p>Technická analýza jako druhý názor. Finální rozhodnutí je vždy na tobě.</p>
      </footer>
    </main>
  );
}

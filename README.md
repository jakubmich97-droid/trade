# TradeLens Data

Bezplatná webová aplikace pro automatickou technickou analýzu OHLCV dat. Nepoužívá screenshoty, OpenAI ani placený API klíč. Tržní data stahuje z veřejného feedu Dukascopy přes knihovnu `dukascopy-node`.

## Podporované trhy

- DE40 / Germany 40 (`deuidxeur`)
- US100 / Nasdaq 100 (`usatechidxusd`)
- US500 / S&P 500 (`usa500idxusd`)
- EUR/USD (`eurusd`)

## Princip analýzy

Při každém spuštění se načte až 400 uzavřených svíček pro každý timeframe:

- H1 určuje hlavní trend a režim trhu
- M15 hledá obchodní setup
- M5 potvrzuje vstupní trigger

Pravidlový engine počítá EMA 20/50/200, RSI 14, ATR 14 a price action posledních svíček. LONG nebo SHORT vrátí pouze při silné shodě všech tří timeframe; jinak zůstává NO TRADE. Volitelná aktuální cena z XTB posune vypočtené vstupní a výstupní úrovně na XTB feed.

## Lokální spuštění

```bash
npm install
npm run dev
```

Nejsou potřeba žádné proměnné prostředí ani API klíče.

## Nasazení

Projekt potřebuje Next.js serverovou routu `/api/analyze`, která načítá data z Dukascopy. Vhodný je například bezplatný Vercel hosting; samotné statické GitHub Pages nestačí.

## Kontroly

```bash
npm run typecheck
npm run build
```

Výstup je vzdělávací technická analýza, nikoli finanční doporučení ani garance výsledku.

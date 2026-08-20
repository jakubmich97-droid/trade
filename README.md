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

Pravidlový engine počítá EMA 20/50/200, RSI 14, ATR 14 a price action posledních svíček. LONG nebo SHORT vrátí pouze při silné shodě všech tří timeframe; jinak zůstává NO TRADE. U NO TRADE doporučí další vhodný čas analýzy podle timeframe, který vstup blokuje. Referenční cenu a čas načítá automaticky ze stejného feedu Dukascopy: preferuje čerstvou uzavřenou M1 svíčku a bezpečně přechází na čerstvou M5 nebo H1, pokud kratší timeframe není dostupný. Zastaralou referenci odmítne. Aktivní signál obsahuje také odhad doporučené doby držení a časový stop odvozený z ATR na M15.

SL a TP se uživateli zobrazují jako vzdálenost od vstupu: pro EUR/USD v pipech (1 pip = 0,0001) a pro indexy v cenových bodech (1 bod = pohyb ceny o 1,0). Absolutní úrovně zůstávají uložené interně pro výpočet doporučeného objemu a vyhodnocování obchodního deníku. V XTB se vzdálenosti aplikují od skutečné exekuční ceny, čímž se eliminuje praktický dopad rozdílné absolutní kotace obou CFD feedů.

Po aktivním výsledku lze zadat aktuální cenu z XTB a přepočítat absolutní vstup, SL, TP1, TP2, doporučený objem a marži. Při následném potvrzení vstupu se přepočítané hodnoty i čas ceny uloží do Neonu; původní technický verdikt a vzdálenosti v pipech/bodech se nemění.

Po zadání velikosti korunového účtu, upravitelného rizikového limitu a maximálního využití marže aplikace dopočítá doporučený objem podle vzdálenosti vstupu od stop-lossu, aktuální specifikace XTB kontraktu, retailové páky a referenčního kurzu ECB. Použije přísnější z limitu ztráty při SL a maržového rozpočtu; velikost účtu je předvyplněná na 200 000 Kč a maržový limit na konzervativních 5 %, přičemž obě hodnoty lze změnit. Objem zaokrouhluje dolů na krok 0,01 lotu. Pokud by už minimální objem překročil některý z limitů, vstup nepovolí. Skutečná marže v xStation se může lišit podle podmínek konkrétního účtu a je rozhodující.

Každá analýza se ukládá do Neon PostgreSQL. Pro spuštění je potřeba jen velikost účtu a nastavení rizika; cenu i čas doplní server z Dukascopy. Samotná analýza žádný obchod nevytvoří. Teprve po zobrazení výsledku uživatel potvrdí, zda do obchodu skutečně vstupuje; pouze potvrzený LONG/SHORT se uloží do obchodního deníku. Opakované potvrzení stejné analýzy nevytvoří duplicitu.

Obchodní deník načítá všechny dříve uložené obchody z pohledu `v_trade_journal` a z tabulky `trades`, aby zůstala zachovaná historická data. Nové obchody se ale vytvářejí výhradně po potvrzení vstupu uživatelem. U otevřeného obchodu lze ručně doplnit close cenu, čas a důvod ukončení. U každé položky lze opravit open čas a cenu, objem, SL, TP1 a TP2; u uzavřeného obchodu také close údaje. Databázový trigger následně určí WIN, LOSS nebo BREAKEVEN a vypočítá výsledek v R.
Jednotlivý obchod lze z deníku také trvale odstranit po potvrzení; související analýza zůstává zachovaná.
Tlačítko „Exportovat CSV“ stáhne až 10 000 obchodů přímo z Neonu v UTF-8 CSV vhodném pro český Excel i následnou datovou analýzu.

## Lokální spuštění

```bash
npm install
npm run dev
```

Pro tržní data Dukascopy ani pro technickou analýzu není potřeba API klíč. Aplikace nezohledňuje ekonomický kalendář; nadcházející makroekonomické zprávy je potřeba před vstupem zkontrolovat ručně v XTB. Pro ukládání statistik nastav proměnnou `DATABASE_URL` na Neon PostgreSQL connection string.

## Nasazení

Projekt potřebuje Next.js serverovou routu `/api/analyze`, která načítá data z Dukascopy. Vhodný je například bezplatný Vercel hosting; samotné statické GitHub Pages nestačí.

## Kontroly

```bash
npm run typecheck
npm run build
```

Výstup je vzdělávací technická analýza, nikoli finanční doporučení ani garance výsledku.

# TradeLens AI

Mobilní webová aplikace pro strukturovanou technickou analýzu screenshotu trading grafu. Uživatel nahraje graf, doplní instrument, timeframe, styl a viditelné indikátory. Serverová AI vrátí jeden ze tří výsledků: `LONG`, `SHORT` nebo `NO TRADE`.

## Co umí první verze

- nahrání PNG, JPG nebo WEBP grafu z počítače i telefonu
- komprese obrázku před odesláním bez ukládání screenu do historie
- výběr timeframe, stylu a použitých indikátorů
- strukturovaný výstup: vstup, stop-loss, dva take-profity, invalidace a R:R
- vysvětlení jednotlivých indikátorů a důvodů verdiktu
- konzervativní `NO TRADE` při nečitelném nebo konfliktním setupu
- lokální historie posledních šesti výsledků bez obrázků
- PWA manifest pro přidání na plochu telefonu

## Lokální spuštění

```bash
npm install
cp .env.example .env.local
npm run dev
```

Do `.env.local` vlož:

```dotenv
OPENAI_API_KEY=sk-proj-...
OPENAI_MODEL=gpt-5.6
```

API klíč patří pouze do serverové proměnné prostředí. Nikdy ho nevkládej do kódu, proměnné s prefixem `NEXT_PUBLIC_` ani do GitHubu.

## Nasazení

Projekt je připravený pro Vercel nebo jiný hosting podporující Next.js serverové routy.

1. Importuj repozitář do hostingu.
2. Přidej tajnou proměnnou `OPENAI_API_KEY`.
3. Volitelně nastav `OPENAI_MODEL`; výchozí je `gpt-5.6`.
4. Spusť standardní build příkaz `npm run build`.

Samotné GitHub Pages nestačí, protože aplikace potřebuje serverovou routu `/api/analyze`, která bezpečně chrání API klíč.

## Bezpečnost analýzy

Model dostává pouze zmenšený screenshot a kontext formuláře. Prompt zakazuje domýšlet nečitelné ceny a omezuje jistotu jedné statické fotografie na 75 %. Přesná cenová úroveň se má vrátit jen tehdy, když je osa grafu čitelná. Výstup je vzdělávací technický scénář, nikoli finanční doporučení.

Implementace používá OpenAI Responses API s obrazovým vstupem a Structured Outputs:

- [Images and vision](https://developers.openai.com/api/docs/guides/images-vision)
- [Structured model outputs](https://developers.openai.com/api/docs/guides/structured-outputs)

## Kontroly

```bash
npm run typecheck
npm run build
```

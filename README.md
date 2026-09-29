# WJP yield

Een zelfstandige, lokale market research terminal. Volledig nieuw gebouwd op 29 september 2026, zonder code of ontwerpen uit andere projecten. Alleen lokaal, buiten iCloud.

**Open de terminal: [localhost:4310](http://localhost:4310).**

## Starten

Dubbelklik op `Start WJP yield.command`, of voer vanuit deze map uit:

```sh
rtk proxy docker compose up --build -d
```

Docker Desktop moet draaien. De terminal is uitsluitend gebonden aan `127.0.0.1:4310`. Automatische containerherstart staat aan. Stoppen: `rtk proxy docker compose stop`. Watchlists en providerinstellingen blijven bewaard in de lokale Docker-volume `wjp-yield_yield-data`. Verwijder deze volume niet als je gegevens wilt behouden.

## Wat werkt

- Echte crypto spot quotes van **Kraken én Coinbase via WebSocket**. Beide bronnen blijven onafhankelijk; prijzen worden niet gemiddeld.
- Automatische keuze op providerprioriteit en actualiteit, REST-terugval, opnieuw verbinden met backoff, foutpauze, timeouts en aanvraagbudget per bron.
- Bronvergelijking met handelsplatform, quotevaluta, ontvangsttijd, provider-tijd en expliciete stale-status. Cross-venue verschillen blijven zichtbaar.
- Historische candles per bron via REST, automatisch elke 30 seconden vernieuwd. De live koers heeft een eigen prijslijn. Geen gefabriceerde OHLC of handelsvolumes uit losse quotes.
- Grafiek: 1m, 5m, 15m, 1u, 1D; candlesticks/lijn; zoom, pan en crosshair; SMA20, EMA50, RSI14 en horizontale prijsniveaus.
- Meerdere blijvend opgeslagen watchlists, zoeken/filteren, instrumenten toevoegen/verwijderen, lijstnaam wijzigen. Grafiekvoorkeuren en selectie blijven lokaal in de browser bewaard. Getekende prijsniveaus zijn sessiegebonden en verdwijnen bij een instrument-, timeframe- of indicatorwissel.
- Providerbeheer: toevoegen, bewerken, testen, uitschakelen, verwijderen, prioriteit, lokaal REST-budget en sleutelbeheer. Meerdere instanties per adapter zijn mogelijk.
- Twelve Data-adapter voor aandelen, ETF’s, valuta en grondstoffen zoals goud/zilver. Eigen symbolen, beurs, instrumenttype en quotevaluta zijn instelbaar.
- Desktop- en mobiele indeling, toetsenbordfocus, toegankelijke dialogs, lokaal gebundelde lettertypen en reduced-motion ondersteuning.

## Andere markten activeren

1. Open **Databronnen** en bewerk **Twelve Data**, of voeg een nieuwe bron met die adapter toe.
2. Vul een eigen Twelve Data-sleutel in, stel het aanvraagbudget passend bij je abonnement in en schakel de bron in.
3. Sla op en kies **Test**. Voeg de gewenste instrumenten toe via de watchlist.

De werkelijke dekking, vertraging en beursrechten worden bepaald door je abonnement. Tijdens de oplevercontrole is Twelve Data via de beheerpagina aangesloten. Echte quotes voor Apple, Microsoft en goud en historische candles voor Apple zijn ontvangen; de adapter is ook met contractfixtures getest. Abonnementsniveau en volledige dekking zijn niet vastgesteld. Ontbrekende data blijft expliciet als ontbrekend zichtbaar. Futures, indices en obligaties kunnen als eigen instrument worden beschreven, maar data is alleen beschikbaar wanneer de gekoppelde provider exact dat symbool, die beurs en die valuta ondersteunt. Dit is geen belofte van universele marktdekking.

Er zijn drie adaptertypes geïmplementeerd. Een willekeurige nieuwe API-URL kan niet zonder adapter worden toegevoegd: protocollen, symbolen en normalisatie verschillen. Nieuwe premium adapters sluiten op hetzelfde datacontract aan zonder herbouw van de terminal.

## Stack en grenzen

React 19.3, TypeScript, Vite 8.3, TradingView Lightweight Charts 5.2, Fastify 5.12 en Node.js 24 LTS, met vastgelegde npm-lockfile en Docker-multistage build. SQLite bewaart uitsluitend configuratie; begrensde caches verwerken recente marktdata in geheugen. Hiermee is de eerste lokale versie eenvoudig te onderhouden. Het is nog geen tickarchief of bewezen infrastructuur voor miljoenen instrumenten. Maximaal 20 watchlists, 50 instrumenten per lijst, 20 broninstanties en 200 eigen instrumenten; actieve REST-rondes zijn begrensd op 100 instrumenten.

Fundamentals, nieuws, sentiment, orderuitvoering, alerts en langlopende dataopslag horen niet bij deze eerste stap. De grafiek gebruikt de open-source Lightweight Charts-library van TradingView; het volledige TradingView-platform en alle tekentools zijn niet inbegrepen.

API-sleutels worden AES-256-GCM versleuteld opgeslagen. De mastersleutel staat met modus 600 in dezelfde lokale Docker-volume; dit beperkt onbedoelde blootstelling via bestanden/API, maar beschermt niet tegen iemand die de hele volume kan lezen. Geen secrets in broncode, logs, browseropslag of iCloud. De app gebruikt lokale host- en Origin-controles, een header voor schrijfverzoeken, CSP, een niet-root-container, een read-only rootbestandssysteem en geen remote luisterpoort. Gebruik deze lokale single-user app niet als publieke multi-user dienst zonder authenticatie en verdere hardening.

De Mac had geen vrije Docker-default-subnets. Alleen voor dit nieuwe project is daarom subnet `10.233.91.0/28` ingesteld. Bij netwerkconflict kan `YIELD_SUBNET` worden aangepast. Andere projecten zijn niet gewijzigd.

## Ontwikkelen en controleren

```sh
rtk proxy npm ci
rtk proxy npm run check
rtk proxy npm run server
# In een tweede terminal:
rtk proxy npm run dev
```

De ontwikkelinterface draait op 4311; de lokale API op 4310. Stop eerst de Docker-app als je de lokale Node-server op dezelfde poort wilt gebruiken. Lokale devdata staat in `data/`, buiten Git en buiten iCloud.

Lees [de architectuur](docs/ARCHITECTURE.md) voor het providercontract en [de ontwerpspecificatie](docs/DESIGN.md) voor de visuele basis.

## Primaire documentatie

- De live crypto-integraties volgen [Kraken ticker v2](https://docs.kraken.com/exchange/api-reference/spot-websocket-v2/ticker) en [Coinbase Exchange WebSocket](https://docs.cdp.coinbase.com/exchange/websocket-feed/channels).
- Historie volgt [Kraken OHLC](https://docs.kraken.com/api-reference/market-data/get-ohlc-data) en [Coinbase candles](https://docs.cdp.coinbase.com/api-reference/exchange-api/rest-api/products/get-product-candles).
- Multi-asset toegang en abonnementen: [Twelve Data API](https://twelvedata.com/docs).
- Charts en vereiste attribution: [TradingView Lightweight Charts](https://tradingview.github.io/lightweight-charts/). Charting library © TradingView, Inc.; Apache 2.0. De TradingView-link en het attributionlogo blijven zichtbaar.

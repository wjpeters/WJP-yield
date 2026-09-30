# Cataloguscontrole · 30 september 2026

## Fixturetests

Zeven gerichte tests controleren actieve spotstatus, quotevaluta, Kraken BTC/DOGE-aliases, verschillende aandelenbeurzen, samenvoegen, bron- en marktfilter, paginering, servervalidatie, geselecteerde instrumenten over een herstart, TTL, stale fallback, verdwenen listings, bronwijzigingen tijdens requests, budgetdeling, GET-only Alpaca assets, paper-fallback, sleutelredactie en Twelve Data-lijsten van 150.000 records. Alle bestaande tests en de productiebuild draaien via `npm run check` in de Docker-build.

## Werkelijke catalogusontvangst

| Bron              | Genormaliseerde instrumenten | Resultaat                                                       |
| ----------------- | ---------------------------: | --------------------------------------------------------------- |
| OKX EEA           |                        1.148 | Actieve spotparen                                               |
| Kraken            |                        1.356 | Online paren met apart REST-symbool                             |
| Coinbase Exchange |                          513 | Online, niet-uitgeschakelde paren                               |
| Twelve Data       |                      262.266 | Aandelen, ETF’s, valuta en grondstoffen met bekende quotevaluta |
| Alpaca            |                       13.234 | Actieve US-aandelen voor de ingestelde aandelenfeed             |

Alle vijf bronnen meldden een ontvangen catalogus zonder waarschuwing of fout. Aantallen zijn momentopnamen. BTC/EUR werd één resultaat met OKX, Kraken en Coinbase; BTC/EURC, BTC/EUROP, TBTC/EUR en WBTC/EUR bleven aparte resultaten. De terminalstatus bevat geen volledige broncatalogi. Een BTC/EUR-zoekopdracht werd in ongeveer 132 ms verwerkt bij de eerste controle; Docker rapporteerde circa 472 MiB van de bestaande 768 MiB-limiet.

## Grenzen

Een referentielijst is geen bewijs van koersrechten. Uitgeschakelde bronnen worden niet ingeschakeld. Alpaca blijft voor crypto beperkt tot USD-spot volgens het bestaande datacontract; OTC-aandelen die de adapter niet ondersteunt en commodity-records zonder bekende quotevaluta worden niet als beschikbare catalogusinstrumenten gepresenteerd. Offline/delisted paren en derivaten ontbreken in de spotcatalogus. Bij fouten blijven bewaarde catalogi en gedeeltelijk ontvangen Twelve Data-categorieën zichtbaar met hun meldingen.

## Browser- en herstartcontrole

Bronfilter Coinbase toont BTC/EUR; bronfilter Alpaca en marktfilter Aandelen tonen INTC op NASDAQ met Twelve Data en Alpaca. Paginering is gecontroleerd van 1–50 naar 51–100 in 7.533 aandelenresultaten. Na de Docker-herstart bleven alle catalogusaantallen beschikbaar en waren BTC/EUR-koersen van OKX, Kraken en Coinbase vers via WebSocket. De realtime snapshot bevatte 41 instrumenten, niet de circa 268.000 zoekresultaten. Alle 70 tests en de productiebuild zijn geslaagd.

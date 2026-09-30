# OKX-adapter — 30 september 2026

- Zelfstandige publieke marktdata-adapter voor OKX Europa; REST-tickers/candles en
  WebSocket-tickers. Geen account-, order- of opnameaanvragen.
- Catalogus: negen cryptoactiva in EUR en USDC. Alle 18 mappings vanuit Docker via
  de publieke instrumentlijst gecontroleerd: bestaande spotparen, exacte quotevaluta.
  USDC wordt niet als USD weergegeven.
- Live vanuit Docker gecontroleerd: BTC/EUR en BTC/USDC REST-koersen en 300
  dagcandles per paar. Dagcandles gebruiken de UTC-intervalcode.
- De watchlist OKX spot bevat BTC, ETH en SOL in EUR en USDC.
- Productiebouw en alle 52 tests geslaagd, ook tijdens de definitieve Docker-build.
- Acht nieuwe OKX-tests dekken endpoints, payloadnormalisatie, tijd en volume,
  valutagrenzen, spot versus derivaten, rate limits, ontbrekende instrumenten,
  geheime/onbetrouwbare providertekst, dynamische subscriptions, ping/pong,
  reconnect, late frames, migratie, bronvergelijking en failover.
- Formatteringscontrole geslaagd; de laatste aangepaste bestanden opnieuw geformatteerd.
- Docker-image opnieuw gebouwd en de terminal gestart met behoud van het datavolume.
- Browsercontrole: OKX spot zichtbaar, BTC/EUR-candlegrafiek geladen en live
  WebSocket-koersen met status Streaming. Geen browserwaarschuwingen of fouten.
- REST-terugval blijft binnen OKX beschikbaar. Bronvergelijking en failover zijn
  automatisch getest; voor deze EUR/USDC-paren is momenteel alleen OKX gekoppeld.

Bron: https://my.okx.com/docs-v5/en/ (Europese endpoints, tickers, candles, WebSocket).

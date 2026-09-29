# Datacontract en architectuur

```text
Kraken WS/REST ────┐
Coinbase WS/REST ──┼── adapters → validatie → brongebonden quotes → router → lokale WS → React
Twelve Data REST ─┘                        └── historiecache → REST → Lightweight Charts
```

## Modulegrenzen

- `server/domain.mjs`: instrumentcatalogus, candlevalidatie, freshness en pure bronselectie.
- `server/adapters.mjs`: vaste upstream endpoints, symboolmapping, normalisatie en foutvertaling.
- `server/engine.mjs`: feedlevenscyclus, reconnect, rate budget, circuit breaker, round-robin polling, prioriteit, bounded caches en bronwisselingen.
- `server/store.mjs`: SQLite-configuratie en AES-GCM-sleutels. Geen quoteopslag in SQLite.
- `server/index.mjs`: lokale HTTP/WS API, schema- en Origin-validatie, statische client.
- `src/`: afzonderlijke scherm-, grafiek-, watchlist- en providercomponenten.

## Instrument en identiteit

`id, symbol, name, assetClass, exchange, currency, mappings[adapterType]`.

Crypto is een expliciete cross-venue researchgroep: BTC/USD spot bij Kraken en Coinbase. Geen USDT/USD-substitutie. Aandelen koppelen symbool, beurs en quotevaluta. Een nieuwe feed krijgt een expliciete mapping, nooit blinde stringmatching of het mengen van spot, futures, valuta en aangepaste/onbewerkte historie.

## Quotecontract

`instrumentId, providerId, provider, price, currency, venue, sourceAt, receivedAt, transport, timeliness, bid, ask, high, low, volume, changePct`.

Prijs moet eindig en positief zijn. Bron-tijd mag niet meer dan 30 seconden in de toekomst liggen. Oude providerupdates worden verworpen. Ontvangsttijd wordt uitsluitend bij echte nieuwe ontvangst gezet. Ontbrekende tijd/volume/verandering blijft null.

WebSocket-quotes worden na 45 seconden oud; crypto REST na 60 seconden; andere quotes na 120 seconden. Lagere prioriteitsnummers winnen tussen actuele, ingeschakelde bronnen. Als alles oud is, blijft de nieuwste bekende quote zichtbaar met stale-label. Twelve Data krijgt altijd `timeliness=entitlement`: de app concludeert geen realtime-rechten uit een succesvol HTTP-antwoord. Gesloten markten kunnen bewust oude quotes tonen. Een heartbeat is geen nieuwe koers.

## Historie

Een antwoord bevat een enkele provider en venue. Sortering, deduplicatie en OHLC/volume-validatie gebeuren vóór verzending. Maximaal 500 candles in een response, maximaal 100 cachekeys. Cacheduur 15 seconden voor crypto en 60 seconden voor Twelve Data. Gelijktijdige gelijke verzoeken delen één upstream call. De browser haalt elke 30 seconden op; ontbrekende of mislukte vernieuwing blijft zichtbaar. Tijdas is UTC; ontvangsttijden in statusvelden volgen de browserlocale.

De actuele quote wordt als aparte prijslijn getoond. REST-candles worden niet kunstmatig aangepast met de quote. Bij bronwisseling wordt de hele chartreeks opnieuw geladen. Bij een historie-fallback kan de chartbron verschillen van de quote; dat wordt boven de chart vermeld.

## Transport en belasting

Twee onafhankelijke publieke crypto WebSockets abonneren op de negen cryptoparen uit de initiële catalogus. Backoff met jitter tot 30 seconden en een 35-seconden-ontvangstwatchdog. REST-polling vult ontbrekende/oude data aan. Een provider heeft een configureerbaar sliding-window budget. Round-robin voorkomt dat latere watchlistinstrumenten structureel worden overgeslagen. Drie REST-fouten of HTTP/JSON-status 429 openen het circuit 60 seconden. Het sliding-window aanvraagbudget en de foutpauze blijven in SQLite bewaard over containerherstarts. Streaming succes reset de REST-breaker niet.

HTTP-timeout 9 seconden. De lokale client krijgt maximaal één snapshot per seconde; klanten met meer dan 512 KB uitgaande achterstand worden afgesloten. De UI reconnect automatisch en markeert zichtbare koersen oud bij verbindingsverlies. Feeddata is geheugenbegrensd; dit is bewust geen tick-datawarehouse.

## Premium feeds toevoegen

1. Implementeer `quote(instrument, _, secret)` en `candles(instrument, interval, secret)` onder een nieuw adaptertype.
2. Voeg catalogusmetadata, exacte mappings en capabilities toe. Voeg indien beschikbaar een eigen stream-parser toe.
3. De API-validatie en beheerinterface lezen de adapterregistratie dynamisch. Behoud secret-redactie, timeouts en request accounting.
4. Schrijf fixturetests voor tijdzone, valuta, instrumentidentiteit, vertraging, verkeerde payloads en errors.
5. Test een echte feed met de gekozen rechten. De client en het chartcontract blijven gelijk.

Er is geen willekeurige URL-fetcher: hiermee voorkomt de providerbeheerpagina onbedoelde toegang tot interne netwerkadressen. Meerdere configinstanties van een bestaande adapter zijn nu al mogelijk. Delen instanties één abonnement, verdeel dan het totale requestbudget; upstream accountlimieten blijven leidend.

## Opslag en herstel

SQLite WAL voor kleine configuratiewijzigingen; volume blijft bestaan bij containervervanging. Bewaar bij een lokale backup de hele gestopte volume inclusief master.key en SQLite-bestanden, uitsluitend buiten gesynchroniseerde mappen. Zonder master.key zijn opgeslagen API-sleutels niet herstelbaar. Er is geen automatische backup ingesteld.

### Twelve Data-tijdvelden

`sourceAt` gebruikt uitsluitend `last_quote_at` (tijd van de laatste minuutcandle). `timestamp` is volgens de [providerdocumentatie](https://twelvedata.com/docs) de openingstijd van de gekozen candle en wordt apart als `barStartAt` bewaard. Ontbreekt `last_quote_at`, dan blijft de koerstijd onbekend; ontvangsttijd wordt niet als bewezen koerstijd gepresenteerd. Een gesloten markt krijgt een eigen status, zonder oude quotes als realtime te behandelen.

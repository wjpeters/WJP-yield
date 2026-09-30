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

## Tekeningen

`src/drawings.ts` bevat het ankercontract en de interpolatie tussen UTC-tijden en candle-indexen. `DrawingTools.tsx` projecteert één SVG-tekenlaag op het eerste prijsvak. Een lichte animation-frame meting volgt vier schaalcoördinaten; alleen een gewijzigde transformatie veroorzaakt een render. Er worden geen marktdata of candles gewijzigd. De tekenlaag vangt alleen actieve tekenhandelingen en selectie van vormen af; overige muisinteractie blijft bij de grafiek.

`server/drawings.mjs` biedt GET per instrument en PUT/DELETE per tekening onder `/api/drawings`. Validatie controleert instrument, UUID, type, kleur, eindige tijd-/prijsankers en de limiet van 100 vormen. Opslag staat onder `drawings:<instrumentId>` in de lokale SQLite-store. Upsert per tekening voorkomt dat bewerkingen aan verschillende tekeningen elkaar overschrijven. Bij gelijktijdige bewerking van dezelfde tekening geldt de laatst opgeslagen versie.

## Alpaca

`server/alpaca.mjs` implementeert de REST- en WebSocket-adapter. `supportsInstrument` filtert op feed, markt, US-beurs en USD voordat routing plaatsvindt. Het bestaande quote/candle-contract blijft gelijk; feed, tradeVenue, quoteAt en statsAt zijn extra bronmetadata. Een verse bid/ask of dagbar maakt een oude transactietijd nooit opnieuw actueel. REST-fallback loopt via hetzelfde aanvraagbudget als de bron-test en historie. De WebSocket gebruikt authenticatie voor subscriptions, ping/pong voor stille markten, een symbolenlimiet van 30, abonnementsupdates en gecontroleerd opnieuw verbinden. Broker/trading-API’s worden niet gebruikt.

`provider-config.mjs` valideert de twee credentials en versleutelt ze als één JSON-paar in het bestaande secret-veld. Beide blijven afwezig in publieke providerobjecten. De eenmalige lokale migratie voegt een uitgeschakelde Alpaca/IEX-bron toe zonder bestaande bronnen of sleutels te vervangen. Een verwijderde Alpaca-bron keert niet terug bij herstart. Providerwijzigingen maken cache/quotes ongeldig; generation-controles verwerpen oude REST-resultaten tijdens herstart.

## OKX

`server/okx.mjs` is de zelfstandige publieke EEA-spotadapter. Vaste hosts beperken
verzoeken tot marktdata; authenticatie en orderuitvoering horen bij een latere,
aparte execution-module. `instId`, `instType`, base en quotevaluta moeten exact
aansluiten op het domeininstrument. EUR en USDC zijn aparte instrumenten. Geen futures- of USD/stablecoin-substitutie.

REST gebruikt ticker en candles. OKX-code 50011 activeert de bestaande rate-limitpauze;
ontbrekende instrumenten krijgen een instrumentpauze. Providertekst wordt niet
rechtstreeks doorgegeven. Ticker-`ts` is de generatietijd van de ticker, niet bewezen
de tijd van de laatste transactie; heartbeat/pong veranderen geen koers of brontijd.
Candles gebruiken volume in basiseenheden, milliseconden naar UTC-seconden,
`1Dutc` voor dagen en `confirmed` voor de providerstatus van elke candle.

De WebSocket gebruikt dynamische tickers-subscriptions voor actieve instrumenten,
textuele ping/pong, een ontvangsttimeout, reconnect en generation-controles.
De bron werkt met dezelfde routing, caching, validatie en aanvraagbudgetten als
andere adapters. De OKX-migratie respecteert bestaande configuratie en verwijdering.

## Grafiekintervallen

De grafiek ondersteunt 1/5/15/30 minuten, 1/2/4/6/12 uur, dag, week, maand, kwartaal en jaar. `server/timeframes.mjs` kiest native bronintervallen en bundelt alleen echte OHLC-candles van dezelfde provider waar nodig. Open = eerste, close = laatste, high/low = extrema, volume = som (onbekend blijft onbekend). Kalendermaanden, kwartalen en jaren gebruiken echte UTC-kalendergrenzen; samengestelde weken beginnen maandag. Native bars behouden de providerkalender (Alpaca gebruikt zijn beurskalender).

Kraken levert native tot week; maand/kwartaal/jaar gebruiken maximaal 720 dagcandles. Coinbase levert maximaal 300 candles en gebruikt dagbars voor week en langer. Twelve Data bundelt maandbars voor kwartaal/jaar en 2u/4u voor 6u/12u. OKX levert native UTC-bars tot kwartaal; jaar bundelt maandbars. Alpaca gebruikt native 1Week/1Month/3Month/12Month en een langere terugblik. Geen extra upstream calls of wijziging van aanvraagbudgetten.

Normalisatie kapt pas na bundeling af op 500 resultaatcandles. De oudste samengestelde candle krijgt `partial` als bronhistorie na het begin van die periode begint; de interface vermeldt dat. `confirmed: false` houdt lopende samengestelde periodes en onvoltooide OKX-bronbars herkenbaar. Ontbrekende handelsperiodes worden niet ingevuld. Dit is een begrensde grafiek, geen volledige historische data-export. De UI en tekentools delen `src/timeframes.ts`; nominale maand/jaarsduur wordt alleen gebruikt voor extrapolatie buiten geladen tekenankers.

Primaire intervaldocumentatie: [Kraken OHLC](https://docs.kraken.com/api-reference/market-data/get-ohlc-data), [Coinbase candles](https://docs.cdp.coinbase.com/api-reference/exchange-api/rest-api/products/get-product-candles), [OKX](https://my.okx.com/docs-v5/en/), [Alpaca bars](https://docs.alpaca.markets/us/reference/stockbars), [Twelve Data SDK](https://github.com/twelvedata/twelvedata-python).

## Brongebonden instrumentcatalogus

`server/catalog.mjs` verwerkt providerreferentielijsten naar het bestaande instrumentcontract. `GET /api/catalog` accepteert `q`, `provider`, `assetClass`, `offset` en `limit` (maximaal 100) en geeft `items`, `total` en bronstatus terug. Refresh is asynchroon; de client pollt alleen zolang broncatalogi worden opgehaald. `POST /api/catalog/refresh` vraagt expliciete verversing, `POST /api/catalog/instruments` registreert uitsluitend een serverbekend ID voor de bestaande watchlist-flow. Brondata wordt gevalideerd; foutantwoorden en sleutels worden niet doorgegeven.

Cache per provider in `catalog:<id>` met type/feed en ophaaltijd. Twelve Data-categorieën worden afzonderlijk behouden bij gedeeltelijke fouten, zonder dubbele serialisatie van dezelfde records. Catalogi staan buiten de realtime snapshot. `discovered-instruments` bewaart alleen geselecteerde/bestaande instrumenten met bron-ID, feed en exacte symboolmapping. Gelijke crypto-basis/quote en gelijke aandelenbeurs/symbool/valuta behouden stabiele IDs; instrumenten worden niet over quotevaluta of beurs heen samengevoegd. Nieuwe providerinstanties krijgen geen ongeteste cataloguskoppeling. Verdwenen geregistreerde paren verliezen hun bronmapping zonder de watchlist of grafiekannotaties te verwijderen.

`Engine.reserveBudget` wordt gedeeld door koersen en catalogusrequests. Catalogusontvangst vernieuwt geen koerstijd, latency of live-status. Kraken/Coinbase-streams synchroniseren actieve symbolen en sturen subscribe/unsubscribe, met maximaal 100 actieve instrumenten. Alle Alpaca-catalogusverzoeken zijn GET op vaste assets-endpoints; credentials blijven in serverheaders.

## Instrument research

`server/research.mjs` biedt `GET /api/research?instrument=<id>&section=fundamentals|sentiment|news|market`. De vier secties staan los van de koersadapters en halen alleen publieke data op. `Research` normaliseert upstream payloads, begrenst requests/pending werk/cache, deelt gelijke aanvragen en behoudt data met stale/error bij mislukte vernieuwing. Er worden geen sleutels verstuurd en researchontvangst wijzigt geen koersstatus. CoinGecko IDs zijn voor negen bekende assets vastgelegd; onbekende munten worden niet op alleen hun ticker gekoppeld. SEC combineert ticker én beurs met CIK en accepteert passende 10-K/US-GAAP-waarden. Nieuwslinks beperken protocollen tot HTTP(S) en bevatten geen embedded HTML. Bij een GDELT-fout wordt een vaste Google Nieuws RSS-host gebruikt; een vastgelegde XML-parser verwerkt uitsluitend metadata. DTD/entity-definities en te grote XML worden geweigerd. Uitgever, bronscope, terugvalreden en publicatietijd volgens de RSS-feed blijven zichtbaar.

`src/MarketOverview.tsx` deelt de selectie met de app, haalt de secties onafhankelijk op en annuleert aanvragen bij een instrumentwissel. `src/technicals.ts` berekent de transparante gauge op afgesloten candles uit het bestaande historiecontract. Historie vernieuwt elke minuut via het bestaande providerbudget; aanvullende research vernieuwt bij openen of expliciet vernieuwen, binnen de servercache. Geen verborgen researchpolling of wijziging van providerinstellingen.

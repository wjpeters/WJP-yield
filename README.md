# WJP yield

Een zelfstandige lokale market research terminal, uitgebreid met een onderzoeksfirma en Strategie-lab op 30 september 2026. Alleen lokaal, buiten iCloud. De bestaande terminal blijft beschikbaar.

**Open [Firm en Strategie-lab](http://localhost:4311), of [Terminal](http://localhost:4310).**

## Firm en Strategie-lab

- Acht geregistreerde onderzoeksrollen, vier ingeschakeld, met doelen, taken, review, begrensde delegatie en budgetten.
- PostgreSQL bewaart de organisatie, configuraties en een append-only Journal met hashketen. De researchscheduler werkt buiten de browser.
- Versiegebonden EMA- en Donchian-strategieën, echte publieke OKX-spotdatasets, kostenbacktests en drie chronologische OOS-vensters.
- Bots kunnen worden geconfigureerd en als DRAFT opgeslagen. De botworker en automatische uitvoering zijn vervolgwerk.
- TypeSafe System One en OpenRouter System One zijn voorbereid voor Jev. Beide echte routes zijn nog uitgeschakeld; de duurzame providerbudgetkoppeling staat open.

Lees het [fase 1-plan](docs/PHASE-1-STRATEGY-LAB.md), de [opleverstatus](STATUS.md), de [Firm-architectuur](docs/FIRM-ARCHITECTURE.md) en de [onafhankelijke review](REVIEW.md). De volledige masterwens is bewaard in [de bronspecificatie](docs/AUTONOMOUS-FIRM-SPEC-2026-09-30.md). Dit is de lokale onderzoeksbasis; 24/7 paper/OKX-demo, echte AI-runs en Hostinger-productie zijn nog niet geleverd.

## Starten

Dubbelklik op `Start WJP yield.command`, of voer vanuit deze map uit:

```sh
rtk proxy docker compose up --build -d
```

Docker Desktop moet draaien. De lokale services zijn uitsluitend gebonden aan `127.0.0.1`: Terminal op 4310, Firm op 4311 en Owner API op 4312. Automatische containerherstart staat aan. Stoppen: `rtk proxy docker compose stop`. Watchlists en providerinstellingen blijven bewaard in de lokale Docker-volume `wjp-yield_yield-data`. Firm-state staat apart in `wjp-yield_firm-postgres-local`. Verwijder deze volumes niet als je gegevens wilt behouden. PostgreSQL en Redis hebben geen hostpoort. De interne trust-auth is uitsluitend voor deze lokale opstelling; gebruik deze Compose-configuratie niet als publieke VPS-configuratie.

## Wat werkt

- Echte crypto spot quotes van **Kraken, Coinbase en OKX via WebSocket**. Beide bronnen blijven onafhankelijk; prijzen worden niet gemiddeld.
- Automatische keuze op providerprioriteit en actualiteit, REST-terugval, opnieuw verbinden met backoff, foutpauze, timeouts en aanvraagbudget per bron.
- Bronvergelijking met handelsplatform, quotevaluta, ontvangsttijd, provider-tijd en expliciete stale-status. Cross-venue verschillen blijven zichtbaar.
- Historische candles per bron via REST, automatisch elke 30 seconden vernieuwd. De live koers heeft een eigen prijslijn. Geen gefabriceerde OHLC of handelsvolumes uit losse quotes.
- Grafiek: 1m, 5m, 15m, 30m, 1u, 2u, 4u, 6u, 12u, 1D, 1W, 1M, 3M (kwartaal), 1J; candlesticks/lijn; zoom, pan en crosshair; SMA20, EMA50, RSI14 en tekentools: horizontale niveaus, trendlijnen, rechthoeken en Fibonacci-retracements.
- Meerdere blijvend opgeslagen watchlists, zoeken/filteren, instrumenten toevoegen/verwijderen, lijstnaam wijzigen. Grafiekvoorkeuren en selectie blijven lokaal in de browser bewaard. Tekeningen worden per instrument in de lokale SQLite-database bewaard en blijven behouden bij herladen, herstarten en het wisselen van tijdsperiode, indicatoren of grafiektype.
- Providerbeheer: toevoegen, bewerken, testen, uitschakelen, verwijderen, prioriteit, lokaal REST-budget en sleutelbeheer. Meerdere instanties per adapter zijn mogelijk.
- Alpaca-adapter voor Amerikaanse aandelen, ETF’s en crypto, met expliciete IEX/SIP/Alpaca-US-feedkeuze, twee versleutelde sleutels, WebSocket en REST.
- Twelve Data-adapter voor aandelen, ETF’s, valuta en grondstoffen zoals goud/zilver. Eigen symbolen, beurs, instrumenttype en quotevaluta zijn instelbaar.
- Desktop- en mobiele indeling, toetsenbordfocus, toegankelijke dialogs, lokaal gebundelde lettertypen en reduced-motion ondersteuning.

## Andere markten activeren

1. Open **Databronnen** en bewerk **Twelve Data**, of voeg een nieuwe bron met die adapter toe.
2. Vul een eigen Twelve Data-sleutel in, stel het aanvraagbudget passend bij je abonnement in en schakel de bron in.
3. Sla op en kies **Test**. Voeg de gewenste instrumenten toe via de watchlist.

De werkelijke dekking, vertraging en beursrechten worden bepaald door je abonnement. Tijdens de oplevercontrole is Twelve Data via de beheerpagina aangesloten. Echte quotes voor Apple, Microsoft en goud en historische candles voor Apple zijn ontvangen; de adapter is ook met contractfixtures getest. Abonnementsniveau en volledige dekking zijn niet vastgesteld. Ontbrekende data blijft expliciet als ontbrekend zichtbaar. Futures, indices en obligaties kunnen als eigen instrument worden beschreven, maar data is alleen beschikbaar wanneer de gekoppelde provider exact dat symbool, die beurs en die valuta ondersteunt. Dit is geen belofte van universele marktdekking.

Er zijn vijf adaptertypes geïmplementeerd. Een willekeurige nieuwe API-URL kan niet zonder adapter worden toegevoegd: protocollen, symbolen en normalisatie verschillen. Nieuwe premium adapters sluiten op hetzelfde datacontract aan zonder herbouw van de terminal.

## OKX gebruiken

OKX wordt eenmalig als ingeschakelde publieke bron toegevoegd, met prioriteit 50 en
60 REST-aanvragen per minuut. Je hebt hiervoor geen account of API-sleutel nodig.
Bestaande prioriteiten en watchlists blijven behouden. Een verwijderde OKX-bron
wordt niet opnieuw toegevoegd bij herstart.

- Open **Databronnen → OKX** om te testen, prioriteit te wijzigen of de bron uit te schakelen.
- Een aparte **OKX spot**-watchlist bevat BTC, ETH en SOL in EUR en USDC.
- Zoek bij **Instrument toevoegen** naar bijvoorbeeld **BTC/EUR**, **ETH/EUR** of **SOL/EUR**.
- De startcatalogus omvat BTC, ETH, SOL, XRP, ADA, DOGE, LINK, AVAX en LTC, elk in EUR en USDC.
- EUR, USD en USDC worden niet onderling verwisseld. De huidige Docker-aansluiting levert geen USD-spotparen; bestaande USD-watchlists blijven daarom bij hun eigen bronnen. De adapter gebruikt uitsluitend spotparen.

De aansluiting gebruikt de Europese publieke endpoints `eea.okx.com` en
`wseea.okx.com`. Koersen bevatten bid/ask, 24-uursbereik, basisvolume en de tijd
waarop OKX de ticker genereerde. De stream volgt actieve instrumenten en reconnect
bij onderbreking; REST blijft beschikbaar als terugval. Grafieken bevatten maximaal
300 candles per aanvraag, met dagcandles op UTC en de status van de lopende candle.
Historie wordt volgens het bestaande terminalritme elke 30 seconden vernieuwd.

**Later handelen op OKX:** dit is nu een marktdata-adapter. Een toekomstige
uitvoeringsadapter moet afzonderlijk authenticatie (key, secret, passphrase),
accountrechten, instrumentregels, orders, risicolimieten en demo/live-scheiding
implementeren. Er zijn nu geen account-, order- of opnameverzoeken en er worden
geen OKX-sleutels gevraagd. Publieke marktdekking bewijst geen persoonlijke handelsrechten.

Documentatie: [OKX Europese API-gids](https://my.okx.com/docs-v5/en/).

## Alpaca activeren

1. Open **Databronnen → Alpaca bewerken**. De bron is toegevoegd maar staat uit totdat je eigen sleutels zijn ingevuld.
2. Kies **IEX** voor de IEX-feed van Amerikaanse aandelen/ETF’s, **SIP** alleen met de vereiste realtime-datarechten, of **Crypto · Alpaca US**. Er wordt niets gekocht en de adapter schakelt niet automatisch naar een duurdere feed.
3. Voer **API Key ID én Secret Key** lokaal in de beheerpagina in, stel prioriteit/aanvraagbudget in, schakel de bron in en sla op. Lege sleutelvelden behouden het opgeslagen paar; bij vervangen voer je beide opnieuw in. Plak sleutels niet in chat of broncode.
4. Klik **Test**. Voor aandelen en crypto tegelijk voeg je twee Alpaca-bronnen toe, elk met de juiste feed. Een gedeeld abonnement kan verbindings- en aanvraaglimieten hebben: stem het gezamenlijke budget daarop af.

IEX omvat één handelslocatie, SIP is geconsolideerd over Amerikaanse beurzen. Feed/venue blijven zichtbaar in de vergelijking en grafiek. Koersen en historie gebruiken `data.alpaca.markets` en `stream.data.alpaca.markets`. De instrumentcatalogus gebruikt uitsluitend GET op het assets-metadata-endpoint; accounts, posities en orders worden niet opgehaald. Paper/live-sleutels gebruiken dezelfde marktdata-adressen; de sleutels en abonnementen bepalen toegang. Amerikaanse USD-aandelen/ETF’s uit de catalogus en eigen instrumenten met een passende US-beurs worden gemapt. Crypto gebruikt symbolen zoals BTC/USD, locatie `us`; de actuele dekking hangt af van Alpaca.

De stream abonneert maximaal 30 actieve symbolen per bron op transacties, bid/ask en dagbars; overige actieve symbolen worden via REST opgevraagd. Dagbereik/volume komen uit de provider-snapshot of dagbar, niet uit zelf opgetelde ticks. Een eerste trade zonder daggegevens toont daarvoor ontbrekende waarden. Bid/ask-updates en dagbars vernieuwen de tijd van de laatste transactie niet. Een correctie of annulering van die transactie verwijdert de quote totdat een nieuwe trade of REST-snapshot beschikbaar is. Buiten beursuren kunnen aandelenkoersen daarom terecht als verouderd zichtbaar blijven. Er wordt geen openingsstatus uit alleen kloktijden afgeleid.

Historie vraagt de nieuwste pagina van maximaal 500 ongecorrigeerde bars op, met expliciete feed en tijdsperiode. Meer historie laden en split/dividendcorrecties zijn nog niet ingebouwd. Alpaca-cryptobars kunnen ook quote-midprijzen bevatten volgens de provider. Bij feedwissel worden oude koersen/caches ongeldig gemaakt; tekeningen blijven bewaard. Authenticatie-, rechten- en verbindingsfouten worden gemeld zonder sleutelgegevens. De adapter is met contractfixtures getest; echte ontvangst via jouw Alpaca-account moet na het invullen van de sleutels worden gecontroleerd.

Bronnen: [Alpaca Market Data FAQ](https://docs.alpaca.markets/us/docs/market-data-faq), [WebSocket-protocol](https://docs.alpaca.markets/us/docs/streaming-market-data), [stock bars](https://docs.alpaca.markets/us/reference/stockbars), [crypto-stream](https://docs.alpaca.markets/us/docs/real-time-crypto-pricing-data).

## Stack en grenzen

React 19.3, TypeScript, Vite 8.3, TradingView Lightweight Charts 5.2, Fastify 5.12 en Node.js 24 LTS, met vastgelegde npm-lockfile en Docker-multistage build. SQLite bewaart uitsluitend configuratie; begrensde caches verwerken recente marktdata in geheugen. Hiermee is de eerste lokale versie eenvoudig te onderhouden. Het is nog geen tickarchief of bewezen infrastructuur voor miljoenen instrumenten. Maximaal 20 watchlists, 50 instrumenten per lijst, 20 broninstanties en 200 eigen instrumenten; actieve REST-rondes zijn begrensd op 100 instrumenten.

Marktoverzicht voegt brongebonden fundamentals, nieuws en Bitcoin-sentiment toe, met expliciete dekking en ontbrekende-data-status. Orderuitvoering, alerts en langlopende dataopslag zijn nog niet ingebouwd. De grafiek gebruikt de open-source Lightweight Charts-library van TradingView; het volledige TradingView-platform en alle tekentools zijn niet inbegrepen.

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

De Vite-terminalontwikkelinterface draait op 4311; de lokale Node-API op 4310. Firm gebruikt in Docker ook 4311. Stop Firm of kies een andere Vite-poort bij terminalontwikkeling. Stop eerst de Docker-app als je de lokale Node-server op dezelfde poort wilt gebruiken. Lokale devdata staat in `data/`, buiten Git en buiten iCloud.

Lees [de architectuur](docs/ARCHITECTURE.md) voor het providercontract en [de ontwerpspecificatie](docs/DESIGN.md) voor de visuele basis.

## Primaire documentatie

- De live crypto-integraties volgen [Kraken ticker v2](https://docs.kraken.com/exchange/api-reference/spot-websocket-v2/ticker) en [Coinbase Exchange WebSocket](https://docs.cdp.coinbase.com/exchange/websocket-feed/channels).
- Historie volgt [Kraken OHLC](https://docs.kraken.com/api-reference/market-data/get-ohlc-data) en [Coinbase candles](https://docs.cdp.coinbase.com/api-reference/exchange-api/rest-api/products/get-product-candles).
- Multi-asset toegang en abonnementen: [Twelve Data API](https://twelvedata.com/docs).
- Charts en vereiste attribution: [TradingView Lightweight Charts](https://tradingview.github.io/lightweight-charts/). Charting library © TradingView, Inc.; Apache 2.0. De TradingView-link en het attributionlogo blijven zichtbaar.

## Tekenen op de grafiek

Kies een tool in de tekenbalk onder de koersgegevens. Een horizontaal niveau plaats je met één klik; een trendlijn, rechthoek of Fibonacci-retracement met een begin- en eindpunt. Met **Esc** annuleer je. Tekeningen staan uitsluitend in het prijsvak, niet in het RSI-vak.

Klik op een tekening of kies deze in de lijst. Sleep de tekening om deze te verplaatsen, of sleep de ronde ankerpunten om de vorm aan te passen. De kleurkiezer wijzigt de geselecteerde tekening; zonder selectie kies je hiermee de kleur voor nieuwe tekeningen. Het oog verbergt/toont tekeningen. De prullenbak of **Delete** verwijdert de selectie. **Ongedaan maken** herstelt de laatste 30 tekenbewerkingen van het huidige instrument binnen deze browsersessie; deze herstelgeschiedenis vervalt bij herladen of een instrumentwissel.

Maximaal 100 tekeningen per instrument. Opslag blijft lokaal in het bestaande Docker-volume. Een mislukte opslag wordt zichtbaar gemeld en de betreffende wijziging wordt teruggedraaid. Ankers gebruiken UTC-tijd en prijs, onafhankelijk van de provider en tijdsperiode. Buiten het geladen tijdsbereik worden posities geëxtrapoleerd; wisselen van tijdsperiode verandert de zichtbare uitsnede, dus tekeningen kunnen buiten beeld vallen. De huidige prijsschaal is lineair.

## Instrumentcatalogi doorzoeken

Bij **Instrument toevoegen** zoek je op naam, symbool, beurs, quotevaluta of bron. Filter op databron en markt; blader met Vorige/Volgende door resultaten van 50 instrumenten. De tabel toont per instrument de beurs, valuta en gekoppelde bronnen. Identieke cryptoparen worden samengevoegd; EUR, USD, USDC en USDT blijven afzonderlijk.

De app haalt catalogi op bij OKX (actieve spotparen op de Europese aansluiting), Kraken (online spotparen), Coinbase Exchange (online, niet-uitgeschakelde paren), Twelve Data (aandelen, ETF’s, valuta en grondstoffen met opgegeven quotevaluta) en Alpaca (actieve Amerikaanse aandelen of USD-crypto, passend bij de gekozen feed). Voor Alpaca gebruikt de server uitsluitend GET op `/v2/assets` met de opgeslagen sleutels; bij een 401 op het live-adres probeert hij hetzelfde metadata-endpoint op het paper-adres. Dit haalt geen accounts, orders of posities op. Twelve Data-referentielijsten zijn publiek en krijgen geen API-sleutel meegestuurd. Een catalogusvermelding bewijst geen koersrechten of persoonlijke handelsrechten.

Catalogi worden bij openen/zoeken opgehaald als ze ontbreken of ouder zijn dan 24 uur. **Catalogus vernieuwen** vraagt verversing; aanvragen delen het ingestelde providerbudget en herhaalde pogingen worden minstens een minuut begrensd. Onder **Catalogusstatus per bron** zie je aantallen, ophaaltijd, fouten en gedeeltelijk beschikbare lijsten. Bij storing blijft de laatst ontvangen catalogus zichtbaar met melding. Zonder ontvangen catalogus zijn bestaande startlijsten en eigen instrumenten herkenbaar als onbevestigde bronkoppeling. Commodity-symbolen zonder bekende quotevaluta worden overgeslagen.

De volledige zoekcatalogi worden lokaal in de bestaande SQLite-volume bewaard. Alleen gekozen en eerder opgeslagen instrumenten worden aan de terminalstatus toegevoegd, met een grens van 2000 opgeslagen catalogusinstrumenten. Live streams volgen uitsluitend watchlists en actieve grafieken, binnen de bestaande limieten. Kraken REST-symbolen en WebSocket-symbolen blijven afzonderlijk bewaard. Watchlists en tekeningen behouden hun bestaande IDs.

Primaire documentatie: [Coinbase-productlijst](https://docs.cdp.coinbase.com/api-reference/exchange-api/rest-api/products/get-all-known-trading-pairs), [Kraken AssetPairs](https://docs.kraken.com/api/docs/rest-api/get-tradable-asset-pairs/), [OKX API](https://my.okx.com/docs-v5/en/), [Twelve Data-symbolen](https://support.twelvedata.com/en/articles/5620513-how-to-find-all-available-symbols-at-twelve-data), [Alpaca assets](https://docs.alpaca.markets/us/docs/working-with-assets).

## Marktoverzicht

De tab **Marktoverzicht** staat tussen **Terminal** en **Databronnen**. De instrumentselectie wordt gedeeld met Terminal. Zoek in bestaande instrumenten, kies een instrument of klik op een instrument uit de marktcontext. De pagina bevat zes onderdelen:

- **Key data points:** brongebonden prijs, 24-uurs-/sessiebereik, volume, bid/ask, spread, valuta en bron-/ontvangsttijd. Geen combinatie van verschillende venues.
- **Technicals:** gauge met Strong Sell, Sell, Neutral, Buy en Strong Buy; candleperiodes 1u, 4u, dag en week; uitklapbare tabel met vijf gemiddelden, RSI14, MACD12/26/9 en Stochastic %K14. Afgesloten, niet-gedeeltelijke candles van één historiebron; bij fallback staat die bron vermeld.
- **Sentiment:** Alternative.me Bitcoin Fear & Greed met de laatste zeven metingen, brondatum en directe attribution. Bij altcoins alleen Bitcoin-marktcontext. Andere instrumentklassen krijgen geen ongepaste cryptosentimentscore.
- **Fundamentals:** CoinGecko-tokenomics voor BTC, ETH, SOL, XRP, ADA, DOGE, LINK, AVAX en LTC, gekoppeld met een vaste CoinGecko-ID. SEC EDGAR-jaarcijfers uit 10-K voor US-GAAP-aandelen met een exacte symbool-/beurskoppeling en USD-quote. Verslagperiode en indieningsdatum staan per cijfer. Geen TTM-berekening. ETF’s, valuta, grondstoffen en overige instrumenten krijgen een expliciete melding zolang hun passende bron ontbreekt.
- **Nieuws:** GDELT-naamzoekopdracht met financiële context in de laatste zeven dagen, maximaal acht unieke artikellinks. Resultaten kunnen een instrument slechts zijdelings noemen. Registratietijd bij GDELT is geen bewezen publicatietijd. Bij bronstoring of een limiet wordt openbare Google Nieuws RSS als zichtbare terugval geprobeerd, met de uitgever en de publicatietijd volgens de feed. Ook RSS is een naamzoekopdracht zonder bevestigde instrumentrelevantie of gegarandeerde API-dienst. Als beide bronnen falen staat dat zichtbaar, met een link om verder te zoeken in Google Nieuws.
- **De markt:** globale CoinGecko-cryptomarktcijfers in USD, andere instrumenten van dezelfde klasse in je watchlists en de ontvangen prijzen per venue. Andere klassen gebruiken alleen ontvangen koersen en vermelden dat een macrofeed ontbreekt. Watchlistinstrumenten vormen geen sectorbenchmark.

### Gauge-methodiek

Elke beschikbare indicator telt even zwaar: Sell −1, Neutral 0, Buy +1. Minimaal zes van acht indicatoren zijn vereist. Score ≤ −0,6 = Strong Sell; < −0,15 = Sell; ≤ 0,15 = Neutral; < 0,6 = Buy; anders Strong Buy. Close tegenover SMA20/50/200 en EMA20/50 gebruikt een neutrale marge van ±0,1%. RSI <30/>70 en Stochastic <20/>80 geven Buy/Sell. MACD-histogram boven/onder nul geeft Buy/Sell, met een neutrale marge van ±0,01% van close. Ontbrekende historie geeft geen neutraal signaal. Oude candles, verbindingsverlies en mislukte vernieuwing blijven herkenbaar.

### Aanvullende bronnen

Alle research-aanvragen lopen server-side via vaste openbare HTTPS-endpoints, zonder API-sleutels of betaalde feeds. Alleen een geregistreerd instrument mag worden onderzocht. Elke sectie wordt onafhankelijk opgehaald, met gedeelde in-flight aanvragen, timeouts, begrensde caches en bronbudgetten. CoinGecko (fundamentals/globale markt) en nieuws worden 15 minuten gecachet; sentiment een uur; SEC-cijfers zes uur en het instrumentregister een dag. Vernieuwen respecteert deze caches. Storing bewaart eerdere succesvolle data met een verouderd-label en foutmelding; herhaalde fouten worden een minuut begrensd. Openbare aanbieders kunnen ondanks deze lokale begrenzing toegang weigeren of een gedeelde IP-limiet toepassen.

Primaire documentatie: [CoinGecko coin data](https://docs.coingecko.com/reference/coins-id), [globale marktdata](https://docs.coingecko.com/reference/crypto-global), [CoinGecko-limieten](https://docs.coingecko.com/docs/errors-and-rate-limits), [Alternative.me API en scope](https://alternative.me/crypto/fear-and-greed-index/#api), [SEC EDGAR API](https://www.sec.gov/search-filings/edgar-application-programming-interfaces), [SEC ticker/beursregister](https://www.sec.gov/files/company_tickers_exchange.json), [GDELT DOC API](https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/).

De nieuws-RSS-terugval gebruikt de openbare [Google Nieuws-feed](https://news.google.com/rss/search?q=Bitcoin+crypto+when%3A7d&hl=en-US&gl=US&ceid=US%3Aen). De server verwerkt alleen titel, uitgever, veilige link en feedtijd; geen volledige artikelen of HTML. XML met DTD/entities en te grote feeds wordt geweigerd.


## Firm ontwikkelen en controleren

```sh
rtk proxy npm --prefix apps/web ci
rtk proxy npm --prefix apps/web run check
rtk proxy docker compose build firm-api firm-web
rtk proxy docker compose run --rm --no-deps -e WJP_TEST_DATABASE_URL=postgresql://wjp_api@postgres:5432/wjp_local firm-api python -m pytest -q -p no:cacheprovider apps/api/tests services/trading/tests
rtk proxy python3 ops/wjp.py status
```

De PostgreSQL-service moet draaien vóór de integratietests. Tests gebruiken aparte organisaties. De runtime-role is geen migratiebeheerder. De beheerhulp is alleen-lezen; hij kan geen orders uitvoeren, secrets exporteren of een shell openen. Een productie-Owner-token mag alleen uit een lokaal bestand buiten iCloud komen. Alleen placeholderconfiguratie hoort in Git.

De compose-healthchecks controleren de API-databaseverbinding en Next-proxy. Voor een betaalde provider of deployment eerst de nog open gates in het fase 1-plan afmaken. De frontendproxy gebruikt bij de build `WJP_API_URL` (standaard http://firm-api:8000). De servicebenaming blijft gelijk bij de geplande VPS-images. `WJP_TERMINAL_PUBLIC_URL` bepaalt bij runtime de zichtbare terminal-link.

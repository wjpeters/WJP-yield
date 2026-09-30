# Providerfouten per instrument — 29 september 2026

## Vastgestelde oorzaak

Een handmatig toegevoegd instrument TLD0 / NYSE / USD staat in een watchlist.
Gerichte read-only aanvragen met de bestaande lokale providerconfiguratie gaven:

- Twelve Data `/quote`: HTTP 404, symbool ontbreekt of is ongeldig.
- Alpaca `/v2/stocks/snapshots`: HTTP 400, invalid symbol TLD0.
- Alpaca AAPL `/v2/stocks/bars`, 1Hour: 203 geldige candles.

De daadwerkelijke foutrespons is in het proces geschoond. Sleutels zijn niet gelogd,
niet in bestanden opgeslagen en niet veranderd. TLD0 is niet automatisch vervangen:
het bedoelde instrument is nog niet bevestigd.

## Herstel

- Twelve Data HTTP/JSON 404 krijgt een veilige, instrumentspecifieke foutcategorie.
- Alpaca 400 wordt alleen bij de bekende categorie `invalid symbol` als instrumentfout behandeld.
  Andere 400-fouten blijven aanvraagfouten; 401, 403, 429 en serverfouten behouden hun bronafhandeling.
- Afgewezen instrumenten worden per bron 15 minuten gepauzeerd voor koersen én historie.
  De pauze kost geen nieuwe aanvragen en overleeft een herstart.
- Een instrumentfout verhoogt de storingsscore van de hele bron niet en opent diens circuit breaker niet.
- Bronbeheer en de datakwaliteitstabel tonen het betrokken symbool; bronbeheer toont ook de volgende poging.
- Wijzigen van de bronconfiguratie wist de bijbehorende instrumentpauzes. Een geslaagde poging na afloop wist de melding.
- Historie blijft naar een andere geschikte bron uitwijken.

## Verificatie

- `npm run check`: productiebouw en 39 tests geslaagd.
- Zes nieuwe regressietests: beide providerfoutformaten, geheimhouding, onderscheid tussen foutcategorieën,
  pauze en herstel, herstart, bronwissel, normale polling en verouderde antwoorden na configuratiewijziging.
- Docker opnieuw opgebouwd met behoud van de bestaande datavolume.
- Live controle: beide bronnen hebben status REST, geen algemene fout en geen bronpauze.
  Twelve Data levert AAPL, MSFT en XAU/USD; Alpaca levert AAPL en MSFT.
- TLD0 krijgt bij beide bronnen een gerichte melding. Alpaca's retryAt bleef gelijk over
  meerdere pollcycli, terwijl gezonde koersen bleven vernieuwen.
- Bronbeheer in de browser gecontroleerd: beide waarschuwingen zichtbaar naast gezonde bronstatus;
  geen consolefouten of waarschuwingen.

## Referenties

- https://twelvedata.com/docs — foutcodes en quoteparameters.
- https://docs.alpaca.markets/us/reference/stockbars — parameters en HTTP 400-afhandeling.

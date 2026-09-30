# Fase 1: Strategie-lab en configureerbare OKX-bots

Datum: 30 september 2026. Owner: Willem Peters. Status: concreet bouwplan; de bestaande lokale Firm-basis en botconfiguratie zijn al gebouwd. De execution-worker, echte AI-activering, OKX-demo en VPS-deployment zijn nog niet geleverd.

## Gewenst resultaat

Willem kan in WJP yield een strategie kiezen, configureren, historisch onderzoeken, een bot aanmaken en na validatie server-side paper of OKX-demo draaien. Het sluiten van de browser verandert de botstatus niet. Dezelfde code en Docker-images moeten later op zijn Hostinger-VPS draaien met afzonderlijke production-state. Live handel krijgt een eigen besluit na de paper-, demo-, herstel- en riskproeven.

De autonome onderzoeksfirma blijft boven het Strategie-lab staan. Agents leveren strategievoorstellen en onderzoek. Software valideert en voert uit. Jev ondersteunt gerichte beoordelingen; Jev en Codex hebben geen toegang tot exchange-orderfuncties.

## Gebruikersflow

1. Open Strategie-lab en kies Nieuwe strategie.
2. Kies een toegelaten OKX-spotmarkt, timeframe en template. Begin met EMA trend/crossover en Donchian breakout. Importeer geen willekeurige executable code.
3. Stel indicatorperioden, stopafstand, risk/reward en risico per trade in. Toon de toegelaten waarden en een menselijk leesbare regelbeschrijving.
4. Sla een immutable versie op met hash, doel, auteur en Journal-entry.
5. Kies een brongebonden dataset en kostenprofiel. Voer backtest, chronologische OOS-vensters en robuustheidsproeven uit.
6. Laat de resultaten reproduceren en onafhankelijk beoordelen. Sla bevindingen ook op bij afwijzing.
7. Maak een botconfiguratie: naam, strategieversie, markt, timeframe, allocatie, portfolio, execution-mode en data-account. Een bot begint als DRAFT.
8. Valideer datakwaliteit, promotiegate, beschikbare allocatie, risklimieten, exchange-regels en credentials voor de gekozen omgeving.
9. Start de bot in experimental paper. Starten is een serveractie met een persistent order-intent, geen timer in de browser.
10. Bekijk status, laatste candle, volgende evaluatie, signalen, afwijzingen, posities, kosten en Journal. Pause stopt nieuwe entries; bestaande beschermende exits blijven werken. Stop/flatten zijn aparte expliciete handelingen.

## Afbakening en modes

| Onderdeel | Fase 1 |
|---|---|
| Strategieën | Declaratieve, versiegebonden EMA trend/crossover en Donchian breakout |
| Markt | OKX spot, long-only; geen leverage; exact toegelaten instrumenten uit OKX-register |
| Timeframes | 1h, 4h, 1d; uitsluitend gesloten candles |
| Paper | Experimental en main paper blijven afzonderlijk |
| Shadow | Echte data en virtuele beslissingen; geen exchange-orders |
| OKX demo | Echte adapter tegen de specifieke demo-account, afzonderlijke key en simulated header |
| Live | Uitgeschakeld tot afzonderlijke limited-live gate en Owner-besluit |
| Onderzoek | Acht geregistreerde rollen; eerst CIO, Crypto, Quant en Independent Reviewer actief |
| Jev | TypeSafe System One primair; OpenRouter System One fallback; beoordeling, classificatie, routing |
| Codex | Complex onderzoek; nieuwe betaalde runs vereisen echte provider- en budgetkoppeling |
| VPS | Deploy- en recoveryproef met dezelfde images; geen tweede implementation |

Werkelijke OKX-allocaties en ordergroottes gebruiken de quotevaluta van de markt, bijvoorbeeld USDC of USDT. De huidige UI slaat een virtuele EUR-allocatie op als configuratiedraft. Voor execution wordt dit vervangen door quote-currency allocation of een expliciet geprijsde valutaomrekening. EUR is wel de eenheid van AI-budgetten. Geen impliciete EUR/USDC/USDT-pariteit.

## Architectuur voor 24/7

```text
Browser → Next.js → Owner API / Agent Gateway
                       │
          PostgreSQL: strategieën, bots, taken,
          budgets, intents, posities en Journal
                       │
       ┌───────────────┼─────────────────┐
 Research scheduler  Bot worker    Risk/position worker
       │               │                 │
 Codex / Jev        Gesloten candle       Reconciliation
       │               │                 Native stops
 Research output → Policy → Risk → Execution → OKX adapter
```

PostgreSQL is de gezaghebbende staat. Redis versnelt wakeups en caches, maar kan worden herbouwd. Bot workers draaien als zelfstandige Docker-services met restart-policy, eigen heartbeat, lease en fencing-token. De browser leest voortgang en verstuurt beheeracties. Docker op een slapende of uitgeschakelde Mac levert geen 24/7 beschikbaarheid; de Hostinger-VPS is de uiteindelijke altijd-aan host.

Een lokale scheduler mag nooit production-bots claimen. Environment ID, Organization ID, databases, credentials en worker-ownership blijven gescheiden. Botclaim en leaseverlenging zijn atomair. Een verlopen worker mag geen nieuwe intent committen. Execution controleert fencing opnieuw vlak voor verzending. Eén candle-evaluatie krijgt een deduplicatiesleutel uit environment + bot + strategy hash + candle timestamp + action.

## Botcontract

Bewaar minimaal bot_id, owner, environment, name, market/venue/quote currency, strategy version/hash, mode, allocation, portfolio, immutable config version, status, lease owner/fencing, last closed candle, last action, pending intents, position references, health, created/updated timestamps en Journal-referenties.

Statuses: DRAFT, VALIDATING, READY, RUNNING, PAUSING, PAUSED, STOPPING, STOPPED, BLOCKED, ERROR. Geen RUNNING in de UI wanneer alleen configuratie is opgeslagen. Een configuratiewijziging wordt een nieuwe versie en geldt pas na validatie; open posities behouden hun oorspronkelijke exitplan.

## Trading safety

Voorgestelde startgrenzen uit het huidige onderzoekscontract: maximaal 0,5% risico per trade, 2% dagverlies, 5% weekverlies, 10% drawdown, 30% totale exposure, 15% per asset, 25% gecorreleerde exposure, maximaal drie posities en leverage 1. Deze waarden worden door de Owner vastgelegd als beleid voordat execution wordt geactiveerd. Agents kunnen ze niet verruimen.

De Risk Engine gebruikt server-side portefeuille- en exchange-state, inclusief open en gereserveerde orders. Controleer spread, liquiditeit, slippage, datatijd, exchange-health en reconciliation. Ontbrekende, negatieve of niet-eindige telemetrie blokkeert nieuwe entries. Bereken sizing met orderkosten, lot/tick size, minSz/minNotional en alle exposures. De huidige onderzoeksfunctie is geen volwaardige live order engine.

GLOBAL, EXCHANGE, STRATEGY, BOT en ASSET entry-kill-switches blokkeren nieuwe entries. Beschermende exits hebben een aparte, alleen-risicoverlagende route die positiegrootte en side verifieert. Waar OKX dit ondersteunt, staan beschermende stops bij de exchange. Stopbeheer en reconciliation hebben geen AI-provider nodig.

## OKX-adapter

De huidige publieke datasetadapter gebruikt standaard de EEA-route die de bestaande terminal al gebruikt. Hij verifieert exact spotpaar, state, base- en quotevaluta in het regiogebonden OKX-register en haalt maximaal vier historische pagina’s op. USDC en USDT zijn afzonderlijke instrumenten; geen automatische substitutie. De global publieke regio kan alleen via vertrouwde serverconfig worden gekozen. Dit bevestigt geen toegelaten account-traderechten.


Bevestig eerst de accountregio, bijbehorend API-domain, spotmogelijkheden en instrumentregels via de werkelijke account. Gebruik vaste toegelaten endpoints, gesynchroniseerde tijd, signing binnen de execution-service en aparte development/demo/production-keys. Alleen Read + Trade; geen withdrawal-rechten. Secrets blijven buiten iCloud en buiten agentcontainers.

OKX-demo gebruikt een demo-key en `x-simulated-trading: 1`, volgens de [officiële OKX API-documentatie](https://www.okx.com/docs-v5/en/). Test toestemming en header contractueel; verkeerde mode/key mag geen fallback naar live geven.

Verstuur een order pas na een duurzaam opgeslagen intent. Gebruik een deterministische clOrdId waar ondersteund. Bij timeout of verbroken verbinding: zoek eerst orderstatus/fills op dezelfde id op; verzend geen blinde tweede order. Verwerk acknowledgements, rejects en partial fills idempotent. Maak een stop voor de werkelijk gevulde hoeveelheid, geen geplande hoeveelheid. Na herstart: reconcile balances, open orders, fills en posities voordat nieuwe entries mogelijk zijn. Redis-verlies mag geen order herhalen.

## Jev: TypeSafe primair, OpenRouter fallback

De [TypeSafe API](https://docs.typesafe.ai/api) gebruikt POST `https://api.typesafe.ai/v1/systemone`, bearer-authenticatie en `{model,state,questions}`. Antwoorden bevatten `{model,answers,usage}` voor Choice, Score en Noul. Jev ondersteunt atomische beoordelingen en is geen vrij genererende researchagent.

De [officiële OpenRouter System One-integratie](https://openrouter.ai/docs/guides/community/typesafe-sdk) biedt POST `https://openrouter.ai/api/v1/systemone` met hetzelfde contract. Pin een concrete modelversie na compatibiliteitstest; sla het werkelijk gebruikte model altijd op. Gebruik niet de Jev Router-chatroute als vervanging voor dit besluitcontract.

- Valideer keys, modelbeschikbaarheid en contract bij gecontroleerde activering.
- Reserveer vóór elke poging tokens, requests, runtime en kosten in de echte budgetgateway. Reserveer ook de maximaal mogelijke fallbackkosten. Een lokale Reservation-dataclass is daarvoor geen autorisatiebewijs.
- Pas bounded timeout, circuit breaker en begrensde backoff toe bij transportfouten, 429 en 5xx/529.
- Bij 401/403 of ongeldige request: Owner-configuratieactie; geen stille alternatieve uitgaven.
- Bij schemafout: registreer het incident; desgewenst één gebudgetteerde fallbackpoging volgens vast beleid.
- Lage confidence of ambigue Noul leidt tot review, niet tot opnieuw vragen totdat een gewenst antwoord verschijnt.
- Als beide routes falen: AI-afhankelijke entries wachten. Marktdata, exits, risk checks en reconciliation blijven draaien.
- Journal request-ID, input-hash, brondata, vraagversie, provider, model, antwoord, fallbackreden, tokens en werkelijke kosten. Log nooit keys of verborgen chain-of-thought.

De adapter is al aanwezig en contractueel getest met fake transports. Echte calls zijn niet geactiveerd: de duurzame budgetgateway en veilige secret-mounts moeten eerst worden gekoppeld. TypeSafe en OpenRouter kunnen dezelfde onderliggende TypeSafe-provider gebruiken; deze fallback garandeert geen onafhankelijke model-infrastructuur.

## Bouwvolgorde en oplevering

| Stap | Werk | Klaar wanneer |
|---|---|---|
| 1.1 Foundation | Firm API/web, PG/Redis, Journal, rollen, tasks, budgets, leases | DB-concurrency-, permissions- en ledger-tests slagen; lokaal zichtbaar |
| 1.2 Lab | DSL, registry, dataset provenance, kostenbacktest, bots als draft | Config validatie en versiehash reproduceerbaar; bot is configureerbaar |
| 1.3 Bot worker | Closed-candle strategy evaluation, fencing, intents, paper fills | Browser dicht en workerherstart veroorzaken geen dubbele entry |
| 1.4 Risk & position manager | Portfolio limits/reservations, killswitches, exits, partial fills | Alle failure tests blokkeren entries terwijl exits doorgaan |
| 1.5 Research gates | Experiment registry, reproduceerbare onafhankelijke review, paperstatistieken | Geen menselijke handmatige klik wordt als agentreview gepresenteerd |
| 1.6 Jev gateway | Beide providers, secrets, duurzame budgets, accounting | Gecontroleerde contractproef en outage/fallbackproef; geen ongeautoriseerde spend |
| 1.7 OKX demo | Signing, private streams, reconciliation, native stopbeheer | Demo-only order, partial fill en ambiguous timeout reproduceerbaar |
| 1.8 Hostinger-proef | Owner-auth, TLS/private gateway, production-state, backups, rollback | Persistent bot werkt bij gesloten browser en serviceherstart; restore getest |

Stappen 1.1 en de configuratiebasis van 1.2 zijn deze uitvoering. 1.3–1.8 staan open. Geen geschatte kalenderdeadline zonder capaciteit- en VPS-gegevens. Er wordt niet alvast een tweede project aangemaakt.

## Acceptatieproeven

1. Strategie en bot aanmaken, pagina herladen; versie en config blijven exact bewaard.
2. Twee workers claimen dezelfde bot/candle; slechts één intent wordt vastgelegd.
3. Browser/tab sluiten; workerheartbeat, data en paperafhandeling blijven minstens een uur doorgaan.
4. Worker beëindigen na intent, vóór ACK, en na partial fill; herstel creëert geen dubbele order.
5. Database/reconciliation/data verslechtert; entries worden geblokkeerd met een concrete Journal-reden.
6. GLOBAL/BOT/ASSET kill activeren met open positie; geen nieuwe entry, beschermende exit blijft mogelijk.
7. Beide Jev-routes simuleren als down; geen entry die AI nodig heeft, deterministisch stopbeheer blijft werken.
8. Primary 529 simuleren; precies één toegelaten fallback met dezelfde vragen, eigen providerprovenance en kosten.
9. Historisch resultaat bevat alle kosten en drie niet-overlappende OOS-vensters; failed variants blijven bestaan.
10. Local code kan geen production-state, secrets of botlease gebruiken.
11. Journal-hashketen verifiëren; directe UPDATE/DELETE als runtime-role wordt afgewezen.
12. VPS reboot, databasebackup-restoration en vorige image terugzetten; intent/reconciliation herstelt vóór entries.
13. Alleen demo-key + simulated header plaatsen een OKX-demoorder. Live heeft een aparte harde disabled gate.

## Nog benodigde input voor externe activering

Voor Jev: veilige TypeSafe- en OpenRouter-keys, bevestigd accountbudget en modelcompatibiliteit. Voor OKX-demo: demo-account/key en accountregio. Voor Hostinger: VPS-host/OS/resources, gewenste domeinnaam of private toegang, veilige beheerroute en backuplocatie. Geen van deze secrets hoort in de chat of WPOS. Deze gegevens blokkeren het lokale plan en de bouw van de deterministic worker niet.

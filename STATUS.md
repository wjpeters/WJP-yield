# WJP Yield: opleverstatus

Datum: 30 september 2026. Scope: lokale Firm-basis, Strategie-lab-configuratie en een concreet fase 1-plan voor 24/7 OKX-bots. De volledige masterwens is niet als voltooid gemarkeerd.

## Nu bruikbaar

- Firm op http://localhost:4311; de bestaande Terminal op http://localhost:4310; Owner API op loopback 4312.
- Acht vaste rollen; CIO, Crypto, Quant en Independent Reviewer ingeschakeld. Echte researchproviders zijn disabled; geplande taken wachten zichtbaar op configuratie.
- PostgreSQL-state, geïsoleerde runtime-role, migrator, Redis-cache, fenced schedulerleases, taskclaims/deduplicatie, begrensde specialisttemplates en transactionele budgetreserveringen.
- Append-only Journal met actorherkomst, hashketen en databasebescherming tegen wijzigen/verwijderen. Owner-input wordt niet als AI-output of onafhankelijke agentreview gepresenteerd.
- Immutable strategieversies met EMA/Donchian-template, configureerbare perioden, stop/risk/reward, geselecteerde OKX-spotparen en timeframes 1h/4h/1d.
- Publieke OKX EEA-datasets met exact instrumentregister, gesloten candles, quotevaluta, venue-regels, bron/tijdsbereik en hash.
- Historische simulatie met kosten, next-candle uitvoering, lot/tick/minimumregels, volumegrenzen, stops en drie chronologische OOS-vensters. Kostenstress, beperkte stopsensitiviteit en deterministische Monte Carlo zijn onderzoekschecks. Regimes zijn expliciet nog niet gevalideerd.
- Persistente botconfiguraties als DRAFT, paper/shadow-keuze, virtuele EUR-allocatie en pauzeren. Geen bot-start/orderendpoint.
- Jev-adapter voor TypeSafe System One primair en OpenRouter System One fallback, gevalideerd met fake transports; geen betaalde echte calls.
- Alleen-lezen Ops-hulp en bijgewerkte gelijke AGENTS.md/CLAUDE.md.

## Plan en bouwgrens

[Fase 1](docs/PHASE-1-STRATEGY-LAB.md) specificeert de gebruikersflow, serverworkers, idempotente order-intents, risk/positionbeheer, veilige Jev-budgetgateway, OKX-demo en Hostinger-proef. De foundation en configuratiebasis zijn geleverd. De overige stappen zijn uitvoerbaar vervolgwerk, geen draaiende handelsfunctionaliteit.

Nog open: daadwerkelijke paper/shadow-executionworker; portefeuille/sizing/reservations; beschermende exits/reconciliation; kill-switchbeheer; volledige researchketen en onafhankelijke reproduceerbare agentreview; grotere historische archivering en regimevalidatie; duurzame betaalde provider-accounting met deadlines/cancellation; private OKX demo/live-adapter; production-auth/secrets/state/backups/restore/rollback/monitoring; VPS-proef en limited-live-besluit. De virtuele EUR-botallocatie moet voor execution expliciet naar de echte quotevaluta worden vervangen of geprijsd omgerekend.

## Dekking van de 17 masterfasen

| Masterfase | Bewijs en resterend werk |
|---|---|
| 1 Core | Lokale Next/FastAPI/PG/Redis/Docker en healthchecks; productieconfig open |
| 2 Journal | Append-only hashledger en provenance; provider/orderprovenance wacht op echte adapters |
| 3 Organization | Registry/chart/rollen/templates/permissions/delegatielimieten aanwezig |
| 4 Tasks | Goals, parent/child, claims, reviewers, deduplicatie; volledig project/dependencybeheer uitbreiden |
| 5 Scheduler | Browseronafhankelijke routines/leases/concurrency/recovery; externe providerdeadlines open |
| 6 Budgets | Transactionele multidimensionale ceilings/reserve/settle; echte providerkostenkoppeling open |
| 7 Data | Bestaande terminalfeeds en vaste OKX-spotdatasets; orderbook/funding/OI-archief en scanner open |
| 8 Lab | Declaratieve templates, immutable versies, datasets/backtestexperimenten; agentvoorstellen open |
| 9 Backtester | Kosten en OOS-onderzoeksbasis; uitgebreidere fill/latency/regimevalidatie open |
| 10 Agents | Vier rollen enabled; echte Codex/Jev-research-executors unavailable |
| 11 Specialists | Templates, caps, parentrechten en gedeeld budget; echte agent-run open |
| 12 UI | Firm/chart/tasks/journal/budget/reviews/routines/lab/bots/backtests lokaal bruikbaar |
| 13 Paper | Botdrafts en entry-riskonderzoek; execution/positions/exitworker open |
| 14 Routines | Hourly/daily/weekly taken gepland; inhoudelijke provideruitvoering/evaluatie open |
| 15 VPS | Architectuur en acceptatieplan; geen VPS-deployment uitgevoerd |
| 16 Shadow | Configureerbare draft-mode; realtime uitvoering open |
| 17 Limited Live | Hard disabled; afhankelijk van bewezen paper/demo/risk/recovery en Owner-besluit |

## Verificatie

- Bestaande terminal: 80 tests, typecheck en productiebuild geslaagd.
- Firm-web: typecheck en Next-productiebuild geslaagd.
- Backend en trading: 135 tests geslaagd, inclusief 45 controles tegen echte PostgreSQL met afzonderlijke testorganisaties. Eén dependency-deprecationmelding bij Starlette/httpx; geen mislukte of overgeslagen checks.
- Onafhankelijke backendreview: [REVIEW.md](REVIEW.md). Goedkeuring voor lokale onderzoeksbasis en botdrafts; betaalde AI, execution en VPS blijven open.
- Browserproef: BTC/USDC EMA-strategie en paperbotdraft aangemaakt; 1.000 echte gesloten OKX-candles vastgelegd; kostenbacktest voltooid en Journal-hashketen geldig. Het negatieve onderzoeksresultaat blijft bewaard en is geen handelsadvies.
- Lokale services gezond; CLI-health/status succesvol. Geen OKX-orders, echte Jev/Codex-calls, nieuw abonnement, productionkeys of VPS-writes.

De expliciet synthetische acceptance fixture test alleen de taak/event/specialist/rapport/validatieketen. De volledige BTC-funding-scanner → echte delegatie → synthese → backtest → onafhankelijke review → paperpromotie uit sectie 98 is nog niet bewezen. Handmatige Owner-review kan die gate niet omzeilen.

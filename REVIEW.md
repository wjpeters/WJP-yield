# Onafhankelijke backendreview: lokale onderzoeksbasis

Datum: 30 september 2026. Reviewer: development QA/Security-agent `/root/independent_qa`. De reviewer heeft de beoordeelde backendimplementatie niet geschreven. De ontwikkellead heeft de gevonden implementatiefouten hersteld; de reviewer heeft de regressies en de uiteindelijke bron onafhankelijk beoordeeld.

## Besluit en scope

**Goedgekeurd voor de lokale onderzoeksbasis en opgeslagen botconfiguratie.** Echte betaalde AI-runs, automatisch paper/OKX handelen en VPS-productie zijn nog niet vrijgegeven.

Volledig geïnspecteerd: `services/firm/organization.py`, `scheduler.py`, `store.py`, `schema.sql`, `migrate.py`, `policy.py`, `config.py`, `providers.py`, `apps/api/main.py`, de API-container en de lokale Compose-stategrenzen. Aanvullend zijn create/review/promote/bot-routes in `services/trading/api.py` beoordeeld en is de vaste publieke endpointgrens van `market_data.py` gecontroleerd. De volledige trading-domein-, Jev- en frontendimplementaties hebben hun eigen ontwikkel- en reviewroute.

## Bewijs

45 backendchecks slagen tegen de echte lokale PostgreSQL-service met `WJP_TEST_DATABASE_URL=postgresql://wjp_api@postgres:5432/wjp_local`: 16 bestaande tests en 29 onafhankelijke regressies in `apps/api/tests/test_review_regressions.py`. Alle integratiechecks gebruikten unieke test-organisaties; geen PostgreSQL-check werd overgeslagen. De laatste uitgebreide regressies zijn vanuit de werkelijke actuele testbron in een tijdelijke testmodule in de actieve API-container uitgevoerd.

Bevestigd:

- Runtime-identiteit `wjp_api` heeft geen superuser-, BYPASSRLS-, create-role- of create-database-rechten. De API-runtime ontvangt geen migration-admin-URL.
- Directe SQL onder de verkeerde organizationscope kan andere entities en Journal-entries niet lezen of wijzigen. INSERT buiten de scope wordt afgewezen.
- Atomic checkout en taakdeduplicatie blijven correct bij gelijktijdige verzoeken. Gelijktijdig spawnen overschrijdt de specialist-cap niet; children behouden maximaal hun parentrechten.
- Budgetreserveringen zijn transactioneel en worden doorgegeven aan parenttaak en afdeling. Ongeldige executorusage schrijft geen onderzoek weg. Een onderbroken run wordt conservatief op de gereserveerde bovengrens afgerekend.
- Een oude worker kan na lease-overname geen rapport publiceren of budget dubbel afrekenen. De verlopen taak blijft geblokkeerd en wordt niet automatisch herhaald.
- De Journal-hashketen blijft geldig bij gelijktijdige append-acties. De appendfunctie overschrijft vervalste environment/organization/tijd/id-metagegevens met de echte scope en servergegevens. Rechtstreekse ledger-mutatie wordt afgewezen.
- Strategieversies, datasets, backtests, strategie-reviews en onderzoeksrapporten zijn immutable als runtimegebruiker.
- Owner-reviews blijven menselijke reviews. Ook perfecte gestagede onderzoeksstatistieken plus een goedkeurende Owner-review geven geen VALIDATED/paper/shadow/live-promotie vrij. Een aangeleverde valse independent-reviewflag wordt afgewezen.
- Botconfiguratie wordt persistent DRAFT met `execution_ready=false`. De API accepteert geen live-mode, geen aangeleverde RUNNING-status en heeft geen bot-start/orderendpoint.

## Herstelde bevindingen

1. Een gepauzeerde agent kreeg na lopende runvoltooiing ten onrechte status IDLE. De PAUSED-status blijft nu behouden, ook bij herstel en runfouten.
2. De synthetische fixture schreef een fictieve Independent Reviewer als handelende agent. Validatie heeft nu actor `software:fixture-validator`, type system, kind fixture_validation en `independent_agent_review=false`; de toegewezen reviewer blijft een referentie.
3. Handmatig ingediend onderzoek werd aan de toegewezen agent toegeschreven. De werkelijke actor is nu Owner; het rapport bewaart de toegewezen agent apart en claimt geen AI-run.
4. Negatieve, gebroken, booleaanse en niet-eindige resourceceilings konden bij startup passeren. Configuratie verlangt nu positieve gehele limieten en een positieve eindige EUR-bovengrens.
5. Backtestresultaten en pause/reject-promoties gebruikten verschillende locks bij het bijwerken van strategy_state. Beide routes nemen nu dezelfde strategielock, zodat een gelijktijdig Owner-besluit niet met een verouderde state wordt overschreven. De uiteindelijke lockgrens is in de bron gecontroleerd.

## Activeringsgrenzen

- De acceptance fixture bewijst de synthetische event/taak/specialist/rapport/validatieketen. De volledige keten uit bronsectie 98, met echte scanner, AI-delegatie, Risk Officer, synthese, onafhankelijke AI-review en paperpromotie, blijft vervolgwerk.
- Codex, TypeSafe/Jev en OpenRouter research-executors zijn unavailable. Fencing voorkomt oude duurzame writes; een ThreadPool kan een echte externe provider-call niet geforceerd annuleren. Echte activering verlangt eerst een bounded gateway, cancellation/deadline-handhaving, veilige secrets en duurzame spend/reservation-accounting.
- De lokale Compose-database gebruikt trust-auth binnen het interne Docker-netwerk. Deze opstelling heeft geen VPS-goedkeuring. Productie verlangt eigen database/state, echte credential-authenticatie, TLS/private toegang, least-privilege routing, veilige secrets, backup/restore en gecontroleerde deployment.
- De researchscheduler werkt los van de browser. De 24/7 bot/execution-worker, private OKX-adapter, reconciliation, order-intents en beschermende exits zijn afzonderlijk vervolgwerk. Een opgeslagen botconfiguratie vormt geen bewijs dat een bot handelt.

Er zijn na herstel geen open blockers voor de hierboven afgebakende lokale onderzoeksbasis. De activeringsgrenzen blijven voorwaarden voor de volgende bouwstappen.

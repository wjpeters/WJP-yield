# WJP Yield Firm: lokale platformbasis

30 september 2026. Zelfstandige codebase zonder Paperclip-runtime en zonder hergebruik van eerdere tradingprojecten.

## Modulegrenzen

- Bestaande `src/` en `server/`: read-only marktterminal en bestaande provideradapters; eigen SQLite-config blijft behouden.
- `apps/web/`: Next.js Firm, Organization, Agents, Tasks, Research, Journal, Budgets, Reviews, Routines en Strategie-lab.
- `apps/api/`: FastAPI Owner gateway; alleen lokale loopback in compose. Production-authenticatie is fail-closed maar volledige sessie/TLS-deployment is nog niet geleverd.
- `services/firm/`: scoped PostgreSQL state, ledger, rollen/templates, goals/tasks, lineage-budgets, scheduler leases/fencing, run-state en expliciet synthetische acceptance fixture.
- `services/trading/`: declaratieve strategieën, brongebonden datasets, historische simulatie, OOS/cost stress, entry-riskfunctie, promotiechecks, botconfiguratie en geïsoleerde Jev-adapter.
- `ops/`: gecontroleerde read-only CLI.

Een worker kan geen agentpermissies vergroten. Tijdelijke rollen krijgen intersection(parent,template,environment), delen parentbudget, hebben depth/cap-limieten en worden geregistreerd. Production-shell, Docker socket en exchange credentials worden nergens naar agents gemount.

## Databasegrenzen

De lokale PG-database heet wjp_local. Het runtime-account wjp_api heeft geen superuser-, create-role- of create-database-rechten. Alleen een eenmalige migrator ontvangt de admin-DSN. Ledger writes lopen via een appendfunctie; UPDATE/DELETE/TRUNCATE zijn geblokkeerd en hash chaining is verifieerbaar. Artifactkinds strategie/dataset/backtest/review zijn immutable. RLS scopeert state op environment en organization.

Lokale trust-authenticatie geldt alleen binnen het niet-gepubliceerde internal Docker-netwerk. Dit composebestand is uitsluitend lokaal. Voor VPS zijn afzonderlijke databasevolumes, echte credential-authenticatie, TLS, sessionauth, least-privilege routing en secrets vereist. Production krijgt nooit het local-volume of een Docker-socket voor agents.

Redis is optionele heartbeat-cache. PG is gezaghebbend voor deduplication, locks, budget reservation en fencing. Als Redis wegvalt mag correctness niet veranderen.

## Activering en waarheid in de UI

WJP_PROVIDER=disabled is de default. Taken blijven wachten op configuration; er wordt geen echte Codex- of Jev-run voorgespiegeld. De acceptance fixture draait synchronous, synthetic=true en ai_output=false. Dat is een organisatieproef, geen marktadvies of performancebewijs. Acht rollen staan geregistreerd; vier zijn initieel enabled.

De scheduler draait zonder browser. Dat bewijst alleen het onderzoekswerkritme. De trading worker en OKX-orderadapter ontbreken nog, dus opgeslagen bots zijn DRAFT/PAUSED en execution_ready=false. Een manual Owner-review is geen onafhankelijke agentreview. Promotie naar actieve paper/shadow/live blijft daardoor gesloten totdat echte reviews en execution zijn geïntegreerd.

Zie [fase 1](PHASE-1-STRATEGY-LAB.md) en [status](../STATUS.md) voor concrete oplevering en open werk. De oorspronkelijke 101-puntenopdracht is onveranderd bewaard in [bron](AUTONOMOUS-FIRM-SPEC-2026-09-30.md).

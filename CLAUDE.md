# WJP Yield

Zelfstandig project. Hergebruik geen code of ontwerpen uit eerdere tradingprojecten.
Opslag uitsluitend lokaal, expliciet bevestigd 2026-09-29. Geen iCloud.
Lees docs/AUTONOMOUS-FIRM-SPEC-2026-09-30.md, docs/PHASE-1-STRATEGY-LAB.md en STATUS.md.

WJP Yield bestaat uit een multi-agent onderzoeksorganisatie en een deterministische Trading Control Plane. Owner/Board is de mens. Gebruik gespecialiseerde development-subagents; maximaal twee gelijktijdige ontwikkelruns. Belangrijke taken hebben een eigenaar, doel, budget, verwacht resultaat en een andere reviewer. Laat gevoelige risk/permission/execution/secret/deploymentcode onafhankelijk beoordelen.

- Agents plaatsen nooit directe exchange-orders en krijgen geen productie-shell, Docker socket of exchange-secrets.
- Children krijgen nooit meer rechten dan hun parent; templates, delegation-depth en tijdelijke caps zijn beschermd.
- Taken, kosten en besluiten zijn toewijsbaar en worden in hetzelfde transactionele Journal vastgelegd.
- Bewaar failed hypotheses/experiments. Strategieversies, datasets, backtests en reviews zijn immutable. Corrections worden nieuwe entries.
- Onderscheid feiten, hypothesen, tegenbewijs, conclusies en onzekerheden; registreer bronnen, model/prompt/inputs en werkelijke kosten. Geen verborgen chain-of-thought.
- Agent- en providerbudgetten zijn hard. Een client-side of in-memory Reservation is geen duurzaam autorisatiebewijs.
- Researchagents wijzigen geen code, productiepermissions, secrets, betaalde abonnementen, globale risklimieten of promotiebeleid. Zij mogen voorstellen maken; Owner bepaalt.
- Strategy/TradeCandidate → Policy → deterministic Risk → Execution → Exchange. Iedere entry fail-closed bij ontbrekende of ongeldige data.
- Entry-killswitches blokkeren geen noodzakelijke risicoverlagende exits. Reconcile vóór nieuwe entries na herstel.
- Geen fictieve live data, AI-runs, winstkansen of RUNNING bots. Mockfixtures blijven expliciet gemarkeerd.
- Production heeft eigen database/state/secrets en gecontroleerde deployment. Live is standaard uit. De browser voert geen botloop uit.
- Jev: TypeSafe System One primair, compatible OpenRouter System One fallback. Geen chat-route als vervanging. Keys uitsluitend server-side in lokaal storage/keychain of beveiligde secret-mounts buiten iCloud.
- Behoud bron, venue, quotevaluta, provider-tijd, ontvangsttijd en transport in marktdata. Nieuwe protocols via adapters.

Controleer wijzigingen met root npm run check, apps/web npm run check/build en de PostgreSQL API-tests. Verifieer lokale Docker/browser-flow. Shell altijd rtk; rtk proxy voor ongefilterde commands. Zie docs/FIRM-ARCHITECTURE.md voor grenzen; STATUS.md is de opleveringswaarheid.

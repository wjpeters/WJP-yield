# WJP Yield
## Autonomous Strategy Lab & Agent Trading Firm

## 1. Visie

WJP Yield moet worden gebouwd als een zelfstandig werkende, AI-ondersteunde tradingorganisatie.

Niet één AI-agent die alles probeert te doen, maar een organisatie van gespecialiseerde agents die samenwerken zoals medewerkers binnen een professionele tradingfirma.

De gebruiker is uiteindelijk:

**Owner / Board**

Daaronder werkt een virtuele tradingorganisatie met onder andere:

- CIO / Firm Manager
- Market Intelligence
- US Equities Analyst
- Crypto Analyst
- Quant Researcher
- Portfolio Manager
- Risk Officer
- Independent Reviewer

Iedere vaste rol kan tijdelijke specialist-agents inzetten voor deelonderzoek.

De structuur moet lijken op:

```text
                         OWNER / BOARD
                              │
                    ┌─────────┴─────────┐
                    │                   │
               CIO / FIRM        INDEPENDENT
                 MANAGER           REVIEWER
                    │
      ┌─────────────┼───────────────────┐
      │             │                   │
 Market Intel   Asset Research      Quant Research
      │             │                   │
      │       ┌─────┴─────┐             │
      │       │           │             │
      │   US Equities   Crypto          │
      │                                   │
      └──────────────┬────────────────────┘
                     │
              Portfolio Manager
                     │
                Risk Officer
                     │
                     ▼
              Strategy Proposal
                     │
             FIXED SOFTWARE RULES
                     │
                Risk Engine
                     │
              Execution Engine
                     │
                  Exchange
```

Belangrijk:

**Agents besturen de onderzoeksorganisatie.**

**Software bestuurt de veiligheidsgrenzen.**

Zelfs wanneer CIO, Portfolio Manager, Quant Researcher en Risk Officer allemaal dezelfde trade willen uitvoeren, blijven vaste softwarematige risicoregels leidend.

---

# 2. Paperclip-principes zonder Paperclip-afhankelijkheid

Gebruik ideeën uit de Paperclip-architectuur als inspiratie:

- organizational hierarchy;
- reporting lines;
- responsibilities;
- goals;
- tasks;
- task ownership;
- atomic task checkout;
- persistent agent state;
- scheduled heartbeats;
- event-driven wakeups;
- budgets;
- cost accounting;
- delegation;
- approval workflows;
- review gates;
- permissions;
- audit trails;
- immutable activity history;
- rollback;
- agent evaluation.

Bouw deze functionaliteit echter als eigen WJP Yield-componenten.

WJP Yield mag geen Paperclip-runtime nodig hebben.

Conceptueel:

```text
Paperclip concept             WJP Yield implementation

Org Chart                  →  Trading Organization
Tasks                      →  Research Task System
Heartbeats                 →  Agent Scheduler
Budgets                    →  Agent Budget Engine
Governance                 →  Agent Policy Engine
Activity Log               →  WJP Journal
Agent Runtime              →  Codex Run Executor
Workspaces                 →  Agent Workspaces
Approvals                  →  Promotion Gates
Goals                      →  Investment / Research Goals
```

---

# 3. Twee gescheiden werelden

Maak een harde architecturale scheiding tussen:

## A. Agent Organization

Hier werken Codex en andere AI-systemen.

Zij:

- onderzoeken;
- analyseren;
- discussiëren;
- ontwerpen;
- testen;
- bekritiseren;
- rapporteren;
- optimaliseren.

## B. Trading Control Plane

Dit is deterministic software.

Deze laag:

- valideert;
- berekent risk;
- bepaalt position sizing;
- handhaaft exposure;
- bewaakt drawdown;
- verstuurt orders;
- beheert posities;
- voert stops uit;
- reconciliëert met exchanges.

Architectuur:

```text
AGENT ORGANIZATION
────────────────────────────

CIO
Market Intelligence
Crypto Analyst
US Equities Analyst
Quant Researcher
Portfolio Manager
Risk Officer
Independent Reviewer

          │
          ▼

StrategyProposal
ResearchReport
TradeCandidate
PromotionRequest

          │
          ▼

TRADING CONTROL PLANE
────────────────────────────

Policy Engine
Strategy Registry
Risk Engine
Portfolio Limits
Execution Engine
Position Manager
Exchange Adapter

          │
          ▼

OKX / andere broker
```

Nooit:

```text
Codex Agent → OKX order
```

Altijd:

```text
Codex Agent
    ↓
TradeCandidate
    ↓
Policy Engine
    ↓
Risk Engine
    ↓
Execution Engine
    ↓
Exchange
```

---

# 4. Eén WJP Yield codebase

WJP Yield moet met exact dezelfde codebase draaien:

```text
LOCAL
Mac
Docker
Paper / Backtest / Research

en

PRODUCTION
VPS
Docker
Research / Paper / Shadow / Live
```

Configuratie bepaalt de omgeving.

Bijvoorbeeld:

```text
WJP_ENV=local
WJP_TRADING_MODE=paper
```

tegenover:

```text
WJP_ENV=production
WJP_TRADING_MODE=live
```

Maak geen aparte lokale en VPS-versies.

---

# 5. Gescheiden lokale en production state

Gebruik wel afzonderlijke databases.

```text
LOCAL POSTGRES
≠
PRODUCTION POSTGRES
```

Dit voorkomt dat lokale experimenten production-bots beïnvloeden.

Strategieën kunnen gecontroleerd worden gepromoveerd:

```text
Local Research
     ↓
Strategy Bundle
     ↓
version + hash
     ↓
Production Registry
```

---

# 6. Voorkom dubbele uitvoering

Omdat WJP Yield lokaal én op de VPS kan draaien, mogen niet per ongeluk twee production schedulers dezelfde werkzaamheden starten.

Implementeer daarom:

```text
Environment ID
Organization ID
Scheduler ownership
Distributed lock
Idempotency keys
```

Production routines worden uitsluitend uitgevoerd door de actieve VPS scheduler.

Lokaal:

```text
environment = local
execution = paper
```

VPS:

```text
environment = production
execution = production
```

---

# 7. De WJP Yield Trading Organization

Start met acht vaste functies.

| Rol | Hoofdverantwoordelijkheid |
|---|---|
| CIO / Firm Manager | Organisatie leiden, prioriteiten bepalen en werk verdelen |
| Market Intelligence | Nieuws, macro-events en bronnen onderzoeken |
| US Equities Analyst | Aandelen, ETF's, sectoren en bedrijven |
| Crypto Analyst | Spot, perpetuals, funding, OI en crypto-events |
| Quant Researcher | Hypothesen, strategieën en experimenten |
| Portfolio Manager | Strategieën combineren en portfolio-impact bewaken |
| Risk Officer | Risico's en afwijkingen onderzoeken |
| Independent Reviewer | Onafhankelijk resultaten reproduceren en bekritiseren |

De gebruiker staat erboven als:

```text
OWNER / BOARD
```

---

# 8. Team of agents for every role

Een functie hoeft niet gelijk te staan aan één AI-agent.

Iedere functie bestaat uit:

```text
Department
│
├── Lead Agent
│
└── Temporary Specialist Agents
```

Bijvoorbeeld:

```text
Crypto Department
│
├── Crypto Analyst Lead
│
├── Derivatives Specialist
├── Funding/OI Specialist
├── Liquidity Specialist
└── Event Investigator
```

Niet alle specialisten draaien permanent.

De lead-agent maakt ze alleen aan wanneer daar aanleiding voor is.

---

# 9. CIO-team

De CIO / Firm Manager kan specialisten inzetten zoals:

```text
Planning Specialist
Research Coordinator
Budget Controller
Daily Reporting Specialist
```

Taken:

- onderzoeksprioriteiten bepalen;
- conflicterende onderzoeken voorkomen;
- agents werk geven;
- resultaten verzamelen;
- open vragen bepalen;
- budget verdelen;
- escalaties behandelen;
- dagelijks rapport maken.

De CIO handelt zelf niet.

---

# 10. Market Intelligence-team

Lead:

```text
Market Intelligence Lead
```

Mogelijke tijdelijke specialisten:

```text
Macro Event Analyst
Breaking News Investigator
Source Verification Agent
Event-to-Market Mapper
Central Bank Analyst
Geopolitical Research Agent
```

Output moet altijd onderscheiden:

```text
FACTS
HYPOTHESES
COUNTEREVIDENCE
CONCLUSION
```

---

# 11. US Equities-team

Lead:

```text
US Equities Analyst
```

Specialisten kunnen zijn:

```text
Company Fundamentals Analyst
Earnings Analyst
Sector Analyst
ETF Flow Analyst
Corporate Event Analyst
Valuation Analyst
```

---

# 12. Crypto-team

Lead:

```text
Crypto Analyst
```

Specialisten:

```text
Spot Market Analyst
Perpetuals Analyst
Funding Analyst
Open Interest Analyst
Liquidation Analyst
Liquidity Analyst
On-chain Researcher
Crypto Event Analyst
```

Niet iedere specialist hoeft bij iedere analyse gestart te worden.

---

# 13. Quant-team

Lead:

```text
Quant Researcher
```

Specialisten:

```text
Hypothesis Designer
Strategy Designer
Backtest Specialist
Walk-forward Analyst
Monte Carlo Analyst
Parameter Robustness Analyst
Market Regime Analyst
Execution Cost Analyst
```

Dit wordt een van de belangrijkste teams van het Strategy Lab.

---

# 14. Portfolio-team

Lead:

```text
Portfolio Manager
```

Specialisten:

```text
Exposure Analyst
Correlation Analyst
Allocation Analyst
Strategy Overlap Analyst
Portfolio Simulation Analyst
```

De Portfolio Manager kijkt niet alleen:

> Is Strategy X goed?

maar vooral:

> Wat voegt Strategy X toe aan het bestaande portfolio?

---

# 15. Risk-team

Lead:

```text
Risk Officer
```

Specialisten:

```text
Scenario Analyst
Drawdown Investigator
Liquidity Risk Analyst
Model Risk Analyst
Data Quality Analyst
Concentration Risk Analyst
```

Belangrijk:

De Risk Officer adviseert.

Hij kan bijvoorbeeld zeggen:

```text
RECOMMENDATION = REJECT
```

maar de werkelijke harde limieten worden afgedwongen door software.

---

# 16. Independent Review-team

Deze afdeling moet organisatorisch onafhankelijk blijven.

Lead:

```text
Independent Reviewer
```

Specialisten:

```text
Replication Analyst
Red Team Researcher
Evidence Auditor
Data Leakage Investigator
Backtest Bias Reviewer
```

De oorspronkelijke Quant-agent mag niet zelf zijn eigen uiteindelijke onafhankelijke review goedkeuren.

---

# 17. Rapportagelijnen

Voorbeeld:

```text
Owner / Board
│
├── CIO
│   ├── Market Intelligence
│   ├── US Equities
│   ├── Crypto
│   ├── Quant Research
│   ├── Portfolio Manager
│   └── Risk Officer
│
└── Independent Reviewer
```

De Independent Reviewer rapporteert voor belangrijke promotiebesluiten rechtstreeks aan de Owner/Board.

Daarmee voorkom je dat de CIO slechte onderzoeksresultaten kan laten verdwijnen.

---

# 18. Tijdelijke agents

Agents mogen tijdelijke specialisten aanmaken.

Maar uitsluitend vanuit goedgekeurde:

```text
AgentTemplates
```

Bijvoorbeeld:

```yaml
template: crypto_derivatives_specialist

allowed_tools:
  - market.read
  - funding.read
  - open_interest.read
  - journal.read
  - journal.write

forbidden:
  - strategy.promote
  - bot.start
  - exchange.order
```

---

# 19. Geen permission escalation

Een child-agent mag nooit meer rechten krijgen dan zijn parent.

Bereken:

```text
effective_permissions =

parent_permissions
∩
template_permissions
∩
environment_permissions
```

Dus:

```text
Crypto Analyst
```

kan nooit een child-agent aanmaken met:

```text
production_admin
```

als hij dat zelf niet heeft.

---

# 20. Startlimieten

Maak alles configureerbaar.

Begin bijvoorbeeld met:

```yaml
organization:

  fixed_roles: 8

  temporary_agents:
    max_active: 4

  codex:
    max_concurrent_runs: 2

  delegation:
    max_depth: 3

  tasks:
    max_children_per_task: 10
```

Later moeten deze waarden eenvoudig aanpasbaar zijn.

---

# 21. Delegatieniveaus

Voorbeeld:

```text
CIO
 ↓
Quant Researcher
 ↓
Backtest Specialist
```

Dit zijn drie niveaus.

Een Backtest Specialist mag dan niet opnieuw onbeperkt agents creëren.

Maximale depth:

```text
3
```

is initieel verstandig.

---

# 22. Agent Registry

Maak een centraal register:

```text
Agent
────────────────

agent_id
name
role
department
reports_to
template
status
environment
permissions
budget
model
provider
prompt_version
skills
workspace
created_at
temporary
parent_agent
delegation_depth
```

Statuses:

```text
OFFLINE
IDLE
SCHEDULED
WORKING
WAITING
BLOCKED
REVIEWING
PAUSED
BUDGET_EXHAUSTED
ERROR
```

---

# 23. Research Goal hierarchy

Alle taken moeten terug te leiden zijn tot een doel.

Bijvoorbeeld:

```text
ORGANIZATION GOAL
Improve risk-adjusted crypto returns

        ↓

RESEARCH GOAL
Find robust BTC swing strategies

        ↓

PROJECT
BTC 1H trend strategies

        ↓

EXPERIMENT
EXP-2026-00124

        ↓

TASK
Test ATR stop sensitivity
```

Iedere agent moet weten:

```text
WHAT am I doing?
WHY am I doing it?
FOR WHICH GOAL?
WHO requested it?
WHO reviews it?
```

---

# 24. Task System

Iedere taak krijgt minimaal:

```text
task_id
parent_task
goal_id
project_id
experiment_id

title
description

owner
requester
reviewer

priority
status

budget
deadline

inputs
expected_output

created_at
started_at
completed_at

environment
```

---

# 25. Task status

Gebruik bijvoorbeeld:

```text
CREATED
QUEUED
ASSIGNED
CHECKED_OUT
RUNNING
WAITING
BLOCKED
REVIEW
COMPLETED
REJECTED
CANCELLED
FAILED
```

---

# 26. Atomic task checkout

Voorkom dat twee agents hetzelfde onderzoek uitvoeren omdat zij tegelijkertijd dezelfde queued task zien.

Gebruik database locking.

Concept:

```text
Agent A → checkout TASK-123
                   ↓
              lock acquired

Agent B → checkout TASK-123
                   ↓
                  denied
```

---

# 27. Idempotency

Iedere automatisch gemaakte taak krijgt een deduplicatiesleutel.

Bijvoorbeeld:

```text
BTC
+
FOMC_EVENT_2026_09
+
MARKET_INTELLIGENCE
```

wordt:

```text
event_hash
```

Als dezelfde nieuwsfeed hetzelfde bericht tien keer binnenbrengt, worden niet tien Codex onderzoeken gestart.

---

# 28. Persistent agent state

Agents moeten niet iedere execution opnieuw beginnen alsof zij niets weten.

Bewaar:

```text
current task
completed subtasks
artifacts
sources
open questions
conversation/session reference
journal references
work summary
next action
```

Wanneer een heartbeat de agent opnieuw start:

```text
resume task
```

in plaats van:

```text
restart research
```

---

# 29. Heartbeat architecture

Agents draaien niet noodzakelijk permanent.

De scheduler wekt ze.

Bijvoorbeeld:

```text
Heartbeat
   ↓
Agent checks inbox
   ↓
Claim task
   ↓
Load context
   ↓
Execute Codex run
   ↓
Store result
   ↓
Journal
   ↓
Assign/review next work
   ↓
Sleep
```

---

# 30. Event-driven wakeups

Naast geplande runs kunnen events agents wakker maken.

Bijvoorbeeld:

```text
Unexpected BTC move
Breaking news
Major funding change
Strategy drawdown
Bot anomaly
New earnings report
Data problem
```

Deze worden events.

Bijvoorbeeld:

```text
MarketEvent
NewsEvent
RiskEvent
BotEvent
StrategyEvent
```

---

# 31. Werkritme

Startconfiguratie:

### Continu

Deterministische services draaien continu:

```text
market feeds
exchange feeds
scanners
risk monitors
bot health
position reconciliation
```

Dit vereist geen Codex-run per tick.

### Event driven

Belangrijke signalen starten gerichte onderzoekstaken.

### Ieder uur

```text
CIO Research Round
```

De CIO:

- bekijkt nieuwe gebeurtenissen;
- controleert open taken;
- verdeelt nieuw werk;
- prioriteert;
- controleert budget.

### Dagelijks

CIO maakt:

```text
Daily Firm Report
```

### Wekelijks

```text
Weekly Research Review
```

met:

- strategieprestaties;
- paper performance;
- agent performance;
- datakwaliteit;
- onderzoeksdekking;
- kosten;
- fouten;
- mislukte hypothesen.

---

# 32. Agent budgets

Iedere agent krijgt budgetten.

Niet alleen geld, maar bijvoorbeeld:

```text
token budget
Codex runtime budget
API request budget
news research budget
task count budget
time budget
```

Voorbeeld:

```yaml
agent:
  crypto_analyst:

    monthly_budget_eur: 50

    max_cost_per_task_eur: 2

    max_codex_runs_per_hour: 4
```

---

# 33. Budget inheritance

Een tijdelijke specialist gebruikt budget van zijn parent/department.

Dus:

```text
Quant Department
Budget €100
```

kan niet door vier child-agents veranderen in:

```text
4 × €100
```

---

# 34. Hard budget stop

Wanneer budget is opgebruikt:

```text
agent.status = BUDGET_EXHAUSTED
```

Nieuwe Codex-runs:

```text
BLOCKED
```

Het budget mag alleen via gebruikersconfiguratie of bevoegd policy-proces worden verhoogd.

---

# 35. Research Workflow

De vaste route wordt:

```text
HYPOTHESIS
    ↓
STRATEGY VERSION
    ↓
BACKTEST
    ↓
ROBUSTNESS TEST
    ↓
INDEPENDENT REVIEW
    ↓
EXPERIMENTAL PAPER
    ↓
MAIN PAPER
    ↓
SHADOW
    ↓
LIVE LIMITED
    ↓
LIVE
```

---

# 36. Strategy Lifecycle

Gebruik:

```text
IDEA
DRAFT
BACKTESTED
VALIDATED
PAPER_EXPERIMENTAL
PAPER_MAIN
SHADOW
LIVE_LIMITED
LIVE
PAUSED
REJECTED
RETIRED
```

---

# 37. Automatische research promotion

Begin met configureerbare criteria.

Minimaal:

- drie chronologische out-of-sample testvensters;
- positief totaalresultaat na kosten;
- positief resultaat in minimaal twee testvensters;
- minimaal 30 dagen forward testing;
- minimaal 30 afgesloten paper trades;
- langzame strategieën krijgen langere observatie;
- positieve nettoverwachting tijdens paper;
- drawdown binnen de ingestelde grens;
- positief totaalresultaat met 2× aangenomen tradingkosten;
- geen kritieke dataproblemen;
- geen openstaande kritieke reviewer findings.

Een bestaande strategie mag alleen worden vervangen wanneer beide over:

```text
dezelfde periode
dezelfde data
hetzelfde risicobudget
```

zijn vergeleken.

---

# 38. Criteria zijn geen bewijs van toekomstige winst

WJP Yield moet dit conceptueel behandelen als:

```text
research selection criteria
```

Niet als:

```text
proof of future profitability
```

Sla dit onderscheid ook in rapportages op.

---

# 39. Agents mogen criteria niet wijzigen

Agents mogen adviseren:

```text
"Ik stel voor min_trades van 30 naar 50 te veranderen."
```

Maar niet:

```text
UPDATE promotion_policy
```

Globale promotiecriteria worden beschermd door configuratie en permissions.

---

# 40. Zelfverbetering

Agents mogen zelfstandig verbeteren:

```text
strategy parameters
research prompts
agent prompts
task templates
research ordering
specialist selection
experiment designs
```

Binnen bestaande grenzen.

---

# 41. Wijzigingen waarvoor menselijke toestemming nodig blijft

Maak deze standaard HUMAN_APPROVAL_REQUIRED:

```text
application code
production infrastructure
production permissions
new exchange credentials
new paid data subscription
global risk limits
promotion criteria
withdrawal permissions
secret access
live execution policies
```

Codex mag hiervoor wel voorstellen maken.

---

# 42. Strategy DSL

Agents definiëren strategieën bij voorkeur declaratief.

Bijvoorbeeld:

```yaml
strategy:

  id: btc_trend_pullback

  market:
    symbol: BTC-USDT

  timeframe:
    signal: 1h
    confirmation: 4h

  entry:

    all:
      - close > ema_200
      - ema_20 > ema_50
      - adx > 25
      - rsi > 45
      - rsi < 65

  exit:

    stop:
      type: atr
      multiplier: 1.8

    take_profit:
      type: risk_reward
      ratio: 2.5

  risk:
    risk_per_trade_pct: 0.5
```

Agents hoeven daardoor niet voor iedere strategie willekeurige executable code te genereren.

---

# 43. Strategy Registry

Iedere versie wordt immutable opgeslagen.

```text
strategy_id
version
hash
parent_version
created_by
experiment_id
hypothesis_id
DSL
parameters
dataset
backtests
reviews
paper results
status
```

---

# 44. Alle mislukte varianten bewaren

Nooit slechte experimenten automatisch verwijderen.

Bijvoorbeeld:

```text
trend-v1   REJECTED
trend-v2   REJECTED
trend-v3   REJECTED
trend-v4   PAPER
```

De agents moeten kunnen leren:

> v2 is al getest en faalde door hoge transactiekosten in range-regimes.

Dit voorkomt het telkens opnieuw onderzoeken van dezelfde slechte ideeën.

---

# 45. Research Memory

Bouw een querybare research memory.

Agents moeten vragen kunnen stellen als:

```text
Welke BTC 1H hypotheses hebben we getest?

Welke trendstrategieën faalden tijdens ranges?

Welke parameters bleken robuust?

Welke strategieën zijn gevoelig voor fees?

Welke hypothesen werden door de reviewer verworpen?
```

Gebruik daarvoor het Journal + Strategy Registry + Experiment Registry.

---

# 46. WJP Journal

Het Journal wordt een kernonderdeel van WJP Yield.

Niet alleen een logfile.

Het wordt het **institutionele geheugen van de tradingorganisatie**.

---

# 47. Eén immutable Event Ledger

Onder alle journals ligt één append-only ledger.

Bijvoorbeeld:

```text
JournalEvent

event_id
timestamp
environment
organization
actor_type
actor_id
department
task_id
goal_id
experiment_id
strategy_id
bot_id
event_type
payload
source_refs
artifact_refs
cost
previous_hash
entry_hash
```

---

# 48. Journal entries worden nooit aangepast

Geen:

```text
UPDATE journal_entry
```

Correcties worden nieuwe entries.

Bijvoorbeeld:

```text
ENTRY-100
BTC funding = X

ENTRY-117
CORRECTION TO ENTRY-100
Original source contained stale data
```

Historie blijft behouden.

---

# 49. Hash chained journal

Voor extra integriteit:

```text
entry_hash =
hash(
    previous_hash
    +
    event_payload
)
```

Hiermee zijn veranderingen achteraf detecteerbaar.

---

# 50. Vijf journal views

Bouw boven hetzelfde ledger verschillende views.

## Research Journal

```text
hypotheses
experiments
backtests
reviews
research conclusions
```

## Trading Journal

```text
signals
risk decisions
orders
fills
positions
PnL
```

## Agent Journal

```text
tasks
delegation
Codex runs
decisions
failures
cost
```

## Operations Journal

```text
deployments
restarts
outages
configuration changes
```

## Decision Journal

```text
strategy promotions
rejections
policy decisions
human approvals
```

---

# 51. Research report structure

Iedere onderzoeksoutput gebruikt:

```text
FACTS

HYPOTHESES

COUNTEREVIDENCE

CONCLUSION

UNCERTAINTIES

SOURCES

DATA USED

COSTS

NEXT QUESTIONS
```

Hiermee wordt voorkomen dat AI-veronderstellingen worden gepresenteerd alsof het feiten zijn.

---

# 52. Source provenance

Iedere belangrijke claim moet verwijzen naar:

```text
source
source timestamp
retrieved timestamp
dataset
data range
provider
```

Voor numerieke analyses:

```text
dataset_id
dataset_version
start
end
```

---

# 53. AI provenance

Voor iedere belangrijke AI-output:

```text
agent
role
model/provider
prompt version
task
inputs
tools used
output
timestamp
cost
```

Bewaar geen verborgen chain-of-thought.

Bewaar wel:

```text
decision summary
evidence
counterevidence
conclusion
```

---

# 54. Experiment Registry

Iedere quant-poging krijgt een ID.

Bijvoorbeeld:

```text
EXP-2026-000124
```

Opslaan:

```text
hypothesis
owner
strategy versions
dataset
parameters
cost assumptions
backtest results
review
paper results
conclusion
```

---

# 55. Task Journal example

```json
{
  "event": "TASK_COMPLETED",
  "task": "TASK-8812",
  "actor": "quant-researcher",
  "experiment": "EXP-2026-000124",
  "result": "strategy rejected",
  "reason": "performance disappeared at 2x fees",
  "reviewer": "independent-reviewer"
}
```

---

# 56. Strategy Promotion Journal

Een promotie moet exact reconstruerbaar zijn.

Bijvoorbeeld:

```text
Strategy: BTC-PB-17
Version: 8

Backtests:
PASS

Walk-forward:
PASS

2x costs:
PASS

Paper:
PASS

Risk review:
PASS

Independent review:
PASS

Promotion:
PAPER_EXPERIMENTAL → PAPER_MAIN

Requested by:
Portfolio Manager

Reviewed by:
Independent Reviewer

Policy:
PROMOTION_POLICY_V3
```

---

# 57. Codex Run Journal

Ook iedere Codex-run wordt geregistreerd.

```text
RUN-30272

agent
task
start
finish
status
token usage
cost
artifacts created
subtasks created
journal events
errors
```

---

# 58. Journal UI

Maak een centrale:

```text
JOURNAL
```

met filters:

```text
Today
Agents
Research
Strategies
Trading
Risk
Operations
Errors
Promotions
Costs
```

De gebruiker moet bijvoorbeeld kunnen klikken:

```text
BTC Trend v8
```

en de volledige geschiedenis zien:

```text
hypothesis
 ↓
research
 ↓
backtest
 ↓
review
 ↓
paper
 ↓
promotion
 ↓
trades
```

---

# 59. Daily CIO Report

Iedere dag genereert de CIO één compact rapport.

Bijvoorbeeld:

```text
WJP YIELD — DAILY FIRM REPORT

Market State
------------

Important Events
----------------

Research Completed
------------------

Strategies
----------

Paper Portfolio
---------------

Live Portfolio
--------------

Risk
----

Agent Activity
--------------

Costs
-----

Failures
--------

Open Questions
--------------

Human Action Required
---------------------
```

Alle onderliggende informatie moet doorklikbaar zijn naar het Journal.

---

# 60. Alleen relevante notifications

Geen melding voor iedere agenttaak.

Wel:

```text
critical risk event
strategy promotion
production failure
unexpected position
data corruption
large drawdown
human approval needed
major research finding
```

De rest staat in de Daily Report en Journal.

---

# 61. Agent performance

Meet ook de kwaliteit van agents.

Bijvoorbeeld:

```text
tasks completed
tasks rejected
review failure rate
average cost
duplicate research rate
source quality
data errors
strategies surviving review
```

Gebruik dit niet automatisch als waarheid maar als evaluatiegegevens.

---

# 62. Agent reviews

Wekelijks kan CIO bijvoorbeeld rapporteren:

```text
Crypto Analyst

Tasks           17
Useful          13
Rejected         4
Cost            €...
Source errors     1
```

Hiermee kunnen prompts en taakverdeling verbeterd worden.

---

# 63. Market Scanner

Continu draaien hoeft niet via Codex.

Gebruik snelle gewone software voor:

```text
price
volume
ATR
volatility
funding
OI
spread
orderbook
technical triggers
```

Een interessante situatie maakt vervolgens bijvoorbeeld:

```text
ResearchTrigger
```

---

# 64. Codex alleen wanneer intelligent onderzoek waarde toevoegt

Niet:

```text
Iedere BTC tick → Codex
```

Maar:

```text
Scanner detects exceptional condition
          ↓
ResearchTrigger
          ↓
Task
          ↓
appropriate Agent
          ↓
Codex
```

Dit bespaart enorm veel kosten.

---

# 65. Jev AI

Gebruik een aparte abstractie:

```text
AIProvider
```

Implementaties:

```text
CodexProvider
JevProvider
MockProvider
```

Jev kan bijvoorbeeld zeer snelle realtime classificaties uitvoeren.

Codex kan complexer onderzoek uitvoeren.

---

# 66. CIO orchestration

CIO gebruikt niet zelf alle tools.

CIO organiseert werk.

Bijvoorbeeld:

```text
Event:
BTC drops 7%

CIO
│
├── Market Intelligence
│      └─ investigate news
│
├── Crypto Analyst
│      ├─ funding specialist
│      └─ liquidation specialist
│
├── Quant
│      └─ evaluate active strategies
│
└── Risk Officer
       └─ inspect exposure
```

Daarna verzamelt CIO resultaten.

---

# 67. Task fan-out

Eén hoofdtaak:

```text
TASK-100

Explain BTC sudden move
```

kan resulteren in:

```text
TASK-101
News analysis

TASK-102
Derivatives analysis

TASK-103
Liquidity analysis

TASK-104
Portfolio exposure
```

Alle child-tasks wijzen terug naar TASK-100.

---

# 68. Task fan-in

Wanneer alle relevante child-tasks gereed zijn:

```text
CIO synthesis task
```

maakt één geïntegreerde conclusie.

---

# 69. Geen consensus = waarheid

Wanneer vijf agents hetzelfde zeggen is dat niet automatisch correct.

De Independent Reviewer moet expliciet zoeken naar:

```text
alternative explanation
missing data
data leakage
bias
conflicting evidence
```

---

# 70. Perfect Setup Engine

Voor zeer selectieve trading:

```text
trend_filter       PASS
momentum_filter    PASS
volatility_filter  PASS
liquidity_filter   PASS
spread_filter      PASS
regime_filter      PASS
news_risk          PASS
strategy_signal    PASS
risk_engine        PASS
```

Alle verplichte voorwaarden moeten PASS zijn.

Hiermee kan WJP Yield bijvoorbeeld slechts enkele hoogwaardige setups per week selecteren.

---

# 71. Geen fictieve AI win probability

Niet simpelweg:

```text
AI confidence = 97%
```

en dan handelen.

Gebruik bewijsbare voorwaarden en historische statistieken.

AI confidence mag ondersteunend zijn maar niet de harde risk controls vervangen.

---

# 72. Backtest Engine

Neem minimaal mee:

```text
maker fee
taker fee
spread
slippage
funding
latency assumptions
tick size
minimum size
partial fills
```

---

# 73. Validation

Ondersteun:

```text
chronological holdout
out-of-sample
walk-forward
Monte Carlo
parameter sensitivity
fee sensitivity
slippage sensitivity
regime analysis
```

---

# 74. Paper portfolios

Maak minimaal twee paperlagen.

## Experimental Paper

Nieuwe strategieën.

```text
PAPER_EXPERIMENTAL
```

## Main Paper Portfolio

Strategieën die de eerste selectie hebben overleefd.

```text
PAPER_MAIN
```

Zo kunnen slechte experimenten niet het beeld van de bewezen paperstrategieën vervuilen.

---

# 75. Shadow Mode

Daarna:

```text
SHADOW
```

De strategie ontvangt echte realtime data en neemt virtuele beslissingen alsof hij live is.

Geen echte orders.

---

# 76. Limited Live

Daarna:

```text
LIVE_LIMITED
```

met sterk begrensde allocatie.

Pas later:

```text
LIVE
```

---

# 77. Deterministic Risk Engine

Geen LLM.

Controleert minimaal:

```text
risk per trade
daily loss
weekly loss
portfolio drawdown
total exposure
asset exposure
correlated exposure
open positions
leverage
spread
liquidity
slippage
data freshness
exchange health
position reconciliation
```

---

# 78. Kill switches

Maak:

```text
GLOBAL
EXCHANGE
STRATEGY
BOT
ASSET
```

kill switches.

De kill switch voor nieuwe entries mag noodzakelijke beschermende exits niet blokkeren.

---

# 79. Local Codex access

Op Mac krijgt Codex uitgebreide developmentrechten.

Bijvoorbeeld:

```text
repository
tests
Docker
local database
local backtests
local agents
local paper trading
```

---

# 80. Production Codex access

Op VPS krijgt Codex geen vrije root-shell.

Gebruik:

```text
WJP Agent Gateway
```

en:

```text
WJP Ops CLI
```

Bijvoorbeeld:

```bash
wjp status
wjp agents
wjp tasks
wjp journal
wjp bots
wjp strategies
wjp backtests
wjp logs
wjp health
```

---

# 81. Geen directe Docker socket

Production Codex krijgt niet rechtstreeks:

```text
/var/run/docker.sock
```

Gebruik gecontroleerde operations.

---

# 82. Productie-secrets

Codex krijgt niet:

```text
OKX_SECRET
OKX_PASSPHRASE
withdrawal credentials
```

Execution Engine gebruikt exchange-secrets intern.

---

# 83. Production trading keys

Trading bots:

```text
TRADE = allowed
WITHDRAWAL = forbidden
```

Gebruik aparte keys voor:

```text
development
test
production
```

---

# 84. Agent permission system

Werk met capabilities.

Bijvoorbeeld:

```text
market.read

news.read

journal.read
journal.write

strategy.read
strategy.create
strategy.test

paper.deploy

bot.read

risk.read

production.request

production.deploy
```

Bijna geen researchagent krijgt:

```text
production.deploy
```

---

# 85. Agent Gateway

Tools kunnen uiteindelijk bijvoorbeeld zijn:

```text
organization.get
agent.get
agent.spawn
agent.pause

task.create
task.delegate
task.complete

journal.query
journal.write

market.snapshot
market.scan

strategy.create
strategy.compare
strategy.validate

backtest.run

paper.deploy

bot.status

portfolio.read

risk.read
```

---

# 86. MCP-ready

Ontwerp deze tools zodanig dat ze later als MCP-tools kunnen worden aangeboden.

Codex hoeft dan niet via shellbestanden te werken.

---

# 87. WJP Yield services

Voeg aan de eerdere architectuur toe:

```text
services/

agent-orchestrator/
task-manager/
agent-registry/
heartbeat-scheduler/
agent-budget/
agent-policy/
journal/
experiment-registry/
research-memory/
```

Naast:

```text
market-data/
strategy-lab/
backtester/
risk-engine/
execution-engine/
portfolio/
bot-manager/
```

---

# 88. Nieuwe repositorystructuur

```text
wjp-yield/
│
├── apps/
│   ├── web/
│   └── api/
│
├── services/
│   ├── agent-orchestrator/
│   ├── agent-registry/
│   ├── task-manager/
│   ├── heartbeat-scheduler/
│   ├── agent-budget/
│   ├── agent-policy/
│   ├── journal/
│   ├── research-memory/
│   ├── experiment-registry/
│   │
│   ├── market-data/
│   ├── strategy-lab/
│   ├── strategy-engine/
│   ├── backtester/
│   ├── portfolio/
│   ├── risk-engine/
│   ├── execution-engine/
│   └── bot-manager/
│
├── agents/
│   ├── CIO/
│   ├── market-intelligence/
│   ├── equities/
│   ├── crypto/
│   ├── quant/
│   ├── portfolio/
│   ├── risk/
│   ├── reviewer/
│   │
│   └── templates/
│       ├── news-investigator/
│       ├── source-verifier/
│       ├── derivatives-specialist/
│       ├── backtest-specialist/
│       ├── robustness-specialist/
│       └── ...
│
├── strategies/
│
├── experiments/
│
├── packages/
│
├── infra/
│
├── ops/
│
└── AGENTS.md
```

---

# 89. Agent Organization UI

Voeg hoofdmenu toe:

```text
Firm
```

Daaronder:

```text
Organization
Agents
Tasks
Research
Journal
Budgets
Reviews
Routines
```

---

# 90. Organization scherm

Visualiseer:

```text
              Owner
                │
               CIO
      ┌─────────┼──────────┐
      │         │          │
   Market     Crypto      Quant
     Intel       │          │
                 │          │
              Portfolio     │
                 │          │
                Risk        │
                            │
              Independent Reviewer
```

Klik op een agent om te zien:

```text
current task
subagents
recent work
cost
status
performance
journal
```

---

# 91. Firm Dashboard

Bovenaan bijvoorbeeld:

```text
Agents working            2 / 2
Temporary specialists     3 / 4
Queued tasks             11
Blocked tasks             1
Research today            7
Codex cost today         €...
Strategies testing        6
Paper strategies          3
Risk status               NORMAL
```

---

# 92. Task Inbox

Laat zien:

```text
URGENT
RESEARCH
REVIEW
BLOCKED
APPROVAL REQUIRED
```

Gebruiker kan taken ook zelf toevoegen.

Bijvoorbeeld:

> Onderzoek of BTC 4H breakoutstrategieën momenteel beter werken dan trend pullbacks.

CIO verdeelt vervolgens zelfstandig het werk.

---

# 93. Development Agent Organization

Ook Codex dat WJP Yield zelf ontwikkelt moet werken met subagents.

Gebruik een aparte developmentorganisatie:

```text
Development Lead
│
├── Backend Agent
├── Frontend Agent
├── Agent Architecture Agent
├── Quant Engine Agent
├── DevOps Agent
├── Security Agent
└── QA / Reviewer Agent
```

---

# 94. Development concurrency

Ook hier initieel:

```text
max concurrent Codex runs = 2
```

De Development Lead bepaalt welke twee taken parallel het meeste voordeel geven.

Bijvoorbeeld:

```text
RUN 1
Backend task system

RUN 2
Frontend organization UI
```

---

# 95. Independent code review

Voor gevoelige onderdelen zoals:

```text
Risk Engine
Execution Engine
Permissions
Secrets
Production Deployment
```

mag dezelfde agent niet zowel implementeren als definitief goedkeuren.

Gebruik:

```text
Implementer
     ↓
Tests
     ↓
Independent Codex Reviewer
     ↓
Human approval waar nodig
```

---

# 96. AGENTS.md

Leg belangrijke grondregels vast.

Onder andere:

```text
WJP Yield is a multi-agent trading organization.

Use delegation for specialist work.

Every task must have an owner.

Every important task must have a reviewer.

Every agent action must be attributable.

Never silently delete failed research.

Never bypass Journal logging.

Never expose secrets.

Never bypass RiskEngine.

AI agents never place direct exchange orders.

Temporary agents never gain permissions beyond their parent.

Production changes require controlled deployment.

Promotion criteria cannot be changed by research agents.

Risk limits cannot be weakened by research agents.

All important conclusions distinguish:
facts,
hypotheses,
counterevidence,
conclusions.

All quantitative results include trading costs.

Every strategy version is immutable.

Every promotion is reversible.
```

---

# 97. Development phases

## Phase 1 — Core platform

Bouw:

```text
monorepo
Docker
FastAPI
Next.js
PostgreSQL
Redis
configuration
logging
health
```

---

## Phase 2 — Journal

Bouw het Journal vroeg.

Niet achteraf.

Implementeer:

```text
append-only ledger
hash chaining
actor attribution
task references
experiment references
source references
```

Vanaf dat moment moeten nieuwe modules zichzelf journalen.

---

## Phase 3 — Agent Organization

Bouw:

```text
Agent Registry
Org Chart
Roles
Permissions
Agent Templates
Delegation
```

---

## Phase 4 — Task System

Bouw:

```text
goals
projects
tasks
parent/child tasks
atomic checkout
dependencies
reviewers
deduplication
```

---

## Phase 5 — Scheduler

Bouw:

```text
heartbeats
event wakeups
recurring routines
concurrency
recovery
persistent runs
```

---

## Phase 6 — Budget Engine

Bouw:

```text
token tracking
provider costs
task budgets
department budgets
hard stops
```

---

## Phase 7 — Market Data

Bouw:

```text
OKX market data
normalization
candles
orderbook
funding
OI
historical storage
```

---

## Phase 8 — Strategy Lab

Bouw:

```text
Strategy DSL
Strategy Registry
Experiment Registry
Strategy versioning
```

---

## Phase 9 — Backtester

Bouw:

```text
historical simulation
fees
slippage
spread
funding
metrics
```

---

## Phase 10 — Research Agents

Activeer eerst:

```text
CIO
Crypto Analyst
Quant Researcher
Independent Reviewer
```

Test het organisatorische model met slechts vier rollen.

Daarna uitbreiden naar alle acht.

---

## Phase 11 — Specialist spawning

Voeg:

```text
temporary agent templates
delegation limits
child budgets
permission inheritance
```

toe.

---

## Phase 12 — Strategy Lab UI

Bouw:

```text
Firm dashboard
Org chart
Task inbox
Journal
Research
Experiments
Strategies
Backtests
Agent budgets
```

---

## Phase 13 — Paper execution

Bouw:

```text
Portfolio Manager
Risk Engine
Paper Exchange
Bot Manager
```

---

## Phase 14 — Daily/weekly routines

Activeer:

```text
hourly CIO round
daily report
weekly research review
agent evaluation
```

---

## Phase 15 — VPS

Deploy dezelfde architectuur naar VPS.

Implementeer:

```text
Agent Gateway
production permissions
private connectivity
monitoring
backup
rollback
scheduler ownership
```

---

## Phase 16 — Shadow

Realtime strategieën zonder orders.

---

## Phase 17 — Limited Live

Pas nadat research-, journal-, risk- en recovery-systemen bewezen werken.

---

# 98. Acceptance test voor de Agent Organization

Een goede end-to-end test is:

```text
1. Scanner detecteert uitzonderlijke BTC funding.

2. Event wordt aangemaakt.

3. Dedup controle voorkomt dubbele taken.

4. CIO wordt wakker.

5. CIO maakt parent research task.

6. CIO delegeert:
   - Crypto Analyst
   - Market Intelligence
   - Risk Officer

7. Crypto Analyst spawnt tijdelijk:
   Derivatives Specialist.

8. Alle agents voeren onderzoek uit.

9. Iedere agent schrijft resultaten in het Journal.

10. CIO maakt synthesis.

11. Quant maakt eventueel een hypothese.

12. Backtest wordt gestart.

13. Independent Reviewer probeert resultaat te weerleggen.

14. Strategie wordt:
    REJECTED
    of
    PAPER_EXPERIMENTAL.

15. Gehele keten is terug te vinden vanaf één Event ID.
```

Als één stap niet reproduceerbaar is, is de implementatie nog niet gereed.

---

# 99. Voorbeeld van een volledige researchketen

```text
MARKET EVENT
BTC volatility expansion

        ↓

CIO
"Investigate"

        ↓

┌─────────────────────────────┐
│                             │
Market Intel              Crypto Analyst
│                             │
News specialist          Derivatives specialist
│                             │
└──────────────┬──────────────┘
               │
          CIO synthesis
               │
               ▼
       Quant Researcher
               │
       creates hypothesis
               │
               ▼
         Strategy v12
               │
               ▼
           Backtest
               │
               ▼
      Robustness specialist
               │
               ▼
    Independent Reviewer
               │
        ┌──────┴───────┐
        │              │
      FAIL           PASS
        │              │
     Journal      Experimental Paper
                       │
                       ▼
                 Main Paper
                       │
                       ▼
                    Shadow
```

---

# 100. Hoofdarchitectuur

Uiteindelijk:

```text
                    WJP YIELD
                        │
                OWNER / BOARD
                        │
                 AGENT FIRM
                        │
          ┌─────────────┴─────────────┐
          │                           │
         CIO                 Independent Reviewer
          │
 ┌────────┼────────┬────────────┐
 │        │        │            │
Intel   Assets    Quant     Portfolio
          │        │            │
      ┌───┴──┐     │           Risk
      │      │     │
 Equities  Crypto  │
                   │
            Temporary Specialists
                   │
                   ▼
              Research Output
                   │
              WJP JOURNAL
                   │
                   ▼
              Strategy Lab
                   │
             Validation Gates
                   │
         Experimental Paper
                   │
              Main Paper
                   │
                Shadow
                   │
             LIVE LIMITED
                   │
                   ▼
            FIXED RISK ENGINE
                   │
            EXECUTION ENGINE
                   │
             Exchange Adapter
                   │
                  OKX
```

---

# 101. Codex master instruction

Act as Lead Architect and Development Manager for WJP Yield.

WJP Yield is not a single-agent application.

It is an autonomous multi-agent trading organization.

Design and implement an organizational control plane with:

- fixed employee agents;
- department leads;
- temporary specialist agents;
- hierarchical delegation;
- reporting lines;
- goals;
- tasks;
- reviewers;
- agent heartbeats;
- event-driven work;
- persistent agent state;
- budgets;
- hard cost limits;
- permissions;
- approval gates;
- immutable journaling;
- agent evaluation.

Use Paperclip's organizational concepts only as architectural inspiration.

WJP Yield must have no runtime dependency on Paperclip.

The initial trading organization contains:

1. CIO / Firm Manager
2. Market Intelligence
3. US Equities Analyst
4. Crypto Analyst
5. Quant Researcher
6. Portfolio Manager
7. Risk Officer
8. Independent Reviewer

The Owner/Board is the human user.

Each fixed role is a department lead and may spawn temporary specialist agents from explicitly approved templates.

Initial limits:

```text
8 fixed agents
4 temporary agents maximum
2 concurrent Codex runs
3 delegation levels maximum
```

All limits must be configurable.

A child agent can never obtain more permissions than its parent.

Every task must contain:

```text
owner
goal
budget
expected result
reviewer
```

Important research must distinguish:

```text
facts
hypotheses
counterevidence
conclusions
uncertainties
sources
```

Build an append-only WJP Journal that records:

```text
agent activity
research
sources
tasks
experiments
strategy versions
backtests
reviews
promotions
risk decisions
trades
deployments
errors
costs
human decisions
```

Never delete failed experiments.

Failed research is organizational knowledge.

Every strategy must follow:

```text
Hypothesis
→ Versioned Strategy
→ Backtest
→ Robustness
→ Independent Review
→ Experimental Paper
→ Main Paper
→ Shadow
→ Limited Live
→ Live
```

Agents may automatically improve:

```text
strategies
parameters
prompts
research methodology
task decomposition
specialist selection
```

within existing policies.

Agents cannot independently modify:

```text
application code
production permissions
global risk limits
promotion policies
paid data subscriptions
production secrets
```

These require proposals and appropriate approval.

The Risk Officer provides analysis.

The deterministic Risk Engine enforces safety.

Even unanimous agreement between all AI agents never bypasses fixed software controls.

Codex agents never communicate directly with exchange order endpoints.

Every actual order follows:

```text
Strategy / TradeCandidate
→ Policy Engine
→ deterministic Risk Engine
→ Execution Engine
→ Exchange Adapter
```

WJP Yield must run from one codebase both locally and on the production VPS.

Local and production environments have separate state and databases.

Local mode must support:

```text
development
research
backtesting
agent organization
paper trading
```

Production supports:

```text
research
paper
shadow
limited live
live
```

Codex running locally must be able to work on the local repository and use a controlled WJP Agent Gateway to inspect and operate the VPS.

Production credentials and unrestricted host access are not exposed to research agents.

Develop incrementally.

Use specialized development subagents.

For every implementation task:

```text
plan
delegate where useful
implement
test
independent review
journal/document
integrate
```

Never sacrifice traceability for autonomy.

The objective is not to create an AI that trades autonomously.

The objective is to create a **traceable autonomous trading organization** whose research can improve over time while deterministic software remains responsible for execution safety.
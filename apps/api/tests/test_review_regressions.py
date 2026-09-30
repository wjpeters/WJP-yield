"""Independent QA: database invariants and concurrent scheduler state transitions."""
import os
from concurrent.futures import ThreadPoolExecutor
from threading import Event
from uuid import uuid4

import psycopg
import pytest

from services.firm.config import Config
from services.firm.organization import Organization
from services.firm.policy import PolicyError
from services.firm.providers import MockProvider
from services.firm.scheduler import Scheduler
from services.firm.store import Store


@pytest.fixture
def org():
    dsn = os.getenv("WJP_TEST_DATABASE_URL")
    if not dsn:
        pytest.skip("Actual PostgreSQL runtime identity required")
    item = Organization(Store(Config(database_url=dsn, organization="independent-review-" + uuid4().hex)))
    item.seed()
    return item


def make_task(org, **fields):
    return org.task(dict(title="Independent regression task", description="Validate concrete safety invariant", owner="crypto-analyst", reviewer="independent-reviewer", goal_id="organization-research", budget_eur=0.5, expected_output="Source-qualified report", **fields))


def test_concurrent_spawn_cannot_exceed_cap_or_parent_rights(org):
    def spawn(index):
        try:
            return org.spawn("crypto-analyst", {"name": "Specialist " + str(index), "template": "funding_specialist"})
        except PolicyError as exc:
            return exc.status
    with ThreadPoolExecutor(max_workers=8) as workers:
        results = list(workers.map(spawn, range(8)))
    children = [r for r in results if isinstance(r, dict)]
    assert len(children) == org.config.max_temporary
    assert len([r for r in results if r == 409]) == 4
    with org.store.transaction() as tx:
        parent = tx.require("agent", "crypto-analyst")
        assert all(set(c["permissions"]) <= set(parent["permissions"]) for c in children)
        assert tx.verify_journal()["valid"]


def test_runtime_raw_sql_rls_and_grants_not_only_store_filter(org):
    foreign = "foreign-" + uuid4().hex
    with org.store.transaction() as tx:
        tx.put("task", "scope-assertion", {"title": "only this organization"})
        tx.conn.execute("SELECT set_config('wjp.organization', %s, true)", (foreign,))
        assert tx.conn.execute("SELECT id FROM firm_entities WHERE organization=%s", (org.config.organization,)).fetchall() == []
        assert tx.conn.execute("UPDATE firm_entities SET data=data||'{\"tampered\":true}'::jsonb WHERE organization=%s RETURNING id", (org.config.organization,)).fetchall() == []
        assert tx.conn.execute("SELECT seq FROM firm_ledger WHERE organization=%s", (org.config.organization,)).fetchall() == []
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with org.store.transaction() as tx:
            tx.conn.execute("INSERT INTO firm_entities(environment,organization,kind,id,data) VALUES(%s,%s,'task','cross-scope','{}')", (org.config.environment, foreign))
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with org.store.transaction() as tx:
            tx.conn.execute("INSERT INTO firm_ledger(environment,organization,entry,previous_hash,entry_hash) VALUES(%s,%s,'{}','0','1')", (org.config.environment, org.config.organization))
    with org.store.transaction() as tx:
        role = tx.conn.execute("SELECT rolname,rolsuper,rolbypassrls,rolcreaterole,rolcreatedb FROM pg_roles WHERE rolname=current_user").fetchone()
        assert role["rolname"] == "wjp_api"
        assert not any(role[k] for k in ["rolsuper", "rolbypassrls", "rolcreaterole", "rolcreatedb"])
        assert not tx.require("task", "scope-assertion").get("tampered")


def test_pause_during_run_stays_paused_when_run_finishes(org, monkeypatch):
    import services.firm.scheduler as scheduler_module
    gate = Event()
    class DelayedFixture(MockProvider):
        def execute(self, *args):
            assert gate.wait(8)
            return super().execute(*args)
    monkeypatch.setattr(scheduler_module, "provider", lambda _: DelayedFixture())
    item = make_task(org, fixture=True)
    scheduler = Scheduler(org)
    try:
        assert len(scheduler.tick()["started"]) == 1
        org.pause(item["owner"])
        gate.set()
        scheduler.close()
        with org.store.transaction() as tx:
            agent = tx.require("agent", item["owner"])
            assert agent["enabled"] is False
            assert agent["status"] == "PAUSED"
            assert tx.require("task", item["id"])["status"] == "REVIEW"
    finally:
        gate.set()
        scheduler.close()


def test_fixtures_do_not_claim_real_independent_agent_review(org):
    result = org.demo()
    with org.store.transaction() as tx:
        reports = tx.list("report")
        runs = tx.list("run")
        tasks = [t for t in tx.list("task") if t.get("event_id") == result["event"]["id"]]
        assert len(reports) == len(runs) == len(tasks) == 5
        assert all(r["provenance"]["synthetic"] and not r["provenance"]["ai_output"] for r in reports)
        assert all(r["execution_mode"] == "synchronous_fixture_not_scheduler" for r in runs)
        assert all(t["review"].get("independent_agent_review") is False for t in tasks)
        entries = tx.journal_entries(event_id=result["event"]["id"])
        fixture_reviews = [e for e in entries if e["event_type"] == "FIXTURE_REVIEW_COMPLETED"]
        assert len(fixture_reviews) == 5
        assert all(e["actor_type"] == "system" for e in fixture_reviews)
        assert tx.verify_journal()["valid"]


def test_concurrent_append_chain_overrides_forged_scope(org):
    def append(index):
        with org.store.transaction() as tx:
            tx.journal("INDEPENDENT_CONCURRENT_APPEND", payload={"index": index})
    with ThreadPoolExecutor(max_workers=6) as workers:
        list(workers.map(append, range(12)))
    with org.store.transaction() as tx:
        tx.journal("FORGED_METADATA", environment="production", organization="foreign", timestamp="forged", journal_id="forged")
        entry = tx.journal_entries(limit=1)[0]
        assert entry["environment"] == org.config.environment
        assert entry["organization"] == org.config.organization
        assert entry["timestamp"] != "forged"
        assert entry["journal_id"] != "forged"
        assert tx.verify_journal()["valid"]


def test_all_research_artifact_kinds_immutable_in_runtime(org):
    for kind in ["strategy_version", "dataset", "backtest", "strategy_review", "report"]:
        with org.store.transaction() as tx:
            tx.put(kind, "immutable-" + kind, {"evidence": "original"})
        with pytest.raises(psycopg.errors.RaiseException):
            with org.store.transaction() as tx:
                tx.put(kind, "immutable-" + kind, {"evidence": "rewritten"})
        with org.store.transaction() as tx:
            assert tx.require(kind, "immutable-" + kind)["evidence"] == "original"


def test_expired_lease_stale_worker_cannot_double_settle_or_publish(org, monkeypatch):
    import services.firm.scheduler as scheduler_module
    gate = Event()
    class DelayedFixture(MockProvider):
        def execute(self, *args):
            assert gate.wait(8)
            return super().execute(*args)
    monkeypatch.setattr(scheduler_module, "provider", lambda _: DelayedFixture())
    item = make_task(org, fixture=True)
    first, second = Scheduler(org), Scheduler(org)
    try:
        run_id = first.tick()["started"][0]
        with org.store.transaction() as tx:
            tx.conn.execute("UPDATE firm_leases SET expires_at=clock_timestamp()-interval '1 second' WHERE environment=%s AND organization=%s", (org.config.environment, org.config.organization))
        assert second.tick()["recovered"] == [run_id]
        gate.set()
        first.close()
        with org.store.transaction() as tx:
            run = tx.require("run", run_id)
            assert run["status"] == "INTERRUPTED"
            assert tx.require("task", item["id"])["status"] == "BLOCKED"
            account = tx.require("budget", run["budget_accounts"][0])
            assert account["used"]["eur"] == item["budget_eur"]
            assert account["reserved"]["eur"] == 0
            assert tx.list("report") == []
            settlements = [e for e in tx.journal_entries() if e["event_type"] == "BUDGET_SETTLED"]
            assert len(settlements) == 1
            assert tx.verify_journal()["valid"]
    finally:
        gate.set()
        first.close()
        second.close()


def test_invalid_executor_usage_rolls_back_output_and_charges_ceiling(org, monkeypatch):
    import services.firm.scheduler as scheduler_module
    class InvalidUsageFixture(MockProvider):
        def execute(self, *args):
            result = super().execute(*args)
            result.usage["eur"] = 1000
            return result
    monkeypatch.setattr(scheduler_module, "provider", lambda _: InvalidUsageFixture())
    item = make_task(org, fixture=True)
    scheduler = Scheduler(org)
    try:
        run_id = scheduler.tick()["started"][0]
        scheduler.close()
        with org.store.transaction() as tx:
            run = tx.require("run", run_id)
            assert run["status"] == "FAILED"
            assert run["usage"] == run["reservation"]
            account = tx.require("budget", run["budget_accounts"][0])
            assert account["used"]["eur"] == item["budget_eur"]
            assert account["reserved"]["eur"] == 0
            assert tx.list("report") == []
            assert tx.verify_journal()["valid"]
    finally:
        scheduler.close()


def test_manual_submission_is_owner_activity_not_an_ai_run(org):
    item = make_task(org)
    org.checkout(item["id"])
    report = MockProvider().execute({"fixture": True}, {}, {}).report
    org.complete(item["id"], item["owner"], report)
    with org.store.transaction() as tx:
        report = tx.list("report")[0]
        assert report["actor"] == "owner"
        assert report["assigned_agent"] == item["owner"]
        assert report["provenance"]["provider"] == "human_submission"
        assert report["provenance"]["ai_output"] is False
        events = [e for e in tx.journal_entries() if e.get("task_id") == item["id"] and e["event_type"] in {"TASK_CHECKED_OUT", "RESEARCH_SUBMITTED"}]
        assert len(events) == 2
        assert all(e["actor"] == "owner" and e["actor_type"] == "human" for e in events)
        assert tx.list("run") == []


@pytest.mark.parametrize("fields", [
    {"max_temporary": 0}, {"max_temporary": 1.5},
    {"max_runs": -1}, {"max_runs": 2.5},
    {"max_depth": True}, {"max_children": 10.0},
    {"max_tokens_per_task": -1}, {"max_tokens_per_task": 100.5},
    {"max_runtime_per_task": 0}, {"max_runtime_per_task": False},
    {"max_api_per_task": -1}, {"max_api_per_task": 2.5},
    {"max_runs_per_hour": 0}, {"max_runs_per_hour": float("nan")},
    {"max_cost_per_task": -1}, {"max_cost_per_task": 0},
    {"max_cost_per_task": float("nan")}, {"max_cost_per_task": float("inf")},
])
def test_resource_limits_fail_closed_at_startup(fields):
    with pytest.raises(ValueError):
        Config(**fields).validate()


def make_strategy(client):
    response = client.post("/api/firm/strategies", headers={"x-wjp-request": "1"}, json={"name": "Independent lab strategy", "goal_id": "organization-research", "dsl": {"symbol": "BTC-USDT", "timeframe": "1h", "template": "ema_crossover", "parameters": {"fast": 10, "slow": 20}}})
    assert response.status_code == 200, response.text
    return response.json()


def test_lab_owner_review_cannot_unlock_any_execution_promotion(org):
    from apps.api.main import create_app
    from fastapi.testclient import TestClient
    with TestClient(create_app(org.config)) as client:
        strategy = make_strategy(client)
        with org.store.transaction() as tx:
            tx.put("dataset", "test-dataset", {"verified": True, "fixture": False})
            tx.put("backtest", "test-backtest", {"dataset_id": "test-dataset", "strategy_id": strategy["id"], "robustness": {"positive_windows": 3, "windows": [{}, {}, {}], "oos_net_pnl": 100, "double_costs_net_pnl": 100, "forward_days": 365, "paper_trades": 100, "paper_expectancy": 1, "paper_drawdown_pct": 1}})
            state = tx.require("strategy_state", strategy["id"])
            tx.put("strategy_state", strategy["id"], dict(state, status="BACKTESTED", backtest_id="test-backtest"))
        reviewed = client.post("/api/firm/strategies/" + strategy["id"] + "/reviews", headers={"x-wjp-request": "1"}, json={"decision": "approve", "summary": "Manual Owner reproduction in isolated test"})
        assert reviewed.status_code == 200
        assert reviewed.json()["independent_agent_review"] is False
        for target in ["VALIDATED", "PAPER_EXPERIMENTAL", "PAPER_MAIN", "SHADOW", "LIVE_LIMITED", "LIVE"]:
            response = client.post("/api/firm/strategies/" + strategy["id"] + "/promote", headers={"x-wjp-request": "1"}, json={"target": target})
            assert response.status_code == 200
            assert response.json()["allowed"] is False
            assert response.json()["status"] == "BACKTESTED"
        assert client.post("/api/firm/strategies/" + strategy["id"] + "/reviews", headers={"x-wjp-request": "1"}, json={"decision": "approve", "summary": "Attempted false independence", "independent_agent_review": True}).status_code == 422
        with org.store.transaction() as tx:
            assert tx.verify_journal()["valid"]


def test_bot_creation_is_persistent_draft_and_live_cannot_be_requested(org):
    from apps.api.main import create_app
    from fastapi.testclient import TestClient
    with TestClient(create_app(org.config)) as client:
        strategy = make_strategy(client)
        body = {"name": "Independent paper config", "strategy_id": strategy["id"], "allocation_eur": 100, "mode": "paper"}
        response = client.post("/api/firm/bots", headers={"x-wjp-request": "1"}, json=body)
        assert response.status_code == 200
        bot = response.json()
        assert bot["status"] == "DRAFT"
        assert bot["execution_ready"] is False
        assert bot["strategy_hash"] == strategy["hash"]
        assert client.post("/api/firm/bots", headers={"x-wjp-request": "1"}, json=dict(body, mode="live")).status_code == 422
        assert client.post("/api/firm/bots", headers={"x-wjp-request": "1"}, json=dict(body, status="RUNNING")).status_code == 422
        assert client.post("/api/firm/bots/" + bot["id"] + "/start", headers={"x-wjp-request": "1"}, json={}).status_code == 404
        assert client.get("/api/firm/lab").json()["execution_ready"] is False
        with org.store.transaction() as tx:
            assert tx.require("bot", bot["id"])["status"] == "DRAFT"
            assert tx.verify_journal()["valid"]

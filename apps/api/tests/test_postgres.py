"""Run against actual PostgreSQL as wjp_api; each test gets an isolated org scope."""
import os
import time
from uuid import uuid4
from dataclasses import replace
from concurrent.futures import ThreadPoolExecutor
from threading import Event
import pytest
import psycopg
from fastapi.testclient import TestClient

from services.firm.config import Config
from services.firm.store import Store,now,ident
from services.firm.organization import Organization
from services.firm.scheduler import Scheduler
from services.firm.policy import PolicyError
from services.firm.providers import MockProvider


@pytest.fixture
def org():
    dsn=os.getenv('WJP_TEST_DATABASE_URL')
    if not dsn: pytest.skip('Set WJP_TEST_DATABASE_URL to restricted wjp_api PostgreSQL DSN for integration coverage')
    config=Config(database_url=dsn,organization='test-'+uuid4().hex,environment='local',provider='disabled')
    org=Organization(Store(config)); org.seed(); return org


def task(org,owner='crypto-analyst',**extra):
    return org.task({'title':'Research test task','description':'Evidence based analysis','owner':owner,'reviewer':'independent-reviewer','goal_id':'organization-research','budget_eur':0.5,'expected_output':'Structured report',**extra})


def test_seed_journal_immutable_runtime_grants_and_artifacts(org):
    snapshot=org.snapshot(); assert len(snapshot['agents'])==8
    assert sum(a['enabled'] for a in snapshot['agents'])==4
    with org.store.transaction() as tx:
        assert tx.verify_journal()['valid']
        tx.put('strategy_version','immutable-v1',{'hash':'abc'})
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with org.store.transaction() as tx: tx.conn.execute('UPDATE firm_ledger SET previous_hash=%s',('tampered',))
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with org.store.transaction() as tx: tx.conn.execute('TRUNCATE firm_ledger')
    with pytest.raises(psycopg.errors.RaiseException):
        with org.store.transaction() as tx: tx.put('strategy_version','immutable-v1',{'hash':'changed'})


def test_atomic_checkout_and_idempotent_task_creation(org):
    item=task(org)
    def checkout():
        try: return org.checkout(item['id'])['status']
        except PolicyError as exc: return exc.status
    with ThreadPoolExecutor(max_workers=2) as pool: results=list(pool.map(lambda _:checkout(),range(2)))
    assert sorted(map(str,results))==['409','CHECKED_OUT']
    with ThreadPoolExecutor(max_workers=4) as pool: rows=list(pool.map(lambda _:task(org,idempotency_key='dedup-experiment'),range(4)))
    assert len({r['id'] for r in rows})==1
    with org.store.transaction() as tx: assert tx.verify_journal()['valid']


def test_event_dedup_and_independent_review(org):
    args={'event_type':'TEST_EVENT','title':'Event test','payload':{},'idempotency_key':'event-one'}
    a=org.event(args); b=org.event(args); assert a['id']==b['id']; assert len(a['task_ids'])==4
    with pytest.raises(PolicyError): task(org,reviewer='crypto-analyst')
    item=task(org); org.checkout(item['id'])
    result=MockProvider().execute({'fixture':True},{},{})
    org.complete(item['id'],item['owner'],result.report)
    with pytest.raises(PolicyError): org.review(item['id'],'crypto-analyst','approve','invalid self review')
    with pytest.raises(PolicyError): org.review(item['id'],'independent-reviewer','approve','Owner cannot impersonate reviewer')
    reviewed=org.review(item['id'],'owner','reject','Fixture does not establish real research evidence')
    assert reviewed['status']=='REJECTED'
    assert reviewed['review']['independent_agent_review'] is False


def test_spawn_rights_inheritance_depth_active_cap(org):
    child=org.spawn('crypto-analyst',{'name':'Specialist one','template':'funding_specialist'})
    grand=org.spawn(child['id'],{'name':'Specialist two','template':'funding_specialist'})
    assert child['budget_scope']=='department:crypto-analyst'
    assert grand['delegation_depth']==3
    with pytest.raises(PolicyError): org.spawn(grand['id'],{'name':'Too deep','template':'funding_specialist'})
    org.spawn('quant-researcher',{'name':'Quant one','template':'backtest_specialist'})
    org.spawn('cio',{'name':'Planning one','template':'planning_specialist'})
    with pytest.raises(PolicyError): org.spawn('cio',{'name':'Planning five','template':'planning_specialist'})
    with pytest.raises(PolicyError): org.spawn('crypto-analyst',{'name':'Invalid escalation','template':'replication_analyst'})


def test_budget_reservations_atomic_and_inherited(org):
    first,second=task(org),task(org)
    with org.store.transaction() as tx:
        tx.lock('organization'); a=org._account(tx,'department:crypto-analyst',{})
        a['limits']['eur']=0.75; tx.put('budget',a['id'],a)
    def reserve(t):
        with org.store.transaction() as tx:
            tx.lock('organization'); return org._reserve(tx,t)
    with ThreadPoolExecutor(max_workers=2) as pool: reservations=list(pool.map(reserve,[first,second]))
    assert sum(r is not None for r in reservations)==1
    with org.store.transaction() as tx:
        account=org._account(tx,'department:crypto-analyst',{})
        assert account['reserved']['eur']==0.5
        assert tx.require('agent','crypto-analyst')['status']=='BUDGET_EXHAUSTED'


def test_lease_fencing_and_disabled_provider_wait(org):
    item=task(org); one,two=Scheduler(org),Scheduler(org)
    try:
        assert one.tick()['status']=='active'
        assert two.tick()['status']=='lease_held_by_other_scheduler'
        with org.store.transaction() as tx:
            assert tx.require('task',item['id'])['status']=='WAITING'
            assert not tx.list('run')
            tx.conn.execute("UPDATE firm_leases SET expires_at=clock_timestamp()-interval '1 second' WHERE environment=%s AND organization=%s",(org.config.environment,org.config.organization))
        assert two.tick()['fence']==2
    finally: one.close(); two.close()


def test_scheduler_concurrency_and_persistence(org,monkeypatch):
    import services.firm.scheduler as module
    gate=Event()
    class BoundedFixture(MockProvider):
        def execute(self,*args):
            assert gate.wait(8)
            return super().execute(*args)
    monkeypatch.setattr(module,'provider',lambda _:BoundedFixture())
    for owner in ['crypto-analyst','quant-researcher','cio']: task(org,owner=owner,fixture=True)
    scheduler=Scheduler(org)
    try:
        assert len(scheduler.tick()['started'])==2
        assert len(scheduler.tick()['started'])==0
        assert sum(r['status']=='RUNNING' for r in org.snapshot()['runs'])==2
        gate.set(); scheduler.close()
        assert all(r['status']=='COMPLETED' for r in org.snapshot()['runs'])
        assert org.snapshot()['metrics']['journal_integrity']['valid']
    finally: gate.set(); scheduler.close()


def test_recovery_consumes_reservation_and_blocks_retry(org):
    item=task(org); scheduler=Scheduler(org)
    with org.store.transaction() as tx:
        tx.lock('organization'); accounts=org._reserve(tx,item); org._checkout(tx,item['id'],item['owner'])
        tx.put('task',item['id'],dict(tx.require('task',item['id']),status='RUNNING'))
        tx.put('run','crashed-run',{'status':'RUNNING','agent_id':item['owner'],'task_id':item['id'],'reservation':item['ceilings'],'budget_accounts':accounts,'budget_scope':'department:crypto-analyst','started_at':now(),'deadline':now(),'fence':0,'scheduler_owner':'dead-worker'})
    try:
        assert scheduler.tick()['recovered']==['crashed-run']
        with org.store.transaction() as tx:
            assert tx.require('run','crashed-run')['status']=='INTERRUPTED'
            assert tx.require('task',item['id'])['status']=='BLOCKED'
            budget=org._account(tx,'department:crypto-analyst',{})
            assert budget['reserved']['eur']==0
            assert budget['used']['eur']==0.5
    finally: scheduler.close()


def test_transactional_rollback_and_row_scope(org):
    before=len(org.snapshot()['journal'])
    with pytest.raises(RuntimeError):
        with org.store.transaction() as tx:
            tx.put('task','should-rollback',{'title':'not committed'})
            tx.journal('UNCOMMITTED_MUTATION')
            raise RuntimeError('abort')
    with org.store.transaction() as tx:
        assert tx.get('task','should-rollback') is None
        assert len(tx.journal_entries())==before
    other=Store(replace(org.config,organization='other-'+uuid4().hex))
    with other.transaction() as tx: assert tx.list('agent')==[]; assert tx.journal_entries()==[]
    production_scope=Store(replace(org.config,environment='production'))
    with production_scope.transaction() as tx: assert tx.list('agent')==[]; assert tx.journal_entries()==[]


def test_demo_acceptance_truthful_idempotent_complete_chain(org):
    demo=org.demo(); assert demo['synthetic']; assert demo['ai_output'] is False
    assert demo['tasks_completed']==5; assert demo['journal_verified']['valid']
    duplicate=org.demo(); assert duplicate['idempotent']
    snapshot=org.snapshot(); assert all(r['provenance']['synthetic'] for r in snapshot['reports'])
    assert len(snapshot['reports'])==5


def test_http_mutation_boundary_and_readback(org):
    from apps.api.main import create_app
    with TestClient(create_app(org.config)) as client:
        assert client.get('/api/firm/health').status_code==200
        assert client.get('/api/firm/snapshot').json()['config']['organization']==org.config.organization
        assert client.post('/api/firm/goals',json={'title':'New goal'}).status_code==403
        assert client.post('/api/firm/goals',headers={'x-wjp-request':'1','origin':'https://evil.example'},json={'title':'New goal'}).status_code==403
        assert client.post('/api/firm/goals',headers={'x-wjp-request':'1','origin':'http://localhost:4311'},json={'title':'New goal'}).status_code==201

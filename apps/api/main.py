from contextlib import asynccontextmanager
import hmac
import importlib
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field
from typing import Literal

from services.firm.config import Config
from services.firm.store import Store
from services.firm.organization import Organization
from services.firm.scheduler import Scheduler
from services.firm.policy import PolicyError, TEMPLATES


class Input(BaseModel):
    model_config = ConfigDict(extra='forbid')

class GoalInput(Input):
    title: str = Field(min_length=3,max_length=300)
    description: str = Field(default='',max_length=10000)
    parent_id: str | None = None
    owner: str = 'cio'
    reviewer: str = 'independent-reviewer'

class TaskInput(Input):
    title: str = Field(min_length=3,max_length=300)
    description: str = Field(min_length=3,max_length=20000)
    owner: str
    goal_id: str
    budget_eur: float = Field(ge=0,allow_inf_nan=False)
    expected_output: str = Field(min_length=3,max_length=5000)
    reviewer: str
    parent_task: str | None = None
    idempotency_key: str | None = Field(default=None,min_length=3,max_length=200)
    priority: int = Field(default=50,ge=0,le=100)
    inputs: list = Field(default_factory=list)

class ActorInput(Input): actor: str | None = None
class CompleteInput(ActorInput): report: dict
class ReviewInput(Input):
    actor: str
    decision: Literal['approve','reject']
    summary: str = Field(min_length=5,max_length=10000)

class EventInput(Input):
    event_type: str = Field(min_length=3,max_length=100)
    title: str = Field(min_length=3,max_length=300)
    payload: dict = Field(default_factory=dict)
    idempotency_key: str = Field(min_length=3,max_length=200)
    goal_id: str | None = None

class SpawnInput(Input):
    template: str
    name: str = Field(min_length=3,max_length=150)
    goal_id: str | None = None
    task_id: str | None = None


def create_app(config=None):
    config=(config or Config()).validate(); store=Store(config); org=Organization(store); scheduler=Scheduler(org)
    @asynccontextmanager
    async def lifespan(app):
        # Migrations/seed run only in separate admin migrator, never in runtime.
        with store.transaction() as tx:
            identity=tx.conn.execute("SELECT current_user AS identity, rolsuper FROM pg_roles WHERE rolname=current_user").fetchone()
            if identity['identity']!='wjp_api' or identity['rolsuper']: raise RuntimeError('API requires restricted wjp_api database role')
        yield
        scheduler.close()

    app=FastAPI(title='WJP Yield Firm Control Plane',version='0.1.0',lifespan=lifespan)
    app.state.store=store; app.state.organization=org; app.state.scheduler=scheduler

    @app.middleware('http')
    async def guard(request: Request,call_next):
        if request.url.path.endswith('/health'):
            return await call_next(request)
        if config.environment=='production' or config.auth_token:
            candidate=request.headers.get('authorization','').removeprefix('Bearer ')
            if not hmac.compare_digest(candidate,config.auth_token): return JSONResponse({'detail':'Owner authentication required'},401)
        if request.method not in {'GET','HEAD','OPTIONS'}:
            if request.headers.get('x-wjp-request')!='1': return JSONResponse({'detail':'Explicit WJP mutation header required'},403)
            origin=request.headers.get('origin')
            if origin and origin!=config.allowed_origin: return JSONResponse({'detail':'Origin is not authorized'},403)
        return await call_next(request)

    @app.exception_handler(PolicyError)
    async def policy_error(request,exc): return JSONResponse({'detail':exc.message},exc.status)

    @app.get('/api/firm/health')
    def health():
        try:
            with store.transaction() as tx: tx.conn.execute('SELECT 1')
            return {'status':'ok','environment':config.environment,'organization':config.organization,'provider':config.provider,'live_execution':False}
        except Exception:
            return JSONResponse({'status':'unavailable'},503)

    @app.get('/api/firm/snapshot')
    def snapshot(): return org.snapshot()
    @app.post('/api/firm/goals',status_code=201)
    def goal(data:GoalInput): return org.goal(data.model_dump(exclude_none=True))
    @app.post('/api/firm/tasks',status_code=201)
    def task(data:TaskInput): return org.task(data.model_dump(exclude_none=True))
    @app.post('/api/firm/tasks/{id}/checkout')
    def checkout(id:str,data:ActorInput): return org.checkout(id,data.actor)
    @app.post('/api/firm/tasks/{id}/complete')
    def complete(id:str,data:CompleteInput): return org.complete(id,data.actor,data.report)
    @app.post('/api/firm/tasks/{id}/review')
    def review(id:str,data:ReviewInput): return org.review(id,data.actor,data.decision,data.summary)
    @app.post('/api/firm/events',status_code=201)
    def event(data:EventInput): return org.event(data.model_dump(exclude_none=True))
    @app.post('/api/firm/agents/{id}/spawn',status_code=201)
    def spawn(id:str,data:SpawnInput): return org.spawn(id,data.model_dump(exclude_none=True))
    @app.post('/api/firm/agents/{id}/pause')
    def pause(id:str): return org.pause(id)
    @app.get('/api/firm/templates')
    def templates(): return {k:dict(v,permissions=sorted(v['permissions'])) for k,v in TEMPLATES.items()}
    @app.get('/api/firm/journal')
    def journal(view:str|None=None,actor:str|None=None,strategy_id:str|None=None,event_id:str|None=None):
        with store.transaction() as tx: return tx.journal_entries(view,actor,strategy_id,event_id)
    @app.get('/api/firm/journal/verify')
    def verify():
        with store.transaction() as tx: return tx.verify_journal()
    @app.post('/api/firm/scheduler/tick')
    def tick(): return scheduler.tick()
    @app.post('/api/firm/demo/acceptance')
    def demo(): return org.demo()

    try: trading=importlib.import_module('services.trading.api')
    except ModuleNotFoundError as exc:
        if exc.name not in {'services.trading','services.trading.api'}: raise
    else: app.include_router(trading.create_router(store))
    return app


app=create_app()

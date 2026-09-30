"""Owner gateway for immutable research bundles and paused bot configuration."""
import os
import time
from uuid import uuid4
from dataclasses import asdict
import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, ConfigDict
from typing import Literal
from .market_data import capture
from .domain import validate_strategy, backtest, robustness, digest, PolicyError, Costs, RiskLimits, candles_valid, promotion_reasons

class Strict(BaseModel):
    model_config=ConfigDict(extra="forbid")
class StrategyInput(Strict):
    name: str=Field(min_length=3,max_length=100)
    dsl: dict
    goal_id: str
    parent_version: str|None=None
class DatasetInput(Strict):
    symbol: Literal["BTC-USDT","ETH-USDT","SOL-USDT","BTC-USDC","ETH-USDC","SOL-USDC"]
    timeframe: Literal["1h","4h","1d"]="1h"
class BacktestInput(Strict):
    dataset_id: str
    strategy_id: str
    costs: dict=Field(default_factory=dict)
class ReviewInput(Strict):
    decision: Literal["approve","reject"]
    summary: str=Field(min_length=10,max_length=4000)
    findings: list[str]=Field(default_factory=list,max_length=50)
class PromoteInput(Strict):
    target: Literal["VALIDATED","PAPER_EXPERIMENTAL","PAPER_MAIN","SHADOW","LIVE_LIMITED","LIVE","PAUSED","REJECTED"]
class BotInput(Strict):
    name: str=Field(min_length=3,max_length=80)
    strategy_id: str
    allocation_eur: float=Field(gt=0,le=10000)
    portfolio: Literal["experimental","main"]="experimental"
    mode: Literal["paper","shadow"]="paper"

def create_router(store):
    router=APIRouter(prefix="/api/firm",tags=["Strategy Lab"])
    def require(tx,kind,id):
        record=tx.get(kind,id)
        if record is None: raise HTTPException(404,"Record niet gevonden")
        return record
    def lock(tx,key):
        tx.lock(key)
    def policy(fn,*args):
        try: return fn(*args)
        except (PolicyError,TypeError,ValueError) as exc: raise HTTPException(422,str(exc)) from None
    def strategy_rows(tx):
        states={s["id"]:s for s in tx.list("strategy_state")}
        return [{**s,**states.get(s["id"],{})} for s in tx.list("strategy_version")]
    @router.get("/lab")
    def lab():
        with store.transaction() as tx:
            return {"strategies":strategy_rows(tx),"bots":tx.list("bot"),"datasets":[{k:v for k,v in d.items() if k!="candles"} for d in tx.list("dataset")],"backtests":[{k:v for k,v in b.items() if k!="full_result"} for b in tx.list("backtest")],"reviews":tx.list("strategy_review"),"risk_limits":asdict(RiskLimits()),"execution_ready":False,"execution_note":"Botconfiguratie opgeslagen. De 24/7 execution-worker en OKX-demoaansluiting worden gebouwd volgens fase 1.","jev":{"primary":"TypeSafe System One","fallback":"OpenRouter System One","configured":False}}
    @router.post("/strategies")
    def create_strategy(body:StrategyInput):
        dsl=policy(validate_strategy,body.dsl)
        with store.transaction() as tx:
            require(tx,"goal",body.goal_id)
            if body.parent_version: require(tx,"strategy_version",body.parent_version)
            bundle={"schema_version":1,"name":body.name,"dsl":dsl,"goal_id":body.goal_id,"parent_version":body.parent_version}
            hash=digest(bundle); id="STR-"+hash[:16]
            lock(tx,"strategy-create:"+id)
            existing=tx.get("strategy_version",id)
            if existing: return {**existing,"deduplicated":True}
            record={"id":id,**bundle,"hash":hash,"created_at":time.time(),"created_by":"owner"}
            tx.put("strategy_version",id,record)
            tx.put("strategy_state",id,{"id":id,"status":"DRAFT","previous_status":None})
            tx.journal("STRATEGY_CREATED",actor="owner",payload={"hash":hash,"name":body.name},goal_id=body.goal_id,strategy_id=id,category="research")
            return {**record,"status":"DRAFT"}
    @router.get("/strategies/{id}/bundle")
    def export(id:str):
        with store.transaction() as tx: return require(tx,"strategy_version",id)
    @router.post("/datasets/okx")
    def dataset(body:DatasetInput):
        # Fixed public endpoint, never accepts an arbitrary URL or user-labelled real data.
        with httpx.Client(timeout=20,follow_redirects=False) as client:
            try:
                captured=capture(client,body.symbol,body.timeframe,os.getenv("WJP_OKX_PUBLIC_REGION","eea"))
                rows=captured["candles"]
            except (httpx.HTTPError,ValueError,KeyError,IndexError,TypeError): raise HTTPException(503,"OKX-historie tijdelijk niet beschikbaar") from None
        policy(candles_valid,rows,body.timeframe)
        if rows[-1]["time"]>time.time(): raise HTTPException(422,"OKX leverde een toekomstige candle")
        id="DATA-"+digest({"symbol":body.symbol,"timeframe":body.timeframe,"candles":rows})[:16]
        with store.transaction() as tx:
            lock(tx,"dataset:"+id)
            if tx.get("dataset",id): return {"id":id,"deduplicated":True}
            record={"id":id,"symbol":body.symbol,"timeframe":body.timeframe,"candles":rows,"count":len(rows),"hash":digest(rows),"provider":"OKX public REST","source":captured["source"],"instrument_source":captured["instrument_source"],"quote_currency":captured["quote_currency"],"region":captured["region"],"instrument_rules":captured["instrument"],"retrieved_at":time.time(),"start":rows[0]["time"],"end":rows[-1]["time"],"verified":True,"fixture":False}
            tx.put("dataset",id,record); tx.journal("DATASET_CAPTURED",actor="owner",payload={k:v for k,v in record.items() if k!="candles"},category="research")
            return {k:v for k,v in record.items() if k!="candles"}
    @router.post("/backtests")
    def run_backtest(body:BacktestInput):
        with store.transaction() as tx:
            s=require(tx,"strategy_version",body.strategy_id); d=require(tx,"dataset",body.dataset_id)
        if s["dsl"]["symbol"]!=d["symbol"] or s["dsl"]["timeframe"]!=d["timeframe"]: raise HTTPException(422,"Dataset en strategie moeten exact dezelfde markt en timeframe gebruiken")
        venue=d.get("instrument_rules",{})
        try: costs=Costs(**{"tick_size":float(venue.get("tickSz",.01)),"lot_size":float(venue.get("lotSz",.00001)),"minimum_quantity":float(venue.get("minSz",.00001)),**body.costs})
        except (PolicyError,TypeError): raise HTTPException(422,"Ongeldige kostenconfiguratie") from None
        result=policy(backtest,d["candles"],s["dsl"],costs)
        try: checks=robustness(d["candles"],s["dsl"],costs)
        except PolicyError as exc: checks={"incomplete":True,"reason":str(exc),"windows":[],"positive_windows":0}
        id="BT-"+digest({"strategy_hash":s["hash"],"dataset_hash":d["hash"],"costs":asdict(costs)})[:16]
        with store.transaction() as tx:
            lock(tx,"backtest:"+id)
            lock(tx,"strategy:"+s["id"])
            if tx.get("backtest",id): return tx.get("backtest",id)
            record={"id":id,"strategy_id":s["id"],"dataset_id":d["id"],"quote_currency":d["quote_currency"],"dataset_hash":d["hash"],"strategy_hash":s["hash"],"created_at":time.time(),"fixture":d["fixture"],"full_result":result,"metrics":{k:result[k] for k in ("net_pnl","return_pct","max_drawdown_pct","closed_trades","net_expectancy")},"robustness":checks,"costs":asdict(costs)}
            tx.put("backtest",id,record)
            state=require(tx,"strategy_state",s["id"])
            tx.put("strategy_state",s["id"],{**state,"status":"BACKTESTED" if state["status"]=="DRAFT" else state["status"],"previous_status":state["status"],"backtest_id":id})
            tx.journal("BACKTEST_COMPLETED",actor="software:backtester",payload={"id":id,"metrics":record["metrics"],"dataset_hash":d["hash"],"strategy_hash":s["hash"],"robustness":checks,"selection_criteria_not_profitability_proof":True},strategy_id=s["id"],goal_id=s["goal_id"],category="research")
            return record
    @router.post("/strategies/{id}/reviews")
    def review(id:str,body:ReviewInput):
        # Owner documents manual reproduction; never accepts a spoofed independent-agent actor.
        with store.transaction() as tx:
            s=require(tx,"strategy_version",id); state=require(tx,"strategy_state",id)
            if not state.get("backtest_id"): raise HTTPException(409,"Eerst een backtest uitvoeren")
            rid="REVIEW-"+uuid4().hex[:12]
            record={"id":rid,"strategy_id":id,"backtest_id":state["backtest_id"],"actor":"owner","kind":"manual_owner_review","independent_agent_review":False,"created_at":time.time(),**body.model_dump()}
            tx.put("strategy_review",rid,record); tx.journal("OWNER_STRATEGY_REVIEW",actor="owner",payload=record,strategy_id=id,category="decision")
            return record
    @router.post("/strategies/{id}/promote")
    def promote(id:str,body:PromoteInput):
        with store.transaction() as tx:
            lock(tx,"strategy:"+id); s=require(tx,"strategy_version",id); state=require(tx,"strategy_state",id)
            if body.target in {"PAUSED","REJECTED"}:
                reasons=[]
            else:
                bt=tx.get("backtest",state.get("backtest_id","")) or {}; d=tx.get("dataset",bt.get("dataset_id","")) or {}
                evidence={**bt.get("robustness",{}),"fixture":d.get("fixture",True),"dataset_verified":d.get("verified",False),"independent_review":False}
                reasons=promotion_reasons(body.target,evidence)
            tx.journal("PROMOTION_BLOCKED" if reasons else "STRATEGY_STATE_CHANGED",actor="software:promotion-policy",payload={"from":state["status"],"target":body.target,"reasons":reasons,"policy":"promotion-v1","requested_by":"owner"},strategy_id=id,category="decision")
            if not reasons:
                tx.put("strategy_state",id,{**state,"status":body.target,"previous_status":state["status"]})
            return {"allowed":not reasons,"reasons":reasons,"status":state["status"] if reasons else body.target}
    @router.post("/bots")
    def create_bot(body:BotInput):
        with store.transaction() as tx:
            s=require(tx,"strategy_version",body.strategy_id)
            id="BOT-"+uuid4().hex[:12]
            record={"id":id,**body.model_dump(),"strategy_hash":s["hash"],"status":"DRAFT","created_at":time.time(),"exchange":"OKX","market_type":"spot","leverage":1,"execution_ready":False}
            tx.put("bot",id,record); tx.journal("BOT_CONFIGURED",actor="owner",payload=record,strategy_id=s["id"],goal_id=s["goal_id"],category="operations")
            return record
    @router.post("/bots/{id}/pause")
    def pause_bot(id:str):
        with store.transaction() as tx:
            b=require(tx,"bot",id); tx.put("bot",id,{**b,"status":"PAUSED"}); tx.journal("BOT_PAUSED",actor="owner",payload={"bot_id":id},strategy_id=b["strategy_id"],category="operations")
            return {"id":id,"status":"PAUSED"}
    return router

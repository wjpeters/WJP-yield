"""Deterministic, declarative research. No eval, model calls or order endpoints."""
from dataclasses import dataclass, asdict
from hashlib import sha256
import json
import math
import random

class PolicyError(ValueError): pass

def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)

def digest(value): return sha256(canonical(value).encode()).hexdigest()

def number(value, name, low, high):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not low <= value <= high:
        raise PolicyError(f"Ongeldige {name}")
    return value

def validate_strategy(dsl):
    if not isinstance(dsl, dict) or set(dsl) - {"symbol", "timeframe", "template", "parameters", "risk_pct"}:
        raise PolicyError("Gebruik uitsluitend het declaratieve strategiecontract")
    if dsl.get("template") not in {"ema_crossover", "donchian_breakout"}:
        raise PolicyError("Onbekend strategietemplate")
    if dsl.get("symbol") not in {"BTC-USDT", "ETH-USDT", "SOL-USDT", "BTC-USDC", "ETH-USDC", "SOL-USDC"}:
        raise PolicyError("Fase 1 ondersteunt alleen geselecteerde OKX-spotparen")
    if dsl.get("timeframe") not in {"1h", "4h", "1d"}:
        raise PolicyError("Kies 1h, 4h of 1d")
    params = dsl.get("parameters", {})
    if not isinstance(params, dict) or set(params) - {"fast", "slow", "lookback", "stop_pct", "reward_ratio"}:
        raise PolicyError("Niet-ondersteunde parameters")
    out = {"fast": 20, "slow": 50, "lookback": 20, "stop_pct": 2.0, "reward_ratio": 2.0, **params}
    for k in ("fast", "slow", "lookback"):
        number(out[k], k, 2, 500)
        if not isinstance(out[k], int): raise PolicyError("Indicatorperioden moeten geheel zijn")
    if out["fast"] >= out["slow"]: raise PolicyError("Fast moet kleiner zijn dan slow")
    number(out["stop_pct"], "stop", .1, 20)
    number(out["reward_ratio"], "risk/reward", .1, 10)
    risk = number(dsl.get("risk_pct", .5), "risico per positie", .01, .5)
    return {"template": dsl["template"], "symbol": dsl["symbol"], "timeframe": dsl["timeframe"], "parameters": out, "risk_pct": risk}

@dataclass(frozen=True)
class Costs:
    taker_bps: float = 10
    maker_bps: float = 8
    spread_bps: float = 4
    slippage_bps: float = 5
    latency_bars: int = 1
    tick_size: float = .01
    lot_size: float = .00001
    minimum_quantity: float = .00001
    participation_pct: float = 1
    funding_bps_per_day: float = 0  # spot has no funding
    def __post_init__(self):
        for k in ("taker_bps", "maker_bps", "spread_bps", "slippage_bps"):
            number(getattr(self,k), k, 0, 1000)
        number(self.latency_bars, "latency", 1, 20)
        if not isinstance(self.latency_bars,int): raise PolicyError("Latency moet geheel zijn")
        for k in ("tick_size", "lot_size", "minimum_quantity"):
            number(getattr(self,k), k, 1e-12, 1e6)
        number(self.participation_pct, "participation", .01, 100)
        number(self.funding_bps_per_day, "funding", 0, 1000)

def candles_valid(rows, timeframe):
    if not isinstance(rows,list) or not 100 <= len(rows) <= 100000:
        raise PolicyError("Minimaal 100 en maximaal 100000 bevestigde candles nodig")
    step = {"1h":3600,"4h":14400,"1d":86400}[timeframe]
    previous = None
    for r in rows:
        if not isinstance(r,dict) or r.get("partial") or r.get("confirmed") is False:
            raise PolicyError("Alleen gesloten, bevestigde candles")
        number(r.get("time"), "tijd", 1, 1e12)
        if previous is not None and r["time"] - previous != step:
            raise PolicyError("Dubbele, ongeordende of ontbrekende candles")
        previous = r["time"]
        for k in ("open","high","low","close"): number(r.get(k),k,1e-12,1e12)
        if not r["low"] <= min(r["open"],r["close"]) <= max(r["open"],r["close"]) <= r["high"]:
            raise PolicyError("Ongeldige candle range")
        number(r.get("volume"), "volume", 0, 1e18)
    return rows

def signals(rows,dsl):
    p=dsl["parameters"]; fast=slow=None; out=[]
    for i,r in enumerate(rows):
        fast=r["close"] if fast is None else fast+(r["close"]-fast)*2/(p["fast"]+1)
        slow=r["close"] if slow is None else slow+(r["close"]-slow)*2/(p["slow"]+1)
        ready=i>=max(p["slow"],p["lookback"])
        if dsl["template"]=="ema_crossover": out.append(ready and fast>slow and r["close"]>slow)
        else: out.append(ready and r["close"]>max(x["high"] for x in rows[max(0,i-p["lookback"]):i]))
    return out

def backtest(rows,dsl,costs=Costs(),capital=10000):
    dsl=validate_strategy(dsl); candles_valid(rows,dsl["timeframe"]); number(capital,"capital",1,1e9)
    sig=signals(rows,dsl); balance=capital; position=None; trades=[]; curve=[]; peak=capital; drawdown=0
    friction=(costs.spread_bps/2+costs.slippage_bps)/10000
    fee=costs.taker_bps/10000
    def exit_pos(price,at,why):
        nonlocal balance,position
        actual=math.floor(price*(1-friction)/costs.tick_size)*costs.tick_size
        actual=max(costs.tick_size,actual)
        elapsed=max(0,at-position["time"])/86400
        funding=position["qty"]*position["entry"]*costs.funding_bps_per_day/10000*elapsed
        proceeds=position["qty"]*actual*(1-fee)-funding
        balance+=proceeds
        trades.append({"entry_time":position["time"],"exit_time":at,"quantity":position["qty"],"entry":position["entry"],"exit":actual,"net_pnl":proceeds-position["debit"],"fees":position["fee"]+position["qty"]*actual*fee,"funding":funding,"exit_reason":why})
        position=None
    for i,r in enumerate(rows):
        # Signal is from a prior closed bar. Entry cannot use this bar's close.
        if position is None and i>=costs.latency_bars and sig[i-costs.latency_bars] and not sig[max(0,i-costs.latency_bars-1)]:
            entry=math.ceil(r["open"]*(1+friction)/costs.tick_size)*costs.tick_size
            stop_distance=entry*dsl["parameters"]["stop_pct"]/100
            qty=min(balance*dsl["risk_pct"]/100/(stop_distance+entry*2*(fee+friction)),balance/(entry*(1+fee)),r["volume"]*costs.participation_pct/100)
            qty=math.floor(qty/costs.lot_size)*costs.lot_size
            if qty>=costs.minimum_quantity:
                debit=qty*entry*(1+fee); balance-=debit
                position={"entry":entry,"qty":qty,"time":r["time"],"stop":entry-stop_distance,"target":entry+stop_distance*dsl["parameters"]["reward_ratio"],"debit":debit,"fee":qty*entry*fee}
        if position:
            # Conservative when stop and target both occur in the same candle.
            if r["low"]<=position["stop"]: exit_pos(min(r["open"],position["stop"]),r["time"],"stop")
            elif r["high"]>=position["target"]: exit_pos(position["target"],r["time"],"target")
            elif i>=costs.latency_bars and not sig[i-costs.latency_bars]: exit_pos(r["open"],r["time"],"signal")
        equity=balance+(position["qty"]*r["close"] if position else 0)
        peak=max(peak,equity); drawdown=max(drawdown,(peak-equity)/peak*100)
        curve.append({"time":r["time"],"equity":round(equity,6)})
    if position: exit_pos(rows[-1]["close"],rows[-1]["time"],"end_of_dataset")
    curve[-1]["equity"]=round(balance,6)
    drawdown=max(drawdown,(peak-balance)/peak*100)
    pnl=[t["net_pnl"] for t in trades]
    return {"quote_currency":dsl["symbol"].rsplit("-",1)[1],"initial_capital":capital,"final_equity":round(balance,6),"net_pnl":round(balance-capital,6),"return_pct":round((balance/capital-1)*100,6),"max_drawdown_pct":round(drawdown,6),"closed_trades":len(trades),"net_expectancy":sum(pnl)/len(pnl) if pnl else None,"trades":trades,"equity_curve":curve,"costs":asdict(costs),"execution_model":"spot long only; next-bar open; taker orders; participation-capped fills; stop-first ambiguity","data_hash":digest(rows),"selection_criteria_not_profitability_proof":True}

def robustness(rows,dsl,costs=Costs()):
    dsl=validate_strategy(dsl); candles_valid(rows,dsl["timeframe"])
    # Holdout starts at 40%; each OOS window has fresh warmup entirely within its own range.
    cut=int(len(rows)*.4); width=(len(rows)-cut)//3
    if width<max(100,dsl["parameters"]["slow"]+10): raise PolicyError("Meer historie nodig voor drie OOS-vensters")
    windows=[]
    for i in range(3):
        subset=rows[cut+i*width:cut+(i+1)*width if i<2 else len(rows)]
        result=backtest(subset,dsl,costs)
        windows.append({"start":subset[0]["time"],"end":subset[-1]["time"],"data_hash":digest(subset),"net_pnl":result["net_pnl"],"closed_trades":result["closed_trades"],"max_drawdown_pct":result["max_drawdown_pct"]})
    doubled=Costs(**{**asdict(costs),"taker_bps":costs.taker_bps*2,"maker_bps":costs.maker_bps*2,"spread_bps":costs.spread_bps*2,"slippage_bps":costs.slippage_bps*2,"funding_bps_per_day":costs.funding_bps_per_day*2})
    holdout=backtest(rows[cut:],dsl,costs); stress=backtest(rows[cut:],dsl,doubled)
    sensitivities=[]
    for multiplier in (.8,1.2):
        variant={**dsl,"parameters":{**dsl["parameters"],"stop_pct":dsl["parameters"]["stop_pct"]*multiplier}}
        result=backtest(rows[cut:],variant,costs)
        sensitivities.append({"stop_multiplier":multiplier,"net_pnl":result["net_pnl"],"max_drawdown_pct":result["max_drawdown_pct"]})
    rng=random.Random(42); pnls=[t["net_pnl"] for t in holdout["trades"]]; monte=[]
    for _ in range(200):
        eq=10000; peak=eq; dd=0
        for _ in pnls:
            eq+=rng.choice(pnls); peak=max(peak,eq); dd=max(dd,(peak-eq)/peak*100)
        monte.append(dd)
    return {"windows":windows,"positive_windows":sum(w["net_pnl"]>0 for w in windows),"oos_net_pnl":holdout["net_pnl"],"double_costs_net_pnl":stress["net_pnl"],"sensitivities":sensitivities,"monte_carlo_drawdown_p95":sorted(monte)[189] if pnls else None,"monte_carlo_seed":42,"regime_analysis":"Niet gevalideerd; aparte regime-segmentatie vereist","selection_criteria_not_profitability_proof":True}

@dataclass(frozen=True)
class RiskLimits:
    risk_per_trade_pct: float=.5
    daily_loss_pct: float=2
    weekly_loss_pct: float=5
    drawdown_pct: float=10
    total_exposure_pct: float=30
    asset_exposure_pct: float=15
    correlated_exposure_pct: float=25
    open_positions: int=3
    leverage: float=1
    max_spread_bps: float=20
    max_slippage_bps: float=15
    max_age_seconds: float=15

def risk_decision(candidate,portfolio,market,limits=RiskLimits(),kill_switches=()):
    for k in ("entry","stop","requested_notional","risk_pct"):
        number(candidate.get(k),k,0,1e12)
    if candidate["entry"]<=0 or not 0<candidate["stop"]<candidate["entry"]: raise PolicyError("Stop moet onder entry liggen")
    # Reject non-finite, missing or nonsensical telemetry before any comparison.
    for k in ("daily_loss_pct","weekly_loss_pct","drawdown_pct","leverage","open_positions","cash","total_exposure","asset_exposure","correlated_exposure","equity"):
        value=portfolio.get(k)
        if isinstance(value,bool) or not isinstance(value,(int,float)) or not math.isfinite(value) or value<0:
            return {"allowed":False,"reasons":["INVALID_PORTFOLIO_TELEMETRY"],"approved_notional":0,"limits":asdict(limits)}
    for k in ("age_seconds","spread_bps","slippage_bps","available_notional"):
        value=market.get(k)
        if isinstance(value,bool) or not isinstance(value,(int,float)) or not math.isfinite(value) or value<0:
            return {"allowed":False,"reasons":["INVALID_MARKET_TELEMETRY"],"approved_notional":0,"limits":asdict(limits)}
    reasons=[]
    if kill_switches: reasons.append("KILL_SWITCH")
    if market.get("age_seconds",math.inf)<0 or market.get("age_seconds",math.inf)>limits.max_age_seconds: reasons.append("STALE_DATA")
    if market.get("exchange_healthy") is not True: reasons.append("EXCHANGE_HEALTH")
    if portfolio.get("reconciled") is not True: reasons.append("RECONCILIATION")
    if market.get("spread_bps",math.inf)>limits.max_spread_bps: reasons.append("SPREAD")
    if market.get("slippage_bps",math.inf)>limits.max_slippage_bps: reasons.append("SLIPPAGE")
    if market.get("available_notional",0)<candidate["requested_notional"]: reasons.append("LIQUIDITY")
    if candidate["risk_pct"]>limits.risk_per_trade_pct: reasons.append("RISK_PER_TRADE")
    if portfolio.get("daily_loss_pct",math.inf)>=limits.daily_loss_pct: reasons.append("DAILY_LOSS")
    if portfolio.get("weekly_loss_pct",math.inf)>=limits.weekly_loss_pct: reasons.append("WEEKLY_LOSS")
    if portfolio.get("drawdown_pct",math.inf)>=limits.drawdown_pct: reasons.append("DRAWDOWN")
    if portfolio.get("leverage",math.inf)>limits.leverage: reasons.append("LEVERAGE")
    if portfolio.get("open_positions",math.inf)>=limits.open_positions: reasons.append("POSITIONS")
    equity=portfolio.get("equity",0)
    if not isinstance(equity,(int,float)) or not math.isfinite(equity) or equity<=0: reasons.append("EQUITY"); equity=0
    distance=(candidate["entry"]-candidate["stop"])/candidate["entry"]
    sized=min(candidate["requested_notional"],equity*min(candidate["risk_pct"],limits.risk_per_trade_pct)/100/(distance+.004),portfolio.get("cash",0),max(0,equity*limits.total_exposure_pct/100-portfolio.get("total_exposure",math.inf)),max(0,equity*limits.asset_exposure_pct/100-portfolio.get("asset_exposure",math.inf)),max(0,equity*limits.correlated_exposure_pct/100-portfolio.get("correlated_exposure",math.inf)))
    if sized<=0: reasons.append("EXPOSURE_OR_CASH")
    return {"allowed":not reasons,"reasons":reasons,"approved_notional":round(max(0,sized),6) if not reasons else 0,"limits":asdict(limits)}

def promotion_reasons(target,evidence):
    if target not in {"VALIDATED","PAPER_EXPERIMENTAL","PAPER_MAIN","SHADOW"}:
        return ["HUMAN_APPROVAL_REQUIRED_OR_DISABLED"]
    reasons=[]
    if evidence.get("fixture") or not evidence.get("dataset_verified"): reasons.append("VERIFIED_REAL_DATA_REQUIRED")
    if evidence.get("critical_data_findings",0): reasons.append("CRITICAL_DATA_FINDINGS")
    if evidence.get("critical_review_findings",0): reasons.append("CRITICAL_REVIEW_FINDINGS")
    if evidence.get("independent_review") is not True: reasons.append("INDEPENDENT_REVIEW")
    if evidence.get("positive_windows",0)<2 or len(evidence.get("windows",[]))<3: reasons.append("OUT_OF_SAMPLE")
    if evidence.get("oos_net_pnl",-1)<=0: reasons.append("NET_RESULT")
    if evidence.get("double_costs_net_pnl",-1)<=0: reasons.append("DOUBLE_COSTS")
    if target in {"PAPER_MAIN","SHADOW"}:
        if evidence.get("forward_days",0)<30: reasons.append("FORWARD_DAYS")
        if evidence.get("paper_trades",0)<30: reasons.append("PAPER_TRADES")
        if evidence.get("paper_expectancy",-1)<=0: reasons.append("PAPER_EXPECTANCY")
        if evidence.get("paper_drawdown_pct",math.inf)>10: reasons.append("PAPER_DRAWDOWN")
    return reasons

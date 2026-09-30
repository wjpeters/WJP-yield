import math
import pytest
from services.trading.domain import *

def strategy(**parameters):
    return {"symbol":"BTC-USDT","timeframe":"1h","template":"ema_crossover","parameters":{"fast":5,"slow":15,**parameters},"risk_pct":.5}

def rows(n=1000):
    output=[]
    for i in range(n):
        price=100+math.sin(i/15)*5+i*.01
        output.append({"time":1700000000+i*3600,"open":price,"high":price+1,"low":price-1,"close":price+.1,"volume":1000,"confirmed":True})
    return output

def portfolio(): return {"daily_loss_pct":0,"weekly_loss_pct":0,"drawdown_pct":0,"leverage":1,"open_positions":0,"cash":10000,"total_exposure":0,"asset_exposure":0,"correlated_exposure":0,"equity":10000,"reconciled":True}
def market(): return {"age_seconds":1,"spread_bps":2,"slippage_bps":3,"available_notional":10000,"exchange_healthy":True}
def candidate(): return {"entry":100,"stop":98,"requested_notional":1000,"risk_pct":.5}

def test_whitelist_no_code_and_finite_inputs():
    with pytest.raises(PolicyError): validate_strategy({**strategy(),"code":"__import__('os')"})
    with pytest.raises(PolicyError): validate_strategy({**strategy(),"risk_pct":float('nan')})
    with pytest.raises(PolicyError): validate_strategy(strategy(fast=20,slow=10))
    with pytest.raises(PolicyError): Costs(taker_bps=float('inf'))

def test_data_integrity():
    source=rows(200)
    for mutation in ('gap','duplicate','partial','range','volume'):
        data=[dict(r) for r in source]
        if mutation=='gap':data[50]['time']+=3600
        if mutation=='duplicate':data[50]['time']=data[49]['time']
        if mutation=='partial':data[50]['partial']=True
        if mutation=='range':data[50]['low']=10000
        if mutation=='volume':data[50]['volume']=None
        with pytest.raises(PolicyError): backtest(data,strategy())

def test_no_future_data_changes_prior_signals_or_entries():
    a=rows(1000);b=[dict(r) for r in a]
    for r in b[800:]:
        for k in ('open','high','low','close'):r[k]*=3
    assert signals(a,validate_strategy(strategy()))[:800]==signals(b,validate_strategy(strategy()))[:800]
    ta=backtest(a,strategy())['trades'];tb=backtest(b,strategy())['trades']
    cutoff=a[799]['time']
    assert [t for t in ta if t['exit_time']<cutoff]==[t for t in tb if t['exit_time']<cutoff]

def test_execution_starts_after_prior_closed_bar():
    r=rows(200);result=backtest(r,strategy())
    sig=signals(r,validate_strategy(strategy()))
    for trade in result['trades']:
        i=next(i for i,c in enumerate(r) if c['time']==trade['entry_time'])
        assert i>=1 and sig[i-1] is True
        assert trade['entry']>=r[i]['open']
        assert trade['fees']>0
        assert trade['quantity']<=r[i]['volume']*.01

def test_cost_stress_and_reproducible_holdouts():
    r=rows();result=robustness(r,strategy());assert result==robustness(r,strategy())
    windows=result['windows'];assert len(windows)==3
    assert windows[0]['start']==r[400]['time']
    assert all(a['end']<b['start'] for a,b in zip(windows,windows[1:]))
    assert result['double_costs_net_pnl']<=result['oos_net_pnl']
    assert result['selection_criteria_not_profitability_proof'] is True

def test_missing_history_cannot_claim_oos():
    with pytest.raises(PolicyError): robustness(rows(300),strategy())

def test_zero_volume_has_no_fabricated_fills():
    r=rows(200)
    for x in r:x['volume']=0
    result=backtest(r,strategy());assert result['closed_trades']==0 and result['net_pnl']==0

@pytest.mark.parametrize('key',['daily_loss_pct','weekly_loss_pct','drawdown_pct','leverage','open_positions','cash','total_exposure','asset_exposure','correlated_exposure','equity'])
@pytest.mark.parametrize('bad',[float('nan'),float('inf'),True,-1,None])
def test_bad_portfolio_always_denies(key,bad):
    p=portfolio();p[key]=bad;decision=risk_decision(candidate(),p,market());assert decision['allowed'] is False

@pytest.mark.parametrize('key',['age_seconds','spread_bps','slippage_bps','available_notional'])
@pytest.mark.parametrize('bad',[float('nan'),float('inf'),True,-1,None])
def test_bad_market_always_denies(key,bad):
    m=market();m[key]=bad;assert risk_decision(candidate(),portfolio(),m)['allowed'] is False

def test_risk_sizing_and_switches():
    assert risk_decision(candidate(),portfolio(),market())['approved_notional']==1000
    assert risk_decision(candidate(),portfolio(),market(),kill_switches=['GLOBAL'])['allowed'] is False
    p=portfolio();p['daily_loss_pct']=2;assert 'DAILY_LOSS' in risk_decision(candidate(),p,market())['reasons']
    p=portfolio();p['total_exposure']=2900
    assert risk_decision(candidate(),p,market())['approved_notional']==100
    m=market();m['age_seconds']=16;assert 'STALE_DATA' in risk_decision(candidate(),portfolio(),m)['reasons']

def test_promotions_fail_without_evidence_and_live_is_disabled():
    assert 'VERIFIED_REAL_DATA_REQUIRED' in promotion_reasons('PAPER_EXPERIMENTAL',{})
    assert promotion_reasons('LIVE',{})==['HUMAN_APPROVAL_REQUIRED_OR_DISABLED']
    evidence={'dataset_verified':True,'independent_review':True,'positive_windows':2,'windows':[{}, {}, {}],'oos_net_pnl':5,'double_costs_net_pnl':1}
    assert promotion_reasons('PAPER_EXPERIMENTAL',evidence)==[]
    assert 'FORWARD_DAYS' in promotion_reasons('PAPER_MAIN',evidence)
    assert 'VERIFIED_REAL_DATA_REQUIRED' in promotion_reasons('PAPER_EXPERIMENTAL',{**evidence,'fixture':True})


@pytest.mark.parametrize("quote",["USDC","USDT"])
def test_backtest_capital_and_pnl_keep_market_quote_currency(quote):
    result=backtest(rows(200),{**strategy(),"symbol":"BTC-"+quote})
    assert result["quote_currency"]==quote
    assert result["final_equity"]==pytest.approx(result["initial_capital"]+result["net_pnl"],abs=1e-5)

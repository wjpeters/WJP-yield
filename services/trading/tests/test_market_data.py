import json
import httpx
import pytest
from services.trading.market_data import capture
from services.trading.domain import PolicyError

def test_exact_eea_instrument_and_bounded_pages():
    calls=[]
    def respond(req):
        calls.append(req)
        if req.url.path.endswith('instruments'):
            return httpx.Response(200,json={'code':'0','data':[{'instId':'BTC-USDC','instType':'SPOT','state':'live','baseCcy':'BTC','quoteCcy':'USDC','tickSz':'.1','lotSz':'.00001','minSz':'.00001'}]})
        after=req.url.params.get('after');end=int(after)//1000-3600 if after else 1700000000
        return httpx.Response(200,json={'code':'0','data':[[str((end-i*3600)*1000),'100','101','99','100','1000','100000','100000','1'] for i in range(300)]})
    with httpx.Client(transport=httpx.MockTransport(respond)) as client:result=capture(client,'BTC-USDC','1h')
    assert len(calls)==5 and len(result['candles'])==1000
    assert all(req.url.host=='eea.okx.com' for req in calls)
    assert result['quote_currency']=='USDC'
    assert all(a['time']<b['time'] for a,b in zip(result['candles'],result['candles'][1:]))

def test_no_quote_substitution_or_derivatives():
    def respond(req):return httpx.Response(200,json={'code':'0','data':[{'instId':'BTC-USDT','instType':'SWAP','state':'live','baseCcy':'BTC','quoteCcy':'USDT'}]})
    with httpx.Client(transport=httpx.MockTransport(respond)) as client:
        with pytest.raises(PolicyError):capture(client,'BTC-USDC','1h')
        with pytest.raises(PolicyError):capture(client,'BTC-USDT','1h')
        with pytest.raises(PolicyError):capture(client,'BTC-USDT','1h','arbitrary')

def test_repeated_history_page_is_rejected():
    def respond(req):
        if req.url.path.endswith('instruments'):return httpx.Response(200,json={'code':'0','data':[{'instId':'BTC-USDC','instType':'SPOT','state':'live','baseCcy':'BTC','quoteCcy':'USDC'}]})
        return httpx.Response(200,json={'code':'0','data':[[str((1700000000-i*3600)*1000),'100','101','99','100','1000','1','1','1'] for i in range(300)]})
    with httpx.Client(transport=httpx.MockTransport(respond)) as client:
        with pytest.raises(PolicyError):capture(client,'BTC-USDC','1h')

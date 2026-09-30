import asyncio
import json
import httpx
import pytest
from services.trading.jev import JevProvider,JevUnavailable,Reservation
from services.trading.domain import PolicyError
Q={'risk_event':{'type':'noul','instructions':'Does the supplied source mention an outage?'}}
def permit():return Reservation('fixture-reservation',4000,.01,100)
def valid(v=.9):return {'model':'jev-1.13.0','answers':{'risk_event':{'type':'noul','noul':v}},'usage':{'input_tokens':50,'output_tokens':4}}
def run(p,questions=Q):return asyncio.run(p.evaluate({'source':'Explicit fixture'},questions,permit()))
def test_disabled_never_calls_or_opens_secrets():
    def transport(request):pytest.fail('Disabled provider must not perform I/O')
    with pytest.raises(JevUnavailable):run(JevProvider(transport=httpx.MockTransport(transport)))
    p=JevProvider.from_secret_files('/nonexistent-primary','/nonexistent-fallback',enabled=False)
    assert p.enabled is False

def test_primary_and_typed_uncertainty():
    calls=[]
    def transport(req):calls.append(req);return httpx.Response(200,json=valid(.5))
    result=run(JevProvider('fixture-primary','fixture-backup',True,transport=httpx.MockTransport(transport),clock=lambda:1))
    assert len(calls)==1 and str(calls[0].url)=='https://api.typesafe.ai/v1/systemone'
    assert result['requires_confidence_review'] is True
    assert result['cost_cap_enforced_by_budget_gateway'] is False
    assert result['gateway_integration_required'] is True

def test_transient_failover_preserves_request_contract():
    calls=[]
    def transport(req):
        calls.append(req)
        return httpx.Response(529) if len(calls)==1 else httpx.Response(200,json=valid())
    result=run(JevProvider('fixture-primary','fixture-backup',True,transport=httpx.MockTransport(transport),clock=lambda:1))
    assert result['provider']=='openrouter'
    assert str(calls[1].url)=='https://openrouter.ai/api/v1/systemone'
    assert json.loads(calls[0].content)==json.loads(calls[1].content)
    assert calls[0].headers['authorization']!=calls[1].headers['authorization']
    assert all('fixture-primary' not in json.dumps(a) for a in result['attempts'])

def test_auth_error_not_silently_billed_to_fallback():
    calls=[]
    def transport(req):calls.append(req);return httpx.Response(401)
    with pytest.raises(PolicyError):run(JevProvider('fixture-primary','fixture-backup',True,transport=httpx.MockTransport(transport),clock=lambda:1))
    assert len(calls)==1

def test_both_fail_and_nan_answer_fail_closed():
    def transport(req):return httpx.Response(200,json=valid(None))
    with pytest.raises(JevUnavailable):run(JevProvider('fixture-primary','fixture-backup',True,transport=httpx.MockTransport(transport),clock=lambda:1))

def test_expired_or_tiny_reservation_never_calls():
    def transport(request):pytest.fail('No request without valid reservation')
    p=JevProvider('fixture-primary',enabled=True,transport=httpx.MockTransport(transport),clock=lambda:200)
    with pytest.raises(JevUnavailable):run(p)
    p.clock=lambda:1
    with pytest.raises(JevUnavailable):asyncio.run(p.evaluate('input',Q,Reservation('fixture',1,.01,100)))

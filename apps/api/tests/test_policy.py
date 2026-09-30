import pytest
from services.firm.config import Config
from services.firm.policy import child_permissions,budget_fits,report_validate,PolicyError,DIMENSIONS
from services.firm.providers import MockProvider,provider


def test_child_permissions_intersection_and_forbidden():
    assert child_permissions(['market.read','shell','exchange.order'],['market.read','shell','secret.read'])==['market.read']


def test_all_budget_dimensions_are_hard_limits():
    limits=dict.fromkeys(DIMENSIONS,10); used=dict.fromkeys(DIMENSIONS,5); reserved=dict.fromkeys(DIMENSIONS,3)
    assert budget_fits(limits,used,reserved,dict.fromkeys(DIMENSIONS,2))
    for dimension in DIMENSIONS:
        requested=dict.fromkeys(DIMENSIONS,2); requested[dimension]=2.01
        assert not budget_fits(limits,used,reserved,requested)


def test_config_production_fails_closed_and_separate_db():
    with pytest.raises(ValueError): Config(environment='production',auth_token='').validate()
    with pytest.raises(ValueError): Config(environment='production',auth_token='x'*32,allowed_origin='https://firm.example',database_url='postgresql://wjp_api@db/wjp_local').validate()
    with pytest.raises(ValueError): Config(environment='production',auth_token='x'*32,allowed_origin='https://firm.example',database_url='postgresql://postgres@db/wjp_prod').validate()


def test_unconfigured_ai_never_claims_success():
    for name in ['disabled','codex','jef_typesafe','openrouter']:
        p=provider(name); assert not p.available
        with pytest.raises(RuntimeError): p.execute({}, {}, {})


def test_mock_requires_fixture_and_has_truthful_provenance():
    p=MockProvider()
    with pytest.raises(RuntimeError): p.execute({}, {}, {})
    result=p.execute({'fixture':True},{},{})
    assert result.provider=='mock'; assert result.usage['eur']==0
    assert result.report['sources'][0]['synthetic']; report_validate(result.report)
    with pytest.raises(PolicyError): report_validate(dict(result.report,hidden_reasoning='forbidden'))

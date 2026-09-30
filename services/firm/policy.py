from decimal import Decimal

FORBIDDEN = {"shell", "host.root", "exchange.order", "secret.read", "policy.write", "strategy.promote", "bot.live"}
ENV_PERMISSIONS = {"market.read", "funding.read", "open_interest.read", "journal.read", "journal.write", "research.write", "tasks.read", "tasks.write", "agent.spawn", "review.write", "budget.read"}
BASE = {"journal.read", "journal.write", "research.write", "tasks.read", "tasks.write", "agent.spawn", "budget.read"}
ROLES = [
    ("cio", "CIO / Firm Manager", "Management", None, True),
    ("market-intelligence", "Market Intelligence", "Market Intelligence", "cio", False),
    ("us-equities-analyst", "US Equities Analyst", "US Equities", "cio", False),
    ("crypto-analyst", "Crypto Analyst", "Crypto", "cio", True),
    ("quant-researcher", "Quant Researcher", "Quant", "cio", True),
    ("portfolio-manager", "Portfolio Manager", "Portfolio", "cio", False),
    ("risk-officer", "Risk Officer", "Risk", "cio", False),
    ("independent-reviewer", "Independent Reviewer", "Independent Review", None, True),
]
TEMPLATES = {
    "crypto_derivatives_specialist": {"parents": ["crypto-analyst"], "permissions": BASE | {"market.read", "funding.read", "open_interest.read"}},
    "funding_specialist": {"parents": ["crypto-analyst"], "permissions": BASE | {"market.read", "funding.read"}},
    "source_verification": {"parents": ["market-intelligence", "crypto-analyst", "cio"], "permissions": BASE | {"market.read"}},
    "backtest_specialist": {"parents": ["quant-researcher"], "permissions": BASE | {"market.read"}},
    "replication_analyst": {"parents": ["independent-reviewer"], "permissions": BASE | {"market.read", "review.write"}},
    "planning_specialist": {"parents": ["cio"], "permissions": BASE},
}
DIMENSIONS = ("eur", "tokens", "runtime_seconds", "api_requests", "tasks", "runs")
ORG_LIMIT = {"eur": 200, "tokens": 1000000, "runtime_seconds": 18000, "api_requests": 2000, "tasks": 1000, "runs": 1000}
DEPARTMENT_LIMIT = {"eur": 50, "tokens": 250000, "runtime_seconds": 7200, "api_requests": 500, "tasks": 250, "runs": 250}


class PolicyError(Exception):
    def __init__(self, message, status=409):
        self.message, self.status = message, status
        super().__init__(message)


def child_permissions(parent, template):
    return sorted(set(parent) & set(template) & ENV_PERMISSIONS - FORBIDDEN)


def budget_fits(limit, used, reserved, requested):
    return all(Decimal(str(used.get(k, 0))) + Decimal(str(reserved.get(k, 0))) + Decimal(str(requested.get(k, 0))) <= Decimal(str(limit.get(k, 0))) for k in DIMENSIONS)


def report_validate(report):
    required = {"facts", "hypotheses", "counterevidence", "conclusions", "uncertainties", "sources", "data_used", "next_questions"}
    if required - set(report):
        raise PolicyError("Report missing sections: " + ", ".join(sorted(required - set(report))), 422)
    def forbidden_field(value):
        if isinstance(value,dict):
            return any('chain_of_thought' in str(k).lower() or 'hidden_reasoning' in str(k).lower() or forbidden_field(v) for k,v in value.items())
        if isinstance(value,list): return any(forbidden_field(v) for v in value)
        return False
    if forbidden_field(report):
        raise PolicyError("Persist decision summaries and evidence only", 422)
    if not isinstance(report['sources'],list) or not report["sources"]:
        raise PolicyError("Report needs source provenance, including an explicit fixture source for mocks", 422)
    if any(not isinstance(s,dict) or not s.get('source') or not s.get('provider') for s in report['sources']):
        raise PolicyError('Sources require source and provider fields',422)
    for key in required - {'data_used'}:
        if not isinstance(report[key],list): raise PolicyError('Report '+key+' must be a list',422)
    if not isinstance(report['data_used'],dict): raise PolicyError('data_used must identify dataset/version/range',422)
    return report

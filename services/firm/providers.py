"""No provider can invoke shells, credentials, or exchange endpoints."""
from dataclasses import dataclass
from typing import Protocol
from datetime import datetime,timezone


@dataclass
class Result:
    report: dict
    usage: dict
    provider: str
    model: str


class AIProvider(Protocol):
    name: str
    available: bool
    def execute(self, task: dict, context: dict, ceilings: dict) -> Result: ...


class UnconfiguredProvider:
    available = False
    def __init__(self, name):
        self.name = name
    def execute(self, task, context, ceilings):
        raise RuntimeError(f"{self.name} requires a bounded gateway and explicit human configuration")


class CodexProvider(UnconfiguredProvider):
    def __init__(self): super().__init__("codex")


class JevProvider(UnconfiguredProvider):
    def __init__(self): super().__init__("jef_typesafe")


class OpenRouterProvider(UnconfiguredProvider):
    def __init__(self): super().__init__("openrouter")


class MockProvider:
    name = "mock"
    available = True
    def execute(self, task, context, ceilings):
        if not task.get("fixture"):
            raise RuntimeError("Mock runs require explicit fixture provenance")
        report = {"facts": ["Synthetic fixture only; no live market claims."],
                  "hypotheses": ["Investigate funding and volatility relationship."],
                  "counterevidence": ["Fixture cannot establish statistical significance or profitability."],
                  "conclusions": ["Research workflow verified; trading recommendation withheld."],
                  "uncertainties": ["Real provider and market evidence not configured."],
                  "sources": [{"source": "wjp-fixture://funding-volatility-v1", "provider": "mock", "synthetic": True,"source_timestamp":None,"retrieved_timestamp":datetime.now(timezone.utc).isoformat()}],
                  "data_used": {"dataset_id": "funding-volatility-fixture-v1", "dataset_version": 1, "synthetic": True,"start":None,"end":None},
                  "next_questions": ["Collect licensed market observations and independent replication."],
                  "decision_summary": "Demonstration of organizational traceability, not AI research."}
        return Result(report, {"eur": 0, "tokens": 0, "runtime_seconds": 0, "api_requests": 0, "tasks": 1, "runs": 1}, "mock", "deterministic-fixture-v1")


def provider(name):
    return {"mock": MockProvider, "codex": CodexProvider, "jev": JevProvider,
            "jef_typesafe": JevProvider, "openrouter": OpenRouterProvider}.get(name, lambda: UnconfiguredProvider(name))()

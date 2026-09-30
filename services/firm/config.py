import os
import math
from dataclasses import dataclass, field
from urllib.parse import urlparse


@dataclass(frozen=True)
class Config:
    database_url: str = field(default_factory=lambda: os.getenv("WJP_DATABASE_URL", "postgresql://wjp_api@postgres:5432/wjp_local"))
    environment: str = field(default_factory=lambda: os.getenv("WJP_ENV", "local"))
    organization: str = field(default_factory=lambda: os.getenv("WJP_ORG_ID", "wjp-yield"))
    redis_url: str = field(default_factory=lambda: os.getenv("WJP_REDIS_URL", "redis://redis:6379/0"))
    provider: str = field(default_factory=lambda: os.getenv("WJP_PROVIDER", "disabled"))
    auth_token: str = field(default_factory=lambda: os.getenv("WJP_AUTH_TOKEN", ""))
    allowed_origin: str = field(default_factory=lambda: os.getenv("WJP_ALLOWED_ORIGIN", "http://localhost:4311"))
    max_temporary: int = field(default_factory=lambda: int(os.getenv("WJP_MAX_TEMPORARY_AGENTS", "4")))
    max_runs: int = field(default_factory=lambda: int(os.getenv("WJP_MAX_CONCURRENT_RUNS", "2")))
    max_depth: int = field(default_factory=lambda: int(os.getenv("WJP_MAX_DELEGATION_DEPTH", "3")))
    max_children: int = field(default_factory=lambda: int(os.getenv("WJP_MAX_CHILD_TASKS", "10")))
    max_cost_per_task: float = field(default_factory=lambda: float(os.getenv("WJP_MAX_COST_PER_TASK_EUR", "2")))
    max_runs_per_hour: int = field(default_factory=lambda: int(os.getenv("WJP_MAX_RUNS_PER_HOUR", "4")))
    max_tokens_per_task: int = field(default_factory=lambda: int(os.getenv("WJP_MAX_TOKENS_PER_TASK", "4000")))
    max_runtime_per_task: int = field(default_factory=lambda: int(os.getenv("WJP_MAX_RUNTIME_PER_TASK", "60")))
    max_api_per_task: int = field(default_factory=lambda: int(os.getenv("WJP_MAX_API_PER_TASK", "4")))

    @property
    def organization_id(self): return self.organization

    @property
    def environment_id(self): return self.environment

    def validate(self):
        if self.environment not in {"local", "production", "test"}:
            raise ValueError("Unknown WJP_ENV")
        integer_limits=(self.max_temporary,self.max_runs,self.max_depth,self.max_children,self.max_runs_per_hour,self.max_tokens_per_task,self.max_runtime_per_task,self.max_api_per_task)
        if any(isinstance(v,bool) or not isinstance(v,int) or v<1 for v in integer_limits):
            raise ValueError("Organization and executor limits must be positive integers")
        if isinstance(self.max_cost_per_task,bool) or not isinstance(self.max_cost_per_task,(int,float)) or not math.isfinite(self.max_cost_per_task) or self.max_cost_per_task<=0:
            raise ValueError("Task cost ceiling must be finite and positive")
        if self.environment == "production":
            if len(self.auth_token) < 32 or not self.allowed_origin.startswith("https://"):
                raise ValueError("Production requires a strong auth token and HTTPS allowed origin")
            url=urlparse(self.database_url)
            if url.username!='wjp_api' or url.path in {'/wjp_local','/postgres',''}:
                raise ValueError("Production requires a separate database and restricted wjp_api identity")
            if os.getenv("WJP_DATABASE_ADMIN_URL"):
                raise ValueError("Migration credentials must not be exposed to runtime")
        if self.environment != "local" and self.provider == "mock":
            raise ValueError("Mock executor is local-only")
        return self

    def public(self):
        return {"environment": self.environment, "organization": self.organization,
                "provider": self.provider, "provider_status": "explicit_mock" if self.provider == "mock" else "waiting_configuration",
                "max_temporary_agents": self.max_temporary, "max_concurrent_runs": self.max_runs,
                "max_delegation_depth": self.max_depth, "max_children_per_task": self.max_children,
                "max_cost_per_task_eur":self.max_cost_per_task,"max_department_runs_per_hour":self.max_runs_per_hour,
                "trading_mode": os.getenv("WJP_TRADING_MODE", "paper"), "live_execution_enabled": False,
                "agent_host_access": False, "paid_provider_enabled": False,
                "provider_preferences": ["jef_typesafe", "openrouter", "codex"],
                "human_approval_required": ["application_code", "production_infrastructure", "production_permissions", "secrets", "paid_subscriptions", "risk_limits", "promotion_policy", "live_execution"]}

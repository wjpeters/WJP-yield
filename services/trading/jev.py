"""TypeSafe System One first, compatible OpenRouter System One fallback.

An isolated adapter; activation requires secret mounts AND a budget reservation.
No order methods. Low-confidence decisions are returned for review, not retried.
"""
from dataclasses import dataclass
from pathlib import Path
import math
import time
import uuid
import httpx
from .domain import canonical, digest, PolicyError

@dataclass(frozen=True)
class Reservation:
    id: str
    max_input_tokens: int
    max_cost_eur: float
    expires_at: float

class JevUnavailable(RuntimeError): pass

class JevProvider:
    def __init__(self, primary_key=None, fallback_key=None, enabled=False, model="jev-1.13", transport=None, clock=time.time):
        self.primary_key=primary_key; self.fallback_key=fallback_key; self.enabled=enabled; self.model=model
        self.transport=transport; self.clock=clock; self.failures=0; self.open_until=0
    @classmethod
    def from_secret_files(cls, primary_file, fallback_file, enabled=False):
        # Disabled must never open secret files. Paths supplied by trusted startup config only.
        if not enabled: return cls()
        def read(path):
            if not path: return None
            p=Path(path)
            if not p.is_absolute() or str(p).startswith("/Users/wp/Library/Mobile Documents/"):
                raise PolicyError("Sleutelpad moet buiten iCloud liggen")
            return p.read_text().strip()
        return cls(read(primary_file),read(fallback_file),True)
    def validate(self,data,questions):
        if not isinstance(data,dict) or not isinstance(data.get("model"),str): raise JevUnavailable("Ongeldig modelcontract")
        answers=data.get("answers")
        if not isinstance(answers,dict) or set(answers)!=set(questions): raise JevUnavailable("Onvolledig antwoordcontract")
        def probability(v): return isinstance(v,(int,float)) and not isinstance(v,bool) and math.isfinite(v) and 0<=v<=1
        for key,q in questions.items():
            a=answers[key]
            if not isinstance(a,dict) or a.get("type")!=q["type"]: raise JevUnavailable("Antwoordtype verschilt van vraagtype")
            if q["type"]=="noul":
                if not probability(a.get("noul")): raise JevUnavailable("Ongeldige Noul")
            else:
                probs=a.get("probabilities",{})
                keys=set(q["criteria"]) if q["type"]=="choice" else {str(i) for i in range(len(q["criteria"]))}
                if not isinstance(probs,dict) or set(probs)!=keys or not all(probability(v) for v in probs.values()) or abs(sum(probs.values())-1)>.01 or not probability(a.get("confidence")):
                    raise JevUnavailable("Ongeldige kansverdeling")
                if q["type"]=="choice" and a.get("choice") not in keys: raise JevUnavailable("Onbekende keuze")
                if q["type"]=="score":
                    score=a.get("score")
                    if isinstance(score,bool) or not isinstance(score,(int,float)) or not math.isfinite(score) or not 0<=score<len(keys): raise JevUnavailable("Ongeldige score")
        usage=data.get("usage",{})
        if not isinstance(usage,dict) or any(not isinstance(usage.get(k),int) or isinstance(usage.get(k),bool) or usage[k]<0 for k in ("input_tokens","output_tokens")):
            raise JevUnavailable("Ontbrekende tokenadministratie")
        return data
    async def evaluate(self,state,questions,reservation:Reservation):
        if not self.enabled or not self.primary_key: raise JevUnavailable("Jev is nog niet geactiveerd")
        if not isinstance(reservation,Reservation) or reservation.expires_at<=self.clock() or reservation.max_cost_eur<=0: raise JevUnavailable("Geldige budgetreservering vereist")
        if not isinstance(questions,dict) or not 1<=len(questions)<=32: raise PolicyError("Maximaal 32 gerichte vragen")
        for q in questions.values():
            if not isinstance(q,dict) or q.get("type") not in {"noul","choice","score"} or not q.get("instructions"): raise PolicyError("Ongeldige vraag")
            if q["type"]=="choice" and (not isinstance(q.get("criteria"),dict) or not 2<=len(q["criteria"])<=255): raise PolicyError("Ongeldige Choice-criteria")
            if q["type"]=="score" and (not isinstance(q.get("criteria"),list) or not 2<=len(q["criteria"])<=10): raise PolicyError("Ongeldige Score-criteria")
        body={"model":self.model,"state":state,"questions":questions}
        # UTF-8 byte count is a conservative token upper bound, includes questions.
        size=len(canonical(body).encode())+256
        if size>reservation.max_input_tokens or size>32000: raise JevUnavailable("Invoer overschrijdt gereserveerd tokenbudget")
        request_id=str(uuid.uuid4()); attempts=[]
        routes=[("typesafe","https://api.typesafe.ai/v1/systemone",self.primary_key),("openrouter","https://openrouter.ai/api/v1/systemone",self.fallback_key)]
        async with httpx.AsyncClient(transport=self.transport,timeout=httpx.Timeout(8,connect=3),follow_redirects=False) as client:
            for provider,url,key in routes:
                if not key: continue
                if reservation.expires_at<=self.clock(): raise JevUnavailable("Budgetreservering verlopen")
                if provider=="typesafe" and self.clock()<self.open_until:
                    attempts.append({"provider":provider,"status":"circuit_open"}); continue
                try:
                    response=await client.post(url,json=body,headers={"Authorization":"Bearer "+key})
                    if response.status_code in {401,403,400,422}:
                        # Invalid credentials or requests require owner intervention, not hidden spend.
                        raise PolicyError("Jev-configuratie of verzoek vereist controle")
                    if response.status_code==429 or response.status_code>=500:
                        attempts.append({"provider":provider,"status":"temporary_failure","http_status":response.status_code})
                        if provider=="typesafe": self.failures+=1
                        continue
                    response.raise_for_status()
                    data=self.validate(response.json(),questions)
                except (httpx.HTTPError,ValueError,JevUnavailable) as exc:
                    if isinstance(exc,PolicyError): raise
                    attempts.append({"provider":provider,"status":"transport_or_contract_failure"})
                    if provider=="typesafe": self.failures+=1
                    continue
                if provider=="typesafe": self.failures=0; self.open_until=0
                attempts.append({"provider":provider,"status":"ok"})
                return {"request_id":request_id,"reservation_id":reservation.id,"input_hash":digest(body),"provider":provider,"model":data["model"],"answers":data["answers"],"usage":data["usage"],"attempts":attempts,"requires_confidence_review":any((.2<a.get("noul",0)<.8) if a["type"]=="noul" else a.get("confidence",0)<.8 for a in data["answers"].values()),"usage_reconciliation_required":True,"cost_cap_enforced_by_budget_gateway":False,"gateway_integration_required":True}
        if self.failures>=3: self.open_until=self.clock()+60
        raise JevUnavailable("Beide Jev-routes onbeschikbaar; geen nieuwe AI-afhankelijke entries")

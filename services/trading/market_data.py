"""Bounded public OKX spot capture with instrument and candle provenance."""
import httpx
from .domain import PolicyError,candles_valid
HOSTS={"eea":"https://eea.okx.com","global":"https://www.okx.com"}
def capture(client,symbol,timeframe,region="eea"):
    if region not in HOSTS:raise PolicyError("Onbekende publieke OKX-regio")
    base=HOSTS[region];bar={"1h":"1H","4h":"4H","1d":"1Dutc"}[timeframe]
    r=client.get(base+"/api/v5/public/instruments",params={"instType":"SPOT","instId":symbol});r.raise_for_status();body=r.json()
    instruments=body.get("data",[]) if body.get("code")=="0" else []
    matches=[i for i in instruments if i.get("instId")==symbol and i.get("instType")=="SPOT" and i.get("state")=="live" and i.get("baseCcy")+"-"+i.get("quoteCcy")==symbol]
    if len(matches)!=1:raise PolicyError("Dit spotpaar is niet beschikbaar in het gekozen OKX-regioregister")
    raw=[];after=None
    for _ in range(4):
        params={"instId":symbol,"bar":bar,"limit":300}
        if after is not None:params["after"]=after
        r=client.get(base+"/api/v5/market/history-candles",params=params);r.raise_for_status();body=r.json()
        if body.get("code")!="0" or not isinstance(body.get("data"),list):raise PolicyError("Ongeldig OKX-historiecontract")
        page=body["data"]
        if not page:break
        oldest=min(int(x[0]) for x in page)
        if after is not None and oldest>=int(after):raise PolicyError("OKX-paginering herhaalde een datavenster")
        raw.extend(page);after=str(oldest)
        if len(raw)>=1000 or len(page)<300:break
    by_time={}
    for x in raw:
        if len(x)<9:raise PolicyError("Ongeldige OKX-candle")
        if x[8]!="1":continue
        row={"time":int(x[0])//1000,"open":float(x[1]),"high":float(x[2]),"low":float(x[3]),"close":float(x[4]),"volume":float(x[5]),"confirmed":True}
        if row["time"] in by_time and by_time[row["time"]]!=row:raise PolicyError("Conflicterende candle bij datasetcapture")
        by_time[row["time"]]=row
    rows=sorted(by_time.values(),key=lambda r:r["time"])[-1000:]
    candles_valid(rows,timeframe)
    return {"candles":rows,"source":base+"/api/v5/market/history-candles","instrument_source":base+"/api/v5/public/instruments","instrument":matches[0],"region":region,"quote_currency":matches[0]["quoteCcy"]}

from contextlib import contextmanager
from datetime import datetime, timezone
from uuid import uuid4
import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from .policy import PolicyError


def now(): return datetime.now(timezone.utc).isoformat()
def ident(prefix): return prefix + '-' + str(uuid4())[:12]


class Store:
    def __init__(self, config): self.config = config

    @contextmanager
    def transaction(self):
        with psycopg.connect(self.config.database_url, row_factory=dict_row, connect_timeout=5) as conn:
            conn.execute("SELECT set_config('wjp.environment',%s,true), set_config('wjp.organization',%s,true)", (self.config.environment, self.config.organization))
            conn.execute("SET LOCAL statement_timeout = '10s'")
            yield Tx(conn, self.config)


class Tx:
    def __init__(self, conn, config): self.conn, self.config = conn, config

    def lock(self, name):
        self.conn.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s,0))", (self.config.environment + ':' + self.config.organization + ':' + name,))

    def get(self, kind, id, lock=False):
        row = self.conn.execute("SELECT data FROM firm_entities WHERE environment=%s AND organization=%s AND kind=%s AND id=%s" + (" FOR UPDATE" if lock else ""), (self.config.environment, self.config.organization, kind, id)).fetchone()
        return row['data'] if row else None

    def require(self, kind, id, lock=False):
        row = self.get(kind, id, lock)
        if row is None: raise PolicyError(f"Unknown {kind}: {id}", 404)
        return row

    def list(self, kind):
        return [r['data'] for r in self.conn.execute("SELECT data FROM firm_entities WHERE environment=%s AND organization=%s AND kind=%s ORDER BY id", (self.config.environment, self.config.organization, kind)).fetchall()]

    def find_dedup(self, kind, key):
        row = self.conn.execute("SELECT data FROM firm_entities WHERE environment=%s AND organization=%s AND kind=%s AND data->>'idempotency_key'=%s", (self.config.environment,self.config.organization,kind,key)).fetchone()
        return row['data'] if row else None

    def put(self, kind, id, data):
        data = dict(data, id=id, environment=self.config.environment, organization=self.config.organization)
        self.conn.execute("INSERT INTO firm_entities(environment,organization,kind,id,data) VALUES(%s,%s,%s,%s,%s) ON CONFLICT(environment,organization,kind,id) DO UPDATE SET data=EXCLUDED.data,version=firm_entities.version+1", (self.config.environment,self.config.organization,kind,id,Jsonb(data)))
        return data

    def journal(self, event_type, actor='owner', payload=None, task_id=None, goal_id=None, event_id=None, strategy_id=None, category='agent', actor_type=None, **refs):
        entry = dict(event_type=event_type,actor=actor,actor_id=actor,actor_type=actor_type or ('human' if actor=='owner' else 'system' if actor.startswith('software:') or actor=='scheduler' else 'agent'),
                     category=category,payload=payload or {},task_id=task_id,goal_id=goal_id,event_id=event_id,strategy_id=strategy_id,**refs)
        return self.conn.execute("SELECT * FROM firm_append(%s)", (Jsonb(entry),)).fetchone()

    def journal_entries(self, view=None, actor=None, strategy_id=None, event_id=None, limit=300):
        sql = "SELECT * FROM firm_ledger WHERE environment=%s AND organization=%s"
        args = [self.config.environment,self.config.organization]
        for name,value in [('category',view),('actor',actor),('strategy_id',strategy_id),('event_id',event_id)]:
            if value and value != 'all':
                sql += " AND entry->>%s=%s"; args.extend([name,value])
        sql += " ORDER BY seq DESC LIMIT %s"; args.append(min(max(limit,1),1000))
        return [dict(r['entry'],seq=r['seq'],previous_hash=r['previous_hash'],entry_hash=r['entry_hash']) for r in self.conn.execute(sql,args).fetchall()]

    def verify_journal(self):
        rows = self.conn.execute("SELECT seq,previous_hash,entry_hash,encode(digest(previous_hash || entry::text,'sha256'),'hex') AS computed FROM firm_ledger WHERE environment=%s AND organization=%s ORDER BY seq", (self.config.environment,self.config.organization)).fetchall()
        previous = '0'*64
        for row in rows:
            if row['previous_hash'] != previous or row['entry_hash'] != row['computed']:
                return {"valid":False,"entries":len(rows),"failed_sequence":row['seq']}
            previous = row['entry_hash']
        return {"valid":True,"entries":len(rows),"head_hash":previous,"protection":"runtime append-only grants + database mutation triggers"}

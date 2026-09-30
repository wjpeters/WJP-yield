"""PostgreSQL lease with fencing, bounded reservations and no host execution."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone, timedelta
import time
from threading import Event
from uuid import uuid4

from .organization import Organization
from .providers import provider, MockProvider
from .policy import PolicyError
from .store import ident, now


class Scheduler:
    def __init__(self, organization):
        self.org=organization; self.store=organization.store; self.config=organization.config
        self.owner=str(uuid4()); self.pool=ThreadPoolExecutor(max_workers=self.config.max_runs,thread_name_prefix='wjp-research')

    def _lease(self,tx):
        row=tx.conn.execute("SELECT * FROM firm_leases WHERE environment=%s AND organization=%s AND name='scheduler' FOR UPDATE", (self.config.environment,self.config.organization)).fetchone()
        now_dt=datetime.now(timezone.utc)
        if row and row['owner']!=self.owner and row['expires_at']>now_dt: return None
        fence=(row['fence'] if row and row['owner']==self.owner and row['expires_at']>now_dt else (row['fence']+1 if row else 1))
        tx.conn.execute("INSERT INTO firm_leases(environment,organization,name,owner,fence,expires_at) VALUES(%s,%s,'scheduler',%s,%s,%s) ON CONFLICT(environment,organization,name) DO UPDATE SET owner=EXCLUDED.owner,fence=EXCLUDED.fence,expires_at=EXCLUDED.expires_at", (self.config.environment,self.config.organization,self.owner,fence,now_dt+timedelta(seconds=30)))
        if not row or row['fence']!=fence:
            tx.journal('SCHEDULER_LEASE_ACQUIRED',actor='scheduler',payload={'owner':self.owner,'fence':fence},category='operations')
        return fence

    def _valid_fence(self,tx,run):
        row=tx.conn.execute("SELECT owner,fence,expires_at FROM firm_leases WHERE environment=%s AND organization=%s AND name='scheduler'", (self.config.environment,self.config.organization)).fetchone()
        return row and row['owner']==run['scheduler_owner'] and row['fence']==run['fence'] and row['expires_at']>datetime.now(timezone.utc)

    def _recover(self,tx,fence):
        recovered=[]
        for run in tx.list('run'):
            if run['status']!='RUNNING': continue
            if run['fence']==fence and run['scheduler_owner']==self.owner and datetime.fromisoformat(run['deadline'])>datetime.now(timezone.utc): continue
            # Unknown execution may have incurred full reserved cost. Do not free money blindly.
            self.org.settle(tx,run,run['reservation'])
            tx.put('run',run['id'],dict(run,status='INTERRUPTED',usage=run['reservation'],finished_at=now(),error='Lease lost or runtime deadline; reserved ceiling charged conservatively.'))
            task=tx.require('task',run['task_id']); tx.put('task',task['id'],dict(task,status='BLOCKED',waiting_reason='Interrupted execution requires human inspection; no automatic retry'))
            agent=tx.require('agent',run['agent_id']); tx.put('agent',agent['id'],dict(agent,status='PAUSED' if not agent['enabled'] else 'BLOCKED'))
            tx.journal('RUN_INTERRUPTED',actor=run['agent_id'],payload={'run_id':run['id'],'recovery':'conservative_settlement'},task_id=run['task_id'],event_id=run.get('event_id'),category='operations'); recovered.append(run['id'])
        return recovered

    def _routines(self,tx):
        clock=datetime.now(timezone.utc)
        for routine in tx.list('routine'):
            if not routine['enabled'] or datetime.fromisoformat(routine['next_at'])>clock: continue
            interval=routine['interval_seconds']; slot=int(clock.timestamp())//interval
            task=self.org._task(tx,{'title':routine['title'],'description':'Use persisted evidence and journal references; identify missing data and human action required.','owner':routine['owner'],'reviewer':'independent-reviewer','goal_id':'organization-research','budget_eur':0.5,'expected_output':'Daily/weekly organization evidence report' if interval>=86400 else 'Task coordination report','idempotency_key':f"routine:{routine['id']}:{slot}",'routine_id':routine['id']})
            tx.put('routine',routine['id'],dict(routine,next_at=datetime.fromtimestamp((slot+1)*interval,timezone.utc).isoformat(),last_task=task['id']))
            tx.journal('ROUTINE_ENQUEUED',actor='scheduler',payload={'routine_id':routine['id'],'slot':slot},task_id=task['id'],category='operations')

    def tick(self):
        scheduled=[]
        with self.store.transaction() as tx:
            tx.lock('organization'); fence=self._lease(tx)
            if fence is None: return {'status':'lease_held_by_other_scheduler','started':[]}
            recovered=self._recover(tx,fence); self._routines(tx)
            active=sum(r['status']=='RUNNING' for r in tx.list('run'))
            tasks=sorted(tx.list('task'),key=lambda t:(t.get('priority',50),t['created_at']))
            for task in tasks:
                if active>=self.config.max_runs: break
                if task['status'] not in {'QUEUED','ASSIGNED'}: continue
                agent=tx.require('agent',task['owner'])
                if not agent['enabled'] or agent['status'] in {'PAUSED','BUDGET_EXHAUSTED','WORKING','BLOCKED'}: continue
                executor=provider(agent['provider'])
                if not executor.available or (executor.name=='mock' and not task.get('fixture')):
                    reason='Provider unavailable; configure an approved bounded gateway. Jev is a typed classification service, not a prose research executor.' if executor.name!='mock' else 'Mock executor requires an explicit synthetic fixture'
                    tx.put('task',task['id'],dict(task,status='WAITING',waiting_reason=reason)); tx.put('agent',agent['id'],dict(agent,status='WAITING'))
                    tx.journal('RUN_WAITING_PROVIDER',agent['id'],{'provider':executor.name,'reason':reason},task_id=task['id'],event_id=task.get('event_id')); continue
                hour=datetime.now(timezone.utc)-timedelta(hours=1)
                recent=sum(r['budget_scope']==agent['budget_scope'] and datetime.fromisoformat(r['started_at'])>hour for r in tx.list('run'))
                if recent>=self.config.max_runs_per_hour:
                    tx.put('task',task['id'],dict(task,status='WAITING',waiting_reason='Department hourly run cap reached')); tx.journal('HOURLY_RUN_CAP',agent['id'],{},task_id=task['id']); continue
                accounts=self.org._reserve(tx,task)
                if accounts is None: continue
                task=self.org._checkout(tx,task['id'],agent['id'])
                run=tx.put('run',ident('RUN'),{'agent_id':agent['id'],'task_id':task['id'],'event_id':task.get('event_id'),'status':'RUNNING','started_at':now(),'finished_at':None,'deadline':(datetime.now(timezone.utc)+timedelta(seconds=task['ceilings']['runtime_seconds'])).isoformat(),'scheduler_owner':self.owner,'fence':fence,'reservation':task['ceilings'],'budget_accounts':accounts,'budget_scope':agent['budget_scope'],'provider':executor.name,'model':'pending','prompt_version':agent['prompt_version'],'usage':{}})
                tx.put('task',task['id'],dict(task,status='RUNNING',run_id=run['id'])); tx.put('agent',agent['id'],dict(agent,status='WORKING'))
                tx.journal('RUN_STARTED',agent['id'],{'run_id':run['id'],'fence':fence,'provider':executor.name,'ceilings':task['ceilings']},task_id=task['id'],goal_id=task['goal_id'],event_id=task.get('event_id')); scheduled.append(run); active+=1
        for run in scheduled: self.pool.submit(self.execute,run)
        return {'status':'active','fence':fence,'started':[r['id'] for r in scheduled],'recovered':recovered}

    def execute(self,run):
        started=time.monotonic()
        try:
            with self.store.transaction() as tx:
                task=tx.require('task',run['task_id']); agent=tx.require('agent',run['agent_id'])
            result=provider(run['provider']).execute(task,agent['context'],run['reservation'])
            elapsed=time.monotonic()-started
            if elapsed>run['reservation']['runtime_seconds']: raise RuntimeError('Executor runtime ceiling exceeded')
            with self.store.transaction() as tx:
                tx.lock('organization'); persisted=tx.require('run',run['id'],True)
                if persisted['status']!='RUNNING' or not self._valid_fence(tx,run): return
                self.org.settle(tx,run,result.usage)
                self.org._complete(tx,task['id'],agent['id'],result.report,{'provider':result.provider,'model':result.model,'synthetic':result.provider=='mock','ai_output':result.provider!='mock','run_id':run['id']})
                tx.put('run',run['id'],dict(run,status='COMPLETED',finished_at=now(),usage=result.usage,model=result.model))
                tx.journal('RUN_COMPLETED',agent['id'],{'run_id':run['id'],'provider':result.provider,'model':result.model},task_id=task['id'],event_id=task.get('event_id'))
        except Exception as exc:
            with self.store.transaction() as tx:
                tx.lock('organization'); current=tx.require('run',run['id'],True)
                if current['status']!='RUNNING' or not self._valid_fence(tx,run): return
                self.org.settle(tx,run,run['reservation'])
                tx.put('run',run['id'],dict(run,status='FAILED',finished_at=now(),usage=run['reservation'],error=type(exc).__name__))
                task=tx.require('task',run['task_id']); tx.put('task',task['id'],dict(task,status='FAILED',waiting_reason=type(exc).__name__))
                agent=tx.require('agent',run['agent_id']); tx.put('agent',agent['id'],dict(agent,status='PAUSED' if not agent['enabled'] else 'ERROR'))
                tx.journal('RUN_FAILED',run['agent_id'],{'run_id':run['id'],'error_type':type(exc).__name__,'budget':'full reservation conservatively charged'},task_id=run['task_id'],event_id=run.get('event_id'),category='errors')

    def close(self): self.pool.shutdown(wait=True)


def main():
    import redis
    from .config import Config
    from .store import Store
    config=Config().validate(); scheduler=Scheduler(Organization(Store(config))); redis_client=redis.Redis.from_url(config.redis_url)
    while True:
        try:
            result=scheduler.tick()
            # Advisory wakeup cache only; PostgreSQL owns correctness and durable state.
            redis_client.set(f'wjp:{config.environment}:{config.organization}:scheduler',now(),ex=20)
            print('Scheduler '+result['status'],flush=True)
        except Exception as exc: print('Scheduler unavailable: '+type(exc).__name__,flush=True)
        time.sleep(5)


if __name__=='__main__': main()

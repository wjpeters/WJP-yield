from datetime import datetime, timezone
from decimal import Decimal
from .policy import BASE, ROLES, TEMPLATES, DIMENSIONS, ORG_LIMIT, DEPARTMENT_LIMIT, PolicyError, child_permissions, budget_fits, report_validate
from .store import now, ident


class Organization:
    def __init__(self, store): self.store, self.config = store, store.config

    def _account(self, tx, id, limits):
        period = datetime.now(timezone.utc).strftime('%Y-%m')
        key = id + ':' + period
        account = tx.get('budget', key, True)
        if not account:
            account = tx.put('budget', key, {'scope':id,'period':period,'limits':limits,'used':dict.fromkeys(DIMENSIONS,0),'reserved':dict.fromkeys(DIMENSIONS,0)})
        return account

    def seed(self):
        with self.store.transaction() as tx:
            tx.lock('organization')
            for id,name,department,reports_to,active in ROLES:
                if tx.get('agent',id): continue
                permissions = BASE | {'market.read'}
                if id == 'crypto-analyst': permissions |= {'funding.read','open_interest.read'}
                if id == 'independent-reviewer': permissions |= {'review.write'}
                tx.put('agent',id, {'name':name,'role':id,'department':department,'reports_to':reports_to,
                    'template':'fixed_role','status':'IDLE' if active else 'OFFLINE','enabled':active,
                    'permissions':sorted(permissions),'budget_scope':'department:'+id,'model':'not-configured',
                    'provider':self.config.provider,'prompt_version':'firm-role-v1','skills':[],
                    'workspace':'database-artifacts-only','created_at':now(),'temporary':False,
                    'parent_agent':None,'delegation_depth':1,'context':{'work_summary':'','next_action':'','artifacts':[],'sources':[],'open_questions':[],'session_reference':None}})
                self._account(tx,'department:'+id,DEPARTMENT_LIMIT)
            self._account(tx,'organization',ORG_LIMIT)
            if not tx.get('goal','organization-research'):
                tx.put('goal','organization-research',{'title':'Traceable crypto research with fixed software safety','description':'Research selection criteria are not proof of future returns.','parent_id':None,'owner':'cio','reviewer':'independent-reviewer','status':'ACTIVE','created_at':now()})
                tx.journal('ORGANIZATION_INITIALIZED',payload={'fixed_roles':8,'active_roles':4,'provider':self.config.provider,'host_access':False},category='operations')
            for id,seconds,title in [('hourly-cio',3600,'CIO Research Round'),('daily-report',86400,'Daily Firm Report'),('weekly-review',604800,'Weekly Research Review')]:
                if not tx.get('routine',id):
                    tx.put('routine',id,{'title':title,'interval_seconds':seconds,'enabled':True,'owner':'cio','next_at':now(),'last_task':None})

    def goal(self, data):
        with self.store.transaction() as tx:
            tx.lock('organization')
            if data.get('parent_id'): tx.require('goal',data['parent_id'])
            tx.require('agent',data.get('owner','cio'))
            id=ident('GOAL'); result=tx.put('goal',id,dict(data,status='ACTIVE',created_at=now()))
            tx.journal('GOAL_CREATED',payload=result,goal_id=id)
            return result

    def _task(self, tx, data):
        key=data.get('idempotency_key')
        if key:
            existing=tx.find_dedup('task',key)
            if existing: return existing
        owner=tx.require('agent',data['owner'])
        reviewer=tx.require('agent',data['reviewer'])
        tx.require('goal',data['goal_id'])
        if owner['id']==reviewer['id'] or reviewer['department'] != 'Independent Review':
            raise PolicyError('Tasks require an independent reviewer',422)
        amount=Decimal(str(data['budget_eur']))
        if not amount.is_finite() or amount < 0 or amount > Decimal(str(self.config.max_cost_per_task)):
            raise PolicyError('Task allocation exceeds configured hard ceiling',422)
        if data.get('parent_task'):
            parent=tx.require('task',data['parent_task'],True)
            children=[t for t in tx.list('task') if t.get('parent_task')==parent['id']]
            if len(children)>=self.config.max_children: raise PolicyError('Child task limit reached')
            if sum(Decimal(str(t['budget_eur'])) for t in children)+Decimal(str(data['budget_eur']))>Decimal(str(parent['budget_eur'])):
                raise PolicyError('Child allocations cannot multiply parent task budget')
        id=ident('TASK')
        result=tx.put('task',id,dict(data,status='QUEUED' if owner['enabled'] else 'WAITING',requester=data.get('requester','owner'),priority=data.get('priority',50),created_at=now(),started_at=None,completed_at=None,checkout_actor=None,
                    ceilings={'eur':float(data['budget_eur']),'tokens':self.config.max_tokens_per_task,'runtime_seconds':self.config.max_runtime_per_task,'api_requests':self.config.max_api_per_task,'tasks':1,'runs':1},waiting_reason=None if owner['enabled'] else 'Department is offline'))
        tx.journal('TASK_CREATED',payload=result,task_id=id,goal_id=result['goal_id'],event_id=result.get('event_id'))
        return result

    def task(self,data):
        with self.store.transaction() as tx:
            tx.lock('organization'); return self._task(tx,data)

    def _checkout(self,tx,id,actor,submitted_by=None):
        task=tx.require('task',id,True)
        if task['owner'] != actor: raise PolicyError('Only assigned agent can checkout task',403)
        agent=tx.require('agent',actor,True)
        if not agent['enabled'] or agent['status'] in {'PAUSED','BUDGET_EXHAUSTED'}: raise PolicyError('Agent is unavailable')
        if task['status'] not in {'QUEUED','ASSIGNED'}: raise PolicyError('Task already checked out or unavailable')
        task=tx.put('task',id,dict(task,status='CHECKED_OUT',checkout_actor=submitted_by or actor,assigned_agent=actor,started_at=now()))
        tx.journal('TASK_CHECKED_OUT',submitted_by or actor,{'atomic':True,'assigned_agent':actor},task_id=id,goal_id=task['goal_id'],event_id=task.get('event_id'))
        return task

    def checkout(self,id,actor=None):
        with self.store.transaction() as tx:
            tx.lock('organization'); task=tx.require('task',id)
            return self._checkout(tx,id,actor or task['owner'],submitted_by='owner')

    def _complete(self,tx,id,actor,report,provenance=None):
        task=tx.require('task',id,True)
        if actor!=task['owner']: raise PolicyError('Only assigned agent can submit output',403)
        if task['status'] not in {'CHECKED_OUT','RUNNING'}: raise PolicyError('Task needs checkout before completion')
        report_validate(report)
        actual_provenance=provenance or {'provider':'human_submission','model':None,'ai_output':False}
        submitter='owner' if actual_provenance['provider']=='human_submission' else 'software:mock' if actual_provenance.get('synthetic') else actor
        artifact=tx.put('report',ident('REPORT'),{'task_id':id,'goal_id':task['goal_id'],'event_id':task.get('event_id'),'actor':submitter,'assigned_agent':actor,'created_at':now(),'content':report,'provenance':actual_provenance,'prompt_version':'firm-role-v1','inputs':task.get('inputs',[]),'tools_used':[]})
        task=tx.put('task',id,dict(task,status='REVIEW',report_id=artifact['id'],completed_at=now()))
        agent=tx.require('agent',actor,True)
        context=dict(agent['context'],work_summary='Submitted evidence summary for independent review.',next_action='Await independent reviewer.',artifacts=agent['context'].get('artifacts',[])+[artifact['id']],sources=report['sources'],open_questions=report['next_questions'])
        tx.put('agent',actor,dict(agent,status='PAUSED' if not agent['enabled'] else 'IDLE',context=context))
        tx.journal('RESEARCH_SUBMITTED',submitter,{'report_id':artifact['id'],'assigned_agent':actor,'provenance':artifact['provenance']},task_id=id,goal_id=task['goal_id'],event_id=task.get('event_id'),category='research',artifact_refs=[artifact['id']],source_refs=report['sources'])
        return task

    def complete(self,id,actor,report):
        with self.store.transaction() as tx:
            tx.lock('organization'); task=tx.require('task',id)
            if task['status']=='RUNNING': raise PolicyError('Running tasks must finish through fenced executor')
            return self._complete(tx,id,actor or task['owner'],report)

    def review(self,id,actor,decision,summary,provenance=None):
        with self.store.transaction() as tx:
            tx.lock('organization'); task=tx.require('task',id,True)
            if actor!='owner':
                raise PolicyError('Owner gateway cannot impersonate the Independent Reviewer; submit actor owner',403)
            if decision not in {'approve','reject'}: raise PolicyError('Unknown review decision',422)
            if task['status']!='REVIEW': raise PolicyError('Task is not ready for review')
            status='COMPLETED' if decision=='approve' else 'REJECTED'
            task=tx.put('task',id,dict(task,status=status,review={'decision':decision,'summary':summary,'actor':actor,'at':now(),'kind':'owner_manual_review','independent_agent_review':False,'assigned_reviewer':task['reviewer'],'provenance':'human_submission'}))
            tx.journal('TASK_REVIEWED',actor,task['review'],task_id=id,goal_id=task['goal_id'],event_id=task.get('event_id'),category='research')
            return task

    def spawn(self,parent_id,data):
        with self.store.transaction() as tx:
            tx.lock('organization'); return self._spawn(tx,parent_id,data)

    def _spawn(self,tx,parent_id,data):
        parent=tx.require('agent',parent_id,True)
        if not parent['enabled'] or 'agent.spawn' not in parent['permissions']: raise PolicyError('Parent cannot delegate',403)
        template=TEMPLATES.get(data['template'])
        if not template: raise PolicyError('Template is not approved',422)
        root=parent['role'] if not parent['temporary'] else parent['lead_role']
        if root not in template['parents']: raise PolicyError('Template does not belong to parent department',403)
        if parent['delegation_depth']>=self.config.max_depth: raise PolicyError('Delegation depth limit reached')
        if sum(a['temporary'] and a['enabled'] for a in tx.list('agent'))>=self.config.max_temporary: raise PolicyError('Active temporary agent limit reached')
        id=ident('AGENT')
        child=tx.put('agent',id,dict(parent,name=data['name'],role=data['template'],lead_role=root,template=data['template'],reports_to=parent_id,parent_agent=parent_id,temporary=True,delegation_depth=parent['delegation_depth']+1,status='IDLE',created_at=now(),permissions=child_permissions(parent['permissions'],template['permissions']),context={'work_summary':'','next_action':'Await assigned task.','artifacts':[],'sources':[],'open_questions':[],'session_reference':None}))
        tx.journal('AGENT_SPAWNED',parent_id,{'child':id,'template':data['template'],'permissions':child['permissions'],'budget_scope':child['budget_scope']},task_id=data.get('task_id'),goal_id=data.get('goal_id'))
        return child

    def pause(self,id):
        with self.store.transaction() as tx:
            tx.lock('organization'); agent=tx.require('agent',id,True)
            tx.put('agent',id,dict(agent,status='PAUSED',enabled=False)); tx.journal('AGENT_PAUSED',payload={'agent':id})
            return tx.require('agent',id)

    def _reserve(self,tx,task):
        agent=tx.require('agent',task['owner'])
        def allocation(p):
            return dict(p['ceilings'],tasks=self.config.max_children+1,runs=self.config.max_children+1)
        accounts=[self._account(tx,'organization',ORG_LIMIT),self._account(tx,agent['budget_scope'],DEPARTMENT_LIMIT),self._account(tx,'task:'+task['id'],allocation(task))]
        parent=task.get('parent_task')
        while parent:
            p=tx.require('task',parent); accounts.append(self._account(tx,'task:'+p['id'],allocation(p))); parent=p.get('parent_task')
        if any(not budget_fits(a['limits'],a['used'],a['reserved'],task['ceilings']) for a in accounts):
            tx.put('agent',agent['id'],dict(agent,status='BUDGET_EXHAUSTED'))
            tx.put('task',task['id'],dict(task,status='BLOCKED',waiting_reason='Hard budget stop'))
            tx.journal('BUDGET_EXHAUSTED',agent['id'],{'task':task['id']},task_id=task['id'],goal_id=task['goal_id'],event_id=task.get('event_id'))
            return None
        for a in accounts:
            a['reserved']={k:float(Decimal(str(a['reserved'][k]))+Decimal(str(task['ceilings'][k]))) for k in DIMENSIONS}; tx.put('budget',a['id'],a)
        return [a['id'] for a in accounts]

    def settle(self,tx,run,usage):
        ceiling=run['reservation']
        if any(Decimal(str(usage.get(k,0)))>Decimal(str(ceiling[k])) or Decimal(str(usage.get(k,0)))<0 for k in DIMENSIONS): raise PolicyError('Executor usage exceeded hard reservation')
        for id in run['budget_accounts']:
            a=tx.require('budget',id,True)
            a['reserved']={k:float(Decimal(str(a['reserved'][k]))-Decimal(str(ceiling[k]))) for k in DIMENSIONS}
            a['used']={k:float(Decimal(str(a['used'][k]))+Decimal(str(usage.get(k,0)))) for k in DIMENSIONS}
            tx.put('budget',id,a)
        tx.journal('BUDGET_SETTLED',run['agent_id'],{'usage':usage,'reservation':ceiling,'run_id':run['id']},task_id=run['task_id'],event_id=run.get('event_id'),category='costs',cost=usage.get('eur',0))

    def _event(self,tx,data):
        existing=tx.find_dedup('event',data['idempotency_key'])
        if existing: return existing
        goal_id=data.get('goal_id') or 'organization-research'; tx.require('goal',goal_id)
        id=ident('EVENT'); event=tx.put('event',id,dict(data,goal_id=goal_id,created_at=now(),status='QUEUED'))
        tx.journal('MARKET_EVENT_RECEIVED',payload=event,event_id=id,goal_id=goal_id,category='research')
        tasks=[]
        for owner in ['cio','market-intelligence','crypto-analyst','quant-researcher']:
            tasks.append(self._task(tx,{'title':data['title']+' / '+owner,'description':'Investigate event with sourced facts, counterevidence and uncertainty.','owner':owner,'reviewer':'independent-reviewer','goal_id':goal_id,'budget_eur':0.5,'expected_output':'Structured research report','idempotency_key':id+':'+owner,'event_id':id,'inputs':[data.get('payload',{})],'fixture':data.get('fixture',False)}))
        return tx.put('event',id,dict(event,task_ids=[t['id'] for t in tasks]))

    def event(self,data):
        with self.store.transaction() as tx:
            tx.lock('organization'); return self._event(tx,data)

    def snapshot(self):
        with self.store.transaction() as tx:
            agents,tasks,runs=tx.list('agent'),tx.list('task'),tx.list('run')
            result={'config':self.config.public(),'agents':agents,'tasks':tasks,'journal':tx.journal_entries(limit=200),'goals':tx.list('goal'),'budgets':tx.list('budget'),'routines':tx.list('routine'),'events':tx.list('event'),'runs':runs,'reports':tx.list('report'),
                'metrics':{'tasks_completed':sum(t['status']=='COMPLETED' for t in tasks),'tasks_rejected':sum(t['status']=='REJECTED' for t in tasks),'active_runs':sum(r['status']=='RUNNING' for r in runs),'active_temporary_agents':sum(a['temporary'] and a['enabled'] for a in agents),'total_cost_eur':sum(r.get('usage',{}).get('eur',0) for r in runs),'review_failure_rate':sum(t['status']=='REJECTED' for t in tasks)/max(1,sum(t['status'] in {'COMPLETED','REJECTED'} for t in tasks)),'journal_integrity':tx.verify_journal()}}
            for key,kind in [('strategies','strategy_state'),('bots','bot'),('datasets','dataset'),('backtests','backtest'),('strategy_reviews','strategy_review')]: result[key]=[{k:v for k,v in record.items() if k not in {'candles','full_result'}} for record in tx.list(kind)]
            return result

    def demo(self):
        if self.config.environment!='local': raise PolicyError('Synthetic acceptance is local-only',403)
        from .providers import MockProvider
        with self.store.transaction() as tx:
            tx.lock('organization')
            if any(r['status']=='RUNNING' for r in tx.list('run')): raise PolicyError('Wait for active research runs before acceptance fixture')
            prior=tx.find_dedup('event','acceptance:funding-volatility-v1')
            if prior: return {'event':prior,'synthetic':True,'ai_output':False,'idempotent':True,'journal_verified':tx.verify_journal()}
            originals={id:tx.require('agent',id) for id in ['cio','market-intelligence','crypto-analyst','quant-researcher']}
            for id,agent in originals.items(): tx.put('agent',id,dict(agent,enabled=True,status='IDLE'))
            event=self._event(tx,{'event_type':'FUNDING_VOLATILITY_FIXTURE','title':'Synthetic BTC funding/volatility expansion','idempotency_key':'acceptance:funding-volatility-v1','goal_id':'organization-research','fixture':True,'payload':{'synthetic':True,'source':'wjp-fixture://funding-volatility-v1','funding_change':0.001,'volatility_change':0.02,'not_market_data':True}})
            specialist=self._spawn(tx,'crypto-analyst',{'template':'funding_specialist','name':'Funding fixture specialist','goal_id':'organization-research'})
            child_task=self._task(tx,{'title':'Funding fixture counterevidence','description':'Check synthetic funding evidence.','owner':specialist['id'],'reviewer':'independent-reviewer','goal_id':'organization-research','budget_eur':0.25,'expected_output':'Source-qualified funding report','fixture':True,'parent_task':event['task_ids'][2],'event_id':event['id'],'idempotency_key':event['id']+':funding-specialist'})
            task_ids=[child_task['id']]+event['task_ids']
            for id in task_ids:
                task=tx.require('task',id)
                accounts=self._reserve(tx,task)
                if accounts is None: raise PolicyError('Fixture blocked by hard budget stop')
                task=self._checkout(tx,id,task['owner'])
                run=tx.put('run',ident('RUN'),{'agent_id':task['owner'],'task_id':id,'event_id':event['id'],'status':'RUNNING','started_at':now(),'finished_at':None,'reservation':task['ceilings'],'budget_accounts':accounts,'budget_scope':tx.require('agent',task['owner'])['budget_scope'],'provider':'mock','model':'deterministic-fixture-v1','prompt_version':'firm-role-v1','usage':{},'fence':0,'scheduler_owner':'local-acceptance-fixture','execution_mode':'synchronous_fixture_not_scheduler'})
                tx.put('task',id,dict(task,status='RUNNING',run_id=run['id']))
                output=MockProvider().execute(task,{},task['ceilings']); self.settle(tx,run,output.usage)
                self._complete(tx,id,task['owner'],output.report,{'provider':'mock','model':output.model,'synthetic':True,'ai_output':False,'run_id':run['id']})
                tx.put('run',run['id'],dict(run,status='COMPLETED',finished_at=now(),usage=output.usage))
                task=tx.require('task',id); tx.put('task',id,dict(task,status='COMPLETED',review={'actor':'software:fixture-validator','decision':'approve','summary':'Fixture sections, explicit synthetic provenance and linkage checked; no profitability claim accepted.','kind':'fixture_validation','independent_agent_review':False,'assigned_reviewer':task['reviewer'],'provenance':'deterministic_fixture_validation','at':now()}))
                tx.journal('FIXTURE_REVIEW_COMPLETED','software:fixture-validator',{'synthetic':True,'ai_output':False,'task':id,'validation_only':True,'independent_agent_review':False},task_id=id,event_id=event['id'],category='research',actor_type='system')
            # Restore original department availability; temporary fixture specialist sleeps.
            for id,agent in originals.items():
                current=tx.require('agent',id); tx.put('agent',id,dict(current,enabled=agent['enabled'],status=agent['status']))
            child=tx.require('agent',specialist['id']); tx.put('agent',specialist['id'],dict(child,status='OFFLINE',enabled=False))
            event=tx.put('event',event['id'],dict(event,status='COMPLETED',specialist_task_id=child_task['id']))
            tx.journal('LOCAL_ACCEPTANCE_COMPLETED',payload={'synthetic':True,'ai_output':False,'task_count':len(task_ids),'source':'wjp-fixture://funding-volatility-v1','scope':'organization flow; deterministic fixture, not AI research or live trading'},event_id=event['id'],category='operations')
            return {'event':event,'synthetic':True,'ai_output':False,'tasks_completed':len(task_ids),'specialist':specialist['id'],'journal_verified':tx.verify_journal()}

export type Row=Record<string,unknown> & {id?:string};
export type Agent=Row & {id:string;name:string;role:string;department:string;reports_to:string;status:string;enabled:boolean;temporary:boolean;parent_agent?:string;permissions:string[]};
export type Task=Row & {id:string;title:string;description:string;owner:string;reviewer:string;goal_id:string;status:string;budget_eur:number;waiting_reason?:string};
export type Budget=Row & {id:string;scope:string;limits:Record<string,number>;used:Record<string,number>;reserved:Record<string,number>};
export type Entry=Row & {seq:number;journal_id:string;timestamp:string;event_type:string;actor:string;category:string;payload:Row;entry_hash:string;previous_hash:string;event_id?:string;strategy_id?:string};
export type Snapshot={config:Row;agents:Agent[];tasks:Task[];journal:Entry[];goals:Row[];budgets:Budget[];routines:Row[];events:Row[];runs:Row[];reports:Row[];metrics:Row};
export type Lab={strategies:Row[];bots:Row[];datasets:Row[];backtests:Row[];reviews:Row[];risk_limits:Row;execution_ready:boolean;execution_note:string;jev:Row};

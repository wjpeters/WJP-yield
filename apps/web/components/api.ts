export async function request<T>(path:string,body?:unknown,signal?:AbortSignal):Promise<T>{
 const r=await fetch('/api/firm'+path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json','x-wjp-request':'1'},body:body===undefined?undefined:JSON.stringify(body),signal,cache:'no-store'});
 let data;try{data=await r.json()}catch{throw new Error('De Firm-service reageert nog niet. Controleer of Docker gestart is.')}
 if(!r.ok)throw new Error(typeof data.detail==='string'?data.detail:typeof data.error==='string'?data.error:'Controleer de invoer of de serviceverbinding.');
 return data as T;
}
export const label=(v:unknown,fallback='—')=>v==null?fallback:typeof v==='object'?JSON.stringify(v):String(v);
export const euro=(v:unknown)=>new Intl.NumberFormat('nl-NL',{style:'currency',currency:'EUR',maximumFractionDigits:2}).format(typeof v==='number'?v:0);
export const when=(v:unknown)=>{if(!v)return 'Nog niet';const d=new Date(typeof v==='number'?v*1000:String(v));return Number.isNaN(d.getTime())?String(v):new Intl.DateTimeFormat('nl-NL',{timeZone:'Europe/Amsterdam',dateStyle:'short',timeStyle:'short'}).format(d)};

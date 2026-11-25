import { parseTimetable } from './parser.mjs';

export const RELAY_URL='https://mcp.aka.page/api/cgv/timetable';
export const TARGET_DATE='20261221';
export const MOVIE='30001790';
export const THEATER='0013';
export const CAPACITY=624;
export function buildProbeUrl(date) {
  const url=new URL(RELAY_URL);
  url.search=new URLSearchParams({playDate:date,theaterCode:THEATER,movieCode:MOVIE,limit:'50'}).toString();
  return url.toString();
}
export function retryAfterMs(value,now=Date.now()){
  if(!value)return 0;
  const n=Number(value);
  if(Number.isFinite(n)&&n>=0)return n*1000;
  const t=Date.parse(value);
  return Number.isFinite(t)?Math.max(0,t-now):0;
}
const blockedStatus=n=>[401,403,429,451].includes(Number(n));
export function interpretResponse(status,payload,headers,date){
  const upstream=Number(payload?.diagnostics?.upstreamStatus||0)||null;
  const reported=Number(payload?.diagnostics?.status||0)||null;
  const retry=retryAfterMs(headers?.get?.('retry-after'));
  const code=String(payload?.error?.code||payload?.diagnostics?.code||'').slice(0,80);
  const base={http:status,upstream,code,retryAfterMs:retry};
  if(blockedStatus(status)||blockedStatus(upstream)||blockedStatus(reported))return {...base,kind:'STOP',reason:'명시적 접근/요청 제한'};
  if(payload?.diagnostics?.retryable===false||payload?.error?.retryable===false)return {...base,kind:'STOP',reason:'재시도 불가 응답'};
  if(status!==200||payload?.success!==true){
    return {...base,kind:'UNKNOWN',reason:'시간표 조회 실패; 미오픈인지 확인 불가'};
  }
  const d=payload.data;
  if(!d||d.playDate!==date||!Array.isArray(d.timetable)||d.filterRelaxed===true||String(d.filters?.theaterCode??'')!==THEATER||String(d.filters?.movieCode??'')!==MOVIE){
    return {...base,kind:'UNKNOWN',reason:'예상한 날짜/영화/극장 또는 응답 구조 불일치'};
  }
  // Fail closed on inconsistent row identities; no stale/other-date rows accepted.
  if(d.timetable.some(r=>!r||typeof r!=='object'||String(r.playDate)!==date||String(r.theaterCode)!==THEATER||String(r.movieCode)!==MOVIE))return {...base,kind:'UNKNOWN',reason:'시간표 행의 날짜/영화/극장 불일치'};
  try{
    const parsed=parseTimetable(payload,date,{movieNo:MOVIE,siteNo:THEATER,capacity:CAPACITY});
    return {...base,kind:parsed.shows.length?'OPEN':'NO_IMAX',shows:parsed.shows,rows:d.timetable.length};
  }catch{return {...base,kind:'UNKNOWN',reason:'시간표 해석 실패'};}
}
export async function queryProbe(date,fetcher=fetch){
  const ctrl=new AbortController();const timer=setTimeout(()=>ctrl.abort(),15000);
  try{
    // Ordinary documented public relay request. No direct CGV requests,
    // cache-busting, no-cache directives, retries within a request, or bypass.
    const response=await fetcher(buildProbeUrl(date),{headers:{Accept:'application/json'},signal:ctrl.signal,redirect:'error'});
    let payload=null;try{payload=await response.json();}catch{}
    return interpretResponse(response.status,payload,response.headers,date);
  }catch{return {kind:'UNKNOWN',http:null,upstream:null,reason:'Relay 네트워크/시간 초과',retryAfterMs:0};}
  finally{clearTimeout(timer);}
}
export function nextDelay(result,random=Math.random,consecutiveUnknown=0){
  if(result.kind==='STOP'||result.kind==='OPEN')return null;
  // Brief transient-error retries only. Persistent upstream failures use backoff;
  // a confirmed normal response restores the requested 7–10 second cadence.
  let min=7000,max=10000;
  if(result.kind==='UNKNOWN'){
    if(consecutiveUnknown>=5){min=180000;max=300000;}
    else if(consecutiveUnknown>=3){min=60000;max=90000;}
  }
  return Math.max(min+Math.round(Math.max(0,Math.min(1,random()))*(max-min)),result.retryAfterMs||0);
}

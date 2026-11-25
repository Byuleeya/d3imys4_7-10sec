import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { queryProbe,nextDelay,TARGET_DATE,MOVIE,THEATER } from './probe.mjs';
import { prettyDate } from './parser.mjs';

const date=TARGET_DATE; // Deliberately one target for this controlled experiment.
const deadline=Date.parse('2026-12-21T00:00:00+09:00');
const env=(k,d='')=>String(process.env[k]??d).trim();
const stateFile=env('PROBE_STATE_FILE','/data/dune3-imax-relay-probe-v14.json');
const log=(...args)=>console.log(`[${new Date().toLocaleString('ko-KR',{timeZone:'Asia/Seoul',hour12:false})} KST]`,...args);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let stopping=false;
function loadState(){try{return JSON.parse(fs.readFileSync(stateFile,'utf8'));}catch{return {};}}
function saveState(state){fs.mkdirSync(path.dirname(stateFile),{recursive:true});const tmp=stateFile+'.tmp';fs.writeFileSync(tmp,JSON.stringify(state,null,2));fs.renameSync(tmp,stateFile);}
async function telegram(text){
 const token=env('TELEGRAM_BOT_TOKEN'),chat=env('TELEGRAM_CHAT_ID');
 if(!token||!chat)throw new Error('Telegram 환경변수 누락');
 const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),12000);
 try{
   const r=await fetch(`https://api.telegram.org/bot${token}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},signal:ctrl.signal,body:JSON.stringify({chat_id:chat,text,disable_web_page_preview:true})});
   if(!r.ok)throw new Error(`Telegram HTTP ${r.status}`);
   const p=await r.json();if(p.ok!==true)throw new Error('Telegram 응답 실패');
 }finally{clearTimeout(timer);}
}
export function openMessage(date,shows){
 const rows=shows.slice(0,12).map(s=>`• ${s.time}${s.end?'~'+s.end:''} / IMAX${s.remaining===null?'':` / 잔여 ${s.remaining}석`}`).join('\n');
 return `🚨 [용산 IMAX 듄3] 신규 예매 회차 확인!\n\n${prettyDate(date)}\nIMAX ${shows.length}회차\n${rows}\n\n공개 Relay 정상 응답 (실제 좌석/예매는 CGV에서 확인)\nhttps://cgv.co.kr/cnm/movieBook/movie?${new URLSearchParams({movNo:MOVIE,siteNo:THEATER,scnYmd:date})}\n\n첫 성공을 확인하여 테스트 종료.`;
}
// Injected dependencies enable deterministic offline end-to-end tests.
export async function runProbe({query=queryProbe,notify=telegram,wait=sleep,now=Date.now,random=Math.random,read=loadState,write=saveState,logger=log,isStopping=()=>stopping,endAt=deadline}={}){
 let state=read();
 if(state.date===date&&state.done){logger('이전 테스트 종료 상태:',state.done,'추가 조회 없음');return state.done;}
 let count=0,unknown=0;
 logger('v1.5 Relay 가설 검증 / 20261221 / 기본 7~10초 / 연속 조회실패 3회부터 backoff / 직접 CGV 호출 없음');
 while(!isStopping()&&now()<endAt){
   const r=await query(date);count++;
   const detail=`HTTP ${r.http??'연결 실패'}${r.upstream?` / upstream ${r.upstream}`:''}${r.code?` / ${r.code}`:''}`;
   if(r.kind==='STOP'){
     logger(`STOP ${date}: ${detail} / ${r.reason}`);
     write({date,done:'BLOCKED',at:new Date(now()).toISOString()});
     try{await notify(`⚠️ 듄3 Relay 테스트 중단\n${detail}\n접근 제한 또는 재시도 불가 응답이 확인되어 더 이상 조회하지 않습니다.`);}catch{logger('중단 알림 전송 실패');}
     return 'BLOCKED';
   }
   if(r.kind==='OPEN'){
     logger(`OPEN ${date}: ${detail} / IMAX ${r.shows.length}회차 / 이전 조회불가 ${unknown}회`);
     // Preserve confirmed result before notifying, and never repeat CGV/Relay after success.
     write({date,done:'OPEN_PENDING_ALERT',shows:r.shows,at:new Date(now()).toISOString()});
     try{await notify(openMessage(date,r.shows));write({date,done:'OPEN',shows:r.shows,at:new Date(now()).toISOString()});return 'OPEN';}
     catch{logger('실제 시간표는 확인됐지만 Telegram 전송 실패. Railway 로그 확인 필요.');return 'OPEN_PENDING_ALERT';}
   }
   if(r.kind==='UNKNOWN')unknown++;
   else unknown=0;
   const delay=nextDelay(r,random,unknown);
   logger(`${r.kind==='UNKNOWN'?'UNKNOWN':'NO_IMAX'} ${date}: ${detail} / ${r.reason??`정상 시간표 ${r.rows}행, IMAX 0회차`} / 연속 조회불가 ${unknown}회 / 다음 조회 ${Math.ceil(delay/1000)}초 후`);
   if(now()+delay>=endAt){logger('테스트 종료 기한 도달: 신규 회차 확인 못함');return 'EXPIRED';}
   await wait(delay);
 }
 logger('테스트 종료: 종료 신호 또는 기한 도달');return 'EXPIRED';
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 process.on('SIGTERM',()=>{stopping=true;log('SIGTERM: 종료 요청');process.exit(0);});
 process.on('SIGINT',()=>{stopping=true;process.exit(0);});
 if(!env('TELEGRAM_BOT_TOKEN')||!env('TELEGRAM_CHAT_ID')){log('Telegram 환경변수 누락');process.exitCode=1;}
 else runProbe().catch(e=>{log('FATAL: 테스트 실행 실패',e?.code||e?.name||'Error');process.exitCode=1;});
}

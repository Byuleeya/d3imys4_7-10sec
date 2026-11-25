// CGV public timetable payload parser. Read-only. Never visits the seat map.
export const MOVIE_NO = '30001790';
export const IMAX_CAPACITY = 624;
const movieKeys = ['movNm','movieName','movieNm','prodNm','title','movTitle','movie_title'];
const idKeys = ['movNo','movieNo','movieCode','movieId'];
const timeKeys = ['scnsrtTm','startTime','start_time','playStartTime','screeningStartTime','showTime','time'];
const endKeys = ['scnendTm','endTime','end_time','playEndTime'];
const hallKeys = ['scnsNm','scnsEnm','screenName','screenNm','roomName','auditoriumName','hallName','screen','hall'];
const formatKeys = ['tcscnsGradNm','format','formatName','screenType','screenTypeName','specialType','specialTypeName','cinemaType','spltDivNm','theaterType','roomType','scnTypeNm','scrnType'];
const remainKeys = ['frSeatCnt','remainingSeats','availableSeats','remainSeatCnt','freeSeats'];
const totalKeys = ['stcnt','totalSeats','seatCount','totalSeatCnt'];
const siteKeys = ['siteNo','theaterCode','siteCode'];
const dateKeys = ['scnYmd','playDate','screeningDate'];
const seqKeys = ['scnSseq','scnsNo','screeningId','scheduleId'];

export function first(obj, keys) {
  for (const k of keys) if (Object.hasOwn(obj,k) && obj[k] !== null && obj[k] !== undefined && obj[k] !== '') return obj[k];
  return null;
}
export function norm(v) { return String(v ?? '').normalize('NFKC').toUpperCase().replace(/[^\p{L}\p{N}]/gu, ''); }
export function hhmm(v) {
  const s=String(v??'').trim();
  const match=s.match(/(?:^|\s)(\d{1,2}):([0-5]\d)/);
  if (match) return `${match[1].padStart(2,'0')}:${match[2]}`;
  const d=s.replace(/\D/g,'');
  if (d.length===4 && Number(d.slice(0,2))<=29 && Number(d.slice(2))<60) return `${d.slice(0,2)}:${d.slice(2)}`;
  if (d.length===3 && Number(d.slice(0,1))<=9 && Number(d.slice(1))<60) return `0${d[0]}:${d.slice(1)}`;
  return '';
}
export function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n=Number(String(v).replace(/[,\s]/g,'')); return Number.isFinite(n) && n>=0 ? n : null;
}
function* walk(root, seen=new Set()) {
  if (root && typeof root==='object') {
    if (seen.has(root)) return;
    seen.add(root);
    if (Array.isArray(root)) for (const e of root) yield* walk(e,seen);
    else { yield root; for (const v of Object.values(root)) yield* walk(v,seen); }
  }
}
function hasArray(root) { return [...walk(root)].some(o=>Object.values(o).some(Array.isArray)); }
export function validatePayload(p) {
  if (!p || typeof p!=='object') throw new Error('응답이 JSON 객체/배열이 아닙니다');
  if (p.success===false) throw new Error(`relay success=false: ${String(p.error||p.message||'unknown')}`);
  if (p.statusCode!=null && ![0,'0'].includes(p.statusCode)) throw new Error(`CGV statusCode=${p.statusCode}: ${String(p.message||'')}`);
  const err=String(p.errorCode||p.code||'');
  if (err && /^-?\d+$/.test(err) && Number(err)<0) throw new Error(`CGV errorCode=${err}`);
  if (Array.isArray(p)) return true;
  if (Array.isArray(p.data) || hasArray(p.data)) return true;
  if (Array.isArray(p.timetable) || Array.isArray(p.schedules) || Array.isArray(p.items) || Array.isArray(p.results) || Array.isArray(p.rows)) return true;
  throw new Error('시간표 배열을 찾지 못했습니다. 응답 구조 변경 또는 접근 제한 가능성');
}
export function matchesMovie(row, id=MOVIE_NO) {
  const rid=first(row,idKeys);
  if (rid!=null) return String(rid).trim()===id;
  const n=norm(first(row,movieKeys));
  return /듄파트0?3/.test(n) || /DUNEPART0?3/.test(n) || /DUNE3/.test(n);
}
export function isImax(row, expectedCapacity=IMAX_CAPACITY) {
  const hint=norm([first(row,hallKeys),...formatKeys.map(k=>row[k]??'')].join(' '));
  if (hint.includes('IMAX') || hint.includes('아이맥스')) return true;
  // Relay sometimes omits auditorium/format; the 624-seat Yongsan IMAX
  // capacity is used *only when there is no contradictory format label*.
  if (hint) return false;
  return num(first(row,totalKeys)) === expectedCapacity;
}
export function parseTimetable(payload, date, { movieNo=MOVIE_NO, siteNo='0013', capacity=IMAX_CAPACITY }={}) {
  validatePayload(payload);
  const shows=new Map(); let candidateCount=0; let matchingMovieCount=0;
  for (const row of walk(payload)) {
    const rawTime=first(row,timeKeys);
    if (rawTime===null) continue;
    const time=hhmm(rawTime);
    if (!time) continue;
    candidateCount++;
    if (!matchesMovie(row,movieNo)) continue;
    matchingMovieCount++;
    const rowSite=first(row,siteKeys);
    if (rowSite!==null && String(rowSite).padStart(4,'0')!==siteNo) continue;
    const rowDate=first(row,dateKeys);
    if (rowDate!==null && String(rowDate).replace(/\D/g,'').slice(0,8)!==date) continue;
    if (!isImax(row,capacity)) continue;
    const hall=String(first(row,hallKeys)||'IMAX관');
    const end=hhmm(first(row,endKeys));
    const remaining=num(first(row,remainKeys));
    const total=num(first(row,totalKeys));
    const seq=seqKeys.map(k=>String(row[k]??'').trim()).filter(Boolean).join(':');
    // The fallback title may be absent in some relay payloads but movNo is reliable.
    const movie=String(first(row,movieKeys)||'듄-파트 3');
    const key=`${date}|${time}`; // One auditorium cannot run two IMAX screenings simultaneously. Stable across sources.
    if (!shows.has(key)) shows.set(key,{ key,date,time,end, movie, hall, remaining,total, movieNo, seq });
  }
  return {shows:[...shows.values()].sort((a,b)=>a.time.localeCompare(b.time)), candidateCount, matchingMovieCount};
}

export function addDays(date, delta) {
  if (!/^\d{8}$/.test(date)) throw new Error('YYYYMMDD 날짜 필요');
  const dt=new Date(Date.UTC(+date.slice(0,4),+date.slice(4,6)-1,+date.slice(6,8)+delta));
  return dt.toISOString().slice(0,10).replace(/-/g,'');
}
export function prettyDate(date) {
  const d=new Date(Date.UTC(+date.slice(0,4),+date.slice(4,6)-1,+date.slice(6,8)));
  return `${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)} (${'일월화수목금토'[d.getUTCDay()]})`;
}
export function pickDate(state, start, end, tick=0, lookahead=7) {
  let cursor=state.cursor||start;
  if (cursor<start) cursor=start;
  while(cursor<=end && state.openedDates?.[cursor]) cursor=addDays(cursor,1);
  if (cursor>end) return null;
  // Every fifth poll, check one future date too. No extra request per tick.
  if (tick>0 && tick%5===0) {
    const offset=1+((Math.floor(tick/5)-1)%lookahead);
    const other=addDays(cursor,offset);
    if (other<=end && !state.openedDates?.[other]) return other;
  }
  return cursor;
}

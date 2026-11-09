/* ================================================================
   ENGINE — 원자료 → 분류 → 학교별 시험기간(에피소드) → 통계
   이 파일의 규칙은 2단계 Python 수집기(classify.py / aggregate.py)와
   1:1로 맞출 기준 구현입니다. 규칙을 바꾸면 양쪽을 함께 바꿉니다.
   ================================================================ */
(function(G){
'use strict';

/* ---------- 상수 ---------- */
const REGIONS=[ // NEIS 시도교육청코드(ATPT_OFCDC_SC_CODE). n = 샘플 생성용 대략적 학교 수(초·중·고)
 {code:'B10',name:'서울',full:'서울특별시교육청',n:[605,389,320]},
 {code:'C10',name:'부산',full:'부산광역시교육청',n:[304,171,140]},
 {code:'D10',name:'대구',full:'대구광역시교육청',n:[242,126,93]},
 {code:'E10',name:'인천',full:'인천광역시교육청',n:[270,141,126]},
 {code:'F10',name:'광주',full:'광주광역시교육청',n:[155,91,67]},
 {code:'G10',name:'대전',full:'대전광역시교육청',n:[150,89,62]},
 {code:'H10',name:'울산',full:'울산광역시교육청',n:[121,64,57]},
 {code:'I10',name:'세종',full:'세종특별자치시교육청',n:[56,23,20]},
 {code:'J10',name:'경기',full:'경기도교육청',n:[1340,657,490]},
 {code:'K10',name:'강원',full:'강원특별자치도교육청',n:[350,162,117]},
 {code:'M10',name:'충북',full:'충청북도교육청',n:[260,128,84]},
 {code:'N10',name:'충남',full:'충청남도교육청',n:[410,188,117]},
 {code:'P10',name:'전북',full:'전북특별자치도교육청',n:[420,208,133]},
 {code:'Q10',name:'전남',full:'전라남도교육청',n:[430,248,147]},
 {code:'R10',name:'경북',full:'경상북도교육청',n:[470,268,186]},
 {code:'S10',name:'경남',full:'경상남도교육청',n:[510,270,192]},
 {code:'T10',name:'제주',full:'제주특별자치도교육청',n:[120,45,30]},
];
const REGION_BY=Object.fromEntries(REGIONS.map(r=>[r.code,r]));
const LEVELS={E:'초등학교',M:'중학교',H:'고등학교'};
const LEVEL_SHORT={E:'초',M:'중',H:'고'};
const MAXG={E:6,M:3,H:3};
const TYPE_NAME={MID:'중간고사',FINAL:'기말고사'};
const THRESH={MIN_N:5, WARN_N:20, LOW_RATE:0.5, YEAR_COVERAGE:0.30, GAP_SPLIT:14};

/* ---------- 날짜 (UTC 일련번호) ---------- */
const DAY=86400000;
const pad=n=>String(n).padStart(2,'0');
const dn=(y,m,d)=>Math.round(Date.UTC(y,m-1,d)/DAY);
const fromYmd=s=>dn(+s.slice(0,4),+s.slice(4,6),+s.slice(6,8));
const parts=n=>{const d=new Date(n*DAY);return [d.getUTCFullYear(),d.getUTCMonth()+1,d.getUTCDate()]};
const ymd=n=>{const [y,m,d]=parts(n);return ''+y+pad(m)+pad(d)};
const iso=n=>{if(n==null)return '';const [y,m,d]=parts(n);return `${y}-${pad(m)}-${pad(d)}`};
const dow=n=>new Date(n*DAY).getUTCDay();
const WD='일월화수목금토';
const fmtD=n=>{if(n==null)return '–';const [,m,d]=parts(n);return `${m}/${d}(${WD[dow(n)]})`};
const fmtMD=n=>{if(n==null)return '–';const [,m,d]=parts(n);return `${m}/${d}`};
const monthOf=n=>parts(n)[1];
const yearOf=n=>parts(n)[0];
const ayOf=n=>{const [y,m]=parts(n);return m>=3?y:y-1}; // 학년도: 3월~다음해 2월
const ayStart=a=>dn(a,3,1), ayEnd=a=>dn(a+1,3,1)-1;
const mondayOf=n=>n-((dow(n)+6)%7);

const HOLI=new Set(('20250101 20250128 20250129 20250130 20250301 20250303 20250505 20250506 20250603 20250606 20250815 20251003 20251005 20251006 20251007 20251008 20251009 20251225 '+
 '20260101 20260216 20260217 20260218 20260301 20260302 20260505 20260524 20260525 20260603 20260606 20260815 20260817 20260924 20260925 20260926 20261003 20261005 20261009 20261225 '+
 '20270101 20270206 20270207 20270208 20270209 20270301 20270505 20270513 20270606 20270815 20270816 20270914 20270915 20270916 20271003 20271004 20271009 20271011 20271225').split(' '));
const isOff=n=>{const w=dow(n);return w===0||w===6||HOLI.has(ymd(n))};
const nextSchoolDay=n=>{while(isOff(n))n++;return n};
const addSchoolDays=(n,k)=>{n=nextSchoolDay(n);while(k>0){n++;n=nextSchoolDay(n);k--}return n};

/* ---------- 통계 유틸 ----------
   사분위수: 선형보간(Hyndman-Fan type 7) = numpy.quantile(method="linear") = Excel QUARTILE.INC
   날짜 일련번호에 적용한 뒤 가장 가까운 날짜로 반올림(floor(x+0.5)). */
function quantile(sorted,p){const h=(sorted.length-1)*p,lo=Math.floor(h),hi=Math.min(lo+1,sorted.length-1);return sorted[lo]+(h-lo)*(sorted[hi]-sorted[lo])}
const rnd=x=>Math.floor(x+0.5);
function summarize(values){
  const v=[...values].sort((a,b)=>a-b);
  if(!v.length)return null;
  return {n:v.length,min:v[0],q1:rnd(quantile(v,.25)),med:rnd(quantile(v,.5)),q3:rnd(quantile(v,.75)),max:v[v.length-1],values:v};
}
const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;

/* ---------- 수집 결과(JSON) 적재 ----------
   collector/build_data.py 가 만든 docs/data/{학년도}/*.json 을 하나의 저장소(D)로 합칩니다.
   학교는 학교코드로 묶고, 학년도마다 조사 대상 여부(years)를 따로 기록합니다. */
const CAT_LABEL={EXAM:'정기 지필평가',EXAM_REVIEW:'시험(분류 불확실)',MOCK:'모의고사·학력평가',DIAG:'진단평가',ACHIEVE:'학업성취도평가',FORMATIVE:'형성·학기말 평가',
 ENTRANCE:'입학식',OPENING:'개학·시업식',VAC_START:'방학식',VACATION:'방학',CLOSING:'종업식',GRAD:'졸업식',DISCRETION:'재량휴업일',HOLIDAY:'공휴일',OTHER:'기타'};
const yd=x=>x==null?null:dn(Math.floor(x/10000),Math.floor(x/100)%100,x%100);
function newStore(){return {schools:[],byCode:new Map(),epBySchool:[],evBySchool:[],milestones:[],episodes:[],local:{},loaded:new Set(),raw:new Map()}}
function ingestYear(D,ay,f){
  const L=[];
  const C=f.schools.cols, ci=k=>C.indexOf(k);
  for(const r of f.schools.rows){
    const code=r[ci('code')];let s=D.byCode.get(code);
    if(!s){s={idx:D.schools.length,code,years:new Set(),info:{}};D.schools.push(s);D.byCode.set(code,s);D.epBySchool.push([]);D.evBySchool.push([]);D.milestones.push({})}
    // 가장 최근 학년도의 이름·홈페이지를 표시값으로
    if(!s.lastAy||ay>=s.lastAy){Object.assign(s,{name:r[ci('name')],region:r[ci('region')],level:r[ci('level')],hsType:r[ci('hsType')],homepage:r[ci('homepage')],lastAy:ay})}
    s.years.add(ay);s.info[ay]={loadDtm:r[ci('loadDtm')],schedLoadDtm:r[ci('schedLoadDtm')],inSchoolInfo:r[ci('inSchoolInfo')]};
    L.push(s.idx);
  }
  D.local[ay]=L;
  const E_=f.episodes,types=E_.types;
  for(const r of E_.rows){
    const [si,grade,sem,t,st,en,days,offs,nids,rid,reid]=r;const start=yd(st);
    const ep={s:L[si],a:ay,sem,type:types[t],grade,start,end:yd(en),days,dates:offs.map(o=>start+o),names:nids.map(i=>E_.names[i]),rule:E_.rules[rid],review:reid>=0,reason:reid>=0?E_.reasons[reid]:''};
    D.episodes.push(ep);D.epBySchool[ep.s].push(ep);
  }
  const V=f.events;
  for(const r of V.rows){const [si,c,a,b,g,ni,sem]=r;D.evBySchool[L[si]].push({a:ay,cat:V.cats[c],start:yd(a),end:yd(b),g,name:V.names[ni],sem})}
  const M=f.milestones;
  for(const r of M.rows){const o={};M.keys.forEach((k,i)=>{o[k]=yd(r[1+i])});o.discretion=new Set(r[1+M.keys.length].map(yd));D.milestones[L[r[0]]][ay]=o}
  D.loaded.add(ay);
}
function ingestRaw(D,ay,key,f){
  const L=D.local[ay];
  const rows=f.rows.map(r=>({s:L[r[0]],a:ay,d:yd(r[1]),n:f.names[r[2]],c:f.names[r[3]],g:r[4],h:r[5],cat:f.cats[r[6]],type:r[7]>=0?f.types[r[7]]:null,sem:r[8],rule:f.rules[r[9]]}));
  D.raw.set(ay+'|'+key,rows);return rows;
}

/* ---------- 통계 질의 ---------- */
function schoolsBy(D,region,level,ay){
  const ays=Array.isArray(ay)?ay:[ay];
  return D.schools.filter(s=>(region==='ALL'||s.region===region)&&(level==='ALL'||s.level===level)&&ays.some(a=>s.years.has(a)));
}
/* 학교별 시험 시작일을 먼저 하나로 정한 뒤 분포를 계산한다.
   grade='ALL' → 그 학교의 학년별 시작일 중 가장 이른 날 (학교 단위 1개 값)
   grade=k    → k학년 시험기간의 시작일
   검토 대상(review) 에피소드는 제외한다. (collector/build_data.py 의 검증 통계와 같은 정의) */
function examPerSchool(D,{ay,region,level,grade,sem,type}){
  const out=[];
  for(const s of schoolsBy(D,region,level,ay)){
    const eps=D.epBySchool[s.idx].filter(e=>e.a===ay&&e.sem===sem&&e.type===type&&!e.review&&(grade==='ALL'?e.grade>=1:e.grade===grade));
    if(!eps.length)continue;
    let first=eps[0];for(const e of eps)if(e.start<first.start)first=e;
    out.push({s,start:first.start,end:Math.max(...eps.map(e=>e.end)),days:first.days,eps});
  }
  return out;
}
function examStat(D,q){
  const den=schoolsBy(D,q.region,q.level,q.ay).length;
  const per=examPerSchool(D,q);
  const st=summarize(per.map(p=>p.start));
  const n=per.length;
  const res={...q,den,n,rate:den?n/den:null,per};
  if(st){Object.assign(res,st);res.lastEnd=Math.max(...per.map(p=>p.end));res.avgDays=mean(per.map(p=>p.days));}
  res.status=n===0?'none':n<THRESH.MIN_N?'insufficient':n<THRESH.WARN_N?'small':(res.rate<THRESH.LOW_RATE?'lowrate':'ok');
  return res;
}
function milestoneStat(D,{ay,region,level,key}){
  const ss=schoolsBy(D,region,level,ay);
  const vals=[];
  for(const s of ss){const m=D.milestones[s.idx][ay];if(m&&m[key]!=null)vals.push(m[key])}
  const st=summarize(vals)||{};
  const n=vals.length,den=ss.length;
  return {...st,n,den,rate:den?n/den:null,status:n===0?'none':n<THRESH.MIN_N?'insufficient':n<THRESH.WARN_N?'small':'ok'};
}
G.ENG={REGIONS,REGION_BY,LEVELS,LEVEL_SHORT,MAXG,TYPE_NAME,THRESH,CAT_LABEL,dn,fromYmd,parts,ymd,iso,dow,fmtD,fmtMD,monthOf,yearOf,ayOf,ayStart,ayEnd,mondayOf,isOff,
  quantile,summarize,mean,schoolsBy,examPerSchool,examStat,milestoneStat,newStore,ingestYear,ingestRaw};
})(typeof window!=='undefined'?window:globalThis);

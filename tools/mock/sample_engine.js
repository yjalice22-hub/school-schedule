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

/* ---------- 행사명 분류 ----------
   반환: {cat, type, semName, conf, rule}
   cat: EXAM | EXAM_REVIEW | MOCK | DIAG | ACHIEVE | FORMATIVE | ENTRANCE | OPENING | VAC_START | VACATION | CLOSING | GRAD | DISCRETION | HOLIDAY | OTHER */
const CAT_LABEL={EXAM:'정기 지필평가',EXAM_REVIEW:'시험(분류 불확실)',MOCK:'모의고사·학력평가',DIAG:'진단평가',ACHIEVE:'학업성취도평가',FORMATIVE:'형성·학기말 평가',
 ENTRANCE:'입학식',OPENING:'개학·시업식',VAC_START:'방학식',VACATION:'방학',CLOSING:'종업식',GRAD:'졸업식',DISCRETION:'재량휴업일',HOLIDAY:'공휴일',OTHER:'기타'};
const nameCache=new Map();
function classifyName(raw,level){
  const key=level+'|'+raw;
  if(nameCache.has(key))return nameCache.get(key);
  const n=raw.replace(/\(.*?\)|\[.*?\]|\s/g,'');
  const semM=raw.match(/([12])\s*학기/);
  const semName=semM?+semM[1]:null;
  const R=(cat,type=null,conf='high',rule='')=>({cat,type,semName,conf,rule});
  let r;
  if(/공휴일|대체휴일|토요휴업/.test(n))r=R('HOLIDAY',null,'high','공휴일');
  else if(/모의고사|모의평가|학력평가|수능|수학능력/.test(n))r=R('MOCK',null,'high','모의·학력평가 키워드');
  else if(/진단평가|진단검사|기초학력/.test(n))r=R('DIAG',null,'high','진단 키워드');
  else if(/학업성취도|성취도평가|자율평가/.test(n))r=R('ACHIEVE',null,'high','학업성취도 키워드');
  else if(/수행평가|재시험|결시|이의신청|채점|성적|정답|출제|감독|평가회|협의|연수|원안|대비|확인|공개|설명회/.test(n))r=R('OTHER',null,'high','시험 부속 행사 제외');
  else if(/입학식/.test(n))r=R('ENTRANCE');
  else if(/졸업식/.test(n))r=R('GRAD');
  else if(/재량휴업|재량휴일/.test(n))r=R('DISCRETION');
  else if(/방학식/.test(n))r=R('VAC_START');
  else if(/방학/.test(n))r=R('VACATION');
  else if(/종업식|수료식/.test(n))r=R('CLOSING');
  else if(/개학|시업식/.test(n))r=R('OPENING');
  else if(/형성평가|단원평가/.test(n))r=R('FORMATIVE');
  else if(level==='E'&&/학기말평가/.test(n))r=R('FORMATIVE',null,'high','초등 학기말 평가');
  else if(/중간고사|중간평가|중간시험/.test(n))r=R('EXAM','MID','high','"중간" 명시');
  else if(/기말고사|기말평가|기말시험|학기말고사/.test(n))r=R('EXAM','FINAL','high','"기말" 명시');
  else{
    const m=n.match(/제?([1-9])(차|회)(지필|정기|고사|평가|시험)/)||(/(지필|고사)/.test(n)&&n.match(/제?([1-9])(차|회)/));
    if(m){const k=+m[1];
      if(k===1)r=R('EXAM','MID','medium','서수 1차/1회 → 중간(추정)');
      else if(k===2)r=R('EXAM','FINAL','medium','서수 2차/2회 → 기말(추정)');
      else r=R('EXAM_REVIEW',null,'low',`서수 ${k}차 — 중간/기말 판단 불가`);
    }else if(/지필|정기고사|정기시험|정기평가/.test(n))r=R('EXAM_REVIEW',null,'low','시험 종류 표기 없음');
    else r=R('OTHER',null,'high','');
  }
  nameCache.set(key,r);return r;
}
const semOfDate=n=>{const m=monthOf(n);return m>=3&&m<=7?1:2};

/* ---------- 파이프라인 ----------
   입력 data = {schools:[{idx,code,name,region,level,homepage,loadDtm}], rows:[{s,a,d,n,c,g,h}]}
   g = 학년 비트마스크(bit0=1학년). NEIS의 ONE_GRADE_EVENT_YN … SIX_GRADE_EVENT_YN을 변환한 값. h = 수업공제일(휴업일) 여부 */
function build(data){
  const {schools,rows}=data;
  const rowsBySchool=schools.map(()=>[]);
  for(const r of rows){
    const s=schools[r.s];
    const k=classifyName(r.n,s.level);
    let sem=k.semName||semOfDate(r.d), note='';
    if(k.semName&&k.semName!==semOfDate(r.d))note='학기 표기와 날짜 불일치';
    r.k=k;r.sem=sem;r.note=note;
    rowsBySchool[r.s].push(r);
  }
  // 1) 시험 행 → 학교·학년도·학기·종류·학년 단위로 묶기
  const groups=new Map();
  for(const r of rows){
    if(r.k.cat!=='EXAM'&&r.k.cat!=='EXAM_REVIEW')continue;
    const s=schools[r.s], mg=MAXG[s.level];
    const typ=r.k.cat==='EXAM'?r.k.type:'UNK';
    const grades=[];for(let g=1;g<=mg;g++)if(r.g&(1<<(g-1)))grades.push(g);
    if(!grades.length)grades.push(0); // 학년 미지정
    for(const g of grades){
      const key=`${r.s}|${r.a}|${r.sem}|${typ}|${g}`;
      let e=groups.get(key);
      if(!e){e={s:r.s,a:r.a,sem:r.sem,type:typ,grade:g,dates:new Set(),names:new Set(),rules:new Set(),notes:new Set()};groups.set(key,e)}
      e.dates.add(r.d);e.names.add(r.n);e.rules.add(r.k.rule);if(r.note)e.notes.add(r.note);
    }
  }
  // 2) 날짜 간격이 14일을 넘으면 분리 (뒤 조각은 검토)
  const episodes=[];
  for(const e of groups.values()){
    const ds=[...e.dates].sort((a,b)=>a-b);
    let cur=[ds[0]],pieces=[cur];
    for(let i=1;i<ds.length;i++){if(ds[i]-ds[i-1]>THRESH.GAP_SPLIT){cur=[ds[i]];pieces.push(cur)}else cur.push(ds[i])}
    pieces.forEach((p,i)=>{
      const ep={s:e.s,a:e.a,sem:e.sem,type:e.type,grade:e.grade,start:p[0],end:p[p.length-1],days:p.length,dates:p,
        names:[...e.names],rule:[...e.rules].join(' / '),review:false,reason:''};
      const why=[];
      if(e.type==='UNK')why.push([...e.rules][0]||'시험 종류 불명');
      if(e.grade===0)why.push('학년 정보 없음(학년별 행사 여부 전부 N)');
      if(e.notes.size)why.push([...e.notes].join(','));
      if(i>0)why.push(`같은 시험명이 ${THRESH.GAP_SPLIT}일 이상 떨어져 재등록`);
      if(why.length){ep.review=true;ep.reason=why.join(' · ')}
      episodes.push(ep);
    });
  }
  // 3) 맥락 검사: 서수 기반(1차/2차) 추정은 학기 안의 순서·시기로 다시 확인
  const ctx=new Map();
  for(const ep of episodes){if(ep.review||ep.type==='UNK'||ep.grade===0)continue;
    const k=`${ep.s}|${ep.a}|${ep.sem}|${ep.grade}`;(ctx.get(k)||ctx.set(k,[]).get(k)).push(ep)}
  for(const list of ctx.values()){
    const mids=list.filter(e=>e.type==='MID'), fins=list.filter(e=>e.type==='FINAL');
    const ordinal=e=>/서수/.test(e.rule);
    if(mids.length&&fins.length){
      const m=Math.min(...mids.map(e=>e.start)), f=Math.min(...fins.map(e=>e.start));
      if(m>f)[...mids,...fins].forEach(e=>{e.review=true;e.reason='중간 시작일이 기말보다 늦음(순서 불일치)'});
    }
    if(mids.length&&!fins.length){
      for(const e of mids){
        if(!ordinal(e))continue;
        const [y,mo,d]=parts(e.start);
        const late=e.sem===1?(mo>6||(mo===6&&d>=15)):(mo===12||(mo===11&&d>=20)||mo<=2);
        if(late){e.review=true;e.reason='"1차" 지필이 학기말 시기에 단독 등록 — 기말일 가능성'}
      }
    }
  }
  const epBySchool=schools.map(()=>[]);
  for(const ep of episodes)epBySchool[ep.s].push(ep);

  // 4) 학교별 주요 학사일정(마일스톤)
  const milestones=schools.map(()=>({}));
  const MS_KEYS=['open1','summer','open2','winter','grad','diag','achieve','formative','entrance','closing'];
  for(let si=0;si<schools.length;si++){
    const byA={};
    for(const r of rowsBySchool[si]){
      const a=r.a, mo=monthOf(r.d), c=r.k.cat;
      const m=byA[a]||(byA[a]={discretion:new Set()});
      const setMin=(k)=>{if(m[k]==null||r.d<m[k])m[k]=r.d};
      if((c==='OPENING'||c==='ENTRANCE')&&mo===3)setMin('open1');
      if(c==='ENTRANCE')setMin('entrance');
      if(c==='VACATION'&&(mo===7||mo===8))setMin('summer');
      if(c==='OPENING'&&(mo===8||mo===9))setMin('open2');
      if(c==='VACATION'&&(mo===12||mo===1||mo===2)){ if(!/봄방학/.test(r.n))setMin('winter') }
      if(c==='GRAD')setMin('grad');
      if(c==='CLOSING')setMin('closing');
      if(c==='DIAG')setMin('diag');
      if(c==='ACHIEVE')setMin('achieve');
      if(c==='FORMATIVE')setMin('formative');
      if(c==='DISCRETION')m.discretion.add(r.d);
    }
    milestones[si]=byA;
  }
  return {schools,rows,rowsBySchool,episodes,epBySchool,milestones,MS_KEYS};
}

/* ---------- 통계 질의 ---------- */
function schoolsBy(D,region,level){
  return D.schools.filter(s=>(region==='ALL'||s.region===region)&&(level==='ALL'||s.level===level));
}
/* 학교별 시험 시작일을 먼저 하나로 정한 뒤 분포를 계산한다.
   grade='ALL' → 그 학교의 학년별 시작일 중 가장 이른 날 (학교 단위 1개 값)
   grade=k    → k학년 시험기간의 시작일
   검토 대상(review) 에피소드는 제외한다. */
function examPerSchool(D,{ay,region,level,grade,sem,type}){
  const out=[];
  for(const s of schoolsBy(D,region,level)){
    const eps=D.epBySchool[s.idx].filter(e=>e.a===ay&&e.sem===sem&&e.type===type&&!e.review&&(grade==='ALL'?e.grade>=1:e.grade===grade));
    if(!eps.length)continue;
    let first=eps[0];for(const e of eps)if(e.start<first.start)first=e;
    out.push({s,start:first.start,end:Math.max(...eps.map(e=>e.end)),days:first.days,eps});
  }
  return out;
}
function examStat(D,q){
  const den=schoolsBy(D,q.region,q.level).length;
  const per=examPerSchool(D,q);
  const st=summarize(per.map(p=>p.start));
  const n=per.length;
  const res={...q,den,n,rate:den?n/den:null,per};
  if(st){Object.assign(res,st);res.lastEnd=Math.max(...per.map(p=>p.end));res.avgDays=mean(per.map(p=>p.days));}
  res.status=n===0?'none':n<THRESH.MIN_N?'insufficient':n<THRESH.WARN_N?'small':(res.rate<THRESH.LOW_RATE?'lowrate':'ok');
  return res;
}
// 마일스톤 통계 (방학·개학 등)
function milestoneStat(D,{ay,region,level,key}){
  const ss=schoolsBy(D,region,level);
  const vals=[];
  for(const s of ss){const m=D.milestones[s.idx][ay];if(m&&m[key]!=null)vals.push(m[key])}
  const st=summarize(vals)||{};
  const n=vals.length,den=ss.length;
  return {...st,n,den,rate:den?n/den:null,status:n===0?'none':n<THRESH.MIN_N?'insufficient':n<THRESH.WARN_N?'small':'ok'};
}
function yearCoverage(D,ay){
  const has=new Set();for(const r of D.rows)if(r.a===ay)has.add(r.s);
  return {schools:D.schools.length,withData:has.size,coverage:has.size/D.schools.length,ok:has.size/D.schools.length>=THRESH.YEAR_COVERAGE};
}

/* ---------- 샘플 데이터 생성기 ----------
   실제 NEIS 응답 필드 구조(학교코드·학년도·일자·행사명·행사내용·학년별 여부·수업공제일)를 흉내 낸 가상 데이터.
   2단계에서는 이 함수 대신 수집기가 만든 JSON을 불러온다. */
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
function generateSample(todayN){
  const rng=mulberry32(20261109);
  const N=()=>(rng()+rng()+rng()+rng()-2)*1.73;
  const ri=(a,b)=>a+Math.floor(rng()*(b-a+1));
  const pick=a=>a[Math.floor(rng()*a.length)];
  const SYL=['가람','가온','나래','누리','다온','도담','라온','마루','미르','바름','새솔','소담','아름','온새','윤슬','은솔','이든','하람','한울','해솔','다솜','초롱','늘봄','별빛','세움','들꽃','푸름','한결','그루','너울','모아','시나','여울','자람','찬솔','타래','파랑','하늬','다올','라엘'];
  const schools=[],rows=[];
  const regionOff={},freeSem={};
  REGIONS.forEach(r=>{regionOff[r.code]={};['S1MID','S1FIN','S2MID','S2FIN','VAC','WIN'].forEach(k=>regionOff[r.code][k]=Math.round(N()*2.5));freeSem[r.code]=rng()<0.7?2:1});
  const STYLES=[{MID:'중간고사',FINAL:'기말고사'},{MID:'1차 지필평가',FINAL:'2차 지필평가'},{MID:'1회고사',FINAL:'2회고사'},{MID:'중간평가',FINAL:'기말평가'},{MID:'제1회 지필고사',FINAL:'제2회 지필고사'},{MID:'1차 지필고사',FINAL:'2차 지필고사'}];
  REGIONS.forEach(r=>{['E','M','H'].forEach((lv,li)=>{
    const cnt=Math.max(2,Math.round(r.n[li]/10));
    for(let i=0;i<cnt;i++){
      const idx=schools.length;
      const nm=`샘플${SYL[i%SYL.length]}${i>=SYL.length?Math.floor(i/SYL.length)+1:''}${lv==='E'?'초등학교':lv==='M'?'중학교':'고등학교'}`;
      schools.push({idx,code:r.code.slice(0,1)+String(1000000+idx*37%9000000).slice(1)+lv,name:nm,region:r.code,level:lv,homepage:null,
        style:pick(STYLES),stylePrefix:rng()<0.5,daySuffix:rng()<0.2,registers:rng()<(lv==='M'?0.9:lv==='H'?0.94:1),gradeDiff:rng()<0.25,
        loadDtm:null});
    }
  })});
  const BASE={M:{S1MID:[4,27],S1FIN:[7,1],S2MID:[10,12],S2FIN:[12,7]},H:{S1MID:[4,22],S1FIN:[6,29],S2MID:[10,5],S2FIN:[12,3]}};
  const DISC={2025:[[5,2],[6,2],[10,2],[10,10],[11,14]],2026:[[5,4],[6,5],[9,23],[10,2],[10,8]]};
  function add(s,a,d,n,g,h=false,c=''){rows.push({s,a,d,n,c,g,h})}
  for(const y of [2025,2026]){
    const ys=y===2025?-1:0;
    for(const s of schools){
      const i=s.idx,lv=s.level,all=lv==='E'?0b111111:0b111,top=lv==='E'?0b100000:0b100,ro=regionOff[s.region];
      const open1=nextSchoolDay(dn(y,3,2));
      add(i,y,open1,pick(['시업식','개학식','1학기 개학식']),all);
      add(i,y,open1,'입학식',1);
      if(lv!=='E'&&s.registers){
        const fs=freeSem[s.region];
        for(const [key,sem,type] of [['S1MID',1,'MID'],['S1FIN',1,'FINAL'],['S2MID',2,'MID'],['S2FIN',2,'FINAL']]){
          const b=BASE[lv][key];
          const common=nextSchoolDay(dn(y,b[0],b[1])+ys+ro[key]+Math.round(N()*3.2));
          const dur=pick(lv==='M'?[2,3,3,3,4]:[3,4,4,4,5]);
          const skipSchoolMid=key==='S2MID'&&rng()<0.05;
          if(skipSchoolMid&&lv==='M')continue;
          const starts={};
          for(let g=1;g<=3;g++){
            if(lv==='M'&&g===1&&sem===fs)continue;               // 자유학기: 정기 지필 없음
            if(lv==='M'&&g===1&&type==='MID'&&rng()<0.3)continue;   // 자유학기 외 학기에도 중간 생략
            let st=common;
            if(g===3&&key==='S2FIN'&&lv==='M'&&rng()<0.75)st=nextSchoolDay(dn(y,11,23)+ys+Math.round(N()*3));
            else if(g===3&&key==='S2FIN'&&lv==='H'&&rng()<0.85)st=nextSchoolDay(dn(y,10,26)+ys+Math.round(N()*3));
            else if(g===3&&key==='S2MID'&&lv==='H'&&rng()<0.85)st=nextSchoolDay(dn(y,9,14)+ys+Math.round(N()*3));
            else if(g===3&&s.gradeDiff)st=nextSchoolDay(common+ri(-4,4));
            starts[g]=st;
          }
          const byStart={};for(const g in starts)(byStart[starts[g]]=byStart[starts[g]]||[]).push(+g);
          for(const st in byStart){
            let mask=byStart[st].reduce((m,g)=>m|(1<<(g-1)),0);
            if(mask===all&&rng()<0.02)mask=0;
            let base=s.style[type];
            if(rng()<0.025)base=pick(['지필평가','정기고사']);
            if(type==='FINAL'&&key==='S2FIN'&&s.style.MID.startsWith('1차')&&rng()<0.04)base='1차 지필평가';
            let d=+st;
            for(let k=0;k<dur;k++){
              const nm=(s.stylePrefix?`${sem}학기 `:'')+base+(s.daySuffix?`(${k+1}일차)`:'');
              add(i,y,d,nm,mask,false,rng()<0.15?'정기 지필평가 실시':'');
              d=addSchoolDays(d,1);
            }
          }
        }
        if(lv==='H'){
          for(const [m,dd] of [[3,24],[6,4],[9,2],[10,20]])add(i,y,nextSchoolDay(dn(y,m,dd)),pick(['전국연합학력평가','3월 전국연합학력평가','학력평가']),rng()<0.7?0b111:0b100);
          add(i,y,y===2025?dn(2025,11,13):dn(2026,11,19),'대학수학능력시험(재량휴업)',0b111,true);
          add(i,y,nextSchoolDay(dn(y,4,15)+ri(-5,5)),'수행평가 주간 안내',0b111);
        }
        add(i,y,nextSchoolDay(dn(y,5,20)+ri(-6,6)),'체육대회',0b111);
        add(i,y,nextSchoolDay(dn(y,4,27)+ys+ro.S1MID+ri(10,16)),pick(['1차 지필평가 성적 확인','성적 이의신청 기간','결시생 재시험']),0b111);
      }
      if(lv==='E'){
        if(rng()<0.65)add(i,y,addSchoolDays(open1,ri(4,10)),pick(['기초학력 진단평가','진단평가','3월 진단평가']),rng()<0.6?0b111110:0b111100);
        if(rng()<0.25)add(i,y,nextSchoolDay(dn(y,10,20)+Math.round(N()*6)),pick(['학업성취도 평가','맞춤형 학업성취도 자율평가']),rng()<0.6?0b111100:0b100100);
        if(rng()<0.06)add(i,y,nextSchoolDay(dn(y,6,24)+ri(-4,4)),'학기말 평가',0b111100);
        if(rng()<0.06)add(i,y,nextSchoolDay(dn(y,12,10)+ri(-4,4)),pick(['학기말 평가','단원평가 주간']),0b111100);
        if(rng()<0.006)add(i,y,nextSchoolDay(dn(y,12,15)),'기말고사',0b110000);
        add(i,y,nextSchoolDay(dn(y,10,15)+ri(-10,10)),'현장체험학습',all);
      }
      // 재량휴업일
      const dd=[...DISC[y]];for(let k=dd.length-1;k>0;k--){const j=Math.floor(rng()*(k+1));[dd[k],dd[j]]=[dd[j],dd[k]]}const disc=dd.slice(0,ri(1,3)); // 정렬 비교함수에 난수를 쓰면 엔진마다 결과가 달라지므로 Fisher-Yates 사용
      for(const [m,dd] of disc)add(i,y,dn(y,m,dd),pick(['재량휴업일','학교장 재량휴업일']),all,true);
      // 여름방학
      const vOff=lv==='E'?1:lv==='M'?0:-4, oOff=lv==='E'?3:lv==='M'?0:-4;
      const vs=nextSchoolDay(dn(y,7,21)+vOff+ro.VAC+Math.round(N()*2));
      const o2=nextSchoolDay(dn(y,8,14)+oOff+ro.VAC+Math.round(N()*2));
      add(i,y,vs,pick(['여름방학식','방학식']),all);
      for(let d=vs+1;d<o2;d++)if(!isOff(d))add(i,y,d,'여름방학',all,true);
      add(i,y,o2,pick(['개학식','2학기 개학식','2학기 개학']),all);
      // 겨울방학·졸업 (통합형 1월 / 분리형 12월+2월)
      if(rng()<0.72){
        const w=nextSchoolDay(dn(y+1,1,6)+(lv==='E'?0:lv==='M'?1:2)+ro.WIN+Math.round(N()*2));
        add(i,y,w,pick(['겨울방학식','방학식']),all);add(i,y,w,'졸업식',top);add(i,y,w,'종업식',all);
        for(let d=w+1;d<dn(y+1,3,1);d++)if(!isOff(d))add(i,y,d,'겨울방학',all,true);
      }else{
        const w=nextSchoolDay(dn(y,12,29)+ri(-3,1)),g=nextSchoolDay(dn(y+1,2,10)+ri(-2,3));
        add(i,y,w,'겨울방학식',all);
        for(let d=w+1;d<g-2;d++)if(!isOff(d))add(i,y,d,'겨울방학',all,true);
        add(i,y,g,'졸업식',top);add(i,y,g+1,'종업식',all);
        for(let d=g+2;d<dn(y+1,3,1);d++)if(!isOff(d))add(i,y,d,'봄방학',all,true);
      }
    }
  }
  // 다음 학년도(2027): 일부 학교만 등록된 상태를 재현
  for(const s of schools){
    if(rng()<0.06){const o=nextSchoolDay(dn(2027,3,2));add(s.idx,2027,o,'입학식',1);add(s.idx,2027,o,'시업식',s.level==='E'?63:7)}
    if(s.level!=='E'&&rng()<0.015){let d=nextSchoolDay(dn(2027,4,26));for(let k=0;k<3;k++){add(s.idx,2027,d,'1학기 중간고사',7);d=addSchoolDays(d,1)}}
  }
  for(const s of schools){const d=todayN-ri(3,120);s.loadDtm=iso(d)+' '+pad(ri(0,23))+':'+pad(ri(0,59))+':00'}
  return {schools,rows,meta:{source:'sample',generatedAt:iso(todayN)+' 06:00 (KST)',lastRun:null,failedSchools:null}};
}

G.ENG={REGIONS,REGION_BY,LEVELS,LEVEL_SHORT,MAXG,TYPE_NAME,THRESH,CAT_LABEL,dn,fromYmd,parts,ymd,iso,dow,fmtD,fmtMD,monthOf,yearOf,ayOf,ayStart,ayEnd,mondayOf,isOff,
  quantile,summarize,mean,classifyName,semOfDate,build,schoolsBy,examPerSchool,examStat,milestoneStat,yearCoverage,generateSample};
})(typeof window!=='undefined'?window:globalThis);

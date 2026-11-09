/* ================================================================
   UI — 화면, 차트, 표, 내보내기
   ================================================================ */
(function(){
'use strict';
const E=window.ENG;
const {REGIONS,REGION_BY,LEVELS,LEVEL_SHORT,MAXG,TYPE_NAME,THRESH,CAT_LABEL,dn,parts,iso,dow,fmtD,fmtMD,monthOf,ayStart,ayEnd,mondayOf,isOff}=E;
const $=(s,r=document)=>r.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pct=x=>x==null?'–':(x*100).toFixed(1)+'%';
const fix1=x=>x==null?'–':x.toFixed(1);

/* ---------- 오늘(KST) ---------- */
const TODAY=(()=>{const k=new Date(Date.now()+9*3600e3);return dn(k.getUTCFullYear(),k.getUTCMonth()+1,k.getUTCDate())})();
const CUR_AY=E.ayOf(TODAY);
let AYS=[CUR_AY-1,CUR_AY,CUR_AY+1];

/* ---------- 데이터 로드 ----------
   수집기(collector)가 만든 data/manifest.json 과 data/{학년도}/*.json 을 읽습니다.
   학년도 파일은 화면에 필요할 때만 불러옵니다. */
const DATA='data/';
let D=E.newStore(),META=null;
const IS_REAL=()=>META&&META.source==='NEIS';
async function getJSON(p){const r=await fetch(DATA+p,{cache:'no-cache'});if(!r.ok)throw new Error(`${p} (${r.status})`);return r.json()}
const pend={};
function ensureYear(ay){
  if(!META||!META.years.includes(ay)||D.loaded.has(ay))return Promise.resolve();
  return pend[ay]||(pend[ay]=Promise.all(['schools','episodes','events','milestones'].map(k=>getJSON(`${ay}/${k}.json`)))
    .then(([schools,episodes,events,milestones])=>E.ingestYear(D,ay,{schools,episodes,events,milestones})));
}
async function ensureRaw(ay,region,level){
  const key=`${region}_${level}`;if(D.raw.has(ay+'|'+key))return D.raw.get(ay+'|'+key);
  try{return E.ingestRaw(D,ay,key,await getJSON(`${ay}/raw/${key}.json`))}catch(e){D.raw.set(ay+'|'+key,[]);return []}
}
const yInfo=ay=>(META&&META.yearInfo&&META.yearInfo[ay])||null;
const fmtTs=t=>t?String(t).replace('T',' ').slice(0,16):'–';
const RUN_LABEL={success:'성공',partial:'일부 실패',failed:'실패',stopped_daily_limit:'중단(일일 호출 한도)',running:'진행 중'};

/* ---------- 상태 & 라우팅 ---------- */
const state={ay:CUR_AY,calYear:E.parts(TODAY)[0],region:'ALL',level:'M',grade:'ALL',sem:'ALL',type:'ALL',
  rSem:2,rType:'FINAL',rLevel:'M',rGrade:'ALL',gLevel:'M',gSem:2,gType:'FINAL',eGrade:'ALL',msKey:'summer',
  pick:null,school:null,schoolQ:'',calPick:null,cLevel:'ALL',cGrade:'ALL'};
try{const saved=JSON.parse(localStorage.getItem('neis-dash-filters')||'null');if(saved)Object.assign(state,saved,{pick:null,school:null,calPick:null})}catch(e){}
const saveState=()=>{try{const {pick,school,calPick,...rest}=state;localStorage.setItem('neis-dash-filters',JSON.stringify(rest))}catch(e){}};

const PAGES=[
  {id:'exams',no:'1',title:'시험 일정 분석',grp:'시험'},
  {id:'grades',no:'2',title:'학년별 시험 일정',grp:'시험'},
  {id:'regions',no:'3',title:'지역별 비교',grp:'시험'},
  {id:'elementary',no:'4',title:'초등학교 학사일정',grp:'학사일정'},
  {id:'common',no:'5',title:'방학·개학 공통일정',grp:'학사일정'},
  {id:'calendar',no:'6',title:'연간 캘린더',grp:'학사일정'},
  {id:'school',no:'7',title:'학교별 상세',grp:'조회·검증'},
  {id:'review',no:'8',title:'분류 검토 목록',grp:'조회·검증'},
  {id:'data',no:'9',title:'데이터·갱신·방법론',grp:'조회·검증'},
];
const route=()=>{const h=location.hash.slice(1);return PAGES.find(p=>p.id===h)?h:'exams'};
function renderNav(){
  const cur=route();let html='',g='';
  for(const p of PAGES){if(p.grp!==g){g=p.grp;html+=`<div class="navgroup">${g}</div>`}
    html+=`<a href="#${p.id}" ${p.id===cur?'aria-current="page"':''}><span class="no">${p.no}</span>${p.title}</a>`}
  $('#nav').innerHTML=html;
  const nextRun=(()=>{let d=TODAY+1;while(dow(d)!==1)d++;return d})();
  const lr=META.lastRun||{};
  $('#statusBox').innerHTML=`<div>${IS_REAL()?'<span class="chip ok">NEIS 공식 데이터</span>':'<span class="chip sample">모의 데이터</span>'}</div>
   <div>마지막 수집 <b>${fmtTs(lr.finishedAt)}</b></div><div>결과 <b>${RUN_LABEL[lr.status]||'–'}</b>${lr.status&&lr.status!=='success'?' <span class="chip warn">확인</span>':''}</div>
   <div>실패 학교 <b>${Object.values(lr.yearResults||{}).reduce((t,y)=>t+(y.failedSchools||0),0)}곳</b></div><div>다음 정기 갱신 <b>${fmtD(nextRun)} 06:00</b></div>
   <div style="color:var(--muted)">출처: 교육부 나이스 교육정보 개방 포털 (open.neis.go.kr)</div>`;
  const bar=$('#srcBar');
  bar.className=IS_REAL()?'sample-bar real':'sample-bar';
  bar.innerHTML=IS_REAL()?`<span class="chip ok">출처</span><span>교육부 나이스(NEIS) 교육정보 개방 포털 학사일정·학교기본정보 · 마지막 수집 ${fmtTs(lr.finishedAt)} · 학교가 직접 입력한 자료이므로 등록률을 함께 확인하세요.</span>`
    :`<span class="chip sample">모의 데이터</span><span>지금 보이는 수치는 수집기 시험용 <b>모의 NEIS 서버</b>에서 받은 가상 데이터입니다. 실제 NEIS 수집을 실행하면 이 표시가 사라집니다.</span>`;
}

/* ---------- 필터 바 ---------- */
const OPT={
  ay:()=>AYS.map(a=>[a,`${a}학년도${a===CUR_AY?' (현재)':a===CUR_AY+1?' (다음)':''}${META.years.includes(a)?'':' · 미수집'}`]),
  calYear:()=>[...new Set([...AYS,...AYS.map(a=>a+1)])].sort((a,b)=>a-b).filter(y=>y<=CUR_AY+1).map(y=>[y,`${y}년`]),
  region:()=>[['ALL','전국'],...REGIONS.map(r=>[r.code,r.name])],
  levelAll:()=>[['E','초등학교'],['M','중학교'],['H','고등학교']],
  levelMH:()=>[['M','중학교'],['H','고등학교']],
  levelAny:()=>[['ALL','전체'],['E','초등학교'],['M','중학교'],['H','고등학교']],
  grade:(lv)=>[['ALL','전체 학년'],...Array.from({length:lv==='ALL'?6:MAXG[lv]},(_,i)=>[i+1,`${i+1}학년`])],
  semAll:()=>[['ALL','1·2학기'],[1,'1학기'],[2,'2학기']],
  sem:()=>[[1,'1학기'],[2,'2학기']],
  typeAll:()=>[['ALL','중간·기말'],['MID','중간고사'],['FINAL','기말고사']],
  type:()=>[['MID','중간고사'],['FINAL','기말고사']],
  ms:()=>MS.map(m=>[m.key,m.label]),
};
function filterBar(defs){
  // defs: [ [stateKey, label, optFn, optArg] ]
  return `<div class="filters" role="group" aria-label="필터">${defs.map(([k,l,f,arg])=>{
    const opts=OPT[f](arg);return `<label for="f-${k}">${l}<select id="f-${k}" data-k="${k}">${opts.map(([v,t])=>`<option value="${v}" ${String(state[k])===String(v)?'selected':''}>${esc(t)}</option>`).join('')}</select></label>`}).join('')}</div>`;
}
function bindFilters(root){
  root.querySelectorAll('.filters select').forEach(sel=>sel.addEventListener('change',()=>{
    const k=sel.dataset.k;let v=sel.value;
    if(v!=='ALL'&&/^\d+$/.test(v))v=+v;
    state[k]=v;
    // 학교급을 바꾸면 범위를 벗어난 학년은 전체로
    const fix=(lk,gk)=>{const lv=state[lk];if(state[gk]!=='ALL'&&lv!=='ALL'&&state[gk]>MAXG[lv])state[gk]='ALL'};
    fix('level','grade');fix('rLevel','rGrade');fix('cLevel','cGrade');
    if(k!=='pick')state.pick=null;
    saveState();render();
  }));
}
function yearNotice(ay){
  const y=yInfo(ay);
  if(!y)return `<div class="notice"><b>${ay}학년도 데이터가 아직 수집되지 않았습니다.</b> 다음 정기 수집 또는 수동 실행 후 표시됩니다.</div>`;
  let msg='';
  if(y.lastAttempt)msg+=`<div class="notice">최근 수집 시도(${fmtTs(y.lastAttempt.at)})에서 ${esc(y.lastAttempt.message)} 화면은 ${fmtTs(y.collectedAt)} 수집본입니다.</div>`;
  if((y.coverage||0)>=THRESH.YEAR_COVERAGE)return msg;
  return msg+`<div class="notice"><b>아직 등록된 데이터가 충분하지 않습니다.</b> ${ay}학년도 학사일정을 등록한 학교는 ${(y.schoolsWithSchedule||0).toLocaleString()}곳(${pct(y.coverage||0)})입니다. 이전 학년도 통계를 대신 보여주지 않으며, 등록률이 ${pct(THRESH.YEAR_COVERAGE)} 이상이 되면 통계를 표시합니다.</div>`;
}
const statusChip=st=>({none:'<span class="chip mute">등록 정보 없음</span>',insufficient:'<span class="chip bad">데이터 부족</span>',small:'<span class="chip warn">표본 부족</span>',lowrate:'<span class="chip warn">등록률 낮음</span>',ok:'<span class="chip ok">정상</span>'}[st]||'');
const statusText=st=>({none:'등록 정보 없음',insufficient:'데이터 부족',small:'표본 부족',lowrate:'등록률 낮음',ok:'정상'}[st]||'');

/* ---------- 툴팁 · 토스트 ---------- */
const tip=$('#tip');
document.addEventListener('pointermove',e=>{
  const t=e.target.closest&&e.target.closest('[data-tip]');
  if(!t){tip.hidden=true;return}
  tip.textContent=t.getAttribute('data-tip');tip.hidden=false;
  const w=tip.offsetWidth,h=tip.offsetHeight;
  let x=e.clientX+14,y=e.clientY+14;if(x+w>innerWidth-8)x=e.clientX-w-14;if(y+h>innerHeight-8)y=e.clientY-h-14;
  tip.style.left=x+'px';tip.style.top=y+'px';
});
document.addEventListener('pointerleave',()=>tip.hidden=true);
function toast(msg){const t=document.createElement('div');t.className='toast';t.textContent=msg;document.body.appendChild(t);setTimeout(()=>t.remove(),2600)}

/* ---------- 내보내기 ---------- */
let dlNS;
async function saveFile(filename,data){
  try{
    if(window.claude&&window.claude.use){
      if(dlNS===undefined)dlNS=await window.claude.use('downloads');
      if(dlNS){await dlNS.save({filename,data});toast(`${filename} 저장을 요청했습니다`);return}
    }
  }catch(e){if(e&&e.code==='declined'){toast('저장을 취소했습니다');return}if(e&&e.code==='rate_limited'){toast('잠시 후 다시 시도하세요');return}}
  try{const blob=data instanceof Blob?data:new Blob([data]);const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),4000)}
  catch(e){toast('이 화면에서는 파일 저장을 사용할 수 없습니다')}
}
const csvCell=v=>{v=v==null?'':String(v);return /[",\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v};
function toCSV(aoa){return '﻿'+aoa.map(r=>r.map(csvCell).join(',')).join('\r\n')}
function saveCSV(name,aoa){saveFile(name+'.csv',toCSV(aoa))}
function saveXLSX(name,sheets){
  if(!window.XLSX){toast('Excel 라이브러리를 불러오지 못해 CSV로 저장합니다');saveCSV(name,sheets[0][1]);return}
  const wb=XLSX.utils.book_new();
  for(const [sn,aoa] of sheets)XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(aoa),sn.slice(0,31));
  const buf=XLSX.write(wb,{type:'array',bookType:'xlsx'});
  saveFile(name+'.xlsx',new Blob([buf]));
}
async function savePNG(svg,name){
  const clone=svg.cloneNode(true);
  const src=svg.querySelectorAll('*'),dst=clone.querySelectorAll('*');
  const props=['fill','stroke','stroke-width','opacity','fill-opacity','stroke-opacity','font-size','font-weight','text-anchor','dominant-baseline','stroke-dasharray'];
  src.forEach((el,i)=>{const cs=getComputedStyle(el);props.forEach(p=>{const v=cs.getPropertyValue(p);if(v)dst[i].setAttribute(p,v)});dst[i].removeAttribute('class');dst[i].removeAttribute('style')});
  const vb=svg.viewBox.baseVal,sc=2;
  clone.setAttribute('width',vb.width*sc);clone.setAttribute('height',vb.height*sc);
  const bg=document.createElementNS('http://www.w3.org/2000/svg','rect');
  bg.setAttribute('x',vb.x);bg.setAttribute('y',vb.y);bg.setAttribute('width',vb.width);bg.setAttribute('height',vb.height);bg.setAttribute('fill',getComputedStyle(document.body).backgroundColor);
  clone.insertBefore(bg,clone.firstChild);
  clone.setAttribute('font-family',getComputedStyle(document.body).fontFamily);
  const s=new XMLSerializer().serializeToString(clone);
  const img=new Image();img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(s);
  try{await img.decode()}catch(e){toast('이미지 변환에 실패했습니다');return}
  const c=document.createElement('canvas');c.width=vb.width*sc;c.height=vb.height*sc;
  c.getContext('2d').drawImage(img,0,0);
  c.toBlob(b=>b&&saveFile(name+'.png',b),'image/png');
}
function chartCard(id,title,desc,extraBtns=''){
  return `<section class="card"><div class="card-h"><div><h3>${title}</h3>${desc?`<p>${desc}</p>`:''}</div><div class="btns">${extraBtns}<button class="btn" data-png="${id}">이미지 저장</button></div></div><div class="chart" id="${id}"></div></section>`;
}
function bindPNG(root){root.querySelectorAll('[data-png]').forEach(b=>b.addEventListener('click',()=>{const svg=$('#'+b.dataset.png+' svg');if(svg)savePNG(svg,b.dataset.png+'_'+iso(TODAY))}))}

/* ---------- 표 ---------- */
/* columns: {k,label,t:'text'|'num'|'int'|'pct'|'date'|'range'|'html', get?} */
function fmtCell(c,r){
  const v=c.get?c.get(r):r[c.k];
  switch(c.t){
    case 'date':return v==null?'–':fmtD(v);
    case 'pct':return pct(v);
    case 'num':return v==null?'–':fix1(v);
    case 'int':return v==null?'–':v.toLocaleString();
    case 'range':return v&&v[0]!=null?`${fmtMD(v[0])} ~ ${fmtMD(v[1])}`:'–';
    case 'html':return v??'';
    default:return esc(v??'–');
  }
}
function csvVal(c,r){
  const v=c.csv?c.csv(r):(c.get?c.get(r):r[c.k]);
  switch(c.t){
    case 'date':return v==null?'':iso(v);
    case 'pct':return v==null?'':(v*100).toFixed(1);
    case 'num':return v==null?'':v.toFixed(2);
    case 'range':return v&&v[0]!=null?`${iso(v[0])} ~ ${iso(v[1])}`:'';
    default:return v??'';
  }
}
const sortVal=(c,r)=>{const v=c.sort?c.sort(r):(c.get?c.get(r):r[c.k]);return Array.isArray(v)?v[0]:v};
function table(host,{columns,rows,name,onRow,isSel,limit=400,search=true,dim}){
  let q='',sk=null,sd=1;
  const wrap=document.createElement('div');wrap.style.cssText='display:flex;flex-direction:column;gap:8px;min-width:0';
  wrap.innerHTML=`<div class="tbl-tools">${search?`<input type="search" placeholder="표 안에서 검색" aria-label="표 검색" id="q-${name}">`:''}<span class="cnt"></span><button class="btn" data-x="csv">CSV</button><button class="btn" data-x="xlsx">Excel</button></div><div class="tbl-wrap"><table><thead></thead><tbody></tbody></table></div>`;
  host.appendChild(wrap);
  const view=()=>{
    let rs=rows;
    if(q){const ql=q.toLowerCase();rs=rs.filter(r=>columns.some(c=>String(c.t==='html'?(c.csv?c.csv(r):''):fmtCell(c,r)).toLowerCase().includes(ql)))}
    if(sk){const c=columns.find(c=>c.k===sk);rs=[...rs].sort((a,b)=>{const x=sortVal(c,a),y=sortVal(c,b);if(x==null&&y==null)return 0;if(x==null)return 1;if(y==null)return -1;return (x>y?1:x<y?-1:0)*sd})}
    return rs;
  };
  const draw=()=>{
    const rs=view();
    wrap.querySelector('thead').innerHTML='<tr>'+columns.map(c=>`<th class="${['int','num','pct'].includes(c.t)?'num':''}" ${sk===c.k?`aria-sort="${sd>0?'ascending':'descending'}"`:''}><button data-k="${c.k}">${esc(c.label)}${sk===c.k?(sd>0?' ▲':' ▼'):''}</button></th>`).join('')+'</tr>';
    wrap.querySelector('tbody').innerHTML=rs.slice(0,limit).map((r,i)=>`<tr data-i="${rows.indexOf(r)}" class="${onRow?'clickable':''} ${isSel&&isSel(r)?'sel':''}">${columns.map(c=>`<td class="${['int','num','pct'].includes(c.t)?'num':''} ${dim&&dim(r)?'dim':''}">${fmtCell(c,r)}</td>`).join('')}</tr>`).join('')||`<tr><td colspan="${columns.length}" class="dim">표시할 행이 없습니다</td></tr>`;
    wrap.querySelector('.cnt').textContent=`${rs.length.toLocaleString()}행${rs.length>limit?` (상위 ${limit}행 표시, 내보내기는 전체)`:''}`;
    wrap.querySelectorAll('th button').forEach(b=>b.onclick=()=>{if(sk===b.dataset.k)sd=-sd;else{sk=b.dataset.k;sd=1}draw()});
    if(onRow)wrap.querySelectorAll('tbody tr[data-i]').forEach(tr=>tr.onclick=()=>onRow(rows[+tr.dataset.i]));
  };
  if(search)wrap.querySelector('input').addEventListener('input',e=>{q=e.target.value;draw()});
  const aoa=()=>[columns.map(c=>c.label),...view().map(r=>columns.map(c=>csvVal(c,r)))];
  const fname=`${name}_${iso(TODAY)}`;
  wrap.querySelector('[data-x="csv"]').onclick=()=>saveCSV(fname,aoa());
  wrap.querySelector('[data-x="xlsx"]').onclick=()=>saveXLSX(fname,[[name,aoa()]]);
  draw();
}

/* ---------- SVG 차트 ---------- */
const NS='http://www.w3.org/2000/svg';
const svgOpen=(w,h,label)=>`<svg xmlns="${NS}" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(label)}">`;
const widthOf=id=>Math.max(340,Math.floor(($('#'+id)?.clientWidth||900)));
function dateTicks(lo,hi,maxTicks){
  const span=hi-lo;
  if(span>120){const out=[];let [y,m]=parts(lo);m++;if(m>12){m=1;y++}for(let d=dn(y,m,1);d<=hi;){out.push({d,l:`${parts(d)[1]}월`});m++;if(m>12){m=1;y++}d=dn(y,m,1)}return out}
  let step=7;while(span/step>maxTicks)step+=7;
  const out=[];for(let d=mondayOf(lo)+7;d<=hi;d+=step)out.push({d,l:fmtMD(d)});return out;
}
/* 범위 차트: 행마다 최솟값~최댓값 선, 25~75% 막대, 중앙값 표시, (선택) 학교별 점 */
function rangeChart(id,rows,{dots=false,dotsOnly=false,label='시작일 분포',lo,hi,showN=true}={}){
  const host=$('#'+id);if(!host)return;
  const ok=rows.filter(r=>r.st&&r.st.n>=THRESH.MIN_N);
  if(lo==null){const all=ok.flatMap(r=>[r.st.min,r.st.max]);if(!all.length){host.innerHTML='<p class="notice info">차트로 표시할 만큼 등록된 데이터가 없습니다.</p>';return}lo=Math.min(...all)-2;hi=Math.max(...all)+2}
  const W=widthOf(id),L=118,R=showN?78:16,T=26,RH=26,H=T+rows.length*RH+10;
  const x=d=>L+(d-lo)/(hi-lo)*(W-L-R);
  let s=svgOpen(W,H,label);
  for(const t of dateTicks(lo,hi,Math.floor((W-L-R)/70))){const X=x(t.d);s+=`<line x1="${X}" x2="${X}" y1="${T-4}" y2="${H-6}" style="stroke:var(--line2)"/><text x="${X}" y="${T-10}" text-anchor="middle" style="fill:var(--muted);font-size:11px">${t.l}</text>`}
  if(TODAY>=lo&&TODAY<=hi){const X=x(TODAY);s+=`<line x1="${X}" x2="${X}" y1="${T-4}" y2="${H-6}" style="stroke:var(--today);stroke-dasharray:3 3"/>`}
  rows.forEach((r,i)=>{
    const y=T+i*RH+RH/2, st=r.st, color=r.color||'var(--s-exam)';
    s+=`<text x="${L-10}" y="${y+4}" text-anchor="end" style="fill:var(--ink);font-size:12px">${esc(r.label)}</text>`;
    if(!st||st.n<THRESH.MIN_N){s+=`<text x="${L+4}" y="${y+4}" style="fill:var(--muted);font-size:11.5px">${st&&st.n?`데이터 부족 (n=${st.n})`:'등록 정보 없음'}</text>`;return}
    if(dots||dotsOnly){let k=0;for(const v of st.values){const j=((k*7919)%11-5)/5*7;k++;s+=`<circle cx="${x(v)}" cy="${y+j}" r="${dotsOnly?2.6:1.8}" style="fill:${color};fill-opacity:${dotsOnly?.45:.3}"/>`}}
    if(!dotsOnly){
      s+=`<line x1="${x(st.min)}" x2="${x(st.max)}" y1="${y}" y2="${y}" style="stroke:var(--muted);stroke-width:1.5"/>`;
      s+=`<line x1="${x(st.min)}" x2="${x(st.min)}" y1="${y-5}" y2="${y+5}" style="stroke:var(--muted);stroke-width:1.5"/><line x1="${x(st.max)}" x2="${x(st.max)}" y1="${y-5}" y2="${y+5}" style="stroke:var(--muted);stroke-width:1.5"/>`;
      s+=`<rect x="${x(st.q1)}" y="${y-7}" width="${Math.max(3,x(st.q3)-x(st.q1))}" height="14" rx="3" style="fill:${color};fill-opacity:.28;stroke:${color};stroke-width:1.5"/>`;
      s+=`<line x1="${x(st.med)}" x2="${x(st.med)}" y1="${y-9}" y2="${y+9}" style="stroke:var(--ink);stroke-width:2.5"/>`;
    }else{
      s+=`<line x1="${x(st.med)}" x2="${x(st.med)}" y1="${y-10}" y2="${y+10}" style="stroke:var(--ink);stroke-width:2"/>`;
    }
    if(showN)s+=`<text x="${W-R+8}" y="${y+4}" style="fill:${st.n<THRESH.WARN_N?'var(--bad)':'var(--muted)'};font-size:11px">n=${st.n}${st.n<THRESH.WARN_N?' 표본↓':''}</text>`;
    const tipText=`${r.tipTitle||r.label}\n등록 ${st.n}${r.den?` / ${r.den}곳`:''}\n가장 이른 ${fmtD(st.min)}\n25% ${fmtD(st.q1)}\n중앙값 ${fmtD(st.med)}\n75% ${fmtD(st.q3)}\n가장 늦은 ${fmtD(st.max)}`;
    s+=`<rect x="${L}" y="${y-RH/2}" width="${W-L-R}" height="${RH}" style="fill:transparent" data-tip="${esc(tipText)}"/>`;
  });
  host.innerHTML=s+'</svg>';
}
/* 히스토그램: 날짜별 시작 학교 수 + 25~75% 음영 + 중앙값 */
function histChart(id,st,{label='날짜별 시험 시작 학교 수',color='var(--s-exam)'}={}){
  const host=$('#'+id);if(!host)return;
  if(!st||st.n<THRESH.MIN_N){host.innerHTML=`<p class="notice info">${st&&st.n?`등록 학교가 ${st.n}곳뿐이라 분포를 그리지 않습니다 (기준 ${THRESH.MIN_N}곳 이상).`:'등록된 시험 일정이 없습니다.'}</p>`;return}
  const cnt=new Map();for(const v of st.values)cnt.set(v,(cnt.get(v)||0)+1);
  const lo=st.min-3,hi=st.max+3,W=widthOf(id),L=40,R=12,T=14,B=30,H=220;
  const maxC=Math.max(...cnt.values());
  const x=d=>L+(d-lo)/(hi-lo+1)*(W-L-R), bw=Math.max(2,(W-L-R)/(hi-lo+1)-2), y=c=>T+(H-T-B)*(1-c/maxC);
  let s=svgOpen(W,H,label);
  s+=`<rect x="${x(st.q1)}" y="${T}" width="${x(st.q3+1)-x(st.q1)}" height="${H-T-B}" style="fill:var(--accent-soft)"/>`;
  const step=Math.max(1,Math.ceil(maxC/4));
  for(let c=0;c<=maxC;c+=step){const Y=y(c);s+=`<line x1="${L}" x2="${W-R}" y1="${Y}" y2="${Y}" style="stroke:var(--line2)"/><text x="${L-6}" y="${Y+4}" text-anchor="end" style="fill:var(--muted);font-size:11px">${c}</text>`}
  for(let d=lo;d<=hi;d++){const c=cnt.get(d)||0;if(!c)continue;const X=x(d)+1,Y=y(c);
    s+=`<path d="M${X},${H-B} V${Y+3} q0,-3 3,-3 h${bw-6} q3,0 3,3 V${H-B} Z" style="fill:${color}"/>`;
    s+=`<rect x="${X-1}" y="${T}" width="${bw+2}" height="${H-T-B}" style="fill:transparent" data-tip="${esc(`${fmtD(d)} 시작\n${c}개교 (${pct(c/st.n)})`)}"/>`}
  const mX=x(st.med)+bw/2+1;s+=`<line x1="${mX}" x2="${mX}" y1="${T}" y2="${H-B}" style="stroke:var(--ink);stroke-width:1.5;stroke-dasharray:4 3"/><text x="${mX+4}" y="${T+10}" style="fill:var(--ink);font-size:11px">중앙값 ${fmtMD(st.med)}</text>`;
  s+=`<line x1="${L}" x2="${W-R}" y1="${H-B}" y2="${H-B}" style="stroke:var(--line)"/>`;
  for(const t of dateTicks(lo,hi,Math.floor((W-L-R)/60))){const X=x(t.d)+bw/2;s+=`<text x="${X}" y="${H-B+16}" text-anchor="middle" style="fill:var(--muted);font-size:11px">${t.l}</text>`}
  host.innerHTML=s+'</svg>';
}
/* 집중 기간 vs 전체 등록 기간 */
function periodChart(id,st){
  const host=$('#'+id);if(!host)return;
  if(!st||st.n<THRESH.MIN_N){host.innerHTML='';return}
  const lo=st.min-3,hi=st.lastEnd+3,W=widthOf(id),L=118,R=16,H=110;
  const x=d=>L+(d-lo)/(hi-lo)*(W-L-R);
  let s=svgOpen(W,H,'시험 집중 기간과 전체 등록 기간');
  const rows=[['시험 집중 기간',st.q1,st.q3,'var(--s-exam)','학교별 첫 시험일의 25~75% 구간'],['전체 등록 기간',st.min,st.lastEnd,'var(--muted)','가장 이른 시작일 ~ 가장 늦은 종료일']];
  rows.forEach(([l,a,b,c,t],i)=>{const y=24+i*44;
    s+=`<text x="${L-10}" y="${y+12}" text-anchor="end" style="fill:var(--ink);font-size:12px">${l}</text>`;
    s+=`<rect x="${x(a)}" y="${y}" width="${Math.max(3,x(b+1)-x(a))}" height="16" rx="3" style="fill:${c};fill-opacity:.85" data-tip="${esc(`${l}\n${fmtD(a)} ~ ${fmtD(b)} (${b-a+1}일)\n${t}`)}"/>`;
    s+=`<text x="${x(a)}" y="${y-5}" style="fill:var(--ink2);font-size:11px">${fmtD(a)} ~ ${fmtD(b)} · ${b-a+1}일</text>`});
  host.innerHTML=s+'</svg>';
}
/* 막대(가로): 등록률 등 */
function hbarChart(id,items,{max=1,fmt=pct,label=''}={}){
  const host=$('#'+id);if(!host)return;
  const W=widthOf(id),L=118,R=70,RH=26,H=items.length*RH+12;
  const x=v=>L+(v/max)*(W-L-R);
  let s=svgOpen(W,H,label);
  items.forEach((it,i)=>{const y=6+i*RH;
    s+=`<text x="${L-10}" y="${y+15}" text-anchor="end" style="fill:var(--ink);font-size:12px">${esc(it.label)}</text>`;
    s+=`<rect x="${L}" y="${y+5}" width="${W-L-R}" height="12" rx="4" style="fill:var(--line2)"/>`;
    if(it.v>0)s+=`<path d="M${L},${y+5} H${x(it.v)-4} q4,0 4,4 v4 q0,4 -4,4 H${L} Z" style="fill:${it.color||'var(--s-exam)'}"/>`;
    s+=`<text x="${W-R+8}" y="${y+15}" style="fill:var(--ink2);font-size:11.5px">${fmt(it.v)}</text>`;
    s+=`<rect x="${L}" y="${y}" width="${W-L-R}" height="${RH}" style="fill:transparent" data-tip="${esc(it.tip||it.label+' '+fmt(it.v))}"/>`});
  host.innerHTML=s+'</svg>';
}
/* 학년별 중앙값 점 그래프(지역 × 학년) */
function gradeDotChart(id,rows,series){
  const host=$('#'+id);if(!host)return;
  const all=rows.flatMap(r=>r.vals.filter(v=>v&&v.n>=THRESH.MIN_N).map(v=>v.med));
  if(!all.length){host.innerHTML='<p class="notice info">표시할 데이터가 부족합니다.</p>';return}
  const lo=Math.min(...all)-3,hi=Math.max(...all)+3,W=widthOf(id),L=70,R=16,T=26,RH=22,H=T+rows.length*RH+8;
  const x=d=>L+(d-lo)/(hi-lo)*(W-L-R);
  let s=svgOpen(W,H,'지역별 학년별 시험 시작일 중앙값');
  for(const t of dateTicks(lo,hi,Math.floor((W-L-R)/70))){const X=x(t.d);s+=`<line x1="${X}" x2="${X}" y1="${T-4}" y2="${H-4}" style="stroke:var(--line2)"/><text x="${X}" y="${T-10}" text-anchor="middle" style="fill:var(--muted);font-size:11px">${t.l}</text>`}
  rows.forEach((r,i)=>{const y=T+i*RH+RH/2;
    s+=`<text x="${L-10}" y="${y+4}" text-anchor="end" style="fill:var(--ink);font-size:12px">${esc(r.label)}</text>`;
    const pts=r.vals.map((v,k)=>v&&v.n>=THRESH.MIN_N?{X:x(v.med),k,v}:null).filter(Boolean);
    if(pts.length>1){const xs=pts.map(p=>p.X);s+=`<line x1="${Math.min(...xs)}" x2="${Math.max(...xs)}" y1="${y}" y2="${y}" style="stroke:var(--line);stroke-width:2"/>`}
    for(const p of pts)s+=`<circle cx="${p.X}" cy="${y}" r="5" style="fill:${series[p.k].color};stroke:var(--surface);stroke-width:2" data-tip="${esc(`${r.label} ${series[p.k].label}\n중앙값 ${fmtD(p.v.med)}\nn=${p.v.n}`)}"/>`;
    const miss=r.vals.map((v,k)=>(!v||v.n<THRESH.MIN_N)?series[k].label:null).filter(Boolean);
    if(miss.length&&!pts.length)s+=`<text x="${L+4}" y="${y+4}" style="fill:var(--muted);font-size:11px">데이터 부족</text>`;
  });
  host.innerHTML=s+'</svg>';
}
/* 히트맵: 지역 × 주(학년도 3월~2월) */
function heatmap(id,rowsData,weeks,{label=''}={}){
  const host=$('#'+id);if(!host)return;
  const W=Math.max(widthOf(id),760),L=56,R=10,T=30,RH=20,H=T+rowsData.length*RH+30;
  const cw=(W-L-R)/weeks.length;
  const maxV=Math.max(0.0001,...rowsData.flatMap(r=>r.cells.map(c=>c.v)));
  let s=svgOpen(W,H,label);
  let lastM=-1;weeks.forEach((w,j)=>{const m=parts(w)[1];if(m!==lastM){lastM=m;s+=`<text x="${L+j*cw}" y="${T-10}" style="fill:var(--muted);font-size:11px">${m}월</text>`}});
  rowsData.forEach((r,i)=>{const y=T+i*RH;
    s+=`<text x="${L-8}" y="${y+14}" text-anchor="end" style="fill:${r.small?'var(--muted)':'var(--ink)'};font-size:11.5px">${esc(r.label)}${r.small?'*':''}</text>`;
    r.cells.forEach((c,j)=>{const t=c.v/maxV;const op=c.v>0?Math.max(.12,Math.min(1,t)):0;
      s+=`<rect x="${L+j*cw+.5}" y="${y+1}" width="${Math.max(1,cw-1)}" height="${RH-2}" rx="2" style="fill:${c.v>0?'var(--s-exam)':'var(--line2)'};fill-opacity:${c.v>0?op.toFixed(2):1}" data-tip="${esc(`${r.label} · ${fmtMD(weeks[j])} 주간\n시험 시작 ${c.c}개교 / ${r.den}곳 (${pct(c.v)})`)}"/>`})});
  const ly=H-16;s+=`<text x="${L}" y="${ly+9}" style="fill:var(--muted);font-size:11px">해당 주에 시험을 시작한 학교 비율: 0</text>`;
  for(let k=1;k<=5;k++)s+=`<rect x="${L+175+k*22}" y="${ly}" width="20" height="10" rx="2" style="fill:var(--s-exam);fill-opacity:${(k/5).toFixed(2)}"/>`;
  s+=`<text x="${L+175+6*22+4}" y="${ly+9}" style="fill:var(--muted);font-size:11px">${pct(maxV)}</text>`;
  host.innerHTML=s+'</svg>';
}

/* ---------- 공통 계산 ---------- */
const regionName=c=>c==='ALL'?'전국':REGION_BY[c].name;
const gradeName=g=>g==='ALL'?'전체 학년':g===0?'학년 미지정':`${g}학년`;
const SEMS=s=>s==='ALL'?[1,2]:[s];
const TYPES=t=>t==='ALL'?['MID','FINAL']:[t];
const examLabel=(sem,type)=>`${sem}학기 ${TYPE_NAME[type]}`;
function prevShift(cur,prev){ // 학년도 시작(3/1) 기준 상대일로 비교
  if(!cur||!prev||cur.n<THRESH.MIN_N||prev.n<THRESH.MIN_N)return null;
  return (cur.med-ayStart(cur.ay))-(prev.med-ayStart(prev.ay));
}
const shiftTxt=v=>v==null?'–':v===0?'변동 없음':(v>0?`+${v}일 늦음`:`${-v}일 빠름`);

/* ================================================================
   화면 ① 시험 일정 분석
   ================================================================ */
function pageExams(m){
  const lvs=state.level, maxg=MAXG[lvs];
  if(state.grade!=='ALL'&&state.grade>maxg)state.grade='ALL';
  m.innerHTML=head('시험 일정 분석','지역·학교급·학년별로 중간·기말고사 시작일이 언제 몰리는지 봅니다. 표의 행을 누르면 아래 차트가 그 조건으로 바뀝니다.')+
    filterBar([['ay','학년도','ay'],['region','지역','region'],['level','학교급','levelAll'],['grade','학년','grade',lvs],['sem','학기','semAll'],['type','시험','typeAll']])+
    yearNotice(state.ay)+(lvs==='E'?`<div class="notice info">초등학교는 정기 중간·기말고사를 보지 않는 학교가 대부분입니다. 등록된 학교가 없으면 '등록 정보 없음'으로 표시하며, 초등 평가 일정은 '초등학교 학사일정' 화면에서 봅니다.</div>`:'')+
    `<div class="kpis" id="kpis"></div>
     <section class="card"><div class="card-h"><div><h3>시험 시작일 통계표</h3><p>학교마다 시험 시작일을 하나로 정한 뒤 계산합니다. 여러 날·여러 행으로 등록된 시험도 학교당 1회로 셉니다. 등록 ${THRESH.MIN_N}곳 미만은 '데이터 부족', ${THRESH.WARN_N}곳 미만은 '표본 부족'으로 표시합니다.</p></div></div><div id="tbl"></div></section>
     <div class="grid2">${chartCard('c-hist','날짜별 시험 시작 학교 수','',`<span class="chip mute" id="pickLabel"></span>`)}${chartCard('c-period','시험 집중 기간과 전체 등록 기간','집중 기간은 첫 시험일의 25~75% 구간이고, 전체 기간은 실제 시험이 진행된 날까지 포함합니다.')}</div>
     ${chartCard('c-box','학기·시험별 시작일 분포','막대 = 집중 기간(25~75%), 굵은 선 = 중앙값, 가는 선 = 가장 이른~가장 늦은 시작일, 점 = 학교별 시작일')}`;
  bindFilters(m);
  const regions=state.region==='ALL'?['ALL',...REGIONS.map(r=>r.code)]:[state.region];
  const rows=[];
  for(const rg of regions)for(const sem of SEMS(state.sem))for(const tp of TYPES(state.type)){
    const q={ay:state.ay,region:rg,level:lvs,grade:state.grade,sem,type:tp};
    const st=E.examStat(D,q);
    const prev=E.examStat(D,{...q,ay:state.ay-1});
    const key=`${rg}|${sem}|${tp}`;
    rows.push({key,region:regionName(rg),level:LEVELS[lvs],grade:gradeName(state.grade),semL:`${sem}학기`,typeL:TYPE_NAME[tp],st,
      n:st.n,den:st.den,rate:st.rate,ok:st.n>=THRESH.MIN_N,shift:prevShift(st,prev),q});
  }
  if(!state.pick||!rows.find(r=>r.key===state.pick))state.pick=(rows.find(r=>r.ok)||rows[0]).key;
  const S=r=>r.ok?r.st:{};
  const cols=[
    {k:'region',label:'지역'},{k:'level',label:'학교급'},{k:'grade',label:'학년'},{k:'semL',label:'학기'},{k:'typeL',label:'시험 종류'},
    {k:'n',label:'등록 학교 수',t:'int'},{k:'den',label:'전체 조사 학교 수',t:'int'},{k:'rate',label:'등록률',t:'pct'},
    {k:'min',label:'가장 이른 시작일',t:'date',get:r=>S(r).min},{k:'q1',label:'25% 지점',t:'date',get:r=>S(r).q1},{k:'med',label:'중앙값',t:'date',get:r=>S(r).med},
    {k:'q3',label:'75% 지점',t:'date',get:r=>S(r).q3},{k:'max',label:'가장 늦은 시작일',t:'date',get:r=>S(r).max},
    {k:'iqr',label:'시험 집중 기간',t:'range',get:r=>r.ok?[r.st.q1,r.st.q3]:null},{k:'full',label:'전체 등록 기간',t:'range',get:r=>r.ok?[r.st.min,r.st.lastEnd]:null},
    {k:'avg',label:'평균 시험 일수',t:'num',get:r=>S(r).avgDays},{k:'shift',label:'전년 대비 중앙값',get:r=>shiftTxt(r.shift),sort:r=>r.shift,csv:r=>r.shift},
    {k:'status',label:'상태',t:'html',get:r=>statusChip(r.st.status),sort:r=>r.st.status,csv:r=>statusText(r.st.status)},
  ];
  table($('#tbl',m),{columns:cols,rows,name:`시험일정_${state.ay}_${LEVEL_SHORT[lvs]}`,onRow:r=>{state.pick=r.key;render()},isSel:r=>r.key===state.pick,dim:r=>!r.ok});
  const P=rows.find(r=>r.key===state.pick);
  $('#pickLabel',m).textContent=`${P.region} · ${P.semL} ${P.typeL} · ${P.grade}`;
  const st=P.st;
  $('#kpis',m).innerHTML=kpi('전체 조사 학교',st.den.toLocaleString()+'곳',`${P.region} ${LEVELS[lvs]}`)+kpi('시험 일정 등록 학교',st.n.toLocaleString()+'곳',`등록률 ${pct(st.rate)}`)+
    kpi('시작일 중앙값',P.ok?fmtD(st.med):'데이터 부족',P.ok?`전년 대비 ${shiftTxt(P.shift)}`:'')+kpi('시험 집중 기간',P.ok?`${fmtMD(st.q1)} ~ ${fmtMD(st.q3)}`:'–',P.ok?`평균 ${fix1(st.avgDays)}일 동안 시험`:'');
  histChart('c-hist',P.ok?st:{n:st.n});periodChart('c-period',st);
  const boxRows=rows.filter(r=>r.q.region===P.q.region).map(r=>({label:`${r.semL} ${r.typeL}`,st:r.st,den:r.den,tipTitle:`${r.region} ${r.semL} ${r.typeL}`}));
  rangeChart('c-box',boxRows,{dots:true,lo:ayStart(state.ay)+30,hi:ayStart(state.ay)+300});
  bindPNG(m);
}
const head=(t,p)=>`<div class="page-head"><div><h2>${t}</h2><p>${p}</p></div>${IS_REAL()?'':'<span class="chip sample">모의 데이터</span>'}</div>`;
const kpi=(l,v,s)=>`<div class="kpi"><span class="l">${l}</span><span class="v">${v}</span><span class="s">${s||'&nbsp;'}</span></div>`;

/* ================================================================
   화면 ② 학년별 시험 일정
   ================================================================ */
function pageGrades(m){
  const lv=state.gLevel,sem=state.gSem,tp=state.gType;
  m.innerHTML=head('학년별 시험 일정','같은 학교급이라도 학년마다 시험 시기가 다를 수 있습니다. 중3·고3의 2학기 조기 시험, 자유학기 등으로 지필평가가 없는 학년을 따로 확인합니다.')+
    filterBar([['ay','학년도','ay'],['region','지역','region'],['gLevel','학교급','levelMH'],['gSem','학기','sem'],['gType','시험','type']])+yearNotice(state.ay)+
    `<div class="kpis" id="kpis"></div>
    <div class="grid2">${chartCard('g-box',`학년별 시작일 분포 · ${examLabel(sem,tp)}`,'학년마다 학교별 시작일을 따로 집계했습니다. 해당 학년 일정을 등록하지 않은 학교는 분모에만 들어갑니다.')}
    ${chartCard('g-rate','학년별 등록률','해당 학년 시험 일정을 등록한 학교 / 전체 조사 학교')}</div>
    ${chartCard('g-cal','학년별 시험 시작 달력','칸 숫자 = 그날 시험을 시작한 학교 수. 진할수록 많습니다.')}
    <section class="card"><div class="card-h"><div><h3>학년 × 학기 × 시험 통계</h3><p>표의 날짜는 모두 '시험 시작일' 기준입니다.</p></div></div><div id="tbl"></div></section>`;
  bindFilters(m);
  const base={ay:state.ay,region:state.region,level:lv};
  const G=[1,2,3];
  const stats=G.map(g=>E.examStat(D,{...base,grade:g,sem,type:tp}));
  const stAll=E.examStat(D,{...base,grade:'ALL',sem,type:tp});
  // 같은 학교 내 학년별 시작일 차이
  let multi=0,diff=0,early=0,earlyBase=0;const missing=[0,0,0];
  for(const s of E.schoolsBy(D,state.region,lv,state.ay)){
    const eps=D.epBySchool[s.idx].filter(e=>e.a===state.ay&&e.sem===sem&&e.type===tp&&!e.review&&e.grade>=1);
    if(!eps.length)continue;
    const by={};for(const e of eps)by[e.grade]=Math.min(by[e.grade]??Infinity,e.start);
    const gs=Object.keys(by);
    if(gs.length>=2){multi++;if(new Set(Object.values(by)).size>1)diff++}
    for(const g of G)if(by[g]==null)missing[g-1]++;
    if(by[3]!=null&&(by[1]!=null||by[2]!=null)){earlyBase++;if(by[3]<=Math.min(by[1]??Infinity,by[2]??Infinity)-7)early++}
  }
  const g3=stats[2],g12=E.summarize([...stats[0].per,...stats[1].per].map(p=>p.start));
  $('#kpis',m).innerHTML=kpi('학년별 시작일이 다른 학교',`${diff.toLocaleString()}곳`,`2개 학년 이상 등록한 ${multi.toLocaleString()}곳 중 ${pct(multi?diff/multi:null)}`)+
    kpi(`3학년이 1주 이상 먼저 시작`,`${early.toLocaleString()}곳`,`3학년과 다른 학년을 함께 등록한 ${earlyBase}곳 기준`)+
    kpi('3학년 중앙값 vs 1·2학년',g3.n>=THRESH.MIN_N&&g12?`${fmtMD(g3.med)} / ${fmtMD(g12.med)}`:'데이터 부족',g3.n>=THRESH.MIN_N&&g12?`${g12.med-g3.med>0?(g12.med-g3.med)+'일 빠름':g3.med-g12.med+'일 늦음'}`:'')+
    kpi('일정이 없는 학년 (다른 학년은 등록)',`1학년 ${missing[0]} · 2학년 ${missing[1]} · 3학년 ${missing[2]}`,lv==='M'?'중1은 자유학기 등으로 지필평가가 없을 수 있음 (확인 필요)':'시험 미실시 또는 미등록');
  rangeChart('g-box',[...G.map((g,i)=>({label:`${g}학년`,st:stats[i],den:stats[i].den,color:`var(--g${g})`})),{label:'전체 학년',st:stAll,den:stAll.den,tipTitle:'전체 학년 (학교별 가장 이른 시작일)'}],{dots:true});
  hbarChart('g-rate',G.map((g,i)=>({label:`${g}학년`,v:stats[i].rate||0,color:`var(--g${g})`,tip:`${g}학년 ${stats[i].n} / ${stats[i].den}곳`})));
  // 달력 스트립
  const hc=$('#g-cal');
  const all=stats.flatMap(s=>s.n?[s.min,s.max]:[]);
  if(!all.length){hc.innerHTML='<p class="notice info">등록된 시험 일정이 없습니다.</p>'}
  else{
    const lo=mondayOf(Math.min(...all)),hi=Math.max(...all);const days=[];for(let d=lo;d<=hi+((6-dow(hi)+7)%7);d++)days.push(d);
    const W=Math.max(widthOf('g-cal'),days.length*24+70),L=60,cw=(W-L-8)/days.length,H=30+3*30+10;
    const cnt=stats.map(s=>{const c=new Map();for(const v of (s.values||[]))c.set(v,(c.get(v)||0)+1);return c});
    const mx=Math.max(1,...cnt.flatMap(c=>[...c.values()]));
    let s=svgOpen(W,H,'학년별 시험 시작 달력');
    days.forEach((d,j)=>{const X=L+j*cw;if(dow(d)===1||j===0)s+=`<text x="${X+2}" y="14" style="fill:var(--muted);font-size:10.5px">${fmtMD(d)}</text>`;s+=`<text x="${X+cw/2}" y="27" text-anchor="middle" style="fill:${isOff(d)?'var(--bad)':'var(--muted)'};font-size:9.5px">${'일월화수목금토'[dow(d)]}</text>`});
    G.forEach((g,i)=>{const y=32+i*30;s+=`<text x="${L-8}" y="${y+17}" text-anchor="end" style="fill:var(--ink);font-size:12px">${g}학년</text>`;
      days.forEach((d,j)=>{const c=cnt[i].get(d)||0;const X=L+j*cw;
        s+=`<rect x="${X+1}" y="${y}" width="${cw-2}" height="26" rx="3" style="fill:${c?`var(--g${g})`:'var(--line2)'};fill-opacity:${c?Math.max(.18,c/mx).toFixed(2):1}" data-tip="${esc(`${g}학년 · ${fmtD(d)}\n시험 시작 ${c}개교`)}"/>`;
        if(c&&cw>=18)s+=`<text x="${X+cw/2}" y="${y+17}" text-anchor="middle" style="fill:${c/mx>.55?'var(--surface)':'var(--ink)'};font-size:10px">${c}</text>`})});
    hc.innerHTML=s+'</svg>';
  }
  // 표
  const rows=[];
  for(const g of [...G,'ALL'])for(const se of [1,2])for(const t of ['MID','FINAL']){
    const st=E.examStat(D,{...base,grade:g,sem:se,type:t});rows.push({grade:gradeName(g),semL:`${se}학기`,typeL:TYPE_NAME[t],st,ok:st.n>=THRESH.MIN_N});
  }
  const S=r=>r.ok?r.st:{};
  table($('#tbl',m),{name:`학년별_${state.ay}_${LEVEL_SHORT[lv]}_${regionName(state.region)}`,rows,dim:r=>!r.ok,columns:[
    {k:'grade',label:'학년'},{k:'semL',label:'학기'},{k:'typeL',label:'시험'},{k:'n',label:'등록 학교',t:'int',get:r=>r.st.n},{k:'den',label:'조사 학교',t:'int',get:r=>r.st.den},{k:'rate',label:'등록률',t:'pct',get:r=>r.st.rate},
    {k:'min',label:'가장 이른',t:'date',get:r=>S(r).min},{k:'q1',label:'25%',t:'date',get:r=>S(r).q1},{k:'med',label:'중앙값',t:'date',get:r=>S(r).med},{k:'q3',label:'75%',t:'date',get:r=>S(r).q3},{k:'max',label:'가장 늦은',t:'date',get:r=>S(r).max},
    {k:'avg',label:'평균 일수',t:'num',get:r=>S(r).avgDays},{k:'status',label:'상태',t:'html',get:r=>statusChip(r.st.status),csv:r=>statusText(r.st.status)}]});
  bindPNG(m);
}

/* ================================================================
   화면 ③ 지역별 비교
   ================================================================ */
function pageRegions(m){
  const lv=state.rLevel,sem=state.rSem,tp=state.rType,g=state.rGrade;
  const title=`${state.ay}학년도 ${sem}학기 ${LEVELS[lv]} ${gradeName(g)} ${TYPE_NAME[tp]}`;
  m.innerHTML=head('지역별 비교','17개 시·도의 시험 시작일 중앙값과 집중 기간을 한 번에 비교합니다. * 표시는 등록 학교가 적어 해석에 주의가 필요한 지역입니다.')+
    filterBar([['ay','학년도','ay'],['rLevel','학교급','levelAll'],['rGrade','학년','grade',lv],['rSem','학기','sem'],['rType','시험','type'],['region','히스토그램 지역','region']])+yearNotice(state.ay)+
    `<div class="notice info"><b>${title}</b> 기준입니다.</div>
    ${chartCard('r-med','① 지역별 시작일 중앙값과 집중 기간','중앙값이 이른 지역부터 정렬. 막대 = 25~75%, 굵은 선 = 중앙값, 가는 선 = 최소~최대')}
    ${chartCard('r-dist','② 지역별 시작일 분포','점 하나가 학교 하나입니다. 굵은 선은 중앙값.')}
    <div class="grid2">${chartCard('r-hist',`③ 날짜별 시험 시작 학교 수 · ${regionName(state.region)}`,'')}${chartCard('r-grade','⑤ 학년별 시작일 중앙값 비교 (지역별)','')}</div>
    ${chartCard('r-heat',`④ 연간 시험 집중도 히트맵 · ${state.ay}학년도 ${LEVELS[lv]} ${gradeName(g)}`,'모든 정기 지필평가(중간·기말, 1·2학기)를 합쳐 주마다 시험을 시작한 학교 비율을 칠했습니다.')}
    <section class="card"><div class="card-h"><div><h3>지역별 통계표</h3></div></div><div id="tbl"></div></section>`;
  bindFilters(m);
  const q={ay:state.ay,level:lv,grade:g,sem,type:tp};
  const rs=REGIONS.map(r=>({r,st:E.examStat(D,{...q,region:r.code})}));
  const sorted=[...rs].sort((a,b)=>(a.st.n>=THRESH.MIN_N?a.st.med:1e9)-(b.st.n>=THRESH.MIN_N?b.st.med:1e9));
  const lab=x=>x.r.name+(x.st.n<THRESH.WARN_N?' *':'');
  rangeChart('r-med',sorted.map(x=>({label:lab(x),st:x.st,den:x.st.den,tipTitle:x.r.full})));
  rangeChart('r-dist',rs.map(x=>({label:lab(x),st:x.st,den:x.st.den,tipTitle:x.r.full})),{dotsOnly:true});
  histChart('r-hist',E.examStat(D,{...q,region:state.region}));
  const gs=Array.from({length:Math.min(3,MAXG[lv])},(_,i)=>i+1);
  const series=gs.map(k=>({label:`${k}학년`,color:`var(--g${k})`}));
  $('#r-grade').insertAdjacentHTML('beforebegin',`<div class="legend">${series.map(s=>`<span><i style="background:${s.color}"></i>${s.label}</span>`).join('')}${lv==='E'?'<span>(초등은 1~3학년만 표시)</span>':''}</div>`);
  gradeDotChart('r-grade',REGIONS.map(r=>({label:r.name,vals:gs.map(k=>E.examStat(D,{...q,region:r.code,grade:k}))})),series);
  // 히트맵
  const s0=ayStart(state.ay),weeks=[];for(let w=mondayOf(s0);w<=ayEnd(state.ay);w+=7)weeks.push(w);
  const hrows=REGIONS.map(r=>{
    const ss=E.schoolsBy(D,r.code,lv,state.ay);const c=new Array(weeks.length).fill(0);
    for(const s of ss){const seen=new Set();
      for(const e of D.epBySchool[s.idx]){if(e.a!==state.ay||e.review||e.type==='UNK'||e.grade<1||(g!=='ALL'&&e.grade!==g))continue;
        const k=`${e.sem}|${e.type}`;const cur=seen.has(k);if(cur)continue;
        // 학교·학기·종류별 가장 이른 시작일 1개만
        const first=D.epBySchool[s.idx].filter(x=>x.a===state.ay&&!x.review&&x.sem===e.sem&&x.type===e.type&&x.grade>=1&&(g==='ALL'||x.grade===g)).reduce((a,b)=>a.start<=b.start?a:b);
        seen.add(k);const j=Math.floor((mondayOf(first.start)-weeks[0])/7);if(j>=0&&j<c.length)c[j]++}}
    return {label:r.name,den:ss.length,small:ss.length<THRESH.WARN_N,cells:c.map(x=>({c:x,v:ss.length?x/ss.length:0}))};
  });
  heatmap('r-heat',hrows,weeks,{label:'연간 시험 집중도'});
  const S=x=>x.st.n>=THRESH.MIN_N?x.st:{};
  table($('#tbl',m),{name:`지역비교_${state.ay}_${LEVEL_SHORT[lv]}_${sem}학기_${TYPE_NAME[tp]}`,rows:sorted,dim:x=>x.st.n<THRESH.MIN_N,columns:[
    {k:'r',label:'지역',get:x=>x.r.name},{k:'n',label:'등록 학교',t:'int',get:x=>x.st.n},{k:'den',label:'조사 학교',t:'int',get:x=>x.st.den},{k:'rate',label:'등록률',t:'pct',get:x=>x.st.rate},
    {k:'min',label:'가장 이른',t:'date',get:x=>S(x).min},{k:'q1',label:'25%',t:'date',get:x=>S(x).q1},{k:'med',label:'중앙값',t:'date',get:x=>S(x).med},{k:'q3',label:'75%',t:'date',get:x=>S(x).q3},{k:'max',label:'가장 늦은',t:'date',get:x=>S(x).max},
    {k:'iqr',label:'집중 기간',t:'range',get:x=>x.st.n>=THRESH.MIN_N?[x.st.q1,x.st.q3]:null},{k:'avg',label:'평균 일수',t:'num',get:x=>S(x).avgDays},
    {k:'status',label:'상태',t:'html',get:x=>statusChip(x.st.status),csv:x=>statusText(x.st.status)}]});
  bindPNG(m);
}

/* ================================================================
   화면 ④ 초등학교 학사일정
   ================================================================ */
const MS=[
  {key:'open1',label:'1학기 개학(시업식)',color:'var(--s-open)'},
  {key:'entrance',label:'입학식',color:'var(--s-open)'},
  {key:'summer',label:'여름방학 시작',color:'var(--s-vac)'},
  {key:'open2',label:'2학기 개학',color:'var(--s-open)'},
  {key:'winter',label:'겨울방학 시작',color:'var(--s-vac)'},
  {key:'grad',label:'졸업식',color:'var(--s-grad)'},
  {key:'closing',label:'종업식',color:'var(--s-grad)'},
];
const EVAL=[{key:'diag',cat:'DIAG',label:'진단평가'},{key:'achieve',cat:'ACHIEVE',label:'학업성취도평가'},{key:'formative',cat:'FORMATIVE',sem:1,label:'1학기 형성·학기말 평가'},{key:'formative',cat:'FORMATIVE',sem:2,label:'2학기 형성·학기말 평가'}];
function gradeEventStat(ay,region,cat,grade,sem){ // 초등 평가: 학년별 행사 여부 반영, 학교별 첫 날짜
  const ss=E.schoolsBy(D,region,'E',ay);const vals=[];
  for(const s of ss){let f=null;for(const r of D.evBySchool[s.idx]){if(r.a!==ay||r.cat!==cat||(sem&&r.sem!==sem))continue;if(grade!=='ALL'&&!(r.g&(1<<(grade-1))))continue;if(f==null||r.start<f)f=r.start}if(f!=null)vals.push(f)}
  const st=E.summarize(vals)||{};const n=vals.length;
  return {...st,n,den:ss.length,rate:ss.length?n/ss.length:null,status:n===0?'none':n<THRESH.MIN_N?'insufficient':n<THRESH.WARN_N?'small':'ok'};
}
function pageElementary(m){
  const g=state.eGrade;
  m.innerHTML=head('초등학교 학사일정','초등학교는 정기 중간·기말고사 대신 진단평가, 학업성취도평가 등을 학교별로 운영합니다. 등록된 일정만 집계하고, 없는 시험 기간을 만들어 내지 않습니다.')+
    filterBar([['ay','학년도','ay'],['region','지역','region'],['eGrade','학년(평가)','grade','E']])+yearNotice(state.ay)+
    `<div class="kpis" id="kpis"></div>
    ${chartCard('e-time','초등학교 연간 주요 일정','학교별 날짜의 분포. 막대 = 25~75%, 굵은 선 = 중앙값')}
    <section class="card"><div class="card-h"><div><h3>평가 일정</h3><p>학년 필터는 NEIS의 학년별 행사 여부(1~6학년) 값으로 거릅니다. 중간·기말고사는 등록 학교가 없으면 '등록 정보 없음'입니다.</p></div></div><div id="tbl1"></div></section>
    <section class="card"><div class="card-h"><div><h3>개학·방학·졸업 일정</h3></div></div><div id="tbl2"></div></section>
    <div class="grid2">${chartCard('e-disc','재량휴업일 날짜별 학교 수','')}<section class="card"><div class="card-h"><div><h3>재량휴업일 요약</h3></div></div><div id="discSum"></div></section></div>`;
  bindFilters(m);
  const ay=state.ay,rg=state.region;
  const ev=EVAL.map(e=>({...e,st:gradeEventStat(ay,rg,e.cat,g,e.sem)}));
  const ex=['MID','FINAL'].flatMap(t=>[1,2].map(se=>({label:`${se}학기 ${TYPE_NAME[t]}`,st:E.examStat(D,{ay,region:rg,level:'E',grade:g,sem:se,type:t})})));
  const ms=MS.map(x=>({...x,st:E.milestoneStat(D,{ay,region:rg,level:'E',key:x.key})}));
  const den=E.schoolsBy(D,rg,'E',ay).length;
  $('#kpis',m).innerHTML=kpi('조사 초등학교',den.toLocaleString()+'곳',regionName(rg))+kpi('진단평가 등록',`${ev[0].st.n}곳`,`등록률 ${pct(ev[0].st.rate)}`)+
    kpi('학업성취도평가 등록',`${ev[1].st.n}곳`,`등록률 ${pct(ev[1].st.rate)}`)+kpi('중간·기말고사 등록',`최대 ${Math.max(...ex.map(x=>x.st.n))}곳`,'학기·시험별 등록 학교 수 중 최대');
  rangeChart('e-time',[...ms.filter(x=>x.key!=='closing').map(x=>({label:x.label,st:x.st,den:x.st.den,color:x.color})),...ev.map(x=>({label:x.label,st:x.st,den:x.st.den,color:'var(--s-eval)'}))],{lo:ayStart(ay),hi:ayEnd(ay),dots:false});
  const S=r=>r.st.n>=THRESH.MIN_N?r.st:{};
  const cols=[{k:'label',label:'일정'},{k:'n',label:'등록 학교',t:'int',get:r=>r.st.n},{k:'den',label:'조사 학교',t:'int',get:r=>r.st.den},{k:'rate',label:'등록률',t:'pct',get:r=>r.st.rate},
    {k:'min',label:'가장 이른',t:'date',get:r=>S(r).min},{k:'q1',label:'25%',t:'date',get:r=>S(r).q1},{k:'med',label:'중앙값',t:'date',get:r=>S(r).med},{k:'q3',label:'75%',t:'date',get:r=>S(r).q3},{k:'max',label:'가장 늦은',t:'date',get:r=>S(r).max},
    {k:'status',label:'상태',t:'html',get:r=>statusChip(r.st.status),csv:r=>statusText(r.st.status)}];
  table($('#tbl1',m),{name:`초등평가_${ay}_${regionName(rg)}`,rows:[...ev,...ex],columns:[{k:'g',label:'학년',get:()=>gradeName(g)},...cols],dim:r=>r.st.n<THRESH.MIN_N,search:false});
  table($('#tbl2',m),{name:`초등학사_${ay}_${regionName(rg)}`,rows:ms,columns:cols,dim:r=>r.st.n<THRESH.MIN_N,search:false});
  // 재량휴업
  const ss=E.schoolsBy(D,rg,'E',ay);const cnt=new Map();let tot=0,has=0;
  for(const s of ss){const m2=D.milestones[s.idx][ay];if(!m2)continue;const n=m2.discretion.size;tot+=n;if(n)has++;for(const d of m2.discretion)cnt.set(d,(cnt.get(d)||0)+1)}
  const top=[...cnt.entries()].sort((a,b)=>b[1]-a[1]).slice(0,8);
  hbarChart('e-disc',top.map(([d,c])=>({label:fmtD(d),v:c,tip:`${fmtD(d)} · ${c}개교`})),{max:Math.max(1,...top.map(t=>t[1])),fmt:v=>v+'곳'});
  $('#discSum',m).innerHTML=`<ul class="list"><li><span>재량휴업일 등록 학교</span><span>${has} / ${ss.length}곳 (${pct(ss.length?has/ss.length:null)})</span></li><li><span>학교당 평균 일수</span><span>${ss.length?fix1(tot/ss.length):'–'}일</span></li><li><span>가장 많은 날</span><span>${top[0]?fmtD(top[0][0])+' · '+top[0][1]+'곳':'–'}</span></li></ul><p style="font-size:12px;color:var(--muted);margin:8px 0 0">재량휴업일은 수업공제일(휴업일) 행 중 '재량휴업' 표기가 있는 날만 셉니다. 공휴일은 제외합니다.</p>`;
  bindPNG(m);
}

/* ================================================================
   화면 ⑤ 방학·개학 공통일정
   ================================================================ */
function pageCommon(m){
  m.innerHTML=head('방학·개학 공통일정','초·중·고의 개학, 방학, 졸업식 시기를 같은 기준으로 비교합니다. 방학 시작일은 방학식 다음 첫 \'방학\' 행의 날짜입니다.')+
    filterBar([['ay','학년도','ay'],['region','지역','region'],['msKey','지역 비교 일정','ms']])+yearNotice(state.ay)+
    `${chartCard('m-time','학교급별 주요 일정 비교','색 = 일정 종류. 위에서부터 초·중·고 순서')}
    <section class="card"><div class="card-h"><div><h3>학교급 × 일정 통계</h3></div></div><div id="tbl"></div></section>
    ${chartCard('m-reg','지역별 비교','선택한 일정의 지역·학교급별 분포. 행마다 초·중·고')}`;
  bindFilters(m);
  const ay=state.ay,rg=state.region;
  const rows=[];
  for(const x of MS)for(const lv of ['E','M','H'])rows.push({x,lv,label:`${x.label} · ${LEVEL_SHORT[lv]}`,st:E.milestoneStat(D,{ay,region:rg,level:lv,key:x.key}),color:x.color});
  rangeChart('m-time',rows.filter(r=>r.x.key!=='closing'&&r.x.key!=='entrance').map(r=>({label:r.label,st:r.st,den:r.st.den,color:r.color})),{lo:ayStart(ay),hi:ayEnd(ay)});
  const S=r=>r.st.n>=THRESH.MIN_N?r.st:{};
  table($('#tbl',m),{name:`공통학사_${ay}_${regionName(rg)}`,rows,dim:r=>r.st.n<THRESH.MIN_N,columns:[
    {k:'e',label:'일정',get:r=>r.x.label},{k:'lv',label:'학교급',get:r=>LEVELS[r.lv]},{k:'n',label:'등록 학교',t:'int',get:r=>r.st.n},{k:'den',label:'조사 학교',t:'int',get:r=>r.st.den},{k:'rate',label:'등록률',t:'pct',get:r=>r.st.rate},
    {k:'min',label:'가장 이른',t:'date',get:r=>S(r).min},{k:'q1',label:'25%',t:'date',get:r=>S(r).q1},{k:'med',label:'중앙값',t:'date',get:r=>S(r).med},{k:'q3',label:'75%',t:'date',get:r=>S(r).q3},{k:'max',label:'가장 늦은',t:'date',get:r=>S(r).max},
    {k:'status',label:'상태',t:'html',get:r=>statusChip(r.st.status),csv:r=>statusText(r.st.status)}]});
  const msx=MS.find(x=>x.key===state.msKey)||MS[0];
  const rr=[];for(const r of REGIONS)for(const lv of ['E','M','H']){const st=E.milestoneStat(D,{ay,region:r.code,level:lv,key:msx.key});rr.push({label:`${r.name} ${LEVEL_SHORT[lv]}`,st,den:st.den,color:`var(--g${lv==='E'?1:lv==='M'?2:3})`})}
  rangeChart('m-reg',rr,{});
  $('#m-reg').insertAdjacentHTML('beforebegin',`<div class="legend"><span><i style="background:var(--g1)"></i>초등학교</span><span><i style="background:var(--g2)"></i>중학교</span><span><i style="background:var(--g3)"></i>고등학교</span><span>· ${msx.label}</span></div>`);
  bindPNG(m);
}

/* ================================================================
   화면 ⑥ 연간 캘린더
   ================================================================ */
const CAL_CATS=[
  {k:'exam',label:'시험(정기 지필)',color:'var(--s-exam)'},
  {k:'vac',label:'방학',color:'var(--s-vac)'},
  {k:'open',label:'개학·입학',color:'var(--s-open)'},
  {k:'grad',label:'졸업식',color:'var(--s-grad)'},
  {k:'disc',label:'재량휴업',color:'var(--s-disc)'},
  {k:'eval',label:'진단·성취도 평가',color:'var(--s-eval)'},
];
function calendarData(year,region,level,grade){
  const lo=dn(year,1,1),hi=dn(year,12,31),N=hi-lo+1;
  const mk=()=>new Array(N).fill(0);
  const c={exam:mk(),start:mk(),vac:mk(),open:mk(),grad:mk(),disc:mk(),eval:mk()};
  const ss=E.schoolsBy(D,region,level,[year-1,year]);
  const gOK=(r)=>grade==='ALL'||r.g===0||(r.g&(1<<(grade-1)));
  const names=new Map();
  const MAP={VACATION:'vac',OPENING:'open',ENTRANCE:'open',GRAD:'grad',DISCRETION:'disc',DIAG:'eval',ACHIEVE:'eval'};
  for(const s of ss){
    const exd=new Set(),stk=new Map(),exn=new Set();
    for(const e of D.epBySchool[s.idx]){if(e.review||e.grade<1||(grade!=='ALL'&&e.grade!==grade))continue;if(e.a!==year-1&&e.a!==year)continue;
      for(const d of e.dates){exd.add(d);if(d>=lo&&d<=hi)exn.add(d+'|'+e.names[0])}const k=`${e.a}|${e.sem}|${e.type}`;if(!stk.has(k)||e.start<stk.get(k))stk.set(k,e.start)}
    for(const d of exd)if(d>=lo&&d<=hi)c.exam[d-lo]++;
    for(const key of exn)names.set(key,(names.get(key)||0)+1);
    for(const d of stk.values())if(d>=lo&&d<=hi)c.start[d-lo]++;
    const seen={vac:new Set(),open:new Set(),grad:new Set(),disc:new Set(),eval:new Set()};
    for(const r of D.evBySchool[s.idx]){
      if(r.end<lo||r.start>hi||!gOK(r))continue;
      const k=MAP[r.cat];
      for(let d=Math.max(lo,r.start);d<=Math.min(hi,r.end);d++){
        if(k&&!seen[k].has(d)){seen[k].add(d);c[k][d-lo]++}
        if(r.cat!=='VACATION'){const key=d+'|'+r.name;names.set(key,(names.get(key)||0)+1)}
      }
    }
  }
  return {lo,hi,N,c,den:ss.length,names};
}
function pageCalendar(m){
  const y=state.calYear,lv=state.cLevel,g=state.cGrade;
  m.innerHTML=head('연간 학사일정 캘린더','1월~12월 한눈에 보기. 칸의 파란 농도는 그날 시험을 치르는 학교 비율이고, 검은 테두리는 시험 집중 기간(첫 시험일 25~75%)입니다. 날짜를 누르면 그날 일정이 오른쪽에 나옵니다.')+
    filterBar([['calYear','연도','calYear'],['region','지역','region'],['cLevel','학교급','levelAny'],['cGrade','학년','grade',lv]])+
    `<div class="kpis" id="kpis"></div>
     <div class="grid2"><section class="card"><div class="card-h"><div><h3>이번 달 주요 학사일정</h3><p id="monthLbl"></p></div></div><ul class="list" id="thisMonth"></ul></section>
     <section class="card"><div class="card-h"><div><h3>향후 30일 개학·방학·졸업 일정</h3><p>${fmtD(TODAY)} ~ ${fmtD(TODAY+30)}</p></div></div><ul class="list" id="upcoming"></ul></section></div>
     <div class="two-col"><section class="card"><div class="card-h"><div><h3>${y}년 캘린더</h3></div><div class="btns"><button class="btn" id="calCsv">일자별 CSV</button></div></div>
       <div class="legend">${CAL_CATS.map(c=>`<span><i style="background:${c.color}"></i>${c.label}</span>`).join('')}<span><i style="background:transparent;border:1.5px solid var(--ink)"></i>시험 집중 기간</span><span><i style="background:transparent;border:2px solid var(--today)"></i>오늘</span></div>
       <div class="cal-grid" id="cal"></div></section>
     <aside style="display:flex;flex-direction:column;gap:16px;min-width:0"><section class="card"><div class="card-h"><div><h3 id="dayTitle">날짜를 선택하세요</h3></div></div><div id="dayDetail" style="font-size:13px;color:var(--ink2)">캘린더의 날짜를 누르면 일정 수와 원본 행사명을 보여줍니다.</div></section>
     <section class="card"><div class="card-h"><div><h3>지역별 시험 집중도 (향후 30일)</h3><p>${lv==='ALL'?'전체 학교급':LEVELS[lv]} ${gradeName(g)} · 지역 학교 중 시험을 시작하는 비율</p></div></div><div id="regConc"></div></section></aside></div>`;
  bindFilters(m);
  const cd=calendarData(y,state.region,lv,g);
  const {lo,c,den}=cd;
  // 집중 기간: 학년도 y-1, y의 학기·시험별 IQR
  const win=[];
  if(lv!=='E')for(const a of [y-1,y])for(const se of [1,2])for(const t of ['MID','FINAL']){
    const lvls=lv==='ALL'?['M','H']:[lv];
    for(const L of lvls){const st=E.examStat(D,{ay:a,region:state.region,level:L,grade:g,sem:se,type:t});if(st.n>=THRESH.MIN_N)win.push({a,se,t,L,q1:st.q1,q3:st.q3,med:st.med,n:st.n})}}
  const inWin=d=>win.some(w=>d>=w.q1&&d<=w.q3);
  // 요약
  const t30=[TODAY,TODAY+30];
  const startsInRange=(cdx,a,b)=>{let s=0;for(let d=a;d<=b;d++){const i=d-cdx.lo;if(i>=0&&i<cdx.N)s+=cdx.c.start[i]}return s};
  let n30=0;{const cdNow=parts(TODAY)[0]===y?cd:calendarData(parts(TODAY)[0],state.region,lv,g);n30=startsInRange(cdNow,...t30);
    if(parts(TODAY+30)[0]!==parts(TODAY)[0])n30+=startsInRange(calendarData(parts(TODAY+30)[0],state.region,lv,g),...t30)}
  let bestW=null,bestV=0;for(let w=mondayOf(lo);w<=cd.hi;w+=7){let v=0;for(let d=w;d<w+7;d++){const i=d-lo;if(i>=0&&i<cd.N)v+=c.start[i]}if(v>bestV){bestV=v;bestW=w}}
  const thisM=parts(TODAY)[0]===y?parts(TODAY)[1]:1;
  $('#kpis',m).innerHTML=kpi('조사 학교',den.toLocaleString()+'곳',`${regionName(state.region)} ${lv==='ALL'?'전체 학교급':LEVELS[lv]} ${gradeName(g)}`)+
    kpi('향후 30일 시험 시작',`${n30.toLocaleString()}건`,'학교·학기·시험 종류별 시작 1회 기준')+
    kpi(`${y}년 시험 시작 최다 주간`,bestW?`${fmtMD(bestW)} 주`:'–',bestW?`${bestV.toLocaleString()}건 시작`:'')+
    kpi('시험 집중 기간',win.filter(w=>w.a===E.ayOf(TODAY)&&w.q3>=TODAY).sort((a,b)=>a.q1-b.q1).slice(0,1).map(w=>`${fmtMD(w.q1)}~${fmtMD(w.q3)}`)[0]||'–',
      win.filter(w=>w.a===E.ayOf(TODAY)&&w.q3>=TODAY).sort((a,b)=>a.q1-b.q1).slice(0,1).map(w=>`다음: ${LEVEL_SHORT[w.L]} ${w.se}학기 ${TYPE_NAME[w.t]}`)[0]||'올해 남은 집중 기간 없음');
  // 이번 달
  $('#monthLbl',m).textContent=`${y}년 ${thisM}월 · 등록 학교 수 기준`;
  const mlo=dn(y,thisM,1),mhi=dn(thisM===12?y+1:y,thisM===12?1:thisM+1,1)-1;
  const items=[];
  for(const w of win)if(w.q3>=mlo&&w.q1<=mhi)items.push([`${LEVEL_SHORT[w.L]} ${w.se}학기 ${TYPE_NAME[w.t]} 집중`,`${fmtMD(w.q1)}~${fmtMD(w.q3)} · 중앙 ${fmtMD(w.med)}`,w.q1]);
  const peakOf=(k,lab)=>{let best=-1,bd=null,tot=0;for(let d=mlo;d<=mhi;d++){const v=c[k][d-lo]||0;tot+=v;if(v>best){best=v;bd=d}}if(best>0)items.push([lab,`최다 ${fmtMD(bd)} · ${best}곳`,bd])};
  peakOf('open','개학·입학');peakOf('grad','졸업식');peakOf('disc','재량휴업');peakOf('eval','진단·성취도 평가');
  {let vd=0;for(let d=mlo;d<=mhi;d++)if(den&&c.vac[d-lo]/den>=0.4)vd++;if(vd)items.push(['방학 (학교 40% 이상)',`${vd}일`,mlo])}
  items.sort((a,b)=>a[2]-b[2]);
  $('#thisMonth',m).innerHTML=items.length?items.map(i=>`<li><span>${esc(i[0])}</span><span>${esc(i[1])}</span></li>`).join(''):'<li><span>등록된 주요 일정이 없습니다</span><span></span></li>';
  // 향후 30일 개학/방학
  const up=[];const curAy=E.ayOf(TODAY);
  for(const x of MS)for(const L of (lv==='ALL'?['E','M','H']:[lv])){
    let n=0;const vals=[];
    for(const s of E.schoolsBy(D,state.region,L,[curAy,curAy+1])){for(const a of [curAy,curAy+1]){const v=D.milestones[s.idx][a]?.[x.key];if(v!=null&&v>=TODAY&&v<=TODAY+30){n++;vals.push(v)}}}
    if(n){const st=E.summarize(vals);up.push([`${x.label} · ${LEVEL_SHORT[L]}`,`${n}곳 · 중앙 ${fmtD(st.med)}`,st.med])}
  }
  up.sort((a,b)=>a[2]-b[2]);
  $('#upcoming',m).innerHTML=up.length?up.map(i=>`<li><span>${esc(i[0])}</span><span>${esc(i[1])}</span></li>`).join(''):'<li><span>향후 30일 안에 등록된 개학·방학·졸업 일정이 없습니다</span><span></span></li>';
  // 지역 집중도
  const conc=REGIONS.map(r=>{const ss=E.schoolsBy(D,r.code,lv,[curAy,curAy+1]);let k=0;
    for(const s of ss){if(D.epBySchool[s.idx].some(e=>!e.review&&e.grade>=1&&(g==='ALL'||e.grade===g)&&e.start>=TODAY&&e.start<=TODAY+30))k++}
    return {r,v:ss.length?k/ss.length:0,k,den:ss.length}}).sort((a,b)=>b.v-a.v);
  $('#regConc',m).innerHTML=conc.map(x=>`<div class="bar-row" data-tip="${esc(`${x.r.full}\n${x.k} / ${x.den}곳`)}"><span>${x.r.name}${x.den<THRESH.WARN_N?'*':''}</span><span class="track"><span class="fill" style="display:block;width:${(x.v*100).toFixed(1)}%"></span></span><span style="text-align:right">${pct(x.v)}</span></div>`).join('');
  // 달력
  const maxShare=Math.max(0.0001,...c.exam.map(v=>den?v/den:0));
  let html='';
  for(let mo=1;mo<=12;mo++){
    const first=dn(y,mo,1),last=dn(mo===12?y+1:y,mo===12?1:mo+1,1)-1;
    html+=`<div class="month"><h4>${mo}월</h4><div class="mgrid">${'일월화수목금토'.split('').map(d=>`<span class="dh">${d}</span>`).join('')}`;
    for(let k=0;k<dow(first);k++)html+='<span class="day empty"></span>';
    for(let d=first;d<=last;d++){
      const i=d-lo,ex=den?c.exam[i]/den:0,vac=den?c.vac[i]/den:0;
      const op=ex>0?Math.max(.1,ex/maxShare):0;
      const bg=ex>0?`background:color-mix(in srgb,var(--s-exam) ${Math.round(op*90)}%,var(--surface2))`:'';
      const dots=[];const th=Math.max(1,den*0.05);
      if(c.open[i]>=th)dots.push('var(--s-open)');if(c.grad[i]>=th)dots.push('var(--s-grad)');if(c.disc[i]>=th)dots.push('var(--s-disc)');if(c.eval[i]>=th)dots.push('var(--s-eval)');
      const tipT=`${fmtD(d)}\n시험 중 ${c.exam[i]}곳 (${pct(ex)}) · 시작 ${c.start[i]}건\n방학 ${c.vac[i]}곳 · 개학·입학 ${c.open[i]} · 졸업 ${c.grad[i]} · 재량휴업 ${c.disc[i]} · 평가 ${c.eval[i]}`;
      html+=`<button class="day ${isOff(d)?'we':''} ${inWin(d)?'focus-win':''} ${d===TODAY?'today':''} ${state.calPick===d?'picked':''} ${op>.55?'hot':''}" style="${bg}" data-d="${d}" data-tip="${esc(tipT)}" aria-label="${esc(tipT)}">${parts(d)[2]}${vac>=0.4?'<span class="vac"></span>':''}${dots.length?`<span class="dots">${dots.map(cc=>`<i style="background:${cc}"></i>`).join('')}</span>`:''}</button>`;
    }
    html+='</div></div>';
  }
  $('#cal',m).innerHTML=html;
  const showDay=d=>{
    state.calPick=d;m.querySelectorAll('.day.picked').forEach(e=>e.classList.remove('picked'));m.querySelector(`.day[data-d="${d}"]`)?.classList.add('picked');
    const i=d-lo;$('#dayTitle',m).textContent=fmtD(d)+' 일정';
    const nm=[...cd.names.entries()].filter(([k])=>+k.split('|')[0]===d).map(([k,v])=>[k.split('|').slice(1).join('|'),v]).sort((a,b)=>b[1]-a[1]).slice(0,10);
    $('#dayDetail',m).innerHTML=`<ul class="list"><li><span>시험 진행 학교</span><span>${c.exam[i]}곳 (${pct(den?c.exam[i]/den:0)})</span></li><li><span>시험 시작</span><span>${c.start[i]}건</span></li><li><span>방학 중</span><span>${c.vac[i]}곳</span></li><li><span>개학·입학</span><span>${c.open[i]}곳</span></li><li><span>졸업식</span><span>${c.grad[i]}곳</span></li><li><span>재량휴업</span><span>${c.disc[i]}곳</span></li><li><span>진단·성취도 평가</span><span>${c.eval[i]}곳</span></li></ul>
      <p style="margin:10px 0 4px;font-size:12px;color:var(--muted)">NEIS 원본 행사명 상위 (시험·주요 학사일정, 방학 제외)</p><ul class="list">${nm.map(([n,v])=>`<li><span>${esc(n)}</span><span>${v}곳</span></li>`).join('')||'<li><span>없음</span><span></span></li>'}</ul>`;
  };
  $('#cal',m).addEventListener('click',e=>{const b=e.target.closest('.day[data-d]');if(b)showDay(+b.dataset.d)});
  if(state.calPick&&state.calPick>=lo&&state.calPick<=cd.hi)showDay(state.calPick);
  $('#calCsv',m).onclick=()=>{const aoa=[['날짜','요일','조사 학교','시험 진행 학교','시험 시작 건수','방학 중 학교','개학·입학','졸업식','재량휴업','진단·성취도 평가','시험 집중 기간 포함']];
    for(let i=0;i<cd.N;i++){const d=lo+i;aoa.push([iso(d),'일월화수목금토'[dow(d)],den,c.exam[i],c.start[i],c.vac[i],c.open[i],c.grad[i],c.disc[i],c.eval[i],inWin(d)?'Y':'N'])}
    saveCSV(`캘린더_${y}_${regionName(state.region)}_${lv}_${g}`,aoa)};
}

/* ================================================================
   화면 ⑦ 학교별 상세
   ================================================================ */
function pageSchool(m){
  if(state.level==='ALL')state.level='M';
  m.innerHTML=head('학교별 상세 조회','지역 → 학교급 → 학교명 순서로 찾습니다. NEIS 원본 행사명과 분류 결과를 함께 보여주므로 통계가 어떤 행에서 나왔는지 확인할 수 있습니다.')+
    filterBar([['ay','학년도','ay'],['region','지역','region'],['level','학교급','levelAll']])+
    `<div class="two-col" style="grid-template-columns:300px minmax(0,1fr)"><section class="card"><label for="sq" style="font-size:12px;color:var(--muted)">학교명 검색</label><input id="sq" type="search" value="${esc(state.schoolQ)}" placeholder="예: 가람" style="padding:7px 9px;border:1px solid var(--line);border-radius:6px;background:var(--surface2)"><div class="school-list" id="slist"></div></section>
    <div id="sdetail" style="display:flex;flex-direction:column;gap:16px;min-width:0"><div class="notice info">왼쪽에서 학교를 고르세요.</div></div></div>`;
  bindFilters(m);
  const ss=E.schoolsBy(D,state.region,state.level,state.ay);
  const drawList=()=>{const q=state.schoolQ.trim();const f=ss.filter(s=>!q||s.name.includes(q)).slice(0,200);
    $('#slist',m).innerHTML=f.map(s=>`<button data-i="${s.idx}" class="${state.school===s.idx?'on':''}"><b style="font-weight:500">${esc(s.name)}</b><br><span style="font-size:11px;color:var(--muted)">${REGION_BY[s.region].name} · ${LEVELS[s.level]}</span></button>`).join('')||'<p style="color:var(--muted)">검색 결과가 없습니다.</p>';
    $('#slist',m).querySelectorAll('button').forEach(b=>b.onclick=()=>{state.school=+b.dataset.i;drawList();detail()})};
  $('#sq',m).addEventListener('input',e=>{state.schoolQ=e.target.value;drawList()});
  const detail=async()=>{
    const host=$('#sdetail',m);if(state.school==null||!ss.find(s=>s.idx===state.school)){host.innerHTML='<div class="notice info">왼쪽에서 학교를 고르세요.</div>';return}
    const s=D.schools[state.school],ay=state.ay,mg=MAXG[s.level];
    const eps=D.epBySchool[s.idx].filter(e=>e.a===ay);
    const rws0=await ensureRaw(ay,s.region,s.level);if(state.school!==s.idx)return;
    const vacs=D.evBySchool[s.idx].filter(r=>r.a===ay&&r.cat==='VACATION').map(v=>({s:s.idx,a:ay,d:v.start,n:`${v.name} (${fmtMD(v.start)}~${fmtMD(v.end)} 기간)`,c:'일별 행을 기간으로 묶어 표시',g:v.g,h:1,cat:'VACATION',type:null,sem:v.sem,rule:''}));
    const rws=[...rws0.filter(r=>r.s===s.idx),...vacs].sort((a,b)=>a.d-b.d);
    const inf=s.info[ay]||{},yi=yInfo(ay)||{};
    const ms=D.milestones[s.idx][ay]||{};
    host.innerHTML=`<section class="card"><div class="card-h"><div><h3>${esc(s.name)}</h3><p>${s.hsType?esc(s.hsType)+' · ':''}${inf.inSchoolInfo===0?'학교기본정보에 없음(폐교·통합 등 확인 필요)':'학교기본정보 등재'}</p></div>${IS_REAL()?'':'<span class="chip sample">모의</span>'}</div>
      <div class="meta-grid"><div><span>학교급</span>${LEVELS[s.level]}</div><div><span>교육청</span>${REGION_BY[s.region].full}</div><div><span>학교코드</span>${esc(s.code)}</div><div><span>학년도</span>${ay}학년도</div>
      <div><span>데이터 최종 수집일</span>${fmtTs(yi.collectedAt)}</div><div><span>학사일정 수정일(LOAD_DTM 최신)</span>${esc(inf.schedLoadDtm||'제공 안 됨')}</div>
      <div><span>학교 홈페이지</span>${s.homepage?`<a href="${esc(/^https?:/i.test(s.homepage)?s.homepage:'http://'+s.homepage)}" target="_blank" rel="noopener">${esc(s.homepage)}</a>`:'NEIS에 등록 안 됨'}</div>
      <div><span>홈페이지 대조</span><span class="chip warn" style="display:inline-flex">홈페이지 일정과 다르면 학교 확인 필요</span></div></div></section>
      <section class="card"><div class="card-h"><div><h3>학년별 시험 기간</h3><p>시작일 ~ 종료일 (시험 일수). 회색은 분류 검토 대상으로 통계에서 제외된 항목입니다.</p></div></div><div id="sexam"></div></section>
      <section class="card"><div class="card-h"><div><h3>주요 학사일정</h3></div></div><ul class="list">${MS.map(x=>`<li><span>${x.label}</span><span>${ms[x.key]!=null?fmtD(ms[x.key]):'등록 정보 없음'}</span></li>`).join('')}${s.level==='E'?EVAL.filter(x=>!x.sem).concat([{key:'formative',label:'형성·학기말 평가(첫 등록일)'}]).map(x=>`<li><span>${x.label}</span><span>${ms[x.key]!=null?fmtD(ms[x.key]):'등록 정보 없음'}</span></li>`).join(''):''}<li><span>재량휴업일</span><span>${ms.discretion&&ms.discretion.size?[...ms.discretion].sort((a,b)=>a-b).map(fmtMD).join(', '):'등록 정보 없음'}</span></li></ul></section>
      <section class="card"><div class="card-h"><div><h3>NEIS 원본 행 (${rws.length}행)</h3><p>방학 일별 행은 기간 1행으로, 공휴일 행은 생략했습니다.</p></div></div><div id="sraw"></div></section>`;
    const exRows=[];
    for(let g=0;g<=mg;g++){const row={g,cells:{}};let any=false;
      for(const se of [1,2])for(const t of ['MID','FINAL','UNK']){const e=eps.filter(x=>x.grade===g&&x.sem===se&&x.type===t);if(e.length){any=true;row.cells[`${se}${t}`]=e}}
      if(any||g>0)exRows.push(row)}
    const cell=(r,k)=>{const e=r.cells[k];if(!e)return '<span style="color:var(--muted)">–</span>';return e.map(x=>`<span ${x.review?`style="color:var(--muted)" data-tip="${esc('검토: '+x.reason+'\n원본: '+x.names.join(', '))}"`:`data-tip="${esc('원본: '+x.names.join(', ')+'\n분류 근거: '+x.rule)}"`}>${fmtMD(x.start)}~${fmtMD(x.end)} (${x.days}일)${x.review?' 검토':''}</span>`).join('<br>')};
    const cols=[{k:'g',label:'학년',get:r=>gradeName(r.g)},...[1,2].flatMap(se=>['MID','FINAL'].map(t=>({k:`${se}${t}`,label:`${se}학기 ${TYPE_NAME[t]}`,t:'html',get:r=>cell(r,`${se}${t}`),csv:r=>(r.cells[`${se}${t}`]||[]).map(x=>`${iso(x.start)}~${iso(x.end)}${x.review?'(검토)':''}`).join('; ')}))),
      {k:'unk',label:'종류 불명',t:'html',get:r=>[cell(r,'1UNK'),cell(r,'2UNK')].filter(x=>!x.includes('–')).join('<br>')||'–',csv:r=>''}];
    table($('#sexam',host),{name:`학교시험_${s.name}_${ay}`,rows:exRows,columns:cols,search:false});
    table($('#sraw',host),{name:`학교원자료_${s.name}_${ay}`,rows:rws,limit:500,columns:[
      {k:'d',label:'일자(AA_YMD)',t:'date'},{k:'n',label:'행사명(EVENT_NM)'},{k:'c',label:'행사내용'},
      {k:'g',label:'학년별 여부',get:r=>{let o='';for(let g=1;g<=mg;g++)o+=(r.g&(1<<(g-1)))?g:'·';return o}},
      {k:'h',label:'수업공제일',get:r=>r.h?'휴업일':'해당없음'},{k:'cat',label:'분류',get:r=>CAT_LABEL[r.cat]+(r.type?` · ${TYPE_NAME[r.type]}`:'')},
      {k:'sem',label:'학기',get:r=>`${r.sem}학기`},{k:'rule',label:'분류 근거',get:r=>r.rule}]});
  };
  drawList();detail();
}

/* ================================================================
   화면 ⑧ 분류 검토 목록
   ================================================================ */
function pageReview(m){
  m.innerHTML=head('분류 검토 목록','중간·기말 판단이 불확실하거나 학년 정보가 없는 시험 일정입니다. 이 항목들은 통계에서 빠져 있으며, 사람이 확인한 뒤 규칙을 보완합니다.')+
    filterBar([['ay','학년도','ay'],['region','지역','region'],['level','학교급','levelAny']])+
    `<div class="kpis" id="kpis"></div><section class="card"><div class="card-h"><div><h3>검토 대상 (학교·학년·학기 단위로 묶음)</h3><p>여러 날짜 행은 하나의 항목으로 합쳤습니다.</p></div></div><div id="tbl"></div></section>
    <section class="card"><div class="card-h"><div><h3>현재 분류 규칙 요약</h3></div></div><div class="prose" style="font-size:13px"><ol>
    <li>'중간'·'기말'이 행사명에 있으면 그대로 분류합니다 (신뢰도 높음).</li>
    <li>'1차/1회 지필·고사' → 중간, '2차/2회' → 기말로 <b>추정</b>합니다 (신뢰도 중간). 같은 학기 안에서 순서가 뒤집혀 있거나, 기말 없이 '1차'만 학기말 시기(1학기 6/15 이후, 2학기 11/20 이후)에 있으면 검토로 보냅니다.</li>
    <li>'3차' 이상, 또는 '지필평가'·'정기고사'처럼 종류 표기가 없으면 검토로 보냅니다.</li>
    <li>모의고사·전국연합학력평가·수행평가·성적 확인·재시험 등은 정기 지필평가에서 제외합니다.</li>
    <li>학년별 행사 여부가 모두 N인 행은 어느 학년 시험인지 알 수 없으므로 검토로 보냅니다. 임의로 전 학년에 배정하지 않습니다.</li>
    <li>행사명의 'n학기' 표기가 날짜(3~7월=1학기, 8~2월=2학기)와 다르면 검토로 보냅니다.</li></ol></div></section>`;
  bindFilters(m);
  const items=D.episodes.filter(e=>e.review&&e.a===state.ay).filter(e=>{const s=D.schools[e.s];return (state.region==='ALL'||s.region===state.region)&&(state.level==='ALL'||s.level===state.level)});
  const by={};items.forEach(e=>{const k=e.reason.split(' · ')[0];by[k]=(by[k]||0)+1});
  $('#kpis',m).innerHTML=kpi('검토 항목',items.length.toLocaleString()+'건',`${state.ay}학년도`)+Object.entries(by).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([k,v])=>kpi(esc(k),v+'건','')).join('');
  table($('#tbl',m),{name:`분류검토_${state.ay}`,rows:items,columns:[
    {k:'region',label:'지역',get:e=>REGION_BY[D.schools[e.s].region].name},{k:'school',label:'학교',get:e=>D.schools[e.s].name},{k:'lv',label:'학교급',get:e=>LEVELS[D.schools[e.s].level]},
    {k:'grade',label:'학년',get:e=>gradeName(e.grade)},{k:'sem',label:'학기',get:e=>`${e.sem}학기`},{k:'type',label:'추정 종류',get:e=>TYPE_NAME[e.type]||'불명'},
    {k:'start',label:'시작일',t:'date'},{k:'end',label:'종료일',t:'date'},{k:'names',label:'NEIS 원본 행사명',get:e=>e.names.join(', ')},{k:'reason',label:'검토 사유'}]});
}

/* ================================================================
   화면 ⑨ 데이터·갱신·방법론
   ================================================================ */
function pageData(m){
  const nextRun=(()=>{let d=TODAY+1;while(dow(d)!==1)d++;return d})();
  const lr=META.lastRun||{};
  const failed=Object.values(lr.yearResults||{}).reduce((t,y)=>t+(y.failedSchools||0),0);
  m.innerHTML=head('데이터·갱신·방법론','데이터가 어디서 왔고, 언제 갱신되며, 통계를 어떻게 계산하는지 정리했습니다.')+
    `<div class="kpis">${kpi('데이터 출처',IS_REAL()?'NEIS 공식 API':'모의 NEIS 서버',IS_REAL()?'학사일정 · 학교기본정보':'수집기 시험용 가상 데이터')}${kpi('마지막 수집',fmtTs(lr.finishedAt),`${RUN_LABEL[lr.status]||'–'} · 호출 ${(lr.calls||0).toLocaleString()}회`)}${kpi('실패 학교 수',`${failed}곳`,`재시도 ${lr.retries||0}회`)}${kpi('다음 정기 갱신',fmtD(nextRun)+' 06:00','매주 월요일 · 1~3월은 목요일에도')}</div>
    ${lr.message?`<div class="notice">${esc(lr.message)}</div>`:''}
    <section class="card"><div class="card-h"><div><h3>학년도별 수집 현황</h3><p>학사일정 등록률이 ${pct(THRESH.YEAR_COVERAGE)} 미만인 학년도는 '데이터 부족'으로 보고 이전 학년도 통계로 대체하지 않습니다. 조사 대상 = 학교기본정보의 초·중·고 + 그 학년도 학사일정에 나온 학교(폐교 등).</p></div></div><div id="cov"></div></section>
    <section class="card"><div class="card-h"><div><h3>최근 수집 기록</h3></div></div><div id="runs"></div></section>
    <section class="card"><div class="card-h"><div><h3>통계 재현성 검증</h3><p>수집기(Python)가 계산한 통계와 이 화면(JavaScript)이 학교별 시험 기간에서 다시 계산한 통계를 모든 조합에 대해 비교합니다.</p></div><button class="btn primary" id="verify">검증 실행</button></div><div id="vres" style="font-size:13px;color:var(--ink2)">버튼을 누르면 선택 학년도의 모든 지역·학교급·학년·학기·시험 조합을 비교합니다.</div></section>
    <section class="card"><div class="card-h"><div><h3>원자료·집계 내려받기</h3><p>원자료는 지역 단위로 내려받습니다(방학 일별 행 제외).</p></div></div>
      <div class="filters" style="border:0;padding:0">${filterBar([['ay','학년도','ay'],['region','원자료 지역','region']]).replace('<div class="filters" role="group" aria-label="필터">','').replace(/<\/div>$/,'')}<div class="btns"><button class="btn" id="dRaw">원자료 CSV</button><button class="btn" id="dEp">학교별 시험기간 CSV</button><button class="btn" id="dAgg">지역 집계 Excel</button></div></div></section>
    <div class="cols2"><section class="card"><h3>구현된 기능</h3><ul class="prose done" style="font-size:13px">
      <li>NEIS 학교기본정보·학사일정 수집 (페이지네이션, 호출 간격, 재시도, 일일 한도 중단, 중단 후 재개)</li><li>교육청 일괄 조회 실패 시 학교별 재조회, 실패 학교 수 기록</li>
      <li>실패가 많으면 기존 데이터 유지, 지난 학년도 보관</li><li>행사명 분류·맥락 검사·검토 목록, 학교별 시험 기간 묶기</li><li>9개 분석 화면, CSV·Excel·이미지 내보내기</li><li>Python–JavaScript 통계 일치 검증</li></ul></section>
     <section class="card"><h3>아직 남은 일</h3><ul class="prose todo" style="font-size:13px">
      <li>실제 데이터로 분류 규칙 보정 (검토 목록에 많이 나오는 표현 반영)</li><li>학교 홈페이지 일정과의 자동 대조</li><li>고교 유형(일반고·특성화고 등) 필터</li><li>표본 학교를 정해 NEIS 원문과 직접 대조하는 품질 점검 기록</li></ul></section></div>
    <section class="card prose"><h3 style="margin-top:0">통계 계산 기준</h3><ol style="font-size:13px">
      <li><b>집계 단위</b>: 학교 → 학년 → 학기 → 시험 종류. 같은 단위의 원본 행이 여러 개(여러 날, 여러 행)여도 하나의 '시험 기간'으로 묶습니다. 날짜가 ${THRESH.GAP_SPLIT}일 넘게 떨어진 행은 별도 기간으로 나누고 검토로 보냅니다.</li>
      <li><b>시험 날짜 vs 시험 시작일</b>: 시험 날짜는 시험이 있는 모든 날, 시험 시작일은 그 기간의 첫날입니다. 분포 통계는 모두 시작일 기준입니다.</li>
      <li><b>학년 처리</b>: NEIS '학년별 행사 여부'(ONE_GRADE_EVENT_YN ~ SIX_GRADE_EVENT_YN)가 Y인 학년만 씁니다. '전체 학년'은 학교마다 등록된 학년 중 가장 이른 시작일 하나를 씁니다.</li>
      <li><b>사분위수</b>: 학교별 시작일(날짜 일련번호)을 정렬해 선형보간(Hyndman–Fan 7형, numpy <code>quantile(method="linear")</code>, Excel <code>QUARTILE.INC</code>)으로 계산하고 가장 가까운 날짜로 반올림합니다.</li>
      <li><b>시험 집중 기간</b> = 첫 시험일 25%~75% 지점. <b>전체 등록 기간</b> = 가장 이른 시작일 ~ 가장 늦은 종료일.</li>
      <li><b>평균 시험 일수</b> = 학교별 시험 기간에 등록된 서로 다른 날짜 수의 평균.</li>
      <li><b>등록률</b> = 해당 시험을 등록한 학교 수 / 조사 대상 학교 수. 미등록 학교를 '시험 없음'으로 보지 않습니다.</li>
      <li><b>표시 기준</b>: 등록 ${THRESH.MIN_N}곳 미만 → '데이터 부족'. ${THRESH.WARN_N}곳 미만 → '표본 부족'. 등록률 ${pct(THRESH.LOW_RATE)} 미만 → '등록률 낮음'.</li>
      <li><b>제외</b>: 야간과정 행, 특수학교·각종학교, 공휴일 행. 같은 학교·날짜·행사명·학년 조합의 중복 행은 하나로 셉니다.</li></ol>
      <h3>표본 편향 안내</h3><p style="font-size:13px">NEIS 학사일정은 학교가 직접 입력합니다. 시험 일정을 입력하지 않는 학교, 학년 구분 없이 입력하는 학교, 행사명을 독특하게 쓰는 학교는 통계에서 빠지거나 검토 목록으로 갑니다. 등록률이 낮은 지역·학년은 입력하는 학교 위주로 계산되므로 실제와 다를 수 있습니다. 학기 중 일정 변경은 다음 수집 때 반영됩니다.</p></section>`;
  bindFilters(m);
  const covRows=[];
  for(const ay of [...META.years].reverse()){const y=yInfo(ay);for(const lv of ['E','M','H']){const b=(y.byLevel||{})[lv]||{};covRows.push({ay,lv,den:b.schools||0,has:b.withSchedule||0,ex:b.withExam||0,ok:(y.coverage||0)>=THRESH.YEAR_COVERAGE,at:y.collectedAt,fail:y.failedSchools||0})}}
  table($('#cov',m),{name:'수집현황',rows:covRows,search:false,columns:[{k:'ay',label:'학년도',get:r=>`${r.ay}학년도`},{k:'lv',label:'학교급',get:r=>LEVELS[r.lv]},{k:'den',label:'조사 학교',t:'int'},{k:'has',label:'학사일정 등록',t:'int'},
    {k:'hr',label:'등록률',t:'pct',get:r=>r.den?r.has/r.den:null},{k:'ex',label:'시험 일정 등록',t:'int'},{k:'fail',label:'실패 학교(학년도)',t:'int'},{k:'at',label:'수집 시각',get:r=>fmtTs(r.at)},
    {k:'st',label:'상태',t:'html',get:r=>r.ok?'<span class="chip ok">집계 가능</span>':'<span class="chip bad">데이터 부족</span>',csv:r=>r.ok?'집계 가능':'데이터 부족'}]});
  table($('#runs',m),{name:'수집기록',rows:META.runs||[],search:false,columns:[{k:'startedAt',label:'시작',get:r=>fmtTs(r.startedAt)},{k:'finishedAt',label:'종료',get:r=>fmtTs(r.finishedAt)},
    {k:'status',label:'결과',get:r=>RUN_LABEL[r.status]||r.status},{k:'years',label:'학년도',get:r=>(r.years||[]).join(', ')},{k:'calls',label:'호출 수',t:'int'},{k:'retries',label:'재시도',t:'int'},
    {k:'fail',label:'실패 학교',t:'int',get:r=>Object.values(r.yearResults||{}).reduce((t,y)=>t+(y.failedSchools||0),0)},{k:'message',label:'메시지',get:r=>r.message||''}]});
  $('#verify',m).onclick=async()=>{
    const out=$('#vres',m);out.textContent='비교 중…';
    try{
      const S=await getJSON(`${state.ay}/stats.json`);let tot=0,bad=[];
      const y=x=>x==null?null:+E.ymd(x);
      for(const r of S.exam){const [rg,lv,g,sem,type,n,den,mn,q1,med,q3,mx,le,avg,st]=r;const j=E.examStat(D,{ay:state.ay,region:rg,level:lv,grade:g,sem,type});tot++;
        const ok=n===j.n&&den===j.den&&mn===y(j.min)&&q1===y(j.q1)&&med===y(j.med)&&q3===y(j.q3)&&mx===y(j.max)&&le===y(j.lastEnd)&&(avg==null?j.avgDays==null:Math.abs(avg-j.avgDays)<1e-3)&&st===j.status;
        if(!ok)bad.push(`${regionName(rg)} ${LEVEL_SHORT[lv]} ${gradeName(g)} ${sem}학기 ${TYPE_NAME[type]}: 수집기 n=${n}/중앙 ${med} · 화면 n=${j.n}/중앙 ${y(j.med)}`)}
      let mt=0,mb=0;for(const r of S.milestone){const [rg,lv,key,n,den,mn,q1,med]=r;const j=E.milestoneStat(D,{ay:state.ay,region:rg,level:lv,key});mt++;if(n!==j.n||den!==j.den||med!==y(j.med))mb++}
      out.innerHTML=bad.length||mb?`<span class="chip bad">불일치</span> 시험 ${tot}개 조합 중 ${bad.length}개, 주요 일정 ${mt}개 중 ${mb}개가 다릅니다.<ul>${bad.slice(0,10).map(b=>`<li>${esc(b)}</li>`).join('')}</ul>`
        :`<span class="chip ok">일치</span> ${state.ay}학년도 시험 통계 ${tot.toLocaleString()}개 조합, 주요 일정 통계 ${mt.toLocaleString()}개 조합이 모두 같습니다 (평균 일수는 소수 셋째 자리까지).`;
    }catch(e){out.textContent='검증용 통계 파일을 읽지 못했습니다: '+e.message}
  };
  $('#dRaw',m).onclick=async()=>{
    const regions=state.region==='ALL'?REGIONS.map(r=>r.code):[state.region];
    if(state.region==='ALL')toast('전국 원자료는 큽니다. 잠시 기다려 주세요');
    const aoa=[['ATPT_OFCDC_SC_CODE','교육청','SD_SCHUL_CODE','SCHUL_NM','학교급','AY','AA_YMD','EVENT_NM','EVENT_CNTNT','1학년','2학년','3학년','4학년','5학년','6학년','수업공제일','분류','시험종류','학기','분류근거']];
    for(const rg of regions)for(const lv of ['E','M','H']){for(const r of await ensureRaw(state.ay,rg,lv)){const s=D.schools[r.s];
      aoa.push([s.region,REGION_BY[s.region].full,s.code,s.name,LEVELS[s.level],r.a,E.ymd(r.d),r.n,r.c,...[0,1,2,3,4,5].map(i=>r.g&(1<<i)?'Y':'N'),r.h?'휴업일':'해당없음',CAT_LABEL[r.cat],r.type?TYPE_NAME[r.type]:'',r.sem,r.rule])}}
    saveCSV(`원자료_${IS_REAL()?'NEIS':'모의'}_${state.ay}_${regionName(state.region)}`,aoa)};
  $('#dEp',m).onclick=()=>{const aoa=[['지역','학교코드','학교명','학교급','학년도','학년','학기','시험종류','시작일','종료일','시험일수','원본행사명','분류근거','검토여부','검토사유']];
    for(const e of D.episodes){if(e.a!==state.ay)continue;const s=D.schools[e.s];aoa.push([REGION_BY[s.region].name,s.code,s.name,LEVELS[s.level],e.a,e.grade||'미지정',e.sem,TYPE_NAME[e.type]||'불명',iso(e.start),iso(e.end),e.days,e.names.join('; '),e.rule,e.review?'Y':'N',e.reason])}
    saveCSV(`학교별시험기간_${IS_REAL()?'NEIS':'모의'}_${state.ay}`,aoa)};
  $('#dAgg',m).onclick=()=>{const sheets=[];
    for(const lv of ['E','M','H']){const aoa=[['지역','학년','학기','시험','등록 학교','조사 학교','등록률(%)','가장 이른','25%','중앙값','75%','가장 늦은','가장 늦은 종료','평균 시험일수','상태']];
      for(const rg of ['ALL',...REGIONS.map(r=>r.code)])for(const g of ['ALL',...Array.from({length:MAXG[lv]},(_,i)=>i+1)])for(const se of [1,2])for(const t of ['MID','FINAL']){const st=E.examStat(D,{ay:state.ay,region:rg,level:lv,grade:g,sem:se,type:t});const ok=st.n>=THRESH.MIN_N;
        aoa.push([regionName(rg),gradeName(g),se,TYPE_NAME[t],st.n,st.den,st.rate==null?'':(st.rate*100).toFixed(1),ok?iso(st.min):'',ok?iso(st.q1):'',ok?iso(st.med):'',ok?iso(st.q3):'',ok?iso(st.max):'',ok?iso(st.lastEnd):'',ok?st.avgDays.toFixed(2):'',statusText(st.status)])}
      sheets.push([`${LEVELS[lv]}`,aoa])}
    sheets.push(['안내',[[IS_REAL()?'출처: 교육부 나이스(NEIS) 교육정보 개방 포털':'모의 NEIS 서버 데이터로 계산한 결과입니다. 실제 통계가 아닙니다.'],[`마지막 수집: ${fmtTs((META.lastRun||{}).finishedAt)}`],['사분위수: 선형보간(type 7) 후 날짜 반올림'],[`등록 ${THRESH.MIN_N}곳 미만은 통계를 비웁니다`]]]);
    saveXLSX(`지역집계_${IS_REAL()?'NEIS':'모의'}_${state.ay}`,sheets)};
}

/* ---------- 렌더 ---------- */
const PAGE_FN={exams:pageExams,grades:pageGrades,regions:pageRegions,elementary:pageElementary,common:pageCommon,calendar:pageCalendar,school:pageSchool,review:pageReview,data:pageData};
const NEED={exams:()=>[state.ay,state.ay-1],calendar:()=>[state.calYear-1,state.calYear,CUR_AY,CUR_AY+1],data:()=>[state.ay]};
let lastRoute=null,seq=0;
async function render(){
  const r=route();renderNav();
  const m=$('#main');const y=scrollY;const my=++seq;
  if((r==='exams'||r==='school')&&state.level==='ALL')state.level='M';
  const need=(NEED[r]||(()=>[state.ay]))();
  if(need.some(a=>META.years.includes(a)&&!D.loaded.has(a))){
    m.innerHTML='<div class="loading">학년도 데이터를 불러오는 중…</div>';
    try{await Promise.all(need.map(ensureYear))}catch(e){m.innerHTML=`<div class="notice">데이터 파일을 읽지 못했습니다: ${esc(e.message)}</div>`;return}
    if(my!==seq)return;
  }
  m.innerHTML='';PAGE_FN[r](m);
  if(lastRoute===r)scrollTo(0,y);else scrollTo(0,0);lastRoute=r;
}
window.addEventListener('hashchange',render);
let rt,lastW=innerWidth;window.addEventListener('resize',()=>{if(Math.abs(innerWidth-lastW)<40)return;lastW=innerWidth;clearTimeout(rt);rt=setTimeout(()=>{const y=scrollY;render();scrollTo(0,y)},250)});
(async()=>{
  try{META=await getJSON('manifest.json')}
  catch(e){
    $('#srcBar').innerHTML='<span class="chip bad">데이터 없음</span><span>수집 결과(data/manifest.json)를 찾지 못했습니다.</span>';
    $('#main').innerHTML=`<div class="notice"><b>데이터 파일을 찾지 못했습니다.</b><br>1) 수집기를 먼저 실행했는지 확인하세요 (README의 '수집 실행').<br>2) 내 PC에서 볼 때는 index.html을 더블클릭하지 말고 <code>docs</code> 폴더에서 <code>python -m http.server 8000</code> 실행 후 http://localhost:8000 으로 여세요.<br><span style="color:var(--muted)">${esc(e.message)}</span></div>`;
    return;
  }
  META.years=(META.years||[]).map(Number);
  AYS=[...new Set([...META.years,CUR_AY,CUR_AY+1])].sort((a,b)=>a-b);
  if(!AYS.includes(state.ay))state.ay=META.years.includes(CUR_AY)?CUR_AY:META.years[META.years.length-1]||CUR_AY;
  if(!state.calYear||state.calYear>CUR_AY+1)state.calYear=parts(TODAY)[0];
  render();
})();
})();

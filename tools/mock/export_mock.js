// 모의 NEIS 데이터 생성: 1단계 샘플 생성기로 만든 가상 학교·학사일정을 NEIS 응답 필드 형식으로 저장
// 사용: node tools/mock/export_mock.js tools/mock/data
require('./sample_engine.js');
const E=globalThis.ENG, fs=require('fs'), out=process.argv[2]||'tools/mock/data';
fs.mkdirSync(out,{recursive:true});
const raw=E.generateSample(E.dn(2026,11,9));
const KIND={E:'초등학교',M:'중학교',H:'고등학교'};
const code=s=>String(7000000+s.idx*7);
const schoolInfo=raw.schools.map(s=>({ATPT_OFCDC_SC_CODE:s.region,ATPT_OFCDC_SC_NM:E.REGION_BY[s.region].full,SD_SCHUL_CODE:code(s),SCHUL_NM:s.name,
  SCHUL_KND_SC_NM:KIND[s.level],LCTN_SC_NM:E.REGION_BY[s.region].name,FOND_SC_NM:'공립',HS_SC_NM:s.level==='H'?'일반고':null,HMPG_ADRES:'',LOAD_DTM:'20260301'}));
// 폐교 등으로 학교기본정보에 없는 학교 1곳을 일정에만 남김
const dropped=schoolInfo.splice(5,1)[0];
const yn=(g,i)=>(g&(1<<i))?'Y':'*';
const sched=raw.rows.map(r=>{const s=raw.schools[r.s];return {ATPT_OFCDC_SC_CODE:s.region,ATPT_OFCDC_SC_NM:E.REGION_BY[s.region].full,SD_SCHUL_CODE:code(s),SCHUL_NM:s.name,AY:String(r.a),
  DGHT_CRSE_SC_NM:'주간',SCHUL_CRSE_SC_NM:KIND[s.level],SBTR_DD_SC_NM:r.h?'휴업일':'해당없음',AA_YMD:E.ymd(r.d),EVENT_NM:r.n,EVENT_CNTNT:r.c||null,
  ONE_GRADE_EVENT_YN:yn(r.g,0),TW_GRADE_EVENT_YN:yn(r.g,1),THREE_GRADE_EVENT_YN:yn(r.g,2),FR_GRADE_EVENT_YN:yn(r.g,3),FIV_GRADE_EVENT_YN:yn(r.g,4),SIX_GRADE_EVENT_YN:yn(r.g,5),LOAD_DTM:'20261101'}});
// 야간과정 중복 행 몇 개 (수집기가 걸러내야 함)
for(let i=0;i<30;i++)sched.push({...sched[i*101],DGHT_CRSE_SC_NM:'야간'});
fs.writeFileSync(out+'/schoolInfo.json',JSON.stringify(schoolInfo));
fs.writeFileSync(out+'/SchoolSchedule.json',JSON.stringify(sched));
console.log('schools',schoolInfo.length,'(dropped',dropped.SD_SCHUL_CODE+')','rows',sched.length);

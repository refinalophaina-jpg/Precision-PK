'use strict';
const fs=require('fs'), vm=require('vm');
const APP='/Users/olaiya/Projects-Local/Pharmacy/Vancomycin /AinaDaraTDM/index.html';
const script=fs.readFileSync(APP,'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
let F={};
function mk(id){return{get value(){return F[id]!==undefined?String(F[id]):''},set value(x){F[id]=x},
 textContent:'',innerHTML:'',style:{},checked:false,classList:{toggle(){},add(){},remove(){},contains(){return false}},
 querySelectorAll:()=>[],querySelector:()=>null,getAttribute:()=>null,setAttribute(){},addEventListener(){},appendChild(){},removeChild(){}};}
const sb={document:{getElementById:(id)=>mk(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>mk('_')},
 window:{},alert(){},requestAnimationFrame(){},console,Math,parseFloat,parseInt,isNaN,isFinite,NaN,Infinity,
 Object,Array,String,Number,Boolean,Function,Date,Error,TypeError,JSON,RegExp,
 bState:{sex:'M',model:'buelga',dial:false,result:null,tinkCompare:[]}};
sb.window=sb; vm.runInNewContext(script,sb);
const {calcIBW,calcAdjBW,calcCrCl,calcCLv,calcVd,calcPeakTrough,buelgaPopPK,
       getBayesCrCl,getGotiCrCl,getUncappedCrCl,SCR_POLICY,ckdEpiCrCys,duBoisBsa,
       ibwMethod,pickCrClWeight,checkValue}=sb;
const f=(x,d=2)=>Number.isFinite(x)?x.toFixed(d):String(x);
const hr=t=>console.log('\n'+'─'.repeat(72)+'\n  '+t+'\n'+'─'.repeat(72));

hr('IBW — your specified test case: Female, 147.3 cm, 52 kg');
const ibw=calcIBW('F',147.3), adj=calcAdjBW(52,ibw), pct=(52-ibw)/ibw*100;
console.log(`  method              ${ibwMethod(147.3)}  (height < 152.4 cm)`);
console.log(`  IBW                 ${f(ibw)} kg      spec expected ~46.7  ${Math.abs(ibw-46.7)<0.15?'MATCH':'DIFF'}`);
console.log(`  AdjBW               ${f(adj)} kg      spec expected ~48.8  ${Math.abs(adj-48.8)<0.15?'MATCH':'DIFF'}`);
console.log(`  % over IBW          ${f(pct)}%       spec expected 11.3%  ${Math.abs(pct-11.3)<0.15?'MATCH':'DIFF  <-- see note'}`);
console.log(`  (Devine would give  ${f(45.5+2.3*(147.3/2.54-60))} kg — understates IBW in short stature)`);

hr('IBW — continuity across the 152.4 cm boundary');
for (const h of [150,152,152.3,152.4,152.5,155]) {
  console.log(`  ${String(h).padStart(6)} cm  F  IBW ${f(calcIBW('F',h)).padStart(6)} kg   [${ibwMethod(h)}]`);
}

hr('A1 — Goti SCr truncation now age > 60 (was > 65)');
for (const [age,scr] of [[58,0.7],[61,0.7],[63,0.5],[66,0.7]]) {
  F={'b-age':age,'b-scr':scr,'b-tbw':80,'b-height':175}; sb.bState.sex='M';
  console.log(`  age ${age} SCr ${scr}   displayed CrCl ${f(getBayesCrCl()).padStart(7)}   Goti CrCl ${f(getGotiCrCl()).padStart(7)}   ${age>60&&scr<1?'truncation ACTIVE':'no truncation'}`);
}

hr('A2 — Buelga is now ONE model across the suite');
for (const c of [20,60,80,120,150]) {
  const m1=calcCLv('buelga',c,76), m2=buelgaPopPK(c,76).CL_pop;
  console.log(`  CrCl ${String(c).padStart(4)}   Module1 CL ${f(m1,3)}   Bayesian prior CL ${f(m2,3)}   ratio x${f(m1/m2,3)}`);
}
const vd1=calcVd('buelga',60,76,80), vd2=buelgaPopPK(80,76).V_pop;
console.log(`  Vd:      Module1 ${f(vd1,1)} L      prior ${f(vd2,1)} L      ratio x${f(vd1/vd2,3)}`);

hr('A3/A4 — validation rejects what used to become 0 or Infinity');
for (const [raw,key] of [['','scr'],['abc','age'],['200','age'],['0','weight'],['500','weight'],['1.2','scr']]) {
  const r=checkValue(raw,key);
  console.log(`  ${key.padEnd(7)} "${String(raw).padEnd(4)}"  ->  ${r.ok?'accept '+r.value:'REJECT: '+r.message}`);
}

hr('A5 — no-elimination guard returns an error, not a zero trough');
const g=calcPeakTrough(1000,24,1,0,70);
console.log(`  kel=0  ->  peak ${g.peak}  trough ${g.trough}  invalid=${g.invalid}`);
console.log(`  reason: ${g.reason}`);

hr('A8 — "AdjBW" now returns AdjBW for a non-obese patient');
const ibw2=calcIBW('M',178);
for (const mode of ['TBW','IBW','AdjBW','auto']) {
  const r=pickCrClWeight(mode,75,ibw2);
  console.log(`  ${mode.padEnd(6)} -> ${f(r.wt)} kg   (${r.basis})`);
}
console.log(`  IBW is ${f(ibw2)} kg; true AdjBW = ${f(calcAdjBW(75,ibw2))} kg. Previously "AdjBW" gave ${f(ibw2)}.`);

hr('Cystatin C — discordance detection (low muscle mass)');
for (const [age,sex,scr,cysc,lbl] of [[78,'F',0.6,1.6,'cachectic elderly'],[45,'M',1.0,1.0,'concordant'],[70,'M',0.7,0.8,'mild']]) {
  const e=ckdEpiCrCys(age,sex,scr,cysc); const bsa=duBoisBsa(165,60);
  const abs=e*(bsa/1.73); const cg=calcCrCl(age,sex,scr,60,SCR_POLICY.ACTUAL);
  console.log(`  ${lbl.padEnd(18)} CG ${f(cg,0).padStart(4)}  vs cr-cys ${f(abs,0).padStart(4)} mL/min   CG is ${f((cg-abs)/abs*100,0)}% higher`);
}

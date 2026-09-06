'use strict';
const fs=require('fs'),vm=require('vm');
const APP='/Users/olaiya/Projects-Local/Pharmacy/Vancomycin /AinaDaraTDM/index.html';
const src=fs.readFileSync(APP,'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
function mk(){return{value:'',textContent:'',innerHTML:'',style:{},checked:false,classList:{toggle(){},add(){},remove(){},contains(){return false}},querySelectorAll:()=>[],querySelector:()=>null,getAttribute:()=>null,setAttribute(){},addEventListener(){},appendChild(){},removeChild(){},closest:()=>null};}
function load(){const sb={document:{getElementById:()=>mk(),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>mk()},window:{},alert(){},requestAnimationFrame(){},console,Math,parseFloat,parseInt,isNaN,isFinite,NaN,Infinity,Object,Array,String,Number,Boolean,Function,Date,Error,TypeError,JSON,RegExp,Map,Set,bState:{sex:'M'}};sb.window=sb;vm.runInNewContext(src,sb);return sb;}
const A=load(), B=load(); B.ssCycles2comp=()=>12;

let n=0, changed=0, worstTrough=0, worstCase=null, troughErrs=[];
for (const crcl of [5,8,10,12,15,20,25,30,40,50,60,80,100,120,150])
for (const wt of [50,70,90,120])
for (const target of [400,450,500,550,600])
for (const dial of [false,true]) {
  const p=A.gotiPopPK(crcl,wt,dial);
  const bag={Vc:p.TVVc,Vp:p.TVVp,Q:p.Q};
  const a=A.bayesDoseOptimizer(p.TVCL,p.TVVc,target,bag);
  const b=B.bayesDoseOptimizer(p.TVCL,p.TVVc,target,bag);
  if(!a||!b) continue;
  n++;
  if(a.dose!==b.dose||a.tau!==b.tau) changed++;
  if(Number.isFinite(a.Ctrough)&&Number.isFinite(b.Ctrough)&&b.Ctrough>0){
    const err=(a.Ctrough-b.Ctrough)/b.Ctrough;
    troughErrs.push(err);
    if(err>worstTrough){worstTrough=err;worstCase={crcl,wt,target,dial,old:b.Ctrough,now:a.Ctrough,dose:a.dose,tau:a.tau};}
  }
}
troughErrs.sort((x,y)=>x-y);
const pct=(q)=>troughErrs[Math.min(troughErrs.length-1,Math.floor(q*troughErrs.length))];
const f=(x,d=1)=>x.toFixed(d);
console.log(`  swept ${n} Goti/Hughes regimen decisions (CrCl x weight x target x dialysis)\n`);
console.log(`  regimens whose DOSE or INTERVAL changed : ${changed}  (${f(changed/n*100)}%)`);
console.log(`  reported TROUGH understated by the 12-cycle form:`);
console.log(`     median ${f(pct(0.5)*100)}%   p90 ${f(pct(0.9)*100)}%   max ${f(worstTrough*100)}%`);
if(worstCase) console.log(`     worst: CrCl ${worstCase.crcl}, ${worstCase.wt} kg, target ${worstCase.target}${worstCase.dial?', dialysis':''}`
  + ` -> ${worstCase.dose} mg Q${worstCase.tau}H, trough read ${f(worstCase.old)} but is ${f(worstCase.now)}`);
console.log(`\n  Dose selection is AUC-driven (dose ~ AUC x CL), and AUC does not use the`);
console.log(`  steady-state helper — so the PICK is unchanged. What was wrong is the trough`);
console.log(`  the clinician reads, and the guard that is supposed to veto accumulation.`);

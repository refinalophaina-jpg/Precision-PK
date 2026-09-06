'use strict';
// The comprehensive suite never calls the steady-state helpers, so it could not
// see F-007. Their real consumer is bayesDoseOptimizer — the recommended dose.
// Compare the shipped (converged) helpers against the retired 12-cycle version.
const fs=require('fs'),vm=require('vm');
const APP='/Users/olaiya/Projects-Local/Pharmacy/Vancomycin /AinaDaraTDM/index.html';
const src=fs.readFileSync(APP,'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
function mk(){return{value:'',textContent:'',innerHTML:'',style:{},checked:false,classList:{toggle(){},add(){},remove(){},contains(){return false}},querySelectorAll:()=>[],querySelector:()=>null,getAttribute:()=>null,setAttribute(){},addEventListener(){},appendChild(){},removeChild(){},closest:()=>null};}
function load(){const sb={document:{getElementById:()=>mk(),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>mk()},window:{},alert(){},requestAnimationFrame(){},console,Math,parseFloat,parseInt,isNaN,isFinite,NaN,Infinity,Object,Array,String,Number,Boolean,Function,Date,Error,TypeError,JSON,RegExp,Map,Set,bState:{sex:'M'}};sb.window=sb;vm.runInNewContext(src,sb);return sb;}

const A=load();                                   // shipped: converged cycles
const B=load();                                   // retired: fixed 12 cycles
B.ssCycles2comp = () => 12;

const f=(x,d=1)=>Number.isFinite(x)?x.toFixed(d):'—';
console.log('  Goti 2-comp dose recommendation: converged steady state vs the retired 12-cycle form');
console.log('  target AUC24 500, comparing the regimen each would advise\n');
console.log('  CrCl  t1/2(h)  | 12-cycle rec      trough | converged rec     trough | dose change');
let changed=0, total=0, maxUp=0;
for (const crcl of [5,10,15,20,30,40,60,90,120]) {
  const p=A.gotiPopPK(crcl,70,false);
  const CL=p.TVCL, Vc=p.TVVc, Vp=p.TVVp, Q=p.Q;
  const k10=CL/Vc,k12=Q/Vc,k21=Q/Vp, sum=k10+k12+k21;
  const beta=(sum-Math.sqrt(sum*sum-4*k21*k10))/2, th=Math.LN2/beta;
  const bag={Vc,Vp,Q};
  const rA=A.bayesDoseOptimizer(CL,Vc,500,bag);
  const rB=B.bayesDoseOptimizer(CL,Vc,500,bag);
  if(!rA||!rB) { console.log(`  ${String(crcl).padStart(4)}   ${f(th)}  | (no regimen returned)`); continue; }
  total++;
  const same = rA.dose===rB.dose && rA.tau===rB.tau;
  if(!same) changed++;
  const pct = (rA.dose*(24/rA.tau))/(rB.dose*(24/rB.tau)) - 1;
  maxUp = Math.max(maxUp, Math.abs(pct));
  console.log(`  ${String(crcl).padStart(4)}  ${f(th).padStart(6)}  | ${String(rB.dose).padStart(5)} mg Q${String(rB.tau).padStart(2)}H ${f(rB.Ctrough).padStart(7)} | ${String(rA.dose).padStart(5)} mg Q${String(rA.tau).padStart(2)}H ${f(rA.Ctrough).padStart(7)} | ${same?'unchanged':(pct>=0?'+':'')+f(pct*100)+'% daily'}`);
}
console.log(`\n  regimens changed: ${changed}/${total}   largest daily-dose change: ${f(maxUp*100)}%`);
console.log('  The 12-cycle form under-read the trough, so it accepted doses the converged');
console.log('  calculation rejects — the error ran toward MORE drug in slow clearers.');

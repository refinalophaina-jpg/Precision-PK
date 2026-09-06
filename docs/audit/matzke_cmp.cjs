'use strict';
const fs=require('fs'),vm=require('vm');
const APP='/Users/olaiya/Projects-Local/Pharmacy/Vancomycin /AinaDaraTDM/index.html';
const s=fs.readFileSync(APP,'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
function mk(){return{value:'',textContent:'',innerHTML:'',style:{},checked:false,classList:{toggle(){},add(){},remove(){},contains(){return false}},querySelectorAll:()=>[],querySelector:()=>null,getAttribute:()=>null,setAttribute(){},addEventListener(){},appendChild(){},removeChild(){}};}
const sb={document:{getElementById:()=>mk(),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>mk()},window:{},alert(){},requestAnimationFrame(){},console,Math,parseFloat,parseInt,isNaN,isFinite,NaN,Infinity,Object,Array,String,Number,Boolean,Function,Date,Error,TypeError,JSON,RegExp,Map,Set,bState:{sex:'M'}};
sb.window=sb;vm.runInNewContext(s,sb);
const {calcVd,calcCLv,calcPeakTrough,calcAUC}=sb;
const f=(x,d=2)=>Number.isFinite(x)?x.toFixed(d):'—';
console.log('  Matzke: CrCl-split vs pooled Vd — 1000 mg q12h, 1 h infusion, 80 kg\n');
console.log('  CrCl    Vd split   Vd pooled    peak split  peak pooled   trough split  trough pooled   AUC24');
for (const c of [15,30,45,58,59.9,60.1,62,75,90,120]) {
  const cl=calcCLv('matzke',c,80);
  const v1=calcVd('matzke',60,80,c), v2=calcVd('matzke_pooled',60,80,c);
  const a=calcPeakTrough(1000,12,1,cl/v1,v1), b=calcPeakTrough(1000,12,1,cl/v2,v2);
  console.log(`  ${String(c).padStart(5)}  ${f(v1,1).padStart(7)} L ${f(v2,1).padStart(9)} L  ${f(a.peak).padStart(9)}  ${f(b.peak).padStart(10)}   ${f(a.trough).padStart(11)}  ${f(b.trough).padStart(12)}   ${f(calcAUC(1000,12,cl),0).padStart(5)}`);
}
console.log('\n  The 60 boundary: split jumps Vd 0.89 -> 0.72 L/kg (-19%) across 0.2 mL/min.');
console.log('  Pooled is flat at 0.875 L/kg, so peak/trough move smoothly with CrCl.');
console.log('  AUC24 is identical either way — it depends on CL, which both share.');

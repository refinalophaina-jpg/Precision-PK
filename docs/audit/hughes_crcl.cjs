'use strict';
const fs=require('fs'),vm=require('vm');
const APP='/Users/olaiya/Projects-Local/Pharmacy/Vancomycin /AinaDaraTDM/index.html';
const src=fs.readFileSync(APP,'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
let F={};
function mk(id){return{get value(){return F[id]!==undefined?String(F[id]):''},set value(v){F[id]=v},
 textContent:'',innerHTML:'',style:{},checked:false,classList:{toggle(){},add(){},remove(){},contains(){return false}},
 querySelectorAll:()=>[],querySelector:()=>null,getAttribute:()=>null,setAttribute(){},addEventListener(){},appendChild(){},removeChild(){},closest:()=>null};}
const sb={document:{getElementById:id=>mk(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>mk('_')},window:{},alert(){},requestAnimationFrame(){},console,Math,parseFloat,parseInt,isNaN,isFinite,NaN,Infinity,Object,Array,String,Number,Boolean,Function,Date,Error,TypeError,JSON,RegExp,Map,Set,bState:{sex:'M'}};
sb.window=sb;vm.runInNewContext(src,sb);
const {getBayesCrCl,getHughesCrCl,getGotiCrCl,computeFFM,calcIBW,calcAdjBW}=sb;
const f=(x,d=0)=>Number.isFinite(x)?x.toFixed(d):'—';
console.log('  Why the Hughes CrCl reads lower — it is a different quantity\n');
console.log('  patient                    TBW   FFM   AdjBW | displayed CrCl  Goti CrCl  Hughes CrCl(FFM)');
for (const [sex,ht,wt,scr,lbl] of [
  ['M',178,150,1.0,'178cm 150kg M (BMI 47)'],
  ['F',165,130,0.9,'165cm 130kg F (BMI 48)'],
  ['M',175,105,1.0,'175cm 105kg M (BMI 34)'],
  ['M',175, 75,1.0,'175cm 75kg M (BMI 24)'],
]) {
  F={'b-age':60,'b-scr':scr,'b-tbw':wt,'b-height':ht}; sb.bState.sex=sex;
  const ffm=computeFFM(wt,ht,sex), ibw=calcIBW(sex,ht), adj=calcAdjBW(wt,ibw);
  console.log(`  ${lbl.padEnd(26)} ${f(wt).padStart(4)}  ${f(ffm).padStart(4)}  ${f(adj).padStart(5)} | ${f(getBayesCrCl()).padStart(13)}  ${f(getGotiCrCl()).padStart(9)}  ${f(getHughesCrCl()).padStart(15)}`);
}
console.log('\n  Hughes CL = 5.09 x (CrCl_FFM/100)^0.887 — the paper fitted its clearance');
console.log('  against a Cockcroft-Gault computed on FAT-FREE MASS: "Using FFM as an input');
console.log('  to the Cockcroft-Gault equation improved the fit significantly compared with');
console.log('  using TBW". So the lower number is the model INPUT it was calibrated on, not');
console.log('  an estimate of the patient\'s renal function. Feeding it a conventional CrCl');
console.log('  would over-predict clearance and over-dose.');

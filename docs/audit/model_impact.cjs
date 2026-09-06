'use strict';
const fs=require('fs'),vm=require('vm');
const APP='/Users/olaiya/Projects-Local/Pharmacy/Vancomycin /AinaDaraTDM/index.html';
const s=fs.readFileSync(APP,'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
function mk(){return{value:'',textContent:'',innerHTML:'',style:{},checked:false,classList:{toggle(){},add(){},remove(){},contains(){return false}},querySelectorAll:()=>[],querySelector:()=>null,getAttribute:()=>null,setAttribute(){},addEventListener(){},appendChild(){},removeChild(){}};}
const sb={document:{getElementById:()=>mk(),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>mk()},window:{},alert(){},requestAnimationFrame(){},console,Math,parseFloat,parseInt,isNaN,isFinite,NaN,Infinity,Object,Array,String,Number,Boolean,Function,Date,Error,TypeError,JSON,RegExp,Map,Set,bState:{sex:'M'}};
sb.window=sb;vm.runInNewContext(s,sb);
const {hughesPopPK,computeFFM,calcCrCl}=sb;
const f=(x,d=2)=>x.toFixed(d);
console.log('  A9 — Hughes: FFM removed from CL and Q (paper excluded that exponent)\n');
console.log('  patient                        FFM     old TVCL   new TVCL   change    old TVQ  new TVQ');
for (const [sex,ht,wt,scr,lbl] of [
  ['M',180,150,1.0,'180cm 150kg M (class 3)'],
  ['F',160,140,0.9,'160cm 140kg F (class 3)'],
  ['M',175, 95,1.1,'175cm 95kg M (overweight)'],
  ['F',155, 60,0.8,'155cm 60kg F (lean)'],
]) {
  const ffm=computeFFM(wt,ht,sex), r=ffm/70;
  const crcl=Math.max(5,(140-60)*ffm*(sex==='M'?1:0.85)/(72*scr));
  const n=hughesPopPK(crcl,ffm);
  const oldCL=n.TVCL*r, oldQ=n.TVQ*r;
  console.log(`  ${lbl.padEnd(28)} ${f(ffm,1).padStart(5)}   ${f(oldCL,2).padStart(8)}   ${f(n.TVCL,2).padStart(8)}   ${((n.TVCL/oldCL-1)*100>=0?'+':'')}${f((n.TVCL/oldCL-1)*100,1).padStart(5)}%   ${f(oldQ,2).padStart(6)}   ${f(n.TVQ,2).padStart(6)}`);
}
console.log('\n  A dose scales with clearance, so the CL column is the dose impact.');
console.log('  Direction: lean patients were UNDER-dosed, heavy patients OVER-dosed.');

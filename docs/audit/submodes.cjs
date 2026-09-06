'use strict';
// Do the Trough-Based sub-modes actually compute? Exercise their engine paths
// against hand-checkable inputs.
const fs=require('fs'),vm=require('vm');
const APP='/Users/olaiya/Projects-Local/Pharmacy/Vancomycin /AinaDaraTDM/index.html';
const src=fs.readFileSync(APP,'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
function mk(){return{value:'',textContent:'',innerHTML:'',style:{},checked:false,classList:{toggle(){},add(){},remove(){},contains(){return false}},querySelectorAll:()=>[],querySelector:()=>null,getAttribute:()=>null,setAttribute(){},addEventListener(){},appendChild(){},removeChild(){},closest:()=>null};}
const sb={document:{getElementById:()=>mk(),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>mk()},window:{},alert(){},requestAnimationFrame(){},console,Math,parseFloat,parseInt,isNaN,isFinite,NaN,Infinity,Object,Array,String,Number,Boolean,Function,Date,Error,TypeError,JSON,RegExp,Map,Set,bState:{sex:'M'}};
sb.window=sb;vm.runInNewContext(src,sb);
const {solveTwoLevelsPK,fitKelFromLevel,fitKelFromFirstDoseLevel,calcPeakTrough,calcAUC,
       calcCssAtTime,predictConc1comp,calcAUC_trap_kel}=sb;
const f=(x,d=3)=>Number.isFinite(x)?x.toFixed(d):String(x);
let pass=0,fail=0;
const ok=(n,c,d='')=>{ if(c){pass++;console.log(`  ✓ ${n}`);} else {fail++;console.log(`  ✗ ${n}  ${d}`);} };

console.log('\n=== TWO LEVELS (Sawchuk-Zaske) ===');
// Construct a patient, generate two true post-infusion levels, recover ke and Vd.
const trueKe=0.0866, trueVd=52, dose=1000, tinf=1, tau=12;   // t1/2 = 8.0 h
const trueC=(t)=>calcCssAtTime(dose,tau,tinf,trueKe,trueVd,t);
const t1=2, t2=10, c1=trueC(t1), c2=trueC(t2);
console.log(`  synthetic: ke ${f(trueKe,4)}  Vd ${trueVd} L  ->  C(${t1}h)=${f(c1,2)}  C(${t2}h)=${f(c2,2)}`);
const r2=solveTwoLevelsPK(dose,tinf,c1,t1,c2,t2,tau);
console.log('  returned:', r2 ? Object.keys(r2).join(', ') : 'NULL');
if(r2){
  console.log(`  recovered: ke ${f(r2.kel,4)}  Vd ${f(r2.vd,1)} L  t1/2 ${f(0.693/r2.kel,2)} h`);
  ok('two-level recovers ke within 1%', Math.abs(r2.kel-trueKe)/trueKe<0.01, `got ${f(r2.kel,4)} vs ${f(trueKe,4)}`);
  ok('two-level returns a finite Vd', Number.isFinite(r2.vd)&&r2.vd>0, `got ${r2.vd}`);
  ok('two-level Vd is physiologic (0.2-1.5 L/kg at 80kg)', r2.vd>16&&r2.vd<120, `got ${f(r2.vd,1)}`);
}
// non-declining pair must not silently produce nonsense
const bad=solveTwoLevelsPK(dose,tinf,10,2,14,10,tau);
ok('rising level pair rejected or flagged', !bad || !Number.isFinite(bad.kel) || bad.kel<=0, `got ${bad&&f(bad.kel,4)}`);

console.log('\n=== RANDOM LEVEL — steady state ===');
const tObs=8, cObs=trueC(tObs);
console.log(`  level ${f(cObs,2)} mg/L drawn ${tObs} h into a q${tau}h interval`);
const rl=fitKelFromLevel(cObs,tObs,dose,tau,tinf,trueVd);
if(rl){
  console.log(`  recovered ke ${f(rl.kel,4)}  CL ${f(rl.clv,2)} L/h  AUC24 ${f(rl.auc24,0)}`);
  ok('SS random level recovers ke within 2%', Math.abs(rl.kel-trueKe)/trueKe<0.02, `got ${f(rl.kel,4)}`);
  ok('AUC24 matches dose/CL within 1%', Math.abs(rl.auc24-calcAUC(dose,tau,rl.clv))/rl.auc24<0.01,
     `${f(rl.auc24,1)} vs ${f(calcAUC(dose,tau,rl.clv),1)}`);
} else { fail++; console.log('  ✗ fitKelFromLevel returned null'); }

console.log('\n=== RANDOM LEVEL — first dose ===');
const doses=[{mg:dose,tinfH:tinf,timeH:0}];
const cFirst=predictConc1comp(doses,6,trueKe,trueVd);
console.log(`  level ${f(cFirst,2)} mg/L at 6 h after a single dose`);
const kf=fitKelFromFirstDoseLevel(cFirst,6,dose,tinf,trueVd);
console.log(`  recovered ke ${f(kf,4)}`);
ok('first-dose fit recovers ke within 2%', Number.isFinite(kf)&&Math.abs(kf-trueKe)/trueKe<0.02, `got ${f(kf,4)}`);

console.log(`\n  passed ${pass}  failed ${fail}`);

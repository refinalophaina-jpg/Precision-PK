'use strict';
const fs=require('fs'),vm=require('vm');
const APP='/Users/olaiya/Projects-Local/Pharmacy/Vancomycin /AinaDaraTDM/index.html';
const src=fs.readFileSync(APP,'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
function mk(){return{value:'',textContent:'',innerHTML:'',style:{},checked:false,classList:{toggle(){},add(){},remove(){},contains(){return false}},querySelectorAll:()=>[],querySelector:()=>null,getAttribute:()=>null,setAttribute(){},addEventListener(){},appendChild(){},removeChild(){},closest:()=>null};}
const sb={document:{getElementById:()=>mk(),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>mk()},window:{},alert(){},requestAnimationFrame(){},console,Math,parseFloat,parseInt,isNaN,isFinite,NaN,Infinity,Object,Array,String,Number,Boolean,Function,Date,Error,TypeError,JSON,RegExp,Map,Set,bState:{sex:'M'}};
sb.window=sb;vm.runInNewContext(src,sb);
const {solveTwoLevelsPK,calcCssAtTime,predictConc1comp}=sb;
const f=(x,d=2)=>Number.isFinite(x)?x.toFixed(d):String(x);
const ke=0.0866, Vd=52, dose=1000, tinf=1, tau=12;

console.log('  Two-level Sawchuk-Zaske: which dosing basis does it assume?\n');
console.log('  levels drawn        C(t1)   C(t2)  | recovered ke   recovered Vd   true Vd   error');
// FIRST DOSE
const fd=[{mg:dose,tinfH:tinf,timeH:0}];
const a1=predictConc1comp(fd,2,ke,Vd), a2=predictConc1comp(fd,10,ke,Vd);
const rA=solveTwoLevelsPK(dose,tinf,a1,2,a2,10,tau);
console.log(`  after FIRST dose   ${f(a1).padStart(6)}  ${f(a2).padStart(6)}  | ${f(rA.kel,4).padStart(12)}   ${f(rA.vd,1).padStart(12)}   ${Vd}      ${f((rA.vd/Vd-1)*100,1)}%`);
// STEADY STATE
const b1=calcCssAtTime(dose,tau,tinf,ke,Vd,2), b2=calcCssAtTime(dose,tau,tinf,ke,Vd,10);
const rB=solveTwoLevelsPK(dose,tinf,b1,2,b2,10,tau,'steadystate');
console.log(`  at STEADY STATE    ${f(b1).padStart(6)}  ${f(b2).padStart(6)}  | ${f(rB.kel,4).padStart(12)}   ${f(rB.vd,1).padStart(12)}   ${Vd}      ${f((rB.vd/Vd-1)*100,1)}%`);
console.log('\n  ke is right either way — the slope between two post-infusion levels does not');
console.log('  care about accumulation. Vd does: the equation solves the SINGLE-DOSE peak,');
console.log('  so at steady state the extra drug already present is attributed to a smaller');
console.log('  volume. Downstream, AUC24 = dose/(ke x Vd) inherits the error directly:');
const aucA=dose*(24/tau)/(rA.kel*rA.vd), aucB=dose*(24/tau)/(rB.kel*rB.vd), aucT=dose*(24/tau)/(ke*Vd);
console.log(`     true AUC24 ${f(aucT,0)}   from first-dose levels ${f(aucA,0)}   from SS levels ${f(aucB,0)}  (+${f((aucB/aucT-1)*100,0)}%)`);

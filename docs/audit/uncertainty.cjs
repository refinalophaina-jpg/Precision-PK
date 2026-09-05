'use strict';
// What is the ACTUAL posterior AUC uncertainty by number of levels, under the
// verified Buelga 2005 prior? The app currently claims ~±15% at 1 level.
const fs=require('fs'), vm=require('vm');
const APP='/Users/olaiya/Projects-Local/Pharmacy/Vancomycin /AinaDaraTDM/index.html';
const script=fs.readFileSync(APP,'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
function mk(){return{value:'',textContent:'',innerHTML:'',style:{},checked:false,
 classList:{toggle(){},add(){},remove(){},contains(){return false}},querySelectorAll:()=>[],
 querySelector:()=>null,getAttribute:()=>null,setAttribute(){},addEventListener(){},appendChild(){},removeChild(){}};}
const sb={document:{getElementById:()=>mk(),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>mk()},
 window:{},alert(){},requestAnimationFrame(){},console,Math,parseFloat,parseInt,isNaN,isFinite,NaN,Infinity,
 Object,Array,String,Number,Boolean,Function,Date,Error,TypeError,JSON,RegExp,
 bState:{sex:'M',model:'buelga',dial:false,result:null,tinkCompare:[]}};
sb.window=sb; vm.runInNewContext(script,sb);
const {buelgaPopPK,burtonObjective,nelderMead2D,predictConc1comp}=sb;
const {extract}=require('/Users/olaiya/Projects-Local/Pharmacy/Vancomycin /AinaDaraTDM/harness_constants.cjs');
const C=extract();

let seed=7; const rnd=()=>{seed=(seed*1103515245+12345)&0x7fffffff;return seed/0x7fffffff;};
const randn=()=>{const u=Math.max(rnd(),1e-12);return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*rnd());};
const pct=(a,p)=>{const s=[...a].sort((x,y)=>x-y);return s[Math.min(s.length-1,Math.floor(p*s.length))];};

console.log('  Relative AUC24 error after MAP fitting — verified Buelga 2005 prior');
console.log(`  (omega2_CL ${C.OMEGA2_CL_BUELGA}, omega2_V ${C.OMEGA2_V_BUELGA}, additive sigma ${C.SIGMA_ADD_BUELGA} mg/L)\n`);
console.log('  levels    median    p80      p90      within ±15%   within ±25%   within ±30%');
for (const nLev of [0,1,2,3]) {
  seed=7; const errs=[];
  for (let i=0;i<2000;i++){
    const age=30+Math.floor(rnd()*50), tbw=50+rnd()*50, scr=0.7+rnd()*1.5;
    const crcl=Math.max(10,Math.min(140,(140-age)*tbw/(72*scr)));
    const {CL_pop,V_pop}=buelgaPopPK(crcl,tbw);
    if(!(CL_pop>0)||!(V_pop>0))continue;
    const CLt=CL_pop*Math.exp(randn()*Math.sqrt(C.OMEGA2_CL_BUELGA));
    const Vt =V_pop *Math.exp(randn()*Math.sqrt(C.OMEGA2_V_BUELGA));
    const dose=1000,tau=12,doses=[];
    for(let d=0;d<8;d++)doses.push({mg:dose,tinfH:1,timeH:d*tau});
    const levels=[];
    for(let L=0;L<nLev;L++){
      const t=8*tau-0.5-L*tau;
      const clean=predictConc1comp(doses,t,CLt/Vt,Vt);
      levels.push({timeH:t,conc:Math.max(0.5,clean+randn()*C.SIGMA_ADD_BUELGA)});
    }
    let CLfit=CL_pop;
    if(nLev>0){
      const [a]=nelderMead2D((x,y)=>burtonObjective(x,y,CL_pop,V_pop,doses,levels),0,0,300);
      CLfit=CL_pop*Math.exp(a);
    }
    if(!isFinite(CLfit)||CLfit<=0)continue;
    errs.push(Math.abs((1/CLfit-1/CLt)/(1/CLt)));
  }
  const w=(t)=>(errs.filter(e=>e<=t).length/errs.length*100).toFixed(0)+'%';
  console.log(`   ${nLev}       ${(pct(errs,0.5)*100).toFixed(1).padStart(5)}%  ${(pct(errs,0.8)*100).toFixed(1).padStart(5)}%  ${(pct(errs,0.9)*100).toFixed(1).padStart(5)}%      ${w(0.15).padStart(5)}         ${w(0.25).padStart(5)}         ${w(0.30).padStart(5)}`);
}

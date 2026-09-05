'use strict';
// Is the drop in "% improvement over population" a regression, or the mechanical
// consequence of a tighter, correct prior? Measure ABSOLUTE errors, not relative.
const fs=require('fs'), vm=require('vm'), path=require('path');
const APP='/Users/olaiya/Projects-Local/Pharmacy/Vancomycin /AinaDaraTDM/index.html';
const script=fs.readFileSync(APP,'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
function mk(){return{value:'',textContent:'',innerHTML:'',style:{},checked:false,
 classList:{toggle(){},add(){},remove(){},contains(){return false}},
 querySelectorAll:()=>[],querySelector:()=>null,getAttribute:()=>null,setAttribute(){},
 addEventListener(){},appendChild(){},removeChild(){}};}
const sb={document:{getElementById:()=>mk(),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>mk()},
 window:{},alert(){},requestAnimationFrame(){},console,Math,parseFloat,parseInt,isNaN,isFinite,NaN,Infinity,
 Object,Array,String,Number,Boolean,Function,Date,Error,TypeError,JSON,RegExp,
 bState:{sex:'M',model:'buelga',dial:false,result:null,tinkCompare:[]}};
sb.window=sb; vm.runInNewContext(script,sb);
const {buelgaPopPK,burtonObjective,nelderMead2D,predictConc1comp}=sb;

let seed=42; const rnd=()=>{seed=(seed*1103515245+12345)&0x7fffffff;return seed/0x7fffffff;};
const randn=()=>{const u=Math.max(rnd(),1e-12),v2=rnd();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v2);};

// PRIORS: retired (unidentified) vs verified Buelga 2005
const PRIORS={
  retired:{name:'retired (unsourced power model)',w2cl:0.122,w2v:0.053,
    pop:(crcl,tbw)=>({CL_pop:4.47*Math.pow(crcl/100.8,0.85)*Math.pow(tbw/76,0.13),V_pop:58.9*Math.pow(tbw/76,0.65)}),
    sprop:0.167,sadd:1.5},
  buelga :{name:'verified Buelga 2005',w2cl:0.0793,w2v:0.1380,
    pop:(crcl,tbw)=>buelgaPopPK(crcl,tbw), sprop:0, sadd:3.52},
};

function obj(etaCL,etaV,CL_pop,V_pop,doses,levels,P){
  const CL=CL_pop*Math.exp(etaCL), V=V_pop*Math.exp(etaV), kel=CL/V;
  let o=(etaCL*etaCL)/P.w2cl+(etaV*etaV)/P.w2v;
  for(const L of levels){const Cp=predictConc1comp(doses,L.timeH,kel,V);
    const SE2=Math.pow(P.sprop*Math.max(Cp,0.5),2)+P.sadd*P.sadd;
    o+=Math.pow(Cp-L.conc,2)/SE2;}
  return o;
}

function run(P,N=1500){
  seed=42; let maeBayes=0,maePop=0,n=0;
  for(let i=0;i<N;i++){
    const age=30+Math.floor(rnd()*50), tbw=50+rnd()*50, scr=0.7+rnd()*1.5;
    const crcl=Math.max(10,Math.min(140,(140-age)*tbw/(72*scr)));
    const {CL_pop,V_pop}=P.pop(crcl,tbw);
    if(!(CL_pop>0)||!(V_pop>0)) continue;
    const eCL=randn()*Math.sqrt(P.w2cl), eV=randn()*Math.sqrt(P.w2v);
    const CLt=CL_pop*Math.exp(eCL), Vt=V_pop*Math.exp(eV);
    const dose=1000,tau=12,doses=[];
    for(let d=0;d<8;d++)doses.push({mg:dose,tinfH:1,timeH:d*tau});
    const tObs=8*tau-0.5;
    const noise=P.sprop*0+ (P.sadd*randn());
    const Cobs=Math.max(0.5,predictConc1comp(doses,tObs,CLt/Vt,Vt)+noise*0.5);
    const levels=[{timeH:tObs,conc:Cobs}];
    const [a,b]=nelderMead2D((x,y)=>obj(x,y,CL_pop,V_pop,doses,levels,P),0,0,300);
    const CLb=CL_pop*Math.exp(a);
    const aucTrue=dose*(24/tau)/CLt, aucBayes=dose*(24/tau)/CLb, aucPop=dose*(24/tau)/CL_pop;
    if(!isFinite(aucBayes))continue;
    maeBayes+=Math.abs(aucBayes-aucTrue); maePop+=Math.abs(aucPop-aucTrue); n++;
  }
  return {mb:maeBayes/n, mp:maePop/n, n};
}
console.log('  AUC24 mean absolute error vs the simulated truth (n=1500, 1 trough)\n');
console.log('  prior                              pop-only MAE   Bayesian MAE   improvement');
for(const k of ['retired','buelga']){
  const P=PRIORS[k], r=run(P);
  console.log(`  ${P.name.padEnd(33)} ${r.mp.toFixed(1).padStart(8)}      ${r.mb.toFixed(1).padStart(8)}      ${((1-r.mb/r.mp)*100).toFixed(1).padStart(5)}%`);
}
console.log('\n  If BOTH absolute errors fall under the verified prior, the smaller');
console.log('  "% improvement" is the prior being better, not the fit being worse.');

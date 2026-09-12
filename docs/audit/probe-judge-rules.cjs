'use strict';
const fs=require('fs'), vm=require('vm'), path=require('path');
const { extract } = require('../../harness_constants.cjs');
const K = extract();
const html = fs.readFileSync(path.join(__dirname,'..','..','index.html'),'utf8');
const src  = html.match(/<script>([\s\S]*?)<\/script>/)[1];
function makeEl(){return {value:'',textContent:'',innerHTML:'',style:{display:''},checked:false,
  classList:{toggle(){},add(){},remove(){},contains:()=>false},querySelectorAll:()=>[],
  querySelector:()=>null,getAttribute:()=>null,setAttribute(){},addEventListener(){},appendChild(){},removeChild(){}};}
const sandbox={document:{getElementById:()=>makeEl(),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>makeEl()},
  window:{},alert(){},requestAnimationFrame(){},console,Math,parseFloat,parseInt,isNaN,isFinite,NaN,Infinity,
  Object,Array,String,Number,Boolean,Function,Date,Error,TypeError,JSON,RegExp,
  bState:{sex:'M',model:'goti',dial:false,result:null,tinkCompare:[]}};
sandbox.window=sandbox; vm.runInNewContext(src,sandbox);
const { gotiPopPK, burtonObj3D, nelderMead3D, predictConc2comp, ssCycles2comp,
        ssCtrough2comp, autoTinf, computeGuidelineDose } = sandbox;
const L=s=>console.log(s);
const AGE=34,TBW=65,SCR=1.5,CRCL=((140-AGE)*TBW)/(72*SCR);
const doses=[{mg:1750,tinfH:2,timeH:0}], levels=[{conc:18.7,timeH:16.9},{conc:12.1,timeH:24.3}];
const g=gotiPopPK(CRCL,TBW,false);
const [a,b,c]=nelderMead3D((x,y,z)=>burtonObj3D(x,y,z,g.TVCL,g.TVVc,g.TVVp,doses,levels),0,0,0,400);
const CL0=g.TVCL*Math.exp(a), Vc0=g.TVVc*Math.exp(b), Vp0=g.TVVp*Math.exp(c), Q=K.Q_GOTI;

function env2c(dose,tau,tinfH,CL,Vc,Vp,Q){
  const mean=dose*(24/tau)/CL;
  if (24%tau===0) return {min:mean,max:mean,mean,flat:true};
  const k10=CL/Vc,k12=Q/Vc,k21=Q/Vp;
  const n=ssCycles2comp(tau,k10,k12,k21), tB=(n-1)*tau;
  const syn=Array.from({length:n},(_,i)=>({mg:dose,tinfH,timeH:i*tau}));
  const N=1440,h=tau/N,cc=new Array(N+1);
  for(let j=0;j<=N;j++) cc[j]=predictConc2comp(syn,tB+j*h,k10,k12,k21,Vc);
  const phi=new Array(N+1); phi[0]=0;
  for(let j=1;j<=N;j++) phi[j]=phi[j-1]+0.5*h*(cc[j-1]+cc[j]);
  const total=phi[N], kk=(dose/CL)/total;
  const P=t=>{const cy=Math.floor(t/tau),r=t-cy*tau,x=r/h,j=Math.min(N-1,Math.floor(x)),f=x-j;
    return cy*total+phi[j]+f*(phi[j+1]-phi[j]);};
  let lo=Infinity,hi=-Infinity;
  for(let j=0;j<N;j++){const A=P(j*h+24)-P(j*h); if(A<lo)lo=A; if(A>hi)hi=A;}
  return {min:lo*kk,max:hi*kk,mean,flat:false};
}

// ---- 1. Phase structure: is terminal t1/2 the right half-life to compare tau against? ----
L('== 1. Two-compartment phase structure (case posterior, bolus coefficients) ==');
{
  const k10=CL0/Vc0,k12=Q/Vc0,k21=Q/Vp0,S=k10+k12+k21,D=Math.sqrt(S*S-4*k10*k21);
  const al=(S+D)/2, be=(S-D)/2;
  const A=(al-k21)/(Vc0*(al-be)), B=(k21-be)/(Vc0*(al-be));  // per mg
  const aucA=A/al, aucB=B/be, tot=aucA+aucB;
  L(`  alpha t1/2 ${(Math.LN2/al).toFixed(2)} h  beta t1/2 ${(Math.LN2/be).toFixed(2)} h`);
  L(`  AUC fraction in alpha phase ${(100*aucA/tot).toFixed(1)}%   beta phase ${(100*aucB/tot).toFixed(1)}%`);
  L(`  => tau/t1/2_terminal is a metric on the phase carrying ${(100*aucB/tot).toFixed(0)}% of exposure`);
  // effective (accumulation) half-life at tau=24
  for (const tau of [12,24,48]) {
    const R = (1/(1-Math.exp(-al*tau)))*0+0; // placeholder
    const accum = (aucA/(1-Math.exp(-al*tau))+aucB/(1-Math.exp(-be*tau)))/(aucA+aucB);
    const tEff = -Math.LN2*tau/Math.log(1-1/accum);
    L(`  tau ${tau}: accumulation ratio ${accum.toFixed(3)} -> effective t1/2 ${tEff.toFixed(2)} h  (tau/t_eff ${(tau/tEff).toFixed(2)})`);
  }
}

// ---- 2. Does a TDD-only rule (robustness) ever ship a Q48H with a bad real window? ----
L('\n== 2. TDD-only ranking (robustness P_hold/P_adjust) vs real 24h windows ==');
function servable(tau){ return {lo: 250*(24/tau), hi: Math.min(2000*(24/tau),4500)}; }
function Phi(z){return 0.5*(1+erf(z/Math.SQRT2));}
function erf(x){const s=x<0?-1:1;x=Math.abs(x);const t=1/(1+0.3275911*x);
  const y=1-(((((1.061405429*t-1.453152027)*t)+1.421413741)*t-0.284496736)*t+0.254829592)*t*Math.exp(-x*x);return s*y;}
function robustPick(CL,Vc,Vp,sigma,target){
  const R=Math.sqrt(600/400), lo=Math.max(400,target/R), hi=Math.min(600,target*R);
  const mu=Math.log(CL), cands=[];
  for(const tau of [8,12,24,48]) for(let d=250;d<=2000;d+=250){
    const tdd=d*(24/tau), auc=tdd/CL;
    if(d>2000||tdd>4500||auc>700) continue;
    if(auc<lo||auc>hi) continue;
    const ph=Phi((Math.log(tdd/lo)-mu)/sigma)-Phi((Math.log(tdd/hi)-mu)/sigma);
    const sv=servable(tau);
    const pa=Phi((Math.log(sv.hi/lo)-mu)/sigma)-Phi((Math.log(sv.lo/hi)-mu)/sigma);
    cands.push({tau,d,tdd,auc,ph,pa});
  }
  if(!cands.length) return null;
  const b1=Math.max(...cands.map(x=>x.ph)); let T1=cands.filter(x=>x.ph>=b1-0.05);
  const b2=Math.max(...T1.map(x=>x.pa)); let T2=T1.filter(x=>x.pa>=b2-0.05);
  // tier3 trough proxy: lower trough preferred; tier4 longest tau
  T2.sort((x,y)=> ssCtrough2comp(x.d,x.tau,autoTinf(x.d),CL,Vc,Vp,Q)-ssCtrough2comp(y.d,y.tau,autoTinf(y.d),CL,Vc,Vp,Q) || y.tau-x.tau);
  return T2[0];
}
let bad=0, worstLow=null, worstHigh=null, q48picks=0;
for(let cl=0.3; cl<=4.0; cl+=0.02){
  for(const T of [400,450,500,550,600]){
    const p=robustPick(cl,Vc0,Vp0,0.2589,T); if(!p) continue;
    const e=env2c(p.d,p.tau,autoTinf(p.d),cl,Vc0,Vp0,Q);
    if(p.tau===48) q48picks++;
    if(e.min<400-1e-9||e.max>600+1e-9){ bad++;
      if(!worstLow||e.min<worstLow.min) worstLow={cl,...p,min:e.min,max:e.max};
      if(!worstHigh||e.max>(worstHigh.max||0)) worstHigh={cl,...p,min:e.min,max:e.max}; }
  }
}
L(`  picks with a real 24h window outside 400-600: ${bad}  (Q48H picks total ${q48picks})`);
if(worstLow) L(`  worst low : CL ${worstLow.cl.toFixed(2)} ${worstLow.d} mg Q${worstLow.tau}H mean ${worstLow.auc.toFixed(0)} win ${worstLow.min.toFixed(0)}-${worstLow.max.toFixed(0)}`);
if(worstHigh) L(`  worst high: CL ${worstHigh.cl.toFixed(2)} ${worstHigh.d} mg Q${worstHigh.tau}H mean ${worstHigh.auc.toFixed(0)} win ${worstHigh.min.toFixed(0)}-${worstHigh.max.toFixed(0)}`);

// ---- 3. Envelope-gate rule across the renal spectrum: what does it offer? ----
L('\n== 3. Envelope gate over the renal spectrum (population PK, no levels, target 450) ==');
L('  CrCl  popCL   guideline  | in-band regimens (windows all 400-600)');
for(const crcl of [10,15,20,25,30,40,50,64,80,100,120]){
  const gg=gopk(crcl);
  const rows=[];
  for(const tau of [8,12,24,48]) for(let d=250;d<=2000;d+=250){
    const tdd=d*(24/tau); if(tdd>4500) continue;
    const e=env2c(d,tau,autoTinf(d),gg.CL,gg.Vc,gg.Vp,Q);
    if(e.max>700) continue;
    if(e.min>=400&&e.max<=600) rows.push(`${d}/Q${tau}`);
  }
  L(`  ${String(crcl).padStart(4)}  ${gg.CL.toFixed(2).padStart(5)}   Q${String(computeGuidelineDose(TBW,crcl).tau).padStart(2)}H      | ${rows.length?rows.join(' '):'NONE'}`);
}
function gopk(crcl){ const p=gotiPopPK(crcl,TBW,false); return {CL:p.TVCL,Vc:p.TVVc,Vp:p.TVVp}; }

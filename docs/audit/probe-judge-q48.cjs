'use strict';
const fs=require('fs'), vm=require('vm'), path=require('path');
const { extract } = require('../../harness_constants.cjs'); const K=extract();
const src = fs.readFileSync(path.join(__dirname,'..','..','index.html'),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
function makeEl(){return {value:'',textContent:'',innerHTML:'',style:{display:''},checked:false,
  classList:{toggle(){},add(){},remove(){},contains:()=>false},querySelectorAll:()=>[],querySelector:()=>null,
  getAttribute:()=>null,setAttribute(){},addEventListener(){},appendChild(){},removeChild(){}};}
const sb={document:{getElementById:()=>makeEl(),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>makeEl()},
  window:{},alert(){},requestAnimationFrame(){},console,Math,parseFloat,parseInt,isNaN,isFinite,NaN,Infinity,
  Object,Array,String,Number,Boolean,Function,Date,Error,TypeError,JSON,RegExp,
  bState:{sex:'M',model:'goti',dial:false,result:null,tinkCompare:[]}}; sb.window=sb;
vm.runInNewContext(src,sb);
const {gotiPopPK,predictConc2comp,ssCycles2comp,ssCtrough2comp,autoTinf,computeGuidelineDose,buelgaPopPK}=sb;
const L=s=>console.log(s); const TBW=65, Q=K.Q_GOTI;
function env2c(dose,tau,tinfH,CL,Vc,Vp){
  const mean=dose*(24/tau)/CL; if(24%tau===0) return {min:mean,max:mean,mean};
  const k10=CL/Vc,k12=Q/Vc,k21=Q/Vp,n=ssCycles2comp(tau,k10,k12,k21),tB=(n-1)*tau;
  const syn=Array.from({length:n},(_,i)=>({mg:dose,tinfH,timeH:i*tau}));
  const N=1440,h=tau/N,cc=new Array(N+1);
  for(let j=0;j<=N;j++) cc[j]=predictConc2comp(syn,tB+j*h,k10,k12,k21,Vc);
  const phi=new Array(N+1); phi[0]=0;
  for(let j=1;j<=N;j++) phi[j]=phi[j-1]+0.5*h*(cc[j-1]+cc[j]);
  const tot=phi[N],kk=(dose/CL)/tot;
  const P=t=>{const cy=Math.floor(t/tau),r=t-cy*tau,x=r/h,j=Math.min(N-1,Math.floor(x)),f=x-j;
    return cy*tot+phi[j]+f*(phi[j+1]-phi[j]);};
  let lo=Infinity,hi=-Infinity;
  for(let j=0;j<N;j++){const A=P(j*h+24)-P(j*h); if(A<lo)lo=A; if(A>hi)hi=A;}
  return {min:lo*kk,max:hi*kk,mean};
}
L('== Q48H at low CrCl (Goti population, TBW 65) ==');
L(' CrCl  popCL  gTau |  dose  mean   win_min - win_max   ratio  inBand?');
for(const crcl of [5,8,10,12,15,18,20,25,30]){
  const p=gotiPopPK(crcl,TBW,false);
  for(const d of [250,500,750,1000,1250]){
    const e=env2c(d,48,autoTinf(d),p.TVCL,p.TVVc,p.TVVp);
    const ib=(e.min>=400&&e.max<=600);
    if(e.mean>200&&e.mean<800)
      L(`  ${String(crcl).padStart(3)}  ${p.TVCL.toFixed(2)}  Q${String(computeGuidelineDose(TBW,crcl).tau).padStart(2)}H | ${String(d).padStart(5)} ${e.mean.toFixed(0).padStart(5)}  ${e.min.toFixed(0).padStart(6)} - ${e.max.toFixed(0).padStart(6)}  ${(e.max/e.min).toFixed(2)}  ${ib?'YES':'no'}`);
  }
}
L('\n== Refusal rate of a STRICT envelope gate (no grace) across CrCl 8-130, target 450 ==');
let none=0,tot=0,q48=0;
for(let crcl=8;crcl<=130;crcl+=1){
  const p=gotiPopPK(crcl,TBW,false); tot++;
  let any=false,anyq48=false;
  for(const tau of [8,12,24,48]) for(let d=250;d<=2000;d+=250){
    if(d*(24/tau)>4500) continue;
    const e=env2c(d,tau,autoTinf(d),p.TVCL,p.TVVc,p.TVVp);
    if(e.max>700) continue;
    if(e.min>=400&&e.max<=600){any=true; if(tau===48)anyq48=true;}
  }
  if(!any) none++; if(anyq48)q48++;
}
L(`  CrCl values with NO in-band regimen: ${none}/${tot};  with a Q48H option: ${q48}/${tot}`);
L('\n== Buelga (1-comp) path, same patient, envelope at Q48H ==');
{
  const bp=buelgaPopPK(63.8,TBW); L(`  popCL ${bp.CL_pop.toFixed(2)} V ${bp.V_pop.toFixed(1)}`);
  const CL=2.69, V=55.4, kel=CL/V;
  for(const d of [1500,1750,2000]){
    const tinf=autoTinf(d),R0=d/tinf,den=1-Math.exp(-kel*48);
    const Cpi=(R0/(kel*V))*(1-Math.exp(-kel*tinf));
    const Ctr=Cpi*Math.exp(-kel*(48-tinf))/den, Cpk=Cpi/den;
    const N=4800,h=48/N; let phi=[0];
    for(let j=1;j<=N;j++){const t0=(j-1)*h,t1=j*h;
      const f=t=>t<=tinf? Ctr*Math.exp(-kel*t)+(R0/(kel*V))*(1-Math.exp(-kel*t)) : Cpk*Math.exp(-kel*(t-tinf));
      phi.push(phi[j-1]+0.5*h*(f(t0)+f(t1)));}
    const tot=phi[N],kk=(d/CL)/tot;
    const P=t=>{const cy=Math.floor(t/48),r=t-cy*48,x=r/h,j=Math.min(N-1,Math.floor(x)),ff=x-j;
      return cy*tot+phi[j]+ff*(phi[j+1]-phi[j]);};
    let lo=Infinity,hi=-Infinity;
    for(let j=0;j<N;j++){const A=P(j*h+24)-P(j*h); if(A<lo)lo=A; if(A>hi)hi=A;}
    L(`  ${d} mg Q48H  mean ${(d*0.5/CL).toFixed(0)}  win ${(lo*kk).toFixed(0)} - ${(hi*kk).toFixed(0)}  ratio ${(hi/lo).toFixed(2)}`);
  }
}

L('\n== Residual lattice bias INSIDE the in-band pool (minimal stage 4a) ==');
for(const crcl of [8,10,12,14,15]){
  const p=gotiPopPK(crcl,TBW,false);
  for(const T of [450,500,550]){
    const pool=[];
    for(const tau of [8,12,24,48]){
      let best=null;
      for(let d=250;d<=2000;d+=250){ if(d*(24/tau)>4500) continue;
        const e=env2c(d,tau,autoTinf(d),p.TVCL,p.TVVc,p.TVVp);
        if(e.max>700) continue;
        if(e.min>=400&&e.max<=600){ const dd=Math.abs(e.mean-T); if(!best||dd<best.dd) best={tau,d,mean:e.mean,dd,min:e.min,max:e.max}; } }
      if(best) pool.push(best);
    }
    if(!pool.length){ L(`  CrCl ${crcl} T${T}: none`); continue; }
    pool.sort((x,y)=>x.dd-y.dd);
    L(`  CrCl ${String(crcl).padStart(3)} T${T}: winner ${pool[0].d} mg Q${pool[0].tau}H (mean ${pool[0].mean.toFixed(0)}, win ${pool[0].min.toFixed(0)}-${pool[0].max.toFixed(0)}) | pool ${pool.map(x=>`Q${x.tau}:${x.mean.toFixed(0)}`).join(' ')}`);
  }
}

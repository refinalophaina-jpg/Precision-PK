'use strict';
// JUDGE PROBE — verifies the numeric claims made by the four interval-ranking designs
// against the SHIPPED engine. Constants parsed via harness_constants.cjs.
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
const { gotiPopPK, burtonObj3D, nelderMead3D, buelgaPopPK, burtonObjective, nelderMead2D,
        bayesDoseOptimizer, predictConc2comp, ssCycles2comp, ssCtrough2comp, autoTinf,
        calcIBW, computeGuidelineDose, aucUncertaintyFrac } = sandbox;
const L=s=>console.log(s);
const AGE=34,SEX='M',TBW=65,HT=167.6,SCR=1.5;
const doses=[{mg:1750,tinfH:2,timeH:0}], levels=[{conc:18.7,timeH:16.9},{conc:12.1,timeH:24.3}];
const CRCL=((140-AGE)*TBW)/(72*SCR);
const g=gotiPopPK(CRCL,TBW,false);
const [a,b,c]=nelderMead3D((x,y,z)=>burtonObj3D(x,y,z,g.TVCL,g.TVVc,g.TVVp,doses,levels),0,0,0,400);
const CL=g.TVCL*Math.exp(a), Vc=g.TVVc*Math.exp(b), Vp=g.TVVp*Math.exp(c), Q=K.Q_GOTI;
const k10=CL/Vc,k12=Q/Vc,k21=Q/Vp,S=k10+k12+k21,beta=0.5*(S-Math.sqrt(S*S-4*k10*k21));
L(`CrCl ${CRCL.toFixed(2)}  Goti posterior CL ${CL.toFixed(4)} Vc ${Vc.toFixed(3)} Vp ${Vp.toFixed(3)}  t1/2term ${(Math.LN2/beta).toFixed(2)} h`);
L(`guideline tau at this CrCl: Q${computeGuidelineDose(TBW,CRCL).tau}H ; aucUncertaintyFrac(2,goti)=${aucUncertaintyFrac(2,'goti')}`);

// rolling 24h envelope, 2-comp, renormalised to analytic dose/CL
function env2c(dose,tau,tinfH,CL,Vc,Vp,Q){
  const mean=dose*(24/tau)/CL;
  if (24%tau===0) return {min:mean,max:mean,mean,flat:true,raw:mean};
  const k10=CL/Vc,k12=Q/Vc,k21=Q/Vp;
  const n=ssCycles2comp(tau,k10,k12,k21), tB=(n-1)*tau;
  const syn=Array.from({length:n},(_,i)=>({mg:dose,tinfH,timeH:i*tau}));
  const N=2880,h=tau/N,cc=new Array(N+1);
  for(let j=0;j<=N;j++) cc[j]=predictConc2comp(syn,tB+j*h,k10,k12,k21,Vc);
  const phi=new Array(N+1); phi[0]=0;
  for(let j=1;j<=N;j++) phi[j]=phi[j-1]+0.5*h*(cc[j-1]+cc[j]);
  const total=phi[N], kk=(dose/CL)/total;
  const P=t=>{const cy=Math.floor(t/tau),r=t-cy*tau,x=r/h,j=Math.min(N-1,Math.floor(x)),f=x-j;
    return cy*total+phi[j]+f*(phi[j+1]-phi[j]);};
  let lo=Infinity,hi=-Infinity;
  for(let j=0;j<N;j++){const A=P(j*h+24)-P(j*h); if(A<lo)lo=A; if(A>hi)hi=A;}
  return {min:lo*kk,max:hi*kk,mean,flat:false,raw:total*(24/tau)};
}
L('\n== A. Envelope for the case (Goti posterior) ==');
for (const [d,t] of [[250,8],[500,8],[500,12],[750,12],[1000,24],[1250,24],[1500,48],[1750,48],[2000,48]]) {
  const e=env2c(d,t,autoTinf(d),CL,Vc,Vp,Q);
  L(`  ${String(d).padStart(4)} mg Q${String(t).padStart(2)}H  mean ${e.mean.toFixed(1).padStart(6)}  win ${e.min.toFixed(1).padStart(6)} - ${e.max.toFixed(1).padStart(6)}  ${e.flat?'(flat)':'ratio '+(e.max/e.min).toFixed(2)}  trough ${ssCtrough2comp(d,t,autoTinf(d),CL,Vc,Vp,Q).toFixed(1)}`);
}
L('\n== B. Shipped optimizer across targets ==');
for(const T of [400,425,450,475,500,525,550,575,600]){
  const r=bayesDoseOptimizer(CL,Vc,T,{Vc,Vp,Q},1);
  L(`  target ${T}: ${r.dose} mg Q${r.tau}H  auc24 ${r.auc24.toFixed(1)}`);
}
L('\n== C. Hard-tier hole claim (transparent D-A): sweep CL for Q48H mean<=700 but wMax>700 ==');
let worst=null, nHole=0;
for(let cl=0.30; cl<=5.0; cl+=0.05){
  for(let d=250; d<=2000; d+=250){
    const e=env2c(d,48,autoTinf(d),cl,Vc*(cl/CL>0?1:1),Vp,Q); // keep V fixed as case V
    if(e.mean<=700 && e.max>700){ nHole++; if(!worst||e.max>worst.max) worst={cl,d,mean:e.mean,max:e.max,min:e.min}; }
  }
}
L(`  cells where mean<=700 but a real 24h window >700: ${nHole}; worst ${worst? `CL ${worst.cl.toFixed(2)} ${worst.d} mg Q48H mean ${worst.mean.toFixed(0)} win ${worst.min.toFixed(0)}-${worst.max.toFixed(0)}`:'none'}`);
L('\n== D. Q48H band-reachability vs CL (all windows inside 400-600) ==');
let lo=null,hi=null;
for(let cl=0.10; cl<=3.0; cl+=0.01){
  let ok=false;
  for(let d=250; d<=2000; d+=250){ const e=env2c(d,48,autoTinf(d),cl,Vc,Vp,Q);
    if(e.min>=400&&e.max<=600&&d*(24/48)<=4500){ok=true;break;} }
  if(ok){ if(lo===null)lo=cl; hi=cl; }
}
L(`  Q48H reachable for CL in [${lo?lo.toFixed(2):'-'}, ${hi?hi.toFixed(2):'-'}] L/h (case V). Patient CL ${CL.toFixed(2)}`);
L('\n== E. per-interval band-reachable doses at the case posterior ==');
for(const t of [8,12,24,48]){
  const ok=[];
  for(let d=250; d<=2000; d+=250){ const e=env2c(d,t,autoTinf(d),CL,Vc,Vp,Q);
    if(e.min>=400&&e.max<=600&&d*(24/t)<=4500&&e.max<=700) ok.push(`${d}(${e.mean.toFixed(0)})`); }
  L(`  Q${t}H: ${ok.length?ok.join(' '):'NONE'}`);
}

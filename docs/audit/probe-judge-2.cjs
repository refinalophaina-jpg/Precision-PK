'use strict';
const fs=require('fs'), vm=require('vm'), path=require('path');
const { extract }=require('./../../harness_constants.cjs'); const K=extract();
const html=fs.readFileSync(path.join(__dirname,'..','..','index.html'),'utf8');
const src=html.match(/<script>([\s\S]*?)<\/script>/)[1];
function makeEl(){return{value:'',textContent:'',innerHTML:'',style:{display:''},checked:false,
 classList:{toggle(){},add(){},remove(){},contains:()=>false},querySelectorAll:()=>[],
 querySelector:()=>null,getAttribute:()=>null,setAttribute(){},addEventListener(){},appendChild(){},removeChild(){}};}
const sb={document:{getElementById:()=>makeEl(),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>makeEl()},
 window:{},alert(){},requestAnimationFrame(){},console,Math,parseFloat,parseInt,isNaN,isFinite,NaN,Infinity,
 Object,Array,String,Number,Boolean,Function,Date,Error,TypeError,JSON,RegExp,
 bState:{sex:'M',model:'goti',dial:false,result:null,tinkCompare:[]}};
sb.window=sb; vm.runInNewContext(src,sb);
const {gotiPopPK,predictConc2comp,ssCycles2comp,ssCtrough2comp,autoTinf,bayesDoseOptimizer,computeGuidelineDose}=sb;
const L=s=>console.log(s), R=t=>L(`\n${'='.repeat(74)}\n  ${t}\n${'-'.repeat(74)}`);
function env(dose,tau,tinfH,pk){
  const mean=dose*(24/tau)/pk.CL; if(24%tau===0) return {min:mean,max:mean,mean};
  const N=1024,h=tau/N,cc=new Array(N+1);
  const k10=pk.CL/pk.Vc,k12=pk.Q/pk.Vc,k21=pk.Q/pk.Vp;
  const n=ssCycles2comp(tau,k10,k12,k21),tB=(n-1)*tau;
  const syn=Array.from({length:n},(_,i)=>({mg:dose,tinfH,timeH:i*tau}));
  for(let j=0;j<=N;j++) cc[j]=predictConc2comp(syn,tB+j*h,k10,k12,k21,pk.Vc);
  const phi=[0]; for(let j=1;j<=N;j++) phi[j]=phi[j-1]+0.5*h*(cc[j-1]+cc[j]);
  const tot=phi[N],k=(dose/pk.CL)/tot;
  const P=t=>{const cy=Math.floor(t/tau),r=t-cy*tau,x=r/h,j=Math.min(N-1,Math.floor(x)),f=x-j;
    return cy*tot+phi[j]+f*(phi[j+1]-phi[j]);};
  let lo=Infinity,hi=-Infinity;
  for(let j=0;j<N;j++){const A=P(j*h+24)-P(j*h); if(A<lo)lo=A; if(A>hi)hi=A;}
  return {min:lo*k,max:hi*k,mean};}
function thalf(pk){const k10=pk.CL/pk.Vc,k12=pk.Q/pk.Vc,k21=pk.Q/pk.Vp,s=k10+k12+k21;
  return Math.LN2/((s-Math.sqrt(Math.max(0,s*s-4*k21*k10)))/2);}

R('A. Goti POPULATION pk across CrCl (65 kg, 34 M) — is Q48H ever band-reachable?');
for(const crcl of [5,8,10,12,15,18,20,25,30,40]){
 const g=gotiPopPK(crcl,65,false); const pk={CL:g.TVCL,Vc:g.TVVc,Vp:g.TVVp,Q:K.Q_GOTI};
 const ok=[]; for(let d=250;d<=2000;d+=250){const e=env(d,48,autoTinf(d),pk);
   if(e.min>=400&&e.max<=600) ok.push(`${d}(${e.min.toFixed(0)}-${e.max.toFixed(0)})`);}
 L(`  CrCl ${String(crcl).padStart(3)}  CL ${g.TVCL.toFixed(2)} Vc ${g.TVVc.toFixed(1)} Vp ${g.TVVp.toFixed(1)} t1/2 ${thalf(pk).toFixed(0)}h  Q48H in-band: ${ok.join(' ')||'NONE'}`);}

R('B. does ANY interval reach the band? (strict gate) — refusal rate across CrCl');
for(const crcl of [5,8,10,15,20,30,45,64,90,120,150]){
 const g=gotiPopPK(crcl,65,false); const pk={CL:g.TVCL,Vc:g.TVVc,Vp:g.TVVp,Q:K.Q_GOTI};
 const hits=[]; for(const tau of [8,12,24,48]) for(let d=250;d<=2000;d+=250){
   if(d*(24/tau)>4500) continue; const e=env(d,tau,autoTinf(d),pk);
   if(e.min>=400&&e.max<=600) hits.push(`${d}/Q${tau}`);}
 L(`  CrCl ${String(crcl).padStart(3)} CL ${g.TVCL.toFixed(2)}: ${hits.join('  ')||'*** NO REGIMEN REACHES THE BAND ***'}`);}

R('C. fixed patient V, vary CL only (what `minimal` and `composite` swept)');
for(const CL of [0.3,0.4,0.5,0.7,1.0,1.2,1.5,2.0]){
 const pk={CL,Vc:39.077,Vp:28.478,Q:K.Q_GOTI};
 const ok=[]; for(let d=250;d<=2000;d+=250){const e=env(d,48,autoTinf(d),pk);
   if(e.min>=400&&e.max<=600) ok.push(`${d}(${e.min.toFixed(0)}-${e.max.toFixed(0)})`);}
 L(`  CL ${CL.toFixed(2)} t1/2 ${thalf(pk).toFixed(0)}h  Q48H: ${ok.join(' ')||'NONE'}`);}

R('D. how OFTEN does the shipped rule currently pick Q48H, and how bad is it?');
{let n=0,q48=0,bad=0,worst=null,ceil=0;
 for(let crcl=8;crcl<=120;crcl+=2) for(let t=400;t<=600;t+=10){
  const g=gotiPopPK(crcl,65,false);
  const r=bayesDoseOptimizer(g.TVCL,g.TVVc,t,{Vc:g.TVVc,Vp:g.TVVp,Q:K.Q_GOTI},1);
  if(r.noSolution) continue; n++;
  const pk={CL:g.TVCL,Vc:g.TVVc,Vp:g.TVVp,Q:K.Q_GOTI};
  const e=env(r.dose,r.tau,r.tinfH,pk);
  if(r.tau===48){q48++;
   if(e.min<400||e.max>600){bad++; const d=Math.max(400-e.min,e.max-600);
     if(!worst||d>worst.d) worst={d,crcl,t,dose:r.dose,tau:r.tau,mean:e.mean,mn:e.min,mx:e.max};}
   if(e.max>700) ceil++;}
 }
 L(`  shipped winners ${n};  Q48H winners ${q48} (${(100*q48/n).toFixed(1)}%);  of those, out-of-band window ${bad} (${(100*bad/Math.max(1,q48)).toFixed(0)}%);  real window >700: ${ceil}`);
 if(worst) L(`  worst: CrCl ${worst.crcl}, target ${worst.t} -> ${worst.dose} mg Q${worst.tau}H, shown ${worst.mean.toFixed(0)}, real ${worst.mn.toFixed(0)}-${worst.mx.toFixed(0)}`);}

R('E. the two live candidates at the index patient — trough / peak / tau vs t1/2');
{const pk={CL:2.0578,Vc:39.077,Vp:28.478,Q:K.Q_GOTI}; const th=thalf(pk);
 for(const [d,tau] of [[500,12],[1000,24]]){
  const tr=ssCtrough2comp(d,tau,autoTinf(d),pk.CL,pk.Vc,pk.Vp,pk.Q);
  L(`  ${d} mg Q${tau}H  trough ${tr.toFixed(1)} (WARN ${K.TROUGH_WARN_MGL??15}/HIGH ${K.TROUGH_HIGH_MGL??20})  tau/t1/2 ${(tau/th).toFixed(2)}  doses to SS ${(5*th/tau).toFixed(1)}`);}
 L(`  terminal t1/2 ${th.toFixed(1)} h; CrCl 63.8 -> conventional ladder says Q${computeGuidelineDose(65,63.8).tau}H`);}

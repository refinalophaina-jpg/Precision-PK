'use strict';
const fs=require('fs'),vm=require('vm'),path=require('path');
const {extract}=require('./../../harness_constants.cjs');const K=extract();
const src=fs.readFileSync(path.join(__dirname,'..','..','index.html'),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
function el(){return{value:'',textContent:'',innerHTML:'',style:{display:''},checked:false,
 classList:{toggle(){},add(){},remove(){},contains:()=>false},querySelectorAll:()=>[],querySelector:()=>null,
 getAttribute:()=>null,setAttribute(){},addEventListener(){},appendChild(){},removeChild(){}};}
const sb={document:{getElementById:()=>el(),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>el()},
 window:{},alert(){},requestAnimationFrame(){},console,Math,parseFloat,parseInt,isNaN,isFinite,NaN,Infinity,
 Object,Array,String,Number,Boolean,Function,Date,Error,TypeError,JSON,RegExp,
 bState:{sex:'M',model:'goti',dial:false,result:null,tinkCompare:[]}};
sb.window=sb;vm.runInNewContext(src,sb);
const {gotiPopPK,predictConc2comp,ssCycles2comp,ssCtrough2comp,autoTinf,computeGuidelineDose}=sb;
const L=s=>console.log(s),R=t=>L(`\n${'='.repeat(74)}\n  ${t}\n${'-'.repeat(74)}`);
const cache=new Map();
function env(d,tau,ti,pk){const key=`${d}|${tau}|${pk.CL.toFixed(5)}|${pk.Vc}`;if(cache.has(key))return cache.get(key);
 const mean=d*(24/tau)/pk.CL; let r;
 if(24%tau===0) r={min:mean,max:mean,mean};
 else{const N=512,h=tau/N,cc=new Array(N+1),k10=pk.CL/pk.Vc,k12=pk.Q/pk.Vc,k21=pk.Q/pk.Vp;
  const n=ssCycles2comp(tau,k10,k12,k21),tB=(n-1)*tau;
  const syn=Array.from({length:n},(_,i)=>({mg:d,tinfH:ti,timeH:i*tau}));
  for(let j=0;j<=N;j++)cc[j]=predictConc2comp(syn,tB+j*h,k10,k12,k21,pk.Vc);
  const phi=[0];for(let j=1;j<=N;j++)phi[j]=phi[j-1]+0.5*h*(cc[j-1]+cc[j]);
  const tot=phi[N],kk=(d/pk.CL)/tot;
  const P=t=>{const cy=Math.floor(t/tau),rr=t-cy*tau,x=rr/h,j=Math.min(N-1,Math.floor(x)),f=x-j;
   return cy*tot+phi[j]+f*(phi[j+1]-phi[j]);};
  let lo=Infinity,hi=-Infinity;for(let j=0;j<N;j++){const A=P(j*h+24)-P(j*h);if(A<lo)lo=A;if(A>hi)hi=A;}
  r={min:lo*kk,max:hi*kk,mean};}
 cache.set(key,r);return r;}
function inband(pk,strict){const out=[];
 for(const tau of [8,12,24,48])for(let d=250;d<=2000;d+=250){
  if(d*(24/tau)>4500)continue;const e=env(d,tau,autoTinf(d),pk);
  if(e.max>700)continue;
  const gu=strict?0:Math.min((250*(24/tau)/pk.CL)/2,100);
  if(e.min>=400&&e.max<=600+gu)out.push({d,tau,...e});}
 return out;}

R('F. STABILITY OF THE OFFER SET vs CrCl (strict gate) — the new sensitivity');
{let prev=null,flips=0,none=0,tot=0;
 for(let crcl=6;crcl<=120;crcl+=1){const g=gotiPopPK(crcl,65,false);
  const pk={CL:g.TVCL,Vc:g.TVVc,Vp:g.TVVp,Q:K.Q_GOTI};
  const s=inband(pk,true);tot++;if(!s.length)none++;
  const taus=[...new Set(s.map(x=>x.tau))].sort((a,b)=>a-b).join(',');
  if(prev!==null&&taus!==prev)flips++;
  if(crcl<=30||crcl%20===0) L(`  CrCl ${String(crcl).padStart(3)} CL ${g.TVCL.toFixed(2)}  intervals offered: [${taus||'NONE'}]`);
  prev=taus;}
 L(`  -> offer-set changes across CrCl 6-120 in 1 mL/min steps: ${flips}; CrCl values with NO in-band regimen: ${none}/${tot}`);}

R('G. REFUSAL RATE: strict gate vs graced gate, over (CrCl x target)');
{let tot=0,nsS=0,nsG=0;
 for(let crcl=6;crcl<=130;crcl+=2){const g=gotiPopPK(crcl,65,false);
  const pk={CL:g.TVCL,Vc:g.TVVc,Vp:g.TVVp,Q:K.Q_GOTI};
  const S=inband(pk,true),G=inband(pk,false);
  tot++;if(!S.length)nsS++;if(!G.length)nsG++;}
 L(`  CrCl values 6-130: strict gate empty in ${nsS}/${tot} (${(100*nsS/tot).toFixed(0)}%); with high-side grace ${nsG}/${tot} (${(100*nsG/tot).toFixed(0)}%)`);}

R('H. FOUR DESIGNS, SAME PATIENT SET — do the tiebreaks disagree in practice?');
function thalf(pk){const k10=pk.CL/pk.Vc,k12=pk.Q/pk.Vc,k21=pk.Q/pk.Vp,s=k10+k12+k21;
 return Math.LN2/((s-Math.sqrt(Math.max(0,s*s-4*k21*k10)))/2);}
function pickMinimal(s,crcl,target){ // nearest-target in band per tau, then |ln tau - ln tauConv|, then shorter
 const per=new Map();
 for(const x of s){const cur=per.get(x.tau);
  if(!cur||Math.abs(x.mean-target)<Math.abs(cur.mean-target))per.set(x.tau,x);}
 const tc=computeGuidelineDose(65,crcl).tau;
 return [...per.values()].sort((p,q)=>Math.abs(p.mean-target)-Math.abs(q.mean-target)
  ||Math.abs(Math.log(p.tau)-Math.log(tc))-Math.abs(Math.log(q.tau)-Math.log(tc))||p.tau-q.tau)[0];}
function pickComposite(s,pk,target){ // dominant term: |ln(tau/t12)| after exposure
 const th=thalf(pk);const per=new Map();
 for(const x of s){const cur=per.get(x.tau);
  if(!cur||Math.abs(x.mean-target)<Math.abs(cur.mean-target))per.set(x.tau,x);}
 return [...per.values()].map(x=>({...x,
   PE:(Math.max(Math.abs(x.min-target),Math.abs(x.max-target)))/100,
   PI:Math.abs(Math.log((x.tau/th)/1))/Math.log(4), PO:(24/x.tau)/3}))
  .sort((p,q)=>(0.35*p.PE+0.22*p.PI+0.08*p.PO)-(0.35*q.PE+0.22*q.PI+0.08*q.PO))[0];}
function pickRobust(s,pk){ // tier2 P_adjust (headroom), tier3 trough
 const per=new Map();
 for(const x of s){const cur=per.get(x.tau);
  if(!cur||Math.abs(x.mean-489.9)<Math.abs(cur.mean-489.9))per.set(x.tau,x);}
 return [...per.values()].map(x=>{const tmax=Math.min(2000*24/x.tau,4500),tmin=250*24/x.tau;
   const head=Math.min(tmax/400/(pk.CL)/1,99)*0+Math.log((tmax/400)/(tmin/600));
   const tr=ssCtrough2comp(x.d,x.tau,autoTinf(x.d),pk.CL,pk.Vc,pk.Vp,pk.Q);
   return {...x,head,tr};}).sort((p,q)=>q.head-p.head||p.tr-q.tr)[0];}
{let dis=0,n=0;const rows=[];
 for(let crcl=15;crcl<=120;crcl+=5)for(const t of [400,450,500,550,600]){
  const g=gotiPopPK(crcl,65,false);const pk={CL:g.TVCL,Vc:g.TVVc,Vp:g.TVVp,Q:K.Q_GOTI};
  const s=inband(pk,true);if(!s.length)continue;n++;
  const m=pickMinimal(s,crcl,t),c=pickComposite(s,pk,t),r=pickRobust(s,pk);
  const taus=new Set([m.tau,c.tau,r.tau]);
  const front=[...new Set(s.map(x=>x.tau))];
  if(taus.size>1){dis++;if(rows.length<8)rows.push(`  CrCl ${crcl} tgt ${t}: minimal Q${m.tau} | composite Q${c.tau} | robust Q${r.tau} | transparent front [${front.join(',')}]`);}}
 rows.forEach(L);
 L(`  -> the three single-answer designs disagree with each other in ${dis}/${n} cases (${(100*dis/n).toFixed(0)}%)`);}

R('I. does the CAPPED HIGH-SIDE GRACE stabilise the offer set? (strict vs graced)');
{for(const strict of [true,false]){let prev=null,flips=0,none=0;
 for(let crcl=6;crcl<=120;crcl+=1){const g=gotiPopPK(crcl,65,false);
  const pk={CL:g.TVCL,Vc:g.TVVc,Vp:g.TVVp,Q:K.Q_GOTI};
  const s=inband(pk,strict);if(!s.length)none++;
  const taus=[...new Set(s.map(x=>x.tau))].sort((a,b)=>a-b).join(',');
  if(prev!==null&&taus!==prev)flips++;prev=taus;}
 L(`  ${strict?'strict     ':'graced(cap)'} : offer-set changes ${flips}, empty at ${none} CrCl values`);}
 L('  region detail, graced:');
 for(let crcl=8;crcl<=30;crcl+=2){const g=gotiPopPK(crcl,65,false);
  const pk={CL:g.TVCL,Vc:g.TVVc,Vp:g.TVVp,Q:K.Q_GOTI};
  const s=inband(pk,false);
  L(`    CrCl ${String(crcl).padStart(3)}  [${[...new Set(s.map(x=>x.tau))].sort((a,b)=>a-b).join(',')||'NONE'}]`);}}

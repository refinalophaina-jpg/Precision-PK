'use strict';
// PROBE — adjudicate the four interval-ranking designs against the SHIPPED engine.
// Constants parsed by harness_constants.cjs (rule 6). No hand-copied model numbers.
const fs=require('fs'), vm=require('vm'), path=require('path');
const { extract } = require('./../../harness_constants.cjs');
const K = extract();
const html = fs.readFileSync(path.join(__dirname,'..','..','index.html'),'utf8');
const src  = html.match(/<script>([\s\S]*?)<\/script>/)[1];
function makeEl(){return{value:'',textContent:'',innerHTML:'',style:{display:''},checked:false,
 classList:{toggle(){},add(){},remove(){},contains:()=>false},querySelectorAll:()=>[],
 querySelector:()=>null,getAttribute:()=>null,setAttribute(){},addEventListener(){},appendChild(){},removeChild(){}};}
const sandbox={document:{getElementById:()=>makeEl(),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>makeEl()},
 window:{},alert(){},requestAnimationFrame(){},console,Math,parseFloat,parseInt,isNaN,isFinite,NaN,Infinity,
 Object,Array,String,Number,Boolean,Function,Date,Error,TypeError,JSON,RegExp,
 bState:{sex:'M',model:'goti',dial:false,result:null,tinkCompare:[]}};
sandbox.window=sandbox; vm.runInNewContext(src,sandbox);
const { gotiPopPK,burtonObj3D,nelderMead3D,buelgaPopPK,burtonObjective,nelderMead2D,
        bayesDoseOptimizer,ssCtrough2comp,predictConc2comp,ssCycles2comp,
        calcIBW,autoTinf,computeGuidelineDose } = sandbox;
const L=s=>console.log(s), R=t=>L(`\n${'='.repeat(74)}\n  ${t}\n${'-'.repeat(74)}`);

// ── the case ─────────────────────────────────────────────────────────
const AGE=34,SEX='M',TBW=65,HT=167.6,SCR=1.5;
const doses=[{mg:1750,tinfH:2,timeH:0}], levels=[{conc:18.7,timeH:16.9},{conc:12.1,timeH:24.3}];
const CRCL=((140-AGE)*TBW)/(72*SCR);
const g=gotiPopPK(CRCL,TBW,false);
const [a,b,c]=nelderMead3D((x,y,z)=>burtonObj3D(x,y,z,g.TVCL,g.TVVc,g.TVVp,doses,levels),0,0,0,400);
const PK={CL:g.TVCL*Math.exp(a),Vc:g.TVVc*Math.exp(b),Vp:g.TVVp*Math.exp(c),Q:K.Q_GOTI,two:true};
const bp=buelgaPopPK(CRCL,TBW);
const [eb1,eb2]=nelderMead2D((x,y)=>burtonObjective(x,y,bp.CL_pop,bp.V_pop,doses,levels),0,0,300);
const PKB={CL:bp.CL_pop*Math.exp(eb1),V:bp.V_pop*Math.exp(eb2),two:false};
R('0. posteriors');
L(`  CrCl ${CRCL.toFixed(1)}  Goti CL ${PK.CL.toFixed(4)} Vc ${PK.Vc.toFixed(3)} Vp ${PK.Vp.toFixed(3)}`);
{const k10=PK.CL/PK.Vc,k12=PK.Q/PK.Vc,k21=PK.Q/PK.Vp,s=k10+k12+k21,
 beta=(s-Math.sqrt(Math.max(0,s*s-4*k21*k10)))/2;
 L(`  terminal t1/2 ${(Math.LN2/beta).toFixed(2)} h`);}
L(`  Buelga CL ${PKB.CL.toFixed(4)} V ${PKB.V.toFixed(2)}  t1/2 ${(0.693/(PKB.CL/PKB.V)).toFixed(2)} h`);

// ── rolling 24 h envelope (the common primitive all 4 designs propose) ──
function envelope(dose,tau,tinfH,pk){
  const mean=dose*(24/tau)/pk.CL;
  if (24%tau===0) return {min:mean,max:mean,mean,flat:true};
  const N=2048,h=tau/N,cc=new Array(N+1);
  if(pk.two){
    const k10=pk.CL/pk.Vc,k12=pk.Q/pk.Vc,k21=pk.Q/pk.Vp;
    const n=ssCycles2comp(tau,k10,k12,k21), tB=(n-1)*tau;
    const syn=Array.from({length:n},(_,i)=>({mg:dose,tinfH,timeH:i*tau}));
    for(let j=0;j<=N;j++) cc[j]=predictConc2comp(syn,tB+j*h,k10,k12,k21,pk.Vc);
  } else {
    const kel=pk.CL/pk.V,R0=dose/tinfH,den=1-Math.exp(-kel*tau);
    if(den<1e-10) return null;
    const Cpi=(R0/(kel*pk.V))*(1-Math.exp(-kel*tinfH));
    const Ctr=Cpi*Math.exp(-kel*(tau-tinfH))/den, Cpk=Cpi/den;
    for(let j=0;j<=N;j++){const t=j*h;
      cc[j]= t<=tinfH ? Ctr*Math.exp(-kel*t)+(R0/(kel*pk.V))*(1-Math.exp(-kel*t))
                      : Cpk*Math.exp(-kel*(t-tinfH));}
  }
  const phi=new Array(N+1); phi[0]=0;
  for(let j=1;j<=N;j++) phi[j]=phi[j-1]+0.5*h*(cc[j-1]+cc[j]);
  const total=phi[N], k=(dose/pk.CL)/total;
  const P=t=>{const cy=Math.floor(t/tau),r=t-cy*tau,x=r/h,j=Math.min(N-1,Math.floor(x)),f=x-j;
              return cy*total+phi[j]+f*(phi[j+1]-phi[j]);};
  let lo=Infinity,hi=-Infinity;
  for(let j=0;j<N;j++){const A=P(j*h+24)-P(j*h); if(A<lo)lo=A; if(A>hi)hi=A;}
  return {min:lo*k,max:hi*k,mean,flat:false,rawErr:Math.abs(total/(dose/PK.CL)-1)};
}

R('1. the Q48H claim, and integrator honesty');
{const e=envelope(1750,48,autoTinf(1750),PK);
 L(`  1750 mg Q48H  mean ${e.mean.toFixed(1)}  windows ${e.min.toFixed(1)} - ${e.max.toFixed(1)}  ratio ${(e.max/e.min).toFixed(3)}`);
 L(`  (min+max)/2 = ${((e.min+e.max)/2).toFixed(4)}   mean = ${e.mean.toFixed(4)}   raw cycle-AUC err ${(e.rawErr*100).toFixed(4)}%`);}
for(const [d,t] of [[250,8],[500,12],[1000,24],[1250,24]]){
  const e=envelope(d,t,autoTinf(d),PK);
  L(`  ${d} mg Q${t}H flat=${e.flat} mean ${e.mean.toFixed(3)} min ${e.min.toFixed(3)} max ${e.max.toFixed(3)}`);}

R('2. band-reachable lattice at this posterior (every 24h window in 400-600)');
const MIN=K.AUC24_TARGET_MIN??400, MAX=K.AUC24_TARGET_MAX??600, ABS=K.AUC24_ABSOLUTE_MAX??700;
function reach(pk){const out={};
 for(const tau of [8,12,24,48]){const ok=[];
  for(let d=250;d<=2000;d+=250){ if(d*(24/tau)>4500) continue;
   const e=envelope(d,tau,autoTinf(d),pk); if(!e) continue;
   if(e.min>=400&&e.max<=600) ok.push(d);}
  out[tau]=ok;} return out;}
L('  Goti:   '+JSON.stringify(reach(PK)));
L('  Buelga: '+JSON.stringify(reach(PKB)));

R('3. THE HARD-TIER HOLE — mean <= 700 but a real 24h window > 700');
{let worst=null;
 for(let CL=0.5;CL<=4.0;CL+=0.01){
  const pk={CL,Vc:PK.Vc,Vp:PK.Vp,Q:PK.Q,two:true};
  for(let d=250;d<=2000;d+=250){
   const mean=d*(24/48)/CL; if(mean>700) continue;      // old gate passes it
   if(d*(24/48)>4500) continue;
   const e=envelope(d,48,autoTinf(d),pk);
   if(e.max>700 && (!worst||e.max-700>worst.over)) worst={CL,d,mean,max:e.max,min:e.min,over:e.max-700};
  }}
 if(worst) L(`  worst: CL ${worst.CL.toFixed(2)} L/h, ${worst.d} mg Q48H — mean ${worst.mean.toFixed(0)} (OLD GATE: PASS), real windows ${worst.min.toFixed(0)} - ${worst.max.toFixed(0)}  => ceiling breached by ${worst.over.toFixed(0)}`);
 else L('  none found');}
{ // is such a regimen also "in band" by the shipped rule?
 const CL=1.75, pk={CL,Vc:PK.Vc,Vp:PK.Vp,Q:PK.Q,two:true};
 const e=envelope(2000,48,autoTinf(2000),pk);
 L(`  CL 1.75, 2000 mg Q48H: shipped auc24 ${(2000*0.5/CL).toFixed(0)} (in 400-600 => offered), real windows ${e.min.toFixed(0)} - ${e.max.toFixed(0)}`);}

R('4. THE DERIVED GRACE — how wide is the shipped acceptance band?');
for(const tau of [8,12,24,48]){const step=250*(24/tau)/PK.CL;
 L(`  Q${tau}H  step ${step.toFixed(1)}  grace +-${(step/2).toFixed(1)}  effective band ${(400-step/2).toFixed(0)} - ${(600+step/2).toFixed(0)}${600+step/2>ABS?'   <-- ABOVE THE 700 HARD CEILING':''}`);}

R('5. Q48H reachability vs clearance — does the envelope gate ban it wholesale?');
{let loCL=null,hiCL=null;
 for(let CL=0.10;CL<=3.0;CL+=0.01){
  const pk={CL,Vc:PK.Vc,Vp:PK.Vp,Q:PK.Q,two:true};
  let any=false;
  for(let d=250;d<=2000;d+=250){const e=envelope(d,48,autoTinf(d),pk);
    if(e&&e.min>=400&&e.max<=600){any=true;break;}}
  if(any){ if(loCL===null)loCL=CL; hiCL=CL; }}
 L(`  Q48H band-reachable for CL in [${loCL?loCL.toFixed(2):'-'}, ${hiCL?hiCL.toFixed(2):'-'}] L/h  (Goti Vc/Vp fixed at this patient's)`);
 // translate to a CrCl using the Goti population relation at this weight
 for(const crcl of [10,15,20,25,30,40,50,64,90]){
   const gg=gotiPopPK(crcl,TBW,false);
   const pk={CL:gg.TVCL,Vc:gg.TVVc,Vp:gg.TVVp,Q:K.Q_GOTI,two:true};
   let ok=[]; for(let d=250;d<=2000;d+=250){const e=envelope(d,48,autoTinf(d),pk);
     if(e&&e.min>=400&&e.max<=600) ok.push(d);}
   const e750=envelope(750,48,autoTinf(750),pk);
   L(`  CrCl ${String(crcl).padStart(3)} popCL ${gg.TVCL.toFixed(2)}  Q48H in-band doses [${ok.join(',')||'none'}]  (750mg windows ${e750.min.toFixed(0)}-${e750.max.toFixed(0)})`);
 }}

R('6. what the SHIPPED rule does across the target dial (the reported defect)');
for(const t of [400,425,450,475,500,550,600]){
 const r=bayesDoseOptimizer(PK.CL,PK.Vc,t,{Vc:PK.Vc,Vp:PK.Vp,Q:PK.Q},1);
 L(`  target ${t} -> ${r.dose} mg Q${r.tau}H  auc24 ${r.auc24.toFixed(0)}`);}

R('7. WHERE THE FOUR DESIGNS DISAGREE — same gate, different tiebreak');
L(`  computeGuidelineDose(TBW,CrCl).tau at CrCl ${CRCL.toFixed(1)} = ${computeGuidelineDose(TBW,CRCL).tau}`);
{const cand=[];
 for(const tau of [8,12,24,48]) for(let d=250;d<=2000;d+=250){
   if(d*(24/tau)>4500) continue;
   const e=envelope(d,tau,autoTinf(d),PK); if(!e) continue;
   if(e.min>=400&&e.max<=600){
     const tr=ssCtrough2comp(d,tau,autoTinf(d),PK.CL,PK.Vc,PK.Vp,PK.Q);
     cand.push({d,tau,mean:e.mean,min:e.min,max:e.max,tr});}}
 for(const x of cand) L(`  in-band: ${String(x.d).padStart(4)} mg Q${String(x.tau).padStart(2)}H  auc24 ${x.mean.toFixed(0)}  windows ${x.min.toFixed(0)}-${x.max.toFixed(0)}  trough ${x.tr.toFixed(1)}`);
 L('  -> minimal picks Q12H (tauConventional=12); composite/robustness pick Q24H; transparent declares a tie.');}

R('8. the Q36H trap in `minimal` (tauConventional can be 36, not in the offered set)');
for(const crcl of [16,20,25,30]){
 const gd=computeGuidelineDose(TBW,crcl);
 const d24=Math.abs(Math.log(24)-Math.log(gd.tau)), d48=Math.abs(Math.log(48)-Math.log(gd.tau));
 L(`  CrCl ${crcl}: tauConv ${gd.tau}  |ln24-ln tauConv| ${d24.toFixed(3)}  |ln48-..| ${d48.toFixed(3)}  => prefers Q${d48<d24?48:24}H`);}

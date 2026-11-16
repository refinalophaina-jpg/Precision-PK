'use strict';
// AUC24 uncertainty by model, level count and sampling design: the simulation behind AUC_UNCERTAINTY.
//
// Truth is drawn from EACH model's own prior and residual error; the levels are fitted with the shipped
// mapFit (as runBayesian calls it). true/est is the ratio of true to estimated AUC24 (= CLfit / CLtrue).
//
// Steady-state designs (the original table; 1000 mg q12h x 8, 1 h infusions):
//   troughs            n troughs, 0.5 h before doses 8, 7, 6
//   peaktrough(-early) trough before dose 8 + a level 1 h (or 0-2 h) after the end of infusion 7
// Early designs (v3.15.0, D27; models review I2), levels drawn before steady state. One loading dose of
// 25 mg/kg total body weight (250 mg steps, at most 3000 mg; infusion time from autoTinf) at 0 h, then
// 1000 mg q12h from 12 h (1 h infusions). The load is probe-map-starts.cjs's two-after-load design.
//   load-one           one level 6-10 h after the start of the load (uniform)
//   load-two           2 h after the end of the load's infusion, and 0.5 h before the first maintenance dose (11.5 h)
//   load-three         load-two + 0.5 h before the second maintenance dose (23.5 h): three early levels
//   load-two-ss        load-two + a steady-state trough 0.5 h before the 8th maintenance dose (95.5 h): mixed
// Intermediate designs (reported only; no row is fitted to them): 1000 mg q12h from 0 h, no load.
//   d4-trough          one trough 0.5 h before dose 4 (35.5 h), the usual first trough
//   d3d4-troughs       troughs 0.5 h before doses 3 and 4
// Unloaded early designs (reported only; not in the threshold criterion; Task 19 fix round 2):
//   dose-one           one level 2-11 h after the start of dose 1 (uniform), no load
//   dose-two           one trough 0.5 h before dose 3 (23.5 h), no load
//
// Usage:
//   node docs/audit/uncertainty-by-model.cjs [n=1500] [models] [seed=7]
//        the original output: displayed widths, then the steady-state designs for one seed
//   node docs/audit/uncertainty-by-model.cjs [n=1500] [models] --early [--seeds=7,11,23] [--heldout=31]
//        the early rows: 10th/90th percentiles of true/est AUC24 and p50/p80 relative error, per seed and the
//        mean of the seeds (the shipped row); then the coverage of every shipped row in every design, on the
//        simulation seeds pooled and on a held-out seed, by the row meant for the design ("own") and by the
//        row the app chooses ("app": latestLevelEarly on the fit (R47: the most recent level decides, by
//        earlyLevelFractions at SS_FRACTION_EARLY), then aucUncertaintyRow(n, model, early)).
// Fictional patients only. Reads index.html; changes nothing.
const {sb,C,rnd,randn,setSeed,pct}=require('./uncertainty-load.cjs');
const {buelgaPopPK,burtonObjective,nelderMead2D,predictConc1comp,gotiPopPK,burtonObj3D,nelderMead3D,predictConc2comp,
  hughesPopPK,burtonObj3D_hughes,aucUncertaintyFrac,aucUncertaintyText,aucUncertaintyRow,earlyLevelFractions,latestLevelEarly,autoTinf}=sb;
const args=process.argv.slice(2);
const pos=args.filter(a=>!a.startsWith('--'));
const opt=(k,d)=>{const a=args.find(x=>x.startsWith(`--${k}=`));return a?a.slice(k.length+3):d;};
const EARLY=args.includes('--early');
const N=+pos[0]||1500;
// The app fits with mapFit (multi-start); SINGLE=1 reproduces the old single start at eta=0.
const SINGLE=process.env.SINGLE==='1';
const TAU=12, MAINT=1000;

// The 2-comp terminal half-life of a fit, as runBayesian computes t12_ind (beta).
function t12of2comp(CL,Vc,Vp,Q){const k10=CL/Vc,k12=Q/Vc,k21=Q/Vp,s=k10+k12+k21;
  const beta=0.5*(s-Math.sqrt(Math.max(0,s*s-4*k10*k21)));return Math.LN2/beta;}

function course(design,tbw,nLev){
  if(design.startsWith('load')){
    const mg=Math.min(3000,Math.round(25*tbw/250)*250), tinf=autoTinf(mg);
    const doses=[{mg,tinfH:tinf,timeH:0}];for(let d=1;d<=8;d++)doses.push({mg:MAINT,tinfH:1,timeH:d*TAU});
    const times= design==='load-one'?[6+rnd()*4]
      : design==='load-two'?[tinf+2,TAU-0.5]
      : design==='load-three'?[tinf+2,TAU-0.5,2*TAU-0.5]
      : /* load-two-ss */ [tinf+2,TAU-0.5,8*TAU-0.5];
    return {doses,times};
  }
  const doses=[];for(let d=0;d<8;d++)doses.push({mg:MAINT,tinfH:1,timeH:d*TAU});
  if(design==='d4-trough') return {doses,times:[3*TAU-0.5]};
  if(design==='d3d4-troughs') return {doses,times:[2*TAU-0.5,3*TAU-0.5]};
  if(design==='dose-one') return {doses,times:[2+rnd()*9]};
  if(design==='dose-two') return {doses,times:[2*TAU-0.5]};
  const times=[];
  for(let L=0;L<nLev;L++){
    if(design==='peaktrough') times.push(L===0?8*TAU-0.5:7*TAU+2); // trough + 1h post-infusion peak
    else if(design==='peaktrough-early') times.push(L===0?8*TAU-0.5:7*TAU+(1+rnd()*2)); // peak drawn 0-2 h after infusion end
    else times.push(8*TAU-0.5-L*TAU);
  }
  return {doses,times};
}

// One record per simulated patient: { ratio: true/est AUC24, err: |est-true|/true, early: the app's test on the fit }.
// The random draws for the steady-state designs are in the original order, so the shipped rows reproduce.
function sim(model,nLev,design,seed){
  setSeed(seed); const out=[];
  for(let i=0;i<N;i++){
    let age=30+Math.floor(rnd()*50), tbw=50+rnd()*50, scr=0.7+rnd()*1.5;
    if(model==='hughes'){ tbw=110+rnd()*70; }
    const crcl=Math.max(10,Math.min(140,(140-age)*tbw/(72*scr)));
    const {doses,times}=course(design,tbw,nLev);
    let CLt,CLfit,t12fit=NaN,fit=null;const levels=[];
    if(model==='buelga'){
      const {CL_pop,V_pop}=buelgaPopPK(crcl,tbw);
      CLt=CL_pop*Math.exp(randn()*Math.sqrt(C.OMEGA2_CL_BUELGA)); const Vt=V_pop*Math.exp(randn()*Math.sqrt(C.OMEGA2_V_BUELGA));
      for(const t of times){const c=predictConc1comp(doses,t,CLt/Vt,Vt);levels.push({timeH:t,conc:Math.max(0.5,c+randn()*C.SIGMA_ADD_BUELGA)});}
      CLfit=CL_pop; let Vfit=V_pop;
      if(times.length){const fb=(x,y)=>burtonObjective(x,y,CL_pop,V_pop,doses,levels);
        const [a,b]=(SINGLE||!sb.mapFit)?nelderMead2D(fb,0,0,300):sb.mapFit(fb,2,C.OMEGA2_CL_BUELGA,C.OMEGA2_V_BUELGA,300).eta;
        CLfit=CL_pop*Math.exp(a); Vfit=V_pop*Math.exp(b);}
      t12fit=Math.LN2*Vfit/CLfit; fit={CL:CLfit,V:Vfit,bag:null};
    } else {
      let pk,Q,o,sp,sa,obj;
      if(model==='goti'){pk=gotiPopPK(crcl,tbw,false);Q=C.Q_GOTI;o=[C.OMEGA2_CL_GOTI,C.OMEGA2_VC_GOTI,C.OMEGA2_VP_GOTI];sp=C.SIGMA_PROP_GOTI;sa=C.SIGMA_ADD_GOTI;
        obj=(a,b,c)=>burtonObj3D(a,b,c,pk.TVCL,pk.TVVc,pk.TVVp,doses,levels);}
      else {const ffm=sb.computeFFM(tbw,170,'M');const crF=Math.max(10,Math.min(140,(140-age)*ffm/(72*scr)));
        pk=hughesPopPK(crF,ffm);Q=pk.TVQ;o=[C.OMEGA2_CL_HUGHES,C.OMEGA2_VC_HUGHES,C.OMEGA2_VP_HUGHES];sp=C.SIGMA_PROP_HUGHES;sa=C.SIGMA_ADD_HUGHES;
        obj=(a,b,c)=>burtonObj3D_hughes(a,b,c,pk.TVCL,pk.TVVc,pk.TVVp,pk.TVQ,doses,levels);}
      CLt=pk.TVCL*Math.exp(randn()*Math.sqrt(o[0])); const Vc=pk.TVVc*Math.exp(randn()*Math.sqrt(o[1])); const Vp=pk.TVVp*Math.exp(randn()*Math.sqrt(o[2]));
      for(const t of times){const c=predictConc2comp(doses,t,CLt/Vc,Q/Vc,Q/Vp,Vc);const sd=Math.sqrt((sp*c)**2+sa*sa);levels.push({timeH:t,conc:Math.max(0.5,c+randn()*sd)});}
      let r=[0,0,0];
      if(times.length){r=(SINGLE||!sb.mapFit)?nelderMead3D(obj,0,0,0,400):sb.mapFit(obj,3,o[0],o[1],400,o[2]).eta;}
      CLfit=pk.TVCL*Math.exp(r[0]);
      t12fit=t12of2comp(CLfit,pk.TVVc*Math.exp(r[1]),pk.TVVp*Math.exp(r[2]),Q);
      fit={CL:CLfit,V:pk.TVVc*Math.exp(r[1]),bag:{Vc:pk.TVVc*Math.exp(r[1]),Vp:pk.TVVp*Math.exp(r[2]),Q}};
    }
    if(!(CLfit>0)||!isFinite(CLfit))continue;
    const aT=24000/TAU/CLt, aE=24000/TAU/CLfit;
    // The app's row choice (R47): the most recent level decides.
    const early=latestLevelEarly?latestLevelEarly(levels,doses,t12fit,model):null;
    // For --sensitivity only: the most recent level's fraction of steady state, by the same formula.
    const lastLevelH=levels.length?Math.max(...levels.map(l=>l.timeH)):NaN;
    const lastFrac=1-Math.exp(-Math.LN2/t12fit*(lastLevelH-doses[0].timeH));
    out.push({ratio:aT/aE,err:Math.abs(aE-aT)/aT,early,lastFrac,fit,doses,lastLevelH});
  }
  return out;
}
const inRow=(x,row)=>x.ratio>=1-row.lo&&x.ratio<=1+row.hi;
const share=(recs,p)=>recs.filter(p).length/recs.length;
const f=x=>(x*100).toFixed(1)+'%';
const models=(pos[1]||'buelga,goti,hughes').split(',');

if(!EARLY){
  // ── The original output (design and seed use unchanged) ──
  const seed=+pos[2]||7;
  console.log('Displayed widths:',[0,1,2,3].map(n=>['buelga','goti','hughes'].map(m=>m+':'+aucUncertaintyText(n,m)).join(' | ')).join('\n'));
  const run=(m,n,d)=>{const recs=sim(m,n,d,seed),u=aucUncertaintyFrac(n,m),errT=recs.map(x=>x.err),ratio=recs.map(x=>x.ratio);
    return {u,median:pct(errT,.5),p80:pct(errT,.8),p90:pct(errT,.9),p99:pct(errT,.99),max:Math.max(...errT),q10:pct(ratio,.10),q90:pct(ratio,.90),
      cover:share(recs,x=>x.ratio>=1-u&&x.ratio<=1+u),missHi:share(recs,x=>x.ratio>1+u),missLo:share(recs,x=>x.ratio<1-u),n:recs.length};};
  for(const m of models) for(const n of [0,1,2,3]){const r=run(m,n,'troughs');
    console.log(`${m.padEnd(7)} n=${n} troughs  shown ±${f(r.u)}  |  median ${f(r.median)} p80 ${f(r.p80)} p90 ${f(r.p90)} | displayed-interval coverage ${f(r.cover)}  (true ABOVE hi ${f(r.missHi)}, below lo ${f(r.missLo)}) n=${r.n} | 80% band true/est: -${f(1-r.q10)} / +${f(r.q90-1)}`);}
  for(const m of models) for(const d of ['peaktrough','peaktrough-early']){const r=run(m,2,d);
    console.log(`${m.padEnd(7)} n=2 ${d.toUpperCase()} | median ${f(r.median)} p80 ${f(r.p80)} p90 ${f(r.p90)} p99 ${f(r.p99)} max ${f(r.max)} | ABOVE ${f(r.missHi)} below ${f(r.missLo)}`);}
  if(models.includes('buelga')){const r=run('buelga',2,'peaktrough');
    console.log(`buelga  n=2 PEAK+TROUGH shown ±${f(r.u)} | median ${f(r.median)} p80 ${f(r.p80)} p90 ${f(r.p90)} | coverage ${f(r.cover)}`);}
} else {
  // ── Early designs: the rows, then the coverage of the shipped rows ──
  const SEEDS=opt('seeds','7,11,23').split(',').map(Number), HELD=+opt('heldout',31);
  const r2=x=>(Math.round(x*100)/100).toFixed(2);
  console.log(`uncertainty-by-model --early: n = ${N} per design per seed; seeds ${SEEDS.join(', ')}; held-out seed ${HELD}; fitter ${SINGLE?'single start':'mapFit (shipped)'}`);
  const designs=[['troughs',0],['troughs',1],['troughs',2],['troughs',3],['load-one',1],['load-two',2],['load-three',3],['load-two-ss',3],['d4-trough',1],['d3d4-troughs',2],['dose-one',1],['dose-two',1]];
  const REPORT_ONLY=['dose-one','dose-two'];   // fix round 2: reported, not in the threshold criterion
  const R={};
  for(const m of models){R[m]={};
    for(const [d,n] of designs){R[m][`${d}/${n}`]={seeds:SEEDS.map(s=>sim(m,n,d,s)),held:sim(m,n,d,HELD)};}}
  const rowOf=recs=>{const ratio=recs.map(x=>x.ratio),err=recs.map(x=>x.err);
    return {lo:1-pct(ratio,.10),hi:pct(ratio,.90)-1,median:pct(err,.5),frac:pct(err,.8),n:recs.length};};
  console.log('\nROWS (true/est AUC24 10th/90th percentiles as -lo / +hi; |error| p50 and p80), per seed and the mean of the seeds:');
  for(const m of models) for(const [d,n] of designs){
    const per=R[m][`${d}/${n}`].seeds.map(rowOf), mean=k=>per.reduce((a,p)=>a+p[k],0)/per.length;
    console.log(`${m.padEnd(7)} ${(d+'/'+n).padEnd(13)} | `+per.map((p,i)=>`seed ${SEEDS[i]}: -${f(p.lo)} / +${f(p.hi)} p50 ${f(p.median)} p80 ${f(p.frac)} (n=${p.n})`).join(' | ')
      +`\n        mean -> { n:${n}, frac:${r2(mean('frac'))}, median:${r2(mean('median'))}, lo:${r2(mean('lo'))}, hi:${r2(mean('hi'))} }`);
  }
  let rowsShipped=false; try{rowsShipped=aucUncertaintyRow(1,'buelga',true).design==='early';}catch(e){}
  if(!rowsShipped||!latestLevelEarly){console.log('\n(no early rows in index.html yet: coverage not computed)');process.exit(0);}
  console.log('\nCOVERAGE of the shipped rows: the share of simulated patients whose true AUC24 lies in [est x (1 - lo), est x (1 + hi)].');
  console.log('own = the row meant for the design (troughs: steady-state; load-*: early); app = aucUncertaintyRow(n, model, early), early from');
  console.log('latestLevelEarly on each fit. pooled = seeds '+SEEDS.join('/')+' together; held-out = seed '+HELD+'. ABOVE = true AUC above the band.');
  for(const m of models) for(const [d,n] of designs){
    const k=`${d}/${n}`,pooled=[].concat(...R[m][k].seeds),held=R[m][k].held;
    const app=x=>inRow(x,aucUncertaintyRow(n,m,x.early));
    // Intermediate designs have no row of their own: both rows are shown.
    const owns=/^d[34]|^dose/.test(d) ? [aucUncertaintyRow(n,m,false),aucUncertaintyRow(n,m,true)] : [aucUncertaintyRow(n,m,d!=='troughs')];
    console.log(`${m.padEnd(7)} ${k.padEnd(14)} `+owns.map(own=>`${own.id} -${String(Math.round(own.lo*100)).padStart(2)}% / +${String(Math.round(own.hi*100)).padStart(2)}%`
      +`: pooled ${f(share(pooled,x=>inRow(x,own)))} (ABOVE ${f(share(pooled,x=>x.ratio>1+own.hi))}), held-out ${f(share(held,x=>inRow(x,own)))}`).join(' | ')
      +` | app: pooled ${f(share(pooled,app))}, held-out ${f(share(held,app))} | early by the app's test ${f(share(pooled,x=>x.early))}`);
  }
  // --sensitivity=0.5,0.6,...: the "app" coverage had the model's early-level threshold (SS_FRACTION_EARLY)
  // been each value: a what-if for the preference, by the same formula on the most recent level
  // (lastFrac, R47); the shipped value's column must reproduce latestLevelEarly. The choice (Task 19
  // controller rulings): (a) under the app's own row choice every criterion design covers 75-85%, pooled
  // seeds; (b) among those, the value whose worst design is nearest 80%. Criterion designs: every
  // simulated design with levels, the mixed load-two-ss included, except the unloaded dose-one and
  // dose-two (reported only).
  const SENS=opt('sensitivity',null);
  if(SENS){const th=SENS.split(',').map(Number);
    const vmod=require('vm');
    const shippedT=m=>{try{const o=vmod.runInContext('SS_FRACTION_EARLY',sb);return o[m];}catch(e){return 0.9;}};
    // Fix round 2: every simulated design is a criterion, load-two-ss included; only the unloaded
    // dose-one / dose-two are reported without being tuned to.
    const crit=designs.filter(([d,n])=>n>0&&!REPORT_ONLY.includes(d));
    const cov=(recs,m,n,t)=>share(recs,x=>inRow(x,aucUncertaintyRow(n,m,x.lastFrac<t)));
    for(const m of models){
      const T=shippedT(m);
      const agree=designs.every(([d,n])=>!n||[].concat(...R[m][`${d}/${n}`].seeds).every(x=>x.early===(x.lastFrac<T)));
      console.log(`\nSENSITIVITY ${m} (pooled seeds; criterion designs: ${crit.map(([d,n])=>d+'/'+n).join(', ')}); shipped threshold ${T}`
        +(agree?' reproduces latestLevelEarly':' DISAGREES with latestLevelEarly'));
      let best=null;
      for(const t of th){
        const c=crit.map(([d,n])=>cov([].concat(...R[m][`${d}/${n}`].seeds),m,n,t));
        const ok=c.every(v=>v>=0.75&&v<=0.85), worst=Math.max(...c.map(v=>Math.abs(v-0.8)));
        if(ok&&(!best||worst<best.worst-1e-12))best={t,worst};
        console.log(`  ${String(t).padEnd(6)} ${ok?'meets 75-85':'fails      '} worst |cov-80| ${f(worst)} | `+crit.map(([d,n],i)=>`${d}/${n} ${f(c[i])}`).join(', '));
      }
      const pick=best?best.t:th.reduce((a,t)=>{const w=Math.max(...crit.map(([d,n])=>Math.abs(cov([].concat(...R[m][`${d}/${n}`].seeds),m,n,t)-0.8)));return !a||w<a.w?{t,w}:a;},null).t;
      console.log(`  CHOSEN ${m}: ${pick}${best?'':' (NO value meets 75-85%: the best worst-design value is shown)'}`);
      console.log(`  Coverage at ${pick}, app's row choice:`);
      for(const [d,n] of designs){if(!n)continue;const k=`${d}/${n}`,pooled=[].concat(...R[m][k].seeds),held=R[m][k].held,e=x=>x.lastFrac<pick;
        console.log(`    ${k.padEnd(15)} pooled ${f(cov(pooled,m,n,pick))}, held-out ${f(cov(held,m,n,pick))} | read as early ${f(share(pooled,e))}${crit.some(([a,b])=>a===d&&b===n)?'':' (not a criterion)'}`);}
    }
  }
  // --decisions: regimenDecision on each fit, with the steady-state row (the pre-D27 answer) and with the
  // row the app chooses (latestLevelEarly at the shipped SS_FRACTION_EARLY). "never worse": app-row
  // changes for attainment (not safety) with fewer app-row dots than the current regimen, over all fits. The current regimen is the
  // design's own course, every dose given before the last level; "now" is 0.5 h after the last level. A
  // design whose levels precede the first maintenance dose has no current regimen (a load alone), so its
  // answer is the target box, which the row does not move. Counts per design, pooled seeds.
  if(args.includes('--decisions')){
    const {regimenDecision,attainmentDots}=sb;
    const sig=r=>!r?'none':r.noSolution?'refusal':`${r.action} ${r.dose} mg q${r.tau}h`;
    console.log('\nDECISIONS (pooled seeds): steady-state row (before D27) against the app row (D27), per design');
    for(const m of models) for(const [d,n] of designs){if(!n)continue;
      const recs=[].concat(...R[m][`${d}/${n}`].seeds);const kinds={};let flips=0,worse=0,ex={};
      for(const x of recs){
        const nowH=x.lastLevelH+0.5, given=x.doses.filter(q=>q.timeH<=nowH);
        const ss=aucUncertaintyRow(n,m,false), app=aucUncertaintyRow(n,m,x.early);
        const a=regimenDecision(x.fit.CL,x.fit.V,450,x.fit.bag,1,given,ss,{nowH}), b=regimenDecision(x.fit.CL,x.fit.V,450,x.fit.bag,1,given,app,{nowH});
        if(b&&!b.noSolution&&b.action==='change'&&b.decisionReason!=='safety'&&b.current&&attainmentDots(b.auc24,app)<attainmentDots(b.current.auc24,app))worse++;
        if(sig(a)===sig(b))continue; flips++;
        const k=`${a.noSolution?'refusal':a.action} -> ${b.noSolution?'refusal':b.action}`;kinds[k]=(kinds[k]||0)+1;
        if(!ex[k]){const cur=a.current||(a.action==='continue'?a:null)||b.current||(b.action==='continue'?b:null);
          ex[k]=`CL ${x.fit.CL.toFixed(2)} L/h${x.fit.bag?`, Vc ${x.fit.bag.Vc.toFixed(0)} L, Vp ${x.fit.bag.Vp.toFixed(0)} L`:`, V ${x.fit.V.toFixed(0)} L`}, on ${given[given.length-1].mg} mg q12h`
            +(cur?` (AUC24 ${cur.auc24.toFixed(0)})`:'')+`: ${ss.id} ${sig(a)} [answer ${attainmentDots(a.auc24,ss)}/20${cur?`, current ${attainmentDots(cur.auc24,ss)}/20`:''}]`
            +` -> ${app.id} ${sig(b)} [answer ${attainmentDots(b.auc24,app)}/20${cur?`, current ${attainmentDots(cur.auc24,app)}/20`:''}]`;}
      }
      console.log(`${m.padEnd(7)} ${(d+'/'+n).padEnd(15)} ${flips} of ${recs.length} answers differ ${JSON.stringify(kinds)}; never worse broken: ${worse}`);
      for(const k in ex)console.log(`    ${k}: e.g. ${ex[k]}`);
    }
  }
}

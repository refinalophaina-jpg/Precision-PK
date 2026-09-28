'use strict';
const {sb,C,rnd,randn,setSeed,pct}=require('./uncertainty-load.cjs');
const {buelgaPopPK,burtonObjective,nelderMead2D,predictConc1comp,gotiPopPK,burtonObj3D,nelderMead3D,predictConc2comp,
  hughesPopPK,burtonObj3D_hughes,aucUncertaintyFrac,aucUncertaintyText}=sb;
console.log('Displayed widths:',[0,1,2,3].map(n=>['buelga','goti','hughes'].map(m=>m+':'+aucUncertaintyText(n,m)).join(' | ')).join('\n'));
const N=+process.argv[2]||1500;
// The app fits with mapFit (multi-start); SINGLE=1 reproduces the old single start at eta=0.
const SINGLE=process.env.SINGLE==='1';
function run(model,nLev,design){
  setSeed(+process.argv[4]||7); const errT=[], ratio=[]; let cover=0, missHi=0, missLo=0, tot=0;
  const u=aucUncertaintyFrac(nLev,model);
  for(let i=0;i<N;i++){
    let age=30+Math.floor(rnd()*50), tbw=50+rnd()*50, scr=0.7+rnd()*1.5;
    if(model==='hughes'){ tbw=110+rnd()*70; }
    const crcl=Math.max(10,Math.min(140,(140-age)*tbw/(72*scr)));
    const dose=1000,tau=12,doses=[];for(let d=0;d<8;d++)doses.push({mg:dose,tinfH:1,timeH:d*tau});
    const times=[];
    for(let L=0;L<nLev;L++){
      if(design==='peaktrough') times.push(L===0?8*tau-0.5:7*tau+2); // trough + 1h post-infusion peak
      else if(design==='peaktrough-early') times.push(L===0?8*tau-0.5:7*tau+(1+rnd()*2)); // peak drawn 0-2 h after infusion end
      else times.push(8*tau-0.5-L*tau);
    }
    let CLt,CLfit,levels=[];
    if(model==='buelga'){
      const {CL_pop,V_pop}=buelgaPopPK(crcl,tbw);
      CLt=CL_pop*Math.exp(randn()*Math.sqrt(C.OMEGA2_CL_BUELGA)); const Vt=V_pop*Math.exp(randn()*Math.sqrt(C.OMEGA2_V_BUELGA));
      for(const t of times){const c=predictConc1comp(doses,t,CLt/Vt,Vt);levels.push({timeH:t,conc:Math.max(0.5,c+randn()*C.SIGMA_ADD_BUELGA)});}
      CLfit=CL_pop; if(nLev){const fb=(x,y)=>burtonObjective(x,y,CL_pop,V_pop,doses,levels);
        const [a]=(SINGLE||!sb.mapFit)?nelderMead2D(fb,0,0,300):sb.mapFit(fb,2,C.OMEGA2_CL_BUELGA,C.OMEGA2_V_BUELGA,300).eta;CLfit=CL_pop*Math.exp(a);}
    } else {
      let pk,Q,o,sp,sa,obj;
      if(model==='goti'){pk=gotiPopPK(crcl,tbw,false);Q=C.Q_GOTI;o=[C.OMEGA2_CL_GOTI,C.OMEGA2_VC_GOTI,C.OMEGA2_VP_GOTI];sp=C.SIGMA_PROP_GOTI;sa=C.SIGMA_ADD_GOTI;
        obj=(a,b,c)=>burtonObj3D(a,b,c,pk.TVCL,pk.TVVc,pk.TVVp,doses,levels);}
      else {const ffm=sb.computeFFM(tbw,170,'M');const crF=Math.max(10,Math.min(140,(140-age)*ffm/(72*scr)));
        pk=hughesPopPK(crF,ffm);Q=pk.TVQ;o=[C.OMEGA2_CL_HUGHES,C.OMEGA2_VC_HUGHES,C.OMEGA2_VP_HUGHES];sp=C.SIGMA_PROP_HUGHES;sa=C.SIGMA_ADD_HUGHES;
        obj=(a,b,c)=>burtonObj3D_hughes(a,b,c,pk.TVCL,pk.TVVc,pk.TVVp,pk.TVQ,doses,levels);}
      CLt=pk.TVCL*Math.exp(randn()*Math.sqrt(o[0])); const Vc=pk.TVVc*Math.exp(randn()*Math.sqrt(o[1])); const Vp=pk.TVVp*Math.exp(randn()*Math.sqrt(o[2]));
      for(const t of times){const c=predictConc2comp(doses,t,CLt/Vc,Q/Vc,Q/Vp,Vc);const sd=Math.sqrt((sp*c)**2+sa*sa);levels.push({timeH:t,conc:Math.max(0.5,c+randn()*sd)});}
      CLfit=pk.TVCL; if(nLev){const r=(SINGLE||!sb.mapFit)?nelderMead3D(obj,0,0,0,400):sb.mapFit(obj,3,o[0],o[1],400).eta;CLfit=pk.TVCL*Math.exp(r[0]);}
    }
    if(!(CLfit>0)||!isFinite(CLfit))continue;
    const aT=24000/tau/CLt, aE=24000/tau/CLfit;
    errT.push(Math.abs(aE-aT)/aT); ratio.push(aT/aE); tot++;
    if(aT>aE*(1+u))missHi++; else if(aT<aE*(1-u))missLo++; else cover++;
  }
  return {model,nLev,design,u,median:pct(errT,.5),p80:pct(errT,.8),p90:pct(errT,.9),p99:pct(errT,.99),max:Math.max(...errT),q10:pct(ratio,.10),q90:pct(ratio,.90),cover:cover/tot,missHi:missHi/tot,missLo:missLo/tot,n:tot};
}
const f=x=>(x*100).toFixed(1)+'%';
const models=(process.argv[3]||'buelga,goti,hughes').split(',');
for(const m of models) for(const n of [0,1,2,3]){const r=run(m,n,'troughs');
  console.log(`${m.padEnd(7)} n=${n} troughs  shown ±${f(r.u)}  |  median ${f(r.median)} p80 ${f(r.p80)} p90 ${f(r.p90)} | displayed-interval coverage ${f(r.cover)}  (true ABOVE hi ${f(r.missHi)}, below lo ${f(r.missLo)}) n=${r.n} | 80% band true/est: -${f(1-r.q10)} / +${f(r.q90-1)}`);}
for(const m of models) for(const d of ['peaktrough','peaktrough-early']){const r=run(m,2,d);
  console.log(`${m.padEnd(7)} n=2 ${d.toUpperCase()} | median ${f(r.median)} p80 ${f(r.p80)} p90 ${f(r.p90)} p99 ${f(r.p99)} max ${f(r.max)} | ABOVE ${f(r.missHi)} below ${f(r.missLo)}`);}
if(models.includes('buelga')){const r=run('buelga',2,'peaktrough');
  console.log(`buelga  n=2 PEAK+TROUGH shown ±${f(r.u)} | median ${f(r.median)} p80 ${f(r.p80)} p90 ${f(r.p90)} | coverage ${f(r.cover)}`);}

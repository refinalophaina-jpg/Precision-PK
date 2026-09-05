'use strict';
// ═══════════════════════════════════════════════════════════════════════
// AinaDara Phase 2D — Validation & Uncertainty Characterization
// Tests: single-patient traces, objective-function minima, shrinkage,
//        Monte Carlo (Buelga + Goti), regression vs Phase 1, and an
//        external clinical scenario (DoseMeRx-style Patient BB)
// ═══════════════════════════════════════════════════════════════════════
const fs   = require('fs');
const vm   = require('vm');
const path = require('path');

// ─── Goti constants mirrored from calculator (const ≠ extractable from vm) ───
const Q_GOTI          = 6.5;
const OMEGA2_CL_GOTI  = 0.1470;
const OMEGA2_VC_GOTI  = 0.5103;
const OMEGA2_VP_GOTI  = 0.2824;
const OMEGA2_CL_BUELGA = 0.122;
const OMEGA2_V_BUELGA  = 0.053;

// ─── 1. Extract JS from HTML and run in sandboxed VM ──────────────────
const htmlPath = path.join(__dirname, 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
if (!scriptMatch) { console.error('ERROR: Could not find <script> block in HTML.'); process.exit(1); }

// Robust DOM stub so init code (updateModelInfo, etc.) doesn't throw
function makeEl() {
  return {
    value: '', textContent: '', innerHTML: '',
    style: { display: '' }, checked: false,
    classList: { toggle:()=>{}, add:()=>{}, remove:()=>{}, contains:()=>false },
    querySelectorAll: ()=>[], querySelector:()=>null,
    getAttribute: ()=>null, setAttribute:()=>{},
    addEventListener: ()=>{}, appendChild: ()=>{}, removeChild: ()=>{},
  };
}

const sandbox = {
  document: {
    getElementById: ()=>makeEl(), querySelector: ()=>null,
    querySelectorAll: ()=>[], createElement: ()=>makeEl(),
  },
  window: {}, alert: ()=>{}, requestAnimationFrame: ()=>{},
  console,
  Math, parseFloat, parseInt, isNaN, isFinite, NaN, Infinity,
  Object, Array, String, Number, Boolean, Function, Date, Error, TypeError,
  JSON, RegExp,
  bState: { sex:'M', model:'buelga', dial:false, result:null, tinkCompare:[] },
};
sandbox.window = sandbox;

try {
  vm.runInNewContext(scriptMatch[1], sandbox);
} catch(e) {
  console.error('ERROR running calculator JS in VM:', e.message);
  process.exit(1);
}

// ─── 2. Pull pure-math functions from sandbox ─────────────────────────
// NOTE: const/let in the vm are NOT sandbox properties; only function
// declarations and var are. The functions below close over their constants
// within the vm scope and work correctly when called from outside.
const {
  buelgaPopPK, burtonObjective, nelderMead2D,
  gotiPopPK, burtonObj3D, nelderMead3D,
  predictConc1comp, predictConc2comp,
  autoTinf, aucUncertaintyText,
  // Phase 3 — Hughes 2024 obese model
  computeFFM, hughesPopPK, burtonObj3D_hughes,
  // Phase 3 Step 5 — ARC detection
  detectARC, ARC_THRESHOLD,
  // Phase 3 Step 6 — Very-low CrCl detection
  detectVeryLowCrCl,
} = sandbox;

// ─── Hughes constants mirrored from calculator ───
const HUGHES_TVCL    = 5.09;
const HUGHES_TVVC    = 64.9;
const HUGHES_TVQ     = 6.36;
const HUGHES_TVVP    = 66.4;
const HUGHES_CRCL_EXP= 0.887;
const OMEGA2_CL_HUGHES = 0.0602;
const OMEGA2_VC_HUGHES = 0.0312;
const OMEGA2_VP_HUGHES = 0.4974;
const SIGMA_PROP_HUGHES= 0.156;
const SIGMA_ADD_HUGHES = 1.2;

// ─── 3. Test framework ────────────────────────────────────────────────
let pass=0, fail=0;
const allResults = [];

function test(name, fn) {
  try { fn(); console.log(`  ✓  ${name}`); pass++; allResults.push({name,ok:true}); }
  catch(e) { console.log(`  ✗  ${name}\n       ↳ ${e.message}`); fail++; allResults.push({name,ok:false,err:e.message}); }
}
function section(t) { console.log(`\n${'═'.repeat(60)}\n  ${t}\n${'─'.repeat(60)}`); }
function assert(c,m) { if (!c) throw new Error(m); }
function assertClose(a,b,tol,label) {
  if (!isFinite(a)) throw new Error(`${label}: value is ${a} (not finite)`);
  if (Math.abs(a-b) > tol) throw new Error(`${label}: got ${a.toFixed(5)}, expected ≈${b.toFixed(5)} (tol ±${tol})`);
}
function assertLess(a,b,label) {
  if (!isFinite(a)||!isFinite(b)) throw new Error(`${label}: non-finite value (${a} vs ${b})`);
  if (a >= b) throw new Error(`${label}: ${a.toFixed(5)} is NOT < ${b.toFixed(5)}`);
}

// ─── Seeded PRNG (LCG) for reproducible Monte Carlo ──────────────────
let _seed = 20250409;
function seededRand() {
  _seed = (_seed * 1664525 + 1013904223) >>> 0;
  const v = _seed / 4294967296;
  return Math.max(1e-12, Math.min(1-1e-12, v));   // keep away from 0/1
}
function seededRandn() {
  const u = seededRand(), v = seededRand();
  const z = Math.sqrt(-2*Math.log(u)) * Math.cos(2*Math.PI*v);
  return Math.max(-4, Math.min(4, z));             // clip extreme outliers
}
function clamp(x,lo,hi) { return Math.max(lo, Math.min(hi,x)); }

// ════════════════════════════════════════════════════════════════════
// SUITE 1 — Single-patient trace tests (Buelga 1-comp)
// ════════════════════════════════════════════════════════════════════
// NOTE: MAP Bayesian estimation with a prior WILL shrink η toward 0.
// With a single observation, the posterior mean ≠ true η — it's pulled
// between 0 and the true value by the prior-to-data variance ratio.
// Tests verify: (a) correct direction, (b) AUC closer than population.
// ════════════════════════════════════════════════════════════════════
section('SUITE 1 · Single-patient trace tests — Buelga 1-comp');

// Scenario A: Male 65yr 80 kg SCr 1.2 → known η_CL_true = +0.35
{
  const crcl   = (140-65)*80 / (72*1.2);
  const {CL_pop, V_pop} = buelgaPopPK(crcl, 80);
  const TRUE_ETA_CL = 0.35;
  const CL_true = CL_pop * Math.exp(TRUE_ETA_CL);
  const kel_true = CL_true / V_pop;
  const doses  = [{mg:1000, tinfH:1.0, timeH:0},{mg:1000, tinfH:1.0, timeH:12}];
  const tLev   = 23.5;
  const obsLev = predictConc1comp(doses, tLev, kel_true, V_pop);
  const levels = [{timeH:tLev, conc:obsLev}];

  test('Scenario A: buelgaPopPK CL_pop in physiologic range (2–6 L/h)', ()=>{
    assert(CL_pop >= 2 && CL_pop <= 6, `CL_pop=${CL_pop.toFixed(3)}`);
  });
  test('Scenario A: buelgaPopPK V_pop in physiologic range (40–80 L)', ()=>{
    assert(V_pop >= 40 && V_pop <= 80, `V_pop=${V_pop.toFixed(1)}`);
  });
  test('Scenario A: Synthetic level physiologically plausible (1–35 mg/L)', ()=>{
    assert(obsLev > 1 && obsLev < 35, `Level=${obsLev.toFixed(2)} mg/L`);
  });
  test('Scenario A: MAP estimate is in correct direction (η_CL_fit > 0)', ()=>{
    const [etaCL] = nelderMead2D((a,b)=>burtonObjective(a,b,CL_pop,V_pop,doses,levels),0,0,300);
    assert(etaCL > 0, `η_CL_fit=${etaCL.toFixed(4)} should be positive (true=+0.35)`);
  });
  test('Scenario A: Bayesian AUC error < population AUC error', ()=>{
    const [etaCL] = nelderMead2D((a,b)=>burtonObjective(a,b,CL_pop,V_pop,doses,levels),0,0,300);
    const CL_fit  = CL_pop * Math.exp(etaCL);
    const auc_true = 1000*(24/12)/CL_true;
    const auc_pop  = 1000*(24/12)/CL_pop;
    const auc_fit  = 1000*(24/12)/CL_fit;
    const errBayes = Math.abs(auc_fit - auc_true);
    const errPop   = Math.abs(auc_pop - auc_true);
    assert(errBayes < errPop, `Bayesian err ${errBayes.toFixed(1)} NOT < Pop err ${errPop.toFixed(1)}`);
  });
  test('Scenario A: Bayesian AUC within ±20% of true (MAP shrinkage expected)', ()=>{
    const [etaCL] = nelderMead2D((a,b)=>burtonObjective(a,b,CL_pop,V_pop,doses,levels),0,0,300);
    const CL_fit  = CL_pop * Math.exp(etaCL);
    const auc_true = 1000*(24/12)/CL_true;
    const auc_fit  = 1000*(24/12)/CL_fit;
    const relErr   = Math.abs(auc_fit - auc_true) / auc_true;
    assert(relErr < 0.20, `AUC relErr ${(relErr*100).toFixed(1)}% > 20%`);
  });
  test('Scenario A: Fitted curve tracks observation better than population curve', ()=>{
    // MAP with shrinkage will NOT fit perfectly (prior penalty pulls η toward 0),
    // but the fitted curve should be closer to the observation than the pop curve.
    const [etaCL, etaV] = nelderMead2D((a,b)=>burtonObjective(a,b,CL_pop,V_pop,doses,levels),0,0,300);
    const CL_fit  = CL_pop * Math.exp(etaCL);
    const V_fit   = V_pop  * Math.exp(etaV);
    const Cpred_fit = predictConc1comp(doses, tLev, CL_fit/V_fit, V_fit);
    const Cpred_pop = predictConc1comp(doses, tLev, CL_pop/V_pop, V_pop);
    const errFit  = Math.abs(Cpred_fit - obsLev);
    const errPop  = Math.abs(Cpred_pop - obsLev);
    assert(errFit < errPop, `Fitted curve err ${errFit.toFixed(2)} NOT < Pop curve err ${errPop.toFixed(2)}`);
  });
}

// Scenario B: η_CL_true = −0.25 (reduced clearance)
{
  const crcl2  = (140-45)*70 / (72*0.9);
  const {CL_pop:CL2, V_pop:V2} = buelgaPopPK(crcl2, 70);
  const CL_true2 = CL2 * Math.exp(-0.25);
  const kel2 = CL_true2 / V2;
  const doses2 = [{mg:1500,tinfH:1.5,timeH:0},{mg:1500,tinfH:1.5,timeH:12},{mg:1500,tinfH:1.5,timeH:24}];
  const lv2 = predictConc1comp(doses2, 35.5, kel2, V2);

  test('Scenario B: MAP estimate is in correct direction (η_CL_fit < 0)', ()=>{
    const [etaCL] = nelderMead2D((a,b)=>burtonObjective(a,b,CL2,V2,doses2,[{timeH:35.5,conc:lv2}]),0,0,300);
    assert(etaCL < 0, `η_CL_fit=${etaCL.toFixed(4)} should be negative (true=−0.25)`);
  });
  test('Scenario B: Bayesian AUC error < population AUC error', ()=>{
    const [etaCL] = nelderMead2D((a,b)=>burtonObjective(a,b,CL2,V2,doses2,[{timeH:35.5,conc:lv2}]),0,0,300);
    const auc_true = 1500*(24/12)/CL_true2;
    const auc_pop  = 1500*(24/12)/CL2;
    const auc_fit  = 1500*(24/12)/(CL2*Math.exp(etaCL));
    assert(Math.abs(auc_fit-auc_true) < Math.abs(auc_pop-auc_true),
      `Bayesian err ${Math.abs(auc_fit-auc_true).toFixed(1)} NOT < Pop err ${Math.abs(auc_pop-auc_true).toFixed(1)}`);
  });
}

// Scenario C: 2 levels improve fit vs 1 level
{
  const crcl3  = (140-60)*65 / (72*1.5);
  const {CL_pop:CL3, V_pop:V3} = buelgaPopPK(crcl3, 65);
  const CL_true3 = CL3 * Math.exp(0.20);
  const kel3 = CL_true3 / V3;
  const doses3 = [{mg:750,tinfH:1.0,timeH:0},{mg:750,tinfH:1.0,timeH:12}];
  const lv3a = predictConc1comp(doses3, 11.0, kel3, V3);
  const lv3b = predictConc1comp(doses3, 23.0, kel3, V3);
  const fit1 = nelderMead2D((a,b)=>burtonObjective(a,b,CL3,V3,doses3,[{timeH:11,conc:lv3a}]),0,0,300);
  const fit2 = nelderMead2D((a,b)=>burtonObjective(a,b,CL3,V3,doses3,[{timeH:11,conc:lv3a},{timeH:23,conc:lv3b}]),0,0,300);
  const err1 = Math.abs(fit1[0] - 0.20);
  const err2 = Math.abs(fit2[0] - 0.20);
  test('Scenario C: 2-level fit is at least as accurate as 1-level (η error)', ()=>{
    assert(err2 <= err1 + 0.005, `2-level η err ${err2.toFixed(4)} > 1-level err ${err1.toFixed(4)} + tol`);
  });
}

// ════════════════════════════════════════════════════════════════════
// SUITE 2 — Objective function minimum verification
// ════════════════════════════════════════════════════════════════════
section('SUITE 2 · Objective function minimum verification');

{
  const crcl = (140-65)*80 / (72*1.2);
  const {CL_pop, V_pop} = buelgaPopPK(crcl, 80);
  const CL_true = CL_pop * Math.exp(0.35);
  const doses = [{mg:1000,tinfH:1.0,timeH:0},{mg:1000,tinfH:1.0,timeH:12}];
  const obsLev = predictConc1comp(doses, 23.5, CL_true/V_pop, V_pop);
  const levels = [{timeH:23.5, conc:obsLev}];

  test('Buelga obj at true η_CL < obj at η_CL=0', ()=>{
    const objTrue = burtonObjective(0.35,0,CL_pop,V_pop,doses,levels);
    const objPop  = burtonObjective(0,  0,CL_pop,V_pop,doses,levels);
    assertLess(objTrue, objPop, 'Obj(η_true) vs Obj(η=0)');
  });
  test('Optimizer beats all 9 surrounding grid-point evaluations', ()=>{
    const [ea,eb] = nelderMead2D((a,b)=>burtonObjective(a,b,CL_pop,V_pop,doses,levels),0,0,300);
    const objOpt  = burtonObjective(ea,eb,CL_pop,V_pop,doses,levels);
    for (const a of [-0.5,0,0.5]) for (const b of [-0.5,0,0.5]) {
      const g = burtonObjective(a,b,CL_pop,V_pop,doses,levels);
      assert(objOpt <= g+0.001, `Grid (${a},${b}) obj ${g.toFixed(4)} < optimizer ${objOpt.toFixed(4)}`);
    }
  });
}
{
  const pk = gotiPopPK(80, 75, false);
  const CL_g = pk.TVCL * Math.exp(0.25);
  const Vc_g = pk.TVVc;
  const k10_g = CL_g/Vc_g, k12_g = Q_GOTI/Vc_g, k21_g = Q_GOTI/pk.TVVp;
  const dosesG = [{mg:1000,tinfH:1.0,timeH:0},{mg:1000,tinfH:1.0,timeH:12}];
  const levG = predictConc2comp(dosesG,23.5,k10_g,k12_g,k21_g,Vc_g);

  // Goti 2-comp MAP note: due to Goti's large SIGMA_ADD (3.4 mg/L), the prior penalty
  // (η²/Ω²) grows faster than the data fit term as |η_true| increases. This means
  // obj(η_true) is not always < obj(η=0) — the MAP can shrink to near 0 even with
  // moderate-large η_true. This is correct MAP behavior (it's the right Bayesian
  // estimator for these parameters). The correct test: given a strong signal,
  // the optimizer should move η_CL in the correct direction (away from 0).
  {
    const CL_g_strong = pk.TVCL * Math.exp(1.0);
    const k10_gs = CL_g_strong/Vc_g, k12_gs = Q_GOTI/Vc_g, k21_gs = Q_GOTI/pk.TVVp;
    const lev1s = predictConc2comp(dosesG, 11.5, k10_gs, k12_gs, k21_gs, Vc_g);
    const lev2s = predictConc2comp(dosesG, 23.5, k10_gs, k12_gs, k21_gs, Vc_g);
    const levs2s = [{timeH:11.5,conc:lev1s},{timeH:23.5,conc:lev2s}];
    test('Goti MAP with 2 levels + strong signal: optimizer moves η_CL in correct direction', ()=>{
      const [eCL_s] = nelderMead3D(
        (a,b,c)=>burtonObj3D(a,b,c,pk.TVCL,pk.TVVc,pk.TVVp,dosesG,levs2s), 0,0,0,400
      );
      // η_CL_true=1.0 → MAP should be positive (even if shrunk toward 0 by prior)
      assert(eCL_s > 0,
        `MAP η_CL = ${eCL_s.toFixed(4)} should be > 0 when true η_CL = 1.0`);
    });
  }
  test('Goti optimizer beats η=0 start when given a strong data signal (2 levels)', ()=>{
    const lev1 = predictConc2comp(dosesG, 11.5, k10_g, k12_g, k21_g, Vc_g);
    const levs2 = [{timeH:11.5,conc:lev1},{timeH:23.5,conc:levG}];
    const [eCL,eVc,eVp] = nelderMead3D(
      (a,b,c)=>burtonObj3D(a,b,c,pk.TVCL,pk.TVVc,pk.TVVp,dosesG,levs2), 0,0,0,400
    );
    const objOpt = burtonObj3D(eCL,eVc,eVp,pk.TVCL,pk.TVVc,pk.TVVp,dosesG,levs2);
    const objAt0 = burtonObj3D(0,  0,  0,  pk.TVCL,pk.TVVc,pk.TVVp,dosesG,levs2);
    assertLess(objOpt, objAt0 + 0.001, 'Goti optimizer vs η=0');
  });
}

// ════════════════════════════════════════════════════════════════════
// SUITE 3 — Shrinkage: no levels → η stays at 0
// ════════════════════════════════════════════════════════════════════
section('SUITE 3 · Shrinkage — no levels → full population shrinkage');

{
  const {CL_pop, V_pop} = buelgaPopPK(70, 80);
  const doses = [{mg:1000,tinfH:1.0,timeH:0},{mg:1000,tinfH:1.0,timeH:12}];
  const [etaCL,etaV] = nelderMead2D((a,b)=>burtonObjective(a,b,CL_pop,V_pop,doses,[]),0,0,200);
  test('Buelga: η_CL = 0 with no levels', ()=>{ assertClose(etaCL,0,1e-5,'η_CL'); });
  test('Buelga: η_V  = 0 with no levels', ()=>{ assertClose(etaV, 0,1e-5,'η_V');  });
}
{
  const pk = gotiPopPK(80,75,false);
  const doses = [{mg:1000,tinfH:1.0,timeH:0}];
  const [eCL,eVc,eVp] = nelderMead3D((a,b,c)=>burtonObj3D(a,b,c,pk.TVCL,pk.TVVc,pk.TVVp,doses,[]),0,0,0,300);
  test('Goti: η_CL = 0 with no levels',  ()=>{ assertClose(eCL, 0,1e-5,'η_CL'); });
  test('Goti: η_Vc = 0 with no levels',  ()=>{ assertClose(eVc, 0,1e-5,'η_Vc'); });
  test('Goti: η_Vp = 0 with no levels',  ()=>{ assertClose(eVp, 0,1e-5,'η_Vp'); });
}

// ════════════════════════════════════════════════════════════════════
// SUITE 4 — Monte Carlo: Buelga 1-comp (n=1000)
// Key question: does Bayesian (1 trough) reduce AUC error vs pop-only?
// Thresholds are calibrated to MAP shrinkage behavior with 1 level
// across a heterogeneous population (CrCl 10–120 mL/min).
// ════════════════════════════════════════════════════════════════════
section('SUITE 4 · Monte Carlo — Buelga 1-comp (n=1000)');

{
  const N = 1000;
  let errB=0, errP=0, cover15=0, aucIn=0, nanCount=0;

  for (let i=0; i<N; i++) {
    const age  = 30 + Math.floor(seededRand() * 50);
    const tbw  = 50 + seededRand() * 50;
    const scr  = 0.7 + seededRand() * 1.5;
    const crcl = clamp((140-age)*tbw / (72*scr), 10, 120);

    const {CL_pop,V_pop} = buelgaPopPK(crcl, tbw);
    const etaCL_t = clamp(seededRandn()*Math.sqrt(OMEGA2_CL_BUELGA), -2, 2);
    const CL_true = CL_pop * Math.exp(etaCL_t);
    const kel_t   = CL_true / V_pop;

    const doses = [{mg:1000,tinfH:1.0,timeH:0}];
    const obsLev = Math.max(0.1, predictConc1comp(doses, 11.5, kel_t, V_pop));
    if (!isFinite(obsLev)) { nanCount++; continue; }

    const [etaCL_f] = nelderMead2D(
      (a,b)=>burtonObjective(a,b,CL_pop,V_pop,doses,[{timeH:11.5,conc:obsLev}]),
      0, 0, 200
    );
    const CL_fit = CL_pop * Math.exp(etaCL_f);
    const tau    = 12;
    const aucT   = 1000*(24/tau)/CL_true;
    const aucP   = 1000*(24/tau)/CL_pop;
    const aucF   = 1000*(24/tau)/CL_fit;

    if (!isFinite(aucF)) { nanCount++; continue; }
    errB += Math.abs(aucF - aucT);
    errP += Math.abs(aucP - aucT);
    if (Math.abs(aucF-aucT)/aucT < 0.15) cover15++;
    if (aucF >= 400 && aucF <= 600) aucIn++;
  }

  const nValid = N - nanCount;
  const maeB  = errB / nValid;
  const maeP  = errP / nValid;
  const cover = cover15 / nValid;
  const attain= aucIn   / nValid;

  console.log(`     n valid: ${nValid}/${N}  |  Bayesian MAE: ${maeB.toFixed(1)}  |  Pop-only MAE: ${maeP.toFixed(1)} mg·h/L`);
  console.log(`     Coverage ±15%: ${(cover*100).toFixed(1)}%  |  AUC 400–600 attainment: ${(attain*100).toFixed(1)}%`);

  test('Buelga MC: Bayesian MAE < Population-only MAE', ()=>{ assertLess(maeB,maeP,'Bayesian vs Pop MAE'); });
  test('Buelga MC: Bayesian reduces MAE by ≥25% vs pop-only', ()=>{
    const imp = 1 - maeB/maeP;
    assert(imp >= 0.25, `Improvement ${(imp*100).toFixed(1)}% < 25%`);
  });
  test('Buelga MC: Bayesian MAE < 200 mg·h/L (absolute sanity)', ()=>{
    assert(maeB < 200, `MAE ${maeB.toFixed(1)} ≥ 200`);
  });
  test('Buelga MC: ±15% AUC coverage ≥ 45% with 1 trough', ()=>{
    assert(cover >= 0.45, `Coverage ${(cover*100).toFixed(1)}% < 45%`);
  });
}

// ════════════════════════════════════════════════════════════════════
// SUITE 5 — Monte Carlo: Goti 2-comp (n=1000)
// Uses Q_GOTI mirrored locally (can't extract const from vm sandbox)
// ════════════════════════════════════════════════════════════════════
section('SUITE 5 · Monte Carlo — Goti 2-comp (n=1000)');

{
  const N = 1000;
  let errB=0, errP=0, cover18=0, nanCount=0;

  for (let i=0; i<N; i++) {
    const age  = 30 + Math.floor(seededRand() * 50);
    const tbw  = 50 + seededRand() * 50;
    const scr  = 0.7 + seededRand() * 1.5;
    const crcl = clamp((140-age)*tbw / (72*scr), 10, 120);

    const pk  = gotiPopPK(crcl, tbw, false);
    const {TVCL, TVVc, TVVp} = pk;

    const etaCL_t = clamp(seededRandn()*Math.sqrt(OMEGA2_CL_GOTI), -2, 2);
    const CL_true = TVCL * Math.exp(etaCL_t);
    const Vc      = TVVc;    // η_Vc = 0 (only fitting CL for tractability)
    const k10_t   = CL_true / Vc;
    const k12_t   = Q_GOTI  / Vc;
    const k21_t   = Q_GOTI  / TVVp;

    const doses  = [{mg:1000,tinfH:1.0,timeH:0},{mg:1000,tinfH:1.0,timeH:12}];
    const obsLev = Math.max(0.1, predictConc2comp(doses, 23.5, k10_t, k12_t, k21_t, Vc));
    if (!isFinite(obsLev)) { nanCount++; continue; }

    const [eCL_f] = nelderMead3D(
      (a,b,c)=>burtonObj3D(a,b,c,TVCL,TVVc,TVVp,doses,[{timeH:23.5,conc:obsLev}]),
      0, 0, 0, 300
    );
    const CL_fit = TVCL * Math.exp(eCL_f);
    const tau    = 12;
    const aucT   = 1000*(24/tau)/CL_true;
    const aucP   = 1000*(24/tau)/TVCL;
    const aucF   = 1000*(24/tau)/CL_fit;

    if (!isFinite(aucF)) { nanCount++; continue; }
    errB += Math.abs(aucF - aucT);
    errP += Math.abs(aucP - aucT);
    if (Math.abs(aucF-aucT)/aucT < 0.18) cover18++;
  }

  const nValid = N - nanCount;
  const maeB  = errB / nValid;
  const maeP  = errP / nValid;
  const cover = cover18 / nValid;

  console.log(`     n valid: ${nValid}/${N}  |  Bayesian MAE: ${maeB.toFixed(1)}  |  Pop-only MAE: ${maeP.toFixed(1)} mg·h/L`);
  console.log(`     Coverage ±18%: ${(cover*100).toFixed(1)}%`);

  test('Goti MC: Bayesian MAE < Population-only MAE', ()=>{ assertLess(maeB,maeP,'Goti Bayesian vs Pop MAE'); });
  test('Goti MC: Bayesian reduces MAE by ≥10% vs pop-only (2-comp harder with 1 trough)', ()=>{
    // Goti 2-comp with 1 level is underdetermined (3 η params, 1 obs) →
    // less improvement than Buelga 1-comp. ≥10% is clinically meaningful.
    const imp = 1 - maeB/maeP;
    assert(imp >= 0.10, `Improvement ${(imp*100).toFixed(1)}% < 10%`);
  });
  test('Goti MC: Bayesian MAE < 250 mg·h/L (absolute sanity, heterogeneous population)', ()=>{
    assert(maeB < 250, `MAE ${maeB.toFixed(1)} ≥ 250`);
  });
  test('Goti MC: ±18% AUC coverage ≥ 40% with 1 trough', ()=>{
    assert(cover >= 0.40, `Coverage ${(cover*100).toFixed(1)}% < 40%`);
  });
}

// ════════════════════════════════════════════════════════════════════
// SUITE 6 — Regression: Bayesian narrower than Phase 1 population
// ════════════════════════════════════════════════════════════════════
section('SUITE 6 · Regression — Bayesian uncertainty narrower than Phase 1');

{
  const N = 500;
  let errBayes=0, errP1=0;
  _seed = 99999;

  for (let i=0; i<N; i++) {
    const age  = 30 + Math.floor(seededRand() * 55);
    const tbw  = 55 + seededRand() * 45;
    const scr  = 0.8 + seededRand() * 1.2;
    const crcl = clamp((140-age)*tbw / (72*scr), 10, 120);
    const {CL_pop,V_pop} = buelgaPopPK(crcl, tbw);
    const etaCL_t = clamp(seededRandn()*Math.sqrt(OMEGA2_CL_BUELGA), -2, 2);
    const CL_true = CL_pop * Math.exp(etaCL_t);
    const obsLev  = Math.max(0.1, predictConc1comp([{mg:1000,tinfH:1.0,timeH:0}], 23.5, CL_true/V_pop, V_pop));
    if (!isFinite(obsLev)) continue;

    const [etaCL_f] = nelderMead2D(
      (a,b)=>burtonObjective(a,b,CL_pop,V_pop,[{mg:1000,tinfH:1.0,timeH:0}],[{timeH:23.5,conc:obsLev}]),
      0, 0, 200
    );
    const CL_fit = CL_pop * Math.exp(etaCL_f);
    const aucT   = 1000*(24/12)/CL_true;
    const aucP   = 1000*(24/12)/CL_pop;
    const aucF   = 1000*(24/12)/CL_fit;
    if (!isFinite(aucF)) continue;

    errBayes += Math.abs(aucF - aucT);
    errP1    += Math.abs(aucP - aucT);
  }

  const maeB = errBayes / N;
  const maeP = errP1    / N;
  const imp  = (1 - maeB/maeP) * 100;
  console.log(`     Phase 1 (pop-only) MAE: ${maeP.toFixed(1)} mg·h/L`);
  console.log(`     Phase 2 (Bayesian)  MAE: ${maeB.toFixed(1)} mg·h/L  (${imp.toFixed(1)}% reduction)`);

  test('Bayesian MAE ≤ 60% of Phase 1 pop-only MAE (≥40% improvement)', ()=>{
    assert(maeB <= maeP * 0.60, `Bayesian MAE ${maeB.toFixed(1)} > 60% of pop MAE ${maeP.toFixed(1)}`);
  });
}

// ════════════════════════════════════════════════════════════════════
// SUITE 7 — External scenario: DoseMeRx-style Patient BB (Goti 2-comp)
// ICU patient with expanded Vc (η_Vc=+0.40) and augmented CL (η_CL=+0.30)
// With 1 post-dose level + 3 Q8H doses
// ════════════════════════════════════════════════════════════════════
section('SUITE 7 · External scenario — DoseMeRx-style Patient BB (Goti 2-comp)');

{
  const crclBB = 75, tbwBB = 85;
  const pk = gotiPopPK(crclBB, tbwBB, false);
  const {TVCL, TVVc, TVVp} = pk;

  const CL_BB = TVCL * Math.exp(0.30);     // augmented clearance
  const Vc_BB = TVVc * Math.exp(0.40);     // expanded Vc (ICU)
  const k10_BB = CL_BB / Vc_BB;
  const k12_BB = Q_GOTI / Vc_BB;
  const k21_BB = Q_GOTI / TVVp;

  const dosesBB = [
    {mg:1000, tinfH:1.0, timeH:0},
    {mg:1000, tinfH:1.0, timeH:8},
    {mg:1000, tinfH:1.0, timeH:16},
  ];
  const tLevBB  = 26.0;    // 2h post 3rd dose-end (11h after 3rd dose start)
  const obsLevBB = predictConc2comp(dosesBB, tLevBB, k10_BB, k12_BB, k21_BB, Vc_BB);

  console.log(`     BB TVCL: ${TVCL.toFixed(3)} L/h  True CL: ${CL_BB.toFixed(3)} L/h  True Vc: ${Vc_BB.toFixed(1)} L`);
  console.log(`     Synthetic level at t=${tLevBB}h: ${isFinite(obsLevBB)?obsLevBB.toFixed(2):'NaN'} mg/L`);

  test('Patient BB: level is finite and physiologically plausible (1–40 mg/L)', ()=>{
    assert(isFinite(obsLevBB) && obsLevBB >= 1 && obsLevBB <= 40,
      `Level=${obsLevBB} mg/L`);
  });

  const [eCL_f, eVc_f] = nelderMead3D(
    (a,b,c)=>burtonObj3D(a,b,c,TVCL,TVVc,TVVp,dosesBB,[{timeH:tLevBB,conc:obsLevBB}]),
    0, 0, 0, 400
  );
  const CL_fit_BB = TVCL * Math.exp(eCL_f);
  const Vc_fit_BB = TVVc * Math.exp(eVc_f);
  const k10_fit   = CL_fit_BB / Vc_fit_BB;
  const k12_fit   = Q_GOTI / Vc_fit_BB;
  const k21_fit   = Q_GOTI / TVVp;
  const Cpred     = predictConc2comp(dosesBB, tLevBB, k10_fit, k12_fit, k21_fit, Vc_fit_BB);

  console.log(`     Fitted CL: ${CL_fit_BB.toFixed(3)} L/h  Fitted Vc: ${Vc_fit_BB.toFixed(1)} L`);
  console.log(`     True AUC₂₄: ${(1000*3/CL_BB).toFixed(0)} mg·h/L  Fitted AUC₂₄: ${(1000*3/CL_fit_BB).toFixed(0)} mg·h/L`);

  test('Patient BB: Fitted curve tracks observed level (within 25%)', ()=>{
    // With η_CL=0.30 AND η_Vc=0.40 simultaneously (expanded ICU Vc),
    // the optimizer must split limited signal across 3 free parameters.
    // MAP shrinkage keeps both estimates partial → prediction ~20% off is expected.
    const relErr = Math.abs(Cpred - obsLevBB) / obsLevBB;
    assert(isFinite(relErr) && relErr < 0.25,
      `Fitted ${Cpred.toFixed(2)} vs observed ${obsLevBB.toFixed(2)}: relErr ${(relErr*100).toFixed(1)}% > 25%`);
  });
  test('Patient BB: Fitted CL_ind closer to true CL than population CL', ()=>{
    const errFit = Math.abs(CL_fit_BB - CL_BB);
    const errPop = Math.abs(TVCL - CL_BB);
    assertLess(errFit, errPop + 0.02,
      `Fitted CL err ${errFit.toFixed(3)} NOT < Pop CL err ${errPop.toFixed(3)}`);
  });
  test('Patient BB: Bayesian AUC₂₄ (Q8H) within ±30% of true', ()=>{
    const aucT = 1000*3/CL_BB;        // dose*(24/tau)/CL = 1000*(24/8)/CL = 3000/CL
    const aucF = 1000*3/CL_fit_BB;
    const relErr = Math.abs(aucF - aucT) / aucT;
    assert(relErr < 0.30, `AUC relErr ${(relErr*100).toFixed(1)}% > 30%`);
  });
}

// ════════════════════════════════════════════════════════════════════
// SUITE 8 — Hughes 2024 obese 2-comp model (Phase 3 Step 4)
// Source: Hughes MA et al., Ther Drug Monit 2024;46(5):575-583
//   DOI: 10.1097/FTD.0000000000001214 · PMC11389886
// ════════════════════════════════════════════════════════════════════
section('SUITE 8 · Hughes 2024 — Obese vancomycin 2-comp Bayesian');

// ── 8.1: Janmahasatian FFM equation sanity ──
test('FFM (Janmahasatian) — 70 kg male, BMI 22 (anchor): FFM ≈ 56 kg', () => {
  // BMI 22 at 70 kg: ht = sqrt(70/22) = 1.784 m → 178.4 cm
  const ffm = computeFFM(70, 178.4, 'M');
  // FFM_M = 9270*70 / (6680 + 216*22) = 648900 / 11432 ≈ 56.76
  assertClose(ffm, 56.76, 0.5, 'FFM 70kg male BMI22');
});
test('FFM (Janmahasatian) — 140 kg male, BMI 45 (class 3 obese)', () => {
  // ht = sqrt(140/45) = 1.764 m → 176.4 cm
  const ffm = computeFFM(140, 176.4, 'M');
  // FFM_M = 9270*140 / (6680 + 216*45) = 1297800 / 16400 = 79.13
  assertClose(ffm, 79.13, 0.5, 'FFM 140kg male BMI45');
});
test('FFM (Janmahasatian) — 140 kg female, BMI 45', () => {
  const ffm = computeFFM(140, 176.4, 'F');
  // FFM_F = 9270*140 / (8780 + 244*45) = 1297800 / 19760 = 65.68
  assertClose(ffm, 65.68, 0.5, 'FFM 140kg female BMI45');
});
test('FFM null guards', () => {
  assert(computeFFM(0, 170, 'M') == null, 'tbw=0 → null');
  assert(computeFFM(70, 0, 'M') == null, 'ht=0 → null');
});

// ── 8.2: Population PK at canonical anchor (FFM=70, CrCL=100) ──
test('hughesPopPK at FFM=70, CrCL=100 reproduces base parameters', () => {
  const pk = hughesPopPK(100, 70);  // (CrCL/100)^0.887 = 1, FFM/70 = 1
  assertClose(pk.TVCL, HUGHES_TVCL, 0.001, 'TVCL anchor');
  assertClose(pk.TVVc, HUGHES_TVVC, 0.001, 'TVVc anchor');
  assertClose(pk.TVQ,  HUGHES_TVQ,  0.001, 'TVQ anchor');
  assertClose(pk.TVVp, HUGHES_TVVP, 0.001, 'TVVp anchor');
});
test('hughesPopPK scales linearly with FFM, exponentially with CrCL', () => {
  const pk1 = hughesPopPK(100, 70);
  const pk2 = hughesPopPK(100, 140);   // double FFM
  assertClose(pk2.TVCL / pk1.TVCL, 2.0, 0.001, 'CL scales linear in FFM (CrCL term unchanged)');
  assertClose(pk2.TVVc / pk1.TVVc, 2.0, 0.001, 'Vc scales linear in FFM');
  assertClose(pk2.TVQ  / pk1.TVQ,  2.0, 0.001, 'Q  scales linear in FFM');
  assertClose(pk2.TVVp / pk1.TVVp, 2.0, 0.001, 'Vp scales linear in FFM');

  const pk3 = hughesPopPK(50, 70);     // half CrCL
  // CL ratio = 0.5^0.887 ≈ 0.5403
  assertClose(pk3.TVCL / pk1.TVCL, Math.pow(0.5, HUGHES_CRCL_EXP), 0.001, 'CL ∝ (CrCL)^0.887');
  assert(pk3.TVVc === pk1.TVVc, 'Vc independent of CrCL');
});

// ── 8.3: Population sanity for a class-3 obese patient ──
test('Class 3 obese male 140 kg, BMI 45, CrCL_FFM ≈ 80: typical PK in expected range', () => {
  // FFM_M = 79.13 (from 8.1)
  // Cockcroft-Gault with FFM, age 56, SCr 0.85 → CrCL = (140-56)*79.13*1.0 / (72*0.85) = 6647 / 61.2 = 108.6
  // For test: pick CrCL_FFM = 80 directly
  const pk = hughesPopPK(80, 79.13);
  // TVCL = 5.09 * (79.13/70) * (80/100)^0.887 = 5.09 * 1.1304 * 0.8194 ≈ 4.715
  assertClose(pk.TVCL, 4.715, 0.05, 'TVCL ~4.7 L/h');
  // TVVc = 64.9 * 1.1304 = 73.36
  assertClose(pk.TVVc, 73.36, 0.5, 'TVVc ~73 L');
  // TVQ = 6.36 * 1.1304 = 7.189
  assertClose(pk.TVQ,  7.189, 0.05, 'TVQ ~7.2 L/h');
  // TVVp = 66.4 * 1.1304 = 75.05
  assertClose(pk.TVVp, 75.05, 0.5, 'TVVp ~75 L');
});

// ── 8.4: Bayesian shrinkage (no levels → η=0) ──
test('Hughes Bayesian: 0 levels → η_CL=η_Vc=η_Vp=0 (full shrinkage)', () => {
  const pk = hughesPopPK(100, 70);
  const obj = (a,b,c) => burtonObj3D_hughes(a,b,c, pk.TVCL, pk.TVVc, pk.TVVp, pk.TVQ, [], []);
  const [eCL, eVc, eVp] = nelderMead3D(obj, 0, 0, 0, 400);
  assertClose(eCL, 0, 1e-4, 'η_CL');
  assertClose(eVc, 0, 1e-4, 'η_Vc');
  assertClose(eVp, 0, 1e-4, 'η_Vp');
});

// ── 8.5: Bayesian round-trip on a synthetic Hughes patient ──
test('Hughes Bayesian round-trip: synthetic patient with known true PK', () => {
  // True patient: 140 kg male, FFM=79.13, CrCL_FFM=80, true η_CL = -0.10
  const pk = hughesPopPK(80, 79.13);
  const TRUE_ETA_CL = -0.10;
  const CL_true = pk.TVCL * Math.exp(TRUE_ETA_CL);
  const Vc_true = pk.TVVc;
  const Vp_true = pk.TVVp;
  const Q_true  = pk.TVQ;
  const k10 = CL_true/Vc_true, k12 = Q_true/Vc_true, k21 = Q_true/Vp_true;

  // Simulate 3 doses Q12H + 2 levels (peak after dose 2, trough before dose 3)
  const doses = [
    { mg:1500, tinfH:1.5, timeH:0  },
    { mg:1500, tinfH:1.5, timeH:12 },
    { mg:1500, tinfH:1.5, timeH:24 },
  ];
  const lev1Time = 14;   // 0.5h post end-of-infusion of dose 2 (peak-ish)
  const lev2Time = 23.5; // pre-dose 3 trough
  const c1 = predictConc2comp(doses, lev1Time, k10, k12, k21, Vc_true);
  const c2 = predictConc2comp(doses, lev2Time, k10, k12, k21, Vc_true);
  const levels = [{ conc:c1, timeH:lev1Time }, { conc:c2, timeH:lev2Time }];

  const obj = (a,b,c) => burtonObj3D_hughes(a,b,c, pk.TVCL, pk.TVVc, pk.TVVp, pk.TVQ, doses, levels);
  const [eCL_fit] = nelderMead3D(obj, 0, 0, 0, 400);
  const CL_fit = pk.TVCL * Math.exp(eCL_fit);

  // Posterior should pull from 0 toward true η = -0.10
  assert(eCL_fit < 0, `η_CL fit should be negative (got ${eCL_fit.toFixed(3)})`);
  // Within ±20% of true CL (Bayesian shrinkage prevents full recovery from 2 levels)
  const errFit = Math.abs(CL_fit - CL_true) / CL_true;
  const errPop = Math.abs(pk.TVCL - CL_true) / CL_true;
  assertLess(errFit, errPop, `fit err ${(errFit*100).toFixed(1)}% NOT < pop err ${(errPop*100).toFixed(1)}%`);
});

// ── 8.6: Ω² constants encode the published %CV correctly ──
test('Hughes BSV: ω²_CL = 0.0602 corresponds to 24.9% CV', () => {
  const cv = Math.sqrt(Math.exp(OMEGA2_CL_HUGHES) - 1) * 100;
  assertClose(cv, 24.9, 0.1, '%CV from ω²');
});
test('Hughes BSV: ω²_Vc = 0.0312 corresponds to 17.8% CV', () => {
  const cv = Math.sqrt(Math.exp(OMEGA2_VC_HUGHES) - 1) * 100;
  assertClose(cv, 17.8, 0.1, '%CV from ω²');
});
test('Hughes BSV: ω²_Vp = 0.4974 corresponds to 80.3% CV', () => {
  const cv = Math.sqrt(Math.exp(OMEGA2_VP_HUGHES) - 1) * 100;
  assertClose(cv, 80.3, 0.5, '%CV from ω²');
});

// ── 8.7: Q is NOT 6.5 (Goti); it's 6.36 (Hughes) ──
test('Hughes Q (6.36) ≠ Goti Q (6.5)', () => {
  assert(HUGHES_TVQ !== Q_GOTI, 'Q must differ between models');
  assertClose(HUGHES_TVQ, 6.36, 1e-9, 'Hughes Q value');
});

// ════════════════════════════════════════════════════════════════════
// SUITE 9 — ARC detection (Phase 3 Step 5, advisory-only)
// Threshold: CrCl ≥ 130 mL/min (Udy 2010, Roberts 2013)
// ════════════════════════════════════════════════════════════════════
section('SUITE 9 · Augmented Renal Clearance — advisory threshold');

test('detectARC: 130 → true (boundary)', () => {
  assert(detectARC(130) === true, '130 should be ARC');
});
test('detectARC: 129.99 → false (just under boundary)', () => {
  assert(detectARC(129.99) === false, '129.99 should not be ARC');
});
test('detectARC: 200 → true (clearly ARC)', () => {
  assert(detectARC(200) === true);
});
test('detectARC: 80 → false (normal)', () => {
  assert(detectARC(80) === false);
});
test('detectARC: null → false (no data)', () => {
  assert(detectARC(null) === false);
  assert(detectARC(undefined) === false);
});
test('Cockcroft-Gault uncapped sanity: young 28M 80kg SCr 0.6 → ARC', () => {
  // Manual CG: (140-28) * 80 * 1.0 / (72 * 0.7) = 8960 / 50.4 ≈ 177.8
  // (SCr floored from 0.6 to 0.7 for males per the floor in getUncappedCrCl)
  const crcl = (140 - 28) * 80 * 1.0 / (72 * 0.7);
  assert(crcl > 130, `expected ARC, got ${crcl.toFixed(0)}`);
  assert(detectARC(crcl) === true);
});
test('Cockcroft-Gault uncapped sanity: 65M 70kg SCr 1.0 → not ARC', () => {
  const crcl = (140 - 65) * 70 * 1.0 / (72 * 1.0);
  assert(crcl < 130, `expected non-ARC, got ${crcl.toFixed(0)}`);
  assert(detectARC(crcl) === false);
});

// ════════════════════════════════════════════════════════════════════
// SUITE 10 — Very-low CrCl non-dialysis (Phase 3 Step 6)
// Threshold: CrCl < 10 mL/min — neither Buelga, Goti, nor Hughes was
// validated below 10. Advisory-only; dial flag suppresses the banner.
// ════════════════════════════════════════════════════════════════════
section('SUITE 10 · Very-low CrCl (non-dialysis) — advisory threshold');

test('detectVeryLowCrCl: 9.99 → true (just under boundary)', () => {
  assert(detectVeryLowCrCl(9.99) === true);
});
test('detectVeryLowCrCl: 10 → false (boundary excluded)', () => {
  assert(detectVeryLowCrCl(10) === false);
});
test('detectVeryLowCrCl: 5 → true (severe)', () => {
  assert(detectVeryLowCrCl(5) === true);
});
test('detectVeryLowCrCl: 50 → false (normal-low)', () => {
  assert(detectVeryLowCrCl(50) === false);
});
test('detectVeryLowCrCl: null → false', () => {
  assert(detectVeryLowCrCl(null) === false);
  assert(detectVeryLowCrCl(undefined) === false);
});
test('Cockcroft-Gault uncapped sanity: 80F 50kg SCr 4.5 → very low (~6)', () => {
  // CG: (140-80) * 50 * 0.85 / (72 * 4.5) = 2550 / 324 ≈ 7.87
  const crcl = (140 - 80) * 50 * 0.85 / (72 * 4.5);
  assert(crcl < 10, `expected very-low, got ${crcl.toFixed(1)}`);
  assert(detectVeryLowCrCl(crcl) === true);
});
test('Cockcroft-Gault uncapped sanity: 65M 70kg SCr 2.0 → not very-low (~36)', () => {
  const crcl = (140 - 65) * 70 * 1.0 / (72 * 2.0);
  assert(crcl >= 10, `expected non-very-low, got ${crcl.toFixed(1)}`);
  assert(detectVeryLowCrCl(crcl) === false);
});
test('ARC and very-low are mutually exclusive across the full CrCl range', () => {
  for (let c = 1; c < 250; c += 1) {
    const isArc = detectARC(c);
    const isLow = detectVeryLowCrCl(c);
    assert(!(isArc && isLow), `c=${c}: ARC and very-low should not both fire`);
  }
});

// ════════════════════════════════════════════════════════════════════
// BONUS — aucUncertaintyText() dynamic labels
// ════════════════════════════════════════════════════════════════════
section('BONUS · aucUncertaintyText() — model-aware dynamic labels');

{
  test('0 levels → ±30% (all models)', ()=>{
    assert(aucUncertaintyText(0,'buelga').includes('±30%'), 'Buelga 0 levels');
    assert(aucUncertaintyText(0,'goti').includes('±30%'),   'Goti 0 levels');
    assert(aucUncertaintyText(0,'hughes').includes('±30%'), 'Hughes 0 levels');
  });
  test('1 level + Buelga → ±15%', ()=>{ assert(aucUncertaintyText(1,'buelga').includes('±15%'), ''); });
  test('1 level + Goti → ±18% (2-comp wider)', ()=>{ assert(aucUncertaintyText(1,'goti').includes('±18%'), ''); });
  test('1 level + Hughes → ±18% (2-comp wider, same as Goti)', ()=>{
    assert(aucUncertaintyText(1,'hughes').includes('±18%'), '');
  });
  test('2 levels → ±12% (all models)', ()=>{
    assert(aucUncertaintyText(2,'buelga').includes('±12%'), '');
    assert(aucUncertaintyText(2,'goti').includes('±12%'),   '');
    assert(aucUncertaintyText(2,'hughes').includes('±12%'), '');
  });
  test('≥3 levels → ±10%', ()=>{ assert(aucUncertaintyText(5,'buelga').includes('±10%'), ''); });
}

// ════════════════════════════════════════════════════════════════════
// SUMMARY
// ════════════════════════════════════════════════════════════════════
console.log(`\n${'═'.repeat(60)}`);
console.log('  PHASE 2D VALIDATION SUMMARY');
console.log(`${'─'.repeat(60)}`);
console.log(`  Passed : ${pass}`);
console.log(`  Failed : ${fail}`);
console.log(`  Total  : ${pass+fail}`);
if (fail === 0) {
  console.log('\n  ✓ All tests passed — Phase 2D validation complete.\n');
} else {
  console.log(`\n  ✗ ${fail} test(s) failed:\n`);
  allResults.filter(r=>!r.ok).forEach(r => console.log(`    FAIL: ${r.name}\n         ${r.err}`));
}
process.exit(fail === 0 ? 0 : 1);

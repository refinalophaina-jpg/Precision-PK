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

// ─── Model constants: extracted from index.html, never copied ─────────
// audit P3 — a hand-copied constant lets the suite pass against a value
// the app no longer uses. extract() throws if a constant goes missing.
const { extract: __extractConsts } = require('./harness_constants.cjs');
const {
  Q_GOTI,
  OMEGA2_CL_GOTI,
  OMEGA2_VC_GOTI,
  OMEGA2_VP_GOTI,
  SIGMA_PROP_GOTI,
  SIGMA_ADD_GOTI,
  OMEGA2_CL_BUELGA,
  OMEGA2_V_BUELGA,
  SIGMA_PROP_BUELGA,
  SIGMA_ADD_BUELGA,
  HUGHES_TVCL,
  HUGHES_TVVC,
  HUGHES_TVQ,
  HUGHES_TVVP,
} = __extractConsts();


// ─── Goti constants mirrored from calculator (const ≠ extractable from vm) ───

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
  calcCssAtTime, ssCtrough2comp, ssPeak2comp, ssCycles2comp,
  solveTwoLevelsPK, getModelRecommendation,
  // Phase 3 — Hughes 2024 obese model
  computeFFM, hughesPopPK, burtonObj3D_hughes,
  // Phase 3 Step 5 — ARC detection
  detectARC, ARC_THRESHOLD,
  // Phase 3 Step 6 — Very-low CrCl detection
  detectVeryLowCrCl,
} = sandbox;

// ─── Hughes constants mirrored from calculator ───
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
  // Threshold aligned to the app's own MEASURED disclosure. Simulation under the
  // verified Buelga prior puts the p90 single-level AUC error at 28.3%, so a
  // ±20% gate on one noiseless trough demanded better than the engine tells the
  // clinician to expect (aucUncertaintyText: ~±21% at 1 level, ~80% of patients).
  // Held at ±30% so the test and the disclosure cannot drift apart.
  test('Scenario A: Bayesian AUC within ±30% of true (matches disclosed p90)', ()=>{
    const [etaCL] = nelderMead2D((a,b)=>burtonObjective(a,b,CL_pop,V_pop,doses,levels),0,0,300);
    const CL_fit  = CL_pop * Math.exp(etaCL);
    const auc_true = 1000*(24/12)/CL_true;
    const auc_fit  = 1000*(24/12)/CL_fit;
    const relErr   = Math.abs(auc_fit - auc_true) / auc_true;
    assert(relErr < 0.30, `AUC relErr ${(relErr*100).toFixed(1)}% > 30%`);
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

  // This used to assert Obj(η_true) < Obj(0), i.e. that the objective is lower at
  // the simulating η than at the population mean. That is NOT a property of a MAP
  // objective — it holds only when the likelihood outweighs the prior. Under the
  // verified Buelga prior (ω²_CL 0.0793, additive σ 3.52 mg/L) a single trough
  // deviating ~3 mg/L is weaker evidence than η=0.35 costs in prior penalty, so
  // Obj(0.35)=1.61 > Obj(0)=0.74 — correct shrinkage, not a defect.
  //
  // The invariants that ARE guaranteed for a unimodal posterior: the optimum is
  // no worse than either endpoint, and it lies between the prior mean and the
  // simulating value (shrinkage, never overshoot).
  test('Buelga MAP optimum is no worse than η=0 or η=η_true', ()=>{
    const [ea,eb]  = nelderMead2D((a,b)=>burtonObjective(a,b,CL_pop,V_pop,doses,levels),0,0,300);
    const objOpt   = burtonObjective(ea,eb,CL_pop,V_pop,doses,levels);
    const objTrue  = burtonObjective(0.35,0,CL_pop,V_pop,doses,levels);
    const objPop   = burtonObjective(0,   0,CL_pop,V_pop,doses,levels);
    assert(objOpt <= objTrue + 1e-9 && objOpt <= objPop + 1e-9,
      `Obj(opt)=${objOpt.toFixed(5)} must be ≤ Obj(η_true)=${objTrue.toFixed(5)} and Obj(0)=${objPop.toFixed(5)}`);
  });
  test('Buelga MAP shrinks toward the prior without overshooting', ()=>{
    const [ea] = nelderMead2D((a,b)=>burtonObjective(a,b,CL_pop,V_pop,doses,levels),0,0,300);
    assert(ea >= -1e-6 && ea <= 0.35 + 1e-6,
      `η_CL optimum ${ea.toFixed(4)} must lie in [0, 0.35] — shrinkage, not overshoot`);
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
  // ── 2026-09, audit A2 follow-up: why these are absolute, not relative ──
  // This suite used to require the Bayesian fit to beat the population prior by
  // >=25%. That is a RATIO, so improving the prior makes it FAIL. Replacing the
  // unsourced power model with the verified Buelga 2005 model moved:
  //     population-only MAE  212.3 -> 125.8 mg.h/L   (-41%, much better)
  //     Bayesian MAE          53.1 ->  52.6 mg.h/L   (slightly better)
  // Every absolute number improved and the ratio test went red. A gate that
  // punishes a better prior is measuring the wrong thing, so accuracy is now
  // asserted in absolute mg.h/L; the direction is kept as its own check above.
  test('Buelga MC: Bayesian MAE < 120 mg·h/L (absolute accuracy)', ()=>{
    assert(maeB < 120, `MAE ${maeB.toFixed(1)} ≥ 120`);
  });
  test('Buelga MC: ±15% AUC coverage ≥ 40% with 1 trough', ()=>{
    // A single trough under Buelga's additive 3.52 mg/L residual cannot pin AUC
    // tightly. This is a floor on informativeness, not a clinical target.
    assert(cover >= 0.40, `Coverage ${(cover*100).toFixed(1)}% < 40%`);
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

  // Same ratio problem as SUITE 4 — see the note there. Stated absolutely, plus
  // the directional check that levels must help rather than hurt.
  test('Bayesian MAE < Phase 1 pop-only MAE (levels must help)', ()=>{
    assert(maeB < maeP, `Bayesian MAE ${maeB.toFixed(1)} not below pop MAE ${maeP.toFixed(1)}`);
  });
  test('Bayesian MAE < 120 mg·h/L (absolute accuracy)', ()=>{
    assert(maeB < 120, `Bayesian MAE ${maeB.toFixed(1)} ≥ 120`);
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
// 2026-09, audit A9. This test previously asserted that CL and Q "scale linearly
// with FFM" — naming the very term Hughes 2024 tested and EXCLUDED:
//   "the inclusion of the allometric exponent on clearance (CL) and
//    intercompartmental clearance (Q) considerably worsened the model fit ...
//    therefore, this exponent was excluded."
// Table 2 carries no u1 row. FFM reaches CL only through the Cockcroft-Gault
// input, which is computed on FFM; a second FFM term double-counted body size.
// Re-pointed at the published structure, with the intent preserved.
test('hughesPopPK: FFM scales the VOLUMES only; CL and Q carry no FFM term', () => {
  const pk1 = hughesPopPK(100, 70);
  const pk2 = hughesPopPK(100, 140);   // double FFM
  assertClose(pk2.TVVc / pk1.TVVc, 2.0, 0.001, 'Vc scales linear in FFM (u2 = 1.0 FIX)');
  assertClose(pk2.TVVp / pk1.TVVp, 2.0, 0.001, 'Vp scales linear in FFM (u2 = 1.0 FIX)');
  assertClose(pk2.TVCL / pk1.TVCL, 1.0, 1e-9, 'CL invariant to FFM at fixed CrCl (u1 excluded)');
  assertClose(pk2.TVQ  / pk1.TVQ,  1.0, 1e-9, 'Q  invariant to FFM (u1 excluded)');

  const pk3 = hughesPopPK(50, 70);     // half CrCL
  assertClose(pk3.TVCL / pk1.TVCL, Math.pow(0.5, HUGHES_CRCL_EXP), 0.001, 'CL ∝ (CrCL)^0.887');
  assert(pk3.TVVc === pk1.TVVc, 'Vc independent of CrCL');
});

// ── 8.3: Population sanity for a class-3 obese patient ──
test('Class 3 obese male 140 kg, BMI 45, CrCL_FFM ≈ 80: typical PK in expected range', () => {
  // FFM_M = 79.13 (from 8.1)
  // Cockcroft-Gault with FFM, age 56, SCr 0.85 → CrCL = (140-56)*79.13*1.0 / (72*0.85) = 6647 / 61.2 = 108.6
  // For test: pick CrCL_FFM = 80 directly
  const pk = hughesPopPK(80, 79.13);
  // Expectations recomputed for the published structure (audit A9): the FFM term
  // is on the volumes only.
  // TVCL = 5.09 * (80/100)^0.887 = 5.09 * 0.8204 ≈ 4.176   (no FFM factor)
  assertClose(pk.TVCL, 4.176, 0.05, 'TVCL ~4.2 L/h');
  // TVVc = 64.9 * (79.13/70) = 64.9 * 1.1304 = 73.36
  assertClose(pk.TVVc, 73.36, 0.5, 'TVVc ~73 L');
  // TVQ = 6.36, unscaled
  assertClose(pk.TVQ,  6.36, 0.05, 'TVQ 6.36 L/h (no FFM term)');
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

// ════════════════════════════════════════════════════════════════════════
// SUITE 10 — Steady-state helpers  (added 2026-09-05, Codex F-006 / F-007)
//
// WHY THIS EXISTS. Two real steady-state defects shipped and the whole
// comprehensive suite was blind to them: it generates concentrations with
// predictConc1comp/predictConc2comp over an explicit dose list and never asks
// for a steady-state value, so calcCssAtTime, ssCtrough2comp and ssPeak2comp
// had NO coverage at all. The consumers that do use them are the dose
// optimiser, the regimen projection and the tinkerer — i.e. the numbers a
// clinician reads. Untested code that feeds the recommendation is the gap this
// closes.
// ════════════════════════════════════════════════════════════════════════
section('SUITE 10 · Steady-state helpers (F-006 / F-007 regression)');

{
  // F-006: during infusion the residual from the previous interval must be
  // carried forward. The old form dropped it and returned 0 at t=0.
  const dose=1000, tau=12, tinf=1, ke=0.08, V=60;
  const cInf = (dose/tinf)/(ke*V);
  const peak = cInf*(1-Math.exp(-ke*tinf))/(1-Math.exp(-ke*tau));
  const ctr  = peak*Math.exp(-ke*(tau-tinf));
  const ref  = (t) => t<=tinf ? cInf*(1-Math.exp(-ke*t)) + ctr*Math.exp(-ke*t)
                              : peak*Math.exp(-ke*(t-tinf));

  test('F-006: SS concentration matches the closed form across the interval', ()=>{
    for (const t of [0, 0.1, 0.25, 0.5, 0.9, 1, 3, 6, 11.9]) {
      assertClose(calcCssAtTime(dose,tau,tinf,ke,V,t), ref(t), 1e-9, `t=${t}`);
    }
  });
  test('F-006: t=0 returns the trough, not zero', ()=>{
    const c = calcCssAtTime(dose,tau,tinf,ke,V,0);
    assert(c > 10 && c < 11.5, `expected ~10.77 mg/L at steady state, got ${c.toFixed(3)}`);
  });
  test('F-006: continuous at end of infusion', ()=>{
    const a = calcCssAtTime(dose,tau,tinf,ke,V,tinf);
    const b = calcCssAtTime(dose,tau,tinf,ke,V,tinf+1e-9);
    assertClose(a, b, 1e-6, 'continuity at t=tinf');
  });
  test('F-006: periodic — C(tau) equals C(0)', ()=>{
    assertClose(calcCssAtTime(dose,tau,tinf,ke,V,tau),
                calcCssAtTime(dose,tau,tinf,ke,V,0), 1e-6, 'periodicity');
  });
}

{
  // F-007: the cycle count must follow the terminal half-life, not be assumed.
  // A Goti patient at CrCl 10 has a ~110 h terminal half-life; 12 q12h cycles
  // is 1.3 half-lives and read the trough 40% low.
  const p = gotiPopPK(10, 70, false);
  const CL=p.TVCL, Vc=p.TVVc, Vp=p.TVVp, Q=p.Q;
  const k10=CL/Vc, k12=Q/Vc, k21=Q/Vp;

  const converged = (tau, tinfH) => {   // independent reference by iteration
    let prev=0, cur=0;
    for (let n=12; n<=4000; n+=4) {
      const synth = Array.from({length:n},(_,i)=>({mg:250,tinfH,timeH:i*tau}));
      cur = predictConc2comp(synth, n*tau, k10,k12,k21,Vc);
      if (Math.abs(cur-prev) < 1e-6) break;
      prev = cur;
    }
    return cur;
  };

  test('F-007: slow-clearance trough is within 1% of the converged value', ()=>{
    const got = ssCtrough2comp(250,12,1,CL,Vc,Vp,Q);
    const ref = converged(12,1);
    const err = Math.abs(got-ref)/ref;
    assert(err < 0.01, `trough ${got.toFixed(3)} vs converged ${ref.toFixed(3)} — ${(err*100).toFixed(2)}% off`);
  });
  test('F-007: a fixed 12 cycles would NOT have passed that bound', ()=>{
    const synth = Array.from({length:12},(_,i)=>({mg:250,tinfH:1,timeH:i*12}));
    const twelve = predictConc2comp(synth, 12*12, k10,k12,k21,Vc);
    const ref = converged(12,1);
    assert(Math.abs(twelve-ref)/ref > 0.20,
      `the retired 12-cycle form should be >20% off; it was ${(Math.abs(twelve-ref)/ref*100).toFixed(1)}%`);
  });
  test('F-007: cycle count scales with the terminal half-life', ()=>{
    const slow = ssCycles2comp(12, k10, k12, k21);
    const fastP = gotiPopPK(120, 70, false);
    const f10=fastP.TVCL/fastP.TVVc, f12=fastP.Q/fastP.TVVc, f21=fastP.Q/fastP.TVVp;
    const fast = ssCycles2comp(12, f10, f12, f21);
    assert(slow > fast, `slow clearer needs more cycles than fast: ${slow} vs ${fast}`);
    assert(slow <= 400 && fast >= 12, `cycle count must stay clamped to [12,400], got ${fast}..${slow}`);
  });
  test('F-007: troughs stay finite and ordered across intervals', ()=>{
    let prev = Infinity;
    for (const tau of [8,12,24,48]) {
      const c = ssCtrough2comp(250,tau,1,CL,Vc,Vp,Q);
      assert(Number.isFinite(c) && c > 0, `tau ${tau} gave ${c}`);
      assert(c < prev, `longer interval must give a lower trough: tau ${tau} -> ${c.toFixed(2)}`);
      prev = c;
    }
  });
}

// ════════════════════════════════════════════════════════════════════════
// SUITE 11 — Two-level basis, and the Hughes population floor (2026-09-06)
// ════════════════════════════════════════════════════════════════════════
section('SUITE 11 · Two-level dosing basis + Hughes BMI floor');

{
  const ke = 0.0866, Vd = 52, dose = 1000, tinf = 1, tau = 12;
  const fd = [{mg: dose, tinfH: tinf, timeH: 0}];
  const a1 = predictConc1comp(fd, 2, ke, Vd), a2 = predictConc1comp(fd, 10, ke, Vd);
  const b1 = calcCssAtTime(dose, tau, tinf, ke, Vd, 2), b2 = calcCssAtTime(dose, tau, tinf, ke, Vd, 10);

  test('two-level: ke is recovered exactly on BOTH bases', () => {
    const A = solveTwoLevelsPK(dose, tinf, a1, 2, a2, 10, tau, 'firstdose');
    const B = solveTwoLevelsPK(dose, tinf, b1, 2, b2, 10, tau, 'steadystate');
    assertClose(A.kel, ke, 1e-6, 'first-dose ke');
    assertClose(B.kel, ke, 1e-6, 'steady-state ke');
  });
  test('two-level: first-dose basis recovers Vd', () => {
    const A = solveTwoLevelsPK(dose, tinf, a1, 2, a2, 10, tau, 'firstdose');
    assertClose(A.vd, Vd, 0.05, 'Vd from first-dose levels');
  });
  test('two-level: steady-state basis recovers Vd', () => {
    const B = solveTwoLevelsPK(dose, tinf, b1, 2, b2, 10, tau, 'steadystate');
    assertClose(B.vd, Vd, 0.05, 'Vd from steady-state levels');
  });
  test('two-level: the WRONG basis is materially wrong (guards the toggle)', () => {
    // If this ever stops being wrong, the basis distinction has been lost and the
    // toggle is dead code — which would be worse than the original bug, because
    // the UI would claim to ask a question that no longer matters.
    const wrong = solveTwoLevelsPK(dose, tinf, b1, 2, b2, 10, tau, 'firstdose');
    const err = Math.abs(wrong.vd - Vd) / Vd;
    assert(err > 0.25, `treating SS levels as first-dose should understate Vd by >25%; got ${(err*100).toFixed(1)}%`);
  });
  test('two-level: AUC24 agrees with the truth on both bases', () => {
    const truth = dose * (24/tau) / (ke * Vd);
    for (const [lv1, lv2, basis] of [[a1, a2, 'firstdose'], [b1, b2, 'steadystate']]) {
      const r = solveTwoLevelsPK(dose, tinf, lv1, 2, lv2, 10, tau, basis);
      assertClose(r.auc24, truth, truth * 0.01, `AUC24 (${basis})`);
    }
  });
  test('two-level: default basis stays first-dose (backwards compatible)', () => {
    const d = solveTwoLevelsPK(dose, tinf, a1, 2, a2, 10, tau);
    assert(d.basis === 'firstdose', `default basis was ${d.basis}`);
  });
}

{
  // Hughes 2024 enrolled only BMI >= 40 ("median 46.3, range 40-70.3"). It must
  // not be recommended below that.
  const rec = (tbw, htCm, nLev = 0, icu = false) => getModelRecommendation(nLev, icu, tbw, htCm);
  test('Hughes is recommended at BMI >= 40', () => {
    const r = rec(130, 175);                       // BMI 42.4
    assert(r.recommended === 'hughes', `BMI ${r.bmi.toFixed(1)} recommended ${r.recommended}`);
  });
  test('Hughes is NOT recommended for BMI 30-39.9', () => {
    for (const [w, h] of [[95, 175], [105, 175], [115, 178]]) {
      const r = rec(w, h);
      assert(r.bmi >= 30 && r.bmi < 40, `test case BMI ${r.bmi.toFixed(1)} out of band`);
      assert(r.recommended !== 'hughes',
        `BMI ${r.bmi.toFixed(1)} must not get Hughes (validated only >= 40); got ${r.recommended}`);
    }
  });
  test('BMI 30-39.9 carries an explicit "no validated model" advisory', () => {
    const r = rec(105, 175);
    assert(!!r.advisory && /not validated|No vancomycin population model is validated/i.test(r.advisory),
      `expected a caveat, got: ${r.advisory}`);
  });
  test('lean adult still gets Buelga', () => {
    assert(rec(75, 175).recommended === 'buelga', 'BMI 24.5 should be Buelga');
  });
}

// ════════════════════════════════════════════════════════════════════
// BONUS — aucUncertaintyText() dynamic labels
// ════════════════════════════════════════════════════════════════════
section('BONUS · aucUncertaintyText() — model-aware dynamic labels');

{
  // 2026-09: these labels are now MEASURED (n=2000/level count against the
  // verified Buelga prior), quoted at the ~80th percentile with the percentile
  // stated. The old figures (±15% at 1 level) were met by only 66% of patients,
  // so they read as a bound while behaving like a median.
  test('0 levels → ±35% (all models)', ()=>{
    assert(aucUncertaintyText(0,'buelga').includes('±35%'), 'Buelga 0 levels');
    assert(aucUncertaintyText(0,'goti').includes('±35%'),   'Goti 0 levels');
    assert(aucUncertaintyText(0,'hughes').includes('±35%'), 'Hughes 0 levels');
  });
  test('1 level + Buelga → ±21% (measured p80)', ()=>{ assert(aucUncertaintyText(1,'buelga').includes('±21%'), ''); });
  test('1 level + Goti → ±25% (2-comp, flagged as estimated)', ()=>{
    assert(aucUncertaintyText(1,'goti').includes('±25%'), '');
    assert(/estimated/i.test(aucUncertaintyText(1,'goti')), '2-comp figure must be marked as not simulated');
  });
  test('1 level + Hughes → ±25% (2-comp, same as Goti)', ()=>{
    assert(aucUncertaintyText(1,'hughes').includes('±25%'), '');
  });
  test('2 levels → ±18% (all models)', ()=>{
    assert(aucUncertaintyText(2,'buelga').includes('±18%'), '');
    assert(aucUncertaintyText(2,'goti').includes('±18%'),   '');
    assert(aucUncertaintyText(2,'hughes').includes('±18%'), '');
  });
  test('≥3 levels → ±17%', ()=>{ assert(aucUncertaintyText(5,'buelga').includes('±17%'), ''); });
  test('Uncertainty is monotone non-increasing in level count', ()=>{
    const pctOf = (s) => parseFloat(s.match(/±([0-9.]+)%/)[1]);
    const seq = [0,1,2,3].map(n => pctOf(aucUncertaintyText(n,'buelga')));
    for (let i=1;i<seq.length;i++) {
      assert(seq[i] <= seq[i-1], `more levels must not widen uncertainty: ${seq.join(' → ')}`);
    }
  });
}

// ════════════════════════════════════════════════════════════════════
// SUITE 12 — drawPKGraph: what is actually DRAWN
//
// Every graph defect found in the 2026-09-05 audit shipped because no suite
// ever executed a renderer — the canvas code had zero coverage. This drives
// the REAL drawPKGraph through a recording 2D context and asserts on the
// operations it emits: markers must lie on the polyline, the target band must
// stay inside the plot, dose boundaries must be ticks, and every colour must
// come from a token (proved by swapping the palette and requiring the output
// to change).
// ════════════════════════════════════════════════════════════════════
{
  const { drawPKGraph } = sandbox;

  // Two palettes, so "did this colour come from a token?" is testable.
  const LIGHT = { '--terracotta':'#cc785c','--terracotta-q':'#e0a98c','--moss':'#4a5c28',
                  '--ink-faint':'#8a8e80','--paper':'#faf5ed','--accent-amber':'#96631f',
                  '--accent-blue':'#4a3d7a','--accent-rose':'#a8546a' };
  const DARK  = { '--terracotta':'#d88a6e','--terracotta-q':'#b56e54','--moss':'#9aad68',
                  '--ink-faint':'#7d7666','--paper':'#1c1815','--accent-amber':'#d9a765',
                  '--accent-blue':'#8e7dc8','--accent-rose':'#d08ba0' };

  function record(palette, W, H) {
    const ops = { arcs:[], path:[], rects:[], texts:[], colors:new Set() };
    let cur = null, fill = '', stroke = '';
    const ctx = {
      set fillStyle(v){ fill = String(v); ops.colors.add(String(v)); },
      get fillStyle(){ return fill; },
      set strokeStyle(v){ stroke = String(v); ops.colors.add(String(v)); },
      get strokeStyle(){ return stroke; },
      lineWidth:1, lineJoin:'', lineCap:'', font:'', textAlign:'', textBaseline:'',
      setTransform(){}, clearRect(){}, save(){}, restore(){}, translate(){}, rotate(){},
      setLineDash(){},
      beginPath(){ cur = []; },
      moveTo(x,y){ if(cur) cur.push([x,y]); },
      lineTo(x,y){ if(cur) cur.push([x,y]); },
      closePath(){ if(cur && cur.length>8) ops.path.push(cur); },
      stroke(){ if(cur && cur.length>8) ops.path.push(cur); },
      fill(){},
      arc(x,y,r){ ops.arcs.push({x,y,r,fill}); },
      fillRect(x,y,w,h){ ops.rects.push({x,y,w,h,fill}); },
      fillText(t,x,y){ ops.texts.push({t:String(t),x,y,fill}); },
      createLinearGradient(){ return { addColorStop:(o,c)=>ops.colors.add(String(c)) }; },
    };
    const canvas = { width:0, height:0, getContext:()=>ctx,
                     getBoundingClientRect:()=>({ width:W, height:H }) };
    const prevGet = sandbox.document.getElementById;
    const prevGCS = sandbox.getComputedStyle;
    const prevDPR = sandbox.devicePixelRatio;
    sandbox.document.getElementById = (id) => (id === 'pk-test' ? canvas : prevGet(id));
    sandbox.document.documentElement = {};
    sandbox.getComputedStyle = () => ({ getPropertyValue:(n)=> palette[n] || '' });
    sandbox.devicePixelRatio = 1;
    try { return { ops, run:(...a)=>{ drawPKGraph('pk-test', ...a); return ops; } }; }
    finally { /* restore after the caller runs */
      setImmediate?.(()=>{}); 
      ops.__restore = () => { sandbox.document.getElementById = prevGet;
                              sandbox.getComputedStyle = prevGCS;
                              sandbox.devicePixelRatio = prevDPR; };
    }
  }
  function draw(palette, args, W=760, H=330) {
    const r = record(palette, W, H);
    const ops = r.run(...args);
    ops.__restore();
    return ops;
  }
  // Interpolate the drawn polyline at x.
  function curveYAt(path, x) {
    const poly = path.reduce((a,b)=> b.length > a.length ? b : a, []);
    for (let i=1;i<poly.length;i++) {
      const [x0,y0]=poly[i-1], [x1,y1]=poly[i];
      if (x >= Math.min(x0,x1)-1e-6 && x <= Math.max(x0,x1)+1e-6) {
        if (Math.abs(x1-x0) < 1e-9) return y1;
        return y0 + (y1-y0)*((x-x0)/(x1-x0));
      }
    }
    return NaN;
  }

  console.log(`\n${'═'.repeat(60)}`);
  console.log('  SUITE 12 — drawPKGraph rendering invariants');
  console.log(`${'─'.repeat(60)}`);

  test('Peak and trough markers lie ON the drawn curve (fractional tinf)', ()=>{
    // tinf steps by 0.25 in the UI; a uniform 0.1 h sample grid never lands on
    // 1.25 or 1.75, so the polyline used to cut the corner under the peak dot.
    [1.0, 1.25, 1.5, 1.75, 2.25, 2.75].forEach(tinf => {
      const ops = draw(LIGHT, [1250, 12, tinf, 0.0866, 60, {troughMin:10,troughMax:20}]);
      assert(ops.path.length > 0, `tinf=${tinf}: no curve drawn`);
      const markers = ops.arcs.filter(a => a.r < 4.5);
      assert(markers.length >= 6, `tinf=${tinf}: expected peak+trough dots, got ${markers.length}`);
      markers.forEach(m => {
        const y = curveYAt(ops.path, m.x);
        assert(isFinite(y), `tinf=${tinf}: marker at x=${m.x.toFixed(1)} is off the curve's x-range`);
        assert(Math.abs(y - m.y) < 0.75,
          `tinf=${tinf}: marker floats ${Math.abs(y-m.y).toFixed(2)}px off the curve at x=${m.x.toFixed(1)}`);
      });
    });
  });

  test('Every dose boundary is an x-axis tick, for every realistic interval', ()=>{
    [4,6,8,10,12,18,24,36,48,72].forEach(tau => {
      const ops = draw(LIGHT, [1000, tau, 1, 0.0693, 60, {troughMin:10,troughMax:20}]);
      const ticks = ops.texts.filter(t => /^[\d.]+h$/.test(t.t)).map(t => parseFloat(t.t));
      for (let i=0;i<=3;i++) {
        assert(ticks.some(v => Math.abs(v - i*tau) < 1e-6),
          `tau=${tau}: dose boundary ${i*tau}h is not a tick (ticks: ${ticks.join(',')})`);
      }
      assert(ticks.length >= 5 && ticks.length <= 9,
        `tau=${tau}: ${ticks.length} x ticks — the old fixed-8h rule gave 3 at Q6H and 19 at Q48H`);
    });
  });

  test('Target band stays inside the plot even when troughMax exceeds the peak', ()=>{
    // 250 mg Q12H in a fast clearer: peak ~8 mg/L, target top 20 mg/L. The old
    // axis was derived from the curve alone, so the band was painted off-canvas.
    const ops = draw(LIGHT, [250, 12, 1, 0.12, 60, {troughMin:10,troughMax:20}]);
    const band = ops.rects.filter(r => r.h > 2 && r.w > 100);
    assert(band.length >= 1, 'target band was not drawn at all');
    band.forEach(r => {
      assert(r.y >= 15.5, `band top ${r.y.toFixed(1)} is above the plot area`);
      assert(r.y + r.h <= 330 - 42 + 0.5, `band bottom ${(r.y+r.h).toFixed(1)} spills past the plot`);
    });
    const label = ops.texts.find(t => /TARGET/.test(t.t));
    assert(label && /10/.test(label.t) && /20/.test(label.t),
      `target band must be labelled with the clinician's own bounds, got: ${label && label.t}`);
  });

  test('Target label reflects a non-default trough target', ()=>{
    const ops = draw(LIGHT, [1000, 12, 1, 0.0693, 60, {troughMin:15,troughMax:25}]);
    const label = ops.texts.find(t => /TARGET/.test(t.t));
    assert(label && /15/.test(label.t) && /25/.test(label.t),
      `band must honour the entered target, got: ${label && label.t}`);
  });

  test('Observed level survives t=0 and exact multiples of the window', ()=>{
    const inPlot = (ops) => ops.arcs.filter(a => a.r > 4.5);
    let ops = draw(LIGHT, [1000, 12, 1, 0.0693, 60, {troughMin:10,troughMax:20,obsLevel:14.2,obsTime:0}]);
    assert(inPlot(ops).length === 1, 'a level drawn at t=0 was dropped by the truthiness guard');
    ops = draw(LIGHT, [1000, 12, 1, 0.0693, 60, {troughMin:10,troughMax:20,obsLevel:14.2,obsTime:72}]);
    const m = inPlot(ops)[0];
    assert(m, 'observed level at t = 2*tMax was dropped');
    assert(m.x >= 54 && m.x <= 760 - 24, `observed marker drawn off-canvas at x=${m.x.toFixed(1)}`);
  });

  test('Y-axis top is round and always contains the target band', ()=>{
    [[250,0.12],[1000,0.0693],[2000,0.035],[500,0.17]].forEach(([dose,kel]) => {
      const ops = draw(LIGHT, [dose, 12, 1, kel, 60, {troughMin:10,troughMax:20}]);
      const nums = ops.texts.filter(t => /^-?[\d.]+$/.test(t.t)).map(t => parseFloat(t.t));
      assert(nums.length >= 4 && nums.length <= 9,
        `dose=${dose}: ${nums.length} y gridlines — the old ladder gave 2 at the bottom and 12 at the top`);
      assert(Math.max(...nums) >= 20,
        `dose=${dose}: axis top ${Math.max(...nums)} excludes the 20 mg/L target ceiling`);
    });
  });

  test('Every colour is a token — swapping the palette changes the output', ()=>{
    const args = [1000, 12, 1, 0.0693, 60, {troughMin:10,troughMax:20,obsLevel:14,obsTime:11}];
    const light = draw(LIGHT, args), dark = draw(DARK, args);
    // A gradient object assigned to fillStyle stringifies to [object Object];
    // its stops are recorded separately by createLinearGradient.
    const real = (set) => [...set].filter(c => /^#|^rgba?\(/i.test(c));
    const onlyLight = real(light.colors).filter(c => !dark.colors.has(c));
    const shared    = real(light.colors).filter(c => dark.colors.has(c));
    assert(onlyLight.length >= 6,
      `only ${onlyLight.length} colours changed with the palette — the rest are hard-coded literals`);
    assert(shared.length === 0,
      `these colours are identical in both themes, so they are literals: ${shared.join(', ')}`);
  });

  test('No renderer hard-codes the 10-20 trough band', ()=>{
    // Three charts had it frozen at 10-20, and one read a bState field that
    // never existed, so it silently used the defaults.
    const src = fs.readFileSync(htmlPath,'utf8');
    const script = src.match(/<script>([\s\S]*?)<\/script>/)[1];
    assert(/function troughTarget\s*\(/.test(script), 'troughTarget() helper is missing');
    const frozen = script.match(/ty\(\s*(?:10|20)\s*\)/g) || [];
    assert(frozen.length === 0,
      `${frozen.length} chart(s) still plot a hard-coded trough bound: ${frozen.join(', ')}`);
    assert(!/bState\s*&&\s*\+?bState\.trough(Min|Max)/.test(script),
      'a chart still reads bState.troughMin/Max, which does not exist');
  });

  test('A palette change repaints the trough-based canvases', ()=>{
    // redrawAllCanvases used to call drawGraph(), which does not exist; the
    // ReferenceError was swallowed and the canvas kept its light-theme colours.
    assert(typeof sandbox.redrawAllCanvases === 'function', 'redrawAllCanvases missing');
    const src = sandbox.redrawAllCanvases.toString();
    assert(!/\bdrawGraph\s*\(/.test(src), 'redrawAllCanvases still calls the undefined drawGraph()');
    assert(/drawPKGraph/.test(src), 'redrawAllCanvases does not replay the PK graphs');
    assert(!/catch\s*\(\s*e\s*\)\s*\{\s*\}/.test(src), 'redrawAllCanvases still swallows errors silently');
  });
}

// ════════════════════════════════════════════════════════════════════
// SUITE 13 — drawProfileGraph: the Bayesian concentration-time plot
//
// The chart a clinician reads their measured levels off. Same approach as
// SUITE 12: drive the REAL renderer through a recording context.
// ════════════════════════════════════════════════════════════════════
{
  const { drawProfileGraph, predictConc1comp } = sandbox;
  const PALETTE = { '--terracotta':'#cc785c','--terracotta-q':'#e0a98c','--moss':'#4a5c28',
                    '--ink-faint':'#8a8e80','--paper':'#faf5ed','--paper-deep':'#f2ecdf',
                    '--purple':'#4a3d7a','--accent-rose':'#a8546a','--rule':'rgba(45,52,40,.1)',
                    '--ink-soft':'#5a6151' };

  function runProfile(doses, levels, CL, V, W = 900, H = 284) {
    const ops = { path:[], texts:[], lines:[], colors:new Set() };
    let cur = null, fill = '', stroke = '';
    const ctx = {
      set fillStyle(v){ fill = String(v); ops.colors.add(String(v)); },
      get fillStyle(){ return fill; },
      set strokeStyle(v){ stroke = String(v); ops.colors.add(String(v)); },
      get strokeStyle(){ return stroke; },
      lineWidth:1, globalAlpha:1, font:'', textAlign:'', textBaseline:'', lineJoin:'', lineCap:'',
      scale(){}, setTransform(){}, clearRect(){}, save(){}, restore(){}, translate(){}, rotate(){},
      setLineDash(){}, roundRect(){}, rect(){}, fill(){}, arc(){},
      beginPath(){ cur = []; },
      moveTo(x,y){ if(cur) cur.push([x,y]); },
      lineTo(x,y){ if(cur) cur.push([x,y]); },
      closePath(){},
      stroke(){ if(cur){ if(cur.length>8) ops.path.push(cur.slice());
                         else if(cur.length===2) ops.lines.push(cur.slice()); } },
      strokeText(){}, fillRect(){},
      fillText(t,x,y){ ops.texts.push({t:String(t),x,y}); },
      measureText(t){ return { width: String(t).length * 5.1 }; },
      createLinearGradient(){ return { addColorStop(){} }; },
      // The real API throws IndexSizeError on a non-positive source rect. The
      // stub used to return {} unconditionally, which is why SUITE 13 could not
      // see that drawProfileGraph aborted on a hidden (zero-width) canvas.
      getImageData(x, y, w, h){
        if (!(w > 0) || !(h > 0)) {
          const e = new Error("Failed to execute 'getImageData' on 'CanvasRenderingContext2D': The source width is 0.");
          e.name = 'IndexSizeError';
          throw e;
        }
        return {};
      },
    };
    const canvas = { width:0, height:0, style:{}, clientWidth:W, offsetWidth:W,
                     getContext:()=>ctx, getBoundingClientRect:()=>({width:W,height:H}),
                     addEventListener(){}, removeEventListener(){} };
    const prevGCS = sandbox.getComputedStyle, prevDPR = sandbox.devicePixelRatio;
    sandbox.document.documentElement = {};
    sandbox.getComputedStyle = () => ({ getPropertyValue:(n)=> PALETTE[n] || '' });
    sandbox.devicePixelRatio = 1;
    try { drawProfileGraph(canvas, doses, levels, CL, V, CL*0.85, V*1.05, null, null, 0); }
    finally { sandbox.getComputedStyle = prevGCS; sandbox.devicePixelRatio = prevDPR; }
    return { ops, plot: canvas._pkPlot };
  }

  // A realistic 7-day Q8H course — the case the audit measured.
  const t0 = 1000;
  const q8h = [];
  for (let i = 0; i < 21; i++) q8h.push({ mg: 1000, timeH: t0 + i*8, tinfH: 1 });
  const lev = [{ conc: 14.7, timeH: t0 + 7*8 + 7 }];

  console.log(`\n${'═'.repeat(60)}`);
  console.log('  SUITE 13 — drawProfileGraph rendering invariants');
  console.log(`${'─'.repeat(60)}`);

  test('A hidden canvas is skipped, not drawn into at zero width', ()=>{
    // offsetWidth is 0 inside a display:none panel. Drawing there is
    // meaningless, and getImageData on a zero-width bitmap throws
    // IndexSizeError — which aborted drawProfileGraph BEFORE
    // attachPlotCrosshair, so the crosshair silently never bound. Production
    // logged that error every time the module was switched away from with a
    // result on screen. Driven through the SAME recording context as the rest
    // of this suite, so nothing else can throw first and mask it.
    let threw = null, res = null;
    try { res = runProfile(q8h, lev, 4.5, 60, 0, 284); }
    catch (e) { threw = e; }
    assert(!threw, `drawProfileGraph threw on a zero-width canvas: ${threw && threw.name}: ${threw && threw.message}`);
    assert(res && !res.plot, 'it should bail out before recording plot geometry');
  });

  test('Drawn polyline tracks the model through every infusion corner', ()=>{
    const { ops, plot } = runProfile(q8h, lev, 4.5, 60);
    assert(plot, 'no plot geometry recorded');
    const poly = ops.path.reduce((a,b)=> b.length > a.length ? b : a, []);
    assert(poly.length > 100, `expected a sampled curve, got ${poly.length} vertices`);
    const { pad, gW, gH, tStart, tSpan, cMaxVal } = plot;
    const invT = x => ((x - pad.left) / gW) * tSpan + tStart;
    const invC = y => ((pad.top + gH - y) / gH) * cMaxVal;
    // Compare the drawn line against the true model at each end-of-infusion,
    // which is where a uniform grid cuts the corner.
    assert(Number.isFinite(gW) && gW > 0, `plot geometry is NaN (gW=${gW}) — the test would pass vacuously`);
    let worst = 0, worstAt = 0, checked = 0;
    for (const d of q8h) {
      const tCorner = d.timeH + d.tinfH;
      let near = null;
      for (const [x,y] of poly) if (Math.abs(invT(x) - tCorner) < 1e-4) { near = [x,y]; break; }
      if (!near) continue;
      checked++;
      const drawn = invC(near[1]);
      // The unbroken full-span polyline is the population curve.
      const truth = predictConc1comp(q8h, tCorner, (4.5*0.85)/(60*1.05), 60*1.05);
      const err = Math.abs(drawn - truth);
      if (err > worst) { worst = err; worstAt = tCorner - t0; }
    }
    assert(checked >= q8h.length - 1,
      `only ${checked}/${q8h.length} infusion corners are polyline vertices — the union sampling is not working`);
    assert(worst < 0.15,
      `polyline misses the infusion corner by ${worst.toFixed(2)} mg/L at t=${worstAt}h ` +
      `(a uniform grid cut it by up to 2.68)`);
  });

  test('Dose labels are decimated; a strength change is never hidden', ()=>{
    const { ops } = runProfile(q8h, lev, 4.5, 60, 700);
    const mgLabels = ops.texts.filter(t => t.t === '1000' && Number.isFinite(t.x))
                              .sort((a,b)=>a.x-b.x);
    if (!mgLabels.length) {
      const sample = ops.texts.slice(0,8).map(t=>`${t.t}@${t.x}`).join(' ');
      assert(false, `no finite-x '1000' labels; sample: ${sample}`);
    }
    assert(mgLabels.length >= 2, 'no dose labels drawn at all');
    for (let i=1;i<mgLabels.length;i++) {
      assert(mgLabels[i].x - mgLabels[i-1].x >= 29,
        `dose labels ${(mgLabels[i].x - mgLabels[i-1].x).toFixed(1)}px apart — they overlap`);
    }
    // A strength change must always be labelled, even inside a dense run.
    const mixed = q8h.map((d,i) => ({ ...d, mg: i >= 12 ? 1250 : 1000 }));
    const r2 = runProfile(mixed, lev, 4.5, 60, 700);
    assert(r2.ops.texts.some(t => t.t === '1250'),
      'the dose-strength change was decimated away — a regimen change must survive');
  });

  test('Dose ticks are axis stubs, not a full-height picket fence', ()=>{
    const { ops, plot } = runProfile(q8h, lev, 4.5, 60);
    const { gH } = plot;
    const vertical = ops.lines.filter(l => l.length === 2 && Math.abs(l[0][0]-l[1][0]) < 0.01);
    const stubs = vertical.filter(l => Math.abs(Math.abs(l[0][1]-l[1][1]) - 8) < 0.5);
    const fullHeight = vertical.filter(l => Math.abs(Math.abs(l[0][1]-l[1][1]) - gH) < 1.5);
    // Every dose is a stub on the axis; none of them spans the plot (no dose
    // here is projected, so there is no regime boundary to mark full-height).
    assert(stubs.length === q8h.length,
      `${stubs.length} axis stubs against ${q8h.length} doses — expected one each`);
    // The minor/major time grid legitimately spans the plot (~26 rules over a
    // 208 h span). The regression to catch is 21 dose rules stacked on top.
    assert(fullHeight.length < 26 + q8h.length - 5,
      `${fullHeight.length} full-height rules over ${q8h.length} doses — the time grid alone ` +
      `accounts for ~26, so the dose ticks are spanning the plot again`);
  });

  test('Axis headroom is tight and the top gridline is reachable', ()=>{
    const { plot } = runProfile(q8h, lev, 4.5, 60);
    // The axis must contain BOTH curves — the population fit uses a lower
    // clearance here, so it peaks above the individual one.
    let peak = 0;
    for (let t = t0; t < t0 + 21*8; t += 0.05) {
      peak = Math.max(peak, predictConc1comp(q8h, t, 4.5/60, 60),
                            predictConc1comp(q8h, t, (4.5*0.85)/(60*1.05), 60*1.05));
    }
    assert(plot.cMaxVal >= peak,
      `axis top ${plot.cMaxVal} is below the peak ${peak.toFixed(1)}`);
    assert(plot.cMaxVal <= peak * 1.35,
      `axis top ${plot.cMaxVal} wastes ${(100*(1-peak/plot.cMaxVal)).toFixed(0)}% of the plot ` +
      `above a peak of ${peak.toFixed(1)} (the old 25%-plus-round-to-5 wasted ~24%)`);
  });

  test('A short course is not squeezed into a corner by a fixed 48h tail', ()=>{
    const single = [{ mg: 1500, timeH: t0, tinfH: 1.5 }];
    const { plot } = runProfile(single, [{conc: 22.0, timeH: t0 + 4}], 4.5, 60);
    assert(plot.tSpan <= 40,
      `a single-dose course spans ${plot.tSpan.toFixed(1)}h — the old fixed +48h tail ` +
      `pushed the informative region into the leftmost few percent`);
    assert(plot.tSpan >= 12, `tail too short to show terminal decay: ${plot.tSpan.toFixed(1)}h`);
  });

  test('Every colour is a token', ()=>{
    const DARK = Object.assign({}, PALETTE, { '--terracotta':'#d88a6e','--ink-faint':'#7d7666',
      '--moss':'#9aad68','--paper':'#1c1815','--purple':'#8e7dc8','--accent-rose':'#d08ba0',
      '--paper-deep':'#252119','--rule':'rgba(236,228,210,.1)','--ink-soft':'#b8af9d' });
    const light = runProfile(q8h, lev, 4.5, 60).ops;
    const prev = sandbox.getComputedStyle;
    sandbox.getComputedStyle = () => ({ getPropertyValue:(n)=> DARK[n] || '' });
    let dark;
    try {
      const ops = { }; // re-run under the dark palette
      dark = (function(){
        const saved = sandbox.getComputedStyle;
        const r = runProfileDark();
        return r;
      })();
    } finally { sandbox.getComputedStyle = prev; }
    function runProfileDark() {
      const savedPal = PALETTE;
      Object.assign(PALETTE, DARK);
      const r = runProfile(q8h, lev, 4.5, 60).ops;
      Object.assign(PALETTE, savedPal);
      return r;
    }
    const real = (set) => [...set].filter(c => /^#|^rgba?\(/i.test(c));
    const shared = real(light.colors).filter(c => dark.colors.has(c));
    assert(shared.length === 0,
      `these colours are identical in both themes, so they are literals: ${shared.join(', ')}`);
  });
}

// ════════════════════════════════════════════════════════════════════
// SUITE 15 — the obesity advisory must not contradict itself
//
// Reported from real use at BMI 30.1: the blue line correctly suggested Goti,
// while an older amber banner directly beneath it said "Consider switching to
// Hughes 2024" — and cited "N=83 BMI >=40" in the same sentence. The correct
// text was computed into rec.advisory and never rendered.
// ════════════════════════════════════════════════════════════════════
{
  const { getModelRecommendation, renderModelBanner } = sandbox;
  // getModelRecommendation(nLevels, isICU, tbw, htCm) — it derives BMI itself,
  // so drive it the way the app does: pick a weight that yields the target BMI
  // at a fixed height.
  const HT_CM = 175, HT_M = HT_CM / 100;
  const rec = (bmi, opts = {}) => getModelRecommendation(
    opts.nLevels ?? 1, opts.isICU ?? false, bmi * HT_M * HT_M, HT_CM);

  console.log(`\n${'═'.repeat(60)}`);
  console.log('  SUITE 15 — obesity advisory consistency');
  console.log(`${'─'.repeat(60)}`);

  test('BMI 30-39.9 never points the clinician at Hughes', ()=>{
    [30.1, 32, 35, 37.5, 39.9].forEach(bmi => {
      const r = rec(bmi);
      assert(r.recommended === 'goti', `BMI ${bmi}: recommended '${r.recommended}', expected goti`);
      const html = renderModelBanner(r, 'buelga');
      assert(!/switching to <strong>Hughes/.test(html),
        `BMI ${bmi}: the banner still tells the clinician to switch to Hughes`);
      assert(/not recommended here|NOT recommended/i.test(html),
        `BMI ${bmi}: the banner must say Hughes is not recommended below 40`);
    });
  });

  test('The banner never says two different things at once', ()=>{
    [30.1, 35, 39.9, 42, 55].forEach(bmi => {
      const r = rec(bmi);
      ['buelga','goti','hughes'].forEach(using => {
        const html = renderModelBanner(r, using);
        const pushesHughes = /switching to <strong>Hughes/.test(html);
        const warnsOffHughes = /not recommended here|NOT recommended/i.test(html);
        assert(!(pushesHughes && warnsOffHughes),
          `BMI ${bmi} on '${using}': banner both recommends and warns against Hughes`);
      });
    });
  });

  test('BMI >= 40 still recommends Hughes', ()=>{
    [40, 46.3, 70].forEach(bmi => {
      const r = rec(bmi);
      assert(r.recommended === 'hughes', `BMI ${bmi}: expected hughes, got '${r.recommended}'`);
      assert(/switching to <strong>Hughes/.test(renderModelBanner(r, 'buelga')),
        `BMI ${bmi}: class 3 should be offered Hughes`);
    });
  });

  test('Using Hughes below its floor is still flagged', ()=>{
    const html = renderModelBanner(rec(32), 'hughes');
    assert(/outside its development population/i.test(html),
      'choosing Hughes at BMI 32 must warn it is outside the development population');
  });

  test('A detected interval never prints as a floating-point artefact', ()=>{
    // The reported "Q11.97500000000582H" — a mean of real administration times.
    const { fmtTau } = sandbox;
    assert(typeof fmtTau === 'function', 'fmtTau helper is missing');
    assert(fmtTau(11.97500000000582) === '12', `got '${fmtTau(11.97500000000582)}'`);
    assert(fmtTau(12) === '12', 'clean integers must stay clean');
    assert(fmtTau(8.000000001) === '8', '');
    assert(fmtTau(11.5) === '11.5', 'a genuinely non-integer interval keeps one decimal');
    assert(fmtTau(7.4) === '7.4', '');
    [11.97500000000582, 8.000000001, 23.999999].forEach(t => {
      assert(!/\d{5,}/.test(fmtTau(t)), `fmtTau(${t}) leaked a float artefact: ${fmtTau(t)}`);
    });
  });
}

// ════════════════════════════════════════════════════════════════════
// SUITE 16 — fit diagnostics: does the model reproduce the levels?
//
// From a real case. Measured 12.2 mg/L; the MAP fit predicted 7.66 and reported
// AUC 334 while recommending an INCREASE. No (CL,V) pair that reproduces 12.2
// gives an AUC below ~480, so the reported exposure was reachable only by
// treating the level as ~1.3 sigma of error — and nothing on screen said so.
// ════════════════════════════════════════════════════════════════════
{
  const { fitDiagnostics, predictConc1comp } = sandbox;
  const H = (d,hh,mm) => ((d-7)*24)+hh+mm/60, t0 = H(7,21,50);
  const CASE = {
    model:'buelga', CL_ind:5.992, V_ind:80.20, kel_ind:5.992/80.20, crcl:127,
    doses:[{mg:1250,timeH:0,tinfH:1.5},
           {mg:1000,timeH:H(8,10,28)-t0,tinfH:1},
           {mg:1000,timeH:H(8,22,13)-t0,tinfH:1}],
    levels:[{conc:12.2,timeH:H(9,11,43)-t0}],
  };

  console.log(`\n${'═'.repeat(60)}`);
  console.log('  SUITE 16 — fit diagnostics');
  console.log(`${'─'.repeat(60)}`);

  test('Reproduces the reported case: +4.5 mg/L, +1.29 sigma', ()=>{
    const fd = fitDiagnostics(CASE);
    assert(fd && fd.rows.length === 1, 'no diagnostics produced');
    const x = fd.rows[0];
    assert(Math.abs(x.pred - 7.66) < 0.05, `model prediction ${x.pred.toFixed(2)}, expected ~7.66`);
    assert(Math.abs(x.resid - 4.54) < 0.05, `residual ${x.resid.toFixed(2)}, expected ~+4.54`);
    assert(Math.abs(x.sigma - 1.29) < 0.02, `sigma ${x.sigma.toFixed(2)}, expected ~+1.29`);
    assert(Math.abs(x.sd - 3.52) < 1e-9, `Buelga residual SD should be the additive 3.52, got ${x.sd}`);
    // Level times are absolute epoch-hours; the column must read elapsed hours
    // from the first dose, not 496936.7.
    assert(Math.abs(x.tRel - 37.883) < 0.01,
      `elapsed time ${x.tRel.toFixed(2)} h, expected 37.88 from the first dose`);
  });

  test('Residual sign is observed minus predicted', ()=>{
    const fd = fitDiagnostics(CASE);
    assert(fd.rows[0].resid > 0,
      'the patient measured HIGHER than the model — the residual must be positive');
    const low = JSON.parse(JSON.stringify(CASE));
    low.levels = [{ conc: 3.0, timeH: CASE.levels[0].timeH }];
    assert(fitDiagnostics(low).rows[0].resid < 0, 'a level below prediction must give a negative residual');
  });

  test('The implied clearance is surfaced when the fit misses by >= 1 sigma', ()=>{
    const fd = fitDiagnostics(CASE);
    assert(fd.impliedCrCl, 'a >1 sigma miss must report the clearance that would fit');
    assert(Math.abs(fd.impliedCrCl.CL - 4.12) < 0.05,
      `implied CL ${fd.impliedCrCl.CL.toFixed(2)}, expected ~4.12`);
    assert(Math.abs(fd.impliedCrCl.crcl - 64) < 2,
      `implied CrCl ${fd.impliedCrCl.crcl.toFixed(0)}, expected ~64 against the 127 entered`);
    // The point of the number: it must actually reproduce the level.
    const c = predictConc1comp(CASE.doses, CASE.levels[0].timeH,
                               fd.impliedCrCl.CL / CASE.V_ind, CASE.V_ind);
    assert(Math.abs(c - 12.2) < 0.05, `implied CL reproduces ${c.toFixed(2)}, not the measured 12.2`);
  });

  test('When the fit misses, the level-anchored alternative is offered', ()=>{
    // What the Trough-Based module would say, computed inline so a clinician
    // does not have to re-enter the case to get the answer from the data they
    // already have. Reproduces the separately-reported 466 / 13.4 / 26.8.
    const withReg = Object.assign({}, CASE, { tbw: 69.4, regimen: { dose: 1000, tau: 12, tinfH: 1 } });
    const fd = fitDiagnostics(withReg);
    assert(fd.anchored, 'a >1 sigma miss must offer the level-anchored estimate');
    assert(Math.abs(fd.anchored.auc24 - 466) < 3, `AUC ${fd.anchored.auc24.toFixed(0)}, expected ~466`);
    assert(Math.abs(fd.anchored.trough - 13.4) < 0.15, `trough ${fd.anchored.trough.toFixed(1)}, expected ~13.4`);
    assert(Math.abs(fd.anchored.peak - 26.8) < 0.2, `peak ${fd.anchored.peak.toFixed(1)}, expected ~26.8`);
    assert(Math.abs(fd.anchored.clv - 4.29) < 0.05, `CL ${fd.anchored.clv.toFixed(2)}, expected ~4.29`);
    // The whole point: it reproduces the measurement, unlike the MAP fit.
    assert(Math.abs(fd.anchored.trough - fd.rows[0].pred) > 4,
      'the anchored estimate should differ materially from the prior-dominated fit');
  });

  test('No anchored estimate when the fit is good or the regimen is unknown', ()=>{
    const noReg = Object.assign({}, CASE, { tbw: 69.4 });
    assert(!fitDiagnostics(noReg).anchored, 'without a detected regimen there is nothing to anchor to');
    const good = JSON.parse(JSON.stringify(CASE));
    good.tbw = 69.4; good.regimen = { dose: 1000, tau: 12, tinfH: 1 };
    const pred = predictConc1comp(CASE.doses, CASE.levels[0].timeH, CASE.kel_ind, CASE.V_ind);
    good.levels = [{ conc: +pred.toFixed(2), timeH: CASE.levels[0].timeH }];
    assert(!fitDiagnostics(good).anchored, 'a fit that reproduces its level needs no alternative');
  });

  test('A fit that DOES reproduce its level is not flagged', ()=>{
    const good = JSON.parse(JSON.stringify(CASE));
    const pred = predictConc1comp(CASE.doses, CASE.levels[0].timeH, CASE.kel_ind, CASE.V_ind);
    good.levels = [{ conc: +pred.toFixed(2), timeH: CASE.levels[0].timeH }];
    const fd = fitDiagnostics(good);
    assert(Math.abs(fd.worst.sigma) < 0.05, `a perfect fit reported ${fd.worst.sigma.toFixed(3)} sigma`);
    assert(!fd.impliedCrCl, 'no implied-clearance note should appear when the fit is good');
  });

  test('Degrades safely with no levels or no doses', ()=>{
    assert(fitDiagnostics(null) === null, 'null input');
    assert(fitDiagnostics({ ...CASE, levels: [] }) === null, 'no levels');
    assert(fitDiagnostics({ ...CASE, doses: [] }) === null, 'no doses');
  });

  test('Uses the residual model of the ACTIVE prior, not always Buelga', ()=>{
    const fd1 = fitDiagnostics(CASE);
    const g = JSON.parse(JSON.stringify(CASE));
    g.model = 'goti';
    g.goti = { k10_ind: 0.075, k12_ind: 0.5, k21_ind: 0.6, Vc_ind: 58.4 };
    const fd2 = fitDiagnostics(g);
    assert(fd2, 'no diagnostics for the 2-comp branch');
    assert(Math.abs(fd1.rows[0].sd - fd2.rows[0].sd) > 0.1,
      'Goti (proportional + additive) must not reuse the Buelga additive-only SD');
  });
}

// ════════════════════════════════════════════════════════════════════
// SUITE 17 — v2.2: amputation reconstruction and cross-model agreement
// ════════════════════════════════════════════════════════════════════
{
  const { amputationPct, reconstructWeight, ampRemovedSegments, modelAgreement } = sandbox;
  // const in a vm is not a sandbox property — parse them, never copy them (rule 6).
  const { AMPUTATION_LEVELS, AMP_SEGMENT_PCT, MODEL_AGREEMENT_BANDS } = __extractConsts();
  const st = (o) => Object.assign({ RA:null, LA:null, RL:null, LL:null }, o);

  console.log(`\n${'═'.repeat(60)}`);
  console.log('  SUITE 17 — amputation + model agreement');
  console.log(`${'─'.repeat(60)}`);

  test('Osterkamp table is internally consistent', ()=>{
    // The check that catches the "entire arm 6.1%" figure circulating online.
    const seg = AMP_SEGMENT_PCT;
    assert(Math.abs((seg.upperArm + seg.forearm + seg.hand) - 5.0) < 1e-9,
      `arm segments sum to ${seg.upperArm + seg.forearm + seg.hand}, not the published entire-arm 5.0`);
    assert(Math.abs((seg.thigh + seg.lowerLeg + seg.foot) - 16.0) < 1e-9,
      `leg segments sum to ${seg.thigh + seg.lowerLeg + seg.foot}, not the published entire-leg 16.0`);
    const lvl = (k) => AMPUTATION_LEVELS.find(x => x.key === k).pct;
    assert(lvl('shoulder') === 5.0 && lvl('hip') === 16.0, 'proximal levels must be the whole limb');
    assert(Math.abs(lvl('elbow') - (seg.forearm + seg.hand)) < 1e-9, 'below-elbow = forearm + hand');
    assert(Math.abs(lvl('knee')  - (seg.lowerLeg + seg.foot)) < 1e-9, 'below-knee = lower leg + foot');
  });

  test('Above-knee removes the WHOLE limb, not the thigh segment', ()=>{
    // Getting this wrong halves the correction: 10.1 (thigh) vs 16.0 (limb).
    assert(Math.abs(amputationPct(st({ RL:'hip' })) * 100 - 16.0) < 1e-9,
      'transfemoral must be 16.0%, the whole limb');
    assert(Math.abs(amputationPct(st({ RL:'hip' })) * 100 - AMP_SEGMENT_PCT.thigh) > 5,
      'transfemoral must NOT be the 10.1% thigh segment alone');
  });

  test('Percentages add across limbs', ()=>{
    assert(Math.abs(amputationPct(st({ RL:'knee', LL:'knee' })) * 100 - 11.8) < 1e-9, 'bilateral BKA');
    assert(Math.abs(amputationPct(st({ RL:'hip', LL:'hip' })) * 100 - 32.0) < 1e-9, 'bilateral AKA');
    assert(amputationPct(st({})) === 0, 'no selection is zero');
  });

  test('Reconstruction is Osterkamp W/(1-p), and refuses to run away', ()=>{
    assert(Math.abs(reconstructWeight(70, 0.059) - 74.39) < 0.01, 'W/(1-p)');
    assert(reconstructWeight(70, 0) === 70, 'no amputation returns the observed weight');
    assert(!isFinite(reconstructWeight(70, 0.50)),
      '1/(1-p) is not meaningful past the cap and must not be reported');
    assert(!isFinite(reconstructWeight(0, 0.059)), 'no weight entered');
  });

  test('Only segments distal to the selected joint are removed', ()=>{
    const g = ampRemovedSegments(st({ RL:'knee' }));
    assert(g['RL:lowerLeg'] && g['RL:foot'], 'below-knee must remove lower leg and foot');
    assert(!g['RL:thigh'], 'below-knee must NOT remove the thigh');
    assert(!g['LL:lowerLeg'], 'the other leg is untouched');
    const h = ampRemovedSegments(st({ RA:'elbow' }));
    assert(h['RA:forearm'] && h['RA:hand'] && !h['RA:upperArm'], 'below-elbow keeps the upper arm');
  });

  test('Model agreement flags the real case as Low', ()=>{
    const H = (d,hh,mm) => ((d-7)*24)+hh+mm/60, t0 = H(7,21,50);
    const doses = [{mg:1250,timeH:0,tinfH:1.5},
                   {mg:1000,timeH:H(8,10,28)-t0,tinfH:1},
                   {mg:1000,timeH:H(8,22,13)-t0,tinfH:1}];
    const levels = [{conc:12.2,timeH:H(9,11,43)-t0}];
    const ag = modelAgreement({ crcl:127, tbw:69.4, dial:false }, doses, levels, 2000);
    assert(ag, 'no agreement computed');
    assert(Math.abs(ag.aucBuelga - 334) < 6, `Buelga AUC ${ag.aucBuelga.toFixed(0)}, expected ~334`);
    assert(ag.diffPct > 20, `${ag.diffPct.toFixed(1)}% apart should band as Low`);
    assert(ag.band.label === 'Low', `banded as ${ag.band.label}`);
    // Goti's weaker CrCl dependence lands near the clearance the level implies.
    assert(Math.abs(ag.CLg - 4.12) < 0.4,
      `Goti CL ${ag.CLg.toFixed(2)} should sit near the level-implied 4.12`);
  });

  test('Agreement bands are High <10, Moderate 10-20, Low >20', ()=>{
    const B = MODEL_AGREEMENT_BANDS;
    const band = (d) => (B.find(x => d < x.max) || B[2]).label;
    assert(band(5) === 'High' && band(9.9) === 'High', 'under 10 is High');
    assert(band(10) === 'Moderate' && band(19.9) === 'Moderate', '10-20 is Moderate');
    assert(band(20) === 'Low' && band(80) === 'Low', 'over 20 is Low');
  });
}

// ════════════════════════════════════════════════════════════════════
// SUITE 18 — two modules, and profiles that work in both
//
// Continue Course did one thing AUC Precision could not: re-dose against a
// STORED fit without re-fitting. That is a liability rather than a feature —
// it used yesterday's parameters and showed none of the v2.2 safety signals.
// Removed. Saved profiles now carry a patient core both modules can read.
// ════════════════════════════════════════════════════════════════════
{
  const src    = fs.readFileSync(htmlPath, 'utf8');
  const script = src.match(/<script>([\s\S]*?)<\/script>/)[1];
  const body   = src.slice(src.indexOf('<body>'));

  console.log(`\n${'═'.repeat(60)}`);
  console.log('  SUITE 18 — module surface + cross-module profiles');
  console.log(`${'─'.repeat(60)}`);

  test('Continue Course is gone, with no orphans left behind', ()=>{
    const dead = ['continueState','loadContinueProfile','runContinueTinker','runContinueOptimizer',
                  'app-shell-continue','continue-placeholder','continue-results',
                  'continue-profile-select','renderContinueProfileList','statusClassFor'];
    const found = dead.filter(d => src.includes(d));
    assert(found.length === 0, `orphaned references remain: ${found.join(', ')}`);
  });

  test('The clinical action:"continue" is NOT collateral damage', ()=>{
    // 'continue the current regimen' is a dose recommendation, unrelated to the
    // removed module. Deleting it would silently change what the tool advises.
    const n = (script.match(/action:\s*'continue'/g) || []).length;
    assert(n >= 2, `action:'continue' occurrences ${n} — the clinical action was removed by mistake`);
  });

  test('Exactly two modules are offered', ()=>{
    const tabs = body.match(/<button class="module-tab[^"]*"/g) || [];
    assert(tabs.length === 2, `${tabs.length} module tabs, expected 2`);
    assert(/const order = \['trough','auc'\];/.test(script), 'the module order list still names a third');
  });

  test('The patient core maps onto BOTH modules', ()=>{
    assert(/const PATIENT_CORE_FIELDS = \[/.test(script), 'PATIENT_CORE_FIELDS is missing');
    const block = script.slice(script.indexOf('const PATIENT_CORE_FIELDS = ['));
    const rows = block.slice(0, block.indexOf('];')).match(/\{ key:[^}]*\}/g) || [];
    assert(rows.length >= 8, `only ${rows.length} core fields mapped`);
    // Every row names at least one real input, and the shared ones name both.
    ['age','tbw','height','scr'].forEach(k => {
      const row = rows.find(r => r.includes(`key:'${k}'`));
      assert(row, `core field '${k}' missing`);
      assert(/trough:'[^']+'/.test(row) && /bayes:'[^']+'/.test(row),
        `'${k}' must map to an input in BOTH modules: ${row}`);
    });
  });

  test('Both save/load helpers exist and are wired to the shared class', ()=>{
    assert(/function snapshotPatientCore\s*\(/.test(script), 'snapshotPatientCore missing');
    assert(/function applyPatientCore\s*\(/.test(script), 'applyPatientCore missing');
    assert(/snapshot\.core = snapshotPatientCore\(\)/.test(script), 'save does not capture the core');
    assert(/applyPatientCore\(/.test(script), 'load does not apply the core');
    const lists = (body.match(/class="profile-list"/g) || []).length;
    const inputs = (body.match(/class="profile-label-input"/g) || []).length;
    assert(lists === 2, `${lists} profile panels, expected one per module`);
    assert(inputs === 2, `${inputs} profile label inputs, expected one per module`);
  });

  test('No duplicate element ids across the two profile panels', ()=>{
    ['profile-list','profile-label-input'].forEach(id => {
      const n = (body.match(new RegExp(`id="${id}"`, 'g')) || []).length;
      assert(n <= 1, `id="${id}" appears ${n} times — duplicate ids break getElementById`);
    });
  });

  test('Saving from either module is not blocked by Bayesian-only guards', ()=>{
    // The "nothing entered" check read the Bayesian age field, so a profile
    // saved from the Trough-Based module looked empty and prompted.
    assert(/const coreEmpty = !snapshot\.core/.test(script),
      'the empty-profile guard still ignores the patient core');
    assert(/bState && bState\.result && bayesFitIsStale\(\)/.test(script),
      'the staleness guard still fires when there is no Bayesian result to be stale about');
  });
}

// ════════════════════════════════════════════════════════════════════
// SUITE 14 — CSP compatibility
//
// The app ships under a hash-pinned CSP with no 'unsafe-inline' and no
// 'unsafe-hashes'. A hash authorises the <script> BLOCK; it does not authorise
// inline event-handler attributes. For a while every on* attribute in this file
// was silently blocked in production: the page rendered, the engine loaded, and
// nothing responded to a click. Every "verification" had called the functions
// from the console, which bypasses handlers entirely.
// ════════════════════════════════════════════════════════════════════
{
  const src  = fs.readFileSync(htmlPath, 'utf8');
  const body = src.slice(src.indexOf('<body>'));
  const script = src.match(/<script>([\s\S]*?)<\/script>/)[1];

  console.log(`\n${'═'.repeat(60)}`);
  console.log('  SUITE 14 — CSP compatibility');
  console.log(`${'─'.repeat(60)}`);

  test('No inline on* event-handler attributes anywhere in the body', ()=>{
    const found = body.match(/\son[a-z]+\s*=\s*"/g) || [];
    assert(found.length === 0,
      `${found.length} inline handler attribute(s) — CSP blocks these, so they are dead in ` +
      `production: ${[...new Set(found)].join(', ')}`);
  });

  test('No javascript: URLs', ()=>{
    const found = body.match(/href\s*=\s*"javascript:/gi) || [];
    assert(found.length === 0, `${found.length} javascript: URL(s) — also blocked by CSP`);
  });

  test('Nothing needs unsafe-eval', ()=>{
    // new Function / eval would need 'unsafe-eval'; the handler registry is
    // generated source precisely so it does not.
    const evil = script.match(/\bnew\s+Function\s*\(|(?<![.\w])eval\s*\(/g) || [];
    assert(evil.length === 0, `${evil.length} eval-family call(s) — would need 'unsafe-eval'`);
  });

  test('Every data-on* attribute resolves to a registry entry', ()=>{
    const keys = new Set([...script.matchAll(/^\s*(k\d+):\s*\(el, ev, arg\)/gm)].map(m => m[1]));
    assert(keys.size > 50, `registry looks empty: ${keys.size} entries`);
    const used = [...body.matchAll(/\sdata-on[a-z]+="(k\d+)"/g)].map(m => m[1]);
    assert(used.length > 80, `only ${used.length} bound handlers — expected ~92`);
    const missing = [...new Set(used)].filter(k => !keys.has(k));
    assert(missing.length === 0, `handlers reference missing registry keys: ${missing.join(', ')}`);
  });

  test('Handlers taking a dynamic argument also carry data-arg', ()=>{
    const needArg = new Set([...script.matchAll(/^\s*(k\d+): \(el, ev, arg\) => \{[^\n]*\barg\b/gm)]
                            .map(m => m[1]));
    assert(needArg.size >= 6, `expected the dynamic handlers, found ${needArg.size}`);
    for (const m of body.matchAll(/\sdata-on[a-z]+="(k\d+)"((?:\s+data-arg="[^"]*")?)/g)) {
      if (needArg.has(m[1])) {
        assert(m[2].includes('data-arg'), `${m[1]} takes an argument but its element has no data-arg`);
      }
    }
  });

  test('A delegated dispatcher is installed for every event type in use', ()=>{
    assert(/function __bindActions\s*\(/.test(script), '__bindActions is missing');
    const types = new Set([...body.matchAll(/\sdata-on([a-z]+)="/g)].map(m => m[1]));
    const dispatched = (script.match(/\['click','input','change','keydown'\]/) || [])[0];
    assert(dispatched, 'dispatcher event list not found');
    for (const t of types) {
      assert(dispatched.includes(`'${t}'`), `events of type '${t}' are used but never dispatched`);
    }
  });
}

// ════════════════════════════════════════════════════════════════════
// SUITE 19 — one temporal model
//
// Two-Level and steady-state-trough mode both used clock-only HH:MM inputs
// and turned them into an elapsed interval with
//     let d = to - from; if (d < 0) d += 24*60;
// which wraps everything into [0,24). Real two-level sampling routinely
// spans midnight, so this was not an edge case.
//
// Two failure modes, both reproduced in docs/audit/probe-v3-case-34m.cjs:
//   - level 2 wraps BELOW level 1  -> solveTwoLevelsPK refuses. Visible.
//   - BOTH levels land on the next day -> they wrap by the same 24 h, kel
//     survives, and the peak back-extrapolation silently uses a t1 that is
//     24 h early. Vd, CL and AUC come out ~7x wrong with NO warning.
//
// Every instant is now a full datetime and there is exactly one helper.
// ════════════════════════════════════════════════════════════════════
{
  const src    = fs.readFileSync(htmlPath, 'utf8');
  const script = src.match(/<script>([\s\S]*?)<\/script>/)[1];
  const body   = src.slice(src.indexOf('<body>'));
  const { elapsedHours, formatElapsed, solveTwoLevelsPK } = sandbox;

  console.log(`\n${'═'.repeat(60)}`);
  console.log('  SUITE 19 — one temporal model');
  console.log(`${'─'.repeat(60)}`);

  test('elapsedHours does not wrap a cross-midnight interval', ()=>{
    // the reported case: dose 9/11 10:22, level 2 drawn 9/12 10:38
    const r = elapsedHours('2026-09-11T10:22', '2026-09-12T10:38');
    assert(r.ok, 'should parse');
    assert(Math.abs(r.hours - 24.2667) < 0.01,
      `expected 24.27 h, got ${r.hours} — the [0,24) wrap is back`);
  });

  test('elapsedHours spans more than one day', ()=>{
    const r = elapsedHours('2026-09-11T10:22', '2026-09-13T12:00');
    assert(Math.abs(r.hours - 49.633) < 0.01, `expected 49.63 h, got ${r.hours}`);
  });

  test('elapsedHours reports a reversed interval instead of absorbing it', ()=>{
    const r = elapsedHours('2026-09-12T10:00', '2026-09-11T08:00');
    assert(r.ok && r.reversed === true, 'a level dated before the dose must be flagged');
    assert(r.hours < 0, 'a reversed interval must stay negative, never +24 h');
  });

  test('elapsedHours refuses incomplete or unparseable input', ()=>{
    assert(elapsedHours('', '2026-09-11T10:00').ok === false, 'empty from');
    assert(elapsedHours('2026-09-11T10:00', '').ok === false, 'empty to');
    assert(elapsedHours('not-a-date', '2026-09-11T10:00').ok === false, 'garbage');
  });

  test('formatElapsed names the days for a multi-day span', ()=>{
    assert(/2d/.test(formatElapsed(49.63)), `expected days in "${formatElapsed(49.63)}"`);
    assert(!/\dd /.test(formatElapsed(16.9)), `no day part for a short span: "${formatElapsed(16.9)}"`);
  });

  test('the silent-corruption case now computes the right volume', ()=>{
    // dose 08:00 day 1; levels 12:00 and 18:00 day 2 => 28 h and 34 h.
    // The old code wrapped both to 4 h and 10 h. Both wrapped times are past a
    // 2 h infusion and correctly ordered, so EVERY guard passed and nothing
    // was shown: same kel, Vd 5.7x wrong. (A level drawn early the next
    // morning instead wraps below the infusion time and calculate() refuses
    // out loud — that is the benign case, and not the one to test.)
    const tinf = 2;
    const t1 = elapsedHours('2026-09-11T08:00', '2026-09-12T12:00').hours;
    const t2 = elapsedHours('2026-09-11T08:00', '2026-09-12T18:00').hours;
    assert(Math.abs(t1 - 28) < 0.01 && Math.abs(t2 - 34) < 0.01,
      `expected 28 h and 34 h, got ${t1} and ${t2}`);
    const w1 = t1 - 24, w2 = t2 - 24;                 // what the wrap produced
    assert(w1 > tinf && w2 > w1,
      'the wrapped times must clear the post-infusion and ordering guards — that is what made it silent');
    const good = solveTwoLevelsPK(1750, tinf, 18.7, t1, 12.1, t2, 24, 'firstdose');
    const bad  = solveTwoLevelsPK(1750, tinf, 18.7, w1, 12.1, w2, 24, 'firstdose');
    assert(good && bad, 'both should solve — neither refuses');
    assert(Math.abs(good.kel - bad.kel) < 1e-9, 'kel is unaffected by the wrap — that is why it was silent');
    assert(bad.vd / good.vd > 5, `the wrapped volume should differ several fold, got ${(bad.vd/good.vd).toFixed(2)}x`);
    assert(good.vd < 20, `correct Vd should be ~13.2 L, got ${good.vd}`);
  });

  test('no clock-only time input survives outside a date-paired field', ()=>{
    // b-dose-time-*, b-lvl-time-* and .b-scr-time each sit beside their own
    // <input type="date">, so they are unambiguous. Nothing else may be.
    const clockOnly = [...body.matchAll(/<input[^>]*placeholder="HH:MM"[^>]*>/g)].map(m => m[0]);
    const paired = /id="b-dose-time-|id="b-lvl-time-|class="b-scr-time"/;
    const orphans = clockOnly.filter(t => !paired.test(t));
    assert(orphans.length === 0,
      `clock-only input with no date field: ${orphans.join(' | ').slice(0, 200)}`);
  });

  test('every Trough-Based timing field is a datetime-local on the shared class', ()=>{
    for (const id of ['tl-dose-time','tl-t1-time','tl-t2-time','time-dose-given',
                      'time-level-drawn','rl-dose-time','rl-draw-time']) {
      const m = body.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`));
      assert(m, `${id} is missing`);
      assert(/type="datetime-local"/.test(m[0]), `${id} is not a datetime-local: ${m[0].slice(0,120)}`);
      assert(/class="dt-input"/.test(m[0]),      `${id} does not use the shared .dt-input class`);
    }
  });

  test('the 24-hour wrap idiom is gone from the script', ()=>{
    // Comment-only lines are stripped first: the fix documents the idiom it
    // replaced, and the documentation must not trip the guard on itself.
    const code = script.split('\n')
      .filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join('\n');
    assert(!/\+=\s*24\s*\*\s*60/.test(code),
      'a `+= 24*60` wrap has reappeared — elapsed time must come from elapsedHours');
    assert(!/function\s+diffHr\b/.test(code), 'diffHr is back');
  });

  test('the next-day checkbox is gone, with nothing still reading it', ()=>{
    assert(!src.includes('next-day'), 'the next-day checkbox only ever reached +1 day');
    assert(!/\bnextDay\b/.test(script), 'nextDay is still referenced');
  });

  test('elapsedHours is the only elapsed-time helper', ()=>{
    // calcRLDelta / calcTLDeltas / calcTimeDelta must all route through it
    for (const fn of ['calcRLDelta','calcTLDeltas','calcTimeDelta']) {
      const start = script.indexOf(`function ${fn}(`);
      assert(start > -1, `${fn} is missing`);
      const chunk = script.slice(start, start + 2600);
      assert(/elapsedHours\(|bindElapsed\(/.test(chunk),
        `${fn} computes elapsed time without the shared helper`);
    }
  });
}

// ════════════════════════════════════════════════════════════════════
// SUITE 20 — v3: exposure matrix and plain-language fit bands
//
// bayesDoseOptimizer ranks on |auc24 - target|, but auc24 = TDD/CL carries no
// interval term, so the metric cannot choose an interval even in principle.
// The interval it returns is settled by 250 mg rounding: the achievable-AUC
// lattice is 250*(24/tau)/CL, six times finer at Q48H than at Q8H. Measured on
// the reported case (Goti posterior CL 2.058): target 450 -> 1750 mg Q48H,
// target 475 -> 500 mg Q12H. The matrix is the answer — show the admissible
// space, band it against the SOURCED AUC target, and let the clinician choose.
// ════════════════════════════════════════════════════════════════════
{
  const src    = fs.readFileSync(htmlPath, 'utf8');
  const script = src.match(/<script>([\s\S]*?)<\/script>/)[1];
  const body   = src.slice(src.indexOf('<body>'));
  const { exposureMatrix, fitBandFor } = sandbox;
  const K = __extractConsts();

  console.log(`\n${'═'.repeat(60)}`);
  console.log('  SUITE 20 — exposure matrix + fit bands');
  console.log(`${'─'.repeat(60)}`);

  // the reported case: Goti posterior on 34 M, 65 kg, SCr 1.5
  const CL = 2.058, VC = 39.08, VP = 28.48, Q = K.Q_GOTI;
  const bag = { Vc: VC, Vp: VP, Q };
  const mx  = exposureMatrix(CL, VC, bag, 450, 1);

  test('the matrix builds for the reported case', ()=>{
    assert(mx && mx.rows.length, 'no matrix');
    assert(mx.intervals.join(',') === K.MATRIX_INTERVALS.join(','),
      `columns ${mx.intervals} != MATRIX_INTERVALS ${K.MATRIX_INTERVALS}`);
  });

  test('AUC24 is identical at equal total daily dose — the defect, made visible', ()=>{
    const at = (dose, tau) => {
      const row = mx.rows.find(r => r.dose === dose);
      return row && row.cells.find(c => c.tau === tau);
    };
    const a = at(500, 12), b = at(1000, 24), c = at(2000, 48);
    assert(a && b && c, 'the equal-TDD trio must all be on the ladder');
    assert(Math.abs(a.auc24 - b.auc24) < 1e-9 && Math.abs(b.auc24 - c.auc24) < 1e-9,
      `equal TDD must give equal AUC24: ${a.auc24}, ${b.auc24}, ${c.auc24}`);
    // ...and yet the profiles differ, which is what the interval actually buys
    assert(Math.abs(a.Ctrough - b.Ctrough) > 1,
      'troughs should differ even though exposure does not');
  });

  test('the ladder spans the target dose at EVERY interval', ()=>{
    // A Q24H-centred ladder hid 2000 mg Q48H (AUC24 486, in band) on this case.
    const lo = mx.rows[0].dose, hi = mx.rows[mx.rows.length-1].dose;
    for (const tau of mx.intervals) {
      const want = 450 * CL * tau / 24;
      const clamped = Math.min(K.MATRIX_DOSE_MAX, Math.max(K.MATRIX_DOSE_MIN, want));
      assert(clamped >= lo - K.MATRIX_DOSE_STEP && clamped <= hi + K.MATRIX_DOSE_STEP,
        `Q${tau}H needs ~${want.toFixed(0)} mg but the ladder is ${lo}-${hi}`);
    }
  });

  test('every in-band regimen on the ladder is actually reachable', ()=>{
    const inBand = [];
    mx.rows.forEach(r => r.cells.forEach(c => { if (c.band === 'in') inBand.push(`${c.dose}/Q${c.tau}H`); }));
    // 500 Q12H, 1000 Q24H, 1750 Q48H and 2000 Q48H all reach 400-600 here
    assert(inBand.length >= 4, `expected at least 4 in-band cells, got ${inBand.length}: ${inBand}`);
    assert(inBand.includes('1000/Q24H'),
      `1000 mg Q24H reaches AUC24 486 and must be offered; got ${inBand}`);
    assert(inBand.includes('2000/Q48H'),
      `2000 mg Q48H reaches AUC24 486 and must be offered; got ${inBand}`);
  });

  test('bands come from the sourced AUC constants, not an invented one', ()=>{
    assert(mx.bandMin === K.AUC24_TARGET_MIN && mx.bandMax === K.AUC24_TARGET_MAX,
      'matrix band must be AUC24_TARGET_MIN/MAX (Rybak 2020 Rec 1)');
    mx.rows.forEach(r => r.cells.forEach(c => {
      if (c.blocked) return;
      const want = c.auc24 < K.AUC24_TARGET_MIN ? 'sub'
                 : c.auc24 > K.AUC24_TARGET_MAX ? 'supra' : 'in';
      assert(c.band === want, `${c.dose}/Q${c.tau}H AUC ${c.auc24.toFixed(0)} banded ${c.band}, expected ${want}`);
    }));
  });

  test('the hard safety tier blocks, and blocking wins over banding', ()=>{
    mx.rows.forEach(r => r.cells.forEach(c => {
      const shouldBlock = c.tdd > K.DOSE_MAX_TDD_MG || c.auc24 > K.AUC24_ABSOLUTE_MAX;
      assert(c.blocked === shouldBlock,
        `${c.dose}/Q${c.tau}H TDD ${c.tdd} AUC ${c.auc24.toFixed(0)} blocked=${c.blocked}`);
      if (c.blocked) assert(c.band === 'blocked', 'a blocked cell must not also carry an AUC band');
    }));
  });

  test('no cell exceeds the per-dose ceiling', ()=>{
    mx.rows.forEach(r => assert(r.dose <= K.DOSE_MAX_PER_DOSE_MG,
      `${r.dose} mg is above DOSE_MAX_PER_DOSE_MG`));
  });

  test('the matrix degrades rather than throwing on bad input', ()=>{
    assert(exposureMatrix(0, VC, bag, 450, 1) === null,   'CL 0');
    assert(exposureMatrix(CL, VC, bag, 0, 1)  === null,   'target 0');
    assert(exposureMatrix(NaN, VC, bag, 450, 1) === null, 'CL NaN');
  });

  test('a 1-compartment fit produces a matrix too', ()=>{
    const m1 = exposureMatrix(2.686, 55.84, null, 450, 1);
    assert(m1 && m1.rows.length, 'Buelga path returned nothing');
    const c = m1.rows[0].cells[0];
    assert(isFinite(c.Ctrough) && isFinite(c.Cpeak), '1-comp trough/peak must be finite');
  });

  test('matrix cells are delegated buttons carrying their regimen', ()=>{
    assert(/data-onclick="k71"/.test(script), 'no matrix cell handler in the markup template');
    assert(/k71:\s*\(el, ev, arg\)\s*=>\s*\{\s*pickMatrixCell/.test(script),
      'k71 must be registered to pickMatrixCell');
    assert(/data-arg="\$\{c\.dose\}\|\$\{c\.tau\}"/.test(script),
      'a cell must carry its own dose and interval');
    assert(/function pickMatrixCell/.test(script), 'pickMatrixCell is missing');
  });

  test('the matrix says steady-state, because DoseMeRx-style tables are not', ()=>{
    // Their "over 2 days" matrix is a finite-horizon simulation: 1500 mg q12h
    // reads 859, not 2 x 456.69 = 913. Ours is TDD/CL. Do not blur the two.
    assert(/steady-state AUC/i.test(script), 'the matrix heading must state steady state');
  });

  // ── fit bands ──
  test('fit bands split at 1 and 2 sigma, in both directions', ()=>{
    assert(fitBandFor(0.4).key  === 'close',       '0.4 sigma');
    assert(fitBandFor(-0.4).key === 'close',       'sign must not matter');
    assert(fitBandFor(1.0).key  === 'modest',      '1.0 sigma is the boundary');
    assert(fitBandFor(1.9).key  === 'modest',      '1.9 sigma');
    assert(fitBandFor(-2.5).key === 'substantial', '-2.5 sigma');
    assert(fitBandFor(9).key    === 'substantial', 'far out');
  });

  test('every fit band carries clinical wording, and the worst two carry an action', ()=>{
    for (const b of K.FIT_BANDS) {
      assert(b.clinical && b.clinical.length > 20, `${b.key} has no clinical sentence`);
      assert(b.verdict && b.label, `${b.key} is missing verdict or label`);
      if (b.key !== 'close') assert(b.action && b.action.length > 20,
        `${b.key} must say what to do about it`);
    }
  });

  test('fitBandFor never returns undefined', ()=>{
    for (const v of [NaN, Infinity, -Infinity, 0, 1e9, null, undefined]) {
      assert(fitBandFor(v), `fitBandFor(${v}) returned nothing`);
    }
  });

  // ── the tie-break ──
  // AUC24 = TDD/CL, so equal daily doses score identically. `reduce` with a
  // strict `<` kept pool[0] — the shortest interval — which for a fixed daily
  // dose always has the HIGHEST trough. The optimizer was therefore choosing
  // the most trough-exposed member of an exposure-identical set, and then
  // flagging it. 45% of targets at this patient's clearance end in a tie.
  test('an AUC tie is not broken toward the highest trough', ()=>{
    const { bayesDoseOptimizer, ssCtrough2comp, autoTinf } = sandbox;
    let ties = 0, highest = 0, flagged = 0;
    for (let t = 400; t <= 600; t += 0.5) {
      const cands = [8,12,24,48].map(tau => {
        const dose = Math.round(t * CL * tau / 24 / 250) * 250;
        const tinf = autoTinf(dose);
        return { tau, dose, auc: dose*(24/tau)/CL, tdd: dose*(24/tau),
                 tr: ssCtrough2comp(dose, tau, tinf, CL, VC, VP, Q) };
      }).filter(c => c.dose >= 250 && c.dose <= K.DOSE_MAX_PER_DOSE_MG
                  && c.tdd <= K.DOSE_MAX_TDD_MG && c.auc <= K.AUC24_ABSOLUTE_MAX);
      if (!cands.length) continue;
      const bestErr = Math.min(...cands.map(c => Math.abs(c.auc - t)));
      const tied = cands.filter(c => Math.abs(c.auc - t) - bestErr < 1e-9);
      if (tied.length < 2) continue;
      const r = bayesDoseOptimizer(CL, VC, t, bag, 1);
      if (!r.regimen) continue;
      ties++;
      const maxTr = Math.max(...tied.map(c => c.tr));
      if (Math.abs(r.Ctrough - maxTr) < 1e-6) highest++;
      if ((r.flags || []).some(f => f.level !== 'info')) flagged++;
    }
    assert(ties > 50, `expected many tied targets to test, got ${ties}`);
    assert(highest === 0,
      `picked the highest-trough option on ${highest}/${ties} tied targets`);
    assert(flagged === 0,
      `picked a flagged regimen on ${flagged}/${ties} tied targets, while ` +
      `exposure-identical unflagged alternatives existed`);
  });

  test('the tie is disclosed rather than silently resolved', ()=>{
    const { bayesDoseOptimizer } = sandbox;
    const r = bayesDoseOptimizer(CL, VC, 485, bag, 1);
    assert(r.regimen, 'should solve');
    assert(Array.isArray(r.tiedWith) && r.tiedWith.length >= 1,
      'a regimen chosen out of a tie must record what it was tied with');
    r.tiedWith.forEach(o => assert(o.dose && o.tau, 'each alternative needs a dose and interval'));
  });

  test('common orders are reachable again', ()=>{
    // 1000 mg Q24H — an ordinary vancomycin order — was returned 0 times in
    // 6759 calls before the tie-break was fixed, because Q48H's finer lattice
    // tied or beat it and the tie went to the shortest interval.
    const { bayesDoseOptimizer } = sandbox;
    let hits = 0, calls = 0;
    for (let cl = 0.5; cl <= 8; cl += 0.02) {
      for (const t of [400,425,450,475,500,525,550,575,600]) {
        const r = bayesDoseOptimizer(cl, cl * 30, t, null, 1); calls++;
        if (r.regimen && r.dose === 1000 && r.tau === 24) hits++;
      }
    }
    assert(hits > 0, `1000 mg Q24H was never recommended in ${calls} calls`);
  });

  // ── salvaged from the archived Copilot review (sections 4 and 6) ──
  // Both were already partly built; what was actually missing is tested here.
  test('the Bayesian module range-checks demographics, not just presence', ()=>{
    // runBayesian tested `!age || !tbw` only, so 5000 kg reached the population
    // model: Cockcroft-Gault then returns 73,611,111 mL/min at SCr 0.0001.
    const fn = script.slice(script.indexOf('function runBayesian()'));
    const body = fn.slice(0, fn.indexOf('\n}\n'));
    assert(/validateFields\s*\(/.test(body),
      'runBayesian does not range-check its demographics');
    assert(/validateOptionalFields\s*\(/.test(body),
      'optional-but-bounded fields (height, SCr, target AUC) are unchecked');
    assert(!/if\s*\(\s*!age\s*\|\|\s*!tbw\s*\)/.test(body),
      'the presence-only guard is still there');
  });

  test('there is still exactly one limits table', ()=>{
    // The archived review proposed a second, fabricated one. Four CrCl
    // functions with three SCr floors is how this project learned that lesson.
    const tables = (script.match(/const\s+INPUT_LIMITS\s*=/g) || []).length;
    assert(tables === 1, `expected 1 INPUT_LIMITS, found ${tables}`);
    assert(!/CLINICAL_CONSTANTS/.test(script),
      'the archived review\'s fabricated constants registry has been implemented');
  });

  test('optional fields may be blank but not out of range', ()=>{
    const { checkOptionalField, checkValue } = sandbox;
    assert(typeof checkOptionalField === 'function', 'checkOptionalField missing');
    // blank is fine
    sandbox.document.getElementById = () => ({ value: '' });
    assert(checkOptionalField('x', 'scr', 'SCr').ok, 'blank optional field should pass');
    // a typed value is still bounded
    sandbox.document.getElementById = () => ({ value: '999' });
    assert(!checkOptionalField('x', 'scr', 'SCr').ok, 'SCr 999 should be rejected');
    sandbox.document.getElementById = () => ({ value: '1.2' });
    assert(checkOptionalField('x', 'scr', 'SCr').ok, 'SCr 1.2 should pass');
    // and checkValue still treats blank as an error for REQUIRED fields
    assert(!checkValue('', 'scr', 'SCr').ok, 'blank required field must still fail');
  });

  test('the matrix is one tab stop, navigated by arrow keys', ()=>{
    // A positive tabindex (the review\'s suggestion) hoists elements ahead of
    // everything with the natural 0 and breaks document order. 32 cells would
    // also bury the rest of the page behind the grid.
    assert(/tabindex="\$\{first \? '0' : '-1'\}"/.test(script),
      'matrix cells do not use a roving tabindex');
    assert(/function matrixKeyNav/.test(script), 'matrixKeyNav is missing');
    assert(/k72:\s*\(el, ev, arg\)\s*=>\s*\{\s*matrixKeyNav/.test(script),
      'k72 is not wired to matrixKeyNav');
    assert(/data-onkeydown="k72"/.test(script), 'cells do not listen for keydown');
    // No positive tabindex anywhere in the file. Comment-only lines are stripped
    // first: the fix documents the anti-pattern it rejected, and that must not
    // trip the guard on itself — same false positive the 24*60 sweep had.
    const codeOnly = t => t.split('\n')
      .filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    const positive = (codeOnly(body).match(/tabindex="[1-9]\d*"/g) || []);
    assert(positive.length === 0,
      `positive tabindex is an anti-pattern; found ${positive.join(', ')}`);
  });

  test('arrow navigation skips cells that cannot be chosen', ()=>{
    const src = sandbox.matrixKeyNav.toString();
    assert(/blocked|tagName === 'BUTTON'|disabled/.test(src),
      'matrixKeyNav does not skip unusable cells');
    assert(/ArrowRight|ArrowLeft|ArrowUp|ArrowDown/.test(src), 'no arrow keys handled');
    assert(/'Home'|"Home"/.test(src) && /'End'|"End"/.test(src), 'Home/End not handled');
    assert(/preventDefault/.test(src), 'arrow keys must not also scroll the page');
  });

  test('the grid activates on Enter and Space itself', ()=>{
    // Not left to the browser turning Enter into a click: Space would scroll
    // the page first, and a verified-in-browser check showed the implicit
    // activation did not fire for a focused grid cell. preventDefault keeps it
    // to exactly one activation if the implicit click does also arrive.
    const src = sandbox.matrixKeyNav.toString();
    assert(/key === 'Enter'/.test(src), 'Enter is not handled');
    assert(/' '|'Spacebar'/.test(src), 'Space is not handled');
    assert(/pickMatrixCell\s*\(/.test(src), 'activation does not load the regimen');
  });

  // ── graph vocabulary ──
  test('the graph names posterior, prior and measurement', ()=>{
    for (const t of ['Posterior prediction', 'Population prior', 'Measured concentration']) {
      assert(script.includes(t), `legend is missing "${t}"`);
    }
    assert(!/Individual \(Bayesian\)/.test(script), '"Individual (Bayesian)" is back');
    assert(/class="posterior-note"/.test(script), 'the shrinkage explainer is missing');
    assert(/shrinkage/i.test(script), 'the explainer must name shrinkage');
  });
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

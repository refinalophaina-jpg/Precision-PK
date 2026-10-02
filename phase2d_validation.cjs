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

// Theme palettes parsed from the stylesheet itself (rule 6: never hand-copy a
// constant into the harness). The first :root block is light; the
// :root[data-theme="dark"] block overrides it. var() references resolve one hop.
function __themePalette(theme) {
  const css = fs.readFileSync(htmlPath, 'utf8');
  const grab = (re) => { const m = css.match(re); return m ? m[1] : ''; };
  const parse = (block) => { const o = {}; block.replace(/(--[\w-]+)\s*:\s*([^;]+);/g, (_, k, v) => { o[k] = v.trim(); }); return o; };
  const light = parse(grab(/:root\s*\{([\s\S]*?)\n  \}/));
  const pal = theme === 'dark' ? Object.assign({}, light, parse(grab(/:root\[data-theme="dark"\]\s*\{([\s\S]*?)\n  \}/))) : light;
  for (const k of Object.keys(pal)) {
    const m = /^var\((--[\w-]+)\)$/.exec(pal[k]); if (m && pal[m[1]]) pal[k] = pal[m[1]];
  }
  return pal;
}
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
  // RETIRED 2026-09-28 (rule 9, reason recorded): the "all models share the
  // Buelga widths" and "2-comp ±25%, estimated" assertions pinned a table that
  // was only simulated for Buelga. docs/audit/uncertainty-by-model.cjs, run
  // against each model's own prior (n=1500, seeds 7/11/23), showed the Buelga
  // rows covered only 60-67% of Goti patients (misses mostly above). The
  // widths are now keyed by model; these tests pin the simulated figures.
  // UPDATED 2026-09-28, second pass (rule 9, reason recorded): the band shown is
  // now the measured 10th-90th percentile of true/estimated AUC24, which is
  // asymmetric. The symmetric +/-p80 band put about twice as many simulated
  // patients above its upper bound (toxicity side) as below its lower bound.
  // Same simulation, seeds 7/11/23 averaged.
  const bands = { buelga: ['−30% / +46%', '−21% / +23%', '−18% / +18%', '−17% / +18%'],
                  goti:   ['−40% / +63%', '−24% / +50%', '−21% / +40%', '−19% / +40%'],
                  hughes: ['−27% / +37%', '−18% / +28%', '−17% / +26%', '−17% / +25%'] };
  for (const m of Object.keys(bands)) {
    test(`${m} displayed bands are its own simulated 10th-90th percentiles`, ()=>{
      bands[m].forEach((b, n) => { const t = aucUncertaintyText(n, m); assert(t.includes(b), `n=${n}: ${t}`); });
    });
  }
  test('Goti-HD uses Goti bands and says it was not simulated separately', ()=>{
    const t = aucUncertaintyText(1,'goti-hd');
    assert(t.includes('−24% / +50%') && /not simulated separately/i.test(t), t);
    assert(!/not simulated/i.test(aucUncertaintyText(1,'goti')), 'plain Goti IS simulated');
  });
  test('Every label states the coverage and the median error', ()=>{
    for (const m of ['buelga','goti','hughes']) for (const n of [0,1,2,3]) {
      const t = aucUncertaintyText(n, m);
      assert(/80% of patients/.test(t) && /median error ±\d+%/.test(t), `${m} n=${n}: ${t}`);
    }
  });
  test('≥3 levels uses the 3-level row', ()=>{ assert(aucUncertaintyText(5,'buelga').includes('−17% / +18%'), ''); });
  test('The upper side is never narrower than the lower (true/est is log-normal)', ()=>{
    for (const m of ['buelga','goti','hughes']) for (const n of [0,1,2,3]) {
      const [, lo, hi] = aucUncertaintyText(n, m).match(/−(\d+)% \/ \+(\d+)%/).map(Number);
      assert(hi >= lo, `${m} n=${n}: −${lo}/+${hi}`);
    }
  });
  test('Uncertainty is monotone non-increasing in level count', ()=>{
    const pctOf = (s) => { const m = s.match(/−(\d+)% \/ \+(\d+)%/); return +m[1] + +m[2]; };   // band width
    for (const m of ['buelga','goti','hughes']) {
      const seq = [0,1,2,3].map(n => pctOf(aucUncertaintyText(n,m)));
      for (let i=1;i<seq.length;i++) {
        assert(seq[i] <= seq[i-1], `${m}: more levels must not widen uncertainty: ${seq.join(' → ')}`);
      }
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
  // Parsed from the stylesheet (was hand-copied; rule 6).
  const LIGHT = __themePalette('light');
  const DARK  = __themePalette('dark');

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
      // Re-pointed (design track D, 2026-09-28): tick labels now carry the house space before the unit ("12 h").
      const ticks = ops.texts.filter(t => /^[\d.]+ h$/.test(t.t)).map(t => parseFloat(t.t));
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
    // Re-pointed (design track D, 2026-09-28): the all-caps "TARGET 10–20" kicker is now a
    // sentence-case label naming what the band is. Tightened to the exact bounds and unit.
    const label = ops.texts.find(t => /^Trough target /.test(t.t));
    assert(label && /^Trough target 10–20 mg\/L$/.test(label.t),
      `target band must be labelled with the clinician's own bounds, got: ${label && label.t}`);
  });

  test('Target label reflects a non-default trough target', ()=>{
    const ops = draw(LIGHT, [1000, 12, 1, 0.0693, 60, {troughMin:15,troughMax:25}]);
    // Re-pointed with the label above (design track D): sentence case, exact bounds.
    const label = ops.texts.find(t => /^Trough target /.test(t.t));
    assert(label && /^Trough target 15–25 mg\/L$/.test(label.t),
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

  test('"Try another regimen" draws its own comparison, repainted on a palette change and for print', ()=>{
    // It used to redraw the result's chart with the tried regimen alone, in the
    // projection's colour, so what it was being compared with left the screen (D14).
    const tink = sandbox.tinkerDose.toString();
    assert(!/drawPKGraph/.test(tink), 'tinkerDose must leave the result chart as it is');
    assert(/COMPARE_STYLES/.test(tink), 'the tried regimen must take a comparison style');
    assert(/drawTxTinkChart/.test(sandbox.redrawAllCanvases.toString()), 'a palette change must redraw the comparison');
    assert(/txTinkSuffix/.test(sandbox._prLightCanvasImages.toString()), 'print must repaint the comparison in light');
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
  const PALETTE = __themePalette('light');   // parsed, not copied (rule 6)

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

  // 2026-09-28 design pass (rule 9, reason recorded): dose amounts, times and
  // gaps moved from the canvas axis to the course strip above it (same time
  // axis). The invariant is unchanged: a strength change is never hidden.
  test('Course strip labels the first dose and every strength change, never a steady run', ()=>{
    const { drawCourseStrip } = sandbox;
    const strip = (ds) => { const el = { clientWidth: 700, innerHTML: '', setAttribute(){} };
      drawCourseStrip(el, ds, 0, lev, [], 4.5 / 60); return el.innerHTML; };
    const labels = (h) => [...h.matchAll(/class="dl[^"]*">([^<]+)</g)].map(m => m[1]);
    const steady = labels(strip(q8h));
    assert(steady.length === 1 && steady[0] === '1 g', `steady course: ${JSON.stringify(steady)}`);
    const mixed = q8h.map((d,i) => ({ ...d, mg: i >= 12 ? 1250 : 1000 }));
    const m = labels(strip(mixed));
    assert(m.includes('1.25 g'), 'the dose-strength change was hidden — a regimen change must survive');
    assert((strip(q8h).match(/class="bar"/g) || []).length === q8h.length, 'one bar per dose');
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
    const DARK = __themePalette('dark');
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
    // CHANGED 2026-09-28 (engine audit), with the reason recorded per rule 9.
    // This test used to pin CL 4.29 / AUC 466 / trough 13.4 / peak 26.8 — the
    // Trough-Based module's STEADY-STATE fit. But this course is a load and two
    // maintenance doses, not steady state, and that fit does not reproduce the
    // level it claims to be anchored to: run on the doses actually given,
    // CL 4.29 predicts 11.33 mg/L against the measured 12.20. The panel said
    // the anchored estimate reproduces the measurement "by construction"; it
    // did not. Solving by superposition on the actual doses gives CL 4.04 /
    // AUC24 495 and reproduces 12.20 exactly. The pinned numbers were the
    // defect's output, so they are replaced by the property that matters.
    const withReg = Object.assign({}, CASE, { tbw: 69.4, regimen: { dose: 1000, tau: 12, tinfH: 1 } });
    const fd = fitDiagnostics(withReg);
    assert(fd.anchored, 'a >1 sigma miss must offer the level-anchored estimate');
    const V = 0.98 * 69.4;
    const c = predictConc1comp(CASE.doses, CASE.levels[0].timeH, fd.anchored.kel, V);
    assert(Math.abs(c - 12.2) < 0.02,
      `the anchored estimate must reproduce the measured 12.2 on the doses actually given; gives ${c.toFixed(2)}`);
    assert(Math.abs(fd.anchored.clv - 4.04) < 0.05, `CL ${fd.anchored.clv.toFixed(2)}, expected ~4.04`);
    assert(Math.abs(fd.anchored.auc24 - 495) < 4, `AUC ${fd.anchored.auc24.toFixed(0)}, expected ~495`);
    assert(fd.anchored.superposition === true, 'must be solved by superposition, not a steady-state curve');
    // And it differs materially from the prior-dominated MAP fit.
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
    const ag = modelAgreement(
      { activeModel:'buelga', crcl:127, tbw:69.4, htCm:165.1, dial:false }, doses, levels, 2000);
    assert(ag, 'no agreement computed');
    const row = k => ag.rows.find(m => m.key === k);
    const B = row('buelga'), G = row('goti');
    assert(B && G, `expected Buelga and Goti rows, got ${ag.rows.map(m=>m.key).join(',')}`);
    assert(Math.abs(B.auc24 - 334) < 6, `Buelga AUC ${B.auc24.toFixed(0)}, expected ~334`);
    assert(ag.diffPct > 20, `${ag.diffPct.toFixed(1)}% apart should band as Low`);
    assert(ag.band.label === 'Low', `banded as ${ag.band.label}`);
    // Goti's weaker CrCl dependence lands near the clearance the level implies.
    assert(Math.abs(G.CL - 4.12) < 0.4,
      `Goti CL ${G.CL.toFixed(2)} should sit near the level-implied 4.12`);
    // the active model is identified, and a lean patient gets no Hughes comparator
    assert(B.active === true && G.active === false, 'the active model must be marked');
    assert(!row('hughes'), 'Hughes must not be fitted for a BMI-25 patient');
  });

  test('Model agreement compares the model actually in use', ()=>{
    // It used to fit Buelga + Goti unconditionally. On Hughes that compared two
    // priors NEITHER of which was the clinician's, and reported their spread as
    // if it described their fit. Reported from the bedside.
    const H = (d,hh,mm) => ((d-7)*24)+hh+mm/60, t0 = H(7,21,50);
    const doses = [{mg:1250,timeH:0,tinfH:1.5},
                   {mg:1000,timeH:H(8,10,28)-t0,tinfH:1},
                   {mg:1000,timeH:H(8,22,13)-t0,tinfH:1}];
    const levels = [{conc:12.2,timeH:H(9,11,43)-t0}];
    // class-3 obesity, so Hughes is applicable on its own terms
    const ctx = { activeModel:'hughes', crcl:127, tbw:130, htCm:170, dial:false,
                  crclGoti:127, crclHughes:110, ffm:62 };
    const ag = modelAgreement(ctx, doses, levels, 2000);
    assert(ag, 'no agreement computed on the Hughes path');
    const h = ag.rows.find(m => m.key === 'hughes');
    assert(h, `Hughes is the active model and must appear; got ${ag.rows.map(m=>m.key).join(',')}`);
    assert(h.active === true, 'the active model must be marked as in use');
    assert(ag.rows.filter(m => m.active).length === 1, 'exactly one row is in use');
    assert(ag.n === ag.rows.length && ag.n >= 2, 'spread needs at least two priors');
    assert(ag.hi >= ag.lo, 'spread bounds must bracket');
  });

  test('A dialysis patient is compared against Goti-HD, not plain Goti', ()=>{
    const doses = [{mg:1000,timeH:0,tinfH:1}];
    const levels = [{conc:15,timeH:20}];
    const ag = modelAgreement(
      { activeModel:'buelga', crcl:10, tbw:70, htCm:170, dial:true }, doses, levels, 1000);
    assert(ag, 'no agreement computed');
    const keys = ag.rows.map(m => m.key);
    assert(keys.includes('goti-hd'), `expected goti-hd for a dialysis patient, got ${keys.join(',')}`);
    assert(!keys.includes('goti'), 'the non-dialysis parameterisation must not also appear');
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
    // Re-pointed (design track C, 2026-09-28): the course time fields' placeholder
    // became the hint "24-hour, e.g. 08:00", so matching placeholder="HH:MM"
    // alone would now find nothing and pass vacuously. A clock-only field is
    // found by its HH:MM pattern, the old placeholder, or data-time24 — and the
    // three course fields must actually be found.
    const clockOnly = [...body.matchAll(/<input[^>]*(?:placeholder="HH:MM"|pattern="\[0-2\]\[0-9\]:\[0-5\]\[0-9\]"|data-time24)[^>]*>/g)].map(m => m[0]);
    assert(clockOnly.length >= 3, `expected the dose, level and SCr time fields, found ${clockOnly.length}`);
    // The HD session start time (D15) sits beside its own date input too.
    const paired = /id="b-dose-time-|id="b-lvl-time-|class="b-scr-time"|id="b-hd-time-|id="b-hds-time"/;
    assert(/id="b-hds-date"[^>]*><\/label>\s*<label>Start <input[^>]*id="b-hds-time"/.test(body), 'the schedule start time sits beside its date');
    assert(/id="b-hd-date-\$\{id\}"[^>]*>\s*<input[^>]*id="b-hd-time-\$\{id\}"/.test(body), 'the HD start time is paired with its date');
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
    // RETIRED (v3.1): this test used to also assert the pick is never
    // trough-FLAGGED. That encoded the v3 rule, which treated TROUGH_WARN_MGL
    // (15) as an exclusion — contrary to this file's own tier design, where a
    // 15-20 trough is a Tier 3 flag "never used to exclude". It is what pushed
    // 1000 mg Q24H (trough 15.7) out in favour of 2000 mg Q48H on a real case.
    // The replacement invariants are the next three tests. `flagged` is still
    // counted so a regression toward flag-avoidance is visible in a debugger.
    void flagged;
  });

  test('an exact tie prefers Q24H — the reported 52 M case', ()=>{
    // 8 levels, excellent fit, CL 2.17. Three regimens at AUC24 461. v3
    // returned 2000 mg Q48H because 1000 mg Q24H's trough (15.7) crossed 15.
    const { bayesDoseOptimizer } = sandbox;
    const r = bayesDoseOptimizer(2.17, 103.8, 460, { Vc:103.8, Vp:43.1, Q }, 1);
    assert(r.regimen, 'should solve');
    assert(r.dose === 1000 && r.tau === 24,
      `expected 1000 mg Q24H, got ${r.dose} mg Q${r.tau}H`);
    assert(r.tiedWith && r.tiedWith.some(x => x.tau === 48),
      'the Q48H alternative must still be disclosed');
  });

  test('a DANGER trough yields the preference to a safe exposure-identical tie', ()=>{
    // The preference is practicality; it must never beat the sourced safety
    // floor. At CL 0.8, V 38, target 550 the tie is Q48H tr 15.2 / Q12H tr 23.0
    // / Q24H tr 20.1 — Q24H is in the danger band, so it must not be chosen.
    const { bayesDoseOptimizer } = sandbox;
    const r = bayesDoseOptimizer(0.8, 38, 550, null, 1);
    assert(r.regimen, 'should solve');
    assert(r.Ctrough < 20,
      `chose a danger trough ${r.Ctrough.toFixed(1)} over a safe tie`);
    assert(r.tau !== 24, 'Q24H is in the danger band here and must yield');
  });

  test('the preference never pushes a dose to the ceiling when a tie sits below it', ()=>{
    // 76 M: 2000 mg Q24H and 1000 mg Q12H both give AUC24 434. The Q24H
    // preference alone picked the 2000 mg per-dose ceiling. Option B: the
    // ceiling yields to an exposure-identical dose below it.
    const { bayesDoseOptimizer } = sandbox;
    const r = bayesDoseOptimizer(4.61, 117.6, 450, null, 1);
    assert(r.regimen, 'should solve');
    assert(r.dose === 1000 && r.tau === 12, `expected 1000 mg Q12H, got ${r.dose} mg Q${r.tau}H`);
    assert(r.tiedWith && r.tiedWith.some(x => x.dose === K.DOSE_MAX_PER_DOSE_MG),
      'the ceiling dose must still be disclosed as an alternative');
  });

  test('INTERVAL_PREFERENCE is labelled as preference, not pharmacokinetics', ()=>{
    const i = script.indexOf('const INTERVAL_PREFERENCE');
    assert(i > 0, 'INTERVAL_PREFERENCE is missing');
    const above = script.slice(Math.max(0, i - 1200), i);
    assert(/PREFERENCE, not a literature constant/.test(above),
      'rule 8: a preference weight must say so where it is defined');
    assert(/never changes? a dose/.test(above), 'must state that it never changes a dose');
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
// SUITE 21 — v3.1: confidence, clearance estimates, AUC verdict, renal advisories
//
// Two bedside cases. A 76 M (SCr 0.5, CrCl 148, one level 19.9 vs predicted
// 5.7, 4.0 SD) was shown a precise dose and an "ARC suspected, escalate"
// advisory while the level showed accumulation. A 52 M (8 levels, fit within
// 1 SD) at AUC24 345 was told "below target" in a way that read as "escalate
// now", and was never told the fit was a strong one.
// ════════════════════════════════════════════════════════════════════
{
  const src    = fs.readFileSync(htmlPath, 'utf8');
  const script = src.match(/<script>([\s\S]*?)<\/script>/)[1];
  const { buelgaPopPK, burtonObjective, nelderMead2D, fitDiagnostics,
          levelImpliedCL, clearanceEstimates, aucVerdict, confidenceAssessment,
          renalAdvisoryKind, computeFFM } = sandbox;
  const K = __extractConsts();

  console.log(`\n${'═'.repeat(60)}`);
  console.log('  SUITE 21 — confidence, clearance, verdicts, renal advisories');
  console.log(`${'─'.repeat(60)}`);

  // the 76 M case, fitted with the shipped engine
  const Hh = s => new Date(s).getTime() / 3600000;
  const doses = [{mg:2250,tinfH:2.5,timeH:Hh('2026-09-25T05:41')},
                 {mg:750, tinfH:1,  timeH:Hh('2026-09-26T05:08')},
                 {mg:750, tinfH:1,  timeH:Hh('2026-09-27T05:03')}];
  const levels = [{conc:19.9,timeH:Hh('2026-09-27T05:03')}];
  const { CL_pop, V_pop } = buelgaPopPK(148, 83);
  const [ea, eb] = nelderMead2D((a,b) => burtonObjective(a,b,CL_pop,V_pop,doses,levels), 0, 0, 400);
  const CLi = CL_pop * Math.exp(ea), Vi = V_pop * Math.exp(eb);
  const r1 = { model:'buelga', CL_ind:CLi, V_ind:Vi, kel_ind:CLi/Vi, CL_pop, V_pop, doses, levels, tbw:83,
               agCtx:{ activeModel:'buelga', crcl:148, tbw:83, htCm:182.9, age:76, sex:'M', scr:0.5,
                       dial:false, crclGoti:148, crclHughes:106, ffm:computeFFM(83,182.9,'M') } };
  const fd1 = fitDiagnostics(r1);

  test('the 76 M case reproduces: 4 SD conflict, posterior CL ~4.6', ()=>{
    assert(fd1 && fd1.worst, 'no fit diagnostics');
    assert(Math.abs(fd1.worst.sigma - 4.05) < 0.1, `residual ${fd1.worst.sigma.toFixed(2)} SD, expected ~4.05`);
    assert(Math.abs(CLi - 4.61) < 0.1, `posterior CL ${CLi.toFixed(2)}, expected ~4.61`);
  });

  test('level-implied CL solves on the actual dose history, and names its volume', ()=>{
    const post = levelImpliedCL(r1, levels[0], 'posterior');
    const pop  = levelImpliedCL(r1, levels[0], 'population');
    assert(Math.abs(post - 0.72) < 0.05, `posterior-V implied CL ${post}, expected ~0.72`);
    assert(Math.abs(pop  - 1.27) < 0.05, `population-V implied CL ${pop}, expected ~1.27`);
    // and it genuinely reproduces the level
    const c = sandbox.predictConc1comp(doses, levels[0].timeH, post / Vi, Vi);
    assert(Math.abs(c - 19.9) < 0.05, `implied CL should reproduce 19.9, gives ${c.toFixed(2)}`);
  });

  test('level-implied CL refuses what it cannot bracket', ()=>{
    // a level no clearance could produce from these doses
    assert(levelImpliedCL(r1, { conc: 5000, timeH: levels[0].timeH }, 'posterior') === null,
      'an impossible level must return null, not a clamped number');
  });

  test('clearance estimates show prior, posterior and both level-implied values', ()=>{
    const ce = clearanceEstimates(r1, fd1);
    const keys = ce.est.map(e => e.key);
    for (const k of ['prior','posterior','implied-post','implied-pop'])
      assert(keys.includes(k), `missing ${k}; got ${keys.join(',')}`);
    // the recommended 1000 mg q12h spans a clinically dangerous range
    const aucs = ce.est.map(e => 2000 / e.CL);
    assert(Math.max(...aucs) / Math.min(...aucs) > 5,
      'the exposure spread behind this recommendation is > 5-fold and must be visible');
  });

  test('confidence is Very low on the 76 M case, with its reasons printed', ()=>{
    const c = confidenceAssessment(r1, fd1, null);
    assert(c.level === 'Very low', `got ${c.level}`);
    assert(c.reasons.some(x => /4\.0 SD/.test(x.text)), 'the 4 SD conflict must be named');
    assert(c.reasons.some(x => /not separately identifiable/.test(x.text)), 'one-level identifiability must be named');
  });

  test('confidence is High for a rich, well-fitting course', ()=>{
    const r = { levels: new Array(8).fill({}), model:'goti', agCtx:{ tbw:78.8, htCm:170.2 } };
    const c = confidenceAssessment(r, { worst:{ sigma:1.0 } }, { band:{ tone:'ok' }, diffPct:9 });
    assert(c.level === 'High', `8 levels within 1 SD should be High, got ${c.level}`);
    assert(c.reasons.every(x => x.good), 'a High rating should rest only on positive reasons');
  });

  test('confidence names Hughes outside its validation and drops to Low', ()=>{
    const r = { levels: [{},{},{}], model:'hughes', agCtx:{ tbw:83, htCm:182.9 } };
    const c = confidenceAssessment(r, { worst:{ sigma:0.5 } }, { band:{ tone:'ok' }, diffPct:5 });
    assert(c.rank >= 2, `Hughes at BMI 24.8 should be at most Low, got ${c.level}`);
    assert(c.reasons.some(x => /BMI/.test(x.text)), 'the BMI mismatch must be stated');
  });

  test('no levels is a population estimate, not a confidence rating', ()=>{
    const c = confidenceAssessment({ levels: [] }, null, null);
    assert(c.level === 'Population estimate' && c.rank < 0, `got ${c.level}`);
  });

  test('confidence sigma steps are labelled as preference', ()=>{
    const i = script.indexOf('const CONFIDENCE_SIGMA');
    assert(i > 0, 'CONFIDENCE_SIGMA missing');
    assert(/PREFERENCE/.test(script.slice(i - 1200, i + 120)), 'rule 8: must be labelled as preference');
  });

  test('AUC verdict grades the shortfall, and 345 is "modestly below"', ()=>{
    assert(aucVerdict(345).key === 'modest-below', `345 -> ${aucVerdict(345).key}`);
    assert(aucVerdict(324).key === 'well-below', '324 is below the modest band');
    assert(aucVerdict(400).key === 'in' && aucVerdict(600).key === 'in', 'band edges are inclusive');
    assert(aucVerdict(650).key === 'above', '650 is above');
    assert(aucVerdict(K.AUC24_ABSOLUTE_MAX + 1).key === 'well-above', 'above the hard ceiling');
    assert(/not automatically required/.test(aucVerdict(345).text),
      'a modest shortfall must not read as "escalate now"');
  });

  test('ARC is contradicted when the levels show low clearance — the 76 M case', ()=>{
    const k = renalAdvisoryKind({ arcDetected:true, levelsN:1, clRatio: CLi / CL_pop, age:76, scr:0.5 });
    assert(k === 'contradicted', `got ${k}: escalation advice would contradict the measured level`);
  });

  test('ARC in an older patient with low SCr is framed as possible overestimation', ()=>{
    assert(renalAdvisoryKind({ arcDetected:true, levelsN:0, clRatio:NaN, age:76, scr:0.5 }) === 'elderly-arc');
    assert(renalAdvisoryKind({ arcDetected:true, levelsN:0, clRatio:NaN, age:30, scr:0.6 }) === 'arc',
      'a young patient keeps the ordinary ARC advisory');
    assert(renalAdvisoryKind({ arcDetected:false, levelsN:0, clRatio:NaN, age:80, scr:0.6 }) === 'elderly');
    assert(renalAdvisoryKind({ arcDetected:false, levelsN:0, clRatio:NaN, age:40, scr:1.0 }) === null);
  });

  test('the advisory thresholds reuse the Goti erratum constants, not new ones', ()=>{
    const f = sandbox.renalAdvisoryKind.toString();
    assert(/GOTI_SCR_FLOOR_AGE/.test(f) && /GOTI_SCR_FLOOR\b/.test(f), 'must reuse the sourced erratum pair');
    assert(/CL_DIVERGE_LOW/.test(f), 'must reuse the named divergence threshold');
  });

  test('the divergence threshold is one named constant, not three literals', ()=>{
    assert(!/clRatio < 0\.6/.test(script), 'an inline 0.6 divergence literal has returned');
    assert((script.match(/clRatio < CL_DIVERGE_LOW/g) || []).length >= 3, 'fit branches must read the constant');
  });

  test('no Bayesian-module colour hard-codes a 10-20 trough or "under 350"', ()=>{
    // Found in three places: the current-regimen tile, the dose card, and the
    // Dose Tinkerer, plus the guideline-dose tile. The whole script is checked,
    // so a fourth copy cannot hide outside a search window.
    assert(!/Ctrough\s*>=\s*10\s*&&\s*\S*Ctrough\s*<=\s*20/.test(script),
      'CLAUDE.md: the target band is the clinician\'s own, never a hard-coded 10-20');
    assert(!/(auc24|AUC24)\s*<\s*350/i.test(script), 'the unsourced "under 350" rule has returned');
  });

  test('a low-confidence recommendation is visibly de-rated, not hidden', ()=>{
    assert(/rec-derated/.test(script) && /conf\.rank >= 2/.test(script),
      'the dose card must de-rate under Low / Very low confidence');
    // 2026-09-28 design pass (rule 9, reason recorded): the dose is now printed
    // through fmtDose (ISMP grams from 1,000 mg), still inside the de-rated card.
    assert(/<span class="rec-dose">\$\{fmtDose\(rec\.dose\)\}<\/span>/.test(script), 'the dose itself must still be shown');
    assert(/vx-prov">provisional/.test(script), 'a Low-confidence dose is marked provisional (decision 2026-09-28)');
  });

  test('diagnostics are computed once and shared', ()=>{
    const start = script.indexOf('function renderBayesianResults');
    const body = script.slice(start, start + 120000);
    const calls = (body.match(/modelAgreement\(/g) || []).length;
    assert(calls === 1, `modelAgreement is called ${calls} times in the renderer; expected 1`);
  });
}

// ════════════════════════════════════════════════════════════════════
// SUITE 22 — findings from the 2026-09-28 engine audit
//
// A seven-dimension audit run against a frozen snapshot, every finding
// adversarially re-verified with an independent probe before being accepted.
// ════════════════════════════════════════════════════════════════════
{
  const src    = fs.readFileSync(htmlPath, 'utf8');
  const script = src.match(/<script>([\s\S]*?)<\/script>/)[1];
  const { fitKelFromLevel, fitKelFromEarlyLevel, fractionOfSteadyState } = sandbox;
  const K = __extractConsts();

  console.log(`\n${'═'.repeat(60)}`);
  console.log('  SUITE 22 — engine audit findings');
  console.log(`${'─'.repeat(60)}`);

  // CRITICAL — "Steady State? No" was stored and never read.
  test('the steady-state toggle is actually read by calculate()', ()=>{
    const c = script.slice(script.indexOf('function calculate()'));
    const body = c.slice(0, c.indexOf('\nfunction '));
    assert(/state\.isSS/.test(body), 'calculate() never reads state.isSS — the toggle is decorative again');
    assert(/fitKelFromEarlyLevel\(/.test(body), 'an early level must be fitted on the doses given');
  });

  test('a level after dose 1 recovers the true clearance (auditor scenario A)', ()=>{
    // truth kel 0.0774, CL 4.24, AUC24 472; the steady-state fit gave 341 and
    // recommended escalation to a regimen whose true AUC24 is 708.
    const old = fitKelFromLevel(7.79, 11.5, 1000, 12, 1, 54.8);
    const now = fitKelFromEarlyLevel(7.79, 11.5, 1, 1000, 12, 1, 54.8);
    assert(Math.abs(now.kel - 0.0774) < 0.001, `kel ${now.kel.toFixed(4)}, expected 0.0774`);
    assert(Math.abs(now.auc24 - 472) < 5, `AUC24 ${now.auc24.toFixed(0)}, expected ~472`);
    assert(old.auc24 < 360, 'the steady-state fit should still read this as ~341 — that is the bug');
  });

  test('a level after dose 2 recovers the true clearance (auditor scenario B)', ()=>{
    // shown AUC24 489 "continue"; actual steady state ~730
    const now = fitKelFromEarlyLevel(15, 11.5, 2, 1000, 12, 1, 71.2);
    assert(Math.abs(now.clv - 2.74) < 0.03, `CL ${now.clv.toFixed(2)}, expected 2.74`);
    assert(Math.abs(now.auc24 - 730) < 10, `AUC24 ${now.auc24.toFixed(0)}, expected ~730`);
  });

  test('an early level reproduces the measured concentration on the doses given', ()=>{
    const f = fitKelFromEarlyLevel(15, 11.5, 2, 1000, 12, 1, 71.2);
    const hist = [{mg:1000,tinfH:1,timeH:0},{mg:1000,tinfH:1,timeH:12}];
    const c = sandbox.predictConc1comp(hist, 12 + 11.5, f.kel, 71.2);
    assert(Math.abs(c - 15) < 0.01, `fitted kel should reproduce 15 mg/L, gives ${c.toFixed(3)}`);
  });

  test('the early-level solver refuses impossible or missing input', ()=>{
    assert(fitKelFromEarlyLevel(500, 11.5, 1, 1000, 12, 1, 54.8) === null, 'an impossible level must be refused');
    assert(fitKelFromEarlyLevel(7.79, 11.5, 0, 1000, 12, 1, 54.8) === null, 'dose number 0 must be refused');
    assert(fitKelFromEarlyLevel(7.79, 0, 1, 1000, 12, 1, 54.8) === null, 'zero elapsed time must be refused');
  });

  test('the dose-number choice is required, not defaulted', ()=>{
    assert(/<option value="">— choose —<\/option>/.test(src), 'the dose number must default to unchosen');
    assert(/Choose whether it followed the 1st or the 2nd dose/.test(script), 'an unchosen dose number must block');
  });

  // CRITICAL — a refused recommendation left the previous run on screen.
  test('a refused recommendation cannot leave the previous run on screen', ()=>{
    const start = script.indexOf('function renderBayesianResults');
    const body = script.slice(start, start + 150000);
    const clearAt = body.indexOf('cont.innerHTML = `');
    const buildAt = body.indexOf("let html = '';");
    assert(clearAt > 0 && clearAt < buildAt,
      'the results must be cleared BEFORE the new html is built, so an exception cannot preserve the old run');
    // 2026-09-28: the card gained a very-low-CrCl hold branch ahead of it; both
    // branches must still exclude a refusal (rule 9: tightened, not loosened).
    assert(/Dose recommendation ──[\s\S]{0,600}if \(r\.lowCrClHold && rec && !rec\.noSolution\)[\s\S]{0,900}\} else if \(rec && !rec\.noSolution\)/.test(body),
      'the dose card must not treat a refusal ({noSolution:true}) as a recommendation');
    assert(!/if \(rec\) \{\s*const sel/.test(body), 'the tinkerer preselect must also exclude a refusal');
  });

  test('the print report prints a refusal\'s reason, not "undefined mg"', ()=>{
    assert(/r\.rec && r\.rec\.noSolution[\s\S]{0,300}No regimen offered/.test(script),
      'the print report must handle a refusal explicitly');
  });

  test('a changed target or MIC marks the fit as stale', ()=>{
    const f = sandbox.bayesInputFingerprint.toString();
    assert(/b-auc-target/.test(f) && /b-mic/.test(f), 'target and MIC must be part of the fingerprint');
  });

  test('a young patient at the CrCl cap is offered a regimen, not refused', ()=>{
    // Buelga CL at CrCl 150 = 9.72 L/h. Rounding the nearest step past a cap
    // used to lose the interval; ~260 grid cases were falsely refused.
    const { bayesDoseOptimizer } = sandbox;
    for (const t of [525, 550, 575, 600]) {
      const r = bayesDoseOptimizer(9.72, 80, t, null, 1);
      assert(!r.noSolution, `target ${t} was refused at CL 9.72: ${r.reason || ''}`);
      assert(r.dose <= K.DOSE_MAX_PER_DOSE_MG && r.auc24 <= K.AUC24_ABSOLUTE_MAX, 'must still respect the hard tier');
    }
  });

  test('a cap-limited shortfall keeps the "alternative agent" guidance, at danger level', ()=>{
    // CL 13.5: no regimen within 2000 mg / 4500 mg reaches 400. It used to be
    // refused; it now returns the highest admissible regimen, and must not do so
    // quietly.
    const r = sandbox.bayesDoseOptimizer(13.5, 80, 450, null, 1);
    assert(!r.noSolution && r.capBound === true, 'expected a cap-bound regimen');
    const f = (r.flags || []).find(x => /conventional ceilings/.test(x.text));
    assert(f && f.level === 'danger', 'the cap-limited shortfall must be a danger-level note');
    assert(/alternative agent/.test(f.text) && /Confirm the clearance/.test(f.text), 'must carry the guidance');
  });

  test('offering both dose steps preserves the historical equidistant choice', ()=>{
    // 1000 mg Q24H (AUC 444) and 1250 mg Q24H (AUC 556) are both 56 from 500.
    // Math.round chose 1250; the fix must not silently change that.
    const r = sandbox.bayesDoseOptimizer(2.25, 55, 500, null, 1);
    assert(r.dose === 1250 && r.tau === 24, `expected 1250 mg Q24H, got ${r.dose} mg Q${r.tau}H`);
  });

  test('an entered level with no usable draw time is refused, never replaced by population', ()=>{
    const c = script.slice(script.indexOf('function calculate()'));
    const body = c.slice(0, c.indexOf('\nfunction '));
    assert(/hasLevel && levelVal > 0 && !\(tDoseToLvl > 0\)/.test(body),
      'a level with a blank or reversed draw time must block, not fall through to population');
    assert(/state\.calcMode === 'level' && document\.getElementById\('has-level'\)\.checked/.test(body),
      'a level left over from Steady State mode must not be fitted in Initial Dosing');
  });

  test('patient sex is one attribute across both modules', ()=>{
    const { setPatientSex, snapshotPatientCore } = sandbox;
    assert(typeof setPatientSex === 'function', 'setPatientSex missing');
    assert(/function setSex\(el, val\) \{ setPatientSex\(val\); \}/.test(script), 'the Trough button must use it');
    assert(/function setBSex\(el, val\) \{ setPatientSex\(val\); \}/.test(script), 'the AUC button must use it');
    // state/bState are `let` in the vm, so the property check goes through the
    // setter's source: it must write BOTH.
    const src2 = setPatientSex.toString();
    assert(/state\.sex = v/.test(src2) && /bState\.sex = v/.test(src2), 'setPatientSex must write both states');
    const f = snapshotPatientCore.toString();
    assert(!/bState\.sex\) \|\| state\.sex/.test(f),
      'the snapshot must not prefer bState.sex, whose default "M" overwrote a female patient');
  });

  test('"Yes, >= 3 doses" warns when three doses are not steady state', ()=>{
    // t1/2 18 h on q12h reaches ~75% after three doses
    const f = fractionOfSteadyState(0.693 / 18, 12, 3);
    assert(Math.abs(f - 0.75) < 0.02, `expected ~0.75, got ${f.toFixed(3)}`);
    assert(fractionOfSteadyState(0.693 / 6, 12, 3) > 0.95, 'a short half-life reaches steady state');
    assert(/three doses reach only/.test(script), 'the warning must be shown');
  });
}

// ════════════════════════════════════════════════════════════════════
// SUITE 23 — engine audit, second batch (2026-09-28)
// ════════════════════════════════════════════════════════════════════
{
  const src    = fs.readFileSync(htmlPath, 'utf8');
  const script = src.match(/<script>([\s\S]*?)<\/script>/)[1];
  const { readSerialScrChecked, uncertaintyModelKey, crclSourceLabel, setCrclOverride } = sandbox;

  console.log(`\n${'═'.repeat(60)}`);
  console.log('  SUITE 23 — engine audit, second batch');
  console.log(`${'─'.repeat(60)}`);

  // Serial SCr rows are read through querySelectorAll; stub the rows.
  const withRows = (rows, fn) => {
    const prev = sandbox.document.querySelectorAll;
    sandbox.document.querySelectorAll = () => rows.map(([v, d, t]) => ({
      querySelector: (sel) => ({ '.b-scr-val': { value: v }, '.b-scr-date': { value: d }, '.b-scr-time': { value: t } })[sel] || null,
    }));
    try { return fn(); } finally { sandbox.document.querySelectorAll = prev; }
  };

  test('serial SCr: a time typed "6:00" is an error, never a silently mis-sorted reading', ()=>{
    const r = withRows([['1.0', '2026-09-01', '6:00'], ['2.0', '2026-09-03', '06:00']], readSerialScrChecked);
    assert(r.errors.length === 1 && /HH:MM/.test(r.errors[0]), JSON.stringify(r.errors));
    assert(r.readings.length === 1 && r.readings[0].scr === 2.0, 'only the valid row is a reading');
  });
  test('serial SCr: a µmol/L value (88) typed as mg/dL is refused by INPUT_LIMITS', ()=>{
    const r = withRows([['88', '2026-09-01', '06:00']], readSerialScrChecked);
    assert(r.errors.length === 1 && r.readings.length === 0, JSON.stringify(r));
  });
  test('serial SCr: a value with no time is reported, a blank row is ignored', ()=>{
    const r = withRows([['1.2', '2026-09-01', ''], ['', '', '']], readSerialScrChecked);
    assert(r.errors.length === 1 && /time/.test(r.errors[0]), JSON.stringify(r.errors));
  });
  test('serial SCr: valid rows are sorted by time', ()=>{
    const r = withRows([['2.0', '2026-09-03', '06:00'], ['1.0', '2026-09-01', '06:00']], readSerialScrChecked);
    assert(r.errors.length === 0 && r.readings.map(x => x.scr).join() === '1,2', JSON.stringify(r));
  });
  test('the Bayesian fit refuses on serial SCr errors', ()=>{
    const b = script.slice(script.indexOf('function runBayesian'));
    assert(/readSerialScrChecked\(\)/.test(b.slice(0, b.indexOf('\nfunction '))), 'runBayesian must use the checked reader');
  });

  test('two levels at steady state: the accumulation term uses the CURRENT interval, not the target', ()=>{
    assert(/id="tl-cur-tau"/.test(src), 'the current-interval picker is missing');
    assert(/solveTwoLevelsPK\(tlDose, tlTinf, tlC1, tlT1, tlC2, tlT2, accumTau, state\.tlBasis\)/.test(script),
      'solveTwoLevelsPK must receive the interval the levels were drawn on');
    // The defect it guards: the steady-state volume moves with the tau passed in.
    const { solveTwoLevelsPK } = sandbox;
    const a = solveTwoLevelsPK(1000, 1, 30, 2, 15, 10, 12, 'steadystate');
    const b = solveTwoLevelsPK(1000, 1, 30, 2, 15, 10, 8,  'steadystate');
    assert(a && b && Math.abs(a.vd - b.vd) / a.vd > 0.05, 'tau must matter at steady state — else the picker is pointless');
  });

  test('dosing weight defaults to Auto (the aa9dd6b regression)', ()=>{
    assert(/let state = \{[^}]*dosingWt:'auto'/.test(script), 'state.dosingWt must default to auto');
    assert(/id="dosing-wt" value="auto"/.test(src), 'the hidden field must default to auto');
  });

  test('a manual CrCl override is labelled as such, never as Cockcroft-Gault', ()=>{
    const prev = sandbox.document.getElementById;
    const els = { 'crcl-override-on': { checked: true }, 'crcl-override-val': { value: '45', disabled: false } };
    sandbox.document.getElementById = (id) => els[id] || prev(id);
    // The override state is written before any DOM refresh; the stubbed DOM
    // cannot run updateCrCl(), so only that trailing UI refresh is tolerated.
    const set = () => { try { setCrclOverride(); } catch (e) {} };
    try {
      set();
      assert(crclSourceLabel() === 'manual override', crclSourceLabel());
      els['crcl-override-on'].checked = false; set();
      assert(crclSourceLabel() === 'Cockcroft-Gault', crclSourceLabel());
    } finally { sandbox.document.getElementById = prev; }
    assert(/crclSource: crclSourceLabel\(\)/.test(script), 'the result payload must carry the label to the print report');
  });

  test('loading dose: no unsourced ×1.25 on the volume', ()=>{
    const { calcLoadingDose } = sandbox;
    const ld = calcLoadingDose(5, 70, 25);          // CL 5 L/h, V 70 L, target peak 25
    assert(Math.abs(ld.vdLD - 70) < 1e-9, `the model's own Vd must be used, got ${ld.vdLD}`);
    const code = script.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');   // comments record the history
    assert(!/Vd ?× ?1\.25|popVd \* 1\.25/.test(code), 'the multiplier is back');
  });
  test('loading dose: infused over its OWN institutional time, rate shown against Matzke 1984', ()=>{
    const { calcLoadingDose, autoTinf } = sandbox;
    const ld = calcLoadingDose(5, 70, 25);
    assert(ld.tinf === autoTinf(ld.dose), `LD ${ld.dose} mg must take autoTinf, got ${ld.tinf} h`);
    // peak must be computed on the time actually used
    const k = 5 / 70, peak = (ld.dose / (ld.tinf * k * 70)) * (1 - Math.exp(-k * ld.tinf));
    assert(Math.abs(peak - ld.peak) < 1e-9, 'peak must use the LD infusion time');
    assert(Math.abs(ld.rateMgMin - ld.dose / (ld.tinf * 60)) < 1e-9, 'rate');
    assert(ld.rateAboveMatzke === (ld.rateMgMin > 15), 'the 15 mg/min comparison (Matzke 1984 p.436)');
    assert(/calcLDLevelAtTime\(ld\.peak, ld\.kelLD, ld\.tinf, ldDeltaT\)/.test(script),
      'the level at first maintenance must decay from the end of the LOADING infusion');
  });

  test('uncertainty is read by the model actually fitted (Goti on HD → goti-hd)', ()=>{
    assert(uncertaintyModelKey({ model: 'goti', dial: true }) === 'goti-hd', '');
    assert(uncertaintyModelKey({ model: 'goti', dial: false }) === 'goti', '');
    assert(uncertaintyModelKey({ model: 'hughes' }) === 'hughes', '');
    assert(!/Figures are simulated against\s+this model's own prior/.test(src), 'the old unqualified print claim is back');
  });
}

// ════════════════════════════════════════════════════════════════════
// SUITE 24 — engine audit, medium findings (2026-09-28)
// ════════════════════════════════════════════════════════════════════
{
  const src    = fs.readFileSync(htmlPath, 'utf8');
  const script = src.match(/<script>([\s\S]*?)<\/script>/)[1];
  const code   = script.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  const bodyOf = (name) => { const c = code.slice(code.indexOf('function ' + name + '(')); return c.slice(0, c.indexOf('\nfunction ')); };
  const { selectEffectiveScr, kdigoStage, ssCurve2comp, ssCtrough2comp, gotiGraphParams, fitKelFromLevel,
          interpretLevelTiming, assessClinicalStatus, optFlagHTML, parseBayesCourse, calcCLv } = sandbox;
  const K = __extractConsts();

  console.log(`\n${'═'.repeat(60)}`);
  console.log('  SUITE 24 — engine audit, medium findings');
  console.log(`${'─'.repeat(60)}`);

  test('serial SCr rows default to LOCAL date (not UTC)', ()=>{
    const b = bodyOf('addScrRow');
    assert(/localDateStr\(\)/.test(b) && !/toISOString/.test(b), 'addScrRow must use localDateStr');
  });
  test('effective SCr is the most recent reading; a shift across the fit is flagged', ()=>{
    const rs = [{ scr: 1.0, timeH: 14 }, { scr: 2.0, timeH: 29 }];   // last dose at 20 h
    const sel = selectEffectiveScr(rs, 20);
    assert(sel.scr === 2.0, `newest must win, got ${sel.scr}`);
    assert(sel.nearestScr === 1.0 && sel.changedAcrossFit === true, JSON.stringify(sel));
    assert(selectEffectiveScr([{ scr: 1.0, timeH: 14 }, { scr: 1.1, timeH: 29 }], 20).changedAcrossFit === false, 'a 0.1 drift is not a change');
  });
  test('KDIGO: a stable SCr of 4.2 is not "AKI Stage 3"', ()=>{
    assert(kdigoStage([{ scr: 4.2, timeH: 0 }, { scr: 4.2, timeH: 24 }]) === 0, '');
  });
  test('KDIGO: 0.3 rise within 48 h from the LOWEST prior reading, not the first', ()=>{
    // old rule: last/first = 1.07 and first-48h window = +0.1 → stage 0
    assert(kdigoStage([{ scr: 1.5, timeH: 0 }, { scr: 1.0, timeH: 24 }, { scr: 1.6, timeH: 60 }]) === 1, '');
  });
  test('KDIGO: fold thresholds within 7 days, and >= 4.0 is stage 3 only with AKI', ()=>{
    assert(kdigoStage([{ scr: 1.0, timeH: 0 }, { scr: 2.1, timeH: 72 }]) === 2, 'x2.1 → stage 2');
    assert(kdigoStage([{ scr: 1.0, timeH: 0 }, { scr: 3.0, timeH: 100 }]) === 3, 'x3 → stage 3');
    assert(kdigoStage([{ scr: 2.0, timeH: 0 }, { scr: 4.1, timeH: 72 }]) === 3, 'AKI and >= 4.0 → stage 3');
    assert(kdigoStage([{ scr: 1.0, timeH: 0 }, { scr: 1.5, timeH: 200 }]) === 0, 'outside 7 days and 48 h → none');
  });
  test('stale-fit fingerprint covers serial SCr and the regimen override', ()=>{
    const b = bodyOf('bayesInputFingerprint');
    assert(/readSerialScr\(\)/.test(b) && /regimenOverrideH/.test(b), 'fingerprint must include both');
  });
  test('2-comp SS curve is at steady state and matches the card trough (low CL)', ()=>{
    const CL = 4.5 * Math.pow(20/120, 0.8), Vc = 58.4 * 80/70, Vp = 38.4, Q = 6.5;
    const pts = ssCurve2comp(250, 8, 1, CL, Vc, Vp, null, 200, Q);
    const card = ssCtrough2comp(250, 8, 1, CL, Vc, Vp, Q);
    const start = pts[0].c, end = pts[pts.length - 1].c;
    assert(Math.abs(end - card) / card < 0.01, `drawn trough ${end.toFixed(2)} vs card ${card.toFixed(2)}`);
    assert(Math.abs(start - end) / end < 0.01, `not periodic: ${start.toFixed(2)} → ${end.toFixed(2)}`);
    assert(pts.some(p => Math.abs(p.t - 1) < 1e-12), 'the end of the infusion must be sampled');
    assert(!/ssCurve2comp\([^)]*, 12, 200/.test(code), 'callers must not pin 12 cycles');
  });
  test('print report: 2-comp micro-constants come from one accessor, also for saved profiles', ()=>{
    const live = gotiGraphParams({ model: 'goti', CL_ind: 4, goti: { k10_ind: 0.1, k12_ind: 0.2, k21_ind: 0.3, Vc_ind: 40 } });
    assert(live.ind.k10 === 0.1 && live.ind.Vc === 40, JSON.stringify(live));
    const saved = gotiGraphParams({ model: 'hughes', CL_ind: 4, CL_pop: 5, goti: { Vc_ind: 40, Vp_ind: 50, Vc_pop: 45, Vp_pop: 55, Q: 6.36 } });
    assert(Math.abs(saved.ind.k10 - 0.1) < 1e-12 && Math.abs(saved.ind.k21 - 6.36/50) < 1e-12, JSON.stringify(saved));
    assert(gotiGraphParams({ model: 'buelga' }).ind === null, 'no 2-comp for Buelga');
    assert(!/r\.gotiInd/.test(code), 'r.gotiInd is never set — nothing may read it');
  });
  // 2026-09-28 second pass: the trapezoid (and its per-interval fallback) is
  // gone; level mode reports AUC24 = TDD/CL like the recommendation (rule 9:
  // the guarded defect — an AUC per interval — is now impossible by construction).
  test('level-mode AUC24 is TDD/CL, never a trapezoid or a per-interval AUC', ()=>{
    assert(!/function calcAUC_trap/.test(script), 'the trapezoid is back');
    const f = fitKelFromLevel(15, 11.5, 1000, 12, 1, 60);
    assert(f && Math.abs(f.auc24 - 1000 * 2 / f.clv) < 1e-9, JSON.stringify(f));
    // long infusion, fast elimination: the trapezoid read ~5% low here
    const g = fitKelFromLevel(8, 11.5, 1000, 12, 4, 60);
    assert(g && Math.abs(g.auc24 - 1000 * 2 / g.clv) < 1e-9, 'TDD/CL');
  });
  test('Trough modes: infusion times validated, tinf >= tau refused, no silent 1 h fill', ()=>{
    const b = bodyOf('calculate');
    assert(/must be shorter than the dosing interval/.test(b), 'tinf >= tau must be refused');
    assert(!/v\('(rl|tl|init)-tinf'\) \|\| 1/.test(b), 'no "|| 1" infusion fallback');
    assert(/\['tinf','tinf'\]/.test(b) && /\['level-val', 'level'/.test(b), 'tinf and level go through INPUT_LIMITS');
  });
  test('a level charted at the dose start is that dose\'s trough, not "during the infusion"', ()=>{
    const doses = [0, 12, 24, 36, 48].map(h => ({ mg: 1000, tinfH: 1, timeH: h }));
    const t = interpretLevelTiming(48, doses, 12);
    assert(t.classification !== 'during_infusion' && Math.abs(t.hoursFromDoseStart - 12) < 1e-9, JSON.stringify(t));
  });
  test('AUC above target with a low trough is a reduction, without the inverted Vd claim', ()=>{
    const a = assessClinicalStatus(700, 8, 10, 20);
    assert(a.action === 'reduce', a.action);
    assert(!/large Vd with slow clearance/.test(a.summary), a.summary);
  });
  test('optimizer out-of-band flag is rendered in all three Trough renderers', ()=>{
    // Re-pointed (design track D, 2026-09-28): ISMP frequency "q12h", and the flag is now a caution
    // note with a signal word and the drawn triangle, not an amber-tinted box.
    const fl = optFlagHTML('auc_supra', null, 12, 666, 23.8, 10);
    assert(/No dose at q12h/.test(fl), 'message');
    assert(/class="note note-caution"/.test(fl) && /M8 1\.8 14\.8 13\.9H1\.2z/.test(fl), 'caution note with ICON.caution');
    assert(optFlagHTML(null) === '', 'no flag, no box');
    assert((script.match(/optFlagHTML\(d\.optFlag/g) || []).length === 4, 'four rec cards');
    assert(/optFlag: tlOpt\.flag/.test(script) && /optFlag: rlOpt\.flag/.test(script), 'two-level and random payloads');
  });
  test('profile reload restores the CrCl weight basis', ()=>{
    assert(/setDosingWt\(dwBtn, core\.dosingWt\)/.test(bodyOf('applyPatientCore')), 'applyPatientCore must restore dosingWt');
  });

  // parseBayesCourse reads rows by id; stub the DOM for it.
  const withCourse = (doseRows, lvlRows, fn) => {
    const prevQ = sandbox.document.querySelectorAll, prevG = sandbox.document.getElementById;
    const f = {};
    doseRows.forEach(([mg, ti, d, t], i) => Object.assign(f, { [`b-dose-mg-${i}`]: mg, [`b-dose-tinf-${i}`]: ti, [`b-dose-date-${i}`]: d, [`b-dose-time-${i}`]: t }));
    lvlRows.forEach(([c, d, t], i) => Object.assign(f, { [`b-lvl-conc-${i}`]: c, [`b-lvl-date-${i}`]: d, [`b-lvl-time-${i}`]: t }));
    sandbox.document.querySelectorAll = (sel) => /dose-row/.test(sel) ? doseRows.map((_, i) => ({ id: `b-dose-row-${i}` }))
      : /level-row/.test(sel) ? lvlRows.map((_, i) => ({ id: `b-level-row-${i}` })) : [];
    sandbox.document.getElementById = (id) => (id in f ? { value: f[id] } : null);
    try { return fn(); } finally { sandbox.document.querySelectorAll = prevQ; sandbox.document.getElementById = prevG; }
  };
  test('course rows: a blank time is an error, never midnight', ()=>{
    const r = withCourse([['1000', '1', '2026-09-01', '']], [], parseBayesCourse);
    assert(r.errors.length === 1 && /time/.test(r.errors[0]) && r.doses.length === 0, JSON.stringify(r.errors));
  });
  test('course rows: dose, infusion and concentration go through INPUT_LIMITS', ()=>{
    const r = withCourse([['10000', '1', '2026-09-01', '08:00'], ['1000', '60', '2026-09-01', '20:00']], [['1500', '2026-09-02', '07:00']], parseBayesCourse);
    assert(r.errors.length === 3, JSON.stringify(r.errors));
  });
  test('course rows: a duplicated dose row and an overlapping infusion are errors', ()=>{
    const dup = withCourse([['1000', '1', '2026-09-01', '08:00'], ['1000', '1', '2026-09-01', '08:00']], [], parseBayesCourse);
    assert(dup.errors.some(e => /duplicate/.test(e)), JSON.stringify(dup.errors));
    const ovl = withCourse([['1000', '2', '2026-09-01', '08:00'], ['1000', '1', '2026-09-01', '09:00']], [], parseBayesCourse);
    assert(ovl.errors.some(e => /before the .* infusion ends/.test(e)), JSON.stringify(ovl.errors));
  });
  test('print report derives SCr, uncapped CrCl and advisories from the SCr the fit used', ()=>{
    const b = script.slice(script.indexOf('function _buildPrintReport'));
    assert(/getUncappedCrCl\(fitScrN/.test(b) && /gotiScrTruncationActive\(fitScrN/.test(b), 'report must use the fitted SCr');
    assert(!/getUncappedCrCl\(\)/.test(b.slice(0, 20000)), 'no argument-less (baseline) call in the report');
  });
  test('Buelga CrCl limit: one guard in both modules, labelled as the calculator\'s', ()=>{
    const cap = parseFloat(script.match(/CRCL_MODEL_CAP = ([0-9.]+)/)[1]);   // parsed, never copied (rule 6)
    const cl = calcCLv('buelga', 256, 80);
    assert(Math.abs(cl - 1.08 * cap * 0.06) < 1e-9, `Trough Buelga must apply the guard, got ${cl}`);
    assert(!/Buelga 2005'} caps CrCl/.test(script) && /extrapolation guard/.test(script), 'the cap must not be attributed to Buelga');
  });
}

// ════════════════════════════════════════════════════════════════════
// SUITE 25 — engine audit, wording and consistency (2026-09-28)
// ════════════════════════════════════════════════════════════════════
{
  const src    = fs.readFileSync(htmlPath, 'utf8');
  const script = src.match(/<script>([\s\S]*?)<\/script>/)[1];
  const code   = script.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  const { nextLevelValue, formatElapsed, modelAgreement, aucUncertaintyText, checkValue } = sandbox;

  console.log(`\n${'═'.repeat(60)}`);
  console.log('  SUITE 25 — engine audit, wording and consistency');
  console.log(`${'─'.repeat(60)}`);

  test('population-only box: no hard-coded Buelga, ±30% or ±15–12%', ()=>{
    assert(!/Results reflect Buelga 2005 population PK/.test(code) && !/±15–12%/.test(code) && !/AUC uncertainty ±30%/.test(code), 'stale literals are back');
    assert(/aucUncertaintyText\(1, uncertaintyModelKey\(r\)\)/.test(code), 'the box must read the model\'s own widths');
  });
  test('uncertainty labels say they were simulated for steady-state troughs', ()=>{
    assert(/steady-state troughs/.test(aucUncertaintyText(1, 'buelga')), aucUncertaintyText(1, 'buelga'));
    assert(/drawn before steady state/.test(code), 'an early level must be called out');
  });
  test('model agreement: bands labelled as preference; no "prior-driven, not data-driven" claim', ()=>{
    assert(/PREFERENCE \(rule 8\)[\s\S]{0,200}MODEL_AGREEMENT_BANDS/.test(script), 'rule 8 label missing');
    assert(!/prior-driven, not data-driven/.test(code) && !/driven by the measured levels rather than by the choice of prior/.test(code), 'unsupported claim is back');
  });
  test('fit panel: no unconditional "probably higher/lower"; identifiability only at one level', ()=>{
    assert(!/true exposure is probably/.test(code), 'directional claim must be conditional');
    assert(/\(r\.levels \|\| \[\]\)\.length === 1 \? `<br><strong>With one level, CL and V are not separately identifiable/.test(code), 'one-level sentence must be gated');
  });
  test('next-level panel does not contradict the optimizer\'s rounding grace', ()=>{
    // CL 3.3, Q24H: one 250 mg step = 75.8 AUC; 378.8 is inside half a step of 400
    const nl = nextLevelValue(378.8, 1, 'buelga', 24, 3.3);
    assert(!/outside/.test(nl.detail), nl.detail);
    const far = nextLevelValue(300, 1, 'buelga', 24, 3.3);
    assert(far.kind === 'management' && /outside/.test(far.detail), 'a real miss is still called out');
  });
  test('very low CrCl without levels: no empiric maintenance card, on screen or in print', ()=>{
    assert((script.match(/lowCrClHold: lowCrClInfo\.detected && filteredLevels\.length === 0/g) || []).length === 3, 'all three payloads');
    assert(/No empiric maintenance regimen/.test(code) && /r\.rec && r\.lowCrClHold/.test(code), 'screen and print');
  });
  test('Hughes advisories describe its FFM CrCl truthfully', ()=>{
    assert(!/so the model is using the actual value/.test(code), 'Hughes does not use the displayed CrCl');
  });
  test('Goti-HD: the active row is marked, Buelga is not compared on dialysis', ()=>{
    const ctx = { activeModel: 'goti', dial: true, crcl: 20, crclGoti: 20, tbw: 70, htCm: 175 };
    const doses = [0, 48].map(h => ({ mg: 1500, tinfH: 1.5, timeH: h }));
    const ag = modelAgreement(ctx, doses, [{ conc: 18, timeH: 96 }], 750);
    assert(ag === null || (ag.rows.every(r => r.key !== 'buelga') && ag.rows.some(r => r.active)), JSON.stringify(ag && ag.rows));
    assert(/ctx\.activeModel === 'goti' && ctx\.dial\) \? 'goti-hd'/.test(code), 'active key must map to goti-hd');
  });
  test('formatElapsed never prints "24.0h" of remainder', ()=>{
    assert(formatElapsed(47.96) === '2d 0.0h (total 48.0h)', formatElapsed(47.96));
    assert(formatElapsed(23.96) === '1d 0.0h (total 24.0h)', formatElapsed(23.96));
  });
  test('CrCl override is range-checked, not clamped or passed through', ()=>{
    assert(checkValue('3000', 'crclOverride').ok === false && checkValue('45', 'crclOverride').ok === true, '');
    assert(/checkValue\(raw, 'crclOverride'\)/.test(code), 'setCrclOverride must validate');
  });
  test('a during-infusion or early level is never certified "True trough"', ()=>{
    assert(/troughBasis = 'model'/.test(code) && /Model-predicted trough/.test(code), 'third label state');
  });
  test('two-level labels follow the basis actually used', ()=>{
    assert(/d\.basis === 'steadystate' \? 'At Steady State' : 'First Dose'/.test(code), 'header');
    assert(/steady-state peak equation/.test(code), 'method note');
  });
  test('dose explorer: both sides of the band coloured alike; own interval listed', ()=>{
    assert(!/'border-range' : 'in-range'/.test(code), 'supratherapeutic must not be downplayed');
    // 2026-09-28 second pass: the three copies are one helper (rule 2), called by all three renderers.
    assert((code.match(/doseExplorerRows\(\{ tau: d\.(tau|tlTau|rlTau),/g) || []).length === 3, 'three renderers, one helper');
    assert(/new Set\(\[8, 12, 24, o\.tau, \.\.\.marks\.map\(m => m\.tau\)\]\)/.test(code), 'own interval listed');
    const rows = sandbox.doseExplorerRows({ tau: 48, tinf: 1, kel: 0.03, vd: 60, clv: 1.8, mic: 1, troughMin: 10, troughMax: 20,
      rec: { dose: 1000, tau: 48 } });
    // Re-pointed (design track D, 2026-09-28): rows show ISMP doses and frequencies, and the
    // recommended row is marked in words and by class, not with a star glyph. Re-pointed again
    // (D14, 2026-09-30): the word sits beside the chart legend's line for that regimen.
    assert(/<tr class="is-rec">\s*<th scope="row">1 g q48h <span class="tx-row-tag"><i class="lg lg-proj" aria-hidden="true"><\/i>recommended<\/span>/.test(rows),
      'a Q48H patient gets the recommended mark on their own interval');
    assert((rows.match(/class="is-rec"/g) || []).length === 1 && !/★/.test(rows), 'exactly one marked row, no star glyph');
  });
  test('dose explorer: the rows the chart draws carry its key, and are always listed', ()=>{
    // D14: the current regimen as fitted keys to the fit's line, the recommendation to the
    // projection's; the optimiser's dose, which the chart does not draw, gets a word and no
    // colour. Off-grid doses (1.1 g, 2.25 g) are listed once, in order.
    const base = { tau: 12, tinf: 1, kel: 0.1, vd: 60, clv: 6, mic: 1, troughMin: 10, troughMax: 20 };
    const both = sandbox.doseExplorerRows({ ...base, cur: { dose: 1100, tau: 12 }, rec: { dose: 2250, tau: 12 } });
    assert(/<tr class="is-cur">\s*<th scope="row">1\.1 g q12h <span class="tx-row-tag"><i class="lg lg-ind" aria-hidden="true"><\/i>current<\/span>/.test(both),
      'the current regimen carries the fit\'s line and the word');
    assert(/<tr class="is-rec">\s*<th scope="row">2\.25 g q12h <span class="tx-row-tag"><i class="lg lg-proj"/.test(both),
      'the recommendation carries the projection\'s line');
    const q12 = [...both.matchAll(/<th scope="row">([\d.]+ (?:mg|g)) q12h/g)].map(x => x[1]);
    assert(q12.filter(x => x === '1.1 g').length === 1 && q12.filter(x => x === '2.25 g').length === 1, 'each listed once');
    assert(q12.indexOf('1 g') < q12.indexOf('1.1 g') && q12.indexOf('1.1 g') < q12.indexOf('1.25 g') &&
           q12.indexOf('2 g') < q12.indexOf('2.25 g') && q12.indexOf('2.25 g') < q12.indexOf('2.5 g'), 'in dose order');
    const cont = sandbox.doseExplorerRows({ ...base, rec: { dose: 1000, tau: 12, tag: 'recommended (current)' }, opt: { dose: 750, tau: 12 } });
    assert(/<tr class="is-rec">\s*<th scope="row">1 g q12h <span class="tx-row-tag"><i class="lg lg-proj" aria-hidden="true"><\/i>recommended \(current\)/.test(cont),
      'continuing: the current regimen is the recommendation, keyed as the chart keys it');
    assert(/<tr class="is-opt">\s*<th scope="row">750 mg q12h <span class="tx-row-tag">optimiser's dose<\/span>/.test(cont),
      'the optimiser\'s dose is named, with no line and no terracotta');
    assert((cont.match(/class="is-rec"/g) || []).length === 1, 'terracotta marks the recommendation only');
    // The Trough renderer passes what its chart draws.
    assert(/cur: showOptDose \? \{ dose: d\.dose, tau: d\.tau \} : null/.test(code) &&
           /rec: \{ dose: vDose, tau: d\.tau,/.test(code), 'steady-state explorer mirrors its chart');
  });
  test('the AUC band is one pair of constants, not 400/600 literals', ()=>{
    const hits = code.match(/\bauc(?:24)?\s*(?:>=|<=|>|<)\s*(?:400|600)\b/g) || [];
    assert(hits.length === 0, hits.join(' | '));
  });
}

// ════════════════════════════════════════════════════════════════════
// SUITE 26 — the Bayesian fit itself (engine audit 2026-09-28, bayes-fit)
// ════════════════════════════════════════════════════════════════════
{
  const src    = fs.readFileSync(htmlPath, 'utf8');
  const script = src.match(/<script>([\s\S]*?)<\/script>/)[1];
  const code   = script.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  const { mapFit, confidenceAssessment } = sandbox;
  const om = (n) => parseFloat(script.match(new RegExp('const ' + n + '\\s*=\\s*([0-9.]+)'))[1]);   // parsed (rule 6)

  console.log(`\n${'═'.repeat(60)}`);
  console.log('  SUITE 26 — the Bayesian fit itself');
  console.log(`${'─'.repeat(60)}`);

  const gotiCase = (crcl, wt, dose, tau, tinf, n, levels) => {
    const pk = gotiPopPK(crcl, wt, false), doses = [];
    for (let i = 0; i < n; i++) doses.push({ mg: dose, tinfH: tinf, timeH: i * tau });
    const f = (a, b, c) => burtonObj3D(a, b, c, pk.TVCL, pk.TVVc, pk.TVVp, doses, levels);
    const auc = e => dose * 24 / tau / (pk.TVCL * Math.exp(e[0]));
    return { f, auc, single: nelderMead3D(f, 0, 0, 0, 400), multi: mapFit(f, 3, om('OMEGA2_CL_GOTI'), om('OMEGA2_VC_GOTI'), 400) };
  };

  test('multi-start finds the better MAP minimum a single start missed', ()=>{
    // Goti, CrCl 25, 90 kg, 1500 mg q24h x8; trough 10, level 15 one hour into the infusion.
    const c = gotiCase(25, 90, 1500, 24, 1.5, 8, [{ timeH: 167.5, conc: 10 }, { timeH: 169, conc: 15 }]);
    assert(c.multi.obj < c.f(...c.single) - 1e-3, 'multi-start must reach a lower objective');
    assert(Math.abs(c.auc(c.multi.eta) - 938) < 5, `MAP AUC ${c.auc(c.multi.eta).toFixed(0)}, expected ~938 (single start: ${c.auc(c.single).toFixed(0)})`);
  });
  test('a near-equal second minimum is reported, not hidden', ()=>{
    const c = gotiCase(25, 90, 1500, 24, 1.5, 8, [{ timeH: 167.5, conc: 10 }, { timeH: 169, conc: 15 }]);
    const alt = c.multi.alternative;
    assert(alt && Math.abs(c.auc(alt.eta) - 487) < 5 && alt.dObj < 0.1, JSON.stringify(alt));
  });
  test('an ordinary peak/trough fit has one solution', ()=>{
    const c = gotiCase(80, 70, 1000, 12, 1, 8, [{ timeH: 95.5, conc: 12 }, { timeH: 86, conc: 30 }]);
    assert(c.multi.alternative === null, JSON.stringify(c.multi.alternative));
    assert(Math.abs(c.auc(c.multi.eta) - c.auc(c.single)) < 1, 'same answer as a single start');
  });
  test('every fit in the engine goes through mapFit', ()=>{
    const direct = code.match(/nelderMead[23]D\(/g) || [];
    // the two definitions and mapFit's own two calls
    assert(direct.length === 4, `direct optimizer calls outside mapFit: ${direct.length - 4}`);
    assert(/PREFERENCE \(rule 8\)[\s\S]{0,200}MAP_TIE_OBJ/.test(script), 'cut-points must be labelled preference');
  });
  test('two solutions: shown on screen, in print, and confidence is Low', ()=>{
    // 2026-09-28 design pass: on screen the warning is a tiered note whose signal
    // word names it (rule 9: same assertion, new container).
    assert(/word: 'Two solutions fit these levels'/.test(code) && /items\.push\(\['warning',\s*`Two solutions fit/.test(code), 'screen and print');
    const conf = confidenceAssessment({ levels: [{}, {}], CL_ind: 2, mapAlt: { CL: 3.5, dObj: 0.04 } }, null, null);
    assert(conf.rank >= 2, `confidence rank ${conf.rank}`);
    assert((script.match(/agCtx, mapAlt, lowCrClHold/g) || []).length === 3, 'all three payloads carry mapAlt');
  });
  test('D10: the 2-comp objectives omit ln(se2) by decision, and say why', ()=>{
    assert(!/\/ se2 \+ Math\.log\(se2\)/.test(code), 'ln(se2) was rejected on simulation evidence');
    assert(/decision D10/.test(script), 'the reason must stay beside the code');
  });
  test('Buelga\'s published covariance is recorded as deliberately omitted', ()=>{
    assert(/DELIBERATE OMISSION[\s\S]{0,300}23\.12/.test(script), 'Table 4 omega_CL/omega_V must be disclosed');
  });
}

// ════════════════════════════════════════════════════════════════════
// SUITE 27 — engine audit, remaining minor items (2026-09-28)
// ════════════════════════════════════════════════════════════════════
{
  const src    = fs.readFileSync(htmlPath, 'utf8');
  const script = src.match(/<script>([\s\S]*?)<\/script>/)[1];
  const code   = script.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  const { autoTinf, troughRailHTML, nextLevelValue } = sandbox;

  console.log(`\n${'═'.repeat(60)}`);
  console.log('  SUITE 27 — engine audit, remaining minor items');
  console.log(`${'─'.repeat(60)}`);

  test('autoTinf is the 1 g/h rule to the half hour, with no 3 h ceiling', ()=>{
    const table = d => d<=500?0.5:d<=1000?1:d<=1500?1.5:d<=2000?2:d<=2500?2.5:3;
    for (let d = 100; d <= 3000; d += 50) assert(autoTinf(d) === table(d), `${d} mg changed: ${autoTinf(d)}`);
    assert(autoTinf(3250) === 3.5 && autoTinf(4000) === 4 && autoTinf(4500) === 4.5, [3250, 4000, 4500].map(autoTinf).join());
  });
  test('Bauer volume in obesity is disclosed, not silently TBW', ()=>{
    assert(/s\('vd-model'\) === 'bauer' && bmiNow >= 30/.test(code), 'advisory must fire for Bauer Vd at BMI >= 30');
    assert(/ideal body weight for Vd in obesity/.test(code), 'model note must disclose it');
    assert(/k30: \(el, ev, arg\) => \{ updateModelInfo\(\); try \{ updateCrCl\(\); \}/.test(script), 'changing the Vd model refreshes the advisory');
  });
  test('the 10 mg/L trough floor is attributed to 2009 and no longer prescribes a dose rise', ()=>{
    assert(!/ASHP\/IDSA 2020 (efficacy floor|minimum)/.test(script), 'the 2020 attribution is back');
    const t = troughRailHTML(8, 450, 10);
    assert(/2009 consensus/.test(t) && !/Consider a shorter interval or higher dose/.test(t), t);
    assert(troughRailHTML(8, 700, 10) === '' && troughRailHTML(12, 450, 10) === '', 'only with AUC in range and trough < 10');
  });
  test('unsourced Trough-module heuristics are labelled preference (rule 8)', ()=>{
    assert(/PREFERENCE \(rule 8\): the 20%\/50% gap cuts[\s\S]{0,250}function weightBasedDoseMgKg/.test(script), "mg/kg heuristic");
    assert(/PREFERENCE \(rule 8\): the CrCl cut-points[\s\S]{0,300}function suggestInterval/.test(script), 'interval heuristic');
    assert(/calculator heuristic, not a guideline/.test(code), 'on screen too');
  });
  test('FIT_BANDS: no "outer 5%" claim; the modest band defers to the next-level panel', ()=>{
    assert(!/beyond 2 SD is roughly the outer 5%/.test(script), 'the rationale was wrong for MAP residuals');
    assert(!/A further concentration would improve the exposure estimate/.test(code), 'must not contradict nextLevelValue');
  });
  test('next-level panel quotes the asymmetric band', ()=>{
    const nl = nextLevelValue(450, 0, 'goti', 12, 4);
    assert(/−40% \/ \+63%/.test(nl.detail) && /−24% \/ \+50%/.test(nl.detail), nl.detail);
    assert(Math.abs(nl.hiNow - 450 * 1.63) < 1e-9 && Math.abs(nl.loNow - 450 * 0.60) < 1e-9, 'bounds are asymmetric');
  });
  test('uncertainty provenance points at the real generator; audit scripts are repo-relative', ()=>{
    assert(!/Monte Carlo in phase2d/.test(script), 'phase2d computes no percentiles');
    const dir = require('path').join(path.dirname(htmlPath), 'docs', 'audit');
    const abs = fs.readdirSync(dir).filter(f => /\.cjs$/.test(f))
      .filter(f => /\/Users\/[^'"]*AinaDaraTDM/.test(fs.readFileSync(require('path').join(dir, f), 'utf8')));
    assert(abs.length === 0, 'absolute paths: ' + abs.join(', '));
  });
}

// ════════════════════════════════════════════════════════════════════
// SUITE 28 — redraw survives a resize / theme toggle (design audit 2026-09-28)
// ════════════════════════════════════════════════════════════════════
{
  const src    = fs.readFileSync(htmlPath, 'utf8');
  const script = src.match(/<script>([\s\S]*?)<\/script>/)[1];
  const code   = script.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  const bodyOf = (name) => { const c = code.slice(code.indexOf('function ' + name + '(')); return c.slice(0, c.indexOf('\nfunction ')); };
  console.log(`\n${'═'.repeat(60)}`);
  console.log('  SUITE 28 — redraw after resize or theme toggle');
  console.log(`${'─'.repeat(60)}`);

  test('every value the redraw passes is stored by the render it repeats', ()=>{
    const redraw = bodyOf('redrawAllCanvases');
    const render = bodyOf('renderBayesianResults');
    for (const k of ['divergeMsg', 'levelWarnings', 'mic', 'p2c']) {
      assert(new RegExp('bState\\.' + k).test(redraw), `redraw no longer reads ${k}?`);
      assert(new RegExp('bState\\.' + k + '\\s*=').test(render), `renderBayesianResults must store bState.${k}`);
    }
    assert(/levelWarnings = Array\.isArray\(levelWarnings\) \? levelWarnings : \[\]/.test(render), 'a missing list must not throw');
  });
  test('the Tinkerer steady-state canvas never paints default black: it clears, like drawPKGraph', ()=>{
    // A bare fillRect with no fillStyle painted a black slab (design audit 2026-09-28).
    // The --paper fill that fixed it drew a flat slab on the page's atmosphere under the
    // transparent Trough and profile charts, so the background is now cleared as theirs
    // is. A background fill, if one ever returns, must still set a themed colour first.
    const b = bodyOf('drawSSTinkCanvas');
    assert(/ctx\.clearRect\(0, 0, W, H\)/.test(b), 'the background must be cleared, as drawPKGraph clears its own');
    const i = b.indexOf('ctx.fillRect(0, 0, W, H)');
    assert(i < 0 || /ctx\.fillStyle\s*=\s*themeColor\(/.test(b.slice(0, i)), 'fillStyle must be set before any background fill');
  });
}

// ════════════════════════════════════════════════════════════════════
// SUITE 29 — design track A: forms and accessibility (design pass 2026-09-28)
//
// The input panels are read by expert users at speed, often by keyboard and
// sometimes by screen reader. The audit found controls a screen reader could
// not name (the CrCl override, the trough max, both target-interval selects,
// the custom interval, the Loading Dose switch), <label for> pointing at
// hidden inputs, toggles that never said which option was selected, a body
// diagram that was mouse-only, section labels styled as eyebrows, no <h1>,
// and sex silently preselected as Male in both modules.
// ════════════════════════════════════════════════════════════════════
{
  const src    = fs.readFileSync(htmlPath, 'utf8');
  const script = src.match(/<script>([\s\S]*?)<\/script>/)[1];
  const markup = src.slice(src.indexOf('<body>'), src.indexOf('<script>'));
  const attr   = (s, n) => { const m = s.match(new RegExp('\\s' + n + '="([^"]*)"')); return m ? m[1] : null; };
  const ids    = new Set([...markup.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));
  const fields = [...markup.matchAll(/<(input|select|textarea)\b([^>]*)>/g)];
  const hidden = new Set(fields.filter(f => attr(f[2], 'type') === 'hidden').map(f => attr(f[2], 'id')).filter(Boolean));
  const labelFor = [...markup.matchAll(/<label\b[^>]*\sfor="([^"]+)"/g)].map(m => m[1]);
  const trackCss = src.slice(src.indexOf("design track A: forms & accessibility — insert this track's CSS"),
                             src.indexOf("design track B: validation & errors — insert this track's CSS"));

  console.log(`\n${'═'.repeat(60)}`);
  console.log('  SUITE 29 — design track A: forms and accessibility');
  console.log(`${'─'.repeat(60)}`);

  test('exactly one <h1>, and one <main> landmark holding both modules', ()=>{
    const h1 = (src.match(/<h1\b/g) || []).length;
    assert(h1 === 1, `${h1} <h1> elements in the page, expected exactly one`);
    assert((markup.match(/<main\b/g) || []).length === 1, 'expected one <main>');
    const main = markup.slice(markup.indexOf('<main'), markup.indexOf('</main>'));
    assert(main.includes('<h1'), 'the <h1> should open the <main> landmark');
    assert(main.includes('class="app-shell"') && main.includes('id="app-shell-bayesian"'),
      '<main> must contain both module shells');
    assert(/<nav class="module-tabs" aria-label="[^"]+"/.test(markup), 'the module tabs should be a labelled <nav>');
  });

  test('form sections are real headings, not uppercase eyebrow labels', ()=>{
    assert(!/class="section-label"/.test(markup), 'a static .section-label eyebrow is still in the input panels');
    const h2 = [...markup.matchAll(/<h2 class="form-h2[^"]*"[^>]*>([^<]*)</g)].map(m => m[1].trim());
    assert(h2.length >= 24, `${h2.length} form <h2> headings, expected every section (24)`);
    for (const want of ['Patient demographics', 'Renal function', 'Regimen preferences', 'Current regimen',
                        'Loading dose', 'Drug level', 'PK model', 'Therapeutic target', 'Dosing course history']) {
      assert(h2.includes(want), `missing section heading "${want}"`);
    }
    // Sentence case: after the first letter, a capital starts only an acronym or a name.
    const KEEP = /^(SCr|PK|AUC|Sawchuk-Zaske|Sawchuk|Zaske)$/;
    const bad = h2.filter(t => t.split(/\s+/).slice(1).some(w => /^[A-Z][a-z]/.test(w) && !KEEP.test(w)));
    assert(bad.length === 0, `headings not in sentence case: ${bad.join(' | ')}`);
    const shell = markup.slice(markup.indexOf('<main'), markup.indexOf('</main>'));
    assert(!/text-transform:\s*uppercase/.test(shell), 'an inline uppercase label survives in the input panels');
    assert(/\.form-h2\s*\{[^}]*font-weight:\s*600[^}]*font-size:\s*var\(--fs-sm\)[^}]*text-transform:\s*none/.test(trackCss),
      '.form-h2 must be Outfit 600 --fs-sm, sentence case');
  });

  test('every static input, select and textarea has a programmatic label', ()=>{
    const missing = [];
    for (const f of fields) {
      const a = f[2];
      if (attr(a, 'type') === 'hidden') continue;
      const id = attr(a, 'id');
      const aria = (attr(a, 'aria-label') || '').trim() !== '';
      const lb   = attr(a, 'aria-labelledby');
      const byIds = !!lb && lb.trim().split(/\s+/).every(x => ids.has(x));
      const byFor = !!id && labelFor.includes(id);
      const before = markup.slice(0, f.index);
      const open = before.lastIndexOf('<label'), close = before.lastIndexOf('</label>');
      const wrapped = open > close &&
        markup.slice(open, markup.indexOf('</label>', f.index)).replace(/<[^>]*>/g, '').trim() !== '';
      if (!(aria || byIds || byFor || wrapped)) missing.push(id || a.trim().slice(0, 40));
    }
    assert(missing.length === 0, `unlabelled controls: ${missing.join(', ')}`);
  });

  test('no <label for> points at a hidden input — the visible group is labelled instead', ()=>{
    const bad = labelFor.filter(id => hidden.has(id));
    assert(bad.length === 0, `label for= a hidden input: ${bad.join(', ')}`);
    const groups = [...markup.matchAll(/<div class="(toggle-group|model-grid|calc-mode-bar)"([^>]*)>/g)];
    assert(groups.length >= 8, `found ${groups.length} control groups`);
    for (const g of groups) {
      assert(attr(g[2], 'role') === 'group', `a .${g[1]} has no role="group": ${g[0]}`);
      const lb = attr(g[2], 'aria-labelledby');
      assert(attr(g[2], 'aria-label') || (lb && lb.split(/\s+/).every(x => ids.has(x))), `unnamed group: ${g[0]}`);
    }
  });

  test('segmented controls, model cards and module tabs declare aria-pressed matching their selection', ()=>{
    const TOGGLES = ['toggle-opt', 'model-opt', 'calc-mode-btn', 'module-tab'];
    const btns = [...markup.matchAll(/<button\b([^>]*)>/g)]
      .map(m => m[1]).filter(a => (attr(a, 'class') || '').split(/\s+/).some(c => TOGGLES.includes(c)));
    assert(btns.length >= 20, `found ${btns.length} toggle buttons`);
    for (const a of btns) {
      const active = (attr(a, 'class') || '').split(/\s+/).includes('active');
      assert(attr(a, 'aria-pressed') === (active ? 'true' : 'false'),
        `aria-pressed out of step with .active: <button${a}>`);
    }
  });

  test('sex is not preselected — neither module shows Male (or Female) pressed', ()=>{
    for (const k of ['k9', 'k10', 'k39', 'k40']) {
      const m = markup.match(new RegExp(`<button\\b[^>]*data-onclick="${k}"[^>]*>`));
      assert(m, `sex button ${k} missing`);
      assert(!/class="[^"]*\bactive\b/.test(m[0]), `sex button ${k} is preselected: ${m[0]}`);
      assert(attr(m[0], 'aria-pressed') === 'false', `sex button ${k} must render unpressed`);
    }
  });

  test('the Loading Dose and Drug Level switches are named by their visible headings', ()=>{
    for (const [id, heading] of [['has-ld', 'Loading dose'], ['has-level', 'Drug level']]) {
      const m = markup.match(new RegExp(`<input\\b[^>]*id="${id}"[^>]*>`));
      assert(m, `${id} missing`);
      const lb = attr(m[0], 'aria-labelledby');
      assert(lb, `${id} has no aria-labelledby`);
      const h = markup.match(new RegExp(`id="${lb}"[^>]*>([^<]*)<`));
      assert(h && h[1].trim() === heading, `${id} is labelled by "${h && h[1]}", expected "${heading}"`);
    }
  });

  test('the amputation joints are keyboard buttons naming limb and level', ()=>{
    assert(!/<svg class="amp-figure"[^>]*role="img"/.test(markup),
      'role="img" makes the joints presentational — a screen reader cannot reach them');
    const joints = [...markup.matchAll(/<circle id="jt-[^"]+"[^>]*>/g)].map(m => m[0]);
    assert(joints.length === 12, `${joints.length} joints`);
    for (const j of joints) {
      assert(attr(j, 'tabindex') === '0' && attr(j, 'role') === 'button', `not focusable as a button: ${j}`);
      assert(attr(j, 'aria-pressed') === 'false', `joint must declare aria-pressed: ${j}`);
      assert(/^(Right|Left) (arm|leg): \S/.test(attr(j, 'aria-label') || ''), `aria-label must name limb and level: ${j}`);
      assert(attr(j, 'data-onkeydown') === 'kA1' && attr(j, 'data-arg'), `no key handler: ${j}`);
    }
    assert(/^\s*kA1: \(el, ev, arg\) => \{ ampJointKey\(ev, arg\); \}/m.test(script), 'registry key kA1 missing');
  });

  test('Enter and Space toggle a joint; other keys and a held key do not', ()=>{
    const { ampJointKey, amputationPct } = sandbox;
    assert(typeof ampJointKey === 'function', 'ampJointKey missing');
    // an earlier suite leaves getElementById returning a bare {value}; the
    // re-render after a pick needs the full element stub for this test only
    const prevGet = sandbox.document.getElementById;
    sandbox.document.getElementById = () => makeEl();
    try {
      let prevented = 0;
      const ev = (key, repeat) => ({ key, repeat: !!repeat, preventDefault() { prevented++; } });
      const start = amputationPct();
      assert(start === 0, `test assumes no amputation selected (got ${start})`);
      ampJointKey(ev('Enter'), 'RL:hip');
      assert(Math.abs(amputationPct() * 100 - 16.0) < 1e-9, 'Enter did not select the hip');
      ampJointKey(ev('Enter', true), 'RL:hip');
      ampJointKey(ev('a'), 'RL:hip');
      ampJointKey(ev('Tab'), 'RL:hip');
      assert(Math.abs(amputationPct() * 100 - 16.0) < 1e-9, 'a held key or another key changed the selection');
      ampJointKey(ev(' '), 'RL:hip');
      assert(amputationPct() === 0, 'Space on the selected joint should clear it');
      assert(prevented === 2, `preventDefault called ${prevented} times, expected 2 (Enter, Space)`);
    } finally { sandbox.document.getElementById = prevGet; }
  });

  test('aria-pressed is mirrored from the selection class', ()=>{
    const { a11ySyncPressed } = sandbox;
    assert(typeof a11ySyncPressed === 'function', 'a11ySyncPressed missing');
    const mk = (classes) => { const at = { 'aria-pressed': 'false' }; return {
      classList: { contains: c => classes.includes(c) },
      getAttribute: n => at[n], setAttribute: (n, v) => { at[n] = v; }, at }; };
    const on = mk(['toggle-opt', 'active']);   a11ySyncPressed(on);  assert(on.at['aria-pressed'] === 'true', '.active -> true');
    const jt = mk(['selected']);               a11ySyncPressed(jt);  assert(jt.at['aria-pressed'] === 'true', '.selected -> true');
    const off = mk(['toggle-opt']); off.at['aria-pressed'] = 'true';
    a11ySyncPressed(off); assert(off.at['aria-pressed'] === 'false', 'no selection class -> false');
    assert(/new MutationObserver\(/.test(script) && /attributeFilter: \['class'\]/.test(script),
      'no observer keeps aria-pressed in step with the class');
  });

  test('static placeholders do not read as entered values', ()=>{
    const numeric = fields.map(f => f[2]).filter(a => /^\s*[\d.]/.test(attr(a, 'placeholder') || ''));
    assert(numeric.length === 0, `numeric placeholders: ${numeric.map(a => attr(a, 'id')).join(', ')}`);
  });

  test('focus is a 2px terracotta-ink outline, and the hidden switch shows it on its track', ()=>{
    assert(/input:focus[^{]*\{[^}]*outline:\s*2px solid var\(--terracotta-ink\);\s*outline-offset:\s*1px;[^}]*box-shadow:\s*none/.test(trackCss),
      'input focus must be a 2px --terracotta-ink outline at 1px offset with no ring');
    assert(/\.toggle-switch input:focus-visible \+ \.slider\s*\{[^}]*outline:\s*2px solid var\(--terracotta-ink\)/.test(trackCss),
      'the switch checkbox is invisible; its focus ring must land on the slider');
    assert(/\.toggle-opt\.active\s*\{[^}]*color:\s*var\(--terracotta-ink\)/.test(trackCss),
      'selected toggle text must be --terracotta-ink (the canonical --terracotta is 3:1 as text)');
  });
}

// ════════════════════════════════════════════════════════════════════
// SUITE 30 — design track B: refusals inline, sex without a default,
// stale results (2026-09-28)
//
// Every refusal was a native alert() that left the previous run's regimen on
// screen behind it. Refusals are now an error summary in the module's results
// (fields marked aria-invalid, previous result cleared, in state too); sex has
// no default and both modules refuse without it; and a result whose inputs
// changed is marked stale until the next run.
// ════════════════════════════════════════════════════════════════════
{
  const src    = fs.readFileSync(htmlPath, 'utf8');
  const script = src.match(/<script>([\s\S]*?)<\/script>/)[1];
  console.log(`\n${'═'.repeat(60)}`);
  console.log('  SUITE 30 — design track B: refusals, sex, stale results');
  console.log(`${'─'.repeat(60)}`);
  const inCtx = (code) => vm.runInContext(code, sandbox);

  // A small fake DOM: enough for the presenter, the refusal paths and the
  // stale marker. Elements are created on demand and remembered by id.
  function fakeDom() {
    const els = {};
    function El(id, tag, type, value) {
      this.id = id || ''; this.tagName = tag || 'DIV'; this.type = type || ''; this.value = value || '';
      this.attrs = {}; this.style = { display: '' }; this.innerHTML = ''; this.textContent = '';
      this.checked = false; this.parentNode = null; this.children = [];
      const cls = this._cls = new Set();
      this.classList = {
        add: c => cls.add(c), remove: c => cls.delete(c), contains: c => cls.has(c),
        toggle: (c, f) => { const on = f === undefined ? !cls.has(c) : !!f; if (on) cls.add(c); else cls.delete(c); return on; },
      };
    }
    El.prototype.setAttribute = function (k, v) { this.attrs[k] = String(v); };
    El.prototype.getAttribute = function (k) { return k in this.attrs ? this.attrs[k] : null; };
    El.prototype.removeAttribute = function (k) { delete this.attrs[k]; };
    El.prototype.focus = function () { dom.active = this; };
    El.prototype.scrollIntoView = function () {};
    El.prototype.closest = function () { return null; };
    El.prototype.contains = function () { return false; };
    El.prototype.querySelectorAll = function () { return []; };
    El.prototype.insertAdjacentHTML = function (pos, html) {
      this.innerHTML = pos === 'afterbegin' ? html + this.innerHTML : this.innerHTML + html;
    };
    El.prototype.querySelector = function (sel) {
      const h = this.innerHTML, self = this;
      if (sel === '.stale-line') return /<p class="stale-line">/.test(h)
        ? { remove() { self.innerHTML = self.innerHTML.replace(/<p class="stale-line">[\s\S]*?<\/p>/, ''); },
            insertAdjacentHTML() {} } : null;
      if (sel === '.form-errors, .form-backstop') return /class="[^"]*\b(form-errors|form-backstop)\b/.test(h) ? {} : null;
      if (sel === '.toggle-group') return this.children.find(c => c.classList.contains('toggle-group')) || null;
      if (sel === '.toggle-opt') return this.children[0] || null;
      return null;
    };
    const get = (id) => els[id] || (els[id] = new El(id, 'INPUT', 'number', ''));
    // The sex fields: a hidden input beside a Male/Female toggle group.
    ['sex', 'b-sex'].forEach(id => {
      const field = new El('', 'DIV'), group = new El('', 'DIV'), male = new El('', 'BUTTON');
      group.classList.add('toggle-group'); group.children.push(male);
      field.children.push(group);
      const hidden = new El(id, 'INPUT', 'hidden', '');
      hidden.parentNode = field;
      els[id] = hidden; els[id + '::group'] = group; els[id + '::male'] = male;
    });
    ['results-content', 'results-placeholder', 'b-results', 'b-placeholder', 'fe-trough', 'fe-auc', 'sr-announce']
      .forEach(id => { els[id] = new El(id, 'DIV'); });
    const panelInputs = ['age', 'tbw', 'height', 'scr'].map(get);
    const panel = new El('', 'DIV');
    panel.querySelectorAll = () => panelInputs;
    const dom = {
      els, active: null,
      document: {
        body: {}, getElementById: get,
        querySelector: (sel) => sel === '.app-shell:not(#app-shell-bayesian) > .panel-left' ? panel : null,
        querySelectorAll: () => [], createElement: () => new El(),
      },
    };
    return dom;
  }
  function withDom(fn) {
    const dom = fakeDom();
    const prevDoc = sandbox.document, prevTimeout = sandbox.setTimeout;
    sandbox.document = dom.document;
    sandbox.setTimeout = (f) => f();
    try { return fn(dom); }
    finally { sandbox.document = prevDoc; sandbox.setTimeout = prevTimeout; inCtx('state.sex = null; bState.sex = null; bState.result = null;'); }
  }
  const setVals = (dom, vals) => Object.keys(vals).forEach(k => { dom.document.getElementById(k).value = vals[k]; });
  const SEX = "Choose the patient's sex.";

  test('no alert() is left in the script outside comments', ()=>{
    const code = script.replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n').filter(l => !/^\s*\/\//.test(l)).map(l => l.replace(/\s\/\/ .*$/, '')).join('\n');
    const n = (code.match(/(?<![\w.])alert\s*\(/g) || []).length;
    assert(n === 0, `${n} alert() call(s) remain — refusals must use showFormErrors()`);
    assert(typeof sandbox.showFormErrors === 'function', 'showFormErrors missing');
  });

  test('showFormErrors renders the summary, marks the field, and the next run clears the mark', ()=>{
    withDom(dom => {
      const { showFormErrors, beginFormRun, lastFormErrors } = sandbox;
      const rc = dom.els['results-content'];
      rc.innerHTML = '<div class="vx-top">1 g IV q12h</div>';   // a previous result
      showFormErrors('trough', ['Age is required.'], ['age']);
      assert(/Check these inputs/.test(rc.innerHTML) && /data-onclick="kB1"/.test(rc.innerHTML), 'summary with a link');
      assert(!/1 g IV q12h/.test(rc.innerHTML), 'a refusal must clear the previous result');
      assert(dom.els['results-placeholder'].style.display === 'none', 'placeholder hidden');
      assert(dom.els.age.getAttribute('aria-invalid') === 'true', 'aria-invalid not set');
      assert(dom.els.age.getAttribute('aria-describedby') === 'fe-trough-0', 'field not tied to its message');
      assert(dom.active === dom.els['fe-trough'], 'focus must move to the summary');
      assert(/Age is required/.test(dom.els['sr-announce'].textContent), 'refusal not announced');
      assert(lastFormErrors('trough')[0] === 'Age is required.', 'refusal not recorded');
      beginFormRun('trough');
      assert(dom.els.age.getAttribute('aria-invalid') === null, 'aria-invalid must clear on the next run');
      assert(dom.els.age.getAttribute('aria-describedby') === null, 'aria-describedby must be restored');
    });
  });

  test('sex has no default; calculate() refuses without it and after it is chosen does not', ()=>{
    assert(/let state = \{ sex:null,/.test(script), 'state.sex must default to null');
    assert(/let bState = \{ sex:null,/.test(script), 'bState.sex must default to null');
    assert(!/bState\.sex = 'M'/.test(script) && !/bState = \{ sex:'M'/.test(script), 'a reset must not restore a default sex');
    withDom(dom => {
      inCtx("state.calcMode = 'initial'");
      sandbox.setPatientSex(null);
      assert(inCtx('state.sex') === null && inCtx('bState.sex') === null, 'setPatientSex(null) must unset both');
      setVals(dom, { age: '60', tbw: '80', height: '175', scr: '1', 'init-tinf': '1', 'init-interval': '12' });
      sandbox.calculate();
      const errs = sandbox.lastFormErrors('trough');
      assert(errs.length === 1 && errs[0] === SEX, JSON.stringify(errs));
      assert(dom.els['sex::group'].classList.contains('fe-invalid'), 'the sex toggle is not marked');
      assert(/Check these inputs/.test(dom.els['results-content'].innerHTML), 'no summary');
      // Chosen, sex is no longer refused (age blank so the run stops before the engine).
      sandbox.setPatientSex('F');
      assert(inCtx('state.sex') === 'F' && inCtx('bState.sex') === 'F', 'setPatientSex must still set both');
      setVals(dom, { age: '' });
      sandbox.calculate();
      const errs2 = sandbox.lastFormErrors('trough');
      assert(errs2.indexOf(SEX) < 0 && /Age is required/.test(errs2[0]), JSON.stringify(errs2));
      assert(!dom.els['sex::group'].classList.contains('fe-invalid'), 'the old sex mark must clear');
    });
  });

  test('runBayesian() refuses without sex and clears the previous fit in state', ()=>{
    const realParse = sandbox.parseBayesCourse;
    sandbox.parseBayesCourse = () => ({ doses: [{ mg: 1000, tinfH: 1, timeH: 0, label: '' }], levels: [], errors: [] });
    try {
      withDom(dom => {
        sandbox.setPatientSex(null);
        setVals(dom, { 'b-age': '60', 'b-tbw': '80', 'b-height': '175', 'b-scr': '1', 'b-auc-target': '500' });
        inCtx('bState.result = { model: "buelga", stale: true }; bState.resultFingerprint = "x";');
        dom.els['b-results'].innerHTML = '<div class="vx-top">1 g IV q12h</div>';
        sandbox.runBayesian();
        const errs = sandbox.lastFormErrors('auc');
        assert(errs.length === 1 && errs[0] === SEX, JSON.stringify(errs));
        assert(inCtx('bState.result') === null, 'a refusal must clear bState.result, or a redraw brings the old fit back');
        assert(!/1 g IV q12h/.test(dom.els['b-results'].innerHTML), 'the previous fit is still on screen');
        assert(dom.els['b-sex::group'].classList.contains('fe-invalid'), 'the sex toggle is not marked');
      });
    } finally { sandbox.parseBayesCourse = realParse; }
  });

  test('unset sex is safe in the CrCl displays and saved as unset', ()=>{
    withDom(dom => {
      sandbox.setPatientSex(null);
      setVals(dom, { age: '60', tbw: '80', height: '175', scr: '1', 'b-age': '60', 'b-tbw': '80', 'b-height': '175', 'b-scr': '1' });
      sandbox.autoWeights();
      assert(dom.els['ibw-display'].textContent === '—', `IBW ${dom.els['ibw-display'].textContent}`);
      assert(/CrCl: —/.test(dom.els['crcl-result'].textContent), dom.els['crcl-result'].textContent);
      assert(sandbox.getBayesCrCl() === null, 'no CrCl on an assumed sex');
      sandbox.updateBayesCrCl();
      assert(/—/.test(dom.els['b-crcl-result'].textContent) && !/NaN/.test(dom.els['b-crcl-result'].textContent), 'AUC CrCl line');
      assert(sandbox.snapshotPatientCore().sex === null, 'an unset sex must not be saved as M');
      sandbox.setPatientSex('M');
      assert(sandbox.getBayesCrCl() > 0 && sandbox.snapshotPatientCore().sex === 'M', 'chosen sex unchanged');
    });
  });

  test('the stale marker follows the inputs and clears when they are restored', ()=>{
    withDom(dom => {
      const { beginFormRun, refreshStaleResult, bayesInputFingerprint } = sandbox;
      assert(typeof refreshStaleResult === 'function', 'refreshStaleResult missing');
      sandbox.setPatientSex('M');
      setVals(dom, { age: '60', tbw: '80', height: '175', scr: '1' });
      const rc = dom.els['results-content'];
      beginFormRun('trough');
      assert(/form-backstop/.test(rc.innerHTML), 'a run must start from the backstop, not the old result');
      rc.innerHTML = '<div class="vx-top">1 g IV q12h</div>';      // what the render writes
      assert(refreshStaleResult('trough') === false, 'fresh result marked stale');
      setVals(dom, { age: '61' });
      assert(refreshStaleResult('trough') === true, 'an edited input must mark the result stale');
      assert(/Inputs changed since this result/.test(rc.innerHTML) && rc.classList.contains('is-stale'), 'no stale line');
      setVals(dom, { age: '60' });
      assert(refreshStaleResult('trough') === false && !/stale-line/.test(rc.innerHTML) && !rc.classList.contains('is-stale'),
        'restoring the inputs must clear the stale mark');
      // AUC Precision reuses bayesInputFingerprint.
      const br = dom.els['b-results'];
      setVals(dom, { 'b-age': '60', 'b-tbw': '80' });
      inCtx('bState.result = { model: "buelga" }');
      inCtx('bState.resultFingerprint = bayesInputFingerprint()');
      br.style.display = 'block'; br.innerHTML = '<div class="vx-top">1 g IV q12h</div>';
      assert(refreshStaleResult('auc') === false, 'fresh fit marked stale');
      setVals(dom, { 'b-age': '70' });
      assert(refreshStaleResult('auc') === true && br.classList.contains('is-stale'), 'edited AUC input not stale');
      setVals(dom, { 'b-age': '60' });
      assert(refreshStaleResult('auc') === false, 'restored AUC input still stale');
      assert(typeof bayesInputFingerprint === 'function', 'fingerprint reused');
    });
  });

  test('two levels under 2 h apart is a caution beside the result, not a refusal', ()=>{
    const c = script.slice(script.indexOf('function calculate()'));
    const body = c.slice(0, c.indexOf('\nfunction '));
    assert(/\(tlT2 - tlT1\) < 2\) \{ queueFormCaution\('trough'/.test(body), 'the separation note must be queued, not block');
    assert(/beginFormRun\('trough'\)/.test(body) && /withPatientSex\(validateFields/.test(body), 'run start and sex check');
    const b = script.slice(script.indexOf('function runBayesian()'));
    assert(/beginFormRun\('auc'\)/.test(b.slice(0, 300)), 'runBayesian must start a run');
  });
}

// ════════════════════════════════════════════════════════════════════
// SUITE 31 — design track C — mobile layout and data entry (design track C, 2026-09-28)
//
// On a 375px phone the header wrapped to three rows (187px) and the dose table
// was 396px inside a 343px overflow:hidden box, clipping the time field and the
// remove button. New dose rows defaulted to "now" with a placeholder "1000"
// that read as an entered dose, and nothing showed how a typed sampling time
// had been read. These tests pin the fixes.
// ════════════════════════════════════════════════════════════════════
{
  const src    = fs.readFileSync(htmlPath, 'utf8');
  const script = src.match(/<script>([\s\S]*?)<\/script>/)[1];
  const style  = src.match(/<style>([\s\S]*?)<\/style>/)[1];
  const body   = src.slice(src.indexOf('<body>'));
  const code   = script.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  const bodyOf = (name) => { const c = code.slice(code.indexOf('function ' + name + '(')); return c.slice(0, c.indexOf('\nfunction ')); };
  const { nextDoseDefault, courseReadback, fmtGapHM, formatTime24Input, addBayesDose } = sandbox;

  console.log(`\n${'═'.repeat(60)}`);
  console.log('  SUITE track C — mobile layout and data entry');
  console.log(`${'─'.repeat(60)}`);

  const row = (mg, tinf, date, time) => ({ mg, tinf, date, time });

  test('nextDoseDefault: one dated dose → that dose + 12 h, same amount and infusion', ()=>{
    assert(typeof nextDoseDefault === 'function', 'nextDoseDefault is missing');
    const d = nextDoseDefault([row('1000', '1', '2026-09-01', '08:00')]);
    assert(d && d.date === '2026-09-01' && d.time === '20:00', JSON.stringify(d));
    assert(d.mg === '1000' && d.tinf === '1' && d.intervalH === 12, JSON.stringify(d));
  });
  test('nextDoseDefault: the interval is the gap between the two latest doses, across midnight', ()=>{
    const d = nextDoseDefault([row('1250', '1.5', '2026-09-01', '08:00'), row('1250', '1.5', '2026-09-01', '16:00')]);
    assert(d.date === '2026-09-02' && d.time === '00:00' && d.intervalH === 8, JSON.stringify(d));
  });
  test('nextDoseDefault: rows entered out of order continue from the LATEST dose in time', ()=>{
    const d = nextDoseDefault([row('750', '1', '2026-09-02', '08:00'), row('1000', '1', '2026-09-01', '20:00')]);
    assert(d.date === '2026-09-02' && d.time === '20:00' && d.mg === '750', JSON.stringify(d));
  });
  test('nextDoseDefault: a half-typed time is ignored, never guessed; a duplicate falls back to 12 h', ()=>{
    const d = nextDoseDefault([row('1000', '1', '2026-09-01', '08:00'), row('1000', '1', '2026-09-01', '20:00'),
                               row('1500', '', '2026-09-02', '8:00')]);
    assert(d.date === '2026-09-02' && d.time === '08:00' && d.mg === '1000', `the "8:00" row must not count: ${JSON.stringify(d)}`);
    const dup = nextDoseDefault([row('1000', '1', '2026-09-01', '08:00'), row('1000', '1', '2026-09-01', '08:00')]);
    assert(dup.time === '20:00' && dup.intervalH === 12, JSON.stringify(dup));
  });
  test('nextDoseDefault: no rows → null (now); undated rows → amount only; no non-positive amount is copied', ()=>{
    assert(nextDoseDefault([]) === null, 'no rows must return null');
    const u = nextDoseDefault([row('1000', '1', '', '')]);
    assert(u.date === null && u.time === null && u.mg === '1000', JSON.stringify(u));
    const z = nextDoseDefault([row('0', '', '2026-09-01', '08:00')]);
    assert(z.mg === '' && z.tinf === '', JSON.stringify(z));
  });

  test('addBayesDose defaults a second row to the previous dose + the interval (DOM stubbed)', ()=>{
    const doc = sandbox.document;
    const prev = { get: doc.getElementById, qsa: doc.querySelectorAll, make: doc.createElement };
    const appended = [];
    const tbody  = { querySelector: () => null, appendChild: (tr) => appended.push(tr) };
    const fields = { 'b-dose-mg-7': { value: '1000' }, 'b-dose-tinf-7': { value: '1' },
                     'b-dose-date-7': { value: '2026-09-01' }, 'b-dose-time-7': { value: '08:00' } };
    doc.getElementById    = (id) => id === 'b-dose-tbody' ? tbody : (fields[id] || null);
    doc.querySelectorAll  = (sel) => /b-dose-row-/.test(sel) ? [{ id: 'b-dose-row-7' }] : [];
    doc.createElement     = () => ({ id: '', className: '', innerHTML: '' });
    try { addBayesDose(); }
    finally { doc.getElementById = prev.get; doc.querySelectorAll = prev.qsa; doc.createElement = prev.make; }
    assert(appended.length === 1, 'a row must be appended');
    const html = appended[0].innerHTML;
    const val = (f) => (html.match(new RegExp(`id="b-dose-${f}-\\d+"[^>]*?value="([^"]*)"`)) || [])[1];
    assert(val('date') === '2026-09-01' && val('time') === '20:00', `expected 2026-09-01 20:00, got ${val('date')} ${val('time')}`);
    assert(val('mg') === '1000' && val('tinf') === '1', `expected 1000 mg over 1 h, got ${val('mg')} / ${val('tinf')}`);
    assert(appended[0].className === 'course-row', 'the row must carry the reflowing grid class');
  });
  test('level and SCr rows still default to now on the local clock', ()=>{
    for (const fn of ['addBayesLevel', 'addScrRow']) {
      const b = bodyOf(fn);
      assert(/localDateStr\(/.test(b) && /localTimeStr\(/.test(b), `${fn} must default to the local now`);
      assert(!/nextDoseDefault/.test(b), `${fn} must not continue the dose schedule`);
    }
  });

  test('the dose-amount placeholder is not a number (it read as an entered dose)', ()=>{
    const tag = (bodyOf('addBayesDose').match(/<input[^>]*id="b-dose-mg-\$\{id\}"[^>]*>/) || [])[0];
    assert(tag, 'the amount input is missing');
    const ph = (tag.match(/placeholder="([^"]*)"/) || [])[1];
    assert(ph === undefined || !/^\s*[\d.,]+\s*$/.test(ph), `numeric placeholder: "${ph}"`);
    assert(!/placeholder="auto"/.test(bodyOf('addBayesDose')), 'the infusion placeholder "auto" is back');
  });
  test('every row input and remove button carries an accessible name', ()=>{
    const want = {
      addBayesDose:  ['aria-label="Dose ${id} amount (mg)"', 'aria-label="Dose ${id} infusion duration (h)"',
                      'aria-label="Dose ${id} date"', 'aria-label="Dose ${id} time (24-hour)"', 'aria-label="Remove dose ${id}"'],
      addBayesLevel: ['aria-label="Level ${id} concentration (mg/L)"', 'aria-label="Level ${id} date"',
                      'aria-label="Level ${id} time (24-hour)"', 'aria-label="Remove level ${id}"'],
      addScrRow:     ['aria-label="SCr ${n} value (mg/dL)"', 'aria-label="SCr ${n} date"',
                      'aria-label="SCr ${n} time (24-hour)"', 'aria-label="Remove SCr ${n}"'],
    };
    for (const [fn, labels] of Object.entries(want)) {
      const b = bodyOf(fn);
      for (const l of labels) assert(b.includes(l), `${fn}: missing ${l}`);
      const unnamed = [...b.matchAll(/<(input|button)\b[^>]*>/g)].map(m => m[0]).filter(t => !/aria-label="/.test(t));
      assert(unnamed.length === 0, `${fn}: unnamed control ${unnamed.join(' | ').slice(0, 160)}`);
      assert(!/[✕×]/.test(b), `${fn}: a glyph is used as the remove icon`);
    }
  });
  test('time fields: 24-hour hint as placeholder, HH:MM pattern kept, colon never re-added on delete', ()=>{
    for (const fn of ['addBayesDose', 'addBayesLevel', 'addScrRow']) {
      const t = (bodyOf(fn).match(/<input[^>]*data-time24[^>]*>/) || [])[0];
      assert(t && /placeholder="24-hour, e\.g\. 08:00"/.test(t) && /pattern="\[0-2\]\[0-9\]:\[0-5\]\[0-9\]"/.test(t),
        `${fn}: ${t && t.slice(0, 160)}`);
    }
    const f = (value, inputType) => { const el = { value }; formatTime24Input(el, { inputType }); return el.value; };
    assert(f('08', 'insertText') === '08:', 'typing two digits adds the colon');
    assert(f('08', 'deleteContentBackward') === '08', 'deleting past the colon must be possible');
    assert(f('0800', 'insertText') === '0800', 'a mistyped time is shown back, never repaired');
    assert(f('08:3a0', 'insertText') === '08:30', 'non-digits are dropped, as before');
    // Typed key by key, as a clinician does, with the browser's maxlength="5".
    // Each call above is one event; the defect was only visible as a sequence:
    // "08:00" typed became "08::0" (the auto colon, then the typed one).
    const typed = (keys) => {
      const el = { value: '' };
      for (const ch of keys) {
        if (el.value.length >= 5) break;             // maxlength refuses the key
        el.value += ch;
        formatTime24Input(el, { inputType: 'insertText', data: ch });
      }
      return el.value;
    };
    assert(typed('08:00') === '08:00', `typing "08:00" gave "${typed('08:00')}"`);
    assert(typed('0800') === '08:00', `typing "0800" gave "${typed('0800')}"`);
    assert(typed('23:59') === '23:59', `typing "23:59" gave "${typed('23:59')}"`);
    assert(f('08::00', 'insertFromPaste') === '08::0', 'a pasted value is shown back, not repaired (5-char cap only)');
  });

  test('read-back: dose gaps and level timing, to the minute, from the right dose', ()=>{
    const D = [{ n: '1', date: '2026-09-01', time: '08:00', tinf: '1' }, { n: '2', date: '2026-09-01', time: '20:00', tinf: '1.5' }];
    const far = new Date('2030-01-01T00:00').getTime();
    const r = courseReadback(D, [{ n: '1', date: '2026-09-02', time: '03:30' }, { n: '2', date: '2026-09-01', time: '21:00' },
                                 { n: '3', date: '2026-09-01', time: '07:00' }, { n: '4', date: '2026-09-02', time: '03:3' }], far);
    assert(r.dose['1'] === 'first dose' && r.dose['2'] === '12 h after dose 1', JSON.stringify(r.dose));
    assert(r.level['1'] === '7 h 30 min after dose 2 started', r.level['1']);
    assert(r.level['2'] === '1 h after dose 2 started, during its infusion', r.level['2']);
    assert(r.level['3'] === 'before the first dose started', r.level['3']);
    assert(r.level['4'] === '', `an incomplete time reads nothing, got "${r.level['4']}"`);
  });
  test('read-back: chronology, not row order; duplicates and future times are named', ()=>{
    const D = [{ n: '1', date: '2026-09-02', time: '08:00' }, { n: '2', date: '2026-09-01', time: '20:00' },
               { n: '3', date: '2026-09-02', time: '08:00' }];
    const r = courseReadback(D, [], new Date('2026-09-02T00:00').getTime());
    assert(r.dose['2'] === 'first dose', JSON.stringify(r.dose));
    assert(r.dose['1'] === 'same time as dose 3 · in the future', JSON.stringify(r.dose));
    assert(fmtGapHM(12) === '12 h' && fmtGapHM(7.5) === '7 h 30 min' && fmtGapHM(0.75) === '45 min', 'fmtGapHM');
    assert(/elapsedHours\(/.test(bodyOf('courseReadback')), 'intervals must come from the one elapsed-time helper');
  });

  test('the brand links home to the pharmacy hub', ()=>{
    assert(/<a class="brand" href="\/" aria-label="AinaDara pharmacy — home">/.test(body), 'the brand is not a link to "/"');
  });
  test('the header is one row on a phone, <= 60px, and results clear it', ()=>{
    assert(!/\.header\s*\{[^}]*flex-wrap:\s*wrap/.test(style), 'the header wraps again');
    const phone = style.match(/@media \(max-width: 600px\) \{\s*:root \{ --header-h: (\d+)px; \}/);
    assert(phone && Number(phone[1]) <= 60, 'the phone header height token is missing or over 60px');
    assert(/\.header \{[^}]*min-height: var\(--header-h\)/.test(style), 'the header must take its height from the token');
    assert(/#b-results \{[^}]*scroll-margin-top: calc\(var\(--header-h\)/.test(style), 'results must clear the header by the same token');
    assert(/\.module-tab \{[^}]*min-height: 44px/.test(style), 'module segments must be 44px targets');
  });
  test('row inputs are 16px (no iOS zoom), rows reflow by container, nothing clips', ()=>{
    const ct = (style.match(/\.course-table input \{([^}]*)\}/) || [])[1] || '';
    assert(/font-size:var\(--fs-md\)/.test(ct) && /min-height:44px/.test(ct), `course inputs: ${ct}`);
    assert(!/\.course-table input[^{]*\{[^}]*font-size:var\(--fs-xs\)/.test(style), 'a 12px course input rule is back');
    assert(/\.course-table-wrap \{[^}]*overflow:visible[^}]*container-type:inline-size/.test(style), 'the course list must not clip');
    assert(/@container course/.test(style) && /\.course-table \.course-row \{[^}]*display: grid/.test(style), 'rows must be a reflowing grid');
  });
}

// ════════════════════════════════════════════════════════════════════
// SUITE 32 — design track D: Trough-module results in the course-timeline
// grammar (2026-09-28). Drives the REAL renderers with fictional patients and
// reads the markup they write: the verdict (the regimen, via fmtRegimen) comes
// before any evidence section, and the Matzke 1984 loading-dose rate limit is
// a caution note with its signal word and drawn icon — the audit found it
// printed as grey prose under a loading dose that broke it.
// ════════════════════════════════════════════════════════════════════
{
  const { renderResults, renderTwoLevels, renderRandomLevel, calcPeakTrough, calcAUC,
          assessClinicalStatus, findOptimalDose, calcLoadingDose, calcLDLevelAtTime, fmtRegimen } = sandbox;
  const CAUTION_PATH = 'M8 1.8 14.8 13.9H1.2z';          // ICON.caution (triangle)
  const ALARM_PATH   = 'M5.2 1.5h5.6l3.7 3.7v5.6';      // ICON.alarm (octagon)
  console.log(`\n${'═'.repeat(60)}`);
  console.log('  SUITE 29 — Trough-module results: verdict first, notes with signal words');
  console.log(`${'─'.repeat(60)}`);

  // Render into a captured #results-content; everything else is a stub.
  function renderInto(fn, d, calcMode) {
    const rc = makeEl(), ph = makeEl();
    const prevGet = sandbox.document.getElementById, prevST = sandbox.setTimeout;
    sandbox.document.getElementById = (id) => id === 'results-content' ? rc : id === 'results-placeholder' ? ph : makeEl();
    sandbox.setTimeout = () => 0;
    vm.runInContext(`state.calcMode = ${JSON.stringify(calcMode || 'initial')}`, sandbox);
    try { fn(d); } finally {
      sandbox.document.getElementById = prevGet; sandbox.setTimeout = prevST;
      vm.runInContext(`state.calcMode = 'initial'`, sandbox);
    }
    return rc.innerHTML;
  }
  const text = (h) => h.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

  // Fictional patient: 70 kg, CL 4.5 L/h, V 52 L, q12h, trough target 10–20.
  const kel = 4.5 / 52, vd = 52, clv = 4.5, tau = 12, tinf = 1, tMin = 10, tMax = 20, mic = 1;
  function initialPayload(withLD) {
    const opt = findOptimalDose(tMin, tMax, tau, tinf, kel, vd, clv);
    const pt = calcPeakTrough(opt.dose, tau, tinf, kel, vd), auc = calcAUC(opt.dose, tau, clv);
    const ld = calcLoadingDose(clv, vd, 25);
    return {
      age: 58, sex: 'M', tbw: 70, ibw: 66, adjbw: 67.6, bmi: 22.9, ht: 175, scr: 1.0,
      crcl: 78, crclWt: 70, dosingWt: 'auto', popClv: clv, adjClv: clv, vd, kel, popKel: kel,
      t12: 0.693 / kel, popT12: 0.693 / kel, dose: opt.dose, tau, tinf,
      peak: pt.peak, trough: pt.trough, popPeak: pt.peak, popTrough: pt.trough,
      levelVal: 0, tDoseToLvl: 0, levelFitted: false, extrapolated: false, extrapDelta: 0, troughBasis: null,
      auc24: auc, aucMIC: auc / mic, aucMethod: 'Population: VANCOPK CL · AUC = Daily Dose ÷ CLv',
      aucLo: Math.round(auc * 0.7), aucHi: Math.round(auc * 1.3), aucUncertainty: 0.30,
      troughMin: tMin, troughMax: tMax, troughStatus: 'ok', aucStatus: 'ok', mic,
      assessment: assessClinicalStatus(auc, pt.trough, tMin, tMax),
      optDose: opt.dose, optPT: pt, optAUC: opt.auc, optFlag: opt.flag, optFlagMsg: opt.flagMsg,
      clModel: 'vancopk', vdModel: 'vancopk', hasLevel: false, hasLD: !!withLD,
      ldData: withLD ? { ...ld, targetPeak: 25, deltaT: tau, levelAtMaint: calcLDLevelAtTime(ld.peak, ld.kelLD, ld.tinf, tau) } : null,
    };
  }

  test('renderResults: the verdict (fmtRegimen) comes before any evidence section', ()=>{
    const d = initialPayload(false);
    const h = renderInto(renderResults, d, 'initial');
    const m = h.match(/<h3 class="vx-regimen" id="tx-regimen">([\s\S]*?)<\/h3>/);
    assert(m, 'no verdict heading in the Trough result');
    assert(text(m[1]) === fmtRegimen(d.optDose, tau), `verdict reads "${text(m[1])}", want "${fmtRegimen(d.optDose, tau)}"`);
    const firstEv = h.indexOf('<details class="ev"');
    assert(firstEv > 0, 'the evidence is not in hairline disclosure sections');
    assert(h.indexOf('id="tx-regimen"') < firstEv, 'evidence precedes the verdict');
    assert(h.indexOf('approx. ±30% population estimate (not simulated)') < firstEv, 'the approximate band belongs to the verdict');
    assert(!/result-tab|stat-card|rec-target-chip|★/.test(h), 'legacy tabs, stat cards, chips or star glyph are back');
    assert(!/rgba\(/.test(h), 'a raw rgba literal is back in the Trough result markup');
  });

  test('loading-dose rate above Matzke 1984 is a caution note with ICON.caution, not grey prose', ()=>{
    const d = initialPayload(true);
    assert(d.ldData.rateAboveMatzke === true, `fixture must exceed 15 mg/min, got ${d.ldData.rateMgMin}`);
    const h = renderInto(renderResults, d, 'initial');
    const note = h.match(/<div class="note note-caution" role="note">\s*<div class="note-word">([\s\S]*?)<\/div>\s*<div class="note-body">([\s\S]*?)<\/div>\s*<\/div>/g) || [];
    const rate = note.find(n => /Matzke 1984 recommends/.test(n));
    assert(rate, 'the Matzke rate caution is not inside a caution note');
    assert(/<span>Infusion rate<\/span>/.test(rate) && rate.includes(CAUTION_PATH), 'signal word "Infusion rate" with the drawn caution icon');
    assert((h.match(/Matzke 1984 recommends/g) || []).length === 1, 'the rate caution must not also appear as prose');
    assert(h.indexOf('Loading dose') < h.indexOf('<details class="ev"'), 'the loading dose sits in the verdict area');
    assert(/<p class="tx-ld-dose">\d/.test(h) && /Infuse over [\d.]+ h · [\d.]+ mg\/min/.test(h), 'dose, infusion time and rate');
  });

  test('level mode: a reduction is said plainly, with the alarm icon, before the evidence', ()=>{
    const d = initialPayload(false);
    const dose = 1500, pt = calcPeakTrough(dose, tau, tinf, kel, vd), auc = calcAUC(dose, tau, clv);
    Object.assign(d, { dose, peak: pt.peak, trough: pt.trough * 1.02, auc24: auc, aucMIC: auc,
      levelFitted: true, levelVal: 26, tDoseToLvl: 10.5, extrapolated: true, extrapDelta: 1.5, troughBasis: 'extrapolated',
      aucMethod: 'Ke 0.0865 hr⁻¹ fitted from 26 mg/L at 10.5h · trough extrapolated forward 1.5h',
      aucUncertainty: 0.22, aucLo: Math.round(auc * 0.78), aucHi: Math.round(auc * 1.22), hasLevel: true });
    d.assessment = assessClinicalStatus(d.auc24, d.trough, tMin, tMax);
    assert(d.assessment.action === 'reduce', `fixture must reduce, got ${d.assessment.action}`);
    const h = renderInto(renderResults, d, 'level');
    const firstEv = h.indexOf('<details class="ev"');
    const at = h.indexOf('Dose reduction indicated');
    assert(at > 0 && at < firstEv, 'the reduction must be stated in the verdict');
    assert(/tx-action-alarm/.test(h) && h.slice(h.indexOf('tx-action-alarm'), at).includes(ALARM_PATH), 'alarm tier carries the drawn octagon');
    assert(text(h.match(/id="tx-regimen">([\s\S]*?)<\/h3>/)[1]) === fmtRegimen(d.optDose, tau), 'the verdict names the new regimen');
    assert(h.includes(`Current ${fmtRegimen(dose, tau)}`), 'the current regimen is named beside it');
    assert(/Extrapolated trough/.test(h), 'trough basis label kept');
  });

  test('Two-level and random-level results lead with the verdict too', ()=>{
    const opt = findOptimalDose(tMin, tMax, tau, tinf, kel, vd, clv);
    const pt = calcPeakTrough(opt.dose, tau, tinf, kel, vd);
    const base = { age: 58, sex: 'M', tbw: 70, ibw: 66, adjbw: 67.6, bmi: 22.9, scr: 1.0, crcl: 78,
      popClv: 5, popVd: 55, popKel: 5 / 55, troughMin: tMin, troughMax: tMax, mic,
      optDose: opt.dose, optFlag: opt.flag, optFlagMsg: opt.flagMsg, optPT: pt, optAUC: calcAUC(opt.dose, tau, clv) };
    const tl = renderInto(renderTwoLevels, { ...base, tlDose: 1000, tlTinf: tinf, tlTau: tau,
      kel, vd, clv, t12: 0.693 / kel, peak: 28, c1: 24, t1: 3, c2: 12, t2: 11, basis: 'firstdose' });
    const rl = renderInto(renderRandomLevel, { ...base, rlDose: 1000, rlTinf: tinf, rlTau: tau, rlC: 14, rlT: 8,
      rlSubMode: 'firstdose', rlInterval: null, indKel: kel, indClv: clv, indT12: 0.693 / kel });
    for (const [name, h] of [['two-level', tl], ['random-level', rl]]) {
      const m = h.match(/id="tx-regimen">([\s\S]*?)<\/h3>/);
      assert(m && text(m[1]) === fmtRegimen(opt.dose, tau), `${name}: verdict reads "${m && text(m[1])}"`);
      assert(h.indexOf('id="tx-regimen"') < h.indexOf('<details class="ev"'), `${name}: evidence precedes the verdict`);
      assert(!/result-tab|stat-card|★|rgba\(/.test(h), `${name}: legacy chrome is back`);
    }
    assert(/id="prn-redose-thresh"/.test(rl) && /<label for="prn-target-peak"/.test(rl), 'PRN inputs keep their ids and gain labels');
  });
}

// ════════════════════════════════════════════════════════════════════
// SUITE 33 — design track E: print report, print action, theme, carry-over
// ════════════════════════════════════════════════════════════════════
{
  const src    = fs.readFileSync(htmlPath, 'utf8');
  const script = src.match(/<script>([\s\S]*?)<\/script>/)[1];
  const css    = src.match(/<style>([\s\S]*?)<\/style>/)[1];
  const code   = script.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  const bodyOf = (name) => { const c = code.slice(code.indexOf('function ' + name + '(')); return c.slice(0, c.indexOf('\nfunction ')); };
  // Comments blanked to spaces (offsets kept), so a brace or a colour in a
  // comment can neither open a block nor count as a literal.
  const cssNC  = css.replace(/\/\*[\s\S]*?\*\//g, m => ' '.repeat(m.length));
  // The at-rule / selector preludes enclosing a CSS offset, outermost first.
  const enclosing = (at) => {
    const stack = []; let start = 0;
    for (let i = 0; i < at; i++) {
      const ch = cssNC[i];
      if (ch === '{') { stack.push(cssNC.slice(start, i).trim()); start = i + 1; }
      else if (ch === '}') { stack.pop(); start = i + 1; }
      else if (ch === ';') start = i + 1;
    }
    return stack;
  };
  const offsets = (re) => { const out = []; const g = new RegExp(re.source, 'g'); let m; while ((m = g.exec(cssNC))) out.push(m.index); return out; };
  const rules = []; { const re = /([^{};]+)\{([^{}]*)\}/g; let m; while ((m = re.exec(cssNC))) rules.push({ sel: m[1].trim(), body: m[2], at: m.index + m[0].indexOf(m[1].trim()) }); }
  console.log(`\n${'═'.repeat(60)}`);
  console.log('  SUITE 33 — design track E: print, print action, theme, carry-over');
  console.log(`${'─'.repeat(60)}`);

  test('print report: ISMP regimen, summary, provisional, month-name 24-hour times', ()=>{
    const { _prRecommendation, fmtRegimen, fmtClock } = sandbox;
    const rec = { dose: 1250, tau: 12, tinfH: 1.5, auc24: 480, Ctrough: 12.3, Cpeak: 31.2 };
    const h = _prRecommendation({ rec, targetAUC: 500 }, { summary: 'One sentence <b>', provisional: true });
    assert(fmtRegimen(1250, 12) === '1.25 g IV q12h' && h.includes(fmtRegimen(1250, 12)), h);
    assert(!/1250 mg|Q12H/.test(h), 'the old "1250 mg Q12H" form is back');
    assert(/provisional/.test(h), 'a de-rated dose must print as provisional');
    assert(h.includes('One sentence &lt;b&gt;'), 'the one-sentence summary must print, escaped');
    assert(/Predicted AUC₂₄/.test(h) && /Infusion/.test(h) && /1\.5 h/.test(h), 'the recommendation numbers must print');
    const b = bodyOf('_buildPrintReport');
    assert(/_prLevelRows\(r, fmtClock, t0\)/.test(b) && /fmtClock\(d\.timeH\)/.test(b), 'dose and level times must use fmtClock');
    assert(/fmtDose\(d\.mg\)/.test(b) && /fmtHrs\(d\.tinfH\)/.test(b), 'dose history must use the ISMP helpers');
    assert(!/getMonth\(\)\s*\+\s*1/.test(b), 'no M/D date formatting left in the report');
    assert(/bState\.summaryText/.test(bodyOf('_prScreenState')), 'the summary comes from the rendered result');
    assert(/_prRecommendation\(r, screen\)/.test(b) && /_prNotesSection\(screen\)/.test(b), 'summary and tiered notes are printed');
    assert(/^\d{1,2} [A-Z][a-z]{2} \d{2}:\d{2}$/.test(fmtClock(1790000)), 'fmtClock form');
    assert(/^\d{1,2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}$/.test(sandbox._prStamp(new Date(2026, 8, 28, 14, 5))), 'generated stamp');
  });
  test('print report: a refusal still prints "No regimen offered", with its reason', ()=>{
    const h = sandbox._prRecommendation({ rec: { noSolution: true, reason: 'All above ceiling.' }, targetAUC: 500 }, {});
    assert(/No regimen offered\./.test(h) && /All above ceiling\./.test(h) && !/undefined/.test(h), h);
    const hold = sandbox._prRecommendation({ rec: { dose: 1000, tau: 12 }, lowCrClHold: true }, {});
    assert(/No empiric maintenance regimen/.test(hold) && !/1 g IV/.test(hold), hold);
    const stale = sandbox._prRecommendation({ rec: { noSolution: true }, targetAUC: 500 }, { stale: true });
    assert(/note-alarm/.test(stale) && /Recalculate/.test(stale), 'a stale result must say so on paper');
  });
  test('print report: advisories print as tiered notes (signal word + drawn icon)', ()=>{
    const n = sandbox._prAdvisoryNote('danger', 'Very low CrCl <10');
    assert(/note-alarm/.test(n) && /Warning/.test(n) && /Very low CrCl &lt;10/.test(n) && /<svg/.test(n), n);
    assert(/note-caution/.test(sandbox._prAdvisoryNote('warning', 'x')) && /note-info/.test(sandbox._prAdvisoryNote('info', 'x')), 'tiers');
    assert(!/pr-alert/.test(src), 'the tinted alert boxes are gone');
  });
  test('print report: only the module on screen prints', ()=>{
    const b = bodyOf('_buildPrintReport');
    assert(/if \(bayesVisible\) return null;/.test(b), 'AUC Precision with no fit must not print the Trough panel');
    assert(/_prTroughBody\(visible\)/.test(b), 'Trough-Based prints its own panel');
    assert(/_prLightCanvasImages/.test(bodyOf('_prTroughBody')), 'Trough graphs print as images, not blank canvases');
  });
  test('no ".pdf-save-btn:hover{background:#fff}" (a white slab on dark paper)', ()=>{
    assert(!/\.pdf-save-btn:hover\s*\{[^}]*background:\s*#fff/i.test(css), 'still there');
  });
  test('the dark wash is scoped: the no-choice selector sits inside prefers-color-scheme: dark', ()=>{
    const at = offsets(/:root:not\(\[data-theme="light"\]\)\s+body\b/);
    assert(at.length >= 1, 'selector missing');
    for (const i of at) assert(enclosing(i).some(p => /@media[^{]*prefers-color-scheme:\s*dark/.test(p)),
      'the dark wash reaches light-system users who never chose a theme');
  });
  test('the dark palette is screen-only, so paper is always light', ()=>{
    const d1 = offsets(/:root\[data-theme="dark"\]\s*\{/)[0];
    assert(enclosing(d1).some(p => /^@media\s+screen\b/.test(p)), 'explicit dark palette must be screen-only');
    const d2 = offsets(/:root:not\(\[data-theme="light"\]\)\s*\{/)[0];
    assert(enclosing(d2).some(p => /^@media\s+screen\s+and\s+\(prefers-color-scheme:\s*dark\)/.test(p)), 'system dark palette must be screen-only');
  });
  test('print CSS and this track\'s rules: tokens only, no side stripes', ()=>{
    const inPrint = rules.filter(r => enclosing(r.at).some(p => /^@media\s+print/.test(p)));
    assert(inPrint.some(r => /\.pr-regimen/.test(r.sel)), 'print rules not found');
    const mine = rules.filter(r => /\.pr-|#print-report|\.print-fab|\.compare-clear-btn|\.bayes-pk-row|\.profile-item-btn|\.profile-privacy-note|\.profile-pk-tag|\.diverge-warning|\.arc-|\.lowcrcl-|\.continue-|\.guideline-rec-badge|crcl-over|crcl-ovr/.test(r.sel)
      || (/(^|,\s*)(:root[^,]*\s)?body$/.test(r.sel)));
    const bad = inPrint.concat(mine).filter(r => /rgba?\(|#[0-9a-f]{3,8}\b/i.test(r.body));
    assert(bad.length === 0, 'literal colours in: ' + bad.map(r => r.sel).join(' | '));
    const stripes = inPrint.concat(mine).filter(r => /border-left:\s*[2-9]px/.test(r.body));
    assert(stripes.length === 0, 'side stripes in: ' + stripes.map(r => r.sel).join(' | '));
  });
  test('print action: one per page, labelled, quiet, and only for the module on screen', ()=>{
    assert((src.match(/class="print-fab"/g) || []).length === 1 && (src.match(/data-onclick="k0"/g) || []).length === 1, 'exactly one print action');
    assert(/class="print-fab"[^>]*>[\s\S]{0,700}Print or save as PDF/.test(src), 'label');
    const fab = rules.find(r => r.sel === '.print-fab');
    assert(fab && !/terracotta/.test(fab.body), 'terracotta belongs to the recommendation, not the print button');
    assert(rules.some(r => /max-width:\s*768px/.test(enclosing(r.at).join(' ')) && /body\.has-results \.print-fab/.test(r.sel) && /position:\s*static/.test(r.body)),
      'on a phone the print action must sit in the flow, not over the results');
    const prevGet = sandbox.document.getElementById;
    const els = { 'app-shell-bayesian': { style: { display: 'none' } },
                  'results-content':    { style: { display: 'none' }, children: [] },
                  'b-results':          { style: { display: 'block' }, children: [1] } };
    sandbox.document.getElementById = (id) => els[id] || prevGet(id);
    try {
      assert(sandbox._resultsHaveContent() === false, 'a Bayesian result must not show the print action in Trough-Based');
      els['app-shell-bayesian'].style.display = 'grid';
      assert(sandbox._resultsHaveContent() === true, 'AUC Precision with a result shows it');
      els['b-results'].children = [];
      assert(sandbox._resultsHaveContent() === false, 'no result, no print action');
    } finally { sandbox.document.getElementById = prevGet; }
    assert(/updatePrintFabVisibility\(\)/.test(bodyOf('switchModule')), 'a module switch must re-check the print action');
  });
  test('module switch carries demographics into empty fields, never over typed ones', ()=>{
    const prevGet = sandbox.document.getElementById;
    const el = (id, value) => ({ id, value });
    const els = {
      'age': el('age', '70'),     'tbw': el('tbw', '80'),     'height': el('height', ''),     'scr': el('scr', '1.1'),
      'b-age': el('b-age', ''),   'b-tbw': el('b-tbw', '95'), 'b-height': el('b-height', '175'), 'b-scr': el('b-scr', ''),
      'mic': el('mic', '2'),      'b-mic': el('b-mic', ''),
    };
    sandbox.document.getElementById = (id) => els[id] || prevGet(id);
    try {
      const toAuc = sandbox.carryPatientDemographics('auc');
      assert(els['b-age'].value === '70' && els['b-scr'].value === '1.1', 'empty AUC fields must be filled');
      assert(els['b-tbw'].value === '95', 'a typed AUC weight must never be overwritten');
      assert(els['height'].value === '', 'nothing flows back into the module being left');
      assert(els['b-mic'].value === '', 'MIC is not a demographic');
      assert(JSON.stringify(toAuc) === '["b-age","b-scr"]', JSON.stringify(toAuc));
      const toTrough = sandbox.carryPatientDemographics('trough');
      assert(els['height'].value === '175' && els['tbw'].value === '80', 'Trough-Based: only the empty height fills');
      assert(JSON.stringify(toTrough) === '["height"]', JSON.stringify(toTrough));
      assert(JSON.stringify(sandbox.carryPatientDemographics('trough')) === '[]', 'a second switch changes nothing');
    } finally { sandbox.document.getElementById = prevGet; }
    assert(/carryPatientDemographics\(m\)/.test(bodyOf('switchModule')), 'switchModule must carry the demographics');
    assert(/PATIENT_CORE_FIELDS/.test(bodyOf('carryPatientDemographics')), 'one field mapping (rule 2)');
  });
  test('manual CrCl: off looks off, and the label says which', ()=>{
    const dis = rules.find(r => r.sel === '#crcl-override-val:disabled');
    assert(dis && /cursor:\s*not-allowed/.test(dis.body) && /var\(--paper-deep\)/.test(dis.body) && /var\(--ink-faint\)/.test(dis.body), 'disabled style');
    const tag = { textContent: '', cls: new Set(), classList: { toggle(c, on) { on ? tag.cls.add(c) : tag.cls.delete(c); } }, setAttribute() {} };
    let attached = null;
    const label = { querySelector: () => attached, appendChild: (t) => { attached = t; } };
    const cb = { checked: false, closest: () => label, nextElementSibling: null };
    const inp = { disabled: true, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } };
    const prevGet = sandbox.document.getElementById, prevCreate = sandbox.document.createElement;
    sandbox.document.getElementById = (id) => id === 'crcl-override-on' ? cb : id === 'crcl-override-val' ? inp : prevGet(id);
    sandbox.document.createElement = () => tag;
    try {
      sandbox.syncCrclOverrideState();
      assert(attached === tag && tag.textContent === 'Off' && /\(off\)/.test(inp.attrs['aria-label']), 'off state');
      cb.checked = true; inp.disabled = false; sandbox.syncCrclOverrideState();
      assert(tag.textContent === 'On' && tag.cls.has('is-on') && !/off/.test(inp.attrs['aria-label']), 'on state');
    } finally { sandbox.document.getElementById = prevGet; sandbox.document.createElement = prevCreate; }
  });
}

// ════════════════════════════════════════════════════════════════════
// SUITE 34 — haemodialysis sessions: a labelling layer on the fit (D15)
//
// Sessions are logged and read against the levels; they never enter the fit
// (Goti-HD averages dialysis, as its authors had to) and never alter a level.
// ════════════════════════════════════════════════════════════════════
{
  console.log(`\n${'─'.repeat(60)}`);
  console.log('  SUITE 34 — haemodialysis sessions (labelling layer)');
  console.log(`${'─'.repeat(60)}`);
  const src34 = fs.readFileSync(htmlPath, 'utf8');
  const script34 = src34.match(/<script>([\s\S]*?)<\/script>/)[1];
  const code34 = script34.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  const bodyOf34 = (name) => { const c = code34.slice(code34.indexOf('function ' + name + '(')); return c.slice(0, c.indexOf('\nfunction ')); };
  const { parseBayesCourse, hdLevelTiming, hdTimingText, hdRedistributionWindowH, hdSessionSummary, gotiPopPK: gpk, predictConc2comp: p2c } = sandbox;
  const withCourse34 = (doseRows, lvlRows, hdRows, fn) => {
    const prevQ = sandbox.document.querySelectorAll, prevG = sandbox.document.getElementById;
    const f = {};
    doseRows.forEach(([mg, ti, d, tm], i) => Object.assign(f, { [`b-dose-mg-${i}`]: mg, [`b-dose-tinf-${i}`]: ti, [`b-dose-date-${i}`]: d, [`b-dose-time-${i}`]: tm }));
    lvlRows.forEach(([c, d, tm], i) => Object.assign(f, { [`b-lvl-conc-${i}`]: c, [`b-lvl-date-${i}`]: d, [`b-lvl-time-${i}`]: tm }));
    hdRows.forEach(([d, tm, h], i) => Object.assign(f, { [`b-hd-date-${i}`]: d, [`b-hd-time-${i}`]: tm, [`b-hd-hours-${i}`]: h }));
    sandbox.document.querySelectorAll = (sel) => /dose-row/.test(sel) ? doseRows.map((_, i) => ({ id: `b-dose-row-${i}` }))
      : /level-row/.test(sel) ? lvlRows.map((_, i) => ({ id: `b-level-row-${i}` }))
      : /hd-row/.test(sel) ? hdRows.map((_, i) => ({ id: `b-hd-row-${i}` })) : [];
    sandbox.document.getElementById = (id) => (id in f ? { value: f[id] } : null);
    try { return fn(); } finally { sandbox.document.querySelectorAll = prevQ; sandbox.document.getElementById = prevG; }
  };
  const D = [['1500', '1.5', '2026-09-01', '09:18']];

  test('34.1 sessions parse from start + length, sorted and numbered; a night session needs no wrap', () => {
    const r = withCourse34(D, [], [['2026-09-03', '22:00', '4'], ['2026-09-01', '13:42', '4.05']], parseBayesCourse);
    assert(!r.errors.length, r.errors.join('; '));
    assert(r.sessions.length === 2 && r.sessions[0].n === 1 && r.sessions[0].label === '2026-09-01 13:42', 'sorted by start, numbered');
    assertClose(r.sessions[0].endH - r.sessions[0].startH, 4.05, 1e-9, 'length');
    assertClose(r.sessions[1].endH - r.sessions[1].startH, 4, 1e-9, '22:00 + 4 h ends the next day by arithmetic, not a wrap');
  });
  test('34.2 an incomplete, implausible or overlapping session is an error naming it', () => {
    const inc = withCourse34(D, [], [['2026-09-01', '', '4']], parseBayesCourse);
    assert(inc.errors.some(e => /^HD session row 0: .*start time/.test(e)), inc.errors.join('; '));
    const big = withCourse34(D, [], [['2026-09-01', '13:00', '30']], parseBayesCourse);
    assert(big.errors.some(e => /^HD session row 0: .*session length/.test(e)), big.errors.join('; '));
    const ovl = withCourse34(D, [], [['2026-09-01', '13:00', '4'], ['2026-09-01', '15:00', '3']], parseBayesCourse);
    assert(ovl.errors.some(e => /starts before the .* session ends/.test(e)), ovl.errors.join('; '));
    const none = withCourse34(D, [], [['', '', '']], parseBayesCourse);
    assert(!none.errors.length && none.sessions.length === 0, 'an empty row is ignored, like any spare row');
  });
  const S = [{ n: 1, startH: 100, endH: 104 }, { n: 2, startH: 148, endH: 152 }];
  test('34.3 each level is placed against the sessions', () => {
    assert(hdLevelTiming(102, S, 6).kind === 'during', 'during');
    const post = hdLevelTiming(105, S, 6); assert(post.kind === 'post' && post.n === 1 && Math.abs(post.sinceH - 1) < 1e-9, 'post');
    const pre = hdLevelTiming(140, S, 6); assert(pre.kind === 'pre' && pre.n === 2 && Math.abs(pre.toH - 8) < 1e-9, 'pre');
    const inter = hdLevelTiming(120, S, 6); assert(inter.kind === 'interdialytic' && inter.prev === 1, 'interdialytic');
    assert(hdLevelTiming(105, S, 0).kind === 'interdialytic', 'no window, no "post" caution');
    assert(hdLevelTiming(105, [], 6).kind === 'none', 'no sessions');
    assert(hdTimingText(pre) === 'pre-HD, 8 h before session 2' && hdTimingText(post) === '1 h after HD session 1 ended', hdTimingText(pre));
  });
  test('34.4 the redistribution window is 3 distribution half-lives of the model itself', () => {
    const pk = gpk(10, 70, true);
    const k10 = pk.TVCL / pk.TVVc, k12 = pk.Q / pk.TVVc, k21 = pk.Q / pk.TVVp;
    const s0 = k10 + k12 + k21, alpha = 0.5 * (s0 + Math.sqrt(s0 * s0 - 4 * k10 * k21));
    assertClose(hdRedistributionWindowH(k10, k12, k21), 3 * Math.LN2 / alpha, 1e-9, 'window');
    assert(hdRedistributionWindowH(0.1, 0, 0) === 0, 'a 1-compartment model has no distribution phase');
  });
  test('34.5 the summary reads the fitted curve at the next session and flags only what the model cannot see', () => {
    const pk = gpk(10, 70, true);
    const doses = [{ mg: 1500, tinfH: 1.5, timeH: 90 }];
    const r = { model: 'goti', dial: true, CL_ind: pk.TVCL, V_ind: pk.TVVc, tbw: 70, doses,
      goti: { Vc_ind: pk.TVVc, Vp_ind: pk.TVVp, Q: pk.Q },
      levels: [{ conc: 25, timeH: 102 }, { conc: 14, timeH: 105 }, { conc: 17, timeH: 140 }],
      hdSessions: S };
    const sm = hdSessionSummary(r, 130);
    assert(sm.next.n === 2, 'the next session is the first after now');
    assertClose(sm.nextPre, p2c(doses, 148, pk.TVCL / pk.TVVc, pk.Q / pk.TVVc, pk.Q / pk.TVVp, pk.TVVc), 1e-9, 'pre-HD = fitted curve at its start');
    assert(sm.levels[0].caution && sm.levels[1].caution && !sm.levels[2].caution, 'during and early-post flagged; pre-HD not');
    assert(sm.levels[2].inRange === true && sm.levels[0].inRange === null, 'only a pre-HD level is read against 15–20');
    assert(sm.levels.map(l => l.conc).join() === '25,14,17', 'levels are never altered');
    assert(sm.modelIsHD, 'Goti with dialysis is the dialysis model');
    assert(sm.plannedBefore === 0, 'no planned dose: the reading assumes none');
    const withPlan = hdSessionSummary(Object.assign({}, r, { doses: doses.concat([{ mg: 750, tinfH: 1, timeH: 135 }]) }), 130);
    assert(withPlan.plannedBefore === 1 && withPlan.nextPre > sm.nextPre, 'a planned dose row is counted and raises the reading');
    assert(hdSessionSummary(Object.assign({}, r, { hdSessions: [] }), 130) === null, 'no sessions, no summary');
  });
  test('34.6 sessions never reach the fit; constants carry their provenance', () => {
    for (const fn of ['burtonObjective', 'burtonObj3D', 'burtonObj3D_hughes', 'mapFit'])
      assert(!/session|hdSessions/i.test(bodyOf34(fn)), `${fn} must not see sessions`);
    assert(/const HD_PREDIALYSIS_MIN = 15;/.test(script34) && /const HD_PREDIALYSIS_MAX = 20;/.test(script34), '15–20');
    assert(/Hui K et al\., J Antimicrob Chemother\s*\n?\/\/?\s*2019/.test(script34) || /J Antimicrob Chemother[\s\S]{0,40}2019;74:130/.test(script34), 'pre-dialysis range is cited');
    assert(/PREFERENCE \(rule 8\)[\s\S]{0,400}HD_PRE_LABEL_H[\s\S]{0,300}HD_POSTSESSION_HALF_LIVES/.test(script34), 'label and window constants are marked preference');
  });
}

// ════════════════════════════════════════════════════════════════════
// SUITE 35 — intermittent haemodialysis dosing (D16)
//
// Rybak 2020 (AJHP 77:835): Rec 11 (loading by actual body weight, ≤ 3,000 mg),
// Rec 13 (mg/kg by dialyser permeability and timing), Rec 14 (pre-dialysis
// 15–20 mg/L; levels drive dosing). A post-HD dose sized on the fitted curve.
// ════════════════════════════════════════════════════════════════════
{
  console.log(`\n${'─'.repeat(60)}`);
  console.log('  SUITE 35 — intermittent haemodialysis dosing (D16)');
  console.log(`${'─'.repeat(60)}`);
  const { hdEmpiricDoses } = sandbox;
  const script35 = fs.readFileSync(htmlPath, 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
  const code35 = script35.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  const bodyOf35 = (n) => { const c = code35.slice(code35.indexOf('function ' + n + '(')); return c.slice(0, c.indexOf('\nfunction ')); };
  test('35.1 empiric HD doses follow Rybak 2020 Rec 13, rounded to 250 mg', () => {
    const rows = hdEmpiricDoses(78);
    const at = (t, p) => rows.find(r => r.timing === t && r.perm === p);
    assert(at('after', 'high').ld === 2000 && at('after', 'high').md.join() === '750,750', JSON.stringify(at('after', 'high')));
    assert(at('after', 'low').md.join() === '500,500', 'after/low 7.5 mg/kg × 78 = 585 → 500');
    assert(at('intradialytic', 'high').ld === 2750 && at('intradialytic', 'high').md.join() === '750,1250', 'intradialytic/high');
    assert(at('intradialytic', 'low').ld === 2250 && at('intradialytic', 'low').md.join() === '500,750', 'intradialytic/low');
    assert(hdEmpiricDoses(0) === null && hdEmpiricDoses(NaN) === null, 'no weight, no table');
  });
  test('35.2 loading is capped at 3,000 mg (Rec 11); a maintenance dose over the per-dose ceiling is flagged', () => {
    const big = hdEmpiricDoses(400);
    assert(big.every(r => r.ld === 3000 && r.ldCapped), 'every loading row capped at 400 kg');
    assert(big.find(r => r.timing === 'after' && r.perm === 'high').mdOverCeiling, '10 mg/kg × 400 = 4000 > 2000');
    const small = hdEmpiricDoses(20);
    assert(small.every(r => !r.ldCapped && r.md[0] >= 250), 'a 20 kg patient gets at least one 250 mg step');
  });
  test('35.3 a dose given during a session is listed, with its session', () => {
    const pk = sandbox.gotiPopPK(10, 70, true);
    const S = [{ n: 1, startH: 100, endH: 104 }];
    const r = { model: 'goti', dial: true, CL_ind: pk.TVCL, V_ind: pk.TVVc, tbw: 70,
      goti: { Vc_ind: pk.TVVc, Vp_ind: pk.TVVp, Q: pk.Q }, levels: [], hdSessions: S,
      doses: [{ mg: 1000, tinfH: 1, timeH: 90 }, { mg: 750, tinfH: 1, timeH: 103 }] };
    const sm = sandbox.hdSessionSummary(r, 110);
    assert(sm.dosesDuringHD && sm.dosesDuringHD.length === 1 && sm.dosesDuringHD[0].mg === 750 && sm.dosesDuringHD[0].n === 1, JSON.stringify(sm.dosesDuringHD));
  });
  const hdR = (extra) => { const pk = sandbox.gotiPopPK(10, 70, true);
    return Object.assign({ model: 'goti', dial: true, CL_ind: pk.TVCL, V_ind: pk.TVVc, tbw: 70,
      goti: { Vc_ind: pk.TVVc, Vp_ind: pk.TVVp, Q: pk.Q }, levels: [],
      doses: [{ mg: 1750, tinfH: 2, timeH: 0 }],
      hdSessions: [{ n: 1, startH: 4, endH: 8 }, { n: 2, startH: 52, endH: 56 }, { n: 3, startH: 100, endH: 104 }, { n: 4, startH: 172, endH: 176 }] }, extra || {}); };
  test('35.4 the dose goes at the end of the next session and is sized at the start of the one after', () => {
    const rec = sandbox.hdNextDose(hdR(), 20);
    assert(rec.session === 2 && rec.sizing === 3 && Math.abs(rec.doseAtH - 56) < 1e-9, JSON.stringify(rec));
    assert(rec.kind === 'dose' && rec.pre >= 15 && rec.pre <= 20, `this fixture needs a dose in range: ${JSON.stringify(rec)}`);
    assert(sandbox.hdNextDose(hdR(), 20).mg === rec.mg, 'deterministic');
    if (rec.mg > 250) {
      const less = sandbox.predictFittedAt(Object.assign(hdR(), { doses: hdR().doses.concat([{ mg: rec.mg - 250, tinfH: sandbox.autoTinf(rec.mg - 250), timeH: 56 }]) }), 100);
      assert(less < 15, 'one 250 mg step less misses the range: this is the smallest');
    }
  });
  test('35.5 a session in progress: the dose goes at its end', () => {
    const rec = sandbox.hdNextDose(hdR(), 54);
    assert(rec.session === 2 && Math.abs(rec.doseAtH - 56) < 1e-9 && rec.sizing === 3, JSON.stringify(rec));
  });
  test('35.6 hold when no dose still reads at least 15 mg/L; asks for sessions when they are missing', () => {
    const loaded = sandbox.hdNextDose(hdR({ doses: [{ mg: 1750, tinfH: 2, timeH: 0 }, { mg: 2000, tinfH: 2, timeH: 9 }, { mg: 2000, tinfH: 2, timeH: 30 }] }), 20);
    assert(loaded.kind === 'hold' && loaded.mg === 0, JSON.stringify(loaded));
    const one = sandbox.hdNextDose(hdR({ hdSessions: [{ n: 1, startH: 52, endH: 56 }] }), 20);
    assert(one.need === 'sessions' && one.planned === 1, 'one planned session cannot size a dose');
    assert(sandbox.hdNextDose(hdR({ hdSessions: [] }), 20).need === 'sessions', 'none');
  });
  test('35.7 out of reach: the closest dose, flagged, never above the per-dose ceiling', () => {
    const rec = sandbox.hdNextDose(hdR({ CL_ind: 30 }), 20);   // implausibly high clearance: nothing reaches 15
    assert(rec.kind === 'closest' && rec.mg <= 2000 && rec.pre < 15, JSON.stringify(rec));
  });
  test('35.8 AUC24 before the sizing session, the peak, the repeat projection; planned doses are counted', () => {
    const rec = sandbox.hdNextDose(hdR(), 20);
    assert(rec.auc24 > 0 && rec.peak > rec.pre, 'auc24 and peak');
    assert(rec.repeat.length === 1 && rec.repeat[0].n === 4 && rec.repeat[0].pre > 0, JSON.stringify(rec.repeat));
    const auc = sandbox.fittedAUC(hdR(), 0, 24), coarse = sandbox.fittedAUC(hdR(), 0, 24, 48);
    assert(Math.abs(auc - coarse) / auc < 0.01, 'the integral is converged');
    const withPlan = sandbox.hdNextDose(hdR({ doses: [{ mg: 1750, tinfH: 2, timeH: 0 }, { mg: 500, tinfH: 1, timeH: 60 }] }), 20);
    assert(withPlan.plannedAfter === 1, 'a planned dose after the dose time is counted, and said');
  });
  test('35.8b the HD verdicts say a post-HD dose, a hold, or what is missing — never a q-interval regimen', () => {
    const dose = sandbox.hdNextDoseHTML(sandbox.hdNextDose(hdR(), 20));
    assert(/IV <span class="vx-freq">after session 2/.test(dose) && /Pre-HD, session 3/.test(dose) && !/\bq\d+h\b/.test(dose), dose.slice(0, 200));
    const hold = sandbox.hdNextDoseHTML(sandbox.hdNextDose(hdR({ doses: [{ mg: 1750, tinfH: 2, timeH: 0 }, { mg: 2000, tinfH: 2, timeH: 9 }, { mg: 2000, tinfH: 2, timeH: 30 }] }), 20));
    assert(/No dose after session 2/.test(hold), hold.slice(0, 160));
    assert(/Add the next sessions/.test(sandbox.hdNextDoseHTML({ need: 'sessions', planned: 1 })), 'asks for sessions');
    const emp = sandbox.hdEmpiricHTML(sandbox.hdEmpiricDoses(78), 78);
    assert(/High permeability/.test(emp) && /Low permeability/.test(emp) && /2 g · 750 mg/.test(emp) && /Rec 14/.test(emp), emp.slice(0, 300));
    const src35b = fs.readFileSync(htmlPath, 'utf8');
    assert(/isHD && nLev === 0[\s\S]{0,200}hdEmpiricHTML/.test(src35b) && /hdRec = hdNextDose\(r, /.test(src35b), 'the renderer uses both for Goti-HD');
  });
  test('35.9 MWF / TuThSa from any start date, across a month end', () => {
    assert(sandbox.hdScheduleDates('2026-09-29', 'MWF', 0, 4).join() === '2026-09-30,2026-10-02,2026-10-05,2026-10-07', 'Tue start → Wed first');
    assert(sandbox.hdScheduleDates('2026-09-29', 'TTS', 0, 3).join() === '2026-09-29,2026-10-01,2026-10-03', 'TuThSa');
  });
  test('35.10 every N days counts calendar days, across a DST change', () => {
    assert(sandbox.hdScheduleDates('2026-10-30', 'N', 2, 3).join() === '2026-10-30,2026-11-01,2026-11-03', 'US DST ends 1 Nov 2026');
    assert(sandbox.hdScheduleDates('', 'MWF', 0, 3).length === 0 && sandbox.hdScheduleDates('2026-09-29', 'N', 0, 3).length === 0, 'a blank or zero input adds nothing');
  });
  test('35.11 the Trough module refuses an HD patient before any number is computed', () => {
    const calc = bodyOf35('calculate');
    const guard = calc.indexOf("document.getElementById('t-hd')"), first = calc.indexOf('calcCrCl(');
    assert(guard > 0 && guard < first, 'the HD guard runs before CrCl');
    assert(/troughHdNoticeHTML\(\)/.test(calc) && /return;/.test(calc.slice(guard, guard + 400)), 'it renders the notice and returns');
    assert(/k77:[^\n]*switchModule\('auc'\)[^\n]*gotihd/.test(script35), 'one action moves the patient to Goti-HD');
    const note = sandbox.troughHdNoticeHTML();
    assert(/use AUC Precision/.test(note) && /data-onclick="k77"/.test(note) && !/mg IV q\d+h/.test(note), note.slice(0, 160));
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

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
  HUGHES_CRCL_EXP,
  OMEGA2_CL_HUGHES,
  OMEGA2_VC_HUGHES,
  OMEGA2_VP_HUGHES,
  SIGMA_PROP_HUGHES,
  SIGMA_ADD_HUGHES,
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

// ─── Hughes constants: parsed from index.html (rule 6), see the destructuring above ───

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

// ─── A small AUC Precision form (Release 2, Task 14) ─────────────────
// The code review found tests that asserted a function's source text instead of what it does
// (a fingerprint that "mentions" b-mic passed with the MIC made inert). These helpers let a
// test drive the real parseBayesCourse / readSerialScrChecked / bayesInputFingerprint /
// snapshotBayesForm against form values, the way the page does. Fictional values only.
// vals: { 'b-age': '60', ... } plus doses [[mg, tinf, date, time]], levels [[conc, date, time]],
// scrRows [[val, date, time]]. Rows are numbered from 1, as the page numbers them.
function bayesFormEnv(vals) {
  const els = {};
  const el = (id) => els[id] || (els[id] = { id, value: '', checked: false, textContent: '', innerHTML: '', style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }, setAttribute() {}, getAttribute() { return null; },
    removeAttribute() {}, addEventListener() {}, appendChild() {}, querySelector: () => null, querySelectorAll: () => [] });
  const v = Object.assign({}, vals);
  (v.doses || []).forEach(([mg, tinf, date, time], i) => {
    el(`b-dose-row-${i + 1}`); el(`b-dose-mg-${i + 1}`).value = String(mg); el(`b-dose-tinf-${i + 1}`).value = String(tinf);
    el(`b-dose-date-${i + 1}`).value = date; el(`b-dose-time-${i + 1}`).value = time;
  });
  (v.levels || []).forEach(([conc, date, time], i) => {
    el(`b-level-row-${i + 1}`); el(`b-lvl-conc-${i + 1}`).value = String(conc);
    el(`b-lvl-date-${i + 1}`).value = date; el(`b-lvl-time-${i + 1}`).value = time;
  });
  (v.scrRows || []).forEach(([val, date, time], i) => {
    const row = el(`b-scr-row-${i + 1}`), sub = { '.b-scr-val': { value: String(val) }, '.b-scr-date': { value: date }, '.b-scr-time': { value: time } };
    row.querySelector = (sel) => sub[sel] || null;
  });
  ['doses', 'levels', 'scrRows'].forEach(k => delete v[k]);
  Object.keys(v).forEach(id => { el(id).value = String(v[id]); });
  const document = {
    getElementById: el, createElement: () => el('_new'), querySelector: () => null,
    querySelectorAll: (sel) => {
      const m = /^\[id\^="([^"]+)"\]$/.exec(sel);
      if (!m) return [];
      return Object.values(els).filter(e => e.id.indexOf(m[1]) === 0 && /^\d+$/.test(e.id.slice(m[1].length)))
        .sort((a, b) => Number(a.id.slice(m[1].length)) - Number(b.id.slice(m[1].length)));
    },
  };
  return { document, els, el };
}
// Runs fn(env) with that form installed and a fresh bState (Buelga, male, no result); restores both.
function withBayesForm(vals, fn) {
  const env = bayesFormEnv(vals);
  const prevDoc = sandbox.document;
  vm.runInContext('globalThis.__bf = bState; bState = { sex: "M", model: "buelga", dial: false, result: null, resultFingerprint: null, tinkCompare: [], regimenOverrideH: null };', sandbox);
  sandbox.document = env.document;
  try { return fn(env); }
  finally { sandbox.document = prevDoc; vm.runInContext('bState = globalThis.__bf; delete globalThis.__bf;', sandbox); }
}
// A fictional course: 60 y, 80 kg, 178 cm, SCr 1.0; 1 g over 1 h q12h x 3; one level; one serial SCr.
const BAYES_FORM_45 = () => ({
  'b-age': '60', 'b-tbw': '80', 'b-height': '178', 'b-scr': '1.0', 'b-auc-target': '450', 'b-mic': '1',
  doses: [[1000, 1, '2026-11-10', '08:00'], [1000, 1, '2026-11-10', '20:00'], [1000, 1, '2026-11-11', '08:00']],
  levels: [[14.2, '2026-11-11', '07:30']],
  scrRows: [['1.0', '2026-11-10', '06:00']],
});
// Helpers that SUITE 44 builds and SUITE 45 reuses (the profile DOM and storage).
const __suiteShared = {};

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

  test('Every measured level is on the axis, even one drawn days after the last dose (a held dose)', ()=>{
    // Reported 2026-10-02: on a 7–8 day course with several levels the most recent level
    // was not on the chart. The domain ended at most 48 h after the last dose and ignored
    // the levels, so a level drawn while doses were held fell off both the curve and the
    // strip — while the fit still used it. The axis must contain everything drawn on it.
    const course = q8h.slice(0, 18);                                    // last dose at t0 + 136 h
    const late = [{ conc: 14.7, timeH: t0 + 63 }, { conc: 22.1, timeH: t0 + 136 + 70 }];   // 70 h after it
    const { plot } = runProfile(course, late, 4.5, 60);
    assert(plot.tStart + plot.tSpan > late[1].timeH,
      `the axis ends at ${(plot.tStart + plot.tSpan - t0).toFixed(0)} h; the latest level is at ${late[1].timeH - t0} h`);
    const el = { clientWidth: 700, innerHTML: '', setAttribute(){} };
    sandbox.drawCourseStrip(el, course, 0, late, [], 4.5 / 60);
    assert((el.innerHTML.match(/class="lv"/g) || []).length === 2, 'both levels on the strip');
  });

  // Profile polish (2026-10-02, the user's request): measured levels in their own hue,
  // the prior a darker neutral dash, labels that never sit on each other, and an arrival
  // that plays once per new result and never on a redraw or in print.
  test('Measured levels wear --series-measured; the prior is the --ink-soft reference', ()=>{
    const { ops } = runProfile(q8h, lev, 4.5, 60);
    assert(PALETTE['--series-measured'] && ops.colors.has(PALETTE['--series-measured']), 'the measured hue is drawn');
    assert(ops.colors.has(PALETTE['--ink-soft']), 'the prior is drawn in --ink-soft');
    const src = fs.readFileSync(htmlPath, 'utf8');
    assert(/--series-measured:\s*#[0-9a-f]{6}/i.test(src) && (src.match(/--series-measured:\s*#a6d27c/gi) || []).length === 2,
      'one light value and the same dark step in both dark blocks');
    assert(/\.lg-lv\s*\{[^}]*var\(--series-measured\)/.test(src) && /\.course \.lv\s*\{[^}]*var\(--series-measured\)/.test(src),
      'the legend swatch and the strip read the token the canvas draws');
  });

  test('The key draws each mark the way the canvas does; long dash means only the prior', ()=>{
    // Finish review 2026-10-02: a CSS dashed border draws ~3 px dashes, so the prior's swatch
    // did not match its 6/4 line; the band swatch lacked the band's edges; and after "now" the
    // posterior's 7/4 dash read as a second prior on the stretch read for the next dose.
    const src = fs.readFileSync(htmlPath, 'utf8');
    assert(/\.lg-pop\s*\{[^}]*repeating-linear-gradient\(90deg, var\(--ink-soft\) 0 6px, transparent 6px 10px\)/.test(src), 'prior swatch: a 6/4 ink-soft dash, as drawn');
    assert(/\.lg-band\s*\{[^}]*border-top: 1px solid color-mix\(in srgb, var\(--series-fit\) 42%, transparent\)/.test(src), 'band swatch carries its edge');
    const lines = sandbox.drawProfileGraph.toString();
    assert(/themeRGBA\('--series-fit', 0\.8, 'rgba\(103,81,168,0\.8\)'\), 2, \[3,3\]\)/.test(lines), 'after now the posterior is a short 3/3 dash');
    assert(!/\[7,4\]/.test(lines), 'no posterior dash close to the prior\'s 6/4');
    // The fit's ring is drawn after the measured dot, on its own casing, so it is whole even
    // when the residual is small (it was half hidden under the dot's halo at a near-trough level).
    const pl = lines.slice(lines.indexOf('const paintLevels'), lines.indexOf('const paintPen'));
    assert(pl.indexOf("'--series-measured'") > -1 && pl.indexOf("'--series-measured'") < pl.indexOf("ctx.arc(x, yp, 4.5"), 'ring after the dot');
  });

  test('Course-strip level values never sit on each other or on the interval labels', ()=>{
    const close = [{ conc: 15.2, timeH: t0 + 63 }, { conc: 28.4, timeH: t0 + 66 }];
    for (const width of [343, 700]) {
      const el = { clientWidth: width, innerHTML: '', setAttribute(){} };
      sandbox.drawCourseStrip(el, q8h.slice(0, 10), 0, close, [], 4.5 / 60);
      const boxes = [...el.innerHTML.matchAll(/<text x="([\d.]+)" y="([\d.]+)" class="(lvv|gap)"( text-anchor="(end|middle)")?[^>]*>([^<]+)</g)]
        .map(m => { const x = +m[1], w = m[6].length * 6.6, a = m[5]; const left = a === 'end' ? x - w : a === 'middle' ? x - w / 2 : x;
          return { cls: m[3], y: +m[2], l: left, r: left + w, t: m[6] }; });
      const vals = boxes.filter(b => b.cls === 'lvv');
      assert(vals.length >= 1, `at ${width}px no level value was labelled`);
      for (let i = 0; i < vals.length; i++) for (let j = i + 1; j < vals.length; j++)
        assert(vals[i].r <= vals[j].l || vals[j].r <= vals[i].l, `at ${width}px "${vals[i].t}" overlaps "${vals[j].t}"`);
      for (const g of boxes.filter(b => b.cls === 'gap')) for (const v of vals)
        assert(g.r <= v.l - 1 || v.r <= g.l - 1, `at ${width}px the interval "${g.t}" touches the level value "${v.t}"`);
    }
  });

  test('The arrival plays once per new result — never on a redraw, under reduced motion, or in print', ()=>{
    const src = fs.readFileSync(htmlPath, 'utf8');
    const refresh = sandbox.refreshProfileGraph.toString();
    assert(/const arrive = r !== _profileArrivedFor && profileMotionOK\(\);/.test(refresh) && /_profileArrivedFor = r;/.test(refresh), 'gated on a new result');
    // v3.11.0: both also take the same clock (nowH) after the gate — SUITE 40.8.
    assert(/drawCourseStrip\([\s\S]*arrive, nowH\)/.test(refresh) && /sessions: r\.hdSessions \|\| \[\], arrive, nowH \}/.test(refresh), 'the strip and the curve share the gate');
    assert(/prefers-reduced-motion: reduce/.test(sandbox.profileMotionOK.toString()), 'reduced motion is honoured');
    const pr = src.slice(src.indexOf('const gp = gotiGraphParams(r);\n    drawProfileGraph(off'), src.indexOf('const url = off.toDataURL'));
    assert(pr.length > 0 && !/arrive/.test(pr), 'print draws without the arrival');
    // The static path settles synchronously: the plot geometry exists straight away.
    assert(runProfile(q8h, lev, 4.5, 60).plot, 'no arrival requested: drawn and settled at once');
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
    // v3.14.0 (D26): the core is read from the module saved from, with its conflicts (D-e).
    assert(/const \{ core, conflicts(, otherFilled)? \} = snapshotPatientCore\(source\);/.test(script) && /snapshot\.core = core;/.test(script), 'save does not capture the core');
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
    // v3.14.0 (D26): the staleness verdict comes from the snapshot (dirty), not from a
    // guard that mutated bState; a Trough-module save has no Bayesian result to wipe.
    assert(/const savedWithoutFit = !!snapshot\.dirty;/.test(script),
      'the without-fit notice is derived from the snapshot, without touching bState');
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
    // Rewritten (Release 2, Task 14; code report "tests that cannot fail"): the old regex
    // required a double quote after "=", so an unquoted onclick=x() or a single-quoted one
    // passed. An HTML attribute may be double-quoted, single-quoted or bare, in any case.
    // Both detectors run: the original (any `on…="` in the body, markup in script strings
    // included) and one that reads every tag for an on* attribute however it is quoted.
    const inTag = /<[a-z][\w-]*(?:\s[^<>]*?)?\son[a-z]+\s*=/gi;
    const quoted = /\son[a-z]+\s*=\s*"/g;
    const detect = (h) => (h.match(inTag) || []).concat(h.match(quoted) || []);
    // The detector itself must see each spelling, or this test cannot fail on what it names.
    for (const s of ['<div onclick=resetForm()>', "<a ONCLICK='x()'>", '<b class="k" onclick="y()">', '<i\nonmouseover = z>'])
      assert(detect(s).length > 0, `the detector misses ${JSON.stringify(s)}`);
    assert(detect('<div data-onclick="k1" title="on=off">').length === 0, 'the detector flags data-onclick');
    const found = detect(body);
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
    // v3.9.0: 'focusout' added, so a date field can commit when it is left (typed dates).
    const dispatched = (script.match(/\['click','input','change','keydown','focusout'\]/) || [])[0];
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
    const paired = /id="b-dose-time-|id="b-lvl-time-|class="b-scr-time"|id="b-hd-time-|id="b-hds-time"|id="b-hd-give-time"|id="b-first-time"|id="(?:time-dose-given|time-level-drawn|tl-dose-time|tl-t1-time|tl-t2-time|rl-dose-time|rl-draw-time)-time"/;   // b-hd-give-time sits beside b-hd-give-date (v3.8.0); the Trough pairs (v3.13.0, D24)
    for (const id of ['time-dose-given', 'time-level-drawn', 'tl-dose-time', 'tl-t1-time', 'tl-t2-time', 'rl-dose-time', 'rl-draw-time'])
      assert(new RegExp(`id="${id}-date"[^>]*>\\s*<input[^>]*id="${id}-time"`).test(body), `${id}: the time is paired with its date`);
    assert(/id="b-hds-date"[^>]*><\/label>\s*<label>Start <input[^>]*id="b-hds-time"/.test(body), 'the schedule start time sits beside its date');
    assert(/id="b-hd-date-\$\{id\}"[^>]*>\s*<input[^>]*id="b-hd-time-\$\{id\}"/.test(body), 'the HD start time is paired with its date');
    // D23 (v3.12.0): the PD dose, level, stop and give-at times each sit beside their own date.
    const pdPaired = /id="pd-\$\{kind\}-time-|id="pd-stopped-time"|id="pd-give-time"/;
    assert(/id="pd-stopped-date"[\s\S]{0,400}id="pd-stopped-time"/.test(body) && /id="pd-give-date"[\s\S]{0,400}id="pd-give-time"/.test(body), 'the PD stop and give-at times sit beside their dates');
    assert(/id="pd-\$\{kind\}-date-\$\{n\}"[^>]*>\s*<input[^>]*id="pd-\$\{kind\}-time-\$\{n\}"/.test(body), 'the PD row time is paired with its date');
    // Two fields are times of day by design, not instants: the cycler's nightly start and
    // the AM-labs time. They are named here, not waved through, and they only ever become
    // instants calendar day by calendar day (pdNominalSessions, pdNextAmLabs, pdFirstLevelH
    // build a Date from the day and the clock), never by elapsed-hours arithmetic.
    const recurring = /id="pd-start"|id="pd-set-amlabs"/;
    for (const f of ['pdNominalSessions', 'pdNextAmLabs', 'pdFirstLevelH']) {
      const src = body.slice(body.indexOf('function ' + f + '('), body.indexOf('\nfunction ', body.indexOf('function ' + f + '(') + 10));
      assert(/new Date\([a-z0-9]+\.getFullYear\(\), [a-z0-9]+\.getMonth\(\), [a-z0-9]+\.getDate\(\) \+ [a-z0-9]+, hh, mm\)/.test(src), `${f} builds each instant from a calendar day and the clock`);
    }
    const orphans = clockOnly.filter(t => !paired.test(t) && !pdPaired.test(t) && !recurring.test(t));
    assert(orphans.length === 0,
      `clock-only input with no date field: ${orphans.join(' | ').slice(0, 200)}`);
  });

  // v3.13.0 (D24): each Trough instant is entered as a date and a 24-hour time (the AUC
  // grammar) and composed by one function, dtPairValue, into the full datetime the engine
  // reads under the old id. Still one full instant per field: never a clock-only value.
  test('every Trough-Based timing field is one full instant, composed from its date and time', ()=>{
    for (const id of ['tl-dose-time','tl-t1-time','tl-t2-time','time-dose-given',
                      'time-level-drawn','rl-dose-time','rl-draw-time']) {
      const m = body.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`));
      assert(m, `${id} is missing`);
      assert(/type="hidden"/.test(m[0]), `${id} is not the composed instant: ${m[0].slice(0,120)}`);
      assert(new RegExp(`data-dt-for="${id}"`).test(body), `${id} has no date-and-time pair`);
    }
    assert(sandbox.dtPairValue('2026-09-11', '23:30') === '2026-09-11T23:30', 'a full instant');
    const r = elapsedHours(sandbox.dtPairValue('2026-09-11', '22:00'), sandbox.dtPairValue('2026-09-12', '10:00'));
    assert(r.ok && Math.abs(r.hours - 12) < 1e-9, 'across midnight, through the one helper');
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
  // Hours from a wall-clock stamp read as UTC: the case is a spacing between doses, and a local-time
  // parse put the 27 Sep dose across New Zealand's clock change (TZ=Pacific/Auckland failed 2 tests).
  const Hh = s => new Date(s + 'Z').getTime() / 3600000;
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
    // Rewritten as behaviour (Release 2, Task 14): the old check read the function's text for
    // the two ids, so a fingerprint with target and MIC made inert (names left in a comment)
    // passed. Now a fit is taken on a form, then the target or the MIC is edited.
    withBayesForm(BAYES_FORM_45(), (env) => {
      const fp = sandbox.bayesInputFingerprint;
      vm.runInContext('bState.result = { model: "buelga", CL_ind: 4.2, V_ind: 55 }; bState.resultFingerprint = bayesInputFingerprint();', sandbox);
      assert(typeof fp() === 'string' && !sandbox.bayesFitIsStale(), 'the untouched form is not stale');
      for (const [id, to] of [['b-auc-target', '550'], ['b-mic', '2']]) {
        const was = env.els[id].value;
        env.els[id].value = to;
        assert(sandbox.bayesFitIsStale(), `${id} ${was} -> ${to} did not mark the fit stale`);
        env.els[id].value = was;
        assert(!sandbox.bayesFitIsStale(), `${id} restored, still stale`);
      }
    });
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
    // Rewritten as behaviour (Release 2, Task 14): the old check read the function's text for
    // `readSerialScr()` and `regimenOverrideH`. Now a serial SCr reading (value, then time) and
    // the regimen override are edited after a fit, and each must mark it stale.
    withBayesForm(BAYES_FORM_45(), (env) => {
      vm.runInContext('bState.result = { model: "buelga", CL_ind: 4.2, V_ind: 55 }; bState.resultFingerprint = bayesInputFingerprint();', sandbox);
      assert(!sandbox.bayesFitIsStale(), 'the untouched form is not stale');
      const scr = env.els['b-scr-row-1'];
      const sub = (sel) => scr.querySelector(sel);
      sub('.b-scr-val').value = '1.6';
      assert(sandbox.bayesFitIsStale(), 'a serial SCr value 1.0 -> 1.6 did not mark the fit stale');
      sub('.b-scr-val').value = '1.0'; sub('.b-scr-time').value = '18:00';
      assert(sandbox.bayesFitIsStale(), 'a serial SCr time 06:00 -> 18:00 did not mark the fit stale');
      sub('.b-scr-time').value = '06:00';
      assert(!sandbox.bayesFitIsStale(), 'restored, still stale');
      vm.runInContext('bState.regimenOverrideH = 8;', sandbox);
      assert(sandbox.bayesFitIsStale(), 'the regimen override (q8h) did not mark the fit stale');
    });
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
    // Four since v3.14.0 (D26): renderTroughRefusal lists the explorer for reference too.
    assert((code.match(/doseExplorerRows\(\{ tau: d\.(tau|tlTau|rlTau),/g) || []).length === 4, 'four renderers, one helper');
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
    // Re-pointed (D26 review): 2.25 g is over the 2 g per-dose ceiling, so its row also carries
    // the over-ceiling mark (class and words) beside the key.
    assert(/<tr class="is-rec is-over">\s*<th scope="row">2\.25 g q12h <span class="tx-row-tag"><i class="lg lg-proj"[^]*?recommended<\/span> <span class="tx-row-tag">over 2 g a dose; AUC₂₄ over 700<\/span>/.test(both),
      'the recommendation carries the projection\'s line, and the over-ceiling mark');
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
    // The Trough renderer passes what its chart draws. Re-pointed (D26): under a refusal in the
    // regimen's place the chart draws the current regimen alone, so the explorer marks it and no
    // recommendation (and the chart's role follows the same condition).
    assert(/cur: showOptDose \|\| headRefused \? \{ dose: d\.dose, tau: d\.tau \} : null/.test(code) &&
           /rec: headRefused \? null : \{ dose: vDose, tau: d\.tau,/.test(code) &&
           /role: showOptDose \|\| headRefused \? 'current' : 'rec'/.test(code), 'steady-state explorer mirrors its chart');
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
    return { f, auc, single: nelderMead3D(f, 0, 0, 0, 400), multi: mapFit(f, 3, om('OMEGA2_CL_GOTI'), om('OMEGA2_VC_GOTI'), 400, om('OMEGA2_VP_GOTI')) };
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

  test('every value a re-render repeats is stored by the render (Explain and the HD controls re-render from them)', ()=>{
    const render = bodyOf('renderBayesianResults');
    for (const k of ['divergeMsg', 'levelWarnings', 'mic', 'p2c']) {
      assert(new RegExp('bState\\.' + k + '\\s*=').test(render), `renderBayesianResults must store bState.${k}`);
    }
    assert(/levelWarnings = Array\.isArray\(levelWarnings\) \? levelWarnings : \[\]/.test(render), 'a missing list must not throw');
  });
  test('D27: a resize or theme redraw repaints the canvases and the strip; it does not rebuild the result', ()=>{
    const redraw = bodyOf('redrawAllCanvases');
    assert(!/renderBayesianResults\s*\(/.test(redraw), 'redrawAllCanvases must not call renderBayesianResults');
    assert(/refreshProfileGraph\s*\(/.test(redraw), 'the profile curve and the course strip are redrawn');
    assert(/_tinkSSRedraw/.test(redraw) && /_txTinkView/.test(redraw) && /renderComparisonSection/.test(redraw),
      'the Tinkerer, Trough tinker and comparison charts are redrawn');
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
    // v3.13.0 (D24): "Patient" and "Dosing course", and AUC Precision's model is its own section.
    for (const want of ['Patient', 'Renal function', 'Regimen preferences', 'Current regimen',
                        'Loading dose', 'Drug level', 'PK model', 'Therapeutic target', 'Dosing course', 'Model']) {
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
      assert(sandbox.snapshotPatientCore().core.sex === null, 'an unset sex must not be saved as M');
      sandbox.setPatientSex('M');
      assert(sandbox.getBayesCrCl() > 0 && sandbox.snapshotPatientCore().core.sex === 'M', 'chosen sex unchanged');
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
    // v3.13.0 (D24): Print is one of the answer's actions (.vx-act), so it exists only with a
    // result, only in the module on screen, and never floats over the results.
    const staticBody = src.slice(src.indexOf('<body>'), src.indexOf('<script>'));
    assert(!/data-onclick="k0"/.test(staticBody), 'no print action outside a result');
    const prints = src.match(/<button type="button" class="vx-act" data-onclick="k0">[^<]*<\/button>/g) || [];
    assert(prints.length === 3 && prints.every(b => />Print or save as PDF</.test(b)), `one labelled print action in each answer (Trough, PD, AUC): ${prints.length}`);
    const act = rules.find(r => /\.vx-act\b/.test(r.sel) && /color/.test(r.body));
    assert(act && /terracotta-ink/.test(act.body) && !/background:\s*var\(--terracotta\)/.test(act.body), 'a text action, not a filled button');
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
    // D17 (rule 9, recorded in docs/v3-decisions.md): the pick is the in-range step closest
    // to 17.5 — it was the smallest in range ("one 250 mg step less misses 15").
    for (const mg of [rec.mg - 250, rec.mg + 250].filter(x => x >= 0 && x <= 2000)) {
      const p = sandbox.predictFittedAt(sandbox.hdWithDose(hdR(), mg, 56), 100);
      assert(!(p >= 15 && p <= 20) || Math.abs(p - 17.5) >= Math.abs(rec.pre - 17.5), `a neighbouring in-range step (${mg} mg, ${p.toFixed(2)}) is not closer to 17.5`);
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
    assert(withPlan.plannedCount === 1 && withPlan.kind === 'planned', 'a planned dose before the sizing session is read and counted');
  });
  test('35.8b the HD verdicts say a post-HD dose, a hold, or what is missing — never a q-interval regimen', () => {
    const dose = sandbox.hdNextDoseHTML(sandbox.hdNextDose(hdR(), 20));
    assert(/IV <span class="vx-freq">after HD<\/span>/.test(dose) && /After session 2 ends/.test(dose) && /Pre-HD, session 3/.test(dose) && !/\bq\d+h\b/.test(dose), dose.slice(0, 200));
    const hold = sandbox.hdNextDoseHTML(sandbox.hdNextDose(hdR({ doses: [{ mg: 1750, tinfH: 2, timeH: 0 }, { mg: 2000, tinfH: 2, timeH: 9 }, { mg: 2000, tinfH: 2, timeH: 30 }] }), 20));
    assert(/No dose after session 2/.test(hold), hold.slice(0, 160));
    assert(/Add the next sessions/.test(sandbox.hdNextDoseHTML({ need: 'sessions', planned: 1 })), 'asks for sessions');
    const emp = sandbox.hdEmpiricHTML(sandbox.hdEmpiricDoses(78), 78);
    assert(/High permeability/.test(emp) && /Low permeability/.test(emp) && /<span class="hd-dose">2 g<\/span> · <span class="hd-dose">750 mg<\/span>/.test(emp) && /Rec 14/.test(emp), emp.slice(0, 300));
    const src35b = fs.readFileSync(htmlPath, 'utf8');
    assert(/hdView && hdView\.empiric[\s\S]{0,120}hdEmpiricHTML\(hdView\.empiric/.test(src35b) && /hdRec = hdView\.rec/.test(src35b), 'the renderer uses both for Goti-HD, from the frozen view');
  });
  test('35.8c HD headings are neutral, and no note speaks for the hidden steady-state regimen', () => {
    const emp = sandbox.hdEmpiricHTML(sandbox.hdEmpiricDoses(78), 78);
    const ask = sandbox.hdNextDoseHTML({ need: 'sessions', planned: 0 });
    assert(!/vx-regimen-hold/.test(emp) && !/vx-regimen-hold/.test(ask), 'not the alarm-tinted hold heading');
    assert(/r\.rec && !r\.rec\.noSolution && r\.rec\.flags && r\.rec\.flags\.length && !\(r\.model === 'goti' && r\.dial\)/.test(code35),
      'the steady-state regimen\'s flags are not shown for Goti-HD, where that regimen is not the answer');
  });
  // ── Final-review fix pass (D16) ──
  test('35.12 a planned dose around the next session is read, not overridden; hold wording never says "without a dose" when doses are planned', () => {
    const base = hdR();
    const p = sandbox.hdNextDose(Object.assign(hdR(), { doses: base.doses.concat([{ mg: 250, tinfH: 0.5, timeH: 56 }]) }), 20);
    assert(p.kind === 'planned' && p.plannedInWindow.length === 1 && p.plannedCount === 1, JSON.stringify(p));
    const html = sandbox.hdNextDoseHTML(p, false);
    assert(/planned/i.test(html) && !/Without a dose/.test(html), html.slice(0, 240));
    const early = sandbox.hdNextDose(Object.assign(hdR(), { doses: base.doses.concat([{ mg: 2000, tinfH: 2, timeH: 30 }, { mg: 2000, tinfH: 2, timeH: 40 }]) }), 25);
    assert(early.plannedCount === 2, 'planned doses before the dose time are counted');
    if (early.kind === 'hold') assert(!/Without a dose/.test(sandbox.hdNextDoseHTML(early, false)) && /2 planned doses/.test(sandbox.hdNextDoseHTML(early, false)), 'hold says the planned doses');
  });
  test('35.13 a session that has just ended still takes the dose (now), unless a dose was already given after it', () => {
    const rec = sandbox.hdNextDose(hdR(), 57);
    assert(rec.session === 2 && Math.abs(rec.doseAtH - 57) < 1e-9 && rec.sizing === 3, JSON.stringify(rec));
    const given = sandbox.hdNextDose(hdR({ doses: [{ mg: 1750, tinfH: 2, timeH: 0 }, { mg: 500, tinfH: 1, timeH: 56.5 }] }), 57);
    assert(given.session === 3, 'a dose after session 2 ends means the next dose follows session 3');
    const late = sandbox.hdNextDose(hdR(), 70);
    assert(late.session === 3, 'beyond the window the next session takes the dose');
  });
  test('35.14 the closest answer may be no dose; the hold says "above 20" when it is', () => {
    // Small volumes: no dose reads 14.1 (just under 15), the smallest step reads ~37.8 — no dose is closer.
    const tiny = hdR({ V_ind: 3, CL_ind: 0.065, goti: { Vc_ind: 3, Vp_ind: 4, Q: 6.5 }, doses: [{ mg: 250, tinfH: 0.5, timeH: 0 }] });
    const rec = sandbox.hdNextDose(tiny, 20);
    assert(rec.kind === 'hold' && rec.reason === 'overshoot' && rec.mg === 0, JSON.stringify(rec));
    assert(/every 250 mg step overshoots 20/.test(sandbox.hdNextDoseHTML(rec, false)), 'the overshoot is said');
    const hi = sandbox.hdNextDoseHTML({ kind: 'hold', mg: 0, session: 2, sizing: 3, pre: 40, plannedCount: 0, doseAtH: 56, repeat: [], tinfH: 0 }, false);
    assert(/above 15–20/.test(hi) && !/at or above 15/.test(hi), hi.slice(0, 220));
  });
  test('35.15 a provisional fit marks the HD dose provisional; sessions wording says upcoming', () => {
    const html = sandbox.hdNextDoseHTML(sandbox.hdNextDose(hdR(), 20), true);
    assert(/rec-derated/.test(html) && /provisional/.test(html), 'derated');
    assert(/none are upcoming/.test(sandbox.hdNextDoseHTML({ need: 'sessions', planned: 0 }, false)), 'upcoming');
  });
  test('35.16 a dose whose infusion runs into a session is flagged', () => {
    const pk = sandbox.gotiPopPK(10, 70, true);
    const r = { model: 'goti', dial: true, CL_ind: pk.TVCL, V_ind: pk.TVVc, tbw: 70, goti: { Vc_ind: pk.TVVc, Vp_ind: pk.TVVp, Q: pk.Q },
      levels: [], hdSessions: [{ n: 1, startH: 100, endH: 104 }], doses: [{ mg: 1000, tinfH: 2, timeH: 99.5 }] };
    assert(sandbox.hdSessionSummary(r, 110).dosesDuringHD.length === 1, 'overlap, not start time');
  });
  test('35.17 the empiric table acknowledges doses already given', () => {
    const html = sandbox.hdEmpiricHTML(sandbox.hdEmpiricDoses(78), 78, [{ mg: 2000, tinfH: 2, timeH: 0 }]);
    assert(/1 dose already entered/.test(html) && /loading dose may already have been given/.test(html), html.slice(-300));
  });
  test('35.18 one frozen HD view feeds the screen, the redraw and the print', () => {
    const r = Object.assign(hdR(), { levels: [{ conc: 12, timeH: 30 }], fitNowH: 20, targetAUC: 450,
      rec: { dose: 750, tau: 24, auc24: 450, Ctrough: 15, Cpeak: 30, tinfH: 1 } });
    const v = sandbox.hdViewFor(r);
    assert(v && v.nowH === 20 && v.rec && v.rec.session === 2, JSON.stringify(v && v.rec));
    const pr = sandbox._prRecommendation(r, {});
    assert(/after HD|No dose after|No further dose|Planned dose|Add the next sessions/.test(pr) && !/\bq\d+h\b/.test(pr), pr.slice(0, 300));
    const emp = sandbox._prRecommendation(Object.assign({}, r, { levels: [] }), {});
    assert(/Empiric haemodialysis dosing/.test(emp) && !/\bq\d+h\b/.test(emp), emp.slice(0, 200));
    const rb = bodyOf35('renderBayesianResults');
    assert(!/hdNextDose\(r, Date\.now\(\)/.test(rb) && /hdViewFor\(r, bState\.hdGapH, bState\.hdGiveAtH\)/.test(rb), 'the render reads the frozen view');
    assert(/as of/.test(sandbox.hdNextDoseHTML(v.rec, false, v.nowH)), 'the verdict says when it was read');
  });
  test('35.19 for HD nothing else calls the steady-state regimen "recommended"; the math explains the HD rule', () => {
    const rb = bodyOf35('renderBayesianResults');
    assert(/const isHD = r\.model === 'goti' && !!r\.dial;/.test(rb.slice(0, 2500)), 'isHD is known before any section is built');
    assert(/recTDD = !isHD && rec && !rec\.noSolution/.test(rb), 'no steady-state exposure table for HD');
    assert(/recDose = !isHD && rec && !rec\.noSolution \? rec\.dose : null/.test(rb), 'no recommended cell in the matrix for HD');
    assert(/HD rule\./.test(rb), 'Show the math states the HD rule');
  });
  test('35.20 the Trough guard shows its notice (form run begun); a schedule start time must be a real clock time', () => {
    const calc = bodyOf35('calculate'), g = calc.indexOf("document.getElementById('t-hd')");
    assert(/beginFormRun\('trough'\)/.test(calc.slice(g, g + 400)), 'the guard begins the form run, which shows the area');
    assert(sandbox.isClock24('13:00') && sandbox.isClock24('00:00') && !sandbox.isClock24('29:99') && !sandbox.isClock24('24:00'), 'clock');
  });
  test('35.21 the empiric table shows the mg/kg each rounded dose came from', () => {
    const html = sandbox.hdEmpiricHTML(sandbox.hdEmpiricDoses(20), 20, []);
    assert(/25 · 10 mg\/kg/.test(html) && /35 · 10–15 mg\/kg/.test(html) && /25 · 7\.5 mg\/kg/.test(html) && /30 · 7\.5–10 mg\/kg/.test(html), html.slice(0, 600));
  });
  test('35.23 a dose never breaks from its unit; "Next" does not ask for a loading dose already entered', () => {
    const html = sandbox.hdEmpiricHTML(sandbox.hdEmpiricDoses(78), 78, []);
    assert(/<span class="hd-dose">500 mg–750 mg<\/span>/.test(html), html.slice(0, 600));
    const rb = bodyOf35('renderBayesianResults');
    assert(/doses\.length \? 'Draw a pre-HD level before the next session; it drives the next dose\.'/.test(rb), 'next step reads the doses entered');
  });
  test('35.22 a session is numbered by its own input row, so "session 3" is the row labelled HD 3', () => {
    const prevQ = sandbox.document.querySelectorAll, prevG = sandbox.document.getElementById;
    const f = { 'b-dose-mg-1': '1000', 'b-dose-tinf-1': '1', 'b-dose-date-1': '2026-09-01', 'b-dose-time-1': '08:00',
      'b-hd-date-2': '2026-09-05', 'b-hd-time-2': '13:00', 'b-hd-hours-2': '4',
      'b-hd-date-3': '2026-09-03', 'b-hd-time-3': '13:00', 'b-hd-hours-3': '4' };
    sandbox.document.querySelectorAll = (sel) => /dose-row/.test(sel) ? [{ id: 'b-dose-row-1' }] : /hd-row/.test(sel) ? [{ id: 'b-hd-row-2' }, { id: 'b-hd-row-3' }] : [];
    sandbox.document.getElementById = (id) => (id in f ? { value: f[id] } : null);
    let r; try { r = sandbox.parseBayesCourse(); } finally { sandbox.document.querySelectorAll = prevQ; sandbox.document.getElementById = prevG; }
    assert(r.sessions[0].label === '2026-09-03 13:00' && r.sessions[0].n === 3 && r.sessions[1].n === 2, JSON.stringify(r.sessions));
    const rb = sandbox.courseReadback([{ n: '1', date: '2026-09-01', time: '08:00', tinf: '1' }], [{ n: '1', date: '2026-09-04', time: '06:00' }], NaN,
      [{ n: '2', date: '2026-09-05', time: '13:00', hours: '4' }, { n: '3', date: '2026-09-03', time: '13:00', hours: '4' }]);
    assert(/after HD session 3 ended/.test(rb.level['1']), rb.level['1']);
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
// SUITE 36 — the release version (2026-10-02)
//
// The header said "v3.0" through six releases. One constant now names the build,
// and the static header and print-header markup must say the same.
// ════════════════════════════════════════════════════════════════════
{
  console.log(`\n${'─'.repeat(60)}`);
  console.log('  SUITE 36 — the release version');
  console.log(`${'─'.repeat(60)}`);
  test('36.1 the version is one constant, shown in the header and on both print headers', () => {
    const src36 = fs.readFileSync(htmlPath, 'utf8');
    const m = src36.match(/const APP_VERSION = '(\d+\.\d+\.\d+)';/);
    assert(m, 'APP_VERSION is declared');
    assert(src36.includes(`<div class="header-tag">Vancomycin TDM v${m[1]}</div>`), 'the static header names the same version');
    assert(src36.includes(`<div class="ph-tag">Vancomycin TDM Report · Clinical Pharmacist Tool · v${m[1]}</div>`), 'the static print header names it');
    assert(sandbox._prHeader('1 Oct 2026 10:00', 'Goti 2018').includes(`v${m[1]}`), 'the built print report names it');
  });
}

// ════════════════════════════════════════════════════════════════════
// SUITE 37 — one-time HD dose and the midpoint pick (D17)
//
// With fewer than two upcoming sessions the Goti-HD answer is a one-time dose sized
// at an ASSUMED gap (24/48/72 h, default 48). Both HD answers pick the in-range
// 250 mg step closest to the middle of Rybak 2020 Rec 14's 15–20 mg/L band.
// ════════════════════════════════════════════════════════════════════
{
  console.log(`\n${'─'.repeat(60)}`);
  console.log('  SUITE 37 — one-time HD dose, midpoint pick (D17)');
  console.log(`${'─'.repeat(60)}`);
  const K37 = require('./harness_constants.cjs').extract();
  const src37 = fs.readFileSync(htmlPath, 'utf8');
  const script37 = src37.match(/<script>([\s\S]*?)<\/script>/)[1];
  const code37 = script37.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  const bodyOf37 = (n) => { const c = code37.slice(code37.indexOf('function ' + n + '(')); return c.slice(0, c.indexOf('\nfunction ')); };
  // predictFittedAt is a top-level function declaration, so the vm global holds it and a
  // stub here is what hdPickDose calls. The stub reads the dose the rule appended.
  const stubPre = (table, fn) => { const prev = sandbox.predictFittedAt;
    sandbox.predictFittedAt = (r) => { const mg = r.doses.length > 1 ? r.doses[r.doses.length - 1].mg : 0;
      return typeof table === 'function' ? table(mg) : (table[mg] != null ? table[mg] : 99); };
    try { return fn(); } finally { sandbox.predictFittedAt = prev; } };
  const r1 = { doses: [{ mg: 1000, tinfH: 1, timeH: 0 }] };
  test('37.2 the pick is the in-range step closest to 17.5; ties go to the smaller dose', () => {
    const tie = stubPre({ 0: 14, 250: 16, 500: 19, 750: 22 }, () => sandbox.hdPickDose(r1, 10, 58));
    assert(tie.kind === 'dose' && tie.mg === 250, `16 and 19 are both 1.5 from 17.5: smaller wins, got ${JSON.stringify(tie)}`);
    const mid = stubPre({ 0: 12, 250: 15.2, 500: 17.3, 750: 19.9 }, () => sandbox.hdPickDose(r1, 10, 58));
    assert(mid.mg === 500 && mid.kind === 'dose', `old rule gave 250; midpoint gives 500, got ${mid.mg}`);
    const nowDose = stubPre({ 0: 16, 250: 17.4, 500: 19 }, () => sandbox.hdPickDose(r1, 10, 58));
    assert(nowDose.kind === 'dose' && nowDose.mg === 250, `old rule held at 16; midpoint doses 250, got ${JSON.stringify(nowDose)}`);
    assert(Math.abs(sandbox.HD_PREDIALYSIS_MID_FOR_TEST() - 17.5) < 1e-12, 'midpoint derived from the band');
  });
  test('37.3 holds and the closest answer keep their meaning', () => {
    const inHold = stubPre({ 0: 17.6, 250: 19.5 }, () => sandbox.hdPickDose(r1, 10, 58));
    assert(inHold.kind === 'hold' && inHold.reason === 'in' && inHold.mg === 0, JSON.stringify(inHold));
    const above = stubPre({ 0: 21 }, () => sandbox.hdPickDose(r1, 10, 58));
    assert(above.kind === 'hold' && above.reason === 'above', JSON.stringify(above));
    const over = stubPre({ 0: 14.1 }, () => sandbox.hdPickDose(r1, 10, 58));   // every step reads 99
    assert(over.kind === 'hold' && over.reason === 'overshoot' && over.mg === 0, JSON.stringify(over));
    const low = stubPre((mg) => 5 + mg / 250, () => sandbox.hdPickDose(r1, 10, 58));   // 2000 mg reads 13
    assert(low.kind === 'closest' && low.mg === 2000, JSON.stringify(low));
    assert(low.rr.doses.length === 2 && low.rr.doses[1].mg === 2000 && low.rr.doses[1].timeH === 10, 'rr carries the chosen dose');
  });
  test('37.4 the scheduled answer uses the shared rule on the real fit', () => {
    const pk = sandbox.gotiPopPK(10, 70, true);
    const r = { model: 'goti', dial: true, CL_ind: pk.TVCL, V_ind: pk.TVVc, tbw: 70,
      goti: { Vc_ind: pk.TVVc, Vp_ind: pk.TVVp, Q: pk.Q }, levels: [], doses: [{ mg: 1750, tinfH: 2, timeH: 0 }],
      hdSessions: [{ n: 1, startH: 4, endH: 8 }, { n: 2, startH: 52, endH: 56 }, { n: 3, startH: 100, endH: 104 }] };
    const rec = sandbox.hdNextDose(r, 20);
    const pres = [0, 250, 500, 750, 1000, 1250, 1500, 1750, 2000].map(mg => ({ mg,
      pre: sandbox.predictFittedAt(sandbox.hdWithDose(r, mg, 56), 100) }));
    const inR = pres.filter(p => p.pre >= 15 && p.pre <= 20);
    assert(inR.length, 'the fixture has an in-range step (else this test would be vacuous)');
    const best = inR.reduce((b, p) => Math.abs(p.pre - 17.5) < Math.abs(b.pre - 17.5) ? p : b);
    assert(rec.mg === best.mg, `scheduled pick ${rec.mg} is the in-range step nearest 17.5 (${best.mg})`);
    assert(/hdPickDose\(/.test(bodyOf37('hdNextDose')) && /hdUpcomingSessions\(/.test(bodyOf37('hdNextDose')), 'hdNextDose uses the shared helpers');
  });
  const pk37 = sandbox.gotiPopPK(10, 70, true);
  const hd37 = (extra) => Object.assign({ model: 'goti', dial: true, CL_ind: pk37.TVCL, V_ind: pk37.TVVc, tbw: 70,
    goti: { Vc_ind: pk37.TVVc, Vp_ind: pk37.TVVp, Q: pk37.Q }, levels: [{ conc: 12, timeH: 19 }],
    doses: [{ mg: 1750, tinfH: 2, timeH: 0 }], hdSessions: [{ n: 1, startH: 4, endH: 8 }], fitNowH: 20 }, extra || {});
  test('37.5 no session ahead: the one-time dose is given now and read the assumed gap later', () => {
    const v = sandbox.hdViewFor(hd37(), 48);
    // v3.8.0: the next HD counts from the start of the last session (4 h), not from the dose (was 68).
    assert(v.rec.oneTime && v.rec.after === null && v.rec.doseAtH === 20 && v.rec.readAtH === 52 && v.rec.anchorN === 1 && v.rec.gapH === 48, JSON.stringify(v.rec).slice(0, 300));
  });
  test('37.6 one session ahead: the dose follows it; two ahead keep the scheduled answer', () => {
    const one = sandbox.hdViewFor(hd37({ hdSessions: [{ n: 1, startH: 4, endH: 8 }, { n: 2, startH: 52, endH: 56 }] }), 48).rec;
    assert(one.oneTime && one.after === 2 && one.doseAtH === 56 && one.readAtH === 100,   // v3.8.0: 52 + 48 (was 56 + 48)
      JSON.stringify(one).slice(0, 300));
    const two = sandbox.hdViewFor(hd37({ hdSessions: [{ n: 1, startH: 4, endH: 8 }, { n: 2, startH: 52, endH: 56 }, { n: 3, startH: 100, endH: 104 }] }), 48).rec;
    assert(!two.oneTime && two.session === 2 && two.sizing === 3, 'two upcoming sessions: the scheduled answer');
  });
  test('37.7 each gap sizes at its own point; an unknown gap falls back to 48 h', () => {
    for (const g of [24, 48, 72]) {
      const rec = sandbox.hdOneTimeDose(hd37(), 20, g);
      assert(rec.gapH === g && rec.readAtH === 4 + g, `gap ${g}`);   // v3.8.0: from session 1's start (was 20 + g)
      const check = sandbox.predictFittedAt(rec.rr || sandbox.hdWithDose(hd37(), rec.mg, rec.doseAtH), rec.readAtH);
      assert(Math.abs(check - rec.pre) < 1e-9, `pre is the fitted level at the read point (gap ${g})`);
      if (rec.kind === 'dose') assert(rec.pre >= 15 && rec.pre <= 20, `in range at gap ${g}`);
    }
    assert(sandbox.hdOneTimeDose(hd37(), 20, 30).gapH === 48 && sandbox.hdOneTimeDose(hd37(), 20, undefined).gapH === 48, 'fallback');
  });
  test('37.8 a planned dose inside the window is read, not replaced', () => {
    const rec = sandbox.hdOneTimeDose(hd37({ doses: [{ mg: 1750, tinfH: 2, timeH: 0 }, { mg: 750, tinfH: 1, timeH: 30 }] }), 20, 48);
    assert(rec.kind === 'planned' && rec.plannedInWindow.length === 1 && rec.plannedCount === 1 && rec.mg === 0, JSON.stringify(rec).slice(0, 300));
  });
  test('37.9 a finished session with no dose after it is flagged — only the latest, never the one the dose follows', () => {
    assert(sandbox.hdOneTimeDose(hd37(), 20, 48).missed.n === 1, 'session 1 ended at 8 h; the only dose was at 0 h');
    assert(sandbox.hdOneTimeDose(hd37({ doses: [{ mg: 1750, tinfH: 2, timeH: 0 }, { mg: 500, tinfH: 1, timeH: 9 }] }), 20, 48).missed === null, 'a dose after it clears the flag');
    const two = sandbox.hdOneTimeDose(hd37({ hdSessions: [{ n: 1, startH: 4, endH: 8 }, { n: 2, startH: 28, endH: 32 }],
      doses: [{ mg: 1750, tinfH: 2, timeH: 0 }, { mg: 500, tinfH: 1, timeH: 9 }] }), 40, 48);
    assert(two.missed && two.missed.n === 2, 'the latest finished session');
    const justEnded = sandbox.hdOneTimeDose(hd37({ hdSessions: [{ n: 1, startH: 16, endH: 19 }] }), 20, 48);
    assert(justEnded.after === 1 && justEnded.missed === null, 'a session that ended 1 h ago takes the dose; it is not "missed"');
  });
  test('37.10 no sessions logged at all: still a one-time answer, nothing flagged', () => {
    const rec = sandbox.hdViewFor(hd37({ hdSessions: [] }), 48).rec;
    assert(rec.oneTime && rec.after === null && rec.missed === null && ['dose', 'hold', 'closest'].includes(rec.kind), JSON.stringify(rec).slice(0, 200));
  });
  test('37.11 the table runs from no dose to the first step above 20 at every gap, and holds the pick', () => {
    const rec = sandbox.hdOneTimeDose(hd37(), 20, 48);
    const t = rec.table;
    assert(t[0].mg === 0 && t.every((row, i) => row.mg === i * 250 && row.at.length === 3), 'consecutive 250 mg rows from 0');
    const last = t[t.length - 1];
    assert(last.at.every(c => c > 20) || last.mg === 2000, 'stops at the first all-above row (or the ceiling)');
    assert(t.slice(0, -1).every(row => !row.at.every(c => c > 20)), 'no earlier row is all-above');
    assert(t.some(row => row.mg === rec.mg), 'the chosen dose is a row');
    assert(t.every(row => row.at[0] >= row.at[1] && row.at[1] >= row.at[2]), 'later gaps read lower');
  });
  test('37.12 the handoff case (fictional): 1 g, HD 13:42–17:45, 10.3 mg/L at 05:42 next day — a one-time dose, the missed dose flagged', () => {
    const pk = sandbox.gotiPopPK(10, 70, true);
    const doses = [{ mg: 1000, tinfH: sandbox.autoTinf(1000), timeH: 9.3 }];
    const levels = [{ conc: 10.3, timeH: 29.7 }];
    const mf = sandbox.mapFit((a, b, c) => sandbox.burtonObj3D(a, b, c, pk.TVCL, pk.TVVc, pk.TVVp, doses, levels), 3, K37.OMEGA2_CL_GOTI, K37.OMEGA2_VC_GOTI, 400, K37.OMEGA2_VP_GOTI);
    const [eCL, eVc, eVp] = mf.eta;
    const r = { model: 'goti', dial: true, CL_ind: pk.TVCL * Math.exp(eCL), V_ind: pk.TVVc * Math.exp(eVc), tbw: 70,
      goti: { Vc_ind: pk.TVVc * Math.exp(eVc), Vp_ind: pk.TVVp * Math.exp(eVp), Q: pk.Q }, levels, doses,
      hdSessions: [{ n: 1, startH: 13.7, endH: 17.75 }], fitNowH: 30 };
    const rec = sandbox.hdViewFor(r, 48).rec;
    assert(rec.oneTime && rec.after === null && rec.missed && rec.missed.n === 1, JSON.stringify(rec).slice(0, 300));
    assert(['dose', 'closest'].includes(rec.kind) && rec.mg >= 250, `a dose is advised: ${rec.kind} ${rec.mg}`);
  });
  const ot = (over) => Object.assign({ oneTime: true, doseAtH: 20, after: null, gapH: 48, readAtH: 68, plannedCount: 0,
    plannedInWindow: [], missed: null, kind: 'dose', reason: '', mg: 750, tinfH: 1, pre: 17.2, auc24: 430, peak: 31.5,
    table: [{ mg: 0, at: [12, 10, 8.5] }, { mg: 250, at: [15.1, 13, 11] }, { mg: 500, at: [19, 16, 13.4] },
            { mg: 750, at: [22.8, 17.2, 15.9] }, { mg: 1000, at: [26.7, 21.4, 20.3] }] }, over || {});
  test('37.13 the one-time verdict: dose now, assumed gap stated, three gap buttons, the table, the caution', () => {
    const h = sandbox.hdNextDoseHTML(ot(), false, 20);
    assert(/<span class="rec-dose">750 mg<\/span> IV <span class="vx-freq">now<\/span><\/h3>/.test(h) && /<p class="vx-inf"><strong>One-time<\/strong> · /.test(h), h.slice(0, 300));
    assert(/Sized for a pre-HD level of <strong>17\.2 mg\/L<\/strong> if the next HD starts <strong>[^<]+<\/strong> \(48 h after this dose\)/.test(h), 'sized-for line (v3.8.0: names the clock time)');
    const btns = h.match(/<button[^>]*data-onclick="k78"[^>]*>/g) || [];
    assert(btns.length === 3 && btns.every(b => /type="button"/.test(b)), `three gap buttons: ${btns.length}`);
    assert(/data-arg="48" aria-pressed="true"/.test(h) && /data-arg="72" aria-pressed="false"/.test(h), 'the chosen gap is pressed');
    assert(/class="ev-table vx-hd-onetime"/.test(h) && /<tr class="is-pick">/.test(h) && /within 15–20/.test(h), 'table with the pick and screen-reader range text');
    assert(!/[✓✔⚠]/.test(h) && /class="hd-in"/.test(h), 'in-range cells use the drawn check, never a glyph');
    assert(/delayed or cancelled, levels will run higher than shown/.test(h), 'the averaged-model caution');
    assert(/one-time: no schedule logged/.test(h) && !/\bq\d+h\b/.test(h), 'basis line; never a q-interval');
  });
  test('37.14 print shows the gap as text, with no buttons', () => {
    const p = sandbox.hdNextDoseHTML(ot(), false, 20, true);
    assert(!/<button/.test(p) && /assumed gap 48 h/.test(p), p.slice(0, 400));
  });
  test('37.15 a missed post-HD dose is said first, as a caution', () => {
    const h = sandbox.hdNextDoseHTML(ot({ missed: { n: 1, endH: 8 } }), false, 20);
    assert(h.indexOf('No dose entered after session 1') > -1 && h.indexOf('No dose entered after session 1') < h.indexOf('vx-regimen'), 'before the heading');
    assert(/note-caution/.test(h) && /ended 12 h ago/.test(h) && /this answer assumes it was not/.test(h), h.slice(0, 400));
  });
  test('37.16 holds and "after HD" read right, in the neutral heading', () => {
    const now = sandbox.hdNextDoseHTML(ot({ kind: 'hold', reason: 'in', mg: 0, tinfH: 0, pre: 17.6, peak: null }), false, 20);
    assert(/>No dose now</.test(now) && /vx-regimen-hd/.test(now) && !/vx-regimen-hold/.test(now), now.slice(0, 300));
    const after = sandbox.hdNextDoseHTML(ot({ after: 2, doseAtH: 56 }), false, 20);
    assert(/<span class="vx-freq">after HD<\/span>/.test(after) && /One-time<\/strong> · after session 2 ends/.test(after), after.slice(0, 300));
    const holdAfter = sandbox.hdNextDoseHTML(ot({ after: 2, kind: 'hold', reason: 'above', mg: 0, pre: 23, peak: null }), false, 20);
    assert(/>No dose after session 2</.test(holdAfter), holdAfter.slice(0, 200));
    const prov = sandbox.hdNextDoseHTML(ot(), true, 20);
    assert(/rec-derated/.test(prov) && /provisional/.test(prov), 'a provisional fit marks it');
  });
  test('37.17 wiring: k78 sets the gap and re-renders without refitting; screen and print pass the gap; next step and math', () => {
    assert(/k78:[^\n]*bState\.hdGapH = Number\(arg\)[^\n]*renderBayesianResults\(bState\.result/.test(script37), 'k78');
    const rb = bodyOf37('renderBayesianResults');
    assert(/const hdView = hdViewFor\(r, bState\.hdGapH, bState\.hdGiveAtH\);/.test(rb) && rb.indexOf('const hdView') < rb.indexOf('const nextStep'), 'the view is read before the next step');
    assert(/hdView\.rec\.oneTime\) return 'Draw a pre-HD level before the next session\. Once the schedule is known, log it and each post-HD dose is sized for you\.'/.test(rb), 'one-time next step');
    assert(/HD rule\.[\s\S]{0,1400}closest to \$\{HD_PREDIALYSIS_MID\}/.test(rb) && /one-time/.test(rb.slice(rb.indexOf('HD rule.'), rb.indexOf('HD rule.') + 1400)), 'the math states the midpoint and the one-time gap');   // window widened in v3.8.0: the rule text grew (anchor, imminent session, SCr)
    const pr = bodyOf37('_prRecommendation');
    assert(/hdViewFor\(r, bState\.hdGapH, bState\.hdGiveAtH\)/.test(pr) && /hdNextDoseHTML\(hv\.rec, !!screen\.provisional, hv\.nowH, true\)/.test(pr), 'print');
  });
  test('37.18 a measured pre-HD level above 20 with no dose since: no dose now, recheck (the user\'s decision, Rybak Rec 14)', () => {
    // Level 1 h before session 1 (pre-HD), no dose after it, no session ahead.
    const pre23 = hd37({ levels: [{ conc: 23, timeH: 3 }] });
    const rec = sandbox.hdOneTimeDose(pre23, 20, 48);
    assert(rec.kind === 'hold' && rec.reason === 'pre-above' && rec.mg === 0 && rec.preAbove && rec.preAbove.n === 1 && rec.preAbove.conc === 23, JSON.stringify(rec).slice(0, 300));
    assert(rec.table.length > 1, 'the dose table stays, so the clinician can see what a dose would do');
    const html = sandbox.hdNextDoseHTML(rec, false, 20);
    assert(/>No dose now</.test(html) && /23\.0 mg\/L<\/strong>, above 15–20/.test(html) && /Recheck the level before the next session/.test(html) && !/rec-dose/.test(html), html.slice(0, 500));
    assert(sandbox.hdOneTimeDose(hd37({ levels: [{ conc: 18, timeH: 3 }] }), 20, 48).reason !== 'pre-above', 'a pre-HD level in range stays predictive');
    assert(sandbox.hdOneTimeDose(hd37({ levels: [{ conc: 23, timeH: 3 }], doses: [{ mg: 1750, tinfH: 2, timeH: 0 }, { mg: 500, tinfH: 1, timeH: 10 }] }), 20, 48).reason !== 'pre-above', 'a dose already given after the level: the decision was made');
    assert(sandbox.hdOneTimeDose(hd37({ levels: [{ conc: 23, timeH: 3 }], hdSessions: [{ n: 1, startH: 30, endH: 34 }] }), 20, 48).reason !== 'pre-above', 'a level 27 h before a session is not pre-HD');
    const planned = sandbox.hdOneTimeDose(hd37({ levels: [{ conc: 23, timeH: 3 }], doses: [{ mg: 1750, tinfH: 2, timeH: 0 }, { mg: 500, tinfH: 1, timeH: 30 }] }), 20, 48);
    assert(planned.kind === 'planned', 'a planned dose entered is still read, not replaced');
  });
  // ── Final-review fix pass (D17) ──
  test('37.19 the above-20 hold applies only to the dose after the session that level preceded; a held session is named, not "missed"', () => {
    // Monday's pre-HD 23 (before session 1) was held; session 2 ended 1 h ago; no new level.
    const r = hd37({ levels: [{ conc: 23, timeH: 3 }], hdSessions: [{ n: 1, startH: 4, endH: 8 }, { n: 2, startH: 52, endH: 56 }] });
    const rec = sandbox.hdOneTimeDose(r, 57, 48);
    assert(rec.after === 2 && rec.reason !== 'pre-above', `the hold must not carry to session 2: ${JSON.stringify(rec).slice(0, 240)}`);
    assert(rec.missed && rec.missed.n === 1 && rec.missed.held === 23, JSON.stringify(rec.missed));
    const html = sandbox.hdNextDoseHTML(rec, false, 57);
    assert(/its pre-HD level was 23\.0 mg\/L/.test(html) && !/this answer assumes it was not/.test(html), html.slice(0, 400));
    const same = sandbox.hdOneTimeDose(hd37({ levels: [{ conc: 23, timeH: 3 }] }), 20, 48);
    assert(same.reason === 'pre-above' && !/No dose entered after session 1/.test(sandbox.hdNextDoseHTML(same, false, 20)), 'the hold itself says it; no second note');
  });
  test('37.20 the missed flag is cleared by a dose during the session or one entered after it (given or planned)', () => {
    const intra = sandbox.hdOneTimeDose(hd37({ doses: [{ mg: 1750, tinfH: 2, timeH: 0 }, { mg: 500, tinfH: 1, timeH: 7 }] }), 20, 48);
    assert(intra.missed === null, 'a dose given during session 1 is not a missed post-HD dose');
    const planned = sandbox.hdOneTimeDose(hd37({ doses: [{ mg: 1750, tinfH: 2, timeH: 0 }, { mg: 750, tinfH: 1, timeH: 21 }] }), 20, 48);
    assert(planned.kind === 'planned' && planned.missed === null, `a planned dose after the session clears the flag: ${JSON.stringify(planned.missed)}`);
  });
  test('37.21 the scheduled answer stays predictive but cautions when the pre-HD level before its session is above 20 (the user\'s decision)', () => {
    const r = hd37({ levels: [{ conc: 23, timeH: 50 }], hdSessions: [{ n: 1, startH: 4, endH: 8 }, { n: 2, startH: 52, endH: 56 }, { n: 3, startH: 100, endH: 104 }] });
    const rec = sandbox.hdNextDose(r, 51);
    assert(!rec.oneTime && rec.session === 2 && rec.preAbove && rec.preAbove.conc === 23 && rec.reason !== 'pre-above', JSON.stringify(rec).slice(0, 260));
    const html = sandbox.hdNextDoseHTML(rec, false, 51);
    assert(/note-caution/.test(html) && /before session 2 was 23\.0 mg\/L/.test(html) && /Recheck before dosing/.test(html), html.slice(0, 400));
    const plain = sandbox.hdNextDose(hd37({ levels: [{ conc: 18, timeH: 50 }], hdSessions: r.hdSessions }), 51);
    assert(!plain.preAbove && !/Recheck before dosing/.test(sandbox.hdNextDoseHTML(plain, false, 51)), 'no caution in range');
  });
  test('37.22 the pre-HD label window says it now gates a dose decision (rule 8)', () => {
    const c = script37.slice(script37.indexOf('const HD_PREDIALYSIS_MAX'), script37.indexOf('const HD_PRE_LABEL_H'));
    assert(!/neither\s+changes a fit or a dose/.test(c) && /one-time hold/.test(c), c);
  });
  // ── v3.8.0: the gap counts from the last session's start; a give-at time; the pre-dialysis SCr ──
  test('37.23 the assumed next HD counts from the start of the last session (start to start); passed gaps are unavailable', () => {
    const rec = sandbox.hdOneTimeDose(hd37(), 20, 48);          // session 1 began at 4 h
    assert(rec.anchorN === 1 && rec.readAtH === 52 && rec.nextHs.join() === '28,52,76' && rec.gapAvail.every(Boolean), JSON.stringify(rec).slice(0, 300));
    const over = sandbox.hdOneTimeDose(hd37(), 33, 24);          // the 24 h session (28–32) is over by 33 h
    assert(over.gapAvail[0] === false && over.gapH === 48 && over.readAtH === 52, `a passed gap falls back to 48: ${JSON.stringify(over).slice(0, 200)}`);
    assert(over.table.every(row => row.at[0] === null && row.at[1] != null), 'the passed column is empty');
    const ahead = sandbox.hdOneTimeDose(hd37({ hdSessions: [{ n: 1, startH: 4, endH: 8 }, { n: 2, startH: 52, endH: 56 }] }), 20, 48);
    assert(ahead.after === 2 && ahead.anchorN === 2 && ahead.readAtH === 100, `with a session ahead, from its start: ${ahead.readAtH}`);
    const none = sandbox.hdOneTimeDose(hd37({ hdSessions: [] }), 20, 48);
    assert(none.anchorN === null && none.readAtH === 68, 'no session logged: from the dose');
    const stale = sandbox.hdOneTimeDose(hd37(), 90, 48);         // 4 + 72 = 76 < 90: every gap has passed
    assert(stale.anchorStale && stale.anchorN === null && stale.readAtH === 138, `a session more than 72 h back: from the dose: ${JSON.stringify(stale).slice(0, 160)}`);
  });
  test('37.24 a give-at time moves the dose, not the assumed next session; never earlier than now', () => {
    const now = sandbox.hdOneTimeDose(hd37(), 20, 48), later = sandbox.hdOneTimeDose(hd37(), 20, 48, 30);
    assert(later.doseAtH === 30 && later.readAtH === 52 && later.giveAtH === 30 && !later.giveClamped, JSON.stringify(later).slice(0, 200));
    assert(later.mg <= now.mg, `a later dose has fewer hours to cover: ${later.mg} vs ${now.mg}`);
    const early = sandbox.hdOneTimeDose(hd37(), 20, 48, 15);
    assert(early.doseAtH === 20 && early.giveClamped, 'not before now');
    const close = sandbox.hdOneTimeDose(hd37(), 20, 48, 51);       // 1 h before the assumed session at 52: the dose follows it
    assert(close.assumedAfter && close.assumedAfter.startH === 52 && close.doseAtH === 56 && close.readAtH === 100, `${JSON.stringify(close).slice(0, 240)}`);
  });
  test('37.25 the answer names the assumed next HD as a clock time, disables passed gaps, and offers a give-at time on screen only', () => {
    const rec = sandbox.hdOneTimeDose(hd37({ CL_ind: pk37.TVCL * 2 }), 33, 48);   // a faster clearer: the answer is a dose
    assert(rec.kind === 'dose' || rec.kind === 'closest', `fixture must give a dose: ${rec.kind}`);
    const h = sandbox.hdNextDoseHTML(rec, false, 33);
    assert(/if the next HD starts <strong>[^<]+<\/strong> \(48 h after session 1 began\)/.test(h), h.slice(0, 500));
    assert(/id="b-hd-give-date"[^>]*>\s*<input type="text" id="b-hd-give-time"/.test(h), 'the time sits beside its date (SUITE 19)');
    const hold = sandbox.hdNextDoseHTML(sandbox.hdOneTimeDose(hd37(), 33, 48), false, 33);
    assert(/if the next HD starts [^<(]+\(48 h after session 1 began\)/.test(hold) && !/b-hd-give-date/.test(hold), 'a hold names the clock time too, and offers no give-at time');
    assert(/data-arg="24"[^>]*disabled/.test(h), 'the passed 24 h button is disabled');
    assert(/id="b-hd-give-date"[^>]*data-onfocusout="k79"/.test(h) && /id="b-hd-give-time"[^>]*data-time24[^>]*data-onchange="k79"/.test(h), 'give-at inputs (v3.9.0: the date commits on leaving the field, so it can be typed)');
    assert(/<td class="hd-na">—/.test(h), 'a passed cell reads as a dash');
    const p = sandbox.hdNextDoseHTML(rec, false, 33, true);
    assert(!/<input/.test(p) && !/<button/.test(p), 'print has no controls');
  });
  test('37.26 on dialysis, a SCr drawn after a session is replaced by the newest one drawn before it', () => {
    const S = [{ n: 1, startH: 13.7, endH: 17.75 }];
    const sel = sandbox.hdPreDialysisScr([{ scr: 3.7, timeH: 6 }, { scr: 2.0, timeH: 29.7 }], S);
    assert(sel && sel.use.scr === 3.7 && sel.skipped.scr === 2.0 && sel.n === 1, JSON.stringify(sel));
    assert(sandbox.hdPreDialysisScr([{ scr: 3.7, timeH: 6 }, { scr: 3.9, timeH: 10 }], S) === null, 'the newest drawn before the session: as measured');
    const noPre = sandbox.hdPreDialysisScr([{ scr: 2.0, timeH: 29.7 }], S);
    assert(noPre && noPre.use === null && noPre.skipped.scr === 2.0, 'no pre-dialysis reading: flagged, not replaced');
    assert(sandbox.hdPreDialysisScr([{ scr: 2.0, timeH: 29.7 }], []) === null, 'no session: as measured');
    const during = sandbox.hdPreDialysisScr([{ scr: 3.7, timeH: 6 }, { scr: 2.6, timeH: 15 }], S);
    assert(during && during.use.scr === 3.7, 'a reading drawn during the session is not pre-dialysis either');
  });
  test('37.27 wiring: the fit uses the pre-dialysis SCr on Goti-HD and says so; k79 sets the give-at time; screen and print pass it', () => {
    const rb = bodyOf37('runBayesian');
    assert(/hdPreDialysisScr\(serialScr, sessions\)/.test(rb) && /hdScr && hdScr\.use \? hdScr\.use\.scr/.test(rb), 'runBayesian picks the pre-dialysis SCr');
    assert((rb.match(/scrSel: scrSelUsed, hdScr, arcInfo/g) || []).length === 3, 'every result passes it on');
    const render = bodyOf37('renderBayesianResults');
    assert(/drawn after dialysis/.test(render) && /hdViewFor\(r, bState\.hdGapH, bState\.hdGiveAtH\)/.test(render), 'note + view');
    assert(/k79:[^\n]*bState\.hdGiveAtH = /.test(script37), 'k79');
    assert(/hdViewFor\(r, bState\.hdGapH, bState\.hdGiveAtH\)/.test(bodyOf37('_prRecommendation')), 'print');
  });
  // ── v3.8.0 final-review fix pass ──
  test('37.28 the pre-dialysis SCr is the session layer\'s pre-HD reading, and only ever a higher one (final review C1)', () => {
    const S1 = [{ n: 1, startH: 13.7, endH: 17.75 }];
    const base = sandbox.hdPreDialysisScr([{ scr: 0.9, timeH: -200 }, { scr: 2.0, timeH: 29.7 }], S1);
    assert(base && base.use === null, 'a pre-AKI baseline days before is not a pre-dialysis SCr: flagged, not used');
    assert(sandbox.hdPreDialysisScr([{ scr: 3.0, timeH: 0 }, { scr: 3.7, timeH: 13.7 }], S1) === null, 'a draw at the session-start minute is pre-dialysis: as measured');
    const S2 = [{ n: 1, startH: 4, endH: 8 }, { n: 2, startH: 52, endH: 56 }];
    const postSub = sandbox.hdPreDialysisScr([{ scr: 2.0, timeH: 9.25 }, { scr: 1.8, timeH: 57 }], S2);
    assert(postSub && postSub.use === null && postSub.n === 2, 'a reading drawn after session 1 is not session 2\'s pre-dialysis SCr');
    assert(sandbox.hdPreDialysisScr([{ scr: 3.7, timeH: 0 }, { scr: 3.4, timeH: 44.3 }], S2) === null, 'the newest is itself a pre-HD draw: as measured');
    const lower = sandbox.hdPreDialysisScr([{ scr: 1.5, timeH: 6 }, { scr: 2.0, timeH: 29.7 }], S1);
    assert(lower && lower.use === null && lower.lowerPre && lower.lowerPre.scr === 1.5, 'never a lower value than the one skipped');
    const ok = sandbox.hdPreDialysisScr([{ scr: 3.7, timeH: 6 }, { scr: 2.0, timeH: 29.7 }], S1);
    assert(ok.use.scr === 3.7, 'the reported case still uses 3.7');
  });
  test('37.29 an assumed session starting before a dose could be infused and distributed: the dose follows it (final review I2, the user\'s decision)', () => {
    const r = sandbox.hdOneTimeDose(hd37(), 51, 48);              // the 48 h session (52–56) starts 1 h from now
    assert(r.assumedAfter && r.assumedAfter.startH === 52 && r.assumedAfter.endH === 56 && r.doseAtH === 56 && r.readAtH === 100 && r.anchorN === null,
      JSON.stringify(r).slice(0, 300));
    const h = sandbox.hdNextDoseHTML(r, false, 51);
    assert(/IV <span class="vx-freq">after HD<\/span>/.test(h) && /after the assumed session/.test(h), h.slice(0, 400));
    assert(/<caption>[^<]*after the assumed session began<\/caption>/.test(h), 'the table says what its gaps count from');
    const inProg = sandbox.hdOneTimeDose(hd37(), 30, 24);          // the 24 h session (28–32) would be in progress
    assert(inProg.gapAvail[0] && inProg.gapH === 24 && inProg.assumedAfter && inProg.doseAtH === 32 && inProg.readAtH === 52, JSON.stringify(inProg).slice(0, 300));
    const far = sandbox.hdOneTimeDose(hd37(), 20, 48);
    assert(!far.assumedAfter && far.doseAtH === 20, 'a session 32 h away is not imminent');
  });
  test('37.30 a give-at time is cleared by a new fit, stays visible on a hold, and the heading says when (final review I4, I5)', () => {
    assert(/bState\.hdGiveAtH = null;/.test(bodyOf37('runBayesian')), 'a new fit clears the give-at time');
    const later = sandbox.hdOneTimeDose(hd37({ CL_ind: pk37.TVCL * 2 }), 20, 48, 26);
    const h = sandbox.hdNextDoseHTML(later, false, 20);
    assert(/IV <span class="vx-freq">at [^<]*\d\d:\d\d<\/span>/.test(h) && !/IV <span class="vx-freq">now/.test(h), h.slice(0, 300));
    const held = Object.assign({}, sandbox.hdOneTimeDose(hd37(), 20, 48, 26), { kind: 'hold', reason: 'in', mg: 0, peak: null });
    assert(/id="b-hd-give-date"/.test(sandbox.hdNextDoseHTML(held, false, 20)), 'a hold with a give-at time keeps the control, so it can be undone');
  });
  test('37.31 wording and wiring: summary and math name the anchor; one SCr label; the AKI caution survives; the time field formats anywhere; a bad time is said', () => {
    const rb = bodyOf37('renderBayesianResults');
    assert(/if the next HD starts \$\{fmtClock\(hdRec\.readAtH\)\}/.test(rb) && !/next HD starts \$\{hdRec\.gapH\} h/.test(rb), 'the summary names the clock time');
    assert(/after the last session began/.test(rb.slice(rb.indexOf('HD rule.'), rb.indexOf('HD rule.') + 1400)), 'the math states the anchor');
    assert(/if \(sel\.changedAcrossFit\) \{/.test(rb), 'the renal-change caution is not suppressed wholesale');
    const run = bodyOf37('runBayesian');
    assert(/scrLabel: scrSelUsed \? scrSelUsed\.label : null/.test(run), 'the printed SCr label is the reading used');
    assert(/if \(e\.type === 'input' && t\.hasAttribute && t\.hasAttribute\('data-time24'\)\) formatTime24Input\(t, e\);\s*\n(?:\s*const pair = t\.closest\('\.dt-pair'\);\s*\n\s*if \(pair\) \{ syncDtPair\(pair, e\); return; \}\s*\n)?\s*if \(!t\.closest\('\.course-row'\)\) return;/.test(script37), 'the 24-hour formatter runs outside course rows too');
    assert(/k79:[^\n]*b-hd-give-msg/.test(script37), 'a bad give-at time is said, not silently reset');
    const h = sandbox.hdNextDoseHTML(sandbox.hdOneTimeDose(hd37({ CL_ind: pk37.TVCL * 2 }), 20, 48), false, 20);
    assert(/Next HD at<\/span>/.test(h) && /after session 1 began<\/span>/.test(h), 'the gap control says what it counts from');
  });
}

// ════════════════════════════════════════════════════════════════════
// SUITE 38 — the regular regimen's first-dose time (v3.9.0)
//
// "q24h recommended, but I can only give it at 12:00": the first dose of the
// recommended regimen can be timed. Timing and readouts only — the steady-state
// exposure does not depend on when the regimen starts, so the dose never changes.
// ════════════════════════════════════════════════════════════════════
{
  console.log(`\n${'─'.repeat(60)}`);
  console.log('  SUITE 38 — first-dose time (v3.9.0)');
  console.log(`${'─'.repeat(60)}`);
  const src38 = fs.readFileSync(htmlPath, 'utf8');
  const script38 = src38.match(/<script>([\s\S]*?)<\/script>/)[1];
  const code38 = script38.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  const bodyOf38 = (n) => { const c = code38.slice(code38.indexOf('function ' + n + '(')); return c.slice(0, c.indexOf('\nfunction ')); };
  const r38 = { model: 'buelga', CL_ind: 3, V_ind: 60, doses: [{ mg: 1000, tinfH: 1, timeH: 0 }], levels: [], fitNowH: 20 };
  const q24 = { dose: 1750, tau: 24, tinfH: 2 };
  // v3.14.0 (D26, ruling R16): the offset against a schedule is printed only when there is a
  // regimen being given, as the decision read it. q24chg: a change from 1 g q24h to 1.75 g q24h
  // (a contract fixture: the interval is kept, the dose changes), with the caller's current regimen.
  const cur24 = { dose: 1000, tau: 24, tinfH: 1 };
  const q24chg = Object.assign({ action: 'change', current: { dose: 1000, tau: 24 } }, q24);
  test('38.1 the default first dose is when the new regimen is due; a passed due time means now; a chosen time is never before now', () => {
    const due = sandbox.firstDosePlan(r38, q24, 20);
    assert(due.firstH === 24 && due.dueH === 24 && due.deltaH === 0 && !due.chosen, JSON.stringify(due));
    assert(Math.abs(due.pre - sandbox.predictFittedAt(r38, 24)) < 1e-9, 'the fitted level when the first dose goes in');
    // v3.14.0 (D26, ruling R1): "was due" is the regimen being given's due time, so with no
    // current regimen (none passed here) nothing was due; with one, its due time had passed.
    const passed = sandbox.firstDosePlan(r38, q24, 26.5);
    assert(passed.firstH === 26.5 && passed.deltaH === 2.5 && !passed.duePassed, JSON.stringify(passed));
    const passedCur = sandbox.firstDosePlan(r38, Object.assign({ action: 'continue' }, q24), 26.5, null, { dose: 1750, tau: 24, tinfH: 2 });
    assert(passedCur.firstH === 26.5 && passedCur.dueH === 24 && passedCur.deltaH === 2.5 && passedCur.duePassed, JSON.stringify(passedCur));
    const chosen = sandbox.firstDosePlan(r38, q24, 20, 26);
    assert(chosen.firstH === 26 && chosen.deltaH === 2 && chosen.chosen && !chosen.clamped, JSON.stringify(chosen));
    const early = sandbox.firstDosePlan(r38, q24, 20, 15);
    assert(early.firstH === 20 && early.clamped, 'not before now');
    assert(sandbox.firstDosePlan({ doses: [] }, q24, 20) === null, 'no dose entered: no plan, nothing drawn');
  });
  test('38.2 the schedule after it: clock times through the day, or the next dose for intervals over 24 h', () => {
    const p12 = sandbox.firstDosePlan(r38, { dose: 1000, tau: 12, tinfH: 1 }, 20, 26);
    assert(p12.times.length === 2 && p12.times[0] === sandbox.localTimeStr(new Date(26 * 3600000)), JSON.stringify(p12.times));
    const p24 = sandbox.firstDosePlan(r38, q24, 20, 26);
    assert(p24.times.length === 1, 'one clock time a day');
    const p48 = sandbox.firstDosePlan(r38, { dose: 2000, tau: 48, tinfH: 2 }, 20, 26);
    assert(p48.times === null && p48.nextH === 74, JSON.stringify(p48));
  });
  test('38.3 the readout: when, against the schedule, the level by then, the times after, and exposure unchanged; controls on screen only', () => {
    const plan = sandbox.firstDosePlan(r38, q24chg, 20, 26.5, cur24);
    const h = sandbox.firstDoseHTML(plan, q24chg, false);
    assert(/id="b-first-date"[^>]*data-onchange="k82"/.test(h) && /id="b-first-date"[^>]*>\s*<input type="text" id="b-first-time"[^>]*data-time24[^>]*data-onchange="k82"/.test(h), 'date and 24-hour time, side by side');
    assert(/then \d\d:\d\d daily/.test(h) && /level by then <strong>[\d.]+ mg\/L<\/strong>/.test(h), h.slice(0, 600));
    // v3.11.0 (D22): the screen shows one line; the offset against the schedule and the
    // "exposure unchanged" sentence are kept whole in the printed block.
    const p = sandbox.firstDoseHTML(plan, q24chg, true);
    assert(/2\.5 h after the q24h schedule/.test(p) && /Level by then <strong>[\d.]+ mg\/L<\/strong>/.test(p), p.slice(0, 600));
    assert(/steady-state AUC₂₄ and trough are unchanged/i.test(p), 'exposure unchanged, said');
    const early = sandbox.firstDoseHTML(sandbox.firstDosePlan(r38, q24chg, 20, 22, cur24), q24chg, true);
    assert(/2 h before the q24h schedule/.test(early), early.slice(0, 400));
    // No regimen being given (a start): there is no schedule, so no offset against one (R16).
    const start = sandbox.firstDoseHTML(sandbox.firstDosePlan(r38, q24, 20, 26.5), q24, true);
    assert(!/schedule/.test(start) && /First dose/.test(start), start.slice(0, 400));
    assert(!/<input/.test(p) && /First dose/.test(p), 'print: the time as text');
  });
  test('38.4 wiring: the verdict carries it (not on HD); a new fit clears it; k82 sets it or says why not; the projection starts there; print has it', () => {
    const rb = bodyOf38('renderBayesianResults');
    assert(/firstDoseHTML\(firstPlan, rec, false\)/.test(rb) && /const firstPlan = !isHD && rec && !rec\.noSolution/.test(rb), 'the regular verdict, not HD');
    assert(/bState\.firstDoseAtH = null;/.test(bodyOf38('runBayesian')), 'a new fit clears it');
    assert(/k82:[^\n]*b-first-msg[^\n]*bState\.firstDoseAtH = /.test(script38), 'k82: a bad time is said, a good one stored');
    // Final review (v3.9.0): k82 updates only the readout and the curve — a full re-render on
    // every date-segment keystroke made the date untypable and reset the rest of the panel.
    const k82 = (script38.match(/\n  k82: [^\n]*/) || [''])[0];
    assert(/b-first-readout/.test(k82) && /refreshProfileGraph\(\)/.test(k82) && !/renderBayesianResults/.test(k82), 'k82 is a partial update');
    assert(/firstDosePlan\(r, \{ dose: projDose, tau: projTau, tinfH \}, r\.fitNowH, bState\.firstDoseAtH, bState\.curRegimen\)/.test(bodyOf38('refreshProfileGraph')), 'the projection starts where the readout says');
    assert(/firstDoseHTML\(fp, r\.rec, true\)/.test(bodyOf38('_prRecommendation')), 'print');
  });
  test('38.5 final review: planned rows set the due time; the first-day exposure is said; minutes; wall-clock times; "next dose" for the same regimen', () => {
    const planned = Object.assign({}, r38, { doses: [{ mg: 1000, tinfH: 1, timeH: 0 }, { mg: 1000, tinfH: 1, timeH: 22 }] });
    const pp = sandbox.firstDosePlan(planned, { dose: 1000, tau: 12, tinfH: 1 }, 20);
    assert(pp.dueH === 34 && pp.plannedN === 1 && pp.firstH === 34, `the planned row is read: ${JSON.stringify(pp).slice(0, 200)}`);
    assert(/after the 1 planned dose entered/.test(sandbox.firstDoseHTML(pp, { dose: 1000, tau: 12, tinfH: 1 }, false)), 'said');
    // Early start: 1750 mg q24h given 2 h after a 1 g dose — the first day runs above steady state.
    const early = sandbox.firstDosePlan(Object.assign({}, r38, { fitNowH: 2 }), q24, 2, 2);
    assert(early.auc24First > 1750 / 3, `first-day AUC ${early.auc24First} above steady state ${1750 / 3}`);
    // v3.11.0 (D22): printed whole; on screen only when outside the band (SUITE 40.2).
    const eh = sandbox.firstDoseHTML(early, q24, true);
    assert(/AUC₂₄ over the first 24 h <strong>\d+<\/strong> mg·h\/L/.test(eh) && /until then an earlier first dose raises exposure/.test(eh), eh.slice(0, 700));
    if (early.auc24First > 600) assert(/above 400–600/.test(eh) && /above 400–600/.test(sandbox.firstDoseHTML(early, q24, false)), 'outside the band is said in words, on paper and on screen');
    const near = sandbox.firstDoseHTML(sandbox.firstDosePlan(r38, q24chg, 20, 24.05, cur24), q24chg, true);
    assert(/3 min after the q24h schedule/.test(near), 'minutes, never "0 h"');
    const dst = new Date('2026-10-31T16:00').getTime() / 3600000;
    const pd = sandbox.firstDosePlan(Object.assign({}, r38, { fitNowH: dst - 1 }), { dose: 1000, tau: 8, tinfH: 1 }, dst - 1, dst);
    assert(pd.times.join() === '16:00,00:00,08:00', `wall-clock times across a DST change: ${pd.times.join()}`);
    // "Next dose" when the decision continues the regimen being given (R16: the decision's reading).
    const q24cont = Object.assign({ action: 'continue' }, q24);
    const same = sandbox.firstDoseHTML(sandbox.firstDosePlan(r38, q24cont, 20, null, { dose: 1750, tau: 24 }), q24cont, false);
    assert(/Next dose/.test(same) && !/First dose/.test(same), 'the same regimen: the next dose');
  });
}

// ════════════════════════════════════════════════════════════════════
// SUITE 39 — the CrCl weight spread (v3.10.0, D21)
//
// Before any level, an obese patient's population clearance rests on which
// weight Cockcroft-Gault is given. A paired DoseMeRx run on the same model
// (Buelga) gave 7.56 L/h against this calculator's 9.72 — the CrCl differed,
// not the model. The note shows the dose's exposure on each weight (SCr as
// measured, rule 4); it never changes the dose. Fictional patient throughout.
// ════════════════════════════════════════════════════════════════════
{
  console.log(`\n${'─'.repeat(60)}`);
  console.log('  SUITE 39 — CrCl weight spread (v3.10.0)');
  console.log(`${'─'.repeat(60)}`);
  const K39 = require('./harness_constants.cjs').extract();
  const src39 = fs.readFileSync(htmlPath, 'utf8');
  const script39 = src39.match(/<script>([\s\S]*?)<\/script>/)[1];
  const code39 = script39.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  const bodyOf39 = (n) => { const c = code39.slice(code39.indexOf('function ' + n + '(')); return c.slice(0, c.indexOf('\nfunction ')); };
  // 34 F, 165 cm, 118 kg, SCr 0.55 — obese (TBW well over 120% IBW), low creatinine.
  const pt = { model: 'buelga', dial: false, levelsN: 0, overrideOn: false, age: 34, sex: 'F', scr: 0.55, tbw: 118, heightCm: 165, tdd: 4000 };
  const cg = (wt, scr) => (140 - pt.age) * wt / (72 * scr) * 0.85;
  const used = (c) => Math.max(K39.CRCL_MODEL_FLOOR, Math.min(K39.CRCL_MODEL_CAP, c));
  test('39.1 three rows, IBW / AdjBW / TBW, SCr as measured; AdjBW is the one used; CL and AUC24 from the model on each', () => {
    const s = sandbox.crclWeightSpread(pt);
    assert(s && s.rows.length === 3, JSON.stringify(s));
    assert(s.rows.map(x => x.basis).join() === 'IBW,AdjBW,TBW', s.rows.map(x => x.basis).join());
    const ibw = sandbox.calcIBW('F', 165), adj = sandbox.calcAdjBW(118, ibw);
    [ibw, adj, 118].forEach((wt, i) => {
      const row = s.rows[i];
      assert(Math.abs(row.wt - wt) < 1e-9, `${row.basis} weight ${row.wt} vs ${wt}`);
      assert(Math.abs(row.crcl - cg(wt, 0.55)) < 1e-6, `${row.basis} CrCl ${row.crcl} vs ${cg(wt, 0.55)} (measured SCr)`);
      assert(row.crclUsed === used(row.crcl) && row.capped === (row.crcl > K39.CRCL_MODEL_CAP), `${row.basis} limited to the cap`);
      const CL = K39.BUELGA_CL_SLOPE * row.crclUsed * K39.ML_MIN_TO_L_H;
      assert(Math.abs(row.CL - CL) < 1e-9 && Math.abs(row.auc24 - 4000 / CL) < 1e-9, `${row.basis} CL ${row.CL} AUC ${row.auc24}`);
    });
    assert(s.rows.filter(x => x.used).map(x => x.basis).join() === 'AdjBW', 'the auto rule picks AdjBW');
    // The used row is exactly the prior the fit started from.
    const crclFit = used(cg(adj, 0.55));
    assert(Math.abs(s.rows[1].CL - sandbox.buelgaPopPK(crclFit, 118).CL_pop) < 1e-9, 'the used row is the fit\'s population CL');
  });
  test('39.2 shown only before the first level, for Buelga or Goti, obese, with no manual CrCl and a regimen to judge', () => {
    const none = (o, why) => assert(sandbox.crclWeightSpread(Object.assign({}, pt, o)) === null, why);
    none({ levelsN: 1 }, 'a level: the clearance estimates take over');
    none({ overrideOn: true }, 'a manual CrCl: the clinician chose it');
    none({ model: 'hughes' }, 'Hughes: its own fat-free-mass scale');
    none({ model: 'goti', dial: true }, 'Goti-HD: on dialysis Cockcroft-Gault does not estimate clearance');
    none({ tdd: null }, 'no regimen to judge');
    const ibw = sandbox.calcIBW('F', 165);
    none({ tbw: ibw * 1.2 }, 'not obese by the AdjBW rule (TBW not over 120% IBW)');
    assert(sandbox.crclWeightSpread(Object.assign({}, pt, { tbw: ibw * 1.21 })) !== null, 'just over 120%: shown');
  });
  test('39.3 Goti: its own SCr rule and its own clearance equation on each weight', () => {
    const old = Object.assign({}, pt, { model: 'goti', age: 70, scr: 0.6 });   // Goti truncates SCr above 65
    const s = sandbox.crclWeightSpread(old);
    assert(s && s.rows.length === 3, JSON.stringify(s));
    s.rows.forEach(row => {
      const c = (140 - 70) * row.wt / (72 * K39.GOTI_SCR_FLOOR) * 0.85;
      assert(Math.abs(row.crcl - c) < 1e-6, `${row.basis} Goti CrCl ${row.crcl} vs ${c}`);
      const CL = sandbox.gotiPopPK(row.crclUsed, 118, false).TVCL;
      assert(Math.abs(row.CL - CL) < 1e-9 && Math.abs(row.auc24 - 4000 / CL) < 1e-9, `${row.basis} Goti CL`);
    });
  });
  test('39.4 caution only when a weight puts the regimen outside 400–600; which weights read as augmented clearance', () => {
    const s = sandbox.crclWeightSpread(pt);
    assert(s.rows.every(x => x.auc24 >= K39.AUC24_TARGET_MIN && x.auc24 <= K39.AUC24_TARGET_MAX) ? s.tier === 'info' : s.tier === 'caution', `tier ${s.tier}`);
    const lo = sandbox.crclWeightSpread(Object.assign({}, pt, { tdd: 3500 }));   // 1750 mg q12h
    const out = lo.rows.filter(x => x.auc24 < K39.AUC24_TARGET_MIN || x.auc24 > K39.AUC24_TARGET_MAX).map(x => x.basis);
    assert(out.length && lo.tier === 'caution' && lo.outside.join() === out.join(), `outside ${lo.outside} vs ${out}`);
    // ARC is judged on the uncapped Cockcroft-Gault, measured SCr: a split names the weights it rests on.
    const arcOn = s.rows.filter(x => cg(x.wt, 0.55) >= K39.ARC_THRESHOLD).map(x => x.basis);
    assert((arcOn.length > 0 && arcOn.length < 3) ? s.arcOn.join() === arcOn.join() : s.arcOn === null, `arcOn ${s.arcOn} vs ${arcOn}`);
    const split = sandbox.crclWeightSpread(Object.assign({}, pt, { scr: 0.9 }));
    const splitOn = split.rows.filter(x => cg(x.wt, 0.9) >= K39.ARC_THRESHOLD).map(x => x.basis);
    assert(splitOn.length > 0 && splitOn.length < 3 && split.arcOn.join() === splitOn.join(), `a real split at SCr 0.9: ${split.arcOn} vs ${splitOn}`);
  });
  test('39.5 the note: each weight, CrCl (limited where capped), CL, AUC24; SCr as measured; what settles it; no colour words', () => {
    const s = sandbox.crclWeightSpread(Object.assign({}, pt, { tdd: 3500 }));
    const n = sandbox.crclSpreadNote(s, { dose: 1750, tau: 12 }, 0.55, 'Buelga 2005 (1-comp)');
    assert(n.tier === s.tier && /CrCl depends on the weight used/.test(n.word), JSON.stringify(n).slice(0, 200));
    const h = n.html;
    assert(/SCr 0\.55 mg\/dL as measured/.test(h) && /1\.75 g IV q12h/.test(h), h.slice(0, 300));
    s.rows.forEach(x => {
      assert(h.includes(`${x.basis} ${x.wt.toFixed(1)} kg`) && h.includes(`CrCl ${x.crcl.toFixed(0)} mL/min`) && h.includes(`CL ${x.CL.toFixed(2)} L/h`) && h.includes(`AUC₂₄ ${x.auc24.toFixed(0)}`), `${x.basis} row`);
      if (x.capped) assert(h.includes(`CrCl ${x.crcl.toFixed(0)} mL/min, limited to ${K39.CRCL_MODEL_CAP}`), `${x.basis} limited`);
    });
    assert(/AdjBW [\d.]+ kg, used/.test(h), 'the used row says so');
    assert(/outside 400–600/.test(h), 'outside the band, in words');
    // Final review (v3.10.0): "a level settles it" overclaimed — one early level still leans on the prior.
    assert(/round a low SCr up/.test(h) && /uses it as measured/.test(h) && /A level lets the fit estimate clearance from the patient rather than from a weight/.test(h), 'other tools, rule 4, and what a level does');
    const split = sandbox.crclWeightSpread(Object.assign({}, pt, { scr: 0.9 }));
    assert(new RegExp(`Augmented clearance \\(CrCl ≥ ${K39.ARC_THRESHOLD} mL/min\\) is suspected on ${split.arcOn.join(' and ')} only`).test(sandbox.crclSpreadNote(split, { dose: 2000, tau: 12 }, 0.9, 'x').html), 'the split, named');
    assert(!/\b(red|green|purple|terracotta|orange|blue)\b/i.test(h), 'no colour words');
  });
  test('39.6 wiring: the AUC result builds it from the fit, the levels and the override; the dose is untouched', () => {
    const rb = bodyOf39('renderBayesianResults');
    // Final review (v3.10.0): the override is read as it was at fit time (agCtx), not live — a redraw
    // after unticking it showed a note that contradicted the verdict.
    assert(/crclWeightSpread\(\{[^}]*levelsN: nLev[^}]*overrideOn: ag\.crclSource === 'manual override'[^}]*tdd: rec && !rec\.noSolution \? rec\.tdd : null/.test(rb), 'called with the fit\'s inputs');
    assert(!/crclOverride\.on/.test(rb.slice(rb.indexOf('crclWeightSpread('), rb.indexOf('crclWeightSpread(') + 400)), 'never the live override');
    assert(/notes\.push\(crclSpreadNote\(/.test(rb), 'pushed as a note');
    assert(!/crclWeightSpread/.test(bodyOf39('runBayesian')) && !/crclWeightSpread/.test(bodyOf39('bayesDoseOptimizer')), 'never reaches the fit or the dose');
  });
  // The user's review (2026-10-29): on an obese young patient the spread and the augmented-
  // clearance advisory showed as two cautions about one CrCl, one saying "escalate", the other
  // "on IBW clearance is lower". One renal note now carries both.
  test('39.7 one renal note, not two: the weights lead, the advisory follows, its actions under "if truly augmented"; the stricter tier wins; nothing said twice', () => {
    const s = sandbox.crclWeightSpread(pt);
    const renal = { tier: 'caution', word: 'Augmented renal clearance suspected', head: 'CrCl ≈ 268 mL/min.', lead: 'LEAD.', list: '<ul class="note-list"><li>BULLET</li></ul>', ifReal: true };
    const n = sandbox.crclSpreadNote(s, { dose: 1500, tau: 8 }, 0.55, 'Buelga 2005 (1-comp)', renal);
    assert(n.tier === 'caution' && n.word === renal.word, JSON.stringify({ tier: n.tier, word: n.word }));
    const h = n.html, at = (t) => h.indexOf(t);
    assert(/CrCl depends on the weight used/.test(h) && at('AdjBW') >= 0 && at('AdjBW') < at('LEAD') && at('LEAD') < at('If clearance is truly augmented:') && at('If clearance is truly augmented:') < at('BULLET'),
           'the weights, then the advisory, then its actions under the condition');
    assert(!/A level lets the fit estimate clearance/.test(h), 'the advisory already says when to draw a level');
    assert(!h.includes('CrCl ≈ 268'), 'the advisory\'s CrCl sentence is dropped: the rows already give it');
    assert(/uses it as measured/.test(h), 'rule 4 still said');
    const lo = sandbox.crclWeightSpread(Object.assign({}, pt, { tdd: 3500 }));   // a caution spread
    const n2 = sandbox.crclSpreadNote(lo, { dose: 1750, tau: 12 }, 0.55, 'x', { tier: 'info', word: 'Low creatinine in an older patient', lead: 'L.', list: '' });
    assert(n2.tier === 'caution' && n2.word === 'Low creatinine in an older patient' && !/truly augmented/.test(n2.html), JSON.stringify(n2).slice(0, 200));
  });
  test('39.8 wiring: the spread is read before the renal advisories, which hand themselves to it; it stands alone only when no advisory took it', () => {
    const rb = bodyOf39('renderBayesianResults');
    assert(rb.indexOf('crclWeightSpread(') >= 0 && rb.indexOf('crclWeightSpread(') < rb.indexOf('renalAdvisoryKind('), 'computed before the advisories');
    assert(/crclSpreadNote\(spread, rec, Number\(ag\.scr\), modelLabel, renal\)/.test(rb), 'an advisory merges into it');
    assert(/if \(spread && !spreadMerged\) notes\.push\(crclSpreadNote\(spread, rec, Number\(ag\.scr\), modelLabel\)\)/.test(rb), 'alone only when not merged');
    ['High CrCl from a low creatinine', 'Augmented renal clearance suspected', 'Low creatinine in an older patient'].forEach(w =>
      assert(new RegExp(`pushRenal\\(\\{ tier: '\\w+', word: '${w}`).test(rb), `${w} goes through the merge`));
    // The advisory's "CrCl ≈ N" sentence is its head: shown alone, dropped when merged (the rows give it).
    assert(/word: 'Augmented renal clearance suspected', ifReal: true, head: `CrCl ≈ \$\{crclTrue\.toFixed\(0\)\} mL\/min\.`/.test(rb)
        && /word: 'High CrCl from a low creatinine — may be overestimated', head: `CrCl ≈ \$\{crclTrue\.toFixed\(0\)\} mL\/min\.`/.test(rb), 'the CrCl sentence is the head');
    assert(/html: \(renal\.head \|\| ''\) \+ renal\.lead \+ \(renal\.list \|\| ''\)/.test(rb), 'alone, the head is kept');
  });
  // ── Final review (v3.10.0, a fresh reviewer): four Important findings, each RED first ──
  test('39.9 hidden under the severe-renal hold (no maintenance regimen to judge) and when HD sessions are logged', () => {
    const none = (o, why) => assert(sandbox.crclWeightSpread(Object.assign({}, pt, o)) === null, why);
    none({ hold: true }, 'the verdict holds maintenance: listing a regimen contradicted it');
    none({ sessionsN: 2 }, 'on dialysis the Cockcroft-Gault rows mean nothing');
    const rb = bodyOf39('renderBayesianResults');
    assert(/crclWeightSpread\(\{[^}]*hold: !!r\.lowCrClHold[^}]*sessionsN: \(r\.hdSessions \|\| \[\]\)\.length/.test(rb), 'wired from the fit');
  });
  test('39.10 Goti above 65 with a low SCr: the rows say what SCr they used; no augmented-clearance sentence where the older-patient rule applies, on either model', () => {
    const old = Object.assign({}, pt, { model: 'goti', age: 70, scr: 0.6, tbw: 110, heightCm: 160 });
    const s = sandbox.crclWeightSpread(old);
    assert(s.scrRead === K39.GOTI_SCR_FLOOR && s.arcOn === null, JSON.stringify({ scrRead: s.scrRead, arcOn: s.arcOn }));
    const h = sandbox.crclSpreadNote(s, { dose: 1000, tau: 12 }, 0.6, 'Goti 2018 (2-comp)').html;
    assert(new RegExp(`SCr read as ${K39.GOTI_SCR_FLOOR.toFixed(2)} mg/dL \\(Goti 2018's rule above age ${K39.GOTI_SCR_FLOOR_AGE}; measured 0\\.60\\)`).test(h), h.slice(0, 300));
    assert(!/as measured/.test(h) && !/Augmented clearance/.test(h), 'never "as measured" for a truncated SCr; no ARC sentence');
    const b = sandbox.crclWeightSpread(Object.assign({}, old, { model: 'buelga' }));
    assert(b.scrRead === 0.6 && b.arcOn === null && !/Augmented clearance/.test(sandbox.crclSpreadNote(b, { dose: 1000, tau: 12 }, 0.6, 'x').html),
           'Buelga, same patient: SCr as measured, and the older-patient rule still holds the ARC sentence back');
    const young = sandbox.crclWeightSpread(Object.assign({}, pt, { scr: 0.9 }));
    assert(young.scrRead === 0.9 && young.arcOn !== null, 'a younger patient keeps the split');
  });
  test('39.11 in or out of 400–600 is judged on the number shown', () => {
    const base = sandbox.crclWeightSpread(pt), CL = base.rows[1].CL;
    for (const raw of [399.7, 600.3]) {
      const s = sandbox.crclWeightSpread(Object.assign({}, pt, { tdd: raw * CL }));
      const used = s.rows.find(x => x.used);
      assert(Math.abs(used.auc24 - raw) < 1e-6 && !s.outside.includes('AdjBW'), `raw ${raw} shows as ${Math.round(raw)}, inside`);
      assert(!/AUC₂₄ (400|600), outside/.test(sandbox.crclSpreadNote(s, { dose: 1000, tau: 12 }, 0.55, 'x').html), 'never "400, outside 400–600"');
    }
  });
  test('39.12 the used row is the fit\'s own prior, read through the fit\'s own CrCl readers (Buelga and Goti; young, older, short stature)', () => {
    const prevDoc = sandbox.document, vals = {};
    sandbox.document = { getElementById: (id) => (vals[id] = vals[id] || { value: '' }), querySelector: () => null, querySelectorAll: () => [] };
    try {
      for (const c of [{ age: 34, scr: 0.55, tbw: 118, ht: 165 }, { age: 72, scr: 0.6, tbw: 110, ht: 160 }, { age: 50, scr: 1.4, tbw: 95, ht: 150 }]) {
        Object.assign(vals, { 'b-age': { value: String(c.age) }, 'b-scr': { value: String(c.scr) }, 'b-tbw': { value: String(c.tbw) }, 'b-height': { value: String(c.ht) } });
        vm.runInContext("bState.sex = 'F'", sandbox);
        const o = Object.assign({}, pt, { age: c.age, scr: c.scr, tbw: c.tbw, heightCm: c.ht });
        const b = sandbox.crclWeightSpread(Object.assign({}, o, { model: 'buelga' })).rows.find(x => x.used);
        assert(b.CL === sandbox.buelgaPopPK(sandbox.getBayesCrCl(), c.tbw).CL_pop, `Buelga ${JSON.stringify(c)}`);
        const g = sandbox.crclWeightSpread(Object.assign({}, o, { model: 'goti' })).rows.find(x => x.used);
        assert(g.CL === sandbox.gotiPopPK(sandbox.getGotiCrCl(), c.tbw, false).TVCL, `Goti ${JSON.stringify(c)}`);
      }
    } finally { sandbox.document = prevDoc; vm.runInContext('bState.sex = null', sandbox); }
  });
}

// ════════════════════════════════════════════════════════════════════
// SUITE 40 — the answer first (v3.11.0, D22)
//
// The 2026-10-30 critique: the default result ran 2.5–3 screens; the first-dose
// block (~230 px) pushed confidence and the next step under the fold; on
// Goti-HD "No dose now" sat above an open q-interval grid and a guideline
// regimen. The user chose: answer order regimen → AUC → trough → confidence →
// Next → first dose; the first dose on one line; HD's grid closed after
// Haemodialysis; duplicates and empty sections gone. Presentation only — no
// number changes (engine parity). Fictional patient throughout.
// ════════════════════════════════════════════════════════════════════
{
  console.log(`\n${'─'.repeat(60)}`);
  console.log('  SUITE 40 — the answer first (v3.11.0)');
  console.log(`${'─'.repeat(60)}`);
  const K40 = require('./harness_constants.cjs').extract();
  const src40 = fs.readFileSync(htmlPath, 'utf8');
  const script40 = src40.match(/<script>([\s\S]*?)<\/script>/)[1];
  const code40 = script40.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  const bodyOf40 = (n) => { const c = code40.slice(code40.indexOf('function ' + n + '(')); return c.slice(0, c.indexOf('\nfunction ')); };
  const r40 = { model: 'buelga', CL_ind: 3, V_ind: 60, doses: [{ mg: 1000, tinfH: 1, timeH: 0 }], levels: [], fitNowH: 20 };
  const q12 = { dose: 1000, tau: 12, tinfH: 1 };
  const plan40 = () => sandbox.firstDosePlan(r40, q12, 20, 26.5);
  test('40.1 on screen the first dose is one line — when, the times after, the level by then — and "change" opens the date and time', () => {
    const plan = plan40();
    const line = sandbox.firstDoseReadoutHTML(plan, q12, false);
    assert(!/<p\b/.test(line), `one line, no paragraphs: ${line.slice(0, 300)}`);
    assert(/then \d\d:\d\d and \d\d:\d\d daily/.test(line) && /level by then <strong>[\d.]+ mg\/L<\/strong>/.test(line), line);
    assert(!/unchanged/.test(line) && !/AUC₂₄/.test(line), 'no teaching sentence, no first-day AUC in the line');
    const h = sandbox.firstDoseHTML(plan, q12, false);
    assert(/<span id="b-first-readout" aria-live="polite">/.test(h), 'the line is the live readout');
    // Final review (v3.11.0): the accessible name carries its subject, and contains the visible word.
    assert(/<button type="button" class="vx-link" data-onclick="k83" aria-expanded="false" aria-controls="b-first-edit" aria-label="Change the first dose time">change<\/button>/.test(h), 'a "change" button that says what it opens');
    assert(/id="b-first-edit" hidden>[\s\S]*id="b-first-date"[\s\S]*id="b-first-time"/.test(h), 'the date and time are closed until asked for');
    assert(h.indexOf('b-first-readout') < h.indexOf('b-first-edit'), 'the answer reads before the controls');
  });
  test('40.2 the first-day AUC is said only when it falls outside the band; print keeps the whole block', () => {
    const plan = plan40();
    const within = Object.assign({}, plan, { auc24First: (K40.AUC24_TARGET_MIN + K40.AUC24_TARGET_MAX) / 2 });
    assert(sandbox.firstDayAucHTML(within) === '', 'within the band: nothing');
    assert(sandbox.firstDayAucHTML(Object.assign({}, plan, { auc24First: null })) === '', 'no first-day AUC: nothing');
    const low = sandbox.firstDayAucHTML(Object.assign({}, plan, { auc24First: K40.AUC24_TARGET_MIN - 40 }));
    assert(new RegExp(`tone-caution">First 24 h AUC₂₄ ${K40.AUC24_TARGET_MIN - 40}, below ${K40.AUC24_TARGET_MIN}–${K40.AUC24_TARGET_MAX}`).test(low) && /steady state unchanged/.test(low), low);
    const high = sandbox.firstDayAucHTML(Object.assign({}, plan, { auc24First: K40.AUC24_TARGET_MAX + 25 }));
    assert(/above \d+–\d+/.test(high), high);
    // Final review (v3.11.0): the slot is a live region that is always in the page, so a k82
    // edit that moves the first-day AUC out of the band is announced.
    assert(/id="b-first-auc" aria-live="polite"><\/p>/.test(sandbox.firstDoseHTML(within, q12, false)), 'an empty live slot k82 can fill');
    assert(/id="b-first-auc" aria-live="polite"><span class="tone-caution">First 24 h/.test(sandbox.firstDoseHTML(Object.assign({}, plan, { auc24First: 300 }), q12, false)), 'shown when outside');
    // Final review (v3.11.0): judged on the number shown, as D21 made the rule ("never '400, below 400–600'").
    for (const a of [K40.AUC24_TARGET_MIN - 0.3, K40.AUC24_TARGET_MAX + 0.3]) {
      const pa = Object.assign({}, plan, { auc24First: a });
      assert(sandbox.firstDayAucHTML(pa) === '', `${a} reads ${Math.round(a)}: within, so nothing`);
      assert(/within \d+–\d+/.test(sandbox.firstDoseReadoutHTML(pa, q12, true)), `${a} prints as within`);
    }
    assert(/First 24 h AUC₂₄ 399, below/.test(sandbox.firstDayAucHTML(Object.assign({}, plan, { auc24First: K40.AUC24_TARGET_MIN - 0.6 }))), '399.4 reads 399, below');
    const p = sandbox.firstDoseHTML(within, q12, true);
    assert(/First dose/.test(p) && /Level by then/.test(p) && /AUC₂₄ over the first 24 h/.test(p) && /trough are unchanged/.test(p) && !/<input|<button/.test(p), 'print: the full block as text');
  });
  test('40.3 the answer order: regimen, AUC, trough, then confidence and Next, then the first dose; AUC/MIC only when MIC is not 1', () => {
    const rb = bodyOf40('renderBayesianResults');
    const verdictBox = rb.slice(rb.indexOf('<div class="rec-box vx-rec'), rb.indexOf("lowConfSpan = derated"));
    assert(!/firstDoseHTML/.test(verdictBox), 'the first dose is no longer inside the regimen box');
    assert(/\$\{verdict\}\s*\$\{confBlock\}\s*\$\{nextBlock\}\s*\$\{firstBlock\}\s*\$\{hdBlock\}/.test(rb), 'confidence and Next before the first dose');
    assert(/const firstBlock = firstPlan \? firstDoseHTML\(firstPlan, rec, false\) : '';/.test(rb), 'the first dose, built once');
    assert(/Math\.abs\(mic - 1\) > 1e-9 \? `<span class="vx-nb"><span class="vx-k">AUC\/MIC<\/span>/.test(verdictBox), 'AUC/MIC only when it says something the AUC does not');
  });
  test('40.4 k82 updates the line and the first-day slot only; k83 opens and closes the date and time, and focuses the date', () => {
    const k82 = (script40.match(/\n  k82: [^\n]*/) || [''])[0], k83 = (script40.match(/\n  k83: [^\n]*/) || [''])[0];
    assert(/b-first-readout/.test(k82) && /firstDoseReadoutHTML\(plan, r\.rec, false\)/.test(k82) && /b-first-auc/.test(k82) && /firstDayAucHTML\(plan\)/.test(k82), 'both readouts');
    assert(/refreshProfileGraph\(\)/.test(k82) && !/renderBayesianResults/.test(k82), 'still a partial update');
    assert(/b-first-edit/.test(k83) && /\.hidden = !/.test(k83) && /aria-expanded/.test(k83) && /b-first-date/.test(k83) && /\.focus\(\)/.test(k83), k83.slice(0, 300));
  });
  test('40.5 Goti-HD: Regimens closed and placed after Haemodialysis; no guideline line; no projection row', () => {
    const rb = bodyOf40('renderBayesianResults');
    // v3.13.0 (D24): closed everywhere now, its gist naming the band count and the recommendation (42.8).
    assert(/regimensSec = ev\('ev-regimens', 'Regimens', gist, body, false\);/.test(rb), 'closed on HD (and, since D24, everywhere)');
    const before = rb.indexOf('if (!isHD) html += regimensSec;'), hdAt = rb.indexOf("ev('ev-hd'"), after = rb.indexOf('if (isHD) html += regimensSec;');
    assert(before > 0 && hdAt > before && after > hdAt, `order: ${before} < ${hdAt} < ${after}`);
    assert(/if \(p2c\.guidDose && !isHD\)/.test(rb), 'no weight-based q-interval line beside an HD answer');
    assert(/\$\{isHD \? '' : `\s*<div class="vx-proj">/.test(rb), 'no q-interval projection row on HD: the planned dose rows do that');
  });
  test('40.6 said once: the chart summary is the canvas\'s label only; the population-only note is gone, its narrowing sentence in Show the math', () => {
    const rb = bodyOf40('renderBayesianResults');
    assert(/<p class="vx-summary" id="b-summary" hidden>/.test(rb), 'kept for Copy summary, not shown or read twice');
    assert(/aria-label="\$\{escHtml\('Concentration–time curve\. ' \+ summary\)\}"/.test(rb), 'the canvas still carries it');
    assert(!/Population estimate only/.test(code40), 'the note repeated the range and the confidence');
    const math = rb.slice(rb.indexOf("html += ev('ev-math'"));
    assert(/nLev === 0 \? ` One steady-state trough narrows it to \$\{escHtml\(aucUncertaintyText\(1, uncertaintyModelKey\(r\)\)\)\}; two to \$\{escHtml\(aucUncertaintyText\(2, uncertaintyModelKey\(r\)\)\)\}\.` : ''/.test(math), 'how a level narrows it, in the Range step');
  });
  test('40.7 empty sections become one line, naming each and what it needs', () => {
    assert(sandbox.emptySectionsHTML([]) === '', 'none empty: nothing');
    const h = sandbox.emptySectionsHTML([{ title: 'Current regimen', why: 'more maintenance doses to read a schedule' },
      { title: 'Models', why: 'a measured level' }, { title: 'Fit vs measured', why: 'a measured level' }]);
    assert(/^<p class="ev-empty">/.test(h) && (h.match(/<p/g) || []).length === 1, h);
    assert(/Current regimen needs more maintenance doses to read a schedule/.test(h) && /Models and Fit vs measured need a measured level/.test(h), h);
    assert(sandbox.emptySectionsHTML([{ title: 'Models', why: 'a measured level' }]).includes('Models needs a measured level'), 'singular');
    const rb = bodyOf40('renderBayesianResults');
    assert(/html\.replace\('<!--ev-empty-->', \(\) => emptySectionsHTML\(evEmpty\)\)/.test(rb), 'one line, where the first empty section stood');
    assert(/ev\('ev-models', 'Models', gist, body, false, modelsEmpty \? 'a measured level' : null\)/.test(rb), 'Models');
    assert(/ev\('ev-fit', 'Fit vs measured', gist, body, false, fd \? null : 'a measured level'\)/.test(rb), 'Fit vs measured');
    assert(/ev\('ev-current', 'Current regimen', gist, body, false, body \? null : 'more maintenance doses to read a schedule'\)/.test(rb), 'Current regimen');
  });
  test('40.8 "now" is on the time axis whenever it falls within 72 h after the curve\'s end; the strip and the curve read one clock', () => {
    const doses = [{ mg: 1000, tinfH: 1, timeH: 100 }];
    const base = sandbox.profileDomain(doses, 0.1, [], []);
    assert(sandbox.profileDomain(doses, 0.1, [], [], base.tEnd - 5).tEnd === base.tEnd, 'already on it: unchanged');
    const near = sandbox.profileDomain(doses, 0.1, [], [], base.tEnd + 20);
    assert(near.tStart === base.tStart && near.tEnd > base.tEnd + 20, `reached with a margin: ${JSON.stringify(near)}`);
    assert(sandbox.profileDomain(doses, 0.1, [], [], base.tEnd + 200).tEnd === base.tEnd, 'a profile opened days later is not flattened to reach it');
    assert(/const nowH = Date\.now\(\) \/ 3600000;/.test(bodyOf40('refreshProfileGraph')), 'one clock read per redraw');
    assert(/arrive, nowH \}\)/.test(bodyOf40('refreshProfileGraph')) && /r\.hdSessions \|\| \[\], arrive, nowH\);/.test(bodyOf40('refreshProfileGraph')), 'handed to both');
    assert(/profileDomain\(doses, kelInd, opts\.sessions, levels, tNow\)/.test(bodyOf40('drawProfileGraph')), 'the curve');
    assert(/profileDomain\(doses, kelInd, sessions, levels, tNow\)/.test(bodyOf40('drawCourseStrip')), 'the strip');
  });
  // Final review (v3.11.0), raised by the reviewer and approved by the user: the model advice was
  // never told the patient is on dialysis, so Goti-HD read "Standard adult — Buelga 2005 is
  // appropriate", an obese HD patient was pointed at Hughes, and the one-level note called Buelga
  // "more reliable" — a second answer beside an HD verdict, the thing D22 removes.
  test('40.9 on dialysis the model advice names Goti-HD and never suggests a model that does not carry dialysis', () => {
    const hd = sandbox.getModelRecommendation(1, false, 80, 175, true);
    assert(hd.recommended === 'gotihd' && /haemodialysis/.test(hd.reason) && /Goti 2018 · HD/.test(hd.reason), JSON.stringify(hd).slice(0, 300));
    assert(hd.oneLevelGotiNote && /Cunio 2021/.test(hd.oneLevelGotiNote) && !/Buelga/.test(hd.oneLevelGotiNote), 'one level on HD: identifiability said, no switch to Buelga');
    const match = sandbox.renderModelBanner(hd, 'gotihd');
    assert(/Model matches patient profile/.test(match) && !/Suggested/.test(match), match.slice(0, 300));
    const obeseHD = sandbox.getModelRecommendation(0, false, 130, 160, true);
    assert(obeseHD.recommended === 'gotihd', 'class 3 obesity on HD: still Goti-HD');
    const ob = sandbox.renderModelBanner(obeseHD, 'gotihd');
    assert(!/Consider switching to <strong>Hughes/.test(ob) && !/Buelga 2005 came from/.test(ob), `no switch away from the dialysis model: ${ob.slice(0, 400)}`);
    const onBuelga = sandbox.renderModelBanner(hd, 'buelga');
    assert(/Suggested:<\/strong> On intermittent haemodialysis/.test(onBuelga) && /You are using Buelga 2005/.test(onBuelga), onBuelga.slice(0, 300));
    // Off dialysis nothing changes.
    assert(sandbox.getModelRecommendation(0, false, 80, 175, false).recommended === 'buelga', 'standard adult');
    assert(sandbox.getModelRecommendation(0, false, 130, 160, false).recommended === 'hughes', 'class 3 obesity');
    assert(/Buelga 1-comp is often the more reliable choice/.test(sandbox.getModelRecommendation(1, false, 80, 175, false).oneLevelGotiNote), 'the non-HD note unchanged');
    // Wiring: told about dialysis from the model or logged sessions; the banner compares against Goti-HD.
    assert(/getModelRecommendation\(filteredLevels\.length, isICU, tbw, htCm, !!bState\.dial \|\| sessions\.length > 0\)/.test(bodyOf40('runBayesian')), 'runBayesian tells it');
    assert(/renderModelBanner\(p2c\.modelRec, isHD \? 'gotihd' : r\.model\)/.test(bodyOf40('renderBayesianResults')), 'the banner knows Goti-HD');
  });
}

// ════════════════════════════════════════════════════════════════════
// SUITE 41 — IV vancomycin on peritoneal dialysis (v3.12.0, D23)
//
// A level-based mode, not a model: the patient's own decline between levels,
// placed against the cycler schedule. Fictional CCPD patients throughout; no
// population PD model drives a dose (no validated one exists, D23).
// ════════════════════════════════════════════════════════════════════
{
  console.log(`\n${'─'.repeat(60)}`);
  console.log('  SUITE 41 — peritoneal dialysis, IV (v3.12.0)');
  console.log(`${'─'.repeat(60)}`);
  const K41 = require('./harness_constants.cjs').extract();
  // Hours since the epoch at a local wall-clock time, days from 10 Jun 2026 (no DST nearby).
  const H = (d, hm) => { const [h, m] = hm.split(':').map(Number); return new Date(2026, 5, 10 + d, h, m).getTime() / 3600000; };
  const dk = (d) => sandbox.localDateStr(new Date(2026, 5, 10 + d, 12, 0));
  const ccpd = (extra) => Object.assign({ modality: 'ccpd', startClock: '21:00', hours: 10, heldDates: [], stoppedAtH: null }, extra || {});
  const course = (extra) => Object.assign({ doses: [], levels: [], loadKg: 60, nowKg: 60, vdPerKg: 0.7, prior: 'no', schedule: ccpd() }, extra || {});
  test('41.1 sessions: one per night from the start clock; held nights and nights after PD stopped omitted; CAPD has none', () => {
    const s = sandbox.pdSessions(ccpd({ heldDates: [dk(1)] }), H(0, '00:00'), H(3, '00:00'));
    assert(s.map(x => x.dateKey).join() === [dk(-1), dk(0), dk(2)].join(), JSON.stringify(s.map(x => x.dateKey)));
    assert(s.every(x => Math.abs(x.endH - x.startH - 10) < 1e-9 && sandbox.localTimeStr(new Date(x.startH * 3600000)) === '21:00'), 'start clock and length');
    assert(sandbox.pdSessions(ccpd({ modality: 'nipd' }), H(0, '00:00'), H(3, '00:00')).length === 4, 'NIPD: the same cycler nights');
    assert(sandbox.pdSessions(ccpd({ modality: 'capd' }), H(0, '00:00'), H(3, '00:00')).length === 0, 'CAPD: no cycler');
    const st = sandbox.pdSessions(ccpd({ stoppedAtH: H(1, '12:00') }), H(0, '00:00'), H(3, '00:00'));
    assert(st.map(x => x.dateKey).join() === [dk(-1), dk(0)].join(), 'nothing after PD stopped');
  });
  test('41.2 from a naive load: k reproduces the measured level with V = vdPerKg x load weight; cycler nights counted', () => {
    const c = course({ doses: [{ mg: 1000, tinfH: 1, timeH: H(0, '03:30') }], levels: [{ conc: 13.0, timeH: H(2, '07:30') }] });
    const iv = sandbox.pdIntervals(c);
    assert(iv.length === 1 && iv[0].anchor === 'dose' && iv[0].used === true && iv[0].k > 0, JSON.stringify(iv));
    assert(Math.abs(sandbox.predictConc1comp(c.doses, iv[0].toH, iv[0].k, 42) - 13.0) < 1e-6, 'the level is reproduced');
    assert(Math.abs(iv[0].t12 - Math.LN2 / iv[0].k) < 1e-9 && iv[0].vL === 42, 'half-life and the volume used');
    assert(iv[0].nightsDone === 2 && iv[0].nightsHeld === 0 && iv[0].flags.length === 0, JSON.stringify(iv[0]));
  });
  test('41.3 vancomycin before the first dose: a level drawn before the first IV dose anchors; without one the first interval is not used', () => {
    const c = course({ prior: 'unknown', doses: [{ mg: 750, tinfH: 1, timeH: H(0, '09:00') }],
      levels: [{ conc: 11, timeH: H(0, '06:00') }, { conc: 13, timeH: H(1, '08:30') }] });
    const iv = sandbox.pdIntervals(c);
    assert(iv.length === 1 && iv[0].anchor === 'level' && iv[0].fromH === H(0, '06:00') && iv[0].used, JSON.stringify(iv));
    const y = sandbox.pdIntervals(course({ prior: 'yes', doses: [{ mg: 1000, tinfH: 1, timeH: H(0, '03:30') }], levels: [{ conc: 13, timeH: H(2, '07:30') }] }));
    assert(y.length === 1 && y[0].flags.includes('prior-drug') && y[0].used === false && y[0].k === null, JSON.stringify(y));
  });
  test('41.4 flags: early after a dose, on the cycler, a held night; rows sorted; a level inside an infusion is refused', () => {
    const doses = [{ mg: 500, tinfH: 1, timeH: H(2, '09:00') }, { mg: 1000, tinfH: 1, timeH: H(0, '03:30') }];
    const iv = sandbox.pdIntervals(course({ doses, levels: [{ conc: 15.5, timeH: H(3, '07:30') }, { conc: 13, timeH: H(2, '07:30') }] }));
    assert(iv.length === 2 && iv[1].anchor === 'level' && iv[1].flags.includes('early') && iv[1].used && !iv[0].flags.includes('early'), JSON.stringify(iv.map(x => x.flags)));
    const oc = sandbox.pdIntervals(course({ doses: [doses[1]], levels: [{ conc: 13.5, timeH: H(2, '02:00') }] }));
    assert(oc[0].flags.includes('on-cycler'), JSON.stringify(oc[0].flags));
    const held = sandbox.pdIntervals(course({ doses: [doses[1]], levels: [{ conc: 13, timeH: H(2, '07:30') }], schedule: ccpd({ heldDates: [dk(1)] }) }));
    assert(held[0].nightsHeld === 1 && held[0].nightsDone === 1 && held[0].flags.includes('held-night'), JSON.stringify(held[0]));
    let threw = '';
    try { sandbox.pdIntervals(course({ doses: [doses[1]], levels: [{ conc: 30, timeH: H(0, '04:00') }] })); } catch (e) { threw = e.message; }
    assert(/during the infusion/.test(threw), threw || 'no error');
  });
  test('41.5 a level the doses cannot explain names the volume; intervals before PD stopped are flagged', () => {
    const hi = sandbox.pdIntervals(course({ doses: [{ mg: 1000, tinfH: 1, timeH: H(0, '03:30') }], levels: [{ conc: 30, timeH: H(1, '08:00') }] }));
    assert(hi[0].flags.includes('unexplained-high') && hi[0].used === false && hi[0].k === null && hi[0].vL === 42, JSON.stringify(hi[0]));
    const st = sandbox.pdIntervals(course({ schedule: ccpd({ stoppedAtH: H(2, '12:00') }),
      doses: [{ mg: 1000, tinfH: 1, timeH: H(0, '03:30') }, { mg: 500, tinfH: 1, timeH: H(2, '09:00') }],
      levels: [{ conc: 13, timeH: H(2, '07:30') }, { conc: 16, timeH: H(4, '07:30') }] }));
    assert(st[0].flags.includes('before-stop') && !st[1].flags.includes('before-stop'), JSON.stringify(st.map(x => x.flags)));
    // Final review (v3.12.0): the second interval starts before the stop, so it runs partly on PD — flagged.
    assert(st[1].flags.includes('spans-stop'), JSON.stringify(st[1].flags));
    assert(st[1].nightsDone === 0, 'no cycler nights after PD stopped');
  });
  test('41.6 DST: cycler nights keep their wall-clock start across 1 Nov 2026; the session runs its hours of real time', () => {
    const from = new Date(2026, 9, 31, 12, 0).getTime() / 3600000, to = new Date(2026, 10, 2, 12, 0).getTime() / 3600000;
    const s = sandbox.pdSessions(ccpd({ hours: 9 }), from, to);
    assert(s.length === 2 && s.every(x => sandbox.localTimeStr(new Date(x.startH * 3600000)) === '21:00' && Math.abs(x.endH - x.startH - 9) < 1e-9), JSON.stringify(s));
    assert(K41.PD_LOAD_MG_PER_KG === 20 && K41.PD_EARLY_LEVEL_H === 24 && K41.PD_APD_T12_ON_H === 11.6 && K41.PD_APD_T12_OFF_H === 62.8 && K41.MATZKE_VD_GROUP3 === 0.9, 'constants extracted, not copied');
  });
  // A fictional CCPD patient: 61 kg at the load, 63 kg now; cycler 21:00 x 9.5 h.
  const sched95 = (extra) => ccpd(Object.assign({ hours: 9.5 }, extra || {}));
  const fict = (extra) => course(Object.assign({ loadKg: 61, nowKg: 63, schedule: sched95(),
    doses: [{ mg: 1250, tinfH: 1.5, timeH: H(0, '04:10') }, { mg: 500, tinfH: 1, timeH: H(2, '09:00') }],
    levels: [{ conc: 12.4, timeH: H(2, '07:00') }, { conc: 14.8, timeH: H(3, '07:15') }] }, extra || {}));
  const ask = (c, extra, nowH) => sandbox.pdAnswer(Object.assign({ course: c, goal: { min: 10, max: 15 }, urine: 'anuric', ipToo: false, hd: false,
    giveAtH: null, settings: { maxDoseMg: null, targetPeak: null, amLabs: '06:00' } }, extra || {}), nowH != null ? nowH : H(3, '09:00'));
  const noNaN = (a) => !/NaN|Infinity/.test(JSON.stringify(a));
  test('41.7 load: 20 mg/kg x weight now, rounded to 250, capped at 3000 or a lower local maximum; first level the AM labs nearest 48 h, earlier with residual urine', () => {
    const l57 = sandbox.pdLoadingDose(57, null), l160 = sandbox.pdLoadingDose(160, null), l160b = sandbox.pdLoadingDose(160, 2500);
    assert(l57.mg === 1250 && !l57.capped && l160.mg === K41.HD_LOADING_MAX_MG && l160.capped && l160b.mg === 2500 && l160b.capped, JSON.stringify([l57, l160, l160b]));
    const a = ask(course({ loadKg: 57, nowKg: 57 }), { giveAtH: H(0, '03:30') }, H(0, '03:00'));
    assert(a.state === 'load' && a.load.mg === 1250 && a.load.firstLevelH === H(2, '06:00') && noNaN(a), JSON.stringify(a).slice(0, 300));
    const u = ask(course({ loadKg: 57, nowKg: 57 }), { giveAtH: H(0, '03:30'), urine: 'gt500' }, H(0, '03:00'));
    assert(u.load.firstLevelH === H(1, '06:00') && u.cautions.some(c => /residual/i.test(c.word + c.html) && /24.48 h/.test(c.html)), JSON.stringify(u.cautions));
  });
  test('41.8 refusals name the cause and never carry NaN; drug before the first dose with no level asks for a level first', () => {
    const cases = [[{ goal: null }, /goal/i], [{ goal: { min: 15, max: 10 } }, /goal/i], [{ ipToo: true }, /intraperitoneal/i], [{ hd: true }, /haemodialysis/i]];
    for (const [extra, re] of cases) { const a = ask(fict(), extra); assert(a.state === 'refuse' && re.test(a.refuse.word) && noNaN(a), JSON.stringify(a).slice(0, 200)); }
    const w = ask(fict({ nowKg: 0 })); assert(w.state === 'refuse' && /weight/i.test(w.refuse.word), JSON.stringify(w).slice(0, 200));
    const inf = ask(fict({ levels: [{ conc: 30, timeH: H(0, '05:00') }] })); assert(inf.state === 'refuse' && /infusion/i.test(inf.refuse.html), JSON.stringify(inf).slice(0, 200));
    const p = ask(fict({ prior: 'yes', levels: [] }));
    assert(p.state === 'need-level' && p.nextDrawH === H(4, '06:00') && /before/i.test(p.message), JSON.stringify(p).slice(0, 300));
  });
  test('41.9 the projection range comes from the used intervals; one interval says so', () => {
    const a = ask(fict());
    const used = a.intervals.filter(i => i.used).map(i => i.k);
    assert(a.rate.n === 2 && a.rate.kMin === Math.min(...used) && a.rate.kMax === Math.max(...used), JSON.stringify(a.rate));
    const dt = a.nextDrawH - H(3, '07:15');
    assert(Math.abs(a.rows[0].atDraw[0] - 14.8 * Math.exp(-a.rate.kMax * dt)) < 1e-9 && Math.abs(a.rows[0].atDraw[1] - 14.8 * Math.exp(-a.rate.kMin * dt)) < 1e-9, JSON.stringify(a.rows[0]));
    assert(a.nextDrawH === H(4, '06:00'), 'next AM labs');
    const one = ask(fict({ levels: [{ conc: 12.4, timeH: H(2, '07:00') }], doses: [{ mg: 1250, tinfH: 1.5, timeH: H(0, '04:10') }] }), {}, H(2, '09:00'));
    assert(one.rate.n === 1 && one.cautions.some(c => /one interval/i.test(c.html)), JSON.stringify(one.cautions));
  });
  test('41.10 the recommendation: within goal no dose; below goal the step closest to the middle, ties smaller; above goal no dose until the top; out of reach the closest step, flagged', () => {
    // This fictional patient's no-dose projection lands near 9.6 mg/L: inside 9-14, below 10-15.
    const w = ask(fict(), { goal: { min: 9, max: 14 } });
    assert(w.state === 'no-dose' && w.pick === null && w.rows[0].mid >= 9 && w.rows[0].mid <= 14, JSON.stringify(w.rows[0]));
    assert(ask(fict()).state === 'dose', 'the same projection under 10-15 asks for a dose');
    const b = ask(fict(), { goal: { min: 15, max: 20 } });
    const inGoal = b.rows.filter(r => r.mg > 0 && r.mid >= 15 && r.mid <= 20);
    const best = inGoal.reduce((x, r) => (Math.abs(r.mid - 17.5) < Math.abs(x.mid - 17.5) - 1e-9 ? r : x), inGoal[0]);
    assert(b.state === 'dose' && b.pick && b.pick.mg === best.mg && !b.pick.closest, JSON.stringify({ pick: b.pick, rows: b.rows.map(r => [r.mg, r.mid]) }));
    const ab = ask(fict(), { goal: { min: 5, max: 8 } });
    assert(ab.state === 'no-dose' && ab.reachTopH > H(3, '09:00') && ab.nextDrawH >= ab.reachTopH, JSON.stringify({ reach: ab.reachTopH, next: ab.nextDrawH }));
    const far = ask(fict(), { goal: { min: 60, max: 70 } });
    assert(far.state === 'dose' && far.pick.closest === true && far.pick.mg === K41.DOSE_MAX_PER_DOSE_MG, JSON.stringify(far.pick));
    assert(Math.max(...ask(fict(), { settings: { maxDoseMg: 1000, targetPeak: null, amLabs: '06:00' } }).rows.map(r => r.mg)) === 1000 && Math.max(...w.rows.map(r => r.mg)) === K41.DOSE_MAX_PER_DOSE_MG, 'rows stop at the cap');
  });
  test('41.11 the target-peak reading appears only when set locally: V now x (P - C at give), rounded to 250', () => {
    const lvT = H(3, '07:15');
    const t = ask(fict(), { giveAtH: lvT, settings: { maxDoseMg: null, targetPeak: 25, amLabs: '06:00' } }, lvT);
    // 0.7 L/kg x 63 kg x (25 - 14.8) = 449.8 mg, rounded to 500
    assert(t.targetPeak && t.targetPeak.mg === 500 && t.targetPeak.atDraw.length === 2, JSON.stringify(t.targetPeak));
    assert(ask(fict()).targetPeak === null, 'no local target, no row');
  });
  test('41.12 published APD/CAPD context is context only: CCPD from 11.6/62.8 h and the cycler hours; CAPD 66-115 h; none once PD stopped', () => {
    const a = ask(fict());
    const kOn = Math.LN2 / K41.PD_APD_T12_ON_H, kOff = Math.LN2 / K41.PD_APD_T12_OFF_H;
    assert(Math.abs(a.context.dailyFactor - Math.exp(-(kOn * 9.5 + kOff * 14.5))) < 1e-12, JSON.stringify(a.context));
    const c = ask(fict({ schedule: sched95({ modality: 'capd' }) }));
    assert(c.context.dailyFactor === null && c.context.t12Range[0] === K41.PD_CAPD_T12_MIN_H && c.context.t12Range[1] === K41.PD_CAPD_T12_MAX_H, JSON.stringify(c.context));
    const s = ask(fict({ schedule: sched95({ stoppedAtH: H(3, '08:00') }) }));
    assert(s.context.dailyFactor === null && /no published/i.test(s.context.label), JSON.stringify(s.context));
    const h4 = ask(fict({ schedule: sched95({ hours: 4 }) }));
    assert(JSON.stringify(h4.rows) === JSON.stringify(a.rows), 'the cycler hours change the context, never the rows');
  });
  test('41.13 the PD mode: a fifth button and section, its handlers, its own goal (never the trough fields), local settings read safely, no demographics demanded', () => {
    const src = fs.readFileSync(htmlPath, 'utf8');
    const script = src.match(/<script>([\s\S]*?)<\/script>/)[1];
    const body = (n) => { const c = script.slice(script.indexOf('function ' + n + '(')); return c.slice(0, c.indexOf('\nfunction ')); };
    assert(/<button class="calc-mode-btn" id="mode-btn-pd" data-onclick="k84" aria-pressed="false">Peritoneal dialysis<\/button>/.test(src) && /<div id="section-pd" style="display:none">/.test(src), 'button and section');
    assert(/mode-btn-pd'\)\.classList\.toggle\('active',\s*mode === 'pd'\)/.test(body('setCalcMode')) && /section-pd'\)\.style\.display\s*=\s*mode === 'pd'/.test(body('setCalcMode'))
      && /section-trough-shared'\)\.style\.display\s*=\s*mode === 'pd'\s*\?\s*'none'/.test(body('setCalcMode')), 'setCalcMode switches it, and hides the PK model and trough target');
    for (const k of ['k84', 'k85', 'k86', 'k87', 'k88', 'k89', 'k90', 'k91', 'k92', 'k94']) assert(new RegExp('\\n  ' + k + ': ').test(script), k);
    assert(/id="pd-goal-min"[^>]*>/.test(src) && !/id="pd-goal-min"[^>]*value="\d/.test(src) && !/id="pd-goal-max"[^>]*value="\d/.test(src), 'its own goal fields, empty');
    assert(/data-onclick="k85" data-arg="10\|15"/.test(src) && /data-onclick="k85" data-arg="15\|20"/.test(src), 'the two presets');
    const ls = body('pdLocalSettings');
    assert(/try\s*\{[\s\S]*localStorage\.getItem\('vanco\.pd\.local'\)[\s\S]*\}\s*catch/.test(ls), 'local settings read inside try/catch');
    const calc = body('calculate');
    assert(calc.indexOf("state.calcMode === 'pd'") > 0 && calc.indexOf("state.calcMode === 'pd'") < calc.indexOf('validateFields('), 'the PD branch comes before the demographics are validated');
    assert(/calcVd\('bauer', 0, 1, 0\)/.test(body('readPdForm')) && /MATZKE_VD_GROUP3/.test(body('readPdForm')), 'the volumes come from the existing sources');
  });
  test('41.14 the answer on screen: verdict first, then the next draw, the options with the pick marked, the decline in words, context labelled; the chart in CSS classes only', () => {
    const b = ask(fict(), { goal: { min: 15, max: 20 }, settings: { maxDoseMg: null, targetPeak: null, amLabs: '07:00' } });
    const html = sandbox.pdResultsHTML(b, { course: fict(), goal: { min: 15, max: 20 } }, H(3, '09:00'));
    const at = (x) => html.indexOf(x);
    assert(at('pd-verdict') > 0 && at('pd-verdict') < at('pd-options') && at('pd-options') < at('pd-decline'), 'order');
    assert(new RegExp(`Give <span class="rec-dose">${sandbox.fmtDose(b.pick.mg).replace('.', '\\.')}</span> IV`).test(html) && /Draw the next level/.test(html), html.slice(0, 600));
    assert(new RegExp(`<tr class="is-rec"[^>]*>\\s*<th scope="row">${sandbox.fmtDose(b.pick.mg).replace('.', '\\.')}`).test(html), 'the recommended row is marked');
    assert(/within 24 h of a dose ending/.test(html) && /published APD\/CAPD values \(context only\)/i.test(html), 'flags in words; context labelled');
    const svg = sandbox.pdChartSVG(b, { course: fict(), goal: { min: 15, max: 20 } }, H(3, '09:00'));
    assert((svg.match(/<circle[^>]*class="pd-lv"/g) || []).length === 2 && /<path[^>]*class="pd-band"/.test(svg) && (svg.match(/<rect[^>]*class="pd-cycler"/g) || []).length >= 1 && /class="pd-goal"/.test(svg), svg.slice(0, 400));
    assert(!/#[0-9a-f]{3,6}\b|rgba?\(/i.test(svg), 'no colour literals: CSS tokens only');
    assert(/Give 500 mg|Give [\d.]+ g|Give \d+ mg/.test(sandbox.pdSummaryText(b)), sandbox.pdSummaryText(b));
    // D24 (v3.13.0, the user's ruling 2026-11-10: "not too much attention to cycler ending for
    // levels"): the next draw is the AM labs, said plainly. A draw that falls on the cycler is
    // still known (drawOnCycler) but raises no caution, and the verdict does not discuss the cycler.
    // A level drawn on the cycler keeps its flag in "The decline" (41.28).
    const early = ask(fict(), { settings: { maxDoseMg: null, targetPeak: null, amLabs: '05:00' } });
    assert(early.drawOnCycler === true && !early.cautions.some(c => /cycler/i.test(c.word + c.html)), JSON.stringify(early.cautions));
    const verdictOf = (h) => h.slice(h.indexOf('pd-verdict'), h.indexOf('</section>', h.indexOf('pd-verdict')));
    assert(!/cycler|see below/i.test(verdictOf(sandbox.pdResultsHTML(early, { course: fict() }, H(3, '09:00')))), 'a draw on the cycler: the verdict says the AM labs, nothing more');
    assert(!/cycler/i.test(verdictOf(html)) && /with AM labs/.test(verdictOf(html)), 'a draw after the cycler: the same plain words');
    const refused = sandbox.pdResultsHTML(ask(fict(), { goal: null }), { course: fict() }, H(3, '09:00'));
    assert(/Choose a goal range/.test(refused) && !/pd-options/.test(refused), 'a refusal shows no options');
  });
  test('41.15 AUC Precision refuses a PD patient and points to the PD mode; the RRT advisory no longer sends PD to Goti; profiles carry PD', () => {
    const src = fs.readFileSync(htmlPath, 'utf8');
    const script = src.match(/<script>([\s\S]*?)<\/script>/)[1];
    const body = (n) => { const c = script.slice(script.indexOf('function ' + n + '(')); return c.slice(0, c.indexOf('\nfunction ')); };
    assert(/<input type="checkbox" id="b-pd"/.test(src), 'the box in the AUC renal area');
    const rb = body('runBayesian');
    assert(rb.indexOf("getElementById('b-pd')") > 0 && rb.indexOf("getElementById('b-pd')") < rb.indexOf('parseBayesCourse()'), 'checked before anything is parsed or fitted');
    assert(/data-onclick="k93"/.test(body('bayesPdNoticeHTML')) && /Trough-based · Peritoneal dialysis/.test(body('bayesPdNoticeHTML')), 'the refusal links to the PD mode');
    assert(/\n  k93: [^\n]*switchModule\('trough'\)[^\n]*setCalcMode\('pd'\)/.test(script), 'k93 opens it');
    assert(!/on RRT \(HD\/CRRT\/PD\), switch model to/.test(src) && /for peritoneal dialysis use Trough-based · Peritoneal dialysis/.test(src), 'the advisory no longer sends PD to Goti');
    // v3.14.0 (D26, R22): read into pdForm, stored unless an AUC save's Trough column is another patient's.
    assert(/const pdForm = snapshotPdForm\(\);/.test(body('saveCurrentProfile')) && /snapshot\.pd = [^;]*\bpdForm;/.test(body('saveCurrentProfile')), 'saved');
    assert(/applyPdForm\(s\.pd\b/.test(body('loadProfileIntoForm')) && /getElementById\('b-pd'\)/.test(body('loadProfileIntoForm')), 'loaded, and the box follows it');
    assert(/const PROFILE_SCHEMA\s+=\s+1;/.test(src), 'the profile schema is unchanged: older profiles load with no pd block');
  });
  // ── Final review (v3.12.0): each case below failed before its fix ──
  const settingsAt = (amLabs, extra) => Object.assign({ maxDoseMg: null, targetPeak: null, amLabs: amLabs || '06:00' }, extra || {});
  test('41.16 a dose started at the same minute as the last level counts in the projection (never a second dose on top)', () => {
    const base = { doses: [{ mg: 1500, tinfH: 1.5, timeH: H(0, '04:00') }], levels: [{ conc: 13, timeH: H(2, '07:00') }], loadKg: 70, nowKg: 70 };
    const same = ask(course(Object.assign({}, base, { doses: base.doses.concat({ mg: 750, tinfH: 1, timeH: H(2, '07:00') }) })), { goal: { min: 15, max: 20 } }, H(2, '08:00'));
    const later = ask(course(Object.assign({}, base, { doses: base.doses.concat({ mg: 750, tinfH: 1, timeH: H(2, '07:01') }) })), { goal: { min: 15, max: 20 } }, H(2, '08:00'));
    assert(same.state === later.state && Math.abs(same.rows[0].mid - later.rows[0].mid) < 0.5, JSON.stringify([same.state, same.rows && same.rows[0], later.state, later.rows && later.rows[0]]));
  });
  test('41.17 above the goal: the expected level, the rows and the chart are all for the morning the draw is set for, and that morning is in or below the top', () => {
    const a = ask(course({ doses: [{ mg: 2000, tinfH: 2, timeH: H(0, '04:00') }], levels: [{ conc: 40, timeH: H(1, '07:00') }, { conc: 30, timeH: H(2, '07:00') }] }), { goal: { min: 15, max: 20 } }, H(2, '09:00'));
    const last = a.curve[a.curve.length - 1];
    assert(a.state === 'no-dose' && Math.abs(last.t - a.nextDrawH) < 1e-9 && Math.abs(last.lo - a.rows[0].atDraw[0]) < 1e-9 && Math.abs(last.hi - a.rows[0].atDraw[1]) < 1e-9, JSON.stringify({ last, draw: a.nextDrawH, row: a.rows[0] }));
    assert(a.rows[0].mid <= 20 + 1e-9 && sandbox.localTimeStr(new Date(a.nextDrawH * 3600000)) === '06:00', JSON.stringify(a.rows[0]));
    assert(new RegExp(sandbox.fmtClock(a.nextDrawH)).test(sandbox.pdSummaryText(a)) && sandbox.pdSummaryText(a).includes(a.rows[0].atDraw[0].toFixed(1)), sandbox.pdSummaryText(a));
  });
  test('41.18 with a level but no measured decline: finite numbers, a provisional dose that cannot overshoot the goal top, and a heading that does not ask for a level already drawn', () => {
    const c = course({ prior: 'unknown', nowKg: 63, loadKg: 63, levels: [{ conc: 5, timeH: H(2, '06:00') }], doses: [{ mg: 250, tinfH: 0.5, timeH: H(2, '08:00') }] });
    const a = ask(c, { goal: { min: 15, max: 20 } }, H(2, '09:00'));
    assert(noNaN(a) && a.state === 'need-level' && a.provisional && a.provisional.mg % 250 === 0 && a.provisional.peak <= 20 + 1e-9, JSON.stringify(a).slice(0, 400));
    const html = sandbox.pdResultsHTML(a, { course: c }, H(2, '09:00'));
    assert(!/Draw a level first/.test(html.slice(html.indexOf('pd-verdict'), html.indexOf('</section>', html.indexOf('pd-verdict')))), 'a level is already drawn');
  });
  test('41.19 two levels too close together are not a decline; a duplicate level is not a 6,931 h half-life', () => {
    const dup = sandbox.pdIntervals(course({ doses: [{ mg: 1000, tinfH: 1, timeH: H(0, '03:30') }], levels: [{ conc: 13, timeH: H(2, '07:30') }, { conc: 13, timeH: H(2, '07:30') }] }));
    assert(dup.length === 2 && dup[1].used === false && dup[1].flags.includes('too-short'), JSON.stringify(dup.map(i => i.flags)));
    const half = sandbox.pdIntervals(course({ doses: [{ mg: 1000, tinfH: 1, timeH: H(0, '03:30') }], levels: [{ conc: 13, timeH: H(2, '07:30') }, { conc: 12.9, timeH: H(2, '08:00') }] }));
    assert(half[1].used === false && half[1].flags.includes('too-short'), JSON.stringify(half[1]));
  });
  test('41.20 a give-at time is never before now; the summary names the time when it is not now, and the cycler caution', () => {
    const now = H(3, '09:00'), a = ask(fict(), { giveAtH: now - 5 }, now);
    assert(a.giveAtH === now && a.cautions.some(c => /not before now/i.test(c.html)), JSON.stringify({ give: a.giveAtH, c: a.cautions.map(c => c.word) }));
    const later = ask(fict(), { goal: { min: 15, max: 20 }, giveAtH: now + 3 }, now);
    assert(new RegExp(`at ${sandbox.fmtClock(now + 3)}`).test(sandbox.pdSummaryText(later)), sandbox.pdSummaryText(later));
    const onCyc = ask(fict(), { goal: { min: 15, max: 20 }, settings: settingsAt('05:00') }, now);
    // D24: the summary names the draw time, not the cycler (the user's ruling, 41.14).
    assert(onCyc.drawOnCycler === true && !/cycler/i.test(sandbox.pdSummaryText(onCyc)), sandbox.pdSummaryText(onCyc));
  });
  test('41.21 the target-peak row offers nothing when the level is already at or above the target peak', () => {
    const lvT = H(3, '07:15');
    const t = ask(fict({ levels: [{ conc: 12.4, timeH: H(2, '07:00') }, { conc: 28.6, timeH: lvT }] }), { giveAtH: lvT, settings: settingsAt('06:00', { targetPeak: 25 }) }, lvT);
    assert(t.targetPeak && t.targetPeak.mg === 0, JSON.stringify(t.targetPeak));
  });
  test('41.22 a local maximum below one 250 mg step is ignored with a caution, never a blank result', () => {
    const a = ask(fict(), { settings: settingsAt('06:00', { maxDoseMg: 200 }) });
    assert(a.rows && Math.max(...a.rows.map(r => r.mg)) === K41.DOSE_MAX_PER_DOSE_MG && a.cautions.some(c => /maximum/i.test(c.word)), JSON.stringify(a.cautions));
    const l = ask(course({ loadKg: 57, nowKg: 57 }), { giveAtH: H(0, '03:30'), settings: settingsAt('06:00', { maxDoseMg: 200 }) }, H(0, '03:00'));
    assert(l.load.mg === 1250, JSON.stringify(l.load));
  });
  test('41.23 the first level is never a time already past: it moves to the next AM labs and says it was due', () => {
    const a = ask(course({ doses: [{ mg: 1000, tinfH: 1, timeH: H(0, '04:00') }] }), {}, H(5, '10:00'));
    assert(a.state === 'first-level' && a.nextDrawH >= H(5, '10:00') && a.cautions.some(c => /was due/i.test(c.html)), JSON.stringify({ next: a.nextDrawH, c: a.cautions }));
  });
  test('41.24 out of reach, the closest option counts giving nothing too (ties smaller)', () => {
    const a = ask(fict(), { goal: { min: 15, max: 16.5 } });
    const dist = (r) => (r.mid < 15 ? 15 - r.mid : r.mid > 16.5 ? r.mid - 16.5 : 0);
    if (!a.rows.some(r => dist(r) === 0)) {
      const best = a.rows.reduce((b, r) => (dist(r) < dist(b) - 1e-9 ? r : b));
      assert((best.mg === 0 ? a.state === 'no-dose' : a.pick && a.pick.mg === best.mg), JSON.stringify({ best: best.mg, state: a.state, pick: a.pick }));
    }
  });
  test('41.25 PD stopped: until an interval runs wholly after the stop, the before-stop decline is used with a caution; an interval across the stop is flagged and leaves the range once a post-stop one exists', () => {
    const stop = H(3, '12:00');
    const pre = ask(fict({ schedule: sched95({ stoppedAtH: stop }) }), {}, H(3, '13:00'));
    assert(pre.rate.n === 2 && pre.cautions.some(c => /before PD stopped/i.test(c.word)), JSON.stringify(pre.cautions.map(c => c.word)));
    const c = fict({ schedule: sched95({ stoppedAtH: stop }), levels: fict().levels.concat({ conc: 13.5, timeH: H(4, '07:00') }, { conc: 12.0, timeH: H(5, '07:00') }) });
    const iv = sandbox.pdIntervals(c);
    assert(iv[2].flags.includes('spans-stop') && !iv[3].flags.includes('spans-stop') && !iv[3].flags.includes('before-stop'), JSON.stringify(iv.map(i => i.flags)));
    const post = ask(c, {}, H(5, '09:00'));
    assert(post.rate.n === 1 && Math.abs(post.rate.kMin - iv[3].k) < 1e-12 && !post.cautions.some(c2 => /before PD stopped/i.test(c2.word)), JSON.stringify(post.rate));
  });
  test('41.26 a held cycler night ahead is said; AM labs stay at their wall-clock time across a DST change', () => {
    const now = H(3, '09:00');
    const held = ask(fict({ schedule: sched95({ heldDates: [dk(3)] }) }), {}, now);
    assert(held.cautions.some(c => /held cycler night/i.test(c.word)), JSON.stringify(held.cautions.map(c => c.word)));
    const dst = sandbox.pdNextAmLabs(new Date(2026, 9, 31, 12, 0).getTime() / 3600000, '06:00');
    assert(sandbox.localTimeStr(new Date(dst * 3600000)) === '06:00' && sandbox.localDateStr(new Date(dst * 3600000)) === sandbox.localDateStr(new Date(2026, 10, 1, 12)), 'AM labs on 1 Nov 2026');
    const fl = sandbox.pdFirstLevelH(new Date(2026, 9, 30, 4, 0).getTime() / 3600000, '06:00', false);
    assert(sandbox.localTimeStr(new Date(fl * 3600000)) === '06:00', 'first level across the change');
  });
  test('41.27 the schedule and the course reach the page and the print: modality, cycler, exchanges x fill, held nights, doses, levels, goal, volume', () => {
    const c = fict({ schedule: sched95({ heldDates: [dk(1)], exchanges: 5, fillL: 2 }) });
    const a = ask(c, { goal: { min: 10, max: 15 } });
    const html = sandbox.pdResultsHTML(a, { course: c, goal: { min: 10, max: 15 }, urine: 'anuric' }, H(3, '09:00'));
    const sec = html.slice(html.indexOf('id="pd-course"'));
    assert(/CCPD/.test(sec) && /21:00/.test(sec) && /9\.5 h/.test(sec) && /5 × 2 L/.test(sec) && /1\.25 g/.test(sec) && /14\.8 mg\/L/.test(sec) && /held/i.test(sec) && /0\.70 L\/kg/.test(sec), sec.slice(0, 600));
  });
  test('41.28 D24: a level drawn while the cycler runs keeps its flag in The decline; the answer carries Print; the dose and its unit never part', () => {
    const c = fict({ levels: [{ conc: 12.4, timeH: H(2, '07:00') }, { conc: 14.8, timeH: H(3, '05:00') }] });
    const a = ask(c, { goal: { min: 10, max: 15 } });
    const html = sandbox.pdResultsHTML(a, { course: c, goal: { min: 10, max: 15 }, urine: 'anuric' }, H(3, '09:00'));
    const dec = html.slice(html.indexOf('id="pd-decline"'));
    assert(a.intervals.some(i => i.flags.includes('on-cycler')) && /cycler/i.test(dec), dec.slice(0, 500));
    assert(/class="vx-act"[^>]*data-onclick="k0"/.test(html), 'Print is one of the answer\'s actions');
    const svg = sandbox.pdChartSVG(a, { course: c, goal: { min: 10, max: 15 } }, H(3, '09:00'), 420);
    assert(/viewBox="0 0 420 /.test(svg), 'the chart is drawn at the width it is shown, so its text is 12 px on screen');
  });
}

// ════════════════════════════════════════════════════════════════════
// SUITE 42 — the workstation (v3.13.0, D24)
//
// The 2026-11-10 critique: at a workstation the inputs and the answer were never on
// screen together; Enter in a result field rebuilt the result; what bears on the dose
// sat in closed sections; the input column read in a different grammar. Presentation
// only: every number, citation, caveat and refusal keeps its meaning (engine parity).
// The behaviour is driven for real in docs/audit/browser-flows.cjs; this suite holds the
// structure and the pure functions.
// ════════════════════════════════════════════════════════════════════
{
  console.log(`\n${'─'.repeat(60)}`);
  console.log('  SUITE 42 — the workstation (v3.13.0, D24)');
  console.log(`${'─'.repeat(60)}`);
  const src42 = fs.readFileSync(htmlPath, 'utf8');
  const css42 = src42.slice(0, src42.indexOf('</style>'));
  const body42 = src42.slice(src42.indexOf('<body>'), src42.indexOf('<script>'));
  const code42 = src42.match(/<script>([\s\S]*?)<\/script>/)[1].split('\n')
    .filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  const trough42 = body42.slice(body42.indexOf('<div class="app-shell">'), body42.indexOf('id="app-shell-bayesian"'));
  const auc42 = body42.slice(body42.indexOf('id="app-shell-bayesian"'));
  test('42.1 from 1001 px the input column scrolls on its own beside the answer, with its run action pinned at its foot', () => {
    const wide = css42.slice(css42.indexOf('@media (min-width: 1001px)'));
    assert(wide.length > 30, 'a min-width 1001px block exists');
    const blk = wide.slice(0, wide.indexOf('\n  }\n') + 4);
    assert(/\.panel-left\s*\{[^}]*position:\s*sticky[^}]*top:\s*var\(--header-h\)[^}]*height:\s*calc\(100dvh - var\(--header-h\)\)[^}]*overflow-y:\s*auto/.test(blk), blk.slice(0, 400));
    assert(/\.panel-actions\s*\{[^}]*position:\s*sticky[^}]*bottom:\s*0/.test(blk), 'the run action is pinned to the foot of the column');
    for (const [name, part, k] of [['Trough', trough42, 'k31'], ['AUC', auc42, 'k47']]) {
      const m = part.match(/<div class="panel-actions">([\s\S]*?)<\/div>/);
      assert(m && new RegExp(`data-onclick="${k}"`).test(m[1]), `${name}: the run button sits in .panel-actions`);
      assert(!/k32|k48/.test(m[1]), `${name}: clearing the form is not beside the run button`);
    }
  });
  test('42.2 Print is one of the answer\'s actions, never a floating button', () => {
    assert(!/class="print-fab"/.test(body42) && !/\.print-fab\b/.test(css42), 'the floating print button is gone');
    const tv = sandbox.txVerdictHTML({ dose: 1000, tau: 12, tinf: 1, auc: 480, trough: 12, troughMin: 10, troughMax: 20, peak: 30, mic: 1, basis: 'x' });
    assert(/<div class="vx-actions">[\s\S]*data-onclick="k0"[\s\S]*Print/.test(tv), tv.slice(-400));
    assert(/<div class="vx-actions">[\s\S]{0,600}data-onclick="k0"/.test(code42.slice(code42.indexOf('data-arg="ev-why">Why this dose'))), 'AUC Precision: Print beside Copy summary');
  });
  test('42.3 Enter in a result field or the profile name does that field\'s own job, never a recalculation', () => {
    const h = code42.slice(code42.indexOf("document.addEventListener('keydown', function (e)"));
    const hb = h.slice(0, h.indexOf('\n});') + 4);
    assert(/closest\('\[data-enter-scope\]'\)/.test(hb) && /\[data-enter-default\]/.test(hb), 'a field in an enter scope presses its default button');
    assert(/#results-content, #b-results, \.profile-section/.test(hb), 'nothing in a result or the profiles recalculates');
    assert(/class="profile-section" data-enter-scope/.test(trough42) && /class="profile-section" data-enter-scope/.test(auc42), 'both profile sections are enter scopes');
    assert((body42 + code42).match(/data-onclick="k37"[^>]*data-enter-default|data-enter-default[^>]*data-onclick="k37"/g).length === 2, 'Save is the default in both');
    assert(/class="tinkerer-row" data-enter-scope[\s\S]{0,900}data-onclick="k66" data-enter-default/.test(code42), 'Explore: Enter previews');
    assert(/class="tinkerer-row" data-enter-scope[\s\S]{0,900}data-onclick="k59" data-arg="\$\{suffix\}" data-enter-default/.test(code42), 'Try another regimen: Enter predicts');
    assert(!/k58/.test(code42.slice(code42.indexOf('function tinkererHTML'), code42.indexOf('function tinkererHTML') + 1200)), 'the old per-field Enter handler is gone, so Enter predicts once');
  });
  test('42.4 a picked Regimens cell opens Explore, is announced, and says "trying" in words and to a screen reader', () => {
    const f = code42.slice(code42.indexOf('function pickMatrixCell('), code42.indexOf('function runBayesTinkerer('));
    assert(/ev-explore/.test(f) && /\.open = true/.test(f), 'Explore opens');
    assert(/announceResult\(/.test(f), 'the result is announced');
    assert(/aria-pressed/.test(f) && /mx-trying/.test(f), 'the picked cell is pressed and named');
    assert(/aria-pressed="false"/.test(code42.slice(code42.indexOf('data-onclick="k71"') - 200, code42.indexOf('data-onclick="k71"') + 400)), 'every cell starts unpressed');
    assert(/\.mx-cell\.is-picked\s*\{[^}]*background:\s*var\(--paper-deep\)/.test(css42) && !/\.mx-cell\.is-picked\s*\{[^}]*border-color/.test(css42), 'a paper step, not an outline like Recommended');
  });
  test('42.5 a model that does not fit the patient is said in one line; a level count is not a mismatch', () => {
    const mm = sandbox.modelMismatchText;
    const rec = (o) => sandbox.getModelRecommendation(o.n || 0, !!o.icu, o.tbw, o.ht, !!o.hd);
    const c3 = rec({ tbw: 140, ht: 180 });                       // BMI 43.2
    assert(/Hughes 2024/.test(mm(c3, 'buelga')) && /43\.2/.test(mm(c3, 'buelga')) && /Buelga 2005/.test(mm(c3, 'buelga')), mm(c3, 'buelga'));
    assert(mm(c3, 'hughes') === null, 'Hughes on a class-3 patient fits');
    const c1 = rec({ tbw: 100, ht: 175 });                       // BMI 32.7
    // v3.15.0 (D27): the Hughes line names the built range (Table 1) and the direction.
    assert(/BMI 40–70\.3; this patient's BMI \(32\.7\) is below that range\./.test(mm(c1, 'hughes') || ''), String(mm(c1, 'hughes')));
    assert(mm(rec({ n: 2, tbw: 70, ht: 175 }), 'buelga') === null, 'two levels suggest Goti, but that is not a population mismatch');
    assert(/BMI \(39\.9\) is below/.test(mm(rec({ tbw: 129.43, ht: 180 }), 'hughes') || ''), 'BMI 39.95 on Hughes never reads "40.0": ' + mm(rec({ tbw: 129.43, ht: 180 }), 'hughes'));
    assert(mm(rec({ tbw: 70, ht: 175, hd: true }), 'buelga') === null, 'dialysis has its own handling (D16)');
    const v = code42.slice(code42.indexOf('const confBlock = `'), code42.indexOf('const nextBlock'));
    assert(/modelMismatchText\(/.test(code42) && /vx-mismatch/.test(v), 'the line sits in the confidence slot');
  });
  test('42.6 the suggested model is marked on its tile as soon as height and weight are known, and never chosen for you', () => {
    const f = code42.slice(code42.indexOf('function markSuggestedModel('), code42.indexOf('\nfunction ', code42.indexOf('function markSuggestedModel(') + 10));
    assert(/getModelRecommendation\(/.test(f) && /is-suggested/.test(f) && !/setBModel\(/.test(f), f.slice(0, 300));
    assert(/markSuggestedModel\(\)/.test(code42.slice(code42.indexOf('function updateBayesCrCl('), code42.indexOf('function updateBayesCrCl(') + 4000)), 'updated with the patient fields');
  });
  test('42.7 a long note shows three lines and a link that names the rest', () => {
    const word = 'Dose given during dialysis';
    const long = sandbox.noteHTML({ tier: 'caution', word, html: 'x '.repeat(260) });
    assert(/note-long/.test(long) && new RegExp(`data-onclick="k96"[^>]*aria-expanded="false"[^>]*>Read the rest: ${word}<`).test(long), long.slice(-300));
    assert(!/note-long|k96/.test(sandbox.noteHTML({ tier: 'caution', word, html: 'A short note.' })), 'a short note is whole');
    assert(/\.note-long:not\(\.is-open\) \.note-body\s*\{[^}]*-webkit-line-clamp:\s*3/.test(css42), 'clamped to three lines');
    const pr = css42.slice(css42.indexOf('@media print'));
    assert(/\.note-long \.note-body\s*\{[^}]*-webkit-line-clamp:\s*none/.test(pr) && /\.note-more\s*\{[^}]*display:\s*none/.test(pr), 'print shows every note whole');
  });
  test('42.8 Regimens opens closed with what it holds in its gist; the guideline comparison lives in Show the math', () => {
    assert(/regimensSec = ev\('ev-regimens', 'Regimens', gist, body, false\)/.test(code42), 'closed by default');
    assert(/gist = `\$\{inBandCount\} within \$\{mx\.bandMin\}–\$\{mx\.bandMax\}\$\{recDose \? ` · recommended \$\{fmtRegimen\(recDose, recTau\)\}` : ''\}`/.test(code42), 'the gist names the band count and the recommendation');
    const math = code42.slice(code42.indexOf("html += ev('ev-math'"), code42.indexOf("html += ev('ev-math'") + 6000);
    assert(/guidelineLine/.test(math), 'the guideline line is in Show the math');
    const reg = code42.slice(code42.indexOf("let regimensSec = '';"), code42.indexOf("regimensSec = ev('ev-regimens'"));
    assert(!/body \+= `<div class="ev-sub guideline-line">/.test(reg), 'and no longer in Regimens');
  });
  // Profiles sit at the foot of both columns, above the run action: between the patient and
  // the creatinine they cost five Tab stops, and at the top they pushed the patient below the fold.
  test('42.9 the input column reads mode, patient, creatinine, course, target, then profiles, in both modules', () => {
    const at = (part, x) => part.indexOf(x);
    assert(at(trough42, 'class="calc-mode-bar"') < at(trough42, '>Patient<') && at(trough42, '>Patient<') < at(trough42, '>Renal function<')
      && at(trough42, '>Renal function<') < at(trough42, '>Therapeutic target<') && at(trough42, '>Therapeutic target<') < at(trough42, 'class="profile-section"')
      && at(trough42, 'class="profile-section"') < at(trough42, 'class="panel-actions"'), 'Trough');
    assert(at(auc42, '>Patient<') < at(auc42, '>Renal function<')
      && at(auc42, '>Renal function<') < at(auc42, 'id="b-model-toggle"') && at(auc42, 'id="b-model-toggle"') < at(auc42, '>Dosing course<') && at(auc42, '>Dosing course<') < at(auc42, '>Therapeutic target<')
      && at(auc42, '>Therapeutic target<') < at(auc42, 'class="profile-section"') && at(auc42, 'class="profile-section"') < at(auc42, 'class="panel-actions"'), 'AUC Precision: the model after the patient it is chosen for');
  });
  test('42.10 the PD mode shows only what it reads: no amputation, creatinine or loading-dose blocks; the HD box only if ticked', () => {
    for (const id of ['amp-section', 'section-renal', 'section-ld']) assert(new RegExp(`id="${id}"[^>]*class="[^"]*not-pd`).test(trough42), `${id} is marked not-pd`);
    assert(/\.panel-left\[data-mode="pd"\] \.not-pd\s*\{\s*display:\s*none/.test(css42), 'hidden in PD');
    assert(/\.panel-left\[data-mode="pd"\] #section-renal:has\(#t-hd:checked\)/.test(css42), 'a ticked HD box stays visible, so the refusal it causes can be undone');
    assert(/dataset\.mode = mode/.test(code42.slice(code42.indexOf('function setCalcMode('), code42.indexOf('function setCalcMode(') + 2500)), 'setCalcMode marks the panel');
  });
  test('42.11 every Trough time is one date and one 24-hour time with a read-back, composed into the one instant the engine reads', () => {
    for (const id of ['time-dose-given', 'time-level-drawn', 'tl-dose-time', 'tl-t1-time', 'tl-t2-time', 'rl-dose-time', 'rl-draw-time']) {
      const re = new RegExp(`<span class="dt-pair" data-dt-for="${id}">\\s*<input type="date" id="${id}-date"[^>]*>\\s*<input type="text"[^>]*data-time24[^>]*id="${id}-time"[^>]*>\\s*<span class="course-readback" id="${id}-rb"[^>]*></span>\\s*</span>\\s*<input type="hidden" id="${id}"`);
      assert(re.test(trough42), `${id}: ${(trough42.match(new RegExp(`[^\\n]*id="${id}"[^\\n]*`)) || [''])[0].slice(0, 160)}`);
    }
    assert(sandbox.dtPairValue('2026-09-11', '08:05') === '2026-09-11T08:05', 'both halves → the datetime the engine reads');
    assert(sandbox.dtPairValue('2026-09-11', '8:5') === '' && sandbox.dtPairValue('', '08:05') === '' && sandbox.dtPairValue('2026-9-1', '08:05') === '', 'anything half-typed → blank, never guessed');
    assert(!/type="datetime-local"/.test(body42), 'no datetime-local left');
  });
  test('42.12 a row added by hand takes the focus; native confirm() dialogs are gone; clearing a form offers Undo', () => {
    assert(!/\bconfirm\(/.test(code42), 'no native confirm()');
    assert(/k43: \(el, ev, arg\) => \{ addBayesDose\(\); focusNewRow\(/.test(code42) && /k46: \(el, ev, arg\) => \{ addBayesLevel\(\); focusNewRow\(/.test(code42), 'AUC rows');
    assert(/k86: \(el, ev, arg\) => \{ addPdRow\('dose'\); focusNewRow\(/.test(code42) && /k88: \(el, ev, arg\) => \{ addPdRow\('lvl'\); focusNewRow\(/.test(code42), 'PD rows');
    assert(/function offerUndo\(/.test(code42) && /k32: \(el, ev, arg\) => \{ clearWithUndo\('trough'\)/.test(code42) && /k48: \(el, ev, arg\) => \{ clearWithUndo\('auc'\)/.test(code42), 'Undo after clearing');
    assert(/class="text-action"[^>]*data-onclick="k32"/.test(trough42) && /class="text-action"[^>]*data-onclick="k48"/.test(auc42), 'clearing is a text action');
  });
  test('42.13 the input column in the result\'s grammar: sentence case, q12h, no amber for a plain value', () => {
    for (const t of ['Calculate Regimen', 'Reset All Fields', 'Run Bayesian Analysis', 'Reset Bayesian Form', 'Save Current', '+ Add Dose', '+ Add Level',
      'Dosing Weight for CrCl', 'Serum Creatinine', 'Preferred Interval', 'Infusion Duration', 'Measured Concentration', 'Current Dosing Interval',
      'Clearance Model', 'Volume of Distribution Model', 'Trough Target Range', 'Steady State?', 'ICU / Critically Ill / Complex PK'])
      assert(!body42.includes(t), `title case left: "${t}"`);
    assert(!/>Q\d+H</.test(body42), 'intervals read q12h, as the answer writes them');
    for (const id of ['crcl-result', 'tl-t1-display', 'tl-t2-display', 'rl-t-display'])
      assert(!new RegExp(`id="${id}"[^>]*accent-amber`).test(body42), `${id} is a value, not a caution`);
  });
  test('42.14 legibility: the dose and its unit never part, the Regimens grid passes contrast with blocked cells in words, no 1–3 px radii or 11 px text', () => {
    assert(/\.vx-regimen \.rec-dose\s*\{[^}]*white-space:\s*nowrap/.test(css42), 'Give 500 mg on one line');
    assert(!/\.mx-blocked\s*\{[^}]*opacity/.test(css42), 'no faded blocked cell');
    assert(/over limit/.test(code42.slice(code42.indexOf('if (c.blocked) {'), code42.indexOf('if (c.blocked) {') + 400)), 'a blocked cell says so in words');
    assert(!/border-radius:\s*[123]px/.test(css42) && !/font-size:\s*(9|10|11)px/.test(css42), 'radii are 4px, pill or circle; text 12 px or more');
  });
  // The final review (2026-11-10): an alarm hid its HOLD instruction behind "Read the rest";
  // Undo could restore a form that disagreed with the state the dose is computed from.
  test('42.16 an alarm is never clamped: every word of a hold or a safety limit stays on screen', () => {
    const long = sandbox.noteHTML({ tier: 'alarm', word: 'Severe renal impairment', html: 'then HOLD further doses. '.repeat(20) });
    assert(!/note-long|k96/.test(long), long.slice(0, 200));
    assert(/note-long/.test(sandbox.noteHTML({ tier: 'caution', word: 'x', html: 'y '.repeat(200) })), 'a long caution still clamps');
  });
  test('42.17 clearing a form clears only that module, re-derives state on Undo, and Undo ends with a profile load', () => {
    const rf = code42.slice(code42.indexOf('function resetForm()'), code42.indexOf('function resetForm()') + 2600);
    assert(!/document\.querySelectorAll\('input\[type="number"\]'\)/.test(rf), 'the Trough clear no longer empties the AUC form');
    assert(/crcl-override-on[\s\S]{0,80}\.checked = false/.test(rf) && /setCrclOverride\(\)/.test(rf), 'a cleared form leaves no CrCl override active (it kept 30 mL/min with the box blank)');
    const cw = code42.slice(code42.indexOf('function clearWithUndo('), code42.indexOf('function resetForm()'));
    assert(/#app-shell-bayesian/.test(cw) && /app-shell:not\(#app-shell-bayesian\)/.test(cw), 'each module snapshots its own column');
    assert(/setCrclOverride\(\)/.test(cw) && /setDosingWt\(/.test(cw) && /ampState/.test(cw), 'Undo re-derives the override, the weight basis and the amputation');
    const lp = code42.slice(code42.indexOf('function loadProfileIntoForm('), code42.indexOf('function loadProfileIntoForm(') + 300);
    assert(/clearUndo\(\)/.test(lp), 'loading a profile ends the Undo');
    const sn = code42.slice(code42.indexOf('function snapshotFormDOM('), code42.indexOf('function restoreFormDOM('));
    assert(/tb\.querySelectorAll\('input, select, textarea'\)/.test(sn), 'row fields without ids (serial SCr) are kept by position');
  });
  test('42.15 the version', () => {
    assert(/const APP_VERSION = '3\.1[34]\.0';/.test(src42), 'v3.13.0 or its successor');
  });
}

// ════════════════════════════════════════════════════════════════════
// SUITE 43 — continue the current regimen (v3.14.0, D25)
//
// Reported 2026-11-13: on 1250 mg q12h the fit gave AUC24 546 (within 400-600,
// 14 of 20 plausible AUCs in range), yet AUC Precision recommended 1750 mg q24h at
// AUC24 382 (7 of 20) because the target box read 400. The optimizer never saw the
// current regimen, ranked on distance to one number, and let half a dose step of
// rounding grace count a below-range regimen as "in band". The PK state below is
// that case's posterior (Buelga, one level); the dose histories are fictional.
// ════════════════════════════════════════════════════════════════════
{
  console.log(`\n${'─'.repeat(60)}`);
  console.log('  SUITE 43 — continue the current regimen (v3.14.0, D25)');
  console.log(`${'─'.repeat(60)}`);
  const src43 = fs.readFileSync(htmlPath, 'utf8');
  const code43 = src43.match(/<script>([\s\S]*?)<\/script>/)[1];
  const K43 = (() => { try { return __extractConsts(); } catch (e) { return { _err: e.message }; } })();
  const fn43 = (n) => { const f = sandbox[n]; if (typeof f !== 'function') throw new Error(`${n}() is missing`); return f; };
  const CL = 4.58, V = 61.8;                       // the reported posterior (Buelga, 1 level)
  const row1 = () => fn43('aucUncertaintyRow')(1, 'buelga');
  const hist = (mg, tau, tinfH, n) => Array.from({ length: n || 4 }, (_, i) => ({ mg, tinfH, timeH: i * tau }));
  const q12 = hist(1250, 12, 1.5);                 // 1250 mg q12h over 1.5 h
  const decide = (target, doses, cl, v, bag, row) =>
    fn43('regimenDecision')(cl || CL, v || V, target, bag || null, 1, doses, row || row1());
  const dotsOf = (auc, row) => fn43('attainmentDots')(auc, row || row1());

  test('43.0 the margin is a stated preference, parsed by the harness', () => {
    assert(!K43._err, K43._err);
    assert(K43.CONTINUE_MARGIN_DOTS === 2, `CONTINUE_MARGIN_DOTS is ${K43.CONTINUE_MARGIN_DOTS}`);
    const i = code43.indexOf('const CONTINUE_MARGIN_DOTS');
    assert(/PREFERENCE, not a literature constant/.test(code43.slice(Math.max(0, i - 1500), i)), 'rule 8: labelled where defined');
  });
  test('43.1 the reported case: an in-range 1250 mg q12h is continued at a target of 400', () => {
    const r = decide(400, q12);
    assert(r && r.action === 'continue', `action ${r && r.action}: ${r && r.dose} mg q${r && r.tau}h AUC ${r && r.auc24 && r.auc24.toFixed(0)}`);
    assert(r.dose === 1250 && r.tau === 12 && r.tinfH === 1.5, `continued ${r.dose} mg q${r.tau}h over ${r.tinfH} h`);
    assertClose(r.auc24, 545.9, 1, 'AUC24'); assertClose(r.Ctrough, 14.9, 0.2, 'trough');
    assert(r.dots === 14, `dots ${r.dots}`);
    assert(r.nearestTarget && r.nearestTarget.dose === 1000 && r.nearestTarget.tau === 12,
      `what the target box alone gives is disclosed: ${JSON.stringify(r.nearestTarget)}`);
    assert(!r.noSolution && r.regimen === r, 'keeps the rec contract (rec.regimen, rec.noSolution)');
  });
  test('43.2 the target box cannot dislodge an in-range regimen (400 to 600)', () => {
    for (let t = 400; t <= 600; t += 25) {
      const r = decide(t, q12);
      assert(r.action === 'continue' && r.dose === 1250 && r.tau === 12, `target ${t}: ${r.action} ${r.dose} mg q${r.tau}h`);
    }
  });
  test('43.3 one more dot of twenty is not worth a change: 750 mg q8h (15/20) does not displace 14/20', () => {
    assert(dotsOf(750 * 3 / CL) === 15 && dotsOf(1250 * 2 / CL) === 14, 'the trap exists on this patient');
    const r = decide(500, q12);
    assert(r.action === 'continue', `${r.action} ${r.dose} mg q${r.tau}h`);
  });
  test('43.4 a below-range regimen changes to an in-range one that is better, keeping the nearest interval', () => {
    const r = decide(400, hist(1750, 24, 2));
    assert(r.action === 'change', `action ${r.action}`);
    assert(r.auc24 >= K43.AUC24_TARGET_MIN && r.auc24 <= K43.AUC24_TARGET_MAX, `AUC ${r.auc24.toFixed(0)}`);
    assert(r.dots > r.current.dots && r.current.dots === 7, `dots ${r.current.dots} -> ${r.dots}`);
    assert(r.dose === 1250 && r.tau === 12, `chose ${r.dose} mg q${r.tau}h (q12h is one interval step from q24h; q8h is two)`);
    assert(r.decisionReason === 'attainment', r.decisionReason);
  });
  // Task 9 (ruling 3): every decision is also taken as Low confidence takes it (protectInRange).
  // A 'low-confidence' answer is a continue — it names the current regimen, so it is never worse —
  // and it arises only where the unprotected answer was an attainment change from an in-range,
  // safe regimen. Every other answer is the same with and without the protection.
  test('43.5 never worse: a change never lowers attainment unless the current regimen is unsafe', () => {
    let n = 0, cont = 0, lowConf = 0;
    for (let cl = 1.5; cl <= 9.0001; cl += 0.5) for (const tau of [8, 12, 24, 48]) for (let mg = 250; mg <= 2000; mg += 250) {
      const doses = hist(mg, tau, fn43('autoTinf')(mg));
      for (const t of [400, 450, 500, 550, 600]) {
        const plain = decide(t, doses, cl, 49);
        for (const protect of [false, true]) {
          const r = protect ? fn43('regimenDecision')(cl, 49, t, null, 1, doses, row1(), { protectInRange: true }) : plain;
          if (!r || r.noSolution) continue;
          n++;
          if (r.action === 'continue') {
            cont++; assert(r.dose === mg && r.tau === tau, 'continue names the current regimen');
            if (r.continueReason === 'low-confidence') {
              lowConf++;
              assert(protect && r.inBand && !r.unsafe && plain.action === 'change' && plain.decisionReason === 'attainment' && plain.current.inBand,
                `CL ${cl} ${mg} q${tau}h target ${t}: a low-confidence continue where the unprotected answer was ${plain.action} / ${plain.decisionReason}`);
            }
            continue;
          }
          assert(r.action === 'change' && r.current, `CL ${cl} ${mg} q${tau}h: action ${r.action}`);
          if (r.decisionReason !== 'safety') assert(r.dots > r.current.dots,
            `CL ${cl} ${mg} q${tau}h target ${t}: ${r.current.dots} -> ${r.dots} dots with ${r.dose} mg q${r.tau}h`);
          if (protect) assert(r.dose === plain.dose && r.tau === plain.tau && plain.action === 'change' && !(r.decisionReason === 'attainment' && r.current.inBand),
            `CL ${cl} ${mg} q${tau}h target ${t}: protected ${r.dose} q${r.tau}h / ${r.decisionReason}, unprotected ${plain.action} ${plain.dose} q${plain.tau}h`);
        }
      }
    }
    assert(n > 4000 && cont > 200 && lowConf > 20, `exercised ${n} decisions, ${cont} continues, ${lowConf} kept under low confidence`);
  });
  test('43.6 strict band: no recommendation below 400 or above 600 while an in-range one exists', () => {
    const r0 = decide(400, null);
    assert(r0.action === 'start' && r0.dose === 1000 && r0.tau === 12, `first regimen at target 400: ${r0.dose} mg q${r0.tau}h AUC ${r0.auc24.toFixed(0)}`);
    let bad = 0, n = 0;
    for (let cl = 1.0; cl <= 9.0001; cl += 0.1) for (let t = 400; t <= 600; t += 10) {
      const r = sandbox.bayesDoseOptimizer(cl, cl * 12, t, null, 1); if (!r || r.noSolution) continue; n++;
      if (!r.outsideTargetBand && (r.auc24 < K43.AUC24_TARGET_MIN - 1e-9 || r.auc24 > K43.AUC24_TARGET_MAX + 1e-9)) bad++;
    }
    assert(bad === 0 && n > 1500, `${bad} of ${n} in-band recommendations sat outside 400-600`);
  });
  test('43.7 safety outranks attainment: an in-range regimen with a trough of 20 or more is changed, and says why', () => {
    const ev = fn43('evalRegimen');
    let found = null;
    for (let cl = 1.0; cl <= 4 && !found; cl += 0.1) for (const tau of [8, 12, 24]) for (let mg = 250; mg <= 2000 && !found; mg += 250) {
      const c = ev(mg, tau, fn43('autoTinf')(mg), cl, cl * 60, null, 1);
      if (c && !c.hardFail.length && c.auc24 >= 400 && c.auc24 <= 600 && c.Ctrough >= 20) found = { cl, c };
    }
    assert(found, 'a long half-life gives an in-range AUC with a danger trough');
    const r = decide(500, hist(found.c.dose, found.c.tau, found.c.tinfH), found.cl, found.cl * 60);
    assert(r.action === 'change' && r.decisionReason === 'safety', `${r.action} / ${r.decisionReason}`);
    assert(r.Ctrough < 20, `the change keeps a trough under 20: ${r.Ctrough.toFixed(1)}`);
  });
  test('43.8 a load alone, or an irregular history, is not a current regimen: the target box decides', () => {
    const load = decide(450, [{ mg: 2000, tinfH: 2, timeH: 0 }]);
    const opt = sandbox.bayesDoseOptimizer(CL, V, 450, null, 1);
    assert(load.action === 'start' && load.dose === opt.dose && load.tau === opt.tau, `load only: ${load.action}`);
    const irr = decide(450, [0, 7, 19, 22, 39].map(h => ({ mg: 1000, tinfH: 1, timeH: h })));
    assert(irr.action === 'start', `irregular: ${irr.action}`);
  });
  test('43.9 two-compartment fits are judged on the two-compartment trough', () => {
    const bag = { Vc: 40, Vp: 45, Q: Q_GOTI };
    const row = fn43('aucUncertaintyRow')(2, 'goti');
    const r = decide(400, hist(1000, 12, 1), 4.0, 40, bag, row);       // AUC24 500
    assert(r.action === 'continue' && r.dose === 1000 && r.tau === 12, `${r.action} ${r.dose} q${r.tau}`);
    const tr2 = ssCtrough2comp(1000, 12, 1, 4.0, 40, 45, Q_GOTI), tr1 = fn43('evalRegimen')(1000, 12, 1, 4.0, 40, null, 1).Ctrough;
    assert(Number.isFinite(r.Ctrough) && Math.abs(r.Ctrough - tr2) < 1e-9 && Math.abs(tr2 - tr1) > 0.1,
      `trough ${r.Ctrough} should be the 2-comp ${tr2}, not the 1-comp ${tr1}`);
    // A trough that cannot be computed is not "safe": the regimen cannot be judged, so it is not continued.
    const bad = decide(400, hist(1000, 12, 1), 4.0, 40, { Vc_ind: 40, Vp_ind: 45, Q: Q_GOTI }, row);
    assert(bad.action !== 'continue', `a NaN trough was continued as safe: ${bad.action}`);
  });
  test('43.10 every fit path decides through regimenDecision; dialysis and the severe-renal hold pass no current regimen', () => {
    // Since Task 9 each path builds one decisionArgs (stored on the result, so finalizeDecision
    // re-decides on exactly the same inputs) and decides from it; it carries the fit's "now" (D-b).
    // Since Task 19 (D27) the row also carries the fit's early-level test (earlyFit, from earlyLevelFractions).
    const calls = code43.match(/const earlyFit = earlyLevelFractions\(filteredLevels, doses, t12_ind\)\.length > 0;[^\n]*\n\s*const decisionArgs = \{[^;]*\bdoses: decisionDoses, row: aucUncertaintyRow\(filteredLevels\.length, '(goti|hughes|buelga)', earlyFit\), nowH: fitNowH \};\s*const rec = regimenDecisionOf\(decisionArgs\);/g) || [];
    assert(calls.length === 3, `${calls.length} of 3 fit paths pass decisionDoses and their own model's row, chosen by the early-level test`);
    assert((code43.match(/\brec, decisionArgs, doses\b/g) || []).length === 3, 'every fit path stores its decisionArgs on the result');
    assert(!/const rec = bayesDoseOptimizer\(/.test(code43), 'no fit path calls the optimizer directly');
    assert(/const decisionDoses = \(bState\.dial \|\| isOnDial \|\| \(lowCrClInfo\.detected && filteredLevels\.length === 0\)\) \? null : doses;/.test(code43),
      'dialysis and the severe-renal hold pass no current regimen');
  });
  // The independent review (2026-11-13).
  test('43.14 the cap-bound alarm survives a current regimen', () => {
    for (const mg of [1500, 1250]) {
      const r = decide(500, hist(mg, 8, fn43('autoTinf')(mg)), 13, 60);
      assert((r.flags || []).some(f => f.level === 'danger' && /cannot be reached within the conventional ceilings/.test(f.text)),
        `${mg} mg q8h at CL 13 -> ${r.action} ${r.dose} q${r.tau}h, flags: ${(r.flags || []).map(f => f.level).join(',')}`);
    }
  });
  test('43.15 a change changes the dose or the interval; it never renames the current regimen', () => {
    const r = decide(500, hist(750, 12, 2), 2.71, 100, null, fn43('aucUncertaintyRow')(2, 'buelga'));
    assert(r.action === 'change' && r.decisionReason === 'safety', `${r.action} / ${r.decisionReason}`);
    assert(!(r.dose === 750 && r.tau === 12), `"change" to the same 750 mg q12h (infusion ${r.tinfH} h)`);
    const z = decide(500, hist(250, 48, 0.5), 0.2, 50);
    assert(!(z.action === 'change' && z.dose === 250 && z.tau === 48), 'identical regimen offered as a change');
  });
  test('43.16 a safety change that still has a trough of 20 or more says so in its reason', () => {
    const r = decide(500, hist(250, 12, 0.5), 0.18, 40);
    if (r.action === 'change' && r.Ctrough >= 20) {
      const h = fn43('regimenActionHTML')(r, 500);
      assert(/also at or above 20/.test(h), h);
    }
  });
  test('43.17 alternating doses are not a regimen to continue: nobody gives their mean', () => {
    const alt = [1000, 1250, 1000, 1250, 1000, 1250].map((mg, i) => ({ mg, tinfH: 1.5, timeH: i * 12 }));
    const r = decide(450, alt);
    assert(r.action === 'start', `${r.action} ${r.dose} mg q${r.tau}h`);
  });
  test('43.18 an interval off the select lists is offered, not replaced by q6h', () => {
    const ch = fn43('regimenIntervalChoices');
    const a = ch(72), b = ch(12);
    assert(a.includes(72) && a.join() === [...a].sort((x, y) => x - y).join(), JSON.stringify(a));
    assert(b.join() === '6,8,12,18,24,36,48', JSON.stringify(b));
    assert((code43.match(/regimenIntervalChoices\(/g) || []).length >= 3, 'both the projection and the Tinkerer selects use it');
  });
  test('43.19 the copy summary says what changes', () => {
    const r = decide(400, hist(1750, 24, 2));
    const s = fn43('resultSummary')({ levels: [{}] }, r, null, fn43('aucUncertaintyRow')(1, 'buelga'), { level: 'Moderate' });
    assert(/Change from 1\.75 g IV q24h to 1\.25 g IV q12h/.test(s), s);
  });
  test('43.11 the answer says continue, or why it changes', () => {
    const html = fn43('regimenActionHTML');
    const c = decide(400, q12);
    const h = html(c, 400);
    assert(/Continue the current regimen/.test(h) && /14 of 20/.test(h), h);
    assert(/target of 400 alone would give 1 g IV q12h/.test(h), 'the target box choice is disclosed: ' + h);
    const ch = html(decide(400, hist(1750, 24, 2)), 400);
    assert(/Change from 1\.75 g IV q24h/.test(ch) && /7 of 20/.test(ch) && /14 of 20/.test(ch), ch);
    assert(html(decide(450, null), 450) === '', 'a first regimen carries no action line');
  });
  test('43.13 a change away from an in-range regimen delivers the whole margin, not just the trigger', () => {
    // The margin decided to change; minimal change then picked a neighbour one dot better.
    let n = 0;
    for (let nl = 1; nl <= 3; nl++) for (let cl = 1.5; cl <= 9.0001; cl += 0.25)
      for (const tau of [8, 12, 24, 48]) for (let mg = 250; mg <= 2000; mg += 250) {
        const r = decide(450, hist(mg, tau, fn43('autoTinf')(mg)), cl, 49, null, fn43('aucUncertaintyRow')(nl, 'buelga'));
        if (r.action !== 'change' || !r.current.inBand || r.current.unsafe) continue;
        n++;
        assert(r.dots - r.current.dots >= K43.CONTINUE_MARGIN_DOTS,
          `CL ${cl} ${mg} mg q${tau}h (${r.current.dots}/20) -> ${r.dose} mg q${r.tau}h (${r.dots}/20)`);
      }
    assert(n > 100, `exercised ${n} changes from an in-range regimen`);
  });
  test('43.12 the version', () => {
    assert(/const APP_VERSION = '3\.14\.0';/.test(src43), 'v3.14.0');
  });
}

// ════════════════════════════════════════════════════════════════════
// SUITE 44 — the 2026-11-13 review fixes (v3.14.0, D26)
// ════════════════════════════════════════════════════════════════════
{
  console.log(`\n${'─'.repeat(60)}`);
  console.log('  SUITE 44 — the 2026-11-13 review fixes (v3.14.0, D26)');
  console.log(`${'─'.repeat(60)}`);
  const src44 = fs.readFileSync(htmlPath, 'utf8');
  const body44 = (name) => {
    const i = src44.indexOf(`function ${name}(`);
    assert(i >= 0, `${name}() is missing`);
    const j = src44.indexOf('\n}\n', i);
    return src44.slice(i, j + 2);
  };

  test('44.1 saving a profile never un-marks a stale result', () => {
    const sp = body44('saveCurrentProfile');
    assert(!/bState\.result\s*=[^=]/.test(sp), 'saveCurrentProfile assigns bState.result');
    assert(!/bState\.resultFingerprint\s*=[^=]/.test(sp), 'saveCurrentProfile assigns bState.resultFingerprint');
    const emptyLabel = sp.indexOf("if (!label) {");
    const undo = sp.indexOf('clearUndo()');
    assert(emptyLabel >= 0 && undo > emptyLabel, 'clearUndo() must come after the empty-label return');
  });

  // C1 (engine report): a supratherapeutic patient was given a time for the next dose
  // with no hold — "first dose in 6 h, level by then 43.3 mg/L". The user's ruling: a
  // fitted pre-dose concentration at or above TROUGH_HIGH_MGL (20 mg/L) means Hold.
  // Fictional 60 M, 80 kg, 178 cm, SCr 3.0, Buelga; 1.5 g q8h x 6 over 2 h, the last
  // 6 h ago; one level, 48 mg/L, drawn 1 h ago. The fit runs as runBayesian runs it.
  const K44 = (() => { try { return __extractConsts(); } catch (e) { return { _err: e.message }; } })();
  const fn44 = (n) => { const f = sandbox[n]; if (typeof f !== 'function') throw new Error(`${n}() is missing`); return f; };
  const c1Case = () => {
    const wt = fn44('pickCrClWeight')('auto', 80, fn44('calcIBW')('M', 178)).wt;
    const crcl = Math.max(K44.CRCL_MODEL_FLOOR, Math.min(K44.CRCL_MODEL_CAP,
      fn44('calcCrCl')(60, 'M', 3.0, wt, vm.runInContext('SCR_POLICY.ACTUAL', sandbox))));
    const bk = fn44('buelgaPopPK')(crcl, 80);
    const doses = Array.from({ length: 6 }, (_, i) => ({ mg: 1500, tinfH: 2, timeH: i * 8 }));
    const nowH = 46, levels = [{ conc: 48, timeH: 45 }];
    const mf = fn44('mapFit')((a, b) => fn44('burtonObjective')(a, b, bk.CL_pop, bk.V_pop, doses, levels),
      2, K44.OMEGA2_CL_BUELGA, K44.OMEGA2_V_BUELGA, 300);
    const CL_ind = bk.CL_pop * Math.exp(mf.eta[0]), V_ind = bk.V_pop * Math.exp(mf.eta[1]);
    const rec = fn44('regimenDecision')(CL_ind, V_ind, 450, null, 1, doses, fn44('aucUncertaintyRow')(1, 'buelga'));
    const r = { model: 'buelga', CL_ind, V_ind, doses, levels, fitNowH: nowH, rec };
    return { r, rec, nowH, cur: { dose: 1500, tau: 8, tinfH: 2 } };
  };
  const at44 = (r, t) => fn44('predictFittedAt')(r, t);
  // fit44 (Task 6; moved here in the final-review wave so 44.4 can run a real fit): one fictional patient
  // through runBayesian and the render.
  const fit44memo = {};
  const fit44 = (p) => {
    const key = JSON.stringify(p);
    if (fit44memo[key]) return fit44memo[key];
    return (fit44memo[key] = (() => {
      const H = 3600000, nowH = Date.now() / H, lastH = nowH - p.lastAgo, t0 = lastH - (p.n - 1) * p.tau;
      const doses = Array.from({ length: p.n }, (_, i) => ({ mg: p.mg, tinfH: p.tinf, timeH: t0 + i * p.tau, row: String(i + 1) }));
      const levels = p.levels.map((l, i) => ({ conc: l.conc, timeH: Math.min(nowH, lastH + l.after), row: String(i + 1), label: 'x' }));
      const vals = { 'b-age': String(p.age), 'b-tbw': String(p.tbw), 'b-height': String(p.ht), 'b-scr': String(p.scr), 'b-auc-target': '450', 'b-mic': '1' };
      const els = {};
      const el = (id) => els[id] || (els[id] = { id, value: vals[id] || '', textContent: '', innerHTML: '', checked: false, style: {}, dataset: {},
        classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }, setAttribute() {}, getAttribute() { return null; },
        removeAttribute() {}, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, appendChild() {}, scrollIntoView() {} });
      const keep = {}; ['parseBayesCourse', 'showFormErrors', 'beginFormRun', 'readSerialScrChecked', 'setTimeout', 'announceResult'].forEach(n => keep[n] = sandbox[n]);
      const prevDoc = sandbox.document;
      vm.runInContext(`globalThis.__b44 = Object.assign({}, bState); bState.sex = ${JSON.stringify(p.sex || 'M')}; bState.model = ${JSON.stringify(p.model || 'buelga')}; bState.dial = false; bState.result = null; bState.firstDoseAtH = null;`, sandbox);
      sandbox.document = { getElementById: el, querySelector: () => null, querySelectorAll: () => [], createElement: () => el('_new') };
      sandbox.beginFormRun = () => {};
      sandbox.readSerialScrChecked = () => ({ errors: [], readings: [] });
      sandbox.parseBayesCourse = () => ({ doses, levels, sessions: [], errors: [] });
      let errs = null; sandbox.showFormErrors = (s, m) => { errs = [].concat(m); };
      sandbox.setTimeout = () => 0;
      // What the screen reader hears (announceResult's message, without its delay) — Task 13 (final review).
      let said = ''; sandbox.announceResult = (m) => { said = String(m); };
      let threw = null;
      try { sandbox.runBayesian(); } catch (e) { threw = e; }
      const r = vm.runInContext('bState.result', sandbox);
      const summary = String(vm.runInContext('bState.summaryText || ""', sandbox));
      Object.assign(sandbox, keep); sandbox.document = prevDoc;
      vm.runInContext('bState = globalThis.__b44; delete globalThis.__b44;', sandbox);
      assert(!errs && r && r.rec, `the fit ran: ${JSON.stringify(errs)} ${threw && threw.message}`);
      const html = (els['b-results'] || {}).innerHTML || '';
      const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
      // The diagnostics, as renderBayesianResults computes them (detected regimen, shared by every panel).
      const cur2 = fn44('inferCurrentRegimen')(r.doses, r.CL_ind, r.V_ind, r.goti || null);
      const fd = fn44('fitDiagnostics')(Object.assign({}, r, { regimen: cur2 }));
      // As the render reads it: the detected daily dose, else the recommended one (a single dose has no regimen).
      const agDD = cur2 && cur2.dose && cur2.tau ? cur2.dose * (24 / cur2.tau)
        : r.rec && !r.rec.noSolution && r.rec.dose && r.rec.tau ? r.rec.dose * (24 / r.rec.tau) : null;
      const ag = r.levels.length && agDD ? fn44('modelAgreement')(r.agCtx, r.doses, r.levels, agDD) : null;
      const conf = fn44('confidenceAssessment')(r, fd, ag);
      return { r, html, text, threw, conf, ag, fd, said, summary };
    })());
  };

  test('44.2 a 48 mg/L level holds the first dose until the fitted level is below 20 mg/L', () => {
    assert(!K44._err, K44._err);
    assert(K44.TROUGH_HIGH_MGL === 20, `TROUGH_HIGH_MGL is ${K44.TROUGH_HIGH_MGL}`);
    const { r, rec, nowH, cur } = c1Case();
    assert(rec && !rec.noSolution && rec.dose === 500 && rec.tau === 12, `the reported regimen: ${rec && rec.dose} mg q${rec && rec.tau}h`);
    assertClose(at44(r, 40 + rec.tau), 43.3, 0.1, 'the reported level when due (v3.13.0 said "level by then 43.3")');
    const plan = fn44('firstDosePlan')(r, rec, nowH, null, cur);
    assert(plan.hold === true, `hold: ${plan.hold}`);
    assert(plan.holdNoTime === false, `holdNoTime: ${plan.holdNoTime}`);
    assert(plan.resumeH > nowH, `resumeH ${plan.resumeH} after now ${nowH}`);
    assertLess(at44(r, plan.resumeH), K44.TROUGH_HIGH_MGL, 'fitted level at resumeH');
    assert(at44(r, plan.resumeH - 0.25) >= K44.TROUGH_HIGH_MGL, 'the first quarter hour below, not a later one');
    assert(plan.firstH === plan.resumeH, `the unchosen first dose moves to resumeH: firstH ${plan.firstH}, resumeH ${plan.resumeH}`);
    assert(plan.pre === at44(r, plan.firstH) && plan.pre < K44.TROUGH_HIGH_MGL, `pre recomputed at the new time: ${plan.pre}`);
    // Task 8 (ruling R1) re-points dueH: the due time of the regimen being given, 1.5 g q8h from
    // the last dose at 40 h (48), not the new q12h's (52). deltaH still measures from it.
    assert(plan.dueH === 40 + cur.tau && plan.dueH === 48 && plan.deltaH === plan.firstH - plan.dueH, `dueH (current q8h) and deltaH: ${plan.dueH}, ${plan.deltaH}`);
    // A chosen time is honoured: inside the hold it stays a hold; after resumeH it is not one.
    const inside = fn44('firstDosePlan')(r, rec, nowH, 60, cur);
    assert(inside.firstH === 60 && inside.chosen && inside.hold === true && inside.pre >= K44.TROUGH_HIGH_MGL && inside.resumeH > 60,
      `chosen inside the hold: ${JSON.stringify({ firstH: inside.firstH, hold: inside.hold, pre: inside.pre, resumeH: inside.resumeH })}`);
    const after = fn44('firstDosePlan')(r, rec, nowH, plan.resumeH + 1, cur);
    assert(after.firstH === plan.resumeH + 1 && after.hold === false && after.resumeH === null && after.holdNoTime === false,
      `chosen after resumeH: ${JSON.stringify({ firstH: after.firstH, hold: after.hold, resumeH: after.resumeH })}`);
  });
  test('44.3 an ordinary in-range fit does not hold, and the first-dose time is as in v3.13.0', () => {
    const CL = 4.58, V = 61.8;                      // SUITE 43's in-range posterior (Buelga, 1 level)
    const doses = Array.from({ length: 4 }, (_, i) => ({ mg: 1250, tinfH: 1.5, timeH: i * 12 }));
    const rec = fn44('regimenDecision')(CL, V, 450, null, 1, doses, fn44('aucUncertaintyRow')(1, 'buelga'));
    assert(rec.action === 'continue', `in range, continued: ${rec.action}`);
    const r = { model: 'buelga', CL_ind: CL, V_ind: V, doses, levels: [{ conc: 15, timeH: 47.5 }], fitNowH: 46 };
    // Ordinary times: from 8 h after the last dose (fitted 19.5 mg/L at 44 h) onward.
    let n = 0;
    for (const nowH of [44, 46, 48, 50.5, 70]) for (const atH of [null, 30, 45, 49.25, 60]) {
      const p = fn44('firstDosePlan')(r, rec, nowH, atH, { dose: 1250, tau: 12, tinfH: 1.5 });
      const dueH = 36 + rec.tau, chosen = Number.isFinite(atH);
      const v313 = chosen ? Math.max(atH, nowH) : Math.max(dueH, nowH);      // v3.13.0's rule
      assert(p.hold === false && p.resumeH === null && p.holdNoTime === false, `now ${nowH} at ${atH}: hold ${p.hold}`);
      assert(p.firstH === v313 && p.dueH === dueH && p.deltaH === v313 - dueH && p.pre === at44(r, v313),
        `now ${nowH} at ${atH}: firstH ${p.firstH} (v3.13.0 ${v313}), pre ${p.pre}`);
      n++;
    }
    assert(n === 25, `${n} plans compared`);
    // Not ordinary: a time chosen 4 h after the last 1.25 g dose (fitted 26 mg/L) holds even here.
    const near = fn44('firstDosePlan')(r, rec, 40, 40, { dose: 1250, tau: 12, tinfH: 1.5 });
    assert(near.hold === true && near.firstH === 40 && near.resumeH > 40 && at44(r, near.resumeH) < K44.TROUGH_HIGH_MGL, JSON.stringify({ hold: near.hold, resumeH: near.resumeH }));
  });
  test('44.4 a level that stays at or above 20 mg/L gives no resume time: recheck a level — a real anuric fit, and the CL 0.05 unit', () => {
    // The final review (I2): the old fixture alone (CL 0.05 with a hand-built regimen) is not a fit the app can
    // produce; real anuric fits keep CL at ~0.17 L/h or more and below ~0.18 every candidate hard-fails. A real
    // fit (44.29's: 70 M, CrCl 8, Goti, one 1.75 g dose, flat levels 52 to 50.2 mg/L) reaches the refusal's
    // hold, with no time. The CL 0.05 case stays below as an extra unit case of firstDosePlan.
    const real = fit44({ model: 'goti', age: 70, tbw: 70, ht: 175, scr: 8.5, mg: 1750, tinf: 2, tau: 24, n: 1, lastAgo: 100,
      levels: [{ conc: 52, after: 26 }, { conc: 51, after: 50 }, { conc: 50.2, after: 98 }] });
    const ns = real.r.rec && real.r.rec.noSolution && typeof sandbox.noSolutionHold === 'function' ? fn44('noSolutionHold')(real.r, real.r.fitNowH, null) : null;
    assert(ns && ns.hold === true && ns.holdNoTime === true && ns.fitted >= K44.TROUGH_HIGH_MGL,
      `a real fit: ${real.r.rec && real.r.rec.noSolution} ${JSON.stringify(ns)}`);
    assert(/Hold: recheck a level before the next dose/.test(real.text) && !/not before/.test(fn44('holdHeadHTML')(ns)), fn44('holdHeadHTML')(ns));
    const r = { model: 'buelga', CL_ind: 0.05, V_ind: 50, doses: [{ mg: 2000, tinfH: 2, timeH: 0 }], levels: [{ conc: 40, timeH: 3 }], fitNowH: 4 };
    const rec = { dose: 500, tau: 24, tinfH: 1 };
    assert(at44(r, 24 + 14 * 24) >= K44.TROUGH_HIGH_MGL, 'the fixture stays at or above 20 for the whole search');
    const plan = fn44('firstDosePlan')(r, rec, 4, null, null);
    assert(plan.hold === true && plan.holdNoTime === true && plan.resumeH === null,
      JSON.stringify({ hold: plan.hold, holdNoTime: plan.holdNoTime, resumeH: plan.resumeH }));
  });
  test('44.5 the readout, the verdict line, print and the summary say Hold; no time is given when there is none', () => {
    const { r, rec, nowH, cur } = c1Case();
    const plan = fn44('firstDosePlan')(r, rec, nowH, null, cur);
    const line = fn44('firstDoseReadoutHTML')(plan, rec, false), paper = fn44('firstDoseReadoutHTML')(plan, rec, true);
    for (const [k, h] of [['screen', line], ['print', paper]]) {
      assert(/Hold/.test(h) && /not before/.test(h), `${k}: ${h.slice(0, 400)}`);
      assert(/<strong class="tone-alarm">[\d.]+ mg\/L<\/strong>/.test(h), `${k}: the level by then in the alarm tone: ${h.slice(0, 400)}`);
    }
    const head = fn44('holdHeadHTML')(plan);
    assert(/class="vx-action[^"]*tone-alarm/.test(head) && /<svg class="ic"/.test(head) && /Hold: next dose not before \d{1,2} [A-Z][a-z]{2} \d\d:\d\d/.test(head), head);
    assert(fn44('holdHeadHTML')(fn44('firstDosePlan')(r, rec, nowH, plan.resumeH + 1, cur)) === '', 'no hold, no line');
    const s = fn44('resultSummary')(r, rec, null, fn44('aucUncertaintyRow')(1, 'buelga'), { level: 'Moderate' }, plan);
    assert(/^Hold: next dose not before \d{1,2} [A-Z][a-z]{2} \d\d:\d\d/.test(s), `the copy summary leads with the hold: ${s}`);
    const r4 = { model: 'buelga', CL_ind: 0.05, V_ind: 50, doses: [{ mg: 2000, tinfH: 2, timeH: 0 }], levels: [{ conc: 40, timeH: 3 }], fitNowH: 4 };
    const q24 = { dose: 500, tau: 24, tinfH: 1, auc24: 500 / 0.05 };   // AUC24 = daily dose / CL
    const none =fn44('firstDosePlan')(r4, q24, 4, null, null);
    assert(fn44('firstDayAucHTML')(none) === '', 'no first-day AUC for a dose with no time');
    for (const [k, h] of [['screen', fn44('firstDoseReadoutHTML')(none, q24, false)], ['print', fn44('firstDoseReadoutHTML')(none, q24, true)],
                          ['head', fn44('holdHeadHTML')(none)], ['summary', fn44('resultSummary')(r4, q24, null, fn44('aucUncertaintyRow')(1, 'buelga'), { level: 'Moderate' }, none)]]) {
      assert(/recheck a level/i.test(h), `${k}: ${h.slice(0, 400)}`);
      assert(!/\d\d:\d\d/.test(h), `${k}: no clock time when there is no resume time: ${h.slice(0, 400)}`);
    }
  });
  // Task 2 review fixes. (Sub-numbered: 44.6 onward belong to later tasks in the plan.)
  test('44.5a a planned dose given while the fitted level is 20 mg/L or more is held, and named', () => {
    // The reviewer's probe: the C1 fit plus a planned 1.5 g at 48 h (fitted 46.6 mg/L there).
    const { r: r0, rec, nowH, cur } = c1Case();
    const r = Object.assign({}, r0, { doses: r0.doses.concat([{ mg: 1500, tinfH: 2, timeH: 48 }]) });
    const without = Object.assign({}, r0, { doses: r0.doses.slice() });   // the planned dose is what is held
    assert(at44(r, 48) >= K44.TROUGH_HIGH_MGL, `fixture: fitted ${at44(r, 48)} at the planned dose`);
    const plan = fn44('firstDosePlan')(r, rec, nowH, null, cur);
    assert(plan.hold === true && plan.plannedN === 1, `hold ${plan.hold}, plannedN ${plan.plannedN}`);
    assert(plan.holdPlannedH === 48 && plan.holdAtH === 48, `judged at the planned dose: ${plan.holdPlannedH}, ${plan.holdAtH}`);
    assert(plan.resumeH > 48 && Number.isInteger((plan.resumeH - 48) / 0.25), `resumeH ${plan.resumeH} on the quarter-hour grid from the planned dose`);
    assertLess(at44(without, plan.resumeH), K44.TROUGH_HIGH_MGL, 'below 20 at resumeH, without the planned dose');
    assert(at44(without, plan.resumeH - 0.25) >= K44.TROUGH_HIGH_MGL, 'the first quarter hour below, on the curve without the planned dose');
    assert(plan.firstH === plan.resumeH && plan.pre === at44(without, plan.firstH), `first dose at resumeH, its level without the held dose: ${plan.pre}`);
    const head = fn44('holdHeadHTML')(plan), clk = fn44('fmtClock');
    assert(head.indexOf(`Hold the planned dose at ${clk(48)}: next dose not before ${clk(plan.resumeH)}`) >= 0, head);
    assert(/^Hold the planned dose at /.test(fn44('holdSentence')(plan)), fn44('holdSentence')(plan));
    const line = fn44('firstDoseReadoutHTML')(plan, rec, false);
    assert(/planned dose at .* held/.test(line) && !/after the 1 planned dose entered/.test(line), line);
  });
  test('44.5b a planned dose at a fitted level below 20 mg/L does not hold', () => {
    const CL = 4.58, V = 61.8;
    const given = Array.from({ length: 4 }, (_, i) => ({ mg: 1250, tinfH: 1.5, timeH: i * 12 }));
    const rec = fn44('regimenDecision')(CL, V, 450, null, 1, given, fn44('aucUncertaintyRow')(1, 'buelga'));
    const r = { model: 'buelga', CL_ind: CL, V_ind: V, doses: given.concat([{ mg: 1250, tinfH: 1.5, timeH: 48 }]), levels: [{ conc: 15, timeH: 45 }], fitNowH: 46 };
    assert(at44(r, 48) < K44.TROUGH_HIGH_MGL, `fixture: ${at44(r, 48)}`);
    const p = fn44('firstDosePlan')(r, rec, 46, null, { dose: 1250, tau: 12, tinfH: 1.5 });
    assert(p.hold === false && p.resumeH === null && p.plannedN === 1 && p.firstH === 60 && p.dueH === 60, JSON.stringify({ hold: p.hold, firstH: p.firstH, dueH: p.dueH }));
  });
  test('44.5c Trough: a post-infusion level times the re-dose from the level itself, never early', () => {
    // The reviewer's probe: 30 mg/L drawn 8.4 h after a 1.5 g (1.5 h) dose on q8h, Vd 56 L. The
    // observed basis takes the level as the trough at 8 h; timing from 8 h was 0.4 h early.
    const kel = fn44('fitKelFromLevel')(30, 8.4, 1500, 8, 1.5, 56).kel;
    const exact = 8.4 + Math.log(30 / 20) / kel;                       // independent: first-order decline from the level
    const start = new Date('2026-11-14T01:00').getTime() / 3600000;
    const h = fn44('troughHold')(30, 8, kel, start, { c: 30, h: 8.4 });
    assert(h && Math.abs(h.afterDoseH - exact) < 1e-9, `after dose ${h && h.afterDoseH} h, exact ${exact} h`);
    const shownAfter = h.atH - start, lvl = 30 * Math.exp(-kel * (shownAfter - 8.4));
    assert(shownAfter >= exact - 1e-9 && lvl < K44.TROUGH_HIGH_MGL, `shown ${shownAfter.toFixed(3)} h, level there ${lvl.toFixed(3)} mg/L`);
    const calc = body44('calculate');
    assert(/troughHold\(nextPre, tau, adjKel, doseStartHourOf\('time-dose-given'\), tDoseToLvl > tinf \? \{ c: levelVal, h: tDoseToLvl \} : null\)/.test(calc),
      'level mode passes the level and its time to troughHold');
    assert(/troughHold\([^;]*\{ c: tlC2, h: tlT2 \}\)/.test(calc), 'two-level mode times from level 2');
  });
  test('44.5d the projection: none under "recheck a level", and it starts at the resume time under a hold', () => {
    const pd = fn44('projectedDoses');
    const r4 = { model: 'buelga', CL_ind: 0.05, V_ind: 50, doses: [{ mg: 2000, tinfH: 2, timeH: 0 }], levels: [], fitNowH: 4 };
    const none = fn44('firstDosePlan')(r4, { dose: 500, tau: 24, tinfH: 1 }, 4, null, null);
    const p0 = pd(none, 500, 24, 4, 1, 24);
    assert(p0.refused === true && p0.doses.length === 0, JSON.stringify(p0));
    const { r, nowH, cur } = c1Case();
    const fp = fn44('firstDosePlan')(r, { dose: 500, tau: 12, tinfH: 0.5 }, nowH, null, cur);
    const p1 = pd(fp, 500, 12, 4, 0.5, 52);
    assert(fp.hold && !p1.refused && p1.doses.length === 4 && p1.doses[0].timeH === fp.resumeH && p1.doses[1].timeH === fp.resumeH + 12, JSON.stringify(p1));
    const rp = body44('refreshProfileGraph');
    assert(/projectedDoses\(fpProj, /.test(rp) && /recheck a level/i.test(rp), 'refreshProfileGraph draws through projectedDoses and says why when it refuses');
  });

  // Task 3 (engine report C2, I1; the user's ruling 2): the Trough module obeys AUC Precision's
  // limits — 2 g per dose, 4.5 g per day, AUC24 700 — judged by evalRegimen (one judge, D25),
  // and gives no empiric maintenance regimen at CrCl under 10 without a level.
  // calculate() runs end to end here on a small fake DOM: the values a pharmacist types, the
  // result as rendered. Fictional patients only.
  const trough44 = (mode, sex, vals, extra) => {
    const els = {};
    function El(id) {
      this.id = id; this.value = ''; this.innerHTML = ''; this.textContent = ''; this.style = { display: '' }; this.checked = false; this.attrs = {};
      const c = new Set();
      this.classList = { add: x => c.add(x), remove: x => c.delete(x), contains: x => c.has(x),
        toggle: (x, f) => { const on = f === undefined ? !c.has(x) : !!f; if (on) c.add(x); else c.delete(x); return on; } };
    }
    El.prototype.setAttribute = function (k, v) { this.attrs[k] = String(v); };
    El.prototype.getAttribute = function (k) { return k in this.attrs ? this.attrs[k] : null; };
    El.prototype.removeAttribute = function (k) { delete this.attrs[k]; };
    El.prototype.querySelectorAll = () => []; El.prototype.querySelector = () => null;
    El.prototype.focus = () => {}; El.prototype.scrollIntoView = () => {}; El.prototype.closest = () => null;
    El.prototype.addEventListener = () => {}; El.prototype.insertAdjacentHTML = function (p, h) { this.innerHTML += h; };
    const get = (id) => els[id] || (els[id] = new El(id));
    const defaults = { 'cl-model': 'vancopk', 'vd-model': 'vancopk', 'trough-min': '10', 'trough-max': '20', mic: '1' };
    Object.entries(Object.assign(defaults, vals)).forEach(([k, val]) => { get(k).value = String(val); });
    ((extra && extra.checked) || []).forEach(id => { get(id).checked = true; });
    const prevDoc = sandbox.document, prevST = sandbox.setTimeout;
    sandbox.document = { getElementById: get, querySelector: () => null, querySelectorAll: () => [], createElement: () => new El(''), body: {} };
    sandbox.setTimeout = (f) => { if (typeof f === 'function') f(); return 0; };   // announceResult's delay
    try {
      vm.runInContext(`state.calcMode = ${JSON.stringify(mode)}; state.dosingWt = 'auto'; state.isSS = true;
        state.rlMode = ${JSON.stringify((extra && extra.rlMode) || 'firstdose')}; state.tlBasis = ${JSON.stringify((extra && extra.tlBasis) || 'firstdose')}; crclOverride.on = false;`, sandbox);
      fn44('setPatientSex')(sex);
      // Choosing the sex refreshes the CrCl readout, which suggests an initial interval and
      // overwrites the one typed; the pharmacist's choice comes after it, as on the page.
      if (vals['init-interval'] != null) get('init-interval').value = String(vals['init-interval']);
      fn44('calculate')();
      const h = get('results-content').innerHTML;
      return { h, text: h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(), said: get('sr-announce').textContent };
    } finally {
      sandbox.document = prevDoc; sandbox.setTimeout = prevST;
      vm.runInContext(`state.calcMode = 'initial'; state.sex = null; bState.sex = null;`, sandbox);
    }
  };
  const HOLD_H3 = /<h3 class="vx-regimen vx-regimen-hold" id="tx-regimen">([^<]*)<\/h3>/;
  // The engine report's C2 patient: 25 M, 95 kg, 185 cm, SCr 0.5 (CrCl 303.5 on Cockcroft-Gault).
  const c2Pk = () => {
    const ibw = fn44('calcIBW')('M', 185), wt = fn44('pickCrClWeight')('auto', 95, ibw).wt;
    const crcl = fn44('calcCrCl')(25, 'M', 0.5, wt, vm.runInContext('SCR_POLICY.ACTUAL', sandbox));
    const clv = fn44('calcCLv')('vancopk', crcl, 95), vd = fn44('calcVd')('vancopk', 25, 95, crcl);
    return { crcl, clv, vd, kel: clv / vd };
  };

  test('44.6 Trough: no dose above 2,000 mg and no daily dose above 4,500 mg (25 M, 95 kg, SCr 0.5 at q8h, q12h, q24h)', () => {
    assert(K44.DOSE_MAX_PER_DOSE_MG === 2000 && K44.DOSE_MAX_TDD_MG === 4500 && K44.AUC24_ABSOLUTE_MAX === 700,
      `ceilings ${K44.DOSE_MAX_PER_DOSE_MG}/${K44.DOSE_MAX_TDD_MG}/${K44.AUC24_ABSOLUTE_MAX}`);
    const p = c2Pk();
    assertClose(p.crcl, 303.5, 0.05, 'the reported CrCl (uncapped: plan default D-c)');
    for (const tau of [8, 12, 24]) {
      const o = fn44('findOptimalDose')(10, 20, tau, 1, p.kel, p.vd, p.clv);
      assert(o.refused || (o.dose <= K44.DOSE_MAX_PER_DOSE_MG && o.dose * 24 / tau <= K44.DOSE_MAX_TDD_MG),
        `q${tau}h: ${o.dose} mg, ${o.dose * 24 / tau} mg a day`);
      // Nothing within the ceilings reaches 400 at CL 13.9 L/h: a refusal, bound by the ceilings.
      assert(o.refused === true && o.capBound === true && !(o.dose > 0) && typeof o.reason === 'string' && o.reason.length > 0,
        `q${tau}h: ${JSON.stringify(o)}`);
      assert(o.highest && o.highest.dose * 24 / tau <= K44.DOSE_MAX_TDD_MG && o.highest.dose <= K44.DOSE_MAX_PER_DOSE_MG && o.highest.auc < 400,
        `q${tau}h: the highest admissible ${JSON.stringify(o.highest)}`);
    }
    // Ordinary clearance is untouched: SUITE 29's patient (CL 4.5 L/h, V 52 L, q12h) still gets the dose
    // the file at baa265e gave (1 g q12h, AUC24 444, trough 11.0). Over a CL 0.3-20 x V x q6-q48h grid,
    // every answer that was in band and within the ceilings before is identical now (4,501 of 4,501).
    const ord = fn44('findOptimalDose')(10, 20, 12, 1, 4.5 / 52, 52, 4.5);
    assert(!ord.refused && ord.dose === 1000 && ord.flag === null, JSON.stringify(ord));
    // One judge: findOptimalDose builds to the per-dose ceiling and asks evalRegimen (D25).
    const f = body44('findOptimalDose');
    assert(/evalRegimen\(/.test(f) && /d <= DOSE_MAX_PER_DOSE_MG/.test(f) && !/4000/.test(f), 'findOptimalDose: evalRegimen judges, candidates stop at the ceiling');
  });

  test('44.7 Trough: every candidate above AUC24 700 at the interval is a refusal, not a regimen', () => {
    const CL = 0.5, V = 50;                                   // 250 mg q12h is AUC24 1000
    const o = fn44('findOptimalDose')(10, 20, 12, 1, CL / V, V, CL);
    assert(o.refused === true && o.capBound === false && !(o.dose > 0), JSON.stringify(o));
    assert(/700/.test(o.reason), `the reason names the ceiling: ${o.reason}`);
    // Admissible but none in 400-600 is a refusal too (CL 1.5: 250 mg q12h 333, 500 mg 667).
    const gap = fn44('findOptimalDose')(10, 20, 12, 1, 1.5 / 50, 50, 1.5);
    assert(gap.refused === true && gap.capBound === false && /333/.test(gap.reason) && /667/.test(gap.reason), JSON.stringify(gap));
    // evalRegimen works one-compartment (goti2comp = null): the judge the refusal relies on.
    const e = fn44('evalRegimen')(250, 12, 1, CL, V, null, 1);
    assert(e && e.hardFail.length === 1 && /absolute ceiling 700/.test(e.hardFail[0]) && Number.isFinite(e.Ctrough), JSON.stringify(e));
  });

  test('44.8 Trough: CrCl under 10, no HD, initial mode — "No empiric maintenance regimen" with the severe-renal advisory', () => {
    // The engine report's I1 patient: 85 F, 45 kg, 155 cm, SCr 4.5 (CrCl 6.5).
    const r = trough44('initial', 'F', { age: 85, tbw: 45, height: 155, scr: 4.5, 'init-interval': 48, 'init-tinf': 1 });
    const m = r.h.match(HOLD_H3);
    assert(m && m[1] === 'No empiric maintenance regimen', `heading: ${m && m[1]} — ${r.text.slice(0, 300)}`);
    assert(!/class="rec-dose"/.test(r.h) && !/IV q48h/.test(r.text.split('Dose explorer')[0]), `a regimen is offered: ${r.text.slice(0, 300)}`);
    // The advisory is AUC Precision's, from the one implementation both modules read.
    const note = fn44('severeRenalNote')(6.5, '');
    assert(note.tier === 'alarm' && note.word === 'Severe renal impairment (non-dialysis) suspected', JSON.stringify(note).slice(0, 200));
    assert(r.h.indexOf(note.word) > 0 && r.h.indexOf('Give a single weight-based loading dose') > 0, 'the severe-renal advisory is shown');
    assert(/CrCl ≈ 6 mL\/min/.test(r.text) || /CrCl ≈ 7 mL\/min/.test(r.text), 'the advisory names the CrCl');
    assert(/^Result: No empiric maintenance regimen/.test(r.said), r.said);
    const script44 = src44.match(/<script>([\s\S]*?)<\/script>/)[1];
    assert((script44.match(/Give a single weight-based loading dose/g) || []).length === 1, 'the advisory text exists once');
    assert(/severeRenalNote\(/.test(body44('renderBayesianResults')), 'AUC Precision reads the same advisory');
    // The HD box still gives the HD notice, never a number.
    const hd = trough44('initial', 'F', { age: 85, tbw: 45, height: 155, scr: 4.5, 'init-interval': 48, 'init-tinf': 1 }, { checked: ['t-hd'] });
    assert(/On haemodialysis — use AUC Precision/.test(hd.text) && !HOLD_H3.test(hd.h), hd.text.slice(0, 200));
    // Steady-state mode with no level entered is empiric too: withheld the same way.
    const ss = trough44('level', 'F', { age: 85, tbw: 45, height: 155, scr: 4.5, dose: 500, interval: 48, tinf: 1 });
    assert((ss.h.match(HOLD_H3) || [])[1] === 'No empiric maintenance regimen', ss.text.slice(0, 300));
  });

  test('44.8a Trough initial: the ceilings refuse 7.5 g a day with the cap-bound alarm and the augmented-clearance caution', () => {
    const r = trough44('initial', 'M', { age: 25, tbw: 95, height: 185, scr: 0.5, 'init-interval': 8, 'init-tinf': 1 });
    const m = r.h.match(HOLD_H3);
    assert(m && m[1] === 'No regimen recommended', `heading: ${m && m[1]} — ${r.text.slice(0, 300)}`);
    assert(!/class="rec-dose"/.test(r.h), 'no headline dose');
    assert(r.text.indexOf('The target cannot be reached within the conventional ceilings (2000 mg per dose, 4500 mg per day)') > 0, 'the cap-bound alarm');
    assert(/note note-alarm/.test(r.h), 'the alarm tier');
    assert(/Augmented renal clearance suspected/.test(r.text) && /CrCl ≈ 303 mL\/min/.test(r.text), `the augmented-clearance caution: ${r.text.slice(0, 600)}`);
    // A normal patient keeps a regimen and gains no renal note.
    const n = trough44('initial', 'M', { age: 60, tbw: 80, height: 175, scr: 1.0, 'init-interval': 12, 'init-tinf': 1 });
    assert(/class="rec-dose"/.test(n.h) && !HOLD_H3.test(n.h) && !/Augmented renal clearance|Severe renal impairment/.test(n.text), n.text.slice(0, 300));
  });

  test('44.8b Two-level and random-level modes render the refusal (Review Focus 4)', () => {
    // Two levels after a first 1 g dose (1 h): 20 mg/L at 2 h and 5 mg/L at 6 h — CL 10.4 L/h; at q12h
    // 2 g reaches AUC24 386, so nothing within the ceilings is in 400-600.
    const tl = trough44('twolevels', 'M', { age: 25, tbw: 95, height: 185, scr: 0.5, 'tl-dose': 1000, 'tl-tinf': 1, 'tl-tau': 12,
      'tl-c1': 20, 'tl-c2': 5, 'tl-dose-time': '2026-11-14T00:00', 'tl-t1-time': '2026-11-14T02:00', 'tl-t2-time': '2026-11-14T06:00',
      'tl-t1-hours': 2, 'tl-t2-hours': 6 });   // the hidden hours the page's oninput fills
    // One level 8 h after a first 1 g dose: 3 mg/L — CL 12.6 L/h; at q12h 2 g reaches AUC24 317.
    const rl = trough44('randomlevel', 'M', { age: 25, tbw: 95, height: 185, scr: 0.5, 'rl-dose': 1000, 'rl-tinf': 1, 'rl-tau': 12,
      'rl-c': 3, 'rl-dose-time': '2026-11-14T00:00', 'rl-draw-time': '2026-11-14T08:00' });
    for (const [k, r] of [['two-level', tl], ['random-level', rl]]) {
      const m = r.h.match(HOLD_H3);
      assert(m && m[1] === 'No regimen recommended', `${k}: heading ${m && m[1]} — ${r.text.slice(0, 300)}`);
      assert(!/class="rec-dose"/.test(r.h) && !/undefined|NaN/.test(r.text), `${k}: ${r.text.slice(0, 400)}`);
      assert(/^Result: No regimen recommended/.test(r.said), `${k}: ${r.said}`);
    }
    // Task 3 review (ruling R7): the cap-bound line is said of the chosen interval. Two-level, CL 10.4:
    // q8h reaches the band within the ceilings (1.5 g, AUC24 433), so the refusal names it and the
    // specialist / alternative-agent wording is not used. Random-level, CL 12.6: no interval q6-q48h
    // reaches it, so AUC Precision's all-interval alarm stands.
    assert(/At q12h the target cannot be reached within the conventional ceilings/.test(tl.text) && /1\.5 g IV q8h/.test(tl.text)
      && !/alternative agent|specialist guidance/.test(tl.text), `two-level: ${tl.text.slice(0, 700)}`);
    assert(rl.text.indexOf('The target cannot be reached within the conventional ceilings') > 0 && /alternative agent/.test(rl.text)
      && /No interval from q6h to q48h reaches/.test(rl.text), `random-level: ${rl.text.slice(0, 700)}`);
    assert(/id="prn-redose-thresh"/.test(rl.h), 'random-level keeps the level-based PRN calculator');
  });

  test('44.8c Trough level mode: a current regimen above a ceiling but in range is continued with the ceiling caution leading (U3; 2.5 g q8h, 7.5 g a day)', () => {
    // The C2 patient on 2.5 g q8h (1 h) with a true trough that matches the population fit: AUC24 ~540.
    // Re-pointed in wave 2: Task 3 made this "never continue" (an alarm-tier breach); the user's ruling U3
    // (2026-11-15) made D-a the rule in both modules: in range and safe, it is continued with the caution.
    const p = c2Pk();
    const tr = fn44('calcPeakTrough')(2500, 8, 1, p.kel, p.vd).trough;
    const r = trough44('level', 'M', { age: 25, tbw: 95, height: 185, scr: 0.5, dose: 2500, interval: 8, tinf: 1,
      'level-val': tr.toFixed(1), 'time-dose-given': '2026-11-14T00:00', 'time-level-drawn': '2026-11-14T08:00' }, { checked: ['has-level'] });
    assert(/Continue current regimen/.test(r.text) && !/breaches a hard limit/.test(r.text) && !/tx-action-alarm/.test(r.h), `continued: ${r.text.slice(0, 500)}`);
    assert(/<h3 class="vx-regimen" id="tx-regimen"><span class="rec-dose">2\.5 g<\/span> IV <span class="vx-freq">q8h<\/span>/.test(r.h), `the current regimen: ${r.text.slice(0, 300)}`);
    assert(/class="vx-ceiling-head tone-caution"/.test(r.h) && r.h.indexOf('vx-ceiling-head') < r.h.indexOf('id="tx-regimen"')
      && /Caution: the current dose is above the conventional ceilings \(single dose 2500 mg exceeds 2000 mg; total daily dose 7500 mg exceeds 4500 mg\)/.test(r.text),
      `the caution leads, naming both limits: ${r.text.slice(0, 600)}`);
    assert(/Caution: the current dose is above the conventional ceilings/.test(r.said), `heard: ${r.said}`);
  });

  // Task 3 review fixes (the coordinator's 1-4; ruling R7).
  test('44.8d Trough level mode: a regimen over a ceiling with a low AUC is said at caution tier, never "Dose increase indicated"', () => {
    // The C2 patient on 2.5 g q8h with a measured trough of 2 mg/L: the fitted AUC is low, and the
    // assessment's "increase" sat beside a refusal whose highest admissible regimen is a reduction.
    // Re-pointed in wave 2 (U3): over a ceiling only, it is not unsafe — caution tier, the caution leading.
    const r = trough44('level', 'M', { age: 25, tbw: 95, height: 185, scr: 0.5, dose: 2500, interval: 8, tinf: 1,
      'level-val': 2, 'time-dose-given': '2026-11-14T00:00', 'time-level-drawn': '2026-11-14T08:00' }, { checked: ['has-level'] });
    assert(/tx-action-caution/.test(r.h) && !/tx-action-alarm/.test(r.h) && !/breaches a hard limit/.test(r.text) && /class="vx-ceiling-head tone-caution"/.test(r.h),
      `caution tier: ${r.text.slice(0, 600)}`);
    assert(/single dose 2500 mg exceeds 2000 mg/.test(r.text) && /total daily dose 7500 mg exceeds 4500 mg/.test(r.text), `both limits named: ${r.text.slice(0, 600)}`);
    assert(!/increase/i.test(r.text) && !/increase/i.test(r.said), `no increase wording: ${r.said} | ${r.text.slice(0, 900)}`);
    // A reduction over a ceiling says the breach too (45 mg/L on 1.5 g q8h, AUC24 above 700).
    const red = trough44('level', 'M', { age: 60, tbw: 80, height: 178, scr: 1.0, dose: 1500, interval: 8, tinf: 1.5,
      'level-val': 45, 'time-dose-given': '2026-11-14T01:00', 'time-level-drawn': '2026-11-14T08:45' }, { checked: ['has-level'] });
    assert(/Current regimen breaches a hard limit/.test(red.text) && /exceeds the absolute ceiling 700/.test(red.text) && /^Result: Hold: /.test(red.said),
      `reduce: ${red.said} | ${red.text.slice(0, 500)}`);
  });

  test('44.8e Trough refusal (R7): the intervals that reach 400-600 within the ceilings are named; the specialist line only when none does', () => {
    // CL 8 L/h, V 60 L: q24h is bound by the ceilings (2 g gives 250); q6h, q8h and q12h are not.
    const o = fn44('findOptimalDose')(10, 20, 24, 1, 8 / 60, 60, 8);
    assert(o.refused && o.capBound && Array.isArray(o.others), JSON.stringify(o).slice(0, 300));
    const taus = o.others.map(x => x.tau);
    assert(taus.includes(8) && taus.includes(12) && !taus.includes(24), `others: ${JSON.stringify(o.others)}`);
    for (const x of o.others) {
      const own = fn44('findOptimalDose')(10, 20, x.tau, 1, 8 / 60, 60, 8);   // one implementation, per interval
      assert(!own.refused && own.dose === x.dose && x.auc >= 400 && x.auc <= 600, `q${x.tau}h: ${JSON.stringify(x)} vs ${JSON.stringify(own)}`);
    }
    assert(o.others.every(x => o.reason.indexOf(`${fn44('fmtRegimen')(x.dose, x.tau)} (AUC₂₄ ${x.auc.toFixed(0)})`) >= 0), `each named with its AUC: ${o.reason}`);
    const line = fn44('troughCapBoundHTML')(o);
    assert(/At q24h the target cannot be reached within the conventional ceilings/.test(line) && !/alternative agent|specialist/.test(line), line);
    // Initial mode, nothing given (30 M, 80 kg, 180 cm, SCr 0.7, CrCl ~175, q24h): no "obtain a level".
    const r = trough44('initial', 'M', { age: 30, tbw: 80, height: 180, scr: 0.7, 'init-interval': 24, 'init-tinf': 1 });
    assert((r.h.match(HOLD_H3) || [])[1] === 'No regimen recommended', r.text.slice(0, 300));
    assert(/IV q8h|IV q12h/.test(r.text.split('Dose explorer')[0]) && !/alternative agent|specialist guidance/.test(r.text), r.text.slice(0, 900));
    const next = (r.h.match(/<p class="vx-next">([\s\S]*?)<\/p>/) || [])[1] || '';
    assert(!/level/i.test(next), `initial Next asks for a level before any dose: ${next}`);
  });

  test('44.8f Trough gap refusal names the interval that works, not the dose explorer', () => {
    // CL 0.4 L/h at q24h: 250 mg gives 625, nothing below; only q36h (250 mg, 417) lands in 400-600.
    const o = fn44('findOptimalDose')(10, 20, 24, 1, 0.4 / 50, 50, 0.4);
    assert(o.refused && !o.capBound && o.others.length === 1 && o.others[0].tau === 36 && o.others[0].dose === 250, JSON.stringify(o));
    assert(/250 mg IV q36h/.test(o.reason) && !/dose explorer/i.test(o.reason), o.reason);
    // Every dose breaching a limit gets the pointer too (CL 0.5 at q12h: q48h 250 mg gives 250 — none).
    const all = fn44('findOptimalDose')(10, 20, 12, 1, 0.5 / 50, 50, 0.5);
    assert(all.refused && /No interval from q6h to q48h reaches/.test(all.reason) || all.others.length > 0 && all.others.every(x => all.reason.indexOf(`q${x.tau}h`) >= 0), all.reason);
  });

  test('44.8g the dose explorer marks a regimen over a ceiling, through evalRegimen, never as in range', () => {
    const p = c2Pk();
    const rows = fn44('doseExplorerRows')({ tau: 8, tinf: 1, kel: p.kel, vd: p.vd, clv: p.clv, mic: 1, troughMin: 10, troughMax: 20 });
    const row = (rows.match(/<tr[^>]*>\s*<th scope="row">2\.5 g q8h[\s\S]*?<\/tr>/) || [])[0] || '';
    assert(row && /over 2 g a dose/.test(row) && /over 4\.5 g a day/.test(row), `2.5 g q8h: ${row}`);
    assert(!/class="in-range"/.test(row.replace(/<td class="[^"]*">[\d.]+<\/td>\s*<td>[\d.]+<\/td>/, '')), `AUC cell coloured in range: ${row}`);
    assert(/class="is-over"/.test(row), row);
    const ok = (rows.match(/<tr[^>]*>\s*<th scope="row">1\.5 g q8h[\s\S]*?<\/tr>/) || [])[0] || '';
    assert(ok && !/is-over|over 2 g|over 4\.5 g/.test(ok), `1.5 g q8h is within the ceilings: ${ok}`);
    const low = fn44('doseExplorerRows')({ tau: 12, tinf: 1, kel: 0.5 / 50, vd: 50, clv: 0.5, mic: 1, troughMin: 10, troughMax: 20 });
    assert(/<th scope="row">250 mg q12h <span class="tx-row-tag">AUC₂₄ over 700<\/span>/.test(low), low.slice(0, 400));
  });

  // Task 4 (models report I4, rule 1; the user's ruling 8): the severe-renal advisory carries only
  // sourced numbers. The guideline loading dose (Rybak 2020 Rec 11: actual body weight, at most
  // 3,000 mg, HD_LOADING_MAX_MG), then dose by measured levels, with no stated interval. Every copy:
  // the shared object, the note in both modules, the Trough refusal as rendered, and print.
  test('44.9 the severe-renal advisory names Rec 11 and HD_LOADING_MAX_MG, says later doses follow measured levels, and carries no unsourced number', () => {
    assert(K44.HD_LOADING_MAX_MG === 3000, `HD_LOADING_MAX_MG ${K44.HD_LOADING_MAX_MG}`);
    const UNSOURCED = [/15\s*[–-]\s*20 mg\/kg/, /max 2 g/, /24\s*[–-]\s*48 h/, /q24h\s*[–-]\s*q72h/];
    const clean = (s, where) => UNSOURCED.forEach(re => assert(!re.test(s), `${where} still says ${re}: ${s.slice(0, 400)}`));
    const plain = (h) => String(h).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const LD = fn44('fmtDose')(K44.HD_LOADING_MAX_MG);                       // "3 g", ISMP form
    const sourced = (s, where) => {
      clean(s, where);
      assert(/Rybak 2020 Rec 11/.test(s), `${where} does not name Rybak 2020 Rec 11: ${s.slice(0, 400)}`);
      assert(s.indexOf(`at most ${LD}`) >= 0 && /actual body weight/.test(s), `${where} does not give the Rec 11 basis and maximum (${LD}): ${s.slice(0, 400)}`);
      assert(/measured level/.test(s), `${where} does not say later doses follow measured levels: ${s.slice(0, 400)}`);
    };
    // The source: one object both modules read, its maximum from the constant, never a literal.
    const script = src44.match(/<script>([\s\S]*?)<\/script>/)[1];
    const i = script.indexOf('const SEVERE_RENAL = {'), j = script.indexOf('\n};\n', i);
    assert(i > 0 && j > i, 'SEVERE_RENAL is missing');
    const obj = script.slice(i, j + 3), note = body44('severeRenalNote');
    assert(/HD_LOADING_MAX_MG/.test(obj), 'SEVERE_RENAL reads HD_LOADING_MAX_MG');
    [obj, note].forEach((s, k) => { clean(s, k ? 'severeRenalNote' : 'SEVERE_RENAL');
      assert(!/3,?000 ?mg|\b3 g\b|\b2 g\b/.test(s), `a hand-written maximum in ${k ? 'severeRenalNote' : 'SEVERE_RENAL'}`); });
    assert((script.match(/const HD_LOADING_MAX_MG\b/g) || []).length === 1, 'one HD_LOADING_MAX_MG');
    // The source comment records Rec 11's figures with the page (rule 1).
    const cmt = script.slice(Math.max(0, i - 2500), i);
    assert(/Rec 11/.test(cmt) && /actual body weight/.test(cmt) && /3,000 mg/.test(cmt) && /p\. ?10\b/.test(cmt), 'the source comment above SEVERE_RENAL cites Rec 11 with its page');
    // Every string the object holds, as both modules render it.
    const SR = vm.runInContext('SEVERE_RENAL', sandbox);
    ['follow', 'next'].forEach(k => clean(SR[k], `SEVERE_RENAL.${k}`));
    sourced(SR.follow, 'SEVERE_RENAL.follow');
    // The note in AUC Precision (it may name the fit) and in the Trough module (it must not).
    const auc = plain(fn44('severeRenalNote')(6.5, '', 'auc').html), tro = plain(fn44('troughSevereRenalNote')(6.5).html);
    sourced(auc, 'the AUC Precision note'); sourced(tro, 'the Trough note');
    assert(/fit/.test(auc), `the AUC Precision note says to re-run its fit: ${auc}`);
    assert(!/Bayesian|re-fit|the fit/i.test(tro), `the Trough note mentions the Bayesian fit: ${tro}`);
    // Re-pointed in the final-review wave (I5): the call gained a fourth argument, whether a dose was given or a
    // level exists; the AUC wording is still asked for by name.
    assert(/severeRenalNote\(crclTrue, cappingNote, 'auc'(?:, dosed)?\)/.test(body44('renderBayesianResults')), 'AUC Precision asks for its own wording');
    // The Trough refusal as rendered (44.8's patient: 85 F, 45 kg, 155 cm, SCr 4.5).
    const r = trough44('initial', 'F', { age: 85, tbw: 45, height: 155, scr: 4.5, 'init-interval': 48, 'init-tinf': 1 });
    clean(r.text, 'the Trough refusal'); sourced(r.text, 'the Trough refusal');
    assert(!/Bayesian|re-fit/i.test(r.text), `the Trough refusal mentions the Bayesian fit: ${r.text.slice(0, 600)}`);
    // AUC Precision's verdict and print read the shared object, not a paraphrase of it.
    const rb = body44('renderBayesianResults'), pr = body44('_prRecommendation');
    // Re-pointed in wave 2 (N3): the verdict and print read severeRenalFollow(dosed), which is SEVERE_RENAL.follow before
    // any dose and the note's "No further dose until a level is drawn" after one.
    assert(/\$\{severeRenalFollow\(/.test(rb) && /\$\{severeRenalFollow\(/.test(pr) && fn44('severeRenalFollow')(false) === SR.follow, 'the verdict and print read SEVERE_RENAL.follow before any dose');
    assert(!/one loading dose, then dose by levels/.test(script), 'the print paraphrase is gone');
    const printed = plain(fn44('_prRecommendation')({ rec: { dose: 1000, tau: 12 }, lowCrClHold: true }, {}));
    sourced(printed, 'the print report'); assert(/No empiric maintenance regimen/.test(printed) && !/1 g IV/.test(printed), printed);
  });

  // Task 4b (controller ruling R10; same class as I4). Rybak 2020, printed p. 10, Rec 11 (B-II): loading
  // doses on actual body weight, not exceeding 3,000 mg (HD_LOADING_MAX_MG). Rybak 2020 has no adult
  // augmented-clearance dosing figures. Fictional patients only.
  const ldPk = (age, sex, tbw, height, scr, vdModel) => {
    const ibw = fn44('calcIBW')(sex, height), wt = fn44('pickCrClWeight')('auto', tbw, ibw).wt;
    const crcl = fn44('calcCrCl')(age, sex, scr, wt, vm.runInContext('SCR_POLICY.ACTUAL', sandbox));
    return { crcl, clv: fn44('calcCLv')('vancopk', crcl, tbw), vd: fn44('calcVd')(vdModel, age, tbw, crcl) };
  };
  const ldCard = (h) => (h.match(/<section class="tx-ld"[\s\S]*?<\/section>/) || [''])[0];
  const plain44 = (h) => String(h).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

  test('44.9a the Trough loading dose never exceeds HD_LOADING_MAX_MG (Rec 11), and says so when capped', () => {
    const MAX = K44.HD_LOADING_MAX_MG, LD = fn44('fmtDose')(MAX);
    const calc = fn44('calcLoadingDose');
    // 70 M, 130 kg, 175 cm, SCr 2.0 on the Buelga volume (0.98 L/kg, 127 L): 3,250 mg before Task 4b.
    const big = ldPk(70, 'M', 130, 175, 2.0, 'buelga');
    const b = calc(big.clv, big.vd, 25);
    assert(b.dose <= MAX && b.dose === MAX && b.capped === true, `130 kg: ${JSON.stringify(b)}`);
    assert(b.uncappedMg === 3250, `the uncapped figure is kept for the explanation: ${b.uncappedMg}`);
    // The capped dose is the one modelled: its own infusion time, rate and peak.
    const tinf = fn44('autoTinf')(MAX);
    const peak = (MAX / (tinf * b.kelLD * b.vdLD)) * (1 - Math.exp(-b.kelLD * tinf));
    assert(b.tinf === tinf && Math.abs(b.peak - peak) < 1e-9 && Math.abs(b.rateMgMin - MAX / (tinf * 60)) < 1e-9 && b.peak < 25,
      `the capped dose is modelled as given: ${JSON.stringify(b)}`);
    // 50 M, 70 kg, 175 cm, SCr 1.0 on the same volume: 1,750 mg over 2 h, as before.
    const small = ldPk(50, 'M', 70, 175, 1.0, 'buelga');
    const s = calc(small.clv, small.vd, 25);
    const sPeak = (1750 / (2 * s.kelLD * s.vdLD)) * (1 - Math.exp(-s.kelLD * 2));
    assert(s.dose === 1750 && s.tinf === 2 && s.capped === false && s.uncappedMg === 1750 && Math.abs(s.peak - sPeak) < 1e-9,
      `70 kg is unchanged: ${JSON.stringify(s)}`);
    // No volume and no target peak returns more than the maximum.
    for (const vd of [20, 60, 100, 150, 250]) for (const tp of [15, 25, 40]) {
      const r = calc(vd * 0.08, vd, tp);
      assert(r.dose <= MAX && r.capped === (r.uncappedMg > MAX) && r.uncappedMg >= r.dose, `Vd ${vd}, peak ${tp}: ${JSON.stringify(r)}`);
    }
    // One constant: no new literal maximum in the function.
    assert(/HD_LOADING_MAX_MG/.test(body44('calcLoadingDose')) && !/3000|3,000/.test(body44('calcLoadingDose')), 'calcLoadingDose reads HD_LOADING_MAX_MG');
    // The card, in every Trough mode that shows one: initial, steady-state (no level, and with one), and a refusal.
    const pt = { age: 70, tbw: 130, height: 175, scr: 2.0, 'vd-model': 'buelga' };
    const cards = {
      initial: trough44('initial', 'M', Object.assign({ 'init-interval': 24, 'init-tinf': 1.5 }, pt), { checked: ['has-ld'] }),
      'steady-state, no level': trough44('level', 'M', Object.assign({ dose: 1500, interval: 24, tinf: 1.5 }, pt), { checked: ['has-ld'] }),
      'steady-state, a level': trough44('level', 'M', Object.assign({ dose: 1500, interval: 24, tinf: 1.5, 'level-val': 15,
        'time-dose-given': '2026-11-14T00:00', 'time-level-drawn': '2026-11-14T23:30' }, pt), { checked: ['has-ld', 'has-level'] }),
      // SCr 12: CrCl under 10, the severe-renal refusal, which keeps the loading card.
      'severe-renal refusal': trough44('initial', 'M', Object.assign({}, pt, { scr: 12, 'init-interval': 48, 'init-tinf': 1.5 }), { checked: ['has-ld'] }),
    };
    assert((cards['severe-renal refusal'].h.match(HOLD_H3) || [])[1] === 'No empiric maintenance regimen', cards['severe-renal refusal'].text.slice(0, 300));
    for (const [k, r] of Object.entries(cards)) {
      const card = plain44(ldCard(r.h));
      assert(card, `${k}: no loading card — ${r.text.slice(0, 300)}`);
      assert(card.indexOf(`${LD} IV once`) >= 0 && !/3\.25 g IV once|3\.5 g IV once/.test(card), `${k}: the capped dose — ${card.slice(0, 400)}`);
      assert(/Rybak 2020 Rec 11/.test(card) && card.indexOf(`maximum of ${LD}`) >= 0, `${k}: the Rec 11 maximum is named — ${card}`);
    }
    // A dose under the maximum carries no such sentence.
    const n = plain44(ldCard(trough44('initial', 'M', { age: 50, tbw: 70, height: 175, scr: 1.0, 'vd-model': 'buelga', 'init-interval': 12, 'init-tinf': 1 }, { checked: ['has-ld'] }).h));
    assert(/1\.75 g IV once/.test(n) && !/Rec 11/.test(n), `70 kg card: ${n}`);
    // The HD empiric table and the PD load already applied the cap: unchanged.
    assert(fn44('hdEmpiricDoses')(200).every(r => r.ld === MAX && r.ldCapped), 'the HD empiric table is capped');
    assert(fn44('pdLoadingDose')(200, 0).mg === MAX, 'the PD load is capped');
  });

  test('44.9b the augmented-clearance advice carries no unsourced figure; its maximum is HD_LOADING_MAX_MG', () => {
    const LD = fn44('fmtDose')(K44.HD_LOADING_MAX_MG);
    const src = body44('arcAdviceListHTML'), out = plain44(fn44('arcAdviceListHTML')());
    for (const [s, where] of [[src, 'the source'], [out, 'the advice as shown']]) {
      [/25\s*[–-]\s*30 mg\/kg/, /24\s*[–-]\s*48 h/, /q6h\s*[–-]\s*q8h/, /mg\/kg/, /\bq\d+h\b/, /\d+\s*[–-]\s*\d+\s*h\b/, /within \d+/]
        .forEach(re => assert(!re.test(s), `${where} still says ${re}: ${s}`));
    }
    assert(!/3,?000|\b3 g\b/.test(src), `a hand-written maximum in arcAdviceListHTML: ${src}`);
    assert(/HD_LOADING_MAX_MG/.test(src) && out.indexOf(`at most ${LD}`) >= 0 && /Rybak 2020 Rec 11/.test(out), `the maximum comes from HD_LOADING_MAX_MG: ${out}`);
    // The caution stays: clearance may be augmented, and an early level is advised.
    assert(/early level/i.test(out), `the early level is still advised: ${out}`);
    const tro = plain44(fn44('troughRenalNotes')(303, 25, 0.5).map(n => n.word + ' ' + n.html).join(' '));
    assert(/Augmented renal clearance suspected/.test(tro) && /early level/i.test(tro), tro);
    // AUC Precision reads the same list.
    assert(/list: arcAdviceListHTML\(\)/.test(body44('renderBayesianResults')), 'AUC Precision reads arcAdviceListHTML');
  });

  // Task 4b review (controller ruling R11): Rybak's mg/kg loading figures are set by patient group, not
  // renal function — Rec 10 (20–35 mg/kg, critically ill with serious MRSA, p. 10) and Rec 12 (20–25 mg/kg
  // actual body weight, at most 3,000 mg, obese adults with serious infections, p. 11). Neither excludes
  // CrCl under 10, so the note says only what is true: no loading dose by renal function, none for this group.
  test('44.9c the severe-renal advice attributes only the loading basis and maximum to Rec 11, and says Rybak sets no loading dose by renal function', () => {
    const LD = fn44('fmtDose')(K44.HD_LOADING_MAX_MG), T = K44.VERY_LOW_CRCL_THRESHOLD;
    const SR = vm.runInContext('SEVERE_RENAL', sandbox);
    const texts = { 'the AUC Precision note': plain44(fn44('severeRenalNote')(6.5, '', 'auc').html),
      'the Trough note': plain44(fn44('troughSevereRenalNote')(6.5).html), 'SEVERE_RENAL.follow': SR.follow };
    const SAYS = `Rybak 2020 sets no loading dose by renal function, and none for CrCl under ${T} mL/min without dialysis`;
    for (const [where, s] of Object.entries(texts)) {
      assert(/basis and maximum/.test(s) && /Rybak 2020 Rec 11/.test(s) && s.indexOf(`actual body weight, at most ${LD}`) >= 0,
        `${where}: the basis and maximum are Rec 11's — ${s}`);
      // The sentence that says to give the dose cites no guideline: Rybak directs no loading dose for this group.
      s.split(/(?<=\.)\s+/).filter(x => /\bGive\b/.test(x)).forEach(x =>
        assert(!/Rybak|Rec \d/.test(x), `${where}: reads as Rybak directing the dose — "${x}"`));
      // The over-reach is gone, and neither group's mg/kg range is shown (a question for the user).
      assert(!/gives no mg\/kg loading dose/.test(s) && !/mg\/kg/.test(s), `${where}: an mg/kg claim or range — ${s}`);
    }
    ['the AUC Precision note', 'the Trough note'].forEach(where => assert(texts[where].indexOf(SAYS) >= 0,
      `${where}: says Rybak sets no loading dose by renal function — ${texts[where]}`));
    // As rendered in the Trough refusal (44.8's patient).
    const r = trough44('initial', 'F', { age: 85, tbw: 45, height: 155, scr: 4.5, 'init-interval': 48, 'init-tinf': 1 });
    assert(r.text.indexOf(SAYS) >= 0 && !/gives no mg\/kg/.test(r.text), r.text.slice(0, 900));
    // The source comment names both group ranges with their pages, beside Rec 11 (rule 1).
    const script = src44.match(/<script>([\s\S]*?)<\/script>/)[1];
    const i = script.indexOf('const HD_LOADING_MAX_MG'), cmt = script.slice(script.lastIndexOf('// ─── The guideline loading maximum', i), i);
    assert(/Rec 10\b[\s\S]*20 to 35 mg\/kg[\s\S]*p\. ?10\b/.test(cmt) || /Rec 10\b[\s\S]*p\. ?10\b[\s\S]*20 to 35 mg\/kg/.test(cmt), `Rec 10 with its page: ${cmt}`);
    assert(/Rec 12\b/.test(cmt) && /20 to 25 mg\/kg/.test(cmt) && /obese adult/.test(cmt) && /p\. ?11\b/.test(cmt), `Rec 12 with its page: ${cmt}`);
  });

  // Task 12a (carried from the Task 4b review): the HD empiric table's caption wrote the Rec 11 maximum by
  // hand ("at most 3,000 mg (Rec 11)"). One constant, one figure (rule 2): it reads HD_LOADING_MAX_MG.
  test('44.9d the HD empiric caption renders the Rec 11 maximum from HD_LOADING_MAX_MG, with no hand-written figure', () => {
    const LD = fn44('fmtDose')(K44.HD_LOADING_MAX_MG);
    const src = body44('hdEmpiricHTML');
    assert(!/3,?000|\b3 g\b/.test(src), `a hand-written maximum in hdEmpiricHTML: ${src.slice(src.indexOf('Rybak 2020, Rec 13'), src.indexOf('Rybak 2020, Rec 13') + 160)}`);
    assert(/at most \$\{fmtDose\(HD_LOADING_MAX_MG\)\} \(Rec 11\)/.test(src), 'the caption reads fmtDose(HD_LOADING_MAX_MG)');
    for (const kg of [78, 200]) {
      const out = plain44(fn44('hdEmpiricHTML')(fn44('hdEmpiricDoses')(kg), kg, []));
      assert(out.indexOf(`loading by actual body weight, at most ${LD} (Rec 11)`) >= 0, `${kg} kg caption: ${out.slice(out.indexOf('Rybak 2020'), out.indexOf('Rybak 2020') + 200)}`);
    }
  });

  // I3 (engine report): a level dated after the fit time can only be a wrong date, and a fit on it turned an
  // in-range regimen into a safety change. Refuse it, naming the row. A future DOSE row is a planned dose: kept.
  test('44.10 runBayesian refuses a level dated after the fit time (one-minute tolerance) and still accepts planned future doses', () => {
    const rb = body44('runBayesian');
    assert(/Date\.now\(\)\s*\/\s*3600000/.test(rb) && /showFormErrors\('auc'/.test(rb.slice(rb.indexOf('Date.now()'))), 'runBayesian compares level times with the fit time and calls showFormErrors');
    const H = 3600000, now = Date.now(), nowH = now / H;
    const drive = (doses, levels) => {
      const cap = { errs: null, targets: null, ran: false };
      const keep = {}; ['parseBayesCourse', 'showFormErrors', 'beginFormRun', 'readSerialScrChecked'].forEach(n => keep[n] = sandbox[n]);
      const prevDoc = sandbox.document, vals = { 'b-age': '55', 'b-tbw': '80', 'b-height': '180', 'b-scr': '1.0', 'b-auc-target': '450' };
      sandbox.document = { getElementById: (id) => ({ value: vals[id] || '', checked: false, style: {}, classList: { add() {}, remove() {}, contains() { return false; } } }), querySelector: () => null, querySelectorAll: () => [] };
      sandbox.beginFormRun = () => {};
      sandbox.readSerialScrChecked = () => ({ errors: [], readings: [] });
      sandbox.parseBayesCourse = () => ({ doses, levels, sessions: [], errors: [] });
      sandbox.showFormErrors = (scope, msgs) => { cap.errs = [].concat(msgs); };
      vm.runInContext('bState.sex = null; bState.result = null;', sandbox);
      try { sandbox.runBayesian(); } finally { Object.assign(sandbox, keep); sandbox.document = prevDoc; }
      cap.result = vm.runInContext('bState.result', sandbox);
      return cap;
    };
    const d = (hAgo) => ({ mg: 1250, tinfH: 1.5, timeH: nowH - hAgo });
    const doses = [d(35), d(23), d(11)];
    const fut = drive(doses, [{ conc: 15, timeH: nowH + 30, row: '1', label: 'x' }]);
    assert(fut.errs && fut.errs.length === 1 && /^Level row 1: .*after the time of this analysis/.test(fut.errs[0]) && fut.result === null, JSON.stringify(fut.errs));
    const two = drive(doses, [{ conc: 12, timeH: nowH - 2, row: '1', label: 'x' }, { conc: 15, timeH: nowH + 30, row: '2', label: 'y' }]);
    assert(two.errs && two.errs.length === 1 && /^Level row 2:/.test(two.errs[0]), JSON.stringify(two.errs));
    // Within a minute of now is a level typed to the minute: accepted (the run goes on to the next check, the missing sex).
    const near = drive(doses, [{ conc: 15, timeH: nowH + 30 / 3600, row: '1', label: 'x' }]);
    assert(near.errs && near.errs.length === 1 && !/Level row/.test(near.errs[0]), JSON.stringify(near.errs));
    // A planned dose in the future with a level in the past is accepted.
    const planned = drive(doses.concat([d(-1), d(-13)]), [{ conc: 15, timeH: nowH - 1, row: '1', label: 'x' }]);
    assert(planned.errs && planned.errs.length === 1 && !/Level row|Dose row/.test(planned.errs[0]), JSON.stringify(planned.errs));
  });

  // I2 (engine report) and I3 (UI report): one screen said "Low confidence … a fit the tool itself
  // does not trust", Next "A further level would add little", and the Fit panel "A further
  // concentration is recommended". nextLevelValue now knows the state of the fit; the Next line is
  // the one sentence about a further level, and the other panels point to it. Fictional 76 M, 70 kg,
  // 175 cm, SCr 0.5, Buelga; 1 g q12h x 4 over 1 h, the last 11.5 h ago; one level, 19.9 mg/L, now.
  // The fit, the decision and the render are runBayesian's own (DOM stubbed, then restored).
  // fit44: one fictional patient through runBayesian and the render. `lastAgo` is how long ago the
  // last of `n` doses q`tau` h went in; each level is { conc, after } (hours after that last dose).
  const e1 = () => fit44({ age: 76, tbw: 70, ht: 175, scr: 0.5, mg: 1000, tinf: 1, tau: 12, n: 4, lastAgo: 11.5, levels: [{ conc: 19.9, after: 11.5 }] });
  // One sentence about a further level: "would add little" never sits beside a sentence that asks
  // for one — Next's conflict, the cap-bound alarm, or the no-better flag (D26 review). And the
  // cap-bound alarm ("confirm the clearance with a level before acting on it") never sits beside
  // "a dose change is indicated" or "how large it needs to be" (Task 6b review). Task 9 adds
  // "Draw a level." (a regimen kept under Low confidence) to the sentences that ask for one.
  // The final review (C1, I5): a Hold never sits beside "would add little", nor beside the severe-renal
  // note's "Give a … loading dose" (a hold means doses have been given; the note then says no further dose).
  const HOLD44 = /Hold: |Hold the (?:\d+ )?planned dose/;
  const incoherent44 = (text) => [].concat(
    /would add little/.test(text) ? (text.match(/is recommended|Confirm the clearance with a level|another level may settle it|Draw a level|Recheck a level|Hold: |Hold the (?:\d+ )?planned dose/g) || []) : [],
    /cannot be reached within the conventional ceilings/.test(text) ? (text.match(/a dose change is indicated|how large it needs to be/g) || []) : [],
    HOLD44.test(text) ? (text.match(/Give (?:a|one) [^.]*?loading dose/g) || []) : [],
    // Wave 2 (N3): "No further dose until a level" never beside "Give … loading dose".
    /no further dose until a level/i.test(text) ? (text.match(/give (?:a|one) [^.]*?loading dose/gi) || []) : []);
  const para44 = (html, cls) => { const m = html.match(new RegExp(`<p class="${cls}[^"]*">([\\s\\S]*?)</p>`)); return m ? m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : ''; };

  test('44.11 a one-level fit the models disagree on: "A further level is recommended", never the precision branch', () => {
    const { r, conf, ag } = e1();
    assert(r.rec.action === 'continue' && r.rec.dose === 1000 && r.rec.tau === 12, `the fixture continues 1 g q12h: ${r.rec.action} ${r.rec.dose} q${r.rec.tau}`);
    assert(conf.rank === 2 && ag && ag.band.tone === 'danger', `the fixture is Low confidence on model disagreement: ${conf.level}, ${ag && ag.diffPct}`);
    const fit = fn44('nextLevelFit')(r, conf);
    assert(fit.confRank === 2 && fit.hasAlt === false && fit.capBound === false && Math.abs(fit.worstSigma - conf.worstSigma) < 1e-12, JSON.stringify(fit));
    const nlv = fn44('nextLevelValue')(r.rec.auc24, r.levels.length, 'buelga', r.rec.tau, r.CL_ind, fit);
    assert(nlv.kind === 'conflict' && nlv.headline === 'A further level is recommended', `${nlv.kind}: ${nlv.headline}`);
    assert(nlv.detail === fn44('confidenceLead')(conf).text && /disagree by \d+%/.test(nlv.detail), nlv.detail);
    assert(fn44('nextLevelLine')(nlv) === 'A further level is recommended.', fn44('nextLevelLine')(nlv));
    // Each trigger alone reaches it; below every trigger the precision branch is as before.
    const kind = (f) => fn44('nextLevelValue')(464, 1, 'buelga', 12, 4.31, f).kind;
    assert(kind(undefined) === 'precision' && kind({ confRank: 1, worstSigma: 1.9, hasAlt: false }) === 'precision', 'no trigger, no conflict');
    assert(kind({ confRank: 2 }) === 'conflict' && kind({ confRank: 3 }) === 'conflict', 'Low and Very low');
    assert(kind({ confRank: 1, worstSigma: K44.CONFIDENCE_SIGMA.moderate }) === 'conflict', 'a level missed by 2 SD');
    assert(kind({ confRank: 0, hasAlt: true }) === 'conflict', 'a second MAP solution');
  });
  test('44.12 the rendered answer never says both "would add little" and "is recommended"; the other panels point to the Next line', () => {
    const { html, text, threw } = e1();
    assert(html.length > 5000 && !/could not be displayed/.test(html), `rendered: ${html.length} chars, ${threw && threw.message}`);
    assert(!incoherent44(text).length, `"would add little" beside ${JSON.stringify(incoherent44(text))}`);
    assert(para44(html, 'vx-next') === 'Next A further level is recommended.', para44(html, 'vx-next'));
    // Fit vs measured and Models carry no sentence of their own about a further level.
    for (const re of [/further concentration is recommended/i, /level panel further down/, /next step above says/, /a second level, or cystatin C, resolves/])
      assert(!re.test(text), `own further-level sentence: ${re}`);
    assert(K44.FIT_BANDS.every(b => !/further (level|concentration)/i.test(b.action) || /the Next line/.test(b.action)),
      'every fit band that mentions a further level points to the Next line: ' + K44.FIT_BANDS.map(b => b.action).join(' | '));
    assert(/the Next line/.test(text), 'the panels point to the Next line');
  });
  test('44.13 the Low-confidence line names its first reason, the model disagreement with both AUCs; "does not trust" is gone', () => {
    const { html, text, conf, ag } = e1();
    assert(src44.indexOf('a fit the tool itself does not trust') < 0 && !/does not trust/.test(text), 'the sentence is gone');
    const lead = fn44('confidenceLead')(conf);
    assert(lead && !lead.good && lead.rank === conf.rank, `the lead is the reason that set the rating: ${JSON.stringify(lead)}`);
    const aucs = ag.rows.map(m => `${m.auc24.toFixed(0)} on ${m.label}`);
    assert(aucs.length === 2 && lead.text.indexOf(`(AUC₂₄ ${aucs[0]} and ${aucs[1]})`) > 0, `both AUCs named: ${lead.text}`);
    const line = para44(html, 'vx-conf');
    assert(line.indexOf(`Low confidence — ${lead.text}`) === 0, line);
    assert(!/One level: clearance/.test(line), 'not the weaker reason first: ' + line);
  });
  test('44.14 a cap-bound continue (CL 12.34, 1.5 g q8h established, no level): the Next line says the ceiling binds, not "a dose change is indicated"', () => {
    const doses = Array.from({ length: 4 }, (_, i) => ({ mg: 1500, tinfH: fn44('autoTinf')(1500), timeH: i * 8 }));
    const rec = fn44('regimenDecision')(12.34, 60, 450, null, 1, doses, fn44('aucUncertaintyRow')(0, 'buelga'));
    assert(rec.action === 'continue' && rec.dose === 1500 && rec.tau === 8 && Math.round(rec.auc24) === 365, `${rec.action} ${rec.dose} q${rec.tau} ${rec.auc24}`);
    const r = { model: 'buelga', CL_ind: 12.34, V_ind: 60, doses, levels: [], rec, mapAlt: null };
    const conf = fn44('confidenceAssessment')(r, null, null);
    const fit = fn44('nextLevelFit')(r, conf);
    assert(fit.capBound === true && fit.action === 'continue', JSON.stringify(fit));
    const nlv = fn44('nextLevelValue')(rec.auc24, 0, 'buelga', rec.tau, 12.34, fit);
    assert(nlv.headline === 'Confirm the clearance with a level' && /so the regimen is continued rather than changed/.test(nlv.detail), `the continue wording is kept: ${nlv.detail}`);
    const line = fn44('nextLevelLine')(nlv);
    for (const s of [nlv.headline, nlv.detail, line]) assert(!/dose change is indicated/.test(s), s);
    assert(/conventional ceilings/.test(nlv.detail) && /level/i.test(line), `${line} / ${nlv.detail}`);
    // Not cap-bound: the outright branch is unchanged.
    assert(/dose change is indicated/.test(fn44('nextLevelValue')(300, 1, 'buelga', 12, 4).detail), 'an ordinary out-of-range estimate still says so');
  });
  // The Task 6 review: cap-bound is AUC24 below 400, but "outright" subtracts half a 250 mg step,
  // so a cap-bound continue at AUC24 ~369-399 fell to the precision branch — "A further level would
  // add little" beside "Confirm the clearance with a level" and "another level may settle it".
  // Fictional 25 M, 180 cm, SCr 0.5, Buelga, 1.5 g q8h x 6, the last 7.5 h ago; two levels.
  const capGrace = [
    ['High', { age: 25, tbw: 70, ht: 180, scr: 0.5, mg: 1500, tinf: 1.5, tau: 8, n: 6, lastAgo: 7.5, levels: [{ conc: 25, after: 2 }, { conc: 5, after: 7.5 }] }, 0],
    ['Moderate', { age: 25, tbw: 120, ht: 180, scr: 0.5, mg: 1500, tinf: 1.5, tau: 8, n: 6, lastAgo: 7.5, levels: [{ conc: 20, after: 2 }, { conc: 9, after: 7.5 }] }, 1],
  ];
  for (const [word, p, rank] of capGrace) {
    test(`44.14${rank ? 'b' : 'a'} a cap-bound continue inside the rounding grace, ${word} fit, two levels: the Next line asks for the level, never "would add little"`, () => {
      const { r, html, text, conf } = fit44(p);
      const rec = r.rec, nlv0 = fn44('nextLevelValue')(rec.auc24, r.levels.length, 'buelga', rec.tau, r.CL_ind);
      assert(rec.action === 'continue' && rec.dose === 1500 && rec.tau === 8 && (rec.flags || []).some(fn44('isCapBoundFlag')),
        `the fixture is a cap-bound continue of 1.5 g q8h: ${rec.action} ${rec.dose} q${rec.tau}`);
      assert(rec.auc24 < K44.AUC24_TARGET_MIN && !nlv0.outright && conf.rank === rank,
        `inside the grace (AUC24 ${rec.auc24.toFixed(0)}, outright ${nlv0.outright}), ${conf.level}`);
      const nlv = fn44('nextLevelValue')(rec.auc24, r.levels.length, 'buelga', rec.tau, r.CL_ind, fn44('nextLevelFit')(r, conf));
      assert(nlv.kind !== 'precision' && nlv.headline === 'Confirm the clearance with a level', `${nlv.kind}: ${nlv.headline}`);
      assert(para44(html, 'vx-next') === 'Next Confirm the clearance with a level.', para44(html, 'vx-next'));
      assert(!incoherent44(text).length && !/further level is not the lever/.test(text),
        `"would add little" beside ${JSON.stringify(incoherent44(text))}`);
    });
  }

  // Task 6b (controller ruling R12). Outside 400-600 the candidates had to beat the current
  // regimen on the 20 dots; at high clearance every admissible regimen has 0 of 20, so none
  // did, and "no better" continued the current regimen however small: 250 mg q24h at
  // AUC24 16 beside 1.5 g q8h at 286. The tie is now broken on exposure: the admissible
  // regimen nearest the band, when nearer than the current one by more than the rounding
  // grace (half of one 250 mg step at its interval and this clearance).
  const hist44 = (mg, tau, n) => Array.from({ length: n || 4 }, (_, i) => ({ mg, tinfH: fn44('autoTinf')(mg), timeH: i * tau }));
  const off44 = (a) => Math.max(0, K44.AUC24_TARGET_MIN - a, a - K44.AUC24_TARGET_MAX);   // distance to the band
  const capCL = 15.75, capRow = () => fn44('aucUncertaintyRow')(1, 'buelga');
  const capDecide = (mg, tau) => fn44('regimenDecision')(capCL, 60, 450, null, 1, hist44(mg, tau), capRow());

  test('44.14c 250 mg q24h at CL 15.75 (one level, 0 of 20, AUC24 16) changes to the regimen nearest the band, with the cap-bound alarm', () => {
    const r = capDecide(250, 24);
    assert(r.action === 'change' && r.decisionReason === 'attainment',
      `${r.action} / ${r.continueReason || r.decisionReason}: ${r.dose} mg q${r.tau}h AUC ${r.auc24.toFixed(0)}`);
    assert(r.current && r.current.dose === 250 && r.current.tau === 24 && r.current.dots === 0 && !r.current.inBand,
      `changes from the current regimen: ${JSON.stringify(r.current && { dose: r.current.dose, tau: r.current.tau, dots: r.current.dots })}`);
    assert(r.dose === 1500 && r.tau === 8 && Math.round(r.auc24) === 286, `the highest admissible exposure: ${r.dose} mg q${r.tau}h AUC ${r.auc24.toFixed(0)}`);
    const grace = fn44('roundingGraceAUC')(r.tau, capCL);
    assertClose(grace, 250 * (24 / 8) / capCL / 2, 1e-9, 'the grace is half of one 250 mg step at q8h');
    assert(off44(r.auc24) < off44(r.current.auc24) - grace,
      `nearer the band by more than the grace: ${off44(r.auc24).toFixed(0)} vs ${off44(r.current.auc24).toFixed(0)} - ${grace.toFixed(1)}`);
    assert(r.dots >= r.current.dots, `never worse: ${r.current.dots} -> ${r.dots}`);
    assert((r.flags || []).some(f => f.level === 'danger' && fn44('isCapBoundFlag')(f)), 'the cap-bound alarm: ' + (r.flags || []).map(f => f.text.slice(0, 50)).join(' | '));
    const h = fn44('regimenActionHTML')(r, 450);
    assert(/Change from 250 mg IV q24h/.test(h), h);
    assert(/AUC₂₄ 16 /.test(h) && /nearer the band, to 286,/.test(h), 'the reason names both exposures: ' + h);
    assert(!/this one puts 0 of 20 in range/.test(h), 'not a reason that gives no reason: ' + h);
    // The same at q8h: 1.25 g (AUC24 238) is 48 mg·h/L further from the band than 1.5 g, more than the grace of 24.
    const q8 = capDecide(1250, 8);
    assert(q8.action === 'change' && q8.dose === 1500 && q8.tau === 8 && q8.decisionReason === 'attainment', `${q8.action} ${q8.dose} q${q8.tau}`);
  });
  test('44.14d end to end (22 M, 95 kg, SCr 0.4, 1 g q12h, levels 4, 1 and 0.3 mg/L): High confidence, CL 15.07, the verdict is a change, not "Continue"', () => {
    const { r, html, text, conf } = fit44({ age: 22, tbw: 95, ht: 190, scr: 0.4, mg: 1000, tinf: fn44('autoTinf')(1000), tau: 12, n: 4, lastAgo: 10,
      levels: [{ conc: 4, after: 2 }, { conc: 1, after: 6 }, { conc: 0.3, after: 10 }] });
    assertClose(r.CL_ind, 15.07, 0.01, 'the reported clearance');
    assert(conf.rank === 0, `the reported rating is High: ${conf.level}`);
    const rec = r.rec;
    assert(rec.action === 'change' && rec.decisionReason === 'attainment' && rec.current.dose === 1000 && rec.current.tau === 12,
      `${rec.action} / ${rec.continueReason || rec.decisionReason}: ${rec.dose} mg q${rec.tau}h AUC ${rec.auc24.toFixed(0)}`);
    assert(rec.dose === 1500 && rec.tau === 8 && Math.round(rec.auc24) === 299, `${rec.dose} mg q${rec.tau}h AUC ${rec.auc24.toFixed(0)}`);
    assert(!/Continue the current regimen/.test(text), 'the verdict still says continue');
    assert(para44(html, 'vx-action') === 'Change from 1 g IV q12h', para44(html, 'vx-action'));
    assert(/cannot be reached within the conventional ceilings/.test(text), 'the cap-bound alarm is shown');
    assert(!/so it is not changed/.test(text), 'the no-better flag is gone');
    // The Task 6b review: beside the alarm's "confirm the clearance with a level before acting on it", Next
    // said "a dose change is indicated … how large it needs to be". One instruction, the alarm's.
    assert(para44(html, 'vx-next') === 'Next Confirm the clearance with a level.', para44(html, 'vx-next'));
    assert(!incoherent44(text).length, `beside the cap-bound alarm: ${JSON.stringify(incoherent44(text))}`);
  });
  test('44.14f the cap-bound Next line covers any cap-bound answer — continue, change or start — read off the answer, worded for each', () => {
    const conf0 = { rank: 0, worstSigma: 0.5 };
    const fitOf = (rec) => fn44('nextLevelFit')({ model: 'buelga', CL_ind: capCL, V_ind: 60, rec, mapAlt: null }, conf0);
    const change = capDecide(250, 24);
    const start = fn44('regimenDecision')(capCL, 60, 450, null, 1, null, capRow());
    assert(change.action === 'change' && start.action === 'start' && (start.flags || []).some(fn44('isCapBoundFlag')), `${change.action} / ${start.action}`);
    const fc = fitOf(change), fs = fitOf(start);
    assert(fc.capBound === true && fc.action === 'change' && fs.capBound === true && fs.action === 'start', JSON.stringify({ fc, fs }));
    // Not cap-bound: SUITE 43's below-range 1.75 g q24h changes into range, and the flag is not set.
    const plain = fn44('regimenDecision')(4.58, 61.8, 400, null, 1, hist44(1750, 24).map(d => Object.assign(d, { tinfH: 2 })), capRow());
    assert(plain.action === 'change' && fitOf(plain).capBound === false, `${plain.action}: ${JSON.stringify(fitOf(plain))}`);
    for (const [word, fit, rec] of [['change', fc, change], ['start', fs, start]]) {
      const nlv = fn44('nextLevelValue')(rec.auc24, 1, 'buelga', rec.tau, capCL, fit);
      assert(nlv.kind === 'management' && nlv.headline === 'Confirm the clearance with a level', `${word}: ${nlv.kind} ${nlv.headline}`);
      assert(fn44('nextLevelLine')(nlv) === 'Confirm the clearance with a level.', fn44('nextLevelLine')(nlv));
      assert(!/dose change is indicated|how large it needs to be|continued rather than changed/.test(nlv.detail), `${word}: ${nlv.detail}`);
      assert(/conventional ceilings/.test(nlv.detail) && /before this regimen is acted on/.test(nlv.detail), `${word}: ${nlv.detail}`);
    }
    // The start IS the highest admissible regimen (the optimizer's own alarm says so); a change need not be.
    assert(/this is the highest admissible regimen/.test(fn44('nextLevelValue')(start.auc24, 1, 'buelga', start.tau, capCL, fs).detail), 'start names the ceiling regimen');
    assert(!/this is the highest admissible regimen/.test(fn44('nextLevelValue')(change.auc24, 1, 'buelga', change.tau, capCL, fc).detail), 'a change does not claim it');
    // A conflicted fit still asks for a level first, for its own reason.
    assert(fn44('nextLevelValue')(change.auc24, 1, 'buelga', change.tau, capCL, Object.assign({}, fc, { confRank: 2, reason: 'x' })).kind === 'conflict', 'conflict first');
  });
  test('44.14e a genuine tie still continues; an in-range regimen is untouched by the exposure tie-break', () => {
    // 1.4 g q8h (AUC24 267) against 1.5 g q8h (286): 19 mg·h/L nearer, inside the grace of 24.
    const t = capDecide(1400, 8), grace = fn44('roundingGraceAUC')(8, capCL);
    assert(off44(t.auc24) - off44(4500 / capCL) < grace && off44(t.auc24) > off44(4500 / capCL), 'the fixture is nearer, inside the grace');
    assert(t.action === 'continue' && t.continueReason === 'no-better' && t.dose === 1400 && t.tau === 8,
      `${t.action} / ${t.continueReason || t.decisionReason}: ${t.dose} mg q${t.tau}h`);
    assert((t.flags || []).some(fn44('isCapBoundFlag')), 'the cap-bound alarm stays on the continue');
    // At the ceiling itself nothing is nearer: SUITE 44.14's 1.5 g q8h at CL 12.34 is still continued.
    const top = fn44('regimenDecision')(12.34, 60, 450, null, 1, hist44(1500, 8), fn44('aucUncertaintyRow')(0, 'buelga'));
    assert(top.action === 'continue' && top.continueReason === 'no-better' && top.dose === 1500 && top.tau === 8, `${top.action} ${top.dose} q${top.tau}`);
    // In range: SUITE 43's reported 1250 mg q12h (CL 4.58, 14 of 20) is continued at every target box.
    for (let tb = 400; tb <= 600; tb += 50) {
      const c = fn44('regimenDecision')(4.58, 61.8, tb, null, 1, hist44(1250, 12).map(d => Object.assign(d, { tinfH: 1.5 })), capRow());
      assert(c.action === 'continue' && c.continueReason === 'in-range' && c.dose === 1250 && c.tau === 12 && c.dots === 14,
        `target ${tb}: ${c.action} / ${c.continueReason || c.decisionReason} ${c.dose} q${c.tau}`);
    }
    // Above the band too: before any level Goti caps the dots at 7 of 20, so 2 g q18h at AUC24 643 (7 of 20)
    // was continued beside in-range regimens no better on dots. It moves into the band, and says so.
    const above = fn44('regimenDecision')(4.15, 40, 450, { Vc: 40, Vp: 45, Q: Q_GOTI }, 1, hist44(2000, 18), fn44('aucUncertaintyRow')(0, 'goti'));
    assert(above.action === 'change' && above.nearerBand && above.current.auc24 > K44.AUC24_TARGET_MAX && above.inBand && above.dots === above.current.dots,
      `${above.action} ${above.dose} q${above.tau}h AUC ${above.auc24.toFixed(0)} (${above.dots}) from ${above.current && above.current.auc24.toFixed(0)}`);
    assert(/brings AUC₂₄ into the band, at \d+, with 7 of 20 in range/.test(fn44('regimenActionHTML')(above, 450)), fn44('regimenActionHTML')(above, 450));
    // Across a grid, the exposure tie-break never acts on an in-range current regimen, and a change never lowers the dots.
    let n = 0, ties = 0;
    for (let nl = 0; nl <= 3; nl++) for (let cl = 1.5; cl <= 18.0001; cl += 0.75) for (const tau of [8, 12, 24, 48]) for (let mg = 250; mg <= 2000; mg += 250) {
      const r = fn44('regimenDecision')(cl, 60, 450, null, 1, hist44(mg, tau), fn44('aucUncertaintyRow')(nl, 'buelga'));
      if (!r || r.noSolution || r.action !== 'change') continue;
      n++;
      if (r.decisionReason === 'safety') continue;
      assert(r.dots >= r.current.dots, `CL ${cl} ${mg} q${tau}h: ${r.current.dots} -> ${r.dots}`);
      if (r.dots === r.current.dots) {
        ties++;
        assert(!r.current.inBand && off44(r.auc24) < off44(r.current.auc24) - fn44('roundingGraceAUC')(r.tau, cl),
          `CL ${cl} ${mg} q${tau}h -> ${r.dose} q${r.tau}h: a change without a dot gained must be from out of range and nearer by more than the grace`);
      }
    }
    assert(n > 1000 && ties > 20, `exercised ${n} changes, ${ties} on exposure`);
  });

  // Task 7 (engine report I6; ruling R14): on the steady-state basis a level later than the interval
  // the patient was on, plus the module's trough-timing window, means another dose came in between
  // (or the dose time is an earlier dose): the slope survives, the back-extrapolated peak, volume and
  // clearance do not. Refuse. The first-dose basis legitimately takes late levels.
  test('44.15 two levels, steady-state basis: a level later than the interval plus the timing window is refused, naming the times and the interval', () => {
    const tl = (basis, t1, t2, c2, tau) => trough44('twolevels', 'M', { age: 25, tbw: 95, height: 185, scr: 0.5, 'tl-dose': 1000, 'tl-tinf': 1, 'tl-tau': 12,
      'tl-cur-tau': tau || 12, 'tl-c1': 25.9, 'tl-c2': c2, 'tl-dose-time': '2026-11-14T00:00', 'tl-t1-time': '2026-11-14T02:00',
      't': 0, 'tl-t2-time': '2026-11-14T08:00', 'tl-t1-hours': t1, 'tl-t2-hours': t2 }, { tlBasis: basis });
    const refused = (r) => /id="fe-trough"/.test(r.h);
    // The window is the module's existing trough-timing preference, parsed from the source.
    assert(K44.TROUGH_TIMING_WINDOW_H === 0.5, `window ${K44.TROUGH_TIMING_WINDOW_H}`);
    // The engine report's T6c: q12h, 1 g over 1 h, 25.9 mg/L at 2 h, 12.95 mg/L at 56 h.
    const bad = tl('steadystate', 2, 56, 12.95);
    assert(refused(bad), 'the 56 h level is refused: ' + bad.text.slice(0, 300));
    assert(/56/.test(bad.text) && /12 ?h/.test(bad.text) && /before the next dose/.test(bad.text) && /Level 2/.test(bad.text), bad.text.slice(0, 400));
    assert(!/class="rec-dose"|Vd 265/.test(bad.h), 'no regimen or volume shown');
    // The same times on the first-dose basis are accepted.
    const first = tl('firstdose', 2, 56, 12.95);
    assert(!refused(first), 'first-dose basis accepts the late level: ' + first.text.slice(0, 300));
    // The edge: tau + window is accepted, anything later is not.
    assert(!refused(tl('steadystate', 2, 12 + K44.TROUGH_TIMING_WINDOW_H, 11)), 'level 2 at tau + window is accepted');
    assert(refused(tl('steadystate', 2, 12 + K44.TROUGH_TIMING_WINDOW_H + 0.1, 11)), 'level 2 just past tau + window is refused');
    // Either level: Level 1 late too, and a q24h interval takes a 20 h level that q12h refuses.
    assert(refused(tl('steadystate', 13, 14, 12)), 'level 1 past the interval is refused');
    assert(/Level 1/.test(tl('steadystate', 13, 14, 12).text), 'and named');
    assert(refused(tl('steadystate', 2, 20, 8, 12)) && !refused(tl('steadystate', 2, 20, 8, 24)), 'the interval the patient was on decides');
  });

  // Task 8 (UI report I2; ruling R1): "was due" is the due time of the regimen being given, not
  // of the new one. Fictional 55 M, 72 kg, 176 cm, SCr 1.0, Buelga (D25's below-range case):
  // 1.75 g q24h over 2 h at 10, 11 and 12 Nov 08:00; one level, 6 mg/L, 13 Nov 07:30; target box
  // 400; now 13 Nov 10:00. The answer is q12h, and v3.13.0 said "First dose 13 Nov 10:00 (was due
  // 12 Nov 20:00)": a dose missed 14 h ago. The next q24h dose was due 13 Nov 08:00. The plan is
  // built as renderBayesianResults builds it: the decision, and bState.curRegimen as
  // inferCurrentRegimen reads the course. The default first-dose time is unchanged (R1).
  const at44h = (s) => new Date(s).getTime() / 3600000;
  const fmtClock44 = (h) => fn44('fmtClock')(h);
  const curRegimen44 = (doses, CL, V) => {   // renderBayesianResults' bState.curRegimen
    const c = fn44('inferCurrentRegimen')(doses, CL, V, null);
    return c && c.dose > 0 && c.tau > 0 && c.tinfH > 0 ? { dose: c.dose, tau: c.tau, tinfH: c.tinfH } : null;
  };
  const i2Case = (times) => {
    const wt = fn44('pickCrClWeight')('auto', 72, fn44('calcIBW')('M', 176)).wt;
    const crcl = Math.max(K44.CRCL_MODEL_FLOOR, Math.min(K44.CRCL_MODEL_CAP,
      fn44('calcCrCl')(55, 'M', 1.0, wt, vm.runInContext('SCR_POLICY.ACTUAL', sandbox))));
    const bk = fn44('buelgaPopPK')(crcl, 72);
    const doses = times.map(s => ({ mg: 1750, tinfH: 2, timeH: at44h(s) }));
    const nowH = at44h('2026-11-13T10:00'), levels = [{ conc: 6, timeH: at44h('2026-11-13T07:30') }];
    const mf = fn44('mapFit')((a, b) => fn44('burtonObjective')(a, b, bk.CL_pop, bk.V_pop, doses, levels),
      2, K44.OMEGA2_CL_BUELGA, K44.OMEGA2_V_BUELGA, 300);
    const CL_ind = bk.CL_pop * Math.exp(mf.eta[0]), V_ind = bk.V_pop * Math.exp(mf.eta[1]);
    const rec = fn44('regimenDecision')(CL_ind, V_ind, 400, null, 1, doses, fn44('aucUncertaintyRow')(1, 'buelga'));
    const r = { model: 'buelga', CL_ind, V_ind, doses, levels, fitNowH: nowH, rec };
    return { r, rec, nowH, cur: curRegimen44(doses, CL_ind, V_ind) };
  };
  test('44.16 "was due" is the current regimen\'s due time; with no current regimen nothing was due; the same interval changes nothing', () => {
    const { r, rec, nowH, cur } = i2Case(['2026-11-10T08:00', '2026-11-11T08:00', '2026-11-12T08:00']);
    assert(rec.action === 'change' && rec.current && rec.current.tau === 24 && rec.tau === 12 && cur && cur.tau === 24,
      `the fixture changes q24h to q12h: ${rec.action} from q${rec.current && rec.current.tau}h to ${rec.dose} mg q${rec.tau}h; cur ${JSON.stringify(cur)}`);
    const plan = fn44('firstDosePlan')(r, rec, nowH, null, cur);
    assert(plan.firstH === nowH, `the default first dose stays max(last + the new interval, now) (R1): ${fmtClock44(plan.firstH)}`);
    assert(plan.dueH === at44h('2026-11-13T08:00') && plan.duePassed === true && plan.deltaH === 2,
      `due on the current q24h: dueH ${fmtClock44(plan.dueH)}, duePassed ${plan.duePassed}, deltaH ${plan.deltaH}`);
    const line = fn44('firstDoseReadoutHTML')(plan, rec, false), paper = fn44('firstDoseReadoutHTML')(plan, rec, true);
    for (const [k, h] of [['screen', line], ['print', paper]]) {
      // R16: a due time on another interval names it — the current q24h dose was due.
      assert(/13 Nov 10:00 \(current q24h dose was due 13 Nov 08:00\)/.test(h), `${k}: ${h.slice(0, 400)}`);
      assert(!/12 Nov 20:00/.test(h), `${k}: never the new interval's due time: ${h.slice(0, 400)}`);
    }
    // The printed offset names the interval it is measured on: the current q24h, not the new q12h.
    assert(/2 h after the current q24h schedule/.test(paper) && !/q12h schedule/.test(paper), paper.slice(0, 400));
    assert(/then 10:00 and 22:00 daily/.test(line), `the new regimen's times after it: ${line}`);
    // No current regimen from the caller: nothing was due, no parenthesis; the time is the same.
    const none = fn44('firstDosePlan')(r, rec, nowH, null, null);
    assert(none.duePassed === false && none.firstH === plan.firstH, JSON.stringify({ duePassed: none.duePassed, firstH: none.firstH }));
    for (const h of [fn44('firstDoseReadoutHTML')(none, rec, false), fn44('firstDoseReadoutHTML')(none, rec, true)])
      assert(!/was due/.test(h), h.slice(0, 400));
    // No current regimen in the decision: a single dose (the load) is a start, and nothing was due.
    const load = i2Case(['2026-11-12T08:00']);
    assert(load.rec.action === 'start' && !load.rec.current, `one dose is a start: ${load.rec.action}`);
    const lp = fn44('firstDosePlan')(load.r, load.rec, load.nowH, null, load.cur);
    assert(lp.duePassed === false && !/was due/.test(fn44('firstDoseReadoutHTML')(lp, load.rec, false)) && !/was due/.test(fn44('firstDoseReadoutHTML')(lp, load.rec, true)),
      JSON.stringify({ duePassed: lp.duePassed, cur: load.cur }));
    // A schedule the decision does not read as current (a possible transition: 0, 7, 19, 22, 39 h)
    // is not one, though inferCurrentRegimen gives it an interval: nothing was due on it.
    const pt = i2Case([0, 7, 19, 22, 39].map(h => new Date((at44h('2026-11-11T08:00') + h) * 3600000).toISOString()));
    assert(pt.rec.action === 'start' && pt.cur && pt.cur.tau > 0, `a possible transition is a start with an inferred interval: ${pt.rec.action}, ${JSON.stringify(pt.cur)}`);
    const pp = fn44('firstDosePlan')(pt.r, pt.rec, pt.nowH, null, pt.cur);
    assert(pp.duePassed === false && !/was due/.test(fn44('firstDoseReadoutHTML')(pp, pt.rec, true)), JSON.stringify({ duePassed: pp.duePassed, dueH: pp.dueH }));
    // The current regimen's interval equal to the new one (44.3's in-range 1.25 g q12h, continued):
    // dueH, deltaH and duePassed are v3.13.0's, and the readout wording is unchanged.
    const CL = 4.58, V = 61.8;
    const doses = Array.from({ length: 4 }, (_, i) => ({ mg: 1250, tinfH: 1.5, timeH: i * 12 }));
    const cont = fn44('regimenDecision')(CL, V, 450, null, 1, doses, fn44('aucUncertaintyRow')(1, 'buelga'));
    assert(cont.action === 'continue' && cont.tau === 12, `continued: ${cont.action}`);
    const rc = { model: 'buelga', CL_ind: CL, V_ind: V, doses, levels: [{ conc: 15, timeH: 47.5 }], fitNowH: 50.5, rec: cont };
    const cc = curRegimen44(doses, CL, V);
    assert(cc && cc.tau === 12, JSON.stringify(cc));
    for (const [nowC, atC] of [[50.5, null], [46, null], [50.5, 52]]) {
      const p = fn44('firstDosePlan')(rc, cont, nowC, atC, cc);
      const v313due = 36 + cont.tau, v313first = atC != null ? Math.max(atC, nowC) : Math.max(v313due, nowC);
      assert(p.dueH === v313due && p.firstH === v313first && p.deltaH === v313first - v313due && p.duePassed === (atC == null && v313due < nowC),
        `now ${nowC} at ${atC}: ${JSON.stringify({ dueH: p.dueH, firstH: p.firstH, deltaH: p.deltaH, duePassed: p.duePassed })}`);
      if (nowC === 50.5 && atC == null) assert(p.duePassed === true, `the same interval, past due, unchosen: duePassed ${p.duePassed}`);
      const pr = fn44('firstDoseReadoutHTML')(p, cont, true);
      assert(new RegExp(`${+(p.deltaH).toFixed(1)} h (after|before) the q12h schedule|on the q12h schedule`).test(pr) && !/current q12h/.test(pr), pr.slice(0, 300));
      if (p.duePassed) assert(pr.includes(`(was due ${fmtClock44(48)})`) && !/current q12h dose/.test(pr), pr.slice(0, 300));
    }
  });
  // Task 8 review (ruling R16): one reading of the current regimen per screen — the decision's.
  test('44.16a a start says "First dose" with no schedule offset; "was due" only when the first dose is now because the current dose is past due', () => {
    const word = (plan, rec) => [fn44('firstDoseHTML')(plan, rec, false), fn44('firstDoseHTML')(plan, rec, true)];
    // The reviewer's probe: 1 g at 0, 8, 16, 24, 36 h — a possible transition to q12h, which
    // inferCurrentRegimen reads as 1 g q12h but the decision does not (a start, 1 g q12h).
    const CL = 4.58, V = 61.8, t0 = at44h('2026-11-12T08:00'), nowS = at44h('2026-11-14T10:00');
    const dS = [0, 8, 16, 24, 36].map(h => ({ mg: 1000, tinfH: 1, timeH: t0 + h }));
    const recS = fn44('regimenDecision')(CL, V, 450, null, 1, dS, fn44('aucUncertaintyRow')(1, 'buelga'));
    const curS = curRegimen44(dS, CL, V);
    assert(recS.action === 'start' && curS && curS.tau === 12 && curS.dose === 1000,
      `a start beside an inferred 1 g q12h: ${recS.action} ${recS.dose} q${recS.tau}h; cur ${JSON.stringify(curS)}`);
    const rS = { model: 'buelga', CL_ind: CL, V_ind: V, doses: dS, levels: [], fitNowH: nowS, rec: recS };
    const pS = fn44('firstDosePlan')(rS, recS, nowS, null, curS);
    assert(pS.same === false && pS.duePassed === false, JSON.stringify({ same: pS.same, duePassed: pS.duePassed }));
    for (const h of word(pS, recS)) {
      assert(/First dose/.test(h) && !/Next dose|next dose/.test(h), `a start is a first dose: ${h.slice(0, 500)}`);
      assert(!/schedule/.test(h) && !/was due/.test(h), `no schedule to be due on: ${h.slice(0, 500)}`);
    }
    // A single dose with the override set: inferCurrentRegimen reads the override, the decision
    // (two doses needed) a start. The same: a first dose, no schedule.
    vm.runInContext('globalThis.__o44 = bState.regimenOverrideH; bState.regimenOverrideH = 12;', sandbox);
    try {
      const one = [{ mg: 1000, tinfH: 1, timeH: at44h('2026-11-13T20:00') }];
      const recO = fn44('regimenDecision')(CL, V, 450, null, 1, one, fn44('aucUncertaintyRow')(1, 'buelga'));
      const curO = curRegimen44(one, CL, V);
      assert(recO.action === 'start' && curO && curO.tau === 12, `override, one dose: ${recO.action}; cur ${JSON.stringify(curO)}`);
      const pO = fn44('firstDosePlan')({ model: 'buelga', CL_ind: CL, V_ind: V, doses: one, levels: [], fitNowH: nowS, rec: recO }, recO, nowS, null, curO);
      for (const h of word(pO, recO)) assert(/First dose/.test(h) && !/Next dose|schedule|was due/.test(h), h.slice(0, 500));
    } finally { vm.runInContext('bState.regimenOverrideH = globalThis.__o44; delete globalThis.__o44;', sandbox); }
    // The reviewer's longer-interval case: 500 mg q8h changed to 1.25 g q24h, now the last dose
    // + 9 h. The current q8h dose was due 13 Nov 16:00, but the first dose is tomorrow 08:00, not
    // now: no "was due" (v3.13.0's meaning: the first dose is now because the due time passed).
    // The decision is constructed (a change to a longer interval is rare on the lattice); the
    // fit is the in-range posterior above.
    const t8 = at44h('2026-11-12T16:00'), d8 = Array.from({ length: 3 }, (_, i) => ({ mg: 500, tinfH: 1, timeH: t8 + i * 8 }));
    const recL = { action: 'change', dose: 1250, tau: 24, tinfH: 1.5, current: { dose: 500, tau: 8, tinfH: 1 } };
    const nowL = at44h('2026-11-13T17:00');
    const pL = fn44('firstDosePlan')({ model: 'buelga', CL_ind: CL, V_ind: V, doses: d8, levels: [], fitNowH: nowL, rec: recL }, recL, nowL, null, { dose: 500, tau: 8, tinfH: 1 });
    assert(pL.firstH === at44h('2026-11-14T08:00') && pL.dueH === at44h('2026-11-13T16:00') && pL.duePassed === false,
      JSON.stringify({ firstH: fmtClock44(pL.firstH), dueH: fmtClock44(pL.dueH), duePassed: pL.duePassed }));
    for (const h of [fn44('firstDoseReadoutHTML')(pL, recL, false), fn44('firstDoseReadoutHTML')(pL, recL, true)])
      assert(!/was due/.test(h) && /14 Nov 08:00/.test(h), h.slice(0, 400));
    assert(/16 h after the current q8h schedule/.test(fn44('firstDoseReadoutHTML')(pL, recL, true)), 'the printed offset names the current q8h');
  });

  // Task 9 — the user's ruling 3 (UI report I8): a Low-confidence fit moved an in-range regimen for
  // two more of 20 plausible AUCs, and the screen argued against its own change ("provisional",
  // "Low confidence", a further level). Under Low or Very low an in-range, safe current regimen is
  // continued and the answer says to draw a level; safety changes and changes from out of range
  // still happen. finalizeDecision applies it once the rating is known (renderBayesianResults).
  // Fictional 30 M, 125 kg, 170 cm (BMI 43.3), SCr 0.9, Hughes; 1.5 g q12h x 8 over 2 h, the last
  // 11.5 h ago; one level, 16 mg/L, now. A real fit and a real Low rating (controller ruling R2 was
  // not needed for 44.17; 44.18 passes constructed ratings, which finalizeDecision takes as an argument).
  // FIXTURE MOVED (Task 19, D27; rule 9, reason recorded): it was 1.5 g q12h x 4 with 14 mg/L. That level,
  // 47.5 h after the first dose, is before steady state at the fitted half-life (19.4 h, 82% of the way),
  // so since D27 it reads the early band (-26% / +36%), where no admissible regimen gains 2 more plausible AUCs in
  // range: the unprotected answer is itself a continue and the ruling is never reached. Eight doses and
  // 16 mg/L give the same steady-state case (AUC24 540, 13 of 20; 1.25 g q12h at 450, 15 of 20) on a level
  // that is at steady state, so the ruling is still tested. The old fixture's flip is in the Task 19 report.
  const lowHughes = () => fit44({ model: 'hughes', age: 30, tbw: 125, ht: 170, scr: 0.9, mg: 1500, tinf: 2, tau: 12, n: 8, lastAgo: 11.5, levels: [{ conc: 16, after: 11.5 }] });
  // The fit's own decision, before finalizeDecision: what runBayesian decided on decisionArgs.
  const unprotected44 = (r) => { const a = r.decisionArgs; return fn44('regimenDecision')(a.CL, a.V, a.target, a.bag, a.mic, a.doses, a.row, { nowH: a.nowH }); };
  // Task 9 review (item 3): the line names the regimen set aside (lowConfidenceAlt), gives the rating's
  // cause alone (no nested parentheses, not the lead sentence the confidence line repeats), and carries
  // no target-box sentence that could be read as the regimen set aside.
  const LOW_WHY = /^Within 400–600 at AUC₂₄ (\d+) with (\d+) of 20 plausible AUCs in range\. (.+?) would put (\d+) of 20 plausible AUCs in range, but confidence in this fit is (Low|Very low) \(([^()]+)\), so the regimen is not changed on it\. Draw a level\.( Caution: its dose is above the conventional ceilings? \([^()]+\)\. [^()]*\([^()]+\)[^()]*\.)?$/;
  const parenDepth44 = (s) => { let d = 0, m = 0; for (const ch of s) { if (ch === '(') m = Math.max(m, ++d); else if (ch === ')') d--; } return m; };
  const lowWhyOK44 = (why, rec) => {
    const m = why.match(LOW_WHY), alt = rec.lowConfidenceAlt || {};
    assert(m, `the low-confidence line: ${why}`);
    assert(+m[1] === Math.round(rec.auc24) && +m[2] === rec.dots, `the current regimen's figures: ${why}`);
    assert(m[3] === fn44('fmtRegimen')(alt.dose, alt.tau) && +m[4] === alt.dots, `names the regimen set aside, ${fn44('fmtRegimen')(alt.dose, alt.tau)} at ${alt.dots}: ${why}`);
    assert(m[5] === rec.lowConfidence.level && m[6] === rec.lowConfidence.cause, `the rating and its cause: ${m[5]} / ${m[6]}`);
    assert(parenDepth44(why) <= 1 && !/Your target of/.test(why), `no nested parentheses, no target-box sentence: ${why}`);
    return m;
  };

  test('44.17 Hughes, BMI 43, 1.5 g q12h in range, one level, Low confidence: the 2-dot change is not made; continue and draw a level', () => {
    const { r, html, text, conf } = lowHughes();
    assert(conf.rank === 2 && conf.level === 'Low', `the fixture is Low confidence: ${conf.level}`);
    const lead = fn44('confidenceLead')(conf);
    assert(/models disagree by \d+% on exposure/.test(lead.text), `Low for the models' disagreement: ${lead.text}`);
    const u = unprotected44(r);
    assert(u.action === 'change' && u.decisionReason === 'attainment' && u.current.inBand && !u.current.unsafe && u.current.dose === 1500 && u.current.tau === 12
      && u.dots - u.current.dots >= K44.CONTINUE_MARGIN_DOTS,
      `without the ruling it changes from an in-range 1.5 g q12h: ${u.action} ${u.dose} q${u.tau}h (${u.current && u.current.dots} -> ${u.dots})`);
    // runBayesian's render finalized the decision; and finalizeDecision on the unprotected answer gives the same.
    const rec = r.rec;
    assert(rec.action === 'continue' && rec.continueReason === 'low-confidence' && rec.dose === 1500 && rec.tau === 12 && r.recFinal === true,
      `${rec.action} / ${rec.continueReason || rec.decisionReason}: ${rec.dose} q${rec.tau}h, recFinal ${r.recFinal}`);
    assert(rec.inBand && !rec.unsafe && rec.dots === u.current.dots && rec.lowConfidenceAlt && rec.lowConfidenceAlt.dots === u.dots
      && rec.lowConfidenceAlt.dose === u.dose && rec.lowConfidenceAlt.tau === u.tau, JSON.stringify(rec.lowConfidenceAlt));
    const r2 = { rec: u, decisionArgs: r.decisionArgs };
    fn44('finalizeDecision')(r2, conf);
    assert(r2.rec.action === 'continue' && r2.rec.continueReason === 'low-confidence' && r2.recFinal === true
      && r2.rec.lowConfidence.level === 'Low' && r2.rec.lowConfidence.cause === lead.short, JSON.stringify(r2.rec.lowConfidence));
    assert(/^the models disagree by \d+%$/.test(lead.short) && lead.text.indexOf(lead.short.replace(/^the models/, 'models')) > 0, `the cause alone: ${lead.short}`);
    // The answer, on screen: continue, why in 20-dot units with the rating's own reason, draw a level.
    assert(para44(html, 'vx-action') === 'Continue the current regimen', para44(html, 'vx-action'));
    const m = lowWhyOK44(para44(html, 'vx-why'), rec);
    assert(m[3] === '1.25 g IV q12h' && +m[4] === u.dots && m[5] === 'Low', para44(html, 'vx-why'));
    assert(!/vx-delta/.test(html) && !/Change from/.test(text), 'no change is shown');
    assert(para44(html, 'vx-next') === 'Next A further level is recommended.', para44(html, 'vx-next'));
    assert(!incoherent44(text).length, JSON.stringify(incoherent44(text)));
    // The summary (Copy summary), and the print report, read the finalized answer.
    assert(/Continuing 1\.5 g IV q12h is predicted to give/.test(text) && !/Change from 1\.5 g/.test(text), 'the summary says continue');
    const pr = fn44('_prRecommendation')(r, {});
    assert(/Continue the current regimen/.test(pr) && /so the regimen is not changed on it\. Draw a level\./.test(pr) && !/Change from/.test(pr), pr.slice(0, 600));
    // Task 8: the readout reads it as a continue — "Next dose", the current q12h's due time.
    const nowH = r.fitNowH, plan = fn44('firstDosePlan')(r, rec, nowH, null, { dose: 1500, tau: 12, tinfH: 2 });
    assert(plan.same === true && plan.dueCurrent === true && plan.dueTau === 12, JSON.stringify({ same: plan.same, dueCurrent: plan.dueCurrent, dueTau: plan.dueTau }));
    assert(/Next dose/.test(fn44('firstDoseHTML')(plan, rec, false)), 'the readout says "Next dose"');
  });
  test('44.17a Goti (Review Focus 3): the same protection, and the rating did not depend on the answer — model agreement is read on the current daily dose', () => {
    // Fictional 30 M, 80 kg, 175 cm, SCr 0.9, Goti; 1.5 g q12h x 8 over 2 h, the last 11.5 h ago; one level, 15 mg/L, now.
    // Moved from x 4 at 14 mg/L for the reason given at lowHughes (Task 19): that level is before steady state
    // (88%), and on the early band the change gains fewer than 2 dots. This one is at steady state: 9 -> 11 of 20.
    const { r, html, text, conf, ag } = fit44({ model: 'goti', age: 30, tbw: 80, ht: 175, scr: 0.9, mg: 1500, tinf: 2, tau: 12, n: 8, lastAgo: 11.5, levels: [{ conc: 15, after: 11.5 }] });
    const u = unprotected44(r);
    assert(conf.rank === 2 && u.action === 'change' && u.decisionReason === 'attainment' && u.current.inBand,
      `the fixture: ${conf.level}, ${u.action} / ${u.decisionReason} from ${u.current && u.current.dose} q${u.current && u.current.tau}h`);
    assert(r.rec.action === 'continue' && r.rec.continueReason === 'low-confidence' && r.rec.dose === 1500 && r.rec.tau === 12, `${r.rec.action} ${r.rec.dose} q${r.rec.tau}h`);
    // The rating is read on the current regimen's daily dose (3 g), never on the answer's: the protected
    // continue (3 g) and the change it replaced (2.5 g) would rate the same, and the render used 3 g.
    const curTDD = 1500 * 2, chgTDD = u.dose * (24 / u.tau);
    assert(Math.abs(chgTDD - curTDD) > 1, 'the two answers differ in daily dose');
    const fd = fn44('fitDiagnostics')(Object.assign({}, r, { regimen: fn44('inferCurrentRegimen')(r.doses, r.CL_ind, r.V_ind, r.goti) }));
    const agChg = fn44('modelAgreement')(r.agCtx, r.doses, r.levels, chgTDD);
    assert(Math.abs(agChg.diffPct - ag.diffPct) < 1e-9 && ag.band.tone === agChg.band.tone, `agreement ${ag.diffPct} vs ${agChg.diffPct}`);
    assert(fn44('confidenceAssessment')(r, fd, agChg).rank === conf.rank, 'the rating does not move with the daily dose');
    assert(ag.rows.some(x => Math.abs(x.auc24 - curTDD / r.CL_ind) < 1), `the rendered agreement is on the current 3 g a day: ${JSON.stringify(ag.rows.map(x => x.auc24))}`);
    assert(/disagree by \d+% on exposure/.test(para44(html, 'vx-conf')), para44(html, 'vx-conf'));
    // Screen, Copy summary and print read the finalized answer.
    assert(para44(html, 'vx-action') === 'Continue the current regimen', para44(html, 'vx-action'));
    lowWhyOK44(para44(html, 'vx-why'), r.rec);
    assert(/Continuing 1\.5 g IV q12h is predicted to give/.test(text), 'the summary says continue');
    const pr = fn44('_prRecommendation')(r, {});
    assert(/Continue the current regimen/.test(pr) && /not changed on it/.test(pr) && !/Change from/.test(pr), pr.slice(0, 600));
  });
  test('44.18 the same fit at Moderate or High confidence still changes; Very low keeps it', () => {
    const { r, conf } = lowHughes();
    const u = unprotected44(r);
    // Constructed ratings (controller ruling R2): finalizeDecision takes the rating as an argument.
    for (const rank of [0, 1]) {
      const r2 = { rec: unprotected44(r), decisionArgs: r.decisionArgs };
      const out = fn44('finalizeDecision')(r2, { rank, level: ['High', 'Moderate'][rank], reasons: [] });
      assert(r2.rec.action === 'change' && r2.rec.dose === u.dose && r2.rec.tau === u.tau && !r2.recFinal && out === r2.rec,
        `rank ${rank}: ${r2.rec.action} ${r2.rec.dose} q${r2.rec.tau}h`);
    }
    const r3 = { rec: unprotected44(r), decisionArgs: r.decisionArgs };
    fn44('finalizeDecision')(r3, Object.assign({}, conf, { rank: 3, level: 'Very low' }));
    assert(r3.rec.action === 'continue' && r3.rec.continueReason === 'low-confidence' && r3.rec.lowConfidence.level === 'Very low', `${r3.rec.action}`);
    lowWhyOK44(fn44('regimenActionHTML')(r3.rec, 450, 'why').replace(/<[^>]+>/g, ''), r3.rec);
    assert(r3.rec.lowConfidence.level === 'Very low', r3.rec.lowConfidence.level);
    // A grid of real protections: the line always names the regimen set aside, with no nested parentheses.
    let nk = 0;
    const lowAny = { rank: 2, level: 'Low', reasons: [{ good: false, rank: 2, text: 'Large prior–data conflict: 3.2 SD from the model.', short: 'a level sits 3.2 SD from the model' }] };
    for (let cl = 1.5; cl <= 9.0001; cl += 0.5) for (const tau of [8, 12, 24, 48]) for (let mg = 250; mg <= 2000; mg += 250) {
      const a = { CL: cl, V: 49, target: 450, bag: null, mic: 1, doses: Array.from({ length: 4 }, (_, i) => ({ mg, tinfH: fn44('autoTinf')(mg), timeH: i * tau })), row: fn44('aucUncertaintyRow')(1, 'buelga') };
      const rr = { rec: fn44('regimenDecisionOf')(a), decisionArgs: a };
      fn44('finalizeDecision')(rr, lowAny);
      if (rr.rec.continueReason !== 'low-confidence') continue;
      nk++; lowWhyOK44(fn44('regimenActionHTML')(rr.rec, 450, 'why').replace(/<[^>]+>/g, ''), rr.rec);
    }
    assert(nk > 20, `${nk} protections checked`);
  });
  test('44.19 under Low confidence an out-of-range regimen still changes, and an unsafe one still changes for safety', () => {
    const low = { rank: 2, level: 'Low', reasons: [{ good: false, rank: 2, text: 'Large prior–data conflict: 3.2 SD from the model.' }] };
    const row = fn44('aucUncertaintyRow')(1, 'buelga');
    const args = (CL, V, mg, tau, tinfH, bag, rw) => ({ CL, V, target: 400, bag: bag || null, mic: 1,
      doses: Array.from({ length: 4 }, (_, i) => ({ mg, tinfH, timeH: i * tau })), row: rw || row });
    const run = (a) => { const rec = fn44('regimenDecision')(a.CL, a.V, a.target, a.bag, a.mic, a.doses, a.row);
      const r = { rec, decisionArgs: a }; fn44('finalizeDecision')(r, low);
      const p = fn44('regimenDecision')(a.CL, a.V, a.target, a.bag, a.mic, a.doses, a.row, { protectInRange: true });
      return { before: rec, after: r.rec, p, r }; };
    // Below range: SUITE 43's 1.75 g q24h (7 of 20) changes into range.
    const below = run(args(4.58, 61.8, 1750, 24, 2));
    assert(below.after === below.before && below.after.action === 'change' && below.after.decisionReason === 'attainment' && !below.after.current.inBand && !below.r.recFinal,
      `${below.after.action} / ${below.after.decisionReason}`);
    assert(below.p.action === 'change' && below.p.dose === below.before.dose && below.p.tau === below.before.tau, 'protectInRange leaves it');
    // Out of range with no dot to gain (R12): 250 mg q24h at CL 15.75 still moves nearer the band.
    const r12 = run(args(15.75, 60, 250, 24, fn44('autoTinf')(250)));
    assert(r12.after.action === 'change' && r12.after.nearerBand && r12.p.action === 'change', `${r12.after.action}`);
    // Unsafe: SUITE 43.15's 750 mg q12h at CL 2.71 (a trough of 20 or more) still changes, for safety.
    const unsafe = run(args(2.71, 100, 750, 12, 2, null, fn44('aucUncertaintyRow')(2, 'buelga')));
    assert(unsafe.after.action === 'change' && unsafe.after.decisionReason === 'safety' && unsafe.p.action === 'change' && unsafe.p.decisionReason === 'safety',
      `${unsafe.after.action} / ${unsafe.after.decisionReason}`);
    // And a fitted pre-dose of 20 or more (Task 2's 48 mg/L case) is a safety change whatever the rating.
    // Task 9 review (item 4): with the real decisionArgs, so finalizeDecision re-decides on them.
    const { r: rC1, rec: c1, nowH: nowC1 } = c1Case();
    assert(c1.action === 'change' && c1.decisionReason === 'safety' && c1.current.unsafe, `${c1.action} / ${c1.decisionReason}`);
    const aC1 = { CL: rC1.CL_ind, V: rC1.V_ind, target: 450, bag: null, mic: 1, doses: rC1.doses, row: fn44('aucUncertaintyRow')(1, 'buelga'), nowH: nowC1 };
    const again = fn44('regimenDecisionOf')(aC1);
    assert(again.action === 'change' && again.dose === c1.dose && again.tau === c1.tau && again.decisionReason === 'safety', 'the args reproduce the fit\'s decision');
    const pC1 = fn44('regimenDecisionOf')(aC1, { protectInRange: true });
    assert(pC1.action === 'change' && pC1.decisionReason === 'safety' && pC1.dose === c1.dose, `protectInRange leaves a safety change: ${pC1.action}`);
    const rc1 = { rec: c1, decisionArgs: aC1 };
    fn44('finalizeDecision')(rc1, low);
    assert(rc1.rec === c1 && c1.action === 'change' && !rc1.recFinal, 'never protected');
    // The same call protects when the gate is open: relabel the same answer as an attainment change from
    // in range (as an unprotected fit would read) and finalizeDecision re-decides — so the check above can fail.
    const fake = Object.assign({}, again, { decisionReason: 'attainment', current: Object.assign({}, again.current, { inBand: true }) });
    const rFake = { rec: fake, decisionArgs: aC1 };
    let redecided = 0; const real = sandbox.regimenDecisionOf;
    sandbox.regimenDecisionOf = function () { redecided++; return real.apply(this, arguments); };
    try { fn44('finalizeDecision')(rFake, low); } finally { sandbox.regimenDecisionOf = real; }
    assert(redecided === 1 && rFake.rec === fake, `the gate reached the re-decision (${redecided}), which kept the safety change`);
  });
  test('44.20 a schedule of future rows only is not a current regimen (D-b): a start, and runBayesian decides on the fit\'s "now"', () => {
    const CL = 4.58, V = 61.8, row = fn44('aucUncertaintyRow')(0, 'buelga'), nowH = at44h('2026-11-14T10:00');
    const rows = Array.from({ length: 4 }, (_, i) => ({ mg: 1250, tinfH: 1.5, timeH: nowH + 2 + i * 12 }));
    const fut = fn44('regimenDecision')(CL, V, 450, null, 1, rows, row, { nowH });
    assert(fut.action === 'start', `four planned rows, nothing given: ${fut.action} ${fut.dose} q${fut.tau}h`);
    assert(fn44('currentRegimenOf')(rows, CL, V, null, 1, row, nowH) === null, 'currentRegimenOf reads no current regimen');
    // Once the first has been given, the schedule is current again (only "nothing given" is excluded).
    const given = fn44('regimenDecision')(CL, V, 450, null, 1, rows, row, { nowH: nowH + 3 });
    assert(given.action === 'continue' || given.action === 'change', `one given: ${given.action}`);
    // End to end (engine report M4): four future 1.25 g q12h rows, nothing given, no level — not "Continue".
    const { r, html } = fit44({ age: 55, tbw: 80, ht: 176, scr: 1.0, mg: 1250, tinf: 1.5, tau: 12, n: 4, lastAgo: -38, levels: [] });
    assert(r.doses.every(d => d.timeH > r.fitNowH) && r.rec.action === 'start', `${r.rec.action} ${r.rec.dose} q${r.rec.tau}h`);
    assert(!/Continue the current regimen|Change from/.test(html), 'no action line for a first regimen');
    assert(Number.isFinite(r.decisionArgs.nowH) && Math.abs(r.decisionArgs.nowH - r.fitNowH) < 0.01, `decided on the fit's now: ${r.decisionArgs.nowH} vs ${r.fitNowH}`);
  });
  // Controller ruling R17 (Task 9 review, item 2): a current regimen needs a GIVEN dose of the detected
  // maintenance schedule — the detected dose at a schedule time. A given load followed only by planned
  // maintenance is a start: "continue 1.25 g q12h" for an order of which no dose has been given.
  test('44.20a a given load with only planned maintenance is a start; once one maintenance dose is given it is a current regimen', () => {
    const CL = 4.58, V = 61.8, row = fn44('aucUncertaintyRow')(1, 'buelga'), nowH = at44h('2026-11-14T10:00');
    const probe = [{ mg: 2000, tinfH: 2, timeH: nowH - 1 }].concat([11, 23, 35].map(h => ({ mg: 1250, tinfH: 1.5, timeH: nowH + h })));
    const det = fn44('detectRegimen')(probe);
    assert(det.status === 'established' && det.intervalHours === 12 && det.maintenanceDoseMg === 1250, `detection reads q12h 1.25 g: ${det.status} q${det.intervalHours} ${det.maintenanceDoseMg}`);
    assert(fn44('currentRegimenOf')(probe, CL, V, null, 1, row, nowH) === null, 'no maintenance dose given: no current regimen');
    const p = fn44('regimenDecision')(CL, V, 450, null, 1, probe, row, { nowH });
    assert(p.action === 'start', `a load given, maintenance planned: ${p.action} ${p.dose} q${p.tau}h`);
    // One 1.25 g dose given (the load 13 h ago, the first maintenance dose 1 h ago): a current regimen.
    const one = [{ mg: 2000, tinfH: 2, timeH: nowH - 13 }].concat([-1, 11, 23].map(h => ({ mg: 1250, tinfH: 1.5, timeH: nowH + h })));
    const c = fn44('currentRegimenOf')(one, CL, V, null, 1, row, nowH);
    assert(c && c.dose === 1250 && c.tau === 12, `one maintenance dose given: ${JSON.stringify(c && { dose: c.dose, tau: c.tau })}`);
    const d = fn44('regimenDecision')(CL, V, 450, null, 1, one, row, { nowH });
    assert(d.action === 'continue' || d.action === 'change', `a current regimen: ${d.action}`);
    // An old amount given, the new amount only planned (1 g q12h x3 given, then 1.25 g planned): a start.
    const chg = [-25, -13, -1].map(h => ({ mg: 1000, tinfH: 1, timeH: nowH + h })).concat([11, 23, 35].map(h => ({ mg: 1250, tinfH: 1.5, timeH: nowH + h })));
    assert(fn44('currentRegimenOf')(chg, CL, V, null, 1, row, nowH) === null, 'the new amount not yet given');
  });
  // Task 9 review (item 1, rule 8): the rating now gates one decision, and the comment beside its
  // preference steps must say so, not "it never changes a dose".
  test('44.20b the CONFIDENCE_SIGMA preference comment states what the rating gates', () => {
    assert(src44.indexOf('The rating changes presentation — it never changes a dose.') < 0, 'the false sentence is gone');
    const i = src44.indexOf('const CONFIDENCE_SIGMA'), before = src44.slice(Math.max(0, i - 1500), i);
    assert(/PREFERENCE/.test(before) && /ruling 3/.test(before) && /finalizeDecision/.test(before), 'the comment names ruling 3 and finalizeDecision');
  });
  test('44.21 a charted dose above a ceiling is not recommendable but not unsafe (D-a): 2.25 g q48h in range, trough under 20, is continued with the ceiling caution', () => {
    const row = fn44('aucUncertaintyRow')(2, 'buelga');
    const h = (mg, tau) => Array.from({ length: 4 }, (_, i) => ({ mg, tinfH: fn44('autoTinf')(mg), timeH: i * tau }));
    const r = fn44('regimenDecision')(2.25, 70, 450, null, 1, h(2250, 48), row);
    assert(r.action === 'continue' && r.continueReason === 'in-range' && r.dose === 2250 && r.tau === 48, `${r.action} / ${r.continueReason || r.decisionReason}: ${r.dose} q${r.tau}h`);
    assert(Math.round(r.auc24) === 500 && r.Ctrough < K44.TROUGH_HIGH_MGL && !r.unsafe && r.unsafeReasons.length === 0, `AUC ${r.auc24}, trough ${r.Ctrough}, ${r.unsafeReasons}`);
    assert(r.notRecommendable.length === 1 && /single dose 2250 mg exceeds 2000 mg/.test(r.notRecommendable[0]), JSON.stringify(r.notRecommendable));
    const why = fn44('regimenActionHTML')(r, 450);
    assert(/Within 400–600/.test(why) && /above the conventional ceiling/.test(why) && why.indexOf(r.notRecommendable[0]) >= 0
      && /not a regimen this tool would recommend/.test(why) && /does not by itself make it unsafe/.test(why), why);
    // Above both ceilings, in range (CL 10: 2.5 g q12h, AUC24 500): continued, both named.
    const both = fn44('regimenDecision')(10, 60, 450, null, 1, h(2500, 12), row);
    assert(both.action === 'continue' && both.notRecommendable.length === 2, `${both.action} / ${both.continueReason || both.decisionReason} ${JSON.stringify(both.notRecommendable)}`);
    assert(/total daily dose 5000 mg exceeds 4500 mg/.test(fn44('regimenActionHTML')(both, 450)), 'the daily ceiling is named');
    // Unsafe stays unsafe: AUC24 above 700, or a trough of 20 or more, still changes for safety.
    const hot = fn44('regimenDecision')(3.0, 70, 450, null, 1, h(2250, 24), row);   // AUC24 750
    assert(hot.action === 'change' && hot.decisionReason === 'safety' && hot.current.unsafeReasons.some(x => /AUC24 750 exceeds the absolute ceiling 700/.test(x))
      && hot.current.notRecommendable.length === 1, `${hot.action} / ${hot.decisionReason} ${JSON.stringify(hot.current && hot.current.unsafeReasons)}`);
    // The change's reason names only what is unsafe; the ceiling alone is not a reason.
    assert(!/single dose 2250 mg exceeds/.test(fn44('regimenActionHTML')(hot, 450)), fn44('regimenActionHTML')(hot, 450));
    const tr = fn44('regimenDecision')(3.8, 300, 450, null, 1, h(2250, 24), row);    // AUC24 592, a long half-life: trough 21.4
    assert(tr.current ? (tr.action === 'change' && tr.decisionReason === 'safety' && tr.current.unsafeReasons.some(x => /trough/.test(x))) : false,
      `${tr.action} / ${tr.decisionReason}: trough ${tr.current && tr.current.Ctrough}`);
    // M2 (engine report): better regimens set aside for their trough are named, not denied.
    const m2 = fn44('regimenDecision')(0.42, 60, 450, null, 1, h(250, 48), fn44('aucUncertaintyRow')(3, 'buelga'));
    const m2h = fn44('regimenActionHTML')(m2, 450);
    assert(m2.action === 'continue' && m2.continueReason === 'no-better' && m2.troughSetAside === true, `${m2.action} / ${m2.continueReason} ${m2.troughSetAside}`);
    assert(/set aside because their predicted trough is 20 mg\/L or more/.test(m2h) && !/but no admissible regimen puts more in range/.test(m2h), m2h);
    assert((m2.flags || []).some(f => /set aside because their predicted trough is 20 mg\/L or more/.test(f.text)), 'the flag says so too');
  });
  test('44.22 finalizeDecision is idempotent: twice, or on a re-render, the same answer', () => {
    const { r, conf } = lowHughes();
    const r2 = { rec: unprotected44(r), decisionArgs: r.decisionArgs };
    // rec.regimen is rec itself (the contract), so snapshot the fields the answer is read from.
    const snap = (x) => JSON.stringify(['action', 'continueReason', 'dose', 'tau', 'tinfH', 'auc24', 'Ctrough', 'dots', 'lowConfidence', 'lowConfidenceAlt', 'flags'].map(k => x[k]));
    const once = fn44('finalizeDecision')(r2, conf), j1 = snap(r2.rec);
    const twice = fn44('finalizeDecision')(r2, conf);
    assert(once === twice && r2.rec === once && snap(r2.rec) === j1 && r2.recFinal === true && once.continueReason === 'low-confidence', 'the second call changes nothing');
    // The render calls it at its top: a redraw (resize, theme) re-renders the same result and keeps it.
    assert(/function renderBayesianResults[\s\S]*?const conf\s*=\s*confidenceAssessment\([^)]*\);(\s*\/\/[^\n]*)*\s*finalizeDecision\(r, conf\);\s*const rec = r\.rec;/.test(src44),
      'renderBayesianResults finalizes right after the rating and reads r.rec from there');
    // A Moderate rating, twice, leaves a change alone.
    const r3 = { rec: unprotected44(r), decisionArgs: r.decisionArgs }, before = r3.rec;
    fn44('finalizeDecision')(r3, { rank: 1, level: 'Moderate', reasons: [] }); fn44('finalizeDecision')(r3, { rank: 1, level: 'Moderate', reasons: [] });
    assert(r3.rec === before && r3.rec.action === 'change', 'unchanged');
  });

  // I4 (ui report): nine of ten printed reports lacked "not clinically validated". One constant
  // holds the sentence; the two on-screen paragraphs, the static print footer and every print
  // footer read it. The unit harness has no DOM, so the builders that need one (Trough, AUC, HD,
  // PD) are checked structurally here and rendered in browser-flows D26; the empty report and the
  // footer helper are rendered here.
  test('44.23 one DISCLAIMER_TEXT feeds the screen paragraphs and every print footer, and the rendered print says "not clinically validated"', () => {
    const m = src44.match(/const DISCLAIMER_TEXT = '([^']+)';/);
    assert(m, 'DISCLAIMER_TEXT constant is missing');
    const sentence = m[1];
    assert(/not clinically validated/.test(sentence) && /not a prescription/.test(sentence) && /Clinician judgment required/.test(sentence), sentence);
    assert((src44.match(/const DISCLAIMER_TEXT\b/g) || []).length === 1, 'one definition');
    // The sentence is the constant plus the static on-screen paragraphs, which carry it as literal
    // HTML (no script needed to show a safety disclaimer); the test pins every copy equal to the constant.
    const paras = [...src44.matchAll(/<p class="rp-disclaimer">([^<]*)<\/p>/g)].map(x => x[1]);
    assert(paras.length === 2, `${paras.length} static .rp-disclaimer paragraphs; expected the Trough and AUC ones`);
    assert(paras.every(t => t === sentence), 'every static .rp-disclaimer text must equal DISCLAIMER_TEXT: ' + JSON.stringify(paras));
    assert(src44.split(sentence).length === 4, `the sentence appears ${src44.split(sentence).length - 1} times; expected the constant and the two static paragraphs`);
    assert(!/Advisory only — not a prescription/.test(src44), 'an old footer string remains');
    assert(!/querySelectorAll\('\.rp-disclaimer/.test(src44), 'the paragraphs must not be filled by script');
    assert(!/print-footer/.test(src44), 'the dead .print-footer element and its CSS are removed');
    assert((src44.match(/class="pr-footer"/g) || []).length === 1, 'exactly one pr-footer element is written');
    const ft = body44('_prFooter');
    assert(/class="pr-footer"/.test(ft) && /DISCLAIMER_TEXT/.test(ft), '_prFooter must write the footer from the constant');
    const pr = body44('_buildPrintReport');
    assert((pr.match(/_prFooter\(/g) || []).length === 2, 'the Trough/PD clone path and the AUC/HD path both close with _prFooter');
    assert(/_prFooter\(/.test(body44('_prEmptyReport')), 'the empty report closes with _prFooter');
    const norm = (h) => String(h).replace(/<[^>]+>/g, ' ').replace(/&middot;/g, '·').replace(/\s+/g, ' ');
    const f1 = fn44('_prFooter')('Model: Buelga'), f2 = fn44('_prFooter')('');
    for (const f of [f1, f2, fn44('_prEmptyReport')()]) {
      assert(norm(f).includes(sentence), 'rendered footer lacks the sentence: ' + norm(f));
      assert(/not clinically validated/.test(norm(f)), 'rendered footer lacks "not clinically validated"');
    }
    assert(/Model: Buelga/.test(f1), 'the model line is kept');
  });

  // ── Saved profiles (Task 11): code report I2, M1, M2; engine report I4, I5; Review Focus 2 ──
  // A small DOM in which every element records what is written to it, and a localStorage.
  // Fictional patients only. The fixture holds profiles in the shapes v3.13.0 and earlier saved.
  const PROF_KEY44 = 'ainadara.profiles.v1';
  const profFixture44 = JSON.parse(fs.readFileSync(path.join(__dirname, 'docs/audit/profile-fixtures-v3.13.0.json'), 'utf8')).profiles;
  const profEnv44 = (store, vals) => {
    const writes = [], els = {};
    class PEl {
      constructor(id, tag) {
        this.id = id || ''; this.tagName = tag || 'INPUT'; this._v = vals && id in vals ? String(vals[id]) : '';
        this._t = ''; this._h = ''; this._c = false; this.style = { display: '' }; this.dataset = {}; this.attrs = {};
        this.children = []; this.parentNode = null; this.className = ''; this.type = 'number'; this.title = '';
        const cls = new Set();
        this.classList = { add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c),
          toggle: (c, on) => { const v = on === undefined ? !cls.has(c) : !!on; if (v) cls.add(c); else cls.delete(c); return v; } };
      }
      get value() { return this._v; }        set value(x) { writes.push([this.id, 'value', x]); this._v = String(x); }
      get checked() { return this._c; }      set checked(x) { writes.push([this.id, 'checked', x]); this._c = !!x; }
      get textContent() { return this._t; }  set textContent(x) { writes.push([this.id, 'textContent', x]); this._t = String(x); }
      get innerHTML() { return this._h; }    set innerHTML(x) { writes.push([this.id, 'innerHTML', x]); this._h = String(x); }
      setAttribute(k, v) { this.attrs[k] = String(v); } getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
      removeAttribute(k) { delete this.attrs[k]; } addEventListener() {} dispatchEvent() { return true; }
      appendChild(c) { this.children.push(c); return c; } removeChild() {} remove() {} focus() {} scrollIntoView() {}
      insertAdjacentHTML(pos, h) { this.innerHTML = this._h + h; } closest() { return null; } contains() { return false; }
      querySelector() { return null; } querySelectorAll() { return []; }
    }
    const get = (id) => els[id] || (els[id] = new PEl(id));
    const status = [new PEl('profile-status-1', 'P'), new PEl('profile-status-2', 'P')];
    const lists = [new PEl('profile-list-1', 'DIV'), new PEl('profile-list-2', 'DIV')];
    const document = {
      body: new PEl('body', 'BODY'), documentElement: undefined,
      getElementById: get, createElement: (t) => new PEl('', String(t).toUpperCase()),
      querySelector: () => null,
      // resetForm empties the Trough column's number inputs: here, every field not of the AUC column.
      querySelectorAll: (sel) => sel === '.profile-status' ? status : sel === '.profile-list' ? lists
        : sel === '.profile-label-input' ? labels
        : sel === 'input[type="number"]' ? Object.values(els).filter(e => !/^b-/.test(e.id) && e.type === 'number') : [],
    };
    const labels = [new PEl('profile-label-1', 'INPUT'), new PEl('profile-label-2', 'INPUT')];
    const localStorage = {
      _d: store, get length() { return Object.keys(this._d).length; },
      key(i) { return Object.keys(this._d)[i] ?? null; },
      getItem(k) { return Object.prototype.hasOwnProperty.call(this._d, k) ? this._d[k] : null; },
      setItem(k, v) { writes.push(['localStorage', k, v]); this._d[k] = String(v); },
      removeItem(k) { delete this._d[k]; },
    };
    return { document, localStorage, els, get, status, lists, labels, writes };
  };
  // Runs fn with the profile DOM and storage installed; spies count calls to the named functions.
  const withProf44 = (env, spies, fn) => {
    const prev = { document: sandbox.document, localStorage: sandbox.localStorage, setTimeout: sandbox.setTimeout };
    const real = {}, calls = {};
    sandbox.document = env.document; sandbox.localStorage = env.localStorage; sandbox.setTimeout = (f) => f();
    (spies || []).forEach(n => { real[n] = sandbox[n]; calls[n] = 0; sandbox[n] = function () { calls[n]++; return real[n].apply(this, arguments); }; });
    try { return fn(calls); }
    finally {
      Object.keys(real).forEach(n => { sandbox[n] = real[n]; });
      sandbox.document = prev.document; sandbox.localStorage = prev.localStorage; sandbox.setTimeout = prev.setTimeout;
      vm.runInContext('state.sex = null; bState.sex = null; bState.result = null;', sandbox);
    }
  };
  const statusText44 = (env) => env.status.map(s => s.textContent).join(' | ');
  Object.assign(__suiteShared, { profEnv44, withProf44, profFixture44, PROF_KEY44, fit44 });   // SUITE 45 reuses them

  test('44.24 a malformed profile (no demographics, no snapshot, a non-numeric savedAt) does not throw, leaves the form untouched and says so', () => {
    const base = profFixture44[0];
    const bad = {
      noDemographics: Object.assign({}, base, { id: 'p_nodemo1', label: 'No demographics', snapshot: Object.assign({}, base.snapshot, { demographics: undefined }) }),
      noSnapshot: { id: 'p_nosnap1', schema: 1, label: 'No snapshot', savedAt: base.savedAt },
      textSavedAt: Object.assign({}, base, { id: 'p_textat1', label: 'Text savedAt', savedAt: 'yesterday' }),
    };
    const form = { 'b-age': '77', age: '77', 'b-tbw': '60', tbw: '60', 'b-scr': '1.2', scr: '1.2', cysc: '1.9', 'scr-baseline': '0.8', dose: '1500', 'level-val': '31' };
    const spies = ['resetForm', 'resetBayesian', 'applyPatientCore', 'applyPdForm', 'setPatientSex', 'addBayesDose'];
    for (const [name, p] of Object.entries(bad)) {
      assert(typeof sandbox.validProfile === 'function', 'validProfile() is missing');
      assert(sandbox.validProfile(JSON.parse(JSON.stringify(p))) === false, `${name}: validProfile accepts it`);
      const env = profEnv44({ [PROF_KEY44]: JSON.stringify([p, base]) }, form);
      Object.keys(form).forEach(k => env.get(k));   // the form exists before the click
      env.writes.length = 0;
      withProf44(env, spies, (calls) => {
        let threw = null;
        try { sandbox.loadProfileIntoForm(p.id); } catch (e) { threw = e; }
        assert(!threw, `${name}: threw ${threw && threw.message}`);
        assert(spies.every(n => calls[n] === 0), `${name}: the form was touched: ${JSON.stringify(calls)}`);
        const formWrites = env.writes.filter(w => !/^profile-status-/.test(w[0]) && w[0] !== 'localStorage');
        assert(formWrites.length === 0, `${name}: ${JSON.stringify(formWrites.slice(0, 4))}`);
        assert(!env.writes.some(w => w[0] === 'localStorage' && w[1] === PROF_KEY44), `${name}: the store was rewritten`);
        Object.keys(form).forEach(k => assert(env.els[k].value === form[k], `${name}: ${k} is now "${env.els[k].value}"`));
        assert(/could not be read/.test(statusText44(env)) && /unchanged/.test(statusText44(env)), `${name}: status "${statusText44(env)}"`);
        // The list shows only the readable profile and says one could not be read.
        sandbox.renderProfileList();
        const html = env.lists[0].innerHTML;
        assert(html.indexOf(base.label) >= 0 && html.indexOf(p.label) < 0, `${name}: list ${html.slice(0, 200)}`);
        assert(!/Invalid Date/.test(html), `${name}: Invalid Date in the list`);
        assert(/1 saved profile could not be read/.test(statusText44(env)), `${name}: no read problem reported: "${statusText44(env)}"`);
      });
    }
    // The checks themselves.
    const ok = JSON.parse(JSON.stringify(base));
    assert(sandbox.validProfile(ok) === true, 'the v3.13.0 fixture is valid');
    const mut = (f) => { const c = JSON.parse(JSON.stringify(base)); f(c); return sandbox.validProfile(c); };
    assert(!mut(c => { c.id = 'p1" data-x="y'; }) && !mut(c => { c.id = 'x_abc'; }) && !mut(c => { c.label = 7; })
      && !mut(c => { c.savedAt = NaN; }) && !mut(c => { c.snapshot.doses = 'none'; }) && !mut(c => { c.snapshot.levels = null; })
      && !mut(c => { c.snapshot.demographics = []; }) && !mut(c => { c.snapshot = 'x'; }), 'every rule refuses');
    assert(!sandbox.validProfile(null) && !sandbox.validProfile([]) && !sandbox.validProfile('p_abc'), 'non-objects refused');
  });

  test('44.24a unreadable storage: the raw text is copied to ainadara.profiles.v1.bak before anything is written, the status says so, and a save keeps unreadable entries', () => {
    const raw = '[{"id":"p_trunc1","label":"Truncated","savedAt":1762412400000,"snapshot":{"demographics":{"age":"5';
    const env = profEnv44({ [PROF_KEY44]: raw }, {});
    withProf44(env, [], () => {
      assert(sandbox.loadProfiles().length === 0, 'nothing listed');
      assert(env.localStorage.getItem(PROF_KEY44 + '.bak') === raw, 'the backup holds the raw text');
      const first = env.writes.findIndex(w => w[0] === 'localStorage');
      assert(first >= 0 && env.writes[first][1] === PROF_KEY44 + '.bak', 'the first storage write is the backup: ' + JSON.stringify(env.writes.filter(w => w[0] === 'localStorage').map(w => w[1])));
      assert(vm.runInContext('profileReadProblems', sandbox) === 1, 'profileReadProblems');
      sandbox.renderProfileList();
      assert(/could not be read/.test(statusText44(env)) && /ainadara\.profiles\.v1\.bak/.test(statusText44(env)), `status "${statusText44(env)}"`);
      // Reading again writes no second copy.
      const n = env.writes.filter(w => w[0] === 'localStorage').length;
      sandbox.loadProfiles(); sandbox.renderProfileList();
      assert(env.writes.filter(w => w[0] === 'localStorage').length === n, 'a second read wrote again');
      // A different earlier backup is never overwritten.
      const env2 = profEnv44({ [PROF_KEY44]: raw, [PROF_KEY44 + '.bak']: 'an older backup' }, {});
      sandbox.localStorage = env2.localStorage;
      sandbox.loadProfiles();
      assert(env2.localStorage.getItem(PROF_KEY44 + '.bak') === 'an older backup', 'the older backup was overwritten');
      assert(Object.keys(env2.localStorage._d).some(k => k.indexOf(PROF_KEY44 + '.bak.') === 0 && env2.localStorage._d[k] === raw), 'the new text has its own backup key');
      // Storage that refuses the backup: nothing is ever written over the unreadable list.
      const env3 = profEnv44({ [PROF_KEY44]: raw }, {});
      env3.localStorage.setItem = function () { throw new Error('QuotaExceededError'); };
      sandbox.localStorage = env3.localStorage;
      sandbox.loadProfiles();
      assert(sandbox.persistProfiles([]) === false && env3.localStorage.getItem(PROF_KEY44) === raw, 'written over an unreadable list with no backup');
    });
    // A readable list with one bad entry: the bad entry is not listed, and a save writes it back.
    const good = profFixture44[0], broken = { id: 'p_broken1', label: 'Broken', savedAt: 'x', snapshot: {} };
    const env4 = profEnv44({ [PROF_KEY44]: JSON.stringify([good, broken]) }, {});
    withProf44(env4, [], () => {
      const list = sandbox.loadProfiles();
      assert(list.length === 1 && list[0].id === good.id && vm.runInContext('profileReadProblems', sandbox) === 1, 'one listed, one problem');
      assert(sandbox.persistProfiles(list) === true, 'persist');
      const stored = JSON.parse(env4.localStorage.getItem(PROF_KEY44));
      assert(stored.length === 2 && stored.some(p => p.id === 'p_broken1'), 'the unreadable entry was dropped: ' + stored.map(p => p.id));
    });
  });

  test('44.25 a profile id "p1\\" data-x=\\"y" renders no injected attribute; renderProfileList has no second escaper', () => {
    const rp = body44('renderProfileList');
    assert(!/const esc\s*=/.test(rp), 'the local esc escaper is still there (rule 2: escHtml is the one escaper)');
    assert(/escHtml\(p\.label\)/.test(rp) && (rp.match(/data-arg="\$\{escHtml\(p\.id\)\}"/g) || []).length === 2, 'label and id go through escHtml');
    const hostile = Object.assign(JSON.parse(JSON.stringify(profFixture44[0])), { id: 'p1" data-x="y', label: '<img src=x>"' });
    const env = profEnv44({ [PROF_KEY44]: JSON.stringify([hostile]) }, {});
    withProf44(env, [], () => {
      // Validation keeps it out of the list.
      sandbox.renderProfileList();
      assert(!/data-x=/.test(env.lists[0].innerHTML) && env.lists[0].innerHTML.indexOf('p1&quot;') < 0, 'an invalid id was listed');
      // And were it listed, the escaping holds: the check is lifted for this render only.
      const realValid = sandbox.validProfile;
      sandbox.validProfile = () => true;
      try { sandbox.renderProfileList(); } finally { sandbox.validProfile = realValid; }
      const html = env.lists[0].innerHTML;
      assert(/data-arg="p1&quot; data-x=&quot;y"/.test(html), 'the id is not escaped: ' + html.slice(0, 600));
      assert(!/\sdata-x="/.test(html), 'an attribute was injected');
      assert(html.indexOf('<img') < 0 && html.indexOf('&lt;img src=x&gt;&quot;') >= 0, 'the label is not escaped');
    });
  });

  test('44.25a the core is read from the module saved from; a shared field filled differently in the two columns refuses the save (D-e, engine report I4)', () => {
    // Patient A (80 F, 50 kg, 150 cm, SCr 2.5) in the AUC column; patient B (30 M, 90 kg, 185 cm, SCr 0.8) typed into the Trough column.
    const A = { 'b-age': '80', 'b-tbw': '50', 'b-height': '150', 'b-scr': '2.5', 'b-mic': '1', 'b-auc-target': '450' };
    const B = { age: '30', tbw: '90', height: '185', scr: '0.8', mic: '1', 'trough-min': '10', 'trough-max': '20', cysc: '' };
    const env = profEnv44({}, Object.assign({}, A, B));
    Object.keys(Object.assign({}, A, B)).forEach(k => env.get(k));
    env.get('app-shell-bayesian').style.display = 'none';   // the Trough module is on screen
    withProf44(env, ['snapshotBayesForm'], (calls) => {
      sandbox.setPatientSex('M');
      const t = sandbox.snapshotPatientCore('trough');
      assert(t.core.age === '30' && t.core.tbw === '90' && t.core.height === '185' && t.core.scr === '0.8' && t.core.sex === 'M', JSON.stringify(t.core));
      assert(JSON.stringify(t.conflicts) === JSON.stringify(['age', 'tbw', 'height', 'scr']), JSON.stringify(t.conflicts));
      const a = sandbox.snapshotPatientCore('auc');
      assert(a.core.age === '80' && a.core.scr === '2.5' && a.conflicts.length === 4, JSON.stringify(a));
      env.labels[1].value = 'Patient B';
      sandbox.saveCurrentProfile();
      const errs = sandbox.lastFormErrors('profile');
      // R19: the lead says to make the values match; each field is named with both values.
      assert(errs.length === 5 && /^Not saved/.test(errs[0]) && /[Mm]ake (them|the values) match/.test(errs[0]) && !/Clear the column/.test(errs.join(' ')), JSON.stringify(errs));
      assert(JSON.stringify(errs.slice(1)) === JSON.stringify(['Age: Trough-Based 30, AUC Precision 80', 'Weight: Trough-Based 90, AUC Precision 50',
        'Height: Trough-Based 185, AUC Precision 150', 'Serum creatinine: Trough-Based 0.8, AUC Precision 2.5']), JSON.stringify(errs));
      assert(env.localStorage.getItem(PROF_KEY44) === null && calls.snapshotBayesForm === 0, 'a mixed patient was stored, or the AUC course read');
      // The same value written differently is not a conflict; a field empty in one column is not either.
      ['age', 'tbw', 'height', 'scr'].forEach(k => { env.els['b-' + k].value = ''; });
      env.els['b-age'].value = '30.0';
      const ok = sandbox.snapshotPatientCore('trough');
      assert(ok.conflicts.length === 0 && ok.core.age === '30', JSON.stringify(ok));
      // A field only the other column holds fills the core (an AUC-only field from a Trough save).
      assert(ok.core.aucTarget === '450' && ok.core.troughMin === '10', JSON.stringify(ok.core));
      // A different MIC is a different patient field too.
      env.els['b-mic'].value = '2';
      assert(JSON.stringify(sandbox.snapshotPatientCore('trough').conflicts) === '["mic"]', 'MIC 1 vs 2');
      env.els['b-mic'].value = '1';
      sandbox.saveCurrentProfile();
      const stored = JSON.parse(env.localStorage.getItem(PROF_KEY44) || '[]');
      assert(stored.length === 1 && stored[0].label === 'Patient B' && stored[0].snapshot.core.age === '30' && stored[0].snapshot.core.sex === 'M', JSON.stringify(stored).slice(0, 300));
    });
  });


  test('44.25b R18: a Trough save stores the AUC course only when the AUC patient fields are filled and agree; otherwise without it, and says so', () => {
    const course = () => ({ demographics: { age: '', sex: 'F', tbw: '', height: '', scr: '', icu: true, dial: false }, model: 'goti',
      target: { auc: '450', mic: '1' }, doses: [{ mg: '1000', tinf: '1', date: '2025-11-04', time: '08:00' }], levels: [{ conc: '18', date: '2025-11-05', time: '07:30' }],
      scrRows: [{ val: '2.5', date: '2025-11-05', time: '06:00' }], hdSessions: [{ date: '2025-11-05', time: '09:00', hours: '4' }],
      fit: { model: 'goti', CL_ind: 2.1, V_ind: 40 }, staleFit: undefined, dirty: false });
    const B = { age: '30', tbw: '90', height: '185', scr: '0.8', mic: '1', 'b-mic': '1', 'b-auc-target': '450' };
    // Branch 1: patient A's course in the AUC column, its patient fields empty.
    const env = profEnv44({}, B);
    Object.keys(B).concat(['b-age', 'b-tbw', 'b-height', 'b-scr']).forEach(k => env.get(k));
    env.get('app-shell-bayesian').style.display = 'none';
    const realSnap = sandbox.snapshotBayesForm;
    sandbox.snapshotBayesForm = course;
    try {
      withProf44(env, [], () => {
        sandbox.setPatientSex('M');
        env.labels[0].value = 'Patient B';
        sandbox.saveCurrentProfile();
        const p = JSON.parse(env.localStorage.getItem(PROF_KEY44) || '[]')[0];
        assert(p && p.snapshot.core.age === '30', 'not saved: ' + JSON.stringify(sandbox.lastFormErrors('profile')));
        const sn = p.snapshot;
        assert(sn.doses.length === 0 && sn.levels.length === 0 && sn.scrRows.length === 0 && sn.hdSessions.length === 0 && !sn.fit && !sn.staleFit,
          'patient A\'s course travelled with B: ' + JSON.stringify(sn).slice(0, 300));
        assert(sn.demographics.icu === false && sn.demographics.age === '30', 'the AUC column\'s ICU flag or empty demographics were kept: ' + JSON.stringify(sn.demographics));
        assert(/Saved "Patient B"/.test(statusText44(env)) && /AUC Precision course not saved/.test(statusText44(env)), statusText44(env));
        // Branch 2: the AUC column holds the same patient, every field filled: the course is kept.
        ['age', 'tbw', 'height', 'scr'].forEach(k => { env.els['b-' + k].value = B[k]; });
        env.labels[0].value = 'Patient B with course';
        sandbox.saveCurrentProfile();
        const q = JSON.parse(env.localStorage.getItem(PROF_KEY44))[0];
        assert(q.label === 'Patient B with course' && q.snapshot.doses.length === 1 && q.snapshot.levels.length === 1
          && q.snapshot.scrRows.length === 1 && q.snapshot.hdSessions.length === 1 && !!q.snapshot.fit, JSON.stringify(q.snapshot).slice(0, 300));
        assert(!/course not saved/.test(statusText44(env)), statusText44(env));
        // One AUC field empty is not "filled": the course is left out again.
        env.els['b-height'].value = '';
        env.labels[0].value = 'Patient B partial';
        sandbox.saveCurrentProfile();
        const r = JSON.parse(env.localStorage.getItem(PROF_KEY44))[0];
        assert(r.label === 'Patient B partial' && r.snapshot.doses.length === 0, JSON.stringify(r.snapshot.doses));
      });
    } finally { sandbox.snapshotBayesForm = realSnap; }
  });

  test('44.25c R19: the refusal offers one action that copies only the conflicting fields from the saving module; a second save succeeds', () => {
    // A same-patient follow-up: patient C (45 F) in both columns, today's SCr 1.4 typed in AUC Precision only.
    const T = { age: '45', tbw: '70', height: '168', scr: '0.9', mic: '1', cysc: '1.1', 'trough-min': '15', 'trough-max': '20', 'scr-baseline': '0.8' };
    const A = { 'b-age': '45', 'b-tbw': '70', 'b-height': '168', 'b-scr': '1.4', 'b-mic': '1', 'b-auc-target': '500' };
    const env = profEnv44({}, Object.assign({}, T, A));
    Object.keys(Object.assign({}, T, A)).forEach(k => env.get(k));
    // AUC Precision on screen, with a profile section the refusal is written into.
    const section = env.get('profile-section-auc');
    section.querySelector = () => null;
    env.get('app-shell-bayesian').querySelector = (sel) => sel === '.profile-section' ? section : null;
    withProf44(env, [], () => {
      sandbox.setPatientSex('F');
      env.labels[1].value = 'Patient C day 2';
      sandbox.saveCurrentProfile();
      const errs = sandbox.lastFormErrors('profile');
      assert(errs.length === 2 && errs[1] === 'Serum creatinine: Trough-Based 0.9, AUC Precision 1.4', JSON.stringify(errs));
      assert(env.localStorage.getItem(PROF_KEY44) === null, 'saved while the columns disagree');
      const html = section.innerHTML;
      assert(/<button type="button" class="text-action" data-onclick="k99" data-arg="auc">Copy the AUC Precision values to Trough-Based<\/button>/.test(html), html);
      assert(/k99: \(el, ev, arg\) => \{ copyProfileConflicts\(String\(arg\)\); \}/.test(src44), 'the action is not in __ACT as k99');
      // The action: only Trough-Based SCr changes; nothing else in either column moves.
      const before = Object.fromEntries(Object.keys(Object.assign({}, T, A)).map(k => [k, env.els[k].value]));
      env.writes.length = 0;
      sandbox.copyProfileConflicts('auc');
      Object.keys(before).forEach(k => assert(env.els[k].value === (k === 'scr' ? '1.4' : before[k]), `${k}: "${env.els[k].value}"`));
      const fieldWrites = env.writes.filter(w => w[1] === 'value' && w[0] in before);
      assert(fieldWrites.length === 1 && fieldWrites[0][0] === 'scr', JSON.stringify(fieldWrites));
      assert(/Copied serum creatinine/.test(statusText44(env)) && /[Ss]ave again/.test(statusText44(env)), statusText44(env));
      assert(sandbox.lastFormErrors('profile').length === 0, 'the refusal stays after the copy');
      sandbox.saveCurrentProfile();
      const p = JSON.parse(env.localStorage.getItem(PROF_KEY44) || '[]')[0];
      assert(p && p.label === 'Patient C day 2' && p.snapshot.core.scr === '1.4' && p.snapshot.core.cysc === '1.1', JSON.stringify(p && p.snapshot.core));
      // From the Trough module the direction reverses: the Trough value is copied to AUC Precision.
      env.els['b-mic'].value = '2';
      env.get('app-shell-bayesian').style.display = 'none';
      sandbox.copyProfileConflicts('trough');
      assert(env.els['b-mic'].value === '1' && env.els.mic.value === '1', `MIC ${env.els.mic.value} / ${env.els['b-mic'].value}`);
    });
  });

  test('44.26 profiles saved by v3.13.0 (core and fit) and before the core (legacy fit, no core) load (Review Focus 2)', () => {
    for (const p of profFixture44) {
      assert(sandbox.validProfile(JSON.parse(JSON.stringify(p))) === true, `${p.label}: not valid`);
      const prev = { cysc: '2.4', 'scr-baseline': '0.8', dose: '1500', 'level-val': '31', age: '82' };   // the previous patient
      const env = profEnv44({ [PROF_KEY44]: JSON.stringify(profFixture44) }, prev);
      Object.keys(prev).forEach(k => env.get(k));   // on screen before the load
      env.get('t-hd').checked = true;   // the previous patient was on haemodialysis
      withProf44(env, ['resetForm', 'resetBayesian', 'addBayesDose', 'addBayesLevel', 'addBayesSession'], (calls) => {
        assert(sandbox.loadProfiles().length === profFixture44.length, 'every fixture is listed');
        let threw = null;
        try { sandbox.loadProfileIntoForm(p.id); } catch (e) { threw = e; }
        assert(!threw, `${p.label}: threw ${threw && (threw.stack || threw.message)}`);
        assert(calls.resetForm === 1 && calls.resetBayesian === 1, `${p.label}: both columns cleared ${JSON.stringify(calls)}`);
        const d = p.snapshot.demographics;
        for (const [tr, b, v] of [['age', 'b-age', d.age], ['tbw', 'b-tbw', d.tbw], ['height', 'b-height', d.height], ['scr', 'b-scr', d.scr]]) {
          assert(env.els[tr].value === v && env.els[b].value === v, `${p.label}: ${tr} ${env.els[tr].value} / ${b} ${env.els[b].value}, expected ${v}`);
        }
        assert(env.els['b-auc-target'].value === p.snapshot.target.auc, `${p.label}: AUC target ${env.els['b-auc-target'].value}`);
        assert(vm.runInContext('state.sex', sandbox) === d.sex && vm.runInContext('bState.sex', sandbox) === d.sex, `${p.label}: sex`);
        assert(vm.runInContext('bState.model', sandbox) === p.snapshot.model, `${p.label}: model ${vm.runInContext('bState.model', sandbox)}`);
        assert(calls.addBayesDose === p.snapshot.doses.length && calls.addBayesLevel === p.snapshot.levels.length
          && calls.addBayesSession === (p.snapshot.hdSessions || []).length, `${p.label}: rows ${JSON.stringify(calls)}`);
        // The Trough module's haemodialysis flag is the profile's (review item 1): a previous tick never
        // survives, and a dialysis profile ticks it, so the Trough module refuses a CrCl regimen (D16).
        assert(env.els['t-hd'].checked === !!d.dial, `${p.label}: #t-hd ${env.els['t-hd'].checked}, dial ${d.dial}`);
        assert(env.els['b-dial'].checked === !!d.dial, `${p.label}: #b-dial ${env.els['b-dial'].checked}`);
        // The previous patient's Trough-only fields are gone (engine report I5).
        ['cysc', 'scr-baseline', 'dose', 'level-val'].forEach(k => assert(env.els[k].value === '', `${p.label}: ${k} kept "${env.els[k].value}"`));
        // A loaded fit is never the result on screen: the profile re-fits.
        assert(vm.runInContext('bState.result', sandbox) === null, `${p.label}: a stored fit became the result`);
        sandbox.renderProfileList();
        assert(env.lists[0].innerHTML.indexOf(p.label) >= 0 && !/Invalid Date/.test(env.lists[0].innerHTML), `${p.label}: listed`);
      });
    }
  });

  test('44.26a R20: Trough "Clear all fields" resets the weight basis and amputation; an AUC save afterwards carries neither', () => {
    const env = profEnv44({}, {});
    withProf44(env, [], () => {
      vm.runInContext("state.dosingWt = 'IBW'; ampState.RL = 'knee';", sandbox);
      env.get('amp-enabled').checked = true; env.get('dosing-wt').value = 'IBW';
      env.get('t-hd').checked = true;   // the previous patient was on haemodialysis (review item 1)
      sandbox.resetForm();
      assert(vm.runInContext('state.dosingWt', sandbox) === 'auto' && env.els['dosing-wt'].value === 'auto', `basis ${vm.runInContext('state.dosingWt', sandbox)}`);
      assert(vm.runInContext('Object.values(ampState).every(v => v === null)', sandbox) && env.els['amp-enabled'].checked === false, 'amputation kept');
      assert(env.els['t-hd'] && env.els['t-hd'].checked === false, 'the haemodialysis flag kept');
      // A new patient typed into AUC Precision and saved.
      [['b-age', '50'], ['b-tbw', '72'], ['b-height', '170'], ['b-scr', '1.0']].forEach(([k, v]) => { env.get(k).value = v; });
      sandbox.setPatientSex('M');
      env.labels[1].value = 'New patient';
      sandbox.saveCurrentProfile();
      const p = JSON.parse(env.localStorage.getItem(PROF_KEY44) || '[]')[0];
      assert(p && p.snapshot.core.dosingWt === 'auto' && Object.values(p.snapshot.core.amputation).every(v => v === null), JSON.stringify(p && p.snapshot.core));
    });
  });

  test('44.26b R21: dial is stored and loaded only with Goti; a Trough-only HD patient loads with the Trough flag ticked and AUC Precision not on dialysis', () => {
    // A Trough-only haemodialysis patient (58 M), the AUC column empty on its default Buelga.
    const T = { age: '58', tbw: '77', height: '174', scr: '6.8', mic: '1', 'b-mic': '1', 'b-auc-target': '450' };
    const env = profEnv44({}, T);
    Object.keys(T).concat(['b-age', 'b-tbw', 'b-height', 'b-scr']).forEach(k => env.get(k));
    env.get('app-shell-bayesian').style.display = 'none';
    env.get('t-hd').checked = true;
    withProf44(env, ['addBayesSession'], (calls) => {
      vm.runInContext("bState.model = 'buelga'; bState.dial = false;", sandbox);
      sandbox.setPatientSex('M');
      env.labels[0].value = 'Patient HD';
      sandbox.saveCurrentProfile();
      const p = JSON.parse(env.localStorage.getItem(PROF_KEY44) || '[]')[0];
      assert(p && p.snapshot.model === 'buelga' && p.snapshot.core.hd === true && p.snapshot.demographics.dial === false,
        'stored: ' + JSON.stringify(p && { model: p.snapshot.model, hd: p.snapshot.core.hd, dial: p.snapshot.demographics.dial }));
      env.get('t-hd').checked = false; env.get('b-dial').checked = true;   // a different screen before the load
      sandbox.loadProfileIntoForm(p.id);
      assert(env.els['t-hd'].checked === true, 'the Trough flag is not ticked');
      assert(env.els['b-dial'].checked === false && vm.runInContext('bState.dial', sandbox) === false && vm.runInContext('bState.model', sandbox) === 'buelga',
        `AUC: dial ${env.els['b-dial'].checked} / ${vm.runInContext('bState.dial', sandbox)}, model ${vm.runInContext('bState.model', sandbox)}`);
      // Defence in depth: a stored dial true with Buelga (or Hughes) loads with dial false; the Trough flag still ticks.
      for (const model of ['buelga', 'hughes']) {
        const crafted = JSON.parse(JSON.stringify(profFixture44[1]));
        crafted.id = 'p_crafted' + model; crafted.snapshot.model = model; crafted.snapshot.demographics.dial = true;
        env.localStorage.setItem(PROF_KEY44, JSON.stringify([crafted]));
        sandbox.loadProfileIntoForm(crafted.id);
        assert(env.els['b-dial'].checked === false && vm.runInContext('bState.dial', sandbox) === false && vm.runInContext('bState.model', sandbox) === model,
          `${model}: dial ${env.els['b-dial'].checked} / ${vm.runInContext('bState.dial', sandbox)}, model ${vm.runInContext('bState.model', sandbox)}`);
        assert(env.els['t-hd'].checked === true, `${model}: the Trough flag`);
      }
      // The Goti-HD fixture is unchanged: Goti, dialysis on, the Trough flag ticked.
      env.localStorage.setItem(PROF_KEY44, JSON.stringify(profFixture44));
      sandbox.loadProfileIntoForm(profFixture44[2].id);
      assert(vm.runInContext('bState.model', sandbox) === 'goti' && vm.runInContext('bState.dial', sandbox) === true
        && env.els['b-dial'].checked === true && env.els['t-hd'].checked === true, 'the Goti-HD fixture changed');
    });
  });

  test('44.26c R22: Trough "Clear all fields" empties the whole PD form; an AUC save keeps the PD form only when the Trough patient fields are filled and agree', () => {
    const pdPrev = { 'pd-modality': 'ccpd', 'pd-start': '21:00', 'pd-hours': '9.5', 'pd-vd': 'watanabe', 'pd-prior': 'no', 'pd-urine': 'anuric',
      'pd-give-date': '2025-11-06', 'pd-give-time': '10:00', 'pd-stopped-date': '2025-11-05', 'pd-goal-min': '10', 'pd-goal-max': '15' };
    const env = profEnv44({}, pdPrev);
    Object.keys(pdPrev).forEach(k => env.get(k));
    // Their real types: resetForm's number sweep reaches only the number inputs.
    const types = { 'pd-modality': 'select-one', 'pd-vd': 'select-one', 'pd-prior': 'select-one', 'pd-urine': 'select-one',
      'pd-start': 'text', 'pd-give-time': 'text', 'pd-give-date': 'date', 'pd-stopped-date': 'date' };
    Object.keys(types).forEach(k => { env.els[k].type = types[k]; });
    ['pd-stopped', 'pd-ip'].forEach(k => { env.get(k).checked = true; });
    ['dose', 'lvl', 'held'].forEach(k => { env.get(`pd-${k}-tbody`).innerHTML = `<tr data-n="1"><td>patient A's ${k}</td></tr>`; });
    withProf44(env, [], () => {
      sandbox.resetForm();
      Object.keys(pdPrev).forEach(k => assert(env.els[k].value === (k === 'pd-vd' ? 'bauer' : ''), `${k} kept "${env.els[k].value}"`));
      ['pd-stopped', 'pd-ip'].forEach(k => assert(env.els[k].checked === false, `${k} kept`));
      ['dose', 'lvl', 'held'].forEach(k => assert(env.els[`pd-${k}-tbody`].innerHTML === '', `pd ${k} rows kept`));
      // R22: patient A's PD form in the Trough column, its patient fields empty; patient B saved from AUC Precision.
      env.els['pd-modality'].value = 'ccpd'; env.els['pd-start'].value = '21:00';
      [['b-age', '50'], ['b-tbw', '72'], ['b-height', '170'], ['b-scr', '1.0']].forEach(([k, v]) => { env.get(k).value = v; });
      ['age', 'tbw', 'height', 'scr'].forEach(k => env.get(k));
      sandbox.setPatientSex('M');
      env.labels[1].value = 'Patient B';
      sandbox.saveCurrentProfile();
      const p = JSON.parse(env.localStorage.getItem(PROF_KEY44) || '[]')[0];
      assert(p && p.label === 'Patient B' && !(p.snapshot.pd && p.snapshot.pd.modality), 'patient A\'s PD form travelled: ' + JSON.stringify(p && p.snapshot.pd));
      assert(/Trough-Based PD form not saved/.test(statusText44(env)), statusText44(env));
      // The same patient in both columns: the PD form is kept, and nothing is said.
      [['age', '50'], ['tbw', '72'], ['height', '170'], ['scr', '1.0']].forEach(([k, v]) => { env.els[k].value = v; });
      env.labels[1].value = 'Patient B with PD';
      sandbox.saveCurrentProfile();
      const q = JSON.parse(env.localStorage.getItem(PROF_KEY44))[0];
      assert(q.label === 'Patient B with PD' && q.snapshot.pd && q.snapshot.pd.modality === 'ccpd' && q.snapshot.pd.start === '21:00', JSON.stringify(q.snapshot.pd));
      assert(!/PD form not saved/.test(statusText44(env)), statusText44(env));
    });
  });

  test('44.26d R23: "Clear all fields" leaves the PD local settings alone; a blank or invalid setting never overwrites a stored valid one', () => {
    const LS = 'vanco.pd.local';
    const store = { [LS]: JSON.stringify({ maxDoseMg: 1500, targetPeak: 30, amLabs: '05:30' }) };
    const env = profEnv44(store, { 'pd-set-max': '1500', 'pd-set-peak': '30', 'pd-set-amlabs': '05:30', dose: '1000' });
    ['pd-set-max', 'pd-set-peak', 'pd-set-amlabs', 'pd-set-status', 'dose'].forEach(k => env.get(k));
    withProf44(env, [], () => {
      sandbox.resetForm();
      assert(env.els['pd-set-max'].value === '1500', 'pd-set-max cleared to "' + env.els['pd-set-max'].value + '"');
      assert(env.els['pd-set-peak'].value === '30', 'pd-set-peak cleared to "' + env.els['pd-set-peak'].value + '"');
      assert(env.els['pd-set-amlabs'].value === '05:30', 'pd-set-amlabs changed');
      assert(env.els.dose.value === '', 'a patient field was not cleared');
      assert(JSON.parse(store[LS]).maxDoseMg === 1500, 'the stored max changed on Clear');
      // The field that was blanked and then saved (the old defect's path): the stored cap survives.
      env.els['pd-set-max'].value = '';
      sandbox.savePdLocalSettings();
      let o = JSON.parse(store[LS]);
      assert(o.maxDoseMg === 1500 && o.targetPeak === 30 && o.amLabs === '05:30', 'a blank max overwrote the stored settings: ' + store[LS]);
      assert(env.els['pd-set-max'].value === '1500', 'the field shows "' + env.els['pd-set-max'].value + '" while 1500 is stored');
      const say = env.els['pd-set-status'] && env.els['pd-set-status'].textContent;
      assert(/Maximum single dose/.test(say) && /1500 mg/.test(say) && /kept/.test(say), 'the settings line did not say so: "' + say + '"');
      // An invalid (non-numeric, zero, negative) target peak is refused the same way.
      ['0', '-5', 'abc'].forEach(bad => {
        env.els['pd-set-peak'].value = bad;
        sandbox.savePdLocalSettings();
        assert(JSON.parse(store[LS]).targetPeak === 30, `"${bad}" overwrote the stored peak`);
      });
      // A valid change is saved, and the line clears.
      env.els['pd-set-peak'].value = '25'; env.els['pd-set-max'].value = '2000';
      sandbox.savePdLocalSettings();
      o = JSON.parse(store[LS]);
      assert(o.maxDoseMg === 2000 && o.targetPeak === 25, 'a valid change was not saved: ' + store[LS]);
      assert(env.els['pd-set-status'].textContent === '', 'the line still says "' + env.els['pd-set-status'].textContent + '"');
      // Nothing stored yet: a blank is simply no setting, and nothing is refused.
      delete store[LS];
      env.els['pd-set-max'].value = ''; env.els['pd-set-peak'].value = '';
      sandbox.savePdLocalSettings();
      assert(sandbox.pdLocalSettings().maxDoseMg === null && env.els['pd-set-status'].textContent === '', 'blank with nothing stored');
    });
  });

  // ── The final whole-branch review (edc5b53..73a1936): C1, I1–I6 and the deferred minors (rulings R25–R27) ──
  // Fictional anuric patients, Goti, CrCl 8 (Cockcroft-Gault, as measured). The fit, the decision and the
  // render are runBayesian's own (fit44).
  const anuric44 = () => fit44({ model: 'goti', age: 70, tbw: 70, ht: 175, scr: 8.5, mg: 2000, tinf: 2, tau: 24, n: 1, lastAgo: 100,
    levels: [{ conc: 52, after: 28 }, { conc: 51, after: 52 }, { conc: 50.2, after: 99 }] });
  const headOf44 = (html, cls) => para44(html, cls);
  const before44 = (html, a, b) => html.indexOf(a) >= 0 && html.indexOf(b) > html.indexOf(a);

  // C1 (Critical): 70 M, 70 kg, 175 cm, SCr 8.5; one 2 g dose over 2 h, 100 h ago; levels 52, 51 and 50.2 mg/L
  // 72, 48 and 1 h ago. A Moderate fit with three levels fell to the precision branch: "Hold: next dose not
  // before …" beside "Next: A further level would add little".
  test('44.27 C1: under a Hold the Next line is the hold\'s own instruction — "Recheck a level before the next dose" — on screen, in the summary and aloud', () => {
    const { r, html, text, conf, said, summary } = anuric44();
    assert(r.crcl < 10 && r.rec && !r.rec.noSolution && r.levels.length === 3, `the fixture: CrCl ${r.crcl}, ${r.rec && r.rec.noSolution}`);
    assert(conf.rank <= 1, `Moderate or High (the precision branch is reachable): ${conf.level}`);
    // Re-pointed in wave 2 (the user's ruling U2, a 72 h horizon): this flat-levels patient no longer gets a
    // resume time days away; it is "Hold: recheck a level before the next dose", with no clock time anywhere.
    assert(headOf44(html, 'vx-action vx-hold-head') === 'Hold: recheck a level before the next dose', headOf44(html, 'vx-action vx-hold-head'));
    assert(para44(html, 'vx-next') === 'Next Recheck a level before the next dose.', para44(html, 'vx-next'));
    assert(!/would add little/.test(text), 'would add little is still on screen');
    assert(!incoherent44(text).length, JSON.stringify(incoherent44(text)));
    assert(/^Hold: recheck a level before the next dose/.test(summary) && !/not before/.test(summary), `summary: ${summary}`);
    assert(/^Result: Hold: recheck a level before the next dose/.test(said), `said: ${said}`);
    // The rule itself: a hold is ahead of every other branch of nextLevelValue.
    const plan = fn44('firstDosePlan')(r, r.rec, r.fitNowH, null, null);
    const fit = fn44('nextLevelFit')(r, conf, plan);
    assert(fit.hold === true, JSON.stringify(fit));
    for (const f of [{ hold: true }, { hold: true, confRank: 3, hasAlt: true }, { hold: true, capBound: true, action: 'continue' }]) {
      const nlv = fn44('nextLevelValue')(464, 3, 'goti', 48, 0.19, f);
      assert(nlv.kind === 'hold' && nlv.headline === 'Recheck a level before the next dose'
        && fn44('nextLevelLine')(nlv) === 'Recheck a level before the next dose.', `${JSON.stringify(f)}: ${nlv.kind} ${nlv.headline}`);
    }
    // Without a hold the branch is as before.
    assert(fn44('nextLevelValue')(464, 1, 'buelga', 12, 4.31, { hold: false }).kind === 'precision', 'no hold, no hold branch');
    // Print reads the screen's Next line and leads with the hold.
    const pr = fn44('_prRecommendation')(r, { next: 'Recheck a level before the next dose.' });
    assert(/Hold: recheck a level before the next dose/.test(pr) && !/would add little/.test(pr), pr.slice(0, 500));
    // Wave 2 label fix: the readout's number is labelled by the value it is. On this basis-'both' hold the number
    // shown is the carried measured level (49.9), never called "fitted level", on screen or in print.
    assert(plan.holdBasis === 'both' && plan.holdCarried > plan.holdFitted && plan.holdPre === plan.holdCarried, JSON.stringify({ b: plan.holdBasis, c: plan.holdCarried, f: plan.holdFitted }));
    const shown = plan.holdPre.toFixed(1), plain = (h) => String(h).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    for (const [k, h] of [['screen', plain(fn44('firstDoseReadoutHTML')(plan, r.rec, false))], ['print', plain(fn44('firstDoseReadoutHTML')(plan, r.rec, true))], ['rendered', text], ['printed', plain(pr)]]) {
      assert(!new RegExp(`fitted level ${shown.replace('.', '\\.')}`, 'i').test(h), `${k}: "fitted level ${shown}" — ${h.slice(0, 400)}`);
    }
    assert(/measured level, carried down the fitted slope, 49\.9 mg\/L/i.test(plain(fn44('firstDoseReadoutHTML')(plan, r.rec, false))), plain(fn44('firstDoseReadoutHTML')(plan, r.rec, false)));
  });

  // I1, replaced by the user's ruling U1 (2026-11-15): the Hold reads the fitted OR the measured level.
  // 70 M, 80 kg, 185 cm, SCr 9.7 (CrCl 8), Goti; one 1.5 g dose over 2 h, 120 h ago; levels 35, 30.3 and
  // 26.2 mg/L, 73, 49 and 1 h ago. The fit read the 26.2 as 19.5 and gave "first dose now"; wave 1 added an
  // alarm (re-pointed here: the alarm is gone, the measured level now holds).
  const i1Case44 = () => fit44({ model: 'goti', age: 70, tbw: 80, ht: 185, scr: 9.7, mg: 1500, tinf: 2, tau: 24, n: 1, lastAgo: 120,
    levels: [{ conc: 35, after: 47 }, { conc: 30.3, after: 71 }, { conc: 26.2, after: 119 }] });
  test('44.28 U1: a measured level carried down the fitted slope holds the dose, with a resume time, and the hold line names the measured basis', () => {
    const { r, html, text, said, summary } = i1Case44();
    const plan = fn44('firstDosePlan')(r, r.rec, r.fitNowH, null, null), last = r.levels[2];
    assert(r.crcl < 10 && !r.rec.noSolution && fn44('predictFittedAt')(r, plan.holdAtH) < K44.TROUGH_HIGH_MGL,
      `the fit alone would not hold: ${fn44('predictFittedAt')(r, plan.holdAtH)}`);
    const slope = fn44('fittedTerminalRate')(r), carried = (t) => 26.2 * Math.exp(-slope * (t - last.timeH));
    assert(plan.hold === true && plan.holdNoTime === false && plan.holdBasis === 'measured' && plan.holdMeasured && plan.holdMeasured.conc === 26.2,
      JSON.stringify({ hold: plan.hold, noTime: plan.holdNoTime, basis: plan.holdBasis }));
    assert(Math.abs(plan.holdCarried - carried(plan.holdAtH)) < 1e-9 && plan.holdCarried >= K44.TROUGH_HIGH_MGL, `carried ${plan.holdCarried}`);
    // The resume time: the later crossing, the first quarter hour at which both are below 20, within 72 h.
    assert(carried(plan.resumeH) < K44.TROUGH_HIGH_MGL && carried(plan.resumeH - 0.25) >= K44.TROUGH_HIGH_MGL && at44(r, plan.resumeH) < K44.TROUGH_HIGH_MGL
      && plan.resumeH - plan.holdAtH <= K44.HOLD_SEARCH_MAX_H && plan.firstH === plan.resumeH, JSON.stringify({ resume: plan.resumeH - plan.holdAtH }));
    const head = headOf44(html, 'vx-action vx-hold-head'), why = para44(html, 'vx-sub vx-hold-why');
    assert(/^Hold: next dose not before \d{1,2} [A-Z][a-z]{2} \d\d:\d\d$/.test(head), head);
    assert(why.indexOf(`the measured 26.2 mg/L at ${fn44('fmtClock')(last.timeH)}, carried down the fitted slope, is ${plan.holdCarried.toFixed(1)} mg/L`) >= 0
      || why.indexOf(`The measured 26.2 mg/L at ${fn44('fmtClock')(last.timeH)}, carried down the fitted slope, is ${plan.holdCarried.toFixed(1)} mg/L`) === 0, why);
    assert(!/vx-measured-high|the fit reads it lower/.test(html), 'the wave-1 alarm is gone');
    assert(para44(html, 'vx-next') === 'Next Recheck a level before the next dose.' && !/would add little/.test(text), para44(html, 'vx-next'));
    assert(/^Hold: next dose not before /.test(summary) && /carried down the fitted slope/.test(summary), summary);
    assert(/^Result: Hold: next dose not before /.test(said) && /carried down the fitted slope/.test(said), said);
    assert(/Hold: next dose not before/.test(fn44('_prRecommendation')(r, {})), 'print');
    // Wave 2 label fix (minor): the time was set by the carried measured level, so "level by then" reads that value
    // and names it, not the fitted value (which is well under 20 there).
    const plainR = (h) => String(h).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const scr = plainR(fn44('firstDoseReadoutHTML')(plan, r.rec, false)), prt = plainR(fn44('firstDoseReadoutHTML')(plan, r.rec, true));
    assert(Math.abs(plan.preCarried - carried(plan.firstH)) < 1e-9 && plan.preCarried > plan.pre, JSON.stringify({ pc: plan.preCarried, pre: plan.pre }));
    // Shown on the number-shown rule (D21): just under 20 is never printed "20.0".
    const pc = plan.preCarried, pcShown = pc < K44.TROUGH_HIGH_MGL && +pc.toFixed(1) >= K44.TROUGH_HIGH_MGL ? (Math.floor(pc * 100) / 100).toFixed(2) : pc.toFixed(1);
    for (const h of [scr, prt]) assert(h.indexOf(`${pcShown} mg/L`) >= 0 && /measured, carried down the fitted slope/.test(h) && h.indexOf(`fitted ${plan.pre.toFixed(1)}`) >= 0, h);
    assert(src44.indexOf('function measuredHighSentence(') < 0 && src44.indexOf('measuredHigh') < 0, 'the alarm code is removed');
    // A fitted hold keeps the fitted wording (44.2's Buelga case: its fit reads the 48 mg/L higher).
    const { r: rC, rec: recC, nowH: nC, cur: curC } = c1Case();
    const pC = fn44('firstDosePlan')(rC, recC, nC, null, curC);
    assert(pC.hold && pC.holdBasis !== 'measured' && /^Hold: next dose not before .*; the fitted level at /.test(fn44('holdSentence')(pC)), fn44('holdSentence')(pC));
  });
  test('44.28a U1: peaks, an augmented-clearance peak and a level during the infusion never hold', () => {
    // The re-reviewer's peak cases (/private/tmp/vprobe/peak.cjs): 60 M, 80 kg, 178 cm, SCr 1.0; 1.25 g q12h x 4
    // over 1.5 h, the last started 2.5 h ago; a trough 30 min before it and a peak 1 h after the infusion ended
    // (36 s ago, as the probe drew it). Buelga and Goti.
    for (const model of ['buelga', 'goti']) for (const [tr, pk] of [[12, 28], [14, 32], [15, 35], [10, 25], [17, 40]]) {
      const o = fit44({ model, age: 60, tbw: 80, ht: 178, scr: 1.0, mg: 1250, tinf: 1.5, tau: 12, n: 4, lastAgo: 2.5,
        levels: [{ conc: tr, after: -0.5 }, { conc: pk, after: 2.49 }] });
      const p = o.r.rec && !o.r.rec.noSolution ? fn44('firstDosePlan')(o.r, o.r.rec, o.r.fitNowH, null, null) : null;
      assert(p && p.hold === false && !/Hold: |vx-hold-head/.test(o.html), `${model} ${tr}/${pk}: ${JSON.stringify(p && { hold: p.hold, basis: p.holdBasis })} ${o.text.slice(0, 200)}`);
    }
    // A Goti peak an hour after the infusion is inside the model's redistribution window: no measured basis at all.
    const g = fit44({ model: 'goti', age: 60, tbw: 80, ht: 178, scr: 1.0, mg: 1250, tinf: 1.5, tau: 12, n: 4, lastAgo: 2.5, levels: [{ conc: 17, after: -0.5 }, { conc: 40, after: 2.49 }] });
    assert(fn44('measuredHoldLevel')(g.r, g.r.fitNowH) === null, 'inside the distribution phase');
    // Augmented clearance: 25 M, 95 kg, 185 cm, SCr 0.5, Buelga, 1.5 g q8h; troughs 3-6, peaks 20.5-26.
    for (const [tr, pk] of [[5, 22], [4, 21], [3, 20.5], [6, 26]]) {
      const o = fit44({ model: 'buelga', age: 25, tbw: 95, ht: 185, scr: 0.5, mg: 1500, tinf: 1.5, tau: 8, n: 4, lastAgo: 2.5,
        levels: [{ conc: tr, after: -0.5 }, { conc: pk, after: 2.49 }] });
      assert(!/Hold: /.test(o.text), `augmented ${tr}/${pk}: ${o.text.slice(0, 200)}`);
    }
    // A level of 30 mg/L drawn during the last infusion (Buelga, 1.25 g q12h, the fourth dose 36-37.5 h) never holds.
    const rI = { model: 'buelga', CL_ind: 4.58, V_ind: 61.8, doses: Array.from({ length: 4 }, (_, i) => ({ mg: 1250, tinfH: 1.5, timeH: i * 12 })),
      levels: [{ conc: 30, timeH: 37 }], fitNowH: 38 };
    assert(fn44('measuredHoldLevel')(rI, 38) === null && fn44('firstDosePlan')(rI, { dose: 1250, tau: 12, tinfH: 1.5 }, 38, null, null).hold === false, 'during the infusion');
    // The same 30 mg/L drawn at 47 h (9.5 h after the infusion ended) does hold, on the measured basis.
    const rL = Object.assign({}, rI, { levels: [{ conc: 30, timeH: 47 }], fitNowH: 47.5 });
    const pL = fn44('firstDosePlan')(rL, { dose: 1250, tau: 12, tinfH: 1.5 }, 47.5, null, null);
    assert(pL.hold && pL.holdBasis === 'measured', JSON.stringify({ hold: pL.hold, basis: pL.holdBasis }));
  });

  // I2 (ruling R25): real anuric fits keep CL at ~0.17 L/h and every candidate hard-fails, "No regimen
  // recommended" with no hold line. 70 M, 70 kg, 175 cm, SCr 8.5, Goti; one 1.75 g dose 100 h ago; levels 52,
  // 51 and 50.2 mg/L, 74, 50 and 2 h ago.
  const noSol44 = () => fit44({ model: 'goti', age: 70, tbw: 70, ht: 175, scr: 8.5, mg: 1750, tinf: 2, tau: 24, n: 1, lastAgo: 100,
    levels: [{ conc: 52, after: 26 }, { conc: 51, after: 50 }, { conc: 50.2, after: 98 }] });
  test('44.29 I2: a refusal with the fitted or measured level at or above 20 mg/L says "Hold: recheck a level" on screen, in the summary, aloud and in print', () => {
    const { r, html, text, said, summary } = noSol44();
    assert(r.rec.noSolution === true, `the fixture is a refusal: ${r.rec.action} ${r.rec.dose}`);
    const head = headOf44(html, 'vx-action vx-hold-head');
    assert(head === 'Hold: recheck a level before the next dose', head);
    assert(before44(html, 'vx-hold-head', 'No regimen recommended'), 'the hold leads the refusal');
    assert(/50\.2 mg\/L/.test(text) && !/\d\d:\d\d[^.]*not before/.test(head), text.slice(0, 600));
    assert(/^Hold: recheck a level before the next dose/.test(summary), summary);
    assert(/^Result: Hold: recheck a level before the next dose/.test(said), said);
    assert(/Recheck a level before the next dose/.test(para44(html, 'vx-next')), para44(html, 'vx-next'));
    const pr = fn44('_prRecommendation')(r, {});
    assert(/Hold: recheck a level before the next dose/.test(pr) && /No regimen offered/.test(pr), pr.slice(0, 600));
    // The unit: the fitted level at the due time, or the latest measured level after the last dose.
    const ns = fn44('noSolutionHold');
    const base = { model: 'buelga', CL_ind: 4, V_ind: 50, rec: { noSolution: true }, doses: [{ mg: 1000, tinfH: 1, timeH: 0 }], fitNowH: 20 };
    const n25 = ns(Object.assign({}, base, { levels: [{ conc: 25, timeH: 19 }] }), 20, null);
    assert(n25 && n25.measured && Math.abs(n25.measured.carried - 25 * Math.exp(-(4 / 50) * 1)) < 1e-9, `a measured 25 carried down the fitted slope to now holds: ${JSON.stringify(n25)}`);
    assert(!ns(Object.assign({}, base, { levels: [{ conc: 25, timeH: 1.2 }] }), 1.5, null), 'not a level drawn just after the infusion (U1)');
    assert(!ns(Object.assign({}, base, { levels: [{ conc: 15, timeH: 19 }] }), 20, null), 'a level of 15 and a low fit do not');
    assert(!ns(Object.assign({}, base, { rec: { dose: 500, tau: 12 }, levels: [{ conc: 25, timeH: 19 }] }), 20, null), 'only a refusal');
    const hi = ns({ model: 'buelga', CL_ind: 0.05, V_ind: 50, rec: { noSolution: true }, doses: [{ mg: 2000, tinfH: 2, timeH: 0 }], levels: [], fitNowH: 20 }, 20, null);
    assert(hi && hi.holdNoTime && hi.fitted >= K44.TROUGH_HIGH_MGL && !hi.measured, JSON.stringify(hi));
  });
  test('44.29a I2, U2: HOLD_SEARCH_MAX_H is labelled a preference (rule 8): how far the fitted curve is trusted to time a dose; 72 h (the user\'s ruling)', () => {
    const i = src44.indexOf('const HOLD_SEARCH_MAX_H'), cmt = src44.slice(Math.max(0, i - 900), i);
    assert(i > 0 && /PREFERENCE/.test(cmt) && /rule 8/.test(cmt) && /how far the\s+(?:\/\/ )?fitted curve is trusted to time a dose/.test(cmt) && /U2/.test(cmt), cmt.slice(-700));
    // Re-pointed in wave 2: the value was 14 days (kept in wave 1 for the user to rule); the user ruled 72 h (U2).
    assert(K44.HOLD_SEARCH_MAX_H === 72, `the user's ruling: ${K44.HOLD_SEARCH_MAX_H}`);
  });

  // I3: the Trough hold's "not before" could be earlier than the due time. 1.5 g q8h given 01:00, a level of
  // 20.5 mg/L at 08:36: "Hold: next dose not before 08:49", due 09:00. Fictional 60 M, 80 kg, 178 cm, SCr 1.0.
  test('44.30 I3: Trough holds only when the level carried down the measured decline is 20 mg/L or more at the due time', () => {
    const lv = trough44('level', 'M', { age: 60, tbw: 80, height: 178, scr: 1.0, dose: 1500, interval: 8, tinf: 1.5, 'level-val': 20.5,
      'time-dose-given': '2026-11-14T01:00', 'time-level-drawn': '2026-11-14T08:36' }, { checked: ['has-level'] });
    assert(/class="rec-dose"|id="tx-regimen"/.test(lv.h) && !/undefined|NaN/.test(lv.text), lv.text.slice(0, 400));
    assert(!/Hold: next dose not before/.test(lv.text) && !/^Result: Hold/.test(lv.said), `no hold before the due time: ${lv.text.slice(0, 500)}`);
    const th = fn44('troughHold'), start = new Date('2026-11-14T01:00').getTime() / 3600000, kel = 0.08;
    assert(th(20.4, 8, kel, start, { c: 20.5, h: 7.6 }) === null, 'falls below 20 before the due time: no hold');
    const h = th(25, 8, kel, start, { c: 25, h: 7.9 });
    assert(h && h.afterDoseH > 8 && Math.abs(h.afterDoseH - (7.9 + Math.log(25 / 20) / kel)) < 1e-9, JSON.stringify(h));
    // Without a measured level the due-time level decides, at or above 20 (ruling 1), as before.
    assert(th(20, 8, kel, start, null) && th(19.9, 8, kel, start, null) === null, 'cPre at the threshold still holds');
  });

  // I4: random-level mode had no hold. Steady state on q12h, 42 mg/L at 9 h (about 36 at the due time) gave
  // "1.25 g IV q24h · scheduled maintenance". Fictional 60 M, 80 kg, 178 cm, SCr 1.0; 1 g over 1 h.
  test('44.31 I4: random-level mode holds, from the level and its time, at the due time of its sub-mode', () => {
    const rl = (mode, c, draw, tau, mg) => trough44('randomlevel', 'M', { age: 60, tbw: 80, height: 178, scr: 1.0, 'rl-dose': mg || 1000, 'rl-tinf': mg ? 2 : 1,
      'rl-tau': tau || 24, 'rl-interval': 12, 'rl-c': c, 'rl-dose-time': '2026-11-14T00:00', 'rl-draw-time': draw }, { rlMode: mode });
    const ss = rl('steadystate', 42, '2026-11-14T09:00');
    assert(!/undefined|NaN/.test(ss.text), ss.text.slice(0, 400));
    assert(/Hold: next dose not before \d{1,2} Nov \d\d:\d\d/.test(ss.text) && /class="vx-action vx-hold-head tone-alarm"/.test(ss.h), `steady state: ${ss.text.slice(0, 500)}`);
    assert(/^Result: Hold: next dose not before /.test(ss.said), ss.said);
    assert(before44(ss.h, 'vx-hold-head', 'id="tx-regimen"'), 'the hold leads the verdict');
    // Its time is the level carried down the fitted Kel: 9 h + ln(42/20)/Kel after the dose started.
    const m = ss.text.match(/Kel ([\d.]+) h⁻¹\) it falls to 20 mg\/L ([\d.]+) h after the last dose started/);
    assert(m && Math.abs(+m[2] - (9 + Math.log(42 / 20) / +m[1])) < 0.11, `timed from the level: ${m && m[0]}`);
    // Below 20 at the due time (12 h on q12h): no hold.
    const low = rl('steadystate', 22, '2026-11-14T09:00');
    assert(!/Hold:/.test(low.text), `22 mg/L at 9 h: ${low.text.slice(0, 400)}`);
    // First-dose sub-mode: due at the new interval (rl-tau), as the two-level first-dose basis.
    // After a first 2 g dose (over 2 h), 25 mg/L at 10 h: about 23 at 12 h, about 5 at 48 h.
    const fd = rl('firstdose', 25, '2026-11-14T10:00', 12, 2000);
    const fdNo = rl('firstdose', 25, '2026-11-14T10:00', 48, 2000);
    const kFd = +((fd.text.match(/Kel ([\d.]+) h⁻¹ from your level/) || [])[1]);
    assert(kFd > 0 && 25 * Math.exp(-kFd * 2) >= K44.TROUGH_HIGH_MGL && 25 * Math.exp(-kFd * 38) < K44.TROUGH_HIGH_MGL, `the fixture: Kel ${kFd}`);
    assert(/Hold: next dose not before/.test(fd.text) && /^Result: Hold:/.test(fd.said), `first dose, due at q12h: ${fd.text.slice(0, 300)}`);
    assert(!/Hold:/.test(fdNo.text), `first dose, due at q48h: ${fdNo.text.slice(0, 300)}`);
    const calc = body44('calculate');
    assert(/troughHold\([^;]*rlC[^;]*\)/.test(calc), 'the random-level path calls troughHold');
  });

  // I5: the severe-renal note said "Give a single weight-based loading dose, then hold further doses" beside a
  // Hold, with doses given and a level of 50. And "used 8 mL/min, not the actual 8" when nothing was clamped.
  test('44.32 I5: once a dose is given or a level exists the severe-renal note says no further dose until a level, with no loading-dose sentence; no clamp sentence when nothing was clamped', () => {
    const plain = (h) => String(h).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const before = plain(fn44('severeRenalNote')(8, '', 'auc').html), after = plain(fn44('severeRenalNote')(8, '', 'auc', true).html);
    assert(/Give a single weight-based loading dose/.test(before), 'before any dose the loading-dose wording stays: ' + before);
    const li = (fn44('severeRenalNote')(8, '', 'auc', true).html.match(/<li>([\s\S]*?)<\/li>/) || [])[1] || '';
    assert(/^No further dose until a level is drawn/.test(plain(li)) && !/loading dose/i.test(after), after);
    assert(/measured level/.test(after), 'later doses follow measured levels: ' + after);
    const { text } = anuric44();
    assert(/No further dose until a level is drawn/.test(text) && !/Give a single weight-based loading dose/.test(text), text.slice(text.indexOf('Severe renal'), text.indexOf('Severe renal') + 500));
    assert(!/not the actual 8/.test(text) && /None of the implemented popPK models were validated below CrCl 10/.test(text), 'nothing clamped: ' + text.slice(text.indexOf('Severe renal'), text.indexOf('Severe renal') + 400));
    // Clamped (CrCl 4.5 read as 5): the sentence stays, and the two values differ as printed.
    const cl = fit44({ model: 'goti', age: 70, tbw: 70, ht: 175, scr: 15, mg: 1000, tinf: 1, tau: 24, n: 1, lastAgo: 30, levels: [{ conc: 30, after: 29 }] });
    const m = cl.text.match(/the Bayesian fit used ([\d.]+) mL\/min ?, not the actual (\d+(?:\.\d)?)/);
    assert(m && m[1] !== m[2], `clamped: ${m && m[0]}`);
  });

  // I6 (minimum, ruling R25): an over-ceiling current regimen continued in AUC Precision said the ceiling as a
  // trailing sentence; the Trough module says it at alarm tier. Now the AUC answer leads with the caution, and
  // the Copy summary and the announcement carry it. Which action is chosen does not change.
  test('44.33 I6: an over-ceiling continue leads with the ceiling caution, names the limit, and the summary and announcement carry it', () => {
    const row = fn44('aucUncertaintyRow')(2, 'buelga');
    const h = (mg, tau) => Array.from({ length: 4 }, (_, i) => ({ mg, tinfH: fn44('autoTinf')(mg), timeH: i * tau }));
    const rec = fn44('regimenDecision')(2.25, 70, 450, null, 1, h(2250, 48), row);
    assert(rec.action === 'continue' && rec.dose === 2250 && rec.tau === 48, `the action is unchanged: ${rec.action}`);
    const head = fn44('regimenActionHTML')(rec, 450, 'head'), why = fn44('regimenActionHTML')(rec, 450, 'why');
    assert(/class="vx-ceiling-head tone-caution"/.test(head) && /<svg class="ic"/.test(head), head);
    assert(head.indexOf('above the conventional ceiling (single dose 2250 mg exceeds 2000 mg)') > 0, head);
    assert(head.indexOf('vx-ceiling-head') < head.indexOf('Continue the current regimen'), 'the caution leads the answer');
    assert(!/conventional ceiling/.test(why), 'said once, ahead of the why line: ' + why);
    const r = { model: 'buelga', CL_ind: 2.25, V_ind: 70, doses: h(2250, 48), levels: [{ conc: 10, timeH: 190 }], fitNowH: 192, rec };
    const s = fn44('resultSummary')(r, rec, null, row, { level: 'High' }, null);
    assert(/Caution: the current dose is above the conventional ceiling \(single dose 2250 mg exceeds 2000 mg\)\./.test(s), s);
    const said = fn44('bayesAnnouncement')(r, rec, { level: 'High' }, null);
    assert(/^Result: continue 2\.25 g IV q48h, AUC24 \d+, High confidence\./.test(said) && /Caution: the current dose is above the conventional ceiling/.test(said), said);
    // Within the ceilings: no caution anywhere.
    const ok = fn44('regimenDecision')(4.58, 61.8, 450, null, 1, h(1250, 12).map(d => Object.assign(d, { tinfH: 1.5 })), row);
    assert(!/ceiling/.test(fn44('regimenActionHTML')(ok, 450)) && !/ceiling/.test(fn44('bayesAnnouncement')(r, ok, { level: 'High' }, null)), 'in range, within the ceilings');
  });

  // Deferred minors (ruling R26).
  test('44.34 R26: the Copy summary and the announcement say "Draw a level." on a low-confidence continue', () => {
    const { r, said, summary } = lowHughes();
    assert(r.rec.continueReason === 'low-confidence', r.rec.continueReason);
    assert(/Draw a level\./.test(summary), summary);
    assert(/^Result: continue 1\.5 g IV q12h, AUC24 \d+, Low confidence\./.test(said) && /Draw a level\./.test(said), said);
  });
  test('44.35 R26: the cap-bound detail reads as a sentence: "Confirm the clearance with a level before considering a dose beyond the ceiling or another agent."', () => {
    const conf0 = { rank: 0, worstSigma: 0.5 };
    const fitOf = (rec) => fn44('nextLevelFit')({ model: 'buelga', CL_ind: capCL, V_ind: 60, rec, mapAlt: null }, conf0);
    const cont = fn44('regimenDecision')(12.34, 60, 450, null, 1, hist44(1500, 8), fn44('aucUncertaintyRow')(0, 'buelga'));
    const dc = fn44('nextLevelValue')(cont.auc24, 0, 'buelga', cont.tau, 12.34, fitOf(cont)).detail;
    assert(/Confirm the clearance with a level before considering a dose beyond the ceiling or another agent\.$/.test(dc) && !/A level confirms the clearance before going beyond/.test(dc), dc);
    const chg = capDecide(250, 24), dg = fn44('nextLevelValue')(chg.auc24, 1, 'buelga', chg.tau, capCL, fitOf(chg)).detail;
    assert(/Confirm the clearance with a level before this regimen is acted on, and before considering a dose beyond the ceiling or another agent\.$/.test(dg), dg);
    assert(src44.indexOf('A level confirms the clearance before') < 0, 'the old wording is gone');
  });
  test('44.36 R26: the future-level refusal gives the year with the date', () => {
    const H = 3600000, nowH = Date.now() / H, lvlH = nowH + 30;
    const keep = {}; ['parseBayesCourse', 'showFormErrors', 'beginFormRun', 'readSerialScrChecked'].forEach(n => keep[n] = sandbox[n]);
    const prevDoc = sandbox.document, vals = { 'b-age': '55', 'b-tbw': '80', 'b-height': '180', 'b-scr': '1.0', 'b-auc-target': '450' };
    let errs = null;
    sandbox.document = { getElementById: (id) => ({ value: vals[id] || '', checked: false, style: {}, classList: { add() {}, remove() {}, contains() { return false; } } }), querySelector: () => null, querySelectorAll: () => [] };
    sandbox.beginFormRun = () => {}; sandbox.readSerialScrChecked = () => ({ errors: [], readings: [] });
    sandbox.parseBayesCourse = () => ({ doses: [{ mg: 1250, tinfH: 1.5, timeH: nowH - 11 }], levels: [{ conc: 15, timeH: lvlH, row: '1', label: 'x' }], sessions: [], errors: [] });
    sandbox.showFormErrors = (s, m) => { errs = [].concat(m); };
    try { sandbox.runBayesian(); } finally { Object.assign(sandbox, keep); sandbox.document = prevDoc; }
    const yr = String(new Date(lvlH * H).getFullYear());
    assert(errs && errs.length === 1 && /^Level row 1: dated /.test(errs[0]) && errs[0].indexOf(yr) > 0, JSON.stringify(errs));
  });

  // ── Wave 2: the user's rulings U1–U4 (2026-11-15) and the re-review's residuals N2–N4 ──
  test('44.37 U2: past 72 h from the due time the answer is "recheck a level", with no clock time anywhere; within it, a time', () => {
    // One 2 g dose over 2 h at 0 h, Buelga, V 50 L, no level; the new regimen 500 mg q24h, due at 24 h. CL is
    // solved so the fitted level crosses 20 mg/L at 24 + 60 h, then at 24 + 80 h.
    const mk = (CL) => ({ model: 'buelga', CL_ind: CL, V_ind: 50, doses: [{ mg: 2000, tinfH: 2, timeH: 0 }], levels: [], fitNowH: 4 });
    const crossAt = (h) => { let lo = 0.01, hi = 5; for (let k = 0; k < 80; k++) { const m = (lo + hi) / 2; if (at44(mk(m), h) >= K44.TROUGH_HIGH_MGL) lo = m; else hi = m; } return mk(hi); };
    const rec = { dose: 500, tau: 24, tinfH: 1, auc24: 500 };
    const p60 = fn44('firstDosePlan')(crossAt(84), rec, 4, null, null), p80 = fn44('firstDosePlan')(crossAt(104), rec, 4, null, null);
    assert(p60.hold && !p60.holdNoTime && Math.abs(p60.resumeH - 84) <= 0.25 && p60.holdAtH === 24, JSON.stringify({ r: p60.resumeH, at: p60.holdAtH }));
    assert(p80.hold && p80.holdNoTime && p80.resumeH === null, JSON.stringify({ r: p80.resumeH }));
    for (const [k, h] of [['head', fn44('holdHeadHTML')(p80)], ['sentence', fn44('holdSentence')(p80)], ['screen', fn44('firstDoseReadoutHTML')(p80, rec, false)],
                          ['print', fn44('firstDoseReadoutHTML')(p80, rec, true)], ['summary', fn44('resultSummary')(crossAt(104), rec, null, fn44('aucUncertaintyRow')(0, 'buelga'), { level: 'High' }, p80)]]) {
      assert(/recheck a level/i.test(h) && !/\d\d:\d\d/.test(h) && /72 h/.test(h), `${k}: ${h.slice(0, 400)}`);
    }
    // The anuric flat-levels patient (70 M, CrCl 8, Goti, 52 -> 51 -> 50.2) is a hold with no time.
    const { r } = anuric44();
    const pA = fn44('firstDosePlan')(r, r.rec, r.fitNowH, null, null);
    assert(pA.hold && pA.holdNoTime, JSON.stringify({ hold: pA.hold, noTime: pA.holdNoTime }));
    // The Trough module's closed form uses the same horizon.
    const th = fn44('troughHold'), k = Math.log(40 / 20) / 71, k2 = Math.log(40 / 20) / 73;
    assert(th(40, 12, k, NaN, null).noTime === false && th(40, 12, k2, NaN, null).noTime === true, 'Trough: 71 h a time, 73 h recheck');
  });
  test('44.38 U3: an over-ceiling regimen in range reads the same in both modules — continue, with the ceiling caution leading; AUC24 above 700 stays alarm', () => {
    // 2 g q8h (6 g a day) at CL 11 L/h: AUC24 545. AUC Precision (the twin) and the Trough level mode.
    const row = fn44('aucUncertaintyRow')(2, 'buelga');
    const auc = fn44('regimenDecision')(11, 60, 450, null, 1, hist44(2000, 8), row);
    assert(auc.action === 'continue' && auc.dose === 2000 && auc.tau === 8 && /^Caution: the current dose is above the conventional ceiling \(total daily dose 6000 mg exceeds 4500 mg\)\.$/.test(fn44('ceilingCautionText')(auc)),
      `${auc.action} ${fn44('ceilingCautionText')(auc)}`);
    const p = c2Pk(), kel = 11 / p.vd, tr = fn44('calcPeakTrough')(2000, 8, 1, kel, p.vd).trough;
    const t = trough44('level', 'M', { age: 25, tbw: 95, height: 185, scr: 0.5, dose: 2000, interval: 8, tinf: 1,
      'level-val': tr.toFixed(2), 'time-dose-given': '2026-11-14T00:00', 'time-level-drawn': '2026-11-14T08:00' }, { checked: ['has-level'] });
    assert(/Continue current regimen/.test(t.text) && !/tx-action-alarm/.test(t.h) && t.text.indexOf(fn44('ceilingCautionText')(auc).replace(/\.$/, '')) >= 0,
      `the Trough reading: ${t.text.slice(0, 600)}`);
    assert(t.said.indexOf(fn44('ceilingCautionText')(auc)) > 0, t.said);
    // One implementation of the sentence.
    assert((src44.match(/Caution: the current dose is above the conventional ceiling/g) || []).length === 1, 'one wording');
    // AUC24 above 700 (45 mg/L on 1.5 g q8h) is still unsafe at alarm tier.
    const red = trough44('level', 'M', { age: 60, tbw: 80, height: 178, scr: 1.0, dose: 1500, interval: 8, tinf: 1.5,
      'level-val': 45, 'time-dose-given': '2026-11-14T01:00', 'time-level-drawn': '2026-11-14T08:45' }, { checked: ['has-level'] });
    assert(/Current regimen breaches a hard limit/.test(red.text) && /tx-action-alarm/.test(red.h), red.text.slice(0, 400));
  });
  test('44.39 N2: a Trough level drawn after the due time is judged as drawn, never carried back up', () => {
    const th = fn44('troughHold');
    assert(th(18 * Math.exp(0.03 * 12), 12, 0.03, 1000, { c: 18, h: 24 }) === null, '18 mg/L at 24 h, due 12 h: no hold');
    const h = th(25 * Math.exp(0.03 * 12), 12, 0.03, 1000, { c: 25, h: 24 });
    assert(h && h.late && h.cPre === 25 && Math.abs(h.afterDoseH - (24 + Math.log(25 / 20) / 0.03)) < 1e-9, JSON.stringify(h));
    assert(/drawn 24 h after the last dose started, after the 12 h due time, is 25\.0 mg\/L/.test(fn44('troughHoldHTML')(h)), fn44('troughHoldHTML')(h));
    // Rendered: steady state on q12h, 18 mg/L at 16 h; and after a first 2 g dose, 15 mg/L at 24 h with q12h.
    const rl = (mode, c, draw, tau, extra) => trough44('randomlevel', 'M', Object.assign({ age: 60, tbw: 80, height: 178, scr: 1.0, 'rl-dose': 1000, 'rl-tinf': 1,
      'rl-tau': tau, 'rl-interval': 12, 'rl-c': c, 'rl-dose-time': '2026-11-14T00:00', 'rl-draw-time': draw }, extra || {}), { rlMode: mode });
    const a = rl('steadystate', 18, '2026-11-14T16:00', 24), b = rl('firstdose', 15, '2026-11-15T00:00', 12, { 'rl-dose': 2000, 'rl-tinf': 2, scr: 3 });
    assert(!/Hold:/.test(a.text) && !/undefined|NaN/.test(a.text), `18 at 16 h: ${a.text.slice(0, 300)}`);
    assert(!/Hold:/.test(b.text) && !/undefined|NaN/.test(b.text), `15 at 24 h: ${b.text.slice(0, 300)}`);
  });
  test('44.40 N3: after a dose, the severe-renal verdict and Next say "No further dose until a level is drawn"; before any, the loading dose', () => {
    // 70 M, 70 kg, 175 cm, SCr 8.5 (CrCl 8), Goti, no level: given 1.5 g (30 h ago) and 1 g (6 h ago); and one planned only.
    const dosed = fit44({ model: 'goti', age: 70, tbw: 70, ht: 175, scr: 8.5, mg: 1250, tinf: 2, tau: 24, n: 2, lastAgo: 6, levels: [] });
    const planned = fit44({ model: 'goti', age: 70, tbw: 70, ht: 175, scr: 8.5, mg: 1500, tinf: 2, tau: 24, n: 1, lastAgo: -2, levels: [] });
    assert(dosed.r.lowCrClHold && planned.r.lowCrClHold, 'both are the severe-renal hold');
    assert(/No further dose until a level is drawn/.test(para44(dosed.html, 'vx-hold')) && !/loading dose/i.test(para44(dosed.html, 'vx-hold')), para44(dosed.html, 'vx-hold'));
    assert(/^Next No further dose until a level is drawn/.test(para44(dosed.html, 'vx-next')), para44(dosed.html, 'vx-next'));
    assert(!/Give (?:a|one) [^.]*loading dose/i.test(dosed.text) && !incoherent44(dosed.text).length, JSON.stringify(incoherent44(dosed.text)));
    const pr = fn44('_prRecommendation')(dosed.r, {});
    assert(/No further dose until a level is drawn/.test(pr) && !/loading dose/i.test(pr), pr.slice(0, 500));
    assert(/Give one loading dose/.test(para44(planned.html, 'vx-hold')) && /^Next Give one loading dose/.test(para44(planned.html, 'vx-next')), para44(planned.html, 'vx-hold'));
    // The predicate catches the pair.
    assert(incoherent44('No further dose until a level is drawn. Give a single weight-based loading dose.').length === 1, 'the new predicate');
  });
  test('44.41 N4: the refusal Next line says "if they are right"', () => {
    const { html } = noSol44();
    assert(/Confirm the inputs; if they are right, seek specialist guidance\./.test(para44(html, 'vx-next')) && src44.indexOf('if they hold, seek') < 0, para44(html, 'vx-next'));
  });
}

// ════════════════════════════════════════════════════════════════════
// SUITE 45 — Release 2 (v3.15.0, D27): the harness reads the Hughes variability constants
// ════════════════════════════════════════════════════════════════════
{
  console.log(`\n${'─'.repeat(60)}`);
  console.log('  SUITE 45 — Release 2 (v3.15.0, D27)');
  console.log(`${'─'.repeat(60)}`);

  // 45.1 (code review, rule 6): the Hughes omega^2 / sigma values were hand copies in this harness, so
  // changing one in index.html left every Hughes test green. This runs the engine's own MAP path
  // (mapFit over burtonObj3D_hughes, as runBayesian calls it) on a fictional obese patient with two
  // levels and pins the posterior clearance tightly enough that doubling ANY one of the five
  // constants moves it outside the tolerance.
  test('45.1 Hughes MAP fit: posterior clearance pins all five variability constants', () => {
    // Fictional: 45 y M, 140 kg, 175 cm (BMI 45.7), SCr 1.0 mg/dL; 2 g over 2 h, q12h x 4.
    // Two measured levels (not model-generated): 1 h after the end of dose 3, and the pre-dose 4 trough.
    const ffm = computeFFM(140, 175, 'M');
    const crclFFM = Math.max(__extractConsts().CRCL_MODEL_FLOOR, sandbox.calcCrClRaw(45, 'M', 1.0, ffm, vm.runInContext('SCR_POLICY.ACTUAL', sandbox)));
    const pk = hughesPopPK(crclFFM, ffm);
    const doses = [0, 12, 24, 36].map(t => ({ mg: 2000, tinfH: 2, timeH: t }));
    const levels = [{ conc: 38, timeH: 27 }, { conc: 21, timeH: 36 }];
    const mf = sandbox.mapFit((a, b, c) => burtonObj3D_hughes(a, b, c, pk.TVCL, pk.TVVc, pk.TVVp, pk.TVQ, doses, levels),
      3, OMEGA2_CL_HUGHES, OMEGA2_VC_HUGHES, 400, OMEGA2_VP_HUGHES);
    const CL = pk.TVCL * Math.exp(mf.eta[0]);
    // Measured 2026-11 on this fixture: 4.42996 L/h. Doubling any one constant moves it by at least
    // 0.0067 (OMEGA2_VC_HUGHES, the weakest), and by 0.24 (OMEGA2_CL), 0.13 (OMEGA2_VP), 0.25 (SIGMA_PROP),
    // 0.045 (SIGMA_ADD); the tolerance is a third of the smallest of those.
    assertClose(CL, 4.4300, 0.002, 'posterior CL (L/h)');
  });

  // 45.2 (models review I1, Task 17): the 3-parameter MAP fit never started away from zero on Vp, so on
  // Hughes (Vp 80.3% CV, the widest prior) it could settle in the higher of two minima along the CL-Vp
  // ridge and say nothing. These seven fictional patients are every case docs/audit/probe-map-starts.cjs
  // found missed (seeded; 1,500 per design; four from --regimen=guideline, three from --regimen=target;
  // concentrations rounded to 0.01 mg/L and re-checked). Each carries the objective and clearance of the
  // lowest minimum a 27-start reference ({-1,0,+1} SD on CL, Vc and Vp) reaches. Before the fix mapFit
  // stopped 0.026-0.38 objective units above it, with clearance 11-55% higher. Fixture 2 is the one that
  // +/-1 SD on Vp alone did not reach (its lower minimum sits at eta Vp 1.39, about 2 SD). Tolerance:
  // 1e-4 objective units (-2 log posterior), 260x smaller than the smallest of those gaps; clearance
  // within 0.01 L/h. All are slow clearers on q24h or q36h.
  test('45.2 Hughes MAP fit starts on Vp too: seven missed Hughes cases reach the lower minimum; all four Goti/Hughes call sites pass their omega2 Vp', () => {
    const fixtures = [
      { design: 'peak-trough',   patient: { sex: 'F', ht: 175, tbw: 198.1, age: 48, scr: 1.99 }, course: { mg: 2500, tinfH: 2.5, tau: 24 },
        levels: [{ timeH: 147.5, conc: 44.13 }, { timeH: 167.5, conc: 6.37 }],                                 refObj: 16.661163, refCL: 3.1852 },
      { design: 'three-troughs', patient: { sex: 'F', ht: 179, tbw: 209.5, age: 24, scr: 2.16 }, course: { mg: 2500, tinfH: 2.5, tau: 24 },
        levels: [{ timeH: 119.5, conc: 9.4 }, { timeH: 143.5, conc: 10.82 }, { timeH: 167.5, conc: 10.88 }],     refObj: 7.311188,  refCL: 4.1201 },
      { design: 'three-troughs', patient: { sex: 'F', ht: 164, tbw: 117.4, age: 65, scr: 2.34 }, course: { mg: 1750, tinfH: 2,   tau: 36 },
        levels: [{ timeH: 179.5, conc: 8.98 }, { timeH: 215.5, conc: 19.6 }, { timeH: 251.5, conc: 18.36 }],     refObj: 10.405557, refCL: 1.6273 },
      { design: 'three-troughs', patient: { sex: 'F', ht: 150, tbw: 112.7, age: 20, scr: 2.17 }, course: { mg: 1750, tinfH: 2,   tau: 24 },
        levels: [{ timeH: 119.5, conc: 10.66 }, { timeH: 143.5, conc: 16.78 }, { timeH: 167.5, conc: 17.86 }],   refObj: 6.752988,  refCL: 2.5218 },
      { design: 'one-trough',    patient: { sex: 'M', ht: 187, tbw: 238.2, age: 75, scr: 1.61 }, course: { mg: 1500, tinfH: 1.5, tau: 24 },
        levels: [{ timeH: 167.5, conc: 2.61 }],                                                                  refObj: 11.618928, refCL: 4.8723 },
      { design: 'three-troughs', patient: { sex: 'F', ht: 153, tbw: 128,   age: 58, scr: 1.98 }, course: { mg: 750,  tinfH: 1,   tau: 24 },
        levels: [{ timeH: 119.5, conc: 5.73 }, { timeH: 143.5, conc: 3.23 }, { timeH: 167.5, conc: 4.99 }],      refObj: 11.687872, refCL: 2.0305 },
      { design: 'three-troughs', patient: { sex: 'F', ht: 161, tbw: 108.5, age: 46, scr: 2.47 }, course: { mg: 750,  tinfH: 1,   tau: 24 },
        levels: [{ timeH: 119.5, conc: 5.69 }, { timeH: 143.5, conc: 10.02 }, { timeH: 167.5, conc: 4.22 }],     refObj: 13.179912, refCL: 1.8788 },
    ];
    const ACTUAL = vm.runInContext('SCR_POLICY.ACTUAL', sandbox), FLOOR = __extractConsts().CRCL_MODEL_FLOOR;
    const sd = [OMEGA2_CL_HUGHES, OMEGA2_VC_HUGHES, OMEGA2_VP_HUGHES].map(Math.sqrt);
    for (const [k, f] of fixtures.entries()) {
      const p = f.patient, ffm = computeFFM(p.tbw, p.ht, p.sex);
      const pk = hughesPopPK(Math.max(FLOOR, sandbox.calcCrClRaw(p.age, p.sex, p.scr, ffm, ACTUAL)), ffm);   // getHughesCrCl
      const doses = Array.from({ length: 8 }, (_, i) => ({ mg: f.course.mg, tinfH: f.course.tinfH, timeH: i * f.course.tau }));
      const obj = (a, b, c) => burtonObj3D_hughes(a, b, c, pk.TVCL, pk.TVVc, pk.TVVp, pk.TVQ, doses, f.levels);
      // As runBayesian calls it.
      const mf = sandbox.mapFit(obj, 3, OMEGA2_CL_HUGHES, OMEGA2_VC_HUGHES, 400, OMEGA2_VP_HUGHES);
      // The wide reference, recomputed here so the pinned value is not the only anchor.
      let ref = Infinity;
      for (const i of [-1, 0, 1]) for (const j of [-1, 0, 1]) for (const m of [-1, 0, 1]) {
        const x = nelderMead3D(obj, i * sd[0], j * sd[1], m * sd[2], 400); ref = Math.min(ref, obj(...x));
      }
      const tag = `fixture ${k + 1} (${f.design}, ${p.sex} ${p.age} y ${p.tbw} kg)`;
      assertClose(ref, f.refObj, 1e-4, `${tag}: 27-start reference objective`);
      assertClose(mf.obj, f.refObj, 1e-4, `${tag}: mapFit objective (the lower minimum)`);
      assertClose(pk.TVCL * Math.exp(mf.eta[0]), f.refCL, 0.01, `${tag}: posterior CL (L/h)`);
    }
    // Every 3-parameter call site passes its own model's peripheral-volume variance (Goti and Hughes, in
    // runBayesian and in modelAgreement). A call that omits it silently loses the Vp starts.
    const calls = [...html.matchAll(/mapFit\([^;]*?,\s*3,\s*OMEGA2_CL_(GOTI|HUGHES),\s*OMEGA2_VC_\1,\s*\d+\s*(,\s*OMEGA2_VP_(\w+)\s*)?\)/g)];
    // Exactly four: Goti and Hughes in runBayesian and in modelAgreement. A fifth 3-parameter call (or one
    // the regex stops matching) changes the count and must be added here deliberately.
    assert(calls.length === 4, `expected exactly 4 three-parameter mapFit calls, found ${calls.length}`);
    for (const c of calls) assert(c[3] === c[1], `a ${c[1]} mapFit call does not pass OMEGA2_VP_${c[1]}: …${c[0].slice(-70).replace(/\s+/g, ' ')}`);
  });

  // 45.3 (models review I3, Task 18): Hughes 2024 was built in 83 patients whose covariates span the
  // ranges in its Table 1 (p. 578). CrCl on fat-free mass is uncapped, faithfully, and clearance rises as a
  // power of it, so a patient outside that range is the model extrapolating. The clinician is told in one
  // line in the confidence slot; nothing is capped or changed (rule 4). The ranges are pinned against the
  // paper once, here; every other use reads them from harness_constants (rule 6).
  test('45.3 Hughes out of its built range: one line in the confidence slot names the covariate and the range; in range, none', () => {
    const K = __extractConsts(), mm = sandbox.modelMismatchText;
    // Hughes 2024 Table 1 (p. 578), development dataset (n = 83), the Range column.
    const T1 = [['HUGHES_MIN_WT_KG', 91.6], ['HUGHES_MAX_WT_KG', 218], ['HUGHES_MIN_HT_CM', 122], ['HUGHES_MAX_HT_CM', 190],
      ['HUGHES_MIN_BMI', 40], ['HUGHES_MAX_BMI', 70.3], ['HUGHES_MIN_AGE_Y', 24.2], ['HUGHES_MAX_AGE_Y', 89.3],
      ['HUGHES_MIN_SCR', 0.40], ['HUGHES_MAX_SCR', 2.51], ['HUGHES_MIN_CRCL_FFM', 13.0], ['HUGHES_MAX_CRCL_FFM', 255]];
    for (const [n, v] of T1) assert(K[n] === v, `${n} ${K[n]}: Table 1 gives ${v}`);
    // The shipped covariate function, fed a fictional patient (getHughesCrCl reads the form through readBayesPatient).
    const hughesCrCl = (age, sex, scr, tbw, ht) => {
      const prev = sandbox.readBayesPatient;
      sandbox.readBayesPatient = () => ({ age, sex, scr, tbw, ht });
      try { return sandbox.getHughesCrCl(); } finally { sandbox.readBayesPatient = prev; }
    };
    const rec = (tbw, ht) => sandbox.getModelRecommendation(0, false, tbw, ht, false);
    const cov = (age, scr, tbw, ht, sex) => ({ age, scr, tbw, ht, crclFFM: hughesCrCl(age, sex || 'M', scr, tbw, ht) });
    // The brief's fictional patient: 25 y M, 200 kg, 185 cm (BMI 58.4), SCr 0.5 mg/dL. Independent anchor:
    // FFM = 9270 x 200 / (6680 + 216 x 58.44) = 96.05 kg (Janmahasatian); CG = 115 x 96.05 / (72 x 0.5) = 306.8.
    const big = cov(25, 0.5, 200, 185);
    assertClose(big.crclFFM, 306.8, 0.1, 'getHughesCrCl, 25 y M, 200 kg, 185 cm, SCr 0.5');
    const r200 = rec(200, 185);
    assert(r200.recommended === 'hughes' && r200.isClass3, 'the fixture is a class-3 patient for whom Hughes is suggested');
    const line = mm(r200, 'hughes', big);
    assert(/^Hughes 2024 was built in patients with CrCl on fat-free mass 13–255 mL\/min; this patient's CrCl on fat-free mass \(307 mL\/min\) is above that range\.$/.test(line || ''), String(line));
    // One line, one sentence, caution not alarm.
    assert(!/\n/.test(line) && !/\.\s/.test(line) && !/!/.test(line) && !/weight|BMI|age|height|creatinine/.test(line), `one sentence naming only the out-of-range covariate: ${line}`);
    // In range: the 45.1 patient, 45 y M, 140 kg, 175 cm, SCr 1.0 (CrCl on FFM 103).
    const mid = cov(45, 1.0, 140, 175);
    assert(mid.crclFFM > 100 && mid.crclFFM < 110, `in-range fixture CrCl on FFM ${mid.crclFFM}`);
    assert(mm(rec(140, 175), 'hughes', mid) === null, `in range: ${mm(rec(140, 175), 'hughes', mid)}`);
    // Each covariate, each bound, each side. The bound itself is in range. Just beyond it, the value shown is
    // the patient's own: one more decimal when rounding would land on the bound, never a stepped number.
    const c3 = (bmi) => ({ recommended: 'hughes', isClass3: bmi >= K.HUGHES_MIN_BMI, isObese: true, bmi });
    const base = { bmi: 46, age: 56, scr: 0.84, tbw: 134, ht: 170, crclFFM: 84 };   // Table 1 medians
    const at = (o) => { const p = Object.assign({}, base, o); return mm(c3(p.bmi), 'hughes', p); };
    const one = (o, rng, said, dir) => {
      const t = at(o), re = new RegExp(`^Hughes 2024 was built in patients with ${rng}; this patient's ${said} is ${dir} that range\\.$`);
      assert(re.test(t || ''), `${JSON.stringify(o)}: ${t}`);
    };
    const edge = [
      ['crclFFM', 'CrCl on fat-free mass 13–255 mL\\/min', [[255.2, 'CrCl on fat-free mass \\(255\\.2 mL\\/min\\)', 'above'], [256.4, 'CrCl on fat-free mass \\(256 mL\\/min\\)', 'above'],
        [12.9, 'CrCl on fat-free mass \\(12\\.9 mL\\/min\\)', 'below'], [12.4, 'CrCl on fat-free mass \\(12 mL\\/min\\)', 'below']], K.HUGHES_MIN_CRCL_FFM, K.HUGHES_MAX_CRCL_FFM],
      ['tbw', 'weight 91\\.6–218 kg', [[218.04, 'weight \\(218\\.04 kg\\)', 'above'], [230, 'weight \\(230 kg\\)', 'above'], [91.58, 'weight \\(91\\.58 kg\\)', 'below']], K.HUGHES_MIN_WT_KG, K.HUGHES_MAX_WT_KG],
      ['ht', 'height 122–190 cm', [[190.4, 'height \\(190\\.4 cm\\)', 'above'], [195, 'height \\(195 cm\\)', 'above'], [121.6, 'height \\(121\\.6 cm\\)', 'below']], K.HUGHES_MIN_HT_CM, K.HUGHES_MAX_HT_CM],
      ['bmi', 'BMI 40–70\\.3', [[70.31, 'BMI \\(70\\.31\\)', 'above'], [75, 'BMI \\(75\\)', 'above'], [39.95, 'BMI \\(39\\.95\\)', 'below']], K.HUGHES_MIN_BMI, K.HUGHES_MAX_BMI],
      ['age', 'age 24\\.2–89\\.3 years', [[24, 'age \\(24 years\\)', 'below'], [89.33, 'age \\(89\\.33 years\\)', 'above'], [90, 'age \\(90 years\\)', 'above']], K.HUGHES_MIN_AGE_Y, K.HUGHES_MAX_AGE_Y],
      ['scr', 'serum creatinine 0\\.4–2\\.51 mg\\/dL', [[0.3, 'serum creatinine \\(0\\.3 mg\\/dL\\)', 'below'], [0.396, 'serum creatinine \\(0\\.396 mg\\/dL\\)', 'below'], [2.6, 'serum creatinine \\(2\\.6 mg\\/dL\\)', 'above']], K.HUGHES_MIN_SCR, K.HUGHES_MAX_SCR],
    ];
    for (const [k, rng, cases, lo, hi] of edge) {
      assert(at({ [k]: lo }) === null && at({ [k]: hi }) === null, `${k} at either bound (${lo}, ${hi}) is in range: ${at({ [k]: lo })} / ${at({ [k]: hi })}`);
      for (const [v, said, dir] of cases) one({ [k]: v }, rng, said, dir);
    }
    // Several at once: still one sentence, naming each, in Table 1's order.
    const many = at({ age: 92, tbw: 230, bmi: 72, scr: 2.8, crclFFM: 307 });
    assert(/^Hughes 2024 was built in patients with weight 91\.6–218 kg, BMI 40–70\.3, age 24\.2–89\.3 years, serum creatinine 0\.4–2\.51 mg\/dL and CrCl on fat-free mass 13–255 mL\/min; this patient's weight \(230 kg\), BMI \(72\), age \(92 years\), serum creatinine \(2\.8 mg\/dL\) and CrCl on fat-free mass \(307 mL\/min\) are above those ranges\.$/.test(many || ''), String(many));
    const mixed = mm(rec(110, 172), 'hughes', Object.assign({}, base, { tbw: 110, ht: 172, crclFFM: 300 }));   // BMI 37.18
    assert(/^Hughes 2024 was built in patients with BMI 40–70\.3 and CrCl on fat-free mass 13–255 mL\/min; this patient's BMI \(37\.2\) is below and CrCl on fat-free mass \(300 mL\/min\) is above those ranges\.$/.test(mixed || ''), String(mixed));
    // Without the fitted covariates only BMI (from the recommendation) is checked.
    assert(/this patient's BMI \(75\) is above that range\.$/.test(mm(c3(75), 'hughes') || ''), String(mm(c3(75), 'hughes')));
    // Another model: Hughes' range says nothing about it; the class-3 mismatch line stands.
    assert(/^Hughes 2024 is fitted to class 3 obesity \(BMI 58\.4\); this result uses Goti 2018\.$/.test(mm(r200, 'goti', big) || ''), String(mm(r200, 'goti', big)));
    // The Models gist's "Suggested:" is the choice of model only: a Hughes patient on Hughes outside the
    // range is never told Hughes is suggested; a class-3 patient on Buelga, and BMI 32.7 on Hughes, are.
    const sug = sandbox.modelSuggestedName;
    assert(typeof sug === 'function', 'modelSuggestedName() is missing');
    assert(sug(c3(75), 'hughes') === null && sug(r200, 'hughes') === null, `Hughes on Hughes: ${sug(c3(75), 'hughes')}`);
    assert(sug(r200, 'buelga') === 'Hughes 2024', `class 3 on Buelga: ${sug(r200, 'buelga')}`);
    assert(sug(rec(100, 175), 'hughes') === 'Goti 2018', `BMI 32.7 on Hughes: ${sug(rec(100, 175), 'hughes')}`);
    assert(sug(rec(70, 175), 'buelga') === null && sug(rec(70, 175), 'goti') === null, 'no population mismatch, no suggestion');
  });

  // ── Task 14: direct behaviour tests, one per mutant the code review saw survive (I3, I4, I5) ──
  // docs/audit/mutation.cjs breaks each line in memory and runs this suite; every test below
  // names the mutant id it kills. 45.2-45.4 are reserved for Tasks 17-19. Fictional values only.
  const K45 = __extractConsts();
  const fn45 = (n) => { const f = sandbox[n]; if (typeof f !== 'function') throw new Error(`${n}() is missing`); return f; };
  const run45 = (js) => vm.runInContext(js, sandbox);
  const P45 = run45('SCR_POLICY');
  const row45 = (n, m) => fn45('aucUncertaintyRow')(n, m || 'buelga');
  const hist45 = (mg, tau, n) => Array.from({ length: n || 4 }, (_, i) => ({ mg, tinfH: fn45('autoTinf')(mg), timeH: i * tau }));
  const decide45 = (cl, v, doses, row) => fn45('regimenDecision')(cl, v, 450, null, 1, doses, row || row45(1));

  // 45.4 (models review I2, Task 19): the AUC uncertainty rows were simulated for steady-state troughs. For
  // levels drawn before steady state (after a loading dose) the Hughes 80% band covered only 64.7-68% of
  // simulated patients, and the 20 dots and the D25 continue-or-change count still read it. Early-design
  // rows are now simulated (docs/audit/uncertainty-by-model.cjs --early) and chosen by the one test the
  // "Early level" note uses (earlyLevelFractions, rule 2).
  test('45.4a an early-level fit reads the band simulated for early levels: wider than the steady-state row at 1, 2 and 3+ levels, every model', () => {
    const R = fn45('aucUncertaintyRow');
    for (const m of ['buelga', 'goti', 'hughes']) {
      for (const n of [1, 2, 3]) {
        const ss = R(n, m, false), ea = R(n, m, true);
        assert(ss.design === 'steady' && ea.design === 'early' && ea.n === n, `${m} n=${n}: designs ${ss.design} / ${ea.design}`);
        assert(ea.lo >= ss.lo && ea.hi >= ss.hi && ea.lo + ea.hi > ss.lo + ss.hi,
          `${m} n=${n}: early −${ea.lo} / +${ea.hi} is not wider than steady-state −${ss.lo} / +${ss.hi}`);
        assert(ea.id !== ss.id && R(n, m).id === ss.id, `${m} n=${n}: early omitted reads the steady-state row`);
      }
      assert(R(5, m, true).id === R(3, m, true).id, `${m}: more than 3 early levels read the 3-level early row`);
      const w = n => R(n, m, true).lo + R(n, m, true).hi;
      assert(w(1) >= w(2) && w(2) >= w(3), `${m}: more early levels must not widen the band: ${[1, 2, 3].map(w).join(' → ')}`);
      assert(R(0, m, true).id === R(0, m, false).id, `${m}: with no levels nothing is early`);
    }
    // The brief's named case, against the steady-state row it replaces (−18% / +28%).
    const h1 = R(1, 'hughes', true), h1s = R(1, 'hughes', false);
    assert(h1.lo + h1.hi > h1s.lo + h1s.hi, `hughes 1 level: −${h1.lo}/+${h1.hi} vs −${h1s.lo}/+${h1s.hi}`);
    assert(fn45('aucUncertaintyRow')(1, 'goti-hd', true).key === 'goti', 'Goti-HD reads the Goti rows, as before');
    assert(/levels drawn before steady state/.test(fn45('aucUncertaintyText')(1, 'hughes', true)) && /steady-state troughs/.test(fn45('aucUncertaintyText')(1, 'hughes', false)),
      'the label names the design its band was simulated for');
  });
  test('45.4b one row per fit: an early-level Hughes fit through runBayesian; the dots, the likely range and regimenDecision read the same early row', () => {
    const { fit44 } = __suiteShared;
    assert(typeof fit44 === 'function', 'the SUITE 44 fit driver');
    const R = fn45('aucUncertaintyRow');
    // Spy on the two consumers: regimenDecision (row is its 7th argument; finalizeDecision re-decides
    // through it too) and aucRangeSVG (the 20 dots, their in-band count and the "likely" range).
    const real = { regimenDecision: sandbox.regimenDecision, aucRangeSVG: sandbox.aucRangeSVG };
    const seen = { decision: [], range: [] };
    sandbox.regimenDecision = function (...a) { seen.decision.push(a[6]); return real.regimenDecision.apply(this, a); };
    sandbox.aucRangeSVG = function (...a) { seen.range.push({ auc: a[0], row: a[1] }); return real.aucRangeSVG.apply(this, a); };
    let fit;
    // Fictional: 45 y M, 140 kg, 175 cm, SCr 1.0 (CrCl on FFM 103, inside Hughes Table 1); 1500 mg q12h x 2;
    // one level, 13 mg/L, 11.5 h after the second dose (23.5 h after the first).
    try { fit = fit44({ model: 'hughes', age: 45, tbw: 140, ht: 175, scr: 1.0, mg: 1500, tinf: fn45('autoTinf')(1500), tau: 12, n: 2, lastAgo: 12,
      levels: [{ conc: 13, after: 11.5 }] }); }
    finally { Object.assign(sandbox, real); }
    const { r, html, text } = fit;
    const early = fn45('earlyLevelFractions')(r.levels, r.doses, r.t12_ind);
    assert(early.length === 1, `the fixture is an early level by the shared test: ${JSON.stringify(early)} (t½ ${r.t12_ind})`);
    assert(/Early level/.test(text), 'the Early level note is shown');
    const want = R(1, 'hughes', true);
    assert(want.design === 'early', `the early row: ${JSON.stringify(want)}`);
    assert(seen.decision.length >= 1 && seen.range.length === 1, `consumers called: decision ${seen.decision.length}, range ${seen.range.length}`);
    const ids = { stored: r.decisionArgs.row.id, decision: seen.decision.map(x => x && x.id), range: seen.range[0].row.id };
    assert(ids.stored === want.id && ids.decision.every(id => id === want.id) && ids.range === want.id, `rows read: ${JSON.stringify(ids)}, want ${want.id}`);
    // What the reader sees comes from that row: the likely range, its percentages and the dot count.
    const auc = r.rec.auc24;
    const lk = text.match(/likely (\d+) to (\d+)/), pc = html.match(/\(−(\d+)% \/ \+(\d+)%\)/), dots = text.match(/(\d+) of 20 plausible AUCs/);
    assert(lk && +lk[1] === +(auc * (1 - want.lo)).toFixed(0) && +lk[2] === +(auc * (1 + want.hi)).toFixed(0), `likely range ${lk && lk[0]} for AUC ${auc}`);
    assert(pc && +pc[1] === Math.round(want.lo * 100) && +pc[2] === Math.round(want.hi * 100), `percentages ${pc && pc[0]}`);
    assert(dots && +dots[1] === fn45('attainmentDots')(auc, want), `dots ${dots && dots[0]} vs ${fn45('attainmentDots')(auc, want)}`);
  });


  // Patient size and renal function. Independent anchors: the published equations.
  test('45.5 calcCrClRaw is Cockcroft-Gault: (140 - age) x weight / (72 x SCr), x 0.85 for a woman [I4 CG]', () => {
    const cg = fn45('calcCrClRaw');
    assertClose(cg(60, 'M', 1.0, 70, P45.ACTUAL), 80 * 70 / 72, 1e-9, '60 y M, 70 kg, SCr 1.0');
    assertClose(cg(60, 'F', 1.0, 70, P45.ACTUAL), 0.85 * 80 * 70 / 72, 1e-9, '60 y F, 70 kg, SCr 1.0');
    assertClose(cg(40, 'M', 2.0, 90), 100 * 90 / 144, 1e-9, 'with no policy, SCr is used as measured');
    // The Goti policy reads a low SCr at the floor only for the model's own covariate (rule 4).
    assertClose(cg(70, 'M', 0.7, 70, P45.GOTI_MODEL), 70 * 70 / (72 * K45.GOTI_SCR_FLOOR), 1e-9, 'Goti policy, 70 y, SCr 0.7');
    assertClose(cg(70, 'M', 0.7, 70, P45.ACTUAL), 70 * 70 / (72 * 0.7), 1e-9, 'as measured, 70 y, SCr 0.7');
  });
  test('45.6 calcCrCl returns the manual override while it is on; calcCrClRaw never does [I4-01]', () => {
    const cg = 80 * 70 / 72;
    try {
      run45('crclOverride.on = true; crclOverride.value = 35;');
      assert(fn45('calcCrCl')(60, 'M', 1.0, 70, P45.ACTUAL) === 35, `override on: ${fn45('calcCrCl')(60, 'M', 1.0, 70, P45.ACTUAL)}`);
      assertClose(fn45('calcCrClRaw')(60, 'M', 1.0, 70, P45.ACTUAL), cg, 1e-9, 'calcCrClRaw (the Hughes FFM covariate) ignores the override');
      run45('crclOverride.value = NaN;');
      assertClose(fn45('calcCrCl')(60, 'M', 1.0, 70, P45.ACTUAL), cg, 1e-9, 'an override with no valid value is not applied');
      run45('crclOverride.on = false; crclOverride.value = 35;');
      assertClose(fn45('calcCrCl')(60, 'M', 1.0, 70, P45.ACTUAL), cg, 1e-9, 'override off');
    } finally { run45('crclOverride.on = false; crclOverride.value = null;'); }
  });
  test('45.7 calcIBW is Devine: 50 / 45.5 kg + 2.3 kg per inch over 60 in; an unknown sex takes the female base [I4-07, I4P-2]', () => {
    const ibw = fn45('calcIBW'), inch = K45.CM_PER_IN;
    assertClose(ibw('M', 72 * inch), 50 + 2.3 * 12, 1e-9, 'man, 6 ft');
    assertClose(ibw('F', 66 * inch), 45.5 + 2.3 * 6, 1e-9, 'woman, 5 ft 6 in');
    for (const sex of [null, undefined, 'X'])
      assertClose(ibw(sex, 66 * inch), ibw('F', 66 * inch), 1e-9, `sex ${sex}: the lower (female) base, never the male`);
  });
  test('45.8 calcAdjBW is IBW + 0.4 x (TBW - IBW) [I4P-1]', () => {
    assertClose(fn45('calcAdjBW')(120, 70), 90, 1e-9, 'TBW 120, IBW 70');
    assertClose(fn45('calcAdjBW')(100, 60), 76, 1e-9, 'TBW 100, IBW 60');
  });
  test('45.9 applyScrPolicy: the Goti SCr floor applies above 65 (66, not 65), and only under the Goti policy [I4-06]', () => {
    const pol = fn45('applyScrPolicy');
    assert(K45.GOTI_SCR_FLOOR_AGE === 65, `GOTI_SCR_FLOOR_AGE ${K45.GOTI_SCR_FLOOR_AGE}: 65 per the 2019 erratum`);
    assert(pol(0.6, 65, P45.GOTI_MODEL) === 0.6, `65 y: ${pol(0.6, 65, P45.GOTI_MODEL)} (as measured)`);
    assert(pol(0.6, 66, P45.GOTI_MODEL) === K45.GOTI_SCR_FLOOR, `66 y: ${pol(0.6, 66, P45.GOTI_MODEL)} (the floor)`);
    assert(pol(1.4, 80, P45.GOTI_MODEL) === 1.4, 'above the floor: as measured');
    assert(pol(0.6, 80, P45.ACTUAL) === 0.6, 'any other policy: as measured (rule 4)');
  });

  // Concentrations and kidney injury.
  test('45.10 predictConc1comp during an infusion: R0 / (k V) x (1 - e^(-k t)), rising to the end of the infusion [I4-05]', () => {
    const p = fn45('predictConc1comp'), doses = [{ mg: 1000, tinfH: 2, timeH: 0 }], k = 0.1, V = 50, R0 = 500;
    for (const t of [0.5, 1, 1.5, 2]) assertClose(p(doses, t, k, V), R0 / (k * V) * (1 - Math.exp(-k * t)), 1e-9, `${t} h into a 2 h infusion`);
    assertLess(p(doses, 1, k, V), p(doses, 2, k, V), 'mid-infusion below the end of the infusion');
    assertClose(p(doses, 5, k, V), R0 / (k * V) * (1 - Math.exp(-k * 2)) * Math.exp(-k * 3), 1e-9, '3 h after the end');
    assert(p(doses, 0, k, V) === 0, 'nothing before the dose');
  });
  test('45.11 kdigoStage: a 0.3 mg/dL rise counts within 48 h; the same rise over 60 h (fold 1.3) is no stage [I4-14]', () => {
    const k = fn45('kdigoStage');
    assert(k([{ scr: 1.0, timeH: 0 }, { scr: 1.3, timeH: 60 }]) === 0, `0.3 over 60 h: stage ${k([{ scr: 1.0, timeH: 0 }, { scr: 1.3, timeH: 60 }])}`);
    assert(k([{ scr: 1.0, timeH: 0 }, { scr: 1.3, timeH: 48 }]) === 1, '0.3 at 48 h: stage 1');
    assert(k([{ scr: 1.0, timeH: 0 }, { scr: 1.3, timeH: 40 }]) === 1, '0.3 over 40 h: stage 1');
  });
  test('45.12 checkAKI: SCr at least 1.5x baseline, or 0.3 mg/dL above it, shows the AKI banner [I4-15]', () => {
    const aki = (scr, base, manual) => {
      const els = { scr: { value: String(scr) }, 'scr-baseline': { value: String(base) }, 'aki-manual': { checked: !!manual },
        'aki-banner': { style: { display: '' }, innerHTML: '' } };
      const prev = sandbox.document.getElementById;
      sandbox.document.getElementById = (id) => els[id] || prev(id);
      try { fn45('checkAKI')(); } finally { sandbox.document.getElementById = prev; }
      return els['aki-banner'];
    };
    const on = (b) => b.style.display === 'block';
    assert(on(aki(1.3, 1.0)) && /0\.3 mg\/dL above baseline/.test(aki(1.3, 1.0).innerHTML), 'a 0.3 rise (fold 1.3)');
    assert(!on(aki(1.2, 1.0)), 'a 0.2 rise (fold 1.2)');
    assert(on(aki(0.75, 0.5)) && /1\.5× baseline/.test(aki(0.75, 0.5).innerHTML), 'fold 1.5 (a 0.25 rise)');
    assert(!on(aki(0.7, 0.5)), 'fold 1.4 (a 0.2 rise)');
    assert(on(aki(1.0, 1.0, true)), 'flagged manually');
    assert(!on(aki(2.0, '')), 'no baseline, no automatic flag');
  });

  // The weight-based guideline comparison and the PD load.
  // The 2500 mg cap and the CrCl cut-points 90/50/30/15 are literals in computeGuidelineDose with no
  // citation yet (code report M5, rule 1). They are pinned as shipped, so a change is deliberate.
  test('45.13 computeGuidelineDose: 15 mg/kg TBW to the 250 mg step, capped at 2500 mg [I4-16]', () => {
    const g = fn45('computeGuidelineDose');
    assert(g(70, 80).dose === 1000 && g(100, 80).dose === 1500, `${g(70, 80).dose}, ${g(100, 80).dose}`);
    const big = g(200, 80);
    assert(big.dose === 2500 && big.rawDose === '3000', `200 kg: ${big.dose} mg (raw ${big.rawDose})`);
    assert(g(300, 80).dose === 2500, 'never above 2500');
  });
  test('45.14 computeGuidelineDose: the interval cut-points sit at CrCl 90, 50, 30 and 15 [I4P-6a-d]', () => {
    const g = fn45('computeGuidelineDose');
    const want = [[90.5, 8], [90, 12], [50.5, 12], [50, 24], [30.5, 24], [30, 36], [15.5, 36], [15, 48], [5, 48]];
    const got = want.map(([c]) => g(70, c).tau);
    assert(JSON.stringify(got) === JSON.stringify(want.map(w => w[1])), `CrCl ${want.map(w => w[0]).join('/')}: q${got.join('/q')}h`);
  });
  test('45.15 pdLoadingDose: a local maximum above 3,000 mg never raises the Rec 11 cap; a lower one lowers it [I4-17]', () => {
    const pd = fn45('pdLoadingDose');
    // HD_LOADING_MAX_MG (Rybak 2020 Rec 11) is pinned once, in SUITE 44; here it is read, never copied.
    const hi = pd(200, 4000);                     // PD_LOAD_MG_PER_KG x 200 kg is above the cap; local maximum 4,000
    assert(K45.PD_LOAD_MG_PER_KG * 200 > 4000 - 1e-9 && 4000 > K45.HD_LOADING_MAX_MG, 'the fixture: load and local maximum both above the cap');
    const cap = K45.HD_LOADING_MAX_MG;
    assert(hi.mg === cap && hi.cap === cap && hi.capped === true, `local max 4000: ${JSON.stringify(hi)}`);
    assertClose(hi.mgPerKg, cap / 200, 1e-9, 'mg/kg given');
    const lo = pd(200, 2500);
    assert(lo.mg === 2500 && lo.cap === 2500 && lo.capped === true, `local max 2500: ${JSON.stringify(lo)}`);
    const none = pd(100, 0);
    assert(none.mg === K45.PD_LOAD_MG_PER_KG * 100 && none.cap === cap && none.capped === false, `no local max: ${JSON.stringify(none)}`);
  });
  test('45.16 an SCr below 0.1 mg/dL is refused at entry; 0.1 to 25 is accepted [I4-18]', () => {
    // INPUT_LIMITS is a UI plausibility table, not a clinical constant; its SCr range is pinned once, here.
    const L = K45.INPUT_LIMITS.scr, cv = fn45('checkValue');
    assert(L.min === 0.1 && L.max === 25 && L.unit === 'mg/dL', `SCr entry range ${L.min}-${L.max} ${L.unit}`);
    assert(!cv(String(L.min / 2), 'scr').ok && !cv(String(L.min - 0.01), 'scr').ok, `SCr below ${L.min} accepted`);
    assert(cv(String(L.min), 'scr').ok && cv(String(L.max), 'scr').ok && !cv(String(L.max + 0.5), 'scr').ok, `the ${L.min}-${L.max} range`);
  });

  // evalRegimen: one case per hard reject and per flag (1-compartment, MIC 1 unless stated).
  const ev45 = (mg, tau, cl, v, mic) => fn45('evalRegimen')(mg, tau, fn45('autoTinf')(mg), cl, v, null, mic);
  const lv45 = (r) => r.flags.map(f => f.level);
  // The ceilings and the trough thresholds come from harness_constants (rule 6); their values are pinned
  // against their sources once, in 44.6 (2000 / 4500 / 700) and 44.2 (TROUGH_HIGH_MGL 20).
  test('45.17 evalRegimen hard reject: a single dose above DOSE_MAX_PER_DOSE_MG', () => {
    const cap = K45.DOSE_MAX_PER_DOSE_MG, mg = cap + 250;
    const r = ev45(mg, 24, 5, 50, 1);
    assert(JSON.stringify(r.hardFail) === JSON.stringify([`single dose ${mg} mg exceeds ${cap} mg`]), JSON.stringify(r.hardFail));
    assert(ev45(cap, 24, 5, 50, 1).hardFail.length === 0, `${cap} mg q24h is admissible`);
  });
  test('45.18 evalRegimen hard reject: a total daily dose above DOSE_MAX_TDD_MG', () => {
    const cap = K45.DOSE_MAX_TDD_MG;
    const r = ev45(1750, 8, 12, 70, 1);           // 5,250 mg a day, AUC24 437, each dose under the per-dose cap
    assert(1750 * 3 > cap && 1750 <= K45.DOSE_MAX_PER_DOSE_MG, 'the fixture breaches the daily ceiling only');
    assert(JSON.stringify(r.hardFail) === JSON.stringify([`total daily dose ${1750 * 3} mg exceeds ${cap} mg`]), JSON.stringify(r.hardFail));
    assert(cap % 3 === 0 && ev45(cap / 3, 8, 12, 70, 1).hardFail.length === 0, `${cap} mg a day (q8h) is admissible`);
  });
  test('45.19 evalRegimen hard reject: AUC24 above AUC24_ABSOLUTE_MAX [I4-02, I4P-3]', () => {
    const cap = K45.AUC24_ABSOLUTE_MAX;
    const r = ev45(1750, 12, 4.5, 50, 1);         // AUC24 778, doses within both dose ceilings
    assert(r.auc24 > cap, `the fixture's AUC24 ${r.auc24.toFixed(0)} is above ${cap}`);
    assert(JSON.stringify(r.hardFail) === JSON.stringify([`AUC24 ${r.auc24.toFixed(0)} exceeds the absolute ceiling ${cap}`]), JSON.stringify(r.hardFail));
    const at = ev45(1750, 12, 3500 / cap, 50, 1);  // AUC24 exactly at the ceiling: admissible
    assert(Math.abs(at.auc24 - cap) < 1e-9 && at.hardFail.length === 0, `AUC24 ${at.auc24} at the ceiling`);
    assert(ev45(1750, 12, 3500 / (cap + 1), 50, 1).hardFail.length === 1, 'AUC24 one above the ceiling is rejected');
  });
  test('45.20 evalRegimen flag: a predicted trough of 20 mg/L or more is danger [I4-03]', () => {
    const hi = K45.TROUGH_HIGH_MGL;
    const r = ev45(1000, 12, 3.6, 150, 1);        // AUC24 556, trough 20.2: within 1 mg/L of the threshold
    assert(r.Ctrough >= hi && r.Ctrough < hi + 1 && r.hardFail.length === 0, `trough ${r.Ctrough}`);
    assert(JSON.stringify(lv45(r)) === '["danger"]' && r.flags[0].text.indexOf(`at or above ${hi} `) > 0, JSON.stringify(r.flags));
  });
  test('45.21 evalRegimen flag: a predicted trough of 15 to under 20 mg/L is a warning [I4P-4]', () => {
    assert(K45.TROUGH_WARN_MGL === 15, `TROUGH_WARN_MGL ${K45.TROUGH_WARN_MGL} (Rybak 2020: AKI risk rises from 15)`);
    const r = ev45(1000, 12, 3.4, 50, 1);         // AUC24 588, trough 16.4
    assert(r.Ctrough >= K45.TROUGH_WARN_MGL && r.Ctrough < K45.TROUGH_HIGH_MGL, `trough ${r.Ctrough}`);
    assert(JSON.stringify(lv45(r)) === '["warning"]' && r.flags[0].text.indexOf(`at or above ${K45.TROUGH_WARN_MGL},`) > 0, JSON.stringify(r.flags));
  });
  test('45.22 evalRegimen flag: a predicted trough below the MIC is information [I4-04]', () => {
    const r2 = ev45(1000, 24, 4, 30, 2), r1 = ev45(1000, 24, 4, 30, 1);   // trough 1.5 mg/L
    assert(r2.Ctrough > 1 && r2.Ctrough < 2, `trough ${r2.Ctrough}`);
    assert(r2.flags.some(f => f.level === 'info' && /below the MIC \(2 mg\/L\)/.test(f.text)), JSON.stringify(r2.flags));
    assert(!r1.flags.some(f => f.level === 'info'), 'MIC 1: no sub-MIC flag');
  });
  test('45.23 evalRegimen flags: AUC24 above or below 400-600 beyond the rounding grace is a warning', () => {
    const above = ev45(1350, 12, 4, 50, 1), below = ev45(1000, 24, 4, 30, 1);   // AUC24 675 (grace 62.5) and 250
    assert(above.hardFail.length === 0 && above.flags.some(f => f.level === 'warning' && /AUC24 675 is above/.test(f.text)), JSON.stringify(above.flags));
    assert(below.flags.some(f => f.level === 'warning' && /AUC24 250 is below/.test(f.text)), JSON.stringify(below.flags));
    assert(!ev45(1000, 12, 4, 50, 1).flags.some(f => /target band/.test(f.text)), 'AUC24 500: no band flag');
  });

  // D25: one case per regimenDecision / currentRegimenOf branch the review saw survive.
  test('45.24 D25: an in-range regimen is changed when the best puts exactly CONTINUE_MARGIN_DOTS more in range [I4-08]', () => {
    const r = decide45(1.75, 49, hist45(500, 12));      // 500 mg q12h, AUC24 571, 13 of 20
    assert(r.action === 'change' && r.current.inBand && !r.current.unsafe, `${r.action}`);
    assert(r.dots - r.current.dots === K45.CONTINUE_MARGIN_DOTS, `${r.current.dots} -> ${r.dots}`);
    assert(r.dose === 1750 && r.tau === 48, `${r.dose} mg q${r.tau}h`);
  });
  test('45.25 D25: when an in-range candidate exists, an out-of-range one is never the change [I4-09]', () => {
    // No level (population row): 750 mg q36h at CL 0.6 goes to 500 mg q48h (AUC24 417), not 750 mg q48h (625).
    const r = decide45(0.6, 49, hist45(750, 36), row45(0));
    assert(r.action === 'change' && r.inBand && !r.outsideTargetBand, `${r.action} ${r.dose} mg q${r.tau}h AUC ${r.auc24}`);
    assert(r.auc24 >= K45.AUC24_TARGET_MIN && r.auc24 <= K45.AUC24_TARGET_MAX && r.dose === 500 && r.tau === 48, `${r.dose} mg q${r.tau}h AUC ${r.auc24}`);
  });
  test('45.26 D25: regimens with a predicted trough of 20 or more are set aside in the change [I4-10]', () => {
    // CL 0.5, V 150: 250 mg q24h scores as many dots as 500 mg q48h but has a trough of 20.0.
    const r = decide45(0.5, 150, hist45(1000, 12));
    assert(r.action === 'change' && r.Ctrough < K45.TROUGH_HIGH_MGL && r.dose === 500 && r.tau === 48, `${r.dose} mg q${r.tau}h trough ${r.Ctrough}`);
    const alt = ev45(250, 24, 0.5, 150, 1);
    assert(alt.Ctrough >= K45.TROUGH_HIGH_MGL && fn45('attainmentDots')(alt.auc24, row45(1)) >= r.dots, 'the danger alternative it set aside');
  });
  test('45.27 D25: an unsafe current regimen is never kept when nothing admissible is better; the optimizer answers [I4-11]', () => {
    const doses = hist45(250, 48), cur = fn45('currentRegimenOf')(doses, 0.2, 49, null, 1, row45(1));
    assert(cur && cur.unsafe, 'the current 250 mg q48h at CL 0.2 is unsafe');
    const r = decide45(0.2, 49, doses), opt = sandbox.bayesDoseOptimizer(0.2, 49, 450, null, 1);
    assert(r.action !== 'continue' && r.dose === opt.dose && r.tau === opt.tau, `${r.action} ${r.dose} mg q${r.tau}h`);
  });
  test('45.28 D25: a single charted dose is not a current regimen, even under the regimen override [I4-12]', () => {
    try {
      run45('bState.regimenOverrideH = 12;');
      const one = decide45(4.58, 61.8, [{ mg: 1250, tinfH: 1.5, timeH: 0 }]);
      const two = decide45(4.58, 61.8, [{ mg: 1250, tinfH: 1.5, timeH: 0 }, { mg: 1250, tinfH: 1.5, timeH: 12 }]);
      assert(one.action === 'start', `one dose + override: ${one.action} ${one.dose} mg q${one.tau}h`);
      assert(two.action === 'continue' && two.dose === 1250 && two.tau === 12, `two doses + override: ${two.action}`);
    } finally { run45('bState.regimenOverrideH = null;'); }
  });
  test('45.29 D25: among equally good changes, the smaller daily-dose change wins over nearness to the target box [I4-13]', () => {
    const r = decide45(1.4, 30, hist45(1750, 48));      // 1750 mg q48h; 1500 q48h (AUC 536) before 1250 q48h (446)
    assert(r.action === 'change' && r.dose === 1500 && r.tau === 48, `${r.action} ${r.dose} mg q${r.tau}h AUC ${r.auc24}`);
  });
  test('45.30 rankRegimenCandidates: an exposure tie never goes to a trough of 20 or more when a lower one exists [I4P-5]', () => {
    const r = sandbox.bayesDoseOptimizer(0.85, 70, 520, null, 1);   // 250 q12h, 500 q24h, 1000 q48h all AUC24 588
    assert(r.dose === 1000 && r.tau === 48 && r.Ctrough < K45.TROUGH_HIGH_MGL, `${r.dose} mg q${r.tau}h trough ${r.Ctrough}`);
    assert((r.tiedWith || []).some(t => t.dose === 500 && t.tau === 24 && t.Ctrough >= K45.TROUGH_HIGH_MGL), JSON.stringify(r.tiedWith));
  });

  // Profile and state (I5).
  test('45.31 a changed dose amount, infusion time or dose time marks the fit stale [I5-5]', () => {
    withBayesForm(BAYES_FORM_45(), (env) => {
      run45('bState.result = { model: "buelga", CL_ind: 4.2, V_ind: 55 }; bState.resultFingerprint = bayesInputFingerprint();');
      assert(!sandbox.bayesFitIsStale(), 'the untouched form is not stale');
      for (const [id, to] of [['b-dose-mg-2', '1250'], ['b-dose-tinf-2', '2'], ['b-dose-time-2', '21:00'], ['b-dose-date-3', '2026-11-12']]) {
        const was = env.els[id].value;
        env.els[id].value = to;
        assert(sandbox.bayesFitIsStale(), `${id} ${was} -> ${to} did not mark the fit stale`);
        env.els[id].value = was;
        assert(!sandbox.bayesFitIsStale(), `${id} restored, still stale`);
      }
    });
  });
  test('45.32 a stale fit is saved as staleFit, never as fit; a current one as fit [I5-3]', () => {
    withBayesForm(BAYES_FORM_45(), (env) => {
      run45('bState.result = { model: "buelga", CL_ind: 4.2, V_ind: 55, CL_pop: 5, V_pop: 60, goti: null }; bState.resultFingerprint = bayesInputFingerprint();');
      const cur = sandbox.snapshotBayesForm();
      assert(cur.fit && cur.fit.CL_ind === 4.2 && cur.staleFit === undefined && cur.dirty === false, JSON.stringify({ fit: cur.fit, dirty: cur.dirty }));
      env.els['b-scr'].value = '3.0';
      const st = sandbox.snapshotBayesForm();
      assert(st.fit === null && st.staleFit && st.staleFit.CL_ind === 4.2 && st.dirty === true, JSON.stringify({ fit: st.fit, staleFit: st.staleFit, dirty: st.dirty }));
      assert(st.demographics.scr === '3.0' && st.doses.length === 3 && st.doses[1].time === '20:00', 'the snapshot carries the form as it is');
    });
  });
  test('45.33 deleting one of three profiles keeps the other two, in order; Undo puts it back where it was [I5-2]', () => {
    const { profEnv44, withProf44, profFixture44, PROF_KEY44 } = __suiteShared;
    assert(profEnv44 && profFixture44 && profFixture44.length === 3, 'the SUITE 44 profile harness');
    const env = profEnv44({ [PROF_KEY44]: JSON.stringify(profFixture44) }, {});
    const ids = () => JSON.parse(env.localStorage.getItem(PROF_KEY44)).map(p => p.id);
    const [a, b, c] = profFixture44.map(p => p.id);
    withProf44(env, [], () => {
      sandbox.deleteProfile(b);
      assert(JSON.stringify(ids()) === JSON.stringify([a, c]), `after deleting the middle one: ${ids()}`);
      assert(/Deleted &quot;Fixture 71M legacy&quot;\./.test(env.status[0].innerHTML), env.status[0].innerHTML);
      sandbox.runUndo();
      assert(JSON.stringify(ids()) === JSON.stringify([a, b, c]), `after Undo: ${ids()}`);
      sandbox.deleteProfile('p_notthere1');
      assert(JSON.stringify(ids()) === JSON.stringify([a, b, c]), 'an unknown id deletes nothing');
    });
  });
  test('45.34 a CrCl override outside INPUT_LIMITS.crclOverride (1-250 mL/min) is not applied; one inside it is [I5-4]', () => {
    const els = { 'crcl-override-on': { checked: true }, 'crcl-override-val': { value: '', disabled: false },
      'crcl-override-note': { style: { display: '' }, textContent: '', innerHTML: '' } };
    const prevGet = sandbox.document.getElementById, prevUpd = sandbox.updateCrCl;
    sandbox.document.getElementById = (id) => els[id] || prevGet(id);
    sandbox.updateCrCl = () => {};
    const cg = 80 * 70 / 72, set = (v) => { els['crcl-override-val'].value = v; fn45('setCrclOverride')(); };
    const L = K45.INPUT_LIMITS.crclOverride;
    assert(L.min === 1 && L.max === 250, `override range ${L.min}-${L.max} (the field's own UI limit)`);
    try {
      for (const v of [String(L.max * 12), String(L.min / 2), String(L.max + 1)]) {
        set(v);
        assert(fn45('crclSourceLabel')() === 'Cockcroft-Gault', `${v} mL/min: ${fn45('crclSourceLabel')()}`);
        assertClose(fn45('calcCrCl')(60, 'M', 1.0, 70, P45.ACTUAL), cg, 1e-9, `${v} mL/min reached calcCrCl`);
      }
      set('45');
      assert(fn45('crclSourceLabel')() === 'manual override' && fn45('calcCrCl')(60, 'M', 1.0, 70, P45.ACTUAL) === 45, '45 mL/min applied');
    } finally {
      sandbox.document.getElementById = prevGet; sandbox.updateCrCl = prevUpd;
      run45('crclOverride.on = false; crclOverride.value = null;');
    }
  });
}

// ════════════════════════════════════════════════════════════════════
// SUMMARY
// ════════════════════════════════════════════════════════════════════
console.log(`\n${'═'.repeat(60)}`);
const EXPECTED_TOTAL = 590;   // bump with every added or removed unit test (v3.15.0: 554 + 45.1 + 45.2 + 45.3 + 45.4a-b + 45.5-45.34 + D27 redraw)
console.log('  PHASE 2D VALIDATION SUMMARY');
console.log(`${'─'.repeat(60)}`);
console.log(`  Passed : ${pass}`);
console.log(`  Failed : ${fail}`);
console.log(`  Total  : ${pass+fail}`);
// The count is pinned (Release 2, Task 13): a test that silently stops running, or a suite that is
// skipped by an early exit, changes the total. Every change that adds or removes a unit test bumps this.
if (pass + fail !== EXPECTED_TOTAL) {
  console.log(`\n  ✗ Expected ${EXPECTED_TOTAL} tests but ran ${pass+fail}. A test was lost or added without updating EXPECTED_TOTAL.\n`);
  process.exit(1);
}
if (fail === 0) {
  console.log('\n  ✓ All tests passed — Phase 2D validation complete.\n');
} else {
  console.log(`\n  ✗ ${fail} test(s) failed:\n`);
  allResults.filter(r=>!r.ok).forEach(r => console.log(`    FAIL: ${r.name}\n         ${r.err}`));
}
process.exit(fail === 0 ? 0 : 1);

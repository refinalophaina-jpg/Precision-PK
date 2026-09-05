'use strict';
// ═══════════════════════════════════════════════════════════════════════
// AinaDara Phase 3 — End-to-End Simulation
// ───────────────────────────────────────────────────────────────────────
// Three components, each designed to avoid biasing toward any one model:
//
//   PART 1 — Self-consistency Monte Carlo per model
//     For each model (Buelga · Goti · Hughes), generate synthetic patients
//     whose TRUE PK is drawn from THAT model's population + sampled η.
//     Then test the same model's Bayesian recovery from 1 trough. This is
//     fair to each model (no cross-population bias) and measures shrinkage,
//     posterior accuracy, and dose-attainment on the model's own turf.
//
//   PART 2 — Cross-model disagreement on a shared patient
//     For a diverse cohort, simulate ONE trough per patient using a
//     geometric-mean reference clearance (no model has the home-field
//     advantage), then run all three Bayesian fits on the same observation.
//     Report pairwise disagreement in fitted CL and recommended dose.
//
//   PART 3 — Stratified dose-attainment with the canonical model
//     Non-obese → Buelga/Goti; obese → Hughes. Generate truth from the
//     canonical model, run its Bayesian fit, apply the optimizer, and
//     check whether the true AUC24 lands in 400–600 mg·h/L.
//
// Total fits: ~12,000
// ═══════════════════════════════════════════════════════════════════════

const fs   = require('fs');
const vm   = require('vm');
const path = require('path');

// ─── Sandbox setup ────────────────────────────────────────────────────
const htmlPath = path.join(__dirname, 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const scriptBlocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
if (!scriptBlocks.length) { console.error('ERROR: No <script> block found.'); process.exit(1); }
const scriptJS = scriptBlocks.join('\n');

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
  vm.runInNewContext(scriptJS, sandbox);
} catch(e) {
  console.error('ERROR running calculator JS in VM:', e.message);
  console.error(e.stack);
  process.exit(1);
}

const {
  buelgaPopPK, burtonObjective, nelderMead2D,
  gotiPopPK, burtonObj3D, nelderMead3D,
  hughesPopPK, burtonObj3D_hughes, computeFFM,
  predictConc1comp, predictConc2comp,
  bayesDoseOptimizer, autoTinf,
} = sandbox;

// Constants (const-in-vm not exposed)
const Q_GOTI = 6.5, HUGHES_TVQ_BASE = 6.36;
const OMEGA2_CL_BUELGA = 0.122,  OMEGA2_V_BUELGA  = 0.053;
const OMEGA2_CL_GOTI   = 0.1470, OMEGA2_VC_GOTI   = 0.5103, OMEGA2_VP_GOTI   = 0.2824;
const OMEGA2_CL_HUGHES = 0.0602, OMEGA2_VC_HUGHES = 0.0312, OMEGA2_VP_HUGHES = 0.4974;
const SIGMA_PROP_CLINICAL = 0.10, SIGMA_ADD_CLINICAL = 0.8;  // realistic assay noise

// ─── Seeded PRNG ──────────────────────────────────────────────────────
let _seed = 20260411;
function seededRand() {
  _seed = (_seed * 1664525 + 1013904223) >>> 0;
  const v = _seed / 4294967296;
  return Math.max(1e-12, Math.min(1-1e-12, v));
}
function seededRandn() {
  const u = seededRand(), v = seededRand();
  const z = Math.sqrt(-2*Math.log(u)) * Math.cos(2*Math.PI*v);
  return Math.max(-3.5, Math.min(3.5, z));
}
function uniform(lo, hi) { return lo + seededRand() * (hi - lo); }
function pickInt(lo, hi) { return Math.floor(uniform(lo, hi + 1)); }

// ─── Demographics sampler ─────────────────────────────────────────────
function sampleDemographics(stratum) {
  let age, ht, tbw, scr, sex;
  switch (stratum) {
    case 'adult':
      age = pickInt(20, 85);
      sex = seededRand() < 0.5 ? 'M' : 'F';
      ht  = uniform(155, 190);
      tbw = uniform(20, 32) * ((ht/100) ** 2);  // BMI 20–32
      scr = uniform(0.6, 1.8);
      break;
    case 'class3-obese':
      age = pickInt(25, 85);
      sex = seededRand() < 0.5 ? 'M' : 'F';
      ht  = uniform(155, 190);
      tbw = uniform(40, 60) * ((ht/100) ** 2);  // BMI 40–60
      scr = uniform(0.55, 1.8);
      break;
    case 'mild-obese':
      age = pickInt(25, 85);
      sex = seededRand() < 0.5 ? 'M' : 'F';
      ht  = uniform(155, 190);
      tbw = uniform(30, 39) * ((ht/100) ** 2);
      scr = uniform(0.6, 1.7);
      break;
    case 'arc':
      age = pickInt(20, 45);
      sex = seededRand() < 0.55 ? 'M' : 'F';
      ht  = uniform(165, 195);
      tbw = uniform(22, 28) * ((ht/100) ** 2);
      scr = uniform(0.45, 0.75);
      break;
    default: throw new Error(`unknown stratum: ${stratum}`);
  }
  const mult = sex === 'M' ? 1.0 : 0.85;
  const scrFloor = Math.max(scr, sex === 'M' ? 0.7 : 0.6);
  const crcl = (140 - age) * tbw * mult / (72 * scrFloor);
  const bmi  = tbw / ((ht/100) ** 2);
  return { age, ht, tbw, scr, sex, crcl, bmi };
}

// ─── Model population anchors for a given patient ─────────────────────
function popAnchors(pt) {
  const buelga = buelgaPopPK(Math.min(150, pt.crcl), pt.tbw);
  const goti   = gotiPopPK(Math.min(150, pt.crcl), pt.tbw, false);
  const ffm    = computeFFM(pt.tbw, pt.ht, pt.sex);
  const mult   = pt.sex === 'M' ? 1.0 : 0.85;
  const scrF   = Math.max(pt.scr, pt.sex === 'M' ? 0.7 : 0.6);
  const crclFFM= (140 - pt.age) * ffm * mult / (72 * scrF);
  const hughes = hughesPopPK(crclFFM, ffm);
  return { buelga, goti, hughes, ffm, crclFFM };
}

// ─── Simulate a dosing course + 1 trough observation ─────────────────
function simulateTrough(pt, CL_true, Vc_true, Vp_true, Q_true, tau, dose) {
  const tinfH = autoTinf(dose);
  const nDoses = 6;
  const doses = [];
  for (let i = 0; i < nDoses; i++) doses.push({ mg: dose, tinfH, timeH: i * tau });

  const k10 = CL_true / Vc_true;
  const k12 = Q_true  / Vc_true;
  const k21 = Q_true  / Vp_true;
  const tTrough = 5 * tau + tau - 0.25;                     // 15 min pre-dose 6
  const cClean  = predictConc2comp(doses, tTrough, k10, k12, k21, Vc_true);
  const noise   = seededRandn() * Math.sqrt((SIGMA_PROP_CLINICAL * cClean) ** 2 + SIGMA_ADD_CLINICAL ** 2);
  const cTrough = Math.max(0.3, cClean + noise);
  const auc24_true = dose * (24 / tau) / CL_true;
  return { doses, tau, dose, tTrough, cTrough, auc24_true };
}
// 1-comp path (for Buelga self-consistency)
function simulateTrough1C(pt, CL_true, V_true, tau, dose) {
  const tinfH = autoTinf(dose);
  const nDoses = 6;
  const doses = [];
  for (let i = 0; i < nDoses; i++) doses.push({ mg: dose, tinfH, timeH: i * tau });
  const kel = CL_true / V_true;
  const tTrough = 5 * tau + tau - 0.25;
  const cClean  = predictConc1comp(doses, tTrough, kel, V_true);
  const noise   = seededRandn() * Math.sqrt((SIGMA_PROP_CLINICAL * cClean) ** 2 + SIGMA_ADD_CLINICAL ** 2);
  const cTrough = Math.max(0.3, cClean + noise);
  const auc24_true = dose * (24 / tau) / CL_true;
  return { doses, tau, dose, tTrough, cTrough, auc24_true };
}

// ─── Model fits ───────────────────────────────────────────────────────
function fitBuelga(pt, course) {
  const { doses, tTrough, cTrough } = course;
  const { CL_pop, V_pop } = buelgaPopPK(Math.min(150, pt.crcl), pt.tbw);
  const [etaCL, etaV] = nelderMead2D(
    (a, b) => burtonObjective(a, b, CL_pop, V_pop, doses, [{ timeH:tTrough, conc:cTrough }]),
    0, 0, 300
  );
  return {
    CL_fit: CL_pop * Math.exp(etaCL), CL_pop,
    V_fit:  V_pop  * Math.exp(etaV),  V_pop,
    compart: 1
  };
}
function fitGoti(pt, course) {
  const { doses, tTrough, cTrough } = course;
  const { TVCL, TVVc, TVVp } = gotiPopPK(Math.min(150, pt.crcl), pt.tbw, false);
  const [etaCL, etaVc, etaVp] = nelderMead3D(
    (a, b, c) => burtonObj3D(a, b, c, TVCL, TVVc, TVVp, doses, [{ timeH:tTrough, conc:cTrough }]),
    0, 0, 0, 400
  );
  return {
    CL_fit: TVCL * Math.exp(etaCL), CL_pop: TVCL,
    Vc_fit: TVVc * Math.exp(etaVc), Vc_pop: TVVc,
    Vp_fit: TVVp * Math.exp(etaVp), Vp_pop: TVVp,
    Q: Q_GOTI, compart: 2
  };
}
function fitHughes(pt, course) {
  const { doses, tTrough, cTrough } = course;
  const ffm  = computeFFM(pt.tbw, pt.ht, pt.sex);
  const mult = pt.sex === 'M' ? 1.0 : 0.85;
  const scrF = Math.max(pt.scr, pt.sex === 'M' ? 0.7 : 0.6);
  const crclFFM = (140 - pt.age) * ffm * mult / (72 * scrF);
  const pk = hughesPopPK(crclFFM, ffm);
  const [etaCL, etaVc, etaVp] = nelderMead3D(
    (a, b, c) => burtonObj3D_hughes(a, b, c, pk.TVCL, pk.TVVc, pk.TVVp, pk.TVQ, doses, [{ timeH:tTrough, conc:cTrough }]),
    0, 0, 0, 400
  );
  return {
    CL_fit: pk.TVCL * Math.exp(etaCL), CL_pop: pk.TVCL,
    Vc_fit: pk.TVVc * Math.exp(etaVc), Vc_pop: pk.TVVc,
    Vp_fit: pk.TVVp * Math.exp(etaVp), Vp_pop: pk.TVVp,
    Q: pk.TVQ, compart: 2
  };
}

// ─── Stats helper ─────────────────────────────────────────────────────
function stats(arr) {
  if (!arr || !arr.length) return { mean:0, median:0, sd:0, p5:0, p95:0 };
  const sorted = [...arr].sort((a,b)=>a-b);
  const mean = arr.reduce((s,x)=>s+x, 0) / arr.length;
  const sd = Math.sqrt(arr.reduce((s,x)=>s+(x-mean)**2, 0) / arr.length);
  return {
    mean, sd,
    median: sorted[Math.floor(sorted.length/2)],
    p5:  sorted[Math.floor(sorted.length*0.05)],
    p95: sorted[Math.floor(sorted.length*0.95)]
  };
}

function initCell() {
  return { n:0, aucAbsErr:[], aucMPE:[], aucRelErr:[], popAucAbsErr:[],
           cov10:0, cov15:0, cov20:0, cov30:0, directionCL:0,
           attainRec:0, attainRecTot:0 };
}
function scoreFit(cell, auc_true, auc_fit, auc_pop, CL_true, CL_fit, CL_pop) {
  const abs = Math.abs(auc_fit - auc_true);
  const rel = abs / auc_true;
  cell.aucAbsErr.push(abs);
  cell.popAucAbsErr.push(Math.abs(auc_pop - auc_true));
  cell.aucMPE.push((auc_fit - auc_true) / auc_true * 100);
  cell.aucRelErr.push(rel * 100);
  if (rel <= 0.10) cell.cov10++;
  if (rel <= 0.15) cell.cov15++;
  if (rel <= 0.20) cell.cov20++;
  if (rel <= 0.30) cell.cov30++;
  if (Math.abs(CL_fit - CL_true) < Math.abs(CL_pop - CL_true)) cell.directionCL++;
  cell.n++;
}
function cellRow(name, cell) {
  if (!cell.n) return `  ${name.padEnd(14)} | (no valid fits)`;
  const mae  = stats(cell.aucAbsErr).mean;
  const popM = stats(cell.popAucAbsErr).mean;
  const mpe  = stats(cell.aucMPE).mean;
  const c15  = (cell.cov15/cell.n*100).toFixed(0);
  const c20  = (cell.cov20/cell.n*100).toFixed(0);
  const dirP = (cell.directionCL/cell.n*100).toFixed(0);
  const att  = cell.attainRecTot ? (cell.attainRec/cell.attainRecTot*100).toFixed(0) : '—';
  return `  ${name.padEnd(14)} | ${mae.toFixed(0).padStart(4)} | ${popM.toFixed(0).padStart(5)} | ${(mpe>=0?'+':'')+mpe.toFixed(1).padStart(5)}% | ${c15.padStart(3)}% | ${c20.padStart(3)}% | ${dirP.padStart(3)}% | ${att.padStart(4)}%`;
}
function cellHeader() {
  return '  Model          |  MAE | PopMAE |   MPE  | ±15% | ±20% | DirCL | Attain';
}

// ═══════════════════════════════════════════════════════════════════════
// PART 1 — Self-consistency Monte Carlo per model
// Each model's truth is drawn from its own population + sampled η.
// ═══════════════════════════════════════════════════════════════════════
const N1 = 1000;

console.log('\n' + '═'.repeat(72));
console.log('  PHASE 3 — END-TO-END SIMULATION');
console.log('═'.repeat(72));
console.log(`  Seed: ${_seed} · Realistic assay noise: ${SIGMA_PROP_CLINICAL*100}% + ${SIGMA_ADD_CLINICAL} mg/L\n`);

console.log('─'.repeat(72));
console.log('  PART 1 · Self-consistency Monte Carlo');
console.log('─'.repeat(72));
console.log(`  Each model's truth is drawn from its own population + η; same model fits.`);
console.log(`  n=${N1} per model. This is the fair "home turf" test.\n`);
console.log(cellHeader());
console.log('  ' + '-'.repeat(68));

// ── Buelga self-consistency ────
{
  const cell = initCell();
  for (let i = 0; i < N1; i++) {
    const pt = sampleDemographics('adult');
    const { CL_pop, V_pop } = buelgaPopPK(Math.min(150, pt.crcl), pt.tbw);
    const etaCL = Math.max(-2.5, Math.min(2.5, seededRandn() * Math.sqrt(OMEGA2_CL_BUELGA)));
    const etaV  = Math.max(-2.5, Math.min(2.5, seededRandn() * Math.sqrt(OMEGA2_V_BUELGA)));
    const CL_true = CL_pop * Math.exp(etaCL);
    const V_true  = V_pop  * Math.exp(etaV);
    // Realistic regimen
    const dose = Math.round(Math.max(500, Math.min(2500, 15 * pt.tbw)) / 250) * 250;
    const tau  = pt.crcl > 90 ? 12 : pt.crcl > 50 ? 12 : 24;
    const course = simulateTrough1C(pt, CL_true, V_true, tau, dose);
    if (!isFinite(course.cTrough) || course.cTrough < 0.3 || course.cTrough > 80) continue;

    let fit;
    try { fit = fitBuelga(pt, course); } catch (e) { continue; }
    if (!isFinite(fit.CL_fit) || fit.CL_fit <= 0) continue;

    const doseTot = dose * (24 / tau);
    const auc_fit = doseTot / fit.CL_fit;
    const auc_pop = doseTot / fit.CL_pop;
    scoreFit(cell, course.auc24_true, auc_fit, auc_pop, CL_true, fit.CL_fit, fit.CL_pop);

    // Dose recommendation attainment
    const rec = bayesDoseOptimizer(fit.CL_fit, fit.V_fit, 500);
    if (rec) {
      cell.attainRecTot++;
      const recAUC_true = rec.dose * (24/rec.tau) / CL_true;
      if (recAUC_true >= 400 && recAUC_true <= 600) cell.attainRec++;
    }
  }
  console.log(cellRow('Buelga 2005', cell));
  global._part1_buelga = cell;
}

// ── Goti self-consistency ────
{
  const cell = initCell();
  for (let i = 0; i < N1; i++) {
    const pt = sampleDemographics('adult');
    const { TVCL, TVVc, TVVp } = gotiPopPK(Math.min(150, pt.crcl), pt.tbw, false);
    const etaCL = Math.max(-2.5, Math.min(2.5, seededRandn() * Math.sqrt(OMEGA2_CL_GOTI)));
    const etaVc = Math.max(-2.5, Math.min(2.5, seededRandn() * Math.sqrt(OMEGA2_VC_GOTI)));
    const etaVp = Math.max(-2.5, Math.min(2.5, seededRandn() * Math.sqrt(OMEGA2_VP_GOTI)));
    const CL_true = TVCL * Math.exp(etaCL);
    const Vc_true = TVVc * Math.exp(etaVc);
    const Vp_true = TVVp * Math.exp(etaVp);
    const dose = Math.round(Math.max(500, Math.min(2500, 15 * pt.tbw)) / 250) * 250;
    const tau  = pt.crcl > 90 ? 12 : pt.crcl > 50 ? 12 : 24;
    const course = simulateTrough(pt, CL_true, Vc_true, Vp_true, Q_GOTI, tau, dose);
    if (!isFinite(course.cTrough) || course.cTrough < 0.3 || course.cTrough > 80) continue;

    let fit;
    try { fit = fitGoti(pt, course); } catch (e) { continue; }
    if (!isFinite(fit.CL_fit) || fit.CL_fit <= 0) continue;

    const doseTot = dose * (24 / tau);
    const auc_fit = doseTot / fit.CL_fit;
    const auc_pop = doseTot / fit.CL_pop;
    scoreFit(cell, course.auc24_true, auc_fit, auc_pop, CL_true, fit.CL_fit, fit.CL_pop);

    const rec = bayesDoseOptimizer(fit.CL_fit, fit.Vc_fit, 500, { Vc: fit.Vc_fit, Vp: fit.Vp_fit, Q: Q_GOTI });
    if (rec) {
      cell.attainRecTot++;
      const recAUC_true = rec.dose * (24/rec.tau) / CL_true;
      if (recAUC_true >= 400 && recAUC_true <= 600) cell.attainRec++;
    }
  }
  console.log(cellRow('Goti 2018', cell));
  global._part1_goti = cell;
}

// ── Hughes self-consistency (class 3 obese — its development population) ────
{
  const cell = initCell();
  for (let i = 0; i < N1; i++) {
    const pt = sampleDemographics('class3-obese');
    const ffm = computeFFM(pt.tbw, pt.ht, pt.sex);
    const mult = pt.sex === 'M' ? 1.0 : 0.85;
    const scrF = Math.max(pt.scr, pt.sex === 'M' ? 0.7 : 0.6);
    const crclFFM = (140 - pt.age) * ffm * mult / (72 * scrF);
    const pk = hughesPopPK(crclFFM, ffm);
    const etaCL = Math.max(-2.5, Math.min(2.5, seededRandn() * Math.sqrt(OMEGA2_CL_HUGHES)));
    const etaVc = Math.max(-2.5, Math.min(2.5, seededRandn() * Math.sqrt(OMEGA2_VC_HUGHES)));
    const etaVp = Math.max(-2.5, Math.min(2.5, seededRandn() * Math.sqrt(OMEGA2_VP_HUGHES)));
    const CL_true = pk.TVCL * Math.exp(etaCL);
    const Vc_true = pk.TVVc * Math.exp(etaVc);
    const Vp_true = pk.TVVp * Math.exp(etaVp);
    const Q_true  = pk.TVQ;
    const dose = Math.round(Math.max(750, Math.min(3000, 15 * pt.tbw)) / 250) * 250;
    const tau  = pt.crcl > 90 ? 12 : pt.crcl > 50 ? 12 : 24;
    const course = simulateTrough(pt, CL_true, Vc_true, Vp_true, Q_true, tau, dose);
    if (!isFinite(course.cTrough) || course.cTrough < 0.3 || course.cTrough > 80) continue;

    let fit;
    try { fit = fitHughes(pt, course); } catch (e) { continue; }
    if (!isFinite(fit.CL_fit) || fit.CL_fit <= 0) continue;

    const doseTot = dose * (24 / tau);
    const auc_fit = doseTot / fit.CL_fit;
    const auc_pop = doseTot / fit.CL_pop;
    scoreFit(cell, course.auc24_true, auc_fit, auc_pop, CL_true, fit.CL_fit, fit.CL_pop);

    const rec = bayesDoseOptimizer(fit.CL_fit, fit.Vc_fit, 500, { Vc: fit.Vc_fit, Vp: fit.Vp_fit, Q: pk.TVQ });
    if (rec) {
      cell.attainRecTot++;
      const recAUC_true = rec.dose * (24/rec.tau) / CL_true;
      if (recAUC_true >= 400 && recAUC_true <= 600) cell.attainRec++;
    }
  }
  console.log(cellRow('Hughes 2024', cell));
  global._part1_hughes = cell;
}
console.log();

// ═══════════════════════════════════════════════════════════════════════
// PART 2 — Cross-model disagreement on a shared patient
// Same trough observation fed to all three models; measure disagreement.
// Truth is the GEOMETRIC MEAN of the three models' population CL for
// each patient — no model has the home-field advantage.
// ═══════════════════════════════════════════════════════════════════════
const N2 = 500;

console.log('─'.repeat(72));
console.log('  PART 2 · Cross-model disagreement (shared trough observation)');
console.log('─'.repeat(72));
console.log(`  Truth CL = geometric mean of the 3 models' population CL (neutral).`);
console.log(`  Measures: pairwise %diff in fitted CL + recommended daily dose.`);
console.log(`  n=${N2} diverse patients (BMI 22–55, age 25–85, CrCl 30–170).\n`);

{
  const recs = { buelga:[], goti:[], hughes:[] };
  const CLfits = { buelga:[], goti:[], hughes:[] };
  let validN = 0;
  let bAll = 0, gAll = 0, hAll = 0;

  for (let i = 0; i < N2; i++) {
    // Diverse pick: random stratum
    const strats = ['adult','mild-obese','class3-obese','arc'];
    const s = strats[pickInt(0, strats.length - 1)];
    const pt = sampleDemographics(s);
    const anchors = popAnchors(pt);
    const CL_geomMean = Math.pow(anchors.buelga.CL_pop * anchors.goti.TVCL * anchors.hughes.TVCL, 1/3);
    // Sample η around the geometric-mean baseline (25% CV)
    const eta = seededRandn() * 0.25;
    const CL_true = CL_geomMean * Math.exp(eta);
    // Vc/Vp: average the two 2-comp models for a neutral truth
    const Vc_true = (anchors.goti.TVVc + anchors.hughes.TVVc) / 2 * Math.exp(seededRandn() * 0.30);
    const Vp_true = (anchors.goti.TVVp + anchors.hughes.TVVp) / 2 * Math.exp(seededRandn() * 0.25);
    const Q_true  = (Q_GOTI + anchors.hughes.TVQ) / 2;

    const dose = Math.round(Math.max(500, Math.min(3000, 15 * pt.tbw)) / 250) * 250;
    const tau  = pt.crcl > 90 ? 12 : pt.crcl > 50 ? 12 : 24;
    const course = simulateTrough(pt, CL_true, Vc_true, Vp_true, Q_true, tau, dose);
    if (!isFinite(course.cTrough) || course.cTrough < 0.3 || course.cTrough > 80) continue;

    let fb, fg, fh;
    try { fb = fitBuelga(pt, course); } catch (e) { continue; }
    try { fg = fitGoti(pt, course);   } catch (e) { continue; }
    try { fh = fitHughes(pt, course); } catch (e) { continue; }
    if (![fb.CL_fit, fg.CL_fit, fh.CL_fit].every(x => isFinite(x) && x > 0)) continue;

    const rb = bayesDoseOptimizer(fb.CL_fit, fb.V_fit, 500);
    const rg = bayesDoseOptimizer(fg.CL_fit, fg.Vc_fit, 500, { Vc: fg.Vc_fit, Vp: fg.Vp_fit, Q: Q_GOTI });
    const rh = bayesDoseOptimizer(fh.CL_fit, fh.Vc_fit, 500, { Vc: fh.Vc_fit, Vp: fh.Vp_fit, Q: fh.Q });
    if (!rb || !rg || !rh) continue;

    CLfits.buelga.push(fb.CL_fit);
    CLfits.goti.push(fg.CL_fit);
    CLfits.hughes.push(fh.CL_fit);
    // Daily dose: dose × (24/tau)
    recs.buelga.push(rb.dose * (24/rb.tau));
    recs.goti.push(rg.dose * (24/rg.tau));
    recs.hughes.push(rh.dose * (24/rh.tau));
    // Did each model's recommendation land true AUC in target?
    const trueAUC = CL => (r => r ? (r.dose * 24/r.tau / CL) : null);
    const tA_b = rb.dose * (24/rb.tau) / CL_true;
    const tA_g = rg.dose * (24/rg.tau) / CL_true;
    const tA_h = rh.dose * (24/rh.tau) / CL_true;
    if (tA_b >= 400 && tA_b <= 600) bAll++;
    if (tA_g >= 400 && tA_g <= 600) gAll++;
    if (tA_h >= 400 && tA_h <= 600) hAll++;
    validN++;
  }

  console.log(`  Valid patients: ${validN}/${N2}\n`);

  // Pairwise |%diff| in CL between models
  function pct(a, b) { return Math.abs(a - b) / ((a+b)/2) * 100; }
  const pairs = [['buelga','goti'], ['buelga','hughes'], ['goti','hughes']];
  console.log('  Pairwise CL disagreement (% of midpoint):');
  for (const [x, y] of pairs) {
    const diffs = CLfits[x].map((a, i) => pct(a, CLfits[y][i]));
    const s = stats(diffs);
    console.log(`    ${x.padEnd(7)} vs ${y.padEnd(7)} : median ${s.median.toFixed(1)}%  mean ${s.mean.toFixed(1)}%  p95 ${s.p95.toFixed(1)}%`);
  }
  console.log();
  console.log('  Pairwise daily-dose disagreement (% of midpoint):');
  for (const [x, y] of pairs) {
    const diffs = recs[x].map((a, i) => pct(a, recs[y][i]));
    const s = stats(diffs);
    console.log(`    ${x.padEnd(7)} vs ${y.padEnd(7)} : median ${s.median.toFixed(1)}%  mean ${s.mean.toFixed(1)}%  p95 ${s.p95.toFixed(1)}%`);
  }
  console.log();
  console.log('  True AUC attainment (400–600) on each model\'s recommendation:');
  console.log(`    Buelga 2005  : ${(bAll/validN*100).toFixed(0)}%  (${bAll}/${validN})`);
  console.log(`    Goti 2018    : ${(gAll/validN*100).toFixed(0)}%  (${gAll}/${validN})`);
  console.log(`    Hughes 2024  : ${(hAll/validN*100).toFixed(0)}%  (${hAll}/${validN})`);
  console.log();
  global._part2 = { CLfits, recs, bAll, gAll, hAll, validN };
}

// ═══════════════════════════════════════════════════════════════════════
// PART 3 — Stratified attainment with the canonical model per stratum
// Non-obese + ARC → Goti. Mild obese + class 3 → Hughes.
// Truth is drawn from the canonical model's own population + η, realistic
// η shrinkage; fit with the same canonical model; apply optimizer;
// check true AUC24 lands in 400–600.
// ═══════════════════════════════════════════════════════════════════════
const N3 = 500;

console.log('─'.repeat(72));
console.log('  PART 3 · Stratified dose-attainment (canonical model per stratum)');
console.log('─'.repeat(72));
console.log(`  n=${N3} per stratum.\n`);

function runCanonical(stratum, canonicalName, fitFn) {
  let hit = 0, total = 0;
  const aucAbs = [], mpes = [];
  for (let i = 0; i < N3; i++) {
    const pt = sampleDemographics(stratum);
    let CL_true, Vc_true, Vp_true, Q_true, dose, tau, course, fit;

    if (canonicalName === 'goti') {
      const { TVCL, TVVc, TVVp } = gotiPopPK(Math.min(150, pt.crcl), pt.tbw, false);
      const etaCL = Math.max(-2.5, Math.min(2.5, seededRandn() * Math.sqrt(OMEGA2_CL_GOTI)));
      const etaVc = Math.max(-2.5, Math.min(2.5, seededRandn() * Math.sqrt(OMEGA2_VC_GOTI)));
      const etaVp = Math.max(-2.5, Math.min(2.5, seededRandn() * Math.sqrt(OMEGA2_VP_GOTI)));
      CL_true = TVCL * Math.exp(etaCL);
      Vc_true = TVVc * Math.exp(etaVc);
      Vp_true = TVVp * Math.exp(etaVp);
      Q_true  = Q_GOTI;
    } else {
      // hughes
      const ffm = computeFFM(pt.tbw, pt.ht, pt.sex);
      const mult = pt.sex === 'M' ? 1.0 : 0.85;
      const scrF = Math.max(pt.scr, pt.sex === 'M' ? 0.7 : 0.6);
      const crclFFM = (140 - pt.age) * ffm * mult / (72 * scrF);
      const pk = hughesPopPK(crclFFM, ffm);
      const etaCL = Math.max(-2.5, Math.min(2.5, seededRandn() * Math.sqrt(OMEGA2_CL_HUGHES)));
      const etaVc = Math.max(-2.5, Math.min(2.5, seededRandn() * Math.sqrt(OMEGA2_VC_HUGHES)));
      const etaVp = Math.max(-2.5, Math.min(2.5, seededRandn() * Math.sqrt(OMEGA2_VP_HUGHES)));
      CL_true = pk.TVCL * Math.exp(etaCL);
      Vc_true = pk.TVVc * Math.exp(etaVc);
      Vp_true = pk.TVVp * Math.exp(etaVp);
      Q_true  = pk.TVQ;
    }
    dose = Math.round(Math.max(500, Math.min(3000, 15 * pt.tbw)) / 250) * 250;
    tau  = pt.crcl > 90 ? 12 : pt.crcl > 50 ? 12 : 24;
    course = simulateTrough(pt, CL_true, Vc_true, Vp_true, Q_true, tau, dose);
    if (!isFinite(course.cTrough) || course.cTrough < 0.3 || course.cTrough > 80) continue;

    try { fit = fitFn(pt, course); } catch (e) { continue; }
    if (!isFinite(fit.CL_fit) || fit.CL_fit <= 0) continue;

    const rec = canonicalName === 'goti'
      ? bayesDoseOptimizer(fit.CL_fit, fit.Vc_fit, 500, { Vc: fit.Vc_fit, Vp: fit.Vp_fit, Q: Q_GOTI })
      : bayesDoseOptimizer(fit.CL_fit, fit.Vc_fit, 500, { Vc: fit.Vc_fit, Vp: fit.Vp_fit, Q: fit.Q });
    if (!rec) continue;

    total++;
    const recAUC_true = rec.dose * (24/rec.tau) / CL_true;
    if (recAUC_true >= 400 && recAUC_true <= 600) hit++;

    const doseTot = dose * (24/tau);
    const auc_fit = doseTot / fit.CL_fit;
    aucAbs.push(Math.abs(auc_fit - course.auc24_true));
    mpes.push((auc_fit - course.auc24_true) / course.auc24_true * 100);
  }
  return { hit, total, aucMAE: stats(aucAbs).mean, mpe: stats(mpes).mean };
}

const canonicalMap = {
  'adult':        { model: 'goti',   fn: fitGoti,   label: 'Goti 2018'   },
  'mild-obese':   { model: 'hughes', fn: fitHughes, label: 'Hughes 2024' },
  'class3-obese': { model: 'hughes', fn: fitHughes, label: 'Hughes 2024' },
  'arc':          { model: 'goti',   fn: fitGoti,   label: 'Goti 2018'   },
};
console.log('  Stratum        | Canonical      | MAE  | MPE   | Attain');
console.log('  ' + '-'.repeat(66));
const part3Results = {};
for (const [stratum, c] of Object.entries(canonicalMap)) {
  const r = runCanonical(stratum, c.model, c.fn);
  part3Results[stratum] = r;
  const att = r.total ? (r.hit/r.total*100).toFixed(0) : '—';
  console.log(`  ${stratum.padEnd(14)} | ${c.label.padEnd(14)} | ${r.aucMAE.toFixed(0).padStart(4)} | ${(r.mpe>=0?'+':'')+r.mpe.toFixed(1).padStart(5)}% | ${att.padStart(4)}%  (${r.hit}/${r.total})`);
}
console.log();

// ═══════════════════════════════════════════════════════════════════════
// Pass/fail summary
// ═══════════════════════════════════════════════════════════════════════
console.log('═'.repeat(72));
console.log('  PASS / FAIL SUMMARY');
console.log('═'.repeat(72));

function check(label, pass, detail) {
  console.log(`  ${pass ? '✓' : '✗'}  ${label}${detail ? '  ' + detail : ''}`);
  return pass;
}

let passCount = 0, totalChecks = 0;
function assertCheck(label, pass, detail) {
  totalChecks++;
  if (check(label, pass, detail)) passCount++;
}

// Part 1 expectations
const p1b = global._part1_buelga, p1g = global._part1_goti, p1h = global._part1_hughes;
function selfMAE(c) { return stats(c.aucAbsErr).mean; }
function selfCov20(c) { return c.n ? c.cov20/c.n*100 : 0; }
function selfMpe(c) { return Math.abs(stats(c.aucMPE).mean); }
function attain(c) { return c.attainRecTot ? c.attainRec/c.attainRecTot*100 : 0; }
function popBeat(c) { return selfMAE(c) < stats(c.popAucAbsErr).mean; }

console.log('\n  PART 1 · Self-consistency:\n');
assertCheck(`Buelga self-MAE < 200 mg·h/L`, selfMAE(p1b) < 200, `(${selfMAE(p1b).toFixed(0)})`);
assertCheck(`Buelga ±20% coverage ≥ 50%`, selfCov20(p1b) >= 50, `(${selfCov20(p1b).toFixed(0)}%)`);
assertCheck(`Buelga |MPE| ≤ 15%`, selfMpe(p1b) <= 15, `(${selfMpe(p1b).toFixed(1)}%)`);
assertCheck(`Buelga Bayesian MAE < Pop MAE`, popBeat(p1b), `(bay ${selfMAE(p1b).toFixed(0)} vs pop ${stats(p1b.popAucAbsErr).mean.toFixed(0)})`);
assertCheck(`Buelga attainment ≥ 60%`, attain(p1b) >= 60, `(${attain(p1b).toFixed(0)}%)`);

assertCheck(`Goti self-MAE < 250 mg·h/L`, selfMAE(p1g) < 250, `(${selfMAE(p1g).toFixed(0)})`);
assertCheck(`Goti ±20% coverage ≥ 45%`, selfCov20(p1g) >= 45, `(${selfCov20(p1g).toFixed(0)}%)`);
assertCheck(`Goti |MPE| ≤ 15%`, selfMpe(p1g) <= 15, `(${selfMpe(p1g).toFixed(1)}%)`);
assertCheck(`Goti Bayesian MAE < Pop MAE`, popBeat(p1g), `(bay ${selfMAE(p1g).toFixed(0)} vs pop ${stats(p1g.popAucAbsErr).mean.toFixed(0)})`);
assertCheck(`Goti attainment ≥ 60%`, attain(p1g) >= 60, `(${attain(p1g).toFixed(0)}%)`);

assertCheck(`Hughes self-MAE < 300 mg·h/L (wider — obese Vp variability)`, selfMAE(p1h) < 300, `(${selfMAE(p1h).toFixed(0)})`);
assertCheck(`Hughes ±20% coverage ≥ 40%`, selfCov20(p1h) >= 40, `(${selfCov20(p1h).toFixed(0)}%)`);
assertCheck(`Hughes |MPE| ≤ 15%`, selfMpe(p1h) <= 15, `(${selfMpe(p1h).toFixed(1)}%)`);
assertCheck(`Hughes Bayesian MAE < Pop MAE`, popBeat(p1h), `(bay ${selfMAE(p1h).toFixed(0)} vs pop ${stats(p1h.popAucAbsErr).mean.toFixed(0)})`);
assertCheck(`Hughes attainment ≥ 55%`, attain(p1h) >= 55, `(${attain(p1h).toFixed(0)}%)`);

// Part 2 expectations (cross-model)
const p2 = global._part2;
console.log('\n  PART 2 · Cross-model disagreement:\n');
assertCheck(`Cross-model median CL disagreement (Buelga vs Goti) < 25%`,
  stats(p2.CLfits.buelga.map((a,i)=>Math.abs(a-p2.CLfits.goti[i])/((a+p2.CLfits.goti[i])/2)*100)).median < 25);
assertCheck(`Cross-model median CL disagreement (Goti vs Hughes) < 40%`,
  stats(p2.CLfits.goti.map((a,i)=>Math.abs(a-p2.CLfits.hughes[i])/((a+p2.CLfits.hughes[i])/2)*100)).median < 40);

// Part 3 expectations
console.log('\n  PART 3 · Canonical attainment:\n');
for (const [stratum, r] of Object.entries(part3Results)) {
  const pct = r.total ? r.hit/r.total*100 : 0;
  assertCheck(`${stratum.padEnd(14)} canonical attainment ≥ 55%`, pct >= 55, `(${pct.toFixed(0)}%)`);
}

console.log('\n' + '═'.repeat(72));
console.log(`  OVERALL: ${passCount}/${totalChecks} checks passed`);
console.log('═'.repeat(72));
console.log();
process.exit(passCount === totalChecks ? 0 : 1);

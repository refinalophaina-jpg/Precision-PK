'use strict';
// Audit probe — loads the SHIPPED engine out of index.html and reproduces
// each suspected defect numerically. Read-only; changes nothing.
const fs = require('fs'), vm = require('vm'), path = require('path');

const APP = '/Users/olaiya/Projects-Local/Pharmacy/Vancomycin /AinaDaraTDM/index.html';
const html = fs.readFileSync(APP, 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

// DOM stub whose field values we can drive per-scenario
let FIELDS = {};
function makeEl(id) {
  return {
    get value() { return FIELDS[id] !== undefined ? String(FIELDS[id]) : ''; },
    set value(x) { FIELDS[id] = x; },
    textContent: '', innerHTML: '', style: { display: '' }, checked: false,
    classList: { toggle(){}, add(){}, remove(){}, contains(){ return false; } },
    querySelectorAll: () => [], querySelector: () => null,
    getAttribute: () => null, setAttribute(){}, addEventListener(){},
    appendChild(){}, removeChild(){},
  };
}
const sandbox = {
  document: {
    getElementById: (id) => makeEl(id), querySelector: () => null,
    querySelectorAll: () => [], createElement: () => makeEl('_'),
  },
  window: {}, alert: () => {}, requestAnimationFrame: () => {}, console,
  Math, parseFloat, parseInt, isNaN, isFinite, NaN, Infinity,
  Object, Array, String, Number, Boolean, Function, Date, Error, TypeError, JSON, RegExp,
  bState: { sex: 'M', model: 'buelga', dial: false, result: null, tinkCompare: [] },
};
sandbox.window = sandbox;
vm.runInNewContext(script, sandbox);

const {
  calcIBW, calcAdjBW, calcCrCl, calcCLv, calcVd,
  calcPeakTrough, calcAUC, calcAUC_trap, calcAUC_trap_kel,
  getBayesCrCl, getUncappedCrCl, getGotiCrCl, getHughesCrCl,
  computeFFM, buelgaPopPK, gotiPopPK, hughesPopPK,
} = sandbox;

const f = (x, d = 2) => (x === null || x === undefined ? 'null'
  : (Number.isFinite(x) ? x.toFixed(d) : String(x)));
const hr = (t) => console.log('\n' + '='.repeat(78) + '\n  ' + t + '\n' + '='.repeat(78));

// ───────────────────────────────────────────────────────────────────────
hr('F1 — Cockcroft-Gault: five implementations, same patient');
// Patient: 72M, 170 cm, 80 kg, SCr 0.6 (low-normal, elderly => floor rules diverge)
const P = [
  { lbl: '72M 170cm 80kg SCr 0.6', age: 72, sex: 'M', ht: 170, tbw: 80, scr: 0.6 },
  { lbl: '45F 155cm 95kg SCr 0.5', age: 45, sex: 'F', ht: 155, tbw: 95, scr: 0.5 },
  { lbl: '68M 178cm 140kg SCr 1.1', age: 68, sex: 'M', ht: 178, tbw: 140, scr: 1.1 },
  { lbl: '30M 180cm 70kg SCr 0.9', age: 30, sex: 'M', ht: 180, tbw: 70, scr: 0.9 },
];
console.log('  patient                    M1 calcCrCl   M2 bayes   uncapped   Goti     Hughes(FFM)');
for (const p of P) {
  FIELDS = { 'b-age': p.age, 'b-scr': p.scr, 'b-tbw': p.tbw, 'b-height': p.ht };
  sandbox.bState.sex = p.sex;
  const ibw = calcIBW(p.sex, p.ht);
  const m1 = calcCrCl(p.age, p.sex, p.scr, p.tbw);              // M1 with TBW
  const m1adj = calcCrCl(p.age, p.sex, p.scr, calcAdjBW(p.tbw, ibw));
  console.log(`  ${p.lbl.padEnd(26)} ${f(m1).padStart(8)}   ${f(getBayesCrCl()).padStart(8)}   ${f(getUncappedCrCl()).padStart(8)}  ${f(getGotiCrCl()).padStart(7)}  ${f(getHughesCrCl()).padStart(7)}`);
  console.log(`  ${''.padEnd(26)} (M1 w/AdjBW ${f(m1adj)})`);
}

// ───────────────────────────────────────────────────────────────────────
hr('F2 — IBW: the 30 kg floor is applied in calcIBW but NOT in the inline copies');
console.log('  height(cm)  sex   calcIBW(:2926)   inline(:4787/4807/5112)   diff');
for (const [ht, sex] of [[137, 'F'], [140, 'F'], [145, 'F'], [150, 'F'], [152.4, 'F'], [137, 'M']]) {
  const withFloor = calcIBW(sex, ht);
  const base = sex === 'M' ? 50 : 45.5;
  const inline = base + 2.3 * (ht / 2.54 - 60);
  const flag = Math.abs(withFloor - inline) > 1e-9 ? '  <== DIVERGE' : '';
  console.log(`  ${String(ht).padStart(9)}  ${sex}    ${f(withFloor).padStart(9)}       ${f(inline).padStart(14)}   ${f(withFloor - inline).padStart(7)}${flag}`);
}

// ───────────────────────────────────────────────────────────────────────
hr('F3 — calcPeakTrough numerical guard (:2969) returns trough = 0');
console.log('  Guard fires when e^(-kel*tau) >= 0.9999, i.e. kel*tau <= 1.0e-4.');
console.log('  With no elimination the trough should approach the PEAK (unbounded');
console.log('  accumulation). The guard returns trough = 0 — the opposite.\n');
for (const [kel, tau, note] of [[0, 24, 'kel = 0 (CrCl 0 via buelga)'], [1e-6, 24, 'near-zero kel'], [0.004, 24, 'ESRD-ish, guard does NOT fire']]) {
  const r = calcPeakTrough(1000, tau, 1, kel, 70);
  console.log(`  kel=${String(kel).padEnd(8)} tau=${tau}  -> peak ${f(r.peak)}  trough ${f(r.trough)}   ${note}`);
}
console.log('\n  Reachability via unvalidated input (age has no upper bound):');
const crclAge140 = calcCrCl(140, 'M', 1.0, 70);
const clB = calcCLv('buelga', crclAge140, 70), vdB = calcVd('buelga', 140, 70, crclAge140);
const kelB = clB / vdB;
console.log(`    age=140 -> CrCl ${f(crclAge140)}  CL ${f(clB, 4)} L/h  Vd ${f(vdB)} L  kel ${f(kelB, 6)}`);
const bad = calcPeakTrough(1000, 24, 1, kelB, vdB);
console.log(`    calcPeakTrough -> peak ${f(bad.peak)}  trough ${f(bad.trough)}  AUC24 ${f(calcAUC_trap(bad.peak, bad.trough, 24, 1, kelB))}`);

// ───────────────────────────────────────────────────────────────────────
hr('F4 — two AUC methods: analytic (:3021) vs trapezoid (:3025)');
console.log('  Analytic AUC24 = daily dose / CL is EXACT at steady state.');
console.log('  The trapezoid uses a LINEAR chord across the infusion, where the true');
console.log('  curve is concave — so it should sit slightly low. Quantifying:\n');
console.log('  dose  tau  tinf   CrCl    analytic   trapezoid    diff      %');
let worst = 0, worstRow = '';
for (const crcl of [20, 40, 60, 90, 120]) {
  for (const [dose, tau, tinf] of [[1000, 12, 1], [1500, 24, 1.5], [750, 8, 1], [2000, 24, 2]]) {
    const cl = calcCLv('vancopk', crcl, 80), vd = calcVd('vancopk', 60, 80, crcl), kel = cl / vd;
    const a = calcAUC(dose, tau, cl);
    const t = calcAUC_trap_kel(dose, tau, tinf, kel, vd);
    const pct = (t - a) / a * 100;
    if (Math.abs(pct) > Math.abs(worst)) { worst = pct; worstRow = `${dose}mg q${tau}h ti=${tinf} CrCl ${crcl}`; }
    console.log(`  ${String(dose).padStart(4)}  ${String(tau).padStart(3)}  ${String(tinf).padStart(4)}  ${String(crcl).padStart(5)}   ${f(a, 1).padStart(8)}   ${f(t, 1).padStart(9)}  ${f(t - a, 1).padStart(7)}  ${f(pct, 2).padStart(6)}%`);
  }
}
console.log(`\n  Worst divergence: ${f(worst, 2)}%  (${worstRow})`);

// ───────────────────────────────────────────────────────────────────────
hr('F5 — Matzke Vd step discontinuity at CrCl 60 (:2959)');
for (const crcl of [58, 59, 60, 60.0001, 61, 62]) {
  const vd = calcVd('matzke', 60, 80, crcl), cl = calcCLv('matzke', crcl, 80);
  const pt = calcPeakTrough(1000, 12, 1, cl / vd, vd);
  console.log(`  CrCl ${String(crcl).padStart(8)}  Vd ${f(vd)} L   peak ${f(pt.peak)}  trough ${f(pt.trough)}  AUC24 ${f(calcAUC(1000, 12, cl), 1)}`);
}

// ───────────────────────────────────────────────────────────────────────
hr('F6 — "Buelga" means two different models in the same app');
const crcl = 80, tbw = 76;
const clM1 = calcCLv('buelga', crcl, tbw), vdM1 = calcVd('buelga', 60, tbw, crcl);
const pop = buelgaPopPK(crcl, tbw);
console.log(`  Module 1 'buelga' (:2947/:2957)   CL ${f(clM1, 3)} L/h   Vd ${f(vdM1, 1)} L`);
console.log(`  Module 2 Buelga prior (:5058)     CL ${f(pop.CL_pop, 3)} L/h   Vd ${f(pop.V_pop, 1)} L`);
console.log(`  ratio                             CL x${f(clM1 / pop.CL_pop, 2)}        Vd x${f(vdM1 / pop.V_pop, 2)}`);
console.log('\n  Same nominal model, same patient, different numbers — at CrCl 80/76 kg.');
console.log('  Across CrCl the Module-1 form is linear, the prior is a power model:');
console.log('  CrCl    M1 CL    prior CL   ratio');
for (const c of [20, 40, 60, 80, 100, 120, 150]) {
  const a = calcCLv('buelga', c, tbw), b = buelgaPopPK(c, tbw).CL_pop;
  console.log(`  ${String(c).padStart(4)}   ${f(a, 3).padStart(6)}   ${f(b, 3).padStart(8)}   x${f(a / b, 2)}`);
}

// ───────────────────────────────────────────────────────────────────────
hr('F7 — parseFloat(...) || 0 : blank fields become legal-looking zeros');
console.log('  v(id) at :2920 is `parseFloat(el.value) || 0`. A blank weight, age or');
console.log('  SCr therefore reads as 0 and flows into the engine.\n');
console.log(`  blank SCr  -> calcCrCl(60,'M',0,80)   = ${f(calcCrCl(60, 'M', 0, 80))}   (divide by zero)`);
console.log(`  blank wt   -> calcCrCl(60,'M',1,0)    = ${f(calcCrCl(60, 'M', 1, 0))}`);
console.log(`  blank age  -> calcCrCl(0,'M',1,80)    = ${f(calcCrCl(0, 'M', 1, 80))}   (age 0 => CrCl of a neonate-by-arithmetic)`);
const clZ = calcCLv('buelga', 0, 0), vdZ = calcVd('buelga', 0, 0, 0);
console.log(`  blank wt   -> Vd = ${f(vdZ)} L, CL = ${f(clZ)} L/h -> peak = ${f(calcPeakTrough(1000, 12, 1, 0, vdZ).peak)}`);
console.log('\n  By contrast getBayesCrCl (:4786) DOES guard: `if (!age || !scr || !tbw) return null`.');
console.log('  The two modules disagree on whether a blank field is an error.');

// ───────────────────────────────────────────────────────────────────────
hr('F8 — no upper-bound validation anywhere');
console.log(`  age 200   -> CrCl ${f(calcCrCl(200, 'M', 1, 80))}  (negative CrCl, accepted)`);
console.log(`  wt 500 kg -> CrCl ${f(calcCrCl(50, 'M', 1, 500))}`);
console.log(`  SCr 40    -> CrCl ${f(calcCrCl(50, 'M', 40, 80))}`);
console.log(`  IBW at 300 cm -> ${f(calcIBW('M', 300))} kg`);

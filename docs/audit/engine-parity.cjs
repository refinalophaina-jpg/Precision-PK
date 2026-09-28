'use strict';
// ════════════════════════════════════════════════════════════════════════
// ENGINE PARITY — "the redesign changed presentation, not the engine".
//
// Loads two versions of index.html side by side in Node vm sandboxes and runs
// the same battery of fictional cases through every engine function, then
// compares the outputs value by value (relative tolerance 1e-9). Any
// difference is printed and the script exits 1.
//
// Usage:
//   node docs/audit/engine-parity.cjs <baseline.html> [candidate.html]
//   node docs/audit/engine-parity.cjs --ref <git-ref>        (baseline from git)
// Candidate defaults to ./index.html. Fictional data only.
// ════════════════════════════════════════════════════════════════════════
const fs = require('fs'), vm = require('vm'), path = require('path'), cp = require('child_process');
const ROOT = path.join(__dirname, '..', '..');

function load(html) {
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const mk = () => ({ value: '', textContent: '', innerHTML: '', style: {}, checked: false, dataset: {},
    classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
    querySelectorAll: () => [], querySelector: () => null, getAttribute: () => null, setAttribute() {},
    addEventListener() {}, removeEventListener() {}, appendChild() {}, removeChild() {}, focus() {}, closest: () => null });
  const sb = {
    document: { getElementById: () => mk(), querySelector: () => null, querySelectorAll: () => [],
      createElement: () => mk(), addEventListener() {}, documentElement: mk(), body: mk() },
    window: {}, alert() {}, confirm: () => true, requestAnimationFrame() {}, setTimeout() {}, clearTimeout() {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    matchMedia: () => ({ matches: false, addEventListener() {} }), getComputedStyle: () => ({ getPropertyValue: () => '' }),
    navigator: {}, console, Math, parseFloat, parseInt, isNaN, isFinite, NaN, Infinity,
    Object, Array, String, Number, Boolean, Function, Date, Error, TypeError, JSON, RegExp, Map, Set, Promise,
    bState: { sex: 'M', model: 'buelga', dial: false, result: null, tinkCompare: [] },
  };
  sb.window = sb;
  vm.runInNewContext(script, sb);
  return sb;
}

const args = process.argv.slice(2);
let baseHtml, candHtml;
if (args[0] === '--ref') {
  baseHtml = cp.execSync(`git show ${args[1]}:index.html`, { cwd: ROOT, maxBuffer: 64 << 20 }).toString();
  candHtml = fs.readFileSync(args[2] || path.join(ROOT, 'index.html'), 'utf8');
} else {
  baseHtml = fs.readFileSync(args[0], 'utf8');
  candHtml = fs.readFileSync(args[1] || path.join(ROOT, 'index.html'), 'utf8');
}
const A = load(baseHtml), B = load(candHtml);

// ── the battery (fictional patients and courses) ──
const course = (mg, tau, n, t0 = 1000, tinf = 1) => Array.from({ length: n }, (_, i) => ({ mg, tinfH: tinf, timeH: t0 + i * tau }));
const cases = [];
for (const [age, sex, wt, ht, scr] of [[60, 'M', 80, 175, 1.0], [45, 'F', 62, 160, 0.7], [78, 'F', 55, 155, 1.8], [30, 'M', 130, 180, 0.8], [55, 'M', 95, 172, 3.5]]) {
  cases.push(['calcIBW', [sex, ht]]);
  const ibw = A.calcIBW(sex, ht);
  cases.push(['calcAdjBW', [wt, ibw]]);
  for (const mode of ['auto', 'TBW', 'IBW', 'AdjBW']) cases.push(['pickCrClWeight', [mode, wt, ibw]]);
  const cw = A.pickCrClWeight('auto', wt, ibw).wt;
  for (const pol of Object.values(A.SCR_POLICY || { ACTUAL: 'actual' })) cases.push(['calcCrCl', [age, sex, scr, cw, pol]]);
  const crcl = A.calcCrCl(age, sex, scr, cw, (A.SCR_POLICY || {}).ACTUAL);
  for (const m of ['vancopk', 'matzke', 'matzke_pooled', 'buelga', 'bauer']) { cases.push(['calcCLv', [m, crcl, wt]]); cases.push(['calcVd', [m, age, wt, crcl]]); }
  cases.push(['computeFFM', [wt, ht, sex]]);
  cases.push(['buelgaPopPK', [crcl, wt]]);
  cases.push(['gotiPopPK', [crcl, wt, false]]); cases.push(['gotiPopPK', [crcl, wt, true]]);
  cases.push(['hughesPopPK', [crcl, A.computeFFM(wt, ht, sex)]]);
  cases.push(['computeGuidelineDose', [wt, crcl]]);
  cases.push(['getModelRecommendation', [1, false, wt, ht]]); cases.push(['getModelRecommendation', [2, true, wt, ht]]);
}
for (const [CL, V] of [[4.2, 60], [1.8, 70], [9.7, 55], [0.9, 85]]) {
  cases.push(['bayesDoseOptimizer', [CL, V, 500, null, 1]]);
  cases.push(['bayesDoseOptimizer', [CL, V, 450, { Vc: V * 0.6, Vp: 38.4, Q: 6.5 }, 1]]);
  cases.push(['exposureMatrix', [CL, V, null, 500, 1]]);
  for (const tau of [8, 12, 24, 48]) {
    cases.push(['calcPeakTrough', [1000, tau, 1, CL / V, V]]);
    cases.push(['findOptimalDose', [10, 20, tau, 1, CL / V, V, CL]]);
    cases.push(['fitKelFromLevel', [15, tau - 0.5, 1000, tau, 1, V]]);
    cases.push(['fitKelFromEarlyLevel', [12, tau - 0.5, 2, 1000, tau, 1, V]]);
  }
  cases.push(['calcLoadingDose', [CL, V, 25]]);
  cases.push(['nextLevelValue', [450, 1, 'buelga', 12, CL]]);
  cases.push(['nextLevelValue', [380, 2, 'goti', 24, CL]]);
}
cases.push(['solveTwoLevelsPK', [1000, 1, 30, 2, 15, 10, 12, 'firstdose']]);
cases.push(['solveTwoLevelsPK', [1000, 1, 30, 2, 15, 10, 12, 'steadystate']]);
for (const auc of [300, 380, 450, 620, 800]) cases.push(['assessClinicalStatus', [auc, 12, 10, 20]]);
cases.push(['detectRegimen', [[0, 12, 24, 36, 48, 56, 64].map((h, i) => ({ mg: i === 0 ? 2000 : 1000, tinfH: 1, timeH: h }))]]);
cases.push(['detectRegimen', [course(1250, 12, 6)]]);
cases.push(['kdigoStage', [[{ scr: 1.0, timeH: 0 }, { scr: 1.4, timeH: 30 }, { scr: 2.2, timeH: 90 }]]]);
cases.push(['selectEffectiveScr', [[{ scr: 1.0, timeH: 14 }, { scr: 2.0, timeH: 29 }], 20]]);

// MAP fits through the exact objective functions the app uses.
function fits(S) {
  const out = [];
  if (typeof S.mapFit !== 'function') return ['mapFit absent (predates the multi-start fit)'];
  const q12 = course(1000, 12, 8);
  for (const lev of [[{ conc: 15, timeH: 1000 + 83.5 }], [{ conc: 12, timeH: 1000 + 83.5 }, { conc: 30, timeH: 1000 + 74 }]]) {
    const bp = S.buelgaPopPK(80, 80);
    out.push(S.mapFit((a, b) => S.burtonObjective(a, b, bp.CL_pop, bp.V_pop, q12, lev), 2, 0.0793, 0.138, 300));
    const gp = S.gotiPopPK(80, 80, false);
    out.push(S.mapFit((a, b, c) => S.burtonObj3D(a, b, c, gp.TVCL, gp.TVVc, gp.TVVp, q12, lev), 3, 0.147, 0.5103, 400));
  }
  return out;
}

// ── compare ──
const close = (x, y) => (typeof x === 'number' && typeof y === 'number')
  ? (x === y || (Number.isNaN(x) && Number.isNaN(y)) || Math.abs(x - y) <= 1e-9 * Math.max(1, Math.abs(x), Math.abs(y)))
  : x === y;
// Cycle-safe, function-free copy (some engine results reference each other).
function norm(x, seen = new WeakSet(), depth = 0) {
  if (x === null || typeof x !== 'object') return typeof x === 'function' ? undefined : x;
  if (seen.has(x) || depth > 12) return '[cycle]';
  seen.add(x);
  const o = Array.isArray(x) ? [] : {};
  for (const k of Object.keys(x)) { const v = norm(x[k], seen, depth + 1); if (v !== undefined) o[k] = v; }
  seen.delete(x);
  return o;
}
function diff(a, b, where, out) {
  if (typeof a === 'function' || typeof b === 'function') return;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) diff(a[k], b[k], `${where}.${k}`, out);
  } else if (!close(a, b)) out.push(`${where}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`);
}
const diffs = [];
let ran = 0;
for (const [fn, a] of cases) {
  if (typeof A[fn] !== 'function' || typeof B[fn] !== 'function') { diffs.push(`${fn}: missing in ${typeof A[fn] !== 'function' ? 'baseline' : 'candidate'}`); continue; }
  let ra, rb;
  try { ra = A[fn](...JSON.parse(JSON.stringify(a))); } catch (e) { ra = `THROW ${e.message}`; }
  try { rb = B[fn](...JSON.parse(JSON.stringify(a))); } catch (e) { rb = `THROW ${e.message}`; }
  diff(norm(ra), norm(rb), `${fn}(${JSON.stringify(a).slice(0, 60)})`, diffs); ran++;
}
diff(norm(fits(A)), norm(fits(B)), 'mapFit', diffs); ran++;
console.log(`engine parity: ${ran} calls compared, ${diffs.length} difference${diffs.length === 1 ? '' : 's'}`);
diffs.slice(0, 40).forEach(d => console.log('  ' + d));
process.exit(diffs.length ? 1 : 0);

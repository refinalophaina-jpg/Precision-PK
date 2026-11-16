'use strict';
// ════════════════════════════════════════════════════════════════════════
// PROBE — does the shipped 3-parameter MAP fit find the lowest minimum?
// (models review 2026-11-13, finding I1; Task 17, D27)
//
// For Goti 2018 and Hughes 2024 it simulates fictional patients from each
// model's own prior and residual error, fits them with the shipped `mapFit`
// (called exactly as runBayesian calls it, including the peripheral-volume
// variance), and refits with a wide reference start set: every combination
// of {-2, -1, 0, +1, +2} SD on CL, Vc and Vp (5^3 = 125 Nelder-Mead starts, each
// SD the model's own published omega; the lowest objective wins). The reference
// is a superset of the shipped starts (0, +/-1 SD on CL and on Vc, +/-1 and +/-2 SD
// on Vp), so it can find any minimum the shipped fit can, and more.
//   missed          the reference reaches an objective lower than the shipped fit by more than MISS_TOL
//   shipped beats   the shipped fit reaches an objective lower than the reference by more than MISS_TOL
//                   (the reference is not exhaustive; this says by how much it is not)
// Counts are reported per model and per design. --baseline=<git ref> also fits
// every patient with that version's mapFit (e.g. b410477, the five-start fit of
// v3.14.0) against the same reference, so "before" and "after" share patients.
//
// Regimens (8 doses = steady state), chosen by --regimen:
//   guideline (default)  dose and interval from computeGuidelineDose (15 mg/kg, interval by CrCl)
//   target               q12h or q24h at random, dose sized to an AUC24 of 500 at the typical
//                        clearance (250 mg steps, 500-2500 mg); more slow clearers on q24h
// Designs:
//   one-trough       trough 0.5 h before dose 8
//   peak-trough      that trough + a level 1 h after the end of infusion 7
//   three-troughs    troughs before doses 6, 7 and 8
//   two-after-load   one 25 mg/kg load (cap 3000 mg); 2 h after its end, and 0.5 h before the next dose
//                    (no regimen choice, so its 1,500 patients are the same under both policies:
//                    count them once when adding the two policies' runs together)
//
// Seeded (the LCG in uncertainty-load.cjs), so the figures repeat exactly. --seed
// sets the base seed (default 20261113, the seed the shipped start set was chosen
// on); any other value is a held-out sample.
// Usage:  node docs/audit/probe-map-starts.cjs [n=1500] [models=hughes,goti] [--regimen=target]
//                                            [--seed=20261113] [--baseline=b410477] [--cases]
//   --cases prints every missed case as a JSON fixture (concentrations rounded
//   to 0.01 mg/L, re-checked after rounding) for SUITE 45.2.
// Fictional patients only. Reads index.html; changes nothing.
// ════════════════════════════════════════════════════════════════════════
const vm = require('vm'), cp = require('child_process'), path = require('path');
const { sb, C, rnd, randn, setSeed } = require('./uncertainty-load.cjs');
const { mapFit, nelderMead3D, gotiPopPK, hughesPopPK, burtonObj3D, burtonObj3D_hughes, predictConc2comp,
  computeFFM, calcCrClRaw, calcIBW, pickCrClWeight, computeGuidelineDose, autoTinf } = sb;
const SCR = vm.runInContext('SCR_POLICY', sb);
const CRCL_FLOOR = vm.runInContext('CRCL_MODEL_FLOOR', sb), CRCL_CAP = vm.runInContext('CRCL_MODEL_CAP', sb);

const args = process.argv.slice(2);
const N = +(args.find(a => /^\d+$/.test(a)) || 1500);
const MODELS = (args.find(a => /^[a-z,]+$/.test(a)) || 'hughes,goti').split(',');
const CASES = args.includes('--cases');
const REGIMEN = (args.find(a => a.startsWith('--regimen=')) || '--regimen=guideline').slice(10);
if (!['guideline', 'target'].includes(REGIMEN)) throw new Error('--regimen must be guideline or target');
const opt = (k, d) => { const a = args.find(x => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const SEED = +opt('seed', 20261113);
if (!Number.isInteger(SEED)) throw new Error('--seed must be an integer');
const BASELINE = opt('baseline', null);
// The baseline engine, loaded from git in its own sandbox (same stub as uncertainty-load.cjs).
let baseMapFit = null;
if (BASELINE) {
  const html = cp.execSync(`git show ${BASELINE}:index.html`, { cwd: path.join(__dirname, '..', '..'), maxBuffer: 64 << 20 }).toString();
  const el = () => ({ value: '', textContent: '', innerHTML: '', style: { display: '' }, checked: false,
    classList: { toggle() {}, add() {}, remove() {}, contains: () => false }, querySelectorAll: () => [], querySelector: () => null,
    getAttribute: () => null, setAttribute() {}, addEventListener() {}, appendChild() {}, removeChild() {} });
  const bs = { document: { getElementById: el, querySelector: () => null, querySelectorAll: () => [], createElement: el },
    window: {}, alert() {}, requestAnimationFrame() {}, console, Math, parseFloat, parseInt, isNaN, isFinite, NaN, Infinity,
    Object, Array, String, Number, Boolean, Function, Date, Error, TypeError, JSON, RegExp,
    bState: { sex: 'M', model: 'buelga', dial: false, result: null, tinkCompare: [] } };
  bs.window = bs; vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], bs);
  baseMapFit = bs.mapFit;
}
const MISS_TOL = 1e-6;          // objective units (-2 log posterior)
const DESIGNS = ['one-trough', 'peak-trough', 'three-troughs', 'two-after-load'];
const r2 = x => Math.round(x * 100) / 100;

const MODEL = {
  hughes: {
    omega: () => [C.OMEGA2_CL_HUGHES, C.OMEGA2_VC_HUGHES, C.OMEGA2_VP_HUGHES],
    sigma: () => [C.SIGMA_PROP_HUGHES, C.SIGMA_ADD_HUGHES],
    patient() {
      const sex = rnd() < 0.5 ? 'M' : 'F';
      const ht = sex === 'M' ? 165 + rnd() * 30 : 150 + rnd() * 30;
      const bmi = 40 + rnd() * 30;                       // Hughes enrolment: BMI 40-70.3
      const tbw = Math.round(bmi * (ht / 100) ** 2 * 10) / 10;
      const age = 20 + Math.floor(rnd() * 66), scr = r2(0.5 + rnd() * 2);
      return { sex, ht: Math.round(ht), tbw, age, scr };
    },
    pk(p) {
      const ffm = computeFFM(p.tbw, p.ht, p.sex);
      const crcl = Math.max(CRCL_FLOOR, calcCrClRaw(p.age, p.sex, p.scr, ffm, SCR.ACTUAL));   // getHughesCrCl
      const pk = hughesPopPK(crcl, ffm);
      return { crcl, TVCL: pk.TVCL, TVVc: pk.TVVc, TVVp: pk.TVVp, Q: pk.TVQ,
        obj: (doses, lev) => (a, b, c) => burtonObj3D_hughes(a, b, c, pk.TVCL, pk.TVVc, pk.TVVp, pk.TVQ, doses, lev) };
    },
  },
  goti: {
    omega: () => [C.OMEGA2_CL_GOTI, C.OMEGA2_VC_GOTI, C.OMEGA2_VP_GOTI],
    sigma: () => [C.SIGMA_PROP_GOTI, C.SIGMA_ADD_GOTI],
    patient() {
      const sex = rnd() < 0.5 ? 'M' : 'F';
      const ht = sex === 'M' ? 160 + rnd() * 30 : 150 + rnd() * 25;
      const tbw = Math.round((50 + rnd() * 70) * 10) / 10;
      const age = 20 + Math.floor(rnd() * 66), scr = r2(0.5 + rnd() * 2);
      return { sex, ht: Math.round(ht), tbw, age, scr };
    },
    pk(p) {
      const wt = pickCrClWeight('auto', p.tbw, calcIBW(p.sex, p.ht)).wt;
      const crcl = Math.max(CRCL_FLOOR, Math.min(CRCL_CAP, calcCrClRaw(p.age, p.sex, p.scr, wt, SCR.GOTI_MODEL)));   // getGotiCrCl
      const pk = gotiPopPK(crcl, p.tbw, false);
      return { crcl, TVCL: pk.TVCL, TVVc: pk.TVVc, TVVp: pk.TVVp, Q: C.Q_GOTI,
        obj: (doses, lev) => (a, b, c) => burtonObj3D(a, b, c, pk.TVCL, pk.TVVc, pk.TVVp, doses, lev) };
    },
  },
};

function course(p, pk, design) {
  if (design === 'two-after-load') {
    const mg = Math.min(3000, Math.round(25 * p.tbw / 250) * 250), tinfH = autoTinf(mg);
    const g = computeGuidelineDose(p.tbw, pk.crcl);
    return { doses: [{ mg, tinfH, timeH: 0 }], times: [tinfH + 2, g.tau - 0.5] };
  }
  let g = computeGuidelineDose(p.tbw, pk.crcl);
  if (REGIMEN === 'target') {
    const tau = rnd() < 0.5 ? 12 : 24, mg = Math.min(2500, Math.max(500, Math.round(500 * pk.TVCL * tau / 24 / 250) * 250));
    g = { dose: mg, tau, tinfH: autoTinf(mg) };
  }
  const doses = Array.from({ length: 8 }, (_, i) => ({ mg: g.dose, tinfH: g.tinfH, timeH: i * g.tau }));
  const tr = k => (k - 1) * g.tau - 0.5;   // 0.5 h before dose k
  const times = design === 'one-trough' ? [tr(8)]
    : design === 'peak-trough' ? [6 * g.tau + g.tinfH + 1, tr(8)]
    : [tr(6), tr(7), tr(8)];
  return { doses, times };
}

// The wide reference: 125 starts, {-2,-1,0,+1,+2} SD on each of CL, Vc and Vp; the best objective wins.
const GRID = [-2, -1, 0, 1, 2];
function reference(fn, o) {
  const s = o.map(Math.sqrt);
  let best = null;
  for (const i of GRID) for (const j of GRID) for (const k of GRID) {
    const x = nelderMead3D(fn, i * s[0], j * s[1], k * s[2], 400), f = fn(...x);
    if (isFinite(f) && (!best || f < best.f)) best = { x, f };
  }
  return best;
}
// The shipped fit, called as runBayesian calls it (the 6th argument is ignored by a mapFit that predates Task 17).
const shipped = (fn, o) => mapFit(fn, 3, o[0], o[1], 400, o[2]);

function simulate(model, design, di) {
  const M = MODEL[model], o = M.omega(), [sp, sa] = M.sigma();
  setSeed(SEED + 1000 * di + (model === 'hughes' ? 1 : 2));
  const res = { model, design, n: 0, missed: 0, missedMaterial: 0, maxClGap: 0, shippedAlt: 0, beats: 0, maxBeat: 0,
    base: { missed: 0, maxClGap: 0, alt: 0, beats: 0 }, cases: [] };
  for (let i = 0; i < N; i++) {
    const p = M.patient(), pk = M.pk(p), { doses, times } = course(p, pk, design);
    const CLt = pk.TVCL * Math.exp(randn() * Math.sqrt(o[0]));
    const Vc = pk.TVVc * Math.exp(randn() * Math.sqrt(o[1])), Vp = pk.TVVp * Math.exp(randn() * Math.sqrt(o[2]));
    const levels = times.map(t => {
      const c = predictConc2comp(doses, t, CLt / Vc, pk.Q / Vc, pk.Q / Vp, Vc);
      return { timeH: t, conc: Math.max(0.5, c + randn() * Math.sqrt((sp * c) ** 2 + sa * sa)) };
    });
    const fn = pk.obj(doses, levels);
    const s = shipped(fn, o), ref = reference(fn, o);
    res.n++;
    if (s.alternative) res.shippedAlt++;
    if (s.obj < ref.f - MISS_TOL) { res.beats++; res.maxBeat = Math.max(res.maxBeat, ref.f - s.obj); }
    if (baseMapFit) {
      const b = baseMapFit(fn, 3, o[0], o[1], 400, o[2]);
      if (b.alternative) res.base.alt++;
      if (b.obj < ref.f - MISS_TOL) res.base.beats++;
      if (ref.f < b.obj - MISS_TOL) { res.base.missed++; res.base.maxClGap = Math.max(res.base.maxClGap, Math.abs(Math.exp(ref.x[0] - b.eta[0]) - 1)); }
    }
    if (ref.f < s.obj - MISS_TOL) {
      res.missed++;
      const gap = Math.abs(Math.exp(ref.x[0] - s.eta[0]) - 1);
      if (gap > 0.01) res.missedMaterial++;
      res.maxClGap = Math.max(res.maxClGap, gap);
      const c = { i, patient: p, design, levels: levels.map(l => ({ timeH: l.timeH, conc: l.conc })),
        shipped: { obj: s.obj, CL: pk.TVCL * Math.exp(s.eta[0]), flagged: !!s.alternative },
        ref: { obj: ref.f, CL: pk.TVCL * Math.exp(ref.x[0]) } };
      if (CASES) {   // fixture with rounded concentrations, kept only if the miss survives the rounding
        const lr = levels.map(l => ({ timeH: l.timeH, conc: r2(l.conc) })), fr = pk.obj(doses, lr);
        const sr = shipped(fr, o), rr = reference(fr, o);
        const d0 = doses[0];
        c.fixture = rr.f < sr.obj - MISS_TOL ? { model, design, patient: p,
          course: { mg: d0.mg, tinfH: d0.tinfH, tau: doses.length > 1 ? doses[1].timeH - d0.timeH : null, n: doses.length }, levels: lr,
          refObj: +rr.f.toFixed(6), refCL: +(pk.TVCL * Math.exp(rr.x[0])).toFixed(4),
          shippedObj: +sr.obj.toFixed(6), shippedCL: +(pk.TVCL * Math.exp(sr.eta[0])).toFixed(4) } : null;
      }
      res.cases.push(c);
    }
  }
  return res;
}

const t0 = Date.now();
console.log(`probe-map-starts: regimen ${REGIMEN}; seed ${SEED}; n = ${N} per design; reference = ${GRID.length ** 3} starts ` +
  `({${GRID.join(',')}} SD on CL, Vc, Vp); missed / beats = objective lower by more than ${MISS_TOL}` + (BASELINE ? `; baseline ${BASELINE}` : ''));
for (const m of MODELS) {
  for (const [di, d] of DESIGNS.entries()) {
    const r = simulate(m, d, di);
    console.log(`${m.padEnd(6)} ${d.padEnd(15)} missed ${String(r.missed).padStart(3)} / ${r.n}` +
      `  (CL > 1% apart: ${r.missedMaterial}; largest CL gap ${(100 * r.maxClGap).toFixed(1)}%)  shipped flagged an alternative: ${r.shippedAlt}` +
      `  shipped beats reference: ${r.beats}${r.beats ? ` (by up to ${r.maxBeat.toExponential(2)})` : ''}` +
      (baseMapFit ? `  | baseline ${BASELINE}: missed ${r.base.missed} (largest CL gap ${(100 * r.base.maxClGap).toFixed(1)}%), flagged ${r.base.alt}, beats reference ${r.base.beats}` : ''));
    for (const c of r.cases) {
      console.log(`    #${c.i} ${c.patient.sex} ${c.patient.age} y ${c.patient.tbw} kg ${c.patient.ht} cm SCr ${c.patient.scr}` +
        `  shipped obj ${c.shipped.obj.toFixed(4)} CL ${c.shipped.CL.toFixed(3)}${c.shipped.flagged ? ' (flagged)' : ''}` +
        `  -> reference obj ${c.ref.obj.toFixed(4)} CL ${c.ref.CL.toFixed(3)}`);
      if (CASES && c.fixture) console.log('    FIXTURE ' + JSON.stringify(c.fixture));
    }
  }
}
console.log(`elapsed ${((Date.now() - t0) / 1000).toFixed(1)} s`);

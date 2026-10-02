'use strict';
// ═══════════════════════════════════════════════════════════════════════
//  PROBE — D17 one-time HD dose against VancoPK's HD method (Fewel, vancopk.com)
//
//  VancoPK: next pre-HD = (pre-HD x (1 - removal) + dose / Vd) x exp(-Ke x gap)
//    Vd = 0.29 age + 0.33 ABW + 11 (Fewel 2021 J Clin Pharm Ther 46:1426 — the
//    calculator's own calcVd('vancopk'), not copied); Ke 0.005 /h and removal 35%
//    (30-40%) are vancopk.com's documentation, used HERE ONLY, never shipped.
//  Ours: Goti-HD MAP fit to the same pre-HD level, then hdViewFor (one-time: the
//    session about to start is the only one logged ahead).
//  Fictional patients only.
// ═══════════════════════════════════════════════════════════════════════
const fs = require('fs'), vm = require('vm'), path = require('path');
const { extract } = require('./../../harness_constants.cjs');
const K = extract();
const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
const src = html.match(/<script>([\s\S]*?)<\/script>/)[1];
function makeEl() { return { value:'', textContent:'', innerHTML:'', style:{display:''}, checked:false,
  classList:{toggle(){},add(){},remove(){},contains:()=>false}, querySelectorAll:()=>[], querySelector:()=>null,
  getAttribute:()=>null, setAttribute(){}, addEventListener(){}, appendChild(){}, removeChild(){} }; }
const sb = { document:{ getElementById:()=>makeEl(), querySelector:()=>null, querySelectorAll:()=>[], createElement:()=>makeEl() },
  window:{}, alert(){}, requestAnimationFrame(){}, console, Math, parseFloat, parseInt, isNaN, isFinite, NaN, Infinity,
  Object, Array, String, Number, Boolean, Function, Date, Error, TypeError, JSON, RegExp };
sb.window = sb; vm.runInNewContext(src, sb);

// The calculator's CrCl range for Goti, read from the shipped file (not copied).
const [, CRCL_FLOOR, CRCL_CAP] = (src.match(/const CRCL_MODEL_FLOOR = (\d+), CRCL_MODEL_CAP = (\d+);/) || []).map(Number);
if (!(CRCL_FLOOR > 0 && CRCL_CAP > CRCL_FLOOR)) throw new Error('CRCL_MODEL_FLOOR/CAP not found in index.html');
const KE = 0.005, REMOVAL = 0.35, STEP = 250, MAX = 2000, MID = (K.HD_PREDIALYSIS_MIN + K.HD_PREDIALYSIS_MAX) / 2;
const vpkNext = (pre, mg, vd, gapH) => (pre * (1 - REMOVAL) + mg / vd) * Math.exp(-KE * gapH);
function vpkPick(pre, vd, gapH) {
  const ev = []; for (let mg = 0; mg <= MAX; mg += STEP) ev.push({ mg, c: vpkNext(pre, mg, vd, gapH) });
  const inR = ev.filter(e => e.c >= K.HD_PREDIALYSIS_MIN && e.c <= K.HD_PREDIALYSIS_MAX);
  if (inR.length) return inR.reduce((b, e) => Math.abs(e.c - MID) < Math.abs(b.c - MID) ? e : b);
  return ev.reduce((b, e) => Math.abs(e.c - MID) < Math.abs(b.c - MID) ? e : b);
}

// 1. Reproduce the site's own screen: 71 y, 51.8 kg, pre-HD 16.6, 750 mg, 2 days -> 20.6.
const vdScreen = sb.calcVd('vancopk', 71, 51.8);
const screen = vpkNext(16.6, 750, vdScreen, 48);
console.log(`VancoPK screen: Vd ${vdScreen.toFixed(1)} L, next pre-HD ${screen.toFixed(2)} (site shows 20.6)`);
if (Math.abs(screen - 20.6) > 0.1) { console.error('REPRODUCTION FAILED'); process.exit(1); }

// 2. Fictional cases: a loading dose after session A, the next session B 48 h later; a
//    pre-HD level drawn 30 min before B; "now" is just before B, which is the only session
//    ahead, so the dose follows B and is sized at the assumed gap.
const ages = [40, 62, 85], weights = [45, 70, 110], levels = [8, 12, 15, 18, 22, 25], gaps = [24, 48, 72];
const SCR = 8, rows = [];
for (const age of ages) for (const wt of weights) for (const lv of levels) for (const gap of gaps) {
  // As the calculator does (getGotiCrCl): the Goti SCr policy, then clamped to the model's range.
  const crcl = Math.max(CRCL_FLOOR, Math.min(CRCL_CAP, sb.calcCrCl(age, 'M', SCR, wt, 'goti')));
  const pk = sb.gotiPopPK(crcl, wt, true);
  const ld = Math.min(3000, Math.round(25 * wt / STEP) * STEP);
  const doses = [{ mg: ld, tinfH: sb.autoTinf(ld), timeH: 0 }];
  const lev = [{ conc: lv, timeH: 47.5 }];
  const mf = sb.mapFit((a, b, c) => sb.burtonObj3D(a, b, c, pk.TVCL, pk.TVVc, pk.TVVp, doses, lev), 3, K.OMEGA2_CL_GOTI, K.OMEGA2_VC_GOTI, 400);
  const [eCL, eVc, eVp] = mf.eta;
  const r = { model: 'goti', dial: true, CL_ind: pk.TVCL * Math.exp(eCL), V_ind: pk.TVVc * Math.exp(eVc), tbw: wt,
    goti: { Vc_ind: pk.TVVc * Math.exp(eVc), Vp_ind: pk.TVVp * Math.exp(eVp), Q: pk.Q }, levels: lev, doses,
    hdSessions: [{ n: 1, startH: -4, endH: 0 }, { n: 2, startH: 48, endH: 52 }], fitNowH: 47.75 };
  const rec = sb.hdViewFor(r, gap).rec;
  const vd = sb.calcVd('vancopk', age, wt);
  const ours = rec.kind === 'planned' ? null : rec.mg;
  const theirs = vpkPick(lv, vd, gap).mg;
  rows.push({ age, wt, lv, gap, ours, kind: rec.kind, oursPre: rec.pre, vpkForOurs: vpkNext(lv, ours || 0, vd, gap), theirs, diff: (ours || 0) - theirs });
}
console.log('\nage  wt  pre-HD gap | ours (kind)      our pre | VancoPK for ours | VancoPK pick | ours - theirs');
for (const x of rows) console.log(`${String(x.age).padStart(3)} ${String(x.wt).padStart(4)} ${String(x.lv).padStart(6)} ${String(x.gap).padStart(3)} | ${String(x.ours).padStart(5)} (${x.kind.padEnd(7)}) ${x.oursPre.toFixed(1).padStart(7)} | ${x.vpkForOurs.toFixed(1).padStart(16)} | ${String(x.theirs).padStart(12)} | ${String(x.diff).padStart(6)}`);
const d = rows.map(x => x.diff).sort((a, b) => a - b);
const within = rows.filter(x => Math.abs(x.diff) <= STEP).length;
console.log(`\n${rows.length} cases. ours - VancoPK (mg): median ${d[Math.floor(d.length / 2)]}, range ${d[0]} to ${d[d.length - 1]}; within one 250 mg step: ${within}/${rows.length} (${(100 * within / rows.length).toFixed(0)}%).`);
for (const g of gaps) { const s = rows.filter(x => x.gap === g).map(x => x.diff).sort((a, b) => a - b); console.log(`  gap ${g} h: median ${s[Math.floor(s.length / 2)]} mg`); }

'use strict';
// ═══════════════════════════════════════════════════════════════════════
//  PROBE — v3 case: 34 M, 65 kg, 167.6 cm, SCr 1.6 -> 1.5, CrCl ~60
//  1750 mg over 2 h; levels 18.7 @ 16.9 h and 12.1 @ 24.3 h post-start.
//
//  Reproduces, against the SHIPPED engine:
//    (1) the Buelga and Goti posterior fits the clinician saw
//    (2) the 1750 mg Q48H recommendation, and WHY it won
//    (3) the interval-ranking bias in bayesDoseOptimizer
//    (4) the Two-Level cross-midnight time bug in calcTLDeltas
// ═══════════════════════════════════════════════════════════════════════
const fs = require('fs'), vm = require('vm'), path = require('path');
const { extract } = require('./../../harness_constants.cjs');
const K = extract();

const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
const src  = html.match(/<script>([\s\S]*?)<\/script>/)[1];

function makeEl() {
  return { value:'', textContent:'', innerHTML:'', style:{display:''}, checked:false,
    classList:{toggle(){},add(){},remove(){},contains:()=>false},
    querySelectorAll:()=>[], querySelector:()=>null, getAttribute:()=>null,
    setAttribute(){}, addEventListener(){}, appendChild(){}, removeChild(){} };
}
const sandbox = {
  document:{ getElementById:()=>makeEl(), querySelector:()=>null,
             querySelectorAll:()=>[], createElement:()=>makeEl() },
  window:{}, alert(){}, requestAnimationFrame(){}, console,
  Math, parseFloat, parseInt, isNaN, isFinite, NaN, Infinity,
  Object, Array, String, Number, Boolean, Function, Date, Error, TypeError, JSON, RegExp,
  bState:{ sex:'M', model:'buelga', dial:false, result:null, tinkCompare:[] },
};
sandbox.window = sandbox;
vm.runInNewContext(src, sandbox);

const { buelgaPopPK, burtonObjective, nelderMead2D,
        gotiPopPK, burtonObj3D, nelderMead3D,
        bayesDoseOptimizer, ssCtrough2comp, ssPeak2comp,
        calcCrCl, calcIBW, autoTinf } = sandbox;

const line = s => console.log(s);
const rule = (t) => line(`\n${'═'.repeat(72)}\n  ${t}\n${'─'.repeat(72)}`);

// ── The case ──────────────────────────────────────────────────────────
const AGE = 34, SEX = 'M', TBW = 65, HT_CM = 167.6, SCR = 1.5;
const doses  = [{ mg:1750, tinfH:2, timeH:0 }];
const levels = [{ conc:18.7, timeH:16.9 }, { conc:12.1, timeH:24.3 }];

rule('0. Patient anchors');
const ibw = calcIBW(SEX, HT_CM);
const crclTBW = ((140-AGE)*TBW)/(72*SCR);
const crclIBW = ((140-AGE)*ibw)/(72*SCR);
line(`  IBW              ${ibw.toFixed(1)} kg   (TBW/IBW = ${(TBW/ibw).toFixed(3)})`);
line(`  CrCl @ TBW       ${crclTBW.toFixed(1)} mL/min`);
line(`  CrCl @ IBW       ${crclIBW.toFixed(1)} mL/min`);
const CRCL = crclTBW;          // clinician reported "approximately 60"
line(`  -> using         ${CRCL.toFixed(1)} mL/min`);

// ── 1. Buelga posterior ───────────────────────────────────────────────
rule('1. Buelga 2005 (1-compartment) posterior');
const { CL_pop, V_pop } = buelgaPopPK(CRCL, TBW);
const [eCL, eV] = nelderMead2D((a,b)=>burtonObjective(a,b,CL_pop,V_pop,doses,levels), 0, 0, 300);
const CLb = CL_pop*Math.exp(eCL), Vb = V_pop*Math.exp(eV);
const kelB = CLb/Vb;
line(`  population       CL ${CL_pop.toFixed(3)} L/h    V ${V_pop.toFixed(2)} L`);
line(`  posterior        CL ${CLb.toFixed(3)} L/h    V ${Vb.toFixed(2)} L`);
line(`  kel ${kelB.toFixed(4)} /h    t1/2 ${(0.693/kelB).toFixed(1)} h`);
line(`  clinician saw:   CL 2.62      V 55.4     kel 0.0473    t1/2 14.6`);

// ── 2. Goti posterior ─────────────────────────────────────────────────
rule('2. Goti 2018 (2-compartment) posterior');
const g = gotiPopPK(CRCL, TBW, false);
const [gCL, gVc, gVp] = nelderMead3D(
  (a,b,c)=>burtonObj3D(a,b,c,g.TVCL,g.TVVc,g.TVVp,doses,levels), 0,0,0, 400);
const CLg = g.TVCL*Math.exp(gCL), Vcg = g.TVVc*Math.exp(gVc), Vpg = g.TVVp*Math.exp(gVp);
line(`  population       CL ${g.TVCL.toFixed(3)} L/h   Vc ${g.TVVc.toFixed(2)} L   Vp ${g.TVVp.toFixed(2)} L`);
line(`  posterior        CL ${CLg.toFixed(3)} L/h   Vc ${Vcg.toFixed(2)} L   Vp ${Vpg.toFixed(2)} L`);
line(`  clinician saw:   CL 2.01       Vc 39.2      Vp 28.8`);

// terminal half-life of the 2-comp posterior
const k10 = CLg/Vcg, k12 = K.Q_GOTI/Vcg, k21 = K.Q_GOTI/Vpg;
const S = k10+k12+k21, beta = 0.5*(S - Math.sqrt(S*S - 4*k10*k21));
line(`  terminal t1/2    ${(0.693/beta).toFixed(1)} h   (beta ${beta.toFixed(4)} /h)`);

// ── 3. What the optimizer recommends, and why ─────────────────────────
rule('3. bayesDoseOptimizer — candidate table at each target AUC');
for (const target of [400, 425, 450, 475, 500, 550]) {
  for (const [name, rec] of [
      ['Buelga', bayesDoseOptimizer(CLb, Vb, target, null, 1)],
      ['Goti  ', bayesDoseOptimizer(CLg, Vcg, target, {Vc:Vcg, Vp:Vpg, Q:K.Q_GOTI}, 1)]]) {
    const cands = (rec.candidates && rec.candidates.length ? rec.candidates : [])
      .map(c => `Q${c.tau}H ${String(c.dose).padStart(4)}mg AUC${c.auc24.toFixed(0).padStart(4)}`
                + (c.hardFail.length ? ' [X]' : '   '))
      .join('  ');
    const chosen = rec.regimen ? `${rec.regimen.dose} mg Q${rec.regimen.tau}H  AUC ${rec.regimen.auc24.toFixed(0)}  Ctr ${rec.regimen.Ctrough.toFixed(1)}` : 'none';
    line(`  target ${target}  ${name}  ->  ${chosen}`);
    if (target === 450) line(`                       ${cands}`);
  }
}

// ── 4. The ranking bias ───────────────────────────────────────────────
rule('4. Why Q48H wins: the AUC lattice is finer at long intervals');
line('  Doses are rounded to 250 mg, so achievable AUC24 values form a lattice');
line('  with spacing  d(tau) = 250*(24/tau)/CL.  Ranking on |AUC - target|');
line('  therefore favours whichever interval has the FINEST lattice = the longest.');
line('');
line('  tau    step in AUC24    mean |AUC-target| over random targets');
for (const tau of [8,12,24,48]) {
  const d = 250*(24/tau)/CLg;
  line(`  Q${String(tau).padStart(2)}H   ${d.toFixed(1).padStart(6)}          ${(d/4).toFixed(1).padStart(6)}`);
}
line('');
line('  Expected residual is d/4. Q48H beats Q8H by 6x on this metric alone,');
line('  with no pharmacological content whatsoever.');

// empirical: sweep targets, count how often each interval wins
const wins = {8:0, 12:0, 24:0, 48:0};
let n = 0;
for (let t = 400; t <= 600; t += 0.5) {
  const r = bayesDoseOptimizer(CLg, Vcg, t, {Vc:Vcg, Vp:Vpg, Q:K.Q_GOTI}, 1);
  if (r.regimen) { wins[r.regimen.tau]++; n++; }
}
line(`\n  Sweeping target AUC 400-600 in 0.5 steps (n=${n}), Goti CL ${CLg.toFixed(2)}:`);
for (const tau of [8,12,24,48]) {
  const pct = 100*wins[tau]/n;
  line(`  Q${String(tau).padStart(2)}H won ${String(wins[tau]).padStart(4)} times  ${pct.toFixed(1).padStart(5)}%  ${'#'.repeat(Math.round(pct/2))}`);
}

// and for Buelga, where the 2000 mg cap removes Q48H
const winsB = {8:0, 12:0, 24:0, 48:0}; let nB = 0;
for (let t = 400; t <= 600; t += 0.5) {
  const r = bayesDoseOptimizer(CLb, Vb, t, null, 1);
  if (r.regimen) { winsB[r.regimen.tau]++; nB++; }
}
line(`\n  Same sweep, Buelga CL ${CLb.toFixed(2)} (Q48H dose exceeds the 2000 mg cap):`);
for (const tau of [8,12,24,48]) {
  const pct = 100*winsB[tau]/nB;
  line(`  Q${String(tau).padStart(2)}H won ${String(winsB[tau]).padStart(4)} times  ${pct.toFixed(1).padStart(5)}%  ${'#'.repeat(Math.round(pct/2))}`);
}

// ── 5. Two-level cross-midnight bug ───────────────────────────────────
rule('5. calcTLDeltas — cross-midnight elapsed time');
// replicate the shipped diffHr exactly (it is nested inside calcTLDeltas)
function toMin(t){ const [h,m]=t.split(':').map(Number); return h*60+m; }
function diffHrShipped(from, to){ let d = toMin(to)-toMin(from); if (d<0) d += 24*60; return d/60; }
const cases = [
  ['10:22','03:13', 16.85, 'Level 1  9/12 03:13'],
  ['10:22','10:38', 24.27, 'Level 2  9/12 10:38'],
  ['10:22','12:00', 49.63, 'a level two days later'],
];
for (const [d0, dt, truth, label] of cases) {
  const got = diffHrShipped(d0, dt);
  const ok  = Math.abs(got-truth) < 0.05;
  line(`  ${label.padEnd(26)} shipped ${got.toFixed(2).padStart(6)} h   true ${truth.toFixed(2).padStart(6)} h   ${ok?'ok':'WRONG'}`);
}
line('');
line('  diffHr() wraps every interval into [0,24). Any level drawn 24 h or more');
line('  after the dose is silently mapped to (t mod 24). The value is written to');
line('  the hidden #tl-t2-hours field that the Sawchuk-Zaske solver reads.');

// what the wrong time does to the PK answer
const { solveTwoLevelsPK } = sandbox;
const show = (tag, r) => line(r
  ? `    ${tag.padEnd(30)} kel ${r.kel.toFixed(4)}  Vd ${r.vd.toFixed(1)} L  CL ${(r.kel*r.vd).toFixed(2)} L/h  AUC24 ${r.auc24 !== undefined ? r.auc24.toFixed(0) : '—'}`
  : `    ${tag.padEnd(30)} REFUSED (returns null)`);

line('\n  5a. THIS case — level 2 wraps below level 1, so the solver refuses:');
show('correct times (16.9, 24.3)',  solveTwoLevelsPK(1750, 2, 18.7, 16.9,  12.1, 24.3,  24, 'firstdose'));
show('shipped times (16.85, 0.27)', solveTwoLevelsPK(1750, 2, 18.7, 16.85, 12.1, 0.27, 24, 'firstdose'));

line('\n  5b. WORSE — when BOTH levels fall on the next day they wrap by the same');
line('      24 h, so kel survives but the peak back-extrapolation does not.');
line('      Dose 08:00 day 1; levels 09:00 and 14:00 on day 2 (= 25 h and 30 h):');
const c1b = 18.7, c2b = 12.1;
show('correct times (25, 30)', solveTwoLevelsPK(1750, 2, c1b, 25, c2b, 30, 24, 'firstdose'));
show('shipped times (1, 6)',   solveTwoLevelsPK(1750, 2, c1b, 1,  c2b, 6,  24, 'firstdose'));
const okB  = solveTwoLevelsPK(1750, 2, c1b, 25, c2b, 30, 24, 'firstdose');
const badB = solveTwoLevelsPK(1750, 2, c1b, 1,  c2b, 6,  24, 'firstdose');
if (okB && badB) {
  line(`\n      kel identical (${okB.kel.toFixed(4)} vs ${badB.kel.toFixed(4)}) — the wrap cancels in the slope.`);
  line(`      Vd is ${(badB.vd/okB.vd).toFixed(2)}x wrong, CL is ${((badB.kel*badB.vd)/(okB.kel*okB.vd)).toFixed(2)}x wrong.`);
  line(`      No warning fires: both times look post-infusion and correctly ordered.`);
  line(`      This one does not refuse. It answers, confidently, and is wrong.`);
}

line('');

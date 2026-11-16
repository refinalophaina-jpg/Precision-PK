'use strict';
// ════════════════════════════════════════════════════════════════════════
// PROBE — which continue-or-change answers move when an early-level fit reads the early band?
// (models review I2; Task 19, D27)
//
// Since D27 a fit with a level before steady state (earlyLevelFractions) reads the AUC_UNCERTAINTY row
// simulated for early levels, and regimenDecision counts its 20 dots from that row. This runs
// regimenDecision (the shipped function, as regimenDecisionOf calls it) over a grid of fictional fits and
// current regimens twice, once with the steady-state row and once with the early row for the same model
// and level count, and reports every answer that differs. It is the CEILING: as if every fit on the grid
// were early. Which real fits read the early row is set by SS_FRACTION_EARLY; the fit-based comparison
// (simulated patients and designs, the app's own row choice) is uncertainty-by-model.cjs --early --decisions.
//
// Grid, per model and level count (1, 2, 3):
//   clearance 0.5-12 L/h in 0.25 steps; volume: Buelga V 40/55/70/90 L; Goti and Hughes Vc 30/50/80 L x
//   Vp 40/80 L, Q = Q_GOTI for Goti and the Hughes typical Q (hughesPopPK at CrCl on FFM 100, FFM 70 kg);
//   current regimen 500-2000 mg in 250 mg steps x q8h/q12h/q24h, four given doses (autoTinf), MIC 1, target 450.
// Usage: node docs/audit/probe-early-band-decisions.cjs [--examples=3]
// Fictional values only. Reads index.html; changes nothing.
// ════════════════════════════════════════════════════════════════════════
const vm = require('vm');
const { sb } = require('./uncertainty-load.cjs');
const { regimenDecision, aucUncertaintyRow, autoTinf, hughesPopPK, attainmentDots } = sb;
const Q_GOTI = vm.runInContext('Q_GOTI', sb);
const EX = +((process.argv.find(a => a.startsWith('--examples=')) || '--examples=3').slice(11));
const hQ = hughesPopPK(100, 70).TVQ;
const CLs = []; for (let c = 0.5; c <= 12 + 1e-9; c += 0.25) CLs.push(+c.toFixed(2));
const regs = []; for (let mg = 500; mg <= 2000; mg += 250) for (const tau of [8, 12, 24]) regs.push({ mg, tau });
const vols = {
  buelga: [40, 55, 70, 90].map(V => ({ V, bag: null })),
  goti: [30, 50, 80].flatMap(Vc => [40, 80].map(Vp => ({ V: Vc, bag: { Vc, Vp, Q: Q_GOTI } }))),
  hughes: [30, 50, 80].flatMap(Vc => [40, 80].map(Vp => ({ V: Vc, bag: { Vc, Vp, Q: hQ } }))),
};
const sig = r => !r ? 'none' : r.noSolution ? 'refusal' : `${r.action} ${r.dose} mg q${r.tau}h${r.continueReason ? ' (' + r.continueReason + ')' : ''}${r.decisionReason ? ' (' + r.decisionReason + ')' : ''}`;
const total = { cases: 0, flips: 0 };
for (const m of ['buelga', 'goti', 'hughes']) {
  for (const n of [1, 2, 3]) {
    const ss = aucUncertaintyRow(n, m, false), ea = aucUncertaintyRow(n, m, true);
    const t = { cases: 0, flips: 0, kinds: {}, worse: 0, ex: [] };
    for (const CL of CLs) for (const v of vols[m]) for (const g of regs) {
      const doses = Array.from({ length: 4 }, (_, i) => ({ mg: g.mg, tinfH: autoTinf(g.mg), timeH: i * g.tau }));
      const nowH = 3 * g.tau + g.tau - 0.5;
      const a = regimenDecision(CL, v.V, 450, v.bag, 1, doses, ss, { nowH });
      const b = regimenDecision(CL, v.V, 450, v.bag, 1, doses, ea, { nowH });
      t.cases++;
      // "never worse" under the early row: a change never has fewer early-row dots than the current regimen, except for safety
      if (b && !b.noSolution && b.action === 'change' && b.decisionReason !== 'safety' && b.current && attainmentDots(b.auc24, ea) < attainmentDots(b.current.auc24, ea)) t.worse++;
      if (sig(a) === sig(b)) continue;
      t.flips++;
      const k = `${a && !a.noSolution ? a.action : 'refusal'} -> ${b && !b.noSolution ? b.action : 'refusal'}`;
      t.kinds[k] = (t.kinds[k] || 0) + 1;
      if (t.ex.length < EX) {
        const cur = a.current || (a.action === 'continue' ? a : b.current || b);
        t.ex.push(`CL ${CL} L/h, ${v.bag ? `Vc ${v.bag.Vc} Vp ${v.bag.Vp}` : `V ${v.V}`} L, on ${g.mg} mg q${g.tau}h (AUC24 ${cur.auc24.toFixed(0)}): `
          + `steady-state row ${sig(a)} [current ${attainmentDots(cur.auc24, ss)}/20, answer ${attainmentDots(a.auc24, ss)}/20]; `
          + `early row ${sig(b)} [current ${attainmentDots(cur.auc24, ea)}/20, answer ${attainmentDots(b.auc24, ea)}/20]`);
      }
    }
    total.cases += t.cases; total.flips += t.flips;
    console.log(`${m.padEnd(7)} n=${n}  ${ss.id} -${Math.round(ss.lo * 100)}/+${Math.round(ss.hi * 100)}% vs ${ea.id} -${Math.round(ea.lo * 100)}/+${Math.round(ea.hi * 100)}%: `
      + `${t.flips} of ${t.cases} answers differ ${JSON.stringify(t.kinds)}; early-row changes with fewer dots than the current regimen (not safety): ${t.worse}`);
    for (const e of t.ex) console.log('    e.g. ' + e);
  }
}
console.log(`TOTAL: ${total.flips} of ${total.cases} answers differ.`);

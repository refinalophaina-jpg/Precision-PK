'use strict';
// How often the D26 Hold fires, and how often it is right (Task 21b, D27; controller ruling R33: evidence for the
// user, no change to the Hold). The final review saw Goti's fitted-only hold fire on 19 of 84 synthetic
// steady-state trough + peak pairs; the user's ruling U1 (a fitted OR a carried measured level of 20 mg/L or more
// holds) stands. This reports the rate per model and level design so the user can rule on it.
//
// For each model (Buelga, Goti, Hughes) and each common level design, fictional patients are drawn from that
// model's OWN prior (between-subject variability on CL, V / Vc, Vp) and residual error, exactly as
// uncertainty-by-model.cjs draws them (the Task 19 calibration population), their levels are simulated, and each
// is run through the shipped engine as runBayesian runs it:
//   mapFit (multi-start MAP) -> the result object -> regimenDecision (on the row the app chooses) ->
//   firstDosePlan(r, rec, now, no chosen time, the inferred current regimen), or noSolutionHold on a refusal.
// "now" is set per design (below); every dose at or before it is given, none after; no planned rows (except the late
// designs' one planned second dose), no chosen time.
// The time judged is firstDosePlan's own: when the next dose of the ANSWERED regimen is due (the last dose given plus
// its interval), or now when that has passed; a refusal is judged by noSolutionHold at its due time.
//
// Designs (1000 mg q12h, 1 h infusions; the load designs open with 25 mg/kg total body weight, 250 mg steps, at
// most 3000 mg, infused over autoTinf):
//   ss-trough       steady state: one trough 0.5 h before dose 9 (95.5 h). Now 96 h; doses 1-8 given (0-84 h). Judged at
//                   84 h + the answered interval, never before 96 h (96 h on q12h, dose 9; 108 h on a change to q24h)
//   ss-trough-peak  the same trough + a peak 1 h after the end of dose 8's infusion (86 h); now and judged as above
//   load-one        one level 6-10 h after the start of the load (uniform). Now 0.5 h after it (6.5-10.5 h); only the
//                   load given. Judged at the load + the answered interval (the first maintenance dose: 12 h on q12h)
//   dose-one        no load: 1000 mg q12h from 0 h; one level 2-11 h after the first dose (uniform). Now 0.5 h after it; only the
//                   first dose given. Judged at the first dose + the answered interval (Task 21d, U6a)
//   load-two        2 h after the end of the load's infusion, and 0.5 h before the first maintenance dose (11.5 h).
//                   Now 11.75 h, BEFORE the 12 h maintenance dose (fix round, review item 2: at 12.0 h that dose counted
//                   as given, the 11.5 h level predated it, no measured basis could fire, and 36 h was judged); only
//                   the load given. Judged at the load + the answered interval (the first maintenance dose)
//
//   late-q24        R2 final review (the user's ruling U7): a late first-interval level. The load (as above) at 0 h, 1000 mg
//                   PLANNED at 24 h, one trough-timed level at 23.5 h; now 23.75 h (only the load given). Renal function for
//                   a q24h start: SCr 1.5-3.0 mg/dL (CrCl about 15-60). Judged at the planned dose (firstDosePlan judges the
//                   first planned row first)
//   late-q48        the same with 1000 mg planned at 48 h, the level at 47.5 h, now 47.75 h; SCr 2.5-5.0 (CrCl about 10-35)
//
// Reported per cell (n patients): the Hold fires on the fitted basis (the fitted level at the time held >= 20),
// on the carried measured basis (U1: the newest post-distribution level carried down the fitted terminal slope
// >= 20), either (= the Hold); then, against the TRUE concentration at the time held (the simulated patient's own
// parameters, the same doses): a true hold (>= 20) or a false hold (< 20), for the Hold and per basis; and,
// how many false holds were well below it (true < 15 mg/L, not a near miss); and, for context, how often the true
// level at the time the plan judged was >= 20 (prevalence) and a missed hold
// (no Hold, true >= 20). A refusal (rec.noSolution) holds through noSolutionHold at its due time.
//
// Not modelled: finalizeDecision (ruling 3 keeps an in-range current regimen under Low confidence; it moves the
// time judged only when it changes the interval), HD, planned rows (but for the late designs), a chosen first-dose time.
//
// Task 21c (the user's ruling U5): on Goti (not on dialysis) a fitted-only reading is a caution, not a Hold. The table keeps
// the pre-U5 columns (they reproduce the Task 21b output) and adds U5 Hold, U5 false Hold and U5 caution.
// Task 21d (the user's ruling U6a; R55): a measured basis from a level drawn after the course's first dose and before the
// second is a caution on every model (with the fitted also >= 20: Buelga/Hughes hold, Goti caution). Adds U5+U6 Hold,
// U5+U6 false Hold, U6 caution, and the dose-one design (an unloaded first dose, one level before dose 2).
//
// R2 final-fix wave (ruling R59; the user's ruling U7): both readings at or above the threshold are a Hold on every model
// (so Goti's 'fitted-first' caution is gone: those readings are Holds), and U6a's caution covers only a level drawn within
// FIRST_INTERVAL_CAUTION_H (12 h) of the first dose. The last columns are therefore the SHIPPED rule (U5, U6a bounded by U7,
// R59), and 'U7 Hold' counts the Holds on a measured level alone drawn in the first interval but more than 12 h after the
// first dose: the readings U6a made cautions before U7 (with the false ones). Two designs are appended (late-q24,
// late-q48: a trough-timed level before dose 2), so the earlier cells keep their seeds.
//
// Usage: node docs/audit/probe-hold-rate.cjs [n=1000] [seed=2111] [models=buelga,goti,hughes]
// Seeded and reproducible (uncertainty-load.cjs's LCG; one seed per cell, derived from the base seed).
// Fictional patients only. Reads index.html; changes nothing.
const { sb, C, rnd, randn, setSeed } = require('./uncertainty-load.cjs');
const { buelgaPopPK, burtonObjective, predictConc1comp, gotiPopPK, burtonObj3D, predictConc2comp, hughesPopPK,
  burtonObj3D_hughes, aucUncertaintyRow, latestLevelEarly, autoTinf, regimenDecision, firstDosePlan, noSolutionHold,
  inferCurrentRegimen, computeFFM, mapFit, predictFittedAt, measuredHoldLevel } = sb;
const vm = require('vm');
const TROUGH_HIGH_MGL = vm.runInContext('TROUGH_HIGH_MGL', sb);
const FIRST_INTERVAL_CAUTION_H = vm.runInContext('FIRST_INTERVAL_CAUTION_H', sb);
const args = process.argv.slice(2);
const N = +args[0] || 1000, SEED = +args[1] || 2111;
const MODELS = (args[2] || 'buelga,goti,hughes').split(',');
const DESIGNS = ['ss-trough', 'ss-trough-peak', 'load-one', 'load-two', 'dose-one', 'late-q24', 'late-q48'];   // appended (Task 21d; R2 final): earlier cells keep their seeds
const TAU = 12, MAINT = 1000;

function course(design, tbw) {
  if (design.startsWith('late')) {   // R2 final (U7): the load, a planned second dose at 24 h / 48 h, a trough-timed level before it
    const T2 = design === 'late-q24' ? 24 : 48, mg = Math.min(3000, Math.round(25 * tbw / 250) * 250);
    return { doses: [{ mg, tinfH: autoTinf(mg), timeH: 0 }], planned: [{ mg: MAINT, tinfH: 1, timeH: T2 }], times: [T2 - 0.5], nowH: T2 - 0.25 };
  }
  if (design.startsWith('load')) {
    const mg = Math.min(3000, Math.round(25 * tbw / 250) * 250), tinf = autoTinf(mg);
    const doses = [{ mg, tinfH: tinf, timeH: 0 }];
    for (let d = 1; d <= 8; d++) doses.push({ mg: MAINT, tinfH: 1, timeH: d * TAU });
    const times = design === 'load-one' ? [6 + rnd() * 4] : [tinf + 2, TAU - 0.5];
    return { doses, times, nowH: design === 'load-one' ? times[0] + 0.5 : TAU - 0.25 };
  }
  const doses = [];
  if (design === 'dose-one') {   // Task 21d (U6a): a first dose with no load, one level before dose 2
    for (let d = 0; d < 8; d++) doses.push({ mg: MAINT, tinfH: 1, timeH: d * TAU });
    const times = [2 + rnd() * 9];
    return { doses, times, nowH: times[0] + 0.5 };
  }
  for (let d = 0; d < 8; d++) doses.push({ mg: MAINT, tinfH: 1, timeH: d * TAU });   // dose 9 is the one due at 96 h
  return { doses, times: design === 'ss-trough' ? [8 * TAU - 0.5] : [7 * TAU + 2, 8 * TAU - 0.5], nowH: 8 * TAU };
}

function cell(model, design, seed) {
  setSeed(seed);
  const c = { n: 0, fitted: 0, measured: 0, either: 0, trueHold: 0, falseHold: 0, falseFitted: 0, falseMeasured: 0,
    fittedOnlyFalse: 0, fittedOnly: 0, falseUnder15: 0, caution: 0, cautionFalse: 0, caution6: 0, caution6False: 0, u7: 0, u7False: 0, prevalent: 0, missed: 0, refusals: 0, refusalHolds: 0, skipped: 0, falseExamples: [] };
  for (let i = 0; i < N; i++) {
    const age = 30 + Math.floor(rnd() * 50); let tbw = 50 + rnd() * 50, scr = 0.7 + rnd() * 1.5;
    // late designs: renal function for the interval they test (the same draw, rescaled; the earlier designs are untouched)
    if (design === 'late-q24') scr = 1.5 + (scr - 0.7) / 1.5 * 1.5; else if (design === 'late-q48') scr = 2.5 + (scr - 0.7) / 1.5 * 2.5;
    if (model === 'hughes') tbw = 110 + rnd() * 70;
    const crcl = Math.max(10, Math.min(140, (140 - age) * tbw / (72 * scr)));
    const { doses, times, nowH: nowAt, planned = [] } = course(design, tbw);
    const levels = [];
    let trueAt, r, bag, row, nLev = times.length;
    if (model === 'buelga') {
      const { CL_pop, V_pop } = buelgaPopPK(crcl, tbw);
      const CLt = CL_pop * Math.exp(randn() * Math.sqrt(C.OMEGA2_CL_BUELGA)), Vt = V_pop * Math.exp(randn() * Math.sqrt(C.OMEGA2_V_BUELGA));
      for (const t of times) levels.push({ timeH: t, conc: Math.max(0.5, predictConc1comp(doses, t, CLt / Vt, Vt) + randn() * C.SIGMA_ADD_BUELGA) });
      trueAt = (ds, t) => predictConc1comp(ds, t, CLt / Vt, Vt);
      const nowH = nowAt, given = doses.filter(d => d.timeH <= nowH + 1e-9);
      const fb = (x, y) => burtonObjective(x, y, CL_pop, V_pop, given, levels);
      const eta = mapFit(fb, 2, C.OMEGA2_CL_BUELGA, C.OMEGA2_V_BUELGA, 300).eta;
      const CL = CL_pop * Math.exp(eta[0]), V = V_pop * Math.exp(eta[1]);
      r = { model: 'buelga', CL_ind: CL, V_ind: V, doses: given, levels, fitNowH: nowH, t12_ind: Math.LN2 * V / CL };
      bag = null;
    } else {
      let pk, Q, o, sp, sa, obj;
      if (model === 'goti') {
        pk = gotiPopPK(crcl, tbw, false); Q = C.Q_GOTI; o = [C.OMEGA2_CL_GOTI, C.OMEGA2_VC_GOTI, C.OMEGA2_VP_GOTI]; sp = C.SIGMA_PROP_GOTI; sa = C.SIGMA_ADD_GOTI;
      } else {
        const ffm = computeFFM(tbw, 170, 'M'), crF = Math.max(10, Math.min(140, (140 - age) * ffm / (72 * scr)));
        pk = hughesPopPK(crF, ffm); Q = pk.TVQ; o = [C.OMEGA2_CL_HUGHES, C.OMEGA2_VC_HUGHES, C.OMEGA2_VP_HUGHES]; sp = C.SIGMA_PROP_HUGHES; sa = C.SIGMA_ADD_HUGHES;
      }
      const CLt = pk.TVCL * Math.exp(randn() * Math.sqrt(o[0])), Vct = pk.TVVc * Math.exp(randn() * Math.sqrt(o[1])), Vpt = pk.TVVp * Math.exp(randn() * Math.sqrt(o[2]));
      for (const t of times) { const cc = predictConc2comp(doses, t, CLt / Vct, Q / Vct, Q / Vpt, Vct); levels.push({ timeH: t, conc: Math.max(0.5, cc + randn() * Math.sqrt((sp * cc) ** 2 + sa * sa)) }); }
      trueAt = (ds, t) => predictConc2comp(ds, t, CLt / Vct, Q / Vct, Q / Vpt, Vct);
      const nowH = nowAt, given = doses.filter(d => d.timeH <= nowH + 1e-9);
      obj = model === 'goti' ? (a, b, cc) => burtonObj3D(a, b, cc, pk.TVCL, pk.TVVc, pk.TVVp, given, levels)
        : (a, b, cc) => burtonObj3D_hughes(a, b, cc, pk.TVCL, pk.TVVc, pk.TVVp, pk.TVQ, given, levels);
      const eta = mapFit(obj, 3, o[0], o[1], 400, o[2]).eta;
      const CL = pk.TVCL * Math.exp(eta[0]), Vc = pk.TVVc * Math.exp(eta[1]), Vp = pk.TVVp * Math.exp(eta[2]);
      const k10 = CL / Vc, k12 = Q / Vc, k21 = Q / Vp, s = k10 + k12 + k21, beta = 0.5 * (s - Math.sqrt(Math.max(0, s * s - 4 * k10 * k21)));
      r = { model, CL_ind: CL, V_ind: Vc, doses: given, levels, fitNowH: nowH, t12_ind: Math.LN2 / beta,
        goti: { CL_ind: CL, Vc_ind: Vc, Vp_ind: Vp, Q, k10_ind: k10, k12_ind: k12, k21_ind: k21 } };
      bag = { Vc, Vp, Q };
    }
    if (!(r.CL_ind > 0) || !isFinite(r.CL_ind)) { c.skipped++; continue; }
    c.n++;
    const nowH = r.fitNowH, given = r.doses;
    if (planned.length) r.doses = given.concat(planned);   // the planned rows the plan reads (late designs); the fit used the given ones
    row = aucUncertaintyRow(nLev, model, latestLevelEarly(levels, given, r.t12_ind, model));
    const rec = regimenDecision(r.CL_ind, r.V_ind, 450, bag, 1, given, row, { nowH });
    r.rec = rec;
    const cur0 = inferCurrentRegimen(given, r.CL_ind, r.V_ind, model === 'buelga' ? null : r.goti);
    const cur = cur0 && cur0.dose > 0 && cur0.tau > 0 && cur0.tinfH > 0 ? { dose: cur0.dose, tau: cur0.tau, tinfH: cur0.tinfH } : null;
    // U5 (Task 21c): a Goti fitted-only reading is a caution, not a Hold. It is counted here as the Hold it was before
    // U5 (the same time judged: no planned rows, no chosen time), so the pre-U5 columns reproduce the Task 21b table,
    // and separately as a caution, so the U5 columns are the pre-U5 ones less the cautions.
    // Task 21d (U6a): cautions of every kind ('fitted' U5; 'first-level' and 'fitted-first' U6a) are counted as the Holds
    // they were before (same time judged), and the pre-U5 basis flags are read from the raw readings at that time (the
    // D26 rule: fitted, or the measured level carried down the fitted slope), so the pre-U5 columns still reproduce.
    let hold = false, atH = null, caution = null;
    if (rec && rec.noSolution) {
      c.refusals++;
      const h = noSolutionHold(r, nowH, cur);
      if (h && h.holdCaution) { hold = true; caution = h.holdCaution.kind; atH = h.dueH; }
      else if (h) { hold = true; c.refusalHolds++; atH = h.dueH; }
      else atH = cur && cur.tau > 0 && Math.max(...given.map(d => d.timeH)) + cur.tau > nowH ? Math.max(...given.map(d => d.timeH)) + cur.tau : nowH;
    } else {
      const p = firstDosePlan(r, rec, nowH, null, cur);
      if (p && p.hold) { hold = true; atH = p.holdAtH; }
      else if (p && p.holdCaution) { hold = true; caution = p.holdCaution.kind; atH = p.holdCaution.atH; }
      else atH = p ? p.firstH : nowH;
    }
    const mhP = measuredHoldLevel(r, nowH);
    const fitted = hold && predictFittedAt(r, atH) >= TROUGH_HIGH_MGL, measured = hold && !!mhP && atH >= mhP.timeH && mhP.at(atH) >= TROUGH_HIGH_MGL;
    const truth = trueAt(r.doses, atH);   // r.doses is the given doses, plus the planned ones on the late designs (a held one adds nothing at its own time)
    if (truth >= TROUGH_HIGH_MGL) c.prevalent++;
    if (fitted) c.fitted++;
    if (measured) c.measured++;
    if (fitted && !measured) c.fittedOnly++;
    if (!hold) { if (truth >= TROUGH_HIGH_MGL) c.missed++; continue; }
    c.either++;
    if (caution === 'fitted') { c.caution++; if (truth < TROUGH_HIGH_MGL) c.cautionFalse++; }
    if (caution && caution !== 'fitted') { c.caution6++; if (truth < TROUGH_HIGH_MGL) c.caution6False++; }
    // U7: a Hold on the measured level alone, drawn after the first dose and before the second, more than FIRST_INTERVAL_CAUTION_H
    // after the first dose (before U7, U6a made it a caution). The second dose's time as firstIntervalLevel reads it.
    if (!caution && measured && !fitted && mhP && !(rec && rec.noSolution)) {
      const secondH = given.length >= 2 ? given[1].timeH : planned.length ? planned[0].timeH : given[0].timeH + rec.tau;
      if (mhP.timeH < secondH - 1e-9 && mhP.timeH - given[0].timeH > FIRST_INTERVAL_CAUTION_H + 1e-9) { c.u7++; if (truth < TROUGH_HIGH_MGL) c.u7False++; }
    }
    if (truth >= TROUGH_HIGH_MGL) c.trueHold++;
    else {
      c.falseHold++; if (truth < 15) c.falseUnder15++; if (fitted) c.falseFitted++; if (measured) c.falseMeasured++; if (fitted && !measured) c.fittedOnlyFalse++;
      if (c.falseExamples.length < 3) c.falseExamples.push(`levels ${levels.map(l => `${l.conc.toFixed(1)} at ${l.timeH.toFixed(1)} h`).join(', ')}; held at ${atH.toFixed(2)} h `
        + `(${fitted ? 'fitted' : ''}${fitted && measured ? '+' : ''}${measured ? 'measured' : ''}); true ${truth.toFixed(1)} mg/L`);
    }
  }
  return c;
}

const pc = (a, b) => b ? `${(100 * a / b).toFixed(1)}%` : '—';
const seedOf = (mi, di) => SEED + 1000 * mi + 17 * di;
console.log(`probe-hold-rate: n = ${N} per cell; base seed ${SEED} (cell seed = base + 1000 x model index + 17 x design index); `
  + `threshold ${TROUGH_HIGH_MGL} mg/L; shipped engine (mapFit, regimenDecision, firstDosePlan / noSolutionHold)`);
console.log('Fired: % of patients. True / false: % of the Holds that fired (true level at the time held >= / < threshold).');
console.log('False, true < 15: a false Hold whose true level at the time held is under 15 mg/L (well below the threshold, not a near miss).');
console.log('false|fitted, false|measured: false Holds among those that fired on that basis. Fitted-only: fired on the fitted basis with the');
console.log('carried measured level below the threshold (or none), false among them.');
console.log('Prevalence: true level >= threshold at the time judged. Missed: no Hold, true level >= threshold.');
console.log('Designs (1000 mg q12h over 1 h; load = 25 mg/kg TBW, 250 mg steps, at most 3000 mg). Judged = when the next dose of the');
console.log('ANSWERED regimen is due (last dose given + its interval), never before now:');
console.log('  ss-trough       trough at 95.5 h; now 96 h; doses 0-84 h given; judged at 84 h + interval, at least 96 h (96 h on q12h, 108 h on q24h)');
console.log('  ss-trough-peak  peak at 86 h + trough at 95.5 h; now and judged as ss-trough');
console.log('  load-one        one level 6-10 h after the load; now 0.5 h after it; only the load given; judged at load + interval (12 h on q12h, 24 h on q24h)');
console.log('  load-two        levels 2 h after the load infusion ends and at 11.5 h; now 11.75 h (before the 12 h dose); only the load given;');
console.log('                  judged at load + interval, at least 11.75 h (11.75-12 h on q8h/q12h, 24 h on q24h)');
console.log('  dose-one        no load: one level 2-11 h after the first 1000 mg dose; now 0.5 h after it; only that dose given;');
console.log('                  judged at the first dose + interval, at least now (12 h on q12h, 24 h on q24h)');
console.log('  late-q24        the load at 0 h, 1000 mg PLANNED at 24 h, one level at 23.5 h; now 23.75 h; SCr 1.5-3.0; judged at the planned dose (24 h)');
console.log('  late-q48        the load at 0 h, 1000 mg PLANNED at 48 h, one level at 47.5 h; now 47.75 h; SCr 2.5-5.0; judged at the planned dose (48 h)');
console.log('Pre-U5 columns: the rule shipped in v3.14.0 / Task 21b (a Goti fitted-only reading held). U5 columns (Task 21c, the user\'s');
console.log('ruling U5, shipped): U5 Hold = Holds that still fire; U5 false Hold = % of them false; U5 caution = Goti fitted-only readings');
console.log('now shown as a caution instead (false: the true level at that time was under the threshold).');
console.log('U6a columns (Task 21d, the user\'s ruling U6a, shipped with U5): U5+U6 Hold = Holds that still fire; U5+U6 false Hold = % of them');
console.log('false; U6 caution = readings now a caution because their measured basis is a level drawn after the first dose and before the');
console.log('second, with the false ones.');
console.log('R2 final review (ruling R59, the user\'s ruling U7): the U5+U6 columns are the SHIPPED rule. R59: the fitted level and the');
console.log('measured level both >= 20 is a Hold on every model (Goti\'s fitted-first caution is gone). U7: U6a covers only a level drawn');
console.log(`within ${FIRST_INTERVAL_CAUTION_H} h of the first dose. U7 Hold = Holds on a measured level alone drawn in the first interval more than`);
console.log(`${FIRST_INTERVAL_CAUTION_H} h after the first dose (U6a cautions before U7), with the false ones.\n`);
const head = ['model', 'design', 'n', 'fitted', 'measured', 'either (Hold, pre-U5)', 'true hold', 'false hold', 'false, true < 15', 'false|fitted', 'false|measured', 'fitted-only (false)', 'prevalence', 'missed', 'refusals (held)',
  'U5 Hold', 'U5 false Hold', 'U5 caution (false)', 'U5+U6 Hold', 'U5+U6 false Hold', 'U6 caution (false)', 'U7 Hold (false)'];
const rows = [];
MODELS.forEach((m, mi) => DESIGNS.forEach((d, di) => {
  const c = cell(m, d, seedOf(['buelga', 'goti', 'hughes'].indexOf(m), di));
  rows.push([m, d, String(c.n), `${c.fitted} (${pc(c.fitted, c.n)})`, `${c.measured} (${pc(c.measured, c.n)})`, `${c.either} (${pc(c.either, c.n)})`,
    `${c.trueHold} (${pc(c.trueHold, c.either)})`, `${c.falseHold} (${pc(c.falseHold, c.either)})`, `${c.falseUnder15} (${pc(c.falseUnder15, c.either)})`, `${c.falseFitted}/${c.fitted} (${pc(c.falseFitted, c.fitted)})`,
    `${c.falseMeasured}/${c.measured} (${pc(c.falseMeasured, c.measured)})`, `${c.fittedOnlyFalse}/${c.fittedOnly} (${pc(c.fittedOnlyFalse, c.fittedOnly)})`,
    `${c.prevalent} (${pc(c.prevalent, c.n)})`, `${c.missed} (${pc(c.missed, c.n)})`, `${c.refusals} (${c.refusalHolds})`,
    `${c.either - c.caution} (${pc(c.either - c.caution, c.n)})`, `${c.falseHold - c.cautionFalse} (${pc(c.falseHold - c.cautionFalse, c.either - c.caution)})`,
    `${c.caution} (${c.cautionFalse}, ${pc(c.cautionFalse, c.caution)})`,
    `${c.either - c.caution - c.caution6} (${pc(c.either - c.caution - c.caution6, c.n)})`,
    `${c.falseHold - c.cautionFalse - c.caution6False} (${pc(c.falseHold - c.cautionFalse - c.caution6False, c.either - c.caution - c.caution6)})`,
    `${c.caution6} (${c.caution6False}, ${pc(c.caution6False, c.caution6)})`, `${c.u7} (${c.u7False}, ${pc(c.u7False, c.u7)})`]);
  rows[rows.length - 1].examples = c.falseExamples;
  rows[rows.length - 1].skipped = c.skipped;
}));
console.log('| ' + head.join(' | ') + ' |');
console.log('|' + head.map(() => '---').join('|') + '|');
for (const r of rows) console.log('| ' + r.join(' | ') + ' |');
console.log('\nFalse-hold examples (up to 3 per cell; fictional):');
for (const r of rows) for (const e of r.examples) console.log(`  ${r[0]} ${r[1]}: ${e}`);
const sk = rows.filter(r => r.skipped).map(r => `${r[0]} ${r[1]} ${r.skipped}`);
if (sk.length) console.log(`\nSkipped (fit not finite): ${sk.join('; ')}`);

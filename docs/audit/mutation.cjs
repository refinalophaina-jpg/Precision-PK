'use strict';
// ════════════════════════════════════════════════════════════════════════
// MUTATION CHECK — "would the Node suites notice if this line were wrong?"
//
// The 2026-11-13 code review (docs/review/2026-11-13/code-report.md, I3, I4 and
// I5) broke the engine and the profile/state code one line at a time and found
// that many of those breakages passed every Node suite. This script keeps that
// list and re-runs it: for each mutant it applies ONE exact textual change to
// index.html IN MEMORY, runs the Node suites against the changed text, and
// reports whether any suite failed (killed) or all still passed (SURVIVED).
//
// index.html is never written. Each suite is started with this file as a
// `--require` preload; the preload patches fs.readFileSync so that reading the
// repository's index.html (and only that path) returns the mutated text. The
// mutant travels in an environment variable, so no scratch copy exists either.
//
// Each mutant is an exact find string that must occur exactly ONCE in
// index.html, and its replacement. A find string that is missing or ambiguous
// stops the whole run with an error before any suite starts: a refactor that
// moves the code must update the mutant here, never silently drop it.
//
// Before the mutants, the unmutated file is run through the same preload; if
// that baseline fails, every "killed" would be meaningless, so the run stops.
//
// Usage:
//   node docs/audit/mutation.cjs                 run every mutant
//   node docs/audit/mutation.cjs --only I4-01,I5-3
//   node docs/audit/mutation.cjs --list          print the mutants and exit
//   node docs/audit/mutation.cjs --jobs 4        mutants run in parallel (default 4);
//                                                each mutant's suites run in sequence
//   node docs/audit/mutation.cjs --timeout-ms N  per-suite time limit for the mutant runs (default
//                                                300000); the baseline always gets at least the default
// A suite that fails kills the mutant. A suite that runs out of time does NOT: the
// mutant is reported TIMEOUT, which is "not proven", never "killed".
// Exit 0 only when every selected mutant is killed; 1 when any SURVIVED or TIMEOUT;
// 2 on a setup error (no mutants selected, a find string missing or ambiguous, a
// failing baseline, a bad argument).
// Joins the release gate for clinical releases from v3.15.0 (D27).
// ════════════════════════════════════════════════════════════════════════
const fs = require('fs'), path = require('path'), cp = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const APP = path.join(ROOT, 'index.html');
const ENV_KEY = 'AINADARA_MUTANT';

// ─── Preload mode: loaded with `node --require <this file> <suite>` ─────────
if (require.main !== module) {
  const spec = process.env[ENV_KEY];
  if (spec) {
    const m = JSON.parse(spec);
    const target = path.resolve(m.file);
    const realRead = fs.readFileSync;
    let mutated = null;
    const mutate = () => {
      const text = realRead.call(fs, target, 'utf8');
      if (m.find === '' && m.replace === '') return text;                 // the baseline run
      const n = text.split(m.find).length - 1;
      if (n !== 1) throw new Error(`mutation ${m.id}: find string occurs ${n} times`);
      return text.replace(m.find, () => m.replace);
    };
    fs.readFileSync = function (p, opts) {
      let resolved = null;
      try { if (typeof p === 'string') resolved = path.resolve(p); else if (p instanceof URL) resolved = path.resolve(require('url').fileURLToPath(p)); }
      catch (e) { resolved = null; }
      if (resolved === target) {
        if (mutated === null) mutated = mutate();
        const enc = typeof opts === 'string' ? opts : (opts && opts.encoding);
        return enc ? mutated : Buffer.from(mutated, 'utf8');
      }
      return realRead.apply(this, arguments);
    };
  }
  return;
}

// ─── The mutants ───────────────────────────────────────────────────────────
// id: the code report's section and an ordinal. Where the report's mutation is
// described rather than quoted, the change below is the most direct reading of it.
const MUTANTS = [
  // I3 — Hughes variability constants (killed since Task 13's SUITE 45.1; kept as the evidence).
  { id: 'I3-1', what: 'OMEGA2_CL_HUGHES doubled (0.0602 to 0.1204)',
    find: 'const OMEGA2_CL_HUGHES = 0.0602;', replace: 'const OMEGA2_CL_HUGHES = 0.1204;' },
  { id: 'I3-2', what: 'OMEGA2_CL_HUGHES x10 (0.0602 to 0.602)',
    find: 'const OMEGA2_CL_HUGHES = 0.0602;', replace: 'const OMEGA2_CL_HUGHES = 0.602;' },
  { id: 'I3-3', what: 'OMEGA2_VP_HUGHES x0.1 (0.4974 to 0.0497); also I4 row 19',
    find: 'const OMEGA2_VP_HUGHES = 0.4974;', replace: 'const OMEGA2_VP_HUGHES = 0.0497;' },
  { id: 'I3-4', what: 'SIGMA_PROP_HUGHES 0.156 to 0.356; also I4 row 20',
    find: 'const SIGMA_PROP_HUGHES= 0.156;', replace: 'const SIGMA_PROP_HUGHES= 0.356;' },
  { id: 'I3-5', what: 'SIGMA_ADD_HUGHES 1.2 to 3.2',
    find: 'const SIGMA_ADD_HUGHES = 1.2;', replace: 'const SIGMA_ADD_HUGHES = 3.2;' },

  // I4 — engine mutations that survived every Node suite (table rows 1-18; rows 19-20 are I3-3, I3-4).
  { id: 'I4-01', what: 'calcCrCl ignores the manual CrCl override',
    find: '  if (crclOverride.on && crclOverride.value > 0) return crclOverride.value;\n  return calcCrClRaw(age, sex, scr, wtKg, policy);',
    replace: '  return calcCrClRaw(age, sex, scr, wtKg, policy);' },
  { id: 'I4-02', what: 'evalRegimen: the AUC24 > 700 hard reject removed',
    find: 'if (auc24 > AUC24_ABSOLUTE_MAX)  hardFail.push(', replace: 'if (false)  hardFail.push(' },
  { id: 'I4-03', what: 'evalRegimen: danger trough flag moved from >= 20 to > 22',
    find: "if (Ctrough >= TROUGH_HIGH_MGL) flags.push({ level:'danger',", replace: "if (Ctrough > 22) flags.push({ level:'danger'," },
  { id: 'I4-04', what: 'evalRegimen: sub-MIC trough flag removed',
    find: "if (Ctrough < mic) flags.push({ level:'info',", replace: "if (false) flags.push({ level:'info'," },
  { id: 'I4-05', what: 'predictConc1comp: during-infusion concentration computed as end-of-infusion',
    find: 'C += (R0 / (kel * vd)) * (1 - Math.exp(-kel * dt));', replace: 'C += (R0 / (kel * vd)) * (1 - Math.exp(-kel * d.tinfH));' },
  { id: 'I4-06', what: 'applyScrPolicy: Goti SCr floor age > 65 changed to >= 65',
    find: 'scr < GOTI_SCR_FLOOR && age > GOTI_SCR_FLOOR_AGE', replace: 'scr < GOTI_SCR_FLOOR && age >= GOTI_SCR_FLOOR_AGE' },
  { id: 'I4-07', what: 'calcIBW: unknown sex takes the male Devine base',
    find: 'IBW_DEVINE_BASE[sex] : IBW_DEVINE_BASE.F', replace: 'IBW_DEVINE_BASE[sex] : IBW_DEVINE_BASE.M' },
  { id: 'I4-08', what: 'regimenDecision: continue test < changed to <= at the margin',
    find: 'best - cur.dots < CONTINUE_MARGIN_DOTS) return keep(', replace: 'best - cur.dots <= CONTINUE_MARGIN_DOTS) return keep(' },
  { id: 'I4-09', what: 'regimenDecision: "keep in-range candidates" filter removed',
    find: '  if (pool.some(c => c.inBand)) pool = pool.filter(c => c.inBand);\n', replace: '\n' },
  { id: 'I4-10', what: 'regimenDecision: danger troughs not set aside in the lattice',
    find: 'const safe = lattice.filter(c => !c.danger);', replace: 'const safe = lattice.filter(c => true);' },
  { id: 'I4-11', what: 'regimenDecision: unsafe current regimen kept when nothing is admissible',
    find: "if (!pool.length) return cur.unsafe ? nearest : keep('no-better');", replace: "if (!pool.length) return keep('no-better');" },
  { id: 'I4-12', what: 'currentRegimenOf: a single charted dose counts as a current regimen',
    find: 'if (!Array.isArray(doses) || doses.length < 2) return null;', replace: 'if (!Array.isArray(doses) || doses.length < 1) return null;' },
  { id: 'I4-13', what: 'regimenDecision: daily-dose tie-break removed from the change sort',
    find: '    || Math.abs(a.tdd - cur.tdd) - Math.abs(b.tdd - cur.tdd)\n', replace: '' },
  { id: 'I4-14', what: 'kdigoStage: the 0.3 mg/dL rise read over 7 days, not 48 h',
    find: 'const b48 = before(KDIGO_ABS_WINDOW_H)', replace: 'const b48 = before(KDIGO_FOLD_WINDOW_H)' },
  { id: 'I4-15', what: 'checkAKI: thresholds 1.5x / 0.3 changed to 2.0x / 0.5',
    find: 'if (fold >= 1.5 || rise >= 0.3) {', replace: 'if (fold >= 2.0 || rise >= 0.5) {' },
  { id: 'I4-16', what: 'computeGuidelineDose: dose cap 2500 changed to 4000 (retargeted to the named PREFERENCE, Task 21)',
    find: 'const GUIDELINE_DOSE_CAP_MG = 2500;', replace: 'const GUIDELINE_DOSE_CAP_MG = 4000;' },
  // D28 Task 25: pdLoadingDose reads the one cap rule (doseCapOf), so the mutant follows it there, same meaning.
  { id: 'I4-17', what: 'pdLoadingDose: a local maximum above 3,000 raises the Rec 11 cap',
    find: 'const mg = Math.min(HD_LOADING_MAX_MG, localMaxMg > 0 ? localMaxMg : Infinity);',
    replace: 'const mg = localMaxMg > 0 ? localMaxMg : HD_LOADING_MAX_MG;' },
  { id: 'I4-18', what: 'INPUT_LIMITS: SCr minimum 0.1 changed to 0.01',
    find: 'scr:    { min: 0.1,  max: 25,', replace: 'scr:    { min: 0.01,  max: 25,' },

  // I4 — survived phase2d, caught only by engine parity (which a clinical change does not run clean).
  { id: 'I4P-1', what: 'calcAdjBW: factor 0.4 changed to 0.5',
    find: 'return ibw + 0.4 * (tbw - ibw);', replace: 'return ibw + 0.5 * (tbw - ibw);' },
  { id: 'I4P-2', what: 'calcIBW: 2.3 kg/in changed to 2.5',
    find: 'return base + 2.3 * (hIn - 60);', replace: 'return base + 2.5 * (hIn - 60);' },
  { id: 'I4P-3', what: 'AUC24_ABSOLUTE_MAX 700 changed to 800',
    find: 'const AUC24_ABSOLUTE_MAX = 700;', replace: 'const AUC24_ABSOLUTE_MAX = 800;' },
  { id: 'I4P-4', what: 'TROUGH_WARN_MGL 15 changed to 18',
    find: 'const TROUGH_WARN_MGL      = 15;', replace: 'const TROUGH_WARN_MGL      = 18;' },
  { id: 'I4P-5', what: 'rankRegimenCandidates: the non-danger tie filter removed',
    find: 'const nonDanger = tied.filter(r => !(Number.isFinite(r.Ctrough) && r.Ctrough >= TROUGH_HIGH_MGL));',
    replace: 'const nonDanger = tied.filter(r => true);' },
  { id: 'I4P-6a', what: 'computeGuidelineDose: interval threshold CrCl > 90 moved to > 100',
    find: '[[90, 8], [50, 12]', replace: '[[100, 8], [50, 12]' },   // retargeted to GUIDELINE_INTERVAL_BY_CRCL (Task 21)
  { id: 'I4P-6b', what: 'computeGuidelineDose: interval threshold CrCl > 50 moved to > 60',
    find: '[50, 12], [30, 24]', replace: '[60, 12], [30, 24]' },
  { id: 'I4P-6c', what: 'computeGuidelineDose: interval threshold CrCl > 30 moved to > 40',
    find: '[30, 24], [15, 36]', replace: '[40, 24], [15, 36]' },
  { id: 'I4P-6d', what: 'computeGuidelineDose: interval threshold CrCl > 15 moved to > 20',
    find: '[15, 36]];', replace: '[20, 36]];' },

  // I5 — profile and state handling.
  { id: 'I5-1', what: 'loadProfileIntoForm without resetBayesian() (the previous patient\'s rows remain)',
    find: '  resetForm();\n  resetBayesian();\n', replace: '  resetForm();\n' },
  { id: 'I5-2', what: 'deleteProfile filter inverted (deletes every other profile)',
    find: 'persistProfiles(profiles.filter(p => p.id !== id));', replace: 'persistProfiles(profiles.filter(p => p.id === id));' },
  { id: 'I5-3', what: 'snapshotBayesForm: a stale fit saved as fit',
    find: 'fit: fitStale ? null : fit,', replace: 'fit: fit,' },
  { id: 'I5-4', what: 'setCrclOverride: the CrCl override range check removed',
    find: 'crclOverride.value = chk.ok ? chk.value : NaN;', replace: 'crclOverride.value = parseFloat(raw);' },
  { id: 'I5-5', what: 'bayesInputFingerprint reduced to doses.length (a changed amount or time is not stale)',
    find: 'doses: doses.map(d => [d.mg, d.tinfH, +d.timeH.toFixed(4)]),', replace: 'doses: doses.length,' },

  // Task 19 (D27, models review I2): the early-level band must move the decision, and only for the fits it is for.
  { id: 'T19-1', what: 'earlyLevelFractions: the < cut comparison inverted (steady-state levels read as early)',
    find: '.filter(f => isFinite(f) && f < cut);', replace: '.filter(f => isFinite(f) && f >= cut);' },
  { id: 'T19-2', what: 'aucUncertaintyRow: the early flag ignored (every fit reads the steady-state row)',
    find: "const design = early && n > 0 ? 'early' : 'steady';", replace: "const design = 'steady';" },
  { id: 'T19-3', what: 'aucUncertaintyRow: early with no levels (the n > 0 guard removed)',
    find: "const design = early && n > 0 ? 'early' : 'steady';", replace: "const design = early ? 'early' : 'steady';" },
  { id: 'T19-4', what: 'latestLevelEarly: any early level, not the most recent (R47 aggregation undone)',
    find: 'return earlyLevelFractions(ls.filter(l => l.timeH === tLast), doses, t12, model).length > 0;',
    replace: 'return earlyLevelFractions(ls, doses, t12, model).length > 0;' },
  { id: 'T19-5', what: 'regimenDecision ignores its row (always the steady-state row of the same level count)',
    find: 'function regimenDecision(CLind, Vind, targetAUC, goti2comp, micMgL, doses, row, opts) {\n  const o = opts || {};',
    replace: 'function regimenDecision(CLind, Vind, targetAUC, goti2comp, micMgL, doses, row, opts) {\n  row = row && aucUncertaintyRow(row.n, row.key, false);\n  const o = opts || {};' },

  // Task 21c (the user's ruling U5): a Goti fitted-only reading is a caution, not a Hold; each mutant names the test that kills it.
  { id: 'U5-a', what: 'fittedOnlyCaution always false (Goti fitted-only holds again) [45.53, 45.54]',
    find: "return !!(r && r.model === 'goti' && !r.dial);", replace: 'return false;' },
  { id: 'U5-b', what: 'Goti-HD swept into U5 (the !r.dial guard dropped) [45.53]',
    find: "return !!(r && r.model === 'goti' && !r.dial);", replace: "return !!(r && r.model === 'goti');" },
  // U5-c and U5-d retargeted in Task 21d (one mapping, holdBasisOf, since the fix round): same intent, new text. U5-c retargeted
  // again in the R2 final-fix wave (holdBasisOf rewritten for R59): 'both' is no longer its own basis.
  { id: 'U5-c', what: "holdBasisOf: 'both' (a measured level with the fitted) no longer its own Hold basis [45.53, 45.59]",
    find: "  if (f && m) return { basis: 'both', caution: null };   // R59\n", replace: '' },
  { id: 'U5-d', what: 'noSolutionHold: the refusal ignores the carried measured level [45.53]',
    find: 'const b = holdBasisOf(fitted, carried, fittedOnlyCaution(r), firstIntervalLevel(', replace: 'const b = holdBasisOf(fitted, -Infinity, fittedOnlyCaution(r), firstIntervalLevel(' },
  { id: 'U5-e', what: 'Copy summary drops the caution [45.53, 45.54]',
    find: 'if (holdCaution) parts.push(holdCaution);', replace: '' },
  { id: 'U5-f', what: 'the refusal verdict reads holdHeadHTML again (the caution vanishes from the rendered refusal) [45.54]',
    find: '${answerHeadHTML(nsHold)}', replace: '${holdHeadHTML(nsHold)}' },
  { id: 'U5-g', what: 'the Next line and panel ignore the caution [45.53]',
    find: "  } else if (f.caution) {\n    kind = 'caution';", replace: "  } else if (false) {\n    kind = 'caution';" },

  // Task 21d (the user's ruling U6a; R55): a measured basis from a level drawn after the first dose, before the second, is a caution.
  { id: 'U6-a', what: 'firstIntervalLevel always false (first-interval levels hold again) [45.55]',
    find: 'if (!mh || dial) return false;\n  const byTime', replace: 'return false;\n  const byTime' },
  { id: 'U6-b', what: 'Goti-HD swept into U6a (the r.dial guard dropped) [45.55]',
    find: 'if (!mh || dial) return false;\n  const byTime', replace: 'if (!mh) return false;\n  const byTime' },
  { id: 'U6-c', what: 'a second dose already given ignored (a level after it read as first-interval) [45.55]',
    find: 'const secondH = given.length >= 2 ? given[1].timeH : planned.length', replace: 'const secondH = planned.length' },
  { id: 'U6-d', what: "the second dose's time ignored (a level after it, or with none known, still a caution) [45.55]",
    find: 'return Number.isFinite(secondH) && mh.timeH < secondH - 1e-9;', replace: 'return true;' },
  // U6-e and U6-f retargeted in the R2 final-fix wave (holdBasisOf rewritten for ruling R59; same intent for U6-e). U6-f now
  // undoes R59's Goti half (R59 replaced R55's): Goti with the fitted and a first-interval level both at 20 reads a caution again.
  { id: 'U6-e', what: 'holdBasisOf: a first-interval level is a Hold basis again [45.55]',
    find: "if (m) return firstLevel ? { basis: null, caution: 'first-level' } : { basis: 'measured', caution: null };", replace: "if (m) return { basis: 'measured', caution: null };" },
  { id: 'U6-f', what: "R59's Goti half undone: Goti with the fitted plus a first-interval level both at 20 reads a caution again [45.55, 45.59]",
    find: "  if (f && m) return { basis: 'both', caution: null };   // R59", replace: "  if (f && m && !(gotiFitted && firstLevel)) return { basis: 'both', caution: null };" },
  { id: 'U6-g', what: "firstDosePlan: no second-dose time from the answered interval (U6a never applies without a planned row) [45.55]",
    find: 'plannedDoses, answeredTau, r.dial);', replace: 'plannedDoses, NaN, r.dial);' },
  { id: 'U6-h', what: 'the second dose judged on the plan\'s own (projected) interval, not the answered one [45.56]',
    find: 'const answeredTau = r.rec ? (r.rec.noSolution ? NaN : r.rec.tau) : rec.tau;', replace: 'const answeredTau = rec.tau;' },
  // U6-i (R57's fitted-basis clause) is gone with its code: under R59 a fitted-basis Hold never has a carried level at 20 when
  // held, so the clause could not arise; 45.57 now pins the same case as a Hold on both bases that names the level.

  // The R2 final-fix wave: ruling R59, the user's ruling U7, the caution's words by kind (I1), a refusal's caution holds its rows.
  { id: 'R59-a', what: 'R59 undone on every model: the fitted plus a first-interval level both at 20 read as a caution [45.55, 45.59]',
    find: "  if (f && m) return { basis: 'both', caution: null };   // R59", replace: "  if (f && m && !firstLevel) return { basis: 'both', caution: null };" },
  { id: 'U7-a', what: 'U7 undone: the FIRST_INTERVAL_CAUTION_H bound dropped (a late first-interval level is a caution again) [45.60]',
    find: '  if (mh.timeH - given[0].timeH > FIRST_INTERVAL_CAUTION_H + 1e-9) return false;   // U7\n', replace: '' },
  { id: 'I1-a', what: "the Next line and panel word every caution as U5's (the caution's kind ignored) [45.55, 45.61]",
    find: 'const w = holdCautionWords(f.caution, f.cautionRefusal);', replace: "const w = holdCautionWords('fitted', f.cautionRefusal);" },
  { id: 'M-a', what: "a refusal's caution draws its planned rows as given again [45.62]",
    find: 'plan.noSolution ? plan.hold || plan.holdCaution :', replace: 'plan.noSolution ? plan.hold :' },

  // "Tests that cannot fail on what they name" (code report): the mutations that showed it.
  { id: 'CF-1', what: 'fingerprint target and MIC made inert, names left in a comment',
    find: "target: g('b-auc-target'), mic: g('b-mic'),", replace: "target: '', mic: '', // g('b-auc-target') g('b-mic')" },
  { id: 'CF-2', what: 'an unquoted inline handler (onclick=x()) in the body',
    find: '<div id="b-results" style=', replace: '<div id="b-results" onclick=resetForm() style=' },

  // Release 3 (v3.16.0, D28), Task 23: one renal-replacement selector.
  { id: 'R3-23-1', what: 'bState.dial derived from peritoneal dialysis instead of haemodialysis [46.9]',
    find: "bState.dial = (kind === 'ihd');", replace: "bState.dial = (kind === 'pd');" },
  // Task 24 split the CRRT and hybrid refusals (ruling R75: hybrid reads its session rows); the course parse
  // still comes after both, so this mutant now runs the course parse ahead of them.
  { id: 'R3-23-2', what: 'the CRRT and hybrid refusal moved after parseBayesCourse [46.3]',
    find: "  if (rrt === 'crrt') { showBayesRrtRefusal(rrtNoticeHTML(rrt, 'auc')); return; }\n",
    replace: "  parseBayesCourse();\n  if (rrt === 'crrt') { showBayesRrtRefusal(rrtNoticeHTML(rrt, 'auc')); return; }\n" },
  { id: 'R3-23-3', what: "rrtOf drops the legacy demographics.dial branch [46.2]",
    find: "if ((core && core.hd) || (demographics && demographics.dial)) return 'ihd';", replace: "if (core && core.hd) return 'ihd';" },
  // Task 23 review fixes: Important 1 (Review Focus 1) and the controller's ruling R74.
  { id: 'R3-23-4', what: 'an AUC renal-replacement refusal survives a selector change [46.13]',
    find: '  if (kind !== prev) clearBayesRrtRefusal();\n', replace: '' },
  { id: 'R3-23-5', what: 'an AUC renal-replacement refusal survives a tile change [46.13]',
    find: '  if (m !== bayesTile()) clearBayesRrtRefusal();', replace: '' },
  { id: 'R3-23-6', what: 'R74 undone: a legacy profile with both a PD form and an HD flag loads (as PD) [46.14]',
    find: '  if (rrtLegacyConflict(s)) {\n', replace: '  if (false) {\n' },
  // Release 3 Task 24: typed session rows, hybrid sessions to 24 h, the sessions-per-week caution (D28).
  { id: 'R3-24-1', what: 'the sessions-per-week caution fires above four, not three [46.19, 46.20]',
    find: 'const HD_SESSIONS_PER_WEEK_CAUTION = 3;', replace: 'const HD_SESSIONS_PER_WEEK_CAUTION = 4;' },
  { id: 'R3-24-2', what: "the row-type check removed from the session parse parseBayesCourse calls [46.17]",
    find: '    if (type !== want || want !== rrt) {\n', replace: '    if (false) {\n' },   // R104 added the None clause
  { id: 'R3-24-3', what: 'hybrid sessions limited to 12 h [46.15, 46.16]',
    find: "hybridHours: { min: 0.5, max: 24,", replace: "hybridHours: { min: 0.5, max: 12," },
  { id: 'R3-24-4', what: 'sessionsPerWeekMax counts an eight-day window [46.19]',
    find: '    while (days[i] - days[j] >= 7) j++;', replace: '    while (days[i] - days[j] >= 8) j++;' },
  { id: 'R3-24-5', what: 'syncHdSection reads the dialysis flag again, showing sessions on plain Goti under haemodialysis [46.23]',
    find: "(rrt === 'ihd' && bayesTile() === 'gotihd') || rrt === 'hybrid' || hasRows", replace: "(bState && bState.model === 'goti' && bState.dial) || rrt === 'hybrid' || hasRows" },
  { id: 'R3-24-6', what: 'the hybrid refusal reads no session rows [46.24]',
    find: '    const hs = parseBayesSessions(rrt);\n', replace: '    const hs = { sessions: [] };\n' },
  { id: 'R3-24-7', what: 'a saved row without a type loads as the renal replacement in force, not haemodialysis [46.22]',
    find: "x.type == null ? 'ihd' : x.type", replace: "x.type == null ? hdSessionDefaultType() : x.type" },
  // Release 3 Task 25: the CRRT and hybrid guideline references and the local maximum (D28).
  { id: 'R3-25-1', what: 'CRRT maintenance from 10 mg/kg, not 7.5 (Rybak 2020 Rec 16) [46.25, 46.26]',
    find: 'const CRRT_MAINT_MG_PER_KG_MIN = 7.5;', replace: 'const CRRT_MAINT_MG_PER_KG_MIN = 10;' },
  { id: 'R3-25-2', what: 'the cap takes the larger of Rec 11 and the local maximum [46.28, 46.29]',
    find: 'const mg = Math.min(HD_LOADING_MAX_MG, localMaxMg > 0 ? localMaxMg : Infinity);', replace: 'const mg = Math.max(HD_LOADING_MAX_MG, localMaxMg > 0 ? localMaxMg : Infinity);' },
  { id: 'R3-25-3', what: 'the effluent check reversed (inside read as outside) [46.30]',
    find: 'const inside = perKg >= CRRT_EFFLUENT_MIN_ML_KG_H && perKg <= CRRT_EFFLUENT_MAX_ML_KG_H;', replace: 'const inside = !(perKg >= CRRT_EFFLUENT_MIN_ML_KG_H && perKg <= CRRT_EFFLUENT_MAX_ML_KG_H);' },
  { id: 'R3-25-4', what: 'the hybrid "no pre-session target" sentence removed [46.32]',
    find: '      <p class="rrt-ref-line">No pre-session target has been validated for hybrid therapy.</p>\n', replace: '' },
  { id: 'R3-25-5', what: 'the weight limits dropped: a 0 kg weight gives a table (Review Focus 5) [46.31]',
    find: '  if (!Number.isFinite(kg) || kg < INPUT_LIMITS.weight.min || kg > INPUT_LIMITS.weight.max) return null;', replace: '  if (!Number.isFinite(kg)) return null;' },
  { id: 'R3-25-6', what: 'the cap always named as the guideline\'s, never "your setting" (U10) [46.29]',
    find: "return { mg, by: mg < HD_LOADING_MAX_MG ? 'local' : 'guideline' };", replace: "return { mg, by: 'guideline' };" },
  { id: 'R3-25-7', what: 'the CRRT/hybrid Clear leaves vanco.rrt.local in storage [46.34]',
    find: '  try { localStorage.removeItem(RRT_LOCAL_KEY); }', replace: '  try { /* kept */ }' },
  { id: 'R3-25-8', what: 'the PD Clear leaves vanco.pd.local in storage [46.35]',
    find: "  try { localStorage.removeItem('vanco.pd.local'); }", replace: '  try { /* kept */ }' },
  { id: 'R3-25-9', what: 'a blank local maximum silently drops the stored one (R23 undone) [46.34]',
    // retargeted, Task 29 (R84: one reader, readLocalMaxDose / localMaxDoseSaid): the branch that keeps and says so, gone
    find: '  else { said = localMaxDoseSaid(x, r.why, stored); if (stored != null) mg = stored; }', replace: '  else { }' },
  { id: 'R3-25-10', what: 'the session section keeps its haemodialysis copy under hybrid (Task 24 review, must fix) [46.37]',
    find: 'function hdSessionCopy() { return HD_SESSION_COPY[hdSessionDefaultType()]; }', replace: 'function hdSessionCopy() { return HD_SESSION_COPY.ihd; }' },
  { id: 'R3-25-11', what: 'the Trough hybrid mode shows the creatinine and loading-dose blocks again (R73) [46.38]',
    find: '  .panel-left[data-mode="hybrid"] .not-pd { display: none; }\n', replace: '' },
  { id: 'R3-25-12', what: "the AUC reference reads the Trough column's weight [46.36]",
    find: "(document.getElementById(auc ? 'b-tbw' : 'tbw') || {}).value", replace: "(document.getElementById('tbw') || {}).value" },
  // Task 26: one level-interval solver, one goal pick, one peak equation, shared (D28).
  { id: 'R3-26-1', what: 'the goal pick breaks an exact tie to the larger step (the tie rule\'s - 1e-9 sign flipped) [46.41]',
    find: 'dist(r) < dist(b) - 1e-9', replace: 'dist(r) < dist(b) + 1e-9' },
  { id: 'R3-26-2', what: 'the interval solver\'s bisection bounds swapped [46.39, 46.40, 46.44]',
    find: 'let [lo, hi] = PD_K_SEARCH;', replace: 'let [hi, lo] = PD_K_SEARCH;' },
  { id: 'R3-26-3', what: 'the peak equation ignores its cap [46.42, 46.44]',
    find: 'return raw <= 0 ? 0 : Math.min(capMg,', replace: 'return raw <= 0 ? 0 : Math.max(capMg,' },
  // Task 27: a level-based CRRT answer (D28).
  { id: 'R3-27-1', what: 'the circuit-running check removed from the CRRT projection rule (Review Focus 3) [46.51, 46.53]',
    find: 'if (!crrtRunCovering(circuit, coverFrom, draw)) {', replace: 'if (false) {' },
  { id: 'R3-27-2', what: 'an effluent-changed interval is flagged but still used for the rate [46.50]',
    find: 'const excluded = flags.length > 0;', replace: "const excluded = flags.some(f => f !== 'effluent-changed');" },
  { id: 'R3-27-3', what: 'CRRT_NEXT_DRAW_DEFAULT_H 24 → 12 (the default draw time, a PREFERENCE) [46.47]',
    find: 'const CRRT_NEXT_DRAW_DEFAULT_H = 24;', replace: 'const CRRT_NEXT_DRAW_DEFAULT_H = 12;' },
  { id: 'R3-27-4', what: 'POST_DISTRIBUTION_MIN_H 1 → 0.5 h (Rybak 2020 Rec 2a, R105) [46.54]',
    find: 'const POST_DISTRIBUTION_MIN_H = 1;', replace: 'const POST_DISTRIBUTION_MIN_H = 0.5;' },
  { id: 'R3-27-5', what: 'a setting change since the last used interval does not end the CRRT projection [46.52]',
    find: ': crrtSettingChange(inp.effluent, inp.modality, ref, used[used.length - 1].toH - 1e-9, draw);', replace: ': null;' },
  { id: 'R3-27-6', what: 'a modality change inside an interval is not flagged [46.50]',
    find: "if (rows.some(s => s.modality !== set.modality)) flags.push('modality-changed');", replace: '' },
  { id: 'R3-27-7', what: 'the goal control writes every mode into the PD fields (P2: a goal held per mode) [46.59]',
    find: 'document.getElementById(`${mode}-goal-min`)', replace: "document.getElementById('pd-goal-min')" },
  // Task 27 review fixes (controller rulings R93, R91 revised, R94; review I4).
  { id: 'R3-27-8', what: 'overlapping or open-ended circuit runs are not refused (R93) [46.61]',
    find: 'if (prev.offH == null || cur.onH < prev.offH)', replace: 'if (false)' },
  { id: 'R3-27-9', what: 'the circuit must cover only from the starting level, not from the end of the last used interval (R91 revised) [46.62]',
    find: 'coverFrom = used[used.length - 1].toH;', replace: 'coverFrom = startLevel.timeH;' },
  { id: 'R3-27-10', what: 'a level dated after now is projected, not refused (R94) [46.63]',
    find: 'levels.filter(l => levelAfterNow(l.timeH, nowH))', replace: 'levels.filter(l => false)' },   // retargeted, Task 29 (R95a: one helper)
  { id: 'R3-27-11', what: 'used intervals at different settings are fitted together (the mixed guard forced false) [46.64]',
    find: 'const mixed = used.some(i => i.setting.mlPerH !== ref.mlPerH || i.setting.modality !== ref.modality);', replace: 'const mixed = false;' },
  // Task 28: a peak-equation haemodialysis reading from browser-only settings (D28; U11, R67, R96).
  { id: 'R3-28-1', what: 'the hold at the hold level becomes strictly above it (≥ → >) [46.68]',
    find: 'if (inp.pre >= s.holdPreMgL) return', replace: 'if (inp.pre > s.holdPreMgL) return' },
  { id: 'R3-28-2', what: 'the 2 h exclusion after the previous session removed (R67) [46.70]',
    find: 'if (inp.preAtH - prev < RRT_NO_SAMPLE_AFTER_SESSION_H)', replace: 'if (inp.preAtH < prev)' },
  { id: 'R3-28-3', what: 'the fraction applied as removed instead of remaining [46.66, 46.67]',
    find: 'const post = inp.pre * s.fractionRemaining,', replace: 'const post = inp.pre * (1 - s.fractionRemaining),' },
  { id: 'R3-28-4', what: 'a level drawn exactly at the session start is read (≥ → >) [46.70]',
    find: 'if (inp.preAtH >= inp.sessionStartH)', replace: 'if (inp.preAtH > inp.sessionStartH)' },
  { id: 'R3-28-5', what: 'a pre-dialysis level dated after now is read, not refused (R96) [46.75]',
    find: 'if (Number.isFinite(inp.nowH) && levelAfterNow(inp.preAtH, inp.nowH))', replace: 'if (false)' },
  { id: 'R3-28-6', what: 'a fraction of 1 or more is accepted as a setting [46.72]',
    find: "return key === 'fractionRemaining' ? v < 1 : true;", replace: 'return true;' },
  { id: 'R3-28-7', what: 'the local maximum is not applied to the reading (the cap is the lower of the two) [46.69]',
    find: 'const capMg = Math.min(DOSE_MAX_PER_DOSE_MG, localMax || Infinity);', replace: 'const capMg = DOSE_MAX_PER_DOSE_MG;' },
  { id: 'R3-28-8', what: 'the Goti-HD pointer is dropped from the reading screen [46.74]',
    find: 'if (rc) rc.innerHTML = troughHdNoticeHTML() + hdReadingHTML(reading);', replace: 'if (rc) rc.innerHTML = hdReadingHTML(reading);' },
  // Task 28 review I1: no dose is worded by its cause.
  { id: 'R3-28-9', what: 'the two no-dose sentences swapped (at or above the peak / rounds to no dose) [46.78, 46.79]',
    find: "${r.post >= st.targetPeak ? 'The post-session estimate is at or above your target peak.'", replace: "${r.post < st.targetPeak ? 'The post-session estimate is at or above your target peak.'" },
  // Task 29: citations, notes and the carried rulings R80, R84, R95 (D28).
  { id: 'R3-29-1', what: 'the local maximum accepts any positive number again: a g-for-mg "2" caps every cell at 2 mg (R84) [46.86, 46.87]',
    find: '  if (Number.isFinite(v) && v >= lo && v <= L.max) return { mg: v, why: \'\' };', replace: '  if (Number.isFinite(v) && v > 0) return { mg: v, why: \'\' };' },
  { id: 'R3-29-2', what: 'an out-of-range local maximum with nothing stored is refused silently (R84: the status line says so) [46.86, 46.87]',
    find: "  return x === '' ? '' : `Maximum single dose ${why}, so it is not saved.`;", replace: "  return '';" },
  { id: 'R3-29-3', what: 'a CRRT circuit run whose stop is at or before its start is not refused (R95b) [46.89]',
    find: 'const backwards = circuit.findIndex(r => r.offH != null && !(r.offH > r.onH));', replace: 'const backwards = -1;' },
  { id: 'R3-29-4', what: 'the future-level tolerance dropped to 0: a level typed to the minute is refused (R95a, D26) [44.10, 46.63, 46.75, 46.88]',
    find: 'const FUTURE_LEVEL_TOLERANCE_H = 0.016666666666666666;', replace: 'const FUTURE_LEVEL_TOLERANCE_H = 0;' },
  { id: 'R3-29-5', what: 'the future-level tolerance widened to an hour: a pre-dialysis level 30 min ahead is read (R95a, D26) [46.75, 46.88]',
    find: 'const FUTURE_LEVEL_TOLERANCE_H = 0.016666666666666666;', replace: 'const FUTURE_LEVEL_TOLERANCE_H = 1;' },
  { id: 'R3-29-6', what: 'AUC Precision fits a level dated after now (its copy no longer reads levelAfterNow) [44.10, 46.88]',
    find: 'const futureLevels = levels.filter(l => levelAfterNow(l.timeH, fitNowH));', replace: 'const futureLevels = levels.filter(l => false);' },
  { id: 'R3-29-7', what: 'the sessions-per-week caution grades Rec 14 C-III again for the sentence it cites (R80) [46.84]',
    find: "Rec 14's sentence cited\n// here, that pre-dialysis monitoring should drive subsequent dosing, is B-II (Rec 14's C-III is the 15–20 mg/L target).", replace: 'Rec 14 is C-III.' },
  { id: 'R3-29-9', what: 'the local maximum floor is INPUT_LIMITS.dose.min again, not one dispensing step: 150 mg is stored (R101) [46.90]',
    find: 'lo = Math.max(L.min, MATRIX_DOSE_STEP)', replace: 'lo = L.min' },
  { id: 'R3-29-8', what: 'the severe-renal note says CRRT is not modelled again, without the selector line [46.82, 41.15]',
    find: '<li>On renal replacement, set Renal replacement to the modality: this note is for a patient off dialysis.</li>', replace: '<li>If the patient is on intermittent haemodialysis, use <strong>Goti 2018 · HD</strong>. CRRT is not modelled here.</li>' },
  // The final review's fix wave (D28, controller rulings R103, R104, R106, R107).
  { id: 'R3-F-1', what: 'a CRRT interval under PD_MIN_INTERVAL_H is flagged too-short but still used for the rate (Task 27\'s "flag only", R103) [46.54, 46.92]',
    find: "if (l.timeH - a.timeH < PD_MIN_INTERVAL_H) flags.push('too-short');\n    const excluded = flags.length > 0;",
    replace: "const excluded = flags.length > 0;\n    if (l.timeH - a.timeH < PD_MIN_INTERVAL_H) flags.push('too-short');" },
  { id: 'R3-F-2', what: 'two CRRT levels at the same minute are not refused (R103) [46.92]',
    find: "if (levels[i].timeH - levels[i - 1].timeH < 1 / 60)\n      return refuse('Two levels at the same time'",
    replace: "if (false)\n      return refuse('Two levels at the same time'" },
  { id: 'R3-F-3', what: 'a haemodialysis-typed session row under Renal replacement None is read as before (R104) [46.93]',
    find: 'if (type !== want || want !== rrt) {', replace: 'if (type !== want) {' },
  { id: 'R3-F-4', what: 'the Trough placeholder keeps the None text (CrCl, an AUC₂₄ regimen) in every mode (R106) [46.95]',
    find: '  syncResultsPlaceholder(mode);\n', replace: "  syncResultsPlaceholder('initial');\n" },
  { id: 'R3-F-5', what: 'the CRRT "Draw a level" sentence loses the words for unexplained-high [46.96]',
    find: "  'unexplained-high': 'higher than the doses could make at the volume used", replace: "  'unexplained-hi': 'higher than the doses could make at the volume used" },
  { id: 'R3-F-6', what: 'the CRRT one-level "Draw a level" state drops the Rec 16 reference (R107) [46.97]',
    find: "const oneLevel = a.state === 'need-level' && a.reason === 'no-interval' && !(a.intervals || []).length;", replace: 'const oneLevel = false;' },
  { id: 'R3-F-7', what: 'the CRRT "Draw a level" sentence drops the too-short reason again (R103) [46.54]',
    find: 'const why = intervals.length ? [...new Set(intervals.flatMap(i => i.flags))]', replace: "const why = intervals.length ? [...new Set(intervals.flatMap(i => i.flags).filter(f => f !== 'too-short'))]" },

  // ── v3.16.1: missing-input and data-check refusal headings are ink, never the alarm hue ──
  { id: 'R3-P-1', what: 'the PD refusal heading takes the alarm hue again [46.99]',
    find: '<section class="tx-verdict pd-verdict" aria-labelledby="tx-regimen">\n      <h3 class="vx-regimen vx-regimen-refuse"',
    replace: '<section class="tx-verdict pd-verdict" aria-labelledby="tx-regimen">\n      <h3 class="vx-regimen vx-regimen-hold"' },
  { id: 'R3-P-2', what: 'the CRRT refusal heading takes the alarm hue again [46.99]',
    find: '<section class="tx-verdict crrt-verdict" aria-labelledby="tx-regimen">\n      <h3 class="vx-regimen vx-regimen-refuse"',
    replace: '<section class="tx-verdict crrt-verdict" aria-labelledby="tx-regimen">\n      <h3 class="vx-regimen vx-regimen-hold"' },
  { id: 'R3-P-3', what: 'the HD reading refusal heading takes the alarm hue again [46.99]',
    find: '<p class="vx-regimen vx-regimen-refuse">', replace: '<p class="vx-regimen vx-regimen-hold">' },
  { id: 'R3-P-4', what: 'the refusal heading class is coloured with the alarm hue [46.99]',
    find: '.vx-regimen-refuse { font-size: var(--fs-xl); color: var(--ink); }', replace: '.vx-regimen-refuse { font-size: var(--fs-xl); color: var(--alarm); }' },
  { id: 'R3-P-5', what: 'the Trough "No regimen recommended" refusal loses the alarm hue [46.99]',
    find: '<h3 class="vx-regimen vx-regimen-hold" id="tx-regimen">${escHtml(o.word)}</h3>', replace: '<h3 class="vx-regimen vx-regimen-refuse" id="tx-regimen">${escHtml(o.word)}</h3>' },

  // ── v3.17.0: Hughes 2024 as a comparator from BMI 39, never counted ──
  { id: 'R4-H-1', what: 'no Hughes comparator below BMI 40 [47.2, 47.3]',
    find: 'const hughesComparator = !hughesApplies && isFinite(bmi) && bmi >= HUGHES_COMPARATOR_MIN_BMI;', replace: 'const hughesComparator = false;' },
  { id: 'R4-H-2', what: 'the comparator is counted in the spread, range and n [47.2]',
    find: 'const peers = rows.filter(r => !r.comparator);', replace: 'const peers = rows;' },
  { id: 'R4-H-3', what: 'the comparator floor moves to 38 [47.1, 47.3]',
    find: 'const HUGHES_COMPARATOR_MIN_BMI = 39;', replace: 'const HUGHES_COMPARATOR_MIN_BMI = 38;' },
  { id: 'R4-H-4', what: 'the BMI 39-40 advice no longer says Hughes is shown as a comparator [47.5]',
    find: 'it is shown in Models as a comparator, not counted in the spread. `', replace: 'it is shown in Models. `' },
  { id: 'R4-H-5', what: 'the confidence sentence names the comparator\'s AUC [47.7]',
    find: 'const each = (ag.rows || []).filter(m => !m.comparator).map(', replace: 'const each = (ag.rows || []).map(' },

  // ── v3.17.0: the way back from a locked creatinine tab (the user's report) ──
  { id: 'R4-P-1', what: 'a press on a locked tab no longer offers the way back [47.8]',
    find: "currentRrt() !== 'none') { syncRrtModeButtons(mode); return false; }", replace: "currentRrt() !== 'none') { syncRrtModeButtons(); return false; }" },
  { id: 'R4-P-2', what: 'the action opens the tab without setting renal replacement to None [47.8]',
    find: "if (CREATININE_MODES.indexOf(arg) < 0) return; setRrt('none'); setCalcMode(arg);", replace: "if (CREATININE_MODES.indexOf(arg) < 0) return; setCalcMode(arg);" },
  { id: 'R4-P-3', what: 'the action is offered for a non-creatinine tab too [47.8]',
    find: 'if (CREATININE_MODES.indexOf(tried) < 0) return line;', replace: 'if (!tried) return line;' },

  // ── v3.18.0: the models before a level, display only ──
  { id: 'R5-1', what: 'confidence reads the before-a-level comparison [48.3]',
    find: 'const agAll  = nLev ? agRun : null;', replace: 'const agAll  = agRun;' },
  { id: 'R5-2', what: 'the daily dose is sized for the bottom of the target, not its middle [48.2]',
    find: 'const mid = (bandMin + bandMax) / 2, perDay', replace: 'const mid = bandMin, perDay' },
  { id: 'R5-3', what: 'the before-a-level dose range counts the comparator [48.2]',
    find: 'const counted = ag.rows.filter(m => !m.comparator);\n  const doses = counted', replace: 'const counted = ag.rows;\n  const doses = counted' },
  { id: 'R5-4', what: 'Crass 2018 credits the sex term to women [48.6]',
    find: "+ (sex === 'M' ? CRASS_THETA_SEX : 0)", replace: "+ (sex === 'F' ? CRASS_THETA_SEX : 0)" },
  { id: 'R5-5', what: 'Crass 2018 is shown after a level too [48.7]',
    find: 'if (!(levels && levels.length) && !ctx.dial && isFinite(bmi) && bmi >= CRASS_MIN_BMI', replace: 'if (!ctx.dial && isFinite(bmi) && bmi >= CRASS_MIN_BMI' },
  { id: 'R5-6', what: 'Crass 2018 is shown below CrCl 30, outside its population [48.8]',
    find: '>= CRASS_MIN_CRCL_ADJ) {', replace: '>= 0) {' },
  { id: 'R5-7', what: 'the Crass row is drawn with a simulated band it does not have [48.7]',
    find: 'crassOutsideNote(ctx, bmi), false, true);', replace: 'crassOutsideNote(ctx, bmi), false, false);' },
  { id: 'R5-8', what: 'the 0.5 L/h floor is ignored [48.8]',
    find: 'if (cl >= CRASS_MIN_CL_LH) push(', replace: 'if (cl > 0) push(' },
  { id: 'R5-9', what: 'the forest label column is fixed at 150 again and cuts long labels [48.10]',
    find: 'const L = Math.max(150, Math.ceil(6.6 * Math.max(...rows.map(r => labelOf(r.m).length))) + 10), R = 16', replace: 'const L = 150, R = 16' },
  { id: 'R5-10', what: 'the Crass note gives the old, wrong reason (no between-subject variance) [48.7]',
    find: 'neither the paper nor its supplement publishes the residual-error model a fit to a level needs', replace: 'its published model is nonparametric and gives no between-subject variance to fit a level with' },
];

const SUITES = ['phase2d_validation.cjs', 'phase3_simulation.cjs', 'phase4_regimen_validation.cjs'];
const DEFAULT_SUITE_TIMEOUT_MS = 300000;

// ─── Runner ────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const o = { only: null, list: false, jobs: 4, timeoutMs: DEFAULT_SUITE_TIMEOUT_MS };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--list') o.list = true;
    else if (a === '--only') o.only = String(argv[++i] || '').split(',').map(s => s.trim()).filter(Boolean);
    else if (a === '--jobs') o.jobs = Math.max(1, parseInt(argv[++i], 10) || 1);
    else if (a === '--timeout-ms') {
      o.timeoutMs = parseInt(argv[++i], 10);
      if (!(o.timeoutMs > 0)) { console.error('mutation: --timeout-ms needs a positive number of milliseconds'); process.exit(2); }
    }
    else { console.error(`mutation: unknown argument ${a}`); process.exit(2); }
  }
  return o;
}

function runSuite(suite, mutant, timeoutMs) {
  return new Promise((resolve) => {
    const env = Object.assign({}, process.env, { [ENV_KEY]: JSON.stringify({ id: mutant.id, file: APP, find: mutant.find, replace: mutant.replace }) });
    const child = cp.spawn(process.execPath, ['--require', __filename, path.join(ROOT, suite)], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { out += d; });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      // The first failing test line, for the record (phase2d "✗  name", phase3/4 their own markers).
      const failLine = (out.split('\n').find(l => /^\s*(✗|FAIL\b|❌)/.test(l)) || '').trim().slice(0, 140);
      resolve({ suite, code, timedOut, failLine, out });
    });
  });
}

// A failing suite kills the mutant. A suite that ran out of time proves nothing (it may have
// hung on the mutation, or the machine may be slow), so the mutant is TIMEOUT and the run fails.
async function runMutant(m, timeoutMs) {
  for (const s of SUITES) {
    const r = await runSuite(s, m, timeoutMs);
    if (r.timedOut) return { outcome: 'TIMEOUT', by: s, how: `no result within ${timeoutMs} ms` };
    if (r.code !== 0) return { outcome: 'killed', by: s, how: r.failLine || `exit ${r.code}` };
  }
  return { outcome: 'SURVIVED' };
}

async function pool(items, jobs, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => { while (next < items.length) { const i = next++; results[i] = await fn(items[i], i); } };
  await Promise.all(Array.from({ length: Math.min(jobs, items.length) }, worker));
  return results;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const ids = new Set();
  for (const m of MUTANTS) { if (ids.has(m.id)) { console.error(`mutation: duplicate id ${m.id}`); process.exit(2); } ids.add(m.id); }
  let list = MUTANTS;
  if (o.only) {
    if (!o.only.length) { console.error('mutation: --only selected no mutants. Name at least one id (see --list).'); process.exit(2); }
    const unknown = o.only.filter(id => !ids.has(id));
    if (unknown.length) { console.error(`mutation: unknown mutant id(s): ${unknown.join(', ')}`); process.exit(2); }
    list = MUTANTS.filter(m => o.only.includes(m.id));
  }
  if (!list.length) { console.error('mutation: no mutants selected; an empty run proves nothing.'); return 2; }
  if (o.list) { list.forEach(m => console.log(`${m.id.padEnd(7)} ${m.what}`)); return 0; }

  // Every find string must occur exactly once, and change something, before anything runs.
  const text = fs.readFileSync(APP, 'utf8');
  const bad = [];
  for (const m of list) {
    const n = text.split(m.find).length - 1;
    if (!m.find) bad.push(`${m.id}: empty find string`);
    else if (n !== 1) bad.push(`${m.id}: find string occurs ${n} times in index.html (must be exactly 1): ${JSON.stringify(m.find.slice(0, 100))}`);
    else if (m.find === m.replace) bad.push(`${m.id}: replacement is identical to the find string`);
  }
  if (bad.length) {
    console.error('mutation: the mutant list no longer matches index.html. Update the mutants; never drop one silently.');
    bad.forEach(b => console.error('  ' + b));
    return 2;
  }

  // Baseline: the unmutated file through the same preload must pass every suite.
  const base = await pool(SUITES, SUITES.length, (s) => runSuite(s, { id: 'baseline', find: '', replace: '' }, Math.max(o.timeoutMs, DEFAULT_SUITE_TIMEOUT_MS)));
  const baseFail = base.filter(r => r.timedOut || r.code !== 0);
  if (baseFail.length) {
    console.error('mutation: the unmutated baseline fails, so no mutant result would mean anything:');
    baseFail.forEach(r => console.error(`  ${r.suite}: ${r.timedOut ? 'timeout' : 'exit ' + r.code} ${r.failLine}`));
    return 2;
  }
  console.log(`baseline: ${SUITES.join(', ')} pass unmutated. ${list.length} mutants, ${o.jobs} at a time.`);

  const t0 = Date.now();
  const res = await pool(list, o.jobs, (m) => runMutant(m, o.timeoutMs));
  const n = { killed: 0, SURVIVED: 0, TIMEOUT: 0 };
  list.forEach((m, i) => {
    const r = res[i];
    n[r.outcome]++;
    if (r.outcome === 'killed') console.log(`killed    ${m.id.padEnd(7)} ${m.what}  [${r.by}: ${r.how}]`);
    else if (r.outcome === 'TIMEOUT') console.log(`TIMEOUT   ${m.id.padEnd(7)} ${m.what}  [${r.by}: ${r.how}; not proven killed]`);
    else console.log(`SURVIVED  ${m.id.padEnd(7)} ${m.what}`);
  });
  console.log(`\n${n.killed} of ${list.length} killed, ${n.SURVIVED} survived, ${n.TIMEOUT} timed out (${((Date.now() - t0) / 1000).toFixed(0)} s).`);
  return (n.killed === list.length) ? 0 : 1;
}

main().then(code => process.exit(code), (e) => { console.error(e && e.stack || e); process.exit(2); });

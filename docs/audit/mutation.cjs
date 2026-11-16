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
  { id: 'I4-17', what: 'pdLoadingDose: a local maximum above 3,000 raises the Rec 11 cap',
    find: 'const cap = Math.min(HD_LOADING_MAX_MG, localMaxMg > 0 ? localMaxMg : Infinity);',
    replace: 'const cap = localMaxMg > 0 ? localMaxMg : HD_LOADING_MAX_MG;' },
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

  // "Tests that cannot fail on what they name" (code report): the mutations that showed it.
  { id: 'CF-1', what: 'fingerprint target and MIC made inert, names left in a comment',
    find: "target: g('b-auc-target'), mic: g('b-mic'),", replace: "target: '', mic: '', // g('b-auc-target') g('b-mic')" },
  { id: 'CF-2', what: 'an unquoted inline handler (onclick=x()) in the body',
    find: '<div id="b-results" style=', replace: '<div id="b-results" onclick=resetForm() style=' },
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

'use strict';
// ════════════════════════════════════════════════════════════════════════════
//  verify_findings.cjs — mechanically check a returned review package
//
//  Usage:  node codex-review/verify_findings.cjs findings.json [--json]
//
//  A review is only useful if its claims can be re-run. This does three things
//  to every finding, and refuses to take any of them on trust:
//
//    1. SHAPE     — required fields, enums, and the dimension-specific rules
//                   (a math or clinical claim must carry a citation).
//    2. EXECUTION — the reproduction script is run against the SHIPPED engine
//                   extracted from index.html, in a locked-down vm with no
//                   require/network/fs, under a hard timeout. Its printed
//                   output is compared to the finding's own `expect`.
//    3. CITATION  — the quoted text is grepped out of the named PDF in
//                   Literature/ via pdftotext. A quote nobody can find is not
//                   a citation.
//
//  Exit code 0 only if every finding passes. No dependencies, by project rule.
// ════════════════════════════════════════════════════════════════════════════
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, 'index.html');
const LIT = path.join(ROOT, '..', 'Literature');
const TIMEOUT_MS = 20000;

const DIMENSIONS = ['math', 'clinical', 'code', 'ui', 'test', 'git', 'docs', 'security'];
const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'];
const CONFIDENCE = ['high', 'medium', 'low'];

const C = process.stdout.isTTY
  ? { g: s => `\x1b[32m${s}\x1b[0m`, r: s => `\x1b[31m${s}\x1b[0m`, y: s => `\x1b[33m${s}\x1b[0m`, d: s => `\x1b[2m${s}\x1b[0m` }
  : { g: s => s, r: s => s, y: s => s, d: s => s };

// ── Engine loader ─────────────────────────────────────────────────────────
// Same approach the project's own suites use: run the shipped <script> in a vm
// over a minimal DOM stub. Whatever the app really does is what gets tested.
function loadEngine() {
  const html = fs.readFileSync(APP, 'utf8');
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('no <script> block found in index.html');
  const FIELDS = {};
  const el = (id) => ({
    get value() { return FIELDS[id] !== undefined ? String(FIELDS[id]) : ''; },
    set value(v) { FIELDS[id] = v; },
    textContent: '', innerHTML: '', style: {}, checked: false,
    classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
    querySelectorAll: () => [], querySelector: () => null,
    getAttribute: () => null, setAttribute() {}, addEventListener() {},
    appendChild() {}, removeChild() {}, closest: () => null,
  });
  const sandbox = {
    document: {
      getElementById: (id) => el(id), querySelector: () => null,
      querySelectorAll: () => [], createElement: () => el('_'),
    },
    window: {}, alert() {}, requestAnimationFrame() {}, console,
    Math, parseFloat, parseInt, isNaN, isFinite, NaN, Infinity,
    Object, Array, String, Number, Boolean, Function, Date, Error, TypeError,
    JSON, RegExp, Map, Set,
    bState: { sex: 'M', model: 'buelga', dial: false, result: null, tinkCompare: [], regimenOverrideH: null },
  };
  sandbox.window = sandbox;
  vm.runInNewContext(m[1], sandbox, { timeout: TIMEOUT_MS });
  sandbox.__FIELDS = FIELDS;
  sandbox.__SRC = html;
  return sandbox;
}

let ENGINE = null, CONSTS = null;
function engine() {
  if (!ENGINE) {
    ENGINE = loadEngine();
    try { CONSTS = require(path.join(ROOT, 'harness_constants.cjs')).extract(); }
    catch (e) { CONSTS = {}; }
  }
  return ENGINE;
}

// ── Deep compare with numeric tolerance ───────────────────────────────────
function compare(actual, expected, tol, trail = '') {
  if (typeof expected === 'number') {
    if (typeof actual !== 'number' || !Number.isFinite(actual)) {
      return `${trail || 'value'}: expected number ${expected}, got ${JSON.stringify(actual)}`;
    }
    if (Math.abs(actual - expected) > tol) {
      return `${trail || 'value'}: expected ${expected} ±${tol}, got ${actual}`;
    }
    return null;
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return `${trail}: expected array, got ${typeof actual}`;
    if (actual.length !== expected.length) return `${trail}: array length ${actual.length} != ${expected.length}`;
    for (let i = 0; i < expected.length; i++) {
      const e = compare(actual[i], expected[i], tol, `${trail}[${i}]`);
      if (e) return e;
    }
    return null;
  }
  if (expected && typeof expected === 'object') {
    if (!actual || typeof actual !== 'object') return `${trail}: expected object, got ${typeof actual}`;
    for (const k of Object.keys(expected)) {
      const e = compare(actual[k], expected[k], tol, trail ? `${trail}.${k}` : k);
      if (e) return e;
    }
    return null;
  }
  if (actual !== expected) return `${trail || 'value'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
  return null;
}

// ── Run one reproduction ──────────────────────────────────────────────────
function runReproduction(rep) {
  const sb = engine();
  const printed = [];
  const ctx = Object.create(sb);
  ctx.print = (o) => { printed.push(o); };
  ctx.CONST = CONSTS;
  ctx.SRC = sb.__SRC;
  ctx.setField = (id, v) => { sb.__FIELDS[id] = v; };
  ctx.require = undefined; ctx.process = undefined; ctx.fetch = undefined;
  ctx.globalThis = ctx;

  try {
    vm.runInNewContext(rep.script, ctx, { timeout: TIMEOUT_MS, filename: 'reproduction.js' });
  } catch (e) {
    return { ok: false, detail: `script threw: ${e.message}` };
  }
  if (printed.length !== 1) {
    return { ok: false, detail: `print() called ${printed.length} times, expected exactly 1` };
  }
  const tol = typeof rep.tolerance === 'number' ? rep.tolerance : 1e-9;
  const mismatch = compare(printed[0], rep.expect, tol);
  if (mismatch) return { ok: false, detail: `output mismatch — ${mismatch}`, got: printed[0] };
  return { ok: true, got: printed[0] };
}

// ── Verify a citation actually exists in the named PDF ────────────────────
const pdfCache = new Map();
function pdfText(file) {
  if (pdfCache.has(file)) return pdfCache.get(file);
  const abs = path.isAbsolute(file) ? file : path.join(ROOT, '..', file);
  let text = null;
  if (fs.existsSync(abs)) {
    try {
      text = /\.pdf$/i.test(abs)
        ? execFileSync('pdftotext', ['-layout', abs, '-'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
        : fs.readFileSync(abs, 'utf8');
    } catch (e) { text = null; }
  }
  pdfCache.set(file, text);
  return text;
}
const norm = (s) => s.replace(/[‐-―−]/g, '-').replace(/[‘’]/g, "'")
  .replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim().toLowerCase();

function checkCitation(cit) {
  if (!cit.file) return { ok: false, detail: 'citation.file missing' };
  const text = pdfText(cit.file);
  if (text === null) return { ok: false, detail: `cannot read ${cit.file} (missing, or pdftotext unavailable)` };
  const words = String(cit.quote || '').trim().split(/\s+/);
  if (!cit.quote) return { ok: false, detail: 'citation.quote missing' };
  if (words.length > 25) return { ok: false, detail: `quote is ${words.length} words, limit 25` };
  if (norm(text).includes(norm(cit.quote))) return { ok: true };
  // Fall back to a whitespace-insensitive search, since PDF extraction breaks lines.
  const squash = (s) => norm(s).replace(/\s/g, '');
  if (squash(text).includes(squash(cit.quote))) return { ok: true, detail: 'matched ignoring whitespace' };
  return { ok: false, detail: `quote not found in ${cit.file}` };
}

// ── Shape checks ──────────────────────────────────────────────────────────
function checkShape(f) {
  const errs = [];
  const need = (cond, msg) => { if (!cond) errs.push(msg); };
  need(typeof f.id === 'string' && f.id, 'id missing');
  need(DIMENSIONS.includes(f.dimension), `dimension must be one of ${DIMENSIONS.join('|')}`);
  need(SEVERITIES.includes(f.severity), `severity must be one of ${SEVERITIES.join('|')}`);
  need(CONFIDENCE.includes(f.confidence), `confidence must be one of ${CONFIDENCE.join('|')}`);
  need(typeof f.title === 'string' && f.title.trim(), 'title missing');
  need(typeof f.claim === 'string' && f.claim.trim(), 'claim missing');
  need(typeof f.disconfirming_test === 'string' && f.disconfirming_test.trim(), 'disconfirming_test missing');
  need(f.impact && typeof f.impact.magnitude === 'string' && f.impact.magnitude.trim(), 'impact.magnitude missing');
  need(Array.isArray(f.location) && f.location.length > 0, 'location must be a non-empty array');
  const ev = f.evidence || {};
  need(ev.reproduction || ev.citation, 'evidence needs reproduction and/or citation');
  if (['math', 'clinical'].includes(f.dimension)) {
    need(!!ev.citation, `dimension "${f.dimension}" requires a citation`);
  }
  if (ev.reproduction) {
    need(typeof ev.reproduction.script === 'string' && ev.reproduction.script.trim(), 'reproduction.script missing');
    need('expect' in ev.reproduction, 'reproduction.expect missing');
    if (/\brequire\s*\(|\bprocess\b|\bfetch\s*\(|\bimport\s/.test(ev.reproduction.script || '')) {
      errs.push('reproduction.script may not use require/process/fetch/import');
    }
  }
  return errs;
}

// ── Main ──────────────────────────────────────────────────────────────────
function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const file = args.find(a => !a.startsWith('--'));
  if (!file) { console.error('usage: node verify_findings.cjs findings.json [--json]'); process.exit(2); }

  let pkg;
  try { pkg = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { console.error(C.r(`findings.json is not valid JSON: ${e.message}`)); process.exit(2); }

  if (!pkg || !Array.isArray(pkg.findings)) {
    console.error(C.r('package must be { meta, findings: [...] }')); process.exit(2);
  }

  const results = [];
  const seen = new Set();
  for (const f of pkg.findings) {
    const res = { id: f.id || '(no id)', title: f.title || '', dimension: f.dimension,
                  severity: f.severity, status: 'PASS', problems: [] };
    if (seen.has(f.id)) res.problems.push('duplicate id');
    seen.add(f.id);

    res.problems.push(...checkShape(f));

    const ev = f.evidence || {};
    if (res.problems.length === 0 && ev.reproduction) {
      const r = runReproduction(ev.reproduction);
      res.reproduction = r.ok ? 'ok' : 'FAILED';
      if (!r.ok) res.problems.push(`reproduction: ${r.detail}`);
      if (r.got !== undefined) res.observed = r.got;
    }
    if (res.problems.length === 0 && ev.citation) {
      const c = checkCitation(ev.citation);
      res.citation = c.ok ? (c.detail ? `ok (${c.detail})` : 'ok') : 'FAILED';
      if (!c.ok) res.problems.push(`citation: ${c.detail}`);
    }
    res.status = res.problems.length ? 'REJECT' : 'PASS';
    results.push(res);
  }

  const pass = results.filter(r => r.status === 'PASS');
  const rejected = results.filter(r => r.status === 'REJECT');

  if (asJson) {
    console.log(JSON.stringify({ summary: { total: results.length, pass: pass.length, reject: rejected.length }, results }, null, 2));
  } else {
    console.log('\n' + '='.repeat(76));
    console.log(`  REVIEW PACKAGE VERIFICATION — ${results.length} finding(s)`);
    console.log('='.repeat(76));
    for (const r of results) {
      const tag = r.status === 'PASS' ? C.g('PASS  ') : C.r('REJECT');
      console.log(`\n${tag} ${r.id}  [${r.dimension}/${r.severity}]  ${r.title}`);
      if (r.reproduction) console.log(`       reproduction: ${r.reproduction === 'ok' ? C.g('ok') : C.r(r.reproduction)}`);
      if (r.citation) console.log(`       citation:     ${String(r.citation).startsWith('ok') ? C.g(r.citation) : C.r(r.citation)}`);
      for (const p of r.problems) console.log(`       ${C.r('•')} ${p}`);
      if (r.observed !== undefined && r.status === 'REJECT') {
        console.log(C.d(`       observed: ${JSON.stringify(r.observed)}`));
      }
    }
    console.log('\n' + '-'.repeat(76));
    console.log(`  ${C.g(pass.length + ' verified')}   ${rejected.length ? C.r(rejected.length + ' rejected') : '0 rejected'}`);
    const bySev = {};
    for (const r of pass) bySev[r.severity] = (bySev[r.severity] || 0) + 1;
    if (pass.length) console.log('  verified by severity: ' + SEVERITIES.filter(s => bySev[s]).map(s => `${s} ${bySev[s]}`).join(', '));
    console.log('-'.repeat(76) + '\n');
  }
  process.exit(rejected.length ? 1 : 0);
}

main();

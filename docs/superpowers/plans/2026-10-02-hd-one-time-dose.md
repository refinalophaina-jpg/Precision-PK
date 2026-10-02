# One-time HD dose (D17) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.


> **Amended 2026-10-02, after D18 (the profile polish) shipped first as v3.6.0:**
> - D17 ships as **v3.7.0**.
> - `APP_VERSION`, its header and print-header markup, and the SUITE 36 version test already exist.
>   Task 1 is therefore only a bump of the constant and the two markup strings to 3.7.0.
> - D17's own tests go in a new **SUITE 37** block. Read every "36.x" test id below as "37.x".
> - The baseline count is 356, not 351.
> - The population prior is now `--ink-soft` and measured levels `--series-measured`. Nothing in
>   D17 depends on either.

**Goal:** When fewer than two upcoming HD sessions are logged, Goti-HD answers with a one-time
dose sized for an assumed 24/48/72 h gap, default 48. Missing post-HD doses are flagged. One
shared midpoint (17.5 mg/L) pick serves both HD paths. The build ships as **v3.6.0**.

**Architecture:** Everything lives in the single file `index.html`.
- **Pure engine functions:** `hdWithDose`, `hdUpcomingSessions`, `hdPickDose` and
  `hdOneTimeDose` sit beside `hdNextDose` (~line 8011).
- **Markup:** `hdOneTimeHTML` sits beside `hdNextDoseHTML` (~8109).
- **The gap choice** lives in `bState.hdGapH`, set by one `__ACT` key, `k78`, and passed
  explicitly to `hdViewFor(r, gapH)`.
- **Tests:** SUITE 36 in `phase2d_validation.cjs` (vm harness). Two checks are added to
  `docs/audit/browser-flows.cjs`.
- **Cross-checks:** a public VancoPK cross-check probe, plus a private MHHS cross-check kept
  outside the repo.

**Tech Stack:** Vanilla JS in one HTML file under a hash-pinned CSP; Node `vm` test harness;
Playwright for the browser checks; Astro hub repo for release.

**Spec:** `docs/superpowers/specs/2026-10-02-hd-one-time-dose-design.md`

## Global Constraints

- The fit, levels and objectives are untouched. The only scheduled-path change is the target
  point: the in-range step closest to `HD_PREDIALYSIS_MID`, ties to the smaller dose.
- The midpoint is derived: `(HD_PREDIALYSIS_MIN + HD_PREDIALYSIS_MAX) / 2`. No new clinical
  constant.
- `HD_ONE_TIME_GAPS_H = [24, 48, 72]` and `HD_ONE_TIME_GAP_DEFAULT_H = 48` are labelled
  PREFERENCE (rule 8).
- **No inline `on*` handlers.** New controls use `data-onclick="k78"` with `data-arg`.
- **No glyph icons.** The spec's "✓" becomes a drawn `ICON.check` SVG (CLAUDE.md, "No glyph
  icons"). Record this ruling in the ledger.
- **Colours and selection:**
  - every colour comes from a token;
  - a selection is `.toggle-opt.active` (background step plus terracotta ink);
  - terracotta marks only the recommendation.
- Touch targets ≥ 44 px; no horizontal scroll at 375 px; print keeps working.
- Rybak 2020 Rec 14 is the only clinical source shipped. VancoPK's Ke 0.005 h⁻¹ and its 35%
  removal live **only** in `docs/audit/probe-hd-one-time.cjs`.
- **MHHS content never enters any repo**, nor any external service. The private cross-check
  lives in `/Users/olaiya/Projects-Local/Pharmacy/Vancomycin /Hermann Vanc /`, which is
  git-ignored by the parent Pharmacy repo.
- **Rule 9:** a SUITE 35 expectation that encoded the old smallest-in-range pick is changed in
  the open. Record each as `old → new` in the ledger and in D17.
- **Version:** `APP_VERSION = '3.6.0'`. Header markup reads `Vancomycin TDM v3.6.0`.
- Fictional data only.

## Review Focus

1. **A gap button tapped after editing inputs without recalculating.** The re-render must keep
   the stale-inputs warning: `renderBayesianResults` reads `bState.resultFingerprint` as before.
   Covered by browser check 2, which taps after a calculate; the reviewer should confirm the
   stale path is untouched.
2. **A session that ended under 6 h ago with no dose since.** The dose follows it, and it must
   not *also* be flagged as missed (test 36.9).
3. **Planned doses entered for "now", or for the future, with no schedule.** They are read, not
   replaced, and counted in "Includes the N planned doses" (test 36.8).
4. **Keyboard use of the gap buttons.** Focus returns to the pressed button after the re-render
   (browser check 2 asserts `document.activeElement`).
5. **Print with the one-time answer.** No buttons; the gap is stated as text (test 36.14).

---

### Task 0: Branch

- [ ] **Step 1: Create the feature branch**

```bash
cd "/Users/olaiya/Projects-Local/Pharmacy/Vancomycin /AinaDaraTDM"
git switch -c hd-one-time-dose
node phase2d_validation.cjs > /dev/null; echo "baseline exit $?"
```
Expected: `baseline exit 0` (351/351).

---

### Task 1: The version is one constant (3.6.0)

**Files:**
- Modify: `index.html` (top of `<script>`, ~line 3767; header markup ~2735; print header
  markup ~2703; `_prHeader` ~14297)
- Test: `phase2d_validation.cjs` (new SUITE 36 block before the `// SUMMARY` banner)

**Interfaces:**
- Produces: `const APP_VERSION = '3.6.0'` (script top level).

- [ ] **Step 1: Write the failing test.** Insert this block just before the
  `// ════ SUMMARY` banner in `phase2d_validation.cjs`:

```js
// ════════════════════════════════════════════════════════════════════
// SUITE 36 — one-time HD dose, midpoint pick, version (D17)
// ════════════════════════════════════════════════════════════════════
{
  console.log(`\n${'─'.repeat(60)}`);
  console.log('  SUITE 36 — one-time HD dose, midpoint pick, version (D17)');
  console.log(`${'─'.repeat(60)}`);
  const src36 = fs.readFileSync(htmlPath, 'utf8');
  const script36 = src36.match(/<script>([\s\S]*?)<\/script>/)[1];
  const code36 = script36.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  const bodyOf36 = (n) => { const c = code36.slice(code36.indexOf('function ' + n + '(')); return c.slice(0, c.indexOf('\nfunction ')); };
  test('36.1 the version is one constant, shown in the header and on both print headers', () => {
    const m = script36.match(/const APP_VERSION = '(\d+\.\d+\.\d+)';/);
    assert(m && m[1] === '3.6.0', 'APP_VERSION is 3.6.0');
    assert(src36.includes(`<div class="header-tag">Vancomycin TDM v${m[1]}</div>`), 'the static header names the same version');
    assert(src36.includes(`<div class="ph-tag">Vancomycin TDM Report · Clinical Pharmacist Tool · v${m[1]}</div>`), 'the static print header names it');
    assert(sandbox._prHeader('1 Oct 2026 10:00', 'Goti 2018').includes(`v${m[1]}`), 'the built print report names it');
  });
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node phase2d_validation.cjs 2>&1 | grep -E "36\.1|Passed|Failed"`
Expected: `FAIL ... 36.1` with "APP_VERSION is 3.6.0".

- [ ] **Step 3: Implement.** In `index.html`:
  - Directly after the `<script>` line (~3766), add:

```js
// The build's version (D17). Every release bumps it: minor for a change in clinical
// behaviour or a new feature, patch for fixes and wording, major for an engine or model
// overhaul. The static header and print-header markup carry the same string (SUITE 36.1).
const APP_VERSION = '3.6.0';
```

  - Replace `<div class="header-tag">Vancomycin TDM v3.0</div>` with
    `<div class="header-tag">Vancomycin TDM v3.6.0</div>`.
  - Replace `<div class="ph-tag">Vancomycin TDM Report · Clinical Pharmacist Tool</div>` with
    `<div class="ph-tag">Vancomycin TDM Report · Clinical Pharmacist Tool · v3.6.0</div>`.
  - In `_prHeader`, change the `pr-tag` line to:

```js
    <div class="pr-tag">Vancomycin TDM Report &middot; Clinical Pharmacist Tool &middot; v${APP_VERSION}</div>
```

- [ ] **Step 4: Run to verify it passes**

Run: `node phase2d_validation.cjs 2>&1 | tail -5`
Expected: `Passed : 352`, `Failed : 0`.

- [ ] **Step 5: Commit**

```bash
git add index.html phase2d_validation.cjs
git commit -m "Version 3.6.0: one APP_VERSION constant, named in the header and the printed report (D17)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Shared choice rule with the midpoint pick

**Files:**
- Modify: `index.html`, around `hdNextDose` (~8000–8054)
- Modify: `phase2d_validation.cjs` (SUITE 35: test 35.4's last assertion; any other expectation
  that encoded the old pick, per Step 6)
- Test: `phase2d_validation.cjs` SUITE 36

**Interfaces:**
- Produces:
  - `HD_PREDIALYSIS_MID` (number, 17.5).
  - `hdWithDose(r, mg, atH) → r'`: `r` with one dose appended; `r` itself when `mg` is 0.
  - `hdUpcomingSessions(r, nowH) → session[]`, sorted by start: sessions not yet ended, or
    ended under `HD_POSTSESSION_DOSE_WINDOW_H` ago with no dose since.
  - `hdPickDose(r, doseAtH, readAtH) → {kind:'dose'|'hold'|'closest', reason:''|'in'|'above'|'overshoot', mg, tinfH, pre, rr}`.
- `hdNextDose(r, nowH)` keeps its return shape exactly.

- [ ] **Step 1: Write the failing tests.** Append inside the SUITE 36 block, after 36.1:

```js
  // predictFittedAt is a top-level function declaration, so the vm global holds it and a
  // stub here is what hdPickDose calls. The stub reads the dose the rule appended.
  const stubPre = (table, fn) => { const prev = sandbox.predictFittedAt;
    sandbox.predictFittedAt = (r) => { const mg = r.doses.length > 1 ? r.doses[r.doses.length - 1].mg : 0;
      return typeof table === 'function' ? table(mg) : (table[mg] != null ? table[mg] : 99); };
    try { return fn(); } finally { sandbox.predictFittedAt = prev; } };
  const r1 = { doses: [{ mg: 1000, tinfH: 1, timeH: 0 }] };
  test('36.2 the pick is the in-range step closest to 17.5; ties go to the smaller dose', () => {
    const tie = stubPre({ 0: 14, 250: 16, 500: 19, 750: 22 }, () => sandbox.hdPickDose(r1, 10, 58));
    assert(tie.kind === 'dose' && tie.mg === 250, `16 and 19 are both 1.5 from 17.5: smaller wins, got ${JSON.stringify(tie)}`);
    const mid = stubPre({ 0: 12, 250: 15.2, 500: 17.3, 750: 19.9 }, () => sandbox.hdPickDose(r1, 10, 58));
    assert(mid.mg === 500 && mid.kind === 'dose', `old rule gave 250; midpoint gives 500, got ${mid.mg}`);
    const nowDose = stubPre({ 0: 16, 250: 17.4, 500: 19 }, () => sandbox.hdPickDose(r1, 10, 58));
    assert(nowDose.kind === 'dose' && nowDose.mg === 250, `old rule held at 16; midpoint doses 250, got ${JSON.stringify(nowDose)}`);
    assert(Math.abs(sandbox.HD_PREDIALYSIS_MID_FOR_TEST() - 17.5) < 1e-12, 'midpoint derived from the band');
  });
  test('36.3 holds and the closest answer keep their meaning', () => {
    const inHold = stubPre({ 0: 17.6, 250: 19.5 }, () => sandbox.hdPickDose(r1, 10, 58));
    assert(inHold.kind === 'hold' && inHold.reason === 'in' && inHold.mg === 0, JSON.stringify(inHold));
    const above = stubPre({ 0: 21 }, () => sandbox.hdPickDose(r1, 10, 58));
    assert(above.kind === 'hold' && above.reason === 'above', JSON.stringify(above));
    const over = stubPre({ 0: 14.1 }, () => sandbox.hdPickDose(r1, 10, 58));   // every step reads 99
    assert(over.kind === 'hold' && over.reason === 'overshoot' && over.mg === 0, JSON.stringify(over));
    const low = stubPre((mg) => 5 + mg / 250, () => sandbox.hdPickDose(r1, 10, 58));   // 2000 mg reads 13
    assert(low.kind === 'closest' && low.mg === 2000, JSON.stringify(low));
    assert(low.rr.doses.length === 2 && low.rr.doses[1].mg === 2000 && low.rr.doses[1].timeH === 10, 'rr carries the chosen dose');
  });
  test('36.4 the scheduled answer uses the shared rule on the real fit', () => {
    const pk = sandbox.gotiPopPK(10, 70, true);
    const r = { model: 'goti', dial: true, CL_ind: pk.TVCL, V_ind: pk.TVVc, tbw: 70,
      goti: { Vc_ind: pk.TVVc, Vp_ind: pk.TVVp, Q: pk.Q }, levels: [], doses: [{ mg: 1750, tinfH: 2, timeH: 0 }],
      hdSessions: [{ n: 1, startH: 4, endH: 8 }, { n: 2, startH: 52, endH: 56 }, { n: 3, startH: 100, endH: 104 }] };
    const rec = sandbox.hdNextDose(r, 20);
    const pres = [0, 250, 500, 750, 1000, 1250, 1500, 1750, 2000].map(mg => ({ mg,
      pre: sandbox.predictFittedAt(sandbox.hdWithDose(r, mg, 56), 100) }));
    const inR = pres.filter(p => p.pre >= 15 && p.pre <= 20);
    if (inR.length) {
      const best = inR.reduce((b, p) => Math.abs(p.pre - 17.5) < Math.abs(b.pre - 17.5) ? p : b);
      assert(rec.mg === best.mg, `scheduled pick ${rec.mg} is the in-range step nearest 17.5 (${best.mg})`);
    }
    assert(/hdPickDose\(/.test(bodyOf36('hdNextDose')) && /hdUpcomingSessions\(/.test(bodyOf36('hdNextDose')), 'hdNextDose uses the shared helpers');
  });
```

  `HD_PREDIALYSIS_MID` is a `const` and is not visible on the sandbox. Expose it through the
  one-line function in Step 3.

- [ ] **Step 2: Run to verify they fail**

Run: `node phase2d_validation.cjs 2>&1 | grep -E "FAIL.*36\.[234]"`
Expected: 36.2, 36.3 and 36.4 FAIL (`hdPickDose is not a function`).

- [ ] **Step 3: Implement.** In `index.html`, replace from the comment block above
  `const HD_POSTSESSION_DOSE_WINDOW_H = 6;` through the end of `function hdNextDose` with:

```js
// Post-HD dose (D16; target point D17). The dose follows the next session: one in
// progress, one still to come, or one that ended under HD_POSTSESSION_DOSE_WINDOW_H ago
// with no dose entered after it (then the dose is given now). It is sized at the start
// of the session after that, on the fitted curve with every dose entered.
//   - A planned dose already entered around that session is READ, not
//     overridden: kind 'planned' reports what it gives.
//   - Otherwise hdPickDose: the 250 mg step (or no dose) whose pre-HD level is
//     closest to the middle of 15–20 (Rybak 2020 Rec 14), ties to the smaller
//     dose; a hold when no dose is that step or every step reads above 20; else
//     the step closest to the range, flagged.
// A maintenance dose never exceeds DOSE_MAX_PER_DOSE_MG. Dose with every
// session: Rybak 2020 (text, Rec 13).
// PREFERENCE (rule 8): chooses which session the dose follows; changes no number.
const HD_POSTSESSION_DOSE_WINDOW_H = 6;
// The target point within Rybak 2020 Rec 14's 15–20 band (D17, chosen by the user
// 2026-10-02): derived from the band, not a new number. The smallest in-range step
// settled near 15, which VancoPK's published arithmetic puts at AUC ~380.
const HD_PREDIALYSIS_MID = (HD_PREDIALYSIS_MIN + HD_PREDIALYSIS_MAX) / 2;
function HD_PREDIALYSIS_MID_FOR_TEST() { return HD_PREDIALYSIS_MID; }
// The result with one more dose at atH (infusion time from autoTinf); r itself for 0 mg.
function hdWithDose(r, mg, atH) {
  return mg > 0 ? Object.assign({}, r, { doses: r.doses.concat([{ mg, tinfH: autoTinf(mg), timeH: atH }]) }) : r;
}
// Sessions a post-HD dose can still follow, in start order.
function hdUpcomingSessions(r, nowH) {
  const dosedAfter = (x) => r.doses.some(d => d.timeH >= x.endH);
  return (r.hdSessions || []).slice().sort((a, b) => a.startH - b.startH)
    .filter(x => x.endH > nowH || (x.endH > nowH - HD_POSTSESSION_DOSE_WINDOW_H && !dosedAfter(x)));
}
// One rule for both HD answers (D17): 0 and every 250 mg step to the per-dose
// ceiling, each given at doseAtH, read on the fitted curve at readAtH.
function hdPickDose(r, doseAtH, readAtH) {
  const steps = [0];
  for (let mg = MATRIX_DOSE_STEP; mg <= DOSE_MAX_PER_DOSE_MG; mg += MATRIX_DOSE_STEP) steps.push(mg);
  const ev = steps.map(mg => ({ mg, pre: predictFittedAt(hdWithDose(r, mg, doseAtH), readAtH) }));
  const off = (e) => Math.abs(e.pre - HD_PREDIALYSIS_MID);
  const inRange = ev.filter(e => e.pre >= HD_PREDIALYSIS_MIN && e.pre <= HD_PREDIALYSIS_MAX);
  let pick, kind, reason = '';
  if (inRange.length) {
    pick = inRange.reduce((b, e) => off(e) < off(b) ? e : b);   // strict: a tie keeps the smaller dose
    kind = pick.mg ? 'dose' : 'hold'; reason = pick.mg ? '' : 'in';
  } else if (ev[0].pre > HD_PREDIALYSIS_MAX) {
    pick = ev[0]; kind = 'hold'; reason = 'above';
  } else {
    const gap = (e) => e.pre < HD_PREDIALYSIS_MIN ? HD_PREDIALYSIS_MIN - e.pre : e.pre - HD_PREDIALYSIS_MAX;
    pick = ev.reduce((b, e) => gap(e) < gap(b) ? e : b);
    kind = pick.mg ? 'closest' : 'hold'; reason = pick.mg ? '' : 'overshoot';
  }
  return { kind, reason, mg: pick.mg, tinfH: pick.mg ? autoTinf(pick.mg) : 0, pre: pick.pre, rr: hdWithDose(r, pick.mg, doseAtH) };
}
function hdNextDose(r, nowH) {
  const upcoming = hdUpcomingSessions(r, nowH);
  if (upcoming.length < 2) return { need: 'sessions', planned: upcoming.length };
  const first = upcoming[0], sizing = upcoming[1];
  const doseAtH = Math.max(first.endH, nowH);
  const future = r.doses.filter(d => d.timeH > nowH);
  const plannedInWindow = r.doses.filter(d => d.timeH >= Math.min(first.startH, doseAtH) && d.timeH < sizing.startH && d.timeH > nowH - 1e-9);
  const base = { doseAtH, session: first.n, sizing: sizing.n, plannedCount: future.length, plannedInWindow };
  if (plannedInWindow.length) {
    const pre = predictFittedAt(r, sizing.startH);
    return Object.assign(base, { kind: 'planned', mg: 0, tinfH: 0, pre, auc24: fittedAUC(r, sizing.startH - 24, sizing.startH), peak: null, repeat: [] });
  }
  const pk = hdPickDose(r, doseAtH, sizing.startH);
  const rr = pk.rr, tinfH = pk.tinfH;
  const repeat = [];
  let course = rr;
  for (let k = 1; k + 1 < upcoming.length; k++) {
    if (pk.mg) course = Object.assign({}, course, { doses: course.doses.concat([{ mg: pk.mg, tinfH, timeH: upcoming[k].endH }]) });
    repeat.push({ n: upcoming[k + 1].n, pre: predictFittedAt(course, upcoming[k + 1].startH) });
  }
  return Object.assign(base, { kind: pk.kind, reason: pk.reason, mg: pk.mg, tinfH, pre: pk.pre,
    auc24: fittedAUC(rr, sizing.startH - 24, sizing.startH),
    peak: pk.mg ? predictFittedAt(rr, doseAtH + tinfH) : null, repeat });
}
```

  - **The gap reducer** keeps D16's "distance to the band" for values below 15, and uses
    `pre − 20` above it. Inside the band the gap is never used, because `inRange` is empty
    there.
  - **Add the constants to `harness_constants.cjs`** beside `DOSE_MAX_PER_DOSE_MG` (rule 6,
    for the probe in Task 4):

```js
    HD_PREDIALYSIS_MIN:     num(src, 'HD_PREDIALYSIS_MIN'),
    HD_PREDIALYSIS_MAX:     num(src, 'HD_PREDIALYSIS_MAX'),
```

- [ ] **Step 4: Run SUITE 36**

Run: `node phase2d_validation.cjs 2>&1 | grep -E "36\.[1-4]"`
Expected: 36.1–36.4 PASS.

- [ ] **Step 5: Update 35.4 in the open (rule 9).** In test 35.4, replace:

```js
    if (rec.mg > 250) {
      const less = sandbox.predictFittedAt(Object.assign(hdR(), { doses: hdR().doses.concat([{ mg: rec.mg - 250, tinfH: sandbox.autoTinf(rec.mg - 250), timeH: 56 }]) }), 100);
      assert(less < 15, 'one 250 mg step less misses the range: this is the smallest');
    }
```

  with:

```js
    // D17: the pick is the in-range step closest to 17.5 (was: the smallest in range).
    for (const mg of [rec.mg - 250, rec.mg + 250].filter(x => x >= 0 && x <= 2000)) {
      const p = sandbox.predictFittedAt(sandbox.hdWithDose(hdR(), mg, 56), 100);
      assert(!(p >= 15 && p <= 20) || Math.abs(p - 17.5) >= Math.abs(rec.pre - 17.5), `a neighbouring in-range step (${mg} mg, ${p.toFixed(2)}) is not closer to 17.5`);
    }
```

  Ledger: `Task 2: rule-9 change 35.4 — old "one step less misses 15 (smallest)" → new "no neighbouring in-range step is closer to 17.5"`.

- [ ] **Step 6: Run the whole suite and triage SUITE 35**

Run: `node phase2d_validation.cjs 2>&1 | grep -E "FAIL|Passed|Failed"`
Expected: `Failed : 0`, or failures only in SUITE 35 tests whose expectation encoded the old pick.
- **A failure that encodes the old pick** looks like this: a hold asserted where 0 reads
  15–17.4 and a 250 mg step is nearer 17.5, or a specific dose that was the smallest in range.
  Change the expectation to the midpoint result, and ledger `old → new` with the test id and the
  numbers.
- **Any other failure is a regression:** use superpowers:systematic-debugging, and never edit the
  test.

- [ ] **Step 7: Commit**

```bash
node phase2d_validation.cjs 2>&1 | tail -4
git add index.html phase2d_validation.cjs harness_constants.cjs
git commit -m "HD: one shared pick for both answers — the in-range step closest to 17.5 mg/L (D17)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: One-time dose engine and the view

**Files:**
- Modify: `index.html`: after `hdNextDose`, add `hdOneTimeDose`; change `hdViewFor` (~8056)
- Test: `phase2d_validation.cjs` SUITE 36

**Interfaces:**
- Consumes: `hdWithDose`, `hdUpcomingSessions`, `hdPickDose` (Task 2).
- Produces:
  - `HD_ONE_TIME_GAPS_H = [24, 48, 72]` and `HD_ONE_TIME_GAP_DEFAULT_H = 48`.
  - `hdOneTimeDose(r, nowH, gapH) → { oneTime:true, doseAtH, after:number|null, gapH, readAtH, plannedCount, plannedInWindow, missed:{n,endH}|null, kind, reason, mg, tinfH, pre, auc24, peak, table:[{mg, at:[c24,c48,c72]}] }`.
  - `hdViewFor(r, gapH) → {nowH, rec} | {nowH, empiric} | null`. `rec` is one-time whenever
    `hdNextDose` returns `need`.

- [ ] **Step 1: Write the failing tests** (inside SUITE 36, after 36.4):

```js
  const pk36 = sandbox.gotiPopPK(10, 70, true);
  const hd36 = (extra) => Object.assign({ model: 'goti', dial: true, CL_ind: pk36.TVCL, V_ind: pk36.TVVc, tbw: 70,
    goti: { Vc_ind: pk36.TVVc, Vp_ind: pk36.TVVp, Q: pk36.Q }, levels: [{ conc: 12, timeH: 19 }],
    doses: [{ mg: 1750, tinfH: 2, timeH: 0 }], hdSessions: [{ n: 1, startH: 4, endH: 8 }], fitNowH: 20 }, extra || {});
  test('36.5 no session ahead: the one-time dose is given now and read the assumed gap later', () => {
    const v = sandbox.hdViewFor(hd36(), 48);
    assert(v.rec.oneTime && v.rec.after === null && v.rec.doseAtH === 20 && v.rec.readAtH === 68 && v.rec.gapH === 48, JSON.stringify(v.rec).slice(0, 300));
  });
  test('36.6 one session ahead: the dose follows it; two ahead keep the scheduled answer', () => {
    const one = sandbox.hdViewFor(hd36({ hdSessions: [{ n: 1, startH: 4, endH: 8 }, { n: 2, startH: 52, endH: 56 }] }), 48).rec;
    assert(one.oneTime && one.after === 2 && one.doseAtH === 56 && one.readAtH === 104, JSON.stringify(one).slice(0, 300));
    const two = sandbox.hdViewFor(hd36({ hdSessions: [{ n: 1, startH: 4, endH: 8 }, { n: 2, startH: 52, endH: 56 }, { n: 3, startH: 100, endH: 104 }] }), 48).rec;
    assert(!two.oneTime && two.session === 2 && two.sizing === 3, 'two upcoming sessions: the scheduled answer');
  });
  test('36.7 each gap sizes at its own point; an unknown gap falls back to 48 h', () => {
    for (const g of [24, 48, 72]) {
      const rec = sandbox.hdOneTimeDose(hd36(), 20, g);
      assert(rec.gapH === g && rec.readAtH === 20 + g, `gap ${g}`);
      const check = sandbox.predictFittedAt(rec.rr || sandbox.hdWithDose(hd36(), rec.mg, rec.doseAtH), rec.readAtH);
      assert(Math.abs(check - rec.pre) < 1e-9, `pre is the fitted level at the read point (gap ${g})`);
      if (rec.kind === 'dose') assert(rec.pre >= 15 && rec.pre <= 20, `in range at gap ${g}`);
    }
    assert(sandbox.hdOneTimeDose(hd36(), 20, 30).gapH === 48 && sandbox.hdOneTimeDose(hd36(), 20, undefined).gapH === 48, 'fallback');
  });
  test('36.8 a planned dose inside the window is read, not replaced', () => {
    const rec = sandbox.hdOneTimeDose(hd36({ doses: [{ mg: 1750, tinfH: 2, timeH: 0 }, { mg: 750, tinfH: 1, timeH: 30 }] }), 20, 48);
    assert(rec.kind === 'planned' && rec.plannedInWindow.length === 1 && rec.plannedCount === 1 && rec.mg === 0, JSON.stringify(rec).slice(0, 300));
  });
  test('36.9 a finished session with no dose after it is flagged — only the latest, never the one the dose follows', () => {
    assert(sandbox.hdOneTimeDose(hd36(), 20, 48).missed.n === 1, 'session 1 ended at 8 h; the only dose was at 0 h');
    assert(sandbox.hdOneTimeDose(hd36({ doses: [{ mg: 1750, tinfH: 2, timeH: 0 }, { mg: 500, tinfH: 1, timeH: 9 }] }), 20, 48).missed === null, 'a dose after it clears the flag');
    const two = sandbox.hdOneTimeDose(hd36({ hdSessions: [{ n: 1, startH: 4, endH: 8 }, { n: 2, startH: 28, endH: 32 }],
      doses: [{ mg: 1750, tinfH: 2, timeH: 0 }, { mg: 500, tinfH: 1, timeH: 9 }] }), 40, 48);
    assert(two.missed && two.missed.n === 2, 'the latest finished session');
    const justEnded = sandbox.hdOneTimeDose(hd36({ hdSessions: [{ n: 1, startH: 16, endH: 19 }] }), 20, 48);
    assert(justEnded.after === 1 && justEnded.missed === null, 'a session that ended 1 h ago takes the dose; it is not "missed"');
  });
  test('36.10 no sessions logged at all: still a one-time answer, nothing flagged', () => {
    const rec = sandbox.hdViewFor(hd36({ hdSessions: [] }), 48).rec;
    assert(rec.oneTime && rec.after === null && rec.missed === null && ['dose', 'hold', 'closest'].includes(rec.kind), JSON.stringify(rec).slice(0, 200));
  });
  test('36.11 the table runs from no dose to the first step above 20 at every gap, and holds the pick', () => {
    const rec = sandbox.hdOneTimeDose(hd36(), 20, 48);
    const t = rec.table;
    assert(t[0].mg === 0 && t.every((row, i) => row.mg === i * 250 && row.at.length === 3), 'consecutive 250 mg rows from 0');
    const last = t[t.length - 1];
    assert(last.at.every(c => c > 20) || last.mg === 2000, 'stops at the first all-above row (or the ceiling)');
    assert(t.slice(0, -1).every(row => !row.at.every(c => c > 20)), 'no earlier row is all-above');
    assert(t.some(row => row.mg === rec.mg), 'the chosen dose is a row');
    assert(t.every(row => row.at[0] >= row.at[1] && row.at[1] >= row.at[2]), 'later gaps read lower');
  });
  test('36.12 the handoff case (fictional): 1 g, HD 13:42–17:45, 10.3 mg/L at 05:42 next day — a one-time dose, the missed dose flagged', () => {
    const pk = sandbox.gotiPopPK(10, 70, true);
    const doses = [{ mg: 1000, tinfH: sandbox.autoTinf(1000), timeH: 9.3 }];
    const levels = [{ conc: 10.3, timeH: 29.7 }];
    const mf = sandbox.mapFit((a, b, c) => sandbox.burtonObj3D(a, b, c, pk.TVCL, pk.TVVc, pk.TVVp, doses, levels), 3, K36.OMEGA2_CL_GOTI, K36.OMEGA2_VC_GOTI, 400);
    const [eCL, eVc, eVp] = mf.eta;
    const r = { model: 'goti', dial: true, CL_ind: pk.TVCL * Math.exp(eCL), V_ind: pk.TVVc * Math.exp(eVc), tbw: 70,
      goti: { Vc_ind: pk.TVVc * Math.exp(eVc), Vp_ind: pk.TVVp * Math.exp(eVp), Q: pk.Q }, levels, doses,
      hdSessions: [{ n: 1, startH: 13.7, endH: 17.75 }], fitNowH: 30 };
    const rec = sandbox.hdViewFor(r, 48).rec;
    assert(rec.oneTime && rec.after === null && rec.missed && rec.missed.n === 1, JSON.stringify(rec).slice(0, 300));
    assert(['dose', 'closest'].includes(rec.kind) && rec.mg >= 250, `a dose is advised: ${rec.kind} ${rec.mg}`);
  });
```

  - **The rr comparison in 36.7:** `hdOneTimeDose` does not return `rr`, so the test rebuilds
    it with `hdWithDose`.
  - **36.12 needs the harness constants.** Add `const K36 = require('./harness_constants.cjs').extract();`
    as the second line inside the SUITE 36 block. If `phase2d_validation.cjs` already binds
    `extract` at the top, reuse it.

- [ ] **Step 2: Run to verify they fail**

Run: `node phase2d_validation.cjs 2>&1 | grep -E "FAIL.*36\.(5|6|7|8|9|10|11|12)"`
Expected: all eight FAIL (`hdOneTimeDose is not a function` / `v.rec.oneTime` undefined).

- [ ] **Step 3: Implement.** In `index.html`, directly after `function hdNextDose`:

```js
// One-time HD dose (D17): fewer than two upcoming sessions are logged, so the
// session to size at is unknown. The dose follows the one session still ahead, if
// any, else it is given now; it is sized at an ASSUMED gap after the dose, stated
// in the answer. Same rule as the scheduled answer (hdPickDose). A planned dose in
// the window is read, not replaced. The latest finished session with no dose
// entered after it — other than the one the dose follows — is reported as missed.
// PREFERENCE (rule 8): the gaps offered and the default. 48 h is the shorter
// thrice-weekly gap (VancoPK's HD calculator also defaults to 2 days); 72 h is the
// longest gap before a recheck. They choose where the dose is read; the rule is Rybak's.
const HD_ONE_TIME_GAPS_H = [24, 48, 72];
const HD_ONE_TIME_GAP_DEFAULT_H = 48;
function hdOneTimeDose(r, nowH, gapH) {
  const gap = HD_ONE_TIME_GAPS_H.includes(gapH) ? gapH : HD_ONE_TIME_GAP_DEFAULT_H;
  const upcoming = hdUpcomingSessions(r, nowH);
  const follow = upcoming.length ? upcoming[0] : null;
  const doseAtH = follow ? Math.max(follow.endH, nowH) : nowH;
  const readAtH = doseAtH + gap;
  const ended = (r.hdSessions || []).filter(x => x.endH <= nowH && x !== follow).sort((a, b) => a.endH - b.endH);
  const last = ended[ended.length - 1];
  const missed = last && !r.doses.some(d => d.timeH >= last.endH && d.timeH <= nowH) ? { n: last.n, endH: last.endH } : null;
  const future = r.doses.filter(d => d.timeH > nowH);
  const winStart = follow ? Math.min(follow.startH, doseAtH) : nowH;
  const plannedInWindow = r.doses.filter(d => d.timeH >= winStart && d.timeH < readAtH && d.timeH > nowH - 1e-9);
  const base = { oneTime: true, doseAtH, after: follow ? follow.n : null, gapH: gap, readAtH,
    plannedCount: future.length, plannedInWindow, missed };
  if (plannedInWindow.length) {
    return Object.assign(base, { kind: 'planned', reason: '', mg: 0, tinfH: 0, pre: predictFittedAt(r, readAtH),
      auc24: fittedAUC(r, readAtH - 24, readAtH), peak: null, table: [] });
  }
  const pk = hdPickDose(r, doseAtH, readAtH);
  const table = [];
  for (let mg = 0; mg <= DOSE_MAX_PER_DOSE_MG; mg += MATRIX_DOSE_STEP) {
    const rx = hdWithDose(r, mg, doseAtH);
    const at = HD_ONE_TIME_GAPS_H.map(g => predictFittedAt(rx, doseAtH + g));
    table.push({ mg, at });
    if (at.every(c => c > HD_PREDIALYSIS_MAX)) break;
  }
  return Object.assign(base, { kind: pk.kind, reason: pk.reason, mg: pk.mg, tinfH: pk.tinfH, pre: pk.pre,
    auc24: fittedAUC(pk.rr, readAtH - 24, readAtH),
    peak: pk.mg ? predictFittedAt(pk.rr, doseAtH + pk.tinfH) : null, table });
}
```

  Change `hdViewFor`:

```js
// The HD answer for a result, read once at fit time (r.fitNowH) so a redraw or a
// print can never show a different one (D16). gapH: the assumed gap for a one-time
// answer (D17), from bState.hdGapH; anything else means the 48 h default.
function hdViewFor(r, gapH) {
  if (!(r && r.model === 'goti' && r.dial)) return null;
  const nowH = r.fitNowH != null ? r.fitNowH : Date.now() / 3600000;
  if (!(r.levels || []).length) { const rows = hdEmpiricDoses(r.tbw); return rows ? { nowH, empiric: rows } : null; }
  const rec = hdNextDose(r, nowH);
  return { nowH, rec: rec.need ? hdOneTimeDose(r, nowH, gapH) : rec };
}
```

  **Ruling** (record it in the ledger): with exactly one upcoming session `hdNextDose` returns
  `need` with `planned: 1`. `follow = upcoming[0]` is that session. This matches the spec's
  "exactly one session is upcoming".

- [ ] **Step 4: Run to verify they pass**

Run: `node phase2d_validation.cjs 2>&1 | grep -E "36\.|Passed|Failed"`
Expected: 36.1–36.12 PASS. `Failed : 0` — but 35.18 may now fail on the
`hdNextDoseHTML` regex if `hdViewFor(r)` changed its rec. It should not: 35.18's fixture has
four sessions. If it fails, debug; do not edit it.

- [ ] **Step 5: Commit**

```bash
git add index.html phase2d_validation.cjs
git commit -m "HD: one-time dose when the next sessions are unknown — sized at an assumed 24/48/72 h gap, missed post-HD dose flagged (D17)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: VancoPK public cross-check probe

The probe runs before the UI on purpose. A large systematic disagreement is reported to the
user before anything is displayed.

**Files:**
- Create: `docs/audit/probe-hd-one-time.cjs`

**Interfaces:**
- Consumes:
  - `calcVd('vancopk', age, tbw)` (shipped, Fewel 2021);
  - `gotiPopPK`, `mapFit`, `burtonObj3D`, `calcCrCl`, `autoTinf`;
  - `hdViewFor(r, gapH)` (Task 3);
  - `K.OMEGA2_CL_GOTI`, `K.OMEGA2_VC_GOTI`, `K.HD_PREDIALYSIS_MIN`, `K.HD_PREDIALYSIS_MAX`.
- Produces: a printed table and a summary. Exit 0 if the screen reproduction holds, 1 if not.

- [ ] **Step 1: Write the probe**

```js
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
  const crcl = sb.calcCrCl(age, 'M', SCR, wt, 'goti');
  if (!(crcl >= 5 && crcl <= 150)) throw new Error(`fictional CrCl ${crcl} outside the model range`);
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
```

- [ ] **Step 2: Run it**

Run: `node docs/audit/probe-hd-one-time.cjs | tee /tmp/d17-vpk.txt | tail -8`
Expected:
- the first line reproduces the screen (`20.6`), with exit 0;
- 162 cases, then a summary line.

Ledger the summary line verbatim: `Task 4: VancoPK cross-check — <summary>`.

- [ ] **Step 3: Read the disagreement.** If the median absolute difference exceeds one 250 mg
  step at any gap, **stop and report it to the user** before Task 6. Give:
  - the direction;
  - the size;
  - the likely cause: Goti-HD's averaged clearance across the gap, versus Ke 0.005 h⁻¹ plus 35%
    removal per session.

  It is not tuned away (spec). Otherwise continue.

- [ ] **Step 4: Commit**

```bash
git add docs/audit/probe-hd-one-time.cjs
git commit -m "docs/audit: D17 one-time HD dose against VancoPK's published HD method (fictional cases)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Private MHHS cross-check (not committed)

**Files:**
- Create: `/Users/olaiya/Projects-Local/Pharmacy/Vancomycin /Hermann Vanc /d17-mhhs-crosscheck.cjs`
  (outside every repo)
- Create: `/Users/olaiya/Projects-Local/Pharmacy/Vancomycin /Hermann Vanc /d17-mhhs-crosscheck.txt`
  (its output)

- [ ] **Step 1: Confirm the location is ignored**

```bash
cd /Users/olaiya/Projects-Local/Pharmacy && git check-ignore -q "Vancomycin /Hermann Vanc /d17-mhhs-crosscheck.cjs" && echo IGNORED
```
Expected: `IGNORED`.

- [ ] **Step 2: Write the script.**
  - Copy `docs/audit/probe-hd-one-time.cjs` to that path. Change its `require` paths to absolute
    paths into `AinaDaraTDM/`.
  - Replace the VancoPK section with the protocol's unscheduled-HD table:
    - read it **locally** with `pdftotext -layout` from
      `Hermann Vanc /MHHS Vancomycin Protocol_2024 - FINAL.pdf`, p. 22;
    - transcribe it into the script as a weight-band × level-band map;
    - apply its "no re-dose above 20" rule.
  - Compare our dose at each gap against the protocol dose, for the same fictional cases. The
    protocol's table needs no gap, so report ours at 48 h and 72 h beside it.

- [ ] **Step 3: Run it and keep the output private**

```bash
cd "/Users/olaiya/Projects-Local/Pharmacy/Vancomycin /Hermann Vanc " && node d17-mhhs-crosscheck.cjs > d17-mhhs-crosscheck.txt; tail -5 d17-mhhs-crosscheck.txt
```
- **Ledger** only general findings, without the protocol's numbers. For example: "ours doses
  higher than the protocol for weights over 85 kg at 48 h, by about one step".
- **Nothing from this file goes into a commit, a PR, or any external service.**

---

### Task 6: Display, the gap control, print, wiring

**Files:**
- Modify `index.html`:
  - CSS beside `.hd-perkg` (~2194);
  - `__ACT` after `k77` (~3867);
  - `ICON` (~10898);
  - `hdNextDoseHTML` (~8109), plus a new `hdOneTimeHTML` after it;
  - `renderBayesianResults`: `isHD` ~11180, `nextStep` ~11241, `hdView` ~11502, the Show the
    math HD rule ~12016;
  - `_prRecommendation` (~14347).
- Modify `phase2d_validation.cjs`: SUITE 35 test 35.18's regex `hdViewFor\(r\)` (rule 9,
  ledgered).
- Test: SUITE 36.

**Interfaces:**
- Consumes: `hdOneTimeDose` records (Task 3).
- Produces:
  - `hdOneTimeHTML(rec, derated, nowH, print) → string`;
  - `hdNextDoseHTML(rec, derated, nowH, print)` (4th param new);
  - `ICON.check`;
  - `__ACT.k78`.

- [ ] **Step 1: Write the failing tests** (SUITE 36, after 36.12):

```js
  const ot = (over) => Object.assign({ oneTime: true, doseAtH: 20, after: null, gapH: 48, readAtH: 68, plannedCount: 0,
    plannedInWindow: [], missed: null, kind: 'dose', reason: '', mg: 750, tinfH: 1, pre: 17.2, auc24: 430, peak: 31.5,
    table: [{ mg: 0, at: [12, 10, 8.5] }, { mg: 250, at: [15.1, 13, 11] }, { mg: 500, at: [19, 16, 13.4] },
            { mg: 750, at: [22.8, 17.2, 15.9] }, { mg: 1000, at: [26.7, 21.4, 20.3] }] }, over || {});
  test('36.13 the one-time verdict: dose now, assumed gap stated, three gap buttons, the table, the caution', () => {
    const h = sandbox.hdNextDoseHTML(ot(), false, 20);
    assert(/<span class="rec-dose">750 mg<\/span> IV <span class="vx-freq">now · one-time<\/span>/.test(h), h.slice(0, 300));
    assert(/Sized for a pre-HD level of <strong>17\.2 mg\/L<\/strong> if the next HD starts <strong>48 h<\/strong> after this dose/.test(h), 'sized-for line');
    const btns = h.match(/<button[^>]*data-onclick="k78"[^>]*>/g) || [];
    assert(btns.length === 3 && btns.every(b => /type="button"/.test(b)), `three gap buttons: ${btns.length}`);
    assert(/data-arg="48" aria-pressed="true"/.test(h) && /data-arg="72" aria-pressed="false"/.test(h), 'the chosen gap is pressed');
    assert(/class="vx-hd-onetime"/.test(h) && /<tr class="is-pick">/.test(h) && /within 15–20/.test(h), 'table with the pick and screen-reader range text');
    assert(!/[✓✔⚠]/.test(h) && /class="hd-in"/.test(h), 'in-range cells use the drawn check, never a glyph');
    assert(/delayed or cancelled, levels will run higher than shown/.test(h), 'the averaged-model caution');
    assert(/one-time: no schedule logged/.test(h) && !/\bq\d+h\b/.test(h), 'basis line; never a q-interval');
  });
  test('36.14 print shows the gap as text, with no buttons', () => {
    const p = sandbox.hdNextDoseHTML(ot(), false, 20, true);
    assert(!/<button/.test(p) && /assumed gap 48 h/.test(p), p.slice(0, 400));
  });
  test('36.15 a missed post-HD dose is said first, as a caution', () => {
    const h = sandbox.hdNextDoseHTML(ot({ missed: { n: 1, endH: 8 } }), false, 20);
    assert(h.indexOf('No dose entered after session 1') > -1 && h.indexOf('No dose entered after session 1') < h.indexOf('vx-regimen'), 'before the heading');
    assert(/note-caution/.test(h) && /ended 12 h ago/.test(h) && /this answer assumes it was not/.test(h), h.slice(0, 400));
  });
  test('36.16 holds and "after HD" read right, in the neutral heading', () => {
    const now = sandbox.hdNextDoseHTML(ot({ kind: 'hold', reason: 'in', mg: 0, tinfH: 0, pre: 17.6, peak: null }), false, 20);
    assert(/>No dose now</.test(now) && /vx-regimen-hd/.test(now) && !/vx-regimen-hold/.test(now), now.slice(0, 300));
    const after = sandbox.hdNextDoseHTML(ot({ after: 2, doseAtH: 56 }), false, 20);
    assert(/<span class="vx-freq">after HD · one-time<\/span>/.test(after) && /After session 2 ends/.test(after), after.slice(0, 300));
    const holdAfter = sandbox.hdNextDoseHTML(ot({ after: 2, kind: 'hold', reason: 'above', mg: 0, pre: 23, peak: null }), false, 20);
    assert(/>No dose after session 2</.test(holdAfter), holdAfter.slice(0, 200));
    const prov = sandbox.hdNextDoseHTML(ot(), true, 20);
    assert(/rec-derated/.test(prov) && /provisional/.test(prov), 'a provisional fit marks it');
  });
  test('36.17 wiring: k78 sets the gap and re-renders without refitting; screen and print pass the gap; next step and math', () => {
    assert(/k78:[^\n]*bState\.hdGapH = Number\(arg\)[^\n]*renderBayesianResults\(bState\.result/.test(script36), 'k78');
    const rb = bodyOf36('renderBayesianResults');
    assert(/const hdView = hdViewFor\(r, bState\.hdGapH\);/.test(rb) && rb.indexOf('const hdView') < rb.indexOf('const nextStep'), 'the view is read before the next step');
    assert(/hdView\.rec\.oneTime\) return 'Draw a pre-HD level before the next session\. Once the schedule is known, log it and each post-HD dose is sized for you\.'/.test(rb), 'one-time next step');
    assert(/HD rule\.[\s\S]{0,700}closest to \$\{HD_PREDIALYSIS_MID\}/.test(rb) && /one-time/.test(rb.slice(rb.indexOf('HD rule.'), rb.indexOf('HD rule.') + 900)), 'the math states the midpoint and the one-time gap');
    const pr = bodyOf36('_prRecommendation');
    assert(/hdViewFor\(r, bState\.hdGapH\)/.test(pr) && /hdNextDoseHTML\(hv\.rec, !!screen\.provisional, hv\.nowH, true\)/.test(pr), 'print');
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `node phase2d_validation.cjs 2>&1 | grep -E "FAIL.*36\.1[3-7]"`
Expected: 36.13–36.17 FAIL.

- [ ] **Step 3: Implement the icon.** Add to `ICON`, after `info`:

```js
  check:   '<svg class="ic" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.2 8.4 6.6 11.6 12.8 4.6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
```

- [ ] **Step 4: Implement the markup.** In `hdNextDoseHTML`, change the signature to
  `function hdNextDoseHTML(rec, derated, nowH, print)`, and make its first line:

```js
  if (rec && rec.oneTime) return hdOneTimeHTML(rec, derated, nowH, print);
```

  Then add after `hdNextDoseHTML`:

```js
// The one-time HD verdict (D17): no schedule logged, so the dose is sized at an
// assumed gap the clinician can change (k78). On paper the gap is plain text.
function hdOneTimeHTML(rec, derated, nowH, print) {
  const asOf = nowH != null ? ` Read as of ${fmtClock(nowH)}.` : '';
  const range = `${HD_PREDIALYSIS_MIN}–${HD_PREDIALYSIS_MAX}`;
  const where = (pre) => pre < HD_PREDIALYSIS_MIN ? `below ${range}` : pre > HD_PREDIALYSIS_MAX ? `above ${range}` : `within ${range}`;
  const k = rec.plannedCount, ks = `${k} planned dose${k === 1 ? '' : 's'}`;
  const prov = derated ? ' · <span class="vx-prov">provisional</span>' : '';
  const from = rec.after != null ? `session ${rec.after} ends` : 'now';
  const basis = `<p class="vx-hd-basis vx-muted">On the averaged Goti-HD fit (Goti 2018, the dialysis model DoseMeRx also offers); one-time: no schedule logged. Sized to the middle of ${range} mg/L (Rybak 2020 Rec 14).${asOf}</p>`;
  const caution = `<p class="vx-hold vx-muted">The model averages dialysis over time. If the next session is delayed or cancelled, levels will run higher than shown.</p>`;
  const missed = rec.missed ? noteHTML({ tier: 'caution', word: `No dose entered after session ${rec.missed.n}`,
    html: `It ended ${Math.max(1, Math.round(nowH - rec.missed.endH))} h ago. If a dose was given, enter it; this answer assumes it was not.` }) : '';
  const gapCtl = print ? `<span class="hd-gap-text">assumed gap ${rec.gapH} h</span>`
    : `<span class="toggle-group hd-gap" role="group" aria-label="Assumed time to the next session">${HD_ONE_TIME_GAPS_H.map(g =>
        `<button type="button" class="toggle-opt${g === rec.gapH ? ' active' : ''}" data-onclick="k78" data-arg="${g}" aria-pressed="${g === rec.gapH}">${g} h</button>`).join('')}</span>`;
  const gapRow = `<p class="vx-sub hd-gap-row"><span class="vx-k">Next HD in</span> ${gapCtl}</p>`;
  const table = rec.table && rec.table.length ? `
    <table class="ev-table vx-hd-onetime"><caption>Pre-HD level (mg/L) if the next HD starts this long after the dose</caption>
      <thead><tr><th scope="col">Dose</th>${HD_ONE_TIME_GAPS_H.map(g => `<th scope="col">${g} h</th>`).join('')}</tr></thead>
      <tbody>${rec.table.map(row => `<tr${row.mg === rec.mg ? ' class="is-pick"' : ''}><th scope="row">${row.mg ? fmtDose(row.mg) : 'None'}</th>${row.at.map(c => {
        const inR = c >= HD_PREDIALYSIS_MIN && c <= HD_PREDIALYSIS_MAX;
        return `<td>${c.toFixed(1)}${inR ? `<span class="hd-in">${ICON.check}<span class="sr-only"> within ${range}</span></span>` : ''}</td>`;
      }).join('')}</tr>`).join('')}</tbody></table>` : '';
  if (rec.kind === 'planned') return missed + `
    <div class="rec-box vx-rec${derated ? ' rec-derated' : ''}">
      <h3 class="vx-regimen vx-regimen-hd" id="vx-regimen">Planned: ${rec.plannedInWindow.map(d => fmtDose(d.mg)).join(' + ')} · one-time</h3>
      <p class="vx-inf">${rec.plannedInWindow.map(d => `${fmtDose(d.mg)} at ${fmtClock(d.timeH)}`).join(' · ')}${prov}</p>
      <p class="vx-sub">With the ${ks} entered, the fitted level if the next HD starts ${rec.gapH} h after ${from} is <strong>${rec.pre.toFixed(1)} mg/L</strong> — ${where(rec.pre)} mg/L.</p>
      ${gapRow}
      <p class="vx-delta">Edit the planned dose row to test another dose.</p>
    </div>` + caution + basis;
  if (rec.kind === 'hold') {
    const lead = k ? `With the ${ks} entered and no further dose, the` : 'Without a dose, the';
    const tail = rec.reason === 'overshoot'
      ? ` — below ${HD_PREDIALYSIS_MIN}, but every 250 mg step overshoots ${HD_PREDIALYSIS_MAX}. Recheck the level before dosing.`
      : ` — ${where(rec.pre)} mg/L. Recheck the pre-HD level.`;
    return missed + `
      <h3 class="vx-regimen vx-regimen-hd" id="vx-regimen">${rec.after != null ? `No dose after session ${rec.after}` : 'No dose now'}</h3>
      <p class="vx-hold">${lead} fitted level if the next HD starts ${rec.gapH} h after ${from} is ${rec.pre.toFixed(1)} mg/L${tail}</p>
      ${gapRow}` + table + caution + basis;
  }
  return missed + `<div class="rec-box vx-rec${derated ? ' rec-derated' : ''}">
      <h3 class="vx-regimen" id="vx-regimen"><span class="rec-dose">${fmtDose(rec.mg)}</span> IV <span class="vx-freq">${rec.after != null ? 'after HD' : 'now'} · one-time</span></h3>
      <p class="vx-inf">${rec.after != null ? `After session ${rec.after} ends · ` : ''}${fmtClock(rec.doseAtH)} · infuse over ${fmtHrs(rec.tinfH)}${rec.kind === 'closest' ? ' · <span class="vx-prov">closest available</span>' : ''}${prov}</p>
      <p class="vx-sub">Sized for a pre-HD level of <strong>${rec.pre.toFixed(1)} mg/L</strong> if the next HD starts <strong>${rec.gapH} h</strong> after this dose${rec.kind === 'closest' ? ` — no 250 mg step up to ${DOSE_MAX_PER_DOSE_MG} mg lands in ${range}` : ''}.</p>
      ${gapRow}
      <p class="vx-sub"><span class="vx-k">AUC₂₄</span> ${rec.auc24.toFixed(0)} mg·h/L <span class="vx-muted">over the 24 h before it</span>
        <span class="vx-nb"><span class="vx-k">Peak</span> ${rec.peak.toFixed(1)} mg/L</span></p>
      ${k ? `<p class="vx-delta">Includes the ${ks} already entered.</p>` : ''}
    </div>` + table + caution + basis;
}
```

  Test 36.15 asserts `ended 12 h ago`: the fixture has `nowH` 20 and `endH` 8.

- [ ] **Step 5: Implement the CSS.** After the `.hd-perkg` rule:

```css
  .hd-gap-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; }
  .hd-gap.toggle-group { display: inline-flex; }
  .hd-gap .toggle-opt { min-height: 44px; min-width: 56px; font-variant-numeric: tabular-nums; }
  .vx-hd-onetime { margin-top: 10px; }
  .vx-hd-onetime td { font-variant-numeric: tabular-nums; white-space: nowrap; }
  .vx-hd-onetime .hd-in { color: var(--ink); margin-left: 4px; }
  .vx-hd-onetime .hd-in .ic { width: 12px; height: 12px; vertical-align: -1px; }
  .vx-hd-onetime tr.is-pick th, .vx-hd-onetime tr.is-pick td { background: var(--paper-deep); }
  .vx-hd-onetime tr.is-pick th { color: var(--terracotta-ink); font-weight: 600; }
  @media print { .hd-gap { display: none; } }
```

- [ ] **Step 6: Implement the action.** In `__ACT`, after `k77`:

```js
  k78: (el, ev, arg) => { bState.hdGapH = Number(arg); if (bState.result) { renderBayesianResults(bState.result, bState.divergeMsg, bState.levelWarnings, bState.mic, bState.p2c); const b = document.querySelector(`#b-results [data-onclick="k78"][data-arg="${Number(arg)}"]`); if (b) b.focus(); } },   /* HD one-time: assumed gap to the next session (D17) */
```

  - **Not in `bayesInputFingerprint`.** The re-render keeps the stale-inputs state, because
    `renderBayesianResults` compares the fingerprint as before.
  - **Not saved in profiles.**
  - **Resets on Reset:** `resetBayesian` rebuilds `bState` without the field, which means 48.

- [ ] **Step 7: Wire `renderBayesianResults`.**
  1. Directly after `if (r.fitNowH == null) r.fitNowH = Date.now() / 3600000;`, add:

```js
  const hdView = hdViewFor(r, bState.hdGapH);   // D16/D17: read once, before the next step and the verdict
```

  2. Delete the later line `const hdView = hdViewFor(r);` (~11502). Keep the
     `let hdRec = null, hdSentence = '';` that follows it.
  3. In `nextStep`, insert as the first line inside the arrow function:

```js
    if (isHD && hdView && hdView.rec && hdView.rec.oneTime) return 'Draw a pre-HD level before the next session. Once the schedule is known, log it and each post-HD dose is sized for you.';
```

  4. Replace the `hdSentence = hdRec.need ? …` assignment with:

```js
    const otWhen = hdRec.after != null ? `after session ${hdRec.after}` : 'now';
    hdSentence = hdRec.oneTime
      ? (hdRec.kind === 'planned' ? `Planned dose, one-time: fitted ${hdRec.pre.toFixed(1)} mg/L if the next HD starts ${hdRec.gapH} h later.`
        : hdRec.kind === 'hold' ? `No dose ${otWhen}: fitted ${hdRec.pre.toFixed(1)} mg/L if the next HD starts ${hdRec.gapH} h later.`
        : `${fmtDose(hdRec.mg)} IV ${otWhen}, one-time: fitted ${hdRec.pre.toFixed(1)} mg/L if the next HD starts ${hdRec.gapH} h after it.`)
        + (hdRec.missed ? ` No dose entered after session ${hdRec.missed.n}.` : '')
      : hdRec.need ? 'A post-HD dose needs the next two upcoming sessions.'
      : hdRec.kind === 'planned' ? `Planned dose after session ${hdRec.session}: fitted pre-HD ${hdRec.pre.toFixed(1)} mg/L at session ${hdRec.sizing}.`
      : hdRec.kind === 'hold' ? `No dose after session ${hdRec.session}: the fitted pre-HD level at session ${hdRec.sizing} is ${hdRec.pre.toFixed(1)} mg/L.`
      : `${fmtDose(hdRec.mg)} IV after session ${hdRec.session}: fitted pre-HD ${hdRec.pre.toFixed(1)} mg/L at session ${hdRec.sizing}, AUC24 ${hdRec.auc24.toFixed(0)} over the 24 h before it.`;
```

  5. Replace the "Show the math" HD rule `<li>` with:

```js
      ${isHD ? `<li><strong>HD rule.</strong> The dose follows the next session (or one that ended under ${HD_POSTSESSION_DOSE_WINDOW_H} h ago with no dose since) and is sized at the start of the session after it; with no such session logged it is one-time, sized at an assumed ${HD_ONE_TIME_GAPS_H.join(', ')} h gap after the dose (default ${HD_ONE_TIME_GAP_DEFAULT_H} h). On this fit with every dose entered, of no dose and each 250 mg step up to ${DOSE_MAX_PER_DOSE_MG} mg reading ${HD_PREDIALYSIS_MIN}–${HD_PREDIALYSIS_MAX} mg/L (Rybak 2020 Rec 14), the one closest to ${HD_PREDIALYSIS_MID}, ties to the smaller; no dose if every step reads above ${HD_PREDIALYSIS_MAX}; else the step closest to the range, flagged. A planned dose already entered is read, not replaced.</li>` : ''}
```

- [ ] **Step 8: Wire print.** In `_prRecommendation`, change:
  - `const hv = hdViewFor(r);` → `const hv = hdViewFor(r, bState.hdGapH);`
  - `hdNextDoseHTML(hv.rec, !!screen.provisional, hv.nowH)` → `hdNextDoseHTML(hv.rec, !!screen.provisional, hv.nowH, true)`

- [ ] **Step 9: Update 35.18 in the open (rule 9).** Replace `/hdViewFor\(r\)/.test(rb)` with
  `/hdViewFor\(r, bState\.hdGapH\)/.test(rb)`.

  Ledger: `Task 6: rule-9 change 35.18 — the render calls hdViewFor(r, bState.hdGapH) (gap passed explicitly), was hdViewFor(r)`.

- [ ] **Step 10: Run the suite, the syntax check and CSP SUITE 14**

```bash
node -e "const fs=require('fs');const m=fs.readFileSync('index.html','utf8').match(/<script>([\s\S]*?)<\/script>/);try{new Function(m[1]);console.log('JS syntax: OK')}catch(e){console.log('JS BROKEN:',e.message)}"
node phase2d_validation.cjs 2>&1 | grep -E "FAIL|Passed|Failed"
```
Expected: `JS syntax: OK`, `Passed : 368`, `Failed : 0`. That is 351 + 17 new; SUITE 36 runs
36.1–36.17.

- [ ] **Step 11: Commit**

```bash
git add index.html phase2d_validation.cjs
git commit -m "HD: one-time verdict — assumed-gap buttons, the dose × gap table, missed-dose caution, print as text (D17)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Browser checks, parity, full suites, contrast

**Files:**
- Modify: `docs/audit/browser-flows.cjs`, after the Trough-guard `ok(...)` (~465), before
  `attributeInjected(m, …)`.

- [ ] **Step 1: Add the two checks**

```js
  // D17: no session ahead → a one-time answer, the missed post-HD dose flagged; the 72 h
  // button re-sizes it without refitting and keeps keyboard focus.
  await m.locator('[data-onclick="k2"]').tap();
  for (const id of [5, 4, 3, 2]) { const x = m.locator(`[data-onclick="k75"][data-arg="${id}"]`); if (await x.count()) await x.tap(); }
  await m.locator('[data-onclick="k61"][data-arg="4"]').tap();          // the D2 20:00 dose: nothing after session 1 now
  await m.locator('[data-onclick="k46"]').tap();
  const lv = await m.evaluate(() => [...document.querySelectorAll('[id^="b-lvl-conc-"]')].pop().id.split('-').pop());
  await typeInto(m, `#b-lvl-conc-${lv}`, '10.3'); await m.locator(`#b-lvl-date-${lv}`).fill(D2); await typeInto(m, `#b-lvl-time-${lv}`, '23:30');
  await m.locator('[data-onclick="k47"]').tap();
  await m.waitForFunction(() => /one-time|No dose now/.test((document.getElementById('vx-regimen') || {}).textContent || ''), null, { timeout: 20000 });
  await m.waitForTimeout(300);
  const ot = await m.evaluate(() => ({ head: document.getElementById('vx-regimen').textContent.replace(/\s+/g, ' ').trim(),
    missed: /No dose entered after session 1/.test(document.querySelector('.vx-verdict').textContent),
    btns: [...document.querySelectorAll('#b-results [data-onclick="k78"]')].map(b => b.dataset.arg + ':' + b.getAttribute('aria-pressed')),
    sw: document.documentElement.scrollWidth, iw: innerWidth }));
  ok('HD one-time: no session ahead → a one-time answer, the missed post-HD dose flagged, fits 375 px',
     /one-time|No dose now/.test(ot.head) && ot.missed && ot.btns.join() === '24:false,48:true,72:false' && ot.sw <= ot.iw, JSON.stringify(ot));
  await m.evaluate(() => { const el = document.querySelector('#b-results .vx-top'); window.scrollTo({ top: window.scrollY + el.getBoundingClientRect().top - 64, behavior: 'instant' }); });
  await m.waitForTimeout(250);
  await m.screenshot({ path: path.join(OUT, 'mobile-hd-onetime.png') });
  await m.locator('#b-results [data-onclick="k78"][data-arg="72"]').focus();
  await m.keyboard.press('Enter');
  await m.waitForFunction(() => /72 h/.test((document.querySelector('.vx-verdict') || {}).textContent || ''), null, { timeout: 5000 });
  const ot72 = await m.evaluate(() => ({ said: /starts (<strong>)?72 h|starts 72 h|72 h after/.test(document.querySelector('.vx-verdict').innerHTML),
    pressed: document.querySelector('#b-results [data-onclick="k78"][data-arg="72"]').getAttribute('aria-pressed'),
    focus: document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.arg : null }));
  ok('HD one-time: the 72 h button re-sizes for 72 h without refitting, and keeps focus',
     ot72.said && ot72.pressed === 'true' && ot72.focus === '72', JSON.stringify(ot72));
```

- [ ] **Step 2: Run the browser checks under the production CSP**

```bash
python3 docs/audit/serve-csp.py > /tmp/csp.log 2>&1 &
sleep 1; PLAYWRIGHT=/Users/olaiya/Projects-Local/Pharmacy/node_modules/playwright node docs/audit/browser-flows.cjs | tail -3
```
Expected: `61/61 checks pass; 0 console problem(s)`.
- On a failure, read the JSON detail and the screenshot in `OUT`.
- Fix the code, not the check, unless the check itself mis-targets a selector. That is a
  ledgered ruling.

- [ ] **Step 3: Engine parity and the other suites**

```bash
node docs/audit/engine-parity.cjs --ref 9710104 | tail -3
node phase3_simulation.cjs 2>&1 | tail -3
node phase4_regimen_validation.cjs 2>&1 | tail -3
```
Expected: `0 differences` (the battery predates HD dosing), 21/21, 49/49.
- If parity lists `hdNextDose` calls, every difference must be the midpoint pick. Ledger them.
- Anything else is a regression.

- [ ] **Step 4: Rendered contrast in both themes and on the phone.** Copy the D16 probe and
  point it at the one-time path:

```bash
S=/private/tmp/claude-501/-Users-olaiya-Projects-Local-Pharmacy-Vancomycin-/97db9c82-2ba8-44f0-990f-9a5f5d5c7a92/scratchpad
mkdir -p $S/d17 && cp $S/d16/probe.cjs $S/d17/probe.cjs
```

  In `$S/d17/probe.cjs`:
  - delete the seven lines from `await page.evaluate(() => { document.querySelector('.hd-sched').open = true; });`
    through `await page.locator('[data-onclick="k76"]').click();`, so session 1 is the only one
    logged and the level drives a one-time answer with a missed-dose flag;
  - rename the shot `tag + '-dose'` to `tag + '-onetime'`.

  Then:

```bash
node $S/d17/probe.cjs $S/d17
```
Expected, per theme and viewport:
- `aa: 0` (no text under 4.5:1, or under 3:1 when large);
- `sw` equal to `[375,375]` on the phone;
- `problems []`;
- `dose` lines contain `one-time` and the missed-dose word.

Read the three `*-onetime.png` screenshots.

- [ ] **Step 5: Commit**

```bash
git add docs/audit/browser-flows.cjs
git commit -m "browser-flows: the one-time HD answer on a phone, and the gap buttons by keyboard (D17)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Records

**Files:**
- Modify: `docs/v3-decisions.md` (new `## D17` before `## Known gaps`)
- Modify: `CLAUDE.md`, `DESIGN.md`, `README.md`
- Modify: `../Literature/Sources.md` (outside the repo)
- Modify: the memory file `vanco-hd-sessions-gate.md` (one line on D17)

- [ ] **Step 1: D17 in `docs/v3-decisions.md`.** Add the section
  `## D17 — One-time dose when the HD schedule is unknown; the midpoint pick (2026-10-02)`.
  It must contain:
  - **The gap:** the problem (`need: 'sessions'`, the handoff case), the decision and the
    24/48/72 gap (PREFERENCE).
  - **The midpoint pick:** why, the VancoPK arithmetic (15 → AUC ≈ 380), and the user's choice.
  - **Declined:** the rebound estimate, PTA, a new confidence grade, and the tl;dr table, with
    its citation and reasons.
  - **Every rule-9 SUITE 35 change**, `old → new`, copied from the ledger.
  - **The VancoPK cross-check:** its summary line from Task 4, and the explanation of the
    direction.
  - **The MHHS cross-check, in general terms only.**
  - **The version table** from the spec, and the version rule.
  - **"Not clinically validated on local HD patients."**

- [ ] **Step 2: `CLAUDE.md`**
  - **The HD dosing paragraph:** append "D17: with fewer than two upcoming sessions the answer
    is a one-time dose at an assumed 24/48/72 h gap (default 48), with a missed post-HD dose
    flagged; both HD answers pick the in-range step closest to 17.5 mg/L."
  - **Counts:** phase2d **368/368**, browser-flows **61/61**.
  - **Version rule:** under "Testing" add "**Version.** `APP_VERSION` (and the header and print
    markup, SUITE 36.1) is bumped every release: minor for a clinical behaviour change or
    feature, patch for fixes. The history table lives in the README."
  - **Where things are:** add `docs/audit/probe-hd-one-time.cjs`.

- [ ] **Step 3: `DESIGN.md`.** Add under the HD verdict notes: the gap control reuses
  `.toggle-opt` / `.active` (selection = background step + terracotta ink); the
  `.vx-hd-onetime` table marks in-range cells with the drawn `ICON.check` plus screen-reader
  text; the chosen row takes `--paper-deep` with a `--terracotta-ink` row head; print states the
  gap as text.

- [ ] **Step 4: `README.md`.** Change the status line to `**Status: Live · v3.6.0**`. Add a
  `## Version history` section with the table from the spec, 3.0 → 3.6.0, and the one-line
  scheme.

- [ ] **Step 5: `Literature/Sources.md`** (outside the repo). Add:
  - **VancoPK HD method:** vancopk.com Intermittent Hemodialysis calculator; Ke 0.005 h⁻¹ and
    30–40% high-flux removal per the site's kinetics review; saved copy
    `VancoPK_source_2026-09-05.html`; used only in `docs/audit/probe-hd-one-time.cjs`.
  - **tl;dr pharmacy:** Kujawski S. "Vancomycin Dosing in Hemodialysis." tl;dr pharmacy,
    2019-03-25. https://www.tldrpharmacy.com/content/vancomycin-dosing-in-hemodialysis —
    considered, not adopted (D17).

- [ ] **Step 6: Commit (repo files only)**

```bash
git add docs/v3-decisions.md CLAUDE.md DESIGN.md README.md
git commit -m "Records: D17, version history 3.0 → 3.6.0, counts 368 / 61

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Final review, merge, tag

- [ ] **Step 1: The whole-branch review.** Use the executing-plans "Final Review" procedure
  with `MERGE_BASE=$(git merge-base main HEAD)`, on the most capable model. Include this plan's
  Review Focus verbatim.

- [ ] **Step 2: One fix pass.** Each Critical or Important finding gets a RED → GREEN test, and
  the full suite runs green afterwards.

- [ ] **Step 3: Finish.** Use superpowers:finishing-a-development-branch: present the menu and
  run the user's choice. On a local merge:

```bash
git switch main && git merge --no-ff hd-one-time-dose -m "Merge D17: one-time HD dose, midpoint pick, v3.6.0"
node phase2d_validation.cjs 2>&1 | tail -3
git tag -a v3.6.0 -m "Vancomycin TDM 3.6.0 — one-time HD dose (D17)"
git push origin main && git push origin v3.6.0
git branch -d hd-one-time-dose
```
Expected: 368/368 on main; push accepted.

---

### Task 10: Hub release (the user merges)

**Repo:** `~/Projects-Local/AinaDara.com/repos/pharmacy-ainadara`

- [ ] **Step 1: Branch, copy, repin**

```bash
cd ~/Projects-Local/AinaDara.com/repos/pharmacy-ainadara
git switch main && git pull --ff-only && git switch -c vanco/hd-one-time
cp "/Users/olaiya/Projects-Local/Pharmacy/Vancomycin /AinaDaraTDM/index.html" public/vancomycin/index.html
NEW=$(python3 -c "import re,hashlib,base64;s=open('public/vancomycin/index.html',encoding='utf-8').read();m=re.search(r'<script>([\s\S]*?)</script>',s);print('sha256-'+base64.b64encode(hashlib.sha256(m.group(1).encode()).digest()).decode())")
OLD='sha256-RSC6j6VhZzwM808CfXGeH6cBlZToM7c/DQLA16hKgSM='
grep -c "$OLD" public/_headers   # expect 2
python3 - "$OLD" "$NEW" <<'EOF'
import sys; p='public/_headers'; s=open(p).read(); o,n=sys.argv[1],sys.argv[2]
assert s.count(o)==2, s.count(o); open(p,'w').write(s.replace(o,n)); print('repinned', n)
EOF
```

- [ ] **Step 2: The how-to and the build log**
  - **`src/pages/vancomycin/how-to.astro`:** in the haemodialysis section, add a paragraph
    "When the schedule is unknown". It covers the one-time dose, the 24/48/72 h buttons
    (default 48), the missed-dose caution and the averaged-model caution. Add one line stating
    that both HD answers aim for the middle of 15–20 mg/L.
  - **`docs/wiki/10-build-log.md`:** append a dated entry headed **Vancomycin TDM v3.6.0 —
    one-time HD dose (D17)**. It holds:
    - what shipped;
    - the midpoint change;
    - the VancoPK cross-check summary;
    - the counts (368 / 61, parity 0);
    - the new CSP hash;
    - the version scheme.

- [ ] **Step 3: Check, test, build, and run the browser checks against dist under its headers**

```bash
npm run check && npm test 2>&1 | tail -3 && npm run build 2>&1 | tail -2
python3 /private/tmp/claude-501/-Users-olaiya-Projects-Local-Pharmacy-Vancomycin-/97db9c82-2ba8-44f0-990f-9a5f5d5c7a92/scratchpad/csptest/serve_dist.py > /tmp/dist.log 2>&1 &
sleep 1; cd "/Users/olaiya/Projects-Local/Pharmacy/Vancomycin /AinaDaraTDM" && BASE=http://localhost:8778/vancomycin/ PLAYWRIGHT=/Users/olaiya/Projects-Local/Pharmacy/node_modules/playwright node docs/audit/browser-flows.cjs | tail -2
```
Expected: check clean, 655 tests pass, the build succeeds, and `61/61 checks pass; 0 console
problem(s)`.

- [ ] **Step 4: Commit, push, PR, bind**

```bash
cd ~/Projects-Local/AinaDara.com/repos/pharmacy-ainadara
git add public/vancomycin/index.html public/_headers src/pages/vancomycin/how-to.astro docs/wiki/10-build-log.md
git commit -m "Vancomycin TDM v3.6.0: one-time HD dose when the schedule is unknown (D17)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -u origin vanco/hd-one-time
gh pr create --repo refinalophaina-jpg/pharmacy-ainadara --title "Vancomycin TDM v3.6.0: one-time HD dose (D17)" --body "<summary, verification, new CSP hash>

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

  Then `mcp__ccd_pr__get_status`, `bind_pr` if needed, and read CI.

- [ ] **Step 5: Hand over.**
  - **The user merges:** give the user the `gh pr merge <n> --repo refinalophaina-jpg/pharmacy-ainadara --merge --delete-branch`
    line.
  - **For Codex:** a one-line note that the ainadara.com project card's version string, if any,
    should read v3.6.0.

- [ ] **Step 6: After the user merges, verify production.**
  - The live HTML, minus the Cloudflare injection
    (`<script>\(function\(\)\{function c\(\)\{.*?</script>`), must equal
    `git show v3.6.0:index.html`.
  - The live CSP must carry the new hash.
  - Run
    `BASE=https://pharmacy.ainadara.com/vancomycin/ PLAYWRIGHT=… node docs/audit/browser-flows.cjs`.
    Expected: 61/61, with the Cloudflare-injected scripts refused as designed.
  - Sync the hub checkout to merged main.

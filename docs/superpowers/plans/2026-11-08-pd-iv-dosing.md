# IV Vancomycin on Peritoneal Dialysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A level-based fifth Trough-module mode, "Peritoneal dialysis". For an IV vancomycin
patient on PD (or whose PD has stopped), it says what dose to give, whether to give it today, and
when to draw the next level, from the patient's own levels and cycler schedule.

**Architecture:**
- Pure engine functions (`pd*`) beside the existing PK helpers. They are tested in the Node harness
  and reuse `predictConc1comp`, `roundDose250`, `calcVd('bauer')` and `DOSE_MAX_PER_DOSE_MG`.
- One orchestrator, `pdAnswer(input, nowH)`, returns a plain answer object.
- The UI renders that object into `#results-content` and an SVG chart.
- AUC Precision gains a PD box that refuses and points here.

**Tech Stack:** vanilla JS in `index.html`; Node `vm` harness (`phase2d_validation.cjs`,
`harness_constants.cjs`); Playwright browser flows under the production CSP.

**Spec:** `docs/superpowers/specs/2026-11-08-pd-iv-dosing-design.md` (D23, including the
builder-check answers at the end).

## Global Constraints

- **Rule 1:** every shipped number carries a source comment.
  - 0.70 L/kg: Bauer, existing.
  - 0.90 L/kg: Matzke 1984 group III, CrCl < 10, n = 36.
  - 11.6 h and 62.8 h: Manley 2001, *Perit Dial Int*.
  - 66–115 h: Lam 2020, *Perit Dial Int*.
  - 20 mg/kg: institutional convention, Northwestern Medicine 2026; ISPD 2022 gives no IV dose.
  - 3,000 mg load cap: Rybak 2020 Rec 11, the existing `HD_LOADING_MAX_MG`.
  - Goal presets 10–15 and 15–20: Rybak 2009.
- **Rule 8:** `PD_EARLY_LEVEL_H = 24`, the midpoint pick and the AM-labs default are PREFERENCES and
  say so.
- **Rule 6:** every new constant the tests read goes through `harness_constants.cjs`.
- **No workplace content and no real patient** in the repo. Fixtures are fictional.
- **Behaviour rules:**
  - no goal, no answer;
  - published APD/CAPD values never drive a dose;
  - no IP vancomycin;
  - no AUC or Bayesian output for PD.
- **CSP:** no inline handlers. New handlers continue the `__ACT` registry from **k84**. Canvas is not
  used; the chart is SVG coloured by CSS tokens.
- **Time:** 24-hour time fields (`data-time24`, `isClock24`), dates as `YYYY-MM-DD`, wall-clock
  sessions built with `Date#setHours` (DST-safe, the SUITE 19 spirit). Instants are hours since the
  epoch (`Date.getTime()/3600000`), as in the AUC course.
- **Release:** v3.12.0 (minor); `APP_VERSION`, header and print header (SUITE 36). Engine parity is
  0 against v3.11.0.

## Review Focus

1. A level drawn **before** the first IV dose, when there was prior vancomycin. It must become the
   anchor, not be ignored or read as an interval → test 41.3.
2. Rows **out of order**, or a level at the **same instant** as a dose start. Rows are sorted by time;
   a level inside an infusion is refused with a message → test 41.4.
3. A **held night** on the morning of a draw, and a **DST change** across the projection. Sessions
   and AM labs stay on wall-clock times → test 41.6.
4. **Goal min ≥ max**, or missing weight now: a refusal naming the field, never NaN → test 41.8.
5. **PD stopped** with only pre-stop intervals. They are used, but flagged `before-stop` with a
   caution, until a post-stop interval exists → test 41.5.

---

### Task 1: Schedule and per-interval decline (engine)

**Files:**
- Modify: `index.html`. Add a "Peritoneal dialysis (D23)" block after `hdViewFor` (~line 8355).
- Modify: `harness_constants.cjs`. Add `PD_LOAD_MG_PER_KG`, `PD_EARLY_LEVEL_H`, `PD_APD_T12_ON_H`,
  `PD_APD_T12_OFF_H`, `MATZKE_VD_GROUP3`.
- Test: `phase2d_validation.cjs`, new `SUITE 41` before SUMMARY.

**Interfaces:**
- Produces:
  - `pdSessions(schedule, fromH, toH) -> [{startH, endH, dateKey}]`
    - Cycler sessions for `ccpd` and `nipd` only.
    - Each runs from `dateKey` at `schedule.startClock` for `schedule.hours`.
    - Omitted: held nights (`schedule.heldDates` holds `dateKey`s) and sessions that start at or
      after `schedule.stoppedAtH`.
    - `capd` and `stopped` give `[]`.
  - `pdIntervals(course) -> [Interval]`
    - `course = { doses:[{mg,tinfH,timeH}], levels:[{conc,timeH}], loadKg, nowKg, vdPerKg, prior:'no'|'yes'|'unknown', schedule }`
    - `schedule = { modality:'ccpd'|'nipd'|'capd'|'stopped', startClock:'HH:MM', hours, heldDates:[], stoppedAtH }`
    - `Interval = { fromH, toH, anchor:'dose'|'level', k|null, t12|null, hours, nightsDone, nightsHeld, flags:[...], used }`
    - Flags come from `'early'|'on-cycler'|'held-night'|'before-stop'|'unexplained-high'|'unexplained-low'|'prior-drug'`.
    - `unexplained-*` and `prior-drug` intervals have `k:null` and `used:false`.

- [ ] **Step 1: Write the failing tests (41.1–41.6)**

```js
// Fictional CCPD patient, 21:00 x 10 h. Times in hours via a fixed local date helper H(dayOffset, 'HH:MM').
test('41.1 sessions: one per night from the start clock, held nights and post-stop nights omitted; CAPD and stopped have none', ...
  // pdSessions({modality:'ccpd',startClock:'21:00',hours:10,heldDates:[day1],stoppedAtH:null}, H(0,'00:00'), H(3,'00:00'))
  //   -> 2 sessions (nights of day0 and day2), each endH - startH === 10
  // nipd identical; capd and stopped -> []
  // stoppedAtH = H(1,'12:00') -> only the day0 session
test('41.2 one interval from a naive load: k solves the measured level with V = vdPerKg x loadKg', ...
  // 1000 mg over 1 h at H(0,'03:30'), level 13.0 at H(2,'05:45'), loadKg 60, vdPerKg 0.70
  // expect anchor 'dose', used true, |predictConc1comp(doses, toH, k, 42) - 13.0| < 1e-6,
  //   t12 === ln2/k, nightsDone === 2 for a 21:00 x 10 h CCPD
test('41.3 prior vancomycin: the first dose is not an anchor; a level drawn before the first IV dose is', ...
  // prior 'unknown', level 11 at H(0,'06:00'), 750 mg at H(0,'09:00'), level 13 at H(1,'06:30')
  //   -> one interval, anchor 'level', fromH H(0,'06:00'), used true
  // prior 'yes', no pre-dose level -> one interval flagged 'prior-drug', used false, k null
test('41.4 flags: early (< PD_EARLY_LEVEL_H after a dose ended), on-cycler, held-night; a level inside an infusion is refused', ...
  // level 20 h after the end of a redose -> 'early', still used
  // level at 02:00 during the 21:00-07:00 session -> 'on-cycler'
  // a heldDates entry between anchor and level -> 'held-night', nightsHeld 1
  // rows given out of order are sorted; a level between dose start and end throws Error(/during the infusion/)
test('41.5 unexplained levels name the volume; PD-stopped intervals are flagged before-stop', ...
  // level 30 after 1000 mg at V 42 L (max possible ~23.8) -> 'unexplained-high', used false
  // modality 'stopped', stoppedAtH between two intervals -> the earlier one flagged 'before-stop'
test('41.6 DST: sessions keep their wall-clock start across 1 Nov 2026', ...
  // ccpd 21:00 x 9 h, nights of 31 Oct and 1 Nov 2026 -> both starts read 21:00 local (localTimeStr)
```

The tests compute expectations from `predictConc1comp` and closed forms. No hand-copied constants
(rule 6): `K41 = require('./harness_constants.cjs').extract()`.

- [ ] **Step 2: Run** `node phase2d_validation.cjs` and check that 41.1–41.6 fail with
  "sandbox.pdSessions is not a function".
- [ ] **Step 3: Implement** `pdSessions` and `pdIntervals` and the five constants, with source
  comments.
  - **Solving k:** bisection on `k ∈ [1e-4, 0.35] h⁻¹`.
  - **What it predicts:** `anchorConc·e^{−k(t−ta)} + predictConc1comp(dosesAfterAnchor, t, k, V)`.
    For a dose anchor, `anchorConc = 0` and every dose since the start counts.
  - **Monotonicity:** the prediction falls as k rises.
    - If the prediction at k_min is still below the level, flag `unexplained-high`.
    - If the prediction at k_max is still above it, flag `unexplained-low`.
  - **V:** `vdPerKg × loadKg` (falling back to `nowKg`).
  - **Matzke group III:** add `MATZKE_VD_GROUP3 = 0.90` next to `MATZKE_VD_POOLED`, quoting group III
    from the existing `calcVd` comment.
- [ ] **Step 4: Run** `node phase2d_validation.cjs`. Expect 41.1–41.6 to pass and the rest to stay
  413 green.
- [ ] **Step 5: Commit:** "PD engine: cycler sessions and per-interval decline (D23)".

### Task 2: The answer (engine)

**Files:**
- Modify: `index.html`, in the same PD block.
- Test: `phase2d_validation.cjs`, SUITE 41.

**Interfaces:**
- Consumes: `pdSessions`, `pdIntervals` from Task 1.
- Produces: `pdAnswer(input, nowH) -> Answer`.
  - **`input`:** `course` from Task 1, plus:
    - `goal:{min,max}|null`;
    - `urine:'anuric'|'lt100'|'100to500'|'gt500'`;
    - `ipToo:boolean`;
    - `giveAtH|null`;
    - `settings:{maxDoseMg|null, targetPeak|null, amLabs:'HH:MM'}`.
  - **`Answer.state`** is one of `'refuse'`, `'load'`, `'first-level'`, `'need-level'`, `'dose'`,
    `'no-dose'`. Each carries its fields:
    - `refuse:{word, html}`;
    - `load:{mg, mgPerKg, capped, firstLevelH}`;
    - `nextDrawH`;
    - `rows:[{mg, peak:[lo,hi], atDraw:[lo,hi], mid}]`;
    - `pick:{mg}|null`;
    - `targetPeak:{mg, atDraw:[lo,hi]}|null`;
    - `rate:{kMin, kMax, n}`;
    - `intervals`;
    - `context:{dailyFactor|null, t12Range|null, label}`;
    - `cautions:[{tier, word, html}]`.
  - **Helpers, also exported:**
    - `pdLoadingDose(kg, capMg)`;
    - `pdNextAmLabs(afterH, amLabs)` (the next calendar day's AM-labs instant);
    - `pdPublishedContext(schedule)`.

- [ ] **Step 1: Write the failing tests (41.7–41.12)**

```js
test('41.7 load: 20 mg/kg x weight now, rounded to 250, capped (3000, or a lower local max); first level the AM-labs morning nearest 48 h', ...
  // 57 kg -> 1250 (1140 rounds to 1250); 160 kg -> 3000 capped; settings.maxDoseMg 2500 -> 2500 capped
  // load at H(0,'03:30'), amLabs '06:00' -> firstLevelH === H(2,'06:00'); urine 'gt500' -> a caution suggesting 24-48 h
test('41.8 refusals: no goal; goal min >= max; no weight now; ipToo; HD; prior yes/unknown with no level', ...
  // each -> state 'refuse' with a word naming the cause; never NaN anywhere in the answer
test('41.9 projection range from the used intervals; one interval says so', ...
  // two used intervals with k 0.0132 and 0.0231 -> rate {kMin:0.0132,kMax:0.0231,n:2}
  // no-dose row atDraw = [last*e^{-kMax*dt}, last*e^{-kMin*dt}] within 1e-9
test('41.10 recommendation: within -> no dose; below -> the step whose midpoint is in the goal and closest to its middle, ties smaller; above -> no dose, draw when it reaches the top; unreachable -> closest step flagged', ...
  // fictional: last level 15.6, kMin 0.0132, kMax 0.0231, V 42.2, goal 10-15, draw 24 h on -> 'no-dose' (mid ~10.2)
  // same with goal 15-20 -> 'dose', pick 500 (mid of 500 row closest to 17.5)
  // rows stop at min(DOSE_MAX_PER_DOSE_MG, settings.maxDoseMg)
test('41.11 the target-peak reading appears only when a local target is set: V x (P - C at give), rounded', ...
  // targetPeak 25, C at give 15.0, V 42.2 -> mg 500 (396.7 -> 500); targetPeak null -> answer.targetPeak === null
test('41.12 published context: CCPD/NIPD daily factor from 11.6/62.8 h and the cycler hours; CAPD 66-115 h; stopped none; never used in rows', ...
  // ccpd 10 h -> dailyFactor === exp(-(ln2/11.6*10 + ln2/62.8*14)); changing it does not change rows
```

- [ ] **Step 2: Run** and check that 41.7–41.12 fail with "pdAnswer is not a function".
- [ ] **Step 3: Implement** `pdAnswer` and its helpers.
  - **Each row** comes from `predictConc1comp` with V = `vdPerKg × nowKg`. The latest level is
    carried forward, and the candidate dose is placed at `giveAtH ?? nowH`.
  - **The pick rule** follows `hdPickDose`'s idea (closest to the middle, ties smaller) but judges
    on each row's `mid`.
  - **Rows past the cap** are not offered.
  - **State order:** refusals first; no doses → `load`; doses but no used interval → `first-level`
    (or `need-level`); otherwise `dose` / `no-dose`.
- [ ] **Step 4: Run.** Expect all of SUITE 41 to pass and 413 to stay green.
- [ ] **Step 5: Commit:** "PD engine: the answer — load, rows, pick, next draw (D23)".

### Task 3: The PD mode's inputs

**Files:**
- Modify: `index.html`.
  - Markup: a fifth button `mode-btn-pd` (k84) beside `mode-btn-randomlevel`.
  - Markup: a `section-pd` after `section-randomlevel`.
  - `setCalcMode` gains the `pd` row (button, section, hint).
  - The `__ACT` entries.
- Test: `phase2d_validation.cjs`, 41.13; `docs/audit/browser-flows.cjs`.

**Interfaces:**
- Produces:
  - `readPdForm() -> input` for `pdAnswer`, or `{errors:[...]}`.
  - Element ids:
    - `pd-modality` (select: ccpd/nipd/capd/stopped);
    - `pd-start` (`data-time24`), `pd-hours`, `pd-exchanges`, `pd-fill`;
    - `pd-stopped-date`, `pd-stopped-time`;
    - `pd-prior` (select);
    - `pd-urine` (select);
    - `pd-load-kg`;
    - `pd-goal-min`, `pd-goal-max`, preset buttons (k85 `data-arg="10|15"` / `"15|20"`);
    - `pd-vd` (select: 0.70 / 0.90);
    - `pd-ip` (checkbox);
    - dose rows `pd-dose-{date,time,mg,tinf}-N` (add k86, remove k87);
    - level rows `pd-lvl-{date,time,conc}-N` (add k88, remove k89);
    - held nights `pd-held-N` (add k90, remove k91);
    - an optional "give at" date and time, `pd-give-date` / `pd-give-time` (blank means now);
    - local settings in a `<details>` "Your settings (this browser)": `pd-set-max`, `pd-set-peak`,
      `pd-set-amlabs`, saved on change (k92) to `localStorage['vanco.pd.local']`, with every
      access in try/catch.
- Weight now is the existing `tbw` field. The PD mode skips age, height and SCr validation:
  `calculate()` branches before `validateFields` when `state.calcMode === 'pd'`.

- [ ] **Step 1: Write the failing test (41.13).** Assert in the source that:
  - the `pd` mode button and `section-pd` exist;
  - `setCalcMode` toggles them;
  - k84–k92 exist;
  - the local settings key is read inside try/catch;
  - `calculate` checks `state.calcMode === 'pd'` before `validateFields`.
- [ ] **Step 2: Run** and check that it fails.
- [ ] **Step 3: Implement** the markup in the Trough panel's existing grammar (`form-h2`,
  `field-group`, `input-row`, `unit-badge`, `toggle-opt`, `calc-mode-btn`), and `readPdForm`.
  - Dates and times become hours via `new Date(\`${d}T${t}\`).getTime()/3600000`.
  - Blank or invalid fields are collected as errors with their ids, for `reportValidation`.
- [ ] **Step 4: Run.** Expect 41.13 to pass.
- [ ] **Step 5: Commit:** "PD mode: inputs (D23)".

### Task 4: The answer on screen, the chart, print and copy

**Files:**
- Modify: `index.html`. `calculate()` gains a PD branch that calls `renderPdResults(answer)`, plus
  CSS for `.pd-*`.
- Test: 41.14; browser flows.

**Interfaces:**
- Consumes: `pdAnswer`, `readPdForm`.
- Produces:
  - `renderPdResults(answer) -> void`, which fills `#results-content` with a `.tx-result`.
  - `pdChartSVG(answer, course) -> string`.
  - `pdSummaryText(answer) -> string`, stored as `state.pdSummary` for Copy summary.

- [ ] **Step 1: Write the failing test (41.14)** on string output:
  - `pdChartSVG` draws one `rect.pd-cycler` per session, `circle.pd-lv` per level, and a
    `path.pd-band` for the projection range, using CSS classes only, with no colour literals;
  - `renderPdResults` puts the verdict first, then the next-draw line, the options table (the
    recommended row marked `is-rec`, the target-peak row if set), the decline table with each
    flag's words, the published context labelled "published APD/CAPD values (context only)", and
    the cautions through `noteHTML`;
  - every user value passes through `escHtml`.
- [ ] **Step 2: Run** and check that it fails.
- [ ] **Step 3: Implement.**
  - The chart uses the course strip's idiom: SVG, x on clock time, y in mg/L, the goal band, the
    cycler sessions as a neutral band (as `rect.hd`), a dashed "now", levels as dots
    (`--series-measured`), and the projection range in `--series-projection`.
  - **Print:** the result is a `.tx-result`, which the Trough print path already copies; confirm
    it prints.
  - **Copy summary:** the existing Trough copy path, or `copyResultSummary` reading
    `state.pdSummary` when the PD mode is active.
- [ ] **Step 4: Run.** Expect 41.14 to pass, then do a manual browser check under `serve-csp.py`.
- [ ] **Step 5: Commit:** "PD mode: the answer, chart, print and copy (D23)".

### Task 5: AUC Precision refuses PD; profiles carry PD

**Files:**
- Modify: `index.html`.
  - A `b-pd` checkbox in the AUC renal area.
  - `runBayesian` refuses when it is ticked, with `bayesPdNoticeHTML()` and k93, which runs
    `switchModule('trough'); setCalcMode('pd')`.
  - The severe-renal advisory line (`If patient is actually on RRT (HD/CRRT/PD)…`, ~12030) loses PD
    and gains "for PD use Trough-based · Peritoneal dialysis".
  - `snapshotBayesForm` / `loadProfileIntoForm` carry a `pd` block, `snapshotPdForm()` /
    `applyPdForm(pd)`. Loading a profile with a `pd` block ticks `b-pd`.
- Test: 41.15; browser flows.

**Interfaces:**
- Produces: `snapshotPdForm() -> object`, `applyPdForm(obj) -> void`, `bayesPdNoticeHTML() -> string`.

- [ ] **Step 1: Write the failing test (41.15).** Check that:
  - `runBayesian` checks `b-pd` before fitting;
  - the advisory no longer names PD with Goti;
  - the profile snapshot carries `pd` and loading ticks `b-pd`;
  - `PROFILE_SCHEMA` is unchanged if older profiles load with no `pd`.
- [ ] **Step 2: Run** and check that it fails.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expect 41.15 to pass. Also run `node docs/audit/engine-parity.cjs --ref v3.11.0`
  and expect 0 differences.
- [ ] **Step 5: Commit:** "AUC Precision refuses PD and points to the PD mode; profiles carry PD (D23)".

### Task 6: Release

**Files:**
- Modify:
  - `index.html`: version 3.12.0;
  - `docs/audit/browser-flows.cjs`;
  - `docs/v3-decisions.md`: D23;
  - `CLAUDE.md`: architecture, "Not implemented" (IP dosing for PD stays), counts;
  - `README.md`: the version row;
  - `DESIGN.md`: the PD verdict and the cycler band.
- Hub: `public/vancomycin/index.html`, `public/_headers`, `src/pages/vancomycin/how-to.astro`
  ("Patients on peritoneal dialysis"), `docs/wiki/10-build-log.md`.

- [ ] **Step 1: Browser flows.** Type in a fictional CCPD patient on desktop:
  - 63 kg now, 61 kg at the load, CCPD 21:00 × 9.5 h, prior "No", urine "anuric", goal preset
    10–15;
  - load 1250 mg at day −3 04:10; level 12.4 at day −1 06:00; 500 mg at day −1 09:00; level 14.8
    at day 0 06:30.
  - **Check:**
    - the verdict and the next-draw line;
    - an `early` flag on the second interval;
    - options with the recommended row;
    - the cycler bands in the chart;
    - the weight-change caution;
    - print shows the result.
  - **Then:** set the preset to 15–20 and check that a dose is recommended. Tick IP and check the
    refusal.
  - **AUC Precision:** tick PD, check the refusal, and check that its link opens the PD mode.
  - **On a 375 px phone:** no overflow.
- [ ] **Step 2: Version 3.12.0.** Run the full gate:
  - phase2d, phase3 21/21, phase4 49/49;
  - parity 0 against v3.11.0;
  - browser flows all green;
  - rendered contrast of the new text, light and dark.
- [ ] **Step 3: Records.** D23, CLAUDE.md, README, DESIGN.md. Commit.
- [ ] **Step 4: Final review** by a fresh reviewer on the most capable model. Fix Important findings
  test-first.
- [ ] **Step 5: Merge.** Merge to main, tag v3.12.0. Hub branch: copy, repin CSP, how-to, build log,
  check/test/build, flows against dist. Open the PR; the user merges; then verify live.

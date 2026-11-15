# Review Fixes and Dialysis Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the held v3.14.0 with the safety and logic defects the 2026-11-13 whole-calculator review found, then the test, UI and Hughes fixes, then guarded dialysis support (CRRT, hybrid, a level-based haemodialysis reading).

**Architecture:** Single-file app (`index.html`, one inline script, no build step). Every change is test-first in `phase2d_validation.cjs` and, for anything a clinician clicks, in `docs/audit/browser-flows.cjs` under the production CSP. Three releases, each with its own decision record, fresh review and hub pull request that the user merges.

**Tech stack:** Vanilla JS; Node `vm` harness (`harness_constants.cjs`); Playwright for browser flows (not a dependency of this repo).

**Spec:** the four review reports in `docs/review/2026-11-13/` (engine, code, models, ui) and decision records D25 onward in `docs/v3-decisions.md`. For Release 3: the dialysis research report, which lives outside this public repository; its design is restated in "Release 3" below with no workplace content.

## Global Constraints

- `CLAUDE.md` rules 1–9 bind every task. In particular: no clinical constant without a paper and table (rule 1); one implementation per concept (rule 2); creatinine as measured (rule 4); constants parsed by `harness_constants.cjs`, never hand-copied (rule 6); a preference is labelled as one (rule 8); never weaken a test to pass (rule 9).
- The repository is public. No workplace protocol content, no institution names, no third-party PDFs, no patient data. Fictional patients only.
- No inline `on*` handlers; new handlers go in `__ACT` with `data-onclick="kN"`.
- Any user-entered or stored value interpolated into HTML goes through `escHtml()`.
- Refuse rather than approximate. An unsupported state shows a refusal, never a number.
- Every release: bump `APP_VERSION`, the header tag and the print header; add the README history row; update `CLAUDE.md`, `DESIGN.md` where the UI changes, and `docs/v3-decisions.md`.
- Every release gate: `node phase2d_validation.cjs` all pass; `phase3` 21/21; `phase4` 49/49; comprehensive scenarios 3 and 4 fail by design and nothing else; engine parity run against the previous release with every difference listed and explained in the decision record; browser flows all pass; a fresh independent review of the release diff; then the hub pull request. **The user runs the production merge.**
- The local CSP server is started with `python3 docs/audit/serve-csp.py` (port 8777). Scratch files go under `docs/audit/` if kept, or outside the repo; never under `/private/tmp` (it has been wiped twice).

## The user's rulings (2026-11-13/14)

1. **Hold threshold:** 20 mg/L (`TROUGH_HIGH_MGL`). A fitted pre-dose concentration at or above it means "Hold".
2. **Trough module limits:** the same as AUC Precision — 2 g per dose, 4.5 g per day, AUC₂₄ 700, the augmented-clearance caution, and no empiric maintenance regimen at CrCl under 10 without a level.
3. **Low confidence protects an in-range regimen.** Under Low or Very low confidence an in-range, safe current regimen is continued and the answer says to draw a level. Safety changes and changes from an out-of-range regimen still happen. This replaces the earlier ruling that confidence does not gate the decision.
4. **Three releases** from one plan: safety and logic with v3.14.0; tests, UI and Hughes; dialysis.
5. **CRRT:** guard, guideline reference, then a level-based answer. No Bayesian CRRT model.
6. **Hybrid (SLED / PIRRT):** guard and guideline reference only. Hybrid sessions may run to 24 h.
7. **Haemodialysis by level:** the Trough module gains a peak-equation reading driven only by browser-stored local settings, shown beside the model's answer.
8. **Severe-renal advisory:** the guideline loading dose (Rybak 2020 Rec 11), then dose by measured level; no stated interval.
9. Earlier rulings stand: continue margin 2 of 20; first regimen from the target box inside a strict band; the Hui model stays excluded; scheduled HD uses Goti-HD with pre-HD 15–20 mg/L; PD is level-based.

## Defaults taken without asking (change before the build if wrong)

- **D-a.** A charted dose above 2 g, or above 4.5 g a day, is *not recommendable* but not *unsafe*: it does not by itself force a change. Unsafe stays AUC₂₄ above 700 or a trough of 20 or more.
- **D-b.** A schedule with no dose yet given (all rows in the future) is not a current regimen.
- **D-c.** The Trough module's CrCl is not capped at 150 (no source for a cap on those clearance equations); the ceilings and the augmented-clearance caution carry the safety.
- **D-d.** A two-level volume gets no plausibility bound (no sourced number); the interval guard in Task 7 is the fix.
- **D-e.** A profile save is refused when the two modules hold different values for a shared patient field.
- **D-f.** Early-level uncertainty: simulate an early-level design and let the dots read it (Task 19), so the band is calibrated for the levels actually drawn.
- **D-g.** Hughes residual error stays as shipped (Table 3); the comment cites the table.
- **D-h.** The Trough module's separate AKI check (`checkAKI`) is left as it is and recorded as a known gap; it has no draw times to apply KDIGO windows to.
- **D-i.** The legacy GitHub Pages copy gets no meta CSP in this plan; recorded as an open item.
- **D-j.** Dialysis decisions not yet asked take the research report's recommendation: no dialyser descriptor; a caution only for more than three sessions a week; refuse a fit across a change of modality; the pre-HD target stays fixed; one five-way selector.

## Review Focus

Inputs the tests in this plan do not exercise, most likely first:

1. A hold when the fitted curve never falls below 20 mg/L within the search window (anuric, no dialysis): the answer must say "recheck a level", never a time.
2. A profile saved by an older version (no `core`, or a `fit` from before the stale fix) loading into the new validation.
3. A continue-under-low-confidence answer on Goti, where confidence depends on model agreement computed from the current regimen's daily dose.
4. The Trough ceilings on the two-level and random-level modes, which share `findOptimalDose` but render differently.
5. Resize while the first-dose editor is open on a touch device (soft keyboard fires `resize`).

Each has a test in the task that owns the code (Tasks 2, 11, 9, 3, 15).

---

# Release 1 — v3.14.0: continue or change, with the safety fixes (D25, D26)

Branch: continue on `v3.14.0-continue-current` (HEAD `32988d9`). New tests go in a new **SUITE 44** in `phase2d_validation.cjs`; browser checks are prefixed `D26:`.

### Task 1: Saving a profile never un-marks a stale result

**Files:** Modify `index.html` (`saveCurrentProfile`, ~14901–14916). Test: `phase2d_validation.cjs` SUITE 44; `docs/audit/browser-flows.cjs`.

**Interfaces:** Consumes `bayesFitIsStale()`, `snapshotBayesForm()` (already stores a stale fit as `staleFit`, never `fit`). Produces: `saveCurrentProfile()` never assigns `bState.result` or `bState.resultFingerprint`.

- [ ] **Step 1: failing tests.** SUITE `44.1`: the body of `saveCurrentProfile` contains no assignment to `bState.result` or `bState.resultFingerprint`; `clearUndo()` appears after the empty-label return. Browser `D26: saving while stale keeps the stale mark`: run an AUC fit, change `#b-scr`, click Save with an empty label, then with a label; after each, `.stale-line` is present, `#b-results` has `is-stale`, and `bState.result` is set (read via `page.evaluate`); the saved profile's snapshot has no `fit`.
- [ ] **Step 2:** run; both fail.
- [ ] **Step 3:** delete the wipe; derive `savedWithoutFit` from `snapshot.dirty` (or the stale check) without mutating state; move `clearUndo()` below the label check.
- [ ] **Step 4:** run; pass. **Step 5:** commit.

### Task 2: Hold when the fitted pre-dose level is 20 mg/L or more

**Files:** Modify `index.html`: `firstDosePlan` (9639), `firstDoseReadoutHTML` (9664), `firstDoseHTML`, the verdict in `renderBayesianResults`, `resultSummary`, `announceResult` call, `_prRecommendation`; Trough steady-state and two-level result builders (~7088–7156) using `timeToDecayTo` (7694).

**Interfaces:** `firstDosePlan(r, rec, nowH, atH, cur)` returns the existing object plus `hold: boolean`, `resumeH: number|null`, `holdNoTime: boolean`. Rule: compute `pre` at the unconstrained `firstH`; if `pre >= TROUGH_HIGH_MGL`, search forward from `firstH` in 0.25 h steps (bound: 14 days) for the first `t` with `predictFittedAt(r, t) < TROUGH_HIGH_MGL`; `resumeH = t`, and when the user has not chosen a time, `firstH = resumeH` and `pre` is recomputed there. No such `t`: `holdNoTime = true`, `resumeH = null`. A chosen time is honoured; if its `pre` is still at or above the threshold, `hold` stays true. No new constant.

- [ ] **Step 1: failing tests.** SUITE `44.2`: fictional 60 M, 80 kg, SCr 3.0, Buelga, 1.5 g q8h × 6 over 2 h, last dose 6 h ago, level 48 mg/L 1 h ago → `plan.hold === true`, `plan.resumeH > nowH`, `predictFittedAt(r, plan.resumeH) < 20`, `plan.firstH === plan.resumeH`. `44.3`: an ordinary in-range fit → `hold === false` and `firstH` unchanged from v3.13.0 (engine parity for `firstDosePlan`). `44.4`: CL 0.05 L/h, V 50 L, level 40 → `holdNoTime === true`, `resumeH === null`. `44.5`: `firstDoseReadoutHTML` for a hold contains "Hold" and "not before"; for `holdNoTime` contains "recheck a level" and no clock time. Browser `D26: a 48 mg/L level gives Hold`: the verdict's first line reads "Hold: next dose not before <time>"; the level-by-then number has class `tone-alarm`; the print report and `#sr-announce` both contain "Hold". Browser `D26: Trough level mode holds`: steady-state level 45 mg/L on 1.5 g q8h shows "Hold" and a re-dose time.
- [ ] **Step 2:** run; fail. **Step 3:** implement. On screen the hold line precedes the regimen (`.vx-action`, alarm tone, drawn `ICON.alarm`); the regimen stays shown as what to resume with. Copy summary carries the hold. **Step 4:** pass. **Step 5:** commit.

### Task 3: The Trough module obeys the dose and exposure ceilings, and withholds in severe renal impairment

**Files:** Modify `index.html`: `findOptimalDose` (6475), the callers in `calculate()` (6863+), the Trough advisories (reuse `detectARC`, `detectVeryLowCrCl`, `capBoundFlag`).

**Interfaces:** `findOptimalDose(troughMin, troughMax, tau, tinf, kel, vd, clv)` builds candidates only from 250 mg to `DOSE_MAX_PER_DOSE_MG` and drops any with daily dose above `DOSE_MAX_TDD_MG` or AUC₂₄ above `AUC24_ABSOLUTE_MAX`, judging each through `evalRegimen(dose, tau, tinf, clv, vd, null, mic)` so the hard rejects have one implementation. Returns `{ ...candidate, flag }` as today, or `{ refused: true, reason, capBound }` when nothing admissible remains or nothing admissible reaches the band. Callers render a refusal (`vx-regimen-hold` heading plus the cap-bound alarm) instead of a headline regimen.

- [ ] **Step 1: failing tests.** SUITE `44.6`: 25 M, 95 kg, 185 cm, SCr 0.5 at q8h, q12h, q24h → no returned dose above 2,000 mg and no daily dose above 4,500 mg. `44.7`: a clearance where every candidate at the chosen interval exceeds AUC₂₄ 700 → `refused === true`. `44.8`: at uncapped CrCl under 10, no HD, initial mode → the result is "No empiric maintenance regimen" with the severe-renal advisory. Browser `D26: Trough refuses 7.5 g a day` and `D26: Trough withholds at CrCl 6.5` (85 F, 45 kg, 155 cm, SCr 4.5); `D26: Trough shows the augmented-clearance caution` for the first patient.
- [ ] **Step 2–5:** fail, implement, pass, commit. Check the two-level and random-level modes render the refusal (Review Focus 4).

### Task 4: The severe-renal advisory carries only sourced numbers

**Files:** Modify `index.html` (~13404–13406, and the Trough copy added in Task 3).

- [ ] **Step 1:** read Rybak 2020 Recommendation 11 in the guideline PDF (kept outside the repo) and record in the source comment the exact mg/kg range, the weight basis and the 3,000 mg maximum, with page. **If the text does not support a figure, do not ship it.**
- [ ] **Step 2: failing test.** SUITE `44.9`: the advisory text contains no "15–20 mg/kg", "max 2 g", "24–48 h" or "q24h–q72h"; it names Rec 11 and reuses `HD_LOADING_MAX_MG`; it says later doses follow measured levels.
- [ ] **Step 3–5:** implement, pass, commit.

### Task 5: A level dated in the future is refused

**Files:** Modify `index.html` (`runBayesian` level filter, ~12095–12109).

- [ ] **Step 1: failing tests.** Browser `D26: a future level is refused`: 55 M, 80 kg, 1.25 g q12h × 4, a level dated 30 h ahead → a form error naming "Level row 1" and no result. SUITE `44.10`: the filter compares each level's time with the fit time (tolerance one minute) and calls `showFormErrors`.
- [ ] **Step 2–5.** Planned (future) dose rows stay allowed.

### Task 6: `nextLevelValue` knows the state of the fit; one sentence about a further level

**Files:** Modify `index.html`: `nextLevelValue` (11016), its call (13260), `FIT_BANDS` action text (5571), the Models gist, the Low-confidence sentence (13545).

**Interfaces:** `nextLevelValue(auc24, nLevels, model, tau, CLind, fit)` where `fit = { confRank, worstSigma, hasAlt, capBoundContinue }`. When `confRank >= 2`, `worstSigma >= CONFIDENCE_SIGMA.moderate`, or `hasAlt`, return `{ kind: 'conflict', headline: 'A further level is recommended', detail: <the first confidence reason> }` and never reach the precision branch. When `capBoundContinue`, the outright branch says the regimen is at the ceiling.

- [ ] **Step 1: failing tests.** SUITE `44.11`: 76 M, 70 kg, SCr 0.5, Buelga, 1 g q12h × 4, one level 19.9 at 11.5 h → `kind === 'conflict'`. `44.12`: the rendered result never contains both "would add little" and "is recommended". `44.13`: the string "a fit the tool itself does not trust" is gone; the Low-confidence line names its first reason (for example the model disagreement with both AUCs). `44.14`: CL 12.34, 1.5 g q8h established, no level → the Next line does not say "a dose change is indicated".
- [ ] **Step 2–5.** The other two panels point to the Next line and add no sentence of their own.

### Task 7: Two-level, steady-state basis: a level later than the interval is refused

**Files:** Modify `index.html` (6961–7001).

- [ ] **Step 1: failing test.** SUITE `44.15` and browser: steady-state basis, q12h, level 2 at 56 h → a form error naming the level times; first-dose basis with the same times is still accepted.
- [ ] **Step 2–5.**

### Task 8: "Was due" is the current regimen's due time

**Files:** Modify `index.html` (`firstDosePlan`, `firstDoseReadoutHTML`).

**Interfaces:** `plan.dueH` = last dose time + **the current regimen's** interval when `cur` exists; when there is no current regimen, `duePassed` is false and the parenthesis is not printed.

- [ ] **Step 1: failing test.** SUITE `44.16`: last dose 12 Nov 08:00 on q24h, answer q12h, now 13 Nov 10:00 → the readout says "was due 13 Nov 08:00". No current regimen → no "was due".
- [ ] **Step 2–5.**

### Task 9: Low confidence protects an in-range regimen (ruling 3), and two default rules

**Files:** Modify `index.html`: `regimenDecision` (10685), `currentRegimenOf`, `runBayesian` (three fit paths), `renderBayesianResults` (top), `regimenActionHTML`.

**Interfaces:**
- `runBayesian` stores `decisionArgs = { CL, V, target, bag, mic, doses, row }` on `bState.result`.
- `regimenDecision(CL, V, target, bag, mic, doses, row, opts)` with `opts.protectInRange === true` returns the continue object with `continueReason: 'low-confidence'` whenever the current regimen is in band and safe.
- `finalizeDecision(r, conf)`: called once at the top of `renderBayesianResults` after `conf` is computed; if `r.rec.action === 'change'`, `r.rec.decisionReason === 'attainment'`, `r.rec.current.inBand`, and `conf.rank >= 2`, it replaces `r.rec` with the protected decision and sets `r.recFinal = true`. Idempotent. (Confidence does not depend on `rec` when a current regimen exists: model agreement is computed on the current daily dose.)
- `currentRegimenOf`: (D-b) returns null when no dose has `timeH <= nowH`; (D-a) dose-ceiling hard rejects go to `c.notRecommendable`, not `c.unsafeReasons`; AUC₂₄ above 700 and a trough of 20 or more stay unsafe.
- `regimenActionHTML` for `'low-confidence'`: "Within 400–600 at AUC₂₄ N with X of 20 in range. Another regimen would put Y of 20 in range, but confidence in this fit is Low (<reason>), so the regimen is not changed on it. Draw a level." For a continued regimen above a dose ceiling it adds a caution naming the ceiling. For M2 (better regimens set aside for their trough) it says so.

- [ ] **Step 1: failing tests.** SUITE `44.17`: a fictional Hughes patient (BMI 43) on 1.5 g q12h with one level giving Low confidence and a 2-dot better alternative → after `finalizeDecision`, `action === 'continue'`, `continueReason === 'low-confidence'`. `44.18`: the same fit at Moderate confidence still changes. `44.19`: an out-of-range current regimen at Low confidence still changes; an unsafe one still changes. `44.20`: a schedule of future rows only → `action === 'start'`. `44.21`: 2.25 g q48h in range with a trough under 20 → continued, with the ceiling caution. `44.22`: `finalizeDecision` twice gives the same `r.rec`. Update SUITE 43.5 (never worse) to treat `'low-confidence'` as a continue. Browser `D26: Low confidence keeps an in-range regimen and asks for a level`.
- [ ] **Step 2–5.** Print, Copy summary and the announcement read the finalized `r.rec` (Review Focus 3: add a Goti case).

### Task 10: Every printed report carries the full disclaimer

**Files:** Modify `index.html`: print footers (~15273, 15485, 16444, 16667); CSS line 538 stays.

- [ ] **Step 1: failing tests.** SUITE `44.23`: one constant `DISCLAIMER_TEXT` holds the sentence; the two on-screen paragraphs and every print footer use it. Browser `D26: print says not clinically validated` for a Trough result, an AUC result and an HD result.
- [ ] **Step 2–5.**

### Task 11: Profiles cannot mix two patients, and a bad profile cannot break the form

**Files:** Modify `index.html`: `snapshotPatientCore` (14848), `saveCurrentProfile`, `loadProfileIntoForm` (14962), `loadProfiles` (14713), `renderProfileList` (~15064–15087), `applyPatientCore`.

**Interfaces:**
- `snapshotPatientCore(source)` (`'trough' | 'auc'`): reads the source module's field first. Returns `{ core, conflicts: [fieldKey…] }`; a conflict is a shared field non-empty in both modules with different values.
- `saveCurrentProfile`: on conflicts, refuses with a message naming the fields (D-e). A save from the Trough module stores the AUC course only when there are no conflicts.
- `validProfile(p)` → boolean: `id` matches `/^p_[a-z0-9]+$/i`, string `label`, finite `savedAt`, object `snapshot` with an object `demographics` and array `doses` / `levels`.
- `loadProfiles()` returns only valid entries and sets `profileReadProblems` (count); unparseable JSON is copied to `ainadara.profiles.v1.bak` before anything is written, and the status line says so.
- `loadProfileIntoForm(id)`: validates first; then clears **both** columns (`resetForm()` and `resetBayesian()`); `applyPatientCore` clears a field whose core value is empty.
- `renderProfileList` uses `escHtml` (delete the local `esc`) on the label **and the id**.

- [ ] **Step 1: failing tests.** Browser `D26: a Trough save refuses a mixed patient` (the engine report's P1) and `D26: a profile load clears the Trough column` (P2: afterwards `#cysc`, `#scr-baseline`, `#dose`, `#level-val` are empty and both advisories hidden). Browser `D26: delete removes one profile of three`. SUITE `44.24`: `loadProfileIntoForm` with a profile lacking `demographics`, lacking `snapshot`, or with a non-numeric `savedAt` does not throw, leaves the form untouched and sets a status message. `44.25`: an id `p1" data-x="y` renders no injected attribute. `44.26`: a profile saved by v3.13.0 (fixture with `core` and with a legacy `fit`) loads (Review Focus 2).
- [ ] **Step 2–5.**

### Task 12: Release v3.14.0

- [ ] Version strings are already 3.14.0; add the D26 record to `docs/v3-decisions.md` (each finding, its test, the rulings and defaults above with what each costs if wrong); update `CLAUDE.md`, `DESIGN.md` (hold line, low-confidence line), README counts and history row.
- [ ] Run the full gate (Global Constraints). Engine parity against `edc5b53`: list every difference (Tasks 2, 3, 6, 8, 9 are expected to produce some) in D26.
- [ ] Fresh independent review of `git diff edc5b53..HEAD` on the strongest model; one fix pass, each fix test-first.
- [ ] Merge to `main`, tag `v3.14.0`, push; hub branch, CSP re-pin, `npm run check && npm test && npm run build`, pull request, preview verified with the browser flows; hand the user the merge command in a single-line `bash` block (they use the Run button). After the merge: verify live bytes, CSP hash and flows; ask the parallel agent that owns the site card to update it.

---

# Release 2 — v3.15.0: tests that can fail, UI and accessibility, Hughes (D27)

Branch `v3.15.0-tests-ui-hughes` from the released `main`. New **SUITE 45**; browser checks prefixed `D27:`.

### Task 13: Rule 6 for Hughes, and a pinned test count

**Files:** `harness_constants.cjs`; `phase2d_validation.cjs` (109–115 and the summary); `phase3_simulation.cjs` (102).

- [ ] Add `OMEGA2_CL_HUGHES`, `OMEGA2_VC_HUGHES`, `OMEGA2_VP_HUGHES`, `SIGMA_PROP_HUGHES`, `SIGMA_ADD_HUGHES`, `HUGHES_CRCL_EXP` to the extractor; delete the hand copies; anchor `num()` to the start of a line and drop its `i` flag.
- [ ] SUITE `45.1`: a Hughes MAP fixture (fictional obese patient, two levels) whose posterior clearance is asserted to an absolute tolerance — it must fail when any of the five variability constants is doubled.
- [ ] The summary asserts `pass + fail === EXPECTED_TOTAL` (a named constant bumped with each release).
- [ ] Build date fixtures from numeric hours so the suite passes under `TZ=Pacific/Auckland`.

### Task 14: A mutation script, and tests until every listed mutant dies

**Files:** Create `docs/audit/mutation.cjs` (loads `index.html` in memory, applies one textual mutation at a time, runs the Node suites, never writes `index.html`). Modify `phase2d_validation.cjs`.

**Interfaces:** `node docs/audit/mutation.cjs` prints one line per mutant (`killed` / `SURVIVED`) and exits non-zero if any survives. The mutant list is the code report's I3, I4 and I5 lists (26 engine mutants, 5 profile/state mutants).

- [ ] **Step 1:** write the script with the list; run; record the survivors (expected: all of them).
- [ ] **Step 2:** add direct value tests, one behaviour each: `calcCrClRaw`; `calcCrCl` with the override on; `calcIBW`; `calcAdjBW`; `applyScrPolicy` at ages 65 and 66; `predictConc1comp` mid-infusion; `kdigoStage` with a 0.3 rise at 60 h; `checkAKI`; `computeGuidelineDose`; `pdLoadingDose` with a local maximum above 3,000; one `evalRegimen` case per hard reject and per flag; the six D25 branches; a fingerprint test that edits a dose amount and a dose time and expects stale; the three "cannot fail" tests in the code report rewritten as behaviour tests.
- [ ] **Step 3:** run until the script exits 0. **Step 4:** commit. The script joins the release gate for clinical releases.

### Task 15: A resize or theme change redraws; it does not rebuild

**Files:** Modify `index.html`: resize handler (5849), `redrawAllCanvases` (5883).

- [ ] Browser `D27: resize keeps the result's state`: open every evidence section, type 1750 in `#b-tink-dose`, open the first-dose editor and focus its date; `setViewportSize` 1440 → 1300 and toggle the theme → open-section count, the typed value and the focused element are unchanged; no second announcement in `#sr-announce`. Fail first.
- [ ] Implement: on resize and theme change call only the canvas and strip renderers (`refreshProfileGraph`, the comparison, the Trough graphs); `renderBayesianResults` is not called. SUITE 12 (palette change redraws every canvas) must still pass.

### Task 16: Continuous integration

**Files:** Create `.github/workflows/test.yml`: on push and pull request, Node LTS, run the syntax check, `phase2d_validation.cjs`, `phase3_simulation.cjs`, `phase4_regimen_validation.cjs`. No install step (the repo has no dependencies). Least-privilege `permissions: contents: read`.

### Task 17: Hughes and Goti start on the peripheral volume too

**Files:** Modify `index.html` (`mapFit`, 10050). Create `docs/audit/probe-map-starts.cjs`.

**Interfaces:** `mapFit(fn, dim, omega2CL, omega2V, maxIter, omega2Vp)`; for `dim === 3` and a finite `omega2Vp`, add starts `[0, 0, +√omega2Vp]` and `[0, 0, −√omega2Vp]` (third coordinate). Callers pass the model's own peripheral-volume variance.

- [ ] **Step 1:** re-create the reviewer's seeded probe (design in `docs/review/2026-11-13/models-report.md`, finding I1): Hughes, 1,500 simulated patients per design; count fits where a wider start set finds a lower minimum. Expected before the fix: 4 / 1 / 3 across the three steady-state designs.
- [ ] **Step 2:** SUITE `45.2`: for the probe's missed cases (seeded, so reproducible), `mapFit` returns the lower minimum or flags the alternative. Fail first.
- [ ] **Step 3:** implement; probe shows 0 missed. Engine parity for Buelga unchanged; list any Goti or Hughes difference in D27.

### Task 18: Hughes out-of-population caution; comment fixes

**Files:** Modify `index.html`: `modelMismatchText`, the Hughes header comment, the residual-error comment.

- [ ] Read the covariate ranges in Hughes 2024 (Table 1; PDF outside the repo): fat-free-mass creatinine clearance range and weight/BMI range. Record them as sourced constants with table and page.
- [ ] SUITE `45.3`: a fictional 25 M, 200 kg, 185 cm, SCr 0.5 on Hughes → `modelMismatchText` returns a line saying the clearance covariate is above the range the model was built in. In range → no line. One line only in the confidence slot.
- [ ] Fix the header comment (FFM placement) and cite Table 3 for the residual error (D-g).

### Task 19: An uncertainty band calibrated for early levels

**Files:** Modify `docs/audit/uncertainty-by-model.cjs` (add an early design: levels after the loading dose, and one early level); `index.html`: `AUC_UNCERTAINTY`, `aucUncertaintyRow(nLevels, model, early)`; the callers that already compute the early-level fraction (`SS_FRACTION_NOTE`).

- [ ] Simulate, three seeds, n = 1,500, each model: the 10th/90th percentiles of true/estimated AUC₂₄ for the early designs. Record the provenance comment exactly as the existing rows do.
- [ ] SUITE `45.4`: `aucUncertaintyRow(1, 'hughes', true)` is wider than the steady-state row; the dots, the "likely" range and `regimenDecision`'s row all read the same row for a given fit (one test that fails if two different rows are used).
- [ ] Coverage check in the probe: the early band covers 78–82% in its own design.

### Task 20: UI and accessibility fixes (`docs/review/2026-11-13/ui-report.md`)

One commit per bullet, each with a browser check that fails first:

- [ ] **Focus not hidden:** `scroll-padding-bottom` on `.panel-left` equal to the pinned footer's height. Check: tabbing to `#scr` at 1280×800 leaves its box above the footer's top.
- [ ] **PD announces its answer** through `announceResult`.
- [ ] **Steady-state chart:** the measured-level label uses the clear-place scan the band label uses.
- [ ] **PD chart:** a mg/L caption; a tick at or above the drawn maximum; swatches with a hairline border; the pre-dose segment named.
- [ ] **Focus ring** uses `--terracotta-ink` everywhere.
- [ ] **Notation:** "h" not "hr"; "Kel … h⁻¹"; a space before every unit; "q12h" in prose; "AUC₂₄" in engine reason strings shown to the user; "SCr 1.0" in print.
- [ ] **Trough verdict:** AUC/MIC only when MIC ≠ 1. **HD table:** row heads do not wrap. **Delta line:** "450 lower", not "−450". **Caution clauses** separated. **Print text layer** has spaces around "provisional".
- [ ] **Reduced motion** resets `scroll-behavior`. **Touch targets** at 375 px reach 44 px. **Legend swatches** (Regimens, Trough chart key) match what is drawn. **PD gist** reads correctly. The schedule's "high confidence" becomes "consistent schedule".
- [ ] **Profiles:** a "Delete all profiles" text action with Undo; each row shows its age in days.

### Task 21: Code health

- [ ] Remove dead code: `extrapolateTrough`, `halfLife`, `__ACT` `k50`, `k53`–`k56`, `showResultTab`, `.result-tab*` CSS, the empty banner. SUITE 18 still passes.
- [ ] One `LN2` (`Math.LN2`) and one half-life helper; list the engine-parity differences (fourth significant figure) in D27.
- [ ] The 250 mg step and the dose ceilings read named constants everywhere; `computeGuidelineDose`'s 2,500 mg cap and CrCl thresholds get a source or are labelled as preference (rule 1 / rule 8).
- [ ] `__ACT` lookup uses `Object.hasOwn`; a handler failure shows a visible status line; the Copy summary button cannot stick on "Copied" and carries the stale marker; `firstDosePlan`'s loop is bounded; `serve-csp.py` binds `127.0.0.1`.
- [ ] Correct the stale facts in `CLAUDE.md`, `PRODUCT.md` ("on a phone as often as a desktop" → workstation first) and the README.

### Task 22: Release v3.15.0

Same sequence as Task 12, plus `node docs/audit/mutation.cjs` exiting 0.

---

# Release 3 — v3.16.0: dialysis (D28)

Branch from the released `main`. New **SUITE 46**; browser checks prefixed `D28:`. **Before this release is built, a detailed task plan is written from this section** once the remaining dialysis decisions (D-j) are confirmed; what follows fixes scope, interfaces, constants and tests.

### Task 23: One renal-replacement selector, and the guards

**Interfaces:** `state.rrt` / `bState.rrt` ∈ `'none' | 'ihd' | 'hybrid' | 'crrt' | 'pd'`, one concept shared by both modules and saved in the profile core; it replaces `#t-hd`, `#b-dial` and `#b-pd`. Session rows carry `type` following the selection; `INPUT_LIMITS.hdHours` stays 0.5–12 for `ihd` and becomes 0.5–24 for `hybrid`. A profile without the field loads as `'none'`, or as `'ihd'` / `'pd'` from the legacy flags.

| Selection | AUC Precision | Trough module |
|---|---|---|
| none | as today | as today |
| ihd | as today (Goti-HD) | the level-based reading of Task 26 when its local settings exist; otherwise the present refusal |
| pd | refuses, as today | level-based mode, as today |
| crrt | refuses before anything is parsed or fitted; shows the CRRT reference | refuses creatinine-based dosing; shows the reference, and the level-based answer of Task 25 |
| hybrid | refuses the IHD answer; shows the hybrid reference | refuses; shows the hybrid reference |

Tests: each refusal fires under every model tile; a hybrid row of 14 h is accepted and an IHD row of 14 h refused with a message naming prolonged therapy; a row typed for one modality under another selection is a blocking error naming the row; legacy profiles load unchanged.

### Task 24: Guideline reference tables for CRRT and hybrid therapy

Computed for actual body weight in the manner of `hdEmpiricHTML`, rounded to 250 mg, capped at `HD_LOADING_MAX_MG`, each cell showing the mg/kg it came from.

| Constant | Value | Source | Grade |
|---|---|---|---|
| CRRT load | 20–25 mg/kg actual body weight | Rybak 2020, Recommendation 16 | B-II |
| CRRT initial maintenance | 7.5–10 mg/kg q12h | same | B-II |
| Effluent range these apply to | 20–25 mL/kg/h | same | — |
| CRRT first level | within the first 24 h | same | — |
| Hybrid load | 20–25 mg/kg actual body weight | Rybak 2020, Recommendation 15 | B-III |
| Hybrid maintenance | 15 mg/kg after the session or in its final 60–90 min | same | B-III |
| No sampling | during, or within 2 h after, a session | same | — |

Each value is verified against the guideline PDF before coding. The CRRT table states that it applies at the stated effluent range, says whether an entered effluent rate lies inside it, and **never scales a dose**. A footer says that AUC-targeted work since 2020 supports lower daily maintenance and that later doses follow levels. The hybrid reference shows no pre-session target band (none is validated) and carries its grade. Hand-worked test cells for a fictional 70 kg patient: CRRT load 1,500 mg and 1,750 mg; maintenance 500 mg and 750 mg q12h; hybrid post-session dose 1,000 mg.

### Task 25: A level-based CRRT answer

The peritoneal-dialysis pattern on the same interval solver (rule 2: reuse `pdIntervals` / the pick rule, generalised, not copied).

- **Inputs:** weight; the circuit's running intervals as full date-and-time instants; effluent rate with the time of any change and the modality, both recorded and printed; a urine-output band; dose rows; level rows; a goal with **no default**.
- **Engine:** for each consecutive pair of levels, solve the one elimination rate that carries the first level and the doses between onto the second. Flag an interval when the circuit was off during it, when the effluent rate changed during it, when a level falls inside an infusion or too soon after one, or when two levels are too close. A projection uses only rates measured while the circuit ran throughout, and only for a period in which the circuit is expected to run; otherwise the answer is "draw a level".
- **Answer:** the existing table — no dose and each 250 mg step with its expected level at the next draw as a range — and the existing pick rule. Before any level: the Task 24 reference.
- **Refusals:** no dose scaled from effluent; no creatinine-based clearance; no fit across a change of modality; no AUC unless the volume was measured from the patient's own rise, and then labelled as not validated in CRRT.
- **New constants:** none clinical; level-spacing preferences reuse the PD ones.

Tests: the solver recovers a known rate from synthetic levels to an absolute tolerance in mg/L; a circuit-off interval is flagged and excluded; a projection across an unmatched period is refused; a level inside an infusion is refused; a test fails if a second copy of the pick rule appears.

### Task 26: A level-based haemodialysis reading from local settings

Shown in the Trough module for `ihd`, beside (never instead of) a pointer to AUC Precision's Goti-HD answer, and only when the user has set every local number it needs.

- **Local settings (browser only, `vanco.hd.local`, never shipped):** fraction of the pre-dialysis level remaining after a session; target peak; volume basis (L/kg). The repository ships no default for any of them.
- **Reading:** estimated post-dialysis level = pre-dialysis level × the local fraction; dose = volume × (target peak − that level), rounded to 250 mg, capped by the existing ceilings; a hold when the pre-dialysis level is at or above the user's stated hold level. Every number is labelled "your setting".
- **Refusals:** no settings → the present refusal with a line on how to set them; a level drawn during or within the redistribution window after a session is not used.

Tests: with no local settings nothing is computed; with settings, hand-worked cases; the three numbers never appear in `index.html` as literals (a source test).

### Task 27: Cautions that change no number

A caution when more than three sessions fall in any seven days (the guideline's instruction to dose from levels); the pre-dialysis target's source comment cites Recommendation 14 with its grade; the "Not implemented" lists in `CLAUDE.md` and the README are reconciled.

### Task 28: Release v3.16.0

Same sequence as Task 12. The institutional comparison stays outside the repository; D28 describes it in general terms only.

---

## Not in this plan (recorded so they are not lost)

- A Bayesian CRRT prior (declined, ruling 5). Session-aware haemodialysis (parked; the external evidence does not yet show it predicts better). A level-based hybrid answer (ruling 6).
- A per-fit Laplace uncertainty interval; splitting `renderBayesianResults` into build and write halves; a meta CSP for the legacy Pages copy (D-i); the Trough module's AKI windows (D-h).
- Papers to obtain by hand before any dialysis model is ever coded are listed in the dialysis research report.

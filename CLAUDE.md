# Vancomycin TDM Calculator — project instructions

Single-file, AUC-guided vancomycin TDM calculator per the 2020 ASHP/IDSA/PIDS/SIDP
consensus guideline. Built for a clinical pharmacist; used at a pharmacy workstation (office or
central pharmacy), desktop first — not at the bedside.

**Advisory only — not a prescription. Clinical correctness outranks everything else here.**

> Rewritten 2026-09-05. The previous version described a five-tab UI with element IDs
> (`#section-initial`, `#b-ht`, `#model-select`) that have never existed in this file, and
> quoted a line count and test count that were both wrong. If you are holding an older copy,
> discard it.

## What this is

`index.html` — the entire application. Vanilla JS, no framework, no build step, **no
JavaScript dependencies**. The only external reference is a Google Fonts stylesheet.
~20,300 lines / ~1.25 MB (2026-11-17, v3.16.0).

`index.html` is both the canonical source **and** what GitHub Pages serves. They cannot
diverge. After any change, confirm the deployed blob still matches:

```bash
git hash-object index.html
```

## Architecture

| Range (approx) | Contents |
|---|---|
| 1–2,833 | CSS — `:root` tokens, components, the results grammar ("RESULTS — the course timeline"), responsive, `@media print` |
| 2,834–4,269 | Markup — print report, header, module tabs, the two module panels |
| 4,270–end | One inline `<script>` — the whole engine and UI |

**Two modules** (tabs, switched by `switchModule()`):

1. **Trough-Based** — deterministic. Four creatinine-based sub-modes via `setCalcMode()`: `initial`,
   `level` (steady-state trough), `twolevels` (Sawchuk–Zaske), `randomlevel`; and one per renal
   replacement (D28), set by the selector: `pd` (IV vancomycin on peritoneal dialysis, D23), `crrt`
   (level-based), `ihd` (a peak-equation reading from your settings) and `hybrid` (the guideline
   reference only).
2. **AUC Precision** — MAP Bayesian, `runBayesian()`. Four priors: Buelga 2005 (1-comp),
   Goti 2018 (2-comp), Goti-HD, Hughes 2024 (FFM-scaled, class-3 obesity).

> **Continue Course was removed in v2.2.** It re-dosed against a saved profile's
> *stored* fit without re-fitting — the one thing AUC Precision could not do, and a
> liability rather than a feature: it used yesterday's parameters and displayed none
> of the fit diagnostics, model agreement or level-anchored fallback. Loading a
> profile into AUC Precision does everything it did, and re-fits. `SUITE 18` fails if
> any of its identifiers return. Note the clinical `action:'continue'` (continue the
> current regimen) is unrelated and must not be swept up with it.

**One temporal model (v3).** Every instant a clinician enters is a full date and time
(since v3.13.0 a date and a 24-hour time, composed by `dtPairValue` into the hidden
`YYYY-MM-DDTHH:MM` input that keeps the old id), and exactly one helper — `elapsedHours()` — turns two of them into an
interval. Two-Level and steady-state-trough mode used to take clock-only `HH:MM` and wrap
with `if (d < 0) d += 24*60`, which folds every interval into `[0,24)`. Real two-level
sampling routinely spans midnight. Two failure modes, both reproduced in
`docs/audit/probe-v3-case-34m.cjs`: a level that wraps *below* the first one makes
`solveTwoLevelsPK` refuse (loud, and what was reported), while **two levels that both land
on a later day wrap by the same 24 h — kel survives, the peak back-extrapolation does not,
and Vd comes out 5-30x wrong with no warning at all**. `SUITE 19` fails the build if a
clock-only input, a `+= 24*60`, or a second elapsed-time helper reappears.

**The recommendation cannot choose an interval, and no longer pretends to (v3).**
`bayesDoseOptimizer` ranks on `|auc24 - target|`. At steady state `auc24 = TDD / CL`, so it
is a pure function of the daily dose; the per-tau dose is solved to hit the same target at
every interval, and without the 250 mg rounding every candidate would score *exactly* the
target — a four-way tie. All of the metric's discriminating power is rounding error, and it
is lopsided: the achievable-AUC lattice is `250*(24/tau)/CL`, six times finer at Q48H than
at Q8H. On the reported case target 450 gives 1750 mg Q48H and target 475 gives 500 mg
Q12H. `exposureMatrix()` replaces the pretence with the whole admissible space — dose x
interval, banded against `AUC24_TARGET_MIN/MAX`, every cell clickable into the Tinkerer.
It needs **no preference weights**, which is why it was chosen over a composite score.
Since v3.14.0 (D25) the regimen being given is judged first (`regimenDecision`); the target box
decides only a first regimen, inside a strict 400–600 band.

Cross-cutting: KDIGO AKI staging from serial creatinine, ARC and very-low-CrCl advisories,
cystatin C discordance check, print report, and **saved profiles that work in both
modules** — a profile carries a `core` (`PATIENT_CORE_FIELDS`) mapping the fields both
modules mean the same thing by, so saving from either and loading fills both. Older
profiles without a `core` fall back to their Bayesian demographics.

**Haemodialysis (D15):** IHD sessions can be logged in AUC Precision. They label each level
(during, early post-HD, pre-HD, interdialytic), band the chart and give a pre-HD reading. They
**never enter the fit**: Goti-HD averages dialysis. No session-clearance model is shipped; an
exact event engine is parked off `main`. Never correct a level for rebound or back-calculate it.

**HD dosing (D16):** for Goti-HD the verdict is a post-HD dose sized at the following session's
pre-HD level (15–20 mg/L, Rybak 2020 Rec 14). It may also be a hold, or a request for sessions.
Before any level it is the Rec 13 empiric table. Also: a recurring-schedule generator, an
intradialytic-dose caution, and a Trough-module refusal for HD patients.

**One-time HD dose (D17):** with fewer than two upcoming sessions the answer is a one-time dose
sized at an assumed 24/48/72 h gap (default 48, `bState.hdGapH`, `k78`), with a missed post-HD
dose flagged. A measured pre-HD level above 20 with no dose since means no dose now and a recheck,
for the dose after the session it preceded only; the scheduled answer shows it as a caution.
**v3.8.0 (D19):**
- The assumed next HD counts from the last session's **start**, start to start; it counts from
  the dose only with no session logged, or when every gap has passed.
- A give-at time (`k79`, `bState.hdGiveAtH`) moves the dose, never the next HD.
- On Goti-HD a SCr drawn after a session is replaced by that session's pre-dialysis reading,
  using the pre-HD label, and only if it is higher (`hdPreDialysisScr`). The result says so; no
  value is ever altered.
- An assumed session imminent at the dose time means the dose follows it.

**First dose (D20, v3.9.0):** the regular recommendation's first dose can be timed:
- `firstDosePlan` / `firstDoseHTML`, `k82`, `bState.firstDoseAtH`;
- default when the new regimen is due (from the last entered dose, given or planned), now if that has
  passed, a chosen time never before now; under a hold (D26) the default is the resume time;
- "(was due …)" is the current regimen's due time, printed only when the first dose is now because it
  has passed; a different current interval is named ("current q24h dose was due …") (D26, R1, R16);
- timing and readouts only: the dose never changes;
- the first-day AUC₂₄ is shown, because the changeover is not steady state;
- `k82` patches only the readout and the curve; a full re-render made typed dates impossible.
Both HD answers pick the in-range 250 mg step closest to 17.5 mg/L (`hdPickDose`).

**CrCl weight spread (D21, v3.10.0):** before the first level, for an obese patient (TBW > 120%
IBW) on Buelga or non-HD Goti, a note lists the regimen's AUC₂₄ on IBW, AdjBW (used) and TBW,
each through the model's own SCr rule, cap and clearance (`crclWeightSpread`). SCr stays as
measured: rounded-SCr rows were declined (rule 4). Caution only when a weight leaves 400–600.
Hidden with a manual CrCl at the fit (read from `agCtx`, never live), after a level, under the
severe-renal hold, or with HD sessions logged. Presentation only: the dose never changes. When a
renal advisory fires (augmented, low creatinine), it carries the spread: one note, not two (`pushRenal`).

**The answer first (D22, v3.11.0):** the verdict reads regimen → AUC₂₄ → trough → confidence → Next →
first dose, so confidence and Next sit on the first screen at 1280 × 800.
- **First dose on one line:** time, the times after it, the level by then, and "change" (`k83`),
  which opens the date and time. The first-day AUC shows only outside 400–600 (`firstDayAucHTML`).
  Print keeps the whole block.
- **AUC/MIC** only when MIC ≠ 1.
- **Goti-HD:** Regimens is closed and follows Haemodialysis; no guideline line, no projection row.
  The model advice is told the patient is on dialysis (`getModelRecommendation(…, onHD)`) and names
  Goti-HD; it never suggests Buelga or Hughes there.
- **Said once:** the chart summary is the canvas's label only (`#b-summary` hidden, kept for Copy
  summary). No "Population estimate only" note; its narrowing sentence is in Show the math.
- **Empty evidence sections** become one line (`emptySectionsHTML`).
- **"now"** is on the axis within `PROFILE_REACH_H` (72 h) of the curve's end; one clock per redraw
  for the curve and the strip.
Presentation only: engine parity 0 differences.

**Peritoneal dialysis, IV (D23, v3.12.0):** a level-based Trough mode, not a model.
- **What it measures:** the decline from this patient's own levels, per interval (`pdIntervals`), shown
  as a range with flags: early < 24 h after a dose, on-cycler, held-night, before-stop, prior-drug,
  unexplained.
- **What it says:** what to give, whether today, and when to draw next (`pdAnswer`).
- **How a redose is sized:** by the next draw's expected level within the user's goal (presets 10–15 /
  15–20, or custom; no goal, no answer). The target-peak reading, V × ΔC, shows only when set locally.
- **Load:** 20 mg/kg, institutional; cap Rec 11 3,000 mg. First level: the AM labs nearest 48 h.
- **Published APD/CAPD half-lives** (Manley 2001, Lam 2020) are context and never enter a row.
- **Local settings** (maximum dose, target peak, AM labs) live in the browser only
  (`vanco.pd.local`), with a Clear control (`k107`, D28). Since D28 a maximum must lie in 250–4,000 mg
  (one dispensing step to `INPUT_LIMITS.dose`, R84/R101); outside it nothing is stored and the status line
  says why. A value stored by v3.15.0 outside that range is still read (R102).
- **AUC Precision** refuses a PD patient (Renal replacement: Peritoneal dialysis; `#b-pd` until D28) and links here.
- Workplace protocols and real patients never enter this repo.

**The workstation (D24, v3.13.0):** presentation only (engine parity 0).
- **Layout:** from 1001 px the input column is its own scroller under the header, the run button pinned
  at its foot (`.panel-actions`); a run moves the window only when the answer's top is off screen.
- **Print** is a text action in each answer (`k0`); the floating button is gone.
- **Enter** does the local job: a field in a `[data-enter-scope]` presses its `[data-enter-default]`
  (Explore's Preview, Try another regimen's Predict, the profile Save); anything else in a result or the
  profiles does nothing.
- **Regimens** opens closed, its gist naming the band count and the recommendation. A picked cell is
  pressed, says "trying", opens Explore and is announced. The guideline comparison is in Show the math.
- **The model** stays the clinician's choice. The suggested tile is marked once weight and height are
  known (`markSuggestedModel`); a population mismatch is one line in the confidence slot
  (`modelMismatchText`).
- **Notes** over `NOTE_CLAMP_CHARS` (300, a preference) show three lines and "Read the rest: <word>".
- **The input column:** mode, patient, creatinine, course, target, then profiles. PD hides amputation,
  creatinine and loading-dose blocks (`.not-pd`); since D28 the Renal replacement selector sits in the patient
  section and stays in view in every mode (the CRRT, haemodialysis and hybrid modes hide the same blocks, R73). "Clear all fields" is a
  text action with Undo (`clearWithUndo`), which snapshots its own module's column and re-derives the
  CrCl override, weight basis and amputation from the restored fields; a profile load ends the Undo.
  Clearing unticks the CrCl override. No native `confirm()` remains. Alarm notes are never clamped.
- **PD (the user's ruling):** the next draw is the AM labs, said plainly, with no cycler-end caution;
  `drawOnCycler` is still computed, and a level drawn on the cycler keeps its flag in "The decline".

**Continue the current regimen (D25, v3.14.0):** a clinical change; the engine moves.
- **The case:** an in-range 1250 mg q12h (AUC₂₄ 546, 14 of 20 in range) was told to change to 1750 mg
  q24h (382, 7 of 20) because the target box read 400.
- **`evalRegimen`** judges one regimen (exposure, trough, rejects, flags) for the optimizer and the
  decision alike.
- **`rankRegimenCandidates`:** band membership is strictly 400–600. The rounding grace keeps the flags
  quiet and never selects.
- **`regimenDecision`** (all three fit paths) reads the current regimen (`currentRegimenOf`: an
  `established` schedule or the override, never a `possible_transition`; since D26 it also needs one
  given dose of the detected maintenance amount, R17, D-b). It continues when that
  regimen is in range, safe (trough < 20, no hard reject) and no admissible regimen puts
  `CONTINUE_MARGIN_DOTS` (2 of 20, a preference) more plausible AUCs in range.
- **Otherwise it changes,** across the whole lattice: danger troughs set aside, in-range kept, more
  dots than now (the full margin when leaving an in-range regimen) unless the current one is unsafe.
  Then the fewest interval steps, the smallest daily-dose change, the target box, the ceiling and
  `INTERVAL_PREFERENCE`.
- **Never worse:** a change never has fewer in-range dots than the current regimen except for safety,
  and then it says so.
- **The answer line:** `regimenActionHTML` says "Continue the current regimen" or "Change from X" above
  the regimen, and why below it, on screen, in print and aloud.
- **Confidence gates one thing (D26, ruling 3, replacing D25's "not gating"):** at Low or Very low an
  in-range, safe current regimen is continued rather than changed for dots (`finalizeDecision`,
  `continueReason: 'low-confidence'`), and the answer names the regimen set aside and says "Draw a
  level". It never blocks a safety change or a change from out of range. Dialysis and the severe-renal
  hold pass no current regimen.
- **Out of range with no dot to gain (D26, R12):** when every admissible regimen ties the current one
  on dots (0 of 20 at high clearance), the one nearest the band is chosen if it is nearer by more than
  half a 250 mg step (`roundingGraceAUC`); a genuine exposure tie still continues (`no-better`).
- **Parity:** D25 alone left engine parity at 0, because its corpus never reaches these cases; SUITE 43
  and the D25 sweeps are the record.

**The review's fixes (D26, v3.14.0):** the 2026-11-13 review (`docs/review/2026-11-13/`); safety and
logic, the engine moves.
- **Hold:** the fitted pre-dose level, OR the newest level drawn after the last given dose and after the
  distribution phase carried down the fitted terminal slope (the user's ruling U1; `measuredHoldLevel`,
  `fittedTerminalRate`), at or above `TROUGH_HIGH_MGL` (20) leads the answer with "Hold: next dose not
  before <time>" (`firstDosePlan` → `hold`, `resumeH`, `holdNoTime`, `holdBasis`). The resume time is the
  later crossing. "After the distribution phase" reuses `interpretLevelTiming` (not during the infusion,
  not immediate post-infusion) and, for a 2-comp fit, `hdRedistributionWindowH`; no new constant. The
  hold line names its basis. The 0.25 h step is search mechanics; `HOLD_SEARCH_MAX_H` is a PREFERENCE,
  72 h from the due time (U2): past it "Hold: recheck a level before the next dose", no clock time
  anywhere, no projection. A planned dose at 20 or more is the dose held (R5). Under any hold the Next
  line, Copy summary and the announcement say "Recheck a level before the next dose" (final review C1;
  `nextLevelFit(r, conf, plan)`, `bayesNextStep`; k82 moves `#b-next` and `#b-voi` with the hold). A
  refusal holds too on the fitted or the carried measured level (`noSolutionHold`, I2). The Trough level,
  two-level and random-level modes hold too (`troughHold`, the same horizon; a measured level below 20
  by the due time is no hold, and one drawn after the due time is judged as drawn, never carried back
  up: I3, I4, N2); with no measured level the Trough module never holds.
- **One set of ceilings:** `findOptimalDose` judges each candidate through `evalRegimen` (2 g a dose,
  4.5 g a day, AUC₂₄ 700). Nothing admissible in 400–600 is a refusal, "No regimen recommended", naming
  the intervals q6h–q48h that work (R7). A current Trough regimen over AUC₂₄ 700 is said at alarm tier;
  over a dose ceiling only it reads as in AUC Precision (U3, below).
  CrCl under 10 with no level: "No empiric maintenance regimen" in both modules. The Trough module shows
  the augmented-clearance caution; its CrCl is not capped (D-c).
- **Only sourced numbers:** the severe-renal advice is Rybak 2020 Rec 11 (actual body weight, at most
  `HD_LOADING_MAX_MG`), then measured levels; no mg/kg and no interval (`SEVERE_RENAL`,
  `severeRenalNote`). Once a dose is given or a level exists the note says "No further dose until a level
  is drawn", with no loading-dose sentence, and no clamp sentence unless a clamp happened (final review
  I5); once a dose is given the verdict, Next line and print say it too (`severeRenalFollow`/`Next`, N3). The Trough loading dose is capped at the same maximum (`calcLoadingDose`), the
  augmented-clearance advice lost its unsourced figures, and the HD empiric caption reads the constant.
  `VERY_LOW_CRCL_THRESHOLD` (10) is still unsourced and recorded open.
- **Refused input:** a level dated after the analysis (one minute's tolerance); a two-level steady-state
  level later than the interval plus `TROUGH_TIMING_WINDOW_H` (0.5 h, a preference, R14).
- **The Next line reads the fit** (`nextLevelValue(…, fit)`, `nextLevelFit`): a conflicted fit (Low or
  Very low, a level missed by 2 SD, a second MAP solution) gives "A further level is recommended"; any
  cap-bound answer gives "Confirm the clearance with a level". The Low line names its cause
  (`confidenceLead`); "a fit the tool itself does not trust" is gone.
- **Decision defaults:** a charted dose above 2 g or 4.5 g a day is not recommendable but not unsafe
  (D-a, now the user's ruling U3 in both modules, `doseCeilingBreaches`); a continue above a ceiling leads
  with the caution, naming the limit, in Copy summary and the announcement too (`ceilingCautionOf`, one
  wording; final review I6). The Trough module continues such a regimen in range with the same caution;
  out of range its assessment stands at caution tier, never "increase". A kept regimen under Low confidence says "Draw a level." there too (R26). Better
  regimens set aside for their trough are said to be (engine M2).
- **Print:** every report ends with `DISCLAIMER_TEXT`, written once, through `_prFooter`.
- **Profiles:** `snapshotPatientCore(source)` reads the module on screen. A shared field that differs
  between the columns refuses the save, naming both values, with one copy action (`k99`, D-e, R19). A
  course travels with a save only when the other column's demographics are filled and agree (R18, R22).
  `dial` is stored and loaded only with Goti (R21). `validProfile` on read; unreadable JSON is kept under
  `ainadara.profiles.v1.bak`; ids and labels go through `escHtml`. A load clears both columns. Trough
  Clear resets the weight basis, amputation, HD flag (since D28, Renal replacement to None) and PD form (R20, R22), never the PD local
  settings, and a blank local setting never overwrites a stored one (R23).
- **Parity against v3.13.0 (`edc5b53`):** 72 differences, all listed in D26: 64 in six `findOptimalDose`
  calls (the ceilings and the refusal, Task 3) and 8 additive `calcLoadingDose` fields (Task 4b). The final
  review's fix waves add none (0 against `73a1936` and `871234c`); SUITE 44.27–44.41 and the `D26: final
  review` browser checks pin them. The user ruled the three open questions on 2026-11-15 (U1–U3), and U4
  removed the superseded March build from `archive/`.

**Release 2 (D27, v3.15.0):** the review's test, model and UI findings; two Hold cautions; the engine moves.
- **Tests that can fail:** Hughes constants parsed (rule 6); `EXPECTED_TOTAL` pins the count in all three
  suites; `docs/audit/mutation.cjs` (63 mutants, in memory, never writes `index.html`) and CI
  (`.github/workflows/test.yml`) on every push.
- **Resize and theme repaint canvases only** (`redrawAllCanvases`); the result is never rebuilt.
- **MAP starts:** three-parameter fits also start at ±1 and ±2 SD on Vp (`mapFit(…, omega2Vp)`). Hughes missed
  the lower minimum 7 and 6 times in 10,500 fits per seed before, 0 after; Goti 0 throughout. The corpus Hughes
  case moves (parity below).
- **Hughes out of population:** one caution line in the confidence slot names every Table 1 covariate outside
  its range (`HUGHES_MIN/MAX_*`, the values the fit used); the patient's own numbers, never rounded onto a bound.
- **Early levels:** a fit whose MOST RECENT level is before steady state (`latestLevelEarly` over
  `earlyLevelFractions`, below `SS_FRACTION_EARLY`, R47) reads the early `AUC_UNCERTAINTY` row; one row per fit
  (`fitUncertaintyRow`) feeds the dots, the likely range, `regimenDecision`, the Next line and print.
- **Holds:**
  - A planned dose the answer holds is never drawn as given: it is off the curve, marked "held" on the strip
    (`heldPlannedDoses`).
  - The 72 h horizon counts from the later of the due time and now, or the planned dose, and every surface names
    the origin (R51, R54). A Trough level fallen to 20 by now is no Hold (`calculationNowH`).
  - **U5:** on non-HD Goti a fitted-only reading at 20 or more is one caution line, not a Hold: "… no level drawn
    since the last dose confirms it. Draw a level before giving the next dose."
  - **U6a, bounded by U7:** in AUC Precision, a Hold whose only measured basis is a level drawn within
    `FIRST_INTERVAL_CAUTION_H` (12 h, a preference) of the start of the course's first dose and before the second is the
    same caution: "Repeat the level before giving the next dose" (`firstIntervalLevel`, `holdBasisOf`). A later level
    before the second dose (a trough on q24h or q48h) is an ordinary measured Hold.
  - **R59:** the fitted and the carried measured level both at 20 or more is a Hold on both bases on every model, Goti
    and a first-interval level included (it replaced R55; R57's fitted-basis clause could no longer arise and went).
  - Under either caution the regimen and first dose stand. One helper (`holdCautionWords`) words the caution line,
    the Next line, the panel, Copy summary and the announcement; a refusal says "… before any further dose" and draws
    its planned rows as held; the projection note repeats the caution. No ruling id reaches the screen. A refusal
    with nothing planned, Goti-HD and the Trough module are unchanged (R53, R55, R56).
- **UI:** focus clear of the pinned footer and `--terracotta-ink` everywhere; PD announced and its chart readable;
  one notation (`userNotation`, display only); 44 px targets at 375 px; Delete all profiles with Undo, and profile
  ages; worded tinkerer refusals; a handler failure shows `#action-status`.
- **Code health:** one `LN2`/`halfLife`; `MATRIX_DOSE_STEP` and `INPUT_LIMITS.dose` everywhere; dead code gone;
  own-key `__runAction`.
- **Parity against v3.14.0 (`b410477`):** 23 differences, all listed in D27: 12 `mapFit` (Task 17), 2
  `solveTwoLevelsPK.t12` (7.9983 → 8), 5 additive `computeGuidelineDose().capped`, 4 additive
  `findOptimalDose().highestAny`.
- **Open for the user:** whether the Hughes line should lower confidence; whether an in-range regimen judged on the
  early row gets ruling 3's protection.

**Release 3: dialysis (D28, v3.16.0):** one renal-replacement selector, CRRT and hybrid references, a
level-based CRRT answer and a haemodialysis reading from your settings. Not clinically validated.
- **The gaps closed:** a CRRT patient was fitted silently as a non-dialysis patient; a hybrid (SLED / PIRRT)
  session could only be typed as haemodialysis; daily sessions passed without comment.
- **One selector** (`RRT_KINDS`, `setRrt`, `#t-rrt`/`#b-rrt`, "Renal replacement": None, Intermittent
  haemodialysis, Hybrid (SLED / PIRRT), CRRT, Peritoneal dialysis) replaced `#t-hd`, `#b-dial` and `#b-pd`.
  `state.rrt === bState.rrt`; `bState.dial` is derived (`rrt === 'ihd'`), so the engine is untouched. Off None the
  four creatinine-based Trough modes are `aria-disabled` with a reason (R64). AUC Precision refuses CRRT before
  anything is fitted, refuses hybrid, and on haemodialysis refuses every tile but Goti 2018 · HD. A refusal clears
  `bState.result` (R72) and goes when the selector or tile changes. Profiles save `core.rrt`; older ones map
  through `rrtOf`; one with both a PD form and an HD flag is refused on load (R74).
- **Sessions:** typed rows (`ihd`/`hybrid`); hybrid to 24 h (`INPUT_LIMITS.hybridHours`), haemodialysis still 12 h;
  a mismatch is a blocking error naming the row, and under None every row is one (R104: a Trough Clear sets None and
  keeps the rows); `parseBayesSessions` is the one reader. More than
  `HD_SESSIONS_PER_WEEK_CAUTION` (3) session starts in any seven calendar days is one caution on Goti-HD that
  changes no number (U8, R77).
- **References** (`rrtReferenceDoses`/`rrtReferenceHTML`): Rybak 2020 Rec 16 (CRRT, B-II) and Rec 15 (hybrid, B-III)
  for actual body weight, each cell with its mg/kg, capped at the lower of 3 g (Rec 11) and the local maximum
  (`vanco.rrt.local`, U10), the cap named. CRRT says where an effluent rate lies against 20–25 mL/kg/h and never
  scales a dose. Hybrid shows no pre-session band.
- **CRRT, level-based** (`crrtAnswer`): the decline between this patient's own levels, level to level, used only
  while one circuit run covered it at one rate and modality and neither level was within
  `POST_DISTRIBUTION_MIN_H` (1 h, Rec 2a) of an infusion's end, and the levels were at least `PD_MIN_INTERVAL_H`
  (12 h) apart, as PD reads them (R103, the final review's C1: a recheck an hour later had doubled the dose); two
  levels at the same minute are refused by name. With one level, "Draw a level" shows the Rec 16 reference too
  (R107). The projection needs one run covering from the end of the last used interval to the next draw with no
  setting change (R91 revised); otherwise "Draw a level".
  250 mg rows judged at the next draw; `pickGoalStep`; no AUC (R61); no creatinine, model or effluent scaling.
- **Haemodialysis reading** (`hdReading`, Trough `ihd`): pre × your fraction remaining, then V × (your target
  peak − that), from four settings in `vanco.hd.local` (U11). The repository ships no value; no setting, no reading.
  Shown below the Goti-HD pointer, never instead of it; refuses a level during a session or within
  `RRT_NO_SAMPLE_AFTER_SESSION_H` (2 h) of one.
- **Shared, not copied (rule 2):** `solveIntervalK`, `pickGoalStep`, `peakEquationDose` (PD, CRRT, HD);
  `doseCapOf`/`cappedWeightDose`; `levelAfterNow` with `FUTURE_LEVEL_TOLERANCE_H`; one goal control for PD and CRRT
  with a value per mode (P2). PD is unchanged (46.44, `docs/audit/pd-parity/`).
- **The Trough result placeholder** says what each renal-replacement mode gives, with no CrCl or AUC₂₄ promise off
  None (`RESULTS_PLACEHOLDER`, `syncResultsPlaceholder`, R106).
- **Parity against v3.15.0 (`bcee5dd`): 0 differences.** The corpus reaches no dialysis path; SUITE 46 is the record.

**Not implemented — do not imply otherwise in the UI:** session-clearance HD modelling,
intradialytic dosing recommendations, a Bayesian CRRT model, AUC in CRRT, a level-based hybrid answer,
SLED / PIRRT dosing beyond the guideline reference, continuous infusion, intraperitoneal dosing, AUC or
Bayesian dosing for peritoneal dialysis, paediatrics, neonates.

## Rules that are not negotiable

1. **Never ship a clinical constant whose provenance you cannot state.** Every model
   parameter carries a source comment naming the paper, table and value. If you cannot cite
   it, do not add it. This project has already shipped one unsourced prior — a power model
   labelled "Buelga" that was not Buelga (see `docs/audit-2026-09.md`, finding A2).
2. **One implementation per concept.** There is exactly one `calcIBW`, one `calcCrCl`, one
   `pickCrClWeight`, one SCr policy. Four near-duplicate CrCl functions with three different
   SCr floor rules is how the same patient got different clearances in different tabs.
3. **Recency beats frequency for regimen detection.** The current regimen is the most
   recent consecutive pattern, never the modal interval over the whole history. A modal
   reading reported a deliberate q12h→q8h order change as an accidental early dose. And
   regimen detection is a *presentation* layer: Bayesian fitting always uses the actual
   timestamps, and history is never rewritten into an idealised schedule.
4. **Serum creatinine is used as measured.** Rounding a low SCr up in the elderly is not
   evidence based and under-doses — 92.9% subtherapeutic in Drugs R&D 2017;17:463-70. The
   one exception is `SCR_POLICY.GOTI_MODEL`, which exists because Goti's parameters were
   *estimated* on truncated SCr; it is model fidelity, not clinical rounding, and it must
   never leak onto the displayed CrCl or another model.
5. **Validation thresholds are stated in absolute clinical units**, never as a ratio against
   a moving baseline. A "≥25% better than the population prior" gate fails when you improve
   the prior. See `docs/validation-threshold-decisions.md`.
6. **Never hand-copy a constant into the test harness.** `harness_constants.cjs` parses them
   out of `index.html` and throws if one goes missing.
7. **The theme is mirrored, not invented.** Tokens come from
   `~/mission-control/domains/ainadara/philosophy/design-tokens.md`, which is extracted from
   the live ainadara.com stylesheet. If they drift, re-extract there — the site wins. Two
   documented extensions exist (a raised card level, and a danger red) because a clinical
   tool needs states a marketing site does not. Theme code must degrade to a no-op without a
   real DOM: the harness runs this script in a Node `vm` with a stub that has no
   `documentElement`.
8. **A preference weight is not a clinical constant, and must say so.** Rule 1 forbids
   shipping a clinical number without provenance. A number no paper sets is a preference: its
   source comment says "PREFERENCE (rule 8)", what it orders, and whether it can change a dose.
   `grep -n PREFERENCE index.html` is the authoritative list. As of 2026-11-17 (v3.16.0) they are:
   - **Wording and display only (never a dose):** `NEXT_LEVEL_MIN_GAIN` (0.15); the 1 and 2 sigma
     splits in `FIT_BANDS`; `MODEL_AGREEMENT_BANDS` (10% / 20%); `SS_FRACTION_NOTE` (0.9, the Trough
     module's "three doses is not steady state" wording only; AUC Precision reads `SS_FRACTION_EARLY`);
     `AUC24_MODEST_BELOW_MIN` (325); the Trough AUC band (±22% / ±30%); `MAP_TIE_OBJ` /
     `MAP_SPLIT_CL` (two MAP minima); `NOTE_CLAMP_CHARS` (300); `PROFILE_ARRIVE_MS`; and the
     weight-based guideline comparison line's `GUIDELINE_DOSE_CAP_MG` (2,500) and
     `GUIDELINE_INTERVAL_BY_CRCL` (CrCl 90 / 50 / 30 / 15), which no source states (Task 21).
   - **Labels and windows that gate an answer:** `HD_PRE_LABEL_H` (12 h) and
     `HD_POSTSESSION_HALF_LIVES` (3, the redistribution window, `hdRedistributionWindowH`, which
     since D26's U1 also marks a 2-comp level as past the distribution phase for the measured
     Hold); `HD_POSTSESSION_DOSE_WINDOW_H` (6 h); `HD_ONE_TIME_GAPS_H` (24/48/72, default 48);
     `TROUGH_TIMING_WINDOW_H` (0.5 h); `PD_EARLY_LEVEL_H` (24 h) and `PD_MIN_INTERVAL_H` (12 h; CRRT reads it too
     since R103, so it decides whether an interval is used for a CRRT dose); the
     PD AM-labs default (06:00); and the level-timing narrative's 0.5 h "immediate post-infusion"
     boundary (`interpretLevelTiming`), which U1 also reuses.
   - **Preferences that order or time a dose:** `CONTINUE_MARGIN_DOTS` (2 of 20, when an in-range
     regimen is changed); `CONFIDENCE_SIGMA` (2/3/4, which since D26's ruling 3 gates one decision,
     `finalizeDecision`); `INTERVAL_PREFERENCE` (24, 12, 48, 8, ties only); the CrCl → interval
     cut-points (`suggestInterval`); the HD and PD 250 mg step nearest the goal's middle; the
     weight-based level-dosing cuts; the one goal pick (`pickGoalStep`, D28), PD's 250 mg step nearest the goal's
     middle now shared with CRRT; `CRRT_NEXT_DRAW_DEFAULT_H` (24 h, R65, D28): with no next-draw time entered the
     CRRT options are judged this long after the dose, so it can change the dose picked (editable); `HOLD_SEARCH_MAX_H` (72 h, the user's ruling U2, counted from the
     later of the due time and now, or the planned dose, R51): when a hold gives "recheck a level" instead
     of a resume time; `SS_FRACTION_EARLY` (Buelga 0.925, Goti 0.775, Hughes 0.575, D27): below this
     fraction of steady state the most recent level is "early", so the fit reads the early uncertainty row
     that the dots and `regimenDecision` count (calibrated by simulation, R45, R47); and
     `FIRST_INTERVAL_CAUTION_H` (12 h, the user's ruling U7, D27): a measured level drawn within it of the first
     dose's start, and before the second dose, is a caution rather than a Hold (the hold-rate probe's window), so it
     decides whether a dose is held.

   Everything they sit beside is sourced: sigma is each model's published residual error, the AUC
   band is Rybak 2020 Rec 1, the 250 mg step is the dispensing increment, the hold threshold is the
   user's ruling. D28's constants are sourced, not preferences: `HD_SESSIONS_PER_WEEK_CAUTION` (3, Rec 13, B-II;
   a caution only); `POST_DISTRIBUTION_MIN_H` (1 h, Rec 2a, A-II; Table 2 item 8a); the `CRRT_*` reference constants (Rec 16, B-II;
   `CRRT_FIRST_LEVEL_WITHIN_H` is Rec 16 text, not separately graded); `HYBRID_*` (Rec 15, B-III);
   `RRT_NO_SAMPLE_AFTER_SESSION_H` (2 h, the guideline's hybrid text, not separately graded); and
   `FUTURE_LEVEL_TOLERANCE_H` (one minute, D26's refusal tolerance, named in D28). `PD_K_FLOOR` (1e-4) is a search
   bound, not a clinical constant. The haemodialysis reading's four settings are the user's own and ship with no
   value. Prefer a rule that needs no weight at all: the exposure matrix replaced a composite
   ranking score precisely because it needs none.
9. **Do not weaken a test to make it pass.** If a threshold is wrong, say why in the file and
   in the decisions doc, and record the numbers that justify the change.

## Testing

No install required.

```bash
node phase2d_validation.cjs
```

| Suite | Expected |
|---|---|
| `phase2d_validation.cjs` | **719/719 pass** (`EXPECTED_TOTAL`; the run fails if the count differs). Also under `TZ=Pacific/Auckland` and `TZ=UTC` |
| `phase3_simulation.cjs` | **21/21 pass** (count pinned) |
| `phase4_regimen_validation.cjs` | **49/49 pass** (count pinned) — regimen detection: the real q12h→q8h case, ten spec scenarios, nine spec defects, dose change at a fixed interval |
| `docs/audit/mutation.cjs` | **127 of 127 killed, exit 0** — one textual mutation at a time, in memory, against phase2d, phase3 and phase4. Joins the release gate for clinical releases. Exit 1 on a survivor or a timeout, 2 on a setup error. Do not run it beside the browser flows (they time out on a shared machine) |
| `phase2d_comprehensive_validation.cjs` | Scenarios 1, 2, 5, 6 pass; **3 and 4 fail by design** — the accepted Goti 2-comp limitation, see `docs/validation-threshold-decisions.md` |
| `docs/audit/engine-parity.cjs --ref <sha>` | **0 differences** for any presentation change — 225 engine calls compared value by value against the file at `<sha>`. A clinical change lists and explains every difference in its decision record: v3.14.0 against `edc5b53` reads 72 (D26); v3.15.0 against `b410477` reads 23 (D27); v3.16.0 against `bcee5dd` reads 0 (D28: the corpus reaches no dialysis path). The script prints the first 40 |
| `docs/audit/pd-parity/` | The PD parity guard's scripts (D28, R87): `capture.cjs`, `replay.cjs`, `encode.cjs`, `load.cjs` and `fixtures58.json` regenerate SUITE 46.44's digests (58 PD calls at 9 significant digits) from any commit, e.g. the released `bcee5dd` |
| `docs/audit/browser-flows.cjs` | **266/266** — real clicks and keystrokes under the production CSP, desktop and 375px. Needs Playwright (not a dependency of this repo): `python3 docs/audit/serve-csp.py &` then `PLAYWRIGHT=<path>/node_modules/playwright node docs/audit/browser-flows.cjs` |

**Version.** `APP_VERSION` (and the header and print-header markup, SUITE 36) is bumped every
release: minor for a clinical behaviour change or a new feature, patch for fixes and wording, major
for an engine or model overhaul. The history table is in the README. The release that adds a suite pins
its version there (43.12 for v3.14.0, 45.58 for v3.15.0, 46.91 for v3.16.0); the earlier pins accept a successor.

**CI.** `.github/workflows/test.yml` runs on every push and pull request (`permissions: contents: read`,
actions pinned by commit SHA, Node 22, no install): the syntax check, phase2d, phase2d under
`TZ=Pacific/Auckland`, phase3, phase4 and the mutation gate. The browser flows and engine parity are run by
hand at release.

Syntax check after any edit (exits 1 when broken):

```bash
node -e "const fs=require('fs');const m=fs.readFileSync('index.html','utf8').match(/<script>([\s\S]*?)<\/script>/);try{new Function(m[1]);console.log('JS syntax: OK')}catch(e){console.log('JS BROKEN:',e.message);process.exit(1)}"
```

The suites extract the engine from `index.html` into a Node `vm` and test the shipped file.
`const`/`let` are not visible as sandbox properties — that is why `harness_constants.cjs`
exists. Pure `function` declarations are.

## UI work

**No inline `on*` handlers. Ever.** The app ships under a hash-pinned CSP with no
`'unsafe-inline'` and no `'unsafe-hashes'`. A hash authorises the `<script>` **block**; it
does **not** authorise event-handler attributes. Inline handlers therefore die silently in
production — the page renders, the engine loads, and nothing responds to a click.

Handlers live in the `__ACT` registry and are bound by delegation (`__bindActions` →
`__dispatchAction`, which runs own keys only, `Object.hasOwn`). A handler that throws is logged and
shows one plain line, `#action-status` (`showActionFailure`, Dismiss `k101`); never the error text.
To add one: add an entry, then put `data-onclick="kN"` (or `data-oninput` / `data-onchange` /
`data-onkeydown`) on the element, plus `data-arg="${...}"` if it takes a value. Delegation
also means markup rendered later via `innerHTML` is bound for free. `SUITE 14` fails the
build if an inline handler, a `javascript:` URL, or an `eval`-family call reappears.

**Verify UI changes with a real click, in a browser, under the production CSP** — not by
calling the function from the console. Every check that missed the CSP failure above was
programmatic. `docs/audit/serve-csp.py` serves the file locally under the real policy, and
`docs/audit/browser-flows.cjs` drives it the way a pharmacist does.

Design language: `DESIGN.md` (with `.impeccable/design.json`) records it; `PRODUCT.md` records
who it is for and the decisions it rests on. Bone paper and ink; DM Serif Display for the
regimen and section titles, Outfit with **tabular figures for every number — no monospace**.
Terracotta marks only the recommendation, the selected cell and a projection; one muted alarm
hue marks top-tier safety, always beside a signal word and a drawn icon. **Terracotta text uses
`--terracotta-ink`** (5.9:1 on paper); raw `--terracotta` is 3.0:1 and fails as text. Full
token set in `:root`.

Rules the 2026-09 design pass learned the hard way:

- **No glyph icons.** "⚠", "💡", "✓" render as colour emoji on some platforms. Use the drawn
  `ICON` set (`alarm`, `caution`, `info`) — `noteHTML()` for results, `cautionHTML()` for an
  input-panel warning.
- **Doses print in ISMP form** through `fmtDose` / `fmtRegimen` ("1 g", "1.25 g IV q12h").
  Strings the *engine* returns (`bayesDoseOptimizer().reason`, `frequencyLabel`) are engine
  output: engine parity compares them, so they are not reformatted in place.
- **Test an input formatter as a typed sequence**, not one event per value. `formatTime24Input`
  passed every single-event test and still turned a typed "08:00" into "08::0".
- **A label on a chart must avoid what is drawn**, markers included: the trough-band label
  scans the band's edges for a clear place rather than trusting a corner.
- **Model and measurement never share a colour.** On a concentration chart the fit and everything
  it predicts (band, ring at each level, cursor) wear `--series-fit`; measured levels wear
  `--series-measured` (since 2026-10-02; values beside them stay ink) and a hairline joins each to
  the fit's ring (the residual); the population prior is an `--ink-soft` long dash; the projection is
  `--series-projection`. A fourth series hue failed the colour-vision validator, which is why the
  prior is a neutral. The legend
  swatches (`.lg-*`) read the same tokens as the canvas, and a chart's summary never names a colour.
  The Tinkerer and the regimen comparison follow it too: tried regimens are projections, so in the
  comparison they share the projection's hue family and differ by line pattern (`COMPARE_STYLES`,
  six at most — a style is never reused, never cycled). The Trough module's "Try another regimen"
  draws its own comparison with the same renderer and never redraws the result chart. It replays
  from `_txTinkView` (what was predicted), not from the inputs. The Trough dose explorer keys
  the rows its chart draws (`doseExplorerRows` `cur` / `rec` / `opt`): the chart legend's line
  and word, text in text tokens, terracotta only on the recommendation.
- **The course strip and the curve share one time axis** (`profileDomain` + `PROFILE_PAD`) and
  one cursor (`canvas._pkCursor(t)`). Anything new drawn on either must use that axis.
- **Screenshots:** `html` has `scroll-behavior: smooth`, so `scrollTo` animates; capture after
  `scrollTo({ behavior: 'instant' })` or the sticky header lands mid-page in a full-page shot.

**Shape and depth are mirrored from ainadara.com, and the site's vocabulary is small:**

| | The site uses | So this file uses |
|---|---|---|
| Rectangular radius | `4px`, one value | `--radius-sm/md/lg`, all `4px` |
| Pill | `999px` | `--radius-pill` — chips, badges, the switch |
| Circle | `50%` | dots and the brand mark |
| `box-shadow` | **none, anywhere** | focus rings only |
| Gradients | the page atmosphere only: three faint radials of terracotta, purple and moss on the ground | the same wash on `body`, mirrored; on components, only the therapeutic-range gauge, which is data |

Depth comes from a hairline (`--rule`), a background step (`--paper` → `--paper-deep`),
and a small hover lift — never a shadow. Selection is a background step plus terracotta
ink, never a nested border: a bordered group holding bordered items each with their own
shadow is what made this read as a stack of boxes.

**Every colour must come from a token.** Two classes of bug lived here and both were
invisible until dark mode: 17 hard-coded near-whites (`rgba(240,239,235,α)`) that painted
light slabs on dark paper, and legend swatches hard-coded to a *fallback* hex while the
plot drew from the token — so the key disagreed with the curve. Canvas is the one
exception, because it cannot resolve a custom property: use `themeColor()` /
`themeRGBA()`, never a bare literal and never `var(--…)`.

Used on macOS, Windows and Android. Touch targets ≥44px, no horizontal scroll at 375px,
readable without zoom, and the `@media print` block must keep working.

Canvas graphs set colours in JS, not CSS (`ctx.fillStyle` / `ctx.strokeStyle`). **Every one
must go through `themeColor()` / `themeRGBA()`** — a bare literal will not re-theme, and
`var(--x)` is silently ignored by canvas. `SUITE 12` enforces this by drawing the same graph
under two palettes and requiring every colour to change.

### Reading a graph is a clinical act

These charts are read to estimate a concentration at a timepoint, so what is *drawn* has to
be true, not merely pretty:

- **Markers must lie on the curve.** Sample the polyline at the breakpoints (end of infusion,
  interval boundary) as well as on the grid — a uniform step misses `t = tinf` whenever the
  infusion time is not a multiple of it, and the peak dot then floats above the line.
- **X ticks come from the interval, not a constant.** `tau/2` gives exactly seven ticks and
  puts every dose boundary on one, for every interval from Q4H to Q72H. The old fixed 8 h
  step aligned with nothing at Q6H/Q12H/Q18H and drew nineteen labels at Q48H.
- **The axis must contain everything drawn on it** — the target band and any observed level,
  not just the curve. Deriving the top from the curve alone painted the band off-canvas for
  any regimen whose peak fell below the target ceiling. `profileDomain` reaches every measured
  level: on a long course with doses held, a level drawn days after the last dose fell past the
  48 h tail and vanished from the curve and the strip while the fit used it (fixed 2026-10-02).
- **The arrival is the one animation** (2026-10-02, the user's request): on a new result the curve
  traces in and the levels land (`PROFILE_ARRIVE_MS`), gated by `refreshProfileGraph` on result
  identity and `profileMotionOK()`. Never animate a redraw, reduced motion or print, and the last
  frame must equal the static drawing (the harness only ever sees the static path).
- **The target band is the clinician's own**, never a hard-coded 10–20.
- **Never rescale one series onto another's axis.** The comparison chart used to stretch each
  regimen onto the longest interval, so a Q6H trough was drawn at 12 h under an axis reading
  12 h. Plot true elapsed time and repeat the cycle instead.

`redrawAllCanvases()` must replay every renderer on a palette change, and must **not** swallow
errors — it previously called a `drawGraph()` that does not exist, inside an empty `catch`, so
the trough-based graphs kept their light-theme colours on the dark page for months.

Results are built as HTML strings via `innerHTML`. **Any user-entered value interpolated into
one must go through `escHtml()`.** About 180 call sites do (182 on 163 lines, 2026-11-17, v3.16.0); the
2026-11-13 review's hostile-profile probe found one gap (the profile id in `data-arg`), closed in v3.14.0.

## Where things are

| Path | What |
|---|---|
| `PRODUCT.md` | Who this is for, the binding constraints, and the design decisions the user made |
| `DESIGN.md`, `.impeccable/design.json` | The design system as shipped (the course-timeline results) |
| `.impeccable/surfaces/index-html.md` | The results surface brief and its direction contract |
| `docs/audit/serve-csp.py`, `docs/audit/browser-flows.cjs` | The app under the production CSP (bound to 127.0.0.1), and the 266 real-input checks |
| `docs/audit/engine-parity.cjs` | Proves a presentation change left the engine's output untouched |
| `docs/audit/mutation.cjs` | The mutation gate: 127 mutants, each must be killed by the Node suites |
| `docs/audit/pd-parity/` | D28's PD parity guard: the fixtures and the replay that regenerate SUITE 46.44's digests from a released commit |
| `.github/workflows/test.yml` | CI: the Node suites and the mutation gate on every push and pull request |
| `docs/audit/probe-map-starts.cjs`, `docs/audit/uncertainty-by-model.cjs --early`, `docs/audit/probe-hold-rate.cjs` | D27's evidence: the MAP starts, the early band and its decision flips (`docs/audit/task19/`), and how often the Hold fires and is false (`docs/audit/task21b/`) |
| `docs/audit-2026-09.md` | Code and math audit — findings, what was verified against which paper |
| `docs/ui-and-graphics-audit-2026-09.md` | UI + rendering audit — 66 findings, what was fixed, what is deliberately open |
| `docs/validation-threshold-decisions.md` | The accept/reject record for failing thresholds |
| `docs/audit/` | Probe scripts that reproduce each finding numerically |
| `docs/audit/probe-hd-one-time.cjs` | D17's one-time HD dose against VancoPK's published HD method, on fictional cases |
| `docs/audit/probe-v3-case-34m.cjs` | Reproduces the v3 case end to end: both posteriors, the Q48H recommendation, the lattice bias, and the cross-midnight wrap |
| `docs/v3-decisions.md` | What v3 changed, what was rejected, and the numbers behind each |
| `docs/dosemerx-comparison.html` | Capture sheet for pairing this tool against DoseMeRx at the workstation. Also served at `/vancomycin/compare/` |
| `harness_constants.cjs` | Extracts model constants from `index.html` for the suites |
| `Phase2_Plan.md` | Bayesian architecture reference |
| `Vancomycin_TDM_Software_Instructions.md` | Clinical source-of-truth |
| `validation_report.md` | **Phase 1 only, April 2026** — predates the Bayesian engine |
| `archive/` | The abandoned React branch and a superseded recommendations note (the March build was removed 2026-11-15: it carried an institution's private guideline) |

Reference PDFs live one level up, outside this repo — it is public and they are third-party
papers.

## Verified model parameters

Goti 2018 is verified parameter-by-parameter against Table 2 and Methods (15 of 16 exact; the
16th was a defect, fixed). Buelga 2005 is verified against the published general model.
**All eight models are now verified** against primary sources in `Literature/` — see
`docs/audit-2026-09.md`. Two carry caveats worth knowing: Matzke's Vd split on CrCl 60 uses a
covariate the paper explicitly disclaims (A10), and the VancoPK clearance equation rests on
site documentation rather than peer review (A11). Goti's SCr threshold is **65**, per the 2019
erratum — the 2018 Methods text says 60 and is a known typo. Do not "correct" it.

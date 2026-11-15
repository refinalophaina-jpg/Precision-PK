# Engine review: clinical logic and decision paths

Vancomycin TDM calculator, branch `v3.14.0-continue-current`, HEAD `32988d9` (release candidate, held).
Reviewer lane: everything that turns a fit or a set of inputs into advice. Date: 2026-11-13/14.
All patients are fictional. The repo was not edited.

## What was run

| Check | Result |
|---|---|
| `node phase2d_validation.cjs` | 478/478 |
| `node phase4_regimen_validation.cjs` | 49/49 |
| `s1.cjs`: `regimenDecision` invariant sweep, Buelga, 267,120 decisions (CL 0.4–14, three volumes, q6–q48h, 500–3,000 mg, 0–3 levels, targets 400–600) | No "never worse" violation: 0 changes with fewer dots (non-safety), 0 in-band to out-of-band, 0 "no-better" on an in-band regimen |
| `s1.cjs 2c`: the same on a two-compartment grid, 20,160 decisions | 0 violations |
| `s2.cjs`: "continue, no better" against `nextLevelValue`, 72,000 decisions | 978 contradictions, all cap-bound (M1) |
| `t1`–`t9.cjs`: the real page under the production CSP at `localhost:8777`, driven with Playwright | Findings below; no console or page errors in any run |

Scripts were in the reviewer's local scratch directory (not part of this repository). `lib.cjs` and `tlib.cjs` drive the page; `vmlib.cjs` loads the engine in a Node `vm`.

**Not covered:** the peritoneal dialysis mode (`pdIntervals`, `pdAnswer`) was not exercised. The print report was read but not rendered (my probe called it wrongly and returned nothing). Hughes was exercised only through the shared decision code. The loading-dose calculation was read, not probed. Treat these as unreviewed in this lane.

**What held up.** The D25 guarantee held over both sweeps. Regimen detection, the override, the two-level cross-midnight path, the level-before-first-dose exclusion (with a note), the haemodialysis hold on a pre-HD level above 20, and the Rec 13 table with its 3 g cap all behaved as documented.

---

## Critical

### C1. A supratherapeutic patient is given a time for the next dose, with no hold

- **Where:** `index.html:9639` `firstDosePlan`, `9664` `firstDoseReadoutHTML`, `13490` (call), `10685` `regimenDecision`. Trough module: `7088–7156` (steady-state level path).
- **Input (ran, `t3.cjs` F1; `t4.cjs`):** 60 M, 80 kg, 178 cm, SCr 3.0, Buelga. 1.5 g q8h × 6 (2 h infusions), last dose 6 h ago. One level, 48 mg/L, drawn 1 h ago.
- **Output:** "Change from 1.5 g IV q8h" → **500 mg IV q12h**. "First dose 14 Nov 04:49 [6 h from now] · then 04:49 and 16:49 daily · **level by then 43.3 mg/L**". The only signal is a caution, "First 24 h AUC₂₄ 962, above 400–600, steady state unchanged". The word "hold" appears nowhere in the result.
- **Same patient on Goti (F2):** 250 mg IV q8h, first dose in 2 h, "level by then 49.1 mg/L".
- **Why it is wrong:** the engine's own danger threshold is a trough of 20 mg/L (`TROUGH_HIGH_MGL`). It sets the current regimen aside for a predicted trough of 79, then schedules the next dose at a fitted pre-dose concentration of 43–49, with no tone on the number. The first dose is timed as "last dose + the new interval", which ignores the concentration. The Copy summary repeats the regimen and omits the level-by-then.
- **Trough module, same class (ran, `t5.cjs` T5):** a steady-state level of 45 mg/L on 1.5 g q8h gives "Dose reduction indicated · 500 mg IV q8h" and no hold or re-dose time. `timeToDecayTo` (7694) exists, but only the random-level PRN panel uses it.
- **Proposed change:** in `firstDosePlan`, when the fitted concentration at the planned first dose is at or above the threshold, the answer leads with "Hold", gives the time the fitted curve falls below it, and defaults the first dose to that time. The level-by-then number takes the alarm tone. Carry it into print, Copy summary and the screen-reader text. The threshold is a policy choice (Decision 1).
- **Test first:** SUITE: with the F1 inputs, a plan whose `pre >= 20` must return `hold: true` and a `resumeH` at which `predictFittedAt < 20`. Browser flow: the verdict contains "Hold" and the first-dose time is not earlier than `resumeH`.
- **Effort:** M.

### C2. The Trough module recommends doses the AUC module hard-rejects, for the same patient

- **Where:** `index.html:6475` `findOptimalDose` (candidates run to 4,000 mg per dose; no daily cap; no AUC ceiling), against `10345–10346` `DOSE_MAX_PER_DOSE_MG` 2,000 and `DOSE_MAX_TDD_MG` 4,500, and `10343` `AUC24_ABSOLUTE_MAX` 700, which only AUC Precision applies.
- **Input (ran, `t6.cjs` T2/T2b/T2c, `t7.cjs`):** 25 M, 95 kg, 185 cm, SCr 0.5, Trough → Initial dosing.
- **Output:** q8h → **2.5 g IV q8h** (7.5 g/day), "AUC therapeutic". q12h → **3 g IV q12h**. q24h → **4 g IV q24h**. CrCl is shown as 303.5 mL/min (uncapped on the VancoPK clearance model), and no augmented-clearance advisory appears.
- **Same patient in AUC Precision:** 1.5 g IV q8h, CrCl limited to 150, with the "Augmented renal clearance suspected" caution.
- **Related outputs from the same cause (`t6.cjs`):**
  - Level mode, a level of 0.1 mg/L at 11.5 h (T8b): fitted CL 25.4 L/h, "Dose increase indicated" → **4 g IV q12h**.
  - Level mode, a level of 190 mg/L (T8): the headline regimen is 250 mg IV q12h at **AUC₂₄ 1,187, trough 47.3**.
  - Initial mode, CrCl 6.5 at q12h (T3b): 250 mg q12h at AUC₂₄ 940.
  - The last two lead with a regimen above the engine's own absolute ceiling; the only signal is a caution, "Target not reachable at this interval".
- **Why it is wrong:** two modules, one patient, daily doses 1.7 times apart. The larger one is empiric, rests on a Cockcroft-Gault value of 303 and carries no warning. Rule 2 (one implementation per concept) is broken for the dose ceilings.
- **Proposed change:** apply the three existing limits in `findOptimalDose`. When nothing admissible is in band, show the refusal or the cap-bound alarm (`capBoundFlag`) instead of a headline regimen. Show the augmented-clearance advisory in the Trough module from the same `detectARC`.
- **Test first:** SUITE: for the patient above, `findOptimalDose` at q8/q12/q24 never returns a dose above 2,000 mg or a daily dose above 4,500 mg; a returned regimen with AUC₂₄ above 700 is marked a refusal.
- **Effort:** M. Whether the ceilings should bind the Trough module is the user's call (Decision 2).

---

## Important

### I1. Severe renal impairment: AUC Precision refuses, the Trough module doses

- **Where:** `index.html:8427` `detectVeryLowCrCl` and the hold at `13499`, AUC Precision only. `calculate()` at `6863` has no equivalent.
- **Input (ran, `t7.cjs`):** 85 F, 45 kg, 155 cm, SCr 4.5 (CrCl 6.5 mL/min), no level.
- **Output:** Trough → Initial, q48h: **500 mg IV q48h, "AUC therapeutic"**, no advisory. AUC Precision: **"No empiric maintenance regimen"** plus the alarm note.
- **Proposed change:** one shared gate; the Trough module shows the same advisory and withholds the maintenance regimen before a level.
- **Test first:** browser flow asserting both modules withhold a maintenance regimen for this patient with no level.
- **Effort:** S.

### I2. "A further level would add little" beside "a further concentration is recommended"

- **Where:** `index.html:11016` `nextLevelValue` (the `gain < NEXT_LEVEL_MIN_GAIN` branch), `13275` (Next line), `5571–5578` `FIT_BANDS` substantial `action`.
- **Input (ran, `t3.cjs` E1, `t4.cjs`):** 76 M, 70 kg, 175 cm, SCr 0.5, Buelga, 1 g q12h × 4, one level 19.9 mg/L at 11.5 h.
- **Output, one screen:**
  - Verdict: "Continue the current regimen", Low confidence, "The fit misses a level by 2.1 SD. This dose was generated from a fit the tool itself does not trust. Across the clearance estimates this regimen spans AUC₂₄ 248–806."
  - Next: "A further level would add little — the maintenance regimen lands in the same place either way."
  - Fit vs measured: "A further concentration is recommended before relying on this exposure estimate."
  - Models: "the next step above says whether a further level would change the dose."
- **Cause:** the 1→2 level narrowing is 14.3% on Buelga and 9% on Hughes, both under the 15% preference. So **every one-level fit on those two models reads "would add little"** unless the AUC is outright outside the band. The widths were simulated for patients drawn from the prior; they do not describe a prior–data conflict.
- **Proposed change:** `nextLevelValue` takes the fit state. With a worst residual of 2 SD or more, a second MAP solution, or Low/Very low confidence, the answer is "a further level is recommended" and the precision branch is not reached. One sentence, used by all three panels.
- **Test first:** SUITE: the E1 fit must not return `kind: 'precision'`; the result text must not contain both sentences.
- **Effort:** S.

### I3. A level dated in the future is fitted without comment

- **Where:** `index.html:12095–12109` (the level filter in `runBayesian`): only "before the first dose" is checked.
- **Input (ran, `t2.cjs` C2):** 55 M, 80 kg, 1.25 g q12h × 4 (last 11 h ago), a level of 15 mg/L dated **30 h from now**.
- **Output:** fitted (CL 3.45 against a prior of 6.12), "Change from 1.25 g IV q12h" to 1.75 g q24h on safety grounds (predicted trough 25.6). No note about the date.
- **Why it matters:** a future dose row is a planned dose. A future level can only be a wrong date, and here it turns an in-range regimen into a safety change.
- **Proposed change:** refuse a level dated after the fit time, naming the row (the same class as F-002).
- **Test first:** browser flow: the C2 inputs give a form error naming "Level row 1", and no result.
- **Effort:** S.

### I4. Saving a profile from the Trough module can save the previous patient

- **Where:** `index.html:14848` `snapshotPatientCore` (`val(f.bayes) || val(f.trough)`), `14761` `snapshotBayesForm`, `8201` `clearWithUndo` (clears one column, D24).
- **Input (ran, `t9.cjs` P1):** patient A (80 F, 50 kg, SCr 2.5, two doses, one level) run in AUC Precision. Switch to Trough, "Clear all fields", type patient B (30 M, 90 kg, 185 cm, SCr 0.8), save as "Patient B".
- **Output:** the profile holds age 80, 50 kg, 150 cm, SCr 2.5, **A's two doses and level, with B's sex (M)**. Loading it fills both modules with that hybrid.
- **Proposed change:** read the core from the module being saved from; refuse or warn when the two columns disagree on a shared field; a Trough save does not carry the other column's course.
- **Test first:** browser flow reproducing P1; the saved core must equal the Trough fields, or the save must be refused.
- **Effort:** S–M.

### I5. Loading a profile leaves the previous patient's Trough-only fields

- **Where:** `index.html:14962` `loadProfileIntoForm` (calls `resetBayesian`, never `resetForm`); `14863` `applyPatientCore` skips empty values.
- **Input (ran, `t9.cjs` P2):** patient D in Trough (82 F, SCr 1.9, cystatin C 2.4, baseline SCr 0.8, level mode, dose 1,500, level 31, "has level" ticked). Load "Patient C" (45 F, SCr 0.9, saved from AUC Precision, no cystatin C).
- **Output:** age and SCr become C's. **Cystatin C 2.4 stays**, and the panel tells patient C that Cockcroft-Gault "reads materially HIGHER than the cystatin C estimate… a creatinine-driven dose may be too high" (+106%). The AKI banner still reads "SCr 1.9 ≥ 1.5× baseline 0.8". Dose 1,500, level 31 and the ticked level box remain, so pressing Calculate fits D's level to C's demographics.
- **Proposed change:** a profile load clears the Trough column first, then applies the core; empty core values clear the field.
- **Test first:** browser flow reproducing P2: after the load, `cysc`, `scr-baseline`, `dose` and `level-val` are empty and both advisories are hidden.
- **Effort:** S.

### I6. Two-level, steady-state basis: levels outside the interval are accepted, and volume has no plausibility bound

- **Where:** `index.html:6961–7001` (guards) and `5198` `solveTwoLevelsPK`.
- **Input (ran, `t6.cjs` T6c):** steady-state basis, patient on q12h, 1 g over 1 h; level 1 25.9 mg/L at 2 h, level 2 12.95 mg/L at **56 h** after the dose entered.
- **Output:** Kel 0.0128, **Vd 265.3 L** (3.3 L/kg), "750 mg IV q12h, AUC₂₄ 440, in range". No warning.
- **Why it matters (read):** on a steady-state basis, a level later than the current interval means another dose was given in between, or the dose time entered is an earlier dose. The slope survives; the peak back-extrapolation does not, so volume and clearance are wrong. The first-dose basis legitimately allows late levels; the steady-state basis does not.
- **Proposed change:** on the steady-state basis, refuse when either level is later than the interval the patient was on. Caution on a solved volume outside a stated plausible range (a number the user must source or label as preference).
- **Test first:** SUITE: `calculate()` with the T6c inputs returns a form error naming the level times.
- **Effort:** S.

### I7. No input or guard for continuous or prolonged renal replacement (the coordinator's two leads, verified by reading)

- **Where:** "CRRT" occurs once in the file, `index.html:13409`, inside the very-low-CrCl advisory. No CRRT, SLED or PIRRT field exists. `detectVeryLowCrCl` (8427) is the only path to that sentence.
- **Consequence (read, not run: there is nothing to enter):** a patient on CRRT whose Cockcroft-Gault CrCl is 10 mL/min or more is fitted as an ordinary patient by every model, in both modules, and never sees the sentence. The Trough module has an HD box and a PD mode; AUC Precision has HD and PD refusals; neither asks about CRRT.
- **Second lead, verified:** `INPUT_LIMITS.hdHours` is 0.5–12 h (`5928`, commented as a plausibility limit, used at `8714` and `9490`). A CRRT or SLED run entered as a session over 12 h is refused as a session length out of range, with no word about why. Up to 12 h it is accepted and treated as intermittent HD.
- **Proposed change:** a renal-replacement choice (none, intermittent HD, PD, CRRT/SLED) in both modules; CRRT/SLED refuses with a "not modelled" notice, as PD does in AUC Precision. The over-12 h message says prolonged or continuous therapy is not modelled.
- **Test first:** browser flow: CRRT chosen → no regimen in either module; a 14 h session → the message names prolonged therapy.
- **Effort:** S–M.

---

## Minor

### M1. Cap-bound "Continue" beside "a dose change is indicated"

- **Where:** `index.html:13260` (the Next line reads `rec.auc24`), `11016` `nextLevelValue` `outright` branch.
- **Input (ran, `s2.cjs`):** CL 12.34 L/h, 1.5 g q8h established, no level (AUC₂₄ 365). 978 of 1,027 "continue, no better" cases in the sweep, all cap-bound.
- **Output:** verdict "Continue the current regimen"; Why this dose: "The estimate already sits outside 400–600, so a dose change is indicated on the data you have."
- **Change:** when the action is continue, the outright branch says the regimen is at the ceiling. **Effort:** S.

### M2. "No admissible regimen puts more in range" when one does, set aside for its trough

- **Where:** `index.html:10718`, `10778`.
- **Input (ran, `s2.cjs`):** CL 0.42 L/h, V 60 L, 250 mg q48h established, 3 levels (AUC₂₄ 295, 0 of 20). 500 mg q48h reaches 595, but its trough is 20 or more.
- **Output:** "…no admissible regimen puts more in range", and Next "A further level would add little".
- **Change:** say that the regimens with more in range were set aside for a trough of 20 or more. **Effort:** S.

### M3. Toggles that survive "Clear all fields"

- **Where:** `index.html:8247` `resetForm`.
- **Input (ran, `t9.cjs` P3):** choose CrCl weight IBW and "steady state: No", then Clear all fields.
- **Output:** `dosingWt` stays IBW and `isSS` stays false for the next patient (`tlBasis` likewise, by reading). The buttons still show the choice, so it is visible. The CrCl override box was reset for this same reason; these were not.
- **Change:** reset them with the form, or decide they are settings (Decision 7). **Effort:** S.

### M4. A planned-only schedule is "the current regimen"

- **Input (ran, `t2.cjs` D4):** four future 1.25 g q12h rows, nothing given, no level.
- **Output:** "Continue the current regimen" at AUC₂₄ 408 with 9 of 20, while the target box alone gives 1.5 g q12h (490, 10 of 20).
- **Change:** word it as the planned regimen, or require one given dose. **Effort:** S.

### M5. Loading-dose ceilings differ between notes

- **Where (read):** `index.html:13404`, severe-renal note, "15–20 mg/kg, max 2 g"; `13376`, augmented-clearance note, "25–30 mg/kg, max 3 g"; `8903` `HD_LOADING_MAX_MG` 3,000 (Rec 11).
- **Change:** one stated cap, or each sourced where it stands. **Effort:** S.

---

## Enhancement

- **E1. A level drawn during an infusion decides a safety change.** Ran (`t2.cjs` C3): 28 mg/L drawn 30 min into a 1.5 h infusion is fitted; the predicted trough becomes 20.2 and the answer is "Change… because its predicted trough of 20.2 mg/L is at or above 20". The caution is shown. Whether such a level should be excluded, or should cap confidence, is policy.
- **E2. A dialysis-distorted only level sizes the HD dose at "Moderate confidence".** Ran (`t8.cjs` H4, H5): one level drawn during a session, or 30 min after it, gives "1 g IV after HD" with the timing caution. A post-session level reads low, so the dose runs high.
- **E3. Print and Copy summary for C1.** Once the hold exists, both need it. The Copy summary today carries no first-dose information at all.

---

## Decisions for the user

1. **Hold threshold (C1).** At what fitted pre-dose concentration should the tool say "hold" and delay the first dose: 20 mg/L (the existing danger trough), the top of the user's trough range, or another figure? Should the Trough module give a re-dose time from the fitted elimination rate?
2. **Dose ceilings in the Trough module (C2).** Should 2 g per dose, 4.5 g per day and AUC₂₄ 700 bind there as they do in AUC Precision, or does the Trough module deliberately allow more? Should it also limit CrCl to 150 on every clearance model?
3. **A charted dose above 2 g.** The sweep has 7,200 decisions where an in-range regimen with a trough under 20 (for example 2.25 g q48h) is "set aside because single dose 2250 mg exceeds 2000 mg". Is a charted dose above the conventional ceiling unsafe, or only not recommendable?
4. **Severe renal impairment in the Trough module (I1).** The same hold as AUC Precision, or advisory only?
5. **Second level after a conflict (I2).** Is "a further level is recommended" the right answer whenever confidence is Low or the fit misses by 2 SD or more?
6. **CRRT and SLED (I7).** Refuse outright in both modules, or allow with an alarm? What session length separates intermittent HD from prolonged therapy?
7. **Defaults that assume a state.** Sex and "which dose" have no default by design; "steady state: Yes", two-level "first dose" and random-level "first dose" do. Should they start unset? Should the CrCl weight basis and these toggles reset on Clear all (M3)?
8. **Levels the model cannot read well (E1, E2).** Exclude, cap confidence, or leave as a caution: a level drawn during an infusion; a level drawn during or soon after a dialysis session.
9. **Still open from D25's own review:** a rising creatinine or AKI does not gate "Continue"; deciding from the 0-level dots; HD sessions logged under a non-HD model. Not re-tested here.

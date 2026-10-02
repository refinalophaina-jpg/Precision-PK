# One-time haemodialysis dose when the schedule is unknown — design (D17)

Date: 2026-10-02 · Status: proposed · Builds on D16 (HD dosing, shipped in `6c1ed2b`, minors in `9710104`).

## Why

The D16 post-HD dose needs **two upcoming sessions**: one for the dose to follow, and one to size
the pre-HD level at. With fewer, `hdNextDose` returns `need: 'sessions'` and the verdict says
"Add the next sessions". Pharmacists often don't know the schedule: ED and ICU admissions,
transfers, AKI on HD, a pending nephrology decision. They still have to answer "give vancomycin
now? how much?".

The handoff's own case gets no answer today:
- 1 g dose, HD the same day, no dose after it;
- a level of 10.3 mg/L about 12 h after HD ended.

**Goal:** when fewer than two upcoming sessions are logged, give a one-time dose, sized for an
assumed gap to the next session that is stated and can be changed in one tap. Flag a missing
post-HD dose. Say plainly what the answer cannot know.

## Decisions (with the user, 2026-10-02)

- **No mode toggle.** The one-time answer appears automatically wherever D16 returns
  `need: 'sessions'`. A logged schedule keeps the D16 answer unchanged.
- **Gap to the next session:** 24, 48 or 72 h, counted from the dose. Default **48 h**, the
  shorter gap of a thrice-weekly schedule; it is a PREFERENCE under rule 8. The gap is stated in
  the answer and never hidden.
- **Declined from the handoff, with reasons:**
  - **Estimated rebound concentration.** It was rejected in D15. Goti-HD averages dialysis and has
    no rebound phase to read. In the handoff's example the level is 12 h after HD, past
    redistribution, so it already contains the rebound. Levels inside the redistribution window
    are already labelled (D15).
  - **P(AUC₂₄ > 400) / P(AUC₂₄ > 600).** `AUC_UNCERTAINTY` was simulated for steady-state Goti
    dosing (1000 mg q12h), not for a single dose on HD. Goti-HD already says it was not simulated
    separately. A probability built from it would be precision without a source.
  - **A new High/Moderate/Low grade.** The fit's existing confidence grade and the
    "provisional" marking (`conf.rank >= 2`) are reused unchanged. Uncertainty specific to this
    answer is stated in words: the next session is unknown.
  - **The handoff's "500 mg" and "repeat in 24–48 h".** The engine computes the dose; nothing is
    tuned to match an example. "24–48 h" has no source, so the next step says "before the next
    session".

## Sources

The same as D16, Rybak 2020 (AJHP 77:835–864):
- **Recommendation 14:** pre-HD 15–20 mg/L.
- **Text:** maintenance is given with every session.

The **15–20 target** (`HD_PREDIALYSIS_MIN`/`MAX`), **250 mg rounding** (`MATRIX_DOSE_STEP`), the
**2,000 mg per-dose ceiling** (`DOSE_MAX_PER_DOSE_MG`) and **infusion times** (`autoTinf`) are
reused. No new clinical constant.

## Components

### Shared choice rule — `hdPickDose(r, doseAtH, readAtH)`

D16's selection, extracted from `hdNextDose` with **no change in behaviour** (engine parity and
SUITE 35 prove it):
- Candidates: 0, then 250…2,000 mg in 250 mg steps, each with `autoTinf`, appended at `doseAtH`.
  Each is read on the fitted curve (`predictFittedAt`) at `readAtH`.
- **hold** if 0 mg reads at least 15 (reason `above` or `in`).
- Otherwise the smallest dose reading 15–20 (**dose**).
- Otherwise the closest (**closest**). If the closest is 0, it is **hold** with reason
  `overshoot`.
- Returns `{kind, reason, mg, tinfH, pre, rr}`, where `rr` is the result with the chosen dose
  appended.

`hdNextDose` calls it. Its output is identical.

### One-time dose — `hdOneTimeDose(r, nowH, gapH)`

Called by `hdViewFor` when `hdNextDose` returns `need`.

- **Dose time:** if exactly one session is upcoming, by D16's test (in progress, still to come,
  or ended under `HD_POSTSESSION_DOSE_WINDOW_H` ago with no dose since), the dose follows it:
  `doseAtH = max(endH, nowH)`, `after = session.n`. Otherwise `doseAtH = nowH`,
  `after = null` ("now").
- **Read time:** `readAtH = doseAtH + gapH`. `gapH` must be one of `HD_ONE_TIME_GAPS_H = [24, 48, 72]`;
  anything else falls back to `HD_ONE_TIME_GAP_DEFAULT_H = 48`.
- **Planned dose:** a future dose entered from the dose time up to `readAtH` is **read, not
  replaced**, as in D16. The result is `kind: 'planned'`, with the pre-HD level at `readAtH`.
- **Otherwise:** `hdPickDose(r, doseAtH, readAtH)`. The result also gets:
  - `auc24` over the 24 h before `readAtH`;
  - `peak` after the dose;
  - **table:** for each candidate step, the pre-HD level at +24, +48 and +72 h after the dose.
    Rows run from 0 to the first step at which every gap reads above 20, inclusive, capped at
    2,000 mg.
- **Missed post-HD dose:** the most recent session that has ended (`endH <= nowH`), with no dose
  entered from its end until now, gives `missed: {n, endH}`. That session must not be the one the
  dose follows: a session that ended under 6 h ago is answered by the dose itself, not flagged.
  Only one is reported, the latest. It is reported whichever branch above runs.
- **Returns:** `{oneTime: true, doseAtH, after, gapH, readAtH, kind, reason, mg, tinfH, pre,
  auc24, peak, table, plannedCount, plannedInWindow, missed}`.

### The gap choice

- `bState.hdGapH` defaults to 48. It persists for the session and survives refits.
- It is **not** saved with a profile: it is a view choice, and a reopened profile is read at a
  new time anyway.
- It is **not** in `bayesInputFingerprint`, because the fit does not depend on it.
- A new `__ACT` key **k78** (`data-arg` = 24/48/72) sets it and re-renders the verdict from
  `bState.result` without refitting.
- `hdViewFor(r)` reads `bState.hdGapH`, so the screen and print agree.

### Display — `hdOneTimeHTML(rec, derated, nowH)`

`hdNextDoseHTML` delegates to it when `rec.oneTime`.

1. **Missed flag** (when `missed`): a caution note, "No dose entered after session N (ended X h
   ago). If one was given, enter it; this answer assumes it was not."
2. **Heading:**
   - dose: `<dose> IV now · one-time`, or `<dose> IV after HD · one-time` after a known session;
   - hold: "No dose now";
   - planned: "Planned: … · one-time".
   Non-dose headings use the ink class `vx-regimen-hd` (D16).
3. **Subline:** "Sized for a pre-HD level of X mg/L if the next HD starts **48 h** after this dose",
   followed by the gap buttons **[24 h] [48 h] [72 h]** (`aria-pressed` on the chosen one).
   `closest` and `provisional` markings are as in D16.
4. **AUC₂₄ and peak:** the D16 line.
5. **Table** "Pre-HD level if the next HD starts…": candidate dose × 24 / 48 / 72 h after the
   dose.
   - In-range cells carry a text mark (✓, with screen-reader text "within 15–20"), not colour
     alone.
   - The chosen row is emphasised.
   - It fits at 375 px.
6. **Caution, always shown:** "The model averages dialysis over time. If the next session is
   delayed or cancelled, levels will run higher than shown."
7. **Next:** "Draw a pre-HD level before the next session. Once the schedule is known, log it and
   each post-HD dose is sized for you."
8. **Basis line:** as in D16, plus "one-time: no schedule logged".

**Elsewhere:**
- The summary sentence (`hdSentence`) and the `nextStep` text gain one-time variants.
- **Print** (`_prRecommendation`) shows the same content. The buttons become plain text
  ("assumed gap 48 h"), and ids are stripped as in D16.

## What does not change

- The fit, levels, objectives and the D16 scheduled path. Its output for two or more upcoming
  sessions stays byte-identical.
- The non-HD verdict and `bayesDoseOptimizer`.
- **Engine parity:** the existing 225 calls must show 0 differences.

## Tests

**SUITE 36** in `phase2d_validation.cjs`:
- `hdPickDose` matches D16 on the SUITE 35 fixtures. SUITE 35 stays green, unchanged.
- **Dose time:** now when no session is upcoming; after the session when exactly one is upcoming.
  Two upcoming sessions still give the D16 answer, not the one-time answer.
- **Sizing:** at +24, +48 and +72 h, the chosen dose reads 15–20 at its gap, or is
  `closest`/`hold` by the shared rule. An invalid gap falls back to 48.
- **Planned dose:** a planned dose inside the window is read, not replaced.
- **Missed flag:** set when the last finished session has no dose after it; cleared by a dose
  entered after it; only the latest session is reported.
- **No sessions logged at all:** a one-time answer, with no missed flag.
- **Table:** rows stop as specified; it includes the chosen dose.
- **Handoff case (fictional):** 1 g at 09:18, HD 13:42–17:45, a level of 10.3 mg/L at 05:42 the
  next day, read as of 06:00. The test checks a one-time answer, the missed flag on that
  session, a dose of at least 250 mg, and the assumed-gap wording. The size is whatever the
  engine computes.
- **Markup:** the gap buttons carry `data-onclick="k78"` and no inline handlers (the CSP suite);
  print has no buttons.

**Browser flows** (`docs/audit/browser-flows.cjs`), at 375 px:
- enter the handoff case → the one-time verdict and the missed flag;
- tap [72 h] → the subline says 72 h and the sizing changes;
- no horizontal scroll;
- no console or CSP errors.

**Independent anchor (private, not committed).** The user's institution publishes its own
level-based table for unscheduled HD. It is weight-tiered, with re-dose and hold thresholds, and a
72 h recheck that agrees with the longest gap offered here.
- **Use:** fictional patients across weights and pre-HD levels are run through `hdOneTimeDose` and
  compared, dose for dose, against that table.
- **Location:** the comparison lives outside the repo, beside the institutional source. No
  institutional content enters the public repo or the calculator.
- **Disagreements** are explained in the D17 record in general terms ("the model doses higher for
  low weights because…"), not tuned away.

**A level-only table the user once used** (<10 → 1000 mg; 10–25 → 500–750 mg; >25 → none) was
considered and **not adopted**:
- it has no traceable source;
- its 15–25-era thresholds contradict Rybak 2020 Recommendation 14 (pre-HD 15–20).

**Then:** the parity run, the full suites, rendered contrast in both themes, and the records:
D17 in `docs/v3-decisions.md`, CLAUDE.md, DESIGN.md, the hub how-to and build log, the hub PR,
the user's merge, and production verification.

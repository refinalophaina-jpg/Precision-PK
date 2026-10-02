# Intermittent haemodialysis dosing — design (D16)

Date: 2026-10-02 · Status: proposed · Builds on D15 (session layer, shipped in `95e3e90`).

## Why

D15 logs IHD sessions, labels levels against them and reads a pre-HD level. A pharmacist
dosing a patient on haemodialysis still has no HD-shaped answer:
- **No session-timed dose.** Goti-HD's verdict is a steady-state "dose q-interval" regimen
  (e.g. 250 mg q24h). HD patients are dosed after each session.
- **No empiric HD dose** before the first level.
- **No recurring schedule.** Sessions are typed one row at a time.
- **An intradialytic dose passes silently.** The averaged model cannot see the drug the dialyser
  removes from it.
- **The Trough module accepts an HD patient** and returns CrCl-based numbers that mean nothing
  in ESRD.

**Scope (chosen by the user):** A (post-HD dose recommendation, including unscheduled HD),
B (recurring schedule), C (empiric HD dosing), D (intradialytic flag), E (Trough-module guard).
CRRT, SLED and PD are out of scope.

## Sources

Rybak MJ, Le J, Lodise TP, et al. *Am J Health-Syst Pharm* 2020;77:835–864 (ASHP/IDSA/PIDS/SIDP
revised consensus):
- **Recommendation 11:** loading doses use actual body weight and do not exceed 3,000 mg.
- **Recommendation 13**, doses in mg/kg; maintenance doses are thrice weekly:

  | Timing | Permeability | Loading | Maintenance |
  |---|---|---|---|
  | After dialysis ends | low | 25 | 7.5 |
  | After dialysis ends | high | 25 | 10 |
  | Intradialytic | low | 30 | 7.5–10 |
  | Intradialytic | high | 35 | 10–15 |

- **Recommendation 14:** pre-dialysis 15–20 mg/L is likely to achieve AUC 400–600 over the
  previous 24 h. Monitor at least weekly; levels, not a strict weight-based dose, drive later
  dosing.
- **Text:** maintenance should be given with every session. About 20–40% of an intradialytic dose
  is removed by the simultaneous dialysis, with highly permeable dialysers at the high end.

**Rounding:** to the 250 mg dispensing step (`MATRIX_DOSE_STEP`).
**Infusion time:** from `autoTinf`.

## Components

### A — Post-HD dose recommendation (fitted Goti-HD)

- **Pure function `hdNextDose(r, sessions, nowH)`.** The dose time is the end of the next planned
  session (post-HD; intradialytic dosing is not offered, see D). The sizing session is the one
  after it.
- **Candidates:** 0, then 250…3,000 mg in 250 mg steps, each with `autoTinf`. Each candidate is
  appended to the recorded course, and the fitted curve (`predictFittedAt`) is read at the start
  of the sizing session.
- **Choice:**
  - If 0 mg already gives a pre-HD level of at least 15 mg/L → **hold**: "no dose after session N;
    recheck the pre-HD level".
  - Otherwise, the smallest dose whose pre-HD level is within 15–20 mg/L.
  - If none lands in range, the dose closest to the range, flagged.
- **Also reported:**
  - AUC₂₄ over the 24 h before the sizing session, integrated from the fitted curve;
  - the peak after the dose;
  - **repeat projection:** the same dose after each further planned session, with each pre-HD
    level shown, so accumulation is visible.
- **Missing schedule:** if there is no planned session, or no session after it, the verdict asks
  for the next sessions (B makes that one action). Nothing is assumed.
- **Unscheduled HD** is the same function: the user enters the session when it is scheduled.
  Until then, the pre-HD read-out (D15) and a hold-or-dose answer at the next entered session
  cover it.
- **Display:** for `model==='goti' && dial`, this replaces the steady-state verdict. The
  steady-state matrix and Tinkerer stay, with one line saying a q-interval regimen is not how HD
  doses are given.
- **Honesty:** the line says "on the averaged Goti-HD model (as DoseMeRx's Goti HD model)". The
  record says this is not clinically validated on local HD patients.

### B — Recurring schedule

A small generator in the HD section:
- **Pattern:** MWF, TuThSa, or every N days;
- **First date, start time, length, count** (1–12).

It appends session rows through `addBayesSession`, and adds nothing if any field is missing. Dates
use local calendar days, never "+24 h" arithmetic across DST.

### C — Empiric HD dosing (no levels yet)

`hdEmpiricDoses(abwKg)` returns Recommendation 13 for this weight:
- loading = mg/kg × ABW, rounded to 250 mg, capped at 3,000 mg (Recommendation 11);
- maintenance = mg/kg × ABW, rounded to 250 mg; a range where the table gives one.

**Display:** when Goti-HD has no levels, the verdict shows this table for the patient's weight,
after-HD and intradialytic, by dialyser permeability. **No silent default:** permeability is not
assumed; both rows are shown. Beside it: "levels, not weight, should drive dosing once a pre-HD
level exists (Recommendation 14)".

### D — Intradialytic dose flag

`hdSessionSummary` gains `dosesDuringHD`. Each such dose gets a caution note:
- 20–40% of a dose given during a session is removed by the dialyser (Rybak 2020);
- Goti-HD averages dialysis and treats the whole dose as delivered;
- the fit may therefore overestimate this dose's contribution.

### E — Trough-module guard

A checkbox in the Trough panel: "Patient receives intermittent haemodialysis".
- When it is ticked, Calculate shows a notice, not a result: CrCl does not describe clearance on
  dialysis, so use AUC Precision → Goti 2018 · HD.
- A button switches module (demographics carry over through the existing carry-over).
- No Trough number is produced.

## What does not change

- Fits and objectives.
- The non-HD verdict.
- `bayesDoseOptimizer`.
- Engine parity: the existing 225 calls must show 0 differences.

## Tests

**SUITE 35:**
- the Recommendation 13/11 numbers, rounding and the 3,000 mg cap;
- `hdNextDose`:
  - hold when 0 mg is enough;
  - the smallest in-range dose;
  - closest-and-flagged when none is in range;
  - asks for sessions when they are missing;
  - the repeat projection;
- the schedule generator: MWF and TuThSa across a month end; every-N; local dates across a DST
  change;
- the intradialytic flag;
- the Trough guard produces no result.

**Browser flows:**
- generate an MWF schedule on the phone;
- Goti-HD with a level → HD verdict;
- Goti-HD with no level → empiric table;
- the Trough guard.

**Then:** the parity run, the full suites, rendered contrast, and D16 in `docs/v3-decisions.md`
with the CLAUDE.md, DESIGN.md and hub how-to and build-log updates.

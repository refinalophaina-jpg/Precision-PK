# IV vancomycin for patients on peritoneal dialysis — design (D23)

Date: 2026-11-08 · Status: proposed · Evidence: the private research report
`…/Vancomycin /reports/Vancomycin peritoneal dialysis dosing.md` (outside this repo), summarised
below with public citations.

## Why

The calculator has no answer for a patient on peritoneal dialysis (PD).
- AUC Precision's priors are creatinine-driven or model intermittent haemodialysis. None has been
  evaluated in PD.
- The Trough module estimates clearance from creatinine, which does not describe a PD patient.

Pharmacists at a workstation still have to decide, every morning, whether to give an IV dose today
and when to draw the next level. They do it by hand: a load, a level about two days later, then
"redose to a target peak" arithmetic. That arithmetic ignores where the patient is in the cycler
schedule and how fast this patient is actually falling.

**Goal:** a level-based IV tool for PD patients that answers three questions from the patient's own
levels and PD schedule, and says plainly what it cannot know:
- what dose to give;
- when to redose;
- when to draw the next level.

## What the evidence allows (research summary, 2026-11-08)

- **No AUC or Bayesian dosing for PD.** No guideline gives an AUC target for PD; ISPD 2022 calls
  AUC's role in peritonitis "incompletely understood". The only adult PD population model (Hartinger
  2023, *Pharmaceutics* 15:1394) is CAPD-only, intraperitoneal, single-centre and unvalidated, and is
  internally inconsistent on its typical volume. No APD model exists. No vendor documents a PD model.
  Every public AUC programme found routes PD to level-based dosing (Stanford, Northwestern).
- **ISPD 2022 gives no IV vancomycin dose** (its systemic table has no vancomycin row). It also drops
  the serum-level target that ISPD 2016 graded 2C ("keep above 15 mg/L"). IV dosing in PD is
  institutional convention:
  - Northwestern Medicine 2026: 20 mg/kg actual body weight, max 2 g, level at about 48 h, then
    15 mg/kg.
  - Montefiore 2026: 15 mg/kg once.
  - Stanford 2023: 10–15 mg/kg once, then by level.
  - Blevins 1984 (CAPD PK): 23 mg/kg load.
- **APD kinetics depend on the cycler.** After IV dosing, the half-life was 11.6 h on the cycler and
  62.8 h off it (Manley 2001, *Perit Dial Int*, n small). In CAPD it is 66–115 h. Residual renal
  function supplies 39–84% of clearance when GFR > 5 mL/min (Lam 2020, *Perit Dial Int*). No
  vancomycin dose adjustment for residual function is evidence-based (ISPD 2016 and 2022).
- **Levels: when the sample is drawn decides what it means.** Draw levels after the cycler series,
  not during or just after an exchange (Lam 2020). In the first day after a dose the decline is
  faster than later, while the drug distributes (Montañés-Pauls 2012: apparent half-life 29 h over
  4–24 h, 62 h over 24–48 h).

## Decisions (with the user, 2026-11-08)

- **IV only.** Intraperitoneal dosing (intermittent or continuous) is out of scope.
- **Level-based, not Bayesian.** No population model drives a dose.
- **A redose is sized by where it puts the next level the pharmacist will actually draw** (normally
  the next post-cycler morning), within the goal range. The "redose to a target peak" figure,
  V × (C_peak − C_now), is shown alongside, as a second reading, never as the answer.
- **The goal range is chosen per patient.** Presets 10–15 and 15–20 mg/L (the trough ranges of the
  2009 consensus, Rybak 2009), plus a custom range. Nothing is assumed: no goal, no answer.
- **The user's own institution's rules are local settings, never shipped.** Examples: a lower load
  cap, a target peak. The repo ships public, sourced defaults; anything institutional is typed in by
  the user and remembered in their browser.
- **The decline is measured from this patient's levels and shown as a range, with the reason.** A
  worked case the user brought (kept out of the repo) could not be fitted by one half-life and one
  volume: the level after a small redose fell faster than the load's decline. That fits distribution
  after a dose. So the tool never fits a single "true" k and presents it as certain.

## Scope

**In:**
- IV vancomycin for adults on CCPD, NIPD or CAPD, for any indication;
- adults whose PD has stopped (catheter out), for example peritonitis finished IV after catheter
  removal. The user chose this in the builder check, 2026-11-08;
- the loading dose;
- each level's interpretation;
- the next-dose options and the recommendation;
- when to draw the next level;
- print and Copy summary;
- saved profiles.

**Out:** intraperitoneal dosing; AUC and Bayesian output for PD; CRRT; paediatrics; any dose uplift
for residual function; dialysate levels.

**Anti-goals** (failure even if it works):
- a single confident projection where the levels disagree;
- a goal range or weight the user didn't choose, filled in silently;
- workplace protocol numbers or a real patient in this public repo;
- a number for a patient on concurrent IP vancomycin.

## Where it lives

A fifth mode in the **Trough-Based** module, **"Peritoneal dialysis"**, beside Initial / Steady-state
trough / Two levels / Random level. It is deterministic and level-based, which is the Trough module's
nature.
- AUC Precision gets a one-line pointer for PD patients ("On peritoneal dialysis? Use Trough-based ·
  Peritoneal dialysis"), shaped like the existing Trough-module HD guard (`troughHdNoticeHTML`, k77),
  in the renal-function area.
- HD and PD are mutually exclusive: the PD mode refuses a patient with HD sessions logged.

## Inputs

| Input | Notes |
|---|---|
| Dosing weight (kg) | Actual body weight, labelled as such. **Weight now** (the Trough module's weight field, shared with saved profiles as today) and an optional **weight at the load** if it was different. Past intervals use the load weight; today's options use the weight now. A change is a caution. |
| PD modality | CCPD (cycler at night, day dwell), NIPD (cycler at night, dry day), CAPD (manual exchanges), or **PD stopped** (catheter out), with the date and time it stopped. |
| Vancomycin before the first dose entered? | No · Yes (IP or IV) · Unknown. Required. Yes or Unknown means drug may already be on board: the first interval cannot start from zero, and the tool needs a measured level as its anchor before it sizes anything. |
| Cycler start time and hours | CCPD/NIPD. Start as a 24-h clock time; hours 4–14. Session end = start + hours. |
| Exchanges × fill volume | Recorded and printed. Not used in any calculation (no study links it, or ultrafiltration, or Kt/V, to vancomycin clearance). |
| Nights done / held | Each calendar night between the first dose and now defaults to "done". A held night is flagged in every interval it falls in. |
| Residual urine output | Anuric · < 100 · 100–500 · > 500 mL/day. Drives cautions and level timing, never the dose. |
| Goal range | Preset 10–15 or 15–20 mg/L, or custom min–max. Required. |
| Doses | Date, 24-h time, mg, infusion hours. Same row pattern and helpers as the course entry elsewhere (`elapsedHours`, `data-time24`). |
| Levels | Date, 24-h time, mg/L. |
| Also on IP vancomycin? | Yes → refusal (two routes at once can't be read from serum levels). |

## Engine (pure functions, testable in the Node harness)

**V.** V = vdPerKg × weight.
- Default 0.70 L/kg (Bauer, already the app's `calcVd('bauer')`).
- Alternative: Matzke group III 0.90 L/kg (CrCl < 10, n = 36; Matzke 1984), offered as a choice, not
  mixed in.
- One implementation: reuse the existing source comments and constants, don't copy them.

**Loading dose.** 20 mg/kg × weight, rounded to 250 mg (`roundDose250`).
- The cap defaults to the existing Rybak 2020 Rec 11 loading maximum (`HD_LOADING_MAX_MG`, 3,000 mg,
  to be renamed or aliased so it isn't "HD"-only).
- A lower local cap can be set.
- The 20 mg/kg carries its provenance in the UI: "institutional convention (e.g. Northwestern 2026);
  ISPD 2022 gives no IV dose".

**Prediction.** One-compartment IV infusion superposition, reusing the existing
`predictConc1comp(doses, t, kel, vd)` — no new PK engine.

**Apparent elimination per interval.** An interval runs from an anchor to the next level. The anchor
is a measured level, or the first dose with C = 0. Solve for k (bisection on a bounded range) so that
the anchor, carried forward, plus every dose in between predicts the measured level. Each interval
records:
- k and the implied half-life;
- hours elapsed;
- cycler nights inside it (done and held);
- flags:
  - `early`: the level was drawn under 24 h after a dose ended. The decline may be overstated
    (distribution). 24 h is a PREFERENCE under rule 8.
  - `on-cycler`: the level was drawn between session start and end.
  - `held-night`: a held night falls inside the interval.
  - `unexplained`: no k in range reproduces the level. For example, it rose with no dose: a missed
    or undocumented dose, or a timing error. The interval is shown and not used.

**Rate set for projection.**
- Every valid interval contributes.
- The projection uses the range [k_min, k_max] and is labelled with how many intervals it rests on.
- With one interval, it is a single rate, labelled "one interval — the next level will tell".
- Flagged intervals are kept, with their flag shown, not silently dropped.

**Published-range context (never drives a dose).** For the entered schedule:
- CCPD/NIPD: daily k = (k_on × H + k_off × (24 − H)) / 24, where k_on = ln2/11.6 h and
  k_off = ln2/62.8 h (Manley 2001).
- CAPD: the 66–115 h half-life range (Lam 2020).
- Shown beside the patient's own range as "published APD/CAPD values".

**Next draw time.** The next "AM labs" clock time (a local setting) on the next calendar day.
- Warn if it falls before the cycler session ends.
- The first level is suggested on the AM-labs morning nearest 48 h after the load.
- With urine output ≥ 100 mL/day, the tool says residual function may clear faster and suggests an
  earlier first level, at 24–48 h. (The 48 h is from Northwestern 2026 and Lam 2020; the 24–48 h with
  residual function follows Glasgow's earlier draw. Institutional, labelled as such.)

**Options at the next draw.**
- For no dose and each 250 mg step up to the cap, the dose is given at a "give at" time (default: now,
  editable as in D20's `k82` pattern).
- Each option shows the predicted level at the next draw as a range (k_max → low, k_min → high) and
  its peak.

**The recommendation.**
- **Within goal:** if the no-dose range midpoint is inside the goal, no dose; draw at the next AM labs.
- **Below goal:** the step whose predicted midpoint lands inside the goal and closest to the goal
  midpoint. Ties go to the smaller dose, as in D17's pick.
- **Above goal:** no dose; it says when the projection reaches the goal's top. That morning is the
  next draw.
- **No step reaches the goal:** say so and show the closest step, flagged.

**Target-peak reading (shown alongside).** "Redose to a peak of P: V × (P − C_now) = X mg (rounded),
predicted next draw Y". P is a **local setting with no shipped default** unless a public source for a
dialysis target peak is found before implementation. Candidates to check: Heintz 2009
*Pharmacotherapy*; Crew 2015 *AJHP*. If none is found, the row reads "set a target peak to compare".

## Output (the answer, in the Trough module's results grammar)

**Verdict.** "Give 250 mg IV now" or "No dose today", then the next level: "Draw the next level Tue
06:00, after the cycler".
- Under it: the expected level at that draw (range) and the goal.
- A one-line reason when the range is wide: "from 2 intervals; the second was drawn early after a
  dose".

**The options table:** dose · peak · expected next-draw level, with the recommended row marked, and
the target-peak row shown alongside.

**The decline:** each interval with its half-life, cycler nights and flags, beside the published
APD/CAPD range.

**A small chart:** levels and the projected range to the next draw. Cycler sessions are shaded, as
HD sessions are (D15's band idiom).

**Cautions:**
- residual urine output;
- held nights;
- a level drawn on the cycler;
- a weight change since the load;
- goal not set;
- concurrent IP refusal.

**Print and Copy summary** carry the schedule, levels, intervals, recommendation and the two readings.

## Provenance rules (rules 1 and 8)

- Every shipped number carries a source comment: 0.70 L/kg (Bauer), 0.90 L/kg (Matzke 1984 group
  III), 11.6 h / 62.8 h (Manley 2001), 66–115 h (Lam 2020), 20 mg/kg (institutional, named), the
  3,000 mg loading cap (Rybak 2020 Rec 11), the goal presets (Rybak 2009).
- PREFERENCES are labelled as such: the 24 h "early" cut-off; the midpoint pick; the AM-labs default.
- **Local settings** (load cap, maximum single dose, target peak, AM-labs time) are stored in the browser,
  shown as "your setting" wherever used, and never written to the repo.

## Tests

**SUITE 41 (phase2d):**
- loading-dose rounding and cap;
- per-interval k against hand-computed fictional cases, including an interval with a dose inside it;
- the early, on-cycler, held-night and unexplained flags;
- the range from one vs several intervals;
- the recommendation in each branch (within, below, above, unreachable), with ties to the smaller
  dose;
- next-draw time against cycler end, across a DST change;
- the refusal paths (no goal, HD sessions logged, concurrent IP);
- provenance strings present.

**Browser flows:** a fictional CCPD patient typed in end to end.
- The checks: verdict, options, interval flags, the shaded cycler, print, 375 px, no CSP errors.
- The fictional case mirrors the shape of the user's case (a load, a level at about 50 h, a small
  redose, a level the next morning, a weight update), with different numbers.

**Engine parity 0** against v3.11.0. The new functions are additive.

## Records (definition of done)

- D23 in `docs/v3-decisions.md`, with the evidence summary and the declined paths: IP, AUC, Hartinger
  as a prior, residual-function uplift.
- CLAUDE.md:
  - "Not implemented" keeps intraperitoneal dosing for PD;
  - adds the PD mode under Architecture;
  - updates the test counts.
- README version row (minor bump); DESIGN.md (the PD verdict, the cycler band).
- Hub: a how-to section "Patients on peritoneal dialysis", the build log, CSP repin, PR. The user
  merges.

## Left to the builder

- Control layout within the Trough module's existing grammar.
- The bisection bounds for k.
- How held nights are entered (a row of night toggles, or exceptions only).
- The chart's exact form within the existing canvas conventions.
- Wording of cautions in the house voice.

## Builder-check answers (2026-11-08)

**The user's answer:** patients whose PD has stopped are in scope (see Inputs and Scope above).

**My calls**, each settling a question the check raised:

1. **Drug already on board.** "Vancomycin before the first dose entered?" is required.
   - With Yes or Unknown, the first dose is not treated as starting from zero. The tool asks for a
     measured level and anchors on it.
   - Until a level exists, it sizes no load: "draw a level first; drug from before may still be
     present".
   - Once a level exists, the first IV dose is sized like any redose, toward the goal.
2. **PD stopped.**
   - After the stop, the cycler schedule, its flags and the published APD/CAPD context switch off.
     The context reads "no published value for this state".
   - Intervals that end before the stop are flagged `before-stop`. Once any interval after the stop
     exists, they leave the projection range. They stay on screen.
3. **Weight.**
   - There is a load weight and a weight now. Past intervals use the load weight; options use the
     weight now.
   - A first level higher than the doses could make at V gets an `unexplained` flag that names V,
     for example "higher than 1 g could make at V = 40 L: a smaller volume, drug given before, or a
     timing error". It is not blamed on timing alone.
4. **No default goal.** The local settings hold no goal. Presets are one tap, and with no goal there
   is no answer.
5. **AUC Precision.**
   - It gets an "On peritoneal dialysis" box in its renal area. Ticked, it refuses with a link to
     Trough-based · Peritoneal dialysis, the mirror of the HD guard.
   - The severe-renal advisory line that tells PD patients to switch to Goti 2018 is corrected.
   - A saved profile carries the PD fields. Loading one ticks the box, so a PD course never reaches
     the fit.
   - The box defaults off, so engine parity is unaffected.
6. **Caps.**
   - The load is capped at 3,000 mg (Rybak 2020 Rec 11).
   - Redose options stop at the app's per-dose ceiling, `DOSE_MAX_PER_DOSE_MG` (2,000 mg).
   - A local "maximum single dose", if set lower, caps both.
7. **Target peak.** A haemodialysis or CRRT source does not count as a PD default. There is no
   shipped default; the row reads "set a target peak to compare" until the user sets one locally.
8. **Chart.** SVG, like the course strip, so it themes through CSS tokens and prints crisply. It
   does not use the canvas renderers.

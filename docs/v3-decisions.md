# v3 — decisions, and the numbers behind them

Triggered by a real case the clinician ran at the bedside and wrote up: 34 M, TBW 65 kg,
167.6 cm, SCr 1.6 → 1.5, CrCl ≈ 64 mL/min. 1750 mg over 2 h; levels 18.7 mg/L at 16.9 h and
12.1 mg/L at 24.3 h. Goti recommended **1750 mg Q48H**, which did not feel like a regimen a
34-year-old with stable renal function should be on.

Every number below is reproducible with:

```bash
node docs/audit/probe-v3-case-34m.cjs
```

The posteriors reproduce the clinician's screen almost exactly, so the fitting layer was not
where the problem was:

| | reported | reproduced |
|---|---|---|
| Buelga CL / V | 2.62 L/h · 55.4 L | 2.686 · 55.84 |
| Goti CL / Vc / Vp | 2.01 · 39.2 · 28.8 | 2.058 · 39.08 · 28.48 |
| Goti recommendation | 1750 mg Q48H | 1750 mg Q48H |
| Buelga recommendation | 1250 mg Q24H | 1250 mg Q24H |

---

## D1 — The interval was never chosen by pharmacology. **Fixed by removing the claim.**

`bayesDoseOptimizer` solves a dose per interval, then ranks the candidates on
`|auc24 − targetAUC|`.

State the defect precisely, because the loose version is wrong and a reviewer will dismiss
it in one line. `auc24` *does* vary with `tau` in this function, since `dose` is solved per
`tau`. But at steady state

```
auc24 = dose × (24/tau) / CL = total daily dose / CL
```

so it is independent of `tau` **given the daily dose** — and the per-`tau` dose is chosen to
hit the same target at every interval. Without the 250 mg rounding, every candidate would
score *exactly* `targetAUC` and the metric would be a perfect four-way tie. **All of its
discriminating power is rounding error**, and the error is not even-handed:

| τ | achievable-AUC step `250·(24/τ)/CL` | mean residual (step/4) |
|---|---|---|
| Q8H | 364.5 | 91.1 |
| Q12H | 243.0 | 60.7 |
| Q24H | 121.5 | 30.4 |
| Q48H | **60.7** | **15.2** |

Q48H can land six times closer to any target than Q8H, for no pharmacological reason.

Measured consequences on this patient:

- target **450** → 1750 mg Q48H; target **475** → 500 mg Q12H. A fourfold change in dosing
  frequency from a 5% change in an arbitrary input.
- **1000 mg Q24H can never be recommended.** Its AUC₂₄ is *identical* to 500 mg Q12H (same
  daily dose), and exact ties keep the earliest entry of the `[8,12,24,48]` array.

### What was rejected

A **composite score** — the clinician's own first proposal, and the shape three of four
independent designs converged on: AUC fitness + interval preference + operational simplicity
+ robustness + plausibility, with a mild penalty on Q48H when age < 50 and CrCl > 40.

Rejected because every term needs a weight, no weight has a paper behind it, and rule 1 of
this project forbids shipping a clinical constant whose provenance cannot be stated. A
weighted score would also have *hidden* the defect rather than fixed it: the tool would go
on asserting an interval preference it cannot derive, just with better manners.

### What was built

`exposureMatrix()` — the whole admissible space, dose × interval, every cell a steady-state
AUC₂₄ banded against `AUC24_TARGET_MIN/MAX` (Rybak 2020 Rec 1, A-II), the recommendation
outlined, every cell clickable into the Dose Tinkerer. **Zero preference weights.**

This is DoseMeRx's own answer — their "Preview of alternative dosing regimens" is a
dose × interval AUC₂₄ matrix with a Subtherapeutic / In-range / Supratherapeutic legend and
"click on a cell to use that dosing regimen in a custom dose simulation". Arrived at
independently here, then confirmed against their screen.

For this patient the matrix shows **four** in-band regimens where the recommendation showed
one: 500 mg Q12H (486), 1000 mg Q24H (486), 1750 mg Q48H (425), 2000 mg Q48H (486).

Two divergences from DoseMeRx, both deliberate:

- **We state steady state; they simulate a finite horizon.** Their matrix is "over 2 days"
  and their own numbers prove it — 1500 mg q12h reads 859.47, not 2 × 456.69 = 913,
  because accumulation has not settled. Sub-proportional at every interval. Ours is
  `TDD/CL`, labelled "steady-state AUC₂₄" everywhere so the two are never blurred.
- **We keep a hard safety tier.** Their matrix colours an AUC₂₄ of 2235 the same pink as
  610. Ours strikes through anything breaching per-dose 2000 mg, TDD 4500 mg or AUC₂₄ 700,
  and those cells are not clickable.

### A correction to an earlier claim

An initial reading held that Buelga escaped Q48H *only* because the Q48H dose exceeded the
2000 mg per-dose cap. **That is false at the default target.** Lifting the cap changes the
Buelga recommendation at 5 of 9 selectable targets (400, 425, 500, 525, 600) and leaves it
unchanged at the other 4 — including **450, the shipped default**, where 1250 mg Q24H wins
on its own. The cap is a real confound, not the whole story.

### The tie-break was clinically inverted — found by adversarial review

Three independent verifiers confirmed D1 and one of them found something sharper that the
original diagnosis missed.

The TDD lattices are **nested**: Q48H steps of 125 mg contain Q24H's 250, which contain
Q12H's 500 and Q8H's 750. Measured over 87,309 (target, CL) cells, a longer interval scored
strictly *worse* than Q24H in **zero** cases. So a long interval can never lose on this
metric — only tie. And ties are common: **45%** of targets across 400–600 at this patient's
clearance end in an exact tie.

`pool.reduce` with a strict `<` kept `pool[0]` — the earliest entry of `[8,12,24,48]`, the
**shortest** interval. For a fixed daily dose the shortest interval always has the
**highest** trough. So the arbitrary tie-break was systematically returning the most
trough-exposed member of an exposure-identical set. At target 485, where all three are
AUC₂₄ 486.0:

| | trough | |
|---|---|---|
| Q12H 500 mg | **16.1** | returned — and it trips the function's own `TROUGH_WARN_MGL` (15) |
| Q24H 1000 mg | 13.4 | discarded silently |
| Q48H 2000 mg | 9.1 | discarded silently |

**The optimizer attached its own AKI warning to the regimen it had just chosen, while the
two alternatives it threw away carried none.** Of 182 tied targets sampled, it picked the
highest-trough option **182 times**.

A consequence: **1000 mg Q24H was returned 0 times in 6,759 calls** across CL 0.5–8.0 and
nine standard targets. One of the commonest vancomycin maintenance orders was structurally
unreachable.

**Fix.** The tie is broken on thresholds this file already sources rather than on array
order: among candidates tied to within 1e-9, prefer one raising no trough flag — below
`TROUGH_WARN_MGL` (Rybak 2020) and not under the organism's MIC. **No new constant**, and
where nothing is tied the behaviour is unchanged. The card now also names what it was tied
with, so a single recommendation cannot read as a ranking it did not earn.

| | before | after |
|---|---|---|
| tied targets picking the highest trough | 182/182 | **0/182** |
| tied targets picking a flagged regimen | 182/182 | **0/182** |
| 1000 mg Q24H across 6,759 calls | 0 | **158** |

### Ladder bug found while testing

The first matrix centred its dose ladder on the dose that hits target at Q24H. That looks
reasonable and is not: the target dose scales with `tau`, so a Q24H-centred ladder runs past
the short intervals and out before the long ones. On this case it stopped at 1750 mg and
therefore **hid 2000 mg Q48H — AUC₂₄ 486, squarely in band**, the single cell a clinician
weighing Q48H most needs. The ladder now spans the target dose at every interval. `SUITE 20`
asserts it.

---

## D2 — Cross-midnight time entry. **The most serious defect in the file.**

`calcTLDeltas` computed elapsed time as

```js
let d = toMin(to) - toMin(from);
if (d < 0) d += 24*60;       // folds every interval into [0,24)
```

from clock-only `HH:MM` inputs with no date. Real two-level sampling routinely spans
midnight. Two distinct failure modes:

**Loud** — the second level wraps *below* the first, `solveTwoLevelsPK` returns `null`, and
`calculate()` alerts. Confusing, blocking, but safe. This is what was reported: dose 10:22,
level 2 at 10:38 next day read as **0.27 h** instead of 24.27 h.

**Silent, and far worse** — when both levels land on a later day they wrap by the *same*
24 h. The log-linear slope is unchanged, so `kel` is still right and every guard passes. But
the peak back-extrapolation uses the absolute `t1`, which is now a day early, so **volume is
wrong and nothing complains**:

| dose 08:00 d1, levels 12:00 & 18:00 d2 | kel | Vd | CL |
|---|---|---|---|
| correct (28 h, 34 h) | 0.0871 | 13.2 L | 0.96 L/h |
| wrapped (4 h, 10 h) | 0.0871 | **75.3 L** | **5.47 L/h** |

5.7× on volume. Dose 22:00 with levels two days later: **32.5×**.

Note which case is which. A level drawn *early the next morning* wraps below the infusion
time and is refused out loud — the benign one. The dangerous case is the ordinary daytime
draw, which wraps to a plausible-looking hour and sails through.

The steady-state trough mode had the same class of bug with a manual "next calendar day"
switch that could only ever add **one** day, so a trough drawn before the next dose of a
Q48H regimen — 47.5 h after the last — still read as 23.5 h.

**Fix:** every instant is a `datetime-local`; one helper, `elapsedHours()`, never wraps and
reports a reversed interval instead of absorbing it; `formatElapsed()` prints
`1d 0.3h (total 24.3h)` so the clinician can see the tool read the timestamps as intended.
`SUITE 19` fails the build if a clock-only input, a `+= 24*60`, or a second elapsed-time
helper returns.

---

## D3 — "Consider another level" is advice with no information in it

Two quite different reasons to draw one, and a clinician acts differently on each. The test
is not how wide the interval is — with ±18% almost every patient's interval touches a band
edge, so that reading flags everyone and trains people to ignore it. The test is the
**marginal** gain, plus whether the estimate is close enough to a boundary for extra
precision to change what you would write.

| levels | width | one more | relative narrowing |
|---|---|---|---|
| 0 → 1 | ±35% → ±21% | large | 40% |
| 1 → 2 (2-comp) | ±25% → ±18% | moderate | 28% |
| 2 → 3 | ±18% → ±17% | negligible | **6%** |

`nextLevelValue()` reports **Clinical impact** or **Precision only**. "Close enough" is
derived, not chosen: the AUC moved by one 250 mg step at this interval and clearance — the
smallest change that can actually be prescribed.

On the reported case (2 levels): **Precision only — "A further level would add little"**,
which is exactly what the clinician observed. With only one level it reads *Clinical
impact*. That falls out of the arithmetic and happens to agree with DoseMeRx's own model
guidance — their 2-compartment model "does not generally work as well with single levels",
with two levels recommended initially, while the 1-compartment model is "ideal ... when a
limited number of levels are available". We never encoded that; it emerged.

`AUC_UNCERTAINTY` is now one table read by both the caption and the arithmetic. It was
previously reachable only as a formatted string.

---

## D4 — Vocabulary on the dosing profile

"Individual (Bayesian)" invited the reading *predicted from my measured levels*. It is not —
it is the posterior after combining the levels with population information, and a curve that
misses a measured point reads as the model ignoring the level when it is shrinkage.

Renamed to **Posterior prediction · Population prior · Measured concentration**, with a
permanent explainer above the graph and the PK table headed *Posterior* / *Population
prior*.

## D5 — Fit quality in clinical language

`FIT_BANDS` translates |residual| / σ into what to do, in the register DoseMeRx uses at the
bedside ("good fit" / "not ideal, needs review") while keeping the number on screen.

σ is sourced — each model's published residual error. The 1 and 2 boundaries are **not**
literature constants and say so in the code: they are the conventional reading of a
standardised residual. They order advice; they never change a dose.

On the reported case: **Close agreement · 0.9 σ**. The fit was good. The clinician's
instinct that the Bayesian math was not the problem was right.

---

## Preference weights introduced in v3, in full

Two, both labelled in source:

| constant | value | what it does |
|---|---|---|
| `NEXT_LEVEL_MIN_GAIN` | 0.15 | below this relative narrowing, another level is called precision-only |
| `FIT_BANDS` split points | 1 σ, 2 σ | orders fit advice into three registers |

Neither changes a dose. Everything they sit beside is sourced: σ from each model's published
residual error, the AUC band from Rybak 2020 Rec 1 (A-II), the 250 mg step from the
dispensing increment, the uncertainty widths from the Monte Carlo in
`docs/audit/uncertainty-by-model.cjs` (originally `docs/audit/uncertainty.cjs`; never phase2d, which
computes no percentiles).

## D6 — Input bounds, extended to the module that lacked them

From section 4 of the archived Copilot review
(`archive/2026-09-13-copilot-improvement-recommendations.md`). Its premise was right and its
framing was wrong: it claimed there was no validation, and proposed a fresh table of invented
limits. `INPUT_LIMITS` + `checkValue` + `validateFields` have existed since audit A3/A4.

What was genuinely missing is that `validateFields` was called from **one** place —
`calculate()` — for four fields. **`runBayesian()` tested presence only** (`!age || !tbw`), so
an out-of-range value reached the population model untouched in the module that does the
Bayesian work. Measured against the shipped engine:

| input | result |
|---|---|
| weight 5000 kg, SCr 0.0001 | Cockcroft-Gault CrCl **73,611,111 mL/min** |
| SCr blank or 0 | CrCl **Infinity** |
| age `"abc"`, `""`, `"0"` | all collapse to `v() === 0`, indistinguishable |

The `min`/`max` attributes on those fields are **advisory** — the browser enforces them on a
form submit, and there is no form here.

Fixed by routing the Bayesian module through the **same** `checkField`/`INPUT_LIMITS`, not a
second table — four CrCl functions with three SCr floors is how this project learned that
lesson. One addition was needed: `checkOptionalField`, because SCr may legitimately be blank
when serial readings supply it and IBW degrades gracefully without a height — but a value that
*is* typed must still be in range. Verified live: 5000 kg now gives *"Weight must be between
20 and 400 kg. Got 5000."* and nothing renders.

## D7 — The exposure matrix is one tab stop, not thirty-two

From section 6 of the same review, whose proposed implementation was an anti-pattern:
`tabindex="1"`, `tabindex="2"` and so on. A **positive** tabindex hoists those elements ahead
of everything carrying the natural `0`, so the document is then traversed in an order matching
neither the DOM nor the layout. The cure for too many tab stops is fewer stops, not renumbered
ones.

The matrix has 32 cells. It is now a roving-tabindex grid (WAI-ARIA pattern): one tab stop,
arrow keys to move, `Home`/`End` for row ends, `Enter`/`Space` to load a regimen into the Dose
Tinkerer. Blocked cells are skipped rather than stopped on — they are not regimens, and landing
on one to discover it cannot be chosen wastes the keyboard user's time. A `sr-only` caption
announces the navigation, which is otherwise undiscoverable to someone who cannot watch the
focus ring move.

Activation is handled explicitly rather than relying on the browser turning `Enter` into a
click on a focused `<button>`. Two reasons: `Space` would scroll the page before activating,
and a live check showed the implicit activation did not fire for the focused cell.
`preventDefault` keeps it to exactly one activation if an implicit click does also arrive.

Verified live under the production CSP with real keystrokes: `250|8` →**→** `250|12` →**↓**
`500|12` →**End** `500|48`; `Enter` on `1000|24` loads the Tinkerer with AUC₂₄ 479, trough
13.1, peak 35.8. One tab stop throughout. `SUITE 20` fails the build if a positive `tabindex`
appears anywhere in the body.

## D8 — The 150 mL/min CrCl limit on Buelga is the calculator's, and applies in both modules

The 150 mL/min truncation is Goti's ("CrCL greater than 150 ml/min was truncated to 150 ml/min",
Goti 2018 Methods). Buelga 2005 has no cap: its population was CLcr 89.4 ± 39.2 mL/min
(Table 1), and the PDF contains no truncation language. The ARC advisory nonetheless said
"Buelga 2005 caps CrCl at 150 mL/min in the published model", and only AUC Precision applied
it — the Trough module's Buelga, described as "the same model the AUC module uses", did not.
One ARC patient (25 M, 80 kg, SCr 0.5, CG 256 mL/min) therefore had two Buelga clearances,
16.6 and 9.7 L/h.

**Decision:** keep 150 on the Buelga path as an **extrapolation guard** — CG at 256 is far
outside the data Buelga was fitted on, and Cockcroft-Gault overestimates most at low SCr —
apply it in both modules, and label it everywhere as the calculator's choice, never the
paper's. The posterior can still move above the prior when levels are measured.

**Reversible:** removing the guard is one line in `calcCLv` and one in `getBayesCrCl`, plus
`SUITE 24`'s Buelga test. It is a clinical choice the reviewing pharmacist may overrule.

## D9 — AUC uncertainty is simulated per model

`AUC_UNCERTAINTY` was simulated only for Buelga; Goti and Hughes borrowed its rows under a
"~80% of patients" label, and the print report said the widths were "simulated against this
model's own prior". `docs/audit/uncertainty-by-model.cjs` repeats the original design
(1000 mg q12h × 8, steady-state troughs) with truth drawn from each model's own prior and
residual error, n = 1500, seeds 7/11/23. The Buelga rows reproduce the shipped table
(35.8/20.9/18.0/17.2), which validates the harness. For Goti the Buelga band covered only
60–67% of patients, the misses mostly above — so the page understated the chance of exposure
over 600. Widths (p80 / median, 0–3+ levels): Buelga 35/21/18/17, Goti 48/32/27/26,
Hughes 31/22/20/20. Goti-HD is not simulated separately and says so.

**Displayed as an asymmetric band (second pass).** A symmetric est × (1 ± p80) band put about
twice as many simulated patients above its upper bound — the toxicity side — as below its lower
one, because true/estimated AUC is log-normal. The band shown is now the measured 10th–90th
percentile of true/estimated AUC₂₄ (seeds 7/11/23 averaged): Buelga −30/+46, −21/+23, −18/+18,
−17/+18; Goti −40/+63, −24/+50, −21/+40, −19/+40; Hughes −27/+37, −18/+28, −17/+26, −17/+25
(%, 0–3+ levels). For Goti the upper side at one level is +50%, where ±32% had been shown. The Trough module's
±22%/±30% has no simulation behind it and is now labelled "approx., not simulated".

## D10 — The MAP fit starts from five points and reports a second solution; ln V stays out

**Multi-start.** Every fit used to start once, at eta = 0. When levels conflict with each other
or with the prior, the MAP objective can have two minima whose values differ by < 0.1 while
their AUC₂₄ differs by 50–125%. Reproduced: Goti, CrCl 25, 90 kg, 1500 mg q24h × 8, trough 10
and a level of 15 one hour into the infusion — the single start gave AUC 487 ("in range"), the
better minimum 938. In ordinary Goti peak/trough designs drawn from the model's own prior it
happened in ~0.3% of patients. `mapFit` now starts from eta = 0 and ±1 SD on CL and on V (Vc),
the SDs being each model's published omegas, and keeps the lowest objective. When another start
lands within `MAP_TIE_OBJ` (2) objective units at a clearance differing by more than
`MAP_SPLIT_CL` (20%), both are shown, in print too, and confidence is capped at Low — picking
the lower of two near-equal minima is itself close to arbitrary. Both cut-points are
**preference** (rule 8). Population accuracy is unchanged (`uncertainty-by-model.cjs`,
`SINGLE=1` vs default: identical p80 to 0.1 point); the change matters only in the rare
two-solution patient, where it matters most.

**ln V tested and rejected.** −2 log L of the combined additive + proportional error model
carries Σ ln V(f), and Goti estimated with FOCEI, so the audit proposed adding it. In a
self-consistent simulation (truth drawn from each model's prior and residual, n = 1500, seed 7)
it lowered AUC estimates so that true exposure fell *above* the displayed interval more often —
Goti 17–19% → 21–23% at 1–3 levels, Hughes up to 18% — with no improvement in median or p80
error. The objective stays without it; the comment beside `burtonObj3D` says why.

## D11 — Buelga's published CL–V covariance is disclosed, not guessed

Buelga Table 4 lists "ω_CL/ω_V (%) 23.12", footnoted "parameter expressing covariance". The
paper does not say whether that is a covariance on the omega scale (0.2312² → ρ 0.51) or a
correlation (ρ 0.23), and the two readings move AUC₂₄ by up to ~4% in opposite directions on
peak/trough designs. The prior stays diagonal and the omission is recorded beside the omegas —
the one published Buelga parameter not in the model.

## D12 — The results redesign: read the answer off the patient's course (2026-09-28/29)

Presentation only. `docs/audit/engine-parity.cjs --ref 63063c8` (the last engine before the
redesign): 225 calls, 0 differences. The decisions the user made are in `PRODUCT.md`: the dose
stays the headline when confidence is Low, marked "provisional"; doses print in ISMP form, grams
from 1,000 mg; the layout is "the course timeline" (`.impeccable/surfaces/index-html.md`).

- **Answer first, on the patient's own timeline.** The Bayesian results open on a course strip
  (dose bars as wide as each infusion, level dots, creatinine ticks, "now"), the verdict at its
  end, and the concentration curve beneath on the same time axis. Evidence follows as hairline
  sections. The Trough module's three renderers use the same grammar. It replaced a stack of stat
  cards and striped alert boxes above a buried dose (critique score 17/40).
- **One shared time cursor.** Pointing at the strip or the curve draws one rule on both at the
  same instant, and reads the fitted concentration, the clock time and the time since the last
  dose. The strip and the curve share `profileDomain` and `PROFILE_PAD`, so an instant has one x.
- **A de-rated dose is marked, not faded.** An old `opacity: .72` on `.rec-box.rec-derated
  .rec-dose` stacked on the verdict's own colours and left "1 g" the faintest part of
  "1 g IV q12h". The word "provisional" carries the state; the dose stays at full ink.
- **"Would add little" carries its own reason.** Read alone under a Low confidence word it looked
  like a contradiction. The verdict now appends the clause `nextLevelValue` already states for
  that branch — "the maintenance regimen lands in the same place either way" — verbatim.
- **Terracotta text is `--terracotta-ink`.** Raw `--terracotta` (#cc785c) on paper is 3.0:1.
  Fourteen text-colour rules moved to the ink token (5.9:1 on light paper, 7.7:1 in dark). A
  rendered measurement of every visible text run, both themes, every evidence section open:
  0 under WCAG AA. The detector's remaining "#ece4d2 on #ffffff" is the dark-theme ink read
  against a white page that never renders.
- **Drawn icons, not glyphs; status tints from tokens.** "⚠", "💡" and "✓" became the drawn
  `ICON` set. 28 raw `rgba()` literals of the old palette became `color-mix()` over tokens, so
  they follow the dark theme; the AKI box moved from terracotta to amber, the caution hue.
- **What an independent finish review changed.** A fresh reviewer, judging the build against
  its direction contract, found seven material gaps; all were fixed and are checked in
  `docs/audit/browser-flows.cjs`. The educational disclaimer existed only in print and a
  collapsed section, so it is now a visible line under every result (binding: `PRODUCT.md`).
  After "now" is prediction, so the strip and the curve shade it and the record visibly ends
  where the verdict stands. On a phone the verdict sits between strip and curve, so the strip
  carries its own day axis and names "now". Measured levels were rose, a near-sibling of the
  alarm red; they are now ink. "Low confidence" was alarm red beside an amber "provisional",
  and one state is now said in one hue, amber. The purple save button is now an ink secondary
  action, the nested privacy box is plain text under a hairline, and model selection is a
  ground step rather than a terracotta border. Declined: graded 50/80% fan bands. The engine
  simulates only the 80% range, and a 50% band would be a number with no simulation behind it
  (rule 1).
- **What documenting the build found.** Deriving `DESIGN.md` from the shipped code turned up
  drift the review had not looked at. Tracked capitals remained in the evidence internals, the
  exposure-matrix heads ("Q12H", against the verdict's "q12h") and the version pill. There was a
  "⟳" glyph kicker, a hard-coded `#000` hover that broke dark mode, and no arrival fade on the
  Bayesian panel although the contract promises one. All are fixed. A browser check now fails if
  any text on screen is set in CSS capitals, with every evidence section open.

## D13 — Input defects that only real keystrokes and clicks found (2026-09-29)

`docs/audit/browser-flows.cjs` drives the app under the production CSP with typed digits and
clicked buttons, desktop and 375px, and fails on any console error. On its first run:

- **A typed "08:00" became "08::0".** `formatTime24Input` adds the colon after two digits; the
  clinician's own colon doubled it and `maxlength="5"` cut the last digit, so every dose and level
  time entered the natural way was refused. The unit test called the formatter once per value; it
  now also types key by key. A pasted value is still shown back, never repaired.
- **Reset showed a sex nobody chose.** `resetBayesian` lit Male while `bState.sex` was null, and
  reset the second `.toggle-group` — not the model picker since it became a `.model-grid` — so
  the previous model stayed highlighted. `loadProfileIntoForm` had the same stale selector and
  passed `setBModel` an undefined element: a loaded profile changed the model without moving
  the highlight.
- **Every phone button was forced to 16px.** A ≤600px rule meant to stop iOS zoom-on-focus —
  which only form fields trigger — also hit buttons; the mode tabs grew until "RANDOM" clipped.

## D14 — Model and measurement in different colours (2026-09-29)

Asked for directly: "have different colors for posterior, data … so it's easy to identify and
differentiate". The redesign had drawn the posterior curve, its band, the ring at each level and
the measured dots all in ink, so the chart's most important distinction, between what was
measured and what the model fitted, rested on shape alone.

- **This patient's fit is `--series-fit`**: the curve (solid, then dashed after "now"), the 80%
  band as a 16% tint, the open ring at the fit's value at each level, the cursor's dot, and the
  Trough chart's current-regimen curve, which is also a fit.
- **Measured levels stay ink**, with a paper halo and their value. **The population prior is a
  thin `--ink-muted` dash.** **The projection is `--series-projection`.**
- **Hues are the house's, stepped, and validated rather than eyeballed.** Brand purple (#4a3d7a)
  failed the dataviz lightness band (L 0.40) and moss read nearly grey (C 0.08). Holding each
  hue, the chart steps are #6751a8 light / #9583d5 dark for the fit, and terracotta light /
  #cb7a5d dark (the same hue, stepped into the dark band) for the projection. The validator
  passes both themes: protan/deutan ΔE 22.0 light and 18.0 dark, with every mark at least 3:1
  against paper.
- **Rejected: moss for the creatinine ticks.** Against terracotta it collapsed under red-green
  deficiency (ΔE 2.6–6.5). The ticks are muted ink, named by their lane label and values.
  Purple no longer appears on the strip, so on the linked strip and curve it means only the fit.
- **Rejected: a colour for the measured dots.** Amber is the caution status, rose sits beside the
  alarm crimson, and terracotta means "this one". Ink data against a coloured fit is also the
  convention of pharmacokinetic plots.
- **The Trough chart uses the same code (follow-up, same day).** In the three level-based modes
  it now draws the population estimate for the regimen shown as the thin grey dash. On the
  profile chart that line is "what the population model predicted before the levels", and here
  too the gap between it and the fitted regimen is what the level bought. The key gains
  "Population estimate" and the summary says what the dash is. Initial dosing draws no dash,
  because its one curve already is the population prediction. The band label also looks just
  outside the band's edges before settling for a crossed spot. The Random-level hint claimed
  "the level is plotted where it was drawn". It never was: that chart shows the recommended
  regimen at steady state, not the course the level came from. The hint now says the level is
  not drawn.
- **The Dose Tinkerer uses the same code (follow-up, same day).** It used to draw one terracotta
  curve on a green band, with 9–10px labels, no key, and purple box chrome. Its preview now draws
  the regimen being tried (projection), the current regimen as fitted (purple) and the population
  estimate for the tried regimen (grey dash) on the neutral trough-reference band, with a key.
  The comparison had cycled a six-colour palette whose first two colours now mean projection and
  fit. It now leads with the current regimen in purple and draws every tried regimen in the
  projection's hue family, told apart by line pattern and shade, with swatches drawn the same
  way. It caps at six so that no style is reused. One renderer serves both charts, on true
  elapsed time (cycles repeated, never rescaled). The purple section box and button are gone,
  because on a chart purple is the fit, and the Tinkerer's tiles lost their tracked capitals.
- **The Trough module's "Try another regimen" uses the same code (follow-up, same day).** It used
  to redraw the result's own chart with the tried regimen alone, as a terracotta "Projected" curve,
  and rewrite that chart's key. What the regimen was being compared with, and the fitted regimen
  the chart had been showing, left the screen until the next Calculate. It now leaves the result
  chart alone and draws a comparison of its own, below the tried regimen's numbers, with the
  Tinkerer's renderer and code. The tried regimen is a projection. It is drawn beside the current
  regimen as fitted (purple) once a level exists, or beside the recommendation (terracotta) in
  initial dosing and the two- and random-level modes. There the tried regimen takes the
  comparison's second style (`terracotta-ink`, dashed), because two projections share a hue. In
  the level-based modes the population estimate for the tried regimen is the grey dash. A palette
  change or a resize redraws it from what was predicted, never from inputs edited since, and print
  repaints it in light like the result chart.
- **The Trough dose explorer uses the same code (follow-up, 2026-09-30).** The table marked only
  the recommendation, in terracotta. The current regimen, which the chart draws as the purple fit,
  was an unmarked row among 27. The rows the chart draws now carry its legend's line and word.
  The current regimen is on the fit's line ("current"), and the recommendation on the
  projection's ("recommended", or "recommended (current)" when the advice is to continue). The
  words stay in text colours; only the line carries the series colour. When the advice is to
  continue, the table used to put terracotta on the optimiser's dose, which the chart does not
  draw, while the chart's terracotta line was the current dose. That row now says "optimiser's
  dose", with no line and no terracotta. A regimen the chart draws is always listed, even off the
  250 mg grid (a 1.1 g current dose, a 2.25 g recommendation). Amber still marks out-of-range
  values: that is a status, not a series.
- **The Tinkerer renderer no longer paints a background.** Its `--paper` fill (the fix for a
  `fillRect` with no `fillStyle`, which painted black) drew a flat slab on the page's atmosphere.
  That was visible once the chart sat under the Trough chart, which clears to transparent as the
  profile chart does. It now clears too. The test that pinned the fill now pins the clear, and
  still fails a background fill without a themed colour.
- The Trough chart's summary, which is also its accessible name, said the current regimen "is
  drawn in ink". It now says the regimen is drawn beside the recommendation for comparison: a
  written summary never names a colour.

## D15 — Haemodialysis sessions label the fit; they do not change it (2026-10-02)

Asked for: "hemodialysis-aware vancomycin PK". The handoff described a dose at 09:18, high-flux
IHD 13:42–17:45, and a level of 10.3 mg/L the next morning at 05:42, which the calculator could
not place against dialysis.

**Rejected: correcting the level.** The handoff proposed two adjustments before fitting:
- multiplying an immediately post-HD level by a 1.15 "rebound factor";
- back-calculating a pre-HD value as post ÷ (1 − 0.40).

Either one invents an observation, and neither constant has a source (rule 1). On the handoff's
own example it would also have been wrong. The 05:42 level was drawn about 12 h after the
session, which is interdialytic and past redistribution. Back-calculating it gives "17.2 pre-HD",
70% more drug than was measured. Levels are fitted exactly as measured.

**Evaluated and not offered: a session-clearance model.** Hui et al. (J Antimicrob Chemother
2019;74:130) adds a clearance only while a session runs, so rebound comes from the
two-compartment structure rather than a factor. An exact event-stepping engine was built and
tested against an independent RK4, with mass balance holding to 1e-7. It is not shipped, for two
reasons:
- the final model's lean-body-weight covariate (LBW/65 on CLNHD, V1 and V2) has no published
  form or exponents, so only the covariate-free base model in its Supplementary Table S1 is
  fully sourced;
- the clinical owner's institution does not approve that model for dosing.

The engine is kept outside `main` for a future model.

**Built: a labelling layer on the approved Goti-HD fit.** Goti 2018 carries dialysis as a
yes/no covariate (CL ×0.7, Vc ×0.5) because its authors had no session times, so the sessions
cannot honestly enter that fit. They do four things.
1. **Logged as start and length.** Using a length rather than an end clock time avoids the
   midnight wrap SUITE 19 forbids. Sessions are validated like doses, and saved with profiles.
2. **Each level is placed against the sessions:** during, early post-HD, pre-HD, or
   interdialytic.
   - A level drawn during a session, or soon after one, carries a caution. The averaged model
     cannot see the session or the redistribution that follows it.
   - "Soon" is three distribution half-lives (3·ln2/α) of the patient's own fitted model. For
     a one-compartment fit it comes from Goti-HD's population model at the patient's
     covariates.
   - "Pre-HD" means within 12 h before a session. Both thresholds are preferences (rule 8):
     they choose a label and change no number.
3. **The fitted curve is read at the start of the next planned session.** The reading says what
   it assumes: no further dose, or the planned dose rows entered. It is compared with 15–20 mg/L
   (Hui 2019, Introduction, its refs 9–11; Instructions §4.4). A post-HD dose can be tried by
   adding a dose row, but no new dose recommendation is made.
4. **Sessions are banded on the strip, the curve and the printed chart.** The bands are a
   neutral ink tint, not a series colour (D14).

Also fixed: switching Goti-HD → Goti left the dialysis box ticked while `bState.dial` went false.

Engine parity against 51b7eaf: 225 calls, 0 differences, so the fit is untouched. SUITE 34
covers parsing, the night session with no wrap, timing classes, the window as 3 distribution
half-lives, the pre-HD reading, and that sessions never reach an objective.

**Not clinically validated.** The layer reads the fit; it does not make the fit more right for
a dialysis patient.

## D16 — Dosing on intermittent haemodialysis (2026-10-02)

The question asked: is anything else needed to dose IHD patients, scheduled or not? After D15
the tool could label HD but not dose it. Goti-HD's verdict was a steady-state regimen (e.g.
"250 mg q24h"), and HD patients are not dosed that way. Spec:
`docs/superpowers/specs/2026-10-02-hd-dosing-design.md`. Plan:
`docs/superpowers/plans/2026-10-02-hd-dosing.md`.

**Sources.** Rybak MJ et al., *Am J Health-Syst Pharm* 2020;77:835–864:
- **Rec 11:** loading by actual body weight, at most 3,000 mg.
- **Rec 13:** mg/kg by dialyser permeability and timing.
  - After HD: low permeability 25 loading / 7.5 maintenance; high permeability 25 / 10.
  - Intradialytic: low 30 / 7.5–10; high 35 / 10–15.
  - Maintenance is thrice weekly, with every session.
- **Rec 14:** pre-dialysis 15–20 mg/L is likely to give AUC 400–600 over the previous 24 h.
  Levels, not weight, drive dosing.
- **Text:** 20–40% of an intradialytic dose is removed by the dialyser.

**Built:**
- **Post-HD dose on the fitted curve.** The dose goes at the end of the next planned session (one
  in progress counts) and is sized at the start of the session after it, on the averaged
  Goti-HD fit with every entered dose. This is the same shape as DoseMeRx's "Calculate Next Dose" on its Goti HD model; no paired comparison has been captured yet.
  The rule:
  - **hold** when no dose already reads at least 15 mg/L;
  - else the **smallest 250 mg step** that lands in 15–20;
  - else the **closest step, flagged**. A maintenance dose never exceeds `DOSE_MAX_PER_DOSE_MG`.

  It reports the AUC₂₄ over the 24 h before the sizing session (Simpson, 3-minute steps,
  converged within 1%), the peak, and the same dose repeated after each later planned session.
  It counts planned dose rows already entered and says so. With fewer than two planned sessions
  it asks for them rather than assuming a schedule.
- **Empiric table before the first level.** Rec 13 for the patient's actual body weight, after
  HD and during HD, rounded to 250 mg, loading capped at 3,000 mg. **Both permeability rows are
  shown**, because the dialyser is not an input we can default safely.
- **Recurring schedule.** MWF, TuThSa or every N days. Dates are stepped on the calendar at
  local noon, so a DST change cannot shift a session (SUITE 19).
- **A dose started during a session gets a caution**, citing the removal range above.
- **The Trough module refuses a patient ticked as on haemodialysis** and offers Goti-HD. CrCl
  from creatinine does not describe clearance on dialysis.
- **The steady-state regimen is not the answer for HD.** It stays in "Regimens" as a reference,
  with a line saying so. Its flags are not shown as notes, and the HD headings are ink, not the
  alarm colour.

**Rejected:**
- **Intradialytic dosing in the recommendation.** The averaged model cannot see the dialyser's
  removal.
- **Targeting AUC instead of pre-HD.** The user chose pre-HD 15–20 as the rule, with AUC shown
  beside it.

**Checks:**
- Engine parity against 95e3e90: 225 calls, 0 differences (fits untouched).
- SUITE 35 holds 13 tests.
- **Not clinically validated** on local HD patients. The averaged model's pre-HD predictions
  carry no measured accuracy here; a DoseMeRx capture-sheet pairing is still to be done.

**Final-review fix pass (fresh reviewer, same day).** Three defects reached the pharmacist and
were fixed with a failing test first (SUITE 35.12–35.20, browser flows):
- **The print lead printed the steady-state regimen.** One frozen HD view (`hdViewFor`, read at
  fit time `r.fitNowH`) now feeds the screen, every redraw and the print. The verdict says when
  it was read.
- **A planned dose made the tool say "No dose".** When a planned dose is entered, it said "No
  dose… without a dose" even though that dose was what kept the level in range. A planned dose
  around the session is now read (kind `planned`), and every hold names the planned doses it
  includes.
- **The Trough refusal was invisible on first use.** The guard now begins the form run, and the
  browser check asserts the notice is visible, not merely in the DOM.

Also fixed:
- A session that ended under 6 h ago with no dose since still takes the dose, given now. The
  6 h window is a preference (rule 8).
- Every future dose is counted and named.
- "Closest" may be no dose, when every step overshoots.
- A hold above 20 says so.
- A low-confidence fit marks the HD dose provisional.
- The intradialytic flag uses overlap with the infusion.
- The empiric table acknowledges doses already given.
- For HD, no other section calls the steady-state regimen "recommended", and "Show the math"
  states the HD rule.
- The schedule rejects a time that is not a clock time.

**Deferred minors, fixed the same day:**
- **mg/kg basis shown.** Each empiric cell shows the mg/kg its rounded doses came from, so a
  250 mg rounding at a low weight is visible.
- **Session numbers match the rows.** A session is numbered by its own input row ("session 3"
  is the row labelled HD 3), not by its position in time.
- **Doses keep their units.** A dose no longer wraps away from its unit.
- **"Next" knows about doses already given.** It no longer asks for a loading dose already
  entered.


## D17 — A one-time dose when the HD schedule is unknown; the midpoint pick (2026-10-02, v3.7.0)

Spec: `docs/superpowers/specs/2026-10-02-hd-one-time-dose-design.md`. Plan:
`docs/superpowers/plans/2026-10-02-hd-one-time-dose.md`.

**The problem.** The D16 post-HD dose needs two upcoming sessions: one for the dose to follow,
one to size at. With fewer, the verdict said "Add the next sessions". The handoff's own case got
no answer:
- 1 g, HD the same day, no dose after it;
- 10.3 mg/L about 12 h after HD ended.

Pharmacists often do not know the schedule: ED and ICU admissions, transfers, AKI on HD, a
pending nephrology decision.

**What it does now.**
- **When it applies:** with fewer than two upcoming sessions, Goti-HD answers with a **one-time
  dose**. There is no mode toggle.
- **When the dose is given:** after the one session still ahead, if there is one; otherwise now.
- **Where it is sized:** at an **assumed gap to the next session**, 24 / 48 / 72 h, default 48
  (a PREFERENCE under rule 8). The gap is stated in the answer and changed with one tap (`k78`).
  - The gap is not in the fit fingerprint and not saved with a profile; Reset clears it.
  - VancoPK's HD calculator also defaults to 2 days. The user's institutional protocol rechecks
    once 72 h have passed.
- **Also shown:**
  - a **dose × gap table**, with in-range cells marked by the drawn check and screen-reader text;
  - the **missed post-HD dose** flag ("No dose entered after session N");
  - the averaged-model caution ("if the next session is delayed or cancelled, levels will run
    higher");
  - the next step ("draw a pre-HD level before the next session").
- **Print** states the gap as text.

**The pick, in both HD answers.** The in-range 250 mg step **closest to 17.5 mg/L**, the
derived midpoint of Rybak 2020 Recommendation 14's 15–20 band. Ties go to the smaller dose.
- **Why:** "smallest in range" settled near 15, which VancoPK's published arithmetic (Ke
  0.005 h⁻¹) puts at an AUC of about 380 over the prior 24 h.
- **Chosen by the user.**
- **Rule 9:** SUITE 35.4's "one step less misses 15 (the smallest)" became "no neighbouring
  in-range step is closer to 17.5". On that fixture the pick moved from 250 mg (pre-HD 16.05) to
  500 mg (18.74). No other SUITE 35 expectation changed. 35.18 now expects
  `hdViewFor(r, bState.hdGapH)`.

**A measured pre-HD level above 20 means no dose now** (added mid-build, the user's decision).
- **The trigger:** the latest level is labelled pre-HD by the session layer (D15), is above
  20 mg/L, and no dose has been entered after it.
- **The answer:** no dose, and a recheck before the next session. The dose table stays visible.
- **The basis:** the top of Rec 14's band. It matches the user's institutional practice for
  unscheduled HD, which holds above 20. No institutional content is shipped.

**Declined from the handoff, with reasons:**
- a rebound estimate (rejected in D15; Goti-HD has no rebound phase, and the example level was
  already past redistribution);
- P(AUC₂₄ > 400/600) (our uncertainty was simulated for steady-state Goti, not single HD
  doses);
- a new High/Moderate/Low grade (the fit's grade and "provisional" are reused);
- the handoff's "500 mg" (computed, never targeted);
- "repeat in 24–48 h" (no source).

The tl;dr pharmacy level-only table (Kujawski 2019: <10 → 1000 mg, 10–25 → 500–750 mg, >25 →
none) was considered and not adopted. The author presents it as "a VERY general scheme", it
cites nothing, and its 15–25 target predates and contradicts Rec 14.

**The handoff case, as answered** (fictional 70 kg, CrCl 10, Goti-HD MAP fit to 10.3 at 05:42;
missed dose flagged on session 1):

| Assumed gap | Dose | Fitted pre-HD | AUC₂₄ |
|---|---|---|---|
| 24 h | 750 mg | 18.3 mg/L | 502 |
| 48 h | 1000 mg | 18.4 mg/L | 472 |
| 72 h | 1250 mg | 18.1 mg/L | 467 |

**Cross-checks.**
- **VancoPK** (`docs/audit/probe-hd-one-time.cjs`, public, Fewel's published HD method). The probe
  reproduces the site's own screen (20.6 mg/L). Over 162 fictional cases:
  - before the pre-HD hold, 81% of doses were within one 250 mg step, median |difference|
    250 mg at each gap;
  - with the hold, 70%, median −250 mg. VancoPK still doses at pre-HD 22–25 after its 35% session
    removal; we hold.
  - **Direction of the disagreement:** at short gaps ours reads lower, because VancoPK removes
    35% at the session the dose follows while Goti-HD's averaged clearance spreads that removal.
    At long gaps ours reads higher, because the averaged dialytic clearance runs across 72 h with
    no session in it.
- **The user's institutional protocol** (private, outside every repository, compared in general
  terms only). Over 108 fictional cases, ours was within one step in 89 at the 48 h default and
  97 at 72 h, with median difference 0. Heavier patients read about one step lower at 48 h.

**Display.**
- The heading is "<dose> IV now" or "… after HD". "One-time" leads the subline, because the
  spec's "· one-time" in the heading wrapped onto two display lines at 375 px.
- The gap buttons reuse `.toggle-opt` / `.active`. The chosen table row takes the paper-deep step
  and a terracotta-ink row head.

**Tests and gates.**
- **phase2d 378/378:** SUITE 37, 37.2–37.22; SUITE 36 pins the version.
- **Browser flows 61/61:** the one-time answer and the missed flag on a phone; the 72 h button by
  keyboard, with focus kept.
- Engine parity 0 differences; phase3 21/21; phase4 49/49; rendered contrast 0 AA failures in
  light, dark and phone.

**Final review** (a fresh reviewer on the whole branch): one Critical and three Important
findings, each fixed with a test that failed first (37.19–37.22, suite 378/378).
- **C1, Critical: the above-20 hold never expired.** A Monday pre-HD level of 23 still held the
  dose after Wednesday's session while the fit read about 11. The hold now applies only to the
  dose after the session that level preceded. That session is then named "No dose after
  session N; its pre-HD level was X", not "missed".
- **I1, Important: logging a second session flipped hold into dose.** Your decision: the
  scheduled answer stays predictive, since scheduled HD is model-based in your practice, but
  shows a caution when the pre-HD level before its session is above 20.
- **I2, Important: the missed flag ignored some doses.** A dose given during the session, or one
  entered after it (given or planned), now clears it.
- **I3, Important: the pre-HD label window now gates a dose decision.** `HD_PRE_LABEL_H` (12 h,
  PREFERENCE) now says so. The trigger stays the session layer's label, as you chose.

**Deferred minors:**
- the D15 "add the next planned session" line beside a one-time answer;
- a planned dose shown without the above-20 level;
- a gap tap scrolls the page;
- `plannedCount` vs `plannedInWindow` at exactly "now";
- the unreachable `need` branches and stale "request for sessions" wording;
- SUITE 37 hand-codes 15/20/17.5;
- the test-only `HD_PREDIALYSIS_MID_FOR_TEST`;
- 35.6's old title;
- the browser fixture's normal renal function;
- quantifying the scheduled path's midpoint shift. The reviewer's 165-case sweep found the pick
  changed in 85 cases, hold → dose in 18, and repeat projections above 20 rose from 20 to 44.

**Not clinically validated on local HD patients.**

## D19 — The one-time HD dose, corrected: the gap from the last session, the pre-dialysis SCr, a give-at time (2026-10-02, v3.8.0)

**Reported from real use (fictional-equivalent case, the user's own):**
- 70 F, 51.8 kg, 149.9 cm;
- SCr 3.7 on 1 Oct and 2.0 on 2 Oct;
- 1 g at 09:18 on 1 Oct, then HD 13:42–17:45;
- a level of 10.3 mg/L at 05:42 on 2 Oct.

v3.7.0 said **1.5 g IV now**. The user expected a 500–750 mg supplement. Reproduced in the app,
with two causes and one missing input.

1. **The gap counted from the dose, not from the last session.** "Next HD in 48 h" from a dose
   at 14:54 on 2 Oct assumed the next session at 14:54 on 4 Oct, 73 h after the last one began.
   - **Now (the user's decision):** the next HD is the anchor session's start plus 24/48/72 h,
     start to start, as a thrice-weekly schedule runs. The anchor is the session the dose
     follows, else the last that began.
   - **Exceptions:** with no session logged, or when every gap has passed (the last session began
     more than 72 h ago), the gap counts from the dose, and the answer says so.
   - **Unavailable gaps:** a gap is unavailable if a dose at the ceiling (`autoTinf` of the
     per-dose maximum) could not be infused before that session. No new constant. The answer
     names the assumed next HD as a clock time, and passed gaps are disabled.
   - **Effect alone:** 1.5 g → 1 g.
2. **The SCr was drawn after dialysis.** The newest SCr, 2.0, came the morning after the
   session. Dialysis removes creatinine as well, so CrCl read 21 mL/min instead of 12, and Goti-HD
   started from CL 0.79 L/h. One level barely moved it (0.81).
   - **Now (the user's decision):** on Goti-HD, when dated serial readings span a logged session,
     the fit uses the newest SCr drawn before the session the newest reading follows
     (`hdPreDialysisScr`), and says so in a caution.
   - **With no pre-dialysis reading,** it is flagged, not replaced.
   - **With only the undated SCr field,** an info note asks for a pre-dialysis value.
   - **No value is ever altered** (rule 4): only which measured reading is used. "Renal function
     changed across the fit" is not raised for the dialysis drop.
   - **Effect, with 1:** 1 g → **750 mg** (18.2 mg/L at 3 Oct 13:42).
3. **"Give at."** The dose could only be given at 12:00 or later. The one-time answer now takes
   a date and a 24-hour time (`k79`, `bState.hdGiveAtH`).
   - It is never earlier than now or the end of the session the dose follows; an earlier time is
     clamped, and the answer says so.
   - It moves the dose, never the assumed next HD.
   - It is on screen only; paper prints the dose time.
   - **Extending it to the regular regimen's first dose** was declined for now (the user's
     choice); it is a separate change.

**Rule 9.** Tests that encoded the old anchor or the two-argument view were changed in the open:
- 37.5: read point 68 → 52;
- 37.6: 104 → 100;
- 37.7: `20 + g` → `4 + g`;
- 37.13's wording, which now names a clock time;
- 35.18, 37.17: `hdViewFor(r, bState.hdGapH, bState.hdGiveAtH)`.

SUITE 19 whitelists `b-hd-give-time`, which sits beside its date, `b-hd-give-date`.

**Final review** (a fresh reviewer on the branch): one Critical and seven Important findings,
each fixed with a test that failed first (37.28–37.31).
- **C1, Critical: the pre-dialysis SCr swap had no bounds.** It could pick a pre-AKI baseline
  (0.9, giving 1.5 g), an older value over a real pre-dialysis draw, or a reading that was itself
  post-dialysis. Now:
  - "pre-dialysis" means the session layer's own pre-HD label: at or before a session's start and
    within `HD_PRE_LABEL_H`;
  - a newest reading that is itself pre-dialysis is used as measured;
  - a post reading is replaced only by that session's pre-dialysis reading, and only if it is
    higher; otherwise it is flagged.
- **I2: an assumed session imminent at the dose time** (your decision). If the assumed session
  starts before the largest dose could be infused and the fit's own distribution phase has
  passed, or would be in progress, the dose follows it. The assumed session lasts as long as the
  anchor, and the next HD counts from its start. A gap has passed only once its assumed session
  would be over.
- **I1:** the summary and Show the math name the clock time and the anchor.
- **I3:** every 24-hour field now formats as typed ("1700" → "17:00"); a bad give-at time is
  said, not silently reset.
- **I4:** a new fit clears the give-at time, and a hold or a planned dose keeps a set time
  visible.
- **I5:** the heading says "IV at 17:00" when the dose is given later.
- **I6:** the printed SCr label is the reading used.
- **I7:** the renal-change caution compares the readings up to the one used, so a real AKI change
  still warns while the dialysis drop does not.
- **Wording:** "Next HD at … after session N began"; the disabled-button title; the
  stale-anchor text.
- **37.17's character window** was widened, because the rule text grew; the assertion is
  unchanged.

**Deferred minors:**
- focus returns to the time field after Tab;
- the date picker re-renders per segment;
- across a DST change the assumed HD is on absolute hours;
- whole-minute display of "not before".

Engine parity does not exercise HD functions, so it is not evidence for this change. The HD
evidence is SUITE 37, the browser flows and the reported case: **750 mg** with serial SCr; 1 g
with the SCr field alone, plus a note asking for a pre-dialysis value.

**Tests and gates:**
- phase2d **387/387**: SUITE 37.23–37.31;
- browser flows **62/62**: a give-at time typed as "1000" on a phone moves the dose, and the
  next HD stays anchored;
- rendered contrast: 0 AA failures in light, dark and phone.

**Not clinically validated on local HD patients.**

## D18 — The profile chart, polished; every level on the axis (2026-10-02, v3.6.0)

**Asked.** The user wanted the dosing profile graph more aesthetic "than the current black
boxes", with bolder colour differentiation for the posterior, the population and the measured
concentrations, attention-grabbing without distracting, and animation where appropriate.
They chose **"Lab-grade on paper"** over two alternatives: the same without animation, and a
dark "instrument panel" redesign that would have broken the house style.

**What changed.** Presentation only; engine parity: 225 calls, 0 differences.

- **Measured levels get their own hue, `--series-measured`:** #3e6b1f light, #a6d27c dark.
  - Until now measured data was ink (D14).
  - The new hue is the house moss deepened past the validator's chroma floor.
  - Worst protan/deutan ΔE: 12.0 light, 14.7 dark against the projection, and 20.1 against the
    fit.
  - **The dark step sits outside the line lightness band on purpose.** It is a marker, lightest
    on dark as it is darkest on paper. In-band greens collapsed into terracotta under
    deuteranopia (ΔE 0.2–5.7).
  - **Where it applies:** the profile chart, the strip, the legend, and the Trough chart's
    measured level. The values printed beside the dots stay ink.
- **The prior stays a neutral, now `--ink-soft`** (1.5 px, 6/4 dash, on every chart), so it
  reads as a curve and not a gridline. A fourth hue was tried and failed:
  - slate against the fit: ΔE 11.5 in normal vision;
  - teal against the measured green: 13.8;
  - taupe and ochre: below the chroma floor, and inseparable from green under deuteranopia.
- **The residual is drawn.** A hairline (ink 34%) joins each measured dot to the fit's ring.
  It is drawn as a 1 px rectangle, which also keeps it out of SUITE 13's count of stroked dose
  stubs.
- **Posterior and band:** the posterior is 2.5 px on a paper casing; the 80% band has hairline
  edges in its own hue.
- **The course strip:**
  - each dose is an **infusion block**: a tinted body as wide as the infusion, plus a solid cap at
    its charted start;
  - a level's value moves left of its dot when the next dot is close (it printed "15●228.4");
  - an interval label never sits on a level value.
- **The arrival** is the one authored moment.
  - **What happens:** on a new result the trace sweeps left to right in 950 ms (ease-out quart),
    with a pen point at its edge. Each level lands as the trace passes, and the strip is staged
    on the same sweep through `profileArriveDelay`.
  - **Gating:** `refreshProfileGraph` checks result identity and `profileMotionOK()`, so a
    redraw (theme, resize, a toggle), reduced motion and print draw statically.
  - **The last frame equals the static drawing.**
  - This supersedes DESIGN.md's "one quiet fade" for this chart, at the user's request.
- **The print caption** no longer claims a trough band that is not drawn.

**Reported bug, fixed: a long course lost its latest level.**
- **The report:** on a 7–8 day course with several levels, the most recent level and the curve
  around it were not shown.
- **The cause:** `profileDomain` ended at most 48 h after the last dose and ignored the levels. A
  level drawn while doses were held fell off both the curve and the strip, while the fit still
  used it.
- **Reproduced in SUITE 13:** the axis ended at 185 h, with the level at 206 h.
- **The fix:** the domain now reaches every level. Both renderers pass the levels, so the shared
  axis stays shared.

**Finish review.** One bounded pass by a fresh reviewer, on captures of the committed build,
found three material issues, all fixed with a test that failed first:
1. **The legend's prior swatch** was a CSS dashed border (~3 px dashes) against the drawn 6/4
   dash. It is now a gradient dash, and the band swatch has its edges.
2. **After "now" the posterior's 7/4 dash** read as a second prior, on the stretch read for the
   next dose. It is now a short 3/3 dash.
3. **At a near-trough level the fit's ring** was half hidden under the measured dot's halo. It is
   now drawn last, on its own casing.

**Rule 9.** The browser check "measured levels are ink, not rose" became "measured levels wear
their own hue, not ink". This is the user's direction, not a weakened test.

**Version.** `APP_VERSION` was introduced at **3.6.0**: the header and both print headers carry
it (SUITE 36). The reconstructed history is in the README. The one-time HD dose (D17), specified
earlier the same day, ships after this as 3.7.0.

**Tests.** phase2d 357/357, adding:
- five SUITE 13 tests:
  - the long-course axis;
  - the measured and prior tokens;
  - strip label overlap at 343 and 700 px;
  - the arrival's gating;
  - the key drawn as the canvas draws (finish review).
- SUITE 36 (the version).

The three polish tests were confirmed to fail against the pre-polish file. Browser flows 59/59;
phase3 21/21; phase4 49/49.

## D20 — The regular regimen's first dose can be timed (2026-10-02, v3.9.0)

**Asked.** The user's example: "1 g yesterday at 09:30, a level this morning; q24h recommended,
but I can only give it at 12:00 or later".

**The approved design** (the user chose timing and readouts only):
- **The first dose** of the recommended regimen, regular non-HD answers only, is:
  - by default, when it is due: the last dose given plus the recommended interval;
  - now, if that has passed, saying "was due …";
  - or a chosen date and 24-hour time (`k82`, `bState.firstDoseAtH`), never before now.
- **The readout:** the time against the schedule ("2.5 h after the q24h schedule"), the clock
  times after it ("then 12:00 daily"; "then every 48 h (next …)" above 24 h), and the fitted
  level when the first dose goes in.
- **One line saying the steady-state AUC₂₄ and trough are unchanged.** At steady state
  AUC₂₄ = daily dose / CL, whatever the start. **The dose never changes.** A top-up rule for a
  low level before a late dose was declined, because it would be an unsourced number.
- **Behaviour:**
  - the projection curve starts at the chosen time;
  - print carries the time and the schedule;
  - a new fit clears it;
  - a bad time is reported, not silently reset;
  - "1200" is read as 12:00.
- **Placement:** at the end of the regimen box, after the AUC and the trough, so the answer
  still leads. The label sits on its own line, with date and time side by side, so the pair fits
  the verdict column and a 375 px phone. The HD "Give at" row shares the layout.

**Final review** (a fresh reviewer): four Important findings, each fixed with a test that
failed first (38.4, 38.5).
1. **Planned dose rows were read three ways.** The due time now counts from the last entered
   dose, given or planned, and says so ("after the 1 planned dose entered"). Following the
   readout could otherwise have given two doses within 2 h.
2. **The projection now starts where the readout says,** from the same plan: clamped, and
   including planned rows.
3. **"Exposure unchanged" was untrue during the changeover.** A first dose 20 h early ran the
   first day to AUC 630. The line now reads "Steady-state … unchanged; until then an earlier
   first dose raises exposure and a later one lowers it". **AUC₂₄ over the first 24 h** is shown
   (`fittedAUC` with the regimen from the first dose), judged against 400–600 in words.
4. **The date could not be typed on desktop:** every segment re-rendered the panel.
   - `k82` now updates only the readout and the curve. Focus, the Tinkerer, the projection
     toggle and open sections are untouched.
   - The HD "Give at" date commits when the field is left: `focusout` was added to the delegated
     dispatcher, and SUITE 14's list changed accordingly. Focus goes where the user was heading.

**Minor fixes made:**
- a gap under an hour is given in minutes, never "0 h";
- daily times are wall-clock across a DST change;
- the clamp says "as of the calculation";
- the same regimen reads "Next dose".

**Rule 9:** 37.25 now expects the HD date to commit on `focusout`; 38.4's projection and k82
assertions were updated to the partial update.

**A one-off "canvas survives a resize" failure** in one browser run did not reproduce in three
further runs; it was recorded, not hidden.

**Tests and gates:**
- phase2d **392/392** (SUITE 38: the timing rules, the schedule, the readout, the wiring, the
  final-review cases);
- browser flows **63/63** (tomorrow's date typed segment by segment and "1200" read as 12:00);
- rendered contrast 0 AA failures;
- engine parity 0 differences: no engine function changed.

## D21 — Before the first level, the CrCl weight spread (2026-10-29, v3.10.0)

**Found.** A paired run against DoseMeRx, an obese adult with a low SCr and one dose, no level.
Both tools used the same model (DoseMeRx's 1-compartment model is Buelga 2005 on total body
weight), and the volumes agreed (0.98 L/kg TBW). The clearances did not: DoseMeRx 7.56 L/h,
this calculator 9.72. The difference is the CrCl:
- here, Cockcroft-Gault on AdjBW with the measured SCr gave 177 mL/min, limited to 150;
- DoseMeRx's 7.56 L/h back-solves to 116.7 mL/min (7.56 / 1.08 / 0.06);
- a 125 mL/min cap would give 8.10 L/h, so a cap at 125 does not explain it either.
DoseMeRx documents its CrCl rule for its 2-compartment model (AdjBW above 120% IBW, cap 150, the
same as this calculator's) and for its obese model, but not for its 1-compartment model. No
standard Cockcroft-Gault variant reproduces 116.7 exactly; the nearest is IBW with SCr floored
at 60 µmol/L (117.9). With one patient it cannot be identified.

**Decided (the user, 2026-10-29).**
- **The model and the cap stay.** Copying an undocumented DoseMeRx rule would be a constant
  without provenance (rule 1).
- **The uncertainty is shown instead.** Before the first level, AUC Precision lists the
  regimen's AUC₂₄ on IBW, AdjBW and TBW. Each row goes through the active model's own SCr rule,
  limits and clearance equation; AUC₂₄ is daily dose / CL, exact at steady state.
- **Weight rows only.** Rounded-SCr rows would explain gaps like this one, but they would put a
  number with no evidence behind it in front of the clinician (rule 4). One line says other
  tools may round a low SCr up.

**What it shows**, on the fictional patient in SUITE 39 (34 F, 165 cm, 118 kg, SCr 0.55),
recommended 1.5 g q8h:

| Weight | CrCl (mL/min) | Buelga CL (L/h) | AUC₂₄ |
|---|---|---|---|
| IBW 56.9 kg | 129 | 8.39 | 536 |
| **AdjBW 81.3 kg (used)** | 185 → 150 | 9.72 | 463 |
| TBW 118.0 kg | 268 → 150 | 9.72 | 463 |

**Rules** (`crclWeightSpread`, `crclSpreadNote`):
- **Shown when** the AdjBW rule is live (TBW > 120% IBW), before any level, with no manual CrCl
  at the fit, on Buelga or non-HD Goti. Hughes has its own fat-free-mass scale, and on dialysis
  Cockcroft-Gault does not estimate clearance, so it is hidden for Goti-HD and whenever HD
  sessions are logged. It is also hidden under the severe-renal hold, which gives no regimen.
  After a level the clearance estimates take over.
- **Tier:** caution when a weight puts the regimen outside 400–600 (Rybak 2020 Rec 1), judged
  on the AUC shown; otherwise info, under "All notes". No preference weight.
- **Augmented clearance:** when the rows straddle 130 mL/min (uncapped, measured SCr), the note
  names the weights it rests on. Not where the older-patient low-SCr rule applies (age above 65,
  SCr below 1.0), which already says Cockcroft-Gault may overstate clearance there.
- **SCr is named as used.** On Goti above 65 with a low SCr the rows use Goti's truncated SCr,
  and the note says so ("SCr read as 1.00 mg/dL (Goti 2018's rule above age 65; measured 0.60)")
  instead of "as measured".
- **Presentation only.** The dose is the AdjBW row's, unchanged.

**One renal note, not two (the user's review, 2026-10-29).** The user asked whether the results
were carrying too much. Measured on fictional obese cases before a level: one or two notes on
screen, eight collapsed sections, about 2.5 screens. The one real pile-up was this note: when the
weights moved the regimen out of range, it showed beside "Augmented renal clearance suspected".
That was two cautions about one CrCl, one saying "escalate" and the other "on IBW clearance is
lower". Now a renal advisory (augmented, high-from-low-creatinine, or low creatinine in an older
patient) carries the spread:
- the weights lead, then the advisory;
- the augmented-clearance actions sit under "If clearance is truly augmented:";
- the stricter tier wins;
- the advisory's "CrCl ≈ N" sentence is dropped, because the rows give it;
- its level advice replaces the closing line.
No advisory text was removed.

**Final review** (a fresh reviewer). Nothing Critical. The reviewer confirmed that the AdjBW row
equals the fit's prior bit for bit, across six patients on both models. Four Important findings,
each fixed with a test that failed first:
1. **The note listed a regimen under the severe-renal hold,** whose verdict is "no empiric
   maintenance regimen". It is now hidden there (39.9).
2. **The manual CrCl was read live at render time.** A redraw after unticking it (resize, phone
   rotation, theme) showed a note that contradicted the verdict. It is now read as it was at the
   fit, from `agCtx` (39.6, browser flow; the flow failed on the unfixed file).
3. **On Goti the note said "SCr as measured" while the rows used the truncated SCr.** It now
   names the SCr used (39.10).
4. **The augmented-clearance sentence went around the older-patient rule,** bringing back for
   that population the bedside problem the ARC rework fixed. It is held back there (39.10).

Three smaller fixes:
- in or out of range is judged on the AUC shown, never "400, outside 400–600" (39.11);
- the note is hidden when HD sessions are logged on a non-HD model (39.9);
- "a level settles it" overclaimed, and now reads "a level lets the fit estimate clearance from
  the patient rather than from a weight".
39.12 adds the reviewer's check: the used row against the fit's own CrCl readers.
**Rule 9:** 39.5 and 39.6 changed with the spec (the wording, the fit-time override).

**Deferred:**
- Near a band edge, `bayesDoseOptimizer`'s half-step grace can call an AUC in range that the
  note calls outside. The note judges the number it shows.
- `bayesInputFingerprint` does not include the CrCl override, so toggling it does not mark the
  AUC result stale. This predates D21.

**Tests and gates:**
- phase2d **404/404** (SUITE 39: the rows against an independent Cockcroft-Gault and against the
  fit's own CrCl readers, Goti's SCr rule, when it is hidden, the tier, the augmented-clearance
  split, the wording, the wiring, the merge, the final-review cases);
- browser flows **68/68** (the note on an obese patient typed in; one renal note on screen; gone
  with a manual CrCl, and not back on a redraw after unticking it; gone after a level);
- engine parity 0 differences against v3.9.0.

## D22 — The answer first: one screen, HD without a q-interval world, nothing said twice (2026-10-30, v3.11.0)

**Found.** The user asked whether the v3.10.0 results carried too much. A dual-agent critique
(`.impeccable/critique/2026-10-30T03-50-09Z__index-html.md`, 26/40) found the problem was
placement, not volume:
- the default result ran 2.5–3 screens on a desktop;
- the first-dose block (~230 px) sat between the trough and the confidence line, so confidence and
  the next step fell under the fold and the Print button covered them at 1280 × 800;
- on Goti-HD, "No dose now" sat above an open Regimens grid with q24h/q48h cells, a weight-based
  guideline regimen (1.25 g q48h, AUC 1250) and a q24h projection default.

**Chosen by the user** (from the critique's options, then a before/after mockup of the answer
column on a fictional one-level case): "Close grid, hide guideline", "Answer fits one screen" and
"Duplicates and empty rows". "Notes by relevance" and "Regimens closed by default" (for non-HD)
were not chosen and are not in this release. The user confirmed they read the first-dose time and
the level by then.

**What changed:**
- **Answer order:** regimen → AUC₂₄ → trough → confidence → Next → first dose (`firstBlock`, now
  outside the regimen box). At 1280 × 800 confidence and Next sit on the first screen, clear of
  the Print button (a browser check).
- **First dose, one line:** "Next dose 30 Oct 18:52 (was due 08:00) · then 18:52 and 06:52 daily ·
  level by then 6.7 mg/L · change". "change" (`k83`) opens the date and 24-hour time and puts the
  cursor in the date; `k82` still updates only the readouts and the curve.
- **First-day AUC₂₄ only when it leaves 400–600** (`firstDayAucHTML`), as a caution with "steady
  state unchanged". Within the band, the steady-state AUC already answers. This narrows D20, which
  showed it always; the user accepted it in the mockup.
- **On paper nothing is lost:** the printed first-dose block keeps the offset against the
  schedule, the level by then, the first-day AUC and the sentence on exposure.
- **AUC/MIC only when MIC ≠ 1.** At MIC 1 it repeated the AUC.
- **Goti-HD:** Regimens is closed and placed after Haemodialysis; the guideline comparison line and
  the "Project next doses" row are not drawn. The planned dose rows already try a post-HD dose, and
  the verdict reads them. No number changes.
- **Said once:**
  - the chart's summary paragraph is hidden (kept in the DOM for Copy summary); the canvas's
    accessible name carries it, so a screen reader no longer hears it twice;
  - the "Population estimate only" note is gone (the range, the confidence line and "0 levels" say
    it); its useful sentence, how one or two levels narrow the range, moved to Show the math's Range
    step.
- **Empty sections become one line** (`emptySectionsHTML`), placed where the first one stood:
  "Current regimen needs more maintenance doses to read a schedule. Fit vs measured needs a measured
  level." A section with something to show stays (Models with its model advice, for example).
- **"now" on the time axis** whenever it falls within `PROFILE_REACH_H` (72 h, the reach a planned
  session already had) after the curve's natural end. Before a level the tail used to stop hours
  short of now. A profile reopened days later keeps its shape. The curve and the strip now read one
  clock per redraw, so they cannot disagree about the axis.

**My calls, stated to the user before building:** the projection row is hidden on HD rather than
re-defaulted; the population note's narrowing sentence went to Show the math; print keeps the full
first-dose block. Two "Next" labels now sit one above the other ("Next" for the level advice, "Next
dose"); the user saw this in the mockup and accepted it.

**Not done:** notes chosen by relevance rather than severity; Regimens closed for non-HD answers;
one "Try a regimen" in place of three trial tools. These were the critique's other findings, and
the user left them out.

**Rule 9:**
- 38.3 and 38.5 now read the schedule offset, the first-day AUC and "exposure unchanged" from the
  printed block, where they still are; 38.5 also checks that an out-of-band first-day AUC is said on
  screen.
- The arrival test's call-shape match now includes the shared clock (`arrive, nowH`).
- The refusal guard's 600-character window was kept: the new lines were moved above it.

**Final review** (a fresh reviewer, on every gate plus its own probes at 1440, 1280 and 375 px):
no Critical or Important finding in the change. Fixed, each with a test that failed first (40.1,
40.2, browser flows):
1. **The first-day AUC was judged on the raw number but shown rounded:** 399.7 read "400, below
   400–600". It is now judged on the number shown, as D21 made the rule, on screen and in print.
2. **The first-day caution was not announced** when a time edit moved it out of the band. Its slot
   is now a live region that stays in the page, empty, until it has something to say.
3. **"change" had no subject for a screen reader.** Its name is now "Change the first dose time"
   (or "next dose").
4. **Three browser checks did not pin their claims.** The "now on the axis" check passed before about
   06:00 even without the change; it now runs on a fixed clock (today 23:00), and a probe confirms it
   fails on v3.10.0. "One line" now asserts one paragraph; a new check covers a k82 edit's first-day
   slot and "change" closing the editor.

**Deferred minors** (recorded, not fixed):
- A window resize or theme change re-renders the whole result. That closes an open first-dose editor
  and drops a half-typed time, though the committed time survives. The full re-render predates this
  release.
- Projected doses are spaced in absolute hours, so across a daylight-saving change they drift an hour
  from the first-dose line's wall-clock times. This dates from v3.9.0.

**Raised by the reviewer, folded in at the user's choice:** on Goti-HD the Models section said
"Suggested: Standard adult — Buelga 2005 (1-comp) is appropriate. (You are using Goti 2018.)". This
predated the release.
- **Cause:** `getModelRecommendation` was never told the patient is on dialysis. For the same
  reason, an obese HD patient was told to consider Hughes, and the one-level Cunio note called Buelga
  "often the more reliable choice".
- **Fix:** it now takes `onHD` (Goti-HD selected, or sessions logged). On dialysis it recommends
  Goti-HD ("the only model here that carries dialysis"), its banner suggests no other model, and the
  Cunio note keeps the identifiability point without the switch.
- **Off dialysis nothing changes.** The fix is advice only, never a dose; the function's return
  shape is unchanged, so engine parity stays at 0.
- **Tests:** SUITE 40.9, and a browser check that failed on the branch before the fix with the
  exact text above.

**Tests and gates:**
- phase2d **413/413** (SUITE 40: the one line and "change", the first-day AUC rule and the
  printed block, the answer order and AUC/MIC, k82/k83, the HD layout, said-once, the empty-section
  line, "now" on the axis, the HD model advice);
- browser flows **77/77** (the order measured on screen, one sentence with its controls closed,
  "change" focusing the date and closing again, the first-day slot after an edit, no AUC/MIC or
  visible summary, confidence and Next on the first screen at 1280 × 800, the HD layout typed in on
  a phone with its model advice, the empty-section line and "now" on a fixed clock before a level);
- rendered contrast: the new text 5.0–8.1:1, light and dark;
- engine parity 0 differences against v3.10.0; phase3 21/21; phase4 49/49; the comprehensive suite
  unchanged from v3.10.0.

## D23 — IV vancomycin for patients on peritoneal dialysis, dosed by level (2026-11-09, v3.12.0)

**Asked.** The user doses IV vancomycin for patients on PD from a pharmacy workstation and wanted a PD
module: "guidance and tool for what dose to give, when to redose, when to obtain levels, contingent on
PD schedule". IV, not IP. Not Bayesian; "dosing by levels is fine".

**Researched first.** The private report `…/Vancomycin /reports/Vancomycin peritoneal dialysis
dosing.md` (outside this repo) read the guidelines, the PK, the outcome cohorts and 15 public
institutional protocols.
- **Guidelines:** ISPD 2022 gives no IV vancomycin dose and drops ISPD 2016's "keep levels above
  15 mg/L" (2C).
- **Models:** the one adult PD population model (Hartinger 2023) is CAPD-only, intraperitoneal,
  single-centre and unvalidated. No APD model exists, no vendor documents one, and every public AUC
  programme routes PD to level-based dosing.
- **Kinetics:** on APD after IV dosing the half-life is 11.6 h on the cycler and 62.8 h off it
  (Manley 2001). Residual kidney function can carry 39–84% of clearance (Lam 2020).
- **Level timing:** a level drawn in the first day after a dose falls faster than later
  (Montañés-Pauls 2012). A level drawn on the cycler reads low (Lam 2020).

**Designed with the user** (spec `docs/superpowers/specs/2026-11-08-pd-iv-dosing-design.md`, plan
`docs/superpowers/plans/2026-11-08-pd-iv-dosing.md`):
- **The redose:** sized by where it puts the next level the pharmacist will draw, inside the goal they
  choose. The target-peak calculation, V × (peak − level now), is shown alongside, never as the answer.
  The user's own institution redoses to a target peak; a real case they brought showed a target-peak
  dose overshooting an SSTI goal at the next draw. That case is kept out of the repo; tests use
  fictional data.
- **The goal:** chosen per patient, from the presets 10–15 and 15–20 (Rybak 2009) or a custom range.
  No goal, no answer.
- **The decline:** measured from the patient's own levels, interval by interval, and shown as a range
  with the reason. The user's case could not be fitted by one half-life and one volume (a level within
  a day of a redose fell faster), so the tool never presents a single rate as certain.
- **PD stopped** (catheter out): in scope, the user's answer in the builder check. Drug from before the
  first IV dose means the tool asks for a level first.

**Built** (a fifth Trough-module mode, "Peritoneal dialysis"):
- **Engine** (pure, Node-tested):
  - `pdSessions` / `pdNominalSessions`: wall-clock cycler nights, held nights, nothing after PD stops.
  - `pdIntervals`: k per interval by bisection on the existing `predictConc1comp`, with V = 0.70
    (Bauer) or 0.90 L/kg (Matzke group III) × the load weight. Flags: early (< 24 h after a dose, a
    PREFERENCE), on-cycler, held-night, before-stop, prior-drug, unexplained-high/low.
  - `pdAnswer`:
    - refusals (HD, IP as well, no weight, no or bad goal, a level inside an infusion);
    - the load: 20 mg/kg, institutional (Northwestern 2026), capped at Rec 11's 3,000 mg or a lower
      local maximum;
    - the first level: the AM labs nearest 48 h, earlier with residual urine ≥ 100 mL/day;
    - the rows per 250 mg to `DOSE_MAX_PER_DOSE_MG`;
    - the pick: closest to the goal's middle, ties smaller; "closest, flagged" when out of reach;
    - above goal: no dose until the projection reaches the top;
    - the published APD/CAPD context, which never enters a row;
    - a draw on the cycler is flagged, and the verdict defers to it.
- **UI:**
  - The mode's own section. The PK model and trough target are hidden.
  - Course-table rows.
  - Local settings kept in the browser only (maximum single dose, target peak, AM-labs time).
  - The verdict by state, an SVG chart (levels, projected range, goal, cycler nights; CSS tokens),
    the options, the decline in words, and Copy summary.
  - Print through the existing Trough path.
- **AUC Precision:**
  - A "Patient on peritoneal dialysis" box refuses before anything is fitted, with a link to the mode.
  - The severe-renal advisory no longer sends PD to Goti.
  - Profiles carry the PD fields, and a PD profile ticks the box.

**Rulings** (from the plan ledger):
- "PD stopped" is a stop time on the schedule, not a fourth modality.
- Drug before the first dose with no level is guidance ("draw a level first"), not a refusal.
- With a level but no measured decline, a level below the goal gets a provisional dose that brings the
  peak to the goal's top.
- SUITE 19's clock-only test names the two recurring times of day (the cycler start and the AM-labs
  time) and proves that they become instants only calendar day by calendar day.

**Declined:**
- Intraperitoneal dosing.
- AUC or Bayesian output for PD.
- Hartinger 2023 as a prior (its typical V2 contradicts its own equation; no external validation).
- A dose uplift for residual function (ISPD 2016 and 2022 give none for vancomycin).

**Final review** (a fresh reviewer, all gates re-run plus its own probes): no flaw in the core
arithmetic, but two Critical paths would show a misleading answer. Fixed in one pass, each with a test
that failed first (41.16–41.27):
- **Critical:**
  - A dose started at the same minute as the last level was left out of the projection, so the tool
    recommended a second dose on top of it.
  - Above the goal, the expected level was quoted for a different morning from the one the draw was set
    for. The draw is now the first AM labs at which the projection reaches the goal's top, and every
    number is for that morning.
- **Important, and Minors re-graded by effect:**
  - The provisional path decided on NaN (k = 0). It now uses the search floor, and it floors to the step
    so it cannot pass the goal's top.
  - Two levels minutes apart counted as a decline. Intervals under 12 h are not used (PREFERENCE).
  - A give-at time in the past was accepted; it is now never before now.
  - The target-peak row offered 250 mg above the target.
  - A local maximum under 250 mg left a blank result.
  - A first level could be a time already past.
  - The closest pick ignored giving nothing.
  - An interval across the PD stop was unflagged; it is now `spans-stop`.
  - The heading asked for a level already drawn.
  - Print and Copy summary missed the schedule, the give-at time and the cycler caution. A "Schedule and
    course" section now carries them.
- **Pinned by new tests:** the before-stop caution, the held-night-ahead caution, and AM labs across
  DST were right but untested.
- **Standing rulings:** the 20 mg/kg load, the 24 h early cut-off and the 100 mL/day threshold stay
  as labelled institutional or preference values. Flagged intervals stay in the range with their flag.
  Ticking the PD box marks an earlier AUC result stale only at the next run (like the CrCl override).

**Not clinically validated.** The numbers follow from the patient's levels and stated sources; the tool
has not been validated against PD outcomes.

**Tests and gates:**
- phase2d **440/440** (SUITE 41: sessions, intervals and flags, prior drug, DST, the load, refusals,
  the range, the recommendation branches, the target-peak row, the context, the mode's wiring, the
  rendered answer and chart, the AUC refusal and profiles);
- browser flows **84/84** (the fictional CCPD patient typed in on a fixed clock: the answer, the early
  flag, the marked option, the cycler bands, the weight caution, print, goal 15–20, the IP refusal,
  AUC Precision's refusal and link, 375 px);
- engine parity 0 against v3.11.0; phase3 21/21; phase4 49/49; the comprehensive suite unchanged;
- rendered contrast of the new text 5.0–13.9:1, light and dark.

## Known gaps

- **Three near-duplicate dose-explorer tables** remain in the Trough-Based module
  (`index.html` ~5050, ~5389, ~5621), each `[8,12,24] × 9 doses`, classified on
  `troughMin`/`troughMax` — the trough band the Bayesian path deliberately abandoned as "a
  covert interval selector". They should collapse into one component consumed by both
  modules, banded on AUC. Not done in v3; it is a refactor, not a fix.
- **Finite-horizon exposure** is not offered. DoseMeRx's "over N days" view is arguably more
  relevant than steady state for the next 48 h in a patient whose renal function is moving.
- **Model-suitability advice** is not surfaced. The vendor guidance worth mirroring, with
  attribution: 1-comp for stable renal function and few or trough-only levels; 2-comp for
  unstable patients with ≥2 levels at different times, explicitly naming amputees, fluid
  overload, sepsis and vasopressors.

## D24 — The workstation: inputs beside the answer, local Enter, what bears on the dose in view (2026-11-10, v3.13.0)

**Asked.** `/impeccable` critique of the whole calculator (snapshot
`.impeccable/critique/2026-11-10T04-10-27Z__index-html.md`, 24/40). The user chose to fix all four
areas: workstation layout; Enter and regimen trials; what bears on the dose; the input panel and
leftovers. Two rulings came with it:
- **Model choice:** "You choose, mismatch flagged". The model is never switched for the clinician.
- **PD draw time:** "not too much attention to cycler ending for levels".

**Presentation only.** Engine parity against v3.12.0 (`3997992`): 225 calls, 0 differences. The one
engine-side change is in the PD mode, which parity does not cover. It is the user's ruling, and
SUITE 41 records it.

**Built.**
- **Workstation layout.** From 1001 px the input column sticks under the header, scrolls on its own and
  pins Calculate or Run at its foot. Its children never shrink: a fixed-height flex column collapsed the
  mode bar to nothing until `flex-shrink: 0`, a defect found by the browser flows, not by eye. A run moves
  the window only when the answer's top is off screen; it used to glide to the top for about a second.
- **Print** is "Print or save as PDF" among each answer's actions: Trough, PD and AUC. The floating pill
  covered "Show the math" and "Copy summary" at 1280 × 800.
- **The mode bar** wraps whole labels instead of breaking "Steady-state trough" over two lines.
- **Enter.** The global handler skips results and profiles. A field in a `[data-enter-scope]` presses
  its `[data-enter-default]`: Preview in Explore, Predict in "Try another regimen", Save for a profile.
  Before, Enter in a result field rebuilt the result, closing the section and losing the trial, and
  Enter in the profile name ran the calculation. The per-field `k58` is gone, so Predict runs once.
- **The Regimens pick** opens Explore and is announced. The picked cell takes the paper step, the word
  "trying" and `aria-pressed`. The old blue outline looked like the Recommended border.
- **The model.**
  - `markSuggestedModel` marks the suggested tile once weight and height are known.
  - `modelMismatchText` gives one line in the confidence slot and leads the Models gist, for population
    mismatches only: class-3 obesity off Hughes, or Hughes below BMI 40.
  - A level count or ICU suggesting Goti is not a mismatch. Dialysis keeps its own handling (D16).
- **Notes.** A note over `NOTE_CLAMP_CHARS` (300 characters) shows three lines and "Read the rest:
  <word>". The number is a preference (rule 8); print shows every note whole.
- **Regimens** opens closed, with the gist "N within 400–600 · recommended X". It was 745 px and about
  90 numbers open. The weight-based guideline regimen moved into Show the math, so the first screen no
  longer carries a third regimen.
- **The input column.**
  - Order: mode, patient, creatinine, course, target, then profiles, the same in both modules. AUC
    Precision's model now follows the patient it is chosen for.
  - Profiles sit at the foot. Between the patient and the creatinine they cost five Tab stops; at the
    top they pushed the patient below the fold.
  - The PD mode hides amputation, creatinine and the loading dose (`.not-pd`). A ticked HD box stays in
    view, because the refusal it causes must be undoable.
- **One time grammar.** The seven Trough datetime-local fields are now each a date and a 24-hour time
  with a read-back ("9 Nov 19:30"). `dtPairValue` composes them into the hidden input that keeps the old
  id, so `elapsedHours` reads what it always read; SUITE 19 is re-pointed, not loosened. Date inputs take
  the field style everywhere: the PD stop and give-at dates had shown the browser's white box since
  v3.12.0.
- **Clear all fields** is a text action at the top of each column, with Undo (`clearWithUndo`). It
  restores every field, row and toggle; the browser flows prove the restored AUC form gives the same
  answer.
- **No native `confirm()` remains.**
  - Clearing the comparison and deleting a profile offer Undo.
  - Saving with a stale fit saves without the fit and says so.
  - An empty profile is refused inline.
  - Rows added by hand take the focus.
- **Legibility.**
  - The dose and its unit never part ("Give 500 mg").
  - The PD chart is drawn at its shown width, so its 12 px text is 12 px on screen (it was 8–9 px).
  - Regimens trough figures are at 4.8:1 or better.
  - Blocked cells say "over limit" instead of fading to 2.2:1.
  - No 1–3 px radii and no 11 px text remain.
- **The PD draw (the user's ruling).**
  - The next draw reads "with AM labs" and no more.
  - The "Draw after the cycler" caution and the summary's cycler wording are gone.
  - `drawOnCycler` is still computed.
  - A level drawn on the cycler keeps its flag in "The decline".
  - This reverses a v3.12.0 choice.

**Rulings made in the build.**
- **Profiles at the foot, not the top:** the first build put them at the top, which pushed the patient
  below the fold at 1280 × 800. If wrong, it costs a move of one block.
- **Clearing the Trough form** first kept its old reach (every number field in both modules). The final
  review showed why that was wrong (below), so each module now clears and restores its own column.
- **The model mismatch** is said for population mismatches only, so two levels on Buelga is not called
  a mismatch. If wrong, it adds a line to more verdicts.

**Final review** (a fresh reviewer, 2026-11-10). One Critical, three Important, four Minor. Every
Critical and Important fix began with a test that failed first.
- **Critical: Undo after a profile load** restored patient A's fields while patient B's CrCl override
  stayed live behind an unticked box. The answer changed from 1 g q12h to 750 mg q24h.
  - Undo now re-derives the override, the weight basis and the amputation from the restored fields.
  - A profile load ends the Undo.
- **Important:**
  - A Trough Undo restored the AUC rows without their counters, so the next row had duplicate ids and the
    fit refused. Each module now snapshots its own column.
  - Serial SCr values (no ids) were lost. Row fields are now kept by position.
  - An alarm note's HOLD instruction was hidden behind "Read the rest". Alarms are never clamped.
- **Found by the review, already live in v3.12.0:** Clear left the CrCl override ticked, with its value
  box blanked, while every model kept the old value. The next patient got CrCl 30. Clearing now unticks
  it. This is the one behaviour fix in this release; it changes no calculation, only what Clear clears.
- **Minors, all fixed:**
  - After back or forward, the hidden instant is re-composed on `pageshow`.
  - A custom intended regimen shows after an AUC Undo.
  - The suggested tile follows ICU, levels and sessions.
  - A BMI just under 40 never reads "40.0".
  - Enter in the PRN fields calculates the PRN dose.
  - The `pageshow` and BMI-edge fixes were tested after the fix, not before.
- **Left as it was:** Clear does not untick amputation. That box stays visible, so nothing is hidden.

**Verified.**
- Unit suites: phase2d 458/458, phase3 21/21, phase4 49/49.
- Engine parity: 0 differences.
- Browser flows: 103/103, including 19 new D24 checks driven by real clicks and keys under the CSP.
- `impeccable detect`: 9 findings. The 7 low-contrast ones are dark-theme tokens measured against
  white; the rest are the stripes and em-dash advisories. The radius and 11 px findings are gone.

## D25 — Continue the current regimen: it enters the decision, and a change can never lower attainment (2026-11-13, v3.14.0)

**Reported.** On 1250 mg q12h, a one-level Buelga fit gave CL 4.58 L/h and t½ 9.3 h. That put AUC₂₄ at
546 mg·h/L and the trough at 14.9 mg/L: within 400–600, with 14 of 20 plausible AUCs in range. AUC
Precision recommended 1750 mg q24h at AUC₂₄ 382 instead, with a trough of 6.2 and 7 of 20, and labelled
it "Modestly below target". The user asked for an audit of the selection logic, a ranking that puts
target attainment and minimal change first, and a guarantee: never recommend lower attainment than the
current regimen unless safety requires it.

**Reproduced** against the shipped engine (scratch probe, not committed). Only a target box of about
400 gives 1750 mg q24h; the default 450 gives 1000 mg q12h (437). Four faults compounded:
- **One target number, symmetric distance.** `bayesDoseOptimizer` minimised |AUC₂₄ − target|. At 400,
  382 is 18 away and 437 is 37, so being below the band cost no more than being inside it.
- **The rounding grace decided band membership.** Half a 250 mg step, meant to keep the flags quiet,
  widened the Tier 2 filter. At CL 4.58 that was ±27 at q24h and ±82 at q8h, so 318–682 counted as
  "in band". Over a CL × target grid, 158 of 1,701 "in-band" answers sat outside 400–600.
- **The current regimen was never a candidate.** Only the steps beside the target were built, so 1250 mg
  q12h was not even evaluated at 400. AUC Precision had no "continue".
- **Uncertainty came after the ranking.** The 20-dot count was drawn for display only.
- **Not the cause:** the q24h preference. It only breaks exact ties; 1750 mg q24h won on distance.

**Scale.** Over in-range, safe current regimens (Buelga, 1–3 levels, CL 1.5–9 L/h, targets 400–600;
3,861 decisions):
- 31.2% recommended fewer in-range dots than continuing;
- 153 recommended an AUC below 400.

**The pasted guardrail was not enough.** `continue if inTarget and P_cur ≥ P_best` with attainment-first
ranking moves the reported case to 750 mg q8h: 15/20 against 14/20, with a trough of 15.6. One dot in
twenty is inside the estimate's resolution, and it costs an extra dose a day.

**The user's rulings (2026-11-13).**
- **Margin:** 2 of 20, `CONTINUE_MARGIN_DOTS`. It is a preference (rule 8).
- **First regimen:** the target box decides, inside a strict band.
- **Confidence rating:** does not gate continue versus change. *[Amended 2026-11-15: replaced by the user's
  ruling 3 of 2026-11-14. Low or Very low confidence now keeps an in-range, safe current regimen. See D26.]*

**Built.**
- **`evalRegimen`.** One regimen at steady state: exposure, trough, peak, hard rejects and flags. It is
  lifted unchanged out of `bayesDoseOptimizer` (parity 0 after the move alone) so the current regimen
  and every candidate are judged by one implementation (rule 2).
- **The strict band.** In `rankRegimenCandidates`, band membership is now exactly 400–600. The grace
  stays for flags only. The 158 out-of-band answers fall to 0.
- **`regimenDecision`.** Called by all three fit paths, it does three things in order:
  1. **Reads the current regimen** (`currentRegimenOf`), judged as a candidate with its charted infusion.
  2. **Continues** when that regimen is in 400–600 at the point estimate, is safe (no hard reject, trough
     below 20), and no admissible regimen beats it by 2 or more dots. *[Amended 2026-11-15 (D26, D-a): a
     dose-ceiling breach is no longer a hard reject for the current regimen. It is not recommendable, not
     unsafe.]*
  3. **Otherwise changes,** choosing from the whole admissible lattice (250 mg steps to 2 g, q8–48h):
     - set aside danger troughs while a safe option exists;
     - keep in-range AUCs while any exists;
     - require more dots than the current regimen, or the full margin when leaving an in-range one,
       unless the current regimen is unsafe;
     - among those within the margin of the best: the fewest interval steps from the current regimen,
       then the smallest change in daily dose, then the target box, then the ceiling yields, then
       `INTERVAL_PREFERENCE`.
- **`regimenActionHTML`.** "Continue the current regimen" or "Change from X" sits above the regimen,
  with the reason in 20-dot units below it. When the target box alone would choose otherwise, the reason
  names that choice. The same text goes into the print report, the screen-reader result and the summary.

**Rulings made in the build** (each with what it costs if wrong):
- **`possible_transition` is not a current regimen.** Detection grants it on one recent interval, so
  0, 7, 19, 22, 39 h reads "Q18H". Only `established`, or the clinician's override, counts. *If wrong:* a
  genuine order change one dose old gets the target-box answer, which is no worse than v3.13.0.
- **A change away from an in-range regimen must deliver the whole margin.** The sweep caught minimal
  change moving 750 mg q8h at 12/20 to 1000 mg q8h at 13/20. *If wrong:* a few edge regimens move one
  step further than the nearest neighbour.
- **Danger troughs are set aside before attainment ranks.** This matches the existing safety floor.
  *If wrong:* a regimen with a trough of 20 or more and more dots is passed over.
- **No current regimen on dialysis, or under the severe-renal hold.** Those answers have their own
  rules (D16, the hold). *If wrong:* nothing; their answers are not q-interval regimens.
- **A current regimen counts before any level.** Read from the prior, the never-worse rule still holds.
  *[Amended 2026-11-15 (D26, D-b, R17): it must have at least one given dose of the detected maintenance
  amount. Planned rows alone, or a given load before planned maintenance, are a start.]*
  *If wrong:* a patient on an in-range empiric regimen is told to continue and draw a level, instead of
  being moved toward the target box.
- **A safe out-of-range regimen with nothing better is continued with a warning.** An unsafe one with
  nothing admissible falls back to the refusal. *If wrong:* the warning is the only signal. *[Amended
  2026-11-15 (D26, R12): "nothing better" counted dots only, so at high clearance, where every regimen has
  0 of 20, 1 g q12h at AUC₂₄ 133 was continued at High confidence while 1.5 g q8h gave 299. An
  out-of-range regimen now changes to the admissible regimen nearest the band when that is nearer by more
  than half a 250 mg step. Only a genuine exposure tie continues.]*

**Measured after**, on the same grid as the Scale figures:
- Fewer in-range dots than continuing: 31.2% → **0**.
- Answers below 400: 153 → **0**.
- 51.5% continue. Changes from an in-range regimen sit at its edges (400–449 and 550–600); 149 of 214
  keep the interval.
- First regimens: 9.3% of answers change, from the strict band alone.
- Comprehensive scenario 6 dose attainment: unchanged at 75.2%.
- Engine parity against v3.13.0: 0 differences. Its 225 calls never reach a target-edge case or a
  current regimen, so the change is measured by the sweeps above and SUITE 43.

**Verified.**
- phase2d 478/478, including SUITE 43 (20 tests, each seen failing first); phase3 21/21; phase4 49/49.
- Comprehensive: scenarios 3 and 4 still fail by design.
- Browser flows 107/107: four new D25 checks under the CSP (continue at target 400; the screen-reader
  result; the print report; a below-range q24h that changes).

**The independent review (2026-11-13, a fresh reviewer on the strongest model).** Fixed, each test
seen failing first (SUITE 43.9, 43.10, 43.14–43.19):
- **The cap-bound alarm was lost** when a current regimen was continued or changed at high clearance.
  It was down to a caution. `capBoundFlag` now carries the alarm whatever the answer.
- **A safety change could name the current regimen,** differing only in infusion time (trough 20.05
  against 19.78). The current regimen's lattice twin is no longer a candidate.
- **Alternating doses continued their mean** ("1.125 g q12h"). They are no longer a current regimen.
- **A continued q72h (override) or q4h** fell back to q6h in Explore's selects. `regimenIntervalChoices`
  adds the interval.
- **A safety change still at a trough of 20 or more** now says so in its reason.
- **The Copy summary** says "Change from X to Y".
- **An uncomputable (NaN) trough** counted as safe; it now makes the regimen unjudgeable.
- **Two tests could not fail on what they named:** 43.10's dialysis gate and 43.9's two-compartment
  check. Both are tightened.
- **Ruled, not changed:** the override with a single charted dose is not a current regimen. That dose
  may be the load. The comment now says so.
- **Declined to judge (policy, for the user):**
  - continuing a 15–20 trough when a lower one exists;
  - deciding from the 0-level dots;
  - nearest-interval-first reaching q8h;
  - 19.9 counting as safe;
  - HD sessions logged under a non-HD model.

**Review focus (not covered by a test).**
- The 20 dots read the model's simulated width for its level count. A poor fit does not widen them; the
  confidence rating and the redraw advice carry that.
- A rising SCr or AKI is not read by the decision; the AKI note still shows.
- With a current regimen, the target box only breaks ties within the margin. The reason line names
  what it alone would give.

## D26 — The 2026-11-13 review's fixes: a hold at 20 mg/L, one set of ceilings, low confidence keeps an in-range regimen, profiles that cannot mix two patients (2026-11-15, v3.14.0)

**Asked.** v3.14.0 (D25) was held for a whole-calculator review on 2026-11-13 by four fresh reviewers. The
reports are in `docs/review/2026-11-13/`: engine, code, models and UI. Their finding numbers overlap, so
this record names the report: "engine C1", "code C1", "UI I2", "models I4". The plan is
`docs/superpowers/plans/2026-11-14-review-fixes-and-dialysis.md`, Release 1. This release is D25 and D26
together. The engine moves.

**The user's rulings (2026-11-13/14) that bind it.**
1. **Hold threshold:** 20 mg/L (`TROUGH_HIGH_MGL`). A fitted pre-dose concentration at or above it means
   "Hold".
2. **Trough module limits** are AUC Precision's: 2 g a dose, 4.5 g a day, AUC₂₄ 700, the
   augmented-clearance caution, and no empiric maintenance regimen at CrCl under 10 without a level.
3. **Low or Very low confidence protects an in-range, safe current regimen:** it is continued and the
   answer says to draw a level. Safety changes and changes from an out-of-range regimen still happen. This
   replaces D25's ruling that confidence does not gate the decision.
4. **Severe-renal advisory** (the plan's ruling 8): the guideline loading dose (Rybak 2020 Rec 11), then
   dose by measured level, with no stated interval.
5. **Earlier rulings stand:** a continue margin of 2 of 20 (`CONTINUE_MARGIN_DOTS`), and a first regimen
   from the target box inside a strict 400–600 band.

### What was fixed, and the tests that pin it

New unit tests are SUITE 44 in `phase2d_validation.cjs` (59 tests). New browser checks are the `D26:`
checks in `docs/audit/browser-flows.cjs` (44 checks, under the production CSP). Every fix began with a
test seen failing. The task reports in `.superpowers/sdd/2026-11-14-review-fixes-and-dialysis/` hold the
RED and GREEN output.

- **Code C1: saving a profile un-marked a stale result** (Task 1). `saveCurrentProfile` no longer assigns
  `bState.result` or `resultFingerprint`. "Saved without the fit" comes from `snapshot.dirty`. The
  `clearUndo()` call now follows the empty-label check, which also fixes code M17 (a refused save threw
  away a pending Undo).
  - Pinned by 44.1 and "D26: saving while stale keeps the stale mark".
- **Engine C1: a supratherapeutic patient was given a time for the next dose** (Task 2, ruling 1). The
  48 mg/L case read "First dose … level by then 43.3 mg/L", with no hold.
  - `firstDosePlan` now returns `hold`, `resumeH` and `holdNoTime`. The search runs from the unconstrained
    first-dose time in 0.25 h steps for up to 14 days (`HOLD_SEARCH_STEP_H`, `HOLD_SEARCH_MAX_H`, commented
    as search mechanics, not clinical constants).
  - The answer leads with "Hold: next dose not before <time>". With no time in 14 days it reads "recheck a
    level", draws no projection and gives no first-day AUC.
  - A chosen time is honoured, and is still a hold while it is at or above 20.
  - A planned dose at or above 20 is the dose held, and the resume time is searched on the fit without it
    (R5).
  - Copy summary, the announcement and print lead with the hold (engine E3).
  - The Trough level and two-level modes hold too. `troughHold` times the re-dose from the level itself
    through the one decay solver, `timeToDecayTo`.
  - Pinned by 44.2–44.5d, "D26: a 48 mg/L level gives Hold" (four checks), "D26: under a hold the
    projection is drawn with its note and key", and "D26: Trough level mode holds".
- **Engine C2: the Trough module recommended doses AUC Precision hard-rejects** (Task 3, ruling 2). The
  25 M at SCr 0.5 was given 2.5 g q8h (7.5 g a day).
  - `findOptimalDose` builds candidates from 250 mg to `DOSE_MAX_PER_DOSE_MG` and judges each through
    `evalRegimen(…, null)`, so the hard rejects have one implementation.
  - When nothing admissible lands in 400–600 the answer is a refusal, "No regimen recommended". It names
    every interval from q6h to q48h that works, with its regimen (R7). The cap-bound alarm is used only when
    none works (R8).
  - A current regimen over a limit leads with "Current regimen breaches a hard limit" at alarm tier,
    whatever the assessment says.
  - Explorer rows over a ceiling are marked `is-over`.
  - The two-level and random-level modes render the same refusal.
  - Pinned by 44.6–44.8g, "D26: Trough refuses 7.5 g a day", "D26: Trough shows the augmented-clearance
    caution", "D26: Trough random level renders the refusal with the cap-bound alarm", and the three
    "D26 review" checks (over-ceiling explorer row, a q24h refusal naming the intervals that work, a gap
    refusal).
- **Engine I1: severe renal impairment** (Task 3, ruling 2). At CrCl under 10 with no level the Trough
  module shows "No empiric maintenance regimen" with the severe-renal alarm note. This holds in initial mode
  and in steady-state mode with no level. The advisory now has one source, `severeRenalNote` and
  `SEVERE_RENAL`, which both modules read.
  - Pinned by 44.8 and "D26: Trough withholds at CrCl 6.5".
- **Models I4 and engine M5: the severe-renal advisory's numbers had no source** (Task 4, ruling 4). The
  advisory said "15–20 mg/kg, max 2 g", "24–48 h" and "q24h–q72h".
  - Rybak 2020 Rec 11 (B-II, printed p. 10) gives actual body weight and a maximum of 3,000 mg, and no
    mg/kg. Only that is shown: "actual body weight, at most 3 g" (from `HD_LOADING_MAX_MG` through
    `fmtDose`), then "draw a level … later doses follow measured levels, not a schedule".
  - The Trough copy never mentions the Bayesian fit.
  - The print line reads `SEVERE_RENAL.follow`.
  - `VERY_LOW_CRCL_THRESHOLD` (10) is not in Rybak 2020. The value is unchanged; a comment records its
    provenance as open.
  - Pinned by 44.9 and "D26 Task 4: the Trough severe-renal refusal names Rybak 2020 Rec 11".
- **Added Task 4b (R10): the same defect class, found by the Task 4 review.**
  - The Trough loading dose (`calcLoadingDose`) had no 3,000 mg cap, so a 130 kg patient was offered
    3.25 g beside an advisory saying "at most 3 g". It is now capped at `HD_LOADING_MAX_MG`, and the capped
    dose is modelled as given. The card says "Capped at the Rybak 2020 Rec 11 maximum of 3 g".
  - `arcAdviceListHTML` lost "q6h–q8h", "25–30 mg/kg, max 3 g" and "within 24–48 h". None had a paper
    behind it, and the 25–30 mg/kg traced only to a superseded institutional protocol.
  - The severe-renal note now says "Rybak 2020 sets no loading dose by renal function, and none for CrCl
    under 10 mL/min without dialysis" (R11).
  - Task 12a: the HD empiric table's caption wrote the maximum by hand ("at most 3,000 mg (Rec 11)"). It
    now reads `fmtDose(HD_LOADING_MAX_MG)`.
  - Pinned by 44.9a–44.9d and "D26: the Trough loading dose is capped at 3 g".
- **Engine I3: a level dated in the future was fitted** (Task 5). `runBayesian` refuses any level later
  than the analysis by more than one minute. The refusal names its row ("Level row 1: dated …, after the
  time of this analysis"). Planned dose rows are still allowed.
  - Pinned by 44.10, "D26: a level dated 30 h ahead is refused", and "D26: the same level dated in the past
    is fitted".
- **Engine I2, UI I3 and engine M1: the Next line contradicted the fit** (Task 6). Every one-level Buelga
  or Hughes fit read "a further level would add little", even beside a fit marked Low.
  - `nextLevelValue(…, fit)` takes the fit's state from `nextLevelFit(r, conf)`. A conflicted fit (Low or
    Very low, a level missed by 2 SD or more, or a second MAP solution) gives "A further level is
    recommended" and never reaches the precision branch.
  - Any cap-bound answer, whether continue, change or start, gives "Confirm the clearance with a level",
    worded for each (Task 6 and 6b reviews).
  - The Low line names the reason that set the rating (`confidenceLead`). Model disagreement names both
    AUCs. "This dose was generated from a fit the tool itself does not trust" is gone.
  - The Fit-vs-measured and Models panels point to the Next line and add no sentence of their own.
  - Pinned by 44.11–44.14b and 44.14f, with the coherence predicate `incoherent44` and its browser twin.
    The browser checks are "D26: the 76 M on Buelga never says both …", "D26: Low confidence names the
    model disagreement with both AUCs", and "D26 review: a cap-bound continue just under 400 …".
- **Added Task 6b (R12): a Critical D25 defect, found by the Task 6 review.** `regimenDecision` continued
  an out-of-band regimen as "no-better" whenever every admissible candidate had the same dots. At high
  clearance every regimen has 0 of 20: 1 g q12h at CL 15 (AUC₂₄ 133) was continued at High confidence while
  1.5 g q8h gives 299.
  - When the current regimen is out of band and safe, and the dots filter leaves nothing, the regimen whose
    AUC₂₄ is nearest the band (with dots never fewer) is chosen. It must be nearer by more than half a
    250 mg step (`roundingGraceAUC`, now the one helper for that grace).
  - A genuine exposure tie still continues.
  - The why line says "brings AUC₂₄ nearer the band, to 286" or "into the band".
  - Pinned by 44.14c–44.14f and "D26: a 0-of-20 regimen at high clearance is changed, not continued".
- **Engine I6: a two-level steady-state level later than the interval was accepted** (Task 7, R14).
  Volume came out 265 L. Now either level later than the interval plus `TROUGH_TIMING_WINDOW_H` (0.5 h, a
  preference, rule 8, now also the steady-state "observed trough" window) is refused. The message names
  both times and the interval, and says both levels must be drawn before the next dose. The first-dose
  basis still accepts late levels. No volume bound was added (D-d).
  - Pinned by 44.15 and three D26 checks: the refusal, no regimen or volume shown, and the first-dose basis
    accepted.
- **UI I2: "was due" was computed on the new interval** (Task 8, R1, R15, R16). A change from q24h read as
  a missed dose.
  - `dueH` is the last dose plus the interval of the regimen being given (`regimenBeingGiven(rec)`, the
    decision's own reading).
  - The parenthesis prints only when the first dose is now because that time has passed, and names a
    different interval: "(current q24h dose was due 13 Nov 08:00)".
  - "Next dose" against "First dose", and the printed offset, read the same regimen. A start has no
    schedule offset.
  - The default first dose is unchanged, `max(last + new interval, now)` (R1).
  - Pinned by 44.16 and 44.16a. 38.1, 38.3, 38.5 and 44.2 were re-pointed by R1 and R16, with every
    original assertion kept. Browser: "D26: on a change from q24h to q12h …".
- **UI I8 under ruling 3: a Low-confidence fit moved an in-range regimen** (Task 9). The Hughes case
  changed 1.5 g q12h (13 of 20) to 1.25 g (15 of 20) on a fit labelled untrusted.
  - The three fit paths store `decisionArgs`. `finalizeDecision(r, conf)` runs once, after the rating,
    when all of these hold: the answer is an attainment change, the current regimen is in band, and the
    rating is Low or Very low. It then re-decides with `protectInRange` and gives
    `continueReason: 'low-confidence'`.
  - The why line names the regimen set aside and the cause alone ("the models disagree by 32%"), and ends
    "Draw a level.".
  - Every reader reads the finalized answer: verdict, Next, Copy summary, announcement, print, the first
    dose, k82 and Regimens.
  - The confidence comment now states what the rating gates (rule 8).
  - Pinned by 44.17 (real Hughes Low), 44.17a (Goti, model agreement on the current daily dose), 44.18,
    44.19 (below-range, nearer-band, unsafe-trough and Task 2 safety changes still change), 44.20b, 44.22
    (idempotent), and "D26: Low confidence keeps an in-range regimen and asks for a level". 43.5 now also
    decides every case with protection, which strengthens it.
- **Engine M4 and D-b, R17: planned rows were "the current regimen"** (Task 9). `currentRegimenOf` needs
  at least one given dose of the detected maintenance amount from the schedule's opening dose. Planned
  rows alone, or a given load before planned maintenance, are a start.
  - Pinned by 44.20 and 44.20a.
- **Engine Decision 3, D-a: a charted dose above a ceiling** (Task 9). `doseCeilingBreaches` is the one
  check. For the current regimen a breach is *not recommendable*, not unsafe. A continue above a ceiling
  adds a caution naming it. Unsafe stays AUC₂₄ above 700 or a trough of 20 or more.
  - Pinned by 44.21.
- **Engine M2: "no admissible regimen puts more in range" when one did** (Task 9). The line now says the
  better regimens were set aside for a trough of 20 or more (`troughSetAside`).
  - Pinned by 44.21.
- **UI I4: nine of ten printed reports omitted "not clinically validated"** (Task 10). One constant,
  `DISCLAIMER_TEXT`, and one footer writer, `_prFooter`, serve every print path, including the empty
  ones. The two on-screen paragraphs carry the same sentence, pinned equal. The dead `.print-footer` is
  removed.
  - Pinned by 44.23 and six D26 print checks: Trough, AUC, HD, PD, an empty Trough and an empty AUC.
- **Engine I4, I5; code I2, I5, M1, M2: profiles** (Task 11, D-e, R18–R22).
  - `snapshotPatientCore(source)` reads the module on screen. A shared field that is filled in both
    columns with different values refuses the save. The refusal names each field with both values and
    offers one action, "Copy the <this module> values to <other module>" (`k99`), after which the user
    saves again (R19).
  - A save carries the other column's course (AUC doses, levels, SCr rows, HD sessions; or the Trough PD
    form) only when that column's demographics are filled and agree. Otherwise the status line says it
    was left out (R18, R22).
  - `dial` is stored and loaded only with Goti (R21).
  - `validProfile` checks every entry on read. Unreadable entries are kept and written back. Unparseable
    JSON is copied to `ainadara.profiles.v1.bak` (or a timestamped key) before anything is written, and
    the status line says so.
  - A load validates first, then clears both columns, and an empty core value clears its field.
  - `renderProfileList` uses `escHtml` on the label, date and id; the second escaper is gone.
  - Trough Clear resets the weight basis, amputation (engine M3, R20), the HD flag and the whole PD form
    (R22).
  - Pinned by 44.24–44.26c, with a fixture of profiles saved by v3.13.0 and before the core
    (`docs/audit/profile-fixtures-v3.13.0.json`), plus ten D26 browser checks: mixed patient, load clears
    the Trough column, both values and the copy action, delete one of three, dialysis profile, older
    profiles, `.bak`, Clear resets basis and amputation, the Trough-only HD profile, and the PD form.
- **Added Task 11b (R23): Clear blanked the PD local settings.** The next setting change then saved the
  blanks over the stored maximum dose, which removed the cap silently.
  - `resetForm` skips `pd-set-*`.
  - `savePdLocalSettings` never writes a blank or invalid value over a stored one, refills the field, and
    says why (`#pd-set-status`).
  - Pinned by 44.26d and "D26: Clear keeps the PD local settings".

**Not in this release (the plan places them):**
- In Release 2: code I1 (resize rebuilds the result), I3, I4, I6 and I7; models I1–I3; UI I1, I5, I6, I7
  and the UI minors; the rest of the code minors.
- In Release 3: engine I7 (CRRT and SLED).
- Engine M3 is partly done: Clear now resets the weight basis and amputation, but not "steady state: No"
  or the two-level basis. Those toggles are visible, and the decision is still open (engine Decision 7).

### Defaults taken in Release 1, each with what it costs if wrong

- **D-a.** A charted dose above 2 g, or above 4.5 g a day, is not recommendable but not unsafe. It does not
  by itself force a change. *If wrong:* a patient on 2.25 g q48h in range is continued with a caution
  instead of moved below the ceiling. At high clearance, an over-ceiling regimen below the band with
  nothing nearer is now continued as `no-better`, where before it changed for "safety".
- **D-b.** A schedule with no dose given is not a current regimen. R17 tightened this to a given
  maintenance dose. *If wrong:* an ordered but unstarted regimen gets "start" wording and the target box.
- **D-c.** The Trough module's CrCl is not capped at 150. No source for such a cap exists on its clearance
  equations; the ceilings and the augmented-clearance caution carry the safety. *If wrong:* the Trough
  readout shows a CrCl of 303 beside AUC Precision's 150. Both answers are now inside the same ceilings.
- **D-d.** A two-level volume gets no plausibility bound, because no sourced number exists. The interval
  guard is the fix. *If wrong:* an implausible volume from on-time levels is shown without comment.
- **D-e.** A profile save is refused when the two modules hold different values for a shared patient
  field. MIC counts, and so does a newly typed SCr in one column. *If wrong:* a same-patient follow-up
  needs one extra click (R19's copy action).
- **D-h.** The Trough module's own AKI check (`checkAKI`, code M4) is left as it is: it has no draw times to
  apply KDIGO's windows to. This is recorded as a known gap. *If wrong:* the Trough AKI banner can fire on a
  rise spread over weeks.

### Controller rulings R1–R24, each with what it costs if wrong

- **R1.** "Was due" moves to the current regimen's interval. The default first dose stays at
  `max(last + new interval, now)`. *If wrong:* on an interval change the default first dose stays keyed to
  the new interval, a one-line change.
- **R2.** 44.17/44.18 may pass a constructed rating into `finalizeDecision`. A browser check still drives a
  real Low fit. *If wrong:* that unit test is less end to end (44.17 uses a real Low fit in the end).
- **R3.** Implementers and reviewers ran on the strong model for clinical tasks. *If wrong:* tokens.
- **R4.** One subagent at a time. *If wrong:* time.
- **R5.** A planned dose at a fitted 20 mg/L or more is the dose held. The resume time is searched without
  it. *If wrong:* one rework of the planned-dose head line.
- **R6.** When the first planned dose is below 20, the hold is still judged at the new regimen's start,
  with the planned rows counted. *If wrong:* none found; it keeps the existing hold path.
- **R7.** A Trough refusal at the chosen interval names the intervals q6h–q48h that reach 400–600 within
  the ceilings. The specialist wording is kept only when none does. The initial-mode Next line does not ask
  for a level when nothing has been given. *If wrong:* extra text in the refusal.
- **R8.** With no working interval, initial mode keeps `capBoundFlag`'s "Confirm the clearance with a
  level before acting on it". *If wrong:* one sentence reworded.
- **R9.** The severe-renal advisory ships with no mg/kg figure. Rec 10's range is surfaced to the user (the
  open question below). *If wrong:* the pharmacist works out the mg/kg.
- **R10.** Task 4b was added for the uncapped Trough loading dose and the unsourced augmented-clearance
  figures. *If wrong:* one extra task.
- **R11.** "Rybak 2020 gives no mg/kg loading dose for CrCl under 10" over-reached. Rybak's mg/kg loads go
  by patient group (Rec 10, Rec 12), not renal function. The text now reads "sets no loading dose by renal
  function, and none for CrCl under 10 mL/min without dialysis". *If wrong:* one sentence.
- **R12.** Task 6b was added: the exposure tie-break for an out-of-band regimen. *If wrong:* an extra change
  on borderline ties.
- **R13.** Task 6b's tests are numbered 44.14c–e. *If wrong:* none.
- **R14.** "Later than the interval" means later than tau plus the module's trough-timing window (0.5 h).
  *If wrong:* a held-dose level drawn more than 30 min late is refused, and the user re-enters it on the
  first-dose basis.
- **R15.** "Was due" reads the decision's current regimen (`regimenBeingGiven`), not the Tinkerer's
  `bState.curRegimen`. *If wrong:* no "was due" on schedules the decision does not treat as current.
- **R16.** One reading of the current regimen per screen ("Next dose", the offset, "was due"). "Was due"
  prints only when the first dose is now, and names a different current interval. *If wrong:* no due time
  beside a future first dose.
- **R17.** A current regimen needs a given dose of the detected maintenance amount. *If wrong:* a patient
  whose only given dose is the load gets "start" wording.
- **R18.** A Trough save stores the AUC course only when the AUC demographics are filled and agree, and
  says so when it leaves it out. *If wrong:* a course is not saved from Trough when the AUC demographics
  are blank.
- **R19.** The D-e refusal names both values, leads with making them match, and offers one copy action.
  *If wrong:* one extra button.
- **R20.** Trough Clear resets the weight basis and amputation. *If wrong:* the pharmacist re-selects the
  basis after Clear.
- **R21.** `dial` is stored only with Goti, and a stored dial beside another model is ignored on load. *If
  wrong:* none found.
- **R22.** Clear empties the PD form, and an AUC save keeps the PD form only for the same patient. *If
  wrong:* a PD schedule is not saved from AUC when the Trough fields are blank.
- **R23.** Task 11b was added: Clear must not touch the PD local settings, and a blank never overwrites a
  stored one. *If wrong:* one small task.
- **R24.** Task 12 is split. 12a is the docs, the HD caption and the gate. Then come the final review on
  the strongest model, one fix wave, and 12b, the release mechanics; the user runs the production merge.
  *If wrong:* none.

### Engine parity against v3.13.0 (`edc5b53`)

`node docs/audit/engine-parity.cjs --ref edc5b53`: **225 calls, 72 differences.** The script prints the
first 40; the full list was taken with the print limit lifted. Every difference is a deliberate change:
- **`findOptimalDose`, 64 fields in 6 of its 16 calls (Task 3, engine C2, R7).** The ceilings now bind:
  - CL 4.2, V 60, q24h: 2,250 mg (AUC₂₄ 536, over 2 g) → 1,750 mg (417); the flag changes with it.
  - CL 9.7, V 55, q8h: 1,750 mg (5.25 g a day) → 1,500 mg (464).
  - CL 4.2 at q48h (3,500 mg), and CL 9.7 at q24h and q48h (4,000 mg), become cap-bound refusals. Each
    carries `refused`, `capBound`, `highest` (2 g), `tau`, `why`, `reason`, `others` (the intervals that
    work) and `highestAucAny`. The old dose, trough, peak, AUC and flag are gone.
  - CL 0.9, V 85, q8h: 250 mg at AUC₂₄ 833 (over 700) becomes a refusal ("every dose … breaches a hard
    limit"), naming q12h, q24h, q36h and q48h.
- **`calcLoadingDose`, 8 fields in all 4 of its calls (Task 4b).** These are the two additive fields,
  `capped: false` and `uncappedMg`. No dose changed, because the corpus never reaches 3,000 mg; 44.9a is
  the record of the cap.
- **No other function differs.** Tasks 2, 6, 6b, 8 and 9 change `firstDosePlan`, `regimenDecision`,
  `currentRegimenOf`, `finalizeDecision` and `nextLevelValue` with a fit. The parity corpus reaches none of
  them (`nextLevelValue` is called without a fit, which is unchanged). SUITE 44, SUITE 43 and the sweeps
  below are their record.

### Measured

- **Trough ceilings (Task 3).** On a grid of CL 0.3–20 × V 30/50/70/90 × q6–q48h × three infusion times,
  all 4,501 answers that were in band and within the ceilings before are identical. About 11,600 of 16,600
  calls now refuse, mostly extreme clearances, long intervals and lattice gaps. Each refusal names the
  intervals that work.
- **The tie-break (Task 6b).** In a `regimenDecision` differential of 77,760 calls against `066071e`,
  20,814 calls change from continue/no-better to change/attainment, every one to 1.5 g q8h, the highest
  admissible exposure. 920 more differ only in the no-better wording, and nothing else moved. A wider sweep
  found 145,296 changes: 145,287 to 1.5 g q8h and 9 from above the band. None changes against the
  direction of the band, lowers dots, or starts from an in-band or unsafe regimen. 5,499 genuine ties still
  continue. `evalRegimen` over 17,496 calls is unchanged by the grace refactor.
- **Ruling 3 (Task 9).** Over 2,592 fictional Hughes one-level fits on 1.5 g q12h, 339 were Low-confidence
  attainment changes from in range. All are now continued with "Draw a level".
- **Comprehensive scenario 6:** dose attainment unchanged at 75.2%.

### Verified (2026-11-15, Task 12a, branch head before the final review)

- `node phase2d_validation.cjs`: **537/537**.
- `node phase3_simulation.cjs`: **21/21**.
- `node phase4_regimen_validation.cjs`: **49/49**.
- `node phase2d_comprehensive_validation.cjs`: only scenarios 3 and 4 fail, by design. Those failures are
  scenario 3's MAE 344.2 against 260, and scenario 4's MAE 351.3 against 200, improvement 14.6 against 15
  and coverage 38.0% against 45%. Scenarios 1, 2, 5 and 6 pass.
- Engine parity against `edc5b53`: the 72 differences above.
- Browser flows under the CSP: **151/151**, 0 console problems.
- JS syntax check: OK.

### Recorded, not changed (for the final review and the user)

- **Hold eligibility differs between modules.** AUC Precision can hold on a prior-only fit, because its
  hold reads the fitted curve. The Trough module holds only on a measured level, because a population
  prediction is not a pre-dose level.
- **An interval change where only the opening dose of the new schedule is given counts as current.** A
  dose change needs a dose of the new amount (R17's exact dose match). The two cases are asymmetric.
- **A charted order change that has not started reads as a start**, for example old 1 g q12h given and new
  1.25 g only planned. No note says the charted change has not started.
- **An AUC re-save of a PD patient drops the PD form when the Trough column has no SCr.** The PD mode hides
  that field. This fails safe, and the status line says so.
- **Final-review candidates from the task reviews:**
  - The Trough hold can give a resume time before the due time.
  - Held planned rows are drawn on the curve when no projection is drawn.
  - The no-interval alarm quotes `highestAucAny` while the reason quotes the chosen interval's highest.
  - Refusals can name q6h, which the two-level and random-level selects do not offer.
  - `fmtDT` omits the year, so a level mistyped a year ahead is refused with a date that looks current.
  - The confidence line can hold two em dashes, and the cap-bound continue detail sentence is ungrammatical.
  - The Copy summary carries neither "Draw a level" nor the ceiling caution.
  - A capped 3 g load runs at 16.7 mg/min beside the infusion-rate caution (the clinical reviewer's list).
  - The qualitative augmented-clearance prose is unsourced.
  - There is no control to remove a stored PD cap, since a blank keeps it.
  - The ledger lists the smaller code-health items.

### Open question for the user

**Should the severe-renal advisory show a loading range for CrCl under 10 mL/min without dialysis, and
which one?** It now shows none (R9, R11): only Rec 11's basis (actual body weight) and maximum (3,000 mg),
then measured levels. Rybak 2020 sets its mg/kg loading doses by patient group, not by renal function, and
does not address this group. The two sourced options are:
- **Rec 10** (B-II, printed p. 10): 20–35 mg/kg may be considered in critically ill patients with suspected
  or documented serious MRSA infection.
- **Rec 12** (B-II, printed p. 11): 20–25 mg/kg actual body weight, at most 3,000 mg, may be considered in
  obese adults with serious infections.

Either would be shown with its population named, beside Rec 11's maximum. Neither is shown until the user
rules.

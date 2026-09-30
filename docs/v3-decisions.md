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

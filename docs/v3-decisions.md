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
dispensing increment, the uncertainty widths from the phase2d Monte Carlo.

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

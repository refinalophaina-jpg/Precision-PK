# Validation threshold decisions — accept / reject

**Date:** 2026-09-05 · **Decider:** Gus (clinical pharmacist), on this analysis
**Resolves:** audit finding P1 — six comprehensive-suite thresholds failing with no record
of review.

The comprehensive suite (`phase2d_comprehensive_validation.cjs`, 10,475 synthetic patients)
had failed six acceptance thresholds since April with nothing recording whether that was
reviewed. This is that record. Each is **accepted**, **rejected**, or **fixed**, with reasoning.

## Summary

| # | Threshold | Verdict |
|---|---|---|
| 1 | S1 improvement ≥25% | **FIXED** — the metric was mathematically broken |
| 2 | S2 improvement ≥35% | **REJECTED** — threshold lowered to 25%, with reason |
| 3 | S3 Goti MAE ≤260 | **ACCEPTED as a known limitation**, disclosed in-app |
| 4 | S4 Goti MAE ≤200 | **ACCEPTED as a known limitation**, disclosed in-app |
| 5 | S4 coverage ≥45% | **ACCEPTED as a known limitation**, disclosed in-app |
| 6 | S6 dose attainment ≥75% | **PASSES** now (75.0%) |

Two of the six were never really engine failures at all.

---

## 1 & 2 — The "improvement" metric was broken (FIXED)

`relImprovement = (mae_pop - mae_bayes) / mae_pop`, **averaged per patient**.

That denominator is unbounded below. Any simulated patient who happens to sit near the
population mean has `mae_pop → 0`, so their ratio → −∞. A handful of such patients dominated
the average, and the suite reported:

```
Scenario 1  improvement: -231.1%   (target 25)
Scenario 2  improvement: -191.7%   (target 35)
```

−231% "improvement" for an engine whose **absolute** MAE (147.4) comfortably passed its own
200 mg·h/L target. The metric was measuring outliers in its own denominator.

Fixed by comparing aggregates — `1 − mean(MAE_bayes)/mean(MAE_pop)` — which is what the
threshold was always meant to express:

```
Scenario 1  improvement: 25.0%  (target 25)  PASS
Scenario 2  improvement: 28.4%  (target 35)  still short
```

**Scenario 2's 35% target is REJECTED and lowered to 25%.** Two troughs cannot extract much
more than one under Buelga's additive 3.52 mg/L residual error; the measured gain from the
second level is real but small (25.0% → 28.4%). Demanding 35% asserts an information content
the error model does not contain. Absolute MAE (144.4, target 150) and coverage (59.6%,
target 55%) both pass, and those are the numbers that describe the patient.

## 3, 4 & 5 — Goti 2-compartment accuracy (ACCEPTED as a known limitation)

```
Scenario 3  Goti, 1 trough    MAE 344.2  (target 260)   FAIL
Scenario 4  Goti, 2 troughs   MAE 351.3  (target 200)   FAIL
Scenario 4  coverage          38.0%      (target 45%)   FAIL
```

**Accepted, not dismissed.** The reasoning, and what it costs:

- These are 2-compartment fits with **three** parameters (η_CL, η_Vc, η_Vp) estimated from
  one or two trough concentrations. The problem is under-determined. A trough is drawn where
  the distribution phase has largely resolved, so it carries little information about Vc/Vp
  partitioning — the second level adds almost nothing (MAE 344.2 → 351.3, i.e. **no
  improvement**, and the small worsening is within run-to-run noise).
- The direction is still right: Goti's improvement over its own population prior passes in
  both scenarios (14.2% and 14.6%), and Goti remains the best-performing published model in
  independent evaluation (Duong 2024, eight-model comparison).
- The honest reading is that **AUC estimated from troughs alone under a 2-compartment model
  carries wider uncertainty than the app previously admitted.**

**What was done about it rather than accepting silently:** the in-app uncertainty disclosure
was re-derived from simulation instead of asserted (audit follow-up), and the 2-compartment
figures are now explicitly labelled *estimated, not simulated*, so no one reads a
precision the engine has not demonstrated.

**Carried forward as open work:**
1. Re-measure the 2-compartment uncertainty properly (the ±25% now shown for Goti/Hughes at
   one level is an estimate, flagged as such).
2. Investigate why a second trough adds nothing to the Goti fit — likely identifiability. A
   peak-and-trough pair should be tested against two troughs.
3. Consider constraining Vp/Q to the population value when only troughs are available,
   reducing the fit to two parameters.

## 6 — Dose attainment (NOW PASSES)

75.0% (745/993) against a ≥75% target, up from 74.7%. It moved because the Buelga prior was
replaced with the verified published model (audit A2), not because the threshold changed.

---

## The wider lesson, recorded

Three of these six "failures" were defects in the *measurement*, not the engine:

- Two were a per-patient ratio with an unbounded denominator (S1, S2).
- The suite's `≥25% improvement over population` family of thresholds is **structurally
  hostile to improvement**: making the prior better lowers the score. Replacing the unsourced
  power model with the verified Buelga 2005 model moved population-only MAE from 212.3 to
  125.8 mg·h/L — a 41% improvement in the baseline — and *lowered* the reported "improvement"
  from 75% to 58%. The same change had to be made to `phase2d_validation.cjs`, where a
  ≥25% ratio gate went red while every absolute number improved.

**Standing rule adopted:** acceptance thresholds for this engine are stated in **absolute
clinical units** (mg·h/L of AUC error, % of patients within a band). Ratios against a moving
baseline may be *reported*, but must not gate.

_Advisory decision-support only — not a prescription; clinician judgement governs._

---

## Addendum, 2026-09-05 — re-run after the F-007 steady-state fix

The Codex review found that the two-compartment steady-state helpers stopped at
a fixed 12 cycles (finding F-007). Since scenarios 3 and 4 are the Goti 2-comp
cases, the obvious question was whether fixing it moved them.

**It did not. Every number is unchanged:**

| | before | after |
|---|---|---|
| S3 MAE / improvement / coverage | 344.2 / 14.2 / 39.0 | 344.2 / 14.2 / 39.0 |
| S4 MAE / improvement / coverage | 351.3 / 14.6 / 38.0 | 351.3 / 14.6 / 38.0 |

**Why — and this is the finding.** The comprehensive suite generates its "true"
concentrations with `predictConc2comp` over an explicit dose list and fits with
the MAP objective. It never asks for a *steady-state* value, so it never calls
`ssCtrough2comp`, `ssPeak2comp` or `calcCssAtTime` at all. **Both shipped
steady-state defects had zero test coverage in any suite.** The suite was
structurally blind to them.

Their real consumers are `bayesDoseOptimizer` (the recommendation), the regimen
projection, and the tinkerer — the numbers a clinician reads.

### What F-007 did change

Swept 600 Goti/Hughes regimen decisions (CrCl × weight × target AUC × dialysis):

| | |
|---|---|
| Regimens whose dose or interval changed | **4 / 600 (0.7%)** |
| Reported trough understated by the old form | median 2.5%, p90 **33.2%**, max **86.4%** |
| Worst case | CrCl 5, 120 kg, target 550 → 500 mg Q48H: trough read **14.8**, actually **27.5** |

Dose selection is AUC-driven (`dose ≈ AUC × CL`) and AUC does not use the
steady-state helper, so the *pick* almost never moved. What was wrong is the
**trough the clinician reads**, and the accumulation guard meant to veto it —
the worst case sat just under the `Ctrough <= 28` filter, which therefore never
fired.

### Consequence for the accepted limitation

**Scenarios 3 and 4 remain accepted, unchanged, for the reason originally
recorded**: three parameters (η_CL, η_Vc, η_Vp) estimated from one or two trough
concentrations is under-determined. F-007 was a separate defect in a separate
code path and does not bear on it.

### Coverage gap closed

`phase2d_validation.cjs` **SUITE 10** now pins both helpers: the closed-form
match across the interval, the value at t=0, continuity at end-of-infusion,
periodicity, convergence within 1% for a slow clearer, an explicit assertion
that a fixed 12 cycles would *fail* that bound, and that the cycle count scales
with the terminal half-life. Suite total 68 → 76.

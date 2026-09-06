# Dose acceptance bounds — provenance and design

**Date:** 2026-09-05 · **Resolves:** the unsourced acceptance filter in `bayesDoseOptimizer`.

## What was there

```js
// Prefer regimens with trough 7–25, AUC 350–700; among those, pick closest to target
const viable = results.filter(r => r.Ctrough >= 7 && r.Ctrough <= 28 && r.auc24 >= 350 && r.auc24 <= 750);
const pool   = viable.length ? viable : results;
```

Three problems, in ascending order of seriousness.

1. **The comment and the code disagreed** on two of the four numbers — 25 vs 28, 700 vs 750.
2. **None of the four had a source.** The project's standing rule is that a clinical
   constant whose provenance cannot be stated does not ship.
3. **The fallback silently disabled the guard.** `viable.length ? viable : results` ranked
   the *rejected* candidates by `|auc24 − target|` — an objective with no knowledge of why
   they failed — and returned one with no signal.

## What the guideline actually says

Rybak et al., *Am J Health Syst Pharm* 2020;77:835-864.

| Claim | Verdict |
|---|---|
| AUC24/MIC 400–600, assuming MIC 1 mg/L | **Rec 1 (A-II)** — the target |
| Trough-only monitoring, target 15–20 | **Withdrawn, Rec 3 (A-II)** — *"a wide range of concentration-time profiles can result in an identical trough value"* |
| An adult trough target band | **Does not exist in the 2020 guideline** |
| A minimum trough, for efficacy or resistance | **Does not exist.** That is a 2009 rule that did not survive |
| AKI risk vs trough | rises *"especially when maintained above 15 to 20 mg/L"*; trough ≥18.2 → 3–4× risk |
| AKI risk vs AUC | rises *"especially when the daily AUC exceeds 650 to 1,300"* |
| AUC <800 / trough <15 (Rec 21) | **Paediatric only.** Cannot source an adult guard |

So `28` sat 40–85% above the guideline's own AKI inflection, `750` sat inside the band it
flags as harmful, and `7` had no basis at all — it is most likely traceable to a
misattributed line in this repo's own `validation_report.md`, now retracted.

## Why trough is no longer a filter

Every candidate already sits near the target AUC **by construction** — dose is solved *from*
the target. A trough window therefore was not guarding exposure; it was acting as a covert
**interval selector**, choosing q8h vs q48h on 250 mg rounding luck, using the one quantity
that carries no information the AUC does not already carry. F-007 then showed the trough
estimate itself could read 86% low while the AUC stayed exact.

No surveyed tool filters candidates on trough. Neely 2018 dosed to AUC *"regardless of
trough concentration"*; Stanford/InsightRX make trough >15 and AUC >650 **monitoring
triggers**; PrecisePK raises an alert and leaves the regimen selectable.

## The replacement

**Tier 1 — hard reject.** Dose-domain only, so these cannot be wrong for a clinical reason.

| Constant | Value | Source |
|---|---|---|
| `DOSE_MAX_PER_DOSE_MG` | 2000 | conventional adult per-dose ceiling |
| `DOSE_MAX_TDD_MG` | 4500 | adult empiric maintenance ceiling |
| `AUC24_ABSOLUTE_MAX` | 700 | above the 650 inflection (Rybak 2020); Zasowski 2018 |

**Tier 2 — acceptance band.** `AUC24_TARGET_MIN/MAX` = 400–600, Rec 1 (A-II), at MIC 1 mg/L.
Candidates are ranked *within* the band. A regimen outside it may still be returned, but is
labelled as such.

**Tier 3 — flags, never exclusions.** `TROUGH_WARN_MGL` 15 and `TROUGH_HIGH_MGL` 20, from
the guideline's stated AKI inflection. A trough below the entered MIC (default 1 mg/L, the
guideline's own assumption) is noted as sub-inhibitory for part of the interval — this
replaces the old floor, which had no source and no clinical meaning in an AUC-guided tool.

**The fallback is gone.** When nothing is admissible the optimiser returns
`{ regimen: null, noSolution: true, reason, candidates }` and the UI shows a visible refusal
naming which bound failed and by how much.

### Rounding grace, and why it is derived rather than chosen

Doses round to 250 mg, so an AUC can land a few mg·h/L outside the band as an artefact —
most obviously when the clinician targets exactly 400 or 600. Flagging those trains people
to ignore flags. The grace is **half of what one 250 mg step moves AUC24 at that interval
and clearance** (`250·(24/τ)/CL / 2`) — computed, not picked.

## Measured effect

720 optimiser calls across CrCl × weight × target × model:

| | before | after |
|---|---|---|
| Unsignalled breach of a bound | **8** | **0** |
| Single dose > 2000 mg returned | present (up to 3750 mg) | **0** |
| Silent fallback | 1.1% of calls, always returning a rejected regimen | **removed** |
| Explicit, reasoned refusals | 0 | 30 (4.2%) |
| Returned outside the band unlabelled | yes | **0** |

The worst pre-fix case returned **3750 mg Q48H at a predicted steady-state trough of
0.0 mg/L** while the on-screen AUC read 408 and looked on target.

## Reconciled elsewhere

The app shipped four mutually inconsistent trough bands (filter 7–28, comment 7–25, results
card "target 10–20", colour rule 10–20). The AUC-module cards no longer present a withdrawn
trough target as the tool's own target; they read "safety check, not a target", and the
graph band is labelled "Trough reference". The Module-1 trough input is unchanged — that
module *is* trough-based dosing, where a user-set trough target is the point.

_Advisory decision-support only — not a prescription; clinician judgement governs._

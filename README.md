# Vancomycin TDM Calculator

AUC-guided vancomycin therapeutic drug monitoring, per the 2020 ASHP/IDSA/PIDS/SIDP
consensus guideline. A single self-contained HTML file: vanilla JS, no build step, no
JavaScript dependencies, runs offline apart from the Google Fonts stylesheet.

**Status: Live · v2.1.** The canonical home is now
**[pharmacy.ainadara.com/vancomycin](https://pharmacy.ainadara.com/vancomycin)**, with an
in-depth guide to the tool and its mathematics at
[/vancomycin/how-to](https://pharmacy.ainadara.com/vancomycin/how-to).

This repository remains the **source of truth for the engine and its tests**. The hub serves
`index.html` verbatim as a static asset under a hash-pinned CSP, so the file here and the file
there are byte-identical by construction. The original
[Precision-PK Pages URL](https://refinalophaina-jpg.github.io/Precision-PK/) still resolves.

Audited against primary sources and externally reviewed in September 2026 — see
[`docs/audit-2026-09.md`](docs/audit-2026-09.md),
[`docs/dose-acceptance-bounds.md`](docs/dose-acceptance-bounds.md),
[`docs/validation-threshold-decisions.md`](docs/validation-threshold-decisions.md) and
[`docs/ui-and-graphics-audit-2026-09.md`](docs/ui-and-graphics-audit-2026-09.md).

**Updating the deployed copy:** copy `index.html` into `pharmacy-ainadara/public/vancomycin/`,
recompute the CSP script hash (the command is in that repo's `public/_headers`), rebuild, and
re-run `npm run vanco-screenshots` if the UI changed.

> Advisory only — not a prescription. Every recommendation requires clinician review.

## Running it

Open `index.html` in a browser. That is the whole app.

```bash
open index.html
```

`index.html` is the canonical source **and** what GitHub Pages serves — the two must stay
identical. To confirm the working copy matches production:

```bash
git hash-object index.html   # must equal the deployed blob sha
```

## Layout

| Path | What it is |
|---|---|
| `index.html` | The application. ~9,000 lines: CSS to ~1,527, markup to ~2,506, one inline `<script>` after that |
| `phase2d_validation.cjs` | Primary validation suite — 13 suites, traces, shrinkage, Monte Carlo, canvas rendering |
| `phase3_simulation.cjs` | ~12,000 fits: per-model self-consistency, cross-model disagreement, stratified attainment |
| `phase2d_comprehensive_validation.cjs` | 10,475 synthetic patients across 6 scenarios |
| `Phase2_Plan.md` | The real architecture reference for the Bayesian engine |
| `Vancomycin_TDM_Software_Instructions.md` | Clinical source-of-truth: guideline rationale, equations, special populations |
| `validation_report.md` | Phase 1 validation, April 2026 — **predates the Bayesian engine** |
| `archive/v0-march-2026-superseded.html` | The earlier March build. Not deployed, kept for reference |
| `archive/react-branch-abandoned/` | An abandoned React/recharts rewrite (see below) |

Reference PDFs (`Literature/`, `DoseMeRx/`, `Hermann Vanc/`, `Clin Calc/`, `VancoPk/`) live
one level up in the project folder and are deliberately **not** in this repo — it is
public, and they are third-party copyrighted papers.

## Modules

**Trough-Based** — deterministic, four sub-modes: initial population dose (with loading
dose), steady-state trough fit, two-level Sawchuk–Zaske, and single random level.

**AUC Precision** — MAP Bayesian fitting against a Burton 1985 objective, with four
population priors:

| Prior | Structure | Intended population |
|---|---|---|
| Buelga 2005 | 1-compartment | General adult |
| Goti 2018 | 2-compartment | General adult; dialysis covariate |
| Goti 2018 (HD) | 2-compartment | Intermittent haemodialysis |
| Hughes 2024 | 2-compartment, FFM-scaled | Class-3 obesity |

**Continue Course** — reload a saved profile's individual PK and re-dose against it.

Cross-cutting: KDIGO AKI staging from serial creatinine, augmented-renal-clearance and
very-low-CrCl advisories, `localStorage` profiles, and a print report.

**Not implemented:** CRRT, paediatrics, neonates, continuous infusion. Do not use this tool
for those populations.

## Validation

Run the suites directly — no install, no dependencies:

```bash
node phase2d_validation.cjs
```

Each script extracts the math out of `index.html` in a Node `vm` sandbox, so it tests the
shipped file rather than a copy.

| Suite | Result (2026-09-05) |
|---|---|
| `phase2d_validation.cjs` | **101 / 101 pass** |
| `phase3_simulation.cjs` | **21 / 21 pass** |
| `phase4_regimen_validation.cjs` | **40 / 40 pass** — regimen detection |
| `phase2d_comprehensive_validation.cjs` | **6 thresholds fail** — its own verdict is "Share with caveats" |

The comprehensive suite fails **scenarios 3 and 4 by design** — an accepted, documented
limitation of two-compartment fitting from troughs alone (three parameters, one or two
troughs: under-determined). Scenarios 1, 2, 5 and 6 pass. Each accept/reject decision, and
the reasoning behind it, is recorded in
[`docs/validation-threshold-decisions.md`](docs/validation-threshold-decisions.md) — including
the finding that three of the original six "failures" were defects in the *measurement*, not
the engine.

Notes on the harness:

- `validation_report.md` is **Phase 1 only, April 2026** — it predates the Bayesian engine and
  carries a scope banner saying so. Its minimum-trough claim has been retracted in place: the
  2020 guideline contains no such recommendation, and that line was the probable origin of an
  unsourced constant that shipped.
- Model constants are **parsed out of `index.html`** by `harness_constants.cjs`, which throws
  if one goes missing. They are never hand-copied — a copied constant let the suite pass
  against a value the app no longer used.

## The archived React branch

`archive/react-branch-abandoned/` is a separate March codebase, not an ancestor of the
shipped app. It implements neonatal (Grimsley-Thomson), paediatric, CRRT, Crass-2018 obese
and continuous-infusion modes that the live calculator has never had, plus nephrotoxin
interaction scoring — worth mining, not running.

It sends patient demographics, creatinine, doses and levels directly to `api.anthropic.com`
from the browser under a key held in `localStorage`. **No key is committed**, and the code is
dead relative to the shipped app, but that design must not be revived as-is.

## History

Built March–April 2026; work stopped 12 April. Reactivated September 2026: consolidated under
version control, audited against primary sources, externally reviewed, and folded into the
pharmacy hub as v2.0. `v1-april-2026` tags the state as it was left, before any consolidation.

The audit and review found and fixed, among others: a Bayesian prior that was not the model it
was labelled as; a steady-state equation missing its residual term; a two-compartment steady
state that stopped at 12 cycles and read troughs 40% low in renal impairment; regimen
detection that reported a deliberate order change as an error; and a dose filter whose four
bounds had no citation and which silently returned regimens it had just rejected.

A second pass in September brought the interface into line with `ainadara.com` and audited
the rendering code, which no suite had ever executed. It found eight high-severity
correctness defects in what the charts *drew* — a comparison chart that plotted a Q6H
regimen's 6-hour trough at 12 hours, a y-axis that painted the therapeutic band off the top
of the plot, x ticks that aligned with no dose boundary at most intervals, and a theme
toggle that had never repainted the graphs because it called a function that does not exist.
`SUITE 12` now drives the real renderer through a recording canvas. See
[`docs/ui-and-graphics-audit-2026-09.md`](docs/ui-and-graphics-audit-2026-09.md), which also
lists what was deliberately left open.

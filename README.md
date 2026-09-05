# Vancomycin TDM Calculator

AUC-guided vancomycin therapeutic drug monitoring, per the 2020 ASHP/IDSA/PIDS/SIDP
consensus guideline. A single self-contained HTML file: vanilla JS, no build step, no
JavaScript dependencies, runs offline apart from the Google Fonts stylesheet.

**Status: Live — pending audit.** Deployed at
[refinalophaina-jpg.github.io/Precision-PK](https://refinalophaina-jpg.github.io/Precision-PK/)
and linked from [pharmacy.ainadara.com](https://pharmacy.ainadara.com). A code and math
review is in progress; see [Validation](#validation) for what is and is not verified.

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
| `index.html` | The application. ~7,700 lines: CSS to ~1,527, markup to ~2,506, one inline `<script>` after that |
| `phase2d_validation.cjs` | Primary validation suite — 10 suites, traces, shrinkage, Monte Carlo |
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

| Suite | Result (2026-09-04) |
|---|---|
| `phase2d_validation.cjs` | **66 / 66 pass** |
| `phase3_simulation.cjs` | **21 / 21 pass** |
| `phase2d_comprehensive_validation.cjs` | **6 thresholds fail** — its own verdict is "Share with caveats" |

The comprehensive suite fails on scenario 1 and 2 improvement, scenario 3 and 4 MAE,
scenario 4 coverage, and scenario 6 dose attainment (74.7% against a ≥75% target). **Nothing
in this repo records whether those failures were reviewed and accepted.** Treat them as
open until the audit resolves them.

Two caveats on the harness itself:

- `validation_report.md` concludes "Ready to Share", but it is **Phase 1 only, dated 7 April
  2026** — written before the Bayesian engine existed. It is not a verdict on the current app.
  It also cites a `validation_comprehensive.js` that is not in the repo.
- `const`/`let` cannot be read out of a `vm` context, so each script **re-declares the model
  constants by hand** at the top (`Q_GOTI`, `OMEGA2_*`). That copy can drift from `index.html`
  without any test failing.

## The archived React branch

`archive/react-branch-abandoned/` is a separate March codebase, not an ancestor of the
shipped app. It implements neonatal (Grimsley-Thomson), paediatric, CRRT, Crass-2018 obese
and continuous-infusion modes that the live calculator has never had, plus nephrotoxin
interaction scoring — worth mining, not running.

It sends patient demographics, creatinine, doses and levels directly to `api.anthropic.com`
from the browser under a key held in `localStorage`. **No key is committed**, and the code is
dead relative to the shipped app, but that design must not be revived as-is.

## History

Built March–April 2026; work stopped 12 April. Reactivated September 2026 to be audited and
folded into the pharmacy hub. `v1-april-2026` tags the state as it was left, before any
consolidation.

# Vancomycin TDM Calculator

AUC-guided vancomycin therapeutic drug monitoring, per the 2020 ASHP/IDSA/PIDS/SIDP
consensus guideline. A single self-contained HTML file: vanilla JS, no build step, no
JavaScript dependencies, runs offline apart from the Google Fonts stylesheet.

**Status: Live · v3.16.0** (see [Version history](#version-history)) — results redesigned 2026-09-29 (answer first, read off the patient's
course; see [`DESIGN.md`](DESIGN.md) and [`PRODUCT.md`](PRODUCT.md)). The canonical home is now
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
recompute the CSP script hash (the command is in that repo's `public/_headers`), rebuild, run
`docs/audit/browser-flows.cjs` against the built `dist` under that CSP, and re-run
`npm run vanco-screenshots` if the UI changed (the how-to guide is illustrated with them).

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
| `index.html` | The application. ~20,200 lines: CSS to ~2,833, markup to ~4,269, one inline `<script>` after that |
| `phase2d_validation.cjs` | Primary validation suite — 46 suites, traces, shrinkage, Monte Carlo, canvas rendering |
| `phase3_simulation.cjs` | ~12,000 fits: per-model self-consistency, cross-model disagreement, stratified attainment |
| `phase2d_comprehensive_validation.cjs` | 10,475 synthetic patients across 6 scenarios |
| `Phase2_Plan.md` | The real architecture reference for the Bayesian engine |
| `Vancomycin_TDM_Software_Instructions.md` | Clinical source-of-truth: guideline rationale, equations, special populations |
| `validation_report.md` | Phase 1 validation, April 2026 — **predates the Bayesian engine** |
| `archive/react-branch-abandoned/` | An abandoned React/recharts rewrite (see below) |

Reference PDFs (`Literature/`, `DoseMeRx/`, `Clin Calc/`, `VancoPk/`, and the user's institutional protocol, private) live
one level up in the project folder and are deliberately **not** in this repo — it is
public, and they are third-party copyrighted papers.

## Modules

Two modules. **Trough-Based** — deterministic, four creatinine-based sub-modes: initial population dose
(with loading dose), steady-state trough fit, two-level Sawchuk–Zaske and single random level. Since
v3.16.0 one **Renal replacement** selector, shared by both modules (None, intermittent haemodialysis,
hybrid SLED / PIRRT, CRRT, peritoneal dialysis), routes a dialysis patient away from them:

- **Peritoneal dialysis (IV):** level-based, not a model (D23).
- **CRRT:** the Rybak 2020 Rec 16 reference by actual body weight, then a level-based answer from the decline
  between the patient's own levels while the circuit ran at one rate and modality. No AUC, no creatinine, and
  no dose scaled from the effluent rate (D28).
- **Hybrid (SLED / PIRRT):** the Rybak 2020 Rec 15 reference only.
- **Intermittent haemodialysis:** a pointer to Goti 2018 · HD in AUC Precision, and beside it a peak-equation
  reading from four numbers you set in your browser; the app ships none of them (D28).

None of the dialysis answers is clinically validated.

**AUC Precision** — MAP Bayesian fitting against a Burton 1985 objective, with four
population priors:

| Prior | Structure | Intended population |
|---|---|---|
| Buelga 2005 | 1-compartment | General adult |
| Goti 2018 | 2-compartment | General adult; dialysis covariate |
| Goti 2018 (HD) | 2-compartment | Intermittent haemodialysis |
| Hughes 2024 | 2-compartment, FFM-scaled | Class-3 obesity |


Cross-cutting: KDIGO AKI staging from serial creatinine, augmented-renal-clearance and
very-low-CrCl advisories, `localStorage` profiles, and a print report.

**Not implemented:** session-clearance HD modelling, intradialytic dosing recommendations, a Bayesian
CRRT model, AUC in CRRT, a level-based hybrid answer, SLED / PIRRT dosing beyond the guideline reference,
continuous infusion, intraperitoneal dosing, AUC or Bayesian dosing for peritoneal dialysis, paediatrics,
neonates. Do not use this tool for those.

## Validation

Run the suites directly — no install, no dependencies:

```bash
node phase2d_validation.cjs
```

Each script extracts the math out of `index.html` in a Node `vm` sandbox, so it tests the
shipped file rather than a copy.

| Suite | Result (2026-11-17, v3.16.0) |
|---|---|
| `phase2d_validation.cjs` | **712 / 712 pass**, also under `TZ=Pacific/Auckland` and `TZ=UTC`; the run fails if the count differs from `EXPECTED_TOTAL` |
| `phase3_simulation.cjs` | **21 / 21 pass** |
| `phase4_regimen_validation.cjs` | **49 / 49 pass** — regimen detection |
| `phase2d_comprehensive_validation.cjs` | Scenarios 1, 2, 5, 6 pass (dose attainment 75.2%); **scenarios 3 and 4 miss four thresholds by design** |
| `docs/audit/mutation.cjs` | **120 of 120 mutants killed**, exit 0 — each mutation of `index.html`, made in memory, must fail phase2d, phase3 or phase4. Part of the release gate for clinical releases |
| `docs/audit/engine-parity.cjs --ref <sha>` | **0 differences** for a presentation change — proves the engine was left untouched. v3.14.0 against v3.13.0 (`edc5b53`) reads 72 (D26); v3.15.0 against v3.14.0 (`b410477`) reads 23 (D27); v3.16.0 against v3.15.0 (`bcee5dd`) reads 0 (D28). Every one is a deliberate change listed in the decision record |
| `docs/audit/browser-flows.cjs` | **262 / 262** — real clicks and keystrokes under the production CSP (`docs/audit/serve-csp.py`), desktop and 375px. Needs Playwright, which this repo does not install |

The comprehensive suite fails **scenarios 3 and 4 by design** — an accepted, documented
limitation of two-compartment fitting from troughs alone (three parameters, one or two
troughs: under-determined). Scenarios 1, 2, 5 and 6 pass. Each accept/reject decision, and
the reasoning behind it, is recorded in
[`docs/validation-threshold-decisions.md`](docs/validation-threshold-decisions.md) — including
the finding that three of the original six "failures" were defects in the *measurement*, not
the engine.

CI (`.github/workflows/test.yml`) runs the syntax check, phase2d (also under `TZ=Pacific/Auckland`),
phase3, phase4 and the mutation gate on every push and pull request. The browser flows and engine parity
are run by hand before a release.

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

## Version history

The build names its version in the header and on the printed report (`APP_VERSION`). Every
release bumps it: **minor** for a change in clinical behaviour or a new feature, **patch** for
fixes and wording, **major** for an engine or model overhaul. The header said "v3.0" through
the six releases after it; the table below reconstructs them from git (2026-10-02).

| Version | Date | What shipped | Commit |
|---|---|---|---|
| 3.0 | 2026-09-12 | One temporal model; the ranking stops pretending to choose an interval | `7f04623` |
| 3.1 | 2026-09-28 | Engine audit fixes | `61dbb6d` |
| 3.2 | 2026-09-29 | Results redesign: the answer read off the patient's course (D12, D13) | `7def88a` |
| 3.3 | 2026-09-30 | Model and measurement in different colours across the charts (D14) | `51b7eaf` |
| 3.4 | 2026-10-02 | Haemodialysis sessions (D15) | `95e3e90` |
| 3.5 | 2026-10-02 | Dosing on intermittent haemodialysis (D16) | `6c1ed2b` |
| 3.5.1 | 2026-10-02 | D16 minors: the mg/kg basis, session numbering | `9710104` |
| 3.6.0 | 2026-10-02 | Profile polish: measured levels in their own hue, the residual drawn, the arrival; every level on the axis on a long course (D18) | `a032a61` |
| 3.7.0 | 2026-10-02 | One-time HD dose when the schedule is unknown; both HD answers pick the step closest to 17.5 mg/L; pre-HD above 20 holds (D17) | `f7ec425` |
| 3.8.0 | 2026-10-02 | One-time HD dose corrected: the gap counts from the last session's start; the pre-dialysis SCr on Goti-HD; a give-at time (D19) | `028d326` |
| 3.9.0 | 2026-10-02 | The regular regimen's first dose can be timed; schedule and level by then; dose unchanged (D20) | `f1abe4f` |
| 3.10.0 | 2026-10-29 | Before the first level, an obese patient's regimen is shown on IBW, AdjBW and TBW; SCr as measured; dose unchanged (D21) | `0b21a24` |
| 3.11.0 | 2026-10-30 | The answer first: confidence and Next on the first screen, the first dose on one line; on Goti-HD the q-interval grid closed after Haemodialysis, no guideline line; duplicates and empty sections gone; "now" on the axis; HD model advice names Goti-HD (D22) | `32a9da4` |
| 3.12.0 | 2026-11-09 | IV vancomycin for patients on peritoneal dialysis: a level-based Trough mode — what to give, whether today, when to draw next, from the patient's own levels and cycler schedule; AUC Precision refuses PD (D23) | `3997992` |
| 3.13.0 | 2026-11-10 | The workstation: inputs scroll beside the answer with Run pinned; Print in the answer; Enter does the local job; Regimens closed, a pick says "trying"; the model mismatch in one line; long notes clamped; one date-and-time grammar; Clear with Undo; PD draw without cycler-end wording (D24) | `edc5b53` |
| 3.14.0 | 2026-11-15 | Continue the current regimen: AUC Precision judges the regimen being given first and continues it while in range unless another puts 2 more of 20 plausible AUCs in range; a change never lowers attainment except for safety, and says why; the band is strictly 400–600 when choosing (D25). The 2026-11-13 review's fixes: a fitted pre-dose level of 20 mg/L or more holds the next dose; the Trough module obeys the same ceilings and withholds in severe renal impairment; only sourced loading numbers; future and late levels refused; Low confidence keeps an in-range regimen and asks for a level; "was due" is the current regimen's; every print says not clinically validated; profiles cannot mix two patients (D26) | `b410477` |
| 3.15.0 | 2026-11-15 | Tests that can fail: a mutation gate (63 mutants) and CI on every push; Hughes constants parsed, counts pinned. Hughes and Goti fits also start on the peripheral volume, so Hughes reaches the lower minimum (and says when two fit); a Hughes patient outside the population the model was built in gets one caution line; a fit whose latest level is before steady state reads a wider, simulated uncertainty band, which the dots and the continue-or-change count use. The Hold: a held planned dose is never drawn as given; the horizon names its origin; on Goti a fitted-only reading, and in AUC Precision a level drawn within 12 h of the first dose and before the second, is a caution that asks for a level instead of a Hold (the user's rulings U5, U6a, U7); a fitted and a measured level both at 20 or more always hold. A resize or theme change repaints without rebuilding the result; focus, PD announcement and chart, notation, touch targets, Delete all profiles with Undo; code health (D27) | `bcee5dd` |
| 3.16.0 | 2026-11-17 | Dialysis: one Renal replacement selector in both modules replaces the dialysis checkboxes, so a CRRT patient is no longer fitted silently as a non-dialysis patient; AUC Precision refuses CRRT and hybrid therapy and, on haemodialysis, every model but Goti 2018 · HD. Session rows are typed, hybrid sessions run to 24 h, and more than three sessions in seven days is a caution. Rybak 2020 references for CRRT (Rec 16) and hybrid therapy (Rec 15) by actual body weight, capped at the lower of 3 g and your local maximum, never scaled from the effluent rate. A level-based CRRT answer from the decline between the patient's own levels while the circuit ran unchanged, or "Draw a level" when it did not; no AUC. A peak-equation haemodialysis reading from four settings kept in your browser, beside Goti-HD; the app ships no value. PD's solver and goal pick are shared, PD unchanged; citations to Rec 14 (C-III) and Rec 1 (A-II). Not clinically validated (D28) | pending |

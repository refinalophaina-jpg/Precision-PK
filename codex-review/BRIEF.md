# Review brief — AinaDara Vancomycin TDM Calculator

You are reviewing a **clinical decision-support tool used at the bedside by a
practising clinical pharmacist**. Wrong numbers change doses given to real
patients. Accuracy outranks cleverness, and an unsupported claim is worse than
no claim.

Read `RETURN-FORMAT.md` before writing anything. Findings that do not conform are
rejected mechanically, unread — not out of pedantry, but because every finding is
re-verified by running it, and an unrunnable finding cannot be checked.

## What the thing is

A single self-contained file, `index.html` (~9,000 lines, ~390 KB): vanilla JS,
no framework, no build step, **zero JavaScript dependencies**. The only external
reference is a Google Fonts stylesheet. It is both the source and what GitHub
Pages serves at <https://refinalophaina-jpg.github.io/Precision-PK/>.

Three modules:

1. **Trough-Based** — deterministic; sub-modes `initial`, `level` (steady-state
   trough), `twolevels` (Sawchuk–Zaske), `randomlevel`.
2. **AUC Precision** — MAP Bayesian (Burton 1985 objective, Nelder–Mead), four
   priors: Buelga 2005 (1-comp), Goti 2018 (2-comp), Goti-HD, Hughes 2024
   (FFM-scaled 2-comp, class-3 obesity).
3. **Continue Course** — reload a saved profile's individual PK and re-dose.

Cross-cutting: regimen detection, KDIGO AKI staging, ARC and very-low-CrCl
advisories, cystatin C discordance, `localStorage` profiles, print/PDF report.

**Explicitly out of scope in the product** — do not file "missing feature" for
these unless you can show the UI implies support: CRRT, paediatrics, neonates,
continuous infusion.

## Test suites (all must stay green)

```bash
node phase2d_validation.cjs            # 68/68
node phase3_simulation.cjs             # 21/21
node phase4_regimen_validation.cjs     # 40/40
node phase2d_comprehensive_validation.cjs
```

The comprehensive suite fails scenarios 3 and 4 **by design** — an accepted,
documented Goti 2-compartment limitation. See
`docs/validation-threshold-decisions.md`. Do not file it as a new finding; do
feel free to challenge the *reasoning* recorded there.

The suites run the shipped engine inside a Node `vm`, so they test the real file
rather than a copy. Two consequences you must respect:

- `const`/`let` inside the vm are **not** sandbox properties. Constants are
  parsed out of the source by `harness_constants.cjs`, which throws if one goes
  missing. Never hand-copy a constant into a test.
- The DOM stub is minimal. Any code that runs at load must degrade without a
  real DOM — it has already broken the harness twice (`documentElement`,
  `addEventListener`).

## Standing rules this codebase is held to

1. **Never ship a clinical constant whose provenance you cannot state.** Every
   model parameter carries a comment naming paper, table and value.
2. **One implementation per concept.** One `calcIBW`, one `calcCrCl`, one
   `pickCrClWeight`, one SCr policy.
3. **Recency beats frequency** for regimen detection; regimen inference is a
   presentation layer and must never alter what the Bayesian fit consumes.
4. **Serum creatinine is used as measured.** The sole exception is
   `SCR_POLICY.GOTI_MODEL`, which reproduces Goti's estimation conditions.
5. **Acceptance thresholds are stated in absolute clinical units**, never as a
   ratio against a moving baseline.
6. **Do not weaken a test to make it pass.**

## What has already been audited — do not re-report as new

`docs/audit-2026-09.md` is the current record. Summary of resolved items:

| ID | Item |
|---|---|
| A1 | Goti SCr threshold — **65**, per the 2019 erratum. The 2018 Methods says 60 and is a KNOWN TYPO. Do not "fix" it. |
| A2 | The Bayesian "Buelga" prior was an unidentified power model; replaced with the published Buelga 2005 general model |
| A3/A4 | Blank/unbounded input now validated |
| A5 | Zero-elimination guard returns an error, not a fake trough |
| A6/A10 | Matzke Vd CrCl split disclosed; a pooled 0.8752 L/kg option added |
| A7 | One SCr policy suite-wide |
| A8 | "AdjBW" returns AdjBW; dosing-weight switch refreshes immediately |
| A9 | Hughes FFM removed from CL and Q (the paper excluded that exponent) |
| A11 | VancoPK CL provenance recorded as site documentation, not peer-reviewed |
| P1–P4 | Threshold decisions, stale report, harness drift, wrong CLAUDE.md |
| N1 | AUC uncertainty re-derived from simulation; it was overstated |

**Verified against primary sources in `Literature/`:** Goti 2018 (16/16 with the
erratum), Buelga 2005, Hughes 2024 (Table 2 nlmixr2), Matzke 1984, Fewel 2021.
Bauer is a textbook; VancoPK's CL is vendor documentation.

## What to review

Everything, at depth, in these dimensions. Rank by clinical consequence.

- **Math** — the PK derivations, the MAP objective and optimiser, superposition,
  AUC computation, steady-state assumptions, unit handling, numerical stability,
  edge cases (anuria, very short/tall, extreme obesity, dialysis).
- **Clinical strength** — do the outputs match the 2020 ASHP/IDSA guideline and
  current practice? Are targets, bands, warnings and their thresholds defensible
  and sourced? Where is the tool confidently wrong, or silent when it should
  speak?
- **Code** — correctness, duplication, dead paths, global state, XSS via the
  `innerHTML` result cards (`escHtml` exists and is under-used), error handling.
- **UI/UX** — clarity under time pressure, misreadable output, accessibility,
  mobile, the print/PDF report, the concentration–time graph.
- **Tests** — what is untested, what is tested tautologically, what asserts a bug
  by name, what thresholds are unjustified.
- **Git & documentation** — history hygiene, whether the docs match the code, and
  whether a fresh reader could safely change something.

## Ground rules for findings

- **Clinical or mathematical claims require a citation** to a primary source,
  with a verbatim quote of 25 words or fewer. "Common practice" is not a source.
- **Behavioural claims require a runnable reproduction** that prints JSON. It
  will be executed. If it does not run, or its output contradicts your claim, the
  finding is rejected.
- **State what would disprove you.** Every finding carries a
  `disconfirming_test`.
- **Do not propose adding a dependency**, a build step, or a framework. Zero
  runtime dependencies is a hard architectural invariant.
- Disagreement with an existing decision is welcome — argue it with evidence and
  cite the decision you are challenging.

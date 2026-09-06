# Vancomycin TDM Calculator — project instructions

Single-file, AUC-guided vancomycin TDM calculator per the 2020 ASHP/IDSA/PIDS/SIDP
consensus guideline. Built for a clinical pharmacist; used at the bedside.

**Advisory only — not a prescription. Clinical correctness outranks everything else here.**

> Rewritten 2026-09-05. The previous version described a five-tab UI with element IDs
> (`#section-initial`, `#b-ht`, `#model-select`) that have never existed in this file, and
> quoted a line count and test count that were both wrong. If you are holding an older copy,
> discard it.

## What this is

`index.html` — the entire application. Vanilla JS, no framework, no build step, **no
JavaScript dependencies**. The only external reference is a Google Fonts stylesheet.
~7,900 lines / ~360 KB.

`index.html` is both the canonical source **and** what GitHub Pages serves. They cannot
diverge. After any change, confirm the deployed blob still matches:

```bash
git hash-object index.html
```

## Architecture

| Range (approx) | Contents |
|---|---|
| 1–1,530 | CSS — `:root` tokens, cards, canvas, KDIGO badges, responsive, `@media print` |
| 1,530–2,520 | Markup — print report, header, module tabs, the three module panels |
| 2,520–end | One inline `<script>` — the whole engine and UI |

**Three modules** (tabs, switched by `switchModule()`), not five:

1. **Trough-Based** — deterministic. Four sub-modes via `setCalcMode()`: `initial`,
   `level` (steady-state trough), `twolevels` (Sawchuk–Zaske), `randomlevel`.
2. **AUC Precision** — MAP Bayesian, `runBayesian()`. Four priors: Buelga 2005 (1-comp),
   Goti 2018 (2-comp), Goti-HD, Hughes 2024 (FFM-scaled, class-3 obesity).
3. **Continue Course** — reload a saved profile's individual PK and re-dose.

Cross-cutting: KDIGO AKI staging from serial creatinine, ARC and very-low-CrCl advisories,
cystatin C discordance check, `localStorage` profiles, print report.

**Not implemented — do not imply otherwise in the UI:** CRRT, paediatrics, neonates,
continuous infusion.

## Rules that are not negotiable

1. **Never ship a clinical constant whose provenance you cannot state.** Every model
   parameter carries a source comment naming the paper, table and value. If you cannot cite
   it, do not add it. This project has already shipped one unsourced prior — a power model
   labelled "Buelga" that was not Buelga (see `docs/audit-2026-09.md`, finding A2).
2. **One implementation per concept.** There is exactly one `calcIBW`, one `calcCrCl`, one
   `pickCrClWeight`, one SCr policy. Four near-duplicate CrCl functions with three different
   SCr floor rules is how the same patient got different clearances in different tabs.
3. **Recency beats frequency for regimen detection.** The current regimen is the most
   recent consecutive pattern, never the modal interval over the whole history. A modal
   reading reported a deliberate q12h→q8h order change as an accidental early dose. And
   regimen detection is a *presentation* layer: Bayesian fitting always uses the actual
   timestamps, and history is never rewritten into an idealised schedule.
4. **Serum creatinine is used as measured.** Rounding a low SCr up in the elderly is not
   evidence based and under-doses — 92.9% subtherapeutic in Drugs R&D 2017;17:463-70. The
   one exception is `SCR_POLICY.GOTI_MODEL`, which exists because Goti's parameters were
   *estimated* on truncated SCr; it is model fidelity, not clinical rounding, and it must
   never leak onto the displayed CrCl or another model.
5. **Validation thresholds are stated in absolute clinical units**, never as a ratio against
   a moving baseline. A "≥25% better than the population prior" gate fails when you improve
   the prior. See `docs/validation-threshold-decisions.md`.
6. **Never hand-copy a constant into the test harness.** `harness_constants.cjs` parses them
   out of `index.html` and throws if one goes missing.
7. **The theme is mirrored, not invented.** Tokens come from
   `~/mission-control/domains/ainadara/philosophy/design-tokens.md`, which is extracted from
   the live ainadara.com stylesheet. If they drift, re-extract there — the site wins. Two
   documented extensions exist (a raised card level, and a danger red) because a clinical
   tool needs states a marketing site does not. Theme code must degrade to a no-op without a
   real DOM: the harness runs this script in a Node `vm` with a stub that has no
   `documentElement`.
8. **Do not weaken a test to make it pass.** If a threshold is wrong, say why in the file and
   in the decisions doc, and record the numbers that justify the change.

## Testing

No install required.

```bash
node phase2d_validation.cjs
```

| Suite | Expected |
|---|---|
| `phase2d_validation.cjs` | **76/76 pass** |
| `phase3_simulation.cjs` | **21/21 pass** |
| `phase4_regimen_validation.cjs` | **40/40 pass** — regimen detection: the real q12h→q8h case, ten spec scenarios, nine spec defects |
| `phase2d_comprehensive_validation.cjs` | Scenarios 1, 2, 5, 6 pass; **3 and 4 fail by design** — the accepted Goti 2-comp limitation, see `docs/validation-threshold-decisions.md` |

Syntax check after any edit:

```bash
node -e "const fs=require('fs');const m=fs.readFileSync('index.html','utf8').match(/<script>([\s\S]*?)<\/script>/);try{new Function(m[1]);console.log('JS syntax: OK')}catch(e){console.log('JS BROKEN:',e.message)}"
```

The suites extract the engine from `index.html` into a Node `vm` and test the shipped file.
`const`/`let` are not visible as sandbox properties — that is why `harness_constants.cjs`
exists. Pure `function` declarations are.

## UI work

Design language: warm off-white, `Outfit` body / `DM Serif Display` headings / `DM Mono`
numbers, terracotta accent `--accent-terra: #C96B3C`. Full token set in `:root`.

**Shape and depth are mirrored from ainadara.com, and the site's vocabulary is small:**

| | The site uses | So this file uses |
|---|---|---|
| Rectangular radius | `4px`, one value | `--radius-sm/md/lg`, all `4px` |
| Pill | `999px` | `--radius-pill` — chips, badges, the switch, the print FAB |
| Circle | `50%` | dots and the brand mark |
| `box-shadow` | **none, anywhere** | focus rings only |
| Gradients | none | one: the therapeutic-range gauge, which is data |

Depth comes from a hairline (`--rule`), a background step (`--paper` → `--paper-deep`),
and a small hover lift — never a shadow. Selection is a background step plus terracotta
ink, never a nested border: a bordered group holding bordered items each with their own
shadow is what made this read as a stack of boxes.

**Every colour must come from a token.** Two classes of bug lived here and both were
invisible until dark mode: 17 hard-coded near-whites (`rgba(240,239,235,α)`) that painted
light slabs on dark paper, and legend swatches hard-coded to a *fallback* hex while the
plot drew from the token — so the key disagreed with the curve. Canvas is the one
exception, because it cannot resolve a custom property: use `themeColor()` /
`themeRGBA()`, never a bare literal and never `var(--…)`.

Used on macOS, Windows and Android. Touch targets ≥44px, no horizontal scroll at 375px,
readable without zoom, and the `@media print` block must keep working.

Canvas graphs set colours in JS, not CSS (`ctx.fillStyle` / `ctx.strokeStyle`). If you change
background colours materially, grep for those.

Results are built as HTML strings via `innerHTML`. **Any user-entered value interpolated into
one must go through `escHtml()`** — most sites currently do not, which is an open item.

## Where things are

| Path | What |
|---|---|
| `docs/audit-2026-09.md` | Code and math audit — findings, what was verified against which paper |
| `docs/validation-threshold-decisions.md` | The accept/reject record for failing thresholds |
| `docs/audit/` | Probe scripts that reproduce each finding numerically |
| `harness_constants.cjs` | Extracts model constants from `index.html` for the suites |
| `Phase2_Plan.md` | Bayesian architecture reference |
| `Vancomycin_TDM_Software_Instructions.md` | Clinical source-of-truth |
| `validation_report.md` | **Phase 1 only, April 2026** — predates the Bayesian engine |
| `archive/` | Superseded March build and the abandoned React branch |

Reference PDFs live one level up, outside this repo — it is public and they are third-party
papers.

## Verified model parameters

Goti 2018 is verified parameter-by-parameter against Table 2 and Methods (15 of 16 exact; the
16th was a defect, fixed). Buelga 2005 is verified against the published general model.
**All eight models are now verified** against primary sources in `Literature/` — see
`docs/audit-2026-09.md`. Two carry caveats worth knowing: Matzke's Vd split on CrCl 60 uses a
covariate the paper explicitly disclaims (A10), and the VancoPK clearance equation rests on
site documentation rather than peer review (A11). Goti's SCr threshold is **65**, per the 2019
erratum — the 2018 Methods text says 60 and is a known typo. Do not "correct" it.

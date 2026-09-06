# UI and graphics audit — September 2026

**Date:** 2026-09-05 · **Scope:** the shipped `index.html` at the state following the
house-style pass · **Method:** four agents reading the real file, findings verified
numerically before any change.

Two user reports opened this:

1. *"the night mode toggle is not optimal how it looks and it looks too boxy"*
2. *"rebalance the empty results panel"* and *"refine the graphics for the graphs and
   levels display time concentration profile"*

**66 findings — 25 high, 26 medium, 15 low.** The distribution says something on its own:

| | correctness | legibility | theming | layout | style-drift |
|---|---|---|---|---|---|
| **high** | 8 | 8 | 6 | 3 | — |
| medium | 6 | 4 | 5 | 8 | 3 |
| low | 4 | 2 | 2 | 5 | 2 |

Eight *high-severity correctness* findings in rendering code is not a styling problem. It
is the consequence of the root cause below.

---

## Root cause: the canvases had no test coverage at all

Four renderers — `drawPKGraph`, `drawProfileGraph`, `drawSSTinkCanvas`,
`drawCompareCanvas` — draw every concentration-time chart in the app. **No suite had ever
executed any of them.** The suites test the math (`calcCssAtTime`, `predictConc2comp`,
`bayesDoseOptimizer`) and stop at the point where a number becomes a pixel.

This is the same shape as the F-006/F-007 finding recorded in
[`validation-threshold-decisions.md`](validation-threshold-decisions.md): *"Both shipped
steady-state defects had zero test coverage in any suite. The suite was structurally blind
to them."* The lesson did not generalise far enough — it closed the steady-state helpers
and left the renderers open.

`SUITE 12` closes it. See [Coverage](#coverage) below.

---

## High-severity findings and their resolutions

### Correctness — what was drawn was not true

| # | Finding | Consequence | Resolution |
|---|---|---|---|
| G1 | `redrawAllCanvases` called `drawGraph()`, which is referenced once and **defined nowhere**, inside an empty `catch` | the theme toggle never repainted the trough-based canvases. Stale light-theme gridlines measured **1.03:1** against the dark ground, and the trough markers **1.88:1** — both effectively invisible | replays real `drawPKGraph` calls from `_pkGraphArgs`; no longer swallows errors |
| G2 | The comparison chart scaled every regimen onto the longest interval (`p.t * (maxTau / it.tau)`) | a Q6H regimen's **6-hour trough was drawn at 12 hours**, under an axis reading 12h. Two different regimens rendered as the same shape | plots true elapsed time and repeats each cycle across the window |
| G3 | The y-axis top came from the curve alone (`max(points) * 1.15`) | for any regimen peaking below the target ceiling, the therapeutic band was painted **off the top of the plot** — an open-topped green wash reading "everything above 10 is on target". At 250 mg Q12H both boundaries left the canvas and the band vanished silently | the axis now contains the band and any observed level; the band is clipped to the plot rect |
| G4 | A uniform 0.1 h sample grid never lands on `tinf` = 1.25 or 1.75 — and the input steps by 0.25 | the polyline cut the corner under the peak dot; worst case 0.62 mg/L against a 4px dot radius, so the marker visibly detached. It also dragged `cMax` 0.4–1.5% low, rescaling every y-coordinate | breakpoints (`i·tau + tinf`, `(i+1)·tau`) are sampled explicitly; the axis anchors to the analytic peak |
| G5 | The trough dot was drawn at `tau − dt` while its y-value was the concentration at exactly `tau` | the marker sat systematically below the curve | drawn at `tau` |
| G6 | `opts.obsTime % tMax \|\| opts.obsTime` | the `\|\|` fired whenever `obsTime` was an exact multiple of `tMax` (48 h at Q8H, 72 h at Q12H) and pushed the marker off-canvas | folds correctly and clamps |
| G7 | `opts.obsLevel && opts.obsTime` | a level drawn at **t = 0** was dropped entirely | `!= null` guards |
| G8 | Three charts hard-coded a 10–20 trough band; a fourth read `bState.troughMin`, **a field that does not exist**, so it silently used the defaults | the clinician's own entered target was ignored everywhere except one chart | one `troughTarget()` helper, read from the `#trough-min`/`#trough-max` inputs |

> **G8 was self-inflicted mid-fix.** The first version of the comparison-chart repair read
> `bState.troughMin`. That field has never existed, so the "fix" changed nothing. It was
> caught by writing the guard test, not by reading the code — which is the argument for
> the test.

### One finding rejected

The audit reported that folding the observed level by `tMax` mis-plotted it by ~30 mg/L.
**It does not.** `tMax = 3·tau`, so `t % tMax` preserves phase exactly — verified across
every interval from Q4H to Q72H at 0.25 h resolution, **0 phase mismatches**. The real
defects were the two narrower ones recorded above as G6 and G7. The agent's numeric
example was actually demonstrating a different thing: in random-level mode the level is
fitted against single-dose decay while the chart draws a steady-state curve, so the marker
genuinely cannot lie on the curve. That is a modelling mismatch, not a plotting bug, and
is **left open** — see [Deferred](#deferred).

### Legibility

| # | Finding | Resolution |
|---|---|---|
| G9 | X ticks fixed at 8 h regardless of interval — aligned with **nothing** at Q6H/Q12H/Q18H/Q24H/Q36H/Q48H, and nineteen overlapping labels at Q48H | `tau/2`, which gives **exactly seven ticks with every dose boundary on one**, for every interval from Q4H to Q72H |
| G10 | The 20/10/5 y-step ladder gave **2 gridlines** at the bottom of its range and **12** at the top; a 5 mg/L change in predicted peak silently halved axis resolution | `niceStep(cMax, 6)` — a helper the file already had and this renderer never used |
| G11 | `'Time (hours)'` drawn at `H − 2` on a `textBaseline` of `'top'` inherited from the tick loop | below the bottom edge of the bitmap. **The x axis was unlabelled on all four trough-based graphs.** Now an explicit `'alphabetic'` baseline |
| G12 | Observed levels — the only measured numbers on the chart — were the lowest-contrast mark on it | paper halo behind both the × and its value label, heavier stroke, label flips near the right edge |
| G13 | Population fit and projection were both `--purple`, separated only by alpha — **1.65:1 apart** in dark | population moved to neutral `--ink-faint`, giving four distinct roles: rose = measured, terracotta = this patient's fit, purple = projected, neutral = population reference |
| G14 | Axis numbers at ~1.4:1 in both themes | `--ink-faint` at full opacity |
| G15 | Empty-state text at **1.54:1** — `opacity: .35` stacked on `--text-muted` | de-emphasis comes from the token; the opacity multiplier is gone |
| G16 | Dose markers had no overlap suppression | **deferred** — see below |

### Theming

Every hard-coded canvas colour is gone: **0 `ctx.fillStyle`/`strokeStyle` literals remain.**
The curve stroke was `rgba(217,123,74,…)`, which is `#d97b4a` — matching `--terracotta` in
*neither* theme (`#cc785c` light, `#d88a6e` dark). Gridlines were near-black (1.01:1 on
dark paper), the "Now" rule 1.11:1, dose-boundary markers 1.30:1, and the six comparison
series were off-palette literals frozen at load.

`themeRGBA` was hardened to parse `rgb()`/`rgba()` and 3-digit hex, not only 6-digit hex.
This was **not hypothetical**: `--rule` is already authored as `rgba(45, 52, 40, .1)`, so
any call against it produced an invalid colour string, which canvas ignores silently — the
element would have been painted in whatever `fillStyle` was left over.

### Layout

| # | Finding | Measured | Resolution |
|---|---|---|---|
| L1 | The input column was pinned at 400px from 1001px to 2560px | right panel **73%** of a 1500px viewport, **84%** of a 2560px one, to display a 56px icon at **0.22% ink coverage** | shell centred at an 1800px measure; left column `minmax(400px, 30%)` |
| L2 | No `max-width` existed anywhere for results | cards grew to **510px to hold 46px of ink**; advisory prose — where the clinical caveats live — reached **~372 characters per line** against a readable 45–75 | one 1040px cap, the width the print path already used, so screen and PDF agree; 68ch on prose |
| L3 | `flex: 1` centred the empty state on the **left** column's height (2190px in the Trough module) | the app's only instruction sat **184px below the fold** at 1500×950 in two of three modules | anchored near the top, `flex: 0 0 auto` |
| L4 | Plot height nailed to 220px against an unbounded width | **2.4:1 at 1001px, 11.7:1 at 2560px** — the same patient's elimination looked shallow on a wide monitor and steep on a narrow one | `aspect-ratio: 16/7` |
| L5 | `min-height: calc(100vh - 60px)` assumed a 60px header; it measures **87px** | a permanent 27px scrollbar on a page that otherwise fits | `body` is a flex column, self-correcting when the header wraps |

### Style drift

Three placeholders used three different icons and copy conventions, and **one named a
button that does not exist**. All three now share one shape — eyebrow, one line naming the
real button, three bullets stating what the module produces.

The primary-action buttons carried inline `style="background:var(--accent-blue)"` and
`var(--accent-sage)`. After the house-style pass set `border: 1px solid var(--terracotta)`
on `.calc-btn`, those overrode only the fill — rendering a **purple button inside a
terracotta border**. Drift introduced by the preceding pass, caught here. All primary
actions are terracotta; a second action in the same panel is an outline, not a second hue.

---

## Coverage

`SUITE 12` in `phase2d_validation.cjs` drives the **real** `drawPKGraph` through a
recording 2D context and asserts on the operations it emits — it does not test a copy:

| Test | Pins |
|---|---|
| Markers lie on the drawn curve | six infusion times including 1.25/1.75, 0.75px tolerance (G4, G5) |
| Every dose boundary is a tick | ten intervals Q4H–Q72H, 5–9 ticks (G9) |
| Target band stays inside the plot | a regimen whose peak falls below the ceiling (G3) |
| The band label honours a non-default target | 15–25 rather than 10–20 (G8) |
| Observed level survives `t=0` and `2·tMax` | (G6, G7) |
| Y-axis density and range | 4–9 gridlines, always contains the ceiling (G10) |
| **Every colour changes when the palette is swapped** | draws the same graph under two palettes and requires zero shared colours — a literal cannot creep back |
| `redrawAllCanvases` is sound | no dead `drawGraph()`, no empty `catch` (G1) |
| No renderer hard-codes `ty(10)`/`ty(20)` or reads `bState.troughMin` | (G8) |

**86 → 95 tests.**

---

## Deferred

Honest list of what was found and **not** fixed. None is a correctness defect in a drawn
value; all are legibility or polish in `drawProfileGraph` and the smaller canvases.

- **Dose-marker label collision** (`drawProfileGraph`). Dose ticks are undecimated
  full-height rules layered over two other vertical grids and the "Now" line; the
  interval-pill collision guard is 28px against a ~39px pill, and elapsed-hour labels
  overlap dose amounts by ~2px.
- **Uniform 500-point sampling in `drawProfileGraph`** cuts the infusion-end corner by up
  to 2.7 mg/L, so the crosshair dot can float off the drawn curve — the same class as G4,
  in the other renderer.
- **25% headroom plus quantisation to multiples of 5** throws away a fifth of the plot
  height and squeezes the trough band to 3.4px per mg/L.
- **A fixed +48 h tail** regardless of course length compresses short courses into a fifth
  of the plot.
- **Random-level mode plots a single-dose-fitted level on a steady-state curve** (see the
  rejected finding above). The marker cannot lie on the curve because they are different
  models. The honest fix is to say so in the UI, not to move the dot.
- **The 1000px breakpoint cliff** — cards jump from 454px to 120px across one pixel.
- **Status badge overlaps its own stat label** from 1420px down, total collision at
  1001–1200px.
- **KDIGO AKI badge is not refreshed** when serial-creatinine rows are edited.
- **Legend glyph does not match the mark drawn**, and one drawn series has no legend entry.
- **Compare-chart controls are ~20px tall**, under the 44px touch minimum.

---

_Advisory decision-support only — not a prescription; clinician judgement governs._

---
name: AinaDara Vancomycin TDM
description: An AUC-guided vancomycin calculator whose answer is read off the patient's own course, on bone paper in ink.
colors:
  paper: "#faf5ed"
  paper-deep: "#f2ecdf"
  paper-edge: "#e8e0d0"
  card: "#fffdf8"
  input: "#f7f2e8"
  ink: "#2d3428"
  ink-soft: "#5a6151"
  ink-muted: "#676b5e"
  ink-faint: "#8a8e80"
  rule: "rgba(45, 52, 40, .1)"
  terracotta: "#cc785c"
  terracotta-ink: "#96492f"
  terracotta-q: "#e0a98c"
  amber: "#8a5a1c"
  alarm: "#9f1d45"
  purple: "#4a3d7a"
  moss: "#4a5c28"
  rose: "#a8546a"
  series-fit: "#6751a8"
  series-projection: "#cc785c"
typography:
  display:
    fontFamily: "'DM Serif Display', Georgia, serif"
    fontSize: "2.5rem"
    fontWeight: 400
    lineHeight: 1.05
    letterSpacing: "-0.005em"
  headline:
    fontFamily: "'DM Serif Display', Georgia, serif"
    fontSize: "1.25rem"
    fontWeight: 400
    lineHeight: 1.2
  figure:
    fontFamily: "'Outfit', system-ui, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 500
    letterSpacing: "-0.01em"
    fontFeature: "\"tnum\" 1, \"lnum\" 1"
  title:
    fontFamily: "'Outfit', system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: "0"
  body:
    fontFamily: "'Outfit', system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.6
    fontFeature: "\"tnum\" 1, \"lnum\" 1"
  body-sm:
    fontFamily: "'Outfit', system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.55
    fontFeature: "\"tnum\" 1, \"lnum\" 1"
  label:
    fontFamily: "'Outfit', system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.4
    fontFeature: "\"tnum\" 1, \"lnum\" 1"
  field:
    fontFamily: "'Outfit', system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    fontFeature: "\"tnum\" 1, \"lnum\" 1"
rounded:
  sm: "4px"
  pill: "999px"
  circle: "50%"
spacing:
  xs: "4px"
  sm: "8px"
  md: "14px"
  lg: "18px"
  xl: "28px"
  gutter: "32px"
components:
  button-primary:
    backgroundColor: "{colors.terracotta-ink}"
    textColor: "{colors.paper}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "14px"
    height: "44px"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.terracotta-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "14px"
    height: "44px"
  button-secondary-hover:
    backgroundColor: "{colors.paper-deep}"
    textColor: "{colors.terracotta-ink}"
  text-action:
    backgroundColor: "transparent"
    textColor: "{colors.terracotta-ink}"
    typography: "{typography.body-sm}"
    padding: "10px 0"
    height: "44px"
  input-field:
    backgroundColor: "{colors.input}"
    textColor: "{colors.ink}"
    typography: "{typography.field}"
    rounded: "{rounded.sm}"
    padding: "10px 14px"
    height: "44px"
  segmented-control:
    backgroundColor: "{colors.paper-deep}"
    rounded: "{rounded.sm}"
    padding: "3px"
  segmented-option:
    backgroundColor: "transparent"
    textColor: "{colors.ink-muted}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "7px 10px"
  segmented-option-active:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.terracotta-ink}"
  module-tab-active:
    backgroundColor: "{colors.terracotta-ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.sm}"
    padding: "0 18px"
    height: "44px"
  model-option:
    backgroundColor: "{colors.input}"
    textColor: "{colors.ink-soft}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "8px 10px"
  model-option-active:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
  print-action:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.pill}"
    padding: "8px 16px 8px 13px"
    height: "40px"
  verdict-regimen:
    textColor: "{colors.ink}"
    typography: "{typography.display}"
  evidence-title:
    textColor: "{colors.ink}"
    typography: "{typography.headline}"
---

# Design System: AinaDara Vancomycin TDM

## Overview

**Creative North Star: "The Course Read Aloud"**

The answer is read off the patient's own course. A results panel opens on a strip of what was given and measured (dose bars as wide as each infusion, level dots with their values, creatinine ticks, a dashed "now"), and the verdict stands at the strip's "now" end in a serif large enough to be the first thing seen. The concentration curve runs beneath on the same clock-time axis, and everything else is evidence behind a hairline, one click away. The world is the AinaDara house: warm bone paper, green-black ink, a terracotta that only ever means "this one", and a faint three-colour atmosphere wash on the page ground.

Density is a pharmacist's working density: small Outfit text (13–14px) with tabular figures, generous line height (1.55–1.6), and very little chrome. Structure comes from hairlines and a single background step, never from boxes. Nothing in the results sits in a card, carries a side stripe, casts a shadow or blurs what is behind it. Colour is spent on meaning: terracotta for the recommendation, the selection and the projection; amber for caution and the de-rated state; one muted crimson for top-tier safety, always beside its signal word.

The system is mirrored, not invented: its primitives come from the live ainadara.com stylesheet, with two recorded extensions a clinical tool needs (a raised `card` ground and a danger crimson) and two text-contrast steps (`ink-muted`, `terracotta-ink`). Dark mode is a full remap of the same token names, on screen only; print always resolves the light palette.

**Key Characteristics:**
- Answer first: the regimen in DM Serif Display at 40px, at the "now" end of the course.
- One shared time axis and one cursor across the course strip and the curve.
- Hairlines (`rule`) and a paper-to-paper-deep step do all the separating.
- Outfit with tabular, lining figures for every number; no monospace anywhere.
- Three shape values only: 4px, pill, circle.
- Every colour comes from a token, including canvas (through `themeColor()` / `themeRGBA()`).

## Colors

A warm, low-chroma paper-and-ink palette with one earthen accent and two small signal hues, each tied to a single meaning.

### Primary
- **Terracotta** (`terracotta`): the "this one" mark as a fill or stroke. The projected-dose bars on the course strip, the point estimate tick on the AUC dot plot, the active model's range in the forest plot, the projection line in the legend, the recommended-cell outline in the exposure-matrix key, the brand-mark ring and the `::selection` ground. At 3.0:1 on paper it is never used for text.
- **Terracotta Ink** (`terracotta-ink`): the same meaning as text and as a solid fill behind paper text (5.9:1 on paper). The interval in the regimen ("q12h"), projected dose labels, the verdict's text actions ("Why this dose", "Show the math", "Copy summary"), the active segmented option, the active module tab and calculate button fills, the selected model's name, and every focus outline.
- **Terracotta Quiet** (`terracotta-q`): hover borders on editable fields, model options and the outline button; never text.

### Secondary
- **Amber** (`amber`): caution. The "provisional" word, a Low or Very low confidence word, caution notes and their drawn icon, the stale-result line, the supra-therapeutic exposure-matrix tint (15% mix) and the profile privacy note.

### Tertiary
- **Alarm Crimson** (`alarm`, the `--red` extension at 342°, deliberately apart from terracotta's 15°): top-tier safety only. Alarm notes' signal word and icon, refused-field borders, the error-summary link underline, and the hold headline when no regimen is given.
- **Purple** (`purple`): the house hue the fit's chart colour is stepped from (`series-fit`); not used directly in the results.
- **Moss** (`moss`): the `success` alias and a 10% band in the comparison canvases; a data colour.
- **Rose** (`rose`): an incumbent house extension kept in `:root`; the results world does not use it for levels (measured levels are ink).

### Neutral
- **Bone Paper** (`paper`): the page ground and the input panel ground; the "selected" step for segmented options and model options.
- **Deep Paper** (`paper-deep`): the one background step: segmented-control trough, the future region of the course strip, secondary-button hover, disabled fields.
- **Paper Edge** (`paper-edge`): 1px borders on fields, the header's bottom edge and the input panel's right edge.
- **Raised Card** (`card`): the extension's raised ground, used sparingly in the input panel.
- **Input Ground** (`input`): every typed field and unselected model option.
- **Ink** (`ink`): headline text, the regimen, key figures, dose bars and every measured level: data is ink.
- **Soft Ink** (`ink-soft`): secondary text: verdict sub-lines, notes, evidence body copy.
- **Muted Ink** (`ink-muted`): labels, units, axes, legends and gists; the text step that clears 4.5:1 on every ground. As a mark: the population prior's dash and the creatinine ticks.
- **Faint Ink** (`ink-faint`): rules and marks only (the "now" dash, strip ticks, gridlines); 3.1:1, never text.
- **Hairline** (`rule`, ink at 10%): every divider between results sections, evidence rows and table rows.

### Chart Series
The concentration curves encode model and measurement in different colours, so a reader can tell at a glance what was measured, what the model fitted, and what the population predicted. Both hues are the house's own, stepped into a chart band (OKLCH L 0.43–0.77 light, 0.48–0.67 dark; chroma ≥ 0.10) and validated with a colour-vision simulation: fit against projection is ΔE 22.0 light and 18.0 dark under protanopia and deuteranopia.
- **Series Fit** (`series-fit`, #6751a8; #9583d5 dark): this patient's fit wherever it is drawn. The posterior curve (solid, then dashed after "now"), its simulated 80% band as a 16% tint, the open ring at the fit's value at each measured level, the shared cursor's dot, and the Trough chart's current-regimen curve.
- **Series Projection** (`series-projection`, terracotta #cc785c; #cb7a5d dark, the same hue stepped into the dark band): the recommendation's future: the projected curve, its band tint, projected dose marks and bars, and the Trough chart's recommended curve.
- Measured levels are **ink** dots with a 2px paper halo and their value. The population prior is a thin **muted-ink** dash, on both charts: on the Trough chart it is the population estimate for the regimen shown, drawn once a level has been fitted (steady-state trough, two levels, random level). Initial dosing has no such line, because there its one curve already is the population prediction.
- **The Dose Tinkerer** uses the same code: the regimen being tried in `series-projection`, the current regimen as fitted in `series-fit`, the population estimate for the tried regimen as the muted-ink dash, and the neutral trough-reference band. In the **regimen comparison** the current regimen leads in `series-fit`. Every tried regimen is a projection, so they share the projection's hue family (`series-projection`, `terracotta-ink`) and are told apart by line pattern and shade as well. Each is keyed beside a swatch drawn the same way. Six at most, so no style is reused. Both charts draw on true elapsed time, with each regimen's cycle repeated across the longest interval shown.
- **The Trough module's "Try another regimen"** draws its own comparison below the tried regimen's numbers, and never redraws the result chart. The tried regimen is drawn in `series-projection` beside the current regimen as fitted, in `series-fit`, once a level exists. In initial dosing and the two- and random-level modes it is drawn beside the recommendation, also in `series-projection`, so the tried regimen takes the comparison's second style (`terracotta-ink`, dashed). The population estimate for the tried regimen is the muted-ink dash in the level-based modes. The band is the clinician's trough target. These steady-state charts paint no background of their own: like the Trough and profile charts they sit on the page ground, so none reads as a box.

### Named Rules
**The "This One" Rule.** Terracotta marks the recommended regimen, the selected option and the projection, plus the one action a surface asks for. It is never decoration and never a second status colour.

**The Ink Step Rule.** Terracotta as text is always `terracotta-ink`; raw `terracotta` is for fills, strokes and outlines. The same split holds for ink: `ink-muted` for text, `ink-faint` for marks.

**The Signal Word Rule.** The alarm crimson never appears as colour alone. It sits beside a signal word, and in a note beside the drawn alarm icon. A de-rated result is one hue: "provisional" and the Low confidence word are both amber, because the alarm is reserved for safety.

**The Token-Only Rule.** Every colour resolves from a token, including canvas, which reads tokens through `themeColor()` / `themeRGBA()` so it re-themes. Tints are `color-mix()` over a token, never a raw `rgba()` literal.

**The Model-and-Measurement Rule.** On a concentration chart, measured data is ink and the fit is `series-fit`. Neither colour is used for the other. The fit's value at a measured level is an open ring in the fit's hue beside the ink dot, so the residual reads as the distance between two colours. The legend's swatches read the same tokens as the plot, and a chart's written summary never names a colour.

## Typography

**Display Font:** DM Serif Display (with Georgia, serif)
**Body Font:** Outfit (with system-ui, sans-serif)
**Numbers:** Outfit with tabular, lining figures (`font-variant-numeric: tabular-nums lining-nums`, set on `body`)

**Character:** A bookish high-contrast serif speaks the answer and names each section; a round, even geometric sans carries everything else, with figures that line up in columns.

### Hierarchy
- **Display** (DM Serif 400, 2.5rem, line-height 1.05, `text-wrap: balance`): the regimen, "1 g IV q12h". One per result. The hold headline ("No regimen recommended") uses the same face at 1.75rem.
- **Headline** (DM Serif 400, 1.25rem, 1.2): evidence-section titles ("Why this dose", "Models"), the loading-dose heading, the one panel title ("Bayesian precision dosing") and the wordmark. The loading dose itself sets in DM Serif at 1.75rem.
- **Figure** (Outfit 500, 1.75rem, -0.01em): the one key number beside the regimen, AUC₂₄.
- **Title** (Outfit 600, 0.8125rem, 1.35, sentence case): form headings and the inline keys in the verdict ("Trough", "Next").
- **Body** (Outfit 400, 0.875rem, 1.6): UI body and evidence lead lines.
- **Body small** (Outfit 400, 0.8125rem, 1.55–1.6): verdict sub-lines, notes, chart summaries; notes and evidence cap at 72–78ch.
- **Label** (Outfit 400–500, 0.75rem): units, axis labels, legends, table heads. 12px is the floor.
- **Field** (Outfit 400, 1rem): every typed field at every width, so iOS never zooms on focus.

Scale: 12 · 13 · 14 · 16 · 20 · 28 · 40px (`--fs-xs` to `--fs-2xl`). Do not add a step.

### Named Rules
**The Tabular Rule.** Every number is Outfit with tabular figures. There is no monospace in this system, and none is added for data.

**The Serif Speaks the Answer Rule.** DM Serif Display is for the regimen, the loading dose, section titles and the wordmark. Labels, figures and controls are Outfit.

**The Sentence Case Rule.** Headings carry the label themselves, in sentence case. Nothing on screen is set in CSS capitals: the results grammar strips tracked uppercase from every evidence internal (confidence titles, value-of-information tags, the tinkerer header, the exposure-matrix heads, which read "q12h" as the verdict writes it), and `docs/audit/browser-flows.cjs` fails if any returns.

## Layout

Two columns inside a 1800px frame: an input panel (`minmax(400px, 30%)`, paper ground, right edge in `paper-edge`, 28px/26px padding) and a results panel (28px/36px padding). Under a sticky one-row header (64px, 56px at ≤600px) whose height is the `--header-h` token that scroll targets read.

The results panel is a container (`results`), and the results grammar responds to its width, not the viewport:
- **Wide (Bayesian):** a two-column top: course strip over curve on the left, the verdict column (250–300px) spanning both rows on the right, 32px column gap, closed by a hairline.
- **Wide (Trough):** the same frame with the curve over the loading dose on the left and the verdict (260–330px) on the right.
- **At ≤760px container width:** one column in the direction contract's order: strip, verdict, curve (Trough: verdict, loading dose, curve), each block closed by a hairline. Chart legends and summaries lose their axis-aligned left inset (46px Bayesian, 54px Trough).

Below the top: at most two inline notes (a "N more notes" link leads to the rest), then evidence sections as `<details>` rows, each a hairline-bottomed band with a 16px summary and a 19px-inset body.

Rhythm: 4 · 8 · 14 · 18 · 28 · 32px, with 14px the usual gap inside a group, 18px the padding of a band between hairlines, and 32px the gap between the chart and the verdict. Touch targets are 44px, and nothing scrolls horizontally at 375px.

### Named Rules
**The Shared Axis Rule.** The course strip and the concentration curve share one time domain and padding, and one cursor: pointing at either draws one dashed rule on both at the same instant. Anything drawn on either uses that axis.

## Elevation & Depth

Flat. The system uses no shadows: `--shadow-card` and `--shadow-glow` are `none`, `--glass-bg` is solid paper, and nothing blurs. Depth is conveyed by a hairline, one background step (`paper` to `paper-deep`), and a small hover lift on the two lifted controls (calculate button 2px, print action 1px). The page ground carries the house atmosphere: three faint radial washes of terracotta (5%), purple (3%) and moss (2.5%) on paper, strengthened to 8/6/4% in dark mode. The only other gradient-like ground is data.

### Named Rules
**The Hairline Rule.** Sections are separated by a 1px `rule` line, never enclosed. A bordered box inside a bordered box is the failure this system was built to remove.

**The Step-Not-Border Rule.** Selection is a background step plus terracotta ink, never a nested or coloured border.

## Shapes

Three values, mirrored from ainadara.com: a 4px rectangle for every field, button, segmented control and model option (`--radius-sm/md/lg` all resolve to 4px); a pill for badges, the version tag, the theme switch and the print action; a circle for dots, level markers and the brand mark. Charts are square-cornered: dose bars are plain rectangles as wide as the infusion, levels are circles with a paper halo, creatinine is a tick, "now" is a 4/4 dash and the cursor a 3/3 dash. The evidence disclosure marker is a drawn 7px chevron (two 1.5px borders rotated), not a glyph.

### Named Rules
**The Three-Value Shape Rule.** 4px, 999px, 50%. Do not reintroduce a radius scale.

## Components

### Buttons
Quiet and square; one filled button per panel.
- **Shape:** gently squared (4px), 44px minimum height.
- **Primary (calculate):** terracotta-ink fill, paper text, Outfit 600 at 14px, 14px padding, full width. Hover darkens toward ink (86% mix) and lifts 2px; press settles 1px.
- **Secondary (reset):** transparent with terracotta-ink text and a terracotta-quiet border; hover takes the paper-deep step.
- **Text action:** the verdict's actions are underlined terracotta-ink text (Outfit 500, 13px), underline at 45% terracotta, full colour on hover, 44px tall with no box.
- **Print action:** a fixed pill at the bottom right in paper with a paper-edge border and a drawn printer icon, shown only when the module on screen has a result.
- **Focus:** a 2px outline (terracotta-ink on fields, terracotta on buttons) offset 1–2px. No glow.

### Segmented Controls
- **Style:** a paper-deep trough with a hairline border and 3px padding; options are muted ink, 12px Outfit 500.
- **State:** the selected option steps up to paper with terracotta-ink text. The module switch uses the same grammar but fills the active tab with terracotta-ink and paper text.

### Model Options
A 2×2 grid (one column at ≤420px) of 4px tiles on the input ground with a paper-edge border: name in 12px Outfit 600, a muted sub-line. Hover borders in terracotta-quiet; the selected tile steps to paper and its name turns terracotta-ink.

### Inputs / Fields
- **Style:** input ground, 1px paper-edge border, 4px radius, 10px/14px padding, 16px text, tabular figures, spinners stripped. Course rows name their own units inside the field.
- **Hover:** border turns terracotta-quiet.
- **Focus:** 2px terracotta-ink outline 1px off the field; the border stays put.
- **Error:** a refused field takes an alarm border until the next run; the message lives in the error summary.
- **Disabled:** paper-deep ground, a dashed faint-ink border and muted text, with the state also in a word.

### Course Strip (signature)
An SVG timeline across the top of the results: "Dose" and "Level" lanes in muted 12px labels, ink dose bars as wide as each infusion with the dose in 12px Outfit 500 above the first bar and elapsed gaps ("12 h") beneath, ink level dots with values, muted creatinine ticks, a paper-deep region after "now", and projected doses in the projection's hue. It carries its own clock axis on a phone. A sideways drag scrubs the shared cursor; a vertical one still scrolls.

### Verdict (signature)
A column with no box: the regimen in Display with the interval in terracotta-ink; an "Infuse over…" line (plus amber "provisional" when confidence is Low); AUC₂₄ as a Figure with "likely X to Y" and its lopsided percentages; a 20-dot plot of plausible AUCs over a 7% ink target band, filled dots inside the band, hollow outside, a terracotta point-estimate tick; the trough as a safety check; then, below a hairline, one confidence word with its reason and model, one "Next" line, and the text actions.

### Evidence Sections
`<details>` bands closed by a hairline: a drawn chevron, a Headline title (terracotta-ink on hover) and a muted gist on one baseline. Bodies hold hairline tables (right-aligned tabular figures, the active row in ink 600), definition grids, forest plots (muted ranges, the active one terracotta) and numbered math in soft ink.

### Notes
Unboxed. A signal word in Outfit 600 beside a drawn 16px icon (`alarm`, `caution`, `info`), the body indented 24px beneath at 13px soft ink, max 78ch. Alarm words take the alarm hue, caution words amber, info ink with a muted icon.

## Do's and Don'ts

### Do:
- **Do** open a result on the course: strip, verdict at the "now" end, curve beneath on the same axis.
- **Do** set the regimen in DM Serif Display at 2.5rem and print doses in ISMP form ("1 g", "1.25 g IV q12h").
- **Do** separate results sections with a 1px `rule` hairline and show selection as a `paper-deep`/`paper` step plus `terracotta-ink`.
- **Do** use `terracotta-ink` for any terracotta text and `ink-muted` for any muted text.
- **Do** put the alarm hue only beside a signal word, and in notes beside the drawn alarm icon.
- **Do** use the drawn `ICON` set for alarm, caution and info.
- **Do** give every canvas colour through `themeColor()` / `themeRGBA()` and every tint through `color-mix()` over a token.
- **Do** keep touch targets at 44px and typed fields at 16px.
- **Do** keep motion to one quiet fade on arrival (0.26–0.32s, no transform beyond 4px) and colour transitions of about 0.2s, all dropped under `prefers-reduced-motion`.

### Don't:
- **Don't** put results in cards, give a callout a coloured side stripe, or use backdrop blur.
- **Don't** use `box-shadow` for depth; the only rings are focus outlines.
- **Don't** use a monospace face for numbers or data.
- **Don't** use glyph or emoji icons ("⚠", "💡", "✓").
- **Don't** set labels or headings in tracked uppercase; headings carry the label in sentence case.
- **Don't** use raw `terracotta` or `ink-faint` as text; both are near 3:1.
- **Don't** fade a de-rated dose; the word "provisional" carries the state and the dose stays at full ink.
- **Don't** add a radius value beyond 4px, 999px and 50%, or a type step beyond the seven.
- **Don't** hard-code a colour, including a canvas fallback used as the drawn value.

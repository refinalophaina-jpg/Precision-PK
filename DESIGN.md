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
  series-measured: "#3e6b1f"
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
- Peritoneal dialysis (v3.12.0): the Trough grammar. The verdict is "Give 500 mg IV now" (or "No dose today", or "Draw the first level"), then the expected level at the next draw as a range, then "Draw the next level <time> with AM labs, after the cycler". The chart is SVG in the course strip's idiom: measured levels in `--series-measured`, the projected range as a `--series-projection` band, the goal on `--paper-deep`, cycler nights as the neutral session band (8% ink, as HD), doses as ink ticks. The options table marks the recommended row with the `paper-deep` step and a `terracotta-ink` head. Unused intervals are muted ink. Since v3.15.0 (D27) the chart names its unit in a "mg/L" caption above the plot (the plot starts 24px down so the caption clears every tick label), puts a labelled top tick at or above the highest value drawn (the goal's upper label gives way when the two would collide; the goal stays in the verdict's sub-line), keys each band with a 10px swatch edged by a 1px `ink-muted` hairline, and names the projection in the legend ("Projected: decline before the dose, then with 500 mg", "Projected with 500 mg", or "Projected decline, no dose"). The answer is announced once per run, never on a resize. The options gist reads "9 choices, each if given now".
- Said once (v3.11.0): the chart's summary is the canvas's accessible name, not a paragraph; AUC/MIC appears only when MIC ≠ 1; evidence sections with nothing to show yet are one muted line (`.ev-empty`) naming what each needs. On Goti-HD, Regimens is closed and follows Haemodialysis, with no guideline line or projection row.
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
- **Amber** (`amber`): caution. The "provisional" word, a Low or Very low confidence word, caution notes and their drawn icon, the stale-result line, the supra-therapeutic exposure-matrix tint (15% mix), the profile privacy note, and since v3.15.0 (D27) the Hold caution line's icon, the held planned dose on the course strip and the failed-action line's icon.

### Tertiary
- **Alarm Crimson** (`alarm`, the `--red` extension at 342°, deliberately apart from terracotta's 15°): top-tier safety only. Alarm notes' signal word and icon, refused-field borders, the error-summary link underline, the hold headline when no regimen is given ("No regimen recommended", "No empiric maintenance regimen"), and the Hold line above a regimen (D26).
- **Purple** (`purple`): the house hue the fit's chart colour is stepped from (`series-fit`); not used directly in the results.
- **Moss** (`moss`): the `success` alias and a 10% band in the comparison canvases; a data colour.
- **Rose** (`rose`): an incumbent house extension kept in `:root`; the results world does not use it for levels (measured levels are `series-measured`).

### Neutral
- **Bone Paper** (`paper`): the page ground and the input panel ground; the "selected" step for segmented options and model options.
- **Deep Paper** (`paper-deep`): the one background step: segmented-control trough, the future region of the course strip, secondary-button hover, disabled fields.
- **Paper Edge** (`paper-edge`): 1px borders on fields, the header's bottom edge and the input panel's right edge.
- **Raised Card** (`card`): the extension's raised ground, used sparingly in the input panel.
- **Input Ground** (`input`): every typed field and unselected model option.
- **Ink** (`ink`): headline text, the regimen, key figures, the dose cap on the course strip, and every value printed beside a mark: text is ink.
- **Soft Ink** (`ink-soft`): secondary text: verdict sub-lines, notes, evidence body copy.
- **Muted Ink** (`ink-muted`): labels, units, axes, legends and gists; the text step that clears 4.5:1 on every ground. As a mark: the creatinine ticks. (The population prior moved to `ink-soft`, 2026-10-02.)
- **Faint Ink** (`ink-faint`): rules and marks only (the "now" dash, strip ticks, gridlines); 3.1:1, never text.
- **Hairline** (`rule`, ink at 10%): every divider between results sections, evidence rows and table rows.

### Chart Series
The concentration curves encode model and measurement in different colours, so a reader can tell at a glance what was measured, what the model fitted, and what the population predicted. The fit and projection hues are the house's own, stepped into a chart band (OKLCH L 0.43–0.77 light, 0.48–0.67 dark; chroma ≥ 0.10) and validated with a colour-vision simulation: fit against projection is ΔE 22.0 light and 18.0 dark under protanopia and deuteranopia.
- **Series Fit** (`series-fit`, #6751a8; #9583d5 dark): this patient's fit wherever it is drawn. The posterior curve (solid, then a short 3/3 dash after "now": the long dash belongs to the prior alone), its simulated 80% band as a 16% tint, the open ring at the fit's value at each measured level, the shared cursor's dot, and the Trough chart's current-regimen curve.
- **Series Projection** (`series-projection`, terracotta #cc785c; #cb7a5d dark, the same hue stepped into the dark band): the recommendation's future: the projected curve, its band tint, projected dose marks and bars, and the Trough chart's recommended curve.
- **Series Measured** (`series-measured`, #3e6b1f; #a6d27c dark; profile polish 2026-10-02, the user's request): a measured level, the strongest mark on the chart. The house moss deepened past the chroma floor and validated against the other two series (worst protan/deutan ΔE 12.0 light, 14.7 dark). In dark it steps outside the line band on purpose: a marker, lightest on dark as it is darkest on paper. A 5px dot on a 7px paper halo with its value in ink beside it; the strip's level dots and the legend swatch read the same token, and so does the Trough chart's measured level.
- **The residual is drawn.** A hairline (ink 34%) joins each measured dot to the fit's open ring at that moment, so the distance between measurement and model is a mark, not an estimate by eye. The ring is drawn last, on its own 3px paper casing, so it stays whole when the residual is small.
- **The key draws each mark as the canvas does:** the prior's swatch is a 6/4 dash made with a gradient (a CSS dashed border draws ~3px dashes), the band's swatch carries its 42% edges, and the posterior's swatch is 2.5px.
- **The posterior** is 2.5px on a paper casing (the line laid over a 5.5px paper stroke), so it reads crisply over its band and the grid; the band carries hairline edges in its own hue (42%).
- The population prior is an **ink-soft** long dash (1.5px, 6/4), on every chart: darker than any gridline so it reads as a curve, but never a series hue: a fourth hue collided with the fit (ΔE 11.5) or the measured green. On the Trough chart it is the population estimate for the regimen shown, drawn once a level has been fitted (steady-state trough, two levels, random level). Initial dosing has no such line, because there its one curve already is the population prediction.
- **A refused tinkerer dose** (D27): both tinkerers accept what every dose field accepts (`INPUT_LIMITS.dose`, 100–4,000 mg). Outside it, or blank, the result slot holds one caution line in words, `.tinker-refusal` (`role="status"`, the drawn `caution` icon): "Enter a dose of 100–4000 mg to try.", and the field is `aria-invalid`. No chart is drawn and no border colour alone carries the refusal.
- **The Dose Tinkerer** uses the same code: the regimen being tried in `series-projection`, the current regimen as fitted in `series-fit`, the population estimate for the tried regimen as the ink-soft dash, and the neutral trough-reference band. In the **regimen comparison** the current regimen leads in `series-fit`. Every tried regimen is a projection, so they share the projection's hue family (`series-projection`, `terracotta-ink`) and are told apart by line pattern and shade as well. Each is keyed beside a swatch drawn the same way. Six at most, so no style is reused. Both charts draw on true elapsed time, with each regimen's cycle repeated across the longest interval shown.
- **The Trough module's "Try another regimen"** draws its own comparison below the tried regimen's numbers, and never redraws the result chart. The tried regimen is drawn in `series-projection` beside the current regimen as fitted, in `series-fit`, once a level exists. In initial dosing and the two- and random-level modes it is drawn beside the recommendation, also in `series-projection`, so the tried regimen takes the comparison's second style (`terracotta-ink`, dashed). The population estimate for the tried regimen is the muted-ink dash in the level-based modes. The band is the clinician's trough target. These steady-state charts paint no background of their own: like the Trough and profile charts they sit on the page ground, so none reads as a box.
- **Continue or change** (D25, v3.14.0): when a regimen is being given, one line in body small, ink, weight 600 sits above the regimen: "Continue the current regimen" or "Change from 1.75 g IV q24h". It is never terracotta, which stays on the regimen. The reason follows the trough as `.vx-why` (ink-soft, body small), in the 20-dot units the dotplot shows, and names what the target box alone would give when that differs. On a continue the delta line ("Same as the current regimen") is dropped as said twice. Print carries both lines.
- **The Hold line** (D26, v3.14.0): when the fitted pre-dose level, or the newest post-distribution measured level carried down the fitted slope (the user's ruling U1), is 20 mg/L or more, the first thing in the answer is one line in the answer-line grammar (`.vx-action.vx-hold-head`, body small, weight 600) in the alarm hue with the drawn `alarm` icon: "Hold: next dose not before 16 Nov 09:45", or "Hold the planned dose at 2 Jan 18:00: next dose not before …", or, with no time within the 72 h horizon (U2), "Hold: recheck a level before the next dose". The horizon names the origin counted, on every surface: "until 72 h after the next dose is due", "72 h after the planned dose", or "72 h from now" once the due time has passed (D27, R51). A `.vx-hold-why` sub-line in soft ink names the basis that set it — "The fitted level at 16 Nov 09:45 is 23.4 mg/L" or "The measured 26.2 mg/L at 15 Nov 09:00, carried down the fitted slope, is 26.0 mg/L at 15 Nov 10:00", or both — and ends "Resume with the regimen below." A hold with no time names no clock time anywhere. The regimen stays shown below it in display type as what to resume with; terracotta stays on the regimen. The first-dose readout says "not before <time> (Hold)" and its level-by-then figure takes the alarm tone; when the carried measured level set the time, that is the figure shown, named "(measured, carried down the fitted slope; fitted 14.9)". Every number is labelled by the value it is: a no-time hold whose higher reading is the carried measured level says "measured level, carried down the fitted slope, 49.9 mg/L", never "fitted level". Under "recheck a level" no clock time, no first-day AUC and no projection are shown; the projection note says why. Copy summary, the screen-reader announcement and print lead with the hold. The Trough level, two-level and random-level verdicts use the same markup (`holdLineHTML`). The Next line under any hold is "Recheck a level before the next dose". A refusal holds too ("Hold: recheck a level before the next dose" above "No regimen recommended"). When the fitted level and a carried measured level are both 20 mg/L or more, it is a Hold on every model (D27, R59) and the why line names both readings, the head saying both fall below 20 mg/L by the resume time.
- **The Hold caution** (D27, the user's rulings U5, U6a and U7): where ONE reading at or above 20 mg/L is not a Hold (on Goti, the fitted level alone; in AUC Precision, a measured level drawn within 12 h of the course's first dose and before the second), the answer leads with one caution line in the `#b-hold` slot: `.vx-ceiling-head.vx-fitted-caution.tone-caution`, body small, weight 600, in the caution tone (amber text beside the drawn `caution` icon), the same grammar as the ceiling caution. It is not the action line (`.vx-action`) and never the alarm hue, because nothing is held. When the fitted and the measured level are both at 20 or more it is a Hold on every model, never this line (ruling R59). One sentence names the reading, its time and the instruction, and the instruction's verb is the same on every surface: "Caution: the fitted level when the next dose is due (16 Nov 07:30) is 29.3 mg/L, at or above 20 mg/L on the fit alone; no level drawn since the last dose confirms it. Draw a level before giving the next dose.", or "Caution: the measured 40.0 mg/L at 15 Nov 09:00, drawn after the first dose and before the second, carried down the fitted slope, is 27.2 mg/L when the next dose is due (…), at or above 20 mg/L. Repeat the level before giving the next dose." The time reads "now", "at the time chosen (…)" or "at the planned dose (…)" as the case is. The regimen and the first dose stand beneath it in their usual grammar; the readout's level-by-then figure takes the caution tone. The Next line and the further-level panel (tagged "Caution") give the same instruction ("Draw a level …" or "Repeat the level …"), and the panel's detail says why in words true for that kind, with no ruling numbers. Copy summary, the announcement and print carry the sentence, and with "Project next doses" on, the projection note repeats it after the projected AUC₂₄. Above a refusal it reads "… before any further dose", and the refusal's planned rows are drawn as held.
- **A held planned dose** (D27): a planned dose the answer holds (a Hold on the planned dose, a refusal's Hold, or the severe-renal "No further dose until a level is drawn" once a dose is given) is never drawn as given. The curve leaves it out of the simulated concentration, the axis keeps its place, and the course strip draws, where its bar would be, an empty outline as wide as the infusion in a 3/2 dashed amber stroke (1.25px), the drawn `caution` icon above it and the word "held" (12px Outfit 500, amber) on the first, titled "1.5 g planned at 15 Nov 12:00: held, not given". Print's caption adds "The planned dose held by the answer is not drawn."
- **The ceiling caution** (D26, the user's ruling U3): a current regimen above a dose ceiling (2 g a dose, 4.5 g a day) that is in range and safe is continued in both modules, and the verdict leads with one caution-tone line with the drawn `caution` icon (`.vx-ceiling-head`): "Caution: the current dose is above the conventional ceiling (single dose 2250 mg exceeds 2000 mg)", one wording (`ceilingCautionOf`). AUC Precision puts it above "Continue the current regimen" with a soft-ink `.vx-ceiling-why` beneath; the Trough module puts it under any hold, above the regimen. Copy summary and the announcement carry it.
- **The low-confidence continue** (D26, ruling 3): the action line stays "Continue the current regimen"; the `.vx-why` line names the regimen set aside and the cause alone, in one parenthesis, and ends on the instruction: "Within 400–600 at AUC₂₄ 541 with 13 of 20 plausible AUCs in range. 1.25 g IV q12h would put 15 of 20 plausible AUCs in range, but confidence in this fit is Low (the models disagree by 32%), so the regimen is not changed on it. Draw a level." No target-box sentence follows it. A continue above a dose ceiling leads with the ceiling caution (below).
- **The Trough refusal** (D26): when no admissible dose at the chosen interval lands in 400–600 within the ceilings, the regimen's place holds the alarm-hue heading "No regimen recommended" (`.vx-regimen-hold`, display face at 1.75rem) and a soft-ink reason that names the intervals that do work with their regimen and AUC₂₄. With no curve the verdict takes the whole width (`.tx-top-solo`). The cap-bound note is a caution about the chosen interval when another works ("Recommendation limit"), and AUC Precision's alarm only when no interval from q6h to q48h does. A current regimen over AUC₂₄ 700 (or a trough of 20 or more) leads with "Current regimen breaches a hard limit · …" at alarm tier; one over a dose ceiling only reads the ceiling caution, and out of range its assessment at caution tier, never "increase" (U3). Dose-explorer rows over a ceiling take `is-over`, a short reason ("over 2 g a dose") and an AUC cell that is never in-range coloured. At CrCl under 10 with no level the heading is "No empiric maintenance regimen" beside the severe-renal alarm note.
- **The profile-conflict refusal** (D26, D-e, R19): a save whose two columns disagree on a shared patient field is refused in the profile section's alarm note ("Check these inputs"). It leads "Not saved: these values differ between the two columns. Make them match, then save again; different values may mean two different patients.", then one line per field with both values ("Serum creatinine: Trough-Based 0.9, AUC Precision 1.4"), then one text action, "Copy the <this module> values to <other module>" (`k99`). The action copies only the conflicting fields, as typing would, clears the refusal and says "Save again to keep the profile." There is no "clear the column" advice. A save that leaves another patient's course or PD form behind says so on the status line.
- **The saved profiles list** (D27): each row ends with its age in muted text, "· saved today" or "· saved 3 days ago" (calendar days); a profile with no timestamp, or one in the future, shows none, never a 1970 date. Under the list, right-aligned, "Delete all profiles" is a text action (`k100`), offered whenever the store holds anything, readable or not, and hidden when it is empty or locked. It removes every entry, unreadable ones included, and says so ("Deleted all 5 saved profiles (2 could not be read)."), with Undo, which restores the stored text exactly. The recovery copy `ainadara.profiles.v1.bak` is never touched, and the status line says it is kept.
- **Focus after a destructive text action** (D27): Delete all profiles, a row's Delete and Clear all fields move focus to their Undo; Undo moves it to the status line (`tabindex="-1"`), which says what came back ("Restored all 2 saved profiles.", "Restored "First".", "Form restored."). Focus is never left on `<body>` or on the control just pressed.
- **The HD verdict** (D16) keeps the verdict grammar: the dose in display type with "after HD" in terracotta, then a subline naming the session and time. A hold, an empiric table or a request for sessions uses an ink heading (`vx-regimen-hd`), never the alarm colour. The empiric table shows both dialyser permeabilities rather than assume one.
- **The one-time HD verdict** (D17): "<dose> IV now" (or "after HD") with **One-time** leading the subline, so the heading never wraps at 375px. The assumed gap is a `.toggle-opt` group (24 / 48 / 72 h; selection is the paper step plus terracotta ink), and print states it as text. The dose × gap table (`.vx-hd-onetime`) marks in-range cells with the drawn `ICON.check` and screen-reader text, never a glyph; the chosen row takes `paper-deep` with a `terracotta-ink` row head. A missed post-HD dose is a caution note above the heading. **First dose (v3.9.0; one line since v3.11.0):** the regular verdict reads regimen → AUC₂₄ → trough → confidence → Next → first dose. The first dose is one line in body small: the "First dose" / "Next dose" key, the time, the clock times after it, the level by then, and "change", a terracotta-ink text button (`.vx-link`, a 44px target by padding) that opens the date and 24-hour time side by side (the HD "Give at" row style). The first-day AUC₂₄ appears beneath only outside 400–600, as a caution, its two clauses separated by a middle dot ("First 24 h AUC₂₄ 376, below 400–600 · steady state unchanged"). Print keeps the full block: the offset against the schedule, the first-day AUC and the line that steady-state exposure is unchanged. The averaged-model caution is always shown. Since v3.8.0 the answer names the assumed next HD as a clock time and what it counts from ("3 Oct 13:42 (48 h after session 1 began)"); a gap that has already passed is a disabled, struck-through option and an em-dash column with screen-reader text; the table heads carry each gap's clock time in muted ink. "Give at" is a date field and a 24-hour time field (16px, 44px tall, the input ground) beside the gap control, on screen only.
- **Haemodialysis sessions** (D15) are events, not series. Each is a neutral ink band (8%) behind everything on the course strip, the curve and the printed chart, labelled "HD" and keyed as "Haemodialysis session". A level drawn during or soon after a session carries a caution in words; levels themselves are never altered.
- **The Trough dose explorer** keys the rows its chart draws with that chart's legend: a line swatch and a word beside the regimen. The current regimen is on the `series-fit` line ("current"); the recommendation is on the `series-projection` line, with the row's terracotta step ("recommended", or "recommended (current)"). The words are text tokens. The optimiser's dose, when it is not the recommendation, is named in muted ink with no line, because terracotta means the recommendation. Amber on a value is the caution status, not a series. The Trough chart's key draws one Peak and Trough swatch per series drawn, in that series' colour (`series-fit`, `series-projection`), as the canvas draws the markers (D27). The measured-level value on that chart takes the band label's clear-place scan, so it sits clear of the curves, the markers and the band label.

### Named Rules
**The "This One" Rule.** Terracotta marks the recommended regimen, the selected option and the projection, plus the one action a surface asks for. It is never decoration and never a second status colour.

**The Ink Step Rule.** Terracotta as text is always `terracotta-ink`; raw `terracotta` is for fills, strokes and outlines. The same split holds for ink: `ink-muted` for text, `ink-faint` for marks.

**The Signal Word Rule.** The alarm crimson never appears as colour alone. It sits beside a signal word, and in a note beside the drawn alarm icon. A de-rated result is one hue: "provisional" and the Low confidence word are both amber, because the alarm is reserved for safety.

**The Token-Only Rule.** Every colour resolves from a token, including canvas, which reads tokens through `themeColor()` / `themeRGBA()` so it re-themes. Tints are `color-mix()` over a token, never a raw `rgba()` literal.

**The Model-and-Measurement Rule.** On a concentration chart, measured data is `series-measured` and the fit is `series-fit`. Neither colour is used for the other, and values beside either are ink. The fit's value at a measured level is an open ring in the fit's hue beside the measured dot, joined to it by a hairline, so the residual reads as the distance between two colours. The legend's swatches read the same tokens as the plot, and a chart's written summary never names a colour.

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

**The Notation Rule** (D27). One notation on screen and in print: "h", never "hr"; a space before every unit ("11.5 h", "1.5 g"); "Kel 0.106 h⁻¹"; intervals in prose as the verdict writes them ("q12h"); "AUC₂₄" with its subscript in every sentence shown, engine reason strings included (converted at display time by `userNotation` and `proseFreq`, so the engine's own strings are unchanged). Announcements and aria-labels keep "AUC24", because it is spoken. A difference reads in words, "AUC₂₄ 141 mg·h/L higher, trough 7.5 mg/L higher", never a signed number. Regimen detection's confidence is "consistent schedule" (probable, unclear), never a second "confidence" beside the verdict's. Print shows the SCr the fit used, a whole number with one decimal ("1.0 mg/dL").

**The Sentence Case Rule.** Headings carry the label themselves, in sentence case. Nothing on screen is set in CSS capitals: the results grammar strips tracked uppercase from every evidence internal (confidence titles, value-of-information tags, the tinkerer header, the exposure-matrix heads, which read "q12h" as the verdict writes it), and `docs/audit/browser-flows.cjs` fails if any returns.

## Layout

Two columns inside a 1800px frame: an input panel (`minmax(400px, 30%)`, paper ground, right edge in `paper-edge`, 28px/26px padding) and a results panel (28px/36px padding). Under a sticky one-row header (64px, 56px at ≤600px) whose height is the `--header-h` token that scroll targets read.

The results panel is a container (`results`), and the results grammar responds to its width, not the viewport:
- **Wide (Bayesian):** a two-column top: course strip over curve on the left, the verdict column (250–300px) spanning both rows on the right, 32px column gap, closed by a hairline.
- **Wide (Trough):** the same frame with the curve over the loading dose on the left and the verdict (260–330px) on the right.
- **At ≤760px container width:** one column in the direction contract's order: strip, verdict, curve (Trough: verdict, loading dose, curve), each block closed by a hairline. Chart legends and summaries lose their axis-aligned left inset (46px Bayesian, 54px Trough).

**The workstation (D24, v3.13.0).** From 1001 px the input panel is sticky under the header at `100dvh − --header-h`, scrolls on its own (its children never shrink), and pins the run button in a paper band with a top hairline at its foot (`.panel-actions`). The answer scrolls with the page; a run moves the window only when the answer's top is off screen. The input column reads mode, patient, creatinine, course, target, then saved profiles (a hairline section, not a card); "Clear all fields" is a text action at the top with an Undo line. The five Trough modes wrap as whole labels. Every instant is a date field and a 24-hour time field with a read-back in the result's grammar ("9 Nov 19:30").

Below the top: at most two inline notes (a "N more notes" link leads to the rest), then evidence sections as `<details>` rows, each a hairline-bottomed band with a 16px summary and a 19px-inset body.

Rhythm: 4 · 8 · 14 · 18 · 28 · 32px, with 14px the usual gap inside a group, 18px the padding of a band between hairlines, and 32px the gap between the chart and the verdict. Touch targets are 44px, and nothing scrolls horizontally at 375px. Since v3.15.0 a browser check measures every interactive element in both modules at 375px: the projection fields and their checkbox label (`min-height: 44px`) and the "N more notes" link (`.vx-more`, an inline-flex 44px row) were raised to it; a checkbox or radio counts through its label (the AUC dialysis box is 18px inside a 44px label).

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
- **Clear all fields / Undo:** a text action in soft ink (underline at 30% ink), at the top of the column, never beside the run button (D24).
- **Text action:** the verdict's actions are underlined terracotta-ink text (Outfit 500, 13px), underline at 45% terracotta, full colour on hover, 44px tall with no box.
- **Print action:** a text action, "Print or save as PDF", among each answer's actions (D24). It exists only with a result; nothing floats over the results.
- **Focus:** a 2px `terracotta-ink` outline offset 1–2px on every control, light and dark (since v3.15.0; raw `terracotta` was 3.0:1 and is used for selection outlines only). Fields that draw a ring use an 18% `terracotta-ink` tint. No glow. From 1001 px the input column's `scroll-padding-bottom` is the pinned run band's measured height (`--actions-h`), so a field reached by Tab is never behind it.
- **The failed-action line** (D27): a handler that throws shows one line at the window's lower right (`#action-status`, `role="alert"`, fixed, at most 560px wide): paper ground, a hairline, the 4px radius, the drawn `caution` icon in amber and ink text, `"Undo" did not finish. What is on screen may be incomplete: check it before relying on it.`, then a "Dismiss" text action. It names the control, never the error text, and is hidden in print.

### Segmented Controls
- **Style:** a paper-deep trough with a hairline border and 3px padding; options are muted ink, 12px Outfit 500.
- **State:** the selected option steps up to paper with terracotta-ink text. The module switch uses the same grammar but fills the active tab with terracotta-ink and paper text.

### Model Options
A 2×2 grid (one column at ≤420px) of 4px tiles on the input ground with a paper-edge border: name in 12px Outfit 600, a muted sub-line. Hover borders in terracotta-quiet; the selected tile steps to paper and its name turns terracotta-ink. The model suggested for this patient carries the words "suggested for this patient" (12px Outfit 600, ink) once weight and height are known; it is never selected for the clinician (D24). The Models gist says "Suggested: …" only when the model in use is not the one suggested.

**The Hughes out-of-population line** (D27): on Hughes, every Hughes 2024 Table 1 covariate outside its range (weight, height, BMI, age, serum creatinine, CrCl on fat-free mass) is said in one sentence in the confidence slot, the same `.vx-mismatch.tone-caution` line with the drawn `caution` icon as any model mismatch, never the alarm hue and never a second line: "Hughes 2024 was built in patients with CrCl on fat-free mass 13–255 mL/min; this patient's CrCl on fat-free mass (307 mL/min) is above that range." Several covariates are listed in Table 1's order, each value with its noun in parentheses ("weight (230 kg), BMI (75.1), age (92 years) and serum creatinine (2.8 mg/dL) are above those ranges"; "BMI (37.2) is below and CrCl on fat-free mass (300 mL/min) is above those ranges"). A value is the patient's own at its usual precision, given more decimals until it lies outside the bound, so it never reads as a number the patient does not have ("255.2 mL/min", "BMI (39.95)").

### Inputs / Fields
- **Style:** input ground, 1px paper-edge border, 4px radius, 10px/14px padding, 16px text, tabular figures, spinners stripped. Course rows name their own units inside the field.
- **Hover:** border turns terracotta-quiet.
- **Focus:** 2px terracotta-ink outline 1px off the field; the border stays put.
- **Error:** a refused field takes an alarm border until the next run; the message lives in the error summary.
- **Disabled:** paper-deep ground, a dashed faint-ink border and muted text, with the state also in a word.

### Course Strip (signature)
An SVG timeline across the top of the results: "Dose" and "Level" lanes in muted 12px labels. Each dose is an infusion block: a body as wide as the infusion (ink 28%) with a solid ink cap at its start, the charted time. The dose is in 12px Outfit 500 above the first block and elapsed gaps ("12 h") beneath. Level dots are `series-measured` with their values: a value sits left of its dot when the next dot is too close, and an interval label that would touch a level value is left out. Then muted creatinine ticks, a paper-deep region after "now", and projected doses in the projection's hue. It carries its own clock axis on a phone. A sideways drag scrubs the shared cursor; a vertical one still scrolls.

### Verdict (signature)
A column with no box: the regimen in Display with the interval in terracotta-ink; an "Infuse over…" line (plus amber "provisional" when confidence is Low); AUC₂₄ as a Figure with "likely X to Y" and its lopsided percentages; a 20-dot plot of plausible AUCs over a 7% ink target band, filled dots inside the band, hollow outside, a terracotta point-estimate tick; the trough as a safety check; then, below a hairline, one confidence word with its reason and model, one "Next" line, and the text actions.

### Evidence Sections
`<details>` bands closed by a hairline: a drawn chevron, a Headline title (terracotta-ink on hover) and a muted gist on one baseline. Bodies hold hairline tables (right-aligned tabular figures, the active row in ink 600), definition grids, forest plots (muted ranges, the active one terracotta) and numbered math in soft ink.

### Notes
Unboxed. A signal word in Outfit 600 beside a drawn 16px icon (`alarm`, `caution`, `info`), the body indented 24px beneath at 13px soft ink, max 78ch. Alarm words take the alarm hue, caution words amber, info ink with a muted icon. A note over 300 characters shows three lines and a terracotta-ink text action, "Read the rest: <word>"; print shows it whole (D24).

**The Early level note** (info tier, D27) states which band the range uses, with both bands in numbers: "The range and the 20 plausible AUCs use the band simulated for levels drawn before steady state, −26% / +36%, wider than the −18% / +28% simulated for steady-state troughs." When an earlier level was early but the most recent one is steady: "The most recent level was drawn at steady state, so the range uses the band simulated for steady-state troughs, …". Where the further-level detail quotes a narrower band, it adds when that holds: "the narrowing quoted is for a further level drawn at steady state, from <date time>".

### Regimens grid
Steady-state AUC₂₄ by dose and interval, closed by default with a gist ("12 within 400–600 · recommended 1.25 g IV q12h"). The trough figure is soft ink (4.8:1 or better on every band); a blocked cell says "over limit" with its AUC struck through, never faded. The recommendation has a 2px terracotta border; the regimen being tried takes the paper-deep step and the word "trying" in terracotta-ink, with `aria-pressed` (D24). The key's swatches are the cells' own (D27): "In band" and "Above band" share the cells' hues, and "Below band", an unfilled cell, is drawn as one, a box edged by a 1px `ink-muted` hairline rather than paper on paper.

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
- **Do** keep motion to one quiet fade on arrival (0.26–0.32s, no transform beyond 4px) and colour transitions of about 0.2s, all dropped under `prefers-reduced-motion`, which also turns off smooth scrolling (`scroll-behavior: auto`, D27). **One authored exception, the arrival** (profile polish 2026-10-02, the user's request): on a NEW result only, the concentration curve traces in left to right over 950ms with an exponential ease-out and a pen point at its leading edge, each measured level lands (scale with a slight overshoot) as the trace passes it, and the course strip's blocks, dots and labels appear on the same sweep. The frame, axes and "now" are there from the first frame. It never plays on a redraw (theme, resize, a toggle), under reduced motion, or in print, and the last frame is exactly the static chart.

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

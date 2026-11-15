## Summary (UI, graphics, accessibility, wording — v3.14.0 RC, HEAD 32988d9)

No Critical findings. Eight Important, mostly wording that contradicts itself and two accessibility gaps. No report.md was written, as instructed; screenshots and scripts are in `/private/tmp/claude-501/-Users-olaiya-Projects-Local-Pharmacy-Vancomycin-/97db9c82-2ba8-44f0-990f-9a5f5d5c7a92/scratchpad/review-2026-11-13/ui/` (screenshots in `shots/`, called SHOTS below).

**Covered:** ten fictional cases (Trough initial, steady-state, two levels, random, PD; AUC Buelga continue, Buelga change, Goti, Goti-HD with sessions, Hughes) at 1280×800, 1440×900, 1920×1080 and 375×812, light and dark, plus print. Fixed clock, production CSP, no console errors or CSP violations.

**What holds up:**
- DOM text contrast is ≥4.5:1 in every case, viewport and theme (exceptions: the "Dara" wordmark at 3.02 and the 10 px ⏎ hint at 3.46).
- No horizontal scroll at 375 px, no unnamed controls, every canvas has `role="img"` and a label.
- The course strip and curve occupy the same box (436–912 px), and the planned HD session sits inside the axis.
- Reduced motion stops the curve animation; Enter runs; the error summary takes focus and sets `aria-invalid`; Clear offers Undo.

**Most important findings:**
1. Tabbing to Serum creatinine (a required field) leaves it fully behind the sticky Calculate footer.
2. On a change of interval the verdict says "First dose 13 Nov 10:00 (was due 12 Nov 20:00)" for a patient on q24h whose next dose was due 13 Nov 08:00. It reads as a dose missed 14 hours ago.
3. "This dose was generated from a fit the tool itself does not trust" sits beside "Close agreement · worst 0.3 σ" and "A further level would add little". The real cause, models disagreeing by 24% (Goti puts the continued regimen at 662), is only in closed sections.
4. Nine of ten printed reports lack "not clinically validated"; only PD has it.
5. The PD result is never announced to screen readers.
6. On the steady-state chart the measured-level label "24.0" sits on top of the recommended curve and a trough marker.
7. The PD chart labels only 10 and 15 with no unit while the peak is drawn near 20, and two legend swatches are invisible.

**Not covered:** real Windows or Android devices, a real screen reader, saved profiles, and visual inspection of the Tinkerer and comparison charts and the Trough print pages. 1440 and 1920 were captured and audited automatically; only one 1920 screen was looked at.

**Most telling screenshots:**
- SHOTS/kb-focus-obscured-scr-1280.png
- SHOTS/a-buelga-change-1280-dark.png
- SHOTS/a-buelga-continue-1280-light.png
- SHOTS/z-t-level-chart-light.png
- SHOTS/z-t-pd-top-light.png
- SHOTS/a-buelga-continue-print.png
- SHOTS/z-a-gotihd-top-dark.png

---

# Full report

## Critical
None found.

## Important

**I1. Keyboard focus is hidden behind the sticky Calculate footer**
- Where: Trough input pane, 1280×800; the same footer exists in AUC Precision.
- What: Tabbing from the top, stop 18 (`#scr`, required) lands at y 756–800 while the footer starts at y 719, so the focused field and its ring are invisible. `#has-ld` (708–752) is also obscured and `#t-hd` partly.
- Evidence: SHOTS/kb-focus-obscured-scr-1280.png (focus is on Serum creatinine; nothing shows).
- Change: `scroll-padding-bottom` on the scrolling `.panel-left` equal to the footer height, or `scroll-margin-bottom` on fields.
- Effort: S.

**I2. "was due" is computed on the new interval, so a change of interval reads as a missed dose**
- Where: AUC verdict and print, "Change from 1.75 g IV q24h" case; `index.html:9672`.
- What: Last dose 12 Nov 08:00 on q24h, so the next was due 13 Nov 08:00. The line reads "First dose 13 Nov 10:00 (was due 12 Nov 20:00)".
- Evidence: SHOTS/a-buelga-change-1280-dark.png; SHOTS/z-a-change-top-proj-light.png.
- Change: take the due time from the regimen being given, or drop the parenthesis when the interval changes and say "last dose 12 Nov 08:00".
- Effort: S–M. Cross-area with decision logic.

**I3. The Low-confidence sentence contradicts the evidence under it**
- Where: AUC verdict, `index.html:13545`; Continue, Goti and Hughes cases; repeated in print.
- What: "This dose was generated from a fit the tool itself does not trust" appears while:
  - Fit vs measured says "Close agreement · worst 0.3 σ" and "The fit reproduces the levels";
  - Next says "A further level would add little";
  - the actual reason sits in closed Why/Models: "The applicable models disagree by 24%", Buelga 520 against Goti 662, "1 of 2 applicable models place AUC₂₄ within 400–600".
- The new "Continue the current regimen" headline makes this sharper: continue, in range, provisional, untrusted fit, no further level needed. The 2026-11-10 critique noted it as a persona flag; it is still open.
- Evidence: SHOTS/a-buelga-continue-1280-light.png; SHOTS/a-continue-all-open.txt.
- Change: name the cause in the verdict, for example "Low confidence — one level, and the two applicable models disagree by 24% (AUC₂₄ 520 vs 662)". Drop "does not trust".
- Effort: S.

**I4. The printed report omits "not clinically validated"**
- Where: `index.html:538` hides `.rp-disclaimer` in print; the footers at 15273, 15485, 16444 and 16667 say only "Advisory only — not a prescription · Clinician judgment required."
- What: nine of ten printed reports contain no "validated"; PD has it. PRODUCT.md makes this binding, and print is the handoff artefact.
- Evidence: SHOTS/*-print.txt; SHOTS/a-buelga-continue-print.png.
- Change: use the on-screen disclaimer sentence in every print footer.
- Effort: S.

**I5. The PD result is not announced to screen readers**
- Where: Trough, Peritoneal dialysis. `announceResult` is called at 7447, 7548, 7664 and 14116, with no call on the PD path.
- What: after Calculate, `#sr-announce` is empty and focus stays on the button.
- Change: announce the verdict, for example "Result: give 500 mg IV now; expected 13.0–14.7 mg/L at 14 Nov 06:00."
- Effort: S.

**I6. Steady-state chart: the measured-level label is drawn over other marks**
- Where: Trough steady-state, `#pk-graph-ss`, all viewports.
- What: "24.0" and its halo cover the recommended curve's upstroke at the 12 h boundary and crowd the current regimen's trough ring. This breaks the rule that a label avoids what is drawn, markers included. The dot itself is on the curve.
- Evidence: SHOTS/z-t-level-chart-light.png.
- Change: place the label with the same clear-place scan the band label uses, or flip it up and left near a dose boundary.
- Effort: S–M.

**I7. PD chart cannot be read for the peak, and its key is partly invisible**
- Where: PD result chart (SVG), all viewports.
- What:
  - The y axis shows only "10" and "15" with no unit; the projected peak (19.6–20.6 mg/L) is drawn above the last label.
  - The "Cycler night" swatch is 8% ink on paper and shows as blank.
  - The "Goal" swatch is `--paper-deep` on `--paper`, about 1.1:1.
  - "Projected with 500 mg" also labels the pre-dose decline.
- Evidence: SHOTS/z-t-pd-top-light.png; SHOTS/t-pd-375-light.png; CSS at 2681–2694.
- Change: add a mg/L caption and a tick at or above the drawn maximum; give swatches a visible hairline border and fill; name the pre-dose segment "decline".
- Effort: M.

**I8. Hughes case: a change away from an in-range regimen on a fit labelled untrusted (cross-area)**
- Where: AUC, Hughes, BMI 43.
- What: "Change from 1.5 g IV q12h" (AUC₂₄ 537, 13 of 20 in range) to 1.25 g (448, 15 of 20), shown with "provisional", "Low confidence", "does not trust" and "A further level would add little". The D25 two-dot rule is met, but the screen argues against its own change.
- Evidence: SHOTS/a-hughes-1280-dark.png.
- Change: for the decision-logic reviewer — should a de-rated fit be allowed to move an in-range regimen? If yes, the why-line should say so plainly.
- Effort: S for wording, M for logic.

## Minor

- **M1. Focus ring colour.** The ring uses raw `--terracotta` (lines 185, 2057, 2102): 3.02:1 on paper, 2.94 on input, 2.78 on paper-deep. Text fields already use `--terracotta-ink`. Use it everywhere. S.
- **M2. Three uses of "confidence".** "Detected Q12H — high confidence" (input panel) and print "Confidence | high" under Current regimen sit beside the verdict's "Low confidence". Rename the schedule one, for example "Schedule: consistent". S.
- **M3. Notation drift.** S.
  - "hr" in Trough inputs against "h" in AUC inputs.
  - "Ke 0.0489 hr⁻¹" against "Kel 0.1059 h⁻¹".
  - "11.5h", "0.5h", "12.0h from dose start" with no space.
  - "Q12H" and "q12h" in one paragraph.
  - Engine reason "AUC24 900 exceeds the absolute ceiling 700" beside "AUC₂₄".
  - Print shows "SCr 1 mg/dL" for a typed 1.0.
- **M4. AUC/MIC repeated in Trough.** Trough verdicts show "AUC/MIC 472" beside "AUC₂₄ 472" at MIC 1; AUC Precision suppresses this. S.
- **M5. HD dose table row heads wrap.** "250 / mg", "500 / mg", "750 / mg" at 1280 (SHOTS/z-a-gotihd-top-dark.png); fine at 375. Add `white-space: nowrap`. Listed 2026-11-10, still open. S.
- **M6. Delta line reads as negative values.** "Against the current regimen: AUC₂₄ −450 mg·h/L, trough −16.4 mg/L". Prefer "450 lower". S.
- **M7. Run-together caution.** "First 24 h AUC₂₄ 376, below 400–600 steady state unchanged" has an amber clause and a muted clause with no separator. S.
- **M8. Print text.** "1.25 g IV q12hprovisional" has no space in the text layer; "Uncertainty: ~−21% / +23%"; "Clinical Pharmacist Tool" is title case. S.
- **M9. Resize or theme change re-renders the result.** The 0.32 s fade replays and the live region is cleared and refilled, so a screen reader hears the result again. Gate both on result identity, as the curve already is. S–M.
- **M10. Smooth scroll under reduced motion.** `html { scroll-behavior: smooth }` is not reset (measured "smooth" with reduce on); JS paths check, CSS anchors do not. S.
- **M11. Touch targets at 375.** Projection fields 88×40 and 69×40 (open since 2026-11-10); "N more notes" link 21 px tall; `#b-dial` checkbox 18×44. S.
- **M12. Regimens legend.** The "Below band" swatch is paper on paper (SHOTS/a-continue-regimens-1280.png). S.
- **M13. Trough chart key.** Peak and Trough markers are grey in the key but drawn in each series' colour. S.
- **M14. PD summary gist.** "Options · 9 doses, given now" (open since 2026-11-10). S.

## Enhancement

- **E1. HD chart stops before the answer.** It ends about 2 h after session 2 and draws neither the recommended post-HD dose nor the 18.3 mg/L at the assumed next HD. Project the one-time dose. M.
- **E2. Two-levels and random-level charts omit the measured levels** the fit was built from; only the steady-state projection is shown. An inset or first-dose segment would show the data. M.
- **E3. 1920×1080 layout.** The verdict stays in a column about 300 px wide beside a large blank area under the chart (SHOTS/a-hughes-1920-light.png). M.
- **E4. No skip link** past the header and mode buttons (ten Tab stops before Age). S.

## Decisions for the user

1. **Low-confidence wording (I3).** Replace "a fit the tool itself does not trust" with the named cause? And should "Continue the current regimen" carry the dissenting model's AUC in the verdict?
2. **"was due" (I2).** Should it mean due on the regimen being given, or be dropped when the interval changes?
3. **A change on a de-rated fit (I8).** May a Low-confidence fit move an in-range regimen for two more of 20 plausible AUCs?
4. **Print disclaimer (I4).** Is the on-screen sentence, including "not clinically validated", the one to use on every printed page?
5. **Focus ring (M1).** `--terracotta-ink` for all rings touches the design rule that terracotta marks "this one".
6. **Charts (E1, E2).** Draw the HD recommendation and the first-dose levels, or keep the charts as they are and say so in the caption?

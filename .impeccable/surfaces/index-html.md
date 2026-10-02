---
version: 1
slug: "index-html"
primary_target: "index.html"
related_targets: []
---

# Surface brief — vancomycin calculator results (Bayesian panel first; Trough module follows the same grammar)

Scope: the results column of index.html. Mode: Operate. Audience: clinical pharmacists verifying a regimen (PRODUCT.md). Job: read the regimen, its exposure and how far to trust it in seconds; reach the evidence in one step. Constraints: engine and copy truth unchanged; educational disclaimer; no PHI; strict hash-pinned CSP (delegated handlers only). Decisions already made: ISMP grams from 1,000 mg; Low confidence keeps the dose as headline, marked provisional.

## Direction contract

THESIS: The result is read off the patient's own course. The panel opens on a timeline of what was given and measured, and the verdict stands at its "now" end — refusing the category default of a stack of stat cards and striped alert boxes above a buried dose.

OWN-WORLD: AinaDara bone paper and ink; terracotta only for the recommendation, the selected cell and the projection; one muted alarm hue for top-tier safety, always with a signal word. DM Serif Display for the regimen and section titles; Outfit with tabular figures for every number. Hairlines separate; no cards, no stripes, no blur, no monospace.

STORY: The pharmacist sees the course (doses as bars as wide as each infusion, levels as dots with values, creatinine as ticks), reads the regimen and its lopsided exposure range at the end of it, sees one confidence word with its reason and one next step, and opens evidence only to check.

FIRST VIEWPORT: Top of the results column. A full-width course strip on a clock-time axis, "now" at its right; beside its right end on desktop (below it on phone) the verdict: order string in DM Serif ("1 g IV q12h · over 1 h"), AUC₂₄ with "likely X to Y" and a lopsided 20-dot plot over a faint ink target band, confidence word + reason + model (+ "provisional" when Low), one next-step line. Directly beneath, the fan-chart concentration curve on the same axis. At most two inline notes.

FORM: The course timeline — position 7 of 7 on the ranked list; seed key 7ea7d51a (surface, operate).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Signature interaction and motion
Scrubbing the course strip or the curve moves one shared time cursor across both, reading the concentration at that moment; response under 100 ms. Motion: one quiet fade of the results on arrival; nothing animates uncertainty after it has arrived. One authored moment (2026-10-02, the user's request): on a new result the curve traces in left to right with a pen at its edge, each level lands as the trace passes, and the course strip is staged on the same sweep; never on a redraw, under reduced motion, or in print.

## Unresolved
None blocking. Print keeps white ground and a text summary under each chart.

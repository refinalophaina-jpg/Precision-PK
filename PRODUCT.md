# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary: clinical pharmacists verifying or building a vancomycin regimen at work, often between other tasks and on a phone as often as a desktop. They are expert readers: they want the regimen, the exposure it produces and how far to trust it within seconds, with the evidence one step away rather than in the way. Residents, students and board-exam learners are a secondary audience; the teaching content serves them without blocking the expert path. (Confirmed 2026-09-28.)

## Product Purpose

A vancomycin therapeutic drug monitoring calculator. It turns a patient's demographics, dose history and measured levels into an individualised regimen targeting AUC₂₄ 400–600 mg·h/L, with honest statements of uncertainty, model agreement and fit. Success is a pharmacist reaching a defensible regimen quickly, understanding how much the answer depends on the data versus the model, and being able to show the working.

## Positioning

The calculator's mechanism is honesty about its own limits: every clinical constant is sourced or labelled as the calculator's preference; uncertainty is simulated per model and shown asymmetric; the fit reports a second solution when the data cannot choose; unknown values are refused, never silently repaired. The exposure matrix shows the whole admissible dose × interval space rather than a single ranked answer.

## Operating Context

- Two modules: Trough-Based (initial dosing, steady-state level, two levels, random level) and AUC Precision (MAP Bayesian with Buelga 2005, Goti 2018, Goti-HD and Hughes 2024 priors).
- Inputs: age, sex, weight, height, SCr (and serial SCr), cystatin C, dose rows with date/time and infusion time, level rows with date/time.
- Outputs used at the bedside: a regimen, its predicted AUC₂₄ and trough, confidence, a printable report for handoff.
- Live at pharmacy.ainadara.com/vancomycin, served from the pharmacy hub repository with a strict hash-pinned CSP (inline script hashed, delegated event handlers, no inline handlers).
- Source of truth: Precision-PK `index.html`; validation suites `phase2d_validation.cjs`, `phase3_simulation.cjs`, `phase4_regimen_validation.cjs`.

## Capabilities and Constraints

- Binding: decision support and education only — not clinically validated; fictional data only; nothing leaves the browser (no network calls with patient data, no telemetry beyond the site's existing analytics).
- Binding: redesign work changes presentation, not the engine. Every number, citation, caveat and refusal keeps its meaning; layout and wording may change.
- Not binding (confirmed): a single self-contained file (it is one file today and the test harness reads the inline script); a formal accessibility standard.
- Dose display convention: ISMP — grams from 1,000 mg ("1.25 g IV q12h", "750 mg"), a space between number and unit, commas where a number reaches 1,000, never mixing units for one dose. (Decided 2026-09-28.)
- When the fit's own confidence is Low, the dose still leads, marked provisional, with the reason and next step beside it. (Decided 2026-09-28.)

## Brand Commitments

AinaDara house style: quiet · precise · clinical. Tokens, type (DM Serif Display for display, Outfit for everything else, no brand monospace) and voice are defined in `~/mission-control/domains/ainadara/philosophy/` (brand.md, design-tokens.md, voice.md). Do not add AinaDara promotion to the tool. No exclamation points, no hype words.

## Evidence on Hand

- Literature PDFs for every model in `../Literature/` (Buelga 2005, Goti 2018 + erratum, Hughes 2024, Matzke 1984, Fewel 2021, Bauer one-pager).
- Audit and decision records: `docs/v3-decisions.md` (D1–D11), `docs/audit/`.
- Design critique 2026-09-28: `.impeccable/critique/`.
- No user research, testimonials or usage data exist; do not invent them.

## Product Principles

1. Answer first, evidence one step away.
2. Say how sure, in numbers and a word — never hedge in prose.
3. Refuse rather than guess; show the refusal as plainly as an answer.
4. One source for every concept: one confidence vocabulary, one next-step rule, one AUC band.
5. Calm under pressure: nothing on screen competes with the regimen for attention.

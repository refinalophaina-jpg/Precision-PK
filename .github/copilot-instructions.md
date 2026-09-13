# Copilot instructions — Precision-PK / AinaDara vancomycin TDM

This is a **clinical dosing calculator used at the bedside**. A wrong number here
reaches a patient. Read this before proposing anything.

`CLAUDE.md` in the repo root is the authoritative project document. Where this file
and `CLAUDE.md` disagree, `CLAUDE.md` wins. **Do not cite a file you have not
opened**, and do not attribute a quotation to a file you have not verified exists —
a previous review quoted `CLAUDE.md` while attributing it to a `.copilot-instructions.md`
that never existed, then reasoned from the misattribution.

## What you are for here

Useful, and welcome:

- Small code review of a diff — typos, dead code, a missed `escHtml`, an unhandled
  `null`, a copy-paste slip, an off-by-one.
- CSS and presentation: spacing, contrast, responsive behaviour, print styles,
  focus states, dark mode.
- Markup: accessibility attributes, semantics, label/`for` wiring.
- Wording of on-screen text and comments.

Out of scope. Do not propose these unless explicitly asked:

- Restructuring the file, the build, or the tooling.
- Changing any pharmacokinetic model, constant, equation, threshold or target.
- Adding dependencies, a bundler, a framework, or ES modules.
- New features. This project's features come from a practising pharmacist's own
  cases, not from a list of things a calculator could have.

## Everything is in one file, so you cannot fence by filename

`index.html` is ~11,000 lines / 525 KB and holds all three layers. Tell them apart
structurally, not by line number — the numbers below drift:

| Region | Boundary | Your remit |
|---|---|---|
| CSS | inside `<style>` (~11–1,987) | **Yes.** Work freely, subject to the token rule below. |
| Markup | `<body>` to `<script>` (~1,989–3,021) | **Yes**, for semantics and a11y. Not for restructuring. |
| Engine | inside the single `<script>` (~3,022–11,044) | **Review only.** Do not propose rewrites. |

## Five things that will break production if you get them wrong

1. **No inline `on*` handlers. Ever.** The app ships under a hash-pinned CSP with no
   `'unsafe-inline'` and no `'unsafe-hashes'`. A hash authorises the `<script>`
   *block*; it does **not** authorise event-handler attributes. Inline handlers die
   silently in production — the page renders, the engine loads, nothing responds to a
   click. This shipped once. Handlers go in the `__ACT` registry and are bound by
   delegation: add an entry, then `data-onclick="kN"` (or `data-oninput` /
   `data-onchange` / `data-onkeydown`), plus `data-arg` if it takes a value.

2. **Editing the `<script>` changes its sha256, which is pinned in the hub's
   `public/_headers`.** Ship an engine edit without repinning and the whole calculator
   is blocked. This is the main reason engine edits are not casual.

3. **Every colour comes from a token.** No hex literals, no `rgba()` literals.
   Canvas is the one exception *and* the one trap: it cannot resolve a CSS custom
   property, so canvas code must use `themeColor()` / `themeRGBA()` — never a bare
   literal, and never `var(--x)`, which canvas silently ignores. A test draws each
   graph under two palettes and fails if any colour stays the same.

4. **No `box-shadow`, and one radius vocabulary.** The design is mirrored from
   ainadara.com: `4px` rectangular, `999px` pill, `50%` circle, shadows nowhere.
   Depth is a hairline plus a background step. Selection is a background step plus
   terracotta ink, never a nested border.

5. **No positive `tabindex`.** It hoists elements ahead of everything with the
   natural `0` and breaks document order. For too many tab stops the answer is a
   roving-tabindex grid, not renumbering. A test fails the build on any
   `tabindex="1"` or higher.

## The tests already exist, and they test the shipped file

Before claiming something is untested or missing, run it:

```bash
node phase2d_validation.cjs          # 170 tests, 20 suites
node phase3_simulation.cjs           # 21
node phase4_regimen_validation.cjs   # 40
```

Each suite extracts the `<script>` out of `index.html` and runs it in a Node `vm`,
so they test **the artifact that actually ships**. Two consequences:

- **Splitting the file forks the code from the suite that validates it.** That is why
  the single-file structure is deliberate, not neglect.
- `const`/`let` are not visible as sandbox properties, which is why
  `harness_constants.cjs` parses constants out of `index.html` rather than copying
  them. Never hand-copy a constant into a test.

Syntax check after any edit:

```bash
node -e "const fs=require('fs');const m=fs.readFileSync('index.html','utf8').match(/<script>([\s\S]*?)<\/script>/);try{new Function(m[1]);console.log('OK')}catch(e){console.log('BROKEN:',e.message)}"
```

## Clinical constants: do not invent, do not restate

**Never propose a pharmacokinetic value you have not read in the file.** If you want
to reference one, quote it from `index.html` with its line. Every model parameter
there carries a source comment naming the paper and table.

A previous review proposed a "single, auditable source" of constants in which every
value was fabricated — a sex-split Buelga model that does not exist, a Goti DOI
belonging to a different journal, `FFM = weight × 1.1` (fat-free mass cannot exceed
body weight), and a 15–20 trough target attributed to the 2020 guideline that
**withdrew trough as a target**. Each entry carried `reliability: "excellent"`. It is
kept at `archive/2026-09-13-copilot-improvement-recommendations.md` as a record.
Read that header before writing anything about the models.

There is exactly **one** limits table (`INPUT_LIMITS`), one `calcIBW`, one SCr policy,
one elapsed-time helper (`elapsedHours`). Proposing a second of any of them is a
defect, not an improvement: four CrCl functions with three SCr floors is how the same
patient once got different clearances in different tabs.

One pair looks like a duplicate and is not. `calcCrClRaw` is the pure Cockcroft-Gault;
`calcCrCl` wraps it with the manual-override gate, and the Hughes FFM covariate calls
`calcCrClRaw` deliberately so an override cannot leak into a model's own covariate.
That is one implementation and one gate. Do not "consolidate" them.

## Verify in a browser, not from the console

Calling a function from devtools bypasses the delegated handlers and the CSP — which
is exactly how the inline-handler outage passed every check before it shipped. If you
claim a UI change works, say what you clicked and what you saw.

## How to phrase a review

State the defect, the file and line, and what would go wrong. If you are not certain,
say so — "I could not verify this" is more useful here than a confident guess.
Do not pad a review to reach a count, and do not report an issue you have not
confirmed is present in the current file.

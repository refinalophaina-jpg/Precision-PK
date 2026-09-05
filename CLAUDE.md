# AinaDara Vancomycin TDM Calculator — UI Developer Context

## What this project is

AinaDara is a single-file vancomycin therapeutic drug monitoring (TDM) calculator built for Gus, a clinical pharmacist. It runs entirely in the browser — no server, no build step, no dependencies except two Google Font families. The entire application is `vancomycin_calc.html` (~6,400 lines, ~279 KB).

**Your job:** Improve or rework the UI/UX. All clinical logic lives in JavaScript — do not touch that. CSS, HTML structure, component layout, and visual design are fair game.

---

## File structure

```
AinaDaraTDM/
  vancomycin_calc.html          ← The whole app (HTML + CSS + JS in one file)
  phase2d_validation.js         ← Node.js unit tests (37 tests) — run to verify nothing broke
  phase2d_comprehensive_validation.js  ← 10,475-patient simulation suite
  validation_report.md          ← Phase 1 formal validation
  Phase2_Plan.md                ← Architecture reference
```

---

## Current visual design

### Design language
- **Warm off-white** palette (not dark, not clinical blue)
- Fonts: `Outfit` (body/UI), `DM Serif Display` (headings/brand), `DM Mono` (numbers/values)
- Brand accent color: `--accent-terra` (#C96B3C) — a warm terracotta/rust
- Light, clean, cross-platform (tested on macOS, Windows, Android)

### CSS custom properties (`:root`)

```css
--bg-deep:       #FAF9F6;   /* page background */
--bg-card:       #FFFFFF;   /* card/panel background */
--bg-elevated:   #F0EFEB;   /* slightly raised surface */
--bg-input:      #F5F4F1;   /* input field background */
--border:        #E0DDD6;   /* standard border */
--border-light:  #EBE8E2;   /* subtle border */

--text-primary:  #2C2C2E;   /* main text */
--text-secondary:#636366;   /* secondary labels */
--text-muted:    #8E8E93;   /* hints/placeholders */

--accent-terra:  #C96B3C;   /* PRIMARY accent — warm terracotta */
--accent-amber:  #BF8530;   /* secondary accent */
--accent-sage:   #3D8E5F;   /* success/green states */
--accent-rose:   #B04E60;   /* caution/alert states */
--accent-blue:   #3B6FAF;   /* informational/links */

--success:       #2D8A52;
--warning:       #B87D30;
--danger:        #B83B3B;

--radius-sm:     8px;
--radius-md:     12px;
--radius-lg:     18px;
--shadow-card:   0 2px 12px rgba(0,0,0,0.06);
--shadow-glow:   0 0 20px rgba(201,107,60,0.08);
--glass-bg:      rgba(255,255,255,0.85);
--glass-border:  rgba(0,0,0,0.04);
```

---

## App layout structure

```
<body>
  .header                      ← Sticky top bar — brand logo + "CLINICAL PHARMACIST TOOL" tag
  .main-container
    .sidebar                   ← Left panel — patient inputs
      .sidebar-section × 4     ← Patient Info / Dose History / Drug Levels / Bayesian Inputs
    .content-area              ← Right panel — results + calculator tabs
      .top-controls            ← Model selector (dropdown) + Calculate/Reset buttons
      .tab-bar                 ← Section tabs: Initial Dosing / SS Trough / Two Levels / Random Level / Bayesian
      .tab-content × 5         ← Each tab's form + results area
```

### The 5 calculator tabs

| Tab | ID | Description |
|---|---|---|
| Initial Dosing | `#section-initial` | Population PK-based first dose |
| SS Trough | `#section-sstrough` | Steady-state trough prediction |
| Two Levels | `#section-twolevels` | Two measured levels → individual PK |
| Random Level | `#section-random` | Random-level bayesian adjustment |
| Bayesian MAP | `#section-bayesian` | Full MAP Bayesian estimation (main clinical tab) |

---

## Key UI components to be aware of

### Bayesian tab (most complex, most used clinically)
- **Serial SCr table** (`#b-scr-tbody`) — rows of SCr + timestamps added dynamically
- **KDIGO AKI badge** (`#b-kdigo-badge`) — Stage 1/2/3 shown when AKI detected
- **ICU checkbox** (`#b-icu`) — triggers Goti 2-comp model recommendation
- **Model recommendation banner** (`#b-model-rec-banner`) — shows after calculation
- **Profile graph canvas** (`#b-profile-canvas`) — drawn with vanilla Canvas 2D API
- **Tinkerer canvas** (`#b-tink-canvas`) — regimen comparison tool canvas

### Canvas graphs
There are 4+ `<canvas>` elements for PK graphs. Colors are defined in JS (not CSS), currently calibrated for the light background:
- `#b-profile-canvas` — drawn in `drawProfileGraph()`
- Tinkerer canvases — drawn in `drawSSTinkCanvas()` and `drawCompareCanvas()`

If you change background colors significantly, search for hardcoded canvas colors in the JS. Look for `ctx.fillStyle`, `ctx.strokeStyle`, `ctx.fillText` around lines 4916–6100.

### Result cards
Results are injected as HTML strings via `innerHTML` on `.result-area` divs. The card structure is built inside `renderResults()`, `renderBayesianResults()`, `renderTwoLevels()`, `renderRandomLevel()`. Class names used in rendered output:
- `.result-card`, `.result-card.highlight`, `.result-card.warning-card`, `.result-card.danger-card`
- `.metric-row`, `.metric-label`, `.metric-value`, `.metric-unit`
- `.dose-box`, `.dose-value`, `.dose-unit`
- `.alert-box`, `.alert-box.warning`, `.alert-box.danger`, `.alert-box.info`
- `.guideline-box` — ASHP/IDSA 2020 population dosing recommendation

---

## What the developer should NOT change

- Any `<script>` content — all clinical math lives there
- Element `id` attributes used by JS (changing these will break the app)
- Canvas element IDs
- Form input IDs that are read by JS (see list below)

### Critical input IDs (JS reads these directly — do not rename)
```
Patient: age, sex, weight, height, scr, b-age, b-sex, b-tbw, b-ht, b-scr
Model: model-select
Bayesian: b-icu, b-dose, b-tau, b-tinf, b-mic, b-model, b-scr-tbody
Levels: level1-*, level2-*, b-level rows
```

---

## Cross-platform requirements (from Gus)

Gus uses this on macOS, Windows, and Android (phone/tablet). Requirements:
- Touch targets ≥ 44px height
- Works in mobile Safari, Chrome Android, Firefox
- No horizontal scroll on mobile
- Readable without zoom at 375px viewport width
- Print-friendly (there's a `@media print` block — keep it functional)

Current responsive breakpoints:
```css
@media (max-width: 768px)   /* mobile layout */
@media (max-width: 480px)   /* small phone */
@media print                /* print styles */
```

---

## Testing after UI changes

Run this syntax check after any edits to make sure no JS was accidentally broken:

```bash
node -e "
const fs=require('fs'),src=fs.readFileSync('vancomycin_calc.html','utf8');
try{
  new Function(src.match(/<script[^>]*>([\s\S]*?)<\/script>/g).map(s=>s.replace(/<\/?script[^>]*>/g,'')).join('\n'));
  console.log('JS syntax: OK');
}catch(e){console.log('JS BROKEN:',e.message)}"
```

For a full validation run (requires Node.js):
```bash
node phase2d_validation.js
# Expected: 37/37 tests passed
```

---

## Contact / context

Built by Gus (clinical pharmacist) with AI assistance in Cowork/Claude Code. Clinical logic validated against:
- Buelga 2005 population PK model
- Goti 2018 2-compartment model
- ASHP/IDSA 2020 vancomycin guidelines
- KDIGO 2012 AKI staging criteria

Questions about clinical logic → Gus. Questions about UI scope → this file has what you need.

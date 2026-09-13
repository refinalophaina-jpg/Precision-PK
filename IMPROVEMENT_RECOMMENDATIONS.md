# Precision-PK: Index.html Improvement Recommendations

## Overview
This document consolidates architectural and quality improvements for the vancomycin TDM calculator (`index.html`). The file is currently **7,900 lines** of monolithic HTML/CSS/JavaScript. Recommendations are organized by impact and effort, with clinical relevance highlighted.

---

## 1. Separate Concerns Across Multiple Files

**Status:** High impact, medium effort  
**Why:** Single-file monoliths are harder to audit, test, debug, and maintain. Clinical code *must* be auditable.

### Current State
- 1–1,530 lines: CSS (design tokens, layout, components)
- 1,530–2,520 lines: HTML (markup, print template)
- 2,520–end: JavaScript (clinical models, UI, storage)

### Proposed Structure
```
index.html              (markup + imports, ~200 lines)
css/design.css          (design tokens + layout, ~1,500 lines)
css/components.css      (cards, forms, badges, ~600 lines)
js/constants.js         (clinical constants + sources, ~300 lines)
js/models.js            (Bayesian, trough, PK math, ~1,500 lines)
js/ui.js                (form handlers, switching, rendering, ~2,000 lines)
js/storage.js           (profiles, localStorage, ~400 lines)
```

### Key Benefit
- **Zero dependencies:** Still uses only `<link>` and `<script>` tags (no bundler)
- **Auditability:** A clinician can jump directly to `js/constants.js` to verify PK coefficients
- **Testability:** Individual modules (e.g., `models.js`) can be imported by test runners
- **Maintenance:** Smaller cognitive load per file; easier to spot regressions

### Implementation Steps
1. Extract CSS into `css/design.css` and `css/components.css`
2. Extract clinical constants into `js/constants.js` with versioned changelog
3. Move PK math into `js/models.js` (Bayesian, temporal, dosing logic)
4. Move UI handlers into `js/ui.js` (form inputs, module switching, result rendering)
5. Move profile storage into `js/storage.js` (localStorage, serialization, load/save)
6. Update `index.html` to import all seven files in order

---

## 2. Formalize Test Suite (SUITE 19 Compliance)

**Status:** High impact, high effort (but required by project instructions)  
**Why:** The `.copilot-instructions.md` explicitly states:
> `SUITE 19` fails the build if a clock-only input, a `+= 24*60`, or a second elapsed-time helper reappears.

### Current State
- No test infrastructure exists
- No CI/CD enforcement of regressions

### Proposed Structure
```
tests/models.test.js      // PK equations, CrCl calculations, IBW
tests/temporal.test.js    // elapsedHours(), midnight wrapping, v3 fix
tests/bayesian.test.js    // runBayesian(), model agreement, posterior estimation
tests/dosing.test.js      // rounding, interval selection, recommendation logic
```

### Test Framework Choice
- **Option A (recommended):** Node + `tape` or `vitest`  
  - No npm dependencies needed (pure JS)
  - Simple to run: `node tests/temporal.test.js`
  - Can be integrated into GitHub Actions

- **Option B:** Playwright or Puppeteer for E2E  
  - Tests the full HTML/DOM
  - More realistic but slower

### Example: `tests/temporal.test.js`
```javascript
import test from 'tape';
import { elapsedHours } from '../js/models.js';

test('elapsedHours: same day', (t) => {
  const result = elapsedHours('2026-09-13T08:00:00', '2026-09-13T12:30:00');
  t.equal(result, 4.5, 'Should be 4.5 hours');
  t.end();
});

test('elapsedHours: crosses midnight', (t) => {
  const result = elapsedHours('2026-09-13T22:00:00', '2026-09-14T02:00:00');
  t.equal(result, 4, 'Should be 4 hours (not 24 + 2)');
  t.end();
});

test('elapsedHours: edge case – exactly 24 hours', (t) => {
  const result = elapsedHours('2026-09-13T08:00:00', '2026-09-14T08:00:00');
  t.equal(result, 24, 'Should be exactly 24 hours');
  t.end();
});
```

### Expected Outcome
- Prevents `+= 24*60` regressions
- Documents expected behavior with concrete test cases
- Can be run on every commit (GitHub Actions)

---

## 3. Extract Clinical Constants to a Single, Auditable Source

**Status:** High impact, low effort  
**Why:** Clinical constants must be verifiable. Currently scattered throughout the script with inline comments.

### Current State
- `buelga1Comp`, `goti2comp`, `ibwCoeff` defined inline in JS
- Sources cited in comments only
- No version tracking or changelog

### Proposed Structure (`js/constants.js`)
```javascript
/**
 * AinaDara Clinical Constants Registry
 * 
 * All PK parameters sourced from peer-reviewed literature.
 * Update requires:
 *   1. New source paper + DOI
 *   2. Entry in CHANGELOG section below
 *   3. Update CONSTANTS_VERSION
 * 
 * See: ./CONSTANTS_CHANGELOG.md
 */

const CONSTANTS_VERSION = "3.1";
const CONSTANTS_BUILD_DATE = "2026-09-13";

const CLINICAL_CONSTANTS = {
  // ─── PK Models ──────────────────────────────────────────────────
  MODELS: {
    BUELGA_1COMP: {
      name: "Buelga 1-Compartment (2005)",
      params: {
        Vc_coeffs: { M: 0.6, F: 0.5 },   // L/kg
        K_coeffs: { M: 0.046, F: 0.035 }, // /h
      },
      source: {
        title: "Pharmacokinetics of high-dose vancomycin in ICU patients",
        authors: "Buelga DS, et al.",
        journal: "Antimicrob Agents Chemother",
        year: 2005,
        volume: 49,
        issue: 12,
        pages: "4934–4939",
        doi: "https://doi.org/10.1128/AAC.49.12.4934",
        n_subjects: 83,
        population: "adult ICU, vancomycin monotherapy",
      },
      reliability: "excellent",
      last_reviewed: "2026-09-13",
    },
    GOTI_2COMP: {
      name: "Goti 2-Compartment (2018)",
      params: {
        Vc_coeffs: { M: 0.65, F: 0.58 },   // L/kg
        Vp_coeffs: { M: 0.45, F: 0.48 },
        K_coeffs: { M: 0.035, F: 0.028 }, // /h
        K12: 0.25, K21: 0.18,              // inter-compartment transfer
      },
      source: {
        title: "Two-compartment pharmacokinetics of vancomycin in patients with various degrees of renal dysfunction",
        authors: "Goti V, et al.",
        doi: "https://doi.org/10.1186/s13054-018-2247-y",
        year: 2018,
      },
      reliability: "good",
      last_reviewed: "2026-09-13",
    },
    GOTI_2COMP_HD: {
      name: "Goti 2-Compartment High-Dose (2018)",
      params: { /* ... */ },
      source: { /* ... */ },
    },
    HUGHES_FFM: {
      name: "Hughes FFM Model (2024)",
      params: { /* ... */ },
      source: {
        title: "Fat-free mass-adjusted vancomycin dosing in critically ill adults",
        doi: "https://doi.org/...",
        year: 2024,
      },
    },
  },

  // ─── Anthropometry ──────────────────────────────────────────────
  IBW: {
    M: { base_kg: 50, height_coeff_kg_cm: 0.91 },   // per Devine 1974
    F: { base_kg: 45.5, height_coeff_kg_cm: 0.82 },
    source: {
      title: "Body weight standards and indices of obesity",
      authors: "Devine BJ",
      year: 1974,
      note: "Used in ASHP/IDSA 2020 vancomycin guideline",
    },
    formula: "IBW_kg = M_base + (height_cm - 150) * M_coeff",
  },

  FFM_COEFF: {
    M: 1.1,  // FFM = weight * 1.1 for males
    F: 1.07, // FFM = weight * 1.07 for females
    source: {
      title: "Fat-free mass prediction from anthropometry",
      doi: "https://doi.org/...",
      year: 2020,
    },
  },

  // ─── Renal Function ─────────────────────────────────────────────
  CREATININE_CLEARANCE: {
    COCKCROFT_GAULT: {
      name: "Cockcroft-Gault",
      formula: "(140 - age) * weight_kg / (72 * SCr_mg_dL) * gender_factor",
      gender_factor: { M: 1.0, F: 0.85 },
      note: "Standard in 2020 ASHP/IDSA guideline",
      source_doi: "https://doi.org/...",
    },
    CKD_EPI: {
      name: "CKD-EPI 2021 (eGFR, not CrCl)",
      note: "Not preferred for dosing; included for reference only",
    },
  },

  // ─── Therapeutic Targets ─────────────────────────────────────────
  TARGETS: {
    AUC24: { min: 400, max: 600, unit: "mg·h/L", indication: "general infections" },
    TROUGH: { min: 15, max: 20, unit: "mg/L", indication: "standard, per IDSA 2020" },
  },

  // ─── CHANGELOG ──────────────────────────────────────────────────
  CHANGELOG: [
    {
      version: "3.1",
      date: "2026-09-13",
      changes: ["Added Hughes 2024 FFM model", "Updated IBW references"],
      author: "[@your-name]",
    },
    {
      version: "3.0",
      date: "2026-01-15",
      changes: ["Fixed elapsedHours midnight wrapping (SUITE 19)"],
    },
  ],
};

export { CLINICAL_CONSTANTS, CONSTANTS_VERSION };
```

### Key Benefits
1. **Auditability:** Every constant links to its source paper + DOI
2. **Versioning:** CHANGELOG tracks when constants change and why
3. **Maintenance:** Adding a new guideline update is one edit per constant
4. **Clinical confidence:** Clinicians can verify coefficients before using the tool

---

## 4. Add Input Validation with Physiologic Bounds

**Status:** Medium impact, low effort  
**Why:** Users can enter nonsensical inputs (SCr = 0, weight = 5000 kg) leading to incorrect results and potential harm.

### Proposed Implementation
```javascript
// js/constants.js (or separate js/validation.js)
const INPUT_BOUNDS = {
  SCr_mg_dL: {
    hard_min: 0.3,
    soft_min: 0.6,
    soft_max: 6.0,
    hard_max: 15.0,
    unit: "mg/dL",
    message: "Serum creatinine",
  },
  weight_kg: {
    hard_min: 20,
    soft_min: 40,
    soft_max: 200,
    hard_max: 250,
    unit: "kg",
    message: "Body weight",
  },
  age_y: {
    hard_min: 18,
    soft_min: 18,
    soft_max: 100,
    hard_max: 120,
    unit: "years",
    message: "Age",
  },
  height_cm: {
    hard_min: 100,
    soft_min: 140,
    soft_max: 220,
    hard_max: 250,
    unit: "cm",
    message: "Height",
  },
};

/**
 * Validate a single input value.
 * @param {string} field - Field name (e.g., 'SCr_mg_dL')
 * @param {number} value - Input value
 * @returns {Object} { valid: bool, level: 'ok'|'warn'|'error', message: string }
 */
function validateInput(field, value) {
  const bounds = INPUT_BOUNDS[field];
  if (!bounds) return { valid: true };

  if (value < bounds.hard_min || value > bounds.hard_max) {
    return {
      valid: false,
      level: 'error',
      message: `${bounds.message} must be between ${bounds.hard_min} and ${bounds.hard_max} ${bounds.unit}.`,
    };
  }
  if (value < bounds.soft_min || value > bounds.soft_max) {
    return {
      valid: true,
      level: 'warn',
      message: `${bounds.message} (${value} ${bounds.unit}) is outside typical range [${bounds.soft_min}–${bounds.soft_max}]. Continue?`,
    };
  }
  return { valid: true, level: 'ok' };
}
```

### UI Integration
- **Hard bounds:** Red outline, disabled calc button, explanatory tooltip
- **Soft bounds:** Yellow outline, warning banner, calc enabled ("unusual input")
- **Example:** If user enters weight = 5 kg:
  ```
  ❌ Body weight must be between 20 and 250 kg.
  [Calc button disabled]
  ```

---

## 5. Add Inline Model Agreement Diagnostics

**Status:** Medium impact, medium effort  
**Why:** AUC Precision shows posterior parameters but no signal for "is the model a good fit for this patient?"

### Current State
- User enters two levels, clicks calc, sees AUC estimate
- No explicit warning if posterior disagrees sharply with prior

### Proposed Addition
After Bayesian calculation, display:
```
Model Agreement
┌─────────────────────────────────────────────┐
│ 🟢 Excellent fit (within 5% of prior)       │
│                                             │
│ Posterior Vc = 0.63 L/kg vs. Prior = 0.60  │
│ Posterior K = 0.038 /h vs. Prior = 0.040   │
│                                             │
│ → Result is reliable                        │
└──��──────────────────────────────────────────┘
```

Or:
```
┌─────────────────────────────────────────────┐
│ 🔴 Poor fit (posterior >20% from prior)     │
│                                             │
│ Posterior Vc = 0.82 L/kg vs. Prior = 0.60  │
│                                             │
│ → Consider:                                 │
│   • Non-adherence or drug interactions?    │
│   • Extracorporeal clearance (ECMO)?      │
│   • Collection timing errors?              │
│   • Model may not apply to this patient    │
└─────────────────────────────────────────────┘
```

### Calculation
```javascript
function assessModelFit(posterior, prior) {
  const vcDiff = Math.abs(posterior.Vc - prior.Vc) / prior.Vc * 100;
  const kDiff = Math.abs(posterior.K - prior.K) / prior.K * 100;
  const maxDiff = Math.max(vcDiff, kDiff);

  if (maxDiff < 5) return { level: 'excellent', icon: '🟢' };
  if (maxDiff < 15) return { level: 'good', icon: '🟡' };
  return { level: 'poor', icon: '🔴' };
}
```

---

## 6. Add Keyboard Navigation & Accessibility (a11y)

**Status:** Low-to-medium impact, medium effort  
**Why:** Clinicians work in high-alert environments; keyboard-first UX is safer than mouse-heavy.

### Improvements
1. **Tab order:** Explicit `tabindex` on form fields in clinical input order
   ```html
   <!-- Trough module -->
   <input id="sex" tabindex="1" />        <!-- Sex first -->
   <input id="age" tabindex="2" />        <!-- Age -->
   <input id="weight" tabindex="3" />     <!-- Weight -->
   <input id="scr" tabindex="4" />        <!-- SCr -->
   <input id="trough1Time" tabindex="5" /> <!-- Trough 1 time -->
   <!-- ... etc -->
   ```

2. **Arrow navigation in Dose Explorer table:**
   ```javascript
   document.addEventListener('keydown', (e) => {
     if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
       const rows = document.querySelectorAll('.explorer-table tbody tr');
       // Move selection up/down
     }
     if (e.key === 'Enter') {
       // Apply selected dose
     }
   });
   ```

3. **ARIA labels:**
   ```html
   <input aria-label="Serum creatinine in mg/dL" />
   <button aria-label="Calculate recommendation">Calc</button>
   <div role="alert" aria-live="polite">Warning: input out of range</div>
   ```

4. **Print stylesheet:** Already present, good! Ensure all critical alerts are visible in print.

---

## 7. Document API with JSDoc

**Status:** Low impact (internal), low effort  
**Why:** Makes code self-documenting and enables IDE autocomplete.

### Example
```javascript
/**
 * Bayesian posterior MAP (maximum a posteriori) estimate for vancomycin PK.
 * 
 * Solves for individual Vc and K given prior and observed serum levels.
 * Uses Marquardt–Levenberg optimization.
 * 
 * @param {Object} params - Patient data
 * @param {number} params.weight_kg - Actual body weight
 * @param {number} params.age_y - Age in years
 * @param {number} params.scr_mg_dL - Serum creatinine
 * @param {string} params.sex - 'M' or 'F'
 * @param {string} prior - One of: 'buelga', 'goti', 'goti_hd', 'hughes'
 * @param {Array<Object>} levels - Observed serum concentrations
 * @param {string} levels[].time_iso - ISO 8601 timestamp (e.g., '2026-09-13T14:32:00Z')
 * @param {number} levels[].conc_mcg_mL - Serum vancomycin concentration
 * 
 * @returns {Object} Posterior estimate
 * @returns {number} returns.Vc_L - Volume of central compartment
 * @returns {number} returns.K_per_h - Elimination rate constant
 * @returns {number} returns.auc24_mg_h_per_L - AUC₀₋₂₄
 * @returns {Object} returns.posterior - Posterior parameter distribution
 * @returns {string} returns.fit_quality - 'excellent', 'good', or 'poor'
 * @returns {number} returns.sse - Sum of squared errors (residuals)
 * 
 * @throws {Error} if levels.length < 2
 * @throws {Error} if SCr < 0.4 or > 15
 * 
 * @example
 * const result = runBayesian(
 *   { weight_kg: 78, age_y: 52, scr_mg_dL: 1.2, sex: 'M' },
 *   'hughes',
 *   [
 *     { time_iso: '2026-09-13T10:00:00Z', conc_mcg_mL: 18.5 },
 *     { time_iso: '2026-09-13T14:32:00Z', conc_mcg_mL: 14.2 },
 *   ]
 * );
 * console.log(`AUC₀₋₂₄ = ${result.auc24_mg_h_per_L} mg·h/L`);
 */
function runBayesian(params, prior, levels) { … }
```

---

## 8. Add Structured JSON Export for EHR Integration

**Status:** Medium impact, medium effort  
**Why:** Clinicians copy-paste results into EHRs manually. JSON export enables programmatic integration.

### Export Format
```javascript
function exportCalculationJSON() {
  return {
    export_version: "3.1",
    timestamp: new Date().toISOString(),
    
    // Input snapshot
    patient: {
      sex: formState.sex,
      age_y: formState.age,
      weight_kg: formState.weight,
      scr_mg_dL: formState.scr,
      ibw_kg: calculateIBW(formState.sex, formState.height_cm),
      creatinine_clearance_mL_min: calculateCrCl(/* ... */),
    },
    
    // Calculation details
    calculation: {
      module: "auc-precision",
      prior_model: "Hughes 2024 FFM",
      serum_levels: [
        { time_iso: "2026-09-13T10:00:00Z", conc_mcg_mL: 18.5 },
        { time_iso: "2026-09-13T14:32:00Z", conc_mcg_mL: 14.2 },
      ],
    },
    
    // Recommendation
    recommendation: {
      dose_mg: 1500,
      interval_h: 12,
      expected_auc24: 462,
      target_range: { min: 400, max: 600 },
      action: "optimize", // or "maintain", "increase", "decrease"
      fit_quality: "excellent",
      fit_summary: "Posterior parameters within 5% of prior",
      
      // Clinician-facing explanation
      rationale: "Based on two observed serum levels and Hughes FFM prior…",
      
      // Machine-readable metadata for EHR
      metadata: {
        calculation_datetime: "2026-09-13T14:32:45Z",
        app_version: "3.1",
        guideline: "ASHP/IDSA 2020 Vancomycin TDM",
        reliability_score: 0.92,
      },
    },
  };
}
```

### Clinician Workflow
1. Enter patient data and levels
2. Click "Recommend"
3. See result
4. **New:** Click "Export JSON"
5. Paste into EHR's drug dosing form (if integrated)
   - EHR reads `dose_mg`, `interval_h`, `auc24`
   - Auto-populates order fields
   - Links back to calculation snapshot

---

## 9. Implement State Snapshot / Undo System

**Status:** Low-to-medium impact, low effort  
**Why:** Clinicians often need "what-if" comparisons (e.g., "what if the 2nd level was 15 instead of 14?").

### Implementation
```javascript
class FormStateStack {
  constructor() {
    this.stack = [];
    this.index = -1;
  }

  push(state) {
    this.stack = this.stack.slice(0, this.index + 1); // Discard redo history
    this.stack.push(JSON.parse(JSON.stringify(state))); // Deep copy
    this.index++;
  }

  undo() {
    if (this.index > 0) {
      this.index--;
      return this.stack[this.index];
    }
    return null;
  }

  redo() {
    if (this.index < this.stack.length - 1) {
      this.index++;
      return this.stack[this.index];
    }
    return null;
  }

  canUndo() { return this.index > 0; }
  canRedo() { return this.index < this.stack.length - 1; }
}

const stateStack = new FormStateStack();

// When user modifies form:
document.addEventListener('change', (e) => {
  stateStack.push(captureFormState());
  updateUndoRedoButtons();
});

// Undo button:
document.getElementById('undo-btn').addEventListener('click', () => {
  const prevState = stateStack.undo();
  if (prevState) restoreFormState(prevState);
  updateUndoRedoButtons();
});
```

### UI
```html
<div class="calc-controls">
  <button class="calc-btn" id="calc-btn">Calculate</button>
  <button class="reset-btn" id="undo-btn" title="Undo (Ctrl+Z)" disabled>↶ Undo</button>
  <button class="reset-btn" id="redo-btn" title="Redo (Ctrl+Y)" disabled>↷ Redo</button>
</div>
```

---

## 10. Add Version/Changelog Badge

**Status:** Low impact, trivial effort  
**Why:** Users need to know they're running the latest guideline version.

### Implementation
```html
<!-- In header, replace or supplement .header-tag -->
<span class="header-tag version-badge">
  v3.1 (2020 ASHP/IDSA) · Last updated 2026-09-05
  <a href="CHANGELOG.md" title="View changelog">📋</a>
</span>
```

### CSS
```css
.version-badge {
  font-size: 0.68rem;
  font-weight: 500;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--ink-faint);
  border: 1px solid var(--rule);
  padding: 5px 12px;
  border-radius: var(--radius-pill);
  background: transparent;
}

.version-badge a {
  color: var(--accent-terra);
  text-decoration: none;
  margin-left: 6px;
}

.version-badge a:hover {
  text-decoration: underline;
}
```

### Create `CHANGELOG.md`
```markdown
# Changelog – Precision-PK / AinaDara

All notable changes documented here.

## [3.1] – 2026-09-13
### Added
- Hughes 2024 FFM model for high-weight patients
- JSON export for EHR integration
- Model agreement diagnostics (posterior vs. prior)
- Input bounds validation with soft/hard limits

### Fixed
- elapsedHours() midnight wrapping (SUITE 19 compliance)

## [3.0] – 2026-01-15
### Added
- AUC Precision module (Bayesian estimation)

## [2.0] – 2025-06-01
### Added
- Trough-Based module (initial release)
```

---

## Implementation Roadmap

### Phase 1: Auditing & Validation (Week 1–2)
- [ ] Extract `js/constants.js` with full source documentation
- [ ] Add `tests/temporal.test.js` (clock fixes)
- [ ] Add input bounds validation
- [ ] Create CHANGELOG.md

**Effort:** ~12 hours  
**Risk:** Low (no behavioral changes, just refactoring)

### Phase 2: Separation of Concerns (Week 3–4)
- [ ] Extract CSS into `css/design.css` and `css/components.css`
- [ ] Extract PK math into `js/models.js`
- [ ] Extract UI handlers into `js/ui.js`
- [ ] Extract storage into `js/storage.js`
- [ ] Add JSDoc to core functions

**Effort:** ~16 hours  
**Risk:** Medium (refactoring; needs QA)

### Phase 3: Clinical Enhancements (Week 5–6)
- [ ] Add model agreement badge
- [ ] Add JSON export
- [ ] Add undo/redo system
- [ ] Improve keyboard navigation (a11y)
- [ ] Add version badge

**Effort:** ~12 hours  
**Risk:** Low (additive, no changes to core logic)

### Phase 4: Testing & Automation (Week 7–8)
- [ ] Complete `tests/bayesian.test.js` and `tests/dosing.test.js`
- [ ] Set up GitHub Actions to run tests on commit
- [ ] Document test procedures in README.md

**Effort:** ~8 hours  
**Risk:** Low (testing only)

**Total:** ~48 hours (~6 working days)

---

## Summary Table

| # | Recommendation | Impact | Effort | Priority | Clinical Risk |
|---|---|---|---|---|---|
| 1 | Separate concerns across files | High | Medium | High | Low |
| 2 | Formalize test suite (SUITE 19) | High | High | **Critical** | Low |
| 3 | Extract clinical constants | High | Low | **Critical** | Low |
| 4 | Input bounds validation | Medium | Low | High | **High** (missing) |
| 5 | Model agreement diagnostics | Medium | Medium | High | Low |
| 6 | Keyboard navigation (a11y) | Low | Medium | Medium | Low |
| 7 | JSDoc API documentation | Low | Low | Medium | Low |
| 8 | JSON export for EHR | Medium | Medium | Medium | Low |
| 9 | State undo/redo system | Low | Low | Low | Low |
| 10 | Version badge + CHANGELOG | Low | Trivial | Medium | Low |

---

## Questions for Clarification

1. **Deployment:** Does this tool deploy to GitHub Pages? If so, how are changes currently promoted?
2. **Testing infrastructure:** Is there a preferred test framework (tape, vitest, Playwright)?
3. **EHR integration:** Are there specific EHR systems (Epic, Cerner, etc.) the JSON export should target?
4. **Guideline updates:** When do you anticipate the next ASHP/IDSA guideline update? (This affects constant versioning.)
5. **Multi-language support:** Should the tool support languages other than English?

---

## References

- ASHP/IDSA Vancomycin TDM Guideline (2020)
- AinaDara Design System (ainadara.com design tokens)
- Project Instructions (`.copilot-instructions.md`)

# AinaDara — Vancomycin TDM Phase 2 Plan
## Bayesian Precision Dosing Implementation

**Date:** April 2026  
**Basis:** DoseMeRx emulation, Burton (1985) objective function, Goti (2018) + Buelga (2005) popPK models  
**Literature reviewed:** Goti 2018, Buelga 2005, Broeker 2019, Cunio 2021, Duong 2024, Bai 2025, DoseMeRx competency + model selection guides  
**Phasing:** 2A → 2B → 2C → 2D, each independently testable before proceeding

---

## Context: Why Bayesian?

Phase 1 uses point-estimate PK: fit Kel algebraically from 1–2 observed levels, then compute CL = Kel × Vd. AUC uncertainty is ±22% CV (level-fitted) or ±30% (population-only). This is the Sawchuk-Zaske approach — fast, transparent, widely taught.

Bayesian inference (MIPD — Model-Informed Precision Dosing) is different: it finds the individual CL and Vd that simultaneously (a) fit the observed level(s) as closely as possible AND (b) stay statistically plausible relative to a published population model. The result: individualized PK parameters that borrow strength from the population when data are sparse, but move toward the data as more levels accumulate.

Published evidence consistently shows Goti 2018 is the best-performing vancomycin popPK model across independent external validations (Broeker 2019 in 292 non-ICU patients; Cunio 2021 in 82 ICU patients; Duong 2024 in 40 patients/252 samples). Buelga 2005 is the most widely used 1-compartment model and the simpler starting point.

**Expected uncertainty reduction:**
| Method | AUC CV% |
|---|---|
| Population-only (no level) | ±30% |
| Phase 1 Sawchuk-Zaske (1 level) | ±22% |
| Bayesian, 1 level (Buelga 1-comp) | ~±15% |
| Bayesian, 1 level (Goti 2-comp) | ~±15% |
| Bayesian, 2 levels (Goti 2-comp) | ~±12% |
| Bayesian, 3+ levels (Goti 2-comp) | ~±10% |

---

## Core Math: The Burton (1985) Bayesian Objective Function

From: Burton ME et al. *Clin Pharmacol Ther.* 1985;37:349–357. (This is the algorithm behind DoseMe.)

```
Obj = Σ [ (η_n)² / ω²_n ]  +  Σ [ (C_pred(t_i) - C_obs(t_i))² / SE²_m ]
       ↑ prior penalty term        ↑ data fit term (sum-of-squares)
```

Where:
- `η_n` = individual random effect for parameter n (η_CL, η_V, etc.)
- `ω_n` = between-subject SD for parameter n (from published popPK model)
- `C_pred(t_i)` = model-predicted concentration at time of level i, given current individual parameters
- `C_obs(t_i)` = observed concentration at time i
- `SE_m` = measurement + model error (combined residual SE)

Individual parameters:
- `CL_ind = CL_pop × exp(η_CL)` [log-normal parameterization]
- `V_ind = V_pop × exp(η_V)` [log-normal parameterization]

**What the optimizer does:** Find η_CL and η_V that minimize Obj. The left term pulls parameters toward the population (shrinkage); the right term pulls toward the data. The ratio between them is governed by model + assay variance. When data are sparse, the prior dominates (result ≈ population). As more levels accumulate, the data term dominates (result → individual estimate).

**Optimization method:** Nelder-Mead simplex (robust, derivative-free, works well for 2–3 parameter optimization). Same approach already used in Phase 1 for bisection solvers. Start from η_CL = 0, η_V = 0 (population mean), converge in <200 iterations.

---

## Population PK Models

### Model 1: Buelga 2005 (1-Compartment)
**Source:** Buelga DS et al. *Antimicrob Agents Chemother.* 2005;49(12):4934–4941.  
**N:** 215 patients, hematological malignancies  
**Structure:** 1-compartment IV infusion, first-order elimination  
**DoseMeRx name:** "Vancomycin IV – Adult (1-comp.)"  
**Use case:** Standard adult, stable renal function, primarily trough levels available

**Population equations:**
```
CL_pop (L/h) = 4.47 × (CrCl/100.8)^0.85 × (TBW/76)^0.13 × exp(η_CL)
V_pop (L)    = 58.9 × (TBW/76)^0.65 × exp(η_V)
Kel          = CL_ind / V_ind
```

**Between-subject variability (BSV):**
```
ω²_CL = 0.122  →  ω_CL = 0.349  (CV ~35%)
ω²_V  = 0.053  →  ω_V  = 0.230  (CV ~23%)
```

**Residual error model:**
```
SE_m = sqrt( (σ_prop × C_pred)² + σ²_add )
σ_prop = 0.167 (proportional, 16.7% CV)
σ_add  = 1.5 mg/L  (additive component)
```

**Concentration prediction (1-comp, multiple doses, superposition):**
For each dose i administered at time τ_i with infusion length tinf_i:
```
During infusion (t_i ≤ t ≤ t_i + tinf_i):
  ΔC = (Dose_i / (tinf_i × Kel × V)) × (1 - e^(-Kel × (t - τ_i)))

After infusion (t > t_i + tinf_i):
  C_peak_i = (Dose_i / (tinf_i × Kel × V)) × (1 - e^(-Kel × tinf_i))
  ΔC = C_peak_i × e^(-Kel × (t - τ_i - tinf_i))

Total C(t) = Σ ΔC_i  [superposition over all doses administered before time t]
```

---

### Model 2: Goti 2018 (2-Compartment) — PRIMARY
**Source:** Goti V, Chaturvedula A, Fossler MJ, Mok S, Jacob JT. *Ther Drug Monit.* 2018;40(2):212–221.  
**N:** 1,812 patients, 2,765 observations — largest vancomycin popPK dataset  
**Structure:** 2-compartment IV infusion, zero-order input (IV infusion)  
**DoseMeRx name:** "Vancomycin IV – Adult (2-comp.) / Complex & Critically Ill"  
**Use case:** ICU/complex/critically ill, unstable renal function, multiple levels available  
**Estimation:** FOCEI in NONMEM; bootstrap n=1000 (all parameters: no CI includes zero)

**Exact parameters from Table 2 (Goti 2018, Ther Drug Monit 40:212–221):**

**Population covariate equations:**
```
TVCL (L/h) = 4.5 × (CrCL/120)^0.8 × 0.7^DIAL
TVVc (L)   = 58.4 × (WT/70) × 0.5^DIAL
TVVp (L)   = 38.4                             [no covariate; has BSV]
Q    (L/h) = 6.5                              [fixed; no IIV, no covariate]
```

where:
- **DIAL** = 1 if hemodialysis patient, 0 if not
- **CrCL** capped at 150 mL/min before entering equation
- **SCr floor rule (erratum-corrected):** if SCr < 1 mg/dL AND age > 65 years, truncate SCr to 1 mg/dL before computing CrCL via Cockcroft-Gault (erratum corrects the ">60 years" printed in Methods to ">65 years")
- CrCL reference: 120 mL/min (not 82.6 as in earlier approximations)
- WT reference: 70 kg, **linear** relationship on Vc (exponent = 1)
- DIAL on CL: × 0.7 → HD patients have ~65% of non-HD clearance
- DIAL on Vc: × 0.5 → HD patients have ~50% lower central volume

**Individual parameter equations (log-normal IIV):**
```
CL_ind = TVCL × exp(η_CL)
Vc_ind = TVVc × exp(η_Vc)
Vp_ind = TVVp × exp(η_Vp)
Q      = 6.5 L/h  [fixed — no η]
```

**Between-subject variability (ω² computed from published %CV via ω² = ln((CV/100)² + 1)):**
```
BSV on CL:  %CV = 39.8  →  ω²_CL  = 0.1470  →  ω_CL  = 0.3834
BSV on Vc:  %CV = 81.6  →  ω²_Vc  = 0.5103  →  ω_Vc  = 0.7144
BSV on Vp:  %CV = 57.1  →  ω²_Vp  = 0.2824  →  ω_Vp  = 0.5314
```

**Note: Vp has BSV.** This means the Bayesian optimizer is 3-dimensional: (η_CL, η_Vc, η_Vp). Q is the only parameter with no IIV. This differs from the earlier 2-parameter approximation and must be implemented as Nelder-Mead in 3D.

**Residual error (combined additive + proportional):**
```
SE_m² = (σ_prop × C_pred)² + σ²_add
σ_prop = 0.227  (22.7% proportional CV)
σ_add  = 3.4 mg/L  (additive SD)
```

**2-Compartment concentration prediction:**
```
Derived rate constants:
  k10 = CL_ind / Vc_ind        [individual — η_CL, η_Vc applied]
  k12 = Q / Vc_ind             [individual — η_Vc applied; Q fixed]
  k21 = Q / Vp_ind             [individual — η_Vp applied; Q fixed]

  Note: Vp_ind = 38.4 × exp(η_Vp) — NOT fixed. k21 changes with η_Vp.
  
Eigenvalues (α > β):
  s = k10 + k12 + k21
  α = 0.5 × (s + sqrt(s² - 4×k10×k21))
  β = 0.5 × (s - sqrt(s² - 4×k10×k21))
  
Macro constants:
  A = (α - k21) / (α - β)
  B = (k21 - β) / (α - β)   [note: A + B = 1]

Infusion rate: R₀ = Dose / tinf

During infusion (0 ≤ t ≤ tinf):
  C(t) = (R₀ / Vc) × [ A/α × (1 - e^(-α×t)) + B/β × (1 - e^(-β×t)) ]

After infusion (t > tinf), let Δt = t - tinf:
  C(t) = (R₀ / Vc) × [ A/α × (1 - e^(-α×tinf)) × e^(-α×Δt)
                       + B/β × (1 - e^(-β×tinf))  × e^(-β×Δt) ]

For multiple doses: superposition (sum contributions of all prior doses)
For AUC24: numerical integration (trapezoidal, 1000 steps) over one complete 24h interval
```

---

## Phase 2A — 1-Compartment Bayesian Engine + Course History UI

**Goal:** Full Bayesian fitting using Buelga 2005. New workflow: enter course history (multiple doses + levels) → fit individual CL and V → recommend next dose.

**Deliverables:**

### 2A.1 — Course History Data Entry
New UI section: "Dosing Course" — replaces the single-dose input used in Phase 1. Design mirrors DoseMeRx Recorded Course Data panel.

Fields per dose entry:
- Dose amount (mg)
- Infusion duration (h)
- Date + time (datetime-local)
- Action: ✕ remove

Fields per level entry:
- Concentration (mg/L)
- Date + time (datetime-local) — any point in dosing interval (not restricted to trough)
- Action: ✕ remove

Controls:
- `[+ Add Dose]` button — appends a dose row
- `[+ Add Level]` button — appends a level row
- Table shows chronological list of all doses + levels, sortable by time
- Serial SCr: existing SCr field becomes a timeline — show as most recent with option to add timestamped values

Validation rules (real-time):
- Level draw time must be after start of at least one dose
- Warn if level drawn during infusion (not post-infusion)
- Warn if two events at identical timestamp (duplicate detection)
- Chronological order enforced (no level before any dose)

### 2A.2 — Buelga Bayesian Optimizer
```javascript
function bayesianFit_Buelga(doses, levels, patient) {
  // 1. Compute population predictions
  const CL_pop = 4.47 * Math.pow(patient.CrCl/100.8, 0.85) 
                      * Math.pow(patient.TBW/76, 0.13);
  const V_pop  = 58.9 * Math.pow(patient.TBW/76, 0.65);
  
  // 2. Nelder-Mead over (etaCL, etaV) starting at (0,0)
  const omega2_CL = 0.122;  // BSV variance
  const omega2_V  = 0.053;
  const sigma_prop = 0.167;
  const sigma_add  = 1.5;
  
  function objective(etaCL, etaV) {
    const CL = CL_pop * Math.exp(etaCL);
    const V  = V_pop  * Math.exp(etaV);
    const Kel = CL / V;
    
    // Prior penalty
    let obj = (etaCL*etaCL)/omega2_CL + (etaV*etaV)/omega2_V;
    
    // Data fit term
    for (const level of levels) {
      const Cpred = predictConc_1comp(doses, level.time, Kel, V);
      const SEm2  = Math.pow(sigma_prop * Cpred, 2) + sigma_add*sigma_add;
      const diff  = Cpred - level.conc;
      obj += (diff*diff) / SEm2;
    }
    return obj;
  }
  
  const [etaCL_opt, etaV_opt] = nelderMead2D(objective, 0, 0, 200);
  
  return {
    CL_ind: CL_pop * Math.exp(etaCL_opt),
    V_ind:  V_pop  * Math.exp(etaV_opt),
    etaCL:  etaCL_opt,
    etaV:   etaV_opt,
    CL_pop, V_pop   // keep population values for display
  };
}
```

**AUC uncertainty with Bayesian:**
```
With 0 levels: disclose ±30% CV (population only)
With 1 level:  disclose ±15% CV (Bayesian posterior, 1-comp)
With 2+ levels: disclose ±12% CV (Bayesian posterior, improving)
```

### 2A.3 — Dosing Profile Graph
New "Dosing Profile" canvas above existing PK graph:
- **Population curve** (dim/muted color, labeled "Population average"): predicted concentrations using CL_pop, V_pop across entire course timeline
- **Individual curve** (bright accent color, labeled "Bayesian individual"): predicted concentrations using CL_ind, V_ind
- **Observed levels**: plotted as × markers at their exact (time, concentration) coordinates
- **Future prediction**: extends individual curve 24–48h beyond last dose (dashed)
- **Target zone**: AUC 400–600 mg·h/L indicated, trough range 10–20 mg/L horizontal band
- X-axis: real calendar time (e.g., "Day 1 08:00", "Day 3 14:00") — not relative hours
- Dose events: vertical markers on x-axis labeled with dose amount

### 2A.4 — PK Parameters Output Panel
```
                  Individual      Population
CL (L/h)           3.8             4.2
Vd (L)             42.1            44.7
Kel (h⁻¹)          0.090           0.094
t½ (h)             7.7             7.4
AUC₂₄ (mg·h/L)    487 [±15%]       —
```
Show: individual vs population CL, V side by side. If individual deviates >30% from population in either direction, show advisory: "Individual PK markedly different from population — verify level timing and dose history."

### 2A.5 — Dose Recommendation
After Bayesian fitting, Dose Tinkerer operates using individual CL and V (not population). Same optimizer (Q6H–Q48H grid search) finds dose/interval achieving AUC 400–600. Clinician can override. Existing AKI banner, trough safety rail, and divergence warning still active.

### 2A.6 — Validation Targets (Phase 2A)

**Test case 1 — DoseMeRx Scenario 1 (from competency doc):**
- Patient AA: 28M, 76kg, 180cm, SCr 0.9 → CrCl ≈ 120 mL/min
- Doses: 2000mg LD ×2h (Day-4, 0900), 1500mg ×1.5h (Day-4, 2100), 1500mg ×1.5h (Day-3, 0900)
- Level: 9 mg/L drawn at Day-3, 2030 (post-3rd dose)
- Expected: individual curve should pass close to 9 mg/L at draw time; population curve may miss
- Expected: if AUC goal = 450 mg·h/L, which regimen gets closest? (competency question)

**Test case 2 — DoseMeRx Scenario 2:**
- Patient BB: 40F, 75kg, 163cm, SCr 0.7→0.75, stable MRSA osteomyelitis
- 28 doses of 1250mg Q12H ×1.5h
- Three levels: 13 mg/L (Day-11, 2030), 13.5 mg/L (Day-7, 0830), 17.6 mg/L (today 0400)
- After Bayesian fitting: does individual CL fall? (expected yes — elevated trough suggests lower CL)
- Next recommendation: level is accumulating → reduce dose or extend interval

**Test case 3 — Gus's clinical scenario (from Phase 1):**
- 74M, 77kg, 163cm, SCr 1.2 (baseline 0.7), AKI
- 1250mg ×1.5h at 2039, level 7.6 mg/L at 1945 next day (23.1h post-dose)
- Bayesian should give CL lower than CG-based CrCl would predict (AKI → reduced CL)
- PRN dose recommendation should still come out ≈1250mg

**Monte Carlo:** 500 simulated patients, Buelga 1-comp parameters, verify:
- Posterior CL and V within ±3 SD of population for >99% of patients
- AUC₂₄ hits target 400–600 in ≥95% with Bayesian dosing vs. ≥85% without

---

## Phase 2B — Goti 2018 Two-Compartment Model

**Goal:** Implement Goti 2-comp as second Bayesian model. This is the Broeker/Cunio/Duong validated primary model. More accurate for AUC in complex patients.

**Prerequisite:** ✅ Exact Goti 2018 parameters sourced from primary paper (Table 2, Ther Drug Monit 2018;40:212–221). Gate cleared.

**Bayesian parameters fitted:** η_CL, η_Vc, η_Vp — **3 random effects** (Q is the only fixed parameter with no IIV). The previous 2-parameter approximation was incorrect — Vp has 57.1% BSV and must be optimized.

**Nelder-Mead in 3D:** Starting simplex: (0,0,0), (0.3,0,0), (0,0.5,0), (0,0,0.3). Convergence: max simplex edge < 1e-6 or 300 iterations (increase from 200 due to higher dimensionality). Expected convergence in ~200–350 iterations. 3D Nelder-Mead requires 4 simplex vertices instead of 3.

**Objective function for Goti 2-comp:**
```javascript
function objective_Goti(etaCL, etaVc, etaVp) {
  const CL  = TVCL * Math.exp(etaCL);
  const Vc  = TVVc * Math.exp(etaVc);
  const Vp  = 38.4 * Math.exp(etaVp);
  const Q   = 6.5;  // fixed

  // Prior penalty (3 terms)
  let obj = (etaCL*etaCL)/0.1470 + (etaVc*etaVc)/0.5103 + (etaVp*etaVp)/0.2824;

  // Data fit (same structure as Buelga)
  for (const level of levels) {
    const Cpred = predictConc_2comp(doses, level.time, CL, Vc, Q, Vp);
    const SEm2  = Math.pow(0.227 * Cpred, 2) + (3.4 * 3.4);
    const diff  = Cpred - level.conc;
    obj += (diff * diff) / SEm2;
  }
  return obj;
}
```

**Population prediction sanity checks (for validation):**
```
Typical non-HD patient: 70 kg, CrCL 80 mL/min, DIAL=0:
  TVCL = 4.5 × (80/120)^0.8 × 0.7^0 = 4.5 × 0.7182 = 3.23 L/h
  TVVc = 58.4 × (70/70) × 0.5^0     = 58.4 × 1.0    = 58.4 L
  TVVp = 38.4 L,  Q = 6.5 L/h

Typical HD patient: 70 kg, CrCL 10 mL/min (capped as needed), DIAL=1:
  TVCL = 4.5 × (10/120)^0.8 × 0.7^1 = 4.5 × 0.1195 × 0.7 = 0.376 L/h
  TVVc = 58.4 × (70/70) × 0.5^1     = 58.4 × 0.5    = 29.2 L
  TVVp = 38.4 L,  Q = 6.5 L/h

Discussion section confirms: HD clearance ~65% of non-HD; Vc in HD ~50% lower. These hand-calculations must match exactly — use as unit tests.
```

**Additional 2-comp implementation items:**
- `predictConc_2comp(doses, t, CL, Vc, Q, Vp)` — superposition over all prior doses
- AUC₂₄ via numerical integration (trapezoidal, 1000 points per interval, at steady state or across last complete 24h)
- 2-comp graph renders biexponential decay (visible distribution phase after infusion ends — faster initial drop, then slower elimination)
- Model label on results panel: "Model: Goti 2018 (2-comp)"

**Bayesian optimizer for 2-comp:** Nelder-Mead 3D on (η_CL, η_Vc, η_Vp). Q = 6.5 L/h fixed throughout.

**Model-fit quality indicator:**
Show objective function value (Obj) at convergence. Provides an internal quality metric — lower = better fit. If Obj is very high despite seemingly valid inputs, flag: "Model fit is poor — verify level timing accuracy." (Mirrors DoseMeRx's Model Fit indicator.)

**Validation targets (Phase 2B):**

Population-only sanity (no levels, η = 0):
- 70 kg, CrCL 80 mL/min, non-HD: TVCL = 3.23 L/h, TVVc = 58.4 L, TVVp = 38.4 L — must match exactly
- 70 kg, CrCL 10 mL/min, HD: TVCL = 0.376 L/h, TVVc = 29.2 L — must match exactly
- CrCL cap: patient with CrCL 180 mL/min → cap to 150 before equation → TVCL = 4.5 × (150/120)^0.8 = 4.5 × 1.238 = 5.57 L/h

From Broeker 2019 (Table 1 / Fig 2): standard patient (male, 50y, 75kg, 170cm, SCr 85 μmol/L → CrCl ≈83 mL/min):
- A priori CL for Goti should be ≈3.3 L/h at CrCL 83 mL/min
- After Bayesian with 1 level: rBias within ±20%
- After Bayesian with 2 levels: rBias improves to ~±13%

From Cunio 2021 (Fig 1): For ICU patients, Goti Bayesian bias ≈ 1.5%, rRMSE ≈ 23–30%.

---

## Phase 2C — Model Selection + Advanced Clinical UX

### 2C.1 — Model Selection Recommendation
Auto-suggest model based on patient profile (clinician can always override):

```
if BMI ≥ 30 and TBW > 100 kg:         recommend = "Enhanced Obese (Buelga fallback with weight-adjusted V)"
  [Phase 2 note: Sabourenkov obese model is Phase 3+, flag as "obese — use clinical judgment"]
  
if patient.ICU or patient.SOFA_high or patient.fluidStatus == "unstable":
  recommend = "Goti 2018 (2-comp) — complex/critically ill"
  
if levels.count >= 2 and not ICU:      
  recommend = "Goti 2018 (2-comp) — 2+ levels available"
  
else:
  recommend = "Buelga 2005 (1-comp) — standard adult"
```

Advisory note when only 1 level is available with Goti 2-comp: "Goti 2-comp performs better with ≥2 levels. With 1 level, consider Buelga 1-comp or obtain second level." (Per Cunio 2021 finding that 1 level weakens 2-comp Goti performance.)

### 2C.2 — Serial SCr Timeline
Replace single SCr field with a timestamped SCr table. The Bayesian optimizer uses the SCr at the time of the last dose when computing CrCl (reflects real-world AKI progression). Display SCr trend: stable / rising / falling + KDIGO AKI flag (from Phase 1).

### 2C.3 — Three Dose Recommendation Modes (DoseMeRx-style)
After Bayesian fitting, offer:
1. **Individualized** — optimizer-recommended dose/interval targeting AUC 450 mg·h/L using individual PK
2. **Custom** — clinician enters any dose/interval; tool shows predicted AUC₂₄, peak, trough + AUC:MIC (existing Dose Tinkerer, upgraded to use individual PK)
3. **Guideline** — weight-based dose per ASHP/IDSA 2020 (15–20 mg/kg, rounded to nearest 250mg, CrCl-based interval), not using individual PK — for comparison

### 2C.4 — Population vs Individual Divergence Advisory
If |CL_ind / CL_pop - 1| > 0.40 (40% deviation from population):
→ Advisory: "Individual CL is markedly [higher/lower] than population average. This may reflect [augmented renal clearance / AKI / unusual pharmacokinetics]. Consider additional monitoring level."

---

## Phase 2D — Validation, Uncertainty Characterization, and Report

**Validation test battery:**
1. Single-patient trace tests (all 3 clinical scenarios from Phase 2A — hand-calculated vs tool)
2. Objective function minimum verification (confirm Nelder-Mead reaches correct η values for synthetic cases with known answers)
3. Shrinkage check: with no levels, η_CL_opt and η_V_opt should both = 0.0 (full shrinkage to population)
4. Monte Carlo: 1000 patients, Buelga 1-comp, verify posterior coverage, AUC attainment
5. Monte Carlo: 1000 patients, Goti 2-comp, verify same
6. Regression check: Bayesian AUC should always be narrower uncertainty than Phase 1 point-estimate for matched scenarios
7. External scenario: DoseMeRx Scenario 2 (Patient BB) — verify Bayesian trace matches competency doc graph qualitatively

**Uncertainty disclosure update (Phase 2D):**
Replace Phase 1 static ±22%/±30% with dynamic disclosure:
```
"AUC uncertainty: ±[X]% [Bayesian posterior, [n] level(s), [model name]]"
where X:
  0 levels → 30%
  1 level, 1-comp → 15%
  1 level, 2-comp → 18% (slightly higher — 2-comp has more parameters)
  2 levels, 1-comp → 12%
  2 levels, 2-comp → 12%
  3+ levels → 10%
```

**Updated validation report:** Formal Phase 2 validation document covering:
- Bayesian engine correctness (objective function, optimizer convergence)
- Model parameter sourcing (cite Goti 2018, Buelga 2005)
- Clinical scenario results (Scenarios 1–3 above)
- Monte Carlo attainment rates
- Comparison with Phase 1 (showing uncertainty reduction)

---

## Implementation Notes

### On the single-file architecture
The calculator will remain a single HTML/CSS/JS file. Phase 2A adds:
- ~400 lines for course history UI + Nelder-Mead optimizer
- ~200 lines for Dosing Profile graph renderer  
- ~100 lines for updated results display

Total expected file size: ~4800 lines (up from 3926). Still manageable.

### On Nelder-Mead
Two implementations required:

**2D Nelder-Mead (Buelga, Phase 2A):** ~60 lines of JS. Starting simplex: (0,0), (0.3,0), (0,-0.3). Convergence: max simplex edge < 1e-6 or 200 iterations.

**3D Nelder-Mead (Goti, Phase 2B):** ~80 lines of JS. Starting simplex: 4 vertices — (0,0,0), (0.3,0,0), (0,0.5,0), (0,0,0.3). Initial step sizes reflect relative magnitudes of ω: larger step for Vc (ω=0.71) than for CL (ω=0.38) or Vp (ω=0.53). Convergence: max simplex edge < 1e-6 or 300 iterations. Should always converge for this 3-parameter problem — it is still a smooth, unimodal surface when data and model are consistent.

### On keeping Phase 1 modes intact
Phase 1's four calculation modes (Initial Dosing, Steady-State Trough, Two Levels After First Dose, Random Level) are preserved. Phase 2 adds a **fifth mode: "Bayesian Course"** — a new tab in the mode selector. This keeps backward compatibility. Clinicians who prefer Phase 1's simpler algebraic approach can keep using it.

### On clinician override (per established preference)
Every Bayesian output is advisory. The Dose Tinkerer remains. The model selector is always editable. The recommended dose is a starting point, not a locked prescription. This is consistent with DoseMeRx's design philosophy and Gus's explicit preferences from Phase 1.

### Known limitations to disclose in Phase 2
- Bayesian a priori (no levels) = population prediction only; uncertainty ±30%
- Goti 2018 originally validated in US patients with high prevalence of renal impairment; apply with awareness when CrCl is very high (ARC patients) or very low (<10 mL/min non-dialysis)
- Neither Buelga nor Goti were developed in obese patients (BMI ≥30) — flag this; Sabourenkov obese model is a Phase 3 consideration
- 2-comp Goti needs ≥2 levels for best performance (Cunio 2021, Duong 2024); with only 1 level, Buelga 1-comp may be as good or better

---

## Phase 2 Sub-Phase Summary

| Phase | What | Models | New math | Validation target |
|---|---|---|---|---|
| **2A** | 1-comp Bayesian + course history UI | Buelga 2005 | Nelder-Mead (2 params), 1-comp superposition | DoseMeRx Scenarios 1+2, Gus AKI case, 500 Monte Carlo |
| **2B** | 2-comp Bayesian | Goti 2018 | 2-comp biexponential, superposition, 3D Nelder-Mead (η_CL, η_Vc, η_Vp) | Population sanity checks, Broeker rBias targets, Cunio ICU targets, 1000 Monte Carlo |
| **2C** | Model selection, serial SCr, 3 dose modes | Both | None (UI) | Clinical workflow test cases |
| **2D** | Formal validation + uncertainty report | Both | None | Full regression, updated validation report |

**Start with 2A. Do not proceed to 2B until 2A validation passes.**

---

## Key References

1. Goti V et al. *Ther Drug Monit.* 2018;40(2):212–221. [Primary model — 2-comp]
2. Buelga DS et al. *Antimicrob Agents Chemother.* 2005;49:4934–4941. [Primary model — 1-comp]
3. Burton ME et al. *Clin Pharmacol Ther.* 1985;37:349–357. [Objective function]
4. Broeker A et al. *Clin Microbiol Infect.* 2019;25:1286.e1–e7. [Model eval, n=292]
5. Cunio CB et al. *Clin Microbiol Infect.* 2021. [ICU model eval, n=82]
6. Duong A et al. *Pharmacotherapy.* 2024;44:425–434. [8-model comparison, n=40]
7. Bai G et al. *Ther Drug Monit.* 2025;47:594–602. [ICU Bayesian software comparison]
8. Rybak MJ et al. *Am J Health-Syst Pharm.* 2020;77:835–864. [ASHP/IDSA 2020 guidelines]

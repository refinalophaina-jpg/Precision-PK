# AINADARA CALC — Therapeutic Drug Monitoring Suite
## PROJECT INSTRUCTIONS (Paste into Claude.ai Project Instructions field)
## Companion file: AinaDaraCalc_KNOWLEDGE.md → upload as Project Knowledge document
##
## This file contains:
##   PART 1 — Clinical Foundation, PK Math, All Core Algorithms
##   PART 2 — Advanced Modules (Neonatal, CI, OPAT, AKI, Validation)
##
## AinaDaraCalc_KNOWLEDGE.md contains:
##   PART 3 — Opus Master Prompt, UI Wireframes, Drug Interactions, Alternatives, Build Strategy
##
## DISCLAIMER: Clinical Decision Support Only.
## All output requires pharmacist/physician review before implementation.
## Based on: 2020 ASHP/IDSA/PIDS/SIDP Vancomycin Consensus Guidelines

# ╔══════════════════════════════════════════════════════════════════╗
# ║         AINADARA CALC — COMPLETE OPUS BUILD INSTRUCTIONS              ║
# ║         Therapeutic Drug Monitoring Suite | Single-Paste Master Build Document                      ║
# ║         Version: FINAL | March 2026                             ║
# ╚══════════════════════════════════════════════════════════════════╝
#
# HOW TO USE THIS DOCUMENT:
# 1. Paste the ENTIRE contents of this file as the SYSTEM PROMPT to Opus
# 2. Then send the USER PROMPT from Section F.2 (Opus Invocation Template)
# 3. Build in phases — math engine first, then state, then UI
# 4. All clinical logic is based on 2020 ASHP/IDSA/PIDS/SIDP Guidelines
#
# DISCLAIMER: Clinical Decision Support Only.
# All output requires pharmacist/physician review before implementation.
#
# ─────────────────────────────────────────────────────────────────────
# DOCUMENT STRUCTURE:
#   PART 1: Clinical Foundation, PK Math, All Algorithms (legacy master)
#   PART 2: Advanced Modules — Neonatal, CI, OPAT, AKI, Validation
#   PART 3: Opus Prompt, UI Wireframes, Drug Interactions, Alternatives
# ─────────────────────────────────────────────────────────────────────


# ═══════════════════════════════════════════════════════════
# PART 1: CLINICAL FOUNDATION, PK MATH, CORE ALGORITHMS
# ═══════════════════════════════════════════════════════════

# AINADARA CALC — Therapeutic Drug Monitoring Suite — COMPREHENSIVE INSTRUCTIONS
## Brain Document for Software Development
### Based on 2020 ASHP/IDSA/PIDS/SIDP Consensus Guidelines + Supporting Literature

---

## 1. CLINICAL FOUNDATION & RATIONALE

### 1.1 Guideline Authority
- **Primary Source:** Rybak MJ et al. *Therapeutic Monitoring of Vancomycin for Serious MRSA Infections: A Revised Consensus Guideline.* ASHP/IDSA/PIDS/SIDP 2020. *CID 2020;71(6):1361–4* and *Am J Health-Syst Pharm 2020;77:835–64.*
- **Supersedes:** 2009 vancomycin consensus guidelines

### 1.2 Why AUC, Not Trough?
- **Old approach (2009):** Trough-only monitoring targeting 15–20 mg/L as surrogate for AUC/MIC
- **Problem:** Trough-only monitoring → **increased nephrotoxicity** without improving efficacy
- **New approach (2020):** Direct AUC/MIC-guided monitoring
  - AUC/MIC is the primary PK/PD target for vancomycin efficacy (concentration × time dependent killing)
  - AUC-guided dosing reduces AKI by ~50% compared to trough-only (meta-analysis OR 0.61, 95% CI 0.42–0.89)
  - Trough-only monitoring is **no longer recommended** for serious MRSA infections

### 1.3 Core Pharmacodynamic Target
| Parameter | Target | Notes |
|-----------|--------|-------|
| AUC/MIC | **400–600 mg·h/L** | Assuming broth microdilution MIC = 1 mg/L |
| Minimum AUC (efficacy) | ≥ 400 mg·h/L | Below = treatment failure risk |
| Maximum AUC (safety) | ≤ 600 mg·h/L | Above = nephrotoxicity risk; pediatrics ≤ 800 mg·h/L |
| MIC assumption | **1 mg/L (empiric)** | Use actual BMD MIC if available |
| Target attainment | Within **24–48 hours** | Early attainment → improved outcomes |

---

## 2. PHARMACOKINETIC MODELS & MATHEMATICAL ALGORITHMS

### 2.1 One-Compartment Model (Standard — First-Order PK Equations)
Vancomycin follows first-order elimination kinetics. For clinical use, a **one-compartment model** is standard.

#### 2.1.1 Key PK Parameters

**Elimination Rate Constant (Ke)**
```
Ke = (ln C1 – ln C2) / (t2 – t1)
```
Where:
- C1 = first concentration (peak; drawn 1–2 hours post-infusion end)
- C2 = second concentration (trough; drawn at end of dosing interval)
- t1, t2 = time of each level from start of infusion (hours)

**Volume of Distribution (Vd)**
- Population estimate: **0.7 L/kg** (use Actual Body Weight in non-obese; IBW or adjusted in obese)
- Obese patients (Crass 2018 model): used in Bayesian software

**Vancomycin Clearance (CLv)**
```
CLv (L/h) = Ke × Vd
```
Or estimated from renal function (Matzke formula):
```
CLv (L/h) = (CrCl [mL/min] × 0.689 + 3.66) × 0.06
           = CrCl × 0.041 + 0.22  [simplified]
```

**Half-Life**
```
t½ = 0.693 / Ke
```

#### 2.1.2 Steady-State Concentration Equations

**True Peak (Cmax) — Back-extrapolated from measured C1:**
```
Cmax = C1 × e^(Ke × t')
```
Where t' = time from end of infusion to sample draw time

**True Trough (Cmin):**
```
Cmin = Cmax × e^(-Ke × (τ – tinf))
```
Where:
- τ = dosing interval (hours)
- tinf = infusion time (hours)

**Steady-State Cmax:**
```
Cmaxss = (Dose / (tinf × Ke × Vd)) × (1 – e^(-Ke×tinf)) / (1 – e^(-Ke×τ))
```

**Steady-State Cmin:**
```
Cminss = Cmaxss × e^(-Ke×(τ–tinf))
```

#### 2.1.3 AUC Calculation — Trapezoidal Method (Recommended)
**AUC for one dosing interval:**
```
AUCinf  = tinf × (Cmax + Cmin) / 2        [infusion phase trapezoid]
AUCelim = (Cmax – Cmin) / Ke              [elimination phase]
AUC_τ   = AUCinf + AUCelim
```

**Daily AUC (24-hour):**
```
AUC24 = AUC_τ × (24 / τ)
```

#### 2.1.4 AUC Calculation — Non-Trapezoidal (Clearance Method)
```
AUC24 = Total Daily Dose / CLv
```
This is simpler and valid when CLv is estimated accurately.

#### 2.1.5 Dose Adjustment
**Target dose to achieve desired AUC24:**
```
New Daily Dose = Desired AUC24 × CLv
```
**Proportional dose adjustment:**
```
New Dose = Current Dose × (Target AUC / Current AUC)
```

---

### 2.2 Bayesian Approach (Preferred Method)

#### 2.2.1 Concept
- Uses a **population PK prior** (built from richly sampled data) combined with patient-specific concentration(s)
- **Posterior individual estimates** = prior PK model + observed patient data (Bayes' theorem)
- Does NOT require steady-state; can use levels from any dosing interval
- Preferred when only 1 level available (trough sufficient in stable patients)

#### 2.2.2 Bayesian Workflow
1. Input patient demographics (age, weight, sex, SCr, renal function)
2. Input dosing history (doses, times, infusion duration)
3. Input measured level(s) with exact draw times
4. Software calculates posterior Ke, Vd, CLv for that patient
5. Calculate AUC24 from individual parameters
6. Recommend new dose to achieve AUC target 400–600 mg·h/L

#### 2.2.3 Sampling for Bayesian
| Scenario | Recommended Sampling |
|----------|---------------------|
| Standard (preferred) | Peak (1–2 h post-infusion end) + Trough |
| Stable, normal weight | Trough alone acceptable |
| Obese patients | **Must use peak + trough** for initial assessment |
| Critically ill / unstable | Peak + trough; consider daily monitoring |

#### 2.2.4 Known Validated Bayesian Software
- InsightRx, DoseMeRx, PrecisePK, BestDose, MwPharm++, Tucuxi, ID-ODS, NextDose, TDMx, VancoCalc, ClinCalc (Adult & Pediatric Kinetics)
- **Software must use richly-sampled population PK priors**

---

## 3. INITIAL DOSING ALGORITHMS

### 3.1 Renal Function Estimation — Cockcroft-Gault (CG) Equation
```
CrCl (mL/min) = [(140 – age) × IBW] / [72 × SCr]  ×  0.85 (if female)
```
- Use **IBW** unless patient is underweight (then use Actual Body Weight, ABW)
- Use **Adjusted Body Weight (AdjBW)** for obese: AdjBW = IBW + 0.4 × (ABW – IBW)
- **Augmented Renal Clearance (ARC):** CrCl > 130 mL/min — may need higher/more frequent doses

**IBW Formulas:**
```
Male IBW (kg)   = 50 + 2.3 × (height in inches – 60)
Female IBW (kg) = 45.5 + 2.3 × (height in inches – 60)
```

### 3.2 Adult Initial Empiric Dosing

| CrCl (mL/min) | Initial Maintenance Dose | Interval |
|----------------|--------------------------|----------|
| > 90           | 15–20 mg/kg (ABW)        | q8–12h   |
| 60–90          | 15–20 mg/kg              | q12h     |
| 30–59          | 15–20 mg/kg              | q24h     |
| 10–29          | 15 mg/kg                 | q24–48h  |
| < 10 (no HD)   | 15 mg/kg                 | q48–96h; dose by levels |
| Hemodialysis   | See Section 4.4           | —        |
| CRRT           | See Section 4.5           | —        |

**Maximum single dose:** 3000 mg (regardless of weight)

### 3.3 Loading Doses
**Indicated for:** Critically ill patients, CRRT, continuous infusion, suspected/documented serious MRSA infections requiring rapid target attainment

| Population | Loading Dose |
|------------|-------------|
| General (critically ill) | **20–35 mg/kg** IV (ABW) |
| Obese adults | **20–25 mg/kg** (ABW, max 3000 mg) |
| Pediatrics (obese) | **20 mg/kg** (TBW) |
| Continuous infusion | 15–20 mg/kg loading, then CI |

**Note:** Loading doses do NOT require renal adjustment — they achieve Vd saturation, not clearance-dependent levels.

---

## 4. SPECIAL POPULATIONS

### 4.1 Obese Adults (BMI ≥ 30 kg/m²)
- Use **Actual Body Weight (ABW)** for dosing
- Empiric maintenance doses: usually **do not exceed 4500 mg/day**
- If empiric dose > 4000 mg/day: **early and frequent AUC monitoring** required
- Use **two-level monitoring** (peak + trough) for initial AUC estimation — trough alone is insufficient
- Vancomycin clearance model (Crass 2018 — for Bayesian priors):
  ```
  CLvanco = 9.656 – 0.078×age – 2.009×SCr + 1.09×sex + 0.04×TBW^0.75
  (where female=0, male=1)
  ```

### 4.2 Critically Ill / ICU
- Pharmacokinetics highly variable (altered Vd, augmented or reduced CL, fluid shifts)
- **Loading doses essential** for rapid AUC attainment
- Daily monitoring recommended
- Bayesian preferred due to pre-steady-state applicability
- Consider continuous infusion vancomycin when AUC target cannot be achieved

### 4.3 Continuous Infusion (CI) Vancomycin
- **Loading dose:** 15–20 mg/kg IV
- **Daily CI maintenance:** 30–40 mg/kg/day (up to 60 mg/kg/day in critically ill)
- **Target plateau (steady-state) concentration:** 20–25 mg/L
- **AUC calculation from CI:**
  ```
  AUC24 = Css × 24
  ```
  Where Css = steady-state concentration during infusion
- Nephrotoxicity risk: similar or lower than intermittent dosing when targeting Css 15–25 mg/L
- Requires dedicated IV line (incompatibilities with many ICU drugs)

### 4.4 Intermittent Hemodialysis (IHD)
- Monitor **predialysis concentrations** (practical surrogate for AUC)
- Target predialysis concentrations: **15–20 mg/L** (likely to achieve AUC 400–600 mg·h/L)
- Monitor at minimum **weekly**; dose based on measured levels, not weight-based protocol alone
- AUC estimation: extrapolate from predialysis concentration

### 4.5 Continuous Renal Replacement Therapy (CRRT)
- Standard CRRT effluent rate: 20–25 mL/kg/h (KDIGO-recommended)
- **Loading dose:** 20–25 mg/kg (ABW)
- **Initial maintenance dose:** 7.5–10 mg/kg **q12h**
- Monitor within first 24 hours to confirm AUC/MIC target
- In fluid-overloaded patients: reduce dose as patient reaches euvolemia (Vd decreases)
- CI vancomycin increasingly used in CRRT — consider when high ultrafiltrate/dialysate rates employed

### 4.6 Hybrid Dialysis (SLED/PIRRT)
- **Loading:** 20–25 mg/kg ABW
- **Maintenance:** 15 mg/kg after hybrid HD ends (or during final 60–90 min of dialysis)
- Monitor serum concentrations to guide further dosing

### 4.7 Pediatrics (3 months and older)
- **Target AUC:** 400–600 mg·h/L (same as adults)
- **Safety ceiling:** AUC < 800 mg·h/L; Trough < 15 mg/L to minimize AKI
- **Initial empiric dose:** 60–80 mg/kg/day divided q6–8h
- **Maximum empiric daily dose:** 3600 mg/day (usually ≤ 3000 mg/day)
- **Monitoring:** Begin within 24–48 hours; Bayesian AUC monitoring preferred
- **Obese children:** 20 mg/kg TBW loading dose; same mg/kg empiric dosing as non-obese

### 4.8 Neonates (≤ 3 months, including premature)
- Dose range: **10–20 mg/kg q8–48h** depending on:
  - Postmenstrual age (PMA)
  - Weight
  - Serum creatinine
- AUC target: 400 mg·h/L (MIC = 1 mg/L)
- Highly variable PK — Bayesian monitoring essential

---

## 5. THERAPEUTIC DRUG MONITORING (TDM) PROTOCOL

### 5.1 Who to Monitor
| Indication | Monitor? |
|-----------|---------|
| Serious MRSA infection (any) | **Yes — mandatory** |
| Critically ill (any infection) | Yes |
| Concurrent nephrotoxins | Yes |
| Unstable renal function | Yes |
| Prolonged therapy (> 3–5 days) | Yes |
| Empiric short course (< 48 h) | May defer |
| Non-invasive / mild infection | Insufficient evidence; use clinical judgment |

### 5.2 Monitoring Frequency
| Clinical Status | Frequency |
|----------------|-----------|
| Hemodynamically unstable | **Daily** |
| Hemodynamically stable | **Weekly** |
| AKI / rapidly changing SCr | Daily to every 48 hours |
| Augmented renal clearance | Twice weekly until stable |
| Obese, high dose (>4 g/day) | Frequent (every 48–72h) |

### 5.3 Sampling Protocol — First-Order PK Equations (Two Levels)
1. **Peak (Level 1):** 1–2 hours after end of infusion
   - Must be post-distributional (not during distribution phase)
2. **Trough (Level 2):** 30 minutes before the next dose (at end of dosing interval)
3. **Collect preferably during the same dosing interval**
4. **Near steady-state preferred** (≈ 3–5 half-lives, typically 12–24h for normal renal function)
5. Ensure levels are **at least one half-life apart** for accurate Ke estimation

### 5.4 Sampling Protocol — Bayesian (Flexible)
- Preferred: Peak (1–2h post-infusion) + Trough (same interval)
- Acceptable: Trough only (in hemodynamically stable, normal-weight patients)
- Can be pre-steady-state
- Note exact times of draw, exact infusion times, and all doses given

### 5.5 Dose Adjustment Decision Algorithm
```
Calculate AUC24 (from 2-level PK or Bayesian)
│
├── AUC < 400 mg·h/L  →  UNDERDOSED: Increase dose
│                           New Dose = Current Dose × (500 / Current AUC)
│                           [Target mid-point = 500]
│
├── AUC 400–600 mg·h/L → THERAPEUTIC: Continue current regimen
│                           Recheck per monitoring schedule
│
└── AUC > 600 mg·h/L  →  SUPRATHERAPEUTIC / TOXIC RISK:
                           Decrease dose or extend interval
                           New Dose = Current Dose × (500 / Current AUC)
                           Consider holding if AUC >> 600 or AKI developing
```

---

## 6. MIC CONSIDERATIONS

### 6.1 Default MIC Assumption
- **Assume MIC = 1 mg/L** for all empiric dosing
- Based on national susceptibility surveillance: most MRSA MIC ≤ 1 mg/L by BMD

### 6.2 When MIC Is Known
| BMD MIC | Action |
|---------|--------|
| ≤ 1 mg/L | Proceed with AUC target 400–600; do NOT reduce dose to hit lower AUC |
| > 1 mg/L | AUC target ≥ 400 unlikely with conventional doses; **consider alternative therapy** |
| 2 mg/L | Conventional doses insufficient (even with normal renal function); clinical judgment required |

### 6.3 MIC Testing Caveats
- Automated susceptibility testing (e.g., Vitek, MicroScan) has ±1 log₂ dilution variability
- **Broth Microdilution (BMD)** is the gold standard
- Etest may be used but has its own limitations
- Do not act on MIC from non-BMD methods without caution

---

## 7. NEPHROTOXICITY MONITORING & SAFETY

### 7.1 AKI Definition (KDIGO 2012 — Primary Criterion)
**Vancomycin-associated AKI** is defined as:
- Increase in SCr ≥ **0.3 mg/dL** within 48 hours, OR
- Increase in SCr to ≥ **1.5× baseline** within 7 days

*Alternative definitions used in literature:*
- RIFLE: Risk (1.5× SCr), Injury (2× SCr), Failure (3× SCr)
- AKIN: Similar stages to RIFLE
- Vancomycin Consensus Guidelines (historical): ≥ 0.5 mg/dL increase or ≥ 50% rise on 2 consecutive days

### 7.2 Risk Factors for Nephrotoxicity
**Patient factors:**
- Obesity, baseline renal impairment, advanced age, ICU admission
- Septic shock, hemodynamic instability, dehydration

**Drug factors:**
- AUC > 600 mg·h/L (primary modifiable risk)
- Total daily dose ≥ 4 g/day (independent risk factor)
- Duration > 5–7 days
- Concomitant nephrotoxins (see list below)

**Concomitant nephrotoxin list:**
- Aminoglycosides (gentamicin, tobramycin, amikacin)
- Piperacillin-tazobactam (synergistic nephrotoxicity)
- Amphotericin B
- Loop diuretics (furosemide)
- ACE inhibitors / ARBs
- NSAIDs
- Iodinated contrast dye
- Calcineurin inhibitors (tacrolimus, cyclosporine)
- Cisplatin, ifosfamide (chemotherapy)
- Trimethoprim-sulfamethoxazole

### 7.3 Nephrotoxicity Response Protocol
```
Rising SCr (0.3 mg/dL or 1.5× baseline)?
│
├── Yes → Check current AUC
│          │
│          ├── AUC > 600 → Reduce dose/extend interval immediately
│          ├── AUC 400–600 → Review nephrotoxins; consider dose reduction
│          └── AUC < 400 → Likely alternative etiology; assess other factors
│
└── No  → Continue monitoring per schedule
```

### 7.4 When to Hold Vancomycin
- SCr rising rapidly (≥ 0.5 mg/dL/day)
- Oliguric AKI developing
- AUC consistently > 600 mg·h/L
- Always reassess need for vancomycin; consider alternatives (daptomycin, ceftaroline, linezolid)

---

## 8. DECISION SUPPORT LOGIC (SOFTWARE MODULE DESIGN)

### 8.1 Patient Input Fields
```
Demographics:
  - Age (years)
  - Sex (M/F)
  - Height (cm or inches)
  - Actual Body Weight (ABW, kg)
  - Ideal Body Weight (auto-calculated)
  - BMI (auto-calculated)
  - Obesity flag (BMI ≥ 30)

Renal Function:
  - Serum Creatinine (SCr, mg/dL)
  - CrCl (auto-calculated from CG equation)
  - Renal replacement therapy? (None / IHD / CRRT / SLED)
  - Unstable renal function flag

Clinical:
  - Indication (Serious MRSA / Other)
  - Infection type (bacteremia, pneumonia, endocarditis, osteomyelitis, etc.)
  - ICU patient? (Y/N)
  - Concomitant nephrotoxins (multi-select)
  - MIC (mg/L; default = 1.0)

Vancomycin History:
  - Current regimen (dose, interval, infusion time)
  - Dates/times of doses
  - Measured levels (concentration + exact draw time)
```

### 8.2 Calculation Engine

**Step 1 — Calculate CrCl:**
```
If ABW ≤ IBW: use ABW
If ABW > IBW: use AdjBW = IBW + 0.4 × (ABW – IBW)
CrCl = [(140 – age) × weight] / (72 × SCr) × (0.85 if female)
```

**Step 2 — Calculate Ke (from two levels):**
```
Ke = (ln[C1] – ln[C2]) / (t2 – t1)
```

**Step 3 — Back-extrapolate True Peak:**
```
Cmax = C1 × e^(Ke × t_offset)
where t_offset = time from end of infusion to C1 draw time
```

**Step 4 — Calculate Vd:**
```
Vd = Dose / (tinf × Ke) × (1 – e^(–Ke×tinf)) / ((1 – e^(–Ke×τ)) × Cmaxss)
```
*Or use population Vd = 0.7 L/kg for initial dosing estimates*

**Step 5 — Calculate CLv:**
```
CLv = Ke × Vd
```

**Step 6 — Calculate AUC (Trapezoidal):**
```
AUCinf  = tinf × (Cmax + Cmin) / 2
AUCelim = (Cmax – Cmin) / Ke
AUC_τ   = AUCinf + AUCelim
AUC24   = AUC_τ × (24 / τ)
```

**Step 7 — Dose Recommendation:**
```
Required Daily Dose = Target AUC24 × CLv
  (target = 500 mg·h/L for mid-range)

Dose per interval = Required Daily Dose × (τ / 24)
Round to nearest 250 mg; cap single dose at 3000 mg
```

**Step 8 — Predict new Cmax/Cmin with recommended dose:**
```
New Cmaxss = (New Dose / (tinf × Ke × Vd)) × (1–e^(–Ke×tinf)) / (1–e^(–Ke×τ))
New Cminss = New Cmaxss × e^(–Ke×(τ–tinf))
```

### 8.3 Continuous Infusion Module
```
Loading dose = 15–20 mg/kg (ABW)
CI rate (mg/h) = Target Css × CLv
Target Css = 20–25 mg/L
AUC24 = Css × 24
Adjust rate based on measured Css
```

### 8.4 Output Display Requirements
```
For each patient encounter, display:
  1. Calculated CrCl (mL/min)
  2. Estimated Ke (h⁻¹) and t½ (h)
  3. Estimated Vd (L) and CLv (L/h)
  4. Measured levels with timing (table)
  5. Calculated AUC24 (mg·h/L)
  6. AUC/MIC ratio
  7. AUC interpretation: [SUBTHERAPEUTIC / THERAPEUTIC / SUPRATHERAPEUTIC]
  8. Dose recommendation with rationale
  9. Predicted Cmax/Cmin on new regimen
  10. Nephrotoxicity risk assessment
  11. Next monitoring recommendation (when/what type)
  12. Alerts:
      - AUC > 600: ⚠️ NEPHROTOXICITY RISK
      - AUC < 400: ⚠️ SUBTHERAPEUTIC — treatment failure risk
      - Rising SCr: 🔴 AKI ALERT
      - Concurrent nephrotoxins: ⚠️ ENHANCED MONITORING REQUIRED
```

---

## 9. CLINICAL ALERTS & SAFETY RULES

### 9.1 Hard Stop Alerts (must be acknowledged before proceeding)
- **AUC > 700 mg·h/L:** "Dose significantly exceeds target. Review immediately."
- **Dose > 3000 mg single dose:** "Single dose exceeds maximum recommended. Confirm and override."
- **Dose > 4500 mg/day (obese) or > 4000 mg/day (standard):** "Exceeds empiric maximum; intensive monitoring required."
- **SCr increase ≥ 0.3 mg/dL in 48h or ≥ 1.5× baseline (KDIGO AKI):** "KDIGO AKI criteria met. Reassess vancomycin therapy."

### 9.2 Soft Alerts (informational)
- MIC > 1 mg/L detected: "Target AUC/MIC unlikely achievable. Consider alternative therapy."
- No levels drawn by 48h in serious MRSA: "Recommend therapeutic monitoring within 24–48h."
- Concurrent piperacillin-tazobactam: "Combination associated with increased nephrotoxicity. Enhanced monitoring."
- Renal function improving: "Consider more frequent dosing; re-check AUC."

---

## 10. POPULATION PK PARAMETERS (For Bayesian Prior / Initial Estimates)

### 10.1 Adult Population (Non-Obese, Normal Renal Function)
| Parameter | Typical Value | Reference Range |
|-----------|--------------|-----------------|
| Vd | 0.7 L/kg | 0.4–1.0 L/kg |
| CLv | 0.041 × CrCl + 0.22 (L/h) | Matzke formula |
| Ke | CLv / Vd | Variable |
| t½ | 4–8 hours (normal renal function) | Up to 200+ h in ESRD |

### 10.2 Pediatric Population Parameters (Goti Model — Modified)
| Age Group | Vd (L/kg) | CL Correlation |
|-----------|----------|----------------|
| Neonates (≤28 days PMA) | 0.6–0.8 | Primarily SCr/PMA |
| Infants (1–12 months) | 0.6–0.7 | SCr + weight |
| Children (1–12 years) | 0.6–0.7 | CrCl-based |
| Adolescents (12–18 years) | Similar to adults | CG equation |

### 10.3 Crass 2018 Population PK Model (Obese Adults — Validated for Bayesian)
```
CLvanco = 9.656 – 0.078×age – 2.009×SCr + 1.09×sex + 0.04×TBW^0.75
(sex: female=0, male=1; TBW in kg; SCr in mg/dL)
Vd = 0.4 L/kg (TBW) in morbidly obese
```

---

## 11. GRADING OF RECOMMENDATIONS (Evidence Reference)

| Grade | Meaning |
|-------|---------|
| A-I | Strong; randomized controlled trial(s) |
| A-II | Strong; well-designed non-RCT, cohort, or case-control studies |
| A-III | Strong; expert opinion |
| B-II | Moderate; clinical trials without randomization |
| B-III | Moderate; expert opinion |
| C-III | Poor evidence; expert opinion only |

**Key recommendations and grades:**
- AUC/MIC target 400–600 mg·h/L: **A-II**
- Trough-only no longer recommended for serious MRSA: **A-II**
- AUC monitoring for high-risk patients: **A-II**
- Loading dose for critically ill: **B-II**
- Bayesian preferred AUC method: **A-II** (preferred), **B-II** (trough alone with Bayesian)
- Pediatric AUC target and Bayesian monitoring: **B-II**
- Neonatal dosing: **A-II**

---

## 12. INFECTION TYPES WHERE GUIDELINE APPLIES

### Supported by evidence (apply full AUC-guided protocol):
- MRSA Bacteremia / Bloodstream infection
- MRSA Endocarditis
- MRSA Pneumonia
- MRSA Osteomyelitis
- MRSA Septic Arthritis
- MRSA Meningitis / CNS infections
- MRSA Deep tissue infections

### Use with caution (extrapolation; limited data):
- Non-MRSA gram-positive infections (e.g., VRE, VISA, CoNS)
- Non-bacteremic skin and soft tissue infections (SSTI)
- Urinary tract infections (UTIs)
- Surgical prophylaxis
- *C. difficile* (oral vancomycin — does not apply, not systemically absorbed)

---

## 13. TRANSITION FROM TROUGH-BASED TO AUC-BASED MONITORING

### Implementation Checklist
1. ☐ Educate pharmacists, nurses, physicians on peak + trough timing
2. ☐ Update order sets: add peak level order (1–2h post-infusion end)
3. ☐ Create or deploy AUC calculator (spreadsheet or software)
4. ☐ Define institution's approach: First-order equations vs. Bayesian software
5. ☐ Establish workflow for outpatient/OPAT transitions
6. ☐ Define audit metrics: % patients with appropriate AUC, AKI rate

### Practical Trough-to-AUC Correlation (When Transitioning)
- At Trough ≈ 10 mg/L → AUC24 ≈ 350–450 mg·h/L (may be sub-therapeutic)
- At Trough ≈ 15 mg/L → AUC24 ≈ 450–600 mg·h/L (likely therapeutic)
- At Trough ≈ 20 mg/L → AUC24 ≈ 600–800 mg·h/L (supratherapeutic/toxic risk)
- *Note: Correlation is poor in obese, critically ill, and variable renal function patients — do not rely on trough as AUC surrogate in these populations.*

---

## 14. REFERENCES & EVIDENCE BASE

1. **Rybak MJ et al.** Therapeutic monitoring of vancomycin for serious MRSA infections: revised consensus guideline. *CID 2020;71(6):1361–4.*
2. **Rybak MJ et al.** Full guideline. *Am J Health-Syst Pharm 2020;77:835–64.*
3. **Crass RL et al.** Renal dosing of vancomycin for hospitalized patients receiving continuous renal replacement therapy. *Pharmacotherapy 2019.*
4. **Matzke GR et al.** Pharmacokinetics of vancomycin in patients with varying degrees of renal function. *Antimicrob Agents Chemother 1984;25:433.*
5. **Goti V et al.** Substantially different pharmacokinetics of vancomycin in morbidly obese versus non-obese patients: outcomes of AUC-guided approach. *Antimicrob Agents Chemother 2018.*
6. **Neely MN et al.** Are vancomycin trough concentrations adequate for optimal dosing? *Antimicrob Agents Chemother 2014;58(1):309-16.*
7. **Broeker A et al.** Towards precision dosing of vancomycin: systematic review and meta-analysis of published Bayesian popPK models. *Clin Microbiol Infect 2019.*
8. **Abdelmessih RR et al.** Vancomycin AUC versus trough only guided dosing and the risk of AKI: Systematic review and meta-analysis. *Pharmacotherapy 2022.*
9. **KDIGO 2012 Clinical Practice Guideline for Acute Kidney Injury.** *Kidney Int Suppl 2012;2:1-138.*
10. **Sawchuk RJ & Zaske DE.** Pharmacokinetics of dosing regimens which utilize multiple intravenous infusions. *J Pharmacokinet Biopharm 1976.*

---

*Document Version: 1.0 | Compiled: March 2026 | Based on ASHP/IDSA/PIDS/SIDP 2020 Vancomycin Consensus Guidelines*
*For clinical software development use only. All clinical decisions must involve qualified healthcare professionals.*
# AINADARA CALC — Therapeutic Drug Monitoring Suite — CHUNK 2 BRAIN DOCUMENT
## Advanced Modules: Neonatal, CI Rate Calculator, Multi-Encounter, OPAT, PDF Export
### Instruction Set for Opus Build

---

## MODULE 1: NEONATAL DOSING ENGINE
### 1.1 Clinical Background
Neonates represent the most PK-variable population. Vancomycin CL correlates primarily with postmenstrual age (PMA) and weight — NOT adult CrCl equations. Cockcroft-Gault is INVALID in neonates. Use SCr and PMA-based models.

### 1.2 Neonatal Population PK Model (Grimsley & Thomson 1999 / Salem 2014)
```
Primary model parameters (per kg):
  Vd  = 0.69 L/kg (range 0.4–0.9 L/kg; increases with prematurity/fluid overload)
  CL  = f(PMA, SCr, weight)

CL estimation by PMA (Grimsley-Thomson):
  PMA ≤ 28 weeks:  CL = 0.0131 × weight(kg) + 0.0087 L/h
  PMA 29–36 weeks: CL = 0.0248 × weight(kg) + 0.0120 L/h
  PMA 37–44 weeks: CL = 0.0303 × weight(kg) + 0.0160 L/h
  PMA > 44 weeks:  CL = 0.0370 × weight(kg) + 0.0220 L/h

SCr correction factor:
  If SCr > 0.7 mg/dL (term) or > 1.0 mg/dL (preterm):
    CL_corrected = CL × (0.5 / SCr)

Ke = CL / Vd
t½ = 0.693 / Ke
```

### 1.3 Neonatal Dosing Table (2020 Guidelines — Recommendation 25, Grade A-II)
```
PMA ≤ 28 weeks (extremely preterm):
  Dose:     15 mg/kg
  Interval: q24h (range q24–48h based on SCr)
  SCr > 1.0: extend to q36–48h

PMA 29–35 weeks (preterm):
  Dose:     15 mg/kg
  Interval: q18–24h

PMA 36–44 weeks (late preterm / term):
  Dose:     15 mg/kg
  Interval: q12–18h

PMA > 44 weeks (postnatal corrected):
  Dose:     15–20 mg/kg
  Interval: q8–12h

Weight-based adjustment:
  < 1.0 kg: q48h strongly preferred regardless of PMA
  1.0–2.5 kg: q24–36h
  > 2.5 kg: q12–24h based on PMA

Maximum single dose neonatal: 20 mg/kg (absolute)
```

### 1.4 Neonatal AUC Target
```
Target AUC: 400 mg·h/L (MIC = 1 mg/L)
  — Same target as adults
  — Upper safety limit: < 800 mg·h/L (B-II)
  — Trough ceiling: < 15 mg/L (to minimize AKI)

AUC Monitoring: Bayesian STRONGLY preferred
  — Optimal: peak (1h post-infusion) + trough (pre-dose)
  — First TDM: within 24–48h of starting therapy
  — Random level acceptable if exact timing documented
```

### 1.5 Neonatal SCr Interpretation Caveat
```
CRITICAL: In first 48–72h of life, SCr reflects MATERNAL SCr, not neonatal renal function.
  — Do not use SCr < 72h of life for CrCl estimation
  — After 72h: SCr should be falling; persistently elevated SCr = AKI
  — Use clinical urine output as adjunct: target > 1 mL/kg/h

Neonatal AKI (modified KDIGO):
  SCr rise ≥ 0.3 mg/dL from nadir within 48h
  OR SCr ≥ 1.5× prior value within 7 days
```

### 1.6 Software Input Fields — Neonatal Mode
```
Required:
  - PMA (postmenstrual age) in weeks + days
  - Postnatal age (days since birth)
  - Birth weight (kg)
  - Current weight (kg) — use for dosing
  - SCr (mg/dL) — flag if < 72h of life
  - Concurrent medications (gentamicin is common; FLAG nephrotoxin combination)
  - Fluid balance (positive balance → increased Vd; reduce concentration)

Auto-calculated:
  - Corrected gestational age
  - Dose recommendation by PMA + SCr
  - Expected t½
  - Time to steady state
  - Next monitoring recommendation
```

### 1.7 Neonatal Bayesian Prior Selection Logic
```
IF PMA ≤ 28 weeks → use Grimsley preterm model
IF PMA 29–36 weeks → use Grimsley midterm model
IF PMA > 36 weeks → use Grimsley term model
IF postnatal age > 28 days AND PMA > 44 weeks → transition to pediatric model
IF SCr > 1.0 → apply SCr correction factor
IF NICU, mechanically ventilated, vasopressors → Vd_prior × 1.3 (fluid overload)
```

---

## MODULE 2: CONTINUOUS INFUSION (CI) RATE CALCULATOR
### 2.1 Clinical Rationale
CI vancomycin achieves target earlier, has simpler AUC math, and may reduce nephrotoxicity vs. intermittent in critically ill. Target: steady-state concentration (Css) 20–25 mg/L.

```
AUC₂₄ = Css × 24
  → If Css = 20 mg/L → AUC₂₄ = 480 mg·h/L ✓ (therapeutic)
  → If Css = 25 mg/L → AUC₂₄ = 600 mg·h/L ✓ (therapeutic upper)
  → If Css = 15 mg/L → AUC₂₄ = 360 mg·h/L ✗ (subtherapeutic)
```

### 2.2 CI Dosing Algorithm
```
STEP 1 — Loading Dose (mandatory; achieves immediate target):
  LD = 15–20 mg/kg ABW (standard)
  LD = 20–25 mg/kg ABW (critically ill, CRRT)
  LD cap: 3000 mg
  Infuse LD over 1–2h before starting CI

STEP 2 — Initial CI Rate:
  CI_rate (mg/h) = Target_Css × CLv
  
  Where:
    Target_Css = 20 mg/L (conservative start) to 25 mg/L (MRSA bacteremia/endocarditis)
    CLv = estimated from CrCl (Matzke formula) OR Crass 2018 if obese

  Example:
    CrCl = 60 mL/min → CLv = 60×0.041+0.22 = 2.68 L/h
    Target Css = 22 mg/L
    CI_rate = 22 × 2.68 = 58.9 mg/h → round to 60 mg/h

STEP 3 — CI Daily Dose:
  CI_daily = CI_rate × 24

STEP 4 — Time to Steady State:
  SS ≈ 4–5 × t½
  First Css measurement: at SS (4–5 × t½ after LD)
  Practical: check Css at 24h in ICU patients (may not be SS but clinically useful)

STEP 5 — Dose Adjustment from Measured Css:
  New_CI_rate = Current_CI_rate × (Target_Css / Measured_Css)
  
  Example:
    Current rate: 60 mg/h, Measured Css: 18 mg/L, Target: 22 mg/L
    New rate = 60 × (22/18) = 73.3 mg/h → round to 75 mg/h

STEP 6 — Monitoring Css:
  Draw: at any time during steady-state CI (confirm timing documents at SS)
  Frequency:
    Stable patients: every 48–72h
    ICU/unstable: daily
    Changing renal function: every 24h
```

### 2.3 CI Rate Adjustment Table (Pre-calculated)
```
CrCl (mL/min) | CLv (L/h) | CI Rate for Css=20 | CI Rate for Css=25
< 20          | 1.02      | 20 mg/h            | 26 mg/h
20–40         | 1.44      | 29 mg/h            | 36 mg/h
40–60         | 1.86      | 37 mg/h            | 47 mg/h
60–80         | 2.68      | 54 mg/h            | 67 mg/h
80–100        | 3.50      | 70 mg/h            | 88 mg/h
100–130       | 4.33      | 87 mg/h            | 108 mg/h
> 130 (ARC)   | 5.55+     | 111+ mg/h          | 139+ mg/h (consider q6h intermittent)
```

### 2.4 CI Incompatibilities (Clinical Alert List)
```
ALWAYS flag these incompatibilities when CI vancomycin selected:
  HIGH RISK (separate line required):
    - Piperacillin/tazobactam (precipitates at Y-site)
    - Cefepime (pH incompatibility)
    - Meropenem (time-dependent; may use separate lumen)
    - Heparin (precipitate formation)
    - Phenytoin (precipitate)
    - Albumin (adsorption)
  
  ALERT TEXT: "Continuous infusion vancomycin requires a DEDICATED IV line or
  multi-lumen catheter. Cannot share lumens with listed incompatible agents."
```

### 2.5 CI Software Fields
```
Input:
  - ABW (kg) — for loading dose
  - CrCl (mL/min) — for initial rate
  - Target Css (mg/L) — default 20, range 20–25
  - Measured Css (mg/L) — for adjustment
  - Time of Css draw (confirm SS timing)
  - Infusion line type (peripheral/CVC/PICC)
  - Co-infusing medications (check incompatibility list)

Output:
  - Loading dose (mg over 1–2h)
  - Initial CI rate (mg/h)
  - Expected SS time (hours)
  - Adjusted rate (if Css provided)
  - AUC₂₄ from current Css
  - Incompatibility alerts
  - Monitoring schedule
```

---

## MODULE 3: MULTI-ENCOUNTER PATIENT HISTORY TRACKER
### 3.1 Data Architecture (Per Patient Session)
```
Patient Record:
  - MRN / Patient ID (local, de-identified)
  - Demographics (age, sex, height, ABW) — entered once, editable
  - Active diagnoses / infection type
  - Admission date / treatment start date

Per Encounter (each TDM check):
  encounter_id: sequential
  date_time: ISO timestamp
  encounter_type: [initial | follow_up | dose_adjustment | AKI_response | HD_session | discharge]
  
  Data captured:
    - SCr (current)
    - CrCl (recalculated each encounter)
    - Current regimen at time of encounter
    - Levels drawn (with exact times)
    - PK parameters estimated (Ke, Vd, CL — Bayesian posterior)
    - AUC₂₄ calculated
    - AUC status: [subtherapeutic | therapeutic | supratherapeutic]
    - Dose recommendation generated
    - Action taken: [no_change | dose_increased | dose_decreased | interval_changed | held | discontinued]
    - Clinician notes (free text)
    - Nephrotoxin list at time of encounter
    - AKI status (KDIGO stage if met)
```

### 3.2 Trending Logic
```
Between consecutive encounters, calculate:
  - SCr_delta = current_SCr − previous_SCr
  - CrCl_change (%) = (current_CrCl − prev_CrCl) / prev_CrCl × 100
  - AUC_trend = [stable | improving | worsening]
  - Ke_trend: flag if Ke changes > 20% between encounters
    (suggests changing renal function — update Bayesian prior)

Triggers for automatic re-assessment:
  - SCr rise ≥ 0.3 mg/dL → KDIGO AKI flag
  - CrCl change > 25% → "Renal function change — recalculate dose"
  - AUC drift outside 400–600 after being therapeutic → "AUC target lost — re-evaluate"
  - 2 consecutive sub/supratherapeutic AUCs → "Persistent target failure — escalate review"
```

### 3.3 Longitudinal Display Requirements
```
Timeline View:
  - Horizontal axis: treatment days (Day 0 to Day N)
  - Overlaid plots:
    a. AUC₂₄ over time (shaded therapeutic zone 400–600)
    b. SCr over time (right y-axis, inverted trend awareness)
    c. Trough/peak levels as scatter dots
    d. Dose changes annotated (vertical dashed line + label)
    e. HD sessions marked (gray shaded bands)
    f. AKI events marked (red markers)

Summary Table (per encounter row):
  Date | Regimen | Trough | Peak | AUC₂₄ | SCr | CrCl | Status | Action
```

### 3.4 Bayesian Prior Update Between Encounters
```
CRITICAL LOGIC:
  After encounter N, Bayesian posterior becomes the prior for encounter N+1
  
  Posterior_N → Prior_{N+1} with uncertainty update:
    new_sigma_CL = prior_sigma_CL × 0.7 (posterior is tighter than prior)
    new_sigma_Vd = prior_sigma_Vd × 0.7
    
  EXCEPTION — Reset prior to population if:
    - SCr change > 50% (major renal function change)
    - Patient moved to/from ICU
    - New nephrotoxin added
    - Mode change (e.g., started CRRT)
    
  Alert: "Significant renal function change detected. Bayesian prior reset to
  population model. New levels required before dose recommendation."
```

---

## MODULE 4: OPAT / OUTPATIENT TRANSITION MODULE
### 4.1 OPAT Eligibility Criteria (Clinical Decision Support)
```
OPAT (Outpatient Parenteral Antimicrobial Therapy) checklist:
  ✓ Clinically stable (hemodynamically, neurologically)
  ✓ Infection source controlled
  ✓ Oral route not appropriate/available
  ✓ Reliable IV access (PICC, Port, tunneled CVC)
  ✓ Patient/caregiver able to manage infusion OR home infusion service available
  ✓ Baseline stable renal function (CrCl stable × 48h)
  ✓ AUC therapeutic × 2 consecutive checks
  ✓ No active concurrent nephrotoxins (or clearly managed)
  ✓ Reliable phone/follow-up access

DISQUALIFYING:
  ✗ Active AKI or rapidly changing SCr
  ✗ AUC not at target
  ✗ Active hemodynamic instability
  ✗ No reliable IV access
```

### 4.2 OPAT Monitoring Schedule
```
Week 1 (first 7 days outpatient):
  - SCr + BUN: Day 2, Day 5, Day 7
  - Vancomycin level (trough or Bayesian): Day 3, Day 7
  - CBC (for leukopenia if prolonged): Day 7
  
Week 2–4 (stable):
  - SCr: twice weekly
  - Vancomycin AUC: weekly (at minimum)
  - CBC: weekly if > 2 weeks
  
Monthly (> 4 weeks):
  - SCr: weekly
  - AUC: weekly
  - CBC, LFTs: every 2 weeks
  - Audiogram: if > 4 weeks therapy (ototoxicity surveillance)
```

### 4.3 OPAT Alerts and Thresholds
```
Automatic OPAT escalation triggers:
  SCr rise ≥ 0.3 mg/dL → "HOLD vancomycin. Contact prescriber within 4h. AKI protocol."
  SCr ≥ 1.5× baseline → "HOLD vancomycin. Emergency reassessment required."
  AUC < 400 → "Subtherapeutic. Dose adjustment required before next infusion."
  AUC > 600 → "Supratherapeutic. Contact pharmacist within 24h."
  AUC > 700 → "HOLD next dose. Urgent pharmacist contact required."
  New symptoms: rash, flushing, hypotension → "Red Man Syndrome — slow infusion rate"
  Hearing changes → "Possible ototoxicity — HOLD and evaluate urgently"
```

### 4.4 OPAT Dose Preparation Notes
```
Stability data (for home infusion compounding):
  Standard concentration: 5 mg/mL in NS or D5W
  Elastomeric pump: 500–1000 mg / 100 mL NS
  Stable: 72h at 4°C (refrigerated), 24h at room temperature
  
Infusion Rate Requirement:
  NEVER infuse faster than 10 mg/min
  Standard: 500 mg/h (e.g., 1000 mg over 2h)
  High doses: 1500–2000 mg over 2–3h minimum
  
Red Man Syndrome prevention:
  Always infuse ≥ 1h per 1000 mg
  Premedicate with diphenhydramine 25–50mg IV if prior reaction
```

---

## MODULE 5: RANDOM LEVEL / AKI MODE
### 5.1 Clinical Context
In AKI or ICU patients, levels may be drawn at non-standard times. Bayesian is the ONLY valid method here — Sawchuk-Zaske requires near-steady-state, which may never be reached in rapidly changing renal function.

### 5.2 Random Level Algorithm
```
Input requirements:
  - Exact time of vancomycin dose(s) (start time, duration, amount)
  - Exact time of level draw (to the minute matters)
  - All doses given in prior 48–72h with exact times
  - Current SCr (for prior update)
  - Prior SCr values with timestamps (for AKI trajectory)

Bayesian MAP with random timing:
  1. Build complete dosing history (all doses as {dose, tinf, t_start})
  2. For each random level at t_draw, compute predicted conc C_pred(t_draw | CL, Vd)
     using exact multi-dose superposition equation
  3. Run MAP estimation: minimize [likelihood of observed levels + prior penalty]
  4. Extract posterior CL, Vd
  5. Compute AUC₂₄ from posterior parameters

KEY VALIDATION:
  - Flag if random level is drawn during infusion (t_draw < tinf from last dose)
    → Level is NOT valid for PK estimation (distributional phase)
  - Flag if only 1 level AND patient is obese → insufficient for Vd estimation
  - Flag if level drawn < 1h post-infusion (distribution phase, not post-distributional)
```

### 5.3 AKI Mode Special Handling
```
AKI changes PK in complex ways:
  - Vd INCREASES (edema, capillary leak) → need HIGHER loading dose
  - CL DECREASES → need LONGER intervals, lower maintenance dose
  - PK is non-stationary → t½ changes day-to-day → Bayesian must update DAILY

AKI Dosing Strategy:
  Active AKI (rapidly rising SCr):
    1. Give loading dose (Vd-based, not CL-dependent) — full 20–25 mg/kg
    2. HOLD maintenance until CrCl estimated from most recent SCr
    3. Redose based on random level(s) + Bayesian
    4. Do NOT assume steady-state — use pre-SS Bayesian
    5. Check level every 24–48h

  AKI Recovery (falling SCr):
    - CrCl rising → CL rising → t½ shortening
    - Dose frequency needs to INCREASE as renal function recovers
    - Alert: "SCr falling — renal function recovering. Reassess dosing interval.
      More frequent dosing likely required."
    
  CRRT + AKI:
    - CRRT provides relatively stable, predictable CL
    - Use CRRT-specific prior (effluent rate 20–25 mL/kg/h)
    - Loading dose essential due to increased Vd
    - Maintenance: 7.5–10 mg/kg q12h (regardless of native CrCl)
    - Monitor first level within 24h

SCr Trajectory Classifier:
  Delta SCr / 24h:
    > +0.5 mg/dL/day: "Rapidly worsening AKI — daily levels, consider hold"
    +0.1 to +0.5/day: "Progressive AKI — every 48h levels"
    ±0.1/day: "Stable" — standard schedule
    < -0.1/day: "Recovering" — monitor for under-dosing, increase freq
```

---

## MODULE 6: PDF / REPORT EXPORT ENGINE
### 6.1 Report Content Specification
```
PAGE 1 — PATIENT SUMMARY HEADER:
  Patient ID, Date, Attending/Team
  Infection type, Indication, Organism (if known), MIC
  Current vancomycin regimen
  
PAGE 2 — PK ANALYSIS:
  Method used (Bayesian MAP / Sawchuk-Zaske / Population prior)
  Population PK model applied (Matzke / Crass 2018 / Pediatric / Neonatal)
  Bayesian prior parameters vs. posterior parameters (table)
  Levels used (table: level type, draw time, observed, predicted, residual)
  Individualized PK parameters: CL, Vd, Ke, t½

PAGE 3 — DOSING RECOMMENDATION:
  Current regimen → AUC₂₄ → Status
  Recommended regimen → Predicted AUC₂₄ → Predicted Cmax/Cmin
  Dose change rationale (formula shown)
  Next monitoring recommendation

PAGE 4 — SAFETY ASSESSMENT:
  KDIGO AKI status
  Nephrotoxin list
  Active alerts
  
PAGE 5 — CONCENTRATION-TIME GRAPH:
  Observed levels plotted
  Fitted curve
  Projected curve on recommended regimen
  Therapeutic zone (400–600 AUC annotation or 10–20 trough zone)
  
FOOTER on all pages:
  "Generated by AinaDara Calc | Therapeutic Drug Monitoring Suite | 2020 ASHP/IDSA/PIDS/SIDP Guidelines
  FOR CLINICAL DECISION SUPPORT ONLY. All recommendations require pharmacist/physician review."
```

### 6.2 Export Formats
```
PDF: Full clinical report (pages above)
CSV: Raw encounter data (for research/audit)
JSON: Full patient record including PK parameters (for EHR integration)
```

---

## MODULE 7: CLINICAL DECISION TREE (FULL LOGIC MAP)
### 7.1 Entry Point Classification
```
On patient entry, classify:

IF mode = NEONATAL (PMA ≤ 44 weeks):
  → Use neonatal PK model
  → SCr flag if < 72h of life
  → Apply neonatal dosing table
  → Bayesian required (highly variable PK)
  → AUC target: 400 mg·h/L (upper 800)

ELSE IF mode = PEDIATRIC (3 months – 18 years):
  → Use modified Goti model
  → CrCl from pediatric Schwartz formula (NOT Cockcroft-Gault)
  → AUC target: 400–600 mg·h/L
  → Bayesian preferred; first-order equations acceptable if 2 levels

ELSE IF mode = HD (intermittent):
  → Pre-dialysis level as primary monitoring tool
  → Target pre-HD: 15–20 mg/L (AUC surrogate)
  → CL interdialytic ≈ 0.1 L/h (residual)
  → CL during HD ≈ 2.5–3 L/h
  → Redose post-HD: 500–750 mg OR based on pre-HD level
  → Monitor weekly minimum

ELSE IF mode = CRRT:
  → Loading dose: 20–25 mg/kg
  → Maintenance: 7.5–10 mg/kg q12h
  → First level within 24h
  → Use CRRT prior (fixed effluent-based CL)
  → Daily monitoring initially

ELSE IF mode = CI:
  → Give loading dose first
  → Calculate CI rate from CLv × Target_Css
  → Check Css at steady state (4–5 × t½)
  → Adjust rate proportionally
  → AUC₂₄ = Css × 24

ELSE IF mode = AKI (rising SCr, unstable):
  → Full loading dose (Vd-based)
  → Bayesian ONLY (no Sawchuk-Zaske; not at SS)
  → Daily levels minimum
  → Classify SCr trajectory (worsening/stable/recovering)
  → Adjust dosing interval based on trajectory

ELSE (standard adult):
  → CrCl from Cockcroft-Gault
  → Prior: Matzke (or Crass 2018 if obese)
  → 2-level preferred; trough alone acceptable if stable/normal weight
  → AUC target: 400–600 mg·h/L
  → Weekly monitoring if stable
```

### 7.2 Dose Recommendation Logic (All Modes)
```
STEP 1: Determine CL (posterior if levels available; prior if not)

STEP 2: Calculate required TDD (Total Daily Dose):
  TDD = Target_AUC × CL
  Target_AUC = 500 mg·h/L (midpoint of 400–600)

STEP 3: Select interval based on CrCl:
  CrCl > 90:  prefer q8h or q12h
  CrCl 60–90: prefer q12h
  CrCl 30–59: prefer q24h
  CrCl 10–29: prefer q24–48h
  CrCl < 10:  dose by levels; q48–96h

STEP 4: Calculate dose per interval:
  Dose = TDD × (τ / 24)
  Round to nearest 250 mg
  Cap single dose at 3000 mg
  Cap daily dose at 4500 mg (obese) or 4000 mg (standard)
  Alert if capped

STEP 5: Verify predicted SS Cmax and Cmin:
  If Cmin > 20 mg/L → increase interval (trough toxicity risk)
  If Cmax > 50 mg/L → reduce dose or extend infusion time
  If Cmin < 5 mg/L → may indicate interval too long

STEP 6: If AUC still not achievable within dose caps:
  MIC > 1: "Consider alternative therapy"
  CRRT/HD/AKI: See mode-specific protocols
  Obese + AUC > 600: "Reduce to IBW-based dosing; reassess"

STEP 7: Output final recommendation:
  "Recommended: [X] mg IV q[τ]h over [tinf]h"
  "Predicted AUC₂₄: [X] mg·h/L"
  "Predicted Cmax/Cmin: [X]/[X] mg/L"
  "Next level: [type] in [timeframe]"
```

---

## MODULE 8: SCHWARTZ FORMULA (PEDIATRIC CrCl)
### 8.1 Why NOT Cockcroft-Gault in Children
CG equation uses muscle mass assumptions that are invalid in children. Schwartz formula uses height and age-based k-factor.

### 8.2 Schwartz 2009 (Bedside CKD-EPI Adapted for Pediatrics)
```
CrCl (mL/min/1.73m²) = k × Height(cm) / SCr(mg/dL)

k values by age/sex:
  Preterm infants: k = 0.33
  Term infants (0–1 year): k = 0.45
  Children 2–12 years: k = 0.55
  Adolescent females: k = 0.55
  Adolescent males: k = 0.70

BSA normalization to actual CrCl:
  CrCl_actual = CrCl_normalized × (BSA / 1.73)
  BSA = sqrt(height_cm × weight_kg / 3600)    [Mosteller formula]
```

---

## MODULE 9: ERROR HANDLING AND VALIDATION RULES
### 9.1 Input Validation (Hard Stops)
```
Flag and PREVENT calculation if:
  - Age < 0 or > 120
  - Weight < 0.3 kg or > 300 kg
  - Height < 30 cm or > 250 cm
  - SCr ≤ 0 (impossible)
  - SCr > 20 mg/dL without HD/CRRT — "Confirm SCr value"
  - Dose < 100 mg or > 5000 mg — "Unusual dose — confirm"
  - Tau < 6h (except CI mode) — "Interval < 6h unusual for vancomycin"
  - Level concentration < 0 or > 150 mg/L — "Confirm concentration value"
  - Level draw time before dose start — "Check timing: level drawn before dose"
  - C1 > C2 when C1 is expected trough (suggests mis-labeling)
  - Ke < 0 after Sawchuk-Zaske (implies increasing concentration; check timing)
```

### 9.2 PK Plausibility Checks (Soft Warnings)
```
Warn if:
  - t½ < 2h (likely error in timing or concentration)
  - t½ > 150h (unless ESRD — "Unusually long t½; confirm SCr and CrCl")
  - Vd < 0.2 L/kg (very small; check weight units)
  - Vd > 1.5 L/kg (very large; consider fluid overload or error)
  - CL < 0.5 L/h in non-renal-failure patient ("Unusually low CL; confirm SCr")
  - AUC < 100 or > 1200 mg·h/L ("Extreme AUC — verify inputs before acting")
  - Peak > 60 mg/L ("Unusually high peak; confirm draw timing not during infusion")
  - Ke negative ("Ke < 0: concentrations are rising, not falling — check level timing")
```

---

## MODULE 10: MEMORY AND OPUS BUILD INSTRUCTIONS
### 10.1 Architecture for Opus Build
```
Single-file React application with:
  - All PK math in pure JavaScript (no external PK libraries)
  - LocalStorage for multi-encounter patient history
  - jsPDF for PDF export (CDN loaded)
  - Recharts for longitudinal trending charts
  - All 7 modes switchable via tab bar
  - State management: useReducer for complex patient state
  - Mobile-responsive (pharmacists use tablets at bedside)
```

### 10.2 State Shape (Redux-like)
```javascript
{
  patient: {
    id, age, sex, height_cm, abw_kg, diagnoses,
    mode, // 'standard' | 'obese' | 'HD' | 'CRRT' | 'AKI' | 'neonatal' | 'pediatric' | 'CI'
    pma_weeks, pma_days, // neonatal only
    hd_settings: { scheduled, schedule_days, typical_session_duration },
    crrt_settings: { effluent_rate_ml_kg_h }
  },
  encounters: [
    {
      id, timestamp, encounter_type,
      labs: { scr, crcl, wbc, scr_baseline },
      dosing_history: [{ dose, tinf, tau, start_time }],
      levels: [{ time_abs, conc, label }],
      pk_results: { method, CL_prior, Vd_prior, CL_post, Vd_post, ke, t_half },
      auc: { current, recommended_regimen_auc },
      recommendation: { dose, tau, tinf, daily_dose },
      aki_status, nephrotoxins,
      notes, clinician_id
    }
  ],
  current_encounter_id, // which encounter is active
  alerts: [], // active clinical alerts
  ui: { activeTab, showChart, darkMode }
}
```

### 10.3 Key Opus Prompt Optimizations
```
1. Build Bayesian MAP as pure math module first, test with known values, then integrate UI
2. Use useReducer not useState for complex state — easier to audit
3. PKChart should use SVG (not canvas) for PDF compatibility
4. Each module (neonatal, CI, HD, etc.) as separate component receiving same patient state
5. All PK results should be immutable — stored per encounter, never overwritten
6. Validation layer runs before every calculation, blocks on hard stops
7. Alert system: priority queue — DANGER > WARN > INFO
8. PDF export: capture SVG charts as base64, embed in jsPDF
9. All formulas should have tooltips explaining the math (hover/tap)
10. "Evidence Grade" badge on every recommendation (A-II, B-II, etc.)
```

### 10.4 Formula Tooltip Specs (Educational Layer)
```
Every calculated value should have an expandable "Show Math" section:

Example — CrCl tooltip:
  "Cockcroft-Gault (1976): CrCl = [(140−age) × IBW] / (72 × SCr) × 0.85 (female)
  Weight used: [value] kg ([IBW/AdjBW/ABW])
  Result: [X] mL/min
  [A-II Evidence — 2020 ASHP/IDSA Guidelines]"

Example — AUC tooltip:
  "Trapezoidal Method (Sawchuk-Zaske):
  AUCinf = tinf × (Cmax + Cmin) / 2 = [X]
  AUCelim = (Cmax − Cmin) / Ke = [X]
  AUC_τ = [X]
  AUC₂₄ = AUC_τ × (24/τ) = [X] mg·h/L"
```

---

## CHUNK 2 COMPLETE SUMMARY
Modules covered:
  ✅ M1: Neonatal dosing engine (Grimsley-Thomson, PMA-based, SCr correction)
  ✅ M2: Continuous infusion rate calculator (Css targeting, rate adjustment, incompatibilities)
  ✅ M3: Multi-encounter history tracker (trending, Bayesian prior propagation)
  ✅ M4: OPAT transition module (eligibility, monitoring schedule, escalation alerts)
  ✅ M5: Random level / AKI mode (non-steady-state Bayesian, SCr trajectory classifier)
  ✅ M6: PDF/CSV/JSON export spec
  ✅ M7: Full clinical decision tree (all modes, entry logic, dose selection)
  ✅ M8: Schwartz formula (pediatric CrCl)
  ✅ M9: Input validation and PK plausibility checks
  ✅ M10: Opus build architecture, state shape, prompt optimizations

---
*AinaDara Calc Brain Document v2.0 | March 2026 | For Opus Build*
# AINADARA CALC — Therapeutic Drug Monitoring Suite — CHUNK 3 BRAIN DOCUMENT
## Alternative Therapy Engine · Drug Interaction Matrix · UI/UX Wireframe Spec
## Population Simulation · Clinical Scenario Library · Master Opus Build Prompt
### Final Instruction Set for Opus Build

---

## MODULE 11: ALTERNATIVE THERAPY DECISION ENGINE

### 11.1 When to Trigger Alternative Therapy Assessment
```
Auto-trigger this module when ANY of the following conditions are met:

HARD TRIGGERS (require immediate alternative consideration):
  1. BMD MIC ≥ 2 mg/L
       → "AUC/MIC target unachievable. Vancomycin monotherapy insufficient."
  2. KDIGO AKI Stage 2 or 3 while on therapeutic AUC
       → "Nephrotoxicity despite therapeutic dosing. Reassess agent."
  3. AUC > 700 mg·h/L on two consecutive encounters despite dose reduction
       → "Unable to achieve therapeutic window. Consider agent change."
  4. Vancomycin MIC creep (serial MICs rising 0.5 → 1 → 2 over course of therapy)
       → "Emerging resistance pattern. ID consultation strongly advised."
  5. Clinical treatment failure at 72h despite therapeutic AUC + MIC ≤ 1
       → "Therapeutic failure. Alternative or combination therapy warranted."

SOFT TRIGGERS (flag for consideration):
  - BMD MIC = 1 mg/L + CrCl < 30 mL/min
       → "High nephrotoxicity risk with therapeutic AUC. Consider alternatives."
  - Concurrent pip/tazo + AUC approaching 550+
       → "Synergistic nephrotoxicity risk. Reassess pip/tazo necessity or switch agent."
  - Therapy duration > 14 days
       → "Prolonged therapy (>14 days). Consider agent de-escalation or switch."
  - VISA or hVISA detected on susceptibility report
       → "VISA/hVISA: vancomycin bactericidal activity markedly reduced."
```

### 11.2 Alternative Agent Profiles (Full PK/PD Comparison)

#### 11.2.1 Daptomycin
```
Mechanism: Lipopeptide; disrupts cell membrane → concentration-dependent killing
PK/PD target: AUC/MIC > 666 (efficacy) + Cmax/MIC ratio
Standard dose:
  Bacteremia/endocarditis (right-sided): 6 mg/kg IV q24h
  Complex bacteremia / left-sided endocarditis: 8–10 mg/kg IV q24h
  Osteomyelitis: 6 mg/kg q24h
  Some centers: 10–12 mg/kg for IE or high MIC

Renal adjustment:
  CrCl ≥ 30: no adjustment
  CrCl < 30: 6 mg/kg q48h (or standard dose with TDM)
  HD: 6 mg/kg after each HD session

Monitoring:
  CPK every 2–3 days (myopathy risk)
  Baseline and weekly
  Hold if CPK > 5× ULN

Advantages vs vancomycin:
  - No nephrotoxicity signal
  - No TDM required (generally)
  - Concentration-dependent (once-daily dosing)
  - Better for high MIC isolates (dose-escalate)

Disadvantages:
  - Pulmonary surfactant inactivation → CONTRAINDICATED in pneumonia
  - Must check prior statin use (CPK additive risk)
  - More expensive

Contraindications:
  - Pneumonia (any etiology where pulmonary deposition expected)
  - Known daptomycin non-susceptibility (MIC ≥ 1 mg/L)
  - Active myopathy or CK > 5× ULN at baseline

Algorithm:
  IF infection = pneumonia → NEVER recommend daptomycin
  IF bacteremia/endocarditis + vanco MIC ≥ 2 OR nephrotoxicity → FIRST LINE alternative
  IF CrCl < 30 → use q48h dosing; document
```

#### 11.2.2 Linezolid
```
Mechanism: Oxazolidinone; 50S ribosomal inhibitor → bacteriostatic (usually)
PK/PD target: AUC/MIC > 80–120 (bacteriostatic effect); time-dependent
Standard dose: 600 mg PO/IV q12h (100% oral bioavailability — IV = PO)

Renal adjustment: None for linezolid itself
  WARNING: Metabolite accumulates in renal failure
  → Risk of serotonin syndrome and thrombocytopenia in ESRD

Monitoring:
  CBC weekly (thrombocytopenia — dose-limiting in ~3% at 14 days, ~30% at 28 days)
  Lactic acid if prolonged (mitochondrial toxicity)
  Drug interactions: serotonergic agents (SSRIs, SNRIs, tramadol, meperidine)
    → Serotonin syndrome risk (potentially fatal)
  Duration limit: ideally ≤ 14 days; maximum 28 days with close monitoring

Advantages:
  - Excellent oral bioavailability (OPAT step-down without IV)
  - CSF penetration (meningitis, brain abscess)
  - No renal dose adjustment
  - Active vs. VRE and linezolid-susceptible MRSA

Disadvantages:
  - Bacteriostatic — not ideal for bacteremia/endocarditis as monotherapy
  - Thrombocytopenia, anemia (bone marrow suppression)
  - Serotonin syndrome risk (major drug interaction)
  - Not recommended for bacteremia as first-line

Algorithm:
  IF infection = osteomyelitis/skin/CNS AND oral step-down desired → consider
  IF bacteremia/endocarditis → NOT first-line (bacteriostatic insufficient)
  IF serotonergic drugs present → FLAG interaction before recommending
  IF duration > 14 days anticipated → preemptive CBC monitoring plan required
```

#### 11.2.3 Ceftaroline
```
Mechanism: 5th-gen cephalosporin; binds PBP2a (MRSA-active)
PK/PD target: Time > MIC (fT > MIC ≥ 40–70%)
Standard dose: 600 mg IV q8h (MRSA bacteremia); 600 mg IV q12h (SSTI)
  Note: q8h preferred for serious MRSA infections (higher fT > MIC)

Renal adjustment:
  CrCl 30–50: 400 mg q8h
  CrCl 15–30: 300 mg q8h
  CrCl < 15 / HD: 200 mg q8h (limited data)

Monitoring: Standard β-lactam monitoring; CBC (rare Coombs-positive hemolytic anemia)

Advantages:
  - Bactericidal (unlike linezolid)
  - Beta-lactam backbone (favorable safety profile)
  - Active vs MRSA, including some VISA
  - Combination with vancomycin: additive/synergistic against hVISA

Disadvantages:
  - Limited endocarditis data
  - No oral formulation
  - More expensive than vancomycin

Algorithm:
  IF VISA/hVISA + bacteremia → consider ceftaroline +/- vancomycin combination
  IF beta-lactam allergy (severe) → avoid
  IF MRSA bacteremia, vancomycin intolerant → strong alternative
```

#### 11.2.4 Telavancin
```
Mechanism: Lipoglycopeptide; disrupts cell wall + membrane
Dose: 10 mg/kg q24h (normal renal function)
Renal adjustment:
  CrCl 30–50: 7.5 mg/kg q24h
  CrCl 10–29: 10 mg/kg q48h
  AVOID in CrCl < 10 or HD (inadequate data)

Monitoring: SCr every 48–72h (nephrotoxicity similar to vancomycin)
Caution: QTc prolongation — obtain baseline ECG; avoid in QTc > 500ms
Pregnancy: Category C (fetal harm in animal studies) — avoid

Advantages: Active vs. vancomycin-intermediate strains
Disadvantages: Nephrotoxic, QTc risk, teratogenic, expensive
```

#### 11.2.5 Oritavancin / Dalbavancin (Long-Acting Lipoglycopeptides)
```
Oritavancin: Single 1200 mg IV dose (SSTI); can be weekly for osteomyelitis
Dalbavancin:  1500 mg single dose OR 1000 mg + 500 mg at day 8 (SSTI)

USE CASE: Uncomplicated SSTI (not bacteremia, not endocarditis)
OPAT advantage: Single-dose eliminates daily infusion burden

Monitoring: None required for single-dose SSTI
Avoid: Bacteremia, endocarditis (insufficient data for deep infections)
```

### 11.3 Alternative Therapy Recommendation Display Format
```
Display triggered as panel with:
  Header: "⚠ Alternative Therapy Consideration"
  Trigger reason: [exact trigger condition met]
  
  Comparison table:
  Agent       | Mechanism | Dose | AUC Target | Renal Adj | Key Risk | Best For
  Daptomycin  | ...       | ...  | ...        | ...       | CPK      | Bacteremia (non-pulm)
  Linezolid   | ...       | ...  | ...        | ...       | Plt, SS  | Osteomyelitis, oral step
  Ceftaroline | ...       | ...  | ...        | ...       | Hemolysis| VISA, combination
  
  Recommendation: "For [patient profile], preferred alternative is [agent]
  because [reason]. Consult Infectious Diseases if not already involved."
  
  Evidence badge: [A-II | B-II | B-III] per agent/indication
```

---

## MODULE 12: DRUG INTERACTION MATRIX

### 12.1 Pharmacokinetic Interactions (Affect Vancomycin Levels)
```
Drug                    | Interaction Type        | Magnitude | Clinical Action
------------------------|-------------------------|-----------|------------------
Aminoglycosides         | Synergistic nephrotox   | HIGH      | Daily SCr; avoid if possible
Piperacillin-tazobactam | Synergistic nephrotox   | HIGH      | Daily SCr; consider alternatives
Amphotericin B (IV)     | Additive nephrotox      | HIGH      | Daily SCr; strongly consider switch
Colistin/polymyxin B    | Additive nephrotox      | HIGH      | Daily SCr; consult pharmacy
Loop diuretics          | Volume depletion→↑SCr   | MODERATE  | Monitor fluid balance + SCr q48h
NSAIDs                  | ↓Renal perfusion→↑SCr  | MODERATE  | Avoid concurrent if possible
ACE inhibitors/ARBs     | ↓GFR effect             | LOW-MOD   | Monitor SCr weekly
Calcineurin inhibitors  | Additive nephrotox      | HIGH      | Daily SCr; narrow TI interaction
Cisplatin/ifosfamide    | Additive nephrotox      | HIGH      | Hold if chemo concurrent
Contrast (iodinated)    | Transient ↓GFR          | MODERATE  | Hold vanco 24–48h around contrast
TMP-SMX                 | ↓Tubular SCr secretion  | LOW       | May falsely elevate SCr (artifact)
Probenecid              | ↓Tubular secretion      | LOW       | Similar SCr artifact
```

### 12.2 Pharmacodynamic Interactions (Affect Effect/Toxicity)
```
Drug                    | PD Interaction          | Magnitude | Clinical Action
------------------------|-------------------------|-----------|------------------
Linezolid               | Serotonin syndrome risk | HIGH      | Screen for all serotonergic drugs
(+SSRIs/SNRIs/TCAs)     | (if switching)          |           | 14-day washout before/after MAOIs
Neuromuscular blockers  | Prolonged NMB (rare)    | LOW       | Monitor NMB recovery in ICU
Warfarin                | Possible ↑INR (indirect)| LOW       | Monitor INR weekly if on warfarin
Methotrexate            | ↑MTX toxicity (↑levels) | MODERATE  | Hold vanco if high-dose MTX
Digoxin                 | Possible ↑digoxin conc  | LOW       | Monitor digoxin levels
```

### 12.3 Infusion Compatibility (IV Line)
```
INCOMPATIBLE with vancomycin in same line:
  - Piperacillin-tazobactam (precipitate — HIGH risk Y-site)
  - Cefepime (alkaline pH precipitate)
  - Heparin (precipitate at concentrations > 100 units/mL)
  - Phenytoin (precipitate)
  - Diazepam (precipitate)
  - Chloramphenicol (incompatible)
  - Bicarbonate solutions (alkaline → degradation)
  - Albumin solutions (adsorption)
  - Warfarin (incompatible)
  - Furosemide (incompatible at high concentrations)

COMPATIBLE (but verify concentration):
  - Normal Saline (preferred diluent)
  - D5W (acceptable)
  - LR (generally compatible, check concentration)
  - Metronidazole (Y-site compatible at standard concentrations)
  - Most fluoroquinolones (compatible)

For CI vancomycin: dedicated lumen MANDATORY (see Module 2)
```

### 12.4 Red Man Syndrome (Infusion Reaction — Not True Allergy)
```
Mechanism: Non-IgE-mediated mast cell degranulation → histamine release
Onset: During or shortly after rapid infusion
Symptoms: Flushing, erythema (neck/face/upper torso), pruritus, +/- hypotension

NOT a contraindication to vancomycin; managed by:
  1. SLOW infusion rate: minimum 60 min per 1g (standard); high doses over 2–3h
  2. Diphenhydramine 25–50 mg IV 30–60 min before infusion
  3. If hypotension: stop infusion, IV fluids, antihistamine
  4. Resume at slower rate after resolution

Software alert logic:
  IF dose > 1500 mg → "Infuse over minimum 2h to reduce Red Man Syndrome risk"
  IF prior Red Man documented → "Pre-medicate: diphenhydramine 25–50 mg IV 30 min prior"
  IF hypotension with infusion noted → "STOP INFUSION — evaluate for Red Man Syndrome"
```

---

## MODULE 13: POPULATION SIMULATION & MONTE CARLO TARGET ATTAINMENT

### 13.1 Purpose
Allow users to see the PROBABILITY that a proposed dose achieves AUC 400–600 for a population of patients similar to theirs. This is how dosing tables are validated in the literature (Monte Carlo Simulation, MCS).

### 13.2 Simplified MCS Implementation
```javascript
// Monte Carlo simulation: 1000 virtual patients
// Draw CL and Vd from log-normal distributions
// Calculate AUC for each patient at proposed dose
// Report % within 400–600 mg·h/L

function monte_carlo_target_attainment(
  dose_mg, tau_h, tinf_h,
  mean_CL, cv_CL,       // coefficient of variation (fraction)
  mean_Vd, cv_Vd,
  n = 1000
) {
  const sigma_CL = Math.sqrt(Math.log(1 + cv_CL * cv_CL));
  const sigma_Vd = Math.sqrt(Math.log(1 + cv_Vd * cv_Vd));
  const mu_CL = Math.log(mean_CL) - sigma_CL * sigma_CL / 2;
  const mu_Vd = Math.log(mean_Vd) - sigma_Vd * sigma_Vd / 2;

  let in_target = 0, below = 0, above = 0;
  const auc_dist = [];

  for (let i = 0; i < n; i++) {
    // Box-Muller transform for normal random variates
    const u1 = Math.random(), u2 = Math.random();
    const z1 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    const z2 = Math.sqrt(-2 * Math.log(u1)) * Math.sin(2 * Math.PI * u2);

    const CL_i = Math.exp(mu_CL + sigma_CL * z1);
    const Vd_i = Math.exp(mu_Vd + sigma_Vd * z2);
    const ke_i = CL_i / Vd_i;

    // Steady-state AUC from clearance method
    const auc_i = (dose_mg * (24 / tau_h)) / CL_i;
    auc_dist.push(auc_i);

    if (auc_i >= 400 && auc_i <= 600) in_target++;
    else if (auc_i < 400) below++;
    else above++;
  }

  const pct_target = (in_target / n * 100).toFixed(1);
  const pct_sub = (below / n * 100).toFixed(1);
  const pct_supra = (above / n * 100).toFixed(1);
  const median_auc = auc_dist.sort((a,b) => a-b)[Math.floor(n/2)];

  return { pct_target, pct_sub, pct_supra, median_auc, auc_dist };
}
```

### 13.3 MCS Display Output
```
"For patients with similar characteristics (CrCl ~[X] mL/min, [mode]),
 a dose of [X] mg q[τ]h is predicted to achieve:

  ✅ AUC 400–600 mg·h/L (target):    [X]% of patients
  ⚠ AUC < 400 (subtherapeutic):     [X]% of patients
  ⚠ AUC > 600 (supratherapeutic):   [X]% of patients

  Median predicted AUC: [X] mg·h/L
  [Distribution histogram — SVG bar chart]

  Interpretation: [Excellent ≥80% | Acceptable 60–79% | Poor <60%] target attainment
  Recommendation: [Continue / Adjust dose to improve TA]"
```

### 13.4 Target Attainment Benchmarks (Literature Reference)
```
> 80% target attainment: Acceptable for empiric dosing
60–80%: Borderline; consider adjusting dose upward for serious infections
< 60%: Inadequate; dose needs revision or alternative

Reference: Neely et al. AAC 2014; Rybak et al. AJHSP 2020
```

---

## MODULE 14: CLINICAL SCENARIO LIBRARY (BUILT-IN CASES)

### 14.1 Purpose
Pre-loaded educational and validation cases. Allow users to:
  - Verify calculator accuracy against known outcomes
  - Train pharmacists/students
  - Test edge cases before production use

### 14.2 Scenario Definitions
```
SCENARIO 1 — "Standard Adult, Stable"
  72M, 80 kg, 175 cm, SCr 1.2, CrCl ~52 mL/min
  Regimen: Vancomycin 1250 mg q12h
  Levels: Trough 13.5 mg/L at 11.5h, Peak 28.2 mg/L at 2h
  Expected: AUC₂₄ ≈ 490 mg·h/L → Therapeutic ✓
  Teaching point: Standard monitoring, 2-level Bayesian

SCENARIO 2 — "Obese, Subtherapeutic"
  45F, 125 kg (BMI 46), 165 cm, SCr 0.9, CrCl ~108 mL/min (IBW-based 68; AdjBW ~95kg)
  Regimen: 1000 mg q12h (underdosed by weight)
  Level: Trough 7.2 mg/L
  Expected: AUC₂₄ ≈ 280 mg·h/L → Subtherapeutic
  Teaching point: Use ABW for obese dosing; Crass 2018 prior increases estimate of CL

SCENARIO 3 — "AKI Developing"
  58M, 75 kg, SCr baseline 1.0 → current 1.6 mg/dL (KDIGO Stage 1 met)
  On: Vancomycin 1500 mg q12h + pip/tazo
  Previous AUC 520 → Now AUC 720 (accumulation from AKI)
  Expected: KDIGO alert + AUC > 700 hard stop + pip/tazo nephrotoxin alert
  Teaching point: AKI causes drug accumulation; pip/tazo combination

SCENARIO 4 — "Hemodialysis, Scheduled MWF"
  67M, HD patient (ESRD), 70 kg
  Received 1000 mg after last HD (72h ago)
  Pre-dialysis level drawn: 9.8 mg/L
  Expected: Below target (15–20 mg/L pre-HD); recommend 750–1000 mg redose post-HD
  Teaching point: Pre-HD concentration monitoring; level-based redosing

SCENARIO 5 — "Neonatal, Preterm"
  Neonate: PMA 28 weeks, weight 1.1 kg, SCr 0.8 mg/dL, postnatal age 5 days
  Expected dose: 15 mg/kg = 16.5 mg → round to 15 mg
  Expected interval: q24–36h (PMA ≤28 + weight 1–2.5 kg + SCr > threshold)
  Teaching point: SCr at postnatal day 5 is reliable (>72h); preterm dosing conserved

SCENARIO 6 — "CRRT, Critically Ill"
  52M, ICU, CRRT (effluent 22 mL/kg/h), ABW 85 kg, SCr 3.2 (anuric)
  Loading dose needed + maintenance
  Expected: LD = 1700–2125 mg (20–25 mg/kg × 85kg); maintenance 637–850 mg q12h
  Teaching point: Loading dose required (Vd-based); CRRT prior overrides CG-CrCl

SCENARIO 7 — "High MIC, Treatment Failure"
  55M, MRSA bacteremia, MIC by BMD = 2 mg/L
  AUC 520 mg·h/L → AUC/MIC = 260 (below 400 threshold even with therapeutic AUC)
  Expected: Alternative therapy trigger → Daptomycin 8 mg/kg q24h recommended
  Teaching point: MIC matters; AUC target relative to MIC

SCENARIO 8 — "Pediatric, Normal Renal"
  8F, 28 kg, 125 cm, SCr 0.5
  Schwartz CrCl = 0.55 × 125 / 0.5 = 137.5 mL/min/1.73m²
  Expected dose: 60–80 mg/kg/day ÷ q6h = 420–560 mg q6h
  Teaching point: Pediatric faster CL; Schwartz not Cockcroft-Gault

SCENARIO 9 — "Continuous Infusion Initiation"
  45M, ICU, CrCl 65 mL/min, ABW 78 kg, MRSA pneumonia + bacteremia
  CLv = 65×0.041+0.22 = 2.885 L/h
  Target Css = 22 mg/L
  LD = 1560 mg (20 mg/kg) → CI rate = 22 × 2.885 = 63.5 mg/h ≈ 65 mg/h
  Teaching point: CI requires loading dose; rate = Css × CLv

SCENARIO 10 — "OPAT Candidate Assessment"
  34F, MRSA osteomyelitis, AUC stable × 3 checks (480–520), SCr stable × 5 days
  CrCl 78, no nephrotoxins, PICC placed, reliable follow-up
  Expected: OPAT eligible ✓ → Generate OPAT monitoring schedule
  Teaching point: OPAT criteria; transition monitoring requirements
```

---

## MODULE 15: INSTITUTIONAL CUSTOMIZATION LAYER

### 15.1 Configurable Parameters (Per-Institution Settings)
```
Institution Settings Panel (admin-only):
  - Default target AUC (400–600 or custom range)
  - Default MIC assumption (1.0 or institution-specific MRSA surveillance)
  - Preferred AUC method (Bayesian preferred / First-order equations / Both)
  - Preferred Bayesian prior model (Matzke / Crass 2018 / Custom upload)
  - Dose rounding increment (250 mg default; some institutions use 125 mg)
  - Maximum single dose cap (3000 mg default; adjustable)
  - Mandatory double-check threshold (e.g., flag for review if dose >2500 mg)
  - Institution-specific nephrotoxin list (add/remove drugs)
  - Custom alert thresholds (e.g., some institutions use AUC >650 not >600)
  - OPAT monitoring protocol (customize to institutional pharmacy agreement)
```

### 15.2 Pharmacist Sign-Off Layer
```
Any recommendation that triggers a hard-stop alert requires:
  - Pharmacist initials + timestamp (simple text field)
  - Reason for override (dropdown + free text)
  - Override categories:
      "Clinical judgment — patient-specific factor"
      "Attending physician direction"
      "Palliative intent — AUC monitoring deferred"
      "Patient declining levels"
      "Technical error — see note"
  
This creates an audit trail per encounter.
```

---

## MODULE 16: MASTER OPUS BUILD PROMPT

### 16.1 System Prompt for Opus
```
You are an expert clinical pharmacist and software engineer tasked with building
AinaDara Calc — a production-grade Vancomycin Therapeutic Drug Monitoring (TDM)
application as a SINGLE React JSX file.

CLINICAL FOUNDATION:
You are implementing the 2020 ASHP/IDSA/PIDS/SIDP Vancomycin Consensus
Guidelines (Rybak et al., CID 2020;71:1361–4 and AJHSP 2020;77:835–64).
Every clinical recommendation must be grounded in this guideline.

PRIMARY PK/PD TARGET:
AUC/MIC ratio 400–600 mg·h/L (assuming MIC = 1 mg/L by broth microdilution).
Trough-only monitoring is NO LONGER RECOMMENDED for serious MRSA infections.

─────────────────────────────────────────────────────────────
MATHEMATICAL ENGINE (implement exactly as specified):
─────────────────────────────────────────────────────────────

1. BAYESIAN MAP ESTIMATION (primary method):
   - Parameters: [lnCL, lnVd] — log-normal parameterization
   - Objective: minimize F(lnCL, lnVd) = prior_penalty + likelihood_penalty
     prior_penalty = 0.5 * [(lnCL - ln(CL_prior))² / σ_CL² + (lnVd - ln(Vd_prior))² / σ_Vd²]
     likelihood = Σ 0.5 * [(C_obs - C_pred)² / σ_assay²]
     where σ_assay = sqrt(additive_error² + (prop_error × C_pred)²)
   - Optimizer: gradient descent with Armijo line search (max 500 iterations)
   - Finite difference gradient: h = 0.001
   - Convergence: grad_norm < 1e-8
   - Concentration prediction: exact multi-dose superposition
     (sum over all doses in history, using exact dose/tinf/start_time)

2. SAWCHUK-ZASKE (fallback for 2 near-SS levels):
   Ke = (ln C1 - ln C2) / (t2 - t1)
   Cmax = C1 × e^(Ke × t_offset)  [t_offset = time from end of infusion to C1]
   Cmin = Cmax × e^(-Ke × (τ - tinf))
   Vd = Dose/(tinf×Ke) × (1 - e^(-Ke×tinf)) / ((1 - e^(-Ke×τ)) × Cmax)
   CLv = Ke × Vd

3. AUC TRAPEZOIDAL:
   AUCinf = tinf × (Cmax + Cmin) / 2
   AUCelim = (Cmax - Cmin) / Ke
   AUC_τ = AUCinf + AUCelim
   AUC₂₄ = AUC_τ × (24 / τ)

4. POPULATION PK PRIORS:
   Standard (Matzke 1984):     CL = CrCl×0.041 + 0.22 L/h; Vd = 0.7 L/kg; σ_CL=0.35; σ_Vd=0.30
   Obese (Crass 2018):         CL = 9.656 - 0.078×age - 2.009×SCr + 1.09×sex + 0.04×TBW^0.75; Vd=0.4×TBW; σ=0.32/0.28
   Pediatric (Modified Goti):  CL = CrCl×0.038 + 0.18 L/h; Vd = 0.65 L/kg; σ_CL=0.40; σ_Vd=0.35
   Neonatal (Grimsley-Thomson): CL by PMA band (see neonatal table); Vd = 0.69 L/kg; σ=0.45/0.40
   CRRT:                       CL_fixed = 1.8 L/h; Vd = 0.85×ABW; σ=0.40/0.40
   HD (interdialytic):         CL = 0.10 L/h; Vd = 0.75×ABW; σ=0.35/0.35

5. COCKCROFT-GAULT:
   CrCl = [(140-age) × weight] / (72 × SCr) × 0.85 (if female)
   weight = IBW if ABW ≤ IBW; else AdjBW = IBW + 0.4×(ABW - IBW)
   IBW_male = 50 + 2.3×(height_in - 60); IBW_female = 45.5 + 2.3×(height_in - 60)

6. SCHWARTZ (pediatric CrCl):
   CrCl = k × height_cm / SCr
   k: preterm=0.33, infant=0.45, child=0.55, adolescent_female=0.55, adolescent_male=0.70
   Adjust to actual CrCl: × BSA / 1.73; BSA = sqrt(ht_cm × wt_kg / 3600)

7. NEONATAL CL (Grimsley-Thomson):
   PMA ≤ 28wk: CL = 0.0131×wt + 0.0087 L/h
   PMA 29–36wk: CL = 0.0248×wt + 0.0120 L/h
   PMA 37–44wk: CL = 0.0303×wt + 0.0160 L/h
   PMA > 44wk:  CL = 0.0370×wt + 0.0220 L/h
   If SCr > 0.7 (term) or > 1.0 (preterm): CL_corrected = CL × (0.5/SCr)

8. CI RATE CALCULATOR:
   CI_rate_mg_h = Target_Css × CLv
   AUC₂₄ = Css × 24
   Loading_dose = 15–20 mg/kg (ABW), cap 3000 mg
   Adjustment: New_rate = Current_rate × (Target_Css / Measured_Css)

9. MONTE CARLO (1000 patients):
   Log-normal sampling of CL and Vd using Box-Muller transform
   AUC_i = TDD_i / CL_i
   Report: %[400–600], %[<400], %[>600], median AUC, histogram

10. KDIGO AKI:
    Stage 1: SCr ↑ ≥ 0.3 mg/dL in 48h OR SCr ≥ 1.5× baseline in 7 days
    Stage 2: SCr ≥ 2× baseline
    Stage 3: SCr ≥ 3× baseline

─────────────────────────────────────────────────────────────
APPLICATION ARCHITECTURE:
─────────────────────────────────────────────────────────────

STATE MANAGEMENT:
Use useReducer with this exact state shape:
{
  patient: { id, age, sex, height_cm, abw_kg, mode, pma_weeks, pma_days,
             hd_settings, crrt_settings, ci_settings },
  encounters: [ { id, timestamp, type, labs, dosing_history, levels,
                  pk_results, recommendation, alerts, aki_status,
                  nephrotoxins, notes } ],
  current_encounter_id,
  saved_patients: [],   // LocalStorage persisted
  alerts: [],
  ui: { activeTab, showMath, showMC, darkMode }
}

REDUCER ACTIONS:
  SET_PATIENT_FIELD, ADD_ENCOUNTER, UPDATE_ENCOUNTER, SET_CURRENT_ENCOUNTER,
  ADD_DOSE, REMOVE_DOSE, ADD_LEVEL, REMOVE_LEVEL, RUN_CALCULATION,
  SAVE_PATIENT, LOAD_PATIENT, CLEAR_PATIENT, TOGGLE_UI

PERSISTENCE:
  useEffect to sync encounters[] and saved_patients[] to localStorage
  on every state change. Load on mount.

─────────────────────────────────────────────────────────────
TABS / MODES (7 clinical modes as top-level tabs):
─────────────────────────────────────────────────────────────
  1. Standard Adult     — Matzke prior, CG-CrCl, 2-level or trough Bayesian
  2. Obese              — Crass 2018, ABW dosing, must require 2-level
  3. Hemodialysis       — Pre-HD conc target 15–20, weekly monitoring, redose logic
  4. CRRT               — Fixed CL prior, loading + 7.5–10 mg/kg q12h
  5. AKI / Unstable     — SCr trajectory, daily Bayesian, non-SS levels valid
  6. Neonatal/Pediatric — PMA-based (neonate) or Schwartz (pediatric), age-appropriate dose
  7. Continuous Infusion— CI rate calculator, Css monitoring, incompatibility alerts

─────────────────────────────────────────────────────────────
COMPONENTS TO BUILD:
─────────────────────────────────────────────────────────────

PatientHeader        — Demographics, auto-calc IBW/BMI/CrCl, mode badge
DosingHistoryPanel   — Add/remove doses with start_time, dose, tinf, tau
LevelEntryPanel      — Add/remove levels with time_abs, conc, type selector
CalculateButton      — Full Bayesian analysis trigger
AlertBanner          — Priority-sorted: DANGER > WARN > INFO
PKResultsPanel       — Method used, prior vs posterior params, AUC gauge
RecommendationBox    — Current regimen → AUC vs Recommended → Pred AUC
PKChart (SVG)        — Obs levels + fitted curve + projected recommended curve
GaugeChart (SVG)     — AUC bar with 400/600 markers and needle
MCHistogram (SVG)    — Distribution of AUC across simulated population
EncounterTimeline    — Longitudinal SCr + AUC + dose change annotations
AlternativeTherapy   — Triggered panel with agent comparison table
DrugInteractionPanel — Active interaction warnings
FormulaTooltip       — Hover/click to reveal math + evidence grade
OPATChecklist        — Eligibility + monitoring schedule generator
NeonatalDoseTable    — PMA-based dosing recommendation display
PDFExportButton      — jsPDF multi-page clinical report
ScenarioLoader       — Pre-built educational cases dropdown

─────────────────────────────────────────────────────────────
ALERT SYSTEM (implement exactly):
─────────────────────────────────────────────────────────────
HARD STOPS (block proceed, require acknowledgment):
  - AUC > 700 mg·h/L
  - Single dose > 3000 mg
  - Daily dose > 4500 mg (obese) or > 4000 mg (standard)
  - KDIGO AKI Stage 1+ (SCr criteria met)
  - Ke < 0 (timing error)
  - Level drawn during infusion phase

SOFT ALERTS (display, do not block):
  - AUC 600–700: "Approaching nephrotoxicity threshold"
  - AUC < 400: "Subtherapeutic — treatment failure risk"
  - MIC > 1: "Consider alternative therapy"
  - Pip/tazo co-administration
  - CrCl > 130 (ARC): "Augmented renal clearance — may need higher/more frequent doses"
  - Duration > 14 days: "Prolonged therapy — review necessity"
  - Trough only + obese: "Two-level monitoring required for obese patients"
  - SCr rising: classify trajectory (worsening/stable/recovering)
  - Level drawn < 1h post-infusion: "Possible distribution phase — verify timing"

─────────────────────────────────────────────────────────────
VALIDATION RULES (run before every calculation):
─────────────────────────────────────────────────────────────
Hard stops (abort calc):
  SCr ≤ 0; weight < 0.3 or > 300 kg; height < 30 or > 250 cm; age < 0 or > 120
  dose < 100 or > 5000 mg; Ke < 0 after Sawchuk-Zaske
  level drawn BEFORE dose start time
  C1 > C2 when expecting decline (timing likely reversed)

Soft warnings:
  t½ < 2h or > 150h; Vd < 0.2 or > 1.5 L/kg; CL < 0.5 L/h (non-ESRD)
  AUC < 100 or > 1200 mg·h/L; Peak > 60 mg/L; SCr > 15 (non-HD)

─────────────────────────────────────────────────────────────
VISUAL DESIGN SPECIFICATION:
─────────────────────────────────────────────────────────────
Theme: Dark clinical — deep navy/slate backgrounds, not pure black
Primary accent: #00d4ff (cyan — clinical precision feel)
Success/therapeutic: #00e5a0 (teal-green)
Warning: #f59e0b (amber)
Danger: #ff4757 (red)
Purple accent: #a78bfa (for projected/future curves)

Typography:
  Display: 'DM Sans' — weight 800 for headers
  Monospace: 'DM Mono' — for all PK values and numbers
  Load from Google Fonts CDN

Layout: Two-column (inputs left, results right) on desktop
         Single-column stacked on mobile (responsive breakpoint 768px)

Charts: SVG only (not Canvas) — required for PDF export compatibility

Key UX principles:
  - Calculate button always visible (sticky if needed)
  - Alert banners appear immediately above results
  - Tooltips on every formula value (tap/hover: "Show Math")
  - Evidence grade badges (A-II, B-II, etc.) on every recommendation
  - "Dose Rounded" annotation when nearest 250 mg applied
  - All times in hours-from-zero (not wall clock) to avoid timezone errors

─────────────────────────────────────────────────────────────
PDF EXPORT (jsPDF implementation):
─────────────────────────────────────────────────────────────
Load jsPDF from: https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js

Pages:
  Page 1: Patient summary, regimen, indication, MIC
  Page 2: PK analysis — method, prior vs posterior table, levels table
  Page 3: Dose recommendation — current vs recommended, rationale
  Page 4: Safety — AKI status, nephrotoxins, active alerts
  Page 5: Concentration-time chart (SVG serialized to canvas → base64)

Footer: "AinaDara Calc TDM | 2020 ASHP/IDSA Guidelines | Clinical Decision Support Only"

─────────────────────────────────────────────────────────────
EDUCATIONAL LAYER:
─────────────────────────────────────────────────────────────
FormulaTooltip component behavior:
  Each calculated value has an ⓘ icon
  On hover/tap: slide-down panel showing:
    - Formula name + citation
    - Variables substituted with actual patient values
    - Result
    - Evidence grade
    - Brief clinical interpretation

Pre-loaded clinical scenarios (dropdown "Load Scenario"):
  10 built-in cases covering: standard, obese, AKI, HD, neonatal,
  pediatric, CRRT, CI, high MIC, OPAT
  Each scenario auto-populates all fields; user runs calculation to see expected output

─────────────────────────────────────────────────────────────
TECHNICAL CONSTRAINTS:
─────────────────────────────────────────────────────────────
  - Single .jsx file ONLY
  - All PK math in pure JavaScript (no mathjs, no PK library)
  - No useState for complex state — useReducer ONLY
  - localStorage for persistence (not IndexedDB for simplicity)
  - Recharts for timeline/longitudinal charts
  - SVG for PK curve and gauge (custom, not Recharts)
  - jsPDF from CDN for PDF export
  - Google Fonts loaded via @import in <style> tag
  - No TypeScript (plain JSX)
  - React + hooks only (no Redux, no Zustand, no external state)
  - All Tailwind-like styling via inline style objects (no Tailwind CDN)
  - Mobile responsive via CSS grid with minmax and auto-fit

─────────────────────────────────────────────────────────────
BUILD ORDER (recommended for Opus):
─────────────────────────────────────────────────────────────
Phase 1 — Core engine (build + test math first):
  1. All PK math functions (pure JS, no UI)
  2. Bayesian MAP optimizer with test cases
  3. Sawchuk-Zaske with validation
  4. AUC trapezoidal
  5. Dose recommendation algorithm
  6. KDIGO AKI checker
  7. Validation layer

Phase 2 — State and data layer:
  8. useReducer with full state shape
  9. localStorage persistence hooks
  10. Encounter management (add/update/history)

Phase 3 — Core UI:
  11. PatientHeader + demographics panel
  12. DosingHistoryPanel
  13. LevelEntryPanel
  14. CalculateButton + alert system
  15. PKResultsPanel + RecommendationBox
  16. PKChart (SVG concentration-time)
  17. GaugeChart (AUC meter)

Phase 4 — Advanced modes:
  18. Neonatal/Pediatric mode (Grimsley + Schwartz)
  19. HD mode (pre-dialysis conc logic)
  20. CRRT mode
  21. AKI/random level mode
  22. CI rate calculator
  23. OPAT module

Phase 5 — Advanced features:
  24. Monte Carlo simulation + histogram
  25. Alternative therapy panel
  26. Drug interaction matrix
  27. Encounter timeline (longitudinal chart)
  28. FormulaTooltip educational layer
  29. Scenario library loader
  30. PDF export (jsPDF)

─────────────────────────────────────────────────────────────
QUALITY CHECKLIST (Opus must verify before finalizing):
─────────────────────────────────────────────────────────────
  □ Bayesian MAP converges on known test case (Scenario 1 → AUC ~490)
  □ Sawchuk-Zaske produces same Ke/Vd as manual calculation
  □ AUC trapezoidal matches clearance method within 5% (stable patients)
  □ Cockcroft-Gault matches online calculator for same inputs
  □ Crass 2018 formula implemented correctly (check obese scenario)
  □ Grimsley-Thomson neonatal CL matches expected range
  □ All 10 clinical scenarios produce clinically sensible output
  □ KDIGO AKI triggers correctly on Scenario 3
  □ Alternative therapy panel fires on MIC = 2 mg/L (Scenario 7)
  □ PDF exports all 5 pages with charts
  □ LocalStorage persists across browser refresh
  □ Mobile layout works (single column < 768px)
  □ All hard-stop alerts block calculation
  □ All formula tooltips show correct substituted values
  □ CI rate calculator: rate = Css × CLv (verify numerically)
  □ Monte Carlo produces ~normal AUC distribution centered on expected AUC
```

---

## MODULE 17: OPTIMIZED PROMPT VARIANTS FOR SPECIFIC TASKS

### 17.1 Pure Math Engine Build Prompt
```
Build the AinaDara Calc pharmacokinetic math engine as pure JavaScript functions.
No UI. Include:

1. bayesian_map(levels, dosing_history, prior_CL, prior_Vd, sigma_CL, sigma_Vd)
   → returns { CL, Vd, ke, t_half }
   
2. sawchuk_zaske(C1, t1, C2, t2, dose, tinf, tau)
   → returns { ke, Cmax, Cmin, Vd, CLv, t_half }
   
3. auc_trapezoidal(Cmax, Cmin, ke, tinf, tau)
   → returns AUC24
   
4. predict_ss_concentrations(dose, tinf, ke, Vd, tau)
   → returns { Cmax, Cmin, AUC24 }
   
5. cockcroft_gault(age, weight, SCr, sex)
6. ibw(height_cm, sex) 
7. adjbw(abw, ibw)
8. bmi(weight, height_cm)
9. crass_2018_CL(age, SCr, sex, TBW)
10. grimsley_thomson_CL(pma_weeks, weight_kg, SCr)
11. schwartz_CrCl(height_cm, SCr, age_years, sex)
12. ci_rate(target_Css, CLv) → returns { rate_mg_h, daily_dose, LD_range }
13. recommend_dose(CL, target_AUC, preferred_intervals) → returns { dose, tau, predicted_AUC }
14. kdigo_aki(baseline_SCr, current_SCr, hours_elapsed) → returns { stage, reason } | null
15. monte_carlo_pta(dose, tau, tinf, mean_CL, cv_CL, mean_Vd, cv_Vd, n=1000)
    → returns { pct_target, pct_sub, pct_supra, median_AUC, distribution }
16. validate_inputs(patient, levels, doses) → returns { hard_stops[], soft_warnings[] }

Test each function with the 10 clinical scenarios defined in the brain document.
All functions should be pure (no side effects, no DOM, no React).
Export as a module object: { bayesian_map, sawchuk_zaske, ... }
```

### 17.2 UI Shell Build Prompt
```
Given the PK engine module above, build the AinaDara Calc React UI shell.
Import and use the engine functions — do not rebuild the math.

Build exactly these components with the dark clinical theme:
  - 7-mode tab bar (Standard / Obese / HD / CRRT / AKI / Neonatal+Peds / CI)
  - PatientHeader with auto-calculated IBW, BMI, CrCl
  - DosingHistoryPanel (dynamic rows, add/remove)
  - LevelEntryPanel (dynamic rows, type selector, timing validation)
  - AlertBanner (priority sorted)
  - PKResultsPanel with GaugeChart (SVG AUC meter)
  - RecommendationBox (current vs recommended side-by-side)
  - PKChart (SVG concentration-time with observed dots + projected curve)

State: useReducer with shape from brain document.
No PDF, no Monte Carlo, no OPAT in this shell — add those in next phase.
```

### 17.3 Features Patch Prompts (Incremental)
```
// PATCH A — Add Monte Carlo
"Add a MonteCarlo component to the AinaDara Calc app.
After dose recommendation, add a 'Simulate Population' button.
On click: run monte_carlo_pta() with patient's estimated CL/Vd and their CV.
Display: SVG histogram of AUC distribution across 1000 patients,
with %target, %sub, %supra labeled.
Keep component under 150 lines."

// PATCH B — Add PDF Export
"Add PDF export to AinaDara Calc using jsPDF from CDN.
ExportButton triggers: 5-page PDF per spec:
  P1: patient/regimen, P2: PK analysis, P3: recommendation,
  P4: safety/alerts, P5: serialize PKChart SVG to canvas → base64.
Button appears in PKResultsPanel header."

// PATCH C — Add Encounter History
"Add encounter persistence to AinaDara Calc.
Each time 'Run Bayesian Analysis' is clicked, save result to encounters[]
in localStorage via reducer. Add EncounterTimeline component:
Recharts LineChart with dual y-axes: AUC24 (left, 0–800) and SCr (right, 0–5).
Dose changes as reference lines. Show last 10 encounters."

// PATCH D — Add Alternative Therapy
"Add AlternativeTherapyPanel to AinaDara Calc.
Trigger when: MIC > 1 OR KDIGO AKI Stage 2+ OR AUC > 700 on 2 checks.
Show agent comparison table (daptomycin, linezolid, ceftaroline) with
dose, renal adjustment, key risk, best indication.
Contraindication logic: hide daptomycin if infection_type = 'pneumonia'."
```

---

## MODULE 18: COMPLETE TOKEN BUDGET ESTIMATE FOR OPUS

```
Estimated complexity breakdown:

Math engine (pure JS):
  ~600 lines — can be built in 1 Opus call (~6K tokens output)

Core UI shell (React):
  ~1200 lines — 1 long Opus call (~12K tokens output)

Advanced modes (HD/CRRT/neonatal/CI patches):
  ~600 lines total — 2–3 shorter calls

Monte Carlo + charts:
  ~300 lines — 1 call

PDF export:
  ~200 lines — 1 call

Encounter history + timeline:
  ~400 lines — 1 call

Alternative therapy + drug interactions:
  ~300 lines — 1 call

Total estimated: ~3600 lines JSX

RECOMMENDED OPUS STRATEGY:
  Option A (clean): Build ALL in ONE mega-call with full prompt
    → Requires ~40K context window for prompt + ~36K for output
    → Risk: context limit may truncate
    
  Option B (chunked + merge): Build in 4 calls, merge manually
    → Call 1: Math engine + state architecture (~12K output)
    → Call 2: Core UI + charts (~15K output)
    → Call 3: Advanced modes + alerts (~8K output)
    → Call 4: PDF + history + alt therapy (~6K output)
    → Merge into single JSX file
    → RECOMMENDED APPROACH

  Option C (iterative patches): Start with Chunk 1 JSX from this project
    → Feed to Opus as starting point
    → Apply patch prompts A–D sequentially
    → Each call adds ~200–400 lines to existing file
    → MOST RELIABLE for accuracy
```

---

## CHUNK 3 COMPLETE SUMMARY

Modules delivered:
  ✅ M11: Alternative therapy engine (daptomycin/linezolid/ceftaroline/telavancin/long-acting)
  ✅ M12: Drug interaction matrix (PK + PD + IV incompatibilities + Red Man Syndrome)
  ✅ M13: Monte Carlo target attainment simulation (Box-Muller, 1000 patients, histogram)
  ✅ M14: Clinical scenario library (10 validated educational cases with expected outputs)
  ✅ M15: Institutional customization layer (settings panel + pharmacist sign-off)
  ✅ M16: MASTER OPUS BUILD PROMPT (complete, self-contained, ready to paste)
  ✅ M17: Optimized prompt variants (math engine / UI shell / incremental patches A–D)
  ✅ M18: Token budget estimate + recommended build strategy (Option C: iterative patches)

FULL PROJECT BRAIN STATUS:
  Chunk 1 → Bayesian MAP engine + clinical UI (JSX proof-of-concept)
  Chunk 2 → Advanced module specs (neonatal, CI, OPAT, AKI, multi-encounter, export)
  Chunk 3 → Alt therapy, interactions, Monte Carlo, scenarios, MASTER OPUS PROMPT

READY TO BUILD WITH OPUS.

---
*AinaDara Calc Brain Document v3.0 | March 2026 | Complete instruction set for Opus production build*
*References: Rybak 2020, Matzke 1984, Crass 2018, Grimsley-Thomson 1999, KDIGO 2012*


# ═══════════════════════════════════════════════════════════
# PART 2: ADVANCED MODULES (Neonatal, CI, OPAT, AKI, Validation)
# ═══════════════════════════════════════════════════════════

# AINADARA CALC — Therapeutic Drug Monitoring Suite — CHUNK 2 BRAIN DOCUMENT
## Advanced Modules: Neonatal, CI Rate Calculator, Multi-Encounter, OPAT, PDF Export
### Instruction Set for Opus Build

---

## MODULE 1: NEONATAL DOSING ENGINE
### 1.1 Clinical Background
Neonates represent the most PK-variable population. Vancomycin CL correlates primarily with postmenstrual age (PMA) and weight — NOT adult CrCl equations. Cockcroft-Gault is INVALID in neonates. Use SCr and PMA-based models.

### 1.2 Neonatal Population PK Model (Grimsley & Thomson 1999 / Salem 2014)
```
Primary model parameters (per kg):
  Vd  = 0.69 L/kg (range 0.4–0.9 L/kg; increases with prematurity/fluid overload)
  CL  = f(PMA, SCr, weight)

CL estimation by PMA (Grimsley-Thomson):
  PMA ≤ 28 weeks:  CL = 0.0131 × weight(kg) + 0.0087 L/h
  PMA 29–36 weeks: CL = 0.0248 × weight(kg) + 0.0120 L/h
  PMA 37–44 weeks: CL = 0.0303 × weight(kg) + 0.0160 L/h
  PMA > 44 weeks:  CL = 0.0370 × weight(kg) + 0.0220 L/h

SCr correction factor:
  If SCr > 0.7 mg/dL (term) or > 1.0 mg/dL (preterm):
    CL_corrected = CL × (0.5 / SCr)

Ke = CL / Vd
t½ = 0.693 / Ke
```

### 1.3 Neonatal Dosing Table (2020 Guidelines — Recommendation 25, Grade A-II)
```
PMA ≤ 28 weeks (extremely preterm):
  Dose:     15 mg/kg
  Interval: q24h (range q24–48h based on SCr)
  SCr > 1.0: extend to q36–48h

PMA 29–35 weeks (preterm):
  Dose:     15 mg/kg
  Interval: q18–24h

PMA 36–44 weeks (late preterm / term):
  Dose:     15 mg/kg
  Interval: q12–18h

PMA > 44 weeks (postnatal corrected):
  Dose:     15–20 mg/kg
  Interval: q8–12h

Weight-based adjustment:
  < 1.0 kg: q48h strongly preferred regardless of PMA
  1.0–2.5 kg: q24–36h
  > 2.5 kg: q12–24h based on PMA

Maximum single dose neonatal: 20 mg/kg (absolute)
```

### 1.4 Neonatal AUC Target
```
Target AUC: 400 mg·h/L (MIC = 1 mg/L)
  — Same target as adults
  — Upper safety limit: < 800 mg·h/L (B-II)
  — Trough ceiling: < 15 mg/L (to minimize AKI)

AUC Monitoring: Bayesian STRONGLY preferred
  — Optimal: peak (1h post-infusion) + trough (pre-dose)
  — First TDM: within 24–48h of starting therapy
  — Random level acceptable if exact timing documented
```

### 1.5 Neonatal SCr Interpretation Caveat
```
CRITICAL: In first 48–72h of life, SCr reflects MATERNAL SCr, not neonatal renal function.
  — Do not use SCr < 72h of life for CrCl estimation
  — After 72h: SCr should be falling; persistently elevated SCr = AKI
  — Use clinical urine output as adjunct: target > 1 mL/kg/h

Neonatal AKI (modified KDIGO):
  SCr rise ≥ 0.3 mg/dL from nadir within 48h
  OR SCr ≥ 1.5× prior value within 7 days
```

### 1.6 Software Input Fields — Neonatal Mode
```
Required:
  - PMA (postmenstrual age) in weeks + days
  - Postnatal age (days since birth)
  - Birth weight (kg)
  - Current weight (kg) — use for dosing
  - SCr (mg/dL) — flag if < 72h of life
  - Concurrent medications (gentamicin is common; FLAG nephrotoxin combination)
  - Fluid balance (positive balance → increased Vd; reduce concentration)

Auto-calculated:
  - Corrected gestational age
  - Dose recommendation by PMA + SCr
  - Expected t½
  - Time to steady state
  - Next monitoring recommendation
```

### 1.7 Neonatal Bayesian Prior Selection Logic
```
IF PMA ≤ 28 weeks → use Grimsley preterm model
IF PMA 29–36 weeks → use Grimsley midterm model
IF PMA > 36 weeks → use Grimsley term model
IF postnatal age > 28 days AND PMA > 44 weeks → transition to pediatric model
IF SCr > 1.0 → apply SCr correction factor
IF NICU, mechanically ventilated, vasopressors → Vd_prior × 1.3 (fluid overload)
```

---

## MODULE 2: CONTINUOUS INFUSION (CI) RATE CALCULATOR
### 2.1 Clinical Rationale
CI vancomycin achieves target earlier, has simpler AUC math, and may reduce nephrotoxicity vs. intermittent in critically ill. Target: steady-state concentration (Css) 20–25 mg/L.

```
AUC₂₄ = Css × 24
  → If Css = 20 mg/L → AUC₂₄ = 480 mg·h/L ✓ (therapeutic)
  → If Css = 25 mg/L → AUC₂₄ = 600 mg·h/L ✓ (therapeutic upper)
  → If Css = 15 mg/L → AUC₂₄ = 360 mg·h/L ✗ (subtherapeutic)
```

### 2.2 CI Dosing Algorithm
```
STEP 1 — Loading Dose (mandatory; achieves immediate target):
  LD = 15–20 mg/kg ABW (standard)
  LD = 20–25 mg/kg ABW (critically ill, CRRT)
  LD cap: 3000 mg
  Infuse LD over 1–2h before starting CI

STEP 2 — Initial CI Rate:
  CI_rate (mg/h) = Target_Css × CLv
  
  Where:
    Target_Css = 20 mg/L (conservative start) to 25 mg/L (MRSA bacteremia/endocarditis)
    CLv = estimated from CrCl (Matzke formula) OR Crass 2018 if obese

  Example:
    CrCl = 60 mL/min → CLv = 60×0.041+0.22 = 2.68 L/h
    Target Css = 22 mg/L
    CI_rate = 22 × 2.68 = 58.9 mg/h → round to 60 mg/h

STEP 3 — CI Daily Dose:
  CI_daily = CI_rate × 24

STEP 4 — Time to Steady State:
  SS ≈ 4–5 × t½
  First Css measurement: at SS (4–5 × t½ after LD)
  Practical: check Css at 24h in ICU patients (may not be SS but clinically useful)

STEP 5 — Dose Adjustment from Measured Css:
  New_CI_rate = Current_CI_rate × (Target_Css / Measured_Css)
  
  Example:
    Current rate: 60 mg/h, Measured Css: 18 mg/L, Target: 22 mg/L
    New rate = 60 × (22/18) = 73.3 mg/h → round to 75 mg/h

STEP 6 — Monitoring Css:
  Draw: at any time during steady-state CI (confirm timing documents at SS)
  Frequency:
    Stable patients: every 48–72h
    ICU/unstable: daily
    Changing renal function: every 24h
```

### 2.3 CI Rate Adjustment Table (Pre-calculated)
```
CrCl (mL/min) | CLv (L/h) | CI Rate for Css=20 | CI Rate for Css=25
< 20          | 1.02      | 20 mg/h            | 26 mg/h
20–40         | 1.44      | 29 mg/h            | 36 mg/h
40–60         | 1.86      | 37 mg/h            | 47 mg/h
60–80         | 2.68      | 54 mg/h            | 67 mg/h
80–100        | 3.50      | 70 mg/h            | 88 mg/h
100–130       | 4.33      | 87 mg/h            | 108 mg/h
> 130 (ARC)   | 5.55+     | 111+ mg/h          | 139+ mg/h (consider q6h intermittent)
```

### 2.4 CI Incompatibilities (Clinical Alert List)
```
ALWAYS flag these incompatibilities when CI vancomycin selected:
  HIGH RISK (separate line required):
    - Piperacillin/tazobactam (precipitates at Y-site)
    - Cefepime (pH incompatibility)
    - Meropenem (time-dependent; may use separate lumen)
    - Heparin (precipitate formation)
    - Phenytoin (precipitate)
    - Albumin (adsorption)
  
  ALERT TEXT: "Continuous infusion vancomycin requires a DEDICATED IV line or
  multi-lumen catheter. Cannot share lumens with listed incompatible agents."
```

### 2.5 CI Software Fields
```
Input:
  - ABW (kg) — for loading dose
  - CrCl (mL/min) — for initial rate
  - Target Css (mg/L) — default 20, range 20–25
  - Measured Css (mg/L) — for adjustment
  - Time of Css draw (confirm SS timing)
  - Infusion line type (peripheral/CVC/PICC)
  - Co-infusing medications (check incompatibility list)

Output:
  - Loading dose (mg over 1–2h)
  - Initial CI rate (mg/h)
  - Expected SS time (hours)
  - Adjusted rate (if Css provided)
  - AUC₂₄ from current Css
  - Incompatibility alerts
  - Monitoring schedule
```

---

## MODULE 3: MULTI-ENCOUNTER PATIENT HISTORY TRACKER
### 3.1 Data Architecture (Per Patient Session)
```
Patient Record:
  - MRN / Patient ID (local, de-identified)
  - Demographics (age, sex, height, ABW) — entered once, editable
  - Active diagnoses / infection type
  - Admission date / treatment start date

Per Encounter (each TDM check):
  encounter_id: sequential
  date_time: ISO timestamp
  encounter_type: [initial | follow_up | dose_adjustment | AKI_response | HD_session | discharge]
  
  Data captured:
    - SCr (current)
    - CrCl (recalculated each encounter)
    - Current regimen at time of encounter
    - Levels drawn (with exact times)
    - PK parameters estimated (Ke, Vd, CL — Bayesian posterior)
    - AUC₂₄ calculated
    - AUC status: [subtherapeutic | therapeutic | supratherapeutic]
    - Dose recommendation generated
    - Action taken: [no_change | dose_increased | dose_decreased | interval_changed | held | discontinued]
    - Clinician notes (free text)
    - Nephrotoxin list at time of encounter
    - AKI status (KDIGO stage if met)
```

### 3.2 Trending Logic
```
Between consecutive encounters, calculate:
  - SCr_delta = current_SCr − previous_SCr
  - CrCl_change (%) = (current_CrCl − prev_CrCl) / prev_CrCl × 100
  - AUC_trend = [stable | improving | worsening]
  - Ke_trend: flag if Ke changes > 20% between encounters
    (suggests changing renal function — update Bayesian prior)

Triggers for automatic re-assessment:
  - SCr rise ≥ 0.3 mg/dL → KDIGO AKI flag
  - CrCl change > 25% → "Renal function change — recalculate dose"
  - AUC drift outside 400–600 after being therapeutic → "AUC target lost — re-evaluate"
  - 2 consecutive sub/supratherapeutic AUCs → "Persistent target failure — escalate review"
```

### 3.3 Longitudinal Display Requirements
```
Timeline View:
  - Horizontal axis: treatment days (Day 0 to Day N)
  - Overlaid plots:
    a. AUC₂₄ over time (shaded therapeutic zone 400–600)
    b. SCr over time (right y-axis, inverted trend awareness)
    c. Trough/peak levels as scatter dots
    d. Dose changes annotated (vertical dashed line + label)
    e. HD sessions marked (gray shaded bands)
    f. AKI events marked (red markers)

Summary Table (per encounter row):
  Date | Regimen | Trough | Peak | AUC₂₄ | SCr | CrCl | Status | Action
```

### 3.4 Bayesian Prior Update Between Encounters
```
CRITICAL LOGIC:
  After encounter N, Bayesian posterior becomes the prior for encounter N+1
  
  Posterior_N → Prior_{N+1} with uncertainty update:
    new_sigma_CL = prior_sigma_CL × 0.7 (posterior is tighter than prior)
    new_sigma_Vd = prior_sigma_Vd × 0.7
    
  EXCEPTION — Reset prior to population if:
    - SCr change > 50% (major renal function change)
    - Patient moved to/from ICU
    - New nephrotoxin added
    - Mode change (e.g., started CRRT)
    
  Alert: "Significant renal function change detected. Bayesian prior reset to
  population model. New levels required before dose recommendation."
```

---

## MODULE 4: OPAT / OUTPATIENT TRANSITION MODULE
### 4.1 OPAT Eligibility Criteria (Clinical Decision Support)
```
OPAT (Outpatient Parenteral Antimicrobial Therapy) checklist:
  ✓ Clinically stable (hemodynamically, neurologically)
  ✓ Infection source controlled
  ✓ Oral route not appropriate/available
  ✓ Reliable IV access (PICC, Port, tunneled CVC)
  ✓ Patient/caregiver able to manage infusion OR home infusion service available
  ✓ Baseline stable renal function (CrCl stable × 48h)
  ✓ AUC therapeutic × 2 consecutive checks
  ✓ No active concurrent nephrotoxins (or clearly managed)
  ✓ Reliable phone/follow-up access

DISQUALIFYING:
  ✗ Active AKI or rapidly changing SCr
  ✗ AUC not at target
  ✗ Active hemodynamic instability
  ✗ No reliable IV access
```

### 4.2 OPAT Monitoring Schedule
```
Week 1 (first 7 days outpatient):
  - SCr + BUN: Day 2, Day 5, Day 7
  - Vancomycin level (trough or Bayesian): Day 3, Day 7
  - CBC (for leukopenia if prolonged): Day 7
  
Week 2–4 (stable):
  - SCr: twice weekly
  - Vancomycin AUC: weekly (at minimum)
  - CBC: weekly if > 2 weeks
  
Monthly (> 4 weeks):
  - SCr: weekly
  - AUC: weekly
  - CBC, LFTs: every 2 weeks
  - Audiogram: if > 4 weeks therapy (ototoxicity surveillance)
```

### 4.3 OPAT Alerts and Thresholds
```
Automatic OPAT escalation triggers:
  SCr rise ≥ 0.3 mg/dL → "HOLD vancomycin. Contact prescriber within 4h. AKI protocol."
  SCr ≥ 1.5× baseline → "HOLD vancomycin. Emergency reassessment required."
  AUC < 400 → "Subtherapeutic. Dose adjustment required before next infusion."
  AUC > 600 → "Supratherapeutic. Contact pharmacist within 24h."
  AUC > 700 → "HOLD next dose. Urgent pharmacist contact required."
  New symptoms: rash, flushing, hypotension → "Red Man Syndrome — slow infusion rate"
  Hearing changes → "Possible ototoxicity — HOLD and evaluate urgently"
```

### 4.4 OPAT Dose Preparation Notes
```
Stability data (for home infusion compounding):
  Standard concentration: 5 mg/mL in NS or D5W
  Elastomeric pump: 500–1000 mg / 100 mL NS
  Stable: 72h at 4°C (refrigerated), 24h at room temperature
  
Infusion Rate Requirement:
  NEVER infuse faster than 10 mg/min
  Standard: 500 mg/h (e.g., 1000 mg over 2h)
  High doses: 1500–2000 mg over 2–3h minimum
  
Red Man Syndrome prevention:
  Always infuse ≥ 1h per 1000 mg
  Premedicate with diphenhydramine 25–50mg IV if prior reaction
```

---

## MODULE 5: RANDOM LEVEL / AKI MODE
### 5.1 Clinical Context
In AKI or ICU patients, levels may be drawn at non-standard times. Bayesian is the ONLY valid method here — Sawchuk-Zaske requires near-steady-state, which may never be reached in rapidly changing renal function.

### 5.2 Random Level Algorithm
```
Input requirements:
  - Exact time of vancomycin dose(s) (start time, duration, amount)
  - Exact time of level draw (to the minute matters)
  - All doses given in prior 48–72h with exact times
  - Current SCr (for prior update)
  - Prior SCr values with timestamps (for AKI trajectory)

Bayesian MAP with random timing:
  1. Build complete dosing history (all doses as {dose, tinf, t_start})
  2. For each random level at t_draw, compute predicted conc C_pred(t_draw | CL, Vd)
     using exact multi-dose superposition equation
  3. Run MAP estimation: minimize [likelihood of observed levels + prior penalty]
  4. Extract posterior CL, Vd
  5. Compute AUC₂₄ from posterior parameters

KEY VALIDATION:
  - Flag if random level is drawn during infusion (t_draw < tinf from last dose)
    → Level is NOT valid for PK estimation (distributional phase)
  - Flag if only 1 level AND patient is obese → insufficient for Vd estimation
  - Flag if level drawn < 1h post-infusion (distribution phase, not post-distributional)
```

### 5.3 AKI Mode Special Handling
```
AKI changes PK in complex ways:
  - Vd INCREASES (edema, capillary leak) → need HIGHER loading dose
  - CL DECREASES → need LONGER intervals, lower maintenance dose
  - PK is non-stationary → t½ changes day-to-day → Bayesian must update DAILY

AKI Dosing Strategy:
  Active AKI (rapidly rising SCr):
    1. Give loading dose (Vd-based, not CL-dependent) — full 20–25 mg/kg
    2. HOLD maintenance until CrCl estimated from most recent SCr
    3. Redose based on random level(s) + Bayesian
    4. Do NOT assume steady-state — use pre-SS Bayesian
    5. Check level every 24–48h

  AKI Recovery (falling SCr):
    - CrCl rising → CL rising → t½ shortening
    - Dose frequency needs to INCREASE as renal function recovers
    - Alert: "SCr falling — renal function recovering. Reassess dosing interval.
      More frequent dosing likely required."
    
  CRRT + AKI:
    - CRRT provides relatively stable, predictable CL
    - Use CRRT-specific prior (effluent rate 20–25 mL/kg/h)
    - Loading dose essential due to increased Vd
    - Maintenance: 7.5–10 mg/kg q12h (regardless of native CrCl)
    - Monitor first level within 24h

SCr Trajectory Classifier:
  Delta SCr / 24h:
    > +0.5 mg/dL/day: "Rapidly worsening AKI — daily levels, consider hold"
    +0.1 to +0.5/day: "Progressive AKI — every 48h levels"
    ±0.1/day: "Stable" — standard schedule
    < -0.1/day: "Recovering" — monitor for under-dosing, increase freq
```

---

## MODULE 6: PDF / REPORT EXPORT ENGINE
### 6.1 Report Content Specification
```
PAGE 1 — PATIENT SUMMARY HEADER:
  Patient ID, Date, Attending/Team
  Infection type, Indication, Organism (if known), MIC
  Current vancomycin regimen
  
PAGE 2 — PK ANALYSIS:
  Method used (Bayesian MAP / Sawchuk-Zaske / Population prior)
  Population PK model applied (Matzke / Crass 2018 / Pediatric / Neonatal)
  Bayesian prior parameters vs. posterior parameters (table)
  Levels used (table: level type, draw time, observed, predicted, residual)
  Individualized PK parameters: CL, Vd, Ke, t½

PAGE 3 — DOSING RECOMMENDATION:
  Current regimen → AUC₂₄ → Status
  Recommended regimen → Predicted AUC₂₄ → Predicted Cmax/Cmin
  Dose change rationale (formula shown)
  Next monitoring recommendation

PAGE 4 — SAFETY ASSESSMENT:
  KDIGO AKI status
  Nephrotoxin list
  Active alerts
  
PAGE 5 — CONCENTRATION-TIME GRAPH:
  Observed levels plotted
  Fitted curve
  Projected curve on recommended regimen
  Therapeutic zone (400–600 AUC annotation or 10–20 trough zone)
  
FOOTER on all pages:
  "Generated by AinaDara Calc | Therapeutic Drug Monitoring Suite | 2020 ASHP/IDSA/PIDS/SIDP Guidelines
  FOR CLINICAL DECISION SUPPORT ONLY. All recommendations require pharmacist/physician review."
```

### 6.2 Export Formats
```
PDF: Full clinical report (pages above)
CSV: Raw encounter data (for research/audit)
JSON: Full patient record including PK parameters (for EHR integration)
```

---

## MODULE 7: CLINICAL DECISION TREE (FULL LOGIC MAP)
### 7.1 Entry Point Classification
```
On patient entry, classify:

IF mode = NEONATAL (PMA ≤ 44 weeks):
  → Use neonatal PK model
  → SCr flag if < 72h of life
  → Apply neonatal dosing table
  → Bayesian required (highly variable PK)
  → AUC target: 400 mg·h/L (upper 800)

ELSE IF mode = PEDIATRIC (3 months – 18 years):
  → Use modified Goti model
  → CrCl from pediatric Schwartz formula (NOT Cockcroft-Gault)
  → AUC target: 400–600 mg·h/L
  → Bayesian preferred; first-order equations acceptable if 2 levels

ELSE IF mode = HD (intermittent):
  → Pre-dialysis level as primary monitoring tool
  → Target pre-HD: 15–20 mg/L (AUC surrogate)
  → CL interdialytic ≈ 0.1 L/h (residual)
  → CL during HD ≈ 2.5–3 L/h
  → Redose post-HD: 500–750 mg OR based on pre-HD level
  → Monitor weekly minimum

ELSE IF mode = CRRT:
  → Loading dose: 20–25 mg/kg
  → Maintenance: 7.5–10 mg/kg q12h
  → First level within 24h
  → Use CRRT prior (fixed effluent-based CL)
  → Daily monitoring initially

ELSE IF mode = CI:
  → Give loading dose first
  → Calculate CI rate from CLv × Target_Css
  → Check Css at steady state (4–5 × t½)
  → Adjust rate proportionally
  → AUC₂₄ = Css × 24

ELSE IF mode = AKI (rising SCr, unstable):
  → Full loading dose (Vd-based)
  → Bayesian ONLY (no Sawchuk-Zaske; not at SS)
  → Daily levels minimum
  → Classify SCr trajectory (worsening/stable/recovering)
  → Adjust dosing interval based on trajectory

ELSE (standard adult):
  → CrCl from Cockcroft-Gault
  → Prior: Matzke (or Crass 2018 if obese)
  → 2-level preferred; trough alone acceptable if stable/normal weight
  → AUC target: 400–600 mg·h/L
  → Weekly monitoring if stable
```

### 7.2 Dose Recommendation Logic (All Modes)
```
STEP 1: Determine CL (posterior if levels available; prior if not)

STEP 2: Calculate required TDD (Total Daily Dose):
  TDD = Target_AUC × CL
  Target_AUC = 500 mg·h/L (midpoint of 400–600)

STEP 3: Select interval based on CrCl:
  CrCl > 90:  prefer q8h or q12h
  CrCl 60–90: prefer q12h
  CrCl 30–59: prefer q24h
  CrCl 10–29: prefer q24–48h
  CrCl < 10:  dose by levels; q48–96h

STEP 4: Calculate dose per interval:
  Dose = TDD × (τ / 24)
  Round to nearest 250 mg
  Cap single dose at 3000 mg
  Cap daily dose at 4500 mg (obese) or 4000 mg (standard)
  Alert if capped

STEP 5: Verify predicted SS Cmax and Cmin:
  If Cmin > 20 mg/L → increase interval (trough toxicity risk)
  If Cmax > 50 mg/L → reduce dose or extend infusion time
  If Cmin < 5 mg/L → may indicate interval too long

STEP 6: If AUC still not achievable within dose caps:
  MIC > 1: "Consider alternative therapy"
  CRRT/HD/AKI: See mode-specific protocols
  Obese + AUC > 600: "Reduce to IBW-based dosing; reassess"

STEP 7: Output final recommendation:
  "Recommended: [X] mg IV q[τ]h over [tinf]h"
  "Predicted AUC₂₄: [X] mg·h/L"
  "Predicted Cmax/Cmin: [X]/[X] mg/L"
  "Next level: [type] in [timeframe]"
```

---

## MODULE 8: SCHWARTZ FORMULA (PEDIATRIC CrCl)
### 8.1 Why NOT Cockcroft-Gault in Children
CG equation uses muscle mass assumptions that are invalid in children. Schwartz formula uses height and age-based k-factor.

### 8.2 Schwartz 2009 (Bedside CKD-EPI Adapted for Pediatrics)
```
CrCl (mL/min/1.73m²) = k × Height(cm) / SCr(mg/dL)

k values by age/sex:
  Preterm infants: k = 0.33
  Term infants (0–1 year): k = 0.45
  Children 2–12 years: k = 0.55
  Adolescent females: k = 0.55
  Adolescent males: k = 0.70

BSA normalization to actual CrCl:
  CrCl_actual = CrCl_normalized × (BSA / 1.73)
  BSA = sqrt(height_cm × weight_kg / 3600)    [Mosteller formula]
```

---

## MODULE 9: ERROR HANDLING AND VALIDATION RULES
### 9.1 Input Validation (Hard Stops)
```
Flag and PREVENT calculation if:
  - Age < 0 or > 120
  - Weight < 0.3 kg or > 300 kg
  - Height < 30 cm or > 250 cm
  - SCr ≤ 0 (impossible)
  - SCr > 20 mg/dL without HD/CRRT — "Confirm SCr value"
  - Dose < 100 mg or > 5000 mg — "Unusual dose — confirm"
  - Tau < 6h (except CI mode) — "Interval < 6h unusual for vancomycin"
  - Level concentration < 0 or > 150 mg/L — "Confirm concentration value"
  - Level draw time before dose start — "Check timing: level drawn before dose"
  - C1 > C2 when C1 is expected trough (suggests mis-labeling)
  - Ke < 0 after Sawchuk-Zaske (implies increasing concentration; check timing)
```

### 9.2 PK Plausibility Checks (Soft Warnings)
```
Warn if:
  - t½ < 2h (likely error in timing or concentration)
  - t½ > 150h (unless ESRD — "Unusually long t½; confirm SCr and CrCl")
  - Vd < 0.2 L/kg (very small; check weight units)
  - Vd > 1.5 L/kg (very large; consider fluid overload or error)
  - CL < 0.5 L/h in non-renal-failure patient ("Unusually low CL; confirm SCr")
  - AUC < 100 or > 1200 mg·h/L ("Extreme AUC — verify inputs before acting")
  - Peak > 60 mg/L ("Unusually high peak; confirm draw timing not during infusion")
  - Ke negative ("Ke < 0: concentrations are rising, not falling — check level timing")
```

---

## MODULE 10: MEMORY AND OPUS BUILD INSTRUCTIONS
### 10.1 Architecture for Opus Build
```
Single-file React application with:
  - All PK math in pure JavaScript (no external PK libraries)
  - LocalStorage for multi-encounter patient history
  - jsPDF for PDF export (CDN loaded)
  - Recharts for longitudinal trending charts
  - All 7 modes switchable via tab bar
  - State management: useReducer for complex patient state
  - Mobile-responsive (pharmacists use tablets at bedside)
```

### 10.2 State Shape (Redux-like)
```javascript
{
  patient: {
    id, age, sex, height_cm, abw_kg, diagnoses,
    mode, // 'standard' | 'obese' | 'HD' | 'CRRT' | 'AKI' | 'neonatal' | 'pediatric' | 'CI'
    pma_weeks, pma_days, // neonatal only
    hd_settings: { scheduled, schedule_days, typical_session_duration },
    crrt_settings: { effluent_rate_ml_kg_h }
  },
  encounters: [
    {
      id, timestamp, encounter_type,
      labs: { scr, crcl, wbc, scr_baseline },
      dosing_history: [{ dose, tinf, tau, start_time }],
      levels: [{ time_abs, conc, label }],
      pk_results: { method, CL_prior, Vd_prior, CL_post, Vd_post, ke, t_half },
      auc: { current, recommended_regimen_auc },
      recommendation: { dose, tau, tinf, daily_dose },
      aki_status, nephrotoxins,
      notes, clinician_id
    }
  ],
  current_encounter_id, // which encounter is active
  alerts: [], // active clinical alerts
  ui: { activeTab, showChart, darkMode }
}
```

### 10.3 Key Opus Prompt Optimizations
```
1. Build Bayesian MAP as pure math module first, test with known values, then integrate UI
2. Use useReducer not useState for complex state — easier to audit
3. PKChart should use SVG (not canvas) for PDF compatibility
4. Each module (neonatal, CI, HD, etc.) as separate component receiving same patient state
5. All PK results should be immutable — stored per encounter, never overwritten
6. Validation layer runs before every calculation, blocks on hard stops
7. Alert system: priority queue — DANGER > WARN > INFO
8. PDF export: capture SVG charts as base64, embed in jsPDF
9. All formulas should have tooltips explaining the math (hover/tap)
10. "Evidence Grade" badge on every recommendation (A-II, B-II, etc.)
```

### 10.4 Formula Tooltip Specs (Educational Layer)
```
Every calculated value should have an expandable "Show Math" section:

Example — CrCl tooltip:
  "Cockcroft-Gault (1976): CrCl = [(140−age) × IBW] / (72 × SCr) × 0.85 (female)
  Weight used: [value] kg ([IBW/AdjBW/ABW])
  Result: [X] mL/min
  [A-II Evidence — 2020 ASHP/IDSA Guidelines]"

Example — AUC tooltip:
  "Trapezoidal Method (Sawchuk-Zaske):
  AUCinf = tinf × (Cmax + Cmin) / 2 = [X]
  AUCelim = (Cmax − Cmin) / Ke = [X]
  AUC_τ = [X]
  AUC₂₄ = AUC_τ × (24/τ) = [X] mg·h/L"
```

---

## CHUNK 2 COMPLETE SUMMARY
Modules covered:
  ✅ M1: Neonatal dosing engine (Grimsley-Thomson, PMA-based, SCr correction)
  ✅ M2: Continuous infusion rate calculator (Css targeting, rate adjustment, incompatibilities)
  ✅ M3: Multi-encounter history tracker (trending, Bayesian prior propagation)
  ✅ M4: OPAT transition module (eligibility, monitoring schedule, escalation alerts)
  ✅ M5: Random level / AKI mode (non-steady-state Bayesian, SCr trajectory classifier)
  ✅ M6: PDF/CSV/JSON export spec
  ✅ M7: Full clinical decision tree (all modes, entry logic, dose selection)
  ✅ M8: Schwartz formula (pediatric CrCl)
  ✅ M9: Input validation and PK plausibility checks
  ✅ M10: Opus build architecture, state shape, prompt optimizations

---

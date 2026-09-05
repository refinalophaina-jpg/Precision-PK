# VANCOMYCIN TDM SOFTWARE — COMPREHENSIVE INSTRUCTIONS
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

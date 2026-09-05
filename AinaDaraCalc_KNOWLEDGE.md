# AINADARA CALC — Therapeutic Drug Monitoring Suite
## PROJECT KNOWLEDGE DOCUMENT (Upload as Project Knowledge file)
## Companion: AinaDaraCalc_PROJECT_INSTRUCTIONS.md → paste into Project Instructions field
##
## This file contains:
##   SECTION A — Complete Opus Master Prompt (verbatim, ready to paste to Opus)
##   SECTION B — UI Wireframes (all panels, desktop + mobile)
##   SECTION C — Nephrotoxin Interaction Database (10 agents + scoring logic)
##   SECTION D — Alternative Therapy Module (5 drugs, full dosing + monitoring)
##   SECTION E — Additional Safety Modules (RMS, ototoxicity, TMP-SMX, VRE)
##   SECTION F — Build Strategy, Opus Invocation Template, Final QA Checklist
##   SECTION G — Project Summary

*AinaDara Calc Brain Document v2.0 | March 2026 | For Opus Build*


# ═══════════════════════════════════════════════════════════
# PART 3: OPUS MASTER PROMPT, UI WIREFRAMES, DRUG INTERACTIONS, ALTERNATIVES
# ═══════════════════════════════════════════════════════════

# AINADARA CALC — Therapeutic Drug Monitoring Suite — CHUNK 3 BRAIN DOCUMENT
## Opus Master Prompt + UI Wireframe + Drug Interactions + Alternative Therapy Module
### Final Instruction Set Before Build

---

## SECTION A: OPUS MASTER PROMPT (COMPLETE)

### A.1 The Full System Prompt for Opus Build

```
You are an expert clinical pharmacist and software engineer building a production-grade
vancomycin Therapeutic Drug Monitoring application — AinaDara Calc | Therapeutic Drug Monitoring Suite.

═══════════════════════════════════════════════════════════
CLINICAL AUTHORITY
═══════════════════════════════════════════════════════════
All clinical logic is based exclusively on:
  PRIMARY: Rybak MJ et al. ASHP/IDSA/PIDS/SIDP 2020 Vancomycin Consensus Guidelines.
           CID 2020;71(6):1361-4 + Am J Health-Syst Pharm 2020;77:835-64.
  DOSING:  Matzke GR (1984) [standard CL]; Crass RL (2018) [obese CL];
           Grimsley-Thomson (1999) [neonatal CL]; Goti (2018) [pediatric]
  RENAL:   Cockcroft-Gault (adult); Schwartz (2009) [pediatric]
  SAFETY:  KDIGO 2012 AKI criteria

This software provides CLINICAL DECISION SUPPORT ONLY.
All recommendations require pharmacist and/or physician review before implementation.

═══════════════════════════════════════════════════════════
TECHNICAL SPECIFICATION
═══════════════════════════════════════════════════════════
Build a SINGLE-FILE React application (.jsx).
  - State: useReducer (complex nested state - NOT multiple useState)
  - Charts: Recharts (import from recharts)
  - PDF Export: jsPDF (load from CDN)
  - Styling: Tailwind CSS utility classes ONLY
  - Icons: lucide-react
  - Storage: localStorage for multi-encounter patient history
  - All PK mathematics: pure JavaScript, zero external PK libraries
  - No TypeScript - plain JSX only
  - Mobile-responsive (md: breakpoints for tablet bedside use)
  - Dark medical theme throughout

═══════════════════════════════════════════════════════════
STATE ARCHITECTURE
═══════════════════════════════════════════════════════════
const initialState = {
  patient: {
    id: null,
    name: '',
    age: '',
    sex: 'M',
    height_cm: '',
    abw_kg: '',
    ibw_kg: null,          // auto-calculated
    adjbw_kg: null,        // auto-calculated if obese
    bmi: null,             // auto-calculated
    mode: 'standard',      // 'standard'|'obese'|'HD'|'CRRT'|'AKI'|'neonatal'|'pediatric'|'CI'
    pma_weeks: '',
    pma_days: '',
    postnatal_days: '',
    birth_weight_kg: '',
    scr_age_flag: false,   // true if SCr drawn < 72h of life
    crrt_effluent_ml_kg_h: 22,
    hd_scheduled: true,
    hd_days: ['Mon','Wed','Fri'],
    hd_duration_h: 4,
    ci_target_css: 22,
  },
  encounters: [],
  current_encounter_id: null,
  alerts: [],              // [{id, level:'DANGER'|'WARN'|'INFO', message, timestamp}]
  ui: {
    activeTab: 'patient',
    darkMode: true,
    showMath: {},
    chartView: 'pkCurve',
  }
};

// Encounter schema:
{
  id, timestamp, encounter_type,
  labs: { scr, scr_baseline, scr_48h_prior, crcl, wbc, cpk },
  dosing_history: [{ dose_mg, tinf_h, tau_h, start_time_ISO }],
  levels: [{ time_ISO, conc_mg_L, label }],
  nephrotoxins: [],
  pk_results: {
    method: 'bayesian'|'sawchuk_zaske'|'population_prior',
    CL_prior, Vd_prior, CL_post, Vd_post, ke, t_half,
    auc24_current, cmax_predicted, cmin_predicted,
  },
  recommendation: {
    dose_mg, tau_h, tinf_h, daily_dose_mg,
    auc24_predicted, cmax_new, cmin_new,
    rationale, evidence_grade, next_monitoring,
  },
  aki_status: { stage, criteria_met, scr_change_48h, scr_ratio_7d },
  notes: '',
}

═══════════════════════════════════════════════════════════
MATHEMATICAL ENGINE - BUILD ORDER
═══════════════════════════════════════════════════════════
Build and test these pure JS functions FIRST, before any UI.

// 1. ANTHROPOMETRIC
function calcIBW(sex, height_cm) {
  const h_in = height_cm / 2.54;
  return sex === 'M' ? 50 + 2.3*(h_in-60) : 45.5 + 2.3*(h_in-60);
}
function calcAdjBW(ibw, abw) { return ibw + 0.4*(abw-ibw); }
function calcBMI(abw, height_cm) { return abw/((height_cm/100)**2); }
function calcBSA(height_cm, wt_kg) { return Math.sqrt(height_cm*wt_kg/3600); }

// 2. RENAL FUNCTION
function calcCrCl(age, sex, weight_kg, scr) {
  if (scr <= 0) return null;
  const crcl = ((140-age)*weight_kg)/(72*scr);
  return sex === 'F' ? crcl*0.85 : crcl;
}
// Schwartz pediatric: k*height_cm/scr
// k = 0.33 preterm, 0.45 term infant, 0.55 child/teen-F, 0.70 teen-M

// 3. POPULATION PK PRIORS (all modes)
function getPopulationPrior(patient) {
  // Standard (Matzke 1984): CL = CrCl*0.041+0.22, Vd = 0.70*IBW
  // Obese (Crass 2018): CL = 9.656-0.078*age-2.009*scr+1.09*sex_num+0.04*TBW^0.75 (divide by 60 for L/h)
  // Neonatal (Grimsley-Thomson): CL by PMA band; Vd=0.69*abw
  //   PMA<=28: CL=0.0131*wt+0.0087
  //   PMA 29-36: CL=0.0248*wt+0.0120
  //   PMA 37-44: CL=0.0303*wt+0.0160
  //   PMA >44: CL=0.0370*wt+0.0220
  //   SCr correction if SCr > threshold: CL *= (0.5/scr)
  // CRRT: CL = effluent_rate_L_h + 0.22 residual
  // HD: CL = 0.10 L/h interdialytic; Vd=0.70*IBW
  // Pediatric: Vd=0.65*abw; CL from age-based CrCl
}

// 4. MULTI-DOSE CONCENTRATION (one-compartment IV infusion, superposition)
function predictConc(t_abs, doses, CL, Vd) {
  const ke = CL/Vd;
  let conc = 0;
  for (const d of doses) {
    const t_start = t_abs - d.start_h;
    if (t_start < 0) continue;
    const t_end = t_abs - (d.start_h + d.tinf_h);
    const Cmax = (d.dose_mg/(d.tinf_h*ke*Vd))*(1-Math.exp(-ke*d.tinf_h));
    if (t_end >= 0) conc += Cmax*Math.exp(-ke*t_end);
    else conc += (d.dose_mg/d.tinf_h)/(ke*Vd)*(1-Math.exp(-ke*t_start));
  }
  return conc;
}

// 5. BAYESIAN MAP ESTIMATION
function bayesianMAP(prior, doses, observed_levels, max_iter=500) {
  // Minimizes: prior_penalty(log-normal) + likelihood(proportional error 15%)
  // Gradient descent on CL and Vd
  // Returns: {CL_post, Vd_post, ke, t_half, converged}
  const {CL: CL_pop, Vd: Vd_pop, CV_CL, CV_Vd} = prior;
  const sigma_res = 0.15;
  let CL = CL_pop, Vd = Vd_pop;
  
  function obj(cl, vd) {
    const lnCL_var = Math.log(1+(CV_CL**2));
    const lnVd_var = Math.log(1+(CV_Vd**2));
    const prior_pen = (Math.log(cl)-Math.log(CL_pop))**2/(2*lnCL_var)
                    + (Math.log(vd)-Math.log(Vd_pop))**2/(2*lnVd_var);
    let lik = 0;
    for (const obs of observed_levels) {
      const pred = predictConc(obs.t_abs, doses, cl, vd);
      if (pred <= 0) return 1e9;
      lik += ((obs.conc-pred)/(sigma_res*pred))**2;
    }
    return prior_pen + lik;
  }
  
  const step = 0.001, lr = 0.005;
  let prev = Infinity;
  for (let i=0; i<max_iter; i++) {
    const cur = obj(CL,Vd);
    if (Math.abs(cur-prev) < 1e-8) break;
    prev = cur;
    const gCL = (obj(CL+step,Vd)-cur)/step;
    const gVd = (obj(CL,Vd+step)-cur)/step;
    CL = Math.max(0.01, CL-lr*gCL);
    Vd = Math.max(0.1, Vd-lr*gVd);
  }
  return {CL_post:CL, Vd_post:Vd, ke:CL/Vd, t_half:0.693/(CL/Vd)};
}

// 6. AUC CALCULATION (Trapezoidal)
function calcAUC24(Cmax, Cmin, ke, tinf_h, tau_h) {
  return (tinf_h*(Cmax+Cmin)/2 + (Cmax-Cmin)/ke) * (24/tau_h);
}

// 7. STEADY STATE PREDICTIONS
function calcSteadyState(dose_mg, tinf_h, tau_h, CL, Vd) {
  const ke = CL/Vd;
  const Cmax = (dose_mg/(tinf_h*ke*Vd))
    *(1-Math.exp(-ke*tinf_h))/(1-Math.exp(-ke*tau_h));
  const Cmin = Cmax*Math.exp(-ke*(tau_h-tinf_h));
  return {Cmax, Cmin};
}

// 8. DOSE RECOMMENDATION
function recommendDose(CL, Vd, target_auc=500) {
  const ke = CL/Vd;
  const t_half = 0.693/ke;
  const tdd = target_auc*CL;
  let tau = t_half<=6?8 : t_half<=12?12 : t_half<=18?24 : t_half<=36?36 : 48;
  const dose = Math.min(Math.round(tdd*(tau/24)/250)*250, 3000);
  return {dose_mg:dose, tau_h:tau, tinf_h:dose>1500?2:1, daily_dose_mg:dose*(24/tau)};
}

// 9. KDIGO AKI DETECTION
function detectAKI(scr_now, scr_48h, scr_7d_base) {
  if (scr_7d_base && scr_now/scr_7d_base >= 3.0) return {stage:3, criteria:'SCr >=3x baseline'};
  if (scr_7d_base && scr_now/scr_7d_base >= 2.0) return {stage:2, criteria:'SCr >=2x baseline'};
  if (scr_48h && (scr_now-scr_48h) >= 0.3) return {stage:1, criteria:`+${(scr_now-scr_48h).toFixed(2)} mg/dL in 48h`};
  if (scr_7d_base && scr_now/scr_7d_base >= 1.5) return {stage:1, criteria:'SCr >=1.5x baseline'};
  return {stage:0, criteria:'None'};
}

// TEST CASE (assert after build):
// Patient: 70yo M, 75kg, SCr 1.4, CrCl=45 mL/min
// Dose: 1000mg q12h, tinf=1h
// Level 1 (peak): 28.5 mg/L at t=2h post-infusion-end
// Level 2 (trough): 10.2 mg/L at t=12h
// Expected: Ke~0.099, t1/2~7.0h, AUC24~475 mg*h/L

═══════════════════════════════════════════════════════════
REDUCER ACTIONS
═══════════════════════════════════════════════════════════
SET_PATIENT_FIELD, SET_MODE, ADD_DOSE, ADD_LEVEL,
RUN_CALCULATION, NEW_ENCOUNTER, UPDATE_LABS,
DISMISS_ALERT, TOGGLE_MATH, EXPORT_PDF,
LOAD_PATIENT, SAVE_PATIENT

═══════════════════════════════════════════════════════════
BUILD CHECKLIST (ORDERED)
═══════════════════════════════════════════════════════════
Phase 1 - Math (pure JS, no UI):
  All anthropometric functions
  All renal function functions (CG + Schwartz)
  All 6 population PK priors
  predictConc() multi-dose superposition
  bayesianMAP() with gradient descent
  calcAUC24() trapezoidal
  calcSteadyState()
  recommendDose() with interval logic
  detectAKI() KDIGO
  Neonatal nomogram function
  CI rate calculator function
  Validation functions (hard stops + soft)

Phase 2 - State: initialState + reducer + localStorage

Phase 3 - UI Components:
  PatientPanel (demographics + mode selector)
  DosingPanel (dose history + level entry + timing validation)
  ResultsPanel (AUC gauge + PK params + recommendation)
  PKChart (recharts concentration-time curve)
  TimelineChart (longitudinal AUC + SCr)
  AlertBanner (priority-sorted)
  FormulaTooltip (expandable math)
  AlternativesPanel
  OPATPanel
  PDFExport (jsPDF)
  HistoryPanel (encounter table + trends)

Phase 4 - Integration:
  Tab navigation
  Mobile responsiveness
  Evidence grade badges on all recommendations
  "Clinical Decision Support Only" footer
```

---

## SECTION B: UI WIREFRAME SPECIFICATION

### B.1 Overall Layout (Desktop 1280px)
```
[AINADARA CALC Therapeutic Drug Monitoring Suite]  [Patient][Dosing][Results][History][Alternatives][Export]
─────────────────────────────────────────────────────────────────────────────
PATIENT SIDEBAR (fixed) | MAIN CONTENT (tab-driven)
  Mode: [STANDARD v]    |
  Age__ Sex[M][F]       |  Changes per active tab — see wireframes below
  Ht(cm)__ Wt(kg)__     |
  SCr__                 |
  ─────────────────     |
  IBW:__ kg             |
  BMI:__                |
  CrCl:__ mL/min        |
  ─────────────────     |
  ALERTS:               |
  [alert badges here]   |
```

### B.2 Results Panel
```
AUC MONITORING RESULTS                              [Show Math]
────────────────────────────────────────────────────────────────
AUC GAUGE          | CURRENT: 1250mg q12h x1h
[  ████░░░  ]      |   AUC24: 387 mg*h/L  [SUBTHERAPEUTIC]
387 mg*h/L         |   Ke: 0.098 h-1  |  t1/2: 7.1h
SUBTHERAPEUTIC     |   Vd: 58.3L      |  CL: 5.71 L/h
                   |   Method: Bayesian MAP [A-II]
                   |──────────────────────────────
                   | RECOMMENDATION: 1500mg q12h x1h
                   |   Predicted AUC24: 464 mg*h/L ✓
                   |   Cmax: 32.1  |  Cmin: 10.4 mg/L
                   |   Daily Dose: 3000 mg/day
                   |   Next: Peak+Trough 24h [A-II]
────────────────────────────────────────────────────────────────
PK CONCENTRATION-TIME CURVE (Recharts LineChart)
  Y-axis: mg/L  |  X-axis: Hours
  — observed levels as scatter dots
  — fitted curve (current regimen, solid)
  — projected curve (new regimen, dashed)
  — shaded therapeutic zone
```

### B.3 Alert Banner (Priority Stack)
```
[DANGER] KDIGO AKI Stage 2: SCr 2.0x baseline. Hold evaluation needed.    [x]
[WARN]   AUC 387 mg*h/L below target 400-600.                             [x]
[WARN]   Pip/Tazo co-admin: enhanced nephrotoxicity monitoring required.   [x]
[INFO]   CrCl 128 mL/min: Augmented Renal Clearance detected.             [x]
```

### B.4 Dosing Input Panel
```
DOSING HISTORY                                        [+ Add Dose]
  #   Dose(mg)  Duration  Start Time       Interval
  1   1250      1h        02/28 08:00      q12h
  2   1250      1h        02/28 20:00      q12h      [x]
  3   1250      1h        03/01 08:00      q12h      [x]

OBSERVED LEVELS                                       [+ Add Level]
  Type    Conc(mg/L)   Draw Time      Status
  Peak    28.4         03/01 10:00    ✓ 2.0h post-infusion
  Trough  11.2         03/01 19:30    ✓ 0.5h pre-dose

[RUN BAYESIAN CALCULATION]
```

### B.5 History Timeline
```
PATIENT HISTORY                              Day 0 to Day 14
─────────────────────────────────────────────────────────────
AUC  700 ─
     600 ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─[UPPER SAFE]─ ─ ─ ─ ─
     500 ─              ✦                   ✦      ✦
     400 ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─[LOWER EFF]─ ─ ─ ─ ─
     300 ─   ✦

SCr  2.0 ─                         ╭─────╮
     1.5 ─                    ╭───╯       ╰──
     1.0 ─  ─────────────────╯

     Regimen: 1000q12 | 1250q12 | 1500q12
     AKI flag:        |         | 🔴

ENCOUNTER TABLE:
Date  | Regimen    | AUC | SCr | Status      | Action
03/01 | 1000 q12h  | 310 | 1.1 | Sub ⚠️     | dose up
03/04 | 1250 q12h  | 442 | 1.0 | Therapeutic | no change
03/07 | 1250 q12h  | 487 | 1.3 | Therapeutic | no change
03/10 | 1250 q12h  | 465 | 1.8 | AKI Stg2 🔴| HOLD eval
```

### B.6 Mobile Layout (<768px)
```
[AINADARA CALC]                                          [≡ Menu]
[Patient] [Dosing] [Results] [More ▼]
─────────────────────────────────────
Mode: [STANDARD ▼]
Age:__ Sex: [M] [F]
Ht(cm):__ Wt(kg):__  SCr:__
IBW:__ kg  CrCl:__ mL/min
─────────────────────────────────────
⚠️ Alert: AUC subtherapeutic
─────────────────────────────────────
AUC GAUGE: ████░░  387 mg*h/L
           SUBTHERAPEUTIC
─────────────────────────────────────
RECOMMENDATION:
1500mg IV q12h over 1h
Predicted AUC24: 464 mg*h/L ✓
[COPY TO CLIPBOARD]
```

---

## SECTION C: DRUG INTERACTION MODULE

### C.1 Nephrotoxin Interaction Database
```javascript
const NEPHROTOXIN_DB = {
  pip_tazo: {
    name: "Piperacillin-Tazobactam",
    risk_level: "HIGH",
    aki_risk_multiplier: "3-4x baseline",
    mechanism: "Synergistic tubular oxidative injury",
    evidence: "Meta-analysis OR 3.4 (95% CI 2.6-4.4) vs vancomycin alone",
    action: "SCr every 24-48h. If AUC>550 + pip/tazo: consider cefepime/meropenem instead.",
    alert_level: "WARN",
    ref: "Rutter 2017, Hammond 2017"
  },
  aminoglycoside: {
    name: "Aminoglycosides (gent/tobra/amikacin)",
    risk_level: "HIGH",
    aki_risk_multiplier: "2-3x",
    mechanism: "Synergistic proximal tubular injury, mitochondrial dysfunction",
    action: "Daily SCr. Use extended-interval amino dosing. Limit combination <3 days if possible.",
    alert_level: "WARN"
  },
  ampho_b: {
    name: "Amphotericin B (conventional)",
    risk_level: "VERY HIGH",
    mechanism: "Direct tubular toxicity + vasoconstriction",
    action: "Use liposomal formulation if possible. Daily SCr mandatory. Consider vanc alternative >5 days.",
    alert_level: "DANGER"
  },
  loop_diuretic: {
    name: "Loop Diuretics (furosemide, torsemide)",
    risk_level: "MODERATE",
    mechanism: "Volume depletion -> reduced renal perfusion",
    action: "Monitor volume status. SCr every 48h. Optimize hydration.",
    alert_level: "WARN"
  },
  nsaid: {
    name: "NSAIDs (ibuprofen, ketorolac, indomethacin)",
    risk_level: "MODERATE",
    mechanism: "Prostaglandin inhibition -> reduced GFR",
    action: "Avoid if possible. If required: shortest duration, daily SCr.",
    alert_level: "WARN"
  },
  contrast: {
    name: "Iodinated IV Contrast",
    risk_level: "MODERATE",
    action: "Hydrate before/after. SCr at 24h and 48h post-contrast.",
    alert_level: "WARN"
  },
  calcineurin: {
    name: "Calcineurin Inhibitors (tacrolimus, cyclosporine)",
    risk_level: "HIGH",
    mechanism: "Afferent vasoconstriction + direct tubular injury; PK interaction may alter tacrolimus levels",
    action: "Frequent tacrolimus/CSA levels. Daily SCr. Nephrology consult recommended.",
    alert_level: "DANGER"
  },
  acei_arb: {
    name: "ACEi / ARBs",
    risk_level: "LOW-MODERATE",
    mechanism: "Efferent dilation -> reduced GFR when combined with volume depletion",
    action: "Monitor SCr if patient volume-depleted.",
    alert_level: "INFO"
  },
  cisplatin: {
    name: "Cisplatin / Ifosfamide",
    risk_level: "HIGH",
    action: "Avoid concurrent vancomycin during cisplatin if possible. Daily SCr.",
    alert_level: "WARN"
  },
  tmp_smx: {
    name: "Trimethoprim-Sulfamethoxazole",
    risk_level: "LOW-MODERATE",
    special_note: "TMP blocks tubular creatinine secretion -> SCr rises ~0.2 mg/dL WITHOUT true GFR change. Can falsely trigger KDIGO criteria.",
    action: "Use clinical judgment; SCr elevation on TMP-SMX may be artifact. Monitor potassium.",
    alert_level: "INFO"
  },
  statins: {
    name: "Statins (HMG-CoA reductase inhibitors)",
    risk_level: "LOW - relevant if switching to daptomycin",
    action: "If switching to daptomycin: consider holding statin. Monitor CPK weekly.",
    alert_level: "INFO",
    context: "daptomycin_only"
  }
};
```

### C.2 Interaction Severity Scoring Logic
```javascript
function calcNephrotoxinRisk(selected_toxins) {
  const weights = { 'VERY HIGH': 4, 'HIGH': 3, 'MODERATE': 2, 'LOW-MODERATE': 1 };
  let score = selected_toxins.reduce((sum, t) =>
    sum + (weights[NEPHROTOXIN_DB[t]?.risk_level] || 0), 0);

  // Special combination flags:
  const combos = [];
  if (selected_toxins.includes('pip_tazo'))
    combos.push('pip_tazo_vanc_combination');
  if (selected_toxins.includes('aminoglycoside'))
    combos.push('aminoglycoside_vanc_combination');
  if (selected_toxins.includes('calcineurin'))
    combos.push('calcineurin_urgent');
  if (selected_toxins.includes('ampho_b'))
    combos.push('ampho_b_critical');

  return {
    score,
    monitoring_intensity: score >= 5 ? 'Daily SCr + AUC q24-48h'
      : score >= 3 ? 'SCr q48h, AUC within 72h'
      : 'Standard weekly',
    combo_alerts: combos
  };
}
```

---

## SECTION D: ALTERNATIVE THERAPY MODULE

### D.1 Clinical Triggers for Alternative Panel
```
Show alternatives when ANY of:
  - MIC > 1 mg/L by BMD
  - AUC persistently > 600 despite dose reduction
  - KDIGO AKI Stage >= 2 while on vancomycin
  - CrCl < 20 mL/min + active MRSA infection
  - Vancomycin treatment failure (bacteremia >= 5 days on therapeutic AUC)
  - Patient intolerance (refractory Red Man Syndrome)
  - VAP/HAP (linezolid preferred)
  - CNS infection (linezolid preferred)
```

### D.2 Alternative Drug Reference Database
```javascript
const ALTERNATIVES = {
  daptomycin: {
    name: "Daptomycin (Cubicin)",
    class: "Cyclic lipopeptide",
    pk_pd: "Concentration-dependent. AUC/MIC primary driver. t1/2 ~8h. Vd ~0.1 L/kg. Renal elimination 78%.",
    
    indications: {
      preferred: ["MRSA bacteremia","Right-sided IE (FDA-approved 6 mg/kg q24h)","MRSA SSTI"],
      off_label: ["MRSA osteomyelitis","Device infections","Persistent bacteremia (high-dose)"],
      CONTRAINDICATED: ["MRSA pneumonia — INACTIVATED by pulmonary surfactant",
                        "Left-sided endocarditis as monotherapy (limited evidence)"]
    },
    
    dosing_adult: {
      bacteremia_IE: "6 mg/kg IV q24h (standard) | 8-10 mg/kg q24h (vanc failure, complex IE)",
      ssti: "4 mg/kg IV q24h",
      high_dose_off_label: "Up to 12 mg/kg q24h studied; monitor CPK closely",
      renal: {
        CrCl_gt_30: "No adjustment",
        CrCl_lt_30: "6 mg/kg q48h",
        HD: "6 mg/kg q48h; dose after HD (dialyzable)",
        CRRT: "6-8 mg/kg q24h depending on effluent rate"
      }
    },
    
    dosing_pediatric: {
      age_12_to_17: "7 mg/kg q24h",
      age_7_to_11: "9 mg/kg q24h",
      age_2_to_6:  "10 mg/kg q24h",
      age_1_to_1:  "10 mg/kg q24h",
      under_12mo:  "NOT recommended"
    },
    
    monitoring: {
      CPK: "Baseline + weekly. More frequent if renal dysfunction or concurrent statin.",
      CPK_hold: ">1000 U/L without symptoms | >500 U/L with symptoms",
      blood_cultures: "q48h in bacteremia until negative",
      repeat_MIC: "If bacteremia persists >5 days — resistance can emerge",
      PT_INR_note: "Daptomycin falsely prolongs PT/INR with certain thromboplastin reagents — do NOT adjust anticoagulation based on this artifact"
    },
    
    combination_therapy: {
      dapto_plus_ceftaroline: {
        rationale: "Beta-lactam sensitizes MRSA cell wall to daptomycin; overcomes tolerance/resistance via different MOA",
        dosing: "Daptomycin 8-10 mg/kg q24h + Ceftaroline 600mg IV q8h",
        indication: "Persistent MRSA bacteremia >=5 days; vancomycin/daptomycin failure; high-inoculum IE",
        evidence: "Pilot RCT (Geriak 2019) + multiple case series. Evidence grade B-II."
      }
    },
    
    see_saw_effect: "As vancomycin MIC increases, daptomycin susceptibility may DECREASE (cross-resistance). Always get daptomycin MIC if using after vancomycin failure.",
    evidence_grade: "A-I (bacteremia/IE, FDA-approved at 6 mg/kg)"
  },
  
  linezolid: {
    name: "Linezolid (Zyvox)",
    class: "Oxazolidinone",
    pk_pd: "Bacteriostatic (time-dependent). Excellent tissue penetration. Oral bioavailability ~100%. NO renal dose adjustment needed.",
    
    indications: {
      preferred: ["MRSA VAP/HAP (superior lung penetration vs. vancomycin)",
                  "MRSA SSTI (IV-to-oral transition available)",
                  "CNS MRSA (CSF penetration ~70% of serum)",
                  "Renal failure patients (no dose adjustment)"],
      acceptable: ["MRSA bacteremia (non-inferior to vancomycin in non-endocarditis BSI — some meta-analyses)"],
      AVOID: ["MRSA left-sided endocarditis (bacteriostatic, high inoculum)",
              "Catheter-associated BSI (limited data)"]
    },
    
    dosing: {
      standard: "600 mg IV or PO q12h (same dose for both routes)",
      renal_adjustment: "NONE required — cleared hepatically",
      duration_caution: "Monitor closely >14 days; safety data limited >28 days"
    },
    
    monitoring: {
      CBC: "Weekly (thrombocytopenia risk, especially >14 days)",
      visual: "Monthly if >28 days (optic neuropathy)",
      serotonin_screen: "Screen for SSRIs, SNRIs, MAOIs, tramadol, meperidine, triptans — serious serotonin syndrome risk",
      lactic_acid: "If prolonged use + clinical deterioration (mitochondrial toxicity)"
    },
    
    toxicity: {
      thrombocytopenia: "Most common; duration-dependent; reversible on D/C",
      serotonin_syndrome: "HIGH RISK with concurrent serotonergic agents",
      myelosuppression: "Weekly CBC",
      optic_neuropathy: "Rare; baseline visual acuity if >28 days",
      lactic_acidosis: "Rare; mitochondrial toxicity"
    },
    
    oral_advantage: "IV equivalent oral dosing = true IV-to-PO step-down. Enables OPAT without IV access.",
    evidence_grade: "A-I for SSTI/HAP (FDA approved); B-II for bacteremia"
  },
  
  ceftaroline: {
    name: "Ceftaroline Fosamil (Teflaro)",
    class: "5th-generation cephalosporin — anti-MRSA beta-lactam",
    pk_pd: "Bactericidal. Time-dependent. Unique: binds PBP2a (mecA-encoded) — only beta-lactam with MRSA activity.",
    
    indications: {
      FDA_approved: ["ABSSSI","CABP (community-acquired bacterial pneumonia)"],
      off_label: ["Salvage MRSA bacteremia",
                  "Combination with daptomycin for persistent bacteremia/IE",
                  "VISA/hVISA infections (see-saw advantage)"]
    },
    
    dosing: {
      serious_BSI_off_label: "600 mg IV q8h",
      SSTI_CAP: "600 mg IV q12h",
      combination_dapto_cpt: "600 mg IV q8h + daptomycin 8-10 mg/kg q24h",
      renal: {
        CrCl_30_to_50: "400 mg q8h",
        CrCl_15_to_30: "300 mg q8h",
        CrCl_lt_15_or_HD: "200 mg q8h; dose after HD"
      }
    },
    
    see_saw: "When vancomycin MIC rises, ceftaroline MIC typically FALLS. Useful specifically for VISA/hVISA isolates.",
    evidence_grade: "A-I approved indications; B-II salvage bacteremia (retrospective data only)"
  },
  
  telavancin: {
    name: "Telavancin (Vibativ)",
    class: "Lipoglycopeptide",
    dosing: "10 mg/kg IV q24h",
    renal: {
      CrCl_30_to_50: "7.5 mg/kg q24h",
      CrCl_10_to_29: "10 mg/kg q48h"
    },
    BOXED_WARNING: "Increased mortality in patients with pre-existing CrCl <=50 mL/min. Avoid in renal impairment unless benefit clearly outweighs risk.",
    interference: "Falsely elevates PT/aPTT/INR — collect coagulation labs immediately BEFORE dose.",
    evidence_grade: "A-I approved ABSSSI/HAP-VAP"
  },
  
  dalbavancin: {
    name: "Dalbavancin (Dalvance)",
    class: "Lipoglycopeptide (ultra-long acting, t1/2 ~14 days)",
    role: "OPAT step-down agent after initial stabilization. NOT for acute management.",
    dosing: "1500 mg IV single dose OR 1000 mg day 1 + 500 mg day 8",
    renal: "750 mg for CrCl <30; no adjustment on HD",
    advantage: "Weekly/biweekly dosing eliminates daily infusion for OPAT",
    evidence_grade: "B-II for bacteremia step-down (observational)"
  }
};
```

### D.3 Infection-Type Decision Tree
```javascript
const INFECTION_ALTERNATIVES = {
  bacteremia_uncomplicated: {
    vanc_failure: "Daptomycin 6-8 mg/kg q24h",
    persistent_5d: "Daptomycin + Ceftaroline combination",
    mic_gt_1: "Daptomycin (check dapto MIC first)",
    renal_failure: "Linezolid 600mg q12h (no renal dose adj)",
    step_down_opat: "Consider dalbavancin after clinical stabilization"
  },
  endocarditis_left_sided: {
    vanc_failure: "Daptomycin 8-10 mg/kg (high dose)",
    persistent: "Daptomycin + Ceftaroline",
    AVOID: ["Linezolid (bacteriostatic, high inoculum)"],
    surgical_consult: "Required for IE — echo, valve assessment"
  },
  pneumonia_vap_hap: {
    preferred_alternative: "Linezolid 600mg q12h (superior lung penetration)",
    AVOID: ["Daptomycin (inactivated by surfactant)"],
    evidence: "Meta-analyses favor linezolid for MRSA VAP clinical cure"
  },
  cns_infection: {
    preferred: "Linezolid 600mg q12h (CSF penetration ~70%)",
    adjunct: "Rifampin for biofilm penetration (device-associated)",
    alternative: "TMP-SMX 5mg/kg q8-12h"
  },
  osteomyelitis: {
    initial: "Vancomycin (continue if AUC therapeutic)",
    alternative_IV: "Daptomycin 6 mg/kg q24h",
    oral_stepdown: "Linezolid 600mg PO q12h or TMP-SMX",
    duration: "Typically 4-6 weeks"
  },
  ssti_complicated: {
    alternatives: ["Daptomycin 4 mg/kg q24h",
                   "Linezolid 600mg IV/PO q12h",
                   "Ceftaroline 600mg q12h"],
    opat_option: "Dalbavancin single-dose for simplified outpatient completion"
  }
};
```

### D.4 Alternatives Panel UI
```
ALTERNATIVE THERAPY GUIDANCE
Triggered by: [MIC > 1 mg/L ▼]     Infection: [MRSA Bacteremia ▼]
─────────────────────────────────────────────────────────────────

★ FIRST CHOICE: DAPTOMYCIN          Evidence: A-I
  Dose: 6 mg/kg IV q24h (standard)
  Renal: CrCl <30 → q48h
  ⚠️ NOT for pneumonia (surfactant inactivation)
  Monitor: CPK weekly | Blood cultures q48h
  [Expand for full dosing/monitoring info ▼]

○ COMBINATION SALVAGE: DAPTO + CEFTAROLINE    Evidence: B-II
  For: Persistent bacteremia >=5 days on monotherapy
  Dapto: 8-10 mg/kg q24h + CPT: 600mg q8h
  [Expand ▼]

○ LINEZOLID                         Evidence: B-II (bacteremia)
  Dose: 600mg IV or PO q12h
  Renal: No adjustment needed ✓
  ✓ IV-to-PO transition available
  ⚠️ NOT for endocarditis (bacteriostatic)
  Monitor: CBC weekly (thrombocytopenia)
  ⚠️ Check serotonergic drug interactions
  [Expand ▼]

CONTRAINDICATED FOR THIS PATIENT:
  ✗ Telavancin (CrCl 28 mL/min — boxed warning)
  ✗ Daptomycin for concurrent pneumonia

[Print Alternative Therapy Report]
```

---

## SECTION E: ADDITIONAL SAFETY MODULES

### E.1 Red Man Syndrome Module
```
Mechanism: Non-IgE mast cell degranulation (rate-dependent, NOT allergy)
Presentation: Flushing/erythema face/neck/torso, pruritus, hypotension during infusion

Prevention:
  - NEVER infuse faster than 10 mg/min (500mg min 50min; 1000mg min 100min; 2000mg min 200min)
  - Large doses (>1500mg): always 2-3h infusion
  - Premedicate: diphenhydramine 25-50mg IV 30-60min before if prior reaction

Treatment if RMS occurs:
  1. STOP infusion
  2. Diphenhydramine 25-50mg IV
  3. Restart at HALF rate when reaction resolves
  4. Extended infusion for all future doses

Software validation:
  IF dose_mg/tinf_h/60 > 10 mg/min:
    WARN: "Infusion rate exceeds 10 mg/min.
           Minimum infusion time for this dose: [dose/600] hours.
           Risk of Red Man Syndrome."
```

### E.2 Ototoxicity Monitoring
```
Risk: High-frequency sensorineural hearing loss
Risk factors: Duration >4 weeks, elderly, baseline hearing loss, concurrent aminoglycosides

Monitoring triggers:
  therapy_days > 14 AND (age > 65 OR aminoglycoside concurrent):
    INFO: "Consider baseline audiometry"
  therapy_days > 28:
    WARN: "Audiometry recommended every 2-4 weeks (OPAT protocol)"
  concurrent aminoglycoside:
    WARN: "Baseline + weekly audiometry with concurrent aminoglycoside"
```

### E.3 TMP-SMX SCr Artifact Alert
```
Special case: Trimethoprim blocks tubular secretion of creatinine.
Result: SCr rises ~0.2 mg/dL WITHOUT true GFR reduction.
Risk: Can falsely meet KDIGO AKI criteria.

Software logic:
  IF tmp_smx in nephrotoxins AND SCr rising:
    INFO: "Note: Trimethoprim blocks creatinine tubular secretion.
           SCr elevation may reflect pharmacologic effect rather than true AKI.
           Urine output, BUN/Cr ratio, and clinical assessment are important adjuncts.
           Consider cystatin C if available."
```

### E.4 VRE / Non-MRSA Organism Flag
```
DANGER alert if organism documented as:
  - Vancomycin-resistant Enterococcus (VRE)
  - VRSA (Vancomycin-Resistant S. aureus) — MIC >= 16 mg/L
  - Gram-negative organism

Message: "Vancomycin is NOT indicated for this organism.
          AinaDara Calc is designed for MRSA and susceptible gram-positive TDM only.
          Consult Infectious Diseases for appropriate alternative therapy."
```

---

## SECTION F: COMPLETE BUILD STRATEGY FOR OPUS

### F.1 Consolidated Prompt Delivery Plan
```
OPTION A — Full single-file build:
  Paste all 3 chunk brain docs as system prompt
  Request: "Build complete AinaDara Calc single JSX file"
  Risk: May exceed Opus context; long generation

OPTION B — Modular phases (RECOMMENDED):
  Phase 1 prompt: "Build and test PK math engine — pure JS only, no UI"
  Phase 2 prompt: "Build reducer + state management for the engine above"
  Phase 3 prompt: "Build PatientPanel + DosingPanel + AlertBanner components"
  Phase 4 prompt: "Build ResultsPanel, PKChart (Recharts), AUC gauge"
  Phase 5 prompt: "Build HistoryPanel + TimelineChart (multi-encounter)"
  Phase 6 prompt: "Build AlternativesPanel using the drug database provided"
  Phase 7 prompt: "Build OPATPanel + neonatal mode + CI mode"
  Phase 8 prompt: "Add PDF export + mobile responsiveness + evidence badges"
  Phase 9 prompt: "Integrate all components into single JSX file + test"

OPTION C — Iterative with validation tests:
  Provide test case with known expected outputs for Opus to assert against.

RECOMMENDED: Option B with Chunk 1 JSX as starting reference.
```

### F.2 Opus Invocation Template
```
[SYSTEM]:
You are building AinaDara Calc, a clinical vancomycin TDM decision support application.

Clinical authority: 2020 ASHP/IDSA/PIDS/SIDP Vancomycin Consensus Guidelines.
This is clinical decision support software — all output requires clinician review.

[FULL STATE SCHEMA FROM SECTION A]
[FULL MATH ENGINE SPEC FROM SECTION A]
[FULL NEPHROTOXIN DB FROM SECTION C]
[FULL ALTERNATIVES DB FROM SECTION D]
[UI WIREFRAMES FROM SECTION B]

[USER]:
Build Phase 1: Complete PK math engine as pure JavaScript.
Include all functions from the mathematical engine spec.
After each function, add a console.assert() with the provided test case.
Output as a browser-testable script block — no UI yet.

Test case to validate:
  Patient: 70yo male, 75kg, 175cm, SCr 1.4 mg/dL
  CrCl expected: ~45 mL/min
  IBW expected: ~72.6 kg
  Dose: 1000mg q12h, tinf=1h
  Level 1 (peak): 28.5 mg/L at 2h post-infusion-end (t_abs=3h)
  Level 2 (trough): 10.2 mg/L at t_abs=12h
  Expected output from Bayesian MAP:
    Ke ~0.098-0.101 h-1
    t1/2 ~6.9-7.1 h
    AUC24 ~465-490 mg*h/L
```

### F.3 Final QA Checklist Before Clinical Use
```
Math validation:
  [ ] Test all PK functions against published case examples
  [ ] Verify KDIGO detection with SCr scenarios
  [ ] Verify neonatal CL calculation for each PMA band
  [ ] Verify CI rate calculator output against manual calculation
  [ ] Verify Crass 2018 formula implementation (obese mode)
  [ ] Verify Schwartz formula for pediatric CrCl

Clinical safety:
  [ ] All hard stops trigger and block calculation
  [ ] All soft warnings display without blocking
  [ ] Red Man Syndrome rate check fires correctly
  [ ] TMP-SMX SCr artifact alert appears
  [ ] VRE/gram-negative organism alert fires
  [ ] Alternatives panel populates correctly for each trigger
  [ ] OPAT eligibility checklist complete

UI/UX:
  [ ] All 7 modes accessible and functional
  [ ] Mobile layout renders correctly at 375px and 768px
  [ ] Encounter history saves to localStorage and restores
  [ ] PDF export generates complete report
  [ ] Evidence grade badges visible on all recommendations
  [ ] Formula tooltips expand and show correct math
  [ ] "Clinical Decision Support Only" disclaimer visible
  [ ] Dark theme consistent throughout

Disclaimer:
  [ ] Footer: "AinaDara Calc | Based on 2020 ASHP/IDSA/PIDS/SIDP Vancomycin Guidelines"
  [ ] Footer: "For Clinical Decision Support Only. All recommendations require qualified healthcare professional review."
  [ ] No absolute contraindications to using clinical judgment override
```

---

## SECTION G: SUMMARY — ALL THREE CHUNKS

```
CHUNK 1 (Complete JSX file in outputs):
  Bayesian MAP engine prototype
  Single-file React UI with all 7 modes
  Recharts PK curve
  Alert system
  Core dosing logic

CHUNK 2 (Brain document):
  M1: Neonatal PK (Grimsley-Thomson, PMA-banded)
  M2: CI Rate Calculator (Css targeting)
  M3: Multi-encounter history + Bayesian prior propagation
  M4: OPAT eligibility + monitoring schedule
  M5: AKI/Random level mode (SCr trajectory classifier)
  M6: PDF/CSV/JSON export spec
  M7: Full clinical decision tree
  M8: Schwartz pediatric CrCl
  M9: Validation rules (hard stops + soft)
  M10: Opus architecture + state shape

CHUNK 3 (This document):
  A: Complete Opus master prompt + build checklist
  B: Detailed UI wireframes (desktop + mobile + all panels)
  C: Nephrotoxin interaction database (10 agents, scoring logic)
  D: Alternative therapy module (5 drugs, full dosing + monitoring)
  E: Additional safety modules (RMS, ototoxicity, TMP-SMX artifact, VRE)
  F: Build strategy, Opus invocation template, final QA checklist

TOTAL SPECIFICATION: Complete. Ready for Opus build when tokens available.
```

---
*AinaDara Calc Brain Document v3.0 | March 2026*
*Chunks 1-3 form the complete specification for AinaDara Calc Opus build.*
*Clinical decision support only. All recommendations require healthcare professional review.*

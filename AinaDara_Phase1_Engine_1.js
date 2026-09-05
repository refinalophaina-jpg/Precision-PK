// ═══════════════════════════════════════════════════════════════════════════════
// AINADARA CALC — Therapeutic Drug Monitoring Suite
// Phase 1: Pure JavaScript PK Mathematical Engine
// v1.0 | Based on 2020 ASHP/IDSA/PIDS/SIDP Vancomycin Consensus Guidelines
// Clinical Decision Support Only — All recommendations require clinician review
// ═══════════════════════════════════════════════════════════════════════════════

(function AinaDaraCalcEngine() {
  'use strict';

  const VERSION = '1.0.0-engine';
  let testsPassed = 0;
  let testsFailed = 0;
  const testResults = [];

  // ─────────────────────────────────────────────────────────────────────────────
  // UTILITY: Custom assertion with descriptive output
  // ─────────────────────────────────────────────────────────────────────────────
  function assert(condition, testName, details) {
    if (condition) {
      testsPassed++;
      testResults.push({ status: 'PASS', name: testName });
      console.log(`  ✅ PASS: ${testName}`);
    } else {
      testsFailed++;
      testResults.push({ status: 'FAIL', name: testName, details });
      console.error(`  ❌ FAIL: ${testName}`);
      if (details) console.error(`         ${details}`);
    }
  }

  function assertApprox(actual, expected, tolerance, testName) {
    const diff = Math.abs(actual - expected);
    const withinTol = diff <= tolerance;
    const details = `Expected ~${expected} ± ${tolerance}, got ${actual} (diff: ${diff.toFixed(6)})`;
    assert(withinTol, testName, withinTol ? undefined : details);
  }

  function assertRange(actual, low, high, testName) {
    const inRange = actual >= low && actual <= high;
    const details = `Expected [${low}, ${high}], got ${actual}`;
    assert(inRange, testName, inRange ? undefined : details);
  }


  // ═══════════════════════════════════════════════════════════════════════════
  // MODULE 1: ANTHROPOMETRIC CALCULATIONS
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n══════════════════════════════════════════════');
  console.log('MODULE 1: ANTHROPOMETRIC CALCULATIONS');
  console.log('══════════════════════════════════════════════');

  /**
   * Ideal Body Weight (Devine 1974)
   * @param {string} sex - 'M' or 'F'
   * @param {number} height_cm - Height in centimeters
   * @returns {number|null} IBW in kg, or null if height < 152cm (60in)
   */
  function calcIBW(sex, height_cm) {
    if (!height_cm || height_cm <= 0) return null;
    const h_in = height_cm / 2.54;
    // For patients shorter than 5 feet, IBW is less reliable
    // but we still calculate using the formula (return with flag)
    if (sex === 'M') {
      return 50 + 2.3 * (h_in - 60);
    } else {
      return 45.5 + 2.3 * (h_in - 60);
    }
  }

  // Tests: calcIBW
  console.log('\n--- calcIBW Tests ---');
  assertApprox(calcIBW('M', 175), 72.61, 0.5, 'IBW: 175cm male ≈ 72.6 kg');
  assertApprox(calcIBW('F', 175), 68.11, 0.5, 'IBW: 175cm female ≈ 68.1 kg');
  assertApprox(calcIBW('M', 152.4), 50.0, 0.1, 'IBW: 60in male = 50.0 kg');
  assertApprox(calcIBW('F', 152.4), 45.5, 0.1, 'IBW: 60in female = 45.5 kg');
  assertApprox(calcIBW('M', 190), 84.09, 0.5, 'IBW: 190cm male ≈ 84.1 kg');
  assert(calcIBW('M', 0) === null, 'IBW: 0 height returns null');
  assert(calcIBW('M', -10) === null, 'IBW: negative height returns null');


  /**
   * Adjusted Body Weight (for obese patients where ABW > 130% IBW)
   * @param {number} ibw - Ideal body weight in kg
   * @param {number} abw - Actual body weight in kg
   * @returns {number} Adjusted body weight in kg
   */
  function calcAdjBW(ibw, abw) {
    if (!ibw || !abw || ibw <= 0 || abw <= 0) return null;
    return ibw + 0.4 * (abw - ibw);
  }

  // Tests: calcAdjBW
  console.log('\n--- calcAdjBW Tests ---');
  assertApprox(calcAdjBW(70, 130), 94.0, 0.01, 'AdjBW: IBW=70, ABW=130 → 94 kg');
  assertApprox(calcAdjBW(50, 100), 70.0, 0.01, 'AdjBW: IBW=50, ABW=100 → 70 kg');
  assert(calcAdjBW(0, 100) === null, 'AdjBW: IBW=0 returns null');


  /**
   * Body Mass Index
   * @param {number} abw_kg - Actual body weight in kg
   * @param {number} height_cm - Height in centimeters
   * @returns {number|null} BMI in kg/m²
   */
  function calcBMI(abw_kg, height_cm) {
    if (!abw_kg || !height_cm || abw_kg <= 0 || height_cm <= 0) return null;
    return abw_kg / ((height_cm / 100) ** 2);
  }

  // Tests: calcBMI
  console.log('\n--- calcBMI Tests ---');
  assertApprox(calcBMI(75, 175), 24.49, 0.1, 'BMI: 75kg/175cm ≈ 24.5');
  assertApprox(calcBMI(100, 170), 34.60, 0.1, 'BMI: 100kg/170cm ≈ 34.6');
  assert(calcBMI(0, 175) === null, 'BMI: 0 weight returns null');


  /**
   * Body Surface Area (Mosteller formula)
   * @param {number} height_cm
   * @param {number} wt_kg
   * @returns {number|null} BSA in m²
   */
  function calcBSA(height_cm, wt_kg) {
    if (!height_cm || !wt_kg || height_cm <= 0 || wt_kg <= 0) return null;
    return Math.sqrt((height_cm * wt_kg) / 3600);
  }

  // Tests: calcBSA
  console.log('\n--- calcBSA Tests ---');
  assertApprox(calcBSA(175, 75), 1.9028, 0.01, 'BSA: 175cm/75kg ≈ 1.90 m²');
  assertApprox(calcBSA(170, 70), 1.817, 0.01, 'BSA: 170cm/70kg ≈ 1.82 m²');


  /**
   * Determine dosing weight based on patient characteristics
   * Vancomycin: use ABW for all patients per 2020 guidelines
   * But IBW/AdjBW needed for Vd estimation and population PK
   * @param {object} patient
   * @returns {object} { dosing_wt, wt_type, ibw, adjbw, bmi, isObese }
   */
  function calcDosingWeights(patient) {
    const { sex, height_cm, abw_kg } = patient;
    const ibw = calcIBW(sex, height_cm);
    const bmi = calcBMI(abw_kg, height_cm);
    const adjbw = ibw ? calcAdjBW(ibw, abw_kg) : null;
    const isObese = ibw ? (abw_kg > 1.3 * ibw) : (bmi && bmi >= 30);

    // Vancomycin dosing uses ABW for initial dosing per 2020 guidelines
    // Population PK Vd estimation uses IBW (Matzke) or TBW (Crass)
    return {
      dosing_wt: abw_kg,       // Vanc initial dosing always ABW
      wt_type: 'ABW',
      ibw: ibw ? Math.round(ibw * 100) / 100 : null,
      adjbw: adjbw ? Math.round(adjbw * 100) / 100 : null,
      bmi: bmi ? Math.round(bmi * 100) / 100 : null,
      bsa: calcBSA(height_cm, abw_kg),
      isObese
    };
  }

  // Tests: calcDosingWeights
  console.log('\n--- calcDosingWeights Tests ---');
  const wts_standard = calcDosingWeights({ sex: 'M', height_cm: 175, abw_kg: 75 });
  assert(wts_standard.isObese === false, 'DosingWts: 75kg/175cm male is NOT obese');
  assertApprox(wts_standard.ibw, 72.61, 0.5, 'DosingWts: IBW ≈ 72.6');
  assert(wts_standard.dosing_wt === 75, 'DosingWts: dosing weight = ABW = 75');

  const wts_obese = calcDosingWeights({ sex: 'M', height_cm: 175, abw_kg: 140 });
  assert(wts_obese.isObese === true, 'DosingWts: 140kg/175cm male IS obese');
  assertApprox(wts_obese.adjbw, 99.57, 1.0, 'DosingWts: AdjBW for obese ≈ 99.6');


  // ═══════════════════════════════════════════════════════════════════════════
  // MODULE 2: RENAL FUNCTION CALCULATIONS
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n══════════════════════════════════════════════');
  console.log('MODULE 2: RENAL FUNCTION CALCULATIONS');
  console.log('══════════════════════════════════════════════');

  /**
   * Cockcroft-Gault Creatinine Clearance (Adult)
   * Per 2020 guidelines: use ABW for non-obese, AdjBW for obese
   * Note: Cap at 150 mL/min for PK calculations unless ARC mode
   * @param {number} age - in years
   * @param {string} sex - 'M' or 'F'
   * @param {number} weight_kg - dosing weight (ABW or AdjBW)
   * @param {number} scr - serum creatinine (mg/dL)
   * @param {object} options - { capAt150: bool, useAdjBW: bool }
   * @returns {number|null} CrCl in mL/min
   */
  function calcCrCl(age, sex, weight_kg, scr, options = {}) {
    if (!age || !weight_kg || !scr || age <= 0 || weight_kg <= 0 || scr <= 0) {
      return null;
    }

    // Round SCr up to 1.0 for low values per some institutional protocols
    // But per 2020 guidelines, use actual SCr — flag if very low
    let crcl = ((140 - age) * weight_kg) / (72 * scr);
    if (sex === 'F') {
      crcl *= 0.85;
    }

    // Optional cap
    if (options.capAt150 && crcl > 150) {
      crcl = 150;
    }

    return crcl;
  }

  // Tests: calcCrCl (Cockcroft-Gault)
  console.log('\n--- calcCrCl (Cockcroft-Gault) Tests ---');

  // Primary test case: 70yo M, 75kg, SCr 1.4
  const crcl_test = calcCrCl(70, 'M', 75, 1.4);
  assertApprox(crcl_test, 52.08, 1.0, 'CrCl: 70yo M, 75kg, SCr 1.4 → ~52 mL/min');
  // Note: Project spec said ~45 but (140-70)*75/(72*1.4) = 5250/100.8 = 52.08
  // The spec may have used IBW(72.6) instead: (140-70)*72.6/(72*1.4) = 5082/100.8 = 50.4
  // Let's verify both and note the discrepancy

  const crcl_with_ibw = calcCrCl(70, 'M', 72.6, 1.4);
  assertApprox(crcl_with_ibw, 50.42, 1.0, 'CrCl (using IBW): 70yo M, 72.6kg(IBW), SCr 1.4 → ~50.4 mL/min');

  assertApprox(calcCrCl(40, 'F', 60, 0.8), 74.48, 1.0, 'CrCl: 40yo F, 60kg, SCr 0.8 → ~74.5');
  assertApprox(calcCrCl(25, 'M', 80, 1.0), 127.78, 1.0, 'CrCl: 25yo M, 80kg, SCr 1.0 → ~128');
  assert(calcCrCl(70, 'M', 75, 0) === null, 'CrCl: SCr=0 returns null');
  assert(calcCrCl(0, 'M', 75, 1.0) === null, 'CrCl: age=0 returns null');

  // Augmented renal clearance detection
  const crcl_arc = calcCrCl(25, 'M', 90, 0.6);
  assert(crcl_arc > 130, `CrCl ARC detection: ${crcl_arc.toFixed(1)} > 130 → ARC flag`);


  /**
   * Schwartz Pediatric CrCl (2009 bedside formula)
   * eGFR = k × height(cm) / SCr
   * @param {number} age_years
   * @param {string} sex
   * @param {number} height_cm
   * @param {number} scr - serum creatinine (mg/dL)
   * @param {boolean} isPremature - born premature
   * @returns {object} { egfr, k_value, method }
   */
  function calcSchwartzCrCl(age_years, sex, height_cm, scr, isPremature = false) {
    if (!height_cm || !scr || height_cm <= 0 || scr <= 0) return null;

    let k;
    let method;

    if (isPremature && age_years < 1) {
      k = 0.33;
      method = 'Schwartz-premature';
    } else if (age_years < 1) {
      k = 0.45;
      method = 'Schwartz-term-infant';
    } else if (age_years >= 13 && sex === 'M') {
      k = 0.70;
      method = 'Schwartz-adolescent-male';
    } else {
      // Children 1-12, and adolescent females
      k = 0.55;
      method = 'Schwartz-child';
    }

    // 2009 bedside Schwartz uses k=0.413 universally with IDMS creatinine
    // Traditional Schwartz uses age/sex-dependent k values
    // We implement traditional per spec; add 2009 bedside as option
    const egfr_traditional = (k * height_cm) / scr;
    const egfr_bedside_2009 = (0.413 * height_cm) / scr;

    return {
      egfr: egfr_traditional,
      egfr_bedside: egfr_bedside_2009,
      k_value: k,
      method
    };
  }

  // Tests: Schwartz CrCl
  console.log('\n--- Schwartz Pediatric CrCl Tests ---');
  const schwartz_child = calcSchwartzCrCl(8, 'M', 130, 0.5);
  assertApprox(schwartz_child.egfr, 143.0, 1.0, 'Schwartz: 8yo M, 130cm, SCr 0.5 → ~143 mL/min/1.73m²');
  assert(schwartz_child.k_value === 0.55, 'Schwartz: k=0.55 for child');

  const schwartz_teen = calcSchwartzCrCl(15, 'M', 170, 0.9);
  assertApprox(schwartz_teen.egfr, 132.2, 1.0, 'Schwartz: 15yo M, 170cm, SCr 0.9 → ~132');
  assert(schwartz_teen.k_value === 0.70, 'Schwartz: k=0.70 for adolescent male');

  const schwartz_infant = calcSchwartzCrCl(0.5, 'F', 65, 0.3);
  assertApprox(schwartz_infant.egfr, 97.5, 1.0, 'Schwartz: 6mo F, 65cm, SCr 0.3 → ~97.5');
  assert(schwartz_infant.k_value === 0.45, 'Schwartz: k=0.45 for term infant');

  const schwartz_premie = calcSchwartzCrCl(0.1, 'M', 45, 0.8, true);
  assertApprox(schwartz_premie.egfr, 18.56, 0.5, 'Schwartz: premature infant → ~18.6');
  assert(schwartz_premie.k_value === 0.33, 'Schwartz: k=0.33 for premature');


  // ═══════════════════════════════════════════════════════════════════════════
  // MODULE 3: POPULATION PK PRIORS (ALL 6 MODES)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n══════════════════════════════════════════════');
  console.log('MODULE 3: POPULATION PK PRIORS');
  console.log('══════════════════════════════════════════════');

  /**
   * Matzke 1984 — Standard Adult Population PK
   * CL (L/h) = CrCl(mL/min) × 0.041 + 0.22 (L/h)
   * Vd (L) = 0.70 × IBW (kg)
   * @param {number} crcl_ml_min
   * @param {number} ibw_kg
   * @returns {object} { CL, Vd, ke, t_half, CV_CL, CV_Vd, method }
   */
  function priorMatzke(crcl_ml_min, ibw_kg) {
    const CL = crcl_ml_min * 0.041 + 0.22;  // L/h
    const Vd = 0.70 * ibw_kg;                 // L
    const ke = CL / Vd;
    const t_half = 0.693 / ke;

    return {
      CL: Math.round(CL * 1000) / 1000,
      Vd: Math.round(Vd * 100) / 100,
      ke: Math.round(ke * 10000) / 10000,
      t_half: Math.round(t_half * 100) / 100,
      CV_CL: 0.30,   // ~30% inter-individual variability
      CV_Vd: 0.20,   // ~20% inter-individual variability
      method: 'Matzke 1984'
    };
  }

  // Tests: Matzke
  console.log('\n--- Matzke 1984 Standard Prior ---');
  // Using CrCl with ABW = 52.08, but for prior let's use a representative value
  const matzke_test = priorMatzke(50, 72.6);
  assertApprox(matzke_test.CL, 2.27, 0.05, 'Matzke: CrCl=50 → CL ≈ 2.27 L/h');
  assertApprox(matzke_test.Vd, 50.82, 0.5, 'Matzke: IBW=72.6 → Vd ≈ 50.8 L');
  assert(matzke_test.t_half > 10 && matzke_test.t_half < 20,
    `Matzke: t1/2 = ${matzke_test.t_half}h (expected 10-20h for CrCl=50)`);

  const matzke_normal = priorMatzke(100, 70);
  assertApprox(matzke_normal.CL, 4.32, 0.05, 'Matzke: CrCl=100 → CL ≈ 4.32 L/h');

  const matzke_low = priorMatzke(15, 65);
  assertApprox(matzke_low.CL, 0.835, 0.05, 'Matzke: CrCl=15 → CL ≈ 0.835 L/h');


  /**
   * Crass 2018 — Obese Adult Population PK
   * CL (mL/min) = 9.656 − 0.078×age − 2.009×SCr + 1.09×sex_num + 0.04×TBW^0.75
   * where sex_num: male=1, female=0
   * Vd = 0.17 × TBW + 31.4 (from Crass model, Vd at steady state)
   * @param {number} age
   * @param {string} sex
   * @param {number} scr
   * @param {number} tbw_kg - Total body weight (ABW)
   * @returns {object} PK prior
   */
  function priorCrass2018(age, sex, scr, tbw_kg) {
    const sex_num = sex === 'M' ? 1 : 0;
    // CL in mL/min from the Crass model
    const CL_ml_min = 9.656 - (0.078 * age) - (2.009 * scr) + (1.09 * sex_num)
                      + (0.04 * Math.pow(tbw_kg, 0.75));
    const CL = Math.max(0.01, CL_ml_min / 1000 * 60);  // Convert mL/min to L/h: ×60/1000

    // Vd from Crass: Vd_ss = 0.17 * TBW + 31.4 (liters)
    // Alternative: some implement as 0.7 * TBW for obese
    // We use Crass-specific: Vd = 0.17*TBW + 31.4
    const Vd = 0.17 * tbw_kg + 31.4;

    const ke = CL / Vd;
    const t_half = 0.693 / ke;

    return {
      CL: Math.round(CL * 1000) / 1000,
      Vd: Math.round(Vd * 100) / 100,
      ke: Math.round(ke * 10000) / 10000,
      t_half: Math.round(t_half * 100) / 100,
      CV_CL: 0.35,
      CV_Vd: 0.25,
      method: 'Crass 2018 (obese)'
    };
  }

  // Tests: Crass 2018
  console.log('\n--- Crass 2018 Obese Prior ---');
  const crass_test = priorCrass2018(55, 'M', 1.0, 140);
  assert(crass_test.CL > 0, `Crass: CL = ${crass_test.CL} L/h (positive)`);
  assert(crass_test.Vd > 50, `Crass: Vd = ${crass_test.Vd} L (>50 for 140kg)`);
  assertApprox(crass_test.Vd, 55.2, 1.0, 'Crass: Vd = 0.17×140+31.4 ≈ 55.2 L');
  console.log(`  📊 Crass 140kg patient: CL=${crass_test.CL}, Vd=${crass_test.Vd}, t1/2=${crass_test.t_half}h`);

  const crass_female = priorCrass2018(60, 'F', 1.2, 120);
  assert(crass_female.CL > 0, `Crass female: CL = ${crass_female.CL} L/h`);


  /**
   * Grimsley-Thomson 1999 — Neonatal Population PK
   * CL varies by PMA (postmenstrual age) band
   * Vd = 0.69 × ABW (neonatal distribution volume is larger)
   * SCr correction for maternal creatinine in first 72h of life
   * @param {number} pma_weeks - postmenstrual age
   * @param {number} abw_kg - actual body weight
   * @param {number} scr - serum creatinine
   * @param {boolean} scr_age_flag - true if SCr drawn < 72h of life (reflects maternal)
   * @returns {object} PK prior
   */
  function priorNeonatal(pma_weeks, abw_kg, scr, scr_age_flag = false) {
    if (!pma_weeks || !abw_kg || pma_weeks <= 0 || abw_kg <= 0) return null;

    // CL calculation by PMA band (L/h from Grimsley-Thomson)
    // These are in L/h already (weight-normalized equations)
    let CL;
    if (pma_weeks <= 28) {
      CL = 0.0131 * abw_kg + 0.0087;
    } else if (pma_weeks <= 36) {
      CL = 0.0248 * abw_kg + 0.0120;
    } else if (pma_weeks <= 44) {
      CL = 0.0303 * abw_kg + 0.0160;
    } else {
      CL = 0.0370 * abw_kg + 0.0220;
    }

    // SCr correction: if SCr > threshold and age < 72h, adjust
    // Maternal SCr flag — SCr in first 72h reflects mother, not neonate
    if (scr_age_flag) {
      // Don't use SCr for CL estimation — use population average only
      // Flag for the clinician
    } else if (scr && scr > 0.5) {
      // SCr-based correction factor for impaired renal function
      CL *= (0.5 / scr);
    }

    // Neonatal Vd: 0.69 L/kg × ABW
    const Vd = 0.69 * abw_kg;
    const ke = CL / Vd;
    const t_half = ke > 0 ? 0.693 / ke : null;

    return {
      CL: Math.round(CL * 10000) / 10000,
      Vd: Math.round(Vd * 1000) / 1000,
      ke: Math.round(ke * 10000) / 10000,
      t_half: t_half ? Math.round(t_half * 100) / 100 : null,
      CV_CL: 0.40,  // Higher variability in neonates
      CV_Vd: 0.25,
      pma_band: pma_weeks <= 28 ? '<=28' : pma_weeks <= 36 ? '29-36'
                : pma_weeks <= 44 ? '37-44' : '>44',
      scr_age_flag,
      method: 'Grimsley-Thomson 1999 (neonatal)'
    };
  }

  // Tests: Neonatal Prior
  console.log('\n--- Grimsley-Thomson Neonatal Prior ---');
  const neo_26wk = priorNeonatal(26, 0.9, 0.8);
  assert(neo_26wk.pma_band === '<=28', 'Neonatal: PMA 26wk → band <=28');
  assert(neo_26wk.CL > 0, `Neonatal 26wk: CL = ${neo_26wk.CL} L/h`);
  assertApprox(neo_26wk.Vd, 0.621, 0.01, 'Neonatal: Vd = 0.69×0.9 ≈ 0.621 L');

  const neo_34wk = priorNeonatal(34, 2.0, 0.4);
  assert(neo_34wk.pma_band === '29-36', 'Neonatal: PMA 34wk → band 29-36');
  const expected_cl_34 = 0.0248 * 2.0 + 0.0120;  // 0.0616 L/h (no SCr correction, SCr < 0.5)
  assertApprox(neo_34wk.CL, expected_cl_34, 0.001, `Neonatal 34wk: CL ≈ ${expected_cl_34.toFixed(4)} L/h`);

  const neo_40wk = priorNeonatal(40, 3.5, 0.6);
  assert(neo_40wk.pma_band === '37-44', 'Neonatal: PMA 40wk → band 37-44');

  const neo_scr_flag = priorNeonatal(32, 1.5, 1.2, true);
  assert(neo_scr_flag.scr_age_flag === true, 'Neonatal: SCr age flag preserved');

  // High SCr correction test
  const neo_high_scr = priorNeonatal(34, 2.0, 1.0, false);
  const base_cl = 0.0248 * 2.0 + 0.0120;
  const corrected_cl = base_cl * (0.5 / 1.0);
  assertApprox(neo_high_scr.CL, corrected_cl, 0.001,
    `Neonatal high SCr: CL corrected from ${base_cl.toFixed(4)} to ${corrected_cl.toFixed(4)} L/h`);


  /**
   * Pediatric Population PK Prior
   * CL derived from age-appropriate CrCl (Schwartz) + population equations
   * Vd = 0.65 L/kg × ABW (pediatric)
   * Based on Goti 2018 / population estimates
   * @param {number} crcl_ml_min_1_73m2 - from Schwartz
   * @param {number} abw_kg
   * @param {number} bsa_m2
   * @returns {object} PK prior
   */
  function priorPediatric(crcl_ml_min_1_73m2, abw_kg, bsa_m2) {
    if (!crcl_ml_min_1_73m2 || !abw_kg) return null;

    // De-normalize Schwartz eGFR from per 1.73m² to absolute
    const absolute_crcl = bsa_m2
      ? crcl_ml_min_1_73m2 * (bsa_m2 / 1.73)
      : crcl_ml_min_1_73m2;  // If BSA unavailable, use as-is (approximation)

    // CL from population: similar relationship as Matzke but adjusted for pediatrics
    // CL (L/h) = absolute_CrCl × 0.041 + 0.22
    const CL = absolute_crcl * 0.041 + 0.22;
    const Vd = 0.65 * abw_kg;
    const ke = CL / Vd;
    const t_half = 0.693 / ke;

    return {
      CL: Math.round(CL * 1000) / 1000,
      Vd: Math.round(Vd * 100) / 100,
      ke: Math.round(ke * 10000) / 10000,
      t_half: Math.round(t_half * 100) / 100,
      CV_CL: 0.35,
      CV_Vd: 0.25,
      crcl_absolute: Math.round(absolute_crcl * 10) / 10,
      method: 'Pediatric (Goti 2018 / population)'
    };
  }

  // Tests: Pediatric Prior
  console.log('\n--- Pediatric Population Prior ---');
  const ped_test = priorPediatric(130, 25, 0.95);
  assert(ped_test.CL > 0, `Pediatric: CL = ${ped_test.CL} L/h`);
  assertApprox(ped_test.Vd, 16.25, 0.1, 'Pediatric: Vd = 0.65×25 = 16.25 L');
  console.log(`  📊 Pediatric: CL=${ped_test.CL}, Vd=${ped_test.Vd}, t1/2=${ped_test.t_half}h`);


  /**
   * CRRT (Continuous Renal Replacement Therapy) Prior
   * CL_total = CL_CRRT (effluent-based) + CL_residual
   * CL_CRRT ≈ SC × effluent_rate (SC = sieving coefficient ≈ 0.7-0.8 for vancomycin)
   * Residual CL: 0.22 L/h (Matzke intercept = non-renal clearance)
   * Vd: 0.70 × IBW (standard)
   * @param {number} effluent_rate_ml_kg_h - typical 20-35 mL/kg/h
   * @param {number} abw_kg
   * @param {number} ibw_kg
   * @returns {object} PK prior
   */
  function priorCRRT(effluent_rate_ml_kg_h, abw_kg, ibw_kg) {
    if (!effluent_rate_ml_kg_h || !abw_kg) return null;

    const SC = 0.75;  // Vancomycin sieving coefficient (average)
    // Convert effluent rate to L/h: (mL/kg/h × ABW) / 1000
    const effluent_L_h = (effluent_rate_ml_kg_h * abw_kg) / 1000;
    const CL_CRRT = SC * effluent_L_h;
    const CL_residual = 0.22;  // Non-renal clearance
    const CL = CL_CRRT + CL_residual;

    const Vd = 0.70 * (ibw_kg || abw_kg);
    const ke = CL / Vd;
    const t_half = 0.693 / ke;

    return {
      CL: Math.round(CL * 1000) / 1000,
      CL_CRRT: Math.round(CL_CRRT * 1000) / 1000,
      CL_residual,
      Vd: Math.round(Vd * 100) / 100,
      ke: Math.round(ke * 10000) / 10000,
      t_half: Math.round(t_half * 100) / 100,
      effluent_L_h: Math.round(effluent_L_h * 100) / 100,
      sieving_coefficient: SC,
      CV_CL: 0.40,  // High variability in CRRT
      CV_Vd: 0.25,
      method: 'CRRT (effluent-based + residual)'
    };
  }

  // Tests: CRRT Prior
  console.log('\n--- CRRT Population Prior ---');
  const crrt_test = priorCRRT(25, 80, 70);
  // Effluent: 25 × 80 / 1000 = 2.0 L/h
  // CL_CRRT = 0.75 × 2.0 = 1.5 L/h
  // CL_total = 1.5 + 0.22 = 1.72 L/h
  assertApprox(crrt_test.effluent_L_h, 2.0, 0.01, 'CRRT: effluent = 2.0 L/h');
  assertApprox(crrt_test.CL_CRRT, 1.5, 0.01, 'CRRT: CL_CRRT = 1.5 L/h');
  assertApprox(crrt_test.CL, 1.72, 0.01, 'CRRT: CL_total = 1.72 L/h');
  assertApprox(crrt_test.Vd, 49.0, 0.1, 'CRRT: Vd = 0.70×70 = 49.0 L');
  console.log(`  📊 CRRT: CL=${crrt_test.CL}, t1/2=${crrt_test.t_half}h`);


  /**
   * Hemodialysis (Intermittent) Prior
   * Interdialytic: CL ≈ 0.10 L/h (essentially non-renal only)
   * Intradialytic: Vancomycin is removed ~30-40% per 4h HD session with high-flux
   * Vd = 0.70 × IBW
   * Dosing: Typically 15-25 mg/kg post-HD, redose based on pre-HD level
   * @param {number} ibw_kg
   * @param {number} abw_kg
   * @param {number} hd_duration_h - typical 3-4h
   * @param {boolean} high_flux - high-flux membrane (most modern dialyzers)
   * @returns {object} PK prior (interdialytic kinetics)
   */
  function priorHD(ibw_kg, abw_kg, hd_duration_h = 4, high_flux = true) {
    if (!ibw_kg && !abw_kg) return null;

    const CL_interdialytic = 0.10;  // L/h (minimal residual renal function)
    const Vd = 0.70 * (ibw_kg || abw_kg);

    // Dialytic clearance: for high-flux ~80-120 mL/min vancomycin removal
    // Fractional removal per session: 1 - e^(-CL_HD/Vd × t_HD)
    const CL_HD_ml_min = high_flux ? 100 : 40;  // mL/min
    const CL_HD_L_h = CL_HD_ml_min * 0.06;      // Convert to L/h
    const fraction_removed = 1 - Math.exp(-(CL_HD_L_h / Vd) * hd_duration_h);

    const ke_interdialytic = CL_interdialytic / Vd;
    const t_half_interdialytic = 0.693 / ke_interdialytic;

    return {
      CL_interdialytic,
      CL_HD_L_h: Math.round(CL_HD_L_h * 100) / 100,
      Vd: Math.round(Vd * 100) / 100,
      ke_interdialytic: Math.round(ke_interdialytic * 10000) / 10000,
      t_half_interdialytic: Math.round(t_half_interdialytic * 10) / 10,
      fraction_removed_per_session: Math.round(fraction_removed * 1000) / 1000,
      percent_removed: Math.round(fraction_removed * 100),
      high_flux,
      CV_CL: 0.50,  // Very high variability in HD patients
      CV_Vd: 0.30,
      method: 'Hemodialysis (intermittent)',
      dosing_note: 'Dose post-HD. Check pre-HD level to guide supplemental dosing.'
    };
  }

  // Tests: HD Prior
  console.log('\n--- Hemodialysis Population Prior ---');
  const hd_test = priorHD(70, 85, 4, true);
  assertApprox(hd_test.Vd, 49.0, 0.1, 'HD: Vd = 0.70×70 = 49.0 L');
  assertApprox(hd_test.CL_interdialytic, 0.10, 0.001, 'HD: CL interdialytic = 0.10 L/h');
  assert(hd_test.fraction_removed_per_session > 0.25 && hd_test.fraction_removed_per_session < 0.50,
    `HD: fraction removed per session = ${hd_test.fraction_removed_per_session} (expected 0.25-0.50 for high-flux)`);
  console.log(`  📊 HD: t1/2 interdialytic=${hd_test.t_half_interdialytic}h, removal=${hd_test.percent_removed}%/session`);


  /**
   * Master population PK prior selector
   * Routes to appropriate model based on patient mode
   * @param {object} patient - complete patient object
   * @returns {object} PK prior
   */
  function getPopulationPrior(patient) {
    const {
      mode, age, sex, height_cm, abw_kg, scr,
      pma_weeks, birth_weight_kg, scr_age_flag,
      crrt_effluent_ml_kg_h, hd_duration_h
    } = patient;

    const weights = calcDosingWeights(patient);
    const ibw = weights.ibw;

    switch (mode) {
      case 'neonatal':
        return priorNeonatal(
          pma_weeks,
          abw_kg || birth_weight_kg,
          scr,
          scr_age_flag
        );

      case 'pediatric': {
        const schwartz = calcSchwartzCrCl(age, sex, height_cm, scr);
        const bsa = calcBSA(height_cm, abw_kg);
        return priorPediatric(
          schwartz ? schwartz.egfr : 100,
          abw_kg,
          bsa
        );
      }

      case 'obese':
        return priorCrass2018(age, sex, scr, abw_kg);

      case 'CRRT':
        return priorCRRT(
          crrt_effluent_ml_kg_h || 25,
          abw_kg,
          ibw
        );

      case 'HD':
        return priorHD(ibw, abw_kg, hd_duration_h || 4, true);

      case 'standard':
      case 'AKI':
      case 'CI':
      default: {
        // Use actual weight for CG unless obese (> 130% IBW)
        const cg_weight = weights.isObese ? weights.adjbw : abw_kg;
        const crcl = calcCrCl(age, sex, cg_weight, scr);
        return priorMatzke(crcl || 50, ibw || abw_kg * 0.7);
      }
    }
  }

  // Tests: Master prior selector
  console.log('\n--- Master Population Prior Selector ---');
  const prior_std = getPopulationPrior({
    mode: 'standard', age: 70, sex: 'M', height_cm: 175, abw_kg: 75, scr: 1.4
  });
  assert(prior_std.method === 'Matzke 1984', 'PriorSelector: standard → Matzke');
  console.log(`  📊 Standard: CL=${prior_std.CL}, Vd=${prior_std.Vd}, t1/2=${prior_std.t_half}h`);

  const prior_obese = getPopulationPrior({
    mode: 'obese', age: 55, sex: 'M', height_cm: 175, abw_kg: 140, scr: 1.0
  });
  assert(prior_obese.method === 'Crass 2018 (obese)', 'PriorSelector: obese → Crass 2018');

  const prior_neo = getPopulationPrior({
    mode: 'neonatal', pma_weeks: 34, abw_kg: 2.0, scr: 0.4
  });
  assert(prior_neo.method === 'Grimsley-Thomson 1999 (neonatal)', 'PriorSelector: neonatal → Grimsley-Thomson');

  const prior_crrt = getPopulationPrior({
    mode: 'CRRT', age: 60, sex: 'M', height_cm: 170, abw_kg: 80,
    scr: 3.0, crrt_effluent_ml_kg_h: 30
  });
  assert(prior_crrt.method === 'CRRT (effluent-based + residual)', 'PriorSelector: CRRT mode');


  // ═══════════════════════════════════════════════════════════════════════════
  // MODULE 4: MULTI-DOSE CONCENTRATION PREDICTION (SUPERPOSITION)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n══════════════════════════════════════════════');
  console.log('MODULE 4: MULTI-DOSE CONCENTRATION PREDICTION');
  console.log('══════════════════════════════════════════════');

  /**
   * Predict concentration at any time point using superposition principle
   * One-compartment IV infusion model with multiple doses
   *
   * During infusion (0 ≤ t_since_dose_start < tinf):
   *   C(t) = (R0 / (ke×Vd)) × (1 - e^(-ke×t))
   *
   * After infusion (t ≥ tinf):
   *   C(t) = (R0 / (ke×Vd)) × (1 - e^(-ke×tinf)) × e^(-ke×(t-tinf))
   *
   * Where R0 = dose/tinf (mg/h, zero-order infusion rate)
   *
   * @param {number} t_abs - Absolute time in hours from reference point (first dose start)
   * @param {Array} doses - [{dose_mg, tinf_h, start_h}]
   *   start_h is absolute time that infusion starts
   * @param {number} CL - Clearance in L/h
   * @param {number} Vd - Volume of distribution in L
   * @returns {number} Predicted concentration in mg/L
   */
  function predictConc(t_abs, doses, CL, Vd) {
    if (CL <= 0 || Vd <= 0) return 0;
    const ke = CL / Vd;
    let conc = 0;

    for (const d of doses) {
      const t_since_start = t_abs - d.start_h;

      // This dose hasn't started yet
      if (t_since_start <= 0) continue;

      const R0 = d.dose_mg / d.tinf_h;  // Infusion rate mg/h

      if (t_since_start < d.tinf_h) {
        // Still during infusion
        conc += (R0 / (ke * Vd)) * (1 - Math.exp(-ke * t_since_start));
      } else {
        // Post-infusion
        const t_post_inf = t_since_start - d.tinf_h;
        const Cend_inf = (R0 / (ke * Vd)) * (1 - Math.exp(-ke * d.tinf_h));
        conc += Cend_inf * Math.exp(-ke * t_post_inf);
      }
    }

    return conc;
  }

  // Tests: predictConc single dose
  console.log('\n--- predictConc Single Dose Tests ---');
  // Single dose: 1000mg over 1h, CL=2.5 L/h, Vd=50L, ke=0.05
  const sd_doses = [{ dose_mg: 1000, tinf_h: 1, start_h: 0 }];
  const sd_CL = 2.5, sd_Vd = 50, sd_ke = sd_CL / sd_Vd;

  // During infusion at t=0.5h
  const c_during = predictConc(0.5, sd_doses, sd_CL, sd_Vd);
  assert(c_during > 0 && c_during < 20, `During infusion t=0.5h: C=${c_during.toFixed(2)} mg/L`);

  // At end of infusion (t=1h)
  const c_eoi = predictConc(1.0, sd_doses, sd_CL, sd_Vd);
  const expected_eoi = (1000 / (sd_ke * sd_Vd)) * (1 - Math.exp(-sd_ke * 1));
  assertApprox(c_eoi, expected_eoi, 0.01, `End of infusion: C=${c_eoi.toFixed(2)} mg/L`);

  // Post-infusion decay at t=3h (2h after EOI)
  const c_post = predictConc(3.0, sd_doses, sd_CL, sd_Vd);
  const expected_post = c_eoi * Math.exp(-sd_ke * 2);
  assertApprox(c_post, expected_post, 0.01, `Post-infusion t=3h: C=${c_post.toFixed(2)} mg/L`);

  // Before dose starts: should be 0
  const c_before = predictConc(-0.5, sd_doses, sd_CL, sd_Vd);
  assertApprox(c_before, 0, 0.001, 'Before dose: C = 0');


  // Tests: predictConc multiple doses (superposition)
  console.log('\n--- predictConc Multi-Dose Superposition Tests ---');
  const md_doses = [
    { dose_mg: 1000, tinf_h: 1, start_h: 0 },
    { dose_mg: 1000, tinf_h: 1, start_h: 12 },
    { dose_mg: 1000, tinf_h: 1, start_h: 24 },
  ];

  // Pre-dose-2 trough at t=12h
  const c_trough_1 = predictConc(12.0, md_doses, sd_CL, sd_Vd);
  const c_trough_1_manual = c_eoi * Math.exp(-sd_ke * 11);  // 11h after EOI of dose 1
  assertApprox(c_trough_1, c_trough_1_manual, 0.01,
    `Trough before dose 2: C=${c_trough_1.toFixed(2)} mg/L`);

  // Accumulation check: peak after dose 3 should be > peak after dose 1
  const c_peak_1 = predictConc(2.0, md_doses, sd_CL, sd_Vd);
  const c_peak_3 = predictConc(26.0, md_doses, sd_CL, sd_Vd);
  assert(c_peak_3 > c_peak_1,
    `Accumulation: Peak 3 (${c_peak_3.toFixed(2)}) > Peak 1 (${c_peak_1.toFixed(2)})`);


  /**
   * Generate a full concentration-time curve for charting
   * @param {Array} doses
   * @param {number} CL
   * @param {number} Vd
   * @param {number} t_start - start time in hours
   * @param {number} t_end - end time in hours
   * @param {number} step - time step in hours (default 0.25 = 15min)
   * @returns {Array} [{t, conc}]
   */
  function generateConcCurve(doses, CL, Vd, t_start, t_end, step = 0.25) {
    const curve = [];
    for (let t = t_start; t <= t_end; t += step) {
      curve.push({
        t: Math.round(t * 1000) / 1000,
        conc: Math.round(predictConc(t, doses, CL, Vd) * 100) / 100
      });
    }
    return curve;
  }

  // Quick test of curve generation
  const test_curve = generateConcCurve(sd_doses, sd_CL, sd_Vd, 0, 12, 1);
  assert(test_curve.length === 13, `Curve generation: ${test_curve.length} points (expected 13)`);
  assert(test_curve[0].conc === 0, 'Curve: t=0 conc=0');
  assert(test_curve[1].conc > 0, `Curve: t=1h conc=${test_curve[1].conc} > 0`);


  // ═══════════════════════════════════════════════════════════════════════════
  // MODULE 5: BAYESIAN MAP ESTIMATION
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n══════════════════════════════════════════════');
  console.log('MODULE 5: BAYESIAN MAP ESTIMATION');
  console.log('══════════════════════════════════════════════');

  /**
   * Bayesian Maximum A Posteriori (MAP) estimation
   * Combines population prior with observed drug levels to individualize PK parameters
   *
   * Objective function:
   *   MAP = Prior_penalty + Data_likelihood
   *
   * Prior penalty (log-normal):
   *   (ln(CL) - ln(CL_pop))² / (2 × σ²_CL) + (ln(Vd) - ln(Vd_pop))² / (2 × σ²_Vd)
   *   where σ² = ln(1 + CV²)
   *
   * Data likelihood (proportional error model):
   *   Σ [(C_obs - C_pred) / (σ_res × C_pred)]²
   *
   * Optimization: L-BFGS-inspired gradient descent on log-transformed parameters
   *
   * @param {object} prior - {CL, Vd, CV_CL, CV_Vd}
   * @param {Array} doses - [{dose_mg, tinf_h, start_h}]
   * @param {Array} observed_levels - [{t_abs, conc}] (t_abs = hours from first dose start)
   * @param {object} options - {max_iter, sigma_res, learning_rate, convergence_threshold}
   * @returns {object} Bayesian posterior estimates
   */
  function bayesianMAP(prior, doses, observed_levels, options = {}) {
    const {
      max_iter = 2000,
      sigma_res = 0.15,       // 15% proportional residual error
      convergence_threshold = 1e-10,
    } = options;

    const { CL: CL_pop, Vd: Vd_pop, CV_CL = 0.30, CV_Vd = 0.20 } = prior;

    // Log-normal variance for priors
    const lnCL_var = Math.log(1 + CV_CL * CV_CL);
    const lnVd_var = Math.log(1 + CV_Vd * CV_Vd);

    // Objective function
    function objective(cl, vd) {
      if (cl <= 0 || vd <= 0) return 1e12;

      // Prior penalty (log-normal)
      const prior_pen =
        Math.pow(Math.log(cl) - Math.log(CL_pop), 2) / (2 * lnCL_var) +
        Math.pow(Math.log(vd) - Math.log(Vd_pop), 2) / (2 * lnVd_var);

      // Data likelihood (proportional error)
      let likelihood = 0;
      for (const obs of observed_levels) {
        const pred = predictConc(obs.t_abs, doses, cl, vd);
        if (pred <= 0.001) return 1e12;  // Avoid division by zero
        const residual = (obs.conc - pred) / (sigma_res * pred);
        likelihood += residual * residual;
      }

      return prior_pen + likelihood;
    }

    // Numerical gradient with central differences (more accurate)
    function gradient(cl, vd, h) {
      const gCL = (objective(cl + h, vd) - objective(cl - h, vd)) / (2 * h);
      const gVd = (objective(cl, vd + h) - objective(cl, vd - h)) / (2 * h);
      return [gCL, gVd];
    }

    // Work in log-space for better optimization behavior
    let logCL = Math.log(CL_pop);
    let logVd = Math.log(Vd_pop);

    // Adaptive learning rate optimization
    let lr = 0.01;
    let prev_obj = Infinity;
    let best_obj = Infinity;
    let best_CL = CL_pop;
    let best_Vd = Vd_pop;
    let converged = false;
    let final_iter = 0;

    for (let i = 0; i < max_iter; i++) {
      const cl = Math.exp(logCL);
      const vd = Math.exp(logVd);
      const cur_obj = objective(cl, vd);

      // Track best solution
      if (cur_obj < best_obj) {
        best_obj = cur_obj;
        best_CL = cl;
        best_Vd = vd;
      }

      // Check convergence
      if (Math.abs(cur_obj - prev_obj) < convergence_threshold && i > 10) {
        converged = true;
        final_iter = i;
        break;
      }

      // Compute gradient in log-space
      const h = 1e-6;
      const [gCL, gVd] = gradient(cl, vd, cl * h > 1e-6 ? cl * h : 1e-6);

      // Transform gradient to log-space: d(logx)/d(x) = 1/x
      const gLogCL = gCL * cl;
      const gLogVd = gVd * vd;

      // Gradient clipping for stability
      const grad_norm = Math.sqrt(gLogCL * gLogCL + gLogVd * gLogVd);
      const max_grad = 10;
      const clip = grad_norm > max_grad ? max_grad / grad_norm : 1;

      // Update with adaptive learning rate
      logCL -= lr *

```javascript
 clip * gLogCL;
      logVd -= lr * clip * gLogVd;

      // Adaptive learning rate: reduce if objective increased, increase if decreasing
      if (cur_obj > prev_obj) {
        lr *= 0.5;  // Backtrack
      } else if (cur_obj < prev_obj - 0.001) {
        lr = Math.min(lr * 1.05, 0.1);  // Cautiously increase
      }

      prev_obj = cur_obj;
      final_iter = i;
    }

    if (!converged) {
      // If didn't converge via threshold, use best found
      final_iter = max_iter;
    }

    const CL_post = best_CL;
    const Vd_post = best_Vd;
    const ke = CL_post / Vd_post;
    const t_half = 0.693 / ke;

    // Calculate residuals for goodness-of-fit
    const residuals = observed_levels.map(obs => {
      const pred = predictConc(obs.t_abs, doses, CL_post, Vd_post);
      return {
        t_abs: obs.t_abs,
        observed: obs.conc,
        predicted: Math.round(pred * 100) / 100,
        residual: Math.round((obs.conc - pred) * 100) / 100,
        pct_error: pred > 0 ? Math.round(Math.abs(obs.conc - pred) / pred * 10000) / 100 : null
      };
    });

    // Weighted residual sum of squares
    const wrss = observed_levels.reduce((sum, obs) => {
      const pred = predictConc(obs.t_abs, doses, CL_post, Vd_post);
      if (pred <= 0) return sum + 1e6;
      return sum + Math.pow((obs.conc - pred) / (sigma_res * pred), 2);
    }, 0);

    return {
      CL_post: Math.round(CL_post * 10000) / 10000,
      Vd_post: Math.round(Vd_post * 100) / 100,
      ke: Math.round(ke * 100000) / 100000,
      t_half: Math.round(t_half * 100) / 100,
      CL_prior: CL_pop,
      Vd_prior: Vd_pop,
      CL_change_pct: Math.round((CL_post - CL_pop) / CL_pop * 10000) / 100,
      Vd_change_pct: Math.round((Vd_post - Vd_pop) / Vd_pop * 10000) / 100,
      converged,
      iterations: final_iter,
      objective_value: Math.round(best_obj * 10000) / 10000,
      wrss: Math.round(wrss * 10000) / 10000,
      residuals,
      method: 'Bayesian MAP'
    };
  }

  // ── bayesianMAP tests ──
  console.log('\n--- Bayesian MAP Estimation Tests ---');

  // Test case 1: Single level — posterior should shift from prior toward data
  const bayes_prior_1 = { CL: 2.5, Vd: 50, CV_CL: 0.30, CV_Vd: 0.20 };
  const bayes_doses_1 = [
    { dose_mg: 1000, tinf_h: 1, start_h: 0 },
    { dose_mg: 1000, tinf_h: 1, start_h: 12 },
    { dose_mg: 1000, tinf_h: 1, start_h: 24 },
  ];
  const bayes_levels_1 = [
    { t_abs: 35, conc: 12.0 }  // Trough-ish level at 35h
  ];
  const bayes_result_1 = bayesianMAP(bayes_prior_1, bayes_doses_1, bayes_levels_1);
  assert(bayes_result_1.CL_post > 0, `Bayesian single-level: CL_post=${bayes_result_1.CL_post} L/h`);
  assert(bayes_result_1.Vd_post > 0, `Bayesian single-level: Vd_post=${bayes_result_1.Vd_post} L`);
  assert(bayes_result_1.t_half > 0, `Bayesian single-level: t1/2=${bayes_result_1.t_half} h`);
  console.log(`  📊 Single-level Bayesian: CL=${bayes_result_1.CL_post}, Vd=${bayes_result_1.Vd_post}, t1/2=${bayes_result_1.t_half}h`);

  // Test case 2: Two levels (peak+trough) — should be well-identified
  const bayes_levels_2 = [
    { t_abs: 25.5, conc: 28.0 },  // ~1.5h post-EOI of dose 3 (peak-like)
    { t_abs: 36.0, conc: 9.5 }    // pre-dose-4 trough
  ];
  const bayes_result_2 = bayesianMAP(bayes_prior_1, bayes_doses_1, bayes_levels_2);
  assert(bayes_result_2.residuals.length === 2, 'Bayesian two-level: 2 residuals');
  assert(bayes_result_2.residuals.every(r => r.pct_error < 20),
    `Bayesian two-level: all residuals <20% (${bayes_result_2.residuals.map(r => r.pct_error + '%').join(', ')})`);
  console.log(`  📊 Two-level Bayesian: CL=${bayes_result_2.CL_post}, Vd=${bayes_result_2.Vd_post}, t1/2=${bayes_result_2.t_half}h`);
  console.log(`     Residuals: ${JSON.stringify(bayes_result_2.residuals)}`);


  // ═══════════════════════════════════════════════════════════════════════════
  // MODULE 6: AUC CALCULATION (TRAPEZOIDAL)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n══════════════════════════════════════════════');
  console.log('MODULE 6: AUC CALCULATION');
  console.log('══════════════════════════════════════════════');

  /**
   * AUC24 using the analytical steady-state trapezoidal method
   *
   * For one dosing interval at steady state:
   *   AUC_inf  = (Cmax_ss × tinf) / 2   [triangular infusion approximation]
   *            ... but more accurately:
   *
   *   AUC_tau = AUC_infusion + AUC_post-infusion
   *
   *   AUC_infusion (trapezoidal from 0 to tinf):
   *     = (R0 / (ke×Vd)) × [tinf + (1/ke)(e^(-ke×tinf) - 1)] ... exact integral
   *     Simplified at SS: ≈ (Cmax_ss + C_time0_ss) × tinf / 2
   *     where C_time0_ss = Cmin_ss (pre-dose)
   *
   *   AUC_post (from tinf to tau):
   *     = (Cmax_ss - Cmin_ss) / ke
   *
   *   AUC_tau = (Cmax_ss + Cmin_ss) × tinf / 2  +  (Cmax_ss - Cmin_ss) / ke
   *   AUC_24  = AUC_tau × (24 / tau)
   *
   * @param {number} Cmax - Steady-state peak (end-of-infusion) in mg/L
   * @param {number} Cmin - Steady-state trough (pre-dose) in mg/L
   * @param {number} ke - Elimination rate constant (h⁻¹)
   * @param {number} tinf_h - Infusion duration in hours
   * @param {number} tau_h - Dosing interval in hours
   * @returns {object} { auc_tau, auc24, method }
   */
  function calcAUC24(Cmax, Cmin, ke, tinf_h, tau_h) {
    if (!Cmax || !ke || ke <= 0 || !tinf_h || !tau_h) return null;
    if (Cmax <= 0 || Cmin < 0 || tinf_h <= 0 || tau_h <= 0) return null;

    // Infusion phase AUC (trapezoidal: pre-dose Cmin → Cmax over tinf)
    const auc_infusion = ((Cmax + Cmin) * tinf_h) / 2;

    // Post-infusion decay phase AUC (Cmax → Cmin over tau-tinf hours)
    // Integral of Cmax × e^(-ke×t) from 0 to (tau-tinf):
    //   = Cmax/ke × (1 - e^(-ke×(tau-tinf)))
    //   = (Cmax - Cmin) / ke   [since Cmin = Cmax × e^(-ke×(tau-tinf))]
    const auc_elimination = (Cmax - Cmin) / ke;

    const auc_tau = auc_infusion + auc_elimination;
    const auc24 = auc_tau * (24 / tau_h);

    return {
      auc_infusion: Math.round(auc_infusion * 100) / 100,
      auc_elimination: Math.round(auc_elimination * 100) / 100,
      auc_tau: Math.round(auc_tau * 100) / 100,
      auc24: Math.round(auc24 * 100) / 100,
      intervals_per_day: 24 / tau_h,
      method: 'Trapezoidal (steady-state analytical)'
    };
  }

  /**
   * AUC24 from individualized PK parameters (after Bayesian estimation)
   * Predicts SS concentrations then computes AUC
   * More accurate when actual Bayesian CL/Vd are available
   *
   * Also provides: AUC24 = Daily Dose / CL (simplest pharmacokinetic truth)
   *
   * @param {number} dose_mg
   * @param {number} tinf_h
   * @param {number} tau_h
   * @param {number} CL - L/h (individualized)
   * @param {number} Vd - L (individualized)
   * @returns {object}
   */
  function calcAUC24fromPK(dose_mg, tinf_h, tau_h, CL, Vd) {
    if (!dose_mg || !CL || CL <= 0 || !Vd || Vd <= 0) return null;

    const ke = CL / Vd;
    const daily_dose = dose_mg * (24 / tau_h);

    // Method 1: AUC24 = TDD / CL (pharmacokinetic identity)
    const auc24_simple = daily_dose / CL;

    // Method 2: Trapezoidal via SS Cmax/Cmin
    const ss = calcSteadyState(dose_mg, tinf_h, tau_h, CL, Vd);
    const auc24_trap = calcAUC24(ss.Cmax, ss.Cmin, ke, tinf_h, tau_h);

    return {
      auc24_simple: Math.round(auc24_simple * 100) / 100,
      auc24_trapezoidal: auc24_trap ? auc24_trap.auc24 : null,
      auc24_concordance: auc24_trap
        ? Math.round(Math.abs(auc24_simple - auc24_trap.auc24) * 100) / 100
        : null,
      daily_dose,
      ke: Math.round(ke * 100000) / 100000,
      Cmax_ss: ss ? Math.round(ss.Cmax * 100) / 100 : null,
      Cmin_ss: ss ? Math.round(ss.Cmin * 100) / 100 : null,
      detail_trap: auc24_trap
    };
  }

  // Tests: calcAUC24
  console.log('\n--- AUC24 Calculation Tests ---');

  // Known scenario: Cmax=30, Cmin=10, ke=0.1, tinf=1h, tau=12h
  const auc_test_1 = calcAUC24(30, 10, 0.1, 1, 12);
  // AUC_infusion = (30+10)*1/2 = 20
  // AUC_elimination = (30-10)/0.1 = 200
  // AUC_tau = 220
  // AUC24 = 220 * (24/12) = 440
  assertApprox(auc_test_1.auc_infusion, 20.0, 0.01, 'AUC: infusion phase = 20');
  assertApprox(auc_test_1.auc_elimination, 200.0, 0.01, 'AUC: elimination phase = 200');
  assertApprox(auc_test_1.auc_tau, 220.0, 0.01, 'AUC: per interval = 220');
  assertApprox(auc_test_1.auc24, 440.0, 0.01, 'AUC24 = 440 mg·h/L');

  // Edge: q8h dosing
  const auc_test_q8 = calcAUC24(25, 8, 0.08, 1, 8);
  assert(auc_test_q8.intervals_per_day === 3, 'AUC q8h: 3 intervals/day');
  assertApprox(auc_test_q8.auc24, auc_test_q8.auc_tau * 3, 0.01, 'AUC24 = AUC_tau × 3 for q8h');

  // Null safety
  assert(calcAUC24(0, 10, 0.1, 1, 12) === null, 'AUC: Cmax=0 returns null');
  assert(calcAUC24(30, 10, 0, 1, 12) === null, 'AUC: ke=0 returns null');


  // ═══════════════════════════════════════════════════════════════════════════
  // MODULE 7: STEADY STATE PREDICTIONS
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n══════════════════════════════════════════════');
  console.log('MODULE 7: STEADY STATE PREDICTIONS');
  console.log('══════════════════════════════════════════════');

  /**
   * Steady-state Cmax and Cmin for intermittent IV infusion
   *
   * Cmax_ss = (dose / (tinf × ke × Vd)) × (1 - e^(-ke×tinf)) / (1 - e^(-ke×tau))
   *   [this is the TRUE peak = end-of-infusion concentration at steady state]
   *
   * Cmin_ss = Cmax_ss × e^(-ke×(tau - tinf))
   *   [this is the pre-dose trough]
   *
   * @param {number} dose_mg
   * @param {number} tinf_h - infusion duration (hours)
   * @param {number} tau_h - dosing interval (hours)
   * @param {number} CL - clearance (L/h)
   * @param {number} Vd - volume of distribution (L)
   * @returns {object} { Cmax, Cmin, ke, t_half }
   */
  function calcSteadyState(dose_mg, tinf_h, tau_h, CL, Vd) {
    if (!dose_mg || !tinf_h || !tau_h || !CL || !Vd) return null;
    if (dose_mg <= 0 || tinf_h <= 0 || tau_h <= 0 || CL <= 0 || Vd <= 0) return null;

    const ke = CL / Vd;
    const R0 = dose_mg / tinf_h;

    // Accumulation factor denominator
    const accum_denom = 1 - Math.exp(-ke * tau_h);
    if (accum_denom === 0) return null;

    // End-of-infusion at steady state
    const Cmax = (R0 / (ke * Vd)) * (1 - Math.exp(-ke * tinf_h)) / accum_denom;

    // Pre-dose trough at steady state
    const Cmin = Cmax * Math.exp(-ke * (tau_h - tinf_h));

    return {
      Cmax: Math.round(Cmax * 100) / 100,
      Cmin: Math.round(Cmin * 100) / 100,
      ke: Math.round(ke * 100000) / 100000,
      t_half: Math.round((0.693 / ke) * 100) / 100,
      accumulation_factor: Math.round((1 / accum_denom) * 100) / 100
    };
  }

  // Tests: calcSteadyState
  console.log('\n--- Steady State Prediction Tests ---');

  // Test: 1000mg q12h over 1h, CL=2.5, Vd=50
  const ss_test_1 = calcSteadyState(1000, 1, 12, 2.5, 50);
  const ke_ss_1 = 2.5 / 50;  // 0.05
  const Cmax_manual = (1000 / (1 * ke_ss_1 * 50)) * (1 - Math.exp(-ke_ss_1 * 1)) / (1 - Math.exp(-ke_ss_1 * 12));
  const Cmin_manual = Cmax_manual * Math.exp(-ke_ss_1 * 11);
  assertApprox(ss_test_1.Cmax, Cmax_manual, 0.1, `SS: Cmax=${ss_test_1.Cmax} mg/L (manual: ${Cmax_manual.toFixed(2)})`);
  assertApprox(ss_test_1.Cmin, Cmin_manual, 0.1, `SS: Cmin=${ss_test_1.Cmin} mg/L (manual: ${Cmin_manual.toFixed(2)})`);
  assert(ss_test_1.Cmax > ss_test_1.Cmin, 'SS: Cmax > Cmin');

  // Verify Cmin is pre-dose (should be what we'd see right before next dose)
  // At SS, superposition at t=tau should converge to near Cmin_ss
  // We can verify by running predictConc for many doses
  const many_doses = [];
  for (let i = 0; i < 20; i++) {
    many_doses.push({ dose_mg: 1000, tinf_h: 1, start_h: i * 12 });
  }
  const c_at_ss_trough = predictConc(20 * 12, many_doses, 2.5, 50);  // just before dose 21
  assertApprox(c_at_ss_trough, ss_test_1.Cmin, 0.5,
    `SS convergence: superposition Cmin=${c_at_ss_trough.toFixed(2)} ≈ analytical ${ss_test_1.Cmin}`);

  const c_at_ss_peak = predictConc(19 * 12 + 1, many_doses, 2.5, 50);  // end of infusion dose 20
  assertApprox(c_at_ss_peak, ss_test_1.Cmax, 0.5,
    `SS convergence: superposition Cmax=${c_at_ss_peak.toFixed(2)} ≈ analytical ${ss_test_1.Cmax}`);

  // Concordance test: AUC24_simple vs AUC24_trapezoidal
  const auc_concordance = calcAUC24fromPK(1000, 1, 12, 2.5, 50);
  assertApprox(auc_concordance.auc24_concordance, 0, 5,
    `AUC concordance: TDD/CL vs trap differ by ${auc_concordance.auc24_concordance} mg·h/L`);
  console.log(`  📊 AUC24 simple=${auc_concordance.auc24_simple}, trap=${auc_concordance.auc24_trapezoidal}`);

  // Null safety
  assert(calcSteadyState(0, 1, 12, 2.5, 50) === null, 'SS: dose=0 returns null');
  assert(calcSteadyState(1000, 1, 12, 0, 50) === null, 'SS: CL=0 returns null');


  // ═══════════════════════════════════════════════════════════════════════════
  // MODULE 8: DOSE RECOMMENDATION ENGINE
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n══════════════════════════════════════════════');
  console.log('MODULE 8: DOSE RECOMMENDATION ENGINE');
  console.log('══════════════════════════════════════════════');

  /**
   * Recommend a vancomycin dose to achieve a target AUC24
   *
   * Strategy:
   * 1. Calculate total daily dose (TDD) = target_AUC × CL
   * 2. Select dosing interval (tau) based on half-life:
   *      t1/2 ≤ 6h  → q8h
   *      t1/2 ≤ 12h → q12h
   *      t1/2 ≤ 18h → q24h
   *      t1/2 ≤ 36h → q36h
   *      t1/2 > 36h → q48h
   * 3. Per-dose = TDD × (tau/24), rounded to nearest 250mg
   * 4. Validate Cmax (<60 mg/L) and Cmin (<20 mg/L for nephrotoxicity)
   * 5. Adjust infusion time: >1500mg → 2h; >2000mg → 2h minimum
   * 6. Hard cap: single dose ≤ 3000mg
   *
   * @param {number} CL - Clearance in L/h
   * @param {number} Vd - Volume of distribution in L
   * @param {object} options - { target_auc, auc_range, max_single_dose }
   * @returns {object} Recommended regimen
   */
  function recommendDose(CL, Vd, options = {}) {
    const {
      target_auc = 500,           // Target AUC24 midpoint (mg·h/L)
      auc_range = [400, 600],      // Therapeutic AUC24 range
      max_single_dose = 3000,      // Max single dose (mg)
      min_dose = 250,              // Minimum dose (mg)
      rounding = 250               // Round to nearest (mg)
    } = options;

    if (!CL || !Vd || CL <= 0 || Vd <= 0) return null;

    const ke = CL / Vd;
    const t_half = 0.693 / ke;

    // Total daily dose for target AUC
    const tdd_target = target_auc * CL;

    // Select interval based on half-life
    let tau;
    if (t_half <= 6) tau = 8;
    else if (t_half <= 12) tau = 12;
    else if (t_half <= 18) tau = 24;
    else if (t_half <= 36) tau = 36;
    else tau = 48;

    // Per-dose = TDD × (tau/24), rounded to nearest 250mg
    let dose = Math.round((tdd_target * (tau / 24)) / rounding) * rounding;

    // Enforce limits
    dose = Math.max(min_dose, Math.min(dose, max_single_dose));

    // Infusion time rules
    let tinf;
    if (dose > 2000) tinf = 2.5;
    else if (dose > 1500) tinf = 2;
    else if (dose > 1000) tinf = 1.5;
    else tinf = 1;

    // Check max infusion rate: ≤ 10 mg/min (≤ 600 mg/h)
    const rate_mg_h = dose / tinf;
    if (rate_mg_h > 600) {
      tinf = Math.ceil((dose / 600) * 2) / 2;  // Round up to nearest 0.5h
    }

    // Predict SS concentrations with this regimen
    const ss = calcSteadyState(dose, tinf, tau, CL, Vd);
    const actual_daily_dose = dose * (24 / tau);
    const actual_auc24 = actual_daily_dose / CL;

    // Safety checks
    const warnings = [];
    const contraindications = [];

    if (ss && ss.Cmax > 60) {
      contraindications.push(`Predicted Cmax ${ss.Cmax} mg/L exceeds 60 mg/L safety limit`);
    }
    if (ss && ss.Cmax > 50) {
      warnings.push(`Predicted Cmax ${ss.Cmax} mg/L is elevated (>50). Consider longer infusion or split dosing.`);
    }
    if (ss && ss.Cmin > 20) {
      warnings.push(`Predicted Cmin ${ss.Cmin} mg/L exceeds 20 mg/L (nephrotoxicity risk). Consider dose reduction or interval extension.`);
    }
    if (actual_auc24 > 600) {
      warnings.push(`Predicted AUC24 ${Math.round(actual_auc24)} mg·h/L exceeds 600. Consider lower target.`);
    }
    if (actual_auc24 < 400) {
      warnings.push(`Predicted AUC24 ${Math.round(actual_auc24)} mg·h/L below 400. May be subtherapeutic.`);
    }
    if (actual_daily_dose > 4000) {
      warnings.push(`Daily dose ${actual_daily_dose} mg exceeds typical 4g/day maximum.`);
    }
    if (dose > 2000) {
      warnings.push(`Single dose ${dose} mg is high. Ensure adequate infusion time to prevent Red Man Syndrome.`);
    }

    // AUC classification
    let auc_classification;
    if (actual_auc24 < auc_range[0]) auc_classification = 'SUBTHERAPEUTIC';
    else if (actual_auc24 > auc_range[1]) auc_classification = 'SUPRATHERAPEUTIC';
    else auc_classification = 'THERAPEUTIC';

    // Determine monitoring recommendation
    let next_monitoring;
    if (auc_classification === 'THERAPEUTIC') {
      next_monitoring = 'Repeat levels in 3-5 days or with SCr change ≥0.3 mg/dL. [A-II]';
    } else if (auc_classification === 'SUBTHERAPEUTIC') {
      next_monitoring = 'Obtain trough (± peak) 24-48h after new regimen starts. [A-II]';
    } else {
      next_monitoring = 'Obtain trough 24h after dose reduction. Monitor SCr daily. [A-II]';
    }

    // Alternative tau check: if current tau produces AUC out of range,
    // try adjacent intervals and pick the best
    let alternatives = [];
    const tau_options = [8, 12, 24, 36, 48];
    for (const alt_tau of tau_options) {
      if (alt_tau === tau) continue;
      const alt_dose = Math.round((tdd_target * (alt_tau / 24)) / rounding) * rounding;
      const capped_dose = Math.max(min_dose, Math.min(alt_dose, max_single_dose));
      const alt_tdd = capped_dose * (24 / alt_tau);
      const alt_auc = alt_tdd / CL;
      const alt_ss = calcSteadyState(capped_dose, capped_dose > 1500 ? 2 : 1, alt_tau, CL, Vd);
      if (alt_auc >= auc_range[0] && alt_auc <= auc_range[1] && alt_ss && alt_ss.Cmax <= 60) {
        alternatives.push({
          dose_mg: capped_dose,
          tau_h: alt_tau,
          auc24: Math.round(alt_auc * 10) / 10,
          Cmax: alt_ss.Cmax,
          Cmin: alt_ss.Cmin
        });
      }
    }

    return {
      dose_mg: dose,
      tau_h: tau,
      tinf_h: tinf,
      daily_dose_mg: actual_daily_dose,
      auc24_predicted: Math.round(actual_auc24 * 10) / 10,
      auc_classification,
      Cmax_predicted: ss ? ss.Cmax : null,
      Cmin_predicted: ss ? ss.Cmin : null,
      ke,
      t_half: Math.round(t_half * 100) / 100,
      tdd_target: Math.round(tdd_target),
      infusion_rate_mg_h: Math.round(rate_mg_h),
      infusion_rate_mg_min: Math.round(rate_mg_h / 60 * 10) / 10,
      warnings,
      contraindications,
      next_monitoring,
      

```javascript
// ═══════════════════════════════════════════════════════════════════════════════
// AINADARA CALC — Phase 1 Engine CONTINUATION
// Picks up exactly after: next_monitoring,
// ═══════════════════════════════════════════════════════════════════════════════

      alternatives,
      evidence_grade: 'A-II',
      rationale: `Target AUC24 ${target_auc} mg·h/L → TDD ${Math.round(tdd_target)} mg/day. ` +
        `t½ ${t_half.toFixed(1)}h → q${tau}h interval. ` +
        `${dose}mg q${tau}h over ${tinf}h = ${actual_daily_dose} mg/day → AUC24 ~${Math.round(actual_auc24)} mg·h/L.`
    };
  }

  // Tests: recommendDose
  console.log('\n--- Dose Recommendation Tests ---');

  // Short half-life patient (high clearance) → expect q8h
  const rec_fast = recommendDose(6.0, 50);  // ke=0.12, t1/2=5.8h
  assert(rec_fast.tau_h === 8, `Rec fast: t1/2=${rec_fast.t_half}h → q${rec_fast.tau_h}h`);
  assert(rec_fast.dose_mg >= 250 && rec_fast.dose_mg <= 3000,
    `Rec fast: dose=${rec_fast.dose_mg}mg within limits`);
  assertRange(rec_fast.auc24_predicted, 350, 650,
    `Rec fast: AUC24=${rec_fast.auc24_predicted} near target range`);
  console.log(`  📊 Fast CL: ${rec_fast.dose_mg}mg q${rec_fast.tau_h}h, AUC24=${rec_fast.auc24_predicted}`);

  // Normal half-life → expect q12h
  const rec_norm = recommendDose(2.5, 50);  // ke=0.05, t1/2=13.9h → q24h per rules (≤18h → q24h... actually t1/2≤12→q12)
  // t1/2 = 0.693/0.05 = 13.86 → between 12 and 18 → q24h
  assert(rec_norm.tau_h === 24,
    `Rec normal: t1/2=${rec_norm.t_half}h → q${rec_norm.tau_h}h`);
  console.log(`  📊 Normal CL: ${rec_norm.dose_mg}mg q${rec_norm.tau_h}h, AUC24=${rec_norm.auc24_predicted}`);

  // Long half-life (renal impairment) → expect q24h or longer
  const rec_slow = recommendDose(0.8, 45);  // ke=0.0178, t1/2=39h → q48h
  assert(rec_slow.tau_h === 48,
    `Rec slow: t1/2=${rec_slow.t_half}h → q${rec_slow.tau_h}h`);
  console.log(`  📊 Slow CL: ${rec_slow.dose_mg}mg q${rec_slow.tau_h}h, AUC24=${rec_slow.auc24_predicted}`);

  // Infusion rate safety: large dose should have extended infusion
  const rec_big = recommendDose(5.0, 40);  // high CL, will want large dose
  if (rec_big.dose_mg > 1500) {
    assert(rec_big.tinf_h >= 2,
      `Rec big dose: ${rec_big.dose_mg}mg → infusion ${rec_big.tinf_h}h (≥2h for >1500mg)`);
  }
  assert(rec_big.infusion_rate_mg_min <= 10,
    `Rec big dose: rate=${rec_big.infusion_rate_mg_min} mg/min ≤ 10 mg/min (RMS prevention)`);

  // Dose capping at 3000mg
  const rec_extreme = recommendDose(10, 30);  // very high CL
  assert(rec_extreme.dose_mg <= 3000,
    `Rec extreme: dose=${rec_extreme.dose_mg}mg ≤ 3000mg cap`);

  // Null safety
  assert(recommendDose(0, 50) === null, 'Rec: CL=0 returns null');
  assert(recommendDose(2.5, 0) === null, 'Rec: Vd=0 returns null');

  // Verify evidence grade present
  assert(rec_norm.evidence_grade === 'A-II', 'Rec: evidence grade A-II tagged');
  assert(rec_norm.rationale.length > 20, 'Rec: rationale string populated');
  assert(rec_norm.next_monitoring.length > 10, 'Rec: monitoring recommendation populated');


  // ═══════════════════════════════════════════════════════════════════════════
  // MODULE 9: KDIGO AKI DETECTION
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n══════════════════════════════════════════════');
  console.log('MODULE 9: KDIGO AKI DETECTION');
  console.log('══════════════════════════════════════════════');

  /**
   * KDIGO 2012 Acute Kidney Injury staging
   *
   * Stage 1:
   *   - SCr increase ≥ 0.3 mg/dL within 48 hours, OR
   *   - SCr increase ≥ 1.5× baseline within 7 days
   *
   * Stage 2:
   *   - SCr increase ≥ 2.0× baseline within 7 days
   *
   * Stage 3:
   *   - SCr increase ≥ 3.0× baseline within 7 days, OR
   *   - SCr ≥ 4.0 mg/dL with acute rise ≥ 0.5 mg/dL, OR
   *   - Initiation of RRT
   *
   * Note: Urine output criteria not implemented (not typically
   *       available in pharmacokinetic monitoring context)
   *
   * @param {number} scr_now       - Current SCr (mg/dL)
   * @param {number|null} scr_48h  - SCr from 48 hours prior (for absolute change)
   * @param {number|null} scr_baseline - Lowest SCr in past 7 days (or admission baseline)
   * @param {object} options - { on_rrt, scr_prior_to_rrt }
   * @returns {object} AKI staging result
   */
  function detectAKI(scr_now, scr_48h, scr_baseline, options = {}) {
    const { on_rrt = false, scr_prior_to_rrt = null } = options;

    const result = {
      stage: 0,
      criteria_met: [],
      scr_current: scr_now,
      scr_48h_prior: scr_48h,
      scr_baseline: scr_baseline,
      scr_change_48h: scr_48h != null ? Math.round((scr_now - scr_48h) * 100) / 100 : null,
      scr_ratio_7d: scr_baseline && scr_baseline > 0
        ? Math.round((scr_now / scr_baseline) * 100) / 100
        : null,
      action: '',
      alert_level: 'INFO',
      monitoring: '',
      vanc_action: ''
    };

    if (!scr_now || scr_now <= 0) {
      result.action = 'Invalid SCr value';
      return result;
    }

    // ── Stage 3 checks (most severe first) ──

    // RRT initiation
    if (on_rrt) {
      result.stage = 3;
      result.criteria_met.push('Initiation of renal replacement therapy');
    }

    // SCr ≥ 4.0 with acute rise ≥ 0.5
    if (scr_now >= 4.0 && scr_48h != null && (scr_now - scr_48h) >= 0.5) {
      result.stage = 3;
      result.criteria_met.push(
        `SCr ${scr_now} ≥ 4.0 mg/dL with acute rise ≥ 0.5 mg/dL ` +
        `(+${(scr_now - scr_48h).toFixed(2)} in 48h)`
      );
    }

    // SCr ≥ 3.0× baseline
    if (scr_baseline && scr_baseline > 0 && scr_now / scr_baseline >= 3.0) {
      result.stage = 3;
      result.criteria_met.push(
        `SCr ${scr_now} ≥ 3.0× baseline ${scr_baseline} ` +
        `(ratio: ${(scr_now / scr_baseline).toFixed(2)})`
      );
    }

    // ── Stage 2 check ──
    if (result.stage < 2 && scr_baseline && scr_baseline > 0 && scr_now / scr_baseline >= 2.0) {
      result.stage = 2;
      result.criteria_met.push(
        `SCr ${scr_now} ≥ 2.0× baseline ${scr_baseline} ` +
        `(ratio: ${(scr_now / scr_baseline).toFixed(2)})`
      );
    }

    // ── Stage 1 checks ──
    // Absolute rise ≥ 0.3 in 48h
    if (result.stage < 1 && scr_48h != null && (scr_now - scr_48h) >= 0.3) {
      result.stage = 1;
      result.criteria_met.push(
        `SCr rise ≥ 0.3 mg/dL in 48h (+${(scr_now - scr_48h).toFixed(2)} mg/dL)`
      );
    }

    // Ratio ≥ 1.5× baseline within 7d
    if (result.stage < 1 && scr_baseline && scr_baseline > 0 && scr_now / scr_baseline >= 1.5) {
      result.stage = 1;
      result.criteria_met.push(
        `SCr ${scr_now} ≥ 1.5× baseline ${scr_baseline} ` +
        `(ratio: ${(scr_now / scr_baseline).toFixed(2)})`
      );
    }

    // ── Generate clinical action guidance ──
    switch (result.stage) {
      case 0:
        result.action = 'No AKI detected. Continue current regimen.';
        result.alert_level = 'INFO';
        result.monitoring = 'Routine SCr monitoring per protocol.';
        result.vanc_action = 'No change required.';
        break;

      case 1:
        result.action = 'KDIGO AKI Stage 1 detected. Enhanced monitoring required.';
        result.alert_level = 'WARN';
        result.monitoring = 'SCr every 24h. Repeat vancomycin levels within 24-48h.';
        result.vanc_action =
          'Evaluate nephrotoxin burden. If AUC >600, reduce dose. ' +
          'Consider holding if SCr continues to rise. ' +
          'Assess volume status and concurrent nephrotoxins.';
        break;

      case 2:
        result.action = 'KDIGO AKI Stage 2 detected. HOLD vancomycin evaluation recommended.';
        result.alert_level = 'DANGER';
        result.monitoring = 'SCr every 12-24h. Nephrology consult if not already involved.';
        result.vanc_action =
          'STRONGLY consider holding vancomycin. ' +
          'Evaluate alternative agents (see Alternatives module). ' +
          'If vancomycin essential: extend interval, recheck level before redosing, target lower AUC 400-450.';
        break;

      case 3:
        result.action = 'KDIGO AKI Stage 3 detected. HOLD vancomycin. Nephrology consult STAT.';
        result.alert_level = 'DANGER';
        result.monitoring = 'Continuous renal monitoring. Consider RRT initiation if not started.';
        result.vanc_action =
          'HOLD vancomycin until renal function assessed. ' +
          'If infection life-threatening: switch to alternative (linezolid preferred — no renal adjustment). ' +
          'If vancomycin absolutely required: dose for HD/CRRT mode. Repeat level before each dose.';
        break;
    }

    return result;
  }

  // Tests: detectAKI
  console.log('\n--- KDIGO AKI Detection Tests ---');

  // No AKI: stable creatinine
  const aki_none = detectAKI(1.0, 0.9, 0.8);
  assert(aki_none.stage === 0, 'AKI: SCr 1.0, 48h=0.9, base=0.8 → Stage 0');
  assert(aki_none.alert_level === 'INFO', 'AKI Stage 0: alert level INFO');

  // Stage 1: absolute rise ≥ 0.3 in 48h
  const aki_s1_abs = detectAKI(1.5, 1.1, 1.0);
  assert(aki_s1_abs.stage === 1, 'AKI: SCr 1.5, 48h=1.1 (+0.4) → Stage 1');
  assert(aki_s1_abs.criteria_met.some(c => c.includes('0.3 mg/dL in 48h')),
    'AKI Stage 1: criteria mentions 0.3 mg/dL in 48h');
  assertApprox(aki_s1_abs.scr_change_48h, 0.4, 0.01, 'AKI: SCr change = +0.4');

  // Stage 1: ratio ≥ 1.5× baseline
  const aki_s1_ratio = detectAKI(1.6, 1.5, 1.0);
  // 48h change = 0.1 (< 0.3), but ratio = 1.6 (≥ 1.5)
  assert(aki_s1_ratio.stage === 1, 'AKI: SCr 1.6, base=1.0 (ratio 1.6) → Stage 1');
  assert(aki_s1_ratio.criteria_met.some(c => c.includes('1.5×')),
    'AKI Stage 1: criteria mentions 1.5× baseline');

  // Stage 2: ratio ≥ 2.0× baseline
  const aki_s2 = detectAKI(2.2, 2.0, 1.0);
  assert(aki_s2.stage === 2, 'AKI: SCr 2.2, base=1.0 (ratio 2.2) → Stage 2');
  assert(aki_s2.alert_level === 'DANGER', 'AKI Stage 2: alert level DANGER');
  assert(aki_s2.vanc_action.includes('holding'), 'AKI Stage 2: recommends holding vancomycin');

  // Stage 3: ratio ≥ 3.0× baseline
  const aki_s3_ratio = detectAKI(3.3, 3.0, 1.0);
  assert(aki_s3_ratio.stage === 3, 'AKI: SCr 3.3, base=1.0 (ratio 3.3) → Stage 3');

  // Stage 3: SCr ≥ 4.0 with acute rise
  const aki_s3_abs = detectAKI(4.5, 3.8, 2.0);
  assert(aki_s3_abs.stage === 3, 'AKI: SCr 4.5, 48h=3.8 (≥4.0 + rise ≥0.5) → Stage 3');
  assert(aki_s3_abs.criteria_met.some(c => c.includes('4.0')),
    'AKI Stage 3: criteria mentions SCr ≥ 4.0');

  // Stage 3: RRT initiation
  const aki_rrt = detectAKI(5.0, 4.0, 1.5, { on_rrt: true });
  assert(aki_rrt.stage === 3, 'AKI: on RRT → Stage 3');
  assert(aki_rrt.criteria_met.some(c => c.includes('renal replacement')),
    'AKI Stage 3: RRT criterion');

  // Edge: only 48h data available, no baseline
  const aki_no_base = detectAKI(1.8, 1.4, null);
  assert(aki_no_base.stage === 1, 'AKI: SCr 1.8, 48h=1.4 (+0.4), no baseline → Stage 1');
  assert(aki_no_base.scr_ratio_7d === null, 'AKI: no baseline → ratio is null');

  // Edge: only baseline, no 48h
  const aki_no_48h = detectAKI(2.5, null, 1.0);
  assert(aki_no_48h.stage === 2, 'AKI: SCr 2.5, no 48h, base=1.0 (ratio 2.5) → Stage 2');

  // Edge: borderline values
  const aki_border = detectAKI(1.29, 1.0, 1.0);
  // 48h rise = 0.29 (<0.3), ratio = 1.29 (<1.5)
  assert(aki_border.stage === 0, 'AKI: borderline SCr 1.29, 48h=1.0, base=1.0 → Stage 0');

  // Invalid
  const aki_invalid = detectAKI(0, 1.0, 1.0);
  assert(aki_invalid.stage === 0, 'AKI: invalid SCr=0 → Stage 0');

  console.log(`  📊 AKI detection: ${8} scenarios tested across all stages`);


  // ═══════════════════════════════════════════════════════════════════════════
  // MODULE 10: CONTINUOUS INFUSION (CI) RATE CALCULATOR
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n══════════════════════════════════════════════');
  console.log('MODULE 10: CONTINUOUS INFUSION CALCULATOR');
  console.log('══════════════════════════════════════════════');

  /**
   * Continuous Infusion vancomycin dosing
   *
   * At steady state for CI:
   *   Css = R0 / CL
   *   R0 = Css_target × CL
   *
   * AUC24 for CI = Css × 24
   *
   * Loading dose: Css_target × Vd (to achieve immediate target)
   *
   * Target Css: 20-25 mg/L (European guidelines favor CI with Css 20-25)
   * AUC24 at Css 20-25 = 480-600 mg·h/L (aligns with AUC target)
   *
   * @param {number} CL - L/h
   * @param {number} Vd - L
   * @param {object} options
   * @returns {object}
   */
  function calcCIRegimen(CL, Vd, options = {}) {
    const {
      target_css = 22,          // mg/L target Css
      css_range = [20, 25],     // Acceptable range
      max_daily_mg = 6000,      // Safety cap
      concentration_mg_ml = 5,  // Standard CI concentration 5 mg/mL
    } = options;

    if (!CL || !Vd || CL <= 0 || Vd <= 0) return null;

    // Infusion rate to achieve target Css
    const rate_mg_h = target_css * CL;                 // mg/h
    const daily_dose = rate_mg_h * 24;                 // mg/day
    const rate_ml_h = rate_mg_h / concentration_mg_ml; // mL/h

    // Loading dose
    const loading_dose = target_css * Vd;              // mg
    const loading_rounded = Math.round(loading_dose / 250) * 250;

    // AUC24 at steady state CI = Css × 24
    const auc24 = target_css * 24;

    // Time to 90% of steady state without loading = 3.32 × t½
    const ke = CL / Vd;
    const t_half = 0.693 / ke;
    const time_to_90pct = 3.32 * t_half;
    const time_to_95pct = 4.32 * t_half;

    // Safety checks
    const warnings = [];
    if (daily_dose > max_daily_mg) {
      warnings.push(`Daily dose ${Math.round(daily_dose)} mg exceeds ${max_daily_mg} mg/day safety cap.`);
    }
    if (loading_rounded > 3000) {
      warnings.push(`Loading dose ${loading_rounded} mg is high. Infuse over ≥${Math.ceil(loading_rounded / 600)}h.`);
    }

    // Css range check
    const css_low = css_range[0] * CL * 24;   // AUC at low Css
    const css_high = css_range[1] * CL * 24;  // AUC at high Css

    return {
      target_css,
      rate_mg_h: Math.round(rate_mg_h * 10) / 10,
      rate_ml_h: Math.round(rate_ml_h * 10) / 10,
      daily_dose_mg: Math.round(daily_dose),
      loading_dose_mg: loading_rounded,
      loading_infusion_h: Math.max(1, Math.ceil(loading_rounded / 600 * 2) / 2),
      auc24: Math.round(auc24),
      concentration_mg_ml,
      time_to_90pct_h: Math.round(time_to_90pct * 10) / 10,
      time_to_95pct_h: Math.round(time_to_95pct * 10) / 10,
      css_range_auc: [Math.round(css_low), Math.round(css_high)],
      ke: Math.round(ke * 100000) / 100


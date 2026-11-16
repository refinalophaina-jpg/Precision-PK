'use strict';
// ════════════════════════════════════════════════════════════════════════
// Shared constant extractor for the validation harness.  (audit finding P3)
//
// THE PROBLEM THIS SOLVES
// The three validation suites run the shipped engine inside a Node `vm`, which
// is right — they test index.html rather than a copy. But `const` and `let`
// declared inside a vm context are NOT exposed as sandbox properties, so each
// suite used to re-declare the model constants by hand:
//
//     const OMEGA2_CL_BUELGA = 0.122;   // <- a copy, in three files
//
// Change the constant in index.html and every suite keeps testing the old
// value, green, forever. That is exactly what happened: the Buelga prior was
// replaced with the verified published model and all three suites would have
// carried on asserting against the retired numbers.
//
// THE FIX
// Parse the literals straight out of the source text and throw if one is
// missing. A renamed or deleted constant now fails loudly instead of silently
// testing a ghost.
// ════════════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');

const APP_PATH = path.join(__dirname, 'index.html');

function readAppSource() {
  return fs.readFileSync(APP_PATH, 'utf8');
}

// Pull `const NAME = <number>;` out of the source. Throws if absent.
// Anchored to the start of a line and case-sensitive (review 2026-11-13): an
// unanchored, case-insensitive match could read a commented-out or indented
// copy, or a differently-cased name, instead of the live top-level declaration.
function num(src, name) {
  const m = src.match(new RegExp('^const\\s+' + name + '\\s*=\\s*(-?[0-9.]+(?:e-?[0-9]+)?)\\s*;', 'm'));
  if (!m) {
    throw new Error(
      `harness_constants: could not find \`const ${name} = <number>\` in index.html.\n` +
      `  The constant was renamed, removed, or changed shape.\n` +
      `  Fix the harness to match the app — do NOT hardcode the old value back.`
    );
  }
  return parseFloat(m[1]);
}

// Pull NAME out of a multi-name declaration, e.g. `const CRCL_MODEL_FLOOR = 5, CRCL_MODEL_CAP = 150;`.
function numInDecl(src, name) {
  const m = src.match(new RegExp('const\\s+[^;=]*=[^;]*?,\\s*' + name + '\\s*=\\s*(-?[0-9.]+)\\s*[,;]'))
         || src.match(new RegExp('const\\s+' + name + '\\s*=\\s*(-?[0-9.]+)\\s*[,;]'));
  if (!m) throw new Error(`harness_constants: could not find \`${name} = <number>\` in a const declaration in index.html.`);
  return parseFloat(m[1]);
}

// Pull one field out of an object literal, e.g. IBW_TARGET_BMI = { M: 22.0, F: 21.5 }
function objField(src, objName, field) {
  const obj = src.match(new RegExp('const\\s+' + objName + '\\s*=\\s*\\{([^}]*)\\}'));
  if (!obj) throw new Error(`harness_constants: could not find \`const ${objName} = { ... }\` in index.html.`);
  const m = obj[1].match(new RegExp('\\b' + field + '\\s*:\\s*(-?[0-9.]+)'));
  if (!m) throw new Error(`harness_constants: \`${objName}\` has no numeric field \`${field}\`.`);
  return parseFloat(m[1]);
}

function extract() {
  const src = readAppSource();
  return {
    // Goti 2018 — verified against Ther Drug Monit 2018 Table 2 + Methods
    Q_GOTI:            num(src, 'Q_GOTI'),
    OMEGA2_CL_GOTI:    num(src, 'OMEGA2_CL_GOTI'),
    OMEGA2_VC_GOTI:    num(src, 'OMEGA2_VC_GOTI'),
    OMEGA2_VP_GOTI:    num(src, 'OMEGA2_VP_GOTI'),
    SIGMA_PROP_GOTI:   num(src, 'SIGMA_PROP_GOTI'),
    SIGMA_ADD_GOTI:    num(src, 'SIGMA_ADD_GOTI'),
    GOTI_SCR_FLOOR:    num(src, 'GOTI_SCR_FLOOR'),
    GOTI_SCR_FLOOR_AGE:num(src, 'GOTI_SCR_FLOOR_AGE'),

    // Buelga 2005 — verified against AAC 2005;49:4934-41 general model
    BUELGA_CL_SLOPE:   num(src, 'BUELGA_CL_SLOPE'),
    BUELGA_V_PER_KG:   num(src, 'BUELGA_V_PER_KG'),
    OMEGA2_CL_BUELGA:  num(src, 'OMEGA2_CL_BUELGA'),
    OMEGA2_V_BUELGA:   num(src, 'OMEGA2_V_BUELGA'),
    SIGMA_PROP_BUELGA: num(src, 'SIGMA_PROP_BUELGA'),
    SIGMA_ADD_BUELGA:  num(src, 'SIGMA_ADD_BUELGA'),

    // Hughes 2024
    HUGHES_TVCL:       num(src, 'HUGHES_TVCL'),
    HUGHES_TVVC:       num(src, 'HUGHES_TVVC'),
    HUGHES_TVQ:        num(src, 'HUGHES_TVQ'),
    HUGHES_TVVP:       num(src, 'HUGHES_TVVP'),
    HUGHES_CRCL_EXP:   num(src, 'HUGHES_CRCL_EXP'),
    OMEGA2_CL_HUGHES:  num(src, 'OMEGA2_CL_HUGHES'),
    OMEGA2_VC_HUGHES:  num(src, 'OMEGA2_VC_HUGHES'),
    OMEGA2_VP_HUGHES:  num(src, 'OMEGA2_VP_HUGHES'),
    SIGMA_PROP_HUGHES: num(src, 'SIGMA_PROP_HUGHES'),
    SIGMA_ADD_HUGHES:  num(src, 'SIGMA_ADD_HUGHES'),
    // Hughes 2024 Table 1 (p. 578): the population the model was built in (D27)
    HUGHES_MIN_BMI:      num(src, 'HUGHES_MIN_BMI'),
    HUGHES_MAX_BMI:      num(src, 'HUGHES_MAX_BMI'),
    HUGHES_MIN_WT_KG:    num(src, 'HUGHES_MIN_WT_KG'),
    HUGHES_MAX_WT_KG:    num(src, 'HUGHES_MAX_WT_KG'),
    HUGHES_MIN_HT_CM:    num(src, 'HUGHES_MIN_HT_CM'),
    HUGHES_MAX_HT_CM:    num(src, 'HUGHES_MAX_HT_CM'),
    HUGHES_MIN_AGE_Y:    num(src, 'HUGHES_MIN_AGE_Y'),
    HUGHES_MAX_AGE_Y:    num(src, 'HUGHES_MAX_AGE_Y'),
    HUGHES_MIN_SCR:      num(src, 'HUGHES_MIN_SCR'),
    HUGHES_MAX_SCR:      num(src, 'HUGHES_MAX_SCR'),
    HUGHES_MIN_CRCL_FFM: num(src, 'HUGHES_MIN_CRCL_FFM'),
    HUGHES_MAX_CRCL_FFM: num(src, 'HUGHES_MAX_CRCL_FFM'),

    // Body size / units
    CM_PER_IN:         num(src, 'CM_PER_IN'),
    ML_MIN_TO_L_H:     num(src, 'ML_MIN_TO_L_H'),
    IBW_DEVINE_MIN_CM: num(src, 'IBW_DEVINE_MIN_CM'),
    IBW_DEVINE_BASE_M: objField(src, 'IBW_DEVINE_BASE', 'M'),
    IBW_DEVINE_BASE_F: objField(src, 'IBW_DEVINE_BASE', 'F'),
    // IBW_TARGET_BMI is DERIVED in the app (base / (152.4/100)^2) rather than
    // written as a literal, so it is derived identically here instead of being
    // parsed. Deriving it the same way is the point: if the app ever switches to
    // hand-picked targets, these stop matching calcIBW at the seam and the
    // continuity test in phase2d fails — which is the behaviour we want.
    get IBW_TARGET_BMI_M() {
      return this.IBW_DEVINE_BASE_M / Math.pow(this.IBW_DEVINE_MIN_CM / 100, 2);
    },
    get IBW_TARGET_BMI_F() {
      return this.IBW_DEVINE_BASE_F / Math.pow(this.IBW_DEVINE_MIN_CM / 100, 2);
    },

    // v2.2 — structural constants. Same rule: parsed, never copied.
    AMP_SEGMENT_PCT:        objLiteral(src, 'AMP_SEGMENT_PCT'),
    AMPUTATION_LEVELS:      arrayLiteral(src, 'AMPUTATION_LEVELS'),
    MODEL_AGREEMENT_BANDS:  arrayLiteral(src, 'MODEL_AGREEMENT_BANDS'),

    // v3 — exposure matrix and fit bands
    FIT_BANDS:              arrayLiteral(src, 'FIT_BANDS'),
    MATRIX_INTERVALS:       arrayLiteral(src, 'MATRIX_INTERVALS'),
    MATRIX_ROWS:            num(src, 'MATRIX_ROWS'),
    MATRIX_DOSE_STEP:       num(src, 'MATRIX_DOSE_STEP'),
    MATRIX_DOSE_MIN:        num(src, 'MATRIX_DOSE_MIN'),
    AUC24_TARGET_MIN:       num(src, 'AUC24_TARGET_MIN'),
    AUC24_TARGET_MAX:       num(src, 'AUC24_TARGET_MAX'),
    AUC24_ABSOLUTE_MAX:     num(src, 'AUC24_ABSOLUTE_MAX'),
    DOSE_MAX_PER_DOSE_MG:   num(src, 'DOSE_MAX_PER_DOSE_MG'),
    HD_PREDIALYSIS_MIN:     num(src, 'HD_PREDIALYSIS_MIN'),
    HD_PREDIALYSIS_MAX:     num(src, 'HD_PREDIALYSIS_MAX'),
    DOSE_MAX_TDD_MG:        num(src, 'DOSE_MAX_TDD_MG'),
    AMPUTATION_MAX_PCT:     num(src, 'AMPUTATION_MAX_PCT'),

    // v3.10.0 — the CrCl weight spread (D21)
    ARC_THRESHOLD:          num(src, 'ARC_THRESHOLD'),
    CRCL_MODEL_CAP:         numInDecl(src, 'CRCL_MODEL_CAP'),
    CRCL_MODEL_FLOOR:       numInDecl(src, 'CRCL_MODEL_FLOOR'),

    // v3.12.0 — IV vancomycin on peritoneal dialysis (D23)
    PD_LOAD_MG_PER_KG:      num(src, 'PD_LOAD_MG_PER_KG'),
    PD_EARLY_LEVEL_H:       num(src, 'PD_EARLY_LEVEL_H'),
    PD_APD_T12_ON_H:        num(src, 'PD_APD_T12_ON_H'),
    PD_APD_T12_OFF_H:       num(src, 'PD_APD_T12_OFF_H'),
    PD_CAPD_T12_MIN_H:      num(src, 'PD_CAPD_T12_MIN_H'),
    PD_CAPD_T12_MAX_H:      num(src, 'PD_CAPD_T12_MAX_H'),
    MATZKE_VD_GROUP3:       num(src, 'MATZKE_VD_GROUP3'),

    // v3.14.0 — continue the current regimen (D25)
    CONTINUE_MARGIN_DOTS:   num(src, 'CONTINUE_MARGIN_DOTS'),
    TROUGH_HIGH_MGL:        num(src, 'TROUGH_HIGH_MGL'),
    // v3.15.0 (Task 14) — the warning-tier trough (Rybak 2020: AKI risk rises from 15)
    TROUGH_WARN_MGL:        num(src, 'TROUGH_WARN_MGL'),
    // v3.15.0 (Task 14) — the one entry-limits table (UI plausibility limits, not clinical constants)
    INPUT_LIMITS:           objLiteral(src, 'INPUT_LIMITS'),
    TROUGH_TIMING_WINDOW_H: num(src, 'TROUGH_TIMING_WINDOW_H'),
    HD_LOADING_MAX_MG:      num(src, 'HD_LOADING_MAX_MG'),
    VERY_LOW_CRCL_THRESHOLD: num(src, 'VERY_LOW_CRCL_THRESHOLD'),
    // v3.14.0 (D26, final review I2) — the hold search horizon, a PREFERENCE (rule 8)
    HOLD_SEARCH_MAX_H:      num(src, 'HOLD_SEARCH_MAX_H'),
    // v3.14.0 (D26) — nextLevelValue reads the fit's confidence state
    CONFIDENCE_SIGMA:       objLiteral(src, 'CONFIDENCE_SIGMA'),
  };
}

// Parse `const NAME = { ... };` / `const NAME = [ ... ];` by balancing brackets,
// then evaluate the literal in isolation. Only ever applied to literals in our
// own source, and it throws rather than guessing if the shape changes.
function balancedLiteral(src, name, open, close) {
  const start = src.search(new RegExp('const\\s+' + name + '\\s*=\\s*\\' + open));
  if (start < 0) {
    throw new Error(
      `harness_constants: could not find \`const ${name} = ${open}...${close}\` in index.html.\n` +
      `  The constant was renamed, removed, or changed shape.\n` +
      `  Fix the harness to match the app — do NOT hardcode the old value back.`
    );
  }
  const from = src.indexOf(open, start);
  let depth = 0, end = -1;
  for (let i = from; i < src.length; i++) {
    if (src[i] === open) depth++;
    else if (src[i] === close) { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end < 0) throw new Error(`harness_constants: unbalanced ${open}${close} for ${name}`);
  const body = src.slice(from, end + 1)
                  .replace(/\/\/[^\n]*/g, '')            // strip line comments
                  .replace(/Infinity/g, '1e999');        // survives the Function round-trip
  // eslint-disable-next-line no-new-func
  return Function('"use strict"; return (' + body + ');')();
}
function objLiteral(src, name)   { return balancedLiteral(src, name, '{', '}'); }
function arrayLiteral(src, name) { return balancedLiteral(src, name, '[', ']'); }

module.exports = { extract, readAppSource, APP_PATH };

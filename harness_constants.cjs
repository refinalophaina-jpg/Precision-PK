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
function num(src, name) {
  const m = src.match(new RegExp('const\\s+' + name + '\\s*=\\s*(-?[0-9.]+(?:e-?[0-9]+)?)\\s*;', 'i'));
  if (!m) {
    throw new Error(
      `harness_constants: could not find \`const ${name} = <number>\` in index.html.\n` +
      `  The constant was renamed, removed, or changed shape.\n` +
      `  Fix the harness to match the app — do NOT hardcode the old value back.`
    );
  }
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
  };
}

module.exports = { extract, readAppSource, APP_PATH };

# Review: population PK models and mathematics (Hughes 2024 deep dive)

Target: `AinaDaraTDM/index.html`, branch `v3.14.0-continue-current`, HEAD `32988d9`. Read-only review; nothing in the repo was changed.
Date: 2026-11-13/14. All patients in the probes are fictional, drawn from seeded random number generators.

## Verdict in brief

- No Critical finding. The four priors match their papers, the MAP estimate is essentially unbiased, and the fit is deterministic.
- Hughes is implemented faithfully to Table 2 (after the earlier A9 fix).
- Three things would measurably improve Hughes: start the optimiser on Vp as well (a defect against the app's own rule), make the uncertainty band depend on when the levels were drawn, and flag covariates outside the population the model was built on.
- One rule-1 gap is outside the models: the severe-renal advisory's numbers carry no source.

## Evidence trail

All probes are in this folder and load the shipped engine in a Node `vm` through the repo's `docs/audit/uncertainty-load.cjs`. Run each from this folder. Seeds are fixed in the files, so the figures repeat exactly.

| Claim | Figure | Probe and command | Status |
|---|---|---|---|
| I1: shipped fit misses a lower minimum | 0.27% (one trough), 0.07% (peak and trough), 0.20% (three troughs), 0% (two levels after the load); n = 1,500 each | `node probe-B-vpstarts.cjs 1500` | Ran once |
| I1: largest clearance difference | 45% (three troughs); 30% and 22% in the other two designs | `node probe-B-vpstarts.cjs 1500` | Ran once |
| I1: 3 of 300 (1%) in one three-trough run, clearance 29–42% apart, largest 42.2% | per-case listing | `node probe-A-optimiser.cjs 300`, `node probe-A2-missed.cjs 300` | Ran once each |
| I1: alternatives flagged, shipped against 7 starts | 0 / 0 / 1 against 3 / 1 / 3 | `node probe-B-vpstarts.cjs 1500` | Ran once |
| I1: Goti unaffected | 0 of 4,500 | `node probe-B-vpstarts.cjs 1500` | Ran once |
| I2: coverage of the shipped band | 64.7% (two levels after the load), 58.7% in its q24h subgroup, 68.0% (one early level), 81.7–84.3% at steady state; n = 1,000 each | `node probe-C-uncertainty.cjs 1000` | Ran once |
| I2 / E1: Laplace interval coverage | 78.3–83.4% across six designs; 65.6% in the one-trough q24h subgroup | `node probe-C-uncertainty.cjs 1000` | Ran once |
| I3: typical clearance beyond the paper's range | 13.76 and 14.54 L/h (two fictional patients); 11.68 L/h at CrCl on FFM 255 | `node probe-F-steadystate.cjs` | Ran once |
| M1: residual-error effect on clearance | ratio 0.992–1.017 (10th–90th percentile, all designs) | `node probe-C-uncertainty.cjs 1000` (last column) | Ran once |
| M4: steady-state helper error | 0.098% worst when not clamped; 28.42% low at the 400-cycle clamp (188 of 2,000 grid regimens clamped) | `node probe-F-steadystate.cjs` | Ran once |
| M5: time zone | 13 h against 12 h over 1 Nov 2026; 11 h against 12 h over 14 Mar 2027; 02:30 read as 03:30 | `TZ=America/Chicago node probe-G-timezone.cjs`, `TZ=America/Phoenix node probe-G-timezone.cjs` | Originally an unsaved inline script; saved and re-run. The autumn figure matched. The spring 11 h was shown the first time but not quoted; it is now added to M5. |
| Determinism: effect of 1e-13 objective noise | at most 9.6e-6 % in clearance; iteration cap changed nothing in 1,500 fits | `node probe-A-optimiser.cjs 300` | Ran once |
| Bias: median true/estimated AUC | 0.994–1.026 shipped; 1.010–1.040 with ln(variance) | `node probe-C-uncertainty.cjs 1000` | Ran once |
| AUC identity | numeric 336.329 against dose/CL 336.538 | `node probe-F-steadystate.cjs` | Ran once |
| Shipped Hughes rows reproduce | p80 31.7 / 21.7 / 20.4 / 20.0% | from the repo: `node docs/audit/uncertainty-by-model.cjs 1500 hughes 7` | Ran once |
| Suite | 478/478 | from the repo: `node phase2d_validation.cjs` | Ran once |
| M2: effect of Goti's omega convention | none measured | no probe | **Not reproduced** (read only) |
| M1: which residual model is final | none | supplement not fetched (HTTP 402) | **Not reproduced** |
| E2: external evaluations | abstracts and one full text | PubMed and Europe PMC lookups | Read, not computed |

Not run at all: `phase3_simulation.cjs`, `phase4_regimen_validation.cjs`, `engine-parity.cjs`, `browser-flows.cjs`, and the other probes in `docs/audit/`.

## Parameter verification (read against the PDFs in `Literature/`)

| Model | Item | Code | Source | Status |
|---|---|---|---|---|
| Hughes 2024 | CL, θ3, Vc, Q, Vp | 5.09, 0.887, 64.9, 6.36, 66.4 | Table 2, nlmixr2 column, p. 579 | Exact |
| Hughes | FFM on Vc and Vp only, exponent fixed 1.0; none on CL or Q | `hughesPopPK` | Table 2 (u2 FIX) and Results p. 578 | Exact |
| Hughes | FFM equations (male 6680 + 216 BMI; female 8780 + 244 BMI) | `computeFFM` | Methods p. 576 | Exact |
| Hughes | Cockcroft-Gault on FFM, no cap | `getHughesCrCl` | Results p. 578: capping at 150 or 200 worsened the fit | Faithful |
| Hughes | ω² CL / Vc / Vp | 0.0602 / 0.0312 / 0.4974 | BSV 24.9 / 17.8 / 80.3 %CV; ln(1+CV²) = 0.0602 / 0.0312 / 0.4976 | Exact to rounding (Vp differs in the 4th decimal) |
| Hughes | No IIV on Q | fixed `TVQ` | p. 578 | Exact |
| Hughes | Residual 15.6% + 1.2 mg/L | `SIGMA_*_HUGHES` | Table 3; but Table 2 says 16.8% proportional, no additive | See M1 |
| Goti 2018 | CL 4.5, Vc 58.4, Vp 38.4, Q 6.5, CrCL exponent 0.8, DIAL 0.7 / 0.5, /120, /70, cap 150 | `gotiPopPK` | Table 2 and Methods | Exact |
| Goti | SCr floor 1.0 when age > 65 | `GOTI_SCR_FLOOR_AGE` | 2019 erratum | Correct; left alone |
| Goti | ω² from %CV by ln(1+CV²) | 0.1470 / 0.5103 / 0.2824 | Table 2 gives %CV without stating the convention | See M2 |
| Buelga 2005 | CL = 1.08 × CLcr, V = 0.98 × TBW, ω 28.16 / 37.15%, σ 3.52 mg/L additive | `buelgaPopPK` | Table 4, p. 4937 | Exact; covariance term omitted and documented |

## Findings

### Critical

None.

### Important

**I1. The Hughes fit never starts on Vp, so it can settle in the higher of two minima and say nothing** (defect)
- Location: `index.html:10050` `mapFit`; start list `[[0,0],[sC,0],[-sC,0],[0,sV],[0,-sV]]`, third eta always 0.
- What is wrong: Hughes' widest prior is Vp (80.3 %CV, SD 0.705 on the log scale). The posterior can be bimodal along the CL–Vp ridge. All five starts sit at Vp = 0 and converge to the same minimum.
- Evidence (ran; see the trail):
  - Three steady-state troughs, n = 300: 3 patients where a 27-start reference found a lower objective; clearance differed 29–42%. All five shipped starts landed on one minimum; a single +1 SD Vp start found the other.
  - n = 1,500 per design, 7 starts against 5: a lower minimum in 0.27% (one trough), 0.07% (peak and trough), 0.20% (three troughs), 0% (two levels after the first dose). Clearance moved up to 45%.
  - The objective gap was 0.2–0.6, inside `MAP_TIE_OBJ = 2`, and the clearance gap above `MAP_SPLIT_CL = 0.20`. By the app's own D10 rule these must be reported as "two parameter sets fit". Shipped flagged 0, 0, 1; seven starts flagged 3, 1, 3.
  - The lower minimum was nearer the truth in about half the cases (2 of 4, 0 of 1, 2 of 3), so this is a disclosure and reproducibility defect, not a bias.
  - Goti: no lower minimum in 4,500 fits. The problem is specific to Hughes.
  - The three listed cases were slow clearers on q24h with troughs below what the prior expected.
- Proposed change: pass the Vp omega to `mapFit` and add `[0,0,+sVp]` and `[0,0,-sVp]` for 3-parameter fits.
- How to test: `probe-B-vpstarts.cjs` as a suite; assert the shipped fit's objective is within 1e-6 of a 27-start reference over 1,500 fictional patients per design. Engine parity will show differences only in the affected fits.
- Effort: S.

**I2. The Hughes uncertainty band is too narrow when levels are drawn early, and the decision counts dots from it** (defect in calibration; partly disclosed)
- Location: `AUC_UNCERTAINTY.hughes` at `index.html:10941`; consumed by `regimenDecision` through `aucUncertaintyRow` (`:12262`); the "Early level" note at `:13283`.
- What is wrong: the rows were simulated for steady-state troughs on 1000 mg q12h. For levels after the first dose the stated 80% band covers far less. The note says the band "is wider" but gives no number, and the 20 dots and the D25 continue-or-change count still use the narrow row.
- Evidence (ran, `probe-C-uncertainty.cjs`, n = 1,000 per design, truth from Hughes' own prior):

  | Design | Row shown | Coverage of the shown band | Laplace interval coverage | Laplace median half-width |
  |---|---|---|---|---|
  | No levels | −27 / +37% | 79.2% | 79.1% | ±37% |
  | One level 6–10 h after the load | −18 / +28% | 68.0% | 81.1% | ±35% |
  | Two levels after the load (2 h post, trough) | −17 / +26% | 64.7% | 79.5% | ±33% |
  | One steady-state trough | −18 / +28% | 81.7% | 78.3% | ±23% |
  | Steady-state peak and trough | −17 / +26% | 82.8% | 81.8% | ±21% |
  | Three steady-state troughs | −17 / +25% | 84.3% | 83.4% | ±21% |

  In slow clearers (q24h) the two-level-after-load coverage was 58.7%.
- Why it matters for Hughes in particular: two levels after the loading dose is the sampling protocol of the centre the model was built at (Hughes 2024, Methods p. 576).
- Proposed change, smallest first:
  1. Simulate and ship a second set of Hughes rows for pre-steady-state levels, chosen by the same test the "Early level" note already uses, and feed that row to the dots and the decision.
  2. Or replace the table with a per-fit interval (E1).
- How to test: `probe-C-uncertainty.cjs`; require 75–85% coverage in every design, absolute (rule 5).
- Effort: S for option 1, M for option 2.
- This changes the dot count that `regimenDecision` reads, so it is a clinical-behaviour change: see Decisions.

**I3. No warning when a Hughes covariate is outside the population the model was built on, other than BMI below 40** (defect of omission)
- Location: `getHughesCrCl` `index.html:10215`; `modelMismatchText` `:11951`. No check found for the other ranges (searched for the Table 1 limits).
- What is wrong: the paper's ranges are CrCl on FFM 13.0–255 mL/min, SCr 0.40–2.51 mg/dL, age 24–89, weight 91.6–218 kg, BMI 40–70.3 (Table 1, p. 578). CrCl on FFM is uncapped, faithfully, and clearance rises as a power of it.
- Evidence (ran, `probe-F-steadystate.cjs`): typical clearance 11.68 L/h at the top of the range (255); a fictional 25-year-old man, 200 kg, 185 cm, SCr 0.5 gives CrCl on FFM 307 and typical CL 13.76 L/h, about 6.9 g a day for AUC 500. A fictional 30-year-old, 160 kg, SCr 0.4 gives 327 and 14.54 L/h. The floor of 5 mL/min is below the paper's minimum of 13.
- Proposed change: one line in the confidence slot when any Hughes input is outside Table 1, naming the input and the range. Do not cap or alter the value (rule 4, and the paper's own finding on capping).
- How to test: a suite with one fictional patient per boundary, each side.
- Effort: S.

**I4. The severe-renal advisory's numbers carry no source** (rule 1; raised by another reader, confirmed by reading)
- Location: `index.html:13404–13406`; threshold `VERY_LOW_CRCL_THRESHOLD = 10` at `:8427`.
- What is wrong: "15–20 mg/kg, max 2 g", "wait 24–48 h", "q24h–q72h or longer" and the CrCl 10 threshold have no citation in the code. The loading range also differs from the one the app cites elsewhere: the dialysis table uses Rybak 2020 Rec 11 with a 3,000 mg maximum.
- Evidence: read; no comment or constant names a paper, table or recommendation.
- Proposed change: cite each number, or reword to what can be cited. Which numbers to show is a clinical choice: see Decisions.
- How to test: a text suite asserting each advisory number sits beside a source comment.
- Effort: S.

### Minor

**M1. Hughes residual error: the paper disagrees with itself, and the code comment does not say so**
- Location: `index.html:10197`, comment "Table 3 final summary (Gus's choice)".
- Table 2 (nlmixr2) lists 16.8% proportional and no additive term; Table 3 lists 15.6% + 1.2 mg/L. The supplement holding the final model code could not be fetched (not reproduced).
- Evidence (ran, `probe-C-uncertainty.cjs`): fitting with 16.8% proportional instead moved clearance by −0.8% to +1.7% (10th to 90th percentile) across all designs. Immaterial.
- Proposed change: no number changes. Replace the comment with both table values, the measured sensitivity, and what "Gus's choice" means, or remove the name. Obtain the supplement to settle it.
- Effort: S.

**M2. Goti's omegas assume the table's %CV is the exact log-normal CV**
- Location: `index.html:9916–9918`.
- Goti's Table 2 says "%CV" and the Methods do not give the conversion. If the authors reported √ω² × 100, ω² would be 0.158 / 0.666 / 0.326 against the coded 0.147 / 0.510 / 0.282; the Vc variance differs by 23%. The Buelga comment already records this distinction; the Goti one does not.
- Evidence: read only. The effect on clearance is **not reproduced**: no probe was written, and no independent implementation was checked.
- Proposed change: record the ambiguity at the constants; run a sensitivity probe (same design as M1) before deciding anything.
- Effort: S.

**M3. Stale Hughes header comment contradicts the code**
- Location: `index.html:10177–10181` still shows FFM/70 on CL and Q. The code (correct, A9) applies it to volumes only.
- Proposed change: correct the comment. Effort: S.

**M4. Steady-state helpers under-read at the 400-cycle clamp**
- Location: `ssCycles2comp` `index.html:10110`.
- Evidence (ran, `probe-F-steadystate.cjs`, 2,000 regimens): within 0.1% of the closed form when not clamped. Clamped in 188 extreme combinations; worst trough 28.4% low (CL 0.15 L/h, Vc 130, Vp 250, q8h). Reaching it needs clearance near the model floor on a short interval, where the severe-renal hold already applies.
- Proposed change: replace the cycle loop with the closed-form geometric series (exact, no clamp, faster). The formula is in `probe-F-steadystate.cjs`.
- How to test: the probe's grid; engine parity should stay within 0.1%.
- Effort: S.

**M5. Results depend on the machine's time zone across a clock change**
- Location: `parseBayesCourse` `index.html:8672`, `elapsedHours` `:5110`; both parse local date-times.
- Evidence (ran, `probe-G-timezone.cjs`): 20:00 to 08:00 over 1 November 2026 is 13 h in America/Chicago and 12 h in America/Phoenix; over 14 March 2027 it is 11 h against 12 h; 02:30 on 14 March 2027 silently becomes 03:30 in Chicago. The elapsed time is physically right for the local user; it is not reproducible on a machine in another zone.
- Proposed change: document it; refuse or flag a time that does not exist locally; run one suite under a fixed `TZ`.
- Effort: S.

**M6. Goti's Cockcroft-Gault weight is the calculator's choice, not the paper's**
- Location: `getGotiCrCl` `index.html:9929` uses `dosingWt` (adjusted weight above 120% of ideal).
- Goti's Methods say only "Cockroft-Gault formula" with no weight stated. D21 already shows the spread across weights before the first level. Record at the call site that the basis is unsourced.
- Evidence: read only. Effort: S.

### Checked and sound (no action)

- **Determinism.** No random number or clock reaches the fit; `Date.now()` feeds only the "now" marker and first-dose timing (read). A relative 1e-13 perturbation of the objective, standing in for last-digit differences between browsers' `Math.exp`, moved clearance by at most 1e-5 %. The 400-iteration cap never changed eta by more than 1e-6 in 1,500 fits. Epoch-hour timestamps lose no precision (`probe-A-optimiser.cjs`, `probe-F-steadystate.cjs`).
- **Global optimum.** Outside I1, the shipped fit matched the 27-start reference to 4e-6 % in clearance (`probe-A-optimiser.cjs`).
- **Bias.** Median true/estimated AUC 0.99–1.03 in every design (`probe-C-uncertainty.cjs`).
- **ln(variance) term (D10).** Re-tested for Hughes: adding it moved the median ratio to 1.01–1.04, slightly worse. D10 stands.
- **AUC.** `auc24 = dose × (24/τ) / CL` agrees with a numerical integral over a steady-state interval (336.33 against 336.54; the gap is the 20-cycle approach to steady state plus trapezoid error).
- **SCr handling.** Truncation lives only on the Goti path; Hughes and Buelga use the measured value; Hughes ignores the manual CrCl override by design (read).

### Enhancements

**E1. Per-fit posterior interval (Laplace) in place of the simulated table** (worthwhile enhancement)
- Evidence: the table in I2. One Hessian of the existing objective (about 19 evaluations) gave 78–83% coverage in every design, and at no levels it reproduces the shipped −27 / +37%.
- Expected effect: honest width for early levels (±33–35% instead of ±17–28%), slightly narrower at steady state.
- Risk: it under-covered in one subgroup (one trough, q24h patients: 65.6%), where the posterior is not Gaussian; that is the same ridge as I1. It also changes the dots the decision reads.
- Validation: `probe-C-uncertainty.cjs` extended to Goti and Buelga, coverage 75–85% per design and per interval subgroup; keep the table as the fallback when the Hessian is not positive definite.
- Effort: M.

**E2. External-evidence statement for Hughes in the model note** (worthwhile enhancement, wording only)
- According to PubMed: Hughes was the best a priori model in many obese age-BMI groups across 384,876 courses (Hughes MSA et al., Pharmacotherapy 2024, [DOI](https://doi.org/10.1002/phar.4613)); every model did worse in younger adults. Switching the default for BMI ≥ 40 from Carreno to Hughes produced no significant change in target attainment or kidney injury in 2,709 patients (Tong et al., JAC-AMR 2026, [DOI](https://doi.org/10.1093/jacamr/dlag016)). In critically ill obese patients, critical-illness models (Goti, Roberts) out-predicted obesity models; that study predates Hughes (Alsultan et al., J Clin Pharmacol 2023, [DOI](https://doi.org/10.1002/jcph.2375)).
- All Hughes-specific evaluations found are by the model's own group, on data from the same software. No independent external evaluation of Hughes 2024 was found.
- The source paper: [DOI](https://doi.org/10.1097/FTD.0000000000001214). Its abstract gives the a priori bias as −6.3%.
- Effort: S.

**E3. Model averaging or selection** (research idea)
- According to PubMed, machine-learning selection and averaging beat any single model a priori on 343,636 records (van Os et al., CPT:PSP 2025, [DOI](https://doi.org/10.1002/psp4.70084)). That needs training data this project does not have. The app's model-agreement panel already shows the spread; a weighted average would add an unsourced weight (rule 8). Not recommended now.

**E4. Time-varying creatinine in the fit** (research idea)
- The fit uses one SCr for the whole course. A piecewise clearance would matter in changing renal function; it is an engine overhaul and needs its own validation.

## Hughes: accuracy and reproducibility

**Is it faithful?** Yes. Structure, all five typical values, the FFM equations, CrCl on FFM without a cap, the three variances and fixed Q match Table 2 and the Methods. The only open point is the residual error (M1), which moves clearance by under 2%.

**What it was built on.** 83 patients at one centre, 272 levels, median 2 per patient; BMI 40–70.3; a loading dose then two levels. Parameter shrinkage was 22% (CL) and 32% (V). Only 31 of 272 levels were peaks, so Vp (80% CV, 32% uncertainty on that figure) is weakly informed. That is the root of I1.

**Ranked proposals**

| # | Proposal | Class | Evidence | Expected effect | Risk | Validation | Effort |
|---|---|---|---|---|---|---|---|
| 1 | Add ±1 SD Vp starts (I1) | Fix a defect | 0.1–0.3% of fits (1% in one three-trough run of 300) sit in the higher minimum unflagged; clearance differs up to 45% | Global MAP found; the "two parameter sets" note fires when it should | Two more optimiser runs per fit | `probe-B-vpstarts.cjs` as a suite | S |
| 2 | Early-level uncertainty rows (I2) | Fix a defect | Stated 80% band covers 65–68% for levels after the load | Honest band and dot count in the model's own sampling protocol | Moves some continue-or-change decisions | `probe-C-uncertainty.cjs`, absolute coverage gate | S |
| 3 | Out-of-population flags (I3) | Fix a defect | Clearance 14 L/h reachable beyond the paper's range, silently | Clinician told when the prior is extrapolating | None to dosing | Boundary suite | S |
| 4 | Laplace interval (E1) | Worthwhile enhancement | 78–83% coverage in all designs | Replaces table and rows from proposal 2 | Non-Gaussian ridge cases | `probe-C-uncertainty.cjs` across models | M |
| 5 | Closed-form steady state (M4) | Worthwhile enhancement | Exact; removes a 28% worst-case clamp error | Exact troughs at very low clearance | None found | `probe-F-steadystate.cjs` grid | S |
| 6 | Settle the residual error from the supplement (M1) | Housekeeping | Under 2% effect either way | Provenance closed | None | Read the supplement | S |
| 7 | Model averaging, time-varying SCr (E3, E4) | Research idea | Literature only | Unknown here | Unsourced weights; engine overhaul | Would need real data | L |

**Reproducibility.** Same inputs give the same output on any run; browser arithmetic differences are several orders of magnitude below display precision. The two real limits are the time zone across a clock change (M5) and, against another Bayesian program, the missed minimum (I1). Agreement with InsightRX is not guaranteed even after I1: whether that software includes the ln(variance) term this app leaves out (D10) was not checked; in the probe that term shifts the median estimate by about 1–2%.

## Decisions for the user

1. **I2:** should the dots and the continue-or-change decision use a wider band when levels are pre-steady-state? It will change some answers.
2. **I4:** which loading dose and maximum belong in the severe-renal advisory (the unsourced 15–20 mg/kg, max 2 g, or the guideline figures used elsewhere), and what source supports the CrCl 10 threshold and the 24–48 h wait?
3. **I3:** wording and tier of the out-of-population note, and whether a Hughes run far outside the range should lower the confidence rating.
4. **M1:** keep Table 3's 15.6% + 1.2 mg/L or use Table 2's 16.8%? The effect is under 2%; the supplement would settle it.
5. **M2:** whether to pursue Goti's omega convention with the authors or an independent implementation.
6. **E2:** whether the model note should say that Hughes' external evaluations all come from its own group.

_Advisory decision-support only; not clinically validated by this review. Clinician judgement governs._

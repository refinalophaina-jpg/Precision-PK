# Release 3 — Dialysis (v3.16.0, D28) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a patient on CRRT or hybrid therapy (SLED / PIRRT) a place to be recorded and a refusal instead of a silent non-dialysis fit, show the guideline's references for both, add a level-based CRRT answer and a level-based haemodialysis reading from browser-only settings, and record what none of it can see.

**Architecture:** One renal-replacement value (`rrt`) shared by both modules replaces three independent checkboxes. Everything new is either a refusal, a guideline table computed from actual body weight, or a level-based answer built on the peritoneal-dialysis solver, generalised rather than copied. No new population model and no new fitted parameter; engine parity for every non-dialysis path stays at 0.

**Tech stack:** Vanilla JS in the single file `index.html`; Node `vm` harness (`phase2d_validation.cjs`, constants through `harness_constants.cjs`); Playwright browser flows under the production CSP (`docs/audit/browser-flows.cjs`, `docs/audit/serve-csp.py` on 8777); the mutation gate `docs/audit/mutation.cjs`.

**Spec:** "Release 3" in `docs/superpowers/plans/2026-11-14-review-fixes-and-dialysis.md` (scope, interfaces, constants), the user's rulings below, and the dialysis research report, which lives outside this public repository (`…/Vancomycin /reports/Vancomycin dosing in CRRT and haemodialysis.md`; its private section never enters the repo). This plan supersedes that section's task numbering (23–28 become 23–30).

## Global Constraints

- `CLAUDE.md` rules 1–9 bind every task: a clinical constant names its paper, recommendation and grade (rule 1); one implementation per concept (rule 2); creatinine as measured (rule 4); constants reach tests through `harness_constants.cjs` (rule 6); a number no paper sets says `PREFERENCE (rule 8)`, what it orders and whether it can change a dose (rule 8); never weaken a test (rule 9).
- New numeric constants are declared at column 0 as `const NAME = <numeric literal>;` so `harness_constants.cjs` `num()` reads them; add each to `extract()`.
- Public repository: no institution names, no workplace protocol content, no third-party PDF, no patient data. Fictional patients only. The haemodialysis reading ships **no value** for any of its settings.
- No inline `on*` handlers; new handlers go in `__ACT` with `data-onclick="kN"` (next free key after `k101`). Every interpolated user or stored value goes through `escHtml()`.
- Refuse rather than approximate. Unsupported states are visibly unavailable, never silently approximated. No dose is ever scaled from an effluent rate. No creatinine-based clearance on CRRT or hybrid. No fit across a change of modality.
- Copy: house style (sentence case, no exclamation marks, ISMP doses via `fmtDose`, "AUC₂₄" on screen), workstation not bedside, terracotta only for the recommendation, alarm tier only for top-tier safety. Every guideline-derived number shows the mg/kg or source it came from. Every local value is labelled "your setting".
- Nothing here is clinically validated; no record may say otherwise.
- Tests: new **SUITE 46** in `phase2d_validation.cjs`, numbered 46.N; bump `EXPECTED_TOTAL` with every test added. Browser checks prefixed `D28:`. Each task adds mutants to `docs/audit/mutation.cjs` that its own named tests kill.
- Per-task gate: syntax one-liner; `node phase2d_validation.cjs` (all = `EXPECTED_TOTAL`); `node phase3_simulation.cjs` 21/21; `node phase4_regimen_validation.cjs` 49/49; `node docs/audit/mutation.cjs` exit 0; the task's browser checks (run on their own, never beside the mutation gate); `node docs/audit/engine-parity.cjs --ref bcee5dd` = 0 differences unless the task lists one.

## The user's rulings

From 2026-11-14 (master plan): CRRT = guard, guideline reference, then a level-based answer, no Bayesian model (5); hybrid = guard and reference only, sessions to 24 h (6); the Trough module gains a level-based haemodialysis reading driven only by browser-stored settings, beside the model's answer (7). From 2026-11-16:

- **U8.** The D-j defaults stand: no dialyser or therapy descriptor; more than three haemodialysis sessions in any seven days is a caution only; a fit across a change of modality is refused and the course restarts; the pre-dialysis target stays 15–20 mg/L; one five-way selector replaces the checkboxes.
- **U9.** The CRRT goal is the PD presets (10–15, 15–20, custom), nothing preselected, one goal control for both modes.
- **U10.** The CRRT and hybrid tables take a browser-only local maximum dose; the cap is the lower of `HD_LOADING_MAX_MG` and the local maximum, and the table says which applied.
- **U11.** The haemodialysis reading's hold level is a fourth local setting; no setting, no reading.

## Verified guideline values (Rybak 2020, read in full text 2026-11-16)

| Name | Value | Source and grade |
|---|---|---|
| `CRRT_LOAD_MG_PER_KG_MIN` / `_MAX` | 20 / 25 mg/kg actual body weight | Rec 16, B-II |
| `CRRT_MAINT_MG_PER_KG_MIN` / `_MAX` | 7.5 / 10 mg/kg | Rec 16, B-II |
| `CRRT_MAINT_INTERVAL_H` | 12 | Rec 16 ("every 12 hours"), B-II |
| `CRRT_EFFLUENT_MIN_ML_KG_H` / `_MAX` | 20 / 25 mL/kg/h | Rec 16 (KDIGO-recommended rates), B-II |
| `CRRT_FIRST_LEVEL_WITHIN_H` | 24 | Rec 16 text ("within the first 24 hours") |
| `HYBRID_LOAD_MG_PER_KG_MIN` / `_MAX` | 20 / 25 mg/kg actual body weight | Rec 15, B-III |
| `HYBRID_MAINT_MG_PER_KG` | 15 mg/kg after the session ends or in its final 60–90 min | Rec 15, B-III |
| `RRT_NO_SAMPLE_AFTER_SESSION_H` | 2 | Rybak 2020 hybrid text: levels during or within 2 h of a session's end "will be artificially low" |
| (existing) `HD_PREDIALYSIS_MIN/MAX` | 15 / 20 mg/L | Rec 14, **C-III** (re-cite, Task 29) |
| (existing) `HD_LOADING_MAX_MG` | 3,000 mg | Rec 11 |
| (existing, guideline comparison) 15 mg/kg | 15–20 mg/kg q8–12h, normal renal function | Rec 9, A-II (re-cite, Task 29) |

Rec 13's maintenance doses are footnoted "thrice-weekly dose administration" (the source of the more-than-three-sessions caution).

## Review Focus

1. Changing the selector while a result is on screen: the result is marked stale or cleared, never left reading as current for the old modality (Task 23).
2. A v3.15.0 profile with `core.hd` true saved under Buelga (R21 dropped its `dial`): it loads as `ihd` with the Buelga tile and AUC Precision refuses, naming Goti 2018 · HD; it never fits as a non-dialysis patient (Task 23).
3. A CRRT circuit stopped now (the last running interval has a stop time before now): no projection and no dose table, "Draw a level", even when earlier intervals were clean (Task 27).
4. Three of the four haemodialysis settings set: no reading, and the refusal names the one missing (Task 28).
5. Weight missing or outside `INPUT_LIMITS` on a reference table: a refusal naming the weight, never `NaN` or a 250 mg floor (Task 25).

---

### Task 23: One renal-replacement selector, routing and profiles

**Files:** Modify `index.html` (markup near `#t-hd` ~3015, `#b-dial-wrap`/`#b-pd` ~3847–3851; `calculate()` ~7104–7111; `setCalcMode` ~4522; `setBModel` ~11421; `runBayesian` ~13525/13669; `resetForm` ~8846; `resetBayesian` ~16361/16403; `snapshotPatientCore` ~16631; `loadProfileIntoForm` ~16874; `validProfile` ~16433; `bayesInputFingerprint` ~16509). Test: SUITE 46; `browser-flows.cjs`; `mutation.cjs`.

**Interfaces:**
- Produces: `const RRT_KINDS = ['none','ihd','hybrid','crrt','pd'];`; `state.rrt` and `bState.rrt` (always equal); `setRrt(kind)` (sets both selects `#t-rrt` and `#b-rrt`, both states, the Trough calc mode and the AUC tile as below, and marks any shown result stale through the existing run/stale machinery); `rrtOf(core, demographics, pd) -> kind` (the legacy mapping); `rrtNoticeHTML(kind, module)` returning the refusal markup for a module. Trough calc modes gain `'crrt'`, `'ihd'` and `'hybrid'` (panels built in Tasks 25, 27, 28; this task renders their refusal or placeholder).
- `bState.dial` stays, derived: `bState.dial === (bState.rrt === 'ihd')`, so the engine and `gotiPopPK(…, dial)` are untouched.

Routing:

| `rrt` | AUC Precision | Trough module |
|---|---|---|
| none | as today | as today |
| ihd | Goti 2018 · HD tile selected; any other tile refuses before parsing: "On haemodialysis — only Goti 2018 · HD carries dialysis", with a button selecting that tile | calc mode `ihd`: the existing `troughHdNoticeHTML` first; Task 28's reading below it |
| pd | the existing `bayesPdNoticeHTML` refusal | calc mode `pd`, as today |
| crrt | refuses before anything is parsed or fitted: "On CRRT — no model here describes it"; Task 25's reference; a button to Trough-based · CRRT | calc mode `crrt` (Task 27) |
| hybrid | refuses the haemodialysis answer: "On hybrid therapy (SLED / PIRRT) — no model or target here describes it"; Task 25's reference | calc mode `hybrid`: the same refusal and reference |

- While `rrt !== 'none'` the four creatinine-based Trough mode buttons (initial, level, two levels, random level) are shown unavailable (`aria-disabled="true"`, one line: "Not used on <modality>. Set Renal replacement to None to use it."). The PD mode button sets `rrt = 'pd'`. Selecting the Goti 2018 · HD tile sets `rrt = 'ihd'`; setting `rrt` from `ihd` to `none` moves that tile to plain Goti.
- `#t-hd`, `#b-dial` and `#b-pd` are removed; every reader listed in the code map reads `rrt` instead (`calculate`, `readPdForm`'s `hd`, `runBayesian`'s `isOnDial` and PD check, `markSuggestedModel`, `snapshotBayesForm`, the fingerprint). `getModelRecommendation(…, onHD)` takes `rrt === 'ihd'`.
- Profiles: `snapshotPatientCore` writes `core.rrt` (and keeps writing `core.hd = rrt === 'ihd'` for older readers). Load: `core.rrt` when present; otherwise `rrtOf`: `s.pd && s.pd.modality` → `'pd'`; `core.hd || demographics.dial` → `'ihd'`; else `'none'`. `validProfile` refuses a profile whose `core.rrt` is present and not in `RRT_KINDS` (never repaired). Reset of either column sets `rrt = 'none'` (fixes the AUC PD box never being cleared).
- The selector is a labelled `<select>` ("Renal replacement": None; Intermittent haemodialysis; Hybrid (SLED / PIRRT); CRRT; Peritoneal dialysis) in each column's patient section, after sex and before creatinine; the D24 column order otherwise stands.

- [ ] **Step 1: Write the failing tests (SUITE 46, 46.1–46.12).** Pure where possible (`rrtOf`, `rrtNoticeHTML`); DOM-reading paths through the existing `withBayesForm` / `withProf44` helpers. Assert:
  - 46.1 `RRT_KINDS` parsed by `harness_constants.cjs` equals the five kinds in order.
  - 46.2 `rrtOf` maps: `{pd:{modality:'apd'}}` → `pd`; `{core:{hd:true}}` → `ihd`; `{demographics:{dial:true}}` → `ihd`; `{}` → `none`; `core.rrt:'crrt'` wins over `core.hd`.
  - 46.3 for each of `crrt` and `hybrid`, `runBayesian` under each of the four tiles writes the refusal and never calls `parseBayesCourse` (spy) and writes no regimen.
  - 46.4 `ihd` with the Buelga, Goti or Hughes tile refuses naming "Goti 2018 · HD"; with the Goti-HD tile it runs as today (the existing SUITE 35 HD answers still pass unchanged).
  - 46.5 `calculate()` with `rrt` `crrt`, `hybrid` or `ihd` and calc mode `initial` refuses (the buttons are unavailable; a forced call still refuses).
  - 46.6 the review-focus case: a profile `{core:{hd:true, …}, demographics:{dial:false}, model:'buelga'}` loads as `rrt 'ihd'`, Buelga tile, and the AUC run refuses.
  - 46.7 a profile with `core.rrt:'sled'` is refused by `validProfile`.
  - 46.8 save then load round-trips each of the five kinds.
  - 46.9 `bState.dial === (bState.rrt === 'ihd')` after every `setRrt` call and every tile click.
  - 46.10 `index.html` contains no `id="t-hd"`, `id="b-dial"` or `id="b-pd"` (source test).
  - 46.11 `resetBayesian()` and `resetForm()` each leave `rrt === 'none'` in both states.
  - 46.12 changing `rrt` after a run marks the shown result stale (the existing stale flag the review-fix Task 1 uses).
- [ ] **Step 2: Run; expect each to fail** (`node phase2d_validation.cjs 2>&1 | grep -E '46\.'`).
- [ ] **Step 3: Implement** to the interfaces above.
- [ ] **Step 4: Run SUITE 46 and the full gate;** every earlier suite passes unchanged (SUITE 35 HD, 41 PD, 44 profiles R18–R23 updated only where they name a removed id, each such edit listed in the report with why it is not a weakening).
- [ ] **Step 5: Browser checks (`D28:`):** select each kind in the Trough column and see the AUC column follow, and the reverse; CRRT and hybrid refusals by real click under every tile; the unavailable mode buttons announce their reason; a saved Buelga+HD profile loads to the refusal; 375 px layout has no horizontal scroll.
- [ ] **Step 6: Mutants:** `bState.dial` derived from `rrt === 'pd'`; the CRRT refusal moved after `parseBayesCourse`; `rrtOf` dropping the `demographics.dial` branch. Each killed by a named 46.x test.
- [ ] **Step 7: Commit** `feat(rrt): one renal-replacement selector replaces the dialysis checkboxes (D28)`.

### Task 24: Typed session rows, hybrid sessions to 24 h, and the sessions-per-week caution

**Files:** Modify `index.html` (`addBayesSession` ~9267, `INPUT_LIMITS` ~6009, `parseBayesCourse` session block ~9375–9410, `hdScheduleDates`/`addHdSchedule` ~10149–10164, `snapshotBayesForm` ~16556, load ~16950, `syncHdSection` ~9304). Test: SUITE 46.

**Interfaces:**
- Consumes: `bState.rrt` (Task 23).
- Produces: each session row carries `type ∈ {'ihd','hybrid'}` (a per-row select defaulting to the current `rrt` when that is `ihd` or `hybrid`); parsed sessions `{n, startH, endH, hours, label, type}`; `INPUT_LIMITS.hybridHours = { min: 0.5, max: 24, label: 'Session length', unit: 'h' }` beside `hdHours` (unchanged 0.5–12); `sessionsPerWeekMax(sessions) -> number` (the most sessions whose start falls in any 7-day window); `const HD_SESSIONS_PER_WEEK_CAUTION = 3;` with the source comment "Rybak 2020 Rec 13: maintenance doses are for thrice-weekly administration; more often, dose from levels (Rec 14). A caution only (the user's ruling U8); changes no number." Saved rows gain `type`; a saved row without one loads as `ihd`.
- The session section shows for `rrt` `ihd` or `hybrid` (and when rows exist, as today).

- [ ] **Step 1: Failing tests 46.13–46.20:**
  - 46.13 under `hybrid`, a 14 h row parses; under `ihd`, a 14 h row is refused with a message naming prolonged therapy ("… longer than 12 h is prolonged therapy: set Renal replacement to Hybrid").
  - 46.14 a 24 h hybrid row parses; 24.25 h is refused through `checkValue`.
  - 46.15 a row typed `hybrid` while `rrt` is `ihd` (and the reverse) is a blocking error naming the row: "HD session row 2 is typed hybrid while Renal replacement is intermittent haemodialysis."
  - 46.16 overlap check still fires across a 20 h hybrid row crossing midnight.
  - 46.17 `sessionsPerWeekMax`: Mon/Wed/Fri → 3; Mon/Tue/Wed/Fri → 4; four sessions spread over 8 days with no 7-day window holding four → 3.
  - 46.18 on Goti-HD with four sessions in seven days the answer carries one caution line citing Rec 13 and Rec 14 and every number is identical to the same course with that caution suppressed (compare the result object minus `cautions`).
  - 46.19 three sessions in seven days: no caution.
  - 46.20 save/load round-trips row types; a v3.15.0 row without `type` loads as `ihd`.
- [ ] **Step 2: Run; expect fails.**
- [ ] **Step 3: Implement.** The recurring generator stamps the current type and uses the type's limit.
- [ ] **Step 4: Gate.**
- [ ] **Step 5: Browser checks:** type a 14 h hybrid row by keyboard; the IHD refusal text; the caution under a daily schedule generated with "every 1 day".
- [ ] **Step 6: Mutants:** `HD_SESSIONS_PER_WEEK_CAUTION` 3 → 4; the type check removed from `parseBayesCourse`; `hybridHours.max` 24 → 12.
- [ ] **Step 7: Commit** `feat(rrt): typed session rows, hybrid sessions to 24 h, sessions-per-week caution (D28)`.

### Task 25: Guideline references for CRRT and hybrid, and the local maximum

**Files:** Modify `index.html` (beside `hdEmpiricDoses`/`hdEmpiricHTML` ~9580/10818; PD local settings ~4596–4635 for the shared pattern); `harness_constants.cjs`. Test: SUITE 46.

**Interfaces:**
- Consumes: `roundDose250`, `HD_LOADING_MAX_MG`, `DOSE_MAX_PER_DOSE_MG`, `fmtDose`, Task 23's notices.
- Produces:
  - The constants in the "Verified guideline values" table, each with a source comment quoting the recommendation number and grade.
  - `rrtLocalSettings() -> { maxDoseMg|null }` and `saveRrtLocalSettings()` on key `vanco.rrt.local`, the PD pattern (blank keeps the stored value), plus a **Clear** control (`kN`) removing the key. The same Clear control is added to PD's settings (removes `vanco.pd.local`; the deferred Release 1 item "no control to remove a stored PD cap").
  - `rrtReferenceDoses(kind, abwKg, localMaxMg) -> null | { kind, abwKg, cap:{mg, by:'guideline'|'local'}, load:[{mgPerKg, raw, mg, capped}], maint:[{mgPerKg, raw, mg, capped}], intervalH|null }` for `kind ∈ {'crrt','hybrid'}`; `null` when weight is missing or outside `INPUT_LIMITS.weight`.
  - `rrtReferenceHTML(ref, opts) -> string`, where `opts = { effluentMlH|null, sessions:[{endH,label}]|null }`.
- Rules: cap = `min(HD_LOADING_MAX_MG, localMax ?? Infinity)`, applied to load and maintenance; a capped cell is marked and the footer says which cap ("at most 3 g, Rybak 2020 Rec 11" or "at most <x>, your setting"). CRRT: each cell shows its mg/kg; the table says it applies at 20–25 mL/kg/h; given `effluentMlH`, it states the per-kg rate and whether it lies inside (outside: "the guideline gives no figure for this rate; the dose is not scaled"); "First level within 24 h; later doses and the interval follow levels"; footer: "AUC-targeted work since 2020 supports lower daily maintenance than this table; later doses follow levels." Hybrid: grade B-III shown; "Give the load without waiting for the session to end"; maintenance "after each session ends, or in its final 60–90 min"; "Levels guide every later dose. A level drawn during a session or within 2 h of its end reads falsely low"; "No pre-session target has been validated for hybrid therapy" (and no 15–20 band anywhere on a hybrid screen); with logged sessions, one line per session naming its end time as when the maintenance dose is due.

- [ ] **Step 1: Failing tests 46.21–46.32** (fictional 70 kg unless stated):
  - 46.21 every new constant is read by `harness_constants.cjs` with the table's value.
  - 46.22 CRRT 70 kg: load 1,500 mg (20 mg/kg, raw 1,400) and 1,750 mg (25); maintenance 500 mg (7.5, raw 525) and 750 mg (10, raw 700) q12h; `cap.by === 'guideline'`.
  - 46.23 hybrid 70 kg: loads 1,500 / 1,750 mg; maintenance 1,000 mg (raw 1,050); `intervalH === null`.
  - 46.24 CRRT 140 kg: 25 mg/kg load raw 3,500 → 3,000, `capped`, footer names Rec 11.
  - 46.25 local maximum 2,000: the 140 kg loads are 2,000 and marked "your setting"; with local 4,000 the guideline cap (3,000) applies and is named.
  - 46.26 effluent 1,500 mL/h at 70 kg → "21.4 mL/kg/h" and inside; 2,000 mL/h → "28.6 mL/kg/h", outside, and the dose cells are identical to the no-effluent table (no scaling).
  - 46.27 weight blank, 0 or above the `INPUT_LIMITS` maximum → `rrtReferenceDoses` returns `null` and the screen shows a refusal naming weight; no `NaN` in any output.
  - 46.28 the hybrid HTML contains "B-III", the 2 h sampling sentence and "No pre-session target", and does not match `/15\s*[–-]\s*20 mg\/L/`.
  - 46.29 the CRRT HTML contains every cell's mg/kg and "Rybak 2020, Rec 16".
  - 46.30 `rrtLocalSettings()` with empty storage → `maxDoseMg === null`; blank input keeps a stored value; Clear removes it.
  - 46.31 PD Clear removes `vanco.pd.local` and `pdLocalSettings()` returns its defaults.
  - 46.32 AUC Precision on `crrt` and `hybrid` shows the reference for the AUC column's weight under the refusal.
- [ ] **Step 2: Run; expect fails.**
- [ ] **Step 3: Implement.** One rounding (`roundDose250`) and one cap rule shared by CRRT, hybrid and PD's `pdLoadingDose` if the latter can call it without changing its output (PD tests prove it).
- [ ] **Step 4: Gate.**
- [ ] **Step 5: Browser checks:** both references in both modules by real click; set and clear the local maximum and watch the marked cell; print each and see the disclaimer footer.
- [ ] **Step 6: Mutants:** `CRRT_MAINT_MG_PER_KG_MIN` 7.5 → 10; cap `min` → `max`; effluent check reversed; hybrid band sentence removed.
- [ ] **Step 7: Commit** `feat(rrt): CRRT and hybrid guideline references with a local maximum (D28)`.

### Task 26: One level-interval solver and one goal pick, shared (PD unchanged)

**Files:** Modify `index.html` (`pdInterval` ~9876, `pdAnswer` pick ~10040–10049 and target-peak reading ~10058–10066). Test: SUITE 46; SUITE 41 (PD) must pass unchanged.

**Interfaces:**
- Produces (pure functions, extracted from PD, PD then calls them):
  - `solveIntervalK(anchor:{conc,timeH}, level:{conc,timeH}, doses:[{mg,tinfH,timeH}], vL) -> { k, t12 } | null` — the bisection over `PD_K_SEARCH` that PD uses today.
  - `pickGoalStep(rows:[{mg,mid}], goal:{min,max}) -> { mg, closest } | null` — PD's rule: only when `rows[0].mid < goal.min`; in-goal non-zero steps closest to the goal's middle, ties to the smaller (`< dist - 1e-9`); else the least distance from the goal, `closest: true`.
  - `peakEquationDose(vL, targetPeak, cNow, capMg) -> number` — PD's V × (peak − level) rounded to the nearest 250 mg, 0 when ≤ 0, at most `capMg`.
- No behaviour changes: every PD output is byte-identical.

- [ ] **Step 1: Failing tests 46.33–46.38:**
  - 46.33 `solveIntervalK` recovers k = 0.05 h⁻¹ (V 49 L, 1,000 mg over 1 h at 0 h; levels computed with `predictConc1comp` at 12 h and 36 h with a second 1,000 mg dose at 24 h) to 1e-4 h⁻¹, and the reconstructed second level to 0.05 mg/L.
  - 46.34 with no dose between the levels it equals ln(C1/C2)/Δt to 1e-6.
  - 46.35 `pickGoalStep` cases: an in-goal tie picks the smaller; nothing in goal → `closest: true`; `rows[0].mid` above the goal → `null`.
  - 46.36 `peakEquationDose(56, 25, 11.7, 2000)` = 750; raw ≤ 0 → 0; cap applies.
  - 46.37 source test: `index.html` has exactly one bisection over `PD_K_SEARCH` and exactly one occurrence of the pick comparison `- 1e-9` (fails if a second copy appears).
  - 46.38 the SUITE 41 PD fixtures' `pdAnswer` outputs deep-equal a snapshot taken at `bcee5dd` (store the expected JSON in the test, generated once from the released file and committed).
- [ ] **Step 2: Run; 46.33–46.37 fail (functions missing); 46.38 passes (it is the parity guard).**
- [ ] **Step 3: Extract; point PD at the extracted functions.**
- [ ] **Step 4: Gate; engine parity vs `bcee5dd` = 0.**
- [ ] **Step 5: Mutants:** the tie rule's `- 1e-9` sign flipped; bisection bounds swapped.
- [ ] **Step 6: Commit** `refactor(pd): one interval solver and one goal pick, shared (D28)`.

### Task 27: A level-based CRRT answer (Trough-based · CRRT)

**Files:** Modify `index.html` (new `#section-crrt` beside `#section-pd`; form read/snapshot/apply in the PD pattern ~4549–4720; engine beside `pdAnswer`; results/print beside `pdResultsHTML`). Test: SUITE 46; browser flows.

**Interfaces:**
- Consumes: `solveIntervalK`, `pickGoalStep` (Task 26); `rrtReferenceDoses/HTML`, `rrtLocalSettings` (Task 25); `pdSetGoal`'s goal control (U9: the same presets component, reused); the PD urine bands; the PD volume-basis choices (Bauer 0.70 L/kg, Matzke group III `MATZKE_VD_GROUP3`).
- Produces: `crrtAnswer(input, nowH) -> { state, … }`, pure, with `input = { course:{doses, levels, nowKg}, circuit:[{onH, offH|null}], effluent:[{fromH, mlPerH}], modality:'cvvh'|'cvvhd'|'cvvhdf', urine, vBasis:'bauer'|'matzke3'|null, goal:{min,max}|null, giveAtH, nextDrawH, settings:{maxDoseMg} }`; `readCrrtForm`, `snapshotCrrtForm`, `applyCrrtForm` (saved as `snapshot.crrt`); `crrtResultsHTML`; `const CRRT_NEXT_DRAW_DEFAULT_H = 24;` (PREFERENCE, rule 8: the default time the next level is judged at, so it can change the picked dose; the user can change it; sits beside Rec 16's "within the first 24 h").
- States: `refuse` (weight missing; no goal; no volume basis; no circuit start; a level inside an infusion), `reference` (no level yet: Task 25's CRRT table), `need-level` (no usable interval, or projection not allowed, each with its reason), `dose` (rows and pick), `no-dose` (the next draw is above the goal with no dose).
- Interval flags (an interval is used for a rate only when it carries none of the first four): `circuit-off` (any off time inside it); `effluent-changed`; `modality-changed`; `distribution` (a level within 1 h of an infusion's end; Rybak 2020 Rec 8 places the post-distributional peak 1–2 h after the infusion: reuse an existing constant for this boundary if one exists, else add `POST_DISTRIBUTION_MIN_H = 1` citing Rec 8); `too-short` (levels under `PD_MIN_INTERVAL_H` apart, reused, flag only).
- Projection rule: allowed only when the circuit is running now (the last interval has no `offH`, or `offH` after `nextDrawH`), the effluent and modality now equal those during every used interval, and the whole span from `giveAtH` to `nextDrawH` lies inside the running interval. Otherwise `need-level` with "Draw a level: the circuit <stopped at …|rate changed at …> since the decline was measured."
- Rows: 0 to `min(DOSE_MAX_PER_DOSE_MG, local max)` in 250 mg steps, each with the expected level at `nextDrawH` as a range over `[kMin, kMax]` of the used intervals, V = basis × weight now. **No AUC is reported** (ruling R61). Every answer prints modality and effluent as recorded.

- [ ] **Step 1: Failing tests 46.39–46.52** (fictional 70 kg, Bauer basis, goal 15–20 unless stated):
  - 46.39 no goal → refuse "Choose a goal range"; no basis → refuse naming it; no weight → refuse.
  - 46.40 no level → `reference` carrying the Task 25 CRRT table.
  - 46.41 two clean levels around one dose with the circuit running throughout → `dose`; the rows' `mid` at each step equals a hand computation from the solved k (to 0.05 mg/L); the pick equals `pickGoalStep(rows, goal)`.
  - 46.42 a circuit stop inside the only interval → the interval flagged `circuit-off`, excluded, state `need-level`.
  - 46.43 two intervals, one clean and one `circuit-off` → rates from the clean one only (`rate.n === 1`).
  - 46.44 effluent changed inside an interval → `effluent-changed`, excluded.
  - 46.45 the review-focus case: circuit stopped at now − 1 h after two clean intervals → `need-level`, no rows.
  - 46.46 effluent now differs from the measured intervals → `need-level` naming the change.
  - 46.47 `nextDrawH` beyond a recorded stop → `need-level`.
  - 46.48 a level 0.5 h after an infusion ends → flagged `distribution`, excluded; a level inside an infusion → `refuse`.
  - 46.49 next level above the goal with no dose → `no-dose`, rows still listed.
  - 46.50 rows stop at the local maximum when set (1,500) and at 2,000 otherwise.
  - 46.51 the HTML contains no "AUC" and names the modality and effluent; source test: `crrtAnswer` contains no reference to `scr`, `calcCrCl` or any model prior.
  - 46.52 save/load round-trips `snapshot.crrt`; a profile with `rrt:'crrt'` loads into the CRRT mode.
- [ ] **Step 2: Run; expect fails.**
- [ ] **Step 3: Implement** engine, then form (circuit rows: on date/time, off date/time or blank "still running"; effluent rows: from date/time, mL/h; modality select; urine band; volume basis with nothing preselected; goal; give-at; next draw defaulting to give-at + `CRRT_NEXT_DRAW_DEFAULT_H`), results, chart only if it reuses `pdChartSVG` through a parameter (no second chart renderer), print, Copy summary, the announcement.
- [ ] **Step 4: Gate.**
- [ ] **Step 5: Browser checks:** a full CRRT course by keyboard to a dose answer; stop the circuit and watch it become "Draw a level"; the reference before any level; print; 375 px.
- [ ] **Step 6: Mutants:** the circuit-running check removed from the projection rule; `effluent-changed` not excluding; `CRRT_NEXT_DRAW_DEFAULT_H` 24 → 12 (killed by a test on the default draw time).
- [ ] **Step 7: Commit** `feat(crrt): a level-based CRRT answer on the shared interval solver (D28)`.

### Task 28: A level-based haemodialysis reading from your settings (Trough-based · HD)

**Files:** Modify `index.html` (calc mode `ihd` panel; local settings in the PD pattern). Test: SUITE 46; browser flows.

**Interfaces:**
- Consumes: `peakEquationDose` (Task 26); `rrtLocalSettings` (the local maximum, Task 25); `troughHdNoticeHTML` (kept, shown first); `RRT_NO_SAMPLE_AFTER_SESSION_H` (Task 25).
- Produces: `hdLocalSettings() -> { fractionRemaining|null, targetPeak|null, vdPerKg|null, holdPreMgL|null }` on key `vanco.hd.local`, with save (blank keeps), validation (fraction in (0, 1); the others > 0) and Clear; `hdReading(input) -> { state:'no-settings', missing:[names] } | { state:'refuse', word, html } | { state:'hold', pre, hold } | { state:'dose', post, vL, mg, capped, settings }`, `input = { kg, pre, preAtH, sessionStartH, prevSessionEndH|null, settings, localMaxMg }`; `hdReadingHTML(r)`.
- Rules: `post = pre × fractionRemaining`; `vL = vdPerKg × kg`; `mg = peakEquationDose(vL, targetPeak, post, min(DOSE_MAX_PER_DOSE_MG, localMax))`; `hold` when `pre ≥ holdPreMgL`; refuse a level drawn at or after the session start ("drawn during the session") or within `RRT_NO_SAMPLE_AFTER_SESSION_H` of `prevSessionEndH`; no previous session entered → a caution that the 2 h check could not be made. Every setting value displays with "your setting". The block is titled "Peak-equation reading (your settings)" and says it is not a model's answer and sits beside, never instead of, Goti 2018 · HD.

- [ ] **Step 1: Failing tests 46.53–46.62** (fixture settings, defined only in the test file: fraction 0.65, peak 25, 0.7 L/kg, hold 25; 80 kg):
  - 46.53 empty storage → `no-settings` listing all four; three set → `no-settings` naming the fourth (review focus).
  - 46.54 pre 18 → post 11.7, vL 56, 750 mg.
  - 46.55 pre 5 → post 3.25 → 1,250 mg.
  - 46.56 pre 26 (≥ 25) → `hold`.
  - 46.57 120 kg, peak 40 → capped at 2,000; local maximum 1,500 → 1,500, `capped`.
  - 46.58 a level drawn after the session start → refuse; 1 h after the previous session's end → refuse; 3 h after → `dose`.
  - 46.59 no previous session → `dose` with the caution.
  - 46.60 fraction 1.2 or 0 is not stored and the reading stays `no-settings`.
  - 46.61 source test: with empty storage every field of `hdLocalSettings()` is `null`, and the source text of `hdLocalSettings` and `hdReading` (read via `Function.prototype.toString` on the sandbox functions) contains no numeric literal other than 0 and 1 (the fraction's bounds) — the repository ships no value for any of the four.
  - 46.62 the Trough `ihd` screen shows `troughHdNoticeHTML` before the reading in every state.
- [ ] **Step 2: Run; expect fails.**
- [ ] **Step 3: Implement** settings, form (pre-dialysis level, drawn at, session starts at, previous session ended at), reading, print.
- [ ] **Step 4: Gate.**
- [ ] **Step 5: Browser checks:** with storage empty the screen names what to set; set all four by keyboard and get a reading; Clear returns it to the refusal; the Goti-HD pointer stays above.
- [ ] **Step 6: Mutants:** `≥` → `>` on the hold; the 2 h exclusion removed; fraction applied as removed instead of remaining.
- [ ] **Step 7: Commit** `feat(hd): a peak-equation haemodialysis reading from browser-only settings (D28)`.

### Task 29: Citations, notes and the not-implemented lists

**Files:** Modify `index.html` (HD target comment ~9440; `computeGuidelineDose` source comment; `severeRenalNote` ~9071); `CLAUDE.md`; `README.md`. Test: SUITE 46.

- [ ] **Step 1: Failing tests 46.63–46.66:** the HD target comment names "Rybak 2020 Rec 14" and "C-III" and not Hui as its source (source test on the comment block); the guideline comparison's comment names "Rec 9" and "A-II"; `severeRenalNote` no longer says "CRRT is not modelled here" and instead says "On renal replacement, set Renal replacement" (one line); the README's and `CLAUDE.md`'s "Not implemented" lists each contain: session-clearance HD modelling, intradialytic dosing recommendations, a Bayesian CRRT model, AUC in CRRT, a level-based hybrid answer, SLED/PIRRT dosing beyond the guideline reference, continuous infusion, intraperitoneal dosing, AUC or Bayesian dosing for PD, paediatrics, neonates (a test that reads both files and compares the two sets).
- [ ] **Step 2: Run; expect fails. Step 3: Edit. Step 4: Gate. Step 5: Commit** `docs(rrt): cite Rec 14 and Rec 9, point the severe-renal note at the selector (D28)`.

### Task 30: Release v3.16.0

Same sequence as Release 2's Task 22 (22a for the branch, then the controller's final review, merge, tag and hub release):

- [ ] `APP_VERSION` `'3.16.0'`, the header tag and the print header (SUITE 36; pin 46.N for v3.16.0).
- [ ] D28 in `docs/v3-decisions.md`: what changed and why, finding by finding from the dialysis report's Part 2 gaps 1–3 and smaller findings; the rulings U8–U11 and every controller ruling with its cost if wrong; the verified guideline table above; declined paths (Bayesian CRRT prior, Tong 2026 and Ulldemolins 2026 and why; effluent scaling; a hybrid level-based answer; session-aware HD; the dialyser descriptor; AUC in CRRT); the institutional comparison in general terms only; engine parity vs `bcee5dd` with every difference listed (expected 0).
- [ ] `CLAUDE.md` D28 block; rule 8's list gains `HD_SESSIONS_PER_WEEK_CAUTION` (sourced, not a preference: list under sourced), `CRRT_NEXT_DRAW_DEFAULT_H` (order or time a dose), `POST_DISTRIBUTION_MIN_H` if added; the test table and counts; architecture ranges and size.
- [ ] `README.md` history row (commit "pending"; fill 3.15.0's cell with `bcee5dd`); `DESIGN.md` for the selector, the unavailable mode buttons, the reference tables, the CRRT answer and the HD reading.
- [ ] Full gate plus `TZ=Pacific/Auckland`, comprehensive (3 and 4 only), browser flows all pass, public-repo hygiene grep (local paths, institution names or acronyms, workplace content) with the result reported.
- [ ] Controller: final whole-branch review (Fable), one fix wave, merge to `main`, tag `v3.16.0`, push; hub PR (index.html, `_headers` CSP repinned, `how-to.astro` for the selector, references, CRRT and HD reading, build log) preview-verified; the user runs the merge; then verify live.

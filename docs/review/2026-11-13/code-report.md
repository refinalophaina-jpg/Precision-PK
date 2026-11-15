# Code quality, security, robustness and tests — review of v3.14.0 (HEAD 32988d9)

## Summary (under 400 words)

All suites reproduce as documented: 478/478, 21/21, 49/49, comprehensive scenarios 3 and 4 fail by design, engine parity 0 differences, browser flows 107/107 with 0 console problems. I found one release-blocking defect, and the test suite is materially weaker than its counts suggest.

**Critical (1).** Clicking "Save profile" while an AUC result is stale wipes `bState.result`, even when the save is refused for an empty label. The stale marker then disappears, the old dose stays on screen unmarked, and Print still shows. Reproduced in the browser: SCr edited 1.0 to 3.0, "750 mg" left displayed as current.

**Important (6).**
- A window resize or theme toggle re-renders the whole AUC result: nine open evidence sections closed, the typed Tinkerer dose reverted 1750 to 750, focus was lost.
- A malformed saved profile clears the form, then throws, with no message to the user.
- Rule 6 is broken: Hughes constants are hand-copied into two suites. Doubling `OMEGA2_CL_HUGHES` passes everything.
- Of 62 engine mutations, 20 survived every Node suite, including the CrCl override being ignored, the AUC 700 hard reject removed, and the during-infusion prediction broken.
- Profile handling is effectively untested: load without reset, delete removing every other profile, and a stale fit saved as current all pass Node and all 107 browser flows.
- There is no CI; the tree has no workflows.

**Security.** The picture is better than CLAUDE.md says. `escHtml` is called at about 110 sites, and a hostile-profile probe found no markup injection through any result, refusal or print path. The single unescaped sink is the profile `id` in `data-arg` (attribute injection, reachable only by tampered localStorage). Profiles have no expiry, no schema validation and no "delete all". The CSP is hand-copied into `serve-csp.py`, and the legacy GitHub Pages URL cannot carry a CSP header at all (read, not fetched).

**Performance** is not a problem: 5–13 ms per run, 15 Nelder-Mead fits, no DOM growth over 11 runs.

**Caveats.** The scratch folder was wiped twice and the CSP server went down, so the mutation runner and its result files no longer exist; the figures here are from my transcript. Six browser-mutation runs never reported. Nothing was written to the repo, and no report file was written.

---

# Full report

## What was run

| Check | Result |
|---|---|
| `phase2d_validation.cjs` | 478/478, 1.8 s |
| `phase3_simulation.cjs` | 21/21 |
| `phase4_regimen_validation.cjs` | 49/49 |
| `phase2d_comprehensive_validation.cjs` | scenarios 3 and 4 fail, as designed (exit 1) |
| `engine-parity.cjs --ref edc5b53` | 225 calls, 0 differences |
| `browser-flows.cjs` | 107/107, 0 console problems (before the server went down) |
| In-memory mutation (fs.readFileSync preload; index.html never written) | 62 engine + 20 UI/state + 4 gross mutants |
| Browser-flows against a mutated scratch copy on port 8791 | 6 of 12 completed |
| Two Playwright probes (stale/save, hostile and malformed profiles, fit counts, resize) | completed, except the theme-toggle step |
| Suites under four time zones | 2 failures under Pacific/Auckland |

---

## Critical

### C1. Save profile silently un-marks a stale AUC result
- **Where:** `index.html:14906-14909` (`saveCurrentProfile`), with `formResultShown` at `15907-15913` and `refreshStaleResult` at `15924`.
- **Problem:** when the fit is stale, `saveCurrentProfile` sets `bState.result = null` before it validates the label. `formResultShown('auc')` requires `bState.result`, so the next `refreshStaleResult` (fired by the same click) reads "no result shown", removes the stale line and the `is-stale` class. The previous recommendation stays in the DOM.
- **Evidence (ran, browser):** fictional 60 M, 80 kg, 1 g q12h ×4, one level; result "750 mg". Edited SCr to 3.0: stale line appeared. Clicked Save with an empty label:
  - `bState.result` false, stale lines 0, `is-stale` false;
  - "750 mg" still displayed, SCr field 3.0, Print action visible;
  - `_buildPrintReport()` returned null, and the Tinkerer produced nothing.
  - The same path runs on a successful save.
- **Origin:** introduced in adc223d ("Design track B (WIP, unreviewed)").
- **Change:** delete the wipe. `snapshotBayesForm` (`14845-14858`) already stores a stale fit as `staleFit` and never as `fit`, so the wipe is redundant. Keep the "saved without the fitted PK" message, driven by `snapshot.dirty`.
- **Test:** a browser flow: result, edit SCr, click Save (empty label, then a real label); assert `.stale-line` is still present and `bState.result` is still set. Add a Node test that `saveCurrentProfile` does not assign `bState.result`.
- **Effort:** S.

---

## Important

### I1. Resize or theme toggle destroys in-result state
- **Where:** `index.html:5849-5852` (resize handler), `5883-5898` (`redrawAllCanvases` calls `renderBayesianResults`).
- **Evidence (ran, browser):** viewport 1440 to 1300 px after opening all sections and typing:
  - open `<details>` 9 to 0;
  - `#b-tink-dose` 1750 back to 750; `#b-proj-dose` 1500 back to 750;
  - first-dose editor closed, focus lost from `b-first-date`, scroll moved 0 to 68;
  - 5 + 5 Nelder-Mead fits re-run for a redraw.
  - The theme-toggle step did not complete (the Tinkerer input was hidden after the resize), but it takes the same code path.
- **Not tested:** whether a mobile soft keyboard fires `resize` and so destroys the field being typed in. Worth checking on Android Firefox.
- **Change:** on resize and theme change, redraw canvases only (`refreshProfileGraph`, the strip, the comparison). Do not rebuild the result HTML. If a rebuild is ever needed, snapshot and restore open sections, input values and focus.
- **Test:** browser flow asserting open-section count and Tinkerer value survive `setViewportSize` and the theme button.
- **Effort:** M.

### I2. A malformed profile clears the form, then fails silently
- **Where:** `index.html:14962-14991` (`loadProfileIntoForm`): `resetBayesian()` runs before `s.core` (14973) and `s.demographics.age` (14991) are read. `loadProfiles` (`14713-14720`) checks only that the value is an array.
- **Evidence (ran, browser):**
  - a profile without `demographics`: age 77 cleared to "", TypeError in the console only, profile status empty;
  - a profile without `snapshot`: the same;
  - a non-numeric `savedAt`: the list shows "Invalid Date";
  - truncated JSON in the key: the next save overwrote the whole store with no warning.
- **Change:** validate each entry on read (id pattern, string label, numeric `savedAt`, object snapshot with a `demographics` object and arrays); skip or flag invalid ones. Validate before `resetBayesian()`. On a JSON parse failure, keep the raw text under a backup key and tell the user.
- **Test:** Node test feeding `loadProfileIntoForm` the three shapes above; expect no throw, the form untouched and a status message.
- **Effort:** S–M.

### I3. Rule 6 is violated: Hughes constants are hand-copied into two suites
- **Where:** `phase2d_validation.cjs:109-115` ("Hughes constants mirrored from calculator"); `phase3_simulation.cjs:102`. `harness_constants.cjs` extracts only the four Hughes typical values.
- **Evidence (ran, mutation):** against all four Node suites, these survived:
  - `OMEGA2_CL_HUGHES` 0.0602 to 0.1204, and to 0.602 (×10);
  - `OMEGA2_VP_HUGHES` 0.4974 to 0.0497;
  - `SIGMA_PROP_HUGHES` 0.156 to 0.356;
  - `SIGMA_ADD_HUGHES` 1.2 to 3.2.
  - Only `HUGHES_CRCL_EXP` and `HUGHES_TVCL` were caught.
- **Change:** add the six names to `harness_constants.cjs`; delete the copies; add a Hughes MAP fixture whose posterior depends on omega and sigma.
- **Test:** re-run the five mutations; each must fail.
- **Effort:** S.

### I4. Engine mutations that no Node suite detects
62 mutations were run against phase2d, phase3, phase4 and parity. Phase 3 and phase 4 killed none of them. Twenty survived everything:

| Mutation | Location |
|---|---|
| CrCl manual override ignored by `calcCrCl` | 6184 |
| AUC₂₄ > 700 hard reject removed | `evalRegimen`, ~10436 |
| Danger trough flag moved from ≥ 20 to > 22 | `evalRegimen` |
| Sub-MIC trough flag removed | `evalRegimen` |
| During-infusion concentration computed as end-of-infusion | `predictConc1comp`, 9753 |
| Goti SCr floor `age > 65` changed to `>= 65` | `applyScrPolicy`, 6163 |
| Unknown sex takes the male IBW base | 6037 |
| Continue test `<` changed to `<=` at the margin | `regimenDecision` |
| "Keep in-range candidates" filter removed | `regimenDecision` |
| Danger troughs not set aside in the lattice | `regimenDecision` |
| Unsafe current regimen kept when nothing is admissible | `regimenDecision` |
| A single charted dose counts as a current regimen | `currentRegimenOf` |
| Daily-dose tie-break removed from the change sort | `regimenDecision` |
| KDIGO 0.3 mg/dL rise read over 7 days, not 48 h | `kdigoStage`, 11809 |
| Trough AKI thresholds 1.5×/0.3 changed to 2.0×/0.5 | `checkAKI`, 4902 |
| Guideline dose cap 2500 changed to 4000 | `computeGuidelineDose`, 11981 |
| PD local maximum raises the 3,000 mg cap | `pdLoadingDose`, 9232 |
| SCr input minimum 0.1 changed to 0.01 | `INPUT_LIMITS` |
| Hughes omega Vp ×0.1 | 10196 |
| Hughes sigma prop 0.156 to 0.356 | 10197 |

A further six survive phase2d and are caught only by parity, which per CLAUDE.md "never reaches" D25 cases and is skipped for clinical changes: AdjBW factor 0.4 to 0.5; IBW 2.3 to 2.5 kg/in; AUC absolute max 700 to 800; `TROUGH_WARN_MGL` 15 to 18; the non-danger tie filter; the guideline interval thresholds.

Cockcroft-Gault itself (72, 140, 0.85) is caught only by three tests in suite 39, the D21 weight-spread note. There is no direct `calcCrCl` or `calcIBW` value test.

- **Change:** add direct value tests for `calcCrClRaw`, `calcCrCl` with the override on, `calcIBW`, `calcAdjBW`, `applyScrPolicy` at age 65 and 66, `predictConc1comp` mid-infusion, `kdigoStage` with a 0.3 rise at 60 h, `checkAKI`, `computeGuidelineDose`, `pdLoadingDose` with a local maximum above 3,000, and one `evalRegimen` case per hard reject and flag. Add D25 boundary cases for the six surviving decision branches.
- **Test:** the mutation list above is the acceptance test.
- **Effort:** M.

### I5. Profile and state handling is untested in both tiers
- **Evidence (ran):** these passed phase2d and all 107 browser flows:
  - `loadProfileIntoForm` without `resetBayesian()` (the previous patient's rows remain);
  - `deleteProfile` filter inverted (deletes every other profile);
  - a stale fit saved as `fit`;
  - the CrCl override range check removed;
  - the fingerprint reduced to `doses.length`, so a changed dose amount or time no longer marks the result stale.
- **Evidence (ran, phase2d only; browser run lost):** profile model whitelist removed; profile label unescaped; Print action a no-op; Undo a no-op; PD AM-labs time unvalidated; fingerprint target and MIC made inert.
- **Change:** a browser flow for save, load into a dirty form, delete one of three, and Undo. A fingerprint behaviour test that edits a dose and expects stale.
- **Effort:** M.

### I6. No CI
- **Where:** `.github/` holds only `copilot-instructions.md` (ran `ls`).
- **Problem:** every suite is run by hand, and a single-file app is deployed straight from the branch.
- **Change:** a workflow that runs the four Node suites and the syntax check on push. Pin the expected test count (I7).
- **Effort:** S.

### I7. The suite cannot notice tests that stop running
- **Where:** `phase2d_validation.cjs`, final summary: exits 0 when `fail === 0`, whatever the total.
- **Problem:** a block skipped by a guard lowers the total and still prints "All tests passed" (read).
- **Change:** assert `pass + fail === 478` (a stated number, bumped with each release).
- **Effort:** S.

---

## Minor

**M1. Profile id is not escaped in `data-arg`.** `index.html:~15081-15082`. A tampered id `p1" data-xss="id` produced an injected attribute on both buttons (ran). Script execution is blocked by the CSP; the practical risk is an injected `data-onclick`. Use `escHtml(p.id)` and validate the id against `/^p_[a-z0-9]+$/` on read. S.

**M2. A second HTML escaper.** `renderProfileList` defines its own `esc` at `15064`, identical to `escHtml` (`15095`). Rule 2. S.

**M3. `LN2` is 0.693 and `halfLife()` is dead.** `5905-5907`. The literal `0.693` is repeated at `6943, 7046, 7165, 7476, 7477, 7567, 7745`, while `Math.LN2` is used 8 times and `Math.log(2)` 6 times elsewhere. Three spellings of one constant, differing by 0.02%. Use `Math.LN2` and one helper. S.

**M4. Two AKI rules.** `checkAKI` (`4887-4913`, literals 1.5 and 0.3, no time window, `parseFloat(...) || 0`) and `kdigoStage` (`11803`, named constants, 48 h and 7 d windows). Rule 2; cross-area for the clinical reviewer. Also a typo, `critera`. M.

**M5. The 250 mg step and the dose ceilings are repeated as literals.**
- `250` at `4994, 7741, 7753, 10392-10400, 10457, 11981` beside `MATRIX_DOSE_STEP`.
- `MATRIX_DOSE_MAX = 2000` at `10829` duplicates `DOSE_MAX_PER_DOSE_MG`.
- Ceilings disagree: 2000 (optimizer), 2500 (`computeGuidelineDose`, `11981`, unsourced), 4000 (`findOptimalDose`, `6477`, and `INPUT_LIMITS`), 4500 (`#b-tink-dose` max, `14028`).
- The CrCl thresholds 90/50/30/15 in `computeGuidelineDose` carry no citation (rule 1).

**M6. Dead code.**
- `extrapolateTrough` (`6368`) and `halfLife` (`5907`) are never called.
- `__ACT` entries `k50` (`4163`, targets `c-tinf`, a removed Continue Course id) and `k53-k56` with `showResultTab` (`4164-4167`, `5260`) have no markup; the `.result-tab*` CSS at `1223-1232` is dead too.
- `HD_PREDIALYSIS_MID_FOR_TEST` (`8948`) and `lastFormErrors` (`15802`) are test-only hooks shipped in production.
- There is an empty "CONTINUE COURSE" banner above `escHtml`.

**M7. CLAUDE.md statements that are now false.**
- "~13,900 lines / ~750 KB": the file is 16,671 lines and 964,900 bytes.
- The architecture table says the script starts at 3,706; it starts at 4,082.
- "most sites currently do not" escape: about 110 `escHtml` calls exist and I found one gap.
- The radius table still lists "the print FAB".
- README line 50 says "~9,000 lines".

**M8. The harness CSP is a hand copy.** `docs/audit/serve-csp.py:19-24`. The production policy lives in another repository, so "the EXACT production CSP" can drift unnoticed. The server also binds all interfaces and serves the whole repo, `.git` included (line 30). Bind `127.0.0.1` and compare the header with the deployed one in the release check. S.

**M9. The legacy GitHub Pages URL** in README line 16 "still resolves". Pages cannot send a CSP header and `index.html` has no meta CSP, so that copy runs with no policy and shares its origin's localStorage with every other Pages project of the account (read; not fetched). Redirect it, or add a meta CSP.

**M10. Profile privacy.** `ainadara.profiles.v1` (`14710`).
- No expiry: `savedAt` is displayed only.
- No "delete all" and no size cap.
- Any page on the same origin can read the key.
- A warning line exists at `3737` and `4039`.
- A profile holds age, sex, weight, height, SCr, timed doses and levels: re-identifying in context.
- Suggest an age badge with a prompt to delete after N days, and a "Delete all profiles" action. S–M.

**M11. `__ACT` lookup accepts inherited keys.** `~4326`: `__ACT[attr]` without `hasOwnProperty`, so `data-onclick="constructor"` calls `Object` (harmless today; read). Use `Object.hasOwn`. S.

**M12. Handler failures are invisible to the user.** `4328-4331` logs to the console only. I2 is one consequence. Route through a visible status line. S.

**M13. Copy summary** (`5339-5346`).
- A second click within 1.6 s captures "Copied" as the old label, which then sticks (read).
- The copied text carries no stale marker, while the printed report does.

**M14. `v()` survives.** `5265`: `parseFloat(...) || 0`, the pattern the validation layer was written to remove, still used by `renderAmputation` and others (read).

**M15. Time-zone-dependent tests.** `phase2d_validation.cjs:2558-2577` parses `2026-09-25..27` as local time. Under `TZ=Pacific/Auckland` two tests fail (ran), because the fixture crosses the New Zealand clock change. Build fixtures from numeric hours. The browser flow's "12 h after dose" read-back will likewise fail on a clock-change day (read). The app itself gives no notice when a course spans a clock change (enhancement).

**M16. `harness_constants.num()`** uses a case-insensitive regex and takes the first match anywhere in the file, comments included (`harness_constants.cjs:~33`). Anchor to the line start and drop the `i` flag. S.

**M17. A refused save discards a pending Undo.** `clearUndo()` at `14913` runs before the label check (read).

**M18. `firstDosePlan`** has an unbounded `for (let k = 0; ; k++)` (`~9652`) that never ends if `firstH` is NaN. Inputs are validated upstream, but a bound costs nothing (read).

---

## Enhancement

- **E1.** Split `renderBayesianResults` (about 945 lines, `13187`), `drawProfileGraph` (426), `runBayesian` (371) and `calculate` (366) into pure "build model" and "write DOM" halves. This is what would make I1 and I5 cheap to test.
- **E2.** 154 of 389 top-level functions are never named in any suite; 79 of 476 phase2d tests only run a regex over source text (heuristic count). Prefer behaviour tests on the pure half from E1.
- **E3.** Keep the mutation list (I3, I4, I5) as a script under `docs/audit/` and run it before each clinical release. The whole engine set took about six minutes.
- **E4.** Performance needs no work: 5–13 ms per `runBayesian`, 10 + 5 Nelder-Mead fits, 44 `evalRegimen` calls, DOM steady at 1,553 nodes over 11 runs; one keystroke costs three fingerprints.

---

## innerHTML / escHtml sink inventory

Reachability scale:
- **None:** constants or engine numbers only.
- **Validated:** user text that passes a strict pattern before it can reach the sink.
- **Storage:** reachable only by tampering with localStorage.

A hostile profile with a payload in every string field produced no injected element in any results, refusal or print path, in either module or any Trough mode (ran).

| Lines | Sink | What is interpolated | Escaped | Reachability |
|---|---|---|---|---|
| 4235 | CrCl override note | `toFixed` number | n/a | None |
| 4276–4301 | amputation readout and note | constant labels, numbers | `escHtml` on labels | None |
| 4453–4469 | level timing hints | numbers | via `cautionHTML` | None |
| 4517 | mode hint | constant table | n/a | None |
| 4537–4548 | PD row templates | row counter, `localTimeStr(now)` | n/a | None |
| 4869, 4879 | PD results and chart | engine output, `fmtClock`, cycler clock, flags | `escHtml` throughout 4728–4862 | Validated (`isClock24`) |
| 4913 | AKI banner | `parseFloat` numbers | n/a | None |
| 5048, 5158–5175 | two-level and random-level warnings | numbers | via `cautionHTML` | None |
| 6704, 6777, 6833 | weight hint, cystatin C box, advisories | constants, numbers | `escHtml` / `cautionHTML` | None |
| 6856 | model info box | constant table | n/a | None |
| 6870, 11999 | HD and PD refusal notices | constants | n/a | None |
| 7431, 7537, 7650 | Trough results (three modes) | engine numbers, model names, summaries | `escHtml` at 7242–7401 | None |
| 7735, 7763, 7811 | PRN and Trough tinker results | numbers, `targetPeak` | `escHtml` at 16391–16406 | None |
| 8170 | Undo line | message containing the profile label | `escHtml` | Validated |
| 8195 | Undo restore (`tb.innerHTML = html`) | HTML snapshotted from the live DOM | not re-escaped | None (same trust as the DOM it copied) |
| 8519–8622, 11679–11699 | dose, level, HD and SCr row templates | counters, carried dose (`escHtml` at 8512–8513), `localTimeStr` | yes | None |
| 11836 | SCr trend | numbers | n/a | None |
| 11973, 14525 | "suggested" and "trying" tags | constants | n/a | None |
| 13142 | course strip SVG | coordinates | n/a | None |
| 13215, 15630 | render backstops | constants | n/a | None |
| 14113 | AUC results | engine output, labels, flags, narrative | `escHtml` at 13298–14101 | None |
| 14430 | comparison legend | series label | `escHtml` | None |
| 14597 | Bayes tinker result | numbers, summary | `escHtml` at 14630 | None |
| 15061, 15087 | profile list | label; **profile id in `data-arg`** | label yes, **id no** | **Storage (M1)** |
| 15498, 16437–16527 | print report | demographics, model, notes | `escHtml` at 15193–15432 and 16437–16527 | Validated |
| 15739, 15779 | refusal summaries | messages echoing raw input | `escHtml` | Validated (payload shown as text, ran) |
| 15881–15884, 15932 | queued cautions, stale line | constants, scope key | `escHtml` at 15878 | None |
| 16537–16550 | print copy of the Trough panel | the live panel's own HTML | not re-escaped | None |

Other storage and output paths:
- `vanco.pd.local`: numbers coerced, AM-labs time checked by `isClock24` (`4572-4576`); always applied as a minimum with the sourced cap.
- `ainadara_theme`: compared against fixed values.
- Clipboard: write-only.
- No `eval`, `document.write`, `window.open` or network calls.

---

## Tests that cannot fail on what they name

Demonstrated by mutation (the behaviour was broken, the named test still passed):

| Test | Why it cannot fail |
|---|---|
| "a changed target or MIC marks the fit as stale" (`phase2d:2769`) | Checks only that the strings `b-auc-target` and `b-mic` appear in the function text. Setting both to `''` with the names left in a comment passes. |
| "No inline on* event-handler attributes anywhere in the body" (`phase2d:1974`) | The regex requires a double quote after `=`. An unquoted `onclick=x()` passes. |
| "stale-fit fingerprint covers serial SCr and the regimen" | Covers those two only: a fingerprint of `doses.length` passes, so a changed dose or time is not seen as stale. |
| Suite 8 Hughes tests, and phase 3 Hughes simulations | Assert against hand-copied omega and sigma (I3). |
| "Both save/load helpers exist and are wired to the shared class"; "Saving from either module is not blocked…"; "The patient core maps onto BOTH modules" | Source regex only. Load without reset, delete-all-others and stale-fit-as-fit all pass. |
| "the Bayesian module range-checks demographics"; "there is still exactly one limits table" | The CrCl override range check can be removed, and SCr minimum lowered to 0.01, without a failure. |
| Suite 43 (D25), for six branches | The six `regimenDecision` and `currentRegimenOf` mutations listed in I4 pass. |
| Phase 4 (49 tests) | Killed none of the 66 mutations, including two aimed at regimen detection's consumer. It tests `detectRegimen` in isolation only. |
| Engine parity | By design blind to D25 cases, and to the override, AKI, PD-cap and hard-reject mutations above. |

By construction (read, not mutated):
- "a refused recommendation cannot leave the previous run on screen" (`2750`): asserts the textual order of two string literals within 150,000 characters.
- "elapsedHours is the only elapsed-time helper" (`2171`): asserts the name appears within 2,600 characters of three function starts.
- About 79 phase2d tests that only run a regex over `index.html` or a function's `toString()`.

Mutations the suites did catch, for balance: per-dose and daily caps, band edges 400/600, `TROUGH_HIGH_MGL`, interval preference, `autoTinf`, `CONTINUE_MARGIN_DOTS` (both directions), the never-worse filter, the twin filter, transition and alternating regimens, the dot quantile width, the reversed-interval flag, `isClock24`, Buelga sigma, Goti omega, HD tie and hold, PD load cap, KDIGO stage 3, `escHtml` made identity (two print tests), sex defaulting to male, stale detection off, half-typed times, silent redraw.

## Not completed

- Browser-flow runs for six mutants (Print no-op, label unescaped, during-infusion, AUC hard reject, override ignored, Undo no-op) were lost when the scratch folder was wiped; their Node results stand.
- The theme-toggle half of I1 was not observed directly.
- The scratch scripts (mutation preload and runner, both probes) no longer exist; each is under 60 lines and would need re-creating in `reports/review-2026-11-13/code-work/`.

# Return format — read this before writing findings

Return **exactly one file**: `findings.json`. Nothing else is read. Prose in
other files is discarded, so put every argument inside the JSON.

Each finding is **re-executed and re-checked** by `verify_findings.cjs` against
the shipped `index.html`. That is the whole point of the format: a finding that
cannot be run cannot be trusted, and a finding whose reproduction contradicts its
own claim is worse than no finding.

Run the validator yourself before sending:

```bash
node codex-review/verify_findings.cjs findings.json
```

It exits non-zero if anything fails. **Do not send a package that does not pass.**

## Shape

```jsonc
{
  "meta": {
    "reviewer": "codex",
    "date": "2026-09-05",
    "reviewed_commit": "<git rev-parse HEAD of the tree you reviewed>",
    "suites_run": { "phase2d": "68/68", "phase3": "21/21", "phase4": "40/40" }
  },
  "findings": [ /* see below */ ]
}
```

### One finding

```jsonc
{
  "id": "F-001",                       // unique, stable
  "dimension": "math",                 // math|clinical|code|ui|test|git|docs|security
  "severity": "high",                  // critical|high|medium|low|info
  "confidence": "high",                // high|medium|low
  "title": "One line, specific",
  "location": [{ "file": "index.html", "line": 3421, "symbol": "calcCrCl" }],

  "claim": "One falsifiable sentence. Not 'this could be improved'.",

  "impact": {
    "clinical": "What reaches the patient if this is real.",
    "magnitude": "Quantified: '+33% prior CL for ages 61-65 with SCr<1.0'."
  },

  "evidence": {
    // AT LEAST ONE of `reproduction` or `citation`. Both is better.
    // Behavioural claims REQUIRE reproduction. Clinical/math claims REQUIRE citation.

    "reproduction": {
      // Runs in Node with the shipped engine already loaded (see below).
      // MUST finish under 20 s and print ONE line of JSON to stdout.
      "script": "const r = calcCrCl(63,'F',0.5,70); print({ crcl: +r.toFixed(2) });",
      "expect":  { "crcl": 127.27 },     // deep-equality, numbers to `tolerance`
      "tolerance": 0.01
    },

    "citation": {
      "source": "Goti 2018, Ther Drug Monit 40(2):212-221",
      "locator": "Table 2, row 'CL (L/h)'",
      "quote": "4.5 (1.8)",              // VERBATIM, <= 25 words
      "file": "Literature/goti2018.pdf"  // must exist; quote is grepped from it
    }
  },

  "disconfirming_test": "What result would prove this finding WRONG.",

  "proposed_fix": {
    "summary": "What to change and why.",
    "diff": "optional unified diff against index.html",
    "risk": "What this fix could break."
  }
}
```

## Reproduction environment

Your `script` runs with the shipped engine already in scope — every top-level
`function` in `index.html` is callable directly (`calcCrCl`, `calcIBW`,
`buelgaPopPK`, `gotiPopPK`, `hughesPopPK`, `detectRegimen`, `interpretLevelTiming`,
`predictConc1comp`, `predictConc2comp`, `burtonObjective`, `nelderMead2D`,
`calcPeakTrough`, `calcAUC`, …).

Also provided:

| Helper | Purpose |
|---|---|
| `print(obj)` | Emit your result. Call it **exactly once**. |
| `CONST` | Model constants parsed from source (`CONST.OMEGA2_CL_GOTI`, …) |
| `setField(id, value)` | Set a DOM stub field, for functions that read inputs |
| `SRC` | The raw `index.html` text, for static/structural claims |

**Not available:** `require`, network, filesystem, `window`, a real DOM,
`localStorage`. `const`/`let` declared inside the file are **not** reachable —
use `CONST` for those. This is the same `vm` limitation the project's own
harness documents.

## Rules that cause rejection

1. `expect` does not match what `script` prints (this is the main gate).
2. `script` throws, hangs past 20 s, or calls `print` zero or 2+ times.
3. A `citation.quote` that is not found in `citation.file`.
4. `citation.file` missing from `Literature/`.
5. A `dimension` of `math` or `clinical` with no `citation`.
6. Missing `disconfirming_test`, `claim`, or `impact.magnitude`.
7. A `proposed_fix.diff` that does not apply cleanly.
8. Proposing a dependency, build step, or framework.
9. Re-reporting a resolved item from `BRIEF.md` without new evidence.

## What earns a high rating

- A number that is **wrong against a cited source**, with the patient impact quantified.
- A **reachable** input that produces a clinically misleading output.
- A test that **passes while the behaviour is wrong** (tautological or bug-asserting).
- A place where the tool is **silent when it should warn**.
- A documented decision whose **reasoning does not survive scrutiny** — argue it.

## What wastes the slot

Style preferences, "consider adding", speculative refactors, restating the audit,
anything unquantified, and anything you could not be shown to be wrong about.

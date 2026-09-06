# Codex review package

Send this whole folder, plus the files listed in `context/MANIFEST.md`.

## For the reviewer

1. Read `BRIEF.md` — what the tool is, what is already audited, what to look at.
2. Read `RETURN-FORMAT.md` — the required shape of `findings.json`.
3. Produce `findings.json`.
4. **Run `node codex-review/verify_findings.cjs findings.json` and fix anything it rejects.**
5. Return `findings.json`. Nothing else is read.

## Why the format is strict

Every finding is re-executed against the shipped engine and every quote is
grepped out of the cited PDF. This is not ceremony — it is the only way a claim
about a dosing calculator can be accepted without taking it on trust. A finding
that cannot be reproduced cannot be acted on safely, and a fabricated citation is
worse than silence.

The validator is deliberately unkind: it prints what your script actually
produced next to what you claimed it would. Use it before sending.

## For whoever receives the results

```bash
node codex-review/verify_findings.cjs findings.json          # human-readable
node codex-review/verify_findings.cjs findings.json --json   # machine-readable
```

Exit 0 = every finding verified. Exit 1 = at least one rejected; the rejects are
listed with the reason and the observed value.

Only `PASS` findings should be implemented, and each still needs a judgement call
on whether the change is genuinely an improvement — verification proves a claim
is *true*, not that acting on it is *wise*.

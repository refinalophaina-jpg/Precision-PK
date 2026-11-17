# PD parity guard (phase2d test 46.44)

Test 46.44 holds a digest per call for every `pdAnswer` and `pdIntervals` call SUITE 41 makes (55), plus three
hand-written calls for paths SUITE 41 never reaches; `fixtures58.json` is the same 58 calls, instants written as
`"@<day>|HH:MM"` (SUITE 41's own `H(day, 'HH:MM')`, June 2026, local wall clock). To regenerate the expected digests,
extract the release file and replay: `git show bcee5dd:index.html > /some/scratch/v3.15.0.html`, then
`TZ=America/Chicago node docs/audit/pd-parity/replay.cjs . /some/scratch/v3.15.0.html` (optional third and fourth
arguments: another fixtures file, and the number of significant digits, default 9, ruling R87). It prints one
`["summary","digest"]` line per fixture, in order, ready to paste into `PD_PARITY_EXPECTED46`; replaying
`index.html` instead shows which call moved. The zone is pinned because SUITE 41 builds its instants on the local
clock. `capture.cjs` re-records SUITE 41's calls from the harness (`TZ=America/Chicago node capture.cjs . index.html
cap.json`) and `encode.cjs cap.json` turns them into fixture JSON; the three extra fixtures are appended by hand.
`load.cjs` loads the phase2d sandbox for any `index.html` without running a test. Fictional inputs only.

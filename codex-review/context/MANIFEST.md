# What to send

## Required — the code and its tests
| Path | Why |
|---|---|
| `index.html` | The entire application |
| `harness_constants.cjs` | Parses model constants out of the source |
| `phase2d_validation.cjs` | Primary suite (68) |
| `phase3_simulation.cjs` | Simulation suite (21) |
| `phase4_regimen_validation.cjs` | Regimen detection (40) |
| `phase2d_comprehensive_validation.cjs` | 10,475-patient suite |

## Required — the record
| Path | Why |
|---|---|
| `CLAUDE.md` | Standing rules the code is held to |
| `README.md` | Status, layout, what is not implemented |
| `docs/audit-2026-09.md` | Findings already resolved — do not re-report |
| `docs/validation-threshold-decisions.md` | Accept/reject record for failing thresholds |
| `docs/audit/*.cjs` | Probe scripts reproducing each prior finding |

## Required — the sources
Send the whole `Literature/` folder (one directory up from the app). Citations
are verified against these files by `pdftotext`, so a review cannot cite a paper
that is not present.

Contains: Goti 2018 + the 2019 erratum note, Buelga 2005, Hughes 2024,
Matzke 1984, Fewel 2021, Duong 2024 (eight-model evaluation), Broeker 2019,
plus `Sources.md` recording provenance for each.

## Deliberately NOT sent
- `archive/` — a superseded build and an abandoned React branch. Not under review.
- Reference PDFs beyond `Literature/` (DoseMeRx, protocols) — third-party, and
  not needed to check the maths.

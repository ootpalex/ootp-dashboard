# Multi-League Setup

How leagues are organized, when regressions are shared vs. recalculated, and how to add a new OOTP version.

## Directory layout

Each league lives in `leagues/<slug>/`, where the slug is a short abbreviation you choose (`BLM`, `SSB`, `TSB`, etc.). The slug is used as a folder name and as a localStorage namespace prefix on the frontend, so URL-safe characters are best.

```
leagues/
├── .example/              # Template — copy this to start a new league manually
├── BLM/
│   ├── league.json        # team, statsplus URL, OOTP version, blend weights
│   ├── csv/
│   │   ├── players/       # org.csv (+ optional intl.csv, freeagents.csv, iafa.csv, draftYYYY.csv)
│   │   └── ballparks.csv
│   ├── metadata/          # optional per-league metadata CSVs (flat = one season,
│   │                      #   or year subfolders 2026/ 2025/ … to pool seasons)
│   └── output/
│       └── dashboard.json.gz
└── SSB/                   # second league, mirror structure
    └── ...
```

After each pipeline run, `app/public/data/leagues.json` is rewritten as an index of all configured leagues. The SPA reads this index on startup and offers a league dropdown in the sidebar when more than one league is present.

## Per-league config (`league.json`)

Each league's `league.json` holds its identity and pipeline-tuning fields:

| Field | Default | Purpose |
|---|---|---|
| `slug`, `leagueName`, `ootpVersion` | — | Identity; `ootpVersion` selects the regression calibration |
| `team` | `"Nashville Stars"` | Your organization (drives park factors + roster views) |
| `statsplusUrl` | `""` | League page URL for fetching contract data |
| `parkFactorMode`, `homeFraction` | `"team"`, `0.5` | Park-factor application |
| `relativeBlend`, `osaBlend`, `scoutWeight`, `osaWeight` | `true`, `true`, `0.8`, `0.2` | Rating-blend toggles for AAA/AA and OSA companion CSVs |
| `seasonWeights` | `[3, 2, 1]` | Recency weights (newest-first) for blending year-subfolder metadata seasons — see [Metadata seasons](#metadata-seasons) |

Omitted fields fall back to these defaults, so an older `league.json` keeps working unchanged.

### Metadata seasons

A league's `metadata/` directory is normally a flat set of CSVs representing **one** season.
To smooth single-season noise, you can instead keep **year-named subfolders** — `metadata/2026/`,
`metadata/2025/`, `metadata/2024/` — each containing the complete CSV set for that season. The
pipeline computes each season's calibration constants independently and blends them with the
`seasonWeights` recency weights (newest-first; the newest gets the first weight, a gap year
leaves its slot unused, seasons beyond the weight window are dropped). If no year subfolders
exist, the flat `metadata/` is used as a single season exactly as before.

## What's shared vs. per-league

| Resource | Scope | Why |
|---|---|---|
| Player CSVs | Per league | Each league has its own player population |
| `ballparks.csv` | Per league | Park factors are league-specific (custom parks, expansion teams) |
| Metadata CSVs | Per league | Computed from each league's actual ratings |
| `dashboard.json.gz` | Per league | Each league produces its own output |
| Regressions (`data/regressions/ootp<version>/`) | Per OOTP version | Calibrated against the OOTP simulator's mechanics, which are version-specific |
| Regression coefficients | Per OOTP version | **26:** computed from that version's sims at build time (auto-fit); `data_points.py` holds the no-sims fallback. **27:** hardcoded piecewise constants in `data_points.py` Section 1b — the auto-fit cannot represent the 27 multi-knot calibration (see "Adding a new OOTP version") |

The frontend namespaces these localStorage keys per league: `ssb_my_team`, `ssb_game_date`, `league_settings`, `ssb_roster_plan`, `ssb_roster_plan_order`, `ssb_roster_r5_threshold`, `ssb_iafa_signed`, and `prospect_board_settings`. Each league remembers its own selected team, game date, roster moves, and so on.

`ssb_dev_curve_settings` (FV curve calibration) stays global because it represents a tuning philosophy, not league data.

## Adding a second league on the same OOTP version

Two ways:

**Interactive:** run `python3 run.py`, pick `+ Add a new league` from the menu, answer the prompts.

**Manual:**
1. Copy `leagues/.example/` to `leagues/<new-slug>/`.
2. Edit `leagues/<new-slug>/league.json` — set `slug`, `leagueName`, `team`, `statsplusUrl`, etc.
3. Drop your OOTP exports into `leagues/<new-slug>/csv/players/` and `leagues/<new-slug>/csv/ballparks.csv`.
4. Run `python3 run.py --league <new-slug>`.

Regression compute is cached by input-file hash (`data/regressions/ootp<version>/.regressions_cache.json`). The first league on a given OOTP version pays the regression cost; subsequent same-version leagues reuse the cached coefficients automatically.

## Adding a new OOTP version

OOTP simulator mechanics change between major versions. New mechanics produce different rating-to-stat distributions, which means coefficients calibrated against OOTP 26 sim data don't apply to OOTP 27. **The two shipped versions use different coefficient mechanisms:**

### OOTP 26 — auto-fit from calibration sims

1. Calibration sim CSVs live in `data/regressions/ootp26/` (files listed in `model/src/validation.py` `_REQUIRED_REGRESSION_CSVS`: `hitters_ratings.csv`, `pitchers_ratings.csv`, `batting/pitching/fielding_sim_1..5.csv`, optional `calibration/`). See [`model/docs/pipelines/REGRESSIONS_IMPLEMENTATION.md`](../model/docs/pipelines/REGRESSIONS_IMPLEMENTATION.md).
2. At build time `export._detect_metadata` calls `generate_regression_coefficients(regressions_dir)`, which fits all hitting/pitching/fielding coefficients from the sims (single-segment, split at rating 50) and injects them via `compose_data_points`; cached in `.regressions_cache.json`. The hardcoded 26 values in `data_points.py` are the **no-sims fallback**.

### OOTP 27 — hardcoded piecewise constants (NOT the auto-fit)

The OOTP-27 calibration is **multi-knot piecewise-linear** (up to 4 knots, off-50 breaks, flat-end clamps, two placement regimes) — a structure the single-segment auto-fit **cannot represent**. So 27 does not use `data/regressions/ootp27/` sims at build time at all (decision PD3b). Instead:

- The constants live in `model/src/data_points.py` **Section 1b** (`DEFAULT_HITTING/PITCHING/FIELDING_REG_COEFFS_27`, built from `PiecewiseCoeffs`), transcribed from the test-league calibration (`ootp27-conversion/test-league-design/outputs/KNOT_DECISIONS_27.md` in the research workspace). Provenance + audit: [`AUDIT_27.md`](AUDIT_27.md).
- A league with `ootpVersion: "27"` in `league.json` routes to these constants in `export._detect_metadata` (threaded via `settings.ootp_version`); the auto-fit is bypassed. Sim CSVs in `data/regressions/ootp27/`, if present, are cross-check material only — never the build.
- Guarded by `model/tests/test_regressions_27.py` (constants vs the calibration tables, evaluator continuity/anchor, 26-dispatch no-op proofs, end-to-end spot checks).

**For a future version (28+):** decide first which mechanism fits. If the new calibration is representable by the single-segment fit, follow the 26 path (drop sims + build). If it is knotted/clamped like 27, add a `DEFAULT_*_REG_COEFFS_28` constants section + a routing branch, following the 27 pattern.

## Sharing data between leagues on different OOTP versions

There's no automatic sharing. Same-version leagues share their coefficient source transparently (26: the cached sims fit; 27: the constants). Leagues on different versions are fully independent.

## Common pitfalls

- **Slug collision** — two leagues can't share a slug. Pick something unique per league (typically the league's chat-shorthand: `BLM`, `SSB`, `TSB`, `MABL`).
- **Wrong `ootpVersion`** — if `league.json` says `"26"` but your data was exported from OOTP 27, the pipeline will use OOTP 26 coefficients and produce nonsensical evaluations. The `ootpVersion` field is the source of truth for which calibration applies.
- **Ballparks file copied from another league** — the headline error from `validation.py`. Your 30-team league's ballparks file used in a 28-team league will surface as a "Ballpark/team mismatch" error naming the offending teams. Always re-export `ballparks.csv` per league.
- **`leagues/.example/` accidentally treated as a real league** — folders starting with `.` are skipped by both the menu in `run.py` and the validation pipeline. Don't remove the leading `.`.

## Where things end up

After a successful build of league `<slug>`:

```
leagues/<slug>/output/dashboard.json.gz       # canonical pipeline output
app/public/data/<slug>/dashboard.json.gz      # served by Vite
app/public/data/<slug>/dashboard.json         # uncompressed for the dev server
app/public/data/leagues.json                  # index of all leagues, refreshed each run
data/regressions/ootp<version>/               # shared across same-version leagues
  └── .regressions_cache.json                 # auto-generated by regression pipeline
```

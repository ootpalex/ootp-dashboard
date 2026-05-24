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
| Regression coefficients | Per OOTP version | Computed from that version's sims at build time and injected; `data_points.py` holds the shared no-sims fallback |

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

OOTP simulator mechanics change between major versions. New mechanics produce different rating-to-stat distributions, which means coefficients calibrated against OOTP 26 sim data don't apply to OOTP 27. For a new version:

1. **Drop calibration sim CSVs** into `data/regressions/ootp<new_version>/` (e.g., `data/regressions/ootp27/`). The expected files are listed in `model/src/validation.py` (`_REQUIRED_REGRESSION_CSVS`):
   - `hitters_ratings.csv`, `pitchers_ratings.csv`
   - `batting_sim_1.csv` through `batting_sim_5.csv`
   - `pitching_sim_1.csv` through `pitching_sim_5.csv`
   - `fielding_sim_1.csv` through `fielding_sim_5.csv`
   - Optional: `calibration/` subfolder for answer-key JSONs and team DP rates

   These come from running the OOTP simulator with a baseline ratings sheet over many sim seasons. See [`model/docs/pipelines/REGRESSIONS_IMPLEMENTATION.md`](../model/docs/pipelines/REGRESSIONS_IMPLEMENTATION.md) for the calibration methodology.

2. **Configure your new-version league** with `ootpVersion: "27"` in `league.json`. The pipeline routes regressions from `data/regressions/ootp27/` automatically based on this field.

3. **Run the build.** That's it — there's no manual coefficient merge. At build time `export._detect_metadata` calls `generate_regression_coefficients(regressions_dir)`, which fits *all* hitting/pitching/fielding coefficients from the new sims and injects them via `compose_data_points`. The fit is cached in a new `.regressions_cache.json` next to the inputs (keyed on a data hash + cache version), so only the first build on the new version pays the cost. The hardcoded OOTP 26 values in `data_points.py` stay put as the **no-sims fallback** — you don't edit them.

   (You can pre-warm / sanity-check the fit without a full build, from `model/`:
   ```bash
   python3 -c "from src.regressions import generate_regression_coefficients; from pathlib import Path; generate_regression_coefficients(Path('../data/regressions/ootp27'))"
   ```
   )

OOTP 26 is the only version this project ships with calibration sims for. OOTP 27 calibration (producing those sims) is a future task.

## Sharing data between leagues on different OOTP versions

There's no automatic sharing. Each version gets its own `data/regressions/ootp<version>/`, and its coefficients are computed from those sims at build time (the hardcoded `data_points.py` values are a shared no-sims fallback, not per-version constants). Leagues on the same version share regressions transparently; leagues on different versions are fully independent.

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

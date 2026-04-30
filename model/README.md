# OOTP Rating Pipeline — Python Implementation

A reverse-engineered Python implementation of the OOTP 26 player rating spreadsheets originally built in Excel. Converts raw OOTP CSV exports into WAR-based player evaluations with full batting, pitching, fielding, and baserunning projections.

> **You probably don't need to run anything in here directly.** From the project root, run `python3 run.py` — it handles league selection, validation, and dev-server orchestration. This README documents what the pipeline expects and how its modules fit together for contributors.

## Requirements

- Python 3.11+
- pandas, numpy, openpyxl, statsmodels (see `requirements.txt`)

```bash
pip install -r requirements.txt
```

## Quick Start

### 1. Player Exports (Required)

Drop CSV exports from OOTP into `leagues/<your-slug>/csv/players/`. Only `organization.csv` is strictly required; the rest unlock additional dashboard views:

| File | Description | Required? |
|------|-------------|-----------|
| `organization.csv` | Every player in your league | **Yes** |
| `freeagents.csv` | Free agents | Optional — enables Free Agent Finder |
| `iafa.csv` | International amateur free agents | Optional — enables IAFA Board |
| `draftYYYY.csv` | One per draft year (any 4-digit year) | Optional — enables Draft Board |

For the full step-by-step OOTP UI walkthrough (screens, Filters & Views, column configurations), see [`../docs/OOTP_EXPORT_GUIDE.md`](../docs/OOTP_EXPORT_GUIDE.md).

#### Optional: OSA Blending

For each file above, you can export a matching OSA (scouting) version:
- `organization_osa.csv`, `freeagents_osa.csv`, etc.

OSA ratings are blended with scout ratings (default 80/20 weight) for more accurate evaluations.

#### Optional: AAA/AA Relative Rating Exports

OOTP ratings are quantized to 5-point increments (20, 25, 30, ..., 80). Exporting at AAA and AA relative levels reveals finer distinctions within each tier:

- `organization_aaa.csv` — AAA-level relative export
- `organization_aa.csv` — AA-level relative export (optional, requires AAA)
- `organization_osa_aaa.csv` — AAA-level relative export for OSA ratings (if using OSA blending)
- `organization_osa_aa.csv` — AA-level relative export for OSA ratings (optional)

The blending algorithm subdivides each 5-point MLB tier using the AAA and AA rankings to produce continuous ratings (e.g., a player at MLB 55 might resolve to 54.58 or 55.42). When both relative and OSA blending are enabled, each source (scout and OSA) is relative-blended independently before the two are combined via weighted average.

### 2. Ballpark Data (Per-league, required)

Each league has its own `leagues/<slug>/csv/ballparks.csv` with one row per team. See `leagues/.example/csv/ballparks.csv` for the schema. The validation layer cross-checks the team list against `organization.csv` and aborts with a friendly error if they don't match.

### 3. Calibration Data (Optional)

The pipeline ships with hardcoded OOTP 26 defaults that work out of the box. These optional calibration steps refine accuracy for your specific save.

#### 3a. Metadata — League Parameters (Per-league)

Computes league-average parameters (wOBA weights, stat rates, fielding averages, position adjustments) from your save's rating data.

- **Source:** `25 Metadata.xlsx` → extract to `leagues/<slug>/metadata/` CSVs using openpyxl
- **When to update:** Recommended immediately after the season ends. Ratings drift as the next season progresses, so extracting right after the season completes gives the most accurate calibration.
- **Auto-detection:** If `leagues/<slug>/metadata/` contains CSV files, the pipeline automatically uses them instead of the hardcoded defaults. No flags needed.

#### 3b. Regressions — Rating-to-Stat Curves (Per OOTP version)

Calibrates the 60 regression slopes that convert player ratings (e.g., POW 65) into projected stats (e.g., HR/PA). Calibration is **per OOTP version** — leagues on the same OOTP version share regressions automatically.

- **Source:** `25 Regressions.xlsx` (OOTP 26) → extract to `data/regressions/ootp26/` CSVs. For OOTP 27+, drop new sim CSVs into `data/regressions/ootp27/` and re-run `regressions.py` against that path.
- **When to update:** Only when changing OOTP versions. See [`../docs/MULTI_LEAGUE.md`](../docs/MULTI_LEAGUE.md) for the new-version workflow.
- **Cache:** `.regressions_cache.json` next to the inputs short-circuits subsequent runs unless the input hash changes.

### 4. Run the Pipeline

The standard flow is `python3 run.py` from the project root, which validates inputs, runs `main.py --league <slug>`, and starts the dev server. To invoke `main.py` directly:

```bash
cd model
python3 main.py --league <your-slug>
```

Each league's settings live in `leagues/<slug>/league.json`. To force a re-prompt of pipeline settings, use `python3 run.py --configure`.

Output is written to `leagues/<slug>/output/dashboard.json.gz` — a gzip-compressed JSON file with nested per-player objects — and auto-copied to `app/public/data/<slug>/dashboard.json.gz` for the React frontend.

Power users can override the per-league paths from the CLI:

```bash
python3 main.py --league <slug> --player-dir <other-csvs>/players --ballpark <other-csvs>/ballparks.csv
```

## Module Overview

| Module | Description |
|--------|-------------|
| `src/players.py` | Loads OOTP CSV exports, handles column disambiguation, OSA blending, and relative rating blending |
| `src/relative_ratings.py` | Per-tier midpoint subdivision algorithm for AAA/AA relative rating blending |
| `src/hitters.py` | Batting, baserunning, fielding, and WAA projections for position players |
| `src/pitchers.py` | Pitching projections (SP/RP), RA/9, wOBA-against, and pitcher WAA |
| `src/data_points.py` | All model constants: regression coefficients, league averages, wOBA weights |
| `src/ballparks.py` | Park factor adjustments from per-league ballpark data |
| `src/metadata.py` | Computes league parameters from raw rating CSVs (hitting/pitching/fielding averages) |
| `src/aggregators/` | Hitter / pitcher / fielding aggregators called by `metadata.compose_data_points` |
| `src/regressions.py` | Regression calibration pipeline (linear + cubic + fielding models) — invoked when re-calibrating for a new OOTP version |
| `src/settings.py` | `LeagueConfig` dataclass + load/save/migrate helpers + interactive terminal prompts |
| `src/validation.py` | Pre-pipeline checks (ballpark/team consistency, missing required CSVs, etc.) with friendly errors |
| `src/export.py` | Pipeline orchestration — builds nested JSON output for the React dashboard |
| `src/utils.py` | Shared utility functions |
| `main.py` | CLI entry point — runs the full pipeline against a `--league <slug>` |

## Testing

```bash
python -m pytest tests/ -v
```

300+ tests covering all modules: batting, baserunning, fielding, WAA, pitching, regressions, metadata, relative ratings, export pipeline, settings, and integration smoke tests.

## OOTP Compatibility

Built for **OOTP 26**, with the multi-league architecture in place to support future versions. The hardcoded defaults in `data_points.py` work out of the box for OOTP 26 saves. For other environments:

- **League parameters:** Extract your save's metadata CSVs to `leagues/<slug>/metadata/` to recompute wOBA weights, league averages, and fielding baselines (see §3a above).
- **Regression coefficients (new OOTP version):** Drop sim CSVs into `data/regressions/ootp<version>/` and run `regressions.py`. See [`../docs/MULTI_LEAGUE.md`](../docs/MULTI_LEAGUE.md) for the workflow.

## Credits

Based on the Excel spreadsheets by the YourKidnies. Reverse-engineered into Python for integration with modern tools and dashboards.

- [SOBR Discord](https://discord.gg/CjkXqWqTRn) — OOTP analytics community

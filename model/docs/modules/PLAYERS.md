# Players — Pipeline Guide

## Overview

Loads OOTP CSV player exports from a directory, merges them into a single DataFrame, and adds classification flags. Handles column disambiguation for duplicate column names in the OOTP export format, optional OSA (scouting) rating blending, pitcher detection, and two-way player identification.

## Inputs Required

| Input | Source | Description |
|-------|--------|-------------|
| `leagues/<slug>/csv/players/*.csv` | OOTP export (Report → Write Report to CSV) | Up to 5 base CSVs: `org.csv` (required, MLB + MiLB), `intl.csv` (optional IntlComplex split for paginated leagues), `freeagents.csv`, `iafa.csv`, `draftYYYY.csv` (any 4-digit year) |
| `leagues/<slug>/csv/players/*_osa.csv` (optional) | OOTP export (OSA scouting view) | Paired OSA files for blending: `org_osa.csv`, `intl_osa.csv`, `freeagents_osa.csv`, etc. |
| `leagues/<slug>/csv/players/*_aaa.csv` (optional) | OOTP export (AAA relative view) | AAA relative exports for finer rating granularity |
| `leagues/<slug>/csv/players/*_aa.csv` (optional) | OOTP export (AA relative view) | AA relative exports for even finer granularity (requires AAA) |

### CSV format

Each file has ~184 columns covering biographical info, ratings (split by vR/vL/P), fielding ratings, and pitch grades. Three duplicate column names are automatically renamed:

| Original | Renamed To | Reason |
|----------|-----------|--------|
| `INJ` (2nd) | `INJ2` | Injury proneness vs. current injury |
| `CON` (2nd) | `PCON` | Batter contact vs. pitcher control |
| `CON vL/vR/P` (2nd) | `PCON vL/vR/P` | Pitcher control splits |
| `DEM` (2nd) | `DEM2` | Duplicate demand column |

## How to Use (Public API)

```python
from src.players import load_players

# Basic load (no OSA blending)
players = load_players("leagues/<slug>/csv/players/")

# With relative rating blending (AAA/AA)
players = load_players("leagues/<slug>/csv/players/", relative_blend=True)

# With both relative and OSA blending
players = load_players(
    "leagues/<slug>/csv/players/",
    relative_blend=True,
    osa_blend=True,
    scout_weight=0.8,
    osa_weight=0.2,
)

# Filter to hitters / pitchers
hitters = players[~players["is_pitcher"]]
pitchers = players[players["is_pitcher"]]
two_way = players[players["is_two_way"]]
```

## Expected Output

A single `pd.DataFrame` with:

| Column Group | Examples | Description |
|-------------|----------|-------------|
| Raw ratings | `BA vR`, `POW vL`, `STU P`, `IF RNG`, `OF ARM` | All 184+ original columns (renamed where needed) |
| `source` | `"Organization"`, `"Free Agent"`, `"Draft 2042"` | Origin file tag |
| `is_pitcher` | `True` / `False` | POS in {SP, RP, CL} |
| `is_two_way` | `True` / `False` | Preliminary two-way flag (refined later by `hitters.refine_two_way()`) |

Typical row counts: ~10,400 total (org ~7,900 + free agents ~800 + IAFA ~90 + drafts ~1,600).

## Key Concepts & League Context

- **Column disambiguation**: OOTP exports have three pairs of duplicate column names. Pandas auto-suffixes them as `.1`; this module renames to meaningful names (INJ2, PCON, DEM2).
- **Relative rating blending**: OOTP ratings are quantized to 5-point increments (20–80). When `relative_blend=True`, the pipeline looks for `_aaa.csv` and `_aa.csv` paired files. These provide finer distinctions within each MLB tier. A per-tier midpoint subdivision algorithm produces continuous values (e.g., MLB 55 → 54.58 or 55.42). See `src/relative_ratings.py` for algorithm details.
- **OSA blending**: When enabled, for each scout CSV that has a paired `_osa.csv` file, rating columns are blended as `scout_weight * scout_val + osa_weight * osa_val`. Only columns in the `_RATING_COLUMNS` whitelist (~80 entries: hitting/pitching ratings, fielding abilities, pitch grades, OVR/POT/MLD) are blended. All other columns (salary, contract, personality, metadata) are preserved from the scout file unchanged. Players without an OSA match keep their scout-only ratings.
- **Blending order**: When both `relative_blend` and `osa_blend` are enabled, relative blending is applied **independently** to each source before they are combined. Specifically: (1) Scout CSV is relative-blended with its own `_aaa.csv` / `_aa.csv` files, (2) OSA CSV is separately relative-blended with its own `_osa_aaa.csv` / `_osa_aa.csv` files, (3) the two independently refined results are then combined via the weighted average. This ensures each scouting source preserves its own fine-grained rating distinctions before the final blend.
- **Two-way detection**: A player is flagged `is_two_way=True` if they have real ratings on both sides. Hitter side: (3/3 big-3 >= 40) OR (2/3 >= 50). Pitcher side: all 3 pitcher ratings >= 40. This is a preliminary flag refined later with position eligibility via `hitters.refine_two_way()`.
- **PCON dash handling**: The `PCON` column (pitcher control) contains `"-"` values for ~12 rows. These are handled downstream in pitchers.py by substituting with 20 (matching the Excel `SUBSTITUTE` formula).

"""
src/validation.py — Pre-pipeline user-input validation.

Each check in `validate_league()` raises `PipelineValidationError` with a
user-friendly message naming the offending file and the specific mismatch.
Soft warnings (via `print`) are used for issues that don't prevent the
pipeline from running but the user should know about (missing optional
metadata files, unreachable StatsPlus URL).

Designed to run BEFORE any heavy compute so a misconfigured league fails in
under a second instead of after the full regression pipeline.
"""

from __future__ import annotations

import csv
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from src.settings import LeagueConfig, league_paths, regressions_dir_for


class PipelineValidationError(Exception):
    """Raised for user-input problems caught by validate_league()."""


# Regression CSVs expected to exist for any OOTP version that has been
# calibrated by `regressions.py`. The .regressions_cache.json file is
# optional (auto-generated). Calibration JSONs are also optional.
_REQUIRED_REGRESSION_CSVS = [
    "hitters_ratings.csv",
    "pitchers_ratings.csv",
    *(f"batting_sim_{i}.csv" for i in range(1, 6)),
    *(f"pitching_sim_{i}.csv" for i in range(1, 6)),
    *(f"fielding_sim_{i}.csv" for i in range(1, 6)),
]

# Player CSVs that, if present, must contain at least these columns.
# We don't require every player CSV — only `organization.csv` is mandatory.
_PLAYER_CSV_REQUIRED_COLS = ("ID", "POS", "Name", "ORG", "OVR", "POT")


def validate_league(
    config: LeagueConfig,
    *,
    skip_network_check: bool = False,
) -> None:
    """Run all pre-pipeline checks for `config`. Raises on hard errors, prints on soft warnings."""
    _check_league_config_fields(config)
    paths = league_paths(config.slug)
    _check_regressions_dir(config.ootp_version)
    _check_player_csvs(paths["player_dir"])
    org_teams = _load_org_teams(paths["player_dir"] / "organization.csv")
    park_teams = _check_ballparks_csv(paths["ballpark_csv"])
    _check_team_consistency(org_teams, park_teams, paths["ballpark_csv"])
    _check_my_team_in_ballparks(config.team, park_teams, paths["ballpark_csv"])
    _check_statsplus_url(config.statsplus_url, skip_network_check=skip_network_check)
    _check_metadata_dir(paths["metadata_dir"])


# ---------------------------------------------------------------------------
# Individual checks
# ---------------------------------------------------------------------------


def _check_league_config_fields(config: LeagueConfig) -> None:
    missing = [
        f for f in ("slug", "league_name", "ootp_version", "team")
        if not str(getattr(config, f, "")).strip()
    ]
    if missing:
        raise PipelineValidationError(
            f"League config is missing required field(s): {', '.join(missing)}.\n"
            f"   Edit leagues/{config.slug or '<slug>'}/league.json and set every field."
        )


def _check_regressions_dir(ootp_version: str) -> None:
    rdir = regressions_dir_for(ootp_version)
    if not rdir.is_dir():
        # Soft warning: the runtime pipeline reads coefficients from data_points.py,
        # so a missing regressions dir only matters when re-calibrating for a new
        # OOTP version. Surfacing it as a hard error would block users on OOTP 26
        # who never need to recompute.
        print(
            f"  Note: regressions directory not found for OOTP {ootp_version}: {rdir}\n"
            f"        Calibration tooling (model/src/regressions.py) won't run, but "
            f"the runtime pipeline will use compiled coefficients from data_points.py."
        )
        return
    missing = [name for name in _REQUIRED_REGRESSION_CSVS if not (rdir / name).is_file()]
    if missing:
        print(
            f"  Note: {rdir} is missing {len(missing)} expected calibration CSV(s): "
            f"{', '.join(missing[:3])}{'…' if len(missing) > 3 else ''}\n"
            f"        Re-calibration via regressions.py won't work until they're added."
        )


def _check_player_csvs(player_dir: Path) -> None:
    if not player_dir.is_dir():
        raise PipelineValidationError(
            f"Player CSV directory not found: {player_dir}\n"
            f"   Drop OOTP exports into this folder. See docs/OOTP_EXPORT_GUIDE.md."
        )
    org_path = player_dir / "organization.csv"
    if not org_path.is_file():
        raise PipelineValidationError(
            f"Required file missing: {org_path}\n"
            f"   organization.csv is the player-list export from OOTP and is required.\n"
            f"   See docs/OOTP_EXPORT_GUIDE.md for export instructions."
        )

    # Spot-check organization.csv has the columns the loaders rely on.
    try:
        with org_path.open(newline="") as f:
            reader = csv.reader(f)
            header = next(reader, None)
    except OSError as e:
        raise PipelineValidationError(f"Cannot read {org_path}: {e}") from e

    if not header:
        raise PipelineValidationError(
            f"{org_path} is empty.\n"
            f"   Re-export from OOTP — the file should have a header row plus one row per player."
        )
    missing_cols = [c for c in _PLAYER_CSV_REQUIRED_COLS if c not in header]
    if missing_cols:
        raise PipelineValidationError(
            f"{org_path} is missing required column(s): {', '.join(missing_cols)}\n"
            f"   This usually means the OOTP report was customized. Use the default\n"
            f"   player report layout described in docs/OOTP_EXPORT_GUIDE.md."
        )


def _load_org_teams(org_path: Path) -> set[str]:
    """Distinct, non-empty values from the ORG column of organization.csv."""
    teams: set[str] = set()
    with org_path.open(newline="") as f:
        reader = csv.DictReader(f)
        if "ORG" not in (reader.fieldnames or []):
            raise PipelineValidationError(
                f"{org_path} has no ORG column. Re-export from OOTP."
            )
        for row in reader:
            org = (row.get("ORG") or "").strip()
            if org:
                teams.add(org)
    return teams


def _check_ballparks_csv(ballpark_path: Path) -> set[str]:
    if not ballpark_path.is_file():
        raise PipelineValidationError(
            f"Ballparks CSV not found: {ballpark_path}\n"
            f"   Create a ballparks.csv listing every team in your league with park-factor values.\n"
            f"   See leagues/.example/csv/ballparks.csv for the expected schema."
        )
    teams: set[str] = set()
    try:
        with ballpark_path.open(newline="") as f:
            reader = csv.DictReader(f)
            if "Team Name" not in (reader.fieldnames or []):
                raise PipelineValidationError(
                    f"{ballpark_path} is missing the 'Team Name' column.\n"
                    f"   Expected header: Team Name,Park,PF AVG,AVG L,AVG R,PF HR,HR L,HR R,PF D,PF T,PF"
                )
            for row in reader:
                name = (row.get("Team Name") or "").strip()
                if name:
                    teams.add(name)
    except OSError as e:
        raise PipelineValidationError(f"Cannot read {ballpark_path}: {e}") from e
    if not teams:
        raise PipelineValidationError(
            f"{ballpark_path} has no team rows. Add one row per team in your league."
        )
    return teams


def _check_team_consistency(
    org_teams: set[str],
    park_teams: set[str],
    ballpark_path: Path,
) -> None:
    """Headline check: ballparks.csv team list must match the orgs in organization.csv."""
    if org_teams == park_teams:
        return
    missing_in_parks = sorted(org_teams - park_teams)
    extra_in_parks = sorted(park_teams - org_teams)
    lines = [
        f"Ballpark/team mismatch in '{ballpark_path}':",
        f"   Player file lists {len(org_teams)} teams; ballparks lists {len(park_teams)}.",
    ]
    if missing_in_parks:
        sample = ", ".join(repr(t) for t in missing_in_parks[:5])
        more = f" (+{len(missing_in_parks) - 5} more)" if len(missing_in_parks) > 5 else ""
        lines.append(f"   Missing in ballparks: {sample}{more}.")
    if extra_in_parks:
        sample = ", ".join(repr(t) for t in extra_in_parks[:5])
        more = f" (+{len(extra_in_parks) - 5} more)" if len(extra_in_parks) > 5 else ""
        lines.append(f"   In ballparks but not in players: {sample}{more}.")
    lines.append("   This usually means you copied a ballparks file from a different league.")
    raise PipelineValidationError("\n".join(lines))


def _check_my_team_in_ballparks(
    team: str,
    park_teams: set[str],
    ballpark_path: Path,
) -> None:
    if team in park_teams:
        return
    sample = ", ".join(sorted(park_teams)[:5])
    more = f" (+{len(park_teams) - 5} more)" if len(park_teams) > 5 else ""
    raise PipelineValidationError(
        f"Your team '{team}' is not listed in {ballpark_path}.\n"
        f"   Available teams: {sample}{more}.\n"
        f"   Either fix the 'team' field in your league.json or add a row to ballparks.csv."
    )


def _check_statsplus_url(url: str, *, skip_network_check: bool) -> None:
    """Soft check: validate URL format; if available, do a quick HEAD probe."""
    if not url:
        return  # empty is fine — pipeline degrades gracefully
    if not (url.startswith("http://") or url.startswith("https://")):
        print(
            f"  Note: statsplusUrl '{url}' does not start with http:// or https://.\n"
            f"        Contract data fetch will be skipped."
        )
        return
    if skip_network_check:
        return
    try:
        req = Request(url, method="HEAD")
        with urlopen(req, timeout=2) as resp:
            status = getattr(resp, "status", 200)
            if status >= 400:
                print(f"  Note: statsplusUrl returned HTTP {status}; contract fetch may fail.")
    except (URLError, HTTPError, OSError, TimeoutError):
        print(
            f"  Note: statsplusUrl '{url}' did not respond to a HEAD probe.\n"
            f"        That's fine if you're offline; contract data will be skipped."
        )


def _check_metadata_dir(metadata_dir: Path) -> None:
    """Soft check: if the dir exists, list any missing files but don't fail."""
    if not metadata_dir.is_dir():
        return
    csvs = list(metadata_dir.glob("*.csv"))
    if not csvs:
        print(
            f"  Note: {metadata_dir} is empty — pipeline will use OOTP-version defaults."
        )

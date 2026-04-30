"""main.py — OOTP rating pipeline. Outputs dashboard.json.gz for the React app."""

from __future__ import annotations

import argparse
import gzip
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from src.ballparks import load_team_names
from src.export import build_dashboard
from src.settings import (
    LeagueConfig,
    PipelineSettings,
    get_or_prompt_settings,
    league_paths,
    list_leagues,
    load_league_config,
    project_root,
    regressions_dir_for,
)
from src.validation import PipelineValidationError, validate_league

LEGACY_SETTINGS_PATH = Path("pipeline_settings.json")


def _resolve_paths_from_league(
    config: LeagueConfig,
    overrides: argparse.Namespace,
) -> dict[str, Path]:
    """Resolve canonical paths for a league, allowing CLI overrides for power users."""
    paths = league_paths(config.slug)
    return {
        "player_dir": Path(overrides.player_dir) if overrides.player_dir else paths["player_dir"],
        "ballpark_path": Path(overrides.ballpark) if overrides.ballpark else paths["ballpark_csv"],
        "metadata_dir": Path(overrides.metadata_dir) if overrides.metadata_dir else paths["metadata_dir"],
        "output_path": Path(overrides.output) if overrides.output else paths["output_gz"],
        "regressions_dir": regressions_dir_for(config.ootp_version),
    }


def _resolve_paths_legacy(args: argparse.Namespace) -> dict[str, Path]:
    """Legacy path resolution for invocations without --league."""
    return {
        "player_dir": Path(args.player_dir or "data/players"),
        "ballpark_path": Path(args.ballpark or "data/ballparks.csv"),
        "metadata_dir": Path(args.metadata_dir or "data/metadata"),
        "output_path": Path(args.output or "output/dashboard.json.gz"),
        "regressions_dir": None,  # legacy mode does not surface regressions dir
    }


def _atomic_write_text(path: Path, text: str) -> None:
    """Write text to `path` atomically via temp-file + os.replace."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with tmp.open("w") as f:
        f.write(text)
    os.replace(tmp, path)


def _update_leagues_index(app_data_dir: Path) -> None:
    """Refresh `app/public/data/leagues.json` from all configured leagues.

    The index reflects the current contents of `leagues/*/league.json` and the
    presence of each league's `dashboard.json.gz` under `app/public/data/<slug>/`.
    Written atomically so concurrent pipeline runs don't corrupt the file.
    """
    if not app_data_dir.is_dir():
        return
    entries = []
    for cfg in list_leagues():
        dashboard_rel = f"{cfg.slug}/dashboard.json.gz"
        dashboard_path = app_data_dir / dashboard_rel
        last_built = None
        if dashboard_path.is_file():
            mtime = dashboard_path.stat().st_mtime
            last_built = datetime.fromtimestamp(mtime, tz=timezone.utc).isoformat()
        entries.append({
            "slug": cfg.slug,
            "leagueName": cfg.league_name,
            "ootpVersion": cfg.ootp_version,
            "team": cfg.team,
            "dashboardPath": dashboard_rel,
            "lastBuilt": last_built,
        })
    _atomic_write_text(
        app_data_dir / "leagues.json",
        json.dumps({"leagues": entries}, indent=2) + "\n",
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="OOTP rating pipeline — compute player stats and export dashboard JSON."
    )
    parser.add_argument(
        "--league",
        help="League slug to build (e.g. BLM). Reads leagues/<slug>/league.json. "
             "When set, --player-dir/--ballpark/--metadata-dir/--output act as overrides.",
    )
    parser.add_argument(
        "--player-dir", default=None,
        help="Override player CSV directory.",
    )
    parser.add_argument(
        "--ballpark", default=None,
        help="Override ballparks CSV path.",
    )
    parser.add_argument(
        "--output", default=None,
        help="Override output JSON path.",
    )
    parser.add_argument(
        "--metadata-dir", default=None,
        help="Override metadata input directory.",
    )
    parser.add_argument(
        "--statsplus-url",
        help="StatsPlus URL for contract data (overrides league.json / saved settings); page or API form both accepted",
    )
    parser.add_argument(
        "--configure", action="store_true",
        help="Force re-configure settings interactively",
    )
    parser.add_argument(
        "--skip-network-check", action="store_true",
        help="Skip the StatsPlus URL HEAD probe during validation (use when offline).",
    )
    args = parser.parse_args()

    # Resolve identity + paths
    league_config: LeagueConfig | None = None
    if args.league:
        try:
            league_config = load_league_config(args.league)
        except FileNotFoundError as e:
            parser.error(str(e))
        # Validate user inputs BEFORE any heavy compute
        try:
            validate_league(league_config, skip_network_check=args.skip_network_check)
        except PipelineValidationError as e:
            print(f"\n❌ {e}\n", file=sys.stderr)
            sys.exit(2)
        paths = _resolve_paths_from_league(league_config, args)
    else:
        paths = _resolve_paths_legacy(args)

    player_dir = paths["player_dir"]
    ballpark_path = paths["ballpark_path"]
    output_path = paths["output_path"]
    metadata_dir = paths["metadata_dir"]

    # Validate inputs exist
    if not player_dir.is_dir():
        parser.error(f"Player directory not found: {player_dir}")
    if not ballpark_path.is_file():
        parser.error(f"Ballpark CSV not found: {ballpark_path}")

    # Get settings
    teams = load_team_names(ballpark_path)
    if league_config is not None:
        settings: PipelineSettings = league_config.to_pipeline_settings()
        print(f"\n=== Building league '{league_config.slug}' ({league_config.league_name}, OOTP {league_config.ootp_version}) ===")
    else:
        settings = get_or_prompt_settings(
            LEGACY_SETTINGS_PATH, player_dir, teams, force=args.configure
        )

    # Fetch StatsPlus contract + player data if URL is available
    statsplus_url = args.statsplus_url or settings.statsplus_url
    contracts = None
    players_extra = None
    if statsplus_url:
        from src.statsplus import fetch_contracts, fetch_players
        print(f"\nFetching StatsPlus contract data...")
        try:
            contracts = fetch_contracts(statsplus_url)
            print(f"  {len(contracts)} contracts loaded")
        except Exception as e:
            print(f"  Warning: StatsPlus fetch failed — {e}")
            print(f"  Continuing without contract data...")
        print(f"\nFetching StatsPlus player service data...")
        try:
            players_extra = fetch_players(statsplus_url)
        except Exception as e:
            print(f"  Warning: /players fetch failed — {e}")
            print(f"  Continuing without service-day data...")
    else:
        print("\nNo StatsPlus URL configured — skipping contract fetch")
        print("  Set statsplusUrl in leagues/<slug>/league.json or pass --statsplus-url to enable")

    # Fetch salary reports for every MLB team in the user's league. The result
    # is a flat {playerId: entry} dict (playerIds are league-unique), so
    # export.py can look up by pid without needing to know which team a player
    # is on. ballparks.csv is the source of truth for which teams belong to the
    # user's MLB league — this filters out KBO/foreign-league/All-Stars rosters
    # that share the same StatsPlus /teams/ namespace.
    salary_reports: dict = {}
    if statsplus_url:
        from src.salary_report import fetch_all_salary_reports
        mlb_team_names = load_team_names(ballpark_path)
        print(f"\nFetching salary reports for {len(mlb_team_names)} MLB teams...")
        try:
            salary_reports = fetch_all_salary_reports(
                statsplus_url, team_names=mlb_team_names
            )
            print(f"  {len(salary_reports)} players across all teams")
        except Exception as e:
            print(f"  Warning: salary report fetch failed — {e}")

    # Run pipeline
    try:
        t0 = time.time()
        result = build_dashboard(settings, player_dir, ballpark_path, metadata_dir, contracts, salary_reports, players_extra)
        elapsed = time.time() - t0
    except FileNotFoundError as e:
        print(f"Error: missing file — {e}", file=sys.stderr)
        sys.exit(1)
    except KeyError as e:
        print(f"Error: missing column or key — {e}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Error: pipeline failed — {type(e).__name__}: {e}", file=sys.stderr)
        sys.exit(1)

    # Write output
    output_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        json_bytes = json.dumps(result).encode("utf-8")
        with gzip.open(output_path, "wb") as f:
            f.write(json_bytes)
    except OSError as e:
        print(f"Error: could not write output — {e}", file=sys.stderr)
        sys.exit(1)

    size_kb = output_path.stat().st_size / 1024
    print(f"\nDashboard data written to {output_path} ({size_kb:.0f} KB)")
    print(f"  Hitters:  {len(result['hitters'])}")
    print(f"  Pitchers: {len(result['pitchers'])}")
    print(f"  Time:     {elapsed:.1f}s")

    # Auto-copy to app/public/data/ for the React frontend
    root = project_root()
    app_data_dir = root / "app" / "public" / "data"
    if app_data_dir.is_dir():
        import shutil
        if league_config is not None:
            league_app_dir = app_data_dir / league_config.slug
            league_app_dir.mkdir(parents=True, exist_ok=True)
            app_gz = league_app_dir / "dashboard.json.gz"
            app_json = league_app_dir / "dashboard.json"
        else:
            app_gz = app_data_dir / "dashboard.json.gz"
            app_json = app_data_dir / "dashboard.json"
        shutil.copy2(output_path, app_gz)
        app_json.write_bytes(json_bytes)
        print(f"  Copied to {app_gz.parent}/")
        # Refresh the leagues.json index so the SPA can switch leagues
        _update_leagues_index(app_data_dir)
    else:
        print(f"  Note: {app_data_dir} not found — skipped auto-copy to app")


if __name__ == "__main__":
    main()

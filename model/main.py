"""main.py — OOTP rating pipeline. Outputs dashboard.json.gz for the React app."""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

# Bump when the pipeline code changes in a way that should invalidate cached
# builds (column additions, formula changes, new meta fields, etc.).
_BUILD_CACHE_VERSION = "2026-05-19-v1"


def _compute_build_input_hash(
    player_dir: Path,
    ballpark_path: Path,
    metadata_dir: Path | None,
    league_config_path: Path | None,
    statsplus_date: str | None,
) -> str:
    """Hash of everything the pipeline reads. If this matches the previous
    successful build's hash and the output still exists, we can skip the
    whole heavy compute and reuse the existing dashboard.json.gz."""
    h = hashlib.sha256()
    h.update(f"version={_BUILD_CACHE_VERSION}\n".encode())
    h.update(f"statsplus_date={statsplus_date or ''}\n".encode())

    def hash_file(path: Path) -> None:
        if not path.is_file():
            return
        h.update(f"file:{path.name}:{path.stat().st_size}\n".encode())
        h.update(path.read_bytes())

    def hash_dir(directory: Path) -> None:
        if not directory.is_dir():
            return
        for child in sorted(directory.iterdir()):
            if child.is_file() and child.suffix.lower() == ".csv":
                hash_file(child)
            elif child.is_dir():
                hash_dir(child)

    hash_dir(player_dir)
    hash_file(ballpark_path)
    if metadata_dir:
        hash_dir(metadata_dir)
    if league_config_path:
        hash_file(league_config_path)
    return f"sha256:{h.hexdigest()}"


def _load_build_cache(output_dir: Path) -> dict | None:
    """Read the previous build's hash marker, if present and parseable."""
    path = output_dir / ".build_cache.json"
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return None


def _save_build_cache(output_dir: Path, input_hash: str, output_path: Path) -> None:
    """Persist the hash marker so subsequent runs can short-circuit."""
    output_dir.mkdir(parents=True, exist_ok=True)
    payload = {
        "input_hash": input_hash,
        "output_path": str(output_path),
        "built_at": datetime.now(tz=timezone.utc).isoformat(),
    }
    try:
        (output_dir / ".build_cache.json").write_text(json.dumps(payload, indent=2) + "\n")
    except OSError:
        pass

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
    prompt_settings,
    regressions_dir_for,
    save_league_config,
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
        "statsplus_cache": paths["statsplus_cache"],
    }


def _resolve_paths_legacy(args: argparse.Namespace) -> dict[str, Path]:
    """Legacy path resolution for invocations without --league."""
    return {
        "player_dir": Path(args.player_dir or "data/players"),
        "ballpark_path": Path(args.ballpark or "data/ballparks.csv"),
        "metadata_dir": Path(args.metadata_dir or "data/metadata"),
        "output_path": Path(args.output or "output/dashboard.json.gz"),
        "regressions_dir": None,  # legacy mode does not surface regressions dir
        "statsplus_cache": None,  # legacy mode has no per-league cache dir
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
    parser.add_argument(
        "--refresh-statsplus", action="store_true",
        help="Ignore the StatsPlus fetch cache and refetch contracts/players/salaries "
             "even if the in-game date is unchanged.",
    )
    parser.add_argument(
        "--force", action="store_true",
        help="Rebuild the dashboard even if no inputs have changed since the "
             "previous run (bypasses the build-cache short-circuit).",
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
        if args.configure:
            updated = prompt_settings(league_config.to_pipeline_settings(), teams)
            league_config.team = updated.team
            league_config.park_factor_mode = updated.park_factor_mode
            league_config.home_fraction = updated.home_fraction
            league_config.relative_blend = updated.relative_blend
            league_config.osa_blend = updated.osa_blend
            league_config.scout_weight = updated.scout_weight
            league_config.osa_weight = updated.osa_weight
            league_config.statsplus_url = updated.statsplus_url
            save_league_config(league_config)
        settings: PipelineSettings = league_config.to_pipeline_settings()
        print(f"\n=== Building league '{league_config.slug}' ({league_config.league_name}, OOTP {league_config.ootp_version}) ===")
    else:
        settings = get_or_prompt_settings(
            LEGACY_SETTINGS_PATH, player_dir, teams, force=args.configure
        )

    # Fetch StatsPlus contract + player data if URL is available. To avoid
    # hammering StatsPlus when nothing has changed, we first ask /date for the
    # current in-game date and reuse the previous fetch's results if the date
    # matches. The cache lives at leagues/<slug>/.statsplus_cache.json.gz and
    # holds contracts + players + salary_reports for that date.
    statsplus_url = args.statsplus_url or settings.statsplus_url
    statsplus_cache_path: Path | None = paths.get("statsplus_cache")
    contracts = None
    players_extra = None
    salary_reports: dict = {}
    if statsplus_url:
        from src.statsplus import (
            fetch_contracts,
            fetch_game_date,
            fetch_players,
            load_statsplus_cache,
            save_statsplus_cache,
        )

        print(f"\nChecking StatsPlus game date...")
        current_date = fetch_game_date(statsplus_url)
        if current_date:
            print(f"  Current game date: {current_date}")
        else:
            print("  Could not determine game date — caching disabled this run")

        cached = None
        if statsplus_cache_path and current_date and not args.refresh_statsplus:
            cached = load_statsplus_cache(statsplus_cache_path, current_date)

        if cached is not None:
            contracts, players_extra, salary_reports = cached
            print(
                f"  Reusing StatsPlus cache for {current_date} "
                f"({len(contracts)} contracts, {len(players_extra)} player records, "
                f"{len(salary_reports)} salary entries) — skipping network fetches"
            )
        else:
            if args.refresh_statsplus:
                print("  --refresh-statsplus set — bypassing cache")

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

            # Salary reports — one HTML scrape per MLB team in the user's league.
            # Result is a flat {playerId: entry} dict (playerIds are league-unique)
            # so export.py can look up by pid without knowing which team a player
            # is on. ballparks.csv is the source of truth for which teams belong
            # to the user's MLB league — this filters out KBO/foreign-league/
            # All-Stars rosters sharing the same /teams/ namespace.
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

            # Only cache when every fetch returned (i.e. nothing raised). A
            # transient network blip on any one endpoint would otherwise poison
            # the cache until the in-game date advances.
            if (
                statsplus_cache_path
                and current_date
                and contracts is not None
                and players_extra is not None
            ):
                save_statsplus_cache(
                    statsplus_cache_path,
                    current_date,
                    contracts,
                    players_extra,
                    salary_reports,
                )
                print(f"  Saved StatsPlus cache for {current_date}")
            elif statsplus_cache_path and current_date:
                print("  Skipping cache save — one or more fetches failed")
    else:
        print("\nNo StatsPlus URL configured — skipping contract fetch")
        print("  Set statsplusUrl in leagues/<slug>/league.json or pass --statsplus-url to enable")

    # Build-cache short-circuit. Hash every input that affects the output
    # (CSVs, ballpark, metadata, league.json, StatsPlus game date, pipeline
    # version) and skip the heavy compute when nothing has changed AND the
    # previous output still exists. `--force` bypasses this.
    league_cfg_path: Path | None = None
    if league_config is not None:
        league_cfg_path = league_paths(league_config.slug)["league_json"]
    sp_date_for_hash = current_date if statsplus_url else None
    build_hash = _compute_build_input_hash(
        player_dir, ballpark_path, metadata_dir, league_cfg_path, sp_date_for_hash,
    )
    cached_build = None if args.force else _load_build_cache(output_path.parent)
    if (
        cached_build
        and cached_build.get("input_hash") == build_hash
        and output_path.is_file()
    ):
        print(
            f"\nInputs unchanged since last run ({cached_build.get('built_at', 'unknown')})"
            f" — skipping rebuild. Pass --force to rebuild anyway."
        )
        json_bytes = output_path.read_bytes()
        # Decompress for the copy step below.
        with gzip.open(output_path, "rb") as f:
            raw_json = f.read()
        size_kb = output_path.stat().st_size / 1024
        print(f"Reusing {output_path} ({size_kb:.0f} KB)")
        elapsed = 0.0
        # Mimic the post-build path: copy to app/public/data/<slug>/ and
        # refresh the leagues index so the SPA picks up the existing build.
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
            app_json.write_bytes(raw_json)
            _update_leagues_index(app_data_dir)
            print(f"  Copied to {app_gz.parent}/")
        return

    # Run pipeline
    try:
        t0 = time.time()
        result = build_dashboard(
            settings, player_dir, ballpark_path, metadata_dir,
            contracts, salary_reports, players_extra,
            statsplus_game_date=current_date if statsplus_url else None,
        )
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

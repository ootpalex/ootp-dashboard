"""
src/settings.py — Pipeline settings management with interactive terminal prompts.

Handles first-run configuration, input-data change detection, and
serialization of pipeline settings to/from JSON.

Two settings types live here:

* `PipelineSettings` is the legacy single-league config persisted to
  `model/pipeline_settings.json`. It is retained only so that auto-migration
  can read an existing user config when transitioning to multi-league.
* `LeagueConfig` is the multi-league config persisted to
  `leagues/<slug>/league.json`. It is a superset of `PipelineSettings`
  plus `slug`, `league_name`, and `ootp_version`. New code should always
  use `LeagueConfig`; legacy callers can call `.to_pipeline_settings()`.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass, field
from pathlib import Path


@dataclass
class PipelineSettings:
    """Legacy single-league user-configurable pipeline parameters."""

    team: str = "Nashville Stars"
    park_factor_mode: str = "team"       # "neutral" | "team"
    home_fraction: float = 0.5
    relative_blend: bool = True
    osa_blend: bool = True
    scout_weight: float = 0.8
    osa_weight: float = 0.2
    statsplus_url: str = ""              # e.g. "https://atl-01.statsplus.net/ssb/"


@dataclass
class LeagueConfig:
    """Multi-league config persisted to leagues/<slug>/league.json.

    Identity fields (`slug`, `league_name`, `ootp_version`) are required;
    pipeline-tuning fields default to the same values as `PipelineSettings`.
    """

    slug: str
    league_name: str
    ootp_version: str
    team: str = "Nashville Stars"
    statsplus_url: str = ""
    park_factor_mode: str = "team"
    home_fraction: float = 0.5
    relative_blend: bool = True
    osa_blend: bool = True
    scout_weight: float = 0.8
    osa_weight: float = 0.2

    def to_pipeline_settings(self) -> PipelineSettings:
        """Project to legacy PipelineSettings for code that still expects it."""
        return PipelineSettings(
            team=self.team,
            park_factor_mode=self.park_factor_mode,
            home_fraction=self.home_fraction,
            relative_blend=self.relative_blend,
            osa_blend=self.osa_blend,
            scout_weight=self.scout_weight,
            osa_weight=self.osa_weight,
            statsplus_url=self.statsplus_url,
        )


# ---------------------------------------------------------------------------
# Input hash — detect when CSV data changes
# ---------------------------------------------------------------------------


def compute_input_hash(player_dir: Path) -> str:
    """SHA-256 hash of CSV filenames + sizes for change detection."""
    entries: list[str] = []
    for p in sorted(player_dir.iterdir()):
        if p.is_file() and p.suffix.lower() == ".csv":
            entries.append(f"{p.name}:{p.stat().st_size}")
    digest = hashlib.sha256("|".join(entries).encode()).hexdigest()
    return f"sha256:{digest}"


# ---------------------------------------------------------------------------
# Load / save
# ---------------------------------------------------------------------------


_CAMEL_TO_SNAKE = {
    "parkFactorMode": "park_factor_mode",
    "homeFraction": "home_fraction",
    "relativeBlend": "relative_blend",
    "osaBlend": "osa_blend",
    "scoutWeight": "scout_weight",
    "osaWeight": "osa_weight",
    "statsplusUrl": "statsplus_url",
}


def load_settings(settings_path: Path) -> tuple[PipelineSettings | None, str | None]:
    """Load saved settings + input hash. Returns (None, None) if file doesn't exist."""
    if not settings_path.exists():
        return None, None
    with settings_path.open() as f:
        data = json.load(f)
    input_hash = data.pop("_inputHash", None)
    # Map camelCase JSON keys back to snake_case dataclass fields
    kwargs = {}
    for k, v in data.items():
        if k.startswith("_"):
            continue
        snake_key = _CAMEL_TO_SNAKE.get(k, k)
        kwargs[snake_key] = v
    settings = PipelineSettings(**kwargs)
    return settings, input_hash


def save_settings(settings: PipelineSettings, input_hash: str, path: Path) -> None:
    """Save settings + input hash to JSON."""
    data = asdict(settings)
    # Convert snake_case keys to camelCase for the JSON file
    camel = {
        "team": data["team"],
        "parkFactorMode": data["park_factor_mode"],
        "homeFraction": data["home_fraction"],
        "relativeBlend": data["relative_blend"],
        "osaBlend": data["osa_blend"],
        "scoutWeight": data["scout_weight"],
        "osaWeight": data["osa_weight"],
        "statsplusUrl": data["statsplus_url"],
        "_inputHash": input_hash,
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w") as f:
        json.dump(camel, f, indent=2)
        f.write("\n")


# ---------------------------------------------------------------------------
# Interactive prompts
# ---------------------------------------------------------------------------


def _prompt_choice(prompt: str, options: list[str], current: int | None = None) -> int:
    """Prompt user to pick from numbered options. Returns 0-based index."""
    for i, opt in enumerate(options, 1):
        marker = "  [current]" if current is not None and i - 1 == current else ""
        print(f"    {i}. {opt}{marker}")
    while True:
        raw = input(f"    > Choose (1-{len(options)}): ").strip()
        if raw == "" and current is not None:
            return current
        try:
            val = int(raw)
            if 1 <= val <= len(options):
                return val - 1
        except ValueError:
            pass
        print(f"    Please enter a number between 1 and {len(options)}.")


def _prompt_float(prompt: str, default: float, lo: float, hi: float) -> float:
    """Prompt for a float in [lo, hi] with a default."""
    while True:
        raw = input(f"    > {prompt} (default: {default}): ").strip()
        if raw == "":
            return default
        try:
            val = float(raw)
            if lo <= val <= hi:
                return val
        except ValueError:
            pass
        print(f"    Please enter a number between {lo} and {hi}.")


def prompt_settings(
    current: PipelineSettings | None,
    teams: list[str],
) -> PipelineSettings:
    """Interactive terminal prompts. Shows current values as defaults."""
    c = current or PipelineSettings()

    print("\n=== OOTP Pipeline Settings ===\n")

    # [1] Team
    print(f"[1] Team Selection")
    print(f"    Your team: {c.team}")
    team_input = input("    > Enter team name (or press Enter to keep): ").strip()
    team = team_input if team_input else c.team
    if team not in teams:
        print(f"    Warning: '{team}' not found in ballparks data.")
        print(f"    Available: {', '.join(teams)}")
        team_input = input("    > Enter team name: ").strip()
        team = team_input if team_input else c.team

    # [2] Park factor mode
    print(f"\n[2] Park Factor Mode")
    print(f"    How should park factors be applied?")
    modes = ["Neutral (no park factors)", "Own team only (all players evaluated at your park)"]
    current_mode = 0 if c.park_factor_mode == "neutral" else 1
    mode_idx = _prompt_choice("", modes, current_mode)
    park_factor_mode = "neutral" if mode_idx == 0 else "team"

    # [3] Home fraction
    home_fraction = c.home_fraction
    if park_factor_mode == "team":
        print(f"\n[3] Home Fraction")
        print(f"    What fraction of games are at home?")
        home_fraction = _prompt_float(
            "Enter value 0.0-1.0", c.home_fraction, 0.0, 1.0
        )

    # [4] Relative blending
    print(f"\n[4] Rating Blending")
    print(f"    Use AAA/AA relative rating exports for finer granularity?")
    blend_opts = ["Yes", "No"]
    blend_current = 0 if c.relative_blend else 1
    blend_idx = _prompt_choice("", blend_opts, blend_current)
    relative_blend = blend_idx == 0

    # [5] OSA blending
    print(f"\n[5] OSA Blending")
    print(f"    Blend scout and OSA ratings?")
    osa_current = 0 if c.osa_blend else 1
    osa_idx = _prompt_choice("", blend_opts, osa_current)
    osa_blend = osa_idx == 0

    scout_weight = c.scout_weight
    osa_weight = c.osa_weight
    if osa_blend:
        print(f"\n    Scout weight: {c.scout_weight}, OSA weight: {c.osa_weight}")
        scout_weight = _prompt_float(
            "Enter scout weight 0.0-1.0", c.scout_weight, 0.0, 1.0
        )
        osa_weight = round(1.0 - scout_weight, 4)
        print(f"    OSA weight set to {osa_weight}")

    # [6] StatsPlus URL
    print(f"\n[6] StatsPlus URL")
    print(f"    League page URL for fetching contract data — e.g. https://atl-01.statsplus.net/ssb/")
    print(f"    (leave empty to skip)")
    if c.statsplus_url:
        print(f"    Current: {c.statsplus_url}")
    sp_input = input("    > Enter StatsPlus URL (or press Enter to keep): ").strip()
    statsplus_url = sp_input if sp_input else c.statsplus_url

    settings = PipelineSettings(
        team=team,
        park_factor_mode=park_factor_mode,
        home_fraction=home_fraction,
        relative_blend=relative_blend,
        osa_blend=osa_blend,
        scout_weight=scout_weight,
        osa_weight=osa_weight,
        statsplus_url=statsplus_url,
    )
    print(f"\nSettings saved.")
    return settings


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------


def get_or_prompt_settings(
    settings_path: Path,
    player_dir: Path,
    teams: list[str],
    *,
    force: bool = False,
) -> PipelineSettings:
    """Load if valid + unchanged, else prompt interactively.

    Prompts when:
    1. No settings file exists (first run)
    2. Input data hash changed (CSV files added/removed/resized)
    3. force=True (--configure flag)
    """
    current_hash = compute_input_hash(player_dir)

    if not force:
        saved, saved_hash = load_settings(settings_path)
        if saved is not None and saved_hash == current_hash:
            return saved
        if saved is not None and saved_hash != current_hash:
            print("Input data has changed — reconfiguring settings.")

    saved, _ = load_settings(settings_path)
    settings = prompt_settings(saved, teams)
    save_settings(settings, current_hash, settings_path)
    return settings


# ---------------------------------------------------------------------------
# LeagueConfig load / save / migrate / list
# ---------------------------------------------------------------------------


_LEAGUE_CAMEL_TO_SNAKE = {
    "leagueName": "league_name",
    "ootpVersion": "ootp_version",
    "parkFactorMode": "park_factor_mode",
    "homeFraction": "home_fraction",
    "relativeBlend": "relative_blend",
    "osaBlend": "osa_blend",
    "scoutWeight": "scout_weight",
    "osaWeight": "osa_weight",
    "statsplusUrl": "statsplus_url",
}


def _project_root_from(start: Path) -> Path:
    """Resolve the project root by walking up to find leagues/ or fall back to CWD parents.

    The pipeline can be invoked from `cd model && python main.py` (CWD = model/) or
    from `python3 run.py` at the repo root (CWD = project/). This helper produces a
    stable absolute path either way.
    """
    start = start.resolve()
    candidates = [start, *start.parents]
    for candidate in candidates:
        if (candidate / "leagues").is_dir() or (candidate / "app").is_dir():
            return candidate
    return start


def project_root() -> Path:
    """Locate the project root from the current working directory."""
    return _project_root_from(Path.cwd())


def league_paths(slug: str, root: Path | None = None) -> dict[str, Path]:
    """Resolve the canonical input/output paths for a given league slug."""
    base = (root or project_root()) / "leagues" / slug
    return {
        "league_dir": base,
        "league_json": base / "league.json",
        "player_dir": base / "csv" / "players",
        "ballpark_csv": base / "csv" / "ballparks.csv",
        "metadata_dir": base / "metadata",
        "output_dir": base / "output",
        "output_gz": base / "output" / "dashboard.json.gz",
    }


def regressions_dir_for(ootp_version: str, root: Path | None = None) -> Path:
    """Resolve the version-shared regressions directory for an OOTP version."""
    return (root or project_root()) / "data" / "regressions" / f"ootp{ootp_version}"


def load_league_config(slug: str, root: Path | None = None) -> LeagueConfig:
    """Load `leagues/<slug>/league.json`. Raises FileNotFoundError if missing."""
    paths = league_paths(slug, root)
    league_json = paths["league_json"]
    if not league_json.is_file():
        raise FileNotFoundError(
            f"No league config at {league_json}. Run `python3 run.py` to set up a new league."
        )
    with league_json.open() as f:
        data = json.load(f)
    kwargs: dict = {}
    for k, v in data.items():
        if k.startswith("_"):
            continue
        snake_key = _LEAGUE_CAMEL_TO_SNAKE.get(k, k)
        kwargs[snake_key] = v
    # Allow league.json to omit slug; trust the folder name as the source of truth.
    kwargs.setdefault("slug", slug)
    return LeagueConfig(**kwargs)


def save_league_config(config: LeagueConfig, root: Path | None = None) -> Path:
    """Write `leagues/<slug>/league.json`. Returns the path written."""
    paths = league_paths(config.slug, root)
    paths["league_dir"].mkdir(parents=True, exist_ok=True)
    data = asdict(config)
    camel = {
        "slug": data["slug"],
        "leagueName": data["league_name"],
        "ootpVersion": data["ootp_version"],
        "team": data["team"],
        "statsplusUrl": data["statsplus_url"],
        "parkFactorMode": data["park_factor_mode"],
        "homeFraction": data["home_fraction"],
        "relativeBlend": data["relative_blend"],
        "osaBlend": data["osa_blend"],
        "scoutWeight": data["scout_weight"],
        "osaWeight": data["osa_weight"],
    }
    league_json = paths["league_json"]
    with league_json.open("w") as f:
        json.dump(camel, f, indent=2)
        f.write("\n")
    return league_json


def list_leagues(root: Path | None = None) -> list[LeagueConfig]:
    """Return all configured leagues, sorted by slug. Skips `.example/` and broken folders."""
    base = (root or project_root()) / "leagues"
    if not base.is_dir():
        return []
    out: list[LeagueConfig] = []
    for child in sorted(base.iterdir()):
        if not child.is_dir() or child.name.startswith("."):
            continue
        league_json = child / "league.json"
        if not league_json.is_file():
            continue
        try:
            out.append(load_league_config(child.name, root))
        except (json.JSONDecodeError, TypeError, ValueError) as e:
            print(f"  Warning: skipping league '{child.name}' — {e}")
    return out


def migrate_legacy_settings(
    legacy_path: Path,
    *,
    slug: str = "default",
    league_name: str = "Default League",
    ootp_version: str = "26",
    root: Path | None = None,
    overwrite: bool = False,
) -> LeagueConfig:
    """Convert an existing `model/pipeline_settings.json` into a new `leagues/<slug>/league.json`.

    Reads the legacy settings, copies all tuning fields, and prepends the
    new identity fields (slug, league_name, ootp_version). Does NOT delete the
    legacy file; that's the caller's responsibility once migration is verified.
    Raises if the destination already exists and `overwrite` is False.
    """
    paths = league_paths(slug, root)
    if paths["league_json"].exists() and not overwrite:
        raise FileExistsError(
            f"Refusing to overwrite existing {paths['league_json']}. "
            f"Pass overwrite=True or pick a different slug."
        )

    saved, _ = load_settings(legacy_path)
    if saved is None:
        raise FileNotFoundError(f"No legacy settings file at {legacy_path}")

    # Build the new directory skeleton so the migrated config has somewhere to live
    paths["league_dir"].mkdir(parents=True, exist_ok=True)
    (paths["league_dir"] / "csv" / "players").mkdir(parents=True, exist_ok=True)
    paths["metadata_dir"].mkdir(parents=True, exist_ok=True)
    paths["output_dir"].mkdir(parents=True, exist_ok=True)

    config = LeagueConfig(
        slug=slug,
        league_name=league_name,
        ootp_version=ootp_version,
        team=saved.team,
        statsplus_url=saved.statsplus_url,
        park_factor_mode=saved.park_factor_mode,
        home_fraction=saved.home_fraction,
        relative_blend=saved.relative_blend,
        osa_blend=saved.osa_blend,
        scout_weight=saved.scout_weight,
        osa_weight=saved.osa_weight,
    )
    save_league_config(config, root)
    return config

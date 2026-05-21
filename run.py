#!/usr/bin/env python3
"""run.py — one-click runner for the OOTP Dashboard.

Walks the user through league selection (or first-time setup), runs the Python
pipeline against the chosen league, starts the React dev server, and opens
the browser when the page is ready.

Pure stdlib — no `pip install` step before this runs.
"""

from __future__ import annotations

import argparse
import json
import os
import signal
import socket
import subprocess
import sys
import time
import webbrowser
from pathlib import Path
from shutil import which
from typing import Optional

ROOT = Path(__file__).resolve().parent
LEAGUES_DIR = ROOT / "leagues"
MODEL_DIR = ROOT / "model"
APP_DIR = ROOT / "app"
LEGACY_SETTINGS = MODEL_DIR / "pipeline_settings.json"
DEV_PORT = 3000

# ---------------------------------------------------------------------------
# Tiny ANSI helpers — no external deps for color output
# ---------------------------------------------------------------------------

_USE_COLOR = sys.stdout.isatty() and os.environ.get("NO_COLOR") is None


def c(text: str, code: str) -> str:
    return f"\033[{code}m{text}\033[0m" if _USE_COLOR else text


def bold(s: str) -> str: return c(s, "1")
def dim(s: str) -> str: return c(s, "2")
def green(s: str) -> str: return c(s, "32")
def yellow(s: str) -> str: return c(s, "33")
def red(s: str) -> str: return c(s, "31")
def cyan(s: str) -> str: return c(s, "36")


def banner(title: str) -> None:
    print()
    print(bold(cyan("== " + title + " ==")))


# ---------------------------------------------------------------------------
# Environment checks
# ---------------------------------------------------------------------------


def find_python() -> str:
    """Return a Python interpreter capable of running the pipeline (>= 3.11)."""
    for candidate in ("python3", "python", "py"):
        path = which(candidate)
        if not path:
            continue
        try:
            out = subprocess.run(
                [path, "-c", "import sys; print(sys.version_info[:2])"],
                capture_output=True, text=True, timeout=5,
            )
        except (subprocess.TimeoutExpired, OSError):
            continue
        if out.returncode == 0 and out.stdout:
            try:
                major, minor = eval(out.stdout.strip())
                if (major, minor) >= (3, 11):
                    return path
            except Exception:
                pass
    sys.exit(red("ERROR: Python 3.11 or newer is required. None of `python3`, `python`, `py` resolved to ≥ 3.11."))


def check_node_npm() -> tuple[str, str]:
    """Return (node_path, npm_path) after verifying Node ≥ 20 and npm exists."""
    node_path = which("node")
    npm_path = which("npm") or which("npm.cmd")  # npm.cmd on Windows
    if not node_path:
        sys.exit(red("ERROR: Node.js not found in PATH. Install Node 20+ from https://nodejs.org and re-run."))
    if not npm_path:
        sys.exit(red("ERROR: npm not found in PATH. It usually ships with Node.js — try reinstalling Node."))
    try:
        out = subprocess.run([node_path, "--version"], capture_output=True, text=True, timeout=5)
        version = out.stdout.strip().lstrip("v")
        major = int(version.split(".")[0])
        if major < 20:
            sys.exit(red(f"ERROR: Node {version} detected; this project needs Node 20+."))
    except (subprocess.TimeoutExpired, ValueError, IndexError):
        print(yellow("  Warning: could not verify Node version, continuing anyway."))
    return node_path, npm_path


# ---------------------------------------------------------------------------
# League discovery + interactive prompts
# ---------------------------------------------------------------------------


def list_leagues() -> list[dict]:
    """Read every leagues/<slug>/league.json into a list of dicts."""
    if not LEAGUES_DIR.is_dir():
        return []
    out = []
    for child in sorted(LEAGUES_DIR.iterdir()):
        if not child.is_dir() or child.name.startswith("."):
            continue
        cfg_path = child / "league.json"
        if not cfg_path.is_file():
            continue
        try:
            with cfg_path.open() as f:
                data = json.load(f)
            data.setdefault("slug", child.name)
            out.append(data)
        except (OSError, json.JSONDecodeError) as e:
            print(yellow(f"  Skipping league '{child.name}': {e}"))
    return out


def _prompt(prompt: str, *, default: Optional[str] = None, allow_empty: bool = False) -> str:
    suffix = f" [{default}]" if default else ""
    while True:
        raw = input(f"  {prompt}{suffix}: ").strip()
        if raw:
            return raw
        if default is not None:
            return default
        if allow_empty:
            return ""
        print(red("    A value is required."))


def _prompt_choice(prompt: str, options: list[str]) -> int:
    """Numbered menu. Returns 0-based index."""
    for i, opt in enumerate(options, 1):
        print(f"    {bold(str(i))}. {opt}")
    while True:
        raw = input(f"  {prompt} (1-{len(options)}): ").strip()
        if raw.isdigit() and 1 <= int(raw) <= len(options):
            return int(raw) - 1
        print(red(f"    Enter a number between 1 and {len(options)}."))


def first_time_setup(slug_default: str = "default") -> str:
    """Create a fresh leagues/<slug>/ skeleton interactively. Returns the slug."""
    banner("First-time league setup")
    print("  No leagues are configured yet. Let's set one up.")
    print(dim("  (Press Ctrl+C at any time to cancel — partial folders will be cleaned up.)"))
    print()
    created: Path | None = None
    try:
        slug = _prompt(
            "League slug (short abbreviation like BLM, SSB, TSB)",
            default=slug_default,
        )
        league_name = _prompt("League display name", default=f"{slug} League")
        ootp_version = _prompt("OOTP version (e.g. 26 or 27)", default="26")
        team = _prompt("Your team's full name (must match a row in ballparks.csv)", default="")
        statsplus_url = _prompt(
            "StatsPlus URL (optional; press Enter to skip) — e.g. https://atl-01.statsplus.net/ssb/",
            default="", allow_empty=True,
        )
        # AAA/AA and OSA companions are auto-detected per CSV; only ask for the
        # weight that controls how scout/OSA are mixed when both exist.
        print(dim("  AAA/AA and OSA companion CSVs are auto-detected per file."))
        while True:
            sw_raw = _prompt(
                "Scout weight 0.0-1.0 (used only when <name>_osa.csv companions exist)",
                default="0.8",
            )
            try:
                scout_weight = float(sw_raw)
                if 0.0 <= scout_weight <= 1.0:
                    break
            except ValueError:
                pass
            print(red("    Enter a number between 0.0 and 1.0."))
        osa_weight = round(1.0 - scout_weight, 4)

        league_dir = LEAGUES_DIR / slug
        if league_dir.exists():
            sys.exit(red(f"ERROR: leagues/{slug}/ already exists. Pick a different slug."))
        created = league_dir
        (league_dir / "csv" / "players").mkdir(parents=True)
        (league_dir / "metadata").mkdir(parents=True)
        (league_dir / "output").mkdir(parents=True)

        config = {
            "slug": slug,
            "leagueName": league_name,
            "ootpVersion": ootp_version,
            "team": team,
            "statsplusUrl": statsplus_url,
            "parkFactorMode": "team",
            "homeFraction": 0.5,
            "relativeBlend": True,
            "osaBlend": True,
            "scoutWeight": scout_weight,
            "osaWeight": osa_weight,
            "seasonWeights": [3, 2, 1],
        }
        (league_dir / "league.json").write_text(json.dumps(config, indent=2) + "\n")

        print()
        print(green(f"  Created leagues/{slug}/"))
        print(f"  Next: drop these files into {bold(f'leagues/{slug}/csv/')}:")
        print(f"    - {bold('players/org.csv')}          (required — MLB + MiLB)")
        print(f"    - {bold('players/intl.csv')}         (optional — IntlComplex; needed when OOTP paginates the org export)")
        print(f"    - {bold('players/freeagents.csv')}    (optional — enables Free Agent Finder)")
        print(f"    - {bold('players/iafa.csv')}          (optional — enables IAFA Board)")
        print(f"    - {bold('players/draftYYYY.csv')}     (optional — one per draft year)")
        print(f"    - {bold('ballparks.csv')}             (required — see leagues/.example/)")
        print()
        print(f"  Then re-run: {bold('python3 run.py --league ' + slug)}")
        sys.exit(0)
    except KeyboardInterrupt:
        if created and created.exists():
            import shutil
            shutil.rmtree(created, ignore_errors=True)
            print()
            print(yellow(f"  Cancelled. Cleaned up leagues/{created.name}/."))
        else:
            print()
            print(yellow("  Cancelled."))
        sys.exit(130)


def _move_legacy_data(slug: str) -> None:
    """Relocate model/data/{players,ballparks.csv,metadata} into leagues/<slug>/."""
    league_dir = LEAGUES_DIR / slug
    legacy_data = MODEL_DIR / "data"
    moves: list[tuple[Path, Path]] = []
    if (legacy_data / "players").is_dir():
        moves.append((legacy_data / "players", league_dir / "csv" / "players"))
    if (legacy_data / "ballparks.csv").is_file():
        moves.append((legacy_data / "ballparks.csv", league_dir / "csv" / "ballparks.csv"))
    if (legacy_data / "metadata").is_dir():
        moves.append((legacy_data / "metadata", league_dir / "metadata"))
    if not moves:
        return

    print()
    print("  The following data folders/files can also be moved into the new league:")
    for src, dst in moves:
        rel_src = src.relative_to(ROOT)
        rel_dst = dst.relative_to(ROOT)
        print(f"    {bold(str(rel_src))}  ->  {bold(str(rel_dst))}")
    print()
    answer = input("  Move data into the new league now? [Y/n]: ").strip().lower()
    if answer not in ("", "y", "yes"):
        print(yellow("  Skipped data move. The pipeline will not run until data lives at the new paths."))
        return

    import shutil
    for src, dst in moves:
        # Files: refuse to overwrite an existing destination.
        if dst.is_file():
            print(yellow(f"  Skipping {src.relative_to(ROOT)} — {dst.relative_to(ROOT)} already exists."))
            continue
        # Directories: an empty placeholder created by the settings migration is
        # fine to merge into; only refuse if the destination already has content.
        if dst.is_dir() and any(dst.iterdir()):
            print(yellow(f"  Skipping {src.relative_to(ROOT)} — {dst.relative_to(ROOT)} already has content."))
            continue
        dst.parent.mkdir(parents=True, exist_ok=True)
        # Copy first so the original is preserved if anything blows up.
        if src.is_dir():
            if dst.is_dir():
                # Merge: copy each child into the existing empty dir.
                for child in src.iterdir():
                    target = dst / child.name
                    if child.is_dir():
                        shutil.copytree(child, target)
                    else:
                        shutil.copy2(child, target)
            else:
                shutil.copytree(src, dst)
            shutil.rmtree(src)
        else:
            shutil.copy2(src, dst)
            src.unlink()
        print(green(f"  Moved {src.relative_to(ROOT)}."))


def maybe_migrate_legacy() -> None:
    """If model/pipeline_settings.json exists and no leagues/ folder yet, offer auto-migration."""
    if not LEGACY_SETTINGS.is_file():
        return
    if LEAGUES_DIR.is_dir() and any(
        (c / "league.json").is_file()
        for c in LEAGUES_DIR.iterdir()
        if c.is_dir() and not c.name.startswith(".")
    ):
        return  # already migrated

    banner("Legacy settings detected")
    print(f"  Found {bold('model/pipeline_settings.json')} from the single-league layout.")
    print(f"  This can be migrated into a new {bold('leagues/default/league.json')} so you")
    print(f"  don't have to re-enter your team and StatsPlus URL.")
    print()
    answer = input(f"  Migrate now? [Y/n]: ").strip().lower()
    if answer not in ("", "y", "yes"):
        return
    sys.path.insert(0, str(MODEL_DIR))
    try:
        from src.settings import migrate_legacy_settings
    except ImportError as e:
        sys.exit(red(f"ERROR: could not import settings module: {e}"))
    try:
        cfg = migrate_legacy_settings(
            LEGACY_SETTINGS,
            slug="default",
            league_name="Default League",
            ootp_version="26",
            root=ROOT,
        )
    except FileExistsError as e:
        print(yellow(f"  Skipped: {e}"))
        return
    print()
    print(green(f"  Migrated settings to leagues/default/league.json (team={cfg.team})."))
    _move_legacy_data(cfg.slug)
    print()
    print(dim(f"  The original {LEGACY_SETTINGS.name} is preserved as an audit trail."))
    print()


# ---------------------------------------------------------------------------
# Pipeline + dev-server orchestration
# ---------------------------------------------------------------------------


def run_pipeline(python: str, slug: str, *, configure: bool, skip_network_check: bool) -> int:
    """Stream the pipeline subprocess. Returns its exit code."""
    cmd = [python, "main.py", "--league", slug]
    if configure:
        cmd.append("--configure")
    if skip_network_check:
        cmd.append("--skip-network-check")
    banner(f"Running pipeline for '{slug}'")
    print(dim(f"  $ cd model && {' '.join(cmd)}"))
    return subprocess.call(cmd, cwd=str(MODEL_DIR))


def ensure_node_modules(npm: str) -> None:
    """Run `npm install` in app/ if node_modules is missing."""
    nm = APP_DIR / "node_modules"
    if nm.is_dir():
        return
    print()
    print(yellow("  app/node_modules not found — installing frontend dependencies."))
    print(dim("  This can take a minute on first run."))
    code = subprocess.call([npm, "install"], cwd=str(APP_DIR))
    if code != 0:
        sys.exit(red(f"ERROR: npm install exited with code {code}."))


def start_dev_server(npm: str) -> subprocess.Popen:
    """Spawn `npm run dev` and return the process handle."""
    banner("Starting dev server")
    kwargs: dict = dict(cwd=str(APP_DIR))
    # On Windows we need a new process group so Ctrl+C in our terminal can be
    # forwarded to the child without killing this script first.
    if os.name == "nt":
        kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP  # type: ignore[attr-defined]
    return subprocess.Popen([npm, "run", "dev"], **kwargs)


def wait_for_port(host: str, port: int, timeout: float = 15.0) -> bool:
    """Poll a TCP port until something accepts a connection, or timeout."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(0.5)
            if s.connect_ex((host, port)) == 0:
                return True
        time.sleep(0.25)
    return False


def stop_dev_server(proc: subprocess.Popen) -> None:
    if proc.poll() is not None:
        return
    try:
        if os.name == "nt":
            proc.send_signal(signal.CTRL_BREAK_EVENT)  # type: ignore[attr-defined]
        else:
            proc.send_signal(signal.SIGINT)
        proc.wait(timeout=5)
    except (subprocess.TimeoutExpired, OSError):
        proc.terminate()
        try:
            proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            proc.kill()


# ---------------------------------------------------------------------------
# Menu
# ---------------------------------------------------------------------------


def pick_league(leagues: list[dict]) -> tuple[str, bool]:
    """Show the league menu. Returns (slug, skip_pipeline)."""
    banner("Select a league")
    labels = [f"{l['slug']} — {l.get('leagueName', l['slug'])} (OOTP {l.get('ootpVersion', '?')})" for l in leagues]
    labels.append(green("+ Add a new league"))
    labels.append(dim("Open existing dashboard (skip pipeline)"))
    idx = _prompt_choice("Choose", labels)
    if idx == len(leagues):
        slug = first_time_setup()  # exits after creation, so this won't return
        return slug, False
    if idx == len(leagues) + 1:
        # Skip pipeline — pick which league's dashboard to open
        sub_idx = _prompt_choice(
            "Open which existing dashboard?",
            [f"{l['slug']} — {l.get('leagueName', l['slug'])}" for l in leagues],
        )
        return leagues[sub_idx]["slug"], True
    return leagues[idx]["slug"], False


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> int:
    parser = argparse.ArgumentParser(
        description="One-click runner for the OOTP Dashboard.",
    )
    parser.add_argument("--league", help="Skip the menu and build this league directly.")
    parser.add_argument("--skip-pipeline", action="store_true", help="Open the existing dashboard without re-running the pipeline.")
    parser.add_argument("--configure", action="store_true", help="Re-prompt pipeline settings even if the input hasn't changed.")
    parser.add_argument("--skip-network-check", action="store_true", help="Skip the StatsPlus URL HEAD probe (use when offline).")
    parser.add_argument("--no-browser", action="store_true", help="Don't open a web browser; just start the dev server.")
    args = parser.parse_args()

    # Environment checks
    python = find_python()
    _, npm = check_node_npm()

    # Legacy migration prompt (one-time)
    maybe_migrate_legacy()

    # Pick a league
    leagues = list_leagues()
    skip_pipeline = args.skip_pipeline
    if args.league:
        slug = args.league
        if not (LEAGUES_DIR / slug / "league.json").is_file():
            sys.exit(red(f"ERROR: leagues/{slug}/league.json not found."))
    elif not leagues:
        slug = first_time_setup()  # exits after creation
        return 0
    else:
        slug, skip_pipeline = pick_league(leagues)

    # Pipeline
    if not skip_pipeline:
        code = run_pipeline(
            python, slug,
            configure=args.configure,
            skip_network_check=args.skip_network_check,
        )
        if code != 0:
            print(red(f"\nPipeline exited with code {code}. Not starting the dev server."))
            return code

    # Frontend
    ensure_node_modules(npm)
    proc = start_dev_server(npm)
    try:
        if wait_for_port("127.0.0.1", DEV_PORT, timeout=15):
            base_url = f"http://localhost:{DEV_PORT}"
            # Pass ?league=<slug> so the SPA opens to the league we just
            # built/selected, not whatever was last persisted in the browser.
            from urllib.parse import quote
            url = f"{base_url}/?league={quote(slug)}"
            print(green(f"\n  Dashboard ready at {bold(base_url)}"))
            if not args.no_browser:
                webbrowser.open(url)
        else:
            print(yellow("  Dev server didn't bind to port 3000 within 15s. Check the log above."))
        # Tail the dev server until the user Ctrl+Cs
        proc.wait()
    except KeyboardInterrupt:
        print()
        print(dim("  Shutting down dev server..."))
        stop_dev_server(proc)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        sys.exit(130)

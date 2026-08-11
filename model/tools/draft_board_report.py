#!/usr/bin/env python3
"""Refresh a league's draft board from StatsPlus and print the top available players.

This is the command-line equivalent of what the Draft Board page does when you
click **🔄 Refresh**: pull the live draft order from ``<api>/draftv2/?all=1``,
drop everyone already taken from the draft class, and rank whoever's left.

Why it exists: the board's "who's still on it" state lives in browser
localStorage, so it can only be read on the machine that ran the pipeline. This
tool reads the same two inputs directly — the built ``dashboard.json`` and the
live draft feed — so the board can be produced from a terminal, scripted, or
shared as text.

Ranking mirrors the board's DEFAULT sort exactly (`_baseVal`, descending), which
is potential WAR:
  - hitters  -> ``prospect.war.max``
  - pitchers -> the better of SP / RP potential WAR, matching
    ``accessors.pickPitcherRole(p, roleHint='best')``
None of the optional Smart Rank toggles (org need, position caps, signability,
Future Value, ...) are applied — those are per-user board settings, not
properties of the draft class. `--fv` adds the Future Value column for reference
but does NOT re-sort.

Examples::

    # one league, board default (top 20)
    python3 model/tools/draft_board_report.py --league BLM-ATL

    # both BLM boards at once, top 20 each
    python3 model/tools/draft_board_report.py --league BLM-ATL --league BLM-NYM --top 20

    # machine-readable
    python3 model/tools/draft_board_report.py --league SSB --format csv > board.csv

Exit codes: 0 on success, 1 when a league can't be resolved (missing dashboard,
no StatsPlus URL, or no draft class in the build).
"""
from __future__ import annotations

import argparse
import csv
import gzip
import io
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "model"))

from src.statsplus import normalize_api_base  # noqa: E402

# ---------------------------------------------------------------------------
# bestPos constants — mirrored from app/src/utils/constants.js so the printed
# "Best" column matches the board. Keep in sync if the frontend spectrum moves.
# ---------------------------------------------------------------------------

_BLM_DEF_SPECTRUM = {
    "C": 19.2, "1B": -10.1, "2B": -0.3, "3B": -0.5,
    "SS": 12.7, "LF": -6.8, "CF": 9.9, "RF": -4.9,
}
_SSB_DEF_SPECTRUM = {
    "C": 22.5, "1B": -8.4, "2B": -0.0, "3B": -1.1,
    "SS": 11.9, "LF": -6.3, "CF": 9.4, "RF": -5.4,
}
# Dashboard slugs fold into 2 underlying universes; unknown slugs -> BLM.
_DEF_SPECTRUM_BY_SLUG = {
    "BLM-ATL": _BLM_DEF_SPECTRUM, "BLM-NYM": _BLM_DEF_SPECTRUM,
    "SSB": _SSB_DEF_SPECTRUM, "default": _SSB_DEF_SPECTRUM,
}
_ARM_THR_BY_SLUG = {"BLM-ATL": 55.2, "BLM-NYM": 55.2, "SSB": 54.6, "default": 54.6}
_ARM_THR_DEFAULT = 55.2
# Hardest -> easiest, so argmax ties resolve in favor of the harder position.
_BESTPOS_FIELD_ORDER = ["C", "SS", "CF", "2B", "3B", "LF", "RF", "1B"]
_SP_REPLACEMENT_WAP = -0.5
_RP_ADVANTAGE_THRESHOLD = 1.0


# ---------------------------------------------------------------------------
# Inputs
# ---------------------------------------------------------------------------


def load_league_config(slug: str) -> dict:
    """Read ``leagues/<slug>/league.json``."""
    path = REPO_ROOT / "leagues" / slug / "league.json"
    if not path.is_file():
        raise FileNotFoundError(
            f"no league config at {path} — is the slug right? "
            f"(available: {', '.join(available_slugs()) or 'none'})"
        )
    return json.loads(path.read_text())


def available_slugs() -> list[str]:
    """Every ``leagues/<slug>/`` that carries a league.json."""
    root = REPO_ROOT / "leagues"
    if not root.is_dir():
        return []
    return sorted(
        p.name for p in root.iterdir()
        if p.is_dir() and not p.name.startswith(".") and (p / "league.json").is_file()
    )


def load_dashboard(slug: str) -> tuple[dict, Path]:
    """Load the built dashboard for a league.

    Checks the pipeline's own output first, then the copy the pipeline drops in
    the app's public dir, preferring the uncompressed sibling when both exist.
    """
    candidates = [
        REPO_ROOT / "leagues" / slug / "output" / "dashboard.json",
        REPO_ROOT / "leagues" / slug / "output" / "dashboard.json.gz",
        REPO_ROOT / "app" / "public" / "data" / slug / "dashboard.json",
        REPO_ROOT / "app" / "public" / "data" / slug / "dashboard.json.gz",
    ]
    for path in candidates:
        if not path.is_file():
            continue
        opener = gzip.open if path.suffix == ".gz" else open
        with opener(path, "rt", encoding="utf-8") as fh:
            return json.load(fh), path
    raise FileNotFoundError(
        f"no built dashboard for '{slug}'. Run: python3 run.py --league {slug}"
    )


def fetch_draft_order(statsplus_url: str, timeout: int = 30) -> list[dict]:
    """Fetch the full draft order from ``<api>/draftv2/?all=1``.

    ``?all=1`` returns every owned slot, made or not — the same feed the board's
    Refresh button uses. Raises on any network / HTTP failure; unlike the build
    pipeline there is nothing to degrade to here, the report IS the draft state.
    """
    base = normalize_api_base(statsplus_url)
    if not base:
        raise ValueError("league.json has no usable statsplusUrl")
    url = f"{base}/draftv2/?all=1"
    try:
        with urllib.request.urlopen(urllib.request.Request(url), timeout=timeout) as resp:
            text = resp.read().decode("utf-8", errors="replace")
    except (urllib.error.URLError, urllib.error.HTTPError, OSError) as e:
        raise RuntimeError(f"could not fetch the draft order from {url} — {e}") from e
    rows = list(csv.DictReader(io.StringIO(text.strip())))
    if rows and "ID" not in rows[0]:
        raise RuntimeError(f"draft order from {url} has no ID column")
    return rows


def is_filled(row: dict) -> bool:
    """A draft-order slot is filled once a player has actually been taken in it.

    Mirrors ``DraftBoard.isFilledRow`` — with ``?all=1`` the not-yet-made slots
    come back with a blank or "0" ID.
    """
    pid = str(row.get("ID") or row.get("id") or "").strip()
    return pid not in ("", "0")


# ---------------------------------------------------------------------------
# Valuation — mirrors app/src/components/boardUtils.js:buildBoardPool
# ---------------------------------------------------------------------------


def _dig(obj, *keys):
    """Nested lookup that returns None instead of raising on a missing branch."""
    for key in keys:
        if not isinstance(obj, dict):
            return None
        obj = obj.get(key)
    return obj


def hitter_values(p: dict) -> tuple[float | None, float | None]:
    """(current WAR, potential WAR) for a hitter — ``maxWar.wtd`` / ``prospect.war.max``."""
    return _dig(p, "maxWar", "wtd"), _dig(p, "prospect", "war", "max")


def pitcher_values(p: dict) -> tuple[float | None, float | None, str]:
    """(current WAR, potential WAR, role) for a pitcher, best-of-role.

    Mirrors ``pickPitcherRole(p, roleHint='best')``: SP values only count when
    the player is SP-eligible (``starter`` or ``starterP``), and RP wins when
    there's no SP potential or its potential is strictly higher.
    """
    sp_eligible = bool(p.get("starter") or p.get("starterP"))
    sp_war = _dig(p, "sp", "wtd", "war") if sp_eligible else None
    sp_war_p = _dig(p, "prospect", "sp", "war") if sp_eligible else None
    rp_war = _dig(p, "rp", "wtd", "war")
    rp_war_p = _dig(p, "prospect", "rp", "war")
    use_rp = sp_war_p is None or (rp_war_p is not None and rp_war_p > sp_war_p)
    if use_rp:
        return rp_war, rp_war_p, "RP"
    return sp_war, sp_war_p, "SP"


def hitter_best_pos(p: dict, slug: str) -> str:
    """Option B bestPos: argmax of (RunsP + defensive spectrum) over eligible spots."""
    spectrum = _DEF_SPECTRUM_BY_SLUG.get(slug, _BLM_DEF_SPECTRUM)
    best_score, best_pos = float("-inf"), None
    for pos in _BESTPOS_FIELD_ORDER:
        node = _dig(p, "positions", pos.lower())
        if not node or not node.get("eligible"):
            continue
        runs_p = _dig(node, "stats", "runsP")
        if runs_p is None:
            continue
        score = runs_p + spectrum.get(pos, 0)
        if score > best_score:  # strict > -> ties go to the harder position
            best_score, best_pos = score, pos
    if best_pos is None:
        if _dig(p, "positions", "dh", "eligible"):
            return "DH"
        return _dig(p, "meta", "pos") or "DH"
    if best_pos in ("LF", "RF"):
        arm = _dig(p, "fieldingRatings", "ofArm")
        thr = _ARM_THR_BY_SLUG.get(slug, _ARM_THR_DEFAULT)
        return "RF" if arm is not None and arm >= thr else "LF"
    return best_pos


def pitcher_best_pos(p: dict) -> str:
    """Pitcher bestPos — ``RP*`` marks an SP-eligible arm that profiles better in relief."""
    if not (p.get("starter") or p.get("starterP")):
        return "RP"
    sp = _dig(p, "prospect", "sp", "war")
    rp = _dig(p, "prospect", "rp", "war")
    if sp is None and rp is None:
        return _dig(p, "meta", "pos") or "RP"
    sp_v = float("-inf") if sp is None else sp
    rp_v = float("-inf") if rp is None else rp
    if sp_v >= _SP_REPLACEMENT_WAP:
        return "RP*" if rp_v - sp_v > _RP_ADVANTAGE_THRESHOLD else "SP"
    return "SP" if sp_v >= rp_v else "RP*"


def future_value(cur, pot, age, gap_max: float = 0.80, gap_exp: int = 3,
                 max_current_age: int = 27) -> float | None:
    """v21 power-law Future Value — ``cur + gap × gapMax × (1 − t^gapExp)``.

    Defaults are ``DEV_CURVE_DEFAULTS`` from the frontend. Reported as a column
    only; the board's default sort is raw potential WAR, so FV never reorders.
    """
    if cur is None:
        return None
    if pot is None or age is None:
        return cur
    if age >= max_current_age or cur > pot:
        return cur
    t = min(1.0, max(0.0, (age - 14) / (max_current_age - 14)))
    return cur + (pot - cur) * max(0.0, gap_max * (1 - t ** gap_exp))


# ---------------------------------------------------------------------------
# Board assembly
# ---------------------------------------------------------------------------


def draft_classes(dash: dict) -> list[str]:
    """Every distinct ``meta.source`` tag that names a draft class, oldest first."""
    seen = set()
    for p in [*dash.get("hitters", []), *dash.get("pitchers", [])]:
        src = str(_dig(p, "meta", "source") or "").strip()
        if src and "draft" in src.lower():
            seen.add(src)
    return sorted(seen)


def build_board(dash: dict, slug: str, draft_class: str | None, drafted_ids: set[str]) -> list[dict]:
    """The available pool: the chosen draft class minus everyone already taken."""
    def in_class(p):
        src = str(_dig(p, "meta", "source") or "").strip()
        if draft_class is None:
            return "draft" in src.lower()
        return src == draft_class

    rows = []
    for p in dash.get("hitters", []):
        if not in_class(p):
            continue
        cur, pot = hitter_values(p)
        rows.append(_row(p, cur, pot, hitter_best_pos(p, slug)))
    for p in dash.get("pitchers", []):
        if not in_class(p):
            continue
        cur, pot, _role = pitcher_values(p)
        rows.append(_row(p, cur, pot, pitcher_best_pos(p)))

    rows = [r for r in rows if r["id"] not in drafted_ids]
    # The board's default sort: _baseVal (potential WAR) descending, absent
    # potential treated as 0 exactly as buildBoardPool does.
    rows.sort(key=lambda r: r["warP"] if r["warP"] is not None else 0.0, reverse=True)
    return rows


def _row(p: dict, cur, pot, best_pos: str) -> dict:
    meta = p.get("meta", {}) or {}
    age = meta.get("age")
    return {
        "id": str(p.get("id") or p.get("ID") or ""),
        "name": meta.get("name") or "",
        "pos": meta.get("pos") or "",
        "bestPos": best_pos,
        "age": age,
        "war": cur,
        "warP": pot,
        "fv": future_value(cur, pot, age),
        "ovr": meta.get("ovr"),
        "pot": meta.get("pot"),
        "prone": meta.get("prone") or "",
        "dem": meta.get("dem") or "",
        "sign": meta.get("sign") or "",
    }


# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------


def _fmt(v, places: int = 2) -> str:
    if v is None:
        return "—"
    if isinstance(v, float):
        return f"{v:.{places}f}"
    return str(v)


def print_table(rows: list[dict], top: int, show_fv: bool, show_dem: bool) -> None:
    cols = [("#", 3), ("Name", 22), ("POS", 4), ("Best", 5), ("Age", 4), ("WAR P", 7), ("WAR", 7)]
    if show_fv:
        cols.append(("FV", 7))
    cols += [("OVR", 4), ("POT", 4), ("Prone", 9)]
    if show_dem:
        cols += [("DEM", 10), ("Sign", 14)]
    print("  ".join(h.ljust(w) for h, w in cols).rstrip())
    print("  ".join("-" * w for _h, w in cols))
    for i, r in enumerate(rows[:top], 1):
        cells = [
            str(i).ljust(3), (r["name"] or "")[:22].ljust(22), (r["pos"] or "")[:4].ljust(4),
            (r["bestPos"] or "")[:5].ljust(5), _fmt(r["age"], 0).ljust(4),
            _fmt(r["warP"]).rjust(7), _fmt(r["war"]).rjust(7),
        ]
        if show_fv:
            cells.append(_fmt(r["fv"]).rjust(7))
        cells += [_fmt(r["ovr"]).rjust(4), _fmt(r["pot"]).rjust(4), (r["prone"] or "")[:9].ljust(9)]
        if show_dem:
            cells += [(str(r["dem"]) or "")[:10].ljust(10), (r["sign"] or "")[:14].ljust(14)]
        print("  ".join(cells).rstrip())


def report_league(slug: str, top: int, draft_class: str | None, fmt: str,
                  show_fv: bool, writer: csv.DictWriter | None) -> int:
    """Run the whole refresh-and-rank for one league. Returns an exit code."""
    cfg = load_league_config(slug)
    dash, dash_path = load_dashboard(slug)
    classes = draft_classes(dash)
    if not classes:
        print(f"[{slug}] no draft class in {dash_path.name} — nothing to rank.", file=sys.stderr)
        return 1
    chosen = draft_class or classes[-1]  # newest class by default
    if chosen not in classes:
        print(f"[{slug}] no draft class '{chosen}'. Available: {', '.join(classes)}", file=sys.stderr)
        return 1

    order = fetch_draft_order(cfg.get("statsplusUrl", ""))
    made = [r for r in order if is_filled(r)]
    drafted_ids = {str(r.get("ID") or r.get("id")).strip() for r in made}
    rows = build_board(dash, slug, chosen, drafted_ids)
    total_class = len(build_board(dash, slug, chosen, set()))

    if fmt == "csv":
        for i, r in enumerate(rows[:top], 1):
            writer.writerow({"league": slug, "rank": i, **r})
        return 0

    team = cfg.get("team") or "—"
    my_slots = [r for r in order if (r.get("Team") or "") == team]
    my_made = [r for r in my_slots if is_filled(r)]
    print()
    print(f"═══ {slug} — {cfg.get('leagueName', slug)} ({team}) ".ljust(96, "═"))
    print(f"  dashboard   {dash_path.relative_to(REPO_ROOT)}")
    print(f"  built       {_dig(dash, 'meta', 'generatedAt') or '—'}   "
          f"game date {_dig(dash, 'meta', 'gameDate') or '—'}")
    print(f"  draft class {chosen}"
          + (f"   (also built: {', '.join(c for c in classes if c != chosen)})" if len(classes) > 1 else ""))
    print(f"  draft feed  {len(made)} of {len(order)} slots made "
          f"→ {len(rows)} of {total_class} available")
    print(f"  your picks  {len(my_made)} made, {len(my_slots) - len(my_made)} upcoming "
          f"(of {len(my_slots)} owned)")
    print()
    show_dem = any(r["dem"] for r in rows[:top])
    print_table(rows, top, show_fv, show_dem)
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Refresh a league's draft board from StatsPlus and print the best available.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    ap.add_argument("--league", "-l", action="append", dest="leagues", metavar="SLUG",
                    help="league slug; repeat for several boards in one run")
    ap.add_argument("--top", "-n", type=int, default=20, help="players to list per league (default 20)")
    ap.add_argument("--draft-class", default=None, metavar="NAME",
                    help='draft class to rank, e.g. "Draft 2058" (default: newest built)')
    ap.add_argument("--format", choices=["table", "csv"], default="table",
                    help="table (default) or csv to stdout")
    ap.add_argument("--fv", action="store_true",
                    help="add the Future Value column (does not change the sort)")
    args = ap.parse_args()

    slugs = args.leagues or available_slugs()
    if not slugs:
        print("no leagues found under leagues/", file=sys.stderr)
        return 1

    writer = None
    if args.format == "csv":
        writer = csv.DictWriter(sys.stdout, fieldnames=[
            "league", "rank", "id", "name", "pos", "bestPos", "age", "war", "warP",
            "fv", "ovr", "pot", "prone", "dem", "sign",
        ])
        writer.writeheader()

    rc = 0
    for slug in slugs:
        try:
            rc |= report_league(slug, args.top, args.draft_class, args.format, args.fv, writer)
        except (FileNotFoundError, ValueError, RuntimeError) as e:
            print(f"[{slug}] {e}", file=sys.stderr)
            rc = 1
    return rc


if __name__ == "__main__":
    raise SystemExit(main())

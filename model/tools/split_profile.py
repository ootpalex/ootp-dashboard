#!/usr/bin/env python3
"""How common are mixed L/R platoon splits? — a population report per league.

OOTP rates every hitter and pitcher twice, once vs LHP and once vs RHP. Almost
every player's grades all lean the same way, because the platoon advantage that
drives the split is a single underlying trait: a RH batter is better vs LHP at
all six hitting attributes, a LH pitcher better vs LHB at all five pitching
ones. A player who is better vs L at one attribute and better vs R at another
("mixed") is the rare exception — this tool counts how rare, per league.

It reads the RAW scout exports in ``leagues/<slug>/csv/players/``, i.e. the
quantized 20-80 grades OOTP itself displays, deliberately NOT the pipeline's
blended ratings: blending a pair of grades that are equal in-game routinely
lands them 1-2 points apart, which reads as a reverse split that no one can see
in the game. The dashboard's L/R Splits filter profiles the same as-scouted
grades (``ratings.scouted``, snapshotted in ``src/players.py``), so a category's
share here and the app's split breakdown for the same pool agree.

Every OOTP rating on this scale reads higher = better (K = avoid strikeouts,
HRR = HR allowed, PBABIP = BABIP allowed), so a plain numeric comparison per
attribute gives the direction with no per-attribute inversion.

Usage (from the repo root or the model/ directory):
    python3 model/tools/split_profile.py                    # every league
    python3 model/tools/split_profile.py --league SSB
    python3 model/tools/split_profile.py --league SSB --source org.csv
    python3 model/tools/split_profile.py --csv-dir path/to/players

Read-only: touches nothing but the CSVs it reads.
"""
from __future__ import annotations

import argparse
import csv
import sys
from collections import Counter, defaultdict
from pathlib import Path

MODEL_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(MODEL_DIR))

from src.settings import league_paths, list_leagues, project_root  # noqa: E402

# (output key, CSV caption base). OOTP exports "CON vL"/"CON vR" twice — hitter
# contact first, pitcher control second — so the pitcher side takes occurrence 2.
HITTER_ATTRS = [("BABIP", "BA", 0), ("CON", "CON", 0), ("GAP", "GAP", 0),
                ("POW", "POW", 0), ("EYE", "EYE", 0), ("K", "K", 0)]
PITCHER_ATTRS = [("STU", "STU", 0), ("MOV", "MOV", 0), ("CON", "CON", 1),
                 ("BABIP", "PBABIP", 0), ("HRR", "HRR", 0)]

PITCHER_POSITIONS = {"SP", "RP", "CL", "P"}
# Levels where the scouting is complete enough that a 1-grade gap means
# something; the low minors are heavily fuzzed and drown the signal in ties.
FULL_LEVELS = {"MLB", "AAA", "AA"}

# Default sources: rostered players plus free agents. Draft and IAFA classes are
# available via --source but are excluded by default — their grades carry much
# wider scouting error than a player you have actually seen.
DEFAULT_SOURCES = ("org.csv", "intl.csv", "freeagents.csv")


class Player:
    __slots__ = ("name", "pos", "lev", "hand", "ovr", "is_pitcher", "vals")

    def __init__(self, name, pos, lev, hand, ovr, is_pitcher, vals):
        self.name, self.pos, self.lev = name, pos, lev
        self.hand, self.ovr, self.is_pitcher, self.vals = hand, ovr, is_pitcher, vals


def _cell(row: list[str], idx: int | None) -> str:
    return row[idx].strip() if idx is not None and idx < len(row) else ""


def _grade(row: list[str], idx: int | None) -> int | None:
    raw = _cell(row, idx)
    if raw in ("", "-"):
        return None
    try:
        return int(float(raw))
    except ValueError:
        return None


def read_csv(path: Path) -> list[Player]:
    """Parse one raw OOTP player export into Players carrying their L/R grades."""
    with path.open(newline="", encoding="utf-8-sig") as fh:
        reader = csv.reader(fh)
        try:
            header = next(reader)
        except StopIteration:
            return []
        # Index by caption AND occurrence — the header has real duplicates.
        cols: dict[str, list[int]] = defaultdict(list)
        for i, caption in enumerate(header):
            cols[caption.strip()].append(i)

        def idx(caption: str, occurrence: int = 0) -> int | None:
            found = cols.get(caption, [])
            if not found:
                return None
            return found[occurrence] if occurrence < len(found) else found[0]

        need = ("POS", "Name", "Lev", "B", "T", "OVR")
        if any(idx(c) is None for c in need):
            return []
        rating_idx = {
            kind: {label: (idx(f"{base} vL", occ), idx(f"{base} vR", occ))
                   for label, base, occ in attrs}
            for kind, attrs in (("H", HITTER_ATTRS), ("P", PITCHER_ATTRS))
        }

        players = []
        for row in reader:
            if not row:
                continue
            pos = _cell(row, idx("POS"))
            is_pitcher = pos in PITCHER_POSITIONS
            vals = {}
            for label, (li, ri) in rating_idx["P" if is_pitcher else "H"].items():
                lv, rv = _grade(row, li), _grade(row, ri)
                if lv is None or rv is None:
                    vals = {}
                    break
                vals[label] = (lv, rv)
            if not vals:
                continue  # unrated / unscouted on this side — nothing to classify
            players.append(Player(
                name=_cell(row, idx("Name")),
                pos=pos,
                lev=_cell(row, idx("Lev")),
                hand=_cell(row, idx("T" if is_pitcher else "B")),
                ovr=_grade(row, idx("OVR")),
                is_pitcher=is_pitcher,
                vals=vals,
            ))
        return players


def classify(player: Player) -> tuple[str, list[str]]:
    """Return (tilt, reversed_attributes) for one player.

    tilt is "vL" / "vR" when every non-tied attribute leans the same way,
    "mixed" when at least one leans each way, "even" when all are tied. The
    reversed attributes are a mixed player's minority side — the ones bucking
    his overall lean — and are empty for every other tilt.
    """
    better_l = [a for a, (l, r) in player.vals.items() if l > r]
    better_r = [a for a, (l, r) in player.vals.items() if r > l]
    if better_l and better_r:
        return "mixed", (better_l if len(better_l) <= len(better_r) else better_r)
    if better_l:
        return "vL", []
    if better_r:
        return "vR", []
    return "even", []


def reversal_gap(player: Player, odd: list[str]) -> int:
    """Largest L/R gap, in rating points, on a mixed player's reversed side.

    OOTP grades come in 5-point steps, so this is a whole number of grades. It
    is the other half of "how unusual is this player": mixed is rare to begin
    with, and a reversal wider than a single grade is rarer still.
    """
    return max(abs(player.vals[a][0] - player.vals[a][1]) for a in odd)


def report(pool: list[Player], label: str) -> None:
    n = len(pool)
    if n == 0:
        return
    tilts = Counter()
    reversals = Counter()
    gaps = Counter()
    lone = 0
    mixed: list[tuple[Player, list[str], int]] = []
    for p in pool:
        tilt, odd = classify(p)
        tilts[tilt] += 1
        if tilt == "mixed":
            gap = reversal_gap(p, odd)
            mixed.append((p, odd, gap))
            gaps[gap] += 1
            if len(odd) == 1:
                lone += 1
                reversals[odd[0]] += 1

    def line(text: str, count: int) -> str:
        return f"     {text:<58}{count:6d}  {100 * count / n:5.2f}%"

    print(f"\n  {label}  (n={n})")
    print(line("mixed — better vs L at one attribute, vs R at another", tilts["mixed"]))
    print(line("uniformly better vs LHP", tilts["vL"]))
    print(line("uniformly better vs RHP", tilts["vR"]))
    print(line("no lean at all — every attribute tied", tilts["even"]))
    if reversals:
        print(f"     of the {tilts['mixed']} mixed, {lone} reverse exactly ONE attribute:")
        for attr, count in reversals.most_common():
            print(f"        {attr:<7}{count:5d}   ({100 * count / lone:5.1f}% of those)")
    if gaps:
        print("     how far the reversed attribute actually swings:")
        for gap in sorted(gaps):
            grades = gap // 5
            plural = "" if grades == 1 else "s"
            print(f"        {grades} grade{plural} ({gap:>2} pts){gaps[gap]:5d}"
                  f"   ({100 * gaps[gap] / tilts['mixed']:5.1f}% of mixed)")
    if mixed and label.startswith("AA/AAA/MLB"):
        print("     the mixed players (grades shown vL/vR):")
        for p, odd, gap in sorted(mixed, key=lambda m: (-m[2], -(m[0].ovr or 0))):
            grades = "  ".join(f"{a}:{l}/{r}" for a, (l, r) in p.vals.items())
            print(f"        {p.name[:22]:<22} {p.pos:<3} {p.hand} {p.lev:<4} "
                  f"OVR{p.ovr if p.ovr is not None else 0:>3}  "
                  f"[{'/'.join(odd)} by {gap // 5}]  {grades}")


def run_dir(players_dir: Path, sources: tuple[str, ...], title: str) -> bool:
    paths = [players_dir / name for name in sources]
    paths = [p for p in paths if p.is_file()]
    if not paths:
        print(f"\n{title}: no matching CSVs in {players_dir} — skipped")
        return False
    players: list[Player] = []
    for path in paths:
        players.extend(read_csv(path))
    print("\n" + "=" * 78)
    print(f"{title}   [{', '.join(p.name for p in paths)}]")
    for is_pitcher, heading in ((False, "HITTERS   BABIP / CON / GAP / POW / EYE / K"),
                                (True, "PITCHERS  STU / MOV / CON / BABIP / HRR")):
        pool = [p for p in players if p.is_pitcher == is_pitcher]
        if not pool:
            continue
        print(f"\n  {heading}")
        report(pool, "every scouted player")
        report([p for p in pool if p.lev in FULL_LEVELS], "AA/AAA/MLB only")
        for hand in ("R", "L", "S"):
            report([p for p in pool if p.hand == hand],
                   f"{'throws' if is_pitcher else 'bats'} {hand}")
    return True


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Count how many players have mixed (reversed) L/R split grades.")
    ap.add_argument("--league", help="League slug. Default: every configured league.")
    ap.add_argument("--csv-dir", type=Path,
                    help="Read this player-CSV directory directly instead of a league.")
    ap.add_argument("--source", action="append", metavar="FILE",
                    help=f"CSV filename to include; repeatable. "
                         f"Default: {', '.join(DEFAULT_SOURCES)}.")
    args = ap.parse_args()

    sources = tuple(args.source) if args.source else DEFAULT_SOURCES

    if args.csv_dir:
        return 0 if run_dir(args.csv_dir, sources, str(args.csv_dir)) else 1

    if args.league:
        players_dir = league_paths(args.league)["player_dir"]
        if not players_dir.is_dir():
            print(f"No player CSVs for league '{args.league}' at {players_dir}")
            return 1
        return 0 if run_dir(players_dir, sources, args.league) else 1

    leagues = list_leagues()
    if not leagues:
        print(f"No leagues configured under {project_root() / 'leagues'}")
        return 1
    any_read = False
    for cfg in leagues:
        any_read |= run_dir(league_paths(cfg.slug)["player_dir"], sources, cfg.slug)
    return 0 if any_read else 1


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Derive positional depth-share weight curves (``SLOT_SHARES``) from real
playing-time data, for the frontend Team Positional Strength engine.

The slot weights answer "what share of a position's playing time does the
1st / 2nd / 3rd ... player on the depth chart actually take?" — used to weight
each depth slot's WAR in ``app/src/utils/strength.js`` so a starter dominates,
depth contributes with diminishing weight, and deep scrubs ~vanish.

Source: per-league ``leagues/<slug>/metadata/`` MLB-only season stats:
  - hitters:  ``fielding_data_<pos>.csv``  -> ``IP Clean`` (defensive innings AT that position)
  - pitchers: ``sp_data.csv`` / ``rp_data.csv`` -> ``IP Clean``

Method: per (team, position) rank players by position innings, take each rank's
share of the team-position total, then average the share at each rank across all
unique team-seasons. The MEAN is used deliberately: the share distribution is
left-skewed (most teams run a healthy starter ~0.74-0.82, but a tail of
injury/platoon seasons pulls the mean to ~0.66-0.73), so the mean is already
moderately conservative / depth-favoring without extra assumptions.

Data-hygiene rules (validated 2026-05-19):
  - Some dashboards share one byte-identical league-wide metadata export (e.g. the
    four BLM-* team dashboards). Dedupe leagues by file content hash.
  - Exclude the ``ORG = "-"`` free-agent / unaffiliated bucket (not a real team).

Run from the repo root:  ``python model/tools/compute_slot_shares.py``
Paste the printed ``SLOT_SHARES`` object into ``app/src/utils/constants.js``.
"""
from __future__ import annotations

import csv
import glob
import hashlib
import os
from collections import defaultdict

# Non-team ORG buckets to drop.
EXCLUDE_ORG = {"-", "", "0", "--"}

# (position key, source file, display depth). Keys match the lowercase nested
# JSON position keys used by the frontend accessors.
GROUPS: list[tuple[str, str, int]] = [
    ("c", "fielding_data_c.csv", 4),
    ("1b", "fielding_data_1b.csv", 5),
    ("2b", "fielding_data_2b.csv", 5),
    ("3b", "fielding_data_3b.csv", 5),
    ("ss", "fielding_data_ss.csv", 5),
    ("lf", "fielding_data_lf.csv", 5),
    ("cf", "fielding_data_cf.csv", 5),
    ("rf", "fielding_data_rf.csv", 5),
    ("sp", "sp_data.csv", 8),
    ("rp", "rp_data.csv", 7),
]


def _file_hash(path: str) -> str:
    with open(path, "rb") as f:
        return hashlib.md5(f.read()).hexdigest()


def discover_metadata_dirs(root: str) -> list[str]:
    """Return metadata dirs, deduped so leagues sharing one identical export
    are counted once. Dedupe key = content hash of fielding_data_ss.csv."""
    dirs = sorted(
        d for d in glob.glob(os.path.join(root, "leagues", "*", "metadata"))
        if os.path.exists(os.path.join(d, "fielding_data_ss.csv"))
    )
    seen: dict[str, str] = {}
    for d in dirs:
        h = _file_hash(os.path.join(d, "fielding_data_ss.csv"))
        seen.setdefault(h, d)  # keep the first dir for each unique export
    return sorted(seen.values())


def share_vectors(metadata_dirs: list[str], fname: str) -> list[list[float]]:
    """One descending share-vector per (team, season) for the given file."""
    vecs: list[list[float]] = []
    for d in metadata_dirs:
        path = os.path.join(d, fname)
        if not os.path.exists(path):
            continue
        by_org: dict[str, list[float]] = defaultdict(list)
        with open(path, newline="") as f:
            for row in csv.DictReader(f):
                org = (row.get("ORG") or "").strip()
                if org in EXCLUDE_ORG:
                    continue
                try:
                    ip = float(row.get("IP Clean") or 0)
                except (TypeError, ValueError):
                    ip = 0.0
                if ip > 0:
                    by_org[org].append(ip)
        for ips in by_org.values():
            ips.sort(reverse=True)
            total = sum(ips)
            if total > 0:
                vecs.append([v / total for v in ips])
    return vecs


def mean_curve(vecs: list[list[float]], depth: int) -> list[float]:
    if not vecs:
        return [0.0] * depth
    padded = [v[:depth] + [0.0] * (depth - len(v)) for v in vecs]
    n = len(padded)
    return [round(sum(row[k] for row in padded) / n, 3) for k in range(depth)]


def main() -> None:
    root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    dirs = discover_metadata_dirs(root)
    print(f"# unique metadata exports pooled ({len(dirs)}):")
    for d in dirs:
        print(f"#   {os.path.relpath(d, root)}")

    hit: dict[str, list[float]] = {}
    sp: list[float] = []
    rp: list[float] = []
    for key, fname, depth in GROUPS:
        vecs = share_vectors(dirs, fname)
        curve = mean_curve(vecs, depth)
        n = len(vecs)
        if key == "sp":
            sp = curve
        elif key == "rp":
            rp = curve
        else:
            hit[key] = curve
        print(f"#   {key:3} (n={n:3})  {curve}")

    # Emit a ready-to-paste JS object.
    def js_arr(a: list[float]) -> str:
        return "[" + ", ".join(f"{x:.3f}" for x in a) + "]"

    print("\nexport const SLOT_SHARES = {")
    print("  hit: {")
    for key in ("c", "1b", "2b", "3b", "ss", "lf", "cf", "rf"):
        jskey = key if key.isalpha() else f'"{key}"'
        print(f"    {jskey}: {js_arr(hit[key])},")
    print("  },")
    print(f"  sp: {js_arr(sp)},")
    print(f"  rp: {js_arr(rp)},")
    print("};")


if __name__ == "__main__":
    main()

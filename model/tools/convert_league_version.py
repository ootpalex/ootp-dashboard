#!/usr/bin/env python3
"""convert_league_version.py — seamless league engine-version converter.

Builds the first post-boundary metadata season for a league from live StatsPlus
data + a scout ratings dump, sets ``engineFirstSeason`` in league.json, and
validates the result through the production loaders including the OOTP-27
fielding C2 gate.

Run from model/:
    python3 tools/convert_league_version.py --league BLM-ATL --to 27 --first-season 2058 \
        --scout-ratings path/to/ratings_scout_YYYY-MM-DD.csv.gz [--season N] [--dry-run]
"""
from __future__ import annotations

import argparse, csv, dataclasses, gzip, io, json, re, sys, tempfile, urllib.request
from pathlib import Path

MODEL = Path(__file__).resolve().parents[1]
REPO = MODEL.parent
sys.path.insert(0, str(MODEL))

UA = "OOTPDashboard-convert-league-version/0.1 (minimize-load)"
POS_SUFFIX = {1: "p", 2: "c", 3: "1b", 4: "2b", 5: "3b", 6: "ss", 7: "lf", 8: "cf", 9: "rf"}
POSNUM = {"SP": 1, "RP": 1, "CL": 1, "P": 1, "C": 2, "1B": 3, "2B": 4, "3B": 5,
          "SS": 6, "LF": 7, "CF": 8, "RF": 9, "DH": 0}
HITTING_HEADER = ["ID", "Name", "ORG", "G", "GS", "PA", "AB", "H", "1B", "2B", "3B", "HR",
                  "RBI", "R", "BB", "IBB", "HP", "SH", "SF", "CI", "SO", "GIDP", "PI/PA",
                  "SB", "CS", "UBR"]
PITCHING_HEADER = ["ID", "Name", "ORG", "G", "GS", "W", "L", "IP", "BF", "AB", "HA",
                   "1B", "2B", "3B", "HR", "R", "ER", "BB", "IBB", "K", "HP", "SH", "SF",
                   "WP", "BK", "CI", "DP", "IR", "IRS", "PI", "GB", "FB", "SB", "CS"]
FIELDING_HEADER = ["ID", "Name", "ORG", "POS", "G", "GS", "TC", "A", "PO", "E", "DP", "TP",
                   "ZR", "SBA", "RTO", "IP", "PB", "CER",
                   "BIZ-R", "BIZ-Rm", "BIZ-L", "BIZ-Lm", "BIZ-E", "BIZ-Em",
                   "BIZ-U", "BIZ-Um", "BIZ-Z", "BIZ-Zm", "BIZ-I", "FRM", "ARM"]
BATTER_R_HEADER = ["ID", "POS", "Name", "PA", "B", "BA vL", "GAP vL", "POW vL", "EYE vL",
                   "K vL", "BA vR", "GAP vR", "POW vR", "EYE vR", "K vR", "SPE", "STE", "RUN", "SR"]
PITCHER_R_HEADER = ["ID", "POS", "Name", "BF", "T", "STU vL", "HRR vL", "PBABIP vL", "CON vL",
                    "STU vR", "HRR vR", "PBABIP vR", "CON vR", "HLD"]
FIELDING_R_HEADER = ["ID", "POS", "Name", "IP", "HT", "C ABI", "C FRM", "C ARM", "IF RNG",
                     "IF ERR", "IF ARM", "TDP", "OF RNG", "OF ERR", "OF ARM"]


def warn(msg: str) -> None:
    print(f"\n{'!' * 78}\n!! WARNING: {msg}\n{'!' * 78}\n")


def get_csv(api_base: str, endpoint: str, params: dict | None = None) -> list[dict]:
    url = f"{api_base}/{endpoint.strip('/')}/"
    if params:
        url += "?" + "&".join(f"{k}={v}" for k, v in params.items())
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Encoding": "gzip"})
    with urllib.request.urlopen(req, timeout=90) as r:
        raw = r.read()
        if (r.headers.get("Content-Encoding") or "") == "gzip":
            raw = gzip.decompress(raw)
    return list(csv.DictReader(io.StringIO(raw.decode("utf-8", "replace"))))


def i0(v) -> int:
    try:
        return int(v) if v not in ("", None) else 0
    except (ValueError, TypeError):
        return 0


def ip_thirds(s: str) -> float:
    try:
        whole, frac = str(s or "0.0").split(".")
        return int(whole) + int(frac) / 3.0
    except ValueError:
        return 0.0


def aggregate_stints(rows: list[dict], keys: tuple[str, ...]) -> list[dict]:
    """One row per key-tuple: sum integer stat columns, keep latest stint's metadata."""
    skip = {"id", "player_id", "year", "team_id", "game_id", "league_id",
            "level_id", "split_id", "position", "stint"}
    groups: dict[tuple, list[dict]] = {}
    for r in rows:
        groups.setdefault(tuple(r.get(k, "") for k in keys), []).append(r)
    out = []
    for grp in groups.values():
        if len(grp) == 1:
            out.append(grp[0]); continue
        grp = sorted(grp, key=lambda r: i0(r.get("stint")))
        merged = dict(grp[-1])
        for col in grp[0]:
            if col in skip:
                continue
            try:
                merged[col] = str(sum(int(r.get(col, "0") or 0) for r in grp))
            except ValueError:
                pass
        out.append(merged)
    return out


def write_rows(path: Path, header: list[str], rows: list[dict]) -> None:
    with open(path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=header, extrasaction="ignore")
        w.writeheader(); w.writerows(rows)


def build_stats(api_base: str, year: int, out: Path) -> dict:
    """Fetch season stats and write hitting/pitching/sp/rp/fielding CSVs. Returns lookups."""
    teams = get_csv(api_base, "teams")
    by_id = {t["ID"]: t for t in teams}
    org = {}
    for tid in by_id:
        cur, seen = by_id[tid], set()
        while (p := cur.get("Parent Team ID", "") or "") not in ("", "0") and p not in seen:
            seen.add(p)
            if p not in by_id:
                break
            cur = by_id[p]
        org[tid] = f"{(cur.get('Name') or '').strip()} {(cur.get('Nickname') or '').strip()}".strip() or "-"
    names = {p["ID"]: f"{(p.get('First Name') or '').strip()} {(p.get('Last Name') or '').strip()}".strip()
             for p in get_csv(api_base, "players") if p.get("ID")}

    def ident(a):
        return {"ID": a["player_id"], "Name": names.get(a["player_id"], ""),
                "ORG": org.get(a.get("team_id", ""), "-")}

    bat = aggregate_stints(get_csv(api_base, "playerbatstatsv2", {"year": year, "split": 1}),
                           ("player_id",))
    hitting = []
    for a in bat:
        pa = i0(a.get("pa"))
        hitting.append({**ident(a), "G": a.get("g", "0"), "GS": a.get("gs", "0"),
            "PA": a.get("pa", "0"), "AB": a.get("ab", "0"), "H": a.get("h", "0"),
            "1B": str(i0(a.get("h")) - i0(a.get("d")) - i0(a.get("t")) - i0(a.get("hr"))),
            "2B": a.get("d", "0"), "3B": a.get("t", "0"), "HR": a.get("hr", "0"),
            "RBI": a.get("rbi", "0"), "R": a.get("r", "0"), "BB": a.get("bb", "0"),
            "IBB": a.get("ibb", "0"), "HP": a.get("hp", "0"), "SH": a.get("sh", "0"),
            "SF": a.get("sf", "0"), "CI": a.get("ci", "0"), "SO": a.get("k", "0"),
            "GIDP": a.get("gdp", "0"),
            "PI/PA": f"{i0(a.get('pitches_seen')) / pa:.2f}" if pa else "0.00",
            "SB": a.get("sb", "0"), "CS": a.get("cs", "0"), "UBR": a.get("ubr", "0")})
    write_rows(out / "hitting_data.csv", HITTING_HEADER, hitting)

    pit = aggregate_stints(get_csv(api_base, "playerpitchstatsv2", {"year": year, "split": 1}),
                           ("player_id",))
    pitching = [{**ident(a), "G": a.get("g", "0"), "GS": a.get("gs", "0"),
        "W": a.get("w", "0"), "L": a.get("l", "0"),
        "IP": f"{i0(a.get('ip'))}.{i0(a.get('ipf'))}", "BF": a.get("bf", "0"),
        "AB": a.get("ab", "0"), "HA": a.get("ha", "0"), "1B": a.get("sa", "0"),
        "2B": a.get("da", "0"), "3B": a.get("ta", "0"), "HR": a.get("hra", "0"),
        "R": a.get("r", "0"), "ER": a.get("er", "0"), "BB": a.get("bb", "0"),
        "IBB": a.get("iw", "0"), "K": a.get("k", "0"), "HP": a.get("hp", "0"),
        "SH": a.get("sh", "0"), "SF": a.get("sf", "0"), "WP": a.get("wp", "0"),
        "BK": a.get("bk", "0"), "CI": a.get("ci", "0"), "DP": a.get("dp", "0"),
        "IR": a.get("ir", "0"), "IRS": a.get("irs", "0"), "PI": a.get("pi", "0"),
        "GB": a.get("gb", "0"), "FB": a.get("fb", "0"), "SB": a.get("sb", "0"),
        "CS": a.get("cs", "0")} for a in pit]
    write_rows(out / "pitching_data.csv", PITCHING_HEADER, pitching)
    write_rows(out / "sp_data.csv", PITCHING_HEADER, [r for r in pitching if i0(r["GS"]) > 0])
    write_rows(out / "rp_data.csv", PITCHING_HEADER, [r for r in pitching if i0(r["GS"]) == 0])

    fld = aggregate_stints(get_csv(api_base, "playerfieldstatsv2", {"year": year, "split": 1}),
                           ("player_id", "position"))
    fielding = [{**ident(a), "POS": a.get("position", "0"), "G": a.get("g", "0"),
        "GS": a.get("gs", "0"), "TC": a.get("tc", "0"), "A": a.get("a", "0"),
        "PO": a.get("po", "0"), "E": a.get("e", "0"), "DP": a.get("dp", "0"),
        "TP": a.get("tp", "0"), "ZR": a.get("zr", "0"), "SBA": a.get("sba", "0"),
        "RTO": a.get("rto", "0"), "IP": f"{i0(a.get('ip'))}.{i0(a.get('ipf'))}",
        "PB": a.get("pb", "0"), "CER": a.get("er", "0"),
        **{f"BIZ-{z}": a.get(f"opps_{k}", "0") for k, z in enumerate("RLEUZ")},
        **{f"BIZ-{z}m": a.get(f"opps_made_{k}", "0") for k, z in enumerate("RLEUZ")},
        "BIZ-I": a.get("opps_5", "0"), "FRM": a.get("framing", "0"),
        "ARM": a.get("arm", "0")} for a in fld]
    for num, suf in POS_SUFFIX.items():
        write_rows(out / f"fielding_data_{suf}.csv", FIELDING_HEADER,
                   [r for r in fielding if i0(r["POS"]) == num])

    def splits(endpoint, field):
        d = {}
        for split in (2, 3):  # split=2 vL, split=3 vR
            agg = {}
            for r in get_csv(api_base, endpoint, {"year": year, "split": split}):
                agg[r["player_id"]] = agg.get(r["player_id"], 0) + i0(r.get(field))
            d[split] = agg
        return d[2], d[3]

    pa_vl, pa_vr = splits("playerbatstatsv2", "pa")
    bf_vl, bf_vr = splits("playerpitchstatsv2", "bf")
    return {"pa_vl": pa_vl, "pa_vr": pa_vr, "bf_vl": bf_vl, "bf_vr": bf_vr,
            "n_teams": len({a.get("team_id") for a in bat if a.get("team_id")})}


def build_ratings(scout_path: Path, out: Path, lk: dict) -> None:
    """Scout-only ratings files (no _osa variants), verified 2042 mapping."""
    opener = gzip.open if scout_path.suffix == ".gz" else open
    with opener(scout_path, "rt") as f:
        snap = {r["ID"]: r for r in csv.DictReader(f)}

    def brow(r, pa):
        return {"ID": r["ID"], "POS": r.get("Pos", ""), "Name": r.get("Name", ""), "PA": pa,
                "B": r.get("Bats", ""),
                "BA vL": r.get("BABIP_L", ""), "GAP vL": r.get("Gap_L", ""),
                "POW vL": r.get("Pow_L", ""), "EYE vL": r.get("Eye_L", ""), "K vL": r.get("Ks_L", ""),
                "BA vR": r.get("BABIP_R", ""), "GAP vR": r.get("Gap_R", ""),
                "POW vR": r.get("Pow_R", ""), "EYE vR": r.get("Eye_R", ""), "K vR": r.get("Ks_R", ""),
                "SPE": r.get("Speed", ""), "STE": r.get("Steal", ""), "RUN": r.get("Run", ""),
                "SR": r.get("StlRt", "")}

    def prow(r, bf):
        return {"ID": r["ID"], "POS": r.get("Pos", ""), "Name": r.get("Name", ""), "BF": bf,
                "T": r.get("Throws", ""),
                "STU vL": r.get("Stf_L", ""), "HRR vL": r.get("HRA_L", ""),
                "PBABIP vL": r.get("PBABIP_L", ""), "CON vL": r.get("Ctrl_L", ""),
                "STU vR": r.get("Stf_R", ""), "HRR vR": r.get("HRA_R", ""),
                "PBABIP vR": r.get("PBABIP_R", ""), "CON vR": r.get("Ctrl_R", ""),
                "HLD": r.get("Hold", "")}

    bat_pop = set(lk["pa_vl"]) | set(lk["pa_vr"])
    pit_pop = set(lk["bf_vl"]) | set(lk["bf_vr"])
    for pop, wl, wr, mk, hdr, key, fn in (
            (bat_pop, lk["pa_vl"], lk["pa_vr"], brow, BATTER_R_HEADER, "PA", "batter_ratings"),
            (pit_pop, lk["bf_vl"], lk["bf_vr"], prow, PITCHER_R_HEADER, "BF", "pitcher_ratings")):
        ids = pop & set(snap)
        for side, w in (("vl", wl), ("vr", wr)):
            rows = sorted((mk(snap[i], w.get(i, 0)) for i in ids),
                          key=lambda x: (-int(x[key]), int(x["ID"])))
            write_rows(out / f"{fn}_{side}.csv", hdr, rows)

    ip = {}
    for suf in POS_SUFFIX.values():
        for r in csv.DictReader(open(out / f"fielding_data_{suf}.csv")):
            ip[r["ID"]] = ip.get(r["ID"], 0.0) + ip_thirds(r.get("IP"))
    fld_pop = {i for i, v in ip.items() if v > 0}
    frows = []
    for i in sorted(fld_pop & set(snap)):
        r = snap[i]
        cm = i0(r.get("Height"))
        ti = round(cm / 2.54) if cm > 0 else 0
        frows.append({"ID": i, "POS": POSNUM.get(r.get("Pos", ""), 0), "Name": r.get("Name", ""),
                      "IP": f"{int(ip[i])}.{round((ip[i] - int(ip[i])) * 3)}",
                      "HT": f"{ti // 12}' {ti % 12}'" if ti else "",
                      "C ABI": r.get("CBlk", ""), "C FRM": r.get("CFrm", ""),
                      "C ARM": r.get("CArm", ""), "IF RNG": r.get("IFR", ""),
                      "IF ERR": r.get("IFE", ""), "IF ARM": r.get("IFA", ""),
                      "TDP": r.get("TDP", ""), "OF RNG": r.get("OFR", ""),
                      "OF ERR": r.get("OFE", ""), "OF ARM": r.get("OFA", "")})
    frows.sort(key=lambda x: (-float(x["IP"].split(".")[0]), int(x["ID"])))
    write_rows(out / "fielding_ratings.csv", FIELDING_R_HEADER, frows)

    for label, pop in (("stats batters", bat_pop), ("stats pitchers", pit_pop),
                       ("stats fielders", fld_pop)):
        missing = pop - set(snap)
        if missing:
            warn(f"{len(missing)} {label} missing from the ratings dump (dropped from ratings "
                 f"files): sample IDs {sorted(missing, key=int)[:8]}")


def check_headers(out: Path) -> None:
    ref = REPO / "leagues/SSB/metadata/2043"
    if not ref.is_dir():
        return
    for f in sorted(out.glob("*.csv")):
        rf = ref / f.name
        if rf.is_file():
            a, b = open(f).readline(), open(rf).readline()
            assert a == b, f"header mismatch vs reference {rf}:\n new: {a} ref: {b}"
    print(f"Headers verified byte-identical vs {ref}")


def validate(league_root: Path, cfg: dict, to: str, season: int, efs: dict) -> None:
    from src import metadata as md
    meta_root = league_root / "metadata"
    kw = dict(relative_blend=bool(cfg.get("relativeBlend")), osa_blend=bool(cfg.get("osaBlend")),
              scout_weight=float(cfg.get("scoutWeight", 0.8)),
              osa_weight=float(cfg.get("osaWeight", 0.2)))
    seasons = md._resolve_season_dirs(meta_root, (3, 2, 1), ootp_version=to,
                                      engine_first_season=efs)
    pooled = [p.name for p, _ in seasons]
    print(f"Boundary resolution: pooled season dirs = {pooled}")
    assert pooled == [str(season)], f"expected to pool only [{season}], got {pooled}"
    md.load_metadata_inputs(meta_root / str(season), **kw)
    print("load_metadata_inputs: OK")
    hit, pit, fld = md.generate_data_points(meta_root, use_cache=False, ootp_version=to,
                                            engine_first_season=efs, **kw)
    md.check_fielding_conversion_27(fld)
    print("\nResulting constants:")
    for name, params in (("HitterLeagueParams", hit), ("PitcherLeagueParams", pit),
                         ("FieldingParams", fld)):
        print(f"--- {name} ---")
        for f in dataclasses.fields(params):
            v = getattr(params, f.name)
            print(f"  {f.name} = " + (f"dist(n={len(v)})" if isinstance(v, list)
                                      else f"{v:.6g}" if isinstance(v, float) else str(v)))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--league", required=True)
    ap.add_argument("--to", required=True)
    ap.add_argument("--first-season", type=int, required=True)
    ap.add_argument("--scout-ratings", type=Path, required=True)
    ap.add_argument("--season", type=int, default=None)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    season = args.season or args.first_season

    league_root = REPO / "leagues" / args.league
    cfg_path = league_root / "league.json"
    cfg = json.loads(cfg_path.read_text())
    api_base = (cfg["statsplusUrl"].rstrip("/") + "/api")
    efs = dict(cfg.get("engineFirstSeason") or {})
    efs[str(args.to)] = args.first_season

    game_date = None
    try:
        req = urllib.request.Request(f"{api_base}/date/", headers={"User-Agent": UA})
        game_date = urllib.request.urlopen(req, timeout=30).read().decode().strip()
    except Exception as e:
        warn(f"could not read /date/ endpoint: {e}")
    print(f"League {args.league} → OOTP {args.to}, first season {args.first_season}, "
          f"building season {season}. Current league date: {game_date}")

    m = re.search(r"(\d{4})-\d{2}-\d{2}", args.scout_ratings.name)
    if m and int(m.group(1)) != season:
        warn(f"ratings vintage skew: scout dump is dated {m.group(0)} but the season being "
             f"built is {season} — ratings are {'preseason' if int(m.group(1)) < season else 'postseason'} "
             f"relative to the stats.")

    if args.dry_run:
        work_root = Path(tempfile.mkdtemp(prefix="convert_league_")) / args.league
        (work_root / "metadata").mkdir(parents=True)
        tmp_cfg = dict(cfg); tmp_cfg["engineFirstSeason"] = efs
        (work_root / "league.json").write_text(json.dumps(tmp_cfg, indent=2) + "\n")
        print(f"[dry-run] building under {work_root}")
    else:
        work_root = league_root
    out = work_root / "metadata" / str(season)
    out.mkdir(parents=True, exist_ok=True)

    lk = build_stats(api_base, season, out)
    build_ratings(args.scout_ratings, out, lk)
    check_headers(out)

    tot_ip = sum(ip_thirds(r.get("IP")) for suf in POS_SUFFIX.values()
                 for r in csv.DictReader(open(out / f"fielding_data_{suf}.csv")))
    games = tot_ip / (9 * 9 * lk["n_teams"]) if lk["n_teams"] else 0.0
    if games < 155:
        warn(f"partial season: fielding IP totals imply ~{games:.1f} team-games per team "
             f"({games / 162:.0%} of a 162-game season, {lk['n_teams']} teams). Constants are "
             f"fit on an in-progress season; rebuild after the season completes.")

    if not args.dry_run:
        new_cfg = {}
        for k, v in cfg.items():
            new_cfg[k] = v
            if k == "ootpVersion":
                new_cfg["engineFirstSeason"] = efs
        if "ootpVersion" not in new_cfg:
            new_cfg["ootpVersion"] = str(args.to)
            new_cfg["engineFirstSeason"] = efs
        cfg_path.write_text(json.dumps(new_cfg, indent=2) + "\n")
        print(f"Updated {cfg_path} with engineFirstSeason {efs}")

    validate(work_root, cfg, str(args.to), season, efs)
    print(f"\nDone. Season {season} metadata at {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

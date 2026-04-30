"""src/salary_report.py — Fetch and parse StatsPlus team salary report HTML pages."""

from __future__ import annotations

import concurrent.futures
import csv
import io
import re
import sys
import urllib.error
import urllib.request

from .statsplus import normalize_api_base

_TH_RE = re.compile(r"<th[^>]*>(.*?)</th>", re.IGNORECASE | re.DOTALL)
_TR_RE = re.compile(r"<tr[^>]*>(.*?)</tr>", re.IGNORECASE | re.DOTALL)
_TD_RE = re.compile(r"<td[^>]*>(.*?)</td>", re.IGNORECASE | re.DOTALL)
_LINK_RE = re.compile(r'href="[^"]*/player_(\d+)\.html"[^>]*>([^<]+)</a>', re.IGNORECASE)
_TAG_RE = re.compile(r"<[^>]+>")
_ITALIC_RE = re.compile(r"<[ie][m>]")
_YEAR_RE = re.compile(r"^\d{4}$")

_ANNOTATIONS = [
    ("(A*)", "arb_uncertain"),
    ("(A#)", "arb_uncertain"),
    ("(A)", "arb"),
    ("(*)", "milb"),
    ("(T)", "team_option"),
    ("(P)", "player_option"),
    ("(V)", "vesting_option"),
    ("(O)", "opt_out"),
    ("(R)", "retained"),
]


def _parse_salary_str(s: str) -> float | None:
    if not s:
        return None
    clean = s.replace("$", "").strip().lower()
    try:
        if clean.endswith("m"):
            return round(float(clean[:-1]) * 1_000_000)
        if clean.endswith("k"):
            return round(float(clean[:-1]) * 1_000)
        return float(clean)
    except ValueError:
        return None


def _parse_cell(raw_html: str) -> dict:
    is_italic = bool(_ITALIC_RE.search(raw_html))
    text = _TAG_RE.sub("", raw_html).strip()
    if not text or text in ("—", "-"):
        return {"salary": None, "type": "fa", "guaranteed": False}
    if text == "MiLC":
        return {"salary": None, "type": "milc", "guaranteed": False}
    ctype = "signed"
    salary_str = text
    for suffix, ann in _ANNOTATIONS:
        if text.endswith(suffix):
            ctype = ann
            salary_str = text[: -len(suffix)].strip()
            break
    salary = _parse_salary_str(salary_str)
    return {"salary": salary, "type": ctype, "guaranteed": not is_italic}


def parse_salary_report_html(html: str) -> dict:
    """Parse salary-report HTML; returns {playerId: {name, pos, years: {year: cell}}}."""
    result: dict = {}
    year_cols: list[int] = []
    for m in _TH_RE.finditer(html):
        text = _TAG_RE.sub("", m.group(1)).strip()
        if _YEAR_RE.match(text):
            year_cols.append(int(text))
    if not year_cols:
        return result

    for row_match in _TR_RE.finditer(html):
        row_html = row_match.group(1)
        link = _LINK_RE.search(row_html)
        if not link:
            continue
        pid = link.group(1)
        name = link.group(2).strip()
        tds = [m.group(1) for m in _TD_RE.finditer(row_html)]
        if not tds:
            continue
        pos = _TAG_RE.sub("", tds[0]).strip()
        salary_cells = tds[3:]
        years: dict = {}
        for i, cell in enumerate(salary_cells):
            if i >= len(year_cols):
                break
            years[year_cols[i]] = _parse_cell(cell)
        result[pid] = {"name": name, "pos": pos, "years": years}
    return result


def fetch_all_teams(statsplus_base: str, timeout: int = 15) -> list[dict]:
    """Fetch the league's /teams/ CSV and return [{'id', 'name', 'nickname', 'full'}, ...].

    Accepts either the page URL or API URL form (see ``normalize_api_base``).
    Returns an empty list on network failure (warning printed to stderr).
    """
    base = normalize_api_base(statsplus_base)
    if not base:
        return []
    url = f"{base}/teams/"
    try:
        with urllib.request.urlopen(urllib.request.Request(url), timeout=timeout) as resp:
            text = resp.read().decode("utf-8")
    except (urllib.error.URLError, urllib.error.HTTPError, OSError) as e:
        print(f"  Warning: could not fetch teams list — {e}", file=sys.stderr)
        return []
    reader = csv.DictReader(io.StringIO(text.strip()))
    teams: list[dict] = []
    for row in reader:
        team_id = (row.get("ID") or row.get("id") or "").strip()
        if not team_id:
            continue
        name = (row.get("Name") or row.get("name") or "").strip()
        nick = (row.get("Nickname") or row.get("nickname") or "").strip()
        teams.append({
            "id": team_id,
            "name": name,
            "nickname": nick,
            "full": f"{name} {nick}".strip(),
        })
    return teams


def _fetch_team_id(team_name: str, statsplus_base: str, timeout: int = 15) -> str | None:
    target = team_name.strip().lower()
    for team in fetch_all_teams(statsplus_base, timeout):
        if team["full"].lower() == target:
            return team["id"]
    return None


def fetch_salary_report(team: str | int, statsplus_base: str, timeout: int = 15) -> dict:
    """Fetch and parse the salary report for a team. Accepts numeric ID or team name."""
    if not team or not statsplus_base:
        return {}
    base = normalize_api_base(statsplus_base)
    team_id: str | None
    if isinstance(team, int) or (isinstance(team, str) and team.isdigit()):
        team_id = str(team)
    else:
        team_id = _fetch_team_id(str(team), base, timeout)
        if not team_id:
            print(f"  Warning: could not resolve team id for '{team}'", file=sys.stderr)
            return {}
    # The /reports/ path lives under the league root, not under /api
    report_base = base[:-4] if base.endswith("/api") else base
    url = f"{report_base}/reports/news/html/teams/team_{team_id}_player_salary_report.html"
    try:
        with urllib.request.urlopen(urllib.request.Request(url), timeout=timeout) as resp:
            html = resp.read().decode("utf-8", errors="replace")
    except (urllib.error.URLError, urllib.error.HTTPError, OSError) as e:
        print(f"  Warning: could not fetch salary report ({url}) — {e}", file=sys.stderr)
        return {}
    return parse_salary_report_html(html)


def fetch_all_salary_reports(
    statsplus_base: str,
    timeout: int = 15,
    max_workers: int = 6,
    team_names: list[str] | None = None,
) -> dict:
    """Fetch every team's salary report in parallel and merge into {playerId: entry}.

    The StatsPlus /teams/ CSV includes every team in the OOTP world (MLB, foreign
    leagues, All-Stars rosters, minor-league affiliates). Only the user's MLB
    league has salary reports we care about. Pass `team_names` (e.g. from
    ballparks.csv via load_team_names) to restrict fetches to teams whose
    "Name Nickname" matches; without it, every parent team is fetched.

    Per-team failures are caught, recorded, and printed as a single warning summary
    after all teams have been attempted. Successful teams' entries are merged via
    dict.update — playerId collisions across teams are not expected, but if they
    occur the last write wins (the data is for the same player either way).
    """
    if not statsplus_base:
        return {}
    teams = fetch_all_teams(statsplus_base, timeout)
    if not teams:
        return {}

    if team_names is not None:
        wanted = {name.strip().lower() for name in team_names if name}
        teams = [t for t in teams if t["full"].lower() in wanted]
        if not teams:
            print(
                "  Warning: no /teams/ CSV rows matched the provided team_names filter",
                file=sys.stderr,
            )
            return {}

    merged: dict = {}
    failed: list[tuple[str, str]] = []

    def _worker(team: dict) -> tuple[str, dict]:
        try:
            return team["full"], fetch_salary_report(team["id"], statsplus_base, timeout)
        except Exception as e:  # noqa: BLE001 — defensive; fetch_salary_report normally swallows network errors
            return team["full"], {"__error__": str(e)}

    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = [executor.submit(_worker, team) for team in teams]
        for future in concurrent.futures.as_completed(futures):
            team_full, result = future.result()
            if "__error__" in result:
                failed.append((team_full, result["__error__"]))
                continue
            if not result:
                # fetch_salary_report returned {} — either no data or a swallowed network error.
                # The function already printed its own warning if the HTTP call failed.
                failed.append((team_full, "no data"))
                continue
            merged.update(result)

    if failed:
        summary = ", ".join(f"{name} ({err})" for name, err in failed)
        print(
            f"  Warning: {len(failed)}/{len(teams)} salary reports failed or empty: {summary}",
            file=sys.stderr,
        )

    return merged

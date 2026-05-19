"""
src/statsplus.py — Fetch and parse contract data from the StatsPlus API.

Fetches /contract and /contractextension endpoints, parses the CSV responses,
and returns a dict keyed by player ID with full contract details including
year-by-year salaries, option flags, and extensions.
"""

from __future__ import annotations

import csv
import gzip
import io
import json
import sys
import urllib.request
import urllib.error
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def normalize_api_base(url: str) -> str:
    """Return the StatsPlus API base URL (no trailing slash, ending in '/api').

    Accepts either the page URL (e.g. 'https://atl-01.statsplus.net/ssb/') or the
    API URL (e.g. '.../ssb/api'). Empty input is returned unchanged.
    """
    base = (url or "").rstrip("/")
    if not base:
        return base
    if not base.endswith("/api"):
        base = f"{base}/api"
    return base


def _fetch_csv(url: str, timeout: int = 15) -> list[dict[str, str]]:
    """Fetch a CSV endpoint and return list of row dicts."""
    try:
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            text = resp.read().decode("utf-8")
    except (urllib.error.URLError, urllib.error.HTTPError, OSError) as e:
        print(f"  Warning: could not fetch {url} — {e}")
        return []

    if not text.strip():
        return []

    reader = csv.DictReader(io.StringIO(text.strip()))
    return list(reader)


def _parse_int(val: str | None, default: int = 0) -> int:
    """Parse string to int, returning default on failure."""
    if val is None:
        return default
    try:
        return int(val)
    except (ValueError, TypeError):
        return default


def _parse_contract_row(row: dict[str, str]) -> dict[str, Any]:
    """Parse a single contract/extension CSV row into a contract dict."""
    years = _parse_int(row.get("years"))
    salaries = []
    for i in range(15):
        salaries.append(_parse_int(row.get(f"salary{i}")))
    # Trim to contract length
    trimmed = salaries[:max(years, 1)]

    return {
        "playerId": str(row.get("player_id", "")),
        "teamId": str(row.get("team_id", "")),
        "seasonYear": _parse_int(row.get("season_year")),
        "years": years,
        "currentYear": _parse_int(row.get("current_year")),
        "salaries": trimmed,
        "lastYearTeamOption": row.get("last_year_team_option") == "1",
        "lastYearPlayerOption": row.get("last_year_player_option") == "1",
        "lastYearVestingOption": row.get("last_year_vesting_option") == "1",
        "nextLastYearTeamOption": row.get("next_last_year_team_option") == "1",
        "nextLastYearPlayerOption": row.get("next_last_year_player_option") == "1",
        "nextLastYearVestingOption": row.get("next_last_year_vesting_option") == "1",
        "lastYearOptionBuyout": _parse_int(row.get("last_year_option_buyout")),
        "nextLastYearOptionBuyout": _parse_int(row.get("next_last_year_option_buyout")),
        "noTrade": row.get("no_trade") == "1",
    }


def fetch_contracts(statsplus_url: str) -> dict[str, dict[str, Any]]:
    """Fetch contract and extension data from StatsPlus API.

    Args:
        statsplus_url: League page URL (e.g. "https://atl-01.statsplus.net/ssb/")
            or API URL (".../ssb/api"). Both forms are accepted.

    Returns:
        Dict keyed by player_id string, where each value is a contract dict
        with an optional "extension" sub-dict.
    """
    base = normalize_api_base(statsplus_url)
    print(f"  Fetching contracts from {base}/contract ...")
    contract_rows = _fetch_csv(f"{base}/contract")
    print(f"  Fetching extensions from {base}/contractextension ...")
    extension_rows = _fetch_csv(f"{base}/contractextension")

    contracts: dict[str, dict[str, Any]] = {}

    # Parse base contracts
    for row in contract_rows:
        c = _parse_contract_row(row)
        pid = c["playerId"]
        if not pid:
            continue
        if c["years"] > 0 or any(s > 0 for s in c["salaries"]):
            # Remove playerId from the stored dict (it's the key)
            contracts[pid] = c

    print(f"  Parsed {len(contracts)} base contracts")

    # Parse extensions and attach to base contracts
    ext_count = 0
    for row in extension_rows:
        ext = _parse_contract_row(row)
        pid = ext["playerId"]
        if not pid:
            continue
        if ext["years"] > 0 or any(s > 0 for s in ext["salaries"]):
            base_contract = contracts.get(pid)
            if base_contract:
                base_contract["extension"] = ext
            else:
                # Extension-only (no base contract row)
                ext["isExtensionOnly"] = True
                contracts[pid] = ext
            ext_count += 1

    print(f"  Parsed {ext_count} extensions")
    return contracts


def fetch_players(statsplus_url: str) -> dict[str, dict[str, Any]]:
    """Fetch /players from StatsPlus to embed live service-time and DL flags.

    Accepts the page URL or API URL form (see ``normalize_api_base``).

    Returns:
        Dict keyed by player_id string with fields used by the frontend
        Super-Two filter and DL displays. Missing/malformed rows are skipped.
    """
    base = normalize_api_base(statsplus_url)
    print(f"  Fetching players from {base}/players ...")
    rows = _fetch_csv(f"{base}/players")

    # Fields the OOTP CSV exports already cover — drop them from the StatsPlus
    # row to avoid double-storing the same value under two names.
    DUPLICATIVE = {
        "ID", "First Name", "Last Name", "Age", "date_of_birth",
        "height", "weight", "bats", "throws",
        "Level", "Pos", "Organization ID",
        "draft_year",
        # mlb_service_years / mlb_service_days mirror MLY / MLD from the CSV.
        "mlb_service_years", "mlb_service_days",
    }
    INT_FIELDS = {
        "Team ID", "Parent Team ID", "League ID", "Role", "Retired",
        "draft_round", "draft_supplemental", "draft_pick", "draft_overall_pick",
        "hall_of_fame", "inducted", "uniform_number",
        "dl_days_this_year",
        "pro_service_years", "pro_service_days", "pro_service_days_this_year",
        "secondary_service_years", "secondary_service_days",
        "secondary_service_days_this_year",
        "days_on_waivers", "days_on_waivers_left",
        "mlb_service_days_this_year",
    }
    # Snake-case the few keys the frontend reads directly from meta — the
    # original names (with spaces) are awkward to access via `meta?.["Team ID"]`.
    KEY_RENAMES = {
        "Team ID": "team_id",
        "Parent Team ID": "parent_team_id",
        "League ID": "league_id",
    }
    BOOL_FIELDS = {
        "is_active", "is_on_secondary", "is_on_waivers",
        "designated_for_assignment", "is_on_dl", "is_on_dl60",
        "has_received_arbitration", "was_traded",
    }

    out: dict[str, dict[str, Any]] = {}
    for row in rows:
        pid = str(row.get("ID", "")).strip()
        if not pid:
            continue
        # Skip rows whose entire active/service block is empty (typical for
        # retired or pre-rostered placeholder players that StatsPlus dumps).
        has_signal = any(
            row.get(k) for k in (
                "mlb_service_days_this_year", "pro_service_days_this_year",
                "is_on_dl", "is_on_dl60", "is_active",
                "designated_for_assignment", "is_on_waivers",
            )
        )
        if not has_signal:
            continue

        record: dict[str, Any] = {}
        for k, v in row.items():
            if k in DUPLICATIVE or v in (None, ""):
                continue
            out_key = KEY_RENAMES.get(k, k)
            if k in INT_FIELDS:
                record[out_key] = _parse_int(v)
            elif k in BOOL_FIELDS:
                record[out_key] = v in ("1", "true", "True")
            else:
                record[out_key] = v
        out[pid] = record
    print(f"  Parsed {len(out)} player service rows")
    return out


def fetch_game_date(statsplus_url: str, timeout: int = 10) -> str | None:
    """Fetch the current in-game date from the StatsPlus `/date` endpoint.

    StatsPlus exposes the league's current game date as a small CSV/text
    response. We normalize the body (strip whitespace) and return it as a
    single string so it can be used directly as a cache key. Returns ``None``
    on any network or parse error.
    """
    base = normalize_api_base(statsplus_url)
    if not base:
        return None
    url = f"{base}/date"
    try:
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            text = resp.read().decode("utf-8", errors="replace")
    except (urllib.error.URLError, urllib.error.HTTPError, OSError) as e:
        print(f"  Warning: could not fetch {url} — {e}")
        return None

    text = text.strip()
    if not text:
        return None

    # Common shapes:
    #   "2026-05-19"
    #   "current_date\n2026-05-19"
    #   "date,year\n2026-05-19,2026"
    # Use csv.DictReader when there's a header row; otherwise return the raw
    # body. Either way the result is a stable string we can compare across runs.
    try:
        reader = csv.DictReader(io.StringIO(text))
        rows = list(reader)
        if rows:
            row = rows[0]
            for key in ("current_date", "date", "game_date", "today"):
                if key in row and row[key]:
                    return str(row[key]).strip()
            # Header present but no recognized column — fall through to raw text.
    except Exception:  # noqa: BLE001 — parsing is best-effort
        pass
    return text


# ---------------------------------------------------------------------------
# Per-league fetch cache
# ---------------------------------------------------------------------------

_CACHE_VERSION = 1


def load_statsplus_cache(
    cache_path: Path | str,
    current_date: str | None,
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]] | None:
    """Return cached (contracts, players, salary_reports) if the game date matches.

    Returns ``None`` on any of: missing file, version mismatch, date mismatch,
    or read/decode error. ``current_date=None`` always misses (we can't know
    whether the cache is fresh without a date to compare against).
    """
    if not current_date:
        return None
    path = Path(cache_path)
    if not path.is_file():
        return None
    try:
        with gzip.open(path, "rb") as f:
            data = json.loads(f.read().decode("utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        print(f"  Warning: could not read StatsPlus cache ({path}) — {e}", file=sys.stderr)
        return None
    if data.get("version") != _CACHE_VERSION:
        return None
    if data.get("game_date") != current_date:
        return None
    contracts = data.get("contracts") or {}
    players = data.get("players") or {}
    salary_reports = data.get("salary_reports") or {}
    if not isinstance(contracts, dict) or not isinstance(players, dict) or not isinstance(salary_reports, dict):
        return None
    return contracts, players, salary_reports


def save_statsplus_cache(
    cache_path: Path | str,
    current_date: str | None,
    contracts: dict[str, Any] | None,
    players: dict[str, Any] | None,
    salary_reports: dict[str, Any] | None,
) -> None:
    """Write a gzipped JSON cache of the StatsPlus fetches keyed by game date."""
    if not current_date:
        return
    path = Path(cache_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "version": _CACHE_VERSION,
        "game_date": current_date,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "contracts": contracts or {},
        "players": players or {},
        "salary_reports": salary_reports or {},
    }
    tmp = path.with_suffix(path.suffix + ".tmp")
    try:
        with gzip.open(tmp, "wb") as f:
            f.write(json.dumps(payload).encode("utf-8"))
        tmp.replace(path)
    except OSError as e:
        print(f"  Warning: could not write StatsPlus cache ({path}) — {e}", file=sys.stderr)
        try:
            tmp.unlink(missing_ok=True)
        except OSError:
            pass


def contract_to_json(contract: dict[str, Any] | None) -> dict[str, Any] | None:
    """Convert a contract dict to a JSON-safe format for embedding in dashboard.json.

    Strips the playerId field (redundant — it's the player's ID) and
    ensures the extension sub-dict is also cleaned.
    """
    if contract is None:
        return None

    result = {k: v for k, v in contract.items() if k != "playerId"}

    # Clean extension too
    ext = result.get("extension")
    if ext and isinstance(ext, dict):
        result["extension"] = {k: v for k, v in ext.items() if k != "playerId"}
    elif "extension" not in result:
        result["extension"] = None

    return result

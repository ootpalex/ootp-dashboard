"""Tests for src/salary_report.py — parsing + orchestration (no live network)."""

from unittest.mock import patch

from src import salary_report
from src.salary_report import (
    _parse_salary_str,
    fetch_all_salary_reports,
    fetch_all_teams,
    parse_salary_report_html,
)


# ---------------------------------------------------------------------------
# _parse_salary_str — unit-suffix and edge-case parsing
# ---------------------------------------------------------------------------


def test_parse_salary_str_handles_million_and_thousand_suffixes():
    assert _parse_salary_str("$1.5M") == 1_500_000
    assert _parse_salary_str("$1M") == 1_000_000
    assert _parse_salary_str("$750K") == 750_000


def test_parse_salary_str_returns_none_for_empty_or_dash():
    assert _parse_salary_str("") is None
    # Note: "-" lacks a numeric body — float("-") raises ValueError → returns None.
    assert _parse_salary_str("-") is None


def test_parse_salary_str_returns_none_for_garbage():
    assert _parse_salary_str("not a salary") is None


# ---------------------------------------------------------------------------
# parse_salary_report_html — minimal end-to-end fixture
# ---------------------------------------------------------------------------


_FIXTURE_HTML = """
<table>
  <thead><tr>
    <th>Pos</th><th>Player</th><th>Age</th>
    <th>2026</th><th>2027</th><th>2028</th>
  </tr></thead>
  <tbody>
    <tr>
      <td>SS</td>
      <td><a href="/league/players/player_42.html">Test Player</a></td>
      <td>28</td>
      <td>$5M</td>
      <td>$6M (T)</td>
      <td>-</td>
    </tr>
  </tbody>
</table>
"""


def test_parse_salary_report_html_keys_by_player_id_and_extracts_years():
    result = parse_salary_report_html(_FIXTURE_HTML)
    assert "42" in result
    entry = result["42"]
    assert entry["name"] == "Test Player"
    assert entry["pos"] == "SS"

    years = entry["years"]
    assert years[2026]["salary"] == 5_000_000
    assert years[2026]["type"] == "signed"

    assert years[2027]["salary"] == 6_000_000
    assert years[2027]["type"] == "team_option"

    # "-" → free agent year (no salary, type=fa)
    assert years[2028]["salary"] is None
    assert years[2028]["type"] == "fa"


def test_parse_salary_report_html_returns_empty_when_no_year_columns():
    html = "<table><thead><tr><th>Foo</th></tr></thead></table>"
    assert parse_salary_report_html(html) == {}


# ---------------------------------------------------------------------------
# fetch_all_teams — /teams/ CSV parsing (network mocked)
# ---------------------------------------------------------------------------


_TEAMS_CSV = (
    "ID,Name,Nickname,League\n"
    "1,Atlanta,Braves,NL\n"
    "2,Houston,Astros,AL\n"
    "3,Seattle,Mariners,AL\n"
)


class _FakeResponse:
    def __init__(self, text: str):
        self._text = text

    def read(self) -> bytes:
        return self._text.encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


def test_fetch_all_teams_parses_csv():
    with patch("src.salary_report.urllib.request.urlopen", return_value=_FakeResponse(_TEAMS_CSV)):
        teams = fetch_all_teams("https://atl-01.statsplus.net/ssb/api/")
    assert [t["id"] for t in teams] == ["1", "2", "3"]
    assert teams[0] == {"id": "1", "name": "Atlanta", "nickname": "Braves", "full": "Atlanta Braves"}
    assert teams[2]["full"] == "Seattle Mariners"


def test_fetch_all_teams_returns_empty_on_network_failure():
    with patch("src.salary_report.urllib.request.urlopen", side_effect=OSError("boom")):
        assert fetch_all_teams("https://atl-01.statsplus.net/ssb/api/") == []


# ---------------------------------------------------------------------------
# fetch_all_salary_reports — orchestration (per-team fetch mocked)
# ---------------------------------------------------------------------------


def _fake_teams() -> list[dict]:
    return [
        {"id": "1", "name": "Atlanta", "nickname": "Braves", "full": "Atlanta Braves"},
        {"id": "2", "name": "Houston", "nickname": "Astros", "full": "Houston Astros"},
        {"id": "3", "name": "Seattle", "nickname": "Mariners", "full": "Seattle Mariners"},
    ]


def test_fetch_all_salary_reports_merges_teams():
    per_team = {
        "1": {"100": {"name": "A", "pos": "SS", "years": {2026: {"salary": 1, "type": "signed", "guaranteed": True}}}},
        "2": {"200": {"name": "B", "pos": "C",  "years": {2026: {"salary": 2, "type": "signed", "guaranteed": True}}}},
        "3": {"300": {"name": "C", "pos": "1B", "years": {2026: {"salary": 3, "type": "signed", "guaranteed": True}}}},
    }

    def fake_fetch(team_id, base, timeout=15):
        return per_team[team_id]

    with patch.object(salary_report, "fetch_all_teams", return_value=_fake_teams()), \
         patch.object(salary_report, "fetch_salary_report", side_effect=fake_fetch):
        merged = fetch_all_salary_reports("https://league.example/api")

    assert set(merged.keys()) == {"100", "200", "300"}
    assert merged["100"]["name"] == "A"
    assert merged["200"]["name"] == "B"
    assert merged["300"]["name"] == "C"


def test_fetch_all_salary_reports_tolerates_team_failure(capsys):
    def fake_fetch(team_id, base, timeout=15):
        if team_id == "2":
            raise RuntimeError("kaboom")
        return {f"{team_id}00": {"name": team_id, "pos": "P", "years": {}}}

    with patch.object(salary_report, "fetch_all_teams", return_value=_fake_teams()), \
         patch.object(salary_report, "fetch_salary_report", side_effect=fake_fetch):
        merged = fetch_all_salary_reports("https://league.example/api")

    # Other two teams' entries are still merged.
    assert set(merged.keys()) == {"100", "300"}

    captured = capsys.readouterr()
    assert "Houston Astros" in captured.err
    assert "kaboom" in captured.err


def test_fetch_all_salary_reports_passes_numeric_team_ids():
    calls: list[str] = []

    def fake_fetch(team_id, base, timeout=15):
        calls.append(team_id)
        return {}

    with patch.object(salary_report, "fetch_all_teams", return_value=_fake_teams()), \
         patch.object(salary_report, "fetch_salary_report", side_effect=fake_fetch):
        fetch_all_salary_reports("https://league.example/api")

    # Each call uses the numeric team ID (not the full team name).
    assert sorted(calls) == ["1", "2", "3"]


def test_fetch_all_salary_reports_filters_by_team_names():
    """When team_names is provided, only matching teams from /teams/ are fetched.

    Models the real-world StatsPlus /teams/ CSV which includes foreign leagues
    and All-Stars rosters that don't have salary reports.
    """
    mixed_teams = [
        {"id": "1", "name": "Atlanta", "nickname": "Braves", "full": "Atlanta Braves"},
        {"id": "85", "name": "American League", "nickname": "All-Stars", "full": "American League All-Stars"},
        {"id": "411", "name": "Soweto", "nickname": "Warcats", "full": "Soweto Warcats"},
        {"id": "439", "name": "Samsung", "nickname": "Lions", "full": "Samsung Lions"},
        {"id": "54", "name": "Seattle", "nickname": "Mariners", "full": "Seattle Mariners"},
    ]
    calls: list[str] = []

    def fake_fetch(team_id, base, timeout=15):
        calls.append(team_id)
        return {f"{team_id}00": {"name": team_id, "pos": "P", "years": {}}}

    mlb_only = ["Atlanta Braves", "Seattle Mariners"]

    with patch.object(salary_report, "fetch_all_teams", return_value=mixed_teams), \
         patch.object(salary_report, "fetch_salary_report", side_effect=fake_fetch):
        merged = fetch_all_salary_reports("https://league.example/api", team_names=mlb_only)

    # Only the two MLB teams were fetched — KBO, SA, and All-Stars were skipped.
    assert sorted(calls) == ["1", "54"]
    assert set(merged.keys()) == {"100", "5400"}


def test_fetch_all_salary_reports_warns_when_filter_matches_nothing(capsys):
    """If team_names is provided but no /teams/ rows match, return {} with warning."""
    with patch.object(salary_report, "fetch_all_teams", return_value=_fake_teams()):
        merged = fetch_all_salary_reports(
            "https://league.example/api", team_names=["Nonexistent FC"]
        )
    assert merged == {}
    assert "no /teams/ CSV rows matched" in capsys.readouterr().err

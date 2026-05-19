"""Tests for src/export.py — salary parsing, prospect pipeline, JSON structure."""

import numpy as np
import pandas as pd
import pytest

from src.export import (
    _parse_salary,
    _parse_demand,
    _compute_price,
    _prepare_prospect_hitters,
    _prepare_prospect_pitchers,
    _detect_metadata,
    _v,
    _safe_int,
    _safe_bool,
    _batting_split_dict,
    _build_hitter_ratings,
    _build_fielding_ratings,
    _build_pitcher_ratings,
    _build_pitch_grades,
    build_dashboard,
)
from src.settings import PipelineSettings

from tests.conftest import PLAYERS_DIR, BALLPARKS_CSV


# ---------------------------------------------------------------------------
# Salary parsing
# ---------------------------------------------------------------------------


class TestParseSalary:
    """_parse_salary converts OOTP salary strings to numeric."""

    def test_basic(self):
        s = pd.Series(["$570 500", "$1 200 000", "$750 000"])
        result = _parse_salary(s)
        assert result.iloc[0] == 570500
        assert result.iloc[1] == 1200000
        assert result.iloc[2] == 750000

    def test_dash_becomes_nan(self):
        s = pd.Series(["-", ""])
        result = _parse_salary(s)
        assert pd.isna(result.iloc[0])

    def test_numeric_passthrough(self):
        s = pd.Series([500000, 750000])
        result = _parse_salary(s)
        assert result.iloc[0] == 500000


class TestParseDemand:
    """_parse_demand converts OOTP demand strings to numeric."""

    def test_millions(self):
        s = pd.Series(["$1.1m", "$14.9m"])
        result = _parse_demand(s)
        assert result.iloc[0] == 1_100_000
        assert result.iloc[1] == 14_900_000

    def test_thousands(self):
        s = pd.Series(["$860k", "$900k"])
        result = _parse_demand(s)
        assert result.iloc[0] == 860_000
        assert result.iloc[1] == 900_000

    def test_dash_becomes_nan(self):
        s = pd.Series(["-"])
        result = _parse_demand(s)
        assert pd.isna(result.iloc[0])

    def test_impossible_becomes_nan(self):
        # Impossible used to parse as $4M; that poisoned the share-of-budget
        # signability formula. Now meta.sign === 'Impossible' is the signal
        # consumed downstream, and demSort stays NaN.
        s = pd.Series(["Impossible"])
        result = _parse_demand(s)
        assert pd.isna(result.iloc[0])


class TestComputePrice:
    """_compute_price auto-detects league minimum salary."""

    def test_player_with_salary(self):
        slr = pd.Series([570_500.0, 1_000_000.0])
        dem = pd.Series([np.nan, np.nan])
        org = pd.Series(["Nashville Stars", "Nashville Stars"])
        price = _compute_price(slr, dem, org)
        assert price.iloc[0] == 570_500  # at league min
        assert price.iloc[1] == 1_000_000

    def test_free_agent_uses_demand(self):
        slr = pd.Series([np.nan, 570_500.0])
        dem = pd.Series([5_000_000.0, np.nan])
        org = pd.Series(["-", "Nashville Stars"])
        price = _compute_price(slr, dem, org)
        assert price.iloc[0] == 5_000_000  # FA gets demand
        assert price.iloc[1] == 570_500

    def test_auto_detects_min(self):
        """League minimum is auto-detected, not hardcoded."""
        slr = pd.Series([400_000.0, 500_000.0, 100_000.0])
        dem = pd.Series([np.nan, np.nan, np.nan])
        org = pd.Series(["Team A", "Team B", "Team C"])
        price = _compute_price(slr, dem, org)
        # Min is 100k, so no clipping above that
        assert price.iloc[0] == 400_000
        assert price.iloc[2] == 100_000


# ---------------------------------------------------------------------------
# Value conversion helpers
# ---------------------------------------------------------------------------


class TestValueHelpers:
    """_v, _safe_int, _safe_bool handle edge cases."""

    def test_v_nan(self):
        assert _v(float("nan")) is None

    def test_v_inf(self):
        assert _v(float("inf")) is None

    def test_v_numpy_int(self):
        assert _v(np.int64(42)) == 42
        assert isinstance(_v(np.int64(42)), int)

    def test_v_numpy_float(self):
        result = _v(np.float64(3.14159))
        assert isinstance(result, float)
        assert abs(result - 3.14159) < 1e-3

    def test_v_rounds(self):
        result = _v(0.123456789)
        assert result == 0.1235  # rounds to 4 decimal places

    def test_safe_int_dash(self):
        assert _safe_int("-") is None

    def test_safe_int_valid(self):
        assert _safe_int("55") == 55
        assert _safe_int(60) == 60

    def test_safe_bool_y(self):
        assert _safe_bool("Y") is True

    def test_safe_bool_n(self):
        assert _safe_bool("N") is False

    def test_safe_bool_true(self):
        assert _safe_bool(True) is True


# ---------------------------------------------------------------------------
# Prospect pipeline
# ---------------------------------------------------------------------------


class TestProspectPipeline:
    """Prospect player preparation substitutes potential ratings."""

    def test_hitter_prospect_substitution(self):
        df = pd.DataFrame({
            "BA vR": [55], "BA vL": [50],
            "CON vR": [60], "CON vL": [55],
            "GAP vR": [45], "GAP vL": [40],
            "POW vR": [50], "POW vL": [45],
            "EYE vR": [55], "EYE vL": [50],
            "K vR": [60], "K vL": [55],
            "HT P": [65], "CON P": [70],
            "GAP P": [55], "POW P": [60],
            "EYE P": [65], "K P": [50],
            "Name": ["Test"],
        })
        prospect = _prepare_prospect_hitters(df)
        # BA vR/vL should be replaced by HT P
        assert prospect["BA vR"].iloc[0] == 65
        assert prospect["BA vL"].iloc[0] == 65
        # GAP should be replaced by GAP P
        assert prospect["GAP vR"].iloc[0] == 55
        # Original name preserved
        assert prospect["Name"].iloc[0] == "Test"
        # Original df not mutated
        assert df["BA vR"].iloc[0] == 55

    def test_pitcher_prospect_substitution(self):
        df = pd.DataFrame({
            "STU vR": [55], "STU vL": [50],
            "PCON vR": [60], "PCON vL": [55],
            "HRR vR": [45], "HRR vL": [40],
            "PBABIP vR": [50], "PBABIP vL": [45],
            "STU P": [70], "PCON P": [65],
            "HRR P": [55], "PBABIP P": [60],
        })
        prospect = _prepare_prospect_pitchers(df)
        assert prospect["STU vR"].iloc[0] == 70
        assert prospect["STU vL"].iloc[0] == 70
        assert prospect["HRR vR"].iloc[0] == 55
        # Original not mutated
        assert df["STU vR"].iloc[0] == 55


# ---------------------------------------------------------------------------
# Dict builder helpers
# ---------------------------------------------------------------------------


class TestDictBuilders:
    """Test individual dict builder functions."""

    def test_batting_split_dict(self):
        data = {
            "HBP vR": 3.2, "uBB vR": 45.1, "HR vR": 18.5,
            "SO vR": 95.2, "H-HR vR": 92.3, "XBH-HR vR": 25.1,
            "3B vR": 2.8, "2B vR": 22.3, "1B vR": 67.0,
            "OBP vR": 0.340, "wOBA vR": 0.335, "BatR vR": 12.5,
        }
        row = pd.Series(data)
        result = _batting_split_dict(row, "vR")
        assert result["hbp"] == pytest.approx(3.2, abs=1e-5)
        assert result["woba"] == pytest.approx(0.335, abs=1e-5)
        assert result["singles"] == pytest.approx(67.0, abs=1e-5)

    def test_hitter_ratings_structure(self):
        row = pd.Series({
            "BA vR": 55, "GAP vR": 50, "POW vR": 45, "EYE vR": 60, "K vR": 55,
            "BA vL": 60, "GAP vL": 45, "POW vL": 50, "EYE vL": 55, "K vL": 50,
            "HT P": 65, "GAP P": 55, "POW P": 55, "EYE P": 65, "K P": 50,
            "SPE": 55, "STE": 50, "RUN": 50, "SR": 45, "BUN": 40, "BFH": 35,
        })
        result = _build_hitter_ratings(row)
        assert result["vR"]["ba"] == 55
        assert result["vL"]["pow"] == 50
        assert result["potential"]["ht"] == 65
        assert result["spe"] == 55

    def test_fielding_ratings_structure(self):
        row = pd.Series({
            "C ABI": 30, "C FRM": 25, "C ARM": 40,
            "IF RNG": 65, "IF ERR": 55, "IF ARM": 60, "TDP": 55,
            "OF RNG": 50, "OF ERR": 45, "OF ARM": 45,
            "C": 25, "1B": 40, "2B": 65, "3B": 50,
            "SS": 45, "LF": 50, "CF": 40, "RF": 50,
            "C Pot": 25, "1B Pot": 40, "2B Pot": 70, "3B Pot": 55,
            "SS Pot": 50, "LF Pot": 55, "CF Pot": 45, "RF Pot": 55,
        })
        result = _build_fielding_ratings(row)
        assert result["cFrm"] == 25
        assert result["ifRng"] == 65
        assert result["posRatings"]["2b"] == 65
        assert result["posPotentials"]["2b"] == 70

    def test_pitcher_ratings_structure(self):
        row = pd.Series({
            "STU vR": 60, "PCON vR": 55, "HRR vR": 50, "PBABIP vR": 55,
            "STU vL": 55, "PCON vL": 50, "HRR vL": 45, "PBABIP vL": 50,
            "STU P": 70, "PCON P": 60, "HRR P": 55, "PBABIP P": 60,
            "HLD": 50, "STM": 65,
        })
        result = _build_pitcher_ratings(row)
        assert result["vR"]["stu"] == 60
        assert result["vL"]["pcon"] == 50
        assert result["potential"]["stu"] == 70
        assert result["hld"] == 50
        assert result["stm"] == 65

    def test_pitch_grades_structure(self):
        row = pd.Series({
            "FB": 65, "FBP": 70,
            "CH": 55, "CHP": 60,
            "CB": 50, "CBP": 55,
            "SL": 60, "SLP": 65,
            "SI": "-", "SIP": "-",
            "SP": "-", "SPP": "-",
            "CT": "-", "CTP": "-",
            "FO": "-", "FOP": "-",
            "CC": "-", "CCP": "-",
            "SC": "-", "SCP": "-",
            "KC": "-", "KCP": "-",
            "KN": "-", "KNP": "-",
        })
        result = _build_pitch_grades(row)
        assert result["current"]["fb"] == 65
        assert result["potential"]["fb"] == 70
        assert result["current"]["si"] is None  # dash → None


# ---------------------------------------------------------------------------
# Metadata auto-detection
# ---------------------------------------------------------------------------


class TestDetectMetadata:
    """_detect_metadata returns None when inputs are missing."""

    def test_none_when_dir_is_none(self):
        assert _detect_metadata(None) is None

    def test_none_when_dir_missing(self, tmp_path):
        assert _detect_metadata(tmp_path / "nonexistent") is None

    def test_none_when_inputs_subdir_missing(self, tmp_path):
        meta_dir = tmp_path / "metadata"
        meta_dir.mkdir()
        assert _detect_metadata(meta_dir) is None

    def test_none_when_inputs_has_no_csvs(self, tmp_path):
        inputs_dir = tmp_path / "metadata" / "inputs"
        inputs_dir.mkdir(parents=True)
        (inputs_dir / "readme.txt").write_text("not a csv")
        assert _detect_metadata(tmp_path / "metadata") is None


# ---------------------------------------------------------------------------
# Full pipeline integration (requires data files)
# ---------------------------------------------------------------------------


class TestBuildDashboard:
    """Integration test: full pipeline produces valid JSON structure."""

    @pytest.fixture(scope="class")
    def dashboard(self):
        """Build dashboard with neutral park factors for speed."""
        import os
        if not os.path.isdir(PLAYERS_DIR):
            pytest.skip("No player data directory")
        settings = PipelineSettings(park_factor_mode="neutral")
        return build_dashboard(settings, PLAYERS_DIR, BALLPARKS_CSV)

    def test_top_level_keys(self, dashboard):
        assert "meta" in dashboard
        assert "platoonSplits" in dashboard
        assert "hitters" in dashboard
        assert "pitchers" in dashboard

    def test_meta_structure(self, dashboard):
        meta = dashboard["meta"]
        assert "generatedAt" in meta
        assert "settings" in meta
        assert "playerCount" in meta
        assert meta["playerCount"]["hitters"] > 0
        assert meta["playerCount"]["pitchers"] > 0

    def test_gap_dist_present(self, dashboard):
        """v21: gapDist embedded for all three cohorts."""
        gap_dist = dashboard["meta"].get("gapDist")
        assert gap_dist is not None, "meta.gapDist missing"
        assert "hit" in gap_dist
        assert "sp" in gap_dist
        assert "rp" in gap_dist

    def test_gap_dist_shape(self, dashboard):
        """Each cohort row has age + the nine gap percentile keys.

        Convention: smaller gap = higher percentile. So within a row, values
        should be MONOTONE NON-INCREASING when read in descending percentile
        order p99, p95, ..., p1.
        """
        ORDERED_DESC = ("p99", "p95", "p90", "p75", "p50", "p25", "p10", "p5", "p1")
        for cohort in ("hit", "sp", "rp"):
            rows = dashboard["meta"]["gapDist"][cohort]
            assert isinstance(rows, list) and rows, f"gapDist.{cohort} empty"
            for row in rows:
                assert "age" in row
                for pk in ORDERED_DESC:
                    assert pk in row, f"gapDist.{cohort} age={row['age']} missing {pk}"
                vals = [row[pk] for pk in ORDERED_DESC]
                assert vals == sorted(vals), (
                    f"gapDist.{cohort} age={row['age']} percentiles not non-decreasing in p99..p1 order: {vals}"
                )

    def test_gap_dist_narrows_with_age(self, dashboard):
        """Age-14 p1 ≥ age-22 p1: largest gaps narrow as players mature.

        Under the inverted convention, p1 is the "bottom 1% of prospect quality"
        which corresponds to the largest 1% of gaps. So age-14 p1 (biggest gap
        among 14yos) should still be ≥ age-22 p1 (biggest gap among 22yos).
        """
        rows = dashboard["meta"]["gapDist"]["hit"]
        by_age = {r["age"]: r for r in rows}
        if 14 in by_age and 22 in by_age:
            assert by_age[14]["p1"] >= by_age[22]["p1"], (
                f"age-14 p1={by_age[14]['p1']} should be >= age-22 p1={by_age[22]['p1']}"
            )
        if 16 in by_age and 24 in by_age:
            assert by_age[16]["p1"] >= by_age[24]["p1"]

    def test_gap_dist_non_negative(self, dashboard):
        """gap = max(0, pot − cur) is non-negative by construction."""
        ALL_PCTS = ("p99", "p95", "p90", "p75", "p50", "p25", "p10", "p5", "p1")
        for cohort in ("hit", "sp", "rp"):
            for row in dashboard["meta"]["gapDist"][cohort]:
                for pk in ALL_PCTS:
                    assert row[pk] >= 0, f"gapDist.{cohort} age={row['age']} {pk}={row[pk]} < 0"

    def test_platoon_splits(self, dashboard):
        splits = dashboard["platoonSplits"]
        # Hitter splits should sum to ~1.0
        h = splits["hitters"]
        assert abs(h["L"]["vR"] + h["L"]["vL"] - 1.0) < 0.01
        assert abs(h["R"]["vR"] + h["R"]["vL"] - 1.0) < 0.01

    def test_hitter_structure(self, dashboard):
        h = dashboard["hitters"][0]
        assert "id" in h
        assert "meta" in h
        assert "ratings" in h
        assert "fieldingRatings" in h
        assert "batting" in h
        assert "baserunning" in h
        assert "positions" in h
        assert "maxWaa" in h
        assert "prospect" in h

    def test_hitter_batting_has_splits(self, dashboard):
        h = dashboard["hitters"][0]
        bat = h["batting"]
        assert "vR" in bat
        assert "vL" in bat
        assert "wtd" in bat
        assert "dh" in bat

    def test_hitter_positions_have_eligibility(self, dashboard):
        h = dashboard["hitters"][0]
        pos = h["positions"]
        assert "dh" in pos
        assert pos["dh"]["eligible"] is True  # everyone is DH eligible

    def test_hitter_has_salary_and_price(self, dashboard):
        """Hitter meta should include salary and price fields."""
        # Find a hitter with a salary (MLB player)
        for h in dashboard["hitters"]:
            if h["meta"].get("salary") is not None:
                assert h["meta"].get("price") is not None
                assert h["meta"]["price"] >= h["meta"]["salary"]
                break

    def test_pitcher_structure(self, dashboard):
        p = dashboard["pitchers"][0]
        assert "id" in p
        assert "meta" in p
        assert "ratings" in p
        assert "pitchGrades" in p
        assert "pitchCounts" in p
        assert "starter" in p
        assert "starterP" in p
        assert "sp" in p
        assert "rp" in p
        assert "prospect" in p

    def test_pitcher_has_salary_and_price(self, dashboard):
        """Pitcher meta should include salary and price fields."""
        for p in dashboard["pitchers"]:
            if p["meta"].get("salary") is not None:
                assert p["meta"].get("price") is not None
                break

    def test_starter_uses_current_grades(self, dashboard):
        """Starter and starterP should potentially differ for some pitchers."""
        starters = [p for p in dashboard["pitchers"] if p["starter"]]
        starter_ps = [p for p in dashboard["pitchers"] if p["starterP"]]
        # Both should have values; counts may differ
        assert len(starters) > 0
        assert len(starter_ps) > 0

    def test_pitcher_sp_has_splits(self, dashboard):
        p = dashboard["pitchers"][0]
        sp = p["sp"]
        assert "vR" in sp
        assert "vL" in sp
        assert "wtd" in sp
        assert "sbPct" in sp

    def test_no_nan_in_json(self, dashboard):
        """NaN values should be converted to None, not appear as NaN strings."""
        import json
        s = json.dumps(dashboard)
        assert "NaN" not in s
        assert "Infinity" not in s

    def test_player_counts_match(self, dashboard):
        meta = dashboard["meta"]
        assert meta["playerCount"]["hitters"] == len(dashboard["hitters"])
        assert meta["playerCount"]["pitchers"] == len(dashboard["pitchers"])

    def test_prospect_present(self, dashboard):
        """Every hitter should have prospect data."""
        for h in dashboard["hitters"][:10]:
            assert "batting" in h["prospect"]
            assert "baserunning" in h["prospect"]


# ---------------------------------------------------------------------------
# League-wide salary report embedding
# ---------------------------------------------------------------------------


class TestSalaryReportEmbedding:
    """salary_reports is a flat {playerId: entry} dict spanning every team.

    Verify that a player whose org is NOT settings.team still gets:
      - the raw entry attached as _salaryReport on the player record, and
      - their _projection.yearStatus refined by the salary-report annotations.
    """

    @pytest.fixture(scope="class")
    def baseline(self):
        import os
        if not os.path.isdir(PLAYERS_DIR):
            pytest.skip("No player data directory")
        settings = PipelineSettings(park_factor_mode="neutral")
        return settings, build_dashboard(settings, PLAYERS_DIR, BALLPARKS_CSV)

    def _pick_non_user_team_hitter(self, hitters, user_team_org_code):
        """Find a hitter whose meta.org differs from the user team."""
        for h in hitters:
            org = (h.get("meta") or {}).get("org")
            if org and org != user_team_org_code and h.get("id"):
                return h
        return None

    def test_non_user_team_player_gets_salary_report(self, baseline):
        settings, base = baseline
        # Pick a hitter from any team. The user team org code in the test data is
        # not necessarily "NSH" — some hitter will have a different org.
        first_org = (base["hitters"][0].get("meta") or {}).get("org")
        target = self._pick_non_user_team_hitter(base["hitters"], first_org)
        if target is None:
            pytest.skip("Test data has only one team — cannot test non-user-team path")

        pid = str(target["id"])
        sr_entry = {
            "name": target.get("meta", {}).get("fullName", "Test"),
            "pos": "SS",
            "years": {
                2030: {"salary": 5_000_000, "type": "team_option", "guaranteed": True},
            },
        }

        result = build_dashboard(
            settings, PLAYERS_DIR, BALLPARKS_CSV,
            salary_reports={pid: sr_entry},
        )

        matched = next((h for h in result["hitters"] if str(h["id"]) == pid), None)
        assert matched is not None
        # Raw salary report entry is attached as a top-level field.
        assert "_salaryReport" in matched
        assert matched["_salaryReport"]["years"][2030]["type"] == "team_option"
        assert matched["_salaryReport"]["years"][2030]["guaranteed"] is True

    def test_player_without_salary_report_has_no_field(self, baseline):
        """_salaryReport is omitted when the flat dict has no entry for that pid."""
        settings, _ = baseline
        result = build_dashboard(
            settings, PLAYERS_DIR, BALLPARKS_CSV,
            salary_reports={},  # nobody has an entry
        )
        # No hitter or pitcher should carry _salaryReport when input dict is empty.
        for h in result["hitters"]:
            assert "_salaryReport" not in h
        for p in result["pitchers"]:
            assert "_salaryReport" not in p

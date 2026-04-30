"""Tests for src/ballparks.py — park factor mean and normalization."""

from src.ballparks import ParkFactors, _mean_factors, _normalize


def _make_factors(name: str = "X", **overrides) -> ParkFactors:
    base = dict(
        team_name=name, park_name=name,
        pf_avg=1.0, avg_l=1.0, avg_r=1.0,
        pf_hr=1.0, hr_l=1.0, hr_r=1.0,
        pf_d=1.0, pf_t=1.0, pf=1.0,
    )
    base.update(overrides)
    return ParkFactors(**base)


def test_mean_factors_is_arithmetic_mean_per_field():
    a = _make_factors("A", pf_avg=1.0, avg_l=1.1, avg_r=0.9, pf_hr=1.0, pf_d=0.7, pf_t=1.3)
    b = _make_factors("B", pf_avg=1.2, avg_l=0.8, avg_r=1.2, pf_hr=1.5, pf_d=1.0, pf_t=1.0)
    c = _make_factors("C", pf_avg=0.8, avg_l=1.0, avg_r=1.0, pf_hr=0.5, pf_d=1.3, pf_t=0.7)
    mean = _mean_factors([a, b, c])

    assert abs(mean.pf_avg - 1.0) < 1e-9
    assert abs(mean.avg_l - (1.1 + 0.8 + 1.0) / 3) < 1e-9
    assert abs(mean.avg_r - (0.9 + 1.2 + 1.0) / 3) < 1e-9
    assert abs(mean.pf_hr - 1.0) < 1e-9
    assert abs(mean.pf_d - 1.0) < 1e-9
    assert abs(mean.pf_t - 1.0) < 1e-9
    assert mean.team_name == "League Average"
    assert mean.park_name == "League Average"


def test_normalize_returns_unity_when_factors_equal_lg():
    # League-average park normalized against itself: every adjustment must be 1.0.
    f = _make_factors(
        "X", pf_avg=1.05, avg_l=0.95, avg_r=1.10,
        pf_hr=1.20, hr_l=1.15, hr_r=1.25, pf_d=0.85, pf_t=1.30,
    )
    adj = _normalize(f, f)
    assert adj.pf_avg_adj == 1.0
    assert adj.ba_lh == 1.0
    assert adj.ba_rh == 1.0
    assert adj.pf_hr_adj == 1.0
    assert adj.hr_lh == 1.0
    assert adj.hr_rh == 1.0
    assert adj.pf_d_adj == 1.0
    assert adj.pf_t_adj == 1.0


def test_normalize_divides_each_field_by_lg_counterpart():
    f = _make_factors("HittersPark", pf_avg=1.10, avg_l=1.20, avg_r=1.05, pf_hr=1.30, pf_d=0.95)
    lg = _make_factors("Lg", pf_avg=1.00, avg_l=1.00, avg_r=1.00, pf_hr=1.00, pf_d=1.00)
    adj = _normalize(f, lg)
    assert abs(adj.pf_avg_adj - 1.10) < 1e-12
    assert abs(adj.ba_lh - 1.20) < 1e-12
    assert abs(adj.ba_rh - 1.05) < 1e-12
    assert abs(adj.pf_hr_adj - 1.30) < 1e-12
    assert abs(adj.pf_d_adj - 0.95) < 1e-12

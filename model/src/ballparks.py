"""
ballparks.py — Park factor computation for the OOTP rating system.

Implements the 'Ballparks' sheet from The Sheet Hitters.xlsx / The Sheet Pitchers.xlsx.

Data flow:
    User CSV (raw PF values) → BallparksTable → ParkDeltas
    ParkDeltas is consumed by hitters.py and pitchers.py to adjust per-PA stat counts.

Sheet structure (Excel):
    Rows 4–31  : One row per team (N teams, determined from CSV)
    Row 33     : League averages (arithmetic mean of raw PF columns)
    Rows 35–40 : Dynamic lookup rows for the selected team × home_fraction

Column groups (Excel → Python):
    C–K  : Raw park factors (from CSV)           → ParkFactors
    L–S  : Normalized adjustments (raw / avg)    → NormalizedAdjustments
    U–AB : Handedness helpers (captured in adj)
    AC–AR: Per-PA stats vs RH pitcher            → PerPAStats (hand='RH')
    AS–BH: Per-PA stats vs LH pitcher            → PerPAStats (hand='LH')
    BI–BO: Weighted summary                      → BallparkRow summary fields
"""

from __future__ import annotations

import csv
from dataclasses import dataclass
from pathlib import Path


# ---------------------------------------------------------------------------
# Constants (from Data Points sheet)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class BallparkConstants:
    """
    Data Points sheet values used in Ballparks computations.

    Calibrated from 50 years of simulated OOTP 26 baseline data (10 sims × 5 years).
    Update for different league seasons or configurations.

    Excel references:
        pa           → Data Points H31
        lg_woba      → Data Points H29
        woba_scale   → Data Points H20
        r_per_pa     → Data Points H40
        wt_*         → Data Points H12–H17
        lvr/rvr/svr  → Data Points H23–H25
        ovr_vr       → Data Points H26
        hbp_rate     → Data Points H37
        bb_rate      → Data Points C33
        hr_rate      → Data Points C34
        so_rate      → Data Points C35
        babip        → Data Points C36
        xbh_rate     → Data Points C37
        triple_rate  → Data Points C38
    """

    # Season plate appearances
    pa: float = 600.0

    # League wOBA / scale / run rate
    lg_woba: float = 0.32263
    woba_scale: float = 1.18760
    r_per_pa: float = 0.12145

    # wOBA event weights
    wt_hbp: float = 0.7268
    wt_bb: float = 0.6971
    wt_1b: float = 0.8812
    wt_2b: float = 1.2375
    wt_3b: float = 1.5581
    wt_hr: float = 1.9872

    # Platoon split fractions (fraction of PA vs RHP, by batter handedness)
    lvr: float = 0.776    # H23: LHB fraction of PA vs RHP
    rvr: float = 0.720    # H24: RHB fraction of PA vs RHP
    svr: float = 0.741    # H25: SHB fraction of PA vs RHP
    ovr_vr: float = 0.739  # H26: overall vR fraction used for park weighting

    # League hitting rates (baseline per-PA count computation)
    hbp_rate: float = 0.010154   # HBP per PA
    bb_rate: float = 0.08749     # BB per (PA − HBP)
    hr_rate: float = 0.03429     # HR per (PA − BB − HBP)
    so_rate: float = 0.24754     # SO per (PA − BB − HBP)
    babip: float = 0.30309       # hits on BIP per BIP
    xbh_rate: float = 0.26392    # extra-base hits (excl. HR) per H-HR
    triple_rate: float = 0.08966  # triples per XBH-HR


DEFAULT_CONSTANTS = BallparkConstants()


# ---------------------------------------------------------------------------
# Data containers
# ---------------------------------------------------------------------------


@dataclass
class ParkFactors:
    """
    Raw park factor values for one team (Excel columns C–K).

    Loaded directly from the user-provided CSV. All values are dimensionless
    multipliers where 1.000 = league average.
    """

    team_name: str
    park_name: str
    pf_avg: float   # C: overall average park factor
    avg_l: float    # D: batting average PF for LHB
    avg_r: float    # E: batting average PF for RHB
    pf_hr: float    # F: overall HR park factor
    hr_l: float     # G: HR PF for LHB
    hr_r: float     # H: HR PF for RHB
    pf_d: float     # I: doubles park factor
    pf_t: float     # J: triples park factor
    pf: float       # K: composite park factor


@dataclass
class NormalizedAdjustments:
    """
    Normalized park factor adjustments (Excel columns L–S): each raw PF / league mean.

    A value of 1.0 = league-average effect. >1.0 inflates the stat; <1.0 suppresses it.

    Note: pf_d_adj and pf_t_adj are not split by batter handedness — the raw CSV
    does not separate doubles/triples PF by hand (only BA and HR are split).
    """

    pf_avg_adj: float   # L: pf_avg / lg_pf_avg
    ba_lh: float        # M: avg_l / lg_avg_l  (LHB batting average factor)
    ba_rh: float        # N: avg_r / lg_avg_r  (RHB batting average factor)
    pf_hr_adj: float    # O: pf_hr / lg_pf_hr
    hr_lh: float        # P: hr_l / lg_hr_l    (LHB HR factor)
    hr_rh: float        # Q: hr_r / lg_hr_r    (RHB HR factor)
    pf_d_adj: float     # R: pf_d / lg_pf_d   (doubles — same for both hands)
    pf_t_adj: float     # S: pf_t / lg_pf_t   (triples — same for both hands)


@dataclass
class PerPAStats:
    """
    Per-PA batting stat counts for a typical batter at this park vs one pitcher hand.

    vR (vs RH pitcher): Excel columns AC–AR.
    vL (vs LH pitcher): Excel columns AS–BH (identical structure).

    All counts represent a league-average batter over a full season (600 PA by default).
    Park factor adjustments inflate/deflate individual stats relative to the neutral park.
    """

    hbp: float           # HBP count (no park adjustment — same in all parks)
    bb: float            # uBB count  (no park adjustment)
    hr: float            # HR count   (park-adjusted via hr_rh or hr_lh)
    so: float            # SO count   (no park adjustment)
    h_minus_hr: float    # H-HR count (park-adjusted via ba_rh or ba_lh)
    xbh_minus_hr: float  # XBH-HR count (park-adjusted via pf_d_adj)
    triple: float        # 3B count   (park-adjusted via pf_t_adj)
    double: float        # 2B count
    single: float        # 1B count
    obp: float           # OBP
    woba: float          # wOBA
    batr: float          # BatR: batting runs above average
    adj_obp: float       # OBP − neutral-park OBP
    adj_woba: float      # wOBA − lg_woba
    adj_batr: float      # BatR − neutral-park BatR
    park_woba: float     # adj_woba + lg_woba (= woba; retained for formula fidelity)


@dataclass
class BallparkRow:
    """
    All computed columns for one team (or the league-average row).

    Corresponds to one full row (columns C–BO) of the Ballparks sheet.
    """

    factors: ParkFactors          # raw inputs (C–K)
    adj: NormalizedAdjustments    # normalized factors (L–S)
    vr: PerPAStats                # stats vs RH pitcher (AC–AR)
    vl: PerPAStats                # stats vs LH pitcher (AS–BH)

    # Weighted summary (BI–BO) — weighted by ovr_vr / svr fractions
    wtd_obp: float          # BI: OBP weighted by svr (switch-hitter platoon split)
    wtd_woba: float         # BJ: wOBA weighted by ovr_vr
    wtd_batr: float         # BK: BatR weighted by ovr_vr
    wtd_park_woba: float    # BL: park wOBA weighted by ovr_vr (equals wtd_woba)
    woba_ratio: float       # BM: wtd_park_woba / lg_woba
    wraa: float             # BN: (wtd_park_woba − lg_woba) / woba_scale × PA
    adj_value: float        # BO: −1 × (wRAA + R/PA × PA × (1 − wOBA_ratio))


@dataclass
class ParkDeltas:
    """
    Park stat deltas for a selected team and home-game fraction.

    Implements Ballparks rows 35–40. For each stat:
        delta = (team_stat − league_avg_stat) × home_fraction

    These deltas are the direct inputs to Hitters/Pitchers formulas
    (e.g., Ballparks!$AH$37, Ballparks!$AE$37, Ballparks!$AI$37).
    """

    team_name: str
    home_fraction: float

    # vR deltas (row 37): (team_vR_stat − league_vR_stat) × home_fraction
    hr_vr: float             # AE37
    h_minus_hr_vr: float     # AH37
    xbh_minus_hr_vr: float   # AG37
    triple_vr: float         # AI37

    # vL deltas (row 40)
    hr_vl: float             # AE40
    h_minus_hr_vl: float     # AH40
    xbh_minus_hr_vl: float   # AG40
    triple_vl: float         # AI40

    # Park factor summary for this team
    woba_ratio: float        # BM of selected team
    adj_value: float         # BO of selected team


# ---------------------------------------------------------------------------
# Module-level helper functions
# ---------------------------------------------------------------------------


def _neutral_adj() -> NormalizedAdjustments:
    """Return a NormalizedAdjustments with all factors = 1.0 (neutral/league-average park)."""
    return NormalizedAdjustments(
        pf_avg_adj=1.0, ba_lh=1.0, ba_rh=1.0, pf_hr_adj=1.0,
        hr_lh=1.0, hr_rh=1.0, pf_d_adj=1.0, pf_t_adj=1.0,
    )


def neutral_park_deltas(
    team_name: str = "Neutral",
    home_fraction: float = 0.5,
) -> ParkDeltas:
    """Return a ParkDeltas with all deltas=0, woba_ratio=1.0, adj_value=0.0.

    Use when APPLY_PARK_FACTORS=False to pass a no-op park object to
    compute functions that require a ParkDeltas parameter.
    """
    return ParkDeltas(
        team_name=team_name,
        home_fraction=home_fraction,
        hr_vr=0.0, h_minus_hr_vr=0.0, xbh_minus_hr_vr=0.0, triple_vr=0.0,
        hr_vl=0.0, h_minus_hr_vl=0.0, xbh_minus_hr_vl=0.0, triple_vl=0.0,
        woba_ratio=1.0,
        adj_value=0.0,
    )


def neutral_adjustments() -> NormalizedAdjustments:
    """Return a NormalizedAdjustments with all factors=1.0 (no park effect).

    Public wrapper around _neutral_adj() for use when APPLY_PARK_FACTORS=False.
    """
    return _neutral_adj()


def _mean_factors(factors_list: list[ParkFactors]) -> ParkFactors:
    """Compute arithmetic mean of all raw park factors (Excel row 33)."""
    n = len(factors_list)
    return ParkFactors(
        team_name="League Average",
        park_name="League Average",
        pf_avg=sum(f.pf_avg for f in factors_list) / n,
        avg_l=sum(f.avg_l for f in factors_list) / n,
        avg_r=sum(f.avg_r for f in factors_list) / n,
        pf_hr=sum(f.pf_hr for f in factors_list) / n,
        hr_l=sum(f.hr_l for f in factors_list) / n,
        hr_r=sum(f.hr_r for f in factors_list) / n,
        pf_d=sum(f.pf_d for f in factors_list) / n,
        pf_t=sum(f.pf_t for f in factors_list) / n,
        pf=sum(f.pf for f in factors_list) / n,
    )


def _normalize(factors: ParkFactors, lg: ParkFactors) -> NormalizedAdjustments:
    """
    Compute normalized adjustments for one team (Excel columns L–S).

    Each adjustment = raw_PF / league_avg_PF.
    For the league-average row itself (factors == lg), all adjustments = 1.0.
    """
    return NormalizedAdjustments(
        pf_avg_adj=factors.pf_avg / lg.pf_avg,
        ba_lh=factors.avg_l / lg.avg_l,
        ba_rh=factors.avg_r / lg.avg_r,
        pf_hr_adj=factors.pf_hr / lg.pf_hr,
        hr_lh=factors.hr_l / lg.hr_l,
        hr_rh=factors.hr_r / lg.hr_r,
        pf_d_adj=factors.pf_d / lg.pf_d,
        pf_t_adj=factors.pf_t / lg.pf_t,
    )


def _compute_per_pa_stats(
    adj: NormalizedAdjustments,
    hand: str,
    constants: BallparkConstants,
    lg_vr: PerPAStats | None = None,
    lg_vl: PerPAStats | None = None,
) -> PerPAStats:
    """
    Compute per-PA stat counts for one pitcher handedness (vR or vL).

    Implements Excel columns AC–AR (hand='RH') or AS–BH (hand='LH').

    Stat pipeline:
        HBP  = hbp_rate × PA                               (no park adjustment)
        BB   = bb_rate × (PA − HBP)                        (no park adjustment)
        HR   = hr_rate × (PA − BB − HBP) × hr_adj          (park-adjusted)
        SO   = so_rate × (PA − BB − HBP)                   (no park adjustment)
        H-HR = babip × BIP × ba_adj                        (park-adjusted)
        XBH  = xbh_rate × H-HR × pf_d_adj                 (park-adjusted)
        3B   = XBH × triple_rate × pf_t_adj               (park-adjusted)
        2B   = XBH − 3B
        1B   = H-HR − XBH

    where hr_adj = hr_rh (RH) or hr_lh (LH), ba_adj = ba_rh (RH) or ba_lh (LH).
    pf_d_adj and pf_t_adj are shared between hands (no handedness split in CSV).

    Args:
        adj:      Normalized park factor adjustments for this park.
        hand:     'RH' (vs RH pitcher) or 'LH' (vs LH pitcher).
        constants: Data Points constants.
        lg_vr:    Neutral-park vR stats (used to compute adj_* fields). None for bootstrap.
        lg_vl:    Neutral-park vL stats (used to compute adj_* fields). None for bootstrap.

    Returns:
        PerPAStats with all fields populated. If lg_vr/lg_vl are None (bootstrap pass),
        adj_obp, adj_batr, and park_woba are set to 0.0.
    """
    c = constants

    ba_adj = adj.ba_rh if hand == "RH" else adj.ba_lh
    hr_adj = adj.hr_rh if hand == "RH" else adj.hr_lh

    hbp = c.hbp_rate * c.pa
    bb = c.bb_rate * (c.pa - hbp)
    hr = c.hr_rate * (c.pa - bb - hbp) * hr_adj
    so = c.so_rate * (c.pa - bb - hbp)
    bip = c.pa - bb - hbp - hr - so
    h_minus_hr = c.babip * bip * ba_adj
    xbh_minus_hr = c.xbh_rate * h_minus_hr * adj.pf_d_adj
    triple = xbh_minus_hr * c.triple_rate * adj.pf_t_adj
    double = xbh_minus_hr - triple
    single = h_minus_hr - xbh_minus_hr

    obp = (bb + hbp + single + double + triple + hr) / c.pa
    woba = (
        c.wt_hbp * hbp
        + c.wt_bb * bb
        + c.wt_1b * single
        + c.wt_2b * double
        + c.wt_3b * triple
        + c.wt_hr * hr
    ) / c.pa
    batr = (woba - c.lg_woba) / c.woba_scale * c.pa

    # adj_* fields require the neutral-park baseline; set to 0.0 on the bootstrap pass.
    # adj_woba (Excel AP) = wOBA − AM$33  (relative to the COMPUTED neutral-park wOBA,
    # NOT the Data Points constant H29).  park_woba (Excel AR) = adj_woba + H29.
    # This differs from simply using woba when the computed neutral-park wOBA (≈0.32253)
    # doesn't exactly equal the calibrated constant (0.32263).
    lg = (lg_vr if hand == "RH" else lg_vl) if lg_vr is not None else None
    if lg is not None:
        adj_obp = obp - lg.obp
        adj_woba = woba - lg.woba       # Excel AP: wOBA − AM$33
        adj_batr = batr - lg.batr
        park_woba = adj_woba + c.lg_woba  # Excel AR: adj_woba + H29
    else:
        adj_obp = 0.0
        adj_woba = 0.0
        adj_batr = 0.0
        park_woba = 0.0

    return PerPAStats(
        hbp=hbp, bb=bb, hr=hr, so=so,
        h_minus_hr=h_minus_hr, xbh_minus_hr=xbh_minus_hr,
        triple=triple, double=double, single=single,
        obp=obp, woba=woba, batr=batr,
        adj_obp=adj_obp, adj_woba=adj_woba, adj_batr=adj_batr,
        park_woba=park_woba,
    )


def _compute_row(
    factors: ParkFactors,
    adj: NormalizedAdjustments,
    constants: BallparkConstants,
    lg_vr: PerPAStats,
    lg_vl: PerPAStats,
) -> BallparkRow:
    """
    Compute all columns for one Ballparks row (Excel columns C–BO).

    Args:
        factors:   Raw park factors for this team.
        adj:       Normalized adjustments (raw / league_avg).
        constants: Data Points constants.
        lg_vr:     Neutral-park vR stats (used for adj_* delta computation).
        lg_vl:     Neutral-park vL stats.

    Returns:
        BallparkRow with all computed fields.
    """
    c = constants

    vr = _compute_per_pa_stats(adj, "RH", c, lg_vr, lg_vl)
    vl = _compute_per_pa_stats(adj, "LH", c, lg_vr, lg_vl)

    # Weighted summary (Excel columns BI–BO)
    # BI: weighted OBP using svr (switch-hitter platoon split fraction)
    wtd_obp = vr.obp * c.svr + vl.obp * (1.0 - c.svr)
    # BJ: weighted wOBA using ovr_vr (overall RH fraction)
    wtd_woba = vr.woba * c.ovr_vr + vl.woba * (1.0 - c.ovr_vr)
    # BK: weighted BatR
    wtd_batr = vr.batr * c.ovr_vr + vl.batr * (1.0 - c.ovr_vr)
    # BL: weighted park wOBA — park_woba = woba (adj_woba + lg_woba), so BL = BJ
    wtd_park_woba = vr.park_woba * c.ovr_vr + vl.park_woba * (1.0 - c.ovr_vr)
    # BM: wOBA ratio
    woba_ratio = wtd_park_woba / c.lg_woba
    # BN: wRAA
    wraa = (wtd_park_woba - c.lg_woba) / c.woba_scale * c.pa
    # BO: park adjustment = −1 × (wRAA + R/PA × PA × (1 − wOBA_ratio))
    adj_value = -1.0 * (wraa + c.r_per_pa * c.pa * (1.0 - woba_ratio))

    return BallparkRow(
        factors=factors,
        adj=adj,
        vr=vr,
        vl=vl,
        wtd_obp=wtd_obp,
        wtd_woba=wtd_woba,
        wtd_batr=wtd_batr,
        wtd_park_woba=wtd_park_woba,
        woba_ratio=woba_ratio,
        wraa=wraa,
        adj_value=adj_value,
    )


# ---------------------------------------------------------------------------
# Main class
# ---------------------------------------------------------------------------


def load_team_names(csv_path: str | Path) -> list[str]:
    """Read team names from a ballparks CSV without computing the full table.

    Args:
        csv_path: Path to the ballparks CSV file.

    Returns:
        List of team names in CSV order.
    """
    path = Path(csv_path)
    names: list[str] = []
    with path.open(newline="", encoding="utf-8") as f:
        reader = csv.reader(f)
        first_row = True
        for row in reader:
            if not row or all(cell.strip() == "" for cell in row):
                continue
            if first_row:
                first_row = False
                if [c.strip() for c in row] == list(BallparksTable.CSV_HEADERS):
                    continue
            names.append(row[0].strip())
    return names


class BallparksTable:
    """
    Ballparks sheet computation loaded from a user-provided CSV file.

    The CSV must have 11 columns (in order):
        Team Name, Park, PF AVG, AVG L, AVG R, PF HR, HR L, HR R, PF D, PF T, PF

    The number of teams and their names are parsed dynamically from the CSV.
    League averages are computed as the arithmetic mean of all team rows —
    identical to Excel's AVERAGE(C4:C31) for each raw PF column.

    Usage:
        table = BallparksTable.from_csv("ballparks.csv")
        deltas = table.compute_park_deltas("Arizona Diamondbacks", home_fraction=0.5)

    Attributes:
        team_names   : List of team names in CSV order.
        team_count   : Number of teams.
        rows         : Dict mapping team_name → BallparkRow.
        league_row   : BallparkRow for the league-average (neutral park).
        constants    : BallparkConstants used for all computations.
    """

    CSV_HEADERS = (
        "Team Name", "Park", "PF AVG", "AVG L", "AVG R",
        "PF HR", "HR L", "HR R", "PF D", "PF T", "PF",
    )

    def __init__(
        self,
        factors_list: list[ParkFactors],
        constants: BallparkConstants = DEFAULT_CONSTANTS,
    ) -> None:
        self.constants = constants
        self.team_names = [f.team_name for f in factors_list]
        self.team_count = len(factors_list)

        # League-average raw factors (Excel row 33)
        self._lg_factors = _mean_factors(factors_list)

        # Bootstrap: compute neutral-park per-PA stats (all adj = 1.0).
        # These become the baseline for adj_obp and adj_batr in all team rows.
        neutral = _neutral_adj()
        lg_vr = _compute_per_pa_stats(neutral, "RH", constants)
        lg_vl = _compute_per_pa_stats(neutral, "LH", constants)

        # Compute all team rows
        self.rows: dict[str, BallparkRow] = {}
        for factors in factors_list:
            adj = _normalize(factors, self._lg_factors)
            self.rows[factors.team_name] = _compute_row(factors, adj, constants, lg_vr, lg_vl)

        # League-average row (neutral park — all adj = 1.0; adj_* fields = 0)
        self.league_row = _compute_row(self._lg_factors, neutral, constants, lg_vr, lg_vl)

    @classmethod
    def from_csv(
        cls,
        csv_path: str | Path,
        constants: BallparkConstants = DEFAULT_CONSTANTS,
    ) -> "BallparksTable":
        """
        Load a BallparksTable from a user-provided CSV file.

        Expected CSV format (comma-separated):
            Team Name, Park, PF AVG, AVG L, AVG R, PF HR, HR L, HR R, PF D, PF T, PF

        An optional header row matching the expected column names is automatically
        detected and skipped. Empty rows are skipped. All other rows are treated
        as team data — team count is determined from the number of data rows.

        Args:
            csv_path:  Path to the ballparks CSV file.
            constants: Data Points constants to use for all computations.

        Returns:
            A fully computed BallparksTable.

        Raises:
            FileNotFoundError: If csv_path does not exist.
            ValueError: If any row has fewer than 11 columns or contains
                        non-numeric values in the park factor columns.
        """
        path = Path(csv_path)
        factors_list: list[ParkFactors] = []

        with path.open(newline="", encoding="utf-8") as f:
            reader = csv.reader(f)
            first_row = True
            for row in reader:
                # Skip empty rows
                if not row or all(cell.strip() == "" for cell in row):
                    continue

                # Skip header row if present
                if first_row:
                    first_row = False
                    if [c.strip() for c in row] == list(cls.CSV_HEADERS):
                        continue

                if len(row) < 11:
                    raise ValueError(
                        f"Expected 11 columns per row, got {len(row)}: {row}"
                    )

                try:
                    factors_list.append(ParkFactors(
                        team_name=row[0].strip(),
                        park_name=row[1].strip(),
                        pf_avg=float(row[2]),
                        avg_l=float(row[3]),
                        avg_r=float(row[4]),
                        pf_hr=float(row[5]),
                        hr_l=float(row[6]),
                        hr_r=float(row[7]),
                        pf_d=float(row[8]),
                        pf_t=float(row[9]),
                        pf=float(row[10]),
                    ))
                except ValueError as exc:
                    raise ValueError(
                        f"Invalid numeric value in row {row}: {exc}"
                    ) from exc

        if not factors_list:
            raise ValueError("CSV file contains no team data rows.")

        return cls(factors_list, constants)

    def compute_park_deltas(
        self,
        team_name: str,
        home_fraction: float,
    ) -> ParkDeltas:
        """
        Compute park stat deltas for a selected team and home-game fraction.

        Implements Ballparks rows 35–40. For each per-PA stat:
            delta = (team_stat − league_avg_stat) × home_fraction

        The returned ParkDeltas is the direct input to Hitters/Pitchers formulas.

        Args:
            team_name:     Team name as it appears in the CSV.
            home_fraction: Fraction of games played at home (0.0–1.0).
                           A full season split is typically ~0.5.

        Returns:
            ParkDeltas with vR (row 37) and vL (row 40) stat deltas.

        Raises:
            KeyError: If team_name is not found in the loaded CSV.
        """
        if team_name not in self.rows:
            raise KeyError(
                f"Team '{team_name}' not found. "
                f"Available teams: {self.team_names}"
            )

        team = self.rows[team_name]
        lg = self.league_row

        def d(team_val: float, lg_val: float) -> float:
            return (team_val - lg_val) * home_fraction

        vr = team.vr
        vl = team.vl
        lg_vr = lg.vr
        lg_vl = lg.vl

        return ParkDeltas(
            team_name=team_name,
            home_fraction=home_fraction,

            # vR deltas (row 37) — all use RH park factors
            hr_vr=d(vr.hr, lg_vr.hr),
            h_minus_hr_vr=d(vr.h_minus_hr, lg_vr.h_minus_hr),
            xbh_minus_hr_vr=d(vr.xbh_minus_hr, lg_vr.xbh_minus_hr),
            triple_vr=d(vr.triple, lg_vr.triple),

            # vL deltas (row 40) — all use LH park factors
            hr_vl=d(vl.hr, lg_vl.hr),
            h_minus_hr_vl=d(vl.h_minus_hr, lg_vl.h_minus_hr),
            xbh_minus_hr_vl=d(vl.xbh_minus_hr, lg_vl.xbh_minus_hr),
            triple_vl=d(vl.triple, lg_vl.triple),

            # Park factor summary
            woba_ratio=team.woba_ratio,
            adj_value=team.adj_value,
        )

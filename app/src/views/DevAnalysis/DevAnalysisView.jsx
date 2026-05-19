// Coordinator: owns curve sliders + the heavy player-pool/regression memos
// that the chart sub-components consume as props.
import { useState, useMemo, useRef } from "react";
import { Section, PositionFilter } from "../../components/shared.jsx";
import { getMaxWar, getMaxWarP, getSpWar, getRpWar, getSpWarP, getRpWarP, passesPositionFilter, pickFielderPos, pickPitcherRole, scaleRpWarP } from "../../utils/accessors.js";
import { DEV_CURVE_DEFAULTS } from "../../utils/constants.js";
import { isProspect, isInOrg } from "../../utils/prospects.js";
import { calcFutureValue, devPercentileRank, calcCreditAge, typicalAtAge } from "../../utils/futureValue.js";

import { weightedPercentile } from "./_shared.js";
import { DevScatterChart } from "./DevScatterChart.jsx";
import { GapDistributionChart } from "./GapDistributionChart.jsx";
import { WarPercentileChart } from "./WarPercentileChart.jsx";
import { FVImpactTable } from "./FVImpactTable.jsx";
import { LiveProspectPreview } from "./LiveProspectPreview.jsx";
import { CurveTuningPanel } from "./CurveTuningPanel.jsx";

const PITCHER_FILTER_KEYS = ["Pitchers", "SP", "RP"];

function DevAnalysisView({ data, curveSettings, updateCurveSettings }) {
  const [posFilter, setPosFilter] = useState([]);
  const [gapMinPot, setGapMinPot] = useState("");

  const filterIntent = useMemo(() => {
    const isAll = posFilter.length === 0;
    const hasBroadHitters = isAll || posFilter.includes("Hitters");
    const hasBroadPitchers = isAll || posFilter.includes("Pitchers");
    const hasSP = posFilter.includes("SP");
    const hasRP = posFilter.includes("RP");
    const hasSpecificHitterPos = posFilter.some(f => !PITCHER_FILTER_KEYS.includes(f) && f !== "Hitters");
    const hasHitterAny = hasBroadHitters || hasSpecificHitterPos;
    const hasPitcherAny = isAll || posFilter.some(f => PITCHER_FILTER_KEYS.includes(f));
    const onlySP = hasSP && !hasRP && !hasBroadPitchers && !isAll;
    const onlyRP = hasRP && !hasSP && !hasBroadPitchers && !isAll;
    return { isAll, hasBroadHitters, hasHitterAny, hasPitcherAny, hasSpecificHitterPos, onlySP, onlyRP };
  }, [posFilter]);

  // Local state for sliders (live preview), only persisted on Save.
  // v21: two exposed knobs — gapMax, gapExp.
  const [localGapMax, setLocalGapMax] = useState(curveSettings.gapMax);
  const [localGapExp, setLocalGapExp] = useState(curveSettings.gapExp);
  const [localMaxCurrentAge, setLocalMaxCurrentAge] = useState(curveSettings.maxCurrentAge);
  const [localBandwidth, setLocalBandwidth] = useState(curveSettings.bandwidth);
  const [computedBandwidth, setComputedBandwidth] = useState(curveSettings.bandwidth);
  const bwDebounceRef = useRef(null);
  const handleBandwidthChange = (val) => {
    setLocalBandwidth(val);
    clearTimeout(bwDebounceRef.current);
    bwDebounceRef.current = setTimeout(() => setComputedBandwidth(val), 200);
  };

  const gapMax = localGapMax;
  const gapExp = localGapExp;
  const maxCurrentAge = localMaxCurrentAge;
  const bandwidth = computedBandwidth;

  const curveSettingsDirty =
    gapMax !== curveSettings.gapMax
    || gapExp !== curveSettings.gapExp
    || maxCurrentAge !== curveSettings.maxCurrentAge;
  const bandwidthDirty = localBandwidth !== curveSettings.bandwidth;
  const _eqDefault = (obj) =>
    obj.gapMax === DEV_CURVE_DEFAULTS.gapMax
    && obj.gapExp === DEV_CURVE_DEFAULTS.gapExp
    && obj.maxCurrentAge === DEV_CURVE_DEFAULTS.maxCurrentAge;
  const isLocalDefault = _eqDefault({ gapMax, gapExp, maxCurrentAge });
  const isSavedDefault = _eqDefault(curveSettings);

  const saveCurveSettings = () => updateCurveSettings({ gapMax, gapExp, maxCurrentAge });
  const saveBandwidth = () => updateCurveSettings({ bandwidth });
  const resetCurveSettings = () => {
    setLocalGapMax(curveSettings.gapMax);
    setLocalGapExp(curveSettings.gapExp);
    setLocalMaxCurrentAge(curveSettings.maxCurrentAge);
  };
  const restoreDefaults = () => {
    setLocalGapMax(DEV_CURVE_DEFAULTS.gapMax);
    setLocalGapExp(DEV_CURVE_DEFAULTS.gapExp);
    setLocalMaxCurrentAge(DEV_CURVE_DEFAULTS.maxCurrentAge);
  };
  const resetBandwidth = () => { setLocalBandwidth(curveSettings.bandwidth); setComputedBandwidth(curveSettings.bandwidth); };

  // v20: devCurves still embedded in JSON for devPct lookup AND for the
  // empirical reference overlay in the gapFactor chart.
  const devCurves = data.meta?.devCurve ?? null;
  const hitCurve = devCurves?.hit ?? null;

  const players = useMemo(() => {
    const { hasBroadHitters, hasHitterAny, hasPitcherAny, hasSpecificHitterPos, onlySP, onlyRP } = filterIntent;
    const pool = [];
    if (hasHitterAny) {
      for (const h of data.hitters) {
        if (h._age == null) continue;
        if (!passesPositionFilter(h, posFilter)) continue;
        let currentWAR, potentialWAR;
        if (hasSpecificHitterPos && !hasBroadHitters) {
          const picked = pickFielderPos(h, posFilter);
          if (!picked) continue;
          currentWAR = picked.war;
          potentialWAR = picked.warP;
        } else {
          currentWAR = getMaxWar(h);
          potentialWAR = getMaxWarP(h);
        }
        pool.push({
          name: h.meta?.name ?? h.Name, age: h._age, pos: h.meta?.pos ?? h.POS, org: h.meta?.org ?? h.ORG, manual: h.meta?.source ?? h.meta?.manual ?? h.Manual,
          currentWAR, potentialWAR, type: "hitter",
        });
      }
    }
    if (hasPitcherAny) {
      for (const p of data.pitchers) {
        if (p._age == null) continue;
        if (!passesPositionFilter(p, posFilter)) continue;
        let currentWAR, potentialWAR;
        if (onlySP) {
          currentWAR = getSpWar(p);
          if (currentWAR == null) continue;
          potentialWAR = getSpWarP(p);
        } else if (onlyRP) {
          currentWAR = scaleRpWarP(getRpWar(p));
          potentialWAR = scaleRpWarP(getRpWarP(p));
        } else {
          const role = pickPitcherRole(p);
          currentWAR = role.warSort;
          potentialWAR = role.warPSort;
        }
        pool.push({
          name: p.meta?.name ?? p.Name, age: p._age, pos: p.meta?.pos ?? p.POS, org: p.meta?.org ?? p.ORG, manual: p.meta?.source ?? p.meta?.manual ?? p.Manual,
          currentWAR, potentialWAR, type: "pitcher",
        });
      }
    }
    return pool;
  }, [data, posFilter, filterIntent]);

  const minAge = useMemo(() => {
    if (players.length === 0) return 14;
    let min = Infinity;
    for (const p of players) if (p.age < min) min = p.age;
    return Math.floor(min);
  }, [players]);
  const maxAge = useMemo(() => {
    if (players.length === 0) return 45;
    let max = -Infinity;
    for (const p of players) if (p.age > max) max = p.age;
    return Math.ceil(max);
  }, [players]);

  const scatterCurrent = useMemo(() =>
    players.filter((p) => p.currentWAR != null).map((p) => ({ age: p.age, y: p.currentWAR, name: p.name, pos: p.pos, org: p.org, manual: p.manual })),
    [players]
  );
  const scatterPotential = useMemo(() =>
    players.filter((p) => p.potentialWAR != null).map((p) => ({ age: p.age, y: p.potentialWAR, name: p.name, pos: p.pos, org: p.org, manual: p.manual })),
    [players]
  );

  // Kernel-smoothed average trend lines (Gaussian-weighted regression).
  // Optimized: sort by age, binary-search for nearby players within 3*bandwidth window.
  const avgTrendData = useMemo(() => {
    const withCurrent = players.filter((p) => p.currentWAR != null).sort((a, b) => a.age - b.age);
    const withPotential = players.filter((p) => p.potentialWAR != null).sort((a, b) => a.age - b.age);
    if (withCurrent.length < 10 && withPotential.length < 10) return [];
    const step = 0.25;
    const radius = 3 * bandwidth;
    const pts = [];
    const lowerBound = (arr, target) => {
      let lo = 0, hi = arr.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; arr[mid].age < target ? lo = mid + 1 : hi = mid; }
      return lo;
    };
    for (let age = minAge; age <= maxAge; age += step) {
      let sumWC = 0, sumVC = 0, sumWP = 0, sumVP = 0;
      const lo = age - radius, hi = age + radius;
      let startC = lowerBound(withCurrent, lo);
      for (let i = startC; i < withCurrent.length && withCurrent[i].age <= hi; i++) {
        const d = (withCurrent[i].age - age) / bandwidth;
        const w = Math.exp(-0.5 * d * d);
        if (w > 0.001) { sumWC += w; sumVC += w * withCurrent[i].currentWAR; }
      }
      let startP = lowerBound(withPotential, lo);
      for (let i = startP; i < withPotential.length && withPotential[i].age <= hi; i++) {
        const d = (withPotential[i].age - age) / bandwidth;
        const w = Math.exp(-0.5 * d * d);
        if (w > 0.001) { sumWP += w; sumVP += w * withPotential[i].potentialWAR; }
      }
      const avgCurrent = sumWC >= 1 ? sumVC / sumWC : null;
      const avgPotential = sumWP >= 1 ? sumVP / sumWP : null;
      const gap = (avgCurrent != null && avgPotential != null) ? avgPotential - avgCurrent : null;
      if (avgCurrent != null || avgPotential != null) {
        pts.push({ age: Math.round(age * 100) / 100, avgCurrent, avgPotential, gap });
      }
    }
    return pts;
  }, [players, minAge, maxAge, bandwidth]);

  // Kernel-smoothed percentile regression of gap across ages
  const gapMinPotNum = gapMinPot === "" ? null : parseFloat(gapMinPot);
  const gapPlayerDataAll = useMemo(() =>
    players.filter((p) => p.currentWAR != null && p.potentialWAR != null)
      .map((p) => ({ age: p.age, gap: Math.max(0, p.potentialWAR - p.currentWAR) })),
    [players]
  );
  const gapPlayerData = useMemo(() =>
    gapMinPotNum == null ? gapPlayerDataAll :
    players.filter((p) => p.currentWAR != null && p.potentialWAR != null && p.potentialWAR >= gapMinPotNum)
      .map((p) => ({ age: p.age, gap: Math.max(0, p.potentialWAR - p.currentWAR) })),
    [players, gapPlayerDataAll, gapMinPotNum]
  );

  const computeGapRegression = (inputData) => {
    if (inputData.length < 10) return [];
    const sortedByGap = [...inputData].sort((a, b) => a.gap - b.gap);
    const step = 0.25;
    const pts = [];
    for (let age = minAge; age <= maxAge; age += step) {
      const gaps = [], ws = [];
      for (const d of sortedByGap) {
        const dist = (d.age - age) / bandwidth;
        if (Math.abs(dist) > 3) continue;
        const w = Math.exp(-0.5 * dist * dist);
        if (w > 0.001) { gaps.push(d.gap); ws.push(w); }
      }
      const totalW = ws.reduce((s, w) => s + w, 0);
      if (totalW < 1) continue;
      const median = weightedPercentile(gaps, ws, 0.5);
      const p10 = weightedPercentile(gaps, ws, 0.1);
      const p25 = weightedPercentile(gaps, ws, 0.25);
      const p75 = weightedPercentile(gaps, ws, 0.75);
      const p90 = weightedPercentile(gaps, ws, 0.9);
      pts.push({
        age: Math.round(age * 100) / 100,
        median,
        iqrRange: [p25, p75],
        outerRange: [p10, p90],
      });
    }
    return pts;
  };

  const gapRegressionAll = useMemo(() => computeGapRegression(gapPlayerDataAll), [gapPlayerDataAll, minAge, maxAge, bandwidth]);
  const gapRegressionData = useMemo(() =>
    gapMinPotNum == null ? gapRegressionAll : computeGapRegression(gapPlayerData),
    [gapMinPotNum, gapRegressionAll, gapPlayerData, minAge, maxAge, bandwidth]
  );
  const gapChartMaxAge = useMemo(() => {
    for (let i = 0; i < gapRegressionAll.length; i++) {
      if (gapRegressionAll[i].median <= 0.05) return Math.ceil(gapRegressionAll[i].age);
    }
    return maxAge;
  }, [gapRegressionAll, maxAge]);
  const gapChartMaxY = useMemo(() => {
    let maxVal = 1;
    for (const d of gapPlayerDataAll) maxVal = Math.max(maxVal, d.gap);
    return Math.ceil(maxVal);
  }, [gapPlayerDataAll]);
  const gapRegressionTrimmed = useMemo(() =>
    gapRegressionData.filter((d) => d.age <= gapChartMaxAge),
    [gapRegressionData, gapChartMaxAge]
  );

  const warPercentileData = useMemo(() => {
    const withCurrent = players.filter((p) => p.currentWAR != null);
    if (withCurrent.length < 10) return [];
    const sortedByWAR = [...withCurrent].sort((a, b) => a.currentWAR - b.currentWAR);
    const step = 0.25;
    const pts = [];
    for (let age = minAge; age <= maxAge; age += step) {
      const vals = [], ws = [];
      for (const d of sortedByWAR) {
        const dist = (d.age - age) / bandwidth;
        if (Math.abs(dist) > 3) continue;
        const w = Math.exp(-0.5 * dist * dist);
        if (w > 0.001) { vals.push(d.currentWAR); ws.push(w); }
      }
      const totalW = ws.reduce((s, w) => s + w, 0);
      if (totalW < 1) continue;
      const p10 = weightedPercentile(vals, ws, 0.1);
      const p25 = weightedPercentile(vals, ws, 0.25);
      const median = weightedPercentile(vals, ws, 0.5);
      const p75 = weightedPercentile(vals, ws, 0.75);
      const p90 = weightedPercentile(vals, ws, 0.9);
      const p95 = weightedPercentile(vals, ws, 0.95);
      const p99 = weightedPercentile(vals, ws, 0.99);
      const nEff = Math.round(totalW);
      const nAbove = (threshold) => { let c = 0; for (let i = 0; i < vals.length; i++) if (vals[i] >= threshold) c++; return c; };
      pts.push({ age: Math.round(age * 100) / 100, p10, p25, median, p75, p90, p95, p99, nEff, nAbove10: nAbove(p10), nAbove25: nAbove(p25), nAbove50: nAbove(median), nAbove75: nAbove(p75), nAbove90: nAbove(p90), nAbove95: nAbove(p95), nAbove99: nAbove(p99), outerRange: [p10, p90], iqrRange: [p25, p75] });
    }
    return pts;
  }, [players, minAge, maxAge, bandwidth]);

  // v21 — creditAge by Age. Slider-responsive on gapMax + gapExp.
  // Single line for the parametric power-law curve, with empirical reference
  // (1 − progressCurve.p50) overlaid as a dashed line for visual comparison.
  const progressCurveHit = data.meta?.progressCurve?.hit ?? null;
  const creditFactorData = useMemo(() => {
    const pts = [];
    for (let age = 14; age <= maxCurrentAge; age += 0.5) {
      const a = Math.round(age * 10) / 10;
      const parametric = calcCreditAge(a, { gapMax, gapExp, maxCurrentAge });
      // Empirical creditAge = 1 − progressCurve.p50[age], linear-interp.
      let empirical = null;
      if (progressCurveHit) {
        const p50 = typicalAtAge(progressCurveHit, a);
        if (p50 != null) empirical = Math.max(0, 1 - p50);
      }
      pts.push({ age: a, parametric, empirical });
    }
    return pts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gapMax, gapExp, maxCurrentAge, progressCurveHit]);

  // Legacy chart data — retained as no-op for backward-compat with sub-components
  // that may still reference it. v21 chart is creditFactorData.
  const gapFactorChartData = creditFactorData;

  // Always rank against the full prospect pool (global semantics) so filtering
  // narrows visible rows but each player keeps their league-wide Rk.
  const prospectPreview = useMemo(() => {
    const curveOpts = { gapMax, gapExp, maxCurrentAge };
    const pool = [];

    for (const h of data.hitters) {
      if (!isProspect(h) || !isInOrg(h)) continue;
      if (h._age == null) continue;
      if (h._age >= maxCurrentAge) continue;
      const cur = getMaxWar(h);
      const pot = getMaxWarP(h);
      // v21: Dev% = cur-WAR percentile within age cohort (display only).
      const devPct = (hitCurve && cur != null) ? devPercentileRank(hitCurve, h._age, cur) : null;
      const fv = calcFutureValue(cur, pot, h._age, curveOpts);
      pool.push({
        _player: h,
        name: h.meta?.name ?? h.Name, age: h._age, pos: h.meta?.pos ?? h.POS, org: h.meta?.org ?? h.ORG,
        devPct, cur, pot, fv, type: "hitter",
      });
    }

    for (const p of data.pitchers) {
      if (!isProspect(p) || !isInOrg(p)) continue;
      if (p._age == null) continue;
      if (p._age >= maxCurrentAge) continue;
      const role = pickPitcherRole(p, devCurves, curveOpts, 'best');
      pool.push({
        _player: p,
        name: p.meta?.name ?? p.Name, age: p._age, pos: p.meta?.pos ?? p.POS, org: p.meta?.org ?? p.ORG,
        devPct: role.devPct, cur: role.warSort, pot: role.warPSort, fv: role.fv, type: "pitcher",
      });
    }

    pool.sort((a, b) => (b.fv ?? 0) - (a.fv ?? 0));
    const ranked = pool.map((p, i) => ({ ...p, fvRank: i + 1 }));
    if (posFilter.length === 0) return ranked;
    return ranked.filter(p => passesPositionFilter(p._player, posFilter));
  }, [data, posFilter, gapMax, gapExp, maxCurrentAge, hitCurve, devCurves]);

  const poolLabel = useMemo(() => {
    const { isAll, hasHitterAny, hasPitcherAny, onlySP, onlyRP } = filterIntent;
    if (isAll) return "all players";
    if (hasHitterAny && !hasPitcherAny) return posFilter.includes("Hitters") ? "hitters" : posFilter.join(", ");
    if (hasPitcherAny && !hasHitterAny) {
      if (onlySP) return "SP";
      if (onlyRP) return "RP";
      return "pitchers";
    }
    return "mixed";
  }, [filterIntent, posFilter]);

  const filterRow = (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <span style={{ fontSize: 12, color: "#94a3b8", fontWeight: 600 }}>Filter:</span>
      <PositionFilter value={posFilter} onChange={setPosFilter} />
    </div>
  );

  const curveOpts = { gapMax, gapExp, maxCurrentAge };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {filterRow}

      {players.length === 0 && <div style={{ padding: 40, textAlign: "center", color: "#475569", fontSize: 14 }}>No player data available for the selected type.</div>}

      {players.length > 0 && <>
        <Section title="Age vs WAR Distribution">
          <DevScatterChart
            scatterCurrent={scatterCurrent}
            scatterPotential={scatterPotential}
            avgTrendData={avgTrendData}
            minAge={minAge}
            maxAge={maxAge}
            playerCount={players.length}
          />
        </Section>

        <GapDistributionChart
          gapRegressionTrimmed={gapRegressionTrimmed}
          gapPlayerCount={gapPlayerData.length}
          gapMinPot={gapMinPot}
          setGapMinPot={setGapMinPot}
          gapShowingFiltered={gapMinPot !== ""}
          minAge={minAge}
          gapChartMaxAge={gapChartMaxAge}
          gapChartMaxY={gapChartMaxY}
          localBandwidth={localBandwidth}
          handleBandwidthChange={handleBandwidthChange}
          savedBandwidth={curveSettings.bandwidth}
          bandwidthDirty={bandwidthDirty}
          saveBandwidth={saveBandwidth}
          resetBandwidth={resetBandwidth}
        />

        <WarPercentileChart
          warPercentileData={warPercentileData}
          minAge={minAge}
          maxAge={maxAge}
          localBandwidth={localBandwidth}
          handleBandwidthChange={handleBandwidthChange}
          savedBandwidth={curveSettings.bandwidth}
          bandwidthDirty={bandwidthDirty}
          saveBandwidth={saveBandwidth}
          resetBandwidth={resetBandwidth}
        />

        <Section title="Future Value Impact Analysis">
          <FVImpactTable curveOpts={curveOpts} devCurves={devCurves} />
        </Section>

        <CurveTuningPanel
          curveSettings={curveSettings}
          gapMax={gapMax}   setGapMax={setLocalGapMax}
          gapExp={gapExp}   setGapExp={setLocalGapExp}
          maxCurrentAge={maxCurrentAge} setMaxCurrentAge={setLocalMaxCurrentAge}
          curveSettingsDirty={curveSettingsDirty}
          isLocalDefault={isLocalDefault}
          isSavedDefault={isSavedDefault}
          creditFactorData={creditFactorData}
          saveCurveSettings={saveCurveSettings}
          resetCurveSettings={resetCurveSettings}
          restoreDefaults={restoreDefaults}
        />

        <LiveProspectPreview prospectPreview={prospectPreview} poolLabel={poolLabel} />
      </>}
    </div>
  );
}

export default DevAnalysisView;

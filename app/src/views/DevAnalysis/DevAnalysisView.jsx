// Coordinator: owns curve sliders + the heavy player-pool/regression memos
// that the chart sub-components consume as props.
import { useState, useMemo, useRef } from "react";
import { Section, PositionFilter } from "../../components/shared.jsx";
import { getMaxWaa, getMaxWaaP, getBatR, getSpWaa, getRpWaa, getSpWaaP, getRpWaaP, passesPositionFilter, pickFielderPos, pickPitcherRole, scaleRpWaaP } from "../../utils/accessors.js";
import { G5_DEFAULTS } from "../../utils/constants.js";
import { isProspect, isInOrg } from "../../utils/prospects.js";
import { computeDevPercentile, calcFutureValue, normalizedLogit } from "../../utils/futureValue.js";

import { weightedPercentile } from "./_shared.js";
import { DevScatterChart } from "./DevScatterChart.jsx";
import { GapDistributionChart } from "./GapDistributionChart.jsx";
import { WaaPercentileChart } from "./WaaPercentileChart.jsx";
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

  // Local state for sliders (live preview), only persisted on Save
  const [localMaxCurrentAge, setLocalMaxCurrentAge] = useState(curveSettings.maxCurrentAge);
  const [localRiskMin, setLocalRiskMin] = useState(curveSettings.riskMin);
  const [localRiskMax, setLocalRiskMax] = useState(curveSettings.riskMax);
  const [localRiskExp, setLocalRiskExp] = useState(curveSettings.riskExp);
  const [localRiskMode, setLocalRiskMode] = useState(curveSettings.riskMode ?? 'logit');
  const [localLogitK, setLocalLogitK] = useState(curveSettings.logitK ?? 0.5);
  const handleRiskMin = (v) => { setLocalRiskMin(v); if (v > localRiskMax) setLocalRiskMax(v); };
  const handleRiskMax = (v) => { setLocalRiskMax(v); if (v < localRiskMin) setLocalRiskMin(v); };
  const [localBandwidth, setLocalBandwidth] = useState(curveSettings.bandwidth);
  const [computedBandwidth, setComputedBandwidth] = useState(curveSettings.bandwidth);
  const bwDebounceRef = useRef(null);
  const handleBandwidthChange = (val) => {
    setLocalBandwidth(val);
    clearTimeout(bwDebounceRef.current);
    bwDebounceRef.current = setTimeout(() => setComputedBandwidth(val), 200);
  };
  const [localGapMax, setLocalGapMax] = useState(curveSettings.gapMax);
  const [localGapExp, setLocalGapExp] = useState(curveSettings.gapExp);

  const maxCurrentAge = localMaxCurrentAge;
  const riskMin = localRiskMin;
  const riskMax = localRiskMax;
  const riskExp = localRiskExp;
  const riskMode = localRiskMode;
  const logitK = localLogitK;
  const bandwidth = computedBandwidth;
  const gapMax = localGapMax;
  const gapExp = localGapExp;

  const curveSettingsDirty = maxCurrentAge !== curveSettings.maxCurrentAge || riskMin !== curveSettings.riskMin || riskMax !== curveSettings.riskMax || riskExp !== curveSettings.riskExp || gapMax !== curveSettings.gapMax || gapExp !== curveSettings.gapExp || riskMode !== (curveSettings.riskMode ?? 'logit') || logitK !== (curveSettings.logitK ?? 0.5);
  const bandwidthDirty = localBandwidth !== curveSettings.bandwidth;
  const isLocalDefault = maxCurrentAge === G5_DEFAULTS.maxCurrentAge && riskMin === G5_DEFAULTS.riskMin && riskMax === G5_DEFAULTS.riskMax && riskExp === G5_DEFAULTS.riskExp && gapMax === G5_DEFAULTS.gapMax && gapExp === G5_DEFAULTS.gapExp && riskMode === G5_DEFAULTS.riskMode && logitK === G5_DEFAULTS.logitK;
  const isSavedDefault = curveSettings.maxCurrentAge === G5_DEFAULTS.maxCurrentAge && curveSettings.riskMin === G5_DEFAULTS.riskMin && curveSettings.riskMax === G5_DEFAULTS.riskMax && curveSettings.riskExp === G5_DEFAULTS.riskExp && curveSettings.gapMax === G5_DEFAULTS.gapMax && curveSettings.gapExp === G5_DEFAULTS.gapExp && (curveSettings.riskMode ?? 'logit') === G5_DEFAULTS.riskMode && (curveSettings.logitK ?? 0.5) === G5_DEFAULTS.logitK;

  const saveCurveSettings = () => updateCurveSettings({ maxCurrentAge, riskMin, riskMax, riskExp, gapMax, gapExp, riskMode, logitK });
  const saveBandwidth = () => updateCurveSettings({ bandwidth });
  const resetCurveSettings = () => { setLocalMaxCurrentAge(curveSettings.maxCurrentAge); setLocalRiskMin(curveSettings.riskMin); setLocalRiskMax(curveSettings.riskMax); setLocalRiskExp(curveSettings.riskExp); setLocalGapMax(curveSettings.gapMax); setLocalGapExp(curveSettings.gapExp); setLocalRiskMode(curveSettings.riskMode ?? 'logit'); setLocalLogitK(curveSettings.logitK ?? 0.5); };
  const restoreDefaults = () => { setLocalMaxCurrentAge(G5_DEFAULTS.maxCurrentAge); setLocalRiskMin(G5_DEFAULTS.riskMin); setLocalRiskMax(G5_DEFAULTS.riskMax); setLocalRiskExp(G5_DEFAULTS.riskExp); setLocalGapMax(G5_DEFAULTS.gapMax); setLocalGapExp(G5_DEFAULTS.gapExp); setLocalRiskMode(G5_DEFAULTS.riskMode); setLocalLogitK(G5_DEFAULTS.logitK); };
  const resetBandwidth = () => { setLocalBandwidth(curveSettings.bandwidth); setComputedBandwidth(curveSettings.bandwidth); };

  const players = useMemo(() => {
    const { hasBroadHitters, hasHitterAny, hasPitcherAny, hasSpecificHitterPos, onlySP, onlyRP } = filterIntent;
    const pool = [];
    if (hasHitterAny) {
      for (const h of data.hitters) {
        if (h._age == null) continue;
        if (!passesPositionFilter(h, posFilter)) continue;
        let currentWAA, potentialWAA;
        if (hasSpecificHitterPos && !hasBroadHitters) {
          const picked = pickFielderPos(h, posFilter);
          if (!picked) continue;
          currentWAA = picked.waa;
          potentialWAA = picked.waaP;
        } else {
          currentWAA = getMaxWaa(h);
          potentialWAA = getMaxWaaP(h);
        }
        pool.push({
          name: h.meta?.name ?? h.Name, age: h._age, pos: h.meta?.pos ?? h.POS, org: h.meta?.org ?? h.ORG, manual: h.meta?.source ?? h.meta?.manual ?? h.Manual,
          currentWAA, potentialWAA, type: "hitter",
        });
      }
    }
    if (hasPitcherAny) {
      for (const p of data.pitchers) {
        if (p._age == null) continue;
        if (!passesPositionFilter(p, posFilter)) continue;
        let currentWAA, potentialWAA;
        if (onlySP) {
          currentWAA = getSpWaa(p);
          if (currentWAA == null) continue;
          potentialWAA = getSpWaaP(p);
        } else if (onlyRP) {
          currentWAA = scaleRpWaaP(getRpWaa(p));
          potentialWAA = scaleRpWaaP(getRpWaaP(p));
        } else {
          const role = pickPitcherRole(p);
          currentWAA = role.waaSort;
          potentialWAA = role.waaPSort;
        }
        pool.push({
          name: p.meta?.name ?? p.Name, age: p._age, pos: p.meta?.pos ?? p.POS, org: p.meta?.org ?? p.ORG, manual: p.meta?.source ?? p.meta?.manual ?? p.Manual,
          currentWAA, potentialWAA, type: "pitcher",
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
    players.filter((p) => p.currentWAA != null).map((p) => ({ age: p.age, y: p.currentWAA, name: p.name, pos: p.pos, org: p.org, manual: p.manual })),
    [players]
  );
  const scatterPotential = useMemo(() =>
    players.filter((p) => p.potentialWAA != null).map((p) => ({ age: p.age, y: p.potentialWAA, name: p.name, pos: p.pos, org: p.org, manual: p.manual })),
    [players]
  );

  // Kernel-smoothed average trend lines (Gaussian-weighted regression).
  // Optimized: sort by age, binary-search for nearby players within 3*bandwidth window.
  const avgTrendData = useMemo(() => {
    const withCurrent = players.filter((p) => p.currentWAA != null).sort((a, b) => a.age - b.age);
    const withPotential = players.filter((p) => p.potentialWAA != null).sort((a, b) => a.age - b.age);
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
        if (w > 0.001) { sumWC += w; sumVC += w * withCurrent[i].currentWAA; }
      }
      let startP = lowerBound(withPotential, lo);
      for (let i = startP; i < withPotential.length && withPotential[i].age <= hi; i++) {
        const d = (withPotential[i].age - age) / bandwidth;
        const w = Math.exp(-0.5 * d * d);
        if (w > 0.001) { sumWP += w; sumVP += w * withPotential[i].potentialWAA; }
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
    players.filter((p) => p.currentWAA != null && p.potentialWAA != null)
      .map((p) => ({ age: p.age, gap: Math.max(0, p.potentialWAA - p.currentWAA) })),
    [players]
  );
  const gapPlayerData = useMemo(() =>
    gapMinPotNum == null ? gapPlayerDataAll :
    players.filter((p) => p.currentWAA != null && p.potentialWAA != null && p.potentialWAA >= gapMinPotNum)
      .map((p) => ({ age: p.age, gap: Math.max(0, p.potentialWAA - p.currentWAA) })),
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

  const waaPercentileData = useMemo(() => {
    const withCurrent = players.filter((p) => p.currentWAA != null);
    if (withCurrent.length < 10) return [];
    const sortedByWAA = [...withCurrent].sort((a, b) => a.currentWAA - b.currentWAA);
    const step = 0.25;
    const pts = [];
    for (let age = minAge; age <= maxAge; age += step) {
      const vals = [], ws = [];
      for (const d of sortedByWAA) {
        const dist = (d.age - age) / bandwidth;
        if (Math.abs(dist) > 3) continue;
        const w = Math.exp(-0.5 * dist * dist);
        if (w > 0.001) { vals.push(d.currentWAA); ws.push(w); }
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

  const curveData = useMemo(() => {
    const pts = [];
    for (let age = 14; age <= 40; age += 0.5) {
      if (age >= maxCurrentAge) { pts.push({ age, gapFactor: 0 }); continue; }
      const t = Math.max(0, Math.min(1, (age - 14) / (maxCurrentAge - 14)));
      const gf = Math.max(0, gapMax * (1 - Math.pow(t, gapExp)));
      pts.push({ age, gapFactor: gf });
    }
    return pts;
  }, [maxCurrentAge, gapMax, gapExp]);

  const riskCurveData = useMemo(() => {
    const pts = [];
    for (let dp = 0; dp <= 1; dp += 0.01) {
      const rf = riskMode === 'logit'
        ? riskMin + (riskMax - riskMin) * normalizedLogit(dp, logitK)
        : riskMin + (riskMax - riskMin) * Math.pow(dp, riskExp);
      pts.push({ devPct: Math.round(dp * 100), riskFactor: rf });
    }
    return pts;
  }, [riskMin, riskMax, riskExp, riskMode, logitK]);

  // Always rank against the full prospect pool (global semantics) so filtering
  // narrows visible rows but each player keeps their league-wide Rk.
  const prospectPreview = useMemo(() => {
    const curveOpts = { maxCurrentAge, riskMin, riskMax, riskExp, gapMax, gapExp, riskMode, logitK };
    const pool = [];

    const hitterPeers = data.hitters
      .filter(h => getBatR(h) != null && h._age != null)
      .map(h => ({ age: h._age, currentWAA: getBatR(h) }));
    for (const h of data.hitters) {
      if (!isProspect(h) || !isInOrg(h)) continue;
      if (h._age == null) continue;
      const cur = getMaxWaa(h);
      const pot = getMaxWaaP(h);
      const devVal = getBatR(h);
      const dp = devVal != null ? computeDevPercentile(devVal, h._age, hitterPeers, bandwidth) : 0.5;
      const fv = calcFutureValue(cur, pot, h._age, dp, curveOpts);
      pool.push({
        _player: h,
        name: h.meta?.name ?? h.Name, age: h._age, pos: h.meta?.pos ?? h.POS, org: h.meta?.org ?? h.ORG,
        devPct: dp, cur, pot, fv, type: "hitter",
      });
    }

    const pitcherPeers = [];
    for (const p of data.pitchers) {
      if (p._age == null) continue;
      const peerVal = pickPitcherRole(p).waaSort;
      if (peerVal == null) continue;
      pitcherPeers.push({ age: p._age, currentWAA: peerVal });
    }
    for (const p of data.pitchers) {
      if (!isProspect(p) || !isInOrg(p)) continue;
      if (p._age == null) continue;
      const role = pickPitcherRole(p);
      const cur = role.waaSort;
      const pot = role.waaPSort;
      const dp = cur != null ? computeDevPercentile(cur, p._age, pitcherPeers, bandwidth) : 0.5;
      const fv = calcFutureValue(cur, pot, p._age, dp, curveOpts);
      pool.push({
        _player: p,
        name: p.meta?.name ?? p.Name, age: p._age, pos: p.meta?.pos ?? p.POS, org: p.meta?.org ?? p.ORG,
        devPct: dp, cur, pot, fv, type: "pitcher",
      });
    }

    pool.sort((a, b) => (b.fv ?? 0) - (a.fv ?? 0));
    const ranked = pool.map((p, i) => ({ ...p, fvRank: i + 1 }));
    if (posFilter.length === 0) return ranked;
    return ranked.filter(p => passesPositionFilter(p._player, posFilter));
  }, [data, posFilter, maxCurrentAge, riskMin, riskMax, riskExp, gapMax, gapExp, riskMode, logitK, bandwidth]);

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

  const curveOpts = { maxCurrentAge, riskMin, riskMax, riskExp, gapMax, gapExp, riskMode, logitK };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {filterRow}

      {players.length === 0 && <div style={{ padding: 40, textAlign: "center", color: "#475569", fontSize: 14 }}>No player data available for the selected type.</div>}

      {players.length > 0 && <>
        <Section title="Age vs WAA Distribution">
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

        <WaaPercentileChart
          waaPercentileData={waaPercentileData}
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
          <FVImpactTable curveOpts={curveOpts} waaPercentileData={waaPercentileData} />
        </Section>

        <CurveTuningPanel
          curveSettings={curveSettings}
          maxCurrentAge={maxCurrentAge} setLocalMaxCurrentAge={setLocalMaxCurrentAge}
          riskMin={riskMin} riskMax={riskMax} handleRiskMin={handleRiskMin} handleRiskMax={handleRiskMax}
          riskExp={riskExp} setLocalRiskExp={setLocalRiskExp}
          riskMode={riskMode} setLocalRiskMode={setLocalRiskMode}
          logitK={logitK} setLocalLogitK={setLocalLogitK}
          gapMax={gapMax} setLocalGapMax={setLocalGapMax}
          gapExp={gapExp} setLocalGapExp={setLocalGapExp}
          curveSettingsDirty={curveSettingsDirty}
          isLocalDefault={isLocalDefault}
          isSavedDefault={isSavedDefault}
          curveData={curveData}
          riskCurveData={riskCurveData}
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

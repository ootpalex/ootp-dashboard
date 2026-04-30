import { memo, useMemo } from "react";
import PercentileBar from "./PercentileBar.jsx";
import {
  leaguePercentile,
  getHitterValueComponents,
  getPitcherValueComponents,
} from "./_shared.js";
import { PillBtn, TabGroup } from "../../components/shared.jsx";

// Map a percentile pool entry to {current, potential} percentile pair.
// `inverted` flips both. `hidePotential` skips the potential dot regardless
// of pool/value availability (used when the player has already matured).
function computePctPair(comp, pool, opts = {}) {
  const { inverted = false, hidePotential = false } = opts;
  const cur = leaguePercentile(comp?.current, pool?.current, { invert: inverted });
  const pot = !hidePotential && pool?.potential
    ? leaguePercentile(comp?.potential, pool?.potential, { invert: inverted })
    : null;
  return { current: cur, potential: pot };
}

function HitterBars({ player, peerPools }) {
  const c = useMemo(() => getHitterValueComponents(player), [player]);
  const matured = !!player._matured;
  const opts = { hidePotential: matured };
  const overall = computePctPair(c.overall, peerPools.overall, opts);
  const batting = computePctPair(c.batting, peerPools.batting, opts);
  const fielding = computePctPair(c.fielding, peerPools.fielding, opts);
  const baserunning = computePctPair(c.baserunning, peerPools.baserunning, opts);

  const fmtWaa = (v) => v == null ? "—" : (v >= 0 ? "+" : "") + v.toFixed(1);

  return (
    <>
      <PercentileBar
        label="Overall Value"
        current={overall.current}
        potential={overall.potential}
        currentValue={c.overall.current}
        potentialValue={matured ? null : c.overall.potential}
        valueFmt={fmtWaa}
      />
      <PercentileBar
        label="Batting Value"
        current={batting.current}
        potential={batting.potential}
        currentValue={c.batting.current}
        potentialValue={matured ? null : c.batting.potential}
        valueFmt={fmtWaa}
      />
      <PercentileBar
        label="Fielding Value"
        current={fielding.current}
        currentValue={c.fielding.current}
        valueFmt={fmtWaa}
      />
      <PercentileBar
        label="Baserunning"
        current={baserunning.current}
        potential={baserunning.potential}
        currentValue={c.baserunning.current}
        potentialValue={matured ? null : c.baserunning.potential}
        valueFmt={fmtWaa}
      />
    </>
  );
}

function PitcherBars({ player, peerPools }) {
  const c = useMemo(() => getPitcherValueComponents(player, peerPools.role), [player, peerPools.role]);
  const matured = !!player._matured;
  const overall = computePctPair(c.overall, peerPools.overall, { hidePotential: matured });
  // Counts (so/ubb/hr) are role-normalized so percentile-by-count == percentile-by-rate.
  const k = computePctPair(c.k, peerPools.k, { hidePotential: matured });
  const bb = computePctPair(c.bb, peerPools.bb, { inverted: true, hidePotential: matured });
  const hr = computePctPair(c.hr, peerPools.hr, { inverted: true, hidePotential: matured });
  const babip = computePctPair(c.babip, peerPools.babip, { inverted: true, hidePotential: matured });

  // Display: convert counts to per-PA rate using role IP × 4.18 PA/IP for context.
  const ipsr = peerPools.role === "sp" ? 185.47 : 69.55;
  const bf = ipsr * 4.18;
  const fmtPct = (count) => count == null ? "—" : `${(100 * count / bf).toFixed(1)}%`;
  const fmtBabip = (v) => v == null ? "—" : v.toFixed(3).replace(/^0/, "");
  const fmtWaa = (v) => v == null ? "—" : (v >= 0 ? "+" : "") + v.toFixed(1);

  return (
    <>
      <PercentileBar
        label="Overall WAA"
        current={overall.current}
        potential={overall.potential}
        currentValue={c.overall.current}
        potentialValue={matured ? null : c.overall.potential}
        valueFmt={fmtWaa}
      />
      <PercentileBar
        label="Strikeout %"
        current={k.current}
        potential={k.potential}
        currentValue={c.k.current}
        potentialValue={matured ? null : c.k.potential}
        valueFmt={fmtPct}
      />
      <PercentileBar
        label="Walk %"
        current={bb.current}
        potential={bb.potential}
        currentValue={c.bb.current}
        potentialValue={matured ? null : c.bb.potential}
        inverted
        valueFmt={fmtPct}
      />
      <PercentileBar
        label="HR %"
        current={hr.current}
        potential={hr.potential}
        currentValue={c.hr.current}
        potentialValue={matured ? null : c.hr.potential}
        inverted
        valueFmt={fmtPct}
      />
      <PercentileBar
        label="BABIP-against"
        current={babip.current}
        currentValue={c.babip.current}
        inverted
        valueFmt={fmtBabip}
      />
    </>
  );
}

function PercentileHeader({ player, isHitter, isSPEligible, peerPools, role, onRoleChange }) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <div style={{ fontSize: 9, color: "#475569", letterSpacing: 1.2 }}>
          PERCENTILE RANK · vs MLB {isHitter ? "HITTERS" : (role === "sp" ? "STARTERS" : "RELIEVERS")}
        </div>
        {!isHitter && isSPEligible && (
          <TabGroup label="Pitcher role" style={{ display: "flex", gap: 4 }}>
            <PillBtn active={role === "sp"} onClick={() => onRoleChange("sp")} ariaLabel="Show as starter"
                     style={{ padding: "2px 10px", fontSize: 10 }}>
              SP
            </PillBtn>
            <PillBtn active={role === "rp"} onClick={() => onRoleChange("rp")} ariaLabel="Show as reliever"
                     style={{ padding: "2px 10px", fontSize: 10 }}>
              RP
            </PillBtn>
          </TabGroup>
        )}
      </div>

      <div>
        {isHitter
          ? <HitterBars player={player} peerPools={peerPools} />
          : <PitcherBars player={player} peerPools={peerPools} />}
      </div>
    </div>
  );
}

export default memo(PercentileHeader);

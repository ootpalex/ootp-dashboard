import { memo } from "react";
import { gradeToColor, posColor, waaStyle } from "../../theme.js";
import { num, fmt } from "../../utils/helpers.js";
import { isEligible, getPosRating, getPosPotential } from "../../utils/accessors.js";

const tS = { background: "rgba(15,23,42,0.6)", borderRadius: 6, border: "1px solid #1e293b", padding: "8px 10px", display: "flex", flexDirection: "column", gap: 3 };
const tL = { fontSize: 9, color: "#475569", letterSpacing: 1, textTransform: "uppercase" };
const sectionLabel = { fontSize: 9, color: "#475569", marginBottom: 6, letterSpacing: 1 };
const scoutColor = (v) => { const n = num(v); return n != null ? gradeToColor(n) : "#475569"; };

const FIELD_POSITIONS = ["C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"];
const INF_POS = ["1B", "2B", "3B", "SS"];
const OF_POS = ["LF", "CF", "RF"];

// Stat-key → friendly label maps per position group. Run-value components
// (frmaa, pmaa, eaa, dpaa, armaa, armR) format with 1 decimal + sign;
// rate/count components (sba, sb, cs, rtoPct) format inline.
const COMPONENT_DEFS = {
  C:  [
    { key: "frmaa",  label: "Framing",       fmt: fmtRunVal },
    { key: "armR",   label: "Catcher Arm",   fmt: fmtRunVal },
    { key: "rtoPct", label: "Runner TO%",    fmt: (v) => v == null ? "—" : `${(v * 100).toFixed(1)}%` },
    { key: "sba",    label: "SB Attempts",   fmt: (v) => v == null ? "—" : fmt(v, 0) },
    { key: "sb",     label: "SB Allowed",    fmt: (v) => v == null ? "—" : fmt(v, 0) },
    { key: "cs",     label: "CS",            fmt: (v) => v == null ? "—" : fmt(v, 0) },
  ],
  "1B": [
    { key: "pmaa", label: "Range",  fmt: fmtRunVal },
    { key: "eaa",  label: "Errors", fmt: fmtRunVal },
  ],
  "2B": [
    { key: "pmaa", label: "Range",        fmt: fmtRunVal },
    { key: "eaa",  label: "Errors",       fmt: fmtRunVal },
    { key: "dpaa", label: "Double Plays", fmt: fmtRunVal },
  ],
  "3B": [
    { key: "pmaa", label: "Range",  fmt: fmtRunVal },
    { key: "eaa",  label: "Errors", fmt: fmtRunVal },
  ],
  SS: [
    { key: "pmaa", label: "Range",        fmt: fmtRunVal },
    { key: "eaa",  label: "Errors",       fmt: fmtRunVal },
    { key: "dpaa", label: "Double Plays", fmt: fmtRunVal },
  ],
  LF: [
    { key: "pmaa",  label: "Range",  fmt: fmtRunVal },
    { key: "eaa",   label: "Errors", fmt: fmtRunVal },
    { key: "armaa", label: "OF Arm", fmt: fmtRunVal },
  ],
  CF: [
    { key: "pmaa",  label: "Range",  fmt: fmtRunVal },
    { key: "eaa",   label: "Errors", fmt: fmtRunVal },
    { key: "armaa", label: "OF Arm", fmt: fmtRunVal },
  ],
  RF: [
    { key: "pmaa",  label: "Range",  fmt: fmtRunVal },
    { key: "eaa",   label: "Errors", fmt: fmtRunVal },
    { key: "armaa", label: "OF Arm", fmt: fmtRunVal },
  ],
};

function fmtRunVal(v) {
  if (v == null || isNaN(v)) return "—";
  return (v >= 0 ? "+" : "") + v.toFixed(1);
}

function fmtWaa(v) {
  if (v == null || isNaN(v)) return "—";
  return (v >= 0 ? "+" : "") + v.toFixed(2);
}

function PotChip({ value, valueFmt }) {
  return (
    <span style={{ whiteSpace: "nowrap" }}>
      <span style={{ color: "#4ade80aa", fontSize: 10, fontWeight: 600, letterSpacing: 0.5 }}>POT </span>
      <span style={{ color: "#4ade80", fontWeight: 700, fontSize: 14 }}>{valueFmt(value)}</span>
    </span>
  );
}

function PositionCard({ player, pos, isBest, matured }) {
  const posKey = pos.toLowerCase();
  const posDict = player.positions?.[posKey] ?? {};
  const stats = posDict.stats ?? {};
  const waaWtd = num(posDict.waa?.wtd);
  const waaVR  = num(posDict.waa?.vR);
  const waaVL  = num(posDict.waa?.vL);
  const waaPot = num(player.prospect?.waa?.[posKey]);
  const ratingCur = num(getPosRating(player, pos));
  const ratingPot = num(getPosPotential(player, pos));
  const runsP = num(stats.runsP);
  const components = COMPONENT_DEFS[pos] ?? [];
  const showWaaPot = !matured && waaPot != null && waaPot !== waaWtd;
  const showRatingPot = !matured && ratingPot != null && ratingPot !== ratingCur;

  return (
    <div style={{
      background: isBest ? "rgba(34,197,94,0.06)" : "rgba(15,23,42,0.4)",
      border: `1px solid ${isBest ? "rgba(74,222,128,0.35)" : "#1e293b"}`,
      borderRadius: 8,
      padding: "10px 12px",
      display: "flex",
      flexDirection: "column",
      gap: 6,
    }}>
      {/* Header: position + WAA */}
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span style={{ fontSize: 16, fontWeight: 800, color: posColor(pos), letterSpacing: 1 }}>
            {pos}{isBest ? " ★" : ""}
          </span>
          <span style={{ fontSize: 9, color: "#475569", letterSpacing: 1, textTransform: "uppercase" }}>
            WAA wtd
          </span>
          <span style={{ fontSize: 15, fontWeight: 700, ...waaStyle(waaWtd) }}>{fmtWaa(waaWtd)}</span>
        </div>
        {showWaaPot && <PotChip value={waaPot} valueFmt={fmtWaa} />}
      </div>

      {/* Splits row */}
      {(waaVL != null || waaVR != null) && (
        <div style={{ display: "flex", gap: 14, fontSize: 12, color: "#cbd5e1", flexWrap: "wrap" }}>
          {waaVL != null && (
            <span><span style={{ color: "#64748b", fontSize: 10 }}>vL </span><span style={{ ...waaStyle(waaVL), fontWeight: 700 }}>{fmtWaa(waaVL)}</span></span>
          )}
          {waaVR != null && (
            <span><span style={{ color: "#64748b", fontSize: 10 }}>vR </span><span style={{ ...waaStyle(waaVR), fontWeight: 700 }}>{fmtWaa(waaVR)}</span></span>
          )}
        </div>
      )}

      {/* Component breakdown */}
      {components.length > 0 && (
        <div style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "4px 14px",
          fontSize: 12,
          color: "#cbd5e1",
          paddingTop: 6,
          borderTop: "1px solid #1e293b",
        }}>
          {components.map((c) => {
            const v = stats[c.key];
            if (v == null) return null;
            const display = c.fmt(num(v));
            const isRunVal = c.fmt === fmtRunVal;
            const numericVal = num(v);
            const colorStyle = isRunVal ? waaStyle(numericVal) : { color: "#cbd5e1" };
            return (
              <span key={c.key}>
                <span style={{ color: "#64748b", fontSize: 10, marginRight: 3 }}>{c.label}</span>
                <span style={{ ...colorStyle, fontWeight: 700 }}>{display}</span>
              </span>
            );
          })}
          {runsP != null && (
            <span style={{ marginLeft: "auto" }}>
              <span style={{ color: "#64748b", fontSize: 10, marginRight: 3 }}>RunsP</span>
              <span style={{ ...waaStyle(runsP), fontWeight: 700 }}>{fmtRunVal(runsP)}</span>
            </span>
          )}
        </div>
      )}

      {/* Position rating */}
      {(ratingCur != null || ratingPot != null) && (
        <div style={{
          display: "flex",
          alignItems: "baseline",
          gap: 8,
          paddingTop: 6,
          borderTop: "1px solid #1e293b",
          fontSize: 12,
        }}>
          <span style={{ color: "#64748b", fontSize: 10, letterSpacing: 1, textTransform: "uppercase" }}>Pos Rating</span>
          <span style={{ fontWeight: 700, color: scoutColor(ratingCur) }}>{ratingCur ?? "—"}</span>
          {showRatingPot && (
            <span style={{ color: "#475569", fontSize: 11 }}>→ <span style={{ color: scoutColor(ratingPot), fontWeight: 700 }}>{ratingPot}</span></span>
          )}
        </div>
      )}
    </div>
  );
}

function RatingTile({ label, val }) {
  const n = num(val);
  return (
    <div style={tS}>
      <span style={tL}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 700, color: scoutColor(n) }}>
        {n ?? "—"}
      </span>
    </div>
  );
}

function FieldingTab({ player, eligiblePositions, bestRunsPPos }) {
  // Order positions: best position first, then defensive spectrum.
  const eligibleField = FIELD_POSITIONS.filter((pos) => isEligible(player, pos));
  const orderedPositions = eligibleField.slice().sort((a, b) => {
    if (a === bestRunsPPos) return -1;
    if (b === bestRunsPPos) return 1;
    return FIELD_POSITIONS.indexOf(a) - FIELD_POSITIONS.indexOf(b);
  });

  const fr = player.fieldingRatings ?? {};
  const isCatcher = isEligible(player, "C");
  const isInf = INF_POS.some((pos) => isEligible(player, pos));
  const isOf = OF_POS.some((pos) => isEligible(player, pos));
  const matured = !!player._matured;

  return (
    <>
      {/* Per-position cards */}
      {orderedPositions.length > 0 && (
        <div style={{ padding: "12px 18px" }}>
          <div style={sectionLabel}>DEFENSIVE BREAKDOWN</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {orderedPositions.map((pos) => (
              <PositionCard
                key={pos}
                player={player}
                pos={pos}
                isBest={pos === bestRunsPPos}
                matured={matured}
              />
            ))}
          </div>
        </div>
      )}

      {/* Catcher OOTP underlying ratings */}
      {isCatcher && (
        <div style={{ padding: "12px 18px" }}>
          <div style={sectionLabel}>CATCHER RATINGS (OOTP 20-80)</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
            <RatingTile label="C Ability" val={fr.cAbi} />
            <RatingTile label="Framing"   val={fr.cFrm} />
            <RatingTile label="Arm"       val={fr.cArm} />
          </div>
        </div>
      )}

      {/* Infield OOTP underlying ratings */}
      {isInf && (
        <div style={{ padding: "12px 18px" }}>
          <div style={sectionLabel}>INFIELD RATINGS (OOTP 20-80)</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
            <RatingTile label="IF Range"   val={fr.ifRng} />
            <RatingTile label="IF Errors"  val={fr.ifErr} />
            <RatingTile label="IF Arm"     val={fr.ifArm} />
            <RatingTile label="Turn DP"    val={fr.tdp} />
          </div>
        </div>
      )}

      {/* Outfield OOTP underlying ratings */}
      {isOf && (
        <div style={{ padding: "12px 18px" }}>
          <div style={sectionLabel}>OUTFIELD RATINGS (OOTP 20-80)</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
            <RatingTile label="OF Range"  val={fr.ofRng} />
            <RatingTile label="OF Errors" val={fr.ofErr} />
            <RatingTile label="OF Arm"    val={fr.ofArm} />
          </div>
        </div>
      )}

      {orderedPositions.length === 0 && !isCatcher && !isInf && !isOf && (
        <div style={{ fontSize: 11, color: "#64748b", padding: "12px 18px" }}>
          No fielding eligibility data available.
        </div>
      )}
    </>
  );
}

export default memo(FieldingTab);

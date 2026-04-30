import { memo } from "react";
import { gradeToColor } from "../../theme.js";

// Map a 0-100 percentile to a 20-80 OOTP scouting grade so the dot's color
// matches the rest of the dashboard. 50th = green, 0/100 = red/blue extremes.
// `inverted` upstream of this is already applied by leaguePercentile —
// we always color "high percentile = good" here. The `inverted` prop on
// the bar only drives the ↓ arrow label.
function pctToGrade(pct) {
  return 20 + Math.max(0, Math.min(100, pct)) * 0.6;
}

function fmtVal(v, decimals = 1) {
  if (v == null || isNaN(v)) return "—";
  if (Math.abs(v) >= 100) return v.toFixed(0);
  return v.toFixed(decimals);
}

function PercentileBar({
  label,
  current,                // 0-100 percentile (or null)
  potential = null,       // 0-100 percentile (or null)
  currentValue = null,    // raw value to display (e.g., +12.3 BatR or 24% K)
  potentialValue = null,
  inverted = false,
  valueFmt = (v) => fmtVal(v, 1),
}) {
  const TRACK_COLOR = "#1e293b";
  const TRACK_HEIGHT = 6;

  const dotColor = (pct) => pct == null ? "#475569" : gradeToColor(pctToGrade(pct));

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "112px 1fr 96px",
      alignItems: "center",
      gap: 10,
      padding: "5px 0",
    }}>
      {/* Label */}
      <div style={{
        fontSize: 11,
        color: "#cbd5e1",
        fontWeight: 600,
        letterSpacing: 0.3,
      }}>
        {label}{inverted ? <span style={{ color: "#64748b", marginLeft: 4, fontSize: 9 }}>↓</span> : null}
      </div>

      {/* Track + dots */}
      <div style={{ position: "relative", height: 16 }}>
        {/* Track */}
        <div style={{
          position: "absolute",
          top: (16 - TRACK_HEIGHT) / 2,
          left: 0, right: 0,
          height: TRACK_HEIGHT,
          background: TRACK_COLOR,
          borderRadius: TRACK_HEIGHT / 2,
        }} />
        {/* 50th-percentile mid-line */}
        <div style={{
          position: "absolute",
          top: 1,
          left: "50%",
          width: 1,
          height: 14,
          background: "#334155",
        }} />

        {/* Potential dot — drawn first so current dot sits on top when overlapping */}
        {potential != null && (
          <div title={`Potential: ${potential}th${potentialValue != null ? ` (${valueFmt(potentialValue)})` : ""}`}
               style={{
                 position: "absolute",
                 top: 1,
                 left: `calc(${Math.max(0, Math.min(100, potential))}% - 7px)`,
                 width: 14, height: 14,
                 borderRadius: "50%",
                 background: "transparent",
                 border: `2px dashed ${dotColor(potential)}`,
                 boxSizing: "border-box",
               }} />
        )}

        {/* Current dot */}
        {current != null && (
          <div title={`Current: ${current}th${currentValue != null ? ` (${valueFmt(currentValue)})` : ""}`}
               style={{
                 position: "absolute",
                 top: 2,
                 left: `calc(${Math.max(0, Math.min(100, current))}% - 6px)`,
                 width: 12, height: 12,
                 borderRadius: "50%",
                 background: dotColor(current),
                 boxShadow: `0 0 0 2px rgba(15,23,42,0.95)`,
                 boxSizing: "border-box",
               }} />
        )}
      </div>

      {/* Value labels */}
      <div style={{
        fontSize: 11,
        color: "#94a3b8",
        textAlign: "right",
        fontVariantNumeric: "tabular-nums",
      }}>
        {current != null ? (
          <>
            <span style={{ color: dotColor(current), fontWeight: 700 }}>{current}</span>
            <span style={{ color: "#475569", margin: "0 4px" }}>·</span>
            <span>{currentValue != null ? valueFmt(currentValue) : "—"}</span>
            {potential != null && (
              <div style={{ fontSize: 10, color: "#64748b", marginTop: 1 }}>
                pot <span style={{ color: dotColor(potential), fontWeight: 700 }}>{potential}</span>
                {potentialValue != null && (
                  <span style={{ color: "#64748b", marginLeft: 3 }}>· {valueFmt(potentialValue)}</span>
                )}
              </div>
            )}
          </>
        ) : (
          <span style={{ color: "#475569" }}>—</span>
        )}
      </div>
    </div>
  );
}

export default memo(PercentileBar);

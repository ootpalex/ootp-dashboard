import { memo } from "react";
import { TOKENS as T } from "../../theme.js";
import { pctColor } from "./_shared.js";

// Savant-style percentile pill (B.9): the current value is a filled pill whose
// width = percentile and whose fill follows the 20–80 ramp (pctToGrade), with
// the percentile printed in ink inside it when the pill is wide enough; the
// potential value is a 1px dashed outline pill to its own percentile, drawn
// underneath. `inverted` upstream is already applied by leaguePercentile — we
// always colour "high percentile = good" here; the prop only drives the ↓ tag.

function fmtVal(v, decimals = 1) {
  if (v == null || isNaN(v)) return "—";
  if (Math.abs(v) >= 100) return v.toFixed(0);
  return v.toFixed(decimals);
}

const ROW_H = 18;
const PILL_H = 14;
const PILL_R = T.radiusPill;

function PercentileBar({
  label,
  current,                // 0-100 percentile (or null)
  potential = null,       // 0-100 percentile (or null)
  currentValue = null,    // raw value to display (e.g., +12.3 BatR or 24% K)
  potentialValue = null,
  inverted = false,
  valueFmt = (v) => fmtVal(v, 1),
}) {
  const clamp = (p) => Math.max(0, Math.min(100, p));
  const showInk = current != null && current >= 14;

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "112px 1fr 96px",
      alignItems: "center",
      gap: 10,
      padding: "4px 0",
    }}>
      {/* Label */}
      <div style={{ fontFamily: T.fonts.narrow, fontSize: 12.5, color: T.text, fontWeight: 600, whiteSpace: "nowrap" }}>
        {label}{inverted ? <span style={{ color: T.text3, marginLeft: 4, fontSize: 11 }}>↓</span> : null}
      </div>

      {/* Track + pills */}
      <div style={{ position: "relative", height: ROW_H }}>
        {/* Track */}
        <div style={{
          position: "absolute",
          top: (ROW_H - PILL_H) / 2,
          left: 0, right: 0,
          height: PILL_H,
          background: T.panel3,
          borderRadius: PILL_R,
        }} />
        {/* 50th-percentile tick */}
        <div style={{ position: "absolute", top: 0, left: "50%", width: 1, height: ROW_H, background: T.line2 }} />

        {/* Potential — dashed outline pill underneath */}
        {potential != null && (
          <div title={`Potential: ${potential}th${potentialValue != null ? ` (${valueFmt(potentialValue)})` : ""}`}
               style={{
                 position: "absolute",
                 top: (ROW_H - PILL_H) / 2,
                 left: 0,
                 width: `${clamp(potential)}%`,
                 minWidth: 6,
                 height: PILL_H,
                 borderRadius: PILL_R,
                 border: `1px dashed ${pctColor(potential)}`,
                 boxSizing: "border-box",
                 zIndex: 0,
               }} />
        )}

        {/* Current — filled pill, ink percentile inside when wide enough */}
        {current != null && (
          <div title={`Current: ${current}th${currentValue != null ? ` (${valueFmt(currentValue)})` : ""}`}
               style={{
                 position: "absolute",
                 top: (ROW_H - PILL_H) / 2,
                 left: 0,
                 width: `${clamp(current)}%`,
                 minWidth: 6,
                 height: PILL_H,
                 borderRadius: PILL_R,
                 background: pctColor(current),
                 boxSizing: "border-box",
                 zIndex: 1,
                 display: "flex",
                 alignItems: "center",
                 justifyContent: "flex-end",
                 padding: "0 6px",
                 fontFamily: T.fonts.narrow,
                 fontSize: 11,
                 fontWeight: 700,
                 lineHeight: 1,
                 color: T.bg,
                 overflow: "hidden",
               }}>
            {showInk ? current : ""}
          </div>
        )}
      </div>

      {/* Value labels */}
      <div style={{ fontSize: 11.5, color: T.text2, textAlign: "right", fontVariantNumeric: "tabular-nums", lineHeight: 1.2 }}>
        {current != null ? (
          <>
            <span style={{ color: pctColor(current), fontWeight: 700 }}>{current}</span>
            <span style={{ color: T.text3, margin: "0 4px" }}>·</span>
            <span>{currentValue != null ? valueFmt(currentValue) : "—"}</span>
            {potential != null && (
              <div style={{ fontSize: 10.5, color: T.text3, marginTop: 1 }}>
                pot <span style={{ color: pctColor(potential), fontWeight: 700 }}>{potential}</span>
                {potentialValue != null && (
                  <span style={{ color: T.text3, marginLeft: 3 }}>· {valueFmt(potentialValue)}</span>
                )}
              </div>
            )}
          </>
        ) : (
          <span style={{ color: T.textDisabled }}>—</span>
        )}
      </div>
    </div>
  );
}

export default memo(PercentileBar);

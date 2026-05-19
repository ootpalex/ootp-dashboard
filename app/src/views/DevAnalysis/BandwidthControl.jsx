// Shared bandwidth slider+save controls used by Gap & WAR percentile charts.
import { S } from "../../theme.js";
import { NumInput } from "../../components/shared.jsx";
import { bwToSlider, sliderToBw } from "./_shared.js";

export function BandwidthControl({
  localBandwidth, handleBandwidthChange, savedBandwidth,
  bandwidthDirty, saveBandwidth, resetBandwidth,
  accentColor = "#3b82f6", useNumInput = false,
}) {
  const inputProps = {
    min: 0.1, max: 5.0, step: 0.1, value: localBandwidth,
    style: { width: 52, background: "#0f172a", border: "1px solid #334155", borderRadius: 4, color: accentColor, fontSize: 12, fontWeight: 700, fontFamily: "inherit", textAlign: "center", padding: "2px 4px" },
  };
  return (
    <>
      <label style={{ fontSize: 12, color: "#94a3b8", fontWeight: 600 }}>Bandwidth (years):</label>
      <input type="range" min={0} max={100} step={1} value={bwToSlider(localBandwidth)}
        onChange={(e) => handleBandwidthChange(sliderToBw(parseInt(e.target.value)))}
        style={{ width: 200, accentColor }} />
      {useNumInput
        ? <NumInput {...inputProps} onChange={handleBandwidthChange} />
        : <input type="number" {...inputProps} onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) handleBandwidthChange(Math.max(0.1, Math.min(5.0, v))); }} />
      }
      {bandwidthDirty && <>
        <button onClick={saveBandwidth} style={{ ...S.pillBtn, borderColor: "#22c55e", color: "#86efac", background: "rgba(34,197,94,0.15)", padding: "4px 12px", fontSize: 11 }}>Save</button>
        <button onClick={resetBandwidth} style={{ ...S.pillBtn, borderColor: "#334155", color: "#64748b", padding: "4px 12px", fontSize: 11 }}>Reset</button>
      </>}
      {!bandwidthDirty && <span style={{ fontSize: 10, color: "#475569" }}>saved: {savedBandwidth.toFixed(1)}</span>}
    </>
  );
}

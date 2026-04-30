// Gap distribution percentile band chart.
import { memo } from "react";
import { ComposedChart, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Line, Legend, ReferenceLine, Area } from "recharts";
import { Section } from "../../components/shared.jsx";
import { BandwidthControl } from "./BandwidthControl.jsx";

export const GapDistributionChart = memo(function GapDistributionChart({
  gapRegressionTrimmed, gapPlayerCount, gapMinPot, setGapMinPot, gapShowingFiltered,
  minAge, gapChartMaxAge, gapChartMaxY,
  localBandwidth, handleBandwidthChange, savedBandwidth,
  bandwidthDirty, saveBandwidth, resetBandwidth,
}) {
  return (
    <Section title="Gap Distribution by Age">
      <div style={{ fontSize: 11, color: "#475569", marginBottom: 8 }}>
        Kernel-smoothed gap (Potential - Current, floored at 0) percentiles. Lower gap = more developed. Purple line = median. Inner band = 25th–75th. Outer band = 10th–90th.
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        <label style={{ fontSize: 12, color: "#94a3b8", fontWeight: 600 }}>Min Potential WAA:</label>
        <input type="number" step={0.5} value={gapMinPot} placeholder="All" onChange={(e) => setGapMinPot(e.target.value)}
          style={{ width: 64, background: "#0f172a", border: "1px solid #334155", borderRadius: 4, color: "#8b5cf6", fontSize: 12, fontWeight: 700, fontFamily: "inherit", textAlign: "center", padding: "2px 4px" }} />
        {gapShowingFiltered && <span style={{ fontSize: 10, color: "#8b5cf6" }}>showing {gapPlayerCount} players</span>}
        <span style={{ color: "#334155" }}>|</span>
        <BandwidthControl
          localBandwidth={localBandwidth}
          handleBandwidthChange={handleBandwidthChange}
          savedBandwidth={savedBandwidth}
          bandwidthDirty={bandwidthDirty}
          saveBandwidth={saveBandwidth}
          resetBandwidth={resetBandwidth}
          accentColor="#8b5cf6"
        />
      </div>
      <ResponsiveContainer width="100%" height={400}>
        <ComposedChart data={gapRegressionTrimmed} margin={{ top: 10, right: 20, bottom: 30, left: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis dataKey="age" type="number" domain={[minAge, gapChartMaxAge]} ticks={Array.from({ length: Math.ceil((gapChartMaxAge - minAge) / 2) + 1 }, (_, i) => minAge + i * 2).filter(t => t <= gapChartMaxAge)} tick={{ fill: "#64748b", fontSize: 11 }} label={{ value: "Age", position: "insideBottom", offset: -5, fill: "#64748b", fontSize: 11 }} />
          <YAxis domain={[0, gapChartMaxY]} ticks={Array.from({ length: Math.floor(gapChartMaxY / 2) + 1 }, (_, i) => i * 2).filter(t => t <= gapChartMaxY)} tick={{ fill: "#64748b", fontSize: 11 }} label={{ value: "Gap (WAA)", angle: -90, position: "insideLeft", fill: "#64748b", fontSize: 11 }} />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload || !payload.length) return null;
              const d = payload[0]?.payload;
              if (!d) return null;
              return (
                <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 6, padding: "8px 12px", fontSize: 11 }}>
                  <div style={{ color: "#e2e8f0", fontWeight: 700, marginBottom: 4 }}>Age {d.age}</div>
                  <div style={{ color: "#22c55e" }}>90th (most developed): {d.outerRange[0].toFixed(2)}</div>
                  <div style={{ color: "#94a3b8" }}>75th: {d.iqrRange[0].toFixed(2)}</div>
                  <div style={{ color: "#8b5cf6", fontWeight: 600 }}>Median: {d.median.toFixed(2)}</div>
                  <div style={{ color: "#94a3b8" }}>25th: {d.iqrRange[1].toFixed(2)}</div>
                  <div style={{ color: "#f87171" }}>10th (least developed): {d.outerRange[1].toFixed(2)}</div>
                </div>
              );
            }}
          />
          <Area type="monotone" dataKey="outerRange" fill="#8b5cf6" fillOpacity={0.08} stroke="none" name="10th–90th" isAnimationActive={false} />
          <Area type="monotone" dataKey="iqrRange" fill="#8b5cf6" fillOpacity={0.15} stroke="none" name="25th–75th" isAnimationActive={false} />
          <Line type="monotone" dataKey="median" stroke="#8b5cf6" strokeWidth={3} dot={false} name="Median Gap" isAnimationActive={false} />
          <ReferenceLine y={0} stroke="#334155" strokeWidth={1} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </Section>
  );
});

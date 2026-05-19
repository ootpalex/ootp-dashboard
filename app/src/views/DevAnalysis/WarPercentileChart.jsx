// Current-WAR percentile bands by age.
import { memo } from "react";
import { ComposedChart, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Line, Legend, ReferenceLine, Area } from "recharts";
import { Section } from "../../components/shared.jsx";
import { BandwidthControl } from "./BandwidthControl.jsx";

export const WarPercentileChart = memo(function WarPercentileChart({
  warPercentileData, minAge, maxAge,
  localBandwidth, handleBandwidthChange, savedBandwidth,
  bandwidthDirty, saveBandwidth, resetBandwidth,
}) {
  return (
    <Section title="DevPercentile Distribution (Current WAR by Age)">
      <div style={{ fontSize: 11, color: "#475569", marginBottom: 8 }}>
        Current WAR percentile bands by age. Shows what WAR a player at each dev percentile has at each age. Inner band = 25th-75th, outer = 10th-90th. Dashed lines = 95th and 99th.
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
        <BandwidthControl
          localBandwidth={localBandwidth}
          handleBandwidthChange={handleBandwidthChange}
          savedBandwidth={savedBandwidth}
          bandwidthDirty={bandwidthDirty}
          saveBandwidth={saveBandwidth}
          resetBandwidth={resetBandwidth}
          accentColor="#3b82f6"
          useNumInput
        />
      </div>
      {warPercentileData.length > 0 ? (
        <ResponsiveContainer width="100%" height={400}>
          <ComposedChart data={warPercentileData} margin={{ top: 10, right: 20, bottom: 30, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis dataKey="age" type="number" domain={[minAge, maxAge]} ticks={Array.from({ length: Math.ceil((maxAge - minAge) / 2) + 1 }, (_, i) => minAge + i * 2).filter(t => t <= maxAge)} tick={{ fill: "#64748b", fontSize: 11 }} label={{ value: "Age", position: "insideBottom", offset: -5, fill: "#64748b", fontSize: 11 }} />
            <YAxis tick={{ fill: "#64748b", fontSize: 11 }} label={{ value: "Current WAR", angle: -90, position: "insideLeft", fill: "#64748b", fontSize: 11 }} />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload || !payload.length) return null;
                const d = payload[0]?.payload;
                if (!d) return null;
                return (
                  <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 6, padding: "8px 12px", fontSize: 11 }}>
                    <div style={{ color: "#e2e8f0", fontWeight: 700, marginBottom: 4 }}>Age {d.age} <span style={{ color: "#64748b", fontWeight: 400 }}>({d.nEff} players)</span></div>
                    <div style={{ color: "#fbbf24" }}>99th: {d.p99.toFixed(2)} <span style={{ color: "#64748b" }}>({d.nAbove99} at/above)</span></div>
                    <div style={{ color: "#f59e0b" }}>95th: {d.p95.toFixed(2)} <span style={{ color: "#64748b" }}>({d.nAbove95} at/above)</span></div>
                    <div style={{ color: "#22c55e" }}>90th: {d.p90.toFixed(2)} <span style={{ color: "#64748b" }}>({d.nAbove90} at/above)</span></div>
                    <div style={{ color: "#86efac" }}>75th: {d.p75.toFixed(2)} <span style={{ color: "#64748b" }}>({d.nAbove75} at/above)</span></div>
                    <div style={{ color: "#3b82f6", fontWeight: 600 }}>50th: {d.median.toFixed(2)} <span style={{ color: "#64748b", fontWeight: 400 }}>({d.nAbove50} at/above)</span></div>
                    <div style={{ color: "#94a3b8" }}>25th: {d.p25.toFixed(2)} <span style={{ color: "#64748b" }}>({d.nAbove25} at/above)</span></div>
                    <div style={{ color: "#f87171" }}>10th: {d.p10.toFixed(2)} <span style={{ color: "#64748b" }}>({d.nAbove10} at/above)</span></div>
                  </div>
                );
              }}
            />
            <Area type="monotone" dataKey="outerRange" fill="#3b82f6" fillOpacity={0.08} stroke="none" name="10th-90th" isAnimationActive={false} />
            <Area type="monotone" dataKey="iqrRange" fill="#3b82f6" fillOpacity={0.15} stroke="none" name="25th-75th" isAnimationActive={false} />
            <Line type="monotone" dataKey="p99" stroke="#fbbf24" strokeWidth={1} strokeDasharray="4 3" dot={false} name="99th" isAnimationActive={false} />
            <Line type="monotone" dataKey="p95" stroke="#f59e0b" strokeWidth={1} strokeDasharray="4 3" dot={false} name="95th" isAnimationActive={false} />
            <Line type="monotone" dataKey="p90" stroke="#22c55e" strokeWidth={1} dot={false} name="90th" isAnimationActive={false} />
            <Line type="monotone" dataKey="p75" stroke="#86efac" strokeWidth={1} dot={false} name="75th" isAnimationActive={false} />
            <Line type="monotone" dataKey="median" stroke="#3b82f6" strokeWidth={3} dot={false} name="Median" isAnimationActive={false} />
            <Line type="monotone" dataKey="p25" stroke="#94a3b8" strokeWidth={1} dot={false} name="25th" isAnimationActive={false} />
            <Line type="monotone" dataKey="p10" stroke="#f87171" strokeWidth={1} dot={false} name="10th" isAnimationActive={false} />
            <ReferenceLine y={0} stroke="#334155" strokeWidth={1} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
          </ComposedChart>
        </ResponsiveContainer>
      ) : (
        <div style={{ color: "#475569", fontSize: 12, textAlign: "center", padding: 40 }}>Not enough data for distribution chart.</div>
      )}
    </Section>
  );
});

// Current-WAR percentile bands by age.
import { memo } from "react";
import { ComposedChart, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Line, Legend, ReferenceLine, Area } from "recharts";
import { TOKENS as T } from "../../theme.js";
import { Section } from "../../components/shared.jsx";
import { BandwidthControl } from "./BandwidthControl.jsx";

const C = T.CHART;

export const WarPercentileChart = memo(function WarPercentileChart({
  warPercentileData, minAge, maxAge,
  localBandwidth, handleBandwidthChange, savedBandwidth,
  bandwidthDirty, saveBandwidth, resetBandwidth,
}) {
  return (
    <Section title="DevPercentile Distribution (Current WAR by Age)"
      toolbar={
        <BandwidthControl
          localBandwidth={localBandwidth}
          handleBandwidthChange={handleBandwidthChange}
          savedBandwidth={savedBandwidth}
          bandwidthDirty={bandwidthDirty}
          saveBandwidth={saveBandwidth}
          resetBandwidth={resetBandwidth}
          accentColor={T.accent}
          useNumInput
        />
      }
      footer="Current WAR percentile bands by age. Shows what WAR a player at each dev percentile has at each age. Inner band = 25th–75th, outer = 10th–90th. Dashed lines = 95th and 99th.">
      {warPercentileData.length > 0 ? (
        <ResponsiveContainer width="100%" height={400}>
          <ComposedChart data={warPercentileData} margin={{ top: 10, right: 20, bottom: 30, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={C.grid} />
            <XAxis dataKey="age" type="number" domain={[minAge, maxAge]} ticks={Array.from({ length: Math.ceil((maxAge - minAge) / 2) + 1 }, (_, i) => minAge + i * 2).filter(t => t <= maxAge)} tick={{ fill: C.axis, fontSize: 11 }} axisLine={{ stroke: C.grid }} tickLine={false} label={{ value: "Age", position: "insideBottom", offset: -5, fill: C.axis, fontSize: 11 }} />
            <YAxis tick={{ fill: C.axis, fontSize: 11 }} axisLine={{ stroke: C.grid }} tickLine={false} label={{ value: "Current WAR", angle: -90, position: "insideLeft", fill: C.axis, fontSize: 11 }} />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload || !payload.length) return null;
                const d = payload[0]?.payload;
                if (!d) return null;
                return (
                  <div style={{ background: C.tooltipBg, border: `1px solid ${C.tooltipBorder}`, borderRadius: T.radius, padding: "8px 12px", fontSize: 11, color: C.tooltipText }}>
                    <div style={{ color: T.text, fontWeight: 700, marginBottom: 4 }}>Age {d.age} <span style={{ color: T.text3, fontWeight: 400 }}>({d.nEff} players)</span></div>
                    <div style={{ color: C.series4 }}>99th: {d.p99.toFixed(2)} <span style={{ color: T.text3 }}>({d.nAbove99} at/above)</span></div>
                    <div style={{ color: C.series6 }}>95th: {d.p95.toFixed(2)} <span style={{ color: T.text3 }}>({d.nAbove95} at/above)</span></div>
                    <div style={{ color: C.series2 }}>90th: {d.p90.toFixed(2)} <span style={{ color: T.text3 }}>({d.nAbove90} at/above)</span></div>
                    <div style={{ color: T.goodSoft }}>75th: {d.p75.toFixed(2)} <span style={{ color: T.text3 }}>({d.nAbove75} at/above)</span></div>
                    <div style={{ color: C.series1, fontWeight: 600 }}>50th: {d.median.toFixed(2)} <span style={{ color: T.text3, fontWeight: 400 }}>({d.nAbove50} at/above)</span></div>
                    <div style={{ color: T.text2 }}>25th: {d.p25.toFixed(2)} <span style={{ color: T.text3 }}>({d.nAbove25} at/above)</span></div>
                    <div style={{ color: C.series3 }}>10th: {d.p10.toFixed(2)} <span style={{ color: T.text3 }}>({d.nAbove10} at/above)</span></div>
                  </div>
                );
              }}
            />
            <Area type="monotone" dataKey="outerRange" fill={C.bands.series1.outer} fillOpacity={1} stroke="none" name="10th-90th" isAnimationActive={false} />
            <Area type="monotone" dataKey="iqrRange" fill={C.bands.series1.inner} fillOpacity={1} stroke="none" name="25th-75th" isAnimationActive={false} />
            <Line type="monotone" dataKey="p99" stroke={C.series4} strokeWidth={1} strokeDasharray="4 3" dot={false} name="99th" isAnimationActive={false} />
            <Line type="monotone" dataKey="p95" stroke={C.series6} strokeWidth={1} strokeDasharray="4 3" dot={false} name="95th" isAnimationActive={false} />
            <Line type="monotone" dataKey="p90" stroke={C.series2} strokeWidth={1} dot={false} name="90th" isAnimationActive={false} />
            <Line type="monotone" dataKey="p75" stroke={T.goodSoft} strokeWidth={1} dot={false} name="75th" isAnimationActive={false} />
            <Line type="monotone" dataKey="median" stroke={C.series1} strokeWidth={3} dot={false} name="Median" isAnimationActive={false} />
            <Line type="monotone" dataKey="p25" stroke={T.text2} strokeWidth={1} dot={false} name="25th" isAnimationActive={false} />
            <Line type="monotone" dataKey="p10" stroke={C.series3} strokeWidth={1} dot={false} name="10th" isAnimationActive={false} />
            <ReferenceLine y={0} stroke={C.refLine} strokeWidth={1} />
            <Legend wrapperStyle={{ fontSize: 11, color: T.text2 }} />
          </ComposedChart>
        </ResponsiveContainer>
      ) : (
        <div style={{ color: T.text3, fontSize: 12, textAlign: "center", padding: 40 }}>Not enough data for distribution chart.</div>
      )}
    </Section>
  );
});

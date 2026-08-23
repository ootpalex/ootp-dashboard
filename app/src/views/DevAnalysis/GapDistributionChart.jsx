// Gap distribution percentile band chart.
import { memo } from "react";
import { ComposedChart, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Line, Legend, ReferenceLine, Area } from "recharts";
import { TOKENS as T } from "../../theme.js";
import { Section } from "../../components/shared.jsx";
import { BandwidthControl } from "./BandwidthControl.jsx";

const C = T.CHART;

export const GapDistributionChart = memo(function GapDistributionChart({
  gapRegressionTrimmed, gapPlayerCount, gapMinPot, setGapMinPot, gapShowingFiltered,
  minAge, gapChartMaxAge, gapChartMaxY,
  localBandwidth, handleBandwidthChange, savedBandwidth,
  bandwidthDirty, saveBandwidth, resetBandwidth,
}) {
  return (
    <Section title="Gap Distribution by Age"
      toolbar={<>
        <label style={{ fontSize: 12, color: T.text2, fontWeight: 600 }}>Min Potential WAR:</label>
        <input type="number" step={0.5} value={gapMinPot} placeholder="All" onChange={(e) => setGapMinPot(e.target.value)}
          style={{ width: 64, background: T.bg, border: `1px solid ${T.line2}`, borderRadius: T.radius, color: C.series5, fontSize: 12, fontWeight: 700, fontFamily: "inherit", textAlign: "center", padding: "2px 4px" }} />
        {gapShowingFiltered && <span style={{ fontSize: 11, color: C.series5 }}>showing {gapPlayerCount} players</span>}
        <span style={{ color: T.line2 }}>|</span>
        <BandwidthControl
          localBandwidth={localBandwidth}
          handleBandwidthChange={handleBandwidthChange}
          savedBandwidth={savedBandwidth}
          bandwidthDirty={bandwidthDirty}
          saveBandwidth={saveBandwidth}
          resetBandwidth={resetBandwidth}
          accentColor={T.accent}
        />
      </>}
      footer="Kernel-smoothed gap (Potential − Current, floored at 0) percentiles. Lower gap = more developed. Violet line = median. Inner band = 25th–75th. Outer band = 10th–90th.">
      <ResponsiveContainer width="100%" height={400}>
        <ComposedChart data={gapRegressionTrimmed} margin={{ top: 10, right: 20, bottom: 30, left: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={C.grid} />
          <XAxis dataKey="age" type="number" domain={[minAge, gapChartMaxAge]} ticks={Array.from({ length: Math.ceil((gapChartMaxAge - minAge) / 2) + 1 }, (_, i) => minAge + i * 2).filter(t => t <= gapChartMaxAge)} tick={{ fill: C.axis, fontSize: 11 }} axisLine={{ stroke: C.grid }} tickLine={false} label={{ value: "Age", position: "insideBottom", offset: -5, fill: C.axis, fontSize: 11 }} />
          <YAxis domain={[0, gapChartMaxY]} ticks={Array.from({ length: Math.floor(gapChartMaxY / 2) + 1 }, (_, i) => i * 2).filter(t => t <= gapChartMaxY)} tick={{ fill: C.axis, fontSize: 11 }} axisLine={{ stroke: C.grid }} tickLine={false} label={{ value: "Gap (WAR)", angle: -90, position: "insideLeft", fill: C.axis, fontSize: 11 }} />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload || !payload.length) return null;
              const d = payload[0]?.payload;
              if (!d) return null;
              return (
                <div style={{ background: C.tooltipBg, border: `1px solid ${C.tooltipBorder}`, borderRadius: T.radius, padding: "8px 12px", fontSize: 11, color: C.tooltipText }}>
                  <div style={{ color: T.text, fontWeight: 700, marginBottom: 4 }}>Age {d.age}</div>
                  <div style={{ color: T.good }}>90th (most developed): {d.outerRange[0].toFixed(2)}</div>
                  <div style={{ color: T.text2 }}>75th: {d.iqrRange[0].toFixed(2)}</div>
                  <div style={{ color: C.series5, fontWeight: 600 }}>Median: {d.median.toFixed(2)}</div>
                  <div style={{ color: T.text2 }}>25th: {d.iqrRange[1].toFixed(2)}</div>
                  <div style={{ color: T.bad }}>10th (least developed): {d.outerRange[1].toFixed(2)}</div>
                </div>
              );
            }}
          />
          <Area type="monotone" dataKey="outerRange" fill={C.bands.series5.outer} fillOpacity={1} stroke="none" name="10th–90th" isAnimationActive={false} />
          <Area type="monotone" dataKey="iqrRange" fill={C.bands.series5.inner} fillOpacity={1} stroke="none" name="25th–75th" isAnimationActive={false} />
          <Line type="monotone" dataKey="median" stroke={C.series5} strokeWidth={3} dot={false} name="Median Gap" isAnimationActive={false} />
          <ReferenceLine y={0} stroke={C.refLine} strokeWidth={1} />
          <Legend wrapperStyle={{ fontSize: 11, color: T.text2 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </Section>
  );
});

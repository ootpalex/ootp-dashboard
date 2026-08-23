import { memo } from "react";
import { ComposedChart, CartesianGrid, XAxis, YAxis, Tooltip, Legend, ReferenceLine, Area, Line, ResponsiveContainer } from "recharts";
import { TOKENS as T } from "../../theme.js";
import { fmt } from "../../utils/helpers.js";
import { SECTION_LABEL } from "./_shared.js";

const C = T.CHART;

function FVProjectionChart({ player, fvChartData, showFVChart, potentialWAR, curveSettings }) {
  if (!showFVChart || !fvChartData || fvChartData.length <= 1) return null;

  const maturityAge  = curveSettings?.maxCurrentAge ?? 27;
  const playerDevPct = player._devPct ?? 0.5;
  const allFVVals    = fvChartData.flatMap(d => [d.ceiling, d.center, d.floor]).filter(v => v != null);
  const fvMin        = Math.floor(Math.min(...allFVVals, 0) - 0.5);
  const fvOffset     = -fvMin;
  const bandData     = fvChartData.map(d => ({
    age:          d.age,
    band_base:    Math.max(0, d.floor + fvOffset),
    band_height:  Math.max(0, d.ceiling - d.floor),
    center_plot:  d.center + fvOffset,
    _floor:       d.floor,
    _center:      d.center,
    _ceiling:     d.ceiling,
  }));
  const projLabel = `Projected (${Math.round(playerDevPct * 100)}th Dev%)`;
  const FVTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    const d = payload[0]?.payload;
    if (!d) return null;
    return (
      <div style={{ background: C.tooltipBg, border: `1px solid ${C.tooltipBorder}`, borderRadius: T.radius, padding: "6px 10px", fontSize: 11.5, color: C.tooltipText, fontVariantNumeric: "tabular-nums" }}>
        <div style={{ color: T.text2, marginBottom: 4, fontWeight: 700, fontFamily: T.fonts.narrow }}>Age {label}</div>
        <div style={{ color: C.series2 }}>Ceiling: {fmt(d._ceiling, 2)} WAR</div>
        <div style={{ color: C.series1 }}>{projLabel}: {fmt(d._center, 2)} WAR</div>
        <div style={{ color: T.text3 }}>Floor: {fmt(d._floor, 2)} WAR</div>
      </div>
    );
  };

  return (
    <div style={{ padding: "12px 16px", borderBottom: `1px solid ${T.line2}` }}>
      <div style={{ ...SECTION_LABEL, marginBottom: 4 }}>
        Development & decline projection{potentialWAR == null ? " (potential unknown — no development gap)" : ""}
      </div>
      <ResponsiveContainer width="100%" height={180}>
        <ComposedChart data={bandData} margin={{ top: 4, right: 12, bottom: 4, left: 40 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={C.grid} />
          <XAxis dataKey="age" stroke={C.axis} tick={{ fill: C.axis, fontSize: 11 }} label={{ value: "Age", position: "insideBottomRight", offset: -4, fill: C.axis, fontSize: 11 }} />
          <YAxis domain={[0, "auto"]} stroke={C.axis} tick={{ fill: C.axis, fontSize: 11 }}
                 tickFormatter={(v) => fmt(v + fvMin, 1)}
                 label={{ value: "WAR", angle: -90, position: "insideLeft", fill: C.axis, fontSize: 11, dx: -8 }} />
          <Tooltip content={<FVTooltip />} />
          <Area type="monotone" dataKey="band_base"   stackId="cb" stroke="none" fill="none" legendType="none" tooltipType="none" />
          <Area type="monotone" dataKey="band_height"  stackId="cb" stroke="none" fill={C.bands.series2.outer} fillOpacity={1} legendType="none" tooltipType="none" />
          <ReferenceLine y={fvOffset} stroke={C.refLine} strokeDasharray="2 2" />
          <ReferenceLine x={Math.floor(player._age)} stroke={C.series1} strokeDasharray="3 3"
                         label={{ value: "Now", fill: C.series1, fontSize: 11, position: "insideTopLeft" }} />
          <ReferenceLine x={maturityAge} stroke={C.refLine} strokeDasharray="4 2"
                         label={{ value: "Maturity", fill: T.text2, fontSize: 11, position: "insideTopRight" }} />
          <Line type="monotone" dataKey="center_plot" stroke={C.series1} strokeWidth={2} dot={false} name={projLabel} connectNulls />
          <Legend wrapperStyle={{ fontSize: 11, color: T.text2, fontFamily: T.fonts.narrow }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export default memo(FVProjectionChart);

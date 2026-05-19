import { memo } from "react";
import { ComposedChart, CartesianGrid, XAxis, YAxis, Tooltip, Legend, ReferenceLine, Area, Line, ResponsiveContainer } from "recharts";
import { fmt } from "../../utils/helpers.js";

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
      <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 6, padding: "6px 10px", fontSize: 10, fontFamily: "inherit" }}>
        <div style={{ color: "#94a3b8", marginBottom: 4, fontWeight: 700 }}>Age {label}</div>
        <div style={{ color: "#4ade80" }}>Ceiling: {fmt(d._ceiling, 2)} WAR</div>
        <div style={{ color: "#38bdf8" }}>{projLabel}: {fmt(d._center, 2)} WAR</div>
        <div style={{ color: "#64748b" }}>Floor: {fmt(d._floor, 2)} WAR</div>
      </div>
    );
  };

  return (
    <div style={{ padding: "12px 18px", borderBottom: "1px solid #1e293b" }}>
      <div style={{ fontSize: 9, color: "#475569", marginBottom: 4, letterSpacing: 1 }}>
        DEVELOPMENT & DECLINE PROJECTION{potentialWAR == null ? " (potential unknown — no development gap)" : ""}
      </div>
      <ResponsiveContainer width="100%" height={180}>
        <ComposedChart data={bandData} margin={{ top: 4, right: 12, bottom: 4, left: 40 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis dataKey="age" stroke="#334155" tick={{ fill: "#64748b", fontSize: 9 }} label={{ value: "Age", position: "insideBottomRight", offset: -4, fill: "#475569", fontSize: 9 }} />
          <YAxis domain={[0, "auto"]} stroke="#334155" tick={{ fill: "#64748b", fontSize: 9 }}
                 tickFormatter={(v) => fmt(v + fvMin, 1)}
                 label={{ value: "WAR", angle: -90, position: "insideLeft", fill: "#475569", fontSize: 9, dx: -8 }} />
          <Tooltip content={<FVTooltip />} />
          <ReferenceLine y={fvOffset} stroke="#475569" strokeDasharray="2 2" />
          <ReferenceLine x={Math.floor(player._age)} stroke="#38bdf8" strokeDasharray="3 3"
                         label={{ value: "Now", fill: "#38bdf8", fontSize: 10, position: "insideTopLeft" }} />
          <ReferenceLine x={maturityAge} stroke="#64748b" strokeDasharray="4 2"
                         label={{ value: "Maturity", fill: "#94a3b8", fontSize: 10, position: "insideTopRight" }} />
          <Area type="monotone" dataKey="band_base"   stackId="cb" stroke="none" fill="none" legendType="none" tooltipType="none" />
          <Area type="monotone" dataKey="band_height"  stackId="cb" stroke="none" fill="#4ade80" fillOpacity={0.12} legendType="none" tooltipType="none" />
          <Line type="monotone" dataKey="center_plot" stroke="#38bdf8" strokeWidth={2} dot={false} name={projLabel} connectNulls />
          <Legend wrapperStyle={{ fontSize: 9, color: "#94a3b8" }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export default memo(FVProjectionChart);

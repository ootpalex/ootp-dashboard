// Memo'd Age vs WAR scatter — only re-renders when scatter/trend props change.
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { niceScale } from "./_shared.js";

export const DevScatterChart = memo(function DevScatterChart({ scatterCurrent, scatterPotential, avgTrendData, minAge, maxAge, playerCount }) {
  const [crosshair, setCrosshair] = useState(null);
  const [hovered, setHovered] = useState(null);
  const [trendLocked, setTrendLocked] = useState(false);
  const [trendPoint, setTrendPoint] = useState(null);
  const containerRef = useRef(null);
  const [width, setWidth] = useState(800);
  const height = 400;
  const margin = { top: 10, right: 20, bottom: 30, left: 50 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) setWidth(entry.contentRect.width);
    });
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const xScale = useMemo(() => niceScale(minAge, maxAge, 10), [minAge, maxAge]);
  const yScale = useMemo(() => {
    let dMin = 0, dMax = 0;
    for (const p of scatterCurrent) { if (p.y < dMin) dMin = p.y; if (p.y > dMax) dMax = p.y; }
    for (const p of scatterPotential) { if (p.y < dMin) dMin = p.y; if (p.y > dMax) dMax = p.y; }
    return niceScale(dMin, dMax, 8);
  }, [scatterCurrent, scatterPotential]);

  const xFn = useCallback((v) => margin.left + ((v - xScale.min) / (xScale.max - xScale.min)) * plotW, [xScale, plotW]);
  const yFn = useCallback((v) => margin.top + ((yScale.max - v) / (yScale.max - yScale.min)) * plotH, [yScale, plotH]);
  const xInv = useCallback((px) => xScale.min + ((px - margin.left) / plotW) * (xScale.max - xScale.min), [xScale, plotW]);
  const yInv = useCallback((py) => yScale.max - ((py - margin.top) / plotH) * (yScale.max - yScale.min), [yScale, plotH]);

  const findNearestTrend = useCallback((px) => {
    if (!avgTrendData.length) return null;
    let best = null, bestDx = Infinity;
    for (const d of avgTrendData) {
      const dx = Math.abs(xFn(d.age) - px);
      if (dx < bestDx) { bestDx = dx; best = d; }
    }
    return best;
  }, [avgTrendData, xFn]);

  const isNearTrend = useCallback((px, py) => {
    const d = findNearestTrend(px);
    if (!d) return false;
    const xDist = Math.abs(xFn(d.age) - px);
    if (xDist > 15) return false;
    if (d.avgCurrent != null && Math.abs(yFn(d.avgCurrent) - py) < 8) return true;
    if (d.avgPotential != null && Math.abs(yFn(d.avgPotential) - py) < 8) return true;
    return false;
  }, [findNearestTrend, xFn, yFn]);

  const handleMouseMove = useCallback((e) => {
    const svg = containerRef.current?.querySelector("svg");
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    if (px < margin.left || px > margin.left + plotW || py < margin.top || py > margin.top + plotH) {
      if (!trendLocked) { setCrosshair(null); setHovered(null); }
      return;
    }
    if (trendLocked) {
      const d = findNearestTrend(px);
      if (d) setTrendPoint(d);
      return;
    }
    const age = xInv(px);
    const war = yInv(py);
    setCrosshair({ px, py, age, war });
    let bestDist = 25;
    let bestDot = null;
    const check = (data, color) => {
      for (const p of data) {
        const dx = xFn(p.age) - px;
        const dy = yFn(p.y) - py;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestDist) { bestDist = d2; bestDot = { name: p.name, pos: p.pos, org: p.org, manual: p.manual, color }; }
      }
    };
    check(scatterCurrent, "#3b82f6");
    check(scatterPotential, "#22c55e");
    setHovered(bestDot);
  }, [xInv, yInv, xFn, yFn, plotW, plotH, scatterCurrent, scatterPotential, trendLocked, findNearestTrend]);

  const handleClick = useCallback((e) => {
    const svg = containerRef.current?.querySelector("svg");
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    if (trendLocked) {
      setTrendLocked(false);
      setTrendPoint(null);
      return;
    }
    if (isNearTrend(px, py)) {
      const d = findNearestTrend(px);
      if (d) {
        setTrendLocked(true);
        setTrendPoint(d);
        setCrosshair(null);
        setHovered(null);
      }
    }
  }, [trendLocked, isNearTrend, findNearestTrend]);

  const handleMouseLeave = useCallback(() => {
    if (!trendLocked) { setCrosshair(null); setHovered(null); }
  }, [trendLocked]);

  const crosshairStats = useMemo(() => {
    if (!crosshair || trendLocked) return null;
    const { age, war } = crosshair;
    const totalCur = scatterCurrent.length;
    const totalPot = scatterPotential.length;
    if (totalCur + totalPot === 0) return null;
    let youngerCur = 0, aboveCur = 0, bothCur = 0;
    for (const p of scatterCurrent) {
      const young = p.age <= age; const above = p.y >= war;
      if (young) youngerCur++; if (above) aboveCur++; if (young && above) bothCur++;
    }
    let youngerPot = 0, abovePot = 0, bothPot = 0;
    for (const p of scatterPotential) {
      const young = p.age <= age; const above = p.y >= war;
      if (young) youngerPot++; if (above) abovePot++; if (young && above) bothPot++;
    }
    return {
      age: Math.round(age * 10) / 10, war: Math.round(war * 100) / 100,
      cur: { younger: youngerCur, above: aboveCur, both: bothCur, total: totalCur },
      pot: { younger: youngerPot, above: abovePot, both: bothPot, total: totalPot },
    };
  }, [crosshair, scatterCurrent, scatterPotential, trendLocked]);

  const pct = (n, total) => total > 0 ? `${(n / total * 100).toFixed(1)}%` : "—";

  return (
    <>
      <div style={{ fontSize: 11, color: "#475569", marginBottom: 8 }}>
        {playerCount} players. Blue = Current WAR, Green = Potential WAR. Hover for crosshair stats. Click a trend line to lock and slide along it.
      </div>
      <div ref={containerRef} style={{ position: "relative" }}>
        <svg width={width} height={height} onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave} onClick={handleClick}
          style={{ display: "block", userSelect: "none", cursor: trendLocked ? "pointer" : "crosshair" }}>
          {xScale.ticks.map((t) => <line key={`gx${t}`} x1={xFn(t)} x2={xFn(t)} y1={margin.top} y2={margin.top + plotH} stroke="#1e293b" strokeDasharray="3 3" />)}
          {yScale.ticks.map((t) => <line key={`gy${t}`} x1={margin.left} x2={margin.left + plotW} y1={yFn(t)} y2={yFn(t)} stroke="#1e293b" strokeDasharray="3 3" />)}
          {xScale.ticks.map((t) => <text key={`xt${t}`} x={xFn(t)} y={margin.top + plotH + 16} fill="#64748b" fontSize={11} textAnchor="middle">{t}</text>)}
          {yScale.ticks.map((t) => <text key={`yt${t}`} x={margin.left - 8} y={yFn(t) + 4} fill="#64748b" fontSize={11} textAnchor="end">{t}</text>)}
          <text x={margin.left + plotW / 2} y={height - 2} fill="#64748b" fontSize={11} textAnchor="middle">Age</text>
          <text x={14} y={margin.top + plotH / 2} fill="#64748b" fontSize={11} textAnchor="middle" transform={`rotate(-90,14,${margin.top + plotH / 2})`}>WAR</text>
          {scatterCurrent.map((p, i) => <circle key={`c${i}`} cx={xFn(p.age)} cy={yFn(p.y)} r={1.5} fill="#3b82f6" opacity={0.2} />)}
          {scatterPotential.map((p, i) => <circle key={`p${i}`} cx={xFn(p.age)} cy={yFn(p.y)} r={1.5} fill="#22c55e" opacity={0.2} />)}
          {avgTrendData.length > 1 && (() => {
            const curPts = avgTrendData.filter(d => d.avgCurrent != null);
            const potPts = avgTrendData.filter(d => d.avgPotential != null);
            const toPath = (pts, key) => pts.map((d, i) => `${i === 0 ? "M" : "L"}${xFn(d.age)},${yFn(d[key])}`).join(" ");
            return <>
              {curPts.length > 1 && <path d={toPath(curPts, "avgCurrent")} fill="none" stroke="#3b82f6" strokeWidth={2.5} opacity={0.8} />}
              {potPts.length > 1 && <path d={toPath(potPts, "avgPotential")} fill="none" stroke="#22c55e" strokeWidth={2.5} opacity={0.8} />}
            </>;
          })()}
          {crosshair && <>
            <line x1={crosshair.px} x2={crosshair.px} y1={margin.top} y2={margin.top + plotH} stroke="#94a3b8" opacity={0.5} strokeWidth={1} />
            <line x1={margin.left} x2={margin.left + plotW} y1={crosshair.py} y2={crosshair.py} stroke="#94a3b8" opacity={0.5} strokeWidth={1} />
          </>}
          {trendLocked && trendPoint && <>
            <line x1={xFn(trendPoint.age)} x2={xFn(trendPoint.age)} y1={margin.top} y2={margin.top + plotH} stroke="#f59e0b" opacity={0.6} strokeWidth={1} strokeDasharray="4 3" />
            {trendPoint.avgCurrent != null && <circle cx={xFn(trendPoint.age)} cy={yFn(trendPoint.avgCurrent)} r={5} fill="#3b82f6" stroke="#e2e8f0" strokeWidth={1.5} />}
            {trendPoint.avgPotential != null && <circle cx={xFn(trendPoint.age)} cy={yFn(trendPoint.avgPotential)} r={5} fill="#22c55e" stroke="#e2e8f0" strokeWidth={1.5} />}
          </>}
          <rect x={margin.left} y={margin.top} width={plotW} height={plotH} fill="transparent" />
        </svg>
        <div style={{ display: "flex", gap: 16, justifyContent: "center", fontSize: 11, color: "#94a3b8", marginTop: 4 }}>
          <span><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: "#3b82f6", marginRight: 4, verticalAlign: "middle" }} />Current WAR</span>
          <span><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: "#22c55e", marginRight: 4, verticalAlign: "middle" }} />Potential WAR</span>
          <span><span style={{ display: "inline-block", width: 16, height: 3, background: "#3b82f6", marginRight: 4, verticalAlign: "middle", borderRadius: 1 }} />Avg Current</span>
          <span><span style={{ display: "inline-block", width: 16, height: 3, background: "#22c55e", marginRight: 4, verticalAlign: "middle", borderRadius: 1 }} />Avg Potential</span>
        </div>
        {crosshairStats && (
          <div style={{
            position: "absolute", top: 8, right: 28,
            background: "rgba(15,23,42,0.92)", border: "1px solid #334155", borderRadius: 6,
            padding: "8px 12px", fontSize: 11, fontFamily: "inherit", pointerEvents: "none",
            minWidth: 220, zIndex: 10,
          }}>
            <div style={{ display: "flex", gap: 16, marginBottom: 6, fontWeight: 700, color: "#e2e8f0" }}>
              <span>Age ≤ {crosshairStats.age.toFixed(1)}</span>
              <span>WAR ≥ {crosshairStats.war.toFixed(2)}</span>
            </div>
            {hovered && (
              <div style={{ marginBottom: 6, color: hovered.color, fontWeight: 600 }}>
                {hovered.name} ({hovered.pos}) <span style={{ color: "#64748b", fontWeight: 400 }}>{hovered.org !== "-" ? hovered.org : (() => { const m = (hovered.manual || "").trim(); if (m === "IAFA") return "IAFA"; const dm = m.match(/(\d{4})/); if (dm || m.toLowerCase().includes("draft")) return `Draft ${dm ? dm[1] : ""}`.trim(); return "FA"; })()}</span>
              </div>
            )}
            <div style={{ marginBottom: 6, color: "#94a3b8" }}>
              Age ≤: {crosshairStats.cur.younger} <span style={{ color: "#64748b" }}>({pct(crosshairStats.cur.younger, crosshairStats.cur.total)})</span>
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #1e293b" }}>
                  <th style={{ textAlign: "left", padding: "2px 4px", color: "#64748b", fontWeight: 600 }}></th>
                  <th style={{ textAlign: "right", padding: "2px 4px", color: "#64748b", fontWeight: 600 }}>WAR ≥</th>
                  <th style={{ textAlign: "right", padding: "2px 4px", color: "#64748b", fontWeight: 600 }}>Both</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={{ padding: "2px 4px", color: "#3b82f6", fontWeight: 600 }}>Current</td>
                  <td style={{ textAlign: "right", padding: "2px 4px", color: "#94a3b8" }}>{crosshairStats.cur.above} <span style={{ color: "#64748b" }}>({pct(crosshairStats.cur.above, crosshairStats.cur.total)})</span></td>
                  <td style={{ textAlign: "right", padding: "2px 4px", color: "#e2e8f0", fontWeight: 700 }}>{crosshairStats.cur.both} <span style={{ color: "#64748b" }}>({pct(crosshairStats.cur.both, crosshairStats.cur.total)})</span></td>
                </tr>
                <tr>
                  <td style={{ padding: "2px 4px", color: "#22c55e", fontWeight: 600 }}>Potential</td>
                  <td style={{ textAlign: "right", padding: "2px 4px", color: "#94a3b8" }}>{crosshairStats.pot.above} <span style={{ color: "#64748b" }}>({pct(crosshairStats.pot.above, crosshairStats.pot.total)})</span></td>
                  <td style={{ textAlign: "right", padding: "2px 4px", color: "#e2e8f0", fontWeight: 700 }}>{crosshairStats.pot.both} <span style={{ color: "#64748b" }}>({pct(crosshairStats.pot.both, crosshairStats.pot.total)})</span></td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
        {trendLocked && trendPoint && (
          <div style={{
            position: "absolute", top: 8, right: 28,
            background: "rgba(15,23,42,0.92)", border: "1px solid #f59e0b44", borderRadius: 6,
            padding: "8px 12px", fontSize: 11, fontFamily: "inherit", pointerEvents: "none",
            minWidth: 180, zIndex: 10,
          }}>
            <div style={{ marginBottom: 6 }}>
              <span style={{ fontWeight: 700, color: "#f59e0b" }}>Age {trendPoint.age}</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "#3b82f6", fontWeight: 600 }}>Avg Current</span>
                <span style={{ color: "#e2e8f0", fontWeight: 700 }}>{trendPoint.avgCurrent != null ? trendPoint.avgCurrent.toFixed(2) : "—"}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "#22c55e", fontWeight: 600 }}>Avg Potential</span>
                <span style={{ color: "#e2e8f0", fontWeight: 700 }}>{trendPoint.avgPotential != null ? trendPoint.avgPotential.toFixed(2) : "—"}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid #1e293b", paddingTop: 4, marginTop: 2 }}>
                <span style={{ color: "#f59e0b", fontWeight: 600 }}>Gap</span>
                <span style={{ color: "#e2e8f0", fontWeight: 700 }}>{trendPoint.gap != null ? trendPoint.gap.toFixed(2) : "—"}</span>
              </div>
            </div>
            <div style={{ marginTop: 6, color: "#475569", fontSize: 10 }}>Click anywhere to exit trend view</div>
          </div>
        )}
      </div>
    </>
  );
});

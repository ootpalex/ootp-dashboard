// ============================================================================
// THEME — Color utilities, tier colors, and shared style constants
// ============================================================================

export const FV_TIER_COLORS = {
  "80": "#38bdf8", "70": "#22d3ee", "65": "#2dd4bf", "60": "#34d399",
  "55": "#4ade80", "50": "#a3e635", "45+": "#facc15", "45": "#fbbf24",
  "40+": "#fb923c", "40": "#f97316", "35+": "#f87171",
};

export const zToColor = (z) => {
  if (z == null || isNaN(z)) return { bg: "rgba(100,116,139,0.15)", value: "#94a3b8", label: "#64748b", border: "#334155" };
  const c = Math.max(-2.5, Math.min(2.5, z));
  if (c >= 0) {
    const t = Math.min(c / 2.0, 1);
    return { bg: `rgba(${Math.round(16+t*4)},${Math.round(120+t*65)},${Math.round(60+t*20)},${0.2+t*0.55})`, value: "#e2e8f0", label: t > 0.5 ? "#e2e8f0" : "#94a3b8", border: `rgba(${Math.round(30+t*20)},${Math.round(160+t*60)},${Math.round(80+t*30)},0.6)` };
  } else {
    const t = Math.min(Math.abs(c) / 2.0, 1);
    return { bg: `rgba(${Math.round(160+t*60)},${Math.round(30+t*10)},${Math.round(30+t*10)},${0.2+t*0.55})`, value: "#e2e8f0", label: t > 0.5 ? "#e2e8f0" : "#94a3b8", border: `rgba(${Math.round(180+t*50)},${Math.round(50+t*20)},${Math.round(50+t*20)},0.6)` };
  }
};

export const posColor = (pos) => ({ C:"#fbbf24","1B":"#a78bfa","2B":"#60a5fa","3B":"#f87171",SS:"#34d399",LF:"#fb923c",CF:"#2dd4bf",RF:"#e879f9",DH:"#94a3b8",SP:"#38bdf8",RP:"#f472b6" })[pos] || "#94a3b8";

export const levelColor = (lev) => ({ MLB:"#fbbf24",AAA:"#a78bfa",AA:"#60a5fa","A+":"#34d399",A:"#94a3b8",R:"#fb923c",INT:"#f472b6" })[lev] || "#475569";

export const proneColor = (p) => ({ "Iron Man":"#22c55e",Durable:"#4ade80",Normal:"#94a3b8",Fragile:"#f87171",Wrecked:"#ef4444" })[p] || "#94a3b8";

// OOTP 20-80 scale color mapping based on MLB WAA z-scores
// mean=-0.25, std=1.49 → grade = 50 + 10*(v - mean)/std
// 80=blue, 70=cyan, 60=teal, 50=green, 40=yellow, 30=orange, 20=red
const WAA_MEAN = -0.25;
const WAA_STD = 1.49;

// WAR equivalents — empirically calibrated 2026-05-18 from the MLB-level pool
// across all five OOTP leagues (default + BLM-ATL/COL/MIA/NYM): n=4582 players.
//   mean=+0.95, std=2.22
//   percentiles: p5=-3.66, p25=+0.54, p50=+1.09, p75=+2.04, p95=+3.55
// FG-canonical benchmarks place avg full-time players at +2 hitter / +1.5 SP /
// +0.5 RP. OOTP MLB pool mean comes in lower (~+0.95) because rosters carry
// more mop-up and long-relief WAR-negative arms than real MLB. Not a bug.
// Recompute as the league talent distribution shifts.
const WAR_MEAN = 0.95;
const WAR_STD = 2.22;
const GRADE_COLORS = [
  [20, [239, 68, 68]],   // red
  [30, [249, 115, 22]],  // orange
  [40, [250, 204, 21]],  // yellow
  [50, [74, 222, 128]],  // green
  [60, [45, 212, 191]],  // teal
  [70, [34, 211, 238]],  // cyan
  [80, [56, 189, 248]],  // blue
];
export function gradeToColor(grade) {
  const g = Math.max(20, Math.min(80, grade));
  for (let i = 0; i < GRADE_COLORS.length - 1; i++) {
    const [g0, c0] = GRADE_COLORS[i];
    const [g1, c1] = GRADE_COLORS[i + 1];
    if (g <= g1) {
      const t = (g - g0) / (g1 - g0);
      const r = Math.round(c0[0] + (c1[0] - c0[0]) * t);
      const gn = Math.round(c0[1] + (c1[1] - c0[1]) * t);
      const b = Math.round(c0[2] + (c1[2] - c0[2]) * t);
      return `rgb(${r},${gn},${b})`;
    }
  }
  return `rgb(${GRADE_COLORS[GRADE_COLORS.length - 1][1].join(",")})`;
}
export const waaStyle = (v) => {
  if (v == null || isNaN(v)) return { color: "#475569" };
  const grade = 50 + 10 * (v - WAA_MEAN) / WAA_STD;
  const bold = grade >= 70 || grade <= 30;
  return { color: gradeToColor(grade), ...(bold ? { fontWeight: 700 } : {}) };
};

export const warStyle = (v) => {
  if (v == null || isNaN(v)) return { color: "#475569" };
  const grade = 50 + 10 * (v - WAR_MEAN) / WAR_STD;
  const bold = grade >= 70 || grade <= 30;
  return { color: gradeToColor(grade), ...(bold ? { fontWeight: 700 } : {}) };
};

export const gradeStyle = (grade) => {
  if (grade == null) return { color: "#475569" };
  const bold = grade >= 70 || grade <= 30;
  return { color: gradeToColor(grade), ...(bold ? { fontWeight: 700 } : {}) };
};

export const intangibleColor = (v) => v === "H" ? "#4ade80" : v === "L" ? "#f87171" : "#64748b";

export const devPctColor = (pct) => {
  if (pct == null) return "#64748b";
  const p = pct * 100;
  if (p >= 80) return "#22c55e";
  if (p >= 60) return "#86efac";
  if (p >= 40) return "#94a3b8";
  if (p >= 20) return "#fca5a5";
  return "#f87171";
};

export const scoutingRatingColor = (v) => {
  if (v >= 65) return "#22c55e";
  if (v >= 55) return "#86efac";
  if (v >= 45) return "#94a3b8";
  if (v >= 35) return "#fca5a5";
  return "#f87171";
};

export const S = {
  loaderContainer: { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(145deg, #0c1222 0%, #0f172a 50%, #0c1222 100%)", fontFamily: "'JetBrains Mono', 'SF Mono', 'Fira Code', monospace" },
  loaderCard: { background: "rgba(15,23,42,0.8)", border: "1px solid #1e293b", borderRadius: 12, padding: 40, display: "flex", flexDirection: "column", alignItems: "center", gap: 24, width: 420, backdropFilter: "blur(12px)" },
  dropZone: { border: "1.5px dashed #334155", borderRadius: 8, padding: "16px 20px", display: "flex", flexDirection: "column", alignItems: "center", cursor: "pointer", transition: "all 0.2s" },
  loadBtn: { width: "100%", padding: "12px 20px", background: "rgba(59,130,246,0.2)", border: "1px solid #3b82f6", borderRadius: 8, color: "#93c5fd", fontSize: 14, fontWeight: 700, fontFamily: "inherit", transition: "all 0.2s", letterSpacing: 1 },
  errorBox: { background: "rgba(239,68,68,0.1)", border: "1px solid #dc2626", borderRadius: 6, padding: "8px 12px", color: "#fca5a5", fontSize: 12, width: "100%" },
  section: { background: "rgba(15,23,42,0.4)", border: "1px solid #1e293b", borderRadius: 10, padding: 20 },
  sectionTitle: { fontSize: 15, fontWeight: 700, color: "#e2e8f0", letterSpacing: 0.5, margin: 0 },
  strengthGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(105px, 1fr))", gap: 8 },
  strengthCard: { borderRadius: 8, padding: "12px 10px", textAlign: "center", border: "1px solid", transition: "all 0.2s" },
  pillBtn: { padding: "5px 12px", borderRadius: 20, border: "1px solid", fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer", transition: "all 0.15s", background: "transparent" },
  tableWrap: { overflowX: "auto", borderRadius: 6, border: "1px solid #1e293b" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 12 },
  th: { padding: "8px 8px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "#64748b", borderBottom: "1px solid #1e293b", background: "rgba(15,23,42,0.6)", letterSpacing: 0.5, textTransform: "uppercase", whiteSpace: "nowrap" },
  td: { padding: "6px 8px", color: "#94a3b8", whiteSpace: "nowrap", fontSize: 12 },
  searchInput: { background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0", padding: "5px 10px", fontSize: 12, fontFamily: "inherit", outline: "none", width: 160 },
  filterSelect: { background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0", padding: "5px 8px", fontSize: 12, fontFamily: "inherit", outline: "none" },
  pageBtn: { padding: "4px 10px", background: "rgba(30,41,59,0.5)", border: "1px solid #334155", borderRadius: 4, color: "#94a3b8", fontSize: 11, fontFamily: "inherit", cursor: "pointer" },
};

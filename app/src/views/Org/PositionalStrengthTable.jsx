import { useState, Fragment, useMemo } from "react";
import { posColor, levelColor, warStyle, zToColor } from "../../theme.js";
import { fmt, fmtAge, rankSuffix } from "../../utils/helpers.js";
import { POT_DISPLAY_POS } from "../../utils/constants.js";

// Per-position strength table. Renders one row per position (POT_DISPLAY_POS) showing
// the team's z-score-driven bar, score, and rank for the "Now" pool (MLB-active +
// 40-man depth) and/or the "Farm" pool (MiLB only).
//
// Props:
//   team           — team name (string)
//   strength       — calcPositionalStrength(...) output
//   mode           — "both" | "now" | "farm"  (which bar column(s) to show)
//   sort           — "spectrum" | "weakest"   (row order)
//   sortRefTeam    — overrides which team's z drives the "weakest" sort. Defaults to `team`.
//                    Set this when stacking two tables side-by-side (Scout View) so they align row-for-row.
//   compact        — drops expand toggle, click-to-expand, and contributor rows
//   dense          — implies compact; also drops Age column and tightens row height /
//                    bar size / fonts. Use on satellite pages (FAF, R5) where the table
//                    is a reminder, not the primary view.
//   onSelectPlayer — only used when compact === false (Overview's depth-list rows)
export default function PositionalStrengthTable({
  team,
  strength,
  mode = "both",
  sort = "spectrum",
  sortRefTeam,
  compact = false,
  dense = false,
  onSelectPlayer,
}) {
  const [expandedPos, setExpandedPos] = useState(null);
  // dense implies compact (no expansion, no depth lists)
  const isCompact = compact || dense;

  const nowZ = strength.zScores?.now?.[team] || {};
  const nowRanks = strength.ranks?.now?.[team] || {};
  const farmZ = strength.zScores?.farm?.[team] || {};
  const farmRanks = strength.ranks?.farm?.[team] || {};
  const teamContrib = strength.contributors?.[team] || { now: {}, farm: {} };
  const teamCoreAge = strength.coreAge?.[team] || {};
  const teamNowScore = strength.teamScores?.[team]?.now || {};
  const teamFarmScore = strength.teamScores?.[team]?.farm || {};

  const showNow = mode === "now" || mode === "both";
  const showFarm = mode === "farm" || mode === "both";
  const expandable = !isCompact;
  const showAge = !dense;

  // Size tokens vary by density.
  const sz = dense
    ? { rowPad: "3px 2px", posFont: 12, barH: 10, scoreFont: 11, rankFont: 11, gap: 8 }
    : { rowPad: "7px 2px", posFont: 16, barH: 16, scoreFont: 12, rankFont: 12, gap: 12 };

  // Sort order. "weakest" ascends by the active-mode z-score for the sort-reference
  // team. When mode === "both", the Now z-score is the tiebreak signal.
  const orderedPositions = useMemo(() => {
    if (sort !== "weakest") return POT_DISPLAY_POS;
    const refTeam = sortRefTeam ?? team;
    const refZNow = strength.zScores?.now?.[refTeam] || {};
    const refZFarm = strength.zScores?.farm?.[refTeam] || {};
    const refZ = mode === "farm" ? refZFarm : refZNow;
    return POT_DISPLAY_POS.slice().sort((a, b) => {
      const za = refZ[a]; const zb = refZ[b];
      if (za == null && zb == null) return 0;
      if (za == null) return 1;
      if (zb == null) return -1;
      return za - zb;
    });
  }, [sort, sortRefTeam, team, mode, strength]);

  // Grid column template adapts to mode + density. Columns:
  //   POS · [Age] · [Now bar] · [Farm bar] · [expand-toggle]
  const cols = [dense ? "32px" : "40px"];
  if (showAge) cols.push("48px");
  if (showNow) cols.push("1fr");
  if (showFarm) cols.push("1fr");
  if (expandable) cols.push("22px");
  const ROW_COLS = cols.join(" ");
  const BAR_COLS = dense ? "1fr 30px 32px" : "1fr 34px 40px";

  const bar = (z, score, rank) => {
    const c = zToColor(z);
    const mag = z == null ? 0 : Math.min(Math.abs(z) / 2.5, 1);
    const pct = (mag * 50).toFixed(1) + "%";
    const positive = (z ?? 0) >= 0;
    return (
      <div style={{ display: "grid", gridTemplateColumns: BAR_COLS, alignItems: "center", gap: 6 }}>
        <div style={{ position: "relative", height: sz.barH, background: "rgba(30,41,59,0.45)", borderRadius: 3 }}>
          <div style={{ position: "absolute", left: "50%", top: -1, bottom: -1, width: 1, background: "#475569" }} />
          {z != null && (
            <div style={{ position: "absolute", top: 1, bottom: 1, background: c.border, borderRadius: 2,
              ...(positive ? { left: "50%", width: pct } : { right: "50%", width: pct }) }} />
          )}
        </div>
        <b style={{ fontSize: sz.scoreFont, color: c.value, textAlign: "right" }}>{fmt(score, 1)}</b>
        <span style={{ fontSize: sz.rankFont, color: c.label, textAlign: "right" }}>{z == null ? "" : rankSuffix(rank)}</span>
      </div>
    );
  };

  const depthList = (title, list) => (
    <div style={{ flex: 1, minWidth: 240 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", letterSpacing: 1, textTransform: "uppercase", marginBottom: 5 }}>{title}</div>
      {(!list || list.length === 0) && <div style={{ fontSize: 12, color: "#475569", fontStyle: "italic" }}>—</div>}
      {(list || []).map((c, i) => {
        const p = c.player;
        return (
          <div key={(p.ID ?? p.id ?? i) + "-" + i} style={{ display: "grid", gridTemplateColumns: "18px 1fr auto 46px", gap: 8, alignItems: "baseline", padding: "3px 0" }}>
            <span style={{ fontSize: 11, color: "#475569" }}>{i + 1}.</span>
            <span style={{ fontSize: 12.5, color: "#e2e8f0", cursor: "pointer" }} onClick={() => onSelectPlayer?.(p)}>
              {p.meta?.name ?? p.Name}
              <span style={{ color: "#64748b", marginLeft: 5 }}>{fmtAge(p._age)}</span>
              <span style={{ color: levelColor(p.meta?.lev ?? p.Lev), marginLeft: 5 }}>{p.meta?.lev ?? p.Lev}</span>
            </span>
            <span style={{ fontSize: 12, ...warStyle(c.val) }}>{fmt(c.val)}</span>
            <span style={{ fontSize: 10.5, color: "#475569", textAlign: "right" }}>×{c.weight.toFixed(2)}</span>
          </div>
        );
      })}
    </div>
  );

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: ROW_COLS, gap: sz.gap, fontSize: dense ? 9 : 11, color: "#64748b", fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", padding: dense ? "0 2px 4px" : "0 2px 7px", borderBottom: "1px solid #1e293b", marginBottom: 5 }}>
        <span>POS</span>
        {showAge && <span style={{ textAlign: "right", textTransform: "none", letterSpacing: 0 }}>Age</span>}
        {showNow && (
          <div style={{ display: "grid", gridTemplateColumns: BAR_COLS, gap: 6 }}><span style={{ textAlign: "center" }}>Now</span><span /><span /></div>
        )}
        {showFarm && (
          <div style={{ display: "grid", gridTemplateColumns: BAR_COLS, gap: 6 }}><span style={{ textAlign: "center" }}>Farm</span><span /><span /></div>
        )}
        {expandable && <span></span>}
      </div>
      {orderedPositions.map((pos) => {
        const age = teamCoreAge[pos];
        const open = expandable && expandedPos === pos;
        return (
          <Fragment key={pos}>
            <div onClick={expandable ? () => setExpandedPos(open ? null : pos) : undefined}
                 style={{ display: "grid", gridTemplateColumns: ROW_COLS, gap: sz.gap, alignItems: "center", cursor: expandable ? "pointer" : "default", padding: sz.rowPad, borderRadius: 4, background: open ? "rgba(59,130,246,0.10)" : "transparent" }}>
              <span style={{ fontSize: sz.posFont, fontWeight: 800, color: posColor(pos) }}>{pos}</span>
              {showAge && <span style={{ fontSize: 12.5, textAlign: "right", color: age != null && age >= 31 ? "#f59e0b" : "#94a3b8", fontWeight: age != null && age >= 31 ? 700 : 400 }}>{age != null ? fmt(age, 1) : "—"}</span>}
              {showNow && bar(nowZ[pos], teamNowScore[pos], nowRanks[pos])}
              {showFarm && bar(farmZ[pos], teamFarmScore[pos], farmRanks[pos])}
              {expandable && <span style={{ fontSize: 12.5, color: "#64748b", textAlign: "center" }}>{open ? "▾" : "▸"}</span>}
            </div>
            {open && (
              <div style={{ display: "flex", gap: 28, flexWrap: "wrap", padding: "6px 2px 10px 52px", background: "rgba(15,23,42,0.4)", borderRadius: 4, marginBottom: 2 }}>
                {depthList("Now · MLB 40-man", teamContrib.now?.[pos])}
                {depthList("Farm · MiLB", teamContrib.farm?.[pos])}
              </div>
            )}
          </Fragment>
        );
      })}
    </div>
  );
}

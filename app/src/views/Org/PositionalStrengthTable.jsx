import { useState, Fragment, useMemo } from "react";
import { TOKENS as T, posColor, levelColor, warStyle, zHeat } from "../../theme.js";
import { fmt, fmtAge, rankSuffix } from "../../utils/helpers.js";
import { POT_DISPLAY_POS } from "../../utils/constants.js";

// Per-position strength table. Renders one row per position (POT_DISPLAY_POS) showing
// the team's z-score-driven bar, score, and rank for the "Now" pool (MLB-active +
// 40-man depth) and/or the "Farm" pool (MiLB only).
//
// Styling: Night Scorecard "needs" table (mockup `.needs` / `td.zbar` / `td.num[data-z]`):
// a centre-zero bar with no track fill (centre line `line2`, ±2.5 edge ticks `line`),
// fill = zHeat(z).bar, score + rank as filled heat cells (zHeat(z).bg / .text), column-group
// rules (`line2`) between POS | Age | Now | Farm, 12px Archivo Narrow sentence-case header.
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
    ? { rowH: 24, posFont: 12.5, barH: 11, cellFont: 11.5, cellPad: "0 6px" }
    : { rowH: 29, posFont: 14, barH: 11, cellFont: 12.5, cellPad: "0 6px" };

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
  const cols = [dense ? "40px" : "48px"];
  if (showAge) cols.push("52px");
  if (showNow) cols.push("1fr");
  if (showFarm) cols.push("1fr");
  if (expandable) cols.push("22px");
  const ROW_COLS = cols.join(" ");
  const BAR_COLS = dense ? "1fr 44px 44px" : "1fr 52px 56px";

  // Column-group rule (mockup `.needs td:nth-child(2,3)`): the Age / Now / Farm wrappers carry it.
  const rule = { borderLeft: `1px solid ${T.line2}` };
  const cell = { display: "flex", alignItems: "center", minWidth: 0 };
  const headFont = { fontFamily: T.fonts.narrow, fontSize: 12, fontWeight: 600, color: T.text2 };

  const bar = (z, score, rank) => {
    const h = zHeat(z);
    const mag = z == null ? 0 : Math.min(Math.abs(z) / 2.5, 1);
    const pct = (mag * 48).toFixed(1) + "%";
    const positive = (z ?? 0) >= 0;
    const heat = { ...cell, justifyContent: "flex-end", padding: sz.cellPad, background: h.bg, color: h.text, fontWeight: 600, fontSize: sz.cellFont, fontVariantNumeric: "tabular-nums" };
    return (
      <div style={{ display: "grid", gridTemplateColumns: BAR_COLS, alignItems: "stretch", height: "100%" }}>
        <div style={{ position: "relative", padding: "0 8px" }}>
          {/* centre line + the ±2.5 edge ticks (bars max out at 48% of the cell either side of centre) */}
          <div style={{ position: "absolute", left: "2%", right: "2%", top: 7, bottom: 7, borderLeft: `1px solid ${T.line}`, borderRight: `1px solid ${T.line}` }} />
          <div style={{ position: "absolute", left: "50%", top: 7, bottom: 7, width: 1, background: T.line2 }} />
          {z != null && (
            <div style={{ position: "absolute", top: "50%", height: sz.barH, transform: "translateY(-50%)", background: h.bar,
              ...(positive ? { left: "50%", width: pct } : { right: "50%", width: pct }) }} />
          )}
        </div>
        <div style={heat}>{fmt(score, 1)}</div>
        <div style={heat}>{z == null ? "" : rankSuffix(rank)}</div>
      </div>
    );
  };

  const depthList = (title, list) => (
    <div style={{ flex: 1, minWidth: 240 }}>
      <div style={{ ...headFont, marginBottom: 5 }}>{title}</div>
      {(!list || list.length === 0) && <div style={{ fontSize: 12, color: T.textDisabled }}>—</div>}
      {(list || []).map((c, i) => {
        const p = c.player;
        return (
          <div key={(p.ID ?? p.id ?? i) + "-" + i} style={{ display: "grid", gridTemplateColumns: "18px 1fr auto 46px", gap: 8, alignItems: "baseline", padding: "3px 0" }}>
            <span style={{ fontSize: 11, color: T.text3 }}>{i + 1}.</span>
            <span style={{ fontSize: 12.5, color: T.text, cursor: "pointer" }} onClick={() => onSelectPlayer?.(p)}>
              {p.meta?.name ?? p.Name}
              <span style={{ color: T.text3, marginLeft: 5 }}>{fmtAge(p._age)}</span>
              <span style={{ color: levelColor(p.meta?.lev ?? p.Lev), marginLeft: 5 }}>{p.meta?.lev ?? p.Lev}</span>
            </span>
            <span style={{ fontSize: 12, ...warStyle(c.val) }}>{fmt(c.val)}</span>
            <span style={{ fontSize: 10.5, color: T.text3, textAlign: "right" }}>×{c.weight.toFixed(2)}</span>
          </div>
        );
      })}
    </div>
  );

  const barHead = (label) => (
    <div style={{ ...rule, display: "grid", gridTemplateColumns: BAR_COLS, alignItems: "stretch" }}>
      <span style={{ ...cell, justifyContent: "center" }}>{label}</span>
      <span style={{ ...cell, justifyContent: "flex-end", padding: sz.cellPad }}>Score</span>
      <span style={{ ...cell, justifyContent: "flex-end", padding: sz.cellPad }}>Rank</span>
    </div>
  );

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: ROW_COLS, alignItems: "stretch", height: dense ? 24 : 28, ...headFont, borderBottom: `1px solid ${T.line2}` }}>
        <span style={{ ...cell, padding: "0 6px" }}>Pos</span>
        {showAge && <span style={{ ...cell, ...rule, justifyContent: "flex-end", padding: "0 6px" }}>Age</span>}
        {showNow && barHead("Now")}
        {showFarm && barHead("Farm")}
        {expandable && <span></span>}
      </div>
      {orderedPositions.map((pos) => {
        const age = teamCoreAge[pos];
        const open = expandable && expandedPos === pos;
        return (
          <Fragment key={pos}>
            <div onClick={expandable ? () => setExpandedPos(open ? null : pos) : undefined}
                 style={{ display: "grid", gridTemplateColumns: ROW_COLS, alignItems: "stretch", height: sz.rowH, cursor: expandable ? "pointer" : "default", borderBottom: `1px solid ${T.line}`, background: open ? T.accentBg : "transparent" }}>
              <span style={{ ...cell, padding: "0 6px", fontFamily: T.fonts.narrow, fontSize: sz.posFont, fontWeight: 700, color: posColor(pos) }}>{pos}</span>
              {showAge && <span style={{ ...cell, ...rule, justifyContent: "flex-end", padding: "0 6px", fontSize: 12.5, fontVariantNumeric: "tabular-nums", color: age != null && age >= 31 ? T.warn : T.text2, fontWeight: age != null && age >= 31 ? 700 : 400 }}>{age != null ? fmt(age, 1) : "—"}</span>}
              {showNow && <div style={rule}>{bar(nowZ[pos], teamNowScore[pos], nowRanks[pos])}</div>}
              {showFarm && <div style={rule}>{bar(farmZ[pos], teamFarmScore[pos], farmRanks[pos])}</div>}
              {expandable && <span style={{ ...cell, justifyContent: "center", fontSize: 12.5, color: T.text3 }}>{open ? "▾" : "▸"}</span>}
            </div>
            {open && (
              <div style={{ display: "flex", gap: 28, flexWrap: "wrap", padding: "8px 12px 10px 54px", background: T.panel2, borderBottom: `1px solid ${T.line}` }}>
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

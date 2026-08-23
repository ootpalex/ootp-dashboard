import { useMemo } from "react";
import { S, TOKENS as T, posColor, warStyle } from "../../theme.js";
import { fmt, num, parseCSVBoolean } from "../../utils/helpers.js";
import { optimizeDefensivePositions, assignPlayersToPositions } from "../../utils/positioning.js";
import { Section, TwoWayBadge, colRule } from "../../components/shared.jsx";

const LINEUP_DEPTH = { C: 1, "1B": 1, "2B": 1, "3B": 1, SS: 1, LF: 1, CF: 1, RF: 1, DH: 1 };

// Scorecard board grammar (same local helper block as the batch-2 boards): column-group left rules via
// colRule, numeric columns right-aligned, first/last cells carry the 12px box padding.
const edgePad = (cols, i, v) => (i === 0 ? { padding: `${v} 6px ${v} 12px` } : i === cols.length - 1 ? { padding: `${v} 12px ${v} 6px` } : {});
const thStyle = (cols, i) => ({ ...S.th, ...(colRule(cols, i) || {}), ...(cols[i].align ? { textAlign: cols[i].align } : {}), ...edgePad(cols, i, "6px"), width: cols[i].w, minWidth: cols[i].w });
const tdStyle = (cols, i) => ({ ...S.td, ...(colRule(cols, i) || {}), ...(cols[i].align ? { textAlign: cols[i].align } : {}), ...edgePad(cols, i, "0") });
const posCell = { fontFamily: T.fonts.narrow, fontWeight: 600, fontSize: 13 };

// Lineup columns (inventory §B.3 item 11): # | Name POS Best B/T | WAR DEF | OBP wOBA.
const LINEUP_COLS = [
  { key: "slot", label: "#", w: 30, group: "slot", align: "right" },
  { key: "name", label: "Name", w: 170, group: "identity" },
  { key: "pos", label: "POS", w: 48, group: "identity" },
  { key: "best", label: "Best", w: 48, group: "identity" },
  { key: "bt", label: "B/T", w: 50, group: "identity" },
  { key: "war", label: "WAR", w: 65, group: "value", align: "right" },
  { key: "def", label: "DEF", w: 60, group: "value", align: "right" },
  { key: "obp", label: "OBP", w: 60, group: "batting", align: "right" },
  { key: "woba", label: "wOBA", w: 60, group: "batting", align: "right" },
];
const ci = Object.fromEntries(LINEUP_COLS.map((c, i) => [c.key, i]));
const td = (key) => tdStyle(LINEUP_COLS, ci[key]);

function buildPlatoonLineup(hitters, hand) {
  const { assigned } = assignPlayersToPositions(hitters, [], LINEUP_DEPTH, "current", hand);

  const rawStarters = [];
  const positions = ["C", "1B", "2B", "3B", "SS", "LF", "CF", "RF", "DH"];
  positions.forEach((pos) => {
    if (assigned[pos] && assigned[pos].length > 0) rawStarters.push(assigned[pos][0]);
  });

  const optimized = optimizeDefensivePositions(rawStarters, positions);

  const starters = optimized.map((p) => ({
    ...p,
    _obp: num(p.batting?.[hand]?.obp ?? p[`OBP ${hand}`]),
    _woba: num(p.batting?.[hand]?.woba ?? p[`wOBA ${hand}`]),
  }));

  if (starters.length === 0) return [];

  let bestOBPIdx = 0;
  starters.forEach((p, i) => {
    if ((p._obp ?? -1) > (starters[bestOBPIdx]._obp ?? -1)) bestOBPIdx = i;
  });
  const leadoff = starters.splice(bestOBPIdx, 1)[0];

  starters.sort((a, b) => (b._woba ?? -999) - (a._woba ?? -999));

  return [leadoff, ...starters];
}

export default function OptimizedLineupSubTab({ data, team, onSelectPlayer }) {
  const teamHitters = useMemo(() => data.hitters.filter((h) => (h.meta?.org ?? h.ORG) === team), [data.hitters, team]);
  const mlbHitters = useMemo(() => teamHitters.filter((h) =>
    ((h.meta?.lev ?? h.Lev) === "MLB" && (h.meta?.on40 ?? (h.ON40 === "Yes"))) || ((h.meta?.lev ?? h.Lev) === "MLB" && ((h.meta?.inj != null ? h.meta.inj === "Yes" : parseCSVBoolean(h.INJ))))
  ), [teamHitters]);

  const vsRHP = useMemo(() => buildPlatoonLineup(mlbHitters, "vR"), [mlbHitters]);
  const vsLHP = useMemo(() => buildPlatoonLineup(mlbHitters, "vL"), [mlbHitters]);

  const renderLineup = (lineup, hand, label, sub) => (
    <Section title={label} state={sub} footer="Leadoff: highest OBP. Slots 2-9: sorted by wOBA descending.">
      {/* Table runs edge to edge inside the box body (the box border is the rule). */}
      <div style={{ margin: "-12px -12px -13px" }}>
        <div style={{ ...S.tableWrap, border: "none", borderRadius: 0 }}>
          <table style={S.table}>
            <thead><tr>
              {LINEUP_COLS.map(({ key, label: lbl }, i) => <th key={key} style={thStyle(LINEUP_COLS, i)}>{lbl}</th>)}
            </tr></thead>
            <tbody>
              {lineup.map((p, i) => {
                const war = p._assignedVal;
                const defR = p._defRunsP;
                return (
                  <tr key={p.ID} style={i % 2 === 1 ? S.zebraRow : undefined}>
                    <td style={{ ...td("slot"), color: T.text3, fontWeight: 700 }}>{i + 1}</td>
                    <td style={{ ...td("name"), ...S.tdName, minWidth: 170, cursor: "pointer" }}
                        onClick={() => onSelectPlayer?.(p)}>{p.meta?.name ?? p.Name}<TwoWayBadge player={p} /></td>
                    <td style={{ ...td("pos"), ...posCell, color: posColor(p._assignedPos) }}>{p._assignedPos}</td>
                    <td style={{ ...td("best"), ...posCell, color: p._bestPos ? posColor(p._bestPos?.replace("*", "")) : T.textDisabled }}>{p._bestPos || "—"}</td>
                    <td style={{ ...td("bt"), color: T.text2 }}>{`${p.meta?.bats ?? p.B ?? ""}/${p.meta?.throws ?? p.T ?? ""}`}</td>
                    <td style={{ ...td("war"), ...warStyle(war) }}>{fmt(war)}</td>
                    <td style={{ ...td("def"), ...(p._assignedPos === "DH" ? { color: T.textDisabled } : warStyle(defR)) }}>{p._assignedPos === "DH" ? "—" : fmt(defR)}</td>
                    <td style={{ ...td("obp"), color: p._obp != null ? T.text : T.textDisabled }}>{p._obp != null ? p._obp.toFixed(3) : "—"}</td>
                    <td style={{ ...td("woba"), color: p._woba != null ? T.text : T.textDisabled }}>{p._woba != null ? p._woba.toFixed(3) : "—"}</td>
                  </tr>
                );
              })}
              {lineup.length === 0 && <tr><td colSpan={LINEUP_COLS.length} style={{ ...S.td, textAlign: "center", color: T.text3, padding: "16px 12px" }}>No lineup data</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </Section>
  );

  const diffCount = useMemo(() => {
    const rhpIds = new Set(vsRHP.map((p) => p.ID));
    return vsLHP.filter((p) => !rhpIds.has(p.ID)).length;
  }, [vsRHP, vsLHP]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ fontSize: 12.5, color: T.text2 }}>
        {diffCount > 0
          ? <>{diffCount} player{diffCount > 1 ? "s" : ""} differ between platoon lineups. Positions assigned via defensive spectrum cascade using split WAR values.</>
          : <>Same 9 starters in both lineups. Position values and batting order may differ.</>
        }
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(480px, 1fr))", gap: 16 }}>
        {renderLineup(vsRHP, "vR", "vs RHP", "Lineup vs right-handed pitchers")}
        {renderLineup(vsLHP, "vL", "vs LHP", "Lineup vs left-handed pitchers")}
      </div>
    </div>
  );
}

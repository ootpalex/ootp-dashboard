import { useMemo } from "react";
import { S, posColor, warStyle } from "../../theme.js";
import { fmt, num, parseCSVBoolean } from "../../utils/helpers.js";
import { optimizeDefensivePositions, assignPlayersToPositions } from "../../utils/positioning.js";
import { Section, TwoWayBadge } from "../../components/shared.jsx";

const LINEUP_DEPTH = { C: 1, "1B": 1, "2B": 1, "3B": 1, SS: 1, LF: 1, CF: 1, RF: 1, DH: 1 };

function buildPlatoonLineup(hitters, hand) {
  const warCol = (pos) => `${pos} WAR ${hand}`;
  const { assigned } = assignPlayersToPositions(hitters, [], LINEUP_DEPTH, "current", warCol);

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

  const renderLineup = (lineup, hand, label) => (
    <Section title={label}>
      <div style={S.tableWrap}>
        <table style={S.table}>
          <thead><tr>
            <th style={{ ...S.th, width: 30 }}>#</th>
            <th style={{ ...S.th, width: 170 }}>Name</th>
            <th style={{ ...S.th, width: 48 }}>POS</th>
            <th style={{ ...S.th, width: 48 }}>Best</th>
            <th style={{ ...S.th, width: 50 }}>B/T</th>
            <th style={{ ...S.th, width: 65 }}>WAR</th>
            <th style={{ ...S.th, width: 60 }}>DEF</th>
            <th style={{ ...S.th, width: 60 }}>OBP</th>
            <th style={{ ...S.th, width: 60 }}>wOBA</th>
          </tr></thead>
          <tbody>
            {lineup.map((p, i) => {
              const war = p._assignedVal;
              const defR = p._defRunsP;
              return (
                <tr key={p.ID} style={{ background: i % 2 === 0 ? "transparent" : "rgba(15,23,42,0.3)" }}>
                  <td style={{ ...S.td, color: "#475569", fontWeight: 700 }}>{i + 1}</td>
                  <td style={{ ...S.td, fontWeight: 600, color: "#e2e8f0", minWidth: 170, cursor: "pointer" }}
                      onClick={() => onSelectPlayer?.(p)}>{p.meta?.name ?? p.Name}<TwoWayBadge player={p} /></td>
                  <td style={{ ...S.td, color: posColor(p._assignedPos) }}>{p._assignedPos}</td>
                  <td style={{ ...S.td, color: posColor(p._bestPos?.replace("*", "")) }}>{p._bestPos || "—"}</td>
                  <td style={S.td}>{`${p.meta?.bats ?? p.B ?? ""}/${p.meta?.throws ?? p.T ?? ""}`}</td>
                  <td style={{ ...S.td, ...warStyle(war) }}>{fmt(war)}</td>
                  <td style={{ ...S.td, ...warStyle(defR) }}>{p._assignedPos === "DH" ? "—" : fmt(defR)}</td>
                  <td style={{ ...S.td, color: p._obp != null ? "#e2e8f0" : "#475569" }}>{p._obp != null ? p._obp.toFixed(3) : "—"}</td>
                  <td style={{ ...S.td, color: p._woba != null ? "#e2e8f0" : "#475569" }}>{p._woba != null ? p._woba.toFixed(3) : "—"}</td>
                </tr>
              );
            })}
            {lineup.length === 0 && <tr><td colSpan={9} style={{ ...S.td, textAlign: "center", color: "#475569" }}>No lineup data</td></tr>}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 10, color: "#475569", marginTop: 6 }}>
        Leadoff: highest OBP. Slots 2-9: sorted by wOBA descending.
      </div>
    </Section>
  );

  const diffCount = useMemo(() => {
    const rhpIds = new Set(vsRHP.map((p) => p.ID));
    return vsLHP.filter((p) => !rhpIds.has(p.ID)).length;
  }, [vsRHP, vsLHP]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ fontSize: 12, color: "#94a3b8" }}>
        {diffCount > 0
          ? <>{diffCount} player{diffCount > 1 ? "s" : ""} differ between platoon lineups. Positions assigned via defensive spectrum cascade using split WAR values.</>
          : <>Same 9 starters in both lineups. Position values and batting order may differ.</>
        }
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(480px, 1fr))", gap: 20 }}>
        {renderLineup(vsRHP, "vR", "vs RHP (Lineup vs Right-Handed Pitchers)")}
        {renderLineup(vsLHP, "vL", "vs LHP (Lineup vs Left-Handed Pitchers)")}
      </div>
    </div>
  );
}

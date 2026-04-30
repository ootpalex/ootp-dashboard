import { useMemo } from "react";
import { S, posColor, proneColor, waaStyle } from "../../theme.js";
import { fmt, fmtAge, parseCSVBoolean } from "../../utils/helpers.js";
import { getMaxWaa } from "../../utils/accessors.js";
import { ACTIVE_ROSTER_DEPTH } from "../../utils/constants.js";
import { optimizeDefensivePositions, assignPlayersToPositions } from "../../utils/positioning.js";
import { Section, TwoWayBadge } from "../../components/shared.jsx";

export default function ActiveRosterSubTab({ data, team, onSelectPlayer }) {
  const teamHitters = useMemo(() => data.hitters.filter((h) => (h.meta?.org ?? h.ORG) === team), [data.hitters, team]);
  const teamPitchers = useMemo(() => data.pitchers.filter((p) => (p.meta?.org ?? p.ORG) === team), [data.pitchers, team]);

  const mlbHitters = useMemo(() => teamHitters.filter((h) =>
    ((h.meta?.lev ?? h.Lev) === "MLB" && (h.meta?.on40 ?? (h.ON40 === "Yes"))) || ((h.meta?.lev ?? h.Lev) === "MLB" && ((h.meta?.inj != null ? h.meta.inj === "Yes" : parseCSVBoolean(h.INJ))))
  ), [teamHitters]);
  const mlbPitchers = useMemo(() => teamPitchers.filter((p) =>
    ((p.meta?.lev ?? p.Lev) === "MLB" && (p.meta?.on40 ?? (p.ON40 === "Yes"))) || ((p.meta?.lev ?? p.Lev) === "MLB" && ((p.meta?.inj != null ? p.meta.inj === "Yes" : parseCSVBoolean(p.INJ))))
  ), [teamPitchers]);

  const { assigned, unassigned } = useMemo(() => {
    const result = assignPlayersToPositions(mlbHitters, mlbPitchers, ACTIVE_ROSTER_DEPTH, "current");

    const hitterPositions = ["C", "1B", "2B", "3B", "SS", "LF", "CF", "RF", "DH"];
    const rawStarters = [];
    hitterPositions.forEach((pos) => {
      if (result.assigned[pos] && result.assigned[pos].length > 0) rawStarters.push(result.assigned[pos][0]);
    });
    if (rawStarters.length > 0) {
      const optimized = optimizeDefensivePositions(rawStarters, hitterPositions);
      hitterPositions.forEach((pos) => { result.assigned[pos] = []; });
      optimized.forEach((p) => { result.assigned[p._assignedPos] = [p]; });
    }

    return result;
  }, [mlbHitters, mlbPitchers]);

  const renderPlayerRow = (p, i, showPos = true) => {
    const waa = p._assignedVal ?? (p._type === "pitcher" ? p._waa : getMaxWaa(p));
    const isInjured = (p.meta?.inj != null ? p.meta.inj === "Yes" : parseCSVBoolean(p.INJ));
    return (
      <tr key={p.ID + "-" + i} style={{ background: i % 2 === 0 ? "transparent" : "rgba(15,23,42,0.3)" }}>
        <td style={{ ...S.td, fontWeight: 600, color: isInjured ? "#fbbf24" : "#e2e8f0", minWidth: 170, cursor: "pointer" }}
            onClick={() => onSelectPlayer?.(p)}>
          {p.meta?.name ?? p.Name}<TwoWayBadge player={p} />{isInjured && <span style={{ color: "#f87171", marginLeft: 6, fontSize: 10 }}>INJ</span>}
        </td>
        {showPos && <td style={{ ...S.td, color: posColor(p._assignedPos || p.meta?.pos || p.POS) }}>{p._assignedPos || p.meta?.pos || p.POS}</td>}
        {showPos && <td style={{ ...S.td, color: posColor(p._bestPos?.replace("*", "")) }}>{p._bestPos || "—"}</td>}
        <td style={S.td}>{fmtAge(p._age)}</td>
        <td style={S.td}>{`${p.meta?.bats ?? p.B ?? ""}/${p.meta?.throws ?? p.T ?? ""}`}</td>
        <td style={{ ...S.td, ...waaStyle(waa) }}>{fmt(waa)}</td>
        <td style={{ ...S.td, color: proneColor(p.meta?.prone ?? p.Prone) }}>{p.meta?.prone ?? p.Prone ?? "—"}</td>
      </tr>
    );
  };

  const positionStarters = ["C", "1B", "2B", "3B", "SS", "LF", "CF", "RF", "DH"];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <Section title="Starting Lineup">
        <div style={S.tableWrap}>
          <table style={S.table}>
            <thead><tr>
              <th style={{ ...S.th, width: 170 }}>Name</th>
              <th style={{ ...S.th, width: 50 }}>POS</th>
              <th style={{ ...S.th, width: 50 }}>Best</th>
              <th style={{ ...S.th, width: 45 }}>Age</th>
              <th style={{ ...S.th, width: 50 }}>B/T</th>
              <th style={{ ...S.th, width: 65 }}>WAA</th>
              <th style={{ ...S.th, width: 65 }}>Prone</th>
            </tr></thead>
            <tbody>
              {positionStarters.map((pos) => {
                const players = assigned[pos] || [];
                if (players.length === 0) return (
                  <tr key={pos}><td style={{ ...S.td, color: posColor(pos), fontWeight: 600 }} colSpan={7}>{pos} — (empty)</td></tr>
                );
                return players.map((p, i) => renderPlayerRow(p, i));
              })}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 11, color: "#475569", marginTop: 4 }}>
          Assigned via defensive spectrum cascade: C → SS → CF → 2B → 3B → LF → RF → 1B → DH
        </div>
      </Section>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(480px, 1fr))", gap: 20 }}>
        <Section title={`Starting Rotation (${assigned.SP.length})`}>
          <div style={S.tableWrap}>
            <table style={S.table}>
              <thead><tr>
                <th style={{ ...S.th, width: 170 }}>Name</th>
                <th style={{ ...S.th, width: 45 }}>Age</th>
                <th style={{ ...S.th, width: 50 }}>B/T</th>
                <th style={{ ...S.th, width: 65 }}>WAA</th>
                <th style={{ ...S.th, width: 65 }}>Prone</th>
              </tr></thead>
              <tbody>
                {assigned.SP.length === 0
                  ? <tr><td colSpan={5} style={{ ...S.td, color: "#475569", textAlign: "center" }}>No SP assigned</td></tr>
                  : assigned.SP.map((p, i) => renderPlayerRow(p, i, false))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title={`Bullpen (${assigned.RP.length})`}>
          <div style={S.tableWrap}>
            <table style={S.table}>
              <thead><tr>
                <th style={{ ...S.th, width: 170 }}>Name</th>
                <th style={{ ...S.th, width: 45 }}>Age</th>
                <th style={{ ...S.th, width: 50 }}>B/T</th>
                <th style={{ ...S.th, width: 65 }}>WAA</th>
                <th style={{ ...S.th, width: 65 }}>Prone</th>
              </tr></thead>
              <tbody>
                {assigned.RP.length === 0
                  ? <tr><td colSpan={5} style={{ ...S.td, color: "#475569", textAlign: "center" }}>No RP assigned</td></tr>
                  : assigned.RP.map((p, i) => renderPlayerRow(p, i, false))}
              </tbody>
            </table>
          </div>
        </Section>
      </div>

      {unassigned.length > 0 && (
        <Section title={`Bench / Unassigned (${unassigned.length})`}>
          <div style={S.tableWrap}>
            <table style={S.table}>
              <thead><tr>
                <th style={{ ...S.th, width: 170 }}>Name</th>
                <th style={{ ...S.th, width: 50 }}>POS</th>
                <th style={{ ...S.th, width: 45 }}>Age</th>
                <th style={{ ...S.th, width: 50 }}>B/T</th>
                <th style={{ ...S.th, width: 65 }}>WAA</th>
                <th style={{ ...S.th, width: 65 }}>Prone</th>
              </tr></thead>
              <tbody>
                {unassigned.map((p, i) => {
                  const waa = p._type === "pitcher" ? p._waa : getMaxWaa(p);
                  const isInjured = (p.meta?.inj != null ? p.meta.inj === "Yes" : parseCSVBoolean(p.INJ));
                  return (
                    <tr key={p.ID + "-bench-" + i} style={{ background: i % 2 === 0 ? "transparent" : "rgba(15,23,42,0.3)" }}>
                      <td style={{ ...S.td, fontWeight: 600, color: isInjured ? "#fbbf24" : "#e2e8f0", minWidth: 170 }}>
                        {p.meta?.name ?? p.Name}<TwoWayBadge player={p} />{isInjured && <span style={{ color: "#f87171", marginLeft: 6, fontSize: 10 }}>INJ</span>}
                      </td>
                      <td style={{ ...S.td, color: posColor(p.meta?.pos ?? p.POS) }}>{p.meta?.pos ?? p.POS}</td>
                      <td style={S.td}>{fmtAge(p._age)}</td>
                      <td style={S.td}>{`${p.meta?.bats ?? p.B ?? ""}/${p.meta?.throws ?? p.T ?? ""}`}</td>
                      <td style={{ ...S.td, ...waaStyle(waa) }}>{fmt(waa)}</td>
                      <td style={{ ...S.td, color: proneColor(p.meta?.prone ?? p.Prone) }}>{p.meta?.prone ?? p.Prone ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      <div style={{ fontSize: 12, color: "#475569" }}>
        Total: {mlbHitters.length + mlbPitchers.length} MLB-level players ({mlbHitters.length} position, {mlbPitchers.length} pitchers)
      </div>
    </div>
  );
}

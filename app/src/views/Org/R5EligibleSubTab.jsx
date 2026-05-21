import { useState, useMemo } from "react";
import { S, posColor, levelColor, proneColor, warStyle, devPctColor } from "../../theme.js";
import { fmt, fmtAge, parseCSVBoolean, toRosterRow, sortRosterRows, rankSuffix } from "../../utils/helpers.js";
import { Section, SortHeader, TwoWayBadge } from "../../components/shared.jsx";

export default function R5EligibleSubTab({ teamHitters, teamPitchers, onSelectPlayer }) {
  const [r5Sort, setR5Sort] = useState({ col: "fv", dir: "desc" });

  const r5Eligible = useMemo(() => {
    const h = teamHitters.filter((p) => (p.meta?.r5 ?? parseCSVBoolean(p.R5))).map((p) => toRosterRow(p, "hitter"));
    const pi = teamPitchers.filter((p) => (p.meta?.r5 ?? parseCSVBoolean(p.R5))).map((p) => toRosterRow(p, "pitcher"));
    let all = [...h, ...pi];
    const R5_COL_MAP = { warP: (p) => p.warP, war: (p) => p.war, devPct: (p) => p.devPct, fv: (p) => p.fv };
    sortRosterRows(all, r5Sort.col, r5Sort.dir, R5_COL_MAP);
    return all;
  }, [teamHitters, teamPitchers, r5Sort]);

  const toggleSort = (col) => setR5Sort((prev) => ({ col, dir: prev.col === col && prev.dir === "desc" ? "asc" : "desc" }));

  return (
    <Section title={`Rule 5 Eligible (${r5Eligible.length} players)`}>
      <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 12 }}>
        Players in your org eligible for the Rule 5 draft. Consider protecting high-FV players by adding them to your 40-man roster.
      </div>
      <div style={S.tableWrap}><table style={S.table}><thead><tr>
        {[{ key: "name", label: "Name", w: 180 }, { key: "age", label: "Age", w: 50 }, { key: "devPct", label: "Dev%", w: 48 }, { key: "pos", label: "POS", w: 50 }, { key: "bestPos", label: "Best", w: 50 }, { key: "level", label: "Level", w: 55 }, { key: "fv", label: "FV", w: 60 }, { key: "war", label: "WAR", w: 70 }, { key: "warP", label: "WAR P", w: 70 }, { key: "prone", label: "Prone", w: 70 }, { key: "bt", label: "B/T", w: 50 }].map(({ key, label, w }) => <SortHeader key={key} label={label} width={w} sortCol={r5Sort.col} sortDir={r5Sort.dir} colKey={key} onClick={() => toggleSort(key)} />)}
      </tr></thead><tbody>
        {r5Eligible.map((p, i) => (
          <tr key={p.id + "-" + i} style={{ background: i % 2 === 0 ? "transparent" : "rgba(15,23,42,0.3)" }}>
            <td style={{ ...S.td, fontWeight: 600, color: "#e2e8f0", minWidth: 180, cursor: "pointer" }}
                onClick={() => onSelectPlayer?.(p._original || p)}>{p.name}<TwoWayBadge player={p} /></td>
            <td style={S.td}>{fmtAge(p.age)}</td>
            <td style={{ ...S.td, color: !p.matured && p.devPct != null ? devPctColor(p.devPct) : "#475569", fontWeight: !p.matured && p.devPct != null ? 600 : 400 }}>{!p.matured && p.devPct != null ? rankSuffix(Math.round(p.devPct * 100)) : "—"}</td>
            <td style={{ ...S.td, color: posColor(p.pos) }}>{p.pos}</td>
            <td style={{ ...S.td, color: posColor((p.bestPos || "").replace("*", "")) }}>{p.bestPos || "—"}</td>
            <td style={{ ...S.td, color: levelColor(p.level) }}>{p.level}</td>
            <td style={{ ...S.td, ...warStyle(p.fv) }}>{fmt(p.fv)}</td>
            <td style={{ ...S.td, ...warStyle(p.war) }}>{fmt(p.war)}</td>
            <td style={{ ...S.td, ...(p.matured ? { color: "#475569" } : warStyle(p.warP)) }}>{p.matured ? "—" : fmt(p.warP)}</td>
            <td style={{ ...S.td, color: proneColor(p.prone) }}>{p.prone}</td>
            <td style={S.td}>{p.bt}</td>
          </tr>
        ))}
        {r5Eligible.length === 0 && <tr><td colSpan={11} style={{ ...S.td, textAlign: "center", color: "#475569" }}>No R5-eligible players found</td></tr>}
      </tbody></table></div>
      <div style={{ fontSize: 11, color: "#475569", marginTop: 4 }}>{r5Eligible.length} players</div>
    </Section>
  );
}

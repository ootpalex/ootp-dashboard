import { useState, useMemo } from "react";
import { S, posColor, levelColor, proneColor, warStyle, devPctColor, gradeStyle } from "../../theme.js";
import { fmt, fmtAge, paginateRows, toRosterRow, sortRosterRows, rankSuffix } from "../../utils/helpers.js";
import { PER_PAGE } from "../../utils/constants.js";
import { passesPositionFilter, passesLevelFilter } from "../../utils/accessors.js";
import { Section, SortHeader, PositionFilter, LevelFilter, TwoWayBadge, Pagination } from "../../components/shared.jsx";
import PositionalStrengthTable from "./PositionalStrengthTable.jsx";

export default function OverviewSubTab({
  data, team, teamHitters, teamPitchers,
  strength, onSelectPlayer,
}) {
  const [rosterLevel, setRosterLevel] = useState([]);
  const [rosterSort, setRosterSort] = useState({ col: "war", dir: "desc" });
  const [rosterPage, setRosterPage] = useState(0);
  const [posFilter, setPosFilter] = useState([]);

  const teamPlayersForFilter = useMemo(() => [...teamHitters, ...teamPitchers], [teamHitters, teamPitchers]);

  const roster = useMemo(() => {
    let players = [
      ...teamHitters.map((h) => toRosterRow(h, "hitter", { on40: h.meta?.on40 ?? h.ON40, price: h._price, _intangibles: h._intangibles })),
      ...teamPitchers.map((p) => toRosterRow(p, "pitcher", { on40: p.meta?.on40 ?? p.ON40, price: p._price, _intangibles: p._intangibles })),
    ];
    if (posFilter.length > 0) players = players.filter((p) => passesPositionFilter(p._original, posFilter));
    if (rosterLevel.length > 0) players = players.filter((p) => passesLevelFilter(p._original, rosterLevel));
    sortRosterRows(players, rosterSort.col, rosterSort.dir);
    return players;
  }, [teamHitters, teamPitchers, rosterLevel, rosterSort, posFilter]);

  const { paged: pagedRoster, totalPages: rosterTotalPages } = paginateRows(roster, rosterPage, PER_PAGE);

  const toggleSort = (setter) => (col) => { setter((prev) => ({ col, dir: prev.col === col && prev.dir === "desc" ? "asc" : "desc" })); setRosterPage(0); };

  return (
    <>
      <Section title="Positional Strength">
        <div style={{ fontSize: 12, color: "#64748b", marginBottom: 10, lineHeight: 1.5 }}>
          <strong style={{ color: "#94a3b8" }}>Now</strong> = MLB-active starter + 40-man depth (current WAR). <strong style={{ color: "#94a3b8" }}>Farm</strong> = MiLB players only (FV). Each bar runs from the league-average line — <span style={{ color: "#f87171" }}>left = below average</span>, <span style={{ color: "#4ade80" }}>right = above</span>, longer = further from average. <strong style={{ color: "#94a3b8" }}>Age</strong> = weighted age of your MLB core. Click a position for the players behind it.
        </div>
        <PositionalStrengthTable
          team={team}
          strength={strength}
          mode="both"
          sort="spectrum"
          onSelectPlayer={onSelectPlayer}
        />
      </Section>

      <Section title={`${team} Roster (${roster.length})`}>
        <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
          <PositionFilter value={posFilter} onChange={(v) => { setPosFilter(v); setRosterPage(0); }} />
          <LevelFilter players={teamPlayersForFilter} value={rosterLevel} onChange={(v) => { setRosterLevel(v); setRosterPage(0); }} expandRookieTeams />
        </div>
        <div style={S.tableWrap}><table style={S.table}><thead><tr>
          {[{ key: "name", label: "Name", w: 170 }, { key: "age", label: "Age", w: 45 }, { key: "pos", label: "POS", w: 48 }, { key: "bestPos", label: "Best", w: 48 }, { key: "bt", label: "B/T", w: 50 }, { key: "level", label: "Lvl", w: 45 }, { key: "on40", label: "40M", w: 45 }, { key: "fv", label: "FV", w: 60 }, { key: "war", label: "WAR", w: 65 }, { key: "warP", label: "WAR P", w: 65 }, { key: "devPct", label: "Dev%", w: 48 }, { key: "prone", label: "Prone", w: 65 }, { key: "_intangibles", label: "INTG", w: 48 }, { key: "price", label: "Salary", w: 85 }].map(({ key, label, w }) => <SortHeader key={key} label={label} width={w} sortCol={rosterSort.col} sortDir={rosterSort.dir} colKey={key} onClick={() => toggleSort(setRosterSort)(key)} />)}
        </tr></thead><tbody>
          {pagedRoster.map((p, i) => (
            <tr key={p.id + "-" + i} style={{ background: i % 2 === 0 ? "transparent" : "rgba(15,23,42,0.3)" }}>
              <td style={{ ...S.td, fontWeight: 600, color: "#e2e8f0", minWidth: 180, cursor: "pointer" }}
                  onClick={() => onSelectPlayer?.(p._original || p)}>{p.name}<TwoWayBadge player={p} /></td>
              <td style={S.td}>{fmtAge(p.age)}</td><td style={{ ...S.td, color: posColor(p.pos) }}>{p.pos}</td>
              <td style={{ ...S.td, color: posColor((p.bestPos || "").replace("*", "")) }}>{p.bestPos || "—"}</td>
              <td style={S.td}>{p.bt}</td><td style={{ ...S.td, color: levelColor(p.level) }}>{p.level}</td>
              <td style={S.td}>{p.on40 === true || p.on40 === "Yes" ? "✓" : ""}</td>
              <td style={{ ...S.td, ...warStyle(p.fv) }}>{fmt(p.fv)}</td>
              <td style={{ ...S.td, ...warStyle(p.war) }}>{fmt(p.war)}</td>
              <td style={{ ...S.td, ...(p.matured ? { color: "#475569" } : warStyle(p.warP)) }}>{p.matured ? "—" : fmt(p.warP)}</td>
              <td style={{ ...S.td, color: !p.matured && p.devPct != null ? devPctColor(p.devPct) : "#475569", fontWeight: !p.matured && p.devPct != null ? 600 : 400 }}>{!p.matured && p.devPct != null ? rankSuffix(Math.round(p.devPct * 100)) : "—"}</td>
              <td style={{ ...S.td, color: proneColor(p.prone) }}>{p.prone}</td>
              <td style={{ ...S.td, ...gradeStyle(p._intangibles), fontWeight: 700 }}>{p._intangibles ?? "—"}</td>
              <td style={{ ...S.td, color: "#94a3b8" }}>{p.price != null ? "$" + p.price.toLocaleString() : "—"}</td>
            </tr>
          ))}
          {roster.length === 0 && <tr><td colSpan={14} style={{ ...S.td, textAlign: "center", color: "#475569" }}>No players found</td></tr>}
        </tbody></table></div>
        {rosterTotalPages > 1
          ? <Pagination page={rosterPage} totalPages={rosterTotalPages} total={roster.length} onPrev={() => setRosterPage(Math.max(0, rosterPage - 1))} onNext={() => setRosterPage(Math.min(rosterTotalPages - 1, rosterPage + 1))} />
          : <div style={{ fontSize: 11, color: "#475569", marginTop: 4 }}>{roster.length} players</div>}
      </Section>
    </>
  );
}

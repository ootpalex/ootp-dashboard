import { useState, useMemo } from "react";
import { S } from "../theme.js";
import { posColor, levelColor, proneColor, warStyle, devPctColor, zToColor } from "../theme.js";
import { fmt, fmtAge, toRosterRow, sortRosterRows, rankSuffix, paginateRows } from "../utils/helpers.js";
import { POT_DISPLAY_POS, PER_PAGE } from "../utils/constants.js";
import { passesPositionFilter, passesLevelFilter } from "../utils/accessors.js";
import { calcOrgNeed } from "../utils/strength.js";
import { Section, SortHeader, PillBtn, PositionFilter, LevelFilter, TwoWayBadge, Pagination } from "./shared.jsx";

export default function ScoutView({ data, myTeam, strength, strengthMode, setStrengthMode, curveSettings, onSelectPlayer }) {
  const [scoutTeam, setScoutTeam] = useState(() => data.teams.find((t) => t !== myTeam) || data.teams[0]);
  const [rosterLevel, setRosterLevel] = useState([]);
  const [posFilter, setPosFilter] = useState([]);
  const [rosterSort, setRosterSort] = useState({ col: "war", dir: "desc" });
  const [page, setPage] = useState(0);

  const mode = strengthMode;
  const orgNeed = useMemo(() => calcOrgNeed(myTeam, strength, mode), [myTeam, strength, mode]);
  const totalTeams = data.teams.length;

  const scoutZ = strength.zScores[mode]?.[scoutTeam] || {};
  const scoutRanks = strength.ranks[mode]?.[scoutTeam] || {};
  const scoutScores = strength.teamScores[scoutTeam]?.[mode] || {};

  const myZ = strength.zScores[mode]?.[myTeam] || {};
  const myRanks = strength.ranks[mode]?.[myTeam] || {};
  const myScores = strength.teamScores[myTeam]?.[mode] || {};

  const positions = POT_DISPLAY_POS;

  const tradeOpportunities = useMemo(() =>
    positions.filter((pos) => {
      const theirs = scoutZ[pos] ?? 0, ours = myZ[pos] ?? 0;
      return theirs > 0 && ours < 0 && (theirs - ours) >= 1.0;
    }),
    [positions, scoutZ, myZ]
  );

  const teamHitters = useMemo(() => data.hitters.filter((h) => (h.meta?.org ?? h.ORG) === scoutTeam), [data.hitters, scoutTeam]);
  const teamPitchers = useMemo(() => data.pitchers.filter((p) => (p.meta?.org ?? p.ORG) === scoutTeam), [data.pitchers, scoutTeam]);

  const baseRosterRows = useMemo(() => [
    ...teamHitters.map((h) => toRosterRow(h, "hitter", { on40: h.meta?.on40 ?? h.ON40, price: h._price })),
    ...teamPitchers.map((p) => toRosterRow(p, "pitcher", { on40: p.meta?.on40 ?? p.ON40, price: p._price })),
  ], [teamHitters, teamPitchers]);

  const teamPlayersForFilter = useMemo(() => [...teamHitters, ...teamPitchers], [teamHitters, teamPitchers]);

  const roster = useMemo(() => {
    let players = baseRosterRows.map((p) => {
      const need = orgNeed[p.pos] ?? 0;
      const fit = (p.war != null && p.war > 0 && need > 0) ? p.war * (1 + need) : null;
      return { ...p, fit };
    });
    if (posFilter.length > 0) players = players.filter((p) => passesPositionFilter(p._original, posFilter));
    if (rosterLevel.length > 0) players = players.filter((p) => passesLevelFilter(p._original, rosterLevel));
    sortRosterRows(players, rosterSort.col, rosterSort.dir);
    return players;
  }, [baseRosterRows, rosterLevel, rosterSort, posFilter, orgNeed]);

  const { paged, totalPages } = paginateRows(roster, page, PER_PAGE);

  const tradeTargets = useMemo(() => {
    const weakPos = new Set(positions.filter((pos) => (myZ[pos] ?? 0) < 0));
    return baseRosterRows
      .filter((p) => weakPos.has(p.pos) && p.war != null && p.war > 0)
      .map((p) => ({ ...p, fit: p.war * (1 + (orgNeed[p.pos] ?? 0)) }))
      .sort((a, b) => b.fit - a.fit);
  }, [baseRosterRows, positions, myZ, orgNeed]);

  const toggleSort = (col) => setRosterSort((prev) => ({ col, dir: prev.col === col && prev.dir === "desc" ? "asc" : "desc" }));

  const renderStrengthCards = (z, ranks, scores, label) => (
    <div>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0", marginBottom: 8 }}>{label}</div>
      <div style={S.strengthGrid}>
        {positions.map((pos) => {
          const zv = z[pos]; const rank = ranks[pos]; const score = scores[pos]; const colors = zToColor(zv);
          return (
            <div key={pos} style={{ ...S.strengthCard, background: colors.bg, borderColor: colors.border }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: posColor(pos), letterSpacing: 1 }}>{pos}</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: colors.value, marginTop: 2 }}>{fmt(score, 1)}</div>
              <div style={{ fontSize: 10, color: colors.label }}>{rankSuffix(rank)}/{totalTeams}</div>
              <div style={{ fontSize: 9, color: colors.label, opacity: 0.7 }}>z: {fmt(zv, 2)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <Section title="Scout Team" actions={
        <div style={{ display: "flex", gap: 8 }}>
          {["now", "farm"].map((m) => <PillBtn key={m} active={mode === m} onClick={() => setStrengthMode(m)}>{m === "now" ? "Now (MLB)" : "Farm"}</PillBtn>)}
        </div>
      }>
        <select value={scoutTeam} onChange={(e) => { setScoutTeam(e.target.value); setPage(0); }} style={{ ...S.filterSelect, fontSize: 14, padding: "8px 12px" }}>
          {data.teams.filter((t) => t !== myTeam).map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </Section>

      <Section title="Positional Strength Comparison">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(400px, 1fr))", gap: 24 }}>
          {renderStrengthCards(scoutZ, scoutRanks, scoutScores, scoutTeam)}
          {renderStrengthCards(myZ, myRanks, myScores, `${myTeam} (You)`)}
        </div>
        {tradeOpportunities.length > 0 && (
          <div style={{ marginTop: 16, padding: "10px 14px", background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.2)", borderRadius: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#86efac", marginBottom: 4 }}>Trade Opportunity Positions</div>
            <div style={{ fontSize: 11, color: "#94a3b8" }}>
              {scoutTeam} is strong where you're weak:{" "}
              {tradeOpportunities.map((pos, i) => (
                <span key={pos}>
                  {i > 0 && ", "}
                  <span style={{ color: posColor(pos), fontWeight: 700 }}>{pos}</span>
                  <span style={{ color: "#475569" }}> ({rankSuffix(scoutRanks[pos])} vs {rankSuffix(myRanks[pos])})</span>
                </span>
              ))}
            </div>
          </div>
        )}
      </Section>

      {tradeTargets.length > 0 && (
        <Section title={`Trade Targets (${tradeTargets.length})`}>
          <div style={{ fontSize: 11, color: "#475569", marginBottom: 8 }}>
            Players at positions where {myTeam} is below league average, sorted by fit score.
          </div>
          <div style={S.tableWrap}>
            <table style={S.table}>
              <thead><tr>
                {[{ k: "fit", l: "Fit", w: 65 }, { k: "name", l: "Name", w: 170 }, { k: "pos", l: "POS", w: 48 }, { k: "bestPos", l: "Best", w: 48 }, { k: "age", l: "Age", w: 50 }, { k: "level", l: "Lvl", w: 45 }, { k: "war", l: "WAR", w: 65 }, { k: "warP", l: "WAR P", w: 65 }, { k: "prone", l: "Prone", w: 65 }].map(({ k, l, w }) => (
                  <th key={k} style={{ ...S.th, width: w }}>{l}</th>
                ))}
              </tr></thead>
              <tbody>
                {tradeTargets.slice(0, 30).map((p, i) => (
                  <tr key={p.id + "-" + i} style={{ background: i % 2 === 0 ? "transparent" : "rgba(15,23,42,0.3)" }}>
                    <td style={{ ...S.td, ...warStyle(p.fit), fontWeight: 700 }}>{fmt(p.fit)}</td>
                    <td style={{ ...S.td, fontWeight: 600, color: "#e2e8f0", cursor: "pointer" }}
                        onClick={() => onSelectPlayer?.(p._original || p)}>{p.name}<TwoWayBadge player={p} /></td>
                    <td style={{ ...S.td, color: posColor(p.pos) }}>{p.pos}</td>
                    <td style={{ ...S.td, color: posColor((p.bestPos || "").replace("*", "")) }}>{p.bestPos || "—"}</td>
                    <td style={S.td}>{fmtAge(p.age)}</td>
                    <td style={{ ...S.td, color: levelColor(p.level) }}>{p.level}</td>
                    <td style={{ ...S.td, ...warStyle(p.war) }}>{fmt(p.war)}</td>
                    <td style={{ ...S.td, ...warStyle(p.warP) }}>{fmt(p.warP)}</td>
                    <td style={{ ...S.td, color: proneColor(p.prone) }}>{p.prone || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      <Section title={`${scoutTeam} Roster (${roster.length})`}>
        <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
          <PositionFilter value={posFilter} onChange={(v) => { setPosFilter(v); setPage(0); }} />
          <LevelFilter players={teamPlayersForFilter} value={rosterLevel} onChange={(v) => { setRosterLevel(v); setPage(0); }} expandRookieTeams />
        </div>
        <div style={S.tableWrap}>
          <table style={S.table}>
            <thead><tr>
              {[{ key: "name", label: "Name", w: 170 }, { key: "age", label: "Age", w: 50 }, { key: "pos", label: "POS", w: 50 }, { key: "bestPos", label: "Best", w: 50 }, { key: "bt", label: "B/T", w: 50 }, { key: "level", label: "Level", w: 55 }, { key: "on40", label: "40M", w: 45 }, { key: "fv", label: "FV", w: 60 }, { key: "war", label: "WAR", w: 65 }, { key: "warP", label: "WAR P", w: 65 }, { key: "devPct", label: "Dev%", w: 48 }, { key: "prone", label: "Prone", w: 65 }, { key: "fit", label: "Fit", w: 60 }, { key: "price", label: "Salary", w: 85 }].map(({ key, label, w }) => <SortHeader key={key} label={label} width={w} sortCol={rosterSort.col} sortDir={rosterSort.dir} colKey={key} onClick={() => toggleSort(key)} />)}
            </tr></thead>
            <tbody>
              {paged.map((p, i) => (
                <tr key={p.id + "-" + i} style={{ background: p.fit != null ? "rgba(34,197,94,0.04)" : i % 2 === 0 ? "transparent" : "rgba(15,23,42,0.3)" }}>
                  <td style={{ ...S.td, fontWeight: 600, color: "#e2e8f0", minWidth: 170, cursor: "pointer" }}
                      onClick={() => onSelectPlayer?.(p._original || p)}>{p.name}<TwoWayBadge player={p} /></td>
                  <td style={S.td}>{fmtAge(p.age)}</td>
                  <td style={{ ...S.td, color: posColor(p.pos) }}>{p.pos}</td>
                  <td style={{ ...S.td, color: posColor((p.bestPos || "").replace("*", "")) }}>{p.bestPos || "—"}</td>
                  <td style={S.td}>{p.bt}</td>
                  <td style={{ ...S.td, color: levelColor(p.level) }}>{p.level}</td>
                  <td style={S.td}>{p.on40 === "Yes" ? "✓" : ""}</td>
                  <td style={{ ...S.td, ...warStyle(p.fv) }}>{fmt(p.fv)}</td>
                  <td style={{ ...S.td, ...warStyle(p.war) }}>{fmt(p.war)}</td>
                  <td style={{ ...S.td, ...(p.matured ? { color: "#475569" } : warStyle(p.warP)) }}>{p.matured ? "—" : fmt(p.warP)}</td>
                  <td style={{ ...S.td, color: !p.matured && p.devPct != null ? devPctColor(p.devPct) : "#475569", fontWeight: !p.matured && p.devPct != null ? 600 : 400 }}>{!p.matured && p.devPct != null ? rankSuffix(Math.round(p.devPct * 100)) : "—"}</td>
                  <td style={{ ...S.td, color: proneColor(p.prone) }}>{p.prone || "—"}</td>
                  <td style={{ ...S.td, ...warStyle(p.fit), fontWeight: p.fit != null ? 700 : 400 }}>{p.fit != null ? fmt(p.fit) : ""}</td>
                  <td style={{ ...S.td, color: "#94a3b8" }}>{p.price != null ? "$" + p.price.toLocaleString() : "—"}</td>
                </tr>
              ))}
              {paged.length === 0 && <tr><td colSpan={14} style={{ ...S.td, textAlign: "center", color: "#475569" }}>No players found</td></tr>}
            </tbody>
          </table>
        </div>
        <Pagination page={page} totalPages={totalPages} total={roster.length} onPrev={() => setPage(Math.max(0, page - 1))} onNext={() => setPage(Math.min(totalPages - 1, page + 1))} />
      </Section>
    </div>
  );
}

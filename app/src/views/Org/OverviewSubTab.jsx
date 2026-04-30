import { useState, useMemo } from "react";
import { S, posColor, levelColor, proneColor, waaStyle, devPctColor, zToColor } from "../../theme.js";
import { fmt, fmtAge, paginateRows, toRosterRow, sortRosterRows, rankSuffix } from "../../utils/helpers.js";
import { ALL_DISPLAY_POS, POT_DISPLAY_POS, DEPTH_N, DEPTH_N_POT, PER_PAGE } from "../../utils/constants.js";
import { passesPositionFilter, passesLevelFilter } from "../../utils/accessors.js";
import { Section, SortHeader, PillBtn, PositionFilter, LevelFilter, TwoWayBadge, Pagination } from "../../components/shared.jsx";

export default function OverviewSubTab({
  data, team, teamHitters, teamPitchers,
  strength, strengthMode, setStrengthMode,
  onSelectPlayer,
}) {
  const [rosterLevel, setRosterLevel] = useState([]);
  const [rosterSort, setRosterSort] = useState({ col: "waa", dir: "desc" });
  const [prospectSort, setProspectSort] = useState({ col: "MAX WAA P", dir: "desc" });
  const [prospectPage, setProspectPage] = useState(0);
  const [posFilter, setPosFilter] = useState([]);

  const mode = strengthMode;
  const teamZ = strength.zScores[mode]?.[team] || {};
  const teamRanks = strength.ranks[mode]?.[team] || {};
  const teamScores = strength.teamScores[team]?.[mode] || {};
  const totalTeams = data.teams.length;
  const teamPlayersForFilter = useMemo(() => [...teamHitters, ...teamPitchers], [teamHitters, teamPitchers]);

  const roster = useMemo(() => {
    let players = [
      ...teamHitters.map((h) => toRosterRow(h, "hitter", { on40: h.meta?.on40 ?? h.ON40, price: h._price })),
      ...teamPitchers.map((p) => toRosterRow(p, "pitcher", { on40: p.meta?.on40 ?? p.ON40, price: p._price })),
    ];
    if (posFilter.length > 0) players = players.filter((p) => passesPositionFilter(p._original, posFilter));
    if (rosterLevel.length > 0) players = players.filter((p) => passesLevelFilter(p._original, rosterLevel));
    sortRosterRows(players, rosterSort.col, rosterSort.dir);
    return players;
  }, [teamHitters, teamPitchers, rosterLevel, rosterSort, posFilter]);

  const prospects = useMemo(() => {
    const h = teamHitters.filter((p) => p._age != null && p._age <= 25 && (p.meta?.lev ?? p.Lev) !== "MLB").map((p) => toRosterRow(p, "hitter"));
    const pi = teamPitchers.filter((p) => p._age != null && p._age <= 25 && (p.meta?.lev ?? p.Lev) !== "MLB").map((p) => toRosterRow(p, "pitcher"));
    let all = [...h, ...pi];
    const PROSPECT_COL_MAP = { "MAX WAA P": (p) => p.waaP, "Max WAA wtd": (p) => p.waa, devPct: (p) => p.devPct, fv: (p) => p.fv };
    sortRosterRows(all, prospectSort.col, prospectSort.dir, PROSPECT_COL_MAP);
    return all;
  }, [teamHitters, teamPitchers, prospectSort]);

  const toggleSort = (setter) => (col) => setter((prev) => ({ col, dir: prev.col === col && prev.dir === "desc" ? "asc" : "desc" }));

  return (
    <>
      <Section title="Positional Strength">
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          {["current", "potential"].map((m) => <PillBtn key={m} active={mode === m} onClick={() => setStrengthMode(m)}>{m === "current" ? "Current" : "Potential"}</PillBtn>)}
        </div>
        <div style={S.strengthGrid}>
          {(mode === "potential" ? POT_DISPLAY_POS : ALL_DISPLAY_POS).map((pos) => {
            const z = teamZ[pos]; const rank = teamRanks[pos]; const score = teamScores[pos]; const colors = zToColor(z);
            return (<div key={pos} style={{ ...S.strengthCard, background: colors.bg, borderColor: colors.border }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", letterSpacing: 1.5, textTransform: "uppercase" }}>{pos}</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: colors.value, marginTop: 2 }}>{fmt(score, 1)}</div>
              <div style={{ fontSize: 11, color: colors.label, marginTop: 2 }}>{rankSuffix(rank)} of {totalTeams}</div>
              <div style={{ fontSize: 10, color: colors.label, opacity: 0.7, marginTop: 1 }}>z: {fmt(z, 2)}</div>
            </div>);
          })}
        </div>
        <div style={{ fontSize: 11, color: "#475569", marginTop: 8 }}>
          {mode === "current" ? `Two-pass: starters first (C→SS→CF→2B→3B→LF→RF→1B→DH), then depth. Depth: ${Object.entries(DEPTH_N).map(([k,v])=>`${v} ${k}`).join(", ")}.` : `Single-pass (C→SS→CF→2B→3B→LF→RF→1B) — full depth per position. Depth: ${Object.entries(DEPTH_N_POT).map(([k,v])=>`${v} ${k}`).join(", ")}. SP first, RP from non-SP.`}
        </div>
      </Section>

      <Section title={`${team} Roster`}>
        <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
          <PositionFilter value={posFilter} onChange={setPosFilter} />
          <LevelFilter players={teamPlayersForFilter} value={rosterLevel} onChange={setRosterLevel} expandRookieTeams />
        </div>
        <div style={S.tableWrap}><table style={S.table}><thead><tr>
          {[{ key: "name", label: "Name", w: 180 }, { key: "age", label: "Age", w: 50 }, { key: "pos", label: "POS", w: 50 }, { key: "bestPos", label: "Best", w: 50 }, { key: "bt", label: "B/T", w: 50 }, { key: "level", label: "Level", w: 55 }, { key: "on40", label: "40M", w: 45 }, { key: "fv", label: "FV", w: 60 }, { key: "waa", label: "WAA", w: 70 }, { key: "waaP", label: "WAA P", w: 70 }, { key: "devPct", label: "Dev%", w: 48 }, { key: "prone", label: "Prone", w: 70 }, { key: "price", label: "Salary", w: 90 }].map(({ key, label, w }) => <SortHeader key={key} label={label} width={w} sortCol={rosterSort.col} sortDir={rosterSort.dir} colKey={key} onClick={() => toggleSort(setRosterSort)(key)} />)}
        </tr></thead><tbody>
          {roster.map((p, i) => (
            <tr key={p.id + "-" + i} style={{ background: i % 2 === 0 ? "transparent" : "rgba(15,23,42,0.3)" }}>
              <td style={{ ...S.td, fontWeight: 600, color: "#e2e8f0", minWidth: 180, cursor: "pointer" }}
                  onClick={() => onSelectPlayer?.(p._original || p)}>{p.name}<TwoWayBadge player={p} /></td>
              <td style={S.td}>{fmtAge(p.age)}</td><td style={{ ...S.td, color: posColor(p.pos) }}>{p.pos}</td>
              <td style={{ ...S.td, color: posColor((p.bestPos || "").replace("*", "")) }}>{p.bestPos || "—"}</td>
              <td style={S.td}>{p.bt}</td><td style={{ ...S.td, color: levelColor(p.level) }}>{p.level}</td>
              <td style={S.td}>{p.on40 === "Yes" ? "✓" : ""}</td>
              <td style={{ ...S.td, ...waaStyle(p.fv) }}>{fmt(p.fv)}</td>
              <td style={{ ...S.td, ...waaStyle(p.waa) }}>{fmt(p.waa)}</td>
              <td style={{ ...S.td, ...(p.matured ? { color: "#475569" } : waaStyle(p.waaP)) }}>{p.matured ? "—" : fmt(p.waaP)}</td>
              <td style={{ ...S.td, color: !p.matured && p.devPct != null ? devPctColor(p.devPct) : "#475569", fontWeight: !p.matured && p.devPct != null ? 600 : 400 }}>{!p.matured && p.devPct != null ? Math.round(p.devPct * 100) + "th" : "—"}</td>
              <td style={{ ...S.td, color: proneColor(p.prone) }}>{p.prone}</td>
              <td style={{ ...S.td, color: "#94a3b8" }}>{p.price != null ? "$" + p.price.toLocaleString() : "—"}</td>
            </tr>
          ))}
          {roster.length === 0 && <tr><td colSpan={13} style={{ ...S.td, textAlign: "center", color: "#475569" }}>No players found</td></tr>}
        </tbody></table></div>
        <div style={{ fontSize: 11, color: "#475569", marginTop: 4 }}>{roster.length} players</div>
      </Section>

      <Section title={`Prospect Watch (${prospects.length})`}>
        <div style={S.tableWrap}><table style={S.table}><thead><tr>
          {[{ key: "name", label: "Name", w: 180 }, { key: "age", label: "Age", w: 50 }, { key: "devPct", label: "Dev%", w: 48 }, { key: "pos", label: "POS", w: 50 }, { key: "level", label: "Level", w: 55 }, { key: "fv", label: "FV", w: 60 }, { key: "Max WAA wtd", label: "Current", w: 80 }, { key: "MAX WAA P", label: "Potential", w: 80 }, { key: "prone", label: "Prone", w: 70 }].map(({ key, label, w }) => <SortHeader key={key} label={label} width={w} sortCol={prospectSort.col} sortDir={prospectSort.dir} colKey={key} onClick={() => toggleSort(setProspectSort)(key)} />)}
        </tr></thead><tbody>
          {paginateRows(prospects, prospectPage, PER_PAGE).paged.map((p, i) => (
            <tr key={p.id + "-" + i} style={{ background: i % 2 === 0 ? "transparent" : "rgba(15,23,42,0.3)" }}>
              <td style={{ ...S.td, fontWeight: 600, color: "#e2e8f0", minWidth: 180, cursor: "pointer" }}
                  onClick={() => onSelectPlayer?.(p._original || p)}>{p.name}<TwoWayBadge player={p} /></td>
              <td style={S.td}>{fmtAge(p.age)}</td>
              <td style={{ ...S.td, color: !p.matured && p.devPct != null ? devPctColor(p.devPct) : "#475569", fontWeight: !p.matured && p.devPct != null ? 600 : 400 }}>{!p.matured && p.devPct != null ? Math.round(p.devPct * 100) + "th" : "—"}</td>
              <td style={{ ...S.td, color: posColor(p.pos) }}>{p.pos}</td>
              <td style={{ ...S.td, color: levelColor(p.level) }}>{p.level}</td>
              <td style={{ ...S.td, ...waaStyle(p.fv) }}>{fmt(p.fv)}</td>
              <td style={{ ...S.td, ...waaStyle(p.waa) }}>{fmt(p.waa)}</td>
              <td style={{ ...S.td, ...(p.matured ? { color: "#475569" } : waaStyle(p.waaP)) }}>{p.matured ? "—" : fmt(p.waaP)}</td>
              <td style={{ ...S.td, color: proneColor(p.prone) }}>{p.prone}</td>
            </tr>
          ))}
          {prospects.length === 0 && <tr><td colSpan={9} style={{ ...S.td, textAlign: "center", color: "#475569" }}>No prospects found</td></tr>}
        </tbody></table></div>
        {(() => { const { totalPages } = paginateRows(prospects, prospectPage, PER_PAGE); return totalPages > 1 ? <Pagination page={prospectPage} totalPages={totalPages} total={prospects.length} onPrev={() => setProspectPage(Math.max(0, prospectPage - 1))} onNext={() => setProspectPage(Math.min(totalPages - 1, prospectPage + 1))} /> : <div style={{ fontSize: 11, color: "#475569", marginTop: 4 }}>{prospects.length} prospects</div>; })()}
      </Section>
    </>
  );
}

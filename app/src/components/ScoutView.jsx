import { useState, useMemo } from "react";
import { S } from "../theme.js";
import { posColor, levelColor, proneColor, warStyle, devPctColor } from "../theme.js";
import { fmt, fmtAge, toRosterRow, sortRosterRows, rankSuffix, paginateRows } from "../utils/helpers.js";
import { POT_DISPLAY_POS, PER_PAGE } from "../utils/constants.js";
import { passesPositionFilter, passesLevelFilter } from "../utils/accessors.js";
import { calcOrgNeed } from "../utils/strength.js";
import { Section, SortHeader, PillBtn, PositionFilter, LevelFilter, Toggle, TwoWayBadge, Pagination } from "./shared.jsx";
import PositionalStrengthTable from "../views/Org/PositionalStrengthTable.jsx";
import { buildBoardPool, buildDisplayPool } from "./boardUtils.js";

export default function ScoutView({ data, myTeam, strength, strengthMode, setStrengthMode, curveSettings, onSelectPlayer }) {
  const [scoutTeam, setScoutTeam] = useState(() => data.teams.find((t) => t !== myTeam) || data.teams[0]);
  const [rosterLevel, setRosterLevel] = useState([]);
  const [posFilter, setPosFilter] = useState([]);
  const [rosterSort, setRosterSort] = useState({ col: "_rank", dir: "desc" });
  const [page, setPage] = useState(0);
  const [toggles, setToggles] = useState({ orgNeed: false, devAdj: false, injury: false, intangibles: false });
  const setToggle = (key) => setToggles((t) => ({ ...t, [key]: !t[key] }));
  const anyToggle = toggles.orgNeed || toggles.devAdj || toggles.injury || toggles.intangibles;

  const mode = strengthMode;
  const orgNeed = useMemo(() => calcOrgNeed(myTeam, strength, mode), [myTeam, strength, mode]);

  const scoutZ = strength.zScores[mode]?.[scoutTeam] || {};
  const scoutRanks = strength.ranks[mode]?.[scoutTeam] || {};

  const myZ = strength.zScores[mode]?.[myTeam] || {};
  const myRanks = strength.ranks[mode]?.[myTeam] || {};

  const positions = POT_DISPLAY_POS;
  const weakPos = useMemo(() => new Set(positions.filter((pos) => (myZ[pos] ?? 0) < 0)), [positions, myZ]);

  const tradeOpportunities = useMemo(() =>
    positions.filter((pos) => {
      const theirs = scoutZ[pos] ?? 0, ours = myZ[pos] ?? 0;
      return theirs > 0 && ours < 0 && (theirs - ours) >= 1.0;
    }),
    [positions, scoutZ, myZ]
  );

  const teamHitters = useMemo(() => data.hitters.filter((h) => (h.meta?.org ?? h.ORG) === scoutTeam), [data.hitters, scoutTeam]);
  const teamPitchers = useMemo(() => data.pitchers.filter((p) => (p.meta?.org ?? p.ORG) === scoutTeam), [data.pitchers, scoutTeam]);

  // Enriched scout pool — same shape Draft/IAFA/R5 feed into applySmartRank.
  // `_rank` per player becomes the trade Fit score (additive: FV + bonuses).
  const scoutPool = useMemo(() => {
    if (!scoutTeam) return [];
    const isScoutH = (h) => (h.meta?.org ?? h.ORG) === scoutTeam;
    const isScoutP = (p) => (p.meta?.org ?? p.ORG) === scoutTeam;
    return buildBoardPool(data, isScoutH, isScoutP);
  }, [data, scoutTeam]);

  const displayScoutPool = useMemo(() =>
    buildDisplayPool(scoutPool, "", [], { col: "_rank", dir: "desc" }, toggles, orgNeed, curveSettings, null),
    [scoutPool, toggles, orgNeed, curveSettings]
  );

  // Lookup: player _uid -> smart-rank fit. baseRosterRows attaches _rank via this map.
  const rankByUid = useMemo(() => {
    const m = new Map();
    for (const p of displayScoutPool) m.set(p._uid, p._rank);
    return m;
  }, [displayScoutPool]);

  const baseRosterRows = useMemo(() => [
    ...teamHitters.map((h) => toRosterRow(h, "hitter", { on40: h.meta?.on40 ?? h.ON40, price: h._price, _rank: rankByUid.get(h._uid) ?? null })),
    ...teamPitchers.map((p) => toRosterRow(p, "pitcher", { on40: p.meta?.on40 ?? p.ON40, price: p._price, _rank: rankByUid.get(p._uid) ?? null })),
  ], [teamHitters, teamPitchers, rankByUid]);

  const teamPlayersForFilter = useMemo(() => [...teamHitters, ...teamPitchers], [teamHitters, teamPitchers]);

  const roster = useMemo(() => {
    let players = baseRosterRows;
    if (posFilter.length > 0) players = players.filter((p) => passesPositionFilter(p._original, posFilter));
    if (rosterLevel.length > 0) players = players.filter((p) => passesLevelFilter(p._original, rosterLevel));
    players = [...players];
    sortRosterRows(players, rosterSort.col, rosterSort.dir);
    return players;
  }, [baseRosterRows, rosterLevel, rosterSort, posFilter]);

  const { paged, totalPages } = paginateRows(roster, page, PER_PAGE);

  // Trade Targets = scouted-team players at MY weak positions, ranked by smart-rank fit.
  const tradeTargets = useMemo(() => {
    return baseRosterRows
      .filter((p) => weakPos.has(p.pos) && p._rank != null && p._rank > 0)
      .sort((a, b) => b._rank - a._rank);
  }, [baseRosterRows, weakPos]);

  const toggleSort = (col) => setRosterSort((prev) => ({ col, dir: prev.col === col && prev.dir === "desc" ? "asc" : "desc" }));
  const fitLabel = anyToggle ? "Smart" : "Fit";

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

      <Section title="Smart Rank Adjustments">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          <Toggle label="Future Value" description="Use FV (cur + age-weighted gap) instead of raw potential" checked={toggles.devAdj} onChange={() => setToggle("devAdj")} />
          <Toggle label="Org Positional Need" description="Boost players at your org's weak positions" checked={toggles.orgNeed} onChange={() => setToggle("orgNeed")} />
          <Toggle label="Injury Proneness" description="Bonus for Iron Man / Durable, penalty for Fragile / Wrecked" checked={toggles.injury} onChange={() => setToggle("injury")} />
          <Toggle label="Intangibles" description="Bonus for elite 20-80 intangible grades, penalty for poor ones" checked={toggles.intangibles} onChange={() => setToggle("intangibles")} />
        </div>
      </Section>

      <Section title="Positional Strength Comparison">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(400px, 1fr))", gap: 24 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0", marginBottom: 8 }}>{scoutTeam}</div>
            <PositionalStrengthTable
              team={scoutTeam}
              strength={strength}
              mode={mode}
              sort="weakest"
              sortRefTeam={myTeam}
              compact
            />
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0", marginBottom: 8 }}>{myTeam} (You)</div>
            <PositionalStrengthTable
              team={myTeam}
              strength={strength}
              mode={mode}
              sort="weakest"
              sortRefTeam={myTeam}
              compact
            />
          </div>
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
            Players at positions where {myTeam} is below league average, sorted by {fitLabel.toLowerCase()} score.
          </div>
          <div style={S.tableWrap}>
            <table style={S.table}>
              <thead><tr>
                {[{ k: "_rank", l: fitLabel, w: 65 }, { k: "name", l: "Name", w: 170 }, { k: "pos", l: "POS", w: 48 }, { k: "bestPos", l: "Best", w: 48 }, { k: "age", l: "Age", w: 45 }, { k: "level", l: "Lvl", w: 45 }, { k: "war", l: "WAR", w: 65 }, { k: "warP", l: "WAR P", w: 65 }, { k: "prone", l: "Prone", w: 65 }].map(({ k, l, w }) => (
                  <th key={k} style={{ ...S.th, width: w }}>{l}</th>
                ))}
              </tr></thead>
              <tbody>
                {tradeTargets.slice(0, 30).map((p, i) => (
                  <tr key={p.id + "-" + i} style={{ background: i % 2 === 0 ? "transparent" : "rgba(15,23,42,0.3)" }}>
                    <td style={{ ...S.td, ...warStyle(p._rank), fontWeight: 700 }}>{fmt(p._rank)}</td>
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
              {[{ key: "name", label: "Name", w: 170 }, { key: "age", label: "Age", w: 45 }, { key: "pos", label: "POS", w: 48 }, { key: "bestPos", label: "Best", w: 48 }, { key: "bt", label: "B/T", w: 50 }, { key: "level", label: "Lvl", w: 45 }, { key: "on40", label: "40M", w: 45 }, { key: "fv", label: "FV", w: 60 }, { key: "war", label: "WAR", w: 65 }, { key: "warP", label: "WAR P", w: 65 }, { key: "devPct", label: "Dev%", w: 48 }, { key: "prone", label: "Prone", w: 65 }, { key: "_rank", label: fitLabel, w: 60 }, { key: "price", label: "Salary", w: 85 }].map(({ key, label, w }) => <SortHeader key={key} label={label} width={w} sortCol={rosterSort.col} sortDir={rosterSort.dir} colKey={key} onClick={() => toggleSort(key)} />)}
            </tr></thead>
            <tbody>
              {paged.map((p, i) => {
                const isTradeFit = weakPos.has(p.pos);
                return (
                <tr key={p.id + "-" + i} style={{ background: isTradeFit ? "rgba(34,197,94,0.04)" : i % 2 === 0 ? "transparent" : "rgba(15,23,42,0.3)" }}>
                  <td style={{ ...S.td, fontWeight: 600, color: "#e2e8f0", minWidth: 170, cursor: "pointer" }}
                      onClick={() => onSelectPlayer?.(p._original || p)}>{p.name}<TwoWayBadge player={p} /></td>
                  <td style={S.td}>{fmtAge(p.age)}</td>
                  <td style={{ ...S.td, color: posColor(p.pos) }}>{p.pos}</td>
                  <td style={{ ...S.td, color: posColor((p.bestPos || "").replace("*", "")) }}>{p.bestPos || "—"}</td>
                  <td style={S.td}>{p.bt}</td>
                  <td style={{ ...S.td, color: levelColor(p.level) }}>{p.level}</td>
                  <td style={S.td}>{p.on40 === true || p.on40 === "Yes" ? "✓" : ""}</td>
                  <td style={{ ...S.td, ...warStyle(p.fv) }}>{fmt(p.fv)}</td>
                  <td style={{ ...S.td, ...warStyle(p.war) }}>{fmt(p.war)}</td>
                  <td style={{ ...S.td, ...(p.matured ? { color: "#475569" } : warStyle(p.warP)) }}>{p.matured ? "—" : fmt(p.warP)}</td>
                  <td style={{ ...S.td, color: !p.matured && p.devPct != null ? devPctColor(p.devPct) : "#475569", fontWeight: !p.matured && p.devPct != null ? 600 : 400 }}>{!p.matured && p.devPct != null ? rankSuffix(Math.round(p.devPct * 100)) : "—"}</td>
                  <td style={{ ...S.td, color: proneColor(p.prone) }}>{p.prone || "—"}</td>
                  <td style={{ ...S.td, ...warStyle(p._rank), fontWeight: 700 }}>{p._rank != null ? fmt(p._rank) : "—"}</td>
                  <td style={{ ...S.td, color: "#94a3b8" }}>{p.price != null ? "$" + p.price.toLocaleString() : "—"}</td>
                </tr>
                );
              })}
              {paged.length === 0 && <tr><td colSpan={14} style={{ ...S.td, textAlign: "center", color: "#475569" }}>No players found</td></tr>}
            </tbody>
          </table>
        </div>
        <Pagination page={page} totalPages={totalPages} total={roster.length} onPrev={() => setPage(Math.max(0, page - 1))} onNext={() => setPage(Math.min(totalPages - 1, page + 1))} />
      </Section>
    </div>
  );
}

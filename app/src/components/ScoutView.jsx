import { useState, useMemo } from "react";
import { S, TOKENS as T } from "../theme.js";
import { posColor, levelChip, proneColor, warStyle, devPctColor } from "../theme.js";
import { fmt, fmtAge, toRosterRow, sortRosterRows, rankSuffix, paginateRows } from "../utils/helpers.js";
import { POT_DISPLAY_POS, PER_PAGE } from "../utils/constants.js";
import { passesPositionFilter, passesLevelFilter } from "../utils/accessors.js";
import { calcOrgNeed } from "../utils/strength.js";
import { Section, SortHeader, PillBtn, PositionFilter, LevelFilter, Toggle, TwoWayBadge, Pagination, colRule } from "./shared.jsx";
import PositionalStrengthTable from "../views/Org/PositionalStrengthTable.jsx";
import { buildBoardPool, buildDisplayPool } from "./boardUtils.js";

// Column definitions (§B.3 item 7): identity | value | development | health (Prone · Fit · Salary).
const TRADE_TARGET_COLS = (fitLabel) => [
  { k: "_rank", l: fitLabel, w: 65, group: "identity", num: true }, { k: "name", l: "Name", w: 170, group: "identity" }, { k: "pos", l: "POS", w: 48, group: "identity" }, { k: "bestPos", l: "Best", w: 48, group: "identity" }, { k: "age", l: "Age", w: 45, group: "identity", num: true }, { k: "level", l: "Lvl", w: 45, group: "identity" },
  { k: "war", l: "WAR", w: 65, group: "value", num: true }, { k: "warP", l: "WAR P", w: 65, group: "value", num: true },
  { k: "prone", l: "Prone", w: 65, group: "health" },
];
const ROSTER_COLS = (fitLabel) => [
  { key: "name", label: "Name", w: 170, group: "identity" }, { key: "age", label: "Age", w: 45, group: "identity", num: true }, { key: "pos", label: "POS", w: 48, group: "identity" }, { key: "bestPos", label: "Best", w: 48, group: "identity" }, { key: "bt", label: "B/T", w: 50, group: "identity" }, { key: "level", label: "Lvl", w: 45, group: "identity" }, { key: "on40", label: "40M", w: 45, group: "identity" },
  { key: "fv", label: "FV", w: 60, group: "value", num: true }, { key: "war", label: "WAR", w: 65, group: "value", num: true }, { key: "warP", label: "WAR P", w: 65, group: "value", num: true },
  { key: "devPct", label: "Dev%", w: 48, group: "development", num: true },
  { key: "prone", label: "Prone", w: 65, group: "health" }, { key: "_rank", label: fitLabel, w: 60, group: "health", num: true }, { key: "price", label: "Salary", w: 85, group: "health", num: true },
];
// levelChip() returns { bg, text, border[, borderStyle] } — map it onto the S.badge CSS keys.
const chipCss = (c) => ({ background: c.bg, color: c.text, borderColor: c.border, ...(c.borderStyle ? { borderStyle: c.borderStyle } : {}) });
const posText = { fontFamily: T.fonts.narrow, fontWeight: 600 };

export default function ScoutView({ data, myTeam, strength, strengthMode, setStrengthMode, curveSettings, onSelectPlayer }) {
  const [scoutTeam, setScoutTeam] = useState(() => data.teams.find((t) => t !== myTeam) || data.teams[0]);
  const [rosterLevel, setRosterLevel] = useState([]);
  const [posFilter, setPosFilter] = useState([]);
  const [rosterSort, setRosterSort] = useState({ col: "_rank", dir: "desc" });
  const [page, setPage] = useState(0);
  const [toggles, setToggles] = useState({ orgNeed: false, devAdj: false, injury: false, intangibles: false });
  const setToggle = (key) => setToggles((t) => ({ ...t, [key]: !t[key] }));
  const anyToggle = toggles.orgNeed || toggles.devAdj || toggles.injury || toggles.intangibles;
  const togglesOn = [toggles.orgNeed, toggles.devAdj, toggles.injury, toggles.intangibles].filter(Boolean).length;

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
  const ttCols = TRADE_TARGET_COLS(fitLabel);
  const rosterCols = ROSTER_COLS(fitLabel);
  const rosterSortLabel = rosterCols.find((c) => c.key === rosterSort.col)?.label ?? rosterSort.col;
  const numTd = (c) => (c.num ? { textAlign: "right" } : {});
  const tableBody = (children) => (
    <div style={{ margin: -12 }}>{children}</div>
  );
  const edgeWrap = { ...S.tableWrap, border: "none", borderRadius: 0 };
  const subhead = { fontFamily: T.fonts.narrow, fontSize: 13, fontWeight: 700, color: T.text, marginBottom: 8 };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 2fr) minmax(300px, 1fr)", gap: 16, alignItems: "stretch" }}>
        <Section title="Positional Strength Comparison" state={mode === "now" ? "Now (MLB) · z vs league" : "Farm · z vs league"}
          toolbar={
            <>
              <label style={{ fontFamily: T.fonts.narrow, fontWeight: 600, fontSize: 12.5, color: T.text2 }}>Scout team</label>
              <select value={scoutTeam} onChange={(e) => { setScoutTeam(e.target.value); setPage(0); }} aria-label="Scout team" style={{ ...S.filterSelect, minWidth: 180 }}>
                {data.teams.filter((t) => t !== myTeam).map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <div style={{ display: "flex", gap: 6, marginLeft: "auto" }} role="tablist" aria-label="Strength pool">
                {["now", "farm"].map((m) => <PillBtn key={m} active={mode === m} onClick={() => setStrengthMode(m)}>{m === "now" ? "Now (MLB)" : "Farm"}</PillBtn>)}
              </div>
            </>
          }>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 24 }}>
            <div>
              <div style={subhead}>{scoutTeam}</div>
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
              <div style={subhead}>{myTeam} <span style={{ color: T.text3, fontWeight: 500 }}>(you)</span></div>
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
            <div style={{ marginTop: 14, padding: "8px 12px", background: T.goodBg, border: `1px solid ${T.good}`, borderRadius: T.radius }}>
              <div style={{ fontFamily: T.fonts.narrow, fontSize: 12.5, fontWeight: 700, color: T.good, marginBottom: 2 }}>Trade opportunity positions</div>
              <div style={{ fontSize: 12, color: T.text2 }}>
                {scoutTeam} is strong where you're weak:{" "}
                {tradeOpportunities.map((pos, i) => (
                  <span key={pos}>
                    {i > 0 && ", "}
                    <span style={{ color: posColor(pos), fontWeight: 700 }}>{pos}</span>
                    <span style={{ color: T.text3 }}> ({rankSuffix(scoutRanks[pos])} vs {rankSuffix(myRanks[pos])})</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </Section>

        <Section title="Smart Rank Adjustments" state={`${togglesOn} of 4 on`}>
          <div style={{ margin: -12 }}>
            <Toggle variant="row" label="Future Value" description="Use FV (cur + age-weighted gap) instead of raw potential" checked={toggles.devAdj} onChange={() => setToggle("devAdj")} />
            <Toggle variant="row" label="Org Positional Need" description="Boost players at your org's weak positions" checked={toggles.orgNeed} onChange={() => setToggle("orgNeed")} />
            <Toggle variant="row" label="Injury Proneness" description="Bonus for Iron Man / Durable, penalty for Fragile / Wrecked" checked={toggles.injury} onChange={() => setToggle("injury")} />
            <Toggle variant="row" label="Intangibles" description="Bonus for elite 20-80 intangible grades, penalty for poor ones" checked={toggles.intangibles} onChange={() => setToggle("intangibles")} />
          </div>
        </Section>
      </div>

      {tradeTargets.length > 0 && (
        <Section title="Trade Targets" count={`(${tradeTargets.length})`} state={`Sorted by ${fitLabel}, descending`}
          footer={<>Players at positions where {myTeam} is below league average, sorted by {fitLabel.toLowerCase()} score. Showing the top {Math.min(30, tradeTargets.length)}.</>}>
          {tableBody(
            <div style={edgeWrap}>
              <table style={S.table}>
                <thead><tr>
                  {ttCols.map((c, ci) => (
                    <th key={c.k} style={{ ...S.th, ...(colRule(ttCols, ci) || {}), ...numTd(c), width: c.w }}>{c.l}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {tradeTargets.slice(0, 30).map((p, i) => {
                    const td = (ci, extra) => ({ ...S.td, ...(colRule(ttCols, ci) || {}), ...numTd(ttCols[ci]), ...extra });
                    return (
                    <tr key={p.id + "-" + i} style={i % 2 === 1 ? S.zebraRow : undefined}>
                      <td style={td(0, { ...warStyle(p._rank), fontWeight: 700 })}>{fmt(p._rank)}</td>
                      <td style={td(1, { ...S.tdName, cursor: "pointer" })}
                          onClick={() => onSelectPlayer?.(p._original || p)}>{p.name}<TwoWayBadge player={p} /></td>
                      <td style={td(2, { ...posText, color: posColor(p.pos) })}>{p.pos}</td>
                      <td style={td(3, { ...posText, color: posColor((p.bestPos || "").replace("*", "")) })}>{p.bestPos || "—"}</td>
                      <td style={td(4, { color: T.text2 })}>{fmtAge(p.age)}</td>
                      <td style={td(5)}>{p.level ? <span style={{ ...S.badge, ...chipCss(levelChip(p.level)) }}>{p.level}</span> : <span style={{ color: T.textDisabled }}>—</span>}</td>
                      <td style={td(6, warStyle(p.war))}>{fmt(p.war)}</td>
                      <td style={td(7, warStyle(p.warP))}>{fmt(p.warP)}</td>
                      <td style={td(8, { color: p.prone ? proneColor(p.prone) : T.textDisabled })}>{p.prone || "—"}</td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      )}

      <Section title={`${scoutTeam} Roster`} count={`(${roster.length})`} state={`Sorted by ${rosterSortLabel}, ${rosterSort.dir === "desc" ? "descending" : "ascending"}`}
        toolbar={
          <>
            <PositionFilter value={posFilter} onChange={(v) => { setPosFilter(v); setPage(0); }} />
            <LevelFilter players={teamPlayersForFilter} value={rosterLevel} onChange={(v) => { setRosterLevel(v); setPage(0); }} expandRookieTeams />
            {weakPos.size > 0 && <span style={{ marginLeft: "auto", fontFamily: T.fonts.narrow, fontSize: 12, color: T.text3 }}><span style={{ display: "inline-block", width: 10, height: 10, background: T.goodBg, border: `1px solid ${T.good}`, borderRadius: 2, verticalAlign: -1, marginRight: 5 }} />Trade-fit row: at a position where {myTeam} is below league average</span>}
          </>
        }>
        {tableBody(
          <>
            <div style={edgeWrap}>
              <table style={S.table}>
                <thead><tr>
                  {rosterCols.map((c, ci) => <SortHeader key={c.key} label={c.label} width={c.w} sortCol={rosterSort.col} sortDir={rosterSort.dir} colKey={c.key} rule={colRule(rosterCols, ci)} align={c.num ? "right" : undefined} onClick={() => toggleSort(c.key)} />)}
                </tr></thead>
                <tbody>
                  {paged.map((p, i) => {
                    const isTradeFit = weakPos.has(p.pos);
                    const td = (ci, extra) => ({ ...S.td, ...(colRule(rosterCols, ci) || {}), ...numTd(rosterCols[ci]), ...extra });
                    return (
                    <tr key={p.id + "-" + i} style={isTradeFit ? { background: T.goodBg } : i % 2 === 1 ? S.zebraRow : undefined}>
                      <td style={td(0, { ...S.tdName, minWidth: 170, cursor: "pointer" })}
                          onClick={() => onSelectPlayer?.(p._original || p)}>{p.name}<TwoWayBadge player={p} /></td>
                      <td style={td(1, { color: T.text2 })}>{fmtAge(p.age)}</td>
                      <td style={td(2, { ...posText, color: posColor(p.pos) })}>{p.pos}</td>
                      <td style={td(3, { ...posText, color: posColor((p.bestPos || "").replace("*", "")) })}>{p.bestPos || "—"}</td>
                      <td style={td(4, { color: T.text2 })}>{p.bt}</td>
                      <td style={td(5)}>{p.level ? <span style={{ ...S.badge, ...chipCss(levelChip(p.level)) }}>{p.level}</span> : <span style={{ color: T.textDisabled }}>—</span>}</td>
                      <td style={td(6, { color: T.text2 })}>{p.on40 === true || p.on40 === "Yes" ? "✓" : ""}</td>
                      <td style={td(7, warStyle(p.fv))}>{fmt(p.fv)}</td>
                      <td style={td(8, warStyle(p.war))}>{fmt(p.war)}</td>
                      <td style={td(9, p.matured ? { color: T.textDisabled } : warStyle(p.warP))}>{p.matured ? "—" : fmt(p.warP)}</td>
                      <td style={td(10, { color: !p.matured && p.devPct != null ? devPctColor(p.devPct) : T.textDisabled, fontWeight: !p.matured && p.devPct != null ? 600 : 400 })}>{!p.matured && p.devPct != null ? rankSuffix(Math.round(p.devPct * 100)) : "—"}</td>
                      <td style={td(11, { color: p.prone ? proneColor(p.prone) : T.textDisabled })}>{p.prone || "—"}</td>
                      <td style={td(12, p._rank != null ? { ...warStyle(p._rank), fontWeight: 700 } : { color: T.textDisabled })}>{p._rank != null ? fmt(p._rank) : "—"}</td>
                      <td style={td(13, { color: p.price != null ? T.text2 : T.textDisabled })}>{p.price != null ? "$" + p.price.toLocaleString() : "—"}</td>
                    </tr>
                    );
                  })}
                  {paged.length === 0 && <tr><td colSpan={rosterCols.length} style={{ ...S.td, textAlign: "center", color: T.text3 }}>No players found</td></tr>}
                </tbody>
              </table>
            </div>
            <Pagination page={page} totalPages={totalPages} total={roster.length} onPrev={() => setPage(Math.max(0, page - 1))} onNext={() => setPage(Math.min(totalPages - 1, page + 1))} />
          </>
        )}
      </Section>
    </div>
  );
}

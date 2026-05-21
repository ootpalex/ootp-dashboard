import { useState, useMemo, Fragment } from "react";
import { S, posColor, levelColor, proneColor, warStyle, devPctColor, zToColor } from "../../theme.js";
import { fmt, fmtAge, paginateRows, toRosterRow, sortRosterRows, rankSuffix } from "../../utils/helpers.js";
import { POT_DISPLAY_POS, PER_PAGE } from "../../utils/constants.js";
import { passesPositionFilter, passesLevelFilter } from "../../utils/accessors.js";
import { Section, SortHeader, PositionFilter, LevelFilter, TwoWayBadge, Pagination } from "../../components/shared.jsx";

export default function OverviewSubTab({
  data, team, teamHitters, teamPitchers,
  strength, onSelectPlayer,
}) {
  const [rosterLevel, setRosterLevel] = useState([]);
  const [rosterSort, setRosterSort] = useState({ col: "war", dir: "desc" });
  const [prospectSort, setProspectSort] = useState({ col: "MAX WAR P", dir: "desc" });
  const [prospectPage, setProspectPage] = useState(0);
  const [posFilter, setPosFilter] = useState([]);
  const [expandedPos, setExpandedPos] = useState(null);

  const nowZ = strength.zScores.now?.[team] || {};
  const nowRanks = strength.ranks.now?.[team] || {};
  const farmZ = strength.zScores.farm?.[team] || {};
  const farmRanks = strength.ranks.farm?.[team] || {};
  const teamContrib = strength.contributors?.[team] || { now: {}, farm: {} };
  const teamCoreAge = strength.coreAge?.[team] || {};
  const teamNowScore = strength.teamScores?.[team]?.now || {};
  const teamFarmScore = strength.teamScores?.[team]?.farm || {};
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
    const PROSPECT_COL_MAP = { "MAX WAR P": (p) => p.warP, "Max WAR wtd": (p) => p.war, devPct: (p) => p.devPct, fv: (p) => p.fv };
    sortRosterRows(all, prospectSort.col, prospectSort.dir, PROSPECT_COL_MAP);
    return all;
  }, [teamHitters, teamPitchers, prospectSort]);

  const toggleSort = (setter) => (col) => setter((prev) => ({ col, dir: prev.col === col && prev.dir === "desc" ? "asc" : "desc" }));

  return (
    <>
      <Section title="Positional Strength">
        <div style={{ fontSize: 12, color: "#64748b", marginBottom: 10, lineHeight: 1.5 }}>
          <strong style={{ color: "#94a3b8" }}>Now</strong> = MLB-active starter + 40-man depth (current WAR). <strong style={{ color: "#94a3b8" }}>Farm</strong> = MiLB players only (FV). Each bar runs from the league-average line — <span style={{ color: "#f87171" }}>left = below average</span>, <span style={{ color: "#4ade80" }}>right = above</span>, longer = further from average. <strong style={{ color: "#94a3b8" }}>Age</strong> = weighted age of your MLB core. Click a position for the players behind it.
        </div>
        {(() => {
          const ROW_COLS = "40px 48px 1fr 1fr 22px";
          const BAR_COLS = "1fr 34px 40px";
          const bar = (z, score, rank) => {
            const c = zToColor(z);
            const mag = z == null ? 0 : Math.min(Math.abs(z) / 2.5, 1);
            const pct = (mag * 50).toFixed(1) + "%";
            const positive = (z ?? 0) >= 0;
            return (
              <div style={{ display: "grid", gridTemplateColumns: BAR_COLS, alignItems: "center", gap: 6 }}>
                <div style={{ position: "relative", height: 16, background: "rgba(30,41,59,0.45)", borderRadius: 3 }}>
                  <div style={{ position: "absolute", left: "50%", top: -1, bottom: -1, width: 1, background: "#475569" }} />
                  {z != null && (
                    <div style={{ position: "absolute", top: 1, bottom: 1, background: c.border, borderRadius: 2,
                      ...(positive ? { left: "50%", width: pct } : { right: "50%", width: pct }) }} />
                  )}
                </div>
                <b style={{ fontSize: 12, color: c.value, textAlign: "right" }}>{fmt(score, 1)}</b>
                <span style={{ fontSize: 12, color: c.label, textAlign: "right" }}>{z == null ? "" : rankSuffix(rank)}</span>
              </div>
            );
          };
          const depthList = (title, list) => (
            <div style={{ flex: 1, minWidth: 240 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", letterSpacing: 1, textTransform: "uppercase", marginBottom: 5 }}>{title}</div>
              {(!list || list.length === 0) && <div style={{ fontSize: 12, color: "#475569", fontStyle: "italic" }}>—</div>}
              {(list || []).map((c, i) => {
                const p = c.player;
                return (
                  <div key={(p.ID ?? p.id ?? i) + "-" + i} style={{ display: "grid", gridTemplateColumns: "18px 1fr auto 46px", gap: 8, alignItems: "baseline", padding: "3px 0" }}>
                    <span style={{ fontSize: 11, color: "#475569" }}>{i + 1}.</span>
                    <span style={{ fontSize: 12.5, color: "#e2e8f0", cursor: "pointer" }} onClick={() => onSelectPlayer?.(p)}>
                      {p.meta?.name ?? p.Name}
                      <span style={{ color: "#64748b", marginLeft: 5 }}>{fmtAge(p._age)}</span>
                      <span style={{ color: levelColor(p.meta?.lev ?? p.Lev), marginLeft: 5 }}>{p.meta?.lev ?? p.Lev}</span>
                    </span>
                    <span style={{ fontSize: 12, ...warStyle(c.val) }}>{fmt(c.val)}</span>
                    <span style={{ fontSize: 10.5, color: "#475569", textAlign: "right" }}>×{c.weight.toFixed(2)}</span>
                  </div>
                );
              })}
            </div>
          );
          return (
            <div>
              <div style={{ display: "grid", gridTemplateColumns: ROW_COLS, gap: 12, fontSize: 11, color: "#64748b", fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", padding: "0 2px 7px", borderBottom: "1px solid #1e293b", marginBottom: 5 }}>
                <span>POS</span>
                <span style={{ textAlign: "right", textTransform: "none", letterSpacing: 0 }}>Age</span>
                <div style={{ display: "grid", gridTemplateColumns: BAR_COLS, gap: 6 }}><span style={{ textAlign: "center" }}>Now</span><span /><span /></div>
                <div style={{ display: "grid", gridTemplateColumns: BAR_COLS, gap: 6 }}><span style={{ textAlign: "center" }}>Farm</span><span /><span /></div>
                <span></span>
              </div>
              {POT_DISPLAY_POS.map((pos) => {
                const age = teamCoreAge[pos];
                const open = expandedPos === pos;
                return (
                  <Fragment key={pos}>
                    <div onClick={() => setExpandedPos(open ? null : pos)}
                         style={{ display: "grid", gridTemplateColumns: ROW_COLS, gap: 12, alignItems: "center", cursor: "pointer", padding: "7px 2px", borderRadius: 4, background: open ? "rgba(59,130,246,0.10)" : "transparent" }}>
                      <span style={{ fontSize: 16, fontWeight: 800, color: posColor(pos) }}>{pos}</span>
                      <span style={{ fontSize: 12.5, textAlign: "right", color: age != null && age >= 31 ? "#f59e0b" : "#94a3b8", fontWeight: age != null && age >= 31 ? 700 : 400 }}>{age != null ? fmt(age, 1) : "—"}</span>
                      {bar(nowZ[pos], teamNowScore[pos], nowRanks[pos])}
                      {bar(farmZ[pos], teamFarmScore[pos], farmRanks[pos])}
                      <span style={{ fontSize: 12.5, color: "#64748b", textAlign: "center" }}>{open ? "▾" : "▸"}</span>
                    </div>
                    {open && (
                      <div style={{ display: "flex", gap: 28, flexWrap: "wrap", padding: "6px 2px 10px 52px", background: "rgba(15,23,42,0.4)", borderRadius: 4, marginBottom: 2 }}>
                        {depthList("Now · MLB 40-man", teamContrib.now?.[pos])}
                        {depthList("Farm · MiLB", teamContrib.farm?.[pos])}
                      </div>
                    )}
                  </Fragment>
                );
              })}
            </div>
          );
        })()}
      </Section>

      <Section title={`${team} Roster`}>
        <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
          <PositionFilter value={posFilter} onChange={setPosFilter} />
          <LevelFilter players={teamPlayersForFilter} value={rosterLevel} onChange={setRosterLevel} expandRookieTeams />
        </div>
        <div style={S.tableWrap}><table style={S.table}><thead><tr>
          {[{ key: "name", label: "Name", w: 180 }, { key: "age", label: "Age", w: 50 }, { key: "pos", label: "POS", w: 50 }, { key: "bestPos", label: "Best", w: 50 }, { key: "bt", label: "B/T", w: 50 }, { key: "level", label: "Level", w: 55 }, { key: "on40", label: "40M", w: 45 }, { key: "fv", label: "FV", w: 60 }, { key: "war", label: "WAR", w: 70 }, { key: "warP", label: "WAR P", w: 70 }, { key: "devPct", label: "Dev%", w: 48 }, { key: "prone", label: "Prone", w: 70 }, { key: "price", label: "Salary", w: 90 }].map(({ key, label, w }) => <SortHeader key={key} label={label} width={w} sortCol={rosterSort.col} sortDir={rosterSort.dir} colKey={key} onClick={() => toggleSort(setRosterSort)(key)} />)}
        </tr></thead><tbody>
          {roster.map((p, i) => (
            <tr key={p.id + "-" + i} style={{ background: i % 2 === 0 ? "transparent" : "rgba(15,23,42,0.3)" }}>
              <td style={{ ...S.td, fontWeight: 600, color: "#e2e8f0", minWidth: 180, cursor: "pointer" }}
                  onClick={() => onSelectPlayer?.(p._original || p)}>{p.name}<TwoWayBadge player={p} /></td>
              <td style={S.td}>{fmtAge(p.age)}</td><td style={{ ...S.td, color: posColor(p.pos) }}>{p.pos}</td>
              <td style={{ ...S.td, color: posColor((p.bestPos || "").replace("*", "")) }}>{p.bestPos || "—"}</td>
              <td style={S.td}>{p.bt}</td><td style={{ ...S.td, color: levelColor(p.level) }}>{p.level}</td>
              <td style={S.td}>{p.on40 === "Yes" ? "✓" : ""}</td>
              <td style={{ ...S.td, ...warStyle(p.fv) }}>{fmt(p.fv)}</td>
              <td style={{ ...S.td, ...warStyle(p.war) }}>{fmt(p.war)}</td>
              <td style={{ ...S.td, ...(p.matured ? { color: "#475569" } : warStyle(p.warP)) }}>{p.matured ? "—" : fmt(p.warP)}</td>
              <td style={{ ...S.td, color: !p.matured && p.devPct != null ? devPctColor(p.devPct) : "#475569", fontWeight: !p.matured && p.devPct != null ? 600 : 400 }}>{!p.matured && p.devPct != null ? rankSuffix(Math.round(p.devPct * 100)) : "—"}</td>
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
          {[{ key: "name", label: "Name", w: 180 }, { key: "age", label: "Age", w: 50 }, { key: "devPct", label: "Dev%", w: 48 }, { key: "pos", label: "POS", w: 50 }, { key: "level", label: "Level", w: 55 }, { key: "fv", label: "FV", w: 60 }, { key: "Max WAR wtd", label: "Current", w: 80 }, { key: "MAX WAR P", label: "Potential", w: 80 }, { key: "prone", label: "Prone", w: 70 }].map(({ key, label, w }) => <SortHeader key={key} label={label} width={w} sortCol={prospectSort.col} sortDir={prospectSort.dir} colKey={key} onClick={() => toggleSort(setProspectSort)(key)} />)}
        </tr></thead><tbody>
          {paginateRows(prospects, prospectPage, PER_PAGE).paged.map((p, i) => (
            <tr key={p.id + "-" + i} style={{ background: i % 2 === 0 ? "transparent" : "rgba(15,23,42,0.3)" }}>
              <td style={{ ...S.td, fontWeight: 600, color: "#e2e8f0", minWidth: 180, cursor: "pointer" }}
                  onClick={() => onSelectPlayer?.(p._original || p)}>{p.name}<TwoWayBadge player={p} /></td>
              <td style={S.td}>{fmtAge(p.age)}</td>
              <td style={{ ...S.td, color: !p.matured && p.devPct != null ? devPctColor(p.devPct) : "#475569", fontWeight: !p.matured && p.devPct != null ? 600 : 400 }}>{!p.matured && p.devPct != null ? rankSuffix(Math.round(p.devPct * 100)) : "—"}</td>
              <td style={{ ...S.td, color: posColor(p.pos) }}>{p.pos}</td>
              <td style={{ ...S.td, color: levelColor(p.level) }}>{p.level}</td>
              <td style={{ ...S.td, ...warStyle(p.fv) }}>{fmt(p.fv)}</td>
              <td style={{ ...S.td, ...warStyle(p.war) }}>{fmt(p.war)}</td>
              <td style={{ ...S.td, ...(p.matured ? { color: "#475569" } : warStyle(p.warP)) }}>{p.matured ? "—" : fmt(p.warP)}</td>
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

import { useState, useMemo } from "react";
import { S, TOKENS as T, posColor, levelChip, proneColor, PRONE, warStyle, devPctStyle, gradeStyle, zHeat } from "../../theme.js";
import { fmt, fmtAge, paginateRows, toRosterRow, sortRosterRows, rankSuffix } from "../../utils/helpers.js";
import { PER_PAGE } from "../../utils/constants.js";
import { passesPositionFilter, passesLevelFilter } from "../../utils/accessors.js";
import { Section, SortHeader, PositionFilter, LevelFilter, TwoWayBadge, Pagination, colRule } from "../../components/shared.jsx";
import PositionalStrengthTable from "./PositionalStrengthTable.jsx";

// Scorecard board grammar (same local helper block as the batch-2 boards): column-group left rules via
// colRule, numeric columns right-aligned, first/last cells carry the 12px box padding (full `padding`
// shorthand so no cell mixes shorthand/longhand across renders).
const edgePad = (cols, i, v) => (i === 0 ? { padding: `${v} 6px ${v} 12px` } : i === cols.length - 1 ? { padding: `${v} 12px ${v} 6px` } : {});
const thStyle = (cols, i) => ({ ...(colRule(cols, i) || {}), ...edgePad(cols, i, "6px") });
const tdStyle = (cols, i) => ({ ...S.td, ...(colRule(cols, i) || {}), ...(cols[i].align ? { textAlign: cols[i].align } : {}), ...edgePad(cols, i, "0") });
const posCell = { fontFamily: T.fonts.narrow, fontWeight: 600, fontSize: 13 };
// levelChip() returns { bg, text, border[, borderStyle] } (theme keys) — map it onto the S.badge CSS keys.
const chipCss = (c) => ({ background: c.bg, color: c.text, borderColor: c.border, ...(c.borderStyle ? { borderStyle: c.borderStyle } : {}) });

// Roster columns (inventory §B.3 item 10): Name Age POS Best B/T Lvl 40M | FV WAR WAR P Dev% | Prone INTG | Salary.
const ROSTER_COLS = [
  { key: "name", label: "Name", w: 170, group: "identity" },
  { key: "age", label: "Age", w: 45, group: "identity", align: "right" },
  { key: "pos", label: "POS", w: 48, group: "identity" },
  { key: "bestPos", label: "Best", w: 48, group: "identity" },
  { key: "bt", label: "B/T", w: 50, group: "identity" },
  { key: "level", label: "Lvl", w: 45, group: "identity" },
  { key: "on40", label: "40M", w: 45, group: "identity", align: "center" },
  { key: "fv", label: "FV", w: 60, group: "value", align: "right" },
  { key: "war", label: "WAR", w: 65, group: "value", align: "right" },
  { key: "warP", label: "WAR P", w: 65, group: "value", align: "right" },
  { key: "devPct", label: "Dev%", w: 48, group: "value", align: "right" },
  { key: "prone", label: "Prone", w: 65, group: "health" },
  { key: "_intangibles", label: "INTG", w: 48, group: "health", align: "right" },
  { key: "price", label: "Salary", w: 85, group: "contract", align: "right" },
];
const ci = Object.fromEntries(ROSTER_COLS.map((c, i) => [c.key, i]));
const td = (key) => tdStyle(ROSTER_COLS, ci[key]);

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

  const sortedLabel = ROSTER_COLS.find((c) => c.key === rosterSort.col)?.label;
  const sortState = sortedLabel ? `Sorted by ${sortedLabel}, ${rosterSort.dir === "desc" ? "descending" : "ascending"}` : null;
  // Legend words take the bar endpoint colours the table actually draws (zHeat neg / pos).
  const weakInk = zHeat(-2.5).bar, strongInk = zHeat(2.5).bar;

  return (
    <>
      <Section title="Positional Strength" state="z vs league · now + farm"
        footer={<>
          <strong style={{ color: T.text2, fontWeight: 600 }}>Now</strong> = MLB-active starter + 40-man depth (current WAR). <strong style={{ color: T.text2, fontWeight: 600 }}>Farm</strong> = MiLB players only (FV). Each bar runs from the league-average line — <span style={{ color: weakInk }}>left = below average</span>, <span style={{ color: strongInk }}>right = above</span>, longer = further from average. <strong style={{ color: T.text2, fontWeight: 600 }}>Age</strong> = weighted age of your MLB core. Click a position for the players behind it.
        </>}>
        {/* The needs grid runs edge to edge inside the box (its own rules are the chrome). */}
        <div style={{ margin: "-12px -12px -13px" }}>
          <PositionalStrengthTable
            team={team}
            strength={strength}
            mode="both"
            sort="spectrum"
            onSelectPlayer={onSelectPlayer}
          />
        </div>
      </Section>

      <Section title={`${team} Roster`} count={`(${roster.length})`} state={sortState}
        toolbar={<>
          <PositionFilter value={posFilter} onChange={(v) => { setPosFilter(v); setRosterPage(0); }} />
          <LevelFilter players={teamPlayersForFilter} value={rosterLevel} onChange={(v) => { setRosterLevel(v); setRosterPage(0); }} expandRookieTeams />
        </>}>
        {/* Table + foot strip run edge to edge inside the box body (the box border is the rule). */}
        <div style={{ margin: -12 }}>
          <div style={{ ...S.tableWrap, border: "none", borderRadius: 0 }}><table style={S.table}><thead><tr>
            {ROSTER_COLS.map(({ key, label, w, align }, i) => <SortHeader key={key} label={label} width={w} align={align} rule={thStyle(ROSTER_COLS, i)} sortCol={rosterSort.col} sortDir={rosterSort.dir} colKey={key} onClick={() => toggleSort(setRosterSort)(key)} />)}
          </tr></thead><tbody>
            {pagedRoster.map((p, i) => (
              <tr key={p.id + "-" + i} style={i % 2 === 1 ? S.zebraRow : undefined}>
                <td style={{ ...td("name"), ...S.tdName, minWidth: 170, cursor: "pointer" }}
                    onClick={() => onSelectPlayer?.(p._original || p)}>{p.name}<TwoWayBadge player={p} /></td>
                <td style={{ ...td("age"), color: T.text2 }}>{fmtAge(p.age)}</td>
                <td style={{ ...td("pos"), ...posCell, color: posColor(p.pos) }}>{p.pos}</td>
                <td style={{ ...td("bestPos"), ...posCell, color: p.bestPos ? posColor((p.bestPos || "").replace("*", "")) : T.textDisabled }}>{p.bestPos || "—"}</td>
                <td style={{ ...td("bt"), color: T.text2 }}>{p.bt}</td>
                <td style={td("level")}>{p.level && p.level !== "-" ? <span style={{ ...S.badge, ...chipCss(levelChip(p.level)) }}>{p.level}</span> : <span style={{ color: T.textDisabled }}>—</span>}</td>
                <td style={{ ...td("on40"), color: T.text2 }}>{p.on40 === true || p.on40 === "Yes" ? "✓" : ""}</td>
                <td style={{ ...td("fv"), ...warStyle(p.fv) }}>{fmt(p.fv)}</td>
                <td style={{ ...td("war"), ...warStyle(p.war) }}>{fmt(p.war)}</td>
                <td style={{ ...td("warP"), ...(p.matured ? { color: T.textDisabled } : warStyle(p.warP)) }}>{p.matured ? "—" : fmt(p.warP)}</td>
                <td style={{ ...td("devPct"), ...(!p.matured && p.devPct != null ? devPctStyle(p.devPct) : { color: T.textDisabled }) }}>{!p.matured && p.devPct != null ? rankSuffix(Math.round(p.devPct * 100)) : "—"}</td>
                <td style={{ ...td("prone"), color: proneColor(p.prone), fontWeight: PRONE[p.prone]?.weight ?? 400 }}>{p.prone}</td>
                <td style={{ ...td("_intangibles"), ...gradeStyle(p._intangibles), fontWeight: 700 }}>{p._intangibles ?? "—"}</td>
                <td style={{ ...td("price"), color: p.price != null ? T.text2 : T.textDisabled }}>{p.price != null ? "$" + p.price.toLocaleString() : "—"}</td>
              </tr>
            ))}
            {roster.length === 0 && <tr><td colSpan={ROSTER_COLS.length} style={{ ...S.td, textAlign: "center", color: T.text3, padding: "16px 12px" }}>No players found</td></tr>}
          </tbody></table></div>
          <Pagination page={rosterPage} totalPages={rosterTotalPages} total={roster.length} onPrev={() => setRosterPage(Math.max(0, rosterPage - 1))} onNext={() => setRosterPage(Math.min(rosterTotalPages - 1, rosterPage + 1))} />
        </div>
      </Section>
    </>
  );
}

import { useState, useMemo, lazy, Suspense } from "react";
import { TOKENS as T, S } from "../theme.js";
import { posColor, levelChip, proneColor, PRONE, warStyle, devPctStyle } from "../theme.js";
import { fmt, fmtAge, parseCSVBoolean, paginateRows, rankSuffix } from "../utils/helpers.js";
import { POT_DISPLAY_POS, PER_PAGE } from "../utils/constants.js";
import { calcOrgNeed } from "../utils/strength.js";
import { buildBoardPool, buildDisplayPool } from "./boardUtils.js";
import { Section, SortHeader, SearchInput, PillBtn, TabGroup, PositionFilter, Toggle, TwoWayBadge, Pagination, colRule } from "./shared.jsx";
import { useDebouncedValue } from "../hooks/useDebouncedValue.js";
import PositionalStrengthTable from "../views/Org/PositionalStrengthTable.jsx";

// Same lazy-import as Dashboard's RosterPlanner route — Webpack/Vite dedupes
// to a single chunk, and both call sites share the per-league localStorage so
// edits in either place propagate to the other on remount.
const RosterPlanner = lazy(() => import("../views/RosterPlanner/RosterPlanner.jsx"));

const R5_TABS = [
  { id: "board", label: "R5 Board" },
  { id: "planner", label: "40-Man Planner" },
];

// Scorecard board grammar (mockup `.board`): column-group left rules via colRule, numeric
// columns right-aligned, first/last cells carry the 12px box padding.
// Edge padding is written as the full `padding` shorthand (S.th / S.td also use the shorthand) so a
// column that moves from first to second place (e.g. when the Smart column appears) never mixes
// shorthand and longhand across renders — React 18 warns on that.
const edgePad = (cols, i, v) => (i === 0 ? { padding: `${v} 6px ${v} 12px` } : i === cols.length - 1 ? { padding: `${v} 12px ${v} 6px` } : {});
const thStyle = (cols, i) => ({ ...(colRule(cols, i) || {}), ...edgePad(cols, i, "6px") });
const tdStyle = (cols, i) => ({ ...S.td, ...(colRule(cols, i) || {}), ...(cols[i].align ? { textAlign: cols[i].align } : {}), ...edgePad(cols, i, "0") });
// Level ladder chip: levelChip() returns { bg, text, border, borderStyle? } (theme keys, not CSS), so map
// them onto S.badge explicitly (full `border` shorthand — no shorthand/longhand mixing).
const levelBadge = (lev) => { const c = levelChip(lev); return { ...S.badge, background: c.bg, color: c.text, border: `1px ${c.borderStyle || "solid"} ${c.border}` }; };
const posCell = { fontFamily: T.fonts.narrow, fontWeight: 600, fontSize: 13 };
const rowStyle = (i) => (i % 2 === 1 ? S.zebraRow : undefined);

function Rule5Board({ data, myTeam, strength, curveSettings, leagueSettings, dashMeta, onSelectPlayer }) {
  const [r5Tab, setR5Tab] = useState("board");
  const [toggles, setToggles] = useState({ orgNeed: false, devAdj: false, injury: false, intangibles: false });
  const setToggle = (key) => setToggles((t) => ({ ...t, [key]: !t[key] }));
  const [search, setSearch] = useState("");
  const [posFilter, setPosFilter] = useState([]);
  const [sort, setSort] = useState({ col: "_rank", dir: "desc" });
  const [page, setPage] = useState(0);

  const orgNeed = useMemo(() => myTeam ? calcOrgNeed(myTeam, strength) : null, [myTeam, strength]);

  const isR5 = (p) => (p.meta?.r5 ?? parseCSVBoolean(p.R5)) && (p.meta?.org ?? p.ORG) !== myTeam;
  const pool = useMemo(() => buildBoardPool(data, isR5, isR5), [data, myTeam]);

  const debouncedSearch = useDebouncedValue(search);
  const displayPool = useMemo(() =>
    buildDisplayPool(pool, debouncedSearch, posFilter, sort, toggles, orgNeed, curveSettings, null, { _fv: (p) => p._fv }),
    [pool, debouncedSearch, posFilter, sort, toggles, orgNeed, curveSettings]);

  const { paged, totalPages } = paginateRows(displayPool, page, PER_PAGE);
  const anyToggle = toggles.orgNeed || toggles.devAdj || toggles.injury || toggles.intangibles;
  const togglesOn = [toggles.devAdj, toggles.orgNeed, toggles.injury, toggles.intangibles].filter(Boolean).length;

  // B.3 groups: Smart/WAR P | Name Age | Dev% | POS Best Team Lvl | FV WAR WAR P | Prone [Raw] B/T.
  const cols = [
    { key: "_rank", label: anyToggle ? "Smart" : "WAR P", w: 70, group: "rank", align: "right" },
    { key: "Name", label: "Name", w: 170, group: "identity" },
    { key: "Age", label: "Age", w: 45, group: "identity", align: "right" },
    { key: "_devPct", label: "Dev%", w: 48, group: "development", align: "right" },
    { key: "POS", label: "POS", w: 48, group: "roster" },
    { key: "_bestPos", label: "Best", w: 48, group: "roster" },
    { key: "ORG", label: "Team", w: 130, group: "roster" },
    { key: "Lev", label: "Lvl", w: 45, group: "roster" },
    { key: "_fv", label: "FV", w: 60, group: "value", align: "right" },
    { key: "_currentVal", label: "WAR", w: 65, group: "value", align: "right" },
    { key: "_baseVal", label: "WAR P", w: 65, group: "value", align: "right" },
    { key: "Prone", label: "Prone", w: 65, group: "health" },
    ...(anyToggle ? [{ key: "_baseVal_raw", label: "Raw", w: 60, group: "health", align: "right" }] : []),
    { key: "B", label: "B/T", w: 50, group: "health" },
  ];
  const ci = Object.fromEntries(cols.map((c, i) => [c.key, i]));
  const td = (key) => tdStyle(cols, ci[key]);
  const sortedLabel = cols.find((c) => c.key === sort.col)?.label;
  const sortState = sortedLabel ? `Sorted by ${sortedLabel}, ${sort.dir === "desc" ? "descending" : "ascending"}` : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <TabGroup label="Rule 5 views">
          {R5_TABS.map((tab) => (
            <PillBtn key={tab.id} active={r5Tab === tab.id} onClick={() => setR5Tab(tab.id)}>
              {tab.label}
            </PillBtn>
          ))}
        </TabGroup>
      </div>

      {r5Tab === "planner" && (
        <Suspense fallback={<div style={{ padding: 20, color: T.text3 }}>Loading 40-Man Planner…</div>}>
          <RosterPlanner
            data={data}
            myTeam={myTeam}
            curveSettings={curveSettings}
            leagueSettings={leagueSettings}
            dashMeta={dashMeta}
            onSelectPlayer={onSelectPlayer}
          />
        </Suspense>
      )}

      {r5Tab === "board" && <>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, alignItems: "stretch" }}>
        <Section title="My Positional Needs" state="z vs league · now"
          footer="Sorted weakest to strongest. Target R5 picks at your weakest positions.">
          <PositionalStrengthTable
            team={myTeam}
            strength={strength}
            mode="now"
            sort="weakest"
            dense
          />
        </Section>

        <Section title="Smart Rank Adjustments" state={`${togglesOn} of 4 on`}>
          {/* Ruled toggle rows fill the box edge to edge; the first row's top rule sits on the header rule. */}
          <div style={{ margin: "-13px -12px -12px" }}>
            <Toggle variant="row" label="Future Value" description="Use FV (cur + age-weighted gap) instead of raw potential" checked={toggles.devAdj} onChange={() => setToggle("devAdj")} />
            <Toggle variant="row" label="Org Positional Need" description="Boost players at your org's weak positions" checked={toggles.orgNeed} onChange={() => setToggle("orgNeed")} />
            <Toggle variant="row" label="Injury Proneness" description="Bonus for Iron Man / Durable, penalty for Fragile / Wrecked" checked={toggles.injury} onChange={() => setToggle("injury")} />
            <Toggle variant="row" label="Intangibles" description="Bonus for elite 20-80 intangible grades, penalty for poor ones" checked={toggles.intangibles} onChange={() => setToggle("intangibles")} />
          </div>
        </Section>
      </div>

      <Section title="Rule 5 Board" count={`(${pool.length.toLocaleString()})`} state={sortState}
        toolbar={<>
          <PositionFilter value={posFilter} onChange={(v) => { setPosFilter(v); setPage(0); }} />
          <SearchInput type="text" placeholder="Search name..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} />
        </>}>
        <div style={{ margin: -12 }}>
          <div style={{ ...S.tableWrap, border: "none", borderRadius: 0 }}>
            <table style={S.table}>
              <thead><tr>
                {cols.map(({ key, label, w, align }, i) => (
                  <SortHeader key={key} label={label} width={w} align={align} rule={thStyle(cols, i)} sortCol={sort.col} sortDir={sort.dir} colKey={key === "_baseVal_raw" ? "_baseVal" : key} onClick={() => setSort((prev) => ({ col: key === "_baseVal_raw" ? "_baseVal" : key, dir: prev.col === (key === "_baseVal_raw" ? "_baseVal" : key) && prev.dir === "desc" ? "asc" : "desc" }))} />
                ))}
              </tr></thead>
              <tbody>
                {paged.map((p, i) => {
                  const lev = p.meta?.lev ?? p.Lev;
                  const prone = p.meta?.prone ?? p.Prone;
                  return (
                  <tr key={p.ID + "-" + i} style={rowStyle(i)}>
                    <td style={{ ...td("_rank"), ...warStyle(p._rank), fontWeight: 700 }}>{fmt(p._rank)}</td>
                    <td style={{ ...td("Name"), ...S.tdName, minWidth: 170, cursor: "pointer" }}
                        onClick={() => onSelectPlayer?.(p)}>{p.meta?.name ?? p.Name}<TwoWayBadge player={p} /></td>
                    <td style={td("Age")}>{fmtAge(p._age)}</td>
                    <td style={{ ...td("_devPct"), ...(p._devPct != null ? devPctStyle(p._devPct) : { color: T.textDisabled }) }}>{p._devPct != null ? rankSuffix(Math.round(p._devPct * 100)) : "—"}</td>
                    <td style={{ ...td("POS"), ...posCell, color: posColor(p.meta?.pos ?? p.POS) }}>{p.meta?.pos ?? p.POS}</td>
                    <td style={{ ...td("_bestPos"), ...posCell, color: p._bestPos ? posColor(p._bestPos?.replace("*", "")) : T.textDisabled }}>{p._bestPos || "—"}</td>
                    <td style={{ ...td("ORG"), color: T.text, maxWidth: 130, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.meta?.org ?? p.ORG}</td>
                    <td style={td("Lev")}>{lev ? <span style={levelBadge(lev)}>{lev}</span> : <span style={{ color: T.textDisabled }}>—</span>}</td>
                    <td style={{ ...td("_fv"), ...warStyle(p._fv) }}>{fmt(p._fv)}</td>
                    <td style={{ ...td("_currentVal"), ...warStyle(p._currentVal) }}>{fmt(p._currentValDisplay ?? p._currentVal)}</td>
                    <td style={{ ...td("_baseVal"), ...(p._matured ? { color: T.textDisabled } : warStyle(p._baseVal)) }}>{p._matured ? "—" : fmt(p._baseValDisplay ?? p._baseVal)}</td>
                    <td style={{ ...td("Prone"), color: proneColor(prone), fontWeight: PRONE[prone]?.weight ?? 400 }}>{prone ?? "—"}</td>
                    {anyToggle && <td style={{ ...td("_baseVal_raw"), ...warStyle(p._baseVal) }}>{fmt(p._baseValDisplay ?? p._baseVal)}</td>}
                    <td style={{ ...td("B"), color: T.text2 }}>{`${p.meta?.bats ?? p.B ?? ""}/${p.meta?.throws ?? p.T ?? ""}`}</td>
                  </tr>
                  );
                })}
                {paged.length === 0 && <tr><td colSpan={cols.length} style={{ ...S.td, textAlign: "center", color: T.text3, padding: "16px 12px" }}>No R5-eligible players found</td></tr>}
              </tbody>
            </table>
          </div>
          <Pagination page={page} totalPages={totalPages} total={displayPool.length} onPrev={() => setPage(Math.max(0, page - 1))} onNext={() => setPage(Math.min(totalPages - 1, page + 1))} />
        </div>
      </Section>
      </>}
    </div>
  );
}


export default Rule5Board;

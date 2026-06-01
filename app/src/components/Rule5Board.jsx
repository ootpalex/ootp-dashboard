import { useState, useMemo, lazy, Suspense } from "react";
import { S } from "../theme.js";
import { posColor, levelColor, proneColor, warStyle, devPctColor } from "../theme.js";
import { fmt, fmtAge, parseCSVBoolean, paginateRows, rankSuffix } from "../utils/helpers.js";
import { POT_DISPLAY_POS, PER_PAGE } from "../utils/constants.js";
import { calcOrgNeed } from "../utils/strength.js";
import { buildBoardPool, buildDisplayPool } from "./boardUtils.js";
import { Section, SortHeader, PillBtn, PositionFilter, Toggle, TwoWayBadge, Pagination } from "./shared.jsx";
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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", gap: 8, borderBottom: "1px solid #1e293b", paddingBottom: 12 }}>
        {R5_TABS.map((tab) => (
          <PillBtn key={tab.id} active={r5Tab === tab.id} onClick={() => setR5Tab(tab.id)}>
            {tab.label}
          </PillBtn>
        ))}
      </div>

      {r5Tab === "planner" && (
        <Suspense fallback={<div style={{ padding: 20, color: "#64748b" }}>Loading 40-Man Planner…</div>}>
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
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, alignItems: "start" }}>
        <Section title="My Positional Needs">
          <PositionalStrengthTable
            team={myTeam}
            strength={strength}
            mode="farm"
            sort="weakest"
            dense
          />
          <div style={{ fontSize: 11, color: "#475569", marginTop: 8 }}>
            Sorted weakest to strongest. Target R5 picks at your weakest positions.
          </div>
        </Section>

        <Section title="Smart Rank Adjustments">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            <Toggle label="Future Value" description="Use FV (cur + age-weighted gap) instead of raw potential" checked={toggles.devAdj} onChange={() => setToggle("devAdj")} />
            <Toggle label="Org Positional Need" description="Boost players at your org's weak positions" checked={toggles.orgNeed} onChange={() => setToggle("orgNeed")} />
            <Toggle label="Injury Proneness" description="Bonus for Iron Man / Durable, penalty for Fragile / Wrecked" checked={toggles.injury} onChange={() => setToggle("injury")} />
            <Toggle label="Intangibles" description="Bonus for elite 20-80 intangible grades, penalty for poor ones" checked={toggles.intangibles} onChange={() => setToggle("intangibles")} />
          </div>
        </Section>
      </div>

      <Section title={`Rule 5 Board (${pool.length})`}>
        <div style={{ marginBottom: 12 }}>
          <PositionFilter value={posFilter} onChange={(v) => { setPosFilter(v); setPage(0); }} />
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
          <input type="text" placeholder="Search name..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} style={S.searchInput} />
        </div>

        <div style={S.tableWrap}>
          <table style={S.table}>
            <thead><tr>
              {[
                { key: "_rank", label: anyToggle ? "Smart" : "WAR P", w: 70 },
                { key: "Name", label: "Name", w: 170 },
                { key: "Age", label: "Age", w: 45 },
                { key: "_devPct", label: "Dev%", w: 48 },
                { key: "POS", label: "POS", w: 48 },
                { key: "_bestPos", label: "Best", w: 48 },
                { key: "ORG", label: "Team", w: 130 },
                { key: "Lev", label: "Lvl", w: 45 },
                { key: "_fv", label: "FV", w: 60 },
                { key: "_currentVal", label: "WAR", w: 65 },
                { key: "_baseVal", label: "WAR P", w: 65 },
                { key: "Prone", label: "Prone", w: 65 },
                ...(anyToggle ? [{ key: "_baseVal_raw", label: "Raw", w: 60 }] : []),
                { key: "B", label: "B/T", w: 50 },
              ].map(({ key, label, w }) => (
                <SortHeader key={key} label={label} width={w} sortCol={sort.col} sortDir={sort.dir} colKey={key === "_baseVal_raw" ? "_baseVal" : key} onClick={() => setSort((prev) => ({ col: key === "_baseVal_raw" ? "_baseVal" : key, dir: prev.col === (key === "_baseVal_raw" ? "_baseVal" : key) && prev.dir === "desc" ? "asc" : "desc" }))} />
              ))}
            </tr></thead>
            <tbody>
              {paged.map((p, i) => (
                <tr key={p.ID + "-" + i} style={{ background: i % 2 === 0 ? "transparent" : "rgba(15,23,42,0.3)" }}>
                  <td style={{ ...S.td, ...warStyle(p._rank), fontWeight: 700 }}>{fmt(p._rank)}</td>
                  <td style={{ ...S.td, fontWeight: 600, color: "#e2e8f0", minWidth: 170, cursor: "pointer" }}
                      onClick={() => onSelectPlayer?.(p)}>{p.meta?.name ?? p.Name}<TwoWayBadge player={p} /></td>
                  <td style={S.td}>{fmtAge(p._age)}</td>
                  <td style={{ ...S.td, color: p._devPct != null ? devPctColor(p._devPct) : "#475569", fontWeight: p._devPct != null ? 600 : 400 }}>{p._devPct != null ? rankSuffix(Math.round(p._devPct * 100)) : "—"}</td>
                  <td style={{ ...S.td, color: posColor(p.meta?.pos ?? p.POS) }}>{p.meta?.pos ?? p.POS}</td>
                  <td style={{ ...S.td, color: posColor(p._bestPos?.replace("*", "")) }}>{p._bestPos || "—"}</td>
                  <td style={{ ...S.td, color: "#cbd5e1", maxWidth: 130, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.meta?.org ?? p.ORG}</td>
                  <td style={{ ...S.td, color: levelColor(p.meta?.lev ?? p.Lev) }}>{p.meta?.lev ?? p.Lev}</td>
                  <td style={{ ...S.td, ...warStyle(p._fv) }}>{fmt(p._fv)}</td>
                  <td style={{ ...S.td, ...warStyle(p._currentVal) }}>{fmt(p._currentValDisplay ?? p._currentVal)}</td>
                  <td style={{ ...S.td, ...(p._matured ? { color: "#475569" } : warStyle(p._baseVal)) }}>{p._matured ? "—" : fmt(p._baseValDisplay ?? p._baseVal)}</td>
                  <td style={{ ...S.td, color: proneColor(p.meta?.prone ?? p.Prone) }}>{p.meta?.prone ?? p.Prone ?? "—"}</td>
                  {anyToggle && <td style={{ ...S.td, ...warStyle(p._baseVal) }}>{fmt(p._baseValDisplay ?? p._baseVal)}</td>}
                  <td style={S.td}>{`${p.meta?.bats ?? p.B ?? ""}/${p.meta?.throws ?? p.T ?? ""}`}</td>
                </tr>
              ))}
              {paged.length === 0 && <tr><td colSpan={anyToggle ? 14 : 13} style={{ ...S.td, textAlign: "center", color: "#475569" }}>No R5-eligible players found</td></tr>}
            </tbody>
          </table>
        </div>
        <Pagination page={page} totalPages={totalPages} total={displayPool.length} onPrev={() => setPage(Math.max(0, page - 1))} onNext={() => setPage(Math.min(totalPages - 1, page + 1))} />
      </Section>
      </>}
    </div>
  );
}


export default Rule5Board;

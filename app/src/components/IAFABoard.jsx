import { useState, useMemo } from "react";
import { TOKENS as T, S } from "../theme.js";
import { posColor, proneColor, PRONE, warStyle, intangibleColor, devPctStyle, gradeStyle } from "../theme.js";
import { fmt, fmtAge, num, paginateRows, rankSuffix } from "../utils/helpers.js";
import { PER_PAGE } from "../utils/constants.js";
import { calcOrgNeed } from "../utils/strength.js";
import { buildBoardPool, buildDisplayPool } from "./boardUtils.js";
import { Section, SortHeader, SearchInput, PillBtn, PositionFilter, Toggle, TwoWayBadge, Pagination, colRule } from "./shared.jsx";
import { useDebouncedValue } from "../hooks/useDebouncedValue.js";
import { readScoped, writeScoped } from "../hooks/useLocalStorage.js";

const SIGNED_KEY = "ssb_iafa_signed";

function loadSignedIds() {
  try {
    const raw = readScoped(SIGNED_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function saveSignedIds(set) {
  writeScoped(SIGNED_KEY, JSON.stringify([...set]));
}

// Scorecard board grammar (mockup `.board`): column-group left rules via colRule, numeric
// columns right-aligned, first/last cells carry the 12px box padding.
// Edge padding is written as the full `padding` shorthand (S.th / S.td also use the shorthand) so a
// column that moves from first to second place (e.g. when the Smart column appears) never mixes
// shorthand and longhand across renders — React 18 warns on that.
const edgePad = (cols, i, v) => (i === 0 ? { padding: `${v} 6px ${v} 12px` } : i === cols.length - 1 ? { padding: `${v} 12px ${v} 6px` } : {});
const thStyle = (cols, i) => ({ ...(colRule(cols, i) || {}), ...edgePad(cols, i, "6px") });
const tdStyle = (cols, i) => ({ ...S.td, ...(colRule(cols, i) || {}), ...(cols[i].align ? { textAlign: cols[i].align } : {}), ...edgePad(cols, i, "0") });
const posCell = { fontFamily: T.fonts.narrow, fontWeight: 600, fontSize: 13 };
const rowStyle = (i) => (i % 2 === 1 ? S.zebraRow : undefined);
const clearLink = { background: "none", border: "none", color: T.accent, fontFamily: T.fonts.narrow, fontSize: 12.5, fontWeight: 600, cursor: "pointer", padding: 0 };

export default function IAFABoard({ data, myTeam, strength, curveSettings, leagueSettings, onSelectPlayer }) {
  const [toggles, setToggles] = useState({ orgNeed: false, devAdj: false, injury: false, intangibles: false });
  const setToggle = (key) => setToggles((t) => ({ ...t, [key]: !t[key] }));
  const [search, setSearch] = useState("");
  const [posFilter, setPosFilter] = useState([]);
  const [sort, setSort] = useState({ col: "_rank", dir: "desc" });
  const [page, setPage] = useState(0);
  const [signedIds, setSignedIds] = useState(loadSignedIds);
  const [hideSigned, setHideSigned] = useState(false);

  const toggleSigned = (id) => {
    setSignedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      saveSignedIds(next);
      return next;
    });
  };
  const clearSigned = () => {
    setSignedIds(() => {
      const next = new Set();
      saveSignedIds(next);
      return next;
    });
  };

  const orgNeed = useMemo(() => myTeam ? calcOrgNeed(myTeam, strength) : null, [myTeam, strength]);

  const iafaTag = leagueSettings?.iafaTag || "IAFA";
  const isIafa = (p) => (p.meta?.source ?? p.meta?.manual ?? p.Manual) === iafaTag;
  const demFields = (p) => ({ _demSort: p.meta?.demSort ?? num(p["DEM Sort"]) });
  const pool = useMemo(() => buildBoardPool(data, isIafa, isIafa, demFields), [data, iafaTag]);

  const debouncedSearch = useDebouncedValue(search);
  const displayPool = useMemo(() =>
    buildDisplayPool(pool, debouncedSearch, posFilter, sort, toggles, orgNeed, curveSettings),
    [pool, debouncedSearch, posFilter, sort, toggles, orgNeed, curveSettings]);

  const visiblePool = useMemo(() =>
    hideSigned ? displayPool.filter((p) => !signedIds.has(p.ID)) : displayPool,
    [displayPool, hideSigned, signedIds]);

  const { paged, totalPages } = paginateRows(visiblePool, page, PER_PAGE);
  const anyToggle = toggles.orgNeed || toggles.devAdj || toggles.injury || toggles.intangibles;
  const togglesOn = [toggles.devAdj, toggles.orgNeed, toggles.injury, toggles.intangibles].filter(Boolean).length;

  // B.3 groups: Signed Smart/WAR P | Name Age | Dev% | POS Best | [Raw] | Prone INTG WE INT | DEM.
  const cols = [
    { key: "_signed", label: "Signed", w: 50, group: "rank", align: "center", sortable: false },
    { key: "_rank", label: anyToggle ? "Smart" : "WAR P", w: 70, group: "rank", align: "right" },
    { key: "Name", label: "Name", w: 170, group: "identity" },
    { key: "Age", label: "Age", w: 45, group: "identity", align: "right" },
    { key: "_devPct", label: "Dev%", w: 48, group: "development", align: "right" },
    { key: "POS", label: "POS", w: 48, group: "position" },
    { key: "_bestPos", label: "Best", w: 48, group: "position" },
    ...(anyToggle ? [{ key: "_baseVal", label: "Raw", w: 60, group: "raw", align: "right" }] : []),
    { key: "Prone", label: "Prone", w: 65, group: "health" },
    { key: "_intangibles", label: "INTG", w: 48, group: "health", align: "right" },
    { key: "WE", label: "WE", w: 32, group: "health", align: "center" },
    { key: "INT", label: "INT", w: 32, group: "health", align: "center" },
    { key: "_demSort", label: "DEM", w: 75, group: "contract", align: "right" },
  ];
  const ci = Object.fromEntries(cols.map((c, i) => [c.key, i]));
  const td = (key) => tdStyle(cols, ci[key]);
  const sortedLabel = cols.find((c) => c.key === sort.col)?.label;
  const sortState = sortedLabel ? `Sorted by ${sortedLabel}, ${sort.dir === "desc" ? "descending" : "ascending"}` : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Section title="Smart Rank Adjustments" state={`${togglesOn} of 4 on`}>
        {/* Ruled toggle rows in a 2 × 2 grid, edge to edge; the top rules sit on the header rule. */}
        <div style={{ margin: "-13px -12px -12px", display: "grid", gridTemplateColumns: "1fr 1fr" }}>
          <Toggle variant="row" label="Future Value" description="Use FV (cur + age-weighted gap) instead of raw potential" checked={toggles.devAdj} onChange={() => setToggle("devAdj")} />
          <div style={{ borderLeft: `1px solid ${T.line}` }}>
            <Toggle variant="row" label="Org Positional Need" description="Boost players at your org's weak positions" checked={toggles.orgNeed} onChange={() => setToggle("orgNeed")} />
          </div>
          <Toggle variant="row" label="Injury Proneness" description="Bonus for Iron Man / Durable, penalty for Fragile / Wrecked" checked={toggles.injury} onChange={() => setToggle("injury")} />
          <div style={{ borderLeft: `1px solid ${T.line}` }}>
            <Toggle variant="row" label="Intangibles" description="Bonus for elite 20-80 intangible grades, penalty for poor ones" checked={toggles.intangibles} onChange={() => setToggle("intangibles")} />
          </div>
        </div>
      </Section>

      <Section title="IAFA Board" count={`(${pool.length.toLocaleString()})`} state={sortState}
        toolbar={<>
          <PositionFilter value={posFilter} onChange={(v) => { setPosFilter(v); setPage(0); }} />
          <SearchInput type="text" placeholder="Search name..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} />
          <PillBtn active={hideSigned} onClick={() => { setHideSigned((v) => !v); setPage(0); }}>
            {hideSigned ? "Showing unsigned" : "Hide signed"}
          </PillBtn>
          {signedIds.size > 0 && (
            <button onClick={clearSigned} style={clearLink}>
              Clear signed ({signedIds.size})
            </button>
          )}
        </>}>
        <div style={{ margin: -12 }}>
          <div style={{ ...S.tableWrap, border: "none", borderRadius: 0 }}>
            <table style={S.table}>
              <thead><tr>
                {cols.map(({ key, label, w, align, sortable }, i) => (
                  sortable === false
                    ? <th key={key} style={{ ...S.th, ...thStyle(cols, i), width: w, minWidth: w, textAlign: align }}>{label}</th>
                    : <SortHeader key={key} label={label} width={w} align={align} rule={thStyle(cols, i)} sortCol={sort.col} sortDir={sort.dir} colKey={key} onClick={() => setSort((prev) => ({ col: key, dir: prev.col === key && prev.dir === "desc" ? "asc" : "desc" }))} />
                ))}
              </tr></thead>
              <tbody>
                {paged.map((p, i) => {
                  const isSigned = signedIds.has(p.ID);
                  const prone = p.meta?.prone ?? p.Prone;
                  const dem = p.meta?.dem ?? p.DEM;
                  return (
                  <tr key={p.ID + "-" + i} style={{ ...rowStyle(i), opacity: isSigned ? 0.5 : 1 }}>
                    <td style={td("_signed")}>
                      <input type="checkbox" checked={isSigned} onChange={() => toggleSigned(p.ID)} style={{ cursor: "pointer", accentColor: T.accent, margin: 0, verticalAlign: "middle" }} />
                    </td>
                    <td style={{ ...td("_rank"), ...warStyle(p._rank), fontWeight: 700 }}>{fmt(anyToggle ? p._rank : (p._baseValDisplay ?? p._baseVal))}</td>
                    <td style={{ ...td("Name"), ...S.tdName, minWidth: 140, cursor: "pointer" }}
                        onClick={() => onSelectPlayer?.(p)}>{p.meta?.name ?? p.Name}<TwoWayBadge player={p} /></td>
                    <td style={td("Age")}>{fmtAge(p._age)}</td>
                    <td style={{ ...td("_devPct"), ...(p._devPct != null ? devPctStyle(p._devPct) : { color: T.textDisabled }) }}>{p._devPct != null ? rankSuffix(Math.round(p._devPct * 100)) : "—"}</td>
                    <td style={{ ...td("POS"), ...posCell, color: posColor(p.meta?.pos ?? p.POS) }}>{p.meta?.pos ?? p.POS}</td>
                    <td style={{ ...td("_bestPos"), ...posCell, color: p._bestPos ? posColor(p._bestPos?.replace("*", "")) : T.textDisabled }}>{p._bestPos || "—"}</td>
                    {anyToggle && <td style={{ ...td("_baseVal"), ...warStyle(p._baseVal) }}>{fmt(p._baseValDisplay ?? p._baseVal)}</td>}
                    <td style={{ ...td("Prone"), color: proneColor(prone), fontWeight: PRONE[prone]?.weight ?? 400 }}>{prone ?? "—"}</td>
                    <td style={{ ...td("_intangibles"), ...gradeStyle(p._intangibles), fontWeight: 700 }}>{p._intangibles ?? "—"}</td>
                    <td style={{ ...td("WE"), color: (p.meta?.we ?? p.WE) ? intangibleColor(p.meta?.we ?? p.WE) : T.textDisabled, fontWeight: 600 }}>{(p.meta?.we ?? p.WE) || "—"}</td>
                    <td style={{ ...td("INT"), color: (p.meta?.int ?? p.INT) ? intangibleColor(p.meta?.int ?? p.INT) : T.textDisabled, fontWeight: 600 }}>{(p.meta?.int ?? p.INT) || "—"}</td>
                    <td style={{ ...td("_demSort"), color: dem && dem !== "-" ? T.warn : T.textDisabled }}>{dem && dem !== "-" ? dem : "—"}</td>
                  </tr>
                  );
                })}
                {paged.length === 0 && <tr><td colSpan={cols.length} style={{ ...S.td, textAlign: "center", color: T.text3, padding: "16px 12px" }}>No IAFA players found</td></tr>}
              </tbody>
            </table>
          </div>
          <Pagination page={page} totalPages={totalPages} total={visiblePool.length} onPrev={() => setPage(Math.max(0, page - 1))} onNext={() => setPage(Math.min(totalPages - 1, page + 1))} />
        </div>
      </Section>
    </div>
  );
}
